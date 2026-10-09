//! Phase 09 plan 09-03: waves, the one ordering edge a colliding pair earns, the frozen record of
//! what was acted on, and the answer to "why is this one waiting?" (PLAN-02, PLAN-03, PLAN-07).
//!
//! The pure half (`edges_for_plan`, `normalise_waves`) is tested on plain values; the stored half
//! (`approve_plan`, `why`) over a real migrated database. Nothing here spawns an agent — that is
//! the dispatcher's later plans.

mod common;

use core::dispatch::{
    edges_for_plan, in_flight_declared_sets, normalise_waves, occupied_slots, why, DispatchEdge,
    PlannedTask, SequencingReason, DISPATCH_PLAN_STATES, DISPATCH_TASK_STATES, EDGE_CAUSE_WIDEN,
};
use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::dispatch_plan::{
    approve_plan, approve_plan_with, create_draft_plan_in_tx, insert_edge_in_tx, read_edges,
    read_plan, replace_plan_tasks_in_tx, set_plan_status, set_task_dispatch_state, PlanTaskInput,
    EVENT_DISPATCH_PLAN_APPROVED, EVENT_TASK_SEQUENCED,
};
use core::domain::epic::create_epic;
use core::domain::file_set::declare_file_set;
use core::domain::task::create_task;
use core::file_set::{parse_entry, FileSetEntry};
use rusqlite::{params, Connection};

fn entries(raw: &[&str]) -> Vec<FileSetEntry> {
    raw.iter().map(|r| parse_entry(r).unwrap()).collect()
}

fn planned(id: &str, wave: u32, rank: &str, raw: &[&str]) -> PlannedTask {
    PlannedTask { task_id: id.into(), wave, rank: rank.into(), entries: entries(raw) }
}

// --- the stored fixture ---------------------------------------------------------------------

struct Stored {
    conn: Connection,
    actor: String,
    project_id: String,
    epic_id: String,
    plan_id: String,
    tasks: Vec<String>,
}

/// One epic, one task per spec (created in order, so their board ranks ascend), each with its
/// declared set, and a draft plan holding them in the given waves.
fn stored(specs: &[(u32, &[&str])]) -> Stored {
    let (mut conn, actor, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor, "Epic", None).unwrap();
    let mut tasks = Vec::new();
    let mut inputs = Vec::new();
    for (i, (wave, raw)) in specs.iter().enumerate() {
        let task =
            create_task(&mut conn, &project.id, &actor, &format!("T{i}"), Some(&epic.id)).unwrap();
        if !raw.is_empty() {
            declare_file_set(&mut conn, &task.id, &entries(raw), &actor).unwrap();
        }
        inputs.push(PlanTaskInput { task_id: task.id.clone(), wave: *wave, rationale: None });
        tasks.push(task.id);
    }
    let tx = conn.transaction().unwrap();
    let plan_id = create_draft_plan_in_tx(&tx, &epic.id, None, &actor, "2026-10-09T00:00:00Z").unwrap();
    replace_plan_tasks_in_tx(&tx, &plan_id, &inputs).unwrap();
    tx.commit().unwrap();
    Stored { conn, actor, project_id: project.id, epic_id: epic.id, plan_id, tasks }
}

fn count(conn: &Connection, sql: &str, p: impl rusqlite::Params) -> i64 {
    conn.query_row(sql, p, |r| r.get(0)).unwrap()
}

fn events_of(conn: &Connection, event_type: &str) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare("SELECT payload, task_id FROM events WHERE event_type = ?1 ORDER BY sequence")
        .unwrap();
    stmt.query_map(params![event_type], |r| {
        let payload: String = r.get(0)?;
        let task: Option<String> = r.get(1)?;
        let mut v: serde_json::Value = serde_json::from_str(&payload).unwrap();
        v["_task_id"] = task.into();
        Ok(v)
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

fn pair(a: &str, b: &str) -> Vec<(String, String)> {
    vec![(a.to_string(), b.to_string())]
}

// --- the single lists ------------------------------------------------------------------------

#[test]
fn the_state_lists_each_have_one_declaration_and_the_migration_mirrors_them() {
    assert_eq!(DISPATCH_PLAN_STATES.len(), 6);
    assert_eq!(DISPATCH_TASK_STATES.len(), 12);
    let sources = core::db::migration_sources();
    let migration = sources
        .iter()
        .find(|s| s.contains("CREATE TABLE dispatch_plans"))
        .expect("0019 is registered");
    let plan_check = format!(
        "CHECK (status IN ({}))",
        DISPATCH_PLAN_STATES.iter().map(|s| format!("'{s}'")).collect::<Vec<_>>().join(", ")
    );
    assert!(migration.contains(&plan_check), "plan-status CHECK must mirror the constant: {plan_check}");

    let from = migration.find("state TEXT NOT NULL CHECK (state IN (").expect("task-state CHECK");
    let block = &migration[from..];
    let block = &block[..block.find("))").unwrap()];
    let in_migration: Vec<&str> = block.split('\'').skip(1).step_by(2).collect();
    assert_eq!(in_migration, DISPATCH_TASK_STATES.to_vec(), "task-state CHECK must mirror the constant");
}

// --- edges: only the colliding pair, oriented, deterministic ---------------------------------

#[test]
fn a_wave_of_three_with_one_collision_yields_exactly_one_edge_and_the_third_is_untouched() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["a.rs"]), (1, &["z.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();

    let edges = read_edges(&s.conn, &s.plan_id).unwrap();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].before_task_id, s.tasks[0]);
    assert_eq!(edges[0].after_task_id, s.tasks[1]);
    assert_eq!(edges[0].colliding_paths, pair("a.rs", "a.rs"));
    let third = &s.tasks[2];
    assert!(edges.iter().all(|e| &e.before_task_id != third && &e.after_task_id != third));
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM dispatch_edges WHERE plan_id = ?1", params![s.plan_id]), 1);
}

#[test]
fn a_wave_of_one_task_yields_no_edges() {
    assert!(edges_for_plan(&[planned("A", 1, "50", &["a.rs"])], false).is_empty());
    let mut s = stored(&[(1, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    assert!(read_edges(&s.conn, &s.plan_id).unwrap().is_empty());
}

#[test]
fn identical_sets_in_different_waves_yield_no_edge() {
    let tasks = [planned("A", 1, "50", &["a.rs"]), planned("B", 2, "60", &["a.rs"])];
    assert!(edges_for_plan(&tasks, false).is_empty());
}

#[test]
fn a_task_with_no_declared_set_collides_with_nothing() {
    let tasks = [planned("A", 1, "50", &[]), planned("B", 1, "60", &["a.rs"]), planned("C", 1, "70", &[])];
    assert!(edges_for_plan(&tasks, false).is_empty());
}

#[test]
fn a_dir_and_a_file_beneath_it_collide_and_siblings_do_not() {
    let tasks = [
        planned("A", 1, "50", &["src/"]),
        planned("B", 1, "60", &["src/lib.rs"]),
        planned("C", 1, "70", &["src_x.rs"]),
    ];
    let edges = edges_for_plan(&tasks, false);
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].colliding_paths, pair("src/", "src/lib.rs"));
}

#[test]
fn orientation_follows_board_rank_over_task_id() {
    // T2 has the lower rank, so it goes first even though T1 has the lower id.
    let tasks = [planned("T1", 1, "80", &["a.rs"]), planned("T2", 1, "10", &["a.rs"])];
    let edges = edges_for_plan(&tasks, false);
    assert_eq!(edges.len(), 1);
    assert_eq!((edges[0].before_task_id.as_str(), edges[0].after_task_id.as_str()), ("T2", "T1"));
}

#[test]
fn equal_ranks_are_ordered_by_ascending_task_id() {
    let tasks = [planned("T2", 1, "50", &["a.rs"]), planned("T1", 1, "50", &["a.rs"])];
    let edges = edges_for_plan(&tasks, false);
    assert_eq!(edges.len(), 1);
    assert_eq!((edges[0].before_task_id.as_str(), edges[0].after_task_id.as_str()), ("T1", "T2"));
}

#[test]
fn edge_computation_is_deterministic_whatever_the_input_order() {
    let tasks = vec![
        planned("C", 1, "30", &["a.rs", "b.rs"]),
        planned("A", 1, "10", &["a.rs"]),
        planned("B", 1, "20", &["b.rs", "a.rs"]),
        planned("D", 2, "40", &["a.rs"]),
    ];
    let first = edges_for_plan(&tasks, false);
    assert_eq!(first, edges_for_plan(&tasks, false));
    let mut reversed = tasks.clone();
    reversed.reverse();
    assert_eq!(first, edges_for_plan(&reversed, false));
    assert_eq!(first.len(), 3, "A-B, A-C, B-C all collide; D is in another wave");
}

#[test]
fn the_case_fold_flag_decides_whether_case_variants_are_sequenced() {
    let tasks = [planned("A", 1, "10", &["src/Foo.ts"]), planned("B", 1, "20", &["src/foo.ts"])];
    assert!(edges_for_plan(&tasks, false).is_empty());
    assert_eq!(edges_for_plan(&tasks, true).len(), 1);
}

#[test]
fn approving_with_case_folding_on_sequences_case_variants() {
    let mut s = stored(&[(1, &["src/Foo.ts"]), (1, &["src/foo.ts"])]);
    approve_plan_with(&mut s.conn, &s.plan_id, &s.actor, true, "2026-10-09T00:00:00Z").unwrap();
    assert_eq!(read_edges(&s.conn, &s.plan_id).unwrap().len(), 1);
}

// --- waves -----------------------------------------------------------------------------------

#[test]
fn normalise_waves_closes_gaps_and_preserves_relative_order() {
    let mut tasks = vec![
        planned("A", 7, "10", &[]),
        planned("B", 1, "20", &[]),
        planned("C", 3, "30", &[]),
        planned("D", 3, "40", &[]),
    ];
    normalise_waves(&mut tasks);
    let waves: Vec<(&str, u32)> = tasks.iter().map(|t| (t.task_id.as_str(), t.wave)).collect();
    assert_eq!(waves, vec![("A", 3), ("B", 1), ("C", 2), ("D", 2)]);
}

#[test]
fn approval_stores_the_normalised_waves() {
    let mut s = stored(&[(1, &["a.rs"]), (3, &["b.rs"]), (7, &["c.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    let plan = read_plan(&s.conn, &s.plan_id).unwrap().unwrap();
    let mut waves: Vec<(String, u32)> = plan.tasks.iter().map(|t| (t.task_id.clone(), t.wave)).collect();
    waves.sort_by_key(|(_, w)| *w);
    assert_eq!(waves.iter().map(|(_, w)| *w).collect::<Vec<_>>(), vec![1, 2, 3]);
    assert_eq!(waves.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>(), s.tasks);
}

// --- the approval transaction ----------------------------------------------------------------

#[test]
fn approval_writes_one_sequenced_event_per_edge_naming_both_tasks_and_the_paths() {
    let mut s = stored(&[(1, &["a.rs", "b/"]), (1, &["b/x.rs"]), (1, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();

    let edges = read_edges(&s.conn, &s.plan_id).unwrap();
    assert_eq!(edges.len(), 2);
    let events = events_of(&s.conn, EVENT_TASK_SEQUENCED);
    assert_eq!(events.len(), edges.len());
    for (edge, event) in edges.iter().zip(&events) {
        assert_eq!(event["before_task_id"], edge.before_task_id.as_str());
        assert_eq!(event["after_task_id"], edge.after_task_id.as_str());
        assert_eq!(event["_task_id"], edge.after_task_id.as_str(), "attributed to the waiting task");
        let paths: Vec<(String, String)> = event["colliding_paths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (p["before"].as_str().unwrap().to_string(), p["after"].as_str().unwrap().to_string()))
            .collect();
        assert_eq!(paths, edge.colliding_paths);
        assert!(!event["label"].as_str().unwrap().is_empty());
    }
    assert_eq!(events_of(&s.conn, EVENT_DISPATCH_PLAN_APPROVED).len(), 1);
    assert_eq!(read_plan(&s.conn, &s.plan_id).unwrap().unwrap().status, "approved");
}

#[test]
fn a_failure_part_way_through_approval_leaves_no_edges_no_events_and_a_draft_plan() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["a.rs"]), (1, &["a.rs"])]);
    // Pre-seed the LAST edge approval will try (t1 -> t2), so the first two inserts succeed and
    // the third hits the UNIQUE constraint: a real failure mid-transaction.
    {
        let tx = s.conn.transaction().unwrap();
        let blocker = DispatchEdge {
            before_task_id: s.tasks[1].clone(),
            after_task_id: s.tasks[2].clone(),
            cause: "overlap".into(),
            colliding_paths: pair("a.rs", "a.rs"),
        };
        insert_edge_in_tx(&tx, &s.plan_id, &blocker, "2026-10-09T00:00:00Z").unwrap();
        tx.commit().unwrap();
    }

    assert!(approve_plan(&mut s.conn, &s.plan_id, &s.actor).is_err());

    assert_eq!(read_edges(&s.conn, &s.plan_id).unwrap().len(), 1, "only the pre-seeded edge remains");
    assert!(events_of(&s.conn, EVENT_TASK_SEQUENCED).is_empty());
    assert!(events_of(&s.conn, EVENT_DISPATCH_PLAN_APPROVED).is_empty());
    assert_eq!(read_plan(&s.conn, &s.plan_id).unwrap().unwrap().status, "draft");
}

#[test]
fn a_plan_can_only_be_approved_from_draft() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    assert!(approve_plan(&mut s.conn, &s.plan_id, &s.actor).is_err());
    assert_eq!(read_edges(&s.conn, &s.plan_id).unwrap().len(), 1);
    assert_eq!(events_of(&s.conn, EVENT_TASK_SEQUENCED).len(), 1);
}

#[test]
fn approving_a_plan_that_does_not_exist_is_an_error() {
    let (mut conn, actor, _project) = common::seeded_project();
    assert!(approve_plan(&mut conn, "01ARZ3NDEKTSV4RRFFQ69G5FAV", &actor).is_err());
}

// --- plan CRUD -------------------------------------------------------------------------------

#[test]
fn a_task_from_another_epic_is_refused_and_nothing_is_stored() {
    let mut s = stored(&[(1, &["a.rs"])]);
    let other_epic = create_epic(&mut s.conn, &s.project_id, &s.actor, "Other", None).unwrap();
    let stray = create_task(&mut s.conn, &s.project_id, &s.actor, "Stray", Some(&other_epic.id)).unwrap();
    let tx = s.conn.transaction().unwrap();
    let result = replace_plan_tasks_in_tx(
        &tx,
        &s.plan_id,
        &[PlanTaskInput { task_id: stray.id, wave: 1, rationale: None }],
    );
    assert!(result.is_err());
    drop(tx);
    assert_eq!(read_plan(&s.conn, &s.plan_id).unwrap().unwrap().tasks.len(), 1, "the original rows are intact");
}

#[test]
fn wave_zero_is_refused() {
    let mut s = stored(&[(1, &["a.rs"])]);
    let tx = s.conn.transaction().unwrap();
    let result = replace_plan_tasks_in_tx(
        &tx,
        &s.plan_id,
        &[PlanTaskInput { task_id: s.tasks[0].clone(), wave: 0, rationale: None }],
    );
    assert!(result.is_err());
}

#[test]
fn a_second_live_plan_for_one_epic_is_refused_by_the_schema() {
    let mut s = stored(&[(1, &["a.rs"])]);
    let tx = s.conn.transaction().unwrap();
    assert!(create_draft_plan_in_tx(&tx, &s.epic_id, None, &s.actor, "2026-10-09T00:00:00Z").is_err());
}

#[test]
fn plan_and_task_states_accept_only_the_declared_vocabulary() {
    let mut s = stored(&[(1, &["a.rs"])]);
    assert!(set_plan_status(&s.conn, &s.plan_id, "bogus").is_err());
    set_plan_status(&s.conn, &s.plan_id, "paused").unwrap();
    assert_eq!(read_plan(&s.conn, &s.plan_id).unwrap().unwrap().status, "paused");

    assert!(set_task_dispatch_state(&s.conn, &s.plan_id, &s.tasks[0], "bogus").is_err());
    set_task_dispatch_state(&s.conn, &s.plan_id, &s.tasks[0], "running").unwrap();
    let plan = read_plan(&s.conn, &s.plan_id).unwrap().unwrap();
    assert_eq!(plan.tasks[0].state, "running");
    // Not a board transition: the dispatcher's display state never touches `tasks.status`.
    let status: String =
        s.conn.query_row("SELECT status FROM tasks WHERE id = ?1", params![s.tasks[0]], |r| r.get(0)).unwrap();
    assert_eq!(status, "backlog");
    let _ = &mut s;
}

// --- why -------------------------------------------------------------------------------------

#[test]
fn why_a_sequenced_pair_returns_the_paths_frozen_on_the_edge_in_either_argument_order() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    let expected = SequencingReason::Sequenced {
        before_task_id: s.tasks[0].clone(),
        after_task_id: s.tasks[1].clone(),
        cause: "overlap".into(),
        colliding_paths: pair("a.rs", "a.rs"),
    };
    assert_eq!(why(&s.conn, &s.plan_id, &s.tasks[1], &s.tasks[0]).unwrap(), expected);
    assert_eq!(why(&s.conn, &s.plan_id, &s.tasks[0], &s.tasks[1]).unwrap(), expected);
}

#[test]
fn why_still_returns_the_approved_paths_after_the_declared_sets_change() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    // Both sets change so that, recomputed today, they would no longer collide at all.
    declare_file_set(&mut s.conn, &s.tasks[0], &entries(&["x.rs"]), &s.actor).unwrap();
    declare_file_set(&mut s.conn, &s.tasks[1], &entries(&["y.rs"]), &s.actor).unwrap();
    match why(&s.conn, &s.plan_id, &s.tasks[0], &s.tasks[1]).unwrap() {
        SequencingReason::Sequenced { colliding_paths, cause, .. } => {
            assert_eq!(colliding_paths, pair("a.rs", "a.rs"));
            assert_eq!(cause, "overlap");
        }
        other => panic!("expected the frozen edge, got {other:?}"),
    }
    let stored_json: String = s
        .conn
        .query_row("SELECT colliding_paths FROM dispatch_edges WHERE plan_id = ?1", params![s.plan_id], |r| r.get(0))
        .unwrap();
    assert!(stored_json.contains("a.rs"));
}

#[test]
fn why_after_a_widen_edge_reports_the_widen_as_the_cause() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["b.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    assert_eq!(why(&s.conn, &s.plan_id, &s.tasks[0], &s.tasks[1]).unwrap(), SequencingReason::DisjointSets);

    let tx = s.conn.transaction().unwrap();
    let widen = DispatchEdge {
        before_task_id: s.tasks[0].clone(),
        after_task_id: s.tasks[1].clone(),
        cause: EDGE_CAUSE_WIDEN.into(),
        colliding_paths: pair("a.rs", "a.rs"),
    };
    insert_edge_in_tx(&tx, &s.plan_id, &widen, "2026-10-09T01:00:00Z").unwrap();
    tx.commit().unwrap();

    match why(&s.conn, &s.plan_id, &s.tasks[1], &s.tasks[0]).unwrap() {
        SequencingReason::Sequenced { cause, colliding_paths, .. } => {
            assert_eq!(cause, "widen");
            assert_eq!(colliding_paths, pair("a.rs", "a.rs"));
        }
        other => panic!("expected the widen edge, got {other:?}"),
    }
}

#[test]
fn why_two_tasks_in_different_waves_says_so() {
    let mut s = stored(&[(1, &["a.rs"]), (2, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    assert_eq!(
        why(&s.conn, &s.plan_id, &s.tasks[0], &s.tasks[1]).unwrap(),
        SequencingReason::DifferentWaves { wave_a: 1, wave_b: 2 }
    );
    assert_eq!(
        why(&s.conn, &s.plan_id, &s.tasks[1], &s.tasks[0]).unwrap(),
        SequencingReason::DifferentWaves { wave_a: 2, wave_b: 1 }
    );
}

#[test]
fn why_two_disjoint_tasks_in_one_wave_says_their_sets_are_disjoint() {
    let mut s = stored(&[(1, &["a.rs"]), (1, &["b.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    assert_eq!(why(&s.conn, &s.plan_id, &s.tasks[0], &s.tasks[1]).unwrap(), SequencingReason::DisjointSets);
}

#[test]
fn why_a_task_that_is_not_in_the_plan_is_a_named_answer_not_an_error() {
    let mut s = stored(&[(1, &["a.rs"])]);
    approve_plan(&mut s.conn, &s.plan_id, &s.actor).unwrap();
    assert_eq!(
        why(&s.conn, &s.plan_id, &s.tasks[0], "01ARZ3NDEKTSV4RRFFQ69G5FAV").unwrap(),
        SequencingReason::NotInPlan
    );
}

// --- occupancy and in-flight sets (consumed by plans 09-04, 09-06, 09-07) --------------------

static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn occupied_slots_and_in_flight_sets_come_from_the_database() {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let scratch = tempfile::tempdir().unwrap();
    // SAFETY: serialised by the mutex above; cleared before the guard drops.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", scratch.path()) };

    let (mut conn, actor, project, _repo) = common::seeded_git_project();
    assert_eq!(occupied_slots(&conn).unwrap(), 0);
    assert!(in_flight_declared_sets(&conn, &project.id).unwrap().is_empty());

    let declared = create_task(&mut conn, &project.id, &actor, "Declared", None).unwrap();
    declare_file_set(&mut conn, &declared.id, &entries(&["src/", "Cargo.toml"]), &actor).unwrap();
    let undeclared = create_task(&mut conn, &project.id, &actor, "Undeclared", None).unwrap();

    let run_a = start_agent_run(&mut conn, &declared.id, "default", &actor).unwrap();
    let _run_b = start_agent_run(&mut conn, &undeclared.id, "default", &actor).unwrap();

    assert_eq!(occupied_slots(&conn).unwrap(), 2);
    let in_flight = in_flight_declared_sets(&conn, &project.id).unwrap();
    assert_eq!(in_flight.len(), 1, "an unarmed run has no declared set to compare against");
    assert_eq!(in_flight[0].0, declared.id);
    assert_eq!(in_flight[0].1, entries(&["src/", "Cargo.toml"]));

    close_agent_run(&mut conn, &run_a.id, AgentRunStatus::Completed, None, None, None).unwrap();
    assert_eq!(occupied_slots(&conn).unwrap(), 1);
    assert!(in_flight_declared_sets(&conn, &project.id).unwrap().is_empty());

    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
}
