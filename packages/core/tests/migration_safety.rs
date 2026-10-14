//! DATA-08 — proves migration safety with a real N-1 fixture and a real failing migration,
//! rather than trusting the pragma choice and the happy path.
//!
//! No binary `.db` fixture is committed to this repository — see `tests/fixtures/README.md` for
//! how the "N-1" fixture is built in code, every run, from `core::db::migration_sources()` (the
//! same ordered SQL list `core::db::MIGRATIONS` itself compiles from), so it can never silently
//! drift out of sync with the real schema when a new migration is added.

use std::collections::HashSet;
use std::fs::{self, File};
use std::time::{Duration, SystemTime};

use core::db::backup::{backup_database_file, prune_backups, restore_from_backup};
use core::db::{apply_pragmas, migration_sources, open_and_migrate};
use core::domain::actor::local_human_actor_id;
use core::domain::acceptance_criterion::create_criterion;
use core::domain::epic::create_epic;
use core::domain::project::create_project;
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};
use rusqlite_migration::{Migrations, M};

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Number of backup files currently in `backups_dir`. `backups_dir` may not exist at all yet — a
/// brand-new database has nothing to back up on its first open (D-18) — which is not an error.
fn backup_file_count(backups_dir: &std::path::Path) -> usize {
    if !backups_dir.exists() {
        return 0;
    }
    fs::read_dir(backups_dir)
        .expect("failed to read backups dir")
        .filter_map(|entry| entry.ok())
        .count()
}

/// Build the N-1 fixture: every migration source except the newest, applied to a fresh scratch
/// file. Returns the open connection, positioned at `user_version = N-1`.
fn build_n_minus_1_fixture(db_path: &std::path::Path) -> Connection {
    let all_sources = migration_sources();
    assert!(
        all_sources.len() >= 2,
        "this suite assumes at least two migrations exist to have a meaningful N-1 fixture"
    );
    let n_minus_1_sources = &all_sources[..all_sources.len() - 1];

    let mut conn = Connection::open(db_path).expect("failed to create the scratch file");
    apply_pragmas(&conn).expect("failed to apply pragmas to the fixture connection");

    let fixture_migrations =
        Migrations::new(n_minus_1_sources.iter().map(|src| M::up(src)).collect());
    fixture_migrations
        .to_latest(&mut conn)
        .expect("the N-1 fixture migrations should apply cleanly");

    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("failed to read user_version");
    assert_eq!(
        user_version,
        (all_sources.len() - 1) as i64,
        "the fixture must report user_version = N-1 before the real migration runs"
    );

    conn
}

#[test]
fn fixture_migrates_forward_without_data_loss() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let known_actor_id = core::ids::new_id();
    {
        let conn = build_n_minus_1_fixture(&db_path);
        conn.execute(
            "INSERT INTO actors (id, type, display_name, auth_ref, created_at)
             VALUES (?1, 'human', ?2, NULL, ?3)",
            rusqlite::params![known_actor_id, "Fixture Actor", "2026-01-01T00:00:00Z"],
        )
        .expect("failed to insert the known fixture row");
    }

    let conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the N-1 fixture forward to N");

    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        user_version,
        migration_sources().len() as i64,
        "user_version should advance to N"
    );

    // A table introduced by the newest migration is queryable — the migration actually ran, not
    // merely skipped.
    let project_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM projects", [], |row| row.get(0))
        .expect("the table introduced by the newest migration should exist and be queryable");
    assert_eq!(project_count, 0);

    // The row inserted before the run is present and unchanged — not merely a row count, actual
    // content.
    let (actor_type, display_name, created_at): (String, String, String) = conn
        .query_row(
            "SELECT type, display_name, created_at FROM actors WHERE id = ?1",
            rusqlite::params![known_actor_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("the row inserted before the migration should still be present");
    assert_eq!(actor_type, "human");
    assert_eq!(display_name, "Fixture Actor");
    assert_eq!(created_at, "2026-01-01T00:00:00Z");
}

#[test]
fn backup_matches_pre_migration_bytes() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    {
        let _conn = build_n_minus_1_fixture(&db_path);
    }
    let pre_migration_bytes = fs::read(&db_path).expect("should read the primed fixture file");

    let _conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");

    let backup_files: Vec<_> = fs::read_dir(&backups_dir)
        .expect("backups dir should exist after a migration ran")
        .filter_map(|entry| entry.ok())
        .collect();
    assert_eq!(
        backup_files.len(),
        1,
        "exactly one backup should exist after the single migration run"
    );

    let backup_bytes =
        fs::read(backup_files[0].path()).expect("should be able to read the backup file");
    assert_eq!(
        backup_bytes, pre_migration_bytes,
        "the backup's bytes must match the fixture exactly as it stood before the run"
    );
}

#[test]
fn failed_migration_restores_the_file() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    // Get to a real, fully-migrated N state through the real open_and_migrate.
    {
        let _conn = open_and_migrate(&db_path, &backups_dir)
            .expect("priming open_and_migrate should succeed");
    }
    let pre_attempt_bytes = fs::read(&db_path).expect("should read the fully-migrated file");

    // Drive the exact building blocks open_and_migrate itself uses — backup_database_file and
    // restore_from_backup — around a local Migrations value that appends one intentionally
    // malformed migration to the real, full list. This proves restore_from_backup runs on the
    // real to_latest() error edge, not a hand-simulated one.
    let backup_path = backup_database_file(&db_path, &backups_dir)
        .expect("backing up before the about-to-fail migration should succeed")
        .expect("a backup path should exist for an already-existing file");

    let mut bad_sources = migration_sources();
    bad_sources.push("THIS IS NOT VALID SQL AND WILL FAIL TO APPLY;");
    let bad_migrations = Migrations::new(bad_sources.into_iter().map(M::up).collect());

    {
        let mut conn =
            Connection::open(&db_path).expect("failed to open the file for the bad-migration attempt");
        apply_pragmas(&conn).expect("failed to apply pragmas");
        let result = bad_migrations.to_latest(&mut conn);
        assert!(
            result.is_err(),
            "the malformed migration must fail to apply, not silently succeed"
        );
        // conn is dropped at the end of this block, releasing the file lock before the restore —
        // mirroring open_and_migrate's own drop-before-restore ordering.
    }

    restore_from_backup(&db_path, &backup_path).expect("restoring the backup should succeed");

    let post_restore_bytes = fs::read(&db_path).expect("should read the restored file");
    assert_eq!(
        post_restore_bytes, pre_attempt_bytes,
        "the restored file's bytes must match the file exactly as it stood before the failed migration"
    );

    // No half-applied table from the bad migration exists, and user_version is back to N, not
    // advanced by the failed attempt (rusqlite_migration runs each migration inside its own
    // transaction, so the failed one never committed in the first place — the restore is a
    // second, independent guarantee of the same fact).
    let conn = Connection::open(&db_path).expect("should be able to reopen the restored file");
    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        user_version,
        migration_sources().len() as i64,
        "user_version should be back to N, not advanced by the failed attempt"
    );
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(integrity, "ok");
}

#[test]
fn repeat_open_is_a_no_op() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let _conn = open_and_migrate(&db_path, &backups_dir).expect("first open should succeed");
    assert_eq!(
        backup_file_count(&backups_dir),
        0,
        "a brand-new database has nothing to back up on its first open"
    );

    let _conn = open_and_migrate(&db_path, &backups_dir).expect("second open should succeed");
    assert_eq!(
        backup_file_count(&backups_dir),
        1,
        "the second open should write exactly one backup of the now-existing file"
    );

    let conn = open_and_migrate(&db_path, &backups_dir).expect("third open should succeed");
    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .unwrap();
    assert_eq!(
        user_version,
        migration_sources().len() as i64,
        "user_version must stay at N, not advance again on a repeat open"
    );
    assert_eq!(
        backup_file_count(&backups_dir),
        2,
        "the third open should write a second backup without deleting the first (both are within the retention limit)"
    );
}

#[test]
fn prune_keeps_the_retention_limit() {
    let dir = scratch_dir();
    let backups_dir = dir.path().join("backups");
    fs::create_dir_all(&backups_dir).expect("failed to create the backups dir");

    // Write 8 backup-shaped files with distinct, explicit modification times (rather than
    // relying on natural write-timing gaps, which can tie on some filesystems).
    for i in 0..8u64 {
        let path = backups_dir.join(format!("pre-migration-2-{i:04}.db"));
        fs::write(&path, format!("backup {i}")).expect("failed to write a fixture backup file");
        let file = File::options()
            .write(true)
            .open(&path)
            .expect("failed to reopen the fixture backup file to set its mtime");
        let mtime = SystemTime::UNIX_EPOCH + Duration::from_secs(i * 60);
        file.set_modified(mtime)
            .expect("failed to set the fixture backup file's modification time");
    }

    let removed = prune_backups(&backups_dir, 5).expect("prune_backups should succeed");
    assert_eq!(
        removed, 3,
        "8 files with a retention limit of 5 should remove exactly 3 — the oldest"
    );

    let remaining: HashSet<String> = fs::read_dir(&backups_dir)
        .expect("backups dir should still exist")
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(remaining.len(), 5, "exactly the retention limit should remain");

    for i in 3..8u64 {
        let name = format!("pre-migration-2-{i:04}.db");
        assert!(
            remaining.contains(&name),
            "expected the newer file {name} to survive pruning"
        );
    }
    for i in 0..3u64 {
        let name = format!("pre-migration-2-{i:04}.db");
        assert!(
            !remaining.contains(&name),
            "expected the older file {name} to have been pruned"
        );
    }
}

/// Plan 06-01 (RESEARCH.md Pitfalls 2 and 3): migration `0015_proposal_triage_extension.sql`
/// rebuilds `authoring_proposals` — preserves every existing row (including a self-referential
/// `parent_proposal_id` link), re-creates all four indexes `DROP TABLE` drops, and accepts the
/// two widened CHECK vocabularies (`target_type = 'issue'`, `status = 'deferred'`).
#[test]
fn migration_0015_rebuild_preserves_self_referential_parent_link() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let (project_id, task_id, agent_run_id, parent_proposal_id, child_proposal_id) = {
        let mut conn = build_n_minus_1_fixture(&db_path);

        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
        let project = create_project(&mut conn, &actor_id, "Triage", "/repo", "TRI", "main")
            .expect("create_project should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "A task an agent executes", None)
            .expect("create_task should succeed");

        let now = "2026-01-01T00:00:00Z";
        let trigger_id: String = conn
            .query_row(
                "INSERT INTO triggers (
                    id, project_id, target_task_id, target_epic_id, source, config, enabled,
                    last_fired_at, created_by, created_at
                ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
                params![new_id(), project.id, task.id, actor_id, now],
                |row| row.get(0),
            )
            .expect("failed to insert fixture trigger");

        let run_id = new_id();
        conn.execute(
            "INSERT INTO agent_runs (
                id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id,
                status, external_session_id, permission_mode, cost_usd, tokens_in, tokens_out,
                log_path, started_at, ended_at, authoring_stage
            ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', \
                NULL, NULL, NULL, ?6, ?7, NULL, NULL)",
            params![run_id, task.id, project.id, trigger_id, actor_id, format!("/tmp/{run_id}.jsonl"), now],
        )
        .expect("failed to insert fixture agent_run");

        // Pre-0015 shape: exactly the 0011/0012 column list — no rationale/origin_log_offset/
        // duplicate_of/duplicate_score, and target_type/status still at their pre-widening
        // vocabularies. The parent row's own target_type is 'task' — the ONLY parent type this
        // schema's own foreign key (`authoring_proposals(id)`) requires is that the id exist, not
        // that it be any particular target_type.
        let parent_id = new_id();
        conn.execute(
            "INSERT INTO authoring_proposals (
                id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
                parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
                created_by, created_at, decided_by, decided_at
            ) VALUES (?1, ?2, ?3, NULL, 'create', 'task', NULL, NULL, '80', ?4, 'pending', NULL, \
                NULL, ?5, ?6, NULL, NULL)",
            params![
                parent_id,
                run_id,
                project.id,
                serde_json::json!({"kind": "task", "title": "Parent finding", "description": null}).to_string(),
                actor_id,
                now,
            ],
        )
        .expect("failed to insert the pre-0015 parent authoring_proposals row");

        let child_id = new_id();
        conn.execute(
            "INSERT INTO authoring_proposals (
                id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
                parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
                created_by, created_at, decided_by, decided_at
            ) VALUES (?1, ?2, ?3, NULL, 'create', 'criterion', NULL, ?4, '81', ?5, 'pending', NULL, \
                NULL, ?6, ?7, NULL, NULL)",
            params![
                child_id,
                run_id,
                project.id,
                parent_id,
                serde_json::json!({"kind": "criterion", "statement": "Child finding", "verification_hint": null})
                    .to_string(),
                actor_id,
                now,
            ],
        )
        .expect("failed to insert the pre-0015 child authoring_proposals row (self-referential FK)");

        (project.id, task.id, run_id, parent_id, child_id)
    };
    let _ = task_id;

    let conn = open_and_migrate(&db_path, &backups_dir)
        .expect("open_and_migrate should carry the pre-0015 fixture forward to N");

    // Both rows survive, and the self-referential link is intact.
    let (child_parent, child_status): (Option<String>, String) = conn
        .query_row(
            "SELECT parent_proposal_id, status FROM authoring_proposals WHERE id = ?1",
            params![child_proposal_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("child row should survive the rebuild");
    assert_eq!(child_parent.as_deref(), Some(parent_proposal_id.as_str()));
    assert_eq!(child_status, "pending");

    let parent_status: String = conn
        .query_row(
            "SELECT status FROM authoring_proposals WHERE id = ?1",
            params![parent_proposal_id],
            |row| row.get(0),
        )
        .expect("parent row should survive the rebuild");
    assert_eq!(parent_status, "pending");

    // All four indexes exist in sqlite_master.
    let index_names: HashSet<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'authoring_proposals'")
        .expect("sqlite_master query should prepare")
        .query_map([], |row| row.get::<_, String>(0))
        .expect("sqlite_master query should run")
        .collect::<Result<HashSet<_>, _>>()
        .expect("sqlite_master rows should read");
    for expected in [
        "idx_authoring_proposals_run_status",
        "idx_authoring_proposals_epic_status",
        "idx_authoring_proposals_parent",
        "idx_authoring_proposals_project_status",
    ] {
        assert!(index_names.contains(expected), "expected index {expected:?} to exist after the rebuild, found {index_names:?}");
    }

    // The new CHECK values are now accepted.
    let now = "2026-01-02T00:00:00Z";
    conn.execute(
        "INSERT INTO authoring_proposals (
            id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
            parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
            created_by, created_at, decided_by, decided_at, rationale, origin_log_offset,
            duplicate_of, duplicate_score
        ) VALUES (?1, ?2, ?3, NULL, 'create', 'issue', NULL, NULL, '82', ?4, 'pending', NULL, \
            NULL, ?5, ?6, NULL, NULL, ?7, 0, NULL, NULL)",
        params![
            new_id(),
            agent_run_id,
            project_id,
            serde_json::json!({"kind": "issue", "title": "A bug", "body": null, "issue_kind": "bug"}).to_string(),
            local_human_actor_id(&conn).unwrap(),
            now,
            "found while executing",
        ],
    )
    .expect("an INSERT with target_type = 'issue' should now be accepted");

    conn.execute(
        "UPDATE authoring_proposals SET status = 'deferred' WHERE id = ?1",
        params![parent_proposal_id],
    )
    .expect("an UPDATE setting status = 'deferred' should now be accepted");
}

// ---------------------------------------------------------------------------------------------
// Migration 0023 (DRFT-05, D-14, D-15): `estimate` is dropped from `tasks` and `epics` by full
// table rebuild.
// ---------------------------------------------------------------------------------------------

const TASK_COLS: &str = "id, project_id, epic_id, key, title, description, status, rank, priority, \
                         assignee_id, created_by, created_at, updated_at";
const EPIC_COLS: &str = "id, project_id, key, title, description, status, rank, priority, \
                         assignee_id, integration_branch, archived_at, created_by, created_at, updated_at";
const ANCHOR_COLS: &str = "criterion_id, path, side, line_start, line_end, sha, created_by, created_at";

/// Every row of `sql` as debug-formatted values, so two snapshots compare byte-for-byte.
fn dump(conn: &Connection, sql: &str) -> Vec<Vec<String>> {
    let mut stmt = conn.prepare(sql).expect("dump query should prepare");
    let width = stmt.column_count();
    stmt.query_map([], |row| {
        (0..width).map(|i| row.get::<_, rusqlite::types::Value>(i).map(|v| format!("{v:?}"))).collect()
    })
    .expect("dump query should run")
    .collect::<Result<Vec<_>, _>>()
    .expect("dump rows should read")
}

fn columns_of(conn: &Connection, table: &str) -> Vec<String> {
    conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))
        .expect("table_info should prepare")
        .query_map([], |row| row.get::<_, String>(0))
        .expect("table_info should run")
        .collect::<Result<Vec<_>, _>>()
        .expect("table_info rows should read")
}

fn assert_estimate_gone(conn: &Connection) {
    for table in ["tasks", "epics"] {
        let cols = columns_of(conn, table);
        assert!(!cols.is_empty(), "{table} must still exist after the rebuild");
        assert!(
            !cols.iter().any(|c| c == "estimate"),
            "{table} must not retain the dropped column, found {cols:?}"
        );
        assert!(cols.iter().any(|c| c == "priority"), "{table} keeps priority (D-16)");
    }
}

fn assert_foreign_keys_clean(conn: &Connection) {
    let violations = dump(conn, "SELECT * FROM pragma_foreign_key_check");
    assert!(violations.is_empty(), "PRAGMA foreign_key_check must return no rows, got {violations:?}");
}

/// D-15: Phase 16's RECD-04 is conditional on `criterion_anchors` rows surviving a `tasks`
/// rebuild. This is that proof, named so RECD-04 can cite it. T-13-10, T-13-11.
#[test]
fn migration_0023_rebuild_preserves_criterion_anchors() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let (task_id, criterion_id, tasks_before, epics_before, anchors_before) = {
        let mut conn = build_n_minus_1_fixture(&db_path);
        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
        let project = create_project(&mut conn, &actor_id, "Anchors", "/repo", "ANC", "main")
            .expect("create_project should succeed");
        let epic = create_epic(&mut conn, &project.id, &actor_id, "An epic", Some("with words"))
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "An anchored task", Some(&epic.id))
            .expect("create_task should succeed");
        let criterion = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "It works", None)
            .expect("create_criterion should succeed");

        // Values that are about to be discarded, plus values that must survive untouched.
        conn.execute("UPDATE tasks SET estimate = 2, priority = 3, status = 'in_review' WHERE id = ?1", params![task.id])
            .expect("failed to seed the task");
        conn.execute("UPDATE epics SET estimate = 3, priority = 1 WHERE id = ?1", params![epic.id])
            .expect("failed to seed the epic");
        conn.execute(
            "INSERT INTO criterion_anchors (criterion_id, path, side, line_start, line_end, sha, created_by, created_at)
             VALUES (?1, 'src/lib.rs', 'old', 12, 18, '0123456789abcdef0123456789abcdef01234567', ?2, '2026-02-03T04:05:06Z')",
            params![criterion.id, actor_id],
        )
        .expect("failed to insert the fixture anchor");

        let tasks_before = dump(&conn, &format!("SELECT {TASK_COLS} FROM tasks"));
        let epics_before = dump(&conn, &format!("SELECT {EPIC_COLS} FROM epics"));
        let anchors_before = dump(&conn, &format!("SELECT {ANCHOR_COLS} FROM criterion_anchors"));
        assert_eq!(anchors_before.len(), 1);
        (task.id, criterion.id, tasks_before, epics_before, anchors_before)
    };

    let conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should apply 0023");

    assert_estimate_gone(&conn);
    assert_eq!(dump(&conn, &format!("SELECT {ANCHOR_COLS} FROM criterion_anchors")), anchors_before,
        "the criterion_anchors row must survive the tasks rebuild byte-identical");
    assert_eq!(dump(&conn, &format!("SELECT {TASK_COLS} FROM tasks")), tasks_before,
        "every non-estimate task column must be byte-identical");
    assert_eq!(dump(&conn, &format!("SELECT {EPIC_COLS} FROM epics")), epics_before,
        "every non-estimate epic column must be byte-identical");

    // The chain the rebuild must not break: anchor -> criterion -> task, still joinable.
    let joined: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM criterion_anchors a
               JOIN acceptance_criteria c ON c.id = a.criterion_id
               JOIN tasks t ON t.id = c.parent_id
              WHERE a.criterion_id = ?1 AND t.id = ?2",
            params![criterion_id, task_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(joined, 1);
    assert_foreign_keys_clean(&conn);

    // D-18: the destructive rebuild ran behind a restorable pre-migration backup.
    assert_eq!(backup_file_count(&backups_dir), 1, "the pre-migration backup must exist");
}

#[test]
fn migration_0023_applies_to_a_fresh_database() {
    let dir = scratch_dir();
    let conn = open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("a fresh database should migrate to latest");
    assert_estimate_gone(&conn);
    assert_foreign_keys_clean(&conn);
}

#[test]
fn migration_0023_rebuilds_empty_tables_cleanly() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    drop(build_n_minus_1_fixture(&db_path));

    let conn = open_and_migrate(&db_path, &dir.path().join("backups"))
        .expect("an N-1 database with empty tasks and epics should migrate");
    assert_estimate_gone(&conn);
    for table in ["tasks", "epics"] {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }
    assert_foreign_keys_clean(&conn);
}

#[test]
fn migration_0023_preserves_task_rank_order() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");

    let order_sql = "SELECT id FROM tasks ORDER BY rank ASC";
    let before = {
        let mut conn = build_n_minus_1_fixture(&db_path);
        let actor_id = local_human_actor_id(&conn).unwrap();
        let project = create_project(&mut conn, &actor_id, "Order", "/repo", "ORD", "main").unwrap();
        // Created in one order, ranked in another, so rank order differs from insertion order.
        // `create_task` parses existing ranks, so re-rank only after all five exist.
        let ids: Vec<String> = (0..5)
            .map(|i| create_task(&mut conn, &project.id, &actor_id, &format!("task {i}"), None).unwrap().id)
            .collect();
        for (id, rank) in ids.iter().zip(["e", "b", "d", "a", "c"]) {
            conn.execute("UPDATE tasks SET rank = ?1 WHERE id = ?2", params![rank, id]).unwrap();
        }
        let before = dump(&conn, order_sql);
        assert_eq!(before.len(), 5);
        before
    };

    let conn = open_and_migrate(&db_path, &dir.path().join("backups")).unwrap();
    assert_eq!(dump(&conn, order_sql), before, "rank order must be identical after the rebuild");
    assert_eq!(
        dump(&conn, "SELECT rank FROM tasks ORDER BY rank ASC"),
        ["a", "b", "c", "d", "e"].map(|r| vec![format!("Text({r:?})")]).to_vec(),
        "rank values themselves must be preserved"
    );
}

/// The rebuild drops each table's FTS5 sync triggers along with the table; migration 0023 must
/// re-create them and keep every `rowid`, or search silently goes stale (BOARD-06).
#[test]
fn migration_0023_keeps_search_in_sync() {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    {
        let mut conn = build_n_minus_1_fixture(&db_path);
        let actor_id = local_human_actor_id(&conn).unwrap();
        let project = create_project(&mut conn, &actor_id, "Search", "/repo", "SRC", "main").unwrap();
        create_task(&mut conn, &project.id, &actor_id, "zebrafish before", None).unwrap();
        create_epic(&mut conn, &project.id, &actor_id, "narwhal before", None).unwrap();
    }

    let mut conn = open_and_migrate(&db_path, &dir.path().join("backups")).unwrap();
    let hits = |conn: &Connection, table: &str, word: &str| -> i64 {
        conn.query_row(
            &format!("SELECT COUNT(*) FROM {table}_fts WHERE {table}_fts MATCH ?1"),
            params![word],
            |r| r.get(0),
        )
        .unwrap()
    };
    // A row that existed before the rebuild is still found...
    assert_eq!(hits(&conn, "tasks", "zebrafish"), 1);
    assert_eq!(hits(&conn, "epics", "narwhal"), 1);

    // ...and a row written after it is found too, through the re-created triggers.
    let actor_id = local_human_actor_id(&conn).unwrap();
    let project_id: String = conn.query_row("SELECT id FROM projects", [], |r| r.get(0)).unwrap();
    create_task(&mut conn, &project_id, &actor_id, "quokka after", None).unwrap();
    create_epic(&mut conn, &project_id, &actor_id, "axolotl after", None).unwrap();
    assert_eq!(hits(&conn, "tasks", "quokka"), 1);
    assert_eq!(hits(&conn, "epics", "axolotl"), 1);

    // The three indexes per table that DROP TABLE destroyed are back.
    let indexes: HashSet<String> = dump(
        &conn,
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('tasks', 'epics')",
    )
    .into_iter()
    .map(|r| r[0].trim_start_matches("Text(\"").trim_end_matches("\")").to_string())
    .collect();
    for expected in ["idx_epics_project_status_rank", "idx_tasks_project_status_rank", "idx_tasks_project_epic"] {
        assert!(indexes.contains(expected), "expected index {expected:?}, found {indexes:?}");
    }
}
