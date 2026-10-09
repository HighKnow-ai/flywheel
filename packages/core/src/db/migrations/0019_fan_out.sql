-- Planned fan-out (D-147, D-148, D-157, D-158, phase 09 plan 09-01): the declared file-set a task
-- will be held to, and the dispatch plan / wave / ordering-edge tables a fan-out is built from.
--
-- Owner decisions closing this schema's shape:
--   1. A file-set is CHILD ROWS (`task_file_set_entries`), not a JSON column: the overlap check and
--      the live-widen re-check are both per-entry questions, and a CHECK constraint can own the
--      two-form vocabulary (D-148) where a JSON blob cannot. Versioning is the event log, not a
--      version column (`task.file_set_declared` carries before/after).
--   2. `form` is exactly the two values `file_set::FILE_SET_FORMS` declares ('file' = an exact
--      repo-relative path, 'dir' = a directory prefix with a trailing slash). General globs are
--      refused before they reach this table (`file_set::parse_entry`); this CHECK is the backstop.
--   3. The three dispatch tables are created here because a migration is append-only and this
--      phase's table shape is already decided. Plan 09-01 reads only `task_file_set_entries`; the
--      dispatcher plans own the rest. The state vocabularies mirror `dispatch.rs`'s two constants
--      (single-list discipline, `WORKFLOW_STATES`).
--   4. `dispatch_edges.colliding_paths` freezes the colliding path pairs AT APPROVAL (D-157): after a
--      live widen a recomputed answer and the answer that was acted on are different answers, and
--      PLAN-07 asks for the second.
--   5. One live plan per epic, by a partial unique index — not by application code.
--   6. `idx_events_type_task` backs the per-task scope-event aggregate the board badge reads
--      (RESEARCH Pitfall 9); `perf_seed_1000` must stay inside its budget with it in place.
CREATE TABLE task_file_set_entries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    form TEXT NOT NULL CHECK (form IN ('file', 'dir')),
    path TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    UNIQUE (task_id, form, path)
);

CREATE INDEX idx_task_file_set_entries_task ON task_file_set_entries (task_id);

CREATE TABLE dispatch_plans (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    epic_id TEXT NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    planning_run_id TEXT REFERENCES agent_runs(id),
    status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'running', 'paused', 'completed', 'aborted')),
    wave_cursor INTEGER NOT NULL DEFAULT 1 CHECK (wave_cursor >= 1),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_dispatch_plans_one_live_per_epic
    ON dispatch_plans (epic_id)
    WHERE status IN ('draft', 'approved', 'running', 'paused');

CREATE TABLE dispatch_plan_tasks (
    plan_id TEXT NOT NULL REFERENCES dispatch_plans(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    wave INTEGER NOT NULL CHECK (wave >= 1),
    state TEXT NOT NULL CHECK (state IN (
        'planned', 'waiting', 'running', 'finished', 'merging', 'merged',
        'conflict', 'needs_attention', 'failed', 'stopped', 'held_by_limit', 'skipped'
    )),
    rationale TEXT,
    PRIMARY KEY (plan_id, task_id)
);

CREATE TABLE dispatch_edges (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    plan_id TEXT NOT NULL REFERENCES dispatch_plans(id) ON DELETE CASCADE,
    before_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    after_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    cause TEXT NOT NULL CHECK (cause IN ('overlap', 'widen')),
    -- JSON array of the colliding (earlier-entry, later-entry) pairs, frozen at approval (D-157).
    colliding_paths TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (plan_id, before_task_id, after_task_id)
);

CREATE INDEX idx_events_type_task ON events (event_type, task_id);
