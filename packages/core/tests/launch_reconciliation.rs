//! PROC-05 coverage (D-46, D-49, D-50, T-03-06-01..07): the launch-time three-way classification
//! (`reconcile_sessions`), pid-reuse-safe liveness (`process_is_alive`), and the orphan kill
//! verb (`kill_orphan`) — one test per `<behavior>` bullet in `03-06-PLAN.md` Tasks 2 and 3, plus
//! a source-scanning gate proving nothing in `reconcile_sessions` can resume a process.

mod common;

use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

use flywheel_core::domain::session::{
    kill_orphan, mark_abandoned, reconcile_sessions, start_session, SessionStatus,
};
use flywheel_core::domain::session_summary::latest_summary_for_run;
use flywheel_core::runtime_protocol::{process_is_alive, write_kill_record, write_run_descriptor};

/// Serializes every call to [`with_scratch_runtime_and_worktree_root`] in THIS binary —
/// `FLYWHEEL_RUNTIME_DIR` and `FLYWHEEL_WORKTREE_ROOT` are both process-global mutable state, and
/// `cargo test` runs `#[test]` functions concurrently by default. Mirrors `stop_lifecycle.rs`'s
/// own `WORKTREE_ROOT_ENV_LOCK` and `runtime_protocol.rs`'s own `RUNTIME_DIR_ENV_LOCK`, combined
/// into one guard since this file's tests need both vars set together (`start_session` calls
/// `ensure_worktree`, and every reconciliation function reads `runtime_dir()`).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_and_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let runtime_dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    let worktree_dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates either var while they're set, and this helper always clears both before returning.
    unsafe {
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime_dir.path());
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_dir.path());
    }
    let result = f();
    unsafe {
        std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
        std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
    }
    result
}

/// Spawn a real, genuinely long-lived child process (`sleep 60`) — the same "real spawned
/// process for the liveness cases" idiom this plan's own text names, mirroring
/// `tests/bin/crash_harness.rs`'s "model a real process, don't fake one" precedent.
///
/// `.process_group(0)` makes the child its OWN process-group leader (pgid == its own pid) —
/// mirroring how a real session is spawned in production (`watchdog.ts` becomes its own group
/// leader via Node's `detached: true`). Without this, the child simply inherits the TEST
/// BINARY's own process group, and `kill_orphan`'s `-pid` group signal would target a group this
/// pid does not actually lead, silently failing to reach it (found by running this fixture
/// without the call and observing `kill_orphan` report `killed: false` for a real, live child).
///
/// The caller is responsible for killing/reaping it when done.
fn spawn_long_lived_child() -> Child {
    Command::new("sleep")
        .arg("60")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .expect("failed to spawn a real long-lived child process for the liveness fixture")
}

/// The exact start-time-in-milliseconds value a genuinely alive `pid` would be recorded with in
/// a real `RunDescriptor` — computed the same way `process_is_alive` itself does (sysinfo's own
/// whole-seconds `start_time()`, multiplied by 1000), so this fixture proves the real conversion
/// round-trips rather than asserting against a value nothing else in the system would ever write.
fn real_start_time_ms(pid: u32) -> u64 {
    let mut system = sysinfo::System::new();
    let sys_pid = sysinfo::Pid::from_u32(pid);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sys_pid]), true);
    system
        .process(sys_pid)
        .expect("the freshly spawned child should be visible to sysinfo")
        .start_time()
        .saturating_mul(1000)
}

fn session_status(conn: &rusqlite::Connection, run_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM sessions WHERE id = ?1",
        rusqlite::params![run_id],
        |row| row.get(0),
    )
    .expect("sessions row should exist")
}

fn abandoned_event_reason(conn: &rusqlite::Connection, run_id: &str) -> Option<Option<String>> {
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM events WHERE event_type = 'session.abandoned' AND stream_id = ?1",
            rusqlite::params![run_id],
            |row| row.get(0),
        )
        .ok();
    payload.map(|p| {
        let value: serde_json::Value =
            serde_json::from_str(&p).expect("payload should be valid JSON");
        value
            .get("reason")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    })
}

fn event_count(conn: &rusqlite::Connection, project_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE project_id = ?1",
        rusqlite::params![project_id],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

// --- process_is_alive ---

#[test]
fn process_is_alive_returns_true_for_a_genuinely_live_process_with_the_correct_start_time() {
    let mut child = spawn_long_lived_child();
    let pid = child.id();
    let start_time = real_start_time_ms(pid);

    assert!(
        process_is_alive(pid as i32, start_time),
        "a genuinely live process with its own correct start time must read as alive"
    );

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn process_is_alive_returns_false_when_the_start_time_does_not_match_pid_reuse_safety() {
    let mut child = spawn_long_lived_child();
    let pid = child.id();
    let correct_start_time = real_start_time_ms(pid);
    let wrong_start_time = correct_start_time + 1_000;

    assert!(
        !process_is_alive(pid as i32, wrong_start_time),
        "a live pid with a deliberately wrong start time must read as dead — this is the exact \
         pid-reuse case T-03-06-01 exists to catch"
    );

    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn process_is_alive_returns_false_for_a_pid_that_does_not_exist_at_all() {
    let mut child = spawn_long_lived_child();
    let pid = child.id();
    let start_time = real_start_time_ms(pid);

    // Kill and REAP the child so its pid is fully gone, not merely a zombie sysinfo might still
    // report on.
    let _ = child.kill();
    let _ = child.wait();

    assert!(
        !process_is_alive(pid as i32, start_time),
        "a pid that no longer exists must read as dead, without erroring"
    );
}

#[test]
fn process_is_alive_returns_false_for_a_non_positive_pid() {
    assert!(!process_is_alive(0, 0));
    assert!(!process_is_alive(-1, 0));
}

// --- reconcile_sessions ---

#[test]
fn a_running_row_with_a_kill_record_is_abandoned_with_the_recorded_reason_and_not_a_live_orphan() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(
            &mut conn,
            &project.id,
            &actor_id,
            "Killed-by-watchdog story",
        );
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        write_run_descriptor(&run.id, 999_999, 111);
        write_kill_record(&run.id, 999_999, 111, "heartbeat-stale");

        let live_orphans =
            reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions should succeed");

        assert!(
            !live_orphans.iter().any(|o| o.run_id == run.id),
            "a run with a kill record must never appear in the live-orphan list"
        );
        assert_eq!(session_status(&conn, &run.id), "abandoned");
        assert_eq!(
            abandoned_event_reason(&conn, &run.id),
            Some(Some("heartbeat-stale".to_string())),
            "the abandoned event must carry the kill record's own reason"
        );
    });
}

#[test]
fn a_running_row_with_no_kill_record_and_a_live_process_stays_running_and_is_a_live_orphan() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Genuine orphan story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        let mut child = spawn_long_lived_child();
        let pid = child.id();
        let start_time = real_start_time_ms(pid);
        write_run_descriptor(&run.id, pid as i32, start_time);

        let live_orphans =
            reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions should succeed");

        let orphan = live_orphans
            .iter()
            .find(|o| o.run_id == run.id)
            .expect("the genuinely alive run must appear in the live-orphan list");
        assert_eq!(orphan.pid, pid as i32);
        assert_eq!(orphan.story_id.as_deref(), Some(story.id.as_str()));
        assert_eq!(orphan.story_key, story.key);
        assert_eq!(orphan.story_title, story.title);
        assert_eq!(orphan.project_id, project.id);

        // The row itself must be UNCHANGED in the database — not merely absent from a rewrite.
        assert_eq!(
            session_status(&conn, &run.id),
            "running",
            "a live orphan must be left exactly at running — writing any status here would be \
             the board lying about a live fact (D-46)"
        );

        let _ = child.kill();
        let _ = child.wait();
    });
}

#[test]
fn a_running_row_with_no_kill_record_and_a_dead_process_is_abandoned_with_no_reason() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(
            &mut conn,
            &project.id,
            &actor_id,
            "Dead without record story",
        );
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        let mut child = spawn_long_lived_child();
        let pid = child.id();
        let start_time = real_start_time_ms(pid);
        write_run_descriptor(&run.id, pid as i32, start_time);
        let _ = child.kill();
        let _ = child.wait();

        let live_orphans =
            reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions should succeed");

        assert!(!live_orphans.iter().any(|o| o.run_id == run.id));
        assert_eq!(session_status(&conn, &run.id), "abandoned");
        assert_eq!(
            abandoned_event_reason(&conn, &run.id),
            Some(None),
            "a dead process with no kill record must be abandoned with NO reason — never a \
             fabricated one"
        );
    });
}

#[test]
fn a_running_row_with_no_descriptor_at_all_is_abandoned_with_no_reason() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "No descriptor story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        // Deliberately never write a run descriptor or a kill record for this run.
        let live_orphans =
            reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions should succeed");

        assert!(!live_orphans.iter().any(|o| o.run_id == run.id));
        assert_eq!(session_status(&conn, &run.id), "abandoned");
        assert!(
            latest_summary_for_run(&conn, &run.id)
                .expect("latest_summary_for_run should succeed")
                .is_some_and(|summary| summary.is_stub),
            "mark_abandoned's own fallback-summary logic must fire when the reconciler abandons a run"
        );
    });
}

#[test]
fn a_blocked_row_is_classified_by_the_same_three_way_rule_as_a_running_row() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Blocked orphan story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        conn.execute(
            "UPDATE sessions SET status = 'blocked' WHERE id = ?1",
            rusqlite::params![run.id],
        )
        .expect("failed to move the run to blocked for this test's setup");

        write_run_descriptor(&run.id, 999_999, 222);
        write_kill_record(&run.id, 999_999, 222, "heartbeat-stale");

        let live_orphans =
            reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions should succeed");

        assert!(
            !live_orphans.iter().any(|o| o.run_id == run.id),
            "a blocked run with a kill record must never appear in the live-orphan list"
        );
        assert_eq!(
            session_status(&conn, &run.id),
            "abandoned",
            "a run blocked on a permission request when the app died is just as orphaned as a \
             running one"
        );
    });
}

#[test]
fn a_malformed_kill_record_classifies_as_dead_without_a_record_not_as_killed() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Malformed record story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        // No live descriptor at all, and a kill record file that does not parse — this must fall
        // back to the honest "dead, no reason known" path, never invent a reason from garbage.
        let runtime_dir =
            flywheel_core::runtime_protocol::runtime_dir().expect("runtime_dir should resolve");
        let kills_dir = runtime_dir.join("kills");
        std::fs::create_dir_all(&kills_dir).expect("failed to create kills dir");
        std::fs::write(kills_dir.join(format!("{}.json", run.id)), b"{ not json")
            .expect("failed to write a malformed kill record");

        let live_orphans =
            reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions should succeed");

        assert!(!live_orphans.iter().any(|o| o.run_id == run.id));
        assert_eq!(session_status(&conn, &run.id), "abandoned");
        assert_eq!(
            abandoned_event_reason(&conn, &run.id),
            Some(None),
            "a malformed kill record must never be read as a real reason"
        );
    });
}

#[test]
fn an_already_terminal_row_is_never_rewritten_and_a_second_call_appends_no_event() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Idempotency story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        // No descriptor, no kill record — the first call abandons it with no reason.
        let first_pass = reconcile_sessions(&mut conn, &actor_id)
            .expect("first reconcile_sessions call should succeed");
        assert!(!first_pass.iter().any(|o| o.run_id == run.id));
        assert_eq!(session_status(&conn, &run.id), "abandoned");

        let events_after_first_pass = event_count(&conn, &project.id);

        let second_pass = reconcile_sessions(&mut conn, &actor_id)
            .expect("a second reconcile_sessions call over unchanged state must not error");
        assert!(
            second_pass.is_empty(),
            "an already-abandoned run must never be re-examined, let alone returned as a live orphan"
        );
        assert_eq!(
            event_count(&conn, &project.id),
            events_after_first_pass,
            "a second call over unchanged state must write nothing and append no event"
        );
        assert_eq!(session_status(&conn, &run.id), "abandoned");
    });
}

#[test]
fn calling_mark_abandoned_directly_on_an_already_abandoned_run_is_a_no_op() {
    // Belt-and-suspenders on the guard reconcile_sessions itself relies on entirely, rather
    // than re-implementing (see this file's own idempotency test above for the reconciler-level
    // proof).
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(
            &mut conn,
            &project.id,
            &actor_id,
            "Direct mark_abandoned story",
        );
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        assert!(mark_abandoned(&mut conn, &run.id, &actor_id, None)
            .expect("mark_abandoned should succeed"));
        assert!(
            !mark_abandoned(&mut conn, &run.id, &actor_id, Some("should-be-ignored"))
                .expect("a second mark_abandoned call must not error"),
            "mark_abandoned on an already-terminal run must return Ok(false)"
        );
        assert_eq!(
            abandoned_event_reason(&conn, &run.id),
            Some(None),
            "the second call's reason must never overwrite the first"
        );
    });
}

/// The structural "nothing is silently resumed" gate (T-03-06-05): `reconcile_sessions`'s own
/// body — from its `pub fn` line to its closing brace at column 0 — must contain no
/// `Command::new`, no `spawn`, and no `start_session` call, after whole-line comments are
/// stripped. Mirrors `supervisor_cwd.rs`'s own real-source-file scanning idiom rather than
/// asserting against a duplicated copy of the function body.
#[test]
fn no_resume_call_survives_in_reconcile_sessions() {
    let source = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/domain/session.rs"
    ))
    .expect("failed to read session.rs source");

    let mut in_function = false;
    let mut violations = Vec::new();
    for line in source.lines() {
        if !in_function {
            if line.contains("fn reconcile_sessions") {
                in_function = true;
            }
            continue;
        }
        if line == "}" {
            break;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            continue;
        }
        if line.contains("Command::new") || line.contains("start_session") || line.contains("spawn")
        {
            violations.push(line.to_string());
        }
    }

    assert!(
        in_function,
        "reconcile_sessions was not found in session.rs"
    );
    assert!(
        violations.is_empty(),
        "reconcile_sessions must never resume a process; found: {violations:?}"
    );
}

// --- kill_orphan ---

#[test]
fn kill_orphan_kills_a_genuinely_alive_process_and_records_abandoned() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Kill me story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        let mut child = spawn_long_lived_child();
        let pid = child.id();
        let start_time = real_start_time_ms(pid);
        write_run_descriptor(&run.id, pid as i32, start_time);

        let outcome =
            kill_orphan(&mut conn, &run.id, &actor_id).expect("kill_orphan should succeed");

        assert!(
            outcome.killed,
            "a real signal to a real process must report killed: true"
        );
        assert_eq!(outcome.pid, pid as i32);
        assert_eq!(outcome.detail, None);
        assert_eq!(session_status(&conn, &run.id), "abandoned");
        assert_eq!(
            abandoned_event_reason(&conn, &run.id),
            Some(Some("killed-by-user-at-launch".to_string()))
        );

        // Best-effort: the process really is gone (avoids leaking a zombie from this test run).
        let _ = child.wait();
    });
}

#[test]
fn kill_orphan_still_records_abandoned_when_the_process_is_already_gone() {
    with_scratch_runtime_and_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Already gone story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        let mut child = spawn_long_lived_child();
        let pid = child.id();
        let start_time = real_start_time_ms(pid);
        write_run_descriptor(&run.id, pid as i32, start_time);
        let _ = child.kill();
        let _ = child.wait();

        let outcome =
            kill_orphan(&mut conn, &run.id, &actor_id).expect("kill_orphan should succeed");

        assert!(
            outcome.killed,
            "a process that was already dead before the signal was sent counts as killed — \
             there is nothing left alive to report a failure about"
        );
        assert_eq!(session_status(&conn, &run.id), "abandoned");
        assert_eq!(
            abandoned_event_reason(&conn, &run.id),
            Some(Some("killed-by-user-at-launch".to_string()))
        );
    });
}

#[test]
fn session_status_abandoned_as_str_matches_the_schema_literal() {
    assert_eq!(SessionStatus::Abandoned.as_str(), "abandoned");
}
