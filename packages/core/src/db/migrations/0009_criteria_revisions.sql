-- D-76/D-77 (plan 04-04): acceptance criteria revisioning, and the run's criteria pin (D-78).
--
-- Every statement below adds a column — no table rebuild, unlike `0006_recovery_statuses.sql`'s
-- CHECK-constraint rebuild. That rebuild sequence is deliberately NOT needed here because nothing
-- here changes a CHECK constraint; SQLite permits adding a column (even NOT NULL, given a
-- non-null default) without recreating the table, exactly as `0007_destructive_gate.sql`'s own
-- comment states for its own single added column.
--
-- No CHECK constraint is attached to any of these columns' shape, mirroring
-- `0007_destructive_gate.sql`'s identical precedent for `destructive_category`: SQLite's own
-- `ALTER TABLE ... ADD COLUMN` cannot attach a CHECK constraint to an existing table anyway, and
-- the revision chain's integrity — never overwriting a superseded row's own statement, minting
-- exactly one successor per revise — is enforced at the single Rust write path instead
-- (`domain::acceptance_criterion::revise_criterion`), the only writer of these columns in the
-- whole workspace.
--
-- `revision_of` points at the CHAIN ROOT — the criterion row as it was first created — not the
-- immediate predecessor, so "give me this criterion's whole history" is one indexed query
-- (`list_revisions_for_root`, matching on `id` or `revision_of`) rather than a walk up a linked
-- list of predecessors.
--
-- `agent_runs.criteria_revision_pin` carries no `REFERENCES` clause, for the same reason
-- `0008_session_summaries.sql`'s `agent_runs.exit_summary_id` carries none: it is a JSON array of
-- row ids (D-78), not a single foreign key, and this migration is already the revision migration
-- — added here rather than as its own later migration, so a second nullable single-column
-- migration-safety surface is never needed for it.

ALTER TABLE acceptance_criteria ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE acceptance_criteria ADD COLUMN revision_of TEXT;
ALTER TABLE acceptance_criteria ADD COLUMN superseded_at TEXT;
ALTER TABLE agent_runs ADD COLUMN criteria_revision_pin TEXT;

-- Backs the current-revision filter every read path this plan touches gains
-- (context_packet.rs's CRITERIA_SQL, query/mod.rs's CRITERIA_JOIN, and this module's own
-- `list_current_criteria`/tail-rank lookup).
CREATE INDEX idx_acceptance_criteria_parent_current ON acceptance_criteria (parent_id, superseded_at);
