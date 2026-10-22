-- Proposals in shaping (docs/mvp-spec.md §3, issue #125): a Proposal a shaping session files hangs
-- off the Stage it was filed in and the Round it follows, so a Stage knows which Proposals are still
-- undecided before the developer closes it (#126). Both stay NULL for a Story session's Proposal,
-- and `round_id` stays NULL for one filed before the Stage's first Round.
ALTER TABLE proposals ADD COLUMN stage_id TEXT REFERENCES stages(id);
ALTER TABLE proposals ADD COLUMN round_id TEXT REFERENCES rounds(id);
CREATE INDEX idx_proposals_stage_state ON proposals (stage_id, state) WHERE stage_id IS NOT NULL;
