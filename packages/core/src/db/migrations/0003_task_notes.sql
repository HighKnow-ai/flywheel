-- A note on each Task (docs/mvp-spec.md §4.3, §4.5, issue #96): what the Story's agent has learned
-- while working the Task (findings, file paths, decisions, what is left), so a session that stops
-- mid-Task does not take it to the grave. Plain text, replaced whole on every write, written by the
-- agent through `task_update` or by the developer from the checklist. NULL means no note.
ALTER TABLE tasks ADD COLUMN note TEXT;
