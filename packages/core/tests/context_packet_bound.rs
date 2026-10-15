//! FNC-05 (plan 13-02, D-01..D-07): the context packet is bounded at its INPUT. `SUMMARIES_SQL`
//! reads at most `compaction::SUMMARY_WINDOW` rows, so the packet stops growing with task age —
//! the scale ceiling the research round named as the biggest threat to the product thesis ("`/clear`
//! is free").
//!
//! The named scale fixture is [`scale_fixture`]: one task, **200 session summaries**, each with 3
//! decisions and 4 changed-file paths, and 30 KB of prose across the summaries' narrative fields,
//! written through the real `start_agent_run` / `create_summary` / `close_agent_run` path so the
//! fixture can never drift from the schema. It is a function, never a committed binary file.
//!
//! Phase 16 extends this fixture. ADR and PRD records do not exist until then, so criterion 4's
//! "40 ADRs and a 30 KB PRD" halves are represented here by the prose volume alone — recorded as
//! the part of the fixture Phase 16 adds, not silently skipped. The ADR form of
//! `adding_a_superseded_record_leaves_the_packet_byte_identical` lands with the ADR table in Phase
//! 16, against this same test.
//!
//! Self-contained per this repo's source-gate precedent (`proposal_no_promotion.rs`): it carries its
//! own helpers rather than sharing a module.

mod common;

use core::compaction::SUMMARY_WINDOW;
use core::context_packet::{assemble_context_packet, render_prompt, ContextPacket};
use core::domain::acceptance_criterion::{create_criterion, list_current_criteria, revise_criterion};
use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::session_summary::{create_summary, DecisionEntry, SummaryFields};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use rusqlite::Connection;

// `FLYWHEEL_WORKTREE_ROOT` is process-wide state and this binary runs its `#[test]` fns
// concurrently, so every test that needs a real worktree serialises on this lock.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Exactly 150 characters of narrative for summary `n` — fixed width on purpose, so two fixtures of
/// different age have summary text of identical size and a length comparison between them
/// measures the packet's growth with age and nothing else. 200 of these are 30 KB.
fn prose_for(n: usize) -> String {
    let head = format!("summary {n:03} narrative: ");
    let pad = 150 - head.len();
    format!("{head}{}", "x".repeat(pad))
}

/// The decision ids summary `n` records, three per summary, zero-padded so their width is fixed.
fn decision_ids_for(n: usize) -> Vec<String> {
    (1..=3).map(|k| format!("s{n:03}-d{k}")).collect()
}

/// Seed `count` summaries onto a fresh task through the real write path. Each summary records 3
/// decisions and 4 changed-file paths, carries [`prose_for`] narrative, and acknowledges the
/// decisions of the summary before it.
fn seed_summaries(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    task_name: &str,
    count: usize,
) -> String {
    let task = create_task(conn, project_id, actor_id, task_name, None)
        .expect("create_task should succeed");
    ensure_worktree(conn, &task.id, actor_id).expect("ensure_worktree should succeed");

    for n in 1..=count {
        let run = start_agent_run(conn, &task.id, "acceptEdits", actor_id)
            .unwrap_or_else(|e| panic!("start_agent_run should succeed for summary {n}: {e}"));
        let acknowledged = if n > 1 { decision_ids_for(n - 1) } else { Vec::new() };
        let fields = SummaryFields {
            changed_files: (1..=4).map(|k| format!("src/s{n:03}-f{k}.rs")).collect(),
            changed_prose: Some(prose_for(n)),
            remains: None,
            next_session_must_know: None,
            decisions: decision_ids_for(n)
                .into_iter()
                .map(|id| DecisionEntry { statement: format!("statement for {id}"), id })
                .collect(),
            acknowledged_decisions: acknowledged,
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(conn, &run.id, fields, actor_id)
            .unwrap_or_else(|e| panic!("create_summary should succeed for summary {n}: {e}"));
        close_agent_run(conn, &run.id, AgentRunStatus::Completed, None, None, None)
            .unwrap_or_else(|e| panic!("close_agent_run should succeed for summary {n}: {e}"));
    }
    task.id
}

/// The named scale fixture of criterion 4: 200 session summaries on one task.
fn scale_fixture(conn: &mut Connection, project_id: &str, actor_id: &str) -> String {
    seed_summaries(conn, project_id, actor_id, "Scale fixture A", 200)
}

/// The rendered `## Prior Sessions` section alone — the region the window bounds — up to the next
/// top-level heading.
fn prior_sessions_section(prompt: &str) -> String {
    let start = prompt.find("## Prior Sessions").expect("the prompt should have a Prior Sessions section");
    let rest = &prompt[start..];
    let end = rest[2..].find("\n## ").map_or(rest.len(), |i| i + 2);
    rest[..end].to_string()
}

fn serialized_len(packet: &ContextPacket) -> usize {
    serde_json::to_string(packet).expect("packet should serialise").len()
}

#[test]
fn the_packet_does_not_grow_with_task_age() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let young = scale_fixture(&mut conn, &project.id, &actor_id);
        // Same shape, twice the age. Task names have equal width so nothing but age differs.
        let old = seed_summaries(&mut conn, &project.id, &actor_id, "Scale fixture B", 400);

        let young_packet = assemble_context_packet(&conn, &young).expect("assembly should succeed");
        let old_packet = assemble_context_packet(&conn, &old).expect("assembly should succeed");

        assert_eq!(young_packet.summaries.len(), SUMMARY_WINDOW);
        assert_eq!(old_packet.summaries.len(), SUMMARY_WINDOW);

        // The newest window, oldest-first: the 200-summary task keeps summaries 176..=200.
        let first_kept = young_packet.summaries.first().unwrap();
        assert!(first_kept.changed_prose.as_deref().unwrap().starts_with("summary 176 "));
        let last_kept = young_packet.summaries.last().unwrap();
        assert!(last_kept.changed_prose.as_deref().unwrap().starts_with("summary 200 "));

        // 5 verbatim plus 20 folded.
        let verbatim = core::compaction::VERBATIM_WINDOW;
        assert_eq!(young_packet.compaction.verbatim_count, verbatim);
        assert_eq!(young_packet.compaction.folded_count, SUMMARY_WINDOW - verbatim);

        // The packet's decision list is bounded by the window too: 3 decisions per summary.
        assert_eq!(young_packet.decisions.len(), SUMMARY_WINDOW * 3);
        assert_eq!(old_packet.decisions.len(), SUMMARY_WINDOW * 3);

        // The stronger property: the rendered summary sections are EQUAL IN LENGTH, so the packet
        // does not grow with task age at all.
        let young_section = prior_sessions_section(&render_prompt(&young_packet, ""));
        let old_section = prior_sessions_section(&render_prompt(&old_packet, ""));
        assert_eq!(
            young_section.len(),
            old_section.len(),
            "a 400-summary task must render the same-size Prior Sessions section as a 200-summary one"
        );
    });
}

#[test]
fn the_packet_names_its_own_inclusion_boundary_and_the_true_board_total() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = scale_fixture(&mut conn, &project.id, &actor_id);

        let packet = assemble_context_packet(&conn, &task).expect("assembly should succeed");
        let sentence = packet
            .compaction
            .boundary_sentence()
            .expect("a windowed task has a boundary sentence");
        assert!(sentence.contains("25 of 200 summaries read"), "sentence was: {sentence}");
        assert!(sentence.contains("175 earlier sessions"), "sentence was: {sentence}");

        // The prompt carries the sentence the user reads, and never enumerates excluded ids.
        let prompt = render_prompt(&packet, "");
        assert!(prompt.contains(&sentence), "the prompt must carry the boundary sentence");
        assert!(!prompt.contains("s001-d1"), "an excluded decision id must never be enumerated");
    });
}

#[test]
fn the_packet_is_strictly_smaller_for_a_small_fixture() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let large = scale_fixture(&mut conn, &project.id, &actor_id);
        let small = seed_summaries(&mut conn, &project.id, &actor_id, "Scale fixture S", 6);

        let large_packet = assemble_context_packet(&conn, &large).expect("assembly should succeed");
        let small_packet = assemble_context_packet(&conn, &small).expect("assembly should succeed");

        assert!(
            serialized_len(&small_packet) < serialized_len(&large_packet),
            "a 6-summary packet must be strictly smaller than the 200-summary packet"
        );
    });
}

#[test]
fn two_assemblies_of_an_unchanged_board_are_byte_identical() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = scale_fixture(&mut conn, &project.id, &actor_id);

        let first = assemble_context_packet(&conn, &task).expect("assembly should succeed");
        let second = assemble_context_packet(&conn, &task).expect("assembly should succeed");
        assert_eq!(first, second);
        assert_eq!(render_prompt(&first, ""), render_prompt(&second, ""));
    });
}

#[test]
fn adding_a_superseded_record_leaves_the_packet_byte_identical() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = scale_fixture(&mut conn, &project.id, &actor_id);
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task,
            "The one criterion that is current",
            Some("run the test"),
        )
        .expect("create_criterion should succeed");

        let before = assemble_context_packet(&conn, &task).expect("assembly should succeed");
        let before_prompt = render_prompt(&before, "");

        // The task has runs, so its criteria are locked: revising mints a successor row and stamps
        // the predecessor `superseded_at` — the one superseded-record mechanism that exists today.
        // The successor carries identical wording, so the only thing that changed on the board is
        // that a superseded row now exists, which `CRITERIA_SQL`'s `superseded_at IS NULL` hides.
        let criterion = list_current_criteria(&conn, "task", &task)
            .expect("list_current_criteria should succeed")
            .remove(0);
        revise_criterion(
            &mut conn,
            &actor_id,
            &criterion.id,
            "The one criterion that is current",
            Some("run the test"),
        )
        .expect("revise_criterion should succeed");

        let after = assemble_context_packet(&conn, &task).expect("assembly should succeed");
        assert_eq!(before, after, "a superseded record must not change the packet");
        assert_eq!(before_prompt, render_prompt(&after, ""), "nor the rendered prompt");
    });
}

#[test]
fn acknowledged_decisions_never_affects_packet_inclusion() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = scale_fixture(&mut conn, &project.id, &actor_id);

        let before = assemble_context_packet(&conn, &task).expect("assembly should succeed");
        let before_ids: Vec<String> = before.decisions.iter().map(|d| d.id.clone()).collect();

        // A new latest summary acknowledging EVERY decision in the packet. D-07: acknowledgement is
        // proof an agent read a decision, not that it is settled, so nothing may drop on it.
        let run = start_agent_run(&mut conn, &task, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let fields = SummaryFields {
            changed_files: Vec::new(),
            changed_prose: Some(prose_for(201)),
            remains: None,
            next_session_must_know: None,
            decisions: Vec::new(),
            acknowledged_decisions: before_ids.clone(),
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(&mut conn, &run.id, fields, &actor_id).expect("create_summary should succeed");
        close_agent_run(&mut conn, &run.id, AgentRunStatus::Completed, None, None, None)
            .expect("close_agent_run should succeed");

        let after = assemble_context_packet(&conn, &task).expect("assembly should succeed");

        // Exactly one summary entered at the new end and exactly one (the oldest) left, because the
        // window slides by age. Nothing else moved: every decision of the summaries that remain in
        // scope is still there, acknowledged or not.
        assert_eq!(after.summaries.len(), SUMMARY_WINDOW);
        let after_ids: Vec<String> = after.decisions.iter().map(|d| d.id.clone()).collect();
        let still_in_window: Vec<String> = before_ids
            .iter()
            .filter(|id| !decision_ids_for(176).contains(id))
            .cloned()
            .collect();
        for id in &still_in_window {
            assert!(after_ids.contains(id), "acknowledged decision {id} must not drop out of the packet");
        }
        assert_eq!(
            after_ids.len(),
            still_in_window.len(),
            "no decision other than the slid-out summary's three may leave the packet"
        );
    });
}
