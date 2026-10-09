# Phase 9: Planned Fan-Out That Does Not Collide - Pattern Map

**Mapped:** 2026-10-09
**Files analyzed:** 22 (new/modified)
**Analogs found:** 21 / 22
All analog paths below were confirmed git-tracked (`git ls-files`) or are under tracked `packages/`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/file_set.rs` (new) | utility (pure predicate) | transform | `packages/core/src/merge.rs` (plain values in/out) + `branch.rs` | role-match |
| `packages/core/src/dispatch.rs` (new) | service (decide -> actions) | batch/event-driven | `packages/core/src/merge.rs` `plan_merge_inputs`/`finish_plan` split | role-match |
| `packages/core/src/domain/dispatch_plan.rs` (new) | model/CRUD | CRUD (`*_in_tx`) | `packages/core/src/domain/settings.rs` + `domain/task.rs` | role-match |
| `packages/core/src/domain/settings.rs` (edit: `dispatch_max_parallel`, gate row) | config | CRUD | itself, `global_credential_mode` (lines 23-100) | exact |
| `packages/core/src/runtime_protocol.rs` (edit: scope marker) | utility (file protocol) | file-I/O | itself, `write_authoring_stage` / `read_authoring_stage` (317-365) | exact |
| `packages/core/src/db/migrations/0019_fan_out.sql` + `db/mod.rs` registration | migration | CRUD | `0018_criterion_anchors.sql`; `db/mod.rs:39` | exact |
| `packages/core/src/context_packet.rs` (edit: scope + commit instruction) | service | transform | itself (`render_prompt`) | exact |
| `packages/shim/src/main.rs` (edit: `--scope-check`) | utility (CLI) | request-response | existing shim classifier mode used by `pretooluse-hook.ts` | role-match |
| `packages/sidecar/src/scope-hook.ts` (new) | middleware (hook) | request-response | `packages/sidecar/src/stage-gate-hook.ts` | exact |
| `packages/sidecar/src/claude-code-adapter.ts` (edit) | service | streaming | itself, `writeHookSettings` (197-242) | exact |
| `packages/sidecar/src/mcp-permission-server.ts` (edit: `submit_plan`, notice kind) | service | request-response (held call) | itself, `propose_item` path | exact |
| `packages/sidecar/src/adapter.ts` (edit: events) | model (types) | event-driven | itself, `rate_limit` event (~line 360-371) | exact |
| `packages/desktop/src-tauri/src/dispatch.rs` (new commands) | controller | request-response | `commands/agent_run.rs`, `commands/authoring.rs` | role-match |
| `packages/desktop/src-tauri/src/scheduler.rs` (edit: 5th job) | scheduler | event-driven (tick) | itself, `start_git_truth_scheduler` (511-545) | exact |
| `packages/desktop/src-tauri/src/sidecar.rs` (edit: 2 inbound branches) | controller | event-driven | itself, reader chain ~1644-1721 | exact |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` (edit: extract launch body) | controller | request-response | itself, `start_agent_run_recording_first` (533) | exact |
| `packages/desktop/src/session/FeedRow.tsx` (edit: scope row + Widen) | component | event-driven | itself + `PermissionRequestCard.tsx` | exact |
| `packages/desktop/src/board/BoardRow.tsx` (edit: badge) | component | request-response | itself (estimate badge / criteria badge) | exact |
| `packages/desktop/src/dispatch/WavePlanSheet.tsx` (new) | component | CRUD | `packages/desktop/src/launch-sheet/LaunchSheet.tsx` | role-match |
| `packages/desktop/src/board/EpicHeaderRow.tsx` (edit: dispatch entry) | component | request-response | itself | exact |
| `packages/desktop/src/settings/SettingsSurface.tsx` (edit: cap control) | component | CRUD | itself, credential-mode control | exact |
| tests (`core/tests/*`, `sidecar/test/*`) | test | - | `sidecar/test/destructive-gate.test.mjs`, `sidecar/test/execution-hook-settings.test.mjs`, `core/tests/authoring_stage_marker_contract.rs`, `core/tests/git_retry.rs` | role-match |

## Pattern Assignments

### `packages/sidecar/src/scope-hook.ts` (middleware, request-response)

**Analog:** `packages/sidecar/src/stage-gate-hook.ts`

**Imports + decision constant** (lines 28-33):
```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
const WIRED_DECISION = "deny" as const;
```

**Fail-closed + deny shape** (lines 35-50), copy verbatim, reason prefixed `FLYWHEEL-SCOPE:`:
```typescript
function failClosed(reason: string): never {
  printDecision({ hookSpecificOutput: { hookEventName: "PreToolUse",
    permissionDecision: WIRED_DECISION, permissionDecisionReason: `...${reason}...` } });
  process.exit(2);
}
```

**Stdin drain + identity from OWN env, marker read fresh** (lines 68-101):
```typescript
await readStdin();            // here ALSO parse payload, but only for tool_input path
const runId = process.env.FLYWHEEL_RUN_ID;
const runtimeDir = process.env.FLYWHEEL_RUNTIME_DIR;
raw = readFileSync(join(runtimeDir, "stage", `${runId}.json`), "utf8");   // -> "scope"
```

**Deviations the planner must apply (RESEARCH M2):** `stage-gate-hook.ts` line 122 is a bare `main();` with no catch, so a throw exits 1 and the tool call PROCEEDS (fails open, measured). Scope hook must wrap all of `main` in try/catch plus `process.on("uncaughtException"|"unhandledRejection")` that prints deny and `exit(2)`. Marker semantics: `mode: "unarmed"` -> print `{}` exit 0; `armed` -> shim `--scope-check`; absent/malformed/unknown version -> deny. Target path: `tool_input.file_path` (Write/Edit/MultiEdit) or `notebook_path` (NotebookEdit); matched tool with neither -> deny.

---

### `packages/sidecar/src/claude-code-adapter.ts` (edit `writeHookSettings`)

**Analog:** itself, lines 163-242.
```typescript
export const AUTHORING_STAGE_GATE_MATCHER = `mcp__${MCP_SERVER_NAME}__(propose|amend|delete)_.*`;
export function writeHookSettings(runtimeDir, runId, includeAuthoringStageGate: boolean) {
  const preToolUse = [ { matcher: "Bash", hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }] } ];
  if (includeAuthoringStageGate) {
    preToolUse.push({ matcher: AUTHORING_STAGE_GATE_MATCHER,
      hooks: [{ type: "command", command: `${process.execPath} ${stageGateHookScriptPath()}` }] });
  }
```
Add a third `includeScopeGate` boolean (default false so `execution-hook-settings.test.mjs` and the two existing entries stay byte-identical), pushing `{ matcher: "Write|Edit|MultiEdit|NotebookEdit", ... scopeHookScriptPath() }`. Do not set a `timeout` field (timed-out hook does not block). Build the matcher from one exported constant, per single-list discipline.

---

### `packages/core/src/runtime_protocol.rs` (edit: scope marker)

**Analog:** itself.

**Marker struct** (lines 117-121): snake_case, plain serde, read by a separate Node process by convention.
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuthoringStageMarker { pub stage: String, pub written_at: String }
```

**Writer** (lines 317-345): ULID gate first, `runtime_dir()`, serialize, `atomic_write` (private, line 184, so `write_scope_marker` must live in this module):
```rust
if !crate::ids::is_ulid(run_id) { return RuntimeIo::WriteFailed("...".to_string()); }
let path = stage_dir(&dir).join(format!("{run_id}.json"));
match atomic_write(&path, &body) { Ok(()) => RuntimeIo::Written, Err(err) => RuntimeIo::WriteFailed(format!("{err}")) }
```
**Reader** (352-361): every failure collapses to `None` (no way to treat "malformed" as safe). Also extend `clear_run_runtime_files` (line 435) to remove `scope/<runId>.json`. A marker-write failure must abort the run start (see `start_authoring_run` lesson, RESEARCH Pattern 3).

---

### `packages/core/src/domain/settings.rs` (edit: cap + gate)

**Analog:** itself, lines 23-100.
```rust
const SETTING_GLOBAL_CREDENTIAL_MODE: &str = "global_credential_mode";
pub(crate) fn upsert_setting(tx: &Transaction, key: &str, value: &str, actor_id: &str, now: &str) -> anyhow::Result<()>
pub(crate) fn read_setting(conn: &Connection, key: &str) -> anyhow::Result<Option<String>>
pub fn global_credential_mode(conn: &Connection) -> anyhow::Result<String> {
    Ok(read_setting(conn, SETTING_GLOBAL_CREDENTIAL_MODE)?.unwrap_or_else(|| DEFAULT_GLOBAL_CREDENTIAL_MODE.to_string())) }
pub fn set_global_credential_mode(conn: &mut Connection, actor_id: &str, mode: &str) -> anyhow::Result<()> {
    if mode != "local" && mode != "api_key" { return Err(anyhow::anyhow!(...)); }   // validate defensively, no CHECK on settings.value
    let tx = conn.transaction()?; upsert_setting(&tx, KEY, mode, actor_id, &now)?; tx.commit()...
```
New: `dispatch_max_parallel` (default 3, validated 1-8, parse as integer), plus `dispatch_gate` row (write only on state change). Global setting writes no `events` row (`events.project_id` NOT NULL).

---

### `packages/core/src/db/migrations/0019_fan_out.sql` (migration)

**Analog:** `0018_criterion_anchors.sql` — header comment listing owner decisions; CHECK constraints (not app code) own vocabularies; FK `ON DELETE CASCADE`; `created_by TEXT NOT NULL REFERENCES actors(id)`:
```sql
CREATE TABLE criterion_anchors (
    criterion_id TEXT PRIMARY KEY NOT NULL REFERENCES acceptance_criteria(id) ON DELETE CASCADE,
    side TEXT NOT NULL DEFAULT 'new' CHECK (side IN ('old', 'new')),
    created_by TEXT NOT NULL REFERENCES actors(id), created_at TEXT NOT NULL );
```
Register next to `include_str!("migrations/0018_criterion_anchors.sql")` at `packages/core/src/db/mod.rs:39`. `task_file_set_entries.form CHECK (form IN ('file','dir'))` must match `FILE_SET_FORMS` const. Add index for per-task scope-event count (`events` by type/task).

---

### `packages/core/src/file_set.rs` (utility, transform)

**Analog:** `packages/core/src/merge.rs` convention only: "git-running/plain-value half takes plain values, never a connection." No existing predicate to copy; use RESEARCH Pattern 1 (reject-never-repair `parse_entry`, `covers`, `overlaps`, `collisions`, `FILE_SET_FORMS`). Single-list discipline precedent: `AUTHORING_STAGES`, `ISSUE_KINDS`, `WORKFLOW_STATES` (one Rust const + one migration CHECK).

---

### `packages/core/src/dispatch.rs` + auto-merge (service, batch)

**Analog:** `packages/core/src/merge.rs` public halves (lines 140, 203, 251, 277, 310, 383):
`plan_merge_inputs(conn, task_id)` (DB half) -> `finish_plan(inputs)` (git dry run, no conn) -> `try_lock_epic(epic_id)` guard -> `run_merge(&plan)` (runs in the EPIC worktree) -> `record_merge_event(conn, &plan, &outcome, actor_id)`.

**Event-append idiom** (merge.rs 340-360), reuse for `task.sequenced`, `task.scope_denied`, `task.file_set_*`:
```rust
let tx = conn.transaction()?;
let sequence = next_sequence(&tx, &plan.project_id, "local")?;
crate::domain::event::append_event(&tx, &plan.project_id, "local", sequence, "task", &plan.task_id,
    Some(&plan.task_id), Some(&plan.epic_id), actor_id, event_type, &payload, &now)?;
tx.commit().context("...")?;
```
`decide(conn, now) -> Vec<Action>` is DB-only; the Tauri crate executes actions (spawn, merge) holding no lock across subprocess or `SpawnFloor::wait_turn`. Dispatcher never writes `tasks.status` (merge.rs: one owner per transition). Spawns go through `SidecarHandle::send_spawn_request` only (source gates in `core/tests/git_retry.rs`, `tests/spawn_stagger.rs`; extend them to the dispatcher file).

---

### `packages/desktop/src-tauri/src/scheduler.rs` (edit: dispatcher tick)

**Analog:** itself, lines 511-545.
```rust
let forge_app = app.clone();
let forge_job = Job::new_repeated_async(Duration::from_secs(FORGE_POLL_SECS), move |_uuid, _lock| {
    let app = forge_app.clone();
    Box::pin(async move { run_forge_tick(&app) })
})?;
sched.add(forge_job).await?;
```
Add a fifth job (about 5 s). Make it single-flight (guard flag) and run the body on `spawn_blocking` since spawns sleep in `SpawnFloor`. Update the "four jobs" doc comment. Tick-body convention: DB read under lock, release, then act (see `fetch_tick_targets` / `poll_forge_targets` / `apply_forge_results` split, lines 242-460).

---

### `packages/desktop/src-tauri/src/sidecar.rs` (edit: inbound `rate_limit`, `scope_denied`)

**Analog:** reader chain lines ~1644-1721 and `handle_inbound_git_lock_exhausted` (line 891): each event type routes to a `handle_inbound_*(app, &event)` that logs on failure, never panics. Add two branches; also nudge dispatcher from the `session_closed` branch (1660, `handle_inbound_session_closed`). Pair each handler with a DB-only `process_inbound_*` function for testing (agent_run.rs module doc lines 15-23 describes the split).

---

### `packages/desktop/src-tauri/src/commands/agent_run.rs`

**Analog:** itself — `start_agent_run_recording_first` (line 533) is where `arm_run_scope(conn, run_id, task_id)` goes (writes the marker `armed` or `unarmed`, aborts start on failure). Extract the launch body so the dispatcher and `agent_run_start` (line 628) share it; D-150 requires `agent_run_start` unchanged for a task with no file-set. Human-only commands (approve plan, widen) follow the `advance_stage` rule: no agent-reachable caller.

---

### `packages/sidecar/src/mcp-permission-server.ts` + `adapter.ts` (submit_plan, events)

**Analog:** the `propose_item` held request-and-answer path in the same server; `rate_limit` event type in `adapter.ts` (~360-371). Add `ScopeDeniedEvent`, `PlanSubmittedEvent` beside it. Warning from RESEARCH: the server lists every tool to every run, so authority is checked Rust-side (planning-run status, epic key membership). Include a fake-claude test through the real socket (plan 06-09 hang lesson).

---

### `packages/desktop/src/session/FeedRow.tsx` (+ `PermissionRequestCard.tsx`)

**Analog:** `FeedRow.tsx` `FeedRowData` discriminated union (line ~38: `| { kind: "assistant_text"; key: string; text: string }`). Add `{ kind: "scope_denied"; key; path; ... }`; presentational only, no avatar/icon import; `toolCallTarget` shows the existing `file_path` target idiom (lines 24-34). Widen action modelled on the action in `PermissionRequestCard.tsx`. Renderer never computes a verdict; Widen result (collision refusal) comes from a Rust DTO.

### `packages/desktop/src/board/BoardRow.tsx`
**Analog:** itself — fixed left-to-right field order with container-query progressive disclosure in `App.css`; the criteria checked/total badge and estimate badge are the models for a scope-count badge (hidden when zero, no placeholder).

### `packages/desktop/src/dispatch/WavePlanSheet.tsx`
**Analog:** `packages/desktop/src/launch-sheet/LaunchSheet.tsx` (epic-level sibling per CONTEXT). Data via TanStack Query over Tauri commands through the single adapter module.

## Shared Patterns

### Fail closed, named cause
**Source:** `stage-gate-hook.ts` `failClosed` (35-50), `docs/destructive-gate-trust-boundary.md` Layer 1. **Apply to:** scope hook, `submit_plan` validation, marker reads. Unestablishable precondition never reads as permissive; absence is never "disarmed" (explicit `mode: "unarmed"`).

### One-transaction projection + event
**Source:** `merge.rs::record_merge_event` (340-360). **Apply to:** file-set declare/edit/widen, plan approval (`dispatch_edges` + `task.sequenced` events in one tx), scope events, gate changes.

### Identity from own environment, never payload
**Source:** `stage-gate-hook.ts` 86-94. **Apply to:** scope hook; `runId` in scope notice comes from the sidecar session closure.

### ULID gate before building any path
**Source:** `runtime_protocol.rs::write_authoring_stage` (`crate::ids::is_ulid`). **Apply to:** `write_scope_marker`, `read_scope_marker`.

### Global setting storage
**Source:** `domain/settings.rs` upsert/read helpers. **Apply to:** cap, gate state.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| Detective backstop at session close (porcelain + committed paths vs declared set) | service | batch | Closest: Phase 7 `task.outside_commit_detected` in `core/src/drift.rs` (not fully read); compose with `git::review_files` and `domain::worktree::porcelain_entries` per RESEARCH Pattern 4 |
| Rate-limit gate state machine (Rust consumer) | service | event-driven | Wire parse exists; no Rust consumer exists. Use RESEARCH Pattern 7 |
| `file_set.rs` overlap algebra | utility | transform | New logic; spec in RESEARCH Pattern 1 |

## Metadata

**Analog search scope:** `packages/{core,sidecar,desktop,shim}` src, core migrations
**Not fully read (planner should open before editing):** `packages/sidecar/src/pretooluse-hook.ts` (shim shelling), `mcp-permission-server.ts` (`propose_item`), `commands/agent_run.rs:533-700`, `PermissionRequestCard.tsx`, `LaunchSheet.tsx`, `drift.rs`, `shim/src/main.rs`. RESEARCH.md lines 496-851 (pitfalls, validation architecture) were not read by this mapper.
**Pattern extraction date:** 2026-10-09
