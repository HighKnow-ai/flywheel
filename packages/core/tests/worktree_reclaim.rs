//! WORK-07 (10-09, D-179): the batch reclaim. A stale selection is refused, a refusal never aborts
//! the batch, and removal always goes through the unchanged guarded verb.

mod common;

use common::with_scratch_worktree_root;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use flywheel_core::domain::worktree::{
    ensure_worktree, reclaim_worktrees, worktree_for_story, ReclaimOutcome, ReclaimReason as R,
};
use flywheel_core::query::fleet::{finish_worktree_inventory, worktree_inventory_inputs};
use rusqlite::{params, Connection};

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A merged Story with a worktree: reclaimable.
fn merged_worktree(
    conn: &mut Connection,
    project: &str,
    actor: &str,
    name: &str,
) -> (String, PathBuf) {
    let story = common::new_story(conn, project, actor, name);
    let wt = ensure_worktree(conn, &story.id, actor).unwrap();
    conn.execute(
        "UPDATE stories SET state = 'merged' WHERE id = ?1",
        params![story.id],
    )
    .unwrap();
    (story.id, PathBuf::from(wt.path))
}

fn outcome<'a>(all: &'a [ReclaimOutcome], id: &str) -> &'a ReclaimOutcome {
    all.iter()
        .find(|o| o.story_id == id)
        .unwrap_or_else(|| panic!("no outcome for {id}"))
}

#[test]
fn three_clean_reclaimable_worktrees_are_all_removed() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let rows: Vec<_> = ["a", "b", "c"]
            .iter()
            .map(|n| merged_worktree(&mut conn, &project.id, &actor, n))
            .collect();
        let selection: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();

        let out = reclaim_worktrees(&mut conn, &selection, &actor);

        assert_eq!(out.len(), 3);
        for (id, path) in &rows {
            let o = outcome(&out, id);
            assert!(o.removed, "{o:?}");
            assert_eq!(o.reason, Some(R::Merged));
            assert!(worktree_for_story(&conn, id).unwrap().is_none());
            assert!(!path.exists());
        }
    });
}

/// Pitfall 2 / T-10-09-01: the list said reclaimable, then an agent started in one of the rows.
#[test]
fn a_run_inserted_after_the_read_refuses_that_row_and_removes_the_others() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, a_path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let (b, b_path) = merged_worktree(&mut conn, &project.id, &actor, "b");
        let (c, c_path) = merged_worktree(&mut conn, &project.id, &actor, "c");

        // The read the user selected from: all three reclaimable.
        let listed = finish_worktree_inventory(worktree_inventory_inputs(&conn, 200).unwrap());
        assert!(listed
            .iter()
            .all(|r| r.disposition.as_str() == "reclaimable"));

        flywheel_core::domain::session::start_session(&mut conn, &b, "default", &actor).unwrap();

        let out = reclaim_worktrees(&mut conn, &[a.clone(), b.clone(), c.clone()], &actor);

        assert!(outcome(&out, &a).removed);
        assert!(outcome(&out, &c).removed);
        let refused = outcome(&out, &b);
        assert!(!refused.removed);
        assert_eq!(refused.reason, Some(R::Sessionning));
        assert!(b_path.exists(), "the live worktree must be untouched");
        assert!(worktree_for_story(&conn, &b).unwrap().is_some());
        assert!(!a_path.exists() && !c_path.exists());
    });
}

/// WR-04: the eligibility read can be stale by the time the removal runs. A run that appears between
/// the two must stop the removal itself, not only the earlier read. Calls the removal verb directly,
/// which is exactly the position a stale selection reaches.
#[test]
fn the_reclaim_removal_refuses_a_worktree_a_run_started_in_after_the_eligibility_read() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        flywheel_core::domain::session::start_session(&mut conn, &a, "default", &actor).unwrap();

        let err = flywheel_core::domain::worktree::remove_worktree_for_story_refusing_live_run(
            &mut conn, &a, &actor,
        )
        .expect_err("a live run must stop the removal");

        assert!(format!("{err:#}").contains("agent run is live"), "{err:#}");
        assert!(path.exists(), "the live worktree must be untouched");
        assert!(worktree_for_story(&conn, &a).unwrap().is_some());
    });
}

#[test]
fn a_blocked_run_is_refused_with_the_blocked_reason() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let run = flywheel_core::domain::session::start_session(&mut conn, &a, "default", &actor)
            .unwrap();
        conn.execute(
            "UPDATE sessions SET status = 'blocked' WHERE id = ?1",
            params![run.id],
        )
        .unwrap();
        let out = reclaim_worktrees(&mut conn, std::slice::from_ref(&a), &actor);
        assert_eq!(outcome(&out, &a).reason, Some(R::Blocked));
        assert!(path.exists());
    });
}

#[test]
fn a_tree_that_became_dirty_after_the_read_is_refused_and_keeps_its_file() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, a_path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let (b, _) = merged_worktree(&mut conn, &project.id, &actor, "b");
        std::fs::write(a_path.join("README.md"), "edited after the list was read\n").unwrap();

        let out = reclaim_worktrees(&mut conn, &[a.clone(), b.clone()], &actor);

        let refused = outcome(&out, &a);
        assert!(!refused.removed);
        assert_eq!(refused.reason, Some(R::UncommittedChanges));
        assert_eq!(
            std::fs::read_to_string(a_path.join("README.md")).unwrap(),
            "edited after the list was read\n"
        );
        assert!(outcome(&out, &b).removed);
    });
}

#[test]
fn an_open_story_is_refused_before_any_git_call() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let open = common::new_story(&mut conn, &project.id, &actor, "open");
        ensure_worktree(&mut conn, &open.id, &actor).unwrap();

        // Count every `git status` the repository runs from here on.
        let scratch = tempfile::tempdir().unwrap();
        let marker = scratch.path().join("status-runs.txt");
        let script = scratch.path().join("fsmonitor-count.sh");
        std::fs::write(
            &script,
            format!("#!/bin/sh\necho x >> '{}'\nexit 0\n", marker.display()),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        git(
            repo.path(),
            &["config", "core.fsmonitor", script.to_str().unwrap()],
        );

        let out = reclaim_worktrees(&mut conn, std::slice::from_ref(&open.id), &actor);

        assert_eq!(outcome(&out, &open.id).reason, Some(R::StoryOpen));
        assert!(!outcome(&out, &open.id).removed);
        assert!(
            !marker.exists(),
            "no porcelain read for a row that failed the board test"
        );
        assert!(worktree_for_story(&conn, &open.id).unwrap().is_some());
    });
}

#[test]
fn a_row_in_an_unreachable_project_is_refused_without_a_git_call() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        conn.execute(
            "UPDATE projects SET status = 'unreachable' WHERE id = ?1",
            params![project.id],
        )
        .unwrap();
        let out = reclaim_worktrees(&mut conn, std::slice::from_ref(&a), &actor);
        assert_eq!(outcome(&out, &a).reason, Some(R::ProjectUnreachable));
        assert!(path.exists());
    });
}

#[test]
fn an_unknown_id_fails_alone_and_the_valid_ids_are_still_removed() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, _) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let (b, _) = merged_worktree(&mut conn, &project.id, &actor, "b");

        let out = reclaim_worktrees(
            &mut conn,
            &[a.clone(), "no-such-story".to_string(), b.clone()],
            &actor,
        );

        assert_eq!(out.len(), 3);
        let unknown = outcome(&out, "no-such-story");
        assert!(!unknown.removed);
        assert!(unknown
            .error
            .as_deref()
            .unwrap_or("")
            .contains("no worktree"));
        assert!(outcome(&out, &a).removed && outcome(&out, &b).removed);
    });
}

#[test]
fn a_duplicate_id_is_handled_once() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, _) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let out = reclaim_worktrees(&mut conn, &[a.clone(), a.clone(), a.clone()], &actor);
        assert_eq!(out.len(), 1);
        assert!(out[0].removed);
        assert!(
            out[0].error.is_none(),
            "a second pass would have reported 'no worktree exists'"
        );
    });
}

#[test]
fn an_empty_selection_returns_an_empty_result() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, _project, _repo) = common::seeded_git_project();
        assert!(reclaim_worktrees(&mut conn, &[], &actor).is_empty());
    });
}

/// A removal that fails after eligibility passed -- here git refuses a locked worktree -- is
/// reported as `removed: false` with git's error text and leaves the row in place. A removal killed
/// at the subprocess ceiling returns the same `Err` from `remove_worktree_for_story` (proc.rs has no
/// seam to inject a shorter ceiling), so it reaches this same branch; the timeout message itself is
/// pinned by tests/proc_timeout_boundary.rs.
#[test]
fn a_removal_that_fails_is_reported_as_refused_with_its_error_and_the_batch_continues() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let (a, a_path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let (b, _) = merged_worktree(&mut conn, &project.id, &actor, "b");
        git(repo.path(), &["worktree", "lock", a_path.to_str().unwrap()]);

        let out = reclaim_worktrees(&mut conn, &[a.clone(), b.clone()], &actor);

        let failed = outcome(&out, &a);
        assert!(!failed.removed, "{failed:?}");
        assert!(failed.reason.is_none());
        assert!(failed
            .error
            .as_deref()
            .map(|e| !e.is_empty())
            .unwrap_or(false));
        // WR-05: a failed removal says what is on disk, so it is not read as a clean refusal.
        assert!(
            failed
                .error
                .as_deref()
                .unwrap()
                .contains("directory still exists"),
            "the error must name the on-disk state: {failed:?}"
        );
        assert!(
            worktree_for_story(&conn, &a).unwrap().is_some(),
            "the row must survive a failed removal"
        );
        assert!(outcome(&out, &b).removed);
    });
}

/// The command runs the batch on a connection of its own (opened and pragma'd the way it does), so the
/// application's shared connection is free throughout. What that connection wrote is visible on the first.
#[test]
fn a_batch_run_on_a_second_connection_is_visible_on_the_first() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let (a, path) = merged_worktree(&mut conn, &project.id, &actor, "a");
        let db_path = conn
            .path()
            .map(PathBuf::from)
            .expect("file-backed database");

        let mut second = Connection::open(&db_path).unwrap();
        flywheel_core::db::apply_pragmas(&second).unwrap();
        let out = reclaim_worktrees(&mut second, std::slice::from_ref(&a), &actor);

        assert!(out[0].removed, "{out:?}");
        assert!(!path.exists());
        assert!(worktree_for_story(&conn, &a).unwrap().is_none());
        let events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'worktree.removed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(events, 1);
    });
}
