-- Review and merge (docs/mvp-spec.md §8, issue #155). A **review** is opened by the hand-off, in the
-- transaction that moves the Story to In review, and closed by the developer's decision: Merge, or a
-- request for changes. It keeps what the review card is judged on at hand-off (the commits compared,
-- the diff's size, the Tasks left open, the agent's objections to a Check and its ADR notes) and what
-- the developer decided, including the failing Checks a "Merge with failing Check" overrode.
--
-- A Story has at most one open review at a time; each hand-off after a request for changes opens a
-- new one, so the rows of one Story are its review history.
CREATE TABLE reviews (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    story_id TEXT NOT NULL REFERENCES stories(id),
    -- The session that handed off; NULL for a review opened at Merge for a Story handed off before
    -- reviews existed.
    session_id TEXT REFERENCES sessions(id),
    opened_at TEXT NOT NULL,
    -- The base branch's tip and the Story branch's head at hand-off: the diff is `base_sha...head_sha`.
    base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    -- The diff's size: files changed, lines added and removed (binary files count as a file only).
    files INTEGER NOT NULL CHECK (files >= 0),
    added INTEGER NOT NULL CHECK (added >= 0),
    removed INTEGER NOT NULL CHECK (removed >= 0),
    -- Tasks still open or doing at hand-off, which warn at review.
    open_tasks INTEGER NOT NULL CHECK (open_tasks >= 0),
    -- The handing-off agent's objections to a Check, and its notes on the ADRs in the diff: JSON
    -- arrays, empty until the tools that fill them exist.
    check_objections TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(check_objections) AND json_type(check_objections) = 'array'),
    adr_notes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(adr_notes) AND json_type(adr_notes) = 'array'),
    -- NULL while open; the developer's decision once closed.
    outcome TEXT CHECK (outcome IS NULL OR outcome IN ('changes_requested', 'merged')),
    -- The developer's review comments, sent with a request for changes.
    comments TEXT,
    -- The Checks a "Merge with failing Check" overrode, as a JSON array of
    -- `{check_id, command, result, stale}`; NULL when Merge needed no override.
    failing_checks_overridden TEXT CHECK (failing_checks_overridden IS NULL OR (json_valid(failing_checks_overridden) AND json_type(failing_checks_overridden) = 'array')),
    decided_by TEXT REFERENCES actors(id),
    decided_at TEXT,
    CHECK ((outcome IS NULL) = (decided_by IS NULL)),
    CHECK ((outcome IS NULL) = (decided_at IS NULL)),
    CHECK (failing_checks_overridden IS NULL OR outcome = 'merged')
);

CREATE UNIQUE INDEX idx_reviews_one_open_per_story ON reviews (story_id) WHERE outcome IS NULL;
CREATE INDEX idx_reviews_story_opened ON reviews (story_id, opened_at);
