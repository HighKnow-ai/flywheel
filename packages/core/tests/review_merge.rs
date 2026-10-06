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

// ----- the three-half merge (plan_merge / run_merge / record_merge_event) -----

use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::ids::new_id;
use core::merge::{
    plan_merge, record_merge_event, run_merge, try_lock_epic, MergeOutcome, MergePlan,
    EVENT_MERGE_ABORTED, EVENT_TASK_INTEGRATED,
};
use rusqlite::{params, Connection};

struct Board {
    conn: Connection,
    actor: String,
    project_id: String,
    repo: tempfile::TempDir,
    b: common::ReviewBranches,
    epic_id: String,
}

/// A real repo with the review fixture, one epic whose integration branch is `flywheel/epic-int`
/// (set directly, as `review_diff.rs` does), and no tasks yet.
fn board() -> Board {
    let (mut conn, actor, project, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let epic = create_epic(&mut conn, &project.id, &actor, "An Epic", None).expect("epic");
    conn.execute(
        "UPDATE epics SET integration_branch = ?1 WHERE id = ?2",
        params![b.integration, epic.id],
    )
    .expect("set integration_branch");
    Board { conn, actor, project_id: project.id, repo, b, epic_id: epic.id }
}

impl Board {
    /// A task under the epic whose worktree row names `branch` (no real task worktree).
    fn task(&mut self, title: &str, branch: &str) -> String {
        let t = create_task(&mut self.conn, &self.project_id, &self.actor, title, Some(&self.epic_id))
            .expect("task");
        self.worktree_row(&t.id, branch, "/nonexistent/worktree");
        t.id
    }

    fn worktree_row(&self, task_id: &str, branch: &str, path: &str) {
        self.conn
            .execute(
                "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'main', 'active', ?6, '2026-01-01T00:00:00.000Z')",
                params![new_id(), task_id, self.project_id, path, branch, self.actor],
            )
            .expect("insert worktree row");
    }

    fn status_of(&self, task_id: &str) -> String {
        self.conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
            .expect("status")
    }

    fn event_count(&self, event_type: &str) -> i64 {
        self.conn
            .query_row("SELECT count(*) FROM events WHERE event_type = ?1", [event_type], |r| r.get(0))
            .expect("count")
    }

    fn total_events(&self) -> i64 {
        self.conn.query_row("SELECT count(*) FROM events", [], |r| r.get(0)).expect("count")
    }
}

#[test]
fn plan_merge_resolves_a_plan_for_a_task_under_an_epic() {
    with_scratch_worktree_root(|root| {
        let mut bd = board();
        let t = bd.task("Clean work", bd.b.task_clean);
        let plan = plan_merge(&bd.conn, &t).expect("plan");
        assert_eq!(plan.repo_path, bd.repo.path());
        assert_eq!(plan.source_branch, bd.b.task_clean);
        assert_eq!(plan.target_branch, bd.b.integration);
        assert_eq!((plan.commit_count, plan.file_count), (1, 1));
        let epic_key: String = bd
            .conn
            .query_row("SELECT key FROM epics WHERE id = ?1", [&bd.epic_id], |r| r.get(0))
            .unwrap();
        assert_eq!(plan.epic_worktree, root.join("FLY").join(epic_key));
    });
}

#[test]
fn plan_merge_refuses_an_epic_less_task_naming_the_request_path() {
    let mut bd = board();
    let t = create_task(&mut bd.conn, &bd.project_id, &bd.actor, "Loose", None).expect("task");
    bd.worktree_row(&t.id, bd.b.task_clean, "/nonexistent/worktree");
    let err = plan_merge(&bd.conn, &t.id).expect_err("must refuse");
    assert!(format!("{err:#}").contains("open-request path"), "error was: {err:#}");
}

#[test]
fn plan_merge_refuses_an_epic_with_no_integration_branch_and_cuts_none() {
    let mut bd = board();
    bd.conn.execute("UPDATE epics SET integration_branch = NULL WHERE id = ?1", [&bd.epic_id]).unwrap();
    let t = bd.task("Clean work", bd.b.task_clean);
    let err = plan_merge(&bd.conn, &t).expect_err("must refuse");
    assert!(format!("{err:#}").contains("no integration branch"), "error was: {err:#}");
    let still_null: Option<String> = bd
        .conn
        .query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&bd.epic_id], |r| r.get(0))
        .unwrap();
    assert_eq!(still_null, None);
    let epic_key: String =
        bd.conn.query_row("SELECT key FROM epics WHERE id = ?1", [&bd.epic_id], |r| r.get(0)).unwrap();
    let would_be = core::branch::epic_integration_branch_name(&epic_key, "An Epic");
    assert!(!rev_parse_verify(bd.repo.path(), &would_be).unwrap(), "no branch may be cut: {would_be}");
}

#[test]
fn plan_merge_refuses_a_task_with_no_worktree_row() {
    let mut bd = board();
    let t = create_task(&mut bd.conn, &bd.project_id, &bd.actor, "No branch", Some(&bd.epic_id)).unwrap();
    let err = plan_merge(&bd.conn, &t.id).expect_err("must refuse");
    assert!(format!("{err:#}").contains("no branch"), "error was: {err:#}");
}

#[test]
fn plan_merge_refuses_zero_commits_ahead_without_any_git_write() {
    let mut bd = board();
    let t = bd.task("Fresh branch", bd.b.integration);
    let refs_before = git(bd.repo.path(), &["for-each-ref"]);
    let err = plan_merge(&bd.conn, &t).expect_err("must refuse");
    assert!(format!("{err:#}").contains("nothing to merge"), "error was: {err:#}");
    assert_eq!(git(bd.repo.path(), &["for-each-ref"]), refs_before);
}

/// A task whose own worktree is a real checkout of its branch, so a merge can be shown not to
/// touch it.
fn task_with_real_worktree(bd: &mut Board, root: &Path, title: &str, branch: &str) -> (String, PathBuf) {
    let t = create_task(&mut bd.conn, &bd.project_id, &bd.actor, title, Some(&bd.epic_id)).expect("task");
    let wt = root.join("task-wt");
    worktree_add_existing(bd.repo.path(), &wt, branch).expect("task worktree");
    bd.worktree_row(&t.id, branch, wt.to_str().unwrap());
    (t.id, wt)
}

#[test]
fn run_merge_clean_creates_the_epic_worktree_and_a_merge_commit_and_spares_the_task_worktree() {
    with_scratch_worktree_root(|root| {
        let mut bd = board();
        let (t, task_wt) = task_with_real_worktree(&mut bd, root, "Clean work", "flywheel/task-clean");
        let plan = plan_merge(&bd.conn, &t).unwrap();
        assert!(!plan.epic_worktree.exists());
        let task_head = git(&task_wt, &["rev-parse", "HEAD"]);
        let task_file = std::fs::read(task_wt.join("other.txt")).unwrap();

        let outcome = run_merge(&plan).expect("run_merge");
        let MergeOutcome::Merged { merge_commit } = outcome else { panic!("expected Merged, got {outcome:?}") };

        assert!(plan.epic_worktree.exists());
        assert_eq!(git(&plan.epic_worktree, &["rev-parse", "HEAD"]), merge_commit);
        assert_eq!(parent_count(&plan.epic_worktree, "HEAD"), 2);
        assert_eq!(git(bd.repo.path(), &["rev-parse", bd.b.integration]), merge_commit);
        assert!(git(&plan.epic_worktree, &["log", "-1", "--format=%s"]).starts_with("Merge FLY-"));
        // the task's own worktree is untouched
        assert_eq!(git(&task_wt, &["rev-parse", "HEAD"]), task_head);
        assert_eq!(porcelain(&task_wt), "");
        assert_eq!(std::fs::read(task_wt.join("other.txt")).unwrap(), task_file);
    });
}

#[test]
fn run_merge_conflict_names_the_files_and_never_creates_the_epic_worktree() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let b2 = bd.task("B", bd.b.task_conflict_b);
        // land A in the integration branch from the repo itself, without an epic worktree
        git(bd.repo.path(), &["update-ref", &format!("refs/heads/{}", bd.b.integration), bd.b.task_conflict_a]);
        let plan = plan_merge(&bd.conn, &b2).unwrap();
        let refs_before = git(bd.repo.path(), &["for-each-ref"]);
        let outcome = run_merge(&plan).expect("a conflict is an outcome, not an error");
        assert_eq!(outcome, MergeOutcome::Conflicted { files: vec!["shared.txt".to_string()] });
        assert!(!plan.epic_worktree.exists(), "a conflicted dry run must not create the worktree");
        assert_eq!(git(bd.repo.path(), &["for-each-ref"]), refs_before);
    });
}

#[test]
fn run_merge_conflict_against_an_existing_epic_worktree_leaves_it_clean() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let a = bd.task("A", bd.b.task_conflict_a);
        let b2 = bd.task("B", bd.b.task_conflict_b);
        let plan_a = plan_merge(&bd.conn, &a).unwrap();
        assert!(matches!(run_merge(&plan_a).unwrap(), MergeOutcome::Merged { .. }));
        let head = git(&plan_a.epic_worktree, &["rev-parse", "HEAD"]);

        let plan_b = plan_merge(&bd.conn, &b2).unwrap();
        let outcome = run_merge(&plan_b).unwrap();
        assert!(matches!(outcome, MergeOutcome::Conflicted { .. }), "got {outcome:?}");
        assert_eq!(porcelain(&plan_b.epic_worktree), "");
        assert!(!merge_in_progress(&plan_b.epic_worktree));
        assert_eq!(git(&plan_b.epic_worktree, &["rev-parse", "HEAD"]), head);
    });
}

#[test]
fn run_merge_source_already_contained_is_already_integrated_with_no_new_commit() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let t = bd.task("Clean work", bd.b.task_clean);
        let plan = plan_merge(&bd.conn, &t).unwrap();
        assert!(matches!(run_merge(&plan).unwrap(), MergeOutcome::Merged { .. }));
        let head = git(&plan.epic_worktree, &["rev-parse", "HEAD"]);
        assert_eq!(run_merge(&plan).unwrap(), MergeOutcome::AlreadyIntegrated);
        assert_eq!(git(&plan.epic_worktree, &["rev-parse", "HEAD"]), head, "no new commit");
    });
}

#[test]
fn run_merge_recovers_a_merge_left_in_progress_by_a_previous_run() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let a = bd.task("A", bd.b.task_conflict_a);
        let clean = bd.task("Clean", bd.b.task_clean);
        let plan_a = plan_merge(&bd.conn, &a).unwrap();
        assert!(matches!(run_merge(&plan_a).unwrap(), MergeOutcome::Merged { .. }));
        // a crashed run leaves a conflicting merge mid-flight in the epic worktree
        let wt = &plan_a.epic_worktree;
        let out = Command::new("git")
            .arg("-C")
            .arg(wt)
            .args(["merge", "--no-ff", "-m", "x", bd.b.task_conflict_b])
            .output()
            .unwrap();
        assert!(!out.status.success());
        assert!(merge_in_progress(wt));

        let plan = plan_merge(&bd.conn, &clean).unwrap();
        let outcome = run_merge(&plan).expect("recovery then merge");
        assert!(matches!(outcome, MergeOutcome::Merged { .. }), "got {outcome:?}");
        assert!(!merge_in_progress(wt));
        assert_eq!(porcelain(wt), "");
    });
}

#[test]
fn run_merge_refuses_a_dirty_epic_worktree_without_attempting_a_merge() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let a = bd.task("A", bd.b.task_conflict_a);
        let clean = bd.task("Clean", bd.b.task_clean);
        let plan_a = plan_merge(&bd.conn, &a).unwrap();
        run_merge(&plan_a).unwrap();
        std::fs::write(plan_a.epic_worktree.join("stray.txt"), "dirty\n").unwrap();
        let head = git(&plan_a.epic_worktree, &["rev-parse", "HEAD"]);

        let plan = plan_merge(&bd.conn, &clean).unwrap();
        let err = run_merge(&plan).expect_err("must refuse");
        assert!(format!("{err:#}").contains("uncommitted"), "error was: {err:#}");
        assert_eq!(git(&plan_a.epic_worktree, &["rev-parse", "HEAD"]), head);
        assert!(!merge_in_progress(&plan_a.epic_worktree));
    });
}

fn merged_plan(bd: &mut Board, title: &str, branch: &str) -> (String, MergePlan, MergeOutcome) {
    let t = bd.task(title, branch);
    let plan = plan_merge(&bd.conn, &t).unwrap();
    let outcome = run_merge(&plan).unwrap();
    (t, plan, outcome)
}

#[test]
fn record_merge_event_success_writes_one_event_and_moves_no_status() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let (t, plan, outcome) = merged_plan(&mut bd, "Clean work", "flywheel/task-clean");
        let status_before = bd.status_of(&t);
        let epic_status = |bd: &Board| -> String {
            bd.conn.query_row("SELECT status FROM epics WHERE id = ?1", [&bd.epic_id], |r| r.get(0)).unwrap()
        };
        let epic_before = epic_status(&bd);

        record_merge_event(&mut bd.conn, &plan, &outcome, &bd.actor.clone()).expect("record");

        assert_eq!(bd.event_count(EVENT_TASK_INTEGRATED), 1);
        let payload: String = bd
            .conn
            .query_row("SELECT payload FROM events WHERE event_type = ?1", [EVENT_TASK_INTEGRATED], |r| r.get(0))
            .unwrap();
        let v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let MergeOutcome::Merged { merge_commit } = &outcome else { panic!() };
        assert_eq!(v["merge_commit"], serde_json::json!(merge_commit));
        assert_eq!(v["source_branch"], "flywheel/task-clean");
        assert_eq!(v["target_branch"], "flywheel/epic-int");
        assert_eq!((v["commit_count"].as_u64(), v["file_count"].as_u64()), (Some(1), Some(1)));
        assert!(v["label"].is_string(), "the activity trail renders the label key");
        assert_eq!(bd.status_of(&t), status_before, "a merge moves no task status");
        assert_eq!(epic_status(&bd), epic_before, "a merge moves no epic status");
    });
}

#[test]
fn record_merge_event_conflict_writes_one_aborted_event_and_moves_no_status() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let (_a, _pa, _oa) = merged_plan(&mut bd, "A", "flywheel/task-conflict-a");
        let (b2, plan, outcome) = merged_plan(&mut bd, "B", "flywheel/task-conflict-b");
        assert!(matches!(outcome, MergeOutcome::Conflicted { .. }));
        let status_before = bd.status_of(&b2);

        record_merge_event(&mut bd.conn, &plan, &outcome, &bd.actor.clone()).expect("record");

        assert_eq!(bd.event_count(EVENT_MERGE_ABORTED), 1);
        assert_eq!(bd.event_count(EVENT_TASK_INTEGRATED), 0);
        assert_eq!(bd.status_of(&b2), status_before);
    });
}

#[test]
fn record_merge_event_already_integrated_writes_nothing() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let (_t, plan, _o) = merged_plan(&mut bd, "Clean work", "flywheel/task-clean");
        let before = bd.total_events();
        record_merge_event(&mut bd.conn, &plan, &MergeOutcome::AlreadyIntegrated, &bd.actor.clone()).unwrap();
        assert_eq!(bd.total_events(), before);
    });
}

#[test]
fn epic_merge_lock_is_exclusive_and_released_on_drop() {
    let epic = new_id();
    let guard = try_lock_epic(&epic).expect("a free epic id takes the lock");
    assert!(try_lock_epic(&epic).is_none(), "a held epic id must not be lockable again");
    assert!(try_lock_epic(&new_id()).is_some(), "other epics are independent");
    drop(guard);
    assert!(try_lock_epic(&epic).is_some(), "dropping the guard frees the epic");
}

#[test]
fn two_sequential_merges_into_one_epic_both_land_and_both_tips_are_reachable() {
    with_scratch_worktree_root(|_root| {
        let mut bd = board();
        let t1 = bd.task("Clean", bd.b.task_clean);
        let t2 = bd.task("Rich", bd.b.task_rich);
        for t in [&t1, &t2] {
            let _guard = try_lock_epic(&bd.epic_id).expect("lock is free between merges");
            let plan = plan_merge(&bd.conn, t).unwrap();
            let outcome = run_merge(&plan).unwrap();
            assert!(matches!(outcome, MergeOutcome::Merged { .. }), "got {outcome:?}");
        }
        for tip in [bd.b.task_clean, bd.b.task_rich] {
            let ok = Command::new("git")
                .arg("-C")
                .arg(bd.repo.path())
                .args(["merge-base", "--is-ancestor", tip, bd.b.integration])
                .status()
                .unwrap()
                .success();
            assert!(ok, "{tip} must be reachable from the integration head");
        }
    });
}
