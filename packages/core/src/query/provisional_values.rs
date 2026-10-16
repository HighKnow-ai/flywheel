//! STUB (RED): the real read lands in the next commit.
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionalValue {
    pub proposal_id: String,
    pub field: String,
    pub proposed: String,
    pub current: Option<String>,
    pub run_id: String,
    pub actor_name: String,
}

pub const PROVISIONAL_VALUES_LIMIT: usize = 50;

pub fn provisional_values_for(
    _conn: &Connection,
    _parent_type: &str,
    _parent_id: &str,
) -> anyhow::Result<Vec<ProvisionalValue>> {
    Ok(Vec::new())
}
