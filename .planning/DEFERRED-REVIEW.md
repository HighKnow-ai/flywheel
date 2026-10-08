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

## Redemption protocol

At Phase 11, with an installed, usable build:

1. Re-read each item's `truth` and ask whether it is still a question. Several
   will have been answered by then by ordinary use — say so and close them.
2. Do every item marked `automatable: YES` as a test FIRST, before asking the
   owner anything. On the 2026-10-07 evidence that is most of them.
3. Only what survives both steps reaches the owner, in ONE pass.
4. Items whose `status` is `contradicted-by-measurement` or needs a decision are
   owner questions, not tests — group them separately and ask them as decisions.
