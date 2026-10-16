//! Phase 15 plan 05 Task 1 (DRFT-01, D-19, T-15-21): who declared a task's file-set is derived from
//! the `task.file_set_declared` event's actor, never stored.
//!
//! Over a real migrated database and the real writers: the planner's `store_submitted_plan` stamps
//! the agent actor, the developer's `declare_file_set` stamps the human one, and the read must tell
//! them apart from the log alone.

mod common;

use core::domain::dispatch_plan::{store_submitted_plan, SubmittedPlan, SubmittedTask};
use core::domain::epic::create_epic;
use core::domain::file_set::declare_file_set;
use core::domain::task::create_task;
use core::file_set::parse_entry;
use core::query::file_set_provenance::{file_set_provenance, FILE_SET_HISTORY_LIMIT};
use rusqlite::{params, Connection};

const NOW: &str = "2026-10-16T00:00:00Z";

struct Fx {
    conn: Connection,
    human: String,
    agent: String,
    epic_id: String,
    run_id: String,
    /// `(id, key)` in board-rank order.
    tasks: Vec<(String, String)>,
}

fn fx(n: usize) -> Fx {
    let (mut conn, human, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &human, "Epic", None).unwrap();
    let mut tasks = Vec::new();
    for i in 0..n {
        let t = create_task(&mut conn, &project.id, &human, &format!("T{i}"), Some(&epic.id)).unwrap();
        let key: String = conn.query_row("SELECT key FROM tasks WHERE id = ?1", [&t.id], |r| r.get(0)).unwrap();
        tasks.push((t.id, key));
    }
    let agent = core::domain::agent_run::agent_actor_id(&conn).unwrap();
    let run_id = core::ids::new_id();
    let trigger = core::ids::new_id();
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, config, enabled, last_fired_at, created_by, created_at)
         VALUES (?1, ?2, NULL, ?3, 'user_action', NULL, 1, ?4, ?5, ?4)",
        params![trigger, project.id, epic.id, NOW, human],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_runs (id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            permission_mode, log_path, started_at, authoring_stage)
         VALUES (?1, NULL, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', 'default', '/dev/null', ?6, NULL)",
        params![run_id, epic.id, project.id, trigger, agent, NOW],
    )
    .unwrap();
    Fx { conn, human, agent, epic_id: epic.id, run_id, tasks }
}

fn planned(key: &str, files: &[&str], undeclared: bool) -> SubmittedTask {
    SubmittedTask {
        key: key.to_string(),
        files: files.iter().map(|f| f.to_string()).collect(),
        wave: 1,
        rationale: String::new(),
        undeclared,
    }
}

/// The planner submits one plan covering every task of the epic, as the agent actor.
fn planner_declares(f: &mut Fx, tasks: Vec<SubmittedTask>) {
    store_submitted_plan(
        &mut f.conn,
        &f.run_id,
        &f.epic_id,
        &SubmittedPlan { tasks, excluded: Vec::new() },
        &f.agent,
        NOW,
    )
    .expect("the plan is stored");
}

fn human_declares(f: &mut Fx, task: usize, files: &[&str]) {
    let entries: Vec<_> = files.iter().map(|p| parse_entry(p).unwrap()).collect();
    declare_file_set(&mut f.conn, &f.tasks[task].0, &entries, &f.human).unwrap();
}

#[test]
fn a_set_the_planner_declared_reads_as_agent_drafted_with_the_agents_name() {
    let mut f = fx(1);
    let k0 = f.tasks[0].1.clone();
    planner_declares(&mut f, vec![planned(&k0, &["src/a.rs", "docs/"], false)]);

    let p = file_set_provenance(&f.conn, &f.tasks[0].0).unwrap().expect("a declaration exists");

    assert!(p.latest.agent_drafted);
    assert_eq!(p.latest.actor_kind, "agent");
    assert_eq!(p.latest.actor_id, f.agent);
    let name: String =
        f.conn.query_row("SELECT display_name FROM actors WHERE id = ?1", [&f.agent], |r| r.get(0)).unwrap();
    assert_eq!(p.latest.actor_name, name);
    assert_eq!(p.latest.entries, vec!["src/a.rs".to_string(), "docs/".to_string()]);
    assert!(!p.latest.undeclared);
}

#[test]
fn a_human_redeclaration_clears_the_agent_mark_but_the_history_keeps_it() {
    let mut f = fx(1);
    let k0 = f.tasks[0].1.clone();
    planner_declares(&mut f, vec![planned(&k0, &["src/a.rs"], false)]);
    human_declares(&mut f, 0, &["src/b.rs"]);

    let p = file_set_provenance(&f.conn, &f.tasks[0].0).unwrap().unwrap();

    assert!(!p.latest.agent_drafted, "the latest declaration is the human's");
    assert_eq!(p.latest.actor_id, f.human);
    assert_eq!(p.latest.before, vec!["src/a.rs".to_string()]);
    assert_eq!(p.history.len(), 1);
    assert!(p.history[0].agent_drafted, "the older declaration was the planner's and stays so");
    assert_eq!(p.history[0].entries, vec!["src/a.rs".to_string()]);
}

#[test]
fn an_undeclared_task_is_distinguishable_from_one_declared_empty() {
    let mut f = fx(2);
    let (k0, k1) = (f.tasks[0].1.clone(), f.tasks[1].1.clone());
    planner_declares(&mut f, vec![planned(&k0, &[], true), planned(&k1, &["src/a.rs"], false)]);
    human_declares(&mut f, 1, &[]); // declared, then cleared: an empty list, not an unknown one

    let undeclared = file_set_provenance(&f.conn, &f.tasks[0].0).unwrap().unwrap();
    assert!(undeclared.latest.undeclared);
    assert!(undeclared.latest.entries.is_empty());
    assert!(undeclared.latest.agent_drafted, "the planner is the one who said it could not tell");

    let cleared = file_set_provenance(&f.conn, &f.tasks[1].0).unwrap().unwrap();
    assert!(!cleared.latest.undeclared);
    assert!(cleared.latest.entries.is_empty());
}

#[test]
fn a_task_nobody_declared_has_no_provenance_rather_than_a_human_one() {
    let f = fx(1);
    assert_eq!(file_set_provenance(&f.conn, &f.tasks[0].0).unwrap(), None);
}

#[test]
fn nothing_is_stored_the_migration_count_is_unchanged_and_no_column_carries_the_mark() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let migrations = std::fs::read_dir(manifest.join("src/db/migrations")).unwrap().count();
    assert_eq!(migrations, 24, "a stored provenance column would arrive as a new migration");

    // Spelled in two halves so this file never names the column it asserts is absent.
    let column = ["drafted", "by"].join("_");
    let mut stack = vec![manifest.join("src")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs" || e == "sql") {
                let text = std::fs::read_to_string(&path).unwrap();
                assert!(!text.contains(&column), "{} names a stored `{column}`", path.display());
            }
        }
    }
}

#[test]
fn the_history_read_is_bounded_and_says_when_it_cut() {
    let mut f = fx(1);
    for i in 0..50 {
        human_declares(&mut f, 0, &[&format!("f{i}.rs")]);
    }

    let p = file_set_provenance(&f.conn, &f.tasks[0].0).unwrap().unwrap();

    assert_eq!(p.latest.entries, vec!["f49.rs".to_string()], "newest first");
    assert_eq!(p.history.len(), FILE_SET_HISTORY_LIMIT);
    assert!(p.history_truncated);
    assert_eq!(p.history[0].entries, vec!["f48.rs".to_string()]);

    // A task within the limit is not reported as cut.
    let mut g = fx(1);
    human_declares(&mut g, 0, &["a.rs"]);
    human_declares(&mut g, 0, &["b.rs"]);
    let small = file_set_provenance(&g.conn, &g.tasks[0].0).unwrap().unwrap();
    assert!(!small.history_truncated);
}

// --- plan approval is the accept (D-18, T-15-26) ---------------------------------------------

#[test]
fn approving_a_plan_freezes_the_edges_but_stages_nothing_and_keeps_the_planners_attribution() {
    let mut f = fx(2);
    let (k0, k1) = (f.tasks[0].1.clone(), f.tasks[1].1.clone());
    let plan_id = store_submitted_plan(
        &mut f.conn,
        &f.run_id,
        &f.epic_id,
        &SubmittedPlan {
            tasks: vec![planned(&k0, &["src/a.rs"], false), planned(&k1, &["src/a.rs", "docs/"], false)],
            excluded: Vec::new(),
        },
        &f.agent,
        NOW,
    )
    .expect("the plan is stored");

    // Live at draft time, restrictive only: F10's observation, stated as intended behaviour.
    let live = core::domain::file_set::list_entries_for_task(&f.conn, &f.tasks[0].0).unwrap();
    assert_eq!(live.len(), 1, "the declared set is readable before approval");
    let declared = |c: &Connection| -> i64 {
        c.query_row("SELECT COUNT(*) FROM events WHERE event_type = 'task.file_set_declared'", [], |r| r.get(0)).unwrap()
    };
    let before = declared(&f.conn);
    assert_eq!(before, 2);

    core::domain::dispatch_plan::approve_plan_with(&mut f.conn, &plan_id, &f.human, false, "2026-10-16T01:00:00Z")
        .expect("a draft plan approves");

    assert_eq!(declared(&f.conn), before, "approval freezes; it does not re-declare anything");
    let edges: i64 = f.conn.query_row("SELECT COUNT(*) FROM dispatch_edges WHERE plan_id = ?1", [&plan_id], |r| r.get(0)).unwrap();
    assert_eq!(edges, 1, "the colliding pair was frozen");
    for (task_id, _) in &f.tasks {
        let p = file_set_provenance(&f.conn, task_id).unwrap().unwrap();
        assert!(p.latest.agent_drafted, "the human's approval did not take authorship of the planner's set");
    }
}
