//! LINK-10 coverage for `git_facts.rs`'s `record_outside_commits`/`made_outside_flywheel` (Phase 7
//! plan 07-06 Task 1): every bullet in the plan's `<behavior>` block, proven against a real
//! `git init`-ed tempdir repository and real `agent_runs` rows — never a hand-typed trailer check
//! (D-129, forced by D-126: the commit-msg hook stamps every commit on a `flywheel/` branch
//! identically, agent-made or hand-typed, so trailer presence cannot distinguish them).
//!
//! Boundary timestamps are plain RFC3339 literals, not values read back from `git log` — D-129's
//! coverage comparison parses both sides as `chrono` instants (`git_facts.rs::is_covered_by_agent_run`),
//! so `"...+00:00"` and the `%cI`-normalized `"...Z"` git itself emits for the same instant compare
//! equal regardless of their literal spelling; committer timestamps are pinned via
//! `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` so every boundary case (strictly inside, exactly at
//! `started_at`, exactly at `ended_at`, after a completed run, during a still-live run) is a real
//! equality or real ordering, not an approximation.

mod common;

use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use core::domain::actor::{local_human_actor_id, system_actor};
use core::domain::project::create_project;
use core::domain::task::create_task;
use core::git_facts::{git_facts_for_task, record_outside_commits, EVENT_OUTSIDE_COMMIT};
use core::ids::new_id;
use core::query::events::activity_trail;
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
    run_git_ok(&repo, &["config", "user.email", "outside-commit-test@flywheel.invalid"]);
    run_git_ok(&repo, &["config", "user.name", "Flywheel Outside Commit Test"]);
    std::fs::write(repo.join("README.md"), "outside_commit_detection.rs scratch repo\n")
        .expect("failed to write README");
    run_git_ok(&repo, &["add", "README.md"]);
    run_git_ok(&repo, &["commit", "-m", "initial commit"]);
    repo
}

/// A real bare repository used as the throwaway local `origin` — so `target_ref` ("origin/main")
/// resolves locally and `git_facts_for_task`'s commit range is `origin/main..HEAD` (only commits
/// unique to the task's branch), matching `git_facts.rs`'s own test fixture.
fn init_bare(root: &Path, name: &str) -> PathBuf {
    let repo = root.join(name);
    run_git_ok(root, &["init", "--bare", "--initial-branch", "main", repo.to_str().unwrap()]);
    repo
}

/// Commit `filename` with a committer/author timestamp pinned to `timestamp` (an RFC3339 literal)
/// via `GIT_COMMITTER_DATE`/`GIT_AUTHOR_DATE` — the one deterministic lever this file uses to put
/// a commit at an exact instant relative to an `agent_runs` window's boundaries.
fn commit_file_at(repo: &Path, filename: &str, contents: &str, message: &str, timestamp: &str) {
    std::fs::write(repo.join(filename), contents).expect("failed to write file");
    run_git_ok(repo, &["add", filename]);
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["commit", "-m", message])
        .env("GIT_COMMITTER_DATE", timestamp)
        .env("GIT_AUTHOR_DATE", timestamp)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git commit: {e}"));
    assert!(
        output.status.success(),
        "git commit failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A DB + real-repo fixture: a project registered at `main_repo` (with `origin` pushed to a
/// throwaway local bare remote), one epic-less task, and a real `git worktree` checked out on a
/// fresh branch from `main`, with a matching `worktrees` row. Mirrors `git_facts.rs`'s own
/// `setup()` fixture.
struct Fixture {
    _root: tempfile::TempDir,
    conn: Connection,
    task_id: String,
    project_id: String,
    branch: String,
    worktree_path: PathBuf,
    system_actor_id: String,
}

fn setup() -> Fixture {
    let root = tempfile::tempdir().expect("failed to create scratch root");

    let origin = init_bare(root.path(), "origin.git");
    let main_repo = init_repo(root.path(), "main_repo");
    run_git_ok(&main_repo, &["remote", "add", "origin", origin.to_str().unwrap()]);
    run_git_ok(&main_repo, &["push", "-u", "origin", "main"]);

    let worktree_path = root.path().join("task_worktree");
    let branch = "flywheel/fly-1-a-task".to_string();
    run_git_ok(
        &main_repo,
        &["worktree", "add", worktree_path.to_str().unwrap(), "-b", &branch, "main"],
    );

    let db_dir = tempfile::tempdir().expect("failed to create scratch db dir");
    let db_path = db_dir.path().join("flywheel.db");
    let backups_dir = db_dir.path().join("backups");
    std::mem::forget(db_dir);

    let mut conn =
        core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let system_actor_id = system_actor(&conn).expect("seeded system actor should exist").id;
    let project = create_project(
        &mut conn,
        &actor_id,
        "Fixture Project",
        &main_repo.to_string_lossy(),
        "FLY",
        "main",
    )
    .expect("create_project should succeed");

    let task = create_task(&mut conn, &project.id, &actor_id, "A Task", None)
        .expect("create_task should succeed");

    conn.execute(
        "INSERT INTO worktrees (
            id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'main', 'active', ?6, ?7)",
        params![
            new_id(),
            task.id,
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
        task_id: task.id,
        project_id: project.id,
        branch,
        worktree_path,
        system_actor_id,
    }
}

/// Insert one `triggers` row (required by `agent_runs.trigger_id`'s NOT NULL FK), scoped to
/// `task_id`, source `user_action` — the only source this crate's own application code ever
/// writes (DATA-04).
fn insert_trigger(conn: &Connection, project_id: &str, task_id: &str, actor_id: &str) -> String {
    let id = new_id();
    conn.execute(
        "INSERT INTO triggers (
            id, project_id, target_task_id, target_epic_id, source, config, enabled,
            last_fired_at, created_by, created_at
        ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5)",
        params![id, project_id, task_id, actor_id, "2026-01-01T00:00:00.000Z"],
    )
    .expect("failed to insert fixture trigger");
    id
}

/// Insert one `agent_runs` row with an exact `started_at`/`ended_at` window — `ended_at: None`
/// means a still-live run (`status = 'running'`), matching the real schema's nullable column.
#[allow(clippy::too_many_arguments)]
fn insert_agent_run(
    conn: &Connection,
    task_id: &str,
    project_id: &str,
    trigger_id: &str,
    actor_id: &str,
    started_at: &str,
    ended_at: Option<&str>,
) -> String {
    let id = new_id();
    let status = if ended_at.is_some() { "completed" } else { "running" };
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, acknowledged_at, exit_summary_id, criteria_revision_pin,
            authoring_stage
        ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, ?6, NULL, 'default', NULL, NULL, \
            NULL, ?7, ?8, ?9, NULL, NULL, NULL, NULL)",
        params![
            id,
            task_id,
            project_id,
            trigger_id,
            actor_id,
            status,
            format!("/tmp/log-{id}.jsonl"),
            started_at,
            ended_at,
        ],
    )
    .expect("failed to insert fixture agent_run");
    id
}

/// Counts only [`EVENT_OUTSIDE_COMMIT`] rows for `task_id` — `create_task` itself appends its own
/// `task.created` event, so a bare `COUNT(*)` over every event would not isolate this detector's
/// own writes.
fn count_outside_commit_events_for_task(conn: &Connection, task_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE task_id = ?1 AND event_type = ?2",
        params![task_id, EVENT_OUTSIDE_COMMIT],
        |row| row.get(0),
    )
    .expect("failed to count events")
}

#[test]
fn commit_strictly_inside_an_agent_run_window_is_not_marked() {
    let mut fixture = setup();
    commit_file_at(
        &fixture.worktree_path,
        "a.txt",
        "a\n",
        "inside the window",
        "2026-01-01T10:00:00+00:00",
    );
    let trigger_id =
        insert_trigger(&fixture.conn, &fixture.project_id, &fixture.task_id, &fixture.system_actor_id);
    insert_agent_run(
        &fixture.conn,
        &fixture.task_id,
        &fixture.project_id,
        &trigger_id,
        &fixture.system_actor_id,
        "2026-01-01T09:00:00+00:00",
        Some("2026-01-01T11:00:00+00:00"),
    );

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert_eq!(facts.commits.len(), 1);
    assert!(
        !facts.commits[0].made_outside_flywheel,
        "a commit strictly inside a recorded run window must not be marked"
    );

    let appended = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");
    assert_eq!(appended, 0, "a covered commit must append no event");
    assert_eq!(count_outside_commit_events_for_task(&fixture.conn, &fixture.task_id), 0);
}

#[test]
fn commit_exactly_at_a_runs_started_at_is_not_marked() {
    let fixture = setup();
    commit_file_at(
        &fixture.worktree_path,
        "a.txt",
        "a\n",
        "at started_at",
        "2026-01-01T09:00:00+00:00",
    );
    let trigger_id =
        insert_trigger(&fixture.conn, &fixture.project_id, &fixture.task_id, &fixture.system_actor_id);
    insert_agent_run(
        &fixture.conn,
        &fixture.task_id,
        &fixture.project_id,
        &trigger_id,
        &fixture.system_actor_id,
        "2026-01-01T09:00:00+00:00",
        Some("2026-01-01T11:00:00+00:00"),
    );

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert!(
        !facts.commits[0].made_outside_flywheel,
        "a commit exactly at started_at must be covered (inclusive lower bound)"
    );
}

#[test]
fn commit_exactly_at_a_runs_ended_at_is_not_marked() {
    let fixture = setup();
    commit_file_at(
        &fixture.worktree_path,
        "a.txt",
        "a\n",
        "at ended_at",
        "2026-01-01T11:00:00+00:00",
    );
    let trigger_id =
        insert_trigger(&fixture.conn, &fixture.project_id, &fixture.task_id, &fixture.system_actor_id);
    insert_agent_run(
        &fixture.conn,
        &fixture.task_id,
        &fixture.project_id,
        &trigger_id,
        &fixture.system_actor_id,
        "2026-01-01T09:00:00+00:00",
        Some("2026-01-01T11:00:00+00:00"),
    );

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert!(
        !facts.commits[0].made_outside_flywheel,
        "a commit exactly at ended_at must be covered (inclusive upper bound)"
    );
}

#[test]
fn commit_after_a_completed_runs_ended_at_and_inside_no_other_window_is_marked() {
    let mut fixture = setup();
    commit_file_at(
        &fixture.worktree_path,
        "a.txt",
        "a\n",
        "after the run ended",
        "2026-01-01T12:00:00+00:00",
    );
    let trigger_id =
        insert_trigger(&fixture.conn, &fixture.project_id, &fixture.task_id, &fixture.system_actor_id);
    insert_agent_run(
        &fixture.conn,
        &fixture.task_id,
        &fixture.project_id,
        &trigger_id,
        &fixture.system_actor_id,
        "2026-01-01T09:00:00+00:00",
        Some("2026-01-01T11:00:00+00:00"),
    );

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert!(
        facts.commits[0].made_outside_flywheel,
        "a commit after a completed run's ended_at, covered by no window, must be marked"
    );

    let appended = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");
    assert_eq!(appended, 1);
}

#[test]
fn commit_landing_while_a_run_has_ended_at_null_is_not_marked() {
    let fixture = setup();
    commit_file_at(
        &fixture.worktree_path,
        "a.txt",
        "a\n",
        "during a still-live run",
        "2026-01-01T15:00:00+00:00",
    );
    let trigger_id =
        insert_trigger(&fixture.conn, &fixture.project_id, &fixture.task_id, &fixture.system_actor_id);
    insert_agent_run(
        &fixture.conn,
        &fixture.task_id,
        &fixture.project_id,
        &trigger_id,
        &fixture.system_actor_id,
        "2026-01-01T09:00:00+00:00",
        None,
    );

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert!(
        !facts.commits[0].made_outside_flywheel,
        "a commit landing while a run's ended_at is NULL must be covered (open right edge)"
    );
}

#[test]
fn every_commit_on_a_task_with_zero_agent_runs_rows_is_marked() {
    let fixture = setup();
    commit_file_at(&fixture.worktree_path, "a.txt", "a\n", "first", "2026-01-01T10:00:00+00:00");
    commit_file_at(&fixture.worktree_path, "b.txt", "b\n", "second", "2026-01-01T11:00:00+00:00");

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert_eq!(facts.commits.len(), 2);
    assert!(
        facts.commits.iter().all(|c| c.made_outside_flywheel),
        "with zero agent_runs rows, every commit on the branch must be marked"
    );
}

#[test]
fn a_branch_with_zero_commits_yields_no_marker_and_no_event() {
    let mut fixture = setup();

    let facts = git_facts_for_task(&fixture.conn, &fixture.task_id)
        .expect("git_facts_for_task should succeed")
        .expect("facts should be Some");
    assert!(facts.commits.is_empty(), "a freshly cut branch has no commits of its own yet");

    let appended = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");
    assert_eq!(appended, 0);
    assert_eq!(count_outside_commit_events_for_task(&fixture.conn, &fixture.task_id), 0);
}

#[test]
fn record_outside_commits_appends_one_event_for_a_newly_marked_commit_with_full_payload() {
    let mut fixture = setup();
    commit_file_at(&fixture.worktree_path, "a.txt", "a\n", "hand-typed", "2026-01-01T10:00:00+00:00");

    let appended = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");
    assert_eq!(appended, 1);

    let (actor_id, payload_text): (String, String) = fixture
        .conn
        .query_row(
            "SELECT actor_id, payload FROM events WHERE task_id = ?1 AND event_type = ?2",
            params![fixture.task_id, EVENT_OUTSIDE_COMMIT],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the appended event row should exist");

    assert_eq!(actor_id, fixture.system_actor_id, "the event must be stamped with the system actor");

    let payload: serde_json::Value =
        serde_json::from_str(&payload_text).expect("payload should be valid JSON");
    assert!(payload["sha"].as_str().is_some());
    assert!(payload["short_sha"].as_str().is_some());
    assert_eq!(payload["branch"].as_str(), Some(fixture.branch.as_str()));
    let label = payload["label"].as_str().expect("payload should carry a label");
    assert!(label.contains("outside Flywheel"), "label should name the detection: {label:?}");
}

#[test]
fn record_outside_commits_is_idempotent_on_a_second_call() {
    let mut fixture = setup();
    commit_file_at(&fixture.worktree_path, "a.txt", "a\n", "hand-typed", "2026-01-01T10:00:00+00:00");

    let first = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");
    let second = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");

    assert_eq!(first, 1);
    assert_eq!(second, 0, "re-running over the same unchanged branch must append nothing further");
    assert_eq!(count_outside_commit_events_for_task(&fixture.conn, &fixture.task_id), 1);
}

#[test]
fn record_outside_commits_never_writes_tasks_or_appends_for_covered_commits() {
    let mut fixture = setup();
    commit_file_at(
        &fixture.worktree_path,
        "a.txt",
        "a\n",
        "an agent's own commit",
        "2026-01-01T10:00:00+00:00",
    );
    let trigger_id =
        insert_trigger(&fixture.conn, &fixture.project_id, &fixture.task_id, &fixture.system_actor_id);
    insert_agent_run(
        &fixture.conn,
        &fixture.task_id,
        &fixture.project_id,
        &trigger_id,
        &fixture.system_actor_id,
        "2026-01-01T09:00:00+00:00",
        Some("2026-01-01T11:00:00+00:00"),
    );

    let status_before: String = fixture
        .conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", params![fixture.task_id], |row| {
            row.get(0)
        })
        .expect("task should exist");

    let appended = record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");
    assert_eq!(appended, 0);

    let status_after: String = fixture
        .conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", params![fixture.task_id], |row| {
            row.get(0)
        })
        .expect("task should exist");
    assert_eq!(status_before, status_after, "a covered commit must never touch tasks.status");
    assert_eq!(count_outside_commit_events_for_task(&fixture.conn, &fixture.task_id), 0);
}

#[test]
fn the_appended_events_description_via_activity_trail_equals_the_payload_label() {
    let mut fixture = setup();
    commit_file_at(&fixture.worktree_path, "a.txt", "a\n", "hand-typed", "2026-01-01T10:00:00+00:00");

    record_outside_commits(&mut fixture.conn, &fixture.task_id, &fixture.system_actor_id)
        .expect("record_outside_commits should succeed");

    let trail = activity_trail(&fixture.conn, "task", &fixture.task_id, 50, 0)
        .expect("activity_trail should succeed");
    let event = trail
        .iter()
        .find(|e| e.event_type == EVENT_OUTSIDE_COMMIT)
        .expect("the outside-commit event should be in the trail");

    let expected_label =
        event.payload["label"].as_str().expect("payload should carry a label").to_string();
    assert_eq!(event.description, expected_label);
}
