//! Phase 14 plan 14-06 (RECD-10, D-07): scope drift is DERIVED from the append-only event log, so
//! a swap (one epic out, one in) is visible, which a stored baseline count would net to nothing.
//! The two cases that decide the design are `a_swap_is_one_added_and_one_removed` and
//! `an_event_at_the_start_timestamp_is_resolved_by_the_stated_tie_rule`.
//!
//! The tie rule, stated once and quoted by the tie test: an event counts as "after the start" when
//! its `occurred_at` is later than the start event's, or the two are equal, from the same origin,
//! and the event has the higher `sequence`; an equal timestamp from a different origin does not
//! count (`sequence` is only comparable inside one `(project, origin)` stream).
//!
//! Self-contained per this repo's precedent: the only shared helper is `common::seeded_project`.

mod common;

use core::domain::cycle::{assign_epic_to_cycle, create_cycle, remove_epic_from_cycle, start_cycle};
use core::domain::epic::create_epic;
use core::domain::event::{append_event, next_sequence};
use core::query::cycle_scope::{cycle_scope_drift, cycle_scope_sentence, CycleScopeDrift};
use rusqlite::Connection;

use common::seeded_project;

const START: &str = "2026-03-01T10:00:00.000000000+00:00";
const AFTER: &str = "2026-03-01T10:00:01.000000000+00:00";
const BEFORE: &str = "2026-03-01T09:59:59.000000000+00:00";

struct Fx {
    conn: Connection,
    actor_id: String,
    project_id: String,
}

impl Fx {
    fn new() -> Self {
        let (conn, actor_id, project) = seeded_project();
        Fx { conn, actor_id, project_id: project.id }
    }
    fn cycle(&mut self) -> String {
        create_cycle(&mut self.conn, &self.project_id, "Ship it", &self.actor_id).unwrap().id
    }
    fn epic(&mut self, title: &str) -> String {
        create_epic(&mut self.conn, &self.project_id, &self.actor_id, title, None).unwrap().id
    }
    /// Append one hand-timed event on the given origin, the way the real writers do.
    fn event(&mut self, origin: &str, stream_id: &str, epic: Option<&str>, kind: &str, before: Option<&str>, after: Option<&str>, at: &str) {
        let tx = self.conn.transaction().unwrap();
        let seq = next_sequence(&tx, &self.project_id, origin).unwrap();
        let payload = serde_json::json!({ "field": "cycle_id", "before": before, "after": after });
        append_event(&tx, &self.project_id, origin, seq, "cycle", stream_id, None, epic, &self.actor_id, kind, &payload, at).unwrap();
        tx.commit().unwrap();
    }
    fn started_at(&mut self, cycle: &str, at: &str) {
        self.event("local", cycle, None, "cycle.started", None, None, at);
    }
    fn assigned(&mut self, cycle: &str, epic: &str, at: &str) {
        self.event("local", cycle, Some(epic), "cycle.epic_assigned", None, Some(cycle), at);
    }
    fn removed(&mut self, cycle: &str, epic: &str, at: &str) {
        self.event("local", cycle, Some(epic), "cycle.epic_removed", Some(cycle), None, at);
    }
    fn drift(&self, cycle: &str) -> Option<CycleScopeDrift> {
        cycle_scope_drift(&self.conn, cycle).unwrap()
    }
}

fn d(added: u32, removed: u32) -> Option<CycleScopeDrift> {
    Some(CycleScopeDrift { epics_added: added, epics_removed: removed })
}

#[test]
fn a_cycle_that_never_started_reports_no_drift_at_all() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    let e = fx.epic("A");
    assign_epic_to_cycle(&mut fx.conn, &e, &c, &fx.actor_id.clone()).unwrap();
    assert_eq!(fx.drift(&c), None, "no start event means no moment to measure from");
}

#[test]
fn a_started_cycle_with_no_assignment_events_since_reports_no_drift() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    fx.started_at(&c, START);
    assert_eq!(fx.drift(&c), None);
}

#[test]
fn two_added_and_one_removed_after_the_start_are_reported_exactly() {
    let mut fx = Fx::new();
    let (c, a, b, x) = (fx.cycle(), fx.epic("A"), fx.epic("B"), fx.epic("X"));
    fx.started_at(&c, START);
    fx.assigned(&c, &a, AFTER);
    fx.assigned(&c, &b, AFTER);
    fx.removed(&c, &x, AFTER);
    assert_eq!(fx.drift(&c), d(2, 1));
}

#[test]
fn a_swap_is_one_added_and_one_removed() {
    // The case that decides the design. Real writers, real clock: epic X is in the Cycle when it
    // starts, then X goes out and Y comes in. The epic COUNT is unchanged, so a stored baseline
    // count reports no change at all; the log reports one added and one removed.
    let mut fx = Fx::new();
    let actor = fx.actor_id.clone();
    let (c, x, y) = (fx.cycle(), fx.epic("X"), fx.epic("Y"));
    assign_epic_to_cycle(&mut fx.conn, &x, &c, &actor).unwrap();
    start_cycle(&mut fx.conn, &c, &actor).unwrap();
    remove_epic_from_cycle(&mut fx.conn, &x, &actor).unwrap();
    assign_epic_to_cycle(&mut fx.conn, &y, &c, &actor).unwrap();
    let epics_now: i64 = fx.conn.query_row("SELECT COUNT(*) FROM epics WHERE cycle_id = ?1", [&c], |r| r.get(0)).unwrap();
    assert_eq!(epics_now, 1, "the net epic count did not move");
    assert_eq!(fx.drift(&c), d(1, 1));
}

#[test]
fn an_epic_assigned_before_the_start_contributes_nothing() {
    let mut fx = Fx::new();
    let (c, a) = (fx.cycle(), fx.epic("A"));
    fx.assigned(&c, &a, BEFORE);
    fx.started_at(&c, START);
    assert_eq!(fx.drift(&c), None);
}

#[test]
fn an_epic_assigned_in_then_out_after_the_start_counts_in_both() {
    // Intended reading (flagged assumption): the log counts EVENTS, not the net difference. Both
    // things happened and the log is append-only, so both counts move.
    let mut fx = Fx::new();
    let (c, a) = (fx.cycle(), fx.epic("A"));
    fx.started_at(&c, START);
    fx.assigned(&c, &a, AFTER);
    fx.removed(&c, &a, "2026-03-01T10:00:02.000000000+00:00");
    assert_eq!(fx.drift(&c), d(1, 1));
}

#[test]
fn an_event_at_the_start_timestamp_is_resolved_by_the_stated_tie_rule() {
    // Rule: equal timestamp, same origin, higher sequence counts; lower sequence does not.
    let mut fx = Fx::new();
    let (c, early, late) = (fx.cycle(), fx.epic("Early"), fx.epic("Late"));
    fx.assigned(&c, &early, START); // sequence below the start's, same timestamp: before it
    fx.started_at(&c, START);
    fx.assigned(&c, &late, START); // sequence above the start's, same timestamp: after it
    assert_eq!(fx.drift(&c), d(1, 0));
}

#[test]
fn an_equal_timestamp_from_another_origin_does_not_count() {
    // Sequences of different origins cannot be compared, so the rule counts only a strictly later
    // timestamp across origins.
    let mut fx = Fx::new();
    let (c, a) = (fx.cycle(), fx.epic("A"));
    fx.started_at(&c, START);
    fx.event("relay", &c, Some(&a), "cycle.epic_assigned", None, Some(&c), START);
    assert_eq!(fx.drift(&c), None);
    fx.event("relay", &c, Some(&a), "cycle.epic_assigned", None, Some(&c), AFTER);
    assert_eq!(fx.drift(&c), d(1, 0));
}

#[test]
fn an_epic_moved_out_to_another_cycle_counts_as_removed_here() {
    // `assign_epic_to_cycle` writes ONE event on the NEW Cycle with the old id in `before`, so the
    // old Cycle's loss is only visible there.
    let mut fx = Fx::new();
    let actor = fx.actor_id.clone();
    let (c1, c2, x) = (fx.cycle(), fx.cycle(), fx.epic("X"));
    assign_epic_to_cycle(&mut fx.conn, &x, &c1, &actor).unwrap();
    start_cycle(&mut fx.conn, &c1, &actor).unwrap();
    assign_epic_to_cycle(&mut fx.conn, &x, &c2, &actor).unwrap();
    assert_eq!(fx.drift(&c1), d(0, 1));
    assert_eq!(fx.drift(&c2), None, "c2 never started");
}

#[test]
fn another_cycles_events_are_not_counted() {
    let mut fx = Fx::new();
    let (c1, c2, a) = (fx.cycle(), fx.cycle(), fx.epic("A"));
    fx.started_at(&c1, START);
    fx.started_at(&c2, START);
    fx.assigned(&c2, &a, AFTER);
    assert_eq!(fx.drift(&c1), None);
    assert_eq!(fx.drift(&c2), d(1, 0));
}

#[test]
fn two_reads_over_unchanged_events_are_equal() {
    let mut fx = Fx::new();
    let (c, a) = (fx.cycle(), fx.epic("A"));
    fx.started_at(&c, START);
    fx.assigned(&c, &a, START);
    fx.assigned(&c, &a, START);
    assert_eq!(fx.drift(&c), fx.drift(&c));
}

#[test]
fn the_sentence_states_the_arithmetic_and_names_only_the_nonzero_half() {
    let s = |a, r| cycle_scope_sentence(&CycleScopeDrift { epics_added: a, epics_removed: r });
    assert_eq!(s(2, 1), "2 epics added, 1 removed since this Cycle started");
    assert_eq!(s(1, 1), "1 epic added, 1 removed since this Cycle started");
    assert_eq!(s(3, 0), "3 epics added since this Cycle started");
    assert_eq!(s(0, 1), "1 epic removed since this Cycle started");
}
