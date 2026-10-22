-- Stages and Rounds (docs/mvp-spec.md §3, GLOSSARY.md "Stage" and "Round", issue #123).
--
-- A **Stage** is one step of shaping a record: an Epic has three, in order (challenge the spec,
-- slice it into Stories, write the Acceptance criteria), a Milestone has one (its exit test). It
-- belongs to exactly one subject, an Epic or a Milestone. At most one Stage of a subject is open at
-- a time; the developer closes it.
CREATE TABLE stages (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT REFERENCES epics(id),
    milestone_id TEXT REFERENCES milestones(id),
    kind TEXT NOT NULL CHECK (kind IN ('challenge_spec', 'slice', 'criteria', 'exit_test')),
    state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
    -- The Stage's place in its subject's order: 1, 2, 3 for an Epic, 1 for a Milestone.
    rank INTEGER NOT NULL CHECK (rank >= 1),
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    closed_by TEXT REFERENCES actors(id),
    -- Exactly one subject.
    CHECK ((epic_id IS NULL) != (milestone_id IS NULL)),
    -- An Epic's Stages and a Milestone's Stage are different kinds.
    CHECK (epic_id IS NULL OR kind IN ('challenge_spec', 'slice', 'criteria')),
    CHECK (milestone_id IS NULL OR kind = 'exit_test'),
    -- A closed Stage records when and by whom; an open one carries neither.
    CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
    CHECK ((state = 'closed') = (closed_by IS NOT NULL))
);
CREATE UNIQUE INDEX idx_stages_epic_kind ON stages (epic_id, kind) WHERE epic_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stages_milestone_kind ON stages (milestone_id, kind) WHERE milestone_id IS NOT NULL;
CREATE UNIQUE INDEX idx_stages_one_open_per_epic ON stages (epic_id) WHERE epic_id IS NOT NULL AND state = 'open';
CREATE UNIQUE INDEX idx_stages_one_open_per_milestone ON stages (milestone_id) WHERE milestone_id IS NOT NULL AND state = 'open';

-- A **Round** is a batch of numbered questions an agent asks during a Stage. Posted by a shaping
-- session's `round_post` call, which is held until the developer has answered every question:
-- `held_request_id` is that call's request id, cleared once the call is answered. At most one Round
-- of a Stage is open at a time. A Round outlives the session that posted it: its answers are on the
-- board, so a later session picks up where it stopped.
CREATE TABLE rounds (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    stage_id TEXT NOT NULL REFERENCES stages(id),
    session_id TEXT REFERENCES sessions(id),
    -- Round 1, 2, ... within its Stage.
    number INTEGER NOT NULL CHECK (number >= 1),
    -- The agent's one-paragraph note on what the Round settles.
    note TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open', 'answered')),
    held_request_id TEXT,
    posted_at TEXT NOT NULL,
    answered_at TEXT,
    CHECK ((state = 'answered') = (answered_at IS NOT NULL)),
    CHECK (state = 'open' OR held_request_id IS NULL),
    UNIQUE (stage_id, number)
);
CREATE UNIQUE INDEX idx_rounds_one_open_per_stage ON rounds (stage_id) WHERE state = 'open';

-- One numbered question of a Round: what the agent read that raised it (`grounding`), its
-- recommended answer and the one-line reason for it (`because`). The developer answers it with the
-- recommendation as it is (`recommended`) or with their own words (`own`); each answer is written as
-- it is made.
CREATE TABLE round_questions (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    round_id TEXT NOT NULL REFERENCES rounds(id),
    number INTEGER NOT NULL CHECK (number >= 1),
    title TEXT NOT NULL,
    question TEXT NOT NULL,
    grounding TEXT NOT NULL,
    recommended_answer TEXT NOT NULL,
    because TEXT NOT NULL,
    answer TEXT,
    answered_with TEXT CHECK (answered_with IS NULL OR answered_with IN ('recommended', 'own')),
    answered_by TEXT REFERENCES actors(id),
    answered_at TEXT,
    -- An answer is whole or absent: its text, how it was given, by whom and when.
    CHECK ((answer IS NULL) = (answered_with IS NULL)),
    CHECK ((answer IS NULL) = (answered_by IS NULL)),
    CHECK ((answer IS NULL) = (answered_at IS NULL)),
    UNIQUE (round_id, number)
);
