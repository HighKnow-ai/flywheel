//! The dispatcher's pure half (phase 09, D-157, D-158): waves, the ONE ordering edge a colliding
//! pair earns, and the recorded answer to "why is this one waiting?".
//!
//! Database-reading and decision-making only — no git, no subprocess, no sleep; `now` is always a
//! parameter. Spawning, the tick and merging belong to the later dispatcher plans, which must be
//! able to call these while holding the database lock without waiting on anything.
//!
//! GSD-core, the model for the pairwise check, downgrades the WHOLE wave to sequential on any
//! collision. D-158 downgrades only the colliding pair: [`edges_for_plan`] emits one edge per
//! colliding pair and nothing for anyone else.

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::file_set::list_entries_for_task;
use crate::file_set::{collisions, entry_path, FileSetEntry};

/// The ONE Rust declaration of `dispatch_plan_tasks.state`; migration `0019_fan_out.sql`'s CHECK
/// mirrors it (single-list discipline, `WORKFLOW_STATES`). This is the dispatcher's own display
/// state, not the board's workflow column.
pub const DISPATCH_TASK_STATES: [&str; 12] = [
    "planned",
    "waiting",
    "running",
    "finished",
    "merging",
    "merged",
    "conflict",
    "needs_attention",
    "failed",
    "stopped",
    "held_by_limit",
    "skipped",
];

/// The ONE Rust declaration of `dispatch_plans.status`; migration `0019`'s CHECK mirrors it.
pub const DISPATCH_PLAN_STATES: [&str; 6] =
    ["draft", "approved", "running", "paused", "completed", "aborted"];

/// An edge written because two declared sets overlapped at approval.
pub const EDGE_CAUSE_OVERLAP: &str = "overlap";
/// An edge written because a live widen made two running/planned sets overlap (D-152).
pub const EDGE_CAUSE_WIDEN: &str = "widen";

/// One task as the edge computation sees it: its wave, its board rank (the total order edge
/// orientation is taken from) and its declared entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedTask {
    pub task_id: String,
    pub wave: u32,
    pub rank: String,
    pub entries: Vec<FileSetEntry>,
}

/// "`before` runs first, `after` waits", with the colliding paths that earned it. Each pair is
/// (entry path from `before`'s set, entry path from `after`'s set).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchEdge {
    pub before_task_id: String,
    pub after_task_id: String,
    pub cause: String,
    pub colliding_paths: Vec<(String, String)>,
}

/// The answer to "why were these two sequenced (or not)?".
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SequencingReason {
    /// A frozen edge exists: this is what was ACTED ON, whatever the sets say today.
    Sequenced {
        before_task_id: String,
        after_task_id: String,
        cause: String,
        colliding_paths: Vec<(String, String)>,
    },
    /// No edge, and the tasks are in different waves (`wave_a` is the first argument's).
    DifferentWaves { wave_a: u32, wave_b: u32 },
    /// No edge, same wave: the declared sets were disjoint.
    DisjointSets,
    /// No edge, same wave, and at least one of the two declared nothing (D-150): no declaration is
    /// no claim of disjointness, so the pair never shares a wave. Holds the undeclared task ids
    /// (one or both) in argument order, read from the same rows `readiness` refuses on.
    RunsAlone { undeclared_task_ids: Vec<String> },
    /// At least one of the two tasks is not in this plan.
    NotInPlan,
}

/// Collapse user-supplied wave numbers to a contiguous sequence starting at one, preserving
/// relative order, so "move this task to wave 5" cannot leave a hole the cursor would stall on.
pub fn normalise_waves(tasks: &mut [PlannedTask]) {
    let mut distinct: Vec<u32> = tasks.iter().map(|t| t.wave).collect();
    distinct.sort_unstable();
    distinct.dedup();
    for task in tasks.iter_mut() {
        // `distinct` holds every wave present, so the search always hits.
        task.wave = distinct.binary_search(&task.wave).map_or(task.wave, |i| i as u32 + 1);
    }
}

/// One edge per colliding pair inside a wave, oriented by board rank with task id as the
/// tie-break. Rank-then-id is a total order, so a cycle is impossible by construction rather than
/// by a check. A pair in different waves is never enumerated, and the result is independent of the
/// input order.
pub fn edges_for_plan(tasks: &[PlannedTask], fold_case: bool) -> Vec<DispatchEdge> {
    let mut order: Vec<&PlannedTask> = tasks.iter().collect();
    order.sort_by(|a, b| (a.wave, &a.rank, &a.task_id).cmp(&(b.wave, &b.rank, &b.task_id)));

    let mut edges = Vec::new();
    for (i, before) in order.iter().enumerate() {
        for after in &order[i + 1..] {
            if after.wave != before.wave {
                break; // sorted by wave first: nothing further in this slice shares it
            }
            let found = collisions(&before.entries, &after.entries, fold_case);
            if found.is_empty() {
                continue;
            }
            edges.push(DispatchEdge {
                before_task_id: before.task_id.clone(),
                after_task_id: after.task_id.clone(),
                cause: EDGE_CAUSE_OVERLAP.to_string(),
                colliding_paths: found
                    .iter()
                    .map(|c| (entry_path(c.first).to_string(), entry_path(c.second).to_string()))
                    .collect(),
            });
        }
    }
    edges
}

/// A plan's tasks with their ranks and CURRENT declared entries, ordered wave, rank, id.
pub fn planned_tasks(conn: &Connection, plan_id: &str) -> anyhow::Result<Vec<PlannedTask>> {
    let mut stmt = conn
        .prepare(
            "SELECT pt.task_id, pt.wave, t.rank
               FROM dispatch_plan_tasks pt JOIN tasks t ON t.id = pt.task_id
              WHERE pt.plan_id = ?1
              ORDER BY pt.wave, t.rank, pt.task_id",
        )
        .context("failed to prepare the planned-task read")?;
    let rows = stmt
        .query_map(params![plan_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?, r.get::<_, String>(2)?))
        })
        .context("failed to read the planned tasks")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read a planned-task row")?;
    rows.into_iter()
        .map(|(task_id, wave, rank)| {
            let entries = list_entries_for_task(conn, &task_id)?;
            Ok(PlannedTask { task_id, wave, rank, entries })
        })
        .collect()
}

/// Why were `task_a` and `task_b` sequenced? The stored edge is read FIRST, because that row is
/// what was acted on: after a live widen a recomputation and the acted-on answer differ, and the
/// user asked about the one that happened. Only with no edge does this fall back to the plan rows.
pub fn why(
    conn: &Connection,
    plan_id: &str,
    task_a: &str,
    task_b: &str,
) -> anyhow::Result<SequencingReason> {
    let edge: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT before_task_id, after_task_id, cause, colliding_paths
               FROM dispatch_edges
              WHERE plan_id = ?1
                AND ((before_task_id = ?2 AND after_task_id = ?3)
                  OR (before_task_id = ?3 AND after_task_id = ?2))",
            params![plan_id, task_a, task_b],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .context("failed to read the stored ordering edge")?;
    if let Some((before_task_id, after_task_id, cause, paths)) = edge {
        return Ok(SequencingReason::Sequenced {
            before_task_id,
            after_task_id,
            cause,
            colliding_paths: decode_paths(&paths)?,
        });
    }

    let wave_of = |task_id: &str| -> anyhow::Result<Option<u32>> {
        conn.query_row(
            "SELECT wave FROM dispatch_plan_tasks WHERE plan_id = ?1 AND task_id = ?2",
            params![plan_id, task_id],
            |r| r.get(0),
        )
        .optional()
        .context("failed to read a plan task's wave")
    };
    Ok(match (wave_of(task_a)?, wave_of(task_b)?) {
        (Some(a), Some(b)) if a != b => SequencingReason::DifferentWaves { wave_a: a, wave_b: b },
        (Some(_), Some(_)) => {
            // D-150: read the same rows `readiness` refuses on, so the explanation cannot disagree
            // with the refusal about which task declared nothing.
            let mut undeclared_task_ids = Vec::new();
            for id in [task_a, task_b] {
                if list_entries_for_task(conn, id)?.is_empty() {
                    undeclared_task_ids.push(id.to_string());
                }
            }
            if undeclared_task_ids.is_empty() {
                SequencingReason::DisjointSets
            } else {
                SequencingReason::RunsAlone { undeclared_task_ids }
            }
        }
        _ => SequencingReason::NotInPlan,
    })
}

/// The stored shape of an edge's colliding paths: a JSON array of `{before, after}` objects.
pub(crate) fn encode_paths(paths: &[(String, String)]) -> String {
    serde_json::Value::Array(
        paths.iter().map(|(b, a)| serde_json::json!({ "before": b, "after": a })).collect(),
    )
    .to_string()
}

pub(crate) fn decode_paths(raw: &str) -> anyhow::Result<Vec<(String, String)>> {
    let value: serde_json::Value =
        serde_json::from_str(raw).context("stored colliding_paths is not valid JSON")?;
    value
        .as_array()
        .context("stored colliding_paths is not an array")?
        .iter()
        .map(|p| {
            let side = |k: &str| {
                p.get(k)
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .with_context(|| format!("stored colliding path lacks `{k}`"))
            };
            Ok((side("before")?, side("after")?))
        })
        .collect()
}

/// How many agent runs hold a slot right now — running or blocked, across EVERY project, and
/// including authoring and planning runs on the same account. Database truth, not an in-memory
/// counter, so it is correct after a restart.
pub fn occupied_slots(conn: &Connection) -> anyhow::Result<u32> {
    conn.query_row(
        "SELECT COUNT(*) FROM agent_runs WHERE status IN ('running', 'blocked')",
        [],
        |r| r.get(0),
    )
    .context("failed to count occupied agent slots")
}

/// Every task in `project_id` with a currently live run, as `(task_id, entries)` ordered by task
/// id. A live task with no declared set is unarmed (D-150): its entries are EMPTY, and [`readiness`]
/// reads that as "runs alone", so it must be present here.
fn in_flight_sets(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<(String, Vec<FileSetEntry>)>> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT task_id FROM agent_runs
              WHERE project_id = ?1 AND task_id IS NOT NULL AND status IN ('running', 'blocked')
              ORDER BY task_id",
        )
        .context("failed to prepare the in-flight task read")?;
    let task_ids = stmt
        .query_map(params![project_id], |r| r.get::<_, String>(0))
        .context("failed to read the in-flight tasks")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read an in-flight task row")?;
    let mut out = Vec::new();
    for task_id in task_ids {
        let entries = list_entries_for_task(conn, &task_id)?;
        out.push((task_id, entries));
    }
    Ok(out)
}

/// The declared entries of every task in `project_id` with a currently live run, as
/// `(task_id, entries)` ordered by task id. A live task with no declared set is unarmed (D-150) and
/// has nothing to compare against, so it is absent. The widen re-check and the cross-plan
/// readiness guard are the same question asked twice.
pub fn in_flight_declared_sets(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<(String, Vec<FileSetEntry>)>> {
    Ok(in_flight_sets(conn, project_id)?.into_iter().filter(|(_, e)| !e.is_empty()).collect())
}

// ---------------------------------------------------------------------------------------------
// The decision half (phase 09 plan 09-07, D-155, D-156, D-158, PLAN-03, PLAN-06).
//
// `decide` answers "what should happen next?" from database rows and a plain-values snapshot of
// git, and does nothing else: no git, no subprocess, no sleep, no clock of its own. That is what
// makes it safe to call while holding the database lock and testable without a timer. The git
// facts it needs (is a finished worktree clean? is it ahead of its base? is an existing worktree
// older than the integration tip?) are gathered BEFORE it runs by `git_facts::observe`, from
// targets this module names (`observation_targets`) -- the read, act, write split the scheduler
// already uses for the forge poll.
//
// All state is rows, so the answer is idempotent and restart-safe by construction. Nothing here
// writes `tasks.status`: a status has exactly one owner per transition.
// ---------------------------------------------------------------------------------------------

/// Which side of a run a needs-attention cause belongs to. A task marked before its run started
/// is re-evaluated for spawning; one marked after its run ended is re-evaluated for merging.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttentionPhase {
    PreSpawn,
    PostRun,
}

impl AttentionPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            AttentionPhase::PreSpawn => "pre_spawn",
            AttentionPhase::PostRun => "post_run",
        }
    }
}

/// Why a task stopped the wave and asks for the user. Always a named cause, never a bare failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttentionCause {
    /// The run ended with work in the worktree that is not committed. Never auto-committed: that
    /// would rewrite the authorship of the agent's output.
    Uncommitted { count: usize, first: String },
    /// The run ended with no commit ahead of the integration branch.
    NoCommits { target_branch: String },
    /// An existing worktree was cut from a base that predates the integration tip. No rebase here.
    StaleBase { integration_branch: String },
    /// The launch itself failed (credentials, worktree, scope marker).
    LaunchFailed { error: String },
    /// The merge could not run (a dirty integration worktree, a missing branch, ...).
    MergeBlocked { reason: String },
    /// The close-time backstop found a change outside the declared file-set (D-REV-42). The merge is
    /// automatic and unreviewed by design (D-156), so an observed breach has to interrupt it.
    ScopeBreach { count: usize, first: String },
}

impl AttentionCause {
    pub fn phase(&self) -> AttentionPhase {
        match self {
            AttentionCause::StaleBase { .. } | AttentionCause::LaunchFailed { .. } => AttentionPhase::PreSpawn,
            _ => AttentionPhase::PostRun,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            AttentionCause::Uncommitted { .. } => "uncommitted",
            AttentionCause::NoCommits { .. } => "no_commits",
            AttentionCause::StaleBase { .. } => "stale_base",
            AttentionCause::LaunchFailed { .. } => "launch_failed",
            AttentionCause::MergeBlocked { .. } => "merge_blocked",
            AttentionCause::ScopeBreach { .. } => "scope_breach",
        }
    }

    /// The sentence the user reads.
    pub fn sentence(&self) -> String {
        match self {
            AttentionCause::Uncommitted { count, first } => format!(
                "The run finished with {count} uncommitted change(s) in its worktree (first: {first}). \
                 Uncommitted work is not on the branch, so nothing can be merged. Commit it or discard it."
            ),
            AttentionCause::NoCommits { target_branch } => format!(
                "The run finished with no commits ahead of {target_branch}, so there is nothing to merge."
            ),
            AttentionCause::StaleBase { integration_branch } => format!(
                "Its worktree was cut from a base older than the tip of {integration_branch}. The \
                 dispatcher does not rebase; bring {integration_branch} into the task branch and it will start."
            ),
            AttentionCause::LaunchFailed { error } => format!("The run could not be started: {error}"),
            AttentionCause::MergeBlocked { reason } => format!("The merge could not run: {reason}"),
            AttentionCause::ScopeBreach { count, first } => format!(
                "The run changed {count} path(s) outside its declared file-set (first: {first}), found when the \
                 session closed. An unseen out-of-scope change is not merged automatically. Review the \
                 task's diff and merge it yourself if it is fine."
            ),
        }
    }
}

/// One thing the dispatcher should do. `Spawn` is the only variant that starts a process; the
/// executor routes it through the one launch path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Spawn { plan_id: String, task_id: String },
    Merge { plan_id: String, task_id: String },
    AdvanceWave { plan_id: String },
    MarkNeedsAttention { plan_id: String, task_id: String, cause: AttentionCause },
    /// The run ended without finishing: record the dispatcher's display state (`failed`, `stopped`
    /// or `held_by_limit`).
    MarkRunEnded { plan_id: String, task_id: String, state: &'static str },
}

/// Why a task is not ready to start. Returned by [`readiness`]; `decide` acts on `BaseStale` only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadinessRefusal {
    NotCursorWave { wave: u32, cursor: u32 },
    HasLiveRun,
    NotStartable { state: String },
    /// A sequenced predecessor is not yet MERGED. Finished is not enough (D-158).
    WaitingOn { task_id: String },
    /// Its declared set overlaps a task that is running right now, in this plan or another.
    OverlapsInFlight { task_id: String, path: String },
    /// D-150: a task with no declared set makes no disjointness claim, so it never shares the
    /// project with another running task. Either THIS task is undeclared, or `task_id` (running, or
    /// chosen earlier in this same decision) is.
    RunsAlone { task_id: String },
    BaseStale { integration_branch: String },
}

/// Where the git facts for one task are to be read. Plain values: the git-running reader takes no
/// connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservationTarget {
    pub task_id: String,
    pub project_id: String,
    pub repo_path: PathBuf,
    /// `(worktree path, task branch)`; `None` while no worktree has been cut.
    pub worktree: Option<(PathBuf, String)>,
    pub integration_branch: Option<String>,
}

/// What git said about one worktree.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct WorktreeObservation {
    /// Paths of uncommitted entries (`git status --porcelain`).
    pub uncommitted: Vec<String>,
    /// Commits on the task branch not on the integration branch; `None` when it cannot be measured.
    pub commits_ahead: Option<u32>,
    /// The epic's integration branch, when it has one.
    pub integration_branch: Option<String>,
    /// `Some(integration branch)` when the integration tip is NOT contained in the task branch.
    pub stale_against: Option<String>,
}

/// The git snapshot `decide` runs against. A missing entry means "not measured this pass", and
/// `decide` then waits rather than guessing.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Observations {
    pub worktrees: HashMap<String, WorktreeObservation>,
    /// Per project: does the repository fold case (`core.ignorecase`)?
    pub case_insensitive: HashMap<String, bool>,
}

#[derive(Debug, Clone)]
struct LivePlan {
    id: String,
    status: String,
    cursor: u32,
}

#[derive(Debug, Clone)]
pub(crate) struct TaskView {
    pub(crate) task_id: String,
    pub(crate) wave: u32,
    pub(crate) state: String,
    pub(crate) project_id: String,
    pub(crate) live: bool,
    pub(crate) latest_run: Option<String>,
}

fn live_plans(conn: &Connection) -> anyhow::Result<Vec<LivePlan>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, status, wave_cursor FROM dispatch_plans
              WHERE status IN ('approved', 'running', 'paused') ORDER BY created_at, id",
        )
        .context("failed to prepare the live-plan read")?;
    let rows = stmt
        .query_map([], |r| Ok(LivePlan { id: r.get(0)?, status: r.get(1)?, cursor: r.get(2)? }))
        .context("failed to read the live plans")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read a live-plan row")?;
    Ok(rows)
}

pub(crate) fn task_views(conn: &Connection, plan_id: &str) -> anyhow::Result<Vec<TaskView>> {
    let mut stmt = conn
        .prepare(
            "SELECT pt.task_id, pt.wave, pt.state, t.project_id,
                    EXISTS (SELECT 1 FROM agent_runs r
                             WHERE r.task_id = pt.task_id AND r.status IN ('running', 'blocked')),
                    (SELECT r.status FROM agent_runs r WHERE r.task_id = pt.task_id
                      ORDER BY r.started_at DESC, r.id DESC LIMIT 1)
               FROM dispatch_plan_tasks pt JOIN tasks t ON t.id = pt.task_id
              WHERE pt.plan_id = ?1 ORDER BY pt.wave, t.rank, pt.task_id",
        )
        .context("failed to prepare the plan-task view read")?;
    let rows = stmt
        .query_map(params![plan_id], |r| {
            Ok(TaskView {
                task_id: r.get(0)?,
                wave: r.get(1)?,
                state: r.get(2)?,
                project_id: r.get(3)?,
                live: r.get::<_, i64>(4)? != 0,
                latest_run: r.get(5)?,
            })
        })
        .context("failed to read the plan-task views")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read a plan-task view row")?;
    Ok(rows)
}

/// The most recent needs-attention record for a task in a plan: `(phase, kind, sentence)`.
pub fn attention_for(
    conn: &Connection,
    plan_id: &str,
    task_id: &str,
) -> anyhow::Result<Option<(AttentionPhase, String, String)>> {
    let payload: Option<String> = conn
        .query_row(
            "SELECT payload FROM events
              WHERE task_id = ?1 AND event_type = ?2 AND json_extract(payload, '$.plan_id') = ?3
              ORDER BY sequence DESC LIMIT 1",
            params![task_id, crate::domain::dispatch_plan::EVENT_TASK_NEEDS_ATTENTION, plan_id],
            |r| r.get(0),
        )
        .optional()
        .context("failed to read the task's needs-attention record")?;
    let Some(payload) = payload else { return Ok(None) };
    let value: serde_json::Value =
        serde_json::from_str(&payload).context("needs-attention payload is not JSON")?;
    let phase = match value["phase"].as_str() {
        Some("pre_spawn") => AttentionPhase::PreSpawn,
        _ => AttentionPhase::PostRun,
    };
    Ok(Some((
        phase,
        value["kind"].as_str().unwrap_or_default().to_string(),
        value["cause"].as_str().unwrap_or_default().to_string(),
    )))
}

/// The three dispatch states that hold a wave until a human acts (D-REV-41): a run that failed, a run
/// that was stopped, and an automatic merge that found conflicts. `retry_task` and `skip_task` act on
/// exactly these and refuse everything else; the renderer offers its two buttons on the same three.
pub const STUCK_STATES: [&str; 3] = ["failed", "stopped", "conflict"];

/// Why a task in one of the [`STUCK_STATES`] is stuck, in the sentence the user reads: the sibling of
/// [`attention_for`], which answers the same question for `needs_attention`. These three states
/// write no needs-attention record, so the words are composed here from the state and, for a
/// conflict, from the merge's own aborted record. `None` for any other state.
pub fn stuck_cause(conn: &Connection, task_id: &str, state: &str) -> anyhow::Result<Option<String>> {
    const WAY_OUT: &str = "Retry starts it again; Skip leaves it out so the wave can move on.";
    Ok(match state {
        "failed" => Some(format!("The run failed, so this task holds its wave. {WAY_OUT}")),
        "stopped" => Some(format!(
            "The run was stopped before it finished (it was interrupted, or the application closed), so \
             this task holds its wave. {WAY_OUT}"
        )),
        "conflict" => {
            let payload: Option<String> = conn
                .query_row(
                    "SELECT payload FROM events WHERE task_id = ?1 AND event_type = ?2
                      ORDER BY sequence DESC LIMIT 1",
                    params![task_id, crate::merge::EVENT_MERGE_ABORTED],
                    |r| r.get(0),
                )
                .optional()
                .context("failed to read the task's merge-conflict record")?;
            let value: serde_json::Value =
                payload.and_then(|p| serde_json::from_str(&p).ok()).unwrap_or(serde_json::Value::Null);
            let target = value["target_branch"].as_str().unwrap_or("the integration branch");
            let files: Vec<&str> =
                value["conflicted_files"].as_array().map(|a| a.iter().filter_map(|f| f.as_str()).collect()).unwrap_or_default();
            let named = match files.as_slice() {
                [] => "conflicts".to_string(),
                [one] => format!("a conflict in {one}"),
                many => {
                    let shown = many.iter().take(3).copied().collect::<Vec<_>>().join(", ");
                    let more = many.len().saturating_sub(3);
                    format!("{} conflicting files ({shown}{})", many.len(), if more > 0 { format!(" and {more} more") } else { String::new() })
                }
            };
            Some(format!(
                "Merging into {target} found {named}, so nothing landed. Resolve it in the task's worktree and \
                 Retry to merge again, or Skip to leave the task out so the wave can move on."
            ))
        }
        _ => None,
    })
}

/// Is every task in `wave` merged or skipped? Merged, NOT finished: worktrees are cut lazily at
/// spawn from the epic integration tip, so a wave that advanced on "finished" would branch the next
/// wave from a base without the last wave's work. A wave with no tasks is drained.
pub fn wave_is_drained(conn: &Connection, plan_id: &str, wave: u32) -> anyhow::Result<bool> {
    let open: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM dispatch_plan_tasks
              WHERE plan_id = ?1 AND wave = ?2 AND state NOT IN ('merged', 'skipped')",
            params![plan_id, wave],
            |r| r.get(0),
        )
        .context("failed to count the undrained tasks of a wave")?;
    Ok(open == 0)
}

/// Did the USER start this task's most recent run, after this plan came to exist? `dispatch_plan_tasks.
/// state` is written only by the dispatcher, so a run the user started by hand leaves the task in
/// `planned` (or `waiting`) once it ends, where [`is_startable`] would start it a second time
/// (D-REV-39 WR-05). The run's own trigger says who fired it: a human-initiated one is the user's,
/// and a dispatcher-initiated one is the SYSTEM actor's (`start_agent_run`). A run older than the
/// plan is history, not a claim on the task, so the plan still starts it.
pub(crate) fn manual_run_since_plan(conn: &Connection, plan_id: &str, task_id: &str) -> anyhow::Result<bool> {
    conn.query_row(
        "SELECT EXISTS (
            SELECT 1
              FROM (SELECT trigger_id, started_at FROM agent_runs WHERE task_id = ?2
                     ORDER BY started_at DESC, id DESC LIMIT 1) latest
              JOIN triggers tr ON tr.id = latest.trigger_id
              JOIN actors a ON a.id = tr.created_by
             WHERE a.type = 'human'
               AND latest.started_at >= (SELECT created_at FROM dispatch_plans WHERE id = ?1)
               -- A retry is the user handing the task back to the dispatcher (D-REV-41): without this
               -- clause the failed hand-run it follows would be adopted again and the retry would do
               -- nothing.
               AND NOT EXISTS (
                   SELECT 1 FROM events e
                    WHERE e.task_id = ?2 AND e.event_type = ?3
                      AND json_extract(e.payload, '$.plan_id') = ?1
                      AND e.occurred_at >= latest.started_at))",
        params![plan_id, task_id, crate::domain::dispatch_plan::EVENT_TASK_RETRIED],
        |r| r.get(0),
    )
    .context("failed to read whether the user ran the task by hand")
}

pub(crate) fn is_startable(conn: &Connection, plan_id: &str, t: &TaskView) -> anyhow::Result<bool> {
    Ok(match t.state.as_str() {
        "planned" | "waiting" | "held_by_limit" => !manual_run_since_plan(conn, plan_id, &t.task_id)?,
        // `running` with no run row at all: the process died between the state write and the run row.
        "running" => t.latest_run.is_none(),
        "needs_attention" => matches!(
            attention_for(conn, plan_id, &t.task_id)?,
            Some((AttentionPhase::PreSpawn, ..))
        ),
        _ => false,
    })
}

/// May `t` start now, ignoring the cap, the gate and the plan's own pause? The one readiness rule:
/// right wave, no live run, every sequenced predecessor MERGED or skipped, no overlap with anything
/// running in the same project (this plan's or another's), and a worktree base that contains the
/// integration tip.
#[allow(clippy::too_many_arguments)]
fn readiness(
    conn: &Connection,
    plan: &LivePlan,
    t: &TaskView,
    tasks: &[TaskView],
    edges: &[DispatchEdge],
    taken: &[(String, String, Vec<FileSetEntry>)],
    obs: &Observations,
) -> anyhow::Result<Result<(), ReadinessRefusal>> {
    if t.wave != plan.cursor {
        return Ok(Err(ReadinessRefusal::NotCursorWave { wave: t.wave, cursor: plan.cursor }));
    }
    if t.live {
        return Ok(Err(ReadinessRefusal::HasLiveRun));
    }
    if !is_startable(conn, &plan.id, t)? {
        return Ok(Err(ReadinessRefusal::NotStartable { state: t.state.clone() }));
    }
    for edge in edges.iter().filter(|e| e.after_task_id == t.task_id) {
        let merged = tasks
            .iter()
            .find(|p| p.task_id == edge.before_task_id)
            .is_some_and(|p| matches!(p.state.as_str(), "merged" | "skipped"));
        if !merged {
            return Ok(Err(ReadinessRefusal::WaitingOn { task_id: edge.before_task_id.clone() }));
        }
    }
    let fold = obs.case_insensitive.get(&t.project_id).copied().unwrap_or(false);
    if let Some(refusal) = launch_conflict(conn, &t.task_id, &t.project_id, fold, taken)? {
        return Ok(Err(refusal));
    }
    if let Some(stale) = obs.worktrees.get(&t.task_id).and_then(|o| o.stale_against.clone()) {
        return Ok(Err(ReadinessRefusal::BaseStale { integration_branch: stale }));
    }
    Ok(Ok(()))
}

/// May `task_id` put its declared set in flight right now? `None` means yes.
///
/// This is the ONE implementation of the launch-time disjointness rule. [`readiness`] calls it for
/// the dispatcher's decision, and every other path that starts an agent (the shared launch body, a
/// user's own launch, any future caller) must call this same function rather than restate the loop.
/// A verdict taken under the lock is acted on after the lock is released, so the re-check at the
/// launch is this function again, not a copy.
///
/// It answers with the existing [`ReadinessRefusal`] vocabulary: the task already has a live run
/// ([`ReadinessRefusal::HasLiveRun`]); either side declared nothing (D-150,
/// [`ReadinessRefusal::RunsAlone`]); or the sets collide ([`ReadinessRefusal::OverlapsInFlight`],
/// naming the other task and the colliding path). It reads the stored rows through
/// `list_entries_for_task`, never the enforcement marker file, so a set widened mid-flight is seen.
/// Overlap goes through `collisions`, the same predicate the pre-write hook reaches through the
/// shim, so there is exactly one containment implementation.
///
/// `fold_case` is a parameter, not a probe: resolving it runs git, and this function must be
/// callable while the database lock is held. `taken` is the `(project, task, entries)` of tasks
/// already chosen earlier in the same decision, compared against as though live.
///
/// The rule lives in code rather than in a schema constraint because it is a cross-row predicate
/// over a child table (disjointness between two different tasks' file sets), which no uniqueness
/// constraint can state.
pub fn launch_conflict(
    conn: &Connection,
    task_id: &str,
    project_id: &str,
    fold_case: bool,
    taken: &[(String, String, Vec<FileSetEntry>)],
) -> anyhow::Result<Option<ReadinessRefusal>> {
    let live: bool = conn
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM agent_runs WHERE task_id = ?1 AND status IN ('running', 'blocked'))",
            params![task_id],
            |r| r.get(0),
        )
        .context("failed to read whether the task has a live run")?;
    if live {
        return Ok(Some(ReadinessRefusal::HasLiveRun));
    }
    let entries = list_entries_for_task(conn, task_id)?;
    // Read from the rows, not the marker file; includes a set widened mid-flight (09-06).
    let mut others = in_flight_sets(conn, project_id)?;
    others.extend(
        taken.iter().filter(|(p, ..)| p == project_id).map(|(_, id, e)| (id.clone(), e.clone())),
    );
    for (other_id, other_entries) in others.iter().filter(|(id, _)| id != task_id) {
        // D-150, enforced HERE because every launch the dispatcher makes (any plan, any caller that
        // built or edited or approved it) is decided by this one function. An empty set on either
        // side is no claim of disjointness: the pair never runs together. The hook stays disarmed
        // for the undeclared task; it is sequenced, not refused writes.
        if entries.is_empty() || other_entries.is_empty() {
            return Ok(Some(ReadinessRefusal::RunsAlone { task_id: other_id.clone() }));
        }
        if let Some(c) = collisions(&entries, other_entries, fold_case).first() {
            return Ok(Some(ReadinessRefusal::OverlapsInFlight {
                task_id: other_id.clone(),
                path: entry_path(c.first).to_string(),
            }));
        }
    }
    Ok(None)
}

/// The tasks of `plan_id` that could start right now, ignoring the cap, the gate and the plan's own
/// pause. Board order.
pub fn ready_tasks(conn: &Connection, plan_id: &str, obs: &Observations) -> anyhow::Result<Vec<String>> {
    let Some(plan) = live_plans(conn)?.into_iter().find(|p| p.id == plan_id) else {
        return Ok(Vec::new());
    };
    let tasks = task_views(conn, plan_id)?;
    let edges = crate::domain::dispatch_plan::read_edges(conn, plan_id)?;
    let mut ready = Vec::new();
    for t in &tasks {
        if readiness(conn, &plan, t, &tasks, &edges, &[], obs)?.is_ok() {
            ready.push(t.task_id.clone());
        }
    }
    Ok(ready)
}

/// Where git must be read for the next `decide`: every task of a live plan's cursor wave that is not
/// finished with and has no live run (a live run needs no git facts). Database-only.
pub fn observation_targets(conn: &Connection) -> anyhow::Result<Vec<ObservationTarget>> {
    let mut targets = Vec::new();
    for plan in live_plans(conn)? {
        for t in task_views(conn, &plan.id)? {
            if t.wave != plan.cursor || t.live {
                continue;
            }
            if matches!(t.state.as_str(), "merged" | "skipped" | "conflict" | "failed" | "stopped") {
                continue;
            }
            let (repo_path, integration_branch): (String, Option<String>) = conn
                .query_row(
                    "SELECT p.repo_path, e.integration_branch
                       FROM tasks t JOIN projects p ON p.id = t.project_id
                       LEFT JOIN epics e ON e.id = t.epic_id WHERE t.id = ?1",
                    params![t.task_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .with_context(|| format!("task {:?} not found", t.task_id))?;
            let worktree: Option<(String, String)> = conn
                .query_row(
                    "SELECT path, branch FROM worktrees WHERE task_id = ?1",
                    params![t.task_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .context("failed to read a task's worktree")?;
            targets.push(ObservationTarget {
                task_id: t.task_id,
                project_id: t.project_id,
                repo_path: PathBuf::from(repo_path),
                worktree: worktree.map(|(p, b)| (PathBuf::from(p), b)),
                integration_branch,
            });
        }
    }
    Ok(targets)
}

/// The paths the close-time backstop found outside the declared set in the task's most recent run.
/// An earlier run's breach belongs to that run: a retried task is judged on its own run.
fn breach_paths_of_latest_run(conn: &Connection, task_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT json_extract(payload, '$.path') FROM events
              WHERE task_id = ?1 AND event_type = ?2
                AND json_extract(payload, '$.detected_after_the_fact') = 1
                AND json_extract(payload, '$.run_id') =
                    (SELECT id FROM agent_runs WHERE task_id = ?1 ORDER BY started_at DESC, id DESC LIMIT 1)
              ORDER BY sequence",
        )
        .context("failed to prepare the scope-breach read")?;
    let paths = stmt
        .query_map(params![task_id, crate::domain::file_set::EVENT_SCOPE_DENIED], |r| r.get::<_, String>(0))
        .context("failed to read the scope breaches")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read a scope-breach row")?;
    Ok(paths)
}

/// A finished run's next step: merge it, or stop the wave and say why.
fn after_completed_run(
    conn: &Connection,
    plan_id: &str,
    t: &TaskView,
    obs: &Observations,
    out: &mut Vec<Action>,
) -> anyhow::Result<()> {
    let Some(seen) = obs.worktrees.get(&t.task_id) else { return Ok(()) };
    let already_marked = t.state == "needs_attention";
    let mark = |cause: AttentionCause| Action::MarkNeedsAttention {
        plan_id: plan_id.to_string(),
        task_id: t.task_id.clone(),
        cause,
    };
    if let Some(first) = seen.uncommitted.first() {
        if !already_marked {
            out.push(mark(AttentionCause::Uncommitted { count: seen.uncommitted.len(), first: first.clone() }));
        }
        return Ok(());
    }
    // D-REV-42: an out-of-scope write the backstop found in the LATEST run holds the merge for a
    // human. A recorded merge means a person already looked (the Phase 8 path), so it is not held
    // again. ponytail: Bash writes are still only detected, not prevented; that half stays open.
    if crate::merge::integrated_merge_commit(conn, &t.task_id)?.is_none() {
        let breaches = breach_paths_of_latest_run(conn, &t.task_id)?;
        if let Some(first) = breaches.first() {
            if !already_marked {
                out.push(mark(AttentionCause::ScopeBreach { count: breaches.len(), first: first.clone() }));
            }
            return Ok(());
        }
    }
    match seen.commits_ahead {
        None => {}
        Some(0) => {
            // Zero ahead is "already merged" when a merge was recorded (a crash between the merge and
            // its state write, or the user's own merge); otherwise the run produced nothing.
            if crate::merge::integrated_merge_commit(conn, &t.task_id)?.is_some() {
                out.push(Action::Merge { plan_id: plan_id.to_string(), task_id: t.task_id.clone() });
            } else if !already_marked {
                let target_branch =
                    seen.integration_branch.clone().unwrap_or_else(|| "the integration branch".into());
                out.push(mark(AttentionCause::NoCommits { target_branch }));
            }
        }
        Some(_) => out.push(Action::Merge { plan_id: plan_id.to_string(), task_id: t.task_id.clone() }),
    }
    Ok(())
}

/// What should happen next. See the section comment above. `now_epoch_secs` is injected.
///
/// Order of evaluation: the gate, the cap budget (`cap - occupied`, floored at zero: a user's own
/// launches can put the live count above the cap and the only response is to spawn nothing), then
/// per live plan the finished runs (merge or ask), the ready tasks (spawn up to the budget) and the
/// wave boundary. A paused gate or paused plan spawns nothing; merges still proceed.
pub fn decide(conn: &Connection, now_epoch_secs: i64, obs: &Observations) -> anyhow::Result<Vec<Action>> {
    let gate = crate::limit_gate::read_gate(conn, now_epoch_secs)?;
    let cap = crate::domain::settings::dispatch_max_parallel(conn)? as usize;
    let mut budget = cap.saturating_sub(occupied_slots(conn)? as usize);
    let mut out = Vec::new();
    let mut taken: Vec<(String, String, Vec<FileSetEntry>)> = Vec::new();

    for plan in live_plans(conn)? {
        let tasks = task_views(conn, &plan.id)?;
        let edges = crate::domain::dispatch_plan::read_edges(conn, &plan.id)?;
        let paused = plan.status == "paused";

        for t in tasks.iter().filter(|t| t.wave <= plan.cursor && !t.live) {
            let completed = t.latest_run.as_deref() == Some("completed");
            // A run the user started by hand is ADOPTED, not repeated: its task reads as `running`
            // here, so its ending is handled exactly as a dispatcher run's is (merge it, or record
            // that it failed or stopped). D-REV-39 WR-05; `is_startable` is the other half.
            let adopted = matches!(t.state.as_str(), "planned" | "waiting" | "held_by_limit")
                && t.latest_run.is_some()
                && manual_run_since_plan(conn, &plan.id, &t.task_id)?;
            match if adopted { "running" } else { t.state.as_str() } {
                "running" | "merging" => match t.latest_run.as_deref() {
                    Some("completed") => after_completed_run(conn, &plan.id, t, obs, &mut out)?,
                    Some(status @ ("failed" | "interrupted" | "abandoned")) => {
                        let state = match status {
                            "interrupted" => "stopped",
                            "failed" if matches!(gate, crate::limit_gate::GateState::Paused { .. }) => "held_by_limit",
                            _ => "failed",
                        };
                        out.push(Action::MarkRunEnded { plan_id: plan.id.clone(), task_id: t.task_id.clone(), state });
                    }
                    _ => {}
                },
                "needs_attention" if completed => {
                    if matches!(attention_for(conn, &plan.id, &t.task_id)?, Some((AttentionPhase::PostRun, ..))) {
                        after_completed_run(conn, &plan.id, t, obs, &mut out)?;
                    }
                }
                _ => {}
            }
        }

        if !paused && crate::limit_gate::may_spawn(&gate) {
            for t in &tasks {
                match readiness(conn, &plan, t, &tasks, &edges, &taken, obs)? {
                    Ok(()) if budget > 0 => {
                        budget -= 1;
                        taken.push((t.project_id.clone(), t.task_id.clone(), list_entries_for_task(conn, &t.task_id)?));
                        out.push(Action::Spawn { plan_id: plan.id.clone(), task_id: t.task_id.clone() });
                    }
                    Err(ReadinessRefusal::BaseStale { integration_branch }) if t.state != "needs_attention" => {
                        out.push(Action::MarkNeedsAttention {
                            plan_id: plan.id.clone(),
                            task_id: t.task_id.clone(),
                            cause: AttentionCause::StaleBase { integration_branch },
                        });
                    }
                    _ => {}
                }
            }
        }

        if !paused && crate::limit_gate::may_advance(&gate) && wave_is_drained(conn, &plan.id, plan.cursor)? {
            out.push(Action::AdvanceWave { plan_id: plan.id.clone() });
        }
    }
    Ok(out)
}
