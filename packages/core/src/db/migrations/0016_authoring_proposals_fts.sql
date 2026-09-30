-- Owner decisions closing this migration's shape (2026-09-30, plan 06-04 Task 1):
--   1. D-105: a proposal's duplicate candidate is scored with FTS5 `bm25` against the same
--      `content=`-external indexes `0002_board_schema.sql` already ships for tasks/epics/issues,
--      plus this one new index over `authoring_proposals` — no new dependency, no network call.
--   2. D-106: the scored corpus is "open tasks, epics and issues" PLUS every already-decided
--      proposal (D-83 keeps every decided row forever, so a re-proposed rejected idea is the
--      most irritating duplicate there is) — answering `06-CONTEXT.md`'s discretion item on
--      whether the decided set gets its own FTS index: yes. Title-only matching for that half
--      would need a second, differently-shaped query path beside the `bm25` one; one uniform
--      two-column index across all four corpora is less code, and is what makes one threshold
--      (`query::search::DUPLICATE_BM25_THRESHOLD`) defensible across all of them.
--   3. D-107: the duplicate flag is computed and written at STAGING time, inside the same
--      transaction and the same `INSERT` that creates the row — never recomputed on read. This
--      index exists so that write has one bounded, indexed statement to query against
--      (`query::search::duplicate_candidate_for`).
--
-- This table's content table, `authoring_proposals`, has already been rebuilt twice
-- (`0011_authoring_staging.sql` -> `0015_proposal_triage_extension.sql`). Any FUTURE rebuild of
-- `authoring_proposals` MUST drop and re-create this virtual table and its three triggers below
-- in the SAME migration: `DROP TABLE authoring_proposals` drops this external-content index's
-- content table out from under it, and a rebuild that forgets to re-create
-- `authoring_proposals_fts` leaves the index pointing at a table that no longer exists — the
-- same class of silent drift `query/search.rs`'s own module header already warns about for
-- `tasks_fts`/`epics_fts`/`issues_fts` (01-RESEARCH.md Pitfall 3).
--
-- Two indexed columns, `payload` and `rationale`, give this table the same two-column shape as
-- `tasks_fts` (title, description), `epics_fts` (title, description) and `issues_fts`
-- (title, body) — that uniform shape is what lets one `bm25` weighting
-- (`query::search::DUPLICATE_BM25_WEIGHTS`) and one threshold apply across all four corpora
-- (06-RESEARCH.md assumption A3). `payload` is indexed as its raw JSON text, with no extraction
-- helper: FTS5's default tokenizer treats JSON punctuation (`{`, `}`, `"`, `:`) as token
-- separators, so a proposal's title and description/body words are searchable, and every row's
-- payload shares the same key names (`"kind"`, `"title"`, `"description"`, ...), so the noise
-- those keys contribute is constant across rows rather than skewing the score.
CREATE VIRTUAL TABLE authoring_proposals_fts USING fts5(
    payload, rationale, content = authoring_proposals, content_rowid = rowid
);

CREATE TRIGGER authoring_proposals_fts_ai AFTER INSERT ON authoring_proposals BEGIN
    INSERT INTO authoring_proposals_fts (rowid, payload, rationale)
    VALUES (new.rowid, new.payload, new.rationale);
END;
CREATE TRIGGER authoring_proposals_fts_ad AFTER DELETE ON authoring_proposals BEGIN
    INSERT INTO authoring_proposals_fts (authoring_proposals_fts, rowid, payload, rationale)
    VALUES ('delete', old.rowid, old.payload, old.rationale);
END;
CREATE TRIGGER authoring_proposals_fts_au AFTER UPDATE ON authoring_proposals BEGIN
    INSERT INTO authoring_proposals_fts (authoring_proposals_fts, rowid, payload, rationale)
    VALUES ('delete', old.rowid, old.payload, old.rationale);
    INSERT INTO authoring_proposals_fts (rowid, payload, rationale)
    VALUES (new.rowid, new.payload, new.rationale);
END;

-- Populate the index for every `authoring_proposals` row that already exists — unlike
-- `0002_board_schema.sql`'s trio (created empty, alongside their own base tables, in the same
-- migration that first creates the base tables), `authoring_proposals` has carried rows since
-- `0011_authoring_staging.sql`, long before this migration runs. FTS5's own documented rebuild
-- command walks the content table and repopulates the index in one pass.
INSERT INTO authoring_proposals_fts (authoring_proposals_fts) VALUES ('rebuild');
