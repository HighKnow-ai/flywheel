//! LINK-07 coverage (phase 07 plan 07-07): Task 1's transaction-scoped status writer and
//! restart-safe forge baseline, and Task 2's edge detector — the two forward transitions, the
//! three observations that move nothing, forward-only semantics, and the restart-survival case.
//! Every observation here is a synthetic `ForgeRequest` value — no subprocess, no network, so
//! this suite stays hermetic.

mod common;

use core::db::open_and_migrate;
use core::domain::acceptance_criterion::create_criterion;
use core::domain::actor::system_actor;
use core::domain::event::{append_event, next_sequence};
use core::domain::task::{create_task, set_task_status};
use core::forge::transitions::{
    apply_forge_observation, EVENT_DONE_WITH_UNMET_CRITERIA, EVENT_FORGE_CI_FAILED,
    EVENT_FORGE_STATE_CHANGED,
};
use core::forge::{CiResult, ForgeRequest, ForgeState};
use core::query::events::activity_trail;
use core::query::forge::{latest_forge_baseline, ForgeBaseline};
use rusqlite::Connection;

use common::seeded_project;

/// A synthetic observed request — no subprocess, no network (D-117's CONV-06 seam makes this the
/// right layer to test at: this suite never needs `gh`/`glab`).
fn request(state: ForgeState, ci: CiResult, number: i64) -> ForgeRequest {
    ForgeRequest {
        state,
        ci,
        number,
        title: format!("Request #{number}"),
        url: format!("https://example.invalid/pr/{number}"),
        ci_url: match ci {
            CiResult::None => None,
            _ => Some(format!("https://example.invalid/ci/{number}")),
        },
        is_draft: false,
        target_branch: "main".to_string(),
    }
}

fn count_events_of_type(conn: &Connection, task_id: &str, event_type: &str) -> usize {
    activity_trail(conn, "task", task_id, 200, 0)
        .expect("trail read should succeed")
        .into_iter()
        .filter(|e| e.event_type == event_type)
        .count()
}

// ---------------------------------------------------------------------------------------------
// Task 1: set_task_status's behaviour is unchanged by the set_task_status_in_tx extraction.
// ---------------------------------------------------------------------------------------------

#[test]
fn set_task_status_behavior_is_unchanged_by_the_extraction() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Status writer", None)
        .expect("create_task should succeed");

    // Redundant transition (new value == current value, "backlog"): no-op, no event, no
    // `updated_at` change — the guarantee set_task_status has always made.
    set_task_status(&mut conn, &actor_id, &task.id, "backlog")
        .expect("no-op status set should succeed");
    assert_eq!(count_events_of_type(&conn, &task.id, "task.status_changed"), 0);

    // A real transition writes exactly one event with the before/after payload shape.
    set_task_status(&mut conn, &actor_id, &task.id, "todo").expect("status set should succeed");
    let trail = activity_trail(&conn, "task", &task.id, 50, 0).expect("trail read should succeed");
    let status_events: Vec<_> =
        trail.iter().filter(|e| e.event_type == "task.status_changed").collect();
    assert_eq!(status_events.len(), 1);
    assert_eq!(status_events[0].payload["before"], "backlog");
    assert_eq!(status_events[0].payload["after"], "todo");
}

#[test]
fn invalid_status_is_still_rejected_by_the_schema_after_the_extraction() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Bad status", None)
        .expect("create_task should succeed");

    let result = set_task_status(&mut conn, &actor_id, &task.id, "archived");
    assert!(result.is_err(), "an out-of-vocabulary status should be rejected by the CHECK constraint");
}

// ---------------------------------------------------------------------------------------------
// Task 1: the restart-safe baseline, read directly against synthetic forge events.
// ---------------------------------------------------------------------------------------------

/// Append one synthetic forge-kind event directly, with the full `(state, ci)` observation in its
/// payload — the exact shape `apply_forge_observation` itself writes (see module header) — so
/// this fixture exercises `latest_forge_baseline` independently from the edge detector.
fn append_forge_event(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    task_id: &str,
    event_type: &str,
    state: ForgeState,
    ci: CiResult,
) {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().expect("transaction should open");
    let sequence = next_sequence(&tx, project_id, "local").expect("sequence should allocate");
    let payload = serde_json::json!({
        "state": format!("{state:?}"),
        "ci": format!("{ci:?}"),
        "label": "synthetic forge event",
    });
    append_event(
        &tx, project_id, "local", sequence, "task", task_id, Some(task_id), None, actor_id,
        event_type, &payload, &now,
    )
    .expect("append_event should succeed");
    tx.commit().expect("commit should succeed");
}

#[test]
fn baseline_for_task_with_no_forge_events_is_the_default() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "No forge events yet", None)
        .expect("create_task should succeed");

    let baseline = latest_forge_baseline(&conn, &task.id).expect("baseline read should succeed");
    assert_eq!(baseline, ForgeBaseline { state: ForgeState::None, ci: CiResult::None });
}

#[test]
fn baseline_returns_the_pair_the_latest_forge_event_recorded() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Open and pending", None)
        .expect("create_task should succeed");

    append_forge_event(
        &mut conn, &project.id, &actor_id, &task.id, EVENT_FORGE_STATE_CHANGED,
        ForgeState::Open, CiResult::Pending,
    );

    let baseline = latest_forge_baseline(&conn, &task.id).expect("baseline read should succeed");
    assert_eq!(baseline, ForgeBaseline { state: ForgeState::Open, ci: CiResult::Pending });
}

#[test]
fn baseline_orders_by_id_not_occurred_at() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Same-second events", None)
        .expect("create_task should succeed");

    // Two forge events landing in the same wall-clock second — `id` (ULID) ordering, not
    // `occurred_at`, must decide which one is "latest".
    append_forge_event(
        &mut conn, &project.id, &actor_id, &task.id, EVENT_FORGE_STATE_CHANGED,
        ForgeState::Open, CiResult::None,
    );
    append_forge_event(
        &mut conn, &project.id, &actor_id, &task.id, EVENT_FORGE_STATE_CHANGED,
        ForgeState::Merged, CiResult::Passed,
    );

    let baseline = latest_forge_baseline(&conn, &task.id).expect("baseline read should succeed");
    assert_eq!(baseline, ForgeBaseline { state: ForgeState::Merged, ci: CiResult::Passed });
}

#[test]
fn baseline_degrades_a_malformed_payload_to_the_default() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Malformed payload", None)
        .expect("create_task should succeed");

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().expect("transaction should open");
    let sequence = next_sequence(&tx, &project.id, "local").expect("sequence should allocate");
    let payload = serde_json::json!({ "state": 12345, "ci": true, "label": "wrong-typed fields" });
    append_event(
        &tx, &project.id, "local", sequence, "task", &task.id, Some(&task.id), None, &actor_id,
        EVENT_FORGE_STATE_CHANGED, &payload, &now,
    )
    .expect("append_event should succeed");
    tx.commit().expect("commit should succeed");

    let baseline = latest_forge_baseline(&conn, &task.id).expect("baseline read should succeed");
    assert_eq!(baseline, ForgeBaseline { state: ForgeState::None, ci: CiResult::None });
}

#[test]
fn baseline_survives_reopening_the_database() {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let task_id = {
        let mut conn =
            open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
        let actor_id = core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        let project = core::domain::project::create_project(
            &mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main",
        )
        .expect("create_project should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Restart baseline", None)
            .expect("create_task should succeed");
        append_forge_event(
            &mut conn, &project.id, &actor_id, &task.id, EVENT_FORGE_STATE_CHANGED,
            ForgeState::Open, CiResult::None,
        );
        task.id
    };

    // Reopen the same database file — a fresh `Connection`, not a retained in-memory value.
    let conn =
        open_and_migrate(&db_path, &backups_dir).expect("re-opening should succeed");
    let baseline = latest_forge_baseline(&conn, &task_id).expect("baseline read should succeed");
    assert_eq!(baseline, ForgeBaseline { state: ForgeState::Open, ci: CiResult::None });
}

// ---------------------------------------------------------------------------------------------
// Task 2: the edge detector.
// ---------------------------------------------------------------------------------------------

#[test]
fn open_against_a_none_baseline_moves_to_in_review_and_appends_one_event() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Opened", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 1)), &system.id,
    )
    .expect("apply_forge_observation should succeed");

    assert_eq!(outcome.status_changed_to, Some("in_review".to_string()));
    assert_eq!(outcome.events_appended, 1);
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_FORGE_STATE_CHANGED), 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "in_review");
}

#[test]
fn open_against_an_open_baseline_writes_nothing_at_all() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Already open", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 1)), &system.id,
    )
    .expect("first observation should succeed");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 1)), &system.id,
    )
    .expect("repeat observation should succeed");

    assert_eq!(outcome.status_changed_to, None);
    assert_eq!(outcome.events_appended, 0);
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_FORGE_STATE_CHANGED), 1);
}

#[test]
fn merged_against_an_open_baseline_moves_to_done_and_appends_one_event() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Open then merged", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 2)), &system.id,
    )
    .expect("open observation should succeed");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 2)), &system.id,
    )
    .expect("merge observation should succeed");

    assert_eq!(outcome.status_changed_to, Some("done".to_string()));
    assert_eq!(outcome.events_appended, 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "done");
}

#[test]
fn merged_against_a_none_baseline_still_reaches_done() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Opened and merged between polls", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 3)), &system.id,
    )
    .expect("merge observation should succeed");

    assert_eq!(outcome.status_changed_to, Some("done".to_string()));
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "done");
}

#[test]
fn a_manual_move_back_survives_a_subsequent_identical_observation() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Manual move back", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 4)), &system.id,
    )
    .expect("open observation should succeed");

    // The user moves it back by hand.
    set_task_status(&mut conn, &actor_id, &task.id, "in_progress")
        .expect("manual status set should succeed");

    // The SAME observation (Open, unchanged) is polled again — the level is never re-asserted.
    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 4)), &system.id,
    )
    .expect("repeat observation should succeed");

    assert_eq!(outcome.status_changed_to, None);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "in_progress");
}

#[test]
fn changes_requested_against_an_open_baseline_appends_an_event_and_leaves_status_untouched() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Changes requested", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 5)), &system.id,
    )
    .expect("open observation should succeed");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::ChangesRequested, CiResult::None, 5)), &system.id,
    )
    .expect("changes-requested observation should succeed");

    assert_eq!(outcome.status_changed_to, None);
    assert_eq!(outcome.events_appended, 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "in_review");
}

#[test]
fn closed_unmerged_appends_an_event_and_leaves_status_untouched() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Closed unmerged", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 6)), &system.id,
    )
    .expect("open observation should succeed");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::ClosedUnmerged, CiResult::None, 6)), &system.id,
    )
    .expect("closed-unmerged observation should succeed");

    assert_eq!(outcome.status_changed_to, None);
    assert_eq!(outcome.events_appended, 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "in_review");
}

#[test]
fn ci_failed_against_a_non_failed_baseline_appends_an_event_and_calls_no_status_writer() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "CI fails", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Pending, 7)), &system.id,
    )
    .expect("open observation should succeed");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Failed, 7)), &system.id,
    )
    .expect("ci-failed observation should succeed");

    assert_eq!(outcome.status_changed_to, None);
    assert_eq!(outcome.events_appended, 1);
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_FORGE_CI_FAILED), 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "in_review");
}

#[test]
fn ci_failed_against_an_already_failed_baseline_appends_no_second_event() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "CI already failed", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Failed, 8)), &system.id,
    )
    .expect("first ci-failed observation should succeed");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Failed, 8)), &system.id,
    )
    .expect("repeat ci-failed observation should succeed");

    assert_eq!(outcome.events_appended, 0);
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_FORGE_CI_FAILED), 1);
}

#[test]
fn merged_with_unmet_criteria_names_the_count_and_touches_no_criterion_row() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Unmet criteria", None)
        .expect("create_task should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "First", None)
        .expect("create_criterion should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Second", None)
        .expect("create_criterion should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 9)), &system.id,
    )
    .expect("merge observation should succeed");

    assert_eq!(outcome.status_changed_to, Some("done".to_string()));
    assert_eq!(outcome.events_appended, 2, "one state-change event plus one unmet-criteria event");
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_DONE_WITH_UNMET_CRITERIA), 1);

    let checked_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM acceptance_criteria WHERE parent_id = ?1 AND checked = 1",
            [&task.id],
            |row| row.get(0),
        )
        .expect("criteria read should succeed");
    assert_eq!(checked_count, 0, "merging must never check off a criterion on the user's behalf");
}

#[test]
fn merged_with_all_criteria_checked_appends_no_unmet_criteria_event() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "All checked", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    let outcome = apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 10)), &system.id,
    )
    .expect("merge observation should succeed");

    assert_eq!(outcome.events_appended, 1, "no criteria exist, so no unmet-criteria event");
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_DONE_WITH_UNMET_CRITERIA), 0);
}

#[test]
fn restart_between_the_open_and_merged_observations_still_produces_both_transitions() {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let task_id = {
        let mut conn =
            open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
        let actor_id = core::domain::actor::local_human_actor_id(&conn)
            .expect("seeded human actor should exist");
        let project = core::domain::project::create_project(
            &mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main",
        )
        .expect("create_project should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Restart transitions", None)
            .expect("create_task should succeed");
        let system = system_actor(&conn).expect("system actor should exist");
        apply_forge_observation(
            &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::None, 11)), &system.id,
        )
        .expect("open observation should succeed");
        task.id
    };

    // Reopen the database — a fresh `Connection`, not a retained in-memory baseline.
    let mut conn =
        open_and_migrate(&db_path, &backups_dir).expect("re-opening should succeed");
    let status_after_open: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status_after_open, "in_review");

    let system = system_actor(&conn).expect("system actor should exist");
    let outcome = apply_forge_observation(
        &mut conn, &task_id, Some(&request(ForgeState::Merged, CiResult::Passed, 11)), &system.id,
    )
    .expect("merge observation should succeed");

    assert_eq!(outcome.status_changed_to, Some("done".to_string()));
    let status_after_merge: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task_id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status_after_merge, "done");
}

#[test]
fn every_event_this_function_writes_carries_the_system_actor() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Actor stamped", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Failed, 12)), &system.id,
    )
    .expect("merge observation should succeed");

    let trail = activity_trail(&conn, "task", &task.id, 50, 0).expect("trail read should succeed");
    let forge_events: Vec<_> = trail
        .iter()
        .filter(|e| {
            e.event_type == EVENT_FORGE_STATE_CHANGED
                || e.event_type == EVENT_FORGE_CI_FAILED
                || e.event_type == "task.status_changed"
        })
        .collect();
    assert!(!forge_events.is_empty());
    assert!(forge_events.iter().all(|e| e.actor_id == system.id));
}

#[test]
fn none_against_a_merged_baseline_writes_nothing_and_moves_nothing() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Already merged", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 13)), &system.id,
    )
    .expect("merge observation should succeed");

    let outcome =
        apply_forge_observation(&mut conn, &task.id, None, &system.id)
            .expect("absent observation should succeed");

    assert_eq!(outcome.status_changed_to, None);
    assert_eq!(outcome.events_appended, 0);
    assert_eq!(count_events_of_type(&conn, &task.id, EVENT_FORGE_STATE_CHANGED), 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", [&task.id], |row| row.get(0))
        .expect("status read should succeed");
    assert_eq!(status, "done");
}

#[test]
fn applying_an_observation_for_a_deleted_task_writes_nothing_and_errors() {
    // The window plan 07-11 opens: a forge poll reads its work list under the lock, drops it,
    // polls the forge lock-free, then re-acquires the lock only to apply. If the task was deleted
    // (or re-staged away) in that window, the observation gathered before the window opened must
    // never write against a task that no longer exists — apply_forge_observation reads its baseline
    // and the task row inside the SAME transaction that would write the transition, so a missing
    // task row is an error, not a silent no-op write.
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Deleted mid-window", None)
        .expect("create_task should succeed");
    let system = system_actor(&conn).expect("system actor should exist");

    conn.execute("DELETE FROM tasks WHERE id = ?1", [&task.id])
        .expect("deleting the task row should succeed");

    let result = apply_forge_observation(
        &mut conn,
        &task.id,
        Some(&request(ForgeState::Open, CiResult::None, 1)),
        &system.id,
    );

    assert!(
        result.is_err(),
        "an observation for a task that no longer exists must error, not succeed"
    );
    assert_eq!(
        count_events_of_type(&conn, &task.id, EVENT_FORGE_STATE_CHANGED),
        0,
        "no event row of any kind must be written for the deleted task"
    );
}
