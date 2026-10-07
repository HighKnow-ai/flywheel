//! RED stub — replaced by the real aggregate in the GREEN commit.

use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct EpicProgress {
    pub epic_id: Option<String>,
    pub by_status: Vec<(String, u32)>,
    pub total: u32,
    pub done: u32,
    pub agents_running: u32,
    pub agents_blocked: u32,
    pub criteria: Option<(u32, u32)>,
}

pub fn board_epic_progress(
    _conn: &Connection,
    _project_id: &str,
    _limit: usize,
) -> anyhow::Result<Vec<EpicProgress>> {
    Ok(Vec::new())
}
