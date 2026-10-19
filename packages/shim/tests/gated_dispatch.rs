//! The compiled shim against the Gated-action deny-list (`docs/mvp-spec.md` §4.1): an allowed
//! command runs the real binary with no permission request at all, and a Gated action never runs
//! it without one. No permission socket is set, so a Gated action is refused with the shim's own
//! "nothing to ask" message rather than blocking — which is exactly what proves a request was
//! needed, and its absence on the allowed path proves none was.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const SHIM: &str = env!("CARGO_BIN_EXE_flywheel-shim");
const NOTHING_TO_ASK: &str = "FLYWHEEL_PERMISSION_SOCKET is not set";

fn real(name: &str) -> PathBuf {
    let path_var = std::env::var_os("PATH").expect("PATH is set");
    std::env::split_paths(&path_var)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| panic!("{name} not found on PATH"))
}

/// A shim command invoked under `name`, with every Flywheel variable cleared first so the test
/// controls the session context exactly.
fn shim_as(name: &str, cwd: &Path) -> Command {
    let mut cmd = Command::new(SHIM);
    cmd.arg0(name);
    cmd.current_dir(cwd);
    for (key, _) in std::env::vars_os() {
        if key.to_string_lossy().starts_with("FLYWHEEL_") || key.to_string_lossy().starts_with("GIT_CONFIG") {
            cmd.env_remove(key);
        }
    }
    cmd.env("FLYWHEEL_REAL_GIT", real("git"));
    cmd.env("FLYWHEEL_REAL_RM", real("rm"));
    cmd
}

fn refused_for_lack_of_a_supervisor(output: &Output) -> bool {
    !output.status.success() && String::from_utf8_lossy(&output.stderr).contains(NOTHING_TO_ASK)
}

fn git_in(dir: &Path, args: &[&str]) {
    let status = Command::new(real("git"))
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false"])
        .args(args)
        .current_dir(dir)
        .env_remove("GIT_CONFIG_COUNT")
        .status()
        .expect("git runs");
    assert!(status.success(), "git {args:?} failed");
}

/// A repository with `main`, the Story branch `flywheel/s-1` one commit ahead, and `other`.
fn story_repo() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("scratch dir");
    let repo = dir.path().canonicalize().unwrap().join("repo");
    fs::create_dir(&repo).unwrap();
    git_in(&repo, &["init", "-q", "--initial-branch=main"]);
    fs::write(repo.join("a.txt"), "a").unwrap();
    git_in(&repo, &["add", "a.txt"]);
    git_in(&repo, &["commit", "-q", "-m", "a"]);
    git_in(&repo, &["branch", "other"]);
    git_in(&repo, &["checkout", "-q", "-b", "flywheel/s-1"]);
    fs::write(repo.join("b.txt"), "b").unwrap();
    git_in(&repo, &["add", "b.txt"]);
    git_in(&repo, &["commit", "-q", "-m", "b"]);
    (dir, repo)
}

fn story_git(repo: &Path) -> Command {
    let mut cmd = shim_as("git", repo);
    cmd.env("FLYWHEEL_STORY_BRANCH", "flywheel/s-1");
    cmd.env("FLYWHEEL_WORKTREE_PATH", repo);
    cmd.env("FLYWHEEL_DEFAULT_BRANCH", "main");
    cmd
}

#[test]
fn read_only_git_runs_with_no_request() {
    let (_dir, repo) = story_repo();
    for args in [
        &["status", "--porcelain"][..],
        &["log", "--oneline"],
        &["ls-files"],
        &["rev-parse", "HEAD"],
        &["diff", "main"],
        &["-C", ".", "-c", "core.quotepath=false", "rev-parse", "--show-toplevel"],
        &["worktree", "list"],
    ] {
        let output = story_git(&repo).args(args).output().expect("shim runs");
        assert!(
            output.status.success(),
            "git {args:?} must run without asking, stderr: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn a_push_behind_global_options_is_still_gated() {
    let (_dir, repo) = story_repo();
    let output = story_git(&repo).args(["-C", ".", "-c", "a.b=c", "push"]).output().expect("shim runs");
    assert!(refused_for_lack_of_a_supervisor(&output), "stderr: {}", String::from_utf8_lossy(&output.stderr));
}

#[test]
fn rebasing_the_story_branch_is_allowed_and_rebasing_another_is_gated() {
    let (_dir, repo) = story_repo();
    let own = story_git(&repo).args(["rebase", "main"]).output().expect("shim runs");
    assert!(own.status.success(), "rebase on the Story branch must run, stderr: {}", String::from_utf8_lossy(&own.stderr));

    git_in(&repo, &["checkout", "-q", "other"]);
    let elsewhere = story_git(&repo).args(["rebase", "flywheel/s-1"]).output().expect("shim runs");
    assert!(
        refused_for_lack_of_a_supervisor(&elsewhere),
        "rebase while HEAD is another branch must ask, stderr: {}",
        String::from_utf8_lossy(&elsewhere.stderr)
    );
}

#[test]
fn recursive_rm_inside_the_worktree_runs_and_outside_is_gated() {
    let (dir, repo) = story_repo();
    fs::create_dir_all(repo.join("build/out")).unwrap();
    let outside = dir.path().join("outside");
    fs::create_dir_all(&outside).unwrap();

    let mut inside_rm = shim_as("rm", &repo);
    inside_rm.env("FLYWHEEL_WORKTREE_PATH", &repo).args(["-rf", "build"]);
    let output = inside_rm.output().expect("shim runs");
    assert!(output.status.success(), "stderr: {}", String::from_utf8_lossy(&output.stderr));
    assert!(!repo.join("build").exists(), "the allowed rm must have run");

    let mut outside_rm = shim_as("rm", &repo);
    outside_rm.env("FLYWHEEL_WORKTREE_PATH", &repo).args(["-rf", "../outside"]);
    let output = outside_rm.output().expect("shim runs");
    assert!(refused_for_lack_of_a_supervisor(&output), "stderr: {}", String::from_utf8_lossy(&output.stderr));
    assert!(outside.exists(), "a gated rm must never run");
}

/// A stand-in for `npm`/`cargo`/`gh` that records its arguments in `marker`.
fn fake_tool(dir: &Path, name: &str) -> (PathBuf, PathBuf) {
    let marker = dir.join(format!("{name}.ran"));
    let script = dir.join(format!("real-{name}"));
    fs::write(&script, format!("#!/bin/sh\necho \"$@\" > '{}'\necho ran-{name}\n", marker.display())).unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
    (script, marker)
}

#[test]
fn publishing_commands_are_gated_and_everything_else_passes_through() {
    let dir = tempfile::tempdir().expect("scratch dir");
    for (name, env_var, allowed, gated) in [
        ("npm", "FLYWHEEL_REAL_NPM", &["test"][..], &["publish"][..]),
        ("cargo", "FLYWHEEL_REAL_CARGO", &["build", "--release"], &["publish"]),
        ("gh", "FLYWHEEL_REAL_GH", &["pr", "view", "1"], &["pr", "merge", "1"]),
        ("gh", "FLYWHEEL_REAL_GH", &["issue", "list"], &["release", "create", "v1"]),
    ] {
        let (script, marker) = fake_tool(dir.path(), name);

        let output = shim_as(name, dir.path()).env(env_var, &script).args(allowed).output().expect("shim runs");
        assert!(output.status.success(), "{name} {allowed:?} stderr: {}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), format!("ran-{name}"));
        assert_eq!(fs::read_to_string(&marker).unwrap().trim(), allowed.join(" "));
        fs::remove_file(&marker).unwrap();

        let output = shim_as(name, dir.path()).env(env_var, &script).args(gated).output().expect("shim runs");
        assert!(refused_for_lack_of_a_supervisor(&output), "{name} {gated:?} stderr: {}", String::from_utf8_lossy(&output.stderr));
        assert!(!marker.exists(), "{name} {gated:?} must never reach the real binary");
    }
}
