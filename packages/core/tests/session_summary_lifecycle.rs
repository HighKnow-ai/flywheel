//! `domain::session_summary::create_summary` / `list_summaries_for_task` /
//! `latest_summary_for_run` (D-65, CTX-01..CTX-04) — the tracer's own end-to-end proof: a summary
//! written through `create_summary` is returned by the very next `assemble_context_packet` call
//! for the same task and appears in `render_prompt`'s output.

mod common;

use core::context_packet::{assemble_context_packet, render_prompt};
use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::start_agent_run;
use core::domain::epic::create_epic;
use core::domain::session_summary::{create_summary, DecisionEntry, SummaryFields};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;

// See `tests/context_packet.rs` for why this lock exists: `FLYWHEEL_WORKTREE_ROOT` is
// process-wide state, and `cargo test` runs every `#[test]` fn in this file concurrently on
// separate OS threads by default. This mutex scopes serialisation to this file's own binary.
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

#[test]
fn a_summary_written_is_carried_by_the_next_context_packet() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the thing", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Wire the summary", Some(&epic.id))
            .expect("create_task should succeed");
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "First criterion",
            None,
        )
        .expect("create_criterion 1 should succeed");
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Second criterion",
            None,
        )
        .expect("create_criterion 2 should succeed");

        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let fields = SummaryFields {
            changed_files: vec!["src/lib.rs".to_string(), "src/main.rs".to_string()],
            changed_prose: Some("Wired the summary read path.".to_string()),
            remains: Some("Wire the fallback synthesizer.".to_string()),
            next_session_must_know: Some("The packet field is called summaries.".to_string()),
            decisions: vec![DecisionEntry {
                id: "d1".to_string(),
                statement: "Use jose instead of jsonwebtoken.".to_string(),
            }],
            acknowledged_decisions: vec![],
            diff_ref: Some("HEAD~1".to_string()),
            auto_generated: false,
        };

        let written = create_summary(&mut conn, &run.id, fields, &actor_id)
            .expect("create_summary should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.summaries.len(), 1, "exactly one summary must be carried");
        let entry = &packet.summaries[0];
        assert_eq!(entry.agent_run_id, run.id);
        assert_eq!(entry.changed_files, written.changed_files);
        assert_eq!(entry.remains, written.remains);
        assert_eq!(entry.next_session_must_know, written.next_session_must_know);
        assert_eq!(entry.decisions, written.decisions);

        let prompt = render_prompt(&packet, "");
        assert!(prompt.contains("Prior Sessions"), "the prior-sessions heading must be present");
        assert!(prompt.contains("src/lib.rs"), "the changed path must appear in the rendered prompt");
        assert!(
            prompt.contains("Use jose instead of jsonwebtoken."),
            "the decision statement must appear in the rendered prompt"
        );
    });
}

#[test]
fn a_task_with_zero_summaries_yields_an_empty_list_and_no_prior_sessions_heading() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No summaries yet", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.summaries.is_empty(), "summaries list must be empty");

        let prompt = render_prompt(&packet, "");
        assert!(
            !prompt.contains("Prior Sessions"),
            "no prior-sessions heading should be emitted for a task with zero summaries"
        );
    });
}
