//! FLEET-01 / FLEET-04 (10-01, D-164..D-169): the cross-project fleet read. Proves the band order,
//! the derived `awaiting_review` state, the cross-project interleave, first-class no-task rows, the
//! latest-run-per-task rule (Finding 1b), tie-break stability, the migration-0020 backfill that
//! stops a first launch flooding the fleet (Pitfall 1), and the empty case.
//!
//! Rows are seeded by direct `INSERT` so each test controls status, timestamps and
//! acknowledgement exactly; no git or worktree is involved, so no scratch worktree root is needed.

use core::db::{migration_sources, open_and_migrate};
use core::domain::actor::local_human_actor_id;
use core::domain::agent_run::{acknowledge_run, ACKNOWLEDGEABLE_STATUSES};
use core::domain::epic::create_epic;
use core::domain::project::{create_project, Project};
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::fleet::{blocked_queue, fleet_rows, FleetSubjectKind, FLEET_ROWS_MAX_LIMIT};
use rusqlite::{params, Connection};

struct Fixture {
    conn: Connection,
    actor_id: String,
    _dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let conn = open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    Fixture { conn, actor_id, _dir: dir }
}

fn project(f: &mut Fixture, name: &str, prefix: &str) -> Project {
    create_project(&mut f.conn, &f.actor_id, name, &format!("/repo/{prefix}"), prefix, "main")
        .expect("create_project should succeed")
}

fn trigger(f: &Fixture, project_id: &str) -> String {
    let id = new_id();
    f.conn
        .execute(
            "INSERT INTO triggers (id, project_id, source, enabled, created_by, created_at)
             VALUES (?1, ?2, 'user_action', 1, ?3, '2026-01-01T00:00:00Z')",
            params![id, project_id, f.actor_id],
        )
        .expect("failed to insert trigger");
    id
}

#[derive(Default)]
struct Run<'a> {
    task_id: Option<&'a str>,
    epic_id: Option<&'a str>,
    stage: Option<&'a str>,
    status: &'a str,
    started_at: &'a str,
    ended_at: Option<&'a str>,
    acknowledged_at: Option<&'a str>,
    cost: Option<f64>,
}

fn insert_run(f: &Fixture, project_id: &str, trigger_id: &str, run: &Run) -> String {
    let id = new_id();
    f.conn
        .execute(
            "INSERT INTO agent_runs (
                id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
                permission_mode, cost_usd, log_path, started_at, ended_at, acknowledged_at,
                authoring_stage
            ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'claude_code', ?6, ?7, 'acceptEdits', ?8, '/dev/null',
                ?9, ?10, ?11, ?12)",
            params![
                id,
                run.task_id,
                run.epic_id,
                project_id,
                trigger_id,
                f.actor_id,
                run.status,
                run.cost,
                run.started_at,
                run.ended_at,
                run.acknowledged_at,
                run.stage,
            ],
        )
        .expect("failed to insert agent run");
    id
}

fn task(f: &mut Fixture, project_id: &str, title: &str, status: &str) -> String {
    let t = create_task(&mut f.conn, project_id, &f.actor_id, title, None)
        .expect("create_task should succeed");
    f.conn
        .execute("UPDATE tasks SET status = ?1 WHERE id = ?2", params![status, t.id])
        .expect("failed to set task status");
    t.id
}

fn ids(rows: &core::query::fleet::FleetList) -> Vec<String> {
    rows.rows.iter().map(|r| r.agent_run_id.clone()).collect()
}

#[test]
fn an_empty_database_returns_zero_rows_and_a_zero_total() {
    let f = fixture();
    let list = fleet_rows(&f.conn, 50).expect("fleet_rows should succeed");
    assert!(list.rows.is_empty());
    assert_eq!(list.total_rows, 0);
}

#[test]
fn bands_run_blocked_awaiting_review_abandoned_running_then_terminal() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);

    // One task per run so the latest-run rule never interferes. Insert in a scrambled order.
    let mk = |f: &mut Fixture, title: &str, task_status: &str, run: Run| {
        let t = task(f, &p.id, title, task_status);
        insert_run(f, &p.id, &trig, &Run { task_id: Some(&t), ..run })
    };
    let failed = mk(&mut f, "t-failed", "in_progress", Run { status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:30:00Z"), ..Default::default() });
    let interrupted = mk(&mut f, "t-int", "in_progress", Run { status: "interrupted", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let running = mk(&mut f, "t-run", "in_progress", Run { status: "running", started_at: "2026-01-01T02:00:00Z", ..Default::default() });
    let abandoned = mk(&mut f, "t-ab", "in_progress", Run { status: "abandoned", started_at: "2026-01-01T03:00:00Z", ..Default::default() });
    let review = mk(&mut f, "t-rev", "in_review", Run { status: "completed", started_at: "2026-01-01T04:00:00Z", ended_at: Some("2026-01-01T04:30:00Z"), ..Default::default() });
    let blocked = mk(&mut f, "t-blk", "in_progress", Run { status: "blocked", started_at: "2026-01-01T05:00:00Z", ..Default::default() });
    let done = mk(&mut f, "t-done", "done", Run { status: "completed", started_at: "2026-01-01T06:00:00Z", ended_at: Some("2026-01-01T06:30:00Z"), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).expect("fleet_rows should succeed");
    // Terminal band orders by ended_at ascending: interrupted (01:10), failed (01:30), done (06:30).
    assert_eq!(ids(&list), vec![blocked, review, abandoned, running, interrupted, failed, done]);
    assert_eq!(list.total_rows, 7);
}

#[test]
fn a_completed_run_reads_awaiting_review_only_while_its_task_is_not_done() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let open = task(&mut f, &p.id, "open", "in_review");
    let closed = task(&mut f, &p.id, "closed", "done");
    let run = |t: &str, f: &Fixture| insert_run(f, &p.id, &trig, &Run { task_id: Some(t), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let open_run = run(&open, &f);
    let closed_run = run(&closed, &f);

    let list = fleet_rows(&f.conn, 50).unwrap();
    let state = |id: &str| list.rows.iter().find(|r| r.agent_run_id == id).unwrap().fleet_state.clone();
    assert_eq!(state(&open_run), "awaiting_review");
    assert_eq!(state(&closed_run), "completed");
    // The run status column is untouched — the state is derived, not stored.
    let stored: String = f
        .conn
        .query_row("SELECT status FROM agent_runs WHERE id = ?1", params![open_run], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, "completed");
}

#[test]
fn rows_from_three_projects_interleave_by_waiting_time_not_by_project() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let b = project(&mut f, "Bravo", "BRV");
    let c = project(&mut f, "Charlie", "CHA");
    let mut seeded = Vec::new();
    for (p, start) in [(&a, "03"), (&b, "01"), (&c, "02"), (&a, "04"), (&b, "05")] {
        let trig = trigger(&f, &p.id);
        let t = task(&mut f, &p.id, "running task", "in_progress");
        let started = format!("2026-01-01T{start}:00:00Z");
        let id = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "running", started_at: &started, ..Default::default() });
        seeded.push((start, id, p.name.clone()));
    }
    seeded.sort();
    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), seeded.iter().map(|s| s.1.clone()).collect::<Vec<_>>());
    let names: Vec<_> = list.rows.iter().map(|r| r.project_name.clone()).collect();
    assert_eq!(names, vec!["Bravo", "Charlie", "Alpha", "Alpha", "Bravo"]);
    assert!(list.rows.iter().all(|r| !r.project_key_prefix.is_empty()));
}

#[test]
fn runs_with_no_task_are_first_class_rows() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let epic = create_epic(&mut f.conn, &p.id, &f.actor_id, "An epic", None).unwrap();

    let planning = insert_run(&f, &p.id, &trig, &Run { epic_id: Some(&epic.id), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let authoring = insert_run(&f, &p.id, &trig, &Run { epic_id: Some(&epic.id), stage: Some("challenge"), status: "running", started_at: "2026-01-01T02:00:00Z", ..Default::default() });
    let bare = insert_run(&f, &p.id, &trig, &Run { stage: Some("decompose"), status: "failed", started_at: "2026-01-01T03:00:00Z", ended_at: Some("2026-01-01T03:10:00Z"), ..Default::default() });
    let nothing = insert_run(&f, &p.id, &trig, &Run { status: "running", started_at: "2026-01-01T04:00:00Z", ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(list.total_rows, 4, "no-task runs must never drop out of the count");
    let by = |id: &str| list.rows.iter().find(|r| r.agent_run_id == id).unwrap();
    assert_eq!(by(&planning).subject_kind, FleetSubjectKind::Epic);
    assert_eq!(by(&planning).epic_id.as_deref(), Some(epic.id.as_str()));
    assert_eq!(by(&planning).epic_key.as_deref(), Some(epic.key.as_str()));
    assert_eq!(by(&authoring).subject_kind, FleetSubjectKind::Authoring);
    assert_eq!(by(&authoring).authoring_stage.as_deref(), Some("challenge"));
    assert_eq!(by(&bare).subject_kind, FleetSubjectKind::Authoring);
    assert!(by(&bare).task_key.is_none() && by(&bare).epic_key.is_none());
    assert_eq!(by(&nothing).subject_kind, FleetSubjectKind::Authoring);
    assert!(by(&nothing).task_id.is_none());
}

#[test]
fn a_task_with_two_unacknowledged_terminal_runs_reads_once_as_its_newest() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t = task(&mut f, &p.id, "retried", "in_progress");
    let _older = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let newer = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "failed", started_at: "2026-01-01T02:00:00Z", ended_at: Some("2026-01-01T02:10:00Z"), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![newer]);
}

#[test]
fn an_unacknowledged_abandoned_run_always_appears_even_beside_a_newer_run() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t = task(&mut f, &p.id, "restarted", "in_progress");
    let abandoned = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "abandoned", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let live = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "running", started_at: "2026-01-01T02:00:00Z", ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![abandoned, live]);
}

#[test]
fn an_acknowledged_terminal_run_leaves_but_a_live_run_never_does() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t1 = task(&mut f, &p.id, "t1", "in_progress");
    let t2 = task(&mut f, &p.id, "t2", "in_progress");
    insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t1), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), acknowledged_at: Some("2026-01-01T02:00:00Z"), ..Default::default() });
    let live = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t2), status: "running", started_at: "2026-01-01T01:00:00Z", acknowledged_at: Some("2026-01-01T02:00:00Z"), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![live]);
}

#[test]
fn ties_on_band_and_waiting_time_order_by_id_and_repeat_identically() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let mut seeded = Vec::new();
    for i in 0..3 {
        let t = task(&mut f, &p.id, &format!("tie {i}"), "in_progress");
        seeded.push(insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() }));
    }
    seeded.sort();

    let first = fleet_rows(&f.conn, 50).unwrap();
    let second = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&first), seeded, "same band and same timestamp must order by ascending id");
    assert_eq!(first, second, "two reads of an unchanged database must be identical");
}

#[test]
fn a_pending_permission_request_marks_the_run_blocked_since_and_orders_by_it() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t1 = task(&mut f, &p.id, "later-block", "in_progress");
    let t2 = task(&mut f, &p.id, "earlier-block", "in_progress");
    // t1's run started first but was blocked LATER; t2's run is the longer-waiting one.
    let r1 = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t1), status: "blocked", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let r2 = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t2), status: "blocked", started_at: "2026-01-01T02:00:00Z", ..Default::default() });
    for (run, task_id, at) in [(&r1, &t1, "2026-01-01T05:00:00Z"), (&r2, &t2, "2026-01-01T03:00:00Z")] {
        f.conn
            .execute(
                "INSERT INTO permission_requests (id, agent_run_id, task_id, project_id, tool_name, status, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'Bash', 'pending', ?5, ?6)",
                params![new_id(), run, task_id, p.id, f.actor_id, at],
            )
            .unwrap();
    }
    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![r2.clone(), r1]);
    assert_eq!(list.rows[0].blocked_since.as_deref(), Some("2026-01-01T03:00:00Z"));
}

#[test]
fn the_window_is_clamped_to_the_server_side_maximum() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    for i in 0..(FLEET_ROWS_MAX_LIMIT + 5) {
        let started = format!("2026-01-01T00:{:02}:{:02}Z", i / 60, i % 60);
        insert_run(&f, &p.id, &trig, &Run { status: "running", started_at: &started, ..Default::default() });
    }
    let list = fleet_rows(&f.conn, usize::MAX).unwrap();
    assert_eq!(list.total_rows, FLEET_ROWS_MAX_LIMIT);
    let small = fleet_rows(&f.conn, 3).unwrap();
    assert_eq!(small.total_rows, 3);
}

/// Pitfall 1: 500 historic terminal runs that predate migration 0020 must not reach the fleet,
/// while a live run and an unacknowledged abandoned run still must.
#[test]
fn migration_0020_backfills_history_so_first_launch_shows_only_live_and_abandoned_runs() {
    let dir = tempfile::tempdir().expect("scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    let fleet_migration_index = 19; // 0020 is the 20th source; everything before it is "N-1".

    let (live, abandoned) = {
        let mut conn = Connection::open(&db_path).unwrap();
        core::db::apply_pragmas(&conn).unwrap();
        let sources = migration_sources();
        rusqlite_migration::Migrations::new(
            sources[..fleet_migration_index].iter().map(|s| rusqlite_migration::M::up(s)).collect(),
        )
        .to_latest(&mut conn)
        .expect("pre-0020 migrations should apply");

        let actor_id = local_human_actor_id(&conn).unwrap();
        let project_id = new_id();
        conn.execute(
            "INSERT INTO projects (id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at)
             VALUES (?1, 'OLD', 'Old', '/repo/old', 'main', 0, 'active', ?2, '2025-01-01T00:00:00Z')",
            params![project_id, actor_id],
        )
        .unwrap();
        let trigger_id = new_id();
        conn.execute(
            "INSERT INTO triggers (id, project_id, source, enabled, created_by, created_at)
             VALUES (?1, ?2, 'user_action', 1, ?3, '2025-01-01T00:00:00Z')",
            params![trigger_id, project_id, actor_id],
        )
        .unwrap();
        let insert = |status: &str, n: usize, ended: Option<&str>| {
            let id = new_id();
            conn.execute(
                "INSERT INTO agent_runs (id, project_id, trigger_id, adapter, actor_id, status, permission_mode, log_path, started_at, ended_at)
                 VALUES (?1, ?2, ?3, 'claude_code', ?4, ?5, 'acceptEdits', '/dev/null', ?6, ?7)",
                params![id, project_id, trigger_id, actor_id, status, format!("2025-02-01T00:{:02}:{:02}Z", n / 60, n % 60), ended],
            )
            .unwrap();
            id
        };
        for n in 0..500 {
            let status = ["completed", "failed", "interrupted"][n % 3];
            // Every third historic run never recorded an end: the backfill falls back to started_at.
            insert(status, n, if n % 3 == 2 { None } else { Some("2025-02-02T00:00:00Z") });
        }
        let live = insert("running", 501, None);
        let abandoned = insert("abandoned", 502, None);
        (live, abandoned)
    };

    let conn = open_and_migrate(&db_path, &backups_dir).expect("migration 0020 should apply");
    let list = fleet_rows(&conn, 200).unwrap();
    let mut got = ids(&list);
    got.sort();
    let mut want = vec![live, abandoned];
    want.sort();
    assert_eq!(got, want, "only the live run and the unacknowledged abandoned run may appear");

    let backfilled: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE status IN ('completed','failed','interrupted') AND acknowledged_at IS NOT NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(backfilled, 500);
    let untouched: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_runs WHERE status = 'abandoned' AND acknowledged_at IS NULL", [], |r| r.get(0))
        .unwrap();
    assert_eq!(untouched, 1, "the backfill must leave abandoned rows for the recovery surface");
}

// ---- 10-04: acknowledging a run, and what the fleet says it spent ----------------------------------

fn acknowledged_at(f: &Fixture, run_id: &str) -> Option<String> {
    f.conn
        .query_row("SELECT acknowledged_at FROM agent_runs WHERE id = ?1", params![run_id], |r| r.get(0))
        .unwrap()
}

#[test]
fn the_acknowledgeable_statuses_are_exactly_the_four_terminal_ones() {
    assert_eq!(ACKNOWLEDGEABLE_STATUSES, ["abandoned", "completed", "failed", "interrupted"]);
}

#[test]
fn acknowledging_each_terminal_status_removes_the_run_from_the_fleet() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    for status in ACKNOWLEDGEABLE_STATUSES {
        let t = task(&mut f, &p.id, status, "in_progress");
        let run = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status, started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
        assert!(ids(&fleet_rows(&f.conn, 50).unwrap()).contains(&run), "{status} should be on the fleet first");
        assert!(acknowledge_run(&f.conn, &run).unwrap(), "{status} should be acknowledged");
        assert!(acknowledged_at(&f, &run).is_some());
        assert!(!ids(&fleet_rows(&f.conn, 50).unwrap()).contains(&run), "{status} should have left the fleet");
    }
}

#[test]
fn a_live_run_cannot_be_acknowledged() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    for status in ["running", "blocked"] {
        let t = task(&mut f, &p.id, status, "in_progress");
        let run = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status, started_at: "2026-01-01T01:00:00Z", ..Default::default() });
        assert!(!acknowledge_run(&f.conn, &run).unwrap(), "{status} must be refused");
        assert_eq!(acknowledged_at(&f, &run), None);
        assert!(ids(&fleet_rows(&f.conn, 50).unwrap()).contains(&run));
    }
}

#[test]
fn acknowledging_twice_keeps_the_first_timestamp_and_an_unknown_id_is_refused() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t = task(&mut f, &p.id, "t", "in_progress");
    let run = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });

    assert!(acknowledge_run(&f.conn, &run).unwrap());
    let first = acknowledged_at(&f, &run);
    assert!(!acknowledge_run(&f.conn, &run).unwrap(), "the second acknowledge changes nothing");
    assert_eq!(acknowledged_at(&f, &run), first);
    assert!(!acknowledge_run(&f.conn, "01NOSUCHRUN0000000000000").unwrap());
}

#[test]
fn moving_a_task_to_done_does_not_clear_its_row_it_re_reads_as_plain_completed() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t = task(&mut f, &p.id, "t", "in_review");
    let run = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let state = |f: &Fixture| fleet_rows(&f.conn, 50).unwrap().rows.into_iter().find(|r| r.agent_run_id == run).map(|r| r.fleet_state);
    assert_eq!(state(&f).as_deref(), Some("awaiting_review"));

    f.conn.execute("UPDATE tasks SET status = 'done' WHERE id = ?1", params![t]).unwrap();
    assert_eq!(state(&f).as_deref(), Some("completed"), "still on the fleet, now plain completed");
    assert_eq!(acknowledged_at(&f, &run), None, "moving a task never acknowledges its run");
}

#[test]
fn spend_projects_null_for_a_live_run_and_its_cost_for_a_failed_one() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    let t1 = task(&mut f, &p.id, "t1", "in_progress");
    let t2 = task(&mut f, &p.id, "t2", "in_progress");
    let live = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t1), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let failed = insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t2), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), cost: Some(0.42), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    let cost = |id: &str| list.rows.iter().find(|r| r.agent_run_id == id).unwrap().cost_usd;
    assert_eq!(cost(&live), None);
    assert_eq!(cost(&failed), Some(0.42));
}

#[test]
fn visible_cost_is_none_without_a_costed_row_and_the_exact_sum_otherwise() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &p.id);
    assert_eq!(fleet_rows(&f.conn, 50).unwrap().visible_cost_usd, None, "an empty fleet has no total");

    let t1 = task(&mut f, &p.id, "t1", "in_progress");
    let t2 = task(&mut f, &p.id, "t2", "in_progress");
    let t3 = task(&mut f, &p.id, "t3", "in_progress");
    insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t1), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t2), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    assert_eq!(fleet_rows(&f.conn, 50).unwrap().visible_cost_usd, None, "rows with no recorded cost sum to nothing, not zero");

    insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t3), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), cost: Some(1.5), ..Default::default() });
    let t4 = task(&mut f, &p.id, "t4", "in_progress");
    insert_run(&f, &p.id, &trig, &Run { task_id: Some(&t4), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), cost: Some(0.25), ..Default::default() });
    assert_eq!(fleet_rows(&f.conn, 50).unwrap().visible_cost_usd, Some(1.75));
}

// ---- FLEET-02 (10-05, D-172): the blocked queue ----

/// `permission_requests.id` is CHECKed to 26 characters; right-pad so ids keep their sort order.
fn rid(s: &str) -> String {
    format!("{s:0<26}")
}

fn pending(f: &Fixture, project_id: &str, run: &str, request_id: &str, at: &str) {
    let request_id = rid(request_id);
    f.conn
        .execute(
            "INSERT INTO permission_requests (id, agent_run_id, project_id, tool_name, status, created_by, created_at)
             VALUES (?1, ?2, ?3, 'Bash', 'pending', ?4, ?5)",
            params![request_id, run, project_id, f.actor_id, at],
        )
        .unwrap();
}

#[test]
fn the_queue_spans_projects_and_carries_each_project_name() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let b = project(&mut f, "Beta", "BET");
    let (ta, tb) = (trigger(&f, &a.id), trigger(&f, &b.id));
    let blocked = Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() };
    let ra = insert_run(&f, &a.id, &ta, &blocked);
    let rb = insert_run(&f, &b.id, &tb, &blocked);
    pending(&f, &a.id, &ra, "req-a", "2026-01-01T01:00:00Z");
    pending(&f, &b.id, &rb, "req-b", "2026-01-01T02:00:00Z");
    let q = blocked_queue(&f.conn, 50).unwrap();
    assert_eq!(q.len(), 2);
    assert_eq!((q[0].project_name.as_str(), q[0].request_id.as_str()), ("Alpha", rid("req-a").as_str()));
    assert_eq!((q[1].project_name.as_str(), q[1].request_id.as_str()), ("Beta", rid("req-b").as_str()));
    assert_eq!(q[0].tool_name, "Bash");
    assert_eq!(q[0].agent_run_id, ra);
}

#[test]
fn a_run_with_two_pending_requests_is_one_entry_carrying_the_earlier() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &a.id);
    let r = insert_run(&f, &a.id, &trig, &Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    pending(&f, &a.id, &r, "req-late", "2026-01-01T03:00:00Z");
    pending(&f, &a.id, &r, "req-early", "2026-01-01T02:00:00Z");
    let q = blocked_queue(&f.conn, 50).unwrap();
    assert_eq!(q.len(), 1);
    assert_eq!(q[0].request_id, rid("req-early"));
}

#[test]
fn an_answered_request_does_not_appear() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &a.id);
    let r = insert_run(&f, &a.id, &trig, &Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    pending(&f, &a.id, &r, "req-1", "2026-01-01T02:00:00Z");
    f.conn.execute("UPDATE permission_requests SET status = 'allowed'", []).unwrap();
    assert!(blocked_queue(&f.conn, 50).unwrap().is_empty());
}

#[test]
fn only_blocked_runs_are_queued_and_the_fleet_band_disagrees_where_d172_says() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &a.id);
    let t = task(&mut f, &a.id, "cold", "in_progress");
    let abandoned = insert_run(&f, &a.id, &trig, &Run { task_id: Some(&t), status: "abandoned", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    let t2 = task(&mut f, &a.id, "review", "in_review");
    insert_run(&f, &a.id, &trig, &Run { task_id: Some(&t2), status: "completed", started_at: "2026-01-01T00:00:00Z", ended_at: Some("2026-01-01T01:00:00Z"), ..Default::default() });
    insert_run(&f, &a.id, &trig, &Run { status: "running", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    let fleet = fleet_rows(&f.conn, 50).unwrap();
    assert!(ids(&fleet).contains(&abandoned), "the fleet's NEEDS YOU band holds the abandoned run");
    assert!(blocked_queue(&f.conn, 50).unwrap().is_empty(), "the queue holds live blocks only");
}

#[test]
fn ties_on_created_at_order_by_request_id_and_repeat_identically() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let trig = trigger(&f, &a.id);
    let blocked = Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() };
    let r1 = insert_run(&f, &a.id, &trig, &blocked);
    let r2 = insert_run(&f, &a.id, &trig, &blocked);
    pending(&f, &a.id, &r1, "req-z", "2026-01-01T02:00:00Z");
    pending(&f, &a.id, &r2, "req-a", "2026-01-01T02:00:00Z");
    let first = blocked_queue(&f.conn, 50).unwrap();
    let second = blocked_queue(&f.conn, 50).unwrap();
    let order: Vec<&str> = first.iter().map(|e| e.request_id.as_str()).collect();
    assert_eq!(order, vec![rid("req-a").as_str(), rid("req-z").as_str()]);
    assert_eq!(first, second);
}

#[test]
fn an_empty_database_has_an_empty_queue() {
    let f = fixture();
    assert!(blocked_queue(&f.conn, 50).unwrap().is_empty());
}
