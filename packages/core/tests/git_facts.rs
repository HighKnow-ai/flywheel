//! LINK-02/LINK-09 coverage for `git_facts.rs` (Phase 7 plan 07-01 Task 1): every bullet in the
//! plan's `<behavior>` block, proven against a real `git init`-ed tempdir repository and a real
//! local bare `origin` — never a network remote, never the ambient git config — following
//! `git_hooks_pre_push.rs`'s own fixture shape (`-C <repo>`, explicit `user.name`/`user.email`).

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use common::new_story;
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::project::create_project;
use flywheel_core::git::{ahead_behind, fetch_origin, last_fetch_at};
use flywheel_core::git_facts::git_facts_for_story;
use flywheel_core::ids::new_id;
use rusqlite::{params, Connection};

fn run_git(repo: &Path, args: &[&str]) -> Output {
    Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git -C {repo:?} {args:?}: {e}"))
}

fn run_git_ok(repo: &Path, args: &[&str]) -> Output {
    let output = run_git(repo, args);
    assert!(
        output.status.success(),
        "git -C {repo:?} {args:?} failed (exit {:?}): {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

/// A real `git init`-ed, config'd repository with one commit on `main` — no remote.
fn init_repo(root: &Path, name: &str) -> PathBuf {
    let repo = root.join(name);
    std::fs::create_dir_all(&repo).expect("failed to create repo dir");
    run_git_ok(&repo, &["init", "--initial-branch", "main"]);
    run_git_ok(
        &repo,
        &["config", "user.email", "git-facts-test@flywheel.invalid"],
    );
    run_git_ok(&repo, &["config", "user.name", "Flywheel Git Facts Test"]);
    std::fs::write(repo.join("README.md"), "git_facts.rs scratch repo\n")
        .expect("failed to write README");
    run_git_ok(&repo, &["add", "README.md"]);
    run_git_ok(&repo, &["commit", "-m", "initial commit"]);
    repo
}

/// A real bare repository used as the throwaway local `origin` (D-63's discipline: never a
/// network remote, never a named upstream outside this test's own scratch directory).
fn init_bare(root: &Path, name: &str) -> PathBuf {
    let repo = root.join(name);
    run_git_ok(
        root,
        &[
            "init",
            "--bare",
            "--initial-branch",
            "main",
            repo.to_str().unwrap(),
        ],
    );
    repo
}

fn commit_file(repo: &Path, filename: &str, contents: &str, message: &str) {
    std::fs::write(repo.join(filename), contents).expect("failed to write file");
    run_git_ok(repo, &["add", filename]);
    run_git_ok(repo, &["commit", "-m", message]);
}

/// A DB + real-repo fixture: a project registered at `main_repo` (with `origin` pushed to a
/// throwaway local bare remote), one Story, and a real
/// `git worktree` checked out on a fresh branch from `main`, with a matching `worktrees` row.
struct Fixture {
    _root: tempfile::TempDir,
    conn: Connection,
    story_id: String,
    worktree_path: PathBuf,
    branch: String,
}

fn setup() -> Fixture {
    let root = tempfile::tempdir().expect("failed to create scratch root");

    let origin = init_bare(root.path(), "origin.git");
    let main_repo = init_repo(root.path(), "main_repo");
    run_git_ok(
        &main_repo,
        &["remote", "add", "origin", origin.to_str().unwrap()],
    );
    run_git_ok(&main_repo, &["push", "-u", "origin", "main"]);

    let worktree_path = root.path().join("story_worktree");
    let branch = "flywheel/fly-1-a-story".to_string();
    run_git_ok(
        &main_repo,
        &[
            "worktree",
            "add",
            worktree_path.to_str().unwrap(),
            "-b",
            &branch,
            "main",
        ],
    );

    let db_dir = tempfile::tempdir().expect("failed to create scratch db dir");
    let db_path = db_dir.path().join("flywheel.db");
    let backups_dir = db_dir.path().join("backups");
    std::mem::forget(db_dir);

    let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should succeed");
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

    let story = new_story(&mut conn, &project.id, &actor_id, "A Story");

    conn.execute(
        "INSERT INTO worktrees (
            id, story_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'main', 'active', ?6, ?7)",
        params![
            new_id(),
            story.id,
            project.id,
            worktree_path.to_string_lossy().into_owned(),
            branch,
            actor_id,
            "2026-01-01T00:00:00.000Z",
        ],
    )
    .expect("failed to insert worktree row");

    Fixture {
        _root: root,
        conn,
        story_id: story.id,
        worktree_path,
        branch,
    }
}

#[test]
fn ahead_behind_level_branch_returns_zero_zero_not_error_or_absent() {
    let root = tempfile::tempdir().expect("failed to create scratch root");
    let repo = init_repo(root.path(), "repo");
    run_git_ok(&repo, &["branch", "feature"]);

    let result = ahead_behind(&repo, "main", "feature").expect("ahead_behind should succeed");
    assert_eq!(result, Some((0, 0)));
}

#[test]
fn ahead_behind_against_unresolvable_target_withholds_the_figure() {
    let root = tempfile::tempdir().expect("failed to create scratch root");
    let repo = init_repo(root.path(), "repo");

    let result = ahead_behind(&repo, "origin/does-not-exist", "main")
        .expect("ahead_behind should succeed even when the target cannot be measured");
    assert_eq!(
        result, None,
        "a target that does not resolve locally must withhold, not fabricate"
    );
}

#[test]
fn git_facts_for_story_with_no_worktree_row_returns_none() {
    let fixture = setup();
    fixture
        .conn
        .execute(
            "DELETE FROM worktrees WHERE story_id = ?1",
            params![fixture.story_id],
        )
        .expect("failed to delete worktree row");

    let facts = git_facts_for_story(&fixture.conn, &fixture.story_id)
        .expect("git_facts_for_story should succeed");
    assert!(facts.is_none());
}

#[test]
fn git_facts_for_story_clean_level_worktree_has_empty_commits_and_uncommitted() {
    let fixture = setup();

    let facts = git_facts_for_story(&fixture.conn, &fixture.story_id)
        .expect("git_facts_for_story should succeed")
        .expect("a worktree row exists, so facts should be Some");

    assert_eq!(facts.branch, fixture.branch);
    assert_eq!(facts.ahead, Some(0));
    assert_eq!(facts.behind, Some(0));
    assert!(facts.commits.is_empty());
    assert_eq!(facts.commits_truncated, 0);
    assert!(facts.uncommitted.is_empty());
}

#[test]
fn git_facts_for_story_commits_are_newest_first_and_stable_across_two_reads() {
    let fixture = setup();
    commit_file(&fixture.worktree_path, "a.txt", "a\n", "add a");
    commit_file(&fixture.worktree_path, "b.txt", "b\n", "add b");

    let first = git_facts_for_story(&fixture.conn, &fixture.story_id)
        .expect("git_facts_for_story should succeed")
        .expect("facts should be Some");
    let second = git_facts_for_story(&fixture.conn, &fixture.story_id)
        .expect("git_facts_for_story should succeed")
        .expect("facts should be Some");

    assert_eq!(first.commits.len(), 2);
    assert_eq!(
        first.commits[0].subject, "add b",
        "newest commit must come first"
    );
    assert_eq!(first.commits[1].subject, "add a");
    assert_eq!(
        first.commits, second.commits,
        "two reads over an unchanged branch must be byte-identical"
    );
}

#[test]
fn last_fetch_at_is_none_until_a_fetch_runs_then_some() {
    let root = tempfile::tempdir().expect("failed to create scratch root");
    let origin = init_bare(root.path(), "origin.git");
    let repo = init_repo(root.path(), "repo");
    run_git_ok(
        &repo,
        &["remote", "add", "origin", origin.to_str().unwrap()],
    );

    assert_eq!(
        last_fetch_at(&repo).expect("last_fetch_at should succeed"),
        None
    );

    let fetched = fetch_origin(&repo).expect("fetch_origin should succeed");
    assert!(fetched, "fetch_origin should report it actually fetched");

    let after = last_fetch_at(&repo).expect("last_fetch_at should succeed");
    assert!(
        after.is_some(),
        "last_fetch_at should flip to Some once FETCH_HEAD exists"
    );
}

#[test]
fn fetch_origin_skips_without_fetching_when_no_remote_is_configured() {
    let root = tempfile::tempdir().expect("failed to create scratch root");
    let repo = init_repo(root.path(), "repo");

    let fetched = fetch_origin(&repo).expect("fetch_origin should succeed");
    assert!(
        !fetched,
        "fetch_origin should skip, not fail, when there is no remote"
    );
}

#[test]
fn target_ref_for_a_story_is_the_project_default_branch() {
    let fixture = setup();

    let facts = git_facts_for_story(&fixture.conn, &fixture.story_id)
        .expect("git_facts_for_story should succeed")
        .expect("facts should be Some");
    assert_eq!(facts.target_ref, "origin/main");
}
