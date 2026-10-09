//! Phase 09 plan 09-05 (AGNT-05, D-160/D-161/D-162): the account-limit gate.
//!
//! A limit from the backend pauses NEW dispatch and nothing else. This module writes no agent-run
//! status, signals no process and touches no session: a session mid-task holds uncommitted work and
//! spent tokens, and stopping in-flight work is not what a limit is asking for.
//!
//! It never probes. There is no request path here at all, so there is no way to ask "has the limit
//! lifted?"; the only ways back to open are a real reset timestamp the wire reported, compared against
//! an injected clock, and the user's own resume. A reset time that is absent or malformed pauses with
//! no resume instant: guessing a wait is a quieter version of a probe.
//!
//! The wire is read at the adapter seam, not here. The supervisor receives an already-normalised tier
//! (`open` / `warning` / `rejected`) and acts on that alone, so this module names no backend and reads
//! no backend field.
//!
//! **Unobserved.** No hard limit has ever been observed live in this project. The `Rejected` tier is
//! built from the documented shape and exercised against constructed fixtures only.
//!
//! The gate is one global `settings` row (so, like the parallel cap, no `events` row of its own); a
//! caller that knows the triggering run uses [`apply_rate_limit_signal_for_run`], which appends one
//! `dispatch.gate_changed` event to that run's project stream in the same transaction as the write.
//! A row is written only when the state actually changes: the backend sends a limit line per response.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::domain::actor::system_actor;
use crate::domain::event::{append_event, next_sequence};
use crate::domain::settings::{read_setting, upsert_setting};

/// The one global `settings` row the gate lives in.
pub const SETTING_DISPATCH_GATE: &str = "dispatch_gate";
/// A rejection arriving within this many seconds of a time-driven resume pauses for manual resume.
/// Without it, resume -> spawn -> immediate rejection -> resume is a blind retry wearing a timestamp.
pub const DISPATCH_REJECT_FLOOR_SECS: i64 = 120;
/// Appended to the triggering run's project stream when the gate changes state.
pub const EVENT_DISPATCH_GATE_CHANGED: &str = "dispatch.gate_changed";

/// Above this, a reset time is milliseconds, not seconds (1e11 seconds is the year 5138).
const MILLISECONDS_THRESHOLD: f64 = 1e11;

/// The normalised reading the adapter seam hands the supervisor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimitTier {
    Open,
    Warning,
    Rejected,
}

impl LimitTier {
    fn parse(raw: &str) -> Option<LimitTier> {
        match raw {
            "open" => Some(LimitTier::Open),
            "warning" => Some(LimitTier::Warning),
            "rejected" => Some(LimitTier::Rejected),
            _ => None,
        }
    }
}

/// One normalised limit reading: the tier, the limit window it concerns and, when the wire gave a
/// usable one, when that window resets (epoch seconds).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LimitSignal {
    pub tier: LimitTier,
    pub window: Option<String>,
    pub resets_at: Option<i64>,
}

impl LimitSignal {
    /// Read the signal off a sidecar event: a `rate_limit` event carries `tier`; an assistant message
    /// whose backend error named a limit carries `rateLimitTier`. An event with neither, or with a
    /// tier this module does not know, is not a signal.
    pub fn from_event(event: &serde_json::Value) -> Option<LimitSignal> {
        let raw_tier = event
            .get("tier")
            .or_else(|| event.get("rateLimitTier"))
            .and_then(|v| v.as_str())?;
        Some(LimitSignal {
            tier: LimitTier::parse(raw_tier)?,
            window: event
                .get("rateLimitType")
                .and_then(|v| v.as_str())
                .filter(|w| !w.is_empty())
                .map(str::to_owned),
            resets_at: event.get("resetsAt").and_then(normalise_resets_at),
        })
    }
}

/// Normalise a reset time to epoch seconds. A number above 1e11 is milliseconds; a positive number at
/// or below it is already seconds; anything else (a string, zero, a negative, null) is absent. The one
/// live sample is seconds and community documentation describes milliseconds, so the magnitude test is
/// the guard rather than a choice between the two.
pub fn normalise_resets_at(raw: &serde_json::Value) -> Option<i64> {
    let n = raw.as_f64().filter(|n| n.is_finite() && *n > 0.0)?;
    let seconds = if n > MILLISECONDS_THRESHOLD { n / 1000.0 } else { n };
    Some(seconds.floor() as i64)
}

/// Why the gate is paused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateReason {
    /// The backend refused and reported when the window resets.
    LimitReached,
    /// The backend refused and reported no usable reset time: only a manual resume clears this.
    ResetUnknown,
    /// A second rejection inside [`DISPATCH_REJECT_FLOOR_SECS`] of a time-driven resume.
    RejectedAgain,
}

/// The gate, as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GateState {
    /// Dispatch may proceed. `resumed_at` remembers a time-driven resume, for the reject floor.
    Open {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resumed_at: Option<i64>,
    },
    /// Approaching a limit window: the running wave finishes, the cursor does not advance on its own.
    Warning {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resets_at: Option<i64>,
    },
    /// New dispatch is stopped.
    Paused {
        reason: GateReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
        /// When the wire said the window resets. `None` means only a manual resume clears it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume_at: Option<i64>,
    },
}

impl GateState {
    pub fn is_open(&self) -> bool {
        matches!(self, GateState::Open { .. })
    }

    /// The reason the user reads.
    pub fn message(&self) -> String {
        let named = |w: &Option<String>| w.as_deref().map(|w| format!(" ({w})")).unwrap_or_default();
        match self {
            GateState::Open { .. } => "Dispatch is open.".to_string(),
            GateState::Warning { window, .. } => format!(
                "Approaching the usage limit{}: the running wave will finish and the next will not start on its own.",
                named(window)
            ),
            GateState::Paused { reason: GateReason::LimitReached, window, resume_at } => {
                let when = resume_at
                    .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
                    .map(|d| d.to_rfc3339())
                    .unwrap_or_else(|| "its reset time".to_string());
                format!("Usage limit reached{}: new dispatch is paused and resumes at {when}.", named(window))
            }
            GateState::Paused { reason: GateReason::ResetUnknown, window, .. } => format!(
                "Usage limit reached{}: the reset time is unknown, so new dispatch stays paused until you resume it.",
                named(window)
            ),
            GateState::Paused { reason: GateReason::RejectedAgain, window, .. } => format!(
                "Usage limit hit again right after dispatch resumed{}: new dispatch stays paused until you resume it.",
                named(window)
            ),
        }
    }
}

/// What one application of a signal did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateChange {
    pub before: GateState,
    pub after: GateState,
    pub changed: bool,
}

/// The stored state. An absent or malformed row reads as open and never errors: the dispatcher reads
/// this every tick, and a bad row degrading to "open" costs at worst one request the backend refuses
/// again, which re-pauses the gate.
fn read_stored(conn: &Connection) -> anyhow::Result<GateState> {
    Ok(read_setting(conn, SETTING_DISPATCH_GATE)?
        .and_then(|raw| serde_json::from_str::<GateState>(&raw).ok())
        .unwrap_or(GateState::Open { resumed_at: None }))
}

/// The gate as of `now_epoch_secs`: the stored state, except that a pause whose resume instant has
/// arrived reads open. Pure over the stored row and the injected clock, so the tick that asks owns no
/// timer. (Persisting that resume, and the reject floor it arms, is `resume_if_due`.)
pub fn read_gate(conn: &Connection, now_epoch_secs: i64) -> anyhow::Result<GateState> {
    Ok(match read_stored(conn)? {
        GateState::Paused { resume_at: Some(t), .. } if now_epoch_secs >= t => {
            GateState::Open { resumed_at: Some(t) }
        }
        other => other,
    })
}

fn next_state(current: &GateState, signal: &LimitSignal, now: i64) -> GateState {
    match signal.tier {
        // The warning tier's consequences are the next task's.
        LimitTier::Open | LimitTier::Warning => current.clone(),
        LimitTier::Rejected => after_rejection(current, signal, now),
    }
}

fn after_rejection(current: &GateState, signal: &LimitSignal, now: i64) -> GateState {
    let future_reset = signal.resets_at.filter(|r| *r > now);
    match current {
        // Already waiting for the user: nothing the wire says turns that into a timed wait.
        GateState::Paused { reason: GateReason::RejectedAgain, .. } => current.clone(),
        // The limit hit again right after we resumed on its own say-so: stop trusting the clock.
        GateState::Open { resumed_at: Some(t) } if now >= *t && now - *t < DISPATCH_REJECT_FLOOR_SECS => {
            GateState::Paused { reason: GateReason::RejectedAgain, window: signal.window.clone(), resume_at: None }
        }
        // Already paused on a known reset: only a LATER real reset extends it, never an earlier one.
        GateState::Paused { resume_at: Some(t), .. } => match future_reset {
            Some(r) if r > *t => paused_until(signal, r),
            _ => current.clone(),
        },
        // Already paused with no reset known: a real reset off the wire upgrades it; nothing else does.
        GateState::Paused { resume_at: None, .. } => match future_reset {
            Some(r) => paused_until(signal, r),
            None => current.clone(),
        },
        GateState::Open { .. } | GateState::Warning { .. } => match signal.resets_at {
            // A reset already past pauses for zero time: the next tick resumes once, and the floor
            // above stops that becoming a loop.
            Some(r) => paused_until(signal, r.max(now)),
            None => GateState::Paused {
                reason: GateReason::ResetUnknown,
                window: signal.window.clone(),
                resume_at: None,
            },
        },
    }
}

fn paused_until(signal: &LimitSignal, resume_at: i64) -> GateState {
    GateState::Paused { reason: GateReason::LimitReached, window: signal.window.clone(), resume_at: Some(resume_at) }
}

/// Apply one limit signal to the stored gate, writing only if the state changed.
pub fn apply_rate_limit_signal(
    conn: &mut Connection,
    signal: &LimitSignal,
    now_epoch_secs: i64,
) -> anyhow::Result<GateChange> {
    apply(conn, signal, now_epoch_secs, None)
}

/// [`apply_rate_limit_signal`], and on a change also append one `dispatch.gate_changed` event to the
/// triggering run's project stream (the `events` table requires a project) in the same transaction.
/// An unknown run still updates the gate; it just has no stream to put the event on.
pub fn apply_rate_limit_signal_for_run(
    conn: &mut Connection,
    run_id: &str,
    signal: &LimitSignal,
    now_epoch_secs: i64,
) -> anyhow::Result<GateChange> {
    apply(conn, signal, now_epoch_secs, Some(run_id))
}

fn apply(
    conn: &mut Connection,
    signal: &LimitSignal,
    now: i64,
    run_id: Option<&str>,
) -> anyhow::Result<GateChange> {
    let before = read_stored(conn)?;
    let after = next_state(&before, signal, now);
    if before == after {
        return Ok(GateChange { before, after, changed: false });
    }
    let actor = system_actor(conn).context("failed to resolve the system actor for the gate")?;
    let stamp = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    upsert_setting(&tx, SETTING_DISPATCH_GATE, &serde_json::to_string(&after)?, &actor.id, &stamp)?;
    if let Some(run_id) = run_id {
        append_gate_event(&tx, run_id, &actor.id, &before, &after, &stamp)?;
    }
    tx.commit().context("failed to commit the dispatch gate change")?;
    Ok(GateChange { before, after, changed: true })
}

fn append_gate_event(
    tx: &rusqlite::Transaction,
    run_id: &str,
    actor_id: &str,
    before: &GateState,
    after: &GateState,
    now: &str,
) -> anyhow::Result<()> {
    let anchor: Option<(String, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT r.project_id, r.task_id, COALESCE(r.epic_id, t.epic_id)
               FROM agent_runs r LEFT JOIN tasks t ON t.id = r.task_id WHERE r.id = ?1",
            params![run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .context("failed to read the run a gate change belongs to")?;
    let Some((project_id, task_id, epic_id)) = anchor else { return Ok(()) };
    let payload = serde_json::json!({
        "label": after.message(),
        "from": before,
        "to": after,
        "run_id": run_id,
    });
    let sequence = next_sequence(tx, &project_id, "local")?;
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "project",
        &project_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        EVENT_DISPATCH_GATE_CHANGED,
        &payload,
        now,
    )?;
    Ok(())
}

// --- Task 2 (RED-step stubs: inert) -----------------------------------------------------------

pub fn may_spawn(_gate: &GateState) -> bool {
    false
}

pub fn may_advance(_gate: &GateState) -> bool {
    false
}

pub fn may_merge(_gate: &GateState) -> bool {
    false
}

pub fn clear_expired_warning(conn: &mut Connection, _now: i64) -> anyhow::Result<GateChange> {
    let state = read_stored(conn)?;
    Ok(GateChange { before: state.clone(), after: state, changed: false })
}

pub fn resume_if_due(conn: &mut Connection, _now: i64) -> anyhow::Result<GateChange> {
    let state = read_stored(conn)?;
    Ok(GateChange { before: state.clone(), after: state, changed: false })
}

pub fn resume_now(conn: &mut Connection, _actor_id: &str) -> anyhow::Result<GateChange> {
    let state = read_stored(conn)?;
    Ok(GateChange { before: state.clone(), after: state, changed: false })
}

pub fn hold_for_limit(_conn: &Connection, _plan_id: &str, _task_id: &str) -> anyhow::Result<()> {
    Ok(())
}
