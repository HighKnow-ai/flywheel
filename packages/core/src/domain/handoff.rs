//! The hand-off and the feedback-only Check run (docs/mvp-spec.md §4.4, §2 "Story state", issue
//! #53): the two board tools that end a Story session's work. The sidecar's MCP server hosts them
//! and relays each call to the Rust core, which is what runs this module.
//!
//! - `checks_run` runs the Story's Checks for the agent's feedback. Nothing is recorded, and it
//!   takes no argument: it runs the Checks the developer wrote, never a command of the agent's.
//! - `handoff` takes the Session summary (*next session must know*, *decisions*) and the bar lines
//!   of each ADR the Story wrote (`adrs`, issue #161, ADR 0010), and needs the Task checklist to be
//!   current: written, with no Task left *doing*. Open Tasks are allowed; they only
//!   warn at review. Flywheel then runs every Check, records each result against the commit it ran
//!   against with its output tail, and moves the Story to In review whatever the results. The agent
//!   may object to a Check it thinks is wrong (`check_objections`, issue #157): each objection names
//!   a criterion by its number in the Context packet, and is kept on the review beside that Check.
//!
//! **Re-run Checks** (spec §8, issue #157) is the developer's, from the review card: the same run of
//! record without a session ([`plan_review_run`], [`run_checks`], [`complete_review_run`]), refused
//! while a session of the Story is live, recording each run against the branch's head.
//!
//! A run takes minutes, so it is split in three for a caller that must not hold the database while
//! it runs: [`plan_handoff`] / [`plan_feedback_run`] read and refuse, [`run_checks`] runs without a
//! connection, and [`complete_handoff`] writes the summary, every result, the state move and the
//! Story's review (`domain::review`, issue #155: the diff's size, the Tasks left open and the ADR
//! bar lines) in one transaction. [`hand_off`] does all three in a row.
//!
//! Identity comes from the session the call arrived on, never from an argument, and only a live
//! session may call either tool. Neither tool can edit or delete a Check: [`check::set_check`] and
//! [`check::remove_check`] are human-only.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::check_runner::{run_shell_check, ShellOutcome};
use crate::domain::check::{self, record_check_run_in_tx, CheckResult, CheckRunRecord};
use crate::domain::proposal_apply::AdrBarLines;
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

/// What a hand-off leaves: the Session summary's two fields, and the bar lines of each ADR the
/// Story wrote, which the review shows beside it (ADR 0010).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct HandoffSummary {
    pub next_session_must_know: String,
    pub decisions: String,
    pub adrs: Vec<AdrBarLines>,
    /// The agent's objections to a Check (issue #157), resolved against the criteria at plan time.
    pub check_objections: Vec<CheckObjection>,
}

/// The longest a Check objection's reason may be.
pub const MAX_OBJECTION_LEN: usize = 4_000;

/// The most Check objections one hand-off may carry.
pub const MAX_OBJECTIONS: usize = 50;

/// The handing-off agent's objection to a Check: the criterion it is on, by its number in the
/// Context packet's list (1-based), and why the agent thinks the Check is wrong.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CheckObjection {
    pub criterion: u32,
    pub why: String,
}

/// One parsed call of either tool.
#[derive(Debug, Clone, PartialEq)]
pub enum HandoffToolCall {
    ChecksRun,
    Handoff(HandoffSummary),
}

fn parse_check_objections(value: Option<&Value>) -> anyhow::Result<Vec<CheckObjection>> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .context("`check_objections` is a list of {criterion, why}")?;
    anyhow::ensure!(
        items.len() <= MAX_OBJECTIONS,
        "at most {MAX_OBJECTIONS} Check objections"
    );
    items
        .iter()
        .map(|item| {
            let criterion = item
                .get("criterion")
                .and_then(Value::as_u64)
                .filter(|n| *n >= 1)
                .and_then(|n| u32::try_from(n).ok())
                .context("each Check objection needs `criterion`: the criterion's number in your Story's list, from 1")?;
            let why = item
                .get("why")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|w| !w.is_empty())
                .context("each Check objection needs `why`: why you think the Check is wrong")?;
            anyhow::ensure!(why.chars().count() <= MAX_OBJECTION_LEN, "`why` is at most {MAX_OBJECTION_LEN} characters");
            Ok(CheckObjection { criterion, why: why.to_string() })
        })
        .collect()
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
                let decisions = field("decisions")?;
                let adrs = parse_adrs(args.get("adrs"))?;
                Ok(HandoffToolCall::Handoff(HandoffSummary {
                    next_session_must_know,
                    decisions,
                    adrs,
                    check_objections: parse_check_objections(args.get("check_objections"))?,
                }))
            }
            other => anyhow::bail!("{other:?} is not a hand-off tool"),
        }
    }
}

/// The hand-off's optional `adrs`: each ADR's path and bar lines, checked as an ADR draft's are,
/// each path at most once.
fn parse_adrs(value: Option<&Value>) -> anyhow::Result<Vec<AdrBarLines>> {
    let Some(value) = value.filter(|v| !v.is_null()) else {
        return Ok(Vec::new());
    };
    let items = value
        .as_array()
        .context("`adrs` is a list: one entry per ADR you wrote, with its path and bar lines")?;
    let mut adrs: Vec<AdrBarLines> = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let lines = AdrBarLines::from_payload_at(item, &format!("adrs[{i}]."))?;
        anyhow::ensure!(
            !adrs.iter().any(|a| a.path == lines.path),
            "adrs[{i}]: {} is listed twice; give each ADR's bar lines once",
            lines.path
        );
        adrs.push(lines);
    }
    Ok(adrs)
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
    /// The session that runs the Checks; `None` for the developer's Re-run Checks.
    pub session_id: Option<String>,
    pub project_id: String,
    pub story_id: String,
    /// The project's directory in the Story's worktree ([`Worktree::project_dir`]): the Checks run
    /// there, and the commit and the diff are read from there.
    ///
    /// [`Worktree::project_dir`]: crate::domain::worktree::Worktree::project_dir
    pub project_dir: PathBuf,
    pub checks: Vec<PlannedCheck>,
    /// A hand-off's base branch, whose diff against the branch the review records; `None` for a
    /// feedback run, which records nothing.
    pub review_base: Option<String>,
    /// A hand-off's Check objections, resolved to the Checks they are about: what the review
    /// records. An empty array otherwise.
    pub check_objections: Value,
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
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer run Checks or hand off"
    );
    Ok((story_id, project_id))
}

fn plan(
    conn: &Connection,
    session_id: Option<&str>,
    story_id: String,
    project_id: String,
    for_review: bool,
) -> anyhow::Result<CheckPlan> {
    let worktree = crate::domain::worktree::worktree_for_story(conn, &story_id)?
        .context("this Story has no worktree to run its Checks in")?;
    anyhow::ensure!(
        Path::new(&worktree.path).is_dir(),
        "this Story's worktree is missing from disk"
    );
    let project_dir = worktree.project_dir();
    anyhow::ensure!(
        project_dir.is_dir(),
        "the project's directory is missing from this Story's worktree"
    );
    let checks = check::checks_for_story(conn, &story_id)?
        .into_iter()
        .map(|c| PlannedCheck {
            check_id: c.id,
            command: c.command,
            timeout_secs: c.timeout_secs,
        })
        .collect();
    let review_base = for_review.then(|| worktree.base_branch.clone());
    Ok(CheckPlan {
        session_id: session_id.map(str::to_string),
        project_id,
        story_id,
        project_dir,
        checks,
        review_base,
        check_objections: Value::Array(Vec::new()),
    })
}

/// Plan a feedback run for session `session_id`: its Story's Checks and worktree.
pub fn plan_feedback_run(conn: &Connection, session_id: &str) -> anyhow::Result<CheckPlan> {
    let (story_id, project_id) = live_session(conn, session_id)?;
    plan(conn, Some(session_id), story_id, project_id, false)
}

/// Plan a hand-off for session `session_id`, refusing it unless the Story is Running and its Task
/// checklist is current: written, with no Task left doing. Each Check objection must name a
/// criterion that has a Check; it is resolved to that Check here, before anything runs.
pub fn plan_handoff(
    conn: &Connection,
    session_id: &str,
    check_objections: &[CheckObjection],
) -> anyhow::Result<CheckPlan> {
    let (story_id, project_id) = live_session(conn, session_id)?;
    let state: String = conn.query_row(
        "SELECT state FROM stories WHERE id = ?1",
        params![story_id],
        |r| r.get(0),
    )?;
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
    let objections = resolve_check_objections(conn, &story_id, check_objections)?;
    let mut plan = plan(conn, Some(session_id), story_id, project_id, true)?;
    plan.check_objections = objections;
    Ok(plan)
}

/// Resolve each objection's criterion number to the criterion and its Check, as the review records
/// it: `{criterion_id, check_id, command, why}`. The command is kept so a Check edited afterwards
/// can be told apart from the one the agent objected to.
fn resolve_check_objections(
    conn: &Connection,
    story_id: &str,
    objections: &[CheckObjection],
) -> anyhow::Result<Value> {
    let criteria = crate::domain::acceptance_criterion::criteria_for_story(conn, story_id)?;
    let resolved = objections
        .iter()
        .map(|o| {
            let criterion = usize::try_from(o.criterion)
                .ok()
                .and_then(|n| n.checked_sub(1))
                .and_then(|i| criteria.get(i))
                .with_context(|| {
                    format!(
                        "your Story has no criterion {}: it has {}, numbered from 1 as listed",
                        o.criterion,
                        criteria.len()
                    )
                })?;
            let check = check::check_for_criterion(conn, &criterion.id)?.with_context(|| {
                format!(
                    "criterion {} has no Check to object to: it is judged at review",
                    o.criterion
                )
            })?;
            Ok(serde_json::json!({
                "criterion_id": criterion.id,
                "check_id": check.id,
                "command": check.command,
                "why": o.why,
            }))
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    Ok(Value::Array(resolved))
}

/// Whether a session of the Story is running or blocked.
fn story_has_live_session(conn: &Connection, story_id: &str) -> anyhow::Result<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sessions WHERE story_id = ?1 AND status IN ('running', 'blocked'))",
        params![story_id],
        |r| r.get(0),
    )
    .context("failed to read the Story's sessions")
}

/// A Re-run Checks refused before anything ran or was recorded, with a reason meant for the
/// developer. Its text never carries a path or git's output, so a command may show it as is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReviewRunRefused(pub String);

impl std::fmt::Display for ReviewRunRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for ReviewRunRefused {}

/// Refuse a Re-run Checks unless the Story is In review with no live session.
fn ensure_rerunnable(conn: &Connection, story_id: &str) -> anyhow::Result<String> {
    let (state, project_id): (String, String) = conn
        .query_row(
            "SELECT state, project_id FROM stories WHERE id = ?1",
            params![story_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .with_context(|| format!("Story {story_id:?} not found"))?;
    if state != StoryState::InReview.as_str() {
        return Err(ReviewRunRefused(
            "Checks are re-run from review, and this Story is not In review.".into(),
        )
        .into());
    }
    if story_has_live_session(conn, story_id)? {
        return Err(ReviewRunRefused(
            "A session of this Story is live: stop it before re-running the Checks.".into(),
        )
        .into());
    }
    Ok(project_id)
}

/// Plan the developer's Re-run Checks of `story_id`: every Check, in its worktree, with no session.
/// Refused unless the Story is In review, and while a session of it is live.
pub fn plan_review_run(conn: &Connection, story_id: &str) -> anyhow::Result<CheckPlan> {
    let project_id = ensure_rerunnable(conn, story_id)?;
    plan(conn, None, story_id.to_string(), project_id, false)
}

/// What a Re-run Checks recorded.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewRunOutcome {
    pub project_id: String,
    pub story_id: String,
    pub batch: CheckBatch,
}

/// Record a Re-run Checks in one transaction, as the developer `actor_id`: every result against the
/// commit it ran against, and a `story.checks_rerun` event. Refused, recording nothing, if the Story
/// left review or a session went live while the Checks ran.
pub fn complete_review_run(
    conn: &mut Connection,
    actor_id: &str,
    plan: &CheckPlan,
    batch: CheckBatch,
) -> anyhow::Result<ReviewRunOutcome> {
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    crate::domain::actor::assert_human_actor_in_tx(&tx, actor_id)?;
    ensure_rerunnable(&tx, &plan.story_id)?;
    record_batch_in_tx(&tx, &batch)?;
    let epic_id: String = tx.query_row(
        "SELECT epic_id FROM stories WHERE id = ?1",
        params![plan.story_id],
        |r| r.get(0),
    )?;
    let (passed, failed, timed_out) = tally(&batch);
    record_event(
        &tx,
        &plan.project_id,
        "story",
        &plan.story_id,
        EventScope {
            story_id: Some(&plan.story_id),
            epic_id: Some(&epic_id),
        },
        actor_id,
        "story.checks_rerun",
        &serde_json::json!({
            "commit_sha": batch.commit_sha,
            "passed": passed, "failed": failed, "timed_out": timed_out,
            "label": format!("Re-ran the Checks: {passed} passed, {failed} failed, {timed_out} timed out"),
        }),
        &now(),
    )?;
    tx.commit().context("failed to record the re-run")?;
    Ok(ReviewRunOutcome {
        project_id: plan.project_id.clone(),
        story_id: plan.story_id.clone(),
        batch,
    })
}

/// Re-run Checks in one go: plan, run every Check, then record. For a caller that may hold the
/// connection for the whole run.
pub fn rerun_checks(
    conn: &mut Connection,
    actor_id: &str,
    story_id: &str,
) -> anyhow::Result<ReviewRunOutcome> {
    crate::domain::actor::assert_human_actor(conn, actor_id)?;
    let plan = plan_review_run(conn, story_id)?;
    let batch = run_checks(&plan)?;
    complete_review_run(conn, actor_id, &plan, batch)
}

/// Record every outcome of `batch` against its commit, skipping a Check the developer removed while
/// it ran: there is nothing to record it on.
fn record_batch_in_tx(tx: &rusqlite::Transaction, batch: &CheckBatch) -> anyhow::Result<()> {
    for outcome in &batch.outcomes {
        let still_there: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM checks WHERE id = ?1)",
            params![outcome.check_id],
            |r| r.get(0),
        )?;
        if !still_there {
            continue;
        }
        record_check_run_in_tx(
            tx,
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
    Ok(())
}

/// How many Checks of `batch` passed, failed and timed out.
fn tally(batch: &CheckBatch) -> (usize, usize, usize) {
    let count = |result: CheckResult| batch.outcomes.iter().filter(|o| o.result == result).count();
    (
        count(CheckResult::Passed),
        count(CheckResult::Failed),
        count(CheckResult::TimedOut),
    )
}

/// Run every planned Check from the project's directory in the worktree (its root, unless the
/// project is a subdirectory of its repository), one at a time, each to the end: a failure or a
/// timeout never stops the rest. Holds no database connection. The commit is read once, before
/// the first Check runs, and so is a hand-off's diff against its base branch.
pub fn run_checks(plan: &CheckPlan) -> anyhow::Result<CheckBatch> {
    run_checks_reporting(plan, |_, _| {})
}

/// [`run_checks`], telling `on_progress` how far it is: `(0, total)` once the commit is read and
/// before the first Check starts, then `(done, total)` after each Check ends. The review card draws
/// it as "Running 8 Checks · 3/8".
pub fn run_checks_reporting(
    plan: &CheckPlan,
    mut on_progress: impl FnMut(usize, usize),
) -> anyhow::Result<CheckBatch> {
    let total = plan.checks.len();
    let commit_sha =
        check::worktree_head(&plan.project_dir).context("could not read the branch's commit")?;
    let diff = plan
        .review_base
        .as_deref()
        .map(|base| read_review_diff(&plan.project_dir, base, &commit_sha))
        .transpose()
        .context("could not read the branch's diff against its base branch")?;
    on_progress(0, total);
    let outcomes = plan
        .checks
        .iter()
        .enumerate()
        .map(|(index, c)| {
            let started_at = now();
            let timeout = Duration::from_secs(u64::try_from(c.timeout_secs).unwrap_or(1).max(1));
            let (result, exit_code, output_tail) =
                match run_shell_check(&plan.project_dir, &c.command, timeout) {
                    Ok(run) => match run.outcome {
                        ShellOutcome::Exited(Some(0)) => {
                            (CheckResult::Passed, Some(0), run.output_tail)
                        }
                        ShellOutcome::Exited(code) => {
                            (CheckResult::Failed, code.map(i64::from), run.output_tail)
                        }
                        ShellOutcome::TimedOut => (CheckResult::TimedOut, None, run.output_tail),
                    },
                    Err(e) => (
                        CheckResult::Failed,
                        None,
                        format!("Flywheel could not start the shell: {e}"),
                    ),
                };
            let outcome = CheckOutcome {
                check_id: c.check_id.clone(),
                command: c.command.clone(),
                result,
                exit_code,
                output_tail,
                started_at,
                ended_at: now(),
            };
            on_progress(index + 1, total);
            outcome
        })
        .collect();
    Ok(CheckBatch {
        commit_sha,
        outcomes,
        diff,
    })
}

/// Write the hand-off in one transaction, as the agent: the Session summary, every Check result
/// against the commit it ran against, the move to In review, whatever the results, and the review
/// it opens, carrying the ADR bar lines.
pub fn complete_handoff(
    conn: &mut Connection,
    plan: &CheckPlan,
    handoff: &HandoffSummary,
    batch: CheckBatch,
) -> anyhow::Result<HandoffOutcome> {
    let session_id = plan
        .session_id
        .as_deref()
        .context("a hand-off runs on its session; this plan has none")?;
    let agent = agent_actor_id(conn)?;
    let tx = conn.transaction()?;
    let summary = create_summary_in_tx(
        &tx,
        session_id,
        &handoff.next_session_must_know,
        &handoff.decisions,
    )?;
    record_batch_in_tx(&tx, &batch)?;
    set_story_state_in_tx(&tx, &agent, &plan.story_id, StoryState::InReview)?;
    let epic_id: String = tx.query_row(
        "SELECT epic_id FROM stories WHERE id = ?1",
        params![plan.story_id],
        |r| r.get(0),
    )?;
    let (passed, failed, timed_out) = tally(&batch);
    record_event(
        &tx,
        &plan.project_id,
        "story",
        &plan.story_id,
        EventScope {
            story_id: Some(&plan.story_id),
            epic_id: Some(&epic_id),
        },
        &agent,
        "story.handed_off",
        &serde_json::json!({
            "session_id": session_id,
            "commit_sha": batch.commit_sha,
            "passed": passed, "failed": failed, "timed_out": timed_out,
            "label": format!("Handed off for review: {passed} Checks passed, {failed} failed, {timed_out} timed out"),
        }),
        &now(),
    )?;
    let open_tasks: i64 = tx.query_row(
        "SELECT COUNT(*) FROM tasks WHERE story_id = ?1 AND state = 'open'",
        params![plan.story_id],
        |r| r.get(0),
    )?;
    let diff = batch
        .diff
        .as_ref()
        .context("a hand-off's run reads the branch's diff; this one did not")?;
    let adr_notes = Value::Array(handoff.adrs.iter().map(AdrBarLines::to_payload).collect());
    let review_id = open_review_in_tx(
        &tx,
        &plan.project_id,
        &plan.story_id,
        Some(session_id),
        diff,
        &plan.check_objections,
        &adr_notes,
    )?;
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
pub fn hand_off_with(
    conn: &mut Connection,
    session_id: &str,
    handoff: &HandoffSummary,
) -> anyhow::Result<HandoffOutcome> {
    let plan = plan_handoff(conn, session_id, &handoff.check_objections)?;
    let batch = run_checks(&plan)?;
    complete_handoff(conn, &plan, handoff, batch)
}

/// [`hand_off_with`] a Session summary and no ADR.
pub fn hand_off(
    conn: &mut Connection,
    session_id: &str,
    next_session_must_know: &str,
    decisions: &str,
) -> anyhow::Result<HandoffOutcome> {
    let handoff = HandoffSummary {
        next_session_must_know: next_session_must_know.to_string(),
        decisions: decisions.to_string(),
        adrs: Vec::new(),
        check_objections: Vec::new(),
    };
    hand_off_with(conn, session_id, &handoff)
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
