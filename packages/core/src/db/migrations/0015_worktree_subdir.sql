-- A project rooted in a subdirectory of a larger repository (cymarechal/highknow-mvp#551): a
-- Story's worktree is a worktree of the whole repository, and the project sits at the same
-- subdirectory inside it. `subdir` is that subdirectory, relative to the worktree's root, as
-- `git rev-parse --show-prefix` named it when the worktree was created, without its trailing
-- slash; '' for a project at its repository's root. The agent starts there and the Checks run
-- there; git work on the worktree itself (status, remove, merge) still uses `path`.
ALTER TABLE worktrees ADD COLUMN subdir TEXT NOT NULL DEFAULT '';
