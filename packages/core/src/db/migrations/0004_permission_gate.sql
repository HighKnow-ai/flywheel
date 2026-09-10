-- The permission gate (AGNT-06, D-36, D-37, D-38): `permission_requests` and `permission_rules`
-- — the mechanism that lets a running agent pause on a gated tool call and stay paused until a
-- human answers, plus the project-scoped rule that keeps prompt fatigue from killing unattended
-- running without letting a rule earned on one repository silently apply to another.
--
-- Owner decisions closing this schema's shape (plan 02-05 Task 1, recorded in 02-CONTEXT.md):
--   1. D-36/D-37: a pending request flips its run to `agent_runs.status = 'blocked'` (already
--      accepted by that column's CHECK constraint since migration 0003) in the SAME transaction
--      as the request row's insert — a blocked run and its pending request can never disagree,
--      because nothing here writes one without the other.
--   2. D-38: `permission_rules` carries a unique `(project_id, tool_name)` pair and NO
--      global-scope column and NO session-scope column. That uniqueness constraint *is* the
--      per-project, per-tool scope expressed as a constraint — a rule earned on one project can
--      never be read as applying to another, because there is no column shape that could express
--      "applies everywhere."
--   3. AGNT-06: `permission_requests.status` accepts exactly `pending`/`allowed`/`denied`/
--      `allowed_always` — matching this codebase's established "the schema, not app code, is the
--      authority" idiom (`0002_board_schema.sql`'s five-state workflow CHECK, `0003`'s
--      `agent_runs.status` CHECK). An out-of-set value is rejected by SQLite itself, not by a
--      Rust-side guard that a caller could bypass.
--   4. The once-only answer property (a pending request can be answered exactly once) is a
--      property of `domain::permission_request::answer_request`'s guarded UPDATE (its WHERE
--      clause includes `status = 'pending'`), not of this schema — no CHECK constraint can
--      express "at most one transition out of pending," so this migration only fixes the four
--      legal status VALUES, and the once-only property is proven in `tests/permission_gate.rs`.

-- One row per gated tool call. `agent_run_id` ties the request to the run that raised it;
-- `task_id`/`project_id` are denormalised here at write time (D-19's own established pattern for
-- every event-adjacent table in this schema) so the board's blocked-task query and the
-- project-rail count never need to join through `agent_runs` to filter by project or task.
-- `input_payload` is the tool's raw input JSON, stored verbatim (accepted, ASVS L1, T-02-26 —
-- it's exactly what a human must read to decide responsibly). `resolved_by`/`resolved_at` are
-- both NULL until answered exactly once by `answer_request`.
CREATE TABLE permission_requests (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
    task_id TEXT NOT NULL REFERENCES tasks(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    tool_name TEXT NOT NULL,
    input_payload TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'allowed_always')),
    resolved_by TEXT REFERENCES actors(id),
    resolved_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

-- D-38's project-scoped allow-always store. The unique `(project_id, tool_name)` pair below IS
-- the per-project, per-tool scope — there is no global scope column and no session scope, so a
-- rule cannot be widened by writing a row; `matching_rule` requires both columns to match, and
-- this constraint is what makes that requirement unbypassable even by a hand-written INSERT.
CREATE TABLE permission_rules (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    tool_name TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('allow', 'deny')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    UNIQUE (project_id, tool_name)
);

CREATE INDEX idx_permission_requests_run_status ON permission_requests (agent_run_id, status);
CREATE INDEX idx_permission_requests_project_status ON permission_requests (project_id, status);
