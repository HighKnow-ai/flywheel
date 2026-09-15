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
use crate::runtime_protocol::{self, KillRecordRead};
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

/// The six values `agent_runs.status`'s CHECK constraint accepts (migration
/// `0003_agent_runtime.sql`, `Abandoned` added by migration `0006_recovery_statuses.sql`, D-49).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentRunStatus {
    Running,
    Blocked,
    Completed,
    Failed,
    Interrupted,
    /// The run was `running` when the app died — written by the launch reconciler
    /// ([`crate::domain::worktree::reconcile_worktrees`]'s sibling, `mark_abandoned` below) and
    /// never by the dying process itself (D-49).
    Abandoned,
}

impl AgentRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentRunStatus::Running => "running",
            AgentRunStatus::Blocked => "blocked",
            AgentRunStatus::Completed => "completed",
            AgentRunStatus::Failed => "failed",
            AgentRunStatus::Interrupted => "interrupted",
            AgentRunStatus::Abandoned => "abandoned",
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

/// D-53/plan 03-13: append exactly ONE `git.lock_exhausted` event when a shimmed `git`
/// invocation's retry budget is fully exhausted — never one event per individual collision,
/// which is precisely the noise D-53 rejects (`git_retry::with_lock_retry`'s own "silent unless
/// exhausted" contract). `actor_id` is resolved by the CALLER — the sidecar reader loop resolves
/// the seeded SYSTEM actor (`crate::domain::actor::system_actor`), per `03-UI-SPEC.md`'s "Git
/// lock-exhaustion entry": "attributed to the system actor... the `assignee-system` mark" — a git
/// lock collision is Flywheel's own retry machinery giving up, not something the agent decided to
/// do, and the trail's actor mark is exactly what visually distinguishes this failure class from
/// an ordinary agent error (the objective's own framing: "an exhausted budget is a real failure
/// that must not be indistinguishable from an ordinary agent error").
///
/// Writes NO row on `agent_runs` and changes no status — unlike every neighbouring function in
/// this file, which all write a status alongside their event: an exhausted git lock is a fact
/// about ONE command, not a verdict on the run's outcome. Calling this twice for two separate
/// exhaustions appends two events; there is no de-duplication and no suppression.
///
/// A `run_id` matching no `agent_runs` row is a silent no-op (mirrors `close_agent_run`'s own
/// "unknown run" handling) — the shared sidecar reader loop must never treat this as a hard
/// failure that could abandon the loop for every other run (CR-03).
pub fn record_lock_exhaustion(
    conn: &mut Connection,
    run_id: &str,
    repository: &str,
    command: &str,
    attempts: u32,
    actor_id: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT project_id, task_id FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to read agent_runs row before recording a lock exhaustion")?;

    let Some((project_id, task_id)) = existing else {
        tx.commit()
            .context("failed to commit no-op record_lock_exhaustion transaction")?;
        return Ok(());
    };

    let sequence = next_sequence(&tx, &project_id, "local")?;
    // The payload builder already holds the human-renderable `label` (D-19) — called here rather
    // than constructing a second copy of the sentence, which is what keeps the event and the
    // rendered Activity Trail entry (`render_description` reads `payload.label` verbatim) from
    // ever drifting apart.
    let payload = crate::git_retry::exhaustion_event_payload(repository, command, attempts);
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "agent_run",
        run_id,
        Some(&task_id),
        None,
        actor_id,
        "git.lock_exhausted",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit record_lock_exhaustion transaction")?;
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

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
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

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
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

/// Mark a run `abandoned` (D-49) — the launch reconciler's own verb, never called by a live
/// session. A run that was `running` when the app died is written here, not by the dying process
/// itself: nothing observes a SIGKILL of the whole app tree from the inside.
///
/// Already-terminal is a no-op returning `Ok(false)` — extends the SAME terminal set
/// [`apply_session_closed`] and [`interrupt_agent_run`] already guard against overwriting
/// (`completed`/`failed`/`interrupted`/`abandoned`), so a second reconciliation pass over an
/// already-`abandoned` run writes nothing and appends no second event (idempotent, matching
/// `<behavior>`'s "a run that already reached a real terminal status is never overwritten by a
/// reconciler"). An unknown `run_id` is also a harmless `Ok(false)` — there is nothing left to
/// reconcile.
///
/// On a real transition: `UPDATE agent_runs SET status = 'abandoned', ended_at = ?` and appends
/// `agent_run.abandoned`, carrying `reason` in the payload when the caller supplied one (the
/// watchdog's own kill-record reason, plan 03-06). Returns `Ok(true)` only when it actually wrote.
pub fn mark_abandoned(
    conn: &mut Connection,
    run_id: &str,
    actor_id: &str,
    reason: Option<&str>,
) -> anyhow::Result<bool> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String, String)> = tx
        .query_row(
            "SELECT status, project_id, task_id FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read agent_runs row before marking abandoned")?;

    let Some((current_status, project_id, task_id)) = existing else {
        tx.commit().context("failed to commit no-op mark_abandoned transaction (run not found)")?;
        return Ok(false);
    };

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
        // Already terminal — idempotent no-op, no second terminal event.
        tx.commit()
            .context("failed to commit no-op mark_abandoned transaction (already terminal)")?;
        return Ok(false);
    }

    tx.execute(
        "UPDATE agent_runs SET status = 'abandoned', ended_at = ?1 WHERE id = ?2",
        params![now, run_id],
    )
    .context("failed to mark agent run abandoned")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "agent_run",
        "before": current_status,
        "after": "abandoned",
        "reason": reason,
        "label": "Agent run abandoned",
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
        actor_id,
        "agent_run.abandoned",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit mark_abandoned transaction")?;
    Ok(true)
}

/// Every `agent_runs` row still `running` or `blocked` when [`reconcile_agent_runs`] runs,
/// joined to its task for the modal's key/title (plan 03-06) — one query rather than one round
/// trip per row. Compile-time literal, no string interpolation (repository convention,
/// `01-SECURITY.md`).
const IN_FLIGHT_AGENT_RUNS_SELECT_SQL: &str = "
    SELECT ar.id, ar.task_id, ar.project_id, ar.external_session_id, t.key, t.title
    FROM agent_runs ar
    JOIN tasks t ON t.id = ar.task_id
    WHERE ar.status IN ('running', 'blocked')
";

/// One `agent_runs` row [`reconcile_agent_runs`] found genuinely alive at launch (PROC-05, D-46).
/// Written to no status at all — a status write for a process that is still running would be the
/// board lying about a live fact — so this is the ONLY record of it; the user's decision (kill,
/// via [`kill_orphan`], the only verb offered per D-30 and `03-UI-SPEC.md`'s discretion item 1)
/// is what resolves it.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveOrphan {
    pub run_id: String,
    pub task_id: String,
    pub task_key: String,
    pub task_title: String,
    pub project_id: String,
    pub external_session_id: Option<String>,
    pub pid: i32,
    pub started_at: String,
}

/// The launch-time three-way classification (PROC-05, D-46, D-49, D-50): every `agent_runs` row
/// still `running` or `blocked` when this runs is sorted into exactly one of killed-by-its-
/// watchdog, dead-without-a-kill-record, or genuinely-still-alive — never resumed, never
/// repaired, matching `domain::worktree::reconcile_worktrees`'s and `domain::project::
/// reconcile_projects`'s own surface-never-repair shape.
///
/// For each in-flight row, in this order:
/// 1. A kill record exists ([`runtime_protocol::read_kill_record`] returns `Found`): the
///    watchdog already explained why it terminated this run's process group. Written to
///    `abandoned` carrying the record's own `reason`, its runtime files cleared
///    ([`runtime_protocol::clear_run_runtime_files`]), and NOT a live orphan.
/// 2. No kill record (`Absent`) OR an unparseable one (`Malformed`) — a malformed record is
///    deliberately treated exactly like an absent one rather than as a kill (D-50's own honesty
///    contract: the copy this produces falls back to the weaker "dead, no reason known" claim
///    instead of inventing one it cannot prove). Reads the run's own descriptor next. Missing,
///    or its pid/start-time pair no longer alive per [`runtime_protocol::process_is_alive`]:
///    written to `abandoned` with `None` (no reason), runtime files cleared, NOT a live orphan.
/// 3. Otherwise the descriptor's own process is genuinely alive: nothing is written at all. The
///    row stays exactly `running`/`blocked` in the database, and a [`LiveOrphan`] is pushed onto
///    the returned vector instead.
///
/// Relies entirely on [`mark_abandoned`]'s own already-terminal guard for idempotency — this
/// function never re-implements it. Combined with the SQL filter above (a row already
/// `completed`/`failed`/`interrupted`/`abandoned` is never even selected), calling this twice
/// over unchanged state writes nothing and appends no second event. One transaction per changed
/// row, exactly as `reconcile_projects`/`reconcile_worktrees` both achieve, because
/// [`mark_abandoned`] opens and commits its own transaction per call.
///
/// No function in this module (nor any it calls) starts, resumes, re-attaches to, or re-spawns
/// any process — asserted structurally by this plan's own source-scanning `<verify>` gate over
/// this function's body: nothing is silently resumed.
pub fn reconcile_agent_runs(conn: &mut Connection, actor_id: &str) -> anyhow::Result<Vec<LiveOrphan>> {
    let in_flight: Vec<(String, String, String, Option<String>, String, String)> = {
        let mut stmt = conn
            .prepare(IN_FLIGHT_AGENT_RUNS_SELECT_SQL)
            .context("failed to prepare the in-flight agent_runs reconciliation query")?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .context("failed to query in-flight agent_runs for reconciliation")?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("failed to read an in-flight agent_runs row during reconciliation")?
    };

    // One listing of every descriptor on disk, up front — cheaper than one directory read per
    // row, and `list_run_descriptors` already tolerates a malformed entry by skipping it.
    let descriptors: std::collections::HashMap<String, runtime_protocol::RunDescriptor> =
        runtime_protocol::list_run_descriptors()
            .into_iter()
            .map(|descriptor| (descriptor.run_id.clone(), descriptor))
            .collect();

    let mut live_orphans = Vec::new();

    for (run_id, task_id, project_id, external_session_id, task_key, task_title) in in_flight {
        match runtime_protocol::read_kill_record(&run_id) {
            KillRecordRead::Found(record) => {
                mark_abandoned(conn, &run_id, actor_id, Some(&record.reason))?;
                runtime_protocol::clear_run_runtime_files(&run_id);
                continue;
            }
            KillRecordRead::Absent | KillRecordRead::Malformed(_) => {
                // Fall through to the descriptor-based liveness check below — a malformed
                // record is read as "no evidence of a kill," never as "killed".
            }
        }

        match descriptors.get(&run_id) {
            Some(descriptor)
                if runtime_protocol::process_is_alive(descriptor.pid, descriptor.start_time) =>
            {
                live_orphans.push(LiveOrphan {
                    run_id,
                    task_id,
                    task_key,
                    task_title,
                    project_id,
                    external_session_id,
                    pid: descriptor.pid,
                    started_at: descriptor.started_at.clone(),
                });
            }
            _ => {
                mark_abandoned(conn, &run_id, actor_id, None)?;
                runtime_protocol::clear_run_runtime_files(&run_id);
            }
        }
    }

    Ok(live_orphans)
}

/// The short, bounded pause [`kill_orphan`] waits between sending its force signal and
/// re-checking liveness — long enough for a SIGKILL to actually be reaped by the OS, short
/// enough that a Tauri command handler never appears to hang.
const ORPHAN_KILL_RECHECK_DELAY: std::time::Duration = std::time::Duration::from_millis(200);

/// What one [`kill_orphan`] call did (plan 03-06, T-03-06-04). `killed: false` means the process
/// was still alive after the signal and the bounded re-check — never a success this function did
/// not actually observe; the caller (plan 03-10's modal) renders that failure honestly rather
/// than dismissing the row.
#[derive(Debug, Clone, PartialEq)]
pub struct OrphanKillOutcome {
    pub killed: bool,
    pub pid: i32,
    pub detail: Option<String>,
}

/// Send a fatal, unignorable signal to the process GROUP led by `pid` — never the bare process
/// alone. The process group is the referent here (plan 03-02's promoted identity: the watchdog
/// wrapper leads its own group), mirroring `packages/sidecar/src/watchdog.ts`'s own D-48 force
/// step, `process.kill(-process.pid, "SIGKILL")`, on the Rust side of this protocol.
#[cfg(unix)]
fn send_group_kill_signal(pid: i32) {
    // SAFETY: `kill(2)` is a plain syscall wrapper taking a pid and a signal number; passing a
    // NEGATIVE pid signals the whole process group rather than one process, exactly as
    // documented by POSIX and exercised by `watchdog.ts`'s identical convention. Any error
    // (ESRCH — the group is already gone, or EPERM) is deliberately ignored here: this is a
    // best-effort force signal, and the liveness re-check immediately after this call is what
    // tells the caller whether it actually worked.
    unsafe {
        libc::kill(-pid, libc::SIGKILL);
    }
}

/// No process-group signal primitive is wired for this platform yet. The liveness re-check in
/// [`kill_orphan`] still runs after this no-op, so a non-Unix build reports an honest
/// `killed: false` rather than a success it never performed (T-03-06-04).
#[cfg(not(unix))]
fn send_group_kill_signal(_pid: i32) {}

/// Kill one live orphan by `agent_run_id` (plan 03-06, D-48, T-03-06-04) — the only verb the
/// orphan-recovery modal offers (D-30, `03-UI-SPEC.md` discretion item 1). Reads the run's own
/// descriptor from disk — never a pid supplied by the caller (T-03-06-03) — re-checks liveness
/// (the process may have exited on its own between launch and the user's press), sends a fatal
/// signal to the process GROUP, waits a short bounded interval, then re-checks liveness again.
///
/// Writes the run to `abandoned` with reason `killed-by-user-at-launch` REGARDLESS of whether
/// the signal succeeded, following `commands::agent_run::stop_agent_run_recording_first`'s own
/// CR-04 shape: the domain write must be reachable even when the external operation failed. A
/// run with no descriptor on disk at all has nothing left to signal — treated the same as an
/// already-dead process, never as an error, since the abandoning write is still exactly correct.
pub fn kill_orphan(
    conn: &mut Connection,
    run_id: &str,
    actor_id: &str,
) -> anyhow::Result<OrphanKillOutcome> {
    let descriptor = runtime_protocol::list_run_descriptors()
        .into_iter()
        .find(|descriptor| descriptor.run_id == run_id);

    let (pid, still_alive) = match &descriptor {
        Some(descriptor) => {
            if runtime_protocol::process_is_alive(descriptor.pid, descriptor.start_time) {
                send_group_kill_signal(descriptor.pid);
                std::thread::sleep(ORPHAN_KILL_RECHECK_DELAY);
            }
            let still_alive =
                runtime_protocol::process_is_alive(descriptor.pid, descriptor.start_time);
            (descriptor.pid, still_alive)
        }
        None => (0, false),
    };

    mark_abandoned(conn, run_id, actor_id, Some("killed-by-user-at-launch"))?;
    runtime_protocol::clear_run_runtime_files(run_id);

    if still_alive {
        Ok(OrphanKillOutcome {
            killed: false,
            pid,
            detail: Some(format!("process {pid} is still alive after the kill signal")),
        })
    } else {
        Ok(OrphanKillOutcome { killed: true, pid, detail: None })
    }
}
