-- Shaping sessions (docs/mvp-spec.md §3, issue #122). A session is of one of two kinds:
--
--   * `story`: executes one Story in its worktree. `story_id` is set; `epic_id` and `milestone_id`
--     are NULL (the Story's own Epic is read through `stories`, never copied here).
--   * `shaping`: shapes a board record with the developer, read-only, in the project's checkout.
--     `story_id` and `worktree_id` are NULL. Its subject is `epic_id` (an Epic), `milestone_id` (a
--     Milestone's exit test) or neither (the Roadmap); never both.
--
-- SQLite cannot drop a NOT NULL or add a table CHECK in place, so the table is rebuilt.
-- `db::open_and_migrate_with` turns `foreign_keys` off around every migration and runs
-- `foreign_key_check` after it, so the drop below does not trip the rows that reference sessions.
CREATE TABLE sessions_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    kind TEXT NOT NULL DEFAULT 'story' CHECK (kind IN ('story', 'shaping')),
    story_id TEXT REFERENCES stories(id),
    epic_id TEXT REFERENCES epics(id),
    milestone_id TEXT REFERENCES milestones(id),
    worktree_id TEXT REFERENCES worktrees(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
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
    ending_reason TEXT CHECK (ending_reason IS NULL OR ending_reason IN (
        'refusal', 'usage_limit', 'api_error', 'crash', 'app_quit', 'stopped_by_developer',
        'ended_without_hand_off', 'handed_off', 'unknown'
    )),
    -- A Story session has a Story, and only a Story session does.
    CHECK ((kind = 'story') = (story_id IS NOT NULL)),
    -- The shaping subject belongs to shaping sessions alone, and is at most one record.
    CHECK (kind = 'shaping' OR (epic_id IS NULL AND milestone_id IS NULL)),
    CHECK (epic_id IS NULL OR milestone_id IS NULL),
    -- Shaping is read-only in the project's checkout: it never owns a worktree.
    CHECK (kind = 'story' OR worktree_id IS NULL)
);

INSERT INTO sessions_new (
    id, kind, story_id, epic_id, milestone_id, worktree_id, project_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path, started_at,
    ended_at, acknowledged_at, ending_reason
)
SELECT
    id, 'story', story_id, NULL, NULL, worktree_id, project_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path, started_at,
    ended_at, acknowledged_at, ending_reason
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_story_started ON sessions (story_id, started_at DESC);
CREATE INDEX idx_sessions_project_status ON sessions (project_id, status);
CREATE INDEX idx_sessions_fleet ON sessions (status, acknowledged_at, started_at);
-- An Epic's or a Milestone's shaping sessions, newest first: the card's live-session read.
CREATE INDEX idx_sessions_epic_started ON sessions (epic_id, started_at DESC) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_sessions_milestone_started ON sessions (milestone_id, started_at DESC) WHERE milestone_id IS NOT NULL;
