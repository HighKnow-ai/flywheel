//! Tests for all four triage verbs (accept, reject, merge, defer) plus the bulk reject/defer
//! paths (D-101/D-102/D-104, plan 06-03). Every test asserts `decided_by`/`decided_at` are
//! non-null on each row it decides — a terminal status with a null decider would break the
//! non-repudiable trail the whole board rests on.

mod common;

use core::domain::authoring_proposal::{
    accept_proposal, create_proposal, defer_proposal, defer_proposals_bulk, merge_proposal,
    reject_proposal, reject_proposals_bulk, MergeTarget, ProposalPayload, ProposalProvenance,
    ProposalUndecidable, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::epic::create_epic;
use core::domain::project::Project;
use core::domain::task::{create_task, delete_task};
use core::query::authoring::{list_deferred_proposals, list_pending_proposals};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — mirrors
/// `authoring_proposal.rs`'s/`proposal_no_promotion.rs`'s identically-named lock (a separate
/// static per test binary).
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

/// Seed a project and an authoring run already advanced past `challenge` into `decompose` —
/// mirrors `authoring_proposal.rs`'s own `ready_run` fixture exactly.
fn ready_run() -> (Connection, String, Project, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &human_actor_id).expect("advance_stage should succeed");
    (conn, human_actor_id, project, run.id)
}

fn count_tasks(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap()
}
fn count_epics(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM epics", [], |row| row.get(0)).unwrap()
}
fn count_issues(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0)).unwrap()
}
fn count_criteria(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0)).unwrap()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Counts {
    tasks: i64,
    epics: i64,
    issues: i64,
    criteria: i64,
}

fn counts(conn: &Connection) -> Counts {
    Counts {
        tasks: count_tasks(conn),
        epics: count_epics(conn),
        issues: count_issues(conn),
        criteria: count_criteria(conn),
    }
}

fn count_events_of_type(conn: &Connection, event_type: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = ?1",
        params![event_type],
        |row| row.get(0),
    )
    .unwrap()
}

/// Raw read of one `authoring_proposals` row's decision columns — no public query exposes an
/// arbitrary-status single-row read outside `pending` (`pending_proposals_for_run`) and
/// `rejected` (`query::authoring::list_rejected_for_epic`), so this is the direct table read
/// every triage verb's own decision columns get proven against.
fn proposal_row(
    conn: &Connection,
    id: &str,
) -> (String, Option<String>, Option<String>, Option<String>) {
    conn.query_row(
        "SELECT status, decided_by, decided_at, materialised_id FROM authoring_proposals WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("proposal row should exist — a triage verb must never delete it (D-83)")
}

fn issue_row(conn: &Connection, id: &str) -> (Option<String>, Option<String>, Option<String>, String) {
    conn.query_row(
        "SELECT epic_id, task_id, body, kind FROM issues WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("issue row should exist")
}

/// A byte-exact snapshot of every column in one row — used to prove a merge target's own row is
/// untouched (T-06-10). Generic over the table so both the task and epic merge tests share it.
fn row_snapshot(conn: &Connection, table: &str, id: &str) -> Vec<String> {
    let sql = match table {
        "tasks" => "SELECT * FROM tasks WHERE id = ?1",
        "epics" => "SELECT * FROM epics WHERE id = ?1",
        other => panic!("row_snapshot: unsupported table {other:?}"),
    };
    let mut stmt = conn.prepare(sql).unwrap();
    let column_count = stmt.column_count();
    stmt.query_row(params![id], |row| {
        let mut out = Vec::with_capacity(column_count);
        for i in 0..column_count {
            let value: rusqlite::types::Value = row.get(i)?;
            out.push(format!("{value:?}"));
        }
        Ok(out)
    })
    .expect("row should exist")
}

// ============================================================================================
// Accept — a proposed issue mints one top-level issue
// ============================================================================================

#[test]
fn accepting_a_proposed_issue_mints_one_top_level_issue_with_both_parents_null() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Issue {
                title: "Docs drift from the real CLI flags".to_string(),
                body: Some("Noticed while executing an unrelated task".to_string()),
                issue_kind: "idea".to_string(),
            },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (issue) should succeed");
        assert_eq!(counts(&conn), before, "staging must create no canonical row");

        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id)
            .expect("accept_proposal should succeed for a create/issue proposal");
        assert_eq!(counts(&conn), Counts { issues: before.issues + 1, ..before }, "accept must mint exactly one issue");

        let (epic_id, task_id, _body, _kind) = issue_row(&conn, &outcome.materialised_id);
        assert_eq!(epic_id, None, "a top-level issue must carry no epic_id");
        assert_eq!(task_id, None, "a top-level issue must carry no task_id");

        let (status, decided_by, decided_at, materialised_id) = proposal_row(&conn, &proposal.id);
        assert_eq!(status, "accepted");
        assert_eq!(materialised_id.as_deref(), Some(outcome.materialised_id.as_str()));
        assert!(decided_by.is_some(), "decided_by must be recorded on every decided row");
        assert!(decided_at.is_some(), "decided_at must be recorded on every decided row");
    });
}

// ============================================================================================
// Merge — attaches a child issue without ever touching the target's own row
// ============================================================================================

#[test]
fn merging_a_task_proposal_into_an_existing_task_creates_a_child_issue_and_leaves_the_task_byte_identical() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let target_task =
            create_task(&mut conn, &project.id, &human_actor_id, "Existing task, the merge target", None)
                .expect("create_task should succeed");
        let before_snapshot = row_snapshot(&conn, "tasks", &target_task.id);
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task {
                title: "Retry budget ignores the configured value".to_string(),
                description: Some("Found while reading the retry loop".to_string()), priority: None,
            },
            None,
            None,
            ProposalProvenance { rationale: Some("Traced a hang to a hardcoded retry count".to_string()), origin_log_offset: None },
        )
        .expect("create_proposal (task) should succeed");

        let outcome = merge_proposal(&mut conn, &human_actor_id, &proposal.id, &MergeTarget::Task(target_task.id.clone()))
            .expect("merge_proposal should succeed");

        assert_eq!(counts(&conn), Counts { issues: before.issues + 1, ..before }, "merge must create exactly one issue, no other canonical row");
        assert_eq!(row_snapshot(&conn, "tasks", &target_task.id), before_snapshot, "T-06-10: merge must never mutate the target task's own row");

        let (epic_id, task_id, body, kind) = issue_row(&conn, &outcome.issue_id);
        assert_eq!(epic_id, None);
        assert_eq!(task_id.as_deref(), Some(target_task.id.as_str()));
        assert_eq!(kind, "idea", "a merged task/epic proposal's issue kind defaults to idea");
        let body = body.expect("merged issue must carry a body");
        assert!(body.contains("Found while reading the retry loop"), "body must carry the proposal's own description");
        assert!(body.contains("Traced a hang to a hardcoded retry count"), "body must carry the proposal's rationale");
        assert_ne!(
            body.find("Found while reading the retry loop"),
            body.find("Traced a hang to a hardcoded retry count"),
            "description and rationale must be two discrete labelled parts, not one blob"
        );

        let (status, decided_by, decided_at, materialised_id) = proposal_row(&conn, &proposal.id);
        assert_eq!(status, "merged");
        assert_eq!(materialised_id.as_deref(), Some(outcome.issue_id.as_str()));
        assert!(decided_by.is_some());
        assert!(decided_at.is_some());
    });
}

#[test]
fn merging_a_task_proposal_into_an_existing_epic_creates_a_child_issue_and_leaves_the_epic_byte_identical() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let target_epic = create_epic(&mut conn, &project.id, &human_actor_id, "Existing epic, the merge target", None)
            .expect("create_epic should succeed");
        let before_snapshot = row_snapshot(&conn, "epics", &target_epic.id);
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "New epic drafted from a run's finding".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance { rationale: Some("Spotted a whole missing surface".to_string()), origin_log_offset: None },
        )
        .expect("create_proposal (epic) should succeed");

        let outcome = merge_proposal(&mut conn, &human_actor_id, &proposal.id, &MergeTarget::Epic(target_epic.id.clone()))
            .expect("merge_proposal should succeed");

        assert_eq!(counts(&conn), Counts { issues: before.issues + 1, ..before }, "merge must create exactly one issue, no other canonical row");
        assert_eq!(row_snapshot(&conn, "epics", &target_epic.id), before_snapshot, "T-06-10: merge must never mutate the target epic's own row");

        let (epic_id, task_id, body, kind) = issue_row(&conn, &outcome.issue_id);
        assert_eq!(epic_id.as_deref(), Some(target_epic.id.as_str()));
        assert_eq!(task_id, None);
        assert_eq!(kind, "idea");
        let body = body.expect("merged issue must carry a body");
        assert!(body.contains("Spotted a whole missing surface"), "body must carry the proposal's rationale");
    });
}

#[test]
fn merging_an_issue_payload_proposal_carries_its_own_issue_kind_through_instead_of_idea() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let target_task = create_task(&mut conn, &project.id, &human_actor_id, "Existing task", None)
            .expect("create_task should succeed");

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Issue {
                title: "A risk worth flagging on this task".to_string(),
                body: Some("Details of the risk".to_string()),
                issue_kind: "risk".to_string(),
            },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (issue) should succeed");

        let outcome = merge_proposal(&mut conn, &human_actor_id, &proposal.id, &MergeTarget::Task(target_task.id.clone()))
            .expect("merge_proposal should succeed");

        let (_epic_id, task_id, _body, kind) = issue_row(&conn, &outcome.issue_id);
        assert_eq!(task_id.as_deref(), Some(target_task.id.as_str()));
        assert_eq!(kind, "risk", "an Issue-payload proposal's own issue_kind must carry through, not default to idea");
    });
}

#[test]
fn merging_twice_returns_the_same_issue_id_and_creates_no_second_issue() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let target_task = create_task(&mut conn, &project.id, &human_actor_id, "Existing task", None)
            .expect("create_task should succeed");
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Merge me once".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");

        let first = merge_proposal(&mut conn, &human_actor_id, &proposal.id, &MergeTarget::Task(target_task.id.clone()))
            .expect("first merge should succeed");
        let before = counts(&conn);
        let second = merge_proposal(&mut conn, &human_actor_id, &proposal.id, &MergeTarget::Task(target_task.id.clone()))
            .expect("second merge should succeed (idempotent)");

        assert_eq!(second.issue_id, first.issue_id, "a second merge must return the SAME issue id");
        assert_eq!(counts(&conn), before, "a second merge must never write a second issue");
        assert_eq!(count_events_of_type(&conn, "proposal.merged"), 1, "no second decision event either");
    });
}

#[test]
fn merging_into_a_target_that_no_longer_exists_raises_proposal_undecidable() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let target_task = create_task(&mut conn, &project.id, &human_actor_id, "Will vanish", None)
            .expect("create_task should succeed");
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Orphaned merge attempt".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");

        delete_task(&mut conn, &human_actor_id, &target_task.id).expect("delete_task should succeed");

        let err = merge_proposal(&mut conn, &human_actor_id, &proposal.id, &MergeTarget::Task(target_task.id.clone()))
            .expect_err("merging into a deleted target must fail");
        let undecidable = err
            .downcast_ref::<ProposalUndecidable>()
            .expect("expected a typed ProposalUndecidable error, not a generic failure");
        assert_eq!(undecidable.target_id, target_task.id);
        assert_eq!(undecidable.target_type, "task");
    });
}

// ============================================================================================
// Defer — mints nothing, stays recallable
// ============================================================================================

#[test]
fn deferring_leaves_every_canonical_count_unchanged_and_the_row_recallable() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Not ready yet".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        let before = counts(&conn);

        let deferred = defer_proposal(&mut conn, &human_actor_id, &proposal.id).expect("defer_proposal should succeed");
        assert_eq!(deferred.status, "deferred");
        assert_eq!(counts(&conn), before, "defer must mint nothing in any canonical table");

        let (status, decided_by, decided_at, materialised_id) = proposal_row(&conn, &proposal.id);
        assert_eq!(status, "deferred", "the row must be recallable, still present and readable");
        assert_eq!(materialised_id, None);
        assert!(decided_by.is_some());
        assert!(decided_at.is_some());
    });
}

#[test]
fn deferring_twice_is_idempotent() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Defer me once".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");

        let first = defer_proposal(&mut conn, &human_actor_id, &proposal.id).expect("first defer should succeed");
        let before = counts(&conn);
        let second = defer_proposal(&mut conn, &human_actor_id, &proposal.id).expect("second defer should succeed (idempotent)");

        assert_eq!(second.decided_at, first.decided_at, "a second defer must not overwrite the recorded decision");
        assert_eq!(counts(&conn), before);
        assert_eq!(count_events_of_type(&conn, "proposal.deferred"), 1, "no second decision event either");
    });
}

#[test]
fn deferring_an_accepted_proposal_is_refused_naming_the_current_status() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Already accepted".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");

        let err = defer_proposal(&mut conn, &human_actor_id, &proposal.id).expect_err("deferring an accepted proposal must be refused");
        assert!(
            err.to_string().contains("accepted"),
            "the refusal must name the current status, got: {err}"
        );
    });
}

// ============================================================================================
// Bulk reject / bulk defer (D-104) — the only two bulk paths; no bulk-accept exists
// ============================================================================================

#[test]
fn bulk_reject_over_a_mixed_set_decides_only_pending_and_reports_the_rest_as_skipped() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let mut ids = Vec::new();
        for i in 0..3 {
            let proposal = create_proposal(
                &mut conn,
                &run_id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("Bulk reject candidate {i}"), description: None, priority: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .expect("create_proposal should succeed");
            ids.push(proposal.id);
        }
        // One of the three is already decided before the bulk call reaches it.
        reject_proposal(&mut conn, &ids[0], &human_actor_id, Some("pre-rejected individually"))
            .expect("individual reject should succeed");

        let before_events = count_events_of_type(&conn, "proposal.rejected");
        let outcome = reject_proposals_bulk(&mut conn, &human_actor_id, &ids, Some("bulk reason"))
            .expect("reject_proposals_bulk should succeed");

        assert_eq!(outcome.decided, 2, "only the two still-pending ids must be decided");
        assert_eq!(outcome.skipped, vec![ids[0].clone()], "the already-rejected id must be reported as skipped");
        assert_eq!(
            count_events_of_type(&conn, "proposal.rejected"),
            before_events + 2,
            "exactly one event per newly-decided row, none for the skipped one"
        );

        for id in &ids[1..] {
            let (status, decided_by, decided_at, _materialised_id) = proposal_row(&conn, id);
            assert_eq!(status, "rejected");
            assert!(decided_by.is_some());
            assert!(decided_at.is_some());
        }
    });
}

#[test]
fn bulk_defer_over_a_mixed_set_decides_only_pending_and_reports_the_rest_as_skipped() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let mut ids = Vec::new();
        for i in 0..3 {
            let proposal = create_proposal(
                &mut conn,
                &run_id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("Bulk defer candidate {i}"), description: None, priority: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .expect("create_proposal should succeed");
            ids.push(proposal.id);
        }
        defer_proposal(&mut conn, &human_actor_id, &ids[0]).expect("individual defer should succeed");

        let before_events = count_events_of_type(&conn, "proposal.deferred");
        let outcome = defer_proposals_bulk(&mut conn, &human_actor_id, &ids).expect("defer_proposals_bulk should succeed");

        assert_eq!(outcome.decided, 2, "only the two still-pending ids must be decided");
        assert_eq!(outcome.skipped, vec![ids[0].clone()], "the already-deferred id must be reported as skipped, not re-decided");
        assert_eq!(count_events_of_type(&conn, "proposal.deferred"), before_events + 2);

        for id in &ids[1..] {
            let (status, decided_by, decided_at, _materialised_id) = proposal_row(&conn, id);
            assert_eq!(status, "deferred");
            assert!(decided_by.is_some());
            assert!(decided_at.is_some());
        }
    });
}

#[test]
fn an_empty_bulk_selection_writes_nothing_and_appends_no_event() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, _run_id) = ready_run();
        let before_rejected = count_events_of_type(&conn, "proposal.rejected");
        let before_deferred = count_events_of_type(&conn, "proposal.deferred");

        let reject_outcome = reject_proposals_bulk(&mut conn, &human_actor_id, &[], None)
            .expect("an empty slice must be a no-op, not an error");
        assert_eq!(reject_outcome.decided, 0);
        assert!(reject_outcome.skipped.is_empty());

        let defer_outcome = defer_proposals_bulk(&mut conn, &human_actor_id, &[])
            .expect("an empty slice must be a no-op, not an error");
        assert_eq!(defer_outcome.decided, 0);
        assert!(defer_outcome.skipped.is_empty());

        assert_eq!(count_events_of_type(&conn, "proposal.rejected"), before_rejected, "an empty selection must append no event");
        assert_eq!(count_events_of_type(&conn, "proposal.deferred"), before_deferred, "an empty selection must append no event");
    });
}

#[test]
fn an_over_max_limit_bulk_slice_is_refused_naming_the_ceiling() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, _run_id) = ready_run();
        // MAX_LIMIT (private to authoring_proposal.rs) is 500 — the length check runs BEFORE any
        // per-id fetch, so these ids need not name real proposals.
        let oversized: Vec<String> = (0..501).map(|i| format!("nonexistent-{i}")).collect();

        let reject_err = reject_proposals_bulk(&mut conn, &human_actor_id, &oversized, None)
            .expect_err("an over-ceiling reject slice must be refused, not truncated");
        assert!(reject_err.to_string().contains("500"), "the refusal must name the ceiling, got: {reject_err}");

        let defer_err = defer_proposals_bulk(&mut conn, &human_actor_id, &oversized)
            .expect_err("an over-ceiling defer slice must be refused, not truncated");
        assert!(defer_err.to_string().contains("500"), "the refusal must name the ceiling, got: {defer_err}");
    });
}

// ============================================================================================
// list_deferred_proposals / five-status counts / provenance projection (plan 06-06)
// ============================================================================================

/// Stage an already-deferred `authoring_proposals` row directly, bypassing `create_proposal`'s
/// own `PROPOSAL_LIMIT_PER_RUN` write-side rule (plan 06-05) and taking a caller-chosen
/// `created_at` — used ONLY by the ordering and clamp tests below, which need more rows under one
/// run, and deterministic ordering, than the public API permits. Mirrors
/// `epic_context_packet.rs`'s own `seed_raw_decided_proposal` shape.
fn seed_raw_deferred_proposal(
    conn: &Connection,
    run_id: &str,
    project_id: &str,
    actor_id: &str,
    title: &str,
    created_at: &str,
) -> String {
    let id = core::ids::new_id();
    conn.execute(
        "INSERT INTO authoring_proposals (
            id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
            parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
            created_by, created_at, decided_by, decided_at, rationale, origin_log_offset,
            duplicate_of, duplicate_score
        ) VALUES (?1, ?2, ?3, NULL, 'create', 'task', NULL, NULL, ?4, ?5, 'deferred', NULL, NULL, \
            ?6, ?7, ?6, ?7, NULL, NULL, NULL, NULL)",
        params![
            id,
            run_id,
            project_id,
            core::ids::new_id(),
            serde_json::json!({ "kind": "task", "title": title, "description": null }).to_string(),
            actor_id,
            created_at,
        ],
    )
    .expect("failed to seed a raw deferred proposal");
    id
}

#[test]
fn deferred_read_returns_only_deferred_rows_ordered_newest_first() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();

        // Create the still-pending/rejected rows through the real write path FIRST — `rank_after`
        // scans the tail sibling among ALL rows sharing (run_id, parent_proposal_id) to compute a
        // fresh position, and a raw-inserted row's non-fractional-index `position` value would
        // corrupt that scan. Seeding the two deferred rows directly AFTER these real creates (with
        // no further `create_proposal` call in this run) sidesteps that entirely.
        let stays_pending = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Stays pending".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed")
        .id;
        let to_reject = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Gets rejected".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed")
        .id;
        reject_proposal(&mut conn, &to_reject, &human_actor_id, None).expect("reject_proposal should succeed");

        let older_deferred = seed_raw_deferred_proposal(
            &conn, &run_id, &project.id, &human_actor_id, "Deferred earlier", "2026-01-01T00:00:00Z",
        );
        let newer_deferred = seed_raw_deferred_proposal(
            &conn, &run_id, &project.id, &human_actor_id, "Deferred later", "2026-01-02T00:00:00Z",
        );

        let window = list_deferred_proposals(&conn, &project.id, 10, None)
            .expect("list_deferred_proposals should succeed");
        let ids: Vec<&str> = window.proposals.iter().map(|p| p.id.as_str()).collect();

        assert_eq!(
            ids,
            vec![newer_deferred.as_str(), older_deferred.as_str()],
            "must return only deferred rows, newest first"
        );
        assert!(!ids.contains(&stays_pending.as_str()), "a pending row must never appear in the deferred filter");
        assert!(!ids.contains(&to_reject.as_str()), "a rejected row must never appear in the deferred filter");
    });
}

#[test]
fn deferred_read_on_a_project_with_none_returns_an_empty_window_and_no_error() {
    with_scratch_runtime_dir(|| {
        let (conn, _human_actor_id, project, _run_id) = ready_run();
        let window = list_deferred_proposals(&conn, &project.id, 10, None)
            .expect("an empty deferred set must not be an error");
        assert!(window.proposals.is_empty());
    });
}

#[test]
fn deferred_read_clamps_to_max_limit() {
    with_scratch_runtime_dir(|| {
        let (conn, human_actor_id, project, run_id) = ready_run();
        for i in 0..(core::query::authoring::MAX_LIMIT + 5) {
            seed_raw_deferred_proposal(
                &conn,
                &run_id,
                &project.id,
                &human_actor_id,
                &format!("clamp deferred {i}"),
                &chrono::Utc::now().to_rfc3339(),
            );
        }
        let window = list_deferred_proposals(&conn, &project.id, 10_000_000, None)
            .expect("list_deferred_proposals should succeed");
        assert_eq!(
            window.proposals.len() as i64,
            core::query::authoring::MAX_LIMIT,
            "a 10,000,000 request must never reach SQLite as-is — it is clamped to MAX_LIMIT"
        );
    });
}

#[test]
fn all_five_status_counts_are_reported_including_merged_and_deferred() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let target_task = create_task(&mut conn, &project.id, &human_actor_id, "Merge target", None)
            .expect("create_task should succeed");

        let to_accept = create_proposal(
            &mut conn, &run_id, ProposalVerb::Create,
            ProposalPayload::Task { title: "counted accepted".to_string(), description: None, priority: None },
            None, None, ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        let to_reject = create_proposal(
            &mut conn, &run_id, ProposalVerb::Create,
            ProposalPayload::Task { title: "counted rejected".to_string(), description: None, priority: None },
            None, None, ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        let to_merge = create_proposal(
            &mut conn, &run_id, ProposalVerb::Create,
            ProposalPayload::Task { title: "counted merged".to_string(), description: None, priority: None },
            None, None, ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        let to_defer = create_proposal(
            &mut conn, &run_id, ProposalVerb::Create,
            ProposalPayload::Task { title: "counted deferred".to_string(), description: None, priority: None },
            None, None, ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        let _stays_pending = create_proposal(
            &mut conn, &run_id, ProposalVerb::Create,
            ProposalPayload::Task { title: "counted pending".to_string(), description: None, priority: None },
            None, None, ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");

        accept_proposal(&mut conn, &to_accept.id, &human_actor_id).expect("accept_proposal should succeed");
        reject_proposal(&mut conn, &to_reject.id, &human_actor_id, None).expect("reject_proposal should succeed");
        merge_proposal(&mut conn, &human_actor_id, &to_merge.id, &MergeTarget::Task(target_task.id.clone()))
            .expect("merge_proposal should succeed");
        defer_proposal(&mut conn, &human_actor_id, &to_defer.id).expect("defer_proposal should succeed");

        let window = list_pending_proposals(&conn, &project.id, 10, None).expect("list_pending_proposals should succeed");
        assert_eq!(window.counts.pending, 1);
        assert_eq!(window.counts.accepted, 1);
        assert_eq!(window.counts.rejected, 1);
        assert_eq!(window.counts.merged, 1, "a merged row must be counted, never invisible in the totals");
        assert_eq!(window.counts.deferred, 1, "a deferred row must be counted, never invisible in the totals");
    });
}

#[test]
fn pending_read_projection_carries_a_staged_proposals_rationale_turn_pointer_and_duplicate_verdict_intact() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Staged with full provenance".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance {
                rationale: Some("Found a real gap while executing".to_string()),
                origin_log_offset: Some(42),
            },
        )
        .expect("create_proposal should succeed");

        // Duplicate scoring is plan 06-04's own write path — this test pins that the PROJECTION
        // (`list_pending_proposals`, via `PROPOSAL_COLUMNS`/`row_to_proposal`) carries whatever is
        // in the row, not that the detector itself runs here. A direct UPDATE is the simplest way
        // to put a real value in both columns without re-deriving 06-04's own scoring pass.
        conn.execute(
            "UPDATE authoring_proposals SET duplicate_of = ?1, duplicate_score = ?2 WHERE id = ?3",
            params!["some-other-id", -30.5_f64, proposal.id],
        )
        .expect("UPDATE should succeed");

        let window = list_pending_proposals(&conn, &project.id, 10, None).expect("list_pending_proposals should succeed");
        let row = window
            .proposals
            .iter()
            .find(|p| p.id == proposal.id)
            .expect("staged proposal must appear in the pending window");

        assert_eq!(row.rationale.as_deref(), Some("Found a real gap while executing"));
        assert_eq!(row.origin_log_offset, Some(42));
        assert_eq!(row.duplicate_of.as_deref(), Some("some-other-id"));
        assert_eq!(row.duplicate_score, Some(-30.5));
    });
}
