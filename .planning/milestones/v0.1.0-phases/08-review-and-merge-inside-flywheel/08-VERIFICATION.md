---
phase: 08-review-and-merge-inside-flywheel
verified: 2026-10-07T16:15:00Z
status: passed
score: 6/9 must-haves verified
human_verification: deferred
deferred_to: ".planning/DEFERRED-REVIEW.md"
deferred_items: [D-REV-02, D-REV-03, D-REV-04, D-REV-05, D-REV-06, D-REV-07, D-REV-08]
timestamp_convention: |
  `verified:` is local wall clock (+08:00) labelled Z, matching every other
  artifact in this phase. True UTC at write time was 2026-10-07T08:15Z. The
  staleness check is digest-based (#4155), so this does not affect it; a future
  evidence-gate `git log --since` reads ~8h wide, which fails closed.
closure_note: |
  Closed on automated verification plus ROADMAP success criteria, per the owner's
  2026-10-07 decision to suspend human verification until MVP (.claude/CLAUDE.md
  § "Human verification is deferred until MVP"). This is NOT a claim that the
  deferred items were observed:
    - criterion 2 (check a task's criteria against its diff) is NOT demonstrable
      on this board. Code path live and test-covered; the DATA is absent. D-REV-04.
      CORRECTED THIS ROUND: the database now holds FOUR acceptance_criteria rows
      (2 task + 2 epic), not two, and the epic carrying the integration branch
      `flywheel/epic/thre-7-agent-session-supervision` now has ONE criterion, not
      zero. Both epic rows were created 2026-10-07T07:27-07:28Z with probe text
      ("test"/"hello", hints "hello"/"ok") — i.e. during round-2 UAT, almost
      certainly typed INTO the auto-opened composer that G-08-R2-1 had stolen
      focus into. The criterion-2 verdict is unchanged in substance: all five
      tasks that have a worktree still carry ZERO criteria, and the two task-scope
      rows sit on an epic-less, worktree-less task, so there is still no task diff
      against which a task criterion can be checked. The register's stated numbers
      were stale and are corrected in place (additively).
    - criterion 3 is PARTIAL. Merge half PROVEN LIVE and re-confirmed
      independently this round: `ae6423c` is a real two-parent merge commit,
      THRE-43's tip is an ancestor of the epic branch, `git rev-list --count` is 0.
      CORRECTED THIS ROUND: the conflict half is NOT untested — it is proven by
      four named core tests against REAL conflicting git fixtures
      (`task_conflict_a`/`task_conflict_b` in tests/common/mod.rs), including
      "rolls back and leaves the worktree clean" and "never creates the epic
      worktree", plus four renderer tests that render the conflict result naming
      every file and "nothing changed". What is unverified is narrower than
      recorded: no conflict has ever been observed END TO END in the running app
      (merge-tree is clean 5/5, re-confirmed), and WR-05's keyboard exit route out
      of the conflict result does not exist. D-REV-02.
    - WR-04's draftChanged ordering is still proven by READING only
      (forge.rs:401-404 returns before open_epic_request_at at 407). D-REV-03.
  Criteria 1 and 4 are satisfied. Criterion 4 gained real evidence last round:
  REVW-05's idempotency against the REAL gh CLI and live GitHub API (opened PR #1,
  second call AlreadyOpen #1, cleanup verified) — previously a #[ignore]d test that
  had never run. The attribute is still present (forge_live_github.rs:87) by
  design; it is run by name with `-- --ignored`.
  Fixed and INDEPENDENTLY RE-PROVEN this round: G-08-R2-1. I reverted
  `autoOpenWhenEmpty={false}` from CriteriaRail and ran the named test file: 2
  failed / 8 passed. Restored, full suite 770/770. The fail-first claim is not
  taken on the SUMMARY's word.
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-01-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-01-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-02-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-02-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-03-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-03-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-04-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-04-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-05-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-05-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-06-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-06-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-07-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-07-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-08-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-08-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-09-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-09-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-10-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-10-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-11-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-11-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-12-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-12-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-13-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-13-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-14-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-14-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-15-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-15-SUMMARY.md"
  - "packages/core/Cargo.toml"
  - "packages/core/src/context_packet.rs"
  - "packages/core/src/db/migrations/0018_criterion_anchors.sql"
  - "packages/core/src/db/mod.rs"
  - "packages/core/src/domain/acceptance_criterion.rs"
  - "packages/core/src/epic_context_packet.rs"
  - "packages/core/src/forge/mod.rs"
  - "packages/core/src/forge/request_body.rs"
  - "packages/core/src/git.rs"
  - "packages/core/src/lib.rs"
  - "packages/core/src/merge.rs"
  - "packages/core/src/query/authoring.rs"
  - "packages/core/src/review.rs"
  - "packages/core/tests/common/mod.rs"
  - "packages/core/tests/context_packet.rs"
  - "packages/core/tests/criterion_anchors.rs"
  - "packages/core/tests/epic_request_draft.rs"
  - "packages/core/tests/forge_live_chain.rs"
  - "packages/core/tests/forge_live_github.rs"
  - "packages/core/tests/review_diff.rs"
  - "packages/core/tests/review_merge.rs"
  - "packages/desktop/package.json"
  - "packages/desktop/src-tauri/capabilities/default.json"
  - "packages/desktop/src-tauri/src/commands/forge.rs"
  - "packages/desktop/src-tauri/src/commands/mod.rs"
  - "packages/desktop/src-tauri/src/commands/review.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src/App.tsx"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/board/BoardView.tsx"
  - "packages/desktop/src/board/CommandPalette.tsx"
  - "packages/desktop/src/board/__tests__/layer-guard.test.tsx"
  - "packages/desktop/src/board/__tests__/review-doors.test.tsx"
  - "packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx"
  - "packages/desktop/src/item-detail/ItemDetailPanel.tsx"
  - "packages/desktop/src/item-detail/__tests__/forge-section.test.tsx"
  - "packages/desktop/src/legend/__tests__/legend.test.tsx"
  - "packages/desktop/src/legend/marks.ts"
  - "packages/desktop/src/review/CriteriaRail.tsx"
  - "packages/desktop/src/review/EpicRequestSheet.tsx"
  - "packages/desktop/src/review/FileDiff.tsx"
  - "packages/desktop/src/review/MergeConfirmSheet.tsx"
  - "packages/desktop/src/review/ReviewSurface.tsx"
  - "packages/desktop/src/review/__tests__/browser/ergonomics.browser.test.tsx"
  - "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx"
  - "packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx"
  - "packages/desktop/src/review/__tests__/browser/paint.ts"
  - "packages/desktop/src/review/__tests__/browser/review-fixture.ts"
  - "packages/desktop/src/review/__tests__/criteria-rail.test.tsx"
  - "packages/desktop/src/review/__tests__/epic-request.test.tsx"
  - "packages/desktop/src/review/__tests__/highlight.test.ts"
  - "packages/desktop/src/review/__tests__/keyboard-activation.test.tsx"
  - "packages/desktop/src/review/__tests__/merge-sheet.test.tsx"
  - "packages/desktop/src/review/__tests__/review-surface.test.tsx"
  - "packages/desktop/src/review/highlight.ts"
  - "packages/desktop/src/review/review.css"
  - "packages/desktop/src/review/selection.ts"
  - "packages/desktop/src/review/useReviewQuery.ts"
  - "packages/desktop/src/session/SessionSurface.tsx"
  - "packages/desktop/src/session/__tests__/session-surface.test.tsx"
  - "packages/desktop/src/state/__tests__/keyboard-agent.test.ts"
  - "packages/desktop/src/state/keyboard.ts"
  - "packages/desktop/src/state/uiStore.ts"
  - "packages/desktop/src/test/browser-setup.ts"
  - "packages/desktop/vitest.browser.config.ts"
  - "packages/desktop/vitest.config.ts"
  - "scripts/uat/README.md"
covered_digest: "v1:sha256:32e75a1a2f6a6694f23e230c1074281350e4bdd792a54a648ea04d269af42bfa"
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: passed
  previous_score: 7/8
  trigger: "fingerprint stale — AcceptanceCriteriaList.tsx and CriteriaRail.tsx changed by 857c21b after the prior report was written"
  gaps_closed:
    - "G-08-R2-1 epic review traps focus in the criteria composer, swallowing `r` — closed by 857c21b, fail-first reproduced by this verifier"
  gaps_remaining: []
  regressions: []
  corrections:
    - "D-REV-04's measured criteria count was 2; it is now 4, and the integration-branch epic is no longer at zero. Substance of the criterion-2 verdict unchanged."
    - "Criterion 3's conflict half was recorded UNVERIFIED; it is test-proven at core and renderer with real conflicting fixtures. Only the end-to-end in-app observation and WR-05's keyboard exit remain unverified."
    - "D-REV-02 was recorded `automatable: YES — a conflicting branch pair is three git commands in a test fixture`. The fixture ALREADY EXISTS and merge-sheet.test.tsx already renders the conflict result state, so the remaining work is one assertion, not a fixture."
gaps: []
deferred: []
advisory:
  - finding: "3 `error TS2345` from `tsc --noEmit -p packages/desktop`: `toHaveTextContent(/regex/)` typed as `string | number`, at forge-section.test.tsx:352 and settings-surface.test.tsx:179-180"
    category: other
    reason: |
      PRE-EXISTING and not attributable to this phase. `git log -L` puts the
      forge-section.test.tsx:345-358 region at 1c3ab1c (Phase 07-08), not at
      08-14; settings-surface.test.tsx was never touched by Phase 08. The cause
      is a jest-dom matcher-types resolution defect, not a wrong assertion —
      `toHaveTextContent` accepts a RegExp at runtime and all three assertions
      pass. Resolved by wiring `@testing-library/jest-dom` matcher types into
      the desktop tsconfig.
      It DOES violate 08-08-PLAN.md's acceptance criterion as literally worded
      ("`npx tsc --noEmit` exits 0 ... no line containing 'error TS'"), which is
      recorded here rather than dropped. It is not a blocker: no roadmap success
      criterion depends on it, the build passes, 770/770 tests pass.
    evidence_status: "reproducible — `packages/desktop/node_modules/.bin/tsc --noEmit -p packages/desktop` prints exactly those 3 lines. Evidenced, but Warning severity, not Blocker, so the Step 7 evidence gate's blocker rule does not engage."
behavior_unverified_items:
  - truth: "An epic request whose draft moved is refused with the bare string `draftChanged` BEFORE any push or forge call (WR-04)"
    test: "Preview an epic request, check a criterion on the board from elsewhere, then confirm; observe that no `git push` and no `gh pr create` ran and the sheet shows the new text"
    expected: "Rejection is the bare string `draftChanged`; the remote has no new branch or PR; the sheet re-renders the current text"
    why_human: |
      NOT a genuine human item — a testability defect, and said so plainly. The
      comparison lives inside a `#[tauri::command]` taking `State` and
      `AppHandle`, so no Rust test reaches it, and the renderer tests mock the
      rejection. A stub-forge test asserting the gh stub was never invoked on a
      hash mismatch would pin the ordering. Deferred as D-REV-03, flagged there
      as the highest-value automation item in the register.
coincidental_reliance_items: []
---

# Phase 8: Review And Merge Inside Flywheel Verification Report

**Phase Goal:** Cyril reviews an agent's work against the acceptance criteria that were agreed before it started, and lands it, without dropping back to a terminal.
**Verified:** 2026-10-07T16:15:00Z
**Status:** passed (human verification deferred, not performed)
**Re-verification:** Yes. The prior report was reported `stale` by `verification.status` because `857c21b` changed two files in its `covered_files`. This report re-computes against current code and refreshes the fingerprint.

## Verdict in one paragraph

The phase closes. Criteria 1 and 4 are satisfied, criterion 3 is partial, criterion 2 is not demonstrable on this board for want of DATA rather than code. G-08-R2-1 — the round-2 UAT gap where the epic review stole focus into the criteria composer and swallowed `r` — is genuinely fixed, and I proved its two regression tests red myself rather than taking the SUMMARY's word for it. Nothing found this round blocks the phase. Two of the facts I was asked to carry forward were measurably stale and are corrected: the board now holds four acceptance-criteria rows rather than two, and criterion 3's conflict half is test-proven against real conflicting git fixtures rather than untested. Neither correction changes a verdict; both change the reasoning, and one of them (D-REV-02) makes a register item *more* automatable than it was recorded.

## Goal Achievement

### Observable Truths

ROADMAP success criteria 1-4 are the contract. Truths 5-9 are the gap truths carried from prior rounds.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: user reads a task's full diff with syntax highlighting, and the accumulated diff of its epic's integration branch | ✓ VERIFIED | Owner reached and read both scopes in the running app ("Rest seems to work perfectly"). Regression check this round: 770/770 desktop tests across 51 files, `ReviewSurface` renders both scopes, `CriteriaRail` wired at `ReviewSurface.tsx:439`. |
| 2 | SC2: user checks off each of the task's acceptance criteria against the diff while reviewing it | ✗ NOT DEMONSTRABLE (data) | Not a code failure — a data vacuum, re-measured this round. Code path live and covered by 08-02/08-06/08-09 tests (`criterion_anchors` 19/19 green). But all five tasks holding a worktree carry ZERO criteria, and the only two task-scope criteria sit on an epic-less, worktree-less task, so no task diff exists to check a task criterion against. D-REV-04. |
| 3 | SC3: a task branch merges into its epic integration branch in-app, and any conflict is surfaced clearly rather than failing silently or half-merging | ⚠️ PARTIAL | **Merge half proven live**, re-confirmed independently: `ae6423c` is a real two-parent merge commit ("Merge THRE-43 ... into flywheel/epic/thre-7-..."), THRE-43's tip is an ancestor of the epic branch, `git rev-list --count` returns 0. **Conflict half proven by test, never observed in-app**: `review_merge` 37/37 green including `merge_no_ff_conflict_rolls_back_and_leaves_the_worktree_clean`, `run_merge_conflict_names_the_files_and_never_creates_the_epic_worktree`, `run_merge_conflict_against_an_existing_epic_worktree_leaves_it_clean`, all against real conflicting fixtures; renderer shows "Merge aborted — 3 conflicts, nothing changed" listing every file. `git merge-tree --write-tree` is clean 5/5 (re-measured), so no live conflict is reachable. D-REV-02. |
| 4 | SC4: a PR/MR for a finished epic's integration branch opens in one action | ✓ VERIFIED | Proven against the REAL `gh` CLI and live GitHub API last round: opened PR #1 on a throwaway repo, second call returned `AlreadyOpen #1`, cleanup verified (PR closed, branch deleted). Stub-forge chain `forge_live_chain` 37/37 green this round. |
| 5 | G-08-R2-1: pressing `r` on an epic review with zero criteria opens the epic request sheet instead of typing a character | ✓ VERIFIED | **Fail-first reproduced by this verifier**, not taken on trust. I removed `autoOpenWhenEmpty={false}` from `CriteriaRail.tsx` and ran `keyboard-activation.test.tsx`: **2 failed / 8 passed**. Restored; with the fix the file is 10/10 and the suite 770/770. The `r` test fires at `document.activeElement`, not `document.body`, so it is non-vacuous (a body-targeted press passes with the bug present). |
| 6 | G-08-1: every syntax-token role on added and removed rows clears 4.5:1, and exactly one palette ships | ✓ VERIFIED | Regression check only (unchanged this round). `legibility.browser.test.tsx` measures painted contrast in real WebKit for every role/row pair across five languages. Residue carried: a gutter-selected row is unmeasured (now D-REV-06). |
| 7 | G-08-5a: the published text is the text the sheet rendered; the renderer cannot influence it; no git/CLI/path output crosses IPC | ✓ VERIFIED | Regression check only. `epic_request_draft` 22/22 green. `content_hash` is the single digest, used by both the preview DTO and the confirm command. |
| 8 | G-08-5b / WR-04: a confirm whose draft changed is refused with bare `draftChanged` before anything is pushed | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Present, wired and correct by reading (`forge.rs:401-404` returns before `open_epic_request_at` at 407). No test exercises the ordering. A refactor moving the check below the push would pass every test in the repo. D-REV-03. |
| 9 | G-08-6: merge and epic-request confirmations are reachable and confirmable with no mouse | ✓ VERIFIED | `m` + Enter observed by the owner in the real macOS WKWebView (round-2 UAT test 1, task half passed). The `r` half was broken by G-08-R2-1 and is now fixed and test-covered (truth 5). Bindings fenced to the `review-surface` layer; `layer-guard.test.tsx:325` asserts the fence. |

**Score:** 6/9 truths verified (1 behavior-unverified, 1 partial, 1 not demonstrable).

## What changed since the prior report

`857c21b` is the only functional commit in the covered set since the prior report. It fixes G-08-R2-1 as a **composition** defect, which is the right diagnosis: `AcceptanceCriteriaList`'s zero-criteria auto-open-and-focus is correct in the item panel (the documented zero-item state in `01-UI-SPEC.md`) and wrong when composed into a surface that owns single-key bindings.

- `AcceptanceCriteriaList.tsx:59, 204, 290, 295` — new optional `autoOpenWhenEmpty` prop, defaulting to `true`, guarding the auto-open effect and included in its dependency array.
- `CriteriaRail.tsx:76` — passes `autoOpenWhenEmpty={false}`.
- The panel's path is unchanged **and still test-protected**: `ItemDetailPanel.tsx:292` passes no prop (so `true`), and `item-detail/__tests__/criteria.test.tsx:113` still asserts the composer opens on its own for a zero-item parent — 12/12 green. The fix is non-regressive by test, not merely by reading the default.

This is also the shortest correct fix: one optional prop with a safe default, no new abstraction, no change to `useRegionBindings` (whose refusal to claim a printable key while a text field holds focus is the correct behavior and was never the bug).

## Corrections to carried facts

Both corrections were made by re-measuring, not by re-reasoning. Neither changes a verdict.

### 1. The board now holds four acceptance-criteria rows, not two

The register and the prior report state "the database holds exactly TWO `acceptance_criteria` rows, both on tasks" and "every epic carrying an integration branch has zero". Re-measured against `~/Library/Application Support/Flywheel/flywheel.db`:

| parent_type | count |
|---|---|
| task | 2 |
| epic | 2 |

Both epic rows were created `2026-10-07T07:27:49Z` and `2026-10-07T07:28:09Z`, with statements `test` / `hello` and hints `hello` / `ok`. One of them is on epic `01M24BE37RE8ZGHN2P34GGK44Y` ("Agent session supervision"), which carries integration branch `flywheel/epic/thre-7-agent-session-supervision` — the exact epic used in the THRE-43 merge. So "every epic carrying an integration branch has zero" is now false.

The probe text and the timing place these rows inside round-2 UAT, almost certainly typed into the auto-opened composer that G-08-R2-1 had stolen focus into. That is corroboration of the bug, not a contradiction of the fix: `CriteriaRail` now passes `autoOpenWhenEmpty={false}` regardless of how many criteria exist.

**Criterion 2's verdict is unchanged.** The criterion is about a *task's* criteria against a *task's* diff. The five tasks with worktrees still carry zero criteria each; the two task-scope rows sit on task `01M22XC0SZDG9D7S01P13V2WXF` ("test", `in_review`, no epic, no worktree), so there is no diff to review them against. Still not demonstrable.

**Side effect worth naming:** the G-08-R2-1 root-cause note in `08-UAT.md` relies on "every epic carrying an integration branch has zero acceptance criteria" as proof the broken path was the only one reachable. That premise was true when measured and is now false — because the bug itself was used to falsify it. The diagnosis stands; its supporting measurement has expired.

### 2. Criterion 3's conflict half is test-proven, not untested

Recorded as "conflict half UNVERIFIED". That understates the evidence. The conflicting-git fixture **already exists** (`task_conflict_a` / `task_conflict_b`, `packages/core/tests/common/mod.rs:217-291`) and four named core tests run against it, covering exactly the words of the criterion — "surfaced clearly rather than failing silently or half-merging":

- `merge_tree_check_conflict_names_each_path_once_sorted`
- `merge_no_ff_conflict_rolls_back_and_leaves_the_worktree_clean`
- `run_merge_conflict_names_the_files_and_never_creates_the_epic_worktree`
- `run_merge_conflict_against_an_existing_epic_worktree_leaves_it_clean`

Plus four renderer tests (`merge-sheet.test.tsx:219, 328, 338, 358`) that render the conflict result naming every file and reading "Merge aborted — 3 conflicts, nothing changed".

What is genuinely unverified is narrower: no conflict has been observed **end to end in the running app** (merge-tree clean 5/5), and WR-05's keyboard exit route out of the conflict result does not exist. I keep criterion 3 at PARTIAL on the first of those, and I have not counted it toward the score.

**This makes D-REV-02 more automatable than recorded.** Its note reads "a conflicting branch pair is three git commands in a test fixture". The fixture exists, and `merge-sheet.test.tsx` already drives the conflict result state by mocking `mergeMock` to resolve `{kind: "conflicted", files: [...]}`. The remaining work is **one assertion** — that after the result renders, `document.activeElement` is one of the three exits — not a fixture. `MergeConfirmSheet.tsx:176-183` confirms why it would fail today: `focusedRef` guards the focus call to fire once, on the confirm button, so after the result replaces it focus is never moved.

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` | optional `autoOpenWhenEmpty`, default `true`, guarding the auto-open effect | ✓ VERIFIED | Prop declared (:59), defaulted (:204), guards the effect (:290) and is in its deps (:295). Default path still covered by `criteria.test.tsx:113`, 12/12 green. |
| `packages/desktop/src/review/CriteriaRail.tsx` | passes `autoOpenWhenEmpty={false}` | ✓ VERIFIED | :76. Rail is imported and rendered at `ReviewSurface.tsx:24, 439` — wired, not orphaned. |
| `packages/desktop/src/review/__tests__/keyboard-activation.test.tsx` | two non-vacuous G-08-R2-1 regression tests | ✓ VERIFIED | Both proven red by this verifier (2 failed with the fix reverted). Non-vacuous: fires at `document.activeElement`. |
| `packages/desktop/src/review/review.css` | single-layer row tint, marked edit | ✓ VERIFIED | Regression check; unchanged this round. |
| `packages/core/src/forge/request_body.rs` | `content_hash()` | ✓ VERIFIED | Single digest, both callers. |
| `packages/desktop/src-tauri/src/commands/forge.rs` | `contentHash` in, `draftChanged` out, guard before push | ✓ VERIFIED (ordering by reading) | :401-404 before :407. See truth 8. |
| `packages/desktop/src/review/MergeConfirmSheet.tsx` | focus confirm on open | ✓ VERIFIED (partial) | :176-183. Result-state exits never focused (WR-05, D-REV-02). |
| `packages/core/tests/common/mod.rs` | conflicting-branch fixture | ✓ VERIFIED | `task_conflict_a`/`task_conflict_b` at :217-291 — exists, and is why D-REV-02 needs no new fixture. |
| `.../uat-screenshots/uat-01-review-diff-1440x900.png` | postdates `review.css` | ✓ VERIFIED | `find -newer` returns the path (08-13's own acceptance check, re-run). |

## Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `CriteriaRail` | `AcceptanceCriteriaList` | `autoOpenWhenEmpty={false}` prop (:76) | WIRED |
| `ItemDetailPanel` | `AcceptanceCriteriaList` | no prop → default `true`, panel unchanged (:292) | WIRED |
| `ReviewSurface` | `CriteriaRail` | import :24, render :439 | WIRED |
| `request_body.rs` `content_hash` | preview DTO and confirm command | same function, both callers | WIRED |
| `EpicRequestSheet` `draft.contentHash` | `forge_open_epic_request` | `adapter.forgeOpenEpicRequest` | WIRED |
| `BINDINGS` `m`/`r` | `ReviewSurface` / `EpicRequestBar` handlers | `useRegionBindings("review-surface", ...)` | WIRED |
| `allActionIds()` | palette | `continue` in `CommandPalette` switch | WIRED (deliberately excluded) |

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| `EpicRequestSheet` title and body | `preview.data.draft` | `forge_epic_request_draft` — board reads plus git ancestry per task | Yes | FLOWING |
| Published title and body | `draft` in the confirm command | re-assembled from DB under the lock, then hashed and compared | Yes | FLOWING |
| `CriteriaRail` criteria rows | `criteriaQuery.data` | `criterion_list` command | Yes, but EMPTY on every reviewable item | ⚠️ FLOWING-BUT-EMPTY — the data vacuum behind criterion 2 (D-REV-04). Not a hollow prop: the query is real and the empty result is the truthful answer for this board. |

## Behavioral Spot-Checks (run by me this session)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full desktop suite | `npm --prefix packages/desktop test` | 51 files, 770 tests pass | ✓ PASS |
| G-08-R2-1 fail-first (fix reverted) | `npm --prefix packages/desktop test -- src/review/__tests__/keyboard-activation.test.tsx` with `autoOpenWhenEmpty={false}` removed | **2 failed, 8 passed** — both regression tests red | ✓ PASS (fail-first confirmed) |
| Item-panel zero-item autofocus preserved | `npm --prefix packages/desktop test -- src/item-detail/__tests__/criteria.test.tsx` | 12 pass | ✓ PASS |
| Core merge, draft, anchors, forge chain | `cargo test -p core --test review_merge --test epic_request_draft --test criterion_anchors --test forge_live_chain` | 37 + 22 + 19 + 37 = 115 pass, 0 failed, 0 ignored | ✓ PASS |
| Typecheck | `packages/desktop/node_modules/.bin/tsc --noEmit -p packages/desktop` | 3 `error TS2345`, all pre-existing | ⚠️ see Advisory |
| THRE-43 merge really landed | `git merge-base --is-ancestor` + `git rev-list --count` + `git log` on the epic branch | ancestor YES, ahead 0, `ae6423c` is a two-parent merge commit | ✓ PASS |
| No live conflict reachable | `git merge-tree --write-tree <epic> <task>` × 5 | clean 5/5, ahead 0 on all five | ✓ PASS (confirms unreachability) |
| Criteria data vacuum | `sqlite3` over `acceptance_criteria`, `worktrees`, `epics` | 4 rows; 0 on all five worktree tasks | ✓ PASS (confirms vacuum, corrects the count) |
| Screenshot postdates CSS | `find ... -newer packages/desktop/src/review/review.css` | path returned | ✓ PASS |

The full workspace suite was run once, not per must-have. Named-test runs were used for the fail-first check and the panel-regression check.

## Probe Execution

SKIPPED: no probes declared by any Phase 08 plan (`find scripts -path '*/tests/probe-*.sh'` is empty; no plan or summary names one).

## Test Quality Audit

| Test file | Linked req | Active | Skipped | Circular | Assertion level | Verdict |
|---|---|---|---|---|---|---|
| `review/__tests__/keyboard-activation.test.tsx` | REVW-03/04/05 | 10 | 0 | No | Behavioral (dispatches a key, asserts a dialog appears) | SOUND — and proven non-vacuous by reverting the fix |
| `item-detail/__tests__/criteria.test.tsx` | REVW-03 | 12 | 0 | No | Behavioral | SOUND |
| `core/tests/review_merge.rs` | REVW-04 | 37 | 0 | No | Behavioral against real git repos | SOUND |
| `core/tests/epic_request_draft.rs` | REVW-05 | 22 | 0 | No | Value (hash stability and movement) | SOUND |
| `core/tests/criterion_anchors.rs` | REVW-03 | 19 | 0 | No | Value | SOUND |
| `core/tests/forge_live_chain.rs` | REVW-05 | 37 | 0 | No | Behavioral against a gh/glab stub | SOUND |
| `core/tests/forge_live_github.rs` | REVW-05 | 1 | 1 (`#[ignore]`, :87) | No | Behavioral against the live API | SOUND — and it was RUN last round by name with `-- --ignored`, so the requirement is no longer carried by a never-executed test |

**Disabled tests on requirements:** 1 (`forge_live_github.rs`), but no longer the sole evidence for its requirement and no longer unexecuted. Not a blocker.
**Circular patterns detected:** 0. No test fixture in the phase's test set is generated by the system under test.
**Insufficient assertions:** 0 on the phase's own requirements. The one ordering invariant with no test at all is truth 8 (WR-04), reported there rather than here.

## Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
|---|---|---|---|---|
| REVW-01 | 08-01, 08-02, 08-13 | Task diff in-app with syntax highlighting | SATISFIED | Truths 1, 6 |
| REVW-02 | 08-01, 08-09 | Accumulated diff of the epic integration branch | SATISFIED | Truth 1 |
| REVW-03 | 08-02, 08-06, 08-09, 08-15 | Check off criteria against the diff | SATISFIED IN CODE, NOT DEMONSTRABLE ON THIS BOARD | Truth 2 — tests green, data absent (D-REV-04) |
| REVW-04 | 08-03, 08-07, 08-10, 08-11, 08-12, 08-15 | Merge in-app, conflicts surfaced | SATISFIED | Truth 3 — merge live-proven, conflict test-proven |
| REVW-05 | 08-05, 08-08, 08-14, 08-15 | Open a PR/MR for an epic in one action | SATISFIED | Truths 4, 7, 8, 9 — live forge proven |

All five IDs appear in at least one plan's `requirements:` frontmatter. `REQUIREMENTS.md` lines 129-133 read `[x]` and lines 306-310 read `Complete`. No orphans: no ID maps to Phase 8 without a claiming plan.

## Advisory (New Scope, Unevidenced)

| # | Finding | Category | Why Advisory |
|---|---------|----------|--------------|
| 1 | 3 × `error TS2345` (`toHaveTextContent(/regex/)`) from `tsc --noEmit -p packages/desktop` | other | Evidenced and reproducible, but **pre-existing and Warning severity, not Blocker** — no roadmap criterion depends on it, the build passes, 770/770 tests pass. `git log -L` puts the forge-section region at `1c3ab1c` (Phase 07-08); `settings-surface.test.tsx` was never touched by Phase 08. Cause is a jest-dom matcher-types resolution defect, not a wrong assertion. It does violate 08-08-PLAN.md's literal `tsc --noEmit` acceptance criterion, recorded here rather than dropped. |

## Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` in any file changed by this round. No skipped or `todo` tests under `src/review/__tests__/`. No stub, empty handler or hardcoded-empty render in the touched files.

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `MergeConfirmSheet.tsx:176-183` | `focusedRef` guards focus to fire once on the confirm button, so the conflict result's three exits are never focused (WR-05) | ⚠️ Warning | Conflict exits and Close are mouse-only if WKWebView keeps buttons out of the Tab order. Escape still closes. D-REV-02 — now one assertion away from a test. |
| `ReviewSurface.tsx:240-256` | `"open-merge"` handler registered unconditionally, so `m` is `preventDefault`ed even when not offered (WR-01) | ⚠️ Warning | No user-visible effect today — a bare `m` has no browser default on a non-editable target, and `resolveBinding` already skips bare keys in text fields. The 08-15 SUMMARY's claim that the binding "cannot swallow a keystroke" is the part that is false. |
| `request_body.rs` / sheet header | `head_branch` and `target_branch` are outside the digest, yet the footer says "exactly this text" (WR-03) | ⚠️ Warning | Target-branch drift between preview and confirm is not refused. The must-have as worded (the *text* published) holds. |
| `forge.rs:204-231` | task-path `forge_open_request` has no hash guard; its doc comment still claims "by construction" (WR-06) | ⚠️ Warning | Predates this round; tracked in `deferred-items.md`. Outside the four roadmap criteria. |
| `EpicRequestSheet.tsx:249-265` | a refusal whose refetched hash is identical shows no notice, and the notice never clears (WR-02) | ⚠️ Warning | The click appears to do nothing. Rare. |
| `forge.rs:403` | renderer-supplied string logged unvalidated (IN-01); `keyMatches` ignores ctrl/alt (IN-02) | ℹ️ Info | Log injection; Ctrl+R/M on non-macOS. |

None of these falsifies a roadmap criterion or a plan truth. WR-04 is carried as truth 8 rather than listed here.

## Human Verification

**DEFERRED — not performed, and not claimed as performed.**

By owner decision on 2026-10-07 (`.claude/CLAUDE.md` § "Human verification is deferred until MVP"), human verification is suspended until Phase 11. No `human_needed` status was set, no UAT round was opened, and `08-UAT.md` was not modified. Every item that would have been asked is queued in `.planning/DEFERRED-REVIEW.md`.

Items routed there from this phase: **D-REV-02, D-REV-03, D-REV-04** (carried, with D-REV-02's and D-REV-04's notes corrected additively) and **D-REV-05, D-REV-06, D-REV-07, D-REV-08** (newly harvested from `<verify><human-check>` blocks in 08-01, 08-08, 08-09 and 08-13).

**On honesty of `automatable`.** Of the four newly harvested items, **one is fully automatable** (D-REV-06 — a single gutter click before an existing measurement loop), **one is partly automatable** (D-REV-07 — scroll preservation is testable; "the rail stays usable" is not), and **two are genuine human items** (D-REV-05 and D-REV-08) because their stated reason is human aesthetic judgment, which is a physical reason. Two of the four also carry a defect in the *question*, not the answer:

- 08-01's check asks for "both the light and the dark theme". **The app ships exactly one palette** — no `prefers-color-scheme` or `[data-theme` appears in any shipped stylesheet. Half that check is void and should not be asked of a human at Phase 11.
- 08-09's check needs an epic with three or more tasks carrying criteria. **No such epic exists**, so it is blocked on D-REV-04's data vacuum and is not answerable by a human either until the board has data.

## Gaps Summary

No gaps. No blocker. The phase closes on its roadmap success criteria plus its automated verification, with criterion 2 not demonstrable and criterion 3 partial, both stated plainly rather than rounded up.

Highest-value follow-ups, in order, and all of them tests rather than questions:

1. **D-REV-03 / WR-04** — a stub-forge test asserting the `gh` stub was never invoked on a hash mismatch. This is the one action in the phase that leaves the machine, and its ordering is held only by reading.
2. **D-REV-02 / WR-05** — one assertion on `document.activeElement` after the conflict result renders. The fixture and the render path both already exist.
3. **D-REV-04** — seed real acceptance criteria on the five tasks that have worktrees. This is the phase's own core-value criterion and the project's Core Value line; it is a seed task, not a code task.
4. **D-REV-06** — one `fireEvent.click` on the gutter before the existing `legibility.browser.test.tsx` measurement loop.
5. **WR-01** — register the `open-merge` entry only when `mergeOffered && !sheetOpen`, plus a cancelable-event test, and correct the 08-15 SUMMARY's overstated wording.

---

_Verified: 2026-10-07T16:15:00Z_
_Verifier: Claude (gsd-verifier)_
