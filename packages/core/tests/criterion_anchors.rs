//! REVW-03 (D-139, D-140, D-141): the anchor behind a checked criterion — written with a
//! core-resolved sha, cleared on uncheck, carried across a revision, cascaded on delete, and its
//! staleness derived from git on every read (Phase 8 plan 08-02).

mod common;

use core::domain::acceptance_criterion::{
    anchor_for_criterion, check_criterion_with_anchor, create_criterion, revise_criterion,
    toggle_criterion, AnchorInput,
};
use core::domain::agent_run::start_agent_run;
use core::domain::task::{create_task, delete_task};
use rusqlite::{params, Connection};

static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().expect("scratch worktree root");
    // SAFETY: serialised by WORKTREE_ROOT_ENV_LOCK; cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

fn input(path: &str, start: u32, end: u32) -> AnchorInput {
    AnchorInput { path: path.into(), side: "new".into(), line_start: start, line_end: end }
}

fn anchor_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT count(*) FROM criterion_anchors", [], |r| r.get(0)).unwrap()
}

/// One task with one criterion on a seeded project.
fn one_criterion() -> (Connection, String, String, String, String) {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();
    let c = create_criterion(&mut conn, &project.id, &actor, "task", &task.id, "It works", None).unwrap();
    (conn, actor, project.id, task.id, c.id)
}

#[test]
fn the_anchors_table_exists_keyed_by_criterion() {
    let (conn, ..) = one_criterion();
    let pk: String = conn
        .query_row("SELECT name FROM pragma_table_info('criterion_anchors') WHERE pk = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(pk, "criterion_id");
}

fn raw_insert(conn: &Connection, actor: &str, cid: &str, side: &str, start: i64, end: i64) -> rusqlite::Result<usize> {
    conn.execute(
        "INSERT INTO criterion_anchors (criterion_id, path, side, line_start, line_end, sha, created_by, created_at)
         VALUES (?1, 'a.rs', ?2, ?3, ?4, 'abc', ?5, 'now')",
        params![cid, side, start, end, actor],
    )
}

#[test]
fn schema_rejects_an_inverted_line_range() {
    let (conn, actor, _p, _t, cid) = one_criterion();
    assert!(raw_insert(&conn, &actor, &cid, "new", 9, 3).is_err());
    assert!(raw_insert(&conn, &actor, &cid, "new", 0, 3).is_err());
}

#[test]
fn schema_rejects_an_unknown_side() {
    let (conn, actor, _p, _t, cid) = one_criterion();
    assert!(raw_insert(&conn, &actor, &cid, "middle", 1, 2).is_err());
    assert!(raw_insert(&conn, &actor, &cid, "old", 1, 2).is_ok());
}

#[test]
fn check_with_anchor_stores_the_core_supplied_sha() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    let c = check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("src/a.rs", 3, 7)), "deadbeef").unwrap();
    assert!(c.checked);
    let a = anchor_for_criterion(&conn, &cid).unwrap().expect("anchor row");
    assert_eq!((a.path.as_str(), a.side.as_str(), a.line_start, a.line_end), ("src/a.rs", "new", 3, 7));
    assert_eq!(a.sha, "deadbeef");
}

#[test]
fn check_with_no_anchor_stores_no_row() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    let c = check_criterion_with_anchor(&mut conn, &actor, &cid, None, "deadbeef").unwrap();
    assert!(c.checked);
    assert_eq!(anchor_count(&conn), 0);
    assert!(anchor_for_criterion(&conn, &cid).unwrap().is_none());
}

#[test]
fn a_second_check_replaces_the_anchor_rather_than_adding_one() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("a.rs", 1, 2)), "sha1").unwrap();
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("b.rs", 10, 20)), "sha2").unwrap();
    assert_eq!(anchor_count(&conn), 1);
    let a = anchor_for_criterion(&conn, &cid).unwrap().unwrap();
    assert_eq!((a.path.as_str(), a.line_start, a.line_end, a.sha.as_str()), ("b.rs", 10, 20, "sha2"));
}

#[test]
fn a_bad_side_is_refused_with_a_named_error_before_any_write() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    let mut bad = input("a.rs", 1, 1);
    bad.side = "middle".into();
    let err = check_criterion_with_anchor(&mut conn, &actor, &cid, Some(bad), "sha").unwrap_err();
    assert!(err.to_string().contains("side"), "{err}");
    let checked: i64 = conn.query_row("SELECT checked FROM acceptance_criteria WHERE id = ?1", params![cid], |r| r.get(0)).unwrap();
    assert_eq!(checked, 0, "a refused check writes nothing");
}

#[test]
fn an_overlong_path_is_refused() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    let long = "x".repeat(5000);
    assert!(check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input(&long, 1, 1)), "sha").is_err());
}

#[test]
fn unchecking_clears_the_anchor_in_the_same_transaction() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("a.rs", 1, 2)), "sha").unwrap();
    let c = toggle_criterion(&mut conn, &actor, &cid).unwrap();
    assert!(!c.checked);
    // One read: both facts must agree.
    let (checked, anchors): (i64, i64) = conn
        .query_row(
            "SELECT ac.checked, (SELECT count(*) FROM criterion_anchors WHERE criterion_id = ac.id)
             FROM acceptance_criteria ac WHERE ac.id = ?1",
            params![cid],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((checked, anchors), (0, 0));
}

#[test]
fn rechecking_after_an_uncheck_does_not_resurrect_the_anchor() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("a.rs", 1, 2)), "sha").unwrap();
    toggle_criterion(&mut conn, &actor, &cid).unwrap();
    let c = toggle_criterion(&mut conn, &actor, &cid).unwrap();
    assert!(c.checked);
    assert_eq!(anchor_count(&conn), 0);
}

#[test]
fn revising_a_locked_criterion_carries_the_anchor_to_the_successor() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let project = project.id;
        let task = create_task(&mut conn, &project, &actor, "T", None).unwrap();
        let c = create_criterion(&mut conn, &project, &actor, "task", &task.id, "Old text", None).unwrap();
        check_criterion_with_anchor(&mut conn, &actor, &c.id, Some(input("src/a.rs", 4, 9)), "cafe01").unwrap();
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor).unwrap(); // locks the criteria

        let successor = revise_criterion(&mut conn, &actor, &c.id, "New text", None).unwrap();
        assert_ne!(successor.id, c.id, "locked edit must mint a revision");
        assert!(successor.checked);
        let a = anchor_for_criterion(&conn, &successor.id).unwrap().expect("anchor carried forward");
        assert_eq!((a.path.as_str(), a.side.as_str(), a.line_start, a.line_end, a.sha.as_str()),
                   ("src/a.rs", "new", 4, 9, "cafe01"));
    });
}

#[test]
fn deleting_the_criterion_leaves_no_anchor() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("a.rs", 1, 2)), "sha").unwrap();
    core::domain::acceptance_criterion::delete_criterion(&mut conn, &actor, &cid).unwrap();
    assert_eq!(anchor_count(&conn), 0);
}

#[test]
fn deleting_the_parent_task_leaves_no_anchor() {
    let (mut conn, actor, _p, task, cid) = one_criterion();
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("a.rs", 1, 2)), "sha").unwrap();
    delete_task(&mut conn, &actor, &task).unwrap();
    assert_eq!(anchor_count(&conn), 0);
}

#[test]
fn every_write_appends_exactly_one_toggled_event_carrying_the_anchor() {
    let (mut conn, actor, _p, _t, cid) = one_criterion();
    let events = |conn: &Connection| -> Vec<String> {
        let mut s = conn
            .prepare("SELECT payload FROM events WHERE stream_id = ?1 AND event_type = 'criterion.toggled' ORDER BY sequence")
            .unwrap();
        s.query_map(params![cid], |r| r.get::<_, String>(0)).unwrap().map(|r| r.unwrap()).collect()
    };
    check_criterion_with_anchor(&mut conn, &actor, &cid, Some(input("a.rs", 1, 2)), "sha").unwrap();
    let after_check = events(&conn);
    assert_eq!(after_check.len(), 1);
    let v: serde_json::Value = serde_json::from_str(&after_check[0]).unwrap();
    assert_eq!(v["anchor"]["path"], "a.rs");
    assert_eq!(v["anchor"]["sha"], "sha");

    toggle_criterion(&mut conn, &actor, &cid).unwrap();
    assert_eq!(events(&conn).len(), 2, "the uncheck appends exactly one more");
}
