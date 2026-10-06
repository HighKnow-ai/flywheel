---
phase: 08-review-and-merge-inside-flywheel
plan: 08
subsystem: review
tags: [rust, tauri, react, forge, pull-request, epic, scope-toggle]
status: complete

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "assemble_epic_request_draft, epic_request_preconditions, open_epic_request_at (08-05); ReviewSurface with the Merge action and review hooks (08-07); reviewSurface store field (08-01)"
provides:
  - "forge_epic_request_draft, forge_open_epic_request, forge_request_for_epic: three Tauri commands that take an epic id alone"
  - "EpicRequestSheet and EpicRequestBar: preview-then-confirm, four named blockers, partial outcome reported as its own state, read-only open request"
  - "safeHref: http/https allow-list for any forge-supplied URL before it becomes a link target"
  - "Header scope toggle: one review surface for a task and its epic, driven by the reviewSurface store field"
affects: []

requirements-completed: [REVW-05, REVW-02]

duration: "~25 min"
completed: 2026-10-06

actuals:
  tokens: 21400
  tasks: 3
  commits: 3
plan_head_before: 849f4d83bdcc001979bb83f34f8c3687d51aa409

coverage:
  - deliverable: "Three epic-scoped commands: id alone, blocked epic refused by name before any push, database lock released once before the push, no status write, raw CLI output logged and never returned"
    verification:
      - kind: command
        ref: "cargo build --workspace; cargo test --workspace -- --skip credential --skip api_key (97 suites ok); grep gates: each command x1 in main.rs, no title/body/head_branch parameter, drop(conn) x1 in the open command, capability roster x1, ForgeRequestDto declared once, zero status UPDATEs in forge.rs"
        status: pass
    human_judgment: false
  - deliverable: "Epic request sheet: draft rendered verbatim, confirm carries one argument (the epic id), opening and cancelling make no write, double activation opens once"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/epic-request.test.tsx (EpicRequestSheet: preview then confirm)"
        status: pass
    human_judgment: false
  - deliverable: "Blockers and outcomes: no integration branch, nothing to propose, no remote named; no forge renders nothing; CLI not installed / not authenticated named; rejected push; pushed-but-not-opened distinct from success; already-open read-only; non-web URL scheme not linked"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/epic-request.test.tsx (the four blockers, what happened, safeHref, EpicRequestBar)"
        status: pass
    human_judgment: false
  - deliverable: "Scope toggle: store field written on each hop, back to the same task, absent for an epic-less task, direct epic open, NULL integration branch shows the absence with the epic's criteria, selection cleared on a scope change"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/epic-request.test.tsx (ReviewSurface: the scope toggle)"
        status: pass
    human_judgment: false
  - deliverable: "Opening the request twice for one integration branch surfaces or reuses the existing request"
    verification:
      - kind: test
        ref: "packages/core/tests/forge_live_chain.rs#epic_request_asked_twice_surfaces_the_existing_request_instead_of_creating_a_second (fake gh); epic-request.test.tsx 'shows an existing open request read-only'"
        status: pass
    human_judgment: true
    rationale: "Plan marked this backstop. Proven against the fake CLI only; a live double-open against a real forge, and a real push through the desktop shell, were not exercised."
  - deliverable: "Epic scope renders the epic's criteria plus a roll-up of its tasks (D-132)"
    human_judgment: true
    rationale: "The epic's own criteria render; the task roll-up does not exist. See Deviations 1."
  - deliverable: "Sheet layout and wording, the rail staying usable over a long diff, and a real epic request end to end in the packaged app"
    human_judgment: true
    rationale: "Visual and ergonomic judgement (VALIDATION.md manual row 2); the packaged app was not driven. Deferred to end-of-phase human verification."

key-files:
  created:
    - packages/desktop/src/review/EpicRequestSheet.tsx
    - packages/desktop/src/review/__tests__/epic-request.test.tsx
  modified:
    - packages/desktop/src-tauri/src/commands/forge.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/review/useReviewQuery.ts
    - packages/desktop/src/review/ReviewSurface.tsx
    - packages/desktop/src/state/uiStore.ts
    - packages/desktop/src/App.tsx

key-decisions:
  - "forge_open_epic_request re-checks the four preconditions itself and refuses a blocked epic as blocked:<name> before any push, so the renderer cannot reach a push by calling it directly"
  - "PushRejected and PushedButNotOpened cross the boundary without detail text; the detail goes to the error log"
  - "The surface reads the preview itself (a free, read-only read) because whether the action is offered, and which sentence is shown, depends on it; no-forge and no-integration-branch render nothing in the bar"
  - "Toggling to epic scope stores fromTask on the reviewSurface field so toggling back returns to the same task; the epic's label comes from the existing epic roster, falling back to the word Epic"
  - "Only an open or changes-requested request counts as already open; a merged one for the same branch does not hide the action"

duration: "~25 min"
---

# Phase 8 Plan 08: Epic Request and Scope Toggle Summary

**An epic's integration branch is proposed to the forge from the review surface: the draft is previewed verbatim and confirmed with an epic id alone, each blocker is named or (for no forge) absent, and a push that landed without a request is reported as exactly that. A header toggle moves one surface between a task and its epic.**

## Accomplishments

- **Three commands (29f68c6).** `forge_epic_request_draft` returns the draft plus the named blocker. `forge_open_epic_request` checks the preconditions, assembles its own draft with the same function the preview used, drops the lock once, then calls `open_epic_request_at`; the four outcomes become a tagged DTO and forge errors become the `"<category>:<cli>"` strings the task command already produces. `forge_request_for_epic` reads the existing request for the integration branch through the existing Phase 7 dispatcher. All three are registered in `main.rs` and the capability roster. Nothing writes a status or registers a poll.
- **The sheet (747d087).** `EpicRequestSheet` renders `draft.title` and `draft.body` as returned and calls `forgeOpenEpicRequest` from one place with the epic id alone. `EpicRequestBar` decides what sits under the header: the existing request read-only, a one-sentence blocker, the action, or nothing. The pushed-but-not-opened outcome is an alert with its own wording ("Pushed, but no request was opened ... is now on the remote and no request exists"), tested as distinct from the success text. `safeHref` allow-lists http and https; any other scheme renders as plain text.
- **The toggle (f7df739).** Two buttons, "This task" and "Whole epic", rewrite the `reviewSurface` store field (`scope`, `itemId`, `label`, and `fromTask` when hopping to the epic). Absent for an epic-less task and for an epic opened directly. A scope change clears the line selection, the focused criterion and the opened files. The request bar mounts only for a resolved epic target; Merge stays task-scope only.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | 29f68c6 | Three epic-scoped forge commands, registration, capability roster, adapter wrappers |
| 2 | 747d087 | Epic request sheet and bar, hooks, surface mount, 23 tests |
| 3 | f7df739 | Scope toggle, store and App wiring, 8 more tests (31 in the file) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan premise wrong] The roll-up of an epic's tasks does not exist**
- **Found during:** Task 3
- **Issue:** the plan says epic scope renders "a roll-up of its tasks ... the rail builds from the state command's entries". The rail (08-06) renders the epic's own criteria through the item panel's list, and `review_criteria_state` returns one item's criteria only. No command lists an epic's tasks with criteria counts (`list_tasks_for_epic` is agent-side, not exposed).
- **Outcome:** not built. Building it needs a new core query, a command and a rail section, none in this plan's files. Epic scope shows the epic's own criteria and the accumulated file list. Logged in `.planning/WINDOWS.md` as an unmet truth for the verifier to rule on.

**2. [Rule 2 - Missing critical] The open command re-checks the preconditions**
- **Issue:** the plan's command would push whatever it was asked to, so a direct call for an epic with nothing to propose or no remote would push first and fail later.
- **Fix:** it refuses a blocked epic as `blocked:<name>` before the push; the sheet renders that as the same sentence. The drop count (one) and the no-text-parameter greps still hold.

**3. [Rule 2 - Missing critical] A rejected push returns no detail text**
- **Issue:** `PushRejected.detail` is git's own message. The plan says raw CLI output is logged, never returned.
- **Fix:** the DTO variant carries no detail; the command logs it.

**4. [Layout] The request action sits in a bar under the header, not in the header row**
- Blocker sentences are too long for the header row, and the action, the open request and the sentences are mutually exclusive, so they share one bar. The scope toggle is in the header as planned.

**5. [Rule 3 - Blocking] `App.tsx` and `uiStore.ts` changed**
- The toggle needs to remember the task it came from, so `ReviewSurfaceTarget` gained an optional `fromTask` and App passes it through. Neither file was in `files_modified`.

**6. [Gate wording] `title:`/`body:` grep**
- The plan's grep forbids those literals in the sheet. The sheet reads `draft.title` and `draft.body` but declares no such keys; the gate holds at 0. The request bar's existing-request link reads `request.title`, which the grep does not match.

**Total deviations:** 1 plan-premise gap (not built), 2 added guards, 3 minor. **Impact:** one must_have truth (the task roll-up) is not met.

## Verification

- `cargo build --workspace`: ok. `cargo test --workspace -- --skip credential --skip api_key`: 97 suites ok, exit 0 (the `credentials` binary blocks on the macOS keychain in an unattended session; pre-existing and recorded in 08-03). `supervisor_cwd` is in that run. `cargo test -p desktop`: 45 passed.
- `npm --prefix packages/desktop run test`: 50 files, 754 tests passed; `epic-request.test.tsx` has 31, `forge-section.test.tsx` 30. `npm run build` and `npx tsc --noEmit`: clean.
- Grep gates: each command once in `main.rs`; no `title: String`, `body: String` or `head_branch: String` in the open command; `drop(conn)` once in it; the capability roster names it; `ForgeRequestDto` declared once; zero `UPDATE (tasks|epics) SET` in `forge.rs`; zero `title:`/`body:` and one `forgeOpenEpicRequest` in the sheet's non-comment lines.

## Issues Encountered

- The first run of the new tests failed 16 of 23: the confirm button exists, disabled, before the draft arrives, so clicks landed on a disabled button, and a `document.body.innerHTML` cleanup broke React's unmount. Fixed in the tests (wait for the enabled button, use RTL `cleanup`).
- The epic criteria assertions had to go through `invokeCommand`, because the item panel's list and the rail share one query key and whichever mounts first supplies the fetch.
- Not driven: the packaged app. A real push and request through the Tauri shell, the sheet's look, and the rail over a long diff are deferred to end-of-phase human verification.

## Known Stubs

None.

## Threat Flags

None beyond the plan's `<threat_model>`. T-08-08-01 to -07 are mitigated as planned: id-only confirm asserted field by field, no text parameter on any command, scheme allow-list tested, partial outcome distinct, one lock release before the push, errors by category only, no status write.

## Follow-up (by plan)

- No epic-request observer, so an epic request that merges carries nothing to Done (D-122, D-145).
- No compare-page fallback for a missing CLI (research assumption A5, unverified).
- The epic task roll-up above.
- The same scheme allow-list is still missing from Phase 7's `ForgeSection.tsx` links; this plan did not touch it.

## Self-Check: PASSED

`EpicRequestSheet.tsx` and `epic-request.test.tsx` exist on disk; commits 29f68c6, 747d087 and f7df739 are in `git log`; `git rev-list --count` from `plan_head_before` is 3.
