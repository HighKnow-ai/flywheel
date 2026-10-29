//! G-02-5's structural gate on how a Tokio timer future is CONSTRUCTED at the desktop crate's
//! `block_on` call sites.
//!
//! The defect this exists to prevent: `tokio::time::timeout(dur, fut)` builds its `Sleep` eagerly
//! at construction time, and `Sleep` registers with the runtime's timer driver through
//! thread-local state the moment it is created. Rust evaluates call arguments BEFORE the call, so
//!
//!     block_on(tokio::time::timeout(dur, fut))      // Sleep built OUTSIDE the runtime — panics
//!     block_on(async { timeout(dur, fut).await })   // Sleep built INSIDE the runtime — correct
//!
//! differ in whether a reactor exists at construction. The first form panicked with "there is no
//! reactor running, must be called from the context of a Tokio 1.x runtime" inside `main.rs`'s
//! `.setup()` closure — which runs on the main thread during `did_finish_launching`, in a frame
//! that CANNOT UNWIND — so it aborted the process before a window was ever shown.
//!
//! Why a source gate rather than a behavioural test: reproducing it needs a real Tauri
//! `AppHandle` inside the platform's launch callback, which no test harness in this repository can
//! construct. `cargo test --workspace` passed 220/220 with the app unable to start at all. That is
//! the same shape as G-02-4 — a function proven correct in isolation, wrong at its only real call
//! site — so this gate examines the call site itself.
//!
//! Follows `session_closed_call_site.rs`'s idiom exactly: reads the real file from disk rather
//! than a duplicated copy, ignores whole-line comments so the prose above can neither satisfy nor
//! violate the rule, and names the offending line in its failure message.

use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// Every `.rs` file under the desktop crate's `src/`, so a future `block_on` added anywhere in
/// that crate is covered without this test needing to name it.
fn desktop_sources() -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let entries =
            std::fs::read_dir(dir).unwrap_or_else(|e| panic!("failed to read {dir:?}: {e}"));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }
    let src = workspace_root().join("packages/desktop/src-tauri/src");
    assert!(src.is_dir(), "expected the desktop crate's src/ at {src:?}");
    let mut paths = Vec::new();
    walk(&src, &mut paths);
    assert!(!paths.is_empty(), "found no .rs files under {src:?}");
    paths
        .into_iter()
        .map(|p| {
            let body =
                std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}

/// A `block_on(` whose FIRST non-whitespace argument text begins a `tokio::time::` construction —
/// the eager-construction-outside-the-runtime shape. Matching on the same line is sufficient and
/// deliberate: the correct form opens an `async` block, so the timer call moves to a later line.
fn offends(line: &str) -> bool {
    let Some(idx) = line.find("block_on(") else {
        return false;
    };
    let after = &line[idx + "block_on(".len()..];
    after.trim_start().starts_with("tokio::time::")
}

#[test]
fn no_tokio_timer_is_constructed_as_a_block_on_argument() {
    let mut offenders = Vec::new();
    for (path, body) in desktop_sources() {
        for (n, line) in body.lines().enumerate() {
            if !is_whole_line_comment(line) && offends(line) {
                offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a Tokio timer future is constructed as a direct argument to block_on, so its Sleep is \
         built before the runtime is entered and will panic with \"there is no reactor running\" \
         (G-02-5). Construct it INSIDE the async block instead: \
         block_on(async {{ tokio::time::timeout(d, fut).await }}). Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

/// The gate above can only be trusted if it can actually fail. This proves the matcher fires on
/// the exact shape that shipped, and stays quiet on the corrected one — so a future refactor that
/// accidentally neuters `offends` is caught here rather than silently passing everything.
#[test]
fn the_gate_detects_the_shape_that_shipped() {
    let shipped = "    let r = tauri::async_runtime::block_on(tokio::time::timeout(";
    let fixed = "    let r = tauri::async_runtime::block_on(async {";
    assert!(
        offends(shipped),
        "the gate must detect the argument form that caused G-02-5"
    );
    assert!(
        !offends(fixed),
        "the gate must not fire on the corrected async-block form"
    );
    // A whole-line comment describing the bad shape must not trip the gate. `offends` itself is
    // deliberately comment-blind — the filtering is the caller's job — so assert the two halves
    // compose, which is the property the gate actually relies on.
    let commented = "    // block_on(tokio::time::timeout( — described, not written";
    assert!(offends(commented), "the matcher is comment-blind by design");
    assert!(
        is_whole_line_comment(commented),
        "the caller's comment filter is what keeps prose from tripping the gate"
    );
}
