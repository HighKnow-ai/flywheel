//! Phase 15 plan 07 (D-03): starting work confirms the provisional values on that task, in the same
//! act that freezes its criteria. Its own test binary because it sets the process-wide
//! `FLYWHEEL_WORKTREE_ROOT` seam (as `agent_tracer.rs` does), which must not race a sibling test.

mod common;

use core::domain::agent_run::{agent_actor_id, start_agent_run};
use core::domain::authoring_proposal::{
    create_proposal, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::params;

#[test]
fn start_work_confirms_the_pending_title() {
    let (mut conn, human, project, _repo_dir) = common::seeded_git_project();
    let worktree_root = tempfile::tempdir().unwrap();
    // SAFETY: the only test in this binary; the var is cleared at the end.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root.path()) };

    let task = create_task(&mut conn, &project.id, &human, "Old title", None).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    // A run to stage against: a bare agent_runs row, as the sibling tests build.
    let trigger: String = conn
        .query_row(
            "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, config, enabled,
                 last_fired_at, created_by, created_at)
             VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, '2026-01-01T00:00:00Z') RETURNING id",
            params![new_id(), project.id, task.id, human],
            |r| r.get(0),
        )
        .unwrap();
    let staging_run = new_id();
    conn.execute(
        "INSERT INTO agent_runs (id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id,
             status, external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
             started_at, ended_at, authoring_stage)
         VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'completed', NULL, 'default', NULL, NULL, NULL,
             ?6, '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z', NULL)",
        params![staging_run, task.id, project.id, trigger, agent, format!("/tmp/log-{staging_run}.jsonl")],
    )
    .unwrap();
    let proposal = create_proposal(
        &mut conn,
        &staging_run,
        ProposalVerb::Amend,
        ProposalPayload::Task { title: "Sharper title".into(), description: None, priority: None },
        Some(&task.id),
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();

    start_agent_run(&mut conn, &task.id, "acceptEdits", &human).expect("start_agent_run should succeed");

    let title: String = conn.query_row("SELECT title FROM tasks WHERE id = ?1", params![task.id], |r| r.get(0)).unwrap();
    assert_eq!(title, "Sharper title", "Start Work confirmed the suggestion");
    let status: String =
        conn.query_row("SELECT status FROM authoring_proposals WHERE id = ?1", params![proposal.id], |r| r.get(0)).unwrap();
    assert_eq!(status, "accepted");

    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
}
