---
phase: 01-the-board-is-the-store-of-record
reviewed: 2026-09-10T06:37:39Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/desktop/src/state/uiStore.ts
  - packages/desktop/src/board/QuickAdd.tsx
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/collapseStore.ts
  - packages/desktop/src/test/setup.ts
  - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx
  - packages/desktop/src/board/__tests__/menu-bridge.test.tsx
  - packages/desktop/src/board/__tests__/volume.ts
  - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md
findings:
  critical: 1
  warning: 1
  info: 1
  total: 3
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-09-10T06:37:39Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This is an incremental review of the G-01-4 gap-closure work (plans 01-19/01-20): quick-add's
consume-once focus request (`quickAddFocusPending`) and the "expand a collapsed Backlog band on
open" effect. This review supersedes the prior 01-01..01-18 review at this same path.

The consume-once focus mechanism (`state/uiStore.ts`'s `quickAddFocusPending`,
`board/QuickAdd.tsx`'s guarded focus effect, `board/BoardView.tsx`'s `quickAddRowIndex` +
scroll-into-view effect) is sound: I traced the two-render choreography (scroll effect fires
first with the negative-index guard, the expand effect fires on a separate render when Backlog is
collapsed, and the row's own focus effect fires once it finally mounts) and it converges correctly
for every case the test suite exercises, including the volume fixture and the real forwarded
`menu:action` path.

However, the second half of the fix — forcing a collapsed Backlog band open whenever quick-add is
reachable (`BoardView.tsx` lines 373-376) — is implemented as a continuously-reasserted invariant
rather than a one-time action on open. I traced this to a real, reproducible regression: **the
Backlog band's collapse toggle stops working for as long as quick-add is open** (see CR-01 below),
proven with a throwaway repro test against the actual component tree, not just static reading. The
existing 147-test suite (including the new volume/menu-bridge suites) does not catch this because
no test exercises the collapse toggle while quick-add is open — see CR-01's fix section for the
missing coverage this also flags.

## Critical Issues

### CR-01: Opening quick-add permanently pins the Backlog band open — the user cannot collapse it back while quick-add is up

**File:** `packages/desktop/src/board/BoardView.tsx:373-376` (the effect), interacting with
`packages/desktop/src/board/BoardView.tsx:633` (the header's unguarded click handler) and
`packages/desktop/src/board/collapseStore.ts:34-43` (`expand`)

**Issue:** The "expand a collapsed Backlog band" effect added in this round is:

```tsx
useEffect(() => {
  if (!effectiveQuickAddOpen || !collapsedByStatus.backlog) return;
  expandBand(projectId ?? "", "backlog");
}, [effectiveQuickAddOpen, collapsedByStatus, projectId, expandBand]);
```

Its dependency array includes `collapsedByStatus` (the whole per-project collapse map), so it
re-runs and re-calls `expandBand` **every time `collapsedByStatus.backlog` becomes truthy while
`effectiveQuickAddOpen` is still true** — not just once, at the moment quick-add opens. Meanwhile
`StatusBand`'s click handler (`onToggleCollapsed={() => toggleCollapsed(projectId ?? "", row.status)}`,
line 633) is wired with no layer/state guard at all — it is always clickable, including while
quick-add is open.

Net effect: if the user opens quick-add (⌘N, `c`, the palette, or the empty-board default) and
then clicks the Backlog band header to collapse it — a fully supported, always-visible affordance —
the click is immediately reverted by this effect on the very next render. The band snaps back
open. This is not a corner case: `effectiveQuickAddOpen` is `quickAddOpen || items.length === 0`,
so for **any empty project**, this condition is permanently true and the Backlog band's collapse
toggle is completely inert for that project — every click is undone.

This directly contradicts `01-UI-SPEC.md`'s framing of band-collapse as "a local UI preference"
the user controls, and contradicts this very gap-closure's own UI-SPEC addition ("opening quick-add
guarantees the Backlog band is expanded **first**" — "first" implies a one-time action on open, not
a standing invariant that fights the user's own subsequent input).

**Reproduction (verified against the real component tree, not just read):** I wrote a throwaway
test (not committed) that renders `BoardView` with one item, presses ⌘N, then fires a click on the
"Backlog" header exactly as `StatusBand`'s `onClick` does. Result:

```
collapsed state after click: { backlog: false }
AssertionError: expected false to be true
```

i.e. the store's `collapsedByProject["proj-1"].backlog` is `false` immediately after the user's
own collapse click — the click never sticks. All 147 existing tests still pass, because none of
them exercises "toggle collapse while quick-add is open."

**Fix:** Scope the forced expansion to fire once per "quick-add became reachable" transition
instead of continuously re-asserting it, e.g. with a ref that tracks the rising edge of
`effectiveQuickAddOpen`:

```tsx
const backlogAutoExpandedRef = useRef(false);
useEffect(() => {
  if (!effectiveQuickAddOpen) {
    backlogAutoExpandedRef.current = false;
    return;
  }
  if (backlogAutoExpandedRef.current) return;
  backlogAutoExpandedRef.current = true;
  if (collapsedByStatus.backlog) {
    expandBand(projectId ?? "", "backlog");
  }
}, [effectiveQuickAddOpen, collapsedByStatus, projectId, expandBand]);
```

This still auto-expands on the moment quick-add becomes reachable (covers both the ⌘N/`c`/palette
open and the empty-board default on mount), but stops fighting a user-initiated collapse taken
afterward, while `effectiveQuickAddOpen` is still true. Also add a regression test asserting that
clicking the Backlog header while quick-add is open results in `collapsedByProject[...].backlog ===
true` and stays there (the exact scenario this finding reproduces) — the current suite has no such
case despite otherwise being thorough about this gap's other failure paths.

## Warnings

### WR-01: No test coverage for the collapse-toggle-vs-quick-add-open interaction introduced by this round

**File:** `packages/desktop/src/board/__tests__/quick-add-focus.test.tsx` (describe block "a
collapsed Backlog band can no longer swallow the quick-add row (Task 2)")

**Issue:** This suite thoroughly covers the "band starts collapsed, quick-add expands it" direction
(4 cases) and the "expand doesn't touch other bands/other projects" direction, but never exercises
the inverse interaction this round's own effect introduces: the user collapsing the band *after*
quick-add is already open. That gap is exactly what let CR-01 ship green through 147 passing tests.

**Fix:** Add a case alongside the existing "Task 2" describe block: open quick-add, click/toggle
Backlog closed, and assert it stays closed (and, separately, that quick-add itself is unaffected —
the row may legitimately disappear from the rendered list once its band is collapsed, per the
`rows` memo's existing `if (collapsedByStatus[status]) continue;` skip, but the collapse state
itself must not be silently reverted).

## Info

### IN-01: `Element.prototype.scrollTo` test stub does not clamp to the container's scrollable range

**File:** `packages/desktop/src/test/setup.ts:56-67`

**Issue:** The new stub added for this round sets `this.scrollTop = Math.max(0, top)` — it clamps
the floor at zero but never clamps the ceiling to `scrollHeight - clientHeight` the way a real
browser's `Element.scrollTo` does. Today this is harmless because `volume.ts`'s `DEEP_SCROLL_OFFSET`
is itself derived and clamped against the fixture's estimated total height before it ever reaches
this stub, but the stub itself provides no such protection for any future caller. A future
`scrollToIndex` call with a miscalculated or unclamped target could silently produce a
jsdom-only scroll position a real browser would never reach, masking a regression under test that
would behave differently in production.

**Fix:** Optionally clamp `top` to `[0, this.scrollHeight - this.offsetHeight]` (or the
element's effective client height) inside the stub, mirroring real `scrollTo` semantics more
closely, so a future out-of-range scroll target fails loudly under test instead of being silently
absorbed.

---

_Reviewed: 2026-09-10T06:37:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
