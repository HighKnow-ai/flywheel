//! Gap #2 of 04-VERIFICATION.md (CTX-06) as a structural gate over the REAL desktop source file
//! on disk, following `termination_atomicity_call_site.rs`'s idiom verbatim in shape: a
//! `workspace_root()` helper walking up two levels from `CARGO_MANIFEST_DIR`, an
//! `is_whole_line_comment` helper stripping whole-line `//` comments so a doc comment can neither
//! satisfy nor violate a rule, a region locator that finds a function by its signature line rather
//! than by a fixed line offset, and failure messages that name the file and quote the region
//! examined. `session_closed_call_site.rs` and `agent_run_stop_ordering.rs` are this repo's other
//! two precedents for a source-structural ordering assertion; this file matches that house style
//! too, rather than inventing a fourth.
//!
//! Why a behavioural test alone is insufficient here: the defect gap #2 names was an ORDERING
//! relationship between two statements — resolving "the run that preceded this one" via
//! `latest_run_id_for_task`, and inserting the new `agent_runs` row via `start_agent_run`. An
//! ordering relationship has no compiler error and no runtime signal until a specific detector
//! happens to be exercised (the criteria-revision one, and only when a criterion was actually
//! revised between two runs). `criteria_revision_moved_reaches_the_prompt_and_the_event_log_when_a_run_actually_starts`
//! (in `agent_run.rs` itself) proves the CURRENT ordering is correct; this gate goes red on the
//! reordering itself, the instant a future edit reintroduces it, whether or not any behavioural
//! test happens to be run against that exact revision shape yet.

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
/// `termination_atomicity_call_site.rs`'s own identical helper.
fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// Locate a function by its signature substring and return the lines from that signature down
/// through its own closing brace — a bare `}` at column zero, which is where a top-level Rust
/// item's body ends (every line inside the body is indented; only the function's own close sits
/// unindented). Resilient to unrelated edits elsewhere in the file, unlike a fixed line-count
/// window. Mirrors `termination_atomicity_call_site.rs`'s identical helper.
fn function_region<'a>(lines: &'a [&'a str], signature_substr: &str) -> &'a [&'a str] {
    let start_idx = lines.iter().position(|line| line.contains(signature_substr)).unwrap_or_else(|| {
        panic!("expected to find `{signature_substr}` in the given source")
    });
    let end_idx = lines[start_idx..]
        .iter()
        .position(|line| line.trim_end() == "}")
        .map(|offset| start_idx + offset + 1)
        .unwrap_or(lines.len());
    &lines[start_idx..end_idx]
}

/// Property 1: within `region`, non-comment lines only, find the line index of the predecessor
/// resolution (`latest_run_id_for_task`) and the line index of the mutating insert
/// (`start_agent_run(` — the connection-level entry point; the deliberately non-matching
/// `start_agent_run_recording_first(` call is this function's own signature line, never a call
/// site inside its own body). Returns `(resolve_idx, insert_idx)`, each `None` if not found.
fn predecessor_and_insert_indices(region: &[&str]) -> (Option<usize>, Option<usize>) {
    let non_comment: Vec<(usize, &&str)> =
        region.iter().enumerate().filter(|(_, line)| !is_whole_line_comment(line)).collect();

    let resolve_idx = non_comment
        .iter()
        .find(|(_, line)| line.contains("latest_run_id_for_task"))
        .map(|(idx, _)| *idx);
    let insert_idx = non_comment
        .iter()
        .find(|(_, line)| line.contains("start_agent_run("))
        .map(|(idx, _)| *idx);

    (resolve_idx, insert_idx)
}

/// Property 2: within `region`, non-comment lines only, does a call to `packet_extras_for(` exist,
/// and does that same line's text also carry `previous_run_id` — the local property 1 proves is
/// resolved above it, threaded through rather than re-derived?
fn packet_extras_call_threads_previous_run_id(region: &[&str]) -> Option<bool> {
    region
        .iter()
        .filter(|line| !is_whole_line_comment(line))
        .find(|line| line.contains("packet_extras_for("))
        .map(|line| line.contains("previous_run_id"))
}

/// Property 3: within `region` (expected to be `packet_extras_for`'s own body), count non-comment
/// lines referencing `latest_run_id_for_task` — the extras builder must never re-derive it itself.
fn latest_run_id_reference_count(region: &[&str]) -> usize {
    region
        .iter()
        .filter(|line| !is_whole_line_comment(line))
        .filter(|line| line.contains("latest_run_id_for_task"))
        .count()
}

#[test]
fn the_predecessor_is_resolved_strictly_before_the_new_run_is_inserted() {
    let root = workspace_root();
    let agent_run_rs = root.join("packages/desktop/src-tauri/src/commands/agent_run.rs");
    let contents = std::fs::read_to_string(&agent_run_rs).expect("agent_run.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    let region = function_region(&lines, "fn start_agent_run_recording_first(");
    let region_text = region.join("\n");
    let (resolve_idx, insert_idx) = predecessor_and_insert_indices(region);

    let resolve_idx = resolve_idx.unwrap_or_else(|| {
        panic!(
            "expected a non-comment call to `latest_run_id_for_task` within \
             `start_agent_run_recording_first`'s own body in {} — its absence means the run that \
             preceded this one is never resolved at all, reopening gap #2 of \
             04-VERIFICATION.md. Region:\n{region_text}",
            agent_run_rs.display()
        )
    });
    let insert_idx = insert_idx.unwrap_or_else(|| {
        panic!(
            "expected a non-comment call to `start_agent_run(` within \
             `start_agent_run_recording_first`'s own body in {}. Region:\n{region_text}",
            agent_run_rs.display()
        )
    });

    assert!(
        resolve_idx < insert_idx,
        "expected the predecessor resolution (`latest_run_id_for_task`) to appear strictly \
         BEFORE the mutating insert (`start_agent_run(`) within \
         `start_agent_run_recording_first`'s own body in {} — resolving the predecessor AFTER \
         the new `agent_runs` row is inserted reopens gap #2 of 04-VERIFICATION.md: \
         `latest_run_id_for_task` orders by `started_at DESC LIMIT 1`, so it would resolve the \
         brand-new, not-yet-pinned run instead of its predecessor, silently collapsing the \
         criteria-revision detector to `None` even when the criteria really did move. \
         Region:\n{region_text}",
        agent_run_rs.display()
    );
}

#[test]
fn the_extras_builder_is_called_with_the_threaded_predecessor_not_re_derived() {
    let root = workspace_root();
    let agent_run_rs = root.join("packages/desktop/src-tauri/src/commands/agent_run.rs");
    let contents = std::fs::read_to_string(&agent_run_rs).expect("agent_run.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    let region = function_region(&lines, "fn start_agent_run_recording_first(");
    let region_text = region.join("\n");

    let threads_previous_run_id =
        packet_extras_call_threads_previous_run_id(region).unwrap_or_else(|| {
            panic!(
                "expected a non-comment call to `packet_extras_for(` within \
                 `start_agent_run_recording_first`'s own body in {}. Region:\n{region_text}",
                agent_run_rs.display()
            )
        });

    assert!(
        threads_previous_run_id,
        "expected `start_agent_run_recording_first`'s own call to `packet_extras_for(` in {} to \
         pass the threaded `previous_run_id` local property 1 just proved is resolved above it — \
         its absence means the extras builder is being called without the threaded predecessor, \
         which is the wiring gap #2 of 04-VERIFICATION.md describes. Region:\n{region_text}",
        agent_run_rs.display()
    );
}

#[test]
fn the_extras_builder_never_re_derives_the_latest_run_itself() {
    let root = workspace_root();
    let agent_run_rs = root.join("packages/desktop/src-tauri/src/commands/agent_run.rs");
    let contents = std::fs::read_to_string(&agent_run_rs).expect("agent_run.rs should exist");
    let lines: Vec<&str> = contents.lines().collect();

    let region = function_region(&lines, "fn packet_extras_for(");
    let region_text = region.join("\n");
    let count = latest_run_id_reference_count(region);

    assert_eq!(
        count, 0,
        "expected ZERO non-comment references to `latest_run_id_for_task` within \
         `packet_extras_for`'s own body in {}, found {count} — the extras builder has resumed \
         re-deriving the latest run itself, which resolves the run being STARTED rather than its \
         predecessor (gap #2 of 04-VERIFICATION.md). Region:\n{region_text}",
        agent_run_rs.display()
    );
}

#[test]
fn a_reordered_predecessor_resolution_trips_property_one() {
    // Falsifiability companion, mirroring session_closed_call_site.rs's and
    // termination_atomicity_call_site.rs's own seeded-violation tests: proves this file's own
    // matching logic actually detects the violation, not just that it is structurally present
    // today.
    let correct = "\
pub(crate) fn start_agent_run_recording_first(conn: &mut Connection, task_id: &str) -> Result<StartRunOutcome, String> {
    let previous_run_id = flywheel_core::query::permissions::latest_run_id_for_task(conn, task_id)
        .map_err(|e| e.to_string())?;
    let run = flywheel_core::domain::agent_run::start_agent_run(conn, task_id)
        .map_err(|e| e.to_string())?;
    Ok(StartRunOutcome { run_id: run.id })
}
";
    let lines: Vec<&str> = correct.lines().collect();
    let region = function_region(&lines, "fn start_agent_run_recording_first(");
    let (resolve_idx, insert_idx) = predecessor_and_insert_indices(region);
    assert!(resolve_idx.unwrap() < insert_idx.unwrap());

    let reverted = "\
pub(crate) fn start_agent_run_recording_first(conn: &mut Connection, task_id: &str) -> Result<StartRunOutcome, String> {
    let run = flywheel_core::domain::agent_run::start_agent_run(conn, task_id)
        .map_err(|e| e.to_string())?;
    let previous_run_id = flywheel_core::query::permissions::latest_run_id_for_task(conn, task_id)
        .map_err(|e| e.to_string())?;
    Ok(StartRunOutcome { run_id: run.id })
}
";
    let lines_reverted: Vec<&str> = reverted.lines().collect();
    let region_reverted = function_region(&lines_reverted, "fn start_agent_run_recording_first(");
    let (resolve_idx_reverted, insert_idx_reverted) =
        predecessor_and_insert_indices(region_reverted);
    assert!(
        resolve_idx_reverted.unwrap() > insert_idx_reverted.unwrap(),
        "the fixture deliberately reorders the predecessor resolution AFTER the insert — this \
         test's OWN detector must observe the reversed ordering"
    );
}

#[test]
fn a_call_without_the_threaded_argument_trips_property_two() {
    // Falsifiability companion for property 2.
    let correct = "\
pub(crate) fn start_agent_run_recording_first(conn: &mut Connection) -> Result<(), String> {
    let extras = packet_extras_for(conn, &packet, task_id, previous_run_id.as_deref());
    Ok(())
}
";
    let lines: Vec<&str> = correct.lines().collect();
    let region = function_region(&lines, "fn start_agent_run_recording_first(");
    assert_eq!(packet_extras_call_threads_previous_run_id(region), Some(true));

    let reverted = "\
pub(crate) fn start_agent_run_recording_first(conn: &mut Connection) -> Result<(), String> {
    let extras = packet_extras_for(conn, &packet, task_id);
    Ok(())
}
";
    let lines_reverted: Vec<&str> = reverted.lines().collect();
    let region_reverted = function_region(&lines_reverted, "fn start_agent_run_recording_first(");
    assert_eq!(
        packet_extras_call_threads_previous_run_id(region_reverted),
        Some(false),
        "the fixture deliberately calls packet_extras_for with the old 3-argument shape — this \
         test's OWN detector must observe the missing threaded argument"
    );
}

#[test]
fn a_re_derivation_inside_the_extras_builder_trips_property_three() {
    // Falsifiability companion for property 3.
    let correct = "\
fn packet_extras_for(conn: &Connection, previous_run_id: Option<&str>) -> PacketExtras {
    let pinned_criterion_ids = match previous_run_id {
        Some(run_id) => criteria_revision_pin_for_run(conn, run_id).unwrap_or(None),
        None => None,
    };
    PacketExtras { diff: None, drift: Vec::new() }
}
";
    let lines: Vec<&str> = correct.lines().collect();
    let region = function_region(&lines, "fn packet_extras_for(");
    assert_eq!(latest_run_id_reference_count(region), 0);

    let drifted = "\
fn packet_extras_for(conn: &Connection, task_id: &str) -> PacketExtras {
    let pinned_criterion_ids = match latest_run_id_for_task(conn, task_id) {
        Ok(Some(run_id)) => criteria_revision_pin_for_run(conn, &run_id).unwrap_or(None),
        _ => None,
    };
    PacketExtras { diff: None, drift: Vec::new() }
}
";
    let lines_drifted: Vec<&str> = drifted.lines().collect();
    let region_drifted = function_region(&lines_drifted, "fn packet_extras_for(");
    assert_eq!(
        latest_run_id_reference_count(region_drifted),
        1,
        "the fixture deliberately re-derives the latest run inside the extras builder — this \
         test's OWN detector must observe it"
    );
}

#[test]
fn stripping_a_commented_out_occurrence_does_not_trip_any_gate() {
    // Proves the whole-line-comment strip actually works, mirroring
    // `termination_atomicity_call_site.rs`'s own identical falsifiability check.
    let commented = "\
fn start_agent_run_recording_first(conn: &mut Connection) -> Result<(), String> {
    // let previous_run_id = flywheel_core::query::permissions::latest_run_id_for_task(conn, task_id)?;
    let run = flywheel_core::domain::agent_run::start_agent_run(conn, task_id)?;
    // let extras = packet_extras_for(conn, &packet, task_id, previous_run_id.as_deref());
    Ok(())
}
";
    let lines: Vec<&str> = commented.lines().collect();
    let region = function_region(&lines, "fn start_agent_run_recording_first(");
    let (resolve_idx, insert_idx) = predecessor_and_insert_indices(region);
    assert!(
        resolve_idx.is_none(),
        "a commented-out `latest_run_id_for_task` call must NOT satisfy property 1"
    );
    assert!(insert_idx.is_some(), "the real, non-commented insert call must still be found");
    assert_eq!(
        packet_extras_call_threads_previous_run_id(region),
        None,
        "a commented-out `packet_extras_for(` call must NOT satisfy property 2"
    );
}
