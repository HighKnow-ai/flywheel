//! The dispatcher's pure half (stub — filled in by the GREEN commit).

use rusqlite::Connection;

use crate::file_set::FileSetEntry;

pub const DISPATCH_TASK_STATES: [&str; 0] = [];
pub const DISPATCH_PLAN_STATES: [&str; 0] = [];
pub const EDGE_CAUSE_OVERLAP: &str = "overlap";
pub const EDGE_CAUSE_WIDEN: &str = "widen";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedTask {
    pub task_id: String,
    pub wave: u32,
    pub rank: String,
    pub entries: Vec<FileSetEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DispatchEdge {
    pub before_task_id: String,
    pub after_task_id: String,
    pub cause: String,
    pub colliding_paths: Vec<(String, String)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SequencingReason {
    Sequenced {
        before_task_id: String,
        after_task_id: String,
        cause: String,
        colliding_paths: Vec<(String, String)>,
    },
    DifferentWaves { wave_a: u32, wave_b: u32 },
    DisjointSets,
    NotInPlan,
}

pub fn normalise_waves(_tasks: &mut [PlannedTask]) {}

pub fn edges_for_plan(_tasks: &[PlannedTask], _fold_case: bool) -> Vec<DispatchEdge> {
    Vec::new()
}

pub fn planned_tasks(_conn: &Connection, _plan_id: &str) -> anyhow::Result<Vec<PlannedTask>> {
    Ok(Vec::new())
}

pub fn why(
    _conn: &Connection,
    _plan_id: &str,
    _task_a: &str,
    _task_b: &str,
) -> anyhow::Result<SequencingReason> {
    Ok(SequencingReason::NotInPlan)
}

pub fn occupied_slots(_conn: &Connection) -> anyhow::Result<u32> {
    Ok(0)
}

pub fn in_flight_declared_sets(
    _conn: &Connection,
    _project_id: &str,
) -> anyhow::Result<Vec<(String, Vec<FileSetEntry>)>> {
    Ok(Vec::new())
}
