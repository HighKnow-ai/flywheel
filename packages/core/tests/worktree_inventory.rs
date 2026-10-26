//! WORK-07 (10-08, D-177/D-178): the worktree inventory's single eligibility definition and the
//! two-phase read that applies it. The pure `reclaim_eligibility` table first, then real git
//! repositories for the board-plus-git half.

mod common;

use common::with_scratch_worktree_root;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use flywheel_core::domain::worktree::{
    ensure_worktree, reclaim_eligibility, ReclaimDisposition as D, ReclaimReason as R,
};
use flywheel_core::query::fleet::{finish_worktree_inventory, worktree_inventory_inputs, WorktreeInventoryRow};
use rusqlite::{params, Connection};

// --- the pure table ---------------------------------------------------------------------------

fn elig(story: &str, live: Option<&str>, dirty: bool, project: &str, present: bool) -> D {
    reclaim_eligibility(story, live, dirty, project, present)
}

#[test]
fn a_merged_story_with_no_run_and_a_clean_tree_is_reclaimable_as_merged() {
    assert_eq!(elig("merged", None, false, "active", true), D::Reclaimable(R::Merged));
}

#[test]
fn a_dropped_story_with_no_run_and_a_clean_tree_is_reclaimable_as_dropped() {
    assert_eq!(elig("dropped", None, false, "active", true), D::Reclaimable(R::Dropped));
}

#[test]
fn a_live_run_is_in_use_even_when_the_story_is_merged() {
    assert_eq!(elig("merged", Some("running"), false, "active", true), D::InUse(R::Sessionning));
    assert_eq!(elig("merged", Some("blocked"), false, "active", true), D::InUse(R::Blocked));
}

#[test]
fn a_dirty_tree_is_kept_even_when_the_story_is_merged() {
    assert_eq!(elig("merged", None, true, "active", true), D::Keep(R::UncommittedChanges));
}

#[test]
fn an_unreachable_project_is_kept_and_outranks_every_other_fact() {
    assert_eq!(elig("merged", None, false, "unreachable", true), D::Keep(R::ProjectUnreachable));
    assert_eq!(elig("merged", Some("running"), true, "unreachable", false), D::Keep(R::ProjectUnreachable));
}

#[test]
fn a_missing_directory_has_its_own_disposition() {
    assert_eq!(elig("merged", None, false, "active", false), D::Keep(R::DirectoryMissing));
}

#[test]
fn a_story_can_only_be_reclaimable_by_being_closed() {
    for open in ["shaping", "ready", "running", "in_review"] {
        assert_eq!(elig(open, None, false, "active", true), D::Keep(R::StoryOpen), "{open}");
    }
}

// --- the read, against real git ---------------------------------------------------------------

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output().expect("spawn git");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn set_story_state(conn: &Connection, story_id: &str, state: &str) {
    conn.execute("UPDATE stories SET state = ?1 WHERE id = ?2", params![state, story_id]).unwrap();
}

fn rows(conn: &Connection) -> Vec<WorktreeInventoryRow> {
    finish_worktree_inventory(worktree_inventory_inputs(conn, 200).expect("inputs"))
}

fn row_for<'a>(rows: &'a [WorktreeInventoryRow], story_id: &str) -> &'a WorktreeInventoryRow {
    rows.iter().find(|r| r.story_id == story_id).unwrap_or_else(|| panic!("no row for {story_id}"))
}

/// Make `git status` leave a line in `marker` every time it runs, so a test can count the porcelain
/// reads the inventory actually performed. `core.fsmonitor` is consulted by status in every
/// worktree of the repository.
fn count_status_runs(repo: &Path, marker: &Path) {
    let script = repo.join("../fsmonitor-count.sh");
    std::fs::write(&script, format!("#!/bin/sh\necho x >> '{}'\nexit 0\n", marker.display())).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    git(repo, &["config", "core.fsmonitor", script.to_str().unwrap()]);
}

fn status_runs(marker: &Path) -> usize {
    std::fs::read_to_string(marker).map(|s| s.lines().count()).unwrap_or(0)
}

#[test]
fn dispositions_across_merged_dropped_dirty_live_and_unreachable() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let mk = |conn: &mut Connection, name: &str| {
            let story = common::new_story(conn, &project.id, &actor, name);
            let wt = ensure_worktree(conn, &story.id, &actor).unwrap();
            (story.id, PathBuf::from(wt.path))
        };

        let (merged, _) = mk(&mut conn, "merged");
        set_story_state(&conn, &merged, "merged");

        let (dropped, _) = mk(&mut conn, "dropped");
        set_story_state(&conn, &dropped, "dropped");

        let (dirty, dirty_path) = mk(&mut conn, "dirty");
        set_story_state(&conn, &dirty, "merged");
        std::fs::write(dirty_path.join("README.md"), "edited\n").unwrap();

        let (open, _) = mk(&mut conn, "open");

        let (live, _) = mk(&mut conn, "live");
        flywheel_core::domain::session::start_session(&mut conn, &live, "default", &actor).unwrap();
        set_story_state(&conn, &live, "merged");

        let (blocked, _) = mk(&mut conn, "blocked");
        let blocked_run = flywheel_core::domain::session::start_session(&mut conn, &blocked, "default", &actor).unwrap();
        conn.execute("UPDATE sessions SET status = 'blocked' WHERE id = ?1", params![blocked_run.id]).unwrap();

        let all = rows(&conn);
        assert_eq!(row_for(&all, &merged).disposition, D::Reclaimable(R::Merged));
        assert_eq!(row_for(&all, &dropped).disposition, D::Reclaimable(R::Dropped));
        assert_eq!(row_for(&all, &dirty).disposition, D::Keep(R::UncommittedChanges));
        assert_eq!(row_for(&all, &open).disposition, D::Keep(R::StoryOpen));
        assert_eq!(row_for(&all, &live).disposition, D::InUse(R::Sessionning));
        assert_eq!(row_for(&all, &blocked).disposition, D::InUse(R::Blocked));

        // The project becomes unreachable: every one of its rows is kept with that reason.
        conn.execute("UPDATE projects SET status = 'unreachable' WHERE id = ?1", params![project.id]).unwrap();
        for r in rows(&conn) {
            assert_eq!(r.disposition, D::Keep(R::ProjectUnreachable), "{}", r.story_key);
        }
    });
}

#[test]
fn a_row_whose_directory_is_gone_is_reported_not_fatal() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor, "gone");
        let wt = ensure_worktree(&mut conn, &story.id, &actor).unwrap();
        set_story_state(&conn, &story.id, "merged");
        let ok = common::new_story(&mut conn, &project.id, &actor, "fine");
        ensure_worktree(&mut conn, &ok.id, &actor).unwrap();
        std::fs::remove_dir_all(&wt.path).unwrap();

        let all = rows(&conn);
        assert_eq!(all.len(), 2);
        assert_eq!(row_for(&all, &story.id).disposition, D::Keep(R::DirectoryMissing));
        assert_eq!(row_for(&all, &ok.id).disposition, D::Keep(R::StoryOpen));
    });
}

#[test]
fn the_porcelain_read_runs_only_for_rows_that_passed_the_board_test_and_never_for_unreachable_projects() {
    with_scratch_worktree_root(|root| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let marker = root.join("status-runs.log");
        count_status_runs(repo.path(), &marker);

        for (name, state) in [("a", "merged"), ("b", "dropped"), ("c", "running"), ("d", "ready")] {
            let story = common::new_story(&mut conn, &project.id, &actor, name);
            ensure_worktree(&mut conn, &story.id, &actor).unwrap();
            set_story_state(&conn, &story.id, state);
        }
        let _ = std::fs::remove_file(&marker);
        let all = rows(&conn);
        assert_eq!(all.len(), 4);
        assert_eq!(status_runs(&marker), 2, "only the two closed rows may cost a porcelain read");

        conn.execute("UPDATE projects SET status = 'unreachable' WHERE id = ?1", params![project.id]).unwrap();
        let _ = std::fs::remove_file(&marker);
        rows(&conn);
        assert_eq!(status_runs(&marker), 0, "an unreachable project must reach no git call");
    });
}

#[test]
fn equal_sizes_order_by_story_key_and_unmeasured_sorts_last() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let mut ids = Vec::new();
        for name in ["one", "two", "three"] {
            let story = common::new_story(&mut conn, &project.id, &actor, name);
            ensure_worktree(&mut conn, &story.id, &actor).unwrap();
            ids.push(story.id);
        }
        // ids[0] and ids[1] tie at 100 bytes; ids[2] was never measured.
        for id in &ids[..2] {
            conn.execute("UPDATE worktrees SET size_bytes = 100, size_measured_at = 'x' WHERE story_id = ?1", params![id])
                .unwrap();
        }
        let keys: Vec<String> = rows(&conn).into_iter().map(|r| r.story_key).collect();
        let mut tied = keys[..2].to_vec();
        tied.sort();
        assert_eq!(keys[..2].to_vec(), tied, "ties must order by Story key ascending");
        let last = rows(&conn).pop().unwrap();
        assert_eq!(last.story_id, ids[2]);
        assert_eq!(last.size_bytes, None, "an unmeasured size stays absent");
    });
}
