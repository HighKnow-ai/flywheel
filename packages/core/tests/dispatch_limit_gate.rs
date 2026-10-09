//! Phase 09 plan 09-05 (AGNT-05, D-160/D-161/D-162): the account-limit gate.
//!
//! WHAT IS AND IS NOT OBSERVED. No hard rate limit has ever been observed live in this project. Every
//! `Rejected` signal below is constructed from the documented shape; the live presentation of a real
//! hard limit is unconfirmed. The one real capture is an `allowed` event carrying an overage status of
//! rejected, which the adapter seam turns into tier `open`; its Rust-side consequence (no change, no
//! write) is asserted here.
//!
//! The gate pauses NEW dispatch only. Nothing in these tests, or in the module, stops a session.

mod common;

use core::limit_gate::{
    apply_rate_limit_signal, apply_rate_limit_signal_for_run, normalise_resets_at, read_gate, GateReason,
    GateState, LimitSignal, LimitTier, DISPATCH_REJECT_FLOOR_SECS, SETTING_DISPATCH_GATE,
};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};
use serde_json::json;

const NOW: i64 = 1_791_000_000;
const RESET: i64 = 1_791_538_200;

fn rejected(resets_at: Option<i64>) -> LimitSignal {
    LimitSignal { tier: LimitTier::Rejected, window: Some("five_hour".into()), resets_at }
}

fn gate_row_updated_at(conn: &Connection) -> Option<String> {
    conn.query_row("SELECT updated_at FROM settings WHERE key = ?1", params![SETTING_DISPATCH_GATE], |r| r.get(0))
        .ok()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

// --- normalise_resets_at ---------------------------------------------------------------------

#[test]
fn seconds_and_milliseconds_read_as_the_same_instant() {
    assert_eq!(normalise_resets_at(&json!(1_791_538_200_i64)), Some(1_791_538_200));
    assert_eq!(normalise_resets_at(&json!(1_791_538_200_000_i64)), Some(1_791_538_200));
}

#[test]
fn a_string_zero_negative_null_and_nan_shaped_values_read_as_absent() {
    for raw in [json!("1791538200"), json!(0), json!(-5), json!(null), json!(true), json!([1]), json!(-1.5)] {
        assert_eq!(normalise_resets_at(&raw), None, "{raw} must read as absent");
    }
}

// --- from_event: the normalised signal, never wire text --------------------------------------

#[test]
fn a_rate_limit_event_with_a_tier_becomes_a_signal_with_its_window_and_reset() {
    let s = LimitSignal::from_event(
        &json!({"type":"rate_limit","tier":"rejected","rateLimitType":"five_hour","resetsAt":RESET}),
    )
    .unwrap();
    assert_eq!(s, rejected(Some(RESET)));
}

#[test]
fn an_assistant_message_carrying_the_rejected_tier_becomes_a_signal_with_no_reset() {
    let s = LimitSignal::from_event(&json!({"type":"assistant_text","text":"x","rateLimitTier":"rejected"})).unwrap();
    assert_eq!(s.tier, LimitTier::Rejected);
    assert_eq!(s.resets_at, None);
}

#[test]
fn an_event_with_no_tier_or_an_unknown_one_is_not_a_signal() {
    assert!(LimitSignal::from_event(&json!({"type":"rate_limit","status":"rejected"})).is_none());
    assert!(LimitSignal::from_event(&json!({"type":"rate_limit","tier":"banana"})).is_none());
    assert!(LimitSignal::from_event(&json!({"type":"assistant_text","text":"x"})).is_none());
}

#[test]
fn the_observed_allowed_event_after_the_seam_changes_nothing_and_writes_nothing() {
    // After the adapter seam the observed event is `tier: open`; its overage status never reaches Rust.
    let (mut conn, _a, _p) = common::seeded_project();
    let signal = LimitSignal::from_event(
        &json!({"type":"rate_limit","tier":"open","rateLimitType":"five_hour","resetsAt":RESET}),
    )
    .unwrap();
    let change = apply_rate_limit_signal(&mut conn, &signal, NOW).unwrap();
    assert!(!change.changed);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings WHERE key = 'dispatch_gate'"), 0);
}

// --- the hard tier ---------------------------------------------------------------------------

#[test]
fn a_rejected_signal_with_a_future_reset_pauses_until_that_instant_naming_the_window() {
    let (mut conn, _a, _p) = common::seeded_project();
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), NOW).unwrap();
    assert!(change.changed);
    assert_eq!(
        change.after,
        GateState::Paused {
            reason: GateReason::LimitReached,
            window: Some("five_hour".into()),
            resume_at: Some(RESET)
        }
    );
    assert_eq!(read_gate(&conn, NOW).unwrap(), change.after);
}

#[test]
fn a_rejected_signal_with_no_usable_reset_pauses_with_no_resume_instant_and_says_the_reset_is_unknown() {
    let (mut conn, _a, _p) = common::seeded_project();
    let change = apply_rate_limit_signal(&mut conn, &rejected(None), NOW).unwrap();
    assert_eq!(
        change.after,
        GateState::Paused { reason: GateReason::ResetUnknown, window: Some("five_hour".into()), resume_at: None }
    );
    assert!(change.after.message().contains("reset time is unknown"), "{}", change.after.message());
}

#[test]
fn a_rejected_signal_from_an_assistant_message_pauses_the_gate() {
    let (mut conn, _a, _p) = common::seeded_project();
    let signal = LimitSignal::from_event(&json!({"type":"assistant_text","text":"x","rateLimitTier":"rejected"})).unwrap();
    let change = apply_rate_limit_signal(&mut conn, &signal, NOW).unwrap();
    assert!(matches!(change.after, GateState::Paused { reason: GateReason::ResetUnknown, .. }));
}

#[test]
fn a_reset_already_in_the_past_pauses_for_zero_time() {
    let (mut conn, _a, _p) = common::seeded_project();
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(NOW - 60)), NOW).unwrap();
    assert!(matches!(change.after, GateState::Paused { reason: GateReason::LimitReached, resume_at: Some(t), .. } if t == NOW));
}

#[test]
fn fifty_identical_signals_write_the_gate_row_exactly_once() {
    let (mut conn, _a, _p) = common::seeded_project();
    let mut changes = 0;
    let mut stamps = std::collections::BTreeSet::new();
    for _ in 0..50 {
        if apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), NOW).unwrap().changed {
            changes += 1;
        }
        stamps.insert(gate_row_updated_at(&conn));
    }
    assert_eq!(changes, 1);
    assert_eq!(stamps.len(), 1, "one timestamp across all fifty, so the row was written once");
    assert!(stamps.iter().next().unwrap().is_some());
}

#[test]
fn fifty_identical_past_reset_signals_also_write_once() {
    let (mut conn, _a, _p) = common::seeded_project();
    let changes = (0..50)
        .filter(|i| apply_rate_limit_signal(&mut conn, &rejected(Some(NOW - 60)), NOW + i).unwrap().changed)
        .count();
    assert_eq!(changes, 1);
}

#[test]
fn a_rejection_within_the_floor_of_a_time_driven_resume_pauses_for_manual_resume() {
    let (mut conn, _a, _p) = common::seeded_project();
    // A prior time-driven resume at NOW, stored as the gate's own memory of it.
    seed_gate(&conn, &GateState::Open { resumed_at: Some(NOW) });
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(NOW - 1)), NOW + DISPATCH_REJECT_FLOOR_SECS - 1).unwrap();
    assert!(matches!(change.after, GateState::Paused { reason: GateReason::RejectedAgain, resume_at: None, .. }));
    assert!(change.after.message().contains("until you resume"), "{}", change.after.message());
    // And a later rejection does not turn that back into a timed pause.
    let again = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), NOW + 500).unwrap();
    assert!(!again.changed);
}

#[test]
fn a_rejection_after_the_floor_pauses_normally() {
    let (mut conn, _a, _p) = common::seeded_project();
    seed_gate(&conn, &GateState::Open { resumed_at: Some(NOW) });
    let change = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), NOW + DISPATCH_REJECT_FLOOR_SECS).unwrap();
    assert!(matches!(change.after, GateState::Paused { reason: GateReason::LimitReached, resume_at: Some(t), .. } if t == RESET));
}

#[test]
fn a_known_reset_upgrades_an_unknown_one_but_never_shortens_a_known_one() {
    let (mut conn, _a, _p) = common::seeded_project();
    apply_rate_limit_signal(&mut conn, &rejected(None), NOW).unwrap();
    let up = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), NOW).unwrap();
    assert!(matches!(up.after, GateState::Paused { resume_at: Some(t), .. } if t == RESET));
    let shorter = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET - 100)), NOW).unwrap();
    assert!(!shorter.changed);
    let longer = apply_rate_limit_signal(&mut conn, &rejected(Some(RESET + 100)), NOW).unwrap();
    assert!(matches!(longer.after, GateState::Paused { resume_at: Some(t), .. } if t == RESET + 100));
}

// --- the gate never reaches a running session -----------------------------------------------

#[test]
fn pausing_changes_no_agent_run_and_the_stored_state_survives_reopening() {
    let (mut conn, _a, _p) = common::seeded_project();
    let before = count(&conn, "SELECT COUNT(*) FROM agent_runs");
    apply_rate_limit_signal(&mut conn, &rejected(Some(RESET)), NOW).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM agent_runs"), before);
    assert!(matches!(read_gate(&conn, NOW).unwrap(), GateState::Paused { .. }));
}

#[test]
fn applying_for_a_run_appends_one_event_to_its_project_stream_only_on_a_change() {
    let (mut conn, actor, project) = common::seeded_project();
    let run_id = insert_running_run(&mut conn, &actor, &project.id);
    let first = apply_rate_limit_signal_for_run(&mut conn, &run_id, &rejected(Some(RESET)), NOW).unwrap();
    let second = apply_rate_limit_signal_for_run(&mut conn, &run_id, &rejected(Some(RESET)), NOW).unwrap();
    assert!(first.changed && !second.changed);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'dispatch.gate_changed'"), 1);
    let status: String = conn.query_row("SELECT status FROM agent_runs WHERE id = ?1", params![run_id], |r| r.get(0)).unwrap();
    assert_eq!(status, "running", "a pause leaves the running session exactly as it was");
}

/// Write a gate state straight into the settings row, as a prior session would have left it.
fn seed_gate(conn: &Connection, state: &GateState) {
    let actor: String = conn.query_row("SELECT id FROM actors WHERE type = 'system' LIMIT 1", [], |r| r.get(0)).unwrap();
    conn.execute(
        "INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, 'seed')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![SETTING_DISPATCH_GATE, serde_json::to_string(state).unwrap(), actor],
    )
    .unwrap();
}

/// A raw running `agent_runs` row (a real launch needs a git repository; the gate only cares that the
/// run exists, belongs to a project, and is left alone).
fn insert_running_run(conn: &mut Connection, actor: &str, project_id: &str) -> String {
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
         VALUES (?1, ?2, ?3, ?4, ?5, 'running', 'default', '/dev/null', 'now')",
        params![run_id, task.id, project_id, trigger_id, actor],
    )
    .unwrap();
    run_id
}
