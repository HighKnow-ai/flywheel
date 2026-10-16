//! Does this task have criteria coverage? (D-12, D-24 / A-08.)
//!
//! One read, so the renderer never invents a second definition of "no criteria". It returns
//! counts and a boolean, never statements: the criteria themselves come from the bounded
//! `criterion_list`. Nothing here writes, and reading drafts nothing.
use anyhow::Context;
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionCoverage {
    /// Current (not superseded) criteria on the task.
    pub current_count: i64,
    /// Pending criterion `create` drafts aimed at the task: by `target_id` for a hand-made task
    /// (F3), or under a task proposal that materialised it for a fresh one.
    pub pending_draft_count: i64,
    /// D-12 exactly: a pending draft counts, so a reopened launch sheet does not re-draft what is
    /// already waiting and plan 15-01's cap is not spent twice on one task.
    pub has_coverage: bool,
    /// D-24: a NULL `verification_hint` IS the flag. No column; this is the whole derivation.
    pub judgement_only_count: i64,
}

pub fn criterion_coverage(conn: &Connection, task_id: &str) -> anyhow::Result<CriterionCoverage> {
    let (current_count, judgement_only_count): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(verification_hint IS NULL), 0)
             FROM acceptance_criteria
             WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .context("failed to count the task's current criteria")?;
    // Scoped by project first so the (project_id, status) index bounds the scan.
    let pending_draft_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM authoring_proposals
             WHERE project_id = (SELECT project_id FROM tasks WHERE id = ?1)
               AND status = 'pending' AND target_type = 'criterion' AND verb = 'create'
               AND (target_id = ?1
                    OR parent_proposal_id IN (
                        SELECT id FROM authoring_proposals WHERE materialised_id = ?1 AND target_type = 'task'))",
            params![task_id],
            |row| row.get(0),
        )
        .context("failed to count the task's pending criterion drafts")?;
    Ok(CriterionCoverage {
        current_count,
        pending_draft_count,
        has_coverage: current_count > 0 || pending_draft_count > 0,
        judgement_only_count,
    })
}
