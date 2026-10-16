//! Phase 15 plan 15-03 (DRFT-12): the account-limit gate's two numeric contracts, pinned at and
//! either side of each threshold.
//!
//! These are characterisation tests. `limit_gate.rs` is the AGNT-05 contract and this target does not
//! move it: where an edge falls is recorded here, in the test's own name, as what the code does.
//! `dispatch_limit_gate.rs` holds the behaviour corpus; this file only adds the boundaries that corpus
//! reaches by a margin (a floor tested at `FLOOR - 1` and `FLOOR`, never at `FLOOR + 1`; a magnitude
//! test checked at 1.79e9 and 1.79e12, never at the threshold itself).
//!
//! The two thresholds are read, never restated: `DISPATCH_REJECT_FLOOR_SECS` is a public const of the
//! crate. `MILLISECONDS_THRESHOLD` is private to `limit_gate`, so `MS_THRESHOLD` below is the one
//! mirror of it and `the_millisecond_threshold_mirror_is_the_edge_the_code_implements` fails if the
//! two ever drift apart.

mod common;

use core::limit_gate::{
    apply_rate_limit_signal, apply_rate_limit_signal_for_run, may_advance, may_spawn, normalise_resets_at,
    read_gate, resume_if_due, GateReason, GateState, LimitSignal, LimitTier, DISPATCH_REJECT_FLOOR_SECS,
};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};
use serde_json::json;

const NOW: i64 = 1_791_000_000;
/// A reset comfortably in the future of every clock reading below.
const RESET: i64 = NOW + 1_000_000;
/// Mirror of `limit_gate::MILLISECONDS_THRESHOLD` (private); pinned by the edge test below.
const MS_THRESHOLD: i64 = 100_000_000_000;

fn rejected(resets_at: Option<i64>) -> LimitSignal {
    LimitSignal { tier: LimitTier::Rejected, window: Some("five_hour".into()), resets_at }
}

/// Drive a real time-driven resume (pause on a past reset, then `resume_if_due`), so the stored
/// `Open { resumed_at }` is the one the production path writes and not a hand-seeded row. Returns the
/// instant the resume was recorded at.
fn time_driven_resume(conn: &mut Connection) -> i64 {
    apply_rate_limit_signal(conn, &rejected(Some(NOW - 60)), NOW).unwrap();
    let resumed = resume_if_due(conn, NOW + 1).unwrap();
    assert!(resumed.changed);
    let GateState::Open { resumed_at: Some(t) } = resumed.after else { panic!("{:?}", resumed.after) };
    t
}

// --- the reject floor ------------------------------------------------------------------------

#[test]
fn the_reject_floor_is_read_from_the_crate() {
    // The sanity bound, not a pin on the value: the floor must be a positive number of seconds and
    // short enough that a limit window (hours) is never mistaken for it. The assertions below move
    // with the const, so changing it moves the boundary under test and not the test.
    assert!(DISPATCH_REJECT_FLOOR_SECS > 0);
    assert!(DISPATCH_REJECT_FLOOR_SECS < 3600);
}

#[test]
fn a_rejection_one_second_inside_the_floor_pauses_for_manual_resume_with_no_resume_instant() {
    let (mut conn, _a, _p) = common::seeded_project();
    let t = time_driven_resume(&mut conn);
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), t + DISPATCH_REJECT_FLOOR_SECS - 1).unwrap();
    assert!(
        matches!(change.after, GateState::Paused { reason: GateReason::RejectedAgain, resume_at: None, .. }),
        "{:?}",
        change.after
    );
}

#[test]
fn a_rejection_exactly_at_the_floor_falls_on_the_outside_and_pauses_with_the_wires_reset_instant() {
    // The comparison is `now - resumed_at < FLOOR`, so the floor itself is already outside it.
    let (mut conn, _a, _p) = common::seeded_project();
    let t = time_driven_resume(&mut conn);
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), t + DISPATCH_REJECT_FLOOR_SECS).unwrap();
    assert!(
        matches!(change.after, GateState::Paused { reason: GateReason::LimitReached, resume_at: Some(r), .. } if r == RESET),
        "{:?}",
        change.after
    );
}

#[test]
fn a_rejection_one_second_past_the_floor_pauses_with_the_wires_reset_instant() {
    let (mut conn, _a, _p) = common::seeded_project();
    let t = time_driven_resume(&mut conn);
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), t + DISPATCH_REJECT_FLOOR_SECS + 1).unwrap();
    assert!(
        matches!(change.after, GateState::Paused { reason: GateReason::LimitReached, resume_at: Some(r), .. } if r == RESET),
        "{:?}",
        change.after
    );
}

// --- normalise_resets_at ---------------------------------------------------------------------

#[test]
fn the_millisecond_threshold_mirror_is_the_edge_the_code_implements() {
    // One above the mirror reads as milliseconds (divided by 1000), the mirror itself as seconds.
    // If limit_gate moved its constant, one of these two would flip.
    assert_eq!(normalise_resets_at(&json!(MS_THRESHOLD)), Some(MS_THRESHOLD));
    assert_eq!(normalise_resets_at(&json!(MS_THRESHOLD + 1000)), Some(MS_THRESHOLD / 1000 + 1));
}

#[test]
fn a_value_just_below_the_threshold_reads_as_seconds() {
    assert_eq!(normalise_resets_at(&json!(MS_THRESHOLD - 1)), Some(MS_THRESHOLD - 1));
}

#[test]
fn a_value_just_above_the_threshold_reads_as_milliseconds() {
    assert_eq!(normalise_resets_at(&json!(MS_THRESHOLD + 5_000)), Some(MS_THRESHOLD / 1000 + 5));
}

#[test]
fn a_value_exactly_at_the_threshold_reads_as_seconds_because_the_test_is_strictly_greater() {
    assert_eq!(normalise_resets_at(&json!(MS_THRESHOLD)), Some(MS_THRESHOLD));
}

#[test]
fn a_fractional_millisecond_value_floors_to_whole_seconds() {
    assert_eq!(normalise_resets_at(&json!((MS_THRESHOLD + 1_999) as f64)), Some(MS_THRESHOLD / 1000 + 1));
}

#[test]
fn an_absent_reset_time_yields_no_resume_instant() {
    let signal = LimitSignal::from_event(&json!({"type":"rate_limit","tier":"rejected","rateLimitType":"five_hour"})).unwrap();
    assert_eq!(signal.resets_at, None);
    let (mut conn, _a, _p) = common::seeded_project();
    let change = apply_rate_limit_signal(&mut conn, &signal, NOW).unwrap();
    assert!(matches!(change.after, GateState::Paused { reason: GateReason::ResetUnknown, resume_at: None, .. }));
}

#[test]
fn a_non_numeric_reset_time_yields_no_guessed_wait() {
    for raw in [json!("1791538200"), json!(true), json!([1_791_538_200]), json!({"at": 1}), json!(null)] {
        assert_eq!(normalise_resets_at(&raw), None, "{raw} must not become a wait");
    }
}

#[test]
fn nan_negative_and_zero_reset_times_yield_no_resume_instant() {
    // serde_json cannot carry NaN as a number: it collapses to null, which is also absent.
    for raw in [json!(f64::NAN), json!(f64::INFINITY), json!(-1), json!(-0.5), json!(0), json!(0.0)] {
        assert_eq!(normalise_resets_at(&raw), None, "{raw} must not become a wait");
    }
}

// --- the gate writes no run status -----------------------------------------------------------

#[test]
fn a_paused_gate_refuses_both_a_spawn_and_an_automatic_advance() {
    // DISCREPANCY with 15-03-PLAN.md, which says may_advance stays true under Paused. The code says
    // `may_advance == is_open()`, so a pause stops the cursor as well as the spawn; manual dispatch is
    // a separate, ungated action (see the doc on `may_advance`). Asserted as implemented.
    let paused = GateState::Paused { reason: GateReason::LimitReached, window: None, resume_at: Some(RESET) };
    assert!(!may_spawn(&paused));
    assert!(!may_advance(&paused), "a pause stops the cursor too: may_advance is open-only");
}

#[test]
fn applying_a_rejected_signal_leaves_every_agent_run_status_byte_identical() {
    let (mut conn, actor, project) = common::seeded_project();
    let triggering = insert_run(&mut conn, &actor, &project.id, "running");
    for status in ["running", "blocked", "completed", "failed", "interrupted", "abandoned"] {
        insert_run(&mut conn, &actor, &project.id, status);
    }
    let before = run_statuses(&conn);
    assert_eq!(before.len(), 7);

    let change = apply_rate_limit_signal_for_run(&mut conn, &triggering, &rejected(Some(RESET)), NOW).unwrap();
    assert!(change.changed, "the gate did move, so the comparison below is not vacuous");
    assert!(matches!(read_gate(&conn, NOW).unwrap(), GateState::Paused { .. }));

    assert_eq!(run_statuses(&conn), before);
}

fn run_statuses(conn: &Connection) -> Vec<(String, String)> {
    let mut stmt = conn.prepare("SELECT id, status FROM agent_runs ORDER BY id").unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).unwrap();
    rows.map(|r| r.unwrap()).collect()
}

/// A raw `agent_runs` row (a real launch needs a git repository; the gate only cares that the run
/// exists, belongs to a project and is left alone).
fn insert_run(conn: &mut Connection, actor: &str, project_id: &str, status: &str) -> String {
    let task = create_task(conn, project_id, actor, "T", None).unwrap();
    let trigger_id = new_id();
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, created_by, created_at)
         VALUES (?1, ?2, ?3, NULL, 'user_action', ?4, 'now')",
        params![trigger_id, project_id, task.id, actor],
    )
    .unwrap();
    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (id, task_id, project_id, trigger_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'default', '/dev/null', 'now')",
        params![run_id, task.id, project_id, trigger_id, actor, status],
    )
    .unwrap();
    run_id
}
