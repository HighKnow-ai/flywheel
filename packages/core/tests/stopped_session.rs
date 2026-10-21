//! A dead session (docs/mvp-spec.md §4.5, issue #54): a Story session that ends without handing
//! off flags its Story Stopped with a best-effort ending label, leaves a stub Session summary (the
//! reason, the *doing* Task and the last assistant message, truncated), keeps the *doing* Task
//! *doing*, touches nothing in the worktree, and takes its pending requests with it.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use core::context_packet::build_context_packet;
use core::domain::permission_request::{answer_request, create_pending_request, pending_for_run};
use core::domain::session::{apply_session_closed, interrupt_session, mark_abandoned, start_session, Session};
use core::domain::session_ending::{classify_session_closed, EndingReason, LastAssistantMessage};
use core::domain::session_summary::{create_summary, latest_summary_for_run};
use core::domain::story::{set_story_state, Story, StoryState};
use core::domain::task::{add_task, set_task_note, set_task_state, tasks_for_story, TaskState};
use core::query::permissions::pending_requests_for_run;
use core::query::sessions::{run_by_id, runs_for_story, stopped_session_for_story};
use core::session_log::{last_assistant_message, session_log_path};
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct Fixture {
    conn: Connection,
    actor_id: String,
    _repo: TempDir,
    story: Story,
    run: Session,
    worktree: PathBuf,
}

/// A Running Story with one live session, a *doing* Task and an uncommitted file in its worktree.
fn running_story() -> Fixture {
    let (mut conn, actor_id, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &actor_id, "Stopped fixture");
    set_story_state(&mut conn, &actor_id, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &actor_id, &story.id, StoryState::Running).unwrap();
    let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id).unwrap();
    let task = add_task(&mut conn, &run.actor_id, &story.id, "Wire the parser").unwrap();
    set_task_state(&mut conn, &run.actor_id, &task.id, TaskState::Doing, None).unwrap();
    let worktree: String = conn
        .query_row("SELECT path FROM worktrees WHERE id = ?1", params![run.worktree_id], |r| r.get(0))
        .unwrap();
    let worktree = PathBuf::from(worktree);
    std::fs::write(worktree.join("half-done.txt"), "work in progress\n").unwrap();
    Fixture { conn, actor_id, _repo: repo, story, run, worktree }
}

/// Write `lines` as the session's durable log, the way the reader loop does.
fn write_log(run_id: &str, lines: &[serde_json::Value]) {
    for line in lines {
        core::session_log::append_event_line(run_id, &line.to_string()).unwrap();
    }
}

fn remove_log(run_id: &str) {
    let _ = std::fs::remove_file(session_log_path(run_id).unwrap());
}

fn closed(run_id: &str, reason: &str, result: Option<serde_json::Value>, exit_code: Option<i64>) -> serde_json::Value {
    let mut event = json!({
        "type": "session_closed",
        "runId": run_id,
        "reason": reason,
        "closeOrigin": "backend-exit",
        "exitCode": exit_code,
        "exitSignal": null,
    });
    if let Some(result) = result {
        event["result"] = result;
    }
    event
}

fn ending_reason(conn: &Connection, run_id: &str) -> Option<String> {
    conn.query_row("SELECT ending_reason FROM sessions WHERE id = ?1", params![run_id], |r| r.get(0)).unwrap()
}

// ---------------------------------------------------------------------------------------------
// The label: read from the result line, the exit code and the last assistant message.
// ---------------------------------------------------------------------------------------------

fn label(event: serde_json::Value, last: Option<LastAssistantMessage>) -> EndingReason {
    classify_session_closed(&event, last.as_ref(), false)
}

const RUN: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

#[test]
fn the_ending_label_is_read_from_the_result_line_and_the_exit_code() {
    let clean = json!({"subtype": "success", "isError": false, "terminalReason": "completed", "stopReason": "end_turn"});
    assert_eq!(label(closed(RUN, "completed", Some(clean.clone()), Some(0)), None), EndingReason::EndedWithoutHandOff);

    let killed = closed(RUN, "failed", None, None);
    assert_eq!(label(killed, None), EndingReason::Crash, "no result line and a signal exit is a crash");
    assert_eq!(label(closed(RUN, "failed", None, Some(143)), None), EndingReason::Crash);
    assert_eq!(label(closed(RUN, "failed", None, Some(137)), None), EndingReason::Crash);

    let crash = json!({"subtype": "error_during_execution", "stopReason": null});
    assert_eq!(label(closed(RUN, "failed", Some(crash), Some(1)), None), EndingReason::Crash);

    let api = json!({"subtype": "success", "isError": true, "terminalReason": "api_error"});
    assert_eq!(label(closed(RUN, "failed", Some(api), Some(1)), None), EndingReason::ApiError);

    let refusal = json!({"subtype": "success", "isError": false, "stopReason": "refusal"});
    assert_eq!(label(closed(RUN, "completed", Some(refusal), Some(0)), None), EndingReason::Refusal);

    let mut origin = closed(RUN, "failed", None, Some(137));
    origin["closeOrigin"] = json!("watchdog-heartbeat-stale");
    assert_eq!(label(origin, None), EndingReason::AppQuit, "the watchdog kills a session whose app went away");

    assert_eq!(label(closed(RUN, "interrupted", None, Some(143)), None), EndingReason::StoppedByDeveloper);
    assert_eq!(label(json!({"type": "session_closed", "runId": RUN, "reason": "completed"}), None), EndingReason::Unknown);

    assert_eq!(
        classify_session_closed(&closed(RUN, "completed", Some(clean), Some(0)), None, true),
        EndingReason::HandedOff,
        "a clean exit after the hand-off is not a stop"
    );
}

#[test]
fn a_refusal_and_a_usage_limit_are_read_from_the_last_assistant_message() {
    let clean = json!({"subtype": "success", "isError": false, "terminalReason": "completed"});
    let refused = LastAssistantMessage {
        text: "API Error: Claude's safeguards flagged this message. Details: `[reasoning_extraction]`".into(),
        is_api_error: true,
        rate_limited: false,
    };
    assert_eq!(label(closed(RUN, "completed", Some(clean.clone()), Some(0)), Some(refused)), EndingReason::Refusal);

    let limited = LastAssistantMessage { text: "Claude AI usage limit reached|1760000000".into(), is_api_error: true, rate_limited: false };
    assert_eq!(label(closed(RUN, "completed", Some(clean.clone()), Some(0)), Some(limited)), EndingReason::UsageLimit);

    let flagged = LastAssistantMessage { text: "anything".into(), is_api_error: true, rate_limited: true };
    assert_eq!(label(closed(RUN, "failed", Some(clean.clone()), Some(1)), Some(flagged)), EndingReason::UsageLimit);

    let api = LastAssistantMessage { text: "API Error: 500 Internal server error".into(), is_api_error: true, rate_limited: false };
    assert_eq!(label(closed(RUN, "completed", Some(clean), Some(0)), Some(api)), EndingReason::ApiError);
}

#[test]
fn every_label_has_words_and_round_trips_through_its_column_value() {
    for reason in EndingReason::ALL {
        assert_eq!(EndingReason::parse(reason.as_str()), Some(reason));
        assert!(!reason.words().is_empty());
    }
    assert_eq!(EndingReason::EndedWithoutHandOff.words(), "ended without hand-off");
}

// ---------------------------------------------------------------------------------------------
// Stopped, the stub, the doing Task and the worktree.
// ---------------------------------------------------------------------------------------------

#[test]
fn a_killed_session_flags_the_story_stopped_and_leaves_a_stub_with_the_last_message() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        let head_before = git(&f.worktree, &["rev-parse", "HEAD"]);
        let status_before = git(&f.worktree, &["status", "--porcelain"]);
        let long = format!("I was halfway through the parser. {}", "x".repeat(2000));
        write_log(&f.run.id, &[json!({"type": "assistant_text", "text": long}), json!({"type": "cost_update"})]);

        assert!(stopped_session_for_story(&f.conn, &f.story.id).unwrap().is_none(), "a live session is not Stopped");
        apply_session_closed(&mut f.conn, &closed(&f.run.id, "failed", None, Some(143))).unwrap();

        assert_eq!(ending_reason(&f.conn, &f.run.id).as_deref(), Some("crash"));
        let stopped = stopped_session_for_story(&f.conn, &f.story.id).unwrap().expect("the Story is Stopped");
        assert_eq!(stopped.session_id, f.run.id);
        assert_eq!(stopped.ending_reason.as_deref(), Some("crash"));

        let stub = latest_summary_for_run(&f.conn, &f.run.id).unwrap().expect("a stub summary");
        assert!(stub.is_stub);
        let note = &stub.next_session_must_know;
        assert!(note.contains("crash"), "{note}");
        assert!(note.contains("Wire the parser"), "{note}");
        assert!(note.contains("I was halfway through the parser."), "{note}");
        assert!(note.chars().count() < 1200, "the last message is truncated: {} chars", note.chars().count());

        let tasks = tasks_for_story(&f.conn, &f.story.id).unwrap();
        assert_eq!(tasks[0].state, "doing", "the doing Task stays doing");
        let story_state: String =
            f.conn.query_row("SELECT state FROM stories WHERE id = ?1", params![f.story.id], |r| r.get(0)).unwrap();
        assert_eq!(story_state, "running", "Stopped is attention, never a state");

        assert_eq!(git(&f.worktree, &["rev-parse", "HEAD"]), head_before, "no WIP commit");
        assert_eq!(git(&f.worktree, &["status", "--porcelain"]), status_before, "no reset, no clean");
        assert!(f.worktree.join("half-done.txt").is_file());

        let packet = build_context_packet(&f.conn, &f.story.id, "Pick the parser back up").unwrap();
        assert!(packet.contains("I was halfway through the parser."), "the stub reaches the next packet");
        assert!(packet.contains("Resume note: Pick the parser back up"));
        assert!(packet.contains("re-verify"), "the packet tells the agent to re-verify the doing Task");
        remove_log(&f.run.id);
    });
}

// Issue #96: a session stopped mid-Task leaves what it had written on the doing Task, and the next
// session's packet carries it, so it does not redo the survey.
#[test]
fn a_session_stopped_mid_task_leaves_the_doing_tasks_note_in_the_stub_and_the_packet() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        let doing = tasks_for_story(&f.conn, &f.story.id).unwrap().remove(0);
        let learned = "Parser entry is src/parse.rs::parse_line.\nLeft: the error path.";
        set_task_note(&mut f.conn, &f.run.actor_id, &doing.id, learned).unwrap();
        let later = add_task(&mut f.conn, &f.run.actor_id, &f.story.id, "Document the grammar").unwrap();
        set_task_note(&mut f.conn, &f.actor_id, &later.id, "Use the README's table.").unwrap();

        apply_session_closed(&mut f.conn, &closed(&f.run.id, "failed", None, Some(143))).unwrap();

        let stub = latest_summary_for_run(&f.conn, &f.run.id).unwrap().expect("a stub summary");
        let must_know = &stub.next_session_must_know;
        assert!(must_know.contains("Its note on that Task:"), "{must_know}");
        assert!(must_know.contains("> Parser entry is src/parse.rs::parse_line.\n> Left: the error path."), "{must_know}");
        assert!(!must_know.contains("README's table"), "only the doing Task's note goes in the stub: {must_know}");
        assert!(must_know.contains("The worktree is left exactly as it was"), "{must_know}");

        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        let tasks = packet.split("## Tasks").nth(1).unwrap().split("\n## ").next().unwrap();
        assert!(
            tasks.contains("- [doing] Wire the parser\n  Note: Parser entry is src/parse.rs::parse_line.\n  Left: the error path.\n"),
            "the doing Task's note sits under it: {tasks}"
        );
        assert!(tasks.contains("- [open] Document the grammar\n  Note: Use the README's table.\n"), "{tasks}");
        assert!(tasks.contains("starting from its note"), "{tasks}");
    });
}

#[test]
fn a_clean_exit_without_a_hand_off_reads_ended_without_hand_off() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        let result = json!({"subtype": "success", "isError": false, "terminalReason": "completed", "stopReason": "end_turn"});
        apply_session_closed(&mut f.conn, &closed(&f.run.id, "completed", Some(result), Some(0))).unwrap();

        assert_eq!(ending_reason(&f.conn, &f.run.id).as_deref(), Some("ended_without_hand_off"));
        assert!(stopped_session_for_story(&f.conn, &f.story.id).unwrap().is_some(), "a clean exit counts as Stopped");
        let stub = latest_summary_for_run(&f.conn, &f.run.id).unwrap().unwrap();
        assert!(stub.next_session_must_know.contains("ended without hand-off"), "{}", stub.next_session_must_know);
    });
}

#[test]
fn a_session_that_handed_off_is_not_stopped_and_gets_no_stub() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        create_summary(&mut f.conn, &f.run.id, "parser done", "kept the old lexer").unwrap();
        set_story_state(&mut f.conn, &f.run.actor_id, &f.story.id, StoryState::InReview).unwrap();
        let result = json!({"subtype": "success", "isError": false, "terminalReason": "completed"});
        apply_session_closed(&mut f.conn, &closed(&f.run.id, "completed", Some(result), Some(0))).unwrap();

        assert_eq!(ending_reason(&f.conn, &f.run.id).as_deref(), Some("handed_off"));
        assert!(stopped_session_for_story(&f.conn, &f.story.id).unwrap().is_none());
        assert!(!latest_summary_for_run(&f.conn, &f.run.id).unwrap().unwrap().is_stub);
    });
}

#[test]
fn a_stop_and_an_app_quit_carry_their_own_labels() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        interrupt_session(&mut f.conn, &f.run.id, &f.actor_id).unwrap();
        assert_eq!(ending_reason(&f.conn, &f.run.id).as_deref(), Some("stopped_by_developer"));
        assert!(stopped_session_for_story(&f.conn, &f.story.id).unwrap().is_some());

        // The sidecar's late terminal event never relabels a session that is already terminal.
        apply_session_closed(&mut f.conn, &closed(&f.run.id, "interrupted", None, Some(143))).unwrap();
        assert_eq!(ending_reason(&f.conn, &f.run.id).as_deref(), Some("stopped_by_developer"));

        let next = start_session(&mut f.conn, &f.story.id, "acceptEdits", &f.actor_id).unwrap();
        assert!(stopped_session_for_story(&f.conn, &f.story.id).unwrap().is_none(), "a resumed Story is not Stopped");
        mark_abandoned(&mut f.conn, &next.id, &f.actor_id, None).unwrap();
        assert_eq!(ending_reason(&f.conn, &next.id).as_deref(), Some("app_quit"));
        let stub = latest_summary_for_run(&f.conn, &next.id).unwrap().unwrap();
        assert!(stub.next_session_must_know.contains("app quit"), "{}", stub.next_session_must_know);
    });
}

#[test]
fn a_pending_request_expires_with_its_session() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        let gated =
            create_pending_request(&mut f.conn, &f.run.id, "Bash", Some("{}"), &f.run.actor_id, Some("force-push")).unwrap();
        assert!(pending_for_run(&f.conn, &f.run.id).unwrap().is_some());

        apply_session_closed(&mut f.conn, &closed(&f.run.id, "failed", None, Some(137))).unwrap();

        assert!(pending_for_run(&f.conn, &f.run.id).unwrap().is_none(), "the request disappears with its session");
        assert!(pending_requests_for_run(&f.conn, &f.run.id).unwrap().is_empty());
        assert!(
            answer_request(&mut f.conn, &gated.id, "allowed", &f.actor_id).is_err(),
            "an expired request can no longer be answered"
        );
        let status: String =
            f.conn.query_row("SELECT status FROM sessions WHERE id = ?1", params![f.run.id], |r| r.get(0)).unwrap();
        assert_eq!(status, "failed", "answering never brings a dead session back to running");
        let expired: i64 = f
            .conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'permission_request.expired' AND stream_id = ?1",
                params![gated.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(expired, 1);
    });
}

#[test]
fn the_session_list_carries_each_sessions_ending_reason() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        interrupt_session(&mut f.conn, &f.run.id, &f.actor_id).unwrap();
        let rows = runs_for_story(&f.conn, &f.story.id, 10, 0).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ending_reason.as_deref(), Some("stopped_by_developer"));
        assert!(rows[0].ended_at.is_some());
    });
}

#[test]
fn one_session_is_read_by_id_with_its_stored_status_and_ending() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story();
        let live = run_by_id(&f.conn, &f.run.id).unwrap().expect("the session exists");
        assert_eq!(live.status, "running");
        assert!(live.ended_at.is_none() && live.ending_reason.is_none());

        interrupt_session(&mut f.conn, &f.run.id, &f.actor_id).unwrap();
        let ended = run_by_id(&f.conn, &f.run.id).unwrap().expect("the session exists");
        assert_eq!(ended.status, "interrupted");
        assert_eq!(ended.ending_reason.as_deref(), Some("stopped_by_developer"));
        assert!(ended.ended_at.is_some());

        assert!(run_by_id(&f.conn, "no-such-session").unwrap().is_none());
    });
}

#[test]
fn the_last_assistant_message_is_read_from_the_log_tail() {
    let run_id = core::ids::new_id();
    assert!(last_assistant_message(&run_id).is_none(), "no log, no message");
    write_log(
        &run_id,
        &[
            json!({"type": "assistant_text", "text": "first"}),
            json!({"type": "assistant_text", "text": "API Error: Rate limited", "isApiErrorMessage": true, "rateLimitTier": "rejected"}),
            json!({"type": "result", "subtype": "success"}),
            json!({"type": "session_closed", "reason": "completed"}),
        ],
    );
    let last = last_assistant_message(&run_id).expect("a message");
    assert_eq!(last.text, "API Error: Rate limited");
    assert!(last.is_api_error);
    assert!(last.rate_limited);
    remove_log(&run_id);
}
