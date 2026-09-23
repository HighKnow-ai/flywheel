# Phase 5: Socratic Epic Authoring - Pattern Map

**Mapped:** 2026-09-23
**Files analyzed:** 13 (from RESEARCH.md's "Recommended Project Structure" + CONTEXT.md's file-level canonical refs)
**Analogs found:** 13 / 13 (all files this phase touches are same-shape extensions of shipped, tested code — RESEARCH.md's own headline finding)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/db/migrations/0010_authoring_staging.sql` | migration | CRUD (schema) | `packages/core/src/db/migrations/0009_criteria_revisions.sql` | role-match (additive table) |
| `packages/core/src/db/migrations/0011_authoring_runs.sql` | migration | CRUD (schema, CHECK rebuild) | `packages/core/src/db/migrations/0006_recovery_statuses.sql` | exact (identical rebuild shape: nullable column + widened CHECK) |
| `packages/core/src/domain/authoring_proposal.rs` | model/service | CRUD (transactional write + event) | `packages/core/src/domain/session_summary.rs` (`create_summary`) | exact (scoped write, identity derived from run, one-tx write+event) |
| `packages/core/src/epic_context_packet.rs` | service (pure query) | request-response (read-only assembly) | `packages/core/src/context_packet.rs` | exact (declared sibling in RESEARCH.md) |
| `packages/core/src/query/authoring.rs` | model/service (query) | CRUD (bounded read) | `packages/desktop/src-tauri/src/commands/board.rs` (`board_list`/`board_search`) | exact (same `DEFAULT_LIMIT`/`MAX_LIMIT`/clamp idiom) |
| `packages/core/src/domain/epic.rs::list_epics` (modify) | model (query) | CRUD (bounded read) | same file, `board.rs` clamp idiom | exact (closing AR-01-04's exemption) |
| `packages/core/src/domain/acceptance_criterion.rs` (extend, `amend` verb materialisation) | model | CRUD (revision-chain write) | same file, `revise_criterion` (lines 375-537) | exact — reuse, do not fork |
| `packages/sidecar/src/mcp-authoring-server.ts` (or 3rd+ tool set on `mcp-permission-server.ts`) | route/controller (MCP tool server) | request-response (tool call → socket relay → core) | `packages/sidecar/src/mcp-permission-server.ts` | exact (two-role socket-relay pattern, third+ tool set through same seam) |
| `packages/sidecar/src/pretooluse-hook.ts` (extend) | middleware | event-driven (hook fired per tool call) | same file, existing `Bash` matcher | exact — extend, don't replace |
| `packages/sidecar/src/claude-code-adapter.ts::writeHookSettings` (extend) | config/service | event-driven (spawn-time settings) | same function, lines 138-158 | exact |
| `packages/sidecar/src/claude-code-adapter.ts::startAuthoringSession` (new) | service | request-response / streaming (spike-dependent) | same file, `startSession`/`buildClaudeArgv` | role-match (spike decides exact shape) |
| `packages/desktop/src/authoring/ProposalTray.tsx` | component | CRUD (renders + dispatches accept/reject/amend) | `packages/desktop/src/session/SessionSurface.tsx` (`PermissionRequestCard` mount pattern) | role-match (side panel beside the feed) |
| `packages/desktop/src/board/TriageLane.tsx` | component | CRUD (collapsible lane, list + quick actions) | `packages/desktop/src/board/IssuesLane.tsx` | exact (declared sibling in RESEARCH.md and CONTEXT.md D-82) |

## Pattern Assignments

### `packages/core/src/db/migrations/0011_authoring_runs.sql` (migration, CHECK-constrained rebuild)

**Analog:** `packages/core/src/db/migrations/0006_recovery_statuses.sql`

**Full rebuild sequence to copy verbatim** (lines 60-100 of the analog, applied to `agent_runs` and `triggers`):
```sql
CREATE TABLE agent_runs_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT REFERENCES tasks(id),      -- D-84: NOT NULL removed
    epic_id TEXT REFERENCES epics(id),      -- D-84: new nullable column
    project_id TEXT NOT NULL REFERENCES projects(id),
    trigger_id TEXT NOT NULL REFERENCES triggers(id),
    adapter TEXT NOT NULL DEFAULT 'claude_code',
    actor_id TEXT NOT NULL REFERENCES actors(id),
    status TEXT NOT NULL CHECK (status IN ('running','blocked','completed','failed','interrupted','abandoned')),
    -- ...every other column reproduced verbatim from the CURRENT agent_runs definition...
);

INSERT INTO agent_runs_new (/* explicit column list, never SELECT * */)
SELECT /* same explicit list, epic_id -> NULL */ FROM agent_runs;

DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;

-- DROP TABLE drops indexes; RENAME TO does not resurrect them:
CREATE INDEX idx_agent_runs_task_started ON agent_runs (task_id, started_at DESC);
CREATE INDEX idx_agent_runs_project_status ON agent_runs (project_id, status);
```
**Connection-level pragma note** (analog lines 24-35, do not skip): toggle `PRAGMA foreign_keys = OFF` at the connection level BEFORE calling `MIGRATIONS.to_latest()`, never inside the migration file's own SQL — `rusqlite_migration` runs each migration body inside its own transaction and SQLite ignores `PRAGMA foreign_keys` once a transaction is open. Re-enable and run `foreign_key_check()` after.

**Repeat identically for `triggers.target_task_id`** (loosen `NOT NULL`, same rebuild shape, own migration file or same file as a second block).

---

### `packages/core/src/db/migrations/0010_authoring_staging.sql` (migration, new table)

**Analog:** `packages/core/src/db/migrations/0009_criteria_revisions.sql` (additive-column/table precedent) — read this file's full 36 lines when building; it is the most recent worked example of adding new columns with a CHECK-consistent default rather than a rebuild, useful for contrasting "just ADD COLUMN is fine" (this table, being brand-new, doesn't even need that) against 0006's full-rebuild case above.

**Shape required by CONTEXT.md D-80/D-81/D-83:** one staging table, columns for `id`, `agent_run_id`, `verb` (`create`|`amend`|`delete`, CHECK-constrained), `target_type` (`epic`|`task`|`criterion`), `target_id` (nullable), `payload` (JSON, discrete fields per Pitfall 3 — never one prose blob), `status` (`pending`|`accepted`|`rejected`, CHECK-constrained, terminal states never deleted per D-83), `rejection_reason` (nullable), `created_at`, `decided_at` (nullable). Index on `(agent_run_id, status)` for the tray query and on `(epic_id-or-equivalent, status)` for the D-83 primed-rejected-set read — mirror the indexing discipline in `0006`'s own `CREATE INDEX` lines.

---

### `packages/core/src/domain/authoring_proposal.rs` (model/service, CRUD)

**Analog:** `packages/core/src/domain/session_summary.rs` (`create_summary`, full file 480 lines — read header comment first)

**The single most load-bearing rule to copy** (analog lines 15-19):
```rust
// Follows `domain::permission_request::create_pending_request`'s one-transaction
// row-write-plus-event shape exactly: resolve `task_id`/`project_id`/`worktree_id` from the
// `agent_runs` row INSIDE the transaction (T-04-01 — `create_summary` accepts no caller-supplied
// `task_id` or `project_id`, so a caller can never attribute a summary to a run it does not
// drive), insert the row, update the pointer, append one event, one commit.
```
Apply identically to `create_proposal(conn, agent_run_id, verb, target_type, target_id, payload)`: resolve `epic_id` (nullable per D-84) from the `agent_runs` row inside the transaction — **never accept `epic_id` as a caller-supplied MCP tool argument.** This is also the V4 Access Control mitigation RESEARCH.md names for the "spoofed `target_id` across epics" threat.

**Append-only discipline to copy** (analog lines 6-13): "a recorded [row] is never rewritten... no setter, no update, no delete path" — the D-83 requirement that a decided proposal row stays terminal (`accepted`/`rejected`) rather than being deleted maps directly onto this same discipline; `accept_proposal`/`reject_proposal` write a status transition, never a content mutation.

**Event append** (`session_summary.rs`'s `create_summary` body, same file): one transaction, one `append_event` call per proposal decision, human-renderable payload (D-19) — same shape as `revise_criterion`'s event payloads shown below.

**Amend-against-a-locked-criterion must route through the existing revision chain — do not fork it.**

**Analog:** `packages/core/src/domain/acceptance_criterion.rs::revise_criterion` (lines 375-537, full function read above)

Key branch to copy exactly:
```rust
let locked = match parent_type.as_str() {
    "task" => criteria_locked_for_task(&tx, &parent_id)?,
    _ => false,
};
if !locked {
    update_criterion_in_tx(&tx, criterion_id, statement, verification_hint, &now)?;
    // ... append "criterion.updated" event ...
} else {
    // Locked: append a successor, never touch the predecessor's own statement.
    let successor_id = new_id();
    let new_revision = revision + 1;
    let chain_root = revision_of.clone().unwrap_or_else(|| criterion_id.to_string());
    // INSERT successor row, UPDATE predecessor's superseded_at ONLY, append "criterion.revised" event
}
```
`authoring_proposal`'s accept-an-`amend`-verb path calls `revise_criterion` directly for a criterion target rather than reimplementing lock detection — `criteria_locked_for_task` is public and importable as-is.

---

### `packages/core/src/epic_context_packet.rs` (service, pure query)

**Analog:** `packages/core/src/context_packet.rs` (590 lines — read the whole file, header comment first, per its own required-reading note)

**Purity contract to copy verbatim** (analog lines 1-6):
```rust
//! `assemble_context_packet` / `render_prompt` (D-28): ... A pure query over the board: no model
//! call, no network call, no mutation of any kind. Every SQL statement below is a literal `&str`,
//! bound through `params![]` — never assembled by `format!`/string interpolation.
```
`assemble_epic_context_packet(conn, epic_id: Option<&str>)` must hold this identically (CTX-04's determinism contract, explicitly named in RESEARCH.md's Anti-Patterns). Reuse the "omit the heading, never emit an empty section" rule (analog's own header comment, referenced by name in CONTEXT.md canonical_refs) for the packet's rendered sections: prior distilled assumptions, task roster with criteria/statuses, and the D-83 rejected-proposal set.

**Struct/field-shape pattern to copy** (analog lines 36-74, `CriterionEntry`/`EpicSection`/`SummaryEntry`): `#[derive(Debug, Clone, PartialEq, Serialize)]` on every packet section struct, `Option<T>` for "absent" rather than empty-string/empty-vec sentinels — apply the same to a new `RejectedProposalEntry`/`AssumptionEntry`/`TaskRosterEntry`.

**Do NOT reuse** `domain::worktree::base_ref_for_task` even though it looks like the obvious helper — analog's own header comment (lines 8-17) explains it has a git-branch-cutting side effect unacceptable in a preview/packet context. The epic packet needs no git-branch logic at all, so this is a non-issue here, but the discipline ("a preview must never mutate") carries over to any epic-side helper this file adds.

---

### `packages/core/src/query/authoring.rs` (query layer, bounded reads)

**Analog:** `packages/desktop/src-tauri/src/commands/board.rs` (lines 1-19) and the same idiom repeated in `events.rs`/`agent_run.rs`

**Clamp idiom to copy exactly:**
```rust
/// The Rust core returns a page, never the whole board (D-03).
const DEFAULT_LIMIT: i64 = 200;
/// The command layer's own cap on the requested limit — independent of, and tighter than, any
/// cap the core itself might apply.
const MAX_LIMIT: i64 = 500;
fn resolve_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}
```
Apply to every new read tool (`search`, `get_epic`, `list_tasks`) AND to `domain::epic::list_epics` (currently unwindowed at `packages/core/src/domain/epic.rs:58-75` — this is AR-01-04, the exemption D-87 explicitly closes). RESEARCH.md's Pitfall 4 names the exact failure mode to avoid: a tool `inputSchema` with no `limit` property, or a handler passing `i64::MAX`/omitting the parameter.

---

### `packages/sidecar/src/mcp-authoring-server.ts` (route/controller, MCP tool server)

**Analog:** `packages/sidecar/src/mcp-permission-server.ts` (456 lines — read the module doc comment first, lines 1-37)

**Two-role pattern to copy** (analog's own header, lines 3-37): a sidecar-side role (`startPermissionServer`, called before the backend spawns, owns the Unix-socket relay) and a standalone MCP-server role (`main()`, run when the compiled file is invoked directly as a subprocess the backend spawns per `--mcp-config`). Default recommendation per RESEARCH.md's Open Question 2: extend `mcp-permission-server.ts` with a third+ tool set rather than a new server process — matches D-64's own stated rationale ("zero new socket, zero new spawned process, zero new `--mcp-config` entry").

**Tool-name declaration pattern to copy exactly** (analog lines 50-72):
```typescript
export const APPROVE_TOOL_NAME = "approve_action";
export const MCP_SERVER_NAME = "flywheel-permissions";
export const PERMISSION_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${APPROVE_TOOL_NAME}`;
export const REPORT_SUMMARY_TOOL_NAME = "report_summary";
export const SUMMARY_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${REPORT_SUMMARY_TOOL_NAME}`;
```
Apply identically for each new authoring tool (`propose_epic`, `propose_task`, `propose_criterion`, `amend_proposal`, `delete_proposal`, `advance_stage`, `search`, `get_epic`, `list_tasks`) — declare the raw name and the fully-qualified `mcp__${MCP_SERVER_NAME}__${name}` constant once, on this side, so the `PreToolUse` hook matcher (below) and `buildClaudeArgv`'s `--allowedTools` composition can never disagree with the server's own registration.

**Second-message-kind-on-one-socket precedent** (analog lines 18-26, D-53) — if the accept/reject/amend decision needs to flow sidecar→core over the existing relay rather than a new transport, follow the shim's `PermissionNoticePayload` shape: a `kind` discriminant field distinguishing the new payload type, checked before the generic held-request path, closed immediately with no entry in the `pending` map when it carries no answer to wait for.

**Input validation pattern**: `summaryToolDefinition`'s `inputSchema` (analog lines 300-326 per RESEARCH.md's V5 citation) — typed `required`/properties, reject malformed refs before any DB write.

---

### `packages/sidecar/src/pretooluse-hook.ts` + `claude-code-adapter.ts::writeHookSettings` (middleware, event-driven gate)

**Analog:** `claude-code-adapter.ts` lines 138-158 (existing function, extend in place — do not replace)

**Exact current shape:**
```typescript
function writeHookSettings(runtimeDir: string, runId: string): string | undefined {
  try {
    const settingsPath = permissionSettingsPath(runtimeDir, runId);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }],
          },
        ],
      },
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings));
    return settingsPath;
  } catch (err) {
    console.error(`flywheel sidecar: failed to write PreToolUse hook settings for ${runId}: ${String(err)}`);
    return undefined;
  }
}
```
**Extension required** (RESEARCH.md Pattern 1, Code Example 3): add a SECOND entry to the `PreToolUse` array, never replace the `"Bash"` one:
```typescript
{
  matcher: "mcp__flywheel-authoring__(propose|amend|delete)_.*",
  hooks: [{ type: "command", command: `${process.execPath} ${stageGateHookScriptPath()}` }],
}
```
**Fail-open-with-log discipline to copy** (function's own doc comment, lines 132-137): a settings-write failure degrades to "no hook injected," logged, never thrown. **RESEARCH.md explicitly flags this needs a STRONGER posture for the authoring gate than the existing Bash gate** (V-threat table: "missing stage gate means the challenge stage can be skipped entirely, directly defeating SHAPE-01") — recommend surfacing this specific failure to the UI as a visible banner rather than silently degrading, a deliberate deviation from the analog's own fail-open posture. Flag this explicitly in the plan rather than copying the analog's severity level unchanged.

---

### `packages/desktop/src/board/TriageLane.tsx` (component, collapsible lane)

**Analog:** `packages/desktop/src/board/IssuesLane.tsx` (full file, 136 lines)

**Collapsible-lane shell to copy structurally:**
```tsx
export function TriageLane({ proposals, onAccept, onReject, onAmend, epicsById }: TriageLaneProps) {
  const [collapsed, setCollapsed] = useState(false);
  // same headerStyle/rowStyle CSSProperties objects as IssuesLane.tsx lines 42-62
  return (
    <div className="triage-lane" role="region" aria-label="Proposals">
      <div className="type-heading" role="button" tabIndex={-1} aria-expanded={!collapsed}
           onClick={() => setCollapsed((c) => !c)} style={headerStyle}>
        {/* ChevronDown/ChevronRight from lucide-react, exactly as IssuesLane */}
        Proposals
        <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
          {proposals.length}
        </span>
      </div>
      {!collapsed && proposals.map((p) => ( /* row per proposal, same rowStyle */ ))}
    </div>
  );
}
```
**Token-only styling discipline** (`IssuesLane.tsx` uses `var(--surface-secondary)`, `var(--text-primary-rack)`, `var(--divider)` throughout, zero hex literals) — CONTEXT.md's canonical_refs explicitly warns `ItemDetailPanel.tsx:219` already has a hex-literal violation; do not add a second one in `TriageLane.tsx`.

**Row-level accept/reject affordance**: no existing lane has per-row accept/reject buttons (`IssuesLane.tsx` only has a parent-picker button) — this is new interaction surface; use the same `onClick={(event) => { event.stopPropagation(); onX?.(...) }}` pattern IssuesLane's parent-picker button uses (lines 105-108) to keep row-click and button-click from conflicting.

---

### `packages/desktop/src/authoring/ProposalTray.tsx` (component, side panel)

**Analog:** `packages/desktop/src/session/SessionSurface.tsx` (860 lines) — specifically the `PermissionRequestCard` mount pattern (line 851) and `StatusStrip` (lines 172-228, mounted line 738)

**Mount-as-sibling-panel pattern**: `SessionSurface.tsx` already composes `StatusStrip` (top strip) and `PermissionRequestCard` (feed-adjacent card) as independently-rendering pieces reading from the same `entries`/`status` state, never inline in the virtualized feed itself. `ProposalTray` should mount the same way — a sibling panel beside the feed reading the staged-proposal list from its own query, not woven into `FeedRow.tsx`'s per-event rendering.

**Constraint to respect** (D-85's own text, quoted in CONTEXT.md): "`StatusStrip` scans top-level numeric fields on loaded log entries, a constraint any new event shape must respect" — if proposal-created events are appended to the same session log stream `StatusStrip` reads, their payload shape must not introduce a numeric top-level field `StatusStrip` would misinterpret. Read `StatusStrip`'s scan logic (lines 172-228) before deciding the event payload shape.

## Shared Patterns

### Single-writer, run-derived identity (V3/V4 security discipline)
**Source:** `packages/core/src/domain/session_summary.rs` lines 15-19; `packages/core/src/domain/authoring_proposal.rs` (new) must copy it
**Apply to:** every new Rust write function this phase adds (`create_proposal`, `accept_proposal`, `reject_proposal`, `amend_proposal`)
```rust
// Resolve task_id/project_id/epic_id/worktree_id from the agent_runs row INSIDE the transaction.
// Never accept these as caller-supplied (MCP tool call) arguments — a caller cannot attribute a
// proposal to a run it does not drive.
```

### Actor-attributed event append, one transaction
**Source:** `packages/core/src/domain/acceptance_criterion.rs::revise_criterion` (both branches), `session_summary.rs::create_summary`
**Apply to:** every proposal create/accept/reject/amend
```rust
let sequence = next_sequence(&tx, &project_id, "local")?;
let payload = serde_json::json!({ /* human-renderable fields, D-19 */ });
append_event(&tx, &project_id, "local", sequence, /* entity_type */, /* entity_id */,
    task_id.as_deref(), epic_id.as_deref(), actor_id, /* event_type */, &payload, &now)?;
tx.commit()...;
```

### CHECK-constrained table rebuild (never a hand-written ALTER)
**Source:** `packages/core/src/db/migrations/0006_recovery_statuses.sql` (full sequence, lines 37-100)
**Apply to:** `0011_authoring_runs.sql`'s `agent_runs`/`triggers` nullable-column changes
The four-step sequence (`CREATE TABLE _new` / explicit-column `INSERT INTO _new SELECT` / `DROP TABLE` / `RENAME TO`), the `PRAGMA foreign_keys` connection-level toggle note, and the "recreate every index — DROP TABLE drops them, RENAME does not resurrect them" reminder are all load-bearing and must not be abbreviated.

### Bounded-read clamp idiom
**Source:** `packages/desktop/src-tauri/src/commands/board.rs` lines 11-19 (also `events.rs`, `agent_run.rs`)
**Apply to:** every new read path an agent can call (`query/authoring.rs`, `domain::epic::list_epics`, the `search`/`get_epic`/`list_tasks` MCP tools)
```rust
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;
fn resolve_limit(limit: Option<i64>) -> i64 { limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT) }
```

### Fully-qualified MCP tool name declaration
**Source:** `packages/sidecar/src/mcp-permission-server.ts` lines 50-72
**Apply to:** every new authoring tool name, declared once on the sidecar side so the `PreToolUse` hook regex and `buildClaudeArgv`'s tool composition can never drift apart from the server's own registration.

### PreToolUse hook extension, not dynamic MCP tool registration
**Source:** `packages/sidecar/src/claude-code-adapter.ts::writeHookSettings` lines 138-158
**Apply to:** the D-88 stage gate — add a second `PreToolUse` matcher entry; RESEARCH.md confirms dynamic MCP tool-list mutation is broken against the installed CLI (issue #77314) and must not be attempted (see Pitfall 1 in RESEARCH.md).

## No Analog Found

None — RESEARCH.md's own conclusion ("Everything else... is a direct extension of patterns already shipped and load-bearing-tested in Phases 1-4. No new external package is required") holds after this mapping pass; every file this phase touches has an exact or role-match analog above.

The two genuinely novel mechanisms in this phase — the conversation-transport process lifetime (Option A `--input-format stream-json` vs. Option B sequential one-shot `-p` turns) and the exact wire shape of a stage-transition signal — have **no in-codebase analog because they are the phase's own required spike** (RESEARCH.md Pattern 2, Open Question 1). Do not force an analog onto `startAuthoringSession`; its shape is spike-dependent and must be decided before the plan commits to file-level detail for that function.

## Metadata

**Analog search scope:** `packages/core/src/{db/migrations,domain,query}`, `packages/sidecar/src/`, `packages/desktop/src/{board,session,item-detail}`
**Files scanned:** 12 read directly (full or targeted ranges) + `packages/core/src/domain/epic.rs`/`acceptance_criterion.rs` grepped for structure
**Pattern extraction date:** 2026-09-23
