//! Phase 4's headline deliverable and the phase's own permission to ship (CTX-07, ROADMAP.md's
//! Phase 4 Notes research flag): one task driven through ten session cycles, each cycle exercised
//! through the SAME functions a real session calls — `start_agent_run`, `create_summary`,
//! `close_agent_run` — never a raw SQL insert, so a regression in the real write path fails here
//! too. No live model call and no network call anywhere in this file: `PITFALLS.md`'s "Looks Done
//! But Isn't" checklist names context reconstitution's most common failure mode as "tested only on
//! session 1 to 2," and WINDOWS.md rows 11 and 12 record two consecutive end-of-phase live-session
//! UAT runs failing on pre-existing flakiness unrelated to this phase's own diffs — an unrepeatable
//! harness would make the phase's headline evidence worse than no evidence at all. Driven
//! synthetically instead: a green run here is a statement about the code, not about the network or
//! the weather.
//!
//! Task 1 (this module's first four tests): the falsifying property itself — criteria fidelity
//! (byte-identical statements at cycle five and cycle ten), decision retention (every id recorded
//! across all ten cycles is still on the packet at the end), and the append-only guarantee at cycle
//! scale (exactly ten summary rows, with the first cycle's own row untouched by everything written
//! after it).
//!
//! Task 2 (the six tests that follow): the roadmap's "context-quality metrics," turned from a
//! phrase into six named assertions — bounded verbatim carry, no narrative leakage, decision
//! retention under folding as read from the RENDERED prompt (not merely the struct), per-cycle
//! determinism, zero drift false positives across ten honest cycles, and growth confined to the
//! folded region.

mod common;

use core::compaction::VERBATIM_WINDOW;
use core::context_packet::{assemble_context_packet, render_prompt};
use core::domain::acceptance_criterion::{create_criterion, list_current_criteria};
use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::session_summary::{
    create_summary, list_summaries_for_task, DecisionEntry, SessionSummary, SummaryFields,
};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use core::drift::{detect_drift, DriftInputs};

// Identical guard to `context_packet.rs`'s own — `FLYWHEEL_WORKTREE_ROOT` is process-wide state,
// and this file's own binary runs its `#[test]` fns concurrently by default.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above — only one test at a time ever has
    // this var set within this binary, and it is always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// The stable, cycle-derived decision id `run_one_cycle` writes and every later cycle's
/// `acknowledged_decisions` echoes back. `cycle` is 1-based throughout this file, matching the
/// compaction boundary's own `boundary_sentence` language ("Summaries 1-4 are folded").
///
/// Zero-padded to two digits (`01`..`10`) — not cosmetic: without padding, `"cycle-1-decision"`
/// is a Rust-string PREFIX of `"cycle-10-decision"`, so a `str::contains` absence check for cycle
/// 1's marker would spuriously match inside cycle 10's own text. Zero-padding to a fixed width
/// makes every marker in this file a genuinely non-overlapping substring of every other.
fn decision_id_for_cycle(cycle: usize) -> String {
    format!("cycle-{cycle:02}-decision")
}

/// A marker substring unique to `cycle`, embedded in that cycle's `changed_prose` — Task 2's
/// leakage tests search for this string to prove a folded cycle's prose is genuinely gone from the
/// rendered prompt, not merely unrendered somewhere else. Zero-padded for the same
/// no-prefix-collision reason [`decision_id_for_cycle`] documents.
fn prose_marker_for_cycle(cycle: usize) -> String {
    format!("prose-marker-cycle-{cycle:02}")
}

/// A marker substring unique to `cycle`'s decision statement — Task 2's retention-under-folding
/// test searches for these across the whole ten-cycle span. Zero-padded for the same
/// no-prefix-collision reason [`decision_id_for_cycle`] documents.
fn decision_marker_for_cycle(cycle: usize) -> String {
    format!("decision-marker-cycle-{cycle:02}")
}

/// One cycle, driven through the real production write path — `start_agent_run`, `create_summary`,
/// `close_agent_run` — exactly as a real session does. Two changed files derived from `cycle`, one
/// decision entry with a stable cycle-derived id, and `acknowledged_decisions` echoing every
/// decision id recorded by this cycle and every one before it — precisely what a real closing
/// session that read the board's Decisions On Record section and acknowledged all of it would
/// send. Returns the recorded [`SessionSummary`] so callers can capture a cycle's own row for a
/// later byte-identical comparison.
fn run_one_cycle(
    conn: &mut rusqlite::Connection,
    task_id: &str,
    actor_id: &str,
    cycle: usize,
) -> SessionSummary {
    let run = start_agent_run(conn, task_id, "acceptEdits", actor_id)
        .unwrap_or_else(|e| panic!("start_agent_run should succeed for cycle {cycle}: {e}"));

    let decision_id = decision_id_for_cycle(cycle);
    let acknowledged_decisions: Vec<String> = (1..=cycle).map(decision_id_for_cycle).collect();

    let fields = SummaryFields {
        changed_files: vec![
            format!("src/cycle-{cycle}-a.rs"),
            format!("src/cycle-{cycle}-b.rs"),
        ],
        changed_prose: Some(format!(
            "{} — cycle {cycle}'s own narrative.",
            prose_marker_for_cycle(cycle)
        )),
        remains: None,
        next_session_must_know: None,
        decisions: vec![DecisionEntry {
            id: decision_id,
            statement: format!(
                "{} — decided something in cycle {cycle}.",
                decision_marker_for_cycle(cycle)
            ),
        }],
        acknowledged_decisions,
        diff_ref: None,
        auto_generated: false,
    };

    let summary = create_summary(conn, &run.id, fields, actor_id)
        .unwrap_or_else(|e| panic!("create_summary should succeed for cycle {cycle}: {e}"));

    close_agent_run(conn, &run.id, AgentRunStatus::Completed, None, None, None)
        .unwrap_or_else(|e| panic!("close_agent_run should succeed for cycle {cycle}: {e}"));

    summary
}

/// Seed one project/task/three-criteria fixture, shared by every test in this file.
fn seed_task_with_three_criteria(
    conn: &mut rusqlite::Connection,
    project_id: &str,
    actor_id: &str,
    task_name: &str,
) -> core::domain::task::Task {
    let task = create_task(conn, project_id, actor_id, task_name, None)
        .expect("create_task should succeed");
    create_criterion(
        conn,
        project_id,
        actor_id,
        "task",
        &task.id,
        "First criterion, present before any cycle runs",
        Some("run the test"),
    )
    .expect("create_criterion 1 should succeed");
    create_criterion(
        conn,
        project_id,
        actor_id,
        "task",
        &task.id,
        "Second criterion, present before any cycle runs",
        None,
    )
    .expect("create_criterion 2 should succeed");
    create_criterion(
        conn,
        project_id,
        actor_id,
        "task",
        &task.id,
        "Third criterion, present before any cycle runs",
        Some("check it manually"),
    )
    .expect("create_criterion 3 should succeed");
    ensure_worktree(conn, &task.id, actor_id).expect("ensure_worktree should succeed");
    task
}

#[test]
fn criteria_statements_are_byte_identical_at_cycle_five_and_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Criteria fidelity across ten cycles",
        );

        let captured = assemble_context_packet(&conn, &task.id)
            .expect("assembly before any cycle should succeed")
            .criteria;
        assert_eq!(captured.len(), 3, "the fixture must seed exactly three criteria");

        for cycle in 1..=5 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }
        let at_five = assemble_context_packet(&conn, &task.id)
            .expect("assembly at cycle five should succeed")
            .criteria;
        assert_eq!(
            at_five, captured,
            "the criteria vector must be byte-identical, element for element and in the same \
             order, after five cycles — a criterion's statement or hint must never drift merely \
             because sessions came and went"
        );

        for cycle in 6..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }
        let at_ten = assemble_context_packet(&conn, &task.id)
            .expect("assembly at cycle ten should succeed")
            .criteria;
        assert_eq!(
            at_ten, captured,
            "the criteria vector must still be byte-identical after ten cycles — this is the \
             property that must survive more than the first fold, not merely the first one"
        );
    });
}

#[test]
fn every_decision_recorded_across_ten_cycles_is_present_in_the_packet_at_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Decision retention across ten cycles",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let recorded_ids: std::collections::HashSet<String> =
            (1..=10).map(decision_id_for_cycle).collect();
        let packet_ids: std::collections::HashSet<String> =
            packet.decisions.iter().map(|d| d.id.clone()).collect();

        assert_eq!(
            packet.decisions.len(),
            10,
            "every one of the ten cycles wrote exactly one decision — none may be missing or \
             duplicated in the accumulated list"
        );
        assert_eq!(
            packet_ids, recorded_ids,
            "the packet's decisions must contain every id written across all ten cycles, and no \
             id that was never written"
        );
    });
}

#[test]
fn the_summary_row_count_for_the_task_is_exactly_ten_at_the_end() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Append-only row count across ten cycles",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let summaries =
            list_summaries_for_task(&conn, &task.id).expect("list_summaries_for_task should succeed");
        assert_eq!(
            summaries.len(),
            10,
            "ten cycles must leave exactly ten summary rows — nothing overwritten in place"
        );
    });
}

#[test]
fn the_first_cycles_summary_content_is_byte_identical_at_the_end() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "First row untouched across ten cycles",
        );

        let first_written = run_one_cycle(&mut conn, &task.id, &actor_id, 1);
        for cycle in 2..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let summaries =
            list_summaries_for_task(&conn, &task.id).expect("list_summaries_for_task should succeed");
        let first_read_back = summaries
            .first()
            .expect("at least one summary row must exist");

        assert_eq!(first_read_back.changed_files, first_written.changed_files);
        assert_eq!(first_read_back.changed_prose, first_written.changed_prose);
        assert_eq!(first_read_back.remains, first_written.remains);
        assert_eq!(
            first_read_back.next_session_must_know, first_written.next_session_must_know,
            "the first cycle's own row must be byte-identical to what it was written with, even \
             after nine more cycles have since been recorded"
        );
    });
}

// --- Task 2: the six context-quality metrics ROADMAP.md's Phase 4 Notes named as a ship gate,
// each asserted at every cycle rather than once at the end. Reuses `run_one_cycle` above; adds no
// second cycle driver.

/// Metric 1: bounded verbatim carry. At every cycle from `VERBATIM_WINDOW + 1` through ten, the
/// packet's compaction boundary reports exactly `VERBATIM_WINDOW` verbatim summaries, and the
/// folded count equals the cycle number minus the window.
#[test]
fn bounded_verbatim_carry_is_exactly_five_from_cycle_six_through_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Bounded verbatim carry",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
            if cycle >= VERBATIM_WINDOW + 1 {
                let packet =
                    assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
                assert_eq!(
                    packet.compaction.verbatim_count, VERBATIM_WINDOW,
                    "cycle {cycle}: exactly {VERBATIM_WINDOW} summaries must be carried verbatim"
                );
                assert_eq!(
                    packet.compaction.folded_count,
                    cycle - VERBATIM_WINDOW,
                    "cycle {cycle}: the folded count must equal the cycle number minus the \
                     verbatim window"
                );
            }
        }
    });
}

/// Metric 2: no narrative leakage. Each cycle's prose marker is distinctive; at cycle ten the
/// rendered prompt must carry cycles six through ten's markers and none of cycles one through
/// five's — proving the folded prose is genuinely gone, not merely unrendered somewhere else.
#[test]
fn folded_summaries_narrative_is_absent_from_the_rendered_prompt_at_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "No narrative leakage past the fold",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt = render_prompt(&packet, "");

        for cycle in 1..=5 {
            assert!(
                !prompt.contains(&prose_marker_for_cycle(cycle)),
                "cycle {cycle}'s prose marker folded and must not appear anywhere in the \
                 rendered prompt: {prompt}"
            );
        }
        for cycle in 6..=10 {
            assert!(
                prompt.contains(&prose_marker_for_cycle(cycle)),
                "cycle {cycle}'s prose marker is carried verbatim and must appear in the \
                 rendered prompt"
            );
        }
    });
}

/// Metric 3: decision retention under folding, asserted on RENDERED output (not the struct) — at
/// cycle ten every one of the ten decision markers, including the five that folded, must appear
/// in the rendered prompt's Decisions On Record section.
#[test]
fn every_decision_including_folded_ones_appears_in_the_rendered_prompt_at_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Decision retention under folding, read from the rendered prompt",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt = render_prompt(&packet, "");

        for cycle in 1..=10 {
            assert!(
                prompt.contains(&decision_marker_for_cycle(cycle)),
                "cycle {cycle}'s decision statement must appear in the rendered prompt — \
                 compaction is lossless for decisions even when its own cycle folded"
            );
        }
    });
}

/// Metric 4: per-cycle determinism. At every one of the ten cycles — not only at the end — two
/// assemblies against the unchanged database are equal and two renders are byte-identical.
#[test]
fn two_assemblies_and_two_renders_are_byte_identical_at_every_one_of_the_ten_cycles() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Per-cycle determinism",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);

            let packet_a = assemble_context_packet(&conn, &task.id)
                .unwrap_or_else(|e| panic!("first assembly at cycle {cycle} should succeed: {e}"));
            let packet_b = assemble_context_packet(&conn, &task.id)
                .unwrap_or_else(|e| panic!("second assembly at cycle {cycle} should succeed: {e}"));
            assert_eq!(
                packet_a, packet_b,
                "cycle {cycle}: two assemblies against the unchanged database must be equal"
            );

            let prompt_a = render_prompt(&packet_a, "");
            let prompt_b = render_prompt(&packet_b, "");
            assert_eq!(
                prompt_a, prompt_b,
                "cycle {cycle}: two renders of the same packet must be byte-identical"
            );
        }
    });
}

/// Metric 5: zero false positives. At every cycle, `detect_drift` over honestly-constructed
/// inputs — the claimed file list equal to the real one, a clean working tree, the pin equal to
/// the current criterion ids, and the echo covering every recorded decision — returns an empty
/// vector. A detector that ever fires on an honest cycle is one that would cry wolf as history
/// grows, which is the failure mode that would make the board signal worthless.
#[test]
fn ten_honest_cycles_fire_zero_drift_warnings_at_every_cycle() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Zero drift false positives across ten honest cycles",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);

            let packet =
                assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
            let current_criterion_ids: Vec<String> = list_current_criteria(&conn, "task", &task.id)
                .expect("list_current_criteria should succeed")
                .into_iter()
                .map(|c| c.id)
                .collect();
            let latest_claimed_files = packet
                .summaries
                .last()
                .expect("at least one summary must exist by now")
                .changed_files
                .clone();

            let inputs = DriftInputs {
                summaries: &packet.summaries,
                real_changed_paths: Some(&latest_claimed_files),
                head_ref: None,
                working_tree_dirty: false,
                pinned_criterion_ids: Some(&current_criterion_ids),
                current_criterion_ids: &current_criterion_ids,
            };
            let warnings = detect_drift(&inputs);
            assert!(
                warnings.is_empty(),
                "cycle {cycle}: an honest set of inputs must fire zero drift warnings, got \
                 {warnings:?}"
            );
        }
    });
}

/// Extract the "verbatim" portion of a rendered Prior Sessions section — either the flat list (no
/// folding has happened yet) or the `### Recent sessions (verbatim)` subsection — up to (but not
/// including) the next top-level `## ` heading. Isolates the region Metric 6's growth assertion is
/// actually about, rather than measuring the whole prompt, which legitimately grows as the folded
/// region grows too.
fn extract_verbatim_region(prompt: &str) -> &str {
    let (marker_idx, marker_len) = if let Some(idx) =
        prompt.find("### Recent sessions (verbatim)\n\n")
    {
        (idx, "### Recent sessions (verbatim)\n\n".len())
    } else {
        let idx = prompt
            .find("## Prior Sessions\n\n")
            .expect("a rendered prompt with any summaries must carry a Prior Sessions heading");
        (idx, "## Prior Sessions\n\n".len())
    };
    let start = marker_idx + marker_len;
    let rest = &prompt[start..];
    let end = rest.find("\n## ").unwrap_or(rest.len());
    &rest[..end]
}

/// Metric 6: growth is confined to the folded region. The verbatim region's byte length at cycle
/// ten is within ten percent of its byte length at cycle five, because the window is fixed at
/// five summaries of comparable size — cycle five's flat list of five summaries and cycle ten's
/// verbatim subsection of five summaries are the same shape.
#[test]
fn growth_between_cycle_five_and_cycle_ten_is_confined_to_the_folded_region() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Growth confined to the folded region",
        );

        for cycle in 1..=5 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }
        let packet_at_five = assemble_context_packet(&conn, &task.id)
            .expect("assembly at cycle five should succeed");
        let region_at_five =
            extract_verbatim_region(&render_prompt(&packet_at_five, "")).to_string();

        for cycle in 6..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }
        let packet_at_ten = assemble_context_packet(&conn, &task.id)
            .expect("assembly at cycle ten should succeed");
        let region_at_ten = extract_verbatim_region(&render_prompt(&packet_at_ten, "")).to_string();

        let len_five = region_at_five.len() as f64;
        let len_ten = region_at_ten.len() as f64;
        let delta_ratio = (len_ten - len_five).abs() / len_five;

        assert!(
            delta_ratio <= 0.10,
            "the verbatim region's byte length must stay within 10% between cycle five \
             ({len_five} bytes) and cycle ten ({len_ten} bytes) — the window is fixed at five \
             summaries of comparable size, so growth must be confined to the folded region, not \
             the verbatim one; delta ratio was {delta_ratio}"
        );
    });
}
