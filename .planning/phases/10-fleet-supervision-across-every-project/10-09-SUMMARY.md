---
phase: 10-fleet-supervision-across-every-project
plan: 09
subsystem: fleet
status: complete
tags: [rust, tauri, react, sqlite, git-worktrees, reclaim, tanstack-query]

requires:
  - phase: 10-fleet-supervision-across-every-project
    provides: "10-08 reclaim_eligibility, the two-phase inventory read, the WorktreeInventory view"
  - phase: 03-nothing-lost-nothing-left-running
    provides: "remove_worktree_for_task and its unconditional dirty-tree refusal (D-41)"
provides:
  - "reclaim_worktrees: per-row fresh re-derivation, then the unchanged removal verb, one outcome per distinct id, no short-circuit"
  - "worktree_reclaim Tauri command: async, ids only, capped at 50, own connection on the blocking pool"
  - "worktree_inventory_input_for_task: the single-row board read, sharing one SELECT with the inventory"
  - "WorktreeInventory multi-select, one confirmation naming the bytes, per-row result list"
affects: [11]

requirements-completed: [WORK-07]

actuals:
  tokens: 23228
  tasks: 2
  commits: 3
plan_head_before: d828370ba47ba6123414dbd9b2a9db8ecd5cf7ce
commits: 3

tech-stack:
  added: []
  patterns:
    - "A selection is advisory: the server re-derives every row at the moment it acts, through the list's own definition"
    - "A batch returns a vector of outcomes, never a Result, so one refusal cannot abort it"
    - "A destructive batch runs over a connection of its own so the shared mutex is never held across git"

key-files:
  created:
    - packages/core/tests/worktree_reclaim.rs
    - packages/desktop/src/fleet/__tests__/worktree-reclaim.test.tsx
  modified:
    - packages/core/src/domain/worktree.rs
    - packages/core/src/query/fleet.rs
    - packages/desktop/src-tauri/src/commands/fleet.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/fleet/WorktreeInventory.tsx
    - packages/desktop/src/fleet/__tests__/worktree-inventory.test.tsx
    - .planning/DEFERRED-REVIEW.md

key-decisions:
  - "The mutex is avoided by a second connection, not by splitting lock phases. remove_worktree_for_task takes &mut Connection and runs git inside, and the plan forbids changing it, so the command resolves the actor under the lock, drops it, and runs the whole batch on the blocking pool over Connection::open(default_db_path()) with apply_pragmas (WAL, busy_timeout 5000)."
  - "Eligibility is re-read per row, fresh, not once per batch: removals take seconds, so a run started during the batch is still caught for the rows after it."
  - "The inventory SELECT became a macro shared by the list and the single-row read (concat! only takes literals), so the live-run clause that makes a stale selection harmless has one definition."
  - "Selection is effective only over rows that are reclaimable in the current list: a refused row that comes back in use drops out of the selection instead of sitting selected and unselectable."
  - "An unmeasured size is never counted as zero in the confirmation total: it reads '512.0 MiB measured, 1 not measured'."

patterns-established:
  - "The result header is factual ('1 of 2 removed') and no text anywhere claims the batch succeeded"

coverage:
  - id: D1
    description: "A selection that went stale cannot remove a worktree an agent just started in"
    requirement: WORK-07
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_reclaim.rs#a_run_inserted_after_the_read_refuses_that_row_and_removes_the_others"
        status: pass
    human_judgment: false
  - id: D2
    description: "Removal goes through the unchanged verb; a dirty tree is refused with its file intact; a removal git refuses is reported refused and keeps its row; one refusal never aborts the batch"
    requirement: WORK-07
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_reclaim.rs#a_tree_that_became_dirty_after_the_read_is_refused_and_keeps_its_file"
        status: pass
      - kind: integration
        ref: "packages/core/tests/worktree_reclaim.rs#a_removal_that_fails_is_reported_as_refused_with_its_error_and_the_batch_continues"
        status: pass
    human_judgment: false
  - id: D3
    description: "Open task, unreachable project, unknown id, duplicate ids, empty list and the 50-row cap"
    requirement: WORK-07
    verification:
      - kind: integration
        ref: "packages/core/tests/worktree_reclaim.rs#an_open_task_is_refused_before_any_git_call"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/fleet.rs#a_reclaim_batch_over_the_cap_is_refused_whole_and_one_at_the_cap_is_not"
        status: pass
    human_judgment: false
  - id: D4
    description: "Checkbox on reclaimable rows only, bytes-naming bar, one confirmation, per-row results with no success claim, refetch, selection retention, no select-all"
    requirement: WORK-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/fleet/__tests__/worktree-reclaim.test.tsx"
        status: pass
    human_judgment: true
    rationale: "How the dialog and the result list read at row density in a WKWebView is a human aesthetic judgment; queued as D-REV-55."
---

# Phase 10 Plan 09: Worktree Reclaim Summary

**A multi-select reclaim across every project: the server re-derives each row's eligibility at the moment it acts through the inventory's own function, removes through the untouched dirty-tree-refusing verb, and reports every row individually.**

## Accomplishments

- `reclaim_worktrees` (core) returns one `ReclaimOutcome` per distinct id, in order, with no `?` in its loop. Per row it reads the board fresh (`worktree_inventory_input_for_task`), runs the git half through `finish_worktree_inventory` (which applies `reclaim_eligibility`), and only for a `Reclaimable` row calls `remove_worktree_for_task`, which is unchanged (the diff to `worktree.rs` has zero deleted lines).
- `worktree_reclaim` is `#[tauri::command(async)]`, takes `Vec<String>` and nothing else, refuses more than `RECLAIM_BATCH_CAP` rows as a whole, resolves the actor under the lock and drops it, then runs the batch on `spawn_blocking`. It emits `board:changed` once. It is in `main.rs`'s roster once and in the capability file's audited roster once; the `worktree_remove` sentence is untouched.
- The inventory view gets a checkbox on reclaimable rows only, a bar naming the count and the measured total, one `alertdialog` confirmation (Cancel holds first focus, Escape and outside-click cancel), a per-row result list, and a refetch afterwards. There is no select-all and no reclaim-everything control.

## Records the plan asked for

- **Stale-selection test, observed red then green.** With the per-row disposition check replaced by "always reclaimable", `worktree_reclaim` failed 5 of 10 tests, including `a_run_inserted_after_the_read_refuses_that_row_and_removes_the_others` (the live worktree was removed). Restored, all pass. The scratch edit was reverted before commit.
- **`RECLAIM_BATCH_CAP` = 50.** Enforced in the command by `check_reclaim_batch` (unit tested at 0, 50 and 51) and mirrored in the view, which disables Reclaim and says "At most 50 at a time." above it.
- **Timeout case.** `proc.rs` has no seam for a shorter ceiling, so a real kill at 120 s is not driven. The test instead makes `git worktree remove` fail after eligibility passed (a `git worktree lock`), and asserts `removed: false`, the error text, the row kept, and the next row still removed. A timeout returns the same `Err` from `remove_worktree_for_task`, so it reaches this branch; the timeout error itself is pinned by `tests/proc_timeout_boundary.rs`. Not verified end to end.
- **Confirmation wording** (for the Copywriting Contract check): heading `Remove N worktrees?`; body `<total>. Their directories are removed from disk. Branches and commits are kept. A worktree with uncommitted changes, or one an agent has started in since the list was read, is refused and left alone.`; buttons `Cancel` and `Remove N worktrees` (Trash2 icon, destructive edge text, never autofocused). Bar: `Reclaim N worktrees · <total>`. Result header: `Result · K of N removed`; lines `<project> <key> removed` / `<project> <key> refused: <reason word or error>`. Whether this matches the Copywriting Contract was not checked against `01-UI-SPEC.md` beyond the destructive-confirmation grammar copied from `DeleteConfirm`; D-REV-55 covers the read.

## Deviations from Plan

**1. [Rule 3 - Blocking] Gate `reclaim_eligibility` count in `reclaim_worktrees` is 0, not 1.**
- **Issue:** The gate greps the function body for a direct `reclaim_eligibility` call. The function reaches it through `finish_worktree_inventory`, which is where the facts (integrated, dirty, present) are gathered and `reclaim_eligibility` is applied. Calling it directly would mean duplicating that fact-gathering and creating a second definition of the facts, which is the thing D-179 and Finding 7 forbid.
- **Verified instead:** the disposition used comes from the same code path as the list, proven by the stale-selection, dirty, open, and unreachable tests, and by the red run above.
- **Commit:** ab179e4

**2. [Rule 2 - Missing critical] A second connection, not `AppState.db`.** The plan said "owns its own connection handle"; `AppState` holds only a mutex-guarded single connection, so the command opens `default_db_path()` with `apply_pragmas`. Covered by `a_batch_run_on_a_second_connection_is_visible_on_the_first` (c14c582).

**3. Files beyond `files_modified`:** `packages/core/src/query/fleet.rs` (the shared SELECT and `worktree_inventory_input_for_task`) and `worktree-inventory.test.tsx` (its "no reclaim control" source assertion was 10-08's placeholder for this plan; it now forbids select-all and reclaim-everything instead). `tauri.ts` was already listed.

**4. Dirty-tree case reaches eligibility, not the verb's own refusal.** A tree dirtied after the read is caught by the per-row re-derivation first. The verb's own porcelain refusal is untouched and still runs behind it, but it cannot be hit independently in a deterministic test, since both read the same state; it is covered by the existing `worktree_removal.rs`.

**5. Flaky-fixture fix.** My first open-task test wrote its marker beside the repo tempdir, a directory shared across tests and runs, and failed on the second run. Moved to its own tempdir.

**Total deviations:** 1 Rule 3 (gate), 1 Rule 2, 3 adjustments. **Impact:** none on scope.

## Known Stubs

None.

## Deferred Items

- `D-REV-55` in `.planning/DEFERRED-REVIEW.md`: the command over real IPC, responsiveness during a real multi-second removal, and the look of the dialog in a WKWebView. `automatable: PARTLY`.
- **The plan asked me to confirm the only deferred-review entries added in this phase are the two physical ones from 10-07. That is not true and I am not confirming it.** Phase 10 queued D-REV-47 (10-01), 48 (10-03), 49 (10-04), 50 (10-05), 51 (10-06), 52 and 53 (10-07), 54 (10-08), and now 55 (10-09). Only 52 and 53 are `automatable: NO`; the rest are `PARTLY` (a real-IPC or Playwright harness could close the logic half, the look cannot). So not every other criterion was closed by an automated test: each of those entries names what was asserted and what was not.

## Threat Flags

None. `worktree_reclaim` is in the audited roster and takes ids only; no path, ref, sha, actor or guard-skipping parameter exists (grep-gated: zero `force_remove|skip_porcelain|ignore_dirty`).

## Verification

- `cargo test -p core --test worktree_reclaim --test worktree_inventory --test worktree_size --test launch_reconciliation --test discard_lifecycle --test agent_run_stop_ordering`: 11 + 12 + 7 + 20 + 13 + 2 passed (one ignored benchmark). `cargo test -p desktop`: 134 passed. `cargo build --workspace`: clean (one dead-code warning in `agent_run.rs`, not mine).
- `npx vitest run` (whole desktop suite): 1428 passed. `npm run build`: no `error TS`.
- Grep gates: removal verb called once in the batch, no `?` on it, no bypass parameter, one roster entry in `main.rs`, one line in the capability file. The one gate that fails as written is deviation 1.
- Phase close: per `.claude/CLAUDE.md`, on automated verification plus ROADMAP criteria; no `/gsd-verify-work` round and no UAT file. ROADMAP criterion 5 (every worktree across projects with disk usage and reclaim, plus token usage and cost per session) is met by 10-04 (spend), 10-08 (inventory) and this plan (reclaim), with the unexercised halves queued above.

## Self-Check: PASSED

- Created files exist: `worktree_reclaim.rs`, `worktree-reclaim.test.tsx`.
- Commits ab179e4, 02e89cb and c14c582 exist.
