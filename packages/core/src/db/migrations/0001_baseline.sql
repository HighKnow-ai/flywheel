-- The MVP baseline (ADR 0003, docs/mvp-spec.md §2, §4, §9). It replaces v0.1's migrations
-- 0001-0024 and holds only the new model. A v0.1 database is never upgraded: `db::open_and_migrate`
-- moves it aside as a file before this runs. Fields a later surface needs are added by ordinary
-- migrations on top of this one.
--
-- Conventions every table follows:
--   * ids are ULIDs (26 characters), timestamps RFC 3339 text;
--   * `created_by` / `actor_id` name an `actors` row, so every write is attributed;
--   * `rank` is a fractional index (`ranking.rs`) giving a stable order inside a parent;
--   * a state column carries a CHECK naming its closed set, so SQLite rejects any other value;
--   * a derived fact (Epic "In progress", a stale Check result, attention) is never stored.

-- Identity: the local human, Flywheel itself, and the Claude Code agent.
CREATE TABLE actors (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    type TEXT NOT NULL CHECK (type IN ('human', 'agent', 'system')),
    display_name TEXT NOT NULL,
    auth_ref TEXT,
    created_at TEXT NOT NULL
);

INSERT INTO actors (id, type, display_name, auth_ref, created_at) VALUES
    ('01M21VR17BZ33DG1X564KV0YEW', 'system', 'Flywheel', NULL, '2026-09-09T00:00:00.000Z'),
    ('01M21VR17C2SKYJMVH3P3DFJBW', 'human', 'Local User', NULL, '2026-09-09T00:00:00.000Z'),
    ('01M21VR17D2SKYJMVH3P3DFJBW', 'agent', 'Claude Code', NULL, '2026-09-10T00:00:00.000Z');

-- A registered repository. `key_counter` numbers its Epics and Stories (`FLY-12`).
-- `credential_mode` NULL means "use the global default" (the secret itself lives in the Keychain).
CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    key_prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    repo_path TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    key_counter INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('active', 'unreachable')),
    credential_mode TEXT CHECK (credential_mode IS NULL OR credential_mode IN ('local', 'api_key')),
    hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

-- Global key/value settings. The row is its own audit record (a global setting has no project
-- stream to append an event to).
CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_by TEXT NOT NULL REFERENCES actors(id),
    updated_at TEXT NOT NULL
);

-- Milestone: an outcome with an exit test and no date. `rank` is its place in the Roadmap, so the
-- Roadmap is "every Milestone of a project ORDER BY rank". The Current Milestone is derived (the
-- first by rank that is neither done nor dropped), never stored. Stored states are the ones the
-- developer sets; Ready (shaping closed, no Story started) versus In progress is derived from its
-- Epics, exactly as for an Epic.
CREATE TABLE milestones (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    title TEXT NOT NULL,
    exit_test TEXT,
    state TEXT NOT NULL CHECK (state IN ('shaping', 'ready', 'done', 'dropped')),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX idx_milestones_project_rank ON milestones (project_id, rank);

-- Epic: a capability inside exactly one Milestone, described by a short spec (problem, scope, out
-- of scope) and an exit test. `state` holds what the developer sets: shaping, ready (shaping
-- closed) and done (exit test confirmed). In progress is derived from its Stories.
CREATE TABLE epics (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    milestone_id TEXT NOT NULL REFERENCES milestones(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    problem TEXT,
    scope TEXT,
    out_of_scope TEXT,
    exit_test TEXT,
    state TEXT NOT NULL CHECK (state IN ('shaping', 'ready', 'done')),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, key)
);
CREATE INDEX idx_epics_milestone_rank ON epics (milestone_id, rank);

-- Story: a thin vertical slice inside exactly one Epic; the unit an agent executes in its own
-- worktree. `rank` is its execution order inside the Epic. `runs_after_story_id` is the
-- informational "runs after Story X" marker and never blocks a start.
CREATE TABLE stories (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT NOT NULL REFERENCES epics(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    state TEXT NOT NULL CHECK (state IN ('shaping', 'ready', 'running', 'in_review', 'merged', 'dropped')),
    runs_after_story_id TEXT REFERENCES stories(id),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, key),
    CHECK (runs_after_story_id IS NULL OR runs_after_story_id != id)
);
CREATE INDEX idx_stories_epic_rank ON stories (epic_id, rank);
CREATE INDEX idx_stories_project_state ON stories (project_id, state);

-- Task: one step of a Story's checklist, written by the Story's agent. Not a board item of its
-- own. At most one Task of a Story is `doing`; a dropped Task carries its one-line reason.
CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'doing', 'done', 'dropped')),
    dropped_reason TEXT,
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((state = 'dropped') = (dropped_reason IS NOT NULL))
);
CREATE INDEX idx_tasks_story_rank ON tasks (story_id, rank);
CREATE UNIQUE INDEX idx_tasks_one_doing_per_story ON tasks (story_id) WHERE state = 'doing';

-- Acceptance criterion: a testable statement anchored to exactly one Story (`story_id` NOT NULL,
-- and a criterion can never move to another Story: the domain has no writer for the column).
-- Acceptance is the developer's act at review: `accepted_by` names a human actor, checked by the
-- writer inside its own transaction.
CREATE TABLE acceptance_criteria (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    story_id TEXT NOT NULL REFERENCES stories(id),
    statement TEXT NOT NULL,
    accepted_by TEXT REFERENCES actors(id),
    accepted_at TEXT,
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((accepted_by IS NULL) = (accepted_at IS NULL))
);
CREATE INDEX idx_acceptance_criteria_story_rank ON acceptance_criteria (story_id, rank);

-- Check: the optional shell command attached to one criterion, run from the worktree root at
-- hand-off. Only the developer edits it; editing it resets its result to "not run" (a run older
-- than `updated_at` is not the current result).
CREATE TABLE checks (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    criterion_id TEXT NOT NULL UNIQUE REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
    command TEXT NOT NULL,
    timeout_secs INTEGER NOT NULL DEFAULT 600 CHECK (timeout_secs > 0),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Check run: one run of record, tied to the commit it ran against. "Not run" is the absence of a
-- current row; "stale" is derived by comparing `commit_sha` with the branch head.
CREATE TABLE check_runs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
    commit_sha TEXT NOT NULL,
    result TEXT NOT NULL CHECK (result IN ('passed', 'failed', 'timed_out')),
    exit_code INTEGER,
    output_tail TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL
);
CREATE INDEX idx_check_runs_check_started ON check_runs (check_id, started_at DESC);

-- A git worktree owned by one Story, reused by every session of that Story.
CREATE TABLE worktrees (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    story_id TEXT NOT NULL UNIQUE REFERENCES stories(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'missing')),
    size_bytes INTEGER,
    size_measured_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

-- One agent session on one Story. Always a fresh session (never `claude --resume`);
-- `external_session_id` is Claude's own id, kept for debugging only.
CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    story_id TEXT NOT NULL REFERENCES stories(id),
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
    acknowledged_at TEXT
);
CREATE INDEX idx_sessions_story_started ON sessions (story_id, started_at DESC);
CREATE INDEX idx_sessions_project_status ON sessions (project_id, status);
CREATE INDEX idx_sessions_fleet ON sessions (status, acknowledged_at, started_at);

-- Session summary: the note a session leaves for the next one, in the spec's two fields. A stub is
-- what Flywheel writes for a session that ended without handing off. Never rewritten.
CREATE TABLE session_summaries (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    story_id TEXT NOT NULL REFERENCES stories(id),
    next_session_must_know TEXT NOT NULL,
    decisions TEXT NOT NULL,
    is_stub INTEGER NOT NULL DEFAULT 0 CHECK (is_stub IN (0, 1)),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);
CREATE INDEX idx_session_summaries_story_created ON session_summaries (story_id, created_at, id);
CREATE INDEX idx_session_summaries_session ON session_summaries (session_id);

-- Proposal: a change an agent suggests to a board record, an ADR or a glossary term. It has no
-- effect until the developer accepts it. `epic_id` is the Epic it lands on (its packet carries the
-- reasons of rejected Proposals); NULL for a Roadmap-level Proposal.
CREATE TABLE proposals (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    session_id TEXT REFERENCES sessions(id),
    epic_id TEXT REFERENCES epics(id),
    verb TEXT NOT NULL CHECK (verb IN ('create', 'amend', 'reorder', 'retire')),
    target_type TEXT NOT NULL CHECK (target_type IN ('milestone', 'epic', 'story', 'criterion', 'adr', 'glossary_term')),
    target_id TEXT,
    payload TEXT NOT NULL,
    rationale TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected')),
    rejection_reason TEXT,
    duplicate_of TEXT REFERENCES proposals(id),
    decided_by TEXT REFERENCES actors(id),
    decided_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    CHECK ((state = 'pending') = (decided_by IS NULL)),
    CHECK (rejection_reason IS NULL OR state = 'rejected')
);
CREATE INDEX idx_proposals_project_state ON proposals (project_id, state, created_at);
CREATE INDEX idx_proposals_epic_state ON proposals (epic_id, state);

-- ADR link: an ADR lives in the managed project's repo; the board only links to it by path, from
-- exactly one Milestone, Epic or Story.
CREATE TABLE adr_links (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    path TEXT NOT NULL,
    milestone_id TEXT REFERENCES milestones(id),
    epic_id TEXT REFERENCES epics(id),
    story_id TEXT REFERENCES stories(id),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    CHECK ((milestone_id IS NOT NULL) + (epic_id IS NOT NULL) + (story_id IS NOT NULL) = 1)
);
CREATE INDEX idx_adr_links_project_path ON adr_links (project_id, path);

-- A permission request a session raised: a Gated action (`destructive_category` set, asked every
-- time) or an ordinary request. It waits indefinitely and expires with its session.
CREATE TABLE permission_requests (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    story_id TEXT NOT NULL REFERENCES stories(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    tool_name TEXT NOT NULL,
    input_payload TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'allowed_always')),
    destructive_category TEXT,
    resolved_by TEXT REFERENCES actors(id),
    resolved_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);
CREATE INDEX idx_permission_requests_session_status ON permission_requests (session_id, status);
CREATE INDEX idx_permission_requests_project_status ON permission_requests (project_id, status);

-- "Always allow <pattern> in this project": keyed by (project, tool, pattern), in Claude Code's
-- syntax. No session scope and no global scope exist, so neither can be expressed.
CREATE TABLE permission_rules (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    tool TEXT NOT NULL,
    pattern TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    UNIQUE (project_id, tool, pattern)
);

-- The append-only event log. Every board mutation writes one row in the same transaction as the
-- row it changes. `story_id` / `epic_id` are denormalised so a record's timeline is one indexed
-- read. `sequence` is per (project, origin), the cursor a future relay reads.
CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    origin TEXT NOT NULL DEFAULT 'local',
    sequence INTEGER NOT NULL,
    stream_type TEXT NOT NULL,
    stream_id TEXT NOT NULL,
    story_id TEXT,
    epic_id TEXT,
    actor_id TEXT NOT NULL REFERENCES actors(id),
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    UNIQUE (project_id, origin, sequence)
);
CREATE INDEX idx_events_story_id ON events (story_id);
CREATE INDEX idx_events_epic_id ON events (epic_id);
CREATE INDEX idx_events_project_origin_sequence ON events (project_id, origin, sequence);

CREATE TABLE event_sequence_counters (
    project_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    next_seq INTEGER NOT NULL,
    PRIMARY KEY (project_id, origin)
);
