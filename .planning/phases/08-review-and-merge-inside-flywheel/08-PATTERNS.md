# Phase 8: Review And Merge Inside Flywheel - Pattern Map

**Mapped:** 2026-10-06
**Files analyzed:** 31 (new + modified)
**Analogs found:** 31 / 31 (every file has at least a role-match; two have only partial data-flow matches, noted)

All analog paths below were checked with `git ls-files` (tracked). Paths for files that do not exist yet
are intended new paths.

## Corrections to 08-RESEARCH.md (codebase wins)

| Research said | Codebase says | Use |
|---|---|---|
| `packages/core/src/worktree.rs:459` | No such file. The existing-branch `git worktree add` form is at **`packages/core/src/domain/worktree.rs:459`** (`git::git_at(repo_path, &["worktree", "add", &worktree_path_str, &worktree.branch])`, preceded by `git worktree prune` at :447). | `domain/worktree.rs` |
| `packages/core/src/forge.rs` | No such file. Forge is a directory: `packages/core/src/forge/mod.rs` (+ `github.rs`, `gitlab.rs`, `request_body.rs`, `transitions.rs`). | `forge/mod.rs` |
| `diff_stat_and_names` is the file-list source (CONTEXT D-134) | Research is right and CONTEXT is wrong: it returns `--stat` text plus `--name-only` with `--no-renames` baked in (`git.rs:188-205`); `drift.rs` depends on that. Add new reads, do not touch it. | new `review_files` |
| `packages/core/src/git_facts.rs` is a "sync read returning typed struct" | Confirmed, but it takes `&Connection` and resolves the repo itself (`git_facts_for_task(conn, task_id)`, `git_facts.rs:150`). Its `target_ref` is `origin/<integration>`, which does not exist locally (integration branch is never pushed). Review must use the **local** integration branch. | see File 2 |
| "all existing Tauri commands are sync `fn`" | Confirmed (`git_truth.rs`, `forge.rs` `forge_open_request` at `commands/forge.rs:216-263` is sync and does a network CLI call under no lock). New commands use `#[tauri::command(async)]`. | see Pair 2 |
| `AppState` has only `db`, `sidecar`, `pending_orphans`, `focused_task` | Confirmed (`state.rs:15-32`). Adding `merge_locks` requires editing the single `app.manage(AppState { .. })` literal in `main.rs:92-97`, and any test constructing `AppState`. | see File 18 |
| Layer ordering: `topLayer` | `topLayer` (`keyboard.ts:430`) only returns board/quick-add/detail/picker/palette. Surfaces (`session-surface`, `triage-surface`) are NOT in `topLayer`; they pass their layer string directly to `useRegionBindings(region, layer, handlers)` (e.g. `TriageSurface.tsx:329`). Do the same; do not touch `topLayer`. | see Pair 4 |

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `packages/core/src/git.rs` (modify: `git_output_at`, `review_files`, `review_patch`, `merge_tree_check`, `merge_no_ff`, `worktree_add_existing`, `push_branch`) | utility (git wrapper) | request-response | same file: `git_at`, `rev_parse_verify`, `diff_stat_and_names`, `worktree_add` | exact |
| `packages/core/src/review.rs` (new; add `pub mod review;` in `lib.rs`) | service | request-response + CRUD (event write) | `packages/core/src/git_facts.rs` | role-match |
| `packages/core/src/forge/request_body.rs` (modify: `assemble_epic_request_draft`) | service | transform (pure query) | same file `assemble_request_draft` | exact |
| `packages/core/src/forge/mod.rs` (modify: comment on call-site count only) | config/doc | — | itself | n/a |
| `packages/core/src/domain/acceptance_criterion.rs` (modify: `check_criterion_with_anchor`, anchor clear on uncheck, anchor copy in `revise_criterion_in_tx`) | service | CRUD | same file `toggle_criterion` (:583) | exact |
| `packages/core/src/context_packet.rs` (modify: widen `CRITERIA_SQL` :162, render ~:476) | service | transform | same file | exact |
| `packages/core/src/db/migrations/0018_criterion_anchors.sql` (new) + `db/mod.rs` registration | migration | CRUD | `0008_session_summaries.sql` (table), `0017_forge_setting.sql` (latest, registered at `db/mod.rs:38`) | exact |
| `packages/core/tests/review_diff.rs` (new) | test | request-response | `packages/core/tests/git_facts.rs` + `tests/common/mod.rs::seeded_git_project` | role-match |
| `packages/core/tests/review_merge.rs` (new) | test | request-response | `tests/worktree_lifecycle.rs` (FLYWHEEL_WORKTREE_ROOT) + `tests/git_facts.rs` (run_git helpers) | role-match |
| `packages/core/tests/criterion_anchors.rs` (new) | test | CRUD | `tests/criteria.rs`, `tests/criteria_pin.rs` | role-match |
| `packages/core/tests/epic_request_draft.rs` (new) | test | transform | `tests/forge_request_body.rs` | exact |
| `packages/core/tests/forge_live_chain.rs` (modify/extend: epic open via fake `gh`) | test | request-response | itself | exact |
| `packages/core/tests/context_packet.rs` (modify: expected criteria text) | test | transform | itself | exact |
| `packages/desktop/src-tauri/src/commands/review.rs` (new) | controller (Tauri) | request-response | `commands/git_truth.rs` (DTO shape) + `commands/forge.rs:216-263` (lock-drop-then-CLI shape) | role-match |
| `packages/desktop/src-tauri/src/commands/mod.rs` (modify: `pub mod review;`) | config | — | itself | exact |
| `packages/desktop/src-tauri/src/main.rs` (modify: handler list :116-215, `AppState` literal :92) | config | — | itself | exact |
| `packages/desktop/src-tauri/src/state.rs` (modify: `merge_locks`) | model/state | — | `focused_task: Mutex<Option<String>>` (:31) | role-match |
| `packages/desktop/src-tauri/capabilities/default.json` (modify: append names to description) | config | — | itself | exact |
| `packages/desktop/src/adapters/tauri.ts` (modify: typed wrappers + DTOs) | adapter | request-response | `gitFacts` (:449), `forgeRequestDraft` (:1273), `forgeOpenRequest` (:1287) | exact |
| `packages/desktop/src/board/useBoardQuery.ts` or `src/review/useReviewQuery.ts` (hooks) | hook | request-response | `useForgeRequest` (:1016) / `useGitFacts` (:975) | exact |
| `packages/desktop/src/state/uiStore.ts` (modify: `reviewSurface`) | store | event-driven | `triageSurfaceProjectId` (:191, 237, 261, 340, 371) | exact |
| `packages/desktop/src/state/keyboard.ts` (modify: region/layer/ActionId/binding/gate) | config | event-driven | `triage-surface` entries (:34, :238-256, :416, :476-499) | exact |
| `packages/desktop/src/App.tsx` (modify: surface chain :259-296) | component | event-driven | `TriageSurface` branch (:265-276) | exact |
| `packages/desktop/src/review/ReviewSurface.tsx` (new) | component | request-response | `triage/TriageSurface.tsx` | role-match |
| `packages/desktop/src/review/CriteriaRail.tsx` (new) | component | CRUD | `item-detail/AcceptanceCriteriaList.tsx` | exact (compose, do not fork) |
| `packages/desktop/src/review/FileList.tsx`, `FileDiff.tsx`, `MergeConfirmSheet.tsx`, `EpicRequestSheet.tsx` (new) | component | request-response | `item-detail/ForgeSection.tsx` (preview-then-confirm), `item-detail/GitFactsSection.tsx` (absence) | role-match |
| `packages/desktop/src/review/highlight.ts` (new) | utility | transform | no analog (no diff rendering in workspace) | none |
| `packages/desktop/src/item-detail/ItemDetailPanel.tsx` (modify: `onReview`) | component | event-driven | `onStartWork` (:70, :93, :233) | exact |
| `packages/desktop/src/board/BoardView.tsx` (modify: `open-review` case) | component | event-driven | `case "start-work"` (:631) | exact |
| `packages/desktop/src/legend/marks.ts` (modify: 4 new marks) | config | — | `criterion-checked` entries (:183-195) | exact |
| `packages/desktop/src/review/__tests__/*.test.tsx` (new) | test | request-response | `item-detail/__tests__/forge-section.test.tsx`, `git-facts-section.test.tsx` | exact |

## Pattern Assignments

### Pair 1: Rust review core (`git.rs` additions, `review.rs`)

**Analog:** `packages/core/src/git.rs` (construction site) and `packages/core/src/git_facts.rs` (module shape).

**The gate (`tests/supervisor_cwd.rs`)** asserts, verbatim in test names: `every_git_command_construction_lives_in_git_rs` (any non-comment line in `packages/core/src` or `packages/desktop/src-tauri/src` outside `core/src/git.rs` containing the literal `Command::new("git")` fails), `git_rs_applies_dash_c_before_any_subcommand_argument` (for every `Command::new("git")` in `git.rs`, `.arg("-C")` must appear before `.args(` inside a 6-line window), and `no_ambient_current_directory_reads_or_writes_in_core_or_supervisor` (no `env::current_dir`, `set_current_dir`, or `.current_dir(<arg without "path">)`).

Consequence: the new `git_output_at` must **wrap the existing private `spawn_git`**, never add a second `Command::new("git")`. It is the "apply no exit policy" sibling of `git_at`.

**The single construction site** (`git.rs:43-54`):
```rust
fn spawn_git(repo_path: &Path, args: &[&str]) -> anyhow::Result<Output> {
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(repo_path).args(args);
    crate::proc::output_with_timeout(
        &mut cmd,
        None,
        std::time::Duration::from_secs(crate::proc::GIT_TIMEOUT_SECS),
        &format!("git -C {repo_path:?} {args:?}"),
    )
    .with_context(|| format!("failed to spawn git -C {repo_path:?} {args:?}"))
}
```

**Policy wrapper to contrast against** (`git.rs:66-90`): `git_at` validates non-empty, wraps in `git_retry::with_lock_retry`, and at lines 78-84 converts non-zero exit into `Err(anyhow!(... stderr))` and drops stdout. That is why `merge-tree` (exit 1 = conflict, file list on stdout) cannot use it.

**Second policy wrapper to copy for `git_output_at`** (`git.rs:95-102`):
```rust
pub fn rev_parse_verify(repo_path: &Path, ref_name: &str) -> anyhow::Result<bool> {
    if repo_path.as_os_str().is_empty() {
        bail!("rev_parse_verify refused: repo_path must not be empty");
    }
    let output = spawn_git(repo_path, &["rev-parse", "--verify", "--quiet", ref_name])?;
    Ok(output.status.success())
}
```
`git_output_at` = same two refusals as `git_at` (empty repo_path, empty args) then `spawn_git(repo_path, args)` with no status check. Place it in `git.rs` right after `rev_parse_verify`. Use `rev_parse_verify(worktree, "MERGE_HEAD")` as-is for the abort safety net.

**Global flag placement** (`--literal-pathspecs`): pass it as the first element of `args` (after the `-C <path>` pair that `spawn_git` prepends). The `-C`-first gate is unaffected.

**Range-diff / typed-struct read to copy** (`git.rs:188-205`, `diff_stat_and_names`): doc-heavy fn, `format!("{base_ref}...HEAD")` range, `git_at(repo_path, &[...])`, `String::from_utf8_lossy(&out.stdout)`, split and filter empty. New `review_files` / `review_patch` keep this shape but use `{base}...{head}` (explicit head, run against `repo_path`) and `-z` NUL splitting.

**Existing-branch worktree add** (`domain/worktree.rs:447-458`, the precedent; not `git::worktree_add`, which always passes `-b` at `git.rs:134` and refuses an existing branch at :129):
```rust
git::git_at(repo_path, &["worktree", "prune"])
    .with_context(|| format!("failed to prune stale worktree metadata in {repo_path:?}"))?;
...
let worktree_path_str = worktree_path.to_string_lossy().into_owned();
git::git_at(repo_path, &["worktree", "add", &worktree_path_str, &worktree.branch])
```
Copy the three refusals from `worktree_add` (`git.rs:109-131`): empty `repo_path`, `worktree_path == repo_path`, `!worktree_path.starts_with(&worktree_root_from_env())`.

**Module-shape analog for `review.rs`** (`git_facts.rs:1-20, 150-185`): header doc stating "stores nothing, caches no verdict"; imports

```rust
use std::path::Path;
use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use crate::branch::epic_integration_branch_name;
use crate::domain::event::{append_event, next_sequence};
use crate::git;
```
Scope resolution to copy (`git_facts.rs:150-200`): `SELECT path, branch FROM worktrees WHERE task_id = ?1` via `.optional()`, `SELECT project_id, epic_id FROM tasks`, epic key/title lookup then `epic_integration_branch_name(&epic_key, &epic_title)`, else `SELECT default_branch FROM projects`. **Deviation for review:** do not prefix `origin/`; and for epic scope prefer `SELECT integration_branch FROM epics` (NULL = no branch cut yet, return a typed `NoIntegrationBranch`, never call `ensure_epic_integration_branch` from a read).

**Event write to copy** (`domain/epic.rs:775-797`, same shape in `domain/worktree.rs:464-475`): `let tx = conn.transaction()?; let sequence = next_sequence(&tx, &project_id, "local")?; let payload = serde_json::json!({"label": ..., ...}); append_event(&tx, &project_id, "local", sequence, "task", task_id, None, epic_id, actor_id, "task.integrated", &payload, &now)?;` Every payload carries `label` so `ActivityTrail.tsx` renders it with no change (`git_facts.rs` `EVENT_OUTSIDE_COMMIT` doc says the same).

**Lock discipline (module header of `forge/mod.rs`, "Fourth")**: functions that shell git take `&Path`/plain values, not `&Connection`; the DB-touching halves are separate (`plan_merge(&Connection)` / `run_merge(&plan)` / `record_merge_event(&mut Connection)`), as in research Code Example 6.

---

### Pair 2: Tauri commands (`commands/review.rs`, `main.rs`, `capabilities/default.json`, `state.rs`)

**Analog:** `packages/desktop/src-tauri/src/commands/git_truth.rs` (DTO + read command) and `commands/forge.rs:216-263` (lock released before CLI).

**DTO + `From` shape** (`git_truth.rs:11-40`):
```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitRowDto { pub sha: String, pub short_sha: String, ... }

impl From<flywheel_core::git_facts::CommitRow> for CommitRowDto {
    fn from(row: flywheel_core::git_facts::CommitRow) -> Self { Self { sha: row.sha, ... } }
}
```
Core crate is referenced as `flywheel_core::...` in the desktop crate (note: tests inside `packages/core` use `core::`).

**Existing sync read command** (`git_truth.rs:73-82`):
```rust
#[tauri::command]
pub fn git_facts(state: State<AppState>, task_id: String) -> Result<Option<GitFactsDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let facts = flywheel_core::git_facts::git_facts_for_task(&conn, &task_id).map_err(|e| e.to_string())?;
    Ok(facts.map(GitFactsDto::from))
}
```

**Shape difference for the new git-shelling commands** (the one thing that changes): attribute becomes `#[tauri::command(async)]`; the body stays a plain sync `pub fn` (no `async fn`, no `.await`) so `State<AppState>` borrowing is unchanged. This is research Assumption A2 — confirm it compiles in the tracer. Trivial SQLite-only commands (e.g. `criterion_check_with_anchor` when it needs no `rev-parse`) stay plain `#[tauri::command]`.

**Lock-drop-then-CLI-then-emit shape to copy** (`commands/forge.rs:222-244`):
```rust
let conn = state.db.lock().map_err(|e| e.to_string())?;
let draft = flywheel_core::forge::request_body::assemble_request_draft(&conn, &task_id).map_err(|e| e.to_string())?;
let project_id: String = conn.query_row("SELECT project_id FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0)).map_err(|e| e.to_string())?;
let (forge, repo_path) = flywheel_core::forge::forge_and_repo_path(&conn, &project_id).map_err(|e| e.to_string())?;
drop(conn);
let result = flywheel_core::forge::create_request_at(forge, &repo_path, &draft);
match result {
    Ok(request) => {
        app.emit("board:changed", serde_json::json!({ "entity": "task", "id": task_id })).ok();
        Ok(ForgeRequestDto::from(&request))
    }
    Err(flywheel_core::forge::ForgeError::CliNotInstalled { cli }) => Err(format!("cliNotInstalled:{cli}")),
    Err(flywheel_core::forge::ForgeError::CliNotAuthenticated { cli }) => Err(format!("cliNotAuthenticated:{cli}")),
    Err(flywheel_core::forge::ForgeError::CliFailed { cli, stderr: cli_err_text }) => {
        eprintln!("forge CLI {cli} failed opening a request for task {task_id}: {cli_err_text}");
        Err(format!("cliFailed:{cli}"))
    }
    Err(flywheel_core::forge::ForgeError::MalformedJson { cli, detail }) => { eprintln!(...); Err(format!("malformedJson:{cli}")) }
}
```
Epic request commands (`forge_epic_request_draft`, `forge_open_epic_request`, `forge_request_for_epic`) copy this verbatim with `epic_id`, `entity: "epic"`, and a `push_branch` call between `drop(conn)` and `create_request_at`. Preview command copies `forge_request_draft` (`forge.rs:186-195`): id only, no title/body/branch accepted.

**Registration** (`main.rs:116-215`): append inside `tauri::generate_handler![ ... ]` after `commands::forge::forge_open_request,` (:215), e.g. `commands::review::review_files,`. Add `pub mod review;` to `commands/mod.rs` in alphabetical position (between `project` and `settings`).

**Capability file** (`capabilities/default.json`): no ACL entry exists for app commands; the `description` string is an auditability roster. Append new command names and one-line safety contracts in the same prose style as the `forge_open_request ... accepts only a task id` sentence. Not enforced; `generate_handler!` is the real boundary.

**`AppState` addition** (`state.rs:15-32`, pattern = `focused_task: Mutex<Option<String>>`): add `pub merge_locks: Mutex<std::collections::HashSet<String>>` plus a `try_lock_epic(&self, epic_id) -> Option<Guard>` helper whose guard removes the id on `Drop`. Initialise in the literal at `main.rs:92-97` (`merge_locks: Mutex::new(Default::default())`). Grep `AppState {` in `src-tauri` and any desktop tests for other literals before editing.

---

### Pair 3: Migration `0018_criterion_anchors.sql`

**Registration site, verbatim** (`packages/core/src/db/mod.rs:36-38`):
```rust
        include_str!("migrations/0016_authoring_proposals_fts.sql"),
        include_str!("migrations/0017_forge_setting.sql"),
    ]
```
Append `        include_str!("migrations/0018_criterion_anchors.sql"),` as the last list element (inside `migration_source_list()`, `db/mod.rs:19-39`). `MIGRATIONS` is built from this list via `M::up` (:57-58); `tests/migration_safety.rs` reads the same list, so no second registration.

**Table-creating migration to copy for style** (`0008_session_summaries.sql`): `CREATE TABLE ... (id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26), ... created_by TEXT NOT NULL REFERENCES actors(id), created_at TEXT NOT NULL);` followed by `CREATE INDEX idx_...`. Latest migration `0017_forge_setting.sql` shows the header-comment idiom: a leading `--` block naming the D-numbers and "Owner decisions closing this schema's shape", with the CHECK constraint being the authority on the vocabulary. Use research's `criterion_anchors` DDL (PK = `criterion_id`, `ON DELETE CASCADE`; `foreign_keys=ON` is applied at `db/mod.rs:68`).

**Related code that must change with it (the easy-to-miss site):** `revise_criterion_in_tx` in `domain/acceptance_criterion.rs` copies `checked` to the successor row (~:510-525); it must also copy the anchor row. `toggle_criterion` (:583-680; transaction at :589, UPDATE at :628-631, event type `"criterion.toggled"` at :669) is the template for `check_criterion_with_anchor`: same `tx` + `resolve_parent_project_id` + `touch` of parent `updated_at` + one event. Unchecking (`new_checked == 0`) must `DELETE FROM criterion_anchors WHERE criterion_id = ?1` in the same `tx`.

**`context_packet.rs:162-164` current text, to widen:**
```rust
const CRITERIA_SQL: &str = "SELECT statement, verification_hint FROM acceptance_criteria \
    WHERE parent_type = 'task' AND parent_id = ?1 AND superseded_at IS NULL \
    ORDER BY rank ASC, id ASC";
```
Widening precedent already exists in the sibling `forge/request_body.rs:32` (`SELECT statement, verification_hint, checked ...`, read at :88-96 as `(String, Option<String>, bool)`). Copy that read; add `LEFT JOIN criterion_anchors`. Keep the literal `&str` (T-01-01/T-01-23: no `format!` SQL).

---

### Pair 4: Frontend surface, keyboard, queries

**Hook-to-Tauri data path to copy** (`board/useBoardQuery.ts:963-1000`, `useGitFacts`; `:1002-1040`, `useForgeRequest` which adds `staleTime: 0`):
```ts
export function useForgeRequest(taskId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = taskId ? forgeRequestQueryKey(taskId) : (["forge-request", "none"] as const);
  useEffect(() => {
    if (!taskId) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey: forgeRequestQueryKey(taskId) }))
      .then((fn) => { if (cancelled) fn(); else unlisten = fn; });
    return () => { cancelled = true; unlisten?.(); };
  }, [taskId, queryClient]);
  return useQuery({ queryKey, queryFn: () => forgeRequestForTask(taskId as string), /* staleTime: 0, enabled: Boolean(taskId) */ });
}
```
Review hooks: `useReviewFiles(scope, itemId)` and `useReviewCriteriaState(...)` copy this (key, subscribe, `staleTime: 0`). `useReviewPatch(scope, itemId, path, oldPath, enabled)` is the lazy one: `enabled` flips true when the file is expanded; no board subscription needed beyond the shared invalidate.

**Adapter wrapper to copy** (`adapters/tauri.ts:1273-1288`): `export async function forgeRequestDraft(taskId: string): Promise<RequestDraftDto> { return invokeCommand<RequestDraftDto>("forge_request_draft", { taskId }); }` with the DTO interface declared directly above, field-for-field with the Rust `#[serde(rename_all = "camelCase")]` struct. Components never import `invoke`; the header (`tauri.ts:1-9`) makes this rule load-bearing.

**Absence-is-the-design** (`GitFactsSection.tsx` header): render `null` while loading or when absent. For `ReviewSurface` panes: file list renders nothing during load; diff pane renders nothing for an unopened file; criteria rail always renders a header (copy `AcceptanceCriteriaList`, which does so).

**uiStore field (one field, one writer)** — mirror `triageSurfaceProjectId` at `uiStore.ts:191` (state type), `:237` (setter type), `:261` (initial `null`), `:340` (`setTriageSurfaceProjectId: (projectId) => set({ triageSurfaceProjectId: projectId })`), and the reset literal at `:371`. Add `reviewSurface: { scope: "task" | "epic"; itemId: string } | null` + `setReviewSurface` at the same five places.

**Keyboard registration (verbatim sites in `state/keyboard.ts`):**
- `FocusRegion` union (:21-34): add `| "review-surface"`.
- `UiLayer` union (:406-416): add `| "review-surface"`.
- `ActionId` (:42+): add `"open-review"` next to `"start-work"` (:71) and any review-only ids.
- `BINDINGS`: `{ id: "start-work", region: "board-list", key: "w", label: "Start Work" },` (:175) → new `{ id: "open-review", region: "board-list", key: "v", label: "Review" },`. `v` is unused in board-list. Triage's per-region entries (:238-256) are the template for `region: "review-surface"` entries: note reuse of `move-down`/`move-up` ids with both `j`/`ArrowDown` and `k`/`ArrowUp` rows (:243-246).
- Gate: add `const REVIEW_SURFACE_ACTION_IDS = new Set<ActionId>([...])` beside `TRIAGE_SURFACE_ACTION_IDS` (:476) and in `bindingAllowedInLayer` (:486) add, before the final `return`: `if (REVIEW_SURFACE_ACTION_IDS.has(id)) return layer === "review-surface";`. Careful: `move-down`/`move-up` are already ids in the triage and tray sets, so the review layer needs its own `if (layer === "review-surface") return REVIEW_SURFACE_ACTION_IDS.has(id);` branch placed like the triage one (:496-498) to avoid falling through to `layer === "board" || ...`. `open-review` itself falls through to the final line (board/quick-add only), which is correct.
- Do **not** edit `topLayer` (:430). Surfaces name their own layer.

**Surface-local key registration** (`triage/TriageSurface.tsx:329-334`):
```tsx
useRegionBindings("triage-surface", "triage-surface", {
  "move-down": () => setFocusedId((current) => nextSelectionId(flatRows, current, 1)),
  "move-up": () => setFocusedId((current) => nextSelectionId(flatRows, current, -1)),
  ...
});
```
`useRegionBindings(region, layer, handlers)` is defined at `keyboard.ts:710-727`. Copy for `useRegionBindings("review-surface", "review-surface", {...})`. Keep `AcceptanceCriteriaList`'s own local `onKeyDown` (j/k, Space/Enter, n, e) by composing it in the rail.

**`App.tsx` chain** (`App.tsx:259-296`): insert a `reviewSurface ? (<ReviewSurface .../>)` branch after the `triageSurfaceProjectId ? (...)` branch (:265-276) and before `activeAgentRunId ? (` (:277). Handler for "start resolve session" copies the triage one exactly: `onOpenSession={(agentRunId, epicId, logOffset) => { setTriageSurfaceProjectId(null); setActiveAgentRunId(agentRunId, null, null, epicId, logOffset); }}` → clear `reviewSurface` before `setActiveAgentRunId`. Subscribe with `useUiStore((state) => state.reviewSurface)` like :115-116. Wrap import in `React.lazy` (research Pitfall 8).

**Entry points:**
- `ItemDetailPanel.tsx`: prop declared at :70 (`onStartWork?: () => void;`), destructured at :93, button at :228-233 (`item.kind === "task" && (<button type="button" onClick={onStartWork} className="type-body" style={{ alignSelf: "flex-start", background: "var(--accent-nontext)", ...`). Add `onReview?: () => void` beside it. Review is offered for tasks and epics.
- `BoardView.tsx:631-637`: `case "start-work": if (selectedId && selectedItem && (selectedItem.kind ?? "task") === "task") { setLaunchSheetTaskId(selectedId); } break;` → add `case "open-review":` calling `setReviewSurface({ scope: ..., itemId: selectedId })`. Unlike `start-work`, allow epic rows too (epic scope).
- Session finish offer: `session/SessionSurface.tsx:68`, `const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted"];`.
- Palette: `CommandPalette.tsx` ~:284-297 where `setDetailItemId(resolution.itemId)` is called for a resolved git identifier.

**Legend** (`legend/marks.ts:183-195`, `criterion-checked`/`criterion-unchecked` entries; `MarkChannel` closed union at :13 — `"criteria"` already exists): add `integrated`, `criterion-no-evidence`, `criterion-anchor-stale`, `criterion-anchor-fresh` entries with `id`, `channel`, `label`, `meaning`. A test elsewhere enforces "no mark may exist that the legend does not define"; add the entries in the same change that introduces the rendering.

---

### Pair 5: Rust integration tests

**Fixture:** `tests/common/mod.rs::seeded_git_project()` (:49-88) returns `(Connection, actor_id, Project, TempDir)` — a real `git init --initial-branch=main` repo with one commit, a migrated scratch SQLite, and a project with key prefix `FLY`, default branch `main`. Usage: `let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();` then `repo_dir.path()` is the repo path. The repo has identity configured (`fixture@flywheel.test`) so merges/commits work.

**Not yet in `common/mod.rs`** (Wave 0 gap): a helper that makes diverging branches. Copy the local `run_git_ok` / `init_repo`-style helpers from `tests/git_facts.rs:21-52` (`Command::new("git").arg("-C").arg(repo).args(args).output()` + assert success) — tests may construct `Command::new("git")` because `supervisor_cwd.rs` scans only `packages/core/src` and `src-tauri/src`, not `tests/`. Put the shared "clean pair + conflicting pair" builder in `common/mod.rs`.

**`FLYWHEEL_WORKTREE_ROOT` pattern, two variants in the repo:**
1. Simple (`tests/worktree_lifecycle.rs:15-24`): `tempfile::tempdir()`, `unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) }`, run, `remove_var`.
2. Serialised (`tests/forge_live_chain.rs:45-58`; `forge_request_body.rs` has its own): a `static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()>` taken with `.lock().unwrap_or_else(|p| p.into_inner())` for the whole closure. **Use variant 2** in all four new files, since `cargo test` runs `#[test]`s concurrently within one binary; each `tests/*.rs` is its own binary so the static is per-file.

**Test-file imports/conventions to copy** (`worktree_lifecycle.rs:1-12`): header doc stating behaviors, `mod common;`, `use core::domain::epic::create_epic; use core::domain::task::create_task; use core::domain::worktree::ensure_worktree;` (crate name is `core` inside `packages/core/tests`). Event counting: copy `count_events_of_type` (`forge_live_chain.rs:61-67`, using `core::query::events::activity_trail`).

**`review_merge.rs` specifics:** create epic, `ensure_epic_integration_branch` (`domain/epic.rs`, cuts the local branch at :767) to get a real integration branch, task worktrees via `ensure_worktree`; assert after a conflicted merge: `git status --porcelain` in the epic worktree is empty, `rev_parse_verify(wt, "MERGE_HEAD")` is false, an event of type `task.integrated`-family exists, and the task's `status` column is unchanged (D-145).

**`epic_request_draft.rs`:** analog is `tests/forge_request_body.rs` (same determinism assertion: two calls byte-identical, CTX-04) — copy its structure and swap in `assemble_epic_request_draft`. Fake-`gh` extension for the push+open flow: `forge_live_chain.rs` (`ENV_LOCK` at :52, fake CLI writer, `PATH` prepend, `create_request_at` call).

**`criterion_anchors.rs`:** analog `tests/criteria.rs` / `criteria_pin.rs` (criterion create/toggle/revise against a seeded project). Must cover: server-resolved sha; uncheck clears anchor; locked-criterion revise copies anchor; `DELETE FROM acceptance_criteria` cascades; rename -> stale (Pitfall 9).

**Standing gate:** run `cargo test -p core --test supervisor_cwd` per task commit (research validation map).

---

### Pair 6: Frontend tests (`packages/desktop/src/review/__tests__/`)

**Analog:** `item-detail/__tests__/forge-section.test.tsx` and `git-facts-section.test.tsx`. Copy exactly:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ForgeSection } from "../ForgeSection";
import type { ForgeReadDto, ... } from "../../adapters/tauri";

const forgeRequestForTaskMock = vi.fn();
let boardChangedHandler: (() => void) | undefined;

vi.mock("../../adapters/tauri", () => ({
  forgeRequestForTask: (taskId: string) => forgeRequestForTaskMock(taskId),
  forgeOpenRequest: (taskId: string) => forgeOpenRequestMock(taskId),
  subscribeBoardChanged: (handler: () => void) => {
    boardChangedHandler = handler;
    return Promise.resolve(() => {});
  },
}));

function renderSection(taskId = "task-1") {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}><ForgeSection taskId={taskId} /></QueryClientProvider>);
}
```
Three conventions to carry: (1) the module mock lists **only** the adapter functions the component under test may call, so an unexpected call (e.g. a status setter) fails as "is not a function" (`forge-section.test.tsx` header documents this as the structural "sets no status itself" check); (2) a `baseDraft(overrides)`-style typed factory for DTOs; (3) a header docblock enumerating "Behavior under test". For the epic sheet, assert `forgeOpenEpicRequest` is called with the epic id alone (mirrors the "id alone, never title or body" assertion in `forge-section.test.tsx`). Render keyboard-driven components inside the same `QueryClientProvider` wrapper; for `ReviewSurface` also mock `useUiStore` or set it directly.

**New to this phase (no analog):** `highlight.test.ts` asserting `.token.keyword` spans for a `.rs` patch; no existing test renders `react-diff-view`.

---

## Shared Patterns

### Single git construction site
**Source:** `packages/core/src/git.rs:43-54` (`spawn_git`), gate `packages/core/tests/supervisor_cwd.rs`
**Apply to:** every new git call in `git.rs`, `review.rs`, `request_body.rs`, `commands/review.rs`. Never `Command::new("git")` anywhere else; never `.current_dir(...)`; never `env::current_dir`.

### Lock hygiene around git and CLI calls
**Source:** `commands/forge.rs:222-244` (resolve under lock, `drop(conn)`, run CLI, emit), module header of `forge/mod.rs` ("Fourth")
**Apply to:** `review_merge_task`, `review_files`, `review_patch`, epic request commands. Re-lock only to append the event.

### Event-per-mutation with `label`
**Source:** `domain/epic.rs:775-797`; `domain/acceptance_criterion.rs:669` (`"criterion.toggled"`)
**Apply to:** merge success, merge conflict-abort, check-with-anchor. `next_sequence` + `append_event` inside the same `tx`; then `app.emit("board:changed", ...)` from the command after commit.

### IPC boundary errors
**Source:** `commands/forge.rs:246-261`
**Apply to:** all new commands. `Result<T, String>`; stringify `anyhow` with `e.to_string()`; ForgeError becomes `"<category>:<cli>"`; raw stderr goes to `eprintln!` only. Conflict file paths ARE allowed across IPC (research), raw git stderr is not.

### Derive at read time, never store verdicts
**Source:** `git_facts.rs` header, `useForgeRequest` doc (`useBoardQuery.ts:1007-1015`)
**Apply to:** anchor staleness, "integrated" marker, dirty banner. `staleTime: 0` plus `subscribeBoardChanged` invalidation.

### Renderer passes ids only
**Source:** `forge_request_draft` / `forge_open_request` signatures (`commands/forge.rs:186-221`)
**Apply to:** every review command: `scope` + id (+ file path for a patch). Refs, repo path, shas, titles, bodies are derived server-side.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `packages/desktop/src/review/highlight.ts` | utility | transform | No diff or syntax-highlight code exists in the workspace (CONTEXT D-135 states this). Use research Pattern 4 / "Code Examples" adapter (`refractor/core` + per-language imports + `.highlight(...).children` adapter). |
| `packages/desktop/src/review/FileDiff.tsx` (the `react-diff-view` wiring itself) | component | transform | Same reason; reuse only shell conventions from `ForgeSection.tsx`. Use research Pattern 4 (`widgets`, `selectedChanges`, `gutterEvents`; not `Decoration`). |
| per-epic merge guard (`try_lock_epic`) | state | event-driven | No `HashSet`-keyed in-process lock exists; nearest is `focused_task: Mutex<Option<String>>`. `git_retry::SpawnFloor::wait_turn` is spacing-only (`git_retry.rs:~229-272`), not a mutex. |
| conflict-abort path in `merge_no_ff` | service | request-response | No prior git write in the codebase leaves a recoverable in-progress state; closest is `domain/worktree.rs:447-458` (prune-then-add recovery). Follow research Code Example 4. |

## Metadata

**Analog search scope:** `packages/core/src`, `packages/core/tests`, `packages/desktop/src-tauri/src`, `packages/desktop/src` (item-detail, board, state, triage, session, adapters, legend)
**Files scanned:** ~35 opened or grepped; all cited paths verified tracked via `git ls-files`
**Pattern extraction date:** 2026-10-06
