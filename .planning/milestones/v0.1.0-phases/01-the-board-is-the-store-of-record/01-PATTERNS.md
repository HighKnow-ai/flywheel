# Phase 1: The Board Is The Store Of Record — Pattern Map (Gap Closure G-01-2)

**Mapped:** 2026-09-10
**Scope:** Gap-closure only (`--gaps`). G-01-2 — epic labels/filter chips/parent options are
derived from the windowed `board_list` page instead of the project's full epic set.
**Files analyzed:** 9
**Analogs found:** 9 / 9 (all analogs are existing, git-tracked files already shipped in Phase 1)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/query/mod.rs` (new `list_all_epics` fn, or new `epics.rs` submodule) | service (query) | CRUD (read, unbounded-by-window) | `packages/core/src/domain/actor.rs::list_actors` | exact — same shape: unbounded small-table list, no filter/cursor |
| `packages/desktop/src-tauri/src/commands/epic.rs` (new `epic_list_all` command) | controller (Tauri command) | request-response | `packages/desktop/src-tauri/src/commands/actor.rs::actor_list` | exact — same DTO-wrapping, no-mutation, `State<AppState>`-only signature |
| `packages/desktop/src-tauri/src/main.rs` (register new command) | config (invoke_handler registration) | request-response | existing `commands::epic::epic_*` / `commands::actor::actor_list` entries at lines 75-82, 88-89 | exact |
| `packages/desktop/src/adapters/tauri.ts` | — (no new export needed) | — | N/A — `invokeCommand` is already generic; no new adapter function required | n/a |
| `packages/desktop/src/board/useBoardQuery.ts` (new `useEpics(projectId)` hook) | hook | request-response (TanStack Query) | `useActors()` (lines 289-294) | exact — same "small roster, rarely changes, no polling" shape |
| `packages/desktop/src/board/BoardView.tsx` (`epicsById` derivation) | component | transform (derived lookup table) | itself, pre-fix — will switch from `items.filter(i => i.kind === "epic")` (lines 258-264) to consuming `useEpics()`'s query result the same way `actorsById` already consumes `useActors()` (lines 248-251) | exact — `actorsById` in the same file is the correct pattern to copy |
| `packages/desktop/src/board/BoardRow.tsx` (`epicLabel` fallback) | component | transform | itself, pre-fix (lines 119-120) — fallback changes from raw `item.epicId` ULID to the resolved label once `epicsById` is complete | exact |
| `packages/desktop/src/board/FilterBar.tsx` (`epicOptions`) | component | transform | itself, pre-fix (lines 81-90) — switches from deriving off `items` prop to consuming `useEpics()`, mirroring how it already consumes `useActors()` for the assignee chips (lines 78-79) | exact |
| `packages/desktop/src/board/BoardView.tsx` (epic options for `ParentPicker`, ~line 840) | component | transform | itself, pre-fix — same `items.filter(item => item.kind === "epic")` derivation, same fix | exact |
| Frontend test: new volume test above `DEFAULT_LIMIT` | test | N/A | `packages/desktop/src/board/__tests__/filter.test.tsx` | role-match — closest existing frontend test exercising `BoardView`/`FilterBar` epic-derivation behavior |
| Rust test: new core query test | test | N/A | `packages/core/tests/search_filter.rs` (filter-query tests) + `packages/core/tests/perf_seed_1000.rs` (volume fixture) | exact — `perf_seed_1000.rs` is the volume-seeding analog; `search_filter.rs` is the assertion-style analog |

## Pattern Assignments

### 1. `packages/core` — new unbounded epic-listing query

**Analog:** `packages/core/src/domain/actor.rs::list_actors` (lines 69-83)

This is the correct analog, not `query::list_board`, because the new function must NOT be
`LIMIT`-bounded or cursor-paginated — epics are a small table (tens, not thousands, even on a
1,067-item board per the gap report: "showed 4 of 13 epics"), and the whole point of the fix is
"resolve against the project's full epic set," not another windowed page.

**Core pattern to copy** (`packages/core/src/domain/actor.rs` lines 69-83):
```rust
pub fn list_actors(conn: &Connection) -> anyhow::Result<Vec<Actor>> {
    let mut stmt = conn.prepare(
        "SELECT id, type, display_name FROM actors ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Actor {
                id: row.get(0)?,
                actor_type: row.get(1)?,
                display_name: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list actors")
}
```
Write the new function as `list_all_epics(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<EpicSummary>>` (or reuse `domain::epic::Epic`/a lighter summary struct — `id, key, title` is enough for label resolution, matching what `BoardRow.tsx`/`FilterBar.tsx`/`ParentPicker` actually need). Scope by `project_id` (actors are global; epics are not) and order by `rank ASC, id ASC` to match the board's own tie-break rule (`query/mod.rs` `ORDER_BY`, D-11), not `created_at`.

Place it in `packages/core/src/domain/epic.rs` beside `create_epic`/`update_epic` (same file `epic.rs` command already calls into) — do not put it in `query/mod.rs`, since `query/mod.rs`'s own doc comment (lines 1-23) frames that module specifically around the *bounded, cursor-resumable* board window; an unbounded full-list query belongs with the rest of the epic domain functions, the same way `list_actors` sits in `domain/actor.rs` rather than in `query/`.

**Naming/doc-comment convention to copy** (from `query/mod.rs` line 38 and `domain/epic.rs`'s module header): explain *why* this one query is unbounded where every other board read (D-03) is windowed — one sentence citing G-01-2 is enough, mirroring how `perf_seed_1000.rs`'s header cites its own plan/requirement.

### 2. `packages/desktop/src-tauri/src/commands/epic.rs` — new `epic_list_all` command

**Analog:** `packages/desktop/src-tauri/src/commands/actor.rs` (full file, 34 lines) — copy this file's shape exactly, not `board.rs::board_list`'s (which carries filter/cursor/limit machinery this command must NOT have).

```rust
// packages/desktop/src-tauri/src/commands/actor.rs — the exact shape to mirror
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorDto {
    pub id: String,
    pub actor_type: String,
    pub display_name: String,
}

impl From<flywheel_core::domain::actor::Actor> for ActorDto { /* ... */ }

#[tauri::command]
pub fn actor_list(state: State<AppState>) -> Result<Vec<ActorDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let actors = flywheel_core::domain::actor::list_actors(&conn).map_err(|e| e.to_string())?;
    Ok(actors.into_iter().map(ActorDto::from).collect())
}
```
New command: `epic_list_all(state: State<AppState>, project_id: String) -> Result<Vec<EpicSummaryDto>, String>` in `commands/epic.rs`, added after the existing DTO/`From` impl block (lines 13-39) — reuse the existing `EpicDto` struct if the summary needs `status`/`priority`/`rank` too (cheap, avoids a second DTO type), or add a smaller `EpicSummaryDto { id, key, title }` if payload size at scale matters. No `AppHandle`/`app.emit` param — this is a pure read, exactly like `actor_list`, never a mutation, so it must not follow the `epic_create`/`epic_update` shape (which all take `app: AppHandle` and emit `board:changed`).

**Registration** — copy the existing block shape in `main.rs`:
```rust
// main.rs lines 75-89 — append the new command inside the same generate_handler! list
commands::epic::epic_create,
commands::epic::epic_update,
commands::epic::epic_delete,
commands::epic::epic_set_status,
commands::epic::epic_reorder,
commands::epic::epic_set_priority,
commands::epic::epic_set_estimate,
commands::epic::epic_set_assignee,
commands::epic::epic_list_all,   // <-- new, grouped with the other epic_* commands
...
commands::board::board_list,
commands::board::board_search,
```

### 3. `packages/desktop/src/adapters/tauri.ts` — no new export required

`invokeCommand<TResult>(command, args)` (lines 18-23) is already fully generic — no wrapper needed for a new command, mirroring how `useActors()` calls `invokeCommand<Actor[]>("actor_list")` directly without any adapter-level helper. Do not add an `epic`-specific adapter function; that would violate the single-seam rule the module's own doc comment states (lines 1-9).

### 4. `packages/desktop/src/board/useBoardQuery.ts` — new `useEpics(projectId)` hook

**Analog:** `useActors()` (lines 287-294) — copy verbatim shape:
```typescript
/** Every actor (human, agent, system) — the `AssigneePicker`'s roster (BOARD-06). Actors are
 * seeded at migration time and rarely change, so this query has no need to poll. */
export function useActors() {
  return useQuery({
    queryKey: ["actors"],
    queryFn: () => invokeCommand<Actor[]>("actor_list"),
  });
}
```
New hook:
```typescript
export interface EpicSummary {
  id: string;
  key: string;
  title: string;
}

/** Every epic in the project (G-01-2) — the full set, not the currently-loaded board window.
 * `BoardView.tsx`'s `epicsById`, `FilterBar.tsx`'s `epicOptions` and `BoardView.tsx`'s
 * `ParentPicker` epic options all resolve against this instead of `items.filter(i => i.kind ===
 * "epic")`, which only ever saw whichever epics happened to be in the last `board_list` page. */
export function useEpics(projectId: string | undefined) {
  return useQuery({
    queryKey: ["epics", projectId],
    queryFn: () => invokeCommand<EpicSummary[]>("epic_list_all", { projectId }),
    enabled: Boolean(projectId),
  });
}
```
Also add `"epics"` to the query keys `useBoardChangedSubscription` invalidates (lines 424-445, currently only invalidates `["board"]`) so epic creation/rename/delete pushed via `board:changed` refreshes this roster too — otherwise a newly-created epic won't appear in the filter chips until a manual refetch. Mirror the same broad invalidation style already used there.

### 5. `packages/desktop/src/board/BoardView.tsx` — `epicsById` derivation

**Analog:** the file's own `actorsById` (lines ~248-251), which is already correctly sourced from `useActors()` rather than from `items`:
```typescript
() => Object.fromEntries(actors.map((actor) => [actor.id, actor])),
[actors],
```
Change `epicsById` (lines 258-264) from:
```typescript
const epicsById = useMemo<Record<string, BoardItem>>(
  () =>
    Object.fromEntries(
      items.filter((item) => item.kind === "epic").map((epic) => [epic.id, epic]),
    ),
  [items],
);
```
to source from `useEpics(projectId).data ?? []` the same way `actorsById` sources from `useActors()`'s `actors` variable — call `useEpics` where `useActors` is already called in this component and build `epicsById` off its result instead of `items`.

Also fix the `ParentPicker` epic-options block (~line 840, same pattern):
```typescript
// current (windowed):
const epicOptions: ParentOption[] = items
  .filter((item) => item.kind === "epic" && item.id !== pickedRow.id)
  .map((epic) => ({ id: epic.id, label: `${epic.key} ${epic.title}` }));
```
becomes a derivation off the full `useEpics()` result, filtering out `pickedRow.id`, same shape.

### 6. `packages/desktop/src/board/BoardRow.tsx` — `epicLabel` fallback

**Analog:** itself, pre-fix (lines 119-120):
```typescript
const epic = item.epicId ? epicsById?.[item.epicId] : undefined;
const epicLabel = item.epicId ? (epic ? `${epic.key} ${epic.title}` : item.epicId) : (epicMark?.label ?? "No epic");
```
Once `epicsById` (passed down as a prop from `BoardView.tsx`, line 82/102) is built from the full project epic set rather than the windowed page, the `: item.epicId` raw-ULID fallback becomes dead code for any epic that actually exists — leave the fallback in place (defense-in-depth for a genuinely-deleted/unreachable epic id) but it should no longer be reachable in the reported bug's scenario. No structural change needed here beyond what `epicsById`'s new source provides; do not special-case this file.

### 7. `packages/desktop/src/board/FilterBar.tsx` — `epicOptions`

**Analog:** the same file's `actors`/assignee-chip derivation, which already calls `useActors()` directly (lines 78-79):
```typescript
const actorsQuery = useActors();
const actors = actorsQuery.data ?? [];
```
Change `epicOptions` (lines 81-90) from:
```typescript
const epicOptions = useMemo(() => {
  const seen = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "epic") {
      seen.set(item.id, `${item.key} ${item.title}`);
    }
  }
  return Array.from(seen.entries());
}, [items]);
```
to:
```typescript
const epicsQuery = useEpics(projectId);
const epicOptions = useMemo(
  () => (epicsQuery.data ?? []).map((epic) => [epic.id, `${epic.key} ${epic.title}`] as const),
  [epicsQuery.data],
);
```
Note `FilterBar.tsx` currently receives `items` as a prop specifically to derive this list (its own doc comment lines 11-14 documents the exact limitation this gap report identifies) — `projectId` must be threaded into `FilterBarProps` if not already present, mirroring how `useActors()` needs no project scoping but this new `useEpics(projectId)` does. Update/remove the module doc comment's "known simplification" paragraph (lines 11-14) once fixed — it currently documents the bug as an accepted limitation.

## Shared Patterns

### "Small unbounded roster" query/command/hook triad
**Source:** `domain::actor::list_actors` → `commands::actor::actor_list` → `useActors()`
**Apply to:** the new epic-listing path end to end (`domain::epic::list_all_epics` → `commands::epic::epic_list_all` → `useEpics()`). This triad is the established, already-shipped pattern for "the UI needs the complete small table, not a windowed page of the board" — exactly G-01-2's fix. Do not reuse `board_list`/`useBoardQuery`'s windowed/cursor/filter machinery for this at all; that machinery is D-03's answer to a different problem (the 1,000+ item board itself), and epics are not at that scale.

### Push-invalidation coverage
**Source:** `useBoardChangedSubscription` (`useBoardQuery.ts` lines 424-445)
**Apply to:** add `["epics", ...]` (or a plain `["epics"]` prefix invalidation) alongside the existing `["board"]` invalidation so the new roster stays live per D-04 — an epic created, renamed or deleted must refresh both the windowed board and this new unbounded roster.

## No Analog Found

None — every file in scope has a strong, already-shipped analog in the same codebase (the `actor_list`/`useActors` triad and each affected component's own pre-fix code).

## Metadata

**Analog search scope:** `packages/core/src/domain/`, `packages/core/src/query/`, `packages/desktop/src-tauri/src/commands/`, `packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src/adapters/`, `packages/desktop/src/board/`, `packages/core/tests/`, `packages/desktop/src/board/__tests__/`
**Files scanned:** ~20 (read in full or targeted ranges)
**Pattern extraction date:** 2026-09-10
**Tracked-source gate:** all analog paths above (`packages/core/src/domain/actor.rs`, `packages/desktop/src-tauri/src/commands/actor.rs`, `packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src/board/useBoardQuery.ts`, `packages/desktop/src/board/BoardView.tsx`, `packages/desktop/src/board/BoardRow.tsx`, `packages/desktop/src/board/FilterBar.tsx`, `packages/core/tests/perf_seed_1000.rs`, `packages/core/tests/common/mod.rs`, `packages/desktop/src/board/__tests__/filter.test.tsx`) are ordinary tracked source files in this repository's own `packages/` tree — none are gitignored mirrors.

## Test Conventions

### Rust core test (new query test)
**Analog for assertions:** `packages/core/tests/search_filter.rs` (filter-correctness style — assert exact result sets/counts against a `BoardFilter`).
**Analog for volume seeding:** `packages/core/tests/perf_seed_1000.rs` + its shared fixture `packages/core/tests/common/mod.rs::seed_project(conn, n)`. `seed_project` builds `n` tasks (not epics) spread across five statuses via a single transaction of literal `INSERT`s that go through the same base-table path `create_task` uses (so FTS5 triggers fire correctly, per Pitfall 3). For a G-01-2 regression test, extend `common/mod.rs` with an epic-seeding equivalent (e.g. `seed_epics(conn, project_id, n)` inserting directly into `epics` the same literal-`INSERT`-in-one-transaction way) so a test can assert `list_all_epics` returns all 13+ (or 1,000+) epics regardless of `board_list`'s `DEFAULT_LIMIT = 200` window — this is the concrete regression the gap describes ("showed 4 of 13 epics on a real 1,067-item board").
**Fixture pattern to copy** (`packages/core/tests/perf_seed_1000.rs` lines 26-34):
```rust
fn fresh_seeded_1000() -> (rusqlite::Connection, String) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    std::mem::forget(dir);

    let mut conn =
        core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let project_id = seed_project(&mut conn, 1000).expect("seed_project should succeed");
    (conn, project_id)
}
```

### Frontend test (new volume/derivation test)
**Analog:** `packages/desktop/src/board/__tests__/filter.test.tsx` — uses `renderWithQueryClient` wrapping `QueryClientProvider`, `resetUiState()` in `beforeEach`, and asserts on rendered DOM (`screen.getByText`/`getByRole`) rather than on internal state. For G-01-2's regression test, mock `invokeCommand("epic_list_all", ...)` (or the underlying `@tauri-apps/api/core` `invoke`) to return more epics (e.g. 13) than a mocked `board_list`/`items` prop would ever surface (e.g. only 4 distinct epics represented in the windowed `items`), then assert `FilterBar`'s epic chip list and `BoardRow`'s epic label both resolve to the full set / a readable label — not the raw ULID fallback — proving the fix is sourced from `useEpics()` and not from `items`.
