//! Phase 14 plan 14-02 (RECD-09, D-02): the roadmap ahead of the current Cycle. The roster is the
//! `EpicRoster` shape: a bounded read (`CYCLE_ROSTER_CEILING`), the TRUE count, and a `truncated`
//! fact the renderer must print. Order is `rank` ascending with `id` as a deterministic tie-break.
//!
//! Self-contained per this repo's precedent; the only shared helper is `common::seeded_project`.

mod common;

use core::domain::cycle::{
    assign_epic_to_cycle, create_cycle, cycle_roster, reorder_cycle, start_cycle, CYCLE_ROSTER_CEILING,
};
use core::domain::epic::create_epic;
use core::domain::project::create_project;
use core::ids::new_id;
use core::ranking::ReorderDirection;
use rusqlite::{params, Connection};

use common::seeded_project;

const NOW: &str = "2026-01-01T00:00:00.000Z";

struct Fx {
    conn: Connection,
    actor_id: String,
    project_id: String,
}

impl Fx {
    fn new() -> Self {
        let (conn, actor_id, project) = seeded_project();
        Fx { conn, actor_id, project_id: project.id }
    }

    fn cycle(&mut self, goal: &str) -> String {
        create_cycle(&mut self.conn, &self.project_id, goal, &self.actor_id)
            .expect("create_cycle should succeed")
            .id
    }

    /// Insert `n` Cycles in one transaction with zero-padded ranks, bypassing the writer so the
    /// ceiling cases do not pay for hundreds of event rows.
    fn bulk_cycles(&mut self, project_id: &str, n: i64, state: &str) {
        let tx = self.conn.transaction().expect("tx");
        for i in 0..n {
            tx.execute(
                "INSERT INTO cycles (id, project_id, key, goal, exit_criteria, state, rank, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?8)",
                params![new_id(), project_id, format!("BK-{i}"), format!("goal {i}"), state, format!("{i:08}"), self.actor_id, NOW],
            )
            .expect("insert cycle");
        }
        tx.commit().expect("commit");
    }

    fn insert_with_rank(&mut self, id: &str, rank: &str, goal: &str) {
        self.conn
            .execute(
                "INSERT INTO cycles (id, project_id, key, goal, exit_criteria, state, rank, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, 'planned', ?5, ?6, ?7, ?7)",
                params![id, self.project_id, format!("EQ-{goal}"), goal, rank, self.actor_id, NOW],
            )
            .expect("insert cycle");
    }

    fn rank_of(&self, cycle_id: &str) -> String {
        self.conn
            .query_row("SELECT rank FROM cycles WHERE id = ?1", params![cycle_id], |r| r.get(0))
            .expect("rank")
    }
}

fn goals(roster: &core::domain::cycle::CycleRoster) -> Vec<String> {
    roster.cycles.iter().map(|l| l.cycle.goal.clone()).collect()
}

#[test]
fn an_active_and_three_planned_cycles_come_back_in_rank_order_with_three_ahead() {
    let mut fx = Fx::new();
    let (now, a, b, c) = (fx.cycle("now"), fx.cycle("a"), fx.cycle("b"), fx.cycle("c"));
    let actor = fx.actor_id.clone();
    start_cycle(&mut fx.conn, &now, &actor).expect("start");
    let _ = (a, b, c);

    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(goals(&roster), ["now", "a", "b", "c"]);
    assert_eq!(roster.total, 4);
    assert!(!roster.truncated);
    let ahead: Vec<_> = roster.ahead().iter().map(|l| l.cycle.goal.clone()).collect();
    assert_eq!(ahead, ["a", "b", "c"], "the active Cycle is not ahead of itself");
}

#[test]
fn one_cycle_over_the_ceiling_returns_exactly_the_ceiling_and_says_so() {
    let mut fx = Fx::new();
    let pid = fx.project_id.clone();
    fx.bulk_cycles(&pid, CYCLE_ROSTER_CEILING + 1, "planned");

    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(roster.cycles.len() as i64, CYCLE_ROSTER_CEILING);
    assert_eq!(roster.total, CYCLE_ROSTER_CEILING + 1, "total is the true count, not the page");
    assert!(roster.truncated);
}

#[test]
fn exactly_the_ceiling_is_not_truncation() {
    let mut fx = Fx::new();
    let pid = fx.project_id.clone();
    fx.bulk_cycles(&pid, CYCLE_ROSTER_CEILING, "planned");

    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(roster.cycles.len() as i64, CYCLE_ROSTER_CEILING);
    assert_eq!(roster.total, CYCLE_ROSTER_CEILING);
    assert!(!roster.truncated, "the boundary itself is not truncation");
}

#[test]
fn two_cycles_with_equal_rank_come_back_in_the_same_order_every_read() {
    let mut fx = Fx::new();
    // Ids are chosen so id order is the reverse of insertion order: only the secondary key can
    // explain the result.
    let (hi, lo) = ("01ZZZZZZZZZZZZZZZZZZZZZZZZ", "01AAAAAAAAAAAAAAAAAAAAAAAA");
    fx.insert_with_rank(hi, "0000000a", "inserted-first");
    fx.insert_with_rank(lo, "0000000a", "inserted-second");

    let first = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    let second = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(first, second, "two reads of the same data return the same order");
    assert_eq!(goals(&first), ["inserted-second", "inserted-first"], "ties break on id ascending");
}

#[test]
fn a_closed_cycle_is_not_ahead_and_not_on_the_roster() {
    let mut fx = Fx::new();
    let closed = fx.cycle("closed");
    fx.conn.execute("UPDATE cycles SET state = 'closed' WHERE id = ?1", params![closed]).expect("close");
    let _planned = fx.cycle("planned");

    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(goals(&roster), ["planned"]);
    assert_eq!(roster.total, 1, "a closed Cycle is not part of the roadmap, so it is not counted");
    assert!(roster.ahead().iter().all(|l| l.cycle.state != "closed"));
}

#[test]
fn a_project_with_no_cycles_has_an_empty_untruncated_roster() {
    let fx = Fx::new();
    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert!(roster.cycles.is_empty());
    assert_eq!(roster.total, 0);
    assert!(!roster.truncated);
    assert!(roster.ahead().is_empty());
}

#[test]
fn each_line_carries_a_grouped_epic_count_not_a_loaded_length() {
    let mut fx = Fx::new();
    let (c1, c2, c3) = (fx.cycle("one"), fx.cycle("two"), fx.cycle("empty"));
    let _ = c3;
    for (i, cycle) in [&c1, &c1, &c1, &c2].iter().enumerate() {
        let epic = create_epic(&mut fx.conn, &fx.project_id, &fx.actor_id, &format!("epic {i}"), None)
            .expect("epic")
            .id;
        assign_epic_to_cycle(&mut fx.conn, &epic, cycle, &fx.actor_id.clone()).expect("assign");
    }
    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    let counts: Vec<u32> = roster.cycles.iter().map(|l| l.epic_count).collect();
    assert_eq!(counts, [3, 1, 0], "a Cycle with no epics counts zero, it does not vanish");
}

#[test]
fn another_projects_cycles_never_appear() {
    let mut fx = Fx::new();
    let _mine = fx.cycle("mine");
    let other = create_project(&mut fx.conn, &fx.actor_id.clone(), "Other", "/other", "OTH", "main")
        .expect("second project");
    let other_id = other.id;
    fx.bulk_cycles(&other_id, 3, "planned");

    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(goals(&roster), ["mine"]);
    assert_eq!(roster.total, 1);
}

#[test]
fn reordering_a_cycle_rewrites_exactly_one_rank_and_appends_one_event() {
    let mut fx = Fx::new();
    let (a, b, c) = (fx.cycle("a"), fx.cycle("b"), fx.cycle("c"));
    let (ra, rb, rc) = (fx.rank_of(&a), fx.rank_of(&b), fx.rank_of(&c));
    let events_before: i64 = fx
        .conn
        .query_row("SELECT COUNT(*) FROM events WHERE event_type = 'cycle.reordered'", [], |r| r.get(0))
        .expect("count");

    reorder_cycle(&mut fx.conn, &fx.actor_id.clone(), &a, ReorderDirection::Down).expect("reorder");

    assert_ne!(fx.rank_of(&a), ra, "the moved Cycle's rank changed");
    assert_eq!((fx.rank_of(&b), fx.rank_of(&c)), (rb, rc), "no other row was rewritten");
    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(goals(&roster), ["b", "a", "c"]);
    let events_after: i64 = fx
        .conn
        .query_row("SELECT COUNT(*) FROM events WHERE event_type = 'cycle.reordered'", [], |r| r.get(0))
        .expect("count");
    assert_eq!(events_after, events_before + 1);
}

#[test]
fn a_planned_cycle_ranked_before_the_active_one_is_not_ahead() {
    let mut fx = Fx::new();
    let (first, second) = (fx.cycle("first"), fx.cycle("second"));
    let _ = first;
    start_cycle(&mut fx.conn, &second, &fx.actor_id.clone()).expect("start");
    let roster = cycle_roster(&fx.conn, &fx.project_id).expect("roster");
    assert_eq!(goals(&roster), ["first", "second"]);
    assert!(roster.ahead().is_empty(), "ahead means ranked after the active Cycle");
}
