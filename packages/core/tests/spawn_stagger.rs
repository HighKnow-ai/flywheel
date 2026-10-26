//! D-52/WORK-05's per-repository spawn floor, proved directly against `SpawnFloor` — no real
//! spawn or sidecar process is needed for these timing assertions. Tolerances are generous (a
//! lower-bound-only assertion, per plan 03-04 Task 1's own instruction) so this suite is not flaky
//! on a loaded CI machine. Task 3 extends this file with the structural no-bypass gate over
//! `packages/desktop/src-tauri/src/commands/session.rs`.

use flywheel_core::git_retry::{SpawnFloor, SPAWN_FLOOR_MS};

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

/// Task 3's own "same-repository/different-repository pair" — a single test asserting both halves
/// of D-52's guarantee against the SAME `SpawnFloor` instance, driving it directly (mirrors the
/// two tests above; this one exists to name the pairing explicitly, per plan 03-04 Task 3's own
/// instruction).
#[test]
fn same_repository_pair_is_staggered_while_a_different_repository_is_not() {
    let floor = SpawnFloor::new();

    floor.wait_turn("/repo/same");
    let same_repo_started = std::time::Instant::now();
    floor.wait_turn("/repo/same");
    let same_repo_elapsed = same_repo_started.elapsed();
    assert!(
        same_repo_elapsed >= std::time::Duration::from_millis(SPAWN_FLOOR_MS),
        "two starts against the same repository must be separated by at least the floor, got {same_repo_elapsed:?}"
    );

    let different_repo_started = std::time::Instant::now();
    floor.wait_turn("/repo/different");
    let different_repo_elapsed = different_repo_started.elapsed();
    assert!(
        different_repo_elapsed < std::time::Duration::from_millis(SPAWN_FLOOR_MS / 2),
        "a start against a different repository must not be delayed, got {different_repo_elapsed:?}"
    );
}

/// D-52 as a structural guarantee, not a convention (mirrors `supervisor_cwd.rs`'s own idiom): the
/// real `session.rs` command file, read from disk, must contain `send_spawn_request(` at least
/// once and ZERO bare `.send_request(` calls — the only way a spawn request can leave that file is
/// through the gated path.
#[test]
fn session_rs_contains_no_bare_send_request_call_and_at_least_one_gated_spawn_call() {
    let root = workspace_root();
    let path = root.join("packages/desktop/src-tauri/src/commands/session.rs");
    let contents = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read {path:?}: {e}"));

    let mut bare_send_request_count = 0;
    let mut gated_send_spawn_request_count = 0;
    for raw_line in contents.lines() {
        if is_whole_line_comment(raw_line) {
            continue;
        }
        if raw_line.contains(".send_request(") {
            bare_send_request_count += 1;
        }
        if raw_line.contains("send_spawn_request") {
            gated_send_spawn_request_count += 1;
        }
    }

    assert_eq!(
        bare_send_request_count, 0,
        "expected zero bare `.send_request(` calls in {path:?} — a spawn path bypassing the per-repository floor survived in the command layer"
    );
    assert!(
        gated_send_spawn_request_count >= 1,
        "expected at least one `send_spawn_request` call in {path:?}"
    );
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn workspace_root() -> std::path::PathBuf {
    // CARGO_MANIFEST_DIR is packages/core — walk up two levels to the workspace root.
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}
