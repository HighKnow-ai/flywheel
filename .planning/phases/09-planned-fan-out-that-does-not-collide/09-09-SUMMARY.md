---
phase: 09-planned-fan-out-that-does-not-collide
plan: 09
subsystem: dispatcher-ui
tags: [dispatch, wave-plan, review-sheet, gate-line, epic-row, tauri-adapter, react, legend, webkit]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "09-03 edges_for_plan, why (reads the frozen edge); 09-04 cap and occupancy on settings_get; 09-05 the gate and dispatch:gate_changed; 09-07 the dispatch_* command surface; 09-08 the planning pass and dispatch_plan_generate"
provides:
  - "WavePlanSheet: waves, declared files, sequenced pairs with their colliding paths, excluded tasks with reasons, edit and approve on a draft, read-only record with states and a 'why' on a running plan"
  - "EpicDispatchControls in the epic row: plan a fan-out, 'Planning in progress', review a draft, pause/resume/stop, wave position, real cap occupancy, stuck tasks named"
  - "DispatchGateLine: open renders nothing; paused and warning show the core's reason and the one action that applies"
  - "preview_edges (core) and dispatch_planning_run (command): the two read paths the surface needed and the earlier plans did not provide"
  - "The fan-out DTOs and calls in the single Tauri adapter"
affects: [11 ship-it drain (D-REV-36), a follow-up for retry/skip of a stuck task]

plan_head_before: f6cab9a3f45b594bcd3ca34aab419ae71e482549

actuals:
  tokens: 31700
  tasks: 3
  commits: 11

tech-stack:
  added: []
  patterns:
    - "Fan-out server state lives under ['board', 'dispatch', ...] so the existing board:changed subscription refreshes it; the gate also listens to dispatch:gate_changed"
    - "A control's next state is the call's own response written into the query cache, never an optimistic guess"
    - "A draft's edges are a core-computed preview flagged edgesFrozen:false; every other status shows the rows that were acted on"
    - "EpicHeaderRow takes showDispatch (default false) so a bare row stays a pure function of its props and the existing standalone row tests are untouched"

key-files:
  created:
    - packages/desktop/src/dispatch/WavePlanSheet.tsx
    - packages/desktop/src/dispatch/EpicDispatchControls.tsx
    - packages/desktop/src/dispatch/DispatchGateLine.tsx
    - packages/desktop/src/dispatch/queries.ts
    - packages/desktop/src/dispatch/dispatch.css
    - packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx
    - packages/desktop/src/dispatch/__tests__/dispatch-controls.test.tsx
    - packages/desktop/src/dispatch/__tests__/gate-line.test.tsx
    - packages/desktop/src/dispatch/__tests__/dispatch-layout.browser.test.tsx
  modified:
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/tests/dispatch_plan.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/App.css
    - packages/desktop/src/board/EpicHeaderRow.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/state/uiStore.ts
    - .planning/DEFERRED-REVIEW.md

key-decisions:
  - "The surface needed two Rust read paths the plan said it would not need (the plan stated 'changes no Rust'): a draft's DTO carried neither the declared entries nor any edges, because edges are written only at approval. Showing the colliding paths 'where the decision is made' is impossible without them. Added preview_edges (same edges_for_plan approval runs, writes nothing) and DispatchTaskDto.entries from the stored rows, plus dispatch_planning_run for the Generate-to-first-submission window."
  - "Files are edited as one textarea per task (one entry per line, one Save, one edit call) rather than per-entry inputs, so an entry can be fixed, added or removed with the same single call and the core's validator is still the only judge."
  - "A refused edit resets the field to the stored set and shows the core's refusal text, per the plan's 'displayed set unchanged'. The user's typed text is not kept."
  - "The gate line takes the status line's place in the epic cell while a gate is waiting, so the cell fits the 64px row. Measured in WebKit."
  - "Why is offered only on a non-draft plan: a draft's edges are a preview, and dispatch_why reads the frozen edge, so asking it of a draft would answer 'disjoint' for a pair the preview shows sequenced."

patterns-established:
  - "A source gate per component: no @tauri-apps/api import; the sheet holds no containment logic"

requirements-completed: [PLAN-07]

coverage:
  - id: D1
    description: "The sheet shows each sequenced pair with the colliding paths from the response, and the response's pairs rather than a comparison of the entries"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx#shows a sequenced pair with both task titles and the colliding path from the response, #displays the response's pairs, not a comparison of the entries"
        status: pass
    human_judgment: false
  - id: D2
    description: "A draft's DTO carries the declared entries as stored and previews the edges approval will freeze, writing nothing; an approved plan returns the frozen rows"
    requirement: PLAN-07
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs#a_draft_previews_the_one_edge_approval_will_write_with_its_colliding_paths_and_writes_nothing, #a_preview_follows_a_wave_move_without_a_second_overlap_rule"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/dispatch.rs#surface_tests (3 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Edit issues one call; a refusal shows the core's text and the stored set stays; approve is the only dispatch start, once, disabled in flight; a non-draft is read-only; an excluded task shows its reason"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx (14 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Pause, resume and stop from the epic: one call each, disabled in flight, next state from the response, stop confirms, wording says running sessions are not stopped; a running planning run reads as in progress"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/dispatch-controls.test.tsx (17 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The gate line: open renders nothing; paused shows the reason, the reset instant or 'unknown, manual resume only'; warning shows the reason, advance-now and that the running wave finishes; one call each"
    requirement: PLAN-07
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/gate-line.test.tsx (9 tests)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The dispatch cell fits the 64px epic row with an open, paused and warning gate, hides on a narrow rack, and the sheet stays inside a 1440x900 viewport for a 40-task plan"
    requirement: PLAN-07
    verification:
      - kind: integration
        ref: "packages/desktop/src/dispatch/__tests__/dispatch-layout.browser.test.tsx (6 tests, WebKit)"
        status: pass
    human_judgment: false
  - id: D7
    description: "How the sheet, the row and the gate line look and read, and the end-to-end click path in the installed app"
    requirement: PLAN-07
    verification:
      - kind: manual
        ref: ".planning/DEFERRED-REVIEW.md#D-REV-36"
        status: deferred
    human_judgment: true
    rationale: "No WebDriver for WKWebView; layout and wording are an aesthetic judgement. The surface was built from CONTEXT.md and RESEARCH.md with no UI design contract for this phase, so the layout decisions are the plan's own and open to revision at the Phase 11 review pass."

duration: ~35 min
completed: 2026-10-09
status: complete
---

# Phase 9 Plan 09: The Fan-Out Surface Summary

**The wave plan sheet shows every declared set, wave and colliding path behind each sequenced pair before anything spawns; the epic row starts, pauses and stops a fan-out and shows a planning run in progress; and a gate line says why dispatch is waiting, all from Rust responses, through the one adapter.**

This phase's surfaces were built from CONTEXT.md and RESEARCH.md directly, with no UI design contract, so the layout decisions are the plan's own and are open to revision at the Phase 11 review pass (queued as D-REV-36).

## Can a user tell a blocked wave from a slow one?

Asked for in the dispatch brief. Plainly:

- **(a) See that a wave is blocked and which task blocks it: yes, with limits.** A running or paused plan's epic cell prints `Wave 2 of 3` and, when any task in the current wave is in `needs_attention`, `failed`, `stopped`, `conflict` or `held_by_limit`, `1 stuck: FLY-2` naming the keys. "Open plan" opens the sheet read-only, which prints every task's state in words (`Needs you`, `Merge conflict`, `Held by the account limit`, `Failed`, `Stopped`).
- **(b) Tell why: only partly.** A `needs_attention` task shows the core's named cause sentence (`DispatchTaskDto.attention`). A `failed`, `stopped` or `conflict` task shows its state word and nothing more, because the core records no cause text for those. `held_by_limit` is explained by the gate line. A task `waiting` behind an ordering edge can be asked with "Why?", which reads the frozen edge.
- **Where it still looks like a slow fan-out:** (1) the stuck count is hidden while a gate line is showing, because the gate line takes that line's place in the 64px cell; the sheet still shows it. (2) The cell is a field, so it disappears when the rack is narrower than 640px and a stuck wave is then invisible from the board. (3) A `failed`/`stopped`/`conflict` task gives the user no cause and **no action**: there is still no retry or skip command, so a stuck task holds its wave indefinitely and the user can see it but cannot clear it from here. **This should be filed as a follow-up issue** (the retry/skip gap 09-07 reported and 09-08 left open; it needs a core command first, not a surface).

## Accomplishments

- **Sheet.** Waves in order; each task with key, title and its declared files (a textarea on a draft, a list otherwise); for each sequenced pair the fact it is sequenced and the colliding paths, taken from `edges`; excluded tasks listed with their reason. Edit files or move a wave: one call each, refusal text shown, stored set unchanged. Approve and start is the only call that starts dispatch and is disabled in flight; the dialog then closes. A plan that is not a draft has no edit field, no wave control and no approve.
- **Planning window.** Between Generate and the first valid submission there is a running planning run and no plan row. `dispatch_planning_run` reports it and the cell prints `Planning in progress. A draft appears here when it is ready.`, with no Plan fan-out offer and no blank draft. The draft is never approved for the user (D-149).
- **Controls.** No live plan: Plan fan-out (its refusal, e.g. nothing to plan, is shown). Draft: Review plan. Running or approved: wave position, `n of cap agent slots in use` from `settings_get`, Pause, Stop, Open plan. Paused: Resume, Stop. Stop confirms in place. Pause and Stop say running sessions are not stopped.
- **Gate line.** Reads `dispatch_gate_state`, refreshes on `dispatch:gate_changed` and `board:changed`. Open renders no element.
- **Legend.** `epic-dispatch-wave` joins the registry (epic channel, so the agent-channel count test is untouched); the pinned totals went from 53 to 54 and epic from 4 to 5.
- **Invariants held.** `packages/core/src/dispatch.rs` was not touched. `scope_denied_counts` and the scope feed were not touched, so absent-vs-zero and the two kinds of refusal row are unchanged. Declared entries are read from the database rows.

## Task Commits

1. **Rust read paths RED:** `e50a3d7` (test)
2. **Rust read paths GREEN:** `ce2723d` (feat)
3. **Task 1 RED:** `d3cd0dc` (test)
4. **Task 1 GREEN:** `1bd7f79` (feat)
5. **Task 2 RED:** `35a088c` (test)
6. **Task 2 GREEN:** `504d50a` (feat)
7. **Task 3 RED:** `3dcb6cd` (test)
8. **Task 3 GREEN:** `6c8edbd` (feat)
9. **Command roster note:** `544b76a` (docs)
10. **WebKit layout test caught a real defect, fixed:** `1c91939` (fix)
11. **Sheet layout test and D-REV-36:** `b4ddcf8` (test, not a RED; see below)

**Plan metadata:** the `docs(09-09)` commits following this file.

## TDD Gate Compliance

`git log --oneline --grep="^test(09-09)"`:

```
b4ddcf8 test(09-09): keep the wave plan sheet inside the viewport in WebKit; queue the visual review as D-REV-36
3dcb6cd test(09-09): add failing tests for the dispatch gate line
35a088c test(09-09): add failing tests for the epic dispatch controls and the new legend mark
d3cd0dc test(09-09): add failing tests for the wave plan sheet
e50a3d7 test(09-09): add failing tests for the draft's entries, previewed edges and the planning-run window
```

Four of those five are genuine RED commits, each ahead of its GREEN (`e50a3d7` before `ce2723d`, `d3cd0dc` before `1bd7f79`, `35a088c` before `504d50a`, `3dcb6cd` before `6c8edbd`). **`b4ddcf8` is not a RED.** It is a test added after the code (a sheet-layout browser test that passed first time) and carries the `test` prefix only because it is test-only. Honest limits:

- **RED shape.** Each RED commit carries stubs so the tests compile: the Rust stubs return empty or `None`; the three components render `null`. Rust: 1 of 2 core tests and 2 of 3 desktop tests failed. Sheet: 14 of 14 failed. Controls: 15 of 15 failed, plus the legend count test. Gate line: 9 of 9 failed. The component failures are "nothing rendered", so the absence assertions (no wave position, no pause, no edit field, no approve) failed only because their anchor never appeared. They earn their keep against the real code; the open-renders-nothing case was mutation-checked (open rendering an element fails it).
- **Tests that passed against a stub.** `a_preview_follows_a_wave_move_without_a_second_overlap_rule` (core) passed against the empty stub, since an empty preview has no edge across waves. Mutation-checked afterwards: forcing every task into wave 1 makes it fail. `an_approved_plans_dto_returns_the_frozen_edges_not_a_preview` (desktop) passed against the stub because the stub already returned the frozen rows; it is a regression guard and was **not** mutation-checked.
- **Other mutation checks.** Removing the approve in-flight guard fails the sheet's approve test.
- **Back-filled.** The WebKit layout tests (`dispatch-layout.browser.test.tsx`) were written after the components. They are not a RED/GREEN pair, but the narrow-rack case failed on first run and exposed a real defect (see Deviations), so they can fail.
- The `check tdd-red-evidence` record was not produced; RED evidence is the failing counts above.

## Deviations from Plan

**1. [Rule 3 - Blocking] The plan said it changed no Rust; the surface could not be built without three small read paths.**
`DispatchPlanDto` carried no declared entries and, for a draft, no edges (edges are written only at approval), so "show the colliding paths on the draft" was impossible. Added `preview_edges` (core; the same `edges_for_plan` approval runs, writes nothing), `DispatchTaskDto.entries` (from the stored rows), `DispatchPlanDto.edgesFrozen`, and `dispatch_planning_run` (the 09-08 hand-off: a run with no plan row had no way to be seen). No new table or column; DTO fields and one read-only command. Tests: 2 core, 3 desktop. Commits `e50a3d7`, `ce2723d`.

**2. [Rule 1 - Bug] The dispatch cell stayed visible on a narrow rack.** Found by the WebKit test. The cell's own `display: flex` and the container-query `display: none` had equal specificity, so stylesheet order decided. The hide now has two classes. Commit `1c91939`.

**3. [Rule 1 - Bug] A failed background refetch would have blanked the controls.** The controls tested `isSuccess`, which flips to false when a refetch fails although the data is kept. They now test for data. Commit `1c91939`.

**4. [Process] The legend pin moved.** `legend.test.tsx` pins the registry by exact count; it went 53 to 54 and epic 4 to 5. The plan asked for the legend tests to pass, and the registry grew, so the pin had to move.

**5. [Process] `EpicHeaderRow` takes `showDispatch` (default false)** instead of always rendering the controls. `epic-sublabel.test.tsx` renders a bare row with no query provider; always rendering a query-backed child would have broken it. The existing board tests pass unchanged.

**6. [Process] Small additions outside the listed files:** `dispatch/queries.ts` (shared keys and hooks), `state/uiStore.ts` (`wavePlanSheetEpicId`), `BoardView.tsx` (passes `showDispatch`), `capabilities/default.json` (roster note), `.planning/DEFERRED-REVIEW.md` (D-REV-36).

**Total deviations:** 6 (1 Rule 3, 2 Rule 1, 3 process). **Impact:** none on the plan's goal; deviation 1 is why the surface can show the paths at all.

## Verification

- `npm --prefix packages/desktop test`: 75 files, 1292 tests pass (includes the three new files, board, legend, session, settings).
- `npx tsc --noEmit` and `npm --prefix packages/desktop run build`: clean.
- WebKit: `vitest.browser.config.ts src/dispatch`, 6 of 6.
- Source gates: each of the three components has 0 non-comment `@tauri-apps/api` references; `WavePlanSheet.tsx` has 0 `startsWith(`, `collisions(`, `FILE_SET_FORMS`.
- Rust: `dispatch_plan` (57), `dispatch_auto_merge` (26), `dispatch_cap` (8), `dispatch_limit_gate` (32), `scope_widen` (11), `epic_roster` (12), the desktop crate (93), `cargo build --workspace`.
- **Not run:** `cargo test --workspace` in full (the `credentials` and `forge_live_*` suites hang on keychain prompts or the network, as recorded in 09-01 to 09-08). Not exercised: the packaged app, a real planning run (D-REV-35), any human look (D-REV-36).

## What the guarantee is, and what it is not

- **Shown is not right.** The sheet displays the core's preview of the edges. If a model declared a wrong path, the pair is wrong too; the sheet's job is to put that in front of the user while they can still fix it. It does not know the path is wrong.
- **The preview can differ from what approval freezes** only if the declared sets or waves change between the two reads. Approval recomputes from the rows; the sheet re-reads after each edit.
- **"Planning in progress" is a database fact, not a liveness check.** A planning run that is `running` but has silently hung still shows as in progress.

## Authentication Gates

None.

## Known Stubs

None. No placeholder text or empty-wired data was left in the new files.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-read-endpoint | packages/desktop/src-tauri/src/commands/dispatch.rs | `dispatch_planning_run` is a new read-only command (epic id in, a run id and epic id out, nothing written). It is not in the plan's register. It takes an id validated as a ULID, reads one row, and exposes nothing the board does not already show. |

The plan's register is otherwise covered: T-09-09-01 (the renderer validates nothing; the core's refusal is shown and the stored set kept), -02 (no containment logic in the sheet, source gate and a test where the fixture contradicts a naive comparison), -03 (approve is the only call that starts dispatch; pause, stop, resume-now and advance-now are the human-only commands), -04 (the gate reason is read from the response; the only static gate wording is the plan's two required sentences), -05 (every action disabled in flight, asserted by a second click), -06 (excluded tasks render with their reason).

## Next Phase Readiness

- Phase 9's six surfaces are built; the phase closes on its automated verification and ROADMAP criteria, with the human items queued as D-REV-35 (real planning run) and D-REV-36 (look and click path).
- **Follow-up to file:** a retry/skip command for a task stuck in `failed`, `stopped`, `conflict` or `held_by_limit`, and a cause string for those states.

## Self-Check: PASSED

All nine created files are present on disk. Commits `e50a3d7`, `ce2723d`, `d3cd0dc`, `1bd7f79`, `35a088c`, `504d50a`, `3dcb6cd`, `6c8edbd`, `544b76a`, `1c91939`, `b4ddcf8` are in `git log`; `git rev-list --count f6cab9a..HEAD` = 11 at the time of writing. The three tasks' acceptance criteria and the plan's `<verification>` commands were run as listed above, except the full `cargo test --workspace`.
