# Phase 10: Fleet Supervision Across Every Project - Pattern Map

**Mapped:** 2026-10-12
**Files analyzed:** 27 new/modified
**Analogs found:** 26 / 27 (all analog paths verified git-tracked)

**Scope guards (read first):**
- D-181: stay on `tauri = "=2.11.5"` and `tauri-plugin-notification =2.4.0`. RESEARCH.md Finding 4/4b, Open Question 0, Pattern 3's "Click routing" and the `on_action` / `fleet:navigate` code example are SUPERSEDED. Map no click-through. A single banner and a coalesced banner differ only in text; neither navigates.
- D-175: the window never gets a `notification:*` grant. Do not add `@tauri-apps/plugin-notification`.
- Closing gaps from RESEARCH Findings 1, 1b, 2, 3, 7, 9, 10, 13, 14 are binding on the plans; this file only supplies the copy-from code.
- Never `format!` SQL in `packages/core/src/query/` (grep-gated); literal `&str` constants bound via `params![]`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/query/fleet.rs` (new) | query/read | request-response, cross-project | `packages/core/src/query/permissions.rs` + `recovery.rs` | exact |
| `packages/core/src/query/fleet.rs` (inventory half, `*_inputs`/`finish_*`) | query/read | two-phase git read | `packages/core/src/query/change_flags.rs` | exact |
| `packages/core/src/query/mod.rs` | config (module list) | n/a | itself | exact |
| `packages/core/src/db/migrations/0020_fleet.sql` (new) | migration | transform/backfill | `0007_destructive_gate.sql` (ADD COLUMN), `0019_fan_out.sql` (header, index) | role-match |
| `packages/core/src/session_log.rs` (+`read_tail`) | utility | file-I/O | same file `count_lines`/`read_window` | exact |
| `packages/core/src/domain/agent_run.rs` (+`acknowledge_run`) | service | CRUD | the inline SQL in `commands/agent_run.rs:1956` | exact |
| `packages/core/src/domain/worktree.rs` (+`reclaim_eligibility`, `reclaim_worktrees`, size walk) | service | batch | same file `remove_worktree_for_task` | exact |
| `packages/core/src/domain/settings.rs` (+`notifications_enabled`) | service | CRUD | same file `dispatch_max_parallel` | exact |
| `packages/core/src/proc.rs` (try_wait before kill) | utility | event | itself | exact |
| `packages/desktop/src-tauri/src/commands/fleet.rs` (new) | controller | request-response | `commands/change_flags.rs` | exact |
| `packages/desktop/src-tauri/src/commands/settings.rs` (+setter) | controller | CRUD | `settings_set_dispatch_max_parallel` | exact |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` (acknowledge widened, notify hooks) | controller | event-driven | `handle_inbound_permission_request` / `handle_inbound_session_closed` | exact |
| `packages/desktop/src-tauri/src/notify.rs` (new) | service | event-driven | `scheduler.rs` (pure fn + thin shell) | role-match |
| `packages/desktop/src-tauri/src/state.rs` (+`watched_run`) | model | in-memory | `focused_task` field + `git_truth_focus_task` | exact |
| `packages/desktop/src-tauri/src/main.rs`, `menu.rs`, `capabilities/default.json` | config | n/a | existing `open-settings` wiring | exact |
| `packages/desktop/src-tauri/src/scheduler.rs` (forge memoise) | service | batch | itself `forge_tick_targets` | exact |
| `packages/sidecar/src/claude-code-adapter.ts` (text+tool_use) | transform | streaming | `normaliseStreamEvent` | exact |
| `packages/desktop/src/legend/runStatus.ts` (new, extracted) | utility | transform | `item-detail/RunsSection.tsx:49-91`, `session/SessionSurface.tsx:59-92` | exact |
| `packages/desktop/src/legend/marks.ts` (+inventory chips) | config | n/a | `worktree-missing` entry | exact |
| `packages/desktop/src/fleet/FleetSurface.tsx` (new) | component | request-response | `triage/TriageSurface.tsx` | role-match |
| `packages/desktop/src/fleet/BlockedQueue.tsx` (new) | component | request-response | `session/PermissionRequestCard.tsx` | exact |
| `packages/desktop/src/fleet/WorktreeInventory.tsx` (new) | component | batch | `triage/TriageSurface.tsx` + `RunsSection.tsx` | partial |
| `packages/desktop/src/fleet/useFleet.ts` (new) | hook | pub-sub | `useBlockedSummary` in `board/useBoardQuery.ts:662-700` | exact |
| `packages/desktop/src/state/uiStore.ts`, `keyboard.ts`, `App.tsx`, `projects/ProjectRail.tsx`, `adapters/tauri.ts` | store/wiring | n/a | existing `reviewSurface` / `open-settings` / `rail-fleet` | exact |
| `packages/core/tests/fleet_query.rs`, `worktree_inventory.rs`, `worktree_reclaim.rs`, `fleet_perf.rs` (new) | test | n/a | `packages/core/tests/recovery_summary.rs` | exact |
| `packages/desktop/src/fleet/__tests__/*.test.tsx` (new) | test | n/a | `triage/__tests__/triage-surface.test.tsx`, `projects/__tests__/project-rail.test.tsx` | role-match |

## Pattern Assignments

### `packages/core/src/query/fleet.rs` - fleet rows + blocked queue (query, cross-project read)

**Analog:** `packages/core/src/query/permissions.rs` (lines 25-70) and `recovery.rs` (lines 80-100).

**Module header + imports** (permissions.rs lines 1-26): doc comment states "every statement below is a single literal `&str`, bound through `params![]`, never assembled by `format!`".
```rust
use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
```

**Literal-SQL constant + thin fn** (permissions.rs 28-60):
```rust
const BLOCKED_TASK_IDS_SQL: &str = "SELECT ar.task_id FROM agent_runs ar \
    WHERE ar.project_id = ?1 AND ar.status = 'blocked' \
    AND ar.started_at = (SELECT MAX(started_at) FROM agent_runs WHERE task_id = ar.task_id) \
    ORDER BY ar.task_id ASC";

pub fn blocked_task_ids_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(BLOCKED_TASK_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list blocked task ids for project")
}
```
Fleet differences: drop the `project_id = ?1` predicate (D-14, one DB), `LEFT JOIN tasks`/`epics` (Finding 10), `CASE ... 'awaiting_review'` (D-168), `LIMIT ?1` cap. See RESEARCH Pattern 1 for the draft SQL.

**"Latest run per task" idiom to copy for Finding 1b** (recovery.rs 80-94):
```rust
AND ar.id = ( SELECT ar2.id FROM agent_runs ar2 WHERE ar2.task_id = ar.task_id \
    ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1 )
```
and the unacknowledged-abandoned arm: `status = 'abandoned' AND acknowledged_at IS NULL`.

**Pending-request projection for the queue** (permissions.rs 62-90): reuse `PENDING_REQUESTS_FOR_RUN_SQL` shape (`status = 'pending'`, `ORDER BY created_at ASC, id ASC`) and its `PendingPermissionRequest` struct fields (`id, tool_name, input_payload, created_at, destructive_category`) rather than a second projection; the queue read is the same columns joined across runs, one entry per run (RESEARCH test row: "second pending on one run is one entry").

---

### `packages/core/src/query/fleet.rs` - worktree inventory (`worktree_inventory_inputs` / `finish_worktree_inventory`)

**Analog:** `packages/core/src/query/change_flags.rs` lines 1-50 (two-phase split).
```rust
/// The board half: ... Takes only a `&Connection` and spawns no process, so it is safe under the
/// database lock; hand the result to [`finish_change_flags`] once the lock is released.
pub fn change_flag_inputs(conn: &Connection, project_id: &str, limit: usize) -> anyhow::Result<Vec<ChangeFlagInput>> { ... }
pub fn finish_change_flags(inputs: Vec<ChangeFlagInput>) -> anyhow::Result<Vec<ChangeFlag>> { ... }
```
Inventory differences: no `project_id` arg; inputs carry `task_id, project_id, path, branch, base, size_bytes, size_measured_at, task_status, has_live_run, project_status`. `finish_*` calls `merge::is_integrated(conn?...)` - NOTE `is_integrated` takes a `&Connection` (merge.rs:442); resolve the recorded-event half in the inputs phase and only the `--is-ancestor` check in `finish_*`, or take a short re-lock. Dirty check goes through `domain::worktree::porcelain_entries` (worktree.rs:216), the only porcelain site. Do not offer `projects.status = 'unreachable'` rows for reclaim (RESEARCH Pitfall 9).

---

### `packages/core/src/db/migrations/0020_fleet.sql` (migration)

**Analog:** `0007_destructive_gate.sql` (plain `ALTER TABLE ... ADD COLUMN`, nullable, no default, header comment explains why not a rebuild) and `0019_fan_out.sql` (numbered-owner-decisions header; `idx_events_type_task` as the index precedent).
Contents per RESEARCH: `UPDATE agent_runs SET acknowledged_at = COALESCE(ended_at, started_at) WHERE status IN ('completed','failed','interrupted') AND acknowledged_at IS NULL;` (never `abandoned`), `ALTER TABLE worktrees ADD COLUMN size_bytes INTEGER; ... size_measured_at TEXT;`, one partial index for the fleet read. Append-only: highest existing is `0019`. `core/tests/migration_safety.rs` auto-covers it.

---

### `packages/core/src/session_log.rs` (+`read_tail`)

**Analog:** same file, `count_lines` (lines 139-160) and `read_window` (185-200). Copy: `session_log_path(agent_run_id)?`, `File::open` returning empty on missing file, `file_ends_with_newline` to drop a partial final line. Difference: `Seek` from EOF, bounded `max_bytes`, never call `count_lines` (full scan, Finding 2). Cap against `LOG_WINDOW_MAX_LIMIT` style constant.

---

### `packages/core/src/domain/agent_run.rs` (+`acknowledge_run`)

**Source of the statement** (`commands/agent_run.rs:1956`, to move into core):
```rust
conn.execute(
    "UPDATE agent_runs SET acknowledged_at = ?1 WHERE id = ?2 AND status = 'abandoned'",
    rusqlite::params![now, agent_run_id],
)
```
New clause: `AND status IN ('abandoned','completed','failed','interrupted')`. The command then calls the core fn; `core/tests/recovery_summary.rs:35-37` replaces its mirrored fixture SQL with the same fn (Finding 13). Update the capability description sentence ("guarded to the abandoned status") and the command's doc comment.

---

### `packages/core/src/domain/worktree.rs` (+`reclaim_eligibility`, `reclaim_worktrees`, size walk)

**Analog:** `remove_worktree_for_task` (worktree.rs:240) `pub fn remove_worktree_for_task(conn: &mut Connection, task_id: &str, actor_id: &str) -> anyhow::Result<()>`; its own `porcelain_entries` re-read is the final guard and must stay untouched. `reclaim_worktrees` loops it per id, returning a per-row `Result` (never `?` out of the loop, D-179). `reclaim_eligibility` is the single definition shared with the inventory read (task Done or integrated, no live run, clean). Size walk: stdlib `symlink_metadata` + `MetadataExt::blocks() * 512`, no symlink follow, bounded entries.

---

### `packages/core/src/domain/settings.rs` (+`notifications_enabled` / `set_notifications_enabled`)

**Analog:** `dispatch_max_parallel` / `set_dispatch_max_parallel` (settings.rs 105-145).
```rust
pub fn dispatch_max_parallel(conn: &Connection) -> anyhow::Result<u32> {
    let stored = read_setting(conn, SETTING_DISPATCH_MAX_PARALLEL)?;
    Ok(stored.and_then(|raw| raw.parse::<u32>().ok()).filter(...).unwrap_or(DEFAULT_...))
}
pub fn set_dispatch_max_parallel(conn: &mut Connection, actor_id: &str, value: u32) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    upsert_setting(&tx, SETTING_DISPATCH_MAX_PARALLEL, &value.to_string(), actor_id, &now)?;
    tx.commit().context("failed to commit set_dispatch_max_parallel transaction")?;
    Ok(())
}
```
Absent/unparseable must degrade to the default (enabled). No event, no new table.

---

### `packages/desktop/src-tauri/src/commands/fleet.rs` (controller, request-response)

**Analog:** `commands/change_flags.rs` (whole file, lines 1-70).

**Imports + DTO + From** (lines 12-35): `serde::Serialize`, `tauri::State`, `super::ipc_error`, `crate::state::AppState`; `#[serde(rename_all = "camelCase")]` DTOs with `impl From<flywheel_core::...>`.

**Server-side cap constant** (line 38): `const BOARD_CHANGE_FLAGS_CAP: usize = 200;` - mirror as `FLEET_ROWS_CAP`, `RECLAIM_BATCH_CAP` (~50).

**Lock-safe split** (lines 40-70):
```rust
#[tauri::command(async)]
pub async fn board_change_flags(state: State<'_, AppState>, project_id: String) -> Result<Vec<ChangeFlagDto>, String> {
    let inputs = {
        let conn = state.db.lock().map_err(|e| ipc_error("board_change_flags:lock", e))?;
        let inputs = flywheel_core::query::change_flags::change_flag_inputs(&conn, &project_id, CAP)
            .map_err(|e| ipc_error("board_change_flags:read", e));
        // Released explicitly: nothing below may run with the database mutex held.
        drop(conn);
        inputs?
    };
    let flags = tauri::async_runtime::spawn_blocking(move || {
        flywheel_core::query::change_flags::finish_change_flags(inputs)
    }).await.map_err(|e| ipc_error("board_change_flags:join", e))?
      .map_err(|e| ipc_error("board_change_flags:git", e))?;
    Ok(flags.into_iter().map(ChangeFlagDto::from).collect())
}
```
Use for `worktree_inventory`, `worktree_measure`, `worktree_reclaim` (RESEARCH "Server-side reclaim loop shape"). `fleet_list`/`fleet_blocked_queue` are pure-DB reads: use the sync `#[tauri::command]` + `state.db.lock().map_err(|e| e.to_string())?` shape from `settings_get`, but run `read_tail` after dropping the lock. Renderer passes no path/ref/sha/actor; resolve the actor via `flywheel_core::domain::actor::local_human_actor_id(&conn)`.

**`fleet_watch_run`** copies `git_truth_focus_task` (git_truth.rs 85-92) exactly:
```rust
#[tauri::command]
pub fn git_truth_focus_task(state: State<AppState>, task_id: Option<String>) -> Result<(), String> {
    let mut focused = state.focused_task.lock().map_err(|e| e.to_string())?;
    *focused = task_id;
    Ok(())
}
```
with `state.watched_run` (add next to `focused_task: Mutex<Option<String>>`, state.rs:31).

**Registration:** add every command to `generate_handler![...]` in `main.rs` (list at ~line 116; `commands::change_flags::board_change_flags` at line 231 is the neighbour) and to the prose roster in `capabilities/default.json` `description`. Add `pub mod fleet;` to `commands/mod.rs`.

---

### `packages/desktop/src-tauri/src/commands/settings.rs` (+`settings_set_notifications_enabled`)

**Analog:** `settings_set_dispatch_max_parallel` (lines 107-118):
```rust
let mut conn = state.db.lock().map_err(|e| e.to_string())?;
let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
flywheel_core::domain::settings::set_dispatch_max_parallel(&mut conn, &actor_id, value).map_err(|e| e.to_string())?;
read_dispatch_cap(&conn)
```
Also extend `SettingsDto` (line ~53) with `notifications_enabled: bool` and `settings_get`. Renderer side: `adapters/tauri.ts:808-811` shows the thin `invokeCommand<...>("settings_set_dispatch_max_parallel", { value })` wrapper; `settings/SettingsSurface.tsx:362` reads `settings.dispatchCap` - add one checkbox row beside it.

---

### `packages/desktop/src-tauri/src/commands/agent_run.rs` (notify hooks, widened acknowledge)

**Analog (hook sites):** `handle_inbound_permission_request` (lines 1308-1366) and `handle_inbound_session_closed` (1378-1402).

Permission site: notify only on the `running -> blocked` edge. Read the run's status BEFORE `process_inbound_permission_request` (it runs under `conn`, which is dropped right after), then in the `Pending` arm:
```rust
PermissionRequestOutcome::Pending { db_request_id } => {
    sidecar.register_pending_permission_request(&db_request_id, run_id, request_id);
    let _ = app.emit("board:changed", serde_json::json!({ "entity": "agent_run", "id": run_id }));
    // <- notify::push(app, Transition::Blocked{..}) here, only if prior status was 'running'
}
```
Session-closed site: after `drop(conn)`, in the `changed` branch, match `SessionClosedOutcome::Closed(status)` for `Completed`/`Failed` only (`Interrupted` and `BackfilledTerminal`/`AlreadyTerminal` never notify). Both fns "must never panic - no expect, no unwrap" (comment at 1370-1377): `notify::push` must be infallible-by-signature. Gather project name and task key via a short read before `drop(conn)`.

---

### `packages/desktop/src-tauri/src/notify.rs` (service, event-driven)

**Analog:** the pure-function-plus-thin-shell split in `scheduler.rs` (`forge_tick_targets` is a pure read returning data; the tick loop owns timing). No Tauri-notification analog exists in the repo (see No Analog). Shape from RESEARCH Pattern 3 with `now: Instant` injected so tests need no runtime: `Coalescer { window, pending }`, `push(t, now)`, `take_due(now) -> Option<Banner>`, `Banner::{Single{run_id,title,body}, Summary{count,projects,kind}}`. Pin the window constant in a unit test (CONTEXT discretion). Suppression decision is a pure fn `(enabled, window_focused, watched_run, run_id) -> bool` so `notify::` tests cover D-174. Banner body: tool name plus length-capped target only (Pitfall 4).

Emit call (2.4.0, no `.extra`/`on_action`, per D-181):
```rust
use tauri_plugin_notification::NotificationExt;
app.notification().builder().title(title).body(body).show()?;
```
Register with `.plugin(tauri_plugin_notification::init())` next to `.plugin(tauri_plugin_dialog::init())` / `.plugin(tauri_plugin_shell::init())` (main.rs lines 32-33). Cargo.toml: add `tauri-plugin-notification = "=2.4.0"` under `[dependencies]` (not after `[dev-dependencies]`; neighbours at Cargo.toml lines 19 and 30). A capability test reads `capabilities/default.json` and asserts no `notification:` string.

---

### `packages/desktop/src-tauri/src/scheduler.rs` (folded: forge memoisation)

**Analog:** itself, lines 330-372. Change `resolved: HashMap<String, (Forge, PathBuf)>` to store the `Result`/`Option` so the `Err` arm also inserts; log once per project per tick:
```rust
let mut resolved: HashMap<String, (Forge, std::path::PathBuf)> = HashMap::new();
...
match flywheel_core::forge::forge_and_repo_path(conn, &worktree.project_id) {
    Ok(pair) => { resolved.insert(worktree.project_id.clone(), pair.clone()); Some(pair) }
    Err(err) => { eprintln!(...); None }   // <- also memoise None here
}
```

---

### `packages/sidecar/src/claude-code-adapter.ts` (folded: text + tool_use)

**Analog:** `normaliseStreamEvent` (~lines 955-1021, exported, one-event contract tested in `test/adapter.test.mjs`). Leave it intact; add a sibling returning an ordered `AgentEvent[]` (narration before tool call) and have the call sites (~1540, ~1557, ~1586) allocate `session.nextSeq++` per element. Extend `test/adapter.test.mjs`.

---

### `packages/desktop/src/legend/runStatus.ts` (utility, extracted vocabulary - Finding 14)

**Analogs:** `item-detail/RunsSection.tsx:49-91` (has `abandoned`) and `session/SessionSurface.tsx:59-92` (lacks it; `export type RunStatus = "running" | "blocked" | "completed" | "failed" | "interrupted";` at line 59). Extract the six-state type, label map, mark-id map, colour roles, `formatElapsed`, `formatCostUsd`, `formatCount` (file-local in SessionSurface today) and import from all three. Fleet adds `awaiting_review -> status-in-review` (marks.ts:114, glyph `CircleEllipsis`, D-170). Update the `vi.mock("../../adapters/tauri")` export lists in existing tests only if new adapter functions are imported.

### `packages/desktop/src/legend/marks.ts`

**Analog:** `worktree-missing` entry (marks.ts ~414-419), channel `"agent"` (closed `MarkChannel` union, reuse it):
```ts
{ id: "worktree-missing", channel: "agent", glyph: "TriangleAlert", label: "Missing",
  meaning: "The worktree Flywheel recorded for this task is not on disk." },
```
Add inventory chips (reclaimable, in use, keep) the same way. Every mark is glyph + word, never colour alone.

---

### `packages/desktop/src/fleet/FleetSurface.tsx` (component, surface)

**Analog:** `triage/TriageSurface.tsx` (props `{ onClose, onOpenSession(agentRunId, epicId, logOffset) }`), mounted in `App.tsx`. Tests live at `triage/__tests__/triage-surface.test.tsx`. Row activity cell: `buildFeedRows(entries)` (exported, `SessionSurface.tsx:555`) then `toolCallTarget(input)` (`FeedRow.tsx:26`); take the last row only. Elapsed: local `setInterval` from `started_at`, no IPC (D-171). Spend: blank (not `$0.00`) while running; footer total comes from SQL, label as an estimate (Finding 11).

### `packages/desktop/src/fleet/BlockedQueue.tsx` (component)

**Analog:** `session/PermissionRequestCard.tsx`. The card today (lines 391-410):
```tsx
export function PermissionRequestCard({ variant, requests, onAnswer }: PermissionRequestCardProps) {
  ...
  {requests.map((request, index) => (
    <PermissionRequestRow key={request.id} request={request} variant={variant}
      keyboardEnabled={index === 0} onAnswer={onAnswer} />
  ))}
```
and each enabled row registers a window listener (lines 246-254, via `useRegionBindings("permission-card","permission-card",{...})`, keyboard.ts:783-803, no dedup). **Required edit (Finding 3):** add optional prop `keyboardEnabled?: boolean` (default `true`-equivalent, preserving `index === 0` for the two existing mounts) and have the queue enable exactly one card at a time. Test: one `a` keypress over three queued cards issues exactly one `agent_run_answer_permission`. Keep the no-Escape rule; no local dismiss handler.

### `packages/desktop/src/fleet/useFleet.ts` (hook)

**Analog:** `useBlockedSummary` (`board/useBoardQuery.ts:662-700`):
```ts
export function blockedSummaryQueryKey(projectId: string | undefined) { return ["blocked-summary", projectId] as const; }
...
useEffect(() => {
  let unlisten: (() => void) | undefined; let cancelled = false;
  subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey: key }))
    .then((fn) => { if (cancelled) fn(); else unlisten = fn; });
  return () => { cancelled = true; unlisten?.(); };
}, [queryClient]);
```
Drop the `projectId` gate (app-wide). The extra throttled single `agent:event` listener (Finding 2 / Open Question 1) follows the identical subscribe/cleanup shape.

### `uiStore.ts`, `keyboard.ts`, `App.tsx`, `ProjectRail.tsx`, `adapters/tauri.ts` (wiring)

- **uiStore** (`state/uiStore.ts`): field + setter + reset triple, as `reviewSurface` at lines 225 / 275 / 303 / 389 / 423. Add `fleetSurface`, `worktreeInventoryOpen`, one-shot `pendingFocusItemId` (Finding 9).
- **App.tsx precedence chain** (lines ~140-210 of the render): `settingsOpen ? ... : triageSurfaceProjectId ? ... : reviewSurface ? ... : activeAgentRunId ? <SessionSurface agentRunId taskId authoringStage epicId initialFeedOffset onBack={() => setActiveAgentRunId(null)} /> : project.status === "unreachable" ? ...`. Insert fleet/inventory branch BELOW `activeAgentRunId` (RESEARCH Pattern 4) so a session opened from the fleet pops back to it. Open a session with `setActiveAgentRunId(agentRunId, taskId, authoringStage, epicId, logOffset)`, passing all of them (Finding 10). Heavy views may use the `React.lazy` + `Suspense` form used for `ReviewSurface` (App.tsx 28-31).
- **keyboard** (four-file mirror, from `open-settings`): `state/keyboard.ts` lines 83 (ActionId), 231 (`{ id: "open-settings", region: "global", key: ",", meta: true, label: ... }`), 435 (`MENU_ACTION_IDS`); `src-tauri/src/main.rs:28` (`FORWARDED_MENU_ACTIONS`); `src-tauri/src/state.rs:72` (`MenuHandles`); `src-tauri/src/menu.rs:40` (`MenuItemBuilder::with_id("open-settings", "Settings…")`). Add region/layer `fleet-surface` as `triage-surface` was added. Uniqueness test catches a clashing accelerator.
- **ProjectRail** (`projects/ProjectRail.tsx`): `<Section id="rail-fleet" label="Fleet">` (line 235) and `id="rail-review-queue"` (line 261) rows are `<div className="type-body" style={rowStyle}>`; turn into `<button>` using the existing `entryStyle` (as the Register button at ~225). Counts become fleet-wide from the same hooks as the fleet read. The header doc comment (lines 14-18, "READ-ONLY FACTS, not links") must be rewritten. `projects/__tests__/project-rail.test.tsx:104-106` fails if the lowercase word "proposal" appears anywhere in `ProjectRail.tsx`; keep it out of added comments.
- **adapters/tauri.ts**: thin wrappers like line 1281 `return invokeCommand<ChangeFlagDto[]>("board_change_flags", { projectId });`. This is the only place `invoke` is called (web-reuse seam).

---

### Core tests (`fleet_query.rs`, `worktree_inventory.rs`, `worktree_reclaim.rs`, `fleet_perf.rs`)

**Analog:** `packages/core/tests/recovery_summary.rs`. Copy:
```rust
fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}
...
let (conn, _actor_id, project, _repo_dir) = common::seeded_git_project();
```
Replace its local `acknowledge_run` fixture (lines 35-43) with the core fn. Add a 500-historic-run first-launch-flood fixture and a run inserted between inventory read and reclaim (Finding 7).

---

## Shared Patterns

### Cross-project reads are plain SQL (D-14)
**Source:** `query/permissions.rs`, `query/recovery.rs`. **Apply to:** every function in `query/fleet.rs`. Derive, do not store (D-168, D-178): no `fleet_state` column, no writer for `worktrees.status = 'stale'`.

### DB mutex discipline
**Source:** `commands/change_flags.rs` lines 40-70 and the `scheduler.rs` header (lines 19-27). **Apply to:** `fleet_list` (tail read after drop), inventory, measure, reclaim, notify gather. Never walk the filesystem or spawn git under `state.db`.

### Command hygiene
**Source:** `commands/change_flags.rs` (server-side cap const, `ipc_error` tags `"name:lock|read|join|git"`), `commands/settings.rs` (`local_human_actor_id` resolved server-side). **Apply to:** all new commands; renderer passes ids only.

### Invalidation via `board:changed`
**Source:** `app.emit("board:changed", serde_json::json!({ "entity": "agent_run", "id": run_id }))` at agent_run.rs ~1360 and ~1397. **Apply to:** `worktree_reclaim` (emit once at end), `worktree_measure`, widened acknowledge.

### Panic-free event handlers
**Source:** `handle_inbound_session_closed` doc (agent_run.rs 1369-1377). **Apply to:** all notify hooks.

### Capability roster
**Source:** `capabilities/default.json` `description` prose + `generate_handler!` in `main.rs`. **Apply to:** each new command; update `agent_run_acknowledge`'s sentence; add no `notification:*`.

### Never colour alone
**Source:** `legend/marks.ts` ("no mark may exist that the legend does not define"). **Apply to:** all fleet states and inventory chips.

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| `notify.rs` OS banner call (`tauri-plugin-notification`) | service | event-driven | No notification code exists; third plugin ever added. Use the 2.4.0 builder shown above and the pure-coalescer shape from RESEARCH Pattern 3 (minus every `on_action`/`extra` part). |
| Recursive allocated-size walk (`worktree_size`) | utility | file-I/O | No directory-walk utility in core; ~20 lines of stdlib per RESEARCH Standard Stack. |
| `WorktreeInventory.tsx` multi-select + result list | component | batch | No multi-select-with-confirm component exists; compose from `TriageSurface` shell and `RunsSection` row layout, confirmation names total bytes. |
| `read_tail` (seek-from-EOF) | utility | file-I/O | Partial analog only (`session_log::read_window` is forward and counts all lines). |

## Metadata

**Analog search scope:** `packages/core/src/{query,domain,db/migrations}`, `packages/core/tests`, `packages/desktop/src-tauri/src`, `packages/desktop/src/{App.tsx,projects,session,legend,board,state,settings,triage}`
**Files scanned:** ~35 (targeted reads; large files via grep + line ranges)
**Pattern extraction date:** 2026-10-12
