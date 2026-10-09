//! A fan-out's stored plan (phase 09, D-157, D-158): `dispatch_plans`, `dispatch_plan_tasks` and
//! `dispatch_edges` CRUD in the `*_in_tx` style so a caller composes, plus [`approve_plan`] — the
//! one transaction that matters.
//!
//! [`approve_plan`] normalises the waves, computes the ordering edges, writes every edge with its
//! colliding paths FROZEN as stored JSON, appends one `task.sequenced` event per edge and the
//! plan-approved event, and flips the status — all of it or none of it. The frozen
//! `colliding_paths` column is what makes "why is this one waiting?" answerable a week later and
//! after a live widen: a recomputation is not a record.
//!
//! This module writes no `tasks.status`. A status has exactly one owner per transition, and the
//! wave-plan state here is the dispatcher's own display, not the board's workflow column.

use anyhow::{anyhow, bail, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::dispatch::{
    decode_paths, edges_for_plan, encode_paths, normalise_waves, planned_tasks, DispatchEdge,
    DISPATCH_PLAN_STATES, DISPATCH_TASK_STATES,
};
use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;

/// Appended once per ordering edge, attributed to the WAITING task (the one a user asks about).
pub const EVENT_TASK_SEQUENCED: &str = "task.sequenced";
/// Appended once when a plan is approved.
pub const EVENT_DISPATCH_PLAN_APPROVED: &str = "dispatch_plan.approved";

/// One task as supplied to [`replace_plan_tasks_in_tx`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanTaskInput {
    pub task_id: String,
    pub wave: u32,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanTaskRow {
    pub task_id: String,
    pub wave: u32,
    pub state: String,
    pub rationale: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchPlan {
    pub id: String,
    pub epic_id: String,
    pub status: String,
    pub wave_cursor: u32,
    pub tasks: Vec<PlanTaskRow>,
}

/// Create an empty `draft` plan for `epic_id`. A second live plan for one epic is refused by the
/// partial unique index, not by code here.
pub fn create_draft_plan_in_tx(
    tx: &Transaction,
    epic_id: &str,
    planning_run_id: Option<&str>,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<String> {
    let id = new_id();
    tx.execute(
        "INSERT INTO dispatch_plans
             (id, epic_id, planning_run_id, status, wave_cursor, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'draft', 1, ?4, ?5, ?5)",
        params![id, epic_id, planning_run_id, actor_id, now],
    )
    .with_context(|| format!("failed to create a draft plan for epic {epic_id:?}"))?;
    Ok(id)
}

/// Replace a DRAFT plan's task rows. Every task must belong to the plan's epic and every wave must
/// be at least one; all of it is checked before anything is deleted.
pub fn replace_plan_tasks_in_tx(
    tx: &Transaction,
    plan_id: &str,
    tasks: &[PlanTaskInput],
) -> anyhow::Result<()> {
    let (epic_id, status): (String, String) = tx
        .query_row(
            "SELECT epic_id, status FROM dispatch_plans WHERE id = ?1",
            params![plan_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .with_context(|| format!("plan {plan_id:?} not found"))?;
    if status != "draft" {
        bail!("plan {plan_id:?} is {status}; only a draft plan's tasks can be replaced");
    }
    for task in tasks {
        if task.wave < 1 {
            bail!("task {:?} was given wave {}; waves start at 1", task.task_id, task.wave);
        }
        let task_epic: Option<Option<String>> = tx
            .query_row("SELECT epic_id FROM tasks WHERE id = ?1", params![task.task_id], |r| r.get(0))
            .optional()
            .context("failed to read a plan task's epic")?;
        match task_epic {
            None => bail!("task {:?} not found", task.task_id),
            Some(e) if e.as_deref() != Some(epic_id.as_str()) => {
                bail!("task {:?} does not belong to the plan's epic", task.task_id)
            }
            Some(_) => {}
        }
    }
    tx.execute("DELETE FROM dispatch_plan_tasks WHERE plan_id = ?1", params![plan_id])
        .context("failed to clear the previous plan tasks")?;
    for task in tasks {
        tx.execute(
            "INSERT INTO dispatch_plan_tasks (plan_id, task_id, wave, state, rationale)
             VALUES (?1, ?2, ?3, 'planned', ?4)",
            params![plan_id, task.task_id, task.wave, task.rationale],
        )
        .with_context(|| format!("failed to store plan task {:?}", task.task_id))?;
    }
    Ok(())
}

/// Write one ordering edge with its colliding paths frozen. Used by approval (`overlap`) and by
/// the live widen path (`widen`). A pair already ordered in this plan is a UNIQUE violation.
pub fn insert_edge_in_tx(
    tx: &Transaction,
    plan_id: &str,
    edge: &DispatchEdge,
    now: &str,
) -> anyhow::Result<()> {
    tx.execute(
        "INSERT INTO dispatch_edges
             (id, plan_id, before_task_id, after_task_id, cause, colliding_paths, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            new_id(),
            plan_id,
            edge.before_task_id,
            edge.after_task_id,
            edge.cause,
            encode_paths(&edge.colliding_paths),
            now
        ],
    )
    .with_context(|| {
        format!("failed to store the edge {:?} -> {:?}", edge.before_task_id, edge.after_task_id)
    })?;
    Ok(())
}

/// Approve a draft plan. Case-folding is read from the epic's repository (`core.ignorecase`)
/// BEFORE the write transaction opens, so no subprocess runs while the lock is held.
pub fn approve_plan(conn: &mut Connection, plan_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let repo_path: String = conn
        .query_row(
            "SELECT pr.repo_path FROM dispatch_plans p
               JOIN epics e ON e.id = p.epic_id JOIN projects pr ON pr.id = e.project_id
              WHERE p.id = ?1",
            params![plan_id],
            |r| r.get(0),
        )
        .with_context(|| format!("plan {plan_id:?} not found"))?;
    let fold_case = crate::domain::file_set::repo_is_case_insensitive(std::path::Path::new(&repo_path));
    approve_plan_with(conn, plan_id, actor_id, fold_case, &Utc::now().to_rfc3339())
}

/// [`approve_plan`] with the case-fold flag and clock supplied.
pub fn approve_plan_with(
    conn: &mut Connection,
    plan_id: &str,
    actor_id: &str,
    fold_case: bool,
    now: &str,
) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    let (epic_id, status, project_id): (String, String, String) = tx
        .query_row(
            "SELECT p.epic_id, p.status, e.project_id FROM dispatch_plans p
               JOIN epics e ON e.id = p.epic_id WHERE p.id = ?1",
            params![plan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .with_context(|| format!("plan {plan_id:?} not found"))?;
    if status != "draft" {
        bail!("plan {plan_id:?} is {status}; only a draft plan can be approved");
    }

    let mut tasks = planned_tasks(&tx, plan_id)?;
    normalise_waves(&mut tasks);
    for task in &tasks {
        tx.execute(
            "UPDATE dispatch_plan_tasks SET wave = ?1 WHERE plan_id = ?2 AND task_id = ?3",
            params![task.wave, plan_id, task.task_id],
        )
        .context("failed to store a normalised wave")?;
    }

    let edges = edges_for_plan(&tasks, fold_case);
    for edge in &edges {
        insert_edge_in_tx(&tx, plan_id, edge, now)?;
        append_sequenced_event(&tx, &project_id, &epic_id, plan_id, edge, actor_id, now)?;
    }

    let wave_count = tasks.iter().map(|t| t.wave).max().unwrap_or(0);
    let sequence = next_sequence(&tx, &project_id, "local")?;
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "dispatch_plan",
        plan_id,
        None,
        Some(&epic_id),
        actor_id,
        EVENT_DISPATCH_PLAN_APPROVED,
        &serde_json::json!({
            "field": "dispatch_plan",
            "plan_id": plan_id,
            "task_count": tasks.len(),
            "edge_count": edges.len(),
            "wave_count": wave_count,
            "label": format!(
                "Approved a fan-out of {} tasks in {} waves, {} ordered",
                tasks.len(), wave_count, edges.len()
            ),
        }),
        now,
    )?;

    tx.execute(
        "UPDATE dispatch_plans SET status = 'approved', updated_at = ?1 WHERE id = ?2",
        params![now, plan_id],
    )
    .context("failed to mark the plan approved")?;
    tx.commit().context("failed to commit the plan approval")?;
    Ok(())
}

fn append_sequenced_event(
    tx: &Transaction,
    project_id: &str,
    epic_id: &str,
    plan_id: &str,
    edge: &DispatchEdge,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    let key = |task_id: &str| -> anyhow::Result<String> {
        tx.query_row("SELECT key FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0))
            .with_context(|| format!("task {task_id:?} not found"))
    };
    let mut shown: Vec<&str> =
        edge.colliding_paths.iter().take(3).map(|(_, after)| after.as_str()).collect();
    shown.dedup();
    let more = edge.colliding_paths.len().saturating_sub(3);
    let label = format!(
        "Waits for {}: both declare {}{}",
        key(&edge.before_task_id)?,
        shown.join(", "),
        if more > 0 { format!(" and {more} more") } else { String::new() },
    );
    let sequence = next_sequence(tx, project_id, "local")?;
    append_event(
        tx,
        project_id,
        "local",
        sequence,
        "task",
        &edge.after_task_id,
        Some(&edge.after_task_id),
        Some(epic_id),
        actor_id,
        EVENT_TASK_SEQUENCED,
        &serde_json::json!({
            "field": "sequenced",
            "plan_id": plan_id,
            "before_task_id": edge.before_task_id,
            "after_task_id": edge.after_task_id,
            "cause": edge.cause,
            "colliding_paths": edge
                .colliding_paths
                .iter()
                .map(|(b, a)| serde_json::json!({ "before": b, "after": a }))
                .collect::<Vec<_>>(),
            "label": label,
        }),
        now,
    )?;
    Ok(())
}

/// Set a plan's status. Only the declared vocabulary is accepted.
pub fn set_plan_status(conn: &Connection, plan_id: &str, status: &str) -> anyhow::Result<()> {
    if !DISPATCH_PLAN_STATES.contains(&status) {
        return Err(anyhow!("{status:?} is not a plan status"));
    }
    let changed = conn
        .execute(
            "UPDATE dispatch_plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, Utc::now().to_rfc3339(), plan_id],
        )
        .context("failed to set the plan status")?;
    if changed == 0 {
        bail!("plan {plan_id:?} not found");
    }
    Ok(())
}

/// Set one plan task's dispatcher display state. Never touches the board's `tasks.status`.
pub fn set_task_dispatch_state(
    conn: &Connection,
    plan_id: &str,
    task_id: &str,
    state: &str,
) -> anyhow::Result<()> {
    if !DISPATCH_TASK_STATES.contains(&state) {
        return Err(anyhow!("{state:?} is not a dispatch task state"));
    }
    let changed = conn
        .execute(
            "UPDATE dispatch_plan_tasks SET state = ?1 WHERE plan_id = ?2 AND task_id = ?3",
            params![state, plan_id, task_id],
        )
        .context("failed to set the dispatch task state")?;
    if changed == 0 {
        bail!("task {task_id:?} is not in plan {plan_id:?}");
    }
    Ok(())
}

/// Read a plan and its task rows (ordered wave, board rank, task id).
pub fn read_plan(conn: &Connection, plan_id: &str) -> anyhow::Result<Option<DispatchPlan>> {
    let head: Option<(String, String, u32)> = conn
        .query_row(
            "SELECT epic_id, status, wave_cursor FROM dispatch_plans WHERE id = ?1",
            params![plan_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()
        .context("failed to read the plan")?;
    let Some((epic_id, status, wave_cursor)) = head else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT pt.task_id, pt.wave, pt.state, pt.rationale
               FROM dispatch_plan_tasks pt JOIN tasks t ON t.id = pt.task_id
              WHERE pt.plan_id = ?1 ORDER BY pt.wave, t.rank, pt.task_id",
        )
        .context("failed to prepare the plan-task read")?;
    let tasks = stmt
        .query_map(params![plan_id], |r| {
            Ok(PlanTaskRow {
                task_id: r.get(0)?,
                wave: r.get(1)?,
                state: r.get(2)?,
                rationale: r.get(3)?,
            })
        })
        .context("failed to read the plan tasks")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read a plan-task row")?;
    Ok(Some(DispatchPlan { id: plan_id.to_string(), epic_id, status, wave_cursor, tasks }))
}

/// A plan's stored edges in the order they were written, with the paths as frozen at the time.
pub fn read_edges(conn: &Connection, plan_id: &str) -> anyhow::Result<Vec<DispatchEdge>> {
    let mut stmt = conn
        .prepare(
            "SELECT before_task_id, after_task_id, cause, colliding_paths
               FROM dispatch_edges WHERE plan_id = ?1 ORDER BY rowid",
        )
        .context("failed to prepare the edge read")?;
    let rows = stmt
        .query_map(params![plan_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
        })
        .context("failed to read the edges")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read an edge row")?;
    rows.into_iter()
        .map(|(before_task_id, after_task_id, cause, paths)| {
            Ok(DispatchEdge { before_task_id, after_task_id, cause, colliding_paths: decode_paths(&paths)? })
        })
        .collect()
}
