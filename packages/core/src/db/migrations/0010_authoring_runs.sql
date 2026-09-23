-- D-84 (plan 05-02): an epic-authoring session IS an `agent_run`. `agent_runs.task_id` loses its
-- `NOT NULL`, a nullable `epic_id` is added, and a nullable `authoring_stage` is added so a run
-- can carry D-88's three-stage machine. `triggers.target_task_id` is loosened the same way, with
-- its own nullable `target_epic_id` sibling — a fresh-epic authoring run has no task to point a
-- trigger at either.
--
-- This is the CHECK-constrained rebuild `0006_recovery_statuses.sql` already worked out: SQLite
-- cannot ALTER a CHECK constraint (or drop a NOT NULL) in place, so both tables are rebuilt with
-- the same documented safe sequence (CREATE TABLE <name>_new / explicit-column INSERT INTO
-- <name>_new SELECT ... FROM <name> / DROP TABLE <name> / ALTER TABLE <name>_new RENAME TO
-- <name>). Numbered before `0011_authoring_staging.sql` on purpose: `authoring_proposals.agent_run_id`
-- references `agent_runs`, so this rebuild must land first or the new table would be a child of a
-- table about to be dropped.
--
-- `db::open_and_migrate` already toggles `PRAGMA foreign_keys` OFF around `MIGRATIONS.to_latest()`
-- and runs `PRAGMA foreign_key_check` afterwards (the Phase 3 decision, `0006_recovery_statuses.sql`'s
-- own header) — this migration's rebuild of two tables that are each the parent side of a real
-- foreign key (`session_summaries.agent_run_id`, `permission_requests.agent_run_id`,
-- `agent_runs.trigger_id` -> `triggers.id`) depends on that toggle being in place, exactly as the
-- earlier rebuild did.
--
-- `triggers`: reproduces `0003_agent_runtime.sql`'s definition verbatim except `target_task_id`
-- losing NOT NULL, plus a nullable `target_epic_id` and the two-subject CHECK.
CREATE TABLE triggers_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    target_task_id TEXT REFERENCES tasks(id),
    target_epic_id TEXT REFERENCES epics(id),
    source TEXT NOT NULL CHECK (source IN ('user_action', 'schedule', 'webhook', 'agent_proposal')),
    config TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    last_fired_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    CHECK (NOT (target_task_id IS NOT NULL AND target_epic_id IS NOT NULL))
);

INSERT INTO triggers_new (
    id, project_id, target_task_id, target_epic_id, source, config, enabled, last_fired_at,
    created_by, created_at
)
SELECT id, project_id, target_task_id, NULL, source, config, enabled, last_fired_at,
    created_by, created_at
FROM triggers;

DROP TABLE triggers;

ALTER TABLE triggers_new RENAME TO triggers;

CREATE INDEX idx_triggers_target_task ON triggers (target_task_id);
CREATE INDEX idx_triggers_target_epic ON triggers (target_epic_id);

-- `agent_runs`: reproduces `0009_criteria_revisions.sql`'s cumulative definition verbatim (every
-- column `0003_agent_runtime.sql` defined, plus `acknowledged_at` from `0006_recovery_statuses.sql`,
-- `exit_summary_id` from `0008_session_summaries.sql`, and `criteria_revision_pin` from
-- `0009_criteria_revisions.sql`) except four changes: `task_id` loses NOT NULL; a nullable
-- `epic_id` is added; a nullable `authoring_stage` is added, CHECK-constrained to D-88's three
-- named stages; and a table-level CHECK forbids a run from claiming both a task and an epic as its
-- subject at once.
CREATE TABLE agent_runs_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT REFERENCES tasks(id),
    epic_id TEXT REFERENCES epics(id),
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
    acknowledged_at TEXT,
    exit_summary_id TEXT,
    criteria_revision_pin TEXT,
    authoring_stage TEXT CHECK (authoring_stage IS NULL OR authoring_stage IN ('challenge', 'decompose', 'criteria')),
    CHECK (NOT (task_id IS NOT NULL AND epic_id IS NOT NULL))
);

INSERT INTO agent_runs_new (
    id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
    started_at, ended_at, acknowledged_at, exit_summary_id, criteria_revision_pin, authoring_stage
)
SELECT
    id, worktree_id, task_id, NULL, project_id, trigger_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
    started_at, ended_at, acknowledged_at, exit_summary_id, criteria_revision_pin, NULL
FROM agent_runs;

DROP TABLE agent_runs;

ALTER TABLE agent_runs_new RENAME TO agent_runs;

-- Recreate every index `0003_agent_runtime.sql` defined on `agent_runs` — DROP TABLE drops them
-- along with the table, and CREATE TABLE ... RENAME TO does not resurrect them — plus the new
-- epic-scoped index D-84's second subject needs.
CREATE INDEX idx_agent_runs_task_started ON agent_runs (task_id, started_at DESC);
CREATE INDEX idx_agent_runs_project_status ON agent_runs (project_id, status);
CREATE INDEX idx_agent_runs_epic_started ON agent_runs (epic_id, started_at DESC);
