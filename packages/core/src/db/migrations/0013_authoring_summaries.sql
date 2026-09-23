-- D-64 generalised for a conversation (plan 05-09): `session_summaries.task_id` loses its
-- `NOT NULL`, a nullable `epic_id` is added, and a table-level CHECK forbids a row from claiming
-- both a task and an epic as its subject at once — the exact same shape migration
-- `0010_authoring_runs.sql` (plan 05-02) already gave `agent_runs`, applied here to the row that
-- hangs off it. Without this rebuild an authoring session cannot structurally leave a summary,
-- and D-64's guarantee ("no session ends without one") would be false for every conversation.
--
-- Numbered 0013, not 0012: migration `0012_authoring_proposals_project_status_index.sql` (plan
-- 05-04) already claimed 0012 — this plan's own frontmatter named `0012_authoring_summaries.sql`
-- before that collision existed. Recorded as a documented deviation in this plan's own SUMMARY.
--
-- SQLite can add a nullable column without recreating a table (`0008_session_summaries.sql`'s own
-- `exit_summary_id` ALTER), but it cannot DROP a `NOT NULL` or add a table-level CHECK in place —
-- so this is a full rebuild, copying `0006_recovery_statuses.sql`'s documented safe sequence
-- exactly: CREATE TABLE <name>_new / explicit-column INSERT INTO <name>_new SELECT ... FROM
-- <name> / DROP TABLE <name> / ALTER TABLE <name>_new RENAME TO <name>. Every existing column is
-- reproduced verbatim from `0008_session_summaries.sql`, the `INSERT` uses an explicit column
-- list (never `SELECT *`), and both pre-existing indexes are recreated — `DROP TABLE` drops them
-- and `RENAME TO` does not bring them back.
--
-- `db::open_and_migrate` already toggles `PRAGMA foreign_keys` OFF around `MIGRATIONS.to_latest()`
-- and runs `PRAGMA foreign_key_check` afterward (`0006_recovery_statuses.sql`'s own header) — this
-- rebuild depends on that toggle exactly as `0010_authoring_runs.sql`'s did. No table has a real
-- foreign key INTO `session_summaries` (`agent_runs.exit_summary_id` deliberately carries no
-- `REFERENCES` clause, per `0008_session_summaries.sql`'s own header), so this rebuild is simpler
-- than `0010`'s: nothing downstream of this table needs to be dropped first.
CREATE TABLE session_summaries_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT REFERENCES tasks(id),
    epic_id TEXT REFERENCES epics(id),
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
    created_at TEXT NOT NULL,
    CHECK (NOT (task_id IS NOT NULL AND epic_id IS NOT NULL))
);

INSERT INTO session_summaries_new (
    id, agent_run_id, worktree_id, task_id, epic_id, project_id, changed_files, changed_prose,
    remains, next_session_must_know, decisions, acknowledged_decisions, diff_ref, auto_generated,
    created_by, created_at
)
SELECT
    id, agent_run_id, worktree_id, task_id, NULL, project_id, changed_files, changed_prose,
    remains, next_session_must_know, decisions, acknowledged_decisions, diff_ref, auto_generated,
    created_by, created_at
FROM session_summaries;

DROP TABLE session_summaries;

ALTER TABLE session_summaries_new RENAME TO session_summaries;

-- Recreate both pre-existing indexes (`0008_session_summaries.sql`) — DROP TABLE drops them and
-- CREATE TABLE ... RENAME TO does not resurrect them — plus the new epic-scoped index
-- `epic_context_packet.rs`'s `prior_authoring_runs` read needs.
CREATE INDEX idx_session_summaries_task_created ON session_summaries (task_id, created_at, id);
CREATE INDEX idx_session_summaries_run ON session_summaries (agent_run_id);
CREATE INDEX idx_session_summaries_epic_created ON session_summaries (epic_id, created_at, id);
