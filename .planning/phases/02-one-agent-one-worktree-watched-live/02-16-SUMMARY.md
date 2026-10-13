---
phase: 02-one-agent-one-worktree-watched-live
plan: 16
subsystem: ui
tags: [react, tanstack-virtual, session-feed, gap-closure]

requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: the structured session feed itself (D-32, plan 02-07) — the virtualizer configuration and the FeedRow presentational component this plan patches
provides:
  - a virtual row wrapper clamped to the exact height the virtualizer reserved for it (no row can paint past its own slot)
  - an expandable one-line-by-default presentation shared by assistant_text, system_notice and raw rows, reusing the tool-call disclosure pattern already in the file
  - a regression test that pushes a multi-kilobyte event through the real feed and asserts no row's slot extends into its successor's
affects: [02-17, 02-18]

actuals:
  tokens: 6084
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "A virtual row's absolutely-positioned wrapper always declares height: virtualRow.size and overflow: hidden — the render contract now structurally matches the position contract the virtualizer's own reserved size already implied."
    - "A row's collapsed text is capped to FEED_ROW_TRUNCATION_THRESHOLD characters before it reaches the DOM (not just CSS-clipped), so a multi-kilobyte payload never sits in the document behind a visual clip; the full text renders only inside the expanded, internally-scrolling sub-block."

key-files:
  created:
    - packages/desktop/src/session/__tests__/feed-row.test.tsx
  modified:
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/FeedRow.tsx
    - packages/desktop/src/session/__tests__/session-surface.test.tsx

key-decisions:
  - "Collapsed body-row text is sliced to FEED_ROW_TRUNCATION_THRESHOLD characters in JS, not left as full-text-plus-CSS-ellipsis (the ToolCallRow pattern this plan was told to reuse). A CSS-only clip leaves the complete string in the DOM; Task 3's own regression test needs the collapsed row to genuinely not contain the oversized marker text, and rendering multi-kilobyte strings into the DOM purely to hide them with CSS is wasteful regardless. The visual clipping properties (hidden overflow, ellipsis, no-wrap) are kept as a safety net on the sliced text."
  - "EXPANDED_SUBBLOCK_MAX_HEIGHT (240) is a new named constant, factored out of ToolCallRow's previously-inline maxHeight: 240 literal, and shared with the new ExpandableTextRow component — so 'the same fixed max height' the plan requires is enforced by one binding rather than two coincidentally-identical numbers."
  - "isRowExpandable and feedRowEstimateSize are exported from FeedRow.tsx rather than re-derived in SessionSurface.tsx, keeping the row-level expandability policy in one file with a single owner."

requirements-completed: [PROC-07, AGNT-02]

coverage:
  - id: D1
    description: "A feed row's virtual wrapper never paints outside the slot the virtualizer reserved for it, whatever its content length"
    requirement: "PROC-07"
    verification:
      - kind: unit
        ref: "session-surface.test.tsx#every rendered row slot declares the height the virtualizer reserved and clips its overflow"
        status: pass
      - kind: unit
        ref: "session-surface.test.tsx#G-02-3: a multi-kilobyte event never overlaps the row beneath it"
        status: pass
    human_judgment: false
  - id: D2
    description: "A multi-kilobyte event renders as one readable, ellipsised line rather than as a wall of text layered over every row beneath it, and its full text is reachable in place"
    requirement: "AGNT-02"
    verification:
      - kind: unit
        ref: "feed-row.test.tsx#renders a disclosure control for a long row and toggling it reveals the full text"
        status: pass
      - kind: unit
        ref: "session-surface.test.tsx#G-02-3: an oversized row's full text is reachable in place"
        status: pass
    human_judgment: false
  - id: D3
    description: "The virtualizer's size function still returns a fixed constant per row kind and expand state — never derived from content length, never measured from the DOM"
    requirement: "PROC-07"
    verification:
      - kind: unit
        ref: "feed-row.test.tsx#returns the identical collapsed constant for a ten-character and a ten-thousand-character row of the same kind"
        status: pass
      - kind: other
        ref: "grep gate: zero non-comment occurrences of measureElement in SessionSurface.tsx"
        status: pass
    human_judgment: false
  - id: D4
    description: "The feed remains readable while an agent streams into it (the flat-memory observation, PROC-07, is a human-verification item this plan does not itself automate)"
    human_judgment: true
    rationale: "This plan fixes the render-vs-position contract mismatch that made the feed unreadable; the flat-RSS-while-streaming observation itself requires a human running a real long session and watching memory, which no automated test in this repository exercises."

duration: 35min
completed: 2026-09-11
status: complete
---

# Phase 2 Plan 16: Clamp the Session Feed's Virtual Row Slots (G-02-3) Summary

**Closed gap G-02-3: a feed row's absolutely-positioned slot now declares the exact height the virtualizer reserved for it and clips overflow, and assistant/raw/notice rows clip to one line with a disclosure control that opens the full text in place — closing the "dozens of superimposed text layers" defect a multi-kilobyte event previously caused.**

## Performance

- **Duration:** 35 min (approx.)
- **Started:** 2026-09-11T08:35:00Z (approx.)
- **Completed:** 2026-09-11T09:10:07Z
- **Tasks:** 3
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `SessionSurface.tsx`'s virtual row wrapper now declares `height: virtualRow.size` and `overflow: "hidden"` on the exact same inline style object that already set its position, plus a `data-testid="feed-row-slot"` hook for tests — the render contract now structurally matches the position contract the virtualizer's own reserved size already implied. A comment states the invariant in the imperative and cites G-02-3.
- `FeedRow.tsx` gained `FEED_ROW_TRUNCATION_THRESHOLD` (120 chars) and `isRowExpandable(row)`, a pure function of `FeedRowData`: `tool_call` is always expandable (unchanged); `assistant_text`, `system_notice` and `raw` are expandable only past the threshold. A new shared `ExpandableTextRow` component renders all three text kinds, reusing the tool-call label's clipping pattern and its expanded fixed-max-height, internally-scrolling block (now the named `EXPANDED_SUBBLOCK_MAX_HEIGHT` constant, shared rather than duplicated). Collapsed text is capped to the threshold in JS before it reaches the DOM.
- `feedRowEstimateSize` now checks `isRowExpandable(row) && expanded` instead of hardcoding `row.kind === "tool_call"`, so any expandable row kind gets the expanded slot height — while still returning one of exactly two constants, verified identical for a ten-character and a ten-thousand-character row of the same kind.
- New `feed-row.test.tsx` (10 tests) covers collapsed clipping, disclosure-control presence/absence, toggle behavior, and the content-length-independence of `feedRowEstimateSize`.
- `session-surface.test.tsx` gained one structural test (Task 1) asserting every rendered slot declares a non-empty height and clipping overflow, and two behavioral tests (Task 3) that push a ~4.2KB `assistant_text` event through the real feed: one proving no adjacent slot pair overlaps and the oversized row's height equals the collapsed constant, one proving a marker near the end of the oversized text is absent before expanding and present after.

## Task Commits

Each task was committed atomically:

1. **Task 1: A row paints inside the slot the virtualizer gave it, or not at all** - `1d76d54` (fix)
2. **Task 2: One ellipsised line by default, the whole thing on request** - `cc90c07` (feat)
3. **Task 3: Prove it — push a multi-kilobyte event through the real feed** - `cfbce5b` (test)

_This plan's Task 2 and Task 3 carried `tdd="true"` in the plan frontmatter, but `workflow.tdd_mode` is not enabled in `.planning/config.json` for this project — matching this same phase's 02-15 precedent — so each task landed as a single commit following this repository's standard one-commit-per-task convention rather than a strict RED/GREEN/REFACTOR gate sequence._

## Files Created/Modified

- `packages/desktop/src/session/SessionSurface.tsx` - virtual row wrapper now clamps to `virtualRow.size` with `overflow: hidden`; adds `data-testid="feed-row-slot"`
- `packages/desktop/src/session/FeedRow.tsx` - `FEED_ROW_TRUNCATION_THRESHOLD`, `isRowExpandable`, shared `ExpandableTextRow` component, widened `feedRowEstimateSize`
- `packages/desktop/src/session/__tests__/feed-row.test.tsx` - new; row-level clipping and expandability assertions
- `packages/desktop/src/session/__tests__/session-surface.test.tsx` - slot-geometry test (Task 1) and the multi-kilobyte overlap/reachability regression (Task 3)

## Decisions Made

- Collapsed body-row text is sliced to `FEED_ROW_TRUNCATION_THRESHOLD` characters in JS rather than left as full-text-plus-CSS-ellipsis (discovered mid-implementation: jsdom keeps the full DOM text node under `text-overflow: ellipsis`, which would leave a multi-kilobyte marker "present" in the collapsed DOM and also contradicts the plan's own Task 3 assertion that the marker is absent before expanding). The visual clipping style properties are kept on the sliced text as a safety net for the general case.
- `EXPANDED_SUBBLOCK_MAX_HEIGHT` (240) extracted as a named constant from `ToolCallRow`'s previously-inline literal, shared with the new `ExpandableTextRow` — enforcing "the same fixed max height" structurally rather than by two coincidentally-identical numbers.
- Added an `aria-label` ("Expand full text" / "Collapse full text") to the new disclosure button, since — unlike `ToolCallRow`'s button, whose accessible name comes from the tool name/target text inside it — this button renders only the triangle glyph and would otherwise have no accessible name.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Collapsed text needed JS truncation, not CSS-only clipping**
- **Found during:** Task 2, first test run of `feed-row.test.tsx`'s "toggling it reveals the full text" case
- **Issue:** The plan's Task 2 action text described reusing the tool-call label's CSS-only clipping pattern (full text in the DOM, `text-overflow: ellipsis` hiding the overflow visually). Applied literally, a multi-kilobyte collapsed row's full text remains in the DOM — `screen.queryByText` still finds it, which fails Task 3's own required assertion that an oversized row's marker text is "absent before expanding."
- **Fix:** Collapsed rendering slices the text to `FEED_ROW_TRUNCATION_THRESHOLD` characters in JS before rendering, in addition to keeping the same CSS clipping properties. For any row at or under the threshold this is a no-op (slicing at N does nothing to a string already `<= N` chars), so short rows and the existing tool-call pattern are unaffected.
- **Files modified:** `packages/desktop/src/session/FeedRow.tsx`
- **Verification:** `feed-row.test.tsx` and `session-surface.test.tsx`'s new G-02-3 cases pass; full suite (310 tests) passes.
- **Committed in:** `cc90c07` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a plan instruction that, read literally, would not satisfy the plan's own later acceptance criterion). **Impact on plan:** No scope creep; the fix is entirely inside the file this task already owns and makes the plan's two task descriptions (2 and 3) mutually consistent.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- G-02-3 is closed: all three `missing:` items exist — no row can paint outside its reserved slot, a multi-kilobyte event renders as one readable line that opens in place, and the virtualizer's size function stays a fixed constant per row kind/expand state, proven by a regression test that pushes an oversized event through the real feed.
- The flat-memory-while-streaming observation (PROC-07) itself remains a human-verification item — this plan removed the defect that made the feed unreadable during such a test, but did not itself run or automate that observation.
- `packages/sidecar/src/claude-code-adapter.ts` and `packages/sidecar/test/adapter.test.mjs` remain modified-but-uncommitted in the working tree, as required — those commits belong to plan 02-17's ledger. `.planning/config.json` also remains modified-but-uncommitted, as required — that belongs to the orchestrator.
- Ready for the remaining open gaps (G-02-2, G-02-4) and for `/gsd-verify-work 2` to resume UAT testing.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-11*

## Self-Check: PASSED

All key files confirmed present on disk (`SessionSurface.tsx`, `FeedRow.tsx`, `feed-row.test.tsx`, `session-surface.test.tsx`, this SUMMARY). All three task commits (`1d76d54`, `cc90c07`, `cfbce5b`) confirmed present in `git log`. All acceptance criteria and the plan-level `<verification>` block re-run and passing: `npm --prefix packages/desktop run test` reports 310/310 passing (0 failures); `npm --prefix packages/desktop run build` exits 0; `npm --prefix packages/desktop run test -- feed-row` reports 10/10 passing; `npm --prefix packages/desktop run test -- session-surface` reports 32/32 passing; zero non-comment `measureElement` occurrences in `SessionSurface.tsx`; `virtualRow.size` and `feed-row-slot` each appear on `SessionSurface.tsx`'s non-comment lines; `FeedRow.tsx` carries 2 non-comment `textOverflow` clipping declarations and 0 `dangerouslySetInnerHTML`; the repo-wide raw-hex gate returns `0`; `G-02-3` and `feed-row-slot` each appear ≥1 time in `session-surface.test.tsx`.
