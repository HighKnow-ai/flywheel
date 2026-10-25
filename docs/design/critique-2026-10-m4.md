# Critique of every screen at four window sizes, October 2026 (Milestone 4)

Method: dual-agent (Assessment A, the design review, and Assessment B, the detector, ran as two isolated sub-agents; A finished before B's findings entered this synthesis).

Issue #192, Epic #189. Run with `impeccable critique` on 2026-10-25 against `main` at `30277dd9`, after #191 (rail) and #190 (feed) merged. The committed shots were re-taken on `main` at `23126331`, after #196 (HighKnow's tokens and Public Sans), #195 (refetch flicker) and #197 (the palette) merged; #196 changes the face and palette only, which this critique leaves to it, so the findings still stand on the new shots. The shadcn/ui inventory below was a third, separate read of the source.

The owner asked for "the best UI/UX possible" before a week of real work, on the best prebuilt shadcn/ui components, with consistency weighted highest, and added: "I don't necessarily have nice motions, animations or loading screens anywhere. The interface feels quite raw." Out of scope here, because a parallel Story owns each: the font face, palette values and the mark's colour (#196), refetch flicker (#195), and a new visual world (Andon stays).

## The harness

`npm --prefix packages/desktop run test:critique` renders the real `<App />` in WebKit over fixture backends and captures every screen at **900 × 600, 1280 × 800, 1440 × 900 and 1920 × 1200**, in light and dark: 198 tests, about 6 minutes per scheme.

- `src/test/critique/m2-flow.critique.browser.test.tsx`: the Milestone 2 to 4 walk (screens 01 to 119) on the clean M2 fixture, clicked through the real controls. A screen named `-min-width` is a state reached at the minimum window and is captured at 900 × 600 only.
- `src/test/critique/stress.critique.browser.test.tsx` over `stress-fixture.ts` (screens `s01` to `s35`): a project with a 37-character name, a long repository path and the key prefix `PRESALES`; six Milestones with long titles and exit tests; nine Epics and 52 Stories with titles up to 200 characters in every state; a Story with 24 Tasks, 8 criteria with long Check commands and 8 sessions; a live session whose log is shaped like real Claude CLI output (hook notices, the stdin warning, rate limits, a 529 retry, a heredoc command, failed commands with long output), an ended one, and #190's 168-line synthetic log; 12 Needs-you items; 18 Proposals; a 26-file review; ten projects including an empty one, one with a Milestone and no Epic, and an unreachable one; Settings with 18 permission rules; 22 worktrees; an orphaned run; a missing `claude`; reads that fail; the launch sheet, the palette, the Merge dialogs and Write a Story.
- `src/test/critique/layout-defects.ts`, run on every capture: the window must not scroll (the cause of #191), no visible element may reach past the window's edge unclipped, no two lines of text from different nodes may be drawn over each other in the same layer (the class of #190), and the rail and the main pane must each span the window's height. `capture.ts` lists the defects already filed, each with its Story, so CI fails only on new ones.
- CI runs the check in light with no screenshots: `npm --prefix packages/desktop run test:layout-defects`, a step of the Desktop browser tests job.

The committed shots in [`critique-2026-10-m4/`](critique-2026-10-m4/) are every screen at 1440 × 900 in both schemes, plus 900 × 600 and 1920 × 1200 in light for the screens whose layout changes with the window (`cwebp -q 78`). Every size is still checked by the defect test.

### What the layout-defect check found

Before #191 and #190 merged, the walk failed on 105 captures: the window scrolled, so the rail and the main pane were carried off the top. After both merged, the walk is clean at every size. The stress data found four new defects, filed and marked in `capture.ts`:

| Defect | Where | Story |
|---|---|---|
| Opening the command palette (Search, ⌘K) crashed the app: `CommandDialog` rendered cmdk's items outside `<Command>` | `s33`, `components/ui/command.tsx` | #197, fixed in #216 before this report merged; `s33` now shoots the palette |
| A long project name or Story key in the breadcrumb is drawn under Search and its ⌘K hint at 900 × 600 | `s06`–`s12`, `s16`–`s18`, `s31` | #199 |
| The Merge-with-failing-Check confirm is pushed 76–92 px past the window by a long Check command | `s18` | #207 |
| A long permission pattern is drawn over its date column at 1920 × 1200 | `s20` | #209 |

## Design health score

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | The strip is excellent, but three different agent totals show on one screen (16, 14, 17), a failed read is a skeleton for about 7 s then a red line, pending is a label swap, and nothing confirms a Merge landed. |
| 2 | Match with the real world | 3 | Domain words are right; raw machine data leaks: `ses-b1`, `usage limit reached\|1761483600`, absolute `/Users/…` paths, `amend story`, "Stub summary", `$3.1000`. |
| 3 | User control and freedom | 2 | Stop confirms on the Story view but not in the feed; Discard and Kill don't confirm; nothing can be undone. |
| 4 | Consistency and standards | 1 | Seven legacy screens beside the Andon ones; native selects beside Popovers; Allow and Deny swap sides; four add styles, five destructive styles, five cancel styles, three key styles, six time formats. |
| 5 | Error prevention | 2 | The Allow/Deny flip; an unconfirmed Discard next to Stop; Remove from Flywheel always in the footer; the Merge confirm breaking on a long command. |
| 6 | Recognition over recall | 3 | Icons carry words; but `ses-b1` vs "Session 8", and one yellow badge with two meanings. |
| 7 | Flexibility and efficiency | 2 | ⌘K (crashed until #197), ⌘[ and A/D exist; no bulk actions on Worktrees or Proposals, no collapsible rail, shortcuts not shown. |
| 8 | Aesthetic and minimalist design | 2 | "criteria 0/0 · tasks 0/0" on every done row; every row control always visible; Done Epics first; a 3-line Milestone name pushes Needs you below the fold. |
| 9 | Error recovery | 1 | 62 sites render an error as a red sentence and one offers a retry; raw git and CLI strings; "No Tasks yet" shown when the read failed. |
| 10 | Help and documentation | 2 | Empty states teach a little in a good voice; no shortcut sheet; Discard vs Stop unexplained. |
| | **Total** | **20/40** | **Acceptable, bottom of the band.** |

Cognitive load: 4 of 8 checks fail (single focus, visual hierarchy, minimal choices, working memory), mostly from the board's first viewport on a big project.

## Design specificity

**Assessment A.** Authored where the work happens, interchangeable in the plumbing. The andon strip and lamp, the graphite "Stories merged" lead box, the count boxes and stacked bar, the yellow request cards, the Round dock with pre-filled recommended answers, the ghost-field Proposals and the runs-after connectors could only be Flywheel. Settings, Worktrees, First run, Register project, Unreachable project, Orphan recovery and the missing-`claude` notice are a different, older app: bare floor or a white page, chip buttons, native and hand-rolled controls, blue-ring "focused" buttons where filled primaries belong. Inside the Andon screens the vocabulary drifts. The owner's consistency complaint is accurate.

**Assessment B, deterministic scan.** The source scan (`impeccable detect --json packages/desktop/src`, 186 files) is clean, but those are regex rules only; a control file with planted faults did trip it. The page-level scan over `critique.html` (the real app over the M2 fixture, six URLs, dark only, since the detector's browser reports dark) found 15: five `low-contrast` and five `gray-on-color`, three `nested-cards`, one advisory `repeating-stripes-gradient`. All six real contrast failures are one dark token pair, `--subtle-foreground` #80868f on `--attention-muted` #352d00 at 3.7:1 (Needs-you ages, a Waiting-on-you roster row's detail, a blocked All-agents row's age); light passes. The token values are #196's, so it is noted there (F50), not filed. `nested-cards` is the Milestone header's stat tiles inside its card, intended (F51). The stripes are the Shaping hatch of the stacked bar, which carries meaning: a false positive. No overlay ran on the app itself: Tauri on macOS renders in WKWebView, which exposes no DevTools protocol.

**Where they agree.** Both put the problems at the edges (attention-tinted rows, the legacy screens) rather than in the core world; the detector's contrast pair sits exactly on the rows A asks to stop tinting yellow unless they wait on you (F41).

## What works

1. **The andon strip is a real signature.** Every project's live sessions, oldest Waiting-on-you first, with a quiet "No agent running" line that keeps the layout still. Supervision across projects works at a glance.
2. **The request cards are among the best in the category.** Numbered questions with recommended answers and "Other", the Gated action's consequence sentence with the safe choice leading, the Round dock's Accept all recommended, ghost Proposals decided in place.
3. **The state vocabulary is disciplined inside the Andon screens.** `StateBadge` gives one icon, word and tone per state, neutral stays neutral, and the accessibility work runs deep (live-region announcements, focus handed to the next card).

## Findings

Every finding names its screens and shots (in `critique-2026-10-m4/`, `<screen>-<size>-<scheme>.webp`), the problem, the fix with the shadcn/ui component where one applies, and the Story that fixes it. P2 and P3 findings are grouped into the Story for their area.

### P0

| ID | Screen and shot | Problem | Fix | Story |
|---|---|---|---|---|
| F1 | Every screen: the Search button and ⌘K (`s33-command-palette-1440x900-light`, shot after the fix) | Opening the command palette threw inside cmdk and took the React tree down; no test opened it. | Wrap `CommandDialog`'s children in shadcn's `<Command>`; a browser test for the palette. | #197 (fixed, #216) |

### P1

| ID | Screen and shot | Problem | Fix | Story |
|---|---|---|---|---|
| F2 | Settings, `s20-stress-settings-1440x900-light`, `-dark` | Legacy screen: chip buttons with a blue ring for "selected", a per-project list clipped mid-row in a fixed box, a bare circle-check for Notifications, Title Case, no save confirmation, no `components/ui/` import; the rules grid overlaps at 1920. | Card sections, Field + Label, Radio Group, Table with a Select per row, Table for rules, Switch, Input, Skeleton, a Sonner toast on save. | #209 |
| F3 | Worktrees, `s21-stress-worktrees-1440x900-light` | Rows on the bare floor, no headers, the project repeated and truncated, checkboxes with no action, a hand-rolled confirm. | Card + Table with a sticky header, grouped by project, Checkbox select-all, a sticky Reclaim bar behind Alert Dialog. | #208 |
| F4 | First run and Register project, `s24-first-run-1440x900-light`, `s25-register-project-1440x900-light`, `s26-register-project-error-1440x900-light` | A white page, an outline primary with a permanent focus ring, "Register Project…" vs "Register project…", the error a 12 px red line with a raw git command (`--show-toplevel` set as an em dash). | Empty with a filled primary; Register as a Dialog with Field + Input; the error as Alert with the raw detail in a Collapsible in mono. | #210 |
| F5 | Orphan recovery, `s28-orphan-recovery-1440x900-light` | Hand-rolled modal; a raw UUID; unconfirmed per-row Kill; "Kill All" in a third destructive style; rows of different shapes. | Alert Dialog with Item rows, `destructive` Buttons, "Stop 2 agents" / "Leave running". | #210 |
| F6 | Missing `claude`, `s29-claude-missing-1440x900-light` | A fixed box of red text over the andon strip, covering lamps, with no action. | Alert in a reserved slot under the top bar, with Open Settings. | #210 |
| F7 | Unreachable project, `s27-project-unreachable-1440x900-light` | A white void without the top bar; only Locate; no mark on the project in the rail. | Keep the shell; Empty with Alert; Locate project… and Remove from Flywheel…; a warning icon with Tooltip in the rail. | #210, #200 |
| F8 | Every error, `s26`, `s29`, `s30`, `s31` | 62 sites render `text-destructive-text` sentences with raw `error.message`; one offers a retry. | One `ReadError` on Alert: a title, a human line, Try again (`refetch`), the raw detail in a Collapsible. | #198, then each area |
| F9 | Failed reads, `s30-board-read-error-1440x900-light`, `s31-story-read-error-1440x900-light` | A dead read keeps a Skeleton up for about 7 s (three retries), then the Needs-you column is blank and the Story view says "No Tasks yet". | `retry: 1` for local IPC reads; ReadError in each card; an empty state only on success. | #198, #202, #203, #204 |
| F10 | After every action: Merge (`73`), Start (`s32`), Accept (`s15`), Answer (`10`), Make Ready (`113`) | Nothing acknowledges success; the item just changes or vanishes. Merge, the end of every loop, ends in silence. | Install Sonner; toast Merge ("FLY-3 merged into main · worktree cleaned", Open board), Start, Resume, Accept and Reject (with Undo), Stop, Discard, Kill, saved Settings. | #198, then #203, #204, #207, #211 |
| F11 | Every pending button | "Merging…", "Starting…", "Saving…" replace the label and resize the button; only Re-run Checks spins; a seconds-long Merge shows nothing moving. | A `loading` prop on Button with Spinner and `aria-busy`; Progress and the current step for Merge and Re-run Checks. | #198, then each area |
| F12 | Merge with a failing Check, `s18-stress-merge-confirm-1440x900-light`, `s18-…-900x600-light` | The 384 px confirm can't hold a long Check command; its header, list and footer overflow the window, buttons hang outside the box. | A wider confirm, `min-w-0` with wrapping or a Scroll Area on the command. | #207 |
| F13 | All agents, `s13-stress-fleet-1440x900-light` | AGENTS 16 on the strip, All agents 14 in the rail, "17 agents" in the fleet; the yellow project badges count Needs you while the identical yellow Waiting-on-you badge counts sessions. | One defined "agent" count (GLOSSARY.md) in all three; the attention Badge only for Waiting on you. | #199, #200, #208 |
| F14 | Feed of another project's Story, `11-feed-permission-request-1440x900-light` | The breadcrumb says highknow-web / HKW-2 but the rail raises flywheel as current. | Derive the current project from the open Story or session. | #200 |
| F15 | Roster, `s01-stress-board-1920x1200-light`, `s02-stress-board-scrolled-1440x900-light` | "PRESALES-1001" breaks after the hyphen and the title starts there. | StoryKey (never wraps), the key column sized to the longest key. | #202 |
| F16 | Board of a big project, `s01-stress-board-1440x900-light`, `s01-…-900x600-light`, `s05-stress-since-you-last-looked-1440x900-light` | The Roadmap's six rows, a three-line Milestone name and a four-line Exit test fill the window: Needs you starts at the fold at 1440 and is off screen at 900. | Roadmap collapsed to the Current row (Collapsible); the name and Exit test clamped to two lines. | #201 (fixed) |
| F17 | Feed and station, `s08-stress-feed-live-1440x900-light`, `s06-stress-story-view-1440x900-light` | Absolute `/Users/…` paths; the file name, the only useful part, is cut off. | Worktree-relative paths, middle-truncated, the full path in a Tooltip. | #205 |
| F18 | Stop, Discard, Kill: `19-story-stop-confirm-1440x900-light` vs `s08` | Stop confirms on the Story view and not in the feed; Discard is an unexplained ghost button beside Stop; Kill doesn't confirm. | One `ConfirmDestructive` on Alert Dialog. | #198, #204, #205, #210 |
| F19 | Destructive actions across screens (`06`, `72`, `s28`, `s08`, the rail) | Five styles: red text, red text in an outline, a red outline, a neutral ghost, a neutral rail row. | Button `destructive` everywhere; Remove from Flywheel… in a project Dropdown Menu. | #200, #205, #207, #210 |
| F20 | Request cards, `09-feed-gated-action-1440x900-light`, `11-feed-permission-request-1440x900-light`, `s14-stress-waiting-queue-1440x900-light` | Deny is filled on the left of a Gated action; Allow once is filled on the left of a permission request: down a queue the left button means opposite things. | The same slot for Deny on both, in one Button Group; tones unchanged. | #206 |
| F21 | Feed of a session ended by the usage limit, `s11-stress-feed-ended-1440x900-light` | "Claude AI usage limit reached\|1761483600" (a raw epoch) and no next step. | Alert "Usage limit reached · resets 16:00" with Resume and Open Story. | #205 |
| F22 | Review card, `s16-stress-review-card-1440x900-light`, `s17-stress-review-files-1440x900-light` | Merge and Request changes are reached only past all 26 diffs. | A sticky action footer, a file index, diffs collapsed past a few files (Collapsible or Accordion). | #207 |
| F23 | Write a Story, `s34-stress-write-story-1440x900-light`, `116-board-add-story-on-epic-card-1440x900-light` | Two native `<select>`s beside Popover pickers elsewhere; the new-Milestone and new-Epic fields always shown; submit below the fold. | Combobox (Popover + Command) with New Milestone… / New Epic…, Field throughout, a sticky DialogFooter. | #201 (fixed) |
| F24 | Top bar, `s06-stress-story-view-900x600-light`, `s08-stress-feed-live-900x600-light` | At 900 px the breadcrumb slides under Search (a layout defect); a 200-character Story title takes eight lines and pushes the station off screen. | Search collapses to an icon Button with Kbd below about 1100 px; BreadcrumbEllipsis; the title clamped to three lines. | #199, #204 |
| F25 | Motion everywhere (source; stills can't show it) | Disclosures open with no transition (`collapsible.tsx` has none); Needs-you cards, lamps and rows pop; the lamp lighting is a plain colour fade; only shadcn's Dialog and Sheet animate, and the hand-rolled modals don't share it. | Motion tokens on #196's `ease-out-quint`, an animated Collapsible, the lamp as the one authored moment, answered cards collapsing out. | #198, #199, #203 |

### P2

| ID | Screen and shot | Problem | Fix | Story |
|---|---|---|---|---|
| F26 | Roster, `s02-stress-board-scrolled-1440x900-light` | Done Epics, all Merged, lead the roster. | Live Epics first; Done folded in one Collapsible. | #202 |
| F27 | Roster and dock, `113-board-make-ready-row-1440x900-light`, `23-epic-shaping-round-dock-1440x900-light` | Several filled primaries per card; Accept all recommended is blue inside a yellow waiting dock (rule 2). | In-row actions outline; on a waiting item the filled action is attention. | #204, #211 |
| F28 | Add controls, `01-board-1440x900-light`, `03-story-tasks-1440x900-light`, `s22-empty-project-1440x900-light` | Five add styles; "+ Epic" twice. | One "+ Epic"; one ghost-with-plus for in-card adds; Input Group for Task entry. | #201, #204 |
| F29 | Epic card header, `01-board-1440x900-light`, `s01-stress-board-1920x1200-light` | A fixed-width bar, a centred count, "+ Story" floating mid-card. | One grid: title and state, a flexing bar, the count, actions right. | #202 |
| F30 | Feed header, `s08`, `09-feed-gated-action-1440x900-light`, `s11` | Three layouts for running, waiting and ended; the key in Barlow. | One SessionHeader; Discard in a ⋯ Dropdown Menu. | #205 |
| F31 | Story keys across screens, `s13`, `s08`, `01` | Subtle mono, bold blue mono link, plain body text. | One StoryKey component. | #198, then each area |
| F32 | Times, ids, money, `s07-stress-story-sessions-1440x900-light`, `s11`, `s13`, `s21` | "3h 7m", "3:07:26", "2026-10-25 10:07 to …", "measured 1h 1m ago", `ses-b1` vs "Session 8", "$3.1000", "1 840 000 in". | One `format.ts`. | #198, then #205, #208 |
| F33 | All agents, `s13-stress-fleet-1440x900-light` | A table without headers, an empty "—" column, titles cut beside a gap, an In review row under NEEDS YOU. | Table with headers; Tabs for the view switch. | #208 |
| F34 | Empty states, `s22-empty-project-1440x900-light`, `s23-milestone-without-epics-1440x900-light`, `s24` | Four styles; "+ Story" filled on a project with no Milestone. | Empty everywhere; "+ Milestone" leads on an empty project. | #198, #201, #202, #203 |
| F35 | Cancel buttons, `s32-launch-sheet-1440x900-light`, `59-epic-confirm-exit-test-dialog-1440x900-light`, `19`, `s28`, `s25` | "Cancel" ghost, "Not yet", "Keep running", "Leave them running", "Back", in different variants. | AlertDialogCancel (outline, left) always; verbs may vary. | #198, then each area |
| F36 | In-row actions, `s14`, `s07`, `01` | "Open session" at about 32 px in rows, 22 px in the queue. | One `size="sm"`. | #208, #204 |
| F37 | Rail, `s01-stress-board-900x600-light`, `17-board-min-width-900x600-light` | A fixed 248 px rail takes 27% of a 900 px window; names truncate even at 1920. | Sidebar `collapsible="icon"` with ⌘B; Tooltips. | #200 |
| F38 | Story view, `s06-stress-story-view-1920x1200-light` | Capped and centred while every other surface runs full width; DESIGN.md still promises the roster beside it at 1280+. | One max width per surface type; Resizable split or correct DESIGN.md. | #204 |
| F39 | Roster rows, `01`, `s02`, `83-board-roster-rows-1440x900-light` | "criteria 0/0 · tasks 0/0" on every done row. | Meta only when it says something. | #202 |
| F40 | Criteria and Tasks, `03-story-tasks-1440x900-light`, `s06` | Change and Remove on every criterion; five controls on a Task row. | Reveal on hover and `focus-within`, or a ⋯ Dropdown Menu; the drop reason in a Popover. | #204 |
| F41 | Tinted rows, `01`, `83`, `113` | In review and Stopped rows take the yellow tint that means Waiting on you. | Tint only Waiting-on-you rows. | #202 |
| F42 | Feed rows, `s08`, `s10-stress-feed-failed-call-1440x900-light` | "API Error: 529…" outside the row grid; a failed call's "failed" neutral and its error block untinted. | A notice row in the grid; the destructive StateBadge and edge. | #205 |
| F43 | Feed status bar, `09`, `10`, `11` | "Answer the request above" repeats the card with a void between. | Size the card to its content. | #205 |
| F44 | Sessions list, `s07-stress-story-sessions-1440x900-light` | Lowercase enum end reasons, a crash not red, "Stub summary". | StateBadge per end state, Item rows, renamed heading. | #204 |
| F45 | Triage drawer, `s15-stress-triage-drawer-1440x900-light` | "amend story" beside "New Story". | One map of kind words. | #203 |
| F46 | Story columns, `50-epic-shaping-story-columns-1440x900-light` | The fourth card overruns the content edge; "5 runs after 4 ·" cut. | A horizontal Scroll Area with edge padding. | #211 |
| F47 | Boot | A blank floor until the project list resolves (`App.tsx`). | The shell with Sidebar and board Skeletons. | #210 |
| F48 | Every list while loading | Only the Milestone header uses Skeleton. | Skeleton rows sized like the real ones. | #198, then each area |
| F49 | The shadcn/ui inventory (below) | Card, Collapsible, Popover, Scroll Area and Separator installed and unused; 32 raw `<button>`s, 21 raw `<label>`s, raw radio and checkbox inputs where direction.md names Radio Group and Checkbox. | Apply per area; delete the legacy stylesheets last. | each area, #212 |
| F50 | Dark Needs-you, roster and fleet rows (detector) | Dark `--subtle-foreground` on `--attention-muted` is 3.7:1. | A dark pair that clears 4.5:1. | #196 (noted there) |
| F52 | Reduced motion (`styles/globals.css`) | `prefers-reduced-motion` zeroes every transition and animation, colour included. | Remove movement, keep short opacity and colour cross-fades. | #198 |

### P3

| ID | Screen and shot | Problem | Fix | Story |
|---|---|---|---|---|
| F51 | Milestone header (detector: nested cards) | Stat tiles drawn as bordered boxes inside the header card. | Intended (the count boxes are the bar's legend); no change. | none |
| F53 | Buttons and headings across the legacy screens | Title Case drift: "Start Work", "Kill All", "Register Project", "Credential Path". | Sentence case. | each area, #212 |
| F54 | Waiting-on-you queue, `s14-stress-waiting-queue-1440x900-light`; launch sheet `s32` | "Keys A and D answer this one" as text; ⌘↩ with no hint. | Kbd; a shortcut sheet behind "?". | #206, #208, #210 |
| F55 | Story view, `s06` | The over-limit Context packet is only bold ink. | An icon and a Tooltip on the soft limit. | #204 |
| F56 | Move to Epic, `118-story-move-to-epic-1440x900-light` | No current marker, no search. | Combobox with a check on the current Epic. | #204 |
| F57 | Feed, `s12-stress-feed-raw-1440x900-light` | "View raw" / "View structured" is one label-swapping button. | Toggle Group (Structured, Raw). | #205 |
| F58 | Lamps and rail rows | Details in `title=` instead of Tooltip (about 87 sites). | Tooltip. | #199, #200, each area |

## Motion, loading and feedback

The owner's "raw" is measurable in the source. Motion: only shadcn's Dialog, Sheet, Popover, Dropdown Menu and Tooltip animate (tw-animate-css, 160 ms on `--ease`); the three hand-rolled modals (Orphan recovery, the Worktrees confirm, the launch sheet) and every disclosure open and close in one frame; list inserts and removes pop; the lamp's "lighting" is a colour transition; under reduced motion everything, colour included, is zeroed. Loading: one Skeleton (the Milestone header), a blank floor at boot, a 7 s skeleton on a dead read, label-swap pending states. Feedback: no toast system at all; three ad-hoc timed notices (`App.tsx`, the rail's two) and an outcome announced only to screen readers (Confirm exit test).

The motion thesis #198 carries: the lamp lighting is the one authored moment (240 ms colour plus a short bulb-glow rise, the row and card tint landing in the same frame); everything else is feedback (a toast after each write, a Spinner in the pressed button) and continuity (Collapsible height, an answered card collapsing out, shared overlay motion), on #196's `ease-out-quint`, with a reduced-motion path that removes movement but keeps meaning.

## shadcn/ui inventory

A separate read of all 56 non-test `.tsx` files outside `components/ui/`.

**Installed and unused:** Card (about 30 hand-rolled `rounded-lg border bg-card shadow-card` containers: Milestone header, Epic card, Needs-you card, Story panels, request frames, Fleet bands, dialogs' panels), Collapsible (Task note, feed rows, review diffs, Since you last looked, older sessions, earlier Rounds), Popover (the Always-allow pattern editor, the Task drop reason, the Round-dismiss confirm, the pickers), Scroll Area (the roster and Story scroller in `PageHeader.tsx`, the feed, the raw log; the viewport ref must be forwarded for the virtualisers), Separator, and Input Group (only inside Command).

**Installed and bypassed:** 32 raw `<button>` elements in 18 files (AndonStrip 4, FeedRow 3, OrphanRecoveryModal 3, WorktreeInventory 3, FirstRun 3, SettingsSurface 2, BlockedQueue 2, RoadmapStrip 2, one each in ten more); 21 raw `<label>`s; raw `<input>` in Settings and First run; raw radio and checkbox inputs in `QuestionForm.tsx`; a raw checkbox in Worktrees; hand-made skeletons in Settings; AlertDialog bypassed by the Worktrees confirm, Orphan recovery, the rail's Remove confirm and the feed's Stop and Discard; Dialog bypassed by the launch sheet; `SidebarMenuSubButton` bypassed by the rail's Story rows; Badge bypassed by Worktrees' chips, three NumberChip copies and the Proposed and Rejected labels; Tooltip bypassed by about 87 `title=`; Kbd bypassed by the queue's hint.

**Hand-rolled where a catalogue component fits:** Tabs (the All agents / Waiting on you switch), Toggle Group (Settings' segmented control, View raw), Table (permission rules, Worktrees, All agents), Select or Combobox (Write a Story's native selects, Settings' per-project mode), Switch (notifications), Alert (about 15 callouts and the missing-`claude` banner), Sonner (three timed notices), Empty (about ten empty cards), Field (Write a Story re-implements Field locally; Settings, First run, the review composer, every amend form), Button Group (Accept / Amend / Reject five times, Allow / Deny), Item (sidebar sessions, Needs-you headers, Fleet rows, Since you last looked, Orphan rows), Spinner, Progress (the dock's "n of m answered"), Hover Card (ADR and glossary chips, Story-key references, clamped descriptions).

**Marginal:** Resizable (only if the roster-beside-Story split is built), Context Menu (right-click on rows and lamps, after the Dropdown Menu), Accordion (Collapsible is enough). **Not earned:** Calendar, Date Picker, Input OTP, Slider, Carousel, Drawer, Menubar, Navigation Menu, Chart (the stacked bar is cheaper by hand), Data Table, Form, Pagination (feeds scroll), Toast (Sonner supersedes it), Typography.

Legacy styling still in use: `.control-edge` (App.css) in 16 places, `admin-*` (styles/admin-surfaces.css) across Settings and Worktrees, `state-*` and `confirm-*` (styles/states-and-confirms.css) in First run, Unreachable, Orphan recovery and Worktrees, the `type-label` / `type-body` / `type-heading` classes, and inline `style={{}}` layouts. #212 deletes them once their screens have moved.

## Persona red flags

- **Cyril, supervising five agents across three projects.** He can't trust a number (16, 14, 17); in HKW-2's feed the rail says he is in flywheel; on the presales board what needs him is below the fold; down the queue Allow and Deny change sides on a force-push; after Merge nothing says it worked; a usage-limited session leaves no Resume where he is looking.
- **A keyboard power user.** ⌘K crashed the app (fixed by #197); A and D aren't shown; no ⌘B for the rail; 18 Proposals and 22 worktrees one at a time; Discard is one unconfirmed click from Stop.
- **A stress tester.** Long keys wrap; a long Check breaks the Merge dialog; absolute paths hide the file; a dead read shows a skeleton then "No Tasks yet"; a raw epoch in the feed; Settings clips mid-row; the missing-`claude` banner covers the lamps.

## Covered elsewhere

- The font face, palette values and the mark's colour: #196. The dark contrast pair F50 is noted there.
- Refetch flicker: #195. The stills show none, since each capture settles first.
- The feed's rows drawn twice (#190) and the rail stopping short (#191): fixed before this run; the layout-defect check now guards both classes in CI.

## Stories filed

All under Epic #189, labelled `story` and `ready-for-agent`, milestone M5 One-week exit test, with native blocking edges. Each owns a disjoint set of files and names the others it must not overlap with.

| Story | Area | Starts after | Findings |
|---|---|---|---|
| #197 ⌘K and the Search button open the command palette instead of crashing the app (merged, #216) | `components/ui/command.tsx`, `CommandPalette.tsx` | nothing | F1 |
| #198 One motion, feedback and loading foundation | `DESIGN.md`, `globals.css` motion, `components/ui/*`, shared components, `format.ts`, `queryClient.ts`, the Toaster | #196 | F8–F11, F18, F25, F31, F32, F34, F35, F48, F52 |
| #199 The top bar fits every window, and the strip counts agents one way | `shell/PageHeader.tsx`, `shell/AndonStrip.tsx` | #198, #196 | F13, F24, F25, F58 |
| #200 The project rail shows where you are, collapses, and keeps Remove behind a menu | `projects/ProjectRail.tsx` | #198, #196 | F7, F13, F14, F19, F37 |
| #201 A big project's board opens on what needs you; Write a Story picks with Comboboxes | board header files, `WriteStoryDialog.tsx` | #198, #196 | F16, F23, F28, F34 |
| #202 The roster reads at a glance | `board/StoryBoard.tsx`, `EpicProgress.tsx` | #198, #196 | F9, F15, F26, F29, F39, F41 |
| #203 Needs you and the triage drawer | `board/NeedsYou.tsx`, `proposals/*` | #198, #196 | F9, F10, F25, F45 |
| #204 The Story view | `StoryView.tsx`, `StoryControls.tsx`, Tasks, criteria | #198, #196 | F9, F10, F18, F24, F27, F38, F40, F44, F55, F56 |
| #205 The session feed | `session/*` except the request cards | #198, #196 | F17, F18, F21, F30, F42, F43, F57 |
| #206 Deny and Allow in the same place; Radio Group and Checkbox in the question card | `PermissionRequestCard.tsx`, `QuestionForm.tsx` | #198, #196 | F20, F54 |
| #207 The review card keeps Merge in reach and says it landed | `review/*` | #198, #196 | F10, F11, F12, F22 |
| #208 All agents and Worktrees are Tables | `fleet/*` | #198, #196 | F3, F13, F32, F33, F36 |
| #209 Settings on Card, Field, Radio Group, Table, Select and Switch | `settings/*` | #198, #196 | F2 |
| #210 First run, Register project, unreachable, orphans, the launch sheet and a missing claude | those files and `App.tsx` | #198, #196 | F4–F7, F47 |
| #211 Shaping views share one Accept, Amend and Reject group | `shaping/*`, `RoadmapRound.tsx`, the shaping controls | #198, #196 | F27, F46 |
| #212 The legacy stylesheets are gone and a final critique finds no P0 or P1 | the legacy CSS, this report | every Story above | F49, F53, the Epic's exit test |

#197 is merged and #196 is merged. Once #198 lands, #199 to #211 run in parallel. #212 closes the Epic.

Questions skipped: this run was delegated with the owner's product decisions (recorded in this session's instructions), so the findings were filed as Stories instead of asked.
