---
phase: 01-the-board-is-the-store-of-record
reviewed: 2026-09-09T14:36:12Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - packages/core/src/domain/epic.rs
  - packages/core/src/domain/issue.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/task.rs
  - packages/core/tests/hierarchy_workflow.rs
  - packages/desktop/src-tauri/src/commands/issue.rs
  - packages/desktop/src-tauri/src/commands/task.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/FirstRun.tsx
  - packages/desktop/src/board/IssuesLane.tsx
  - packages/desktop/src/board/QuickAdd.tsx
  - packages/desktop/src/board/pickers/ParentPicker.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/board/__tests__/board-view.test.tsx
  - packages/desktop/src/board/__tests__/epic-assign.test.tsx
  - packages/desktop/src/board/__tests__/filter.test.tsx
  - packages/desktop/src/board/__tests__/first-run.test.tsx
  - packages/desktop/src/board/__tests__/issue-parent.test.tsx
  - packages/desktop/src/board/__tests__/keyboard-nav.test.tsx
  - packages/desktop/src/board/__tests__/layer-guard.test.tsx
  - packages/desktop/src/board/__tests__/palette.test.tsx
  - packages/desktop/src/item-detail/ActivityTrail.tsx
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/projects/ProjectRail.tsx
  - packages/desktop/src/projects/RegisterProjectFlow.tsx
  - packages/desktop/src/projects/__tests__/project-rail.test.tsx
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
findings:
  critical: 2
  warning: 2
  info: 1
  total: 5
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-09T14:36:12Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

Reviewed the gap-closure diff (plans 01-12 through 01-15) that closed G-01-EPIC-ASSIGN
(reparenting: `task::set_epic`, `issue::set_parent`, `task_set_epic`/`issue_set_parent`
commands, `ParentPicker`, nested quick-add) and G-01-FOCUS (the shared `topLayer`/
`bindingAllowedInLayer` guard in `state/keyboard.ts`, threaded through
`useGlobalBindings` and `BoardView`'s container key handler).

The reparenting domain logic itself is solid: `task::set_epic` and `issue::set_parent`
both call `assert_parent_in_project` before the write, both make the UPDATE and the
event append in the same transaction, and both correctly no-op (no event, `updated_at`
untouched) when the new parent equals the current one — all verified in
`hierarchy_workflow.rs` with real assertions, not `expect`-and-forget. The keyboard
layer guard is well designed and unusually well tested (`layer-guard.test.tsx` covers
all six named G-01-FOCUS instances against a live DOM, not just the pure functions).

Two real gaps survived into this diff, both directly touching the invariants this
phase set out to guarantee:

1. **`create_issue` never enforces the single-parent invariant it documents** — only
   `issue::set_parent`/`IssueParent` make "both parents at once" unrepresentable; the
   creation path (both the core function and the `issue_create` Tauri command) still
   accepts `epic_id: Some` and `task_id: Some` simultaneously, and nothing — not the
   application layer, not the schema — rejects it.
2. **The new "parent" button in `IssuesLane`** opens a trapped `ParentPicker` via a raw
   `onClick`, bypassing the very `bindingAllowedInLayer`/`topLayer` guard this phase
   built specifically to prevent two trapped focus scopes coexisting — the class of bug
   `ItemDetailPanel`'s new `trapped={!paletteOpen}` prop (this same diff) exists to fix
   for the palette, but not for this new click path.

A third issue (a stale, never-clearing error notice) was found in the CR-02
registration-error plumbing this diff also touches.

## Critical Issues

### CR-01: `create_issue` can silently create an issue holding both `epic_id` and `task_id`, violating the single-parent invariant this phase documents as guaranteed

**File:** `packages/core/src/domain/issue.rs:34-120` (also `packages/desktop/src-tauri/src/commands/issue.rs:64-102`)

**Issue:** The module doc comment for `IssueParent`/`set_parent` states the invariant in
absolute terms: "an issue holds at most one parent, `epic_id` or `task_id`, never both
at once (T-01-GC-05, G-01-EPIC-ASSIGN)" and "an issue holding both at once is
unrepresentable, not merely unwritten." That guarantee is real for `set_parent` (it
derives both columns from a single `IssueParent` enum variant, so "both" cannot be
constructed), but `create_issue` takes two independent `Option<&str>` parameters:

```rust
pub fn create_issue(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    body: Option<&str>,
    kind: &str,
    epic_id: Option<&str>,
    task_id: Option<&str>,
) -> anyhow::Result<Issue> {
    ...
    if let Some(epic_id) = epic_id {
        assert_parent_in_project(&tx, project_id, ParentTable::Epics, epic_id)?;
    }
    if let Some(task_id) = task_id {
        assert_parent_in_project(&tx, project_id, ParentTable::Tasks, task_id)?;
    }
    ...
    tx.execute(
        "INSERT INTO issues (
            id, project_id, epic_id, task_id, key, title, body, kind, rank,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![id, project_id, epic_id, task_id, key, title, body, kind, rank, actor_id, now],
    )
```

If both `epic_id` and `task_id` are `Some` (each individually valid and in-project), both
are validated independently and both are inserted — nothing rejects the combination.
The `issue_create` Tauri command (`commands/issue.rs:64-102`) passes both straight
through with no additional check either. The schema has no help here either — the
`issues` table (`0002_board_schema.sql:79-92`) has no `CHECK` constraint preventing
`epic_id IS NOT NULL AND task_id IS NOT NULL`.

Confirmed by `grep`: `create_issue` is `pub`, called only from the one Tauri command and
from tests today, but it is a public core API — any future caller (an MCP tool, a CLI,
an automation) can construct exactly the state this phase's own doc comments say is
"unrepresentable." `hierarchy_workflow.rs` (this same diff) tests cross-project
rejection for each id individually (`create_task_and_create_issue_reject_a_parent_in_another_project`)
but never exercises `create_issue` with both `epic_id` and `task_id` supplied at once —
this gap has no regression test either.

The two current UI call sites (`CommandPalette.tsx`'s "Create Issue" command,
`useCreateIssue`) happen to only ever send one of the two, so the bug is not reachable
from today's renderer — but the invariant is documented as a core-layer guarantee, not a
renderer-layer convention, and the core layer does not enforce it.

**Fix:** Either reject the combination in `create_issue` itself (mirroring `set_parent`'s
discipline — accept an `IssueParent`-shaped input instead of two raw `Option`s, or add an
explicit guard), and/or add a schema-level backstop:

```rust
if epic_id.is_some() && task_id.is_some() {
    return Err(anyhow!("an issue cannot be created with both an epic_id and a task_id"));
}
```

```sql
-- 0002_board_schema.sql, issues table
CHECK (epic_id IS NULL OR task_id IS NULL)
```

### CR-02: `IssuesLane`'s new parent-picker button opens a trapped `FocusScope` without going through the layer guard, reintroducing the exact G-01-FOCUS failure class for a brand-new interaction

**File:** `packages/desktop/src/board/IssuesLane.tsx:101-119`, `packages/desktop/src/board/BoardView.tsx:657-661`, `packages/desktop/src/board/pickers/ParentPicker.tsx:81-91`

**Issue:** This diff's own `ItemDetailPanel.tsx` change adds a `trapped` prop specifically
because "the command palette renders OVER this panel by design... the caller passes
`false` while the palette is open, so two trapped `FocusScope`s are never mounted at
once. That 'two trapped scopes at once' condition is exactly what G-01-FOCUS's fifth
instance describes." Every OTHER way to open a row-level picker while respecting layer
state goes through `state/keyboard.ts`'s `bindingAllowedInLayer`/`topLayer` (keyboard
paths only fire in `"board"`/`"quick-add"` layers, per `handleContainerKeyDown`).

The new "parent" button this plan adds to `IssuesLane` does not:

```tsx
// IssuesLane.tsx
<button
  ...
  onClick={(event) => {
    event.stopPropagation();
    onOpenParentPicker?.(issue, event.currentTarget);
  }}
>
  {parent ? parent.key : "No parent"}
</button>
```

```tsx
// BoardView.tsx
<IssuesLane
  ...
  onOpenParentPicker={(issue, anchorEl) => {
    const rect = anchorEl.getBoundingClientRect();
    setPickerAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
    setActivePicker({ kind: "issue-parent", id: issue.id });
  }}
/>
```

There is no `topLayer`/`bindingAllowedInLayer` check before `setActivePicker` here, and
`ParentPicker` itself always renders `<FocusScope trapped loop asChild>` unconditionally
— it has no `trapped` prop to condition on the current layer the way `ItemDetailPanel`
now does. Since the Issues lane renders in the same board pane as the item rack (not
covered by the 480px detail panel at ≥1100px window width, per `ItemDetailPanel.tsx`'s
own doc comment), a user can: select a task, press Enter to open its (trapped) detail
panel, then click a DIFFERENT issue's "No parent" button in the lane below — mounting a
second trapped `FocusScope` (the `ParentPicker`) while the detail panel's trapped scope
is still active. `layer-guard.test.tsx` (this same diff) tests all six G-01-FOCUS
instances exhaustively via `fireEvent.keyDown`, but has no coverage for this click path,
so the regression suite would not catch it.

**Fix:** Gate the click handler (or the `activePicker`/`ParentPicker` mount) behind the
same layer check every keyboard path uses, e.g.:

```tsx
onOpenParentPicker={(issue, anchorEl) => {
  const layer = topLayer({ paletteOpen, detailOpen: detailItemId !== null, pickerOpen: activePicker !== null || deleteTarget !== null || pendingDone !== null, quickAddOpen });
  if (layer !== "board" && layer !== "quick-add") return;
  ...
}}
```

or give `ParentPicker` its own `trapped` prop (mirroring `ItemDetailPanel`'s new one) and
compute it the same way at the call site.

## Warnings

### WR-01: `useRegistrationErrorNotice`'s error notice never clears after a successful retry — it can get stuck on screen permanently

**File:** `packages/desktop/src/projects/RegisterProjectFlow.tsx:92-103`

**Issue:**

```tsx
export function useRegistrationErrorNotice(isError: boolean, error: unknown): string | null {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isError) return;
    setMessage(`Couldn't register this project — ${(error as Error).message}`);
    const timeout = window.setTimeout(() => setMessage(null), REGISTRATION_NOTICE_VISIBLE_MS);
    return () => window.clearTimeout(timeout);
  }, [isError, error]);

  return message;
}
```

Sequence: a registration fails → `isError` flips `true`, the effect sets `message` and
schedules a 4s timeout to clear it. If the user retries immediately from the same entry
point (e.g. `ProjectRail`'s `+` button — a single `useRegisterProjectFlow()`/`useMutation`
instance) and the retry **succeeds**, `useMutation` resets `isError` to `false` as soon
as the new `mutate`/`mutateAsync` call starts. The effect's dependency array
(`[isError, error]`) changes, so its cleanup runs — cancelling the pending
`clearTimeout` — and the effect body re-runs with `isError === false`, which returns
immediately via the early guard **without ever calling `setMessage(null)`**. The stale
"Couldn't register this project — …" notice is left on screen indefinitely (until the
component unmounts, or a further error re-triggers the cycle), even though the retry
just succeeded.

This is new code in this diff (`useRegistrationErrorNotice` did not exist before this
gap closure) and is wired into `ProjectRail.tsx`, `App.tsx`, and `CommandPalette.tsx`.

**Fix:** Explicitly clear the message when `isError` goes false:

```tsx
useEffect(() => {
  if (!isError) {
    setMessage(null);
    return;
  }
  setMessage(`Couldn't register this project — ${(error as Error).message}`);
  const timeout = window.setTimeout(() => setMessage(null), REGISTRATION_NOTICE_VISIBLE_MS);
  return () => window.clearTimeout(timeout);
}, [isError, error]);
```

### WR-02: `IssueParent::parse` silently discards a supplied `parent_id` when `parent_kind` is absent, rather than treating it as a malformed request

**File:** `packages/core/src/domain/issue.rs:371-383`

**Issue:**

```rust
pub fn parse(kind: Option<&str>, id: Option<&str>) -> anyhow::Result<Self> {
    match (kind, id) {
        (None, _) => Ok(Self::None),
        (Some("epic"), Some(id)) => Ok(Self::Epic(id.to_string())),
        (Some("task"), Some(id)) => Ok(Self::Task(id.to_string())),
        (Some(other), Some(_)) => Err(anyhow!(...)),
        (Some(kind), None) => Err(anyhow!(...)),
    }
}
```

`(None, Some(id))` — a caller sending `parent_kind: null` alongside a non-null
`parent_id` — is accepted and silently treated as `IssueParent::None` (detach), with the
supplied `id` discarded rather than surfaced as an error. Every function that rejects a
malformed pair in the reverse direction (`kind` present, `id` absent) does so loudly;
this direction fails silently instead, which could mask a client-side bug (e.g. a
future call site that forgets to also send `parentKind` alongside `parentId`) as a
silent, unintended detach rather than a visible error. Not reachable from today's
renderer (`useSetIssueParent`/`ParentPicker` always send both together or neither), so
this is a defensive-coding gap rather than a live bug.

**Fix:** Treat `(None, Some(_))` as a malformed request too:

```rust
(None, Some(_)) => Err(anyhow!("parent_id was supplied without a parent_kind")),
(None, None) => Ok(Self::None),
```

## Info

### IN-01: `create_issue`'s own doc comment does not scope the single-parent guarantee to `set_parent`, inviting the CR-01 gap

**File:** `packages/core/src/domain/issue.rs:356-358`

**Issue:** The doc comment above `IssueParent` reads "an issue holds at most one parent,
`epic_id` or `task_id`, never both at once" without qualifying that this guarantee is
only actually enforced by `set_parent`, not by `create_issue` a few lines above it in the
same file. A reader skimming the module could reasonably believe the invariant holds
everywhere in the module, which is exactly the assumption CR-01 shows is false today.

**Fix:** Once CR-01 is fixed, update the doc comment to state the guarantee module-wide
("enforced by both `create_issue` and `set_parent`") rather than only where `IssueParent`
happens to be defined; until then, scope the current comment explicitly to `set_parent`.

---

_Reviewed: 2026-09-09T14:36:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
