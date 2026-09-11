//! `start_agent_run` / `close_agent_run` / `apply_session_closed` (D-29, D-30, D-34, DATA-04): the
//! transactional-outbox write that turns "Start Work" into a trigger row, an `agent_runs` row, and
//! — when the task isn't already `in_progress` — a task status change attributed to the agent
//! actor, all inside one transaction.
//!
//! Nothing in this module ever moves a task OUT of `in_progress` — that is `close_agent_run`'s
//! (and, per G-02-4, `apply_session_closed`'s) explicit non-behavior, matching this phase's
//! load-bearing prohibition: an agent must never move a task out of `in_progress` and must never
//! check off its own acceptance criteria. D-29 locks it: "Starting a session moves the task to In
//! Progress; nothing ever moves it out." This is stated a second time here — deliberately —
//! because an earlier revision of `02-UAT.md`'s own impact note read this the other way round,
//! naming that transition as `close_agent_run`'s responsibility. That reading is backwards; this
//! doc comment and D-29 are the authoritative statement, not that note.
//!
//! `apply_session_closed` (G-02-4) is the terminal-event applier — the missing link between the
//! sidecar's `session_closed` event and the run's row. `close_agent_run` was always correct and
//! thoroughly unit-tested; what was missing was a caller. `apply_session_closed` is that caller,
//! and it also owns the idempotency decision D-35's explicit-Stop path requires: a terminal event
//! must never overwrite a status `interrupt_agent_run` already wrote, and must never append a
//! second terminal event for the same run.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::event::{append_event, next_sequence};
use crate::domain::trigger::create_user_action_trigger;
use crate::domain::worktree::ensure_worktree;
use crate::ids::{is_ulid, new_id};
use crate::session_log::session_log_path;

/// One `agent_runs` row, as read back immediately after [`start_agent_run`] commits.
#[derive(Debug, Clone, PartialEq)]
pub struct AgentRun {
    pub id: String,
    pub worktree_id: Option<String>,
    pub task_id: String,
    pub project_id: String,
    pub trigger_id: String,
    pub adapter: String,
    pub actor_id: String,
    pub status: AgentRunStatus,
    pub external_session_id: Option<String>,
    pub permission_mode: String,
    pub log_path: String,
}

/// The five values `agent_runs.status`'s CHECK constraint accepts (migration
/// `0003_agent_runtime.sql`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRunStatus {
    Running,
    Blocked,
    Completed,
    Failed,
    Interrupted,
}

impl AgentRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentRunStatus::Running => "running",
            AgentRunStatus::Blocked => "blocked",
            AgentRunStatus::Completed => "completed",
            AgentRunStatus::Failed => "failed",
            AgentRunStatus::Interrupted => "interrupted",
        }
    }
}

/// Resolve the id of the seeded agent actor (migration `0003_agent_runtime.sql`'s `type = 'agent'`
/// row, display name "Claude Code") — every agent-started run is attributed to this actor, never
/// to the human who clicked Start Work (D-29).
pub fn agent_actor_id(conn: &Connection) -> anyhow::Result<String> {
    let id: String = conn
        .query_row(
            "SELECT id FROM actors WHERE type = 'agent' ORDER BY created_at ASC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .context("failed to resolve the seeded agent actor")?;
    Ok(id)
}

/// Start a new agent run against `task_id` (D-30: always a fresh run, never `--resume`).
///
/// Ensures the task's worktree exists first (create-or-reuse, `domain::worktree::ensure_worktree`
/// — its own inner transaction, committed before this function opens its own). Then, in ONE
/// transaction: creates a `user_action` trigger, inserts the `agent_runs` row with
/// `status = 'running'`, sets the task's status to `in_progress` if it is not already —
/// attributed to the AGENT actor (D-29) — and appends `agent_run.started` plus, when the status
/// actually changed, a `task.status_changed` event. `human_actor_id` is recorded as the actor who
/// *initiated* the trigger (D-29 still applies to the task status change itself, which is always
/// attributed to the agent actor, not the human).
pub fn start_agent_run(
    conn: &mut Connection,
    task_id: &str,
    permission_mode: &str,
    human_actor_id: &str,
) -> anyhow::Result<AgentRun> {
    let worktree = ensure_worktree(conn, task_id, human_actor_id)
        .with_context(|| format!("failed to ensure a worktree for task {task_id:?}"))?;

    let agent_id = agent_actor_id(conn)?;
    let now = Utc::now().to_rfc3339();
    let run_id = new_id();
    let log_path = session_log_path(&run_id)?.to_string_lossy().into_owned();

    let tx = conn.transaction()?;

    let (project_id, current_status): (String, String) = tx
        .query_row(
            "SELECT project_id, status FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let trigger_id = create_user_action_trigger(&tx, &project_id, task_id, human_actor_id, &now)?;

    tx.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'claude_code', ?6, 'running', NULL, ?7, NULL, NULL, NULL, ?8, ?9, NULL)",
        params![
            run_id,
            worktree.id,
            task_id,
            project_id,
            trigger_id,
            agent_id,
            permission_mode,
            log_path,
            now,
        ],
    )
    .context("failed to insert agent_runs row")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let started_payload = serde_json::json!({
        "field": "agent_run",
        "before": null,
        "after": run_id,
        "label": "Started agent run",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "agent_run",
        &run_id,
        Some(task_id),
        None,
        &agent_id,
        "agent_run.started",
        &started_payload,
        &now,
    )?;

    if current_status != "in_progress" {
        tx.execute(
            "UPDATE tasks SET status = 'in_progress', updated_at = ?1 WHERE id = ?2",
            params![now, task_id],
        )
        .context("failed to move task to in_progress")?;

        let status_sequence = next_sequence(&tx, &project_id, "local")?;
        let status_payload = serde_json::json!({
            "field": "status",
            "before": current_status,
            "after": "in_progress",
            "label": "Changed status from ".to_string() + &current_status + " to in_progress",
        });
        append_event(
            &tx,
            &project_id,
            "local",
            status_sequence,
            "task",
            task_id,
            Some(task_id),
            None,
            &agent_id,
            "task.status_changed",
            &status_payload,
            &now,
        )?;
    }

    tx.commit().context("failed to commit start_agent_run transaction")?;

    Ok(AgentRun {
        id: run_id,
        worktree_id: Some(worktree.id),
        task_id: task_id.to_string(),
        project_id,
        trigger_id,
        adapter: "claude_code".to_string(),
        actor_id: agent_id,
        status: AgentRunStatus::Running,
        external_session_id: None,
        permission_mode: permission_mode.to_string(),
        log_path,
    })
}

/// Write a run's terminal status and `ended_at`, and append the matching event. Never touches
/// `tasks.status` — moving a task out of `in_progress` is a human/board decision, never something
/// this module (or an agent) does for itself.
pub fn close_agent_run(
    conn: &mut Connection,
    run_id: &str,
    status: AgentRunStatus,
    cost_usd: Option<f64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String, Option<String>)> = tx
        .query_row(
            "SELECT project_id, task_id, worktree_id FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read agent_runs row before close")?;

    let Some((project_id, task_id, _worktree_id)) = existing else {
        tx.commit().context("failed to commit no-op close_agent_run transaction")?;
        return Ok(());
    };

    let agent_id = agent_actor_id(&tx)?;

    tx.execute(
        "UPDATE agent_runs SET status = ?1, cost_usd = ?2, tokens_in = ?3, tokens_out = ?4, ended_at = ?5 WHERE id = ?6",
        params![status.as_str(), cost_usd, tokens_in, tokens_out, now, run_id],
    )
    .context("failed to close agent run")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "agent_run",
        "before": "running",
        "after": status.as_str(),
        "label": format!("Agent run {}", status.as_str()),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "agent_run",
        run_id,
        Some(&task_id),
        None,
        &agent_id,
        "agent_run.closed",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit close_agent_run transaction")?;
    Ok(())
}

/// What handling one `session_closed` event did to the run's row (G-02-4). Kept as an enum return
/// value — mirroring `commands::agent_run::PermissionRequestOutcome`'s own reasoning — so this
/// decision is unit-testable against a bare `Connection` without a real spawned sidecar.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SessionClosedOutcome {
    /// The run reached this terminal status for the first time — `close_agent_run` was called and
    /// exactly one terminal event was appended.
    Closed(AgentRunStatus),
    /// The run was already in a terminal status and the event carried no figure the row was
    /// missing — nothing was written at all.
    AlreadyTerminal,
    /// The run was already in a terminal status, but the event carried at least one figure (cost
    /// or a token count) an empty column was missing — that figure alone was backfilled. The
    /// status and end time were left exactly as they were, and no second terminal event was
    /// appended.
    BackfilledTerminal,
    /// The event's run id is a well-formed identifier but matches no `agent_runs` row.
    UnknownRun,
    /// The event was not a terminal `session_closed` event, or its run id was absent/malformed, or
    /// its `reason` did not map to a known status — nothing was read and nothing was written.
    Ignored,
}

/// Apply one sidecar `session_closed` event to the run's row (G-02-4) — the production caller
/// `close_agent_run` never had. This is the missing link: the sidecar has always emitted this
/// event and the reader loop has always persisted and forwarded it, but nothing ever mapped it
/// onto `agent_runs` until this function existed.
///
/// `close_agent_run`'s own body and signature are UNCHANGED by this function's existence — it is
/// correct, documented and thoroughly unit-tested, and what was missing was a caller, not a change
/// to its contract. The idempotency guard against overwriting an explicit Stop lives here, in the
/// new caller, rather than inside `close_agent_run` itself, so a proven contract is not modified
/// for a concern that belongs to its caller.
///
/// Never moves `tasks.status` — same as `close_agent_run`, per D-29 and this module's own doc
/// comment above.
pub fn apply_session_closed(conn: &mut Connection, event: &serde_json::Value) -> anyhow::Result<SessionClosedOutcome> {
    if event.get("type").and_then(|v| v.as_str()) != Some("session_closed") {
        return Ok(SessionClosedOutcome::Ignored);
    }

    let Some(run_id) = event.get("runId").and_then(|v| v.as_str()) else {
        return Ok(SessionClosedOutcome::Ignored);
    };
    // Reject a malformed run id BEFORE any database statement is issued (T-02G-18-01) — a run id
    // read off a sidecar stdout line is exactly as trusted as any other value crossing that
    // process boundary, never more.
    if !is_ulid(run_id) {
        return Ok(SessionClosedOutcome::Ignored);
    }

    // Map the event's own reason vocabulary to a status. Any value this adapter did not name is
    // ignored outright — never guess a default (G-02-4's own explicit instruction).
    let status = match event.get("reason").and_then(|v| v.as_str()) {
        Some("completed") => AgentRunStatus::Completed,
        Some("failed") => AgentRunStatus::Failed,
        Some("interrupted") => AgentRunStatus::Interrupted,
        _ => return Ok(SessionClosedOutcome::Ignored),
    };

    // A missing figure stays absent and is never coerced to zero (T-02G-18-04) — the sidecar's own
    // `ResultEvent`/`SessionClosedEvent.result` contract (packages/sidecar/src/adapter.ts).
    let result = event.get("result");
    let cost_usd = result.and_then(|r| r.get("totalCostUsd")).and_then(serde_json::Value::as_f64);
    let tokens_in = result.and_then(|r| r.get("inputTokens")).and_then(serde_json::Value::as_i64);
    let tokens_out = result.and_then(|r| r.get("outputTokens")).and_then(serde_json::Value::as_i64);

    let existing: Option<(String, Option<f64>, Option<i64>, Option<i64>)> = conn
        .query_row(
            "SELECT status, cost_usd, tokens_in, tokens_out FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .context("failed to read agent_runs row before applying session_closed")?;

    let Some((current_status, current_cost, current_tokens_in, current_tokens_out)) = existing else {
        return Ok(SessionClosedOutcome::UnknownRun);
    };

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted") {
        // `interrupt_agent_run` has already recorded the user's explicit Stop (D-35) — the
        // terminal event for that same run arrives afterwards. Overwriting the status or end time
        // here would both destroy the user-initiated outcome and append a second terminal event
        // (T-02G-18-02, T-02G-18-03) — but the cost the run actually incurred is still worth
        // recording, so an empty column is backfilled, and only an empty column, when the event
        // carries a figure for it.
        let backfill_cost = current_cost.is_none() && cost_usd.is_some();
        let backfill_tokens_in = current_tokens_in.is_none() && tokens_in.is_some();
        let backfill_tokens_out = current_tokens_out.is_none() && tokens_out.is_some();

        if !backfill_cost && !backfill_tokens_in && !backfill_tokens_out {
            return Ok(SessionClosedOutcome::AlreadyTerminal);
        }

        conn.execute(
            "UPDATE agent_runs SET
                cost_usd = COALESCE(cost_usd, ?1),
                tokens_in = COALESCE(tokens_in, ?2),
                tokens_out = COALESCE(tokens_out, ?3)
             WHERE id = ?4",
            params![cost_usd, tokens_in, tokens_out, run_id],
        )
        .context("failed to backfill terminal agent_runs figures")?;
        return Ok(SessionClosedOutcome::BackfilledTerminal);
    }

    close_agent_run(conn, run_id, status, cost_usd, tokens_in, tokens_out)?;
    Ok(SessionClosedOutcome::Closed(status))
}

/// Move a run to `blocked` (AGNT-06, D-37) inside the CALLER'S transaction — never opens its own.
/// Called only from `domain::permission_request::create_pending_request`'s own transaction, so a
/// blocked run and its pending request row are written together or not at all; there is no
/// window where one exists without the other.
pub fn set_run_blocked(tx: &Transaction, agent_run_id: &str) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE agent_runs SET status = 'blocked' WHERE id = ?1",
        params![agent_run_id],
    )
    .context("failed to move the run to blocked")?;
    Ok(())
}

/// Move a run back to `running` inside the CALLER'S transaction — the exact inverse of
/// [`set_run_blocked`], called only from `domain::permission_request::answer_request`'s own
/// transaction.
pub fn clear_run_blocked(tx: &Transaction, agent_run_id: &str) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE agent_runs SET status = 'running' WHERE id = ?1",
        params![agent_run_id],
    )
    .context("failed to clear the run's blocked status")?;
    Ok(())
}

/// Move a `running`/`blocked` run to `interrupted` and set `ended_at` (D-35, PROC-06 — the
/// database half of "stop means interrupt, then force"). A run already in a terminal state
/// (`completed`/`failed`/`interrupted`) is a no-op — idempotent, matching the sidecar adapter's
/// own idempotent `interruptSession`/`killSession` (`packages/sidecar/src/claude-code-adapter.ts`)
/// — and never writes a second terminal event. An unknown `agent_run_id` is also a harmless no-op:
/// the caller (`agent_run_stop`) already sent the sidecar its interrupt request by the time this
/// runs, and a run whose row somehow doesn't exist has nothing left to reconcile.
///
/// Never touches `tasks.status`: D-29 states nothing ever moves a task out of `in_progress` in
/// this phase, and D-35 states an interrupted run is a normal user-initiated outcome, not an
/// error. Performs NO git operation of any kind, directly or via `crate::git` — the worktree is
/// left exactly as the agent left it (PROC-06's "nothing committed on the user's behalf").
pub fn interrupt_agent_run(conn: &mut Connection, agent_run_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String, String)> = tx
        .query_row(
            "SELECT project_id, task_id, status FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read agent_runs row before interrupt")?;

    let Some((project_id, task_id, current_status)) = existing else {
        tx.commit().context("failed to commit no-op interrupt_agent_run transaction (run not found)")?;
        return Ok(());
    };

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted") {
        // Already terminal — idempotent no-op, no second terminal event (D-35).
        tx.commit()
            .context("failed to commit no-op interrupt_agent_run transaction (already terminal)")?;
        return Ok(());
    }

    tx.execute(
        "UPDATE agent_runs SET status = 'interrupted', ended_at = ?1 WHERE id = ?2",
        params![now, agent_run_id],
    )
    .context("failed to interrupt agent run")?;

    let task_key: String = tx
        .query_row("SELECT key FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))
        .context("failed to read task key for the interrupt event's label")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "agent_run",
        "before": current_status,
        "after": "interrupted",
        "label": format!("Stopped agent run on {task_key}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "agent_run",
        agent_run_id,
        Some(&task_id),
        None,
        actor_id,
        "agent_run.interrupted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit interrupt_agent_run transaction")?;
    Ok(())
}
