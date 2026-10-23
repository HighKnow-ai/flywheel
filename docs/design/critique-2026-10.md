# Critique of the built app, October 2026

**DEGRADED: single-context** (run without impeccable's two isolated sub-agent assessors: the task's rules
allowed helper agents only where impeccable ships one, and critique's design-review and detector
assessors are not shipped agents. The design review below was written and its scores fixed before the
detector output was read.)

Issue #102, Epic #97. The re-shoot after the restyle (#107) and the five complaints before and after are in
[After the restyle](#after-the-restyle-107-october-2026), first below. Run with `impeccable critique` on 2026-10-21, against `main` at `ddb8a5d5`.

The owner has already decided to **replace** the "Mission Control" world, so this is not a polish list. It
is the evidence the next Story (#103, "Pick Flywheel's new visual world") designs against: what the
screens do today, why each of Cyril's five complaints happens, and which screens and states a new world
has to cover.

## After the restyle (#107), October 2026

Issue #107, Epic #97. The same harness, the same fixture data and the same 1440 × 900 WebKit window as the
"before" shots above, re-shot after every screen of the M2 flow moved onto the Andon world
([`direction.md`](direction.md)): shadcn/ui components on the Andon tokens, Lucide icons, the andon lamp
strip across the top of every screen, and the click model #104 shipped. The fixture gained Acceptance
criteria with Checks for FLY-4 and FLY-7, so the Story view has something to show; nothing else in the
data changed. The walk changed where the flow changed: Tasks, sessions, Resume and Drop now live in the
Story view (03 to 06 open the Story first), and Write a Story is a dialog (02).

Files are in [`critique-2026-10/after/`](critique-2026-10/after/), named as the before shots are.
`impeccable detect` reports no findings on the changed source, nor on the rendered board, Story view,
feeds, Waiting on you and All agents (through `critique.html`).

### The five complaints, before and after

Before is the build #102 critiqued (`main` at `ddb8a5d5`, Mission Control); after is this Story's build.
Light scheme; every after shot also exists in dark.

#### 1. "Nothing really stands out because the design has zero contrast"

| Before | After |
|---|---|
| ![](critique-2026-10/01-board-light.webp) | ![](critique-2026-10/after/01-board-light.webp) |

**After.** Regions are told apart by a ground step, a 1px edge and a card shadow: a grey floor, white Epic
cards, a light sidebar and a graphite strip. Colour is spent only where it changes what to do next:
Waiting-on-you rows are tinted yellow with a yellow pill and a yellow Answer, the Stopped Story is a red pill
with its reason and a blue Resume, and the lit lamps in the strip say the same thing from every screen. Each
row carries one action, the next one, instead of four outlined buttons. Type has real steps (12 to 24px,
400 to 700), so the Story title, its row and its meta no longer compete. The Milestone header (#106) heads
the board with the one graphite lead box and the yellow Waiting-on-you count.

#### 2. "Some elements I expect to be clickable, to see what the agent is doing, are not"

| Before | After |
|---|---|
| ![](critique-2026-10/03-story-tasks-light.webp) | ![](critique-2026-10/after/03-story-tasks-light.webp) |

**After.** Everything that navigates is a bounded object with a trailing chevron, an accent hover and the
focus ring: the Story row (with an edge on hover), the lamp, the sidebar's Story rows, the Story link on a
Waiting-on-you entry, the breadcrumb's crumbs. The Story view is the destination a row opens: its live agent
sits in a station under the title (what it is doing, its Task note, and Open session), with the Acceptance
criteria and their Check chips beside the Tasks. Feed rows disclose with a chevron and a hover ground, not a
7px glyph. Controls that only edit (rename, reorder, drop a Task) are quiet icon buttons with a tooltip and an
accessible name.

#### 3. "Sometimes it randomly opens the agent when I would not expect it"

| Before | After |
|---|---|
| ![](critique-2026-10/15-nav-project-click-keeps-feed-light.webp) | ![](critique-2026-10/after/15-nav-project-click-keeps-feed-light.webp) |

**After.** The mechanism was fixed by #104 (choosing a project replaces whatever shows; Start and Resume stay
where they are). This Story makes the rule visible. Every place has a breadcrumb (project, Story, session) and
a Back control; the current project and Story are raised cards in the sidebar and the current Story's lamp
wears an outline. Only controls that say "session" open one: Open session and Open feed carry the terminal
icon, Answer carries the question icon, and a lamp, a row or a sidebar Story opens the Story. Screen 15 now
shows highknow-web's board after the click, with the feed one Back away.

#### 4. "There are very few icons, or none at all"

| Before | After |
|---|---|
| ![](critique-2026-10/07-feed-running-light.webp) | ![](critique-2026-10/after/07-feed-running-light.webp) |

**After.** Every state is an icon, a word and one of four tones (StateBadge), on the board, in the sidebar, the
strip, the Story view, Checks, Tasks and All agents. The sidebar's places, the Epic cards, the Story view's
panels and every button carry Lucide icons beside their words. Feed rows are told apart by kind: Read, Edit,
Run, Search, a board tool, the agent's turn. **Left:** a board tool still prints its raw name
(`mcp__flywheel-board__task_add`); the finish review asked for verbs and a tabular result column, which is a
change to the feed's words, not its look, and is left for a follow-up.

#### 5. "I cannot quantify project progress at a glance"

| Before | After |
|---|---|
| ![](critique-2026-10/01-board-light.webp) | ![](critique-2026-10/after/01-board-light.webp) |

**After.** The board is shaped like the model: one card per Epic with its state and Milestone, its
Stories under it as rows, done work quiet (Merged and Dropped in secondary ink). A Story states its progress
in its own header (Tasks 1/3, Checks 0/2, its Context packet against the soft limit) and the strip counts the
live agents. With #106 merged, the board answers the question in one look: the Milestone header's lead box
(Stories merged 1/8), a count box per state and the stacked bar, and each Epic card heads with its own bar
and "n of m Stories merged" (each Epic appears once). See 01 above and 17 below.

### Every screen, after

| # | Screen | Light | Dark |
|---|---|---|---|
| 01 | Project board | ![](critique-2026-10/after/01-board-light.webp) | ![](critique-2026-10/after/01-board-dark.webp) |
| 02 | Write a Story (dialog) | ![](critique-2026-10/after/02-board-write-story-light.webp) | ![](critique-2026-10/after/02-board-write-story-dark.webp) |
| 03 | Story view, a Task note open | ![](critique-2026-10/after/03-story-tasks-light.webp) | ![](critique-2026-10/after/03-story-tasks-dark.webp) |
| 04 | Story view of a Stopped Story, its sessions | ![](critique-2026-10/after/04-story-stopped-sessions-light.webp) | ![](critique-2026-10/after/04-story-stopped-sessions-dark.webp) |
| 05 | Resume with a note (dialog) | ![](critique-2026-10/after/05-story-resume-light.webp) | ![](critique-2026-10/after/05-story-resume-dark.webp) |
| 06 | Drop confirmation (alert dialog) | ![](critique-2026-10/after/06-story-drop-confirm-light.webp) | ![](critique-2026-10/after/06-story-drop-confirm-dark.webp) |
| 07 | Session feed, running | ![](critique-2026-10/after/07-feed-running-light.webp) | ![](critique-2026-10/after/07-feed-running-dark.webp) |
| 08 | Feed, a failed call expanded | ![](critique-2026-10/after/08-feed-call-expanded-light.webp) | ![](critique-2026-10/after/08-feed-call-expanded-dark.webp) |
| 09 | Feed, Gated action | ![](critique-2026-10/after/09-feed-gated-action-light.webp) | ![](critique-2026-10/after/09-feed-gated-action-dark.webp) |
| 10 | Feed, the agent's question | ![](critique-2026-10/after/10-feed-question-light.webp) | ![](critique-2026-10/after/10-feed-question-dark.webp) |
| 11 | Feed, permission request | ![](critique-2026-10/after/11-feed-permission-request-light.webp) | ![](critique-2026-10/after/11-feed-permission-request-dark.webp) |
| 12 | Feed of a handed-off session | ![](critique-2026-10/after/12-feed-handed-off-light.webp) | ![](critique-2026-10/after/12-feed-handed-off-dark.webp) |
| 13 | Waiting on you, a shaping Round listed after the requests (#124) | ![](critique-2026-10/after/13-waiting-on-you-queue-light.webp) | ![](critique-2026-10/after/13-waiting-on-you-queue-dark.webp) |
| 14 | All agents | ![](critique-2026-10/after/14-fleet-light.webp) | ![](critique-2026-10/after/14-fleet-dark.webp) |
| 15 | A project chosen while a feed is open | ![](critique-2026-10/after/15-nav-project-click-keeps-feed-light.webp) | ![](critique-2026-10/after/15-nav-project-click-keeps-feed-dark.webp) |
| 16 | A project chosen while All agents is open | ![](critique-2026-10/after/16-nav-project-click-keeps-fleet-light.webp) | ![](critique-2026-10/after/16-nav-project-click-keeps-fleet-dark.webp) |
| 17 | Board at the 900px minimum window width | ![](critique-2026-10/after/17-board-min-width-light.webp) | ![](critique-2026-10/after/17-board-min-width-dark.webp) |
| 18 | Story Waiting on you: its agent station with Answer, Stop and the live tail (#118) | ![](critique-2026-10/after/18-story-station-waiting-light.webp) | ![](critique-2026-10/after/18-story-station-waiting-dark.webp) |
| 19 | Stop confirmation from the agent station (#118) | ![](critique-2026-10/after/19-story-stop-confirm-light.webp) | ![](critique-2026-10/after/19-story-stop-confirm-dark.webp) |
| 20 | Roadmap strip: another Milestone picked, the header and roster switch to it (#131) | ![](critique-2026-10/after/20-roadmap-other-milestone-light.webp) | ![](critique-2026-10/after/20-roadmap-other-milestone-dark.webp) |
| 21 | Roadmap strip: + Milestone takes a one-line outcome (#131) | ![](critique-2026-10/after/21-roadmap-add-milestone-light.webp) | ![](critique-2026-10/after/21-roadmap-add-milestone-dark.webp) |
| 22 | Roadmap strip: a Milestone dragged up, the line shows where it lands (#131) | ![](critique-2026-10/after/22-roadmap-dragging-light.webp) | ![](critique-2026-10/after/22-roadmap-dragging-dark.webp) |
| 23 | Epic shaping: the Round dock waiting on you beside the Epic card, recommended answers pre-filled (#123) | ![](critique-2026-10/after/23-epic-shaping-round-dock-light.webp) | ![](critique-2026-10/after/23-epic-shaping-round-dock-dark.webp) |
| 24 | Epic shaping: Answer differently opens on the recommendation (#123) | ![](critique-2026-10/after/24-epic-shaping-answer-differently-light.webp) | ![](critique-2026-10/after/24-epic-shaping-answer-differently-dark.webp) |
| 25 | Epic shaping at the window's minimum width: the dock first (#123) | ![](critique-2026-10/after/25-epic-shaping-min-width-light.webp) | ![](critique-2026-10/after/25-epic-shaping-min-width-dark.webp) |
| 26 | Board: an Epic whose shaping session waits on a Round reads Waiting on you and offers Answer, and its Round lights a lamp (#123, #124) | ![](critique-2026-10/after/26-board-epic-answer-light.webp) | ![](critique-2026-10/after/26-board-epic-answer-dark.webp) |
| 27 | Epic shaping: spec changes as ghost fields under the field each would rewrite, a rejected one struck through (#125) | ![](critique-2026-10/after/27-epic-shaping-ghost-fields-light.webp) | ![](critique-2026-10/after/27-epic-shaping-ghost-fields-dark.webp) |
| 28 | Epic shaping: Amend opens the proposed text, accepted as edited in one act (#125) | ![](critique-2026-10/after/28-epic-shaping-amend-light.webp) | ![](critique-2026-10/after/28-epic-shaping-amend-dark.webp) |
| 29 | Epic shaping: Reject asks for an optional reason (#125) | ![](critique-2026-10/after/29-epic-shaping-reject-reason-light.webp) | ![](critique-2026-10/after/29-epic-shaping-reject-reason-dark.webp) |
| 30 | Epic shaping at the window's minimum width: rejecting a ghost field (#125) | ![](critique-2026-10/after/30-epic-shaping-ghost-min-width-light.webp) | ![](critique-2026-10/after/30-epic-shaping-ghost-min-width-dark.webp) |
| 31 | Board: a killed shaping session leaves Shaping Round waiting and Continue shaping (#124) | ![](critique-2026-10/after/31-board-epic-continue-shaping-light.webp) | ![](critique-2026-10/after/31-board-epic-continue-shaping-dark.webp) |
| 32 | Epic shaping: the open Round with no live session keeps its answers, Continue shaping on its band (#124) | ![](critique-2026-10/after/32-epic-shaping-continue-light.webp) | ![](critique-2026-10/after/32-epic-shaping-continue-dark.webp) |
| 33 | Epic shaping: an ADR offered as a question, the draft beside its four bar lines, answered Yes or No (#129) | ![](critique-2026-10/after/33-epic-shaping-adr-question-light.webp) | ![](critique-2026-10/after/33-epic-shaping-adr-question-dark.webp) |
| 34 | Epic shaping: the Epic card's ADR and glossary chips, the accepted ones not yet written dashed (#129) | ![](critique-2026-10/after/34-epic-shaping-adr-chips-light.webp) | ![](critique-2026-10/after/34-epic-shaping-adr-chips-dark.webp) |
| 35 | Epic shaping at the window's minimum width: an ADR question (#129) | ![](critique-2026-10/after/35-epic-shaping-adr-min-width-light.webp) | ![](critique-2026-10/after/35-epic-shaping-adr-min-width-dark.webp) |
| 36 | Epic shaping: an ADR answered Yes folds to a settled line with its file name (#129) | ![](critique-2026-10/after/36-epic-shaping-adr-answered-light.webp) | ![](critique-2026-10/after/36-epic-shaping-adr-answered-dark.webp) |
| 37 | Epic shaping: only the ADR is left open, so Accept all is off and the hint says what is left; the answered questions above still offer Change (#129) | ![](critique-2026-10/after/37-epic-shaping-adr-only-left-light.webp) | ![](critique-2026-10/after/37-epic-shaping-adr-only-left-dark.webp) |
| 38 | Epic shaping: the Stage bar lists what keeps the Stage open, Close Stage disabled (#126) | ![](critique-2026-10/after/38-epic-shaping-stage-bar-open-light.webp) | ![](critique-2026-10/after/38-epic-shaping-stage-bar-open-dark.webp) |
| 39 | Epic shaping: nothing open, Close Stage is the next action (#126) | ![](critique-2026-10/after/39-epic-shaping-stage-closable-light.webp) | ![](critique-2026-10/after/39-epic-shaping-stage-closable-dark.webp) |
| 40 | Epic shaping: confirming Close Stage (#126) | ![](critique-2026-10/after/40-epic-shaping-close-stage-confirm-light.webp) | ![](critique-2026-10/after/40-epic-shaping-close-stage-confirm-dark.webp) |
| 41 | Epic shaping at the window's minimum width: the Stages whole, Close Stage on its own line (#126) | ![](critique-2026-10/after/41-epic-shaping-stage-bar-min-width-light.webp) | ![](critique-2026-10/after/41-epic-shaping-stage-bar-min-width-dark.webp) |
| 42 | Epic shaping: the Slice Stage just opened, the Challenge Rounds below it named with their Stage (#126) | ![](critique-2026-10/after/42-epic-shaping-slice-opened-light.webp) | ![](critique-2026-10/after/42-epic-shaping-slice-opened-dark.webp) |
| 43 | Roadmap strip: Revisit roadmap in the header, and the last roadmap Round said the Roadmap still holds (#133) | ![](critique-2026-10/after/43-roadmap-revisit-holds-light.webp) | ![](critique-2026-10/after/43-roadmap-revisit-holds-dark.webp) |
| 44 | Roadmap strip: a roadmap Round reading the Roadmap, the running band with Open session and Dismiss (#133) | ![](critique-2026-10/after/44-roadmap-round-reading-light.webp) | ![](critique-2026-10/after/44-roadmap-round-reading-dark.webp) |
| 45 | Roadmap strip: Waiting on you, the yellow band and edge, three ghost rows under the Milestones they land on, a rejected change struck through (#133) | ![](critique-2026-10/after/45-roadmap-ghost-rows-light.webp) | ![](critique-2026-10/after/45-roadmap-ghost-rows-dark.webp) |
| 46 | Roadmap strip: Amend a proposed Milestone in place, Accept edit (#133) | ![](critique-2026-10/after/46-roadmap-ghost-amend-light.webp) | ![](critique-2026-10/after/46-roadmap-ghost-amend-dark.webp) |
| 47 | Roadmap strip: an open roadmap Round with no live session; Dismiss asks first because it would reject the undecided changes (#133) | ![](critique-2026-10/after/47-roadmap-round-dismiss-light.webp) | ![](critique-2026-10/after/47-roadmap-round-dismiss-dark.webp) |
| 48 | Waiting on you queue: a roadmap Round, "1 of 4 decided" and Decide, beside an Epic's Round (#133) | ![](critique-2026-10/after/48-queue-roadmap-round-light.webp) | ![](critique-2026-10/after/48-queue-roadmap-round-dark.webp) |
| 49 | Roadmap strip at the window's minimum width: the band and ghost rows wrap (#133) | ![](critique-2026-10/after/49-roadmap-ghost-rows-min-width-light.webp) | ![](critique-2026-10/after/49-roadmap-ghost-rows-min-width-dark.webp) |
| 50 | Epic shaping: slicing, the Stories as columns in execution order, ghost columns for proposed Stories, a proposed move on its column and the runs-after brackets between the Stories they link (#127) | ![](critique-2026-10/after/50-epic-shaping-story-columns-light.webp) | ![](critique-2026-10/after/50-epic-shaping-story-columns-dark.webp) |
| 51 | Epic shaping: Amend opens a proposed Story's title, description and runs-after reason in its ghost column (#127) | ![](critique-2026-10/after/51-epic-shaping-amend-story-light.webp) | ![](critique-2026-10/after/51-epic-shaping-amend-story-dark.webp) |
| 52 | Epic shaping at the window's minimum width: the Story columns scroll sideways (#127) | ![](critique-2026-10/after/52-epic-shaping-story-columns-min-width-light.webp) | ![](critique-2026-10/after/52-epic-shaping-story-columns-min-width-dark.webp) |
| 53 | Board: a Milestone in Shaping offers Shape on its strip row and in its header (#132) | ![](critique-2026-10/after/53-board-milestone-shape-light.webp) | ![](critique-2026-10/after/53-board-milestone-shape-dark.webp) |
| 54 | Milestone shaping: Round 1 of Exit test waiting on you beside the exit test, its ghost and its neighbours (#132) | ![](critique-2026-10/after/54-milestone-shaping-waiting-light.webp) | ![](critique-2026-10/after/54-milestone-shaping-waiting-dark.webp) |
| 55 | Milestone shaping: nothing open, closing Exit test makes the Milestone Ready (#132) | ![](critique-2026-10/after/55-milestone-shaping-closable-light.webp) | ![](critique-2026-10/after/55-milestone-shaping-closable-dark.webp) |
| 56 | Milestone shaping: confirming Close Stage on Exit test (#132) | ![](critique-2026-10/after/56-milestone-shaping-close-confirm-light.webp) | ![](critique-2026-10/after/56-milestone-shaping-close-confirm-dark.webp) |
| 57 | Milestone shaping at the window's minimum width: the dock first (#132) | ![](critique-2026-10/after/57-milestone-shaping-min-width-light.webp) | ![](critique-2026-10/after/57-milestone-shaping-min-width-dark.webp) |
| 58 | Epic card: every Story Merged, so its heading offers Confirm exit test (#134) | ![](critique-2026-10/after/58-epic-confirm-exit-test-light.webp) | ![](critique-2026-10/after/58-epic-confirm-exit-test-dark.webp) |
| 59 | Confirming an Epic's exit test: the dialog quotes it, names the short roadmap Round the click starts, and offers Not met: reopen shaping (#134) | ![](critique-2026-10/after/59-epic-confirm-exit-test-dialog-light.webp) | ![](critique-2026-10/after/59-epic-confirm-exit-test-dialog-dark.webp) |
| 60 | Every Epic Done: Confirm exit test in the picked Milestone's header, its strip row's slot left empty (#134) | ![](critique-2026-10/after/60-milestone-confirm-exit-test-light.webp) | ![](critique-2026-10/after/60-milestone-confirm-exit-test-dark.webp) |
| 61 | Roadmap strip: a Round opened on an Epic's Done, with another Done noted on its band (#134) | ![](critique-2026-10/after/61-roadmap-round-noted-trigger-light.webp) | ![](critique-2026-10/after/61-roadmap-round-noted-trigger-dark.webp) |
| 62 | Another Milestone picked at the window's minimum width: Confirm exit test in Shaping's strip row (#134) | ![](critique-2026-10/after/62-milestone-row-confirm-exit-test-min-width-light.webp) | ![](critique-2026-10/after/62-milestone-row-confirm-exit-test-min-width-dark.webp) |
| 63 | Epic shaping: the criteria Stage, each Story's criteria under its column with the Check chip or judged at review, a proposed criterion as a ghost card under its Story and a rejected one struck through (#128) | ![](critique-2026-10/after/63-epic-shaping-criteria-light.webp) | ![](critique-2026-10/after/63-epic-shaping-criteria-dark.webp) |
| 64 | Epic shaping: the Stage bar keeps the criteria Stage open while a Proposal is undecided and each Story with no criterion is named (#128) | ![](critique-2026-10/after/64-epic-shaping-criteria-stage-open-light.webp) | ![](critique-2026-10/after/64-epic-shaping-criteria-stage-open-dark.webp) |
| 65 | Epic shaping: Amend opens a proposed criterion's statement and Check command under its Story (#128) | ![](critique-2026-10/after/65-epic-shaping-amend-criterion-light.webp) | ![](critique-2026-10/after/65-epic-shaping-amend-criterion-dark.webp) |
| 66 | Epic shaping: confirming the last Stage's close, which makes the Epic and its Stories Ready (#128) | ![](critique-2026-10/after/66-epic-shaping-criteria-close-confirm-light.webp) | ![](critique-2026-10/after/66-epic-shaping-criteria-close-confirm-dark.webp) |
| 67 | Epic shaping at the window's minimum width: criteria under the Story columns (#128) | ![](critique-2026-10/after/67-epic-shaping-criteria-min-width-light.webp) | ![](critique-2026-10/after/67-epic-shaping-criteria-min-width-dark.webp) |
| 68 | Epic shaping: the last Stage closed, the Epic and its Stories Ready, the dock waiting for no Round (#128) | ![](critique-2026-10/after/68-epic-shaping-criteria-closed-light.webp) | ![](critique-2026-10/after/68-epic-shaping-criteria-closed-dark.webp) |
| 69 | Milestone shaping: the exit test edited by hand in place, Edit on the title too, the pending ghost still under the field (#149) | ![](critique-2026-10/after/69-milestone-shaping-edit-exit-test-light.webp) | ![](critique-2026-10/after/69-milestone-shaping-edit-exit-test-dark.webp) |
| 70 | Project board: Since you last looked unfolded above the roster, seven events oldest first, each naming its record (#167) | ![](critique-2026-10/after/70-since-you-last-looked-light.webp) | ![](critique-2026-10/after/70-since-you-last-looked-dark.webp) |
| 71 | Review card: the failing Check first with its output tail scrolled to its end, a criterion pre-ticked by its passed Check still to accept, Merge held (#155) | ![](critique-2026-10/after/71-review-card-judging-light.webp) | ![](critique-2026-10/after/71-review-card-judging-dark.webp) |
| 72 | Review card: Merge with failing Check confirms in an AlertDialog naming the Check (#155) | ![](critique-2026-10/after/72-review-card-merge-with-failing-check-light.webp) | ![](critique-2026-10/after/72-review-card-merge-with-failing-check-dark.webp) |
| 73 | Review card: every criterion accepted and every Check passed, Merge filled (#155) | ![](critique-2026-10/after/73-review-card-ready-light.webp) | ![](critique-2026-10/after/73-review-card-ready-dark.webp) |
| 74 | Board: an In review Story's row offers Open review (#155) | ![](critique-2026-10/after/74-board-open-review-light.webp) | ![](critique-2026-10/after/74-board-open-review-dark.webp) |
| 75 | Needs you: the ranked 400px column beside the roster, requests first, each answered in its card, and each project's Needs-you figure in the sidebar (#156) | ![](critique-2026-10/after/75-needs-you-column-light.webp) | ![](critique-2026-10/after/75-needs-you-column-dark.webp) |
| 76 | Needs you, scrolled: Stopped with Resume, a missing worktree with Recreate, Review, Confirm exit test and Rounds no session works, with Continue shaping (#156) | ![](critique-2026-10/after/76-needs-you-column-decisions-light.webp) | ![](critique-2026-10/after/76-needs-you-column-decisions-dark.webp) |
| 77 | Needs you at the window's minimum width: the top bar's Needs you button opens it as a Sheet (#156) | ![](critique-2026-10/after/77-needs-you-sheet-min-width-light.webp) | ![](critique-2026-10/after/77-needs-you-sheet-min-width-dark.webp) |
| 78 | Needs you: Confirm exit test from an Epic's card opens the same dialog as the Epic card (#156) | ![](critique-2026-10/after/78-needs-you-confirm-exit-test-light.webp) | ![](critique-2026-10/after/78-needs-you-confirm-exit-test-dark.webp) |
| 79 | Needs you: judged-on changes ranked with Review, an Amend criterion with its Check and an Amend Epic spec, each with its before and after and Accept, Edit, Reject (#163) | ![](critique-2026-10/after/79-needs-you-judged-on-light.webp) | ![](critique-2026-10/after/79-needs-you-judged-on-dark.webp) |
| 80 | Needs you: editing an Amend criterion in place, its statement and Check command, then Accept edit (#163) | ![](critique-2026-10/after/80-needs-you-judged-on-edit-light.webp) | ![](critique-2026-10/after/80-needs-you-judged-on-edit-dark.webp) |
| 85 | Review card: the Decisions section, an edited ADR, a new ADR with its hand-off bar lines and related live ADR, one with bar lines from shaping, one with none, each with Keep selected, and the glossary (#161) | ![](critique-2026-10/after/85-review-card-decisions-light.webp) | ![](critique-2026-10/after/85-review-card-decisions-dark.webp) |
| 86 | Review card: the Decisions section at the window's 900px minimum width (#161) | ![](critique-2026-10/after/86-review-card-decisions-min-width-light.webp) | ![](critique-2026-10/after/86-review-card-decisions-min-width-dark.webp) |
| 92 | Review card: Rebase needed names the conflicting files first, with Request rebase; Merge held (#158) | ![](critique-2026-10/after/92-review-card-rebase-needed-light.webp) | ![](critique-2026-10/after/92-review-card-rebase-needed-dark.webp) |
| 93 | Review card: Request changes opens the composer in the footer, Send back to Running filled (#158) | ![](critique-2026-10/after/93-review-card-request-changes-light.webp) | ![](critique-2026-10/after/93-review-card-request-changes-dark.webp) |
| 96 | Needs you: the Proposals row, "4 from 3 Stories" with Triage, and FLY-1's "3 Proposals" on the roster (#162) | ![](critique-2026-10/after/96-needs-you-proposals-row-light.webp) | ![](critique-2026-10/after/96-needs-you-proposals-row-dark.webp) |
| 97 | Triage drawer: grouped by Epic, then the Roadmap; each card with its kind, change, why, evidence and filing Story (#162) | ![](critique-2026-10/after/97-triage-drawer-light.webp) | ![](critique-2026-10/after/97-triage-drawer-dark.webp) |
| 98 | Triage drawer: Amend opens a New Story's title and description, its why kept in sight (#162) | ![](critique-2026-10/after/98-triage-drawer-amend-light.webp) | ![](critique-2026-10/after/98-triage-drawer-amend-dark.webp) |

## How the screens were rendered

The renderer reaches Tauri only through `packages/desktop/src/adapters/tauri.ts`, which calls `invoke` and
`listen` from `@tauri-apps/api`. The cheapest honest render is the real `<App />` with only that transport
faked:

- `packages/desktop/src/test/critique/m2-fixture.ts` answers every IPC command with Tauri's own `mockIPC`,
  from seeded data shaped like Flywheel's own backlog: two projects, the Milestone "Shaping" with two
  Epics, a Story in every Story state, a live session, a Gated action, a permission request, an agent's
  question, a Stopped Story and a handed-off session. No database is opened.
- `m2-flow.critique.browser.test.tsx` mounts the app in Playwright's WebKit (the engine closest to the
  shipped WKWebView) at **1440 × 900**, walks the M2 flow by clicking the real controls, and screenshots
  each screen in the light and the dark scheme. Re-shoot with
  `CRITIQUE_SCHEME=light npx vitest run --config vitest.critique.config.ts src/test/critique` (and `dark`)
  in `packages/desktop`.
- `packages/desktop/critique.html` mounts the same app over the same data for any browser (`npx vite`,
  then `/critique.html`, `?session=ses-4b&story=s-4` or `?fleet=queue`). The URL detector scan used it.

Every component, hook, query and style is the shipped code. What is not real: the data, and the fact that
nothing changes when a write is made.

## Screens

Each pair is light, then dark. Files are in [`critique-2026-10/`](critique-2026-10/).

| # | Screen | Light | Dark |
|---|---|---|---|
| 01 | Project board, first viewport | ![](critique-2026-10/01-board-light.webp) | ![](critique-2026-10/01-board-dark.webp) |
| 02 | Board, the Write a Story form | ![](critique-2026-10/02-board-write-story-light.webp) | ![](critique-2026-10/02-board-write-story-dark.webp) |
| 03 | Story detail: Tasks open, a note open | ![](critique-2026-10/03-story-tasks-light.webp) | ![](critique-2026-10/03-story-tasks-dark.webp) |
| 04 | Story detail: a Stopped Story's Tasks and sessions | ![](critique-2026-10/04-story-stopped-sessions-light.webp) | ![](critique-2026-10/04-story-stopped-sessions-dark.webp) |
| 05 | Resume with a note | ![](critique-2026-10/05-story-resume-light.webp) | ![](critique-2026-10/05-story-resume-dark.webp) |
| 06 | Drop confirmation | ![](critique-2026-10/06-story-drop-confirm-light.webp) | ![](critique-2026-10/06-story-drop-confirm-dark.webp) |
| 07 | Session feed, running | ![](critique-2026-10/07-feed-running-light.webp) | ![](critique-2026-10/07-feed-running-dark.webp) |
| 08 | Feed, a failed call expanded | ![](critique-2026-10/08-feed-call-expanded-light.webp) | ![](critique-2026-10/08-feed-call-expanded-dark.webp) |
| 09 | Feed, Gated action card | ![](critique-2026-10/09-feed-gated-action-light.webp) | ![](critique-2026-10/09-feed-gated-action-dark.webp) |
| 10 | Feed, the agent's question | ![](critique-2026-10/10-feed-question-light.webp) | ![](critique-2026-10/10-feed-question-dark.webp) |
| 11 | Feed, permission request with Always allow | ![](critique-2026-10/11-feed-permission-request-light.webp) | ![](critique-2026-10/11-feed-permission-request-dark.webp) |
| 12 | Feed of a handed-off session, opened from the Story | ![](critique-2026-10/12-feed-handed-off-light.webp) | ![](critique-2026-10/12-feed-handed-off-dark.webp) |
| 13 | Waiting on you queue (sidebar → Requests) | ![](critique-2026-10/13-waiting-on-you-queue-light.webp) | ![](critique-2026-10/13-waiting-on-you-queue-dark.webp) |
| 14 | Fleet, all agents | ![](critique-2026-10/14-fleet-light.webp) | ![](critique-2026-10/14-fleet-dark.webp) |
| 15 | Click a project in the sidebar while a feed is open | ![](critique-2026-10/15-nav-project-click-keeps-feed-light.webp) | ![](critique-2026-10/15-nav-project-click-keeps-feed-dark.webp) |
| 16 | Click a project in the sidebar while the fleet is open | ![](critique-2026-10/16-nav-project-click-keeps-fleet-light.webp) | ![](critique-2026-10/16-nav-project-click-keeps-fleet-dark.webp) |

What each screen shows, in one line:

- **Sidebar** (every shot): logo, WAITING ON YOU → "Requests 3", PROJECTS with each project's live
  sessions under it, "Register Project…", "Remove from Flywheel…", FLEET → "All agents", "Worktrees".
  Running-session rows are 11px text that truncates the Story title to two letters ("FLY-5 Pu…") to make
  room for "Waiting on you".
- **Project board** (01, 02): the project name, then one flat list of every Story in the project, then a
  three-fieldset form. No Milestone, no Epic, no Acceptance criteria, no Checks and no progress anywhere
  on the list.
- **Story detail** (03 to 06): there is no Story detail. "Tasks (1/4)" and "Sessions" expand inline under
  the row; Resume and Drop replace part of the row with a form.
- **Session feed** (07 to 12): a header (← Board, key and title, run status, elapsed time, View raw, Stop,
  Discard), the transcript anchored to the bottom of an otherwise empty pane, and a one-line floor.
- **Permission and question cards** (09 to 11, 13): the Gated action card (red edge, Deny leads), the
  question card (radios, checkboxes, Other, Send answer), the permission request (Allow once, Deny ›, a
  Pattern field, "Always allow this pattern in this project ›").
- **Waiting on you queue and fleet** (13, 14): the same cards stacked across projects, and a banded
  table of every run.

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 1 | No progress anywhere; a handed-off session reads "Running" with a live Stop button (12); the board never shows criteria or Check results. |
| 2 | Match system / real world | 2 | Glossary words are used correctly, but the board is not shaped like the model it names: no Milestone, no Epic, a flat Story list. |
| 3 | User control and freedom | 1 | Clicking a project in the sidebar does not leave an open feed or the fleet (15, 16); "← Board" from a feed opened in the fleet lands on the fleet. |
| 4 | Consistency and standards | 2 | The same "Waiting on you" is a yellow pill on the board, bold yellow text in the sidebar and an icon badge in the header; rail session rows are buttons that look like captions. |
| 5 | Error prevention | 2 | Drop sits beside Start and Resume at the same weight; the Gated action card is well guarded (Deny leads, no rule). |
| 6 | Recognition rather than recall | 1 | To see what a Story's agent is doing you must know to use the sidebar row or "Sessions → Open feed"; the Story row, its title and its "Running" word do nothing. |
| 7 | Flexibility and efficiency | 2 | Keyboard map exists; the M2 actions are reachable, but every one is a same-weight outlined button among six on the row. |
| 8 | Aesthetic and minimalist design | 1 | Every element has the same visual weight; region contrast is 1.03 to 1.06; 13 to 15 controls per Story row once expanded. |
| 9 | Error recovery | 3 | Stopped is explicit with its reason, Resume takes a note, stub summaries say what the dead session was doing. |
| 10 | Help and documentation | 2 | Plain copy ("A Story is written inside an Epic: choose one above"), but nothing explains what a Context packet figure means or where criteria went. |
| **Total** | | **17/40** | **Poor** |

## Design specificity verdict

**Design review.** Category-interchangeable, and in places not designed at all. The board is the scaffold
the M2 Story #50 said it was ("a plain live list … Scaffolding: … the board surface replaces the list"),
and it shipped as the home screen. Nothing on it is specific to Flywheel's model: a key, a title, a grey
token count, a state word in 11px and a row of outlined buttons would fit any task list. The places that
do carry Flywheel's character are the cards that Waiting on you produces: the Gated action card (09) and
the question card (10) are the clearest, most product-specific surfaces in the app, because they are the
only ones with a single job and a decided hierarchy. The rest of the "Mission Control" world (no fills,
no tinted rows, hairline rules, the brand only on progress) removed hierarchy faster than it added
meaning, and the one thing the brand was reserved for, progress, has no surface to appear on: the brand
blue appears nowhere in screens 01 to 16 except the focus ring.

**Deterministic scan.** `impeccable detect` over the source of the M2 surfaces (`StoryBoard.tsx`,
`TaskChecklist.tsx`, `session/`, `ProjectRail.tsx`, `FleetSurface.tsx`, `BlockedQueue.tsx`, `App.tsx`)
found **0** issues. Over the rendered app at 1440 × 900 (board, running feed, Gated action feed, question
feed, Waiting on you queue, through `critique.html`) it found **one rule on all five pages:
`monotonous-spacing`** ("~4px used 12/12 times (100%)": no rhythm, no grouping by space). That agrees
with the review's main finding: nothing is grouped or separated by spacing, so nothing stands out. The
detector does not measure surface contrast between regions, which is where this design fails (see
complaint 1), so a clean contrast report is not evidence of hierarchy.

**Visual overlays.** None: no browser automation tool that can inject the overlay was available. The URL
scan ran headless.

## Cyril's five complaints, scored and explained

Scores are 0 (not a problem in the build) to 4 (the build causes it every time).

### 1. "Navigation is difficult, there is a lot of information and nothing really stands out because the design has zero contrast." Score: 4

Causes, in order of weight:

1. **Region contrast is near zero, by rule.** Text contrast is fine (ink 15.8:1, muted 6.1:1). What is
   missing is contrast between *things*. The sidebar against the board measures 1.06:1 in light and
   1.03:1 in dark; the "Waiting on you" wash against the ground 1.06:1 and 1.04:1; the row hairlines
   1.43:1. "Mission Control" chose this ("no fills, no tinted rows, no cards"), and its own DESIGN.md
   records that the selected-row wash was capped at 1.074:1. The eye has no regions to land on.
2. **One weight for everything.** Body 13px, labels 11px, headings 15px (a 1.15 step), two weights. On
   the board the project name is the only heading; "Stories" and "Write a Story" are 11px grey labels. The
   Story title, its "Doing:" line and its token count compete at nearly the same size.
3. **Every action is the same button.** Each Story row carries three to four outlined buttons of the same
   size (Tasks, Sessions, Drop, then Start or Resume); the lead action differs only by a 2px border. With
   Tasks open (03) a row holds 13 to 15 buttons. The detector's `monotonous-spacing` finding is the same
   problem in space: a single 4px rhythm, so nothing is grouped.
4. **Information without a rank.** The row prints the Context packet size (~9.4K tokens) on every Story
   at the same weight as its state, while the thing a supervisor needs (is it waiting on me, is it done)
   is a small word at the far right.
5. **Navigation is broken, not just hard** (see complaint 3 for the mechanism): with a feed open, clicking
   another project in the sidebar highlights it and changes nothing else (15); with the fleet open, the
   same (16).

### 2. "Some elements I expect to be clickable, to see what the agent is doing, are not." Score: 4

Causes:

1. **The Story row is inert.** On the board (01) the key, the title, the "Doing: …" line and the
   "Running" or "Waiting on you" word are plain text. The only paths to a Story's live feed are the
   sidebar's session rows or "Sessions" → "Open feed" (04). The one sentence that says what the agent is
   doing is the one that cannot be clicked.
2. **The Waiting on you pill on the board is not a control.** It tells you to act and gives you nowhere to
   act; the card that answers it lives in the feed or the queue.
3. **Sidebar session rows are buttons styled as captions** (11px muted text, no edge, no hover until
   pointed at), so the clickable thing looks like the inert thing and the inert thing (the board row)
   looks like the one that should open.
4. **Story detail does not exist**, so there is no destination to click to. Tasks, sessions, Resume and
   Drop unfold inline in the list (03 to 06), and a Story's Acceptance criteria and Checks are not shown
   anywhere after it is written: no component reads `criterion_list`.
5. **Feed rows hide their disclosure.** A tool call is expandable only through a 7px "▸" glyph and the
   row text (08); nothing marks it as a control.

### 3. "Sometimes it randomly opens the agent when I would not expect it." Score: 3

The behaviour is deterministic, but its rules are invisible, so it reads as random. Causes, all in code:

1. **Start and Resume push straight into the feed.** `StoryBoard`'s `onStarted` calls
   `setActiveSessionId`, replacing the board with the session the moment Start resolves. Clicking Start to
   start several Stories in a row takes you out of the board each time.
2. **The open feed outranks everything.** `activeSurface` (`state/keyboard.ts:548`) ranks the session above
   the fleet and the board, and choosing a project (`setCurrentProjectId`) does not clear it. So after
   opening one feed, the next project you pick still shows that feed (15), which feels like the agent
   "opened itself" over the project you asked for. The sidebar's "Requests" and "All agents" open the
   fleet *underneath* an open feed: nothing visible happens.
3. **"← Board" does not always go to the board.** A feed opened from the fleet returns to the fleet,
   while the button still says "Board".
4. **Sidebar session rows sit directly under the project name** at almost the same size, so a click
   aimed at a project often lands on one of its sessions.
5. **Discard opens the launch sheet** for the same Story with no step between.

### 4. "There are very few icons, or none at all." Score: 4

Causes:

1. **The board and the Story's Tasks use no icons at all.** `StoryBoard.tsx` and `TaskChecklist.tsx`
   import nothing from `lucide-react`; their 27 buttons are words. State words (Shaping, Ready, Running,
   In review, Merged, Dropped) have no mark; only Waiting on you gets one.
2. **The sidebar has two icons** (`Plus`, `TriangleAlert` for an unreachable project). Sections, projects,
   the fleet and the worktrees have none.
3. **The feed uses text glyphs** ("▸", "·", "—") where a tool's kind (read, edit, run, board tool) would
   be told at a glance by an icon; Bash, Read and `mcp__flywheel-board__task_add` look identical.
4. **The rule that limited icons was the old world's**, not a product constraint: "Mission Control" put
   meaning in words and kept marks outline-only and sparse. PRODUCT.md keeps "meaning never on colour
   alone", which an icon *plus* a word satisfies better than a word alone.

### 5. "I cannot quantify project progress at a glance." Score: 4

Causes:

1. **No progress is shown anywhere.** The board has no Milestone, no Epic, no counts and no bar. Spec §7's
   Milestone header ("a stacked bar of Story states with Epics done / Epics · Stories merged / Stories")
   and the roster's per-Epic bar were never built in M2 (they belong to M4 Epic #61), and "Mission
   Control"'s epic-row progress bar went with the old board in the M1 delete pass (#38).
2. **The list cannot be read as progress.** Stories from every Epic and both ends of the life cycle
   (Shaping and Merged) sit in one flat list, ordered by rank, with the state as an 11px word on the
   right. Counting means reading every row.
3. **Done work does not look done.** Merged and Dropped rows are visually identical to Ready ones apart
   from that word.
4. **Task fractions are hidden in button labels** ("Tasks (1/4)"), and criteria/Check results, the real
   measure of a Story's progress, are not shown at all.

## Overall impression

The plumbing under the M2 flow works and the copy is honest. The surface does not do the one job PRODUCT.md
gives it: supervision at a glance. Every screen is a list of same-weight text and same-weight buttons on
an almost uniform ground, and the navigation model has a precedence rule the user cannot see. The biggest
opportunity is structural before it is visual: a board shaped like the model (Milestone → Epics →
Stories, with progress), a real Story detail as the place a click goes, and one predictable rule for
what replaces the content area.

## What's working

- **The Gated action card (09).** One job, one sentence of consequence ("This would push
  story/fly-5-tokens to the remote, where others can see it."), the literal command, Deny leading. It is
  the only element in the app with a decided hierarchy, and it should survive the new world in substance.
- **The question card (10).** Numbered questions with recommended options, "Other" with a free answer,
  "Answer every question to send". It is already close to the shaping dock's Round card in spec §3.
- **Honest status copy.** "Stopped: usage limit", stub summaries that name the doing Task, "Last activity
  13s ago", "This run has ended. Nothing more will be added".

## Priority issues

- **[P0] The board has no shape and no progress.** Why: complaints 1 and 5; the exit test of Epic #97
  needs Cyril to read status without explanation. Fix: Milestone header with a stacked bar and counts,
  Epics as groups with their own bar, Stories under them, Needs you above the roster (spec §7).
  Command: `/impeccable shape` then new-work in #103.
- **[P0] Navigation precedence is invisible and sticky.** Why: complaints 1 and 3; screens 15 and 16. Fix:
  one rule: a sidebar choice always replaces the content area; Back returns to where you came from and
  says so; Start does not leave the board unless asked. Story #104.
- **[P1] The Story has no detail surface, and its criteria and Checks are never shown.** Why: complaint 2,
  and the product's core value ("anchored to real Acceptance criteria") is invisible after writing. Fix: a
  Story detail (panel or page) that is the destination of a row click: criteria with Check chips, Tasks,
  sessions, the live feed one click away. #103 mockups, #107.
- **[P1] No hierarchy in type, surface or action.** Why: complaint 1. Fix: a type scale with real steps,
  regions with measurable contrast, one primary action per region, destructive actions separated.
  `/impeccable typeset`, `/impeccable layout` inside the new world (#105).
- **[P1] A finished session opened from its Story reads "Running" with Stop and Discard (12).** Why: wrong
  status at the moment Cyril checks whether work is done. Fix: the Story's session list passes the run's
  status like the sidebar and fleet do. Story #104 or #107.
- **[P2] Icons.** Why: complaint 4. Fix: an icon per state, per record type, per tool kind, always with
  its word. #105.

## Persona red flags

**Cyril, supervising five Stories across two projects (project persona).** Opens Flywheel: the sidebar says
"Requests 3" in small yellow; the board lists nine Stories with no grouping. To find which Story needs him
he reads the yellow pills on the right, then cannot click them; he goes to the sidebar, where the
session rows are truncated to "FLY-5 Pu…". He answers the push in the feed, clicks "highknow-web" to check
the other project, and still sees the same feed (15).

**Cyril, shaping by hand (project persona).** Scrolls past the whole Story list to a three-fieldset form
(02). Must pick a Milestone, then an Epic, before the Story fields enable; Check commands are optional
fields beside each criterion, which is why three M2 runs never added a Check (Epic #97 comment). After
Create Story, the criteria and Checks he wrote are never shown again.

**Alex (power user).** The keyboard map still lists board bindings (`j`/`k`, `o`, `w` Start Work, `l` Open
Live Session), but no mounted component registers the `board-list` region any more: on the Story list
there is no selection to move and none of those keys does anything.

**Jordan (first-timer).** "Context packet ~9.4K tokens" on every row, "Sessions", "Discard" next to
"Stop", and "Waiting on you: answer the permission request above" under a *question* (10): vocabulary
without explanation.

## Minor observations

- The feed is bottom-anchored, so a short transcript leaves two thirds of the pane empty above it
  (07, 09, 11, 12).
- The feed floor says "answer the permission request above" when the open request is a question (10).
- Fleet: Story titles truncate to about 14 characters, and cost prints four decimals ("$3.1000"; the
  figure is fixture data, the format is the shipped `formatCostUsd`).
- The resume note and Drop form reflow the row (05, 06) instead of opening in place of the actions.
- Tool names print raw (`mcp__flywheel-board__task_update`).
- The sidebar's "Remove from Flywheel…" sits among the project rows at the same weight as "Register
  Project…".

## Questions for #103

1. Is the Story detail a panel beside the board (the board stays visible) or a page you push into?
   *Recommended: a panel, so the roster stays readable and Back is never ambiguous.*
2. Should Start leave you on the board? *Recommended: yes; the row shows Running and its doing Task, and a
   click on it opens the feed.*
3. How loud should Waiting on you be? *Recommended: the one loud colour in the app, with an icon and a
   count, everywhere it appears, and always a control.*

Questions skipped for the owner in this run: the run had no question tool, so these are handed to #103
instead of asked.

## Screens and states #103's mockups must cover

Each in light and dark, at 1440 × 900, and the board and Story detail also at the 900px minimum window
width (`tauri.conf.json` `minWidth`).

1. **Sidebar**
   - projects with each one's Needs-you count; the current project
   - live sessions under a project: running with its doing Task, Waiting on you, Stopped
   - nothing waiting; several waiting across projects; an unreachable project
2. **Project board** (spec §7)
   - Milestone header: name, Exit test, stacked bar of Story states, "Epics done / Epics · Stories
     merged / Stories"
   - Needs you list: a Gated action, a permission request, a question, a Stopped session, a review
   - roster: an Epic per row with its bar and "n of m Stories merged", Stories under it
   - a Story row in each state and attention: Shaping, Ready (Start), Running (doing Task), Running +
     Waiting on you, Running + Stopped (Resume), In review, Merged, Dropped
   - visible controls to add a Milestone, an Epic and a Story
   - empty states: a new project with no Milestone; a Milestone with no Epics
3. **Story detail**
   - description; Acceptance criteria with Check chips: not run, passed, failed, timed out, stale,
     "judged at review"; a visible "add a Check" control
   - Task checklist: open, doing with its note, done, dropped with reason; add, edit, reorder
   - sessions with summaries and a stub summary; Context packet size, normal and over the soft limit
   - actions: Start, Stop, Resume with a note, Drop with confirmation; the way to the live feed
4. **Session feed**
   - running and healthy (a live call with its clock); a failed call expanded; a long agent turn in
     markdown
   - Waiting on you: Gated action; permission request with the Always allow pattern, and a refused rule
     with its reason; a question with single choice, multiple choice and Other
   - ended: handed off (In review); Stopped with its ending reason; failed with detail; the raw view
5. **Waiting on you queue** across projects, and the **fleet** of all runs
6. **Navigation**: from the sidebar, the board, a Story row and a notification, where each click lands,
   and how Back returns
