//! WORK-03 integration coverage (D-41/D-42/D-43): a real git repository, a real worktree, and the
//! full `remove_worktree_for_task`/`porcelain_entries` round trip — one test per `<behavior>`
//! bullet in `03-01-PLAN.md` Task 1.

mod common;

use std::path::Path;

use core::domain::task::create_task;
use core::domain::worktree::{ensure_worktree, porcelain_entries, remove_worktree_for_task};

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT`
/// is process-global mutable state and `cargo test` runs `#[test]` functions concurrently by
/// default (mirrors `stop_lifecycle.rs`'s own guard; never the unguarded pattern
/// `worktree_lifecycle.rs` still carries — this plan's own `<action>` names that as broken window
/// #2).
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

#[test]
fn removing_a_clean_worktree_deletes_it_from_disk_and_the_database_and_appends_one_event() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Removal task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let worktree_path = worktree.path.clone();

        assert!(Path::new(&worktree_path).exists(), "the worktree must exist before removal");

        remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect("removing a clean worktree must succeed");

        assert!(!Path::new(&worktree_path).exists(), "the worktree directory must be gone from disk");

        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE id = ?1",
                rusqlite::params![worktree.id],
                |row| row.get(0),
            )
            .expect("failed to count worktrees rows");
        assert_eq!(row_count, 0, "the worktrees row must be gone from the database");

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'worktree.removed' AND stream_id = ?1",
                rusqlite::params![worktree.id],
                |row| row.get(0),
            )
            .expect("failed to count worktree.removed events");
        assert_eq!(event_count, 1, "exactly one worktree.removed event must be appended");
    });
}

#[test]
fn removing_a_worktree_with_a_modified_file_is_refused_and_leaves_everything_in_place() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Dirty task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let readme = Path::new(&worktree.path).join("README.md");
        std::fs::write(&readme, b"modified content\n").expect("failed to modify README.md");

        let err = remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect_err("removing a dirty worktree must fail");
        assert!(
            err.to_string().contains("1 uncommitted"),
            "the error should name the dirty count: {err}"
        );

        assert!(Path::new(&worktree.path).exists(), "the worktree directory must still exist");
        let contents = std::fs::read(&readme).expect("the modified file should still exist");
        assert_eq!(
            contents, b"modified content\n",
            "the modified file's content must be untouched"
        );

        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE id = ?1",
                rusqlite::params![worktree.id],
                |row| row.get(0),
            )
            .expect("failed to count worktrees rows");
        assert_eq!(row_count, 1, "the worktrees row must still be present");
    });
}

#[test]
fn removing_a_worktree_with_only_an_untracked_file_is_also_refused() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Untracked task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let scratch = Path::new(&worktree.path).join("scratch.txt");
        std::fs::write(&scratch, b"untracked work\n").expect("failed to write the untracked file");

        remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect_err("an untracked file must count as work that would be lost");

        assert!(Path::new(&worktree.path).exists(), "the worktree directory must still exist");
        assert!(scratch.exists(), "the untracked file must still exist");
    });
}

#[test]
fn porcelain_entries_on_a_dirty_worktree_returns_one_entry_per_porcelain_line() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Check task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        std::fs::write(Path::new(&worktree.path).join("README.md"), b"changed\n")
            .expect("failed to modify README.md");
        std::fs::write(Path::new(&worktree.path).join("new.txt"), b"new\n")
            .expect("failed to write a new untracked file");

        let entries =
            porcelain_entries(Path::new(&worktree.path)).expect("porcelain_entries should succeed");
        assert_eq!(entries.len(), 2, "expected one entry per dirty file, got: {entries:?}");
        assert!(
            entries.iter().any(|e| e.path == "README.md"),
            "expected README.md in the entries: {entries:?}"
        );
        assert!(
            entries.iter().any(|e| e.path == "new.txt"),
            "expected new.txt in the entries: {entries:?}"
        );
    });
}

#[test]
fn worktree_summary_for_task_on_a_task_with_no_worktrees_row_returns_none() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No worktree task", None)
            .expect("create_task should succeed");

        let summary = core::query::agent_runs::worktree_summary_for_task(&conn, &task.id)
            .expect("worktree_summary_for_task should succeed");
        assert!(summary.is_none(), "a task with no worktree row must resolve to None");

        // Confirm remove_worktree_for_task itself also refuses cleanly on a missing row.
        remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect_err("remove_worktree_for_task must refuse when no worktree row exists");
    });
}
