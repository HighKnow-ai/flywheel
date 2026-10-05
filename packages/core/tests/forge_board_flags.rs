//! `query::forge::board_forge_flags` coverage (phase 07 plan 07-08, D-124/D-123): the board's
//! bounded, log-only CI-failure/unmet-criteria rollup. Every observation here goes through the
//! real `apply_forge_observation` edge detector (07-07's own fixture) wherever possible, so this
//! suite exercises the SAME event shapes the running app actually writes — no hand-rolled payload
//! unless the test's own point is a malformed one. No subprocess, no network.

mod common;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::event::{append_event, next_sequence};
use core::domain::task::create_task;
use core::forge::transitions::apply_forge_observation;
use core::forge::{CiResult, ForgeRequest, ForgeState};
use core::query::forge::board_forge_flags;

use common::seeded_project;

/// A synthetic observed request — mirrors `status_transitions.rs`'s own `request` fixture.
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

#[test]
fn a_project_with_no_forge_events_returns_an_empty_flag_set() {
    let (conn, _actor_id, project) = seeded_project();
    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed");
    assert!(flags.is_empty());
}

#[test]
fn a_ci_failure_observation_raises_the_ci_failed_flag() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Red build", None)
        .expect("create_task should succeed");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Failed, 1)), &actor_id, None,
    )
    .expect("observation should apply");

    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed");
    assert_eq!(flags.len(), 1);
    assert_eq!(flags[0].task_id, task.id);
    assert!(flags[0].ci_failed);
    assert_eq!(flags[0].unmet_criteria, 0);
}

#[test]
fn a_later_state_changed_observation_recording_a_non_failing_ci_clears_the_flag() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Fixed build", None)
        .expect("create_task should succeed");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Failed, 1)), &actor_id, None,
    )
    .expect("first observation should apply");
    // A second observation recording Open/ChangesRequested against an already-Open baseline
    // writes no NEW forge.state_changed event (D-121's edge-triggered rule). Move the request to
    // ChangesRequested so the state itself changes — the CI field flips to Passed on the SAME
    // state_changed event, which is exactly the "later event recording a non-failing CI" case
    // this test is named for.
    apply_forge_observation(
        &mut conn,
        &task.id,
        Some(&request(ForgeState::ChangesRequested, CiResult::Passed, 1)),
        &actor_id, None,
    )
    .expect("second observation should apply");

    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed");
    assert!(flags.is_empty(), "the later non-failing observation should have cleared the flag");
}

#[test]
fn a_merge_with_unmet_criteria_raises_the_unmet_criteria_flag_with_its_payload_count() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Merged with gaps", None)
        .expect("create_task should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Unchecked one", None)
        .expect("create_criterion should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Unchecked two", None)
        .expect("create_criterion should succeed");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 7)), &actor_id, None,
    )
    .expect("merge observation should apply");

    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed");
    assert_eq!(flags.len(), 1);
    assert_eq!(flags[0].task_id, task.id);
    assert!(!flags[0].ci_failed);
    assert_eq!(flags[0].unmet_criteria, 2);
}

#[test]
fn a_merge_with_all_criteria_checked_raises_no_unmet_criteria_flag() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Clean merge", None)
        .expect("create_task should succeed");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Merged, CiResult::Passed, 8)), &actor_id, None,
    )
    .expect("merge observation should apply");

    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed");
    assert!(flags.is_empty(), "no criteria at all means nothing is unmet");
}

#[test]
fn the_result_is_bounded_by_the_requested_limit() {
    let (mut conn, actor_id, project) = seeded_project();
    for i in 0..5 {
        let task = create_task(&mut conn, &project.id, &actor_id, &format!("Red build {i}"), None)
            .expect("create_task should succeed");
        apply_forge_observation(
            &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Failed, i)), &actor_id, None,
        )
        .expect("observation should apply");
    }

    let flags = board_forge_flags(&conn, &project.id, 2).expect("read should succeed");
    assert_eq!(flags.len(), 2, "the limit bounds the distinct tasks considered, never widened after the fact");
}

#[test]
fn a_malformed_ci_bearing_payload_degrades_to_no_flag_for_that_task_rather_than_erroring_the_read() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Malformed payload", None)
        .expect("create_task should succeed");

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction().expect("transaction should open");
    let sequence = next_sequence(&tx, &project.id, "local").expect("sequence should allocate");
    let payload = serde_json::json!({ "ci": 12345, "label": "wrong-typed ci field" });
    append_event(
        &tx, &project.id, "local", sequence, "task", &task.id, Some(&task.id), None, &actor_id,
        "forge.ci_failed", &payload, &now,
    )
    .expect("append_event should succeed");
    tx.commit().expect("commit should succeed");

    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed — never errors on a malformed payload");
    assert!(flags.is_empty(), "a malformed ci field degrades to no flag for that task");
}

#[test]
fn a_task_with_only_a_non_failing_observation_and_no_unmet_criteria_raises_no_flag() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Green and clean", None)
        .expect("create_task should succeed");

    apply_forge_observation(
        &mut conn, &task.id, Some(&request(ForgeState::Open, CiResult::Passed, 9)), &actor_id, None,
    )
    .expect("observation should apply");

    let flags = board_forge_flags(&conn, &project.id, 200).expect("read should succeed");
    assert!(flags.is_empty(), "an Open request with passing CI and no unmet criteria raises nothing");
}
