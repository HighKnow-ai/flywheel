//! The hand-off and the feedback-only Check run (docs/mvp-spec.md §4.4, §2 "Story state", issue
//! #53): the two board tools that end a Story session's work. The sidecar's MCP server hosts them
//! and relays each call to the Rust core, which is what runs this module.
//!
//! - `checks_run` runs the Story's Checks for the agent's feedback. Nothing is recorded, and it
//!   takes no argument: it runs the Checks the developer wrote, never a command of the agent's.
//! - `handoff` takes the Session summary (*next session must know*, *decisions*) and needs the Task
//!   checklist to be current: written, with no Task left *doing*. Open Tasks are allowed; they only
//!   warn at review. Flywheel then runs every Check, records each result against the commit it ran
//!   against with its output tail, and moves the Story to In review whatever the results.
//!
//! A run takes minutes, so it is split in three for a caller that must not hold the database while
//! it runs: [`plan_handoff`] / [`plan_feedback_run`] read and refuse, [`run_checks`] runs without a
//! connection, and [`complete_handoff`] writes the summary, every result, the state move and the
//! Story's review (`domain::review`, issue #155: the diff's size and the Tasks left open) in one
//! transaction. [`hand_off`] does all three in a row.
//!
//! Identity comes from the session the call arrived on, never from an argument, and only a live
//! session may call either tool. Neither tool can edit or delete a Check: [`check::set_check`] and
//! [`check::remove_check`] are human-only.

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::check_runner::{run_shell_check, ShellOutcome};
use crate::domain::check::{self, record_check_run_in_tx, CheckResult, CheckRunRecord};
use crate::domain::review::{open_review_in_tx, read_review_diff, ReviewDiff};
use crate::domain::session::agent_actor_id;
use crate::domain::session_summary::create_summary_in_tx;
use crate::domain::story::{set_story_state_in_tx, StoryState};
use crate::domain::{now, record_event, EventScope};

/// The tool names the sidecar's MCP server registers. Mirrored by `HANDOFF_TOOL_NAMES` in
/// `packages/sidecar/src/mcp-permission-server.ts`.
pub const HANDOFF_TOOL_NAMES: [&str; 2] = ["checks_run", "handoff"];

/// The longest a Session summary field may be.
pub const MAX_SUMMARY_FIELD_LEN: usize = 20_000;

/// One parsed call of either tool.
#[derive(Debug, Clone, PartialEq)]
pub enum HandoffToolCall {
    ChecksRun,
    Handoff { next_session_must_know: String, decisions: String },
}

impl HandoffToolCall {
    /// Parse a call from the tool name and its JSON arguments, refusing anything malformed before
    /// anything runs.
    pub fn parse(tool: &str, args: &Value) -> anyhow::Result<Self> {
        match tool {
            "checks_run" => {
                let has_args = args.as_object().is_some_and(|o| !o.is_empty());
                anyhow::ensure!(
                    !has_args,
                    "checks_run takes no arguments: it runs the Checks the developer wrote, and only the developer edits a Check"
                );
                Ok(HandoffToolCall::ChecksRun)
            }
            "handoff" => {
                let field = |name: &str| -> anyhow::Result<String> {
                    let value = args
                        .get(name)
                        .and_then(Value::as_str)
                        .with_context(|| format!("handoff needs `{name}`, a string"))?
                        .trim();
                    anyhow::ensure!(
                        value.chars().count() <= MAX_SUMMARY_FIELD_LEN,
                        "`{name}` is at most {MAX_SUMMARY_FIELD_LEN} characters"
                    );
                    Ok(value.to_string())
                };
                let next_session_must_know = field("next_session_must_know")?;
                anyhow::ensure!(
                    !next_session_must_know.is_empty(),
                    "handoff needs `next_session_must_know`: what the next session must know"
                );
                Ok(HandoffToolCall::Handoff { next_session_must_know, decisions: field("decisions")? })
            }
            other => anyhow::bail!("{other:?} is not a hand-off tool"),
        }
    }
}

/// One Check to run, as read off the board.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedCheck {
    pub check_id: String,
    pub command: String,
    pub timeout_secs: i64,
}

/// Everything a run needs, read and checked before anything runs.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckPlan {
    pub session_id: String,
    pub project_id: String,
    pub story_id: String,
    pub worktree_path: PathBuf,
    pub checks: Vec<PlannedCheck>,
    /// A hand-off's base branch, whose diff against the branch the review records; `None` for a
    /// feedback run, which records nothing.
    pub review_base: Option<String>,
}

/// One Check's run.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckOutcome {
    pub check_id: String,
    pub command: String,
    pub result: CheckResult,
    pub exit_code: Option<i64>,
    pub output_tail: String,
    pub started_at: String,
    pub ended_at: String,
}

/// Every Check's run, and the commit they ran against.
#[derive(Debug, Clone, PartialEq)]
pub struct CheckBatch {
    pub commit_sha: String,
    pub outcomes: Vec<CheckOutcome>,
    /// The diff `base...commit_sha` a hand-off's review records; `None` for a feedback run.
    pub diff: Option<ReviewDiff>,
}

/// What a hand-off left behind.
#[derive(Debug, Clone, PartialEq)]
pub struct HandoffOutcome {
    pub project_id: String,
    pub story_id: String,
    pub summary_id: String,
    pub batch: CheckBatch,
    /// Tasks still open at hand-off, which warn at review.
    pub open_tasks: i64,
    /// The review the hand-off opened.
    pub review_id: String,
}

/// The session's Story, project and status; refused unless the session is live.
fn live_session(conn: &Connection, session_id: &str) -> anyhow::Result<(String, String)> {
    let (story_id, project_id, status) = crate::domain::session::story_session(conn, session_id)?;
    anyhow::ensure!(status == "running" || status == "blocked", "this session has ended ({status}); it can no longer run Checks or hand off");
    Ok((story_id, project_id))
}

fn plan(conn: &Connection, session_id: &str, story_id: String, project_id: String, for_review: bool) -> anyhow::Result<CheckPlan> {
    let worktree = crate::domain::worktree::worktree_for_story(conn, &story_id)?
        .context("this Story has no worktree to run its Checks in")?;
    let worktree_path = PathBuf::from(worktree.path);
    anyhow::ensure!(worktree_path.is_dir(), "this Story's worktree is missing from disk");
    let checks = check::checks_for_story(conn, &story_id)?
        .into_iter()
        .map(|c| PlannedCheck { check_id: c.id, command: c.command, timeout_secs: c.timeout_secs })
        .collect();
    let review_base = for_review.then(|| worktree.base_branch.clone());
    Ok(CheckPlan { session_id: session_id.to_string(), project_id, story_id, worktree_path, checks, review_base })
}

/// Plan a feedback run for session `session_id`: its Story's Checks and worktree.
pub fn plan_feedback_run(conn: &Connection, session_id: &str) -> anyhow::Result<CheckPlan> {
    let (story_id, project_id) = live_session(conn, session_id)?;
    plan(conn, session_id, story_id, project_id, false)
}

/// Plan a hand-off for session `session_id`, refusing it unless the Story is Running and its Task
/// checklist is current: written, with no Task left doing.
pub fn plan_handoff(conn: &Connection, session_id: &str) -> anyhow::Result<CheckPlan> {
    let (story_id, project_id) = live_session(conn, session_id)?;
    let state: String = conn.query_row("SELECT state FROM stories WHERE id = ?1", params![story_id], |r| r.get(0))?;
    anyhow::ensure!(
        state == StoryState::Running.as_str(),
        "only a Running Story hands off, and this one is {state}"
    );
    let (tasks, doing): (i64, i64) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(state = 'doing'), 0) FROM tasks WHERE story_id = ?1",
        params![story_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    anyhow::ensure!(tasks > 0, "your Task checklist is empty: write it with task_add and bring it up to date before handing off");
    anyhow::ensure!(
        doing == 0,
        "a Task is still doing: mark it done, open or dropped with task_update so the checklist is current, then hand off"
    );
    plan(conn, session_id, story_id, project_id, true)
}

/// Run every planned Check from the worktree root, one at a time, each to the end: a failure or a
/// timeout never stops the rest. Holds no database connection. The commit is read once, before
/// the first Check runs, and so is a hand-off's diff against its base branch.
pub fn run_checks(plan: &CheckPlan) -> anyhow::Result<CheckBatch> {
    let commit_sha = check::worktree_head(&plan.worktree_path).context("could not read the branch's commit")?;
    let diff = plan
        .review_base
        .as_deref()
        .map(|base| read_review_diff(&plan.worktree_path, base, &commit_sha))
        .transpose()
        .context("could not read the branch's diff against its base branch")?;
    let outcomes = plan
        .checks
        .iter()
        .map(|c| {
            let started_at = now();
            let timeout = Duration::from_secs(u64::try_from(c.timeout_secs).unwrap_or(1).max(1));
            let (result, exit_code, output_tail) = match run_shell_check(&plan.worktree_path, &c.command, timeout) {
                Ok(run) => match run.outcome {
                    ShellOutcome::Exited(Some(0)) => (CheckResult::Passed, Some(0), run.output_tail),
                    ShellOutcome::Exited(code) => (CheckResult::Failed, code.map(i64::from), run.output_tail),
                    ShellOutcome::TimedOut => (CheckResult::TimedOut, None, run.output_tail),
                },
                Err(e) => (CheckResult::Failed, None, format!("Flywheel could not start the shell: {e}")),
            };
            CheckOutcome {
                check_id: c.check_id.clone(),
                command: c.command.clone(),
                result,
                exit_code,
                output_tail,
                started_at,
                ended_at: now(),
            }
        })
        .collect();
    Ok(CheckBatch { commit_sha, outcomes, diff })
}

/// Write the hand-off in one transaction, as the agent: the Session summary, every Check result
/// against the commit it ran against, the move to In review, whatever the results, and the review
/// it opens.
pub fn complete_handoff(
    conn: &mut Connection,
    plan: &CheckPlan,
    next_session_must_know: &str,
    decisions: &str,
    batch: CheckBatch,
) -> anyhow::Result<HandoffOutcome> {
    let agent = agent_actor_id(conn)?;
    let tx = conn.transaction()?;
    let summary = create_summary_in_tx(&tx, &plan.session_id, next_session_must_know, decisions)?;
    for outcome in &batch.outcomes {
        let still_there: bool =
            tx.query_row("SELECT EXISTS (SELECT 1 FROM checks WHERE id = ?1)", params![outcome.check_id], |r| r.get(0))?;
        if !still_there {
            // The developer removed this Check while it ran: there is nothing to record it on.
            continue;
        }
        record_check_run_in_tx(
            &tx,
            &outcome.check_id,
            &CheckRunRecord {
                commit_sha: &batch.commit_sha,
                result: outcome.result,
                exit_code: outcome.exit_code,
                output_tail: Some(&outcome.output_tail),
                started_at: &outcome.started_at,
                ended_at: &outcome.ended_at,
            },
        )?;
    }
    set_story_state_in_tx(&tx, &agent, &plan.story_id, StoryState::InReview)?;
    let epic_id: String = tx.query_row("SELECT epic_id FROM stories WHERE id = ?1", params![plan.story_id], |r| r.get(0))?;
    let count = |result: CheckResult| batch.outcomes.iter().filter(|o| o.result == result).count();
    let (passed, failed, timed_out) = (count(CheckResult::Passed), count(CheckResult::Failed), count(CheckResult::TimedOut));
    record_event(
        &tx,
        &plan.project_id,
        "story",
        &plan.story_id,
        EventScope { story_id: Some(&plan.story_id), epic_id: Some(&epic_id) },
        &agent,
        "story.handed_off",
        &serde_json::json!({
            "session_id": plan.session_id,
            "commit_sha": batch.commit_sha,
            "passed": passed, "failed": failed, "timed_out": timed_out,
            "label": format!("Handed off for review: {passed} Checks passed, {failed} failed, {timed_out} timed out"),
        }),
        &now(),
    )?;
    let open_tasks: i64 =
        tx.query_row("SELECT COUNT(*) FROM tasks WHERE story_id = ?1 AND state = 'open'", params![plan.story_id], |r| r.get(0))?;
    let diff = batch.diff.as_ref().context("a hand-off's run reads the branch's diff; this one did not")?;
    let review_id = open_review_in_tx(&tx, &plan.project_id, &plan.story_id, Some(&plan.session_id), diff)?;
    tx.commit().context("failed to commit the hand-off")?;
    Ok(HandoffOutcome {
        project_id: plan.project_id.clone(),
        story_id: plan.story_id.clone(),
        summary_id: summary.id,
        batch,
        open_tasks,
        review_id,
    })
}

/// Hand off in one go: plan, run every Check, then record. For a caller that may hold the
/// connection for the whole run.
pub fn hand_off(
    conn: &mut Connection,
    session_id: &str,
    next_session_must_know: &str,
    decisions: &str,
) -> anyhow::Result<HandoffOutcome> {
    let plan = plan_handoff(conn, session_id)?;
    let batch = run_checks(&plan)?;
    complete_handoff(conn, &plan, next_session_must_know, decisions, batch)
}

/// The Checks' results as the tools answer them to the agent.
pub fn batch_as_tool_result(batch: &CheckBatch) -> Value {
    let checks: Vec<Value> = batch
        .outcomes
        .iter()
        .map(|o| {
            serde_json::json!({
                "command": o.command,
                "result": o.result.as_str(),
                "exit_code": o.exit_code,
                "output_tail": o.output_tail,
            })
        })
        .collect();
    serde_json::json!({ "commit": batch.commit_sha, "checks": checks })
}

/// The hand-off as the tool answers it to the agent.
pub fn handoff_as_tool_result(outcome: &HandoffOutcome) -> Value {
    let mut answer = batch_as_tool_result(&outcome.batch);
    answer["recorded"] = Value::Bool(true);
    answer["story_state"] = Value::String(StoryState::InReview.as_str().to_string());
    answer["open_tasks"] = Value::from(outcome.open_tasks);
    answer["next"] = Value::String("The Story is In review. End your turn now.".to_string());
    answer
}
