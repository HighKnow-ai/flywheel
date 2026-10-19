//! `domain::session_summary::create_summary` / `list_summaries_for_story` /
//! `latest_summary_for_run` / `synthesize_fallback_summary` (D-65, CTX-01..CTX-04): summaries are
//! append-only, their Story and actor come from the session row, a Story's summaries read back in
//! a deterministic order, and every terminal path that ends without an agent-written summary gets
//! exactly one stub — never one over an agent-written summary.

mod common;

use common::with_scratch_worktree_root;

use core::domain::session::{
    apply_session_closed, close_session, start_session, Session, SessionStatus,
    SessionClosedOutcome,
};
use core::domain::project::Project;
use core::domain::session_summary::{
    create_summary, latest_summary_for_run, list_summaries_for_story, synthesize_fallback_summary,
};
use core::domain::story::Story;
use core::domain::task::{add_task, set_task_state, TaskState};
use core::domain::worktree::ensure_worktree;
use rusqlite::{params, Connection};
use tempfile::TempDir;

/// A minimal fixture: a project, one Story, and one started session — the shape
/// [`create_summary`] needs (a session id), without each test re-deriving it.
fn seeded_story_and_run() -> (Connection, String, Project, TempDir, Story, Session) {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &actor_id, "Summary fixture");
    ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
    let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
        .expect("start_session should succeed");
    (conn, actor_id, project, repo_dir, story, run)
}

fn summary_count(conn: &Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM session_summaries WHERE session_id = ?1",
        params![run_id],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

#[test]
fn two_summaries_for_one_run_append_rather_than_replace() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, story, run) = seeded_story_and_run();

        let first = create_summary(&mut conn, &run.id, "first pass", "chose A")
            .expect("first create_summary should succeed");
        let second = create_summary(&mut conn, &run.id, "second pass", "chose B")
            .expect("second create_summary should succeed");

        assert_eq!(summary_count(&conn, &run.id), 2, "two create_summary calls must leave two rows, not one");

        let latest = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary should exist");
        assert_eq!(latest.id, second.id, "latest_summary_for_run must name the second (most recent) summary");

        // The first row's own content fields must still be byte-identical to what was written —
        // proving the second insert never rewrote it.
        let all = list_summaries_for_story(&conn, &story.id).expect("list_summaries_for_story should succeed");
        let stored_first = all.iter().find(|s| s.id == first.id).expect("first row must still exist");
        assert_eq!(stored_first, &first);
        assert_eq!(stored_first.next_session_must_know, "first pass");
        assert_eq!(stored_first.decisions, "chose A");
        assert!(!stored_first.is_stub);
    });
}

#[test]
fn create_summary_resolves_the_story_and_the_actor_from_the_session_row() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human_actor_id, _project, _repo_dir, story, run) = seeded_story_and_run();

        let summary = create_summary(&mut conn, &run.id, "know this", "decided that")
            .expect("create_summary should succeed");

        assert_eq!(summary.session_id, run.id);
        assert_eq!(summary.story_id, story.id, "the Story must come from the session row");
        assert_eq!(summary.created_by, run.actor_id, "the actor must be the session's own agent actor");
        assert_ne!(summary.created_by, human_actor_id);

        assert!(
            create_summary(&mut conn, "01ARZ3NDEKTSV4RRFFQ69G5FAV", "x", "y").is_err(),
            "a summary for a session that does not exist must be refused"
        );
    });
}

#[test]
fn ordering_is_stable_under_a_tied_created_at_timestamp() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, story, run) = seeded_story_and_run();

        let s1 = create_summary(&mut conn, &run.id, "one", "").expect("create_summary 1 should succeed");
        let s2 = create_summary(&mut conn, &run.id, "two", "").expect("create_summary 2 should succeed");
        let s3 = create_summary(&mut conn, &run.id, "three", "").expect("create_summary 3 should succeed");

        // Force s1 and s2 to share a created_at value directly in the test's own SQL — production
        // code never issues an UPDATE against session_summaries; this is the test harness
        // deliberately manufacturing the tie.
        let tied_at = "2026-01-01T00:00:00.000Z";
        conn.execute(
            "UPDATE session_summaries SET created_at = ?1 WHERE id IN (?2, ?3)",
            rusqlite::params![tied_at, s1.id, s2.id],
        )
        .expect("test-only tie-forcing update should succeed");

        let (lesser_id, greater_id) = if s1.id < s2.id { (&s1.id, &s2.id) } else { (&s2.id, &s1.id) };

        let first_call = list_summaries_for_story(&conn, &story.id).expect("list_summaries_for_story should succeed");
        assert_eq!(first_call.len(), 3);
        assert_eq!(&first_call[0].id, lesser_id, "the lesser ULID must sort first within the tie");
        assert_eq!(&first_call[1].id, greater_id, "the greater ULID must sort second within the tie");
        assert_eq!(first_call[2].id, s3.id, "the untied third row must still sort last");

        let second_call =
            list_summaries_for_story(&conn, &story.id).expect("second list_summaries_for_story call should succeed");
        assert_eq!(
            first_call.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            second_call.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            "calling list_summaries_for_story twice must return the same id sequence"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// `synthesize_fallback_summary` — the stub, exercised directly (its own transaction, never
// through `apply_session_closed`).
// ---------------------------------------------------------------------------------------------

#[test]
fn fallback_summary_names_the_close_reason_and_the_task_it_was_doing() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, story, run) = seeded_story_and_run();
        let task = add_task(&mut conn, &run.actor_id, &story.id, "Wire the parser").expect("add_task should succeed");
        set_task_state(&mut conn, &run.actor_id, &task.id, TaskState::Doing, None).expect("set_task_state should succeed");

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        let summary_id = synthesize_fallback_summary(&tx, &run.id, "interrupted")
            .expect("synthesize_fallback_summary should succeed");
        tx.commit().expect("failed to commit synthesize tx");

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");
        assert_eq!(summary.id, summary_id);
        assert!(summary.is_stub, "the synthesized row must be flagged a stub");
        let note = &summary.next_session_must_know;
        assert!(note.contains("interrupted"), "the stub must name the close reason: {note}");
        assert!(note.contains("Wire the parser"), "the stub must name the Task it was doing: {note}");
        assert!(summary.decisions.is_empty(), "decisions must be empty");
    });
}

#[test]
fn fallback_summary_with_no_task_doing_still_yields_one_honest_row() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, _story, run) = seeded_story_and_run();

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        synthesize_fallback_summary(&tx, &run.id, "failed")
            .expect("synthesize_fallback_summary should succeed with no Task doing");
        tx.commit().expect("failed to commit synthesize tx");

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");

        let note = &summary.next_session_must_know;
        assert!(!note.is_empty(), "the stub's note must be non-empty");
        assert!(note.contains("failed"), "the stub must name the close reason: {note}");
        assert!(note.contains("without handing off"), "the stub must state that no summary was handed off: {note}");
        assert!(note.contains("No Task was marked doing"), "the stub must not invent a Task: {note}");
        assert!(summary.decisions.is_empty(), "decisions must be empty");
        assert!(summary.is_stub);

        assert_eq!(summary_count(&conn, &run.id), 1, "the stub must be exactly one summary row");
    });
}

#[test]
fn fallback_summary_is_attributed_to_the_agent_actor_not_a_human() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human_actor_id, _project, _repo_dir, story, run) = seeded_story_and_run();

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        synthesize_fallback_summary(&tx, &run.id, "completed").expect("synthesize_fallback_summary should succeed");
        tx.commit().expect("failed to commit synthesize tx");

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");

        assert!(summary.is_stub, "the synthesized row must be flagged a stub");
        assert_eq!(summary.story_id, story.id, "the stub's Story must come from the session row");
        assert_eq!(summary.created_by, run.actor_id, "a stub must be attributed to the session's own agent actor");
        assert_ne!(summary.created_by, human_actor_id, "a stub must never be attributed to the local human actor");
    });
}

#[test]
fn calling_the_synthesizer_twice_for_the_same_run_writes_two_rows() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, _story, run) = seeded_story_and_run();

        {
            let tx = conn.transaction().expect("failed to open tx for the first synthesize call");
            synthesize_fallback_summary(&tx, &run.id, "completed")
                .expect("first synthesize_fallback_summary call should succeed");
            tx.commit().expect("failed to commit the first synthesize tx");
        }
        {
            let tx = conn.transaction().expect("failed to open tx for the second synthesize call");
            synthesize_fallback_summary(&tx, &run.id, "completed")
                .expect("second synthesize_fallback_summary call should succeed");
            tx.commit().expect("failed to commit the second synthesize tx");
        }

        assert_eq!(
            summary_count(&conn, &run.id),
            2,
            "the synthesizer has no dedupe of its own — the caller's presence check is the guard"
        );
    });
}

#[test]
fn create_summary_and_synthesize_fallback_summary_share_one_insert_site_and_stay_distinguishable() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, story, run) = seeded_story_and_run();

        let agent_written =
            create_summary(&mut conn, &run.id, "agent's own words", "").expect("create_summary should succeed");

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        let fallback_id =
            synthesize_fallback_summary(&tx, &run.id, "failed").expect("synthesize_fallback_summary should succeed");
        tx.commit().expect("failed to commit synthesize tx");

        let all = list_summaries_for_story(&conn, &story.id).expect("list_summaries_for_story should succeed");
        assert_eq!(all.len(), 2, "both the agent-authored and the stub row must exist");
        let agent_row = all.iter().find(|s| s.id == agent_written.id).expect("agent row must exist");
        let fallback_row = all.iter().find(|s| s.id == fallback_id).expect("stub row must exist");
        assert!(!agent_row.is_stub, "the agent-authored row must read back as not a stub");
        assert!(fallback_row.is_stub, "the stub row must read back as a stub");
    });
}

// ---------------------------------------------------------------------------------------------
// `apply_session_closed`'s stub hook — every terminal session gets checked.
// ---------------------------------------------------------------------------------------------

#[test]
fn apply_session_closed_interrupted_writes_a_stub_summary() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, _story, run) = seeded_story_and_run();

        let event = serde_json::json!({
            "type": "session_closed",
            "runId": run.id,
            "reason": "interrupted",
        });
        let outcome = apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");
        assert_eq!(outcome, SessionClosedOutcome::Closed(SessionStatus::Interrupted));

        assert_eq!(
            summary_count(&conn, &run.id),
            1,
            "a session with no agent-recorded summary must leave exactly one stub row"
        );

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");
        assert!(summary.is_stub, "the fallback row must be flagged a stub");
    });
}

#[test]
fn apply_session_closed_behaves_identically_for_completed_and_failed() {
    // Each reason gets its OWN scratch worktree root — `with_scratch_worktree_root` sets a
    // process-wide env var, and both iterations otherwise mint a project with the identical key
    // prefix/first-Story key ("FLY-…"), which would collide on the same physical worktree
    // directory on disk if the root were shared across iterations.
    for reason in ["completed", "failed"] {
        with_scratch_worktree_root(|_| {
            let (mut conn, _actor_id, _project, _repo_dir, _story, run) = seeded_story_and_run();
            let event = serde_json::json!({
                "type": "session_closed",
                "runId": run.id,
                "reason": reason,
            });
            let outcome = apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");
            assert!(matches!(outcome, SessionClosedOutcome::Closed(_)));

            let summary = latest_summary_for_run(&conn, &run.id)
                .expect("latest_summary_for_run should succeed")
                .expect("a summary row must exist");
            assert!(summary.is_stub, "reason {reason} must still synthesize a stub summary");
            let note = &summary.next_session_must_know;
            assert!(note.contains(reason), "the stub must name the close reason {reason}: {note}");
        });
    }
}

#[test]
fn apply_session_closed_never_synthesizes_a_second_summary_when_one_already_exists() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, _story, run) = seeded_story_and_run();

        let recorded = create_summary(&mut conn, &run.id, "agent's own closing words", "")
            .expect("create_summary should succeed");

        let event = serde_json::json!({
            "type": "session_closed",
            "runId": run.id,
            "reason": "completed",
        });
        apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");

        assert_eq!(summary_count(&conn, &run.id), 1, "an agent-recorded summary must never gain a stub sibling");

        let still = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("the recorded summary must still exist");
        assert_eq!(still.id, recorded.id);
        assert!(!still.is_stub, "the pre-existing agent-authored row must never flip to a stub");
    });
}

#[test]
fn apply_session_closed_with_a_non_ulid_run_id_writes_no_summary() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir) = common::seeded_git_project();

        let event = serde_json::json!({
            "type": "session_closed",
            "runId": "not-a-ulid",
            "reason": "completed",
        });
        let outcome = apply_session_closed(&mut conn, &event).expect("a malformed run id must not error");
        assert_eq!(outcome, SessionClosedOutcome::Ignored);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_summaries", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(count, 0, "an ignored event must write no summary row at all");
    });
}

#[test]
fn close_session_still_works_directly_after_the_in_tx_refactor() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir, _story, run) = seeded_story_and_run();

        close_session(&mut conn, &run.id, SessionStatus::Completed, Some(0.01), Some(10), Some(2))
            .expect("close_session should still succeed after the refactor");

        let (status, cost_usd): (String, Option<f64>) = conn
            .query_row(
                "SELECT status, cost_usd FROM sessions WHERE id = ?1",
                params![run.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("sessions row should exist");
        assert_eq!(status, "completed");
        assert_eq!(cost_usd, Some(0.01));

        // `close_session` alone (its lower-level statement body, called directly rather than
        // through `apply_session_closed`) must not synthesize a stub — that behavior belongs only
        // to `apply_session_closed`'s own call site (production's one caller).
        assert_eq!(summary_count(&conn, &run.id), 0, "close_session alone must not synthesize a summary");
    });
}
