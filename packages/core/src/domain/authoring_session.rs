//! `start_authoring_run` / `current_stage` / `advance_stage` (D-84, D-88, D-90, plan 05-02): an
//! epic-authoring session's own lifecycle, sitting beside `domain::agent_run`'s task-execution
//! lifecycle rather than inside it — this module owns the stage vocabulary and the run's start,
//! `domain::agent_run` still owns everything about a run once it exists (the watchdog, the
//! heartbeat, cost tracking and reconciliation all apply unchanged, per D-84).
//!
//! D-88: the three-stage machine — `challenge -> decompose -> criteria` — is what makes "ask
//! before you plan" structural rather than a prompt instruction. During `challenge` there is
//! literally no proposal tool in the adapter's tool set (plan 05-03 wires that gate); this module
//! only carries the stage itself and the transition, so a plan asserting "no proposal row exists
//! before the stage advanced" has something to check the run's own row against.
//!
//! D-90: [`advance_stage`] takes a **human** actor id and has no agent-reachable caller anywhere
//! in this workspace — the agent may recommend advancing, but the human is the only one who calls
//! this function. A future tool handler must never call it directly; that would reopen the exact
//! failure D-88 exists to prevent.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::agent_run::{AgentRun, AgentRunStatus};
use crate::domain::event::{append_event, next_sequence};
use crate::domain::trigger::create_user_action_trigger_for_epic;
use crate::ids::new_id;
use crate::session_log::session_log_path;

/// D-88's three named stages — the single list every reader of `agent_runs.authoring_stage`
/// derives from. This constant and migration `0010_authoring_runs.sql`'s CHECK constraint are the
/// only two places these three names appear (mirroring `domain::WORKFLOW_STATES`'s own
/// single-list discipline).
pub const AUTHORING_STAGES: [&str; 3] = ["challenge", "decompose", "criteria"];

/// One value of D-88's stage machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthoringStage {
    Challenge,
    Decompose,
    Criteria,
}

impl AuthoringStage {
    pub fn as_str(self) -> &'static str {
        match self {
            AuthoringStage::Challenge => AUTHORING_STAGES[0],
            AuthoringStage::Decompose => AUTHORING_STAGES[1],
            AuthoringStage::Criteria => AUTHORING_STAGES[2],
        }
    }

    pub fn from_db_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "challenge" => Ok(AuthoringStage::Challenge),
            "decompose" => Ok(AuthoringStage::Decompose),
            "criteria" => Ok(AuthoringStage::Criteria),
            other => Err(anyhow::anyhow!("unknown authoring stage {other:?}")),
        }
    }

    /// D-90: the next stage in the fixed `challenge -> decompose -> criteria` order, or `None` at
    /// the last stage — there is nowhere further forward to go.
    fn next(self) -> Option<Self> {
        match self {
            AuthoringStage::Challenge => Some(AuthoringStage::Decompose),
            AuthoringStage::Decompose => Some(AuthoringStage::Criteria),
            AuthoringStage::Criteria => None,
        }
    }
}

/// Start a new epic-authoring session (D-84, D-86). Unlike [`crate::domain::agent_run::start_agent_run`],
/// this creates no worktree and touches no task status — D-86 runs the session in the project's
/// already-registered main checkout, which is not a worktree.
///
/// `epic_id` is `None` for a wholly fresh epic (SHAPE-01's own case) or `Some` for reopening an
/// existing one (SHAPE-05). In ONE transaction: creates a `user_action` trigger with
/// `target_task_id` NULL and `target_epic_id = epic_id` ([`create_user_action_trigger_for_epic`]),
/// inserts the `agent_runs` row with `task_id` NULL, `worktree_id` NULL,
/// `authoring_stage = 'challenge'` and `status = 'running'`, and appends one `agent_run.started`
/// event whose payload names the subject in human-renderable prose (D-19).
pub fn start_authoring_run(
    conn: &mut Connection,
    project_id: &str,
    epic_id: Option<&str>,
    permission_mode: &str,
    human_actor_id: &str,
) -> anyhow::Result<AgentRun> {
    let agent_id = crate::domain::agent_run::agent_actor_id(conn)?;
    let now = Utc::now().to_rfc3339();
    let run_id = new_id();
    let log_path = session_log_path(&run_id)?.to_string_lossy().into_owned();

    let tx = conn.transaction()?;

    let trigger_id =
        create_user_action_trigger_for_epic(&tx, project_id, epic_id, human_actor_id, &now)?;

    tx.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, NULL, ?2, ?3, ?4, 'claude_code', ?5, 'running', NULL, ?6, NULL, NULL, NULL, ?7, ?8, NULL, 'challenge')",
        params![run_id, epic_id, project_id, trigger_id, agent_id, permission_mode, log_path, now],
    )
    .context("failed to insert agent_runs row for an authoring run")?;

    let subject_label = match epic_id {
        Some(epic_id) => format!("Started an epic-authoring session for {epic_id}"),
        None => "Started an epic-authoring session for a new epic".to_string(),
    };
    let sequence = next_sequence(&tx, project_id, "local")?;
    let started_payload = serde_json::json!({
        "field": "agent_run",
        "before": null,
        "after": run_id,
        "label": subject_label,
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "agent_run",
        &run_id,
        None,
        epic_id,
        &agent_id,
        "agent_run.started",
        &started_payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit start_authoring_run transaction")?;

    Ok(AgentRun {
        id: run_id,
        worktree_id: None,
        task_id: None,
        epic_id: epic_id.map(|s| s.to_string()),
        project_id: project_id.to_string(),
        trigger_id,
        adapter: "claude_code".to_string(),
        actor_id: agent_id,
        status: AgentRunStatus::Running,
        external_session_id: None,
        permission_mode: permission_mode.to_string(),
        log_path,
        authoring_stage: Some(AuthoringStage::Challenge.as_str().to_string()),
    })
}

/// Read back `agent_run_id`'s current stage — `None` for a run that never carried one (an ordinary
/// task-execution run, or an authoring run predating this column).
pub fn current_stage(conn: &Connection, agent_run_id: &str) -> anyhow::Result<Option<AuthoringStage>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT authoring_stage FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read authoring_stage")?
        .flatten();
    raw.map(|value| AuthoringStage::from_db_str(&value)).transpose()
}

/// Advance `agent_run_id` to the next stage (D-88, D-90) — `challenge -> decompose -> criteria`,
/// erroring at the last stage rather than wrapping or no-opping. **Takes a human actor id and has
/// no agent-reachable caller anywhere in this workspace**: D-90 gives Cyril the sole advance gate,
/// and the agent may only recommend advancing, never perform it itself. In ONE transaction: reads
/// the current stage, writes the next one, and appends one `authoring_run.stage_changed` event.
pub fn advance_stage(
    conn: &mut Connection,
    agent_run_id: &str,
    human_actor_id: &str,
) -> anyhow::Result<AuthoringStage> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, task_id, epic_id, current_raw): (String, Option<String>, Option<String>, Option<String>) = tx
        .query_row(
            "SELECT project_id, task_id, epic_id, authoring_stage FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;

    anyhow::ensure!(
        task_id.is_none(),
        "agent_run {agent_run_id:?} is a task-execution run, not an authoring session"
    );

    let current = current_raw
        .as_deref()
        .map(AuthoringStage::from_db_str)
        .transpose()?
        .ok_or_else(|| anyhow::anyhow!("agent_run {agent_run_id:?} carries no authoring_stage"))?;

    let next = current
        .next()
        .ok_or_else(|| anyhow::anyhow!("agent_run {agent_run_id:?} is already at the last authoring stage"))?;

    tx.execute(
        "UPDATE agent_runs SET authoring_stage = ?1 WHERE id = ?2",
        params![next.as_str(), agent_run_id],
    )
    .context("failed to advance authoring_stage")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "authoring_stage",
        "before": current.as_str(),
        "after": next.as_str(),
        "label": format!("Advanced authoring stage to {}", next.as_str()),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "agent_run",
        agent_run_id,
        None,
        epic_id.as_deref(),
        human_actor_id,
        "authoring_run.stage_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit advance_stage transaction")?;

    Ok(next)
}
