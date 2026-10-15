-- The Cycle: a scope-boxed, undated grouping layer above the epic (phase 14 plan 14-01; RECD-08).
--
-- Decisions closing this schema's shape:
--   1. A Cycle has a goal, an ordering (`rank`) and exit criteria, and NO column whose meaning is a
--      calendar point or a span of work time (D-06, D-10). `created_at` / `updated_at` are the audit
--      pair every table here carries; the owner confirmed on 2026-10-15 that "undated" does not bar
--      audit metadata. The exact column set is pinned by tests/spine_pin.rs (D-21), so any added
--      column fails the build whatever it is called.
--   2. `state` is exactly planned / active / closed (D-05). At most one Cycle per project is active,
--      by a partial unique index, not by application code (the same mechanism as
--      idx_dispatch_plans_one_live_per_epic).
--   3. Progress is stored nowhere. It is folded at read time from the real task counts of every epic
--      in the Cycle (query::cycle_progress), so it cannot drift from the board (D-08).
--   4. An epic is in at most one Cycle: one nullable column on `epics`, not a join table. `cycles`
--      carries no self-reference, so Cycles never nest (D-10).
--   5. Owner ruling 2026-10-15 (Cyril Marechal), option B: `project_id` and `created_by` carry the
--      house REFERENCES clauses. Both parents are infrastructure tables, so a Cycle still has no
--      parent in the board spine (D-09, criterion 2).
--   6. `cycles` is classified Canonical in schema_classification.rs in the same diff (D-22).
CREATE TABLE cycles (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    key TEXT NOT NULL,
    goal TEXT NOT NULL,
    exit_criteria TEXT,
    state TEXT NOT NULL CHECK (state IN ('planned', 'active', 'closed')),
    rank TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_cycles_one_active_per_project
    ON cycles (project_id)
    WHERE state = 'active';

CREATE INDEX idx_cycles_project_rank ON cycles (project_id, rank);

ALTER TABLE epics ADD COLUMN cycle_id TEXT REFERENCES cycles(id);

CREATE INDEX idx_epics_cycle ON epics (cycle_id);
