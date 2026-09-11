//! CR-02, plan 02-14: a source-scanning gate proving `main.rs`'s `RunEvent::Exit` handler reaches
//! every live session BEFORE it kills the sidecar itself. Follows `supervisor_cwd.rs`'s own
//! idiom: it reads a real source file from disk rather than asserting against a duplicated copy
//! of its contents, strips whole-line comments before matching (a doc comment describing the rule
//! must not itself satisfy or violate it), and builds an actionable failure message.

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
/// rule must not itself satisfy or violate it. Mirrors `supervisor_cwd.rs`'s own helper.
fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn non_comment_lines(contents: &str) -> Vec<&str> {
    contents.lines().filter(|line| !is_whole_line_comment(line)).collect()
}

#[test]
fn run_event_exit_signals_sessions_before_killing_the_sidecar() {
    let root = workspace_root();
    let main_rs = root.join("packages/desktop/src-tauri/src/main.rs");
    let contents = std::fs::read_to_string(&main_rs).expect("main.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    let exit_line_idx = lines
        .iter()
        .position(|line| line.contains("RunEvent::Exit"))
        .unwrap_or_else(|| panic!("expected to find `RunEvent::Exit` in {}", main_rs.display()));

    // Scan the 20 lines following the RunEvent::Exit match arm for the shutdown call and the
    // kill call, dropping whole-line comments first so a doc comment can neither satisfy nor
    // violate this gate.
    let window_end = (exit_line_idx + 20).min(lines.len());
    let window: Vec<&str> = lines[exit_line_idx..window_end].to_vec();
    let window_text = window.join("\n");

    let shutdown_idx = window
        .iter()
        .enumerate()
        .filter(|(_, line)| !is_whole_line_comment(line))
        .find(|(_, line)| line.contains("shutdown_all_sessions"))
        .map(|(idx, _)| idx);
    let kill_idx = window
        .iter()
        .enumerate()
        .filter(|(_, line)| !is_whole_line_comment(line))
        .find(|(_, line)| line.contains(".kill()"))
        .map(|(idx, _)| idx);

    assert!(
        shutdown_idx.is_some(),
        "expected a non-comment call to `shutdown_all_sessions` within 20 lines of `RunEvent::Exit`, region:\n{window_text}"
    );
    assert!(
        kill_idx.is_some(),
        "expected a non-comment call to `.kill()` within 20 lines of `RunEvent::Exit`, region:\n{window_text}"
    );
    assert!(
        shutdown_idx.unwrap() < kill_idx.unwrap(),
        "expected `shutdown_all_sessions` to be called BEFORE `.kill()` — killing the supervisor \
         first would remove the only thing that can still reach the sessions. Region:\n{window_text}"
    );
}

#[test]
fn sidecar_rs_declares_a_bounded_shutdown_ack_timeout() {
    let root = workspace_root();
    let sidecar_rs = root.join("packages/desktop/src-tauri/src/sidecar.rs");
    let contents = std::fs::read_to_string(&sidecar_rs).expect("sidecar.rs should exist");

    let found = non_comment_lines(&contents)
        .iter()
        .any(|line| line.contains("SHUTDOWN_ACK_TIMEOUT"));

    assert!(
        found,
        "expected sidecar.rs to declare/use SHUTDOWN_ACK_TIMEOUT on a non-comment line, so the \
         bounded-wait guarantee cannot be silently dropped back to the 30-second interrupt ceiling"
    );
}

#[test]
fn a_reordered_fixture_trips_the_ordering_gate() {
    // Proves the gate is falsifiable — not just structurally present, but actually detects a
    // reordered/missing call in a fixture, mirroring supervisor_cwd.rs's own seeded-violation test.
    let reordered = "\
fn main() {
    if let tauri::RunEvent::Exit = event {
        if let Some(sidecar) = state.sidecar.as_ref() {
            sidecar.kill();
            sidecar.shutdown_all_sessions().ok();
        }
    }
}
";
    let lines: Vec<&str> = reordered.lines().collect();
    let exit_line_idx = lines.iter().position(|line| line.contains("RunEvent::Exit")).unwrap();
    let window_end = (exit_line_idx + 20).min(lines.len());
    let window: Vec<&str> = lines[exit_line_idx..window_end].to_vec();

    let shutdown_idx = window
        .iter()
        .enumerate()
        .find(|(_, line)| !is_whole_line_comment(line) && line.contains("shutdown_all_sessions"))
        .map(|(idx, _)| idx)
        .unwrap();
    let kill_idx = window
        .iter()
        .enumerate()
        .find(|(_, line)| !is_whole_line_comment(line) && line.contains(".kill()"))
        .map(|(idx, _)| idx)
        .unwrap();

    assert!(
        shutdown_idx > kill_idx,
        "the fixture is deliberately reordered — this test's OWN assertion must observe shutdown after kill"
    );

    let missing = "\
fn main() {
    if let tauri::RunEvent::Exit = event {
        if let Some(sidecar) = state.sidecar.as_ref() {
            sidecar.kill();
        }
    }
}
";
    let lines: Vec<&str> = missing.lines().collect();
    let exit_line_idx = lines.iter().position(|line| line.contains("RunEvent::Exit")).unwrap();
    let window_end = (exit_line_idx + 20).min(lines.len());
    let window: Vec<&str> = lines[exit_line_idx..window_end].to_vec();
    let shutdown_missing = !window
        .iter()
        .any(|line| !is_whole_line_comment(line) && line.contains("shutdown_all_sessions"));
    assert!(shutdown_missing, "the fixture deliberately omits shutdown_all_sessions");

    let comment_only = "\
fn main() {
    if let tauri::RunEvent::Exit = event {
        if let Some(sidecar) = state.sidecar.as_ref() {
            // sidecar.shutdown_all_sessions().ok();
            sidecar.kill();
        }
    }
}
";
    let lines: Vec<&str> = comment_only.lines().collect();
    let exit_line_idx = lines.iter().position(|line| line.contains("RunEvent::Exit")).unwrap();
    let window_end = (exit_line_idx + 20).min(lines.len());
    let window: Vec<&str> = lines[exit_line_idx..window_end].to_vec();
    let shutdown_commented_only = !window
        .iter()
        .any(|line| !is_whole_line_comment(line) && line.contains("shutdown_all_sessions"));
    assert!(
        shutdown_commented_only,
        "a comment mentioning shutdown_all_sessions must NOT satisfy the gate"
    );
}
