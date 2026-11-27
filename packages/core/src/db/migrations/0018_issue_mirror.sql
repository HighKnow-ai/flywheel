-- The Issue mirror (issue #2118): a project may copy its accepted Epics and Stories to the forge as
-- issues. Every write the mirror owes waits in an outbox and is applied one at a time, so the board
-- never waits on the forge.
--
-- 1. The project's setting. Off by default. NULL `mirror_repo` means the repository `origin` names.
ALTER TABLE projects ADD COLUMN mirror_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mirror_enabled IN (0, 1));
ALTER TABLE projects ADD COLUMN mirror_repo TEXT CHECK (mirror_repo IS NULL OR length(mirror_repo) > 0);

-- 2. The issue number of a mirrored record.
ALTER TABLE epics ADD COLUMN issue_number INTEGER CHECK (issue_number IS NULL OR issue_number > 0);
ALTER TABLE stories ADD COLUMN issue_number INTEGER CHECK (issue_number IS NULL OR issue_number > 0);

-- 3. What the forge holds for a record, as the last write left it. The planner compares the board
--    with this row to decide what is owed.
CREATE TABLE mirror_synced (
    record_id TEXT PRIMARY KEY NOT NULL,
    record_kind TEXT NOT NULL CHECK (record_kind IN ('epic', 'story')),
    project_id TEXT NOT NULL REFERENCES projects(id),
    content TEXT NOT NULL,
    label TEXT NOT NULL,
    closed_reason TEXT CHECK (closed_reason IS NULL OR closed_reason IN ('completed', 'not_planned')),
    parent_linked INTEGER NOT NULL DEFAULT 0 CHECK (parent_linked IN (0, 1))
);

-- 4. Labels known to exist on the forge, so a label is created once.
CREATE TABLE mirror_labels (
    project_id TEXT NOT NULL REFERENCES projects(id),
    label TEXT NOT NULL,
    PRIMARY KEY (project_id, label)
);

-- 5. The outbox: one row per write owed, in the order the writes are made. A row names the record, not
--    the text: the text is read from the board when the write is made. A failed write keeps its row and is tried again on the next tick.
CREATE TABLE mirror_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    record_kind TEXT NOT NULL CHECK (record_kind IN ('epic', 'story')),
    record_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('create', 'link_parent', 'edit', 'close')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (record_id, op)
);
