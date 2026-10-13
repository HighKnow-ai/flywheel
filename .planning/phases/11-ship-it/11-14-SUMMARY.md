---
phase: 11-ship-it
plan: 14
subsystem: sidecar-and-desktop-tests
tags: [webkit, browser-tests, rate-limit, wire-fixture, deferred-review]
requires: []
provides:
  - measured coverage of register items D-REV-32, D-REV-33, D-REV-36 (automatable halves)
  - a frozen rate-limit wire fixture with per-shape provenance
affects: [11-21 closure pass, 11-11, 11-18]
tech-stack:
  added: []
  patterns:
    - "Option+Tab (Alt+Tab) as the WebKit sequential-focus probe, since plain Tab skips buttons by default"
    - "it.fails to hold a found, deferred defect green-but-armed"
key-files:
  created:
    - packages/sidecar/test/fixtures/rate-limit-rejected.json
    - .planning/phases/11-ship-it/deferred-items.md
  modified:
    - packages/sidecar/test/rate-limit-wire.test.mjs
    - packages/desktop/src/session/__tests__/browser/session-group.browser.test.tsx
    - packages/desktop/src/dispatch/__tests__/dispatch-layout.browser.test.tsx
    - .planning/DEFERRED-REVIEW.md
key-decisions:
  - "A real hard limit is observed only in Claude Code transcripts (assistant error shape); the rate_limit_event rejected shapes are labelled `documented`, never `observed`."
  - "A defect found in WavePlanSheet (refused Approve renders below the fold) is held as an it.fails and logged, not fixed: pre-existing and the plan forbids restructuring that file."
requirements-completed: [DIST-04]
status: complete
duration: ~35 min
completed: 2026-10-13
commits: 4
plan_head_before: 41971f4ddf7f912b28184a2cd734de3407e5f50c
actuals:
  tokens: 14000
  tasks: 3
  commits: 4
---

# Phase 11 Plan 14: Rate-limit wire fixture, scope-denied row and dispatch surface in WebKit Summary

The rate-limit tier is now driven from a frozen fixture that records which shapes were observed and which were only documented, and the scope-denied feed row and every dispatch state are measured in WebKit for containment and keyboard reach, in both themes.

## Per register item

Legend: "first run" = the test passed when first written (the behaviour was already correct). "caught" = it found a real defect. No RED run was manufactured.

### D-REV-32 (rate limit on the wire) - live half CLOSED accepted-by-design; the event-line shape is still UNOBSERVED, the assistant-error shape is now observed

Tests, all in `packages/sidecar/test/rate-limit-wire.test.mjs`, reading `packages/sidecar/test/fixtures/rate-limit-rejected.json`:
- `fixture: every hard-limit shape classifies rejected, and each says whether it was observed or only documented` - first run
- `fixture: observed soft and overage-rejected lines do NOT classify rejected (so rejected is not vacuous)` - first run (the negative case)
- `fixture: a frozen rejected line reaches the stream as the rejected-tier event the dispatcher keys on (the pause itself is dispatch_limit_gate.rs)` - first run

**Correction made after I first wrote this plan as complete.** My first pass searched the Flywheel session logs and a time-limited grep of `~/.claude/projects`, concluded no hard limit had ever been observed, and wrote that into the fixture header, the register and this file. That was wrong. A later look at the grep's three unread hits showed Claude Code's own transcripts record real hard limits (four records from 2026-09-21: "You've hit your session limit" and "weekly limit"). The cause was an unfinished search I treated as finished. All three places are corrected.

What is observed: an assistant message with `error: "rate_limit"`, `isApiErrorMessage: true`, `apiErrorStatus: 429` and `quotaLimits.status: "rejected"`. It is frozen as provenance `observed-transcript`, and the adapter classifies it as `rateLimitTier: "rejected"` (it passed on first run, so no defect). Limits of that record: it is an interactive-CLI transcript serialisation (camelCase `isApiErrorMessage`), not a `-p --output-format stream-json` line, so the exact spelling the adapter sees from the sidecar's stream is not confirmed by it.

What is still not observed: a top-level `rate_limit_event` line whose `rate_limit_info.status` is `rejected`. Those fixture shapes stay `documented` and a test asserts it, so they cannot be mistaken for captures.

Live half: not pursued. Register's own words: "Provoking one deliberately is not something to do (it is the abuse this requirement exists to avoid)." Closed as `accepted-by-design`. The pause itself is asserted by the existing `packages/core/tests/dispatch_limit_gate.rs`, which I did not re-run.

### D-REV-33 (scope-denied row and refusal badge) - layout half CLOSED; live widen and "noticeable" remain

Tests in `packages/desktop/src/session/__tests__/browser/session-group.browser.test.tsx`:
- `a 300-character refusal stays one line: the row is exactly as tall as with a short one, and the widen action stays inside it` - first run. Mutation check: removing `whiteSpace: "nowrap"` from the row turned it red (`expected 32 to be 25`), then I restored the file.
- `the widen action is reachable from the keyboard (Option+Tab ...)` - this one failed twice before passing, but not on a product defect: plain Tab (and `userEvent.tab()`) never leaves BODY in this WebKit because it skips every button by default, which `review/__tests__/browser/keyboard.browser.test.tsx` already documents. Option+Tab traverses all controls and reaches the button. The test also asserts it is a native, enabled button with no `tabindex=-1`.
- `a count of 20 renders a badge, a task with none renders nothing at all` - first run. The jsdom `scope-badge.test.tsx` already covered the strings; this adds that the badge is painted and inside its row in WebKit.

Left in the register: a live widen against a running `claude` session (needs a real login and the packaged sidecar - physical), and "is it noticeable at a glance" (aesthetic judgement - physical). No font size was changed.

### D-REV-36 (dispatch surface) - containment and reachability half CLOSED; packaged click path and look remain

Tests in `packages/desktop/src/dispatch/__tests__/dispatch-layout.browser.test.tsx`, light and dark both run, all first run except the one defect below:
- Cell, eight states each asserting words present, exactly the expected controls, every control inside the cell, cell inside the 64px row, nothing clipped sideways, all enabled controls reached by Option+Tab: nothing planned, planning in progress, the draft appearing, running with a stuck task, paused plan, paused gate (reset unknown), paused gate with a reset time, warning gate. Plus `the Stop confirmation fits the row with both of its answers`.
- Sheet: `the draft: wave pickers, path fields, Approve and Cancel ...`, `editing a path ...` (long core refusal wraps, stays inside the dialog), `editing a wave ...`, `Approve and start: a failed approval puts the core's words in the dialog, wrapped, and Approve is usable again`, `a plan in force: read-only ...`.
- Overlap with existing assertions (running/open, paused and warning containment, narrow-rack hide, 40-task Approve) is noted in a comment and not repeated.

**Caught a real defect:** a refused "Approve and start" renders its message at the end of the scrolling `.wave-plan-body`, so for any plan taller than the dialog (four tasks at 1440x900) it sits below the fold (797.8 vs 748.3) and the user sees nothing. It is pre-existing and in a file this plan must not restructure, so it is held as `it.fails("a failed approval is visible without scrolling the body")` and written to `.planning/phases/11-ship-it/deferred-items.md`. The suite reports "1 expected fail"; fixing the sheet turns that red, which is the cue to make it a plain `it`.

One of my own first assertions (a 20px minimum picker height) was an invented number with no source; I removed it rather than tune it to pass.

**Routed to 11-21, as two separate items:**
1. The click path through the PACKAGED app (Plan fan-out, draft appearing, edit, Approve and start, Pause/Resume/Stop). No physical obstacle once 11-08's installed build exists; scriptable, so automate it first.
2. How the sheet and row LOOK. Aesthetic judgement; this is the only genuinely human part.

## Task commits

| Task | Commit | Notes |
| ---- | ------ | ----- |
| 1 D-REV-32 | e8db406 | test only; behaviour already correct (provenance corrected in a follow-up commit) |
| 2 D-REV-33 | 7fd4c42 | test only; mutation-checked |
| 3 D-REV-36 | de68f90 | test only; one `it.fails` for the found defect |
| register + deferred item | 0b129fa | docs |

TDD note: all three tasks are test-only conversions of behaviour that was already correct, so there is no GREEN implementation commit and none was invented.

## Deviations from Plan

### Auto-fixed Issues

None.

### Out of scope, logged

**[Scope boundary] Refused Approve renders below the fold** - found during Task 3. Not caused by this plan; logged in `deferred-items.md` and held as `it.fails`. Not fixed because the plan says not to restructure `WavePlanSheet.tsx` (11-11 edits it later).

### Plan variance

- The plan's Task 2 said "Tab-reachable". Plain Tab cannot reach any button in this WebKit; I used Option+Tab and recorded why. This is a weaker claim about the packaged WKWebView than "Tab reaches it": it proves the control is native, enabled and in the focus order, not that plain Tab lands on it.
- `.planning/DEFERRED-REVIEW.md` was edited (an `update_11-14` line on each of the three entries) although the plan's `files_modified` does not list it; plan 11-13 did the same.
- The register entries were annotated but their `status:` was left `open`; 11-21's closure pass decides status.

## Verification run

Scoped per the anti-stall rules; no workspace-wide build or test was run (the phase-end regression gate owns that).
- `npm --prefix packages/sidecar test`: 295 passed, 0 failed.
- `rate-limit-wire.test.mjs`: 13 passed (10 existing, 3 new).
- `session-group.browser.test.tsx`: 9 passed, light and dark.
- `dispatch-layout.browser.test.tsx`: 20 passed and 1 expected fail, light and dark.
- `npm --prefix packages/desktop test -- src/session`: 191 passed. `-- src/dispatch`: 45 passed. The whole desktop jsdom suite was not run.
- Fixture provenance check: `grep -c source` on the fixture returns a non-zero count.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files exist: `rate-limit-rejected.json`, `deferred-items.md`, the three modified test files. Commits e8db406, 7fd4c42, de68f90, 0b129fa are in the log.
