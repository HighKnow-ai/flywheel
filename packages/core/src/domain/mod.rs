//! Domain mutation and read functions — the only code in this workspace that executes a
//! mutating SQL statement (ARCHITECTURE.md Anti-Pattern 3, D-03). The renderer and any future
//! sidecar reach the database only through the Rust command surface in `packages/desktop`, which
//! calls straight through to these functions — never by opening the SQLite file itself.

pub mod actor;
pub mod epic;
pub mod event;
pub mod issue;
pub mod project;
pub mod task;

/// The one fixed five-state workflow (BOARD-04) that epics and tasks share. This is the ONLY
/// list of workflow states anywhere in this workspace — the schema CHECK constraint in migration
/// `0002_board_schema.sql` and the renderer's `StatusPicker` both derive from this single
/// declaration (directly, or by asserting their own list matches it in a test). There is no
/// second list, and no code path reads a state list from configuration — rigidity is the
/// feature (01-UI-SPEC.md "Selected Direction").
pub const WORKFLOW_STATES: [&str; 5] = ["backlog", "todo", "in_progress", "in_review", "done"];
