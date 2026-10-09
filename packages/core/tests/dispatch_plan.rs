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
    read_plan, replace_plan_tasks_in_tx, resolve_planning_run, set_plan_status,
    set_task_dispatch_state, store_submitted_plan, PlanTaskInput, SubmissionRefusal,
    SubmittedExclusion, SubmittedPlan, SubmittedTask, EVENT_DISPATCH_PLAN_APPROVED,
    EVENT_DISPATCH_PLAN_DRAFTED, EVENT_TASK_SEQUENCED,
};
use core::dispatch_exec::{begin_planning_run, begin_planning_run_with};
use core::domain::acceptance_criterion::create_criterion;
use core::domain::dispatch_plan::{check_can_plan, start_planning_run_row};
use core::domain::epic::create_epic;
use core::domain::file_set::declare_file_set;
use core::epic_context_packet::{assemble_epic_context_packet, render_planning_prompt};
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

// =============================================================================================
// Plan 09-08, Task 1: a planning run's submission becomes one draft plan, or nothing.
// =============================================================================================

const NOW: &str = "2026-10-09T00:00:00Z";

/// An epic with `n` backlog tasks and a planning-shaped run: epic-scoped, no task, no stage.
struct Sub {
    conn: Connection,
    project_id: String,
    epic_id: String,
    run_id: String,
    agent: String,
    /// `(id, key)` in creation (board rank) order.
    tasks: Vec<(String, String)>,
}

fn insert_run(
    conn: &Connection,
    project_id: &str,
    epic_id: Option<&str>,
    task_id: Option<&str>,
    stage: Option<&str>,
    status: &str,
) -> String {
    let run_id = core::ids::new_id();
    let agent = core::domain::agent_run::agent_actor_id(conn).unwrap();
    let human = core::domain::actor::local_human_actor_id(conn).unwrap();
    let trigger = core::ids::new_id();
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, config, enabled, last_fired_at, created_by, created_at)
         VALUES (?1, ?2, NULL, ?3, 'user_action', NULL, 1, ?4, ?5, ?4)",
        params![trigger, project_id, epic_id, NOW, human],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_runs (id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            permission_mode, log_path, started_at, authoring_stage)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'claude_code', ?6, ?7, 'default', '/dev/null', ?8, ?9)",
        params![run_id, task_id, epic_id, project_id, trigger, agent, status, NOW, stage],
    )
    .unwrap();
    run_id
}

fn sub(n: usize) -> Sub {
    let (mut conn, actor, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor, "Epic", None).unwrap();
    let mut tasks = Vec::new();
    for i in 0..n {
        let t = create_task(&mut conn, &project.id, &actor, &format!("T{i}"), Some(&epic.id)).unwrap();
        let key: String = conn.query_row("SELECT key FROM tasks WHERE id = ?1", [&t.id], |r| r.get(0)).unwrap();
        tasks.push((t.id, key));
    }
    let run_id = insert_run(&conn, &project.id, Some(&epic.id), None, None, "running");
    let agent = core::domain::agent_run::agent_actor_id(&conn).unwrap();
    Sub { conn, project_id: project.id, epic_id: epic.id, run_id, agent, tasks }
}

fn st(key: &str, files: &[&str], wave: u32) -> SubmittedTask {
    SubmittedTask {
        key: key.to_string(),
        files: files.iter().map(|f| f.to_string()).collect(),
        wave,
        rationale: format!("because {key}"),
    }
}

fn submit(s: &mut Sub, plan: &SubmittedPlan) -> Result<String, SubmissionRefusal> {
    store_submitted_plan(&mut s.conn, &s.run_id, &s.epic_id, plan, &s.agent, NOW)
}

fn plan_of(tasks: Vec<SubmittedTask>) -> SubmittedPlan {
    SubmittedPlan { tasks, excluded: Vec::new() }
}

fn nothing_stored(s: &Sub) {
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM dispatch_plans", []), 0, "a plan row was written");
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM dispatch_plan_tasks", []), 0, "a plan-task row was written");
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM task_file_set_entries", []), 0, "an entry row was written");
}

#[test]
fn a_valid_submission_from_a_running_planning_run_stores_one_draft_plan() {
    let mut s = sub(2);
    let (k0, k1) = (s.tasks[0].1.clone(), s.tasks[1].1.clone());
    let plan_id = submit(&mut s, &plan_of(vec![st(&k0, &["src/a.rs", "docs/"], 1), st(&k1, &["src/b.rs"], 2)])).unwrap();

    let plan = read_plan(&s.conn, &plan_id).unwrap().unwrap();
    assert_eq!(plan.status, "draft");
    assert_eq!(plan.epic_id, s.epic_id);
    assert_eq!(plan.tasks.len(), 2);
    assert_eq!((plan.tasks[0].task_id.as_str(), plan.tasks[0].wave), (s.tasks[0].0.as_str(), 1));
    assert_eq!((plan.tasks[1].task_id.as_str(), plan.tasks[1].wave), (s.tasks[1].0.as_str(), 2));
    assert_eq!(plan.tasks[0].rationale.as_deref(), Some(format!("because {k0}").as_str()));
    let planning_run: Option<String> =
        s.conn.query_row("SELECT planning_run_id FROM dispatch_plans WHERE id = ?1", [&plan_id], |r| r.get(0)).unwrap();
    assert_eq!(planning_run.as_deref(), Some(s.run_id.as_str()));
    // The declared sets landed through the one declare path.
    let declared = core::domain::file_set::list_entries_for_task(&s.conn, &s.tasks[0].0).unwrap();
    assert_eq!(declared, entries(&["src/a.rs", "docs/"]));
    assert_eq!(events_of(&s.conn, EVENT_DISPATCH_PLAN_DRAFTED).len(), 1);
    // No edge is computed and nothing is approved: the human has not looked yet.
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM dispatch_edges", []), 0);
}

#[test]
fn an_execution_run_is_refused_by_the_authority_check_not_by_the_tool_list() {
    let s = sub(1);
    let exec = insert_run(&s.conn, &s.project_id, None, Some(&s.tasks[0].0), None, "running");
    assert_eq!(resolve_planning_run(&s.conn, &exec), Err(SubmissionRefusal::NotPlanningRun));
    // An authoring run (epic-scoped, but with a stage) is not a planning run either.
    let authoring = insert_run(&s.conn, &s.project_id, Some(&s.epic_id), None, Some("challenge"), "running");
    assert_eq!(resolve_planning_run(&s.conn, &authoring), Err(SubmissionRefusal::NotPlanningRun));
    assert_eq!(resolve_planning_run(&s.conn, "01ARZ3NDEKTSV4RRFFQ69G5FAV"), Err(SubmissionRefusal::NotPlanningRun));
    // The run that is a planning run resolves to its epic.
    let ok = resolve_planning_run(&s.conn, &s.run_id).unwrap();
    assert_eq!((ok.run_id.as_str(), ok.epic_id.as_str()), (s.run_id.as_str(), s.epic_id.as_str()));
}

#[test]
fn a_planning_run_that_is_no_longer_running_is_refused() {
    let s = sub(1);
    for status in ["completed", "failed", "interrupted", "abandoned", "blocked"] {
        s.conn.execute("UPDATE agent_runs SET status = ?1 WHERE id = ?2", params![status, s.run_id]).unwrap();
        match resolve_planning_run(&s.conn, &s.run_id) {
            Err(SubmissionRefusal::RunNotRunning { status: got }) => assert_eq!(got, status),
            other => panic!("{status}: expected RunNotRunning, got {other:?}"),
        }
    }
}

#[test]
fn a_submission_with_zero_tasks_is_refused_and_nothing_is_stored() {
    let mut s = sub(2);
    assert_eq!(submit(&mut s, &plan_of(vec![])), Err(SubmissionRefusal::NoTasks));
    nothing_stored(&s);
}

#[test]
fn a_task_with_an_empty_file_list_is_refused_naming_its_key() {
    let mut s = sub(2);
    let (k0, k1) = (s.tasks[0].1.clone(), s.tasks[1].1.clone());
    let refusal = submit(&mut s, &plan_of(vec![st(&k0, &["a.rs"], 1), st(&k1, &[], 1)])).unwrap_err();
    assert_eq!(refusal, SubmissionRefusal::EmptyFileList { key: k1.clone() });
    assert!(refusal.to_string().contains(&k1), "the message must name the key: {refusal}");
    nothing_stored(&s);
}

#[test]
fn a_key_outside_the_epic_is_refused_naming_that_key() {
    let mut s = sub(1);
    let human = core::domain::actor::local_human_actor_id(&s.conn).unwrap();
    let other_epic = create_epic(&mut s.conn, &s.project_id, &human, "Other", None).unwrap();
    let foreign = create_task(&mut s.conn, &s.project_id, &human, "Foreign", Some(&other_epic.id)).unwrap();
    let foreign_key: String = s.conn.query_row("SELECT key FROM tasks WHERE id = ?1", [&foreign.id], |r| r.get(0)).unwrap();
    let refusal = submit(&mut s, &plan_of(vec![st(&foreign_key, &["a.rs"], 1)])).unwrap_err();
    assert_eq!(refusal, SubmissionRefusal::UnknownKey { key: foreign_key.clone() });
    assert!(refusal.to_string().contains(&foreign_key));
    let refusal = submit(&mut s, &plan_of(vec![st("NOPE-999", &["a.rs"], 1)])).unwrap_err();
    assert_eq!(refusal, SubmissionRefusal::UnknownKey { key: "NOPE-999".into() });
    nothing_stored(&s);
}

#[test]
fn a_glob_entry_is_answered_with_the_cause_parse_entry_returns_and_nothing_is_stored() {
    let mut s = sub(2);
    let (k0, k1) = (s.tasks[0].1.clone(), s.tasks[1].1.clone());
    let refusal = submit(&mut s, &plan_of(vec![st(&k0, &["ok.rs"], 1), st(&k1, &["src/*.rs"], 1)])).unwrap_err();
    let cause = parse_entry("src/*.rs").unwrap_err();
    assert_eq!(refusal, SubmissionRefusal::BadEntry { key: k1.clone(), entry: "src/*.rs".into(), cause: cause.clone() });
    assert!(refusal.to_string().contains(&cause.to_string()), "the named cause must reach the agent: {refusal}");
    nothing_stored(&s);
}

#[test]
fn a_duplicate_key_a_zero_wave_and_a_task_already_started_are_refused() {
    let mut s = sub(2);
    let (k0, k1) = (s.tasks[0].1.clone(), s.tasks[1].1.clone());
    assert_eq!(
        submit(&mut s, &plan_of(vec![st(&k0, &["a"], 1), st(&k0, &["b"], 1)])),
        Err(SubmissionRefusal::DuplicateKey { key: k0.clone() })
    );
    assert_eq!(submit(&mut s, &plan_of(vec![st(&k0, &["a"], 0)])), Err(SubmissionRefusal::BadWave { key: k0.clone() }));
    s.conn.execute("UPDATE tasks SET status = 'in_progress' WHERE id = ?1", [&s.tasks[1].0]).unwrap();
    assert_eq!(
        submit(&mut s, &plan_of(vec![st(&k1, &["a"], 1)])),
        Err(SubmissionRefusal::NotPlannable { key: k1, status: "in_progress".into() })
    );
    nothing_stored(&s);
}

#[test]
fn an_oversized_submission_is_refused() {
    let mut s = sub(1);
    let k0 = s.tasks[0].1.clone();
    let many: Vec<String> = (0..201).map(|i| format!("f{i}.rs")).collect();
    let big = SubmittedPlan {
        tasks: vec![SubmittedTask { key: k0.clone(), files: many, wave: 1, rationale: String::new() }],
        excluded: vec![],
    };
    assert!(matches!(submit(&mut s, &big), Err(SubmissionRefusal::TooLarge(_))));
    let long = "x".repeat(1025);
    let big = SubmittedPlan {
        tasks: vec![SubmittedTask { key: k0, files: vec![long], wave: 1, rationale: String::new() }],
        excluded: vec![],
    };
    assert!(matches!(submit(&mut s, &big), Err(SubmissionRefusal::TooLarge(_))));
    nothing_stored(&s);
}

#[test]
fn two_tasks_submitted_with_identical_file_lists_are_accepted_and_approval_orders_exactly_one_edge() {
    let mut s = sub(2);
    let (k0, k1) = (s.tasks[0].1.clone(), s.tasks[1].1.clone());
    let plan_id = submit(&mut s, &plan_of(vec![st(&k0, &["src/shared.rs"], 1), st(&k1, &["src/shared.rs"], 1)])).unwrap();
    assert_eq!(read_plan(&s.conn, &plan_id).unwrap().unwrap().tasks.len(), 2, "equality is a collision, not a merge");
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM dispatch_edges", []), 0, "no edge before approval");

    let human = core::domain::actor::local_human_actor_id(&s.conn).unwrap();
    approve_plan(&mut s.conn, &plan_id, &human).unwrap();
    let edges = read_edges(&s.conn, &plan_id).unwrap();
    assert_eq!(edges.len(), 1);
    assert_eq!(edges[0].before_task_id, s.tasks[0].0);
    assert_eq!(edges[0].after_task_id, s.tasks[1].0);
}

#[test]
fn waves_with_gaps_are_stored_contiguously_with_relative_order_kept() {
    let mut s = sub(3);
    let keys: Vec<String> = s.tasks.iter().map(|t| t.1.clone()).collect();
    let plan_id = submit(
        &mut s,
        &plan_of(vec![st(&keys[0], &["a"], 7), st(&keys[1], &["b"], 1), st(&keys[2], &["c"], 3)]),
    )
    .unwrap();
    let plan = read_plan(&s.conn, &plan_id).unwrap().unwrap();
    let wave_of = |id: &str| plan.tasks.iter().find(|t| t.task_id == id).unwrap().wave;
    assert_eq!((wave_of(&s.tasks[1].0), wave_of(&s.tasks[2].0), wave_of(&s.tasks[0].0)), (1, 2, 3));
}

#[test]
fn same_wave_tasks_with_equal_rank_are_stored_in_ascending_task_id_order() {
    let mut s = sub(3);
    // Equal board rank: the order is then the task id alone, whatever order the agent listed them in.
    s.conn.execute("UPDATE tasks SET rank = 'a0' WHERE epic_id = ?1", [&s.epic_id]).unwrap();
    let mut by_id = s.tasks.clone();
    by_id.sort();
    let plan_id = submit(
        &mut s,
        &plan_of(by_id.iter().rev().map(|(_, k)| st(k, &["x"], 1)).collect()),
    )
    .unwrap();
    let stored: Vec<String> = s
        .conn
        .prepare("SELECT task_id FROM dispatch_plan_tasks WHERE plan_id = ?1 ORDER BY rowid")
        .unwrap()
        .query_map([&plan_id], |r| r.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(stored, by_id.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>());
    let read: Vec<String> = read_plan(&s.conn, &plan_id).unwrap().unwrap().tasks.into_iter().map(|t| t.task_id).collect();
    assert_eq!(read, stored, "the read order and the stored order agree");
}

#[test]
fn a_second_submission_while_a_live_plan_exists_is_refused_by_the_index() {
    let mut s = sub(1);
    let k0 = s.tasks[0].1.clone();
    let first = submit(&mut s, &plan_of(vec![st(&k0, &["a.rs"], 1)])).unwrap();
    assert_eq!(submit(&mut s, &plan_of(vec![st(&k0, &["b.rs"], 1)])), Err(SubmissionRefusal::LivePlanExists));
    assert_eq!(count(&s.conn, "SELECT COUNT(*) FROM dispatch_plans", []), 1);
    // The refused call changed nothing about the first plan's declared set.
    assert_eq!(core::domain::file_set::list_entries_for_task(&s.conn, &s.tasks[0].0).unwrap(), entries(&["a.rs"]));
    // Once the live plan is finished, the index no longer objects.
    set_plan_status(&s.conn, &first, "aborted").unwrap();
    assert!(submit(&mut s, &plan_of(vec![st(&k0, &["b.rs"], 1)])).is_ok());
}

#[test]
fn a_task_of_the_epic_absent_from_the_submission_is_stored_skipped_with_a_reason() {
    let mut s = sub(3);
    let keys: Vec<String> = s.tasks.iter().map(|t| t.1.clone()).collect();
    let plan = SubmittedPlan {
        tasks: vec![st(&keys[0], &["a"], 1)],
        excluded: vec![SubmittedExclusion { key: keys[1].clone(), reason: "already covered by the shared helper".into() }],
    };
    let plan_id = submit(&mut s, &plan).unwrap();
    let stored = read_plan(&s.conn, &plan_id).unwrap().unwrap();
    assert_eq!(stored.tasks.len(), 3, "no task of the epic is dropped");
    let row = |id: &str| stored.tasks.iter().find(|t| t.task_id == id).unwrap();
    assert_eq!(row(&s.tasks[1].0).state, "skipped");
    assert_eq!(row(&s.tasks[1].0).rationale.as_deref(), Some("already covered by the shared helper"));
    // The one the agent said nothing about is still shown, with a reason the user can read.
    assert_eq!(row(&s.tasks[2].0).state, "skipped");
    assert!(!row(&s.tasks[2].0).rationale.clone().unwrap_or_default().trim().is_empty());
    assert_eq!(row(&s.tasks[0].0).state, "planned");
    // An exclusion with no reason is not an explanation.
    let mut s = sub(1);
    let k = s.tasks[0].1.clone();
    let bad = SubmittedPlan { tasks: vec![st(&k, &["a"], 1)], excluded: vec![SubmittedExclusion { key: k.clone(), reason: "  ".into() }] };
    assert!(submit(&mut s, &bad).is_err());
}

#[test]
fn a_failure_part_way_through_storing_leaves_no_plan_no_plan_task_and_no_entry() {
    let mut s = sub(2);
    let (k0, k1) = (s.tasks[0].1.clone(), s.tasks[1].1.clone());
    // Entries and the plan row are written before the plan-task rows; abort on the first of those.
    s.conn
        .execute_batch(
            "CREATE TRIGGER boom BEFORE INSERT ON dispatch_plan_tasks BEGIN SELECT RAISE(ABORT, 'boom'); END;",
        )
        .unwrap();
    let refusal = submit(&mut s, &plan_of(vec![st(&k0, &["a.rs"], 1), st(&k1, &["b.rs"], 1)])).unwrap_err();
    assert!(matches!(refusal, SubmissionRefusal::Storage(_)), "{refusal:?}");
    nothing_stored(&s);
    assert!(events_of(&s.conn, EVENT_DISPATCH_PLAN_DRAFTED).is_empty());
    assert!(events_of(&s.conn, "task.file_set_declared").is_empty());
}

// =============================================================================================
// Plan 09-08, Task 2: the pre-dispatch pass — a short run over the epic, read-only, in the epic's
// integration worktree, that leaves a draft behind.
// =============================================================================================

static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// A real git project, an epic with three backlog tasks (one with a criterion), and the two
/// environment overrides the planning start writes through.
struct Git {
    db: std::sync::Mutex<Connection>,
    human: String,
    project_id: String,
    epic_id: String,
    epic_key: String,
    repo: tempfile::TempDir,
    worktrees: tempfile::TempDir,
    runtime: tempfile::TempDir,
    tasks: Vec<(String, String)>,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Drop for Git {
    fn drop(&mut self) {
        // SAFETY: every test that touches these variables holds ENV_LOCK for its whole body.
        unsafe {
            std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
            std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
        }
    }
}

fn git_fx() -> Git {
    let guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let worktrees = tempfile::tempdir().unwrap();
    let runtime = tempfile::tempdir().unwrap();
    // SAFETY: serialised by ENV_LOCK; cleared in Drop.
    unsafe {
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktrees.path());
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path());
    }
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let epic = create_epic(&mut conn, &project.id, &human, "Fan out", Some("Make the thing parallel")).unwrap();
    let epic_key: String = conn.query_row("SELECT key FROM epics WHERE id = ?1", [&epic.id], |r| r.get(0)).unwrap();
    let mut tasks = Vec::new();
    for title in ["Parser", "Renderer", "Docs"] {
        let t = create_task(&mut conn, &project.id, &human, title, Some(&epic.id)).unwrap();
        let key: String = conn.query_row("SELECT key FROM tasks WHERE id = ?1", [&t.id], |r| r.get(0)).unwrap();
        tasks.push((t.id, key));
    }
    create_criterion(&mut conn, &project.id, &human, "task", &tasks[0].0, "Parses a trailing comma", Some("cargo test")).unwrap();
    Git {
        db: std::sync::Mutex::new(conn),
        human,
        project_id: project.id,
        epic_id: epic.id,
        epic_key,
        repo,
        worktrees,
        runtime,
        tasks,
        _guard: guard,
    }
}

impl Git {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap()
    }
    fn begin(&self) -> anyhow::Result<core::dispatch_exec::PlanningRunStart> {
        begin_planning_run(&self.db, &self.epic_id, &self.human, "default")
    }
}

fn git_in(path: &std::path::Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git").arg("-C").arg(path).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn column_names(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap();
    stmt.query_map([], |r| r.get::<_, String>(1)).unwrap().map(Result::unwrap).collect()
}

#[test]
fn generating_a_plan_creates_an_epic_scoped_run_with_no_task_stage_or_worktree() {
    let fx = git_fx();
    let start = fx.begin().unwrap();
    let conn = fx.conn();
    let (epic, task, stage, worktree, status, mode): (Option<String>, Option<String>, Option<String>, Option<String>, String, String) = conn
        .query_row(
            "SELECT epic_id, task_id, authoring_stage, worktree_id, status, permission_mode FROM agent_runs WHERE id = ?1",
            [&start.run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .unwrap();
    assert_eq!(epic.as_deref(), Some(fx.epic_id.as_str()));
    assert_eq!((task, stage, worktree), (None, None, None));
    assert_eq!((status.as_str(), mode.as_str()), ("running", "default"));
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM dispatch_plans", []), 0, "no plan row until a valid submission");
    // No run-kind column was added to the run table: a planning run is told apart by shape.
    let cols = column_names(&conn, "agent_runs");
    assert!(!cols.iter().any(|c| c.contains("kind")), "unexpected column in {cols:?}");
}

#[test]
fn a_fresh_epic_gets_its_integration_branch_through_the_lazy_cut_path() {
    let fx = git_fx();
    let before: Option<String> =
        fx.conn().query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&fx.epic_id], |r| r.get(0)).unwrap();
    assert_eq!(before, None);
    fx.begin().unwrap();
    let branch: String =
        fx.conn().query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&fx.epic_id], |r| r.get(0)).unwrap();
    assert!(!git_in(fx.repo.path(), &["rev-parse", "--verify", &branch]).is_empty());
    assert_eq!(events_of(&fx.conn(), "epic.integration_branch_created").len(), 1, "cut by the sanctioned path, once");
}

#[test]
fn the_run_works_in_the_epic_integration_worktree_checked_out_on_that_branch() {
    let fx = git_fx();
    let start = fx.begin().unwrap();
    let branch: String =
        fx.conn().query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&fx.epic_id], |r| r.get(0)).unwrap();
    assert_eq!(start.worktree_path, fx.worktrees.path().join("FLY").join(&fx.epic_key));
    assert!(start.worktree_path.join(".git").exists());
    assert_eq!(git_in(&start.worktree_path, &["rev-parse", "--abbrev-ref", "HEAD"]), branch);
    // A second start reuses the worktree rather than failing on it.
    fx.conn().execute("UPDATE agent_runs SET status = 'completed' WHERE id = ?1", [&start.run_id]).unwrap();
    assert_eq!(fx.begin().unwrap().worktree_path, start.worktree_path);
}

#[test]
fn the_run_is_armed_with_an_empty_scope_so_every_file_write_is_denied() {
    let fx = git_fx();
    let start = fx.begin().unwrap();
    let marker = core::runtime_protocol::read_scope_marker(&start.run_id).expect("the run records its own scope");
    assert_eq!(marker.mode, core::runtime_protocol::ScopeMode::Armed);
    assert!(marker.entries.is_empty(), "armed over an empty set covers no path");
    assert_eq!(marker.worktree_root, std::fs::canonicalize(&start.worktree_path).unwrap().to_string_lossy());
    let _ = &fx.runtime;
}

#[test]
fn a_run_that_cannot_record_its_state_does_not_start_and_leaves_nothing_behind() {
    let fx = git_fx();
    let runs = count(&fx.conn(), "SELECT COUNT(*) FROM agent_runs", []);
    let triggers = count(&fx.conn(), "SELECT COUNT(*) FROM triggers", []);
    let events = count(&fx.conn(), "SELECT COUNT(*) FROM events WHERE event_type = 'agent_run.started'", []);
    let err = begin_planning_run_with(&fx.db, &fx.epic_id, &fx.human, "default", |_, _| {
        Err(anyhow::anyhow!("disk full"))
    })
    .unwrap_err();
    assert!(format!("{err:#}").contains("disk full"), "{err:#}");
    let conn = fx.conn();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM agent_runs", []), runs, "no run row");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM triggers", []), triggers, "no trigger row");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'agent_run.started'", []), events);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM dispatch_plans", []), 0, "no draft plan row");
}

#[test]
fn generating_while_a_live_plan_exists_is_refused_before_any_run_row_is_inserted() {
    let fx = git_fx();
    {
        let mut conn = fx.conn();
        let tx = conn.transaction().unwrap();
        create_draft_plan_in_tx(&tx, &fx.epic_id, None, &fx.human, NOW).unwrap();
        tx.commit().unwrap();
    }
    let runs = count(&fx.conn(), "SELECT COUNT(*) FROM agent_runs", []);
    let err = fx.begin().unwrap_err();
    assert!(err.to_string().contains("live plan"), "{err}");
    assert_eq!(count(&fx.conn(), "SELECT COUNT(*) FROM agent_runs", []), runs);
    assert!(check_can_plan(&fx.conn(), &fx.epic_id).is_err());
}

#[test]
fn a_second_planning_run_while_one_is_running_and_an_epic_with_nothing_to_plan_are_refused() {
    let fx = git_fx();
    let first = fx.begin().unwrap();
    assert!(fx.begin().unwrap_err().to_string().contains("already"), "one planning run per epic at a time");
    fx.conn().execute("UPDATE agent_runs SET status = 'interrupted' WHERE id = ?1", [&first.run_id]).unwrap();
    fx.conn().execute("UPDATE tasks SET status = 'done' WHERE epic_id = ?1", [&fx.epic_id]).unwrap();
    assert!(fx.begin().unwrap_err().to_string().contains("nothing to plan"));
}

#[test]
fn the_planning_run_holds_a_slot_and_is_never_refused_by_the_cap() {
    let fx = git_fx();
    {
        let mut conn = fx.conn();
        core::domain::settings::set_dispatch_max_parallel(&mut conn, &fx.human, 1).unwrap();
        // The cap is already reached by another run on the account.
        let other = create_task(&mut conn, &fx.project_id, &fx.human, "Elsewhere", None).unwrap();
        insert_run(&conn, &fx.project_id, None, Some(&other.id), None, "running");
        assert_eq!(occupied_slots(&conn).unwrap(), 1);
    }
    let start = fx.begin().expect("a user-initiated planning run is not gated by the dispatcher's cap");
    let conn = fx.conn();
    assert_eq!(occupied_slots(&conn).unwrap(), 2, "it holds a slot like any other session");
    drop(conn);
    fx.conn().execute("UPDATE agent_runs SET status = 'completed' WHERE id = ?1", [&start.run_id]).unwrap();
    assert_eq!(occupied_slots(&fx.conn()).unwrap(), 1);
}

#[test]
fn the_epic_worktree_has_no_uncommitted_entries_after_the_run_completes() {
    let fx = git_fx();
    let start = fx.begin().unwrap();
    assert!(core::domain::worktree::porcelain_entries(&start.worktree_path).unwrap().is_empty());
    close_agent_run(&mut fx.conn(), &start.run_id, AgentRunStatus::Completed, None, None, None).unwrap();
    assert!(
        core::domain::worktree::porcelain_entries(&start.worktree_path).unwrap().is_empty(),
        "a dirty integration worktree would strand every later merge"
    );
}

#[test]
fn a_run_started_this_way_can_submit_and_the_draft_references_it() {
    let fx = git_fx();
    let start = fx.begin().unwrap();
    let (k0, k1, k2) = (fx.tasks[0].1.clone(), fx.tasks[1].1.clone(), fx.tasks[2].1.clone());
    let mut conn = fx.conn();
    let run = resolve_planning_run(&conn, &start.run_id).unwrap();
    let plan = SubmittedPlan {
        tasks: vec![st(&k0, &["src/parser.rs"], 1), st(&k1, &["src/render.rs"], 1), st(&k2, &["docs/"], 2)],
        excluded: vec![],
    };
    let plan_id = store_submitted_plan(&mut conn, &run.run_id, &run.epic_id, &plan, &run.actor_id, NOW).unwrap();
    let stored: Option<String> =
        conn.query_row("SELECT planning_run_id FROM dispatch_plans WHERE id = ?1", [&plan_id], |r| r.get(0)).unwrap();
    assert_eq!(stored.as_deref(), Some(start.run_id.as_str()));
}

fn roster_prompt(fx: &Git) -> String {
    let conn = fx.conn();
    let packet = assemble_epic_context_packet(&conn, &fx.project_id, Some(&fx.epic_id)).unwrap();
    render_planning_prompt(&packet)
}

#[test]
fn the_prompt_names_every_task_and_asks_for_files_waves_lockfiles_and_a_reason_for_every_exclusion() {
    let fx = git_fx();
    let prompt = roster_prompt(&fx);
    for (_, key) in &fx.tasks {
        assert!(prompt.contains(key.as_str()), "task key {key} missing from the prompt");
    }
    for needle in ["Parser", "Renderer", "Docs", "Parses a trailing comma", "Make the thing parallel"] {
        assert!(prompt.contains(needle), "{needle} missing");
    }
    // The two permitted entry forms, and the refusal of everything else.
    assert!(prompt.contains("src/api/"), "a directory prefix example");
    assert!(prompt.contains("src/lib.rs"), "an exact path example");
    assert!(prompt.to_lowercase().contains("glob"), "must say globs are rejected");
    // Several tasks adding dependencies each touch the same lockfile.
    assert!(prompt.to_lowercase().contains("lockfile"));
    assert!(prompt.to_lowercase().contains("manifest"));
    // Every task named, or left out with a reason; and the tool and the posture.
    assert!(prompt.contains("submit_plan"));
    assert!(prompt.to_lowercase().contains("reason"));
    assert!(prompt.to_lowercase().contains("wave"));
    assert!(prompt.to_lowercase().contains("do not modify"), "the run is read-only");
}

#[test]
fn two_renders_of_the_same_board_state_are_byte_identical() {
    let fx = git_fx();
    let a = roster_prompt(&fx);
    let b = roster_prompt(&fx);
    assert!(!a.is_empty());
    assert_eq!(a.as_bytes(), b.as_bytes());
    // And the prompt a real start hands back is the same render.
    assert_eq!(fx.begin().unwrap().prompt.as_bytes(), a.as_bytes());
}
