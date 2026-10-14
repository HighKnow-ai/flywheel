-- D-200 (phase 11, plan 11-19): a reversible way to remove a project from Flywheel's surfaces.
--
-- Deleting a project's board is the one irreversible act in an application whose promise is that
-- nothing is lost, so removal is a flag and a filter, never a delete. A hidden project keeps every
-- row it owns (tasks, runs, worktrees, events); only the LISTING reads skip it, and a by-id lookup
-- still resolves so the project can be restored and its history stays readable.
--
-- 0 = shown (every existing row), 1 = hidden. Append-only like every migration here: there is no
-- down-migration, and nothing in the surface purges a hidden project.
ALTER TABLE projects ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1));
