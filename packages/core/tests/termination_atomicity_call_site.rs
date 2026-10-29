//! D-64/CTX-01, gap #1 of 04-VERIFICATION.md: a structural gate over the REAL desktop and core
//! source files on disk, proving the Stop/Discard termination unit stays atomic — not just today,
//! but against a future edit that silently reintroduces a second, independent transaction. Follows
//! `session_closed_call_site.rs`'s idiom verbatim in shape: a `workspace_root()` helper walking up
//! two levels from `CARGO_MANIFEST_DIR`, an `is_whole_line_comment` helper stripping whole-line
//! `//` comments so a doc comment can neither satisfy nor violate a rule, region locators that find
//! a function by its signature line rather than by a fixed line offset, and failure messages that
//! name the file and quote the region examined. `session_stop_ordering.rs` is this repo's second
//! precedent for a source-structural ordering assertion; this file matches that house style too,
//! rather than inventing a third.
//!
//! A behavioural test — `discard_lifecycle.rs`'s `a_rolled_back_termination_unit_leaves_no_trace`,
//! for instance — can only assert about paths that ALREADY exist. This gate goes red the instant a
//! NEW non-atomic termination path is added, whether or not any behavioural test happens to drive
//! it yet. That is the reintroduction mode gap #1 actually represents: the natural-close path was
//! already atomic and documented as such (`apply_session_closed`'s own T-04-07 comment) when plan
//! 04-13 added a SECOND path — Stop/Discard — that was not. A structural gate is what makes the
//! next such addition visible at review time instead of shipping silently.

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
/// rule must not itself satisfy or violate it. Mirrors `session_closed_call_site.rs`'s and
/// `session_stop_ordering.rs`'s own identical helper.
fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// Locate a function by its signature substring and return the lines from that signature down
/// through its own closing brace — a bare `}` at column zero, which is where a top-level Rust
/// item's body ends (every line inside the body is indented; only the function's own close sits
/// unindented). Resilient to unrelated edits elsewhere in the file, unlike a fixed line-count
/// window.
fn function_region<'a>(lines: &'a [&'a str], signature_substr: &str) -> &'a [&'a str] {
    let start_idx = lines
        .iter()
        .position(|line| line.contains(signature_substr))
        .unwrap_or_else(|| panic!("expected to find `{signature_substr}` in the given source"));
    let end_idx = lines[start_idx..]
        .iter()
        .position(|line| line.trim_end() == "}")
        .map(|offset| start_idx + offset + 1)
        .unwrap_or(lines.len());
    &lines[start_idx..end_idx]
}

/// Property 1: over the WHOLE of `region`, non-comment lines only, does the connection-level core
/// interrupt entry point get called? Searches for the qualified call text ending in an open
/// parenthesis (`session::interrupt_session(`) so the in-tx sibling's own name
/// (`interrupt_session_in_tx(`) can never match.
fn calls_connection_level_interrupt(region: &[&str]) -> bool {
    region
        .iter()
        .filter(|line| !is_whole_line_comment(line))
        .any(|line| line.contains("session::interrupt_session("))
}

/// Property 2: within `region` (expected to be `stop_session_recording_first`'s own body), count
/// non-comment lines that open a transaction on the connection (`conn.transaction()`).
fn connection_transaction_open_count(region: &[&str]) -> usize {
    region
        .iter()
        .filter(|line| !is_whole_line_comment(line))
        .filter(|line| line.contains("conn.transaction()"))
        .count()
}

/// Property 3: within `region` (expected to be `interrupt_session`'s own body), does a
/// non-comment line reference the in-tx sibling?
fn references_in_tx_sibling(region: &[&str]) -> bool {
    region
        .iter()
        .filter(|line| !is_whole_line_comment(line))
        .any(|line| line.contains("interrupt_session_in_tx"))
}

#[test]
fn the_stop_discard_path_never_calls_the_connection_level_interrupt_entry_point() {
    let root = workspace_root();
    let session_rs = root.join("packages/desktop/src-tauri/src/commands/session.rs");
    let contents = std::fs::read_to_string(&session_rs).expect("session.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    assert!(
        !calls_connection_level_interrupt(&lines),
        "expected NO non-comment line in {} to call the core connection-level interrupt entry \
         point (`session::interrupt_session(`) — its presence means the Stop/Discard path has \
         been rewired to a call that commits its own transaction, reopening gap #1 of \
         04-VERIFICATION.md (a crash between the terminal write and the fallback-summary insert \
         could again leave a terminal run with no summary).",
        session_rs.display()
    );
}

#[test]
fn stop_session_recording_first_opens_exactly_one_connection_transaction() {
    let root = workspace_root();
    let session_rs = root.join("packages/desktop/src-tauri/src/commands/session.rs");
    let contents = std::fs::read_to_string(&session_rs).expect("session.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    let region = function_region(&lines, "fn stop_session_recording_first(");
    let region_text = region.join("\n");
    let count = connection_transaction_open_count(region);

    match count {
        0 => panic!(
            "expected exactly ONE `conn.transaction()` call within `stop_session_recording_first`'s \
             own body in {}, found ZERO — the terminal write is no longer inside any transaction at \
             all. Region:\n{region_text}",
            session_rs.display()
        ),
        1 => {}
        n => panic!(
            "expected exactly ONE `conn.transaction()` call within `stop_session_recording_first`'s \
             own body in {}, found {n} — the pre-fix two-transaction shape is back (gap #1 of \
             04-VERIFICATION.md reopened). Region:\n{region_text}",
            session_rs.display()
        ),
    }
}

#[test]
fn interrupt_session_in_tx_is_defined_and_referenced_by_its_connection_level_wrapper() {
    let root = workspace_root();
    let session_rs = root.join("packages/core/src/domain/session.rs");
    let contents = std::fs::read_to_string(&session_rs).expect("session.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    let is_defined = lines
        .iter()
        .filter(|line| !is_whole_line_comment(line))
        .any(|line| line.contains("fn interrupt_session_in_tx("));
    assert!(
        is_defined,
        "expected a non-comment `fn interrupt_session_in_tx(` definition in {} — its absence means \
         the caller-transaction sibling `apply_session_closed`'s own `close_session_in_tx` \
         precedent requires has been removed, which would force every terminal-transition caller \
         back to composing on separate connection-level transactions (gap #1 of \
         04-VERIFICATION.md).",
        session_rs.display()
    );

    let wrapper_region = function_region(&lines, "pub fn interrupt_session(");
    let wrapper_region_text = wrapper_region.join("\n");
    assert!(
        references_in_tx_sibling(wrapper_region),
        "expected `interrupt_session`'s own body in {} to reference `interrupt_session_in_tx` — \
         its absence means the connection-level entry point has drifted back into carrying its own \
         copy of the statement body while the in-tx sibling rots, unreachable by any composing \
         caller. Region:\n{wrapper_region_text}",
        session_rs.display()
    );
}

#[test]
fn a_reintroduced_connection_level_interrupt_call_trips_property_one() {
    // Falsifiability companion, mirroring session_closed_call_site.rs's and
    // session_stop_ordering.rs's own seeded-violation tests: proves this file's own matching
    // logic actually detects the violation, not just that it is structurally present today.
    let correct = "\
pub(crate) fn stop_session_in_tx(tx: &Transaction, session_id: &str, actor_id: &str) -> Result<String, String> {
    flywheel_core::domain::session::interrupt_session_in_tx(tx, session_id, actor_id)
        .map_err(|e| e.to_string())?;
    Ok(String::new())
}
";
    assert!(!calls_connection_level_interrupt(
        &correct.lines().collect::<Vec<_>>()
    ));

    let reverted = "\
pub(crate) fn stop_session_recording_first(
    conn: &mut Connection,
    session_id: &str,
    interrupt: impl FnOnce() -> Result<(), String>,
) -> Result<SessionStopDto, String> {
    let interrupt_result = interrupt();
    let human_actor_id = flywheel_core::domain::actor::local_human_actor_id(conn).map_err(|e| e.to_string())?;
    flywheel_core::domain::session::interrupt_session(conn, session_id, &human_actor_id)
        .map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    flywheel_core::domain::session_summary::synthesize_fallback_summary(&tx, session_id, \"interrupted\")
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(SessionStopDto { session_id: session_id.to_string(), status: \"interrupted\".to_string(), sidecar_warning: None })
}
";
    assert!(
        calls_connection_level_interrupt(&reverted.lines().collect::<Vec<_>>()),
        "the fixture deliberately reverts to the connection-level call — this test's OWN detector must observe it"
    );

    let commented_out = "\
pub(crate) fn stop_session_recording_first() {
    // flywheel_core::domain::session::interrupt_session(conn, session_id, &human_actor_id)
}
";
    assert!(
        !calls_connection_level_interrupt(&commented_out.lines().collect::<Vec<_>>()),
        "a commented-out call must NOT satisfy the gate — a doc/inline comment must never trip it"
    );
}

#[test]
fn property_two_distinguishes_zero_one_and_two_transaction_opens() {
    // Falsifiability companion for property 2: the count must read 0 for no transaction, 1 for the
    // fixed shape, and 2 for a body that textually opens the connection-level transaction twice —
    // e.g. a future edit that inlines `stop_session_in_tx`'s composition directly into
    // `stop_session_recording_first` and duplicates the `conn.transaction()` call instead of
    // sharing one. (The OTHER pre-fix reintroduction shape — calling back through the connection-
    // level `interrupt_session`, whose own internal transaction is invisible to this per-line
    // text scan across a function-call boundary — is what property 1's gate catches directly.)
    let one_transaction = "\
fn stop_session_recording_first(
    conn: &mut Connection,
) -> Result<String, String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(String::new())
}
";
    let lines: Vec<&str> = one_transaction.lines().collect();
    let region = function_region(&lines, "fn stop_session_recording_first(");
    assert_eq!(connection_transaction_open_count(region), 1);

    let two_transactions = "\
fn stop_session_recording_first(
    conn: &mut Connection,
) -> Result<String, String> {
    let tx1 = conn.transaction().map_err(|e| e.to_string())?;
    tx1.commit().map_err(|e| e.to_string())?;
    let tx2 = conn.transaction().map_err(|e| e.to_string())?;
    tx2.commit().map_err(|e| e.to_string())?;
    Ok(String::new())
}
";
    let lines_two: Vec<&str> = two_transactions.lines().collect();
    let region_two = function_region(&lines_two, "fn stop_session_recording_first(");
    assert_eq!(
        connection_transaction_open_count(region_two),
        2,
        "the fixture deliberately opens the connection-level transaction twice — this test's OWN \
         detector must observe both"
    );

    let zero_transactions = "\
fn stop_session_recording_first(
    conn: &mut Connection,
) -> Result<String, String> {
    Ok(String::new())
}
";
    let lines_zero: Vec<&str> = zero_transactions.lines().collect();
    let region_zero = function_region(&lines_zero, "fn stop_session_recording_first(");
    assert_eq!(connection_transaction_open_count(region_zero), 0);
}

#[test]
fn a_missing_in_tx_reference_trips_property_three() {
    // Falsifiability companion for property 3.
    let correct = "\
pub fn interrupt_session(conn: &mut Connection, session_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    interrupt_session_in_tx(&tx, session_id, actor_id)?;
    tx.commit()?;
    Ok(())
}
";
    let lines: Vec<&str> = correct.lines().collect();
    let region = function_region(&lines, "pub fn interrupt_session(");
    assert!(references_in_tx_sibling(region));

    let drifted = "\
pub fn interrupt_session(conn: &mut Connection, session_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    // Carries its own copy of the statement body instead of delegating.
    tx.execute(\"UPDATE sessions SET status = 'interrupted' WHERE id = ?1\", [])?;
    tx.commit()?;
    Ok(())
}
";
    let lines_drifted: Vec<&str> = drifted.lines().collect();
    let region_drifted = function_region(&lines_drifted, "pub fn interrupt_session(");
    assert!(
        !references_in_tx_sibling(region_drifted),
        "the fixture deliberately carries its own copy of the statement body instead of delegating — \
         this test's OWN detector must observe the missing reference"
    );
}
