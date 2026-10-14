//! File the Phase 11 register's survivors onto the board (plan 11-21, D-196, D-207).
//!
//! Reads a JSON payload (`.planning/phases/11-ship-it/11-21-board-payload.json`) of epics, each
//! with tasks (carrying acceptance criteria) and issues, and creates them through the board's own
//! write verbs: `epic::create_epic`, `task::create_task` + `update_task` + `set_priority`,
//! `issue::create_issue`, `acceptance_criterion::create_criterion`. No hand-rolled SQL writes, so
//! every row carries the event an application-produced one does.
//!
//! The database is migrated to schema 21 and NO further. The installed 0.1.1 knows 21 migrations;
//! this branch has a 22nd (`0022_project_hidden`). Taking the owner's file to 22 would leave it
//! ahead of the app he runs. [`MAX_MIGRATIONS`] is the cap.
//!
//! Like `seed_criteria`, this tool is MEANT for the real fleet database, so without
//! `FLYWHEEL_APP_DATA_DIR` it proceeds only with `--i-mean-the-real-database`.
//! Idempotent by title within the project: an epic, task or issue that already exists is reused,
//! and an existing task gets no second set of criteria.
//!
//! Usage: `file_board_items <payload.json> [--i-mean-the-real-database]`.
//! Output, parsable: one `FILED <ref> <kind> <key> <id> <new|existing>` line per item and a final
//! `DONE epics=<n> tasks=<n> issues=<n> criteria=<n> schema=<n>`.

use core::domain::acceptance_criterion::create_criterion;
use core::domain::actor::local_human_actor_id;
use core::domain::epic::create_epic;
use core::domain::issue::{create_issue, IssueParent};
use core::domain::task::{create_task, set_priority, update_task};
use rusqlite::{params, Connection, OptionalExtension};
use rusqlite_migration::{Migrations, M};
use serde::Deserialize;

/// The schema the installed 0.1.1 understands: migrations 0001 to 0021.
const MAX_MIGRATIONS: usize = 21;
const REAL_DB_FLAG: &str = "--i-mean-the-real-database";

#[derive(Deserialize)]
struct Payload {
    project_key_prefix: String,
    epics: Vec<EpicSpec>,
}

#[derive(Deserialize)]
struct EpicSpec {
    #[serde(rename = "ref")]
    reference: String,
    title: String,
    description: String,
    criteria: Vec<String>,
    items: Vec<Item>,
}

#[derive(Deserialize)]
struct Item {
    #[serde(rename = "ref")]
    reference: String,
    kind: String,
    title: String,
    description: Option<String>,
    body: Option<String>,
    issue_kind: Option<String>,
    #[serde(default)]
    criteria: Vec<String>,
    #[serde(default)]
    priority: i64,
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn existing(conn: &Connection, table: &str, project_id: &str, title: &str) -> anyhow::Result<Option<(String, String)>> {
    // `table` is one of three literals chosen below, never input.
    let sql = format!("SELECT id, key FROM {table} WHERE project_id = ?1 AND title = ?2");
    Ok(conn.query_row(&sql, params![project_id, title], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(payload_path) = args.iter().find(|a| !a.starts_with("--")) else {
        fail("usage: file_board_items <payload.json> [--i-mean-the-real-database]");
    };
    if std::env::var_os("FLYWHEEL_APP_DATA_DIR").is_none() && !args.iter().any(|a| a == REAL_DB_FLAG) {
        fail(&format!("FLYWHEEL_APP_DATA_DIR is not set: refusing to touch the real fleet database without {REAL_DB_FLAG}"));
    }
    let payload: Payload = serde_json::from_str(&std::fs::read_to_string(payload_path).unwrap_or_else(|e| fail(&format!("cannot read {payload_path}: {e}"))))
        .unwrap_or_else(|e| fail(&format!("payload is not valid: {e}")));

    let db_path = core::db::default_db_path().unwrap_or_else(|e| fail(&format!("database path: {e:#}")));
    let backups_dir = core::db::default_backups_dir().unwrap_or_else(|e| fail(&format!("backups dir: {e:#}")));
    let capped = Migrations::new(core::db::migration_sources().into_iter().take(MAX_MIGRATIONS).map(M::up).collect());
    let mut conn = core::db::open_and_migrate_with(&db_path, &backups_dir, &capped).unwrap_or_else(|e| fail(&format!("could not open the database: {e:#}")));
    let schema: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap_or(-1);
    if schema != MAX_MIGRATIONS as i64 {
        fail(&format!("schema is {schema}, expected {MAX_MIGRATIONS}: refusing to write"));
    }
    let actor = local_human_actor_id(&conn).unwrap_or_else(|e| fail(&format!("actor: {e:#}")));

    let project_id: String = {
        let ids: Vec<String> = conn
            .prepare("SELECT id FROM projects WHERE key_prefix = ?1 AND status = 'active'")
            .and_then(|mut s| s.query_map(params![payload.project_key_prefix], |r| r.get(0))?.collect())
            .unwrap_or_else(|e| fail(&format!("project lookup: {e}")));
        if ids.len() != 1 {
            fail(&format!("expected exactly one active project with prefix {}, found {}", payload.project_key_prefix, ids.len()));
        }
        ids.into_iter().next().unwrap()
    };

    let (mut epics, mut tasks, mut issues, mut criteria) = (0, 0, 0, 0);
    for spec in &payload.epics {
        let (epic_id, epic_key, epic_new) = match existing(&conn, "epics", &project_id, &spec.title).unwrap_or_else(|e| fail(&format!("{e:#}"))) {
            Some((id, key)) => (id, key, false),
            None => {
                let e = create_epic(&mut conn, &project_id, &actor, &spec.title, Some(&spec.description)).unwrap_or_else(|e| fail(&format!("epic {}: {e:#}", spec.reference)));
                epics += 1;
                (e.id, e.key, true)
            }
        };
        println!("FILED {} epic {} {} {}", spec.reference, epic_key, epic_id, if epic_new { "new" } else { "existing" });
        if epic_new {
            for c in &spec.criteria {
                create_criterion(&mut conn, &project_id, &actor, "epic", &epic_id, c, None).unwrap_or_else(|e| fail(&format!("epic criterion {}: {e:#}", spec.reference)));
                criteria += 1;
            }
        }
        for item in &spec.items {
            match item.kind.as_str() {
                "task" => {
                    let (id, key, new) = match existing(&conn, "tasks", &project_id, &item.title).unwrap_or_else(|e| fail(&format!("{e:#}"))) {
                        Some((id, key)) => (id, key, false),
                        None => {
                            let t = create_task(&mut conn, &project_id, &actor, &item.title, Some(&epic_id)).unwrap_or_else(|e| fail(&format!("task {}: {e:#}", item.reference)));
                            if let Some(d) = &item.description {
                                update_task(&mut conn, &actor, &t.id, None, Some(d)).unwrap_or_else(|e| fail(&format!("task description {}: {e:#}", item.reference)));
                            }
                            if item.priority != 0 {
                                set_priority(&mut conn, &actor, &t.id, item.priority).unwrap_or_else(|e| fail(&format!("task priority {}: {e:#}", item.reference)));
                            }
                            for c in &item.criteria {
                                create_criterion(&mut conn, &project_id, &actor, "task", &t.id, c, None).unwrap_or_else(|e| fail(&format!("task criterion {}: {e:#}", item.reference)));
                                criteria += 1;
                            }
                            tasks += 1;
                            (t.id, t.key, true)
                        }
                    };
                    println!("FILED {} task {} {} {}", item.reference, key, id, if new { "new" } else { "existing" });
                }
                "issue" => {
                    let (id, key, new) = match existing(&conn, "issues", &project_id, &item.title).unwrap_or_else(|e| fail(&format!("{e:#}"))) {
                        Some((id, key)) => (id, key, false),
                        None => {
                            let kind = item.issue_kind.as_deref().unwrap_or("question");
                            let i = create_issue(&mut conn, &project_id, &actor, &item.title, item.body.as_deref(), kind, IssueParent::Epic(epic_id.clone()))
                                .unwrap_or_else(|e| fail(&format!("issue {}: {e:#}", item.reference)));
                            issues += 1;
                            (i.id, i.key, true)
                        }
                    };
                    println!("FILED {} issue {} {} {}", item.reference, key, id, if new { "new" } else { "existing" });
                }
                other => fail(&format!("item {}: unknown kind {other:?}", item.reference)),
            }
        }
    }
    println!("DONE epics={epics} tasks={tasks} issues={issues} criteria={criteria} schema={schema}");
}
