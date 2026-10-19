-- How a Story session ended, and the requests that died with it (docs/mvp-spec.md §4.5, issue #54).
--
-- `sessions.ending_reason` is the best-effort label Stopped shows, read from the result line, the
-- exit code and the last assistant message. NULL while the session is live. Nothing branches on it:
-- it is a label, and `status` stays the lifecycle fact.
ALTER TABLE sessions ADD COLUMN ending_reason TEXT CHECK (ending_reason IS NULL OR ending_reason IN (
    'refusal', 'usage_limit', 'api_error', 'crash', 'app_quit', 'stopped_by_developer',
    'ended_without_hand_off', 'handed_off', 'unknown'
));

-- A pending Gated action or permission request expires with its session: the session that asked is
-- gone, so nobody is left to act on the answer. The row keeps `status = 'pending'` (it was never
-- answered) and is read as expired once this is set.
ALTER TABLE permission_requests ADD COLUMN expired_at TEXT;
