-- Owner decisions closing this migration's shape (D-97, D-99, D-102, D-107 — plan 06-01 Task 1,
-- decision option-a from `06-01-PLAN.md`'s checkpoint):
--   1. D-97: `target_type` gains `'issue'` — the one new proposable thing an execution-run's
--      `propose_item` call can stage that an authoring session never proposes.
--   2. D-99: `rationale` and `origin_log_offset` are added — the two provenance fields PROP-07
--      requires for every execution-run proposal (an authoring proposal leaves both `NULL`).
--   3. D-102: `status` gains `'merged'` and `'deferred'` — the two additional terminal outcomes
--      plan 06-02's triage surface needs beside the existing `pending`/`accepted`/`rejected`.
--   4. D-107: `duplicate_of` and `duplicate_score` are added now, even though no code in this plan
--      writes them (plan 06-04 does) — bundling them into this SAME rebuild is strictly cheaper
--      than a second rebuild of a table that, per D-83, keeps every row forever: one backup/
--      restore risk window instead of two, and one place where all four indexes are re-created
--      instead of two.
--
-- This table keeps its Phase-5 name `authoring_proposals` while now serving both authoring
-- sessions and task-execution runs (the recorded answer to `06-CONTEXT.md`'s rename-discretion
-- item): renaming would touch every query, DTO, index name and test for no behavioural gain on a
-- table whose rows are kept forever.
--
-- SQLite cannot `ALTER` a `CHECK` constraint in place (D-97's `target_type` widening and D-102's
-- `status` widening both touch one), so this is a full rebuild — `0006_recovery_statuses.sql`'s
-- exact documented five-step sequence: `CREATE TABLE authoring_proposals_new (...)` with both
-- widened CHECK constraints and all four new nullable columns, an explicit-column
-- `INSERT INTO ... SELECT ... FROM authoring_proposals` (never `SELECT *`), `DROP TABLE
-- authoring_proposals`, `ALTER TABLE authoring_proposals_new RENAME TO authoring_proposals`, then
-- re-creating ALL FOUR indexes `0011_authoring_staging.sql` and `0012_authoring_proposals_
-- project_status_index.sql` defined — `DROP TABLE` drops every index on the table and `RENAME TO`
-- does not resurrect them (0006's own documented lesson).
--
-- `authoring_proposals` is self-referential (`parent_proposal_id TEXT REFERENCES
-- authoring_proposals(id)`) — the same shape `0006`'s own header warns about for `agent_runs`.
-- `db::open_and_migrate` already toggles `PRAGMA foreign_keys` OFF around `MIGRATIONS.to_latest()`
-- and runs `PRAGMA foreign_key_check` afterward (the Phase 3 decision, `0006`'s own header) — this
-- rebuild depends on that connection-level toggle exactly as `0010_authoring_runs.sql`'s and
-- `0013_authoring_summaries.sql`'s rebuilds already do. No `PRAGMA foreign_keys` statement is
-- added inside this file's own SQL: `rusqlite_migration` runs every migration body inside its own
-- transaction, and SQLite ignores `PRAGMA foreign_keys` once a transaction is already open, so a
-- pragma toggle here would be a documented no-op (0006's own header comment, restated here for
-- this table's identical self-reference).
CREATE TABLE authoring_proposals_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT REFERENCES epics(id),
    verb TEXT NOT NULL CHECK (verb IN ('create', 'amend', 'delete')),
    target_type TEXT NOT NULL CHECK (target_type IN ('epic', 'task', 'criterion', 'assumption', 'issue')),
    target_id TEXT,
    parent_proposal_id TEXT REFERENCES authoring_proposals(id),
    position TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'merged', 'deferred')),
    rejection_reason TEXT,
    materialised_id TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    decided_by TEXT REFERENCES actors(id),
    decided_at TEXT,
    rationale TEXT,
    origin_log_offset INTEGER,
    duplicate_of TEXT,
    duplicate_score REAL
);

INSERT INTO authoring_proposals_new (
    id, agent_run_id, project_id, epic_id, verb, target_type, target_id, parent_proposal_id,
    position, payload, status, rejection_reason, materialised_id, created_by, created_at,
    decided_by, decided_at, rationale, origin_log_offset, duplicate_of, duplicate_score
)
SELECT
    id, agent_run_id, project_id, epic_id, verb, target_type, target_id, parent_proposal_id,
    position, payload, status, rejection_reason, materialised_id, created_by, created_at,
    decided_by, decided_at, NULL, NULL, NULL, NULL
FROM authoring_proposals;

DROP TABLE authoring_proposals;

ALTER TABLE authoring_proposals_new RENAME TO authoring_proposals;

-- Recreate all four indexes `0011_authoring_staging.sql` and
-- `0012_authoring_proposals_project_status_index.sql` defined — DROP TABLE drops them along with
-- the table, and CREATE TABLE ... RENAME TO does not resurrect them.
CREATE INDEX idx_authoring_proposals_run_status ON authoring_proposals (agent_run_id, status);
CREATE INDEX idx_authoring_proposals_epic_status ON authoring_proposals (epic_id, status, created_at DESC);
CREATE INDEX idx_authoring_proposals_parent ON authoring_proposals (parent_proposal_id);
CREATE INDEX idx_authoring_proposals_project_status
    ON authoring_proposals (project_id, status, created_at DESC);
