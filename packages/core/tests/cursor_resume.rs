//! Behavior under test (01-10-PLAN.md Task 3 — the cursor-resumable half of DATA-05, the contract
//! a future relay depends on, per D-22):
//! - Reading `events_since_cursor` in batches of 7 across a 100-event log yields exactly 100
//!   events, each exactly once, in ascending sequence (a batch size that does not divide the log
//!   length, so an off-by-one at a batch boundary shows up as a gap or a duplicate rather than
//!   hiding inside an even split).
//! - A cursor set past the last sequence returns an empty batch and no error.
//! - A cursor of zero returns the first event.
//! - Events written under a second `origin` value are invisible to the first origin's cursor and
//!   are returned in full by the second's; merging both batches by event id yields a total order
//!   matching write order.
//! - Replaying every event from sequence zero reconstructs the same criterion id/statement set the
//!   projection (the `acceptance_criteria` table itself) holds.

mod common;

use common::{new_story, seeded_project};
use core::domain::acceptance_criterion::{amend_criterion, create_criterion, delete_criterion};
use core::domain::event::{append_event, next_sequence};
use core::domain::{epic, milestone, story};
use core::query::events::{events_since_cursor, EventCursor, EventRow};
use rusqlite::params;
use std::collections::HashMap;

#[test]
fn cursor_batches_deliver_every_event_exactly_once() {
    let (mut conn, actor_id, project) = seeded_project();
    // One Milestone + one Epic + 98 Stories: exactly 100 events, one per mutation.
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "Cursor milestone", None)
        .expect("create_milestone should succeed");
    let e = epic::create_epic(&mut conn, &actor_id, &m.id, "Cursor epic").expect("create_epic should succeed");
    for i in 0..98 {
        story::create_story(&mut conn, &actor_id, &e.id, &format!("Story {i}")).expect("create_story should succeed");
    }

    let mut cursor = EventCursor {
        project_id: project.id.clone(),
        origin: "local".to_string(),
        sequence: 0,
    };
    let mut seen_sequences: Vec<i64> = Vec::new();
    loop {
        // 7 does not divide 100 — the last batch is a short, uneven remainder, exactly where an
        // off-by-one bug would surface as a gap or a duplicate rather than hiding inside an even
        // split.
        let batch = events_since_cursor(&conn, &cursor, 7).expect("events_since_cursor should succeed");
        if batch.is_empty() {
            break;
        }
        seen_sequences.extend(batch.iter().map(|e| e.sequence));
        cursor.sequence = batch.iter().map(|e| e.sequence).max().expect("batch is non-empty");
    }

    assert_eq!(seen_sequences.len(), 100, "every one of the 100 events must be delivered");
    let mut deduped = seen_sequences.clone();
    deduped.sort_unstable();
    deduped.dedup();
    assert_eq!(deduped.len(), 100, "no event may be delivered twice");
    assert_eq!(
        seen_sequences,
        (1..=100).collect::<Vec<_>>(),
        "sequences must be delivered gap-free and in ascending order"
    );
}

#[test]
fn cursor_past_the_end_returns_empty() {
    let (mut conn, actor_id, project) = seeded_project();
    new_story(&mut conn, &project.id, &actor_id, "Only story");

    let cursor = EventCursor {
        project_id: project.id.clone(),
        origin: "local".to_string(),
        sequence: 1_000_000,
    };
    let batch = events_since_cursor(&conn, &cursor, 50).expect("events_since_cursor should not error");
    assert!(batch.is_empty(), "a cursor past the last sequence must return an empty batch, not an error");
}

#[test]
fn cursor_zero_returns_the_first_event() {
    let (mut conn, actor_id, project) = seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "First", None)
        .expect("create_milestone should succeed");

    let cursor = EventCursor {
        project_id: project.id.clone(),
        origin: "local".to_string(),
        sequence: 0,
    };
    let batch = events_since_cursor(&conn, &cursor, 50).expect("events_since_cursor should succeed");
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].sequence, 1);
    assert_eq!(batch[0].stream_id, m.id);
}

#[test]
fn a_second_origin_has_its_own_cursor() {
    let (mut conn, actor_id, project) = seeded_project();
    // Every production mutation function writes under `"local"` — Phase 1 never produces a
    // second origin. This test writes one directly, exactly as 01-10-PLAN.md's own "Flagged
    // assumption" section requires: proving `(project_id, origin)` isolation now, against a
    // second origin that does not exist yet in any real write path, so a later refactor cannot
    // silently collapse the two-column key back down to a bare `sequence` counter.
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "Local origin milestone", None)
        .expect("create_milestone should succeed");

    let other_origin = "teammate-machine";
    let other_event_id = {
        let tx = conn.transaction().expect("transaction should open");
        let seq = next_sequence(&tx, &project.id, other_origin).expect("next_sequence should succeed");
        assert_eq!(seq, 1, "a second origin's counter starts at 1, independent of \"local\"'s counter");
        let id = append_event(
            &tx,
            &project.id,
            other_origin,
            seq,
            "milestone",
            &m.id,
            None,
            None,
            &actor_id,
            "milestone.updated",
            &serde_json::json!({"field": "title", "before": "Local origin milestone", "after": "Remote edit", "label": "Edited title to \"Remote edit\""}),
            "2026-01-02T00:00:00.000Z",
        )
        .expect("append_event should succeed");
        tx.commit().expect("commit should succeed");
        id
    };

    let local_cursor = EventCursor { project_id: project.id.clone(), origin: "local".to_string(), sequence: 0 };
    let local_batch = events_since_cursor(&conn, &local_cursor, 50).expect("events_since_cursor should succeed");
    assert!(
        local_batch.iter().all(|e| e.id != other_event_id),
        "the \"local\" cursor must never see an event written under a different origin"
    );

    let other_cursor = EventCursor { project_id: project.id.clone(), origin: other_origin.to_string(), sequence: 0 };
    let other_batch = events_since_cursor(&conn, &other_cursor, 50).expect("events_since_cursor should succeed");
    assert_eq!(other_batch.len(), 1);
    assert_eq!(other_batch[0].id, other_event_id);

    // Merging both origins' batches by event id (a ULID, clock-ordered across writers) yields a
    // single chronological order matching write order — the cross-origin merge step D-17/Flag 1
    // names, proven here since nothing in this phase produces a second origin on its own.
    let mut merged: Vec<EventRow> = local_batch.into_iter().chain(other_batch.into_iter()).collect();
    merged.sort_by(|a, b| a.id.cmp(&b.id));
    let merged_types: Vec<&str> = merged.iter().map(|e| e.event_type.as_str()).collect();
    assert_eq!(merged_types, vec!["milestone.created", "milestone.updated"], "merged order must match write order");
}

#[test]
fn replay_reconstructs_the_projection() {
    let (mut conn, actor_id, project) = seeded_project();

    let story = new_story(&mut conn, &project.id, &actor_id, "Replayed story");
    create_criterion(&mut conn, &actor_id, &story.id, "Alpha").expect("create_criterion should succeed");
    let beta = create_criterion(&mut conn, &actor_id, &story.id, "Beta").expect("create_criterion should succeed");
    let gamma = create_criterion(&mut conn, &actor_id, &story.id, "Gamma (to be deleted)")
        .expect("create_criterion should succeed");
    amend_criterion(&mut conn, &actor_id, &beta.id, "Beta, amended").expect("amend_criterion should succeed");
    delete_criterion(&mut conn, &actor_id, &gamma.id).expect("delete_criterion should succeed");

    // Replay the log from sequence zero, applying only `criterion.*` events (the log also carries
    // the Milestone/Epic/Story creation events, so the filter is load-bearing) — reconstructing an `id -> title` map exactly the way a from-scratch relay
    // consumer would, using only what the event stream carries.
    let mut cursor = EventCursor { project_id: project.id.clone(), origin: "local".to_string(), sequence: 0 };
    let mut replayed: HashMap<String, String> = HashMap::new();
    loop {
        let batch = events_since_cursor(&conn, &cursor, 10).expect("events_since_cursor should succeed");
        if batch.is_empty() {
            break;
        }
        for event in &batch {
            if event.stream_type != "criterion" {
                continue;
            }
            match event.event_type.as_str() {
                "criterion.created" | "criterion.amended" => {
                    let statement = event
                        .payload
                        .get("statement")
                        .and_then(|v| v.as_str())
                        .expect("criterion.created/amended payload carries a statement")
                        .to_string();
                    replayed.insert(event.stream_id.clone(), statement);
                }
                "criterion.deleted" => {
                    replayed.remove(&event.stream_id);
                }
                _ => {}
            }
        }
        cursor.sequence = batch.iter().map(|e| e.sequence).max().expect("batch is non-empty");
    }

    // The projection itself — the `acceptance_criteria` table `create_criterion`/`amend_criterion`/
    // `delete_criterion` wrote — is the comparison target, not a hand-written expected list.
    let mut stmt = conn
        .prepare(
            "SELECT c.id, c.statement FROM acceptance_criteria c
             JOIN stories s ON s.id = c.story_id WHERE s.project_id = ?1",
        )
        .expect("prepare should succeed");
    let projection: HashMap<String, String> = stmt
        .query_map(params![project.id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .expect("query_map should succeed")
        .collect::<Result<HashMap<_, _>, _>>()
        .expect("reading the projection should succeed");

    assert_eq!(replayed, projection, "replaying the log must reconstruct the same criterion id/statement set the projection holds");
    assert_eq!(projection.len(), 2, "alpha and the amended beta survive; gamma was deleted");
}
