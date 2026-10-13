---
phase: "08"
slug: "review-and-merge-inside-flywheel"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 8` from `08-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is filled once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (integration tests in `packages/core/tests/*.rs`, fixtures in `tests/common/mod.rs` — `seeded_git_project()` gives a real git repo + registered project). Frontend: Vitest 5.0.0 + jsdom + Testing Library (`packages/desktop/vitest.config.ts`, `src/test/setup.ts`). |
| **Config file** | `packages/desktop/vitest.config.ts` (exists); Rust needs no config — new `tests/*.rs` files are Wave 0 |
| **Quick run command** | `cargo test -p core --test review_diff` (or `review_merge` / `criterion_anchors` / `epic_request_draft`) · `npx --prefix packages/desktop vitest run src/review` |
| **Full suite command** | `cargo test --workspace` and `npm --prefix packages/desktop test` plus `npx --prefix packages/desktop tsc --noEmit` |
| **Estimated runtime** | ~60 seconds quick · ~4 minutes full |

---

## Sampling Rate

- **After every task commit:** the single targeted `--test` / `vitest run <file>` for that task, plus `cargo test -p core --test supervisor_cwd` (the standing cwd-invariant gate from Phase 7)
- **After every plan wave:** `cargo test --workspace` and `npm --prefix packages/desktop test && npx --prefix packages/desktop tsc --noEmit`
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Task IDs are bound to the plans created by `/gsd-plan-phase 8`. Every row's command is one the
plan actually runs in a `<verify><automated>` block, with a `<fails_when>` sibling naming the
observable failure signal. Corrections to the requirement-level map seeded from
`08-RESEARCH.md` are listed under the table.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| T1 | 08-01 | 1 | REVW-01 | T-08-01-01 | `review_files` returns A/M/D/R + counts + binary + `old_path`; a rename patch includes git's rename header; binary yields no hunks; a spaced path survives intact | integration (real repo) | `cargo test -p core --test review_diff` | created by T1 | pending |
| T1 | 08-01 | 1 | REVW-02 | T-08-01-03 | Epic scope diff is `default...integration`; a NULL integration branch yields a typed no-branch outcome and cuts no branch | integration | `cargo test -p core --test review_diff` | created by T1 | pending |
| T1 | 08-01 | 1 | REVW-01..05 | T-08-01-01 | One git construction site, `-C` first, no ambient current-directory read | gate | `cargo test -p core --test supervisor_cwd` | exists | pending |
| T2 | 08-01 | 1 | REVW-01 | T-08-01-04 | Both read commands run off the main thread and accept no ref, sha or repository path | compile + source | `cargo build --workspace` | exists | pending |
| T3 | 08-01 | 1 | REVW-01 | T-08-01-07 | A `.rs` patch tokenizes through the refractor adapter; an unregistered language renders plain without throwing | unit | `npm --prefix packages/desktop run test -- src/review/__tests__/highlight.test.ts` | created by T3 | pending |
| T3 | 08-01 | 1 | REVW-01, REVW-02 | T-08-01-05 | Per-file lazy fetch: opening a file requests its patch once, files start collapsed, a chunked file names how many hunks remain, the no-branch state requests no patch | component | `npm --prefix packages/desktop run test -- src/review/__tests__/review-surface.test.tsx` | created by T3 | pending |
| T1 | 08-02 | 2 | REVW-03 | T-08-02-01 | `check_criterion_with_anchor` stores a core-resolved sha; a second check replaces rather than duplicates; uncheck clears in the same transaction; a locked revise copies the anchor forward; both hard deletes cascade | integration | `cargo test -p core --test criterion_anchors` | created by T1 | pending |
| T1 | 08-02 | 2 | REVW-03 | T-08-02-07 | The migration is registered exactly once and the list stays ordered | gate | `cargo test -p core --test migration_safety` | exists | pending |
| T2 | 08-02 | 2 | REVW-03 | T-08-02-03 | Staleness: untouched, changed with a count, renamed or deleted path, unresolvable sha; nothing persisted | integration | `cargo test -p core --test criterion_anchors` | extended by T2 | pending |
| T3 | 08-02 | 2 | REVW-03 | T-08-02-05 | Context packet carries checked, anchor and staleness; no evidence line for an unchecked criterion; two assemblies byte-identical | integration | `cargo test -p core --test context_packet` | update | pending |
| T1 | 08-03 | 2 | REVW-04 | T-08-03-04 | The dry run's exit-code contract and its zero side effects; merge commit creation; a conflict aborts and proves the tree clean; a hand-built in-progress merge is recovered; the push carries no history-rewriting flag | integration (real repo) | `cargo test -p core --test review_merge` | created by T1 | pending |
| T2 | 08-03 | 2 | REVW-04 | T-08-03-05 | Clean merge writes one event and no status; a conflict names files and leaves the integration worktree clean; already-integrated creates no commit; a dirty worktree is a named refusal; the task worktree is untouched | integration | `cargo test -p core --test review_merge` | extended by T2 | pending |
| T2 | 08-03 | 2 | REVW-04 | T-08-03-06 | A per-epic guard rejects a second concurrent merge; two sequential merges both land | unit | `cargo test -p core --test review_merge -- lock` | created by T2 | pending |
| T3 | 08-03 | 2 | REVW-04 | T-08-03-08 | The integrated marker derives from event plus live ancestry, so a freshly cut empty branch is not integrated and a rewound integration branch un-marks it | integration | `cargo test -p core --test review_merge -- marker` | created by T3 | pending |
| T1 | 08-04 | 2 | REVW-01, REVW-02 | T-08-04-01 | One keystroke opens the right scope per row kind, does nothing on an issue row, and is permitted in the board layer only | component + unit | `npm --prefix packages/desktop run test -- src/board/__tests__/review-doors.test.tsx` | created by T1 | pending |
| T1 | 08-04 | 2 | REVW-01 | T-08-04-01 | The existing layer scoping still holds for every other layer | unit | `npm --prefix packages/desktop run test -- src/board/__tests__/layer-guard.test.tsx` | exists | pending |
| T2 | 08-04 | 2 | REVW-01 | T-08-04-02 | The palette offers a review route for a resolved git identifier and keeps its detail route; a finished run offers review only with a terminal status and a task id | component | `npm --prefix packages/desktop run test -- src/session/__tests__/session-surface.test.tsx` | extend | pending |
| T1 | 08-05 | 3 | REVW-05 | T-08-05-02 | `assemble_epic_request_draft` is deterministic and clockless, head and target carry no remote prefix, a NULL branch is a named error, criteria and the task roll-up carry real state | integration | `cargo test -p core --test epic_request_draft` | created by T1 | pending |
| T2 | 08-05 | 3 | REVW-05 | T-08-05-04 | Each of the four blockers is reported by name; the existing-request lookup precedes the push | integration | `cargo test -p core --test epic_request_draft` | extended by T2 | pending |
| T2 | 08-05 | 3 | REVW-05 | T-08-05-05 | Open flow against a fake `gh`: push, then create with the integration branch as head and the default branch as base; a rejected push creates nothing; a push that lands with a failed create reports the partial outcome | integration | `cargo test -p core --test forge_live_chain` | extend | pending |
| T1 | 08-06 | 3 | REVW-03 | T-08-06-03 | The rail shows evidence, no-evidence, fresh, stale and unknown; unknown never renders as fresh; the footer count is absent at zero; the row is composed, not forked | component | `npm --prefix packages/desktop run test -- src/review/__tests__/criteria-rail.test.tsx` | created by T1 | pending |
| T1 | 08-06 | 3 | REVW-03, REVW-04 | — | Every new mark is defined in the legend and renders with its printed word | unit | `npm --prefix packages/desktop run test -- src/legend/__tests__/legend.test.tsx` | extend | pending |
| T2 | 08-06 | 3 | REVW-03 | T-08-06-01 | Selecting lines writes nothing; checking against a selection records exactly that path, side and range; a check with no selection passes no anchor; no sha is built in the renderer | component | `npm --prefix packages/desktop run test -- src/review/__tests__/criteria-rail.test.tsx` | extended by T2 | pending |
| T1 | 08-07 | 4 | REVW-04 | T-08-07-02 | The merge command takes a task id alone, releases the database lock twice, takes the epic guard once, and an integrated task's review range is the merge commit against its first parent | compile + source + integration | `cargo test -p core --test review_diff` | extended by T1 | pending |
| T2 | 08-07 | 4 | REVW-04 | T-08-07-05 | The sheet shows source, target, commit and file counts, the no-evidence count, the dirty warning and the will-conflict hint; opening and cancelling writes nothing; an epic-less task is offered no merge | component | `npm --prefix packages/desktop run test -- src/review/__tests__/merge-sheet.test.tsx` | created by T2 | pending |
| T3 | 08-07 | 4 | REVW-04 | T-08-07-08 | Three distinct outcomes; a conflict lists its files and offers a resolve session and the editor; the already-running refusal offers no retry; no status setter exists in the mocked adapter surface | component | `npm --prefix packages/desktop run test -- src/review/__tests__/merge-sheet.test.tsx` | extended by T3 | pending |
| T1 | 08-08 | 5 | REVW-05 | T-08-08-02 | All three epic forge commands accept an epic id alone, are registered once each, and the open command releases the lock before the push | compile + source | `cargo build --workspace` | exists | pending |
| T2 | 08-08 | 5 | REVW-05 | T-08-08-01 | The sheet previews verbatim and confirms with the epic id alone; each blocker renders by name; the no-forge case renders nothing; the partial outcome is visibly distinct from success | component | `npm --prefix packages/desktop run test -- src/review/__tests__/epic-request.test.tsx` | created by T2 | pending |
| T3 | 08-08 | 5 | REVW-02 | — | The scope toggle rewrites the store field, is absent for an epic-less task, and clears the line selection | component | `npm --prefix packages/desktop run test -- src/review/__tests__/epic-request.test.tsx` | extended by T3 | pending |
| — | all | all | REVW-01..05 | — | The whole workspace is green after every wave | full suite | `cargo test --workspace` and `npm --prefix packages/desktop test` and `npx --prefix packages/desktop tsc --noEmit` | exists | pending |

### Corrections to the requirement-level map

1. **No `file-diff.test.tsx`.** The lazy per-file fetch and the collapsed-on-open behaviour are
   properties of the surface, which owns the expand state — asserting them in a standalone
   file-diff test would mean mocking that state. They are asserted in
   `src/review/__tests__/review-surface.test.tsx` (plan 08-01 task 3) instead.
2. **No new `src/state` test file.** The board-list binding and the review-layer scoping are
   asserted in `src/board/__tests__/review-doors.test.tsx` (plan 08-04 task 1) and in the existing
   `src/board/__tests__/layer-guard.test.tsx`, which is where this codebase already asserts layer
   scoping.
3. **The per-epic lock test is a core test, as the seeded map said — and the lock itself moved to
   match.** The guard lives in `packages/core/src/merge.rs` rather than on the desktop crate's
   application state, so the core test exercises the real thing. This also avoids editing the
   single application-state literal and every test that constructs it.
4. **The `-- stale`, `-- lock` and `-- marker` filters only select if the test names carry those
   words.** The plans require that explicitly in their acceptance criteria, and the whole-file
   command is the superset that a naming slip cannot defeat.
5. **Two test files the seeded map did not list:** `src/review/__tests__/merge-sheet.test.tsx`
   (plan 08-07) and `src/board/__tests__/review-doors.test.tsx` (plan 08-04).
6. **Threat refs are bound** from each plan's own `<threat_model>` register; the seeded map had a
   dash in every row.

---

## Wave 0 Requirements

There is no separate Wave 0 plan: every missing test file is created by the task whose behaviour it
asserts, in the same commit, which is what keeps a test honest about the code beside it. Ownership:

- [ ] `packages/core/tests/common/mod.rs` — the diverging-branch fixture (an integration branch, a
      clean task-branch pair, a conflicting pair, plus added, deleted, renamed, binary and
      spaced-path files) → **plan 08-01 task 1**, consumed unchanged by 08-03 and 08-05
- [ ] `packages/core/tests/review_diff.rs` — REVW-01, REVW-02 → **plan 08-01 task 1**
- [ ] `packages/core/tests/criterion_anchors.rs` — REVW-03 → **plan 08-02 tasks 1 and 2**
- [ ] `packages/core/tests/review_merge.rs` — REVW-04 → **plan 08-03 tasks 1, 2 and 3**
- [ ] `packages/core/tests/epic_request_draft.rs` — REVW-05 → **plan 08-05 tasks 1 and 2**
- [ ] `packages/desktop/src/review/__tests__/highlight.test.ts` → **plan 08-01 task 3**
- [ ] `packages/desktop/src/review/__tests__/review-surface.test.tsx` → **plan 08-01 task 3**
- [ ] `packages/desktop/src/board/__tests__/review-doors.test.tsx` → **plan 08-04 tasks 1 and 2**
- [ ] `packages/desktop/src/review/__tests__/criteria-rail.test.tsx` → **plan 08-06 tasks 1 and 2**
- [ ] `packages/desktop/src/review/__tests__/merge-sheet.test.tsx` → **plan 08-07 tasks 2 and 3**
- [ ] `packages/desktop/src/review/__tests__/epic-request.test.tsx` → **plan 08-08 tasks 2 and 3**
- [ ] `npm --prefix packages/desktop install --save-exact react-diff-view@3.3.3 refractor@5.0.0`
      → **plan 08-01 task 3** (vitest is already present; both packages audited OK in
      `08-RESEARCH.md`, so no legitimacy checkpoint is required)
- [ ] The worktree-root environment variable is set to a tempdir under the serialised lock variant
      in every new Rust test file, so epic worktrees land inside it → **plans 08-01, 08-03, 08-05**

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Diff legibility and syntax-highlight colour in both themes at review width | REVW-01 | Visual judgement; token colour and contrast cannot be asserted meaningfully in jsdom | Open a task with a multi-language diff, read it in light and dark, confirm added/removed tint does not fight token colour |
| Criteria rail feels usable while reading a long diff | REVW-03 | Ergonomic judgement about pacing of a real review | Review a real multi-file task, check off each criterion against the diff without losing scroll position |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
