//! `query::epic_progress` coverage (phase 08.1 plan 05, D-05/D-06): the epic roster's numbers come
//! from one grouped read over EVERY task, never from the board's 200-row window (RESEARCH
//! Correction 3 / Pitfall 1 — the real board holds 920 rows and the window held 200, zero of them
//! in progress). The load-bearing case is `every_epics_total_equals_a_direct_count_past_the_window`:
//! it is what stops a row window from ever creeping back into these figures.

mod common;

use core::domain::epic::{create_epic, EPIC_ROSTER_CEILING};
use core::ids::new_id;
use core::query::epic_progress::{board_epic_progress, EpicProgress};
use rusqlite::{params, Connection};

use common::seeded_project;

/// Mirrors `commands/board.rs`'s `DEFAULT_LIMIT` — the window every unscoped board read lands on.
/// A fixture must hold more tasks than this for the total-equals-count case to be able to fail.
const BOARD_DEFAULT_LIMIT: usize = 200;

const NOW: &str = "2026-01-01T00:00:00.000Z";

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

    fn epic(&mut self, title: &str) -> String {
        create_epic(&mut self.conn, &self.project_id, &self.actor_id, title, None)
            .expect("create_epic should succeed")
            .id
    }

    /// One raw `INSERT` into `tasks` (the same base-table path `create_task` uses) so a fixture of
    /// several hundred rows stays fast and each row's status is chosen exactly.
    fn task(&mut self, epic_id: Option<&str>, status: &str) -> String {
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
                    format!("EP-{}", self.next),
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

    fn tasks(&mut self, epic_id: Option<&str>, status: &str, n: usize) -> Vec<String> {
        (0..n).map(|_| self.task(epic_id, status)).collect()
    }

    fn criterion(&mut self, task_id: &str, checked: bool, superseded: bool) {
        self.conn
            .execute(
                "INSERT INTO acceptance_criteria (
                    id, parent_type, parent_id, statement, verification_hint, checked, rank,
                    created_by, created_at, updated_at, superseded_at
                ) VALUES (?1, 'task', ?2, 'a criterion', NULL, ?3, '1', ?4, ?5, ?5, ?6)",
                params![
                    new_id(),
                    task_id,
                    i64::from(checked),
                    self.actor_id,
                    NOW,
                    superseded.then_some(NOW)
                ],
            )
            .expect("insert criterion");
    }

    fn agent_run(&mut self, task_id: &str, status: &str) {
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
                ) VALUES (?1, NULL, ?2, ?3, ?4, 'claude_code', ?5, ?6, NULL, 'default', NULL, NULL, NULL, ?7, ?8, NULL)",
                params![
                    run_id,
                    task_id,
                    self.project_id,
                    trigger_id,
                    self.actor_id,
                    status,
                    format!("/tmp/log-{run_id}.jsonl"),
                    NOW
                ],
            )
            .expect("insert agent_run");
    }

    fn progress(&self) -> Vec<EpicProgress> {
        board_epic_progress(&self.conn, &self.project_id, EPIC_ROSTER_CEILING as usize)
            .expect("board_epic_progress should succeed")
    }

    fn direct_count(&self, epic_id: Option<&str>) -> u32 {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE project_id = ?1 AND epic_id IS ?2",
                params![self.project_id, epic_id],
                |row| row.get(0),
            )
            .expect("direct count")
    }
}

fn of<'a>(all: &'a [EpicProgress], epic_id: Option<&str>) -> &'a EpicProgress {
    all.iter()
        .find(|p| p.epic_id.as_deref() == epic_id)
        .unwrap_or_else(|| panic!("no progress entry for epic {epic_id:?}"))
}

#[test]
fn an_epic_with_sixty_tasks_and_twelve_done_reports_sixty_and_twelve() {
    let mut fx = Fx::new();
    let epic = fx.epic("Big epic");
    fx.tasks(Some(&epic), "done", 12);
    fx.tasks(Some(&epic), "in_progress", 8);
    fx.tasks(Some(&epic), "backlog", 40);

    let all = fx.progress();
    let p = of(&all, Some(&epic));
    assert_eq!(p.total, 60);
    assert_eq!(p.done, 12);
    assert_eq!(
        p.by_status,
        vec![
            ("backlog".to_string(), 40),
            ("in_progress".to_string(), 8),
            ("done".to_string(), 12)
        ],
        "the strip is the real distribution, in the board's fixed band order"
    );
}

#[test]
fn every_epics_total_equals_a_direct_count_past_the_window() {
    let mut fx = Fx::new();
    let a = fx.epic("A");
    let b = fx.epic("B");
    let c = fx.epic("C");
    // Backlog sorts first and fills the window; the in-progress and done rows sit far past it —
    // exactly the real board's shape (RESEARCH Correction 3).
    fx.tasks(Some(&a), "backlog", 150);
    fx.tasks(Some(&b), "backlog", 60);
    fx.tasks(None, "backlog", 30);
    fx.tasks(Some(&a), "in_progress", 9);
    fx.tasks(Some(&c), "in_review", 7);
    fx.tasks(Some(&c), "done", 11);
    fx.tasks(None, "in_review", 5);

    let direct_total: u32 = [Some(&a), Some(&b), Some(&c), None]
        .iter()
        .map(|e| fx.direct_count(e.map(String::as_str)))
        .sum();
    assert!(
        direct_total as usize > BOARD_DEFAULT_LIMIT,
        "the fixture must hold more tasks than the board's default window or this test cannot fail"
    );

    let all = fx.progress();
    for e in [Some(a.as_str()), Some(b.as_str()), Some(c.as_str()), None] {
        let p = of(&all, e);
        assert_eq!(p.total, fx.direct_count(e), "epic {e:?}: total must be the real count");
        assert_eq!(
            p.by_status.iter().map(|(_, n)| n).sum::<u32>(),
            p.total,
            "epic {e:?}: the status strip must add up to the total"
        );
    }
    assert_eq!(of(&all, Some(&c)).done, 11, "a done row past the window is still counted");
}

#[test]
fn tasks_with_no_epic_are_a_distinct_bucket_not_dropped() {
    let mut fx = Fx::new();
    let epic = fx.epic("Has tasks");
    fx.tasks(Some(&epic), "todo", 2);
    fx.tasks(None, "in_review", 186);

    let all = fx.progress();
    assert_eq!(all.len(), 2, "one entry for the epic plus the no-epic bucket");
    let none = of(&all, None);
    assert_eq!(none.total, 186);
    assert_eq!(none.by_status, vec![("in_review".to_string(), 186)]);
}

#[test]
fn running_and_blocked_agent_runs_are_counted_per_epic() {
    let mut fx = Fx::new();
    let epic = fx.epic("Busy");
    let other = fx.epic("Quiet");
    let t = fx.tasks(Some(&epic), "in_progress", 3);
    fx.task(Some(&other), "in_progress");
    fx.agent_run(&t[0], "running");
    fx.agent_run(&t[1], "running");
    fx.agent_run(&t[2], "blocked");
    fx.agent_run(&t[2], "completed");

    let all = fx.progress();
    let p = of(&all, Some(&epic));
    assert_eq!((p.agents_running, p.agents_blocked), (2, 1));
    let q = of(&all, Some(&other));
    assert_eq!((q.agents_running, q.agents_blocked), (0, 0));
}

#[test]
fn an_epic_with_no_criteria_reports_them_absent_not_zero_of_zero() {
    let mut fx = Fx::new();
    let bare = fx.epic("No criteria");
    let unchecked = fx.epic("Criteria, none checked");
    fx.tasks(Some(&bare), "todo", 2);
    let t = fx.task(Some(&unchecked), "todo");
    fx.criterion(&t, false, false);

    let all = fx.progress();
    assert_eq!(of(&all, Some(&bare)).criteria, None, "absent is a distinct value from 0 of 0");
    assert_eq!(
        of(&all, Some(&unchecked)).criteria,
        Some((0, 1)),
        "a real criterion that is unchecked is 0 of 1, not absent"
    );
}

#[test]
fn three_criteria_with_one_checked_reports_one_of_three_and_ignores_superseded_revisions() {
    let mut fx = Fx::new();
    let epic = fx.epic("Criteria");
    let a = fx.task(Some(&epic), "in_progress");
    let b = fx.task(Some(&epic), "todo");
    fx.criterion(&a, true, false);
    fx.criterion(&a, false, false);
    fx.criterion(&b, false, false);
    // A revised-away criterion must not inflate the denominator (same rule as the board badge).
    fx.criterion(&b, true, true);

    let all = fx.progress();
    assert_eq!(of(&all, Some(&epic)).criteria, Some((1, 3)));
}

#[test]
fn more_epics_than_the_cap_is_reported_as_truncation_not_a_short_list() {
    let mut fx = Fx::new();
    for i in 0..3 {
        let e = fx.epic(&format!("Epic {i}"));
        fx.task(Some(&e), "todo");
    }

    let ok = board_epic_progress(&fx.conn, &fx.project_id, 3).expect("exactly at the cap is fine");
    assert_eq!(ok.len(), 3);

    let err = board_epic_progress(&fx.conn, &fx.project_id, 2)
        .expect_err("one epic past the cap must be an error, not a silently short list");
    assert!(
        format!("{err:#}").contains("truncated"),
        "the error must name truncation, got: {err:#}"
    );
}
