---
phase: 01-the-board-is-the-store-of-record
reviewed: 2026-09-10T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - packages/core/src/domain/epic.rs
  - packages/core/src/query/mod.rs
  - packages/core/tests/common/mod.rs
  - packages/core/tests/epic_roster.rs
  - packages/desktop/src-tauri/src/commands/epic.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/FilterBar.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/board/__tests__/board-view.test.tsx
  - packages/desktop/src/board/__tests__/epic-assign.test.tsx
  - packages/desktop/src/board/__tests__/epic-roster.test.tsx
  - packages/desktop/src/board/__tests__/filter.test.tsx
  - packages/desktop/src/board/__tests__/issue-parent.test.tsx
  - packages/desktop/src/board/__tests__/layer-guard.test.tsx
  - packages/desktop/src/legend/marks.ts
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the G-01-2 gap-closure change set: `domain::epic::list_epics` (Rust core), the `epic_list_all`
Tauri command, and the `useEpics` React Query hook plus its three consumers (`BoardRow`'s epic pill,
`FilterBar`'s epic chips, and both `ParentPicker` option lists).

On the specific risk axes called out for this review, the implementation holds up:

- **SQL injection / parameter binding:** `list_epics` binds `project_id` exclusively through
  `params![project_id]`; the only string concatenation performed (`[&str]::concat`, not `format!` or
  the crate's grep-gated interpolation macro) joins two compile-time literals (`ORDER_BY` and the
  base `SELECT`), never a runtime value. No injection surface.
- **Project scoping:** `list_epics`'s `WHERE b.project_id = ?1` is exercised directly by
  `roster_is_scoped_to_one_project` in `epic_roster.rs`, which asserts a second project's epic ids
  are never present in the first project's roster. Confirmed correct by reading, not just by the
  test's existence.
- **Genuinely read-only:** `epic_list_all` takes no `AppHandle`, emits no `board:changed`, opens no
  transaction, and calls only `list_epics(&conn, ...)` against a non-`mut` `Connection` borrow. The
  Rust-side idempotency test (`roster_repeats_exactly_and_writes_nothing`) independently confirms no
  event row and no `updated_at` mutation.
- **Raw ULID leakage:** Every path that resolves an epic id against the roster (`BoardRow`'s pill,
  `FilterBar`'s chips, both `ParentPicker` option lists, `IssuesLane`'s parent button via
  `parentsById`) falls back to a static "Unknown epic"/"No epic" label — never to `item.epicId`
  itself — and `epic-roster.test.tsx`'s dedicated leak test additionally checks every DOM attribute,
  not just text content, for the raw id.

The issues found below are in the surrounding plumbing: two gaps in how the new `useEpics` query
interacts with React Query's caching/invalidation model (a project-switch flash and an invisible
error state), an asymmetric cache-invalidation pattern versus the rest of the mutation hooks, and one
dead export with an inaccurate doc comment.

## Warnings

### WR-01: The epic roster can flash "Unknown epic" for valid epics during a project switch

**File:** `packages/desktop/src/board/useBoardQuery.ts:322-328`
**Issue:**
`useBoardQuery` (line 207) explicitly sets `placeholderData: keepPreviousData` so the previously
loaded board window stays on screen while a new project's `board_list` call is in flight (the
"never re-skeletons on a refetch" contract, per its own doc comment). `useEpics` has no such option:

```ts
export function useEpics(projectId: string | undefined) {
  return useQuery({
    queryKey: epicsQueryKey(projectId),
    queryFn: () => invokeCommand<EpicSummary[]>("epic_list_all", { projectId }),
    enabled: Boolean(projectId),
  });
}
```

When `currentProjectId` changes in `App.tsx`, `useBoardQuery`'s query key changes but its `data`
stays pinned to the outgoing project's window until the new `board_list` resolves. `useEpics`'s query
key also changes, but — lacking `keepPreviousData` — its `data` immediately becomes `undefined`
(assuming the new project's roster was never cached before), so `epicsById` in `BoardView.tsx`
(line 263) collapses to `{}` for one or more render cycles. Every task belonging to the *outgoing*
project that is still on screen (because of `useBoardQuery`'s own `keepPreviousData`) and that
carries a real, previously-resolved `epicId` will render `BoardRow`'s "Unknown epic" fallback
(`BoardRow.tsx:132`) for that window, even though the epic is entirely valid — this is exactly the
class of defect G-01-2 exists to close, reintroduced transiently at every project switch. Before this
plan, the roster was derived from the same `items` array the row itself came from, so the two never
went out of sync this way; decoupling them without matching the caching strategy created this new
seam.

No test in the reviewed suite exercises a project switch (every test in `epic-roster.test.tsx` and
`epic-assign.test.tsx` renders a single, static `projectId`), so this regression has no test coverage
either way.

**Fix:**
```ts
export function useEpics(projectId: string | undefined) {
  return useQuery({
    queryKey: epicsQueryKey(projectId),
    queryFn: () => invokeCommand<EpicSummary[]>("epic_list_all", { projectId }),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  });
}
```
(`keepPreviousData` is already imported into this file for `useBoardQuery`.) Add a test that renders
`BoardView` with project A's roster resolved, switches `projectId` to B before B's `epic_list_all`
mock resolves, and asserts A's previously-resolved epic pill is not replaced by "Unknown epic" in the
interim.

### WR-02: A failed epic-roster fetch is indistinguishable from "this epic doesn't exist"

**File:** `packages/desktop/src/board/useBoardQuery.ts:322-328`, `packages/desktop/src/board/FilterBar.tsx:91-95`, `packages/desktop/src/board/BoardView.tsx:261-266`
**Issue:**
None of `useEpics`'s three consumers read `epicsQuery.isError`/`epicsQuery.error`. `FilterBar`
(line 92: `epicsQuery.data ?? []`) and `BoardView` (line 262: `epicsQuery.data ?? []`) both treat "no
data" identically whether the query is still pending, has genuinely resolved to an empty roster, or
has exhausted React Query's default retries (3, with backoff) and settled into an error state. In
practice this means: if `epic_list_all` starts failing (a locked/corrupted database, a
serialization bug in a future change to `EpicSummaryDto`, etc.), the user sees every epic pill
silently degrade to "Unknown epic," the epic filter chips silently disappear, and both `ParentPicker`
epic groups silently go empty — with no error banner, no console-visible-to-the-user signal, nothing
that distinguishes this from a project that legitimately has zero epics. This is a materially
different failure mode than the one `App.tsx` already established a pattern for: `registerNotice`
(App.tsx:97-123) explicitly surfaces `useRegisterProjectFlow`'s `isError`/`error` via a fixed-position
toast, specifically because (per that code's own comment) a previous version "discarded them entirely,
leaving the ... picker closing with zero feedback." `useEpics` reintroduces the same class of silent
failure this codebase has already had to fix once elsewhere.

**Fix:** Surface `epicsQuery.isError` somewhere reachable regardless of which component happens to be
mounted — e.g. a small persistent indicator in `FilterBar` (which is always visible whenever a board
is open) — rather than letting every one of `useEpics`'s consumers independently ignore it:
```ts
const epicsQuery = useEpics(projectId);
// ...
{epicsQuery.isError && (
  <span role="status" className="type-label" style={{ color: "var(--destructive-strip)" }}>
    Epic list unavailable — some labels may show "Unknown epic".
  </span>
)}
```

### WR-03: Epic-mutating hooks never directly invalidate the epics roster cache — they depend entirely on the `board:changed` event round-trip

**File:** `packages/desktop/src/board/useBoardQuery.ts:255-262` (and the epic branches of `useSetStatus`, `useSetPriority`, `useSetEstimate`, `useSetAssignee`, `useUpdateItem`, `useDeleteItem`, `useReorderItem`)
**Issue:**
`useCreateEpic`'s `onSuccess` invalidates only `boardQueryKey(projectId)`:
```ts
export function useCreateEpic(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => invokeCommand<BoardItem>("epic_create", { projectId, title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) }),
  });
}
```
No mutation hook in this file ever invalidates `epicsQueryKey(projectId)` directly. The epics roster
is refreshed exclusively through `useBoardChangedSubscription`'s handler reacting to the Rust core's
pushed `board:changed` event (`commands/epic.rs:113-114`: `app.emit("board:changed", ...).ok()`).
Every `board:changed` emission on the Rust side is wrapped in `.ok()`, silently discarding any `Err`
the emit call returns. This is an existing, codebase-wide pattern (D-04's "courtesy immediate
refetch" is explicitly documented as a *supplement* to the event, not a replacement, for the board
window itself) — but for the epics roster specifically, there is no supplement at all: if the emit is
ever dropped, a newly created/renamed/deleted epic will not appear in the same tab's `FilterBar`
chips, `BoardRow` pills, or either `ParentPicker` until some unrelated mutation happens to fire
another `board:changed`. `useCreateTask`'s hook, by contrast, keeps its own direct invalidation as a
documented fallback specifically so a dropped/delayed event doesn't leave that tab stale
("`useBoardChangedSubscription` is the source of truth for every OTHER surface's freshness, and stays
authoritative even if this call were removed" — i.e. removing the local invalidation is safe *because*
a fallback already exists elsewhere; no equivalent fallback exists for `epicsQueryKey`).

**Fix:** Add the epics invalidation alongside the existing board invalidation in every epic-affecting
mutation hook, mirroring the belt-and-suspenders pattern already used for the board window:
```ts
export function useCreateEpic(projectId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => invokeCommand<BoardItem>("epic_create", { projectId, title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardQueryKey(projectId) });
      queryClient.invalidateQueries({ queryKey: epicsQueryKey(projectId) });
    },
  });
}
```

## Info

### IN-01: `epicsQueryKey` is exported and documented as a FilterBar dependency, but is dead code

**File:** `packages/desktop/src/board/useBoardQuery.ts:95-99`
**Issue:** The doc comment reads:
```ts
/** Mirrors the private `boardQueryKey` above but exported — `FilterBar.tsx` needs it too
 * (plan 01-18) to invalidate/read the same roster cache `useEpics` populates. */
export function epicsQueryKey(projectId: string | undefined) {
  return ["epics", projectId] as const;
}
```
`grep -rn "epicsQueryKey" packages/desktop/src/` shows it is defined and consumed exactly once —
internally, inside `useEpics` itself (line 324) — and is never imported by `FilterBar.tsx` or any
other file. `FilterBar.tsx` only calls `useEpics(projectId)`; it never reads or invalidates the query
cache by key directly. The export (and its justification) is currently unused; either the intended
`FilterBar`-side usage was dropped during implementation without updating the comment, or the export
should be un-exported (made a private `function` like `boardQueryKey`) since nothing outside this
module needs it today.

**Fix:** Either remove the `export` keyword and correct the comment (if no external consumer is
actually needed), or, if the intent was for `FilterBar` to invalidate/read this cache directly for
some reason, add that usage. Do not leave an exported, doc-commented API surface that nothing calls.

---

_Reviewed: 2026-09-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
