//! FLEET-01 / FLEET-04 (10-01, D-164..D-169): the cross-project fleet read. Proves the band order,
//! the derived `awaiting_review` state, the cross-project interleave, the latest-session-per-Story
//! rule (Finding 1b), tie-break stability, and the empty case.
//!
//! Sessions are seeded by direct `INSERT` so each test controls status, timestamps and
//! acknowledgement exactly; no git or worktree is involved, so no scratch worktree root is needed.

mod common;

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::agent_run::{acknowledge_run, ACKNOWLEDGEABLE_STATUSES};
use core::domain::project::{create_project, Project};
use core::ids::new_id;
use core::query::fleet::{blocked_queue, fleet_rows, FLEET_ROWS_MAX_LIMIT};
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

#[derive(Default)]
struct Run<'a> {
    /// The session's Story; `None` gives the session a fresh Story of its own (in Running).
    story_id: Option<&'a str>,
    status: &'a str,
    started_at: &'a str,
    ended_at: Option<&'a str>,
    acknowledged_at: Option<&'a str>,
    cost: Option<f64>,
}

fn insert_run(f: &mut Fixture, project_id: &str, run: &Run) -> String {
    let story_id = match run.story_id {
        Some(id) => id.to_string(),
        None => story(f, project_id, "session story", "running"),
    };
    let id = new_id();
    f.conn
        .execute(
            "INSERT INTO sessions (
                id, worktree_id, story_id, project_id, adapter, actor_id, status,
                permission_mode, cost_usd, log_path, started_at, ended_at, acknowledged_at
            ) VALUES (?1, NULL, ?2, ?3, 'claude_code', ?4, ?5, 'acceptEdits', ?6, '/dev/null',
                ?7, ?8, ?9)",
            params![
                id,
                story_id,
                project_id,
                f.actor_id,
                run.status,
                run.cost,
                run.started_at,
                run.ended_at,
                run.acknowledged_at,
            ],
        )
        .expect("failed to insert session");
    id
}

/// A Story in `project_id` whose state is set directly to `state` (the fleet reads the stored
/// state; the transition rules are `story.rs`'s concern, not this read's).
fn story(f: &mut Fixture, project_id: &str, title: &str, state: &str) -> String {
    let s = common::new_story(&mut f.conn, project_id, &f.actor_id.clone(), title);
    f.conn
        .execute("UPDATE stories SET state = ?1 WHERE id = ?2", params![state, s.id])
        .expect("failed to set the Story state");
    s.id
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

    // One Story per session so the latest-run rule never interferes. Insert in a scrambled order.
    let mk = |f: &mut Fixture, title: &str, story_state: &str, run: Run| {
        let t = story(f, &p.id, title, story_state);
        insert_run(f, &p.id, &Run { story_id: Some(&t), ..run })
    };
    let failed = mk(&mut f, "t-failed", "running", Run { status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:30:00Z"), ..Default::default() });
    let interrupted = mk(&mut f, "t-int", "running", Run { status: "interrupted", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let running = mk(&mut f, "t-run", "running", Run { status: "running", started_at: "2026-01-01T02:00:00Z", ..Default::default() });
    let abandoned = mk(&mut f, "t-ab", "running", Run { status: "abandoned", started_at: "2026-01-01T03:00:00Z", ..Default::default() });
    let review = mk(&mut f, "t-rev", "in_review", Run { status: "completed", started_at: "2026-01-01T04:00:00Z", ended_at: Some("2026-01-01T04:30:00Z"), ..Default::default() });
    let blocked = mk(&mut f, "t-blk", "running", Run { status: "blocked", started_at: "2026-01-01T05:00:00Z", ..Default::default() });
    let merged = mk(&mut f, "t-merged", "merged", Run { status: "completed", started_at: "2026-01-01T06:00:00Z", ended_at: Some("2026-01-01T06:30:00Z"), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).expect("fleet_rows should succeed");
    // Terminal band orders by ended_at ascending: interrupted (01:10), failed (01:30), merged (06:30).
    assert_eq!(ids(&list), vec![blocked, review, abandoned, running, interrupted, failed, merged]);
    assert_eq!(list.total_rows, 7);
}

#[test]
fn a_completed_run_reads_awaiting_review_only_while_its_story_is_not_closed() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let open = story(&mut f, &p.id, "open", "in_review");
    let closed = story(&mut f, &p.id, "closed", "merged");
    let run = |t: &str, f: &mut Fixture| insert_run(f, &p.id, &Run { story_id: Some(t), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let open_run = run(&open, &mut f);
    let closed_run = run(&closed, &mut f);

    let list = fleet_rows(&f.conn, 50).unwrap();
    let state = |id: &str| list.rows.iter().find(|r| r.agent_run_id == id).unwrap().fleet_state.clone();
    assert_eq!(state(&open_run), "awaiting_review");
    assert_eq!(state(&closed_run), "completed");
    // The run status column is untouched — the state is derived, not stored.
    let stored: String = f
        .conn
        .query_row("SELECT status FROM sessions WHERE id = ?1", params![open_run], |r| r.get(0))
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
        let t = story(&mut f, &p.id, "running story", "running");
        let started = format!("2026-01-01T{start}:00:00Z");
        let id = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "running", started_at: &started, ..Default::default() });
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
fn a_story_with_two_unacknowledged_terminal_runs_reads_once_as_its_newest() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let t = story(&mut f, &p.id, "retried", "running");
    let _older = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let newer = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "failed", started_at: "2026-01-01T02:00:00Z", ended_at: Some("2026-01-01T02:10:00Z"), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![newer]);
}

#[test]
fn an_unacknowledged_abandoned_run_always_appears_even_beside_a_newer_run() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let t = story(&mut f, &p.id, "restarted", "running");
    let abandoned = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "abandoned", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let live = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "running", started_at: "2026-01-01T02:00:00Z", ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![abandoned, live]);
}

#[test]
fn an_acknowledged_terminal_run_leaves_but_a_live_run_never_does() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let t1 = story(&mut f, &p.id, "t1", "running");
    let t2 = story(&mut f, &p.id, "t2", "running");
    insert_run(&mut f, &p.id, &Run { story_id: Some(&t1), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), acknowledged_at: Some("2026-01-01T02:00:00Z"), ..Default::default() });
    let live = insert_run(&mut f, &p.id, &Run { story_id: Some(&t2), status: "running", started_at: "2026-01-01T01:00:00Z", acknowledged_at: Some("2026-01-01T02:00:00Z"), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    assert_eq!(ids(&list), vec![live]);
}

#[test]
fn ties_on_band_and_waiting_time_order_by_id_and_repeat_identically() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let mut seeded = Vec::new();
    for i in 0..3 {
        let t = story(&mut f, &p.id, &format!("tie {i}"), "running");
        seeded.push(insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() }));
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
    let t1 = story(&mut f, &p.id, "later-block", "running");
    let t2 = story(&mut f, &p.id, "earlier-block", "running");
    // s1's run started first but was blocked LATER; s2's run is the longer-waiting one.
    let r1 = insert_run(&mut f, &p.id, &Run { story_id: Some(&t1), status: "blocked", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let r2 = insert_run(&mut f, &p.id, &Run { story_id: Some(&t2), status: "blocked", started_at: "2026-01-01T02:00:00Z", ..Default::default() });
    for (run, story_id, at) in [(&r1, &t1, "2026-01-01T05:00:00Z"), (&r2, &t2, "2026-01-01T03:00:00Z")] {
        f.conn
            .execute(
                "INSERT INTO permission_requests (id, session_id, story_id, project_id, tool_name, status, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'Bash', 'pending', ?5, ?6)",
                params![new_id(), run, story_id, p.id, f.actor_id, at],
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
    for i in 0..(FLEET_ROWS_MAX_LIMIT + 5) {
        let started = format!("2026-01-01T00:{:02}:{:02}Z", i / 60, i % 60);
        insert_run(&mut f, &p.id, &Run { status: "running", started_at: &started, ..Default::default() });
    }
    let list = fleet_rows(&f.conn, usize::MAX).unwrap();
    assert_eq!(list.total_rows, FLEET_ROWS_MAX_LIMIT);
    let small = fleet_rows(&f.conn, 3).unwrap();
    assert_eq!(small.total_rows, 3);
}

// ---- 10-04: acknowledging a run, and what the fleet says it spent ----------------------------------

fn acknowledged_at(f: &Fixture, run_id: &str) -> Option<String> {
    f.conn
        .query_row("SELECT acknowledged_at FROM sessions WHERE id = ?1", params![run_id], |r| r.get(0))
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
    for status in ACKNOWLEDGEABLE_STATUSES {
        let t = story(&mut f, &p.id, status, "running");
        let run = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status, started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
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
    for status in ["running", "blocked"] {
        let t = story(&mut f, &p.id, status, "running");
        let run = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status, started_at: "2026-01-01T01:00:00Z", ..Default::default() });
        assert!(!acknowledge_run(&f.conn, &run).unwrap(), "{status} must be refused");
        assert_eq!(acknowledged_at(&f, &run), None);
        assert!(ids(&fleet_rows(&f.conn, 50).unwrap()).contains(&run));
    }
}

#[test]
fn acknowledging_twice_keeps_the_first_timestamp_and_an_unknown_id_is_refused() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let t = story(&mut f, &p.id, "t", "running");
    let run = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });

    assert!(acknowledge_run(&f.conn, &run).unwrap());
    let first = acknowledged_at(&f, &run);
    assert!(!acknowledge_run(&f.conn, &run).unwrap(), "the second acknowledge changes nothing");
    assert_eq!(acknowledged_at(&f, &run), first);
    assert!(!acknowledge_run(&f.conn, "01NOSUCHRUN0000000000000").unwrap());
}

#[test]
fn moving_a_story_to_merged_does_not_clear_its_row_it_re_reads_as_plain_completed() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let t = story(&mut f, &p.id, "t", "in_review");
    let run = insert_run(&mut f, &p.id, &Run { story_id: Some(&t), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    let state = |f: &Fixture| fleet_rows(&f.conn, 50).unwrap().rows.into_iter().find(|r| r.agent_run_id == run).map(|r| r.fleet_state);
    assert_eq!(state(&f).as_deref(), Some("awaiting_review"));

    f.conn.execute("UPDATE stories SET state = 'merged' WHERE id = ?1", params![t]).unwrap();
    assert_eq!(state(&f).as_deref(), Some("completed"), "still on the fleet, now plain completed");
    assert_eq!(acknowledged_at(&f, &run), None, "moving a Story never acknowledges its session");
}

#[test]
fn spend_projects_null_for_a_live_run_and_its_cost_for_a_failed_one() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    let t1 = story(&mut f, &p.id, "t1", "running");
    let t2 = story(&mut f, &p.id, "t2", "running");
    let live = insert_run(&mut f, &p.id, &Run { story_id: Some(&t1), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    let failed = insert_run(&mut f, &p.id, &Run { story_id: Some(&t2), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), cost: Some(0.42), ..Default::default() });

    let list = fleet_rows(&f.conn, 50).unwrap();
    let cost = |id: &str| list.rows.iter().find(|r| r.agent_run_id == id).unwrap().cost_usd;
    assert_eq!(cost(&live), None);
    assert_eq!(cost(&failed), Some(0.42));
}

#[test]
fn visible_cost_is_none_without_a_costed_row_and_the_exact_sum_otherwise() {
    let mut f = fixture();
    let p = project(&mut f, "Alpha", "ALP");
    assert_eq!(fleet_rows(&f.conn, 50).unwrap().visible_cost_usd, None, "an empty fleet has no total");

    let t1 = story(&mut f, &p.id, "t1", "running");
    let t2 = story(&mut f, &p.id, "t2", "running");
    let t3 = story(&mut f, &p.id, "t3", "running");
    insert_run(&mut f, &p.id, &Run { story_id: Some(&t1), status: "running", started_at: "2026-01-01T01:00:00Z", ..Default::default() });
    insert_run(&mut f, &p.id, &Run { story_id: Some(&t2), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), ..Default::default() });
    assert_eq!(fleet_rows(&f.conn, 50).unwrap().visible_cost_usd, None, "rows with no recorded cost sum to nothing, not zero");

    insert_run(&mut f, &p.id, &Run { story_id: Some(&t3), status: "failed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), cost: Some(1.5), ..Default::default() });
    let t4 = story(&mut f, &p.id, "t4", "running");
    insert_run(&mut f, &p.id, &Run { story_id: Some(&t4), status: "completed", started_at: "2026-01-01T01:00:00Z", ended_at: Some("2026-01-01T01:10:00Z"), cost: Some(0.25), ..Default::default() });
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
            "INSERT INTO permission_requests (id, session_id, story_id, project_id, tool_name, status, created_by, created_at)
             VALUES (?1, ?2, (SELECT story_id FROM sessions WHERE id = ?2), ?3, 'Bash', 'pending', ?4, ?5)",
            params![request_id, run, project_id, f.actor_id, at],
        )
        .unwrap();
}

#[test]
fn the_queue_spans_projects_and_carries_each_project_name() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let b = project(&mut f, "Beta", "BET");
    let blocked = Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() };
    let ra = insert_run(&mut f, &a.id, &blocked);
    let rb = insert_run(&mut f, &b.id, &blocked);
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
    let r = insert_run(&mut f, &a.id, &Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
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
    let r = insert_run(&mut f, &a.id, &Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    pending(&f, &a.id, &r, "req-1", "2026-01-01T02:00:00Z");
    f.conn.execute("UPDATE permission_requests SET status = 'allowed'", []).unwrap();
    assert!(blocked_queue(&f.conn, 50).unwrap().is_empty());
}

#[test]
fn only_blocked_runs_are_queued_and_the_fleet_band_disagrees_where_d172_says() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let t = story(&mut f, &a.id, "cold", "running");
    let abandoned = insert_run(&mut f, &a.id, &Run { story_id: Some(&t), status: "abandoned", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    let t2 = story(&mut f, &a.id, "review", "in_review");
    insert_run(&mut f, &a.id, &Run { story_id: Some(&t2), status: "completed", started_at: "2026-01-01T00:00:00Z", ended_at: Some("2026-01-01T01:00:00Z"), ..Default::default() });
    insert_run(&mut f, &a.id, &Run { status: "running", started_at: "2026-01-01T00:00:00Z", ..Default::default() });
    let fleet = fleet_rows(&f.conn, 50).unwrap();
    assert!(ids(&fleet).contains(&abandoned), "the fleet's NEEDS YOU band holds the abandoned run");
    assert!(blocked_queue(&f.conn, 50).unwrap().is_empty(), "the queue holds live blocks only");
}

#[test]
fn ties_on_created_at_order_by_request_id_and_repeat_identically() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let blocked = Run { status: "blocked", started_at: "2026-01-01T00:00:00Z", ..Default::default() };
    let r1 = insert_run(&mut f, &a.id, &blocked);
    let r2 = insert_run(&mut f, &a.id, &blocked);
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
