---
phase: 11-ship-it
plan: 22
subsystem: review-diff-and-session-surface
tags: [accessibility, wcag-1-4-1, core-value, finish-review, three-3, four-1]
requires: ["11-17", "11-18"]
provides:
  - a text `+`/`-` sign in the review diff gutter, beside the line number, in both colour schemes
  - task_header and epic_header, two narrow core reads (key and title by id) with their own test binary
  - a session header that names its board item (task, else epic, else the word Session)
affects: [11-21 (rows three-3 and four-1 are no longer its to file), the owner (seven high findings still open)]
status: complete
commits: 4
plan_head_before: 2950d85e5e430b204db6f35bd0d1ca77621a606e
actuals:
  tokens: 17730
  tasks: 2
  commits: 4
key-files:
  created:
    - packages/desktop/src/review/__tests__/browser/diff-markers.browser.test.tsx
    - packages/core/tests/task_header_read.rs
  modified:
    - packages/desktop/src/review/FileDiff.tsx
    - packages/desktop/src/review/review.css
    - packages/core/src/query/authoring.rs
    - packages/desktop/src-tauri/src/commands/task.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/session.css
    - packages/desktop/src/session/__tests__/session-surface.test.tsx
    - .planning/phases/11-ship-it/11-FINISH-REVIEW.md
key-decisions:
  - "The sign lives in the gutter cell that holds the line number (new side of an added row, old side of a removed one), so unified view draws exactly one sign per changed row and context rows draw none."
  - "Two reads (task_header, epic_header) sharing one ItemHeader struct, rather than one read with two optional arguments: an authoring run has an epic and no task, and each read keeps one meaning."
  - "The header query swallows its own failure to null. A live run still needs its surface, and a rejected read must read as 'Session', not as an error state."
requirements-completed: []
duration: 25 min
completed: 2026-10-13
---

# Phase 11 Plan 22: Two high findings pulled forward Summary

A `+`/`-` text sign in the review diff gutter (closes three-3, WCAG 1.4.1) and a session header that names its task or epic through two new narrow core reads (closes four-1).

## Accomplishments

- **three-3.** `FileDiff.tsx` passes a `renderGutter` that prefixes the line number with `<span class="diff-sign">+</span>` on an added row's new-side cell and `-` on a removed row's old-side cell. Context rows and the empty cells carry nothing. `review.css` gives the sign weight 600 and a small margin and no colour of its own, so the row tint is unchanged in value and the sign adds no second hue layer. `ReviewSurface.tsx` was not modified.
- **four-1.** `core::query::authoring::{task_header, epic_header}` return `Option<ItemHeader { key, title }>`; an unknown id is `None`, not an error. Both are exposed as read-only Tauri commands, registered in `main.rs`, and added to the capability roster in `default.json`. The UI reaches them through `taskHeader`/`epicHeader` in `adapters/tauri.ts`. `SessionSurface` shows `KEY title` for a task run, the epic's `KEY title` for an authoring run, and `Session` when neither resolves or the read fails. A long title truncates (`.session-title`) rather than push the run controls off the row.

## RED output (recorded, per the success criteria)

Task 1, `diff-markers.browser.test.tsx` against the unchanged `FileDiff.tsx` (WebKit):

```
Tests  3 failed | 1 passed (4)
 FAIL  draws + on an added row and - on a removed row, as text in the gutter
   AssertionError: no added-row gutter carries a +: expected 0 to be greater than 0
 FAIL  keeps the line number beside the sign, so the gutter still names a line
   AssertionError: expected '' to match /\d/
 FAIL  paints the sign at 4.5:1 against its own gutter in the active scheme
   AssertionError: no sign element rendered: expected 0 to be greater than 0
```

The passing test is "draws neither sign on a context row", which holds trivially before the fix; it exists to stop the fix from over-drawing. Red commit: 7210f0d.

Task 2, core: `cargo test -p core --test task_header_read` did not compile before the fix (`unresolved imports core::query::authoring::epic_header, task_header`). Task 2, surface: `session-surface.test.tsx`, 4 of 4 new tests red (`Unable to find an element with the text: FLY-9 Add push retry`, the same for the epic, and the two fallback tests failed because the read was never issued). Red commit: f736458.

## Verification

- `diff-markers.browser.test.tsx`: 4/4 under `vitest.browser.config.ts` (light) and `vitest.browser.dark.config.ts` (dark). The sign is held to 4.5:1 against its own gutter in each.
- `src/review` jsdom 168/168; full browser arm 16 files, 129 passed, 1 expected fail; full jsdom suite 1463 passed, 2 expected fail.
- `cargo test -p core --test task_header_read`: 4/4. `cargo test -p desktop`: 149/149 (the test that reads `default.json` still passes with the roster edit).
- `npx tsc --noEmit`: clean.
- `grep -c '"Session"' SessionSurface.tsx` = 2 (fallback kept); `grep -cE "task_header|taskHeader" adapters/tauri.ts` = 3.
- Scope: `git diff --name-only` over this plan's commits touches `ReviewSurface.tsx` zero times.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan's premise about `FileDiff.tsx` was slightly off.** The plan says `FileDiff.tsx` "builds its gutter via `renderGutter`/`gutterEvents` (~lines 52, 90-97, 170)". Only `gutterEvents` existed; there was no `renderGutter`. I added one (the library's own extension point for exactly this) rather than invent a second gutter mechanism, which is what the plan asked for in spirit. No other file was needed.

**2. [Rule 2 - Missing critical] Long-title truncation.** A task or epic title can be up to 500 characters and the header is a flex row with the Stop/Discard controls. Without a rule the title would push them off-screen. Added `.session-title` (ellipsis, `min-width: 0`) and a `title` attribute carrying the full text. Not in the plan's file list for CSS; `session.css` was added to the task's commit.

**3. [Plan structure] Two reads, not one.** The plan says "one narrow core read" returning a task's key and title, and also requires an authoring run to name its epic, which has no task id. A task read alone cannot serve that. I added `epic_header` beside `task_header` (same struct, same shape, ten lines) instead of widening a list read, which the plan forbids. Each is narrow and separately tested.

**4. [Housekeeping] Two Phase 08 UAT screenshots overwritten by the browser arm** were restored with `git checkout`, twice, as the plan anticipated.

**5. [Housekeeping] `11-FINISH-REVIEW.md`** rows three-3 and four-1 were changed from `recorded` to `fixed (11-22 ...)` so plan 11-21 does not file them. Not in the plan's `files_modified`.

**Total deviations:** 5 (1 blocking-premise, 1 missing-critical, 1 plan-shape, 2 housekeeping). **Impact:** none on scope; both findings closed as specified.

## What was NOT done

The seven other high-severity findings from plan 11-17 (one-1, three-1, three-2, five-1, five-2, app-shell-1, app-shell-2) are untouched and remain routed to D-196 filing at plan 11-21. Finding three-4 (the 3% tint is too faint) was deliberately left alone; this plan added a sign beside the tint and did not raise it.

## Not claimed

The header was verified by jsdom assertions on rendered text and by a type-checked, compiling command path. It was not observed in a running installed build, and no reviewer has seen the sign column. Per the project's deferred-verification rule that is a Phase 11 redemption item, not something this plan observed.

## Known Stubs

None.

## Threat Flags

None. `task_header` and `epic_header` are read-only, take an id and nothing else, write nothing and spawn no process. They are not project-scoped, which is deliberate and noted in the doc comment: they serve the renderer, which already reads every project's rows through the board lists. They are not reachable by an agent (no MCP tool).

## Self-Check: PASSED

- Created files exist: `diff-markers.browser.test.tsx`, `task_header_read.rs`.
- Commits found in log: 7210f0d, 9be7ca9, f736458, c1beffc; `git rev-list --count 2950d85..HEAD` = 4, matching `commits: 4`.
