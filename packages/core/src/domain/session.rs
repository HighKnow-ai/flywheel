//! A Story's agent sessions — the `sessions` table (D-29, D-30, D-34, DATA-04): `start_session`,
//! `close_session`, `apply_session_closed`, the Stop and abandon paths and the launch reconciler.
//! Every session belongs to exactly one Story and runs in that Story's worktree; it is always a
//! fresh session, never `claude --resume`.
//!
//! Nothing in this module writes a Story state, and no session can accept its own criteria:
//! `story::set_story_state` and `acceptance_criterion::accept_criterion` are the only writers of
//! those, and neither is reachable from here.
//!
//! `apply_session_closed` (G-02-4) is the terminal-event applier — the link between the sidecar's
//! `session_closed` event and the session's row. It also owns the idempotency decision D-35's
//! explicit-Stop path requires: a terminal event must never overwrite a status
//! `interrupt_session` already wrote, and must never append a second terminal event for the same
//! session.
//!
//! The Rust names keep the `session` spelling of the plumbing this module was kept from; the
//! table they read and write is `sessions`.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::event::{append_event, next_sequence};
use crate::domain::session_ending::{classify_session_closed, record_ending_in_tx, EndingReason};
use crate::domain::worktree::ensure_worktree;
use crate::ids::{is_ulid, new_id};
use crate::runtime_protocol::{self, KillRecordRead};
use crate::session_log::session_log_path;

/// One `sessions` row, as read back immediately after [`start_session`] commits.
#[derive(Debug, Clone, PartialEq)]
pub struct Session {
    pub id: String,
    pub worktree_id: Option<String>,
    pub story_id: String,
    pub project_id: String,
    pub adapter: String,
    pub actor_id: String,
    pub status: SessionStatus,
    pub external_session_id: Option<String>,
    pub permission_mode: String,
    pub log_path: String,
}

/// The Story a session works and that Story's Epic — the scope every session event carries.
fn session_scope(tx: &Connection, session_id: &str) -> anyhow::Result<Option<(String, String, String)>> {
    tx.query_row(
        "SELECT r.project_id, r.story_id, s.epic_id FROM sessions r JOIN stories s ON s.id = r.story_id WHERE r.id = ?1",
        params![session_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .optional()
    .context("failed to read the session's Story")
}

/// The six values `sessions.status`'s CHECK constraint accepts (the baseline migration, D-49).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
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

impl SessionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SessionStatus::Running => "running",
            SessionStatus::Blocked => "blocked",
            SessionStatus::Completed => "completed",
            SessionStatus::Failed => "failed",
            SessionStatus::Interrupted => "interrupted",
            SessionStatus::Abandoned => "abandoned",
        }
    }
}

/// Resolve the id of the seeded agent actor (the baseline's `type = 'agent'`
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

/// Start a new session on `story_id` (D-30: always a fresh session, never `--resume`).
///
/// Ensures the Story's worktree exists first (create-or-reuse, `domain::worktree::ensure_worktree`
/// — its own inner transaction, committed before this function opens its own). Then, in ONE
/// transaction: inserts the `sessions` row with `status = 'running'` and appends
/// `session.started`, attributed to the agent actor.
///
/// This function writes no Story state (DRFT-04, D-13): starting a session is not a state signal.
/// Ready → Running is the developer's act, through `story::set_story_state`.
pub fn start_session(
    conn: &mut Connection,
    story_id: &str,
    permission_mode: &str,
    human_actor_id: &str,
) -> anyhow::Result<Session> {
    let worktree = ensure_worktree(conn, story_id, human_actor_id)
        .with_context(|| format!("failed to ensure a worktree for Story {story_id:?}"))?;

    let agent_id = agent_actor_id(conn)?;
    let now = Utc::now().to_rfc3339();
    let run_id = new_id();
    let log_path = session_log_path(&run_id)?.to_string_lossy().into_owned();

    let tx = conn.transaction()?;

    tx.query_row("SELECT 1 FROM actors WHERE id = ?1", params![human_actor_id], |r| r.get::<_, i64>(0))
        .with_context(|| format!("initiating actor {human_actor_id:?} not found"))?;

    let (project_id, epic_id): (String, String) = tx
        .query_row("SELECT project_id, epic_id FROM stories WHERE id = ?1", params![story_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .with_context(|| format!("Story {story_id:?} not found"))?;

    tx.execute(
        "INSERT INTO sessions (
            id, story_id, worktree_id, project_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at
        ) VALUES (?1, ?2, ?3, ?4, 'claude_code', ?5, 'running', NULL, ?6, NULL, NULL, NULL, ?7, ?8, NULL)",
        params![run_id, story_id, worktree.id, project_id, agent_id, permission_mode, log_path, now],
    )
    .context("failed to insert the sessions row")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let started_payload = serde_json::json!({
        "field": "session",
        "before": null,
        "after": run_id,
        "label": "Started agent run",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "session",
        &run_id,
        Some(story_id),
        Some(&epic_id),
        &agent_id,
        "session.started",
        &started_payload,
        &now,
    )?;

    tx.commit().context("failed to commit start_session transaction")?;

    Ok(Session {
        id: run_id,
        worktree_id: Some(worktree.id),
        story_id: story_id.to_string(),
        project_id,
        adapter: "claude_code".to_string(),
        actor_id: agent_id,
        status: SessionStatus::Running,
        external_session_id: None,
        permission_mode: permission_mode.to_string(),
        log_path,
    })
}

/// The statement body [`close_session`] issues, factored out so [`apply_session_closed`] can run
/// it inside ITS OWN transaction — alongside the fallback-summary presence check — rather than
/// opening a second, separate transaction and breaking "the status update and the summary insert
/// commit together or not at all" (T-04-07).
fn close_session_in_tx(
    tx: &Transaction,
    run_id: &str,
    status: SessionStatus,
    ending: EndingReason,
    cost_usd: Option<f64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();

    let Some((project_id, story_id, epic_id)) = session_scope(tx, run_id)? else {
        return Ok(());
    };

    let agent_id = agent_actor_id(tx)?;
    record_ending_in_tx(tx, run_id, ending, &crate::domain::actor::system_actor(tx)?.id)?;

    tx.execute(
        "UPDATE sessions SET status = ?1, cost_usd = ?2, tokens_in = ?3, tokens_out = ?4, ended_at = ?5 WHERE id = ?6",
        params![status.as_str(), cost_usd, tokens_in, tokens_out, now, run_id],
    )
    .context("failed to close the session")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "session",
        "before": "running",
        "after": status.as_str(),
        "ending_reason": ending.as_str(),
        "label": format!("Agent run {}: {}", status.as_str(), ending.words()),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "session",
        run_id,
        Some(&story_id),
        Some(&epic_id),
        &agent_id,
        "session.closed",
        &payload,
        &now,
    )?;

    Ok(())
}

/// Write a session's terminal status and `ended_at`, and append the matching event. Never touches
/// the Story's state.
///
/// Called only by test code today (production's one caller, `apply_session_closed`, runs
/// [`close_session_in_tx`] directly inside its own transaction). Never synthesizes a fallback
/// summary, since that behavior belongs to `apply_session_closed`'s own call site.
pub fn close_session(
    conn: &mut Connection,
    run_id: &str,
    status: SessionStatus,
    cost_usd: Option<f64>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
) -> anyhow::Result<()> {
    let ending = match status {
        SessionStatus::Completed => EndingReason::EndedWithoutHandOff,
        SessionStatus::Interrupted => EndingReason::StoppedByDeveloper,
        SessionStatus::Abandoned => EndingReason::AppQuit,
        SessionStatus::Failed => EndingReason::Crash,
        SessionStatus::Running | SessionStatus::Blocked => EndingReason::Unknown,
    };
    let tx = conn.transaction()?;
    close_session_in_tx(&tx, run_id, status, ending, cost_usd, tokens_in, tokens_out)?;
    tx.commit().context("failed to commit close_session transaction")?;
    Ok(())
}

/// D-53/plan 03-13: append exactly ONE `git.lock_exhausted` event when a shimmed `git`
/// invocation's retry budget is fully exhausted — never one event per individual collision.
/// `actor_id` is resolved by the CALLER (the sidecar reader loop resolves the system actor: a git
/// lock collision is Flywheel's own retry machinery giving up, not something the agent decided).
///
/// Writes NO row on `sessions` and changes no status. A `run_id` matching no session is a silent
/// no-op — the shared sidecar reader loop must never treat this as a hard failure (CR-03).
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

    let Some((project_id, story_id, epic_id)) = session_scope(&tx, run_id)? else {
        tx.commit().context("failed to commit no-op record_lock_exhaustion transaction")?;
        return Ok(());
    };

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = crate::git_retry::exhaustion_event_payload(repository, command, attempts);
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "session",
        run_id,
        Some(&story_id),
        Some(&epic_id),
        actor_id,
        "git.lock_exhausted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit record_lock_exhaustion transaction")?;
    Ok(())
}

/// What handling one `session_closed` event did to the session's row (G-02-4).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SessionClosedOutcome {
    /// The session reached this terminal status for the first time — exactly one terminal event
    /// was appended.
    Closed(SessionStatus),
    /// The session was already terminal and the event carried no figure the row was missing.
    AlreadyTerminal,
    /// The session was already terminal, but the event carried at least one figure (cost or a
    /// token count) an empty column was missing — that figure alone was backfilled.
    BackfilledTerminal,
    /// The event's run id is well formed but matches no `sessions` row.
    UnknownRun,
    /// Not a terminal `session_closed` event, or its run id was absent/malformed, or its `reason`
    /// did not map to a known status — nothing was read and nothing was written.
    Ignored,
}

/// Apply one sidecar `session_closed` event to the session's row (G-02-4). Never moves the
/// Story's state.
pub fn apply_session_closed(conn: &mut Connection, event: &serde_json::Value) -> anyhow::Result<SessionClosedOutcome> {
    if event.get("type").and_then(|v| v.as_str()) != Some("session_closed") {
        return Ok(SessionClosedOutcome::Ignored);
    }

    let Some(run_id) = event.get("runId").and_then(|v| v.as_str()) else {
        return Ok(SessionClosedOutcome::Ignored);
    };
    // Reject a malformed run id BEFORE any database statement is issued (T-02G-18-01).
    if !is_ulid(run_id) {
        return Ok(SessionClosedOutcome::Ignored);
    }

    let status = match event.get("reason").and_then(|v| v.as_str()) {
        Some("completed") => SessionStatus::Completed,
        Some("failed") => SessionStatus::Failed,
        Some("interrupted") => SessionStatus::Interrupted,
        _ => return Ok(SessionClosedOutcome::Ignored),
    };

    // A missing figure stays absent and is never coerced to zero (T-02G-18-04).
    let result = event.get("result");
    let cost_usd = result.and_then(|r| r.get("totalCostUsd")).and_then(serde_json::Value::as_f64);
    let tokens_in = result.and_then(|r| r.get("inputTokens")).and_then(serde_json::Value::as_i64);
    let tokens_out = result.and_then(|r| r.get("outputTokens")).and_then(serde_json::Value::as_i64);

    let existing: Option<(String, Option<f64>, Option<i64>, Option<i64>)> = conn
        .query_row(
            "SELECT status, cost_usd, tokens_in, tokens_out FROM sessions WHERE id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .context("failed to read the sessions row before applying session_closed")?;

    let Some((current_status, current_cost, current_tokens_in, current_tokens_out)) = existing else {
        return Ok(SessionClosedOutcome::UnknownRun);
    };

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
        // An explicit Stop already recorded the outcome (D-35): never overwrite it, never append a
        // second terminal event — but backfill an empty cost column the event can fill.
        let backfill_cost = current_cost.is_none() && cost_usd.is_some();
        let backfill_tokens_in = current_tokens_in.is_none() && tokens_in.is_some();
        let backfill_tokens_out = current_tokens_out.is_none() && tokens_out.is_some();

        if !backfill_cost && !backfill_tokens_in && !backfill_tokens_out {
            return Ok(SessionClosedOutcome::AlreadyTerminal);
        }

        conn.execute(
            "UPDATE sessions SET
                cost_usd = COALESCE(cost_usd, ?1),
                tokens_in = COALESCE(tokens_in, ?2),
                tokens_out = COALESCE(tokens_out, ?3)
             WHERE id = ?4",
            params![cost_usd, tokens_in, tokens_out, run_id],
        )
        .context("failed to backfill terminal session figures")?;
        return Ok(SessionClosedOutcome::BackfilledTerminal);
    }

    // ONE transaction covering both the status write and the fallback-summary presence check
    // (T-04-07), so a session is never terminal without a summary.
    let tx = conn.transaction()?;

    // The hand-off moves the Story to In review while its session is still alive; a session that
    // exits after it handed off, not one that stopped.
    let handed_off: bool = tx.query_row(
        "SELECT s.state IN ('in_review', 'merged') FROM sessions r JOIN stories s ON s.id = r.story_id WHERE r.id = ?1",
        params![run_id],
        |row| row.get(0),
    )?;
    let last_message = crate::session_log::last_assistant_message(run_id);
    let ending = classify_session_closed(event, last_message.as_ref(), handed_off);

    close_session_in_tx(&tx, run_id, status, ending, cost_usd, tokens_in, tokens_out)?;

    if crate::domain::session_summary::latest_summary_for_run(&tx, run_id)?.is_none() {
        crate::domain::session_summary::synthesize_fallback_summary(&tx, run_id, ending.words())?;
    }

    tx.commit().context("failed to commit apply_session_closed transaction")?;
    Ok(SessionClosedOutcome::Closed(status))
}

/// The session statuses a user may acknowledge (D-165, 10-04). A live session (`running`,
/// `blocked`) is absent on purpose: it can be stopped but not dismissed.
pub const ACKNOWLEDGEABLE_STATUSES: [&str; 4] = ["abandoned", "completed", "failed", "interrupted"];

/// Stamp `acknowledged_at` on a finished session, the ONE statement that does so. The status guard
/// is inside the statement, so a live session is refused whoever the caller is, and an already
/// acknowledged session keeps its first timestamp. Returns whether a row changed.
pub fn acknowledge_run(conn: &Connection, session_id: &str) -> anyhow::Result<bool> {
    let [a, b, c, d] = ACKNOWLEDGEABLE_STATUSES;
    let changed = conn
        .execute(
            "UPDATE sessions SET acknowledged_at = ?1
             WHERE id = ?2 AND acknowledged_at IS NULL AND status IN (?3, ?4, ?5, ?6)",
            params![Utc::now().to_rfc3339(), session_id, a, b, c, d],
        )
        .context("failed to acknowledge the session")?;
    Ok(changed == 1)
}

/// Move a session to `blocked` (AGNT-06, D-37) inside the CALLER'S transaction — called only from
/// `domain::permission_request::create_pending_request`, so a blocked session and its pending
/// request are written together or not at all.
pub fn set_run_blocked(tx: &Transaction, session_id: &str) -> anyhow::Result<()> {
    tx.execute("UPDATE sessions SET status = 'blocked' WHERE id = ?1", params![session_id])
        .context("failed to move the session to blocked")?;
    Ok(())
}

/// Move a session back to `running` inside the CALLER'S transaction — the exact inverse of
/// [`set_run_blocked`], called only from `domain::permission_request::answer_request`.
pub fn clear_run_blocked(tx: &Transaction, session_id: &str) -> anyhow::Result<()> {
    tx.execute("UPDATE sessions SET status = 'running' WHERE id = ?1", params![session_id])
        .context("failed to clear the session's blocked status")?;
    Ok(())
}

/// The statement body [`interrupt_session`] issues, factored out so the Stop/Discard path
/// (`commands::session::stop_session_in_tx`) can compose it with the presence-checked fallback
/// summary inside ONE transaction it owns (D-64, CTX-01). Unknown and already-terminal sessions are
/// a plain `Ok(())`; the caller owns the transaction's lifetime.
pub fn interrupt_session_in_tx(tx: &Transaction, session_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();

    let existing: Option<(String, String, String, String, String)> = tx
        .query_row(
            "SELECT r.project_id, r.story_id, s.epic_id, s.key, r.status
             FROM sessions r JOIN stories s ON s.id = r.story_id WHERE r.id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )
        .optional()
        .context("failed to read the sessions row before interrupt")?;

    let Some((project_id, story_id, epic_id, story_key, current_status)) = existing else {
        return Ok(());
    };

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
        // Already terminal — idempotent no-op, no second terminal event (D-35).
        return Ok(());
    }

    tx.execute(
        "UPDATE sessions SET status = 'interrupted', ended_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .context("failed to interrupt the session")?;
    record_ending_in_tx(tx, session_id, EndingReason::StoppedByDeveloper, actor_id)?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "session",
        "before": current_status,
        "after": "interrupted",
        "label": format!("Stopped agent run on {story_key}"),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "session",
        session_id,
        Some(&story_id),
        Some(&epic_id),
        actor_id,
        "session.interrupted",
        &payload,
        &now,
    )?;

    Ok(())
}

/// Move a `running`/`blocked` session to `interrupted` and set `ended_at` (D-35, PROC-06 — the
/// database half of "stop means interrupt, then force"). Idempotent on a terminal session and a
/// no-op on an unknown one. Never touches the Story's state and performs no git operation: the
/// worktree is left exactly as the agent left it.
pub fn interrupt_session(conn: &mut Connection, session_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    interrupt_session_in_tx(&tx, session_id, actor_id)?;
    tx.commit().context("failed to commit interrupt_session transaction")?;
    Ok(())
}

/// Mark a session `abandoned` (D-49) — the launch reconciler's own verb, never called by a live
/// session. Already-terminal and unknown sessions are a no-op returning `Ok(false)`.
///
/// On a real transition it writes the status and `ended_at`, appends `session.abandoned`
/// (carrying `reason` when the caller supplied one) and, inside the same transaction, the stub
/// summary when the session left none (T-05-09-01): no terminal status exists without a summary.
pub fn mark_abandoned(conn: &mut Connection, run_id: &str, actor_id: &str, reason: Option<&str>) -> anyhow::Result<bool> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String, String, String)> = tx
        .query_row(
            "SELECT r.status, r.project_id, r.story_id, s.epic_id
             FROM sessions r JOIN stories s ON s.id = r.story_id WHERE r.id = ?1",
            params![run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .context("failed to read the sessions row before marking it abandoned")?;

    let Some((current_status, project_id, story_id, epic_id)) = existing else {
        tx.commit().context("failed to commit no-op mark_abandoned transaction (session not found)")?;
        return Ok(false);
    };

    if matches!(current_status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
        tx.commit().context("failed to commit no-op mark_abandoned transaction (already terminal)")?;
        return Ok(false);
    }

    tx.execute("UPDATE sessions SET status = 'abandoned', ended_at = ?1 WHERE id = ?2", params![now, run_id])
        .context("failed to mark the session abandoned")?;
    // The reconciler finds a session the app left behind; a kill the developer chose at launch is
    // the one abandonment that is theirs.
    let ending = match reason {
        Some(KILLED_BY_USER_AT_LAUNCH) => EndingReason::StoppedByDeveloper,
        _ => EndingReason::AppQuit,
    };
    record_ending_in_tx(&tx, run_id, ending, actor_id)?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "session",
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
        "session",
        run_id,
        Some(&story_id),
        Some(&epic_id),
        actor_id,
        "session.abandoned",
        &payload,
        &now,
    )?;

    if crate::domain::session_summary::latest_summary_for_run(&tx, run_id)?.is_none() {
        crate::domain::session_summary::synthesize_fallback_summary(&tx, run_id, ending.words())?;
    }

    tx.commit().context("failed to commit mark_abandoned transaction")?;
    Ok(true)
}

/// The abandonment reason [`kill_orphan`] records: the developer killed a live orphan at launch.
pub const KILLED_BY_USER_AT_LAUNCH: &str = "killed-by-user-at-launch";

/// Every session still `running` or `blocked` when [`reconcile_sessions`] runs, joined to its
/// Story for the recovery modal's key and title — one query, a compile-time literal.
const IN_FLIGHT_SESSIONS_SELECT_SQL: &str = "
    SELECT r.id, r.story_id, r.project_id, r.external_session_id, s.key, s.title
    FROM sessions r
    JOIN stories s ON s.id = r.story_id
    WHERE r.status IN ('running', 'blocked')
";

/// One session [`reconcile_sessions`] found genuinely alive at launch (PROC-05, D-46). Written to
/// no status at all — a status write for a process that is still running would be the board lying
/// about a live fact — so this is the ONLY record of it; the user's kill decision resolves it.
#[derive(Debug, Clone, PartialEq)]
pub struct LiveOrphan {
    pub run_id: String,
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    pub project_id: String,
    pub external_session_id: Option<String>,
    pub pid: i32,
    pub started_at: String,
}

/// The launch-time three-way classification (PROC-05, D-46, D-49, D-50): every session still
/// `running` or `blocked` is sorted into killed-by-its-watchdog (abandoned with the kill record's
/// reason), dead-without-a-record (abandoned, no reason), or genuinely-still-alive (left exactly as
/// it is and returned as a [`LiveOrphan`]). A malformed kill record reads as "no evidence of a
/// kill", never as "killed". Never resumes, re-attaches to or re-spawns any process; idempotent
/// through [`mark_abandoned`]'s own terminal guard.
pub fn reconcile_sessions(conn: &mut Connection, actor_id: &str) -> anyhow::Result<Vec<LiveOrphan>> {
    #[allow(clippy::type_complexity)]
    let in_flight: Vec<(String, String, String, Option<String>, String, String)> = {
        let mut stmt = conn
            .prepare(IN_FLIGHT_SESSIONS_SELECT_SQL)
            .context("failed to prepare the in-flight sessions reconciliation query")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))
            .context("failed to query in-flight sessions for reconciliation")?;
        rows.collect::<Result<Vec<_>, _>>()
            .context("failed to read an in-flight sessions row during reconciliation")?
    };

    let descriptors: std::collections::HashMap<String, runtime_protocol::RunDescriptor> =
        runtime_protocol::list_run_descriptors()
            .into_iter()
            .map(|descriptor| (descriptor.run_id.clone(), descriptor))
            .collect();

    let mut live_orphans = Vec::new();

    for (run_id, story_id, project_id, external_session_id, story_key, story_title) in in_flight {
        match runtime_protocol::read_kill_record(&run_id) {
            KillRecordRead::Found(record) => {
                mark_abandoned(conn, &run_id, actor_id, Some(&record.reason))?;
                runtime_protocol::clear_run_runtime_files(&run_id);
                continue;
            }
            KillRecordRead::Absent | KillRecordRead::Malformed(_) => {}
        }

        match descriptors.get(&run_id) {
            Some(descriptor) if runtime_protocol::process_is_alive(descriptor.pid, descriptor.start_time) => {
                live_orphans.push(LiveOrphan {
                    run_id,
                    story_id,
                    story_key,
                    story_title,
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

/// Kill one live orphan by `session_id` (plan 03-06, D-48, T-03-06-04) — the only verb the
/// orphan-recovery modal offers (D-30, `03-UI-SPEC.md` discretion item 1). Reads the run's own
/// descriptor from disk — never a pid supplied by the caller (T-03-06-03) — re-checks liveness
/// (the process may have exited on its own between launch and the user's press), sends a fatal
/// signal to the process GROUP, waits a short bounded interval, then re-checks liveness again.
///
/// Writes the run to `abandoned` with reason `killed-by-user-at-launch` REGARDLESS of whether
/// the signal succeeded, following `commands::session::stop_session_recording_first`'s own
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

    mark_abandoned(conn, run_id, actor_id, Some(KILLED_BY_USER_AT_LAUNCH))?;
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
