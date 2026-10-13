-- Fleet supervision across every project (D-165, D-177, phase 10 plan 10-01): the one migration
-- the whole phase needs. Everything here is additive; nothing is rebuilt.
--
-- Owner decisions closing this migration's shape:
--   1. D-165: a finished run stays on the fleet until acknowledged. `agent_runs.acknowledged_at`
--      has existed since 0006 but until now only an `abandoned` run was ever acknowledged, so
--      every historic `completed` / `failed` / `interrupted` run carries NULL. Without a backfill
--      the first launch after this migration would read every run in history as unacknowledged
--      and flood the fleet (RESEARCH Pitfall 1). The UPDATE below sets `acknowledged_at` to the
--      moment the run ended (its start when it never recorded an end) for exactly those three
--      terminal statuses.
--   2. The backfill deliberately EXCLUDES the abandoned status. `query::recovery`'s recovery
--      summary and the project rail's needs-decision count both read unacknowledged abandoned
--      rows; clearing them here would silently empty the recovery surface of work that still
--      needs a human decision. The fleet's NEEDS YOU band shows them for the same reason.
--   3. D-177: the worktree inventory caches a measured disk size with the time it was measured,
--      so a figure is always shown with its age. Two plain nullable `ALTER TABLE ... ADD COLUMN`
--      statements with no default, exactly as `0007_destructive_gate.sql` does, and explicitly
--      NOT a table rebuild: rebuilding `worktrees` forces the foreign-key dance `0006` documents.
--      NULL means "never measured" and renders blank, never `0 B`. Plan 10-08 consumes them.
--   4. `idx_agent_runs_fleet` serves `query::fleet::FLEET_SQL`, whose WHERE clause keys on
--      `status`, then `acknowledged_at IS NULL`, then orders by `started_at`; the existing
--      `(project_id, status)` index cannot serve a cross-project read.

UPDATE agent_runs
SET acknowledged_at = COALESCE(ended_at, started_at)
WHERE status IN ('completed', 'failed', 'interrupted')
  AND acknowledged_at IS NULL;

ALTER TABLE worktrees ADD COLUMN size_bytes INTEGER;
ALTER TABLE worktrees ADD COLUMN size_measured_at TEXT;

CREATE INDEX idx_agent_runs_fleet ON agent_runs (status, acknowledged_at, started_at);
