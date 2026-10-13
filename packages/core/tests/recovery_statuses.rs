//! Migration `0006_recovery_statuses.sql` coverage (D-45, D-49, D-18): the two CHECK-constraint
//! table rebuilds accept the new values, reject anything else, and every pre-existing row, index
//! and foreign key survives — built the same way `migration_safety.rs` builds its own "N-1"
//! fixture, from the real, ordered `core::db::migration_sources()` list, never a hand-duplicated
//! copy.

mod common;

use std::collections::HashSet;

use core::db::{apply_pragmas, migration_sources, open_and_migrate};
use core::domain::actor::local_human_actor_id;
use core::domain::agent_run::AgentRunStatus;
use core::domain::project::create_project;
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};

fn scratch_paths() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    (dir, db_path, backups_dir)
}

/// Build the N-1 fixture: every migration source except migration `0006` itself, applied to a
/// fresh scratch file — mirrors `migration_safety.rs`'s own `build_n_minus_1_fixture` exactly,
/// duplicated here (rather than shared) because integration-test binaries cannot import from one
/// another, only from `mod common`.
fn build_n_minus_1_fixture(db_path: &std::path::Path) -> Connection {
    let all_sources = migration_sources();
    let n_minus_1_sources = &all_sources[..all_sources.len() - 1];

    let mut conn = Connection::open(db_path).expect("failed to create the scratch file");
    apply_pragmas(&conn).expect("failed to apply pragmas to the fixture connection");

    let fixture_migrations =
        Migrations::new(n_minus_1_sources.iter().map(|src| M::up(src)).collect());
    fixture_migrations
        .to_latest(&mut conn)
        .expect("the N-1 fixture migrations should apply cleanly");

    conn
}

fn insert_trigger(conn: &Connection, id: &str, project_id: &str, task_id: &str, actor_id: &str, now: &str) {
    conn.execute(
        "INSERT INTO triggers (
            id, project_id, target_task_id, source, config, enabled, last_fired_at,
            created_by, created_at
        ) VALUES (?1, ?2, ?3, 'user_action', NULL, 1, ?4, ?5, ?4)",
        params![id, project_id, task_id, now, actor_id],
    )
    .expect("failed to insert fixture trigger");
}

fn insert_worktree(
    conn: &Connection,
    id: &str,
    task_id: &str,
    project_id: &str,
    status: &str,
    actor_id: &str,
    now: &str,
) {
    conn.execute(
        "INSERT INTO worktrees (
            id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'main', ?6, ?7, ?8)",
        params![id, task_id, project_id, format!("/tmp/{id}"), format!("branch-{id}"), status, actor_id, now],
    )
    .expect("failed to insert fixture worktree");
}

#[allow(clippy::too_many_arguments)]
fn insert_agent_run(
    conn: &Connection,
    id: &str,
    worktree_id: Option<&str>,
    task_id: &str,
    project_id: &str,
    trigger_id: &str,
    actor_id: &str,
    status: &str,
    now: &str,
) {
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'claude_code', ?6, ?7, NULL, 'default', NULL, NULL, NULL, ?8, ?9, NULL)",
        params![id, worktree_id, task_id, project_id, trigger_id, actor_id, status, format!("/tmp/log-{id}.jsonl"), now],
    )
    .expect("failed to insert fixture agent_run");
}

/// The pre-migration data this suite seeds — enough to assert byte-identical survival for every
/// column of both rebuilt tables, and to prove the `worktree_id` foreign key between them still
/// resolves after the rebuild.
struct Fixture {
    project_id: String,
    /// (worktree_id, task_id, status) for every one of the four PRE-EXISTING worktree statuses.
    worktrees: Vec<(String, String, &'static str)>,
    /// (agent_run_id, worktree_id_or_none, task_id, status) for every one of the five
    /// PRE-EXISTING agent_run statuses.
    agent_runs: Vec<(String, Option<String>, String, &'static str)>,
}

/// Seed one row for every status BOTH tables already accepted before migration `0006` —
/// `worktrees`: active/stale/merged/abandoned; `agent_runs`: running/blocked/completed/failed/
/// interrupted — through the real domain functions for project/task creation (so the FTS5 sync
/// triggers and event log stay realistic) and raw `INSERT`s for the two tables this migration
/// itself rebuilds, whose full column shape those domain functions don't yet expose. Four of the
/// five agent_run rows carry a REAL `worktree_id` foreign key into one of the four worktree rows
/// (the fifth carries `NULL`) — this is the exact case `open_and_migrate`'s
/// disable/rebuild/re-enable-and-check `foreign_keys` sequence exists to survive.
fn seed_pre_migration_rows(conn: &mut Connection) -> Fixture {
    let actor_id = local_human_actor_id(conn).expect("seeded human actor should exist");
    let project = create_project(conn, &actor_id, "Recovery", "/repo", "REC", "main")
        .expect("create_project should succeed");
    let now = "2026-01-01T00:00:00.000Z";

    let worktree_statuses = ["active", "stale", "merged", "abandoned"];
    let mut worktrees = Vec::new();
    for status in worktree_statuses {
        let task = create_task(conn, &project.id, &actor_id, &format!("wt task {status}"), None)
            .expect("create_task should succeed");
        let worktree_id = new_id();
        insert_worktree(conn, &worktree_id, &task.id, &project.id, status, &actor_id, now);
        worktrees.push((worktree_id, task.id, status));
    }

    let agent_run_statuses = ["running", "blocked", "completed", "failed", "interrupted"];
    let mut agent_runs = Vec::new();
    for (i, status) in agent_run_statuses.iter().enumerate() {
        // The first four agent_run rows reuse one of the four worktree tasks/ids just created
        // (a real worktree_id FK); the fifth ("interrupted") gets its own task and no worktree.
        let (task_id, worktree_id) = if i < worktrees.len() {
            (worktrees[i].1.clone(), Some(worktrees[i].0.clone()))
        } else {
            let task = create_task(conn, &project.id, &actor_id, &format!("ar task {status}"), None)
                .expect("create_task should succeed");
            (task.id, None)
        };

        let run_id = new_id();
        let trigger_id = new_id();
        insert_trigger(conn, &trigger_id, &project.id, &task_id, &actor_id, now);
        insert_agent_run(
            conn,
            &run_id,
            worktree_id.as_deref(),
            &task_id,
            &project.id,
            &trigger_id,
            &actor_id,
            status,
            now,
        );
        agent_runs.push((run_id, worktree_id, task_id, *status));
    }

    Fixture { project_id: project.id, worktrees, agent_runs }
}

/// `(id, task_id, path, branch, base_branch, status)` — every column `remove_worktree_for_task`
/// and `reconcile_worktrees` (plan 03-03 Tasks 1-3) care about surviving the rebuild unchanged.
fn worktree_row(conn: &Connection, id: &str) -> (String, String, String, String, String, String) {
    conn.query_row(
        "SELECT id, task_id, path, branch, base_branch, status FROM worktrees WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
    )
    .expect("worktree row should still exist after migrating")
}

/// `(id, worktree_id, task_id, status, log_path)` — the columns that prove both a real
/// `worktree_id` FK link and a `NULL` one survive the rebuild identically.
fn agent_run_row(conn: &Connection, id: &str) -> (String, Option<String>, String, String, String) {
    conn.query_row(
        "SELECT id, worktree_id, task_id, status, log_path FROM agent_runs WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
    )
    .expect("agent_run row should still exist after migrating")
}

fn index_names(conn: &Connection, table: &str) -> HashSet<String> {
    let mut stmt = conn.prepare(&format!("PRAGMA index_list({table})")).expect("index_list should prepare");
    stmt.query_map([], |row| row.get::<_, String>(1))
        .expect("index_list should query")
        .collect::<Result<HashSet<_>, _>>()
        .expect("index_list rows should read")
}

/// `(table, from, to)` for every declared foreign key on `table`, sorted so comparison is
/// order-independent.
fn fk_targets(conn: &Connection, table: &str) -> Vec<(String, String, String)> {
    let mut stmt =
        conn.prepare(&format!("PRAGMA foreign_key_list({table})")).expect("foreign_key_list should prepare");
    let mut rows: Vec<(String, String, String)> = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(2)?, row.get::<_, String>(3)?, row.get::<_, String>(4)?))
        })
        .expect("foreign_key_list should query")
        .collect::<Result<Vec<_>, _>>()
        .expect("foreign_key_list rows should read");
    rows.sort();
    rows
}

#[test]
fn worktrees_check_accepts_missing_and_rejects_a_bogus_status() {
    let (_dir, db_path, backups_dir) = scratch_paths();
    {
        let mut conn = build_n_minus_1_fixture(&db_path);
        seed_pre_migration_rows(&mut conn);
    }

    let mut conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the N-1 fixture forward to N");

    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let project_id: String = conn
        .query_row("SELECT id FROM projects LIMIT 1", [], |row| row.get(0))
        .expect("the seeded project should still exist");
    let now = "2026-02-01T00:00:00.000Z";

    let missing_task = create_task(&mut conn, &project_id, &actor_id, "missing wt task", None)
        .expect("create_task should succeed");
    insert_worktree(&conn, &new_id(), &missing_task.id, &project_id, "missing", &actor_id, now);
    let missing_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM worktrees WHERE status = 'missing'", [], |row| row.get(0))
        .expect("count query should succeed");
    assert_eq!(missing_count, 1, "a worktree row with status='missing' should insert cleanly");

    let bogus_task = create_task(&mut conn, &project_id, &actor_id, "bogus wt task", None)
        .expect("create_task should succeed");
    let result = conn.execute(
        "INSERT INTO worktrees (
            id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, '/tmp/bogus-wt', 'branch-bogus', 'main', 'bogus', ?4, ?5)",
        params![new_id(), bogus_task.id, project_id, actor_id, now],
    );
    assert!(result.is_err(), "an INSERT with status='bogus' must be rejected by the CHECK constraint");
}

#[test]
fn agent_runs_check_accepts_abandoned_and_rejects_a_bogus_status() {
    let (_dir, db_path, backups_dir) = scratch_paths();
    {
        let mut conn = build_n_minus_1_fixture(&db_path);
        seed_pre_migration_rows(&mut conn);
    }

    let mut conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the N-1 fixture forward to N");

    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let project_id: String = conn
        .query_row("SELECT id FROM projects LIMIT 1", [], |row| row.get(0))
        .expect("the seeded project should still exist");
    let now = "2026-02-01T00:00:00.000Z";

    let abandoned_task = create_task(&mut conn, &project_id, &actor_id, "abandoned ar task", None)
        .expect("create_task should succeed");
    let trigger_id = new_id();
    insert_trigger(&conn, &trigger_id, &project_id, &abandoned_task.id, &actor_id, now);
    let run_id = new_id();
    insert_agent_run(&conn, &run_id, None, &abandoned_task.id, &project_id, &trigger_id, &actor_id, "running", now);
    conn.execute("UPDATE agent_runs SET status = 'abandoned' WHERE id = ?1", params![run_id])
        .expect("UPDATE ... SET status='abandoned' should succeed");
    let status: String = conn
        .query_row("SELECT status FROM agent_runs WHERE id = ?1", params![run_id], |row| row.get(0))
        .expect("row should exist");
    assert_eq!(status, "abandoned");

    let result = conn.execute("UPDATE agent_runs SET status = 'bogus' WHERE id = ?1", params![run_id]);
    assert!(result.is_err(), "an UPDATE to status='bogus' must be rejected by the CHECK constraint");
}

#[test]
fn preexisting_worktree_and_agent_run_rows_survive_the_rebuild_with_identical_values() {
    let (_dir, db_path, backups_dir) = scratch_paths();
    let fixture = {
        let mut conn = build_n_minus_1_fixture(&db_path);
        let fixture = seed_pre_migration_rows(&mut conn);

        // Snapshot every seeded row's own columns BEFORE migrating, from the N-1 connection
        // itself, so the post-migration comparison below is against real captured values, not a
        // re-derivation of what the fixture "should" have inserted.
        let before_worktrees: Vec<_> =
            fixture.worktrees.iter().map(|(id, _, _)| worktree_row(&conn, id)).collect();
        let before_agent_runs: Vec<_> =
            fixture.agent_runs.iter().map(|(id, _, _, _)| agent_run_row(&conn, id)).collect();

        (fixture, before_worktrees, before_agent_runs)
    };
    let (fixture, before_worktrees, before_agent_runs) = fixture;

    let conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the N-1 fixture forward to N");

    for (expected, (id, _, _)) in before_worktrees.iter().zip(fixture.worktrees.iter()) {
        let after = worktree_row(&conn, id);
        assert_eq!(expected, &after, "worktree row {id} must survive the rebuild byte-for-byte");
    }
    for (expected, (id, _, _, _)) in before_agent_runs.iter().zip(fixture.agent_runs.iter()) {
        let after = agent_run_row(&conn, id);
        assert_eq!(expected, &after, "agent_run row {id} must survive the rebuild byte-for-byte");
    }

    // Every worktree and agent_run row created for this fixture project is still counted —
    // no row silently disappeared during the rebuild.
    let worktree_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM worktrees WHERE project_id = ?1",
            params![fixture.project_id],
            |row| row.get(0),
        )
        .expect("count query should succeed");
    assert_eq!(worktree_count, fixture.worktrees.len() as i64);

    let agent_run_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1",
            params![fixture.project_id],
            |row| row.get(0),
        )
        .expect("count query should succeed");
    assert_eq!(agent_run_count, fixture.agent_runs.len() as i64);
}

#[test]
fn indexes_and_foreign_keys_are_preserved_after_the_rebuild() {
    let (_dir, db_path, backups_dir) = scratch_paths();

    let (before_worktree_indexes, before_agent_run_indexes, before_worktree_fks, before_agent_run_fks) = {
        let mut conn = build_n_minus_1_fixture(&db_path);
        seed_pre_migration_rows(&mut conn);
        (
            index_names(&conn, "worktrees"),
            index_names(&conn, "agent_runs"),
            fk_targets(&conn, "worktrees"),
            fk_targets(&conn, "agent_runs"),
        )
    };

    let conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the N-1 fixture forward to N");

    assert_eq!(
        index_names(&conn, "worktrees"),
        before_worktree_indexes,
        "worktrees indexes must be identical before and after the rebuild"
    );
    let after_agent_run_indexes = index_names(&conn, "agent_runs");
    assert_eq!(
        after_agent_run_indexes, before_agent_run_indexes,
        "agent_runs indexes must be identical before and after the rebuild"
    );
    assert!(
        after_agent_run_indexes.contains("idx_agent_runs_task_started"),
        "idx_agent_runs_task_started must survive the rebuild"
    );
    assert!(
        after_agent_run_indexes.contains("idx_agent_runs_project_status"),
        "idx_agent_runs_project_status must survive the rebuild"
    );

    assert_eq!(
        fk_targets(&conn, "worktrees"),
        before_worktree_fks,
        "worktrees foreign keys must be identical before and after the rebuild"
    );
    assert_eq!(
        fk_targets(&conn, "agent_runs"),
        before_agent_run_fks,
        "agent_runs foreign keys must be identical before and after the rebuild"
    );

    // task_id must still be UNIQUE on worktrees — the one-worktree-per-task invariant
    // `ensure_worktree` relies on (WORK-08).
    let unique_task_id: bool = conn
        .prepare("PRAGMA index_list(worktrees)")
        .expect("index_list should prepare")
        .query_map([], |row| Ok((row.get::<_, String>(1)?, row.get::<_, i64>(2)?)))
        .expect("index_list should query")
        .filter_map(Result::ok)
        .any(|(_, unique)| unique == 1);
    assert!(unique_task_id, "worktrees must still carry a UNIQUE index after the rebuild");
}

#[test]
fn acknowledged_at_exists_is_nullable_and_defaults_to_null_for_every_migrated_row() {
    let (_dir, db_path, backups_dir) = scratch_paths();
    let fixture = {
        let mut conn = build_n_minus_1_fixture(&db_path);
        seed_pre_migration_rows(&mut conn)
    };

    let conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the N-1 fixture forward to N");

    let (notnull, dflt_value): (i64, Option<String>) = conn
        .query_row(
            "SELECT \"notnull\", dflt_value FROM pragma_table_info('agent_runs') WHERE name = 'acknowledged_at'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("acknowledged_at column should exist in agent_runs");
    assert_eq!(notnull, 0, "acknowledged_at must be nullable");
    assert!(dflt_value.is_none(), "acknowledged_at must carry no default value");

    for (id, _, _, _) in &fixture.agent_runs {
        let acknowledged_at: Option<String> = conn
            .query_row(
                "SELECT acknowledged_at FROM agent_runs WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .expect("agent_run row should exist");
        assert!(acknowledged_at.is_none(), "every migrated agent_run row must default acknowledged_at to NULL");
    }
}

#[test]
fn agent_run_status_abandoned_as_str_matches_the_check_constraint() {
    assert_eq!(AgentRunStatus::Abandoned.as_str(), "abandoned");
}
