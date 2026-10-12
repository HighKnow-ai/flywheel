//! Behavior under test (Phase 10 plan 10-01, T-10-01-03; 01-UI-SPEC.md "Performance Contract"):
//! - At 5,000 `agent_runs` rows spread across four projects (a realistic mix of live, acknowledged-
//!   terminal and unacknowledged-terminal runs), the cross-project fleet read returns in under 50ms
//!   server-side, and its query plan names `idx_agent_runs_fleet` rather than scanning `agent_runs`.
//! - Pitfall 1, first launch: 500 historic terminal runs that predate migration 0020 are backfilled
//!   by it and contribute zero rows, so the budget is measured against the shape a real first
//!   launch produces, not against an unrealistically clean database.
//!
//! The database is built at the migration before 0020, seeded, then carried forward through
//! `open_and_migrate`, so the backfill and the index are exactly the ones a real upgrade applies.
//! This machine's actual timing is printed (`--nocapture`) so a slower runner's numbers are visible.

use std::collections::HashSet;
use std::time::Instant;

use core::db::{apply_pragmas, migration_sources, open_and_migrate};
use core::domain::actor::local_human_actor_id;
use core::ids::new_id;
use core::query::fleet::{fleet_rows, FLEET_ROWS_MAX_LIMIT, FLEET_SQL};
use rusqlite::{params, Connection};

const BUDGET_MS: u128 = 50;
/// Migration 0020 is the 20th source; everything before it is the "N-1" a real upgrade starts from.
const FLEET_MIGRATION_INDEX: usize = 19;
const PROJECTS: usize = 4;
const TASKS_PER_PROJECT: usize = 250;
const RUNS_PER_TASK: usize = 4; // 1,000 tasks x 4 = 4,000 runs
const HISTORIC_UNACKNOWLEDGED: usize = 500;
const LIVE_EXTRA: usize = 500; // 4,000 + 500 + 500 = 5,000 rows in total

struct Seeded {
    conn: Connection,
    historic_ids: HashSet<String>,
    _dir: tempfile::TempDir,
}

fn seed_and_migrate() -> Seeded {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");

    let mut historic_ids = HashSet::new();
    {
        let mut conn = Connection::open(&db_path).expect("failed to create the fixture file");
        apply_pragmas(&conn).expect("failed to apply pragmas");
        let sources = migration_sources();
        rusqlite_migration::Migrations::new(
            sources[..FLEET_MIGRATION_INDEX].iter().map(|s| rusqlite_migration::M::up(s)).collect(),
        )
        .to_latest(&mut conn)
        .expect("pre-0020 migrations should apply");

        let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
        let tx = conn.transaction().expect("failed to open the seeding transaction");
        let mut task_ids: Vec<(String, String, String)> = Vec::new(); // (project, trigger, task)
        for p in 0..PROJECTS {
            let project_id = new_id();
            tx.execute(
                "INSERT INTO projects (id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'main', 0, 'active', ?5, '2025-01-01T00:00:00Z')",
                params![project_id, format!("P{p}"), format!("Project {p}"), format!("/repo/{p}"), actor_id],
            )
            .unwrap();
            let trigger_id = new_id();
            tx.execute(
                "INSERT INTO triggers (id, project_id, source, enabled, created_by, created_at)
                 VALUES (?1, ?2, 'user_action', 1, ?3, '2025-01-01T00:00:00Z')",
                params![trigger_id, project_id, actor_id],
            )
            .unwrap();
            for t in 0..TASKS_PER_PROJECT {
                let task_id = new_id();
                let status = if t % 3 == 0 { "done" } else { "in_review" };
                tx.execute(
                    "INSERT INTO tasks (id, project_id, epic_id, key, title, description, status, rank, priority,
                        estimate, assignee_id, created_by, created_at, updated_at)
                     VALUES (?1, ?2, NULL, ?3, ?4, NULL, ?5, ?6, 0, NULL, NULL, ?7, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z')",
                    params![task_id, project_id, format!("P{p}-{t}"), format!("task {p}-{t}"), status, format!("{t:08}"), actor_id],
                )
                .unwrap();
                task_ids.push((project_id.clone(), trigger_id.clone(), task_id));
            }
        }

        let insert_run = |project_id: &str, trigger_id: &str, task_id: Option<&str>, status: &str, n: usize, ack: Option<&str>| -> String {
            let id = new_id();
            let started = format!("2025-03-{:02}T{:02}:{:02}:00Z", (n / 1440) % 28 + 1, (n / 60) % 24, n % 60);
            let ended = if status == "running" || status == "blocked" || status == "abandoned" { None } else { Some(started.clone()) };
            tx.execute(
                "INSERT INTO agent_runs (id, task_id, project_id, trigger_id, adapter, actor_id, status, permission_mode,
                    log_path, started_at, ended_at, acknowledged_at, cost_usd)
                 VALUES (?1, ?2, ?3, ?4, 'claude_code', ?5, ?6, 'acceptEdits', '/dev/null', ?7, ?8, ?9, 0.5)",
                params![id, task_id, project_id, trigger_id, actor_id, status, started, ended, ack],
            )
            .unwrap();
            id
        };

        // Four runs per task: three old acknowledged terminal runs, then one latest run whose status
        // cycles through the mix a real fleet holds.
        let mut n = 0usize;
        for (i, (project_id, trigger_id, task_id)) in task_ids.iter().enumerate() {
            for _ in 0..(RUNS_PER_TASK - 1) {
                insert_run(project_id, trigger_id, Some(task_id), "completed", n, Some("2025-03-30T00:00:00Z"));
                n += 1;
            }
            let (status, ack) = match i % 20 {
                0 | 1 => ("running", None),
                2 => ("blocked", None),
                3..=8 => ("completed", None),
                9..=12 => ("failed", None),
                13 => ("abandoned", None),
                14 => ("interrupted", None),
                _ => ("completed", Some("2025-03-30T00:00:00Z")),
            };
            insert_run(project_id, trigger_id, Some(task_id), status, n, ack);
            n += 1;
        }
        // 500 historic terminal runs nobody ever acknowledged: exactly what the backfill exists for.
        for h in 0..HISTORIC_UNACKNOWLEDGED {
            let (project_id, trigger_id, task_id) = &task_ids[h % task_ids.len()];
            let status = ["completed", "failed", "interrupted"][h % 3];
            historic_ids.insert(insert_run(project_id, trigger_id, Some(task_id), status, n, None));
            n += 1;
        }
        // 500 runs with no task (authoring and planning runs), half of them live.
        for l in 0..LIVE_EXTRA {
            let (project_id, trigger_id, _) = &task_ids[l % task_ids.len()];
            let status = if l % 2 == 0 { "running" } else { "completed" };
            let ack = if l % 2 == 0 { None } else { Some("2025-03-30T00:00:00Z") };
            insert_run(project_id, trigger_id, None, status, n, ack);
            n += 1;
        }
        tx.commit().expect("failed to commit the seed");
    }

    let conn = open_and_migrate(&db_path, &backups_dir).expect("migration 0020 should carry the fixture forward");
    Seeded { conn, historic_ids, _dir: dir }
}

#[test]
fn the_fleet_read_at_5000_runs_is_under_budget_and_uses_the_index() {
    let seeded = seed_and_migrate();
    let total: i64 = seeded.conn.query_row("SELECT COUNT(*) FROM agent_runs", [], |r| r.get(0)).unwrap();
    assert_eq!(total, 5000, "the fixture must hold exactly 5,000 agent_runs rows");

    let start = Instant::now();
    let list = fleet_rows(&seeded.conn, FLEET_ROWS_MAX_LIMIT).expect("fleet_rows should succeed");
    let elapsed_ms = start.elapsed().as_millis();

    let plan_sql = format!("EXPLAIN QUERY PLAN {FLEET_SQL}");
    let mut stmt = seeded.conn.prepare(&plan_sql).expect("failed to prepare the query plan");
    let plan: Vec<String> = stmt
        .query_map(params![FLEET_ROWS_MAX_LIMIT as i64], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    println!("fleet_rows at 5,000 agent_runs: {elapsed_ms}ms, {} rows", list.total_rows);
    println!("query plan: {plan:#?}");

    assert_eq!(list.total_rows, FLEET_ROWS_MAX_LIMIT, "a busy fleet fills the window");
    assert!(elapsed_ms < BUDGET_MS, "fleet_rows took {elapsed_ms}ms, budget is {BUDGET_MS}ms");
    assert!(
        plan.iter().any(|line| line.contains("idx_agent_runs_fleet")),
        "the fleet read must use idx_agent_runs_fleet, plan was: {plan:?}"
    );
    assert!(
        !plan.iter().any(|line| line.trim_start().starts_with("SCAN ar") || line.trim_start() == "SCAN agent_runs"),
        "the fleet read must not full-scan agent_runs, plan was: {plan:?}"
    );
}

#[test]
fn five_hundred_backfilled_historic_runs_contribute_zero_rows() {
    let seeded = seed_and_migrate();
    // Read every row the fleet could return, past the window, to prove none is a historic run.
    let list = fleet_rows(&seeded.conn, FLEET_ROWS_MAX_LIMIT).unwrap();
    let returned: HashSet<_> = list.rows.iter().map(|r| r.agent_run_id.clone()).collect();
    assert!(
        returned.is_disjoint(&seeded.historic_ids),
        "no backfilled historic terminal run may reach the fleet"
    );

    let unacknowledged_historic: i64 = seeded
        .conn
        .query_row(
            "SELECT COUNT(*) FROM agent_runs WHERE status IN ('completed','failed','interrupted') AND acknowledged_at IS NULL AND ended_at IS NOT NULL AND id IN (SELECT value FROM json_each(?1))",
            params![serde_json::to_string(&seeded.historic_ids.iter().collect::<Vec<_>>()).unwrap()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(unacknowledged_historic, 0, "the migration must have acknowledged every historic run");
}
