-- Corrects migration 0020's history backfill (review finding WR-06, phase 10).
--
-- 0020 acknowledged EVERY historic `completed` run so the first launch would not flood the fleet.
-- That also acknowledged the runs the fleet exists to surface: the latest `completed` run of a task
-- that is not yet `done` is the derived `awaiting_review` state (D-168), and it is a real review
-- backlog still open on the board. 0020 has already run on existing installs, so editing it would
-- fix fresh databases only; this migration repairs rows already written.
--
-- Which rows were backfilled rather than dismissed by a person: 0020 stamped
-- `acknowledged_at = COALESCE(ended_at, started_at)` verbatim, while `acknowledge_run` stamps the
-- wall-clock moment of the dismissal. A row whose stamp equals its own run time exactly is a
-- backfilled one. A dismissal that happens to coincide with the run's end to the last character is
-- not a realistic case, and if it did occur the cost is one extra row on the fleet.
--
-- Only the latest run of its task is restored, matching the fleet's own one-row-per-task rule
-- (Finding 1b), and only `completed`: a `failed` or `interrupted` historic run stays acknowledged
-- as 0020 decided. On a fresh database there are no rows and this changes nothing.
UPDATE agent_runs
SET acknowledged_at = NULL
WHERE status = 'completed'
  AND task_id IS NOT NULL
  AND acknowledged_at = COALESCE(ended_at, started_at)
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.id = agent_runs.task_id AND t.status <> 'done')
  AND id = (
      SELECT ar2.id FROM agent_runs ar2
      WHERE ar2.task_id = agent_runs.task_id
      ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1
  );
