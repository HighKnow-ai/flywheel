---
phase: 01-the-board-is-the-store-of-record
reviewed: 2026-09-09T00:00:00Z
depth: standard
files_reviewed: 100
files_reviewed_list:
  - Cargo.toml
  - packages/core/Cargo.toml
  - packages/core/src/db/backup.rs
  - packages/core/src/db/migrations/0001_actors.sql
  - packages/core/src/db/migrations/0002_board_schema.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/acceptance_criterion.rs
  - packages/core/src/domain/actor.rs
  - packages/core/src/domain/epic.rs
  - packages/core/src/domain/event.rs
  - packages/core/src/domain/issue.rs
  - packages/core/src/domain/mod.rs
  - packages/core/src/domain/project.rs
  - packages/core/src/domain/task.rs
  - packages/core/src/ids.rs
  - packages/core/src/lib.rs
  - packages/core/src/marker.rs
  - packages/core/src/query/events.rs
  - packages/core/src/query/filter.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/search.rs
  - packages/core/src/ranking.rs
  - packages/core/tests/activity_trail.rs
  - packages/core/tests/bin/crash_harness.rs
  - packages/core/tests/common/mod.rs
  - packages/core/tests/crash_safety.rs
  - packages/core/tests/criteria.rs
  - packages/core/tests/cursor_resume.rs
  - packages/core/tests/db_bootstrap.rs
  - packages/core/tests/hierarchy_workflow.rs
  - packages/core/tests/migration_safety.rs
  - packages/core/tests/outbox.rs
  - packages/core/tests/perf_seed_1000.rs
  - packages/core/tests/project_reconciliation.rs
  - packages/core/tests/ranking.rs
  - packages/core/tests/search_filter.rs
  - packages/desktop/index.html
  - packages/desktop/package.json
  - packages/desktop/src-tauri/Cargo.toml
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/actor.rs
  - packages/desktop/src-tauri/src/commands/board.rs
  - packages/desktop/src-tauri/src/commands/criterion.rs
  - packages/desktop/src-tauri/src/commands/epic.rs
  - packages/desktop/src-tauri/src/commands/events.rs
  - packages/desktop/src-tauri/src/commands/issue.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/project.rs
  - packages/desktop/src-tauri/src/commands/task.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/menu.rs
  - packages/desktop/src-tauri/src/state.rs
  - packages/desktop/src-tauri/tauri.conf.json
  - packages/desktop/src/App.css
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/queryClient.ts
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardRow.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/board/DeleteConfirm.tsx
  - packages/desktop/src/board/DoneWarning.tsx
  - packages/desktop/src/board/FilterBar.tsx
  - packages/desktop/src/board/FirstRun.tsx
  - packages/desktop/src/board/IssuesLane.tsx
  - packages/desktop/src/board/QuickAdd.tsx
  - packages/desktop/src/board/StatusBand.tsx
  - packages/desktop/src/board/__tests__/board-view.test.tsx
  - packages/desktop/src/board/__tests__/filter.test.tsx
  - packages/desktop/src/board/__tests__/keyboard-nav.test.tsx
  - packages/desktop/src/board/__tests__/palette.test.tsx
  - packages/desktop/src/board/__tests__/reorder.test.tsx
  - packages/desktop/src/board/__tests__/workflow.test.tsx
  - packages/desktop/src/board/collapseStore.ts
  - packages/desktop/src/board/pickers/AssigneePicker.tsx
  - packages/desktop/src/board/pickers/EstimatePicker.tsx
  - packages/desktop/src/board/pickers/PriorityPicker.tsx
  - packages/desktop/src/board/pickers/StatusPicker.tsx
  - packages/desktop/src/board/useBoardQuery.ts
  - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
  - packages/desktop/src/item-detail/ActivityTrail.tsx
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/item-detail/__tests__/activity-trail.test.tsx
  - packages/desktop/src/item-detail/__tests__/criteria.test.tsx
  - packages/desktop/src/legend/Legend.tsx
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/projects/ProjectRail.tsx
  - packages/desktop/src/projects/ProjectUnreachable.tsx
  - packages/desktop/src/projects/RegisterProjectFlow.tsx
  - packages/desktop/src/projects/__tests__/project-rail.test.tsx
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/desktop/src/styles/motion.css
  - packages/desktop/src/styles/tokens.css
  - packages/desktop/src/styles/type.css
  - packages/desktop/src/test/setup.ts
  - packages/desktop/src/theme/__tests__/contrast.test.ts
  - packages/desktop/src/theme/contrast.ts
  - packages/desktop/src/theme/tokens.ts
  - packages/relay-client/src/lib.rs
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-09-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 100
**Status:** issues_found

## Summary

The Rust core (`packages/core`) is disciplined about the things the phase's own threat register
cares most about: every SQL statement in `query/`, `domain/` and `db/` is a literal string bound
through `params!`/`named_params!` (no SQL injection surface found), key allocation and event
`sequence` allocation happen inside the same transaction as their row insert (no read-modify-write
race), the cursor-resumable event stream (`query/events.rs::events_since_cursor`) is proven
gap-free/duplicate-free by a dedicated batch-boundary test, and `marker.rs`/`domain/project.rs`
canonicalize every repository path before use and never derive a filesystem path from marker
*content*. Migration safety (backup-before-migrate, restore-on-failure, `integrity_check`) is
solid and well tested.

Two real defects survived into this phase, both squarely inside the areas the review brief flagged
as high-risk:

1. **Deletion cascades are incomplete.** `delete_epic`/`delete_task` orphan child *tasks* but never
   touch `issues.epic_id`/`issues.task_id`, which reference the same rows via a `NO ACTION` foreign
   key with `foreign_keys = ON`. Deleting an epic or task that has any linked issue fails outright
   with an opaque SQLite FK error, contradicting the functions' own documented "idempotent, orphans
   children, never fails" contract. No test exercises this path.
2. **Project registration failures are silently swallowed on three of four entry points.** Only
   `FirstRun.tsx` (the very first project) renders `useRegisterProject().isError`; `App.tsx`
   (⌘⇧O/menu), `CommandPalette.tsx` ("Register Project…") and `ProjectRail.tsx` (the rail's `+`)
   all call `useRegisterProjectFlow()` but discard its returned `isError`/`error`, so a rejected
   registration (e.g. a derived key prefix that fails `validate_key_prefix`) leaves the user with
   the folder picker closing and nothing else happening — no board, no error, no retry hint.

Also found: the board row's epic pill renders the raw internal `epic_id` ULID instead of any
human-readable epic reference (the codebase clearly knows how to resolve this — `FilterBar.tsx`'s
epic chips do it correctly from the same `items` window — but `BoardRow.tsx` was never wired to do
the same lookup), and three of the domain layer's four `update_*` functions return a DTO with a
blank `key` field that happens to be unused today but breaks the "read back immediately after a
mutation commits" contract those functions document.

## Critical Issues

### CR-01: Deleting an epic or task with a linked issue fails with a raw FK constraint error

**File:** `packages/core/src/domain/epic.rs:200-257` (`delete_epic`), `packages/core/src/domain/task.rs:205-256` (`delete_task`)
**Issue:**
`migrations/0002_board_schema.sql` declares `issues.epic_id TEXT REFERENCES epics(id)` and
`issues.task_id TEXT REFERENCES tasks(id)` with no `ON DELETE` clause (defaults to `NO ACTION`),
and every connection runs with `foreign_keys = ON` (`db/mod.rs::apply_pragmas`). `delete_epic`
orphans child **tasks** (`UPDATE tasks SET epic_id = NULL WHERE epic_id = ?`) but never touches
`issues`; `delete_task` deletes the task's own acceptance criteria but never touches `issues`
either. `issue_create` (`domain/issue.rs::create_issue`, exposed via the Tauri command
`issue_create`) fully accepts `epic_id`/`task_id`, so any issue created against an epic or task —
today reachable only via direct command invocation/tests since the current `IssuesLane.tsx` UI
never sets these, but this is core, tested-elsewhere-as-supported API surface, and Phase 6 (issue
triage) will certainly link issues to epics/tasks — makes that epic/task **permanently
undeletable**: the `DELETE FROM epics`/`DELETE FROM tasks` statement inside the transaction fails
immediately with a `FOREIGN KEY constraint failed` SQLite error, the `?` propagates it, the
transaction rolls back, and the Tauri command layer surfaces the raw SQLite message as the error
string returned to the renderer. This directly contradicts both functions' own doc comments
("Idempotent... Children are orphaned, never cascade-deleted... an epic deletion never destroys a
user's unrecoverable task work") and the phase's own stated invariant that deletion cascades must
not create orphan rows or unhandled parent-deletion failures. No test in
`packages/core/tests/hierarchy_workflow.rs` (or elsewhere) creates an issue linked to an epic/task
and then deletes the parent, so this is untested and currently invisible to the test suite.
**Fix:** Inside `delete_epic`'s and `delete_task`'s existing transaction, before the
`DELETE FROM epics`/`DELETE FROM tasks` statement, orphan referencing issues the same way child
tasks are already orphaned:
```rust
// delete_epic, alongside the existing "orphan child tasks" UPDATE:
tx.execute(
    "UPDATE issues SET epic_id = NULL, updated_at = ?1 WHERE epic_id = ?2",
    params![now, epic_id],
)
.context("failed to orphan issues referencing this epic")?;

// delete_task:
tx.execute(
    "UPDATE issues SET task_id = NULL, updated_at = ?1 WHERE task_id = ?2",
    params![now, task_id],
)
.context("failed to orphan issues referencing this task")?;
```
Add a regression test mirroring `hierarchy_workflow.rs::deleting_an_epic_orphans_its_tasks` that
creates an issue against the epic/task before deleting it, and asserts the delete succeeds and the
issue's `epic_id`/`task_id` is `NULL` afterward.

### CR-02: Project registration failures are silently swallowed on 3 of 4 entry points

**File:** `packages/desktop/src/App.tsx:94` (`AppShell`'s `⌘⇧O`), `packages/desktop/src/board/CommandPalette.tsx:132` ("Register Project…"), `packages/desktop/src/projects/ProjectRail.tsx:79` (the rail's `+`)
**Issue:**
`RegisterProjectFlow.tsx::useRegisterProjectFlow` deliberately swallows a rejected
`registerProject.mutateAsync` call inside its own `try/catch` and documents that callers must
render `isError`/`error` (the values it returns) themselves: *"a rejected/errored mutation is left
for the caller to surface however it already does... via the returned mutation state below."* Of
the four call sites, only `FirstRun.tsx` — which does **not** use this hook at all, calling
`useRegisterProject()` directly — actually renders an error. The other three all destructure only
`{ registerProjectFlow }` and discard `isError`/`error`:
- `App.tsx:94`: `const { registerProjectFlow } = useRegisterProjectFlow();`
- `CommandPalette.tsx:132`: `const { registerProjectFlow } = useRegisterProjectFlow();`
- `ProjectRail.tsx:79`: `const { registerProjectFlow } = useRegisterProjectFlow((result) => { ... });`

A realistic, reachable failure exists: `board/FirstRun.tsx::deriveKeyPrefix` (reused by
`RegisterProjectFlow.tsx`) produces a prefix from up to 4 alphanumeric characters of the directory
name with no minimum-length guard and no "must start with a letter" guard, while
`domain/project.rs::validate_key_prefix` requires 2-10 uppercase letters/digits **starting with a
letter**. A directory named e.g. `2024-app`, `_x`, or a single-character name derives a prefix that
fails validation (`"2024"` starts with a digit; a 1-alnum-char name yields a 1-character prefix
below `KEY_PREFIX_MIN_LEN`). Any other backend rejection (duplicate/invalid repo path, a
non-existent-anymore folder between picking and canonicalizing, etc.) hits the same dead end. In
all three of these entry points the user picks a folder, the mutation rejects, and the UI gives
**zero** feedback — no toast, no inline message, nothing — leaving the user unable to tell whether
registration is still in progress, succeeded silently, or failed.
**Fix:** Have `useRegisterProjectFlow` return `isError`/`error` and have every caller render it (a
transient toast/notice, mirroring the pattern `ProjectRail.tsx` already has for the
`alreadyRegistered` notice), e.g.:
```tsx
// ProjectRail.tsx
const { registerProjectFlow, isError, error } = useRegisterProjectFlow((result) => { ... });
useEffect(() => {
  if (isError) {
    setNotice(`Couldn't register that folder — ${(error as Error).message}`);
    window.setTimeout(() => setNotice(null), NOTICE_VISIBLE_MS);
  }
}, [isError, error]);
```
Also harden `deriveKeyPrefix` to guarantee a valid prefix (pad short results, force a leading
letter when the derived prefix starts with a digit) so the common case doesn't need the error path
at all.

## Warnings

### WR-01: Board row's epic pill renders the raw internal ULID, not a human-readable epic reference

**File:** `packages/desktop/src/board/BoardRow.tsx:237-245`
**Issue:** For a task that belongs to an epic, the epic-pill slot renders
`{item.epicId ?? epicMark?.label ?? "No epic"}` — i.e., the raw 26-character `epic_id` ULID (e.g.
`01M21VR17BZ33DG1X564KV0YEW`) is shown directly in the row, since neither `BoardItem` (the DTO)
nor `BoardRowProps` carries the epic's key/title, and `BoardRow` is never passed an `epicsById`
lookup the way it already is for `actorsById`. This is not a hypothetical: the codebase itself
demonstrates the correct approach one file over — `FilterBar.tsx`'s epic filter chips derive
`` `${item.key} ${item.title}` `` from the same loaded window's epic rows — but `BoardRow.tsx` was
never wired the same way. Only the "No epic" branch is covered by
`board-view.test.tsx::shows the No epic pill...`; no test asserts what a row with a real
`epicId` actually displays, so this regression is invisible to the suite. Every task under an epic
is a primary Phase 1 use case, so this is user-visible on the very first board with an epic.
**Fix:** Build an `epicsById` map in `BoardView.tsx` (mirroring `actorsById`, from the same
`items.filter(i => i.kind === "epic")` the window already contains) and pass it to `BoardRow`,
rendering `epicsById[item.epicId]?.key` (or `title`) in the pill instead of the raw id.

### WR-02: `update_epic`/`update_task`/`update_issue` return a DTO with a blank `key`

**File:** `packages/core/src/domain/epic.rs:184-193` (`update_epic`), `packages/core/src/domain/task.rs:191-200` (`update_task`), `packages/core/src/domain/issue.rs:182-191` (`update_issue`)
**Issue:** All three functions construct their return value with `key: String::new()` instead of
reading back the row's actual `key` (which they never touch, so the real value is trivially
available from the earlier `SELECT`, or could be added to it). Every one of these functions'
sibling `create_*` counterpart documents "as read back immediately after a mutation commits" as
its contract — an update silently violating that for one field is a real defect, currently masked
only because the Tauri layer's `epic_update`/`task_update`/`issue_update` commands return this DTO
to the renderer, and `useUpdateItem`'s `onSuccess` in `useBoardQuery.ts` only calls
`invalidateQueries` (never `setQueryData` from the mutation result) — so today's UI happens to
never read the blank field back out. That's an accident of the current caller, not a guarantee:
any future caller that optimistically applies this mutation's resolved value (a natural
next step for perceived-latency work), or a Rust test asserting on the returned `key`, would
silently get wrong data.
**Fix:** Include `key` in each function's existing `SELECT ... WHERE id = ?1` (it's cheap — the
row is already being read) and use it in the returned struct instead of `String::new()`.

### WR-03: CSP is explicitly disabled for the whole app

**File:** `packages/desktop/src-tauri/tauri.conf.json:22-24`
**Issue:** `"security": { "csp": null }` disables Tauri's Content-Security-Policy injection
entirely. Tauri v2's own guidance is to set a real CSP because the WebView still executes
arbitrary script if any injection vector is ever found (a rendered issue/task title, a future
rendered agent diff, a dependency's XSS bug in a rich-text/markdown renderer this app will likely
add soon). Phase 1 renders only plain-text titles/statements via React (auto-escaped), so there is
no live XSS vector caught by this review today, but leaving CSP fully `null` rather than a
locked-down policy (`default-src 'self'`, no `unsafe-inline`/`unsafe-eval`) removes a real
defense-in-depth layer for very little cost, especially given the project's own stated intent to
later render agent-produced diffs in this same WebView.
**Fix:** Set an explicit restrictive CSP, e.g. `"csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"` (adjust for whatever inline styles/fonts are actually needed), rather than `null`.

## Info

### IN-01: `deriveKeyPrefix` can derive an invalid key prefix

**File:** `packages/desktop/src/board/FirstRun.tsx:16-20`
**Issue:** `deriveKeyPrefix` strips non-alphanumerics, uppercases, and takes up to 4 characters,
falling back to `"PRJ"` only when the result is **empty** — it does not guarantee the
2-character minimum or "starts with a letter" rules `domain/project.rs::validate_key_prefix`
enforces server-side. See CR-02 for the user-facing consequence on the three entry points that
register immediately without a confirmation step; `FirstRun.tsx`'s own two-step flow lets the user
edit the derived prefix before submitting, so it is not directly affected the same way.
**Fix:** Make `deriveKeyPrefix` itself always emit a valid prefix — pad to 2 characters and prefix
with a fixed letter when the first character is a digit (e.g. `"2024" -> "P2024".slice(0,4)`, or
simply fall back to `"PRJ"` whenever the derived value doesn't start with a letter or is under 2
characters), so every caller gets a value that can never fail `validate_key_prefix`.

### IN-02: `AssigneePicker`/`FilterBar` silently drop the `system` actor from assignment, `ProjectRail`'s error path duplicated across the app

**File:** `packages/desktop/src/board/pickers/AssigneePicker.tsx:115-116`, `packages/desktop/src/board/FilterBar.tsx:254-268`
**Issue:** `AssigneePicker` filters out `actor.actorType !== "system"` (reasonable — Phase 1 never
assigns to the system actor, per `legend/marks.ts`'s own comment), but `FilterBar`'s assignee
filter chips do **not** apply the same filter, so the seeded "Flywheel" system actor appears as a
selectable assignee-filter chip even though no item can ever be assigned to it, making it a
permanently-dead filter option a user could select and get zero results from with no indication
why. Low impact (one extra chip, not a data-integrity issue) but inconsistent with the picker's own
explicit exclusion one file over.
**Fix:** Apply the same `actor.actorType !== "system"` filter in `FilterBar.tsx`'s assignee chip
list, or add a shared helper (`nonSystemActors(actors)`) both call, so the exclusion is expressed
once.

---

_Reviewed: 2026-09-09T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
