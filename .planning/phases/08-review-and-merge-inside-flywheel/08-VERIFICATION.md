---
phase: 08-review-and-merge-inside-flywheel
verified: 2026-10-07T15:10:00Z
status: human_needed
score: 7/8 must-haves verified
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
  - "packages/core/src/forge/mod.rs"
  - "packages/core/src/forge/request_body.rs"
  - "packages/core/src/git.rs"
  - "packages/core/src/merge.rs"
  - "packages/core/src/review.rs"
  - "packages/core/tests/criterion_anchors.rs"
  - "packages/core/tests/epic_request_draft.rs"
  - "packages/desktop/src-tauri/capabilities/default.json"
  - "packages/desktop/src-tauri/src/commands/forge.rs"
  - "packages/desktop/src-tauri/src/commands/mod.rs"
  - "packages/desktop/src-tauri/src/commands/review.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/board/CommandPalette.tsx"
  - "packages/desktop/src/board/__tests__/layer-guard.test.tsx"
  - "packages/desktop/src/review/CriteriaRail.tsx"
  - "packages/desktop/src/review/EpicRequestSheet.tsx"
  - "packages/desktop/src/review/MergeConfirmSheet.tsx"
  - "packages/desktop/src/review/ReviewSurface.tsx"
  - "packages/desktop/src/review/__tests__/browser/keyboard.browser.test.tsx"
  - "packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx"
  - "packages/desktop/src/review/__tests__/criteria-rail.test.tsx"
  - "packages/desktop/src/review/__tests__/epic-request.test.tsx"
  - "packages/desktop/src/review/__tests__/keyboard-activation.test.tsx"
  - "packages/desktop/src/review/__tests__/merge-sheet.test.tsx"
  - "packages/desktop/src/review/__tests__/review-surface.test.tsx"
  - "packages/desktop/src/review/review.css"
  - "packages/desktop/src/review/useReviewQuery.ts"
  - "packages/desktop/src/state/keyboard.ts"
covered_digest: "v1:sha256:4bbb813d7092bd89a3603239e596e67c30c81f848ab2db1829cbe11466cd0e05"
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 6/6
  gaps_closed:
    - "G-08-1 diff tint legibility, closed by 08-13"
    - "G-08-5 stale epic request preview, closed by 08-14 (guard present and wired; refusal-before-push has no test below the renderer mock)"
    - "G-08-6 no keyboard route to Merge / Open request on WebKit, closed by 08-15 (proven in Playwright WebKit only)"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
behavior_unverified_items:
  - truth: "A confirm whose draft changed is refused with draftChanged BEFORE anything is pushed or any forge call is made"
    test: "Preview an epic request, check a criterion on the board from elsewhere, then confirm; observe that no `git push` and no `gh pr create` ran and the sheet shows the new text"
    expected: "Rejection is the bare string draftChanged; remote has no new branch or PR; sheet re-renders the current text"
    why_human: "The comparison lives inside a #[tauri::command] taking State and AppHandle, so no Rust test reaches it; the renderer tests mock the rejection. The ordering is correct by reading (forge.rs lines 401-404 return before open_epic_request_at at 407), but a refactor that moved the check below the push would pass every current test (WR-04)."
human_verification:
  - test: "Run `npm --prefix packages/desktop run tauri dev`, open a task review, press m, press Enter; open an epic review, press r, press Enter"
    expected: "Each sheet opens with its confirm button focused and Enter confirms once, with no mouse and no Tab"
    why_human: "G-08-6's route is measured in Playwright WebKit, not in the real macOS WKWebView under Tauri. No automation can drive that binary (no WebDriver for WKWebView on macOS)."
  - test: "Open an epic request against a real authenticated GitHub or GitLab repo twice in a row (UAT item 4): `FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat cargo test -p core --test forge_live_github -- --ignored --nocapture`"
    expected: "First call pushes and opens one request; second returns AlreadyOpen with the same request number"
    why_human: "Still BLOCKED, third-party: it opens a real PR on a real repository with the account owner's credentials, so it is #[ignore]d and has never been run. Everything else about REVW-05 is proven against a gh/glab stub that is the only substituted component (forge_live_chain.rs)."
  - test: "After a conflicting merge in the real app, try to reach 'Start a session to resolve', 'Open in editor' and Close with the keyboard"
    expected: "A keyboard route exists, or the team accepts mouse-only exits on macOS"
    why_human: "WR-05: MergeConfirmSheet focuses only the Merge button, once. After the result renders the button unmounts and focus falls to the scope container. If WKWebView does not Tab to buttons (the premise 08-15 is built on) these three are mouse-only; Escape still closes."
---

# Phase 8: Review And Merge Inside Flywheel Verification Report

**Phase Goal:** Cyril reviews an agent's work against the acceptance criteria that were agreed before it started, and lands it, without dropping back to a terminal.
**Verified:** 2026-10-07T15:10:00Z
**Status:** human_needed
**Re-verification:** Yes, after the third gap-closure round (08-13, 08-14, 08-15). The earlier `human_needed 6/6` report predated the UAT and is replaced.

## Verdict in one paragraph

The four roadmap success criteria hold in the code. G-08-1, G-08-5 and G-08-6 are each closed in the sense the UAT defined, with one residue per gap that only a human or a live service can clear. No finding is a blocker. The status is `human_needed` and not `passed` because three items cannot be settled by this tree's automation: the real-WKWebView keyboard route, the live-forge run (UAT item 4, still blocked), and the ordering invariant of the `draftChanged` guard, which no test reaches.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: task diff with syntax highlighting, and the epic's accumulated diff, are readable in-app | VERIFIED | Regression check only (unchanged this round). `ReviewSurface` renders both scopes; 122 jsdom tests under `src/review` and `layer-guard` pass; 23 WebKit tests pass (ran both myself); UAT item 2 passed. |
| 2 | SC2: each criterion can be checked against the diff during review | VERIFIED | `c` binding and gutter selection proven in WebKit (`keyboard.browser.test.tsx`, "checks the criterion the rail has focused"), scroll position preserved (UAT 2 pass). |
| 3 | SC3: a task branch merges into its epic integration branch in-app; conflicts are surfaced, never silent or half-merged | VERIFIED | `cargo test -p core --test review_merge`: 37 pass (ran it). Conflict sheet names both files and both exits, activated with Enter in WebKit (UAT 3 pass). |
| 4 | SC4: a PR/MR for a finished epic's integration branch opens in one action | VERIFIED (against a stub forge) | `open_epic_request_at` pushes then creates; nine `epic_request_*` tests in `forge_live_chain.rs` cover open, already-open, push rejected, partial outcome, absent and unauthenticated CLI, no forge. The real-forge arm has never run (human item 2). |
| 5 | G-08-1: every syntax-token role on added and removed rows clears 4.5:1, and exactly one palette ships | VERIFIED | See G-08-1 below. |
| 6 | G-08-5a: the published text is the text the sheet rendered; renderer cannot influence it; no git/CLI/path output crosses IPC | VERIFIED | See G-08-5 below. |
| 7 | G-08-5b: a confirm whose draft changed is refused with bare `draftChanged` before anything is pushed | PRESENT_BEHAVIOR_UNVERIFIED | Correct by reading; no test exercises the ordering (WR-04). |
| 8 | G-08-6: merge and epic-request confirmations are reachable and confirmable with no mouse | VERIFIED (WebKit) | See G-08-6 below. WKWebView itself is human item 1. |

**Score:** 7/8 truths verified (1 present, behavior-unverified).

## G-08-1: diff tint legibility (closed)

- `review.css` lines 20-27: row tint is `color-mix(... 12%, transparent)`; both `--diff-code-*-edit-background-color` are `transparent`. Lines 35-41 mark a word-level edit with `box-shadow: inset 0 -2px 0` in the signal hue, differing between insert and delete. The edit span therefore adds no paint behind glyphs.
- I recomputed the ratios independently from the token hexes (not from the executor's model). Over `#171b22` with the 12% row mix, the lowest role that ever paints code is 4.51:1 (destructive token on an insert row, a combination that does not occur on real rows); keyword is 5.22 / 5.51, punctuation 5.53 and above. Every role passes 4.5:1. The 22% gutter tints carry only `--text-primary-rack`.
- I ran the WebKit suite: `legibility.browser.test.tsx` measures painted contrast in the real engine for every role/row pair across five languages, plus a non-vacuous check that edit spans exist and paint no background of their own. Green.
- One palette: no `prefers-color-scheme` or `[data-theme` appears in any shipped stylesheet or source file (grep over `src/`; hits are only the legibility test that asserts their absence). `tokens.css` and `theme/tokens.ts` were not modified by this round.
- Residue, not a gap: a selected (gutter-clicked) row stacks a 14% blue selection over the row tint. Computed: keyword 4.65 and 4.87, all code-bearing roles above 4.5. Only a `.token.deleted` or `.token.inserted` span inside a selected row drops to 4.02 / 4.21, which means a diff-of-a-diff. The browser test does not select a row before measuring, so this state is unmeasured. Info only.

## G-08-5: what you previewed is what is published (closed, one caveat)

- `RequestDraft::content_hash` (core `request_body.rs`) is SHA-256 over title, `\n`, body. It is the single digest function. `RequestDraftDto::from` calls it on the preview path; `forge_open_epic_request` calls it on the re-assembled draft.
- `forge_open_epic_request(epic_id, content_hash)` accepts no title, body, branch or target. The `draft` it hashes is the same object passed to `open_epic_request_at`, so a matching hash can only permit publishing text the core itself assembled. The hash can cause a refusal, never a substitution.
- Mismatch returns the literal `"draftChanged"`; both digests go only to `eprintln!`. Every other error in the command goes through `ipc_error` (`failed:<context>`), `forge_error_code` (`<category>:<cli>`) or `blocked:<name>`. `PushRejected` detail and `PushedButNotOpened` detail are logged, not returned. A branch name crosses IPC in `PushedButNotOpened`, which is by design and not a path. No git output, CLI output or absolute path crosses IPC.
- The sheet sends `draft.contentHash` from the same `preview.data` it rendered, calls `forgeOpenEpicRequest(epicId, sentHash)`, and on `draftChanged` refetches instead of showing a failure. The adapter (`tauri.ts:1324`) is the only invoker.
- Tests: 22 in `epic_request_draft.rs` pass (hash stable on unchanged board, moves on criterion check and on title change, 64 lowercase hex). Renderer test at `epic-request.test.tsx:135` covers re-render and next confirm carrying the new hash.
- Caveat (WR-04, truth 7): the compare-and-refuse step has no test below the renderer mock. I read it: the hash check at forge.rs 401-404 returns before `open_epic_request_at`. Present and correct, not behaviorally proven.
- Caveat (WR-03, warning): the digest excludes `head_branch` and `target_branch`, yet the sheet header shows `head -> target` and the footer says "exactly this text". `target_branch` is read from `projects.default_branch` at confirm time. A change to it between preview and confirm is not refused. The branches are not published text, so the must-have as worded ("the text published") holds. The user-facing promise is slightly wider than the guard.
- Caveat (WR-06, warning, predates this round): the task-scope `forge_open_request` has no such guard and its doc comment still claims "by construction". The DTO now ships a `contentHash` for it that nothing checks. Logged in `deferred-items.md` as a named follow-up. It is outside this gap's scope and outside the four roadmap criteria.

## G-08-6: keyboard route to the confirmations (closed in WebKit)

- `keyboard.ts`: `open-merge` bound to `m` and `open-epic-request` to `r`, region `review-surface`. Both are in `REVIEW_SURFACE_ACTION_IDS`, and `bindingAllowedInLayer` returns false for them in every other layer (line 562). `CommandPalette.tsx` `continue`s past both, so no dead palette entry. `layer-guard.test.tsx:325` asserts the fence.
- Merge sheet and epic sheet each focus their confirm button on open (`MergeConfirmSheet.tsx:180-185`, `EpicRequestSheet.tsx` keyed effect), so the already-proven Enter/Space activation lands on it. `useRegionBindings`' `isActivationTarget` guard (CR-03) is unchanged.
- WebKit tests (ran them): `m` opens the merge sheet with Merge focused and Enter and Space each confirm exactly once with `["t1"]`; `r` opens the epic sheet with Open request focused and Enter confirms once carrying `READY_DRAFT.draft.contentHash`; `m` inert when the precheck refuses; `m` inert in epic scope; `r` inert in task scope; neither re-fires while a sheet is open. No test presses Tab, which is correct now that the route is a binding.
- Residue: jsdom or Playwright WebKit is not WKWebView under Tauri. Human item 1.

## Ruling on WR-01 (`m` preventDefault)

**The claim is true, and it does not break any roadmap criterion or any plan must-have as the must-have is worded.**

- Verified in code: `ReviewSurface.tsx:240-256` always passes an `"open-merge"` handler. `useRegionBindings` (`keyboard.ts:781-791`) returns early only when `handlers[binding.id]` is missing, otherwise it calls `event.preventDefault()` before the handler. The handler tests `mergeOffered` after the keystroke is already cancelled. So `m` is cancelled and does nothing in epic scope, with an integrated task, and while the precheck is loading or refused. `EpicRequestBar` does it right for `r` by passing `{}` when `offered` is false.
- Why it is not a failure: 08-15's must-have reads "`m` and `r` do nothing when the corresponding button is not offered ... the keyboard route and the button appear under exactly the same conditions". Both halves hold: no sheet opens, and `mergeOffered` is the one expression read by the button and the handler. `resolveBinding` already skips bare keys when the target is an `INPUT`, `TEXTAREA` or contenteditable, so no text entry can be swallowed. A bare `m` has no browser default action on a non-editable target. No user-visible harm exists today.
- What is false is the 08-15 SUMMARY's stronger wording that the binding "cannot swallow a keystroke". That sentence should be corrected. The tests assert only that no dialog opened, so they cannot see it. Fix is the reviewer's one-liner: add the entry only when `mergeOffered && !sheetOpen`, plus a cancelable-event test. Warning, not a gap.

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/desktop/src/review/review.css` | Single-layer row tint, marked edit | VERIFIED | Edit background transparent; mark is inset box-shadow; no theme switch. |
| `packages/desktop/src/review/__tests__/browser/legibility.browser.test.tsx` | Painted-contrast measurement | VERIFIED | Green in WebKit; non-vacuous. |
| `packages/core/src/forge/request_body.rs` | `content_hash()` | VERIFIED | Single digest, used by both commands. |
| `packages/desktop/src-tauri/src/commands/forge.rs` | `contentHash` in, `draftChanged` out | VERIFIED | Guard before push; bare category. |
| `packages/desktop/src/adapters/tauri.ts` | typed `forgeOpenEpicRequest(epicId, contentHash)` | VERIFIED | Sole invoker. |
| `packages/desktop/src/review/EpicRequestSheet.tsx` | echoes hash, refetches on refusal, focuses primary | VERIFIED | Wired; WR-02 notice edge case noted. |
| `packages/desktop/src/state/keyboard.ts` | `m`, `r`, layer fence | VERIFIED | Three places all updated. |
| `packages/desktop/src/review/MergeConfirmSheet.tsx` | focus confirm on open | VERIFIED (partial) | Result state not focused (WR-05). |
| `.../uat-screenshots/uat-01-review-diff-1440x900.png` | regenerated | VERIFIED | Present; regenerated by the browser suite. |

## Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `request_body.rs` `content_hash` | preview DTO and confirm command | same function, both callers | WIRED |
| `EpicRequestSheet` `draft.contentHash` | `forge_open_epic_request` | `adapter.forgeOpenEpicRequest` | WIRED |
| `draftChanged` rejection | `preview.refetch()` | `.catch` in `handleConfirm` | WIRED |
| `BINDINGS` `m`/`r` | `ReviewSurface` / `EpicRequestBar` handlers | `useRegionBindings("review-surface", ...)` | WIRED |
| `allActionIds()` | palette | `continue` in `CommandPalette` switch | WIRED (excluded) |
| `review.css` edit properties | react-diff-view `.diff-code-edit` | CSS custom properties plus 3-class selector | WIRED |

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|----------|------|--------|-----------|--------|
| `EpicRequestSheet` title and body | `preview.data.draft` | `forge_epic_request_draft`, board reads plus git ancestry per task | Yes | FLOWING |
| Published title and body | `draft` in the confirm command | re-assembled from DB under the lock, then hashed and compared | Yes | FLOWING |

## Behavioral Spot-Checks (run by me this session)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| WebKit suite (legibility, ergonomics, keyboard) | `vitest run --config vitest.browser.config.ts` in `packages/desktop` | 3 files, 23 tests pass | PASS |
| Review and layer-guard jsdom | `vitest run src/review src/board/__tests__/layer-guard.test.tsx` | 7 files, 122 tests pass | PASS |
| Core epic request draft and merge | `cargo test -p core --test epic_request_draft --test review_merge` | 22 and 37 pass | PASS |
| Contrast recomputation | independent node script over token hexes | all code-bearing roles >= 4.5 on row tint | PASS |

Not re-run, relied on the orchestrator's measurements: `cargo build --workspace`, the full `cargo test --workspace` (2 ignored), full jsdom 51 files / 768 tests, sidecar 223 tests.

## Probe Execution

SKIPPED: no probes declared by any 08 plan.

## Requirements Coverage

| Requirement | Source plans | Description | Status | Evidence |
|-------------|--------------|-------------|--------|----------|
| REVW-01 | 08-01, 08-02, 08-13 and others | Task diff in-app with syntax highlighting | SATISFIED | Truths 1, 5 |
| REVW-02 | 08-01, 08-09 and others | Accumulated diff of epic integration branch | SATISFIED | Truth 1 |
| REVW-03 | 08-15 and others | Check off criteria against the diff | SATISFIED | Truth 2 |
| REVW-04 | 08-15 and others | Merge in-app, conflicts surfaced | SATISFIED | Truths 3, 8 |
| REVW-05 | 08-14, 08-15 and others | Open PR/MR for epic in one action | SATISFIED (stub forge); live run is human item 2 | Truths 4, 6, 7, 8 |

All five IDs appear in at least one plan's `requirements:` frontmatter, and no ID maps to Phase 8 in REQUIREMENTS.md without a claiming plan. No orphans.

**Tracking defect, checked:** the reported 08-15 problem (REVW-05 left unmarked) does not exist in this tree. `REQUIREMENTS.md` lines 129-133 all read `[x]` and lines 306-310 all read `Complete`.

## Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` in any modified source file. No stub, empty handler or hardcoded-empty render in the touched files.

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `ReviewSurface.tsx:240-256` | handler registered unconditionally, so `m` is cancelled when not offered (WR-01) | Warning | No user-visible effect today; SUMMARY wording false |
| `MergeConfirmSheet.tsx:180-185` | result-state buttons not focused (WR-05) | Warning | Conflict exits and Close mouse-only if WKWebView skips buttons in Tab order |
| `request_body.rs` / sheet header | branches outside digest (WR-03) | Warning | Target branch drift between preview and confirm not refused |
| `forge.rs:204-231` | task-path `forge_open_request` unguarded, doc claims "by construction" (WR-06) | Warning | Predates round; tracked in deferred-items.md |
| `EpicRequestSheet.tsx:249-265` | refusal with identical refetched hash shows no notice; notice never clears (WR-02) | Warning | Click appears to do nothing; rare |
| `forge.rs:403` | renderer string logged unvalidated (IN-01); `keyMatches` ignores ctrl/alt (IN-02) | Info | Log injection and Ctrl+R/M on non-macOS |

None of the six warnings falsifies a roadmap criterion or a plan truth. WR-04 is carried as truth 7.

## The blocked UAT item

UAT item 4 is **still blocked, reason `third-party`**. The test exists and is correct in shape (`forge_live_github.rs`, `#[ignore]`, calls `open_epic_request_at` twice, asserts `AlreadyOpen` with the same number, then closes the PR and deletes the branch). It has never been run, because it opens a real pull request on a real GitHub repository under the account owner's credentials, and the agent running here has neither the repository nor the authority to create one. Nothing in this round could unblock it. The logic it would exercise is covered by the stub-forge chain in `forge_live_chain.rs`, so it is a confidence item for the real `gh` and `git push` behaviour, not evidence of a defect.

## Human Verification Required

### 1. Keyboard route in the real WKWebView

**Test:** `npm --prefix packages/desktop run tauri dev`; open a task review, press `m`, then Enter; open an epic review, press `r`, then Enter.
**Expected:** Sheet opens with its confirm button focused; Enter confirms once; no mouse, no Tab.
**Why human:** Proven in Playwright WebKit only. No WebDriver exists for WKWebView on macOS.

### 2. Live forge run (UAT item 4, blocked)

**Test:** `gh repo create flywheel-uat --private --add-readme`, then `FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat cargo test -p core --test forge_live_github -- --ignored --nocapture`.
**Expected:** One PR opened, second call returns the existing one with the same number, both cleaned up.
**Why human:** Needs the account owner's credentials and creates a real PR.

### 3. `draftChanged` ordering and keyboard exits after a conflict

**Test (a):** Preview an epic request, change the board, confirm. **Expected:** nothing pushed, new text shown. A cheap alternative to a manual run is extracting the compare into a core function and testing it (WR-04).
**Test (b):** After a conflicting merge, try to reach the two exits and Close by keyboard. **Expected:** a route exists, or the team accepts mouse-only there (WR-05).
**Why human:** No test reaches the guard; the post-result focus path is unfocused by construction.

## Process note on MVP mode

ROADMAP marks Phase 8 `Mode: mvp`, but its Goal is not in "As a ..., I want to ..., so that ..." form, so the MVP user-story guard would refuse. I did not refuse: the four roadmap success criteria are explicit and were the contract this verification was asked to check. Earlier rounds treated it the same way. If MVP-mode flow coverage is wanted, the goal needs rewriting via `/gsd mvp-phase 8`.

## Gaps Summary

No gaps. G-08-1, G-08-5 and G-08-6 are closed against their definitions. The phase closes on its roadmap criteria, which hold. It carries three human-verification items and six code-review warnings. Recommended order if any are acted on before moving on: WR-04 (small extraction, protects the one security-relevant ordering), WR-05 (completes the keyboard story G-08-6 began), WR-01 (one-line fix plus a test, and corrects the SUMMARY claim).

---

_Verified: 2026-10-07T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
