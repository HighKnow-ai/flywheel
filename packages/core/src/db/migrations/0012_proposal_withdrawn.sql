-- Proposals from execution (docs/mvp-spec.md §5, issue #160): a Story session may hold 3 open
-- Proposals at once, and withdraws one of its own pending Proposals to free a slot (there is no merge
-- verb: withdraw, then file the combined one). A withdrawn Proposal is closed without a decision: the
-- agent that filed it took it back, so `decided_by` stays NULL and `withdrawn_at` says when.
--
-- A Proposal from execution also carries an evidence line beside its `rationale` (the agent's why):
-- what the agent saw that made it file, shown on the triage card.
--
-- `proposals` is rebuilt to widen its state CHECK. Every column 0001 and 0007 gave it is kept, with
-- its foreign keys, and so is every index. `round_questions.adr_proposal_id` (0008) and
-- `proposals.duplicate_of` name the table by name, so they point at the rebuilt one once it is
-- renamed back; migrations run with foreign keys off and are checked by `foreign_key_check` after.
CREATE TABLE proposals_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    session_id TEXT REFERENCES sessions(id),
    epic_id TEXT REFERENCES epics(id),
    verb TEXT NOT NULL CHECK (verb IN ('create', 'amend', 'reorder', 'retire')),
    target_type TEXT NOT NULL CHECK (target_type IN ('milestone', 'epic', 'story', 'criterion', 'adr', 'glossary_term')),
    target_id TEXT,
    payload TEXT NOT NULL,
    rationale TEXT,
    state TEXT NOT NULL CHECK (state IN ('pending', 'accepted', 'rejected', 'withdrawn')),
    rejection_reason TEXT,
    duplicate_of TEXT REFERENCES proposals(id),
    decided_by TEXT REFERENCES actors(id),
    decided_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    stage_id TEXT REFERENCES stages(id),
    round_id TEXT REFERENCES rounds(id),
    evidence TEXT,
    withdrawn_at TEXT,
    -- Only a decision names who decided: a pending or a withdrawn Proposal has no decider.
    CHECK ((state IN ('pending', 'withdrawn')) = (decided_by IS NULL)),
    CHECK (rejection_reason IS NULL OR state = 'rejected'),
    CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL)),
    -- Only a session withdraws, and only its own Proposal: a Proposal filed outside one has nothing to take it back.
    CHECK (state != 'withdrawn' OR session_id IS NOT NULL)
);

INSERT INTO proposals_new (id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale, state,
    rejection_reason, duplicate_of, decided_by, decided_at, created_by, created_at, stage_id, round_id)
SELECT id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale, state,
    rejection_reason, duplicate_of, decided_by, decided_at, created_by, created_at, stage_id, round_id
FROM proposals;

DROP TABLE proposals;
ALTER TABLE proposals_new RENAME TO proposals;

CREATE INDEX idx_proposals_project_state ON proposals (project_id, state, created_at);
CREATE INDEX idx_proposals_epic_state ON proposals (epic_id, state);
CREATE INDEX idx_proposals_stage_state ON proposals (stage_id, state) WHERE stage_id IS NOT NULL;
-- The cap counts a session's open Proposals on every filing.
CREATE INDEX idx_proposals_session_state ON proposals (session_id, state) WHERE session_id IS NOT NULL;
