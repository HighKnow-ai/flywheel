-- Slicing an Epic into Stories (docs/mvp-spec.md §3, issue #127): the agent-noticed constraint
-- between two Stories ("shares `FeedRow.tsx`") is kept beside the "runs after Story X" marker it
-- explains. Like the marker, it is informational and never blocks a start. A reason without a
-- marker has nothing to explain, so the CHECK refuses it.
ALTER TABLE stories ADD COLUMN runs_after_reason TEXT CHECK (runs_after_reason IS NULL OR runs_after_story_id IS NOT NULL);
