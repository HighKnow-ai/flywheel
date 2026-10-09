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
        (Some(_), Some(_)) => SequencingReason::DisjointSets,
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

/// The declared entries of every task in `project_id` with a currently live run, as
/// `(task_id, entries)` ordered by task id. A live task with no declared set is unarmed (D-150)
/// and has nothing to compare against, so it is absent. The widen re-check and the cross-plan
/// readiness guard are the same question asked twice.
pub fn in_flight_declared_sets(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<(String, Vec<FileSetEntry>)>> {
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
        if !entries.is_empty() {
            out.push((task_id, entries));
        }
    }
    Ok(out)
}
