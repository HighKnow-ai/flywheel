//! D-REV-03: an epic request is refused with the bare `draftChanged` BEFORE any push or forge
//! call. The ordering is proven by a `gh` stub on `PATH` that appends a line to a log on every
//! invocation: after a hash mismatch the log must not exist, and the match case (same file) shows
//! the stub does leave a trace when it is called — otherwise "never invoked" would be vacuous.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use core::forge::request_body::RequestDraft;
use core::forge::{open_epic_request_if_unchanged, EpicRequestOutcome, Forge, OpenEpicRequestError};

/// `PATH` is process-global and `#[test]` fns run concurrently: serialize both tests.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

const BRANCH: &str = "epic/ordering";

fn git(repo: &Path, args: &[&str]) {
    let status = std::process::Command::new("git").arg("-C").arg(repo).args(args).status().expect("spawn git");
    assert!(status.success(), "git -C {repo:?} {args:?} failed");
}

struct Fixture {
    _repo: tempfile::TempDir,
    _remote: tempfile::TempDir,
    stubs: tempfile::TempDir,
    repo_path: std::path::PathBuf,
    draft: RequestDraft,
}

impl Fixture {
    fn log(&self) -> std::path::PathBuf {
        self.stubs.path().join("gh.log")
    }
    fn lines(&self) -> Vec<String> {
        std::fs::read_to_string(self.log()).map(|s| s.lines().map(str::to_string).collect()).unwrap_or_default()
    }
}

/// A repo with a local bare `origin`, a branch ahead of `main`, and a `gh` stub that logs every
/// call. `pr create` also records whether the branch already existed on the remote at that moment,
/// which is what "the push happens before the forge call" means.
fn fixture() -> Fixture {
    let repo = tempfile::tempdir().unwrap();
    let remote = tempfile::tempdir().unwrap();
    let stubs = tempfile::tempdir().unwrap();
    let rp = repo.path();
    git(remote.path(), &["init", "--bare", "--initial-branch=main"]);
    git(rp, &["init", "--initial-branch=main"]);
    git(rp, &["config", "user.email", "fixture@flywheel.test"]);
    git(rp, &["config", "user.name", "Fixture"]);
    std::fs::write(rp.join("a.txt"), "a\n").unwrap();
    git(rp, &["add", "a.txt"]);
    git(rp, &["commit", "-m", "init"]);
    git(rp, &["remote", "add", "origin", &remote.path().to_string_lossy()]);
    git(rp, &["checkout", "-b", BRANCH]);
    std::fs::write(rp.join("b.txt"), "b\n").unwrap();
    git(rp, &["add", "b.txt"]);
    git(rp, &["commit", "-m", "epic work"]);

    let log = stubs.path().join("gh.log");
    let created = stubs.path().join("created");
    let script = format!(
        r#"#!/bin/sh
echo "$*" >> '{log}'
if [ "$1 $2" = "pr create" ]; then
  cat > /dev/null
  if git --git-dir='{remote}' rev-parse --verify -q refs/heads/{BRANCH} > /dev/null; then
    echo "branch-on-remote-at-create" >> '{log}'
  fi
  touch '{created}'
  exit 0
fi
if [ -f '{created}' ]; then
  echo '[{{"number":7,"state":"OPEN","url":"https://example.test/7","title":"t","baseRefName":"main","createdAt":"2026-01-01T00:00:00Z"}}]'
else
  echo '[]'
fi
"#,
        log = log.display(),
        remote = remote.path().display(),
        created = created.display(),
    );
    let gh = stubs.path().join("gh");
    std::fs::write(&gh, script).unwrap();
    std::fs::set_permissions(&gh, std::fs::Permissions::from_mode(0o755)).unwrap();

    let draft = RequestDraft {
        title: "Epic".into(),
        body: "Body".into(),
        head_branch: BRANCH.into(),
        target_branch: "main".into(),
    };
    Fixture { repo_path: rp.to_path_buf(), _repo: repo, _remote: remote, stubs, draft }
}

fn with_stub_on_path<T>(fx: &Fixture, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let original = std::env::var_os("PATH");
    let patched = match &original {
        Some(p) => format!("{}:{}", fx.stubs.path().display(), p.to_string_lossy()),
        None => fx.stubs.path().display().to_string(),
    };
    // SAFETY: ENV_LOCK serializes every PATH mutation in this binary; PATH is restored below.
    unsafe { std::env::set_var("PATH", patched) };
    let out = f();
    unsafe {
        match &original {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }
    out
}

#[test]
fn a_moved_draft_is_refused_as_draft_changed_before_any_forge_call_or_push() {
    let fx = fixture();
    let stale = "0".repeat(64);
    let result =
        with_stub_on_path(&fx, || open_epic_request_if_unchanged(Forge::GitHub, &fx.repo_path, &fx.draft, &stale));

    match result {
        Err(OpenEpicRequestError::DraftChanged { .. }) => {}
        other => panic!("expected DraftChanged, got {other:?}"),
    }
    assert!(!fx.log().exists(), "the forge stub was invoked despite a draft mismatch: {:?}", fx.lines());
    let remote_branches = std::process::Command::new("git")
        .arg("-C")
        .arg(&fx.repo_path)
        .args(["ls-remote", "--heads", "origin"])
        .output()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&remote_branches.stdout).trim().is_empty(),
        "a branch reached the remote despite a draft mismatch"
    );
    assert_eq!(OpenEpicRequestError::DraftChanged { previewed: String::new(), current: String::new() }.code(), "draftChanged");
}

#[test]
fn a_matching_draft_pushes_first_then_calls_the_forge_and_the_stub_leaves_a_trace() {
    let fx = fixture();
    let hash = fx.draft.content_hash();
    let result =
        with_stub_on_path(&fx, || open_epic_request_if_unchanged(Forge::GitHub, &fx.repo_path, &fx.draft, &hash));

    assert!(matches!(result, Ok(EpicRequestOutcome::Opened(_))), "expected Opened, got {result:?}");
    let lines = fx.lines();
    assert!(!lines.is_empty(), "the stub must leave a trace when it is called, or the mismatch test proves nothing");
    assert!(
        lines.iter().any(|l| l.starts_with("pr create")),
        "no `pr create` recorded: {lines:?}"
    );
    assert!(
        lines.iter().any(|l| l == "branch-on-remote-at-create"),
        "the push did not land before the forge's create call: {lines:?}"
    );
}
