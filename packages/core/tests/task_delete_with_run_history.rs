//! D-44 (`03-CONTEXT.md`, plan `03-05` Task 1 checkpoint — Option A, superseding D-40): once
//! plan `03-01` gave the user a real way to clear a task's worktree
//! (`worktree::remove_worktree_for_task`, itself refusing a dirty tree per D-43),
//! `delete_task`'s guard narrows to WORKTREE-ONLY, and a permitted deletion cascades the task's
//! `triggers`/`agent_runs`/`permission_requests` rows in the same transaction rather than
//! blocking forever. This file replaces the D-40-era assertions (permanent block on any agent-run
//! history) with the D-44 contract: blocked while a worktree exists, permitted once it does not,
//! history cascaded, the append-only `events` log untouched either way, and the full two-step
//! order — dirty worktree blocks both the delete and the removal, a committed tree lets both
//! succeed in order — proven end to end.

mod common;

use std::path::Path;
use std::sync::Mutex;

use core::domain::agent_run::start_agent_run;
use core::domain::permission_request::create_pending_request;
use core::domain::task::{create_task, delete_task};
use core::domain::worktree::{ensure_worktree, remove_worktree_for_task};
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
fn deleting_a_task_with_a_worktree_is_blocked_and_names_the_fix() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Task with a worktree", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let worktree_count_before = count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id);
        assert!(worktree_count_before > 0, "fixture must create a worktrees row before the delete is attempted");

        let err = delete_task(&mut conn, &actor_id, &task.id)
            .expect_err("D-44: deleting a task with a live worktree must be blocked");
        assert_eq!(
            err.to_string(),
            "Cannot delete this task: a worktree exists for it. Remove the worktree first, then delete.",
            "the refusal must be the exact Copywriting Contract sentence, naming the fix"
        );

        let task_row_count = count(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &task.id);
        assert_eq!(task_row_count, 1, "the tasks row must still be present after a blocked delete");

        let worktree_count_after = count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id);
        assert_eq!(worktree_count_after, worktree_count_before, "the worktrees row must be untouched");

        let deletion_event_count = count(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.deleted'",
            &task.id,
        );
        assert_eq!(deletion_event_count, 0, "a blocked delete must append no task.deleted event");
    });
}

#[test]
fn deleting_a_task_with_agent_run_history_but_no_worktree_succeeds_and_cascades_history() {
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
        let agent_run_count_before = count(&conn, "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", &task.id);
        let permission_request_count_before =
            count(&conn, "SELECT COUNT(*) FROM permission_requests WHERE task_id = ?1", &task.id);
        assert!(trigger_count_before > 0, "fixture must create a triggers row before the delete is attempted");
        assert!(agent_run_count_before > 0, "fixture must create an agent_runs row before the delete is attempted");
        assert!(
            permission_request_count_before > 0,
            "fixture must create a permission_requests row before the delete is attempted"
        );

        let events_before = count(&conn, "SELECT COUNT(*) FROM events WHERE task_id = ?1", &task.id);
        assert!(events_before > 0, "starting a run and raising a request must append events for this task");

        // `start_agent_run` also creates the task's worktree (`ensure_worktree`) — clear it via
        // the real removal path (D-43's guard passes because a freshly-created worktree is
        // clean) before attempting the task delete, matching the product's only legal sequence.
        remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect("removing the clean worktree created by start_agent_run must succeed");

        // --- Behavior under D-44 (Option A): the deletion is PERMITTED and cascades history ---
        delete_task(&mut conn, &actor_id, &task.id)
            .expect("D-44: deleting a task with agent-run history but no worktree must succeed");

        let task_row_count = count(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &task.id);
        assert_eq!(task_row_count, 0, "the tasks row must be gone after a permitted delete");

        // --- Behavior: the three dependent tables are cascaded to empty ---
        let trigger_count_after = count(&conn, "SELECT COUNT(*) FROM triggers WHERE target_task_id = ?1", &task.id);
        let agent_run_count_after = count(&conn, "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", &task.id);
        let permission_request_count_after =
            count(&conn, "SELECT COUNT(*) FROM permission_requests WHERE task_id = ?1", &task.id);
        assert_eq!(trigger_count_after, 0, "Option A (D-44): triggers must be cascaded away");
        assert_eq!(agent_run_count_after, 0, "Option A (D-44): agent_runs must be cascaded away");
        assert_eq!(permission_request_count_after, 0, "Option A (D-44): permission_requests must be cascaded away");

        // --- Behavior: exactly one task.deleted event was appended ---
        let deletion_event_count = count(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.deleted'",
            &task.id,
        );
        assert_eq!(deletion_event_count, 1, "exactly one task.deleted event must exist for a permitted delete");

        // --- Behavior: exactly one summarising task.history_deleted event was appended ---
        let history_event_count = count(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.history_deleted'",
            &task.id,
        );
        assert_eq!(
            history_event_count, 1,
            "exactly one summarising task.history_deleted event must exist, not one per deleted row"
        );

        // --- Behavior: events.task_id carries no foreign key, so the event log survives the
        // cascade UNCHANGED (T-03-05-02) — the non-repudiable record of what the agent did is
        // never touched by this path, even though the projection rows above are gone ---
        let events_after = count(&conn, "SELECT COUNT(*) FROM events WHERE task_id = ?1", &task.id);
        assert!(
            events_after >= events_before,
            "the events row count for this task must never shrink; before={events_before}, after={events_after}"
        );
    });
}

#[test]
fn deleting_a_task_that_never_started_work_still_succeeds_with_no_history_event() {
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

        // The no-history case must be a true no-op regression check: no extra event for a task
        // that never had anything to cascade.
        let history_event_count = count(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.history_deleted'",
            &task.id,
        );
        assert_eq!(history_event_count, 0, "a task with no history must append no task.history_deleted event");
    });
}

#[test]
fn no_task_delete_error_ever_contains_a_raw_sqlite_constraint_message() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Guarded task", None)
            .expect("create_task should succeed");
        // start_agent_run creates a worktree, which is the one condition that still blocks.
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run should succeed");

        let err = delete_task(&mut conn, &actor_id, &task.id)
            .expect_err("a task with a live worktree must still be blocked");
        let message = err.to_string();
        assert!(
            !message.to_uppercase().contains("FOREIGN KEY"),
            "no task_delete error may ever surface a raw SQLite FOREIGN KEY constraint \
             message to the caller, got: {message}"
        );
    });
}

/// The plan's real proof (`03-05-PLAN.md` Task 2 `<behavior>`): D-43 and D-44 compose so that no
/// sequence of product actions deletes a task out from under uncommitted work. Create a task,
/// start a run (which creates its worktree), make the worktree dirty, attempt deletion (fails on
/// the worktree guard), attempt worktree removal (fails on the dirty-tree guard), commit the
/// change, remove the worktree (succeeds), delete the task (succeeds).
#[test]
fn the_full_two_step_order_holds_end_to_end() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Two-step order task", None)
            .expect("create_task should succeed");

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let worktree = core::domain::worktree::worktree_for_task(&conn, &task.id)
            .expect("worktree_for_task should succeed")
            .expect("start_agent_run must have created a worktree row");

        // Make the worktree dirty.
        let scratch = Path::new(&worktree.path).join("scratch.txt");
        std::fs::write(&scratch, b"uncommitted work\n").expect("failed to write the scratch file");

        // Step 1: delete_task fails on the worktree guard while the tree is dirty.
        let delete_err = delete_task(&mut conn, &actor_id, &task.id)
            .expect_err("delete_task must be blocked while a worktrees row exists, dirty or not");
        assert_eq!(
            delete_err.to_string(),
            "Cannot delete this task: a worktree exists for it. Remove the worktree first, then delete.",
        );

        // Step 2: worktree removal also fails, because the tree is dirty (D-43).
        remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect_err("remove_worktree_for_task must refuse a dirty tree");

        // Nothing was destroyed by either failed attempt.
        assert!(scratch.exists(), "the uncommitted file must still exist after both refusals");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &task.id), 1);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id), 1);

        // Commit the change in the real repo the worktree was cut from — the tree is clean now.
        let run_git = |args: &[&str]| {
            let status = std::process::Command::new("git")
                .arg("-C")
                .arg(&worktree.path)
                .args(args)
                .status()
                .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
            assert!(status.success(), "git {args:?} failed");
        };
        run_git(&["add", "scratch.txt"]);
        run_git(&["commit", "-m", "commit the scratch file"]);
        let _ = &repo_dir; // keep the base repo's TempDir alive for the whole test

        // Step 3: worktree removal now succeeds on the clean tree.
        remove_worktree_for_task(&mut conn, &task.id, &actor_id)
            .expect("removing the now-clean worktree must succeed");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1", &task.id), 0);

        // Step 4: delete_task now succeeds, cascading the run's history.
        delete_task(&mut conn, &actor_id, &task.id)
            .expect("delete_task must succeed once no worktrees row exists for the task");
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &task.id), 0);
        assert_eq!(count(&conn, "SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", &task.id), 0);
        let _ = run.id; // the run row itself is cascaded away; its id is only used for the assertions above
    });
}
