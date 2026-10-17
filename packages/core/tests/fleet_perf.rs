//! Behavior under test (Phase 10 plan 10-01, T-10-01-03; 01-UI-SPEC.md "Performance Contract"):
//! - At 5,000 `sessions` rows spread across four projects (a realistic mix of live, acknowledged-
//!   terminal and unacknowledged-terminal sessions), the cross-project fleet read returns in under
//!   50ms server-side, and its query plan names `idx_sessions_fleet` rather than scanning `sessions`.
//!
//! This machine's actual timing is printed (`--nocapture`) so a slower runner's numbers are visible.

use std::time::Instant;

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::ids::new_id;
use core::query::fleet::{fleet_rows, FLEET_ROWS_MAX_LIMIT, FLEET_SQL};
use rusqlite::{params, Connection};

/// The UI-SPEC target, reported but not asserted: a wall-clock assertion this tight fails on any
/// slow or contended runner for reasons unrelated to the query (WR-10). The query-plan assertions
/// below are what prove the property (index used, no scan); the asserted ceiling is a generous
/// multiple that still catches an accidental full scan or an N+1 on a 5,000-row table.
const TARGET_MS: u128 = 50;
const BUDGET_MS: u128 = 500;
const PROJECTS: usize = 4;
const STORIES_PER_PROJECT: usize = 250;
const RUNS_PER_STORY: usize = 4; // 1,000 Stories x 4 = 4,000 sessions
const HISTORIC_ACKNOWLEDGED: usize = 500;
const EXTRA: usize = 500; // 4,000 + 500 + 500 = 5,000 rows in total

struct Seeded {
    conn: Connection,
    _dir: tempfile::TempDir,
}

fn seed() -> Seeded {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let mut conn = open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("open_and_migrate should succeed");

    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let tx = conn.transaction().expect("failed to open the seeding transaction");
    let ts = "2025-01-01T00:00:00Z";
    let mut story_ids: Vec<(String, String)> = Vec::new(); // (project, story)
    for p in 0..PROJECTS {
        let project_id = new_id();
        tx.execute(
            "INSERT INTO projects (id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, 'main', 0, 'active', ?5, ?6)",
            params![project_id, format!("P{p}"), format!("Project {p}"), format!("/repo/{p}"), actor_id, ts],
        )
        .unwrap();
        let milestone_id = new_id();
        tx.execute(
            "INSERT INTO milestones (id, project_id, title, state, rank, created_by, created_at, updated_at)
             VALUES (?1, ?2, 'Milestone', 'ready', 'a0', ?3, ?4, ?4)",
            params![milestone_id, project_id, actor_id, ts],
        )
        .unwrap();
        let epic_id = new_id();
        tx.execute(
            "INSERT INTO epics (id, project_id, milestone_id, key, title, state, rank, created_by, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'Epic', 'ready', 'a0', ?5, ?6, ?6)",
            params![epic_id, project_id, milestone_id, format!("P{p}-E"), actor_id, ts],
        )
        .unwrap();
        for t in 0..STORIES_PER_PROJECT {
            let story_id = new_id();
            let state = if t % 3 == 0 { "merged" } else { "in_review" };
            tx.execute(
                "INSERT INTO stories (id, project_id, epic_id, key, title, state, rank, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![story_id, project_id, epic_id, format!("P{p}-{t}"), format!("story {p}-{t}"), state, format!("{t:08}"), actor_id, ts],
            )
            .unwrap();
            story_ids.push((project_id.clone(), story_id));
        }
    }

    let insert_run = |project_id: &str, story_id: &str, status: &str, n: usize, ack: Option<&str>| {
        let started = format!("2025-03-{:02}T{:02}:{:02}:00Z", (n / 1440) % 28 + 1, (n / 60) % 24, n % 60);
        let ended = if status == "running" || status == "blocked" || status == "abandoned" { None } else { Some(started.clone()) };
        tx.execute(
            "INSERT INTO sessions (id, story_id, project_id, adapter, actor_id, status, permission_mode,
                log_path, started_at, ended_at, acknowledged_at, cost_usd)
             VALUES (?1, ?2, ?3, 'claude_code', ?4, ?5, 'acceptEdits', '/dev/null', ?6, ?7, ?8, 0.5)",
            params![new_id(), story_id, project_id, actor_id, status, started, ended, ack],
        )
        .unwrap();
    };

    // 500 old acknowledged terminal sessions: history the fleet must skip past. Seeded FIRST so
    // they are the oldest sessions of their Story, as real history is.
    let mut n = 0usize;
    for h in 0..HISTORIC_ACKNOWLEDGED {
        let (project_id, story_id) = &story_ids[h % story_ids.len()];
        let status = ["completed", "failed", "interrupted"][h % 3];
        insert_run(project_id, story_id, status, n, Some("2025-03-30T00:00:00Z"));
        n += 1;
    }
    // Four sessions per Story: three old acknowledged terminal sessions, then one latest session
    // whose status cycles through the mix a real fleet holds.
    for (i, (project_id, story_id)) in story_ids.iter().enumerate() {
        for _ in 0..(RUNS_PER_STORY - 1) {
            insert_run(project_id, story_id, "completed", n, Some("2025-03-30T00:00:00Z"));
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
        insert_run(project_id, story_id, status, n, ack);
        n += 1;
    }
    // 500 more sessions spread over the Stories, half of them live.
    for l in 0..EXTRA {
        let (project_id, story_id) = &story_ids[l % story_ids.len()];
        let status = if l % 2 == 0 { "running" } else { "completed" };
        let ack = if l % 2 == 0 { None } else { Some("2025-03-30T00:00:00Z") };
        insert_run(project_id, story_id, status, n, ack);
        n += 1;
    }
    tx.commit().expect("failed to commit the seed");
    Seeded { conn, _dir: dir }
}

#[test]
fn the_fleet_read_at_5000_runs_is_under_budget_and_uses_the_index() {
    let seeded = seed();
    let total: i64 = seeded.conn.query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0)).unwrap();
    assert_eq!(total, 5000, "the fixture must hold exactly 5,000 sessions rows");

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
    println!(
        "fleet_rows at 5,000 sessions: {elapsed_ms}ms (target {TARGET_MS}ms, asserted {BUDGET_MS}ms), {} rows",
        list.total_rows
    );
    println!("query plan: {plan:#?}");

    assert_eq!(list.total_rows, FLEET_ROWS_MAX_LIMIT, "a busy fleet fills the window");
    assert!(elapsed_ms < BUDGET_MS, "fleet_rows took {elapsed_ms}ms, budget is {BUDGET_MS}ms");
    assert!(
        plan.iter().any(|line| line.contains("idx_sessions_fleet")),
        "the fleet read must use idx_sessions_fleet, plan was: {plan:?}"
    );
    assert!(
        !plan.iter().any(|line| line.trim_start().starts_with("SCAN ar") || line.trim_start() == "SCAN sessions"),
        "the fleet read must not full-scan sessions, plan was: {plan:?}"
    );
}
