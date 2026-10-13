# Phase 6: Agents File Their Own Backlog - Pattern Map

**Mapped:** 2026-09-30
**Files analyzed:** 13 (create/extend targets named in CONTEXT.md/RESEARCH.md)
**Analogs found:** 13 / 13 (all in-tree, extension-phase — every analog is the file itself or its
Phase 5 sibling)

All analogs below were verified with `git ls-files` as tracked source (no `.gsd/`/mirror paths
involved anywhere in this phase — it touches only `packages/core`, `packages/sidecar`,
`packages/desktop`).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/db/migrations/0015_proposal_triage_extension.sql` | migration | table-rebuild (CHECK-constraint change) | `packages/core/src/db/migrations/0006_recovery_statuses.sql` | exact |
| `packages/core/src/db/mod.rs` (register 0015) | config | batch (migration registration list) | itself — the existing `migration_source_list()` (extend the `vec!`) | exact |
| `packages/core/src/domain/authoring_proposal.rs` (extend: `Issue` payload variant, merge/defer verbs, count-check, dup-scoring) | model/service | CRUD (transactional write) | itself — `create_proposal_in_tx` / `accept_proposal` | exact |
| `packages/core/src/query/authoring.rs` (extend: dup columns in projection) | service | request-response (bounded read) | itself — `resolve_limit`, `list_pending_proposals` | exact |
| `packages/core/src/query/search.rs` (extend or sibling fn: bm25 duplicate lookup) | service | transform (FTS5 query construction) | itself — `to_fts5_prefix_phrase`, `search_items` | exact |
| `packages/core/tests/authoring_proposal.rs` (new source-gate + adversarial corpus tests) | test | event-driven / source-scan | itself — `no_accept_all_identifier_exists_outside_this_gates_own_file` + `sources_under` | exact |
| `packages/core/tests/migration_safety.rs` (new 0015 rebuild case) | test | batch (migration fixture) | itself — `build_n_minus_1_fixture` and surrounding cases | exact |
| `packages/sidecar/src/mcp-permission-server.ts` (add `propose_item` tool) | route/controller | request-response (MCP tool call) | itself — `PROPOSE_TASK_TOOL_NAME` / `AUTHORING_PROPOSE_TASK_TOOL_NAME` pair | exact |
| `packages/sidecar/test/authoring-proposal-wire.test.mjs` (new sibling test for `propose_item`) | test | request-response (wire-shape unit test) | itself — same file's `propose_task` assertions | exact |
| `packages/sidecar/src/claude-code-adapter.ts` (`writeHookSettings` param + `buildClaudeArgv` allowedTools entry) | middleware/config | event-driven (hook wiring) | itself — `writeHookSettings`, `SUMMARY_TOOL_NAME` wiring in `buildClaudeArgv` | exact |
| `packages/sidecar/src/stage-gate-hook.ts` | middleware | event-driven (PreToolUse hook) | **NO CHANGE NEEDED** — fix lives entirely in `claude-code-adapter.ts` per Pitfall 1 Option 1 | n/a |
| `packages/desktop/src-tauri/src/commands/authoring.rs` (new `authoring_proposal_merge`, `authoring_proposal_defer`, bulk-reject, bulk-defer commands) | controller | CRUD (Tauri command) | itself — `authoring_proposal_accept` / `authoring_proposals_for_run` cluster | exact |
| `packages/desktop/src-tauri/src/main.rs` (register new commands in `generate_handler!`) | config | request-response | itself — existing `commands::authoring::authoring_proposal_accept` entry, line 174 | exact |
| `packages/desktop/src/triage/TriageSurface.tsx` (new) | component | request-response (React view + TanStack Query) | `packages/desktop/src/session/SessionSurface.tsx` (structural sibling) + `packages/desktop/src/board/TriageLane.tsx` (triage-domain sibling) | role-match (new file, two partial analogs) |
| `packages/desktop/src/authoring/useAuthoringQuery.ts` (extend: `useMergeProposal`, `useDeferProposal`, bulk hooks) | hook | request-response (TanStack Query) | itself — `useRunProposals` / `useProjectProposals` | exact |
| UAT bridge for merge/defer/duplicate/limit ops | test (harness) | event-driven (stdin-JSON bridge) | `packages/core/tests/bin/uat_authoring_ops.rs` | exact |

## Pattern Assignments

### `packages/core/src/db/migrations/0015_proposal_triage_extension.sql` (migration, table-rebuild)

**Analog:** `packages/core/src/db/migrations/0006_recovery_statuses.sql`

This is the documented rebuild recipe cited by RESEARCH.md Pitfall 2/3. `authoring_proposals` is
self-referential (`parent_proposal_id REFERENCES authoring_proposals(id)`) exactly like
`agent_runs`→`worktrees` was in 0006, so the same `PRAGMA foreign_keys` handling applies (already
disabled at the connection level by `open_and_migrate`, not inside the migration file).

**Rebuild recipe** (verbatim shape, lines 27-42):
```sql
CREATE TABLE worktrees_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id),
    ...
    status TEXT NOT NULL CHECK (status IN ('active', 'stale', 'merged', 'abandoned', 'missing')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

INSERT INTO worktrees_new (
    id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
)
SELECT id, task_id, project_id, path, branch, base_branch, status, created_by, created_at
FROM worktrees;

DROP TABLE worktrees;

ALTER TABLE worktrees_new RENAME TO worktrees;
```
Apply the identical five-step shape to `authoring_proposals`: extend `target_type` CHECK with
`'issue'`, extend `status` CHECK with `'merged'`/`'deferred'`, add `duplicate_of TEXT`,
`duplicate_score REAL`, and the D-99 turn-pointer column as plain new columns in the same
`CREATE TABLE ..._new`. **Critical:** `DROP TABLE` drops every index on the old table and `RENAME
TO` does not resurrect them — re-create all three existing indexes
(`idx_authoring_proposals_run_status`, `idx_authoring_proposals_epic_status`,
`idx_authoring_proposals_parent`) plus the `0012` migration's `(project_id, status, created_at
DESC)` index, in this same migration file.

**Header-comment convention to copy** (0006, lines 1-24): a numbered "Owner decisions closing this
migration's shape" block naming each D-number and why, plus the `PRAGMA foreign_keys` explanation
paragraph verbatim-adapted for `authoring_proposals`.

**Registration** — `packages/core/src/db/mod.rs:20-30`, `migration_source_list()`:
```rust
fn migration_source_list() -> Vec<&'static str> {
    vec![
        include_str!("migrations/0001_actors.sql"),
        ...
        include_str!("migrations/0009_criteria_revisions.sql"),
        // ... through 0014 ...
    ]
}
```
Append `include_str!("migrations/0015_proposal_triage_extension.sql")` at the end of this exact
`vec!`. This is the *only* registration point — `tests/migration_safety.rs` reads the same list via
`migration_sources()`, so no second registration is needed or wanted.

---

### `packages/core/src/domain/authoring_proposal.rs` (model/service, CRUD)

**Analog:** itself (extension, not a new file)

**Transactional write pattern to extend** (verified, lines 209-224 excerpted in RESEARCH.md, module
header lines 1-16):
```rust
let (project_id, epic_id, actor_id): (String, Option<String>, String) = tx
    .query_row(
        "SELECT project_id, epic_id, actor_id FROM agent_runs WHERE id = ?1",
        params![agent_run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;
```
D-110's `COUNT(*)` against `idx_authoring_proposals_run_status` and D-107's `bm25` duplicate lookup
must both be inserted as additional statements between this identity resolution and the `INSERT`,
inside the same `Transaction` — never a second round trip, never identity taken from a caller
argument.

**Enum to extend** (verified, lines 88-95):
```rust
pub enum ProposalPayload {
    Epic { title: String, description: Option<String> },
    Task { title: String, description: Option<String> },
    Criterion { statement: String, verification_hint: Option<String> },
    Assumption { assumption: String, answer: String },
}
```
Add `Issue { title: String, body: Option<String>, kind: String }` matching `issues.kind`'s own
CHECK (`bug`/`idea`/`question`/`risk`, `0002_board_schema.sql:87`).

**Validation to extend** — `validate_payload` (cited by RESEARCH.md at `authoring_proposal.rs:823-
876`, `MAX_PROPOSAL_TITLE_LEN = 500`, `MAX_PROPOSAL_TEXT_LEN = 1000`): add the `Issue` match arm
with the same bounds, and add a bound for D-99's new `rationale` field.

**Merge materialiser (D-101):** call `domain::issue::create_issue` with `IssueParent::Task`/
`IssueParent::Epic` — same canonical writer `issue.rs` already exports, verified `IssueParent` enum
at `issue.rs:376-420`. Do not branch a single call site on "triggered by accept vs. merge" — two
distinct call sites into the same function (Pitfall 5).

---

### `packages/core/src/query/authoring.rs` (service, bounded read)

**Analog:** itself

**Bounded-read idiom to preserve** (verified, lines 38-41):
```rust
fn resolve_limit(limit: i64) -> i64 {
    let base = if limit <= 0 { DEFAULT_LIMIT } else { limit };
    base.min(MAX_LIMIT)
}
```
Every new read this phase adds (decided-set duplicate corpus, returned-candidate lookup for D-108)
must go through this exact clamp shape — never an `Option` defaulting to unbounded.

---

### `packages/core/src/query/search.rs` (service, FTS5 query construction)

**Analog:** itself — no separate FTS5 analog exists elsewhere in the repo; this is the only
existing FTS5 consumer.

**Escaping helper to reuse, never reimplement** (verified, lines 51-60):
```rust
fn to_fts5_prefix_phrase(term: &str) -> String {
    let mut wrapped = String::with_capacity(term.len() + 3);
    wrapped.push('"');
    wrapped.push_str(&term.replace('"', "\"\""));
    wrapped.push('"');
    wrapped.push('*');
    wrapped
}
```
The duplicate detector's query construction must call this function directly (or a sibling
function that itself calls it) — a second, unescaped FTS5 MATCH string reopens the injection risk
this one closes.

**bm25 sign convention (RESEARCH.md Pitfall 7, not yet exercised anywhere in this codebase):** no
existing call site here uses `bm25()` — `search_items` ranks by the base tables' own `ORDER_BY`,
not by relevance score. **NO ANALOG for the bm25-scored-ranking half specifically** — the nearest
neighbour is this file's own MATCH-query construction pattern (`to_fts5_prefix_phrase` +
`named_params!` binding), which the new duplicate-lookup function should follow for everything
except the ranking clause itself, where `ORDER BY bm25(tbl) ASC` and `score < THRESHOLD` (negative
= better) must be written fresh per SQLite's own documented convention — no in-repo precedent to
copy for the sign handling.

---

### `packages/core/tests/authoring_proposal.rs` (test, source-scan gate)

**Analog:** itself — `sources_under` + `no_accept_all_identifier_exists_outside_this_gates_own_file`
(verified, lines 1296-1381)

**The walker to reuse verbatim, not reimplement:**
```rust
fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path
                .extension()
                .is_some_and(|e| e == "rs" || e == "ts" || e == "tsx")
            {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths
        .into_iter()
        .map(|p| {
            let body = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}
```

**The gate shape to copy for D-100** (verbatim structure, lines 1336-1381):
```rust
const FORBIDDEN_IDENTIFIERS: [&str; 4] = ["accept_all", "acceptAll", "accept_remaining", "acceptRemaining"];

#[test]
fn no_accept_all_identifier_exists_outside_this_gates_own_file() {
    let root = workspace_root();
    let scan_dirs = [
        root.join("packages/core/src"),
        root.join("packages/desktop/src-tauri/src"),
        root.join("packages/desktop/src"),
    ];
    let mut offenders = Vec::new();
    for dir in scan_dirs {
        for (path, body) in sources_under(&dir) {
            for (n, line) in body.lines().enumerate() {
                if is_whole_line_comment(line) { continue; }
                for forbidden in FORBIDDEN_IDENTIFIERS {
                    if line.contains(forbidden) {
                        offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
                    }
                }
            }
        }
    }
    assert!(offenders.is_empty(), "... Offending lines:\n  {}", offenders.join("\n  "));
}
```
For D-100's new gate: `FORBIDDEN_IDENTIFIERS` becomes `["INSERT INTO tasks", "INSERT INTO epics",
"INSERT INTO issues", "INSERT INTO acceptance_criteria", "UPDATE acceptance_criteria"]`, scan dirs
become `packages/core/src`, `packages/desktop/src-tauri/src`, `packages/sidecar/src`, and the walk
must exclude the canonical-writer modules themselves (`domain::task`, `domain::epic`,
`domain::issue`, `domain::acceptance_criterion`) via an allow-list check on `path`, since those
files legitimately contain the forbidden strings.

**Also copy the "gate on the gate" pattern** (lines 1383-1419,
`the_no_accept_all_gate_actually_reaches_the_frontend_tree`) — write an equivalent test asserting
the new gate's walker actually collects `.tsx` files under `packages/desktop/src`, since a
`.rs`-only walker silently defeats a TS/TSX-relevant gate (the exact coverage hole Phase 5
verification found once already).

**D-100's adversarial corpus** — no existing analog for "drive every propose/amend/delete path and
assert zero canonical rows appear" specifically for this phase's new tool; RESEARCH.md names D-62/
AGNT-07 as the precedent shape to mirror (not read this session — **NO ANALOG READ**, nearest
neighbour is this same test file's existing accept-path tests that already assert `materialised_id`
is `None` until accept).

---

### `packages/core/tests/migration_safety.rs` (test, migration rebuild case)

**Analog:** itself

**Shape to extend** (verified, lines 1-40): the file builds its "N-1" fixture from
`core::db::migration_sources()` — the same ordered list `db::mod.rs`'s `migration_source_list()`
builds — so a new `0015` migration is automatically exercised by every existing N-1/N-plus-one-bad-
migration case with zero new fixture code needed for the general rebuild-safety property. Add one
new, specific case exercising `0015`'s self-referential-FK rebuild (Pitfall 3): open a fresh DB at
N-1 (0014), insert an `authoring_proposals` row with a non-null `parent_proposal_id` pointing at
another `authoring_proposals` row, run `to_latest()`, and assert both rows survive with their
`parent_proposal_id` link intact and the CHECK constraints now accept `'issue'`/`'merged'`/
`'deferred'`.

```rust
// Existing scratch/fixture idiom to copy (verified, lines 17-19, 34-40):
fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}
fn build_n_minus_1_fixture(db_path: &std::path::Path) -> Connection {
    let all_sources = migration_sources();
    assert!(all_sources.len() >= 2, "...");
    // ... apply all_sources[..len-1] ...
}
```

---

### `packages/sidecar/src/mcp-permission-server.ts` (route/controller, MCP tool)

**Analog:** itself — `PROPOSE_TASK_TOOL_NAME` / `AUTHORING_PROPOSE_TASK_TOOL_NAME` pair (verified,
lines 73-92)

**Two-constant naming pattern to copy exactly:**
```typescript
export const PROPOSE_TASK_TOOL_NAME = "propose_task";
export const AUTHORING_PROPOSE_TASK_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${PROPOSE_TASK_TOOL_NAME}`;
```
For `propose_item`: `export const PROPOSE_ITEM_TOOL_NAME = "propose_item";` plus
`EXECUTION_PROPOSE_ITEM_TOOL_NAME = \`mcp__${MCP_SERVER_NAME}__${PROPOSE_ITEM_TOOL_NAME}\`` (a
distinct constant name from the authoring family's `AUTHORING_` prefix, since D-98 keeps this a
single new tool separate from the six-tool authoring family — do not add it to
`AUTHORING_WRITE_TOOL_NAMES`).

The `REPORT_SUMMARY_TOOL_NAME`/`SUMMARY_TOOL_NAME` pair (lines 88-92) is the more directly relevant
precedent per D-98's own wording ("mirroring exactly how `report_summary` was added for execution
runs") — same two-constant shape, same "declared beside the others so names can never be confused"
doc-comment convention.

**Tool-definition + schema shape** — the sidecar wire test names `proposeTaskToolDefinition` with
`inputSchema.properties`/`required` (see wire-test excerpt below); `propose_item`'s definition
should declare `target_type` (enum `task`/`issue`/`epic`), plus the payload fields and D-99's
required `rationale` field, following the same `inputSchema` shape.

---

### `packages/sidecar/test/authoring-proposal-wire.test.mjs` (test, wire-shape unit test)

**Analog:** itself (same file's `propose_task` block, verified lines 1-60)

```javascript
import {
  AUTHORING_PROPOSE_TASK_TOOL_NAME,
  buildProposeTaskPayload,
  MCP_SERVER_NAME,
  proposeTaskToolDefinition,
} from "../dist/mcp-permission-server.js";
import { buildAuthoringClaudeArgv } from "../dist/claude-code-adapter.js";

test("proposeTaskToolDefinition's inputSchema declares title and description, marking title required", () => {
  assert.equal(proposeTaskToolDefinition.name, "propose_task");
  const properties = Object.keys(proposeTaskToolDefinition.inputSchema.properties);
  assert.ok(properties.includes("title"));
  assert.deepEqual(proposeTaskToolDefinition.inputSchema.required, ["title"]);
});

test("the socket payload built for a tool call carries no runId/projectId/epicId field anywhere", () => {
  const payload = buildProposeTaskPayload({ title: "Write the doc", description: "explain it" });
  const serialised = JSON.stringify(payload);
  assert.ok(!/"runId"|"run_id"|"projectId"|"project_id"|"epicId"|"epic_id"/.test(serialised), serialised);
});

test("a malformed call (empty title) is rejected before any socket write", () => {
  assert.throws(() => buildProposeTaskPayload({ title: "" }), /non-empty title/);
});
```
Write a new sibling block (same file, or a new `propose-item-wire.test.mjs` following the exact
same import/assert shape) proving: (1) `propose_item`'s `inputSchema` declares `target_type`/
payload/`rationale`, (2) the fully-qualified name equals
`mcp__flywheel-permissions__propose_item`, (3) the built payload never carries `runId`/`projectId`/
`epicId`, (4) a malformed call (bad `target_type`, missing `rationale`) throws before any socket
write, (5) `buildClaudeArgv` (execution-run path, not `buildAuthoringClaudeArgv`) pushes the tool
onto `--allowedTools` when `proposeItemToolName` is supplied.

---

### `packages/sidecar/src/claude-code-adapter.ts` (middleware/config, hook wiring)

**Analog:** itself — `writeHookSettings` + `buildClaudeArgv`'s `summaryToolName` wiring

**The collision (Pitfall 1) — exact call site to change** (verified, lines 170-194):
```typescript
function writeHookSettings(runtimeDir: string, runId: string): string | undefined {
  try {
    const settingsPath = permissionSettingsPath(runtimeDir, runId);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const settings = {
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }] },
          { matcher: AUTHORING_STAGE_GATE_MATCHER, hooks: [{ type: "command", command: `${process.execPath} ${stageGateHookScriptPath()}` }] },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return settingsPath;
  } catch (err) { ... }
}
```
Two call sites (verified): line 1204 (execution-run `startSession`) and line 1444
(`startAuthoringSession`). Per RESEARCH.md's recommended fix (Pitfall 1 Option 1), parameterize
this function with a boolean (e.g. `includeAuthoringStageGate: boolean`) so the
`AUTHORING_STAGE_GATE_MATCHER` entry is included only at the authoring call site (line 1444) and
omitted at the execution-run call site (line 1204) — the `Bash` entry stays byte-identical at both.

**allowedTools wiring pattern to copy** (verified, lines 268-304, `SUMMARY_TOOL_NAME` precedent):
```typescript
export function buildClaudeArgv(options: {
  summaryToolName?: string;
  // add: proposeItemToolName?: string;
}): string[] {
  if (options.permissionPromptToolName && options.mcpConfig) {
    pushPermissionPromptFlags(argv, options.permissionPromptToolName, options.mcpConfig);
    if (options.summaryToolName) {
      argv.push("--allowedTools", options.summaryToolName);
    }
    // add: if (options.proposeItemToolName) { argv.push("--allowedTools", options.proposeItemToolName); }
  }
}
```

---

### `packages/sidecar/src/stage-gate-hook.ts` — NO CHANGE

RESEARCH.md's recommended fix (Option 1) resolves Pitfall 1 entirely inside
`claude-code-adapter.ts`'s `writeHookSettings` call sites. This file's own doc comment states it is
deliberately DB-free/socket-free "to keep this check live without a poll loop" — do not add a
run-kind branch here (Option 3, explicitly rejected in RESEARCH.md).

---

### `packages/desktop/src-tauri/src/commands/authoring.rs` (controller, Tauri command)

**Analog:** itself — `authoring_proposal_accept` cluster and `authoring_proposals_for_run`
(verified, lines 1-16, 497-560)

**Bounded-read idiom, redeclared at this layer, independent of the domain-layer clamp:**
```rust
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;

fn resolve_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}
```

**Command shape to copy for the new merge/defer/bulk commands:**
```rust
#[tauri::command]
pub fn authoring_proposals_for_run(
    state: State<AppState>,
    agent_run_id: String,
    limit: Option<i64>,
) -> Result<Vec<ProposalDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let resolved_limit = resolve_limit(limit);
    let proposals = flywheel_core::domain::authoring_proposal::pending_proposals_for_run(
        &conn, &agent_run_id, resolved_limit,
    ).map_err(|e| e.to_string())?;
    Ok(proposals.into_iter().map(ProposalDto::from).collect())
}
```
New commands (`authoring_proposal_merge`, `authoring_proposal_defer`,
`authoring_proposals_reject_bulk`, `authoring_proposals_defer_bulk`) follow this exact
`State<AppState>` → `conn.lock()` → domain-function call → `.map_err(|e| e.to_string())` →
DTO-project shape. Per the "Don't Hand-Roll" table, the bulk commands mirror `accept_subtree`'s own
shape (one root op, loop over a bounded set, one transaction, one outcome struct) — **not** read
this session as verbatim excerpt, but named explicitly as the shape to mirror; do not invent a
generic verb-dispatch bulk mechanism.

**Module header convention to copy** (verified, lines 1-16): a paragraph explaining which D-numbers
this module implements and why each function's ordering/identity-resolution choice was made —
`authoring_proposal_merge`/`defer` should get the same treatment naming D-101/D-102/D-104.

---

### `packages/desktop/src-tauri/src/main.rs` (config, invoke-handler registration)

**Analog:** itself

**Registration point** (verified, line 174 inside the `generate_handler!` macro at line 99):
```rust
.invoke_handler(tauri::generate_handler![
    ...
    commands::authoring::authoring_proposal_accept,
    ...
])
```
Add the four new command function names to this same list, in the same
`commands::authoring::<fn_name>` form — this is the only registration point; a command not listed
here is unreachable from the renderer regardless of its `#[tauri::command]` attribute.

---

### `packages/desktop/src/triage/TriageSurface.tsx` (new component, request-response)

**Analogs:**
1. `packages/desktop/src/session/SessionSurface.tsx` — the structural sibling D-103 explicitly
   names ("modelled on"). **Not fully read this session** (only the `ProposalTray` mount condition
   at lines 505-520/1280-1305 was read, per RESEARCH.md Pitfall 6) — the planner should read this
   file's overall layout shell (header, feed, action bar) before drafting `TriageSurface.tsx`.
2. `packages/desktop/src/board/TriageLane.tsx` — the triage-*domain* sibling (verified in full,
   header comment lines 1-30 and `groupProposals` lines 42-60+ excerpted above). This is the
   closer analog for the *data model and grouping logic* (parent/child proposal grouping,
   `AuthoringProposalDto`), even though it is a board-lane component rather than a full surface.

**Grouping logic to copy verbatim** (verified, from `TriageLane.tsx`):
```typescript
function groupProposals(proposals: AuthoringProposalDto[]): ProposalGroup[] {
  const byId = new Map(proposals.map((p) => [p.id, p] as const));
  const childrenByParent = new Map<string, AuthoringProposalDto[]>();
  for (const proposal of proposals) {
    // groups by parentProposalId; orphaned children (D-16) still render standalone
  }
}
```

**Bulk-control constraint (D-104) — must hold in the new file:** no lane-wide or surface-wide
*accept* control may appear anywhere in `packages/desktop/src` (the existing gate at
`packages/core/tests/authoring_proposal.rs:1337` scans this exact tree and must stay green
unmodified). Bulk reject/defer controls are permitted and expected.

**Row component reused, not rebuilt:** `packages/desktop/src/authoring/ProposalRow.tsx` — the
accept/reject/amend/accept-subtree row D-103's surface reuses and D-101/D-102 extend with merge/
defer actions.

**Keyboard bindings:** `packages/desktop/src/state/keyboard.ts` — existing proposal-tray
keybindings live at lines 190-260 (per RESEARCH.md); new triage-surface bindings for merge/defer
must not collide with this existing map.

---

### `packages/desktop/src/authoring/useAuthoringQuery.ts` (hook, TanStack Query)

**Analog:** itself — `useRunProposals` (verified, full excerpt)

```typescript
export function useRunProposals(agentRunId: string | null | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!agentRunId) return undefined;
    const queryKey = authoringProposalsQueryKey(agentRunId);
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn(); else unlisten = fn;
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [agentRunId, queryClient]);

  return useQuery({
    queryKey: authoringProposalsQueryKey(agentRunId ?? "none"),
    queryFn: () => authoringProposalsForRun(agentRunId as string),
    enabled: Boolean(agentRunId),
  });
}
```
New hooks (`useMergeProposal`, `useDeferProposal`, `useRejectProposalsBulk`,
`useDeferProposalsBulk`) should follow the sibling `useAcceptProposal`/`useRejectProposal` mutation
shape (named in the module header, not fully read this session — **read `useAcceptProposal`'s body
before implementing** since only the query half was excerpted here). Invalidation stays on
`board:changed` only, per this module's own documented rule — never a second `agent:event`
subscription in this file.

**Data-fetch idiom for the whole phase:** TanStack Query throughout, transport centralized in
`adapters/tauri.ts` (this file is explicitly "the ONLY file under `packages/desktop/src/authoring`
that calls into the Tauri transport" — the new triage hooks belong in this same file or a sibling
module following the identical single-transport-file rule, not scattered `invokeCommand` calls in
`TriageSurface.tsx` itself).

---

### UAT bridge for merge/defer/duplicate/limit operations

**Analog:** `packages/core/tests/bin/uat_authoring_ops.rs`

**Shape to extend** (verified, module header + usage list, lines 1-50):
```
Usage:
  uat_authoring_ops register-project <repo_path>
  uat_authoring_ops start-run <project_id> [epic_id]
  uat_authoring_ops apply-proposal-created            (reads one JSON event from stdin)
  uat_authoring_ops list-pending <run_id>
  uat_authoring_ops accept-proposal <proposal_id>
  uat_authoring_ops reject-proposal <proposal_id> [reason]
  ...
```
Every subcommand: writes through real domain functions (never hand-rolled SQL), refuses to run
without `FLYWHEEL_APP_DATA_DIR` set, prints one line of JSON on success, non-zero exit with a
stderr message on failure. New subcommands to add: `merge-proposal <proposal_id> <target_id>`,
`defer-proposal <proposal_id>`, `reject-bulk <id...>`, `defer-bulk <id...>`, and a way to drive
`propose_item`'s volume-limit and duplicate-flag paths (e.g. `propose-item <run_id> <target_type>
<title> ...` looping to exercise the 11th-call refusal). Per PROP-06's test map, this is the
frontend's *only* automated test seam today — `packages/desktop/src` has no `.tsx`/`vitest`/`jest`
harness (confirmed absent).

## Shared Patterns

### Server-side identity resolution (applies to every new write this phase adds)
**Source:** `packages/core/src/domain/authoring_proposal.rs:218-224`
**Apply to:** `propose_item`'s handler, the new merge/defer domain functions, the new Tauri
commands.
```rust
let (project_id, epic_id, actor_id): (String, Option<String>, String) = tx
    .query_row(
        "SELECT project_id, epic_id, actor_id FROM agent_runs WHERE id = ?1",
        params![agent_run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;
```
No new payload may carry `project_id`/`epic_id`/`run_id` as a trusted field — the wire test pattern
(`authoring-proposal-wire.test.mjs`) asserts this by regex on the serialised payload; the new
`propose_item` wire test must carry the identical assertion.

### Bounded, indexed reads only
**Source:** `packages/core/src/query/authoring.rs:38-41`
**Apply to:** every new read (decided-set duplicate corpus, merge target-picker search, triage
surface's own list read).
```rust
fn resolve_limit(limit: i64) -> i64 {
    let base = if limit <= 0 { DEFAULT_LIMIT } else { limit };
    base.min(MAX_LIMIT)
}
```

### Source-gate-over-convention for structural prohibitions
**Source:** `packages/core/tests/authoring_proposal.rs:1311-1381` (`sources_under` +
`no_accept_all_identifier_exists_outside_this_gates_own_file`)
**Apply to:** D-100's no-promotion-path gate, D-104's bulk-accept prohibition (already green,
must stay green and unmodified).

### FTS5 escaping — one implementation, never duplicated
**Source:** `packages/core/src/query/search.rs:51-60` (`to_fts5_prefix_phrase`)
**Apply to:** the new duplicate-detection query construction (D-105/D-107) — call this function,
never reimplement quote-doubling/prefix-wrapping.

### Two-constant tool-name declaration
**Source:** `packages/sidecar/src/mcp-permission-server.ts:73-92`
(`REPORT_SUMMARY_TOOL_NAME`/`SUMMARY_TOOL_NAME`, `PROPOSE_TASK_TOOL_NAME`/
`AUTHORING_PROPOSE_TASK_TOOL_NAME`)
**Apply to:** `propose_item`'s two constants in the same file.

### Event-append, re-derived display (never a second stored copy)
**Source:** cited in CONTEXT.md as D-74/D-75, not re-read this session — nearest verified analog
is `create_proposal_in_tx`'s own `append_event(...)` call (line ~206 of `authoring_proposal.rs`,
inside the excerpt above): one `append_event` call per mutating transaction, one `events` row, no
duplicate storage of the same fact.
**Apply to:** D-112's volume-limit-exhausted notice.

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|---|---|---|---|
| bm25-scored ranking clause (sign convention, `ORDER BY bm25(tbl) ASC`, `score < THRESHOLD`) | query construction | transform | No existing call site in this repo uses `bm25()` at all — `search_items` ranks by the base tables' `ORDER_BY`, not relevance score. Nearest neighbour: `to_fts5_prefix_phrase` + `named_params!` binding pattern in the same file, for everything except the ranking/threshold logic itself, which must be written fresh per SQLite's own documented (negative-is-better) convention — do not invent an in-repo precedent that doesn't exist. |
| D-106's decided-set FTS index (new `authoring_proposals_fts` table, if that discretion path is chosen) | migration + query | transform | RESEARCH.md recommends this as a new external-content FTS5 table "following `0002_board_schema.sql`'s exact trigger pattern" (lines 151-189, excerpted above under the `packages/core/src/query/search.rs` entry) — that IS the analog to copy if this path is chosen; flagging here only because it is a *new* virtual table, not an extension of an existing one, so the planner should treat it as its own migration file, not folded into `0015`. |
| D-100's adversarial corpus (drive every propose/amend/delete path, assert zero canonical rows) | test | event-driven | RESEARCH.md names D-62/AGNT-07 as the precedent; that test file was not read this session. Nearest verified neighbour: this same file's existing accept-path tests, which already assert `materialised_id` is `None` until accept — extend from there rather than inventing a new harness shape. |
| `useAcceptProposal`/`useRejectProposal` mutation hook bodies | hook | request-response | Only `useRunProposals` (the query half) was read in full this session; the mutation hooks are named in the module's own header comment but their bodies were not excerpted. Read them before implementing `useMergeProposal`/`useDeferProposal` — they are almost certainly the correct shape to copy, but this was not verified byte-for-byte this session. |
| `SessionSurface.tsx`'s overall layout shell (header/feed/action-bar structure) | component | request-response | Only the `ProposalTray` mount condition (lines 505-520, 1280-1305) was read this session, per the specific pitfall RESEARCH.md flagged. The rest of the ~1300+ line file (the layout D-103 says `TriageSurface.tsx` is "modelled on") was not read — planner should read it before drafting the new surface's shell. |

## Metadata

**Analog search scope:** `packages/core/src/db/migrations/`, `packages/core/src/domain/`,
`packages/core/src/query/`, `packages/core/tests/`, `packages/sidecar/src/`,
`packages/sidecar/test/`, `packages/desktop/src-tauri/src/commands/`,
`packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src/board/`,
`packages/desktop/src/authoring/`, `packages/desktop/src/session/` (partial),
`packages/desktop/src/state/keyboard.ts` (not read, only cited).
**Files scanned:** 16 read in full or targeted excerpt this session (all git-tracked, verified via
directory listing — no `.gsd/` mirror paths encountered anywhere in this phase's scope).
**Pattern extraction date:** 2026-09-30
