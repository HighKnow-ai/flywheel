//! CR-01 (`02-REVIEW.md` gap-closure round): a source-scanning gate proving `session_stop`
//! resolves the sidecar interrupt request BEFORE acquiring `state.db.lock()`. `state.db` is the
//! one `Mutex<Connection>` every other command in this codebase locks first; the interrupt call
//! can block for up to `SidecarHandle::INTERRUPT_ACK_TIMEOUT` (30s), so acquiring the lock before
//! it would freeze every other board read, task creation, and agent-run interaction in the app
//! behind one Stop click against a wedged sidecar. Follows `app_exit_ordering.rs`'s own idiom: it
//! reads the real source file from disk rather than asserting against a duplicated copy of its
//! contents, strips whole-line comments before matching (a doc comment describing the rule must
//! not itself satisfy or violate it), and proves the gate is falsifiable against a reordered
//! fixture.

use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is packages/core — walk up two levels to the workspace root.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

/// Strip a whole-line `//` comment (leading whitespace then `//`) — a doc comment describing the
/// rule must not itself satisfy or violate it. Mirrors `app_exit_ordering.rs`'s own helper.
fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// Within `source`, find `pub fn session_stop` and return the index (relative to that line) of
/// the first non-comment line containing `interrupt_run` and of the first non-comment line
/// containing `.lock()`, scanning the following 30 lines — comfortably more than the function's
/// current body length.
fn interrupt_and_lock_indices(source: &str) -> (Option<usize>, Option<usize>, Vec<String>) {
    let lines: Vec<&str> = source.lines().collect();
    let fn_idx = lines
        .iter()
        .position(|line| line.contains("pub fn session_stop"))
        .unwrap_or_else(|| panic!("expected to find `pub fn session_stop` in the given source"));

    let window_end = (fn_idx + 30).min(lines.len());
    let window: Vec<&str> = lines[fn_idx..window_end].to_vec();

    let interrupt_idx = window
        .iter()
        .enumerate()
        .find(|(_, line)| !is_whole_line_comment(line) && line.contains("interrupt_run"))
        .map(|(idx, _)| idx);
    let lock_idx = window
        .iter()
        .enumerate()
        .find(|(_, line)| !is_whole_line_comment(line) && line.contains(".lock()"))
        .map(|(idx, _)| idx);

    (interrupt_idx, lock_idx, window.iter().map(|s| s.to_string()).collect())
}

#[test]
fn session_stop_resolves_the_interrupt_before_locking_the_shared_db_mutex() {
    let root = workspace_root();
    let session_rs = root.join("packages/desktop/src-tauri/src/commands/session.rs");
    let contents = std::fs::read_to_string(&session_rs).expect("session.rs should exist");

    let (interrupt_idx, lock_idx, window) = interrupt_and_lock_indices(&contents);
    let window_text = window.join("\n");

    assert!(
        interrupt_idx.is_some(),
        "expected a non-comment call to `interrupt_run` within 30 lines of `pub fn session_stop`, region:\n{window_text}"
    );
    assert!(
        lock_idx.is_some(),
        "expected a non-comment call to `.lock()` within 30 lines of `pub fn session_stop`, region:\n{window_text}"
    );
    assert!(
        interrupt_idx.unwrap() < lock_idx.unwrap(),
        "CR-01: `session_stop` must resolve the sidecar interrupt BEFORE acquiring \
         `state.db.lock()` — locking first would hold the app's one shared DB mutex across a \
         30-second wait on a wedged sidecar, freezing every other command in the app. Region:\n{window_text}"
    );
}

#[test]
fn a_reordered_fixture_trips_the_ordering_gate() {
    // Proves the gate is falsifiable — not just structurally present, but actually detects a
    // reordered call in a fixture, mirroring app_exit_ordering.rs's own seeded-violation test.
    let reordered = "\
pub fn session_stop(
    state: State<AppState>,
    app: AppHandle,
    session_id: String,
) -> Result<SessionStopDto, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let interrupt_result = state.sidecar.as_ref().map(|s| s.interrupt_run(&session_id));
    Ok(())
}
";
    let (interrupt_idx, lock_idx, _) = interrupt_and_lock_indices(reordered);
    assert!(
        interrupt_idx.unwrap() > lock_idx.unwrap(),
        "the fixture is deliberately reordered — this test's OWN assertion must observe the lock before the interrupt"
    );
}
