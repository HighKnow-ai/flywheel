-- A note the developer sends to a running Story session (docs/mvp-spec.md §4.7). One row per note.
-- `sent` becomes `delivered` when the sidecar hands the note to the agent at its next turn boundary.
-- A note still `sent` when its session is no longer live reads as undelivered: that state is derived
-- on read (`domain::session_note`), so a crash or an abandoned session needs no extra write.
CREATE TABLE session_notes (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    story_id TEXT NOT NULL REFERENCES stories(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('sent', 'delivered')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    delivered_at TEXT
);
CREATE INDEX idx_session_notes_story ON session_notes (story_id, created_at);
