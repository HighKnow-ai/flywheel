//! G-02-4's own end-to-end proof: `close_session` was thoroughly unit-tested and never called
//! in production, so a unit test of `apply_session_closed` alone would repeat the exact mistake
//! this gap closes. This file drives a REAL sidecar process (`packages/sidecar/dist/index.js`,
//! driving `packages/sidecar/test/fake-claude.mjs` as its backend) to a natural completion and
//! asserts the `sessions` row through the database — the only shape of test that can fail when a
//! call site is missing, which asserting on `apply_session_closed`/`close_session` directly never
//! could.
//!
//! The overwrite and unknown/malformed cases below need no child process: they construct the
//! terminal event as a `serde_json::json!` value and call `apply_session_closed` directly, which is
//! legitimate because the thing they prove is the applier's own guard, not the existence of a call
//! site — that is `session_closed_call_site.rs`'s job.

mod common;

use common::with_scratch_worktree_root;

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

use core::domain::session::{apply_session_closed, interrupt_session, start_session, SessionClosedOutcome};
use core::domain::story::{set_story_state, StoryState};
use core::ids::is_ulid;

/// CARGO_MANIFEST_DIR is packages/core — walk up two levels to the workspace root, exactly as
/// `app_exit_ordering.rs` does.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

/// The real, built sidecar entrypoint — asserted present with a message naming the build command,
/// a HARD FAILURE rather than a skip. A silently-skipping test here would repeat the exact failure
/// mode this whole gap-closure round exists to correct (G-02-4's own precondition: "the lifecycle
/// test spawns that file as a real child process; it asserts its presence with an actionable
/// message rather than skipping").
fn sidecar_dist_entry() -> PathBuf {
    let path = workspace_root().join("packages/sidecar/dist/index.js");
    assert!(
        path.is_file(),
        "expected the built sidecar entrypoint at {path:?} — run `npm --prefix packages/sidecar run build` first"
    );
    path
}

/// The fake backend fixture `FLYWHEEL_CLAUDE_BIN` points the sidecar at — its two result lines
/// carry a fixed, measured-shape usage block (G-02-4's own fixture change), asserted below.
fn fake_claude_path() -> PathBuf {
    let path = workspace_root().join("packages/sidecar/test/fake-claude.mjs");
    assert!(path.is_file(), "expected the fake backend fixture at {path:?}");
    path
}

/// Count of terminal-event rows (`session.closed` OR `session.interrupted`) appended for
/// `run_id` — the activity trail's own way of proving "exactly one terminal event", regardless of
/// which of the two terminal-writing paths produced it.
fn terminal_event_count(conn: &rusqlite::Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type IN ('session.closed', 'session.interrupted')",
        rusqlite::params![run_id],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

#[test]
fn a_session_driven_to_natural_completion_reaches_a_terminal_status() {
    with_scratch_worktree_root(|_| {
        let dist_entry = sidecar_dist_entry();
        let fake_claude = fake_claude_path();

        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Session-close lifecycle story");
        set_story_state(&mut conn, &actor_id, &story.id, StoryState::Ready).expect("Shaping -> Ready");
        set_story_state(&mut conn, &actor_id, &story.id, StoryState::Running).expect("Ready -> Running");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");
        let worktree_path: String = conn
            .query_row(
                "SELECT path FROM worktrees WHERE id = ?1",
                rusqlite::params![run.worktree_id],
                |row| row.get(0),
            )
            .expect("worktree row should exist");

        // plan 03-02: every session now runs under `watchdog.js`, which fails closed (refuses to
        // spawn the backend at all) when `FLYWHEEL_RUNTIME_DIR` is absent — this real sidecar
        // process needs one even though nothing in this test touches the heartbeat file itself.
        // `FLYWHEEL_HEARTBEAT_STALE_MS` is set generously so the fixture's own sub-second natural
        // completion can never race the watchdog's staleness check.
        let runtime_dir = tempfile::tempdir().expect("failed to create scratch runtime dir");

        let mut child = Command::new("node")
            .arg(&dist_entry)
            .env("FLYWHEEL_CLAUDE_BIN", &fake_claude)
            .env("FLYWHEEL_RUNTIME_DIR", runtime_dir.path())
            .env("FLYWHEEL_HEARTBEAT_STALE_MS", "120000")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap_or_else(|e| panic!("failed to spawn sidecar entrypoint {dist_entry:?}: {e}"));

        // Bound the whole interaction: kill the child if it is still running once 30s elapses (the
        // fixture exits in milliseconds, so this is generous) — a hung sidecar fails this test
        // rather than hanging the suite.
        let (done_tx, done_rx) = mpsc::channel::<()>();
        let watchdog_pid = child.id();
        let watchdog = std::thread::spawn(move || {
            if done_rx.recv_timeout(Duration::from_secs(30)).is_err() {
                #[cfg(unix)]
                {
                    let _ = Command::new("kill").arg("-9").arg(watchdog_pid.to_string()).status();
                }
            }
        });

        let spawn_request = serde_json::json!({
            "id": "lifecycle-spawn",
            "op": "spawn",
            "runId": run.id,
            "worktreePath": worktree_path,
            "prompt": "say hi",
            "permissionMode": "acceptEdits",
        });
        {
            let stdin = child.stdin.as_mut().expect("child stdin should be piped");
            writeln!(stdin, "{spawn_request}").expect("failed to write the spawn request to the child's stdin");
        }

        let stdout = child.stdout.take().expect("child stdout should be piped");
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            let Ok(envelope) = serde_json::from_str::<serde_json::Value>(&line) else {
                continue;
            };
            if envelope.get("kind").and_then(|v| v.as_str()) != Some("event") {
                continue;
            }
            let Some(event) = envelope.get("event") else { continue };

            // Fed through apply_session_closed exactly as the reader loop does — ignoring the
            // returned outcome exactly as a loop that sees every event would.
            let _ = apply_session_closed(&mut conn, event);

            if event.get("type").and_then(|v| v.as_str()) == Some("session_closed") {
                break;
            }
        }

        // Close stdin and wait for the child so it is reaped whatever happened above, then tell
        // the watchdog it can stand down.
        drop(child.stdin.take());
        let _ = child.wait();
        let _ = done_tx.send(());
        watchdog.join().expect("watchdog thread should not panic");

        let (status, ended_at, cost_usd, tokens_in, tokens_out): (
            String,
            Option<String>,
            Option<f64>,
            Option<i64>,
            Option<i64>,
        ) = conn
            .query_row(
                "SELECT status, ended_at, cost_usd, tokens_in, tokens_out FROM sessions WHERE id = ?1",
                rusqlite::params![run.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("sessions row should exist");

        assert_eq!(status, "completed", "a session that exits 0 with no interrupt requested must close completed");
        assert!(ended_at.is_some(), "ended_at must be set after the terminal event is applied");
        assert_eq!(cost_usd, Some(0.0021), "cost_usd must equal the fixture's total_cost_usd");
        // 2 + 30 + 400 = 432 — a SUM over three fixture usage fields, so a regression that
        // recorded only the plain input_tokens field (2) fails this exact assertion.
        assert_eq!(
            tokens_in,
            Some(432),
            "tokens_in must be the SUM of the fixture's three input-side usage fields, not the plain field alone"
        );
        assert_eq!(tokens_out, Some(7), "tokens_out must equal the fixture's output_tokens field");

        assert_eq!(
            terminal_event_count(&conn, &run.id),
            1,
            "exactly one terminal event row must exist for a naturally-completed run"
        );

        let story_state: String = conn
            .query_row("SELECT state FROM stories WHERE id = ?1", rusqlite::params![story.id], |row| row.get(0))
            .expect("story row should exist");
        assert_eq!(
            story_state, "running",
            "a session reaching a terminal status must never move its owning Story out of running (D-29)"
        );
    });
}

#[test]
fn a_terminal_event_never_overwrites_an_explicit_stop() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Stop-then-terminal-event story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        interrupt_session(&mut conn, &run.id, &actor_id).expect("interrupt_session should succeed");

        let ended_at_after_stop: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM sessions WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("sessions row should exist");
        assert!(ended_at_after_stop.is_some(), "ended_at must be set after the explicit Stop");

        // A terminal event carrying a completion reason and a cost arrives afterwards — exactly
        // the race G-02-4 names: `interrupt_session` already recorded the explicit Stop, and the
        // sidecar's own session_closed event for the same run shows up later.
        let event = serde_json::json!({
            "type": "session_closed",
            "runId": run.id,
            "reason": "completed",
            "result": { "totalCostUsd": 0.0099, "inputTokens": 10, "outputTokens": 3 },
        });
        let outcome = apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");
        assert_eq!(
            outcome,
            SessionClosedOutcome::BackfilledTerminal,
            "an already-terminal run whose event carries a figure it was missing must backfill, not overwrite"
        );

        let (status, ended_at, cost_usd): (String, Option<String>, Option<f64>) = conn
            .query_row(
                "SELECT status, ended_at, cost_usd FROM sessions WHERE id = ?1",
                rusqlite::params![run.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("sessions row should exist");
        assert_eq!(status, "interrupted", "the explicit-Stop status must never be overwritten by a later terminal event");
        assert_eq!(ended_at, ended_at_after_stop, "the end time recorded by the explicit Stop must be unchanged");
        assert_eq!(cost_usd, Some(0.0099), "the cost column, previously empty, must be backfilled from the event");

        assert_eq!(
            terminal_event_count(&conn, &run.id),
            1,
            "the backfill branch must never append a second terminal event"
        );

        // A second such event, once every column is already filled, changes nothing further.
        let event_again = serde_json::json!({
            "type": "session_closed",
            "runId": run.id,
            "reason": "completed",
            "result": { "totalCostUsd": 5.0, "inputTokens": 999, "outputTokens": 999 },
        });
        let outcome_again =
            apply_session_closed(&mut conn, &event_again).expect("apply_session_closed should succeed");
        assert_eq!(outcome_again, SessionClosedOutcome::AlreadyTerminal);

        let cost_after_second_event: Option<f64> = conn
            .query_row("SELECT cost_usd FROM sessions WHERE id = ?1", rusqlite::params![run.id], |row| row.get(0))
            .expect("sessions row should exist");
        assert_eq!(cost_after_second_event, Some(0.0099), "a fully-backfilled row must never be overwritten again");
        assert_eq!(terminal_event_count(&conn, &run.id), 1);
    });
}

#[test]
fn an_unknown_or_malformed_run_id_writes_nothing() {
    with_scratch_worktree_root(|_| {
        let (mut conn, _actor_id, _project, _repo_dir) = common::seeded_git_project();

        // A well-formed ULID that matches no sessions row.
        let unknown_run_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        assert!(is_ulid(unknown_run_id), "the fixture id itself must be a well-formed ULID");
        let unknown_event = serde_json::json!({
            "type": "session_closed",
            "runId": unknown_run_id,
            "reason": "completed",
            "result": { "totalCostUsd": 1.0 },
        });
        let outcome =
            apply_session_closed(&mut conn, &unknown_event).expect("an unknown run id must not error");
        assert_eq!(outcome, SessionClosedOutcome::UnknownRun);

        // A run id that is not a well-formed identifier at all.
        let malformed_event = serde_json::json!({
            "type": "session_closed",
            "runId": "not-a-ulid",
            "reason": "completed",
            "result": { "totalCostUsd": 1.0 },
        });
        let malformed_outcome =
            apply_session_closed(&mut conn, &malformed_event).expect("a malformed run id must not error");
        assert_eq!(malformed_outcome, SessionClosedOutcome::Ignored);

        let sessions_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(sessions_count, 0, "neither case should have written any sessions row");
    });
}
