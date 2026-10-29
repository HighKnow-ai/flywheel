//! Issue #81: a Gated push asks once. The compiled shim drives the real git, which runs the real
//! rendered `pre-push` hook (`flywheel_core::git_hooks::pre_push_hook_script`) against a local bare
//! remote. A mock permission socket stands in for the sidecar's server and speaks its protocol:
//! it answers every held request with `allow`, issues an approval when the request asks for one,
//! and answers `push_approval_check` / `push_approval_revoke` from its own record.
//!
//! The only remote this file touches is the bare repository each fixture creates in its own
//! scratch directory.

use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::{Arc, Mutex};

use flywheel_core::git_hooks::{pre_push_hook_script, PUSH_APPROVAL_ENV};

const SHIM: &str = env!("CARGO_BIN_EXE_flywheel-shim");

fn real(name: &str) -> PathBuf {
    let path_var = std::env::var_os("PATH").expect("PATH is set");
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| panic!("{name} not found on PATH"))
}

/// Strip every Flywheel and injected git-config variable so the test controls the environment.
fn clean_env(cmd: &mut Command) {
    for (key, _) in std::env::vars_os() {
        let key_text = key.to_string_lossy();
        if key_text.starts_with("FLYWHEEL_") || key_text.starts_with("GIT_CONFIG") {
            cmd.env_remove(&key);
        }
    }
}

fn git_ok(dir: &Path, args: &[&str]) {
    let mut cmd = Command::new(real("git"));
    clean_env(&mut cmd);
    let output = cmd
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@example.com",
            "-c",
            "commit.gpgsign=false",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .expect("git runs");
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

struct Fixture {
    _dir: tempfile::TempDir,
    remote: PathBuf,
    work: PathBuf,
}

/// A bare remote holding `main` and `doomed`, a work tree whose `main` has been rewritten so a
/// push of it is a force push, and the real pre-push hook installed through `core.hooksPath`.
fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("scratch dir");
    let root = dir.path().canonicalize().unwrap();
    let remote = root.join("remote.git");
    let work = root.join("work");
    git_ok(
        &root,
        &[
            "init",
            "-q",
            "--bare",
            "--initial-branch=main",
            remote.to_str().unwrap(),
        ],
    );
    git_ok(
        &root,
        &[
            "init",
            "-q",
            "--initial-branch=main",
            work.to_str().unwrap(),
        ],
    );
    fs::write(work.join("a.txt"), "a").unwrap();
    git_ok(&work, &["add", "a.txt"]);
    git_ok(&work, &["commit", "-q", "-m", "a"]);
    git_ok(
        &work,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    git_ok(&work, &["push", "-q", "origin", "main", "main:doomed"]);
    rewrite_main(&work, "rewritten");

    let hooks = root.join("hooks");
    fs::create_dir(&hooks).unwrap();
    let hook = hooks.join("pre-push");
    fs::write(
        &hook,
        pre_push_hook_script(&real("git"), Path::new(SHIM), &root),
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    git_ok(
        &work,
        &["config", "core.hooksPath", hooks.to_str().unwrap()],
    );

    Fixture {
        _dir: dir,
        remote,
        work,
    }
}

/// Replace `main`'s tip with a new root commit, so pushing it discards the remote's history.
fn rewrite_main(work: &Path, content: &str) {
    fs::write(work.join("a.txt"), content).unwrap();
    git_ok(work, &["add", "a.txt"]);
    git_ok(work, &["commit", "-q", "--amend", "-m", content]);
}

fn remote_ref(remote: &Path, branch: &str) -> Option<String> {
    let output = Command::new(real("git"))
        .args([
            "rev-parse",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ])
        .current_dir(remote)
        .output()
        .expect("git runs");
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// What the mock server saw: every held request (each one a prompt the developer would answer),
/// and every approval it issued and still considers live.
#[derive(Default)]
struct ServerState {
    prompts: Vec<serde_json::Value>,
    live: HashSet<String>,
    issued: Vec<String>,
}

struct MockServer {
    socket: PathBuf,
    state: Arc<Mutex<ServerState>>,
}

impl MockServer {
    fn prompts(&self) -> Vec<serde_json::Value> {
        self.state.lock().unwrap().prompts.clone()
    }
    fn issued(&self) -> Vec<String> {
        self.state.lock().unwrap().issued.clone()
    }
    fn live_count(&self) -> usize {
        self.state.lock().unwrap().live.len()
    }
}

impl Drop for MockServer {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.socket);
    }
}

fn mock_server() -> MockServer {
    static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let socket = PathBuf::from("/tmp").join(format!("fw-spp-{}-{n}.sock", std::process::id()));
    let _ = fs::remove_file(&socket);
    let listener = UnixListener::bind(&socket).expect("bind the mock permission socket");
    let state = Arc::new(Mutex::new(ServerState::default()));
    let thread_state = Arc::clone(&state);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { return };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                continue;
            }
            let parsed: serde_json::Value = serde_json::from_str(line.trim()).expect("valid JSON");
            let mut state = thread_state.lock().unwrap();
            let answer = match parsed["kind"].as_str() {
                Some("push_approval_check") => {
                    let ok = parsed["approval"]
                        .as_str()
                        .is_some_and(|a| state.live.contains(a));
                    serde_json::json!({ "approved": ok })
                }
                Some("push_approval_revoke") => {
                    let gone = parsed["approval"]
                        .as_str()
                        .is_some_and(|a| state.live.remove(a));
                    serde_json::json!({ "revoked": gone })
                }
                Some(_) => continue,
                None => {
                    state.prompts.push(parsed.clone());
                    if parsed["issueApproval"] == true {
                        let approval = format!("approval-{}-{}", n, state.issued.len());
                        state.live.insert(approval.clone());
                        state.issued.push(approval.clone());
                        serde_json::json!({ "decision": "allow", "approval": approval })
                    } else {
                        serde_json::json!({ "decision": "allow" })
                    }
                }
            };
            drop(state);
            let mut stream = stream;
            let _ = stream.write_all(format!("{answer}\n").as_bytes());
        }
    });
    MockServer { socket, state }
}

/// `git` as a Story session runs it: through the shim, on the session's socket.
fn shim_git_cmd(fx: &Fixture, server: &MockServer) -> Command {
    let mut cmd = Command::new(SHIM);
    clean_env(&mut cmd);
    cmd.arg0("git")
        .current_dir(&fx.work)
        .env("FLYWHEEL_REAL_GIT", real("git"))
        .env("FLYWHEEL_STORY_BRANCH", "flywheel/s-1")
        .env("FLYWHEEL_WORKTREE_PATH", &fx.work)
        .env("FLYWHEEL_DEFAULT_BRANCH", "trunk")
        .env("FLYWHEEL_PERMISSION_SOCKET", &server.socket);
    cmd
}

fn shim_git(fx: &Fixture, server: &MockServer, args: &[&str]) -> Output {
    shim_git_cmd(fx, server)
        .args(args)
        .output()
        .expect("shim runs")
}

/// `git <args>` from a process the shim does not wrap: the real git, on the session's socket.
fn bypassing_git(
    fx: &Fixture,
    server: &MockServer,
    args: &[&str],
    extra_env: &[(&str, &str)],
) -> Output {
    let mut cmd = Command::new(real("git"));
    clean_env(&mut cmd);
    cmd.current_dir(&fx.work)
        .env("FLYWHEEL_PERMISSION_SOCKET", &server.socket);
    for (key, value) in extra_env {
        cmd.env(key, value);
    }
    cmd.args(args).output().expect("git runs")
}

fn assert_ok(output: &Output) {
    assert!(
        output.status.success(),
        "expected success. stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn a_force_push_through_the_shim_asks_exactly_once_and_proceeds() {
    let fx = fixture();
    let server = mock_server();
    let before = remote_ref(&fx.remote, "main");

    let output = shim_git(&fx, &server, &["push", "--force", "origin", "main"]);
    assert_ok(&output);

    let prompts = server.prompts();
    assert_eq!(
        prompts.len(),
        1,
        "one Gated-action prompt, got: {prompts:#?}"
    );
    assert_eq!(prompts[0]["input"]["destructiveCategory"], "force-push");
    assert_ne!(
        remote_ref(&fx.remote, "main"),
        before,
        "the allowed force push must have landed"
    );
    assert_eq!(
        server.live_count(),
        0,
        "the shim revokes its approval once git exits"
    );
}

#[test]
fn a_remote_branch_deletion_through_the_shim_asks_exactly_once_and_proceeds() {
    let fx = fixture();
    let server = mock_server();

    let output = shim_git(&fx, &server, &["push", "origin", "--delete", "doomed"]);
    assert_ok(&output);

    let prompts = server.prompts();
    assert_eq!(
        prompts.len(),
        1,
        "one Gated-action prompt, got: {prompts:#?}"
    );
    assert_eq!(
        prompts[0]["input"]["destructiveCategory"],
        "branch-deletion"
    );
    assert_eq!(
        remote_ref(&fx.remote, "doomed"),
        None,
        "the allowed deletion must have landed"
    );
}

#[test]
fn a_push_that_bypasses_the_shim_is_still_asked_by_the_hook() {
    let fx = fixture();
    let server = mock_server();

    let output = bypassing_git(&fx, &server, &["push", "--force", "origin", "main"], &[]);
    assert_ok(&output);

    let prompts = server.prompts();
    assert_eq!(
        prompts.len(),
        1,
        "the hook asks for a push the shim never saw, got: {prompts:#?}"
    );
    assert_eq!(prompts[0]["input"]["destructiveCategory"], "force-push");
}

#[test]
fn a_forged_approval_does_not_spare_a_bypassing_push_the_hook_prompt() {
    let fx = fixture();
    let server = mock_server();

    let output = bypassing_git(
        &fx,
        &server,
        &["push", "origin", "--delete", "doomed"],
        &[(PUSH_APPROVAL_ENV, "forged-by-the-agent")],
    );
    assert_ok(&output);
    assert_eq!(
        server.prompts().len(),
        1,
        "a forged approval is not on the server's record"
    );
}

#[test]
fn a_used_approval_cannot_be_replayed_and_a_later_push_asks_again() {
    let fx = fixture();
    let server = mock_server();

    assert_ok(&shim_git(
        &fx,
        &server,
        &["push", "--force", "origin", "main"],
    ));
    let used = server.issued();
    assert_eq!(
        used.len(),
        1,
        "one approval issued for one approved invocation"
    );

    // Replayed into a push the shim does not wrap: the hook asks.
    rewrite_main(&fx.work, "second rewrite");
    assert_ok(&bypassing_git(
        &fx,
        &server,
        &["push", "--force", "origin", "main"],
        &[(PUSH_APPROVAL_ENV, &used[0])],
    ));
    assert_eq!(server.prompts().len(), 2, "a spent approval covers nothing");

    // Replayed into a push through the shim: the shim never forwards an inherited value, so this
    // push gets its own prompt and its own approval, and the hook does not ask a second time.
    rewrite_main(&fx.work, "third rewrite");
    let replay = shim_git_cmd(&fx, &server)
        .env(PUSH_APPROVAL_ENV, &used[0])
        .args(["push", "--force", "origin", "main"])
        .output()
        .expect("shim runs");
    assert_ok(&replay);
    assert_eq!(server.prompts().len(), 3, "a later push asks again, once");
    assert_eq!(server.issued().len(), 2);
}
