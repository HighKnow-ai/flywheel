---
phase: 01-the-board-is-the-store-of-record
reviewed: 2026-09-10T07:47:25Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/__tests__/quick-add-focus.test.tsx
  - packages/desktop/src/test/setup.ts
  - .planning/phases/01-the-board-is-the-store-of-record/01-UI-SPEC.md
findings:
  critical: 1
  warning: 0
  info: 1
  total: 2
status: issues_found
---

# Phase 01: Code Review Report (Incremental #3661 — CR-01 gap closure)

**Reviewed:** 2026-09-10T07:47:25Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This incremental review covers commit `fb961dc` ("rising-edge guard for Backlog auto-expansion")
and `71ca01d` (scrollTo clamp), the two commits that make up plan `01-21`'s CR-01/WR-01/IN-01
gap closure, plus the accompanying test additions.

The fix correctly solves the bug it targets: a single project, opened once, whose Backlog is
manually collapsed while quick-add is reachable, now stays collapsed (verified by tracing the
`backlogAutoExpandedForRef` guard against every test case in `quick-add-focus.test.tsx`, including
the zero-item/permanently-reachable case that was the worst instance of the original defect).

However, the guard's chosen representation — a single scalar `useRef<string | null>` holding only
the *most recently seen* project id — cannot represent "already handled" for more than one project
at a time. Tracing the effect against a project-switch sequence longer than the one the new test
covers (A → B → **A again**, without unmounting `BoardView`, exactly the scenario the ref's own doc
comment says it exists to handle) reproduces the original CR-01 symptom: a project the user
deliberately re-collapsed has its Backlog silently re-expanded the next time it is revisited,
because the ref no longer remembers that project's episode was already seeded. Given the product's
own stated purpose — supervising many projects at once — switching between projects is not an edge
case, so this is classified Critical rather than Warning. See CR-01 below.

The `setup.ts` scrollTo clamp (IN-01 closure) is sound: the `scrollHeight > 0` guard is correctly
derived from a verified fact about this repo's jsdom version (every element reports `scrollHeight
0`), is proven by its own test case, and does not regress any other test's use of the unclamped
stub. One minor documentation point is noted under IN-01 below, not a functional defect.

## Critical Issues

### CR-01: The rising-edge guard only remembers one project, so revisiting a project re-triggers the auto-expand and silently undoes the user's own Backlog collapse

**File:** `packages/desktop/src/board/BoardView.tsx:159` (declaration), `:396-407` (effect),
`:467-472` (`openQuickAdd`'s direct expand)

**Issue:** `backlogAutoExpandedForRef` is `useRef<string | null>`, i.e. it can hold the identity of
*at most one* "already seeded" episode at a time:

```tsx
const backlogAutoExpandedForRef = useRef<string | null>(null);
...
useEffect(() => {
  const episodeKey = projectId ?? "";
  if (!effectiveQuickAddOpen) {
    backlogAutoExpandedForRef.current = null;
    return;
  }
  if (backlogAutoExpandedForRef.current === episodeKey) return;
  backlogAutoExpandedForRef.current = episodeKey;
  if (collapsedByStatus.backlog) {
    expandBand(episodeKey, "backlog");
  }
}, [effectiveQuickAddOpen, collapsedByStatus, projectId, expandBand]);
```

`App.tsx:212` renders `<Board projectId={project.id} …>` with no React `key`, so `BoardView` is
never remounted on a project switch — this is exactly the fact the ref's own doc comment (lines
152-158) cites as the reason to key on project id at all. But keying a *single* scalar on project
id only distinguishes "the episode I most recently handled" from "everything else"; it cannot
distinguish "project A, already handled" from "project A, not yet handled in this session" once a
*different* project's episode has been recorded in between.

Concrete repro, traced directly against the code (both projects use `collapseStore`'s
per-project-keyed state, confirmed in `packages/desktop/src/board/collapseStore.ts`):

1. Project A is open, quick-add reachable (e.g. via `⌘N`, or the empty-board default).
   `backlogAutoExpandedForRef.current` becomes `"A"`.
2. User clicks the Backlog header to collapse it. `collapsedByStatus.backlog` (for A) becomes
   `true`. The guard fires (`ref.current === "A" === episodeKey`) and returns early — the fix works
   here, matching `collapsing_backlog_while_quick_add_is_open_sticks`.
3. User switches to project B (still without unmounting `BoardView` — the un-keyed render path).
   `episodeKey` becomes `"B"`, which does not match the ref's `"A"`, so this is correctly treated
   as a fresh episode: `ref.current` becomes `"B"`. This matches the one test that exists for this
   path, `switching_to_a_project_with_a_collapsed_backlog_still_expands_it`.
4. User switches **back** to project A. `episodeKey` is `"A"` again, but `ref.current` is now
   `"B"` — the ref has no memory that A was already handled in step 1. The guard's
   `ref.current === episodeKey` check fails, so this is (incorrectly) treated as a brand-new
   episode: the effect sets `ref.current = "A"` and, seeing `collapsedByStatus.backlog` for A is
   still `true` (the user's own collapse from step 2 — collapse state is per-project and does not
   reset on switch), calls `expandBand("A", "backlog")` — **silently reverting the user's
   deliberate collapse from step 2**, with no click and no accelerator press from the user to
   justify it.

This directly contradicts the guarantee `01-UI-SPEC.md` states for this very fix (Quick-add
section, "Corrected in plan `01-21` (CR-01)"): *"a band the user collapses afterward stays
collapsed until the user says otherwise, and pressing the new-task accelerator again is what
re-expands it."* Switching away to another project and back is neither "the user saying otherwise"
nor "pressing the accelerator" — yet it silently re-expands. It also contradicts the
`UI Considerations` table's `✅ covered` row for "status band collapse toggle, quick-add open",
which is only true for the single-project-session case, not the multi-project one the product is
built around.

The same root cause (a single scalar standing in for "already handled," instead of a per-project
record) also means any full `BoardView` unmount/remount (not just an un-keyed prop change) resets
the memory to a blank slate, which happens to produce the same wrong outcome if quick-add is still
reachable and the band is still collapsed at remount time.

No existing test in `quick-add-focus.test.tsx` covers the third leg of the round trip (A → B →
**A**) — the closest test, `switching_to_a_project_with_a_collapsed_backlog_still_expands_it`
(lines 381-414), only exercises A → B once.

**Fix:** Track "already seeded" per project, not as a single last-seen value — e.g. a `Set<string>`
(or `Record<string, true>`) that only removes a project's entry when that specific project's
reachability episode actually ends, not merely because a different project was viewed in between:

```tsx
const backlogAutoExpandedForRef = useRef<Set<string>>(new Set());
...
useEffect(() => {
  const episodeKey = projectId ?? "";
  if (!effectiveQuickAddOpen) {
    backlogAutoExpandedForRef.current.delete(episodeKey);
    return;
  }
  if (backlogAutoExpandedForRef.current.has(episodeKey)) return;
  backlogAutoExpandedForRef.current.add(episodeKey);
  if (collapsedByStatus.backlog) {
    expandBand(episodeKey, "backlog");
  }
}, [effectiveQuickAddOpen, collapsedByStatus, projectId, expandBand]);
```

Add a regression test extending `switching_to_a_project_with_a_collapsed_backlog_still_expands_it`
(or a new case) that performs the full A → B → A round trip within one mount (using `rerender`
twice, as the existing test already does once) and asserts project A's Backlog is **still
collapsed** after returning to it, proving the fix distinguishes "already seeded" per project
rather than per "most recently viewed" project.

## Info

### IN-01: `setup.ts`'s scroll-clamp guard depends on a caller explicitly setting `scrollHeight`, which no production code path does

**File:** `packages/desktop/src/test/setup.ts:69-86`

**Issue:** Not a functional defect — the implementation and its own test
(`the_scroll_stub_clamps_to_a_real_scrollable_range_only_when_one_exists`, in
`quick-add-focus.test.tsx:161-186`) are internally consistent and the reasoning in the comment
(jsdom reports `scrollHeight === 0` for every element by default) is verifiable and correct.
Flagging only for future maintainers: because the ceiling clamp is gated on `scrollHeight > 0`, and
no test in this repo's suite currently gives a `BoardView` rack container a non-zero
`scrollHeight`, the ceiling branch is exercised only by the one purpose-built unit test for the
stub itself — it is not (and cannot yet be) exercised by any test that goes through `BoardView`'s
own scroll container. This is fine as-is (the guard's job is specifically to stay inert for every
current caller), but a future test that starts giving the board container a real `scrollHeight`
(e.g. to more faithfully simulate a browser) should re-check this clamp's arithmetic against that
new caller rather than assuming the existing unit test alone still proves it correct in context.

**Fix:** No change required now. Consider a code comment cross-reference (already partially present)
noting that the ceiling branch has no `BoardView`-level test coverage yet, so a future PR that
gives the rack container a real `scrollHeight` should add one.

---

_Reviewed: 2026-09-10T07:47:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
