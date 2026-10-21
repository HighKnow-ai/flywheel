-- An agent's question (docs/mvp-spec.md §2 "Attention", §5 "Never a pause", issue #100). Claude
-- Code sends every `AskUserQuestion` call through the permission-prompt tool, so a question is held
-- as a `permission_requests` row whose `tool_name` is `AskUserQuestion`: it makes the Story Waiting
-- on you, counts in Needs you and the sidebar, waits with no timeout and expires with its session,
-- exactly like a permission request. It is never answered with allow or deny and no rule covers it;
-- the developer answers it, and the answers are kept here as a JSON object keyed by each question's
-- text (each value the chosen label, several joined with ", ", or free text). NULL until answered,
-- and NULL on every other request.
ALTER TABLE permission_requests ADD COLUMN answers TEXT;
