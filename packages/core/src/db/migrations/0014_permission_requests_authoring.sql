-- D-84 extended a second row: `permission_requests.task_id` loses its `NOT NULL`, a nullable
-- `epic_id` is added, and a table-level CHECK forbids a row from claiming both a task and an epic
-- at once — the same shape migrations `0010_authoring_runs.sql` and `0013_authoring_summaries.sql`
-- already gave `agent_runs` and `session_summaries` respectively, applied here for the same reason:
-- D-86's read-only authoring session is still wrapped by Phase 3's destructive gate and PATH shim,
-- so an authoring run CAN raise a genuine (non-pre-approved) permission request — a `bash` command
-- it wants to run for read-only inspection, for instance — and without this rebuild that write
-- would fail outright against the old `NOT NULL` column (plan 05-09's own Task 3, closing the
-- money-burning half of D-46's rule: a permission-blocked authoring run must be representable at
-- all before it can join the blocked-count rail signal).
--
-- SQLite cannot DROP a `NOT NULL` or add a table-level CHECK in place, so this is a full rebuild,
-- copying `0006_recovery_statuses.sql`'s documented safe sequence exactly: CREATE TABLE <name>_new
-- / explicit-column INSERT INTO <name>_new SELECT ... FROM <name> / DROP TABLE <name> / ALTER
-- TABLE <name>_new RENAME TO <name>. Every existing column is reproduced verbatim from
-- `0004_permission_gate.sql`, the `INSERT` uses an explicit column list (never `SELECT *`), and
-- both pre-existing indexes are recreated.
--
-- `db::open_and_migrate` already toggles `PRAGMA foreign_keys` OFF around `MIGRATIONS.to_latest()`
-- and runs `PRAGMA foreign_key_check` afterward — no table has a real foreign key INTO
-- `permission_requests`, so this rebuild is as simple as `0013_authoring_summaries.sql`'s was.
CREATE TABLE permission_requests_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    task_id TEXT REFERENCES tasks(id),
    epic_id TEXT REFERENCES epics(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    tool_name TEXT NOT NULL,
    input_payload TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'allowed_always')),
    resolved_by TEXT REFERENCES actors(id),
    resolved_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    destructive_category TEXT,
    CHECK (NOT (task_id IS NOT NULL AND epic_id IS NOT NULL))
);

INSERT INTO permission_requests_new (
    id, agent_run_id, task_id, epic_id, project_id, tool_name, input_payload, status,
    resolved_by, resolved_at, created_by, created_at, destructive_category
)
SELECT
    id, agent_run_id, task_id, NULL, project_id, tool_name, input_payload, status,
    resolved_by, resolved_at, created_by, created_at, destructive_category
FROM permission_requests;

DROP TABLE permission_requests;

ALTER TABLE permission_requests_new RENAME TO permission_requests;

-- Recreate both pre-existing indexes — DROP TABLE drops them and CREATE TABLE ... RENAME TO does
-- not resurrect them.
CREATE INDEX idx_permission_requests_run_status ON permission_requests (agent_run_id, status);
CREATE INDEX idx_permission_requests_project_status ON permission_requests (project_id, status);
