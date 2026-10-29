//! Behavior under test (01-07-PLAN.md Task 3 — the order is total and reproducible):
//! - `rank_between` on adjacent ranks returns a strictly-between value under plain string
//!   comparison.
//! - After 200 random moves within one list of 50 ranks (each move re-ranking the moved item
//!   between its new neighbours, the way a reorder writer would), every rank is distinct and
//!   sorting by rank reproduces the move history.
//! - Reading an Epic's Stories twice with no intervening write returns byte-identical id
//!   sequences, in creation (rank) order.

mod common;

use std::collections::HashSet;

use common::seeded_project;
use flywheel_core::domain::{epic, milestone, story};
use flywheel_core::ranking::{rank_after, rank_before, rank_between, ReorderDirection};

#[test]
fn rank_between_is_strictly_between() {
    let a = rank_after(None).expect("rank_after(None) should succeed");
    let c = rank_after(Some(&a)).expect("rank_after(Some) should succeed");
    let b = rank_between(&a, &c).expect("rank_between should succeed on adjacent ranks");
    assert!(a < b, "{a:?} should sort strictly before {b:?}");
    assert!(b < c, "{b:?} should sort strictly before {c:?}");
}

/// Move the item at `idx` one step in `direction` inside `items` (a list of `(id, rank)` kept in
/// rank order), rewriting only the moved item's rank: between its two new neighbours, or before
/// the new head / after the new tail at either end.
fn move_one(items: &mut [(String, String)], idx: usize, direction: ReorderDirection) {
    let target = match direction {
        ReorderDirection::Up => idx - 1,
        ReorderDirection::Down => idx + 1,
    };
    items.swap(idx, target);
    let before = if target == 0 {
        None
    } else {
        Some(items[target - 1].1.clone())
    };
    let after = items.get(target + 1).map(|(_, r)| r.clone());
    let new_rank = match (before, after) {
        (Some(b), Some(a)) => rank_between(&b, &a),
        (None, Some(a)) => rank_before(Some(&a)),
        (Some(b), None) => rank_after(Some(&b)),
        (None, None) => unreachable!("a move needs at least two items"),
    }
    .expect("computing the moved item's new rank should succeed");
    items[target].1 = new_rank;
}

#[test]
fn many_moves_keep_ranks_distinct() {
    let mut items: Vec<(String, String)> = Vec::new();
    let mut last: Option<String> = None;
    for i in 0..50 {
        let rank = rank_after(last.as_deref()).expect("rank_after should succeed");
        last = Some(rank.clone());
        items.push((format!("item-{i}"), rank));
    }

    // A small deterministic PRNG (xorshift32) — no extra dev-dependency needed, and a fixed
    // seed keeps the test reproducible across runs.
    let mut state: u32 = 0x9E37_79B9;
    let mut next_rand = || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state
    };

    let mut moves_applied = 0;
    while moves_applied < 200 {
        let idx = (next_rand() as usize) % items.len();
        let go_up = next_rand() % 2 == 0;
        let can_move = if go_up {
            idx > 0
        } else {
            idx < items.len() - 1
        };
        if !can_move {
            continue;
        }
        let direction = if go_up {
            ReorderDirection::Up
        } else {
            ReorderDirection::Down
        };
        move_one(&mut items, idx, direction);
        moves_applied += 1;
    }

    let mut seen_ranks = HashSet::new();
    for (id, rank) in &items {
        assert!(
            seen_ranks.insert(rank.clone()),
            "two items in one list must never hold the same rank (duplicate: {rank:?} for id {id:?})"
        );
    }

    let history: Vec<String> = items.iter().map(|(id, _)| id.clone()).collect();
    let mut by_rank = items.clone();
    by_rank.sort_by(|a, b| a.1.cmp(&b.1));
    let read_ids: Vec<String> = by_rank.into_iter().map(|(id, _)| id).collect();
    assert_eq!(
        read_ids, history,
        "the rank order after 200 moves must match the move history's own final order"
    );
}

#[test]
fn story_order_is_reproducible() {
    let (mut conn, actor_id, project) = seeded_project();
    let m =
        milestone::create_milestone(&mut conn, &project.id, &actor_id, "Ranked milestone", None)
            .expect("create_milestone should succeed");
    let e = epic::create_epic(&mut conn, &actor_id, &m.id, "Ranked epic")
        .expect("create_epic should succeed");
    let mut created: Vec<String> = Vec::new();
    for i in 0..10 {
        let s = story::create_story(&mut conn, &actor_id, &e.id, &format!("S{i}"))
            .expect("create_story should succeed");
        created.push(s.id);
    }

    let first: Vec<String> = story::stories_in_epic(&conn, &e.id)
        .expect("stories_in_epic should succeed")
        .into_iter()
        .map(|s| s.id)
        .collect();
    let second: Vec<String> = story::stories_in_epic(&conn, &e.id)
        .expect("stories_in_epic should succeed")
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(
        first, second,
        "reading the Stories twice with no intervening write must return byte-identical id \
         sequences — the order is total, not merely sorted"
    );
    assert_eq!(
        first, created,
        "Stories appended to an Epic read back in creation (rank) order"
    );
}
