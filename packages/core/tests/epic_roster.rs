//! Behavior under test (01-17-PLAN.md Task 1, UAT gap G-01-2): the epic roster
//! (`domain::epic::list_epics`) is a small, unwindowed, project-scoped read — unlike every other
//! board read, which is `LIMIT`-bounded (D-03). It must resolve an epic label regardless of
//! where that epic sorts relative to `list_board`'s `DEFAULT_LIMIT`/200-row page.
//!
//! 01-18-PLAN.md Task 3 extends this file with the roster's ordering, tie-break, idempotency,
//! empty-project and non-ASCII-encoding contract (edges BOARD-06/BOARD-01/BOARD-08).

mod common;

use std::time::Instant;

use core::ids::new_id;
use core::query::list_board;
use core::query::filter::BoardFilter;
use rusqlite::{params, Connection};

use common::{seed_epics, seeded_project};

const BUDGET_MS: u128 = 50;

/// Above `commands/board.rs`'s `DEFAULT_LIMIT` of 200 — enough to make the window a strict
/// subset of the roster and to reproduce UAT gap G-01-2.
const EPIC_COUNT: usize = 250;

/// Inserts one epic row with an explicitly chosen `status`/`priority`/`rank`, bypassing
/// `create_epic`'s own rank/status allocation so the ordering and tie-break tests below can
/// construct exact `(status, priority, rank)` tuples — including deliberate ties — that
/// `create_epic`'s API has no way to express. Mirrors `common::seed_epics`' literal `INSERT`
/// shape exactly (same columns, same base-table path), just with per-row control over every
/// sort-key column instead of a cycling fixture. Returns the new epic's id.
fn insert_epic_with(
    conn: &Connection,
    project_id: &str,
    actor_id: &str,
    status: &str,
    priority: i64,
    rank: &str,
    key: &str,
    title: &str,
) -> String {
    let id = new_id();
    let now = "2026-01-01T00:00:00.000Z";
    conn.execute(
        "INSERT INTO epics (
            id, project_id, key, title, description, status, rank, priority,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![id, project_id, key, title, status, rank, priority, actor_id, now],
    )
    .expect("insert_epic_with should succeed");
    id
}

#[test]
fn roster_returns_every_epic_past_the_board_window() {
    let (mut conn, _actor_id, project) = seeded_project();
    let seeded_ids = seed_epics(&mut conn, &project.id, EPIC_COUNT).expect("seed_epics should succeed");

    let roster = core::domain::epic::list_epics(&conn, &project.id)
        .expect("list_epics should succeed");
    assert_eq!(
        roster.epics.len(),
        EPIC_COUNT,
        "the roster must return every seeded epic, not a windowed subset"
    );
    assert_eq!(roster.total, EPIC_COUNT as i64, "total must report the real epic count");
    assert!(
        !roster.truncated,
        "a project well under EPIC_ROSTER_CEILING must not report truncated"
    );
    let roster_ids: std::collections::HashSet<String> =
        roster.epics.iter().map(|e| e.id.clone()).collect();
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
        roster_a.epics.iter().map(|e| e.id.clone()).collect();
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

    assert_eq!(roster.epics.len(), EPIC_COUNT);
    assert!(
        elapsed_ms < BUDGET_MS,
        "list_epics took {elapsed_ms}ms, budget is {BUDGET_MS}ms"
    );
}

/// The roster's order is total, specified and asserted against an EXPLICITLY WRITTEN expected
/// sequence (01-18-PLAN.md Task 3) — status band (backlog/todo/in_progress/in_review/done), then
/// priority with `0` sorting last, then `rank` ascending, then `id` ascending
/// (`crate::query::ORDER_BY`). A test that re-derived this with the implementation's own
/// comparator would prove nothing; every expectation below is hand-computed from the inserted
/// rows, independent of `list_epics`.
#[test]
fn roster_order_is_the_board_total_order() {
    let (conn, actor_id, project) = seeded_project();

    // Seven rows, inserted out of order, spanning all five statuses and several priorities
    // (including "No priority", keyed `0`, which must sort LAST within its status band).
    let f = insert_epic_with(&conn, &project.id, &actor_id, "backlog", 4, "00", "FLY-1", "F");
    let b = insert_epic_with(&conn, &project.id, &actor_id, "backlog", 0, "01", "FLY-2", "B");
    let c = insert_epic_with(&conn, &project.id, &actor_id, "todo", 3, "02", "FLY-3", "C");
    let g = insert_epic_with(&conn, &project.id, &actor_id, "todo", 0, "01", "FLY-4", "G");
    let d = insert_epic_with(&conn, &project.id, &actor_id, "in_progress", 0, "03", "FLY-5", "D");
    let e = insert_epic_with(&conn, &project.id, &actor_id, "in_review", 2, "04", "FLY-6", "E");
    let a = insert_epic_with(&conn, &project.id, &actor_id, "done", 1, "05", "FLY-7", "A");

    // Hand-computed expected order:
    //   backlog:     F (priority 4) before B (priority 0 -> sorts last)
    //   todo:        C (priority 3) before G (priority 0 -> sorts last)
    //   in_progress: D (only row)
    //   in_review:   E (only row)
    //   done:        A (only row)
    let expected = vec![f, b, c, g, d, e, a];

    let roster = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    let roster_ids: Vec<String> = roster.epics.iter().map(|epic| epic.id.clone()).collect();
    assert_eq!(roster_ids, expected, "the roster's order must match the board's total order");
}

/// Two epics sharing an identical `(status, priority, rank)` triple are BOTH returned, adjacent,
/// tie-broken by `id ASC` — neither merged away nor dropped — at both small volume and above
/// `DEFAULT_LIMIT` (edges BOARD-06/adjacency and BOARD-08/adjacency).
#[test]
fn roster_tie_breaks_equal_ranks_by_id_and_drops_neither() {
    let (mut conn, actor_id, project) = seeded_project();

    let id_a = insert_epic_with(&conn, &project.id, &actor_id, "backlog", 2, "05", "FLY-1", "Tied A");
    let id_b = insert_epic_with(&conn, &project.id, &actor_id, "backlog", 2, "05", "FLY-2", "Tied B");
    let (smaller, larger) = if id_a < id_b { (id_a, id_b) } else { (id_b, id_a) };

    let roster = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    let positions: Vec<usize> = roster
        .epics
        .iter()
        .enumerate()
        .filter(|(_, epic)| epic.id == smaller || epic.id == larger)
        .map(|(i, _)| i)
        .collect();
    assert_eq!(positions.len(), 2, "both tied epics must be present, neither dropped");
    assert_eq!(positions[1], positions[0] + 1, "the tied epics must be adjacent");
    assert_eq!(
        roster.epics[positions[0]].id, smaller,
        "the lexicographically smaller id must come first"
    );

    // Repeat at volume above `DEFAULT_LIMIT` (250 seeded epics, whose zero-padded ranks never
    // collide with the "999" rank used below) — the same tie-break must hold at scale.
    seed_epics(&mut conn, &project.id, EPIC_COUNT).expect("seed_epics should succeed");
    let id_c = insert_epic_with(&conn, &project.id, &actor_id, "todo", 3, "999", "FLY-3", "Tied C");
    let id_d = insert_epic_with(&conn, &project.id, &actor_id, "todo", 3, "999", "FLY-4", "Tied D");
    let (smaller_v, larger_v) = if id_c < id_d { (id_c, id_d) } else { (id_d, id_c) };

    let roster_at_volume =
        core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    assert_eq!(roster_at_volume.epics.len(), 2 + EPIC_COUNT + 2);
    let positions_v: Vec<usize> = roster_at_volume
        .epics
        .iter()
        .enumerate()
        .filter(|(_, epic)| epic.id == smaller_v || epic.id == larger_v)
        .map(|(i, _)| i)
        .collect();
    assert_eq!(positions_v.len(), 2, "both tied epics must be present at volume too");
    assert_eq!(positions_v[1], positions_v[0] + 1, "the tied epics must be adjacent at volume too");
    assert_eq!(
        roster_at_volume.epics[positions_v[0]].id, smaller_v,
        "the lexicographically smaller id must come first at volume too"
    );
}

/// `list_epics` is a pure read (edge BOARD-01/idempotency): calling it twice on an unchanged
/// project returns identical values, appends no row to `events`, and touches no `epics.updated_at`.
#[test]
fn roster_repeats_exactly_and_writes_nothing() {
    let (mut conn, _actor_id, project) = seeded_project();
    seed_epics(&mut conn, &project.id, 10).expect("seed_epics should succeed");

    let events_before: i64 = conn
        .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
        .expect("counting events should succeed");
    let rows_before: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, updated_at FROM epics ORDER BY id")
            .expect("preparing the epics snapshot query should succeed");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("querying the epics snapshot should succeed")
            .collect::<Result<Vec<_>, _>>()
            .expect("collecting the epics snapshot should succeed")
    };

    let first = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    let second = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    assert_eq!(first, second, "two calls on an unchanged project must return identical values");

    let events_after: i64 = conn
        .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
        .expect("counting events should succeed");
    let rows_after: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT id, updated_at FROM epics ORDER BY id")
            .expect("preparing the epics snapshot query should succeed");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("querying the epics snapshot should succeed")
            .collect::<Result<Vec<_>, _>>()
            .expect("collecting the epics snapshot should succeed")
    };

    assert_eq!(events_before, events_after, "list_epics must append no event — it is a pure read");
    assert_eq!(
        rows_before, rows_after,
        "list_epics must not touch any epics.updated_at value"
    );
}

/// A project with zero epics returns an empty vector and an `Ok` result, never an error
/// (edge BOARD-06/empty).
#[test]
fn roster_is_empty_for_a_project_with_no_epics() {
    let (conn, _actor_id, project) = seeded_project();
    let roster = core::domain::epic::list_epics(&conn, &project.id)
        .expect("list_epics on a project with no epics must still return Ok");
    assert!(roster.epics.is_empty(), "an epic-less project's roster must be an empty vector");
    assert_eq!(roster.total, 0);
    assert!(!roster.truncated);
}

/// A title containing multi-byte characters and a combining mark round-trips byte-identically
/// through `list_epics` (edge BOARD-06/encoding). Resolution is exact `id` equality on the
/// 26-character ASCII ULID — never a text comparison of key or title — so no case-folding or
/// Unicode-normalisation question arises here; FTS5 text search (`packages/core/src/query/search.rs`)
/// is a separate, unchanged path.
#[test]
fn roster_returns_non_ascii_titles_unchanged() {
    let (mut conn, actor_id, project) = seeded_project();
    // "Café" with a combining acute accent (U+0301) rather than the precomposed "é", plus CJK.
    let title = "Cafe\u{0301} re\u{0301}sume\u{0301} \u{2014} \u{65e5}\u{672c}\u{8a9e}";
    let epic = core::domain::epic::create_epic(&mut conn, &project.id, &actor_id, title, None)
        .expect("create_epic should succeed");

    let roster = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    let found = roster
        .epics
        .iter()
        .find(|e| e.id == epic.id)
        .expect("the created epic must be found in the roster by exact id equality");
    assert_eq!(found.title, title, "the title must round-trip byte-identically");
    assert_eq!(found.id.len(), 26, "resolution is against a 26-character ULID, never key/title text");
}

// --- AR-01-04 closure (01-17-PLAN.md's own re-rate trigger, plan 05-04): `EPIC_ROSTER_CEILING`
// replaces the unbounded read, and truncation is surfaced rather than silent (D-16). A ceiling of
// exactly `EPIC_ROSTER_CEILING` still returns everything; one row past it must report the real
// total and set `truncated: true`, never silently drop the extra row.

use core::domain::epic::EPIC_ROSTER_CEILING;

#[test]
fn roster_at_exactly_the_ceiling_reports_untruncated() {
    let (mut conn, _actor_id, project) = seeded_project();
    seed_epics(&mut conn, &project.id, EPIC_ROSTER_CEILING as usize)
        .expect("seed_epics should succeed");

    let roster = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    assert_eq!(roster.epics.len(), EPIC_ROSTER_CEILING as usize);
    assert_eq!(roster.total, EPIC_ROSTER_CEILING);
    assert!(
        !roster.truncated,
        "a project holding exactly EPIC_ROSTER_CEILING epics must not report truncated"
    );
}

#[test]
fn roster_one_past_the_ceiling_reports_truncated_with_the_real_total() {
    let (mut conn, _actor_id, project) = seeded_project();
    seed_epics(&mut conn, &project.id, EPIC_ROSTER_CEILING as usize + 1)
        .expect("seed_epics should succeed");

    let roster = core::domain::epic::list_epics(&conn, &project.id).expect("list_epics should succeed");
    assert_eq!(
        roster.epics.len(),
        EPIC_ROSTER_CEILING as usize,
        "the returned page must never exceed EPIC_ROSTER_CEILING rows"
    );
    assert_eq!(
        roster.total,
        EPIC_ROSTER_CEILING + 1,
        "total must report the project's real epic count, not the ceiling"
    );
    assert!(
        roster.truncated,
        "one epic past the ceiling must be surfaced as truncated, never silently dropped"
    );
}

// --- The agent's own bounded epic read (D-87, T-05-04-02): `query::authoring::list_epics_page`
// clamps a caller-supplied limit that exceeds MAX_LIMIT — never an unbounded pass-through.

#[test]
fn agent_epic_page_clamps_a_huge_limit_request_to_max_limit() {
    let (mut conn, _actor_id, project) = seeded_project();
    let seeded = core::query::authoring::MAX_LIMIT as usize + 100;
    seed_epics(&mut conn, &project.id, seeded).expect("seed_epics should succeed");

    let page = core::query::authoring::list_epics_page(&conn, &project.id, 10_000_000, None)
        .expect("list_epics_page should succeed");
    assert_eq!(
        page.len(),
        core::query::authoring::MAX_LIMIT as usize,
        "a 10,000,000-row request must clamp to MAX_LIMIT, never reach the database as-is"
    );
}
