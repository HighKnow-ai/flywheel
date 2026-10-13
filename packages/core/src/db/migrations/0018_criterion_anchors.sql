-- Criterion anchors (D-139, D-140, D-141, REVW-03, phase 08 plan 08-02): the evidence behind a
-- checked acceptance criterion — which file, which side of the diff, which line range, and the
-- sha the range was read at.
--
-- Owner decisions closing this schema's shape:
--   1. A separate table, not columns on `acceptance_criteria`: `AcceptanceCriterion` is built from
--      positional reads in about eight places, and the ABSENCE of a row here IS the no-evidence
--      state (D-140) — a criterion can always be checked with no anchor, and that stays readable
--      as its own state rather than a sentinel value.
--   2. `criterion_id` is the primary key (one anchor per criterion) and cascades from the
--      criterion, so deleting a criterion or its parent leaves no orphan row.
--   3. The CHECK constraints — not app code — are the authority on the side vocabulary and the
--      range ordering, this codebase's established idiom (0002, 0004, 0005, 0017).
--   4. `sha` is resolved inside the core, never supplied by the renderer. Staleness (D-141) is
--      derived from git on every read and is stored nowhere: there is deliberately no `stale`
--      column.
CREATE TABLE criterion_anchors (
    criterion_id TEXT PRIMARY KEY NOT NULL REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    side TEXT NOT NULL DEFAULT 'new' CHECK (side IN ('old', 'new')),
    line_start INTEGER NOT NULL CHECK (line_start >= 1),
    line_end INTEGER NOT NULL CHECK (line_end >= line_start),
    sha TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);
