//! Phase 09 plan 09-05 (AGNT-05, D-160/D-161/D-162): the account-limit gate. RED-step stub: the data
//! types are real, every behaviour is inert.

use serde::{Deserialize, Serialize};

use rusqlite::Connection;

/// The one global `settings` row the gate lives in.
pub const SETTING_DISPATCH_GATE: &str = "dispatch_gate";
/// A rejection arriving within this many seconds of a time-driven resume pauses for manual resume.
pub const DISPATCH_REJECT_FLOOR_SECS: i64 = 120;
/// Appended to the triggering run's project stream when the gate changes state.
pub const EVENT_DISPATCH_GATE_CHANGED: &str = "dispatch.gate_changed";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LimitTier {
    Open,
    Warning,
    Rejected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LimitSignal {
    pub tier: LimitTier,
    pub window: Option<String>,
    pub resets_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateReason {
    LimitReached,
    ResetUnknown,
    RejectedAgain,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum GateState {
    Open {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resumed_at: Option<i64>,
    },
    Warning {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resets_at: Option<i64>,
    },
    Paused {
        reason: GateReason,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        window: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        resume_at: Option<i64>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GateChange {
    pub before: GateState,
    pub after: GateState,
    pub changed: bool,
}

pub fn normalise_resets_at(_raw: &serde_json::Value) -> Option<i64> {
    None
}

impl LimitSignal {
    pub fn from_event(_event: &serde_json::Value) -> Option<LimitSignal> {
        None
    }
}

pub fn read_gate(_conn: &Connection, _now_epoch_secs: i64) -> anyhow::Result<GateState> {
    Ok(GateState::Open { resumed_at: None })
}

pub fn apply_rate_limit_signal(
    conn: &mut Connection,
    _signal: &LimitSignal,
    _now_epoch_secs: i64,
) -> anyhow::Result<GateChange> {
    let state = read_gate(conn, 0)?;
    Ok(GateChange { before: state.clone(), after: state, changed: false })
}

pub fn apply_rate_limit_signal_for_run(
    conn: &mut Connection,
    _run_id: &str,
    signal: &LimitSignal,
    now_epoch_secs: i64,
) -> anyhow::Result<GateChange> {
    apply_rate_limit_signal(conn, signal, now_epoch_secs)
}

impl GateState {
    pub fn message(&self) -> String {
        String::new()
    }
}
