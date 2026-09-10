//! Table-driven coverage of `branch::task_branch_name`/`epic_integration_branch_name` (LINK-01)
//! and `domain::worktree::base_ref_for_task`'s two-shape resolution (D-25, D-26, WORK-02) —
//! plan 02-01 Task 2.

mod common;

use core::branch::{epic_integration_branch_name, task_branch_name};
use core::domain::epic::{create_epic, ensure_epic_integration_branch};
use core::domain::task::create_task;
use core::domain::worktree::base_ref_for_task;
use core::git::rev_parse_verify;

#[test]
fn task_branch_name_covers_every_behavior_case() {
    let cases: &[(&str, &str, &str)] = &[
        ("THRE-142", "FTS5 search and filters", "flywheel/thre-142-fts5-search-and-filters"),
        ("THRE-9", "", "flywheel/thre-9"),
        ("THRE-9", "!!! ??? ***", "flywheel/thre-9"),
        ("THRE-9", "Café — naïve façade", "flywheel/thre-9-caf-nave-faade"),
    ];
    for (key, title, expected) in cases {
        assert_eq!(
            task_branch_name(key, title),
            *expected,
            "task_branch_name({key:?}, {title:?})"
        );
    }
}

#[test]
fn task_branch_name_truncates_a_long_title_to_at_most_200_bytes_ending_alphanumeric() {
    let long_title: String = std::iter::repeat("word ").take(80).collect(); // 400 chars
    let name = task_branch_name("THRE-9", &long_title);
    assert!(name.len() <= 200, "expected at most 200 bytes, got {}", name.len());
    let last_char = name.chars().last().expect("name should not be empty");
    assert!(
        last_char.is_ascii_alphanumeric(),
        "expected the name to end in an alphanumeric character, got {name:?}"
    );
    assert!(!name.ends_with('-'), "name must never end in a hyphen, got {name:?}");
}

#[test]
fn task_branch_name_carries_the_numeric_suffix_verbatim() {
    let name = task_branch_name("THRE-007", "x");
    assert!(
        name.contains("thre-007"),
        "expected the literal 'thre-007' in {name:?} — the numeric suffix must not be renormalised"
    );
}

#[test]
fn epic_integration_branch_name_matches_d25() {
    assert_eq!(
        epic_integration_branch_name("THRE-3", "Search and filters"),
        "flywheel/epic/thre-3-search-and-filters"
    );
}

#[test]
fn two_tasks_with_identical_titles_in_one_project_get_different_branch_names() {
    let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
    let task_a = create_task(&mut conn, &project.id, &actor_id, "Same Title", None)
        .expect("create_task a should succeed");
    let task_b = create_task(&mut conn, &project.id, &actor_id, "Same Title", None)
        .expect("create_task b should succeed");

    let branch_a = task_branch_name(&task_a.key, &task_a.title);
    let branch_b = task_branch_name(&task_b.key, &task_b.title);
    assert_ne!(branch_a, branch_b, "distinct task keys must produce distinct branch names");
}

#[test]
fn base_ref_for_task_with_no_epic_returns_the_project_default_branch() {
    let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "No epic task", None)
        .expect("create_task should succeed");

    let base_ref = base_ref_for_task(&mut conn, &task.id, &actor_id).expect("base_ref_for_task should succeed");
    assert_eq!(base_ref, project.default_branch);
}

#[test]
fn base_ref_for_task_with_an_epic_lazily_cuts_the_integration_branch_once() {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let epic =
        create_epic(&mut conn, &project.id, &actor_id, "An epic", None).expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Epic task", Some(&epic.id))
        .expect("create_task should succeed");

    let expected_branch = epic_integration_branch_name(&epic.key, &epic.title);

    // Before resolution, the branch does not exist in the repository yet (lazy cut).
    assert!(!rev_parse_verify(repo_dir.path(), &expected_branch).unwrap());

    let base_ref_first = base_ref_for_task(&mut conn, &task.id, &actor_id).expect("first resolution should succeed");
    assert_eq!(base_ref_first, expected_branch);
    assert!(rev_parse_verify(repo_dir.path(), &expected_branch).unwrap());

    let (integration_branch,): (Option<String>,) = conn
        .query_row(
            "SELECT integration_branch FROM epics WHERE id = ?1",
            rusqlite::params![epic.id],
            |row| Ok((row.get(0)?,)),
        )
        .expect("epic row should exist");
    assert_eq!(integration_branch.as_deref(), Some(expected_branch.as_str()));

    // A second resolution returns the stored value and cuts nothing a second time — asserted by
    // the ref count staying exactly the same (one `git branch` invocation total).
    let ref_count_before = git_branch_count(repo_dir.path());
    let base_ref_second =
        base_ref_for_task(&mut conn, &task.id, &actor_id).expect("second resolution should succeed");
    assert_eq!(base_ref_second, expected_branch);
    let ref_count_after = git_branch_count(repo_dir.path());
    assert_eq!(
        ref_count_before, ref_count_after,
        "a second resolution must not cut a second branch"
    );

    // ensure_epic_integration_branch itself is also idempotent when called directly a second time.
    let direct_second_call =
        ensure_epic_integration_branch(&mut conn, &epic.id, &actor_id).expect("direct call should succeed");
    assert_eq!(direct_second_call, expected_branch);
}

fn git_branch_count(repo_path: &std::path::Path) -> usize {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["branch", "--list"])
        .output()
        .expect("failed to list branches");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|l| !l.trim().is_empty())
        .count()
}

#[test]
fn ensure_worktree_refuses_when_the_derived_branch_already_exists() {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let worktree_root_dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: single-threaded test, cleared at the end.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root_dir.path()) };

    let task = create_task(&mut conn, &project.id, &actor_id, "Collision task", None)
        .expect("create_task should succeed");
    let branch = task_branch_name(&task.key, &task.title);

    // Pre-create the branch by hand, out from under `ensure_worktree` — a real collision, not a
    // simulated one.
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_dir.path())
        .args(["branch", &branch])
        .status()
        .expect("failed to pre-create the colliding branch");
    assert!(status.success());

    let result = core::domain::worktree::ensure_worktree(&mut conn, &task.id, &actor_id);
    assert!(result.is_err(), "ensure_worktree should refuse when the branch already exists");
    // `anyhow::Error::to_string()` only prints the top-level context — the `{:?}` Debug impl
    // prints the full "Caused by:" chain, so a wrapped ("failed to create worktree for task ...")
    // outer message doesn't hide the inner "branch already exists" cause this assertion cares
    // about.
    let full_message = format!("{:?}", result.unwrap_err());
    assert!(
        full_message.contains(&branch),
        "expected the error chain to name the existing ref {branch:?}, got: {full_message}"
    );

    // SAFETY: see the set_var call above.
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
}
