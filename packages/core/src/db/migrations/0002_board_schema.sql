-- The board schema (DATA-01, DATA-05, D-06, D-10, D-11, D-13, D-14, D-17): projects, the
-- three-level hierarchy (epics/tasks/issues), acceptance criteria, and the append-only event log.
--
-- Owner decisions closing this schema's shape (2026-09-09, plan 01-03 Task 1, recorded in
-- 01-UI-SPEC.md "Open Decisions the Builder Must Not Invent" #4/#5/#6/#7/#11):
--   1. epics and tasks share ONE five-state status CHECK (BOARD-04); issues carry no status
--      column and keep their own separate, workflow-less lane (Phase 6 adds their triage
--      lifecycle). ARCHITECTURE.md section 2's epic lifecycle enum is re-homed, not discarded:
--      `integrating` -> status 'in_review' PLUS `epics.integration_branch`; `archived` ->
--      `epics.archived_at` (orthogonal to status); `draft`/`active` -> 'backlog'/'in_progress'.
--   2. `assignee_id` exists, nullable, on both `tasks` and `epics` (BOARD-06).
--   3. Priority is the 5-level Linear convention, keyed 0-4 exactly as the keyboard map: 0 = No
--      priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low. `No priority` (0) SORTS LAST — every
--      query orders by a sort-key expression that maps 0 to the bottom, never by the raw stored
--      value (see packages/core/src/query/mod.rs).
--   4. Estimate is S/M/L, stored as a nullable ordinal INTEGER 1-3 (S=1, M=2, L=3) — never
--      aggregated anywhere (D-12).
--   5. The project key prefix is user-typed with a derived default; it becomes immutable once the
--      project has allocated its first item key (enforced in
--      packages/core/src/domain/project.rs::update_key_prefix, not merely documented).

CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    key_counter INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('active', 'unreachable')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

-- epics and tasks share one workflow vocabulary (BOARD-04, Open Decisions #5).
CREATE TABLE epics (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
    rank TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    estimate INTEGER CHECK (estimate IS NULL OR estimate IN (1, 2, 3)),
    assignee_id TEXT REFERENCES actors(id),
    -- ARCHITECTURE.md section 2's `integrating` state, re-homed onto status='in_review' plus this
    -- column (Open Decisions #5). Unused until Phase 8; added now so that phase needs no schema
    -- change.
    integration_branch TEXT,
    -- ARCHITECTURE.md section 2's `archived` state, re-homed as an orthogonal timestamp: an
    -- archived epic retains whatever status it had (Open Decisions #5).
    archived_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    -- Nullable by design (D-13): a task may exist before its epic is known. No board query in
    -- this crate may use a bare inner join to `epics` (01-RESEARCH.md Pitfall 4).
    epic_id TEXT REFERENCES epics(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
    rank TEXT NOT NULL,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 0 AND 4),
    estimate INTEGER CHECK (estimate IS NULL OR estimate IN (1, 2, 3)),
    assignee_id TEXT REFERENCES actors(id),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Issues are proposals and notes, not units of work (D-07) — no status column, per Open
-- Decisions #5. They keep a separate, workflow-less lane in the board UI.
CREATE TABLE issues (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT REFERENCES epics(id),
    task_id TEXT REFERENCES tasks(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'question', 'risk')),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Their own table with their own ULIDs (D-06) — Phase 4's revisioning is an additive column,
-- Phase 8 can check a single criterion without rewriting its parent.
CREATE TABLE acceptance_criteria (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    parent_type TEXT NOT NULL CHECK (parent_type IN ('task', 'epic')),
    parent_id TEXT NOT NULL,
    statement TEXT NOT NULL,
    verification_hint TEXT,
    checked INTEGER NOT NULL DEFAULT 0 CHECK (checked IN (0, 1)),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- The append-only change feed (DATA-01, D-17, D-19). `sequence` is keyed per (project_id, origin)
-- — never a single per-project counter (01-RESEARCH.md Pitfall 2) — with the ULID `id` carrying
-- global ordering so a second origin's stream can interleave later without renumbering anything.
-- `task_id`/`epic_id` are denormalised at write time, even for criterion-stream events, so the
-- activity trail is one indexed query (D-19).
CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    origin TEXT NOT NULL DEFAULT 'local',
    sequence INTEGER NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    task_id TEXT,
    epic_id TEXT,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE (project_id, origin, sequence)
);

CREATE TABLE event_sequence_counters (
    project_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    next_seq INTEGER NOT NULL,
    PRIMARY KEY (project_id, origin)
);

-- Composite indexes backing every board/query path (D-03, BOARD-08 at 1,000+ items).
CREATE INDEX idx_epics_project_status_rank ON epics (project_id, status, rank);
CREATE INDEX idx_tasks_project_status_rank ON tasks (project_id, status, rank);
CREATE INDEX idx_tasks_project_epic ON tasks (project_id, epic_id);
CREATE INDEX idx_events_task_id ON events (task_id);
CREATE INDEX idx_events_epic_id ON events (epic_id);
CREATE INDEX idx_events_project_origin_sequence ON events (project_id, origin, sequence);
CREATE INDEX idx_acceptance_criteria_parent_rank ON acceptance_criteria (parent_type, parent_id, rank);

-- FTS5 external-content search (BOARD-06). External-content tables do not update themselves —
-- the three triggers on each base table are the only synchronisation mechanism
-- (01-RESEARCH.md Pattern 3 / Pitfall 3). `tasks.id`/`epics.id`/`issues.id` are declared
-- `TEXT PRIMARY KEY`, not `INTEGER PRIMARY KEY`, so each table still has an ordinary hidden
-- `rowid` and `content_rowid=rowid` is valid without `WITHOUT ROWID`.
CREATE VIRTUAL TABLE tasks_fts USING fts5(title, description, content = tasks, content_rowid = rowid);

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

CREATE VIRTUAL TABLE epics_fts USING fts5(title, description, content = epics, content_rowid = rowid);

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

-- Issues use `body`, not `description` (their own field name), as the second indexed column.
CREATE VIRTUAL TABLE issues_fts USING fts5(title, body, content = issues, content_rowid = rowid);

CREATE TRIGGER issues_ai AFTER INSERT ON issues BEGIN
    INSERT INTO issues_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER issues_ad AFTER DELETE ON issues BEGIN
    INSERT INTO issues_fts (issues_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER issues_au AFTER UPDATE ON issues BEGIN
    INSERT INTO issues_fts (issues_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
    INSERT INTO issues_fts (rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
