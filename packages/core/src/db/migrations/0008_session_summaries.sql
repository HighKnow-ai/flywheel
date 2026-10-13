-- `session_summaries` (D-65, CTX-01..CTX-04): the tracer's own table. Every finished agent
-- session leaves a structured, four-field row here — `changed_files`/`changed_prose` (D-65's
-- machine-checkable half and its prose half), `remains`, `next_session_must_know`, plus
-- `decisions` (a discrete-entry list, never one prose blob) and `acknowledged_decisions` (D-73's
-- read-back input). This is CTX-02's append-only surface: no code path in this workspace ever
-- updates or deletes a row's content fields once written (enforced structurally, not just by
-- convention — see `domain::session_summary`'s own module doc comment and its Task 2 grep gate).
--
-- Two indexes back the table's two read shapes: `idx_session_summaries_task_created` is the
-- packet's own read order (`task_id, created_at, id` — the ULID tie-break is load-bearing for
-- CTX-04's determinism, since two summaries written in the same millisecond must still order
-- stably), and `idx_session_summaries_run` is the fallback synthesizer's "did this run already
-- produce one" presence check (plan 04-02).
--
-- `changed_files`, `decisions` and `acknowledged_decisions` are JSON-encoded TEXT because SQLite
-- has no array type, and because ARCHITECTURE.md section 2.2 wants `SessionSummary` independently
-- queryable per run, not JSON hung off a task row.
CREATE TABLE session_summaries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    changed_files TEXT NOT NULL,
    changed_prose TEXT,
    remains TEXT,
    next_session_must_know TEXT,
    decisions TEXT NOT NULL,
    acknowledged_decisions TEXT NOT NULL,
    diff_ref TEXT,
    auto_generated INTEGER NOT NULL DEFAULT 0 CHECK (auto_generated IN (0, 1)),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

CREATE INDEX idx_session_summaries_task_created ON session_summaries (task_id, created_at, id);
CREATE INDEX idx_session_summaries_run ON session_summaries (agent_run_id);

-- `agent_runs.exit_summary_id` (D-65): the pointer that always names the most recent summary
-- recorded for a run, updated in the same transaction as every `create_summary` insert.
--
-- A plain `ALTER TABLE ... ADD COLUMN`, not a table rebuild — matching `0007_destructive_gate.sql`'s
-- own precedent exactly: SQLite can add a nullable column without recreating the table, and
-- nothing here changes a CHECK constraint, so `0006_recovery_statuses.sql`'s backup-first rebuild
-- sequence is deliberately not needed for this migration.
--
-- `exit_summary_id` carries no `REFERENCES` clause, because SQLite's `ALTER TABLE ... ADD COLUMN`
-- forbids adding a column with a REFERENCES clause referencing a table created before this
-- migration in the same run. The referential rule (this column must name a real
-- `session_summaries.id`) is enforced instead at the single Rust write path that ever sets it —
-- `domain::session_summary::create_summary`, inside the same transaction as the row insert — the
-- same bounded departure from "the schema, not app code, is the authority"
-- `0007_destructive_gate.sql` already took for `destructive_category`, for the identical reason:
-- exactly one writer exists, and that writer is Rust-only application code.
ALTER TABLE agent_runs ADD COLUMN exit_summary_id TEXT;
