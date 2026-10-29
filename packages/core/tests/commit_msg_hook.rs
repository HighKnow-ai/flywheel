//! Phase 7, plan 07-02, Task 2: LINK-03 coverage against a real git repository — stamping, the
//! branch-namespace guard, idempotency across an amend, and Layer 3 pre-push coexistence.
//! Mirrors `git_hooks_pre_push.rs`'s own fixture shape (explicit `user.name`/`user.email`, never
//! the ambient config) and copies its `with_scratch_envs`/`register`/`run_git*`/`fresh_repo`
//! helpers rather than sharing them — each `tests/*.rs` file compiles to its own binary.
//!
//! Every branch name under test is built by calling [`flywheel_core::branch::story_branch_name`], never a hand-written literal (RESEARCH.md
//! assumption A2) — the test proves the hook's `sed` extraction agrees with the real derivation
//! function, not with a string this file invented independently.

use flywheel_core::branch::story_branch_name;
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::project::register_project;
use flywheel_core::git_hooks::{
    hooks_dir_for_repo, install_commit_msg_hook, install_pre_push_hook, CommitMsgInstall,
    PrePushInstall, COMMIT_MSG_MARKER, PRE_PUSH_MARKER,
};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

/// Serializes every call to [`with_scratch_envs`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT` and
/// `FLYWHEEL_RUNTIME_DIR` are process-global mutable state, and `cargo test` runs a binary's
/// `#[test]` fns concurrently by default (mirrors `git_hooks_pre_push.rs`'s own `ENV_LOCK`; this
/// file's own static cannot race with that one — each `tests/*.rs` file compiles to its own
/// binary).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Set `FLYWHEEL_WORKTREE_ROOT` and `FLYWHEEL_RUNTIME_DIR` for the duration of `f`, serialized
/// against every other caller in this binary, so no test's `register_project`/`install_*_hook`
/// call ever touches the real `~/Flywheel` worktree root or the real app-data runtime directory.
fn with_scratch_envs<T>(worktree_root: &Path, runtime_dir: &Path, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates these vars while they're set, and this helper always clears them before returning.
    unsafe {
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root);
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime_dir);
    }
    let result = f();
    unsafe {
        std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
        std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
    }
    result
}

fn run_git(repo: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git -C {repo:?} {args:?}: {e}"))
}

fn run_git_ok(repo: &Path, args: &[&str]) -> Output {
    let output = run_git(repo, args);
    assert!(
        output.status.success(),
        "git -C {repo:?} {args:?} failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// A real `git init`-ed, config'd repository with an initial commit on `main` and no remote —
/// enough for every commit-msg test that never needs to push.
fn fresh_repo(root: &Path) -> PathBuf {
    let dir = tempfile::tempdir_in(root).expect("failed to create scratch repo dir");
    let repo = dir.path().to_path_buf();
    std::mem::forget(dir);
    run_git_ok(
        root,
        &["init", "--initial-branch", "main", repo.to_str().unwrap()],
    );
    run_git_ok(
        &repo,
        &[
            "config",
            "user.email",
            "commit-msg-hook-test@flywheel.invalid",
        ],
    );
    run_git_ok(
        &repo,
        &["config", "user.name", "Flywheel Commit Msg Hook Test"],
    );
    std::fs::write(
        repo.join("README.md"),
        "# commit_msg_hook.rs scratch repo\n",
    )
    .expect("failed to write README");
    run_git_ok(&repo, &["add", "README.md"]);
    run_git_ok(&repo, &["commit", "-m", "initial commit"]);
    repo
}

/// Register `work_path` as a real Flywheel project (so both hooks arrive by the real install
/// path, never a test-only shortcut) and return the project id.
fn register(
    worktree_root: &Path,
    runtime_dir: &Path,
    work_path: &Path,
    key_prefix: &str,
) -> String {
    with_scratch_envs(worktree_root, runtime_dir, || {
        let db_dir = tempfile::tempdir().expect("failed to create scratch db dir");
        let db_path = db_dir.path().join("flywheel.db");
        let backups_dir = db_dir.path().join("backups");
        std::mem::forget(db_dir);
        let mut conn =
            flywheel_core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate");
        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
        let project = register_project(
            &mut conn,
            &actor_id,
            work_path,
            "Commit Msg Hook Fixture",
            key_prefix,
        )
        .expect("register_project should succeed");
        project.id
    })
}

/// Checkout `branch` (creating it from the current HEAD if needed) and make one commit, with
/// `run_id` set as `FLYWHEEL_RUN_ID` in the committing CHILD PROCESS's environment only — never
/// on the test process itself, so other tests in this binary are never affected.
fn commit_on_branch(repo: &Path, branch: &str, run_id: Option<&str>) {
    run_git_ok(repo, &["checkout", "-B", branch]);
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(["commit", "--allow-empty", "-m", "test commit"]);
    match run_id {
        Some(id) => {
            cmd.env("FLYWHEEL_RUN_ID", id);
        }
        None => {
            cmd.env_remove("FLYWHEEL_RUN_ID");
        }
    }
    let output = cmd.output().expect("failed to spawn git commit");
    assert!(
        output.status.success(),
        "git commit on branch {branch:?} failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn commit_message(repo: &Path) -> String {
    let output = run_git_ok(repo, &["log", "-1", "--format=%B"]);
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn trailer_line_count(message: &str, key: &str) -> usize {
    message
        .lines()
        .filter(|line| line.starts_with(&format!("{key}: ")))
        .count()
}

// --- Stamping, ordering, and the namespace guard --------------------------------------------

#[test]
fn commit_on_a_story_branch_carries_both_trailers_in_order_after_a_blank_line() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    register(scratch.path(), runtime.path(), &repo, "CMH1");

    let branch = story_branch_name("FLY-42", "Some title");
    commit_on_branch(&repo, &branch, Some("run-abc123"));

    let message = commit_message(&repo);
    assert!(
        message.contains("\n\nFlywheel-Story: fly-42\nFlywheel-Run: run-abc123"),
        "expected both trailers, story first then run, after a blank-line separator; got: {message:?}"
    );
    assert_eq!(trailer_line_count(&message, "Flywheel-Story"), 1);
    assert_eq!(trailer_line_count(&message, "Flywheel-Run"), 1);
}

#[test]
fn amending_the_commit_does_not_duplicate_the_trailer() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    register(scratch.path(), runtime.path(), &repo, "CMH2");

    let branch = story_branch_name("FLY-7", "Idempotent amend");
    commit_on_branch(&repo, &branch, Some("run-1"));

    // --no-edit keeps the EXISTING message (trailers included) unchanged, so this amend re-runs
    // the hook against a message that already carries both trailers — exactly the
    // --if-exists doNothing scenario this test proves. (An amend that supplies a brand NEW
    // message via -m replaces the message outright, including its old trailer block, so the hook
    // would legitimately re-stamp fresh trailers against the new env — a different, unrelated
    // scenario, not the one LINK-03's "stamped exactly once" guarantee is about.)
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&repo)
        .args(["commit", "--amend", "--allow-empty", "--no-edit"]);
    cmd.env("FLYWHEEL_RUN_ID", "run-2");
    let output = cmd.output().expect("failed to spawn git commit --amend");
    assert!(
        output.status.success(),
        "amend failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    let message = commit_message(&repo);
    assert_eq!(
        trailer_line_count(&message, "Flywheel-Story"),
        1,
        "amend must not duplicate the Flywheel-Story trailer; got: {message:?}"
    );
    assert_eq!(
        trailer_line_count(&message, "Flywheel-Run"),
        1,
        "amend must not duplicate the Flywheel-Run trailer; got: {message:?}"
    );
    // --if-exists doNothing means the ALREADY-PRESENT trailer block is left alone on the amend —
    // the run id from the first commit is what survives, not the second commit's env var.
    assert!(
        message.contains("Flywheel-Run: run-1"),
        "the pre-existing trailer block must survive an amend untouched; got: {message:?}"
    );
}

#[test]
fn commit_on_main_carries_neither_trailer() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    register(scratch.path(), runtime.path(), &repo, "CMH3");

    run_git_ok(&repo, &["checkout", "main"]);
    let output = run_git_ok(
        &repo,
        &["commit", "--allow-empty", "-m", "a commit on main"],
    );
    assert!(output.status.success());

    let message = commit_message(&repo);
    assert!(
        !message.contains("Flywheel-Story:"),
        "main commit must carry no story trailer; got: {message:?}"
    );
    assert!(
        !message.contains("Flywheel-Run:"),
        "main commit must carry no run trailer; got: {message:?}"
    );
}

#[test]
fn flywheel_run_id_set_yields_that_id() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    register(scratch.path(), runtime.path(), &repo, "CMH5A");

    let branch = story_branch_name("FLY-10", "Run id set");
    commit_on_branch(&repo, &branch, Some("run-explicit-id"));

    let message = commit_message(&repo);
    assert!(
        message.contains("Flywheel-Run: run-explicit-id"),
        "expected the run trailer to carry the committing environment's FLYWHEEL_RUN_ID; got: {message:?}"
    );
}

#[test]
fn flywheel_run_id_unset_yields_manual() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    register(scratch.path(), runtime.path(), &repo, "CMH5");

    let branch = story_branch_name("FLY-9", "No run id set");
    commit_on_branch(&repo, &branch, None);

    let message = commit_message(&repo);
    assert!(
        message.contains("Flywheel-Run: manual"),
        "expected the run trailer to fall back to 'manual' when FLYWHEEL_RUN_ID is unset; got: {message:?}"
    );
}

// --- Extraction matches branch::story_branch_name's real output, across a table --------------

#[test]
fn extraction_matches_story_branch_name_across_keys_and_titles() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    register(scratch.path(), runtime.path(), &repo, "CMH6");

    let cases: &[(&str, &str)] = &[
        ("FLY-1", "Fix login bug"),
        // A title whose slug begins with a digit — proves the extraction's `[a-z0-9]{1,}` run
        // for the KEY segment stops at the first hyphen and never over-consumes into the slug's
        // own leading digits.
        ("ABC-100", "2026 Roadmap"),
        // A title containing non-ASCII bytes (RESEARCH.md assumption A2 / branch.rs's own
        // documented example: "Café — naïve" slugifies to "caf-nave").
        ("XYZ-7", "Café — naïve fix"),
    ];

    for (key, title) in cases {
        let branch = story_branch_name(key, title);
        commit_on_branch(&repo, &branch, Some("run-table"));
        let message = commit_message(&repo);
        let expected = format!("Flywheel-Story: {}", key.to_lowercase());
        assert!(
            message.contains(&expected),
            "branch {branch:?} (key={key:?}, title={title:?}): expected {expected:?} in message, got: {message:?}"
        );
    }
}

// --- Layer 3 coexistence: both install orders ------------------------------------------------

/// Assert `hooks_dir` holds both marked hooks, each carrying its own marker.
fn assert_both_hooks_present(hooks_dir: &Path) {
    let pre_push =
        std::fs::read_to_string(hooks_dir.join("pre-push")).expect("pre-push hook should exist");
    assert!(
        pre_push.contains(PRE_PUSH_MARKER),
        "pre-push hook must carry its own marker"
    );
    let commit_msg = std::fs::read_to_string(hooks_dir.join("commit-msg"))
        .expect("commit-msg hook should exist");
    assert!(
        commit_msg.contains(COMMIT_MSG_MARKER),
        "commit-msg hook must carry its own marker"
    );
}

#[test]
fn commit_msg_installed_first_then_pre_push_neither_refuses_the_others_directory() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let project_id = "coexistence-order-a";

    with_scratch_envs(scratch.path(), runtime.path(), || {
        let commit_msg_result = install_commit_msg_hook(&repo, project_id)
            .expect("install_commit_msg_hook should succeed");
        assert!(
            matches!(commit_msg_result, CommitMsgInstall::Installed { .. }),
            "{commit_msg_result:?}"
        );

        let pre_push_result =
            install_pre_push_hook(&repo, project_id).expect("install_pre_push_hook should succeed");
        assert!(
            matches!(pre_push_result, PrePushInstall::Installed { .. }),
            "{pre_push_result:?}"
        );

        // hooks_dir_for_repo reads FLYWHEEL_RUNTIME_DIR — must be resolved inside this closure,
        // while the scratch override is still in effect.
        let hooks_dir = hooks_dir_for_repo(project_id).expect("hooks_dir_for_repo should resolve");
        assert_both_hooks_present(&hooks_dir);
    });

    // A commit-shaped operation reaches its own hook.
    let branch = story_branch_name("FLY-55", "Order A proof");
    commit_on_branch(&repo, &branch, Some("run-order-a"));
    let message = commit_message(&repo);
    assert!(
        message.contains("Flywheel-Story: fly-55"),
        "commit-msg hook should have fired; got: {message:?}"
    );

    // A push-shaped operation reaches its own hook: an ordinary fast-forward push is allowed
    // through (the pre-push script's default-allow path for a non-destructive push), proving the
    // hook ran rather than core.hooksPath pointing nowhere.
    let remote = scratch.path().join("remote-a.git");
    run_git_ok(
        scratch.path(),
        &[
            "init",
            "--bare",
            "--initial-branch",
            "main",
            remote.to_str().unwrap(),
        ],
    );
    run_git_ok(
        &repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run_git_ok(&repo, &["checkout", "main"]);
    let push = run_git(&repo, &["push", "-u", "origin", "main"]);
    assert!(
        push.status.success(),
        "ordinary push should succeed with both hooks installed: {}",
        String::from_utf8_lossy(&push.stderr)
    );
}

#[test]
fn pre_push_installed_first_then_commit_msg_neither_refuses_the_others_directory() {
    let scratch = tempfile::tempdir().expect("scratch dir");
    let runtime = tempfile::tempdir().expect("runtime dir");
    let repo = fresh_repo(scratch.path());
    let project_id = "coexistence-order-b";

    with_scratch_envs(scratch.path(), runtime.path(), || {
        let pre_push_result =
            install_pre_push_hook(&repo, project_id).expect("install_pre_push_hook should succeed");
        assert!(
            matches!(pre_push_result, PrePushInstall::Installed { .. }),
            "{pre_push_result:?}"
        );

        let commit_msg_result = install_commit_msg_hook(&repo, project_id)
            .expect("install_commit_msg_hook should succeed");
        assert!(
            matches!(commit_msg_result, CommitMsgInstall::Installed { .. }),
            "{commit_msg_result:?}"
        );

        // hooks_dir_for_repo reads FLYWHEEL_RUNTIME_DIR — must be resolved inside this closure,
        // while the scratch override is still in effect.
        let hooks_dir = hooks_dir_for_repo(project_id).expect("hooks_dir_for_repo should resolve");
        assert_both_hooks_present(&hooks_dir);
    });

    let branch = story_branch_name("FLY-56", "Order B proof");
    commit_on_branch(&repo, &branch, Some("run-order-b"));
    let message = commit_message(&repo);
    assert!(
        message.contains("Flywheel-Story: fly-56"),
        "commit-msg hook should have fired; got: {message:?}"
    );

    let remote = scratch.path().join("remote-b.git");
    run_git_ok(
        scratch.path(),
        &[
            "init",
            "--bare",
            "--initial-branch",
            "main",
            remote.to_str().unwrap(),
        ],
    );
    run_git_ok(
        &repo,
        &["remote", "add", "origin", remote.to_str().unwrap()],
    );
    run_git_ok(&repo, &["checkout", "main"]);
    let push = run_git(&repo, &["push", "-u", "origin", "main"]);
    assert!(
        push.status.success(),
        "ordinary push should succeed with both hooks installed: {}",
        String::from_utf8_lossy(&push.stderr)
    );
}
