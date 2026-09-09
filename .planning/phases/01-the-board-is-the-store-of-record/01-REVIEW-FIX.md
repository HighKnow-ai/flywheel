---
phase: 01-the-board-is-the-store-of-record
fixed_at: 2026-09-09T22:46:30Z
review_path: .planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-09-09T22:46:30Z
**Source review:** .planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (CR-01, CR-02, WR-01, WR-02 — per the `critical+warning` fix scope; IN-01
  was not a separate deliverable per the run's own scope note, and is resolved as a side effect of
  the CR-01 fix — see below)
- Fixed: 4
- Skipped: 0

**Verification environment:** all four required verification commands (`cargo build --workspace`,
`cargo test --workspace`, `npm --prefix packages/desktop run build`,
`npm --prefix packages/desktop run test`) were run in the **main working tree** on branch
`cymarechal-devoteam/gsd-new-project-ade` — worktree isolation was disabled for this run per the
orchestrator's `<execution_environment>` block (GSD's `worktree.base-check` auto-degraded it under
#683). Every commit below was made directly to that branch with normal `git commit` (no
worktree, no `--no-verify`). The numbers below are reproducible from this same branch/checkout.

## Fixed Issues

### CR-01: `create_issue` can silently create an issue holding both `epic_id` and `task_id`, violating the single-parent invariant this phase documents as guaranteed

**Files modified:** `packages/core/src/domain/issue.rs`, `packages/core/tests/hierarchy_workflow.rs`,
`packages/core/tests/criteria.rs`, `packages/desktop/src-tauri/src/commands/issue.rs`
**Commit:** `af9e3c2`
**Applied fix:** Followed the review's preferred approach (making the invalid state
unrepresentable, mirroring `set_parent`'s discipline, rather than adding a runtime check a future
caller could forget) instead of the schema-`CHECK`-constraint alternative:

- `create_issue`'s signature changed from two independent `epic_id: Option<&str>` /
  `task_id: Option<&str>` parameters to a single `parent: IssueParent` parameter — the same enum
  `set_parent` already uses. An issue holding both an epic and a task parent is now unrepresentable
  at the *type* level on the creation path, not only on the reparenting path.
- Added `IssueParent::from_ids(epic_id, task_id) -> anyhow::Result<Self>`, the one place the
  Tauri command layer's wire-format `(epic_id, task_id)` pair (which is still two independent
  `Option<String>`s over JSON — the wire format was not changed) is converted to an `IssueParent`,
  rejecting the "both supplied" combination before `create_issue` is ever called. This mirrors how
  `issue_set_parent` already parses its `(parent_kind, parent_id)` pair first via
  `IssueParent::parse`.
- Updated `issue_create` (the Tauri command) to call `IssueParent::from_ids` and propagate its
  error as a normal command failure.
- Updated all 7 core-crate call sites of `create_issue` (`hierarchy_workflow.rs` x6,
  `criteria.rs` x1) to pass `IssueParent::None`/`::Epic(..)`/`::Task(..)` instead of the old
  two-`Option` pair.
- Considered, and deliberately did not add, a schema-level `CHECK (epic_id IS NULL OR
  task_id IS NULL)` backstop (the review's "and/or" alternative): `0002_board_schema.sql` is
  already applied in production-shaped tests, and SQLite has no `ALTER TABLE ... ADD CONSTRAINT`
  — adding this would require a full table-recreate migration (new table, copy rows, drop old,
  rename), which is a materially larger and riskier change than the scope of this fix run
  justified given the type-level fix already closes the gap for every code-layer caller
  (core-layer callers, and the one Tauri command, can no longer construct the invalid state; only
  a hand-crafted raw SQL `INSERT` bypassing the Rust layer entirely could still do it). This
  tradeoff is noted here for a future phase to revisit if a schema-level backstop is wanted as
  defence-in-depth against, e.g., a future out-of-process writer.
- **Regression tests added:** 8 new unit tests in `issue.rs` (`#[cfg(test)] mod tests`) covering
  `IssueParent::from_ids` (all four branches, including the CR-01 rejection case) and
  `IssueParent::parse` (including the WR-02 fix below). One new integration test in
  `hierarchy_workflow.rs`,
  `create_issue_rejects_both_an_epic_id_and_a_task_id_supplied_together`, proving
  `IssueParent::from_ids(Some(epic), Some(task))` is rejected and asserting zero issue rows exist
  afterward.

**IN-01 folded in:** the `IssueParent` doc comment above the enum was updated in this same commit
to state the single-parent guarantee is enforced by both `create_issue` and `set_parent` — the
`create_issue` doc comment now also cross-references `IssueParent`/`IssueParent::from_ids`
directly. IN-01 is resolved as a natural side effect of the CR-01 fix, exactly as the review
anticipated; it was not tracked or committed as a separate deliverable per this run's scope.

### WR-02: `IssueParent::parse` silently discards a supplied `parent_id` when `parent_kind` is absent, rather than treating it as a malformed request

**Files modified:** `packages/core/src/domain/issue.rs`
**Commit:** `af9e3c2` (landed in the same commit as CR-01 — see note below)
**Applied fix:** Changed `IssueParent::parse`'s `(kind, id)` match: `(None, Some(_))` is now
`Err(anyhow!("parent_id was supplied without a parent_kind"))` instead of being folded into the
old `(None, _) => Ok(Self::None)` catch-all. `(None, None)` still maps to `Ok(Self::None)`. Every
other arm (`(Some("epic"|"task"), Some(id))`, `(Some(other), Some(_))`,
`(Some(kind), None)`) is unchanged.

**Note on commit atomicity:** this fix landed in the CR-01 commit (`af9e3c2`) rather than its own
commit. Both findings required editing the exact same `impl IssueParent` block in `issue.rs` (CR-01
added `from_ids` immediately above `parse`; WR-02 changed `parse`'s first two match arms) — the
two changes were adjacent lines in the same function-adjacent block, so applying and verifying them
as two separate commits would have meant re-touching the same few lines twice with no isolation
benefit. This is flagged here for transparency rather than silently presented as two independent
commits.

**Regression tests added:** `parse_rejects_parent_id_without_parent_kind` (the WR-02 case itself),
plus `parse_accepts_neither_as_none`, `parse_accepts_epic_with_id`, `parse_accepts_task_with_id`,
`parse_rejects_unknown_kind`, `parse_rejects_kind_without_id` covering the rest of `parse`'s match
arms (previously untested — `IssueParent::parse` had zero unit tests before this fix).

### CR-02: `IssuesLane`'s new parent-picker button opens a trapped `FocusScope` without going through the layer guard, reintroducing the exact G-01-FOCUS failure class for a brand-new interaction

**Files modified:** `packages/desktop/src/board/BoardView.tsx`,
`packages/desktop/src/board/__tests__/layer-guard.test.tsx`
**Commit:** `30b78f1`
**Applied fix:** Gated `IssuesLane`'s `onOpenParentPicker` callback (in `BoardView.tsx`) behind the
same `topLayer`/`bindingAllowedInLayer` computation `handleContainerKeyDown` already uses for every
keyboard-driven picker: reads `paletteOpen`, `detailItemId !== null`,
`activePicker !== null || deleteTarget !== null || pendingDone !== null`, and `quickAddOpen` from
the store, computes `topLayer(...)`, and returns early (refusing to open the picker) unless the
result is `"board"` or `"quick-add"` — exactly the review's own suggested fix, applied at the call
site that mounts `ParentPicker` rather than by giving `ParentPicker` itself a new `trapped` prop
(the review's alternative), since the layer check was already computed in this exact shape one
function away and reusing it avoided introducing a second way to express the same gate.

**Regression tests added:** two new tests in `layer-guard.test.tsx` (the file the run's
`why_this_matters` block specifically named), both driving the guard via `fireEvent.click` — every
prior test in that file drives it via `fireEvent.keyDown`, which is exactly why this pointer-path
gap slipped past the existing suite:
- `clicking_the_issue_lane_parent_button_does_not_open_a_second_trapped_scope_over_the_detail_panel`
  — the negative case: with the item detail panel open (`openDetailPanel("1")`), clicking an
  issue's "No parent" button leaves `activePicker` `null`, renders no "Set parent" menu, and leaves
  the detail panel itself undisturbed.
- `clicking_the_issue_lane_parent_button_still_opens_the_picker_with_nothing_else_open` — the
  positive case, proving the guard refuses conditionally (only when a higher layer is on top), not
  unconditionally (which would be indistinguishable from breaking the feature outright).

Extended `renderHarness` in that file to accept an optional `issues` array (previously
items-only), and added a minimal `ISSUES` fixture (one unparented issue) so `IssuesLane` renders a
clickable row in this harness.

### WR-01: `useRegistrationErrorNotice`'s error notice never clears after a successful retry — it can get stuck on screen permanently

**Files modified:** `packages/desktop/src/projects/RegisterProjectFlow.tsx`,
`packages/desktop/src/projects/__tests__/register-project-flow.test.tsx` (new file)
**Commit:** `62f1ce5`
**Applied fix:** Exactly the review's suggested fix: the effect's `if (!isError) return;` early
guard was changed to explicitly call `setMessage(null)` before returning, so a retry that flips
`isError` back to `false` clears the stale message immediately instead of only via the (now
cancelled) 4s timeout from the prior failure.

**Regression tests added:** new file `register-project-flow.test.tsx` (this hook had zero existing
test coverage before this fix) with three cases exercised via `renderHook`/`rerender` — no reliance
on the real `setTimeout`, so the tests are synchronous and deterministic:
1. the message is shown while `isError` is `true`;
2. the message stays `null` when `isError` has never been `true`;
3. the message clears immediately when `isError` flips back to `false` via `rerender` (the WR-01
   regression case itself).

## Verification

All four required commands were run after all four commits above, in the main working tree:

- `cargo build --workspace` — succeeded (`Finished \`dev\` profile [unoptimized + debuginfo]
  target(s)`).
- `cargo test --workspace` — all suites passed. `hierarchy_workflow.rs`: 18 passed (17 baseline +
  1 new CR-01 regression test). Core lib unit tests (`domain::issue::tests::*` +
  `ranking::tests::*`): 15 passed (5 baseline `ranking` tests + 10 new `issue::tests` — 4
  `from_ids` + 6 `parse`). Every other existing suite (`ids`, `migration_safety`, `outbox`,
  `perf_seed_1000`, `project_reconciliation`, `ranking`, `search_filter`, `criteria`) passed
  unchanged.
- `npm --prefix packages/desktop run build` — succeeded (`tsc && vite build`, no type errors, no
  new build warnings beyond the pre-existing chunk-size-limit notice which is unrelated to this
  diff).
- `npm --prefix packages/desktop run test` — 89 tests passed across 17 files, up from the 84-test
  baseline stated in the run's own `<verification_required>` block (+2 from CR-02's
  `layer-guard.test.tsx` additions, +3 from WR-01's new `register-project-flow.test.tsx`). Nothing
  regressed.

No finding was left open or partially fixed. No schema migration was added (see CR-01's note above
on the deliberately-deferred `CHECK`-constraint alternative).

---

_Fixed: 2026-09-09T22:46:30Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
