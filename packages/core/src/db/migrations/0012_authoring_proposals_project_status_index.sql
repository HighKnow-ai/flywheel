-- D-82 (plan 05-04, deviation Rule 2 — missing DB index on a frequently queried column pair):
-- the board-level triage lane's own read (`query::authoring::list_pending_proposals`) filters
-- `authoring_proposals` by `(project_id, status)`, ordered `created_at DESC`. Neither existing
-- index on this table covers that pair: `idx_authoring_proposals_epic_status` leads with
-- `epic_id`, `idx_authoring_proposals_run_status` leads with `agent_run_id`. Without this index,
-- a project-wide pending-proposals scan is a full table scan — exactly the unindexed-bounded-read
-- shape this plan's own gate (`epic_context_packet.rs`'s `unbounded_reads` test) exists to name
-- and refuse to tolerate silently. Added here rather than left as a table scan.
CREATE INDEX idx_authoring_proposals_project_status
    ON authoring_proposals (project_id, status, created_at DESC);
