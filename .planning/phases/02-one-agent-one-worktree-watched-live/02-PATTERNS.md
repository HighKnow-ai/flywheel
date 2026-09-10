# Phase 2: One Agent, One Worktree, Watched Live - Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 26 (new/modified, derived from CONTEXT.md + RESEARCH.md + UI-SPEC.md)
**Analogs found:** 21 / 26 (5 genuinely new-to-this-repo surfaces have no analog — see "No Analog Found")

All analog paths below were confirmed git-tracked (`git ls-files`) before inclusion; none is a
`.gsd/` or other gitignored mirror.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/db/migrations/0003_agent_runtime.sql` | migration | batch/schema | `packages/core/src/db/migrations/0002_board_schema.sql` | exact |
| `packages/core/src/domain/worktree.rs` | model (domain) | CRUD + event-append | `packages/core/src/domain/task.rs` | exact |
| `packages/core/src/domain/agent_run.rs` | model (domain) | CRUD + event-append | `packages/core/src/domain/task.rs` | exact |
| `packages/core/src/domain/trigger.rs` | model (domain) | CRUD + event-append | `packages/core/src/domain/task.rs` (its `create_task` shape) + `epic.rs`'s `integration_branch` writer for D-25 | exact |
| `packages/core/src/domain/permission_request.rs` | model (domain) | CRUD + event-append | `packages/core/src/domain/acceptance_criterion.rs` (a child-of-parent row with a status-toggle mutation) | role-match |
| `packages/core/src/domain/permission_rule.rs` | model (domain) | CRUD | `packages/core/src/domain/acceptance_criterion.rs` | role-match |
| `packages/core/src/query/agent_runs.rs` (windowed session-log/run reads) | service (query) | streaming/windowed-read | `packages/core/src/query/events.rs` | exact |
| `packages/core/src/git.rs` (`git_at` explicit-path wrapper, worktree add/reuse) | utility | file-I/O / shell-out | none in-repo yet — closest precedent is the "explicit path, no implicit cwd" discipline already followed throughout `packages/core/src/domain/*` (e.g. every fn takes `project_id`/`repo_path` explicitly, never reads an ambient cwd) | role-match (discipline-match, no literal git-wrapper analog) |
| `packages/core/src/credentials.rs` (Keychain via `keyring`) | service | request-response | none — new capability this phase | no analog |
| `packages/desktop/src-tauri/src/commands/worktree.rs` | controller (Tauri command) | request-response | `packages/desktop/src-tauri/src/commands/task.rs` | exact |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` (start/stop/answer-permission) | controller (Tauri command) | request-response + event-driven | `packages/desktop/src-tauri/src/commands/task.rs` | exact |
| `packages/desktop/src-tauri/src/commands/settings.rs` | controller (Tauri command) | request-response | `packages/desktop/src-tauri/src/commands/project.rs` | role-match |
| `packages/desktop/src-tauri/src/sidecar.rs` (spawn/health-check/kill-on-exit supervisor) | service (process supervision) | event-driven / streaming | none in-repo — first process-supervision code in this codebase | no analog |
| `packages/desktop/src-tauri/src/state.rs` (extend `AppState`) | config/state | — | `packages/desktop/src-tauri/src/state.rs` (existing `AppState { db: Mutex<Connection> }`) | exact (self-extend) |
| `packages/desktop/src-tauri/src/main.rs` (register new commands, wire sidecar lifecycle) | config | — | `packages/desktop/src-tauri/src/main.rs` (existing `generate_handler!` roster + `.setup()`) | exact (self-extend) |
| `packages/desktop/src-tauri/capabilities/default.json` (new command grants) | config | — | same file, existing structure | exact (self-extend) |
| `packages/sidecar/src/index.ts` (spawn `claude -p`, parse stream-json) | service (process driver) | streaming / event-driven | none in-repo — new package | no analog |
| `packages/sidecar/src/mcp-permission-server.ts` | service (MCP server) | request-response (blocking) | none in-repo — new capability | no analog |
| `packages/desktop/src/adapters/tauri.ts` (extend: `startAgentRun`, `stopAgentRun`, `answerPermission`, `subscribeAgentEvent`) | provider/adapter | request-response + push/event | `packages/desktop/src/adapters/tauri.ts` (itself — `invokeCommand`/`subscribeBoardChanged`/`subscribeMenuAction`) | exact |
| `packages/desktop/src/launch-sheet/LaunchSheet.tsx` | component (overlay/form) | request-response | `packages/desktop/src/board/pickers/StatusPicker.tsx` (Radix `FocusScope`/`DismissableLayer` overlay pattern) — command palette is the closer full-dialog analog for scrim+centred-overlay mechanics | role-match |
| `packages/desktop/src/session/SessionSurface.tsx` (full surface, feed) | component (full surface) | streaming / windowed-read | `packages/desktop/src/item-detail/ActivityTrail.tsx` (windowed/paginated read pattern) + `ItemDetailPanel.tsx` (full-peer-surface push/pop + `FocusScope` pattern) | role-match (composite of two analogs) |
| `packages/desktop/src/session/PermissionRequestCard.tsx` | component (inline blocking) | request-response | `packages/desktop/src/board/pickers/StatusPicker.tsx` (inline actionable card mounted from two places) | role-match |
| `packages/desktop/src/item-detail/RunsSection.tsx` | component (embedded list) | CRUD-read | `packages/desktop/src/item-detail/ActivityTrail.tsx` | exact |
| `packages/desktop/src/item-detail/WorktreeSummary.tsx` | component (embedded static) | CRUD-read | `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` (small embedded read-mostly section inside the panel) | role-match |
| `packages/desktop/src/settings/SettingsSurface.tsx` | component (full surface, form) | CRUD | `packages/desktop/src/item-detail/ItemDetailPanel.tsx` (full-surface-with-back-affordance shape is closer than any board list); `board/pickers/*` for the segmented-control/select mechanics | role-match |
| `packages/desktop/src/legend/marks.ts` (add `"agent"` channel + 4 new marks) | config/data | — | `packages/desktop/src/legend/marks.ts` (itself, existing `MarkChannel` union + `MARKS` array) | exact (self-extend) |
| `packages/desktop/src/state/keyboard.ts` (add `w`, `l`, session-surface bindings, `⌘,`) | config/data | — | `packages/desktop/src/state/keyboard.ts` (itself, existing `ActionId`/`Binding`/`BINDINGS` table) | exact (self-extend) |
| `packages/desktop/src/theme/tokens.ts` + `styles/tokens.css` (4 new color tokens) | config | — | `packages/desktop/src/theme/tokens.ts` (existing `RACK`/`STRIP`/`INK` shape) | exact (self-extend) |
| `packages/core/tests/agent_process_safety.rs` (real-process interrupt/kill test) | test | event-driven (process) | `packages/core/tests/crash_safety.rs` | exact |

## Pattern Assignments

### `packages/core/src/db/migrations/0003_agent_runtime.sql` (migration)

**Analog:** `packages/core/src/db/migrations/0002_board_schema.sql`

**CHECK-constraint-as-authority pattern** (lines 22-56, `projects`/`epics` tables):
```sql
CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    key_prefix TEXT NOT NULL,
    ...
    status TEXT NOT NULL CHECK (status IN ('active', 'unreachable')),
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL
);

CREATE TABLE epics (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    project_id TEXT NOT NULL REFERENCES projects(id),
    ...
    status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done')),
    integration_branch TEXT,   -- added in 0002 specifically so a LATER phase needs no schema change
    archived_at TEXT,
    created_by TEXT NOT NULL REFERENCES actors(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

**Header-comment convention documenting owner decisions inline** (lines 1-21) — copy this shape
verbatim for `0003`: cite the CONTEXT.md decision IDs (D-23..D-39) and requirement IDs (DATA-04,
DATA-06) the same way `0002` cites BOARD-04/D-06/D-10/etc., and record the CHECK-constrained
`triggers.source IN ('user_action','schedule','webhook','agent_proposal')` as DATA-04's
"accepted-but-unimplemented, enforced by schema not app code" contract, matching 0002's own stated
rule ("no app-layer guard can be bypassed").

**Apply the identical idiom to every new table** (`worktrees`, `agent_runs`, `triggers`,
`permission_requests`, `permission_rules`): `TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26)`
ULIDs, `created_by TEXT NOT NULL REFERENCES actors(id)`, `created_at TEXT NOT NULL`, and every
enum-shaped column CHECK-constrained rather than validated only in Rust.

---

### `packages/core/src/domain/worktree.rs`, `agent_run.rs`, `trigger.rs` (domain models, CRUD + event-append)

**Analog:** `packages/core/src/domain/task.rs::create_task` (full file read, lines 1-120+)

**Transactional-outbox pattern to copy exactly** (lines 40-111):
```rust
pub fn create_task(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    epic_id: Option<&str>,
) -> anyhow::Result<Task> {
    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;

    // ... validation / row-shaping queries against `tx`, never `conn` ...

    tx.execute(
        "INSERT INTO tasks (...) VALUES (...)",
        params![...],
    )
    .context("failed to insert task")?;

    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": null,
        "after": "backlog",
        "title": title,
        "label": format!("Created task \"{title}\""),
    });
    append_event(
        &tx, project_id, "local", sequence, "task", &id, Some(&id), None,
        actor_id, "task.created", &payload, &now,
    )?;

    tx.commit().context("failed to commit create_task transaction")?;

    Ok(Task { id, project_id: project_id.to_string(), /* ... */ })
}
```

**Rule to inherit verbatim:** one `conn.transaction()`, the mutable row insert, `next_sequence` +
`append_event` inside the same transaction, one commit — no exceptions (see the `event.rs` doc
comment below). `agent_run.rs`'s status transitions (`running` → `completed`/`failed`/
`interrupted`) and `worktree.rs`'s create-or-reuse check both follow this shape; the reuse check
(`SELECT * FROM worktrees WHERE task_id = ?`) happens *before* opening the transaction that would
do the insert, exactly as RESEARCH.md's Pitfall 2 pseudocode shows.

**`trigger.rs`'s writer for D-25's lazy epic-integration-branch cut** should follow
`packages/core/src/domain/epic.rs`'s existing `integration_branch` column (already present per
migration `0002`, confirmed at `packages/core/src/db/migrations/0002_board_schema.sql:49`) — write
that column inside the same transaction as the `agent_runs` insert when `task.epic_id` is present
and the epic has no `integration_branch` yet (D-25's "cut lazily at the first Start Work").

**`event.rs`'s doc-comment rule** (`packages/core/src/domain/event.rs:1-7`) governs every one of
these new domain modules:
```rust
//! Both [`next_sequence`] and [`append_event`] take a `&rusqlite::Transaction`, never a
//! `&Connection` — ... every domain mutation opens exactly one outer transaction and calls
//! these functions inside it, never from a nested one.
```

**D-19 human-renderable payload requirement** — every new event type this phase emits
(`worktree.created`, `agent_run.started`, `agent_run.completed`/`failed`/`interrupted`,
`task.status_changed` with `actor_id` = the agent, `permission_request.answered`) must carry a
`"label"` string in its payload exactly as `create_task`'s `"label": format!("Created task \"{title}\"")`
does — `render_description` (`event.rs:94-118`) falls back to a generic sentence only when
`"label"` is absent, and the activity trail reads straight from this, so a missing label degrades
the trail's readability for that row specifically.

---

### `packages/core/src/domain/permission_request.rs`, `permission_rule.rs` (child-of-parent CRUD)

**Analog:** `packages/core/src/domain/acceptance_criterion.rs` (role-match — a child row with a
toggle/status mutation scoped to a parent). Follow the same "insert row + append event in one
transaction" shape as `worktree.rs` above; `permission_rule.rs`'s "allow-always" insert (D-38)
should additionally check-then-insert against the existing `(project_id, tool_name)` pair to avoid
duplicate rules, matching this codebase's general "check before insert" idiom already used for
worktree reuse.

---

### `packages/core/src/query/agent_runs.rs` (windowed session-log / run reads, D-33)

**Analog:** `packages/core/src/query/events.rs` (full file head read, lines 1-100)

**Windowed `LIMIT`/`OFFSET` read pattern to copy exactly** (lines 86-97):
```rust
const TASK_TRAIL_SQL: &str = "SELECT id, project_id, origin, sequence, stream_type, stream_id, \
    task_id, epic_id, actor_id, event_type, payload, occurred_at \
    FROM events WHERE task_id = ?1 ORDER BY id ASC LIMIT ?2 OFFSET ?3";
```
Plus the module's stated discipline (lines 1-8): "Every statement below is a single literal
`&str`, bound through `params![]` — never assembled by `format!`/string interpolation." Apply this
literally to the new windowed read over `<app-data>/sessions/<agent-run-id>.jsonl` (D-33/D-34) —
though that specific read is file-based (JSONL line offsets), not SQL, the *shape* — a bounded
`limit`/`offset`-style page, description/label rendering deferred to read time, never a second
denormalised cache — is the one to reproduce. The SQL-backed half of this (the `agent_runs`/
`worktrees` list for the item-detail Runs section and Worktree summary) should use the identical
`LIMIT ?2 OFFSET ?3` idiom against the new tables.

**Row-shape / never-store-derived-text pattern** (lines 41-45, `EventRow.description`):
```rust
    /// The one-line human sentence [`render_description`] derived from `payload` at read time —
    /// never stored as its own column, always recomputed on read, so a future change to the
    /// rendering rule applies to every historical event without a backfill migration.
    pub description: String,
```
Apply the same "derive at read time, never store" discipline to any run-status label text the new
query module renders.

---

### `packages/core/src/git.rs` (explicit-path git wrapper, PROC-02)

**No literal in-repo analog** (this is the first git-shelling code in `packages/core`), but the
**discipline it must follow already governs every domain module** — no function anywhere in
`packages/core/src/domain/*` reads an ambient cwd; every path/id is an explicit parameter. Copy
that discipline, plus RESEARCH.md's own code example (verbatim, already vetted against this
codebase's conventions):
```rust
// Follows this crate's existing "no implicit cwd" discipline — PROC-02
fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<std::process::Output> {
    std::process::Command::new("git")
        .arg("-C").arg(repo_path)
        .args(args)
        .output()
        .context("git command failed")
}

git_at(&project.repo_path, &["worktree", "add", &worktree_path, "-b", &branch, &base_ref])?;
```
Wrap every `Output` check with the same `.context("...")` idiom `task.rs` uses throughout
(`.context("failed to insert task")`, etc.) — this crate consistently uses `anyhow::Context`, not
bare `Result<_, String>`, at the `core` layer (the `String` conversion happens only at the Tauri
command boundary — see `task_create` below).

---

### `packages/desktop/src-tauri/src/commands/worktree.rs`, `agent_run.rs` (Tauri commands)

**Analog:** `packages/desktop/src-tauri/src/commands/task.rs::task_create` (full excerpt, lines 1-78)

**Imports pattern** (lines 1-6):
```rust
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::state::AppState;
```

**DTO + From-impl pattern** (lines 10-36):
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    // ...
}

impl From<flywheel_core::domain::task::Task> for TaskDto {
    fn from(task: flywheel_core::domain::task::Task) -> Self {
        Self { id: task.id, /* ... */ }
    }
}
```

**Core command body pattern — lock, resolve actor server-side, call core, emit `board:changed`**
(lines 42-78):
```rust
#[tauri::command]
pub fn task_create(
    state: State<AppState>,
    app: AppHandle,
    project_id: String,
    title: String,
    epic_id: Option<String>,
) -> Result<TaskDto, String> {
    let title = title.trim();
    if title.is_empty() || title.len() > MAX_TITLE_LEN {
        return Err(format!("task title must be 1-{MAX_TITLE_LEN} characters, got {} characters", title.len()));
    }

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?;
    let task = flywheel_core::domain::task::create_task(&mut conn, &project_id, &actor_id, title, epic_id.as_deref())
        .map_err(|e| e.to_string())?;
    drop(conn);

    let dto: TaskDto = task.into();
    app.emit("board:changed", serde_json::json!({ "entity": "task", "id": dto.id })).ok();

    Ok(dto)
}
```

**Rule to inherit verbatim** (from `commands/mod.rs`'s own module doc comment, lines 1-5): "Every
handler locks `AppState.db`, validates its input shape and length before calling into the core,
stamps `actor_id` from the local human actor on the Rust side ... never from a renderer-supplied
claim, and, after a successful mutation, emits `board:changed` (D-04)." `agent_run_start` must
resolve `actor_id` the same way — D-29 requires the agent's own actor id, not a renderer claim, for
the "agent as actor" status-change mutation.

**`agent_run_stop`/`agent_run_answer_permission` should emit a new, analogous push event** (e.g.
`agent:event` or reuse `board:changed` with an `{entity: "agent_run", id}` payload) — copy the
identical `app.emit(...)` call shape, never a bespoke event-naming scheme.

---

### `packages/desktop/src-tauri/src/main.rs` (register new commands + sidecar lifecycle)

**Analog:** the file's own existing `generate_handler!` roster and `.setup()` closure (full file
read).

**Command registration pattern** (inside `tauri::generate_handler![...]`, lines ~53-91) — append
new entries in the same flat list, one per handler function, grouped by module comment as the
existing list already implicitly is by insertion order (`project::*`, `task::*`, `epic::*`,
`issue::*`, `board::*`, `actor::*`, `criterion::*`, `events::*`, `menu::*`). Add a `worktree::*`,
`agent_run::*`, `settings::*` group in the same style.

**`.setup()` closure pattern for launch-time work** (lines ~30-52) — this is the closest precedent
for where sidecar spawn/health-check-at-launch code belongs:
```rust
.setup(|app| {
    let db_path = flywheel_core::db::default_db_path()
        .expect("failed to resolve the app-data database path");
    // ... open_and_migrate, reconcile_projects, app.manage(AppState { db: Mutex::new(conn) }) ...
    Ok(())
})
```
The sidecar supervisor's spawn-at-launch, health-check and kill-on-exit wiring (PROC-01/PROC-02)
should follow this same "expect-or-crash-loudly at startup, never silently degrade" idiom the
existing migration/reconciliation code already uses — a failed sidecar spawn should surface, not
be swallowed. **Note:** this is a genuinely new capability (no in-repo process-supervision
precedent) — see "No Analog Found" below; only the *placement* (inside `.setup()`, managed via
`app.manage(...)`) is analog-derived.

**`capabilities/default.json` grant discipline** — per CONTEXT.md's Established Patterns note
("Default-deny IPC ... app commands are exposed solely through `generate_handler!` ... and the
capability file documents the full roster for auditability"), every new command added to
`generate_handler!` must also be added to `capabilities/default.json`, with the roster comment
kept accurate — copy the existing file's structure exactly, do not restructure it.

---

### `packages/desktop/src/adapters/tauri.ts` (extend with agent-run commands + live-event subscription)

**Analog:** the file itself (full read, lines 1-56)

**Module-boundary rule to inherit verbatim** (lines 1-9): this is "the ONLY module in the renderer
permitted to import from `@tauri-apps/api`" — every new function (`startAgentRun`, `stopAgentRun`,
`answerPermissionRequest`, `subscribeAgentEvent`) must live in this file, never imported ad hoc
elsewhere.

**Command-invoke pattern** (lines 15-22):
```typescript
export async function invokeCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invoke<TResult>(command, args);
}
```
New agent commands are called through this exact generic wrapper, not a bespoke typed function
per command (`startAgentRun` can be a thin typed wrapper *around* `invokeCommand`, matching how
`openFolderDialog` wraps `open()` below it).

**Push-subscription pattern** (lines 24-33):
```typescript
export async function subscribeBoardChanged(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen("board:changed", () => handler());
}
```
`subscribeAgentEvent(agentRunId, handler)` should follow this identical shape — `listen(...)`
wrapped in a typed async function returning `UnlistenFn`, exactly like `subscribeMenuAction` (lines
50-56) does for a payload-carrying event: `listen<string>("menu:action", (event) => handler(event.payload))`.

---

### `packages/desktop/src/launch-sheet/LaunchSheet.tsx` (D-27 overlay)

**Analog:** `packages/desktop/src/board/pickers/StatusPicker.tsx` for the Radix
`FocusScope`/`DismissableLayer` mechanics (the same pattern `ItemDetailPanel.tsx`'s own doc comment
explicitly points to: "closes on Escape with focus returning to the row that opened it (handled by
Radix `FocusScope`'s default unmount-restore behavior — see `pickers/StatusPicker.tsx` for the same
pattern)"). Reuse the command palette's scrim/centred-overlay layout (not read in full this pass,
but named directly by UI-SPEC.md as the mechanics to reuse: "reuses the command palette's existing
overlay/scrim/focus-trap mechanics").

**Escape ladder integration** — `state/keyboard.ts`'s doc comment (lines 10-11) states Escape is
"governed by the fixed-order layer ladder (`nextEscapeLayer` below), never by a per-region
binding" — the launch sheet must register into that ladder, not hand-roll its own Escape handler,
the same way `ItemDetailPanel.tsx` defers to the shared model rather than owning Escape outright.

---

### `packages/desktop/src/session/SessionSurface.tsx` (D-31/D-32/D-33)

**Analog (composite):** `packages/desktop/src/item-detail/ActivityTrail.tsx` for the
windowed/paginated read, `ItemDetailPanel.tsx` for the full-peer-surface push/pop shape.

**Paginated windowed-read pattern to copy** (`ActivityTrail.tsx`, lines 1-24, full doc comment +
imports):
```typescript
/**
 * Paginated with `useInfiniteQuery`: each request is capped at 50 events server-side
 * (`events.rs`'s `TRAIL_MAX_LIMIT`), and "Load more" fetches the next 50-event page rather than
 * ever re-requesting a growing, unbounded window (Performance Contract: "never renders an
 * unbounded trail at once").
 */
import { useEffect, type ComponentType } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import * as icons from "lucide-react";
import { invokeCommand, subscribeBoardChanged } from "../adapters/tauri";
```
`SessionSurface.tsx`'s feed read should use `useInfiniteQuery` identically, against a new
`sessionEventsWindow(agentRunId, cursor)` command, subscribing to the new `subscribeAgentEvent`
push channel in place of `subscribeBoardChanged` for live invalidation. The `Icon` helper (lines
44-48, resolving a Lucide icon by string name from `MARKS`) is directly reusable for the feed's
tool-call-row glyphs and the run-status glyphs (D-32/Run Status table).

**Full-surface push/pop shape** — from `ItemDetailPanel.tsx`'s own framing (lines 1-16): a peer
surface that "opens... closes... with focus returning to the row that opened it," using
`FocusScope`/`DismissableLayer` exactly as that panel does — but UI-SPEC.md is explicit the session
surface is a full content-area replacement, not a 480px panel, so only the *focus/dismiss
machinery* is the copy target, not the panel's own width/layout.

**Virtualization** — UI-SPEC.md explicitly names `@tanstack/react-virtual` as "same library as the
board — no new dependency"; find the board's existing virtualized-list usage (not read this pass,
out of this phase's required-reading set, but confirmed present as an existing dependency per
RESEARCH.md's Package Legitimacy Audit) as the literal virtualization-config analog before
inventing new `estimateSize` conventions.

---

### `packages/desktop/src/session/PermissionRequestCard.tsx` (AGNT-06, D-37/D-38)

**Analog:** `packages/desktop/src/board/pickers/StatusPicker.tsx` — an inline, actionable card
mounted from more than one place (the picker pattern is the established precedent for "one
component, multiple mount points" already used elsewhere in `ItemDetailPanel.tsx`'s own
`statusPickerOpen`/`statusPickerAnchor` state). UI-SPEC.md Discretion #6 explicitly calls out reuse
of exactly this precedent: "Reusing one component in two mount points is standard practice already
established by this codebase's shared-picker pattern (`ParentPicker` reused across row and
detail)." Read `ParentPicker.tsx` alongside `StatusPicker.tsx` before implementing — same
directory, same pattern, not separately excerpted here per the "3-5 strong analogs" stopping rule.

---

### `packages/desktop/src/item-detail/RunsSection.tsx`, `WorktreeSummary.tsx`

**Analog:** `packages/desktop/src/item-detail/ActivityTrail.tsx` (embedded section shape,
`trailQueryKey`-style query-key convention, "absent until data exists" rendering — matches
UI-SPEC.md's State Inventory rows for both new sections: "Worktree summary section is simply
absent... its first appearance IS the signal that work has started"). Copy the `useActors`-style
small companion hook pattern (`ActivityTrail.tsx` imports `useActors` from
`../board/useBoardQuery`) for any small lookup `RunsSection.tsx` needs (e.g. resolving an
`agent_run`'s adapter/actor label).

---

### `packages/desktop/src/settings/SettingsSurface.tsx` (D-39, first Settings surface)

**Analog:** `packages/desktop/src/item-detail/ItemDetailPanel.tsx` for the "full surface with a
back affordance, not a modal" shape (structurally the closer analog than any board-list file,
since Settings — like the session surface — replaces the content area and is reached via a
back-affordance, per UI-SPEC.md's own framing: "same shell pattern as the live session surface").
Segmented-control and per-row select mechanics should be lifted from `board/pickers/*`
(`AssigneePicker.tsx`/`EstimatePicker.tsx` are the closest for a small fixed-choice control — not
separately excerpted here, same stopping-rule note as above).

---

### `packages/desktop/src/legend/marks.ts` (add `"agent"` channel)

**Analog:** the file itself (lines 1-80 read in full for the existing shape)

**Extend the union and array in place, never a second list** (lines 13-22, 43-80):
```typescript
export type MarkChannel =
  | "row-state"
  | "focus"
  | "status"
  | "priority"
  | "epic"
  | "criteria"
  | "estimate"
  | "assignee"
  | "project";
  // add: | "agent"

export const MARKS: Mark[] = [
  { id: "row-surface", channel: "row-state", glyph: "Square", label: "Idle row", meaning: "..." },
  // ... append new agent-channel entries in the same { id, channel, glyph, label, meaning } shape
];
```
UI-SPEC.md's own binding requirement ("every new mark this phase introduces... must be appended to
`packages/desktop/src/legend/marks.ts` before the task is done") makes this file mandatory to
touch, not optional — the four new Run Status marks (Loader/ShieldAlert/CircleCheckBig/CircleX/
CircleSlash) plus the Blocked-indicator mark all go here, each glyph name matching a real
`lucide-react` export exactly as the doc comment (lines 29-35) requires: "Never empty — a mark's
meaning must never rest on colour alone."

---

### `packages/desktop/src/state/keyboard.ts` (add `w`, `l`, session-surface bindings, `⌘,`)

**Analog:** the file itself (lines 1-70 read in full for the existing shape)

**Extend `ActionId` and `BINDINGS` in place** — the file's own doc comment (lines 1-11) is the rule
to inherit: "This is the ONLY module that maps a key to a board action — no other component
hand-rolls its own `event.key === '...'` switch." Add `"start-work" | "open-live-session" |
"stop-session" | "toggle-raw-view" | "answer-permission-allow" | "answer-permission-deny" |
"answer-permission-allow-always" | "open-settings"` to the `ActionId` union (lines 33-49), and
matching `Binding` entries (`key: "w"`, `region: "board-list"`, etc.) to `BINDINGS` — never a
per-component `onKeyDown` switch for these, matching `ItemDetailPanel.tsx`'s own restraint (it only
owns the keys the shared table doesn't yet cover: title-field Enter/Escape, Tab).

**Escape is not a table entry** (lines 10-11) — the session surface's `Escape → return to board`
and the permission card's deliberate `Escape` exemption (D-37/UI-SPEC.md: "No Escape-to-dismiss")
must be wired through `nextEscapeLayer`'s ladder, with the permission card *excluded* from that
ladder entirely (a genuinely new exception to copy carefully, not a bug).

---

## Shared Patterns

### Transactional outbox (every new domain mutation)
**Source:** `packages/core/src/domain/event.rs` (`append_event`/`next_sequence`, lines 41-78) +
`packages/core/src/domain/task.rs::create_task` (lines 40-111)
**Apply to:** `worktree.rs`, `agent_run.rs`, `trigger.rs`, `permission_request.rs`,
`permission_rule.rs` — every mutable-row insert/update in `packages/core` for this phase.
```rust
let tx = conn.transaction()?;
// ... row insert/update against &tx ...
let sequence = next_sequence(&tx, project_id, "local")?;
append_event(&tx, project_id, "local", sequence, stream_type, &id, task_id, epic_id, actor_id, event_type, &payload, &now)?;
tx.commit()?;
```

### Server-resolved actor, never renderer-claimed
**Source:** `packages/desktop/src-tauri/src/commands/task.rs:59` +
`packages/desktop/src-tauri/src/commands/mod.rs:1-5` (module doc)
**Apply to:** every new Tauri command in `commands/worktree.rs`, `commands/agent_run.rs` —
`actor_id` is resolved via `flywheel_core::domain::actor::local_human_actor_id(&conn)` (or, for
D-29's agent-attributed mutation, an equivalent "resolve the agent actor server-side" call) and
never accepted as a command argument from the frontend.

### Push-after-commit (`board:changed` / new `agent:*` events)
**Source:** `packages/desktop/src-tauri/src/commands/task.rs:71-75` +
`packages/desktop/src/adapters/tauri.ts:24-33`
**Apply to:** every mutating Tauri command and its corresponding frontend subscription — emit
after the DB transaction commits and drop the lock first (`drop(conn);` before `app.emit(...)`,
line 68 of `task.rs`), never emit from inside the lock.

### Windowed reads, never full in-memory accumulation
**Source:** `packages/core/src/query/events.rs:86-97` (`LIMIT ?2 OFFSET ?3`) +
`packages/desktop/src/item-detail/ActivityTrail.tsx:1-24` (`useInfiniteQuery`, capped page size)
**Apply to:** the session feed's SQL-backed run/worktree reads, and the JSONL-backed session-log
read (D-33/PROC-07) — bounded requests, never a growing single fetch.

### Explicit-path / no-implicit-cwd discipline (PROC-02)
**Source:** the discipline already implicit across every `packages/core/src/domain/*` function
signature (no function reads an ambient cwd; every path/id is an explicit parameter) — codified for
this phase's new `git.rs`/sidecar-spawn code, per RESEARCH.md's example:
```rust
fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<std::process::Output> {
    std::process::Command::new("git").arg("-C").arg(repo_path).args(args).output()
        .context("git command failed")
}
```
**Apply to:** `packages/core/src/git.rs`, the sidecar's `spawn(cwd: worktreePath, ...)` call, and
`packages/desktop/src-tauri/src/sidecar.rs`'s own supervisor code.

### Never colour alone — glyph + word, defined in `legend/marks.ts`
**Source:** `packages/desktop/src/legend/marks.ts:29-35` (doc comment) — "a mark's meaning must
never rest on colour alone."
**Apply to:** the Blocked indicator, all four Run Status values, and the permission-decision icons
UI-SPEC.md names.

## No Analog Found

Files/surfaces with no close match in the codebase — genuinely new to this repo. The planner should
build these directly against `02-RESEARCH.md`'s Architecture Patterns section (process topology,
the sidecar-shape decision, the permission-prompt MCP server wiring) rather than forcing a weak
in-repo analog:

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/sidecar/src/index.ts` | service (process driver) | streaming/event-driven | No Node package exists in this repo yet (`packages/` today is only `core`, `desktop`, `relay-client`, per CONTEXT.md's own Claude's Discretion note) — this phase creates the sidecar from nothing. Build against RESEARCH.md's "Headless spawn inside the sidecar (Node)" code example. |
| `packages/sidecar/src/mcp-permission-server.ts` | service (MCP server) | request-response, blocking | No MCP server hosting exists anywhere in this codebase. Build against RESEARCH.md's "Permission-prompt MCP server" section and its documented promise-holding synthesis (flagged `[ASSUMED]` in wiring detail — RESEARCH.md recommends a short empirical spike before committing the exact mechanism). |
| `packages/desktop/src-tauri/src/sidecar.rs` | service (process supervision: spawn/health-check/kill-on-exit) | event-driven | First process-supervision code in `packages/desktop/src-tauri` — no prior Tauri command spawns or supervises a child process. Build against RESEARCH.md's `tauri-plugin-shell` code example (`app.shell().sidecar(...)`) and Pitfall 3's process-group-kill guidance. |
| `packages/core/src/credentials.rs` (Keychain read/write via `keyring`) | service | request-response | No secret-storage code exists yet in this repo (D-39 is explicitly "the application's first Settings surface" and first Keychain integration). Build against RESEARCH.md's `keyring` crate installation notes (`--features apple-native-keyring-store`, not a default feature). |
| `packages/desktop/src/state/permissionMode.ts` (if the planner splits launch-sheet mode selection into its own module) | utility | — | Optional file; if created, it is genuinely new UI state with no existing analog (Phase 1 has no equivalent "run configuration" concept) — inline it into `LaunchSheet.tsx` instead unless it grows large enough to warrant its own module. |

## Metadata

**Analog search scope:** `packages/core/src/db/migrations/`, `packages/core/src/domain/`,
`packages/core/src/query/`, `packages/core/tests/`, `packages/desktop/src-tauri/src/commands/`,
`packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src/adapters/`,
`packages/desktop/src/item-detail/`, `packages/desktop/src/board/pickers/`,
`packages/desktop/src/legend/`, `packages/desktop/src/state/`, `packages/desktop/src/theme/`.
**Files scanned:** ~30 (directory listings) + 9 fully or partially read for excerpt extraction.
**Pattern extraction date:** 2026-09-10
</content>
