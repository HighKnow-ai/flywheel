//! REVW-01 / REVW-02 against a real git repository with diverging branches (Phase 8 plan 08-01).

mod common;

use std::path::Path;

use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::git::{git_output_at, review_files, review_patch, ReviewFile};
use core::ids::new_id;
use core::review::{
    resolve_review_target, review_file_list, review_file_patch, ReviewScope, ReviewTarget,
};
use rusqlite::{params, Connection};

fn rich_files() -> Vec<ReviewFile> {
    let (_conn, _actor, project, repo_dir) = common::seeded_git_project();
    let b = common::review_branches(repo_dir.path());
    let _ = project;
    review_files(repo_dir.path(), b.integration, b.task_rich).expect("review_files")
}

fn find<'a>(files: &'a [ReviewFile], path: &str) -> &'a ReviewFile {
    files
        .iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("{path} missing from {files:?}"))
}

#[test]
fn git_output_at_refuses_empty_repo_path_and_empty_args() {
    assert!(git_output_at(Path::new(""), &["status"]).is_err());
    assert!(git_output_at(Path::new("."), &[]).is_err());
}

#[test]
fn git_output_at_returns_output_for_a_non_zero_exit() {
    let (_conn, _actor, _project, repo_dir) = common::seeded_git_project();
    let out = git_output_at(repo_dir.path(), &["rev-parse", "--verify", "--quiet", "nope"])
        .expect("a non-zero exit is an Output, not an Err");
    assert!(!out.status.success());
}

#[test]
fn modified_file_has_status_m_and_counts() {
    let files = rich_files();
    let keep = find(&files, "keep.txt");
    assert_eq!(keep.status, "M");
    assert_eq!((keep.added, keep.removed), (Some(1), Some(1)));
    assert_eq!(keep.old_path, None);
    assert!(!keep.binary);
}

#[test]
fn added_and_deleted_files_have_status_a_and_d() {
    let files = rich_files();
    assert_eq!(find(&files, "added.txt").status, "A");
    assert_eq!(find(&files, "gone.txt").status, "D");
}

#[test]
fn renamed_file_has_status_r_and_the_old_path() {
    let files = rich_files();
    let renamed = find(&files, "new_name.txt");
    assert_eq!(renamed.status, "R");
    assert_eq!(renamed.old_path.as_deref(), Some("old_name.txt"));
    assert!(files.iter().all(|f| f.path != "old_name.txt"), "rename must be one entry: {files:?}");
}

#[test]
fn binary_file_has_no_counts() {
    let files = rich_files();
    let bin = find(&files, "image.bin");
    assert!(bin.binary);
    assert_eq!((bin.added, bin.removed), (None, None));
}

#[test]
fn path_with_a_space_survives_intact() {
    let files = rich_files();
    assert_eq!(find(&files, "with space.txt").status, "A");
}

#[test]
fn rename_patch_carries_the_rename_header_when_both_paths_are_passed() {
    let (_conn, _actor, _project, repo_dir) = common::seeded_git_project();
    let b = common::review_branches(repo_dir.path());
    let patch = review_patch(
        repo_dir.path(),
        b.integration,
        b.task_rich,
        "new_name.txt",
        Some("old_name.txt"),
    )
    .expect("review_patch");
    assert!(patch.contains("rename from old_name.txt"), "patch was: {patch}");

    let lost = review_patch(repo_dir.path(), b.integration, b.task_rich, "new_name.txt", None)
        .expect("review_patch");
    assert!(lost.contains("new file mode"), "documents why the old path is needed: {lost}");
}

#[test]
fn binary_patch_is_the_binary_differ_line_with_no_hunk() {
    let (_conn, _actor, _project, repo_dir) = common::seeded_git_project();
    let b = common::review_branches(repo_dir.path());
    let patch = review_patch(repo_dir.path(), b.integration, b.task_rich, "image.bin", None)
        .expect("review_patch");
    assert!(patch.contains("Binary files"), "patch was: {patch}");
    assert!(!patch.contains("@@"));
}

#[test]
fn patch_refuses_an_empty_path_and_a_nul_byte() {
    let (_conn, _actor, _project, repo_dir) = common::seeded_git_project();
    let p = repo_dir.path();
    assert!(review_patch(p, "main", "main", "", None).is_err());
    assert!(review_patch(p, "main", "main", "a\0b", None).is_err());
    assert!(review_patch(p, "main", "main", "a", Some("b\0c")).is_err());
}

struct Board {
    conn: Connection,
    _repo: tempfile::TempDir,
    branches: common::ReviewBranches,
    epic_id: String,
    task_in_epic: String,
    task_no_epic: String,
    actor: String,
}

fn insert_worktree(conn: &Connection, task_id: &str, project_id: &str, actor: &str, branch: &str) {
    conn.execute(
        "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
         VALUES (?1, ?2, ?3, '/nonexistent/worktree', ?4, 'main', 'active', ?5, '2026-01-01T00:00:00.000Z')",
        params![new_id(), task_id, project_id, branch, actor],
    )
    .expect("insert worktree row");
}

fn board(set_integration: bool) -> Board {
    let (mut conn, actor, project, repo_dir) = common::seeded_git_project();
    let branches = common::review_branches(repo_dir.path());
    let epic = create_epic(&mut conn, &project.id, &actor, "An Epic", None).expect("epic");
    if set_integration {
        conn.execute(
            "UPDATE epics SET integration_branch = ?1 WHERE id = ?2",
            params![branches.integration, epic.id],
        )
        .expect("set integration_branch");
    }
    let t1 = create_task(&mut conn, &project.id, &actor, "In epic", Some(&epic.id)).expect("task");
    let t2 = create_task(&mut conn, &project.id, &actor, "No epic", None).expect("task");
    insert_worktree(&conn, &t1.id, &project.id, &actor, branches.task_rich);
    insert_worktree(&conn, &t2.id, &project.id, &actor, branches.integration);
    Board {
        conn,
        _repo: repo_dir,
        branches,
        epic_id: epic.id,
        task_in_epic: t1.id,
        task_no_epic: t2.id,
        actor,
    }
}

fn resolved(t: ReviewTarget) -> (String, String) {
    match t {
        ReviewTarget::Resolved { base, head, .. } => (base, head),
        other => panic!("expected Resolved, got {other:?}"),
    }
}

#[test]
fn task_under_an_epic_resolves_to_the_integration_branch_with_no_remote_prefix() {
    let b = board(true);
    let (base, head) =
        resolved(resolve_review_target(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap());
    assert_eq!(base, b.branches.integration);
    assert_eq!(head, b.branches.task_rich);
}

#[test]
fn task_with_no_epic_resolves_against_the_default_branch() {
    let b = board(true);
    let (base, head) =
        resolved(resolve_review_target(&b.conn, ReviewScope::Task, &b.task_no_epic).unwrap());
    assert_eq!(base, "main");
    assert_eq!(head, b.branches.integration);
}

#[test]
fn epic_resolves_integration_branch_against_the_default_branch() {
    let b = board(true);
    let (base, head) =
        resolved(resolve_review_target(&b.conn, ReviewScope::Epic, &b.epic_id).unwrap());
    assert_eq!(base, "main");
    assert_eq!(head, b.branches.integration);
}

#[test]
fn epic_with_a_null_integration_branch_is_typed_and_stays_null() {
    let b = board(false);
    let target = resolve_review_target(&b.conn, ReviewScope::Epic, &b.epic_id).unwrap();
    assert_eq!(target, ReviewTarget::NoIntegrationBranch);
    let task_target = resolve_review_target(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    assert_eq!(task_target, ReviewTarget::NoIntegrationBranch);

    let col: Option<String> = b
        .conn
        .query_row("SELECT integration_branch FROM epics WHERE id = ?1", params![b.epic_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(col, None, "reading must not cut a branch");
}

#[test]
fn task_with_no_worktree_row_is_no_branch() {
    let b = board(true);
    b.conn.execute("DELETE FROM worktrees WHERE task_id = ?1", params![b.task_in_epic]).unwrap();
    let target = resolve_review_target(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    assert_eq!(target, ReviewTarget::NoBranch);
}

#[test]
fn consecutive_file_lists_are_byte_identical_and_patch_passes_through() {
    let b = board(true);
    let (_, first) = review_file_list(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    let (_, second) = review_file_list(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    assert!(!first.is_empty());
    assert_eq!(format!("{first:?}"), format!("{second:?}"));

    let patch = review_file_patch(&b.conn, ReviewScope::Task, &b.task_in_epic, "keep.txt", None)
        .unwrap()
        .expect("resolved target yields a patch");
    assert!(patch.contains("CHANGED"));

    b.conn.execute("DELETE FROM worktrees WHERE task_id = ?1", params![b.task_in_epic]).unwrap();
    assert_eq!(
        review_file_patch(&b.conn, ReviewScope::Task, &b.task_in_epic, "keep.txt", None).unwrap(),
        None
    );
}

/// Land `task_rich` in the integration branch with a real two-parent merge commit (built with
/// plumbing so no epic worktree is needed), and record it the way the command layer does.
fn integrate(b: &mut Board) -> String {
    let repo = b._repo.path();
    let plan = core::merge::plan_merge(&b.conn, &b.task_in_epic).expect("plan_merge");
    let tree = git_output_at(repo, &["merge-tree", "--write-tree", b.branches.integration, b.branches.task_rich])
        .expect("merge-tree");
    let tree = String::from_utf8_lossy(&tree.stdout).lines().next().unwrap().to_string();
    let commit = git_output_at(
        repo,
        &["commit-tree", &tree, "-p", b.branches.integration, "-p", b.branches.task_rich, "-m", "merge"],
    )
    .expect("commit-tree");
    let commit = String::from_utf8_lossy(&commit.stdout).trim().to_string();
    git_output_at(
        repo,
        &["update-ref", &format!("refs/heads/{}", b.branches.integration), &commit],
    )
    .expect("update-ref");
    core::merge::record_merge_event(
        &mut b.conn,
        &plan,
        &core::merge::MergeOutcome::Merged { merge_commit: commit.clone() },
        &b.actor,
    )
    .expect("record");
    commit
}

#[test]
fn an_integrated_task_is_reviewed_as_the_merge_commit_against_its_first_parent() {
    let mut b = board(true);
    let before = review_file_list(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    assert!(!before.1.is_empty(), "the unmerged task has changes to review");
    assert!(matches!(before.0, ReviewTarget::Resolved { post_merge: false, .. }));

    let commit = integrate(&mut b);

    // The trap: the three-dot range between the integration branch and the task branch is empty
    // once merged, so a surface reading only that range would say "no changes".
    let stale = review_files(b._repo.path(), b.branches.integration, b.branches.task_rich).unwrap();
    assert!(stale.is_empty(), "the ordinary range is empty after a merge: {stale:?}");

    let (target, files) = review_file_list(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    match target {
        ReviewTarget::Resolved { base, head, post_merge, .. } => {
            assert!(post_merge);
            assert_eq!(head, commit);
            assert_eq!(base, format!("{commit}^1"));
        }
        other => panic!("expected Resolved, got {other:?}"),
    }
    assert!(!files.is_empty(), "an integrated task still shows what the merge landed");
    let paths: Vec<_> = files.iter().map(|f| f.path.clone()).collect();
    let expected: Vec<_> = before.1.iter().map(|f| f.path.clone()).collect();
    assert_eq!(paths, expected, "the merge landed exactly the task's changes");
}

#[test]
fn a_recorded_merge_commit_that_no_longer_resolves_falls_back_to_the_ordinary_range() {
    let mut b = board(true);
    integrate(&mut b);
    // Rewrite history: the integration branch no longer contains the recorded merge commit.
    git_output_at(
        b._repo.path(),
        &["update-ref", &format!("refs/heads/{}", b.branches.integration), "main"],
    )
    .unwrap();
    let (target, files) = review_file_list(&b.conn, ReviewScope::Task, &b.task_in_epic).unwrap();
    assert!(matches!(target, ReviewTarget::Resolved { post_merge: false, .. }));
    assert!(!files.is_empty());
}
