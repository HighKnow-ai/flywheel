-- Landing (ADR 0042, issue #1757). Merge takes a per-project landing mode, and a Story that was
-- pushed as a request, or handed to a landing command, waits in a new state, `landing`, until the
-- forge says the request merged.
--
-- 1. The project's setting: pull request (the default) or a landing command; the forge when it is
--    not read from the URL of `origin`; the method of the auto-merge. NULL `forge` means "detect".
ALTER TABLE projects ADD COLUMN landing_mode TEXT NOT NULL DEFAULT 'pull_request' CHECK (landing_mode IN ('pull_request', 'command'));
ALTER TABLE projects ADD COLUMN landing_command TEXT CHECK (landing_command IS NULL OR length(landing_command) > 0);
ALTER TABLE projects ADD COLUMN forge TEXT CHECK (forge IS NULL OR forge IN ('github', 'gitlab'));
ALTER TABLE projects ADD COLUMN landing_method TEXT NOT NULL DEFAULT 'squash' CHECK (landing_method IN ('squash', 'merge', 'rebase'));

-- 2. The new Story state. SQLite cannot widen a CHECK in place, so `stories` is rebuilt; the migration
--    runner turns `foreign_keys` off around every migration and runs `foreign_key_check` after it.
CREATE TABLE stories_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT NOT NULL REFERENCES epics(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    state TEXT NOT NULL CHECK (state IN ('shaping', 'ready', 'running', 'in_review', 'landing', 'merged', 'dropped')),
    runs_after_story_id TEXT REFERENCES stories(id),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    runs_after_reason TEXT CHECK (runs_after_reason IS NULL OR runs_after_story_id IS NOT NULL),
    UNIQUE (project_id, key),
    CHECK (runs_after_story_id IS NULL OR runs_after_story_id != id)
);
INSERT INTO stories_new (id, project_id, epic_id, key, title, description, state, runs_after_story_id, rank, created_by, created_at, updated_at, runs_after_reason)
SELECT id, project_id, epic_id, key, title, description, state, runs_after_story_id, rank, created_by, created_at, updated_at, runs_after_reason FROM stories;
DROP TABLE stories;
ALTER TABLE stories_new RENAME TO stories;
CREATE INDEX idx_stories_epic_rank ON stories (epic_id, rank);
CREATE INDEX idx_stories_project_state ON stories (project_id, state);

-- 3. What a Landing Story waits for: the request (when there is one), the forge's last answer and one
--    note for the developer (a missing or signed-out CLI, a request closed without merging). The
--    failing Checks the developer overrode at Merge are kept here until the Story is Merged.
CREATE TABLE landings (
    story_id TEXT PRIMARY KEY NOT NULL REFERENCES stories(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    -- `pull_request` or `command`.
    mode TEXT NOT NULL CHECK (mode IN ('pull_request', 'command')),
    forge TEXT CHECK (forge IS NULL OR forge IN ('github', 'gitlab')),
    branch TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    request_url TEXT,
    -- The request's last state, as Flywheel read it: `open`, `merged`, `closed`, or `unknown` before the first read.
    request_state TEXT NOT NULL CHECK (request_state IN ('unknown', 'open', 'merged', 'closed')),
    note TEXT,
    failing_checks_overridden TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(failing_checks_overridden) AND json_type(failing_checks_overridden) = 'array'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
