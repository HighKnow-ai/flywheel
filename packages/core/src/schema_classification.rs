//! FNC-02 / D-22: the closed-world classification of every table in the migrated schema.
//!
//! Migrations are SQL text, so a new table reaches the database without the compiler ever seeing
//! it. That is why this is a const list checked against `sqlite_master` by
//! `tests/table_classification.rs`, and not an enum a `match` could be exhaustive over. The list
//! holds data only: no connection, no query, no test logic.
//!
//! There is deliberately no catch-all class. A table whose only honest class is "not decided yet"
//! is an unclassified table, and the build must fail until someone decides.

/// What membership in a class means, and who may write the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableClass {
    /// Board substance. An agent may never write it directly; only the owning domain module's
    /// `_in_tx` writer, reached through a human action, does. This is the no-promotion gate's
    /// subject (`tests/proposal_no_promotion.rs`).
    Canonical,
    /// Agent-proposed rows that wait for human triage. Agents may stage here; nothing here is
    /// board substance until a human accepts it.
    Staging,
    /// Rows the core writes as a consequence of running agents, worktrees and plans.
    Runtime,
    /// Identity, projects, settings, the event log and its counters.
    Infrastructure,
    /// FTS5 virtual tables. They carry no independent substance; triggers on the canonical tables
    /// keep them in step. Their implicit shadow tables (`_data`, `_idx`, `_content`, `_docsize`,
    /// `_config`) are not listed: SQLite creates them and no migration can name them.
    SearchIndex,
}

/// Every table in the migrated schema, sorted by name, each with its reason.
pub const TABLE_CLASSES: &[(&str, TableClass)] = &[
    // Scoring rows of an epic or task; amended in place only by their domain writer.
    ("acceptance_criteria", TableClass::Canonical),
    // Identity of whoever acted: the local human, the system, each agent.
    ("actors", TableClass::Infrastructure),
    // One row per agent run; the core writes it as it starts, ends and abandons runs.
    ("agent_runs", TableClass::Runtime),
    // Agent-proposed epics, tasks, issues and criteria awaiting human triage.
    ("authoring_proposals", TableClass::Staging),
    // FTS5 index over the staged proposals.
    ("authoring_proposals_fts", TableClass::SearchIndex),
    // Diff anchors pinned to a criterion; written by the criterion writer.
    ("criterion_anchors", TableClass::Canonical),
    // The Cycle: the scope-boxed, undated grouping layer above the epic.
    ("cycles", TableClass::Canonical),
    // Task-to-task ordering edges of a dispatch plan.
    ("dispatch_edges", TableClass::Runtime),
    // Membership of a task in a dispatch plan.
    ("dispatch_plan_tasks", TableClass::Runtime),
    // A fan-out plan the core builds and executes.
    ("dispatch_plans", TableClass::Runtime),
    // The epic: the top of the spine.
    ("epics", TableClass::Canonical),
    // FTS5 index over epics.
    ("epics_fts", TableClass::SearchIndex),
    // Per-stream counters that give events their order.
    ("event_sequence_counters", TableClass::Infrastructure),
    // The append-only event log.
    ("events", TableClass::Infrastructure),
    // The issue: board substance beside epics and tasks.
    ("issues", TableClass::Canonical),
    // FTS5 index over issues.
    ("issues_fts", TableClass::SearchIndex),
    // A tool-permission request an agent raised and a human answers.
    ("permission_requests", TableClass::Runtime),
    // Standing allow/deny rules the core consults.
    ("permission_rules", TableClass::Runtime),
    // Registered repositories.
    ("projects", TableClass::Infrastructure),
    // What a finished session reported, kept so a fresh session can reconstitute.
    ("session_summaries", TableClass::Runtime),
    // Application settings.
    ("settings", TableClass::Infrastructure),
    // The files a task is expected to touch; feeds overlap detection.
    ("task_file_set_entries", TableClass::Runtime),
    // The task: the unit of agent work.
    ("tasks", TableClass::Canonical),
    // FTS5 index over tasks.
    ("tasks_fts", TableClass::SearchIndex),
    // What caused a run: a user action today; schedule and webhook reserved by the schema.
    ("triggers", TableClass::Runtime),
    // A git worktree owned by a task.
    ("worktrees", TableClass::Runtime),
];

/// The `Canonical` members of [`TABLE_CLASSES`], in declaration order. The no-promotion gate
/// derives its write patterns from this, so a new canonical table is covered by default.
pub fn canonical_tables() -> impl Iterator<Item = &'static str> {
    TABLE_CLASSES
        .iter()
        .filter(|(_, class)| *class == TableClass::Canonical)
        .map(|(name, _)| *name)
}
