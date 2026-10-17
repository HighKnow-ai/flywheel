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
    /// Board substance. An agent never writes it directly: it reaches the board only through a
    /// Proposal the developer accepts, applied by the owning domain module's writer.
    Canonical,
    /// Agent-proposed rows that wait for the developer's decision. Agents may file here; nothing
    /// here is board substance until the developer accepts it.
    Staging,
    /// Rows the core writes as a consequence of running sessions and worktrees, plus the Task
    /// checklist a Story's agent keeps current itself (docs/mvp-spec.md §4.3).
    Runtime,
    /// Identity, projects, settings, the event log and its counters.
    Infrastructure,
    /// FTS5 virtual tables. They carry no independent substance; triggers on the canonical tables
    /// keep them in step. Their implicit shadow tables (`_data`, `_idx`, `_content`, `_docsize`,
    /// `_config`) are not listed: SQLite creates them and no migration can name them. The baseline
    /// has none; the class stays so a search index added later is classified, not improvised.
    SearchIndex,
}

/// Every table in the migrated schema, sorted by name, each with its reason.
pub const TABLE_CLASSES: &[(&str, TableClass)] = &[
    // Testable statements a Story must satisfy; acceptance is the developer's act.
    ("acceptance_criteria", TableClass::Canonical),
    // Identity of whoever acted: the local human, the system, each agent.
    ("actors", TableClass::Infrastructure),
    // Links from a Milestone, Epic or Story to an ADR kept in the managed repo.
    ("adr_links", TableClass::Canonical),
    // Runs of record of a Check, each tied to the commit it ran against; written by Flywheel.
    ("check_runs", TableClass::Runtime),
    // The executable test attached to a criterion; only the developer edits it.
    ("checks", TableClass::Canonical),
    // The Epic: a capability inside one Milestone, with its spec and exit test.
    ("epics", TableClass::Canonical),
    // Per-stream counters that give events their order.
    ("event_sequence_counters", TableClass::Infrastructure),
    // The append-only event log.
    ("events", TableClass::Infrastructure),
    // The Milestone: an outcome with an exit test; the Roadmap is their rank order.
    ("milestones", TableClass::Canonical),
    // A tool-permission request a session raised and a human answers.
    ("permission_requests", TableClass::Runtime),
    // Standing "always allow <pattern>" rules, keyed by (project, tool, pattern).
    ("permission_rules", TableClass::Runtime),
    // Registered repositories.
    ("projects", TableClass::Infrastructure),
    // Agent-suggested changes awaiting the developer's decision.
    ("proposals", TableClass::Staging),
    // What a session left for the next one, so a fresh session can reconstitute.
    ("session_summaries", TableClass::Runtime),
    // One row per Story session; the core writes it as it starts, ends and abandons sessions.
    ("sessions", TableClass::Runtime),
    // Application settings.
    ("settings", TableClass::Infrastructure),
    // The Story: the unit of agent work, inside one Epic.
    ("stories", TableClass::Canonical),
    // A Story's checklist, written and kept current by its agent through the board tool.
    ("tasks", TableClass::Runtime),
    // The worktree a Story owns.
    ("worktrees", TableClass::Runtime),
];

/// The `Canonical` members of [`TABLE_CLASSES`], in declaration order.
pub fn canonical_tables() -> impl Iterator<Item = &'static str> {
    TABLE_CLASSES
        .iter()
        .filter(|(_, class)| *class == TableClass::Canonical)
        .map(|(name, _)| *name)
}
