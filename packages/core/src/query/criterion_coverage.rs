//! Does this task have criteria coverage? (D-12) — RED stub, enforcement lands in the next commit.
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionCoverage {
    pub current_count: i64,
    pub pending_draft_count: i64,
    pub has_coverage: bool,
    pub judgement_only_count: i64,
}

pub fn criterion_coverage(_conn: &Connection, _task_id: &str) -> anyhow::Result<CriterionCoverage> {
    Ok(CriterionCoverage { current_count: 0, pending_draft_count: 0, has_coverage: false, judgement_only_count: 0 })
}
