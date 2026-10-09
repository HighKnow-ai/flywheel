//! RED stub.
use rusqlite::Connection;

#[derive(Debug, Clone, PartialEq)]
pub struct ScopeDeniedCount {
    pub task_id: String,
    pub count: i64,
}

pub fn scope_denied_counts(_conn: &Connection, _project_id: &str, _limit: i64) -> anyhow::Result<Vec<ScopeDeniedCount>> {
    Ok(Vec::new())
}
