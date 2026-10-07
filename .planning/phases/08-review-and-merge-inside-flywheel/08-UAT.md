---
status: diagnosed
phase: 08-review-and-merge-inside-flywheel
source: [08-VERIFICATION.md]
started: 2026-10-07T15:20:00Z
updated: 2026-10-07T16:40:00Z
round: 2
supersedes: "round 1 (6 items, gaps G-08-1/G-08-5/G-08-6) — recoverable at git show f52bd33:.planning/phases/08-review-and-merge-inside-flywheel/08-UAT.md"
---

## Current Test

[testing paused — 1 item outstanding]

## Tests

### 1. m and r reach both confirmations in the real macOS WKWebView
expected: Each sheet opens with its confirm button focused and Enter confirms once, with no mouse and no Tab
why_human: G-08-6's route is measured in Playwright WebKit, not in the real macOS WKWebView under Tauri. No automation can drive that binary — there is no WebDriver for WKWebView on macOS.
result: issue
reported: "so I feel like the design is still pretty terrible but I believe we have that in a later gsd phase, right? we have no cues for actual changes on tasks etc. and the design is really not modern / for (3), I can see the epic review (it's ugly) but then the autofocus goes onto acceptance criteria, not the request sheet, so \"r\" adds to the input text. / Rest seems to work perfectly"
severity: major
partial_pass: "The task half passed: `m` on THRE-43 opened MergeConfirmSheet with the Merge button already focused and Enter confirmed once, no mouse and no Tab. Only the `r` half failed."


### 2. A live forge request opens once and reports AlreadyOpen the second time
expected: First call pushes and opens one request; second returns AlreadyOpen with the same request number
command: FLYWHEEL_UAT_GITHUB_REPO=<owner>/flywheel-uat cargo test -p core --test forge_live_github -- --ignored --nocapture
why_human: Carried over from round 1 as still BLOCKED (third-party). It opens a real PR on a real repository with the account owner's credentials, so it is `#[ignore]`d and has never run. Everything else about REVW-05 is proven against a gh/glab stub that is the only substituted component (forge_live_chain.rs).
result: pass
source: live-forge
evidence: |
  Ran 2026-10-07 against a throwaway private repo created for it
  (`gh repo create flywheel-uat --private --add-readme`):
    UAT-4 first call  -> Opened #1      https://github.com/cymarechal/flywheel-uat/pull/1
    UAT-4 second call -> AlreadyOpen #1 https://github.com/cymarechal/flywheel-uat/pull/1
    test result: ok. 1 passed; 0 failed; finished in 37.26s
  Cleanup verified after the run: PR #1 CLOSED, pushed branch deleted,
  `refs/heads/main` the only remaining head. No longer BLOCKED — the
  idempotency now holds against the real `gh` CLI and the live GitHub API,
  not a shell stub.
environment_note: |
  The first attempt failed with SSH "Repository not found" — NOT a product
  defect. This machine sets `core.sshCommand` per identity (global
  `~/.ssh/devoteam`, this repo `~/.ssh/cymarechal`). The test clones into a
  fresh temp dir with no local config, so it inherits the GLOBAL key, which
  has no access to the owner's throwaway repo. Re-ran with
  `GIT_SSH_COMMAND='ssh -i ~/.ssh/cymarechal -o IdentitiesOnly=yes'` and it
  passed. Worth one line in forge_live_github.rs's "Running it" docs — the
  failure reads as a missing repository rather than a wrong key.

### 3. Keyboard route out of a conflicting merge
expected: A keyboard route exists to "Start a session to resolve", "Open in editor" and Close — or the team accepts mouse-only exits on macOS
why_human: WR-05. MergeConfirmSheet focuses only the Merge button, once. After the result renders, that button unmounts and focus falls to the scope container. If WKWebView does not Tab to buttons — the premise 08-15 is built on — those three are mouse-only. Escape still closes.
result: blocked
blocked_by: prior-phase
reason: "No conflicting merge is reachable on the current board, so the conflict result this test exits from never renders."
evidence: |
  `git merge-tree --write-tree --name-only <epic-branch> <task-branch>` for all
  five worktree tasks, 2026-10-07:
    THRE-38 ahead=0 clean   THRE-53 ahead=0 clean   THRE-33 ahead=0 clean
    THRE-43 ahead=0 clean (merged during test 1)    THRE-58 ahead=0 clean
  5/5 clean and 4/5 have nothing to merge, so `m` is not even offered on four
  of them (`MergeRefusal::NothingToMerge`). WR-05 stays open: it is answerable
  only by whoever next produces a genuinely conflicting task branch. Declining
  to manufacture a synthetic conflict was a deliberate owner call, not an
  oversight — a hand-made conflict would measure the sheet, not the workflow.

### 4. draftChanged is refused before any push or forge call
expected: Rejection is the bare string `draftChanged`; the remote has no new branch or PR; the sheet re-renders the current text
test: Preview an epic request, check a criterion on the board from elsewhere, then confirm. Observe that no `git push` and no `gh pr create` ran and that the sheet shows the new text.
why_human: WR-04, recorded in VERIFICATION.md as behavior_unverified rather than a gap. The comparison lives inside a `#[tauri::command]` taking `State` and `AppHandle`, so no Rust test reaches it, and the renderer tests mock the rejection. The ordering is correct by reading — `forge.rs:401-404` returns before `open_epic_request_at` at 407 — but a refactor moving the check below the push would still pass every current test.
result: pass
reported: "I think it works"
confidence: self-reported
caveat: |
  Recorded as a pass on the owner's observation, but the ordering it asserts is
  still NOT proven by any test. "I think it works" is weaker evidence than this
  item's own why_human asks for, and the regression risk the item was filed
  against is unchanged: a refactor moving the hash comparison below the push
  would still pass every test in the repo AND would still look correct in a
  manual run, because a matching draft never exercises the ordering at all.
  Automation for this is filed as the FIRST item of the UAT-automation debt
  below — it is the highest-value one, not the hardest.

## Summary

total: 4
passed: 2
issues: 1
pending: 0
skipped: 0
blocked: 1

## Gaps

- gap_id: G-08-R2-1
  truth: "Pressing `r` on the epic review surface opens the epic request confirmation with its confirm button focused"
  status: resolved
  resolved_by: "857c21b fix(08): epic review no longer traps focus in the criteria composer"
  resolved_at: 2026-10-07
  resolution: |
    AcceptanceCriteriaList's zero-criteria auto-open is now behind an optional
    `autoOpenWhenEmpty` prop defaulting to true (item panel unchanged);
    CriteriaRail passes false. Two regression tests added to
    review/__tests__/keyboard-activation.test.tsx, BOTH verified red without the
    fix. The `r` test fires at document.activeElement rather than document.body
    — the guard keys off event.target, so a body-targeted press passed while the
    bug was still present, which would have shipped a vacuous test.
    Full desktop suite: 770 passed / 51 files.
    NOT re-confirmed by hand in WKWebView, deliberately: the DOM half is now
    test-covered and is not WebView-specific, and the WKWebView-specific half
    (Enter activating an already-focused button) already passed in this test's
    `m` arm. Re-running the round would cost a human pass to re-prove what the
    suite now holds.
  reason: "User reported: the autofocus goes onto acceptance criteria, not the request sheet, so \"r\" adds to the input text. The `m` half of this test passed in the real WKWebView — only the `r` route is broken."
  severity: major
  test: 1
  note: "Fresh gap id (not G-08-1) on purpose — G-08-1/G-08-5/G-08-6 are claimed by executed round-1 plans 08-13/08-14/08-15, so reusing a round-1 id would make reconcile_gaps mark this as already resolved."
  observed: "On opening an epic review, focus lands in a CriteriaRail acceptance-criterion text input. `useRegionBindings` correctly declines to claim a printable key while a text field has focus, so `r` is typed as a character instead of invoking `open-epic-request`. EpicRequestBar's `offered` expression was satisfied (THRE-7 integration branch was 1 ahead of main after the THRE-43 merge, origin is GitHub, gh authed), so the action WAS on offer — the keystroke never reached it."
  root_cause: "AcceptanceCriteriaList auto-opens and focuses its composer when an item has zero acceptance criteria; CriteriaRail composes that component into the review surface, so an epic review with no criteria steals focus into a text input on mount and `useRegionBindings` correctly declines to claim the printable key `r`."
  root_cause_detail: |
    Not a focus-management defect in the review surface, and not a regression in
    08-15's keyboard route. It is a COMPOSITION defect: a behavior that is
    correct in the item-detail panel is wrong when composed into a surface that
    owns single-key bindings.
      1. AcceptanceCriteriaList.tsx:281-287 — on `criteriaQuery.data.length === 0`
         it sets `addStep = "statement"` once per mount. This is the documented
         zero-item state from 01-UI-SPEC.md State Inventory ("quick-add is
         already visible and focused so the first keystroke creates the first
         item") and is RIGHT for the panel.
      2. AcceptanceCriteriaList.tsx:288-291 — `addStep === "statement"` focuses
         `statementInputRef`, an `<input type="text">`.
      3. CriteriaRail.tsx:66 composes that component unchanged into the review
         surface, inheriting step 1 along with everything it wanted.
      4. keyboard.ts:308-314 — `useRegionBindings` treats INPUT/TEXTAREA/
         contentEditable as live text entry and does not claim printable keys.
         CORRECT behavior; it is what makes `r` type a character.
    Proof the precondition held in the failing run: every epic carrying an
    integration branch has zero acceptance criteria
    (THRE-7/9/10/14/17 all `count(acceptance_criteria) = 0`), so the composer
    auto-opens on EVERY epic review reachable today, not just the one tested.
    EpicRequestBar.offered was true at the time (THRE-7 one commit ahead of
    main, origin GitHub, gh authed) — the action was on offer and the keystroke
    never reached it.
  artifacts:
    - path: "packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx"
      issue: "Zero-criteria auto-open + input focus (lines 281-291) is unconditional, so every consumer inherits a panel-specific affordance."
    - path: "packages/desktop/src/review/CriteriaRail.tsx"
      issue: "Composes AcceptanceCriteriaList (line 66) without opting out of the auto-open, inside a surface that owns single-key bindings."
  missing:
    - "Gate the zero-criteria auto-open behind an opt-in prop (panel passes it, CriteriaRail does not) — the rail should render the composer closed."
    - "A browser test asserting that on opening an epic review with zero criteria, document.activeElement is not a text-entry element and `r` opens the request sheet. This is NOT WKWebView-specific and would have caught the bug in Playwright WebKit."
  severity_note: "Blocks the `r` route on every epic review currently reachable, not an edge case."
  debug_session: ""

## Phase-Criteria Assessment

Recorded here rather than in a further UAT round, per the owner's 2026-10-07
decision to stop running testing rounds and drain findings through the board.
A phase closes on its roadmap success criteria, not on zero findings.

- criterion: 1
  text: "User reads a task's full diff with syntax highlighting, and the accumulated diff of its epic's integration branch"
  verdict: satisfied
  evidence: "Owner reached and read both scopes in the running app: 'Rest seems to work perfectly.'"

- criterion: 2
  text: "User checks off each of the task's acceptance criteria against the diff while reviewing it"
  verdict: NOT DEMONSTRABLE ON THIS BOARD
  evidence: |
    The whole database holds TWO acceptance_criteria rows, both on tasks, and
    NEITHER is on any of the five tasks that have a worktree. Every epic
    carrying an integration branch has zero. So there is no reviewable item on
    this board against which a criterion can be checked off at all — the
    interaction could not be exercised, by the owner or by anyone.
    Covered by automated tests (08-02, 08-06, 08-09) and the code path is live;
    what is missing is DATA, not behavior.
    This is the phase's own stated core-value criterion — its Notes call it
    "where the core value becomes a daily habit rather than a slogan" — and it
    is also the project's Core Value line ("anchored to a structured board item
    with real acceptance criteria"). A 907-task board with 2 criteria cannot
    show it. Filed as board work, not as a phase blocker.

- criterion: 3
  text: "User merges a task branch into its epic integration branch from within the application, and any conflict is surfaced clearly rather than failing silently or half-merging"
  verdict: partially satisfied
  evidence: |
    Merge half PROVEN: the owner merged THRE-43 into
    flywheel/epic/thre-7-agent-session-supervision with `m` + Enter, and an
    independent `git rev-list --count` afterwards showed the branch gone from 1
    commit ahead to 0 — the merge really landed, not just rendered success.
    Conflict half UNVERIFIED: `git merge-tree --write-tree` across all five
    worktree tasks returned clean 5/5, so no conflict is reachable on this
    board. See test 3 (blocked). Owner declined a synthetic conflict.

- criterion: 4
  text: "User opens a pull request or merge request for a finished epic's integration branch in one action"
  verdict: satisfied
  evidence: |
    Core path proven against the REAL forge for the first time (test 2): opened
    PR #1 on cymarechal/flywheel-uat, second call returned AlreadyOpen #1,
    cleanup verified. The in-app one-keystroke route was broken by G-08-R2-1 and
    is fixed in 857c21b with two non-vacuous regression tests.

## Carry-Forward Board Work

Filed as issues rather than GSD plans, per the ship-first decision:
  - Seed or author real acceptance criteria on reviewable tasks — criterion 2 is
    not demonstrable without them, and this is the product's Core Value.
  - Board rows carry no cue that a task has an actual diff. Finding the one
    reviewable task in a 907-task board took a hand-written SQL join plus a
    `git merge-tree` sweep. Routed into Phase 8.1's direction round.
  - A conflicting-merge fixture, so criterion 3's conflict half and WR-05's exit
    route become testable instead of waiting on a real conflict.
  - `draftChanged` ordering (test 4) is still proven only by reading, not by a
    test. Highest-value automation item of this round.
  - forge_live_github.rs's setup docs should name the per-identity
    `core.sshCommand` trap: the clone inherits the GLOBAL key and fails with
    "Repository not found", which reads as a missing repo rather than a wrong key.
