//! Issue #88 end to end: Flywheel opened from Finder inherits `/usr/bin:/bin:/usr/sbin:/sbin`, and
//! `claude` lives only on a `PATH` the developer's login profile adds. After [`adopt`] (what `main`
//! runs first), the real sidecar (`packages/sidecar/dist/index.js`) spawns `claude` by bare name
//! (`FLYWHEEL_CLAUDE_BIN` unset), and the session's own shell sees the shim directory in front of
//! the same login-shell `PATH`.
//!
//! One test in this binary on purpose: it rewrites the process's `PATH`, `SHELL` and `ZDOTDIR`.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use flywheel_core::login_path::{adopt, adopted, claude_bin, find_on_path};

const FINDER_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

#[test]
fn a_session_spawns_claude_found_only_on_the_login_profile_path() {
    let root = workspace_root();
    let dist_entry = root.join("packages/sidecar/dist/index.js");
    assert!(dist_entry.is_file(), "expected {dist_entry:?}: run `npm --prefix packages/sidecar run build` first");
    let fake_claude = root.join("packages/sidecar/test/fake-claude.mjs");
    // Found on the test's own PATH, before it is cut down to Finder's.
    let node = find_on_path("node", &std::env::var_os("PATH").unwrap()).expect("node on the test's PATH");

    // `claude` exists only in `profile_bin`, which only the login profile puts on PATH. It records
    // the PATH it was started with and where its shell finds `git`, then plays the backend.
    let profile_bin = tempfile::tempdir().unwrap();
    let record = tempfile::tempdir().unwrap();
    let record_file = record.path().join("claude-saw");
    let stub = profile_bin.path().join("claude");
    std::fs::write(
        &stub,
        format!(
            "#!/bin/sh\n{{ printf '%s\\n' \"$PATH\"; command -v git; }} > '{}'\nexec '{}' '{}' \"$@\"\n",
            record_file.display(),
            node.display(),
            fake_claude.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
    let profile = tempfile::tempdir().unwrap();
    std::fs::write(profile.path().join(".zprofile"), format!("export PATH=\"{}:$PATH\"\n", profile_bin.path().display()))
        .unwrap();
    let runtime = tempfile::tempdir().unwrap();
    let worktree = tempfile::tempdir().unwrap();

    std::env::set_var("PATH", FINDER_PATH);
    std::env::set_var("SHELL", "/bin/zsh");
    std::env::set_var("ZDOTDIR", profile.path());
    std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path());
    std::env::remove_var("FLYWHEEL_CLAUDE_BIN");

    let login = adopt(Duration::from_secs(30));
    assert_eq!(login.warning, None);
    assert_eq!(std::env::var("PATH").unwrap(), login.path, "the login PATH is now the process's own");
    assert_eq!(adopted(), Some(&login));
    assert_eq!(claude_bin(), Ok(stub.clone()), "Start's check finds the stub on the login PATH");

    // The session's env, built the way every launch builds it: the shim directory in front of PATH.
    let session_env = flywheel_core::shim::shim_env_for_run("login-path-run").expect("the shim installs");
    let session_path = session_env["PATH"].clone();
    assert_eq!(session_path.split_once(':').map(|(_, rest)| rest), Some(login.path.as_str()));
    let shim_dir = PathBuf::from(session_path.split(':').next().unwrap());

    let mut child = Command::new(&node)
        .arg(&dist_entry)
        .env("FLYWHEEL_HEARTBEAT_STALE_MS", "120000")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("the sidecar spawns");
    let (done_tx, done_rx) = mpsc::channel::<()>();
    let pid = child.id();
    let watchdog = std::thread::spawn(move || {
        if done_rx.recv_timeout(Duration::from_secs(30)).is_err() {
            let _ = Command::new("/bin/kill").arg("-9").arg(pid.to_string()).status();
        }
    });

    let request = serde_json::json!({
        "id": "login-path-spawn",
        "op": "spawn",
        "runId": "login-path-run",
        "worktreePath": worktree.path(),
        "prompt": "say hi",
        "permissionMode": "acceptEdits",
        "env": session_env,
    });
    writeln!(child.stdin.as_mut().unwrap(), "{request}").unwrap();

    let mut closed = None;
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        let Ok(line) = line else { break };
        let Ok(envelope) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if envelope["kind"] == "event" && envelope["event"]["type"] == "session_closed" {
            closed = Some(envelope["event"].clone());
            break;
        }
    }
    drop(child.stdin.take());
    let _ = child.wait();
    let _ = done_tx.send(());
    watchdog.join().unwrap();

    let closed = closed.expect("the session reached session_closed");
    let saw = std::fs::read_to_string(&record_file)
        .unwrap_or_else(|e| panic!("the stub claude never ran ({e}); session_closed was {closed}"));
    let mut lines = saw.lines();
    assert_eq!(lines.next(), Some(session_path.as_str()), "claude and its Bash see the shim in front of the login PATH");
    assert_eq!(lines.next().map(PathBuf::from), Some(shim_dir.join("git")), "the session's git is the shim");
}
