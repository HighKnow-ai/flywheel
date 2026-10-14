---
status: accumulating
opened: 2026-10-07
reviewed_at: null
decision: "Owner, 2026-10-07: remove every user review until MVP completion; delay all of it to the end, when there is a usable product to review."
redeem_at: "Phase 11 (Ship It) — one batch pass against a usable, installed build. See ROADMAP.md Phase 11."
---

# Deferred Review Register

Every human-verification item GSD would otherwise have stopped and asked about is
written here instead of being asked. **Nothing is dropped — it is queued.** One
batch pass happens at MVP, against an app that is actually usable, which is the
only point at which most of these questions have a meaningful answer anyway.

The rule that produces this file is in `.claude/CLAUDE.md` § "Human verification
is deferred until MVP". Read that before adding to or redeeming this register.

## How an item gets here

A phase's verifier harvests what would have been human checks. Instead of writing
`status: human_needed` and opening a `{phase}-UAT.md` round, it appends the items
here and the phase closes on its automated verification. Each item keeps enough
context to be answerable months later by someone who was not in the room:

- `phase` — where it came from
- `truth` — the behavior that is asserted but not humanly confirmed
- `why_deferred` — why no test covers it
- `risk_if_wrong` — what breaks if the assertion is false
- `automatable` — **honest** answer, because "hard to automate" was previously
  recorded as "needs a human" and then stopped being questioned. On 2026-10-07
  three of Phase 08's four "human" items turned out to be automatable.

## Open items

- id: D-REV-01
  phase: "03 — Nothing Lost, Nothing Left Running"
  truth: "A destructive action in an auto-accept session raises a pending permission request and blocks the session until a human answers (SC5, AGNT-07)."
  status: closed (2026-10-13, plan 11-18, D-197)
  why_deferred: |
    Already measured, twice, against claude 2.1.267 by
    scripts/uat/uat-03-destructive-gate.mjs. Safety HOLDS — the remote ref is
    unchanged and the agent is told "This would delete a branch." But no
    permission_request is raised and the session never blocks on a human: the
    PreToolUse hook (matcher 'Bash', WIRED_DECISION 'deny') refuses the command
    outright, and it classifies via the shim's OWN --classify-command mode, so
    it refuses precisely the set the shim's socket would have asked about.
    D-58's indefinite block is unreachable for anything run through Bash.
  risk_if_wrong: |
    Low on safety, real on honesty: AGNT-07 claims the gate ASKS a human. The
    shipped behavior REFUSES. The requirement text and the product behavior
    disagree, and the requirement is the one that is wrong.
  needs: "A decision, not a test: either the hook defers to the shim's socket (ask), or AGNT-07 is narrowed to match the shipped refusal. This is an owner call."
  automatable: "No — it is a requirements decision. The behavior itself is already measured by an automated harness."
  carried_from: ".planning/phases/03-nothing-lost-nothing-left-running/03-UAT.md gap G-03-3"
  update_11-18: "Plan 11-18, 2026-10-13. CLOSED by D-197: the requirement was the side that was wrong. AGNT-07 now reads 'a destructive action is refused before it reaches the remote, and the user is told', with a dated narrowing note beneath it citing D-197 and scripts/uat/uat-03-destructive-gate.mjs. One sentence in docs/destructive-gate-trust-boundary.md that still claimed an ask-and-block was reworded. No gate code changed; D-197 rejected both code alternatives."

- id: D-REV-02
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "A keyboard route exists out of a conflicting merge to 'Start a session to resolve', 'Open in editor' and Close (WR-05)."
  status: unreachable
  why_deferred: |
    No conflicting merge exists on the board to exit from.
    `git merge-tree --write-tree` across all five worktree tasks returned clean
    5/5, and four of five have nothing to merge at all. MergeConfirmSheet
    focuses only the Merge button, once; after the result renders that button
    unmounts and focus falls to the scope container, so if WKWebView keeps
    buttons out of the Tab order those three actions are mouse-only. Escape
    still closes.
  risk_if_wrong: "A keyboard user is stuck in a conflict result with only Escape. Not data loss; the merge aborts clean."
  automatable: "YES — a conflicting branch pair is three git commands in a test fixture. This was filed as a human item for want of a fixture, not for want of a human."
  correction_2026-10-07: |
    Re-verification of Phase 08 found this UNDERSTATED, in the direction of
    more automatable, not less. The conflicting-branch fixture ALREADY EXISTS
    (`task_conflict_a` / `task_conflict_b`, packages/core/tests/common/mod.rs
    lines 217-291) and four core tests already run against it. The renderer
    already drives the conflict RESULT state too: merge-sheet.test.tsx
    (lines 328, 338, 358) mocks `mergeMock` to resolve
    `{kind: "conflicted", files: [...]}` and asserts "Merge aborted — N
    conflicts, nothing changed".
    So the remaining work is ONE ASSERTION, not a fixture: after the conflict
    result renders, assert `document.activeElement` is one of the three exits.
    MergeConfirmSheet.tsx:176-183 shows why it fails today — a `focusedRef`
    guard fires the focus call once, on the confirm button, which then unmounts.
    Also corrected: criterion 3's conflict half was recorded as UNVERIFIED. It
    is test-proven against real conflicting git fixtures at both core and
    renderer level. What is unverified is narrower — no conflict has been
    observed END TO END in the running app, and this keyboard exit is missing.

- id: D-REV-03
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "An epic request whose draft moved is refused with the bare string `draftChanged` BEFORE any push or forge call (WR-04)."
  status: unproven
  why_deferred: |
    The owner observed "I think it works" on 2026-10-07, which is weaker
    evidence than this item needs and is recorded as such. The comparison lives
    inside a `#[tauri::command]` taking `State` and `AppHandle`, so no Rust test
    reaches it, and the renderer tests mock the rejection. The ordering is
    correct by READING — forge.rs:401-404 returns before `open_epic_request_at`
    at 407 — but a refactor moving the check below the push would still pass
    every test in the repo, and would also still look fine in a manual run,
    because a matching draft never exercises the ordering at all.
  risk_if_wrong: "Board content is published to a forge that the user never saw and never confirmed. This is the one action in the phase that leaves the machine."
  automatable: "YES, and this is the highest-value item in the register. A stub-forge test asserting the gh stub was never invoked on a hash mismatch would pin the ordering. It is a testability defect, not a human item."

- id: D-REV-04
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "User checks off each of a task's acceptance criteria against the diff while reviewing it (Phase 08 success criterion 2)."
  status: closed (data vacuum only — 2026-10-07, plan 08.1-03)
  why_deferred: |
    NOT a code defect — a data vacuum. The entire database holds TWO
    acceptance_criteria rows, both on tasks, and neither is on any of the five
    tasks that have a worktree. Every epic carrying an integration branch has
    zero. There is no reviewable item on the board against which a criterion
    can be checked off, so the interaction cannot be exercised by anyone.
  risk_if_wrong: |
    This is the phase's own stated core-value criterion ("where the core value
    becomes a daily habit rather than a slogan") and it restates the project
    Core Value in CLAUDE.md: "Every unit of agent work is anchored to a
    structured board item with real acceptance criteria — never a chat blob."
    A 907-task board carrying 2 criteria demonstrates the slogan, not the habit.
    It likely also contributes to the app reading as hollow: the review
    surface's criteria rail renders empty on every item reachable today.
  automatable: "Partly — the interaction is already test-covered. What is missing is seeded data, which is a fixture/seed task."
  correction_2026-10-07: |
    The NUMBERS above are stale, re-measured during Phase 08 re-verification.
    The database now holds FOUR acceptance_criteria rows, not two: 2 on tasks
    and 2 on EPICS. One of the epic rows is on epic 01M24BE37RE8ZGHN2P34GGK44Y
    ("Agent session supervision"), which DOES carry integration branch
    `flywheel/epic/thre-7-agent-session-supervision` — so "every epic carrying
    an integration branch has zero" is no longer true.
    Both epic rows were created 2026-10-07T07:27:49Z and 07:28:09Z with probe
    text (statements "test" / "hello", hints "hello" / "ok"). That timing and
    that text place them inside round-2 UAT, almost certainly typed INTO the
    auto-opened composer that G-08-R2-1 had stolen focus into. The bug was used
    to falsify its own supporting measurement.
    THE VERDICT IS UNCHANGED. This criterion is about a TASK's criteria against
    a TASK's diff. All five tasks holding a worktree still carry ZERO criteria,
    and the two task-scope rows sit on task 01M22XC0SZDG9D7S01P13V2WXF ("test",
    in_review, no epic, no worktree), so there is still no task diff to check a
    task criterion against. Still not demonstrable.
    Knock-on: the G-08-R2-1 root-cause note in 08-UAT.md cites "every epic
    carrying an integration branch has zero acceptance criteria" as proof the
    broken path was the only reachable one. That premise was true when measured
    and is now false. The diagnosis stands; the measurement has expired.
  closure_2026-10-07: |
    CLOSED by plan 08.1-03 (D-23). What closed is the DATA VACUUM, and only that:
    the five tasks that hold an active worktree (THRE-33, -38, -43, -53, -58) now
    each carry three real, diff-checkable acceptance criteria (15 rows), so the
    review surface's criteria rail has something to render and be comped against.
    Written through create_criterion; 15 `criterion.created` events back them.
    The COUNT in this entry was stale twice. It said TWO rows; the first
    correction above said FOUR, 2 on tasks and 2 on epics. 08.1-RESEARCH.md
    Correction 7 confirms FOUR, and that ALL FOUR were probe text (`test`, `test`,
    `test`, `hello`) — not two, as CONTEXT D-23 also claimed. All four were
    deleted through delete_criterion (4 `criterion.deleted` events); the tool
    refuses to delete any statement not on its exact-match probe allowlist.
    Pre-run backup: ~/Library/Application Support/Flywheel/flywheel.pre-seed-criteria-20261007T113454.db
    NOT claimed: that the behaviour is verified. Seeding removes the blocker; it
    does not observe a human checking a criterion against a diff. That half of
    the Phase 08 truth stays deferred to Phase 11 and is NOT marked verified.
    STILL OPEN: D-REV-05's ergonomic half — this plan does not touch it.

- id: D-REV-05
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "The diff's added/removed tints and the word-level edit mark read correctly at a glance, do not fight the token colours, and feel like the product's one palette rather than a second theme (08-01 and 08-13 human-check blocks)."
  status: unasked
  why_deferred: |
    Harvested from the `<verify><human-check>` blocks of 08-01 and 08-13 at
    verification time; never asked, because human verification is suspended.
    The MEASURABLE half is already machine-proven and is not what is being
    asked here: legibility.browser.test.tsx measures painted contrast in real
    WebKit for every syntax-role/row pair across five languages, and a grep
    over every shipped stylesheet proves exactly one palette ships (no
    `prefers-color-scheme`, no `[data-theme`). What is left is taste:
    (1) does an added row still read as added and a removed row as removed at
    a glance; (2) does the edit mark read as "this part of the line changed"
    rather than as an underline typo; (3) does the tint still feel like one
    palette. A "no" on any of these is a design revision, not a contrast
    regression.
  defect_in_the_question: |
    08-01's block asks to read the diff "in both the light and the dark theme".
    There is no dark theme — the app ships ONE palette, which 08-13 verified and
    asserts in a test. Half of that check is void and must not be put to the
    owner at Phase 11. Ask only the three aesthetic questions above.
  risk_if_wrong: "Cosmetic. The numbers are proven; a 'no' means the diff is legible but ugly, which Phase 8.1 (visual polish) is already scheduled to address."
  automatable: "No — human aesthetic judgment, which is a physical reason. But scope it down first: the contrast numbers and the one-palette fact are already automated, and the light/dark half of the question is void."

- id: D-REV-06
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "A gutter-SELECTED diff row keeps every code-bearing syntax role above 4.5:1 (the unmeasured residue of G-08-1)."
  status: unmeasured
  why_deferred: |
    Carried as "Info only" by the 08-VERIFICATION of 2026-10-07 and never
    turned into a test. A selected row stacks a 14% blue selection layer over
    the 12% row tint. Recomputed from the token hexes: keyword lands at 4.65
    and 4.87 and every code-bearing role clears 4.5 — EXCEPT a
    `.token.deleted` or `.token.inserted` span inside a selected row, which
    drops to 4.02 / 4.21. That requires a diff-of-a-diff, which is why it was
    waved off. legibility.browser.test.tsx never selects a row before
    measuring, so the state is unmeasured in the real engine.
  risk_if_wrong: "Low and narrow: sub-AA text only while a row is selected AND the file under review is itself a diff. Selection is transient."
  automatable: "YES, and it is the cheapest item in this register — one `fireEvent.click` on the gutter before the existing measurement loop in legibility.browser.test.tsx. It is a number, not taste; it does not belong in a human round at all."
  update_11-13: "CLOSED by measurement. legibility.browser.test.tsx now gutter-clicks a delete and an insert row and runs the existing AA loop: min painted contrast 14.71:1 on both selected rows, and no token repaints the code. The 4.02 / 4.21 `.token.deleted` / `.token.inserted` case is unreachable, not just unmeasured: 08.1 removed every syntax hue and the highlighter registers no `diff` grammar, so a diff-of-a-diff row has no such span."

- id: D-REV-07
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "The criteria rail stays usable while reading a long diff: checking a criterion off does not lose scroll position, and toggling to epic scope keeps the rail readable (08-08 human-check block)."
  status: partly-blocked
  why_deferred: |
    Harvested from 08-08's `<verify><human-check>` block. It is two questions
    welded together, with different answers:
      - "check each criterion off ... without losing scroll position" is a
        BEHAVIOR, and it is blocked by D-REV-04's data vacuum, not by the
        absence of a human: no reviewable task carries a criterion to check.
        Scroll preservation itself is covered by keyboard.browser.test.tsx.
      - "confirm the rail stays usable while reading a long diff" is ergonomic
        taste with no stated threshold.
  risk_if_wrong: "Moderate on the ergonomic half — this is the surface where criterion 2's daily habit either happens or does not. Low on the behavioral half, which is already covered."
  automatable: "PARTLY. Scroll-position preservation on check: YES, one assertion against the existing browser fixture, once D-REV-04's seed data exists. 'Stays usable': No — ergonomic judgment, but it needs a threshold before it is worth asking, or it will get a shrug."
  update_11-13: "Scroll-position preservation is asserted (ergonomics.browser.test.tsx, two tests, scrollTop unchanged). The rail at the 900px window minimum (tauri.conf.json minWidth) is now measured: it scrolls on its own, no control is clipped, the first criterion is on screen, the page does not scroll sideways, in task and epic scope. That caught a real clip (Check button 142-272 in a 0-260 rail, Edit pencil wholly outside), fixed in AcceptanceCriteriaList.tsx. STILL HUMAN, physical reason = ergonomic judgement of reading a long diff: ask only 'At 900px wide with src/long.ts open, can you check all three criteria and still see which lines you selected, without scrolling the rail sideways?'"

- id: D-REV-08
  phase: "08 — Review And Merge Inside Flywheel"
  truth: "The epic task-criteria roll-up scans as one list beside a long diff, without crowding the epic's own criteria above it (08-09 human-check block)."
  status: unreachable
  why_deferred: |
    Harvested from 08-09's `<verify><human-check>` block, which asks to open
    "an epic with three or more tasks at review width" and read the roll-up.
    No such epic exists: the roll-up renders only when
    `rollup.length > 0` (CriteriaRail.tsx), and no epic on the board has any
    task carrying an acceptance criterion. So the section being judged does
    not render on anything reachable today — this is blocked on D-REV-04's
    data vacuum before it is blocked on a human. The 08-09 plan itself routed
    this to "the existing end-of-phase rail-ergonomics check", i.e. to
    D-REV-07, so the two should be asked together once data exists.
  risk_if_wrong: "Cosmetic, and currently unobservable. An unreadable roll-up would blunt criterion 2's payoff but cannot lose data."
  automatable: "No for the layout judgment (human aesthetic). But it is NOT ASKABLE AT ALL until D-REV-04 is seeded — redeem D-REV-04 first, then ask D-REV-07 and D-REV-08 in the same sitting."

- id: D-REV-09
  phase: "08.1 — Visual Polish (plan 09)"
  truth: "On the installed app, a selected row with list focus (full-ink 2px rule) and one that has lost focus (lighter 2px rule) read as different at a glance, and the `Dot` uncommitted-changes glyph is legible at 12px beside a status glyph."
  status: open
  why_deferred: |
    Plan 09 specified the focus clause (A-06(b)) and changed the change-cue glyphs (A-05);
    plan 14 builds the rule. The two selected surfaces measure 1.011 / 1.014 apart, so the
    rule carries the distinction, and the rule pair measures 4.06 / 4.23 apart. Those are
    computed ratios, not an observation of the painted app. `lucide-react`'s `Dot` is a
    small glyph; whether it reads at 12px is a perceptual question.
  risk_if_wrong: "Moderate on the focus half — an accessibility obligation, and the reason it was fixed in-phase rather than queued. Low on the glyph half: cosmetic, and swapping a registry glyph is a one-line change."
  automatable: "MOSTLY. Ratio and computed-colour assertions: YES, specified for plan 14 (contrast.test.ts plus a BoardRow test). A WebKit painted-colour assertion that the focused and unfocused rule differ: YES, one test. Only 'does the Dot read at 12px' is human aesthetic judgment."
  update_08.1-14: "The automatable half is DONE, not deferred: contrast.test.ts (rule roles 3:1 on every row surface, focused vs unfocused >= 3:1), selection-rule.test.tsx (the BoardRow branch) and legibility.browser.test.tsx (painted in WebKit, both schemes) all pass. What remains human is only the Dot-at-12px read."
  update_11-13: "The automatable half was already done in 08.1-14 (painted focused vs unfocused rule, computed in WebKit, both schemes); 11-13 added the Dot ratio to contrast.test.ts, reading the ink from BoardRow and EpicHeaderRow so a recolour is measured (>= 3:1 on every row surface, both modes). STILL HUMAN, physical reason = perceptual judgement: only 'does the Dot read at 12px beside a status glyph'."

- id: D-REV-10
  phase: "08.1 — Visual Polish (plan 12)"
  truth: "On the installed app, an expanded epic with an agent's challenge reads as the challenge first and the tasks after, the 48px row is legible (type label, title, Accept, Reject, and an error when a decision fails), and accepting one makes the task appear and the epic's total move."
  status: open
  why_deferred: |
    Plan 12 built the challenge row and its accept and reject, and proved order, height, the
    single rack, the existing mutation call, the board:changed refresh and the failed-accept
    path in jsdom against a fake core. The real board has ZERO proposals (authoring_proposals
    is empty), so nothing on it today renders a challenge row. The fake core's board:changed push
    stands in for the Rust command's own emit (commands/authoring.rs), which is not re-proved by
    this plan. How the row looks at 48px, with an error beside two buttons, is aesthetic.
  risk_if_wrong: "Low to moderate. A cramped row or an error that squeezes the title is cosmetic; the accept path itself is the tray's own and is unchanged."
  automatable: "MOSTLY. The visible-text and overflow checks (title truncates, buttons stay inside 48px) are one WebKit layout test once a proposal is staged: YES. A live accept against the real core needs a staged proposal, which Phase 11's drain can create: YES. Only 'does it read well' is human."
  update_11-13: "Layout half CLOSED: board-group.browser.test.tsx stages a challenge with a long title in WebKit at 716px (900px minus the 184px project rail) and measures it with getBoundingClientRect: title ellipsizes, label, Accept and Reject stay inside the 48px row, also with a failed decision's error beside them, and the title keeps >= 80px. Accept raising the epic total and a failed accept were already proved in challenge-inline.test.tsx against a fake core. NOT covered: a live accept against the real core (needs a staged proposal; automatable at Phase 11). STILL HUMAN, physical reason = aesthetic judgement: only 'does the expanded epic read well'."

- id: D-REV-32
  phase: "09 — Planned Fan-Out (plan 05, AGNT-05)"
  truth: "A real hard rate limit from the backend presents on the wire as a top-level `rate_limit_info.status` of `rejected` and/or an assistant message whose error is `rate_limit`, and pauses new dispatch."
  status: open
  why_deferred: |
    Physical: a hard limit cannot be produced on demand, and none has ever been observed live in this
    project. The only real captures are an `allowed` event (carrying an overage status of `rejected`,
    which the adapter correctly reads as open) and an `allowed_warning` event. Every `rejected`
    assertion runs against a fixture constructed from the documented shape
    (`packages/sidecar/test/rate-limit-wire.test.mjs`, `packages/core/tests/dispatch_limit_gate.rs`).
    The gate's reaction to the documented shape is tested; that the documented shape is what arrives is not.
  risk_if_wrong: "Moderate. If a real limit presents differently, the adapter yields no tier (an unrecognised status is never guessed at) and dispatch does not pause: AGNT-05 would silently be unmet on the one path it exists for, and the account would keep being sent requests."
  automatable: "PARTLY. Once a real limit occurs, its raw line is in the session log; freezing it as a fixture and asserting `tier: rejected` is one test. Provoking one deliberately is not something to do (it is the abuse this requirement exists to avoid)."
  update_11-14: "PARTLY CLOSED. CORRECTION to an earlier version of this note: a real hard limit HAS been observed, in Claude Code's own interactive transcripts (~/.claude/projects, 2026-09-21 onward), not in a Flywheel session log. It is an assistant message with error `rate_limit`, isApiErrorMessage, apiErrorStatus 429 and quotaLimits.status `rejected`; it is frozen in packages/sidecar/test/fixtures/rate-limit-rejected.json as provenance `observed-transcript` and the adapter classifies it as the rejected tier (rate-limit-wire.test.mjs). That is the transcript's serialisation, not a `-p` stream-json capture. STILL UNOBSERVED: a top-level `rate_limit_event` line with `rate_limit_info.status` of `rejected`; those fixture shapes stay `documented`. The live half (observing a limit end to end) is closed accepted-by-design: provoking one is, in the register's words, 'the abuse this requirement exists to avoid'. If a Flywheel session ever hits a limit, its raw line is in the session log; swap it into the fixture and flip provenance to observed. risk_if_wrong is reduced for the assistant-error path and unchanged for the event path."

- id: D-REV-33
  phase: "09 — Planned Fan-Out (plan 06, PLAN-05)"
  truth: "The scope-denied feed row (one line, with its widen action) and the per-task scope-refusal badge read well in the installed WKWebView: the row stays legible with a long refusal message, and a count of 20 is visibly different from none."
  status: open
  why_deferred: |
    Physical: human aesthetic judgement on a real window. The tests assert the row kind, the refused path,
    the single-flight action, the refusal text, the badge's presence, value, accessible name and call
    count; none can say whether a one-line row truncating a refusal message, or a 12px glyph beside a
    count, is noticeable at a glance. A live widen against a running `claude` session was also not run:
    the shipped hook was driven against the rewritten marker instead.
  risk_if_wrong: "Low. Cosmetic; a refusal message clipped by the fixed 32px row can be expanded later. The widen itself is asserted in the core."
  automatable: "PARTLY. A WebKit layout test for the row's overflow is YES once a session with a denial exists; a live widen against a real run is YES in the Phase 11 drain. Only 'is it noticeable' is human."
  update_11-14: "Layout half CLOSED: session-group.browser.test.tsx measures the scope-denied row in WebKit with a 300-character path: row and slot height equal a short message's, the text ellipsizes (scrollWidth > clientWidth, full text in the DOM and the title), the widen button's box is inside the row's and the text ends before it. The widen action is reached by keyboard (Option+Tab; WebKit's plain Tab skips buttons, see keyboard.browser.test.tsx). A BoardRow with 20 refusals paints a `20` badge named '20 scope refusals' inside its row; a task with none renders no badge at all. NOT covered: a live widen against a running `claude` session (needs a real login; the pre-existing core test asserts the widen). STILL HUMAN, physical reason = aesthetic judgement: only 'is it noticeable at a glance'."

- id: D-REV-34
  phase: "09 — Planned Fan-Out (plan 07, PLAN-03, PLAN-06)"
  truth: "In the installed app, one approved plan drives real `claude` sessions end to end: the tick spawns up to the cap through the real sidecar, the agent commits as its briefing tells it to, the automatic merge lands, and wave two starts from a base containing wave one."
  status: open
  why_deferred: |
    Physical: it needs a live `claude` login and the packaged sidecar, neither of which a test can stand in
    for. Everything the dispatcher decides and does is asserted against real git repositories
    (`packages/core/tests/dispatch_auto_merge.rs`), but the spawner there is a fake that writes and commits a
    file; the real launch body, the sidecar spawn and the agent's own obedience to the commit instruction
    were not exercised together. The cap and the gate are enforced on a spawn in that harness, not against a
    running account.
  risk_if_wrong: "Moderate. An agent that ignores the commit instruction stops its task as needs-attention (it is never committed for), so the failure is loud and the wave holds; a launch that fails in the real sidecar marks the task needs-attention with the error. Neither loses work."
  automatable: "PARTLY. The launch path against the real sidecar with a scripted fake `claude` is YES (the sidecar tests already ship `fake-claude.mjs`). A run against a real account is the Phase 11 drain."
  update_11-16: "Wiring half CLOSED: scripts/uat/uat-13-fan-out-live.mjs (registered in run-all.sh) drives one approved four-task plan through the REAL sidecar process and the scripted fake claude, with the real dispatcher tick (dispatch_exec::run_pass), the real PATH shim, watchdog, scope marker, worktrees, automatic merge and git. Only the model is replaced. Four sections, each printing D-REV-34: (1) cap: three wave-one tasks are ready, the cap is two; tick 1 spawns exactly two, tick 2 (slots still full) spawns none, live runs never exceed two over seven ticks, every session returns as a completed session_closed; (2) commit: each of the four fake agents makes exactly one commit touching only its declared file, and does so only because its briefing carried DISPATCHED_COMMIT_INSTRUCTION; (3) merge: every agent commit is an ancestor of the epic's integration branch and main did not move; (4) wave-two base: asserted by git merge-base --is-ancestor, never by the board: all three wave-one commits are ancestors of the commit Task D was built on, with a control that Task A's branch does not contain Task B's commit. The plan said three tasks; the harness uses four so the cap binds (a two-task wave would never test it). Mutation-checked: breaking the fake's commit-instruction match turned sections 1, 2, 3 and 4 red (tasks went needs_attention). NOT exercised: the desktop launch body (uat_fanout_ops mirrors its core steps: start_agent_run under the system actor, the packet and prompt, the scope marker, the shim env; the credential block, drift warnings, criteria pinning and the per-repository spawn floor are not mirrored). STILL OPEN, and a different claim from the one closed here: a run against a real account (a real login, a packaged sidecar, a real model that actually follows the commit instruction); routed to plan 11-21. Physical reason: a real login and a model's obedience cannot be stood in for."

- id: D-REV-35
  phase: "09 — Planned Fan-Out (plan 08, PLAN-01, D-147)"
  truth: "A real `claude` session started by `dispatch_plan_generate` completes headlessly, in the epic integration worktree, without stalling on a permission prompt: it reads the repository, calls `submit_plan`, a refused call is corrected in the same conversation, and it exits leaving the worktree clean."
  status: open
  why_deferred: |
    Physical: it needs a live `claude` login and the packaged sidecar. 09-RESEARCH flagged a read-only headless run as
    supported but not conclusive, and this is the first time the project launches one. What IS proven: the held
    `submit_plan` call is answered through the real socket by a fake backend, a refusal comes back as an error result
    the agent can read, the launch pre-approves that one tool only (argv), the run records an armed empty scope, and
    the core refuses every submission that does not come from a running planning run. NOT proven: that the real CLI
    in `default` permission mode lets its own read tools (Read, Grep, Glob) run without a prompt, that it does not
    reach for a tool outside the one pre-approved (which would block the run as `blocked` and hold its slot), or that
    a model follows the prompt's two entry forms without a correction round.
  risk_if_wrong: "Moderate. A run that blocks on a prompt shows as a pending permission request and holds a slot until the user answers or stops it; it writes nothing and stores no plan. Worst case the pass is unusable until the permission mode or the pre-approved list is widened, and the fix is a one-line argv change."
  automatable: "PARTLY. Whether the installed CLI pre-approves its read tools in `default` mode is YES: run the real binary once with the exact argv `buildClaudeArgv` produces for a planning launch and a read-only prompt, assert no permission request arrives (the `real-claude-argv` test is the precedent). A model's obedience to the prompt is the Phase 11 drain."
  update_11-16: "Pre-approval half CLOSED, against claude 2.1.287: packages/sidecar/test/real-claude-argv.test.mjs now runs the installed binary under the argv buildClaudeArgv itself produces for a planning launch (permissionMode default, submit_plan the only pre-approved tool, the real permission MCP server on a real startPermissionServer socket) and asserts no permission_request arrives and the process exits 0 inside 45 s. The model is replaced by a loopback server speaking the Messages API (ANTHROPIC_BASE_URL), so no credential is used and no token is spent; CLAUDE_CONFIG_DIR is a scratch directory so the developer's own settings and rules cannot change the answer. Non-vacuous: the real Read ran and returned the file's contents, and a control launch whose scripted tool (Bash touch) is not pre-approved DOES raise a permission_request through the same socket. FINDING: this CLI version offers no Grep or Glob tool at all (its tool list has Read, Edit, Write, Bash, ... and no search tools); search goes through Bash, and `grep -rn` and `find` ran with no request (the CLI's own read-only allow-list). The register's wording 'Read, Grep, Glob' is stale for this version; what is proven is Read plus read-only Bash search. NOT covered: the hook --settings file a live launch also passes (writeHookSettings; its matchers are Bash and the authoring tools), and whether a read-only git command inside Bash prompts: the PATH shim classifies `git rev-parse` and `git -c k=v <sub>` as uncategorized and raises a permission request (deferred-items.md, plan 11-16). STILL OPEN, a different claim from the one closed here: a real model following the prompt's two entry forms without a correction round, calling submit_plan, and leaving the worktree clean; routed to plan 11-21. Physical reason: needs a real login and a real model."

- id: D-REV-36
  phase: "09 — Planned Fan-Out (plan 09, PLAN-07, D-149, D-157, D-161, D-162)"
  truth: "In the installed app, the wave plan sheet, the epic row's dispatch cell and the gate line read well and can be used end to end: Plan fan-out, a window with 'Planning in progress', the draft appearing, editing a path and a wave, Approve and start, Pause/Resume/Stop, and a paused or warning gate showing its reason and action."
  status: open
  why_deferred: |
    Physical: there is no WebDriver for WKWebView, and the layout and wording are a human aesthetic judgement.
    What IS proven: every component's behaviour in jsdom against fixture DTOs (including the single-call and
    disabled-while-in-flight cases), the cell fitting the 64px epic row in real WebKit for a running plan with an
    open, paused and warning gate, the cell hiding at a narrow rack, and the Rust DTO changes over a migrated
    database; and the sheet staying inside a 1440x900 viewport with Approve reachable for a 40-task plan, in WebKit.
    NOT shown: how the sheet and the row LOOK, a real click path through the packaged app, and a real planning run
    (D-REV-35). The surface was built from CONTEXT.md and RESEARCH.md with no UI design contract for
    this phase, so the layout is the plan's own and open to revision here.
  risk_if_wrong: "Low to moderate. A cramped or confusing layout does not lose work; the worst case is a gate reason clipped to two lines (the full text is in the DOM and in a measured cell) or the sheet needing a second pass."
  automatable: "PARTLY. The no-clipping and reachability half is already a WebKit test (dispatch-layout.browser.test.tsx). The click path through the packaged app and the judgement of how it looks are not."
  update_11-14: "Containment and reachability half CLOSED across every state the truth names: dispatch-layout.browser.test.tsx now measures the cell in eight states plus the Stop confirmation (nothing planned, planning in progress, draft, running with a stuck task, paused plan, paused gate with and without a reset time, warning gate) with its words present, every control inside the 64px row's cell and reachable by Option+Tab, and the sheet in five (draft with wave pickers and path fields, a path edit with a long core refusal, the wave picker, a failed Approve, a plan in force), light and dark. FOUND, not fixed (pre-existing, see deferred-items.md): a refused Approve renders its message at the end of the scrolling body, below the fold for any plan taller than the dialog; held as an `it.fails`. STILL NOT AUTOMATED, two separate things: (1) the click path through the PACKAGED app is scriptable once the installed build from 11-08 exists; no physical obstacle, route to 11-21. (2) how the sheet and row LOOK is aesthetic judgement and stays human."

- id: D-REV-61
  phase: "11 - Ship It (plan 06, DIST-02, D-187, D-188)"
  truth: "In an installed build older than the latest release, the update banner appears over the running application, naming the new version and its notes; accepting it stages the update; a relaunch runs the new version; and with an agent running the banner names the count and installs nothing."
  status: open
  why_deferred: |
    Physical: it needs two installed builds of different versions, a published newer release, and a real
    relaunch. What IS proven: the banner, its dismissal, the live-run count and the failed-install case in
    jsdom over a stubbed adapter, mounted in the real application shell on both the board and a fresh
    install; and (plan 11-05) the Rust refusal and a four-asset release with a signature made by the owner's
    key. NOT shown: that an installed older build downloads, verifies and installs a newer one (D-REV-57's
    installed-client half), and how the banner LOOKS in the corner of a real window.
  risk_if_wrong: "Moderate for the update path (a user is stranded on an old build), low for the look. Releases are unsigned by Apple (D-REV-60); the update payload is verified by the Tauri updater key, a different trust root."
  automatable: "PARTLY. Install v0.1.0, publish v0.1.1, launch and read the banner from the DOM is scriptable once 11-08's installed build exists. How it looks is aesthetic judgement."
  update_11-08: |
    PRECONDITIONS NOW MET, ITEM STILL OPEN. v0.1.0 is installed at /Applications/Flywheel.app and v0.1.1 is
    published and is `releases/latest` (2026-10-14). The v0.1.1 manifest and tarball signature were verified
    from outside the app against the compiled key (minisign-verify =0.2.5; a one-byte-tampered tarball and a
    v0.1.0 signature over the v0.1.1 tarball both FAIL, as controls). The installed v0.1.0 executable, started
    with an isolated HOME, opened TLS connections to github.com and to release-assets.githubusercontent.com,
    which is consistent with fetching latest.json; the response, the verification and the banner were NOT
    seen. update.rs writes no log line, so a socket sample is the only trace. The four questions to ask are in
    11-RELEASE-EVIDENCE.md section 7. A one-line log of update_check's outcome would turn "reached the
    endpoint" into "parsed and verified" without a human; not added.

- id: D-REV-62
  phase: "11 - Ship It (plan 08, DIST-01 criterion 1)"
  truth: "What a first-time user actually sees when they open the unsigned v0.1.0 from Finder after downloading it in a browser, and whether the documented workaround gets them in. The bundle is ad-hoc linker-signed only (Signature=adhoc, TeamIdentifier not set), `codesign --verify --deep --strict` and `spctl --assess` both fail with 'code has no resources but signature indicates they must be present', and no ticket is stapled."
  status: open
  why_deferred: |
    Physical. The Gatekeeper dialog is drawn by the OS for a quarantined launch through LaunchServices; the
    quarantine attribute is set by a browser; the dialog needs a click and possibly an administrator password
    ('Open Anyway' in System Settings on this macOS). The 11-08 executor downloaded with curl (not
    quarantined) and started the executable directly, which is not subject to the check, so it proves the
    app runs and says nothing about the first-launch experience. A quarantined launch would also have
    put a modal alert, with 'Move to Trash' among its buttons, on the owner's screen.
  risk_if_wrong: |
    Moderate, first-run only (see D-REV-60). INFERENCE, unverified: because the bundle's resources are not
    sealed, the dialog is likely the 'is damaged and can't be opened' form rather than 'unidentified
    developer', and the old right-click-Open override may not exist on this macOS. If so the README and
    the release body should say how to get past it (xattr -cr, or ad-hoc re-signing, or Open Anyway)
    because the workaround D-REV-60 names may not work. Nobody has told a stranger yet.
  automatable: |
    PARTLY. `xattr -w com.apple.quarantine` on a copy and a LaunchServices launch can reproduce the dialog,
    and computer-use can read its text, but dismissing it safely needs the owner at the keyboard. Either way
    the exact dialog wording and the working workaround are the owner's to confirm in plan 11-21.
  update_11-08: "Raised by 11-08. See 11-RELEASE-EVIDENCE.md sections 3 and 4."

## Redemption protocol

At Phase 11, with an installed, usable build:

1. Re-read each item's `truth` and ask whether it is still a question. Several
   will have been answered by then by ordinary use — say so and close them.
2. Do every item marked `automatable: YES` as a test FIRST, before asking the
   owner anything. On the 2026-10-07 evidence that is most of them.
3. Only what survives both steps reaches the owner, in ONE pass.
4. Items whose `status` is `contradicted-by-measurement` or needs a decision are
   owner questions, not tests — group them separately and ask them as decisions.

- id: D-REV-11
  phase: "08.1 — Visual Polish (plan 14)"
  truth: "The shipped impeccable-finish-reviewer, run once against the approved comp and 08.1-UI-SPEC.md for surface group one (board and rail), raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): the reviewer ran again over regenerated captures and returned disposition fix, 8 findings, each fixed, rejected or recorded (11-FINISH-REVIEW.md, rows one-1 to one-8). It did not return ship, and the fixed group has had no third pass."
  update_08.1-14-closure: |
    The gate RAN. The independent reviewer returned `disposition: fix` with 8 material findings
    against the board group as built (the component capture, not the app shell). The closure pass
    is in 08.1-14-SUMMARY.md § Finish-review closure. Outcomes: 1 focus ring on click, FIXED;
    2 brand fill on Accept, FIXED; 3 epic sub-label, FIXED (roster now carries status and branch);
    4 selection weight, APPLIED AS FAR AS AA ALLOWS (the reviewer's 1.12 / 1.08 is not reachable,
    ceiling 1.074 / 1.040, asserted in contrast.test.ts); 5 task tail, APPLIED IN PART (assignee
    glyph; the criteria count and priority glyph are Phase 1 never-dropped fields, see D-REV-13);
    6 filter bar, FIXED (one Epic button); 7 clipped No-epic count, FIXED; 8 FIXTURE tags, FIXED.
    What this does NOT establish: that the fixed surface now passes the reviewer. It has not been
    re-run. The orchestrator can spawn the reviewer again against the regenerated captures.
    Also not reviewed, ever: the app shell (see D-REV-12).
  why_deferred: |
    The plan 14 executor has no subagent tool (Read, Write, Edit, Bash, Skill only), so it could not
    spawn the reviewer. It captured the surface (see below) and reviewed it itself against the
    reviewer's own check list, which is NOT the independent pass D-24 asks for.
    Captured, both schemes, in .impeccable/review/ (gitignored): board-group-built-{light,dark}-1440x900.png,
    board-group-built-{light,dark}-full.png and board-group-built-{light,dark}.html.
  risk_if_wrong: "Moderate. An independent reviewer may find fidelity gaps to the comp that the builder cannot see (the comp's lens toggle, the title block and the what-this-says paragraph are Phase 8.1 plan 10-11 surfaces and were not in this capture)."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer against those paths now; it needs no human. (Done once, 2026-10-08; a second pass over the fixes is the same call.)"
  update_11-17: "Plan 11-17, 2026-10-13. RAN AGAIN, as the entry said the orchestrator could. The executor has no Agent tool, so each run was a fresh `claude -p --agent impeccable:impeccable-finish-reviewer` process (Read, Glob, Grep only), not an in-thread review. Group one: disposition fix, 8 findings: 1 FIXED (the No epic caption is one line at 1440px, asserted in WebKit, red before), 1 REJECTED (the challenge row's inline kind label, quoting the craft floor's eyebrow ban), 6 RECORDED (four sit in files plan 11-18 owns or in its D-198.1; the rest, rail counts and the cue's size, go to D-196 via 11-21). The group did not pass; the findings did move to the board."

- id: D-REV-12
  phase: "08.1 — Visual Polish (plan 14 finish review)"
  truth: "The board group, mounted inside the real app shell (App.tsx and BoardView, not a test page of components), matches the approved comp: the masthead, the threadfin / epics / tasks subhead, the Group by Epic / Status lens toggle, the summary line, and the filter bar in its real place above the rack."
  status: "drained 2026-10-13 (plan 11-17): the board was captured mounted in the real shell and reviewed against the comp. It does NOT match. Findings app-shell-1 to 7 in 11-FINISH-REVIEW.md."
  why_deferred: |
    BOTH built captures (board-group-built-{light,dark}-*.png) are the test-harness page
    board/__tests__/browser/board-group.browser.test.tsx: the real rail, filter bar, epic header,
    challenge, task, band, quick-add and issues-lane components, composed by hand over the real
    board's exported data. They are not the app shell. So the independent reviewer could not see,
    and nobody has visually checked: (1) the comp's masthead (a `Mission Control` heading and the
    `threadfin . 13 epics . 906 tasks` subhead; the shipped source has no `Mission Control` heading
    at all, so this may be a missing surface, not only an unreviewed one); (2) the Group by
    Epic / Status lens toggle (A-02) as BoardView draws it; (3) BoardView's summary line;
    (4) how the filter bar, toggle and summary stack above the rack at the real window size;
    (5) the rack's own scroll container and virtualised rows (the capture lays rows out statically).
    Mounting BoardView needs the Tauri bridge to answer board_list, the epic aggregate, the
    proposal window and the forge flags with the real board's data and the three fixtures; the
    capture's bridge answers five reads today.
  risk_if_wrong: "Moderate. The group's parts were finished against the comp in isolation; the join between them (spacing between the toggle, the summary and the filter bar) and the masthead have never been compared to it."
  automatable: "YES. Extend board-group.browser.test.tsx to mount BoardView (or App) over a fuller bridge, capture it, and send the capture to the finish reviewer. It needs no human; it needs the bridge widened."
  update_11-17: "Plan 11-17, 2026-10-13. CAPTURED AND REVIEWED. `board-group.browser.test.tsx` now mounts `<App />` (which renders `AppShell`) over a Tauri bridge answering from the same real-board export, with two staged challenges reusing the group capture's fixture, and writes `board-shell-built-{scheme}-1440x900`. Reviewer disposition: fix, 7 findings, 2 high: (1) NO masthead, no `Mission Control` heading, subhead or rule, a missing signature element (already recorded as UI-SPEC Disagrees 4 and DESIGN.md Contract versus the built world 2; this is the first look at it in the real shell); (2) the lens toggle has its own band, where DESIGN.md and the comp say one controls row. Both are owner decisions, RECORDED for D-196 via 11-21, not fixed: adding a masthead adds a surface and a data contract the owner has not decided to ship. The summary line's placement and wording (medium) and the rail/title-block join (medium) follow from them. 1 REJECTED (Plan fan-out on every epic row is the shipped Phase 9 dispatch cell)."

- id: D-REV-13
  phase: "08.1 — Visual Polish (plan 14 finish review)"
  truth: "A task row's tail should print nothing for a zero criteria count (0/0) or for no priority, as the finish reviewer asks, extending A-03's rule for the change cue."
  status: closed (2026-10-13, plan 11-18, D-198.1)
  why_deferred: |
    The reviewer found fourteen identical four-mark tails (estimate, assignee, 0/0, priority bars)
    flattening the change cue. Plan 14's closure removed the unassigned glyph (not a contract field)
    and stopped there. The other two are Phase 1 contract: 01-UI-SPEC § Row Anatomy lists the
    priority glyph and the criteria checked/total as NEVER dropped at any supported width, and
    D-08 keeps the count "visible wherever the item appears", with a State Inventory row
    ("zero-one-many") naming it always visible. No 8.1 amendment lifts either, and A-03's rule
    covers only the change cue. Printing nothing for them is therefore an amendment (an A-07), not
    a finish edit.
  risk_if_wrong: "Low. Cosmetic density, against a deliberate contract."
  needs: "An owner call: amend Row Anatomy so a zero count and 'No priority' render nothing (the count would then be absent exactly when the Done warning cannot fire, D-08), or keep them as the contract has them."
  automatable: "No. It is a design and contract decision. Once made, the edit and its tests are small."
  update_11-18: "Plan 11-18, 2026-10-13. CLOSED by D-198.1. BoardRow.tsx prints no criteria count at 0/0 and no priority glyph at No priority; a real count and a real priority still print (row-tail.test.tsx, both cases). 01-UI-SPEC § Row Anatomy's 'never dropped' sentence is amended with the D-198 citation, the State Inventory and zero-one-many rows follow."

- id: D-REV-14
  phase: "08.1 — Visual Polish (plan 15)"
  truth: "The shipped impeccable-finish-reviewer, run against the approved item-detail comp and 08.1-UI-SPEC.md for surface group two (the detail panel, the command palette, the five pickers), raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): the reviewer ran again, disposition fix, 8 findings (rows two-1 to two-8), 2 rejected with quotes, 6 recorded. No third pass."
  why_deferred: |
    The gate RAN on 2026-10-08, spawned by the orchestrator (the plan 15 executor could not spawn it). It
    returned `disposition: fix` with 8 material findings. All eight were applied or answered in the
    "Finish-review closure" section of 08.1-15-SUMMARY.md (commits 5f3ae8b, a64c8ab, eb1a962); findings 4
    and 5 were global dark-token fixes applied first. THE REVIEWER HAS NOT BEEN RE-RUN ON THE FIXES: what
    is recorded is that the findings were addressed and tested, not that the fixed group passes the
    reviewer. The same dark tokens are inherited by plans 17 to 19. Screenshots of the fixed group are in
    .impeccable/review/ (gitignored): detail-group-built-{light,dark}-{panel,palette,picker}-1440x900.png
    and the rendered HTML beside them; regenerate with `npm run test:browser` and
    `npm run test:browser:dark`. The capture is a component page over the real THRE-58's data with one
    FIXTURE run, not the app shell (see D-REV-12 for the same gap on group one).
  risk_if_wrong: "Low to moderate. The property grid is restored only as far as data exists (Status, Priority, Estimate at the top; Worktree and Changes as rows in their own sections, not one grid); the comp's `THRE-10` parent key and the Worktree row inside one grid were not rebuilt. Other `ui-monospace` uses in the panel (git shas, forge CLI names, the run's session line) stay under the Phase 2 Mono contract."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer again against those paths; it needs no human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN AGAIN. Group two: disposition fix, 8 findings. REJECTED 2: two lead edges in one panel (DESIGN.md names Watch Live in Runs as a lead of its own region) and two pencils at once (the CSS reveals on hover and on the cursor row independently, by design). RECORDED 6, among them the title scale (15px vs the comp's 20px, an owner call), status and priority marks missing from the panel's value column, and a path ellipsis gap whose proposed remedy (`text-align`) was tested in WebKit and does not work: that claim did not survive. Not re-reviewed."

- id: D-REV-15
  phase: "08.1 — Visual Polish (plan 16)"
  truth: "The shipped impeccable-finish-reviewer, run once against the approved review comp and 08.1-UI-SPEC.md for surface group three (the review surface, the criteria rail, the file diff, the merge confirm sheet, the epic request sheet), raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): the reviewer ran again, disposition fix, 6 findings (rows three-1 to three-6): 1 fixed, 5 recorded, 3 of them high. No third pass."
  why_deferred: |
    The plan 16 executor has no subagent tool (Read, Write, Edit, Bash, Skill only), so it could not
    spawn the reviewer; the same limit as D-REV-11 and D-REV-14. It captured the group in WebKit in
    both schemes at 1440x900 and reviewed the captures itself, which is NOT the independent pass D-24
    asks for. Captured in .impeccable/review/ (gitignored):
    review-group-built-{light,dark}-surface-1440x900.png,
    review-group-built-{light,dark}-merge-sheet-1440x900.png,
    review-group-built-{light,dark}-merge-conflict-1440x900.png, and the rendered HTML beside them
    (review-group-built-*.html, review-group-merge-sheet-*.html, review-group-merge-conflict-*.html).
    Regenerate with `npm run test:browser` and `npm run test:browser:dark`. Compare against
    review-light.png / review-dark.png. The content is the real THRE-58's seeded criteria and the real
    README.md diff, plus the comp's FIXTURE CriteriaRail.tsx diff and a FIXTURE conflicted precheck.
    It is a component page, not the app shell. Known, deliberate differences from the comp: the comp
    draws the primary "Merge into epic" as an ink FILL; the owner's 2026-10-08 decision (no filled
    primary buttons) governs, so it is drawn with a control edge. The comp's page header (title,
    commit ref) and its "Request changes" button are not features of this surface.
    GATE RAN, 2026-10-08: the orchestrator spawned the shipped impeccable-finish-reviewer, which the plan
    executor could not. It returned `disposition: fix`. 7 findings were applied in a gap-closure pass
    (a800555); the owner holds one item as a decision, the missing "Request changes" decline path, and nothing here adds it. THE REVIEWER HAS NOT BEEN RE-RUN ON THE FIXES: what is recorded is that each
    finding was addressed and tested (jsdom plus the three WebKit arms), not that the fixed group passes the
    reviewer. The captures named above were regenerated by that pass and now show the FIXED group; the
    pre-fix captures no longer exist.
  risk_if_wrong: "Moderate. The join between the three panes and the file-list row (a long path wraps its extension onto a second line at the 30 percent column) has only been judged by its builder."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer again against those paths now, over the fixed group; it needs no human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN AGAIN. Group three: disposition fix, 6 findings. FIXED 1: the merge sheet title no longer breaks inside a branch name (each name an unbreakable unit, WebKit assertion). RECORDED 5, three of them HIGH and all for the owner or D-196: the pane order (criteria first against the comp's files, diff, criteria; a Phase 8 layout no amendment covers), the 380px file column squeezing the diff, and no +/- sign column on the diff (an accessibility-flavoured gap; the fix spans `FileDiff.tsx` and `review.css`, which plan 11-18 owns). The epic request sheet has no capture and was not reviewed."

- id: D-REV-16
  phase: "08.1 — Visual Polish (plan 17)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group four (the live session surface, its feed, the permission request card, the raw log, the launch sheet), raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): the reviewer ran again against the contract alone (no comp), disposition fix, 8 findings (rows four-1 to four-8), 2 rejected, 6 recorded. The raw log was never captured and was not reviewed."
  why_deferred: |
    The plan 17 executor has no subagent tool (Read, Write, Edit, Bash, Skill only), so it could not
    spawn the reviewer; the same limit as D-REV-11, D-REV-14 and D-REV-15. It captured the group in WebKit
    in both schemes at 1440x900 and reviewed the captures itself, which is NOT the independent pass D-24
    asks for. THE REVIEWER MUST BE TOLD that no comp exists for these surfaces and that it is reviewing
    against the contract (colour and token roles, radius language, type scale, motion contract, the
    selection rule, the overlay rule, the state inventory), not against an image. Captured in
    .impeccable/review/ (gitignored): session-group-built-{light,dark}-session-1440x900.png (running, a feed,
    the pulse, a routine permission request pending), session-group-built-{light,dark}-permission-destructive-1440x900.png,
    session-group-built-{light,dark}-finished-1440x900.png (a failed run, Review changes leading) and
    session-group-built-{light,dark}-launch-sheet-1440x900.png (the launch sheet open over the session), plus
    the rendered HTML beside each (session-group-*.html). Regenerate with `npm run test:browser` and
    `npm run test:browser:dark`, then `git checkout --` the Phase 8 UAT screenshot directory. The content is a
    component page: THRE-58's real key, title, epic, branch, base and three criteria from comp-data.json, but
    the real board has NO live run, so every feed row, both permission requests and the failed run's detail
    are FIXTURES, each labelled on the page. Not the app shell (see D-REV-12 for the same gap on group one).
    GATE RAN, 2026-10-08: the orchestrator spawned the shipped impeccable-finish-reviewer, which the plan
    executor could not. It returned `disposition: fix`. 7 findings were applied in a gap-closure pass
    (bf94b29); the owner holds one item as a decision, marking Bypass Permissions as destructive, and nothing here touches it. THE REVIEWER HAS NOT BEEN RE-RUN ON THE FIXES: what is recorded is that each
    finding was addressed and tested (jsdom plus the three WebKit arms), not that the fixed group passes the
    reviewer. The captures named above were regenerated by that pass and now show the FIXED group; the
    pre-fix captures no longer exist.
  risk_if_wrong: "Moderate. The reviewer may find that the header (a back link, a title, a status, a cost strip and up to four actions in one row) reads as crowded; that the three ink-bordered controls in the open launch sheet (the focused field, the chosen mode, Start Work) compete; or that the 10px system-notice role is too small. The first two were judged by their builder only."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer again against those paths now, over the fixed group; it needs no human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN AGAIN, told that no comp exists. Group four: disposition fix, 8 findings. The header did NOT read as crowded and the three ink controls in the launch sheet were judged a real but rejected-as-contract issue (the 2px ink focus ring is a decided, tested treatment). The one HIGH finding: the header title is the literal word `Session` and never names the task it serves, against the Core Value; it needs a read the surface does not have (no command returns a task by id), RECORDED for D-196 as high. 2 REJECTED (the focus ring; the raw JSON on the permission card, which a gate should show). 6 RECORDED, including developer turns in the brand, which D-199 does NOT widen to and which sits in `FeedRow.tsx` (plan 11-18's): flagged to 11-18."

- id: D-REV-17
  phase: "08.1 — Visual Polish (plan 18)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group five (settings and its permission-rules table, the triage surface, the authoring tray with its rows and amend editor, the published legend, and the done warning's overlay tier), raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): the reviewer ran again, plus a follow-up on the permission-rules table it could not see; disposition fix twice, 13 findings (rows five-1 to five-9 and five-rules-1 to 5): 2 fixed, 2 rejected, 9 recorded. No third pass."
  why_deferred: |
    The plan 18 executor has no subagent tool (Read, Write, Edit, Bash, Skill only), so it could not
    spawn the reviewer; the same limit as D-REV-11, D-REV-14, D-REV-15 and D-REV-16. It captured the group
    in WebKit in both schemes at 1440x900 and reviewed the captures itself, which is NOT the independent pass
    D-24 asks for. THE REVIEWER MUST BE TOLD that no comp exists for these surfaces and that it is reviewing
    against the contract (colour and token roles, radius language, type scale, motion contract, the
    selection rule, the overlay rule, the state inventory), not against an image. Captured in
    .impeccable/review/ (gitignored): admin-group-built-{light,dark}-settings-1440x900.png (a populated
    permission-rules table), admin-group-built-{light,dark}-triage-1440x900.png and
    admin-group-built-{light,dark}-triage-merge-1440x900.png (the merge picker open),
    admin-group-built-{light,dark}-tray-1440x900.png (the tray with the amend editor open),
    admin-group-built-{light,dark}-legend-1440x900.png (embedded) and
    admin-group-built-{light,dark}-legend-dialog-1440x900.png (the overlay), plus the rendered HTML beside
    each (admin-group-built-*.html). Regenerate with `npm run test:browser` and `npm run test:browser:dark`,
    then `git checkout --` the Phase 8 UAT screenshot directory. The project and the epics are the real
    board's (threadfin, THRE); the real board holds NO authoring proposals and NO permission rules, so every
    proposal and every rule is a FIXTURE, labelled on the page. They are component pages, not the app shell.
    ALSO FOR THE REVIEWER: whether the proposal row, which is the board's challenge row's twin, reads as the
    same object in the tray and the triage surface (the tray rows were restyled to match; the challenge row
    itself was not touched), and whether the wall of drawn buttons on every triage row is too heavy.
    GATE RAN, 2026-10-08: the orchestrator spawned the shipped impeccable-finish-reviewer, which the plan
    executor could not. It returned `disposition: fix`. 10 findings were applied in a gap-closure pass
    (00481eb and d2721cd); none of the owner-held items falls in this group's files. THE REVIEWER HAS NOT BEEN RE-RUN ON THE FIXES: what is recorded is that each
    finding was addressed and tested (jsdom plus the three WebKit arms), not that the fixed group passes the
    reviewer. The captures named above were regenerated by that pass and now show the FIXED group; the
    pre-fix captures no longer exist.
  risk_if_wrong: "Moderate. The reviewer may find that a triage row's six drawn actions plus a reject-reason field read as a wall; that the chosen segment (an ink edge and a 2px foot rule, no weight change) is too quiet next to its neighbours at a glance; or that the legend's developer-voice copy is a problem (recorded in deferred-items.md). The first two were judged by their builder only."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer again against those paths now, over the fixed group; it needs no human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN AGAIN, against the contract alone. Group five reported that BOTH settings captures cut off at the Permission Rules heading, so the table was never seen: a capture was added (`admin-group-built-{scheme}-settings-rules-1440x900`) and a follow-up run reviewed it. FIXED 2 in `PermissionRulesTable.tsx` with jsdom and WebKit assertions: an ellipsized tool name (a granted authority) now carries its full text as a title, and Revoke is disabled while its write is in flight with a failure named in place. REJECTED 2 (legend priority samples: every legend mark sits in the swatch; Revoke's accessible name: its copy is exactly Revoke under test). RECORDED 9, two HIGH: the proposal row stacks an uppercase kind label above its title where the challenge row it twins sets it inline (and the group-one reviewer contradicts removing the inline form), and the triage wall of sixteen boxed buttons (owner call). The reviewer did say the wall is too heavy."

- id: D-REV-18
  phase: "08.1 — Visual Polish (plan 19)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group six (the first-run state, the unreachable project, the registration flow, and the delete, done-warning and orphan-recovery confirmations), raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): the reviewer ran again against the contract alone, disposition fix, 5 findings (rows six-1 to six-5): 2 fixed, 3 recorded. No third pass."
  why_deferred: |
    The plan 19 executor has no subagent tool (Read, Write, Edit, Bash, Skill only), so it could not
    spawn the reviewer; the same limit as D-REV-11 and D-REV-14 to D-REV-17. It captured the group in WebKit
    in both schemes at 1440x900 and looked at the captures itself, which is NOT the independent pass D-24 asks
    for. THE REVIEWER MUST BE TOLD that no comp exists for these surfaces and that it is reviewing against the
    contract (colour and token roles, radius language, type scale, motion contract, the overlay rule, the state
    inventory), not against an image. Captured in .impeccable/review/ (gitignored):
    states-group-built-{light,dark}-first-run-1440x900.png, -first-run-confirm-, -unreachable-,
    -delete-confirm- (over the real board), -done-warning- (over the real board) and -recovery- (over the real
    board), plus rendered HTML beside each (states-group-built-*.html). Regenerate with `npm run test:browser`
    and `npm run test:browser:dark`, then `git checkout --` the Phase 8 UAT screenshot directory. The unreachable
    project and the board behind both confirmations are the real board's own; the real board has no live orphan,
    so the three recovery runs are FIXTURES, each labelled in its title. They are component pages, not the app shell.
    ALSO FOR THE REVIEWER: whether a 2px destructive edge plus icon reads as the section's lead without a fill
    (Delete and Kill All were red fills and are now text and edge only), whether the first-run and unreachable
    states are too sparse at 1440x900 with nothing but a heading, a paragraph and one button, and whether the
    unreachable copy is true for the real duplicate registration (see deferred-items.md).
    GATE RAN, 2026-10-08: the orchestrator spawned the shipped impeccable-finish-reviewer, which the plan
    executor could not. It returned `disposition: fix`. 6 findings were applied in a gap-closure pass
    (0f2c30f); two items are held by the owner (a non-destructive exit for the orphan modal; the first-run app-icon tile) and were not touched. ONE finding is DECLINED and queued: "Remove Project" has no backend and is a decision (soft-hide or delete), see deferred-items.md. THE REVIEWER HAS NOT BEEN RE-RUN ON THE FIXES: what is recorded is that each
    finding was addressed and tested (jsdom plus the three WebKit arms), not that the fixed group passes the
    reviewer. The captures named above were regenerated by that pass and now show the FIXED group; the
    pre-fix captures no longer exist.
  risk_if_wrong: "Moderate. The reviewer may find that a destructive action without a fill under-signals at a glance on a delete confirmation, or that the full-window states look unfinished at that size. Both were judged by their builder only. The scrim, the dialog tier and the blocking layer are measured in WebKit, not judged."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer again against those paths now, over the fixed group; it needs no human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN AGAIN, told that no comp exists. Group six: disposition fix, 5 findings. It judged that a 2px destructive edge plus an icon DOES read as the section's lead without a fill, and that the sparse first-run state is acceptable. FIXED 2: the unreachable state draws its repo path in mono as its own element (the Copywriting Contract sentence is unchanged) and the orphan modal's consequence line now precedes the choices it bears on, both asserted in WebKit. RECORDED 3 (one is the recovery spinner's brand colour, which D-199 makes permitted)."

- id: D-REV-19
  phase: "08.1 — Visual Polish (plan 21)"
  truth: "The shipped impeccable-finish-reviewer, run once against the approved review comp (comps/review.html, .action-row) and 08.1-UI-SPEC.md for the CHANGED foot of the review surface's criteria column (the `Review decision` group: Request changes beside Merge, the sent-back, nothing-unchecked and no-criteria notes, the could-not-send alert) and for the Review feedback section the launch sheet gained, raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): it was NOT RUN; it ran, disposition fix, 3 findings (rows review-foot-1 to 4): 1 fixed, 2 recorded; three alternate foot states are still uncaptured."
  why_deferred: |
    The plan 21 executor has no subagent tool, so it could not spawn the reviewer, and the orchestrator
    could not run it for this plan either: the run stalled (watchdog, no progress for 600s) between
    implementing Task 3 and verifying it, and was recovered and closed out without the reviewer pass. The
    mechanical gate DID run and reports `[]` over packages/desktop/src/review/ and on LaunchSheet.tsx, and
    the foot's geometry, paint and contrast are measured in WebKit in both schemes; that is NOT the
    independent pass D-24 asks for. Captures of the changed surface are in .impeccable/review/
    (gitignored): review-group-built-{light,dark}-surface-1440x900.png (the foot with the decline ready)
    and -decision-sent-1440x900.png (after Request changes was pressed), with rendered HTML beside each
    (review-group-built-{light,dark}.html). Regenerate with `npm run test:browser` and
    `npm run test:browser:dark`, then `git checkout --` the Phase 8 UAT screenshot directory
    (.planning/phases/08-review-and-merge-inside-flywheel/uat-screenshots/), which the browser arms overwrite.
    THE REVIEWER MUST BE TOLD that the title bar no longer holds Merge (it moved into the foot, owner
    decision A-08(a)), that the comp fills its primary and the owner's no-filled-buttons rule governs, and
    that Merge keeps the 2px ink lead edge while Request changes is a 1px hairline secondary by design
    (plan 16's closure gave Merge the lead after a reviewer found it indistinguishable from the scope
    toggles). ALSO FOR THE REVIEWER: whether the foot reads as the end of the attestation or as a stray
    block under a short rail; whether a muted 11px consequence line ("Request changes sends 3 unchecked
    criteria back to the agent.") is enough to stand in for a confirm sheet; whether "Sent back to the
    agent: N unchecked criteria. They go into the next session's briefing." reads as a state or as a
    toast; and whether the Review feedback section in the launch sheet sits correctly between Warnings
    and Epic. The captures are of a fixture task (THRE-58's three criteria, in_progress), not the app shell.
  risk_if_wrong: "Moderate. The foot is the surface where this product's core value becomes a daily act, and it was judged by its builder and by WebKit measurements only. The reviewer may find the secondary too quiet beside the lead, the foot too sparse under a short rail, or the sent-back note indistinct from a muted label."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer now against those paths and the regenerated captures; it needs no human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN FOR THE FIRST TIME. The launch sheet's Review feedback section had no capture at all; one was added (`session-group-built-{scheme}-launch-sheet-feedback-*`, with a drift warning so the section sits between Warnings and Epic). Reviewer: the foot reads as the end of the attestation and not as a stray block, the consequence line is enough without a confirm sheet, and the sent-back note reads as a state; disposition fix on three points: Merge's label dropped the comp's `into epic` (RECORDED, an owner copy call), the sent-back note shares the hint's muted style (RECORDED, `review.css` is plan 11-18's), and the capture fixture paraphrased a criterion (FIXED: it now takes the real criteria word for word, asserted). NOT captured, so not reviewed: the nothing-unchecked note, the no-criteria note and the could-not-send alert."

- id: D-REV-20
  phase: "08.1 — Visual Polish (plan 20, handed forward from plan 02)"
  truth: "The installed Flywheel application shows the new HighKnow mark in the Dock, in Finder, and in the native About panel (SC1, as the OS paints it)."
  status: open
  why_deferred: |
    Physical: the Dock and LaunchServices icon caches are operating-system state that only a reinstalled
    bundle plus a cache refresh change, and no WebDriver or vitest arm can observe the macOS Dock. What IS
    asserted: icons.test.ts reads every bundle.icon artifact and checks it is not the scaffold blob, has the
    right dimensions and colour type, and that icon.png's opaque artwork spans 824 of 1024 (added in 08.1-20).
    That proves the bundle contents. It does not prove what the OS paints. SC1 is closed on the contents.
  risk_if_wrong: "The owner sees the scaffold icon on an installed build despite green tests."
  automatable: "PARTLY. Bundle contents: already automated. After `tauri build`, comparing the icns inside the .app to src-tauri/icons/icon.icns is YES (no human, needs the built bundle, Phase 11). What the Dock paints: an OS-level screenshot of the Dock is YES with computer-use against an installed build; nothing earlier than an installed build can ask it."

- id: D-REV-21
  phase: "08.1 — Visual Polish (plan 20, handed forward from plan 02)"
  truth: "The macOS icon's inset margin reads correctly beside other application icons in the Dock."
  status: open
  why_deferred: |
    Physical: human aesthetic judgement, made against other applications' icons in a real Dock. The 824-of-1024
    figure is the commonly cited macOS icon grid (08.1-RESEARCH A1), a recorded assumption and not an Apple
    requirement. 08.1-20 made the geometry evidence: icons.test.ts now measures the shipped icon.png and
    asserts its opaque artwork is 412 of 512, centred. The geometry is therefore not the open question.
  risk_if_wrong: "Cosmetic: the icon looks slightly large or small beside its neighbours. Regenerating is one command (edit the 100 / 824 in app-icon.svg and re-run `tauri icon`)."
  automatable: "No for 'looks right beside neighbours' (aesthetic). The margin figure itself is already asserted."

- id: D-REV-22
  phase: "08.1 — Visual Polish (plan 20)"
  truth: "Dark mode actually activates in the Tauri shell's web view: with macOS set to Dark, the installed app paints the dark token block, and with macOS set to Light it paints the light block."
  status: open
  why_deferred: |
    Physical: there is no WebDriver for WKWebView on macOS, and the appearance is operating-system state.
    Recorded as assumption A2 in 08.1-RESEARCH ("[ASSUMED] — not run in WKWebView this session") and never run since. What IS proven: the contrast tests prove the
    VALUES in each block, and the dark browser arm (`test:browser:dark`, 63 tests) proves that a WebKit engine
    emulating prefers-color-scheme: dark selects the dark block and paints it legibly. What is NOT proven:
    that Tauri's WKWebView reports the OS appearance as prefers-color-scheme. Evidence for it, not proof:
    tauri.conf.json sets no window `theme`, and no Rust source calls set_theme or a window-builder theme (grepped 2026-10-09). The recorded fallback if it fails is a `data-theme` attribute set from Tauri's window theme API.
    Playwright's WebKit emulating a scheme is not the shell.
  risk_if_wrong: "High for the phase's headline claim: the owner could run the installed app in Dark and get the light world (or the reverse), and every dark-mode value in this phase would be unreachable."
  automatable: "YES, against an installed or dev build, at Phase 11: set the system appearance with `defaults write -g AppleInterfaceStyle Dark` (or the System Settings toggle), launch, and take an OS-level screenshot with computer-use; compare the painted ground to #0a0a0a / #ffffff. No human judgement is needed, only a build. Cheaper partial now: none that touches the real web view."

- id: D-REV-23
  phase: "08.1 — Visual Polish (plan 20, from plan 13)"
  truth: "Expanding a status group reads as growth to a human eye (a top-down wipe with the rows below travelling), in the packaged app. ROADMAP success criterion 3 says 'animates its height'; the shipped technique animates no height."
  status: open
  why_deferred: |
    Physical: human aesthetic judgement of a 180ms transition. Plan 13 replaced its own planned technique
    after seeing text overprint for about two frames in WebKit, and the browser test now polls getAnimations()
    for a real CSSTransition on the travelling row (and none under reduced motion). The owner watched the
    shipped CSS in comps/motion.html on 2026-10-08, a page and not the packaged app, and confirmed the
    durations. That is an observation of the keyframes; no record says he judged that a group expansion
    reads as growth. SC3's wording ('animates its height', 'fades/scales') was not amended; the contract
    (08.1-UI-SPEC.md Motion) decided otherwise, and the owner has not been recorded ruling on the word.
  risk_if_wrong: "Low to moderate: an expansion that reads as a pop or a flicker instead of growth; a cosmetic fix in motion.css. Separately, SC3's literal text is not what shipped."
  automatable: "PARTLY. Monotonic reveal and no overprint can be asserted in WebKit by sampling the entering row's clip-path at fixed times: YES, one test (not written here; the existing test proves a transition exists, not its shape). 'Reads as growth' is human."
  update_11-13: "Shape CLOSED, and it caught a real defect: sampling the animations at fixed times showed the wipe STEPPED (reveal [2,2,5,6] rows, none mid-wipe) because the row-enter keyframe had no `to`, and WebKit does not interpolate inset() with `none`. Fixed in motion.css; now exactly one row is mid-wipe at each mid sample, reveal is monotonic and top-down, and the wipe front never passes the travelling row below. STILL HUMAN, physical reason = aesthetic judgement: 'reads as growth'. Wording question for the owner, unchanged: ROADMAP SC3 says 'animates its height'; the shipped technique animates no height (clip-path on the new rows plus a transform on the rows below)."

- id: D-REV-24
  phase: "08.1 — Visual Polish (plan 20, success criterion 0)"
  truth: "The owner looks at the BUILT board, with real data on it, in the running app, and judges it bold and modern rather than 'a very old app' (SC0 as worded)."
  status: open
  why_deferred: |
    Physical: this is a human aesthetic judgement, and it is the one the phase exists for. What happened:
    the owner ADOPTED the Mission Control direction wholesale on 2026-10-07 after viewing six code-rendered
    comps (not image-generated), told beforehand that several values were FIXTURE and that adoption was
    one-way. He accepted three caveats: the craft detector had not run, the roster's rhythm was untested
    (seed data is uniform, nearly every epic reads 15 of 60), and the roster's lead row is a junk epic.
    That is a judgement of the comps. No record shows him viewing the built board; every built capture is
    a harness page of real components, not the app shell (D-REV-12), and the comp's masthead is absent from
    the source. SC0 is therefore closed on the adoption of the direction, and the built product has not been
    judged against the owner's own words.
  risk_if_wrong: "High and specific to this phase's purpose. The built world could have drifted from the comps through twenty-one plans without the person the phase is for having looked at it."
  automatable: "No for the judgement itself. Getting the owner to the right screen is automatable: a build with real data and the roster in the epic lens, Light and Dark, screenshots attached to the question."

- id: D-REV-25
  phase: "08.1 — Visual Polish (plan 20, from plan 04 caveat c)"
  truth: "The home surface's strongest position does not hold a junk epic. Today the roster's lead row is `test`, 0 of 1, and the 'No epic' bucket holds all 181 in-review tasks, which is the entire review queue."
  status: open
  why_deferred: |
    Not a verification item: a data defect on the real board that the roster inherits. The owner adopted the
    direction knowing it (plan 04). Plan 04 asked plan 20 to register it. Neither the epic nor the no-epic
    bucket is a product fault, but the roster's first row is the first thing the owner sees.
  risk_if_wrong: "Moderate: the home surface leads with junk, and the review queue has no home of its own in the epic lens (the status lens, A-02, is the sweep)."
  automatable: "YES to detect (one query: epics whose title is `test` or whose total is 1 with no criteria). The remedy is a data decision for the owner (delete the epic; assign the 181 tasks), best drained through Flywheel itself."

- id: D-REV-26
  phase: "08.1 — Visual Polish (plan 20)"
  truth: "The shipped impeccable-finish-reviewer, re-run once over each of the six fixed surface groups, the changed foot of the review surface (plan 21) and the app shell, raises nothing material that is not fixed or recorded."
  status: "drained 2026-10-13 (plan 11-17): it was NOT RUN; it ran as eight groups plus a follow-up, every one disposition fix, 58 findings in 11-FINISH-REVIEW.md: 8 fixed, 8 rejected with quotes, 45 recorded (9 high). Nothing in Phase 8.1 passes an independent review after its fixes."
  why_deferred: |
    No physical reason. This is an unexecuted automated step, queued only because the plan 20 executor has no
    subagent tool (Read, Write, Edit, Bash, Skill) and so could not spawn the reviewer or the documenter. It
    duplicates D-REV-11 and D-REV-14 to D-REV-19 deliberately, as one batch. Until it is run, nothing in
    Phase 8.1 may be described as passing an independent review after its fixes.
  risk_if_wrong: "Moderate and cumulative: seven groups were finished by their builders and corrected by findings, and the corrections are unreviewed. The app shell has never been reviewed at all (D-REV-12)."
  automatable: "YES. Capture the groups (`npm run test:browser`, `npm run test:browser:dark`, then `git checkout --` the Phase 8 UAT screenshot directory), widen the capture to mount BoardView/App (D-REV-12), and spawn impeccable-finish-reviewer once per group from the orchestrator. No human."
  update_11-17: "Plan 11-17, 2026-10-13. RAN FOR THE FIRST TIME, as nine runs (six surface groups, the review foot, the app shell, and the permission-rules follow-up). The captures were regenerated first by green `test:browser` and `test:browser:dark`. NONE returned `ship`: 58 material fixes, 61 rows with the three coverage gaps. 8 FIXED with assertions, 8 REJECTED with the contract sentence quoted, 45 RECORDED (15 addressed to plan 11-18, 35 for D-196 via 11-21; some are both). The nine HIGH findings are the headline and are all owner decisions or larger than this plan: no masthead and a split controls row in the shell, the review surface's pane order and 380px file column, no +/- sign on the diff, the session header not naming its task, the proposal row's stacked kind label, the triage button wall, and the rail's missing counts. The reviewers judged the pre-fix captures; the fixed items are test-proven, not reviewer-approved."

- id: D-REV-27
  phase: "08.1 — Visual Polish (plan 20, from plan 10 and the A-04 gate)"
  truth: "Under the has-worktree chip the epic lens narrows its headers from 13 epics to the 5 that own live work, as the owner chose in A-04 (`any-child`)."
  status: contradicted-by-measurement
  why_deferred: |
    Escalated to the owner by the orchestrator on 2026-10-08 and left open; no plan owns it. As shipped, the
    epic lens renders every roster epic with the aggregate's unfiltered count and filters only the rows
    inside, which is behaviourally the `always` reading the owner explicitly rejected ('would leave 8 of the
    13 as empty shells'). The core SQL clause is correct and verified on the live database. The gap is that
    the epic aggregate is board-wide by plan 05's design, so no header narrowing exists. See deferred-items.md.
  risk_if_wrong: "Real: a decision the owner took on a blocking-human gate is not what shipped, and the contract (A-04) says otherwise."
  needs: "A small plan: a filter-aware aggregate in the core, or a core-side 'epics matching this filter' read. Then a WebKit test over the real chip."
  automatable: "YES once built: a jsdom or browser test that turns the chip on and asserts 5 headers. The decision is already made; this is an implementation gap, not a question."
  update_11-13: "IMPLEMENTED and asserted. The epic lens now narrows its headers under the chip (useFilteredEpics: one unscoped board_list/board_search through the same filter; headers = epic rows the core returned plus the epics of matching tasks; fails open while pending and when the answer fills its 500-row limit). lens-narrowing.browser.test.tsx asserts the narrowed set against the fixture's own worktree rows and the restore on chip-off. Honest limits: (1) header COUNTS remain board-wide, the aggregate is still not filter-aware, so a narrowed header can read '15 of 60'; (2) the core's FILTER_WHERE is stood in for by a fake in this test (the SQL itself is proved in packages/core/tests/search_filter.rs), so the 13-to-5 on the live board is not re-observed; automatable at Phase 11 against a real build."

- id: D-REV-28
  phase: "08.1 — Visual Polish (plan 20)"
  truth: "The brand carries progress, the commits-ahead count and the focus ring, and nothing else (08.1-UI-SPEC.md, the brand rule's four permitted uses)."
  status: closed (2026-10-13, plan 11-18, D-199) — one residue open: the developer's turn
  why_deferred: |
    The build uses the brand in more places than the rule lists, and a new use needs an amendment. Open
    already as an owner question: the running status, the live authoring stage and the developer's own turn
    in the feed. Found by 08.1-20's grep and not previously recorded: brand-coloured links and text actions in
    ForgeSection, ActivityTrail, TriageLane, EpicRequestSheet and the orphan modal, the global input focus
    ring on inputs outside the finished groups, and review/review.css `.review-anchor-widget`, which draws a
    2px BRAND left border on a block under a diff line. That last one is not covered by A-06 (A-06 decided
    neutral ink, not an accent colour) and is the pattern the craft floor's coloured side-border ban names.
  risk_if_wrong: "Low to moderate: the brand is diluted and the rule is no longer one a reviewer can enforce. The anchor widget is a plain floor violation with a one-line fix once the owner chooses (ink or control edge)."
  needs: "An owner call: add 'text links, run status and stage, the developer's turn' to the permitted list by amendment, or move them to ink with weight. Separately, the anchor widget's border."
  automatable: "YES to enforce once decided: a grep or computed-style test over the brand tokens' consumers, like the one that pins no-fill buttons. The decision is not automatable."
  update_11-18: "Plan 11-18, 2026-10-13. CLOSED by D-199, with a CORRECTION to this entry: .review-anchor-widget's brand colour was already gone (A-08/D-12 made its border var(--text-primary-rack)); what remained and what was fixed is the SHAPE, a 2px side stripe, now the neutral control-edge. 08.1-UI-SPEC § The brand rule lists seven uses, and theme/__tests__/brand-rule.test.ts enforces them from the shipped bytes (one allowlist, spec-phrase check, side-border ban). RESIDUE, deliberately open: the developer's turn (FeedRow.tsx) is not in D-199, and the test found two more existing uses nobody had listed, the pending-proposal count on an epic row and ::selection. All three are recorded in the spec as existing uses plan 11-18 did NOT decide, each open to the owner to reverse. File the developer's turn at 11-21 as an owner decision: moving it to ink loses the only channel that tells the two speakers apart."

- id: D-REV-29
  phase: "08.1 — Visual Polish (plan 20, from plan 19)"
  truth: "A project whose repository is gone for good can be removed from Flywheel, and a duplicate registration can be cleared."
  status: needs-owner-decision
  why_deferred: |
    The group-six reviewer asked for a secondary 'Remove Project' on the unreachable surface. It was declined
    in plan 19: no backend exists, and the decision (soft-hide, or delete the project's board) is the owner's.
    The real board's second project is `unreachable` and is a DUPLICATE registration of the active one (same
    name, same THRE prefix, same repo_path), which the surface has no way out of. See deferred-items.md.
  risk_if_wrong: "Moderate: a surface that says 'Locate Project...' to a user who cannot. Data stays; the defect is a dead end."
  needs: "An owner call between soft-hide and delete, then a command, a confirmation and a test."
  automatable: "YES once decided (core command test plus the surface). The decision is not automatable."

- id: D-REV-30
  phase: "08.1 — Visual Polish (plan 20)"
  truth: "Row Anatomy and the Copywriting Contract in 01-UI-SPEC.md describe the product: key alignment on rows that carry a pill, the 10px micro role, and the Done warning's copy."
  status: closed (2026-10-13, plan 11-18, D-198)
  why_deferred: |
    Three finish-pass items declined on contract grounds, each an amendment and not a finish edit. (1) Keys
    misalign on rows that carry a pill or a change cue, because pills trail the status glyph by Row
    Anatomy and may not clip; aligning them reserves a slot on every row. (2) `type-micro` (10px) still
    carries a feed system notice and the assignee picker, and the detector reports tiny-text; the 08.1 scale
    starts at 11. (3) The Done warning prints '{key} · {n} of {total} criteria unchecked. Mark Done anyway?'
    at the group-six reviewer's instruction; 01-UI-SPEC.md's Copywriting Contract still gives the old string.
    D-REV-13 (a zero criteria count and 'No priority' printing nothing) is the fourth in this family.
  risk_if_wrong: "Low: cosmetic density and a stale contract string. The next phase inherits a document that disagrees with the product unless this is settled."
  automatable: "No for the decisions. Each edit, once decided, is small and testable."
  update_11-18: "Plan 11-18, 2026-10-13. CLOSED by D-198.2, .3 and .4 (item 1 of the family is D-REV-13). The Copywriting Contract carries the shipped Done-warning string, transcribed from DoneWarning.tsx. Every type-micro site moved to type-label and the class is deleted, so zero references remain under packages/desktop/src. Key alignment on pill-bearing rows is recorded in 01-UI-SPEC as deliberate and left as it is."

- id: D-REV-31
  phase: "08.1 — Visual Polish (plan 20, from A-06)"
  truth: "The 2px neutral-ink left rule on a selected task row does not read as the decorative side stripe the craft floor bans."
  status: open
  why_deferred: |
    Physical: human aesthetic judgement, and a reading of prose. The owner decided on 2026-10-08 (A-06) that
    the ban targets accent colour, not neutral ink. The mechanical detector did not and cannot rule on it:
    `skill-ban-side-stripe-borders` is prose in craft-floor.md and not a detect.mjs antipattern, so its
    silence is structural. The rule stands as a knowing exception with a dated reason. It is queued so that
    the next independent reviewer's reading of the floor, if it covers neutral ink, is re-argued
    deliberately and not inherited.
  risk_if_wrong: "Low: the selection treatment changes (A-06 offered a 1px rule, an inset bar and a background-only shift), at the cost of the focus clause, which the rule carries because the two selected surfaces are 1.03 apart."
  automatable: "No. The perceptibility of the rule (focused against unfocused, 4.06 / 4.23; both 3:1 on every surface) is already asserted; whether it offends the floor is a judgement."

  **RESOLVED 2026-10-09 by the orchestrator, during the phase close.** Confirmed: it was the only
  `--accent` in `review.css`, and a double violation — a fifth brand site outside D-12's four
  permitted uses, drawn as a 2px coloured side stripe, which is simultaneously the weight A-06
  reserves for the selection rule and the shape `craft-floor.md`'s `skill-ban-side-stripe-borders`
  bans. The badge marks board text beside a diff; it is not a cursor. Now
  `border-left: 2px solid var(--text-primary-rack)`. Two guards added to
  `review/__tests__/finish.test.tsx`: one asserts `review.css` spends no `--accent` role at all
  (reporting the offending line numbers), one pins the badge's ink edge. Verified by reinstating the
  brand value: both fail, and both pass once reverted.

- id: D-REV-37
  phase: "09 — Planned Fan-Out (09-REVIEW.md WR-02, WR-01)"
  truth: "Between the dispatcher's readiness decision and `launch_run_for_task`, nothing re-checks overlap, the cap or task liveness — so a manual launch or a live widen landing in that window can still put two agents on the same files."
  status: resolved
  why_deferred: |
    Not deferred for lack of automation — deferred because it is a second, separable defect class that
    the phase's two Critical fixes do not cover, and closing it needs a design choice (re-check at launch,
    or hold a decision lease) rather than a patch. CR-02 is closed at DECISION time: `readiness` now
    refuses to co-schedule an undeclared task (D-150). WR-02 is the LAUNCH-time half of the same
    guarantee. WR-01 is its sibling: `task_file_set_set` and `edit_draft_plan` change a live task's set
    with no D-152 collision check, and a later widen re-arms the marker from all stored rows, carrying
    the unchecked entries in. The fixer that closed CR-01/CR-02 independently judged WR-02 "close to
    Critical"; the orchestrator agrees.
  risk_if_wrong: "High for the phase's headline claim. Two agents can briefly hold overlapping sets, which is precisely what the phase promises cannot happen. Bounded by the window being short and by the merge-conflict path as a last guard."
  automatable: "YES. A test that interleaves a manual launch (or a widen) between `decide` and `launch_run_for_task` and asserts refusal. The existing `dispatch_auto_merge.rs` harness already drives real runs and git."

  **RESOLVED 2026-10-10 by the phase 09 re-verification (plans 09-11, 09-12, 09-13).** One rule
  (`dispatch::launch_conflict`) is now called by `readiness` and by `prepare_launch`, under the lock and
  before the run row exists, so the decide-to-launch window is closed at the shared launch body. A declare on
  a task with a live run is refused in `declare_file_set_in_tx`. A task's own live run refuses on both launch
  paths. NOT changed, by an earlier recorded choice (09-07): a manual launch over a DIFFERENT live task still
  proceeds; it is now recorded as `task.launch_overlap` and warned on screen. Residuals: D-REV-44, D-REV-46.

- id: D-REV-38
  phase: "09 — Planned Fan-Out (09-REVIEW.md WR-06, and the D-149 review point)"
  truth: "`dispatch_why` answers `DisjointSets` / 'neither waits' for an undeclared pair that, after the CR-02 fix, genuinely IS waiting; and the wave plan sheet shows no 'no files declared, runs alone' signal at the one human look."
  status: resolved
  why_deferred: |
    This became WRONG rather than merely incomplete as a result of closing CR-02. `EDGE_CAUSE_WIDEN` is
    declared and never used, and a live widen writes no ordering edge, so `why` has nothing to report for
    either case. D-149 gives a wrong file-set its one human look precisely because a wrong set silently
    voids the whole parallelism guarantee — and that review now happens without the reviewer being told
    which tasks have no declared set at all.
  risk_if_wrong: "Medium. Nothing executes wrongly, but the sequencing explanation the phase sells (PLAN-07, D-157: 'the user can ask why this one is waiting') returns a false answer, and the D-149 gate is reviewed with a material fact missing from the screen."
  automatable: "YES. Assert `why` for an undeclared pair returns a runs-alone cause, not `DisjointSets`; assert the sheet renders the signal. `dispatch_plan.rs` has six `why` tests to extend and `wave-plan-sheet.test.tsx` exists."

  **RESOLVED 2026-10-10 by the phase 09 re-verification (plans 09-10, 09-11).** `why` returns a runs-alone
  cause for an undeclared same-wave pair, a live widen writes a `widen` edge and `task.sequenced` event in its
  own transaction, and the wave plan sheet says "No files declared, so this task runs alone." Residual:
  D-REV-45. Also unfiled and one line: the runs-alone sentence says "never shares a wave" for a pair that IS
  in one wave (review WR-04); reword to "never runs at the same time as another task".

- id: D-REV-39
  phase: "09 — Planned Fan-Out (09-REVIEW.md WR-03, WR-04, WR-05, WR-07, and the three Info items)"
  truth: "Five lower-severity review findings stand unfixed: a run row inserted then abandoned on error leaks a cap slot permanently (`agent_run.rs:734`); a persistently failing `run_merge` flaps state and appends an event every 5s; `is_startable` relaunches a task the user ran manually; the `AppState.db` mutex is held across `git config` subprocesses; plus dead code (`EDGE_CAUSE_WIDEN`, `may_merge`, `hold_for_limit`), unattended spawns attributed to the human actor, and ASCII-only case-folding that errs lax for overlap detection."
  status: resolved
  why_deferred: |
    Deliberate scope call at the phase close: the two Criticals were fixed because they inverted the
    phase's core value on the default path; these were filed instead of fixed, per the standing
    ship-first instruction. Grouped as one entry because they are independent small fixes with no shared
    design decision, unlike D-REV-37 and D-REV-38.
  risk_if_wrong: "Medium-low individually. WR-03 is the worst of them: a leaked cap slot is permanent and silently shrinks the parallelism budget until restart. WR-05 can double-run a task. The rest are noise, latency or cosmetics."
  automatable: "YES, all seven. Each is a narrow unit test; none needs a live account or human judgement."

  **RESOLVED 2026-10-13 by plan 11-10 (with 11-09 for the first finding).** The entry held seven findings;
  the register's text listed them out of the review's order. Each, with what closes it:
  - Leaked cap slot after a post-insert launch error (WR-03): closed by plan 11-09 (`fail_launch`, D-REV-46).
  - Failing merge flaps and appends an event every tick (WR-04): `merge_task` no longer walks a
    `needs_attention` task through `merging` on a retry, so `mark_needs_attention`'s dedupe meets the state it
    wrote. Test: `a_persistently_failing_merge_appends_one_event_and_does_not_flap`.
  - `is_startable` relaunches a task the user ran by hand (WR-05): refused when the latest run's trigger was
    fired by a human after the plan was created, and `decide` ADOPTS that run (merges it, or records that it
    ended). Tests: `a_task_the_user_ran_by_hand_is_not_relaunched_and_its_finished_work_is_adopted`,
    `a_dispatcher_started_task_held_by_the_limit_is_still_retried`,
    `a_manual_run_older_than_the_plan_does_not_stop_the_plan_starting_the_task`.
  - `AppState.db` held across `git config` (WR-07): the case probe now runs with no lock held in `plan_dto`,
    approve, widen, the launch body and the planning run. Tests: `no_desktop_command_runs_the_case_probe_under_the_database_lock`
    (a source gate, mutation-checked) and `the_observed_case_flag_is_the_repositorys_core_ignorecase` (desktop). Remaining `git config` sites are listed in D-REV-58 and the 11-10 SUMMARY.
  - Dead code (IN-01): CORRECTED, not wholly true. `EDGE_CAUSE_WIDEN` is used by `record_widen_sequencing` and
    stays. `may_merge` and `hold_for_limit` had only test callers and are removed.
  - Unattended spawns attributed to the human (IN-02): the dispatcher's launch is initiated by the system actor
    and `start_agent_run` flags it automatic. Tests: `an_unattended_start_is_attributed_to_the_system_actor_and_a_manual_one_to_the_human`
    (core) and `a_dispatcher_launch_is_attributed_to_the_system_actor_and_a_manual_launch_to_the_human` (desktop).
  - ASCII-only case fold (IN-03): `to_lowercase`. Test: `launch_conflict_folds_non_ascii_case_so_the_strict_side_wins`.
  Not fixed, filed as D-REV-58: NFC/NFD equivalence, the unset-flag default, the second half of WR-04, plan
  approval re-validating its tasks, and `git config core.hooksPath` under the lock at project registration.

- id: D-REV-40
  phase: "09 — Planned Fan-Out (process finding, not a code defect)"
  truth: "Every plan in phase 09 resolved `tdd_applicable: true` from task attributes, while the gate that enforces RED-before-GREEN reads `workflow.tdd_mode`, which is false for this project — so the gate was structurally incapable of firing, and plan 09-07 shipped three `feat` commits with no RED commit before it was noticed."
  status: open
  why_deferred: |
    This is a defect in the harness's own gate wiring, not in Flywheel. Recorded here because it was
    found during this phase and will recur on every phase until the predicate is fixed: the gate should
    key on the same resolution the planner uses (`gsd_run query phase.tdd-applicable`, which reports
    `source: task_attribute`), not on the config flag alone. 09-07 was mitigated after the fact by a
    mutation check; 09-08 and 09-09 complied only because the orchestrator added an explicit
    instruction to each dispatch prompt by hand.
  risk_if_wrong: "Medium. Silent loss of TDD discipline on exactly the phases that declare it per-task. The compensating control is an orchestrator remembering to say so in the prompt, which is not a control."
  automatable: "YES, in gsd-core: make the execute-phase TDD gate read `phase.tdd-applicable` per plan rather than `workflow.tdd_mode`."

- id: D-REV-41
  phase: "09 — Planned Fan-Out (verifier finding; 09-07 and 09-09 SUMMARYs both said 'file this' and it was never filed)"
  truth: "A task whose run ends `failed`, `stopped` or whose automatic merge ends `conflict` can be retried or skipped from the app, and the user is told why it is stuck; the plan then advances."
  status: closed (2026-10-14, plan 11-11)
  why_deferred: |
    Not a human-judgement item: it is a missing command. `dispatch.rs::is_startable` retries only `planned`,
    `waiting`, `held_by_limit` and a pre-spawn `needs_attention`. `observation_targets` skips `conflict`,
    `failed` and `stopped`. `wave_is_drained` counts only `merged` and `skipped`. `edit_draft_plan` refuses a
    non-draft plan. So a task in one of those three states holds its wave, and every later wave, until the
    user stops the whole plan; nothing in `commands/dispatch.rs` sets a task to `skipped` or back to `planned`.
    A manual `agent_run_start` of the stuck task does not help either: `decide` re-reads only `running`,
    `merging` and `needs_attention`. D-156 says a conflict 'stops that task and asks the user'. The app asks and
    offers no way to answer. 09-07-SUMMARY called this 'the one gap worth a decision before the UI plan';
    09-09-SUMMARY repeated it as 'should be filed as a follow-up issue'. Neither filed it.
  risk_if_wrong: "Moderate. No work is lost and the failure is loud, but the first failed or conflicting task in a real fan-out strands the rest of the epic with no in-app recovery, which is the ordinary case rather than the edge."
  automatable: "YES. A core command `retry_task` (stuck state back to `planned`) and `skip_task` (to `skipped`), human-only, plus one `dispatch_auto_merge.rs` test per command driving a failed run and a real conflict to a drained wave. The cause string for the three states is a one-line addition to `attention_for`'s sibling."
  update_11-11: "Plan 11-11, 2026-10-14. CLOSED. Core `retry_task` (stuck state back to `planned`, an event naming the human) and `skip_task` (to `skipped`) in domain/dispatch_plan.rs, refusing by name outside failed, stopped and conflict and writing nothing on a refusal; `dispatch::stuck_cause` is the cause sentence for the three states, rendered through dispatch_plan_get. Tauri commands `retry_task` and `skip_task` are in generate_handler! and in the capability roster as HUMAN-ONLY; `grep -rn retry_task packages/sidecar/src` returns 0. Tests in dispatch_auto_merge.rs drive a real failed run and a hand-run failed task to a drained wave, and a retry after a conflict. UI: `retryTask` and `skipTask` in adapters/tauri.ts, Retry and Skip on a stuck task in WavePlanSheet.tsx, a refusal rendered in the core's own words; stuck-task.test.tsx covers cause, both calls once, and the refusal."

- id: D-REV-42
  phase: "09 — Planned Fan-Out (verifier finding; PLAN-04 and ROADMAP criterion 3)"
  truth: "A write outside a task's declared file-set is stopped at the tool level. Today that holds for `Write`, `Edit`, `MultiEdit` and `NotebookEdit` only. A write through `Bash` is found at session close and recorded, but it does not stop the run, and a detected breach does not stop the automatic merge."
  status: open
  why_deferred: |
    This is an owner acceptance, not a check: 09-RESEARCH Pitfall 2 and 09-01-SUMMARY state that the file-tool
    matcher cannot see `Bash` (`echo >`, `sed -i`, `rm`, an installer rewriting a lockfile) and that the
    close-time backstop is detective. Nobody recorded that the owner accepted that against the wording of
    PLAN-04 ('prevented at the tool level') and criterion 3 ('stopped at the tool level'), and REQUIREMENTS.md
    marks PLAN-04 Complete without qualification. Second half, verified in code and not in any SUMMARY's risk
    list: `decide` and `merge_task` never read `task.scope_denied`, so a run whose Bash write was flagged
    after the fact still merges into the integration branch automatically (D-156), and wave two builds on it.
    The 'also clean up an undeclared file' check PITFALLS.md names would, if the agent does it with `rm`,
    be a Bash write.
  risk_if_wrong: "Moderate to high for the headline claim. Disjointness is enforced for file tools and merely observed for Bash, and the merge that follows an observed breach is automatic and unreviewed."
  automatable: "PARTLY. Prevention for Bash is a design question, not a test. The cheap half is YES: make `after_completed_run` return a needs-attention cause when the run has a `detected_after_the_fact` scope event, plus one `dispatch_auto_merge.rs` test. Owner decision still needed on whether to reword PLAN-04 to 'file-writing tools'."
  update_11-11: "Plan 11-11, 2026-10-14. CHEAP HALF CLOSED, entry stays OPEN. `after_completed_run` now holds the automatic merge with a needs-attention cause `scope_breach` when the task's LATEST run has a `detected_after_the_fact` scope event; a recorded human merge is not held again, and a breach recorded against an earlier run does not hold a retried task. Tests in dispatch_auto_merge.rs: held on breach (one needs-attention record, nothing integrated, wave held), a clean run still merges, a human merge after the breach lets the wave move on, an earlier run's breach does not hold a later clean run. STILL OPEN, and not closed by this plan: (1) prevention for Bash writes is still detective only, because the hook matcher cannot see Bash; (2) PLAN-04's wording ('prevented at the tool level') is still broader than the shipped behaviour and REQUIREMENTS.md still marks it Complete unqualified. Both are owner decisions, routed to the plan 11-21 owner pass."

- id: D-REV-43
  phase: "09 — Planned Fan-Out (plan 09-13, overlap warning host)"
  truth: "A user who launches a task over a different live task sees Rust's overlap warning after the launch sheet closes."
  status: open
  why_deferred: |
    `App.tsx` receives the warning as `onStarted`'s second argument and shows it as a fixed toast, because the
    sheet unmounts in that same callback and its own copy of the warning (which IS tested) is gone with it. The
    toast has no component test: `App` has no existing render harness, and standing one up for a 15-second
    toast was not worth the diff. The Rust side (event, warning on the result, dispositions) and the sheet are
    covered; only the host wiring is not. The same field reaches `MergeConfirmSheet.tsx`'s launch call and is
    not rendered there yet; the appended `task.launch_overlap` event is the durable record for that path.
  risk_if_wrong: "Low. The launch is recorded and allowed either way; a missing toast makes the overlap silent on screen again, though it stays in the activity trail."
  automatable: "YES. A render test of `AppShell` with `startAgentRun` mocked to return a warning, asserting the note appears after the sheet closes. Cheaper still: lift the toast into its own component and test that. Also: computing the same warning in `agent_run_preview` would show it BEFORE the click, one more field on the preview response."

- id: D-REV-44
  phase: "09 — Planned Fan-Out (09-REVIEW.md WR-02; verifier-confirmed in code)"
  truth: "The launch body and the dispatcher return the same verdict for the same pair on every repository."
  status: resolved
  why_deferred: |
    Not a human item; deferred only by the ship-first instruction. `prepare_launch` passes `fold_case = true`
    (`agent_run.rs:786`); `readiness` passes the repository's observed flag (`dispatch.rs:595`). On a
    case-insensitive filesystem they agree. On a case-sensitive one, a same-wave pair differing only in case is
    disjoint to `decide` and refused by the launch, which `run_pass` records as a pre-spawn `LaunchFailed`;
    `is_startable` retries it every tick until the live peer ends. Safe-side: the launch is stricter, so no
    collision is admitted. It does falsify plan 09-12's "can never drift apart".
  risk_if_wrong: "Low on macOS, the v1 target. On a case-sensitive repository: a repeating spurious 'Needs you' for a pair the dispatcher judged safe."
  automatable: "YES. Read repo_path under a short lock, call `repo_is_case_insensitive` (make it `pub`) outside the lock, re-lock and pass the flag into `prepare_launch`. Add a test with `Src/a.rs` and `src/a.rs` on a case-sensitive fixture that both callers agree on."

  **RESOLVED 2026-10-13 by plan 11-10.** `prepare_launch` takes the repository's observed `core.ignorecase`
  and passes it to `launch_conflict` (and into the scope marker) instead of `true`; `launch_run_for_task` reads
  it through `observed_fold_case` with no lock held. `repo_is_case_insensitive` is `pub`. Tests:
  `scope_widen.rs::the_launch_and_the_dispatcher_agree_on_a_case_only_pair_for_either_case_flag` drives both
  flag values explicitly (never the host filesystem) and asserts `launch_conflict` and the dispatcher's
  readiness agree; desktop `a_case_only_pair_is_judged_by_the_flag_the_launch_is_given` asserts the launch
  honours the flag it is handed. Plan 09-12's "can never drift apart" now holds for the flag as well as the rule.

- id: D-REV-45
  phase: "09 — Planned Fan-Out (09-REVIEW.md WR-03; verifier-confirmed in code)"
  truth: "A live widen that reaches a same-wave task waiting in a pre-spawn needs_attention state records an ordering edge, so the task waits for the widener's MERGE."
  status: open
  why_deferred: |
    `record_widen_sequencing` selects queued tasks with `pt.state IN ('planned','waiting','held_by_limit')`
    (`domain/file_set.rs:564-575`), but `is_startable` also starts a pre-spawn `needs_attention` task, which a
    launch refused by the new `Refuse` path produces. With no edge, that task becomes ready the moment the
    widener's run stops, before its work is merged, and cuts its worktree from a base without it (the
    merge-conflict case the edge exists to prevent). `why` also answers `DisjointSets` for that pair.
  risk_if_wrong: "Low to moderate. Needs a widen into a task parked at pre-spawn attention; the result is a later merge conflict, caught by the conflict path."
  automatable: "YES. Reuse `is_startable`'s predicate (or add the pre-spawn attention state) in the queued-task select, plus one `scope_widen.rs` test with a `needs_attention` task."

- id: D-REV-46
  phase: "09 — Planned Fan-Out (09-REVIEW.md WR-01, WR-05; verifier-confirmed in code)"
  truth: "A launch that fails after its run row exists leaves no running row, and every manual launch site shows the overlap warning and the refusal reason."
  status: open
  why_deferred: |
    After `start_agent_run_recording_first`, `record_launch_overlap(...)?`, `merge_shim_env_for_run(...)?` and
    `send_gated_spawn(...)?` return with the row still `running`. Before 09-13 that cost a cap slot until the
    startup reconcile (D-REV-39 WR-03). Now `launch_conflict`'s `HasLiveRun` also refuses every manual retry of
    that task. `MergeConfirmSheet.tsx:213-224` calls the same `startAgentRun`, ignores `overlapWarning`, and
    replaces every error with a fixed string, so a refusal reason is swallowed there. Extends D-REV-39 and D-REV-43.
  risk_if_wrong: "Moderate for a user whose sidecar hiccups: the task cannot be relaunched until the app restarts."
  automatable: "YES. Close the run as `failed` on each post-insert error path (the `fail_planning_start` remedy), or write the overlap event in the run's own transaction; surface `overlapWarning` and the error message in `MergeConfirmSheet`. One test per path."

- id: D-REV-47
  phase: "10 — Fleet Supervision (plan 10-01)"
  truth: "The fleet surface reads at a glance in the running app: the three band headers, the state glyph plus word, the project column and the age column are legible and scannable at the real row density, in light and dark."
  status: open
  why_deferred: |
    Everything structural is asserted: band order, the word and mark per state, the muted `interrupted`, the
    project column, the empty state (fleet-surface.test.tsx) and the 5,000-row read budget (fleet_perf.rs).
    What no test can say is whether the rendered layout is easy to scan. The physical reason is that the app's
    WebView is WKWebView, which has no WebDriver, and "scannable" is a human aesthetic judgement.
  risk_if_wrong: "Cosmetic. A cramped or noisy fleet row is a follow-up styling issue, not a correctness fault."
  automatable: "PARTLY. A Playwright screenshot of the surface in light and dark against the browser-test config can catch gross overflow and truncation, not the judgement of whether it reads well."
  update_11-15: "Containment half CLOSED, in both schemes: packages/desktop/src/fleet/__tests__/browser/fleet-group.browser.test.tsx (the first browser suite under fleet/) measures the fleet surface in WebKit at 1200 and 900 px, light and dark. Nine synthetic stress rows (all seven states, a 90-character project name, a 120-character task title, 200 characters of narration, a $12.35 spend with 98,765,432 tokens) are asserted by getBoundingClientRect/scrollWidth: every cell inside its row and no two cells overlapping; state, age and dismiss never cut, project/subject/activity/spend cut only with an ellipsis on one line; glyph plus word inside the state cell; a long project name leaves the row exactly as tall as a short-name row and the age column inside it; the state, project and age columns share their left and right edges down the whole list; the three band headers inside their bands on one line with Dismiss finished inside its bar; the header count and estimate footer inside the surface. Mutation-checked: removing the project cell's overflow/ellipsis turns the long-name test red. This is Playwright's WebKit build, not the shipped WKWebView. STILL HUMAN, physical reason = human aesthetic judgement: whether the layout is easy to scan."

- id: D-REV-48
  phase: "10 — Fleet Supervision (plan 10-03)"
  truth: "In the running app a live agent's activity cell shows what it is doing and moves within about a second of its tool call, and reads well as one truncated line."
  status: open
  why_deferred: |
    Asserted piecewise: `read_tail`'s boundary cases and bounded cost (session_log_tail.rs), the live-rows-only
    read and the lock discipline (fleet.rs tests and grep gate), the throttle, the single listener and its
    cleanup, the dash for an unreadable tail, and word-for-word parity with the session feed
    (fleet-activity.test.tsx). Not exercised end to end: a real sidecar writing a real log while the fleet is
    open. The visual half (80-character clip, tail ellipsis, muted ink at row density) is a human aesthetic
    judgement in a WKWebView, which has no WebDriver.
  risk_if_wrong: "Low to moderate. The cell could lag or read poorly; nothing is lost and no state is wrong."
  automatable: "PARTLY. The live half can be a harness run against a scratch FLYWHEEL_APP_DATA_DIR that appends log lines and asserts `fleet_list` returns the new tail; the look of the line cannot."
  update_11-15: "Live-read half CLOSED: scripts/uat/uat-12-fleet-live-reads.mjs, section D-REV-48, against a scratch FLYWHEEL_APP_DATA_DIR. It starts a real run, appends lines through the core's own session_log::append_event_line and reads fleet_list's row each time: no log gives an empty tail, three appends give the three lines verbatim oldest first, the next append is visible on the very next read, thirty appends give the last sixteen, and the same run once completed carries no activity. The harness calls the core functions behind the command (fleet_rows plus read_tail per live row, through the uat_fleet_ops bin), not the Tauri command itself: the AppState mutex, spawn_blocking and IPC serialisation are not exercised. First run green; not RED, the behaviour already held. STILL OPEN: (1) a real sidecar writing a real log while the fleet is open in the installed app, with the Tauri agent:event delivery and the ~1 s refresh throttle end to end (physical reason: no WebDriver for WKWebView; the pieces are each tested, the join is not); (2) how the 80-character clip, tail ellipsis and muted ink read at row density (aesthetic judgement). The clip itself is measured: fleet-group.browser.test.tsx asserts the activity cell ellipsizes without overflowing."

- id: D-REV-49
  phase: "10 — Fleet Supervision (plan 10-04)"
  truth: "In the running app the spend column, the labelled estimate footer and the Dismiss buttons read clearly at row density, and a dismissed row leaves the fleet."
  status: open
  why_deferred: |
    Asserted: the NULL and sum behaviour of the read (fleet_query.rs), blank-while-running, a failed run
    keeping its cost, the token label, the footer wording, Dismiss only on terminal rows, the batch call and
    that a click on a row acknowledges nothing (fleet-spend.test.tsx), and the one acknowledge statement
    (fleet_query.rs, recovery_summary.rs). Not exercised: the real Tauri round trip from a button press to the
    row leaving, and how the token text fits at narrow widths, which is a human aesthetic judgement in a
    WKWebView with no WebDriver.
  risk_if_wrong: "Low. The cell could clip or look crowded; no figure is wrong and no row is cleared by accident."
  automatable: "PARTLY. A harness run against a scratch FLYWHEEL_APP_DATA_DIR can call agent_run_acknowledge and assert fleet_list drops the row; the look cannot."
  update_11-15: "Dismiss half CLOSED: uat-12 section D-REV-49 completes one run and fails another, then acknowledges: each leaves fleet_list and the row count drops by exactly one per call; a live run is refused and stays; a repeat acknowledge reports no change; the other finished run is untouched. Same caveat as D-REV-48: the core function (agent_run::acknowledge_run) is driven, not the Tauri command. Mutation-checked: making acknowledge_run a no-op turned this section red and left the other three green. Token text at narrow width is now measured: the spend cell (98,765,432 in incl. cache, 8,765,432 out, $12.3456) stays inside its row and ellipsizes rather than overlapping at 900 and 1200 px, light and dark. STILL OPEN: (1) the real Tauri round trip from the button press to the row leaving (physical reason: no WebDriver for WKWebView); (2) whether the spend column, estimate footer and Dismiss buttons READ clearly (aesthetic judgement)."

- id: D-REV-50
  phase: "10 — Fleet Supervision (plan 10-05)"
  truth: "In the running app, with real blocked agents in two or more projects, the blocked queue lists each one, a single `a` press answers exactly the marked agent and the list then advances, and the queue reads well at row density."
  status: open
  why_deferred: |
    Asserted: the cross-project read, one entry per run, live blocks only and the specified order (fleet_query.rs);
    that one a, d and shift-a keypress over three queued cards answers exactly one request, that the owner moves
    when the list moves, that Escape dismisses nothing, that a destructive entry leads with Deny, and that the
    card's two earlier mounts still own the keyboard by the index rule (blocked-queue.test.tsx); the rail's
    fleet-wide count and its separation from the needs-decision count (project-rail.test.tsx). Not exercised: a
    real sidecar raising real requests in two projects while the queue is open, and the real Tauri round trip from
    a keypress to the row leaving. The look of the owner marking is a human aesthetic judgement in a WKWebView,
    which has no WebDriver.
  risk_if_wrong: "Moderate for the live half (a queue that fails to refresh would leave a blocked agent unseen, though the fleet still shows it); low for the look."
  automatable: "PARTLY. A harness run against a scratch FLYWHEEL_APP_DATA_DIR can seed two blocked runs, call fleet_blocked_queue and agent_run_answer_permission and assert the queue shrinks by one per call; the look of the owner marking cannot."
  update_11-15: "Queue half CLOSED: uat-12 section D-REV-50 raises a pending permission request on a live run in each of two projects: blocked-queue lists both (one entry per run, across projects), answering one leaves exactly the other, answering the second empties it, and a second answer to an already answered request is refused without moving the queue. The core's answer_request is driven; the desktop command's own wrapper is not: the sidecar relay (relay_permission_answer), the allow_always rule write, the AppState mutex and the board:changed emit are untouched. First run green; not RED. STILL OPEN: (1) a real sidecar raising real requests in two projects while the queue is open, and the keypress-to-row-leaving round trip through Tauri (physical reasons: no WebDriver for WKWebView, and a real login for a real session); (2) how the owner marking reads (aesthetic judgement)."

- id: D-REV-51
  phase: "10 — Fleet Supervision (plan 10-06)"
  truth: "In the running app, Enter or a click on a fleet row opens that agent's live output (and Back returns to the fleet), and the subject key on a row in another project lands on that item's detail panel."
  status: open
  why_deferred: |
    Asserted: the session opener receiving run id, task id, stage, epic id and the row's status for task, authoring,
    no-subject, failed and awaiting-review rows; Dismiss and the subject key not bubbling into the row; the fleet
    field left set so the session's back lands on it; the one-shot pendingFocusItemId surviving BoardView's
    project-change clear, consumed once, held for a later window, opening a collapsed group, and dropped when
    unresolvable (jump.test.tsx, board-pending-focus.test.tsx), with the cross-project jump run through a real
    BoardView. Not exercised: the real shell (App.tsx mounting Board for the switched project and the fleet
    giving way to it), a project whose epics roster loads slowly, and how the key-as-button reads at row density
    in a WKWebView, which has no WebDriver.
  risk_if_wrong: "Moderate for the shell half (a jump that lands on the board without the item open); low for the look."
  automatable: "PARTLY. A Playwright run against the Vite dev server with the adapter stubbed can mount App.tsx and assert the detail panel after the subject key is pressed; the look cannot."
  update_11-15: "Shell half CLOSED, twice. jump.test.tsx now mounts the real AppShell (through <App />) over a stubbed adapter: Enter and a click replace the fleet with that run's session and read that run's own log; Back returns to the fleet; the subject key (click and `b`) on a row in another project switches the current project, consumes the one-shot request and opens that item's detail panel for BET-7, not a stale item from the project that was showing; a jump into a project whose board loads in 600 ms waits (request held, nothing open) and then lands. fleet-jump.browser.test.tsx repeats the sequence in WebKit with real key presses (j, Enter, b) and real clicks, light and dark. Mutation-checked: dropping setCurrentProjectId, or making Back also close the fleet, turned both suites red. TWO FINDINGS, held as it.fails, logged in deferred-items.md: (a) Back returns to the fleet but with NO row selected, because the selection is local to FleetSurface which the shell unmounts while the session shows; (b) a finished run with an empty log opens a session reading 'Starting session...' above 'This run has ended'. NOT covered: the Tauri IPC behind any read (adapter stubbed), and that the packaged WKWebView delivers the same key events (Playwright's WebKit is not the shipped one). STILL HUMAN: how the key-as-button reads at row density (aesthetic judgement); the IPC and packaged-WKWebView join stays with the installed build (physical reason: no WebDriver for WKWebView)."

- id: D-REV-52
  phase: "10 — Fleet Supervision (plan 10-07)"
  truth: "Against an installed, signed build, a real banner appears in the macOS Notification Center when an agent blocks, finishes or fails."
  status: open
  why_deferred: |
    Asserted: the coalescing window and the one-banner-for-a-wave behaviour, the single and summary wording, the
    run-and-kind collapse, the suppression rule, the body cap, the exclusion of interrupted and abandoned by type,
    the switch read at fire time, and a capability file with no notification grant (notify.rs, agent_run.rs).
    Not exercised: the operating system actually drawing the banner. Under `tauri dev` the banner is attributed to
    the terminal application and may need that application's own notification permission, which is a packaging
    property Phase 11 produces (RESEARCH Pitfall 6). Physical reason: the OS notification centre is outside the
    process and has no automation surface.
  risk_if_wrong: "Moderate. The decision logic is tested, but a build whose bundle identity the OS rejects would show no banner at all."
  automatable: "NO. Needs a signed bundle and a person (or an OS-level accessibility harness) looking at the Notification Center."

- id: D-REV-53
  phase: "10 — Fleet Supervision (plan 10-07)"
  truth: "On a fresh macOS install, the first notification triggers (or silently skips) the system permission prompt, and a user who declines it is not left believing banners are on."
  status: open
  why_deferred: |
    The plugin reports the permission as granted on desktop without asking (RESEARCH Assumption A6), so there is
    no in-app signal to assert on. Physical reason: the prompt is drawn and answered by the operating system.
  risk_if_wrong: "Moderate. A declined permission would silence every banner while Settings still says they are on."
  automatable: "NO. The permission state lives in System Settings for the installed bundle."

- id: D-REV-54
  phase: "10 — Fleet Supervision (plan 10-08)"
  truth: "In the running app, the Worktrees rail entry opens an inventory of every task worktree across projects with a size and its age, Re-measure fills in the sizes of a freshly created worktree without freezing the window, and each row's chip and reason read clearly at row density."
  status: open
  why_deferred: |
    Asserted: the eligibility table (done, merged, both, running, blocked, dirty, unreachable, missing, no epic) and
    the board-then-git read against real git repositories, including a count of the porcelain reads performed
    (worktree_inventory.rs); the bounded, symlink-safe walk and the two-column cache write (worktree_size.rs); the
    view's size-with-age, blank-when-unmeasured, chip-with-reason, empty-state and ordering rendering
    (worktree-inventory.test.tsx). Not exercised: the two Tauri commands over real IPC (no AppHandle in a unit
    test), whether a multi-second walk really leaves the window responsive, and the look of the row in a WKWebView,
    which has no WebDriver. One walk over this repository (45 GiB of target/ plus node_modules, 92 GB allocated)
    took 31-51 s in an unoptimised build and did not hit the entry bound; a single task worktree is far smaller.
  risk_if_wrong: "Low to moderate. The decision and the walk are tested; the risk is a slow first measure of a very large worktree or a cramped row."
  automatable: "PARTLY. A Playwright run with the adapter stubbed can assert the view; responsiveness during a real walk needs the installed app."
  update_11-15: "View half CLOSED: fleet-group.browser.test.tsx measures the inventory in WebKit at 1200 and 900 px, light and dark, over rows covering all eight reasons and all three dispositions plus a 90-character project name, a 1023.9 TiB size with a 40-day-old measurement, and a never-measured size: every cell inside its row without overlap, the chip's glyph and reason inside the row and uncut, the size cell never cut, a checkbox on reclaimable rows only, the columns sharing edges down the list, no sideways scroll, an empty size cell holding its column. worktree-inventory.test.tsx adds the Re-measure transition: blank before, then '2.5 GiB measured 0s ago' after, with the list read again rather than edited locally (mutation-checked: dropping the refetch turns it red). STILL OPEN: (1) the two Tauri commands over real IPC and whether a multi-second walk leaves the window responsive (needs the installed app and a large worktree; physical reason: no WebDriver for WKWebView). The walk's lock discipline is a property of the desktop command, which this plan cannot drive; (2) the look of the row (aesthetic judgement)."

- id: D-REV-55
  phase: "10 — Fleet Supervision (plan 10-09)"
  truth: "In the running app, selecting reclaimable worktrees, confirming, and pressing Remove deletes exactly those directories while the window stays responsive, and the confirmation and the result list read clearly at row density."
  status: open
  why_deferred: |
    Asserted: the batch against real git repositories (three removed; a run inserted after the read refused with
    the live-run reason while the others are removed; a tree dirtied after the read refused with its file intact;
    an open task and an unreachable project refused; an unknown id failing alone; duplicates handled once; a
    removal git refuses, a locked worktree, reported as refused with the row kept; the batch on a second
    connection visible on the first) in worktree_reclaim.rs; the 50-row cap in fleet.rs; and the view's
    checkbox-on-reclaimable-only, count-and-bytes bar, one confirmation, cancel calling nothing, no select-all,
    mixed result with no success claim, refetch and selection retention (worktree-reclaim.test.tsx). Not
    exercised: the command over real Tauri IPC (no AppHandle in a unit test), whether a multi-second removal of a
    worktree holding node_modules really leaves the window responsive, and how the dialog reads in a WKWebView,
    which has no WebDriver. The subprocess-ceiling timeout path is not driven end to end: proc.rs offers no seam
    for a shorter ceiling, so it is covered only through the shared Err branch.
  risk_if_wrong: "Moderate for the live half (a removal that blocks the window); low for the look. The data guards are tested: eligibility is re-derived per row and the dirty-tree refusal is untouched."
  automatable: "PARTLY. A harness run against a scratch FLYWHEEL_APP_DATA_DIR can seed worktrees, call worktree_reclaim and assert the outcomes and that fleet_list stays answerable meanwhile; the look cannot."
  update_11-15: "Removal half CLOSED: uat-12 section D-REV-55 builds a repository of 6000 committed files, four reclaimable worktrees and one live-run worktree, reclaims three by id: those three directories are gone from disk, the fourth reclaimable one and the live run's are untouched and the live row is still on the fleet. During the 2.2 s reclaim the harness issued fleet_list back to back: 321 calls completed inside it, slowest 11 ms, bound 2000 ms, all returned the live row. The harness refuses to pass if no read fit inside the reclaim (INSTRUMENT message; UAT12_BULK_FILES=0 trips it). CAVEAT on the responsiveness claim: each fleet_list is its own process with its own connection, so this proves a reader is not blocked by the reclaim's connection under WAL and busy_timeout; it does NOT prove the desktop command keeps the AppState mutex released across the git calls. That is a property of commands/fleet.rs and is only reachable through a Rust test in the desktop crate (tauri's test mock_app; needs the tauri `test` feature). automatable: YES for that, but a cold desktop test build is ~13 minutes, over the executor watchdog, so it was not attempted: route to a plan that can run it detached. STILL OPEN: (1) a worktree holding node_modules (a multi-second removal) through the installed app (physical reason: no WebDriver for WKWebView); (2) how the confirmation and result list read at row density (aesthetic judgement)."

- id: D-REV-56
  phase: "11 — Ship It (plan 11-03)"
  truth: "On GitHub's macos-14 runner, a push runs ci.yml green end to end (sidecar staging, cargo build and test, vitest, tauri build, dmg upload), and open-core.yml goes green with packages/relay-client deleted."
  status: closed (observed on GitHub macos-14 - 2026-10-13, plan 11-04)
  why_deferred: |
    Asserted locally: both files parse as YAML; the staging step precedes the first cargo step; no continue-on-error;
    the open-core sed plus cargo metadata pair exits 0 against a tree with the crate moved away, the non-comment
    grep gate finds zero references (and its comment filter was driven with a sample hit), and Cargo.toml was
    restored byte-identical; README commands are line-for-line the ci.yml run strings. Not exercised: neither
    workflow has run on a GitHub runner, so nothing observed that a clean macos-14 image, with only the README
    prerequisites, completes the sequence (Rust 1.96+ on stable, npm cache keys, the Node download, tauri build time).
  risk_if_wrong: "Moderate. The first push may fail on a runner-only difference; the fix is a workflow edit, nothing shipped depends on it yet."
  automatable: "NO locally (needs a GitHub runner), but it is redeemed for free by the first push of this branch: read the two run results."
  update_11-04: |
    CLOSED, but not on the first try, and the first push said so. The branch reached origin for the first time on
    2026-10-13 (the three workflow files were not indexed until then; push fired CI and Open core). Both went RED at
    f2b04b5, and every red was a defect already in the tree, not a runner difference:
    (1) cargo test: packages/core/tests/scope_marker_contract.rs had two source-text tests broken by 11-09's
    spawn_prepared_run extraction (cf2cb20); red locally as well. Fixed 2727b09 (the invariants are unchanged and
    still asserted).
    (2) npm test in packages/sidecar: 6 of 11 executions failed, always stop.test.mjs test 274 or 276. Root cause:
    permission.test.mjs's after() ran `pkill -f <fake-claude path>`, and node --test runs files concurrently, so it
    SIGTERMed stop.test.mjs's stubborn sessions mid-assertion. Fixed b1275de by scoping the cleanup to the file's own
    descendants. Two earlier fixes of mine (a poll, then zombie tolerance) were guesses at the wrong cause and were
    reverted in b1275de; do not trust 2727b09..46f0cef as evidence about that flake.
    At f306e6e both are green on a branch push: ci.yml run 38346860234 (sidecar staging, cargo build and test,
    desktop vitest, tauri build, flywheel-dmg artifact 45,663,820 bytes uploaded, 18m50s) and open-core.yml run
    38346860235 (relay crate deleted, grep gate clean, full build and test, 12m17s).
    STILL NOT PROVEN: stability. After the pkill fix the sidecar step passed 5 of 5 executions and cargo test 7 of 8;
    the one red was packages/core/tests/authoring_lifecycle.rs
    `mark_abandoned_on_an_authoring_run_writes_a_fallback_summary_inside_its_own_transaction`, "failed to write the
    authoring stage runtime marker ... No such file or directory" (a runtime-directory race between concurrent core
    tests). Logged in phase 11 deferred-items.md. Expect an occasional red on ci.yml and open-core.yml until that is
    fixed; re-running the failed job is the remedy and proves nothing is wrong with the workflow.

- id: D-REV-57
  phase: "11 - Ship It (plan 11-04)"
  truth: "One pushed v* tag produces a release carrying FOUR assets: the .dmg, the .app.tar.gz, its .sig, and latest.json with a non-empty signature, and a client can read releases/latest/download/latest.json."
  status: closed (four-asset publication observed on GitHub - 2026-10-13, plan 11-05; installed-client update not proven, see update_11-05)
  why_deferred: |
    Plan 11-04 proved the pipeline unsigned and can prove only half the assets. 11-01 deliberately left
    bundle.createUpdaterArtifacts unset (tauri refuses to build updater artifacts without a signing key), so the
    bundle produces a .dmg and a .app.tar.gz and nothing else. Observed on the throwaway tag v0.0.1-ci (runs
    38344857442 and 38346874913, both success): exactly two assets, Flywheel_0.0.1-ci_aarch64.dmg (46,101,060 bytes)
    and Flywheel_aarch64.app.tar.gz (45,857,998 bytes). No .sig, no latest.json. release.yml's asset assertion is
    conditional for that reason: it always requires the .dmg and .app.tar.gz, and requires the .sig and latest.json
    the moment tauri.conf.json contains createUpdaterArtifacts. Plan 11-05 adds that key together with the updater
    keypair, so it is the plan that makes the assertion bite.
  risk_if_wrong: "High for the self-update claim, none for the first download. If 11-05 lands and the assertion is not exercised on a real tag, a release with no signature or no manifest ships, and no installed client can update from it."
  automatable: "YES, in the same way 11-04 did it: push a throwaway tag after 11-05 and read gh release view; the assertion step fails the run if any of the four is missing. Delete the tag and release afterwards."
  update_11-05: |
    CLOSED (four-asset half). Throwaway tag v0.0.1-ci at 1882b14 on HighKnow-ai/flywheel, Release run 38396587749,
    conclusion success, 20m42s, with createUpdaterArtifacts now in tauri.conf.json so the asset assertion required
    all four. gh release view listed exactly: Flywheel_0.0.1-ci_aarch64.dmg (47,000,025 bytes),
    Flywheel_aarch64.app.tar.gz (48,105,596), Flywheel_aarch64.app.tar.gz.sig (408), latest.json (16,403). Release
    not a draft, not a prerelease. latest.json: version "0.0.1-ci", platforms darwin-aarch64 and darwin-aarch64-app,
    both with url https://github.com/HighKnow-ai/flywheel/releases/download/v0.0.1-ci/Flywheel_aarch64.app.tar.gz
    and a 408-character non-empty signature, byte-identical to the .sig asset. The signature's minisign key id is
    AB3536BDD39983C5, the id of the public key compiled into tauri.conf.json. Throwaway tag and release deleted;
    gh release list, git ls-remote --tags origin and the releases API (drafts included, length 0) are all empty.
    NOT PROVEN, and not claimed: that an installed older build actually fetches this manifest, verifies it and
    installs it. Nothing here ran the updater against a real signed release; update_check/update_install were
    tested through a fake source and the compiled config was read, not exercised. That needs two installed
    versions and is the physical half of DIST-02 (queued with plan 11-06's banner).

- id: D-REV-58
  phase: "11 - Ship It (plan 11-10, residuals of D-REV-39 and D-REV-44)"
  truth: "Five findings that D-REV-39 and its review named, or that fixing them exposed, are still open: a merge whose event write fails after git succeeded is reported as 'nothing to merge'; plan approval does not re-check that its tasks are still startable; two spellings of one name that differ only in Unicode normalisation read as disjoint; an unreadable core.ignorecase reads as not folding; project registration runs git config under the database lock."
  status: open
  why_deferred: |
    Each is real and each is separate from the seven plan 11-10 closed; none blocks the loop. (1) 09-REVIEW WR-04,
    second half: if `record_merge_event_with` fails after `run_merge` succeeded, the state stays `merging`, the next
    pass sees zero commits ahead and no integrated event, and reports `NoCommits` for work that IS on the
    integration branch. The fix is to detect that the branch tip is reachable and write the event then. (2)
    09-REVIEW WR-05, third bullet: `approve_plan_with` does not re-check that each task is still backlog or todo, so
    a draft reviewed for an hour can include a task the user has since finished. (3) Overlap folds with
    `to_lowercase`; APFS also equates composed and decomposed (NFC/NFD) spellings, which needs a normalisation
    crate, so it was not added for a pair no repository here has. (4) `repo_is_case_insensitive` returns false when
    the key is unset or git cannot run. That is the strict side for the scope hook and the lax side for overlap, one
    bool cannot be strict for both, so changing the default needs the two consumers separated. (5)
    `register_project` and `relocate_project` run `git config core.hooksPath` (via `git_hooks`) while
    `project_register` / `project_relocate` hold `AppState.db`; it is once per registration and
    `destructive_gate_layer_coverage.rs` pins how the install is routed, so splitting it was left alone. Also:
    runs the dispatcher started BEFORE plan 11-10 were recorded with a human trigger, so a task left in
    `held_by_limit` from an old session reads as hand-run and is adopted rather than retried.
  risk_if_wrong: "Low to moderate. (1) is the only one that can strand a wave on a false message; the rest are narrow."
  automatable: "YES, all five. (1) a test that fails the event write after a real merge and asserts the next pass records the integrated event. (2) a core test that moves a task to done between draft and approve. (3) a pair spelled NFC and NFD through `overlaps`. (4) a test per consumer once split. (5) move the hook install after the lock is released in the two commands."

- id: D-REV-59
  phase: "11 - Ship It (plan 11-10, owner decision taken during execution)"
  truth: "The dispatcher adopts a task the owner ran by hand: it merges that finished work automatically, unreviewed, attributed to the system actor. The owner was asked during plan 11-10's execution and chose to keep the shipped behaviour."
  status: resolved
  why_deferred: |
    Not deferred - decided. Plan 11-10's fix for D-REV-39 ("a hand-run task is relaunched") replaced the relaunch
    with adoption, which has a consequence the register should state plainly rather than leave implicit in a
    SUMMARY: adopted work merges without review. The alternative considered was to refuse the relaunch and do
    nothing else, which leaves the task stuck in `planned` with no message - strictly worse. The second
    alternative, adopt-but-hold-for-review, is a small change in `decide` and was offered. The owner chose to keep
    auto-merge as shipped on 2026-10-13, accepting that a merge they did not inspect can land, in exchange for
    nothing ever stalling in `planned`.
  risk_if_wrong: "Moderate and bounded: a hand-run task's work lands on the integration branch without owner review. Recoverable by git; it is not a data-loss path. Revisit at 11-21 only if an unreviewed adopt actually surprises the owner in use."
  automatable: "N/A - an owner preference, not a testable claim. The behaviour itself is already pinned by the tests plan 11-10 added (a dispatcher launch is attributed to the system actor; a hand-run task is adopted, not relaunched)."

- id: D-REV-60
  phase: "11 - Ship It (plan 11-07, owner declined the purchase)"
  truth: "DIST-01 criterion 1 is not met. The released .dmg is unsigned and un-notarized, so a first-time user who double-clicks the downloaded application sees a Gatekeeper warning and must use the right-click-Open workaround. The requirement's text claims a signed, notarized build that opens with no warning."
  status: open
  why_deferred: |
    Plan 11-07 is the one plan in Phase 11 gated on a purchase rather than on work: notarizing a
    macOS application requires an Apple Developer Program membership ($99/yr), and a free Apple
    account cannot notarize at all. D-185 had already made "unsigned first" the deliberate default
    so that nothing else in the phase waited on Apple. Asked on 2026-10-13, the owner chose to ship
    unsigned and continue.
    Verified at the time: `security find-identity -v -p codesigning` reported 0 valid identities,
    and the repository held no `APPLE_*` secret - only the two `TAURI_SIGNING_*` secrets from the
    updater keypair. Apple's identity verification also takes 24-48 hours, so the plan could not
    have completed the same day in any case.
    Nothing partial was committed. No signing env was wired into `release.yml`, because empty
    `APPLE_*` secrets would risk the release pipeline that plans 11-04 and 11-05 proved green, for
    no present benefit - `tauri-action` cannot sign without a certificate. Plan 11-07 is recorded
    `deferred` rather than `halted` for a mechanical reason: `halted` sets `blocked_by` on 11-08 and
    would transitively strand 11-19, 11-20 and 11-21, which is the opposite of the owner's
    instruction to keep shipping.
  risk_if_wrong: |
    Moderate, and entirely a first-run-experience risk rather than a correctness one. Every user who
    downloads a release must right-click-Open the first time; some will read the Gatekeeper warning
    as the application being broken or unsafe and will not try again. For the first user (the owner)
    this costs nothing. It becomes the single biggest barrier to adoption the moment the repository
    is shared, and the repository is already public.
    There is no data-loss or security consequence: the build is still signature-verified for
    AUTO-UPDATES by the separate Tauri updater keypair (key id AB3536BDD39983C5, proved end to end
    in plan 11-05), which is a different trust root from Apple code signing. Only the first install
    is unverified by Apple.
  automatable: |
    NO, not the purchase. Enrolling in the Apple Developer Program, creating a Developer ID
    Application certificate and creating an App Store Connect API key are owner actions behind a
    paid account and Apple's identity verification.
    YES, everything after it. Once the six secrets exist on HighKnow-ai/flywheel, plan 11-07's
    Tasks 2 and 3 run as written with no replanning: the signing and notarization env in
    `release.yml`, and `scripts/release/verify-gatekeeper.sh` asserting `spctl --assess` and
    `codesign --verify` against the downloaded artifact. Redeem by pushing a throwaway tag and
    reading the verification script's output, then deleting the tag and release - the same shape
    plans 11-04 and 11-05 both used successfully.
  update_11-08: |
    CONFIRMED first-hand on the released v0.1.0 (2026-10-14): `codesign -dv` reports Signature=adhoc,
    TeamIdentifier=not set; `spctl --assess --type execute -vv` rejects it (exit 1); `stapler validate`
    finds no ticket. Same for v0.1.1. Nothing was bypassed. The release is public and `releases/latest`
    resolves to it, so the first-run cost described above is now live. See 11-RELEASE-EVIDENCE.md section 3.

- id: D-REV-63
  phase: "11 — Ship It (plan 11-19)"
  truth: "The rail's 'Remove from Flywheel...' reads as a reversible hide and not a delete: its confirmation names the board, worktrees, runs and activity trail as kept, and the new row sits acceptably beside 'Register Project...'."
  status: open
  why_deferred: |
    Human aesthetic and comprehension judgment: whether the sentence reads as 'nothing is lost' to a
    person is not something an assertion can establish. The sentence's content (it names all four kept
    artefacts and says nothing is deleted) and the call to project_hide are asserted in
    project-rail.test.tsx; how it reads and looks is not.
  risk_if_wrong: "Low to moderate: a person declines a safe action because it reads like a delete, or the row clutters the project section."
  automatable: "Partly. The copy's content is already asserted. The reading and the look need a person, on an installed build in Light and Dark, with two projects registered."

- id: D-REV-64
  phase: "11 — Ship It (plan 11-19)"
  truth: "A hidden project can be listed and restored from inside the app, including the duplicate 'unreachable' registration that D-200 was written for."
  status: open — known limit of plan 11-19
  why_deferred: |
    No physical reason: it is unbuilt. project_restore exists and is tested at the core level, but nothing
    in the renderer calls projectRestore and no surface lists hidden projects. The UI route back today is
    registering the repository again, which restores the project whose marker names that path. The
    duplicate has a different id and its path's marker names the other project, so that route restores
    the active project, not the duplicate. Data is safe; recovery is a command, not a button.
  risk_if_wrong: "Moderate for 'a hidden project must not be a lost project': the project is intact in SQLite but unreachable from the surface without a developer."
  automatable: "YES once built: a hidden-projects list (Settings or the rail) calling projectRestore, with a jsdom test. A small plan; the owner may prefer to defer it past ship."

# Register integrity note, 2026-10-14 (orchestrator)
#
# Plan 11-19 filed two entries as D-REV-61 and D-REV-62, numbers already taken by plan 11-06
# (the update banner, never seen in a running window) and plan 11-08 (what a first-time user sees
# when opening the unsigned v0.1.0). The duplicates were renumbered to D-REV-63 (the rail's
# "Remove from Flywheel..." confirmation reading as a hide rather than a delete) and D-REV-64
# (no in-app way to list or restore a hidden project). 11-19's SUMMARY was updated to match.
# The originals at D-REV-61 and D-REV-62 are unchanged. Every id in this file is now unique;
# plan 11-21 should allocate from D-REV-65 onward.
