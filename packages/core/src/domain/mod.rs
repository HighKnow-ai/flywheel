//! Domain mutation and read functions — the only code in this workspace that executes a
//! mutating SQL statement (ARCHITECTURE.md Anti-Pattern 3, D-03). The renderer and any future
//! sidecar reach the database only through the Rust command surface in `packages/desktop`, which
//! calls straight through to these functions — never by opening the SQLite file itself.

use anyhow::anyhow;
use rusqlite::{params, OptionalExtension, Transaction};

pub mod acceptance_criterion;
pub mod actor;
pub mod agent_run;
pub mod authoring_proposal;
pub mod authoring_session;
pub mod epic;
pub mod event;
pub mod file_set;
pub mod issue;
pub mod permission_request;
pub mod permission_rule;
pub mod project;
pub mod session_summary;
pub mod settings;
pub mod task;
pub mod trigger;
pub mod worktree;

/// The one fixed five-state workflow (BOARD-04) that epics and tasks share. This is the ONLY
/// list of workflow states anywhere in this workspace — the schema CHECK constraint in migration
/// `0002_board_schema.sql` and the renderer's `StatusPicker` both derive from this single
/// declaration (directly, or by asserting their own list matches it in a test). There is no
/// second list, and no code path reads a state list from configuration — rigidity is the
/// feature (01-UI-SPEC.md "Selected Direction").
pub const WORKFLOW_STATES: [&str; 5] = ["backlog", "todo", "in_progress", "in_review", "done"];

/// Which table a reparenting/creation parent id must be looked up against —
/// [`assert_parent_in_project`] matches on this to select one of two compile-time literal SQL
/// strings, never a `format!`ed table name (the same constraint plan 01-08 recorded for
/// `packages/core/src/query`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ParentTable {
    Epics,
    Tasks,
}

/// Assert that `parent_id` names a row in `table` sharing `child_project_id`.
///
/// `tasks.epic_id`, `issues.epic_id` and `issues.task_id` are plain nullable foreign keys with
/// no same-project constraint in the schema (`0002_board_schema.sql`), so this integrity rule
/// has nowhere else to live. Called inside the caller's transaction, before the mutating
/// statement, by both reparenting paths (`task::set_epic`, `issue::set_parent`) and both
/// creation paths (`create_task`, `create_issue`) for every supplied `Some` parent id
/// (T-01-GC-01, T-01-GC-02).
pub(crate) fn assert_parent_in_project(
    tx: &Transaction,
    child_project_id: &str,
    table: ParentTable,
    parent_id: &str,
) -> anyhow::Result<()> {
    let parent_project_id: Option<String> = match table {
        ParentTable::Epics => tx
            .query_row(
                "SELECT project_id FROM epics WHERE id = ?1",
                params![parent_id],
                |row| row.get(0),
            )
            .optional()?,
        ParentTable::Tasks => tx
            .query_row(
                "SELECT project_id FROM tasks WHERE id = ?1",
                params![parent_id],
                |row| row.get(0),
            )
            .optional()?,
    };

    match parent_project_id {
        None => Err(anyhow!("parent {parent_id:?} does not exist")),
        Some(parent_project_id) if parent_project_id != child_project_id => Err(anyhow!(
            "parent {parent_id:?} belongs to project {parent_project_id:?}, not {child_project_id:?}"
        )),
        Some(_) => Ok(()),
    }
}
