---
phase: 08-review-and-merge-inside-flywheel
reviewed: 2026-10-06T00:00:00Z
depth: standard
files_reviewed: 53
files_reviewed_list:
  - packages/core/src/context_packet.rs
  - packages/core/src/db/migrations/0018_criterion_anchors.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/acceptance_criterion.rs
  - packages/core/src/epic_context_packet.rs
  - packages/core/src/forge/mod.rs
  - packages/core/src/forge/request_body.rs
  - packages/core/src/git.rs
  - packages/core/src/lib.rs
  - packages/core/src/merge.rs
  - packages/core/src/query/authoring.rs
  - packages/core/src/review.rs
  - packages/core/tests/common/mod.rs
  - packages/core/tests/context_packet.rs
  - packages/core/tests/criterion_anchors.rs
  - packages/core/tests/epic_request_draft.rs
  - packages/core/tests/forge_live_chain.rs
  - packages/core/tests/review_diff.rs
  - packages/core/tests/review_merge.rs
  - packages/desktop/package.json
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/forge.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/review.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/App.tsx
  - packages/desktop/src/board/__tests__/review-doors.test.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/CommandPalette.tsx
  - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx
  - packages/desktop/src/item-detail/ItemDetailPanel.tsx
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/review/__tests__/criteria-rail.test.tsx
  - packages/desktop/src/review/__tests__/epic-request.test.tsx
  - packages/desktop/src/review/__tests__/highlight.test.ts
  - packages/desktop/src/review/__tests__/merge-sheet.test.tsx
  - packages/desktop/src/review/__tests__/review-surface.test.tsx
  - packages/desktop/src/review/CriteriaRail.tsx
  - packages/desktop/src/review/EpicRequestSheet.tsx
  - packages/desktop/src/review/FileDiff.tsx
  - packages/desktop/src/review/highlight.ts
  - packages/desktop/src/review/MergeConfirmSheet.tsx
  - packages/desktop/src/review/review.css
  - packages/desktop/src/review/ReviewSurface.tsx
  - packages/desktop/src/review/selection.ts
  - packages/desktop/src/review/useReviewQuery.ts
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/state/__tests__/keyboard-agent.test.ts
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
findings:
  critical: 3
  warning: 11
  info: 5
  total: 19
status: issues_found
---

# Phase 8: Code Review Report

**Reviewed:** 2026-10-06
**Depth:** standard
**Files Reviewed:** 53
**Status:** issues_found

## Summary

The phase adds a review surface (diff, criteria rail with anchors), an in-app merge into an epic integration branch, and an epic request flow. The structure is sound: `spawn_git` is still the only `Command::new("git")` in the source trees (grep confirmed), the anchor write path is one transaction with one event and anchors are cleared on uncheck, migration 0018 is correct (FK cascade works because `foreign_keys=ON` is set per connection), every Phase 8 command is both in `generate_handler!` and named in the capabilities roster, and `safeHref` correctly allow-lists `http(s)`.

The weaknesses cluster in four places:

1. The "git never runs under the SQLite lock" invariant that `merge.rs` and `forge/mod.rs` state in their headers is not true for `plan_merge`, the epic request preview/open path, and every review read that touches an integrated task.
2. Raw git stderr and absolute repo paths still cross the IPC boundary through bare `e.to_string()` in the new commands.
3. The window-level key bindings added for the review surface swallow `Enter` on every button and cascade `Escape` into the surface.
4. Anchor evidence is weaker than its design claims: the path is unvalidated and the sha is the head at click time, not at read time.

## Structural Findings (fallow)

None provided for this review.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Git subprocesses run while the single SQLite mutex is held (plan/run/record split is not honoured)

**File:** `packages/core/src/merge.rs:160-165`, `packages/desktop/src-tauri/src/commands/review.rs:337-340,382-392`, `packages/core/src/forge/mod.rs:266-303`, `packages/core/src/forge/request_body.rs:207-211`, `packages/desktop/src-tauri/src/commands/forge.rs:314-325,354-368`, `packages/core/src/review.rs:107`
**Issue:** The `merge.rs` header claims `plan_merge` "resolves everything under a connection" and that no caller can hold the lock across a subprocess. But `plan_merge` itself spawns `git rev-list --count` and `review_files` (two `git diff` runs). Both `review_merge_precheck` and `review_merge_task` call it while holding `state.db.lock()`. The same pattern appears elsewhere:

- `epic_request_preconditions` runs `ahead_behind` (`rev-parse` plus `rev-list`) and `git remote get-url origin` on a connection, and `forge_epic_request_draft` and `forge_open_epic_request` call it under the lock.
- `assemble_epic_request_draft` calls `merge::is_integrated` once per task in the epic, each of which is up to three git spawns, again under the lock.
- `resolve_review_target` calls `is_integrated` (rev-parse and merge-base) for any task with an integrated event. It is called under the lock by `review_files`, `review_file_patch`, `review_criteria_state` and `criterion_check_with_anchor`.
- `assemble_context_packet` now does per-anchor git work under the lock (see WR-10).

Every command in the app shares one `AppState.db` mutex, so a slow repository, a lock-contention retry in `git_at`, or a 120 s `GIT_TIMEOUT_SECS` timeout per spawn freezes the whole board. An epic with N tasks multiplies it by about 3N spawns. `forge/mod.rs` explicitly documents why this is a bug ("a database lock must never be alive while a forge CLI runs") and tolerates only a single bounded `git remote get-url`. This phase adds many more.
**Fix:** Split the DB half from the git half, as `review::criteria_with_anchors` / `with_staleness` already do.

```rust
// merge.rs: DB half only (no git), returns plain values
pub fn plan_merge_inputs(conn: &Connection, task_id: &str) -> anyhow::Result<MergePlanInputs> { /* SELECTs only */ }
// git half: takes no connection
pub fn finish_plan(inputs: MergePlanInputs) -> anyhow::Result<MergePlan> { /* rev-list, review_files */ }
```

In the commands: `let inputs = { let conn = lock; plan_merge_inputs(&conn, &id)? };` then call `finish_plan(inputs)` with the lock dropped. Do the same for `epic_request_preconditions` and `assemble_epic_request_draft`: read the epic, project, task rows and integrated-event commit ids under the lock, then run the ancestry checks lock-free. Correct the `merge.rs` header once it is true.

### CR-02: Raw git stderr and absolute repo paths are returned to the renderer through `e.to_string()`

**File:** `packages/desktop/src-tauri/src/commands/review.rs:127,150,276,346-352,388`, `packages/desktop/src-tauri/src/commands/forge.rs:315-316,322,357-358,361-362`
**Issue:** `git_at` builds its error as `"git -C {repo_path:?} {args:?} failed (exit ..): {stderr}"`, and `merge_tree_check` bails with `{stderr}` too. `anyhow::Error::to_string()` returns that outermost message verbatim. These command paths return it as the `Err(String)` sent to the webview:

- `review_files`, via `files_for_target(...).map_err(|e| e.to_string())`.
- `review_file_patch`, same shape.
- `criterion_check_with_anchor`, via the `rev-parse` `git_at` call.
- `review_merge_precheck`, via `merge_tree_check` (stderr) and the non-refusal `plan_merge` error (rev-list).
- `review_merge_task`, via the non-refusal `plan_merge` error at line 388. This is the same command whose doc comment says the raw cause is "logged, never returned".
- `forge_epic_request_draft` and `forge_open_epic_request`, via `epic_request_preconditions` (`ahead_behind`) and `assemble_epic_request_draft`.

The project rule, stated in `forge.rs` (T-07-08-01, T-08-08-06) and `review.rs`, is that CLI and git stderr is logged and only a category crosses IPC. This leaks stderr, the user's home path and the repo layout to the renderer, which is the component that renders agent-produced and repo-supplied content.
**Fix:** Add one helper next to `parse_scope` and use it everywhere a core error is mapped.

```rust
fn ipc_error(context: &str, e: anyhow::Error) -> String {
    eprintln!("{context}: {e:#}");
    format!("failed:{context}")
}
// usage: .map_err(|e| ipc_error("review_files", e))?
```

The renderer already treats any unparsed message as the generic failure, so no TypeScript change is needed.

### CR-03: The review surface's window-level `Enter`/`Space` bindings swallow button activation (including the merge confirm)

**File:** `packages/desktop/src/state/keyboard.ts:279-280,745-759`, `packages/desktop/src/review/ReviewSurface.tsx:237-250`
**Issue:** `useRegionBindings` registers a `window` keydown listener that calls `event.preventDefault()` before invoking the handler whenever `resolveBinding` matches. `isTypingTarget` excludes only `INPUT`, `TEXTAREA` and contenteditable, so a focused `<button>` does not count as typing. The review region binds `Enter` and `" "` to `expand-file`. The consequences:

- A keyboard user who tabs to a file row, "Merge", "← Board", the scope toggle, "Open request" or a criterion's "Check against selection" and presses Enter gets `preventDefault` on keydown. That cancels the button's click activation. The handler then toggles `focusedPath`, which is the previously clicked file, not the focused one.
- `preventDefault` runs before the handler's own `!sheetOpen` guard. With the Merge or Epic Request sheet open, Enter on the primary "Merge" or "Open request" button is eaten, so a keyboard user cannot confirm from the sheet. The sheets are portaled but the listener is on `window`.

This is a keyboard-first product, and the destructive confirmation has no working Enter path.
**Fix:** Do not claim keys that belong to a focused interactive element.

```ts
// keyboard.ts, resolveBinding / useRegionBindings
function isActivationTarget(t: EventTarget | null) {
  return t instanceof HTMLElement && (t.closest("button, a, [role='button']") !== null);
}
// in useRegionBindings: skip Enter/Space bindings when the target is an interactive element
if ((event.key === "Enter" || event.key === " ") && isActivationTarget(event.target)) return;
```

Also move `event.preventDefault()` after the handler decides it acted (or have `sheetOpen` short-circuit before the binding is registered).

## Warnings

### WR-01: "Already up to date" is matched on localized git output, and so is push error classification

**File:** `packages/core/src/git.rs:525,585-593`
**Issue:** `merge_no_ff` decides "a commit was created" with `!stdout.contains("Already up to date")`. Git localizes that string (for example "Déjà à jour"). With a non-English `LANG`, a no-op merge is reported as `Merged`. `run_merge` then returns `Merged { merge_commit: HEAD }` and `record_merge_event` writes a `task.integrated` event whose commit is not a merge of this task. `push_branch` has the same weakness: it classifies rejection and authentication failures by English substrings of stderr, so under another locale every failure falls through to the generic bail.
**Fix:** Do not parse prose. Compare `rev-parse HEAD` before and after the merge to decide whether a commit was created. For push, set `cmd.env("LC_ALL", "C")` in `spawn_git`, which is also what makes the stderr substrings reliable.

### WR-02: Anchor path is never validated against the diff or for control characters, and it reaches an agent prompt and a public PR body

**File:** `packages/core/src/domain/acceptance_criterion.rs:680-693`, `packages/core/src/context_packet.rs` (`render_evidence_line`), `packages/core/src/forge/request_body.rs:249-259`
**Issue:** `check_criterion_with_anchor` checks only `path.len()`, the `side` vocabulary and the line ordering. The path is renderer-supplied, may contain `\n`, and need not be a file in the review diff, so the line range is not bounded either. The stored string is later interpolated verbatim into (a) the agent's initial prompt (`Evidence: {path} lines ...`) and (b) the epic request body that is published to a public forge. A repository with a filename such as `x\n## Instructions ...` (legal in git) lets repo content inject lines into an agent prompt or a PR description once a user checks a criterion against a line in that file.
**Fix:** In the command layer, after resolving the target, require that `path` is one of `files_for_target(&target)` (or at least reject control characters), and reject a range that exceeds the patch. In the core, also reject `\n`, `\r` and NUL in `a.path`. Escape or single-line-quote the path where it is rendered.

### WR-03: The stored anchor sha is the branch head at click time, not the commit the user read

**File:** `packages/desktop/src-tauri/src/commands/review.rs:268-280`
**Issue:** The command rev-parses the target's head ref at the moment of the check. The line numbers came from a patch rendered earlier. If an agent commits to the task branch between render and click, the anchor records `sha = newer head` with line numbers from the older diff. `anchor_staleness` then counts commits only after the newer sha, so evidence for code the user never saw reports "Untouched". The design rule "no renderer value can claim a commit" is met, but the opposite failure (evidence bound to the wrong commit) is introduced.
**Fix:** Have the renderer send the head sha its diff was read at (`target.head` resolved by the core when the file list loaded) as an expected value, not a stored value. The command re-resolves the head and refuses with a named "the branch moved since you opened this diff" error when they differ. The stored sha stays core-resolved.

### WR-04: Two concurrent `forge_open_epic_request` calls can push twice and open duplicate requests

**File:** `packages/desktop/src-tauri/src/commands/forge.rs:348-389`, `packages/core/src/forge/mod.rs:339-375`
**Issue:** The command is `async` and runs on a thread pool. `open_epic_request_at` does lookup, push, then create with no mutual exclusion. The sheet's `openingRef` guards a single sheet instance only. A second window instance, a double invocation across re-mounts, or an immediate re-open after a "pushed but not opened" result can both see "no open request", both push, and both call `gh pr create`. The loser's create error then surfaces as `PushedButNotOpened`, which is false (a request exists). The merge path already has `try_lock_epic` for exactly this.
**Fix:** Take `merge::try_lock_epic(&epic_id)` (or a sibling `EPICS_REQUESTING` set) around `open_epic_request_at`, returning a named `requestInFlight:<key>` error.

### WR-05: Every push failure is reported as "rejected"

**File:** `packages/core/src/forge/mod.rs:357-359`, `packages/desktop/src/review/EpicRequestSheet.tsx:166-171`
**Issue:** `open_epic_request_at` maps any `Err` from `push_branch` (timeout kill, git not found, no network, auth refused, no `origin`) to `PushRejected`. The sheet then says "The push was rejected, so no request was created". `push_branch` already distinguishes rejected from authentication, and a timeout can leave the branch partly or fully pushed. For a timeout that may have landed, "Nothing reached the remote" is not provable, and the user is told nothing was pushed.
**Fix:** Add `PushFailed` (not rejected) to `EpicRequestOutcome` and the DTO with its own sentence, and treat a timeout as "unknown, check the remote".

### WR-06: Escape in the surface cascades: it closes the surface while a sheet or a criterion input is handling it

**File:** `packages/desktop/src/review/ReviewSurface.tsx:252-259`, `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx:410-438`
**Issue:** The surface listens for `Escape` on `window` and calls `onBack()` unless the render-time `sheetOpen` is true. The criteria list's edit and add inputs handle `Escape` with `preventDefault()` and cancel, but do not stop propagation, and `CriteriaRail` stops only `j k Space Enter`. So Escape while editing or adding a criterion cancels the edit and also pops the whole review surface (losing selection and opened files). For the sheets, Radix's capture-phase handler closes the sheet, React re-renders synchronously for a discrete event, the effect re-subscribes with `sheetOpen=false`, and the new window listener can still receive the same Escape. No test covers Escape with a sheet open.
**Fix:** Honour the "already handled" signal that both inputs and Radix already set.

```ts
function onKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.key !== "Escape" || sheetOpen) return;
  onBack();
}
```

Add a test that presses Escape with the merge sheet open and in a criterion edit input.

### WR-07: The conflict brief is bounded by file count, not by the 4000-character instruction cap, and embeds raw paths

**File:** `packages/desktop/src/review/MergeConfirmSheet.tsx:70-79`
**Issue:** The comment says the brief is bounded because the instruction field is capped server-side (4000 characters, per `agent_run_start`). The bound is 50 paths regardless of length. About 390 characters of fixed text plus 50 paths averaging more than about 70 characters already exceeds 4000, and `agent_run_start` then rejects it. The user sees only "Could not start a session on this task." Paths are also interpolated as-is, so a path with a newline injects text into the agent prompt (same class as WR-02), and the session starts with `acceptEdits`.
**Fix:** Build the list until a character budget (for example 3000) is reached and append "...and N more". Replace control characters in paths. Consider surfacing the server's too-long refusal distinctly.

### WR-08: Checking a criterion against a selection fails silently

**File:** `packages/desktop/src/review/CriteriaRail.tsx:27-38`
**Issue:** The `useMutation` has no `onError` and the callback uses `mutation.mutate`, so rejections (a criterion that "does not belong", "no branch to anchor against yet", a git failure resolving the sha, a partial anchor) are swallowed. The user pressed "Check against selection" and sees nothing; the criterion is simply not checked. Evidence capture is the point of the rail, and the footer text ("Checking a criterion records this as its evidence") reads as if it worked.
**Fix:** Surface `mutation.error` (generic sentence, details logged) in the rail's footer next to the selection line, and clear it on the next attempt.

### WR-09: "What you saw is what you sent" is not guaranteed for the epic request

**File:** `packages/core/src/forge/request_body.rs:141-216`, `packages/desktop/src-tauri/src/commands/forge.rs:354-368`, `packages/desktop/src/review/EpicRequestSheet.tsx:1-17`
**Issue:** The sheet header asserts the published text equals the previewed text "by construction". But the draft is re-assembled on confirm from live state: criteria `checked`, anchors, task status, and the git-derived `integrated` marker per task. Any change between opening the sheet and clicking Open (an agent checking a criterion, a merge landing, a status change) publishes a body the user did not preview, to a possibly public forge. The task-level equivalent from Phase 7 shares this, but this phase restates the guarantee and adds git-derived content.
**Fix:** Return a short content hash (SHA-256 of title + body) with the preview and send it back with the confirm. The command re-assembles and refuses with `draftChanged` on mismatch, so the sheet re-fetches and re-shows. Keeps the "epic id plus a hash, no text" input surface.

### WR-10: Assembling the agent context packet now hard-fails on git and depends on live git state

**File:** `packages/core/src/context_packet.rs` (`assemble_context_packet`, the `resolve_review_target(...).context(...)?` block)
**Issue:** When any checked criterion has an anchor, `assemble_context_packet` calls `resolve_review_target(...)?` and propagates its error. A decoration (staleness) can therefore abort agent launch and preview, for example when `is_integrated` cannot spawn git or an epic row is missing. Per-anchor staleness is already `.ok()`-swallowed one level down, so this is inconsistent. The packet also now varies with git state, so the launch preview and the prompt actually sent can differ after a commit. And all of it runs under the DB lock (CR-01).
**Fix:** Treat a target-resolution error as "staleness unmeasurable": `let target = resolve_review_target(...).ok();` and leave `anchor_staleness: None` (it already renders "could not be determined"). Move the git half out of the connection scope as in CR-01.

### WR-11: A merge that lands in git but is not recorded can never become "integrated" and has no repair path

**File:** `packages/desktop/src-tauri/src/commands/review.rs:410-423`, `packages/core/src/merge.rs:324-370`
**Issue:** `is_integrated` requires a `task.integrated` event. If `record_merge_event` fails after `run_merge` succeeded, the command returns `eventNotRecorded`. A retry then hits `plan_merge`'s zero-commits-ahead refusal (`nothingToMerge`), and `AlreadyIntegrated` records nothing by design. The task never shows as integrated, the post-merge review shows an empty three-dot diff ("No changes"), and the epic request body lists it as "not integrated". The sheet tells the user this, but offers no way out.
**Fix:** Let `plan_merge`/`run_merge` detect "source is already an ancestor of target and no integrated event exists" and record a `task.integrated` event with the existing merge commit (found via `git log --merges --first-parent --ancestry-path`), or at minimum expose a "record this merge" action. At the least, retry the event write once before returning `eventNotRecorded`.

## Info

### IN-01: The `criterion.toggled` event misreports and loses anchor information

**File:** `packages/core/src/domain/acceptance_criterion.rs:752-803`
**Issue:** `check_criterion_with_anchor(.., None, ..)` on an already-checked, anchored criterion leaves the anchor in place, but the event payload carries `"anchor": null` ("stored anchor, or null" per the doc comment). An uncheck deletes the anchor but the event records nothing about what evidence was cleared, so the event log cannot reconstruct the removed evidence.
**Fix:** On a no-anchor check, read the existing anchor and put it in the payload. On uncheck, add `"anchor_cleared": <previous anchor or null>`. Also have the command-level ownership check require `superseded_at IS NULL`, so evidence is not written onto a history row.

### IN-02: The URL allow-list exists only in the new sheet

**File:** `packages/desktop/src/review/EpicRequestSheet.tsx:28-37`, `packages/desktop/src/item-detail/ForgeSection.tsx:91,108`
**Issue:** `safeHref` correctly restricts forge-supplied URLs to `http:`/`https:`, but it is local to this file. `ForgeSection.tsx` renders the same `ForgeRequestDto.url` and `ciUrl` straight into `href`. The same untrusted field is sanitized in one component and not in its sibling.
**Fix:** Move `safeHref` into a shared module (for example `adapters/` or `lib/`) and use it in `ForgeSection` for both `url` and `ciUrl`.

### IN-03: Ref names derived from the database are not protected against option-like values

**File:** `packages/core/src/git.rs:248,334,461-465,500`, `packages/core/src/merge.rs:159`
**Issue:** `range = format!("{base}...{head}")`, `merge-tree ... target source` and `merge ... source` pass DB-derived branch names where git can read a leading `-` as an option. All values currently originate from Flywheel's own branch naming or project registration, not the renderer, so this is hardening rather than an exploit. Paths are correctly placed after `--` with `--literal-pathspecs`.
**Fix:** Validate stored branch names with `git check-ref-format --branch` when they are written, or assert `!name.starts_with('-')` in `spawn_git`'s callers for these functions.

### IN-04: The capabilities roster is prose, stale, and not an enforcement point

**File:** `packages/desktop/src-tauri/capabilities/default.json:4`
**Issue:** All nine Phase 8 commands are registered and named in the roster, and `shell:allow-execute` stays scoped to the sidecar. But the roster omits registered commands (`criterion_revise`, `criterion_revisions`, `epic_list_all`, `issue_set_parent`, `task_set_epic`, `menu_set_action_enabled`, `agent_run_discard`, `task_session_summaries` and every `authoring_*` command), so it misleads anyone auditing from it. The file's own text says `generate_handler!` is the real boundary.
**Fix:** Generate the roster from `main.rs` in a test, or drop the roster and keep a one-line pointer to `generate_handler!`.

### IN-05: Test fixtures leak process-global environment when a test panics

**File:** `packages/core/tests/review_merge.rs:17-26`, `packages/core/tests/forge_live_chain.rs:315-337`
**Issue:** `with_scratch_worktree_root` and `with_fake_forge_clis` restore `FLYWHEEL_WORKTREE_ROOT` and `PATH` after `f(...)` returns. If an assertion inside `f` panics, the restore is skipped. The mutex poison is recovered, but a dangling `FLYWHEEL_WORKTREE_ROOT` (a deleted tempdir) or an augmented `PATH` persists into later tests in the binary, which can turn one real failure into confusing secondary ones.
**Fix:** Restore in a `Drop` guard so it runs during unwinding.

---

_Reviewed: 2026-10-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
