//! Scope drift (RECD-10, D-07): how many epics a Cycle gained and lost after it started, derived
//! from the append-only `events` log. Nothing is stored and no column exists for it (the `cycles`
//! DDL is pinned in `tests/spine_pin.rs`): a stored baseline count would net a swap (one epic out,
//! one in) to nothing, and a flag could not say how much changed. Counting events can.
//!
//! "Added" is a `cycle.epic_assigned` event on this Cycle whose `before` is not this Cycle.
//! "Removed" is a `cycle.epic_removed` event on this Cycle, or a `cycle.epic_assigned` event on
//! ANOTHER Cycle whose `before` is this one (a move writes one event, on the Cycle it moved to).
//! Event names are the ones `domain::cycle`'s module header declares.

use rusqlite::{params, Connection};

/// What changed in a started Cycle's scope. Never zero on both sides: that case is `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CycleScopeDrift {
    pub epics_added: u32,
    pub epics_removed: u32,
}

/// The drift since the Cycle's `cycle.started` event, or `None` when there is nothing to report:
/// the Cycle never started (no moment to measure from) or nothing was assigned or removed since.
/// An absence is a different fact from a pair of zeroes, the same honesty rule `EpicHeaderRow.tsx`
/// states one level down ("no criteria yet" rather than a percentage that lies).
///
/// It counts EVENTS, not the net difference: an epic assigned in and out again after the start
/// counts in both, because both things happened and the log is append-only. That is the intended
/// reading, and what makes a swap visible.
///
/// Tie rule: an event counts as after the start when its `occurred_at` is later than the start
/// event's, or the two are equal, from the same origin, and the event has the higher `sequence`;
/// an equal timestamp from a different origin does not count.
pub fn cycle_scope_drift(conn: &Connection, cycle_id: &str) -> anyhow::Result<Option<CycleScopeDrift>> {
    // No start event: the join is empty and both sums are NULL, which reads as 0 and 0 and so None.
    let (added, removed): (u32, u32) = conn.query_row(
        "SELECT
            COALESCE(SUM(e.event_type = 'cycle.epic_assigned' AND e.stream_id = ?1
                         AND json_extract(e.payload, '$.before') IS NOT ?1), 0),
            COALESCE(SUM((e.event_type = 'cycle.epic_removed' AND e.stream_id = ?1)
                         OR (e.event_type = 'cycle.epic_assigned' AND e.stream_id <> ?1
                             AND json_extract(e.payload, '$.before') = ?1)), 0)
         FROM events e
         JOIN (SELECT project_id, origin, sequence, occurred_at FROM events
               WHERE stream_type = 'cycle' AND stream_id = ?1 AND event_type = 'cycle.started'
               ORDER BY sequence DESC LIMIT 1) s ON e.project_id = s.project_id
         WHERE e.event_type IN ('cycle.epic_assigned', 'cycle.epic_removed')
           AND (e.occurred_at > s.occurred_at
                OR (e.occurred_at = s.occurred_at AND e.origin = s.origin AND e.sequence > s.sequence))",
        params![cycle_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok((added + removed > 0).then_some(CycleScopeDrift { epics_added: added, epics_removed: removed }))
}

/// The sentence the owner can state out loud: the numbers and "since this Cycle started". A zero
/// half is left out rather than printed.
pub fn cycle_scope_sentence(drift: &CycleScopeDrift) -> String {
    let epics = |n: u32| if n == 1 { "1 epic".to_string() } else { format!("{n} epics") };
    let parts = match (drift.epics_added, drift.epics_removed) {
        (a, 0) => format!("{} added", epics(a)),
        (0, r) => format!("{} removed", epics(r)),
        (a, r) => format!("{} added, {r} removed", epics(a)),
    };
    format!("{parts} since this Cycle started")
}
