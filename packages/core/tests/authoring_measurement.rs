//! Behavior under test (05-13-PLAN.md Task 3, gap G-05-2's third item): `query::authoring::
//! measure_authoring_run` — the Product Kill Criterion's in-app arm, derived from the board
//! through the same event rows `domain::authoring_proposal` already appends, never a
//! second/hand-rolled notion of "accepted" or "amended".
//!
//! Every fixture seeds through the real domain functions this crate's other authoring suites use
//! (`start_authoring_run`, `create_proposal`, `accept_proposal`, `amend_proposal`) — never a
//! hand-rolled `INSERT` — mirroring `authoring_acceptance.rs`'s own discipline. The one exception
//! is the elapsed-span test, which backdates `agent_runs.started_at` and one `events.occurred_at`
//! row via a direct `UPDATE` after the real write already happened, the same test-only technique
//! `epic_context_packet.rs`'s own `stage_and_decide` fixture uses to control `created_at`/
//! `decided_at` deterministically — the row itself is never hand-inserted, only its timestamp is
//! backdated so the elapsed-minutes assertion does not depend on wall-clock speed.

mod common;

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::authoring_proposal::{accept_proposal, amend_proposal, create_proposal, ProposalPayload, ProposalVerb};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::project;
use core::domain::task::create_task;
use core::query::authoring::{list_recent_authoring_runs, measure_authoring_run};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — mirrors
/// `authoring_lifecycle.rs`'s own identically-named lock; needed only by the one test below that
/// starts a real TASK run (`start_agent_run` calls `ensure_worktree`, which needs a real
/// repository, unlike an authoring run's worktree-less start).
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

#[test]
fn accepted_task_and_criterion_proposals_are_both_counted() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // Two tasks, accepted directly (no criteria yet, so no D-96 implied-parent interaction).
    let task_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-a");
    let task_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-b".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-b");
    accept_proposal(&mut conn, &task_a.id, &actor_id).expect("accept task-a");
    accept_proposal(&mut conn, &task_b.id, &actor_id).expect("accept task-b");

    // Two criteria under the (already-accepted) task-a — accepting them does not need to imply-
    // accept their parent, since it is already accepted.
    let criterion_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "criterion-a".to_string(), verification_hint: None },
        None,
        Some(&task_a.id),
    )
    .expect("propose criterion-a");
    let criterion_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "criterion-b".to_string(), verification_hint: None },
        None,
        Some(&task_a.id),
    )
    .expect("propose criterion-b");
    accept_proposal(&mut conn, &criterion_a.id, &actor_id).expect("accept criterion-a");
    accept_proposal(&mut conn, &criterion_b.id, &actor_id).expect("accept criterion-b");

    // A third, never-decided task proposal must not be counted.
    create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-c-never-decided".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-c");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run should succeed");
    assert_eq!(measurement.accepted_task_proposals, 2);
    assert_eq!(measurement.accepted_criterion_proposals, 2);
}

#[test]
fn an_amended_then_accepted_criterion_counts_toward_amended_before_accept_and_a_plain_accept_does_not() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    let task = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose the task");
    accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");

    let amended_criterion = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "original wording".to_string(), verification_hint: None },
        None,
        Some(&task.id),
    )
    .expect("propose the criterion that will be amended");
    let plain_criterion = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "plain wording".to_string(), verification_hint: None },
        None,
        Some(&task.id),
    )
    .expect("propose the criterion that will be accepted as-is");

    amend_proposal(
        &mut conn,
        &amended_criterion.id,
        &actor_id,
        ProposalPayload::Criterion { statement: "the developer's own wording".to_string(), verification_hint: None },
    )
    .expect("amend the staged criterion");
    accept_proposal(&mut conn, &amended_criterion.id, &actor_id).expect("accept the amended criterion");
    accept_proposal(&mut conn, &plain_criterion.id, &actor_id).expect("accept the plain criterion");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run should succeed");
    assert_eq!(measurement.accepted_criterion_proposals, 2);
    assert_eq!(
        measurement.amended_before_accept, 1,
        "only the amended-then-accepted criterion counts toward amended_before_accept"
    );
}

#[test]
fn a_run_with_no_accepted_proposals_reports_zeroes_and_no_elapsed_span_never_an_error() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // A proposal exists but is never decided — still zero accepted.
    create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "never decided".to_string(), description: None },
        None,
        None,
    )
    .expect("propose a task that is never decided");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run must succeed, never error");
    assert_eq!(measurement.accepted_task_proposals, 0);
    assert_eq!(measurement.accepted_criterion_proposals, 0);
    assert_eq!(measurement.amended_before_accept, 0);
    assert_eq!(measurement.last_accepted_at, None, "no acceptance means no last-accepted timestamp");
    assert_eq!(measurement.elapsed_minutes, None, "no acceptance means no elapsed span");
}

#[test]
fn the_elapsed_span_runs_from_the_runs_own_start_to_its_last_acceptance() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // Backdate the run's own start — a test-only timestamp control, mirroring
    // `epic_context_packet.rs`'s own `stage_and_decide` fixture (never a hand-rolled INSERT, only
    // an UPDATE on a row a real domain function already wrote).
    conn.execute(
        "UPDATE agent_runs SET started_at = ?1 WHERE id = ?2",
        params!["2026-01-01T00:00:00Z", run.id],
    )
    .expect("backdating started_at should succeed");

    let task_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-a");
    accept_proposal(&mut conn, &task_a.id, &actor_id).expect("accept task-a (the earlier acceptance)");
    conn.execute(
        "UPDATE events SET occurred_at = ?1 WHERE stream_type = 'authoring_proposal' AND stream_id = ?2 \
         AND event_type = 'proposal.accepted'",
        params!["2026-01-01T00:05:00Z", task_a.id],
    )
    .expect("backdating task-a's acceptance event should succeed");

    let task_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-b".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-b");
    accept_proposal(&mut conn, &task_b.id, &actor_id).expect("accept task-b (the LATER acceptance)");
    conn.execute(
        "UPDATE events SET occurred_at = ?1 WHERE stream_type = 'authoring_proposal' AND stream_id = ?2 \
         AND event_type = 'proposal.accepted'",
        params!["2026-01-01T00:12:00Z", task_b.id],
    )
    .expect("backdating task-b's acceptance event should succeed");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run should succeed");
    assert_eq!(
        measurement.last_accepted_at.as_deref(),
        Some("2026-01-01T00:12:00Z"),
        "the LATER acceptance must win, not the first one written"
    );
    assert_eq!(
        measurement.elapsed_minutes,
        Some(12.0),
        "elapsed minutes runs from the run's own (backdated) start to its last acceptance"
    );
}

#[test]
fn the_last_acceptance_is_the_newest_even_when_the_event_count_exceeds_the_bound() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // Backdate the run's own start so elapsed_minutes is deterministic too.
    conn.execute(
        "UPDATE agent_runs SET started_at = ?1 WHERE id = ?2",
        params!["2026-01-01T00:00:00Z", run.id],
    )
    .expect("backdating started_at should succeed");

    let mut task_ids = Vec::new();
    for i in 0..4 {
        let task = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: format!("task-{i}"), description: None },
            None,
            None,
        )
        .expect("propose a task");
        accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");
        task_ids.push(task.id);
    }

    // Backdate each acceptance event to strictly increasing timestamps, oldest first — four
    // accept events total, more than the limit passed below.
    let timestamps = [
        "2026-01-01T00:01:00Z",
        "2026-01-01T00:02:00Z",
        "2026-01-01T00:03:00Z",
        "2026-01-01T00:04:00Z",
    ];
    for (task_id, ts) in task_ids.iter().zip(timestamps.iter()) {
        conn.execute(
            "UPDATE events SET occurred_at = ?1 WHERE stream_type = 'authoring_proposal' AND stream_id = ?2 \
             AND event_type = 'proposal.accepted'",
            params![ts, task_id],
        )
        .expect("backdating an acceptance event should succeed");
    }

    // A limit smaller than the total event count (4): the pre-fix ASC-ordered, bounded combined
    // read would keep only the two OLDEST accept events and report an earlier last acceptance.
    let measurement =
        measure_authoring_run(&conn, &run.id, 2).expect("measure_authoring_run should succeed");
    assert_eq!(
        measurement.last_accepted_at.as_deref(),
        Some("2026-01-01T00:04:00Z"),
        "the newest acceptance must win even when the event count exceeds the bound"
    );
    assert_eq!(
        measurement.elapsed_minutes,
        Some(4.0),
        "elapsed minutes must be computed from the true newest acceptance, not a truncated one"
    );
}

#[test]
fn an_amendment_older_than_the_bound_still_counts_toward_amended_before_accept() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    let task = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose the task");

    let amended_criterion = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "original wording".to_string(), verification_hint: None },
        None,
        Some(&task.id),
    )
    .expect("propose the criterion that will be amended");
    // The amendment is the EARLIEST lifecycle event this run appends — before any acceptance.
    amend_proposal(
        &mut conn,
        &amended_criterion.id,
        &actor_id,
        ProposalPayload::Criterion { statement: "amended wording".to_string(), verification_hint: None },
    )
    .expect("amend the staged criterion");

    accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");
    accept_proposal(&mut conn, &amended_criterion.id, &actor_id)
        .expect("accept the amended criterion");

    // Two more LATER acceptances push the total accept/amend event count (5) past the limit (4)
    // passed below, with the amendment as the single OLDEST event — the guard against "fix it by
    // ordering the combined read DESC", which would keep only the newest 4 events and drop it.
    // The limit still equals the total PROPOSAL count (4), so the separately-bounded proposal
    // read (which accepted_criterion_ids is derived from) is not itself truncated here — this
    // test isolates the amended-ids defect, not the proposal read's own, orthogonal bound.
    for i in 0..2 {
        let extra_task = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: format!("extra-task-{i}"), description: None },
            None,
            None,
        )
        .expect("propose an extra task");
        accept_proposal(&mut conn, &extra_task.id, &actor_id).expect("accept the extra task");
    }

    let measurement =
        measure_authoring_run(&conn, &run.id, 4).expect("measure_authoring_run should succeed");
    assert_eq!(
        measurement.amended_before_accept, 1,
        "an amendment recorded before several later acceptances must still count, even under a bound smaller than the total event count"
    );
}

#[test]
fn the_proposal_read_is_stable_when_two_rows_share_a_created_at() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    let task_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-a");
    let task_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-b".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-b");
    accept_proposal(&mut conn, &task_a.id, &actor_id).expect("accept task-a");
    accept_proposal(&mut conn, &task_b.id, &actor_id).expect("accept task-b");

    // Force both rows to share an identical created_at, so which row a LIMIT 1 read keeps depends
    // entirely on the tie-break — the spec-less-probe row this test proves (SHAPE-04).
    conn.execute(
        "UPDATE authoring_proposals SET created_at = ?1 WHERE id IN (?2, ?3)",
        params!["2026-01-01T00:00:00Z", task_a.id, task_b.id],
    )
    .expect("forcing a shared created_at should succeed");

    let first = measure_authoring_run(&conn, &run.id, 1).expect("first measurement should succeed");
    let second = measure_authoring_run(&conn, &run.id, 1).expect("second measurement should succeed");
    assert_eq!(
        first, second,
        "two calls against an unchanged database must return equal results, even across a tie"
    );
}

#[test]
fn the_measurement_writes_nothing_the_same_call_twice_leaves_the_database_byte_identical() {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    let mut conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(&mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main")
        .expect("create_project should succeed");

    let run = start_authoring_run(&mut conn, &proj.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");
    let task = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose the task");
    accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");

    // Force every pending page to disk before taking the "before" snapshot, so the two calls
    // below are the only thing that could possibly still dirty a page.
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []).ok();
    drop(conn);

    let before = std::fs::read(&db_path).expect("reading the database file should succeed");
    let conn = Connection::open(&db_path).expect("reopening the database should succeed");

    let _first = measure_authoring_run(&conn, &run.id, 200).expect("first measurement should succeed");
    let _second = measure_authoring_run(&conn, &run.id, 200).expect("second measurement should succeed");
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []).ok();
    drop(conn);

    let after = std::fs::read(&db_path).expect("re-reading the database file should succeed");
    assert_eq!(before, after, "two measurement calls must leave the database file byte-identical");
}

#[test]
fn the_measurement_is_reproducible_under_a_bound_smaller_than_the_data() {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    let mut conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(&mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main")
        .expect("create_project should succeed");

    let run = start_authoring_run(&mut conn, &proj.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // More proposals/events than the deliberately small limit below will bound — reproducibility
    // under a bound is the property the doc comment claims and the property WR-05's two ordering
    // defects broke; the byte-identity test above only exercises the unbounded-in-practice path.
    for i in 0..4 {
        let task = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: format!("task-{i}"), description: None },
            None,
            None,
        )
        .expect("propose a task");
        accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");
    }

    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []).ok();
    drop(conn);

    let before = std::fs::read(&db_path).expect("reading the database file should succeed");
    let conn = Connection::open(&db_path).expect("reopening the database should succeed");

    let first = measure_authoring_run(&conn, &run.id, 2).expect("first measurement should succeed");
    let second = measure_authoring_run(&conn, &run.id, 2).expect("second measurement should succeed");
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []).ok();
    drop(conn);

    let after = std::fs::read(&db_path).expect("re-reading the database file should succeed");
    assert_eq!(
        first, second,
        "two measurement calls under a small bound must return equal results"
    );
    assert_eq!(
        before, after,
        "two measurement calls under a small bound must leave the database file byte-identical"
    );
}

// --- `list_recent_authoring_runs` (05-17-PLAN.md Task 1): the run id the terminal picks the
// comparison's in-app arm from, without reading it off a UI surface. ---

#[test]
fn recent_authoring_runs_lists_only_authoring_runs_newest_first() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();

        let older = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start the older authoring run");
        advance_stage(&mut conn, &older.id, &actor_id).expect("advance the older run's stage");
        conn.execute(
            "UPDATE agent_runs SET started_at = ?1 WHERE id = ?2",
            params!["2026-01-01T00:00:00Z", older.id],
        )
        .expect("backdating the older run's start should succeed");

        let newer = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start the newer authoring run");
        advance_stage(&mut conn, &newer.id, &actor_id).expect("advance the newer run's stage");
        conn.execute(
            "UPDATE agent_runs SET started_at = ?1 WHERE id = ?2",
            params!["2026-01-02T00:00:00Z", newer.id],
        )
        .expect("backdating the newer run's start should succeed");

        // An ordinary, non-authoring, task-bound run — must never appear in the authoring list.
        let task = create_task(&mut conn, &project.id, &actor_id, "An ordinary task", None)
            .expect("create_task should succeed");
        let ordinary = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start the ordinary task-bound run");

        let recent = list_recent_authoring_runs(&conn, 200)
            .expect("list_recent_authoring_runs should succeed");
        let run_ids: Vec<&str> = recent.iter().map(|r| r.run_id.as_str()).collect();
        assert_eq!(
            run_ids,
            vec![newer.id.as_str(), older.id.as_str()],
            "only the two authoring runs should be listed, newest first, excluding the ordinary task-bound run"
        );
        assert!(
            !run_ids.contains(&ordinary.id.as_str()),
            "an ordinary task-bound run must never appear in the authoring run list"
        );
    });
}

#[test]
fn recent_authoring_runs_includes_a_closed_run_with_its_terminal_status() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    close_agent_run(&mut conn, &run.id, AgentRunStatus::Completed, None, None, None)
        .expect("close_agent_run should succeed");

    let recent = list_recent_authoring_runs(&conn, 200)
        .expect("list_recent_authoring_runs should succeed");
    let listed = recent
        .iter()
        .find(|r| r.run_id == run.id)
        .expect("a closed authoring run must still be listed — the comparison measures finished sessions");
    assert_eq!(listed.status, "completed", "the listed run must carry its terminal status");
    assert!(listed.ended_at.is_some(), "a closed run's ended_at must be populated");
}

#[test]
fn recent_authoring_runs_is_bounded_and_stable_when_two_runs_share_a_start() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run_a = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start run a");
    advance_stage(&mut conn, &run_a.id, &actor_id).expect("advance run a's stage");
    let run_b = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start run b");
    advance_stage(&mut conn, &run_b.id, &actor_id).expect("advance run b's stage");

    // Force both runs to the identical started_at — which row a LIMIT 1 read keeps depends
    // entirely on the `id DESC` tie-break, mirroring `list_rejected_for_epic`'s own idiom.
    conn.execute(
        "UPDATE agent_runs SET started_at = ?1 WHERE id IN (?2, ?3)",
        params!["2026-01-01T00:00:00Z", run_a.id, run_b.id],
    )
    .expect("forcing a shared started_at should succeed");

    let first = list_recent_authoring_runs(&conn, 1).expect("first read should succeed");
    let second = list_recent_authoring_runs(&conn, 1).expect("second read should succeed");
    assert_eq!(
        first.len(),
        1,
        "a limit of one must return exactly one run even when two runs tie on started_at"
    );
    assert_eq!(
        first, second,
        "two reads against an unchanged database must return the identical run under a tie"
    );
}
