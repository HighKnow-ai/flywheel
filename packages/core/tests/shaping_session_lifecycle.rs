//! Issue #122: a shaping session has no Story, so every path that ends a session must work without
//! one. Each terminal path — the natural close, the developer's Stop, the launch reconciler's
//! abandon, a live orphan at launch — is driven against a shaping session here, and each must end it
//! with its subject's scope on the event and no Session summary, which belongs to Story sessions.
//! The schema's own guards and the reads that list sessions (fleet, recovery, Waiting on you) are
//! covered too: a Story-less row must never error them.

mod common;

use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};

use flywheel_core::domain::session::{
    apply_session_closed, interrupt_session, live_shaping_session, mark_abandoned, reconcile_sessions,
    start_session, start_shaping_session, SessionClosedOutcome, SessionStatus, ShapingSubject,
};
use flywheel_core::domain::session_kind::SessionKind;
use flywheel_core::domain::task_tool::{apply_task_tool_call, TaskToolCall};
use flywheel_core::domain::{epic, milestone};
use flywheel_core::runtime_protocol::write_run_descriptor;
use rusqlite::{params, Connection};

/// `FLYWHEEL_RUNTIME_DIR` and `FLYWHEEL_WORKTREE_ROOT` are process-global; every test here sets
/// both, one at a time.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_env<T>(f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let runtime_dir = tempfile::tempdir().expect("scratch runtime dir");
    let worktree_dir = tempfile::tempdir().expect("scratch worktree root");
    // SAFETY: serialised by ENV_LOCK, and cleared before returning.
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

/// A project with one Milestone and one Epic in Shaping, and no Story at all.
fn shaping_epic() -> (Connection, String, String, epic::Epic) {
    let (mut conn, actor_id, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "Shaping", None).expect("milestone");
    let e = epic::create_epic(&mut conn, &actor_id, &m.id, "Epic shaping").expect("epic");
    (conn, actor_id, project.id, e)
}

fn start_on(conn: &mut Connection, actor_id: &str, epic_id: &str) -> String {
    let permission_mode = SessionKind::Shaping.launch_policy().permission_mode;
    start_shaping_session(conn, &ShapingSubject::Epic(epic_id.to_string()), permission_mode, actor_id)
        .expect("start_shaping_session")
        .id
}

fn status(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT status FROM sessions WHERE id = ?1", [id], |r| r.get(0)).expect("session row")
}

fn summaries(conn: &Connection, id: &str) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM session_summaries WHERE session_id = ?1", [id], |r| r.get(0)).unwrap()
}

/// `(event_type, story_id, epic_id)` of every event on the session's stream, in order.
fn session_events(conn: &Connection, id: &str) -> Vec<(String, Option<String>, Option<String>)> {
    let mut stmt = conn
        .prepare("SELECT event_type, story_id, epic_id FROM events WHERE stream_id = ?1 ORDER BY sequence")
        .unwrap();
    stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<Result<_, _>>().unwrap()
}

#[test]
fn a_shaping_session_starts_on_its_epic_with_no_story_and_no_worktree() {
    let (mut conn, actor_id, project_id, epic) = shaping_epic();
    let id = start_on(&mut conn, &actor_id, &epic.id);

    let row: (String, Option<String>, Option<String>, Option<String>, Option<String>, String, String) = conn
        .query_row(
            "SELECT kind, story_id, epic_id, milestone_id, worktree_id, project_id, permission_mode FROM sessions WHERE id = ?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .unwrap();
    assert_eq!(row, ("shaping".into(), None, Some(epic.id.clone()), None, None, project_id, "dontAsk".into()));
    assert_eq!(status(&conn, &id), "running");
    assert_eq!(session_events(&conn, &id), vec![("session.started".into(), None, Some(epic.id.clone()))]);
    assert_eq!(live_shaping_session(&conn, &ShapingSubject::Epic(epic.id.clone())).unwrap(), Some(id));
}

#[test]
fn a_second_live_shaping_session_on_the_same_epic_is_refused() {
    let (mut conn, actor_id, _, epic) = shaping_epic();
    start_on(&mut conn, &actor_id, &epic.id);
    let second = start_shaping_session(&mut conn, &ShapingSubject::Epic(epic.id.clone()), "dontAsk", &actor_id);
    assert!(second.unwrap_err().to_string().contains("already has a live shaping session"));
}

#[test]
fn shaping_is_refused_once_the_epic_has_left_shaping() {
    let (mut conn, actor_id, _, epic) = shaping_epic();
    epic::set_epic_state(&mut conn, &actor_id, &epic.id, epic::EpicState::Ready).expect("close shaping");
    let refused = start_shaping_session(&mut conn, &ShapingSubject::Epic(epic.id.clone()), "dontAsk", &actor_id);
    assert!(refused.unwrap_err().to_string().contains("is ready"), "the refusal names the state");
}

#[test]
fn a_milestone_can_be_a_shaping_subject_too() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "Shaping", None).unwrap();
    let id = start_shaping_session(&mut conn, &ShapingSubject::Milestone(m.id.clone()), "dontAsk", &actor_id)
        .unwrap()
        .id;
    let milestone_id: Option<String> =
        conn.query_row("SELECT milestone_id FROM sessions WHERE id = ?1", [&id], |r| r.get(0)).unwrap();
    assert_eq!(milestone_id, Some(m.id.clone()));
    assert!(
        apply_session_closed(&mut conn, &serde_json::json!({ "type": "session_closed", "runId": id, "reason": "completed" }))
            .is_ok()
    );
    assert_eq!(status(&conn, &id), "completed");
}

#[test]
fn a_shaping_session_is_closed_when_it_ends_without_a_session_summary() {
    let (mut conn, actor_id, _, epic) = shaping_epic();
    let id = start_on(&mut conn, &actor_id, &epic.id);

    let outcome = apply_session_closed(
        &mut conn,
        &serde_json::json!({ "type": "session_closed", "runId": id, "reason": "completed", "result": { "totalCostUsd": 0.5 } }),
    )
    .expect("apply_session_closed");

    assert_eq!(outcome, SessionClosedOutcome::Closed(SessionStatus::Completed));
    assert_eq!(status(&conn, &id), "completed");
    assert_eq!(summaries(&conn, &id), 0, "a shaping session writes no Session summary or stub");
    let events = session_events(&conn, &id);
    assert_eq!(events.last().unwrap(), &("session.closed".to_string(), None, Some(epic.id.clone())));
    assert_eq!(live_shaping_session(&conn, &ShapingSubject::Epic(epic.id)).unwrap(), None);
}

#[test]
fn a_shaping_session_can_be_stopped() {
    let (mut conn, actor_id, _, epic) = shaping_epic();
    let id = start_on(&mut conn, &actor_id, &epic.id);

    interrupt_session(&mut conn, &id, &actor_id).expect("interrupt_session");

    assert_eq!(status(&conn, &id), "interrupted");
    assert_eq!(summaries(&conn, &id), 0);
    let events = session_events(&conn, &id);
    assert_eq!(events.last().unwrap(), &("session.interrupted".to_string(), None, Some(epic.id.clone())));
    let label: String = conn
        .query_row(
            "SELECT json_extract(payload, '$.label') FROM events WHERE stream_id = ?1 AND event_type = 'session.interrupted'",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(label, format!("Stopped shaping session on {}", epic.key));

    // The sidecar's own terminal event, arriving after the Stop, changes nothing.
    let late = apply_session_closed(&mut conn, &serde_json::json!({ "type": "session_closed", "runId": id, "reason": "interrupted" }));
    assert_eq!(late.unwrap(), SessionClosedOutcome::AlreadyTerminal);
}

#[test]
fn a_shaping_session_is_marked_abandoned_without_a_stub() {
    let (mut conn, actor_id, _, epic) = shaping_epic();
    let id = start_on(&mut conn, &actor_id, &epic.id);

    assert!(mark_abandoned(&mut conn, &id, &actor_id, None).expect("mark_abandoned"));

    assert_eq!(status(&conn, &id), "abandoned");
    assert_eq!(summaries(&conn, &id), 0);
    assert_eq!(session_events(&conn, &id).last().unwrap(), &("session.abandoned".to_string(), None, Some(epic.id)));
}

#[test]
fn the_launch_reconciler_abandons_a_dead_shaping_session() {
    with_scratch_env(|| {
        let (mut conn, actor_id, _, epic) = shaping_epic();
        let id = start_on(&mut conn, &actor_id, &epic.id);

        let orphans = reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions");

        assert!(orphans.is_empty());
        assert_eq!(status(&conn, &id), "abandoned", "a shaping session the app left behind must not stay running");
        assert_eq!(summaries(&conn, &id), 0);
    });
}

fn spawn_long_lived_child() -> Child {
    Command::new("sleep")
        .arg("60")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .expect("spawn sleep")
}

fn real_start_time_ms(pid: u32) -> u64 {
    let mut system = sysinfo::System::new();
    let sys_pid = sysinfo::Pid::from_u32(pid);
    system.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[sys_pid]), true);
    system.process(sys_pid).expect("visible to sysinfo").start_time().saturating_mul(1000)
}

#[test]
fn a_live_shaping_session_at_launch_is_a_live_orphan_named_by_its_epic() {
    with_scratch_env(|| {
        let (mut conn, actor_id, project_id, epic) = shaping_epic();
        let id = start_on(&mut conn, &actor_id, &epic.id);
        let mut child = spawn_long_lived_child();
        write_run_descriptor(&id, child.id() as i32, real_start_time_ms(child.id()));

        let orphans = reconcile_sessions(&mut conn, &actor_id).expect("reconcile_sessions");
        let _ = child.kill();
        let _ = child.wait();

        let orphan = orphans.iter().find(|o| o.run_id == id).expect("the live shaping session is an orphan");
        assert_eq!(orphan.story_id, None);
        assert_eq!(orphan.story_key, epic.key);
        assert_eq!(orphan.story_title, epic.title);
        assert_eq!(orphan.project_id, project_id);
        assert_eq!(status(&conn, &id), "running", "a live orphan is left exactly as it is");
    });
}

#[test]
fn the_reads_that_list_sessions_skip_a_shaping_session_without_erroring() {
    let (mut conn, actor_id, project_id, epic) = shaping_epic();
    let live = start_on(&mut conn, &actor_id, &epic.id);
    let other = epic::create_epic(&mut conn, &actor_id, &epic.milestone_id, "Another").unwrap();
    let dead = start_on(&mut conn, &actor_id, &other.id);
    mark_abandoned(&mut conn, &dead, &actor_id, None).unwrap();

    let fleet = flywheel_core::query::fleet::fleet_rows(&conn, 50).expect("the fleet reads with shaping sessions present");
    assert!(fleet.rows.iter().all(|r| r.session_id != live && r.session_id != dead));
    assert!(flywheel_core::query::fleet::blocked_queue(&conn, 50).expect("blocked queue").is_empty());
    assert!(flywheel_core::query::recovery::recovery_story_ids_for_project(&conn, &project_id).expect("recovery ids").is_empty());
    assert_eq!(flywheel_core::query::recovery::recovery_count_for_project(&conn, &project_id).unwrap(), 0);
    assert!(flywheel_core::query::permissions::blocked_story_ids_for_project(&conn, &project_id).unwrap().is_empty());
    assert_eq!(flywheel_core::query::permissions::blocked_count_for_project(&conn, &project_id).unwrap(), 0);
    let run = flywheel_core::query::sessions::run_by_id(&conn, &live).unwrap().expect("the session reads by id");
    assert_eq!(run.story_id, None);
}

#[test]
fn a_story_board_tool_called_from_a_shaping_session_is_refused_by_name() {
    let (mut conn, actor_id, _, epic) = shaping_epic();
    let id = start_on(&mut conn, &actor_id, &epic.id);
    let err = apply_task_tool_call(&mut conn, &id, &TaskToolCall::List).unwrap_err();
    assert!(err.to_string().contains("shaping session"), "{err:#}");
}

#[test]
fn the_schema_ties_a_story_to_a_story_session_and_a_subject_to_a_shaping_one() {
    let (mut conn, actor_id, project_id, epic) = shaping_epic();
    let story = common::new_story(&mut conn, &project_id, &actor_id, "A Story");
    let agent = flywheel_core::domain::session::agent_actor_id(&conn).unwrap();
    let insert = |kind: &str, story_id: Option<&str>, epic_id: Option<&str>, milestone_id: Option<&str>| {
        conn.execute(
            "INSERT INTO sessions (id, kind, story_id, epic_id, milestone_id, project_id, actor_id, status, permission_mode, log_path, started_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'running', 'dontAsk', '/x', '2026-10-22T00:00:00Z')",
            params![flywheel_core::ids::new_id(), kind, story_id, epic_id, milestone_id, project_id, agent],
        )
    };
    assert!(insert("shaping", Some(&story.id), Some(&epic.id), None).is_err(), "a shaping session has no Story");
    assert!(insert("story", None, None, None).is_err(), "a Story session has a Story");
    assert!(insert("story", Some(&story.id), Some(&epic.id), None).is_err(), "a Story session has no shaping subject");
    assert!(insert("shaping", None, Some(&epic.id), Some(&epic.milestone_id)).is_err(), "one subject at most");
    assert!(insert("shaping", None, Some(&epic.id), None).is_ok());
    assert!(insert("shaping", None, None, None).is_ok(), "the Roadmap is a subject with no record");
    assert!(insert("story", Some(&story.id), None, None).is_ok());
}

#[test]
fn a_story_session_still_records_its_kind_and_closes_with_a_stub() {
    with_scratch_env(|| {
        let (mut conn, actor_id, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Story session");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id).unwrap();
        let kind: String = conn.query_row("SELECT kind FROM sessions WHERE id = ?1", [&run.id], |r| r.get(0)).unwrap();
        assert_eq!(kind, "story");
        apply_session_closed(&mut conn, &serde_json::json!({ "type": "session_closed", "runId": run.id, "reason": "completed" }))
            .unwrap();
        assert_eq!(summaries(&conn, &run.id), 1, "a Story session still gets its stub");
    });
}

#[test]
fn the_migration_keeps_every_existing_session_as_a_story_session() {
    use rusqlite_migration::{Migrations, M};
    let sources = flywheel_core::db::migration_sources();
    let dir = tempfile::tempdir().unwrap();
    let mut conn = Connection::open(dir.path().join("old.db")).unwrap();
    let before = Migrations::new(sources[..4].iter().map(|s| M::up(s)).collect());
    before.to_latest(&mut conn).unwrap();

    let human = flywheel_core::domain::actor::local_human_actor_id(&conn).unwrap();
    let project = flywheel_core::domain::project::create_project(&mut conn, &human, "Old", "/repo", "OLD", "main").unwrap();
    let story = common::new_story(&mut conn, &project.id, &human, "Old Story");
    let agent = flywheel_core::domain::session::agent_actor_id(&conn).unwrap();
    let session_id = flywheel_core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at, ending_reason)
         VALUES (?1, ?2, ?3, ?4, 'completed', 'acceptEdits', '/x', '2026-10-01T00:00:00Z', 'handed_off')",
        params![session_id, story.id, project.id, agent],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_summaries (id, session_id, story_id, next_session_must_know, decisions, created_by, created_at)
         VALUES (?1, ?2, ?3, 'n', 'd', ?4, '2026-10-01T00:00:00Z')",
        params![flywheel_core::ids::new_id(), session_id, story.id, agent],
    )
    .unwrap();

    conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
    Migrations::new(sources.iter().map(|s| M::up(s)).collect()).to_latest(&mut conn).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();

    let row: (String, String, Option<String>) = conn
        .query_row("SELECT kind, story_id, ending_reason FROM sessions WHERE id = ?1", [&session_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!(row, ("story".to_string(), story.id, Some("handed_off".to_string())));
    let violations: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
    assert_eq!(violations, 0, "the summary still points at its session");
}
