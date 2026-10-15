//! Phase 14 plan 14-02 (criterion 1, D-08, T-14-02-01): the Cycle region's number is a FULL count,
//! not a plausible one. The real board is about 920 rows and its unscoped list is a 200-row page
//! over them (RESEARCH Correction 3), so a figure derived from that page would be plausible and
//! wrong. These cases prove the fold equals an independent `COUNT(*)` over a board larger than a
//! page, that it is strictly larger than the page, and that every empty edge is a stated zero.
//!
//! Self-contained per this repo's precedent: its own volume fixture over `common::seeded_project`
//! (which already leaks its temp dir, as `perf_seed_1000.rs` does); `common/mod.rs` is not edited.

mod common;

use core::domain::cycle::{assign_epic_to_cycle, create_cycle, start_cycle};
use core::domain::epic::create_epic;
use core::ids::new_id;
use core::query::authoring::DEFAULT_LIMIT;
use core::query::cycle_progress::cycle_progress;
use core::query::filter::BoardFilter;
use core::query::list_board;
use rusqlite::{params, Connection};

use common::seeded_project;

/// Above 900 on purpose: the real board is about 920 rows, and the board's unscoped list is a
/// 200-row page over it. A fixture at or under the page size could not tell a full count from a
/// windowed one.
const VOLUME_TASKS: usize = 940;

/// Cycles through every workflow status so `done` is a strict subset of the total.
const STATUSES: [&str; 5] = ["backlog", "todo", "in_progress", "in_review", "done"];

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

    fn cycle(&mut self, goal: &str) -> String {
        create_cycle(&mut self.conn, &self.project_id, goal, &self.actor_id).expect("create_cycle").id
    }

    fn epic_in(&mut self, title: &str, cycle_id: Option<&str>) -> String {
        let epic = create_epic(&mut self.conn, &self.project_id, &self.actor_id, title, None)
            .expect("create_epic")
            .id;
        if let Some(cycle_id) = cycle_id {
            let actor = self.actor_id.clone();
            assign_epic_to_cycle(&mut self.conn, &epic, cycle_id, &actor).expect("assign");
        }
        epic
    }

    /// `n` tasks under `epic_id`, statuses cycling through [`STATUSES`], in one transaction.
    fn tasks(&mut self, epic_id: &str, n: usize) {
        let tx = self.conn.transaction().expect("tx");
        for i in 0..n {
            self.next += 1;
            tx.execute(
                "INSERT INTO tasks (
                    id, project_id, epic_id, key, title, description, status, rank, priority,
                    assignee_id, created_by, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, 0, NULL, ?8, ?9, ?9)",
                params![
                    new_id(),
                    self.project_id,
                    epic_id,
                    format!("VL-{}", self.next),
                    format!("task {}", self.next),
                    STATUSES[i % STATUSES.len()],
                    format!("{:08}", self.next),
                    self.actor_id,
                    NOW
                ],
            )
            .expect("insert task");
        }
        tx.commit().expect("commit");
    }

    /// The expected totals, from a statement that shares nothing with the fold.
    fn full_count(&self, cycle_id: &str, only_done: bool) -> u32 {
        let extra = if only_done { " AND t.status = 'done'" } else { "" };
        self.conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM tasks t JOIN epics e ON e.id = t.epic_id WHERE e.cycle_id = ?1{extra}"
                ),
                params![cycle_id],
                |row| row.get(0),
            )
            .expect("independent count")
    }
}

/// One Cycle holding six epics and [`VOLUME_TASKS`] tasks, plus tasks that belong to no Cycle.
fn volume_board() -> (Fx, String) {
    let mut fx = Fx::new();
    let cycle = fx.cycle("Drain the backlog");
    let actor = fx.actor_id.clone();
    start_cycle(&mut fx.conn, &cycle, &actor).expect("start");
    let per_epic = VOLUME_TASKS / 6;
    for i in 0..6 {
        let epic = fx.epic_in(&format!("epic {i}"), Some(&cycle));
        // The last epic takes the remainder so the total is exactly VOLUME_TASKS.
        let n = if i == 5 { VOLUME_TASKS - per_epic * 5 } else { per_epic };
        fx.tasks(&epic, n);
    }
    let outside = fx.epic_in("no cycle", None);
    fx.tasks(&outside, 37);
    (fx, cycle)
}

#[test]
fn the_fold_equals_an_independent_full_count_over_more_than_900_tasks() {
    let (fx, cycle) = volume_board();
    let progress = cycle_progress(&fx.conn, &cycle).expect("fold");

    assert_eq!(progress.tasks_total as usize, VOLUME_TASKS);
    assert_eq!(progress.tasks_total, fx.full_count(&cycle, false));
    assert_eq!(progress.tasks_done, fx.full_count(&cycle, true));
    assert_eq!(progress.epics, 6);
    assert!(progress.tasks_done > 0 && progress.tasks_done < progress.tasks_total, "done is a strict subset");
}

#[test]
fn the_fold_total_is_strictly_greater_than_the_board_page() {
    let (fx, cycle) = volume_board();
    // `DEFAULT_LIMIT` is core's 200-row page convention; the board command's private page size is
    // the same 200. A fold quietly derived from a page could equal the page; this one cannot.
    let page = list_board(&fx.conn, &fx.project_id, &BoardFilter::default(), DEFAULT_LIMIT, None)
        .expect("board page");
    assert!(page.items.len() as i64 <= DEFAULT_LIMIT, "the board really is windowed");

    let progress = cycle_progress(&fx.conn, &cycle).expect("fold");
    assert!(
        i64::from(progress.tasks_total) > DEFAULT_LIMIT,
        "the fold ({}) must exceed the page ({DEFAULT_LIMIT}) or it proves nothing",
        progress.tasks_total
    );
}

#[test]
fn tasks_under_epics_in_no_cycle_are_excluded() {
    let (fx, cycle) = volume_board();
    let all_tasks: u32 = fx.conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).expect("count");
    let progress = cycle_progress(&fx.conn, &cycle).expect("fold");
    assert_eq!(all_tasks as usize, VOLUME_TASKS + 37);
    assert_eq!(progress.tasks_total as usize, VOLUME_TASKS, "the 37 outside tasks are not counted");
}

#[test]
fn tasks_of_another_cycles_epics_are_excluded() {
    let (mut fx, cycle) = volume_board();
    let other = fx.cycle("Another");
    let epic = fx.epic_in("elsewhere", Some(&other));
    fx.tasks(&epic, 11);
    assert_eq!(cycle_progress(&fx.conn, &cycle).expect("fold").tasks_total as usize, VOLUME_TASKS);
    assert_eq!(cycle_progress(&fx.conn, &other).expect("fold").tasks_total, 11);
}

#[test]
fn one_epic_with_one_task_reports_one() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("tiny");
    let epic = fx.epic_in("only", Some(&cycle));
    fx.tasks(&epic, 1);
    let progress = cycle_progress(&fx.conn, &cycle).expect("fold");
    assert_eq!((progress.epics, progress.tasks_total, progress.tasks_done), (1, 1, 0));
}

#[test]
fn one_epic_with_zero_tasks_reports_zero_tasks_without_error() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("empty epic");
    fx.epic_in("no tasks", Some(&cycle));
    let progress = cycle_progress(&fx.conn, &cycle).expect("a Cycle whose epic has no tasks is not an error");
    assert_eq!((progress.epics, progress.tasks_total, progress.tasks_done), (1, 0, 0));
}

#[test]
fn a_cycle_with_zero_epics_reports_zero_everywhere_without_error() {
    let mut fx = Fx::new();
    let cycle = fx.cycle("no epics");
    let progress = cycle_progress(&fx.conn, &cycle).expect("a Cycle with no epics is not an error");
    assert_eq!(
        (progress.epics, progress.tasks_total, progress.tasks_done, progress.agents_running, progress.agents_blocked),
        (0, 0, 0, 0, 0)
    );
}

#[test]
fn two_consecutive_folds_over_unchanged_data_are_equal() {
    let (fx, cycle) = volume_board();
    let first = cycle_progress(&fx.conn, &cycle).expect("fold");
    let second = cycle_progress(&fx.conn, &cycle).expect("fold");
    assert_eq!(first, second, "the fold imposes no order and depends on none");
}
