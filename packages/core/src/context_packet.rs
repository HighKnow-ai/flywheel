//! `assemble_context_packet` / `render_prompt` (D-28): the genuine stub of Phase 4's
//! `ContextAssembler` — same signature, same "same board state always produces the same packet"
//! contract (ARCHITECTURE.md section 3). A pure query over the board: no model call, no network
//! call, no mutation of any kind. Every SQL statement below is a literal `&str`, bound through
//! `params![]` — never assembled by `format!`/string interpolation, matching `query/events.rs`'s
//! own discipline (T-01-01/T-01-23).
//!
//! Deliberately does NOT call `domain::worktree::base_ref_for_task` for the "no worktree yet"
//! case, despite that being the obvious-looking reuse target: that function calls
//! `domain::epic::ensure_epic_integration_branch`, which — for a task whose epic has no
//! integration branch cut yet — CUTS A REAL GIT BRANCH and writes `epics.integration_branch` as
//! a side effect. A preview must never do that (T-02-21, plan 02-04's "nothing happens until
//! Start Work fires" invariant, and this module's own "no model call and no network call of any
//! kind" contract extended to "no git call and no write of any kind"). [`predict_base_ref`]
//! below re-derives the identical hypothetical value read-only: the epic's already-cut
//! `integration_branch` if one exists, or exactly the name `ensure_epic_integration_branch` would
//! cut later (`branch::epic_integration_branch_name`) — never cutting it here.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::branch::{epic_integration_branch_name, task_branch_name};
use crate::domain::worktree::worktree_root;

/// One acceptance criterion entry, in rank order — statement plus its verification hint (D-05).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CriterionEntry {
    pub statement: String,
    pub verification_hint: Option<String>,
}

/// The epic section, present only when the task has an epic (D-13) — an absent epic is `None` on
/// [`ContextPacket`], never an empty-string title (this file's own load-bearing contract, echoed
/// in `render_prompt`'s "omit the heading" rule below).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EpicSection {
    pub title: String,
    pub description: Option<String>,
}

/// The branch/worktree facts the run will actually use (WORK-01/WORK-02) — the resolved row's
/// values when a worktree already exists, or exactly what `domain::worktree::ensure_worktree`
/// would create otherwise (predicted, never created).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WorktreeFacts {
    pub branch: String,
    pub base_ref: String,
    pub path: String,
}

/// The full context packet (D-28). Every field is data — no pre-rendered sentence is stored here;
/// [`render_prompt`] is the only place prose is produced, matching this crate's "derive at read
/// time, never store" rule (`query/events.rs`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ContextPacket {
    pub task_key: String,
    pub task_title: String,
    pub task_description: Option<String>,
    pub epic: Option<EpicSection>,
    pub criteria: Vec<CriterionEntry>,
    pub worktree: WorktreeFacts,
}

const TASK_ROW_SQL: &str =
    "SELECT project_id, epic_id, key, title, description FROM tasks WHERE id = ?1";

const EPIC_ROW_SQL: &str =
    "SELECT key, title, description, integration_branch FROM epics WHERE id = ?1";

const CRITERIA_SQL: &str = "SELECT statement, verification_hint FROM acceptance_criteria \
    WHERE parent_type = 'task' AND parent_id = ?1 ORDER BY rank ASC, id ASC";

const WORKTREE_ROW_SQL: &str = "SELECT branch, base_branch, path FROM worktrees WHERE task_id = ?1";

const PROJECT_DEFAULT_BRANCH_SQL: &str = "SELECT default_branch FROM projects WHERE id = ?1";

const PROJECT_KEY_PREFIX_SQL: &str = "SELECT key_prefix FROM projects WHERE id = ?1";

/// One epic row's fields, read once and reused both for [`EpicSection`] and for
/// [`assemble_context_packet`]'s no-worktree-yet base-ref prediction — avoids a second query
/// against `epics` for the same row within one call.
struct EpicRow {
    key: String,
    title: String,
    description: Option<String>,
    integration_branch: Option<String>,
}

/// Assemble the deterministic context packet for `task_id` (D-28) — a pure query, never a model
/// call, never a mutation of any kind. Calling this twice against an unchanged database returns
/// two byte-identical packets (`ContextPacket` derives `PartialEq`); calling it after a criterion
/// is reordered returns the criteria in the new rank order, because this reads board state on
/// every call rather than caching.
pub fn assemble_context_packet(conn: &Connection, task_id: &str) -> anyhow::Result<ContextPacket> {
    let (project_id, epic_id, task_key, task_title, task_description): (
        String,
        Option<String>,
        String,
        String,
        Option<String>,
    ) = conn
        .query_row(TASK_ROW_SQL, params![task_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        })
        .with_context(|| format!("task {task_id:?} not found"))?;

    let epic_row: Option<EpicRow> = match &epic_id {
        Some(id) => Some(
            conn.query_row(EPIC_ROW_SQL, params![id], |row| {
                Ok(EpicRow {
                    key: row.get(0)?,
                    title: row.get(1)?,
                    description: row.get(2)?,
                    integration_branch: row.get(3)?,
                })
            })
            .with_context(|| format!("epic {id:?} not found"))?,
        ),
        None => None,
    };

    let epic = epic_row.as_ref().map(|e| EpicSection {
        title: e.title.clone(),
        description: e.description.clone(),
    });

    let mut criteria_stmt = conn.prepare(CRITERIA_SQL)?;
    let criteria = criteria_stmt
        .query_map(params![task_id], |row| {
            Ok(CriterionEntry {
                statement: row.get(0)?,
                verification_hint: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the task's acceptance criteria")?;
    drop(criteria_stmt);

    let existing_worktree: Option<(String, String, String)> = conn
        .query_row(WORKTREE_ROW_SQL, params![task_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .optional()
        .context("failed to look up the worktree for this task")?;

    let worktree = match existing_worktree {
        // For a task that already has a worktree, the branch and path reported are the ones
        // stored on the `worktrees` row, not freshly derived values (D-30: the row is the
        // authority on the topology that was actually created).
        Some((branch, base_branch, path)) => WorktreeFacts { branch, base_ref: base_branch, path },
        // For a task with no worktree yet, the branch and path reported are exactly what
        // `ensure_worktree` would create — predicted read-only, per this file's header comment.
        None => {
            let key_prefix: String = conn
                .query_row(PROJECT_KEY_PREFIX_SQL, params![project_id], |row| row.get(0))
                .with_context(|| format!("project {project_id:?} not found"))?;

            let branch = task_branch_name(&task_key, &task_title);
            let base_ref = match &epic_row {
                Some(e) => e
                    .integration_branch
                    .clone()
                    .unwrap_or_else(|| epic_integration_branch_name(&e.key, &e.title)),
                None => conn
                    .query_row(PROJECT_DEFAULT_BRANCH_SQL, params![project_id], |row| row.get(0))
                    .with_context(|| format!("project {project_id:?} not found"))?,
            };
            let path = worktree_root()
                .join(&key_prefix)
                .join(&task_key)
                .to_string_lossy()
                .into_owned();

            WorktreeFacts { branch, base_ref, path }
        }
    };

    Ok(ContextPacket {
        task_key,
        task_title,
        task_description,
        epic,
        criteria,
        worktree,
    })
}

/// Render the initial prompt text (D-28) — stable headings, stable ordering, and an omitted
/// heading rather than an empty section: no epic means no epic heading, no criteria means no
/// criteria heading, an empty (or whitespace-only) instruction means no instruction heading.
/// Never emits a placeholder such as a bare dash for a missing field. `render_prompt` for the
/// same packet and instruction returns byte-identical output across calls — nothing here reads
/// the clock, randomness, or any input other than its two arguments.
pub fn render_prompt(packet: &ContextPacket, instruction: &str) -> String {
    let mut out = String::new();

    out.push_str("# ");
    out.push_str(&packet.task_title);
    out.push('\n');

    if let Some(description) = &packet.task_description {
        out.push('\n');
        out.push_str(description);
        out.push('\n');
    }

    if let Some(epic) = &packet.epic {
        out.push_str("\n## Epic Context\n\n");
        out.push_str(&epic.title);
        out.push('\n');
        if let Some(description) = &epic.description {
            out.push('\n');
            out.push_str(description);
            out.push('\n');
        }
    }

    if !packet.criteria.is_empty() {
        out.push_str("\n## Acceptance Criteria\n\n");
        for criterion in &packet.criteria {
            out.push_str("- ");
            out.push_str(&criterion.statement);
            if let Some(hint) = &criterion.verification_hint {
                out.push_str(" (Verify: ");
                out.push_str(hint);
                out.push(')');
            }
            out.push('\n');
        }
    }

    let trimmed_instruction = instruction.trim();
    if !trimmed_instruction.is_empty() {
        out.push_str("\n## Additional Instructions\n\n");
        out.push_str(trimmed_instruction);
        out.push('\n');
    }

    out
}
