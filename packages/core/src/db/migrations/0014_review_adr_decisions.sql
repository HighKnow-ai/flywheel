-- The developer's decision on each ADR a Story's branch adds (docs/mvp-spec.md §8, issue #164,
-- ADR 0016), stored on the open review. Keep is the default and is not stored: an ADR set back to
-- Keep leaves the array. Each entry is `{path, decision: "not_an_adr"}` or
-- `{path, decision: "wrong_decision", what_is_wrong, should_be}`. While any entry is there Merge
-- refuses, and a request for changes carries each one to the agent as a review point.
ALTER TABLE reviews ADD COLUMN adr_decisions TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(adr_decisions) AND json_type(adr_decisions) = 'array');
