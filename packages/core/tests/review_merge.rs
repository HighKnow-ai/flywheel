//! REVW-04 against real git repositories (Phase 8 plan 08-03): the merge primitives, the
//! three-half merge, the per-epic lock and the integrated marker.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use core::git::{
    merge_abort_if_in_progress, merge_no_ff, merge_tree_check, push_branch, rev_parse_verify,
    worktree_add_existing, MergePrecheck,
};

/// Serializes every test that sets `FLYWHEEL_WORKTREE_ROOT` (process-global state), mirroring
/// `forge_live_chain.rs`'s lock.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK`; always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f(dir.path());
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Direct git for fixtures and assertions (the cwd gate scans only `src` trees).
fn git(path: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn porcelain(path: &Path) -> String {
    git(path, &["status", "--porcelain"])
}

fn merge_in_progress(path: &Path) -> bool {
    Command::new("git")
        .arg("-C")
        .arg(path)
        .args(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"])
        .status()
        .expect("spawn git")
        .success()
}

fn parent_count(path: &Path, rev: &str) -> usize {
    git(path, &["rev-list", "--parents", "-n", "1", rev]).split_whitespace().count() - 1
}

/// A repo with the review fixture plus a linked worktree for `branch` under `root`.
fn repo_with_worktree(root: &Path, branch: &str) -> (tempfile::TempDir, common::ReviewBranches, PathBuf) {
    let (_conn, _actor, _project, repo_dir) = common::seeded_git_project();
    let b = common::review_branches(repo_dir.path());
    let wt = root.join("wt");
    worktree_add_existing(repo_dir.path(), &wt, branch).expect("worktree_add_existing");
    (repo_dir, b, wt)
}

// ----- git-level: merge_tree_check -----

#[test]
fn merge_tree_check_clean_pair_is_clean() {
    let (_c, _a, _p, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let got = merge_tree_check(repo.path(), b.task_rich, b.task_clean).expect("merge_tree_check");
    assert_eq!(got, MergePrecheck::Clean);
}

#[test]
fn merge_tree_check_conflict_names_each_path_once_sorted() {
    let (_c, _a, _p, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let got =
        merge_tree_check(repo.path(), b.task_conflict_a, b.task_conflict_b).expect("merge_tree_check");
    assert_eq!(got, MergePrecheck::Conflicts(vec!["shared.txt".to_string()]));
}

#[test]
fn merge_tree_check_leaves_the_repository_untouched() {
    with_scratch_worktree_root(|root| {
        let (repo, b, wt) = repo_with_worktree(root, "flywheel/task-conflict-a");
        let refs_before = git(repo.path(), &["for-each-ref"]);
        let head_before = git(&wt, &["rev-parse", "HEAD"]);
        let got = merge_tree_check(&wt, b.task_conflict_a, b.task_conflict_b).expect("check");
        assert!(matches!(got, MergePrecheck::Conflicts(_)));
        assert_eq!(git(repo.path(), &["for-each-ref"]), refs_before, "no ref may move");
        assert_eq!(git(&wt, &["rev-parse", "HEAD"]), head_before);
        assert_eq!(porcelain(&wt), "", "the worktree must be porcelain-clean afterwards");
        assert!(!merge_in_progress(&wt));
    });
}

#[test]
fn merge_tree_check_source_already_contained_is_clean() {
    let (_c, _a, _p, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    // the integration branch is an ancestor of every task branch
    let got = merge_tree_check(repo.path(), b.task_clean, b.integration).expect("check");
    assert_eq!(got, MergePrecheck::Clean);
}

#[test]
fn merge_tree_check_nonexistent_ref_is_an_error_not_a_conflict() {
    let (_c, _a, _p, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    assert!(merge_tree_check(repo.path(), b.integration, "flywheel/no-such-branch").is_err());
}

// ----- git-level: merge_no_ff / abort -----

#[test]
fn merge_no_ff_creates_a_merge_commit_even_where_a_fast_forward_was_possible() {
    with_scratch_worktree_root(|root| {
        let (_repo, b, wt) = repo_with_worktree(root, "flywheel/epic-int");
        let before = git(&wt, &["rev-parse", "HEAD"]);
        let committed = merge_no_ff(&wt, b.task_clean, "Merge clean into int").expect("merge");
        assert!(committed);
        assert_ne!(git(&wt, &["rev-parse", "HEAD"]), before);
        assert_eq!(parent_count(&wt, "HEAD"), 2, "a --no-ff merge always has two parents");
        assert_eq!(porcelain(&wt), "");
    });
}

#[test]
fn merge_no_ff_source_already_contained_creates_no_commit() {
    with_scratch_worktree_root(|root| {
        let (_repo, b, wt) = repo_with_worktree(root, "flywheel/task-clean");
        let before = git(&wt, &["rev-parse", "HEAD"]);
        let committed = merge_no_ff(&wt, b.integration, "noop").expect("merge");
        assert!(!committed);
        assert_eq!(git(&wt, &["rev-parse", "HEAD"]), before);
    });
}

#[test]
fn merge_no_ff_conflict_rolls_back_and_leaves_the_worktree_clean() {
    with_scratch_worktree_root(|root| {
        let (_repo, b, wt) = repo_with_worktree(root, "flywheel/task-conflict-a");
        let before = git(&wt, &["rev-parse", "HEAD"]);
        let err = merge_no_ff(&wt, b.task_conflict_b, "will conflict").expect_err("must fail");
        assert!(format!("{err:#}").contains("rolled back"), "error was: {err:#}");
        assert!(!merge_in_progress(&wt), "no in-progress merge marker may survive");
        assert_eq!(porcelain(&wt), "");
        assert_eq!(git(&wt, &["rev-parse", "HEAD"]), before);
    });
}

#[test]
fn merge_abort_if_in_progress_clears_a_hand_built_merge() {
    with_scratch_worktree_root(|root| {
        let (_repo, b, wt) = repo_with_worktree(root, "flywheel/task-conflict-a");
        // start a conflicting merge directly and leave it behind, as a crash would
        let status = Command::new("git")
            .arg("-C")
            .arg(&wt)
            .args(["merge", "--no-ff", "-m", "x", b.task_conflict_b])
            .output()
            .expect("spawn");
        assert!(!status.status.success());
        assert!(merge_in_progress(&wt), "the fixture must really be mid-merge");

        assert!(merge_abort_if_in_progress(&wt).expect("abort"), "it must report that it aborted");
        assert!(!merge_in_progress(&wt));
        assert_eq!(porcelain(&wt), "");
    });
}

#[test]
fn merge_abort_if_in_progress_on_a_clean_worktree_reports_nothing_to_abort() {
    with_scratch_worktree_root(|root| {
        let (_repo, _b, wt) = repo_with_worktree(root, "flywheel/epic-int");
        assert!(!merge_abort_if_in_progress(&wt).expect("clean is not an error"));
    });
}

#[test]
fn merge_abort_if_in_progress_names_the_path_when_the_tree_is_still_dirty() {
    with_scratch_worktree_root(|root| {
        let (_repo, _b, wt) = repo_with_worktree(root, "flywheel/epic-int");
        std::fs::write(wt.join("stray.txt"), "left behind\n").expect("write stray");
        let err = merge_abort_if_in_progress(&wt).expect_err("a dirty tree is a loud error");
        let text = format!("{err:#}");
        assert!(text.contains("not clean") && text.contains("wt"), "error was: {text}");
    });
}

// ----- git-level: worktree_add_existing -----

#[test]
fn worktree_add_existing_checks_out_an_existing_branch_and_refuses_bad_paths() {
    with_scratch_worktree_root(|root| {
        let (repo, _b, wt) = repo_with_worktree(root, "flywheel/epic-int");
        assert_eq!(git(&wt, &["rev-parse", "--abbrev-ref", "HEAD"]), "flywheel/epic-int");

        let same = worktree_add_existing(repo.path(), repo.path(), "flywheel/task-clean");
        assert!(same.is_err(), "a path equal to the repository path is refused");

        let outside = tempfile::tempdir().expect("outside dir");
        let err = worktree_add_existing(repo.path(), &outside.path().join("w"), "flywheel/task-clean");
        assert!(err.is_err(), "a path outside the worktree root is refused");
        assert!(!outside.path().join("w").exists());
    });
}

// ----- git-level: push_branch -----

fn bare_remote(repo: &Path) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().expect("remote dir");
    let remote = dir.path().join("remote.git");
    git(repo, &["init", "--bare", remote.to_str().unwrap()]);
    git(repo, &["remote", "add", "origin", remote.to_str().unwrap()]);
    (dir, remote)
}

#[test]
fn push_branch_pushes_and_the_remote_ref_matches_the_local_tip() {
    let (_c, _a, _p, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let (_keep, remote) = bare_remote(repo.path());
    push_branch(repo.path(), "origin", b.integration).expect("push");
    assert_eq!(
        git(&remote, &["rev-parse", b.integration]),
        git(repo.path(), &["rev-parse", b.integration])
    );
}

#[test]
fn push_branch_names_a_rejected_non_fast_forward_and_leaves_the_remote_alone() {
    let (_c, _a, _p, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let (keep, remote) = bare_remote(repo.path());
    push_branch(repo.path(), "origin", b.integration).expect("first push");

    // another clone advances the remote branch
    let other = keep.path().join("other");
    git(keep.path(), &["clone", "--quiet", remote.to_str().unwrap(), other.to_str().unwrap()]);
    git(&other, &["config", "user.email", "o@flywheel.test"]);
    git(&other, &["config", "user.name", "Other"]);
    git(&other, &["checkout", "--quiet", b.integration]);
    std::fs::write(other.join("remote_only.txt"), "remote\n").unwrap();
    git(&other, &["add", "remote_only.txt"]);
    git(&other, &["commit", "--quiet", "-m", "remote advance"]);
    git(&other, &["push", "--quiet", "origin", b.integration]);
    let remote_tip = git(&remote, &["rev-parse", b.integration]);

    // the local branch diverges, so a plain push must be refused
    git(repo.path(), &["checkout", "--quiet", b.integration]);
    std::fs::write(repo.path().join("local_only.txt"), "local\n").unwrap();
    git(repo.path(), &["add", "local_only.txt"]);
    git(repo.path(), &["commit", "--quiet", "-m", "local advance"]);

    let err = push_branch(repo.path(), "origin", b.integration).expect_err("must be rejected");
    assert!(format!("{err:#}").contains("rejected"), "error was: {err:#}");
    assert_eq!(git(&remote, &["rev-parse", b.integration]), remote_tip, "remote must be unchanged");
    assert!(rev_parse_verify(repo.path(), b.integration).unwrap());
}
