//! CR-01 gap 3 / DATA-06 (`02-VERIFICATION.md`, `02-REVIEW.md`): `delete_task` was written
//! before this phase's migrations `0003_agent_runtime.sql` and `0004_permission_gate.sql` added
//! `triggers.target_task_id`, `worktrees.task_id`, `agent_runs.task_id` and
//! `permission_requests.task_id` as `NOT NULL REFERENCES tasks(id)` with no `ON DELETE` clause,
//! while `apply_pragmas` sets `foreign_keys = ON` for every connection. Deleting a task that ever
//! had Start Work pressed on it raised a raw `FOREIGN KEY constraint failed`.
//!
//! **Decision recorded (D-40, `02-CONTEXT.md`, plan `02-13` Task 1 checkpoint): Option A — block
//! the deletion.** A task with any row in `triggers` / `worktrees` / `agent_runs` /
//! `permission_requests` is not deleted; `delete_task` returns `Err` naming what blocks it. This
//! file asserts that outcome, not Option B's cascade.

mod common;

use std::sync::Mutex;

use core::domain::agent_run::start_agent_run;
use core::domain::permission_request::create_pending_request;
use core::domain::task::{create_task, delete_task};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary. `cargo test` runs the
/// `#[test]` functions within one integration-test binary concurrently on a thread pool by
/// default — `FLYWHEEL_WORKTREE_ROOT` is process-global mutable state, so two tests racing here
/// would let one test's `worktree_add` fall through to the real default (`~/Flywheel/...`)
/// between the other test's `set_var`/`remove_var` pair. Copied verbatim from
/// `stop_lifecycle.rs`, which observed a real `~/Flywheel/FLY/FLY-1` directory get created on the
/// machine running the test when this lock was absent.
static WORKTREE_ROOT_ENV_LOCK: Mutex<()> = Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Count rows matching a compile-time literal SQL string with one bound id parameter — every
/// assertion in this file reads as one line.
fn count(conn: &Connection, sql: &str, id: &str) -> i64 {
    conn.query_row(sql, params![id], |row| row.get(0))
        .expect("count query should succeed")
}

#[test]
fn deleting_a_task_with_agent_run_history_produces_the_decided_outcome() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Task with history", None)
            .expect("create_task should succeed");

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        create_pending_request(&mut conn, &run.id, "Bash", Some("{\"command\":\"ls\"}"), &actor_id)
            .expect("create_pending_request should succeed");

        // Prove the fixture actually created agent-run history before asserting anything about
        // deleting it — a test that proves nothing because start_agent_run silently failed to
        // create the rows is worse than no test.
        let trigger_count_before = count(&conn, "SELECT COUNT(*) FROM triggers WHERE target_task_id = ?1", &task.id);
        let worktree_count_before = count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id);
        let agent_run_count_before = count(&conn, "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", &task.id);
        let permission_request_count_before =
            count(&conn, "SELECT COUNT(*) FROM permission_requests WHERE task_id = ?1", &task.id);
        assert!(trigger_count_before > 0, "fixture must create a triggers row before the delete is attempted");
        assert!(worktree_count_before > 0, "fixture must create a worktrees row before the delete is attempted");
        assert!(agent_run_count_before > 0, "fixture must create an agent_runs row before the delete is attempted");
        assert!(
            permission_request_count_before > 0,
            "fixture must create a permission_requests row before the delete is attempted"
        );

        let events_before = count(&conn, "SELECT COUNT(*) FROM events WHERE task_id = ?1", &task.id);
        assert!(events_before > 0, "starting a run and raising a request must append events for this task");

        // --- Behavior under D-40 (Option A): the deletion is BLOCKED, not cascaded ---
        let result = delete_task(&mut conn, &actor_id, &task.id);
        assert!(
            result.is_err(),
            "Option A (D-40): deleting a task with agent-run history must be blocked, not silently succeed"
        );

        let message = result.unwrap_err().to_string();
        assert!(
            !message.to_uppercase().contains("FOREIGN KEY"),
            "Option A (D-40): the blocked-deletion message must never contain a raw SQLite \
             constraint message, got: {message}"
        );
        assert!(
            message.contains(&agent_run_count_before.to_string()),
            "Option A (D-40): the message must name the number of agent runs blocking the \
             deletion, got: {message}"
        );

        // --- Behavior: nothing was destroyed — the task row and every agent-runtime row survive ---
        let task_row_count = count(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &task.id);
        assert_eq!(task_row_count, 1, "Option A (D-40): the tasks row must still be present after a blocked delete");

        let trigger_count_after = count(&conn, "SELECT COUNT(*) FROM triggers WHERE target_task_id = ?1", &task.id);
        let worktree_count_after = count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id);
        let agent_run_count_after = count(&conn, "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", &task.id);
        let permission_request_count_after =
            count(&conn, "SELECT COUNT(*) FROM permission_requests WHERE task_id = ?1", &task.id);
        assert_eq!(trigger_count_after, trigger_count_before, "Option A (D-40): triggers must be untouched");
        assert_eq!(worktree_count_after, worktree_count_before, "Option A (D-40): worktrees must be untouched");
        assert_eq!(agent_run_count_after, agent_run_count_before, "Option A (D-40): agent_runs must be untouched");
        assert_eq!(
            permission_request_count_after, permission_request_count_before,
            "Option A (D-40): permission_requests must be untouched"
        );

        // --- Behavior: no task.deleted event was appended for a blocked deletion ---
        let deletion_event_count = count(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.deleted'",
            &task.id,
        );
        assert_eq!(deletion_event_count, 0, "Option A (D-40): a blocked delete must append no task.deleted event");

        // --- Behavior: events.task_id carries no foreign key, so the event log survives either
        // way (T-02G-13-02) — under Option A trivially, since nothing was deleted at all ---
        let events_after = count(&conn, "SELECT COUNT(*) FROM events WHERE task_id = ?1", &task.id);
        assert_eq!(
            events_after, events_before,
            "the events row count for this task must be unchanged by a blocked delete attempt"
        );
    });
}

#[test]
fn deleting_a_task_that_never_started_work_still_succeeds() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Never started", None)
            .expect("create_task should succeed");
        core::domain::acceptance_criterion::create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "One criterion",
            None,
        )
        .expect("create_criterion should succeed");

        // Sanity: this task really has no agent-run history — the regression fix must not cost
        // the pre-existing feature for the overwhelming majority of tasks that never start work.
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", &task.id), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id), 0);

        delete_task(&mut conn, &actor_id, &task.id).expect("deleting a task with no agent history must still succeed");

        let remaining = count(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &task.id);
        assert_eq!(remaining, 0, "the task row must be gone after delete");

        let deletion_event_count = count(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.deleted'",
            &task.id,
        );
        assert_eq!(deletion_event_count, 1, "exactly one task.deleted event must exist for this task");
    });
}

#[test]
fn no_task_delete_error_ever_contains_a_raw_sqlite_constraint_message() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Guarded task", None)
            .expect("create_task should succeed");
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run should succeed");

        // Under Option A this is expected to be an Err — assert the invariant explicitly on
        // whichever outcome delete_task actually returns, rather than skipping the test. Under
        // Option B this would assert Ok, which satisfies the same invariant trivially.
        match delete_task(&mut conn, &actor_id, &task.id) {
            Ok(()) => {
                // Option B's outcome: the deletion succeeded, so by construction no error string
                // was ever produced — the invariant holds trivially.
            }
            Err(e) => {
                let message = e.to_string();
                assert!(
                    !message.to_uppercase().contains("FOREIGN KEY"),
                    "no task_delete error may ever surface a raw SQLite FOREIGN KEY constraint \
                     message to the caller, got: {message}"
                );
            }
        }
    });
}
