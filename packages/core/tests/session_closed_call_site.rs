//! G-02-4's structural gate on the reader-loop call site itself — the exact thing that was
//! missing. Follows `app_exit_ordering.rs`'s idiom exactly: reads the real `sidecar.rs` from disk
//! rather than asserting against a duplicated copy, strips whole-line comments before matching so
//! a doc comment can neither satisfy nor violate the rule, and builds an actionable failure
//! message naming the file and quoting the region examined.

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

/// The reader-loop region: everything from the line that spawns the asynchronous reader task to
/// the end of the file. Locating it this way (rather than a fixed line-count window) is resilient
/// to unrelated edits above the spawn point elsewhere in the file.
fn reader_loop_region(contents: &str) -> Vec<&str> {
    let lines: Vec<&str> = contents.lines().collect();
    let spawn_idx = lines
        .iter()
        .position(|line| line.contains("tauri::async_runtime::spawn"))
        .unwrap_or_else(|| panic!("expected to find the reader task's own spawn call in sidecar.rs"));
    lines[spawn_idx..].to_vec()
}

/// Within `region`, on non-comment lines only: does the renderer emit appear, does the terminal
/// event's own type string appear, does a call to the inbound handler appear, and does the handler
/// call come strictly AFTER the emit? Returns `(has_emit, has_type_string, has_handler_call,
/// handler_after_emit)` so callers can build a precise failure message for whichever piece is
/// missing.
fn call_site_shape(region: &[&str]) -> (bool, bool, bool, bool) {
    let non_comment: Vec<(usize, &&str)> =
        region.iter().enumerate().filter(|(_, line)| !is_whole_line_comment(line)).collect();

    let emit_idx = non_comment.iter().find(|(_, line)| line.contains(r#"emit("agent:event""#)).map(|(idx, _)| *idx);
    let has_type_string = non_comment.iter().any(|(_, line)| line.contains("session_closed"));
    let handler_idx = non_comment
        .iter()
        .find(|(_, line)| line.contains("handle_inbound_session_closed"))
        .map(|(idx, _)| *idx);

    let handler_after_emit = match (emit_idx, handler_idx) {
        (Some(e), Some(h)) => h > e,
        _ => false,
    };

    (emit_idx.is_some(), has_type_string, handler_idx.is_some(), handler_after_emit)
}

#[test]
fn the_reader_loop_dispatches_the_terminal_event_to_the_handler() {
    let root = workspace_root();
    let sidecar_rs = root.join("packages/desktop/src-tauri/src/sidecar.rs");
    let contents = std::fs::read_to_string(&sidecar_rs).expect("sidecar.rs should exist");
    let region = reader_loop_region(&contents);
    let region_text = region.join("\n");

    let (has_emit, has_type_string, has_handler_call, handler_after_emit) = call_site_shape(&region);

    assert!(
        has_emit,
        "expected the renderer's `agent:event` emit within the reader-loop region of {}, region:\n{region_text}",
        sidecar_rs.display()
    );
    assert!(
        has_type_string,
        "expected the terminal event's own type string \"session_closed\" on a non-comment line of \
         {} — its absence IS gap G-02-4: the terminal event has no consumer, so every run that ends \
         on its own stays on the board as still-running. Region:\n{region_text}",
        sidecar_rs.display()
    );
    assert!(
        has_handler_call,
        "expected a non-comment call to `handle_inbound_session_closed` within the reader-loop \
         region of {} — its absence IS gap G-02-4: the terminal event has no consumer, so every run \
         that ends on its own stays on the board as still-running. Region:\n{region_text}",
        sidecar_rs.display()
    );
    assert!(
        handler_after_emit,
        "expected `handle_inbound_session_closed` to be called AFTER the renderer's `agent:event` \
         emit, so a fault in the database write can never delay or suppress the live event the user \
         is watching. Region:\n{region_text}"
    );
}

#[test]
fn a_fixture_without_the_dispatch_trips_the_gate() {
    // Proves this file's own matching logic is falsifiable — not just structurally present, but
    // actually detects a missing or comment-only call, mirroring `app_exit_ordering.rs`'s own
    // seeded-violation test.
    let correct = "\
tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        let _ = app_for_reader.emit(\"agent:event\", &event);
        if event.get(\"type\").and_then(|v| v.as_str()) == Some(\"session_closed\") {
            crate::commands::agent_run::handle_inbound_session_closed(&app_for_reader, &event);
        }
    }
});
";
    let (has_emit, has_type_string, has_handler_call, handler_after_emit) =
        call_site_shape(&reader_loop_region(correct));
    assert!(has_emit && has_type_string && has_handler_call && handler_after_emit);

    let missing = "\
tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        let _ = app_for_reader.emit(\"agent:event\", &event);
    }
});
";
    let (_, has_type_string_missing, has_handler_call_missing, _) = call_site_shape(&reader_loop_region(missing));
    assert!(
        !has_handler_call_missing,
        "the fixture deliberately omits the handler call — the gate must detect its absence"
    );
    assert!(
        !has_type_string_missing,
        "the fixture deliberately never mentions session_closed on a non-comment line"
    );

    let comment_only = "\
tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        let _ = app_for_reader.emit(\"agent:event\", &event);
        // if event.get(\"type\").and_then(|v| v.as_str()) == Some(\"session_closed\") {
        //     crate::commands::agent_run::handle_inbound_session_closed(&app_for_reader, &event);
        // }
    }
});
";
    let (_, _, has_handler_call_commented, _) = call_site_shape(&reader_loop_region(comment_only));
    assert!(
        !has_handler_call_commented,
        "a commented-out call to handle_inbound_session_closed must NOT satisfy the gate"
    );

    let reordered = "\
tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        if event.get(\"type\").and_then(|v| v.as_str()) == Some(\"session_closed\") {
            crate::commands::agent_run::handle_inbound_session_closed(&app_for_reader, &event);
        }
        let _ = app_for_reader.emit(\"agent:event\", &event);
    }
});
";
    let (has_emit_reordered, _, has_handler_call_reordered, handler_after_emit_reordered) =
        call_site_shape(&reader_loop_region(reordered));
    assert!(has_emit_reordered && has_handler_call_reordered);
    assert!(
        !handler_after_emit_reordered,
        "the fixture deliberately calls the handler BEFORE the emit — the gate must reject that ordering"
    );
}
