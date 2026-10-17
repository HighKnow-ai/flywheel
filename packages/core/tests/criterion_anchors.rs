//! REVW-03 (D-139, D-140, D-141): the anchor behind a checked criterion — written with a
//! core-resolved sha, cleared on uncheck, carried across a revision, cascaded on delete, and its
//! staleness derived from git on every read (Phase 8 plan 08-02). Plan 08-09 adds the read-only
//! per-task criteria roll-up an epic's review rail shows (D-132; tests named `rollup`).

mod common;

use common::with_scratch_worktree_root;

use core::domain::acceptance_criterion::{
    anchor_for_criterion, check_criterion_with_anchor, create_criterion, revise_criterion,
    toggle_criterion, AnchorInput,
};
use core::domain::agent_run::start_agent_run;
use core::domain::epic::create_epic;
use core::domain::task::{create_task, delete_task};
use core::review::epic_task_rollup;
use rusqlite::{params, Connection};

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
    with_scratch_worktree_root(|_| {
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

// ---- staleness (D-141, Pitfall 9) -------------------------------------------------------------

use core::review::{anchor_staleness, review_criteria_state, AnchorStaleness, ReviewScope};
use std::path::Path;
use std::process::Command;

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output().expect("spawn git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A repo with the review fixture; `flywheel/task-rich` is checked out so tests can commit on it.
fn rich_repo() -> (tempfile::TempDir, String) {
    let (_conn, _actor, _project, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    git(repo.path(), &["checkout", b.task_rich]);
    let tip = git(repo.path(), &["rev-parse", "HEAD"]);
    (repo, tip)
}

fn commit_file(repo: &Path, name: &str, body: &str) {
    std::fs::write(repo.join(name), body).unwrap();
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-q", "-m", "more work"]);
}

const HEAD: &str = "flywheel/task-rich";

#[test]
fn untouched_when_only_other_files_changed() {
    let (repo, sha) = rich_repo();
    assert_eq!(anchor_staleness(repo.path(), HEAD, &sha, "keep.txt").unwrap(), AnchorStaleness::Untouched);
    commit_file(repo.path(), "unrelated.txt", "x\n");
    assert_eq!(anchor_staleness(repo.path(), HEAD, &sha, "keep.txt").unwrap(), AnchorStaleness::Untouched);
}

#[test]
fn changed_carries_the_commit_count() {
    let (repo, sha) = rich_repo();
    commit_file(repo.path(), "keep.txt", "edited once\n");
    commit_file(repo.path(), "keep.txt", "edited twice\n");
    assert_eq!(
        anchor_staleness(repo.path(), HEAD, &sha, "keep.txt").unwrap(),
        AnchorStaleness::Changed { commits: 2 }
    );
}

#[test]
fn an_unresolvable_sha_is_unknown_never_untouched() {
    let (repo, _tip) = rich_repo();
    git(repo.path(), &["checkout", "-q", "-b", "throwaway"]);
    commit_file(repo.path(), "scratch.txt", "gone soon\n");
    let doomed = git(repo.path(), &["rev-parse", "HEAD"]);
    git(repo.path(), &["checkout", "-q", HEAD]);
    git(repo.path(), &["branch", "-D", "throwaway"]);
    git(repo.path(), &["reflog", "expire", "--expire=now", "--all"]);
    git(repo.path(), &["gc", "-q", "--prune=now"]);
    assert_eq!(anchor_staleness(repo.path(), HEAD, &doomed, "keep.txt").unwrap(), AnchorStaleness::Unknown);
}

#[test]
fn a_path_absent_at_head_is_moved_or_changed() {
    let (repo, sha) = rich_repo();
    assert_eq!(
        anchor_staleness(repo.path(), HEAD, &sha, "never_existed.txt").unwrap(),
        AnchorStaleness::MovedOrChanged
    );
}

#[test]
fn a_rename_since_the_sha_is_moved_or_changed_not_untouched() {
    let (repo, sha) = rich_repo();
    git(repo.path(), &["mv", "new_name.txt", "moved.txt"]);
    git(repo.path(), &["commit", "-q", "-m", "rename"]);
    // No commit touches the OLD path after the rename in a way a path-limited count would see as
    // "still there": the count alone cannot be trusted for this case.
    assert_eq!(
        anchor_staleness(repo.path(), HEAD, &sha, "new_name.txt").unwrap(),
        AnchorStaleness::MovedOrChanged
    );
}

#[test]
fn criteria_state_lists_every_current_criterion_with_a_derived_verdict() {
    let (mut conn, actor, project, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let sha = git(repo.path(), &["rev-parse", b.task_rich]);
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();
    let c1 = create_criterion(&mut conn, &project.id, &actor, "task", &task.id, "One", None).unwrap();
    create_criterion(&mut conn, &project.id, &actor, "task", &task.id, "Two", None).unwrap();
    check_criterion_with_anchor(&mut conn, &actor, &c1.id, Some(input("keep.txt", 3, 3)), &sha).unwrap();

    // No worktree row: criteria still readable, no verdict, no error.
    let none = review_criteria_state(&conn, ReviewScope::Task, &task.id).unwrap();
    assert_eq!(none.len(), 2);
    assert!(none.iter().all(|e| e.staleness.is_none()));
    assert!(none[0].anchor.is_some() && none[1].anchor.is_none());

    conn.execute(
        "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
         VALUES (?1, ?2, ?3, '/nonexistent/worktree', ?4, 'main', 'active', ?5, '2026-01-01T00:00:00.000Z')",
        params![core::ids::new_id(), task.id, project.id, b.task_rich, actor],
    )
    .unwrap();
    let state = review_criteria_state(&conn, ReviewScope::Task, &task.id).unwrap();
    assert_eq!(state[0].staleness, Some(AnchorStaleness::Untouched));
    assert_eq!(state[1].staleness, None, "no anchor, no verdict");

    // The mark stands whatever git says (D-141).
    git(repo.path(), &["checkout", "-q", b.task_rich]);
    commit_file(repo.path(), "keep.txt", "changed after the check\n");
    let state = review_criteria_state(&conn, ReviewScope::Task, &task.id).unwrap();
    assert_eq!(state[0].staleness, Some(AnchorStaleness::Changed { commits: 1 }));
    assert!(state[0].criterion.checked, "staleness never unchecks");
}

// ---- Epic task roll-up (plan 08-09, D-132) ----

/// One epic with two tasks under it.
fn rollup_epic() -> (Connection, String, String, String, String, String) {
    let (mut conn, actor, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor, "E", None).unwrap();
    let a = create_task(&mut conn, &project.id, &actor, "First", Some(&epic.id)).unwrap();
    let b = create_task(&mut conn, &project.id, &actor, "Second", Some(&epic.id)).unwrap();
    (conn, actor, project.id, epic.id, a.id, b.id)
}

#[test]
fn rollup_counts_checked_total_and_evidence_per_task() {
    let (mut conn, actor, project, epic, a, _b) = rollup_epic();
    let c1 = create_criterion(&mut conn, &project, &actor, "task", &a, "One", None).unwrap();
    let c2 = create_criterion(&mut conn, &project, &actor, "task", &a, "Two", None).unwrap();
    create_criterion(&mut conn, &project, &actor, "task", &a, "Three", None).unwrap();
    check_criterion_with_anchor(&mut conn, &actor, &c1.id, Some(input("a.rs", 1, 2)), "sha").unwrap();
    check_criterion_with_anchor(&mut conn, &actor, &c2.id, None, "sha").unwrap();

    let rows = epic_task_rollup(&conn, &epic).unwrap();
    let row = rows.iter().find(|r| r.task_id == a).unwrap();
    assert_eq!((row.total, row.checked, row.with_evidence, row.without_evidence), (3, 2, 1, 1));
    assert_eq!(row.with_evidence + row.without_evidence, row.checked);
}

#[test]
fn rollup_task_with_no_criteria_is_all_zero() {
    let (conn, .., epic, _a, b) = rollup_epic();
    let rows = epic_task_rollup(&conn, &epic).unwrap();
    let row = rows.iter().find(|r| r.task_id == b).unwrap();
    assert_eq!((row.total, row.checked, row.with_evidence, row.without_evidence), (0, 0, 0, 0));
}

#[test]
fn rollup_ignores_superseded_criterion_revisions() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let project = project.id;
        let epic = create_epic(&mut conn, &project, &actor, "E", None).unwrap();
        let task = create_task(&mut conn, &project, &actor, "T", Some(&epic.id)).unwrap();
        let c = create_criterion(&mut conn, &project, &actor, "task", &task.id, "Old wording", None).unwrap();
        check_criterion_with_anchor(&mut conn, &actor, &c.id, Some(input("src/a.rs", 4, 9)), "cafe01").unwrap();
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor).unwrap(); // locks the criteria
        let successor = revise_criterion(&mut conn, &actor, &c.id, "New wording", None).unwrap();
        assert_ne!(successor.id, c.id, "a locked revision is a new row");

        // Two rows exist, both checked, both anchored; only the current one counts.
        let rows = epic_task_rollup(&conn, &epic.id).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!((rows[0].total, rows[0].checked, rows[0].with_evidence, rows[0].without_evidence), (1, 1, 1, 0));
    });
}

#[test]
fn rollup_of_an_epic_with_no_tasks_or_an_unknown_epic_is_empty() {
    let (mut conn, actor, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor, "Empty", None).unwrap();
    assert!(epic_task_rollup(&conn, &epic.id).unwrap().is_empty());
    assert!(epic_task_rollup(&conn, "no-such-epic").unwrap().is_empty());
}

#[test]
fn rollup_rows_of_equal_rank_are_in_task_id_order_on_every_read() {
    let (conn, .., epic, a, b) = rollup_epic();
    conn.execute("UPDATE tasks SET rank = 'same' WHERE epic_id = ?1", params![epic]).unwrap();
    let first = epic_task_rollup(&conn, &epic).unwrap();
    let ids: Vec<String> = first.iter().map(|r| r.task_id.clone()).collect();
    let mut expected = vec![a, b];
    expected.sort();
    assert_eq!(ids, expected);
    assert_eq!(first, epic_task_rollup(&conn, &epic).unwrap());
}

#[test]
fn rollup_does_not_count_another_epics_tasks() {
    let (mut conn, actor, project, epic, a, _b) = rollup_epic();
    let other = create_epic(&mut conn, &project, &actor, "Other", None).unwrap();
    create_task(&mut conn, &project, &actor, "Elsewhere", Some(&other.id)).unwrap();
    let ids: Vec<String> = epic_task_rollup(&conn, &epic).unwrap().into_iter().map(|r| r.task_id).collect();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&a));
}
