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
  status: contradicted-by-measurement
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
  status: "ran 2026-10-08, disposition fix, 8 material findings — each fixed, applied in part, or recorded (see update_08.1-14-closure). NOT re-reviewed: the fixes have had no second independent pass."
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

- id: D-REV-12
  phase: "08.1 — Visual Polish (plan 14 finish review)"
  truth: "The board group, mounted inside the real app shell (App.tsx and BoardView, not a test page of components), matches the approved comp: the masthead, the threadfin / epics / tasks subhead, the Group by Epic / Status lens toggle, the summary line, and the filter bar in its real place above the rack."
  status: unreviewed
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

- id: D-REV-13
  phase: "08.1 — Visual Polish (plan 14 finish review)"
  truth: "A task row's tail should print nothing for a zero criteria count (0/0) or for no priority, as the finish reviewer asks, extending A-03's rule for the change cue."
  status: needs-owner-decision
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


- id: D-REV-14
  phase: "08.1 — Visual Polish (plan 15)"
  truth: "The shipped impeccable-finish-reviewer, run against the approved item-detail comp and 08.1-UI-SPEC.md for surface group two (the detail panel, the command palette, the five pickers), raises nothing material that is not fixed or recorded."
  status: "ran 2026-10-08, disposition fix, 8 material findings — each fixed, applied in part, or recorded (see the Finish-review closure in 08.1-15-SUMMARY.md). NOT re-reviewed: the fixes have had no second independent pass."
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

- id: D-REV-15
  phase: "08.1 — Visual Polish (plan 16)"
  truth: "The shipped impeccable-finish-reviewer, run once against the approved review comp and 08.1-UI-SPEC.md for surface group three (the review surface, the criteria rail, the file diff, the merge confirm sheet, the epic request sheet), raises nothing material that is not fixed or recorded."
  status: "ran 2026-10-08, disposition fix, 7 findings: each fixed, applied, or declined with a reason (see the Finish-review closure in 08.1-16-SUMMARY.md). NOT re-reviewed: the fixes have had no second independent pass."
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

- id: D-REV-16
  phase: "08.1 — Visual Polish (plan 17)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group four (the live session surface, its feed, the permission request card, the raw log, the launch sheet), raises nothing material that is not fixed or recorded."
  status: "ran 2026-10-08, disposition fix, 7 findings: each fixed, applied, or declined with a reason (see the Finish-review closure in 08.1-17-SUMMARY.md). NOT re-reviewed: the fixes have had no second independent pass."
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

- id: D-REV-17
  phase: "08.1 — Visual Polish (plan 18)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group five (settings and its permission-rules table, the triage surface, the authoring tray with its rows and amend editor, the published legend, and the done warning's overlay tier), raises nothing material that is not fixed or recorded."
  status: "ran 2026-10-08, disposition fix, 10 findings: each fixed, applied, or declined with a reason (see the Finish-review closure in 08.1-18-SUMMARY.md). NOT re-reviewed: the fixes have had no second independent pass."
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

- id: D-REV-18
  phase: "08.1 — Visual Polish (plan 19)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group six (the first-run state, the unreachable project, the registration flow, and the delete, done-warning and orphan-recovery confirmations), raises nothing material that is not fixed or recorded."
  status: "ran 2026-10-08, disposition fix, 6 findings: each fixed, applied, or declined with a reason (see the Finish-review closure in 08.1-19-SUMMARY.md). NOT re-reviewed: the fixes have had no second independent pass."
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

- id: D-REV-19
  phase: "08.1 — Visual Polish (plan 21)"
  truth: "The shipped impeccable-finish-reviewer, run once against the approved review comp (comps/review.html, .action-row) and 08.1-UI-SPEC.md for the CHANGED foot of the review surface's criteria column (the `Review decision` group: Request changes beside Merge, the sent-back, nothing-unchecked and no-criteria notes, the could-not-send alert) and for the Review feedback section the launch sheet gained, raises nothing material that is not fixed or recorded."
  status: "NOT RUN. No independent finish-review has seen the changed foot, the decline path's copy, or the launch sheet's new section. Nothing here is a reviewer finding; there are none."
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
  status: "NOT RUN. Six reviewers ran once each and all returned `disposition: fix`; their findings were applied; none has been re-run against the fixes, and plan 21's changed foot has never been seen by one."
  why_deferred: |
    No physical reason. This is an unexecuted automated step, queued only because the plan 20 executor has no
    subagent tool (Read, Write, Edit, Bash, Skill) and so could not spawn the reviewer or the documenter. It
    duplicates D-REV-11 and D-REV-14 to D-REV-19 deliberately, as one batch. Until it is run, nothing in
    Phase 8.1 may be described as passing an independent review after its fixes.
  risk_if_wrong: "Moderate and cumulative: seven groups were finished by their builders and corrected by findings, and the corrections are unreviewed. The app shell has never been reviewed at all (D-REV-12)."
  automatable: "YES. Capture the groups (`npm run test:browser`, `npm run test:browser:dark`, then `git checkout --` the Phase 8 UAT screenshot directory), widen the capture to mount BoardView/App (D-REV-12), and spawn impeccable-finish-reviewer once per group from the orchestrator. No human."

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

- id: D-REV-28
  phase: "08.1 — Visual Polish (plan 20)"
  truth: "The brand carries progress, the commits-ahead count and the focus ring, and nothing else (08.1-UI-SPEC.md, the brand rule's four permitted uses)."
  status: needs-owner-decision
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
  status: needs-owner-decision
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
