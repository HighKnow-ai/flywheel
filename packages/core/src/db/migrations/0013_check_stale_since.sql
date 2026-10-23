-- Judged-on changes (docs/mvp-spec.md §4.4, §5, issue #163): an accepted Amend criterion that keeps
-- its Check marks the Check's last run stale. `stale_since` is when: a run that started before it is
-- stale whatever the branch head says, and a run that started after it is current again. It is set
-- only by accepting a judged-on change; NULL means no run was ever marked stale. Runs are never
-- deleted, so the stale run is still there, saying what it said.
ALTER TABLE checks ADD COLUMN stale_since TEXT;
