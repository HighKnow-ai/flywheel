//! Phase 14 plan 14-01 (RECD-08, RECD-09): the Cycle record, its human-only start, and the
//! progress fold the board's sticky region prints. The load-bearing cases are
//! `the_fold_equals_a_direct_count_over_a_thousand_tasks` (no row window can creep into the
//! figure) and `the_fold_reads_no_row_window_and_imposes_no_order` (the same property, asserted
//! over the module's own source text, with a planted body proving the gate fires).
//!
//! Self-contained per this repo's precedent: the only shared helper used is `common::seeded_project`.

mod common;

use core::domain::actor::system_actor;
use core::domain::cycle::{
    active_cycle, assign_epic_to_cycle, create_cycle, remove_epic_from_cycle, start_cycle,
};
use core::domain::epic::create_epic;
use core::ids::new_id;
use core::query::cycle_progress::cycle_progress;
use rusqlite::{params, Connection};

use common::seeded_project;

const NOW: &str = "2026-01-01T00:00:00.000Z";

/// The SQL clauses that would window or order a fold. Declared once; the gate and its planted
/// half both read it.
const WINDOWING_CLAUSES: [&str; 3] = ["limit", "order by", "offset"];

struct Fx {
    conn: Connection,
    actor_id: String,
    project_id: String,
    next: usize,
}

impl Fx {
    fn new() -> Self {
        let (conn, actor_id, project) = seeded_project();
        Fx { conn, actor_id, project_id: project.id, next: 0 }
    }

    fn cycle(&mut self, goal: &str) -> String {
        create_cycle(&mut self.conn, &self.project_id, goal, &self.actor_id)
            .expect("create_cycle should succeed")
            .id
    }

    fn epic(&mut self, title: &str) -> String {
        create_epic(&mut self.conn, &self.project_id, &self.actor_id, title, None)
            .expect("create_epic should succeed")
            .id
    }

    fn task(&mut self, epic_id: &str, status: &str) -> String {
        let id = new_id();
        self.next += 1;
        self.conn
            .execute(
                "INSERT INTO tasks (
                    id, project_id, epic_id, key, title, description, status, rank, priority,
                    assignee_id, created_by, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, 0, NULL, ?8, ?9, ?9)",
                params![
                    id,
                    self.project_id,
                    epic_id,
                    format!("CY-{}", self.next),
                    format!("task {}", self.next),
                    status,
                    format!("{:08}", self.next),
                    self.actor_id,
                    NOW
                ],
            )
            .expect("insert task");
        id
    }

    fn running_agent(&mut self, task_id: &str) {
        let trigger_id = new_id();
        self.conn
            .execute(
                "INSERT INTO triggers (
                    id, project_id, target_task_id, source, config, enabled, last_fired_at,
                    created_by, created_at
                ) VALUES (?1, ?2, ?3, 'user_action', NULL, 1, ?4, ?5, ?4)",
                params![trigger_id, self.project_id, task_id, NOW, self.actor_id],
            )
            .expect("insert trigger");
        let run_id = new_id();
        self.conn
            .execute(
                "INSERT INTO agent_runs (
                    id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
                    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
                    started_at, ended_at
                ) VALUES (?1, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', NULL, NULL, NULL, ?6, ?7, NULL)",
                params![run_id, task_id, self.project_id, trigger_id, self.actor_id, format!("/tmp/{run_id}"), NOW],
            )
            .expect("insert agent_run");
    }

    fn state_of(&self, cycle_id: &str) -> String {
        self.conn
            .query_row("SELECT state FROM cycles WHERE id = ?1", params![cycle_id], |r| r.get(0))
            .expect("cycle state")
    }

    fn event_count(&self, event_type: &str) -> i64 {
        self.conn
            .query_row("SELECT COUNT(*) FROM events WHERE event_type = ?1", params![event_type], |r| r.get(0))
            .expect("event count")
    }

    fn cycle_of(&self, epic_id: &str) -> Option<String> {
        self.conn
            .query_row("SELECT cycle_id FROM epics WHERE id = ?1", params![epic_id], |r| r.get(0))
            .expect("epic cycle")
    }
}

#[test]
fn the_fold_sums_every_task_of_every_epic_in_the_cycle() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("Ship the board");
    let (a, b) = (fx.epic("A"), fx.epic("B"));
    for epic in [&a, &b] {
        assign_epic_to_cycle(&mut fx.conn, epic, &cycle, &fx.actor_id.clone()).expect("assign");
    }
    let mut first = None;
    for (i, status) in ["done", "done", "todo", "backlog"].iter().enumerate() {
        let id = fx.task(&a, status);
        if i == 2 {
            first = Some(id);
        }
    }
    for status in ["done", "in_progress", "in_progress", "todo", "todo", "backlog"] {
        fx.task(&b, status);
    }
    fx.running_agent(&first.expect("a task"));

    let p = cycle_progress(&fx.conn, &cycle).expect("fold");
    assert_eq!((p.epics, p.tasks_total, p.tasks_done), (2, 10, 3));
    assert_eq!((p.agents_running, p.agents_blocked), (1, 0));
}

#[test]
fn the_fold_equals_a_direct_count_over_a_thousand_tasks() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("Drain it");
    let epic = fx.epic("Big");
    assign_epic_to_cycle(&mut fx.conn, &epic, &cycle, &fx.actor_id.clone()).expect("assign");
    for i in 0..1000 {
        fx.task(&epic, if i % 4 == 0 { "done" } else { "todo" });
    }
    let direct: u32 = fx
        .conn
        .query_row(
            "SELECT COUNT(*) FROM tasks t JOIN epics e ON e.id = t.epic_id WHERE e.cycle_id = ?1",
            params![cycle],
            |r| r.get(0),
        )
        .expect("direct count");
    let p = cycle_progress(&fx.conn, &cycle).expect("fold");
    assert_eq!(p.tasks_total, direct);
    assert_eq!((p.tasks_total, p.tasks_done), (1000, 250));
}

#[test]
fn the_fold_ignores_epics_in_other_cycles_and_in_none() {
    let mut fx = Fx::new();
    let (c1, c2) = (fx.cycle("One"), fx.cycle("Two"));
    let (a, b, loose) = (fx.epic("A"), fx.epic("B"), fx.epic("Loose"));
    let actor = fx.actor_id.clone();
    assign_epic_to_cycle(&mut fx.conn, &a, &c1, &actor).expect("assign");
    assign_epic_to_cycle(&mut fx.conn, &b, &c2, &actor).expect("assign");
    fx.task(&a, "done");
    fx.task(&b, "todo");
    fx.task(&b, "todo");
    fx.task(&loose, "todo");
    let p = cycle_progress(&fx.conn, &c1).expect("fold");
    assert_eq!((p.epics, p.tasks_total, p.tasks_done), (1, 1, 1));
}

#[test]
fn start_cycle_refuses_a_non_human_actor_and_leaves_state_unchanged() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("Goal");
    let system = system_actor(&fx.conn).expect("system actor").id;
    let err = start_cycle(&mut fx.conn, &cycle, &system).expect_err("a system actor must be refused");
    assert!(err.to_string().contains("only a human may do this"), "got: {err}");
    assert_eq!(fx.state_of(&cycle), "planned");
    assert_eq!(fx.event_count("cycle.started"), 0);
}

#[test]
fn start_cycle_by_the_human_activates_and_appends_one_event() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("Goal");
    let actor = fx.actor_id.clone();
    start_cycle(&mut fx.conn, &cycle, &actor).expect("start");
    assert_eq!(fx.state_of(&cycle), "active");
    assert_eq!(fx.event_count("cycle.started"), 1);
    assert_eq!(fx.event_count("cycle.created"), 1);
}

#[test]
fn a_second_active_cycle_is_refused_by_the_partial_unique_index() {
    let mut fx = Fx::new();
    let (c1, c2) = (fx.cycle("One"), fx.cycle("Two"));
    let actor = fx.actor_id.clone();
    start_cycle(&mut fx.conn, &c1, &actor).expect("start first");
    let err = start_cycle(&mut fx.conn, &c2, &actor).expect_err("second active must fail");
    assert!(format!("{err:#}").contains("UNIQUE"), "the refusal must come from SQLite: {err:#}");
    assert_eq!(fx.state_of(&c2), "planned");
    assert_eq!(fx.event_count("cycle.started"), 1, "the failed start must not leave an event behind");
}

#[test]
fn assigning_an_epic_replaces_its_cycle_and_never_leaves_it_in_two() {
    let mut fx = Fx::new();
    let (c1, c2) = (fx.cycle("One"), fx.cycle("Two"));
    let epic = fx.epic("E");
    let actor = fx.actor_id.clone();
    assign_epic_to_cycle(&mut fx.conn, &epic, &c1, &actor).expect("assign 1");
    assign_epic_to_cycle(&mut fx.conn, &epic, &c2, &actor).expect("assign 2");
    assert_eq!(fx.cycle_of(&epic).as_deref(), Some(c2.as_str()));
    assert_eq!(fx.event_count("cycle.epic_assigned"), 2);
    remove_epic_from_cycle(&mut fx.conn, &epic, &actor).expect("remove");
    assert_eq!(fx.cycle_of(&epic), None);
    assert_eq!(fx.event_count("cycle.epic_removed"), 1);
}

#[test]
fn active_cycle_is_none_without_one_and_is_scoped_to_its_project() {
    let mut fx = Fx::new();
    assert!(active_cycle(&fx.conn, &fx.project_id).expect("read").is_none());
    let cycle = fx.cycle("Goal");
    let actor = fx.actor_id.clone();
    assert!(active_cycle(&fx.conn, &fx.project_id).expect("read").is_none(), "planned is not active");
    start_cycle(&mut fx.conn, &cycle, &actor).expect("start");
    let found = active_cycle(&fx.conn, &fx.project_id).expect("read").expect("an active cycle");
    assert_eq!((found.id.as_str(), found.goal.as_str(), found.state.as_str()), (cycle.as_str(), "Goal", "active"));
    assert!(active_cycle(&fx.conn, "some-other-project").expect("read").is_none());
}

#[test]
fn cycles_rank_in_creation_order() {
    let mut fx = Fx::new();
    let ranks: Vec<String> = (0..3)
        .map(|i| {
            create_cycle(&mut fx.conn, &fx.project_id, &format!("g{i}"), &fx.actor_id)
                .expect("create")
                .rank
        })
        .collect();
    assert!(ranks.windows(2).all(|w| w[0] < w[1]), "ranks must ascend: {ranks:?}");
}

/// Statements of `body` that name a windowing or ordering clause, skipping whole-line comments.
fn windowing_offenders(body: &str) -> Vec<String> {
    body.lines()
        .filter(|line| !line.trim_start().starts_with("//"))
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            WINDOWING_CLAUSES.iter().any(|clause| lower.contains(clause))
        })
        .map(|line| line.trim().to_string())
        .collect()
}

#[test]
fn the_fold_reads_no_row_window_and_imposes_no_order() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/query/cycle_progress.rs");
    let body = std::fs::read_to_string(&path).expect("cycle_progress.rs should be readable");
    assert!(body.contains("GROUP BY"), "the gate must be reading the real fold");
    let offenders = windowing_offenders(&body);
    assert!(offenders.is_empty(), "the Cycle fold must read every task: {offenders:?}");
}

#[test]
fn the_windowing_gate_fires_on_a_planted_body_and_stays_silent_on_a_clean_one() {
    let planted = "// a comment naming limit is fine\nlet sql = \"SELECT x FROM t ORDER BY y LIMIT 5\";";
    assert_eq!(windowing_offenders(planted).len(), 1, "a planted window must be caught");
    let clean = "// ORDER BY in a comment\nlet sql = \"SELECT x, COUNT(*) FROM t GROUP BY x\";";
    assert!(windowing_offenders(clean).is_empty(), "a legitimate grouped read must stay open");
}
