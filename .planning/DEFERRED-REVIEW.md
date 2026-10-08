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
  status: unreviewed
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
  risk_if_wrong: "Moderate. The join between the three panes and the file-list row (a long path wraps its extension onto a second line at the 30 percent column) has only been judged by its builder."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer against those paths now; it needs no human."

- id: D-REV-16
  phase: "08.1 — Visual Polish (plan 17)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group four (the live session surface, its feed, the permission request card, the raw log, the launch sheet), raises nothing material that is not fixed or recorded."
  status: unreviewed
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
  risk_if_wrong: "Moderate. The reviewer may find that the header (a back link, a title, a status, a cost strip and up to four actions in one row) reads as crowded; that the three ink-bordered controls in the open launch sheet (the focused field, the chosen mode, Start Work) compete; or that the 10px system-notice role is too small. The first two were judged by their builder only."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer against those paths now; it needs no human."

- id: D-REV-17
  phase: "08.1 — Visual Polish (plan 18)"
  truth: "The shipped impeccable-finish-reviewer, run once against 08.1-UI-SPEC.md's contract (NO comp was rendered for this group) for surface group five (settings and its permission-rules table, the triage surface, the authoring tray with its rows and amend editor, the published legend, and the done warning's overlay tier), raises nothing material that is not fixed or recorded."
  status: unreviewed
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
  risk_if_wrong: "Moderate. The reviewer may find that a triage row's six drawn actions plus a reject-reason field read as a wall; that the chosen segment (an ink edge and a 2px foot rule, no weight change) is too quiet next to its neighbours at a glance; or that the legend's developer-voice copy is a problem (recorded in deferred-items.md). The first two were judged by their builder only."
  automatable: "YES. The orchestrator can spawn impeccable-finish-reviewer against those paths now; it needs no human."
