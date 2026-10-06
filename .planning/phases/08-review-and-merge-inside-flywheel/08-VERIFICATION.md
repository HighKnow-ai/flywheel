---
phase: 08-review-and-merge-inside-flywheel
verified: 2026-10-06T12:30:00Z
status: gaps_found
score: 4/5 must-haves verified
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
  - "packages/core/src/context_packet.rs"
  - "packages/core/src/db/migrations/0018_criterion_anchors.sql"
  - "packages/core/src/domain/acceptance_criterion.rs"
  - "packages/core/src/forge/mod.rs"
  - "packages/core/src/forge/request_body.rs"
  - "packages/core/src/git.rs"
  - "packages/core/src/merge.rs"
  - "packages/core/src/review.rs"
  - "packages/desktop/src-tauri/src/commands/forge.rs"
  - "packages/desktop/src-tauri/src/commands/review.rs"
  - "packages/desktop/src/review/CriteriaRail.tsx"
  - "packages/desktop/src/review/EpicRequestSheet.tsx"
  - "packages/desktop/src/review/FileDiff.tsx"
  - "packages/desktop/src/review/MergeConfirmSheet.tsx"
  - "packages/desktop/src/review/ReviewSurface.tsx"
  - "packages/desktop/src/state/keyboard.ts"
covered_digest: "v1:sha256:9f4410a2149583b9eb8ad5d0e6298176a9cb24cd03b1750ec4fcf890503e6150"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Epic scope renders the epic's own criteria plus a roll-up of its tasks (08-08 plan truth, D-132)"
    status: failed
    reason: "Epic scope shows only the epic's own criteria. No core query, command or rail section lists an epic's tasks with criteria. 08-08 built none of it and said so (SUMMARY Deviation 1, WINDOWS.md #28). Not a ROADMAP success criterion; does not block the phase goal."
    artifacts:
      - path: "packages/desktop/src/review/ReviewSurface.tsx"
        issue: "Epic scope mounts CriteriaRail for the epic id only; no per-task rollup section"
      - path: "packages/desktop/src-tauri/src/commands/review.rs"
        issue: "review_criteria_state returns one item's criteria; no epic-children variant"
    missing:
      - "A read-only core query listing an epic's tasks with checked/total criteria counts and evidence/no-evidence counts"
      - "A command for it (registered in main.rs and the capability roster) plus an adapter wrapper"
      - "A rail section rendered only in epic scope, with a test"
      - "OR an explicit override accepting epic scope as 'own criteria only' (see Override Suggestion)"
  - truth: "A keyboard user can activate the Merge confirm, 'Open request' and the other buttons on the review surface (CR-03; project keyboard-first convention)"
    status: partial
    reason: "useRegionBindings calls preventDefault on Enter and Space for any non-text target when the review-surface region binds them to expand-file. Reproduced in a scratch vitest: a focused <button> receives defaultPrevented=true for both Enter and ' '. In a real WebView that cancels the button's activation. The surface's layer is static, so an open sheet does not change this. Pointer users are unaffected, so the roadmap goal is reachable; keyboard-only users cannot confirm a merge or open a request, and there is no dedicated keystroke for either."
    artifacts:
      - path: "packages/desktop/src/state/keyboard.ts"
        issue: "useRegionBindings (line ~745-759) preventDefaults before the handler decides; isTypingTarget excludes only INPUT/TEXTAREA/contenteditable"
      - path: "packages/desktop/src/review/ReviewSurface.tsx"
        issue: "expand-file handler (line ~237-250) guards on !sheetOpen only after preventDefault already ran"
    missing:
      - "Skip Enter/Space bindings when event.target is inside button/a/[role=button]"
      - "A test pressing Enter on the Merge sheet's confirm and the Epic sheet's 'Open request' button, asserting the click fires"
      - "Escape handler should honour event.defaultPrevented (WR-06)"
deferred: []
human_verification:
  - test: "Read a multi-language task diff in light AND dark themes at review width"
    expected: "Added/removed tints do not fight token colour; text stays legible (VALIDATION manual row 1)"
    why_human: "Visual judgement; jsdom cannot assert colour or contrast"
  - test: "Review a real multi-file task: check each criterion against selected lines without losing scroll position, then toggle to whole-epic scope"
    expected: "The criteria rail stays usable over a long diff; scroll position survives each check (VALIDATION manual row 2)"
    why_human: "Ergonomic judgement about the pacing of a real review"
  - test: "Open the merge confirm sheet, then a conflicting merge, in the packaged/dev app"
    expected: "The sheet's look and wording read clearly; the conflict names each file and offers 'start a session' and 'open worktree'; the board shows the integrated marker after a clean merge"
    why_human: "Visual and interaction judgement; the Tauri command path was never driven end to end (08-07 SUMMARY)"
  - test: "Open an epic request against a real authenticated GitHub/GitLab repo, twice in a row"
    expected: "First call pushes and opens one request; second surfaces the existing request read-only rather than creating a duplicate"
    why_human: "Plan truth is tagged backstop; only a fake gh/glab was exercised (WINDOWS.md #27 is the same unrun live arm)"
  - test: "Open the epic request sheet, change state in another window (check a criterion or merge a task), then confirm"
    expected: "Per WR-09 the published body can differ from the previewed one today; decide whether a content-hash guard is required before this ships"
    why_human: "Judgment-tier prohibition (see Prohibitions below); product-risk decision"
  - test: "Keyboard-only pass through review: j/k files, Enter to expand, c to check, Tab to Merge, Enter to confirm"
    expected: "Re-run after the CR-03 fix; every step completes without the mouse (line selection itself is gutter-click only)"
    why_human: "Real WebView button-activation semantics cannot be proven in jsdom"
---

# Phase 8: Review And Merge Inside Flywheel Verification Report

**Phase Goal:** Cyril reviews an agent's work against the acceptance criteria that were agreed before it started, and lands it, without dropping back to a terminal.
**Verified:** 2026-10-06
**Status:** gaps_found
**Re-verification:** No, initial verification
**Mode:** mvp. Note: the ROADMAP goal is not in "As a ..., I want to ..., so that ..." form (`user-story.validate` returned false), the same as every other phase on this roadmap. Verification proceeded goal-backward against the goal's three clauses instead of refusing; see the User Flow Coverage table.

## Headline ruling

**The phase goal is achieved for a pointer user, and all 4 ROADMAP success criteria and all 5 requirement IDs are met in the code.** Two gaps remain. Neither stops the loop (review against criteria, then merge, then propose the epic) from working by mouse. One is a plan truth that was knowingly not built (D-132 roll-up). The other is a keyboard-activation defect (CR-03) that makes the loop impossible keyboard-only. Both are small, local fixes. The phase should not be closed as `passed`.

## User Flow Coverage (MVP mode)

| Goal clause | Expected | Evidence | Status |
|---|---|---|---|
| "reviews an agent's work" | Diff on screen, syntax-highlighted, task and epic scope | `ReviewSurface` mounted lazily in `App.tsx:287-296`; three entry doors (board key, palette, finished-run offer) all call `setReviewSurface`; `review_files`/`review_file_patch` real git reads; `review_diff` 18 tests pass | VERIFIED |
| "against the acceptance criteria that were agreed before it started" | Criteria beside the diff, checkable against lines, evidence kept | `CriteriaRail` mounted in surface; `criterion_check_with_anchor` registered and wired; migration 0018; `criterion_anchors` 20 tests pass | VERIFIED |
| "and lands it" | In-app merge to integration branch; epic request to forge | `review_merge_precheck`/`review_merge_task`, `forge_epic_request_draft`/`forge_open_epic_request` registered x1 in `main.rs`, capability roster, and adapter; `review_merge` 37, `epic_request_draft` 17, `forge_live_chain` 19 tests pass | VERIFIED (pointer); keyboard path BROKEN (CR-03) |
| "without dropping back to a terminal" | No shell-out needed for diff, merge, conflict, PR | Only construction site `Command::new("git")` is `git.rs:44`; conflict has two in-app exits (agent session, open worktree) | VERIFIED |

## Goal Achievement

### Observable Truths: ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|---|---|---|
| SC1 | User reads a task's full diff with syntax highlighting in-app, and the accumulated diff of its epic's integration branch | VERIFIED | `FileDiff.tsx` + `highlight.ts` (refractor adapter) rendered by `ReviewSurface`; `resolve_review_target`/`files_for_target` serve both scopes server-side; scope toggle in header (08-08). `review_diff.rs` 18/18 pass incl. rename, binary, NULL-branch cases. desktop `src/review` suites 157/157 pass. Epic accumulated diff verified; the epic *criteria roll-up* is separate (see Gaps) |
| SC2 | User checks off each of the task's criteria against the diff while reviewing | VERIFIED | `CriteriaRail` composes the existing criteria row; select-lines-then-check writes an anchor via `criterion_check_with_anchor`; sha resolved in core; uncheck clears anchor in same transaction; staleness derived from git, never stored. `criterion_anchors.rs` 20/20 pass. Note: line selection is gutter-click only; check without evidence also works by keyboard |
| SC3 | User merges a task branch into its epic integration branch in-app; conflicts surfaced clearly, never silent or half-merged | VERIFIED (pointer) | `merge.rs`: dry-run `merge_tree_check`, per-epic worktree, `merge_abort_if_in_progress` re-proves clean tree, one event, no status write (zero `UPDATE tasks/epics` in merge/review/forge commands, grep). `MergeConfirmSheet` shows three outcomes. `review_merge.rs` 37/37 pass, incl. conflict, recovery, ordering lock. Keyboard confirm blocked by CR-03 |
| SC4 | User opens a PR/MR for a finished epic's integration branch in one action | VERIFIED (pointer) | `forge_open_epic_request` re-checks four preconditions before any push, takes epic id only, `drop(conn)` before push, plain push (no `--force`/`--delete` anywhere in `git.rs`), partial outcome reported as its own state. Tests pass against fake gh/glab only (see Human Verification) |

### Observable Truths: Plan-Added Must-Haves (sampled where not subsumed by SC1-4)

| # | Truth | Status | Evidence |
|---|---|---|---|
| P1 | Epic scope renders the epic's own criteria plus a roll-up of its tasks (08-08, D-132) | FAILED (BLOCKER for plan, not for phase goal) | Not built. `review_criteria_state` returns one item's criteria; no command lists an epic's tasks with criteria. Confirmed in 08-08 SUMMARY Deviation 1 and `WINDOWS.md` #28. Not deferred: no later phase (9, 10, 10.1, 11) names it |
| P2 | Git never runs under the SQLite lock (headers of `merge.rs`, `forge/mod.rs`; 08-03, 08-07 truths) | PARTIAL, see CR-01 ruling | The destructive half holds: `run_merge` and the push run with the lock dropped (`review.rs:392`, `forge.rs` `drop(conn)`). The planning half does not: `plan_merge` runs `rev-list` and `review_files` on a connection and is called under `state.db.lock()` in both merge commands. Read-only, so correctness is intact; it is a responsiveness hazard |
| P3 | No half-merged state, no verified-less outcome (08-03 prohibition) | VERIFIED | `merge_abort_if_in_progress` proves clean via porcelain; `review_merge` conflict and recovery tests pass |
| P4 | Merge/review/epic request never write a status column (08-03, 08-07, 08-08) | VERIFIED | grep: zero `UPDATE (tasks|epics)` in `merge.rs`, `review.rs`, `request_body.rs`, both command files; no status setter in `review/*.tsx` |
| P5 | Push never rewrites or deletes remote history (08-05 prohibition) | VERIFIED | grep: no `--force`, `force-with-lease`, `--delete` in `git.rs`; no force retry path |
| P6 | Renderer cannot supply title, body, branch, target or sha (D-118, D-139) | VERIFIED | Command signatures take ids/ranges only; sha is `rev-parse`d core-side |
| P7 | Published epic request text equals previewed text "by construction" (08-08 prohibition) | PARTIAL, see WR-09 | Same assemble function used for both, but the confirm path re-assembles from live state, so the text can differ if the board or git moves between preview and confirm. Judgment-tier prohibition; flagged below |

**Score:** 4/5 must-haves verified (4 roadmap SCs; plan truth P1 FAILED). 0 behavior-unverified: every behavior-dependent truth (merge abort, serialization, anchor clearing, staleness) has a passing named test.

### Rulings on the Five Questions Put to the Verifier

**1. D-132 roll-up (WINDOWS #28).** Does not block SC1, SC2 or the phase goal. SC1 asks for the epic's accumulated diff, which exists. SC2 asks for "the task's" criteria, which exist in task scope. The roll-up is a plan-level extra that 08-06 never provided, and 08-08 correctly refused to improvise a new query under a plan that did not own those files. It is still a failed plan must-have, so by the decision tree the status is `gaps_found`. Options: (a) close it with one small gap plan (core read + command + rail section, ~1 plan), or (b) accept epic scope as "own criteria only" with an override. The honest cost of (b) is that the epic toggle shows less than D-132 promised. Recommendation: (a) unless the roll-up is judged not worth it; do not leave the WINDOWS row open past ship (`windows_enforce` blocks `/gsd-ship` while open).

**2. CR-01 (git under lock).** Confirmed in code, but narrower than the review's framing. `run_merge`, the push and the merge event record all follow the plan/run/record split correctly; the long, destructive git work never holds the lock. What does hold it: `plan_merge` (`rev-list` plus two `git diff` runs), `epic_request_preconditions`, `assemble_epic_request_draft` (up to 3 spawns per task), and `resolve_review_target`'s `is_integrated` ancestry checks. All are read-only and bounded by a 120 s per-spawn timeout, so this is a board-freeze risk on a slow repo, not a data-integrity bug. The `merge.rs` header (lines 9-12) states something untrue and should be corrected. Classified WARNING; fix with the DB-half/git-half split the review proposes. It does not block the goal.

**3. CR-03 (Enter/Space swallowed).** Confirmed and reproduced (scratch vitest, since deleted: both `Enter` and `" "` keydown on a focused `<button>` come back `defaultPrevented === true`). Answer to "can a keyboard-only user complete the loop?": no. Merge confirm and Open request cannot be activated with Enter or Space, and no dedicated keystroke exists for them; line selection for evidence is also gutter-click only. The goal as written ("without dropping back to a terminal") is not keyboard-only, and the mouse path works, so this does not fail the goal. But Flywheel is keyboard-first (Phase 1 SC3), and the destructive confirmation having no working Enter path is a real regression, so it is carried as a partial gap rather than waved through.

**4. Traceability.** Final state is correct and complete. REQUIREMENTS.md marks REVW-01..05 `[x]` and "Complete" (lines 129-133, 306-310). Plan frontmatter covers every ID: REVW-01 (08-01, 08-04), REVW-02 (08-01, 08-04, 08-08), REVW-03 (08-02, 08-06), REVW-04 (08-03, 08-07), REVW-05 (08-05, 08-08). All eight SUMMARYs carry `requirements-completed` matching their plans. No orphaned IDs. REVW-04 is marked complete, not unmarked. Caveat: REVW-02's text ("review the accumulated diff of an epic's integration branch") is met; the unmet D-132 roll-up is plan-level, not the requirement's wording, so "Complete" stands. The ROADMAP line 66 checkbox for Phase 8 is still `[ ]`; that is the orchestrator's close-out, not a defect.

**5. Deferred visual/feel checks.** Collected under `human_verification` above, not passed or failed.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/git.rs` | Raw-output wrapper, review reads, merge primitives, push | VERIFIED | Single `Command::new("git")` at line 44; no force flags |
| `packages/core/src/review.rs` | Scope resolution, staleness, criteria state | VERIFIED | 18 + 20 tests pass |
| `packages/core/src/merge.rs` | plan/run/record, epic guard, integrated marker | VERIFIED (header inaccurate, CR-01) | 37 tests pass |
| `packages/core/src/db/migrations/0018_criterion_anchors.sql` | Anchor table with CHECKs and cascade | VERIFIED | PK = criterion_id, `ON DELETE CASCADE`, side and range CHECKs, no stale column |
| `packages/core/src/forge/{mod,request_body}.rs` | Epic draft, preconditions, push-then-create | VERIFIED | 17 + 19 tests pass |
| `packages/desktop/src-tauri/src/commands/{review,forge}.rs` | Nine commands | VERIFIED | Each registered x1 in `main.rs`, capability roster, `tauri.ts` adapter |
| `packages/desktop/src/review/*` | Surface, FileDiff, CriteriaRail, MergeConfirmSheet, EpicRequestSheet | VERIFIED (wired) | All imported and rendered in `ReviewSurface`; 157 desktop tests pass |
| Epic task roll-up (rail section + query) | per 08-08 plan | MISSING | See gap P1 |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `ItemDetailPanel`/`BoardView`/`CommandPalette`/`SessionSurface` | `uiStore.reviewSurface` | `setReviewSurface` (4 call sites) | WIRED |
| `App.tsx` | `ReviewSurface` | lazy import, `reviewSurface` store field | WIRED |
| `CriteriaRail` | `criterion_check_with_anchor` | adapter `criterionCheckWithAnchor` | WIRED (error not surfaced, WR-08) |
| `MergeConfirmSheet` | `review_merge_task` | task id alone | WIRED |
| `EpicRequestSheet` | `forge_open_epic_request` | epic id alone | WIRED |
| `commands/forge.rs` | `open_epic_request_at` | lock dropped once before push | WIRED |
| `review.rs` | `merge::integrated_merge_commit` | post-merge diff base | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| `ReviewSurface` file list | `files` | `git diff --name-status` via `review_files` | Yes | FLOWING |
| `FileDiff` | patch | `review_file_patch` (git, lazy per file) | Yes | FLOWING |
| `CriteriaRail` | criteria + anchors + staleness | SQLite + `rev-list` per read | Yes | FLOWING |
| `MergeConfirmSheet` preview | counts, conflicts | `plan_merge` + `merge_tree_check` | Yes | FLOWING |
| `EpicRequestSheet` draft | title/body | `assemble_epic_request_draft` over board + git | Yes | FLOWING |
| Epic-scope task roll-up | none | no source exists | n/a | DISCONNECTED (gap P1) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Core review/merge/anchor/epic-request suites | `cargo test -p core --test review_diff --test review_merge --test criterion_anchors --test epic_request_draft --test forge_live_chain` | 18 + 37 + 20 + 17 + 19 passed, 0 failed | PASS |
| Desktop review, doors, session suites | `vitest run src/review src/board/__tests__/review-doors.test.tsx src/session/__tests__/session-surface.test.tsx` | 7 files, 157 tests passed | PASS |
| Button activation survives review-surface bindings | scratch vitest on `useRegionBindings` (deleted after) | Enter and Space: `defaultPrevented = true` on a focused button | FAIL (confirms CR-03) |

Wave-gate evidence supplied by the orchestrator (workspace `cargo test`, 754 desktop tests, 223 sidecar tests) was not re-run.

### Probe Execution

No probes declared by any plan and none required for this phase. SKIPPED.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| REVW-01 | 08-01, 08-04 | Review a task's full diff in-app with syntax highlighting | SATISFIED | SC1 evidence |
| REVW-02 | 08-01, 08-04, 08-08 | Review the accumulated diff of an epic's integration branch | SATISFIED | Epic scope + toggle; roll-up is a plan extra |
| REVW-03 | 08-02, 08-06 | Check off acceptance criteria against the diff | SATISFIED | SC2 evidence |
| REVW-04 | 08-03, 08-07 | Merge task branch into epic integration branch, conflicts surfaced | SATISFIED | SC3 evidence; keyboard confirm blocked (CR-03) |
| REVW-05 | 08-05, 08-08 | Open PR/MR for an epic integration branch in one action | SATISFIED | SC4 evidence; live forge unexercised |

No orphaned requirements.

### Prohibitions (judgment-tier, all NON-AUTHORITATIVE, human review recommended)

| Plan | Prohibition | Verdict | Flag |
|---|---|---|---|
| 08-01 | Diff must not silently truncate/omit | Per-file chunking exposes a visible "show more" control (`FileDiff.tsx:180`); no silent drop found | unverified-prohibition: confirm in the visual pass |
| 08-02 | Stale evidence never presented as current; staleness never unchecks | Staleness derived at read; no write path from staleness. Caveat WR-03: anchor sha is head at click time, so evidence can bind to code the reader did not see | unverified-prohibition: WR-03 weakens it |
| 08-03 | No half-merged state; no unverified outcome | Held (tests + porcelain proof) | judged OK |
| 08-03 | Never move status | Held (grep) | judged OK |
| 08-05 | No force push | Held (grep) | judged OK |
| 08-06 | Evidence never attributed to unselected range; selection alone writes nothing | Check is the only write path (`c` key / button); selection is local state | judged OK |
| 08-07 | No unverified outcome reported | Held for conflict/merged; WR-11 leaves "merged in git, event not recorded" with no repair path | unverified-prohibition: WR-11 |
| 08-08 | Never publish text the reader did not see | Partially violated under concurrent change (WR-09) | unverified-prohibition: human decision requested |

No test-tier prohibitions declared.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/desktop/src/state/keyboard.ts` | ~745-759 | preventDefault before handler gate (CR-03) | BLOCKER for keyboard path | Buttons cannot be keyboard-activated on review surface |
| `packages/core/src/merge.rs` | 9-12 | Header claims git never under a connection; `plan_merge` spawns git | WARNING | Misleading invariant; board freeze risk (CR-01) |
| `packages/desktop/src-tauri/src/commands/{review,forge}.rs` | 52 `e.to_string()` sites | Raw git stderr and absolute paths reach renderer (CR-02) | WARNING | Violates the stated T-07-08/T-08-08 rule that only a category crosses IPC |
| `packages/core/src/git.rs` | 525 | Parses English "Already up to date" | WARNING | Locale-dependent; mostly shadowed by `NothingToMerge` precheck (WR-01) |
| `packages/core/src/domain/acceptance_criterion.rs` | ~680-693 | Anchor path unvalidated, reaches agent prompt and public PR body | WARNING | Prompt/PR-body injection via crafted filename (WR-02) |
| `CriteriaRail.tsx` | 27-38 | No `onError` on the check mutation | WARNING | Failed evidence write is silent (WR-08) |
| `ReviewSurface.tsx` | 252-259 | Escape cascades past sheets and inputs | WARNING | WR-06 |
| `forge/mod.rs` | 357-359 | Every push failure labelled "rejected" | WARNING | WR-05 |
| (phase files) | n/a | TBD/FIXME/XXX | none found | Debt-marker gate clear |

Remaining review items (WR-04, WR-07, WR-09, WR-10, WR-11, IN-01..05) are accepted as WARNING/info and carried forward; none alters a ROADMAP success criterion.

### Human Verification Required

See the `human_verification` block in the frontmatter (six items): both-theme diff legibility, rail ergonomics over a long diff, merge sheet and conflict look in the real app, live double-open of an epic request on a real forge, the WR-09 preview-versus-publish decision, and a keyboard-only pass after the CR-03 fix.

### Override Suggestion (D-132 only, if the roll-up is intentionally dropped)

```yaml
overrides:
  - must_have: "Epic scope renders the epic's own criteria plus a roll-up of its tasks"
    reason: "Epic scope shows the epic's own criteria and the accumulated diff; the per-task roll-up is not required by REVW-02 or any ROADMAP success criterion"
    accepted_by: "{name}"
    accepted_at: "{ISO timestamp}"
```

I did not write this override: acceptance is Cyril's call, not the verifier's.

### Gaps Summary

Two gaps, one root-cause group each. (1) D-132's epic roll-up was knowingly not built because 08-06's rail never exposed a per-task data source; closing it is a read-only query + command + rail section, or an explicit override. (2) `useRegionBindings` swallows Enter/Space on any focused button, so the merge confirm and "Open request" are keyboard-dead; one guard in the shared hook plus two tests fixes it, and also fixes WR-06 if Escape honours `defaultPrevented`. Both belong in one small gap-closure plan (`/gsd-plan-phase 8 --gaps`). CR-01 and CR-02 should ride the same plan since they touch the same command files; they are not goal blockers. After that, run the six human checks, then Phase 8 can close.

---

_Verified: 2026-10-06T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
