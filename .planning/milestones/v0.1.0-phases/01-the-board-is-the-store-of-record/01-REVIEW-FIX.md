---
phase: 01-the-board-is-the-store-of-record
fixed_at: 2026-09-10T07:55:56Z
review_path: .planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md
iteration: 2
findings_in_scope: 1
fixed: 1
skipped: 1
status: all_fixed
---

# Phase 01: Code Review Fix Report (Iteration 2)

**Fixed at:** 2026-09-10T07:55:56Z
**Source review:** .planning/phases/01-the-board-is-the-store-of-record/01-REVIEW.md (incremental review of plan 01-21)
**Iteration:** 2

**Summary:**
- Findings in scope: 1 (CR-01 residual — `critical`)
- Fixed: 1
- Skipped: 1 (IN-01, `info` — outside the default `critical+warning` fix scope)

Iteration 1 of this report covered the original four findings and was superseded by this file; see
git history for its contents.

## CR-01 residual — Backlog auto-expand guard remembered only one project — FIXED

**Finding.** Plan 01-21 replaced the per-render re-assertion with a rising-edge guard, which closed
CR-01's original symptom. But the guard was a scalar `useRef<string | null>` holding a single
project id, so it could only remember one already-seeded project at a time. Because `App.tsx:212`
renders `<Board projectId={project.id} …>` with no React `key`, `BoardView` is never remounted on a
project switch, and a round trip reproduced the original symptom:

| Step | Guard state | Outcome |
|---|---|---|
| Project A, quick-add reachable | `null` ≠ `"A"` → `"A"` | expand A — correct |
| User collapses A's Backlog | `"A"` = `"A"` → return | collapse sticks — correct |
| Switch to project B | `"A"` ≠ `"B"` → `"B"` | expand B — correct |
| Switch back to project A | `"B"` ≠ `"A"` → `"A"` | **expand A again — user's collapse silently undone** |

`collapseStore.ts` state is per-project keyed, so A's collapse genuinely survived the detour; only
the guard forgot. This violated plan 01-21's own must-have — *"Switching to a project whose Backlog
is collapsed, while quick-add remains reachable, still expands that project's Backlog **once**"* —
and was invisible to the suite because the nearest test
(`switching_to_a_project_with_a_collapsed_backlog_still_expands_it`) covers only the one-way A → B leg.

**Fix.** `packages/desktop/src/board/BoardView.tsx` — the scalar ref became a per-project
`useRef<Set<string>>`, so the guard remembers every project the current quick-add-reachability
episode has already seeded, independent of visit order. The whole set is cleared when quick-add
stops being reachable, because that transition ends the episode for every project at once rather
than being a fact about the current one.

`openQuickAdd`'s explicit-request expansion is unchanged — an explicit accelerator press remains a
legitimate new rising edge. `StatusBand.tsx`, `collapseStore.ts`, the `rows` memo, and the source
order of the two quick-add effects (`scrollToIndex` at :370 still ahead of expand-Backlog at :414,
preserving plan 01-19's two-render choreography) are all untouched.

**Commits (RED → GREEN → docs):**

| Commit | What |
|---|---|
| `2dca0f3` | `test(01-21)` — failing test for the A → B → A round trip; confirmed red against the pre-fix code (`collapsedByProject["proj-a"].backlog` read `false`) |
| `7d382ec` | `fix(01-21)` — per-project `Set` guard |
| `a45c615` | `docs(01-21)` — Post-Review Addendum appended to `01-21-SUMMARY.md` |

## IN-01 — scrollTo clamp lacks coverage through a real scroll path — SKIPPED

`info` severity, outside the default `critical+warning` fix scope. The reviewer confirmed the
`scrollHeight > 0` guard is sound and proven by its own test; the note is that no test drives it
through a real `BoardView` scroll container. Recorded for future maintainers, not a functional defect.

## Verification

Run in the main working tree on `cymarechal-devoteam/gsd-new-project-ade` (worktree isolation
auto-degraded under #683), and independently re-run by the orchestrator after the agent returned:

| Command | Result |
|---|---|
| `npm --prefix packages/desktop run test -- --run src/board/__tests__/quick-add-focus.test.tsx` | 24/24 passing |
| `npm --prefix packages/desktop run test -- --run` | 20 files, 155/155 passing (floor 154) |
| `npm --prefix packages/desktop run build` | clean, no `error TS` |
| `cargo test --workspace` | all suites `test result: ok`, 0 failed |
