//! Shared fixtures: a migrated scratch database with one registered project (optionally backed by
//! a real repository), and a Story to hang sessions, worktrees and criteria off — created the way a
//! developer would, Milestone then Epic then Story, through the domain writers.

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::project::{self, Project};
use core::domain::{epic, milestone, story};
use rusqlite::Connection;
use std::process::Command;

mod scratch_root;
#[allow(unused_imports)]
pub use scratch_root::{with_scratch_worktree_root, WORKTREE_ROOT_ENV_LOCK};

#[allow(dead_code)]
pub fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project.
#[allow(dead_code)]
pub fn seeded_project() -> (Connection, String, Project) {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    std::mem::forget(dir);

    let mut conn =
        open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(&mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main")
        .expect("create_project should succeed");
    (conn, actor_id, proj)
}

/// Open a fresh migrated database, `git init` a real repository in its own (leaked) `TempDir`,
/// make one commit on `main`, and register it as a Flywheel project pointing at that repository
/// (worktree creation needs a real repository, not a bare row with an arbitrary `repo_path`).
/// Returns `(conn, actor_id, project, repo_dir)`; the caller keeps `repo_dir` alive for the test's
/// duration.
#[allow(dead_code)]
pub fn seeded_git_project() -> (Connection, String, Project, tempfile::TempDir) {
    let repo_dir = tempfile::tempdir().expect("failed to create scratch repo dir");
    let repo_path = repo_dir.path();

    let run = |args: &[&str]| {
        let status = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .status()
            .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
        assert!(status.success(), "git {args:?} failed");
    };

    run(&["init", "--initial-branch=main"]);
    run(&["config", "user.email", "fixture@flywheel.test"]);
    run(&["config", "user.name", "Fixture"]);
    std::fs::write(repo_path.join("README.md"), "fixture repo\n").expect("failed to write README");
    run(&["add", "README.md"]);
    run(&["commit", "-m", "initial commit"]);

    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    std::mem::forget(dir);

    let mut conn =
        open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(
        &mut conn,
        &actor_id,
        "Threadfin",
        &repo_path.to_string_lossy(),
        "FLY",
        "main",
    )
    .expect("create_project should succeed");
    (conn, actor_id, proj, repo_dir)
}

/// A Story in `project_id`, created the way a developer would: a Milestone, an Epic inside it,
/// then the Story inside the Epic. Each call makes its own Milestone and Epic.
#[allow(dead_code)]
pub fn new_story(conn: &mut Connection, project_id: &str, actor_id: &str, title: &str) -> story::Story {
    let m = milestone::create_milestone(conn, project_id, actor_id, "Fixture milestone", None)
        .expect("create_milestone should succeed");
    let e = epic::create_epic(conn, actor_id, &m.id, "Fixture epic").expect("create_epic should succeed");
    story::create_story(conn, actor_id, &e.id, title).expect("create_story should succeed")
}
