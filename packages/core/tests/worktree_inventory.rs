//! WORK-07 (10-08, D-177/D-178): the worktree inventory's single eligibility definition and the
//! two-phase read that applies it. The pure `reclaim_eligibility` table first, then real git
//! repositories for the board-plus-git half.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

use core::domain::epic::create_epic;
use core::domain::event::{append_event, next_sequence};
use core::domain::task::create_task;
use core::domain::worktree::{
    ensure_worktree, reclaim_eligibility, ReclaimDisposition as D, ReclaimReason as R,
};
use core::merge::EVENT_TASK_INTEGRATED;
use core::query::fleet::{finish_worktree_inventory, worktree_inventory_inputs, WorktreeInventoryRow};
use rusqlite::{params, Connection};

// --- the pure table ---------------------------------------------------------------------------

fn elig(task: &str, integrated: bool, live: Option<&str>, dirty: bool, project: &str, present: bool) -> D {
    reclaim_eligibility(task, integrated, live, dirty, project, present)
}

#[test]
fn a_done_task_with_no_run_and_a_clean_tree_is_reclaimable_as_task_done() {
    assert_eq!(elig("done", false, None, false, "active", true), D::Reclaimable(R::TaskDone));
}

#[test]
fn an_integrated_branch_with_no_run_and_a_clean_tree_is_reclaimable_as_merged() {
    assert_eq!(elig("in_review", true, None, false, "active", true), D::Reclaimable(R::Merged));
}

#[test]
fn both_reasons_apply_shows_task_done_every_time() {
    for _ in 0..3 {
        assert_eq!(elig("done", true, None, false, "active", true), D::Reclaimable(R::TaskDone));
    }
}

#[test]
fn a_live_run_is_in_use_even_when_the_task_is_done() {
    assert_eq!(elig("done", true, Some("running"), false, "active", true), D::InUse(R::AgentRunning));
    assert_eq!(elig("done", true, Some("blocked"), false, "active", true), D::InUse(R::Blocked));
}

#[test]
fn a_dirty_tree_is_kept_even_when_the_task_is_done() {
    assert_eq!(elig("done", true, None, true, "active", true), D::Keep(R::UncommittedChanges));
}

#[test]
fn an_unreachable_project_is_kept_and_outranks_every_other_fact() {
    assert_eq!(elig("done", true, None, false, "unreachable", true), D::Keep(R::ProjectUnreachable));
    assert_eq!(elig("done", true, Some("running"), true, "unreachable", false), D::Keep(R::ProjectUnreachable));
}

#[test]
fn a_missing_directory_has_its_own_disposition() {
    assert_eq!(elig("done", true, None, false, "active", false), D::Keep(R::DirectoryMissing));
}

#[test]
fn a_task_with_no_epic_can_only_be_reclaimable_by_being_done() {
    // No integration branch means the caller passes integrated = false.
    assert_eq!(elig("in_review", false, None, false, "active", true), D::Keep(R::TaskOpen));
    assert_eq!(elig("done", false, None, false, "active", true), D::Reclaimable(R::TaskDone));
}

// --- the read, against real git ---------------------------------------------------------------

static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().expect("scratch worktree root");
    // SAFETY: serialised by the mutex above; cleared before return.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f(dir.path());
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

fn git(repo: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(repo).args(args).output().expect("spawn git");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn set_task_status(conn: &Connection, task_id: &str, status: &str) {
    conn.execute("UPDATE tasks SET status = ?1 WHERE id = ?2", params![status, task_id]).unwrap();
}

fn rows(conn: &Connection) -> Vec<WorktreeInventoryRow> {
    finish_worktree_inventory(worktree_inventory_inputs(conn, 200).expect("inputs"))
}

fn row_for<'a>(rows: &'a [WorktreeInventoryRow], task_id: &str) -> &'a WorktreeInventoryRow {
    rows.iter().find(|r| r.task_id == task_id).unwrap_or_else(|| panic!("no row for {task_id}"))
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
fn dispositions_across_done_integrated_dirty_live_and_unreachable() {
    with_scratch_worktree_root(|root| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let mk = |conn: &mut Connection, name: &str, epic: Option<&str>| {
            let task = create_task(conn, &project.id, &actor, name, epic).unwrap();
            let wt = ensure_worktree(conn, &task.id, &actor).unwrap();
            (task.id, PathBuf::from(wt.path))
        };

        let (done, _) = mk(&mut conn, "done", None);
        set_task_status(&conn, &done, "done");

        let (dirty, dirty_path) = mk(&mut conn, "dirty", None);
        set_task_status(&conn, &dirty, "done");
        std::fs::write(dirty_path.join("README.md"), "edited\n").unwrap();

        let (open, _) = mk(&mut conn, "open", None);

        let (live, _) = mk(&mut conn, "live", None);
        let run = core::domain::agent_run::start_agent_run(&mut conn, &live, "default", &actor).unwrap();
        set_task_status(&conn, &live, "done");

        let (blocked, _) = mk(&mut conn, "blocked", None);
        let blocked_run = core::domain::agent_run::start_agent_run(&mut conn, &blocked, "default", &actor).unwrap();
        conn.execute("UPDATE agent_runs SET status = 'blocked' WHERE id = ?1", params![blocked_run.id]).unwrap();
        let _ = run;

        // An epic task whose branch is integrated into the epic's integration branch.
        let epic = create_epic(&mut conn, &project.id, &actor, "Epic", None).unwrap();
        let (merged, merged_path) = mk(&mut conn, "merged", Some(&epic.id));
        std::fs::write(merged_path.join("m.txt"), "m\n").unwrap();
        git(&merged_path, &["add", "m.txt"]);
        git(&merged_path, &["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-m", "m"]);
        let tip = git(&merged_path, &["rev-parse", "HEAD"]);
        let integration: String = conn
            .query_row("SELECT integration_branch FROM epics WHERE id = ?1", params![epic.id], |r| r.get(0))
            .unwrap();
        git(repo.path(), &["update-ref", &format!("refs/heads/{integration}"), &tip]);
        let tx = conn.transaction().unwrap();
        let seq = next_sequence(&tx, &project.id, "local").unwrap();
        append_event(
            &tx, &project.id, "local", seq, "task", &merged, Some(&merged), Some(&epic.id), &actor,
            EVENT_TASK_INTEGRATED, &serde_json::json!({ "merge_commit": tip }), "2026-10-01T00:00:00Z",
        )
        .unwrap();
        tx.commit().unwrap();

        let all = rows(&conn);
        assert_eq!(row_for(&all, &done).disposition, D::Reclaimable(R::TaskDone));
        assert_eq!(row_for(&all, &dirty).disposition, D::Keep(R::UncommittedChanges));
        assert_eq!(row_for(&all, &open).disposition, D::Keep(R::TaskOpen));
        assert_eq!(row_for(&all, &merged).disposition, D::Reclaimable(R::Merged));
        assert_eq!(row_for(&all, &live).disposition, D::InUse(R::AgentRunning));
        assert_eq!(row_for(&all, &blocked).disposition, D::InUse(R::Blocked));

        // The project becomes unreachable: every one of its rows is kept with that reason.
        conn.execute("UPDATE projects SET status = 'unreachable' WHERE id = ?1", params![project.id]).unwrap();
        for r in rows(&conn) {
            assert_eq!(r.disposition, D::Keep(R::ProjectUnreachable), "{}", r.task_key);
        }
        let _ = root;
    });
}

#[test]
fn a_row_whose_directory_is_gone_is_reported_not_fatal() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor, "gone", None).unwrap();
        let wt = ensure_worktree(&mut conn, &task.id, &actor).unwrap();
        set_task_status(&conn, &task.id, "done");
        let ok = create_task(&mut conn, &project.id, &actor, "fine", None).unwrap();
        ensure_worktree(&mut conn, &ok.id, &actor).unwrap();
        std::fs::remove_dir_all(&wt.path).unwrap();

        let all = rows(&conn);
        assert_eq!(all.len(), 2);
        assert_eq!(row_for(&all, &task.id).disposition, D::Keep(R::DirectoryMissing));
        assert_eq!(row_for(&all, &ok.id).disposition, D::Keep(R::TaskOpen));
    });
}

#[test]
fn the_porcelain_read_runs_only_for_rows_that_passed_the_board_test_and_never_for_unreachable_projects() {
    with_scratch_worktree_root(|root| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let marker = root.join("status-runs.log");
        count_status_runs(repo.path(), &marker);

        for (name, status) in [("a", "done"), ("b", "done"), ("c", "in_progress"), ("d", "todo")] {
            let task = create_task(&mut conn, &project.id, &actor, name, None).unwrap();
            ensure_worktree(&mut conn, &task.id, &actor).unwrap();
            set_task_status(&conn, &task.id, status);
        }
        let _ = std::fs::remove_file(&marker);
        let all = rows(&conn);
        assert_eq!(all.len(), 4);
        assert_eq!(status_runs(&marker), 2, "only the two Done rows may cost a porcelain read");

        conn.execute("UPDATE projects SET status = 'unreachable' WHERE id = ?1", params![project.id]).unwrap();
        let _ = std::fs::remove_file(&marker);
        rows(&conn);
        assert_eq!(status_runs(&marker), 0, "an unreachable project must reach no git call");
    });
}

#[test]
fn equal_sizes_order_by_task_key_and_unmeasured_sorts_last() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let mut ids = Vec::new();
        for name in ["one", "two", "three"] {
            let task = create_task(&mut conn, &project.id, &actor, name, None).unwrap();
            ensure_worktree(&mut conn, &task.id, &actor).unwrap();
            ids.push(task.id);
        }
        // ids[0] and ids[1] tie at 100 bytes; ids[2] was never measured.
        for id in &ids[..2] {
            conn.execute("UPDATE worktrees SET size_bytes = 100, size_measured_at = 'x' WHERE task_id = ?1", params![id])
                .unwrap();
        }
        let keys: Vec<String> = rows(&conn).into_iter().map(|r| r.task_key).collect();
        let mut tied = keys[..2].to_vec();
        tied.sort();
        assert_eq!(keys[..2].to_vec(), tied, "ties must order by task key ascending");
        let last = rows(&conn).pop().unwrap();
        assert_eq!(last.task_id, ids[2]);
        assert_eq!(last.size_bytes, None, "an unmeasured size stays absent");
    });
}

#[test]
fn an_epic_integration_directory_on_disk_is_not_listed() {
    with_scratch_worktree_root(|root| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor, "Epic", None).unwrap();
        let _ = epic;
        std::fs::create_dir_all(root.join("FLY").join("epic-integration")).unwrap();
        assert!(rows(&conn).is_empty(), "epic integration worktrees have no row, so none are listed");
    });
}
