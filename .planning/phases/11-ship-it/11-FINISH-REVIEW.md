---
phase: 11-ship-it
plan: 17
type: finish-review-record
reviewed: 2026-10-13
register_ids: [D-REV-11, D-REV-12, D-REV-14, D-REV-15, D-REV-16, D-REV-17, D-REV-18, D-REV-19, D-REV-26]
---

# Phase 11 Plan 17: Finish review, second pass

Nine runs of `impeccable-finish-reviewer` over captures regenerated on 2026-10-13, every finding carrying a disposition and its evidence.

## How the reviewers were run

- **Capture first.** `npm --prefix packages/desktop run test:browser` and `test:browser:dark` were run green (15 files, 125 passed + 1 expected fail, in each scheme) after the new captures were added and again after the fixes, and the full jsdom suite is green at the end (`npm --prefix packages/desktop test`: 87 files, 1454 passed + 2 expected fail); the Phase 08 UAT screenshots the browser arms overwrite were restored with `git checkout --`. The captures live in `.impeccable/review/` (gitignored). Two captures were ADDED because a group's truth names a surface that had none: the board mounted in the real app shell (`board-shell-built-*`, D-REV-12, commit 3d5ccfe) and the launch sheet's Review feedback section (`session-group-built-*-launch-sheet-feedback-*`, D-REV-19, commit a451e19); a third, the permission-rules table (`admin-group-built-*-settings-rules-*`, commit 9d6042d), was added after the group-five reviewer reported it could not see it.
- **Spawn mechanism, stated plainly.** The executor of this plan has no Agent tool, so it could not spawn the reviewer as a subagent. Each run was instead a fresh `claude -p --agent impeccable:impeccable-finish-reviewer` process (claude 2.1.287, the registered agent definition, its own system prompt), started from the repository root with `--allowedTools "Read,Glob,Grep"`, `--permission-mode default`, `--no-session-persistence` and no shared context with the builder. That is an independent pass in the sense D-24 asks for: a separate agent that did not write the code. It is not an in-thread self-review, and it did not use the harness's Task path.
- **Briefs.** One shared brief (Appendix A) plus a per-group tail (Appendix B). Each tail names the captures, whether a comp exists, and the source files to sample. Groups four, five and six, and the permission-rules follow-up, are marked **NO comp: judged against the contract alone**, and the reviewer was told not to invent a comparison. The brief also named the decisions already taken (the no-filled-buttons ruling, the AA ceiling on selection weight, D-198 and D-199 as locked but not yet implemented) so a reviewer would tag, not re-litigate, them.
- **What the reviewers judged.** The captures as they stood BEFORE the fixes in this plan. The captures now on disk show the fixed groups; no reviewer has seen them.

## Runs

| group | register id | surface | judged against | reviewer disposition | material fixes returned | what the reviewer says it did not read |
|---|---|---|---|---|---|---|
| one | D-REV-11 | board and rail (group one) | comp: mission-control-{light,dark}.png | `disposition: fix` | 8 | not read: the two rendered-DOM files; DESIGN/UI-SPEC/AMENDMENTS only searched; of the sampled sources only `ChallengeRow.tsx` read and `BoardRow.tsx` searched. |
| two | D-REV-14 | detail panel, command palette, five pickers (group two) | comp: item-detail-{light,dark}.png | `disposition: fix` | 8 | not read: DIRECTION, UI-SPEC (one grep), `CommandPalette.tsx` and the picker sources. |
| three | D-REV-15 | review surface, criteria rail, file diff, merge sheet (group three) | comp: review-{light,dark}.png | `disposition: fix` | 6 | not read: DESIGN.md/PRODUCT.md content, most of DIRECTION and UI-SPEC, `CriteriaRail.tsx`, `MergeConfirmSheet.tsx`, `EpicRequestSheet.tsx`. The foot was left to review-foot by instruction. |
| four | D-REV-16 | live session surface, feed, permission card, launch sheet (group four) | NO comp: judged against the contract alone | `disposition: fix` | 8 | not read: DIRECTION, AMENDMENTS, PRODUCT, DESIGN, `RawLogView.tsx`, `PermissionRequestCard.tsx`, `LaunchSheet.tsx`. There is no raw-log capture. |
| five | D-REV-17 | settings, triage, tray, legend, done warning (group five) | NO comp: judged against the contract alone | `disposition: fix` | 8 | not read: the permission-rules table (below the fold of both settings captures; see five-rules); the done warning was judged from the group-six capture. |
| five-rules | D-REV-17 | settings permission-rules table, captured after the group-five run could not see it | NO comp: judged against the contract alone | `disposition: fix` | 5 | not read: DESIGN, PRODUCT, DIRECTION content, most of UI-SPEC, `SettingsSurface.tsx`. |
| six | D-REV-18 | first-run, unreachable, registration, delete, done-warning, orphan recovery (group six) | NO comp: judged against the contract alone | `disposition: fix` | 5 | not read: the bodies of PRODUCT/DESIGN/DIRECTION, `RegisterProjectFlow.tsx`, `FirstRun.tsx`, the type-scale and motion sections of UI-SPEC. |
| review-foot | D-REV-19 | changed foot of the review criteria column and the launch sheet's Review feedback section | comp: review-{light,dark}.png `.action-row` (foot); none for the launch sheet | `disposition: fix` | 3 | not read: the HTML twins, DIRECTION, UI-SPEC, `CriteriaRail.tsx`. Not captured: the nothing-unchecked and no-criteria notes and the could-not-send alert. |
| app-shell | D-REV-12 | the board mounted in the real app shell (`<App />` -> `AppShell`) | comp: mission-control-{light,dark}.png | `disposition: fix` | 7 | not read: PRODUCT.md (existence not confirmed), `FilterBar.tsx`, `App.css`, AMENDMENTS beyond a grep, the two HTML captures. Persistence reported FAIL (partial). |

**No reviewer returned `disposition: ship`.** Every one of the nine runs returned `fix`, with 58 material fixes in total. A verdict with findings is a real result and is recorded as one. D-REV-26's truth, "raises nothing material that is not fixed or recorded", is satisfied only in the sense that every finding below has a disposition; the groups did not pass the reviewer, and the fixed items have not had a second reviewer pass.

## Findings

Severity is the reviewer's, copied from its line. Dispositions are decisions, not the reviewer's suggestion: `fixed` names the commit and the assertion; `rejected` quotes the contract sentence or the code comment that makes the finding not a finding; `recorded` is a real finding outside this plan, listed for board filing under D-196 in plan 11-21 or addressed to plan 11-18. The first cell is the group; `five-rules` is the group-five follow-up; rows ending `-9`, `-4` (review-foot) and `four-9` are coverage gaps, not reviewer findings.

| group | id | finding | severity | disposition | evidence |
|---|---|---|---|---|---|
| one | one-1 | Rail lacks the comp's live counts (Agents, Worktrees, In review, Challenges). | high | recorded | `ProjectRail.tsx` reads only the blocked queue and the recovery summary (`useBlockedQueue`, `useRecoverySummary`); four more counts are new reads and a design addition to a decided surface, not a regression. For D-196 board filing in plan 11-21. |
| one | one-2 | Task-row change cue sits before the key and pushes it out of its column; move it to the tail. | medium | recorded | In `BoardRow.tsx`, one of the five files plan 11-18 edits this wave: addressed to 11-18, not edited here. The key-alignment half is governed by D-198.4 (key alignment on pill-bearing rows is left as it is). If 11-18 does not take the tail move, 11-21 files it under D-196. |
| one | one-3 | Task key should be muted and regular weight, not ink at 600, so the title carries the row. | medium | recorded | `BoardRow.tsx:479`, a file plan 11-18 owns: addressed to 11-18. A typography call against the comp, not a defect; for D-196 if 11-18 leaves it. |
| one | one-4 | Change cue is too faint (outline triangle, tiny dot) and the epic header's cue floats ~300px short of the right edge. | medium | recorded | A-05 decided the glyphs (`Triangle`, `Dot`); size, fill and position are a visual-design call spanning `BoardRow.tsx` (11-18's) and `EpicHeaderRow.tsx`. For D-196. |
| one | one-5 | Challenge row's uppercase QUESTION / TASK label should become the comp's quiet descriptor. | medium | rejected | Craft floor, Refuse list: "A kicker or eyebrow above a heading." `ChallengeRow.tsx:92-98` sets the label inline beside the title on one 48px line, above nothing; it names the proposal's kind, which the row needs. The group-five reviewer holds this inline form as the pattern the tray row should follow (see five-1). |
| one | one-6 | Rail wordmark is gone and the selected project is an outlined box, not a filled surface. | low | recorded | The rail brand is an ink mark with the accessible name "Flywheel by HighKnow" (`ProjectRail.tsx:179`, A-08(c) drew the identity marks); a wordmark or a selection fill reopens a rail identity decision. For D-196. |
| one | one-7 | "No epic" distribution caption wraps ("186 / open"). | low | fixed | `App.css` epic-row template: distribution column 150px to 200px. `board-group.browser.test.tsx` now asserts every distribution label is one line at 1440px (red before the fix: `"1 active, 181 in review, 186 open" wraps at 1440px: expected 2 to be 1`). Commit dfe2cd5. |
| one | one-8 | `0/0` criteria count and "No priority" glyph still print in the task-row tail. | low | recorded | Locked decision D-198.1; implemented by plan 11-18 in `BoardRow.tsx`. Not a new board item. |
| two | two-1 | Detail title is 15px; the comp's focal title is about 20px. | medium | recorded | The panel's title is the DESIGN.md Heading step by decision; raising it is a type-scale amendment (owner). For D-196 as an owner decision. |
| two | two-2 | Panel prints status and priority as words only; the comp pairs a mark with each. | medium | recorded | `ItemDetailPanel.tsx` value column draws words; adding the registry marks is a panel redraw with its own layout re-measure. For D-196. |
| two | two-3 | Path value shows an ellipsis detached from its text ("...   eel/worktrees/..."); reviewer blames `text-align: left` on the rtl box. | medium | recorded | The stated remedy does not work: a scratch WebKit test (discarded) rendered the same `detail-clip-left` button at 330px with `text-align` left, start, right and unset, and all four drew identically. The gap is WebKit's glyph-granular rtl ellipsis; it needs another technique (for example truncating the middle in script). For D-196. |
| two | two-4 | Activity prints the raw event type ("criterion created x8") instead of a human verb. | low | recorded | `ActivityTrail.tsx` strings are tested copy; mapping event types to verbs is a copy contract change. For D-196. |
| two | two-5 | Two 2px lead edges in one panel (Start Work and Watch Live). | low | rejected | DESIGN.md: "Lead action: the one leading action in a region has the 2px ink edge. Examples: Start Work on a task, Continue Shaping on an epic, Watch Live in Runs, ...". Runs is its own section with its own lead; `ItemDetailPanel.tsx:257` and `RunsSection.tsx:276` say "one leading action per section". |
| two | two-6 | Palette and worktree links mix title case and sentence case, and use "..." for "…". | low | recorded | Palette labels and the keyboard map are contract strings under test; normalising is a copy pass over many tested strings. For D-196. |
| two | two-7 | Two criteria rows show their edit pencil at the same time. | low | rejected | `item-detail.css:195-199` reveals the pencil on `.criterion-row:hover`, `:focus-within` and `[data-focused="true"]` independently, so hover on one row with the cursor on another shows two by design; the capture's pointer rests on a row while row 1 is the cursor row. |
| two | two-8 | Run status and spinner paint the brand blue. | low | recorded | Addressed to 11-18: D-199 widens the brand rule to the run status, so this stops being a finding when it lands. |
| three | three-1 | Pane order: the build runs criteria, files, diff; the comp runs files, diff, criteria (right). | high | recorded | `ReviewSurface.tsx` cites plan 08-06's layout; DESIGN.md records "Adoption covered the comps, not the build". Reversing a Phase 8 layout is a topology amendment none of A-01 to A-09 covers: an owner decision. For D-196. |
| three | three-2 | File list is a 380px column with two rows; the diff is cut off at 1440px and the path wraps mid-name. | high | recorded | The column is `clamp(260px, 30%, 380px)` in `ReviewSurface.tsx` and is the same decision as three-1. The diff "cut off" half is by design: review.css, "Code does not wrap ... a long line scrolls the pane sideways". For D-196 with three-1. |
| three | three-3 | No +/- sign column: added and removed rows differ by tint (and by which gutter holds the number). | high | fixed (11-22, owner pulled forward 2026-10-13) | `review.css` says change is carried by "the row tint and the +/- gutter" and no sign is drawn. Closed in plan 11-22: `FileDiff.tsx` `renderGutter` draws a `+`/`-` text sign; `diff-markers.browser.test.tsx`, both schemes. Original note follows. A sign needs a `renderGutter` change in `FileDiff.tsx` plus `review.css` (plan 11-18's) and a legibility re-measure. Accessibility-flavoured, so D-196 as high. |
| three | three-4 | Code-area tint is 3%, so a changed row reads as a gutter strip. | medium | recorded | `review.css`, a file plan 11-18 owns: addressed to 11-18. The 3% is the 08.1 AA decision `legibility.browser.test.tsx` measures against. |
| three | three-5 | Hunks render without `@@` headers. | medium | recorded | `FileDiff.tsx:174` renders bare `<Hunk>`; headers need a per-hunk `Decoration` and a style in `review.css` (11-18's). For D-196. |
| three | three-6 | Merge sheet title breaks inside a branch name ("fly-7-" / "integration"). | low | fixed | `MergeConfirmSheet.tsx`: each branch name is an inline-block unit. `review-group.browser.test.tsx` merge-sheet test asserts each name is one box no taller than a line; `merge-sheet.test.tsx` updated. Commit dfe2cd5. Red before the fix was structural (the spans did not exist), not a measured wrap. |
| four | four-1 | Header title is the word "Session"; the surface never names the task or key it serves. | high | fixed (11-22, owner pulled forward 2026-10-13) | Closed in plan 11-22: new `task_header`/`epic_header` core reads, the header shows `KEY title` and falls back to `Session`. Original note follows. `SessionSurface.tsx:1088`. The surface receives `taskId` only and no read returns a task by id (the board lists and the launch sheet's packet are the only sources), so it needs a new core command or a project-keyed cache read. It restates the Core Value (every unit of agent work anchored to a board item), so file for D-196 as high. |
| four | four-2 | Developer turns are painted in the brand (`--accent-text-rack`). | medium | recorded | `FeedRow.tsx:458`, a file plan 11-18 owns: addressed to 11-18. NOTE for 11-18: D-199 widens the brand rule to text links, the run status and the live authoring stage, NOT to the developer's turn (D-REV-28 held that open), so its enforcement test will flag this site unless it moves to ink or is amended. |
| four | four-3 | Launch sheet: the focused field's 2px ink ring competes with Start Work's 2px lead. | medium | rejected | The ink ring is a decided, tested treatment: `session-group.browser.test.tsx` asserts the field's focus is `outline` 2px solid in `selectionRule` ("the ink rule, not the brand and not the system ring", 08.1-17 closure). Reversing it is a contract change, not a polish fix. |
| four | four-4 | Disclosure glyphs and the back arrow are text characters (▸ ▾ ←), in two sizes and inks. | medium | recorded | `FeedRow.tsx` (11-18's) and `SessionSurface.tsx`: addressed to 11-18; the drawn-icon swap is a floor point ("glyph icons") for D-196 if 11-18 leaves it. |
| four | four-5 | Permission card prints the raw JSON payload instead of the command; put the JSON behind a disclosure. | medium | rejected | `PermissionRequestCard.tsx` documents that "the raw command still renders in Mono beneath this text either way": on an approval card the approver must see exactly what will run. Hiding the payload behind a disclosure reduces what the gate shows; a presentation of the command ahead of it can be added without hiding it, but that is a feature, not this finding. |
| four | four-6 | Authoring header: stage strip and commands run together. | low | recorded | `SessionSurface.tsx` header, an eight-item row; grouping is a layout pass. For D-196. |
| four | four-7 | Completed terminal row only repeats the header badge. | low | recorded | `SessionSurface.tsx`; the failed row carries an outcome notice, the completed row does not. For D-196. |
| four | four-8 | Retry notice is 10px. | low | recorded | Addressed to 11-18: locked decision D-198.3 (10px survivors move to 11px). |
| four | four-9 | Coverage gap: no capture of the raw log (D-REV-16's truth names it) and the cost strip never shows (the fixture has no cost). | medium | recorded | Not reviewed, said plainly. `RawLogView.tsx` has no capture in `session-group.browser.test.tsx`. For D-196 / 11-21 as a missing capture. |
| five | five-1 | Proposal row stacks its uppercase kind label above the title; the challenge row it twins sets it inline (floor: eyebrow). | high | recorded | `ProposalRow.tsx:316-323`: the header strip (icon, kind, verb) sits above `PayloadFields`; inline needs a restructure of three payload variants and the amend editor. For D-196 as high; it is the one finding whose remedy the group-one reviewer contradicts. |
| five | five-2 | Triage rows draw sixteen boxed buttons and four open reason fields in one viewport; demote Merge and Defer to the text action, reveal the reason on Reject. | high | recorded | DESIGN.md has the device ("Text action: a caret and no box, for the lower-ranked answer"). Applying it to triage reverses the 08.1-18 closure's direction, so it needs an owner call. For D-196. |
| five | five-3 | The lead "Accept task and its N criteria" is fourth in reading order. | medium | recorded | `ProposalRow.tsx` renders it fourth by design ("One lead per row: the subtree accept where there is one"). The app's other clusters put the lead last (Start Work, Merge), so first is not the convention either. A convention decision for D-196. |
| five | five-4 | Settings uses two alignment systems (controls under the heading vs flush right at 1416px). | medium | recorded | Layout pass over `SettingsSurface.tsx` and `admin-surfaces.css`. For D-196. |
| five | five-5 | Legend draws priority bars in a bordered box; the board draws them unboxed. | medium | rejected | `Legend.tsx` `swatchStyle`: "Every other mark is drawn in ink on one neutral swatch: the glyph and the printed word carry the meaning." Every legend mark sits in the swatch, status marks included; only `boxed` marks (the S/M/L estimates) imitate the row. |
| five | five-6 | Task and criterion carry the same kind icon. | low | recorded | `ProposalRow.tsx`; the label already carries the kind. For D-196. |
| five | five-7 | Checkboxes and the number spinner are unthemed browser surfaces. | low | recorded | `admin-surfaces.css`, `SettingsSurface.tsx`. For D-196. |
| five | five-8 | `0/0` and the empty "No priority" tail (seen on the done-warning capture). | low | recorded | Addressed to 11-18: locked decision D-198.1. |
| five | five-9 | Coverage gap: both settings captures cut off at the Permission Rules heading, so the table was not reviewed. | medium | fixed | `admin-group.browser.test.tsx` now also captures the table (`admin-group-built-{scheme}-settings-rules-1440x900.png`); a follow-up reviewer run reviewed it (rows five-rules-1 to 5). Commit 9d6042d. |
| five-rules | five-rules-1 | The table's right edge (~924px) aligns with no other section edge (dividers and controls end at 1416px). | medium | recorded | `admin-surfaces.css:341-347` caps the table at 900px with a recorded reason ("A column, not a band"). A shared measure for the whole settings column is a layout decision. For D-196. |
| five-rules | five-rules-2 | An ellipsized tool name hides the name of a granted authority. | medium | fixed | `PermissionRulesTable.tsx`: Project and Tool cells carry `title`. jsdom test "truncates a long tool name..." asserts it (red before); the WebKit fixture's long name now genuinely overflows and asserts the title. Commit e0d06e9. |
| five-rules | five-rules-3 | Revoke has no pending or failure state: a double click fires twice and a failure shows nothing. | medium | fixed | `PermissionRulesTable.tsx`: Revoke disabled while that rule's write is in flight; a failed revoke is named in a `role=alert` line and the row stays. Two new jsdom tests (red before). Commit e0d06e9. |
| five-rules | five-rules-4 | Every Revoke button has the same accessible name. | low | rejected | `settings-surface.test.tsx`: "the `Revoke` action's copy is exactly 'Revoke'" (02-10-PLAN, 02-UI-SPEC Copywriting Contract); an `aria-label` would change the button's accessible name. |
| five-rules | five-rules-5 | Decision and Granted headers match their values in size and colour. | low | recorded | `admin-surfaces.css` `.admin-table-head`. For D-196. |
| six | six-1 | Unreachable state buries the repo path in proportional prose; give it its own mono line. | medium | fixed | `ProjectUnreachable.tsx`: the path is its own `.state-path` span (mono). Adapted: the sentence is the Copywriting Contract's (01-UI-SPEC: "Flywheel expected {project_name} at {last_known_path}, but the repository marker there no longer matches..."), so the path stays inside it rather than on its own line. `states-group.browser.test.tsx` asserts the span, the mono face and the exact sentence (red before). Commit dfe2cd5. |
| six | six-2 | Orphan modal prints its consequence line after Kill All and Leave them running. | medium | fixed | `OrphanRecoveryModal.tsx`: the footnote now sits above `.confirm-actions`. `states-group.browser.test.tsx` asserts DOM order and position (red before). Commit dfe2cd5. |
| six | six-3 | Per-row "Running (from a previous session)" repeats the heading three times. | low | recorded | Tested copy beside a pulse glyph (the word pairs the glyph); tightening the row is a copy decision. For D-196. |
| six | six-4 | Orphan modal shows item keys in mono; the board draws keys in bold sans. | low | recorded | Mono keys in this modal are under the Phase 2 Mono contract; one key face across the product is a cross-surface type decision. For D-196. |
| six | six-5 | Recovery spinner paints `--accent-text-rack` (a run status). | low | recorded | Addressed to 11-18: `OrphanRecoveryModal.tsx:243`; D-199 permits the run status. |
| review-foot | review-foot-1 | Merge label dropped the comp's "into epic". | medium | recorded | DESIGN.md names the control "Merge in the review foot"; the foot serves task and epic scope and the sheet it opens names both branches. A copy call for the owner. For D-196. |
| review-foot | review-foot-2 | Sent-back note is the same muted 11px as the hint it replaces; give it primary colour. | low | recorded | `.review-decision-note` is in `review.css`, a file plan 11-18 owns: addressed to 11-18. |
| review-foot | review-foot-3 | The launch-sheet capture's Review feedback line paraphrased its criterion. | low | fixed | My own capture fixture. `session-group.browser.test.tsx` now takes the feedback statements from THRE-58's real criteria and asserts each appears word for word in the Acceptance Criteria list. Commit dfe2cd5. |
| review-foot | review-foot-4 | Coverage gap: the nothing-unchecked note, the no-criteria note and the could-not-send alert were not captured, so they were not reviewed. | medium | recorded | Judged from `DecisionFoot.tsx` copy only. Missing captures; for D-196 / 11-21. |
| app-shell | app-shell-1 | No masthead: no `Mission Control` heading, no `<project> . N epics . N tasks . N worktrees active` subhead, no rule under the title block. | high | recorded | Already recorded as UI-SPEC "Disagrees" 4 and DESIGN.md "Contract versus the built world" 2; this review is the first to see it in the real shell. The comp is code-rendered FIXTURE content adopted 2026-10-07 ("Adoption covered the comps, not the build"); building it adds a surface and a subhead data contract the owner has not decided to ship. Owner decision, for D-196 as the top item. |
| app-shell | app-shell-2 | The lens toggle sits on its own row under the filter bar; DESIGN.md and the comp say one controls row with a right-aligned total. | high | recorded | `BoardView.tsx:1144-1180` draws Group by as a separate band. Either the code or DESIGN.md "Inputs, chips and pickers" is wrong; which is an owner call. DESIGN.md is not edited here. For D-196. |
| app-shell | app-shell-3 | Summary line is one ellipsised nowrap sentence below the controls; the comp has a wrapped paragraph above them with the done fraction. | medium | recorded | `summaryLine.ts` is D-09's fixed rule set; its content and placement are a design change. For D-196. |
| app-shell | app-shell-4 | The rail's top and the board's title block share no line. | medium | recorded | Follows from app-shell-1. For D-196 with it. |
| app-shell | app-shell-5 | "Plan fan-out" on every epic row is not in the comp. | low | rejected | It is shipped Phase 9 product: the dispatch cell, `.field-epic-dispatch` in `App.css` ("The dispatch controls are a field (plan 09-09)"), and DEFERRED-REVIEW D-REV-36's truth names "the epic row's dispatch cell". |
| app-shell | app-shell-6 | `0/0` tails. | low | recorded | Addressed to 11-18: locked decision D-198.1. |
| app-shell | app-shell-7 | Update DESIGN.md after the masthead and controls-row fixes. | low | recorded | Depends on app-shell-1 and 2; moot until they are decided. |

## Totals

- 61 rows: 8 fixed, 8 rejected, 45 recorded. By severity: 9 high, 27 medium, 25 low.
- 58 reviewer findings (58) plus 3 coverage gaps the reviewers named (four-9 raw log, five-9 permission-rules table, review-foot-4 the foot's alternate states). five-9 was closed by adding the capture; four-9 and review-foot-4 are still uncaptured.
- Every fixed finding names a commit and an assertion that was shown red against the unfixed source first (merge-sheet title: structural red only, see three-6); five-9 is a capture addition, not a defect fix, so it has no red.
- The nine `high` findings are: one-1, three-1, three-2, three-3, four-1, five-1, five-2, app-shell-1, app-shell-2. None is fixed here: each is either a design or topology decision for the owner (three-1, three-2, app-shell-1, app-shell-2, five-2), or needs a new read or a restructure beyond this plan (four-1, five-1, one-1, three-3). They are the headline of this review and the first items for the board.

## Register mapping

| register id | answered by | outcome |
|---|---|---|
| D-REV-11 | group one | ran again, `fix`, 8 findings: 1 fixed, 1 rejected, 6 recorded (four of those sit in 11-18's files or are its D-198.1). Not re-reviewed. |
| D-REV-12 | app-shell | ran, `fix`, 7 findings, 1 rejected, 6 recorded. The board was captured mounted in `<App />` (commit 3d5ccfe) and compared against the comp. It does not match: the masthead and subhead are absent, the lens toggle has its own band, the summary is placed and worded differently. |
| D-REV-14 | group two | ran again, `fix`, 8 findings: 2 rejected, 6 recorded. |
| D-REV-15 | group three | ran again, `fix`, 6 findings: 1 fixed, 5 recorded. EpicRequestSheet has no capture. |
| D-REV-16 | group four | ran again, `fix`, 8 findings: 2 rejected, 6 recorded; raw log uncaptured. |
| D-REV-17 | groups five and five-rules | ran again, `fix`, 8 + 5 findings: 2 fixed (both in the rules table), 2 rejected, 9 recorded; the rules table was brought into view by a new capture. |
| D-REV-18 | group six | ran again, `fix`, 5 findings: 2 fixed, 3 recorded. |
| D-REV-19 | review-foot | RAN for the first time (it read NOT RUN), `fix`, 3 findings: 1 fixed, 2 recorded; three alternate foot states uncaptured. |
| D-REV-26 | all of the above | RAN for the first time (it read NOT RUN) as eight groups plus the follow-up. See the totals: it ran and found work; it did not pass. |

## Addressed to plan 11-18

11-18 edits `BoardRow.tsx`, `session/FeedRow.tsx`, `board/pickers/AssigneePicker.tsx`, `styles/type.css` and `review/review.css`; none of them was touched here. Rows that land in those files, or are made moot by D-198 and D-199: one-2, one-3, one-4, one-8, two-8, three-3, three-4, three-5, four-2, four-4, four-8, five-8, six-5, review-foot-2, app-shell-6.

Two are worth saying aloud to 11-18: **four-2** (the developer's turn is painted in the brand, and D-199 does not widen the rule to it, so its enforcement test will flag `FeedRow.tsx:458`) and **three-4 / review-foot-2** (both want changes in `review.css` that the D-199 anchor-widget edit is already touching).

## Plan 11-18 outcome (2026-10-13)

Of the fifteen rows addressed to 11-18, seven fell inside D-197/198/199 and are closed; eight did not and go to 11-21.

- **Closed by D-198.1:** one-8, five-8, app-shell-6 (`0/0` and "No priority" print nothing; `row-tail.test.tsx`).
- **Closed by D-198.3:** four-8 (the retry notice moves from 10px to 11px; `.type-micro` deleted).
- **Closed by D-199:** two-8 and six-5 (the run status and its spinner are a permitted brand use; `brand-rule.test.ts`).
- **four-2 is NOT fixed and NOT closed.** The developer's turn is painted in the brand (`FeedRow.tsx`). D-199 did not cover it, so 11-18 recorded it in `08.1-UI-SPEC.md` as an existing use it did not decide, and the test allowlists it by name. It is the feed's only channel separating the two speakers. File it at 11-21 as an **owner decision**.
- **Left for D-196 filing at 11-21 (outside D-197/198/199):** one-2, one-3, one-4 (the task row's cue position, key weight and cue size; D-198.4 governs the key-alignment half and leaves it), three-3, three-4, three-5 (the review diff's sign column, 3% tint, `@@` headers), four-4 (text-character disclosure glyphs), review-foot-2 (the sent-back note's ink). Of these, **three-4 and review-foot-2 were not in the list below** and must be added to it.

## For plan 11-21 (D-196 board filing)

Recorded rows to file as board items, each with its row id: one-1, one-2, one-3, one-4, one-6, two-1, two-2, two-3, two-4, two-6, three-1, three-2, three-3, three-5, four-1, four-4, four-6, four-7, four-9, five-1, five-2, five-3, five-4, five-6, five-7, five-rules-1, five-rules-5, six-3, six-4, review-foot-1, review-foot-4, app-shell-1, app-shell-2, app-shell-3, app-shell-4. Rows whose only owner is 11-18 are not listed twice. The five owner decisions inside them (three-1, three-2, app-shell-1, app-shell-2, five-2) should be filed as decisions, not tasks.

## What this does and does not establish

- It establishes that eight independent reviewer runs and one follow-up exist over current captures, that every finding has a disposition, and that eight of them are fixed with assertions.
- It does NOT establish that any surface group passes its reviewer, that the shell matches its comp (it measurably does not), or that the fixes are reviewer-approved. Nothing in Phase 8.1 may be described as passing an independent review after its fixes.
- The reviewers returned prose from a capture, not a measurement; where a finding is a claim about the source or a measurement (the path-ellipsis `text-align` remedy, two-3), it was tested and one claim did not survive (recorded in that row).

## Appendix A: the shared brief given to every reviewer

```text

You are running as the registered impeccable-finish-reviewer, a FRESH independent re-review pass requested by plan 11-17 (Phase 11, Ship It). It is a first-time review for the group named below (a prior builder-side or earlier-reviewer pass may exist; you are not given its conclusions as evidence and must judge only what the captures show). Today is 2026-10-13. The captures were regenerated minutes ago by green WebKit runs (`npm run test:browser` and `npm run test:browser:dark`, 1440x900), so they show the CURRENT build, not stale output. You have only Read, Glob and Grep: review from files, never try to render anything. Read PNGs with Read (you can view images). Working directory is the repository root, so paths below are relative to it.

Direction contract and contract documents (the build's world is Mission Control; there is no THESIS/OWN-WORLD block in the usual five-block form, the contract is these files):
  - .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-DIRECTION.md  (the adopted direction)
  - .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md  (the contract: colour and token roles, brand rule, radius language, type scale, motion contract, selection rule, overlay rule, state inventory)
  - .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-AMENDMENTS.md  (owner-approved amendments; grep it, do not read all of it)
  - PRODUCT.md and DESIGN.md at the repository root
  - Craft floor: /Users/cymarechal/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/reference/craft-floor.md
There is no separate QUALITY BAR card file; DESIGN.md and 08.1-DIRECTION.md carry the world's bar. No `.impeccable/mocks/` round exists (the approved comps are the static pages named per group below), so the Persistence check reduces to: PRODUCT.md and DESIGN.md exist and match the built world.

DECISIONS ALREADY TAKEN. A finding that merely asks for the reverse of one of these is not a material fix; name it in `fidelity` as an adaptation citing the decision instead:
  - Owner, 2026-10-08: no filled primary buttons. The primary action is drawn with a 2px ink lead edge; its neighbours take the 1px control edge. Comps that fill the primary are overruled by this.
  - Selection weight is applied as far as AA allows (computed ceiling 1.074 / 1.040 between surfaces; the selection rule carries the distinction).
  - Phase 11 decisions D-198 and D-199 are LOCKED but NOT YET IMPLEMENTED (plan 11-18 implements them after this review): (D-198.1) a `0/0` criteria count and "No priority" will render NOTHING in a task row's tail; (D-198.3) remaining 10px type (feed system notice, assignee picker) moves to the 11px floor; (D-198.4) key alignment on pill-bearing rows is deliberately left as it is; (D-199) the brand rule's permitted uses widen to text links and text actions, the run status and the live authoring stage, and `.review-anchor-widget`'s 2px brand left border becomes a neutral control edge. If you see any of those in the captures, report it as a finding but tag it `addressed-to-11-18` in its line rather than as a new defect.
  - Out of scope for this phase (do not file): README or marketing polish, new brand uses, new features.
Everything in these captures that is labelled FIXTURE is deliberate stand-in data the real board does not have; judge its layout, not its existence.

OUTPUT. Follow your Output Contract exactly: disposition line first, then persistence, fidelity, ceiling, material_fixes, keep. In `material_fixes`, end each line with `[severity: high|medium|low] [file: best-guess source path] [light|dark|both]`. If a section is empty, write it and say `none`. A verdict of `disposition: ship` with no findings is a valid and useful result; do not invent findings to look thorough, and do not omit a real one to look agreeable. Name anything you did not read in the line above the sections. Keep to roughly 10 turns of reading before writing.
```

## Appendix B: per-group brief tail and the reviewer's verbatim return

### one (D-REV-11)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `one` ===
Surface under review: surface group ONE: the board and the project rail (rail, filter bar, epic roster headers, challenge rows, task rows in every selection state, status band, quick-add, issues lane)

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/board-group-built-light-1440x900.png
  - .impeccable/review/board-group-built-dark-1440x900.png
  - .impeccable/review/board-group-built-light-full.png
  - .impeccable/review/board-group-built-dark-full.png
  - .impeccable/review/board-group-built-light.html (rendered DOM with the real stylesheets inlined)
  - .impeccable/review/board-group-built-dark.html (rendered DOM with the real stylesheets inlined)

APPROVED COMP EXISTS: .impeccable/review/mission-control-light.png and .impeccable/review/mission-control-dark.png (source: .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/mission-control.html). Inventory the comp first. NOTE: these captures are a component page, not the app shell; the app shell is reviewed separately as group app-shell, so do not file shell-level gaps (masthead, lens toggle, summary line) here.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/board/BoardRow.tsx, EpicHeaderRow.tsx, ChallengeRow.tsx, StatusBand.tsx, QuickAdd.tsx, FilterBar.tsx, IssuesLane.tsx, packages/desktop/src/projects/ProjectRail.tsx, packages/desktop/src/styles/*.css
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Not read: the two rendered-DOM `.html` captures; `08.1-DIRECTION.md`, `08.1-UI-SPEC.md` and `08.1-AMENDMENTS.md` were only searched for keywords; `PRODUCT.md` and `DESIGN.md` were only checked for existence and keyword matches; of the sampled sources, I read only `ChallengeRow.tsx` and searched `BoardRow.tsx`. `EpicHeaderRow.tsx`, `StatusBand.tsx`, `QuickAdd.tsx`, `FilterBar.tsx`, `IssuesLane.tsx`, `ProjectRail.tsx` and `styles/*.css` went unread. No seed key applies: this is not a concept-roll build.

## persistence
Pass. `PRODUCT.md` and `DESIGN.md` both exist at the repository root. A keyword search of `DESIGN.md` found nothing about the task key's treatment or the wordmark, so I could not confirm those against it. No `.impeccable/mocks/` round exists, so no approval record is needed.

## fidelity
| element | class | evidence |
|---|---|---|
| Rail brand lockup (mark plus "Flywheel" wordmark) | missing | Built shows the mark only; the wordmark beside it is gone. |
| Rail project rows | match | |
| Rail "unreachable" | adaptation | Comp shows muted text aligned right. Built shows a red second line with an icon. Cite: an error state needs a destructive signal. |
| Rail selected project | contradicted (minor) | Comp uses a filled surface; built uses a 1px outlined box. |
| Rail fleet and review-queue counts (Agents 1, Worktrees 5, In review 181, Challenges 3) | missing | Built shows "All agents", "Worktrees" and "Blocked" with no counts. "In review" and "Challenges" are absent. |
| Rail "Register Project…" | adaptation | Cite: real product action. |
| Filter bar | adaptation | Comp shows search, "Has worktree" and a count. Built shows a strip of 17 chips (status, priority, size, worktree, epic, assignee). Cite: the existing BOARD filter feature. The Epic/Status lens toggle belongs to the app shell and is not judged here. |
| Epic header, 64px, two-line identity | match | |
| Epic progress bar plus "15 of 60" | match | Copy differs ("15/60" in the comp); the meaning is the same. |
| Epic stacked status bar plus caption | match, one defect | The "No epic" caption wraps ("186 / open"). |
| Epic agents/proposals stat pair | match | |
| Epic change cue (▲3 ●) | contradicted | Comp: a filled triangle and a solid dot at the row's far right. Built: an outline triangle and a dot so small it reads as a stray period, sitting about 300px short of the right edge. The A-05 icon choice (`Triangle`/`Dot`) is honoured; the size and fill are not. |
| Epic row's right band | contradicted | Built leaves about 290px of empty space to the right of the proposals column. Comp spreads its columns to the edge. |
| Expand chevrons | adaptation | Cite: A-08, where →/← expand and collapse epic headers. |
| Challenge row, 48px, icon plus text | match | |
| Challenge row actions | adaptation | Comp shows "Agent challenge" and one "Answer" button. Built shows Accept and Reject. Cite: these share the proposal mutation path with the tray (T-08.1-32). Neither button is filled, per the owner's 2026-10-08 decision. |
| Challenge-row uppercase kind label ("QUESTION" / "TASK") | added without approval | The comp has no such label. Its wording ("Agent challenge") was dropped and replaced. |
| FIXTURE marker | contradicted (minor) | Comp uses a bordered tag. Built rows put "[FIXTURE]" in brackets inside the title, while the footer uses the bordered tag. Two treatments on one page. |
| Task row, 32px: status icon, key, title | match | |
| Task key treatment | contradicted | Comp: muted, regular weight. Built: primary ink at 600 weight (`BoardRow.tsx:479`). The key now competes with the title, so the comp's hierarchy is inverted. |
| Task-row change cue | contradicted | Comp puts it in the right-hand tail. Built puts it before the key ("△3 · FIX-1"), pushing the key 48px out of its column. |
| Blocked / CI failed pills before the key | adaptation | Cite: D-198.4 leaves key alignment on pill-bearing rows as it is. |
| Size pill ("L") in the tail | adaptation | Cite: the item's size field and the S/M/L filter. |
| "0/0" criteria and the "No priority" glyph in the tail | contradicted, addressed-to-11-18 | Comp leaves the tail empty. D-198.1 removes both. |
| Selection rule (2px ink rule plus surface shift) | adaptation | Cite: A-06(a). The surface shift is faint because of the AA ceiling (1.074 light / 1.040 dark), an accepted decision. |
| "42 more tasks" virtualization line | missing (low) | Comp-only explanatory row; not a product requirement. |
| Status band header | adaptation | Comp shows "IN REVIEW" in small caps. Built shows "In review" in mixed case with a chevron, which matches the epic disclosure language. |
| "No epic" tail in status-lens rows | adaptation | Cite: the epic is unknown when grouping by status. |
| Quick-add input, issues lane | added without approval, cited | Cite: these are in the UI-SPEC state inventory and in this group's scope. |
| TYPE | match | Same sans voice, same weights and scale steps as the comp. |
| MATERIAL | match | Flat ink on paper in both. No imitation material. |

## ceiling
- **Lettering hierarchy:** the comp's two-tone row (muted key, ink title) is the world's main device for a dense rack. The built rows flatten it to ink and ink.
- **Rack geometry:** the epic header leaves its right column unused, so the cue has no fixed place on the right edge the way it does in the comp.
- **Rail as a live instrument:** the comp's rail counts make the rail a second status readout. Without them it is just navigation.
- Light and dark are at parity. No motion moment was judged; these are stills.

## material_fixes
1. Restore the counts in the rail's fleet and review-queue items (agents, worktrees, in review, challenges) as muted numbers aligned right, as in the comp. [severity: high] [file: packages/desktop/src/projects/ProjectRail.tsx] [both]
2. Move the task-row change cue (Triangle count and Dot) out of the space before the key and into the tail, before the size pill, so every key starts in the same column. [severity: medium] [file: packages/desktop/src/board/BoardRow.tsx] [both]
3. Draw the task key muted and at regular weight instead of ink at 600, so the title carries the row as in the comp. [severity: medium] [file: packages/desktop/src/board/BoardRow.tsx:479] [both]
4. Give the change cue the comp's presence on both rows: filled triangle and solid dot, sized so "uncommitted changes" does not read as a stray period. On the epic header, pin it to the row's right edge instead of floating it at about 1120px. [severity: medium] [file: packages/desktop/src/board/EpicHeaderRow.tsx, BoardRow.tsx] [both]
5. Replace the uppercase "QUESTION"/"TASK" label in the challenge row with the comp's quiet muted descriptor, kept beside the actions, in sentence case and not uppercase. [severity: medium] [file: packages/desktop/src/board/ChallengeRow.tsx:92-98] [both]
6. Put the rail's "Flywheel" wordmark back beside the mark, and give the selected project a filled surface instead of an outlined box. [severity: low] [file: packages/desktop/src/projects/ProjectRail.tsx] [both]
7. Stop the "No epic" stacked-bar caption from wrapping ("186 / open"): widen the column or truncate on one line. [severity: low] [file: packages/desktop/src/board/EpicHeaderRow.tsx] [both]
8. Leave the tail empty for a 0/0 criteria count and for "No priority" (D-198.1), tagged addressed-to-11-18. [severity: low] [file: packages/desktop/src/board/BoardRow.tsx] [both]

## keep
The 64/48/32 rack with its hairline dividers, the brand blue confined to progress bars, the unfilled 1px-edge Accept/Reject buttons, and light/dark parity must not be diluted while fixing.
```

</details>

### two (D-REV-14)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `two` ===
Surface under review: surface group TWO: the item detail panel, the command palette, the five pickers

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/detail-group-built-light-panel-1440x900.png
  - .impeccable/review/detail-group-built-dark-panel-1440x900.png
  - .impeccable/review/detail-group-built-light-palette-1440x900.png
  - .impeccable/review/detail-group-built-dark-palette-1440x900.png
  - .impeccable/review/detail-group-built-light-picker-1440x900.png
  - .impeccable/review/detail-group-built-dark-picker-1440x900.png

APPROVED COMP EXISTS: .impeccable/review/item-detail-light.png and .impeccable/review/item-detail-dark.png. Known deliberate gap: the comp's THRE-10 parent key and the Worktree row inside one property grid were not rebuilt (the grid is restored only as far as data exists).

Source files to SAMPLE (do not walk the tree): packages/desktop/src/item-detail/*.tsx, packages/desktop/src/item-detail/item-detail.css, packages/desktop/src/board/CommandPalette.tsx, packages/desktop/src/board/pickers/*.tsx
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Not read: 08.1-DIRECTION.md, 08.1-UI-SPEC.md (one grep, no match), PRODUCT.md (existence checked only), the CommandPalette.tsx source, and the picker sources other than StatusPicker's header. In the item-detail source I only grepped item-detail.css, AcceptanceCriteriaList.tsx and ItemDetailPanel.tsx.

## persistence
Pass. PRODUCT.md and DESIGN.md both exist. DESIGN.md §"The item-detail panel" and §"The command palette" describe what was built: label/value rows that appear only when they have a value, a caret status control with no box, `×n` folding of repeated activity, a pencil revealed on hover, focus or the cursor row, palette section headers in the list, and the ink rule on the highlighted command. There is no `.impeccable/mocks/` round, so no approval record is needed.

## fidelity
Comp inventory (item-detail-light/dark): key row THRE-58 with parent THRE-10; a large focal title at about 20px CSS; a property grid of Status (glyph and word), Priority (bars glyph and word), Estimate, Worktree, and Changes (commits ahead, a dot, uncommitted). Then "Acceptance criteria 0/3" with the count inline and muted, hairline-separated checkbox rows, and an Activity list of human verbs ("added a criterion ×3") with actor and absolute time.

| Element | Class | Evidence |
|---|---|---|
| Key row, parent THRE-10 missing | adaptation | known deliberate gap named in the brief |
| Title focal scale (comp ≈20px, built 15px) | contradicted | Built follows DESIGN.md Heading at 15px, but the comp is the spec for focal scale. No user answer or amendment is cited. |
| Status value: glyph plus word | missing | Panel shows "In Progress ⌄" with no status mark. The comp shows one, and DESIGN.md's row spec pairs glyph and word. |
| Priority value: bars glyph | missing | Built shows "No priority" as text only |
| Estimate "M" vs "2" | adaptation | product truth: T-shirt estimates |
| Worktree row inside the single grid | adaptation | known deliberate gap; DESIGN.md puts Worktree, Path and Changes in their own section |
| Changes row | adaptation | absent with no data; DESIGN.md says "a row appears only when it has a value" |
| Path row and the Remove/Open links | adaptation | DESIGN.md §item-detail |
| Start Work / Review buttons | adaptation | product truth (the core loop) |
| Runs section | adaptation | product truth; DESIGN.md live-session runs |
| Primary drawn unfilled with a 2px ink edge | adaptation | Owner, 2026-10-08 |
| Criteria header count right-aligned vs inline | adaptation, uncited | minor |
| Criteria rows: checkbox and hairlines | match | |
| Activity verb copy ("criterion created" vs "added a criterion") | contradicted | Built prints the event-type name instead of the comp's human verb |
| Activity relative time ("6d ago") vs absolute | adaptation, uncited | minor |
| Palette (no comp) | match to DESIGN.md | Sheet tier, in-list section headers, ink rule on the highlighted row, 8px gutter |
| Status picker (no comp) | match to DESIGN.md | Legend marks reused, 1–5 numerals, ink rule on the current row |
| TYPE | match | Same grotesque face, weights and steps as the comp; the only deviation is the title scale above |
| MATERIAL | match | Flat ink and hairline world, as in the comp; no faked physicality |

## ceiling
The panel does not use the world's own mark vocabulary. The status and priority marks from `legend/marks.ts` appear in the picker and on the rack rows but not in the panel's value column. The one moment of hierarchy, the title, sits at body-adjacent scale, so the panel reads as a form rather than the focal surface it is in the comp. Everything else is reached.

## material_fixes
1. Raise the detail title to the comp's focal scale (20px/1.2/600, the DESIGN.md 20px step), or record an owner amendment demoting it. As built, the panel's focal element is contradicted. [severity: medium] [file: packages/desktop/src/item-detail/item-detail.css] [both]
2. Show the status mark beside the status word and the priority bars beside the priority word in the panel's value column, using the same `STATUS_MARKS`/priority registry the picker uses. Both are missing against the comp and against DESIGN.md's glyph-plus-word rule. [severity: medium] [file: packages/desktop/src/item-detail/ItemDetailPanel.tsx] [both]
3. The Path value renders "…" then a wide empty gap, then "eel/worktrees/…". This is the `direction: rtl` box combined with `text-align: left`, leaving the ellipsis detached from the clipped text. Drop `text-align: left` (or use `text-align: start`) so the ellipsis sits against the text. [severity: medium] [file: packages/desktop/src/item-detail/item-detail.css] [both]
4. Activity copy prints the raw event type ("criterion created ×8"). Map it to the comp's human verbs ("added a criterion ×8"), which is a Truth/Copy point against the comp's activity column. [severity: low] [file: packages/desktop/src/item-detail/ActivityTrail.tsx] [both]
5. Two 2px ink lead edges share one panel (Start Work and Watch Live). The owner rule gives the lead edge to the primary action, so Watch Live should take the 1px control edge, or Start Work should when a run is live. [severity: low] [file: packages/desktop/src/item-detail/RunsSection.tsx] [both]
6. Casing and punctuation drift:
   - Palette mixes title case ("Search Board", "Create Task", "Open Settings") with sentence case ("Move selection down", "Jump to first row").
   - Worktree links mix "Remove Worktree" with "Open in editor".
   - "Type a command..." and "Register Project..." use three periods instead of "…".

   Pick one case and apply it throughout. [severity: low] [file: packages/desktop/src/board/CommandPalette.tsx] [both]
7. The panel capture shows pencils on criteria rows 1 and 2 at once. DESIGN.md says one revealed pencil (hover, focus or cursor row). Confirm hover plus `data-focused` cannot stack, or that this is harness pointer state. [severity: low] [file: packages/desktop/src/item-detail/item-detail.css] [both]
8. The run status "Running" and its spinner use the brand blue before D-199 permits that use. [severity: low] [file: packages/desktop/src/item-detail/RunsSection.tsx] [both] addressed-to-11-18

## keep
Keep the flat ink-and-hairline restraint and the single ink selection rule shared by the palette, the picker and the panel. Fix the title scale and the marks without adding boxes, fills or a second accent.
```

</details>

### three (D-REV-15)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `three` ===
Surface under review: surface group THREE: the review surface, the criteria rail, the file diff, the merge confirm sheet (including its conflict result)

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/review-group-built-light-surface-1440x900.png
  - .impeccable/review/review-group-built-dark-surface-1440x900.png
  - .impeccable/review/review-group-built-light-merge-sheet-1440x900.png
  - .impeccable/review/review-group-built-dark-merge-sheet-1440x900.png
  - .impeccable/review/review-group-built-light-merge-conflict-1440x900.png
  - .impeccable/review/review-group-built-dark-merge-conflict-1440x900.png

APPROVED COMP EXISTS: .impeccable/review/review-light.png and .impeccable/review/review-dark.png (source: .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/review.html). Known deliberate differences: the comp fills its primary (the no-filled-buttons decision overrules it); the comp's page header (title, commit ref) and its Request changes button were not features of this surface when built. NOTE: the criteria column's FOOT (the Review decision group) is reviewed separately as group review-foot; judge the rest here.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/review/ReviewSurface.tsx, CriteriaRail.tsx, FileDiff.tsx, MergeConfirmSheet.tsx, EpicRequestSheet.tsx, review.css
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Not read: the contents of DESIGN.md and PRODUCT.md (I only confirmed both files exist), most of 08.1-DIRECTION.md, the full 08.1-UI-SPEC.md, CriteriaRail.tsx, MergeConfirmSheet.tsx and EpicRequestSheet.tsx. Per the brief, I did not judge the criteria column's foot (the Review decision group).

**persistence**
- Pass. PRODUCT.md and DESIGN.md are both at the repository root. I did not read DESIGN.md, so I have not checked that it matches the built world. There is no `.impeccable/mocks/` round, so no approval record is needed.

**fidelity**
My inventory of the comp: a left nav with the brand and a narrow file list with +/− counts; a centre diff card with a title block; a unified diff with two line-number columns, a +/− marker column, full-width red and green row tints and `@@` hunk headers; the criteria on the right, each with a checkbox and an evidence hint; actions under the criteria. The rows below compare the build against that.

- **Topology (pane order): contradicted.** The comp runs files, then diff, then criteria (right). The build runs criteria (left), then files, then diff. The only justification in the code is a comment in ReviewSurface.tsx citing plan 08-06, which predates the comp the owner adopted wholesale on 2026-10-07. No amendment covers the change, so it is an uncited deviation.
- **File list: contradicted.** The comp has a narrow nav column. The build gives the file list a 380px column holding two rows and empty space below. It takes width from the diff and wraps the path mid-name (`CriteriaRail` / `.tsx`).
- **Diff width: contradicted.** Because of the column above, code lines are cut off at the right edge in both themes at 1440 (line 2, lines 30–38). In the comp, lines run to the card edge.
- **+/− marker column: missing.** The comp marks every changed row with a sign. The build has none, so only colour shows what was added or removed. review.css lines 49–50 say change is carried by "the row tint and the +/- gutter"; no +/− gutter is drawn.
- **Row tint: contradicted.** The comp tints the whole row. The build tints the gutter at 22% and the code area at 3% (review.css lines 28–29), so in light the code area of removed and added lines (2, 5–6, 8) looks white. The diff reads as a coloured gutter strip rather than tinted rows.
- **Hunk headers (`@@ … @@`): missing.** Hunks are rendered without a header (FileDiff.tsx line 174), so the jump between hunks has no divider.
- **Selection mark: match.** The 2px ink rule on the gutter matches the comp (rows 5–6 in the build).
- **Per-row "Check against selection" button and the "Selected: …" line, in place of the comp's "No evidence yet" hint:** acceptable adaptation, citing D-139/D-140 (the gutter as the click target, a check against the current selection).
- **Title bar with ← Board, This task / Whole epic and the branch path; no commit-ref header:** acceptable adaptation, per the brief's known differences.
- **Primary action (Merge, and Merge / Attempt merge in the sheet) drawn with a 2px ink edge, not filled:** acceptable adaptation, per the owner's no-filled-buttons decision of 2026-10-08.
- **Merge sheet and conflict result (no comp):** the structure is sound: branch line, summary, a warning icon, the list of conflicting files, Cancel and a lead action. The title is set in bold monospace and breaks inside the branch name (`fly-7-` / `integration`) in both themes.
- **TYPE: match.** The grotesque UI face and mono code match the comp's character. Mono is used for code, branch names and paths, which is its proper job.
- **MATERIAL: match.** The comp is flat UI with no painted or textured regions, and the build is flat too.

**ceiling**
- The diff does not reach the comp's finish. Hunk headers, the +/− column and full-row change tint are what make it read as a review instrument. Without them it is a list of code with coloured line numbers.

**material_fixes**
1. Restore the comp's pane order (files, diff, criteria on the right), or record an owner-approved amendment that cites why criteria go first; right now it is an uncited topology change. [severity: high] [file: packages/desktop/src/review/ReviewSurface.tsx] [both]
2. Narrow the file list to a nav column (the comp is about 265px; drop `clamp(260px, 30%, 380px)`) and give the width back to the diff, so lines stop being cut off at 1440 and the path stops breaking mid-name. [severity: high] [file: packages/desktop/src/review/ReviewSurface.tsx] [both]
3. Add the +/− marker column. At present colour alone tells added from removed (a WCAG 1.4.1 problem), and review.css's own comment says this column exists. [severity: high] [file: packages/desktop/src/review/FileDiff.tsx] [both]
4. Raise the code-area tint from 3% to a visible full-row wash like the comp's (check AA on the code glyphs), so a change reads as a row, not a gutter strip. [severity: medium] [file: packages/desktop/src/review/review.css] [both, most visible in light]
5. Render the `@@` hunk headers (wrap hunks in a `Decoration`) so jumps between hunks are marked, as the comp shows. [severity: medium] [file: packages/desktop/src/review/FileDiff.tsx] [both]
6. Merge sheet title: stop the break inside the branch name (`fly-7-` / `integration`). Put the arrow and target branch on their own line, or keep each branch name unbroken. [severity: low] [file: packages/desktop/src/review/MergeConfirmSheet.tsx] [both]

**keep**
- The ink-only action language (2px lead edge, 1px neighbours), the 2px gutter selection rule, and the unwrapped mono code: none of these should be diluted while fixing.
```

</details>

### four (D-REV-16)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `four` ===
Surface under review: surface group FOUR: the live session surface, its feed, the permission request card, the raw log, the launch sheet

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/session-group-built-light-session-1440x900.png
  - .impeccable/review/session-group-built-dark-session-1440x900.png
  - .impeccable/review/session-group-built-light-permission-destructive-1440x900.png
  - .impeccable/review/session-group-built-dark-permission-destructive-1440x900.png
  - .impeccable/review/session-group-built-light-finished-1440x900.png
  - .impeccable/review/session-group-built-dark-finished-1440x900.png
  - .impeccable/review/session-group-built-light-succeeded-1440x900.png
  - .impeccable/review/session-group-built-dark-succeeded-1440x900.png
  - .impeccable/review/session-group-built-light-developer-turn-1440x900.png
  - .impeccable/review/session-group-built-dark-developer-turn-1440x900.png
  - .impeccable/review/session-group-built-light-launch-sheet-1440x900.png
  - .impeccable/review/session-group-built-dark-launch-sheet-1440x900.png

NO COMP EXISTS FOR THIS GROUP. You are reviewing against the CONTRACT ALONE (08.1-UI-SPEC.md and the direction): colour and token roles, radius language, type scale, motion contract, the selection rule, the overlay rule, the state inventory. Do not invent a comparison image and do not report fidelity-to-comp rows; the fidelity matrix is replaced by a contract-conformance matrix. TYPE and MATERIAL still apply against the contract's own world.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/session/*.tsx, packages/desktop/src/session/session.css, packages/desktop/src/launch-sheet/LaunchSheet.tsx

Specific questions: does the header (a back link, a title, a status, a cost strip and up to four actions in one row) read as crowded; do the three ink-bordered controls in the open launch sheet (the focused field, the chosen mode, Start Work) compete. Owner-held, do not file: marking Bypass Permissions as destructive.
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Not read: 08.1-DIRECTION.md, 08.1-AMENDMENTS.md, PRODUCT.md, DESIGN.md, RawLogView.tsx, PermissionRequestCard.tsx, LaunchSheet.tsx. There is no raw-log capture, so the raw log was not reviewed.

**persistence**
Partial pass. PRODUCT.md and DESIGN.md exist at the root but I did not read them, so whether they match the built world is unverified. There is no `.impeccable/mocks/` round, so no approval record is needed.

**fidelity** (checked against the contract, since no comp exists for this group)
- TYPE: match. The heading, body, label, micro and mono roles are applied consistently. The retry notice is set at 10px (`type-micro`), which is under the 11px floor: addressed-to-11-18 (D-198.3).
- MATERIAL: match. Every surface is flat, there is no fake depth, the dark sheet carries an edge, and the scrim uses the token.
- Header row: match at 1440 in run, failed and completed states. Back, title and status sit left, the actions sit right, and there's a wide gap between. It doesn't read as crowded. In the authoring state it carries 8 items: the elapsed time, a 3-stage strip, Advance, View raw, Stop and Discard. Nothing divides the stage strip from the commands, so the two groups run together. That's tight but legible. The cost strip doesn't appear in any capture because the fixture has no cost, so I couldn't judge it.
- Header title: contradicted. The title is the literal word "Session" (`SessionSurface.tsx:1088`). The surface never names the task or ID it is working on. That breaks PRODUCT's core value that every unit of work is anchored to a board item.
- Lead action: adaptation, citing the owner decision of 2026-10-08. Stop, Review changes, Advance, Send and Allow carry the 2px ink edge, and Deny takes the destructive text role. This conforms.
- Brand rule:
  - The "Running" status and the "Challenge" stage in brand blue are adaptations under D-199: addressed-to-11-18.
  - The developer turn painted in `--accent-text-rack` (`FeedRow.tsx:458`) is contradicted. It is not one of the 4 permitted uses, and D-199 doesn't cover it either.
- Overlay rule (launch sheet): match. The sheet has a scrim, the sheet shadow and a dark edge.
- Launch sheet's three ink controls: contradicted in effect. The auto-focused optional field has a 2px ink outline plus offset. It is the heaviest box on the sheet, heavier than Start Work. The chosen mode adds a third ink frame. The result is three bold ink boxes stacked within about 140px, and the 2px edge stops meaning "the lead".
- Selection rule (mode choice): match in intent. The chosen mode has an ink edge, a 2px foot and 600 weight. At this size, though, it reads almost the same as a 2px lead button.
- State inventory:
  - Running, blocked, failed and completed all have a floor line: match.
  - Completed: inconsistent. Failed gets a bordered notice. Completed gets a bare, indented "Completed" line that only repeats the header badge.
- Permission card:
  - Edge, grant gutter, the destructive variant and its octagon icon: match.
  - Body: contradicted on copy. It prints the raw JSON payload `{"command":"…"}` instead of the command itself.
- Floor glyphs: contradicted. The disclosure markers are the text triangles ▸ and ▾, and they come in two sizes and two inks: muted mono on tool rows, primary ink on prose rows. The back link uses the text arrow ←, and the live caret is ▍. The floor refuses Unicode standing in for an icon system, and the surface already ships drawn icons in its status and stage marks.
- Empty top of the feed: adaptation, citing the bottom-anchored transcript rationale (`SessionSurface.tsx:1167`).

**ceiling**
The world's native device is the data channel, and this surface uses almost none of it. The header has no task identity and no worktree or branch line. Tool rows show no outcome, such as an exit status or a changed-file count, so the feed is a list of grey lines with no visible result.

**material_fixes**
1. Replace the "Session" title with the task's ID and title (fall back to the epic for an authoring run), so the surface names the board item it serves [severity: high] [file: packages/desktop/src/session/SessionSurface.tsx] [both]
2. Paint developer turns in ink, not brand (for example `--text-primary-rack` at 600 weight, or a right-indented block), because the brand rule doesn't allow speaker colour [severity: medium] [file: packages/desktop/src/session/FeedRow.tsx] [both]
3. Launch sheet: drop the field's 2px outline-plus-offset. Draw focus as a 1px edge turning to ink (or don't auto-focus the optional field), so Start Work is the only 2px ink box [severity: medium] [file: packages/desktop/src/session/session.css] [both]
4. Replace the ▸ ▾ disclosure triangles and the ← arrow with one drawn chevron and arrow from the existing icon set, at one size and ink across tool and prose rows [severity: medium] [file: packages/desktop/src/session/FeedRow.tsx] [both]
5. Permission card body: show the command or path (reuse `toolCallTarget`), and keep the raw JSON behind a disclosure [severity: medium] [file: packages/desktop/src/session/PermissionRequestCard.tsx] [both]
6. Authoring header: separate the stage strip from the command buttons with a hairline or a gap step, so stage and commands read as two groups [severity: low] [file: packages/desktop/src/session/SessionSurface.tsx] [both]
7. Completed terminal row: either give it the same notice treatment as failed (with an outcome line) or delete it, because the header badge already says it [severity: low] [file: packages/desktop/src/session/SessionSurface.tsx] [both]
8. Retry notice at 10px: addressed-to-11-18 (D-198.3) [severity: low] [file: packages/desktop/src/session/FeedRow.tsx] [both]

**keep**
Keep the drawn, unfilled single-lead action language and the destructive card being told by its edge, heading and icon rather than a fill. Don't fix anything by adding fills, brand colour or side stripes.
```

</details>

### five (D-REV-17)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `five` ===
Surface under review: surface group FIVE: settings and its permission-rules table, the triage surface, the authoring tray with its rows and amend editor, the published legend (embedded and as a dialog), and the done warning's overlay tier

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/admin-group-built-light-settings-1440x900.png
  - .impeccable/review/admin-group-built-dark-settings-1440x900.png
  - .impeccable/review/admin-group-built-light-triage-1440x900.png
  - .impeccable/review/admin-group-built-dark-triage-1440x900.png
  - .impeccable/review/admin-group-built-light-triage-merge-1440x900.png
  - .impeccable/review/admin-group-built-dark-triage-merge-1440x900.png
  - .impeccable/review/admin-group-built-light-tray-1440x900.png
  - .impeccable/review/admin-group-built-dark-tray-1440x900.png
  - .impeccable/review/admin-group-built-light-legend-1440x900.png
  - .impeccable/review/admin-group-built-dark-legend-1440x900.png
  - .impeccable/review/admin-group-built-light-legend-dialog-1440x900.png
  - .impeccable/review/admin-group-built-dark-legend-dialog-1440x900.png

NO COMP EXISTS FOR THIS GROUP. You are reviewing against the CONTRACT ALONE (08.1-UI-SPEC.md and the direction): colour and token roles, radius language, type scale, motion contract, the selection rule, the overlay rule, the state inventory. Do not invent a comparison image and do not report fidelity-to-comp rows; the fidelity matrix is replaced by a contract-conformance matrix.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/settings/*.tsx, packages/desktop/src/triage/*.tsx, packages/desktop/src/authoring/*.tsx, packages/desktop/src/legend/Legend.tsx, packages/desktop/src/styles/admin-surfaces.css

Specific questions: whether a proposal row reads as the same object in the tray and in the triage surface (it is the board's challenge row's twin); whether the wall of drawn buttons on every triage row is too heavy; whether the chosen segment (ink edge plus a 2px foot rule, no weight change) is too quiet at a glance. The legend's developer-voice copy is a recorded copy decision, not a design finding.
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Missing or unread: the permission-rules table is not in either settings capture (both cut off at the "Permission Rules" heading at y≈893), so it was not reviewed. The done warning has no group-five capture; I reviewed it from `states-group-built-*-done-warning-1440x900.png`. I read only parts of 08.1-DIRECTION.md, PRODUCT.md and DESIGN.md (existence checks plus one grep), and I only spot-checked the `.tsx` sources.

### persistence
Pass. PRODUCT.md and DESIGN.md exist at the root, and DESIGN.md's control vocabulary (lead box, control edge, text action) matches what was built. There is no `.impeccable/mocks/` comp round, so no approval record is needed.

### fidelity
This is a check against the contract, since no comp exists.
- **Colour and brand rule (D-12):** match. The brand appears only on the legend's focus-ring sample. Everything else is neutral ink in both modes.
- **Primary action:** adaptation, citing owner decision 2026-10-08. Accept, Save and "Accept task and its 2 criteria" use the 2px ink lead edge, and their neighbours use the 1px control edge. No fills.
- **Selection rule (A-06):** match. The selected proposal row in triage and in the tray has a 2px `--selection-rule` on its leading edge and the selected surface. The child hairline is 1px `--divider`, inside the side-stripe allowance.
- **Chosen segment** (Credential Path, Per-Project, Forge, Pending/Deferred): match with the A-06 device turned to suit a value (ink edge plus a 2px inset foot, no weight change). At a glance it is not too quiet. The ink edge against the `#7a828c`/`#707070` control edge separates clearly in both modes. Its one weakness is that the chosen segment ("Pending") and the lead action ("Accept") are near cousins: both are dark-edged boxes.
- **Radius language:** match. Buttons, inputs, the merge picker and the dialog use 6px chrome, and rows are square.
- **Overlay rule:**
  - The legend dialog is a match: scrim at full value, chrome radius, and a distinct `--border-dialog` edge in dark that tells the tier.
  - The done warning is a match as a popover: no scrim, shadow in light, edge in dark.
  - The merge picker is an inline expansion, not an overlay, so it is exempt.
- **Type scale:** match at the 11px floor, as far as the captures show.
- **Proposal row as the twin of ChallengeRow:** contradicted. Tray and triage do render the same object as each other: icon, type label, title, description, lead Accept, reason field. But both stack the uppercase TASK/CRITERION label *above* the title as an eyebrow. `board/ChallengeRow.tsx:92-96` sets the same `type-label` inline with the title. So the proposal row is a different object from the challenge row it claims to twin.
- **Kind icon:** contradicted. Task and criterion carry the identical glyph, so the icon encodes nothing the label doesn't.
- **Legend depicts the board:** contradicted for priority. The legend's priority samples sit in a bordered box (`Legend.tsx:57`, `sample.boxed`), but the board's row tail draws the bars unboxed (done-warning capture, x≈1410).
- **Triage action order:** contradicted. The lead "Accept task and its 2 criteria" sits fourth, after "Accept task only / Reject / Amend". The lead action is not first in reading order.
- **Settings composition:** contradicted. Credential Path puts its control directly under the heading. Per-Project and Forge Override put theirs flush right, about 1,100px away from the "threadfin" label they set. That is two alignment systems on one page.
- **State inventory:** partial. Disabled bulk actions, the run-limit warning, the possible-duplicate notice and the amend editor are present. The native checkbox and native number spinner are unthemed browser surfaces.
- **D-198.1:** `0/0` and the empty "No priority" tail still render on task rows in the done-warning capture, and the legend's "No priority" sample is still listed. addressed-to-11-18.
- **Legend copy:** the developer-voice copy is a recorded copy decision, so it is not filed.

### ceiling
DESIGN.md already has a native device the build leaves unused: the **text action** ("a caret and no box, for the lower-ranked answer"). Triage draws every secondary answer as a full box instead. On a three-node subtree that is 16 boxed buttons plus 4 always-open reason fields in one viewport. So yes, the wall is too heavy. The weight comes from repetition rather than from any single row, and the system's own device would remove it. The idle reason field could also be revealed only when Reject is chosen instead of standing open on every row.

### material_fixes
1. **Proposal kind label:** set TASK / CRITERION / AMEND inline before the title, as `ChallengeRow` does, instead of stacked above it. This removes a banned eyebrow (floor: kicker above a heading) and makes the row the challenge row's true twin. [severity: high] [file: packages/desktop/src/authoring/ProposalRow.tsx:316-323] [both]
2. **Triage action wall:** demote Merge and Defer (and Amend, if the owner agrees) to DESIGN.md's caret text action, and keep Accept/Reject boxed. Reveal the reason field only once Reject is engaged. [severity: high] [file: packages/desktop/src/authoring/ProposalRow.tsx, packages/desktop/src/triage/TriageSurface.tsx] [both]
3. **Triage order:** put the lead "Accept task and its 2 criteria" first in the root row's cluster, ahead of "Accept task only". [severity: medium] [file: packages/desktop/src/authoring/ProposalRow.tsx] [both]
4. **Settings alignment:** one alignment system for the whole page. Either every control sits under its heading, as in Credential Path, or every label/control pair is held to a bounded column. Per-Project and Forge controls should not be flush right at 1416px. [severity: medium] [file: packages/desktop/src/settings/SettingsSurface.tsx, packages/desktop/src/styles/admin-surfaces.css] [both]
5. **Legend priority samples:** drop the box around the bars so the legend draws the mark as the row tail draws it. Keep the box only for marks that really are boxed, like the estimate "L". [severity: medium] [file: packages/desktop/src/legend/Legend.tsx:57-58] [both]
6. **Kind icon:** either give task and criterion distinct outline marks from `legend/marks.ts`, or remove the icon now that the label carries the kind. [severity: low] [file: packages/desktop/src/authoring/ProposalRow.tsx] [both]
7. **Browser surfaces:** theme the triage and notification checkboxes and the Parallel Agents number spinner from the palette, with control edge, ink check and chrome radius. [severity: low] [file: packages/desktop/src/styles/admin-surfaces.css, packages/desktop/src/settings/SettingsSurface.tsx] [both]
8. **Dead row tail:** stop rendering `0/0` and the empty No-priority mark in task-row tails (D-198.1). addressed-to-11-18. [severity: low] [file: packages/desktop/src/board/BoardRow.tsx] [both]

### keep
Keep the neutral-ink discipline: the selection rule, the 2px lead edge, the chosen-segment foot rule, and a brand that appears only on the focus ring. None of these fixes may add colour or fills to buy hierarchy.
```

</details>

### five-rules (D-REV-17)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `five-rules` (a follow-up to the group `five` run, which could not see this part) ===
Surface under review: ONLY the settings surface's PERMISSION-RULES TABLE (the `Permission Rules` section at the foot of Settings), and how it joins the settings sections above it. Do not re-review the rest of group five.

Captures to open FIRST (the Settings surface scrolled to its end so the table is in the window; light and dark, 1440x900):
  - .impeccable/review/admin-group-built-light-settings-rules-1440x900.png
  - .impeccable/review/admin-group-built-dark-settings-rules-1440x900.png
The project and the three rules are FIXTURES (the real board has no permission rules), labelled on the page. The third rule's long tool name is deliberate, to test the cell.

NO COMP EXISTS FOR THIS GROUP. You are reviewing against the CONTRACT ALONE (08.1-UI-SPEC.md and the direction): colour and token roles, radius language, type scale, state inventory. Do not invent a comparison image and do not report fidelity-to-comp rows; the fidelity matrix is replaced by a contract-conformance matrix.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/settings/PermissionRulesTable.tsx, packages/desktop/src/styles/admin-surfaces.css (the `.permission-rules` rules near line 354).

Specific questions: do the columns line up, is the table's width and rhythm consistent with the sections above it, is the Revoke action weight right for a destructive-adjacent row action, and is the empty space to the right of the table (it is capped at 900px) a flaw.
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Not read: DESIGN.md, PRODUCT.md and 08.1-DIRECTION.md (I confirmed they exist but did not check their content); the full 08.1-UI-SPEC.md (only searched); SettingsSurface.tsx. The captures don't reach the end of the page, so the table's last hairline and the bottom padding are not visible.

**persistence**
Pass. PRODUCT.md and DESIGN.md exist at the repository root, and no `.impeccable/mocks/` round exists. I did not check that their content matches this surface.

**fidelity**
No comp exists, so this is checked against the contract only.
- **Columns:** match. The grid is `140px / minmax(0,1fr) / 72px / 88px / 80px`. Header and data cells start at the same x on every row in light and dark. Dates use tabular figures, and the Revoke buttons share one right edge (~924px).
- **No-fill table language** (hairline under each row, no zebra striping or tint, square corners): match in both modes.
- **Type scale:** match. Project and Tool are body text; Decision, Granted and the headers are muted label text. One weakness: the `Decision` and `Granted` headers have the same size and colour as their values (`allow`, `30/09/2026`), so in those two columns the header row is only told apart by its position.
- **Section join:** match. The `Permission Rules` heading uses the same weight and spacing as Worktree Open Commands, Notifications and the sections above. The hairline divider above it is consistent.
- **Width and rhythm:** contradicted. The table's right edge (~924px) lines up with nothing above it. The section dividers and every right-aligned control above (the credential and forge buttons) end at 1416px, and the worktree fields end at ~444px. The 900px cap is justified in its own CSS comment. The flaw is not the empty space but a third right edge that no other section uses.
- **Revoke weight:** acceptable adaptation. It is a neutral 1px control edge with no destructive role and no fill, which follows the owner's no-filled-buttons decision (2026-10-08). Revoking takes authority away rather than destroying user data, so the destructive text role used by `Deny` and `Bypass Permissions` (amendment A-08(c)) would be the wrong signal. The box weight matches the controls above.
- **Long tool name cell:** cannot be judged. At 1440px, `mcp__github__create_pull_request_with_a_very_long_name` fits without truncating, so the fixture never tests the ellipsis. The source truncates with no way to see the full name.
- **Dark mode:** match. The same geometry and the hairlines stay legible, and the Revoke edges hold.
- **Floor:** clean. No kickers, glyph icons, gradient text, side stripes or offset shadows.

**ceiling**
Reached for a dense admin table in this world. Nothing native is left unused. The only gaps are about state, not finish.

**material_fixes**
1. **Shared right edge.** The table edge (~924px) aligns with no other section edge. Either cap the whole settings column at the same measure so the dividers and right-aligned controls end where the table does, or let the table run to the section width with Tool kept as the only flexible column. The empty space alone is not the problem; the extra right edge is. [severity: medium] [file: packages/desktop/src/styles/admin-surfaces.css (.admin-table) / packages/desktop/src/settings/SettingsSurface.tsx] [both]
2. **Hidden tool name when truncated.** When the Tool cell ellipsizes, the name of the granted authority can't be read, which matters for security (the T-02-45/T-02-04 intent). Add `title={rule.toolName}` and make the fixture's long name actually truncate at 1440px so the cell is tested. [severity: medium] [file: packages/desktop/src/settings/PermissionRulesTable.tsx] [both]
3. **Revoke states missing.** The button has no pending or disabled state while the mutation runs, so a double click fires twice. A failed revoke shows nothing. Disable it while pending and show the error inline on the row. [severity: medium] [file: packages/desktop/src/settings/PermissionRulesTable.tsx] [both]
4. **Identical accessible names.** Every row's button is named just "Revoke". Use something like `aria-label={\`Revoke ${rule.toolName} for ${rule.projectName}\`}`. [severity: low] [file: packages/desktop/src/settings/PermissionRulesTable.tsx] [both]
5. **Weak header row in Decision and Granted.** Those headers match their values in size and colour. Separate them by weight or a stronger hairline under the header row, without adding a fill. [severity: low] [file: packages/desktop/src/styles/admin-surfaces.css (.admin-table-head)] [both]

**keep**
Keep the fixed-track grid with its hairline-only, no-fill rows, the neutral 1px Revoke edge (no destructive red, no fill), and the project name printed on every row.
```

</details>

### six (D-REV-18)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `six` ===
Surface under review: surface group SIX: the first-run state, the unreachable project, the registration flow confirmation, and the delete, done-warning and orphan-recovery confirmations

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/states-group-built-light-first-run-1440x900.png
  - .impeccable/review/states-group-built-dark-first-run-1440x900.png
  - .impeccable/review/states-group-built-light-first-run-confirm-1440x900.png
  - .impeccable/review/states-group-built-dark-first-run-confirm-1440x900.png
  - .impeccable/review/states-group-built-light-unreachable-1440x900.png
  - .impeccable/review/states-group-built-dark-unreachable-1440x900.png
  - .impeccable/review/states-group-built-light-delete-confirm-1440x900.png
  - .impeccable/review/states-group-built-dark-delete-confirm-1440x900.png
  - .impeccable/review/states-group-built-light-done-warning-1440x900.png
  - .impeccable/review/states-group-built-dark-done-warning-1440x900.png
  - .impeccable/review/states-group-built-light-recovery-1440x900.png
  - .impeccable/review/states-group-built-dark-recovery-1440x900.png

NO COMP EXISTS FOR THIS GROUP. You are reviewing against the CONTRACT ALONE (08.1-UI-SPEC.md and the direction): colour and token roles, radius language, type scale, motion contract, the overlay rule, the state inventory. Do not invent a comparison image and do not report fidelity-to-comp rows; the fidelity matrix is replaced by a contract-conformance matrix.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/projects/ProjectUnreachable.tsx, RegisterProjectFlow.tsx, packages/desktop/src/board/FirstRun.tsx, packages/desktop/src/recovery/OrphanRecoveryModal.tsx, packages/desktop/src/styles/states-and-confirms.css

Specific questions: whether a 2px destructive edge plus an icon reads as the section's lead without a fill (Delete and Kill All are text and edge only); whether the first-run and unreachable states are too sparse at 1440x900 with a heading, a paragraph and one button. Owner-held or decided elsewhere, do not file: 'Remove Project' (D-200 builds a soft-hide in a later plan), a non-destructive exit for the orphan modal, the first-run app-icon tile.
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
Unread: the bodies of PRODUCT.md, DESIGN.md and 08.1-DIRECTION.md (I only confirmed the files exist), RegisterProjectFlow.tsx, FirstRun.tsx, and the type-scale and motion sections of 08.1-UI-SPEC.md. No comp exists for this group, so the fidelity section below checks each element against the contract instead.

disposition: fix

**persistence**
Pass on existence. PRODUCT.md and DESIGN.md are at the repo root, and there is no `.impeccable/mocks/` comp round that would need an approval record. I did not check that their contents match the built world.

**fidelity** (checked against the contract, no comp)
- **Overlay tiers: match.**
  - Delete confirm and orphan recovery are dialogs. They use `--scrim`, `--shadow-dialog`, `--border-dialog` and `--radius-chrome`, and the dark edge is visible.
  - Done warning is a popover with no scrim, anchored under its row, as the UI-SPEC's Overlay Rule lists for `DoneWarning.tsx`.
- **No filled primary: adaptation, citing the owner decision of 2026-10-08.**
  - Register Project, Locate Project and Register Project (confirm) use a 2px ink edge, and Back uses the 1px control edge.
  - Delete and Kill All use a 2px destructive-text edge, red text at weight 600, and a trash or x-circle icon.
  - On your question: yes, this reads as the section's lead without a fill, in both modes. Beside a 1px grey Cancel or "Leave them running", it has the heaviest edge in the dialog, the only hue, and the only icon. That is three channels, so it does not depend on colour alone.
- **Destructive role: match.** It uses the `--destructive-text-rack` text role and is never filled, which avoids the fill's AA failure.
- **Path typography: contradicted on the unreachable state.**
  - Register confirm shows the folder as `.state-path`: mono, muted, breaking anywhere.
  - The unreachable state puts the repo path inline in proportional body text. It wraps as a fragment across lines 1–2, the same datum in a different face, and that path is the one fact the user acts on.
- **Key typeface: contradicted.** The orphan modal shows `FIX-1` / `FIX-E1` in mono, while the board draws the same kind of key (`THRE-26`) in bold sans.
- **Brand rule: contradicted, tagged addressed-to-11-18.** The recovery spinner paints `--accent-text-rack` (`OrphanRecoveryModal.tsx:243`), which is a run status. That is outside today's four permitted uses, and D-199 makes it permitted.
- **Reading order in the orphan modal: contradicted.** The consequence line ("Every process above is spending tokens right now…") comes after Kill All and "Leave them running", so the user reads why to decide only after the decision buttons.
- **Exit and initial focus: adaptation (A-08(b)).** "Leave them running" is built, and initial focus is off the destructive action.
- **Motion: match.** The CSS declares no animation or mount fade on these states; the spinner pulse is the live-status exception.
- **Kickers, gradient text, glyph icons, offset shadows: match, none present.** The rail's uppercase PROJECTS / FLEET / REVIEW QUEUE are navigation group labels, not eyebrows over a heading.
- **Sparseness: acceptable on first-run, but the unreachable state has a problem.**
  - First run at 1440×900 has a mark, a 20px heading, a 60ch paragraph and one action. That fits a world with no fills, no cards and one answer per state. Adding anything to fill the space would mean inventing content or using card scaffolding, both of which the floor refuses.
  - The unreachable state is not too empty. Its weakness is that the body paragraph buries the path (see Path typography above).

**ceiling**
- Nothing on these surfaces is unused beyond what the contract allows; the world deliberately offers no fills, no ornament and no mount motion.
- The one device the build has but leaves out is the mono path line, which the CSS states is the rule for "a path is read letter by letter". The unreachable state doesn't use it.

**material_fixes**
1. Unreachable state: take `{project.repoPath}` out of the sentence and render it on its own `.state-path` line (mono, muted, `overflow-wrap: anywhere`) between the heading and the explanation, matching register confirm. The copy becomes "Flywheel expected {name} here, but…". [severity: medium] [file: packages/desktop/src/projects/ProjectUnreachable.tsx] [both]
2. Orphan modal: move the consequence line ("Every process above is spending tokens right now…") above `.confirm-actions`, so the reason is read before the Kill All / Leave choice. [severity: medium] [file: packages/desktop/src/recovery/OrphanRecoveryModal.tsx] [both]
3. Orphan modal: drop the per-row "Running (from a previous session)" label. It repeats the heading three times; the spinner and its accessible name can carry the run status, which tightens each row to key + title, meta, Kill. [severity: low] [file: packages/desktop/src/recovery/OrphanRecoveryModal.tsx] [both]
4. Orphan modal: render item keys (`FIX-1`, `FIX-E1`) in the board's key treatment (sans, weight 600) instead of an inline mono stack, so the same datum uses one face across the product. Keep mono for `session sess-…`. [severity: low] [file: packages/desktop/src/recovery/OrphanRecoveryModal.tsx] [both]
5. Orphan modal: the run spinner paints `--accent-text-rack` on a run status, which the brand rule does not allow until D-199 lands. addressed-to-11-18. [severity: low] [file: packages/desktop/src/recovery/OrphanRecoveryModal.tsx:243] [both]

**keep**
Keep the drawn-action system unchanged: one 2px lead edge per section (ink, or the destructive text role plus an icon), 1px neighbours, no fills, the dialog/popover tiers as built, and nothing animating on mount.
```

</details>

### review-foot (D-REV-19)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `review-foot` ===
Surface under review: the CHANGED FOOT of the review surface's criteria column (the `Review decision` group: Request changes beside Merge, the sent-back, nothing-unchecked and no-criteria notes, the could-not-send alert) and the Review feedback section the launch sheet gained

Captures to open FIRST (light and dark, 1440x900):
  - .impeccable/review/review-group-built-light-surface-1440x900.png
  - .impeccable/review/review-group-built-dark-surface-1440x900.png
  - .impeccable/review/review-group-built-light-decision-sent-1440x900.png
  - .impeccable/review/review-group-built-dark-decision-sent-1440x900.png
  - .impeccable/review/session-group-built-light-launch-sheet-feedback-1440x900.png
  - .impeccable/review/session-group-built-dark-launch-sheet-feedback-1440x900.png
  - .impeccable/review/review-group-built-light.html
  - .impeccable/review/review-group-built-dark.html

APPROVED COMP EXISTS: .impeccable/review/review-light.png and .impeccable/review/review-dark.png (source: .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/review.html, class `.action-row`). The comp fills its primary; the owner's no-filled-buttons rule governs. The title bar no longer holds Merge: it moved into the foot (owner decision A-08(a)). Merge keeps the 2px ink lead edge while Request changes is a 1px hairline secondary BY DESIGN (an earlier review found Merge indistinguishable from the scope toggles). The launch-sheet capture has no comp; judge it against the contract.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/review/DecisionFoot.tsx, packages/desktop/src/review/CriteriaRail.tsx, packages/desktop/src/review/review.css, packages/desktop/src/launch-sheet/LaunchSheet.tsx (ReviewFeedbackSection)

Specific questions: does the foot read as the end of the attestation or as a stray block under a short rail; is a muted 11px consequence line ('Request changes sends 3 unchecked criteria back to the agent.') enough to stand in for a confirm sheet; does 'Sent back to the agent: N unchecked criteria. They go into the next session's briefing.' read as a state or as a toast; does the Review feedback section sit correctly between Warnings and Epic in the launch sheet.
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
disposition: fix

Not read: the HTML twins, 08.1-DIRECTION.md, all of 08.1-UI-SPEC.md, PRODUCT.md beyond checking it exists, CriteriaRail.tsx. Not captured, so not reviewed: the nothing-unchecked note, the no-criteria note and the could-not-send alert. I judged those from DecisionFoot.tsx copy only.

**persistence**
- Pass. PRODUCT.md and DESIGN.md both exist.
- DESIGN.md describes what was built: the review decision group at the foot of the criteria column, Merge with the 2px ink edge, Request changes as a 1px hairline secondary, and the review feedback reaching the agent's briefing.

**fidelity**
Compared against my own reading of review-light.png's `.action-row`: two outline buttons directly under the last criterion's rule, decline on the left, primary on the right, the rail empty below.
- Placement at the foot of the criteria column: **match.** The foot sits on a full-width divider straight after the criteria and the selection note. It reads as the end of the attestation, not as a stray block. The empty rail below is the same in the comp.
- Order and grouping (Request changes left, Merge right, small gap between them): **match.**
- How the primary is drawn: **adaptation.** The owner ruled on 2026-10-08 that primary buttons are never filled, so Merge has the 2px ink edge instead of the comp's fill. Request changes being a 1px hairline is deliberate and fixes an earlier review finding. Same in light and dark.
- Merge label: **contradicted.** The comp says "Merge into epic"; the build says "Merge". DecisionFoot.tsx gives no source for dropping where the merge goes.
- Consequence line ("Request changes sends 3 unchecked criteria back to the agent."): **added, and cited.** DecisionFoot.tsx says a decline writes nothing outside the board and can be undone. For an action that can be undone, a muted line shown before the click is enough without a confirm sheet. It is also wired as the button's accessible description.
- Sent-back note: **added, and cited** (A-08(a)). It reads as a state, not a toast: it stays put, has no dismiss, uses `role="status"`, and Request changes disappears. But it has the same muted 11px weight and the same spot as the line it replaces. So the before/after change is carried by the wording alone (see fix 2).
- Lettering (TYPE row): **match.** It uses the product's own sans and type sizes. The comp's lettering is the same plain sans. No new display face.
- Surfaces (MATERIAL row): **match.** Everything is flat and outlined like the comp. No imitation of physical materials.
- Review feedback section in the launch sheet: no comp exists, so I judged it against the contract. It sits correctly between Warnings and Epic. It uses the same muted label plus body pattern as Epic, Task and Worktree, with equal 24px gaps around it in light and dark. Its lead sentence is in the sheet's factual voice.

**ceiling**
- Reached for this world. Mission Control holds back: hairlines, ink edges, no fills, no motion in the foot, and the build stays inside that.

**material_fixes**
1. Fidelity: the Merge label dropped the comp's "into epic". Restore the destination (for example "Merge into epic", or the epic or integration-branch name), or cite the decision that cut it. [severity: medium] [file: packages/desktop/src/review/DecisionFoot.tsx] [both]
2. Contract, state inventory: the sent-back note uses the same muted 11px `.review-decision-note` style as the before-the-click hint. "Will send" and "sent" differ only in wording. Give the sent-back note primary text colour, so it reads as a recorded state rather than as the hint again. [severity: low] [file: packages/desktop/src/review/review.css (`.review-decision-note` split for the `role="status"` note)] [both]
3. Truth: the launch-sheet fixture's Review feedback item says "Initial focus lands on the first focusable control." The criterion below it ends "…control inside the dialog." A-08(a) says the reason is derived live from the unchecked criteria, so the two texts must match word for word. As it stands the fixture suggests the text is paraphrased. [severity: low] [file: the launch-sheet-feedback fixture behind `npm run test:browser` (packages/desktop browser test fixtures)] [both]

**keep**
The plain hairline foot with no confirm sheet: the consequence stated before the click, Merge as the only 2px ink edge, and nothing filled, brand-coloured or destructive-coloured on a decline.
```

</details>

### app-shell (D-REV-12)

<details><summary>brief tail</summary>

```text
=== THIS RUN: group `app-shell` ===
Surface under review: the APP SHELL: the board group mounted inside the real application shell (App.tsx -> AppShell: project rail, the board header/masthead, filter bar, BoardView's lens toggle and summary line, the virtualised rack)

Captures to open FIRST (light and dark, 1440x900):
 
 
-
 
.
i
m
p
e
c
c
a
b
l
e
/
r
e
v
i
e
w
/
b
o
a
r
d
-
s
h
e
l
l
-
b
u
i
l
t
-
l
i
g
h
t
-
1
4
4
0
x
9
0
0
.
p
n
g


 
 
-
 
.
i
m
p
e
c
c
a
b
l
e
/
r
e
v
i
e
w
/
b
o
a
r
d
-
s
h
e
l
l
-
b
u
i
l
t
-
d
a
r
k
-
1
4
4
0
x
9
0
0
.
p
n
g
  - .impeccable/review/board-shell-built-light.html
  - .impeccable/review/board-shell-built-dark.html

APPROVED COMP EXISTS: .impeccable/review/mission-control-light.png and .impeccable/review/mission-control-dark.png (source: .planning/phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/comps/mission-control.html). Inventory the comp first, then compare the shell capture: the comp's masthead, any subhead line under it, the Group by Epic / Status lens toggle, the summary line, and the filter bar in its real place above the rack. IMPORTANT, state it as a finding if true: the shipped source draws the masthead as the bare project name (`header.board-header` in packages/desktop/src/App.tsx) and may have no 'Mission Control' heading or `<project> . N epics . N tasks` subhead at all, so this may be a MISSING surface rather than a polish gap; decide from the comp and the capture, and classify it missing / contradicted / acceptable adaptation with the evidence. Of the staged rows, the two challenge rows and the FIXTURE tag are deliberate stand-ins.

Source files to SAMPLE (do not walk the tree): packages/desktop/src/App.tsx, packages/desktop/src/board/BoardView.tsx, packages/desktop/src/board/FilterBar.tsx, packages/desktop/src/App.css

The rack is virtualised and the capture shows the first window of it only. The rail's own rows were reviewed under group one; here judge the JOIN: spacing between masthead, filter bar, lens toggle, summary line and rack, and how the rail sits beside the board column at the real window height.
```

</details>

<details><summary>reviewer return, verbatim</summary>

```text
I've finished reading and am writing up the review now.

Not read: PRODUCT.md (I didn't confirm it exists), FilterBar.tsx, App.css, AMENDMENTS beyond the grep, and the two `.html` captures.

disposition: fix

**persistence**
Fail (partial). DESIGN.md exists and is honest that there is no masthead ("Contract versus the built world" item 2). But its "Inputs, chips and pickers" section says "the filter bar is one row at 1440px: a lens, a 240px search, the dimension chips…". The build puts the lens on its own row below the filter bar (`BoardView.tsx:1144`). So DESIGN.md describes a shell that wasn't built. I didn't check that PRODUCT.md exists. No `.impeccable/mocks/` round exists, so there's no approval record to check.

**fidelity**
I listed the comp's elements first, then compared the capture against each one.
- **Masthead "Mission Control" (heading, the largest type on the page):** missing. The capture shows only `threadfin` at the type-heading size (`App.tsx:91-96`). Nothing cites a reason. UI-SPEC "Disagrees" item 4 and D-REV-12 only record that it's absent.
- **Subhead "threadfin · 13 epics · 906 tasks · 5 worktrees active":** missing.
- **Hairline rule under the title block:** missing.
- **Summary paragraph (several sentences, about 65ch wide, above the controls):** contradicted. The build has one ellipsised `nowrap` sentence ("2 decisions pending. 181 items ready to review. 8 epics have no criteria yet."). It sits *below* the controls and drops the done fraction and the agent and worktree facts. The comp's "What this says" label is correctly absent, because the floor bans it.
- **Controls row (lens + search + Has worktree + right-aligned "906 tasks · 13 epics"):** contradicted.
  - The build stacks three bands: the filter band, then a "Group by" row, then the summary row. That puts four rules within about 165px before the rack starts.
  - The right-aligned total count is missing.
  - The full set of dimension chips is an acceptable adaptation, citing DESIGN.md "Inputs, chips and pickers".
- **Lens toggle, Epic/Status:** match in form (a 1px edge on the pressed button). Its placement is contradicted (see the row above).
- **Epic rows (name, key·status·branch, progress, activity bar, agents, proposals):** match.
- **"Plan fan-out" button on every epic row:** added without approval. It isn't in the comp, and I found no citation for it.
- **Expand chevrons on epic rows:** acceptable adaptation, citing the keyboard disclosure amendment (AMENDMENTS around line 530).
- **Challenge rows:** acceptable adaptation, since they're FIXTURE stand-ins. Their Accept/Reject pair replaces the comp's Answer button and belongs to group one's review.
- **Task rows:** match on height and topology. Keys are bold primary ink where the comp has them muted and regular. That's a row-level difference, deferred to group one.
- **`0/0` tails:** contradicted, `addressed-to-11-18` (D-198.1).
- **Rail beside the board:** contradicted at the join. The comp anchors the corner with the logo tile plus the "Flywheel" wordmark, level with the H1. The build has only a small glyph at about y30, beside a 15px project name at about y25. The two columns share no top line.
- **Selection rule:** no selection is shown in the capture. Not judged.
- **TYPE:** contradicted. Without the masthead, the shell has no display step at all. The comp's 22px+ title over a muted subhead is the type scale's only large step, and the build tops out at the heading role.
- **MATERIAL:** match. Flat hairline neutral ground in both schemes is the material the comp promised.

**ceiling**
- **Display step of the type scale:** unused. The world's single large heading, and the scale contrast it gives the top of the page, isn't there.
- **Summary paragraph:** unused as a reading surface. It's reduced to a truncated status line.
- **Tabular totals right-aligned on the controls row:** unused.
- **Hairline rhythm:** spent on stacked band dividers instead of one rule under the title block.

**material_fixes**
1. Add the masthead: a "Mission Control" heading at the display step, with the subhead `<project> · N epics · N tasks · N worktrees active` in muted ink beneath it, replacing the bare project name in `header.board-header`. Fidelity check: missing signature element. [severity: high] [file: packages/desktop/src/App.tsx] [both]
2. Merge the "Group by" row into the filter bar so it's one controls row: lens, search, chips, then the right-aligned "N tasks · N epics" total, as DESIGN.md "Inputs, chips and pickers" and the comp both specify. Remove the extra divider and band. Fidelity: changed topology, and the DESIGN.md mismatch. [severity: high] [file: packages/desktop/src/board/BoardView.tsx, packages/desktop/src/board/FilterBar.tsx] [both]
3. Move the summary above the controls, as the comp orders it. Let it wrap to about 65ch instead of `nowrap` plus ellipsis, and restore the done fraction (e.g. "180 of 906 tasks … done (20%)") alongside the counts it already has. Fidelity: contradicted reading order and content. [severity: medium] [file: packages/desktop/src/board/BoardView.tsx, packages/desktop/src/board/summaryLine.ts] [both]
4. Align the rail's top with the board's title block: either put the logo and wordmark on the masthead's line, or start both columns' first rule at the same height. Right now the two columns meet with no shared line. Fidelity: the rail join. [severity: medium] [file: packages/desktop/src/projects/ProjectRail.tsx, packages/desktop/src/App.tsx] [both]
5. Show "Plan fan-out" only on the hovered, focused or selected epic row, or cite the decision that put it on every row. Thirteen identical outlined buttons add a column the comp doesn't have and compete with the progress columns. Fidelity: added without approval. [severity: low] [file: packages/desktop/src/board/StatusBand.tsx] [both]
6. Stop showing `0/0` and empty "No priority" in task row tails. Truth / D-198.1. `addressed-to-11-18`. [severity: low] [file: packages/desktop/src/board/BoardRow.tsx] [both]
7. After fixes 1–3, update DESIGN.md: remove "No masthead" from "Contract versus the built world", and make "Inputs, chips and pickers" describe the controls row as built. Persistence. [severity: low] [file: DESIGN.md] [both]

**keep**
Keep the flat hairline neutral ground and the epic roster's column grid (progress bar in brand blue, activity bar, agents and proposals counts). They match the comp in both schemes. Don't add fills, tints or boxes while restoring the masthead.
```

</details>
