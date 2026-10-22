-- The roadmap Round (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #133).
--
-- A **roadmap Round** is a Round with no Stage: it belongs to the project's Roadmap, not to a record
-- being shaped. Something triggers it (`trigger_type`, with the record in `trigger_id`): the
-- developer's "Revisit roadmap" button (no record), an Epic confirmed Done, or a Milestone confirmed
-- Done (#134). Its shaping session (a project-level one: `sessions.epic_id` and `milestone_id` both
-- NULL) reads the Roadmap and either files Roadmap Proposals, which hang off the Round, or says the
-- Roadmap still holds. Its state is `open`, then `closed` (the Roadmap holds, or every Proposal it
-- filed is decided) or `dismissed` (the developer closed it with no change). A Stage's Round keeps
-- `open` and `answered`.
--
-- SQLite cannot relax a NOT NULL or widen a CHECK in place, so `rounds` is rebuilt; the migration
-- runner turns `foreign_keys` off around every migration and runs `foreign_key_check` after it.
CREATE TABLE rounds_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    -- NULL for a roadmap Round.
    stage_id TEXT REFERENCES stages(id),
    session_id TEXT REFERENCES sessions(id),
    -- Round 1, 2, ... within its Stage, or within the project's roadmap Rounds.
    number INTEGER NOT NULL CHECK (number >= 1),
    -- The agent's one-paragraph note on what the Round settles; for a roadmap Round, its trigger.
    note TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed', 'dismissed')),
    held_request_id TEXT,
    posted_at TEXT NOT NULL,
    answered_at TEXT,
    -- What started a roadmap Round, and the record it names (NULL for the Revisit roadmap button).
    trigger_type TEXT CHECK (trigger_type IS NULL OR trigger_type IN ('revisit', 'epic_done', 'milestone_done')),
    trigger_id TEXT,
    -- When and by whom a roadmap Round was closed or dismissed.
    closed_at TEXT,
    closed_by TEXT REFERENCES actors(id),
    -- A roadmap Round has a trigger and no Stage; a Stage's Round has a Stage and no trigger.
    CHECK ((stage_id IS NULL) = (trigger_type IS NOT NULL)),
    CHECK (trigger_type IS NOT NULL OR trigger_id IS NULL),
    CHECK (trigger_type IS NULL OR (trigger_type = 'revisit') = (trigger_id IS NULL)),
    -- A Stage's Round is open or answered; a roadmap Round is open, closed or dismissed.
    CHECK (stage_id IS NULL OR state IN ('open', 'answered')),
    CHECK (stage_id IS NOT NULL OR state IN ('open', 'closed', 'dismissed')),
    CHECK ((state = 'answered') = (answered_at IS NOT NULL)),
    CHECK ((state IN ('closed', 'dismissed')) = (closed_at IS NOT NULL)),
    CHECK ((state IN ('closed', 'dismissed')) = (closed_by IS NOT NULL)),
    CHECK (state = 'open' OR held_request_id IS NULL),
    UNIQUE (stage_id, number)
);

INSERT INTO rounds_new (id, project_id, stage_id, session_id, number, note, state, held_request_id, posted_at, answered_at)
SELECT r.id, s.project_id, r.stage_id, r.session_id, r.number, r.note, r.state, r.held_request_id, r.posted_at, r.answered_at
FROM rounds r JOIN stages s ON s.id = r.stage_id;

DROP TABLE rounds;
ALTER TABLE rounds_new RENAME TO rounds;

CREATE UNIQUE INDEX idx_rounds_one_open_per_stage ON rounds (stage_id) WHERE state = 'open' AND stage_id IS NOT NULL;
-- A project has at most one open roadmap Round, and numbers its roadmap Rounds 1, 2, ...
CREATE UNIQUE INDEX idx_rounds_one_open_roadmap ON rounds (project_id) WHERE stage_id IS NULL AND state = 'open';
CREATE UNIQUE INDEX idx_rounds_roadmap_number ON rounds (project_id, number) WHERE stage_id IS NULL;

-- An Epic can be dropped (docs/mvp-spec.md §3: a roadmap Round may find "one to drop"), by an accepted
-- Roadmap Proposal. A Dropped Epic, like a Dropped Story, stays readable and counts as closed for its
-- Milestone. `epics` is rebuilt to widen its state CHECK.
CREATE TABLE epics_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    milestone_id TEXT NOT NULL REFERENCES milestones(id),
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    problem TEXT,
    scope TEXT,
    out_of_scope TEXT,
    exit_test TEXT,
    state TEXT NOT NULL CHECK (state IN ('shaping', 'ready', 'done', 'dropped')),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, key)
);

INSERT INTO epics_new (id, project_id, milestone_id, key, title, problem, scope, out_of_scope, exit_test, state, rank,
    created_by, created_at, updated_at)
SELECT id, project_id, milestone_id, key, title, problem, scope, out_of_scope, exit_test, state, rank,
    created_by, created_at, updated_at
FROM epics;

DROP TABLE epics;
ALTER TABLE epics_new RENAME TO epics;

CREATE INDEX idx_epics_milestone_rank ON epics (milestone_id, rank);
