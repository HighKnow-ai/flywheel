//! Behavior under test (01-17-PLAN.md Task 1, UAT gap G-01-2): the epic roster
//! (`domain::epic::list_epics`) is a small, unwindowed, project-scoped read — unlike every other
//! board read, which is `LIMIT`-bounded (D-03). It must resolve an epic label regardless of
//! where that epic sorts relative to `list_board`'s `DEFAULT_LIMIT`/200-row page.

mod common;

use std::time::Instant;

use core::query::list_board;
use core::query::filter::BoardFilter;

use common::{seed_epics, seeded_project};

const BUDGET_MS: u128 = 50;

/// Above `commands/board.rs`'s `DEFAULT_LIMIT` of 200 — enough to make the window a strict
/// subset of the roster and to reproduce UAT gap G-01-2.
const EPIC_COUNT: usize = 250;

#[test]
fn roster_returns_every_epic_past_the_board_window() {
    let (mut conn, _actor_id, project) = seeded_project();
    let seeded_ids = seed_epics(&mut conn, &project.id, EPIC_COUNT).expect("seed_epics should succeed");

    let roster = core::domain::epic::list_epics(&conn, &project.id)
        .expect("list_epics should succeed");
    assert_eq!(
        roster.len(),
        EPIC_COUNT,
        "the roster must return every seeded epic, not a windowed subset"
    );
    let roster_ids: std::collections::HashSet<String> =
        roster.iter().map(|e| e.id.clone()).collect();
    let seeded_ids: std::collections::HashSet<String> = seeded_ids.into_iter().collect();
    assert_eq!(
        roster_ids, seeded_ids,
        "the roster's ids must be exactly the set of seeded ids"
    );

    // Prove this is genuinely a different, wider read than `list_board`'s windowed page — the
    // defect this test exists to catch.
    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None)
        .expect("list_board should succeed");
    let windowed_epic_ids: std::collections::HashSet<String> = window
        .items
        .iter()
        .filter(|item| item.kind == "epic")
        .map(|item| item.id.clone())
        .collect();
    assert!(
        windowed_epic_ids.len() < roster_ids.len(),
        "the board window's epic rows must be a strict subset of the roster \
         (window: {}, roster: {})",
        windowed_epic_ids.len(),
        roster_ids.len()
    );
    assert!(
        windowed_epic_ids.is_subset(&roster_ids),
        "every windowed epic id must also be present in the roster"
    );
}

#[test]
fn roster_is_scoped_to_one_project() {
    let (mut conn, actor_id, project_a) = seeded_project();
    let project_b = core::domain::project::create_project(
        &mut conn,
        &actor_id,
        "Second Project",
        "/repo-b",
        "SEC",
        "main",
    )
    .expect("create_project should succeed");

    let ids_a = seed_epics(&mut conn, &project_a.id, 5).expect("seed_epics A should succeed");
    let ids_b = seed_epics(&mut conn, &project_b.id, 5).expect("seed_epics B should succeed");

    let roster_a = core::domain::epic::list_epics(&conn, &project_a.id)
        .expect("list_epics for project A should succeed");
    let roster_a_ids: std::collections::HashSet<String> =
        roster_a.iter().map(|e| e.id.clone()).collect();
    let expected_a: std::collections::HashSet<String> = ids_a.into_iter().collect();

    assert_eq!(roster_a_ids, expected_a, "project A's roster must be exactly project A's ids");
    for id_b in &ids_b {
        assert!(
            !roster_a_ids.contains(id_b),
            "project A's roster must never contain a project B epic id ({id_b})"
        );
    }
}

#[test]
fn roster_at_volume_is_under_the_50ms_budget() {
    let (mut conn, _actor_id, project) = seeded_project();
    seed_epics(&mut conn, &project.id, EPIC_COUNT).expect("seed_epics should succeed");

    let start = Instant::now();
    let roster = core::domain::epic::list_epics(&conn, &project.id)
        .expect("list_epics should succeed");
    let elapsed_ms = start.elapsed().as_millis();
    println!("list_epics at {EPIC_COUNT} epics: {elapsed_ms}ms");

    assert_eq!(roster.len(), EPIC_COUNT);
    assert!(
        elapsed_ms < BUDGET_MS,
        "list_epics took {elapsed_ms}ms, budget is {BUDGET_MS}ms"
    );
}
