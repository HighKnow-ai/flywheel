-- ADRs offered inside the Round (docs/mvp-spec.md §3 "ADRs in shaping" and §6, issue #129).
--
-- A Round question is either an ordinary `question` or an `adr`: an ADR draft the agent offers for
-- the developer to answer Yes or No. An ADR question carries the draft (its repo-relative path and
-- its whole text) and the four bar lines shown beside it and never written into the file: why the
-- decision is hard to reverse, why it would surprise a reader, which alternative lost, and what it
-- relates to. Without the first three there is no ADR. "Yes" files an already-accepted ADR Proposal
-- on the Epic, and `adr_proposal_id` points at it; "No" drops the draft.
ALTER TABLE round_questions ADD COLUMN kind TEXT NOT NULL DEFAULT 'question' CHECK (kind IN ('question', 'adr'));
ALTER TABLE round_questions ADD COLUMN adr_path TEXT;
ALTER TABLE round_questions ADD COLUMN adr_text TEXT;
ALTER TABLE round_questions ADD COLUMN bar_hard_to_reverse TEXT;
ALTER TABLE round_questions ADD COLUMN bar_surprising TEXT;
ALTER TABLE round_questions ADD COLUMN bar_losing_alternative TEXT;
-- "Relates to: ADR-NNNN… / none": NULL reads as none.
ALTER TABLE round_questions ADD COLUMN bar_relates_to TEXT;
-- The accepted ADR Proposal a "Yes" filed; NULL for an ordinary question, an unanswered one and a "No".
-- Its CHECK is the whole row's: an ADR question has its draft and its first three bar lines, and an
-- ordinary question has none of them and never files a Proposal.
ALTER TABLE round_questions ADD COLUMN adr_proposal_id TEXT REFERENCES proposals(id) CHECK (
    (kind = 'adr' AND adr_path IS NOT NULL AND adr_text IS NOT NULL AND bar_hard_to_reverse IS NOT NULL
        AND bar_surprising IS NOT NULL AND bar_losing_alternative IS NOT NULL)
    OR (kind = 'question' AND adr_path IS NULL AND adr_text IS NULL AND bar_hard_to_reverse IS NULL
        AND bar_surprising IS NULL AND bar_losing_alternative IS NULL AND bar_relates_to IS NULL
        AND adr_proposal_id IS NULL)
);
