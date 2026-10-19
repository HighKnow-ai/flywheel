//! Checks and their runs (docs/mvp-spec.md §4.4).
//!
//! A Check is a shell command attached to one Acceptance criterion, run from the worktree root;
//! exit 0 passes and the timeout defaults to ten minutes. Only the developer edits a Check: the
//! Story agent can neither change nor delete one, so [`set_check`] and [`remove_check`] refuse any
//! actor but a human.
//!
//! A run of record is tied to the commit it ran against. "Not run" is the absence of a current run,
//! and editing a Check resets it to not run: a run that started before the Check's last edit is not
//! its current result. Whether a result is stale (the branch moved since) is decided against the
//! branch head by the caller, never stored.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// The default Check timeout: ten minutes.
pub const DEFAULT_TIMEOUT_SECS: i64 = 600;

/// A `checks` row.
#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    pub id: String,
    pub criterion_id: String,
    pub command: String,
    pub timeout_secs: i64,
}

fn row_to_check(row: &Row) -> rusqlite::Result<Check> {
    Ok(Check { id: row.get(0)?, criterion_id: row.get(1)?, command: row.get(2)?, timeout_secs: row.get(3)? })
}

/// What a Check's latest run said. `TimedOut` is its own result, never shown as failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckResult {
    NotRun,
    Passed,
    Failed,
    TimedOut,
}

impl CheckResult {
    pub fn as_str(self) -> &'static str {
        match self {
            CheckResult::NotRun => "not_run",
            CheckResult::Passed => "passed",
            CheckResult::Failed => "failed",
            CheckResult::TimedOut => "timed_out",
        }
    }
}

/// A Check's current result and, when it ran, the commit it ran against.
#[derive(Debug, Clone, PartialEq)]
pub struct CurrentResult {
    pub result: CheckResult,
    pub commit_sha: Option<String>,
}

/// Attach (or replace) the Check on `criterion_id`. Human-only. Replacing a Check resets its result
/// to not run.
pub fn set_check(
    conn: &mut Connection,
    actor_id: &str,
    criterion_id: &str,
    command: &str,
    timeout_secs: Option<i64>,
) -> anyhow::Result<Check> {
    let tx = conn.transaction()?;
    let check = set_check_in_tx(&tx, actor_id, criterion_id, command, timeout_secs)?;
    tx.commit()?;
    Ok(check)
}

/// [`set_check`] inside the caller's transaction, human-only all the same.
pub(crate) fn set_check_in_tx(
    tx: &Transaction,
    actor_id: &str,
    criterion_id: &str,
    command: &str,
    timeout_secs: Option<i64>,
) -> anyhow::Result<Check> {
    let command = command.trim();
    anyhow::ensure!(!command.is_empty(), "a Check needs a command");
    let timeout_secs = timeout_secs.unwrap_or(DEFAULT_TIMEOUT_SECS);
    anyhow::ensure!(timeout_secs > 0, "a Check's timeout must be positive");
    let now = now();
    assert_human_actor_in_tx(tx, actor_id)?;
    let (story_id, epic_id, project_id): (String, String, String) = tx
        .query_row(
            "SELECT c.story_id, s.epic_id, s.project_id FROM acceptance_criteria c
             JOIN stories s ON s.id = c.story_id WHERE c.id = ?1",
            params![criterion_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .with_context(|| format!("criterion {criterion_id:?} not found"))?;
    let existing: Option<String> = tx
        .query_row("SELECT id FROM checks WHERE criterion_id = ?1", params![criterion_id], |r| r.get(0))
        .optional()?;
    let id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE checks SET command = ?1, timeout_secs = ?2, updated_at = ?3 WHERE id = ?4",
                params![command, timeout_secs, now, id],
            )?;
            id
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO checks (id, criterion_id, command, timeout_secs, created_by, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)",
                params![id, criterion_id, command, timeout_secs, actor_id, now],
            )?;
            id
        }
    };
    record_event(
        tx,
        &project_id,
        "check",
        &id,
        EventScope { story_id: Some(&story_id), epic_id: Some(&epic_id) },
        actor_id,
        "check.set",
        &serde_json::json!({ "command": command, "label": format!("Set the Check to `{command}`") }),
        &now,
    )?;
    Ok(Check { id, criterion_id: criterion_id.to_string(), command: command.to_string(), timeout_secs })
}

/// Remove the Check from `criterion_id`; the criterion is then judged at review. Human-only.
pub fn remove_check(conn: &mut Connection, actor_id: &str, criterion_id: &str) -> anyhow::Result<()> {
    let now = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let found: Option<(String, String, String, String)> = tx
        .query_row(
            "SELECT k.id, c.story_id, s.epic_id, s.project_id FROM checks k
             JOIN acceptance_criteria c ON c.id = k.criterion_id
             JOIN stories s ON s.id = c.story_id WHERE k.criterion_id = ?1",
            params![criterion_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((check_id, story_id, epic_id, project_id)) = found else {
        return Ok(());
    };
    tx.execute("DELETE FROM checks WHERE id = ?1", params![check_id])?;
    record_event(
        &tx,
        &project_id,
        "check",
        &check_id,
        EventScope { story_id: Some(&story_id), epic_id: Some(&epic_id) },
        actor_id,
        "check.removed",
        &serde_json::json!({ "label": "Removed the Check" }),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}

/// The Check on `criterion_id`, if it has one.
pub fn check_for_criterion(conn: &Connection, criterion_id: &str) -> anyhow::Result<Option<Check>> {
    conn.query_row(
        "SELECT id, criterion_id, command, timeout_secs FROM checks WHERE criterion_id = ?1",
        params![criterion_id],
        row_to_check,
    )
    .optional()
    .context("failed to read the Check")
}

/// One finished run of a Check, as Flywheel records it at hand-off.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckRunRecord<'a> {
    pub commit_sha: &'a str,
    pub result: CheckResult,
    pub exit_code: Option<i64>,
    pub output_tail: Option<&'a str>,
    pub started_at: &'a str,
    pub ended_at: &'a str,
}

/// Record a run of record. `NotRun` is not a run and is refused.
pub fn record_check_run(conn: &mut Connection, check_id: &str, run: &CheckRunRecord) -> anyhow::Result<String> {
    anyhow::ensure!(run.result != CheckResult::NotRun, "a recorded run has a result");
    let id = new_id();
    conn.execute(
        "INSERT INTO check_runs (id, check_id, commit_sha, result, exit_code, output_tail, started_at, ended_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, check_id, run.commit_sha, run.result.as_str(), run.exit_code, run.output_tail, run.started_at, run.ended_at],
    )
    .context("failed to record the Check run")?;
    Ok(id)
}

/// A Check's current result: its latest run that started after the Check's last edit, or not run.
pub fn current_result(conn: &Connection, check_id: &str) -> anyhow::Result<CurrentResult> {
    let latest: Option<(String, String)> = conn
        .query_row(
            "SELECT r.result, r.commit_sha FROM check_runs r JOIN checks k ON k.id = r.check_id
             WHERE r.check_id = ?1 AND r.started_at >= k.updated_at
             ORDER BY r.started_at DESC, r.id DESC LIMIT 1",
            params![check_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    Ok(match latest {
        None => CurrentResult { result: CheckResult::NotRun, commit_sha: None },
        Some((result, sha)) => CurrentResult {
            result: match result.as_str() {
                "passed" => CheckResult::Passed,
                "failed" => CheckResult::Failed,
                "timed_out" => CheckResult::TimedOut,
                other => anyhow::bail!("unknown Check result {other:?}"),
            },
            commit_sha: Some(sha),
        },
    })
}
