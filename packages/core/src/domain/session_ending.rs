//! How a Story session ended (docs/mvp-spec.md §4.5, issue #54): a best-effort label for Stopped,
//! and the writes every terminal path shares.
//!
//! The label is read from the sidecar's `session_closed` event (the `result` line's `subtype`,
//! `isError`, `terminalReason` and `stopReason`, the exit code, the close origin) and from the last
//! assistant message in the session's log, because the CLI renders a refusal and a usage limit as
//! assistant text rather than as a result field (issue #24). Nothing branches on the label.
//!
//! [`record_ending_in_tx`] is the one place a session's ending is written: the label, and the
//! expiry of every request still pending on it. It runs inside the transaction that writes the
//! terminal status, so a dead session never keeps a pending request.

use anyhow::Context;
use rusqlite::{params, Transaction};

/// The labels Stopped shows (the `sessions.ending_reason` CHECK set).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndingReason {
    Refusal,
    UsageLimit,
    ApiError,
    Crash,
    AppQuit,
    /// The developer pressed Stop (or killed the session at launch).
    StoppedByDeveloper,
    /// A clean exit that never handed off: still Stopped.
    EndedWithoutHandOff,
    /// The session handed off for review before it exited: not a stop.
    HandedOff,
    Unknown,
}

impl EndingReason {
    pub const ALL: [EndingReason; 9] = [
        EndingReason::Refusal,
        EndingReason::UsageLimit,
        EndingReason::ApiError,
        EndingReason::Crash,
        EndingReason::AppQuit,
        EndingReason::StoppedByDeveloper,
        EndingReason::EndedWithoutHandOff,
        EndingReason::HandedOff,
        EndingReason::Unknown,
    ];

    /// The column value.
    pub fn as_str(self) -> &'static str {
        match self {
            EndingReason::Refusal => "refusal",
            EndingReason::UsageLimit => "usage_limit",
            EndingReason::ApiError => "api_error",
            EndingReason::Crash => "crash",
            EndingReason::AppQuit => "app_quit",
            EndingReason::StoppedByDeveloper => "stopped_by_developer",
            EndingReason::EndedWithoutHandOff => "ended_without_hand_off",
            EndingReason::HandedOff => "handed_off",
            EndingReason::Unknown => "unknown",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        EndingReason::ALL.into_iter().find(|r| r.as_str() == value)
    }

    /// The words the stub summary and the board use.
    pub fn words(self) -> &'static str {
        match self {
            EndingReason::Refusal => "refusal",
            EndingReason::UsageLimit => "usage limit",
            EndingReason::ApiError => "API error",
            EndingReason::Crash => "crash",
            EndingReason::AppQuit => "app quit",
            EndingReason::StoppedByDeveloper => "stopped by you",
            EndingReason::EndedWithoutHandOff => "ended without hand-off",
            EndingReason::HandedOff => "handed off",
            EndingReason::Unknown => "unknown",
        }
    }
}

/// The last thing the agent said, as the session log holds it (`assistant_text`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LastAssistantMessage {
    pub text: String,
    /// The CLI flagged the text as an error message rather than agent speech.
    pub is_api_error: bool,
    /// The CLI flagged the message as a rate limit (`rateLimitTier: "rejected"`).
    pub rate_limited: bool,
}

/// The refusal backstop: the CLI renders a refusal as `API Error: ... safeguards flagged ...`,
/// with the category as ``Details: `[reasoning_extraction]` `` (issue #24).
fn reads_as_refusal(text: &str) -> bool {
    text.trim_start().starts_with("API Error")
        && (text.contains("safeguards flagged") || text.contains("Details: `["))
}

fn reads_as_usage_limit(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    lower.contains("usage limit") || lower.contains("limit reached") || lower.contains("rate limit")
}

/// Label one `session_closed` event. `handed_off` says whether the Story had already moved to In
/// review (the hand-off), which makes any clean exit a hand-off rather than a stop.
pub fn classify_session_closed(
    event: &serde_json::Value,
    last: Option<&LastAssistantMessage>,
    handed_off: bool,
) -> EndingReason {
    let text_of = |v: Option<&serde_json::Value>| v.and_then(|v| v.as_str()).map(str::to_owned);
    let result = event.get("result").filter(|r| r.is_object());
    let subtype = text_of(result.and_then(|r| r.get("subtype")));
    let is_error = result
        .and_then(|r| r.get("isError"))
        .and_then(|v| v.as_bool());
    let terminal_reason = text_of(result.and_then(|r| r.get("terminalReason")));
    let stop_reason = text_of(result.and_then(|r| r.get("stopReason")));
    let exit_code = event.get("exitCode").and_then(|v| v.as_i64());
    let exit_signal = text_of(event.get("exitSignal"));
    let origin = text_of(event.get("closeOrigin"));
    let reason = text_of(event.get("reason"));

    if handed_off {
        return EndingReason::HandedOff;
    }
    if origin.as_deref() == Some("watchdog-heartbeat-stale") {
        return EndingReason::AppQuit;
    }
    if reason.as_deref() == Some("interrupted") {
        return EndingReason::StoppedByDeveloper;
    }
    if stop_reason.as_deref() == Some("refusal") || last.is_some_and(|m| reads_as_refusal(&m.text))
    {
        return EndingReason::Refusal;
    }
    let limited_text = last.is_some_and(|m| m.is_api_error && reads_as_usage_limit(&m.text));
    if last.is_some_and(|m| m.rate_limited)
        || limited_text
        || terminal_reason
            .as_deref()
            .is_some_and(|t| t.contains("rate_limit"))
    {
        return EndingReason::UsageLimit;
    }
    if is_error == Some(true)
        || terminal_reason.as_deref() == Some("api_error")
        || last.is_some_and(|m| m.is_api_error)
    {
        return EndingReason::ApiError;
    }
    if result.is_none() {
        // No result line: the process died under the CLI (a signal, or a crash before it could
        // write one). A missing exit code with no signal either is too thin to call.
        return if exit_signal.is_some()
            || exit_code.is_some_and(|c| c != 0)
            || reason.as_deref() == Some("failed")
        {
            EndingReason::Crash
        } else {
            EndingReason::Unknown
        };
    }
    if subtype.as_deref() == Some("error_during_execution") {
        return EndingReason::Crash;
    }
    let clean_exit = exit_code.unwrap_or(0) == 0 && exit_signal.is_none();
    match subtype.as_deref() {
        Some("success") if clean_exit => EndingReason::EndedWithoutHandOff,
        // Max turns, max budget: the CLI's own limits, none of the labels above.
        Some(s) if s.starts_with("error_") => EndingReason::Unknown,
        _ if !clean_exit => EndingReason::Crash,
        _ => EndingReason::Unknown,
    }
}

/// Write how `session_id` ended and expire every request still pending on it, inside the caller's
/// terminal transaction. Each expiry appends `permission_request.expired`.
pub fn record_ending_in_tx(
    tx: &Transaction,
    session_id: &str,
    ending: EndingReason,
    actor_id: &str,
) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE sessions SET ending_reason = ?1 WHERE id = ?2",
        params![ending.as_str(), session_id],
    )
    .context("failed to record how the session ended")?;
    expire_pending_requests_in_tx(tx, session_id, actor_id)
}

fn expire_pending_requests_in_tx(
    tx: &Transaction,
    session_id: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    let now = crate::domain::now();
    let pending: Vec<(String, String, String, String, Option<String>)> = {
        let mut stmt = tx.prepare(
            "SELECT pr.id, pr.project_id, pr.story_id, pr.tool_name, s.epic_id
             FROM permission_requests pr JOIN stories s ON s.id = pr.story_id
             WHERE pr.session_id = ?1 AND pr.status = 'pending' AND pr.expired_at IS NULL
             ORDER BY pr.created_at ASC, pr.id ASC",
        )?;
        let rows = stmt.query_map(params![session_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })?;
        rows.collect::<Result<_, _>>()
            .context("failed to read the session's pending requests")?
    };
    for (id, project_id, story_id, tool_name, epic_id) in pending {
        tx.execute(
            "UPDATE permission_requests SET expired_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .context("failed to expire a pending request")?;
        crate::domain::record_event(
            tx,
            &project_id,
            "permission_request",
            &id,
            crate::domain::EventScope {
                story_id: Some(&story_id),
                epic_id: epic_id.as_deref(),
            },
            actor_id,
            "permission_request.expired",
            &serde_json::json!({
                "field": "status",
                "before": "pending",
                "after": "expired",
                "tool_name": tool_name,
                "label": format!("{tool_name} request expired with its session"),
            }),
            &now,
        )?;
    }
    Ok(())
}
