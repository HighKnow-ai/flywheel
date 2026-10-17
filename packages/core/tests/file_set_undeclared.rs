//! Phase 15 plan 02 (DRFT-01, D-21): a planner that cannot decide a task's file-set says
//! `undeclared`, and the planning prompt hands it a real listing to decide from.
//!
//! Over a real migrated database and the real `store_submitted_plan` / `render_planning_prompt`.
//! An empty set and an undecidable one are different answers: the first is still refused, the
//! second keeps its task in the wave plan, declares nothing and records why.

mod common;

use core::domain::dispatch_plan::{
    preview_edges_with, store_submitted_plan, SubmissionRefusal, SubmittedPlan, SubmittedTask,
};
use core::domain::epic::create_epic;
use core::domain::file_set::{list_entries_for_task, EVENT_FILE_SET_DECLARED};
use core::domain::task::create_task;
use core::file_set::entry_path;
use rusqlite::{params, Connection};

const NOW: &str = "2026-10-16T00:00:00Z";

struct Fx {
    conn: Connection,
    epic_id: String,
    run_id: String,
    agent: String,
    /// `(id, key)` in board-rank order.
    tasks: Vec<(String, String)>,
}

fn fx(n: usize) -> Fx {
    let (mut conn, actor, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor, "Epic", None).unwrap();
    let mut tasks = Vec::new();
    for i in 0..n {
        let t = create_task(&mut conn, &project.id, &actor, &format!("T{i}"), Some(&epic.id)).unwrap();
        let key: String = conn.query_row("SELECT key FROM tasks WHERE id = ?1", [&t.id], |r| r.get(0)).unwrap();
        tasks.push((t.id, key));
    }
    let agent = core::domain::agent_run::agent_actor_id(&conn).unwrap();
    let run_id = core::ids::new_id();
    let trigger = core::ids::new_id();
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, config, enabled, last_fired_at, created_by, created_at)
         VALUES (?1, ?2, NULL, ?3, 'user_action', NULL, 1, ?4, ?5, ?4)",
        params![trigger, project.id, epic.id, NOW, actor],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_runs (id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            permission_mode, log_path, started_at, authoring_stage)
         VALUES (?1, NULL, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', 'default', '/dev/null', ?6, NULL)",
        params![run_id, epic.id, project.id, trigger, agent, NOW],
    )
    .unwrap();
    Fx { conn, epic_id: epic.id, run_id, agent, tasks }
}

fn task(key: &str, files: &[&str], wave: u32, undeclared: bool) -> SubmittedTask {
    SubmittedTask {
        key: key.to_string(),
        files: files.iter().map(|f| f.to_string()).collect(),
        wave,
        rationale: String::new(),
        undeclared,
    }
}

fn submit(f: &mut Fx, tasks: Vec<SubmittedTask>) -> Result<String, SubmissionRefusal> {
    store_submitted_plan(
        &mut f.conn,
        &f.run_id,
        &f.epic_id,
        &SubmittedPlan { tasks, excluded: Vec::new() },
        &f.agent,
        NOW,
    )
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

// --- the prompt ------------------------------------------------------------------------------

// --- the declaration -------------------------------------------------------------------------

#[test]
fn an_undeclared_task_keeps_its_place_in_the_plan_declares_nothing_and_leaves_no_skipped_row() {
    let mut f = fx(3);
    let k: Vec<String> = f.tasks.iter().map(|t| t.1.clone()).collect();
    let plan_id = submit(
        &mut f,
        vec![task(&k[0], &["src/a.rs"], 1, false), task(&k[1], &[], 1, true), task(&k[2], &["docs/"], 2, false)],
    )
    .unwrap();

    assert_eq!(
        count(&f.conn, &format!("SELECT COUNT(*) FROM dispatch_plan_tasks WHERE plan_id = '{plan_id}'")),
        3
    );
    let state: String = f
        .conn
        .query_row(
            "SELECT state FROM dispatch_plan_tasks WHERE plan_id = ?1 AND task_id = ?2",
            params![plan_id, f.tasks[1].0],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(state, "planned", "undeclared must not travel the skipped path");
    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM dispatch_plan_tasks WHERE state = 'skipped'"), 0);
    assert!(list_entries_for_task(&f.conn, &f.tasks[1].0).unwrap().is_empty());
}

#[test]
fn an_undeclared_task_appends_one_declared_event_whose_after_is_null() {
    let mut f = fx(3);
    let k: Vec<String> = f.tasks.iter().map(|t| t.1.clone()).collect();
    submit(&mut f, vec![task(&k[0], &["src/a.rs"], 1, false), task(&k[1], &[], 1, true), task(&k[2], &["docs/"], 2, false)])
        .unwrap();

    let undeclared_events = count(
        &f.conn,
        &format!(
            "SELECT COUNT(*) FROM events WHERE event_type = '{EVENT_FILE_SET_DECLARED}'
               AND task_id = '{}' AND json_extract(payload, '$.after') IS NULL",
            f.tasks[1].0
        ),
    );
    assert_eq!(undeclared_events, 1);
    let label: String = f
        .conn
        .query_row(
            "SELECT json_extract(payload, '$.label') FROM events WHERE event_type = ?1 AND task_id = ?2",
            params![EVENT_FILE_SET_DECLARED, f.tasks[1].0],
            |r| r.get(0),
        )
        .unwrap();
    assert!(label.contains("could not determine"), "{label}");
    // The two declared tasks each got their own ordinary declaration, with a non-null `after`.
    assert_eq!(
        count(
            &f.conn,
            &format!(
                "SELECT COUNT(*) FROM events WHERE event_type = '{EVENT_FILE_SET_DECLARED}'
                   AND json_extract(payload, '$.after') IS NOT NULL"
            )
        ),
        2
    );
}

#[test]
fn undeclared_with_files_is_refused_malformed_and_nothing_is_stored() {
    let mut f = fx(2);
    let k: Vec<String> = f.tasks.iter().map(|t| t.1.clone()).collect();
    let refusal =
        submit(&mut f, vec![task(&k[0], &["src/a.rs"], 1, false), task(&k[1], &["src/b.rs"], 1, true)]).unwrap_err();
    match &refusal {
        SubmissionRefusal::Malformed(why) => assert!(why.contains(&k[1]) && why.contains("undeclared"), "{why}"),
        other => panic!("expected Malformed, got {other:?}"),
    }
    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM dispatch_plans"), 0);
    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM task_file_set_entries"), 0);
    assert_eq!(count(&f.conn, &format!("SELECT COUNT(*) FROM events WHERE event_type = '{EVENT_FILE_SET_DECLARED}'")), 0);
}

#[test]
fn an_empty_file_list_without_the_flag_is_still_an_empty_file_list() {
    let mut f = fx(2);
    let k: Vec<String> = f.tasks.iter().map(|t| t.1.clone()).collect();
    let refusal = submit(&mut f, vec![task(&k[0], &["src/a.rs"], 1, false), task(&k[1], &[], 1, false)]).unwrap_err();
    assert_eq!(refusal, SubmissionRefusal::EmptyFileList { key: k[1].clone() });
    assert!(refusal.to_string().contains(&k[1]));
    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM dispatch_plans"), 0);
}

#[test]
fn the_flag_defaults_to_false_on_the_wire() {
    let t: SubmittedTask = serde_json::from_str(r#"{"key":"K-1","files":["a.rs"],"wave":1}"#).unwrap();
    assert!(!t.undeclared);
    let t: SubmittedTask = serde_json::from_str(r#"{"key":"K-1","files":[],"wave":1,"undeclared":true}"#).unwrap();
    assert!(t.undeclared);
}

// --- adjacency, ordering, concurrency --------------------------------------------------------

#[test]
fn a_file_and_the_directory_containing_it_make_one_edge_and_an_undeclared_task_makes_none() {
    let mut f = fx(3);
    let k: Vec<String> = f.tasks.iter().map(|t| t.1.clone()).collect();
    let plan_id = submit(
        &mut f,
        vec![task(&k[0], &["src/a.rs"], 1, false), task(&k[1], &["src/"], 1, false), task(&k[2], &[], 1, true)],
    )
    .unwrap();

    let edges = preview_edges_with(&f.conn, &plan_id, false).unwrap();
    assert_eq!(edges.len(), 1, "{edges:?}");
    assert_eq!(edges[0].before_task_id, f.tasks[0].0);
    assert_eq!(edges[0].after_task_id, f.tasks[1].0);
    assert_eq!(edges[0].colliding_paths, vec![("src/a.rs".to_string(), "src/".to_string())]);
    assert!(edges.iter().all(|e| e.before_task_id != f.tasks[2].0 && e.after_task_id != f.tasks[2].0));
}

#[test]
fn declared_entries_read_back_in_submission_order() {
    let mut f = fx(1);
    let key = f.tasks[0].1.clone();
    let files = ["zeta/z.rs", "alpha/a.rs", "mid/", "alpha/b.rs"];
    submit(&mut f, vec![task(&key, &files, 1, false)]).unwrap();
    let read: Vec<String> =
        list_entries_for_task(&f.conn, &f.tasks[0].0).unwrap().iter().map(|e| entry_path(e).to_string()).collect();
    assert_eq!(read, files.to_vec(), "submission order is the stored order, not a sorted one");
}

#[test]
fn a_second_submission_for_an_epic_with_a_live_plan_is_refused_and_the_first_is_untouched() {
    let mut f = fx(2);
    let k: Vec<String> = f.tasks.iter().map(|t| t.1.clone()).collect();
    let first = submit(&mut f, vec![task(&k[0], &["a.rs"], 1, false), task(&k[1], &[], 1, true)]).unwrap();
    let before = count(&f.conn, "SELECT COUNT(*) FROM events");

    let refusal = submit(&mut f, vec![task(&k[0], &["b.rs"], 1, false), task(&k[1], &["c.rs"], 1, false)]).unwrap_err();
    assert_eq!(refusal, SubmissionRefusal::LivePlanExists);

    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM dispatch_plans"), 1);
    let id: String = f.conn.query_row("SELECT id FROM dispatch_plans", [], |r| r.get(0)).unwrap();
    assert_eq!(id, first);
    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM events"), before, "the refused submission wrote an event");
    let still: Vec<String> =
        list_entries_for_task(&f.conn, &f.tasks[0].0).unwrap().iter().map(|e| entry_path(e).to_string()).collect();
    assert_eq!(still, vec!["a.rs".to_string()]);
}
