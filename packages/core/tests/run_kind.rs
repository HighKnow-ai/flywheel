//! Run kind has ONE definition (plan 13-11, F6). Before this plan the kind of an `agent_runs` row
//! was inferred from the shape of its `task_id` / `epic_id` / `authoring_stage` columns in four SQL
//! statements and three Rust matches, each with its own copy of the rule. `RunKind::classify` is
//! the Rust definition; `RUN_KIND_PLANNING_PREDICATE` / `RUN_KIND_AUTHORING_PREDICATE` are its SQL
//! mirror. These tests pin the classifier's precedence and prove every site that used to infer the
//! kind for itself now agrees with it on a fixture holding one run of each kind.

mod common;

use core::domain::agent_run::{
    run_kind_for, RunKind, RUN_KIND_AUTHORING_PREDICATE, RUN_KIND_PLANNING_PREDICATE,
};
use core::domain::authoring_session::start_authoring_run;
use core::domain::dispatch_plan::{check_can_plan, resolve_planning_run};
use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::authoring::list_recent_authoring_runs;
use core::query::fleet::{fleet_rows, FleetSubjectKind};
use rusqlite::{params, Connection};

/// A raw `agent_runs` row (with its trigger). A real launch needs a git repository, and the kind is
/// a property of three columns, so the fixture writes the row directly.
fn insert_run(
    conn: &Connection,
    actor: &str,
    project_id: &str,
    task_id: Option<&str>,
    epic_id: Option<&str>,
    stage: Option<&str>,
    status: &str,
) -> String {
    let trigger_id = new_id();
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, 'user_action', ?5, 'now')",
        params![trigger_id, project_id, task_id, epic_id, actor],
    )
    .unwrap();
    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (id, task_id, epic_id, project_id, trigger_id, actor_id, status, permission_mode, log_path, started_at, authoring_stage)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'default', '/dev/null', ?8, ?9)",
        params![run_id, task_id, epic_id, project_id, trigger_id, actor, status, format!("t{}", new_id()), stage],
    )
    .unwrap();
    run_id
}

struct Fixture {
    conn: Connection,
    actor: String,
    project_id: String,
    epic_id: String,
    execution: String,
    planning: String,
    authoring: String,
    /// An authoring run for a fresh epic: no epic yet, no task, only a stage.
    fresh_authoring: String,
}

/// One run of each kind on one epic, all `running`.
fn fixture() -> Fixture {
    let (mut conn, actor, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor, "Epic", None).unwrap();
    let task = create_task(&mut conn, &project.id, &actor, "Task", Some(&epic.id)).unwrap();
    let execution = insert_run(&conn, &actor, &project.id, Some(&task.id), None, None, "running");
    let planning = insert_run(&conn, &actor, &project.id, None, Some(&epic.id), None, "running");
    let authoring = insert_run(&conn, &actor, &project.id, None, Some(&epic.id), Some("challenge"), "running");
    let fresh_authoring = insert_run(&conn, &actor, &project.id, None, None, Some("challenge"), "running");
    Fixture { conn, actor, project_id: project.id, epic_id: epic.id, execution, planning, authoring, fresh_authoring }
}

fn ids(conn: &Connection, sql: &str, epic_id: Option<&str>) -> Vec<String> {
    let mut stmt = conn.prepare(sql).unwrap();
    let mut rows: Vec<String> = match epic_id {
        Some(e) => stmt.query_map(params![e], |r| r.get(0)).unwrap().map(Result::unwrap).collect(),
        None => stmt.query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect(),
    };
    rows.sort();
    rows
}

// --- the Rust classifier ---------------------------------------------------------------------

#[test]
fn a_task_scoped_run_is_execution() {
    assert_eq!(RunKind::classify(Some("t"), None, None).unwrap(), RunKind::Execution);
}

#[test]
fn an_epic_scoped_run_with_no_stage_is_planning() {
    assert_eq!(RunKind::classify(None, Some("e"), None).unwrap(), RunKind::Planning);
}

#[test]
fn a_stage_wins_over_the_epic_scope() {
    assert_eq!(RunKind::classify(None, Some("e"), Some("challenge")).unwrap(), RunKind::Authoring);
}

#[test]
fn a_stage_wins_over_the_task_scope_too() {
    assert_eq!(RunKind::classify(Some("t"), None, Some("challenge")).unwrap(), RunKind::Authoring);
}

#[test]
fn that_stage_with_task_combination_does_not_occur_in_practice() {
    // The only writer of a staged run never sets a task: classify's second precedence case is a
    // defensive rule, not a reachable state.
    let (mut conn, actor, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor).unwrap();
    assert!(run.task_id.is_none(), "start_authoring_run must never scope a task");
    assert!(run.authoring_stage.is_some());
}

#[test]
fn a_stage_alone_is_authoring_a_fresh_epic_has_no_epic_yet() {
    assert_eq!(RunKind::classify(None, None, Some("challenge")).unwrap(), RunKind::Authoring);
}

#[test]
fn a_run_belonging_to_nothing_is_an_error_not_a_default() {
    assert!(RunKind::classify(None, None, None).is_err(), "an unscoped run is a bug to surface");
}

#[test]
fn the_kind_names_are_stable() {
    assert_eq!(RunKind::Execution.as_str(), "execution");
    assert_eq!(RunKind::Planning.as_str(), "planning");
    assert_eq!(RunKind::Authoring.as_str(), "authoring");
}

#[test]
fn run_kind_for_reads_the_kind_off_the_row() {
    let f = fixture();
    assert_eq!(run_kind_for(&f.conn, &f.execution).unwrap(), RunKind::Execution);
    assert_eq!(run_kind_for(&f.conn, &f.planning).unwrap(), RunKind::Planning);
    assert_eq!(run_kind_for(&f.conn, &f.authoring).unwrap(), RunKind::Authoring);
    assert_eq!(run_kind_for(&f.conn, &f.fresh_authoring).unwrap(), RunKind::Authoring);
}

#[test]
fn run_kind_for_an_unknown_id_names_the_id() {
    let f = fixture();
    let err = run_kind_for(&f.conn, "NOPE").unwrap_err();
    assert!(format!("{err:#}").contains("NOPE"), "got: {err:#}");
}

// --- the SQL mirror --------------------------------------------------------------------------

#[test]
fn the_planning_predicate_selects_only_the_planning_run() {
    let f = fixture();
    let sql = format!("SELECT id FROM agent_runs WHERE epic_id = ?1 AND {RUN_KIND_PLANNING_PREDICATE}");
    assert_eq!(ids(&f.conn, &sql, Some(&f.epic_id)), vec![f.planning.clone()]);
}

#[test]
fn the_authoring_predicate_selects_every_authoring_run_and_nothing_else() {
    let f = fixture();
    let sql = format!("SELECT id FROM agent_runs WHERE {RUN_KIND_AUTHORING_PREDICATE}");
    let mut expect = vec![f.authoring.clone(), f.fresh_authoring.clone()];
    expect.sort();
    assert_eq!(ids(&f.conn, &sql, None), expect);
}

#[test]
fn the_two_predicates_agree_with_classify_for_every_fixture_run() {
    let f = fixture();
    for (id, kind) in [
        (&f.execution, RunKind::Execution),
        (&f.planning, RunKind::Planning),
        (&f.authoring, RunKind::Authoring),
        (&f.fresh_authoring, RunKind::Authoring),
    ] {
        let in_planning: bool = f
            .conn
            .query_row(
                &format!("SELECT COUNT(*) FROM agent_runs WHERE id = ?1 AND {RUN_KIND_PLANNING_PREDICATE}"),
                params![id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        let in_authoring: bool = f
            .conn
            .query_row(
                &format!("SELECT COUNT(*) FROM agent_runs WHERE id = ?1 AND {RUN_KIND_AUTHORING_PREDICATE}"),
                params![id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
            > 0;
        // The planning predicate alone also matches a run with neither task nor epic and no stage,
        // which classify refuses — no such run exists in this fixture.
        assert_eq!(in_planning, kind == RunKind::Planning, "planning predicate vs classify for {kind:?}");
        assert_eq!(in_authoring, kind == RunKind::Authoring, "authoring predicate vs classify for {kind:?}");
    }
}

// --- the former inference sites --------------------------------------------------------------

#[test]
fn check_can_plan_refuses_a_second_planning_run_but_not_because_of_an_authoring_run() {
    let f = fixture();
    // Close the planning run so only the authoring run is live on the epic: planning must be allowed.
    f.conn
        .execute("UPDATE agent_runs SET status = 'completed' WHERE id = ?1", params![f.planning])
        .unwrap();
    check_can_plan(&f.conn, &f.epic_id).expect("a live authoring run is not a planning run");
    // And a live planning run is refused.
    f.conn
        .execute("UPDATE agent_runs SET status = 'running' WHERE id = ?1", params![f.planning])
        .unwrap();
    let err = check_can_plan(&f.conn, &f.epic_id).unwrap_err();
    assert!(format!("{err:#}").contains("already being planned"), "got: {err:#}");
}

#[test]
fn list_recent_authoring_runs_returns_the_authoring_runs_only() {
    let f = fixture();
    let mut got: Vec<String> =
        list_recent_authoring_runs(&f.conn, 50).unwrap().into_iter().map(|r| r.run_id).collect();
    got.sort();
    let mut expect = vec![f.authoring.clone(), f.fresh_authoring.clone()];
    expect.sort();
    assert_eq!(got, expect);
}

#[test]
fn resolve_planning_run_accepts_only_the_planning_run() {
    let f = fixture();
    assert_eq!(resolve_planning_run(&f.conn, &f.planning).unwrap().epic_id, f.epic_id);
    assert!(resolve_planning_run(&f.conn, &f.authoring).is_err());
    assert!(resolve_planning_run(&f.conn, &f.execution).is_err());
    assert!(resolve_planning_run(&f.conn, &f.fresh_authoring).is_err());
}

#[test]
fn the_fleet_subject_kind_follows_the_classifier() {
    let f = fixture();
    let list = fleet_rows(&f.conn, 50).unwrap();
    let kind_of = |id: &str| list.rows.iter().find(|r| r.agent_run_id == id).unwrap().subject_kind;
    assert_eq!(kind_of(&f.execution), FleetSubjectKind::Task);
    assert_eq!(kind_of(&f.planning), FleetSubjectKind::Epic);
    assert_eq!(kind_of(&f.authoring), FleetSubjectKind::Authoring);
    assert_eq!(kind_of(&f.fresh_authoring), FleetSubjectKind::Authoring);
    let _ = (&f.actor, &f.project_id);
}
