//! STUB (RED) — replaced by the real implementation in the GREEN commit.
use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeFlagInput {
    pub task_id: String,
    pub path: String,
    pub branch: String,
    pub base: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ChangeFlag {
    pub task_id: String,
    pub ahead: Option<u32>,
    pub dirty: bool,
}

pub fn change_flag_inputs(
    _conn: &Connection,
    _project_id: &str,
    _limit: usize,
) -> anyhow::Result<Vec<ChangeFlagInput>> {
    Ok(Vec::new())
}

pub fn finish_change_flags(_inputs: Vec<ChangeFlagInput>) -> anyhow::Result<Vec<ChangeFlag>> {
    Ok(Vec::new())
}
