//! Plan/task/edge CRUD and the approval transaction (stub — filled in by the GREEN commit).

use rusqlite::{Connection, Transaction};

use crate::dispatch::DispatchEdge;

pub const EVENT_TASK_SEQUENCED: &str = "task.sequenced";
pub const EVENT_DISPATCH_PLAN_APPROVED: &str = "dispatch_plan.approved";

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

pub fn create_draft_plan_in_tx(
    _tx: &Transaction,
    _epic_id: &str,
    _planning_run_id: Option<&str>,
    _actor_id: &str,
    _now: &str,
) -> anyhow::Result<String> {
    Ok(String::new())
}

pub fn replace_plan_tasks_in_tx(
    _tx: &Transaction,
    _plan_id: &str,
    _tasks: &[PlanTaskInput],
) -> anyhow::Result<()> {
    Ok(())
}

pub fn insert_edge_in_tx(
    _tx: &Transaction,
    _plan_id: &str,
    _edge: &DispatchEdge,
    _now: &str,
) -> anyhow::Result<()> {
    Ok(())
}

pub fn approve_plan(_conn: &mut Connection, _plan_id: &str, _actor_id: &str) -> anyhow::Result<()> {
    Ok(())
}

pub fn approve_plan_with(
    _conn: &mut Connection,
    _plan_id: &str,
    _actor_id: &str,
    _fold_case: bool,
    _now: &str,
) -> anyhow::Result<()> {
    Ok(())
}

pub fn set_plan_status(_conn: &Connection, _plan_id: &str, _status: &str) -> anyhow::Result<()> {
    Ok(())
}

pub fn set_task_dispatch_state(
    _conn: &Connection,
    _plan_id: &str,
    _task_id: &str,
    _state: &str,
) -> anyhow::Result<()> {
    Ok(())
}

pub fn read_plan(_conn: &Connection, _plan_id: &str) -> anyhow::Result<Option<DispatchPlan>> {
    Ok(None)
}

pub fn read_edges(_conn: &Connection, _plan_id: &str) -> anyhow::Result<Vec<DispatchEdge>> {
    Ok(Vec::new())
}
