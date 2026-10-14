# Phase 3: Nothing Lost, Nothing Left Running - Pattern Map

**Mapped:** 2026-09-12
**Files analyzed:** 21 (new + modified)
**Analogs found:** 19 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/git.rs` (+ `worktree_remove`, `git_status_porcelain`) | utility (git shell-out) | request-response | itself (`git_at`, `worktree_add`) | exact — extend existing module |
| `packages/core/src/git_retry.rs` (NEW) | utility (shared backoff) | transform | `packages/core/src/git.rs::git_at` (call site to wrap) | role-match — new module, existing call site |
| `packages/core/src/runtime_protocol.rs` (NEW, heartbeat/kill-record read-write) | utility (file I/O) | file-I/O | `packages/core/src/db/backup.rs` (file-based side-channel state) — not read this session, use `session_log.rs`'s JSONL-append idiom as fallback model | partial |
| `packages/core/src/domain/worktree.rs` (+ `reconcile_worktrees`, `mark_missing`) | model/domain | CRUD | `packages/core/src/domain/project.rs::reconcile_projects` | exact |
| `packages/core/src/domain/agent_run.rs` (+ `mark_abandoned`, orphan classification) | model/domain | CRUD | itself (`close_agent_run`, `apply_session_closed`) | exact |
| `packages/core/src/domain/agent_run.rs` migration `0006` (CHECK constraint additions) | migration | batch | `packages/core/src/db/migrations/0003_agent_runtime.sql` / `0004_permission_gate.sql` (not read this session — follow the CHECK-constraint-table-rebuild pattern those already establish per D-18) | role-match |
| `packages/desktop/src-tauri/src/commands/agent_run.rs` (+ `worktree_remove_check`, `worktree_remove`, `orphan_kill`, `reconcile_*` commands) | controller (Tauri command) | request-response | itself (`agent_run_stop`, `worktree_summary`) | exact |
| `packages/desktop/src-tauri/src/main.rs` (`setup()` gains reconcilers; `RunEvent::Exit` unchanged) | controller (app bootstrap) | event-driven | itself | exact |
| `packages/desktop/src-tauri/src/sidecar.rs` (heartbeat writer, watchdog spawn wiring) | service (process supervision) | event-driven | itself (`spawn_sidecar`, `shutdown_all_sessions`, `kill`, `persist_event_line`/`PersistOutcome`) | exact |
| `packages/sidecar/src/claude-code-adapter.ts` (spawn wrapped by watchdog, `--settings` hook injection, PATH shim env) | service (process spawn) | event-driven | itself (`spawn`, `interruptSession`, `killSession`, `LiveSession`) | exact |
| `packages/sidecar/src/watchdog/` (NEW wrapper binary/script) | service (process supervision) | event-driven | `packages/sidecar/src/claude-code-adapter.ts` (the spawn call it wraps) + PITFALLS "child monitors parent" pattern | role-match — new component |
| `packages/shim/` (NEW `git` PATH shim) | utility / gate | request-response | `packages/core/src/git.rs` (semantics to mirror: explicit path, fail closed) + `packages/sidecar/src/mcp-permission-server.ts` (no-timeout wait-for-decision pattern) | role-match — new component |
| `packages/desktop/src/item-detail/WorktreeSummary.tsx` (+ `missing` banner, Remove Worktree action) | component | request-response | itself | exact |
| `packages/desktop/src/item-detail/RunsSection.tsx` (+ `abandoned` badge/acknowledgment) | component | request-response | itself + `packages/desktop/src/legend/marks.ts` (mark definitions to add) | exact |
| `packages/desktop/src/components/WorktreeRemovalDialog.tsx` (NEW) | component (overlay) | request-response | `packages/desktop/src/board/DeleteConfirm.tsx` | exact |
| `packages/desktop/src/components/OrphanRecoveryModal.tsx` (NEW) | component (overlay, blocking) | request-response | `packages/desktop/src/board/DeleteConfirm.tsx` (widened per launch-sheet precedent) | role-match |
| `packages/desktop/src/session/PermissionRequestCard.tsx` (+ `destructive` variant) | component | request-response | itself | exact |
| `packages/desktop/src/legend/marks.ts` (+ `worktree-missing`, `run-abandoned`, `recovery-needed`, `destructive-gate`) | config (data table) | CRUD | itself | exact |
| `packages/desktop/src/state/keyboard.ts` (+ destructive-gate `a`/`d` reuse, no new bindings) | config (action map) | event-driven | itself (`useRegionBindings`, `answer-permission-allow`/`-deny` entries) | exact |
| `packages/desktop/src-tauri/capabilities/default.json` (+ new commands) | config | request-response | itself | exact |
| `packages/core/tests/{worktree_removal,spawn_stagger,reconcile_worktrees,launch_reconciliation,watchdog_survival,lock_contention}.rs` (NEW) | test | request-response / event-driven | `packages/core/tests/{worktree_lifecycle,stop_lifecycle,supervisor_cwd,cursor_resume}.rs` | exact |
| `packages/core/tests/bin/{commit_stress_harness,watchdog_harness}.rs` (NEW) | test (harness binary) | batch | `packages/core/tests/` crash-harness binary (referenced by RESEARCH.md, not independently re-verified this session — same directory, same "separate binary, real spawned process" idiom as `supervisor_cwd.rs`/`stop_lifecycle.rs`) | role-match |

## Pattern Assignments

### `packages/core/src/domain/worktree.rs` — `reconcile_worktrees` (D-45) (model, CRUD)

**Analog:** `packages/core/src/domain/project.rs::reconcile_projects` (lines 335–374, tracked)

**Core surface-never-repair pattern to copy verbatim in shape:**
```rust
// packages/core/src/domain/project.rs:335-374
pub fn reconcile_projects(conn: &mut Connection, actor_id: &str) -> anyhow::Result<()> {
    let projects = list_projects(conn)?;
    let now = Utc::now().to_rfc3339();

    for project in projects {
        let reachable =
            marker::verify_marker(Path::new(&project.repo_path), &project.id).unwrap_or(false);
        let new_status = if reachable { "active" } else { "unreachable" };
        if new_status == project.status {
            // No change: no row write, no event — idempotent no-op on repeated runs.
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE projects SET status = ?1 WHERE id = ?2",
            params![new_status, project.id],
        )?;
        let sequence = next_sequence(&tx, &project.id, "local")?;
        let payload = serde_json::json!({ "field": "status", "before": project.status, "after": new_status, "label": label });
        append_event(&tx, &project.id, "local", sequence, "project", &project.id, None, None,
            actor_id, "project.reconciled", &payload, &now)?;
        tx.commit()?;
    }
    Ok(())
}
```

**What `reconcile_worktrees` copies exactly:** list all `worktrees` rows with `status = 'active'`; `stat()` each `path` (any read error, including a genuine "not found," reads as `missing` — one bad worktree must never abort reconciliation for the others, mirroring `.unwrap_or(false)` above); write `status = 'missing'` and append a `worktree.missing` event ONLY on a state change (no write, no event, on an already-`missing` or still-present row); **never** touch `path`/`branch`/`base_branch` (D-45's binding rule, identical to `reconcile_projects` never touching `repo_path`). One transaction per changed row.

**Imports pattern to mirror** (from `project.rs`'s own top-of-file, not shown above but standard in this crate): `use rusqlite::{params, Connection}`, `use chrono::Utc`, `use anyhow::Context`, `use crate::domain::event::{append_event, next_sequence}`.

---

### `packages/core/src/domain/agent_run.rs` — `mark_abandoned` (D-49) (model, CRUD)

**Analog:** itself — `close_agent_run` (status write + event) and `apply_session_closed`'s already-terminal backfill guard (lines ~210–260, ~306–380, tracked)

**Terminal-status-write pattern to copy:**
```rust
// packages/core/src/domain/agent_run.rs (close_agent_run shape)
pub fn close_agent_run(
    conn: &mut Connection,
    run_id: &str,
    status: AgentRunStatus,
    cost_usd: ..., tokens_in: ..., tokens_out: ...,
) -> anyhow::Result<()> {
    // UPDATE agent_runs SET status = ?1, ..., ended_at = ?5 WHERE id = ?6
    // append_event(...) in the same transaction, payload: { "field": "status", "before": ..., "after": status.as_str(), "label": ... }
}
```

**Already-terminal backfill guard to copy for the reconciler** (never overwrite a run that already reached a real end):
```rust
// packages/core/src/domain/agent_run.rs:352 (apply_session_closed)
if matches!(current_status.as_str(), "completed" | "failed" | "interrupted") {
    // no-op: a later terminal event for the same run must never overwrite an earlier one
}
```
`mark_abandoned` must add `"abandoned"` itself to this terminal set once it exists, so a second reconciliation pass is idempotent exactly like `close_agent_run`/`apply_session_closed` already are.

**CHECK constraint enum to extend:**
```rust
// packages/core/src/domain/agent_run.rs:48
/// The five values `agent_runs.status`'s CHECK constraint accepts
pub enum AgentRunStatus { ... }
```
D-49 adds a sixth value, `Abandoned`/`"abandoned"` — requires a migration (table rebuild, per D-18's backup-first precedent) mirroring whatever `0003_agent_runtime.sql`/`0004_permission_gate.sql` already do for this same CHECK.

---

### `packages/core/src/git.rs` — `worktree_remove` + porcelain read (D-41/D-42) (utility, request-response)

**Analog:** itself — `worktree_add` and `git_at` (lines 33–110, tracked, the ONE `Command::new("git")` site)

```rust
// packages/core/src/git.rs:33-59 — the wrapper every new git call must route through
pub fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    if repo_path.as_os_str().is_empty() { bail!("git_at refused: repo_path must not be empty"); }
    if args.is_empty() { bail!("git_at refused: args must not be empty"); }
    let output = Command::new("git").arg("-C").arg(repo_path).args(args).output()
        .with_context(|| format!("failed to spawn git -C {repo_path:?} {args:?}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("git -C {repo_path:?} {args:?} failed (exit {:?}): {stderr}", output.status.code()));
    }
    Ok(output)
}
```

**Refusal-guard shape to copy for `worktree_remove`** (mirrors `worktree_add`'s pre-flight refusals at lines 83–110 — reject before spawning, name the exact reason):
```rust
// packages/core/src/git.rs:88-103 (worktree_add's refusal pattern)
if worktree_path == repo_path { bail!("worktree_add refused: worktree_path {worktree_path:?} equals repo_path"); }
let root = worktree_root_from_env();
if !worktree_path.starts_with(&root) { bail!("... is not under the Flywheel worktree root {root:?}"); }
```
`worktree_remove` should: (1) read `git status --porcelain` first (new function, `git_at(repo_path, &["status", "--porcelain"])`, parsed by the CALLER per D-42's rendering needs, not this module — mirrors `worktree_list`'s "no parsing of its own" convention at line 116); (2) refuse with an `anyhow::Error` naming the dirty count if porcelain output is non-empty (D-43: no force flag exists anywhere in the signature); (3) call `git worktree remove` only on a clean tree.

**`worktree_list`'s "no parsing, caller's job" convention** (line 112-119) is the direct template for how the porcelain read should be exposed — return raw stdout text, let the domain/command layer parse rows for D-42's UI.

---

### `packages/desktop/src-tauri/src/commands/agent_run.rs` — new Tauri commands (controller, request-response)

**Analog:** itself — `agent_run_stop` (lines 330–352) and `worktree_summary` (lines 939–947), tracked

```rust
// packages/desktop/src-tauri/src/commands/agent_run.rs:330-352
#[tauri::command]
pub fn agent_run_stop(
    state: State<AppState>,
    app: AppHandle,
    agent_run_id: String,
) -> Result<AgentRunStopDto, String> {
    let interrupt_result = match state.sidecar.as_ref() {
        Some(sidecar) => sidecar.interrupt_run(&agent_run_id).map_err(|e| e.to_string()),
        None => Ok(()),
    };
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let dto = stop_agent_run_recording_first(&mut conn, &agent_run_id, move || interrupt_result)?;
    drop(conn);
    app.emit("board:changed", serde_json::json!({ "entity": "agent_run", "id": agent_run_id })).ok();
    Ok(dto)
}
```

```rust
// packages/desktop/src-tauri/src/commands/agent_run.rs:939-947
#[tauri::command]
pub fn worktree_summary(state: State<AppState>, task_id: String) -> Result<Option<WorktreeSummaryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let summary = flywheel_core::query::agent_runs::worktree_summary_for_task(&conn, &task_id)
        .map_err(|e| e.to_string())?;
    Ok(summary.map(WorktreeSummaryDto::from))
}
```

**What `worktree_remove_check` / `worktree_remove` / `orphan_kill` copy:** lock ordering discipline (`agent_run_stop`'s own comment: "resolve the interrupt outcome BEFORE touching `state.db`" — for `orphan_kill`, resolve the process-kill outcome before the DB lock, same reasoning: never hold the mutex across a slow/wedged external operation); `Result<T, String>` return convention (`.map_err(|e| e.to_string())` everywhere, no panics); emit `"board:changed"` after a state-changing command, exactly as `agent_run_stop` does. Each new command must be added to `main.rs`'s `generate_handler!` list and `capabilities/default.json`'s roster comment (see below).

**`main.rs` `generate_handler!` insertion point:**
```rust
// packages/desktop/src-tauri/src/main.rs:116-128 — existing agent_run.* entries to extend
commands::agent_run::agent_run_stop,
commands::agent_run::agent_run_answer_permission,
...
commands::agent_run::worktree_summary,
```

---

### `packages/desktop/src-tauri/src/main.rs` — `setup()` reconciler wiring (controller, event-driven)

**Analog:** itself (lines 40–75, tracked) — the exact sequence D-45/D-46's reconcilers slot into

```rust
// packages/desktop/src-tauri/src/main.rs:40-72
.setup(|app| {
    let db_path = flywheel_core::db::default_db_path().expect(...);
    let backups_dir = flywheel_core::db::default_backups_dir().expect(...);
    let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir).expect(...);

    let reconcile_actor_id = flywheel_core::domain::actor::local_human_actor_id(&conn).expect(...);
    flywheel_core::domain::project::reconcile_projects(&mut conn, &reconcile_actor_id)
        .expect("failed to reconcile registered projects at launch");

    // NEW: reconcile_worktrees(&mut conn, &reconcile_actor_id) here
    // NEW: reconcile_agent_runs(&mut conn, &reconcile_actor_id) here — returns pending_orphans list

    let sidecar_handle = sidecar::spawn_sidecar(app.handle()).expect(...);

    app.manage(AppState { db: Mutex::new(conn), sidecar: Some(sidecar_handle) /* + pending_orphans */ });
    Ok(())
})
```
Same `expect()`-or-crash-loudly idiom for every reconciler call — a reconciliation failure at launch must be as loud as a migration failure, per this file's own established pattern; no silent `Result` swallowing at this call site.

**`RunEvent::Exit` — unchanged, but the sequencing comment is the model for why the watchdog is a *third*, independent net:**
```rust
// packages/desktop/src-tauri/src/main.rs:137-156
.run(|app_handle, event| {
    if let tauri::RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<AppState>() {
            if let Some(sidecar) = state.sidecar.as_ref() {
                if let Err(err) = sidecar.shutdown_all_sessions() {
                    eprintln!("failed to signal live agent sessions during app exit: {err:#}");
                }
                sidecar.kill();
            }
        }
    }
});
```

---

### `packages/desktop/src-tauri/src/sidecar.rs` — heartbeat writer + watchdog spawn (service, event-driven)

**Analog:** itself — `SidecarHandle::shutdown_all_sessions`/`kill` (lines ~311–370) and the non-panicking `PersistOutcome` seam (lines 376–441), tracked

```rust
// packages/desktop/src-tauri/src/sidecar.rs:355-370
pub fn kill(&self) {
    if let Some(child) = ... {
        let _ = child.kill();
    }
}
```
Doc comment at line ~311 spells out the ordering invariant D-47 must not break: `shutdown_all_sessions` MUST be called before `kill()` — killing the sidecar first removes the only thing still able to signal detached session groups. The heartbeat-touch call belongs in the same `SidecarHandle` (or a sibling struct it owns), on a `tokio` interval, independent of this ordering (it is a passive file touch, not a signal).

**`PersistOutcome`'s "failure is a returned value, never a panic" pattern to copy for `runtime_protocol.rs`:**
```rust
// packages/desktop/src-tauri/src/sidecar.rs:376 area
pub(crate) enum PersistOutcome {
    Written,
    RejectedRunId,
    OpenFailed(String),
    AppendFailed(String),
}
```
The heartbeat writer and the kill-record reader/writer (D-47/D-50) must return an equivalent enum rather than `unwrap`/panic on a write failure — this is the CR-03 discipline named explicitly in RESEARCH.md's "Established Patterns."

---

### `packages/sidecar/src/claude-code-adapter.ts` — watchdog-wrapped spawn (service, event-driven)

**Analog:** itself — the `spawn()` call and `LiveSession`/`interruptSession`/`killSession` (lines ~379–420, 513–565), tracked

```typescript
// packages/sidecar/src/claude-code-adapter.ts:401-425 (approximate; verified this session per RESEARCH.md)
const argv = buildClaudeArgv({ ... });
const child = spawn(bin, argv, {
  cwd: options.worktreePath,
  env: { ...process.env, ...options.env },
  detached: true, // own process group, so -pid reaches the whole group (D-35)
});
session = {
  child,
  closedEventEmitted: false,
  ...
};
liveSessions.set(runId, session);
```

```typescript
// packages/sidecar/src/claude-code-adapter.ts:513-522 (interruptSession)
async interruptSession(runId: string): Promise<void> {
  const session = liveSessions.get(runId);
  if (!session) return;
  if (session.closedEventEmitted || session.child.pid === undefined) return; // already exited — safe no-op (D-35)
  // process.kill(-pid, "SIGINT") reaches the whole process group
}
```

**What the D-47 watchdog wrapper must preserve exactly (RESEARCH.md Pitfall 4, own analysis):** `spawn(bin, argv, {...})` becomes `spawn(watchdogBin, [bin, ...argv], { ...options, detached: true })` — the WRAPPER becomes the new group leader and spawns `claude` as its own child WITHOUT a second `detached: true` (which would fork a second, unreachable group). `session.child` must still resolve to a PID that `interruptSession`/`killSession`'s existing `-pid` signaling reaches for the WHOLE group (wrapper + claude) — write a test in the style of the existing interrupt/kill tests asserting this, per RESEARCH.md's named anti-pattern.

**`options.env` is the exact seam D-51's shim and D-55's `--settings` use** — no new plumbing needed, just additional entries in the `env`/`argv` objects already passed into this one `spawn()` call.

---

### `packages/sidecar/src/mcp-permission-server.ts` — no-timeout wait pattern (service, event-driven)

**Analog:** itself (doc comment cited in RESEARCH.md: "no timer, no default, no local cache... the sidecar asks and waits"), tracked — the model for the shim's `wait_for_decision` step (D-55), since the shim is a plain OS process immune to the CLI's own hook-timeout semantics (RESEARCH.md's central finding). Route the shim's destructive-request relay through the SAME permission channel this file already opens, rather than inventing a second answering surface (per `03-CONTEXT.md`'s own instruction).

---

### `packages/desktop/src/item-detail/WorktreeSummary.tsx` — `missing` banner + Remove Worktree action (component, request-response)

**Analog:** itself, full file read (148 lines, tracked)

```tsx
// packages/desktop/src/item-detail/WorktreeSummary.tsx:64-83 (existing early-return/absence-is-the-state ladder)
export function WorktreeSummary({ taskId }: WorktreeSummaryProps) {
  const query = useWorktreeSummary(taskId);
  if (query.isPending) return null;   // E6 loading: render nothing
  if (!query.data) return null;       // E6 empty: no worktree yet, section doesn't exist
  const rawData: unknown = query.data;
  const violatesSingleton = Array.isArray(rawData);
  const summary = (violatesSingleton ? (rawData as WorktreeSummaryDto[])[0] : rawData) as PossiblyPartialSummary | undefined;
  if (!summary) return null;
  ...
}
```
The `missing` banner (D-45) is a new branch in this SAME ladder: `if (summary.status === "missing") return <MissingWorktreeBanner .../>` — inserted between the singleton-violation guard and the normal branch/path render, per the UI-SPEC's "replaces the line entirely, never renders alongside" rule. The "Remove Worktree" action appends after the existing branch/path row, gated on `summary.status !== "missing"` (UI-SPEC: hidden entirely for a missing worktree).

**Mono stack + copy-to-clipboard idiom to reuse verbatim** (lines 35, 53-62):
```tsx
const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
async function copyToClipboard(text: string): Promise<void> {
  try { await navigator.clipboard.writeText(text); } catch { /* best-effort, no error state */ }
}
```

---

### `packages/desktop/src/components/WorktreeRemovalDialog.tsx` (NEW) — overlay (component, request-response)

**Analog:** `packages/desktop/src/board/DeleteConfirm.tsx`, full file read (130 lines, tracked) — the exact Radix pattern the UI-SPEC names as this dialog's template.

**Radix trap/dismiss/focus pattern to copy verbatim in shape:**
```tsx
// packages/desktop/src/board/DeleteConfirm.tsx:38-50
return createPortal(
  <FocusScope trapped loop asChild onMountAutoFocus={(event) => {
    event.preventDefault();
    cancelRef.current?.focus(); // Cancel/OK gets focus, never the destructive action
  }}>
    <DismissableLayer
      onEscapeKeyDown={(event) => { event.preventDefault(); onCancel(); }}
      onPointerDownOutside={onCancel}
      asChild
    >
      <div role="alertdialog" aria-label={...} onKeyDown={handleKeyDown} style={{ position: "fixed", inset: 0, zIndex: 1200, ... }}>
        ...
      </div>
    </DismissableLayer>
  </FocusScope>,
  document.body,
);
```

**Button styling to copy for the Clean-state "Remove" button** (destructive-filled, contrast-checked comment worth preserving verbatim as a reminder):
```tsx
// packages/desktop/src/board/DeleteConfirm.tsx:104-122
<button type="button" onClick={onConfirm} style={{
  border: "1px solid var(--destructive-strip)",
  background: "var(--destructive-strip)",
  // `--text-primary-strip` measures only 2.2:1 here — `--text-primary-rack` measures 6.3:1, past AA.
  color: "var(--text-primary-rack)",
}}>
  Delete
</button>
```
For the Dirty/Refusal state: this component needs a THIRD rendered mode this analog doesn't have (Checking / Clean-confirm / Dirty-refusal) — build it as one component with internal state, not three components, per the UI-SPEC's explicit "one component, three rendered states" instruction. The refusal state's single "OK" button reuses the Cancel button's exact styling/`autoFocus` treatment (lines 88-103), never the destructive Delete styling.

---

### `packages/desktop/src/components/OrphanRecoveryModal.tsx` (NEW) — blocking overlay (component, request-response)

**Analog:** `packages/desktop/src/board/DeleteConfirm.tsx` (same Radix shape, widened) — but with `DismissableLayer`'s `onEscapeKeyDown`/`onPointerDownOutside` handlers REMOVED per D-46/UI-SPEC ("no Escape, no click-outside, no manual close — the modal closes itself when its list is empty"). Reuse the `<FocusScope trapped loop>` wrapper and `createPortal(..., document.body)` call; drop the `DismissableLayer` escape/outside-click props entirely (pass no-ops or omit the layer) since this is the one overlay in the product, alongside the Permission-request card, that deliberately breaks the shared Escape ladder.

**Per-row Kill / Kill All state machine — analog:** `packages/desktop/src/session/PermissionRequestCard.tsx`'s `PermissionRequestRow` local `RowState` pattern (lines 61–96, tracked):
```tsx
// packages/desktop/src/session/PermissionRequestCard.tsx:61-96
interface RowState { answering: boolean; error: string | null; }
async function answer(decision: PermissionDecision) {
  if (state.answering) return; // guards a second activation while disabled
  setState({ answering: true, error: null });
  try {
    await onAnswer(request.id, decision);
    // row disappears once the shared pending-set query re-reads — no local "answered" state held
  } catch {
    setState({ answering: false, error: "Could not send your answer. Try again." });
  }
}
```
Copy this shape exactly for each orphan row's Kill button: `{ killing: boolean, failed: boolean }` state, guard a second Kill press while `killing`, and on failure the row PERSISTS with inline copy (per D-46's decided behavior) rather than the card's own "disappears on success" — this is the one place OrphanRecoveryModal's contract diverges from PermissionRequestCard's (a permission card's failed answer clears back to answerable; a failed kill row stays mounted with permanent failure copy until manually resolved from outside Flywheel).

---

### `packages/desktop/src/session/PermissionRequestCard.tsx` — `destructive` variant (D-55/56/57/58) (component, request-response)

**Analog:** itself, full file read (242 lines, tracked)

```tsx
// packages/desktop/src/session/PermissionRequestCard.tsx:66-108 (existing routine row — the shape to extend, not replace)
function PermissionRequestRow({ request, variant, keyboardEnabled, onAnswer }: {...}) {
  const [state, setState] = useState<RowState>({ answering: false, error: null });
  const glyph = MARKS_BY_ID["blocked-indicator"];
  ...
  useRegionBindings("permission-card", "permission-card", {
    "answer-permission-allow": () => { if (keyboardEnabled) void answer("allow"); },
    "answer-permission-deny": () => { if (keyboardEnabled) void answer("deny"); },
    "answer-permission-allow-always": () => { if (keyboardEnabled) void answer("allow_always"); },
  });
```
Add a `destructiveCategory?: DestructiveCategory | "uncategorized"` field to `PendingPermissionRequest`; when set, this row renders: `MARKS_BY_ID["destructive-gate"]` glyph instead of `"blocked-indicator"`, the consequence-copy line above the existing `<pre>` payload block, REVERSED button order/emphasis (Deny filled-primary using `DeleteConfirm.tsx`'s destructive-button styling shown above, Allow outline-secondary labeled "Allow, just this once"), and OMITS the tertiary "Allow this tool for this project from now on" button entirely (lines 193-210 — conditionally render, never merely disable, per D-57's "structurally absent" wording). Keyboard bindings (`a`/`d`) stay wired through the SAME `useRegionBindings` call — only their visual button mapping flips, exactly as the UI-SPEC's Keyboard Map Additions section specifies.

**Icon-resolution pattern to reuse for the new `OctagonAlert` glyph:**
```tsx
// packages/desktop/src/session/PermissionRequestCard.tsx:53-57
function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}
```

---

### `packages/desktop/src/legend/marks.ts` — new marks (config, CRUD)

**Analog:** itself, full `Mark` interface and existing agent-channel entries (lines 25–43, 296–333, tracked)

```typescript
// packages/desktop/src/legend/marks.ts:25-41
export interface Mark {
  id: string;
  channel: MarkChannel;
  glyph: string;   // lucide-react export name, never empty
  label: string;   // printed word, never empty
  meaning: string;
}
```

```typescript
// packages/desktop/src/legend/marks.ts:298-334 (existing agent-channel entries — the exact shape to append four more of)
{
  id: "run-failed",
  channel: "agent",
  glyph: "CircleX",
  label: "Failed",
  meaning: "This run ended in an error.",
},
{
  id: "run-interrupted",
  channel: "agent",
  glyph: "CircleSlash",
  label: "Interrupted",
  meaning: "This run was stopped by the user — a normal, deliberate outcome, not an error (D-35).",
},
```
Append, in the same `"agent"` channel (no new `MarkChannel` member needed, per the UI-SPEC's own instruction): `worktree-missing` (`TriangleAlert`), `run-abandoned` (`Unplug`), `recovery-needed` (`TriangleAlert`, deliberately same glyph as `worktree-missing`, mirroring the existing `run-blocked`/`blocked-indicator` shared-glyph precedent at lines 305-311/334-340), `destructive-gate` (`OctagonAlert`). Every mark referenced by a new component must exist here BEFORE the task is done — this file's own append discipline is binding per the UI-SPEC's "Build Process Requirement."

---

### `packages/desktop/src/state/keyboard.ts` — no new bindings, reuse existing region mechanism (config, event-driven)

**Analog:** itself, the existing `answer-permission-*` entries (lines 70-72, 150-153, tracked) and `useRegionBindings` (line 559)

```typescript
// packages/desktop/src/state/keyboard.ts:150-153
{ id: "answer-permission-allow", region: "permission-card", key: "a", label: "Allow" },
{
  id: "answer-permission-allow-always",
  ...
}
```
The destructive-gate card's `a`/`d` bindings are the SAME `ActionId`s (`answer-permission-allow`, `answer-permission-deny`) routed through the SAME `region: "permission-card"` — no new entries in this file at all (UI-SPEC: "same physical bindings as the routine card, unchanged in `state/keyboard.ts`; only the visual weight differs"). `Shift+A`'s existing `answer-permission-allow-always` binding simply has no corresponding button to trigger in the destructive variant — no code change needed here, only in the component that renders (or omits) the button.

## Shared Patterns

### Surface-never-repair reconciliation
**Source:** `packages/core/src/domain/project.rs::reconcile_projects` (lines 335–374)
**Apply to:** `reconcile_worktrees` (D-45) and the non-orphan half of `reconcile_agent_runs` (D-46/D-49) — list, stat/check, write-only-on-change, one event per change, never rewrite the identifying field (`path`/`branch` for worktrees, nothing analogous for runs beyond `status`/`ended_at`).

### One transaction writes the mutable row and appends to `events`
**Source:** `reconcile_projects`, `close_agent_run`, `ensure_worktree` — every domain mutation in this crate follows this shape.
**Apply to:** `worktree_remove`, `mark_missing`, `mark_abandoned`, the git-lock-exhaustion event (D-53) — no exceptions, payload shaped for human rendering per D-19 (see the `label` field in every `payload` json above).

### `actor_id` resolved server-side, never from the renderer
**Source:** `main.rs::setup()`'s `local_human_actor_id(&conn)` call feeding `reconcile_projects`.
**Apply to:** every new reconciler/command in this phase — the watchdog's kill and the reconcilers' writes need an actor; reuse `local_human_actor_id` (human-initiated recovery decisions) or the seeded Claude Code agent actor `01M21VR17D2SKYJMVH3P3DFJBW` (system-attributed events like git-lock exhaustion), never a value passed in from `packages/desktop/src`.

### Failure modes are returned enum values, never panics
**Source:** `packages/desktop/src-tauri/src/sidecar.rs`'s `PersistOutcome` (CR-03 fix for a panicking log-file open).
**Apply to:** `runtime_protocol.rs`'s heartbeat/kill-record I/O and the reconciler's per-row error handling (`reconcile_projects`'s own `.unwrap_or(false)` on a marker-read failure is the same instinct already in production).

### Command handler shape: `Result<T, String>`, lock ordering, `board:changed` emit
**Source:** `packages/desktop/src-tauri/src/commands/agent_run.rs::agent_run_stop` (lines 330–352).
**Apply to:** `worktree_remove_check`, `worktree_remove`, `orphan_kill` — resolve any external/slow operation (interrupt, kill signal, git call) BEFORE acquiring `state.db.lock()`; map every `anyhow::Error` to `String` via `.map_err(|e| e.to_string())`; emit `"board:changed"` after a state change.

### One Radix overlay pattern for every full-screen dialog
**Source:** `packages/desktop/src/board/DeleteConfirm.tsx` (`FocusScope` + `DismissableLayer` + `createPortal`).
**Apply to:** `WorktreeRemovalDialog` (all three overlay props active) and `OrphanRecoveryModal` (same `FocusScope`/portal shape, `DismissableLayer`'s escape/outside-click props removed per D-46).

### Row-local async-action state (`{ acting: boolean, error: string | null }`)
**Source:** `packages/desktop/src/session/PermissionRequestCard.tsx`'s `RowState`/`answer()`.
**Apply to:** Orphan modal's per-row Kill button, WorktreeSummary's Recreate/Remove Record actions, RunsSection's Acknowledge button — guard double-activation, surface a retry-friendly inline error, never a silent failure.

### Absence-is-the-state rendering ladder
**Source:** `packages/desktop/src/item-detail/WorktreeSummary.tsx`'s `isPending`/`!query.data` early-return chain.
**Apply to:** the `missing` banner (replaces, never joins, the normal line) and RunsSection's abandoned-row variant (renders only while unacknowledged, per the State Inventory table).

### Legend-mark discipline: every glyph is defined before it renders
**Source:** `packages/desktop/src/legend/marks.ts`'s `Mark` interface and existing `"agent"` channel entries.
**Apply to:** all four new marks (`worktree-missing`, `run-abandoned`, `recovery-needed`, `destructive-gate`) — append to the same file, same channel, before any component references them (binding build-process rule, not optional).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/core/src/git_retry.rs` (NEW, D-54's shared backoff module) | utility | transform | No existing retry/backoff module in this codebase to model against — RESEARCH.md's own backoff-curve code (200ms→400ms→800ms) is the starting reference, not a codebase analog. Plan against RESEARCH.md's "Code Examples"/"Don't Hand-Roll" sections directly. |
| `packages/shim/` (NEW git PATH shim binary/script) | utility / gate | request-response | This is new infrastructure with no prior analog in the workspace — closest partial precedent is `mcp-permission-server.ts`'s no-timeout wait pattern (cited above) for the blocking-wait half only; the argv-interception/PATH-shadowing half has no codebase precedent and must follow RESEARCH.md's "Pattern 3: The PATH shim as an unconditional interception point" skeleton. |
| `packages/sidecar/src/watchdog/` (NEW per-session wrapper) | service | event-driven | No existing wrapper-process pattern in this codebase; closest partial precedent is the spawn call it wraps (`claude-code-adapter.ts`, cited above). The heartbeat-poll-and-self-terminate logic itself has no analog — follow RESEARCH.md's "Pattern 2: The watchdog-per-child pattern" directly. |

## Metadata

**Analog search scope:** `packages/core/src/` (domain, git.rs, tests), `packages/desktop/src-tauri/src/` (commands, sidecar, main), `packages/desktop/src/` (item-detail, board, session, legend, state), `packages/sidecar/src/`.
**Files scanned:** 21 target files against ~15 candidate analogs read in full or by targeted range this session.
**Pattern extraction date:** 2026-09-12
