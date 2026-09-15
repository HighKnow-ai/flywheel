//! D-52/WORK-05's per-repository spawn floor, proved directly against `SpawnFloor` — no real
//! spawn or sidecar process is needed for these timing assertions. Tolerances are generous (a
//! lower-bound-only assertion, per plan 03-04 Task 1's own instruction) so this suite is not flaky
//! on a loaded CI machine. Task 3 extends this file with the structural no-bypass gate over
//! `packages/desktop/src-tauri/src/commands/agent_run.rs`.

use core::git_retry::{SpawnFloor, SPAWN_FLOOR_MS};

#[test]
fn the_first_call_for_a_key_returns_immediately() {
    let floor = SpawnFloor::new();
    let started = std::time::Instant::now();
    floor.wait_turn("repo-a");
    let elapsed = started.elapsed();
    assert!(
        elapsed < std::time::Duration::from_millis(SPAWN_FLOOR_MS / 2),
        "the first call for a fresh key must not be delayed, took {elapsed:?}"
    );
}

#[test]
fn a_second_immediate_call_for_the_same_key_blocks_until_at_least_the_floor_has_elapsed() {
    let floor = SpawnFloor::new();
    floor.wait_turn("repo-b");

    let started = std::time::Instant::now();
    floor.wait_turn("repo-b");
    let elapsed = started.elapsed();

    assert!(
        elapsed >= std::time::Duration::from_millis(SPAWN_FLOOR_MS),
        "a second immediate call for the same key must wait at least the floor, waited {elapsed:?}"
    );
}

#[test]
fn a_call_for_a_different_key_is_never_delayed_by_another_keys_floor() {
    let floor = SpawnFloor::new();
    floor.wait_turn("repo-c");

    let started = std::time::Instant::now();
    floor.wait_turn("repo-d");
    let elapsed = started.elapsed();

    assert!(
        elapsed < std::time::Duration::from_millis(SPAWN_FLOOR_MS / 2),
        "a different repository key must never be delayed by another key's floor, took {elapsed:?}"
    );
}
