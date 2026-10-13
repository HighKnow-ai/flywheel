---
phase: 11-ship-it
plan: 12
subsystem: review-surface / forge publish ordering
tags: [forge, keyboard-a11y, toast, tdd, deferred-review-drain]
requires: []
provides:
  - open_epic_request_if_unchanged (plain-value draft-hash-before-push seam in core)
  - LaunchOverlapToast component and uiStore.launchOverlapWarning
affects: [packages/core/src/forge/mod.rs, packages/desktop/src-tauri/src/commands/forge.rs, packages/desktop/src/App.tsx, packages/desktop/src/review/MergeConfirmSheet.tsx]
tech-stack:
  added: []
  patterns: ["stub CLI on PATH logging to a file, paired with a positive control", "app-level toast fed by a store field because launch surfaces unmount"]
key-files:
  created:
    - packages/core/tests/forge_epic_request_ordering.rs
    - packages/desktop/src/shell/LaunchOverlapToast.tsx
    - packages/desktop/src/shell/__tests__/launch-overlap-toast.test.tsx
  modified:
    - packages/core/src/forge/mod.rs
    - packages/desktop/src-tauri/src/commands/forge.rs
    - packages/desktop/src/review/MergeConfirmSheet.tsx
    - packages/desktop/src/review/__tests__/merge-sheet.test.tsx
    - packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx
    - packages/desktop/src/App.tsx
    - packages/desktop/src/state/uiStore.ts
key-decisions:
  - "Overlap warning travels through a uiStore field, not through onOpenSession's arguments: the merge sheet unmounts with the review surface the moment the session opens, so a toast rendered inside it would vanish instantly."
  - "Tab traversal is asserted structurally in jsdom and not at all in WebKit: WKWebView does not Tab to buttons (G-08-6, header of keyboard.browser.test.tsx). The WebKit case asserts focus lands on the exit and Enter activates it."
requirements-completed: [DIST-04]
duration: ~35 min
completed: 2026-10-13
status: complete
commits: 6
plan_head_before: a0ff04cacefcf17b94086858caa4fa9e76f44db8
actuals:
  tokens: 16000
  tasks: 3
  commits: 6
coverage:
  - deliverable: "Draft-hash comparison runs and refuses before any push or forge call"
    human_judgment: false
    verification:
      - {kind: test, ref: "packages/core/tests/forge_epic_request_ordering.rs#a_moved_draft_is_refused_as_draft_changed_before_any_forge_call_or_push", status: pass}
  - deliverable: "A keyboard user can leave a conflicting merge result"
    human_judgment: false
    verification:
      - {kind: test, ref: "packages/desktop/src/review/__tests__/merge-sheet.test.tsx#moves focus onto a conflict exit when the result renders", status: pass}
      - {kind: test, ref: "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx#lands focus on a conflict exit when the result renders", status: pass}
  - deliverable: "Overlap warning and real refusal reason reach the screen from every launch site"
    human_judgment: false
    verification:
      - {kind: test, ref: "packages/desktop/src/shell/__tests__/launch-overlap-toast.test.tsx", status: pass}
      - {kind: test, ref: "packages/desktop/src/review/__tests__/merge-sheet.test.tsx#renders a refused launch's real reason", status: pass}
---

# Phase 11 Plan 12: Forge ordering, conflict-exit focus, overlap toast Summary

The epic-request publish ordering is now pinned by a stub `gh` that would have logged a violation, a conflicting merge result puts focus on a real exit, and the overlap warning plus a refused launch's real reason reach the screen from the merge sheet's launch.

## Register coverage (plan 11-21 closure pass reads this)

| Register id | Covered by |
|---|---|
| D-REV-03 | `packages/core/tests/forge_epic_request_ordering.rs`: `a_moved_draft_is_refused_as_draft_changed_before_any_forge_call_or_push` (no stub log file, nothing on the remote, code `draftChanged`) and `a_matching_draft_pushes_first_then_calls_the_forge_and_the_stub_leaves_a_trace` (positive control: log exists, `pr create` recorded, branch already on the remote at create time) |
| D-REV-02 | `merge-sheet.test.tsx`: `moves focus onto a conflict exit when the result renders ... (D-REV-02)`, `leaves all three conflict exits tabbable, in order ...`, `Escape still closes the sheet from a conflict result`; WebKit: `keyboard.browser.test.tsx` `D-REV-02 — leaving a conflicting merge result by keyboard` |
| D-REV-43 | `packages/desktop/src/shell/__tests__/launch-overlap-toast.test.tsx` (four tests: verbatim text, renders nothing, self-dismiss at the timeout, user dismiss) |
| D-REV-46 (renderer half) | `merge-sheet.test.tsx`: `hands a launch's overlap warning to the app-level toast ... (D-REV-46)` and `renders a refused launch's real reason instead of a fixed string (D-REV-46)` |

## TDD sequence

Per task, RED commit precedes GREEN:
- Task 1: `ac27c90` RED (fails to compile: the seam did not exist, which is the testability defect itself) then `6375011` GREEN.
- Task 2: `c313d35` RED (the `activeElement` test failed; the tabbable-order and Escape tests passed on first run because that behaviour already existed) then `7692935` GREEN.
- Task 3: `1b9fe33` RED (component missing, store setter missing, fixed string still shown) then `9e8f94c` GREEN.

## Deviations from Plan

**1. [Rule 3 - Blocking] Warning delivery through a store, not through the sheet.** Found during Task 3. The plan says `MergeConfirmSheet` "renders the same component", but the sheet's `onOpenSession` clears the whole review surface, so anything rendered inside it disappears with it. Added `uiStore.launchOverlapWarning` (set by both launch sites), shown by the single `LaunchOverlapToast` mounted in `App.tsx`. `App.tsx` still has no inline toast markup. Files: `uiStore.ts`, `App.tsx`, `MergeConfirmSheet.tsx`.

**2. [Plan assumption wrong] Tab cannot be pressed in WebKit.** The plan asked for a Tab traversal "in both jsdom and WebKit". jsdom cannot synthesise Tab and WebKit does not Tab to buttons (G-08-6, documented in the keyboard browser test header). jsdom asserts the precondition Tab needs (three enabled buttons, tabindex >= 0, DOM order); WebKit asserts focus lands on the first exit and Enter activates it. The literal "Tab moves between the exits" claim is therefore not observed anywhere, and is not claimed.

**3. [Plan wording] "Exactly one invocation" on the match case.** A successful open legitimately calls `gh` more than once (lookup, `pr create`, read-back). The match test asserts the log is non-empty, contains `pr create`, and that the branch was already on the remote at create time, which is the property the ordering needs.

**4. [Scope] Workspace-wide `cargo test --workspace` skipped** per the anti-stall instruction. Run instead: `cargo test -p core --test forge_epic_request_ordering` (2 passed), `cargo check -p desktop` (clean apart from a pre-existing dead-code warning), `vitest` over `src/shell src/review src/state` (201 passed), the WebKit keyboard suite (14 passed), `npm run build` (type-checks). The phase-end regression gate runs the workspace suite.

**Total deviations:** 4 (1 auto-fix, 3 plan-assumption corrections). **Impact:** none on the register items; item 2 narrows what is claimed about Tab.

## Known Stubs

None.

## Threat Flags

None. T-11-36, T-11-37, T-11-38 mitigated as planned; the displayed refusal reason is whatever the command returns, composed server-side.

## Self-Check: PASSED

Created files exist; six commits present from `a0ff04c..9e8f94c`.
