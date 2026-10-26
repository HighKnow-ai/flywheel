//! The Story agent's Task board tool (issue #52, docs/mvp-spec.md §4.3): a live Story session
//! writes and updates its own Story's checklist, each call written immediately through the core,
//! so a killed session keeps its checklist. The tool refuses a second *doing* Task and a *dropped*
//! Task without a reason, never reaches another Story's Tasks, and nothing here reads a diff or a
//! transcript: a Task changes state only through an explicit call.
//!
//! Also covers the developer's own checklist edits (rename and reorder), which land in the same
//! `tasks` table the next session's packet reads.

mod common;

use common::with_scratch_worktree_root;
use flywheel_core::domain::session::{close_session, start_session, Session, SessionStatus};
use flywheel_core::domain::story::Story;
use flywheel_core::domain::task::{add_task, move_task, rename_task, set_task_note, set_task_state, tasks_for_story, TaskState, MAX_TASK_NOTE_LEN};
use flywheel_core::domain::task_tool::{apply_task_tool_call, tasks_as_tool_result, TaskToolCall};
use flywheel_core::domain::worktree::ensure_worktree;
use rusqlite::Connection;
use serde_json::json;
use tempfile::TempDir;

fn live_session() -> (Connection, String, TempDir, Story, Session) {
    let (mut conn, actor, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &actor, "Task tool fixture");
    ensure_worktree(&mut conn, &story.id, &actor).unwrap();
    let session = start_session(&mut conn, &story.id, "acceptEdits", &actor).unwrap();
    (conn, actor, repo, story, session)
}

fn call(tool: &str, args: serde_json::Value) -> TaskToolCall {
    TaskToolCall::parse(tool, &args).unwrap_or_else(|e| panic!("{tool} {args} should parse: {e}"))
}

fn titles_and_states(conn: &Connection, story_id: &str) -> Vec<(String, String)> {
    tasks_for_story(conn, story_id).unwrap().into_iter().map(|t| (t.title, t.state)).collect()
}

#[test]
fn the_agent_writes_its_plan_and_it_survives_the_session_being_killed() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor, _repo, story, session) = live_session();

        let outcome = apply_task_tool_call(
            &mut conn,
            &session.id,
            &call("task_add", json!({ "titles": ["Write the failing test", "  Make it pass  "] })),
        )
        .unwrap();
        assert_eq!(outcome.story_id, story.id);
        let titles: Vec<&str> = outcome.tasks.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, ["Write the failing test", "Make it pass"], "the tool answers with the checklist");

        let first = outcome.tasks[0].id.clone();
        apply_task_tool_call(&mut conn, &session.id, &call("task_update", json!({ "task_id": first, "state": "doing" })))
            .unwrap();

        // The session dies: its row closes, and nothing it wrote is rolled back.
        close_session(&mut conn, &session.id, SessionStatus::Failed, None, None, None).unwrap();
        assert_eq!(
            titles_and_states(&conn, &story.id),
            [("Write the failing test".to_string(), "doing".to_string()), ("Make it pass".to_string(), "open".to_string())],
        );

        // A dead session can no longer write.
        let err = apply_task_tool_call(&mut conn, &session.id, &call("task_list", json!({}))).unwrap_err();
        assert!(err.to_string().contains("ended"), "{err}");
    });
}

#[test]
fn the_tool_refuses_a_second_doing_task_and_a_drop_without_a_reason() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor, _repo, story, session) = live_session();
        let tasks = apply_task_tool_call(&mut conn, &session.id, &call("task_add", json!({ "titles": ["A", "B"] })))
            .unwrap()
            .tasks;
        let (a, b) = (tasks[0].id.clone(), tasks[1].id.clone());

        apply_task_tool_call(&mut conn, &session.id, &call("task_update", json!({ "task_id": a, "state": "doing" })))
            .unwrap();
        let err = apply_task_tool_call(&mut conn, &session.id, &call("task_update", json!({ "task_id": b, "state": "doing" })))
            .unwrap_err();
        assert!(err.to_string().contains("at most one"), "{err}");

        for args in [json!({ "task_id": b, "state": "dropped" }), json!({ "task_id": b, "state": "dropped", "reason": "   " })] {
            let err = TaskToolCall::parse("task_update", &args).unwrap_err();
            assert!(err.to_string().contains("reason"), "{args}: {err}");
        }
        // The core refuses it too, for a caller that skips the parser.
        let unparsed = TaskToolCall::Update { task_id: b.clone(), state: Some(TaskState::Dropped), reason: None, note: None };
        assert!(apply_task_tool_call(&mut conn, &session.id, &unparsed).is_err());

        apply_task_tool_call(
            &mut conn,
            &session.id,
            &call("task_update", json!({ "task_id": b, "state": "dropped", "reason": "covered by A" })),
        )
        .unwrap();
        let stored = tasks_for_story(&conn, &story.id).unwrap();
        assert_eq!(stored[1].state, "dropped");
        assert_eq!(stored[1].dropped_reason.as_deref(), Some("covered by A"));
        assert_eq!(stored[0].state, "doing", "the refused calls changed nothing");
    });
}

#[test]
fn the_tool_never_reaches_another_storys_tasks() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, _repo, story, session) = live_session();
        let other = common::new_story(&mut conn, &story.project_id, &actor, "Another Story");
        let foreign = add_task(&mut conn, &actor, &other.id, "Not yours").unwrap();

        let err = apply_task_tool_call(
            &mut conn,
            &session.id,
            &call("task_update", json!({ "task_id": foreign.id, "state": "done" })),
        )
        .unwrap_err();
        assert!(err.to_string().contains("not a Task of this Story"), "{err}");
        assert_eq!(tasks_for_story(&conn, &other.id).unwrap()[0].state, "open");
    });
}

#[test]
fn malformed_calls_are_refused_before_anything_is_written() {
    for (tool, args) in [
        ("task_add", json!({})),
        ("task_add", json!({ "titles": [] })),
        ("task_add", json!({ "titles": ["ok", "  "] })),
        ("task_add", json!({ "titles": ["x".repeat(501)] })),
        ("task_update", json!({ "state": "done" })),
        ("task_update", json!({ "task_id": "t", "state": "finished" })),
        ("task_update", json!({ "task_id": "t", "state": "open", "reason": "only a drop has one" })),
        ("task_delete", json!({})),
    ] {
        assert!(TaskToolCall::parse(tool, &args).is_err(), "{tool} {args} should be refused");
    }
}

#[test]
fn the_tool_writes_as_the_agent_and_lists_the_checklist_in_order() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor, _repo, story, session) = live_session();
        apply_task_tool_call(&mut conn, &session.id, &call("task_add", json!({ "titles": ["One"] }))).unwrap();
        apply_task_tool_call(&mut conn, &session.id, &call("task_add", json!({ "titles": ["Two"] }))).unwrap();
        let listed = apply_task_tool_call(&mut conn, &session.id, &call("task_list", json!({}))).unwrap().tasks;
        assert_eq!(listed.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(), ["One", "Two"]);

        let created_by: Vec<String> = conn
            .prepare("SELECT a.type FROM tasks t JOIN actors a ON a.id = t.created_by WHERE t.story_id = ?1")
            .unwrap()
            .query_map([&story.id], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(created_by, ["agent", "agent"]);
    });
}

#[test]
fn the_developer_renames_and_reorders_tasks_in_the_table_the_next_packet_reads() {
    let (mut conn, actor, project) = common::seeded_project();
    let story = common::new_story(&mut conn, &project.id, &actor, "Edits");
    let a = add_task(&mut conn, &actor, &story.id, "A").unwrap();
    let b = add_task(&mut conn, &actor, &story.id, "B").unwrap();
    let c = add_task(&mut conn, &actor, &story.id, "C").unwrap();
    let order = |conn: &Connection| tasks_for_story(conn, &story.id).unwrap().into_iter().map(|t| t.title).collect::<Vec<_>>();

    rename_task(&mut conn, &actor, &b.id, "  B, renamed  ").unwrap();
    assert!(rename_task(&mut conn, &actor, &b.id, "   ").is_err(), "a Task needs a title");
    assert_eq!(order(&conn), ["A", "B, renamed", "C"]);

    move_task(&mut conn, &actor, &c.id, Some(&a.id)).unwrap();
    assert_eq!(order(&conn), ["C", "A", "B, renamed"], "moved before A, to the front");
    move_task(&mut conn, &actor, &c.id, None).unwrap();
    assert_eq!(order(&conn), ["A", "B, renamed", "C"], "moved to the end");
    move_task(&mut conn, &actor, &a.id, Some(&c.id)).unwrap();
    assert_eq!(order(&conn), ["B, renamed", "A", "C"], "moved between two neighbours");
    assert!(move_task(&mut conn, &actor, &a.id, Some(&a.id)).is_err(), "a Task cannot move before itself");

    let other = common::new_story(&mut conn, &project.id, &actor, "Other");
    let foreign = add_task(&mut conn, &actor, &other.id, "X").unwrap();
    assert!(move_task(&mut conn, &actor, &a.id, Some(&foreign.id)).is_err(), "only within its own Story");

    set_task_state(&mut conn, &actor, &a.id, TaskState::Dropped, Some("not needed")).unwrap();
    let events: i64 = conn
        .query_row("SELECT COUNT(*) FROM events WHERE event_type IN ('task.renamed', 'task.moved')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(events, 4, "every edit leaves an event");
}

// Issue #96: a note on each Task, written at once and replaced whole, so what a session learned on
// a Task outlives the session.
#[test]
fn task_update_saves_a_note_at_once_and_each_write_replaces_the_last() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor, _repo, story, session) = live_session();
        let a = apply_task_tool_call(&mut conn, &session.id, &call("task_add", json!({ "titles": ["Survey the repo"] })))
            .unwrap()
            .tasks[0]
            .id
            .clone();

        // State and note in one call.
        let outcome = apply_task_tool_call(
            &mut conn,
            &session.id,
            &call("task_update", json!({ "task_id": a, "state": "doing", "note": "  Board tools live in task_tool.rs.  " })),
        )
        .unwrap();
        assert_eq!(outcome.tasks[0].state, "doing");
        assert_eq!(outcome.tasks[0].note.as_deref(), Some("Board tools live in task_tool.rs."));
        assert_eq!(tasks_as_tool_result(&outcome.tasks)["tasks"][0]["note"], "Board tools live in task_tool.rs.");

        // A note alone, without a state: replaces the previous note, leaves the state alone.
        apply_task_tool_call(
            &mut conn,
            &session.id,
            &call("task_update", json!({ "task_id": a, "note": "Read task_tool.rs and context_packet.rs. Left: the UI." })),
        )
        .unwrap();
        let stored = &tasks_for_story(&conn, &story.id).unwrap()[0];
        assert_eq!(stored.state, "doing");
        assert_eq!(stored.note.as_deref(), Some("Read task_tool.rs and context_packet.rs. Left: the UI."));

        // The session dies; the note stays on the board.
        close_session(&mut conn, &session.id, SessionStatus::Failed, None, None, None).unwrap();
        assert_eq!(
            tasks_for_story(&conn, &story.id).unwrap()[0].note.as_deref(),
            Some("Read task_tool.rs and context_packet.rs. Left: the UI.")
        );
    });
}

#[test]
fn task_update_refuses_a_call_with_neither_state_nor_note_and_an_oversized_note() {
    let err = TaskToolCall::parse("task_update", &json!({ "task_id": "t" })).unwrap_err();
    assert!(err.to_string().contains("note"), "{err}");
    let long = "x".repeat(MAX_TASK_NOTE_LEN + 1);
    let err = TaskToolCall::parse("task_update", &json!({ "task_id": "t", "note": long })).unwrap_err();
    assert!(err.to_string().contains("at most"), "{err}");
    let err = TaskToolCall::parse("task_update", &json!({ "task_id": "t", "note": 3 })).unwrap_err();
    assert!(err.to_string().contains("string"), "{err}");
    // A reason still belongs only to a drop, even on a note-only call.
    assert!(TaskToolCall::parse("task_update", &json!({ "task_id": "t", "note": "n", "reason": "r" })).is_err());
}

#[test]
fn the_developer_replaces_and_clears_a_note() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, _repo, story, _session) = live_session();
        let task = add_task(&mut conn, &actor, &story.id, "Survey the repo").unwrap();
        assert_eq!(task.note, None);

        set_task_note(&mut conn, &actor, &task.id, "First").unwrap();
        set_task_note(&mut conn, &actor, &task.id, "Second, replacing the first").unwrap();
        assert_eq!(tasks_for_story(&conn, &story.id).unwrap()[0].note.as_deref(), Some("Second, replacing the first"));

        set_task_note(&mut conn, &actor, &task.id, "   ").unwrap();
        assert_eq!(tasks_for_story(&conn, &story.id).unwrap()[0].note, None, "a blank note clears it");

        assert!(set_task_note(&mut conn, &actor, &task.id, &"x".repeat(MAX_TASK_NOTE_LEN + 1)).is_err());
        let events: i64 = conn
            .query_row("SELECT COUNT(*) FROM events WHERE event_type = 'task.note_set'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(events, 3, "each accepted write is on the activity trail");
    });
}
