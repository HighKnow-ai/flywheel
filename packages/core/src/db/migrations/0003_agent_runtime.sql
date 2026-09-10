-- The agent runtime schema (DATA-04, DATA-06, D-23, D-24, D-25, D-26, D-29, D-30, D-34): triggers,
-- worktrees and agent runs — the three tables Phase 2's tracer slice needs to record "what fired a
-- run, where it ran, and what happened while it ran."
--
-- Owner decisions closing this schema's shape (plan 02-01 Task 1, recorded in 02-CONTEXT.md):
--   1. D-23/D-24/D-25/D-26: the worktree root (`~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/`) and the
--      `flywheel/` branch namespace are fixed forever once real history exists — rigidity is the
--      feature, not a user setting. `worktrees.path`/`branch`/`base_branch` record the resolved
--      values so the topology is readable from the row, never re-derived at read time.
--   2. D-29: an agent-started run is attributed to the seeded agent actor, never the human who
--      clicked Start Work — the board must never report progress an agent promoted for itself.
--   3. D-30: native `--resume`/`--continue` is deliberately unimplemented. "Session" therefore
--      collapses onto `agent_runs.external_session_id`, a column, not a peer table (see plan
--      02-01's `<assumption_delta_decision>`) — every session is exactly one `AgentRun`.
--   4. D-34: `agent_runs.log_path` is a pointer, not a blob — matches `Artifact.storage_ref`'s own
--      pointer-not-blob contract. The durable JSONL it names lives at
--      `<app-data>/sessions/<agent-run-id>.jsonl`, written by the Rust core only
--      (`session_log.rs`), never by the renderer.
--   5. DATA-04: `triggers.source` accepts `'user_action'`, `'schedule'`, `'webhook'` and
--      `'agent_proposal'` — only `'user_action'` is ever inserted by this phase's application
--      code. The CHECK constraint accepting the other three values IS the "accepted but
--      unimplemented" contract, enforced by the schema rather than app code, exactly as
--      `0002_board_schema.sql`'s comment block states for the five-state workflow CHECK.
--   6. DATA-06: the trigger -> worktree -> agent_run split is exactly these three tables — no
--      fourth "session" table exists this phase.

-- DATA-04: only 'user_action' is written by this phase's code; 'schedule'/'webhook' are accepted
-- by the schema (the automations milestone's future writers) and 'agent_proposal' is accepted for
-- a later phase's agent-initiated fan-out. `config` carries a schedule/webhook payload as JSON —
-- nullable because a user_action trigger carries none.
CREATE TABLE triggers (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    target_task_id TEXT NOT NULL REFERENCES tasks(id),
    source TEXT NOT NULL CHECK (source IN ('user_action', 'schedule', 'webhook', 'agent_proposal')),
    config TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    last_fired_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

-- One worktree per task, ever (LINK-01, WORK-08) — the UNIQUE constraint on task_id is the
-- invariant, not merely a convention: `ensure_worktree` checks this table before ever shelling
-- out to git (RESEARCH.md Pitfall 2), and a second Start Work reuses this row untouched.
-- `base_branch` records D-25/D-26's resolved base ref (the project's default_branch, or the
-- epic's lazily-cut integration branch) at creation time, so the topology is readable from the
-- row without re-deriving it.
CREATE TABLE worktrees (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'merged', 'abandoned')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

-- One row per agent session (D-30 collapses "session" onto this table's own
-- external_session_id column — see this file's header comment #3). `adapter` is AGNT-01's
-- backend-name discriminator, defaulted to the only adapter this phase implements.
-- `log_path` is D-34's pointer-not-blob contract (header comment #4).
CREATE TABLE agent_runs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    trigger_id TEXT NOT NULL REFERENCES triggers(id),
    adapter TEXT NOT NULL DEFAULT 'claude_code',
    actor_id TEXT NOT NULL REFERENCES actors(id),
    status TEXT NOT NULL CHECK (status IN ('running', 'blocked', 'completed', 'failed', 'interrupted')),
    external_session_id TEXT,
    permission_mode TEXT NOT NULL,
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    log_path TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
);

CREATE INDEX idx_agent_runs_task_started ON agent_runs (task_id, started_at DESC);
CREATE INDEX idx_agent_runs_project_status ON agent_runs (project_id, status);
CREATE INDEX idx_triggers_target_task ON triggers (target_task_id);

-- Seed the one agent actor this phase's code attributes agent-started runs to (D-29). A literal
-- ULID keeps this migration deterministic across every machine it runs on, exactly as
-- `0001_actors.sql` seeds its two rows.
INSERT INTO actors (id, type, display_name, auth_ref, created_at) VALUES
    ('01M21VR17D2SKYJMVH3P3DFJBW', 'agent', 'Claude Code', NULL, '2026-09-10T00:00:00.000Z');
