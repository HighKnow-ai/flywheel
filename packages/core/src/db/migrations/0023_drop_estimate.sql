-- DRFT-05 / D-14 (phase 13 plan 03): `estimate` is dropped from BOTH `tasks` and `epics`. Nothing
-- reads it, so it is removed rather than drafted. Any value stored on any board item is discarded;
-- the recovery path is the pre-migration backup `db::open_and_migrate` writes before running this
-- file (D-18), never a hand-written down-migration.
--
-- SQLite refuses `ALTER TABLE ... DROP COLUMN` on a column named in a `CHECK` constraint, and
-- `estimate` is (`CHECK (estimate IS NULL OR estimate IN (1, 2, 3))`), so both tables are full
-- rebuilds — `0015_proposal_triage_extension.sql`'s documented five-step sequence: `CREATE TABLE
-- <name>_new (...)`, an explicit-column `INSERT ... SELECT` (never a star-select), `DROP TABLE`,
-- `ALTER TABLE ... RENAME TO`, then re-create everything `DROP TABLE` destroyed. For these two
-- tables that is more than the indexes `0015` had to restore:
--   * the three indexes `0002_board_schema.sql` defined on them, and
--   * the three FTS5 sync triggers per table (`tasks_ai/_ad/_au`, `epics_ai/_ad/_au`) — DROP TABLE
--     drops a table's triggers, and an external-content FTS5 table is kept in sync by nothing else
--     (`0002`'s own BOARD-06 note). The FTS virtual tables themselves are keyed by the base table's
--     hidden `rowid`, so the copy carries `rowid` across explicitly: a fresh rowid would orphan
--     every existing search hit.
--
-- `db::open_and_migrate` already toggles the foreign-key pragma OFF around `MIGRATIONS.to_latest()`
-- and runs `PRAGMA foreign_key_check` afterwards, so no pragma statement goes inside this file
-- (a foreign-key pragma toggle inside `rusqlite_migration`'s transaction is a documented no-op). With
-- foreign keys OFF, `DROP TABLE tasks` does not cascade into the `ON DELETE CASCADE` children
-- (`0019_fan_out.sql`), and every `REFERENCES tasks(id)` / `REFERENCES epics(id)` in the other
-- tables resolves by name to the rebuilt table.
--
-- This rebuild is deliberately reused as the early proof Phase 16's RECD-04 is conditional on
-- (D-15): `criterion_anchors` hangs off `acceptance_criteria(id)`, whose parent is a `tasks` row,
-- and `tests/migration_safety.rs::migration_0023_rebuild_preserves_criterion_anchors` asserts the
-- anchor rows survive this rebuild byte-identical.
--
-- `priority` keeps its column and its `CHECK (priority BETWEEN 0 AND 4)` unchanged (D-16).

-- epics first, so `tasks.epic_id REFERENCES epics(id)` resolves to the final table.
CREATE TABLE epics_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
    rank TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    assignee_id TEXT REFERENCES actors(id),
    integration_branch TEXT,
    archived_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO epics_new (
    rowid, id, project_id, key, title, description, status, rank, priority, assignee_id,
    integration_branch, archived_at, created_by, created_at, updated_at
)
SELECT
    rowid, id, project_id, key, title, description, status, rank, priority, assignee_id,
    integration_branch, archived_at, created_by, created_at, updated_at
FROM epics;

DROP TABLE epics;

ALTER TABLE epics_new RENAME TO epics;

CREATE INDEX idx_epics_project_status_rank ON epics (project_id, status, rank);

CREATE TRIGGER epics_ai AFTER INSERT ON epics BEGIN
    INSERT INTO epics_fts (rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER epics_ad AFTER DELETE ON epics BEGIN
    INSERT INTO epics_fts (epics_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER epics_au AFTER UPDATE ON epics BEGIN
    INSERT INTO epics_fts (epics_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO epics_fts (rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;

CREATE TABLE tasks_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT REFERENCES epics(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
    rank TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    assignee_id TEXT REFERENCES actors(id),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

INSERT INTO tasks_new (
    rowid, id, project_id, epic_id, key, title, description, status, rank, priority, assignee_id,
    created_by, created_at, updated_at
)
SELECT
    rowid, id, project_id, epic_id, key, title, description, status, rank, priority, assignee_id,
    created_by, created_at, updated_at
FROM tasks;

DROP TABLE tasks;

ALTER TABLE tasks_new RENAME TO tasks;

CREATE INDEX idx_tasks_project_status_rank ON tasks (project_id, status, rank);
CREATE INDEX idx_tasks_project_epic ON tasks (project_id, epic_id);

CREATE TRIGGER tasks_ai AFTER INSERT ON tasks BEGIN
    INSERT INTO tasks_fts (rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
CREATE TRIGGER tasks_ad AFTER DELETE ON tasks BEGIN
    INSERT INTO tasks_fts (tasks_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
END;
CREATE TRIGGER tasks_au AFTER UPDATE ON tasks BEGIN
    INSERT INTO tasks_fts (tasks_fts, rowid, title, description) VALUES ('delete', old.rowid, old.title, old.description);
    INSERT INTO tasks_fts (rowid, title, description) VALUES (new.rowid, new.title, new.description);
END;
