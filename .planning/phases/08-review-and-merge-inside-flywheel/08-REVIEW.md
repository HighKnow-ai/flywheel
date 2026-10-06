---
phase: 08-review-and-merge-inside-flywheel
reviewed: 2026-10-06T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - packages/core/src/review.rs
  - packages/core/src/merge.rs
  - packages/core/src/forge/mod.rs
  - packages/core/src/forge/request_body.rs
  - packages/core/tests/criterion_anchors.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/review.rs
  - packages/desktop/src-tauri/src/commands/forge.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/review/CriteriaRail.tsx
  - packages/desktop/src/review/ReviewSurface.tsx
  - packages/desktop/src/review/useReviewQuery.ts
  - packages/desktop/src/review/__tests__/criteria-rail.test.tsx
  - packages/desktop/src/review/__tests__/epic-request.test.tsx
  - packages/desktop/src/review/__tests__/keyboard-activation.test.tsx
  - packages/desktop/src/review/__tests__/merge-sheet.test.tsx
  - packages/desktop/src/review/__tests__/review-surface.test.tsx
findings:
  critical: 0
  warning: 11
  info: 5
  total: 16
status: issues_found
---

# Phase 8: Code Review Report (incremental re-review after gap closure 08-09..08-12)

**Reviewed:** 2026-10-06
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

This is the second review round. It re-checks the three blockers of the first round (CR-01, CR-02, CR-03)
against the code as it stands after commits ab960cc..8c6bb2f, and reviews the new 08-09 roll-up on its own
merits. The prior report is overwritten; prior findings that live in these 20 files were re-read against current
code, and those that live in files outside this round's scope are listed at the end as not re-examined.

### Verdicts on the three prior blockers

| Finding | Verdict | Basis |
|---------|---------|-------|
| CR-01 (git under the DB mutex) | **CLOSED as scoped.** Two adjacent spawn-under-lock sites outside the plan's eight bodies remain (WR-01, WR-02). | All eight rewired command bodies verified below. |
| CR-02 (stderr / abs paths over IPC) | **CLOSED.** | No `e.to_string()` survives in `commands/review.rs` or `commands/forge.rs`. The nine renderer-parsed prefixes are byte-identical. |
| CR-03 (Enter/Space swallowed on buttons) | **CLOSED.** One narrow residual (IN-01). | The guard is a target test, not a blanket suppression, and does not open a double-handling path. |

**CR-01 detail.** I walked each command body for the lock's lexical scope:

- `review_files`, `review_file_patch`, `review_criteria_state`: the guard is a block-local `conn`, the block yields an owned `ReviewTargetInputs`, and `finish_review_target` (the `merge_commit_is_reachable` ancestry check), `files_for_target`, `patch_for_target` and `with_staleness` all run after the block.
- `criterion_check_with_anchor`: the lock covers the ownership `SELECT` plus `review_target_inputs`. The `finish_review_target` call and the `rev-parse` run unlocked. The write re-locks in a separate block.
- `review_merge_precheck`, `review_merge_task`: `plan_merge_inputs` runs under the lock; `finish_plan` (rev-list and diff) runs after the block closes. `merge_tree_check` and `run_merge` run unlocked. `review_merge_task` takes the epic guard only for the git work, re-locks only to record the event, and drops the lock before `emit`.
- `forge_epic_request_draft`, `forge_open_epic_request`: `epic_request_inputs` and `epic_draft_inputs` are board-only reads under the lock. `epic_request_blocker`, `finish_epic_request_draft` and the push/forge dispatch all run after release.
- `forge_and_repo_path`'s detection spawn is genuinely deferred into `EpicRequestInputs::forge()`. `epic_request_inputs` calls only the board-only `stored_forge_and_repo_path`, and `forge()` is first reached inside `epic_request_blocker`, after release. The `OnceCell` memoises, so the blocker check and the dispatch agree.

The git halves take opaque inputs with private fields and no connection, so a command handler cannot substitute a ref between halves.

**CR-02 detail.** Every `map_err` in `commands/review.rs` and `commands/forge.rs` goes through `ipc_error` with a literal context string, or is a fixed sentence. The remaining non-`ipc_error` returns echo only renderer-supplied values (`parse_scope`, the criterion ownership refusal, the forge vocabulary check) or fixed strings. `PoisonError` is handled through `impl Display`. The repo path, branch names and stderr in `PushRejected.detail`, `PushedButNotOpened.detail`, `forge_error_code` and the merge failure log go to `eprintln!` only. Across 3df9940..HEAD the only prefix-bearing line that changed is a new defensive `blocked:` return (IN-03); `refused:`, `mergeInFlight:`, `mergeFailed`, `eventNotRecorded`, `cliNotInstalled:`, `cliNotAuthenticated:`, `cliFailed:` and `malformedJson:` are unchanged. The renderer parsers (`MergeConfirmSheet.parseFailure`, `EpicRequestSheet.parseFailure`, `ForgeSection`) split on the first `:` and fall through to a generic sentence for the new `failed` code, so there is no regression.

**CR-03 detail.** `isActivationTarget` is applied only when `event.key` is `Enter` or `" "`, and only after `resolveBinding` has matched, before `preventDefault`. With focus on `body` or a non-interactive element the binding still resolves and is cancelled (test: "Enter on the body still resolves expand-file"). With focus on a button, anchor or `role=button`, the hook returns without handling or cancelling, so the element's own activation is the only action. Double-handling cannot occur. `Enter` and `Space` are bound through `useRegionBindings` only in `review-surface`; the other callers (triage, proposal tray, permission card, session) bind letters, so the guard changes nothing for them. `CriteriaRail` still stops `j k Space Enter` at React's root, so the rail's own list never reaches the window listener. WR-06 (Escape cascade) is also fixed: the sheets' `DismissableLayer` handler calls `preventDefault()` before `handleCancel()`, the criteria inputs call `preventDefault()` and `stopPropagation()`, and the surface listener now checks `defaultPrevented`.

**New code (08-09).** `epic_task_rollup` is a single read-only statement with correct scoping: current-revision criteria only, evidence counted by `EXISTS`, `with + without = checked` by construction, deterministic order. Its tests cover counts, superseded revisions, empty or unknown epic, tie order and cross-epic isolation. The command takes only an epic id. The rail section renders nothing for an empty roll-up and is not fetched in task scope. No defect found; two small observations are in IN-02.

No new blocker was found. The gaps below are residual spawn-under-lock sites the plan did not reach, missing regression guards for the invariants this round introduced, and still-open warnings from round one that I re-verified in the current code.

## Structural Findings (fallow)

None provided for this review.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `forge_request_for_epic` still spawns git under the DB lock, and two header claims are now false

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:417-430`, `packages/core/src/forge/mod.rs:30-36`
**Issue:** `forge_request_for_epic` is an epic-request command added in this phase. It locks `state.db`, then calls `forge_and_repo_path(&conn, ..)` with the lock still held. When the project's `forge` column is NULL, that runs `git remote get-url origin` under the mutex. It is the same hazard CR-01 fixed for the other epic-request commands, on the read the request sheet issues (`useEpicRequest`). The `forge/mod.rs` header says "all three call sites hold it there" (there are four, counting `scheduler.rs:351`) and that "the epic-request path is stricter and does not rely on that tolerance". The second statement is false for this command.
**Fix:** Use the board-only half and defer detection until the lock is released.

```rust
// forge/mod.rs: expose the board-only half
pub fn stored_forge_and_repo_path(conn: &Connection, project_id: &str) -> anyhow::Result<(Option<Forge>, PathBuf)> { /* existing body */ }

// forge.rs, forge_request_for_epic
let (stored, repo_path) = { /* lock, SELECTs, stored_forge_and_repo_path */ };
let forge = stored.unwrap_or_else(|| flywheel_core::forge::detect_forge_from_origin(&repo_path)); // lock released
```

Then correct the header sentence. The same applies to `forge_request_for_task` and `forge_open_request`, which are Phase 7 and were accepted as tolerated.

### WR-02: The pub "composer" functions keep the footgun, and `assemble_context_packet` still does git under the lock and hard-fails on it

**File:** `packages/core/src/context_packet.rs:263-265`, `packages/desktop/src-tauri/src/commands/agent_run.rs:449-463,542-545`, `packages/desktop/src-tauri/src/commands/review.rs:21-25`
**Issue:** The `review.rs` command header now says holding the lock across the git half "is not expressible". That is not true. `plan_merge`, `resolve_review_target`, `review_file_list`, `review_file_patch`, `review_criteria_state`, `epic_request_preconditions`, `assemble_epic_request_draft` and `is_integrated` remain `pub` and take `&Connection` while spawning git. They are required by the integration tests, so they cannot be removed. `context_packet.rs:263` calls `resolve_review_target(conn, ..)` whenever any criterion is anchored, and `agent_run_preview` and the start path call the packet assembler with the connection from `state.db.lock()` (`agent_run.rs:463`). This is the prior WR-10 / CR-01 bullet: it runs `rev-parse` and `merge-base` under the lock, and a target-resolution error still aborts packet assembly via `?` instead of degrading staleness to `None`.
**Fix:** In `context_packet.rs`, use `resolve_review_target(..).ok()` and leave `anchor_staleness` as `None` on error, so a decoration cannot abort agent launch. Mark the composers `#[doc(hidden)]` (or rename them `*_blocking`) and soften the "not expressible" wording to "not possible from the halves". Longer term, give `assemble_context_packet` the same two-half shape.

### WR-03: The two invariants this round introduced have no regression guard

**File:** `packages/desktop/src-tauri/src/commands/mod.rs:26-38`, `packages/desktop/src-tauri/src/commands/review.rs`, `packages/desktop/src-tauri/src/commands/forge.rs`
**Issue:** There is no test for `ipc_error` (its `failed:<context>` format, or that it never includes the cause), none that scans the two command modules for a reintroduced `.map_err(|e| e.to_string())`, and none that pins the nine renderer-parsed prefixes. Nothing exercises `plan_merge_inputs`, `finish_plan`, `review_target_inputs`, `finish_review_target`, `epic_request_inputs`, `epic_request_blocker`, `epic_draft_inputs` or `finish_epic_request_draft` directly. They are covered only indirectly through the composers. The repo already uses source-scan gates (`supervisor_cwd.rs`, `forge_degrade.rs`). The only edit under `packages/core/tests` in this round is the roll-up tests. A single later `e.to_string()` or a lock held one line too long would reopen CR-01 or CR-02 silently.
**Fix:** Add a unit test in `commands/mod.rs` that `ipc_error("a:b", anyhow!("git -C \"/home/u/repo\" failed: boom"))` equals exactly `"failed:a:b"`. Add a source-scan test asserting `commands/review.rs` and `commands/forge.rs` contain no `e.to_string()` or `format!("{e` in a `map_err`, and that each of the nine prefix literals appears. Add a core test that `finish_plan` and `finish_review_target` work with the connection dropped, which the signatures already prove at compile time.

### WR-04: Checking a criterion against a selection still fails silently

**File:** `packages/desktop/src/review/CriteriaRail.tsx:27-39`
**Issue:** Re-verified present. `useMutation` has no `onError` and the returned callback is `mutation.mutate`, so a rejection (a criterion that does not belong to the item, no branch to anchor against, a git failure, a partial anchor) is discarded. The footer then reads "Checking a criterion records this as its evidence", as if it had worked. With CR-02 closed, the only rejection text is now a generic category, so surfacing it leaks nothing. Also, `useCallback(..., [mutation])` depends on the `mutation` object, which changes identity every render, so the callback is not stable.
**Fix:** Render a generic line (for example "Could not record that check.") from `mutation.isError` in the footer, clear it on the next attempt with `mutation.reset()`, and depend on `mutation.mutate` (which is stable) in the `useCallback`.

### WR-05: Two concurrent `forge_open_epic_request` calls can push twice and open duplicate requests

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:358-407`, `packages/core/src/forge/mod.rs:405-441`
**Issue:** Re-verified present. The command is `async` and runs on a pool. `open_epic_request_at` does lookup, push, then create with no mutual exclusion. The sheet's `openingRef` guards one sheet instance only. A second invocation can see "no open request", push, and call create. The loser's create failure is then reported as `PushedButNotOpened`, which is false. The merge path already has `try_lock_epic` for the same shape.
**Fix:** Hold a per-epic "requesting" guard (a sibling of `EPICS_MERGING`) around `open_epic_request_at` and return a named `requestInFlight:<key>` error. Add it to `EpicRequestSheet.failureText`.

### WR-06: Every push failure is reported as "rejected"

**File:** `packages/core/src/forge/mod.rs:423-425`, `packages/desktop/src/review/EpicRequestSheet.tsx:166-171`
**Issue:** Re-verified present. Any `Err` from `push_branch` (timeout, git missing, no network, auth refused, no `origin`) becomes `PushRejected`, and the sheet says "The push was rejected, so no request was created". After a timeout the branch may already be on the remote, so "nothing reached the remote" is not provable.
**Fix:** Add a `PushFailed` outcome (and DTO kind) with its own sentence, and word the timeout case as "unknown, check the remote".

### WR-07: The stored anchor sha is the branch head at click time, not the commit the user read

**File:** `packages/desktop/src-tauri/src/commands/review.rs:321-333`
**Issue:** Re-verified present. The sha is resolved from the head ref when the check is made. If the task branch advanced since the diff was rendered, the anchor records the newer sha with line numbers from the older diff, and `anchor_staleness` then reports "Untouched" for code the user never saw.
**Fix:** Have the renderer send the head the diff was read at (from `ReviewTargetDto.head`) as an expected value. Re-resolve in the command and refuse with a named "branch moved since you opened this diff" error on mismatch. The stored sha stays core-resolved.

### WR-08: "What you saw is what you sent" is not guaranteed for the epic request

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:369-390`, `packages/core/src/forge/request_body.rs:166-265`
**Issue:** Re-verified present. `forge_open_epic_request` re-reads the board and re-runs the per-task ancestry checks at confirm time. Any change since the preview (an agent checking a criterion, a merge landing) publishes a body the user did not see, to a possibly public forge. The two-half split makes the window slightly longer between board read and git half, though still one consistent board snapshot.
**Fix:** Return a SHA-256 of title plus body with the preview, send it back on confirm, and refuse with `draftChanged` on mismatch so the sheet re-fetches.

### WR-09: A merge that lands in git but is not recorded can never become "integrated"

**File:** `packages/desktop/src-tauri/src/commands/review.rs:470-482`, `packages/core/src/merge.rs:203-223`
**Issue:** Re-verified present. If `record_merge_event` fails after `run_merge` succeeded, the command returns `eventNotRecorded`. A retry then hits `finish_plan`'s zero-commits `NothingToMerge` refusal, and `AlreadyIntegrated` records nothing by design. The task never shows as integrated, and the epic request body lists it as "not integrated".
**Fix:** Retry the event write once before returning `eventNotRecorded`. Better, let a retry detect "source is already an ancestor of target and no integrated event exists" and record the existing merge commit.

### WR-10: The conflict brief is bounded by file count, not by the instruction cap

**File:** `packages/desktop/src/review/MergeConfirmSheet.tsx:70-79`
**Issue:** Re-verified present. The brief lists up to 50 paths regardless of length, plus about 390 characters of fixed text. Fifty paths averaging more than about 70 characters exceed the 4000-character `agent_run_start` cap, and the user then sees only "Could not start a session on this task." Paths are interpolated raw, so a newline in a path injects lines into the agent prompt, and the session starts with `acceptEdits`.
**Fix:** Build the list until a character budget (for example 3000) is reached, append "...and N more", and replace control characters in paths.

### WR-11: Anchor paths are written verbatim into a public PR body

**File:** `packages/core/src/forge/request_body.rs:314-325`
**Issue:** Sink half of the prior WR-02, re-verified. `render_epic_body` does `out.push_str(path)` for each anchored criterion with no escaping, and the body is published to a forge. A path containing `\n` (legal in git) injects arbitrary lines or Markdown into the request. The source half (`check_criterion_with_anchor` validating only length, side and range) is in `acceptance_criterion.rs`, outside this round's file list, and was not re-read.
**Fix:** In `render_epic_body`, replace control characters in `path` before writing it, or render it in a code span after stripping `\n`, `\r` and backticks. Validate at the write path as well (reject control characters in `a.path`).

## Info

### IN-01: The CR-03 guard enumerates `button, a, [role='button']` only

**File:** `packages/desktop/src/state/keyboard.ts:305-313,761-765`
**Issue:** Other elements that own Enter or Space activation (`[role=checkbox]`, `[role=switch]`, `[role=tab]`, `[role=menuitem]`, `[role=option]`, `[role=link]`, `summary`, `select`) fall through, so an Enter-bound region would still claim their keydown. Nothing in the review surface renders those today, so there is no live defect. Separately, `preventDefault()` still runs before the handler's own `!sheetOpen` check, so with a sheet open and focus on a non-interactive node, Enter and Space are cancelled for no effect (for example Space scrolling a focused sheet body).
**Fix:** Widen the selector to the ARIA activation roles, and, if cheap, let a handler return `false` to signal "not handled" so `preventDefault` runs only when it acted.

### IN-02: The roll-up carries data the rail never uses, and cannot tell an error from an empty epic

**File:** `packages/desktop/src/review/CriteriaRail.tsx:52,72-91`, `packages/core/src/review.rs:395-407`
**Issue:** `status` and `with_evidence` cross the whole stack (core, DTO, adapter, test fixtures) but only `checked`, `total` and `withoutEvidence` are rendered. `useEpicTaskRollup(...).data ?? []` makes a failed read look the same as an epic with no tasks, so the section silently disappears. Neither is wrong under the "absence is the design" rule the file states, but both should be a decision rather than an accident.
**Fix:** Either render the status word beside the key or drop `status` and `with_evidence` from the DTO. Optionally show a one-line "Could not read task criteria" when `isError`.

### IN-03: Unreachable `blocked:` return in `forge_open_epic_request`

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:384-386`
**Issue:** `draft_inputs` is `None` only when `inputs.has_integration_branch()` is false, and in that case `epic_request_blocker` has already returned `NoIntegrationBranch` and the command returned at line 381-383. The new `let Some(draft_inputs) = ... else { return Err(..) }` is dead code kept as a defensive fallback.
**Fix:** Keep it with a one-line comment saying it is defensive, or restructure so the draft inputs are an `Option` consumed once.

### IN-04: The capabilities roster is stale and not an enforcement point

**File:** `packages/desktop/src-tauri/capabilities/default.json:4`
**Issue:** Re-verified. `review_epic_task_rollup` was added correctly, but the roster still omits registered commands (`criterion_revise`, `criterion_revisions`, `epic_list_all`, `issue_set_parent`, `task_set_epic`, `menu_set_action_enabled`, `agent_run_discard`, `task_session_summaries`, every `authoring_*`). The file's own text says `generate_handler!` is the real boundary.
**Fix:** Generate the roster from `main.rs` in a test, or replace the prose list with a pointer to `generate_handler!`.

### IN-05: Test fixtures leak process-global environment when a test panics

**File:** `packages/core/tests/criterion_anchors.rs:17-26`, `packages/core/tests/review_merge.rs:17-26`
**Issue:** Re-verified in both files. `with_scratch_worktree_root` restores `FLYWHEEL_WORKTREE_ROOT` after `f()` returns, so an assertion panic skips the restore. The mutex poison is recovered, but a dangling variable pointing at a deleted tempdir persists into later tests in the same binary. The new roll-up test `rollup_ignores_superseded_criterion_revisions` runs inside this helper.
**Fix:** Restore in a `Drop` guard so it runs during unwinding.

## Not re-examined this round

These first-round findings are in files outside this round's 20-file scope. They were not re-read, so their status is unchanged and unverified:

- Locale-dependent "Already up to date" and push-error classification (`packages/core/src/git.rs`, prior WR-01).
- Anchor path and range validation in `check_criterion_with_anchor` (`acceptance_criterion.rs`, source half of prior WR-02; sink half is WR-11 above).
- `criterion.toggled` payload misreporting the anchor on no-anchor check and uncheck (`acceptance_criterion.rs`, prior IN-01).
- `safeHref` present only in `EpicRequestSheet`, absent from `ForgeSection` (prior IN-02).
- Option-like ref names not rejected in `git.rs` and `merge.rs` argv (prior IN-03; the `merge.rs` call sites are unchanged in this round's diff).

---

_Reviewed: 2026-10-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
