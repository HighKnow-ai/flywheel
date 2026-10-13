-- The recovery status vocabulary (WORK-06, D-45, D-49): teaches the schema the two states this
-- phase's recovery surfaces are made of. SQLite cannot ALTER a CHECK constraint in place, so both
-- tables are rebuilt with SQLite's own documented safe sequence (CREATE TABLE <name>_new / INSERT
-- INTO <name>_new SELECT ... FROM <name> / DROP TABLE <name> / ALTER TABLE <name>_new RENAME TO
-- <name>) — a full table rebuild, not a hand-written ALTER.
--
-- Owner decisions closing this migration's shape (plan 03-03 Task 1, recorded in 03-CONTEXT.md):
--   1. D-45: `worktrees.status` gains `'missing'` — a worktree the database calls `active` that is
--      not on disk. The row is never deleted and its path/branch/base_branch are never rewritten;
--      surfaced, never repaired. The three values migration `0003_agent_runtime.sql` already
--      accepted (`active`/`stale`/`merged`/`abandoned`) are untouched — D-45 explicitly rejected
--      reusing `stale`, and removing an accepted value here would be a separate, unasked-for
--      decision.
--   2. D-49: `agent_runs.status` gains `'abandoned'` — a run that was `running` when the app died,
--      written by the launch reconciler (`reconcile_worktrees`'s sibling, plan 03-03 Task 2's
--      `mark_abandoned`) and never by the dying process itself. This lets the activity trail
--      distinguish "the user stopped this" (`interrupted`) from "the app died under this"
--      (`abandoned`) — genuinely different facts about the same task.
--   3. `agent_runs.acknowledged_at` (nullable, no default) is added here because this table is
--      already being rebuilt for D-49, and a second rebuild later would be a second
--      backup-and-restore risk for no benefit. Plan 03-10's Acknowledge button writes it; plan
--      03-11's "Needs Decision" rollup reads it.
--
-- `open_and_migrate` (packages/core/src/db/mod.rs) disables `PRAGMA foreign_keys` around this
-- migration's `to_latest()` call: `agent_runs.worktree_id` is a real foreign key INTO the
-- `worktrees` row this migration rebuilds, and `permission_requests.agent_run_id` is a real
-- foreign key INTO the `agent_runs` row this migration also rebuilds. `DROP TABLE` on a table that
-- is the parent side of a foreign key with matching child rows fails under `PRAGMA foreign_keys =
-- ON` (verified directly against a real `sqlite3` binary while writing this migration) — toggling
-- the pragma from INSIDE this file's own SQL would be a no-op, since `rusqlite_migration` runs
-- every migration body inside its own transaction and SQLite ignores `PRAGMA foreign_keys` once a
-- transaction is already open (this is `rusqlite_migration`'s own documented behavior, not a
-- surprise). The toggle therefore lives at the connection level, before `to_latest()` is called,
-- exactly as that crate's own `foreign_key_check()` documentation recommends for a rebuild that
-- touches a referenced table.

-- `worktrees`: reproduces `0003_agent_runtime.sql`'s definition verbatim except the status CHECK.
CREATE TABLE worktrees_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'merged', 'abandoned', 'missing')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

INSERT INTO worktrees_new (
    id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
)
SELECT id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
FROM worktrees;

DROP TABLE worktrees;

ALTER TABLE worktrees_new RENAME TO worktrees;

-- `agent_runs`: reproduces `0003_agent_runtime.sql`'s definition verbatim except the status CHECK,
-- plus the new `acknowledged_at` column appended at the end of the column list.
CREATE TABLE agent_runs_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    trigger_id TEXT NOT NULL REFERENCES triggers(id),
    adapter TEXT NOT NULL DEFAULT 'claude_code',
    actor_id TEXT NOT NULL REFERENCES actors(id),
    status TEXT NOT NULL CHECK (status IN ('running', 'blocked', 'completed', 'failed', 'interrupted', 'abandoned')),
    external_session_id TEXT,
    permission_mode TEXT NOT NULL,
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    log_path TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    acknowledged_at TEXT
);

INSERT INTO agent_runs_new (
    id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
    started_at, ended_at, acknowledged_at
)
SELECT
    id, worktree_id, task_id, project_id, trigger_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
    started_at, ended_at, NULL
FROM agent_runs;

DROP TABLE agent_runs;

ALTER TABLE agent_runs_new RENAME TO agent_runs;

-- Recreate the two indexes `0003_agent_runtime.sql` defined on `agent_runs` — DROP TABLE drops
-- them along with the table, and CREATE TABLE ... RENAME TO does not resurrect them.
CREATE INDEX idx_agent_runs_task_started ON agent_runs (task_id, started_at DESC);
CREATE INDEX idx_agent_runs_project_status ON agent_runs (project_id, status);
