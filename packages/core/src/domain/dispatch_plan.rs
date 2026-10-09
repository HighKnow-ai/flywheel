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

// ---------------------------------------------------------------------------------------------
// Plan 09-07: the dispatcher's own writes. Every state here is the dispatcher's DISPLAY state
// (`dispatch_plan_tasks.state`, `dispatch_plans.status`); none of it writes `tasks.status`.
// ---------------------------------------------------------------------------------------------

/// Appended when a task stops its wave and asks for the user. The payload carries the plan id, the
/// phase, the cause kind and the sentence; the latest one is the readable cause.
pub const EVENT_TASK_NEEDS_ATTENTION: &str = "dispatch.task_needs_attention";
pub const EVENT_WAVE_ADVANCED: &str = "dispatch_plan.wave_advanced";
pub const EVENT_PLAN_COMPLETED: &str = "dispatch_plan.completed";

fn plan_anchor(conn: &Connection, plan_id: &str) -> anyhow::Result<(String, String, String, u32)> {
    conn.query_row(
        "SELECT p.epic_id, e.project_id, p.status, p.wave_cursor
           FROM dispatch_plans p JOIN epics e ON e.id = p.epic_id WHERE p.id = ?1",
        params![plan_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .with_context(|| format!("plan {plan_id:?} not found"))
}

/// Mark a task as needing attention with a named cause: state and event in one transaction. Returns
/// `false` and writes nothing when the task is already marked with the very same cause, so a
/// condition that persists across ticks is one record, not one per tick.
pub fn mark_needs_attention(
    conn: &mut Connection,
    plan_id: &str,
    task_id: &str,
    cause: &crate::dispatch::AttentionCause,
    actor_id: &str,
) -> anyhow::Result<bool> {
    let (epic_id, project_id, _, _) = plan_anchor(conn, plan_id)?;
    let sentence = cause.sentence();
    let current: String = conn
        .query_row(
            "SELECT state FROM dispatch_plan_tasks WHERE plan_id = ?1 AND task_id = ?2",
            params![plan_id, task_id],
            |r| r.get(0),
        )
        .with_context(|| format!("task {task_id:?} is not in plan {plan_id:?}"))?;
    if current == "needs_attention" {
        if let Some((_, kind, text)) = crate::dispatch::attention_for(conn, plan_id, task_id)? {
            if kind == cause.kind() && text == sentence {
                return Ok(false);
            }
        }
    }
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE dispatch_plan_tasks SET state = 'needs_attention' WHERE plan_id = ?1 AND task_id = ?2",
        params![plan_id, task_id],
    )
    .context("failed to mark the task as needing attention")?;
    let sequence = next_sequence(&tx, &project_id, "local")?;
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        Some(&epic_id),
        actor_id,
        EVENT_TASK_NEEDS_ATTENTION,
        &serde_json::json!({
            "field": "dispatch_state",
            "plan_id": plan_id,
            "phase": cause.phase().as_str(),
            "kind": cause.kind(),
            "cause": sentence,
            "label": "Needs attention",
        }),
        &now,
    )?;
    tx.commit().context("failed to commit the needs-attention mark")?;
    Ok(true)
}

/// Where a wave advance left the plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdvanceOutcome {
    NextWave(u32),
    Completed,
}

/// Move the cursor past a wave that is entirely merged or skipped; past the last wave the plan is
/// completed. Refuses a wave that is not drained, so neither the tick nor the manual advance can
/// start a wave on a base that lacks the last one's work. One transaction with its event.
pub fn advance_wave(conn: &mut Connection, plan_id: &str, actor_id: &str) -> anyhow::Result<AdvanceOutcome> {
    let (epic_id, project_id, status, cursor) = plan_anchor(conn, plan_id)?;
    if !matches!(status.as_str(), "approved" | "running") {
        bail!("plan {plan_id:?} is {status}; only a running plan advances");
    }
    if !crate::dispatch::wave_is_drained(conn, plan_id, cursor)? {
        bail!("wave {cursor} of plan {plan_id:?} still has tasks that are not merged or skipped");
    }
    let last: u32 = conn
        .query_row(
            "SELECT COALESCE(MAX(wave), 0) FROM dispatch_plan_tasks WHERE plan_id = ?1",
            params![plan_id],
            |r| r.get(0),
        )
        .context("failed to read the last wave")?;
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let (outcome, event_type, label) = if cursor >= last {
        tx.execute(
            "UPDATE dispatch_plans SET status = 'completed', updated_at = ?1 WHERE id = ?2",
            params![now, plan_id],
        )
        .context("failed to complete the plan")?;
        (AdvanceOutcome::Completed, EVENT_PLAN_COMPLETED, "Fan-out completed".to_string())
    } else {
        tx.execute(
            "UPDATE dispatch_plans SET wave_cursor = ?1, updated_at = ?2 WHERE id = ?3",
            params![cursor + 1, now, plan_id],
        )
        .context("failed to advance the wave cursor")?;
        (AdvanceOutcome::NextWave(cursor + 1), EVENT_WAVE_ADVANCED, format!("Wave {cursor} merged; starting wave {}", cursor + 1))
    };
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
        event_type,
        &serde_json::json!({ "field": "dispatch_plan", "plan_id": plan_id, "from_wave": cursor, "label": label }),
        &now,
    )?;
    tx.commit().context("failed to commit the wave advance")?;
    Ok(outcome)
}

/// A user's control over a plan. Pause and stop change what the dispatcher STARTS; neither touches
/// a running session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanControl {
    Start,
    Pause,
    Resume,
    Stop,
}

/// Apply a control, recorded against `actor_id`. `Start` takes an approved plan to running.
pub fn control_plan(
    conn: &mut Connection,
    plan_id: &str,
    control: PlanControl,
    actor_id: &str,
) -> anyhow::Result<()> {
    let (epic_id, project_id, status, _) = plan_anchor(conn, plan_id)?;
    let (to, event_type, label) = match (control, status.as_str()) {
        (PlanControl::Start, "approved") => ("running", "dispatch_plan.started", "Started the fan-out"),
        (PlanControl::Pause, "running" | "approved") => ("paused", "dispatch_plan.paused", "Paused the fan-out"),
        (PlanControl::Resume, "paused") => ("running", "dispatch_plan.resumed", "Resumed the fan-out"),
        (PlanControl::Stop, "approved" | "running" | "paused") => ("aborted", "dispatch_plan.stopped", "Stopped the fan-out"),
        (c, s) => bail!("plan {plan_id:?} is {s}; {c:?} does not apply"),
    };
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE dispatch_plans SET status = ?1, updated_at = ?2 WHERE id = ?3",
        params![to, now, plan_id],
    )
    .context("failed to change the plan status")?;
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
        event_type,
        &serde_json::json!({ "field": "dispatch_plan", "plan_id": plan_id, "from": status, "to": to, "label": label }),
        &now,
    )?;
    tx.commit().context("failed to commit the plan control")?;
    Ok(())
}

/// Approve a draft plan and start it: [`approve_plan`] then [`PlanControl::Start`]. The approval is
/// its own transaction (it freezes the edges); a start that then fails leaves an `approved` plan,
/// which the dispatcher already treats as live.
pub fn approve_and_start(conn: &mut Connection, plan_id: &str, actor_id: &str) -> anyhow::Result<()> {
    approve_plan(conn, plan_id, actor_id)?;
    control_plan(conn, plan_id, PlanControl::Start, actor_id)
}

/// A draft plan over an epic's not-yet-started tasks, built from their currently declared sets with
/// no planning agent involved. Every task starts in wave one: overlap inside a wave is the ordering
/// edges' job (only the colliding pair waits), and wave boundaries are a planner's judgement that
/// this draft has no basis to invent. The user edits waves before approving.
pub fn create_plan_for_epic(conn: &mut Connection, epic_id: &str, actor_id: &str) -> anyhow::Result<String> {
    // ponytail: only backlog/todo tasks are included; a task already in progress or in review is the
    // user's to launch. Widen the filter if a re-plan after a changes-requested loop is wanted.
    let task_ids: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT id FROM tasks WHERE epic_id = ?1 AND status IN ('backlog', 'todo') ORDER BY rank, id",
            )
            .context("failed to prepare the epic task read")?;
        let rows = stmt
            .query_map(params![epic_id], |r| r.get::<_, String>(0))
            .context("failed to read the epic's tasks")?
            .collect::<Result<Vec<_>, _>>()
            .context("failed to read an epic task row")?;
        rows
    };
    if task_ids.is_empty() {
        bail!("epic {epic_id:?} has no backlog or todo tasks to plan");
    }
    let inputs: Vec<PlanTaskInput> = task_ids
        .into_iter()
        .map(|task_id| PlanTaskInput { task_id, wave: 1, rationale: None })
        .collect();
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let plan_id = create_draft_plan_in_tx(&tx, epic_id, None, actor_id, &now)?;
    replace_plan_tasks_in_tx(&tx, &plan_id, &inputs)?;
    tx.commit().context("failed to commit the draft plan")?;
    Ok(plan_id)
}

/// One edit to a draft plan: move a task to another wave and/or replace its declared entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftEdit {
    pub task_id: String,
    pub wave: Option<u32>,
    pub entries: Option<Vec<String>>,
}

/// Apply edits to a DRAFT plan. Entries are parsed first (a refused entry changes nothing); wave
/// moves rewrite the plan's task rows, keeping each task's rationale.
pub fn edit_draft_plan(
    conn: &mut Connection,
    plan_id: &str,
    edits: &[DraftEdit],
    actor_id: &str,
) -> anyhow::Result<()> {
    let plan = read_plan(conn, plan_id)?.with_context(|| format!("plan {plan_id:?} not found"))?;
    if plan.status != "draft" {
        bail!("plan {plan_id:?} is {}; only a draft plan can be edited", plan.status);
    }
    let mut parsed = Vec::new();
    for edit in edits {
        if !plan.tasks.iter().any(|t| t.task_id == edit.task_id) {
            bail!("task {:?} is not in plan {plan_id:?}", edit.task_id);
        }
        if let Some(raw) = &edit.entries {
            let entries = raw
                .iter()
                .map(|r| crate::file_set::parse_entry(r).map_err(|e| anyhow!("{r:?}: {e}")))
                .collect::<Result<Vec<_>, _>>()?;
            parsed.push((edit.task_id.clone(), entries));
        }
    }
    let inputs: Vec<PlanTaskInput> = plan
        .tasks
        .iter()
        .map(|t| PlanTaskInput {
            task_id: t.task_id.clone(),
            wave: edits.iter().rev().find(|e| e.task_id == t.task_id).and_then(|e| e.wave).unwrap_or(t.wave),
            rationale: t.rationale.clone(),
        })
        .collect();
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    for (task_id, entries) in &parsed {
        crate::domain::file_set::declare_file_set_in_tx(&tx, task_id, entries, actor_id, &now)?;
    }
    replace_plan_tasks_in_tx(&tx, plan_id, &inputs)?;
    tx.commit().context("failed to commit the draft edit")?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Plan 09-08: the pre-dispatch planning pass's submission (D-147, D-149, PLAN-01).
//
// A planning run reads the repository as it is NOW and calls `submit_plan` once, naming a file-set
// and a wave for each task of the epic. Authority lives here, not in the tool list: the sidecar's
// MCP server lists `submit_plan` to every run, so [`resolve_planning_run`] is the control. The plan
// row does not exist until a valid submission arrives, so a pass that is abandoned or refused
// leaves nothing behind and the one-live-plan-per-epic index is the only guard on a second one.
// ---------------------------------------------------------------------------------------------

/// Appended when a planning run's submission is stored as a draft plan.
pub const EVENT_DISPATCH_PLAN_DRAFTED: &str = "dispatch_plan.drafted";

/// The most tasks, entries per task and characters per entry one submission may carry. The list is
/// model-authored text crossing into the database, so it is bounded here and not only in the tool.
pub const MAX_SUBMITTED_TASKS: usize = 500;
pub const MAX_SUBMITTED_ENTRIES: usize = 200;
pub const MAX_SUBMITTED_ENTRY_CHARS: usize = 1024;

/// One task as the planning run declared it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct SubmittedTask {
    pub key: String,
    pub files: Vec<String>,
    pub wave: u32,
    #[serde(default)]
    pub rationale: String,
}

/// A task the planning run chose to leave out, with the reason the user will read.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct SubmittedExclusion {
    pub key: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
pub struct SubmittedPlan {
    pub tasks: Vec<SubmittedTask>,
    #[serde(default)]
    pub excluded: Vec<SubmittedExclusion>,
}

/// Why a submission was refused. Each message is written for the AGENT that will read it in the
/// same tool call and correct it, so it names the task key or the entry and says what to change.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SubmissionRefusal {
    NotPlanningRun,
    RunNotRunning { status: String },
    Malformed(String),
    NoTasks,
    EmptyFileList { key: String },
    UnknownKey { key: String },
    NotPlannable { key: String, status: String },
    DuplicateKey { key: String },
    BadWave { key: String },
    EmptyReason { key: String },
    BadEntry { key: String, entry: String, cause: crate::file_set::EntryRefusal },
    TooLarge(String),
    LivePlanExists,
    Storage(String),
}

impl std::fmt::Display for SubmissionRefusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        use SubmissionRefusal::*;
        match self {
            NotPlanningRun => write!(f, "only the planning run of an epic can submit a plan"),
            RunNotRunning { status } => write!(f, "this planning run is {status}, so it can no longer submit a plan"),
            Malformed(why) => write!(f, "the submission could not be read: {why}"),
            NoTasks => write!(f, "the submission names no tasks; name every task of the epic, with a file list for each"),
            EmptyFileList { key } => write!(f, "task {key} has an empty file list; give the files it expects to modify, or move it to `excluded` with a reason"),
            UnknownKey { key } => write!(f, "{key} is not a task of this epic; use the exact keys from the task roster"),
            NotPlannable { key, status } => write!(f, "task {key} is {status}; only backlog and todo tasks are planned for dispatch"),
            DuplicateKey { key } => write!(f, "task {key} appears more than once in the submission"),
            BadWave { key } => write!(f, "task {key} has a wave below 1; waves start at 1"),
            EmptyReason { key } => write!(f, "task {key} is excluded without a reason; say why it is left out"),
            BadEntry { key, entry, cause } => write!(f, "task {key}: the file-set entry {entry:?} was refused: {cause}"),
            TooLarge(what) => write!(f, "the submission is too large: {what}"),
            LivePlanExists => write!(f, "this epic already has a live plan; discard or finish it before submitting another"),
            Storage(why) => write!(f, "the plan could not be stored: {why}"),
        }
    }
}

impl std::error::Error for SubmissionRefusal {}

/// The identity of a planning run, resolved from the database.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlanningRun {
    pub run_id: String,
    pub epic_id: String,
    pub actor_id: String,
}

/// Who may submit a plan: an epic-scoped run with no task and no authoring stage, in `running`
/// status. This is the authority check; the tool being listed to every run is not a control.
pub fn resolve_planning_run(conn: &Connection, run_id: &str) -> Result<PlanningRun, SubmissionRefusal> {
    let _ = (conn, run_id);
    Err(SubmissionRefusal::Storage("not implemented".into()))
}

/// Validate a submission and store it as ONE draft plan: the plan row, its task rows (waves
/// normalised, same-wave tasks in rank-then-id order), each task's declared entries and one event,
/// in a single transaction. Returns the new plan's id. Nothing is stored on any refusal.
pub fn store_submitted_plan(
    conn: &mut Connection,
    planning_run_id: &str,
    epic_id: &str,
    plan: &SubmittedPlan,
    actor_id: &str,
    now: &str,
) -> Result<String, SubmissionRefusal> {
    let _ = (conn, planning_run_id, epic_id, plan, actor_id, now);
    Err(SubmissionRefusal::Storage("not implemented".into()))
}
