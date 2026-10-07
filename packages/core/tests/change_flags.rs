//! `query::change_flags` coverage (phase 08.1 plan 01, D-15/D-16): the board's one-sweep "which
//! task has real changes behind it" read, proven against real `git init`-ed scratch repositories
//! with NO remote configured at all — the integration branch is local-only, exactly as in the
//! field (RESEARCH Correction 4), so a remote-tracking base would never resolve here.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use core::domain::actor::local_human_actor_id;
use core::domain::epic::create_epic;
use core::domain::project::create_project;
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::change_flags::{change_flag_inputs, finish_change_flags, ChangeFlag};
use rusqlite::{params, Connection};

fn run_git_ok(repo: &Path, args: &[&str]) -> Output {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git -C {repo:?} {args:?}: {e}"));
    assert!(
        output.status.success(),
        "git -C {repo:?} {args:?} failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn init_repo(root: &Path, name: &str) -> PathBuf {
    let repo = root.join(name);
    std::fs::create_dir_all(&repo).expect("failed to create repo dir");
    run_git_ok(&repo, &["init", "--initial-branch", "main"]);
    run_git_ok(&repo, &["config", "user.email", "change-flags-test@flywheel.invalid"]);
    run_git_ok(&repo, &["config", "user.name", "Flywheel Change Flags Test"]);
    std::fs::write(repo.join("README.md"), "change_flags scratch repo\n").expect("write README");
    run_git_ok(&repo, &["add", "README.md"]);
    run_git_ok(&repo, &["commit", "-m", "initial commit"]);
    repo
}

fn commit_file(repo: &Path, filename: &str, contents: &str, message: &str) {
    std::fs::write(repo.join(filename), contents).expect("failed to write file");
    run_git_ok(repo, &["add", filename]);
    run_git_ok(repo, &["commit", "-m", message]);
}

struct Fixture {
    _root: tempfile::TempDir,
    conn: Connection,
    actor_id: String,
    project_id: String,
    main_repo: PathBuf,
    root_path: PathBuf,
}

fn setup() -> Fixture {
    let root = tempfile::tempdir().expect("failed to create scratch root");
    let main_repo = init_repo(root.path(), "main_repo");

    let db_dir = tempfile::tempdir().expect("failed to create scratch db dir");
    let db_path = db_dir.path().join("flywheel.db");
    let backups_dir = db_dir.path().join("backups");
    std::mem::forget(db_dir);

    let mut conn = core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let project = create_project(
        &mut conn,
        &actor_id,
        "Fixture Project",
        &main_repo.to_string_lossy(),
        "FLY",
        "main",
    )
    .expect("create_project should succeed");

    let root_path = root.path().to_path_buf();
    Fixture { _root: root, conn, actor_id, project_id: project.id, main_repo, root_path }
}

impl Fixture {
    /// An epic whose `integration_branch` column is `integration` (the branch is cut locally from
    /// `main` only when `cut` is true, so a recorded-but-absent branch can be exercised too).
    fn epic(&mut self, integration: Option<&str>, cut: bool) -> String {
        let epic = create_epic(&mut self.conn, &self.project_id, &self.actor_id, "An Epic", None)
            .expect("create_epic should succeed");
        if let Some(name) = integration {
            self.conn
                .execute(
                    "UPDATE epics SET integration_branch = ?1 WHERE id = ?2",
                    params![name, epic.id],
                )
                .expect("failed to set integration_branch");
            if cut {
                run_git_ok(&self.main_repo, &["branch", name, "main"]);
            }
        }
        epic.id
    }

    /// A task with a real `git worktree` on a fresh branch cut from `from`, plus its row.
    fn task_with_worktree(&mut self, epic_id: Option<&str>, name: &str, from: &str, status: &str) -> (String, PathBuf) {
        let task = create_task(&mut self.conn, &self.project_id, &self.actor_id, name, epic_id)
            .expect("create_task should succeed");
        let path = self.root_path.join(format!("wt_{name}"));
        let branch = format!("flywheel/{name}");
        run_git_ok(
            &self.main_repo,
            &["worktree", "add", path.to_str().unwrap(), "-b", &branch, from],
        );
        self.conn
            .execute(
                "INSERT INTO worktrees (
                    id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    new_id(),
                    task.id,
                    self.project_id,
                    path.to_string_lossy().into_owned(),
                    branch,
                    from,
                    status,
                    self.actor_id,
                    "2026-01-01T00:00:00.000Z",
                ],
            )
            .expect("failed to insert worktree row");
        (task.id, path)
    }

    fn flags(&self) -> Vec<ChangeFlag> {
        let inputs = change_flag_inputs(&self.conn, &self.project_id, 200).expect("inputs");
        finish_change_flags(inputs).expect("finish")
    }
}

fn flag_for<'a>(flags: &'a [ChangeFlag], task_id: &str) -> &'a ChangeFlag {
    flags.iter().find(|f| f.task_id == task_id).unwrap_or_else(|| panic!("no flag for {task_id}"))
}

#[test]
fn commits_beyond_the_epics_local_integration_branch_are_counted() {
    let mut f = setup();
    let epic = f.epic(Some("flywheel/epic-fly-1"), true);
    let (task, wt) = f.task_with_worktree(Some(&epic), "ahead", "flywheel/epic-fly-1", "active");
    commit_file(&wt, "a.txt", "a\n", "add a");
    commit_file(&wt, "b.txt", "b\n", "add b");

    let flags = f.flags();
    let flag = flag_for(&flags, &task);
    assert_eq!(flag.ahead, Some(2));
    assert!(!flag.dirty);
}

#[test]
fn a_branch_level_with_its_base_is_zero_not_cannot_measure() {
    let mut f = setup();
    let epic = f.epic(Some("flywheel/epic-fly-1"), true);
    let (task, _wt) = f.task_with_worktree(Some(&epic), "level", "flywheel/epic-fly-1", "active");

    let flags = f.flags();
    assert_eq!(flag_for(&flags, &task).ahead, Some(0), "level is a measured zero, not absent");
}

#[test]
fn an_unresolvable_base_branch_reports_cannot_measure() {
    let mut f = setup();
    // The epic RECORDS an integration branch that was never cut in this repository.
    let epic = f.epic(Some("flywheel/epic-gone"), false);
    let (task, wt) = f.task_with_worktree(Some(&epic), "orphan", "main", "active");
    commit_file(&wt, "a.txt", "a\n", "add a");

    let flags = f.flags();
    assert_eq!(flag_for(&flags, &task).ahead, None, "an unmeasurable base must not collapse to zero");
}

#[test]
fn a_modified_tracked_file_is_dirty_and_a_clean_tree_is_not() {
    let mut f = setup();
    let (dirty_task, dirty_wt) = f.task_with_worktree(None, "dirty", "main", "active");
    let (clean_task, _clean_wt) = f.task_with_worktree(None, "clean", "main", "active");
    std::fs::write(dirty_wt.join("README.md"), "changed\n").expect("modify tracked file");

    let flags = f.flags();
    assert!(flag_for(&flags, &dirty_task).dirty);
    assert!(!flag_for(&flags, &clean_task).dirty);
}

#[test]
fn an_epic_without_an_integration_branch_falls_back_to_the_default_branch() {
    let mut f = setup();
    let epic = f.epic(None, false);
    let (task, wt) = f.task_with_worktree(Some(&epic), "fallback", "main", "active");
    commit_file(&wt, "a.txt", "a\n", "add a");

    let flags = f.flags();
    assert_eq!(flag_for(&flags, &task).ahead, Some(1));
}

#[test]
fn only_active_worktrees_are_returned_and_a_task_with_no_worktree_is_absent() {
    let mut f = setup();
    let (active, _a) = f.task_with_worktree(None, "active", "main", "active");
    let (stale, _s) = f.task_with_worktree(None, "stale", "main", "stale");
    let bare = create_task(&mut f.conn, &f.project_id, &f.actor_id, "no worktree", None)
        .expect("create_task should succeed");

    let flags = f.flags();
    let ids: Vec<&str> = flags.iter().map(|x| x.task_id.as_str()).collect();
    assert_eq!(ids, vec![active.as_str()]);
    assert!(!ids.contains(&stale.as_str()));
    assert!(!ids.contains(&bare.id.as_str()));
}

#[test]
fn the_board_half_resolves_base_and_branch_from_the_connection_alone() {
    let mut f = setup();
    let epic = f.epic(Some("flywheel/epic-fly-1"), true);
    let (task, wt) = f.task_with_worktree(Some(&epic), "inputs", "flywheel/epic-fly-1", "active");

    let inputs = change_flag_inputs(&f.conn, &f.project_id, 200).expect("inputs");
    assert_eq!(inputs.len(), 1);
    assert_eq!(inputs[0].task_id, task);
    assert_eq!(inputs[0].path, wt.to_string_lossy());
    assert_eq!(inputs[0].branch, "flywheel/inputs");
    assert_eq!(inputs[0].base.as_deref(), Some("flywheel/epic-fly-1"));
}

#[test]
fn the_limit_caps_the_sweep() {
    let mut f = setup();
    f.task_with_worktree(None, "one", "main", "active");
    f.task_with_worktree(None, "two", "main", "active");

    let inputs = change_flag_inputs(&f.conn, &f.project_id, 1).expect("inputs");
    assert_eq!(inputs.len(), 1);
}
