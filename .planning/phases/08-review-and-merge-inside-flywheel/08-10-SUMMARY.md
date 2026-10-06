---
phase: 08-review-and-merge-inside-flywheel
plan: 10
subsystem: review
tags: [react, keyboard, accessibility, gap-closure, cr-03, wr-06]
status: complete
gap_closure: true

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "MergeConfirmSheet (08-07), EpicRequestSheet (08-08), the review surface Escape effect (08-01); the 08-VERIFICATION gap 2 this closes"
provides:
  - "isActivationTarget guard inside useRegionBindings: Enter and Space on a focused button, anchor or role=button are left to the element"
  - "ReviewSurface Escape handler stands down for an already-handled (defaultPrevented) keystroke"
  - "keyboard-activation.test.tsx: 8 behavioural tests, with a local pressKey helper that models the WebView activation rule"
affects: []

requirements-completed: [REVW-04, REVW-05]

duration: "~15 min"
completed: 2026-10-06

actuals:
  tokens: 4500
  tasks: 2
  commits: 2
plan_head_before: cd8042b1f4111108eb195315ea5773101cede502

coverage:
  - deliverable: "Enter on the Merge confirm sheet's Merge button reaches the confirm handler: merge adapter called once with the task id alone"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/keyboard-activation.test.tsx#lets the Merge confirm sheet's Merge button run the merge with the task id alone"
        status: pass
    human_judgment: false
  - deliverable: "Enter on the Epic request sheet's Open request button reaches the open handler: adapter called once with the epic id alone"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/keyboard-activation.test.tsx#lets the Epic request sheet's Open request button open the request with the epic id alone"
        status: pass
    human_judgment: false
  - deliverable: "The guard is a target test, not a blanket suppression: Enter and Space on the body still resolve expand-file and are cancelled; Enter on a plain button is uncancelled and does not fire expand-file"
    verification:
      - kind: test
        ref: "keyboard-activation.test.tsx (3 cases) plus review-surface.test.tsx j/k/Enter/Escape (11 passing)"
        status: pass
    human_judgment: false
  - deliverable: "Escape honours defaultPrevented (WR-06): handled Escape does not pop, plain Escape pops once, Escape with the merge sheet open does not pop"
    verification:
      - kind: test
        ref: "keyboard-activation.test.tsx (Escape in the review surface, 3 cases); the handled-Escape case was observed failing with the condition removed"
        status: pass
    human_judgment: false
  - deliverable: "Real-WebView keyboard feel of the merge confirmation (Tab to Merge, Enter)"
    human_judgment: true
    rationale: "The tests model the browser's keydown-default-action rule in jsdom; the packaged Tauri WebView was not driven."

key-files:
  created:
    - packages/desktop/src/review/__tests__/keyboard-activation.test.tsx
  modified:
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/review/ReviewSurface.tsx

key-decisions:
  - "The guard lives in useRegionBindings only, between resolveBinding and preventDefault. resolveBinding and resolveGlobalBinding are untouched because BoardView calls resolveBinding from its own element-level handler, where Enter on the focused list container is the intended open-detail activation."
  - "No new dependency: user-event is not added; a local pressKey helper clicks the element only when the keydown was not cancelled."
---

# Phase 8 Plan 10: Keyboard activation of merge and epic request Summary

**A one-line target guard in `useRegionBindings` stops the window listener cancelling Enter and Space on focused buttons, so the Merge confirmation and the epic request are reachable by keyboard; the review surface's Escape now ignores keystrokes already handled.**

## What changed

- `keyboard.ts`: new module-private `isActivationTarget(target)` (target inside `button, a, [role='button']`). `useRegionBindings` returns early for Enter or Space on such a target, before `bindingAllowedInLayer` and before `preventDefault`.
- `ReviewSurface.tsx`: the Escape effect adds `!event.defaultPrevented` to its conditions (WR-06).
- `keyboard-activation.test.tsx`: 8 tests. A local `Harness` runs the real `useRegionBindings("review-surface", ...)` listener; the sheets are rendered inside it, so the file does not depend on `CriteriaRail` or plan 08-09's adapter symbol.

## Blast radius of the guard

Every Enter/Space entry in `BINDINGS`:

| Action | Region | Key | Reaches `useRegionBindings`? | Changed by guard |
|---|---|---|---|---|
| `open-detail` | `board-list` | Enter | No: BoardView calls `resolveBinding` from its own `onKeyDown` | No |
| `expand-file` | `review-surface` | Enter, Space | Yes | Yes: suppressed only when the target is inside a button, anchor or `role=button` |

Every `useRegionBindings` caller:

| Caller | Enter/Space bindings | Changed |
|---|---|---|
| `TriageSurface.tsx` (`triage-surface`) | none | No |
| `ProposalTray.tsx` (`proposal-tray`) | none | No |
| `ProposalRow.tsx` (per-row proposal region) | none | No |
| `PermissionRequestCard.tsx` (`permission-card`) | none | No |
| `SessionSurface.tsx` (`session-surface`) | none | No |
| `ReviewSurface.tsx` (`review-surface`) | `expand-file` | Yes, as above |

`useGlobalBindings` is untouched and has no Enter/Space entry. The one intended side effect: the changed-file rows are `<button>`s, so Enter or Space with DOM focus on a row now expands that row through its own `onClick`, instead of toggling `focusedPath` (the previously clicked file), which was CR-03's second symptom.

## Verification

- `keyboard-activation.test.tsx`: 5 tests passing after Task 1 (3 failed before the guard: plain button, Merge, Open request), 8 after Task 2 (the handled-Escape case failed with the `defaultPrevented` condition removed).
- `review-surface.test.tsx`: 11 passing, including the j/k/Enter/Escape test.
- Full desktop suite: 765 passing (gate: at least 754). `tsc --noEmit` clean.
- Greps: `function isActivationTarget` count 1; referenced inside `useRegionBindings`; absent from `resolveBinding`; `user-event` absent from `package.json`.

## Deviations from Plan

**1. [Documentation] Review-suite baseline figure.** The plan's Task 2 gate quotes "at least 157" passing tests for `src/review`. The directory reports 107 passing (104 before this plan plus 8 minus overlap is not the issue: that run is the whole `src/review` directory). The figure 157 appears to be miscounted in the plan; the plan-level gate that matters (full suite at least 754) holds at 765 and no test fails. No code change.

**2. [Process] Task 1 commit amended once.** The first Task 1 commit carried an unused `fireEvent` import (tsc TS6133); amended before Task 2 so each commit typechecks. Final hash `e2c69fd`.

Total deviations: 2 (documentation and process only). Impact: none on behaviour.

## Task commits

| Task | Commit |
|---|---|
| 1. Activation guard plus behavioural tests | `e2c69fd` |
| 2. Escape honours defaultPrevented | `3cd23aa` |

## Known Stubs

None.

## Threat Flags

None. T-08-10-01 (keyboard path to destructive confirmations), T-08-10-02 (single keystroke, single action) and T-08-10-03 (guard breadth) are mitigated and covered by the tests and region-scoped greps above.

## Self-Check: PASSED

- `keyboard-activation.test.tsx` exists; `e2c69fd` and `3cd23aa` present in `git log`.
- `git rev-list --count cd8042b..HEAD` = 2, matching `commits: 2`.
