//! Shared fixture for `search_filter.rs` and `perf_seed_1000.rs` (01-08-PLAN.md Task 3):
//! `seed_project` builds one project of `n` tasks spread across the five workflow states, with
//! varied titles, priorities, estimates and assignees, so a search can discriminate between rows
//! and a filter has something real to narrow (a thousand identical rows would make every latency
//! and correctness assertion meaningless).
//!
//! Every row is inserted through a single literal `INSERT` statement inside one transaction — the
//! same base-table `INSERT ON tasks` the domain layer's own `create_task` issues, so the FTS5
//! sync triggers (migration `0002_board_schema.sql`) fire for every seeded row exactly as they
//! would for a real user-created task (01-RESEARCH.md Pitfall 3: only the real `INSERT` keeps the
//! FTS index in sync, and this fixture never bypasses it with a bulk `.import`).

use core::db::open_and_migrate;
use core::domain::actor::{local_human_actor_id, system_actor};
use core::domain::project::{self, Project};
use core::ids::new_id;
use rusqlite::{params, Connection};
use std::process::Command;

#[allow(dead_code)]
pub fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project (mirrors `ranking.rs`'s/
/// `criteria.rs`'s own `seeded_project` fixture).
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

/// Open a fresh migrated database, `git init` a real repository in its own (leaked, per
/// `seeded_project`'s own discipline) `TempDir`, make one commit on `main`, and register it as a
/// Flywheel project pointing at that real repository (plan 02-01 Task 1's `agent_tracer.rs`
/// fixture — worktree creation needs a real repository, not a bare row with an arbitrary
/// `repo_path`). Returns `(conn, actor_id, project, repo_dir)`; the caller keeps `repo_dir` alive
/// for the test's duration.
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

const STATUSES: [&str; 5] = ["backlog", "todo", "in_progress", "in_review", "done"];

/// A word bank varied enough that titles discriminate under search (distinct enough that a
/// two-word title built from `(WORDS[i % WORDS.len()], i)` is very unlikely to collide with
/// another row's title within a 1,000-row seed).
const WORDS: [&str; 20] = [
    "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet",
    "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango",
];

/// Deterministic title for seed row `i` — exposed so callers can compute the exact title a given
/// index will carry (e.g. to search for it) without re-deriving this fixture's naming scheme.
#[allow(dead_code)]
pub fn seed_title(i: usize) -> String {
    format!("{} item {i:04}", WORDS[i % WORDS.len()])
}

/// Create one project and `n` tasks spread evenly across the five workflow states
/// (`i % 5` selects the status), with varied priority (`i % 5`, covering "No priority" through
/// "Low"), estimate (`None` for one in four rows, otherwise S/M/L cycling), and assignee (cycling
/// through unassigned, the seeded human actor and the seeded system actor). Returns the project
/// id.
#[allow(dead_code)]
pub fn seed_project(conn: &mut Connection, n: usize) -> anyhow::Result<String> {
    let human_id = local_human_actor_id(conn)?;
    let system = system_actor(conn)?;
    let proj = project::create_project(conn, &human_id, "Perf Project", "/repo", "FLY", "main")?;

    let now = "2026-01-01T00:00:00.000Z";
    let tx = conn.transaction()?;
    for i in 0..n {
        let id = new_id();
        let status = STATUSES[i % STATUSES.len()];
        let key = format!("FLY-{}", i + 1);
        let title = seed_title(i);
        // A monotonically increasing, zero-padded rank string sorts correctly under plain byte
        // comparison regardless of which status band it lands in — `ORDER BY` always resolves
        // status first, so overlapping rank values across bands never affect the total order.
        let rank = format!("{i:08}");
        let priority = (i % 5) as i64;
        let estimate = if i % 4 == 0 { None } else { Some(((i % 3) + 1) as i64) };
        let assignee_id: Option<&str> = match i % 3 {
            0 => None,
            1 => Some(human_id.as_str()),
            _ => Some(system.id.as_str()),
        };

        tx.execute(
            "INSERT INTO tasks (
                id, project_id, epic_id, key, title, description, status, rank, priority,
                estimate, assignee_id, created_by, created_at, updated_at
            ) VALUES (?1, ?2, NULL, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![
                id, proj.id, key, title, status, rank, priority, estimate, assignee_id, human_id,
                now
            ],
        )?;
    }
    tx.execute(
        "UPDATE projects SET key_counter = key_counter + ?1 WHERE id = ?2",
        params![n as i64, proj.id],
    )?;
    tx.commit()?;

    Ok(proj.id)
}

/// Seed `n` epics into an already-registered project, returning the ids created. Follows
/// `seed_project`'s discipline exactly: one `conn.transaction()`, one literal `INSERT INTO epics
/// (...) VALUES (...)` per row through the same base-table path `create_epic` uses so any schema
/// trigger fires normally, ids from `core::ids::new_id()`, keys of the form the project's
/// `key_prefix` produces, titles varied through the `WORDS` bank, statuses cycling `STATUSES`,
/// priorities cycling `0..5`, and a zero-padded monotonic `rank`. Bumps `projects.key_counter` by
/// `n` at the end, as `seed_project` does.
#[allow(dead_code)]
pub fn seed_epics(conn: &mut Connection, project_id: &str, n: usize) -> anyhow::Result<Vec<String>> {
    let human_id = local_human_actor_id(conn)?;
    let key_prefix: String = conn.query_row(
        "SELECT key_prefix FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;
    let key_counter_before: i64 = conn.query_row(
        "SELECT key_counter FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )?;

    let now = "2026-01-01T00:00:00.000Z";
    let mut ids = Vec::with_capacity(n);
    let tx = conn.transaction()?;
    for i in 0..n {
        let id = new_id();
        let status = STATUSES[i % STATUSES.len()];
        let key = format!("{key_prefix}-{}", key_counter_before + i as i64 + 1);
        let title = format!("{} epic {i:04}", WORDS[i % WORDS.len()]);
        let rank = format!("{i:08}");
        let priority = (i % 5) as i64;

        tx.execute(
            "INSERT INTO epics (
                id, project_id, key, title, description, status, rank, priority,
                created_by, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?9)",
            params![id, project_id, key, title, status, rank, priority, human_id, now],
        )?;
        ids.push(id);
    }
    tx.execute(
        "UPDATE projects SET key_counter = key_counter + ?1 WHERE id = ?2",
        params![n as i64, project_id],
    )?;
    tx.commit()?;

    Ok(ids)
}

/// Branch names produced by [`review_branches`], so plan 08-01's and plan 08-03's tests can name
/// them without re-deriving.
#[allow(dead_code)]
pub struct ReviewBranches {
    pub integration: &'static str,
    /// Touches many files: modified, added, deleted, renamed, binary, and a spaced path.
    pub task_rich: &'static str,
    /// Touches only `other.txt` — merges cleanly with `task_rich`.
    pub task_clean: &'static str,
    /// Both conflict branches rewrite line 1 of `shared.txt` differently.
    pub task_conflict_a: &'static str,
    pub task_conflict_b: &'static str,
}

/// Build the review fixture on top of a repo from [`seeded_git_project`]: commit the base files
/// on `main`, cut an integration branch off it, then build the task branches off the integration
/// branch. Leaves `main` checked out. Direct `Command::new("git")` is fine here — the cwd gate
/// scans only `src` trees.
#[allow(dead_code)]
pub fn review_branches(repo_path: &std::path::Path) -> ReviewBranches {
    let run = |args: &[&str]| {
        let out = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    };
    let write = |name: &str, body: &str| {
        std::fs::write(repo_path.join(name), body).unwrap_or_else(|e| panic!("write {name}: {e}"));
    };
    let commit_all = |msg: &str| {
        run(&["add", "-A"]);
        run(&["commit", "-m", msg]);
    };

    let body = |tag: &str| {
        (1..=12).map(|i| format!("{tag} line {i}\n")).collect::<String>()
    };

    write("keep.txt", &body("keep"));
    write("old_name.txt", &body("rename-me"));
    write("gone.txt", &body("gone"));
    write("shared.txt", &body("shared"));
    write("other.txt", &body("other"));
    commit_all("base files");

    run(&["branch", "flywheel/epic-int", "main"]);

    // task_rich
    run(&["checkout", "-b", "flywheel/task-rich", "flywheel/epic-int"]);
    write("keep.txt", &body("keep").replace("keep line 3", "keep line 3 CHANGED"));
    write("added.txt", "fn added() {}\n");
    std::fs::remove_file(repo_path.join("gone.txt")).expect("remove gone.txt");
    run(&["mv", "old_name.txt", "new_name.txt"]);
    std::fs::write(repo_path.join("image.bin"), [0u8, 1, 2, 0, 255, 254, 0, 7]).expect("bin");
    write("with space.txt", "spaced\n");
    commit_all("rich task work");

    // task_clean
    run(&["checkout", "-b", "flywheel/task-clean", "flywheel/epic-int"]);
    write("other.txt", &body("other").replace("other line 1", "other line 1 CHANGED"));
    commit_all("clean task work");

    // conflict pair
    run(&["checkout", "-b", "flywheel/task-conflict-a", "flywheel/epic-int"]);
    write("shared.txt", &body("shared").replace("shared line 1", "A's version of line 1"));
    commit_all("conflict a");
    run(&["checkout", "-b", "flywheel/task-conflict-b", "flywheel/epic-int"]);
    write("shared.txt", &body("shared").replace("shared line 1", "B's version of line 1"));
    commit_all("conflict b");

    run(&["checkout", "main"]);

    ReviewBranches {
        integration: "flywheel/epic-int",
        task_rich: "flywheel/task-rich",
        task_clean: "flywheel/task-clean",
        task_conflict_a: "flywheel/task-conflict-a",
        task_conflict_b: "flywheel/task-conflict-b",
    }
}
