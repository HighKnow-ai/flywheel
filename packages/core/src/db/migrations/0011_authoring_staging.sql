-- `authoring_proposals` (D-80/D-81/D-83, plan 05-02): a brand-new table, so no rebuild sequence is
-- needed here — mirrors `0009_criteria_revisions.sql`'s own precedent for why a rebuild is not
-- required. Every proposed epic, task and criterion an authoring session drafts lives here until a
-- human decides on it; the canonical `epics`/`tasks`/`acceptance_criteria` tables are never touched
-- by an agent-reachable path (this phase's own prohibition). Referenced by `agent_run_id`, so this
-- migration is numbered AFTER `0010_authoring_runs.sql`'s `agent_runs` rebuild.
--
-- D-81: one uniform verb (`create`/`amend`/`delete`) plus an optional `target_id` serves a fresh
-- epic and a reopened one identically — no separate table or verb per lifecycle.
--
-- D-83: a decided row is never deleted — it is marked terminal (`accepted`/`rejected`) and stays,
-- so a later session for the same epic can be primed with the rejected set and never re-propose
-- what was already killed. This MUST ship bounded: `idx_authoring_proposals_epic_status` is what
-- keeps "every proposal ever decided for this epic" an indexed, bounded read rather than the
-- unbounded scan `STATE.md` already warns against for `context_packet.rs`'s `SUMMARIES_SQL` — the
-- same failure shape, a different table, closed here from the first migration rather than
-- retrofitted.
--
-- `payload` is JSON carrying discrete NAMED fields per `target_type` (a `kind` discriminant plus
-- e.g. `title`/`description` for a task, `statement`/`verificationHint` for a criterion) — never
-- one prose blob folding a drafted criterion or assumption into another row's field. This is
-- `domain::authoring_proposal::ProposalPayload`'s own structural form of that prohibition.
CREATE TABLE authoring_proposals (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    epic_id TEXT REFERENCES epics(id),
    verb TEXT NOT NULL CHECK (verb IN ('create', 'amend', 'delete')),
    target_type TEXT NOT NULL CHECK (target_type IN ('epic', 'task', 'criterion', 'assumption')),
    target_id TEXT,
    parent_proposal_id TEXT REFERENCES authoring_proposals(id),
    position TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected')),
    rejection_reason TEXT,
    materialised_id TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    decided_by TEXT REFERENCES actors(id),
    decided_at TEXT
);

-- The proposal tray's own read: every pending proposal for the run currently open (D-82).
CREATE INDEX idx_authoring_proposals_run_status ON authoring_proposals (agent_run_id, status);

-- D-83's primed rejected-set read, ordered newest-first — the bounded, indexed replacement for an
-- event-log replay.
CREATE INDEX idx_authoring_proposals_epic_status ON authoring_proposals (epic_id, status, created_at DESC);

-- The subtree walk D-95's task-plus-drafted-criteria bulk accept needs.
CREATE INDEX idx_authoring_proposals_parent ON authoring_proposals (parent_proposal_id);
