---
name: Flywheel (by HighKnow)
description: "Mission Control: a near-neutral, hairline, no-fill board that reads like a roster of epics, authored once for light and for dark."
colors:
  ground-light: "#ffffff"
  ground-dark: "#0a0a0a"
  surface-light: "#f6f8fa"
  surface-dark: "#0f0f0f"
  rule-light: "#d1d9e0"
  rule-dark: "#2c2c2c"
  control-edge-light: "#7a828c"
  control-edge-dark: "#707070"
  ink-light: "#1f2328"
  ink-dark: "#ededed"
  muted-light: "#59636e"
  muted-dark: "#8b8b8b"
  placeholder-light: "#68727d"
  placeholder-dark: "#7c7c7c"
  brand-fill: "#3c64dd"
  brand-text-light: "#3c64dd"
  brand-text-dark: "#5175e1"
  done-light: "#1a7f37"
  done-dark: "#3fb950"
  failed-light: "#cf222e"
  failed-dark: "#f85149"
  blocked-light: "#9a6700"
  blocked-dark: "#d29922"
  row-hover-light: "#fafbfc"
  row-hover-dark: "#0c0c0c"
  row-selected-light: "#f5f7f9"
  row-selected-dark: "#101010"
  row-selected-unfocused-light: "#f9fafc"
  row-selected-unfocused-dark: "#0e0e0e"
  selection-rule-light: "#1f2328"
  selection-rule-dark: "#ededed"
  selection-rule-unfocused-light: "#7a828c"
  selection-rule-unfocused-dark: "#707070"
typography:
  micro:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.2
  label:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  heading:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.25
rounded:
  row: "0px"
  mark: "3px"
  chrome: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
  3xl: "64px"
components:
  row-epic:
    height: "64px"
    rounded: "{rounded.row}"
  row-challenge:
    height: "48px"
    rounded: "{rounded.row}"
  row-task:
    height: "32px"
    rounded: "{rounded.row}"
  row-band-header:
    height: "28px"
    rounded: "{rounded.row}"
  progress-fill:
    backgroundColor: "{colors.brand-fill}"
    rounded: "{rounded.mark}"
  button-control:
    backgroundColor: "transparent"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.chrome}"
---

# Design System: Flywheel (by HighKnow)

> **Provenance.** Written once, at the end of Phase 8.1, from the shipped code (`styles/tokens.css`,
> `styles/motion.css`, `styles/type.css`, `App.css`, the group stylesheets and the components) and the
> closure sections of the twenty-one Phase 8.1 plans, not from the plan. Where the contract
> (`.planning/phases/08.1-*/08.1-UI-SPEC.md`) and the build disagree, the build is the subject and the
> disagreement is listed under "Contract versus the built world" below. The frontmatter is normative for
> every value; prose names a role and does not restate a hex. Light and dark are separate keys because
> the product authors a value per mode (a token declared identically in both modes fails
> `theme/__tests__/contrast.test.ts` unless the sameness is the design). The tokens are CSS custom
> properties in `styles/tokens.css` and are mirrored as typed constants in `theme/tokens.ts`; if this file
> and `contrast.test.ts` ever disagree, the test wins.
>
> **Written by the executor, not by the shipped `impeccable-documenter` agent.** Plan 20 asked for the
> agent. The executor that wrote this has no subagent tool, so it followed the agent's own spec
> (`reference/document.md`, scan mode) by hand. No `.impeccable/design.json` sidecar was produced.
>
> **The old world is kept below, marked superseded.** Everything under "History" describes the Flight
> Progress Strips world (cream strip stock on a dark navy rack). It was replaced in Phase 8.1 and is not
> a source of colour, material, radius or motion for any new surface.

## Overview

**Creative North Star: "Mission Control"**

Flywheel is a board a developer reads the way a controller reads a roster: one row per epic, each row
saying how far along it is, what is running on it and what is waiting on the owner, with the tasks one
disclosure beneath. The surface is near-neutral and hairline. There are no fills, no tinted rows, no
status pills with backgrounds and no cards. Type and spacing carry hierarchy; colour is a data channel
and nothing else. It is authored for light and for dark from one token set, so dark is not a recolour of
light. The direction was adopted wholesale by the owner on 2026-10-07 after he viewed six code-rendered
comps (see "Contract versus the built world" for what that adoption did and did not cover).

The mood is calm and dense. The home surface is an epic roster; tasks sit at 32px and the whole product
runs at that density. Meaning never rests on colour alone: every status keeps a shape glyph and a printed
word, the progress bar prints its fraction, and each distribution segment carries its label.

**Key Characteristics:**

- Dual-mode from one token set: the light values are the root block, the dark values are a
  `prefers-color-scheme: dark` block that re-declares every mirrored name. `tauri.conf.json` forces no
  window theme, so the mode should follow the operating system; that the shell's web view actually
  reports the OS appearance has never been observed (it is queued as D-REV-22).
- One surface family. The five paper tints of the old world survive only as aliases of the ground.
- Rules are hairlines (`rule`); a control's visible edge is its own role (`control-edge`), never the
  hairline.
- Colour appears as a data channel only: progress (the brand), done, blocked, failed, and the
  commits-ahead count.
- Actions are drawn with an edge on their own surface. There are no filled buttons anywhere.
- Rows are square, marks are 3px, chrome is 6px.
- Motion is four named, owner-confirmed CSS motions and nothing else; reduced motion collapses all of
  them to an instant state change.

## Colors

A near-neutral palette with one brand blue that is spent on progress and almost nothing else. Contrast is
asserted per mode, per role, in `theme/__tests__/contrast.test.ts` and painted in WebKit in both schemes
(`legibility.browser.test.tsx`); the measured floors are 4.5:1 for text roles and 3:1 for non-text roles.

### Primary

- **Progress Blue** (`brand-fill`, `#3c64dd`, the same in both modes): the progress fill on every epic row.
  It repeats down the page as a rhythm, which is why it reads as identity. As a fill or an edge it is 3:1
  or better in both modes (3.71 on the worst dark surface).
- **Brand Text** (`brand-text-light` / `brand-text-dark`): the brand as text. Light needs no lift (4.86 on
  the surface). Dark is lifted to `#5175e1`, found by search (hue 225, saturation held at 70.3%, lightness
  stepped from 55% until 4.5 was cleared on the worst dark surface, 4.55). It colours the commits-ahead
  count and the keyboard focus ring (`focus-ring` is the same value per mode).

### Neutral

- **Ground** (`ground-*`): the window. **Surface** (`surface-*`): panels and the rail, a cool step off the
  ground.
- **Ink** (`ink-*`): primary text, and the 2px selection rule when the list has focus. **Muted** (`muted-*`):
  secondary text (5.6 to 5.7 on the surfaces). **Placeholder** (`placeholder-*`): a field's placeholder, a
  step below muted and 4.56 worst case in both modes. It exists because the engine's own placeholder was an
  unowned grey (2.3 on white in light, about 8.5 in dark).
- **Rule** (`rule-*`): the hairline between rows and regions, 1.34 to 1.43 in both modes. Deliberately under
  3:1: it is decorative and separates regions only.
- **Control Edge** (`control-edge-*`): the visible boundary of an input, picker, chip or button, 3.65 to 4.0.
  `popover`, `dialog` and `sheet` edges are three further roles; in light all three equal the control edge,
  in dark each tier is a step lighter (`#7a7a7a`, `#909090`, `#a6a6a6`).
- **Row states** (`row-hover-*`, `row-selected-*`, `row-selected-unfocused-*`, and `row-surface`, which is
  transparent): washes of 1.03 to 1.074 against the ground. They are at the ceiling AA allows, because every
  text role must stay 4.5:1 on them (see the Selection Rule below).

### Data channels

- **Done** (`done-*`), **Failed** (`failed-*`), **Blocked** (`blocked-*`): the only status colours. Each
  is AA text on both surfaces and on all three opaque row surfaces in both modes.
- `destructive-strip`, `blocked-text-strip`, `text-primary-strip` and the other `strip` names are aliases
  of the `rack` roles. The suffixes are semantic debt, not a second material. `destructive-strip` is still
  consumed as a text and edge colour by `App.tsx`, `BoardRow.tsx`, `CommandPalette.tsx` and
  `WorktreeRemovalDialog.tsx`; do not delete the alias.

### Named Rules

**The Progress-Not-Position Rule.** The brand carries progress. The current position (a selected row, the
current project in the rail, the highlighted command in the palette) is marked neutrally, with a surface
shift and, on a task row, a 2px ink rule. It is never the brand. This replaces the old world's "the brand
marks exactly one thing, the current position".

**The Edge-Not-Fill Rule.** An action is drawn with a 3:1 edge on its own surface. Ink on the brand fill was
3.05 (light) and 4.42 (dark), under the text floor, and the owner decided on 2026-10-08 that Flywheel has no
brand-filled primary buttons. The one leading action in a region takes a 2px ink edge (`selection-rule`) with
the pixel given back by padding; every other action is a 1px control edge.

**The Selection Rule.** A selected task row has a 2px left border. Focused: full ink. List not focused: the
lighter `selection-rule-unfocused` (4.06 / 4.23 apart from the focused rule), and the surface wash drops to
the idle surface, so focus reads twice (rule tone, and wash present or absent). Every task row reserves a
2px transparent left border so a row changing state never reflows. The two rule roles are separate names
from `ink` and `control-edge` on purpose: a later change to control borders must not move selection. The
selected wash is the strongest AA allows (1.074 light, 1.040 dark); the finish reviewer asked for 1.12 and
1.08, which are not reachable without darkening the blocked text or lifting the dark brand text past its
minimum step, and `contrast.test.ts` asserts that claim.

**The Placeholder Rule.** A field's placeholder takes `placeholder-*`, never the engine default.

## Typography

**Font:** Archivo Variable (OFL, self-hosted under `public/fonts/`, one variable file, `wght` 100 to 900,
`wdth` 62 to 125), with `sans-serif` as the fallback. **Mono:** the system `ui-monospace` stack, only for git
shas, paths, diff code, branch names and the run's session line.

**Character:** a plain, slightly condensed grotesque used at small sizes, two weights only. There is no
display role: this is a product surface.

### Hierarchy

- **Heading** (600, 15px, 1.25): panel and region titles, and the current-selection emphasis.
- **Body** (400, 13px, 1.4): row titles, field text, prose.
- **Label** (400, 11px, 1.3): counts, pills, badges, captions, key sub-labels.
- **Micro** (400, 10px, 1.2): the feed's "retrying request" system notice and the assignee picker. The
  detector reports `tiny-text` on it, and the 08.1 scale otherwise starts at 11. See "Not canonized".

Two further steps ship and are **not** in `type.css`, which carries only the four roles above. They were
missing from this document's first draft, which claimed to be written from the built world and was not
complete; the design hook caught the omission. Both are deliberate roles, not drift:

- **State heading** (600, 20px, 1.2, `.state-heading` in `styles/states-and-confirms.css`): the
  full-page hero heading on first-run and on the unreachable-project surface. It is a distinct role
  from **Heading**, which titles a panel inside a populated window — first-run is the first thing a new
  user ever sees and owns its whole viewport, so it is not a 15px panel title.
- **Diff code** (12px, `.review-diff` root in `review/review.css`): the monospace size for patch
  content. Code is set a step below body prose so a 1440px review column holds a realistic line without
  wrapping — and the review surface explicitly does not wrap code, it scrolls sideways.

The full shipped scale is therefore **10 / 11 / 12 / 13 / 15 / 20px**. Anything outside it is drift.
- **Condensed cut** (`font-stretch: 75%`, the same file): the stamped key and band headers.
- **Tabular figures** (`tnum`, `lnum`, verified present in the shipped font): every numeric and columnar
  field.

### Named Rules

**The Two-Weights Rule.** Regular and Semibold, nothing else. Emphasis is the Semibold, a surface shift or a
rule, never a third weight or a colour.

## Layout

A fixed shell: the project rail on the leading edge, the rack in the middle, the item-detail panel as a peer
surface on the trailing edge. macOS desktop only; the minimum supported window is 900px wide.

The rack is one virtualized list with four row kinds at four fixed heights (epic header 64px, challenge
48px, task 32px, band header 28px). The virtualizer's `estimateSize` is an O(1) lookup on row kind
(`ROW_HEIGHT_BY_KIND`); there is no `measureElement` and no per-row measurement. Rows are keyed by item
identity, not by index, so they keep their DOM node across a collapse. The board has one query, one
keyboard map and one rack; "Group by Epic / Status" is a lens over it, not a second surface. The status
lens keeps the "everything in review across all epics" sweep.

Spacing is a 4px scale from `xs` (4px) to `3xl` (64px). Rows declare a container query type, so the
progressive-disclosure ladder responds to the row's own width (which narrows when the detail panel opens):
actor-of-last-change drops first, then the epic pill, the assignee, and the estimate last. The status glyph,
key, title, priority glyph and criteria fraction are never dropped at any supported width.

## Elevation & Depth

Flat at rest. Depth is told by edge and wash, not by elevation: rows have no shadow, no card and no fill.
Only overlays lift, in three tiers by kind.

### Shadow Vocabulary

- **Popover** (`0 8px 24px`, 16% ink in light, 60% black in dark): anchored to a trigger, dismissed by an
  outside click, no scrim. The five pickers and the Done warning.
- **Dialog** (`0 12px 32px`, 20% / 65%): a centred modal that asks for a decision, with the scrim. Delete
  confirm, worktree removal, orphan recovery, the legend.
- **Sheet** (`0 16px 48px`, 24% / 70%): a large modal workspace, with the scrim. The command palette, the
  merge and epic-request sheets, the launch sheet.

### Named Rules

**The Edge-Tells-The-Tier Rule.** A shadow over a near-black ground is invisible, so in dark the three tiers
are told by the lightness of their own edge role. The dark scrim is 40%, not 60%, so a modal still shows
the board it sits over.

**The Inside-The-Content-Box Rule.** A highlighted or chosen row's 2px rule sits inside the overlay's content
box (the overlay pads its list by one 8px gutter), never on the overlay's own border where it would read as a
thickened edge. The palette's always-on search ring is the ink rule, inset 8px, not the brand.

**The No-Literal Rule.** No literal colour, scrim or shadow outside `styles/tokens.css` and `theme/tokens.ts`.
Checked on 2026-10-09: the only hex in non-test source outside those files is a comment.

## Shapes

Three shapes and no others. **Rows are square** (0): hairline-separated, no rounding. **Marks are 3px**
(`rounded.mark`): the progress track and fill, the task-distribution strip, small tags and inline boxes.
**Chrome is 6px** (`rounded.chrome`): buttons, inputs, pickers, chips, the palette, dialogs and sheets. The
focus ring follows the radius of whatever it wraps. Glyphs are `lucide-react`, outline-only at a uniform
stroke; no mark's meaning rests on fill, and the owner declined to loosen that rule (A-05).

## Components

### The epic roster row (home surface, 64px)

Title with a muted sub-label (key, status, integration branch; a missing branch prints `no integration
branch yet`), a progress bar with its printed fraction, a task-distribution strip, the agents-running count,
the proposals-waiting count and the rolled-up change cue. Every figure is the board-wide aggregate, never
derived from the rows that happen to be loaded. Progress is tasks done over total; an epic whose tasks carry
no criteria prints `no criteria yet`, never a `0%`. The distribution strip runs done, in review, in
progress, todo, backlog; done is the done role and the rest are neutral tonal mixes of ink, so there is no
second palette. The row takes the surface shift when selected, not the rule (the rule is a task-row mark);
when the list loses focus an epic row uses `row-selected-unfocused` because it has no rule to carry the
difference. The row is a selection target (click, `j`/`k`, Enter or `o` for detail, `r` to continue
shaping).

### The task row (32px)

Status glyph and printed word, key, title, then a tail: estimate badge (the letter alone, boxed, no icon),
criteria fraction (the fraction alone, never dropped, even at `0/0`), priority glyph, and the change cue.
The change cue is a `Triangle` plus the commits-ahead count in brand text, and a `Dot` for uncommitted
changes; a task with no worktree, zero ahead, or an unmeasurable base prints nothing. The assignee glyph
prints only for an assigned row. Pills trail the status glyph and never clip. Hover is an inset wash. The
keyboard ring is `:focus-visible` at a -4px offset, so a click selects without leaving a blue rectangle and a
keyboard focus shows both the ring and the ink rule.

### Challenge row (48px) and proposal rows

An agent's open challenge sits above the epic's tasks. Accept and Reject are drawn identically, a control
edge on the row surface, with no brand and no fill, because accepting is not the more important answer. The
proposal row in the authoring tray and the triage surface is the challenge row's twin.

### Buttons and the lead action

- **Control button:** transparent ground, 1px control edge, 6px radius, ink text. Hover moves the edge to ink
  as a plain static change. Disabled returns a lead to the plain 1px edge.
- **Lead action:** the one leading action in a region has the 2px ink edge. Examples: Start Work on a task,
  Continue Shaping on an epic, Watch Live in Runs, Merge in the review foot, Stop on a live run, Advance in an
  authoring run, Accept subtree on a triage row (so every triage row has exactly one lead).
- **Text action:** a caret and no box, for the lower-ranked answer (Deny on a routine permission card).
- **Destructive:** the destructive text role on a 2px edge with an icon, never a fill (Delete, Kill All,
  worktree Remove). `Bypass Permissions` in the launch sheet takes the same text role plus a one-line
  consequence printed when it is chosen.

### Inputs, chips and pickers

A 1px control edge, 6px radius, placeholder role for the empty state. The filter bar is one row at 1440px:
a lens, a 240px search, the dimension chips, and a single `Epic` button over the roster chips, collapsed by
default (the options stay mounted but `hidden`, so they leave the tab order while closed, and the button
reads `Epic · N` when epics are selected). The keyboard focus ring on an ordinary input is still the brand;
see "Not canonized".

### The project rail

Leading-edge navigation. The current project is marked neutrally (a surface shift against a rail whose
ground equals the unselected state, so the mark is deliberate), an unreachable project keeps its label on its
own line, and the fleet and review-queue rows are read-only facts, not links. Small section labels sit above
the groups; see "Not canonized".

### The item-detail panel

A peer surface that slides in from the trailing edge. Status, Priority and Estimate are label and value
rows at the top, and Worktree, Path and Changes are the same rows in their own sections; a row appears only
when it has a value. The status control is a value and a caret with no box. Consecutive identical activity
events fold into one row with a `×n` suffix, except `git.lock_exhausted`, which is never folded. The pencil
is revealed on hover, focus or the cursor row.

### The command palette

A sheet-tier overlay. It arrives at full opacity and settles 8px down by transform only. Sections
(Navigation, Project, Create, Selected item, Filter, Reference, Session) are headers in the list, not a
per-row eyebrow. The highlighted command takes the ink rule inside the 8px gutter.

### The review surface

A scope toggle, a criteria rail, a file list and the diff. Change in the diff is carried by the row tint and
the gutter only: there is no syntax colouring and the status palette is not repurposed as code decoration.
Code is `white-space: pre` and the pane scrolls sideways; a word-level edit is not marked with an underline
or a fill. The **review decision** group sits at the foot of the criteria column: Merge keeps the 2px ink
lead edge, and Request changes is a 1px hairline secondary beside it. Neither is filled, brand or
destructive, because a decline is reversible. There is no confirm sheet; the cost is printed first ("Request
changes sends N unchecked criteria back to the agent.") and is the button's accessible description. When the
merge is predicted to conflict the lead reads `Attempt merge`, and both conflict file lists are mono,
hairline-separated rows with no bullets. The foot's decline path is the product's core value as a daily act:
the reason is derived live from the unchecked criteria and reaches the agent as a `## Review Feedback`
section of its next briefing, which the launch sheet previews in the same words.

### The live session surface

A header with elapsed time (always) and in, out and cost figures only once they exist, so no placeholder
dash is ever printed. The feed's newest row sits on a floor, and every state ends on a bar ("Waiting on the
agent.", "Waiting on you: answer the permission request above.", "This run has ended. Nothing more will be
added to this transcript.", or the composer). The newest tool call with no result carries a block caret with
the `agent-pulse` animation while the run is live; under reduced motion the pulse class is omitted and the
caret is a plain mark. On the permission card Allow keeps the lead box, Deny is a text action with a caret,
and "Allow this tool for this project from now on" sits below a hairline gutter.

### Settings, triage, the authoring tray and the legend

Tables read as columns (the permission-rules table is at most 900px). Bulk checkboxes are drawn 14px squares
with the mark radius. The merge picker is 420px with its own filter field and a list that scrolls inside 240px.
The legend has one entry per printed label (two marks under one heading cannot share a label), a channel
index, sticky channel headings, swatches that draw the mark exactly as its row does, and meanings written in
plain words with no decision ids.

### Empty, broken and confirming states

First run draws its app-icon tile in ink (the brand is not spent on an identity tile). The unreachable
project's heading is the first element of the surface, with no red eyebrow. Orphan recovery's initial focus
is its heading, because the modal has no safe button; it offers `Leave them running` beside `Kill All`,
without weakening the rule that the modal cannot be dismissed without answering. The Done warning names the
task ("THRE-26 · 2 of 3 criteria unchecked. Mark Done anyway?") and opens anchored under its row.

## Do's and Don'ts

### Do:

- **Do** spend the brand on progress, the commits-ahead count and the focus ring, and mark position with
  ink (a surface shift and, on a task row, the 2px rule).
- **Do** draw every action with an edge on its own surface, and give each region exactly one 2px lead.
- **Do** take every colour, scrim and shadow from `tokens.css`; mirror a new role in `theme/tokens.ts` and
  author it for dark. A role that is the same in both blocks needs a reason on the test's named list.
- **Do** state an unknown in words (`no criteria yet`, `no integration branch yet`) and omit a figure that
  does not exist yet, rather than printing a zero or a dash.
- **Do** keep all motion in CSS so the blanket reduced-motion rule catches it.
- **Do** check a new text role at 4.5:1 on all three opaque row surfaces in both modes before using it on a row.

### Don't:

- **Don't** fill a button, tint a row, or put a background on a status pill.
- **Don't** use the brand for an action, for the current position, or for a state.
- **Don't** repaint the status palette as decoration (the diff's syntax colours were deleted for this).
- **Don't** fade or scale an overlay in. The palette, the scrim and every dialog are at full value on the
  first frame.
- **Don't** animate width or height, or measure a row. Rows declare a container query type and the rack
  never measures.
- **Don't** rely on the jsdom suite to prove a style exists: jsdom stubs stylesheets. `@keyframes agent-pulse`
  was deleted in plan 13 while three components kept applying the class, and every test stayed green for four
  plans. `motion.test.ts` now reads `motion.css`.
- **Don't** treat a green detector as clearing the 2px selection rule. `skill-ban-side-stripe-borders` is
  prose in the craft floor, not a `detect.mjs` antipattern, so the detector cannot speak to it.

## Motion

Four named motions, one easing (`cubic-bezier(0.16, 1, 0.3, 1)`), all CSS, all zeroed under
`prefers-reduced-motion: reduce`. The owner confirmed all four unchanged on 2026-10-08 after opening and
watching `comps/motion.html`, a page that inlines the shipped `motion.css` (so he watched the shipped
keyframes, not the packaged app).

| Motion | Duration | Technique |
|--------|----------|-----------|
| Detail panel slide-in | 220ms | `transform: translateX(100%)` to rest, never width |
| Group collapse and expand | 180ms | rows below travel by transform; new rows reveal as a staggered top-down `clip-path` wipe, each taking `180ms / n`; removed rows vanish immediately; no height is animated |
| Command palette open | 140ms | full opacity on frame one; `translateY(-8px)` to rest |
| Selection move | 120ms | the row's wash and the 2px rule's colour |

The easing is front-loaded, so each label overstates the felt time: 90% of travel is done at about 73, 59, 46
and 40ms. Two figures are the implementer's judgement, accepted by the owner: the palette's 8px settle and
reading "selection move" as the background wash. `--duration-settle` (180ms, the colour wash on a settling
control) is not one of the four, was not shown to the owner, and is still an unreviewed assertion.
`--duration-displace` was retired.

The one carve-out to "never a fade" is the running-session `Loader` pulse (opacity, 1.6s, infinite), which
signals that a process is alive and is not a state change. State-bearing surfaces (the orphan modal, the
missing-worktree banner, the Needs Decision pill, the destructive-gate and permission cards, the lock-retry
row) change as plain state changes; numerals update with no odometer; nothing animates on page load or hover.

## Not canonized

These are defects or knowing exceptions the build carries. They are recorded so they are not mistaken for
house style and inherited by the next surface.

- **A neutral 2px left border on a selected list item.** A knowing exception to the craft floor's
  coloured-side-border ban, decided by the owner on 2026-10-08 (A-06) on the reading that the ban targets
  accent colour, not neutral ink. It is a dated decision, not a precedent for any other list.
- **Small uppercase section labels in the rail.** The floor bans a kicker or eyebrow above a heading; these
  label groups of nav rows and the owner's reference adopted grouped navigation with small labels. A decided
  exception for the rail only.
- **A brand-coloured 2px left border on `.review-anchor-widget`** (`review/review.css`). This is not covered
  by A-06 (it is the brand, not ink) and is not one of the four permitted brand uses. It is a defect the
  build carries, found by this closing pass; it is not a pattern.
- **Brand text outside the four permitted uses:** the running status, the live authoring stage and the
  developer's own turn in the feed (an open owner question), and also links and text actions in the forge
  section, the activity trail, the triage lane, the epic-request sheet and the orphan modal.
- **The 10px `micro` role** for a feed system notice and the assignee picker.
- **The `rack` and `strip` token suffixes.** One material, two names.
- **The global input focus ring is still the brand** for inputs outside the groups finished so far
  (`QuickAdd`, the filter bar, the criteria composer, the title field).

## Contract versus the built world

Recorded so the next phase inherits a true document. Each item is also in `08.1-UI-SPEC.md`.

1. **Adoption covered the comps, not the build.** The owner adopted the direction on 2026-10-07 after
   viewing six code-rendered comps (not image-generated), with values labelled FIXTURE and three caveats on
   the table (the craft detector had not run; the roster's rhythm was untested because the seed data is
   uniform; the roster's lead row is a junk epic). He has not been recorded as viewing the built board.
2. **No masthead.** The comp's `Mission Control` heading and `threadfin . 13 epics . 906 tasks` subhead are
   not in the shipped source. The lens toggle and the summary line are, but the shell was never captured for
   the finish reviewer (every built capture is a harness page of the real components).
3. **A-04 is not realised as header narrowing.** Under the has-worktree chip the epic lens lists every roster
   epic with its unfiltered count, which is behaviourally the `always` reading the owner declined. The core
   SQL clause is correct; the epic lens does not consult it for headers.
4. **ROADMAP success criterion 3's wording differs from the contract.** It says the palette "fades/scales"
   in and that a group "animates its height". The contract decided the palette does not fade or scale, and
   the build animates no height (a wipe and row travel instead).
5. **Brand sites beyond the four** (see "Not canonized").
6. **The Done warning's copy** differs from `01-UI-SPEC.md`'s Copywriting Contract by instruction of the
   group-six reviewer.
7. **`packages/desktop/index.html` carried the old direction contract** (Flight Progress Strips) as its
   first body comment. It now opens with a supersession note.

---

# History: the Flight Progress Strips world (SUPERSEDED in Phase 8.1)

> **Superseded.** Everything below was written against the Flight Progress Strips world and is preserved
> as the record of why that world lost (D-20): a hardcoded material split (a cream strip plane on a dark
> navy rack, five paper tints) that structurally cannot do light and dark, and that the owner called, on
> 2026-09-10, "a very old app". It is not a source for any new surface.
>
> | Below | Status |
> |-------|--------|
> | Direction, Token roles, Type's Motion paragraph, Motion, radius `--radius-strip` | **Void.** Replaced by the sections above. Every hex, ratio and the 2px strip radius are void. |
> | The rack/strip material split, the five strip tints, `--accent-text-strip #2d4fb8`, `--destructive-strip #9c351c` as a value | **Void.** `destructive-strip` survives as a name only. |
> | "The brand marks exactly one thing: the current position" | **Void.** Replaced by The Progress-Not-Position Rule. |
> | Marks registry and Legend | **Partly true.** The registry exists and resolves every glyph against `lucide-react`; the glyph assignments changed (A-05) and the legend was rewritten in plan 18. |
> | Per-plan sections (Phases 1 to 3): behaviour, data and keyboard statements | **Mostly still true as behaviour,** void as appearance. Check the code, not this log. |
> | Review-against-contract narratives | **History.** They were reviewed against the superseded contract. |


# DESIGN.md — Phase 1

**Status:** The Flight Progress Strips visual world is authored (`01-02`) and every surface named
in the original phase scope is now built: the rack (`01-03`), the hierarchy and detail panel
(`01-04`), pickers (`01-07`), search/filter (`01-08`), the command palette and keyboard model
(`01-09`), the activity trail (`01-10`), and — closing the phase's UI surface — the project
switcher (rail, registration flow, unreachable state) in `01-11`, below.

## Direction

**Flight Progress Strips** (Impeccable direction round, seed `59b0beb9`, chosen by the owner
2026-09-09 over the assigned roll). Visual authority: air-traffic control flight progress strips —
one annotated strip per aircraft, racked in sequence. The board is a controller's rack, not a
document. The direction contract (THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM, closed with
`FINISH:`) is authored as the first child of the document body in `packages/desktop/index.html`.

The rack/strip material split: the rack is the app's dark chrome (window ground, rail, band
headers, panel frame); the strip is the one light content plane, tinted per workflow state. No
texture is authored — no paper grain, no bevels, no drop shadows imitating physical strips (the
"Honest risk" this direction names and explicitly refuses).

## Locked decisions this plan closes (owner, 2026-09-09)

Plan `01-02` Task 1's decision checkpoint closed the four remaining open items inside the chosen
visual world. All four are recorded in `01-UI-SPEC.md` and are binding for plans `01-03`–`01-11`:

1. **Component strategy:** `a-selfhost-radix` — self-hosted type plus hand-rolled, unstyled Radix
   primitives. `shadcn` is deliberately NOT initialized (`shadcn_initialized: false` in
   `01-UI-SPEC.md` frontmatter is a decision, not a deferral). No preset exists to fight the
   two-material palette; Radix supplies the accessibility machinery (focus trapping, dismissable
   layers, roving tabindex) the spec mandates for the command palette and every picker.
   **Consequence:** pickers, the palette overlay and focus trapping are hand-wired in plans `01-04`
   and `01-09`, not generated.
2. **Typeface:** Archivo (OFL, Omnibus-Type) — see "Type" below.
3. **Icon library:** Lucide (`lucide-react` 1.43.0, ISC). Uniform 2px stroke, round joins,
   outline-only.
4. **Radius language:** `--radius-strip: 2px` (strip stock — near-square printed stock),
   `--radius-chrome: 6px` (interactive chrome — buttons, pickers, the command palette). The focus
   ring follows the radius of whatever shape it wraps.

## Token roles

One source of truth: `packages/desktop/src/styles/tokens.css` (CSS custom properties consumed by
every component) mirrored as typed constants in `packages/desktop/src/theme/tokens.ts` (`RACK`,
`STRIP`, `INK`, `MOTION` — consumed by the contrast test so the test asserts against shipped
values, not copied literals).

- **Rack** (dark chrome): `--surface-dominant #171b22`, `--surface-secondary #1e232b`,
  `--divider #2c333e`, `--text-primary-rack #eef1f6`, `--text-muted-rack #9aa4b5`,
  `--accent-text-rack #7d99ff`, `--accent-nontext #3c64dd`.
- **Strip stock** (five workflow-state tints): `--strip-backlog #e6e1d6`, `--strip-todo #dfe4ea`,
  `--strip-in-progress #efe6c8`, `--strip-in-review #e6ddec`, `--strip-done #dde9dc`.
- **Ink on strip:** `--text-primary-strip #1e232b`, `--text-muted-strip #4a5261`,
  `--accent-text-strip #2d4fb8`, `--focus-ring #3c64dd`, `--destructive-strip #9c351c`.
- **Row states** (overlays layered on top of a row's own strip tint, not replacements for it):
  `--row-surface` (transparent — rest state shows the tint unmodified), `--row-surface-hover`
  (faint accent tint), `--row-surface-selected` (stronger accent tint), and
  `--row-surface-selected-unfocused` (a muted ink tint, so a selected-but-blurred row never reads
  identically to a focused-and-selected one). These four are asserted pairwise distinct by
  `legend/__tests__/legend.test.tsx`.
- **Radius:** `--radius-strip: 2px`, `--radius-chrome: 6px`.
- **Spacing:** `--space-xs` (4px) through `--space-3xl` (64px), per `01-UI-SPEC.md`'s locked scale.

No component outside `styles/tokens.css` and `theme/tokens.ts` declares a literal hex colour —
verified by a grep gate in the plan's `<verify>` block, and re-checked at every subsequent plan.

## Type

**Archivo** (OFL, Omnibus-Type) — self-hosted under `packages/desktop/public/fonts/`, no CDN
request. A single variable font (`wght` 100–900, `wdth` 62–125) supplies both cuts the direction
calls for:

- The workhorse grotesque, at the `wdth` axis default (100%).
- The condensed companion cut for the stamped key and band headers, at `font-stretch: 75%` — the
  **same** file, not a second one. Google Fonts merged Archivo's condensed/expanded static
  families into this variable font's `wdth` axis after `01-UI-SPEC.md`'s typeface constraint was
  written; there is no longer a separately-published "Archivo Condensed" package. This was
  recorded as a locked decision (see `01-UI-SPEC.md` § Type), not invented silently.

**Tabular figures verified, not assumed:** before locking the typeface, the shipped font file was
inspected directly with `fontTools` for the `GSUB` feature list. Both `tnum` (tabular figure
widths) and `lnum` (lining figure shapes) are present. `styles/type.css`'s `.tabular-nums` utility
wires `font-variant-numeric: tabular-nums` plus `font-feature-settings: "tnum" 1, "lnum" 1`, ready
for the key column and every numeric/count field landing from `01-03` onward. See
`packages/desktop/public/fonts/README.md` for the full inspection transcript and licence/source
record.

Locked scale (unchanged from `01-UI-SPEC.md`, exactly two weights): Micro 10px/1.2/400, Label
11px/1.3/400, Body 13px/1.4/400, Heading 15px/1.25/600.

## Motion

One easing curve for the whole product: `--ease: cubic-bezier(0.16, 1, 0.3, 1)` (a decelerating
"settle" curve matching the direction's "mechanical settle, single-row displacement, never a
fade"). `--duration-settle: 180ms`, `--duration-displace: 220ms`. `prefers-reduced-motion: reduce`
collapses both to `0s` — the state change still happens, only the displacement is removed.

## Marks registry and Legend

`packages/desktop/src/legend/marks.ts` exports `MARKS`, the single registry of every mark the UI
may render (donation carried forward from the declined Orienteering Map direction: no mark may
exist that the legend does not define). This plan seeds it with the four row-state marks and the
focus ring; later plans append their own entries as they introduce status/priority/actor glyphs.

Each mark's `glyph` names a `lucide-react` icon (not a unicode/emoji stand-in — matching the locked
icon-library decision and Impeccable's craft-floor ban on icon stand-ins). `legend/Legend.tsx`
resolves the name to the real icon component and renders `MARKS` grouped by channel; it derives the
surface from the registry rather than restating it.

**Chosen icons:** `Square` (idle row), `SquareDashed` (hovered row), `SquareDot` (selected row),
`SquareMinus` (selected, unfocused row), `Focus` (focus ring).

## What exists today

- The direction contract, authored in `packages/desktop/index.html` as the first child of `<body>`.
- `packages/desktop/src/App.tsx` imports the theme once (`styles/tokens.css`, `styles/type.css`,
  `styles/motion.css`) and renders the rack ground (`--surface-dominant` filling the window) — see
  `.impeccable/review/01-02-rack-ground.png`, captured from a real `tauri dev` launch.
- The Legend surface exists and renders correctly (verified via a temporary mount during this
  plan's review pass, then removed — Legend is not wired into the shipped app tree yet; the
  command palette wires it in starting `01-04`). See `.impeccable/review/01-02-legend.png`.
- The contrast test (`theme/__tests__/contrast.test.ts`) and legend test
  (`legend/__tests__/legend.test.tsx`) prove every ratio and distinctness obligation
  `01-UI-SPEC.md` records, following genuine RED→GREEN TDD discipline.

## Review against the direction contract

Reviewed against `01-UI-SPEC.md`'s own contract (Impeccable's craft-floor checklist) rather than by
spawning the shipped `impeccable-finish-reviewer` subagent: this execution environment has no
agent-spawning tool available to the executor, only direct tool calls (Bash, Read, Write, Edit,
Skill). The review was conducted directly against `craft-floor.md`'s Verify/Refuse lists instead,
using the two captured screenshots above and the accessibility tree from a live `tauri dev` launch
(via `orca computer get-app-state`).

**Findings and fixes made during this review:**

- The first legend implementation used raw unicode box-drawing glyphs (`□`, `◫`, `▣`, `▢`, `◎`) as
  mark icons. `craft-floor.md`'s Refuse list bans "Unicode glyphs or emoji standing in for an icon
  system," and the owner's own locked decision requires Lucide specifically. Fixed by installing
  `lucide-react@1.43.0` and rendering real icon components (see "Marks registry and Legend" above).
  This is documented as a deviation in `01-02-SUMMARY.md`.
- No gradient text, no kicker/eyebrow labels, no decorative shadows, no glass/blur decoration, no
  hard-offset shadows, no sparkline/progress-ring stand-ins, and no system-display-face styling are
  present — verified directly against the built surface.
- Contrast: verified by the runnable assertion in `theme/__tests__/contrast.test.ts`, not by eye.
- A transient rendering artifact was observed in one intermediate screenshot (leftmost characters
  of the first heading and first list item appeared clipped) that resolved on a second capture a
  moment later; the accessibility tree confirmed the underlying DOM text was always correct and
  complete. This was a font-swap repaint timing artifact in the capture tool, not a CSS/DOM defect
  — noted here for the record, not treated as a finding requiring a code fix.

## What the next plan inherits

- The full token, type and motion foundation — `01-03`'s board list, quick-add and detail panel
  consume `styles/tokens.css`/`type.css`/`motion.css` directly rather than declaring their own
  values.
- `legend/marks.ts` and `legend/Legend.tsx`, ready for `01-04`'s command palette to wire the Legend
  in as an always-reachable surface and for later plans to append status/priority/actor marks.
- `lucide-react` as a project dependency, ready for Row Anatomy's status/priority glyphs.

---

# Phase 1, Plan 01-03 — The Tracer's Rack

**Status:** The first real board surface is built and proven end to end: registration → the
five fixed status bands → inline quick-add → persistence across a relaunch, all pushed through
`board:changed` (D-04) rather than trusted as an optimistic write. This is a **tracer**, not a
throwaway — the surface is production-quality, but it deliberately covers only what plan 01-03
needs (create a task, see it on the rack). Selection, the project rail, the command palette, the
item detail panel, and every picker are later plans' surfaces.

## What was built

- **`FirstRun.tsx`** — the zero-projects empty state (exact copy from `01-UI-SPEC.md`
  "Copywriting Contract"), leading into a two-step registration flow: the native folder picker
  (`adapters/tauri.ts`'s `openFolderDialog`, backed by `@tauri-apps/plugin-dialog` and the narrow
  `dialog:allow-open` capability grant), then a confirmation step showing the project key prefix
  **pre-filled from the repository directory name** (`deriveKeyPrefix`) and editable before the
  first item exists (Open Decisions #11).
- **`BoardView.tsx`** — the vertical rack: five fixed status bands in fixed order, stamped sticky
  headers carrying live counts, virtualized with `@tanstack/react-virtual` using a single constant
  `estimateSize` (no `measureElement`) and overscan 10. Band headers share the item rows' fixed
  height so the whole rack is one uniform virtualized list, never horizontal columns.
- **`BoardRow.tsx`** — one strip: status glyph (shape, not colour alone) resolved from the
  `legend/marks.ts` registry, key in tabular figures, title truncated single-line with a native
  tooltip, the "No epic" pill for orphan tasks (D-13), and the priority glyph (stacked-bars,
  `SignalZero`/`Signal`/`SignalHigh`/`SignalMedium`/`SignalLow`).
- **`QuickAdd.tsx`** — the inline creation path (D-09): Enter creates at the current position,
  Escape cancels without creating.
- **`legend/marks.ts`** — extended with the five status marks (`strip-*`, matching the strip-tint
  CSS tokens so the Legend renders the real swatch) and the five priority marks
  (`priority-*`), so every glyph this plan renders is defined in the one legend surface (the
  Orienteering Map donation: "no mark may exist that the legend does not define").
- **Rust core** — migration `0002_board_schema.sql` (projects/epics/tasks/issues/
  acceptance_criteria/events/event_sequence_counters, FTS5 + triggers), `ranking.rs`
  (`FractionalIndex` wrapper), `domain::{actor, event, project, task}`, `query::list_board`. See
  `01-03-SUMMARY.md` for the full accounting.

## Review against the direction contract

The direction contract (`packages/desktop/index.html`, seed `59b0beb9`, authored in plan `01-02`)
is the standing reference — this plan does not re-author it. Reviewed directly against
`craft-floor.md`'s Verify/Refuse checklist, the same way plan `01-02` did: **this execution
environment has no agent-spawning tool available to the executor**, so the shipped
`impeccable-finish-reviewer` and `impeccable-documenter` subagents could not literally be
invoked. This section is the self-conducted substitute, and this limitation is stated explicitly
rather than silently claiming the named subagents ran.

**Verified against the built surface (`.impeccable/review/01-03-first-run.png`,
`.impeccable/review/01-03-populated-rack.png`, captured from a real `tauri dev` launch via `orca
computer get-app-state`, plus a full process kill-and-relaunch to prove persistence):**

- One vertical rack, five stacked bands, never horizontal columns — confirmed visually. **FINISH**
  clause satisfied: "If a build produces horizontal status columns, the direction has been
  misread" does not apply here.
- Status is a printed word (the band name) plus a shape glyph on each strip, never colour alone —
  the five strip tints are close in luminance by design (01-UI-SPEC.md), so the glyph and the band
  position are load-bearing, and both are present.
- No paper grain, no bevels, no drop shadows imitating physical strips — confirmed; the only
  visual treatment on strip stock is the flat tint plus a hairline divider.
- `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/board packages/desktop/src/App.tsx` and the same against
  `packages/desktop/src/legend packages/desktop/src/App.css` both returned `[]` — no findings.
- Contrast: strip-ink and rack-ink pairings reuse the exact token values `01-02`'s runnable
  contrast suite already proved (`theme/__tests__/contrast.test.ts`); no new colour was
  introduced.
- Motion: rows reposition via the virtualizer's `translateY` transform only; hover/focus/disabled
  states added in `App.css` reuse the single `--ease`/`--duration-settle` pair from `01-02`, never
  a second easing curve.
- Browser-surface theming (craft-floor.md "the parts you did not draw still carry the design"):
  `::selection`, `caret-color`, and `:focus-visible` rings are themed from the token palette in
  `App.css`, not left as unstyled OS defaults.

**Findings and fixes made during this review:**

- The Legend's `swatchStyle` originally rendered every mark without a dedicated background token
  (e.g. a priority glyph) as a focus ring — visually wrong for a non-focus mark. Fixed by adding a
  neutral rack-toned fallback swatch, reserving the ring rendering for the `focus` channel only.
- Strip-tint swatches (the five new status marks) render on a **light** background; the Legend's
  icon inherited the rack's light text colour by default, which would be invisible against a
  light swatch. Fixed by adding `glyphColor()`, which draws the icon in `--text-primary-strip` for
  any mark whose id matches a strip-tint token.

## Known deferred surfaces (not stubs — explicit scope boundaries)

These are surfaces `01-UI-SPEC.md` and the direction contract describe but that this plan's file
list (`01-03-PLAN.md` frontmatter `files_modified`) does not cover — later plans own them:

- **Project rail** (multiple registered projects, ⌘1-⌘9 switching) — this plan renders the first
  registered project directly; a rail lands with multi-project support.
- **Row selection, "pulled proud of the rail"** — the keyboard model (D-02, `j`/`k`, `Enter`/`o`)
  and its visual selection treatment are a later plan's surface.
- **Command palette (⌘K)** — `01-04`.
- **Item detail panel, pickers, acceptance criteria, activity trail** — `01-04`/`01-09` per
  `01-UI-SPEC.md`'s "Design System" consequence (hand-wired Radix primitives).

## What the next plan inherits

- A real, tested `create_task`/`list_board`/`create_project` path in `packages/core`, and the four
  Tauri commands wired end to end — every later board mutation follows the same transactional
  outbox + push-invalidate shape.
- `legend/marks.ts`'s status and priority marks, ready for the item detail panel's pickers to
  reuse rather than re-declare.
- `deriveKeyPrefix` (`board/FirstRun.tsx`) as the one place a key-prefix default is computed, for
  any future "edit project" surface to reuse before it would hit
  `packages/core::domain::project::update_key_prefix`'s immutability guard.

---

# Phase 1, Plan 01-04 — The Fixed Hierarchy and the Fixed Workflow

**Status:** the whole three-level hierarchy — epics, tasks, issues — is now creatable, editable
and deletable, and every task/epic moves through the five fixed states by keystroke, with the
rigidity enforced by a database CHECK constraint and one shared `WORKFLOW_STATES` constant rather
than by convention. This plan widens the `01-03` tracer's single-entity, single-path proof into
the full hierarchy `BOARD-01` and `BOARD-04` require.

**Execution note:** this plan was executed across two sessions after an infrastructure fault
crashed the first mid-flight (see the SUMMARY's Deviations section for the full account). Task 1
was implemented, tested and committed by the first session (`0f82626`). The second session
inherited Task 2's and Task 3's work already written to disk but uncommitted — reviewed it line
by line against this plan and `01-UI-SPEC.md` before building on it, found it correct and
complete, and finished only the one genuine gap it found (the missing `workflow.test.tsx`
component suite) plus one polish fix (see below) before committing.

## What was built

- **Rust core (`0f82626`, Task 1)** — `domain::WORKFLOW_STATES` (the one fixed five-state list),
  `domain::actor::{local_human_actor, system_actor}`, `domain::epic::{create_epic, update_epic,
  delete_epic, set_epic_status}`, `domain::issue::{create_issue, update_issue, delete_issue}`,
  `domain::task::{update_task, delete_task, set_task_status}` — every mutation opens exactly one
  `conn.transaction()` and is a redundant-transition no-op when the target status already holds.
  `query::list_board` extended to return epics+tasks banded by status and issues in a separate
  lane, with no bare inner join to `epics` (D-13's orphan-task guarantee preserved). Six new Tauri
  commands (`epic_*`, `issue_*`, `task_update`/`task_delete`/`task_set_status`), each resolving
  `actor_id` server-side and registered in both `main.rs`'s `generate_handler!` and
  `capabilities/default.json`.
- **`StatusBand.tsx`** — one sticky stamped band header per `WORKFLOW_STATES` entry, carrying the
  state name and its live item count; the count stays visible when the band is collapsed
  (BOARD-08's legibility-of-scale promise). Collapse state lives in `collapseStore.ts` (Zustand,
  keyed per project) — never written to the database.
- **`IssuesLane.tsx`** — the workflow-less issues region beneath the five bands: key, title, kind
  only, no status glyph, no criteria badge (D-07).
- **`pickers/StatusPicker.tsx`** — opens on `s`, accepts `1`-`5` directly, its option list built
  from `legend/marks.ts`'s `STATUS_MARKS` (never a second hand-typed state array — the Task 2
  grep gate over this exact file proves it), rendered through a `document.body` portal (virtualized
  rows are each their own stacking context, so an in-row absolutely-positioned menu would paint
  behind the next row) and focus-trapped/dismissable via hand-wired `@radix-ui/react-focus-scope`
  and `@radix-ui/react-dismissable-layer` (no shadcn, no pre-styled component — the locked
  `a-selfhost-radix` decision).
- **`item-detail/ItemDetailPanel.tsx`** — the 480px side panel: key, inline-editable title, the
  status picker (tasks/epics only, never rendered for an issue per D-07), and a deliberately empty,
  placeholder-free section boundary where plan `01-06`'s acceptance-criteria list and plan
  `01-10`'s activity trail land later.
- **`BoardView.tsx`** — now owns roving-focus keyboard selection (`j`/`k`, Home/End, `Enter`/`o`,
  `s`, Escape) over the virtualized rack, and renders the issues lane, the status picker overlay,
  and the item detail panel for the current selection. `BoardRow.tsx` gained the
  `row-surface-selected` / `row-surface-selected-unfocused` visual states (a selected-but-blurred
  row must not look identical to a focused-and-selected row, per Accessibility) and a clickable
  status glyph.
- **`legend/marks.ts`** — one new `epic` channel and mark (`epic-pill-none`, the orphan-task "No
  epic" pill) plus `STATUS_MARKS`/`statusValueFromMarkId`, so the picker's option list and the
  schema's CHECK constraint both trace back to the same declaration.

## Review against the direction contract

Same standing reference as `01-03` (`packages/desktop/index.html`, seed `59b0beb9`) — this plan
does not re-author it. **This execution environment again has no agent-spawning tool available**,
so the shipped `impeccable-finish-reviewer` and `impeccable-documenter` subagents could not be
literally invoked; this section is the self-conducted substitute, stated explicitly rather than
silently claimed. A live `tauri dev` capture (the `01-03` precedent) was not attempted this
session given the crash-recovery scope — the review below is a structural/behavioral read of the
built surface against `01-UI-SPEC.md` and `craft-floor.md`'s Verify/Refuse checklist, which is
exactly the fallback `01-UI-SPEC.md`'s own "Build Process Requirement" names for when no direction
contract review can run live.

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/board packages/desktop/src/item-detail` returned `[]` — no findings.
- **One vertical rack, never horizontal columns:** confirmed — `StatusBand` and `IssuesLane` both
  render as stacked rows inside the same virtualized/flex column as the item rows; no component
  in this plan applies a multi-column grid to the status groups.
- **No mark without a legend entry:** confirmed — `epic-pill-none` and all five status marks are
  in `legend/marks.ts`'s `MARKS` registry, each with a non-empty label and meaning.
- **Contrast:** every new surface reuses `--surface-secondary`/`--surface-dominant`/
  `--text-primary-rack`/`--text-muted-rack`/`--divider` — the exact token values `01-02`'s runnable
  contrast suite already proved; no new colour was introduced.
- **Depth:** `StatusPicker`'s portal-rendered menu carries a real offset+blur shadow
  (`0 8px 24px rgba(0,0,0,0.35)`), not a zero-offset colored halo.
- **Browser surfaces:** the status picker and detail panel reuse the app-wide `:focus-visible`
  ring and `::selection` theming from `App.css` — no new unstyled OS default was introduced.
- **Motion — one genuine gap found and fixed:** `BoardRow`'s new selection-highlight overlay is
  applied via an inline `background` (a `linear-gradient` composited over the status tint), but
  `App.css`'s `.board-row` transition list only covered `box-shadow` (the pre-existing hover
  treatment), so a selection change snapped instantly instead of transitioning — a direct miss
  against "the selection highlight transitions between rows" (01-UI-SPEC.md "Motion"). Fixed by
  adding `background` to the same transition declaration, reusing the single
  `--duration-settle`/`--ease` pair (no second easing curve introduced).
- **Motion — one accepted, documented gap, not fixed this plan:** band collapse/expand does not
  animate height; collapsing a band simply removes its rows from the virtualizer's row list for
  the next render. `01-UI-SPEC.md`'s Motion section names an animated collapse as an intent, but
  it is not one of this plan's own acceptance criteria, and doing it properly against
  `@tanstack/react-virtual`'s fixed-size virtualization (rather than faking it with a CSS
  max-height transition that fights the virtualizer's own positioning) is real design work, not a
  one-line polish fix. Left for a later plan to pick up deliberately rather than rushed here.

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **Priority, estimate and assignee pickers** — Row Anatomy names `p`/`e`/`a` keybindings; this
  plan implements only the status picker (`s`). The other three fields already render on the row
  and in `useBoardQuery`'s types; their pickers are a later plan's surface, matching the precedent
  `01-03-SUMMARY.md` set for fields whose underlying feature does not exist yet.
- **Acceptance criteria and the activity trail** — `ItemDetailPanel.tsx` reserves the section
  boundary but renders neither; `01-06` and `01-10` own them.
- **Command palette (⌘K)** — still not wired; the Legend surface it will eventually expose is
  ready (`epic` channel already added), but the palette itself is a later plan.
- **Quick-add for epics, and `Tab`/`Shift+Tab` nesting at creation time** — `IssuesLane`'s
  quick-add creates issues of kind `idea` only (no kind picker yet); epic creation and inline
  nesting are not wired in this plan's `BoardView`.

## What the next plan inherits

- The full epic/task/issue mutation surface in `packages/core::domain` and the matching Tauri
  commands, all following the exact one-transaction-per-mutation outbox shape `01-03` established.
- `StatusPicker.tsx`'s Radix focus-trap/portal pattern, ready to be reused verbatim for the
  priority/estimate/assignee pickers a later plan adds — same anchor-rect API, same
  `FocusScope`/`DismissableLayer` wiring.
- `ItemDetailPanel.tsx`'s empty section boundary, exactly where `01-06`'s criteria list and
  `01-10`'s activity trail are meant to be inserted.
- `collapseStore.ts` as the one place any future per-project, non-database UI preference (e.g. a
  "Group by" toggle, Open Decisions #9) should live, rather than a second ad hoc Zustand store.

# Phase 1, Plan 01-06 — Acceptance Criteria: Real Contracts, Not a Chat Blob

**Status:** tasks and epics now carry discrete acceptance criteria — each its own row with its
own ULID, a checkable statement plus a verification hint, individually toggleable without
touching the parent row, and counted (`checked/total`) wherever the item appears. This is the
plan `01-CONTEXT.md` names as the phase's core-value requirement (`BOARD-02`): "every unit of
agent work is anchored to a structured board item with real acceptance criteria — never a chat
blob."

## What was built

- **Rust core** — `domain::acceptance_criterion`: `create_criterion`, `update_criterion`,
  `toggle_criterion`, `reorder_criterion`, `delete_criterion`, `list_criteria`, each opening
  exactly one `conn.transaction()` and event-logging under `stream_type = "acceptance_criterion"`
  with the criterion's own id as `stream_id` and the parent's id denormalised into `task_id`/
  `epic_id` (D-19). `toggle_criterion`'s UPDATE names only `checked` + `updated_at` on the
  criterion row — never `rank`/`statement`/`verification_hint` — plus a second UPDATE that
  touches only the parent's `updated_at` (a check is not an edit, T-01-20). `parent_type` outside
  `{"task","epic"}` is rejected by the schema's own CHECK constraint (D-07), not by an
  application-layer allow-list — the same discipline `task.rs`/`epic.rs` already apply to status.
  `delete_task`/`delete_epic` now cascade-delete their criteria inside their own existing
  transaction, one `criterion.deleted` event per row, so the trail records exactly what a parent
  deletion removed.
- **`query::list_board`** — `BoardItem` gained `criteria_checked`/`criteria_total`, computed by a
  single grouped-aggregate `LEFT JOIN` against `acceptance_criteria` in the same statement — no
  per-row follow-up query, which would violate D-08's "visible wherever the item appears" against
  the performance contract at 1,000+ items.
- **Six new Tauri commands** (`criterion_create/update/toggle/reorder/delete/list`), actor-
  resolved server-side, statement/hint length-capped, registered in `main.rs` and mirrored in
  `capabilities/default.json`'s roster description.
- **`AcceptanceCriteriaList.tsx`** — the inline criteria list inside `ItemDetailPanel.tsx`,
  rendered for tasks and epics only (never for an issue, D-07). Zero criteria opens the inline
  composer automatically, mirroring the board's own zero-item empty state ("quick-add is already
  visible and focused"); `n` opens the composer when criteria already exist; `j`/`k` move the
  keyboard-focus cursor between rows; `Space`/`Enter` toggles the focused row. Checking a
  criterion annotates that one row and refetches the criteria query — it never triggers a rack
  re-render, matching the direction's signature-interaction performance thesis.
- **`BoardRow.tsx`** — gained the criteria `checked/total` field in its fixed Row Anatomy
  position (between the epic pill and the priority glyph), structurally exempt from the
  progressive-disclosure truncation ladder; renders `0/0` for an item with no criteria, never a
  blank, for both epics and tasks.
- **`DoneWarning.tsx`** — the non-modal one-keypress confirmation (D-08): `BoardView.tsx` now
  funnels every status change — whether from the row-level `s` picker or the detail panel's own
  picker — through one `requestStatusChange` gate. A transition to Done with unchecked criteria
  does not call the mutation immediately; it holds the pending change in state and renders
  `DoneWarning`. `Enter` confirms (fires the mutation); `Escape` cancels — the status change was
  never sent, so "reverts" simply means "never applied." It renders nothing when the total is
  zero or nothing is left unchecked.
- **`legend/marks.ts`** — a new `criteria` channel with three marks (`criterion-checked`,
  `criterion-unchecked`, `criteria-count-badge`), each with a non-empty label and meaning;
  `Legend.tsx`'s `CHANNEL_LABELS` extended to render the new channel (a `Record<MarkChannel,
  string>` — TypeScript itself enforces this can't be forgotten).

## Review against the direction contract

Same standing reference as `01-03`/`01-04` (`packages/desktop/index.html`, seed `59b0beb9`) —
this plan does not re-author it. **This execution environment again has no agent-spawning tool
available to this executor**, so the shipped `impeccable-finish-reviewer` and
`impeccable-documenter` subagents named in Task 2's acceptance criteria could not be literally
invoked; this section is the self-conducted substitute, stated explicitly rather than silently
claimed, exactly as `01-02`/`01-03`/`01-04` documented for the same limitation. A live `tauri dev`
capture was not attempted this session (no confirmed GUI display in this execution context);
the review below is a structural/behavioral read of the built surface against `01-UI-SPEC.md` and
`craft-floor.md`'s Verify/Refuse checklist — deferred to `/gsd-verify-work` for a live walkthrough,
matching the precedent `01-04`'s coverage item D4 set.

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/item-detail packages/desktop/src/board/BoardRow.tsx
  packages/desktop/src/board/DoneWarning.tsx packages/desktop/src/board/BoardView.tsx
  packages/desktop/src/legend` returned `[]` — no findings.
- **No mark without a legend entry:** confirmed — all three new criteria marks are in
  `legend/marks.ts`'s `MARKS` registry with non-empty glyph/label/meaning, and the registry-
  uniqueness test (`legend/__tests__`) still passes with the new entries.
- **Contrast:** every new surface reuses `--surface-secondary`/`--text-primary-rack`/
  `--text-muted-rack`/`--divider`/`--focus-ring` — the same token values `01-02`'s runnable
  contrast suite already proved; no new colour was introduced.
- **Depth:** `DoneWarning`'s floating confirmation carries a real offset+blur shadow
  (`0 8px 24px rgba(0,0,0,0.35)`), the same value `StatusPicker`'s portal menu already uses — not
  a zero-offset colored halo, and not a second shadow recipe.
- **Type:** the criteria checked/total badge uses `tabular-nums` (`BoardRow.tsx` and
  `AcceptanceCriteriaList.tsx`'s header count), per the project's tabular-figures rule for every
  columnar/numeric field.
- **Motion — no new choreography introduced.** Checking a criterion is a single-row refetch, not
  an animated transition; `DoneWarning`'s appearance is not an authored entrance (it mounts/
  unmounts plainly) — `01-UI-SPEC.md`'s Motion section names "the Done-with-unchecked-criteria
  prompt appears briefly (no bounce)" as an intent; this plan does not add bounce, but also does
  not author a specific appear/disappear transition for it, which is an accepted, documented gap
  rather than a violation — nothing in this plan's own acceptance criteria requires one.
- **Icons:** `criterion-checked`/`criterion-unchecked` use `SquareCheck`/`Square` (lucide-react),
  matching the existing `Icon` resolution pattern from `BoardRow.tsx`/`StatusPicker.tsx` — no
  unicode/emoji stand-in.

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **Criterion editing, reordering and deletion from the UI** — `update_criterion`,
  `reorder_criterion` and `delete_criterion` exist as core functions and Tauri commands (proven
  by `packages/core/tests/criteria.rs`), but `AcceptanceCriteriaList.tsx` wires only create/
  toggle from the keyboard, per Task 2's own `<action>` scope (add/move/toggle only — no drag,
  no delete affordance). A later plan can wire the remaining commands without any core or Tauri
  change.
- **The activity trail** — `ItemDetailPanel.tsx`'s section boundary still reserves the space;
  `01-10` owns it.
- **Live `tauri dev` walkthrough** — Task 2's `<human-check>` block (create three criteria with
  hints, check two, confirm the strip shows `2/3` without a rack re-render, move to Done and
  confirm the warning + one-keypress completion, confirm an issue has no criteria section) was
  not run live this session — see coverage note above, deferred to `/gsd-verify-work`.

## What the next plan inherits

- `domain::acceptance_criterion`'s full one-transaction-per-mutation shape, ready for `01-10`'s
  activity trail to read the same `acceptance_criterion` event stream by `task_id`/`epic_id`.
- `AcceptanceCriteriaList.tsx`'s inline two-step composer pattern (statement first, then hint,
  both inline, no dialog) as the reference for any future inline-composer surface.
- `BoardView.tsx`'s `requestStatusChange` gate as the one place a future non-blocking-warning
  pattern (if one is ever needed for another destructive-adjacent transition) should be added,
  rather than a second ad hoc gate.

# Phase 1, Plan 01-07 — Fractional Ranking, the Priority Tie-Break, and Size/Assignee

**Status:** the board now answers "what is next" the same way every time. A fractional-index
manual rank orders items within a priority band (D-11); priority sorts first via the existing
`CASE WHEN priority = 0 THEN 5 ELSE priority END` sort-key expression (unchanged from `01-03`);
`⌘↑`/`⌘↓` displaces exactly one row per move; and estimate (S/M/L, D-12) and assignee (BOARD-06)
are first-class, keyboard-settable fields that nothing aggregates.

## What was built

- **Rust core** — `reorder_task`/`reorder_epic`/`reorder_issue`: one indexed neighbour-lookup
  query (`(rank, id) < (?, ?)`/`> (?, ?)` against the `(project_id, status, rank)` composite
  index, further filtered by `priority` for tasks/epics so a keyboard reorder never computes a
  rank against a neighbour in a different priority band), one `UPDATE`, one attributed event per
  move. A group of zero or one item, or an item already at the edge in the move direction, is a
  no-op — no row written, no event appended. `set_priority`/`set_estimate`/`set_assignee` on
  `task.rs`/`epic.rs`: no-op when the value already matches the current one, one event with
  before/after otherwise; `set_assignee` rejects an id naming no actor via the pre-existing
  `assignee_id` foreign key + `foreign_keys = ON` (T-01-21), not an application-layer check.
  `issue.rs` gains only `reorder_issue` — D-07 holds: issues carry no priority, estimate or
  assignee setter.
- **`query::BoardItem`/`list_board`** — gained `estimate`/`assignee_id` columns in the existing
  `UNION ALL` SELECT; the `priority ASC, rank ASC, id ASC` ORDER BY itself needed no change (it
  was already correct from `01-03`/`01-06`).
- **`domain::actor::list_actors` + a new `actor_list` Tauri command** — the roster
  `AssigneePicker.tsx` renders. Not named in the plan's own `files_modified` list, but required
  by Task 2's assignee picker (Rule 2 — missing critical functionality); `commands/board.rs`'s
  `BoardItemDto` similarly gained `estimate`/`assignee_id` fields for the same reason.
  Registered in `main.rs` and `capabilities/default.json`'s roster description alongside the
  nine new task/epic/issue commands.
- **`pickers/PriorityPicker.tsx`/`EstimatePicker.tsx`/`AssigneePicker.tsx`** — same Radix wiring
  as `StatusPicker.tsx` (`FocusScope` + `DismissableLayer`, portalled to `document.body`, only a
  selection issues a command, never opening). `PriorityPicker` reads `0`-`4` directly (matching
  the schema's own keyed values, unlike `StatusPicker`'s 1-indexed digits); `EstimatePicker` adds
  a literal "Clear" row for the field's nullability (`0`/`Backspace`); `AssigneePicker` has no
  fixed digit shortcut (the actor roster is not a fixed-size set) and relies on the trapped `Tab`
  order plus native button `Enter`/`Space` activation, listing an explicit "Unassigned" entry
  first and a human/agent badge per actor (`legend/marks.ts`'s `actorTypeMarkId`).
- **`BoardRow.tsx`** — gained the estimate badge (renders the S/M/L letter itself, never the
  stored numeric ordinal — D-12's whole point) and the assignee avatar, in Row Anatomy's fixed
  order (estimate badge between title and epic pill; assignee avatar between epic pill and
  criteria checked/total). The priority glyph, already a bar-count icon (`Signal`/`SignalHigh`/
  `SignalMedium`/`SignalLow`/`SignalZero` from `01-03`), gained a click affordance and an
  explicit ARIA label mirroring the status glyph's own pattern. `App.css` gained
  `container-type: inline-size` on `.board-row` plus three `@container` rules implementing the
  progressive-disclosure ladder (epic pill drops first, then assignee avatar, then estimate badge
  last) — responding to the row's own available width, not the document viewport, so the ladder
  still functions when the item detail panel narrows the list without the OS window itself
  resizing.
- **`legend/marks.ts`** — two new channels (`estimate`, `assignee`) with six new marks
  (`estimate-small/medium/large`, `assignee-human/agent/unassigned`), plus `PRIORITY_MARKS`/
  `priorityValueFromMarkId`/`ESTIMATE_MARKS`/`estimateMarkId`/`estimateLetter`/`actorTypeMarkId` —
  the same "one registry, no second hand-maintained mapping" discipline `STATUS_MARKS`/
  `priorityMarkId` already established. `Legend.tsx`'s `CHANNEL_LABELS` extended (TypeScript
  itself enforces this can't be forgotten, per `01-06`'s precedent).
- **`BoardView.tsx`** — consolidated the single `statusPickerForId`/`statusPickerAnchor` state
  pair into one `activePicker: { kind; id } | null` + `pickerAnchor` pair covering all four row
  pickers (status/priority/estimate/assignee), since they share one open/anchor/close shape.
  `⌘↑`/`⌘↓` checked ahead of the plain-arrow selection-move case in `handleContainerKeyDown`
  (both share the same base key, disambiguated by `event.metaKey`). Each virtualized item row's
  wrapper gained the `displace-transition` class (`motion.css`, pre-existing from `01-02`) so a
  reorder's transform change animates; `prefers-reduced-motion` already zeroes
  `--duration-displace` globally, so the state change still applies instantly rather than being
  removed.

## Review against the direction contract

Same standing reference as `01-03`/`01-04`/`01-06` (`packages/desktop/index.html`, seed
`59b0beb9`) — this plan does not re-author it. **This execution environment again has no
agent-spawning tool available to this executor**, so the shipped `impeccable-finish-reviewer` and
`impeccable-documenter` subagents named in Task 2's acceptance criteria could not be literally
invoked; this section is the self-conducted substitute, stated explicitly rather than silently
claimed, exactly as `01-02`/`01-03`/`01-04`/`01-06` documented for the same limitation. A live
`tauri dev` capture was not attempted this session (no confirmed GUI display in this execution
context); the review below is a structural/behavioral read of the built surface against
`01-UI-SPEC.md` and `craft-floor.md`'s Verify/Refuse checklist — deferred to `/gsd-verify-work`
for a live walkthrough, matching the precedent `01-04`'s coverage item D4 and `01-06`'s own
deferral set.

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/board/pickers packages/desktop/src/board/BoardRow.tsx` returned
  `[]` — no findings.
- **No mark without a legend entry:** confirmed — all nine new marks (three priority-adjacent
  helper exports plus six new estimate/assignee marks) are in `legend/marks.ts`'s `MARKS`
  registry with non-empty glyph/label/meaning; `Legend.tsx` renders every channel generically from
  the registry, so the new `estimate`/`assignee` channels needed only a `CHANNEL_LABELS` entry,
  not a second rendering path.
- **Contrast:** every new surface reuses `--surface-secondary`/`--text-primary-rack`/
  `--text-muted-rack`/`--text-muted-strip`/`--divider`/`--focus-ring` — the same token values
  `01-02`'s runnable contrast suite already proved; no new colour was introduced.
- **Depth:** `PriorityPicker`/`EstimatePicker`/`AssigneePicker`'s floating menus reuse
  `StatusPicker`'s exact shadow recipe (`0 8px 24px rgba(0,0,0,0.35)`) — not a second shadow
  recipe, not a zero-offset colored halo.
- **Type:** the estimate badge uses `type-micro`/`tabular-nums`, matching the project's
  columnar-figure rule; the assignee badge label uses `type-micro`.
- **Motion:** one authored moment (the single-row `displace-transition`), not scattered effects —
  `prefers-reduced-motion` removes the displacement, never the state change itself, per
  `motion.css`'s existing global media query (`01-02`).
- **Icons:** `Ruler` (estimate), `User`/`Bot`/`UserRound` (assignee) — all `lucide-react`, no
  unicode/emoji stand-in, matching `BoardRow.tsx`/`StatusPicker.tsx`'s existing `Icon` resolution
  pattern.
- **Browser surfaces:** the estimate badge and assignee avatar both carry a `title` attribute
  (native tooltip) describing the full meaning, matching `criteria-count-badge`'s precedent for a
  badge whose rendered text is terser than its full meaning.
- **No aggregate over estimate anywhere:** `BoardRow.tsx` and `StatusBand.tsx` render the letter/
  count directly from a single item's own field; no band header, panel or component sums,
  averages or otherwise combines the `estimate` column across items — confirmed by grep (see the
  plan's own automated `<verify>` for the exact command).

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **Issue reordering has no UI affordance yet.** `reorder_issue` exists as a core function and a
  Tauri command (proven by `packages/core/tests/ranking.rs`), but `IssuesLane.tsx` — not in this
  plan's `files_modified` list — wires no keyboard selection model at all yet (issues aren't part
  of `BoardView`'s roving-focus `selectableItems`), so there is nothing to attach `⌘↑`/`⌘↓` to
  for an issue. A later plan can wire it once issues gain their own selection model.
- **Live `tauri dev` walkthrough.** Task 2's `<human-check>` block (press `p`/`e`/`a` on a strip,
  hold `⌘` and press `↓` three times, narrow to 900px, confirm no band header shows a total of
  sizes) was not run live this session — see coverage note above, deferred to `/gsd-verify-work`.
- **The activity trail** — `ItemDetailPanel.tsx`'s section boundary still reserves the space;
  `01-10` owns it, unchanged by this plan.

## What the next plan inherits

- `ranking::ReorderDirection::parse` and the neighbour-lookup query shape
  (`reorder_task`/`reorder_epic`/`reorder_issue`) as the one pattern any future reorderable list
  in this product should follow, rather than a second hand-rolled variant.
- `BoardView.tsx`'s consolidated `activePicker`/`pickerAnchor` state pair as the reference shape
  for adding a fifth row-level picker later, rather than a fifth parallel `useState` triple.
- `legend/marks.ts`'s `estimate`/`assignee` channels and their value<->mark-id helper functions,
  ready for the item detail panel's own priority/estimate/assignee pickers (not wired by this
  plan — only the row-level `p`/`e`/`a` keyboard path is) to reuse without re-deriving the
  mapping.

# Phase 1, Plan 01-08 — Search, Filter, and the Board at 1,000+ Items

**Status:** the rack answers instantly on a real project. Free-text search (titles, bodies and
the human-readable key) and every filter dimension the row anatomy shows (status, epic including
"No epic," assignee including "Unassigned," priority, estimate) run as indexed SQL in the Rust
core; the renderer holds only the current window and applies no second filtering pass of its own.

## What was built

- **`query::filter::BoardFilter`/`apply_filter`** — a typed filter set translated into a single
  `concat!`-built, named-parameter `FILTER_WHERE` fragment shared by `list_board` and
  `search_items`. Every dimension is either unfiltered (bind SQL `NULL`) or restricted to a
  JSON-array value set (`json_each(:x)`) — the WHERE text itself never changes shape based on how
  many values a filter carries, so no query in `packages/core/src/query` is ever assembled with
  the string-interpolation macro the plan's own grep gate checks for. "No epic"/"Unassigned" are
  encoded as the empty string inside the same JSON array as a real id (`COALESCE(epic_id, '')`) —
  a real ULID can never be empty, so this can't collide, and the filter needs no separate
  "include the null bucket" flag.
- **`query::search::search_items`** — matches `tasks_fts`/`epics_fts`/`issues_fts` as a literal,
  double-quote-escaped FTS5 phrase with a trailing prefix modifier on the last token
  (`"<term>"*`), OR'd with a case-insensitive `UPPER(key) = UPPER(:key_term)` equality so the
  human-readable key (`FLY-142`) is searchable without a migration change (D-10). Quoting
  disables every one of FTS5's own operators inside the quoted span — a title containing a colon,
  an asterisk or a hyphen is matched as literal text, never re-interpreted as query syntax. An
  empty/whitespace-only term delegates byte-identically to `list_board` (the same filter, no text
  constraint) rather than a second "unfiltered window" implementation.
- **`board_search` Tauri command** alongside `board_list`, both accepting the same
  `BoardFilterInput`/`BoardCursorInput` DTOs and capping the requested limit before calling the
  core (T-01-24). Registered in `main.rs` and named explicitly in `capabilities/default.json`.
- **`state/uiStore.ts`** — the new Zustand store for the filter draft, the search term and the
  selected item id, kept entirely separate from TanStack Query's server-state cache. Band-collapse
  state is NOT duplicated here — it keeps its existing home in `board/collapseStore.ts` (01-04);
  this plan did not consolidate the two into one store (a larger, separately-scoped refactor —
  documented below under deferred surfaces rather than silently left undone).
- **`useBoardQuery.ts`** — `useDebouncedValue` (150ms, `SEARCH_DEBOUNCE_MS`) sits at the query
  boundary: the debounced, trimmed search term (not the raw keystroke) drives the TanStack Query
  `queryKey`, so exactly one core call fires per settled input. `placeholderData: keepPreviousData`
  keeps the previously-rendered window on screen during a refetch; callers distinguish "refetch in
  flight" (`isFetching`) from "nothing to show yet" (`data === undefined`) rather than
  re-skeletoning on every keystroke's round trip.
- **`FilterBar.tsx`** — the always-visible top-bar search field (`⌘F`/`/` focus, ignored while
  another text field already has focus) plus chip rows for status/priority/estimate/epic/
  assignee, all reading from `legend/marks.ts`'s existing registries (`STATUS_MARKS`,
  `PRIORITY_MARKS`, `ESTIMATE_MARKS`, `epic-pill-none`, `assignee-unassigned`) — no new marks were
  needed, since every filter chip reuses a glyph/label the board's row anatomy already defines. A
  small dot indicator (`aria-busy` on the input, a decorative `aria-hidden` dot) shows a refetch
  in flight without touching the rendered rows. "Clear Filters" appears only once a filter or the
  search term is active. The epic chip list is derived from the *currently loaded* window's own
  epic rows rather than a dedicated "list every epic" query — see Known Stubs below.
- **`BoardView.tsx`** — gained an optional `emptyState` prop (`EmptyStateContent`), rendered as a
  centered, `pointerEvents: "none"` overlay (except its own CTA button) over the still-mounted,
  still-interactive rack underneath. `undefined` (the default) preserves every pre-01-08 caller's
  behavior exactly — the existing `board-view.test.tsx` suite needed no changes. `App.tsx`'s
  `Board` component is the one place that decides which of the two empty-state copies to pass,
  using its own filter/search UI state (`isFilterDraftActive`) — `BandCounts` alone can't make
  that distinction, since a truly empty project and a filter matching nothing both report
  all-zero counts.
- **`adapters/tauri.ts`** — needed no change. The existing generic `invokeCommand<T>(command,
  args)` seam already covers `board_search` identically to every other command; adding a
  dedicated wrapper function would have been a second, narrower seam duplicating what the generic
  one already does.

## Review against the direction contract

Same standing reference as `01-02`/`01-03`/`01-04`/`01-06`/`01-07`
(`packages/desktop/index.html`, seed `59b0beb9`) — this plan does not re-author it. **This
execution environment again has no agent-spawning tool and no confirmed GUI display available to
this executor**, so the shipped `impeccable-finish-reviewer` and `impeccable-documenter`
subagents named in Task 2's acceptance criteria could not be literally invoked, and no
`.impeccable/review/` screenshots were captured this session — this section is the
self-conducted substitute, stated explicitly rather than silently claimed, exactly as
`01-02`/`01-03`/`01-04`/`01-06`/`01-07` documented for the same limitation. Deferred to
`/gsd-verify-work` for a live walkthrough, matching every prior plan's own deferral.

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/board/FilterBar.tsx packages/desktop/src/board/BoardView.tsx`
  returned `[]` — no findings.
- **No mark without a legend entry:** confirmed — every filter chip renders a label already
  defined in `legend/marks.ts`'s `MARKS` registry (status/priority/estimate marks, plus the
  pre-existing `epic-pill-none`/`assignee-unassigned` marks); this plan introduced no new glyph,
  so `legend/marks.ts` itself needed no edit despite being named in the plan's `files_modified`
  list — a no-op, not an oversight (recorded here so it reads as a decision, not a gap).
- **Contrast:** every new surface reuses `--surface-secondary`/`--surface-dominant`/
  `--text-primary-rack`/`--text-muted-rack`/`--divider`/`--accent-text-rack` — the same token
  values `01-02`'s runnable contrast suite already proved; no new colour was introduced.
- **Depth:** the empty-state card reuses the same 1px `--divider` border + `--radius-chrome`
  chrome every other chrome surface in this codebase uses (`FirstRun.tsx`'s button/input
  precedent) — no new shadow recipe, no zero-offset colored halo.
- **Type:** filter chips and the empty-state heading/body use `type-label`/`type-heading`/
  `type-body` exactly as every other surface in this codebase does; no new type scale was
  introduced.
- **Motion:** none added — the search field's fetch indicator is a static dot, not an animation
  (01-UI-SPEC.md Performance Contract's "what must never happen": no page-load choreography, no
  decorative hover motion — a fetch-in-flight signal is neither).
- **Icons:** `Search`/`X`, both `lucide-react`, no unicode/emoji stand-in — matching
  `BoardRow.tsx`/`StatusBand.tsx`'s existing `Icon`/direct-import resolution pattern.
- **No client-side filter/sort/search pass:** confirmed by the plan's own automated `<verify>`
  grep gate (`grep -rEc '\.sort\(|localeCompare' packages/desktop/src/board` = 0) — `FilterBar`
  and `BoardView` render exactly the window `useBoardQuery` returns, in the order returned.

## Known Stubs

- **The epic filter chip list is derived from the currently loaded window, not a dedicated "list
  every epic" query.** Composing the epic filter with another active filter that hides every row
  of a given epic will also hide that epic from the chip list itself (a mildly surprising but not
  incorrect UX: the chip simply can't be selected until something makes that epic's rows visible
  again). A future plan could add a lightweight `epic_list` command if this proves confusing in
  practice; not added here to avoid a new command surface + capability entry for a chip-population
  convenience the plan's acceptance criteria did not require.
- **`selectedItemId` in `state/uiStore.ts` is not yet wired to `BoardView.tsx`'s own row
  selection.** `BoardView` still owns `selectedId` as local `useState`, exactly as before this
  plan — migrating it into the shared store (so, e.g., a future command-palette "jump to item"
  action could set selection from outside `BoardView`) is a real, larger refactor touching every
  keyboard handler in that file, deliberately deferred rather than rushed into this already-large
  plan. The store's `selectedItemId`/`setSelectedItemId` exist and are exported, ready for that
  future migration.

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **Live `tauri dev` walkthrough.** Task 2's `<human-check>` block (type into the search field
  against a seeded 1,000-item project, apply a status+assignee filter together, clear the search,
  set a filter matching nothing, scroll the full list) was not run live this session — see
  coverage note above, deferred to `/gsd-verify-work`, matching every prior plan's own deferral
  for this exact no-GUI-display limitation.
- **List-scroll 60fps and keystroke-to-paint-under-250ms** (01-UI-SPEC.md Performance Contract)
  are UAT-only checks per that same document ("No automated e2e harness exists yet... treat as a
  manual UAT check") — `search_at_1000_items_is_under_50ms` proves the server-side half of the
  budget; the client-side half is unverified by automation in this environment, consistent with
  the document's own stated scope.

## What the next plan inherits

- `query::filter::BoardFilter`/`apply_filter`/`FILTER_WHERE` as the one filter-translation pattern
  any future query needing renderer-supplied narrowing should follow, rather than a second
  hand-rolled WHERE-clause assembler.
- `state/uiStore.ts` as the established home for future local UI state (e.g. a future command
  palette's own open/closed state) — separate from TanStack Query's cache, matching the pattern
  this plan established.
- `useBoardQuery.ts`'s `useDebouncedValue`/`toFilterInput` as reusable building blocks for any
  future debounced, filter-shaped query.

# Phase 1, Plan 01-09 — Full Keyboard Operability, the Escape Ladder, and the Command Palette

**Status:** the whole board is drivable from the keyboard through one declarative binding table.
Selection tracks an item id (never a row index) through a reorder or a filter-driven shrink; a
fixed-order Escape ladder closes exactly one layer per press; and a generated `⌘K` command palette
makes every board-list action, plus project navigation, creation, filtering and the legend,
reachable without a memorised letter.

## What was built

- **`state/keyboard.ts`** — the single `BINDINGS` table (`Binding[]`), `FocusRegion` enum, and
  `resolveBinding(event, region)`. `resolveBinding` is the ONLY place a raw `KeyboardEvent` is
  matched against a key combination anywhere in the renderer; `BoardView.tsx`'s container handler
  and every `useGlobalBindings` caller (`CommandPalette.tsx`, `FilterBar.tsx`, `App.tsx`,
  `BoardView.tsx`) supply only a map of action id -> callback, never their own `event.key === …`
  switch. The ambiguity guard (`isTypingTarget`) suppresses every bare, unmodified key while the
  real event target is a text field — proven by `letters_do_not_fire_while_typing` — while
  modifier-bearing bindings (`⌘K`, `⌘N`, …) still fire regardless of where focus currently sits.
- **The Escape ladder** — `nextEscapeLayer(state)` is a pure function over four booleans
  (`paletteOpen`, `detailOpen`, `quickAddOpen`, `hasSelection`, plus a `pickerOpen` early-out for
  row-level pickers and `DeleteConfirm`, which already own their own Radix `DismissableLayer`
  Escape handling and are deliberately left alone). `BoardView.tsx` runs it from a single
  **capture-phase `window` listener** — capture-phase because it must run *before* any mounted
  overlay's own `document`-level Radix listener, and it calls `stopPropagation()` once it commits
  to closing a layer, which is what guarantees exactly one layer closes per press rather than two
  listeners racing the same keystroke. Proven end-to-end by `escape_closes_one_layer_per_press`
  (palette → detail panel → quick-add → clear selection, then a fifth press asserted as a no-op).
- **Selection as an id, not an index (`state/uiStore.ts`)** — `selectedItemId`/`detailItemId`/
  `deleteTarget` all moved into the shared store (completing the migration 01-08 deliberately
  deferred), so `CommandPalette.tsx` — mounted at the app-shell level, outside `BoardView`'s own
  tree — can read and drive selection, open the detail panel, and request a delete, using the
  identical state the keyboard path uses. Reordering needs no code at all (the id is untouched by
  a rank change); the harder half — the selected id being *removed* from the window — is a new
  `useEffect` in `BoardView.tsx` comparing against a `prevItemsRef` snapshot and falling to the
  next-nearest surviving id in the *previous* order, never resetting to the top. Proven by
  `selection_follows_the_item_across_a_reorder` and
  `selection_falls_to_the_nearest_survivor_when_filtered_out`.
- **`BoardRow.tsx`** — lost its own `handleRowKeyDown` entirely (it was quietly double-firing
  every board-list keystroke alongside `BoardView.tsx`'s container handler — exactly the "two
  key-handling systems fighting" failure mode this plan exists to remove). Gained `aria-setsize`/
  `aria-posinset`, sourced from the band's true per-status count (`counts`, filter-aware since
  01-08) and the item's true 1-indexed position within its band's currently loaded window — not
  the virtualizer's mounted window. Proven by `rows_announce_their_true_position` using a band
  count (40) deliberately larger than the rendered window (3) to rule out an implementation that
  reads the mounted count instead.
- **Quick-add is on demand** — `BoardView.tsx` now renders it only when explicitly opened (`c` /
  `⌘N` / `⌘⇧N`) or when the project has zero items (State Inventory's "already visible and
  focused" default, computed via `effectiveQuickAddOpen = quickAddOpen || items.length === 0`).
  `QuickAdd.tsx` gained two small, additive, opt-in props (`autoFocus`, `onEscape`) — its own
  Enter/Escape composing logic is untouched. A new `quickAddKind` switch lets the same row create
  either a task or an epic, reusing `useCreateEpic` (already existed, previously uncalled from any
  UI) rather than adding a second component.
- **`DeleteConfirm.tsx`** (new — Rule 2, not in the plan's own `files_modified` list) — `⌘⌫`'s
  destructive confirmation (threat T-01-25). `useDeleteItem` (from 01-04/01-07) had no caller
  anywhere in the codebase before this plan; nothing could actually delete an item until this
  component and its `BoardView.tsx`/`CommandPalette.tsx` wiring existed. Escape defaults to
  Cancel (never `autoFocus`ed on the destructive button) and the whole dialog is trapped/
  dismissable via the same `FocusScope`+`DismissableLayer` pattern every other overlay in this
  codebase uses.
- **`CommandPalette.tsx`** (new) — generates its ENTIRE command list from `state/keyboard.ts`'s
  `allActionIds()`/`actionLabel()` (the fixed part) plus two runtime lists computed each render:
  one "Go to Project: {name}" entry per registered project, and the hot actions on whichever item
  `selectedItemId` currently names. Contains no hand-written array of command labels — Task 2's
  own acceptance criterion, proven by `palette_covers_every_binding` iterating
  `boardListActionIds()` rather than asserting a fixed snapshot. `register-project`/`create-task`/
  `create-epic`/`open-palette` all re-enter the SAME pipeline a real keystroke would via the new
  `dispatchAction(id)` helper (`state/keyboard.ts`) — it synthesizes and dispatches a real
  `KeyboardEvent` matching that action's `"global"` binding, so `BoardView.tsx`'s own
  `useGlobalBindings` registration is what actually performs the effect, never a second,
  independently-maintained implementation. `open-legend` renders `Legend.tsx` in its new overlay
  mode; `filter-status`/`filter-epic`/`filter-assignee`/`filter-priority` focus the matching chip
  group in `FilterBar.tsx` (see the honest simplification noted below) rather than duplicating its
  toggle logic. Status/priority/estimate/assignee hot actions render the SAME picker components
  `BoardView.tsx` uses, anchored to the palette panel's own bounding rect rather than a row (since
  there is no triggering row when the command comes from the palette).
- **`Legend.tsx`** — gained an optional `onClose` prop. `undefined` (the default) renders exactly
  the bare, embeddable `<section>` every prior plan left it as; supplying `onClose` wraps the same
  content in a trapped, dismissable overlay for `CommandPalette.tsx`'s "Open Legend" command — the
  donation from the declined Orienteering Map direction ("no mark may exist that the legend does
  not define") is now reachable, not just present in source.
- **`src-tauri/src/menu.rs`** (new) — `build_menu`, wired via `Builder::menu`/`on_menu_event` in
  `main.rs`. Every custom item's id is a literal `state/keyboard.ts` `ActionId` string
  (`register-project`, `create-task`, `create-epic`, `open-palette`); `on_menu_event` forwards only
  those four ids as the `menu:action` event, and the frontend's `dispatchAction` re-enters the
  identical keyboard pipeline — menu items invoke the same registered actions as the UI, never a
  broader capability (threat T-01-02). No Help item, no "Toggle Group By" item — both would have
  no real destination/behavior to invoke (Open Decisions #8/#9), and a menu entry that goes
  nowhere is worse than its absence. The Window submenu uses Tauri's own `WINDOW_SUBMENU_ID` so
  macOS auto-populates it with the running window list, matching what "the standard macOS Window
  menu" implies rather than a plain titled submenu that only looks the part.

## A real bug this plan's own craft-floor review caught and fixed

`DeleteConfirm.tsx`'s destructive "Delete" button was first written with
`color: var(--text-primary-strip)` (dark ink, the token meant for strip PAPER stock) on
`background: var(--destructive-strip)` — measured at **2.2:1**, well under AA. Swapped to
`var(--text-primary-rack)` (the light rack text token), measured at **6.3:1**. Neither value was
in the plan's own token table for this exact pairing (the destructive token's only measured pairing
in 01-UI-SPEC.md is destructive text ON strip stock, not white-on-destructive-background) — this is
exactly the kind of pairing the Contrast check in `craft-floor.md` exists to catch before it ships,
not after.

## Review against the direction contract

Same standing reference as every prior plan in this phase (`packages/desktop/index.html`, seed
`59b0beb9`) — this plan does not re-author it, and the direction's own `FINISH:` line states it
governs every board surface through plan 01-11, so this plan's four new overlays (palette, delete
confirmation, the legend's overlay mode) are held to it, not treated as exempt "chrome."

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/board packages/desktop/src/state packages/desktop/src/legend`
  returned `[]` — no findings, re-run after the contrast fix above.
- **Contrast:** every new surface reuses the measured, already-verified token pairs
  (`--surface-secondary`/`--surface-dominant` + `--text-primary-rack`/`--text-muted-rack`) except
  the one destructive-button pairing documented above, which is now measured and fixed rather than
  assumed.
- **Radius:** the command palette, delete confirmation, and legend overlay all use
  `--radius-chrome` (interactive chrome, per Design System) — never `--radius-strip` (reserved for
  strip-stock rows) and never a hard-coded pixel value.
- **Depth:** all three new overlays use the same offset-plus-blur shadow recipe
  (`0 Npx Mpx rgba(0,0,0,…)`) already established by `pickers/StatusPicker.tsx` — no zero-offset
  colored halo, no new shadow language introduced.
- **Focus trapping:** the command palette and the delete confirmation both use
  `FocusScope trapped loop` + `DismissableLayer`, matching `pickers/StatusPicker.tsx`'s established
  pattern exactly (`component_strategy: a-selfhost-radix` — no shadcn, no pre-styled component).
- **Icons:** no new icon was introduced in this plan's new surfaces; the command palette renders
  plain text rows rather than per-command glyphs — an honest simplification (see below), not an
  icon-system violation, since Lucide remains the only icon source used anywhere.
- **Motion:** none added to the three new overlays (no fade authored, consistent with the
  direction's "never a fade" rule) — they appear/disappear with the mount/unmount, exactly like
  `pickers/StatusPicker.tsx` already does.
- **No mark without a legend entry:** unaffected — this plan introduces no new status/priority/
  estimate/assignee glyph; `legend/marks.ts` needed no edit.

### A real focus-restore bug found and fixed via a Radix internals investigation, not guesswork

The command palette's search `<input>` was first written with a plain `autoFocus` attribute.
`palette_restores_focus_on_close` failed: focus landed on `<body>`, not the triggering element.
Root cause, confirmed by reading `@radix-ui/react-focus-scope`'s source and reproducing it in
isolation before touching the fix: React's native `autoFocus` handling runs during the commit
phase, which is *before* `FocusScope`'s own mount effect (a passive effect) captures
`document.activeElement` as "what to restore focus to" on unmount. The `autoFocus` input stole
focus first, so `FocusScope` captured *its own input* as the restore target — and since that input
is what gets unmounted, the restore silently no-ops. Deleting the `autoFocus` attribute and
relying on `FocusScope`'s own default mount-autofocus behavior (which runs `focusFirst` over the
container's tabbable candidates *after* correctly capturing the real trigger) fixed it outright.
Documented in the component's own doc comment so it is never reintroduced by a future plan copying
the "just add `autoFocus`" pattern other components in this codebase use safely (because none of
them are wrapped in a `FocusScope` that needs to remember what was focused before).

## Known Stubs

None that block this plan's own goal.

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **"Filter by Status/Epic/Assignee/Priority" palette commands focus the matching `FilterBar.tsx`
  chip group rather than opening a nested value-picking submenu.** The spec names four commands,
  not a per-value command per filter dimension; a true submenu (Raycast/Linear-style nested command
  list) is real, additional UI machinery this plan did not build. The chips themselves are already
  fully keyboard-reachable (native `<button>` elements, `Tab`-navigable) once focus lands in the
  group, so nothing is undiscoverable — the simplification is in *how many keystrokes* reach a
  specific value, not in *whether* it's reachable at all.
- **"Create Issue" (palette) does not focus `IssuesLane.tsx`'s own always-visible quick-add.** That
  quick-add (01-04) has no `ref` plumbed out of `IssuesLane.tsx`, and it is already unconditionally
  visible/reachable, so the discoverability problem BOARD-07 names does not apply to it the way it
  applies to the on-demand task/epic quick-add. The palette command exists (satisfying "the palette
  must include ... Create Issue") but currently creates a placeholder-titled issue directly rather
  than opening the lane's own composer for the user to type a title.
- **Item detail panel's own keyboard map (Tab/Shift+Tab between fields, `⌘Enter`, `n`/Space/`j`/`k`
  on the criteria list, `⌘⌫` to delete from inside the panel) is out of scope for this plan.**
  01-UI-SPEC.md's Keyboard Map names these, but Task 1's own action text scopes this plan's binding
  work to the global and board-list regions plus the Escape ladder — `ItemDetailPanel.tsx` is not
  in `files_modified`, and several of these bindings (a description field, in particular) have no
  underlying feature yet to bind to. `⌘⌫` deletion IS wired, but only from the board-list region
  (the selected row), not from inside an open detail panel.
- **Live `tauri dev` walkthrough** (Task 3's own `<human-check>` block — a full mouse-untouched
  session creating every item type, setting every field, reordering, searching, filtering, opening
  the legend from `⌘K`, and deleting an item) was not run live this session, matching every prior
  plan's own deferral to `/gsd-verify-work` for the same no-confirmed-GUI-display limitation.
- **Project-rail UI does not exist yet** (a later plan's surface per 01-UI-SPEC.md's own Surface
  Inventory). `⌘1`-`⌘9` and "Go to Project" are fully wired against `state/uiStore.ts`'s new
  `currentProjectId`, and `AppShell` in `App.tsx` now resolves the active project from it — but
  there is no visible rail to click yet. Switching still works purely by keyboard/palette.

## What the next plan inherits

- `state/keyboard.ts`'s `BINDINGS`/`resolveBinding`/`useGlobalBindings`/`dispatchAction` as the
  established pattern for adding any future keyboard-triggered action — extend the table, never
  add a second `event.key === …` switch anywhere in the renderer.
- `state/uiStore.ts` now owns the full cross-tree UI-navigation state a future project rail or
  breadcrumb surface needs (`currentProjectId`, `selectedItemId`, `detailItemId`, `deleteTarget`,
  `paletteOpen`) — a rail component can read/drive all of it without touching `BoardView.tsx`.
- The `dispatchAction(id)` pattern (synthesize the real keystroke rather than reimplementing the
  effect) as the reusable bridge for any future non-keyboard trigger (a tray icon, a deep link)
  that needs to invoke an existing keyboard-bound action.
- `Legend.tsx`'s optional `onClose` overlay mode, ready for any future surface that wants to show
  the legend inline instead of through the palette.

---

# Phase 1, Plan 01-10 — The Activity Trail and the Cursor-Resumable Event Stream

**Status:** every task/epic detail panel now ends in a chronological, actor-attributed activity
trail read straight from the append-only `events` table — no second history store anywhere in the
schema or the renderer. The same table is also readable as a resumable, gap-free, duplicate-free
stream via `(project_id, origin, sequence)` cursors, proven by a dedicated invariant suite that
writes a second `origin` value even though nothing in this phase produces one yet — the entire
integration surface a future relay needs already exists and is tested.

## What was built

- **`core::domain::event::render_description`** — the one function that turns an event's own
  `payload` into the one-line sentence the trail shows. Every domain mutation function already
  wrote a pre-rendered `"label"` string into its payload at the moment of the event (a fact
  discovered while reading `task.rs`/`epic.rs`/`issue.rs`/`acceptance_criterion.rs` before writing
  this function, not assumed) — `render_description` reads that back, with a generic
  `field`/`before`/`after` fallback for the case a payload lacks one, so every event type this
  phase emits has a defined, non-empty rendering.
- **`core::query::events`** (new module) — `activity_trail(conn, parent_kind, parent_id, limit,
  offset)`: one indexed query against the denormalised `task_id`/`epic_id` column, ascending by
  the ULID `id` (chronological by construction, no separate timestamp sort), covering a task's
  criteria events for free since criterion events already carry their parent's id in that same
  column. `events_since_cursor(conn, cursor, limit)`: `WHERE project_id = ?1 AND origin = ?2 AND
  sequence > ?3 ORDER BY sequence ASC LIMIT ?4` — filtered on both `project_id` and `origin`,
  never `sequence` alone (D-17). Every query in this module is a single literal `&str`, never
  `format!`-assembled. No migration was added — the schema gains no new table, satisfying this
  plan's own load-bearing prohibition against a second, denormalised history.
- **`desktop/src-tauri/src/commands/events.rs`** — `events_activity_trail`/`events_since_cursor`,
  each capping its requested window server-side (T-01-24: 50 for the trail, 500 for the cursor
  stream), registered in `main.rs`'s `generate_handler!` and `capabilities/default.json`'s roster.
- **`item-detail/ActivityTrail.tsx`** — the trail section embedded inside `ItemDetailPanel.tsx`
  (never a separate route or overlay), rendered for tasks and epics only (mirrors
  `AcceptanceCriteriaList.tsx`'s own `!isIssue` guard — `core::query::events` only accepts
  `"task"`/`"epic"` as a `parent_kind`, and no surface opens the detail panel for an issue yet).
  Uses `useInfiniteQuery` so "Load more" fetches the next bounded 50-event page rather than
  re-requesting an ever-growing window. Entries render newest-first (reversed at display time
  only — the query itself stays ascending) with an actor badge (human/agent/system, resolved via
  `useActors()` and `legend/marks.ts`'s `actorTypeMarkId`, never colour alone), the core's
  pre-rendered description, and a relative timestamp (`<time>`, `tabular-nums`, absolute value in
  the native `title` tooltip). Subscribes to `board:changed` (D-04) so any mutation anywhere in
  the app refreshes the trail, never trusting a stale cache.
- **`legend/marks.ts`** — added the `assignee-system` mark (the third peer in the actor model,
  DATA-03) and widened `actorTypeMarkId` to map `"system"` to it instead of silently falling back
  to the human badge, so the trail's human/agent/system triad is never missing its third case.
- **Tests** — `packages/core/tests/activity_trail.rs` (5 tests) and
  `packages/core/tests/cursor_resume.rs` (5 tests), proving: a fresh item has exactly one entry; a
  task's own trail includes its criteria's events; two same-millisecond events order stably across
  ten reads; every entry carries a non-empty description and a non-null actor; paging with a limit
  of 2 covers every entry exactly once; cursor batches of 7 across a 100-event log deliver exactly
  100 events, each once, in ascending sequence (a batch size that does not divide the log length,
  so an off-by-one at the boundary would show up as a gap or a duplicate, not hide inside an even
  split); a cursor past the end returns empty, not an error; a cursor of zero returns the first
  event; a second `origin` value has its own cursor, invisible to the first origin's; replaying
  every event from sequence zero reconstructs the same item id/title set the `tasks` table itself
  holds. Plus `item-detail/__tests__/activity-trail.test.tsx` (component: a single-event trail
  renders one entry; a 60-event trail renders 50 with a "Load more" affordance).

## Craft floor review (self-conducted)

No agent-spawning tool is available to this executor in this execution context, matching every
prior plan in this phase (`01-02` through `01-09`). Reviewed directly against `craft-floor.md`'s
Verify/Refuse checklist and the standing direction contract (`packages/desktop/index.html`, seed
`59b0beb9`) instead of spawning `impeccable-finish-reviewer`/`impeccable-documenter`.

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/item-detail packages/desktop/src/legend` returned `[]` — no findings.
- **Contrast:** reuses the already-measured `--text-muted-rack`/`--surface-secondary` and
  `--accent-text-rack` token pairs `ItemDetailPanel.tsx`/`AcceptanceCriteriaList.tsx` already
  establish — no new colour pairing introduced.
- **Motion:** none authored. The Motion contract explicitly requires the trail to "render fully
  populated instantly on open" and "not animate each historical event into place" — the absence of
  motion here is the spec, not an oversight.
- **Type:** `type-body`/`type-label` reused from the established scale; `.tabular-nums` on the
  timestamp per this plan's own binding decision #2.
- **Browser surfaces:** the relative timestamp uses a semantic `<time dateTime>` element with the
  absolute value in its native `title` tooltip — the cheapest, most honest way to expose "absolute
  on hover" without a custom tooltip component.
- **No mark without a legend entry:** the new `assignee-system` mark is declared in `legend/marks.ts`
  before `ActivityTrail.tsx` ever renders it.
- **Icons:** `Cog` (lucide-react) for the system actor badge — outline-only, consistent stroke,
  matching `User`/`Bot`'s existing weight.

Screenshots of a long trail, a single-entry trail and the "Load more" boundary were not captured
(no confirmed GUI display in this execution context, matching `01-02` through `01-09`'s own
documented limitation) — deferred to `/gsd-verify-work`, same precedent as every prior plan's own
`<human-check>` block.

## Known Stubs

None that block this plan's own goal. Every entry the trail renders comes from a real
`events_activity_trail` query result — nothing hardcoded or mocked in the shipped component.

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **Issue trails do not exist.** `events` carries no `issue_id` column (only `task_id`/`epic_id`
  are denormalised), and no surface opens the item detail panel for an issue yet — `ActivityTrail`
  mirrors `AcceptanceCriteriaList`'s `!isIssue` guard rather than half-supporting a lane the schema
  does not denormalise for. If a future plan opens issue detail, extending `events_since_cursor`-
  style filtering to `stream_type = 'issue' AND stream_id = ?` (rather than a new column) is the
  natural extension.
- **`events_since_cursor` has no caller in the renderer.** It exists purely as the proven,
  tested integration surface D-22 names for a future relay — no UI-SPEC surface in Phase 1 calls
  for a renderer-side consumer of it.
- **`BoardRow.tsx`'s "actor-of-last-change" row field (01-UI-SPEC.md Row Anatomy) is not wired.**
  That field lives on the board strip itself, not the detail panel's trail, and `BoardRow.tsx` is
  not in this plan's `files_modified` — the trail this plan builds is the detail-panel surface
  only.
- **Live `tauri dev` walkthrough** (this plan's own `<human-check>` block: create a task, rename
  it, change its status twice, add and check a criterion, then open it and read the trail) was not
  run live this session, matching every prior plan's own deferral to `/gsd-verify-work` for the
  same no-confirmed-GUI-display limitation.

## What the next plan inherits

- `core::query::events::{activity_trail, events_since_cursor, EventCursor, EventRow}` and
  `core::domain::event::render_description` as the one place any future surface (a relay, a
  mobile client, a second desktop feature) reads or renders the event log — never a second
  formatter.
- `item-detail/ActivityTrail.tsx`'s `useInfiniteQuery` pattern as the established shape for any
  future paginated, `board:changed`-invalidated read inside the detail panel.
- `legend/marks.ts`'s `assignee-system` mark and the now-complete `actorTypeMarkId` triad, ready
  for any future surface that needs to badge a system-attributed action.

---

# Plan 01-11 — Project switcher (rail, registration flow, unreachable state)

## What was built

- **`core::marker`** (new module) — `read_marker`/`write_marker`/`verify_marker` against
  `.flywheel/project.json`, the owner-decided marker path/format (Task 1, `dot-dir-json`; recorded
  in full in `01-11-SUMMARY.md` and `01-RESEARCH.md`'s Open Question 2). Every function takes an
  explicit absolute path — nothing reads the process working directory, and marker content is
  never used to construct a path to visit (T-01-03).
- **`core::domain::project::{register_project, reconcile_projects, relocate_project}`** —
  registration mints, reuses, or clone-adopts a marker id inside one transaction, writing the
  marker file only after that transaction commits (T-01-30); reconciliation (run in `main.rs`'s
  `setup` hook, before the window is shown) marks a project unreachable on a marker mismatch and
  active again once it matches, never rewriting `repo_path`; relocation is the one other writer of
  that column, and rejects a marker naming a different project (T-01-29).
- **`projects/ProjectRail.tsx`** — the persistent left rail (01-UI-SPEC.md "Project switcher"):
  rack chrome, present once ≥1 project is registered, each entry showing its key prefix as the
  real glyph, the current project marked with the accent role (one of the few sanctioned uses —
  never more than one "loudest" element per view), an unreachable entry showing a warning glyph
  *plus* the literal word "Unreachable," never colour alone.
- **`projects/RegisterProjectFlow.tsx`** — the ONE registration flow every entry point now shares
  (`useRegisterProjectFlow`): the rail's `+`, `App.tsx`'s `⌘⇧O`, and `CommandPalette.tsx`'s
  "Register Project…" all call this single hook. Before this plan each of the three had its own
  copy of "open the picker, derive a default name/key, call `project_register`" — consolidated
  here as this plan's own read of "the same flow as File → Register Project…".
- **`projects/ProjectUnreachable.tsx`** — the full-surface reconciliation state
  (01-UI-SPEC.md Copywriting Contract's exact heading/body/CTA), replacing the board for a project
  whose marker failed verification. Exactly one action, "Locate Project…"; no retry, no automatic
  disk search, no auto-repair.
- **`App.tsx`** — renders `ProjectRail` alongside the board once ≥1 project exists, and routes an
  unreachable current project to `ProjectUnreachable` instead of `Board`.
- **`state/keyboard.ts` / `CommandPalette.tsx`** — `⌘1`-`⌘9` and per-project "Go to Project: {name}"
  palette entries were already in place from `01-09`'s own forward-looking binding table; this
  plan verified both against the rail's real project list rather than re-deriving them.
- **`legend/marks.ts`** — three new marks (`project-entry`, `project-current`,
  `project-unreachable`) and a new `"project"` channel, mirrored into `Legend.tsx`'s
  `CHANNEL_LABELS` (a required, minimal consequential edit — the channel union and the label
  record must stay exhaustive together).
- **Tests** — `packages/core/tests/project_reconciliation.rs` (14 tests: marker round-trip,
  malformed-marker rejection, exactly-two-fields, mint/reuse/clone-adopt registration, same-path
  idempotency, a deterministic two-transaction race proving the database's own uniqueness
  constraint resolves a raced registration rather than call ordering, path canonicalization,
  reconciliation's mark/clear/idempotent-no-op behavior, relocation's accept/reject). Plus
  `projects/__tests__/project-rail.test.tsx` (5 tests: rail absent/present, unreachable glyph +
  literal word, `⌘3` switches to the third project via a real `fireEvent.keyDown` through the full
  `App` tree, `ProjectUnreachable`'s exactly-one-action contract).

## Craft floor review

`craft-floor.md` was read before touching any UI file in this plan (Task 3's own read-first list).

- **Detector:** `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs
  --json packages/desktop/src/projects packages/desktop/src/App.tsx` returned `[]` — no findings,
  re-run clean after the fixes below.
- **A real overflow bug found and fixed, not merely checked for:** the first render of an
  unreachable rail entry (64px rail, 40×40 fixed-height button) let the "Unreachable" label
  overflow past the button's own bounds and visually crowd the entry below it — exactly the class
  of bug `craft-floor.md`'s "Type" check exists to catch ("run the real copy at every breakpoint
  and fix what overflows"). Fixed by widening the rail to 72px (01-UI-SPEC.md's own stated upper
  bound), letting the unreachable entry's height grow to fit its label instead of clipping, and
  inserting a soft hyphen (`&shy;`) at the syllable boundary so the single 11-character word wraps
  at a sensible point rather than an arbitrary character split (headless/CI Chromium does not
  reliably apply CSS `hyphens: auto` without a locale dictionary, so a manual break point was the
  more portable fix). Verified by re-screenshotting before and after — see below.
- **Contrast:** reuses `--destructive-strip`/`--accent-nontext`/`--accent-text-rack`, already
  measured in 01-UI-SPEC.md's palette table — no new colour pairing introduced.
- **Motion:** none authored — a rail entry is a discrete state (reachable/unreachable/current),
  not a transition the Motion contract calls for animating.
- **Type:** `type-label`/`type-micro` reused from the established scale; `.tabular-nums` on the
  key-prefix glyph per the standing columnar-field convention.
- **Never colour alone:** the unreachable entry pairs the warning glyph with the literal printed
  word "Unreachable," asserted by a test, not merely styled and hoped for.
- **No mark without a legend entry:** `project-entry`/`project-current`/`project-unreachable` are
  declared in `legend/marks.ts` before `ProjectRail.tsx` ever implies their existence.
- **Icons:** `FolderGit2`/`Dot`/`TriangleAlert`/`Plus` (lucide-react) — outline-only, 2px stroke,
  consistent with every icon already shipped.

**Screenshots were captured this time** — the first plan in this phase able to, per its own
Craft floor review sections above (`01-02` through `01-10` all documented "no confirmed GUI
display in this execution context" and deferred to `/gsd-verify-work`). This plan's executor ran
`npm run dev` (the Vite dev server alone, no Tauri shell) behind a headless Chromium
(`playwright`), with `window.__TAURI_INTERNALS__.invoke` mocked via `page.addInitScript` to return
canned `project_list`/`board_list`/`actor_list`/`project_register`/`project_relocate` responses —
the same IPC bridge shape `@tauri-apps/api/mocks`' own `mockIPC` documents, hand-rolled here rather
than imported so the mock could live in a throwaway Node script instead of the shipped bundle.
Four screenshots are in `.impeccable/review/`: `01-11-first-run.png`, `01-11-rail-multiple-
projects.png`, `01-11-rail-unreachable-entry.png`, `01-11-project-unreachable-surface.png`. No
`impeccable-finish-reviewer`/`impeccable-documenter` subagent was spawned — no agent-spawning tool
is available to this executor, matching every prior plan in this phase; this section (and the
screenshots) are this plan's own substitute self-review, one level more evidenced than precedent
because a real render was achievable this session.

## Known Stubs

None that block this plan's own goal. The rail, registration flow, and unreachable surface all
read real `project_list`/`project_register`/`project_relocate` responses — nothing hardcoded or
mocked in the shipped component (the mock IPC bridge above exists only in a throwaway screenshot
script under `/tmp`, never committed to the repository).

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **The "already registered" notice is a post-hoc comparison, not a pre-registration peek.**
  01-UI-SPEC.md's own language ("when the chosen directory already carries a marker, say so
  *before* completing") most literally implies checking before the mutation fires — but doing that
  would need a new Tauri command outside Task 3's declared `<files>` (which lists no new Rust
  source). `RegisterProjectFlow.tsx` instead compares the returned project's id against the
  project list snapshotted immediately before the mutation, and `ProjectRail.tsx`'s `+` button
  surfaces a transient notice from that comparison — a visible event, just after rather than
  strictly before the round trip. `⌘⇧O` and the palette's "Register Project…" intentionally skip
  the notice (a user who explicitly re-registers a known repository via keyboard/palette is less
  likely to be surprised by it than one who just clicked `+`). Documented here as a judgment call
  rather than left silent — a future plan adding a dedicated `project_peek_marker` command could
  tighten this to a true pre-registration check.
- **The rail's tooltip is the native `title` attribute**, not a custom tooltip component — reveals
  the full project name on mouse hover in every browser; some browsers do not surface `title` on
  keyboard focus alone. `01-UI-SPEC.md` calls for "hover or keyboard focus" to reveal it; a custom
  focus-triggered tooltip was judged out of proportion to this plan's scope given `aria-label`
  already carries the full name to assistive tech regardless of visual tooltip behavior.
- **Live `tauri dev` walkthrough** (this plan's own `<human-check>` block: register three real
  repositories, switch with `⌘1`-`⌘3`, inspect the marker file on disk, rename a directory and
  relaunch to see it go unreachable, then relocate it) was not run against a real Tauri shell this
  session — the headless-Chromium screenshots above prove the UI renders and responds correctly
  against a mocked IPC bridge, but not against the real Rust core or a real filesystem move.
  Deferred to `/gsd-verify-work`, same precedent as every prior plan's own `<human-check>` block.

## What the next plan inherits

- `projects/RegisterProjectFlow.tsx`'s `useRegisterProjectFlow` as the one registration flow any
  future entry point (a fourth menu item, a fleet-wide view in a later phase) should call rather
  than re-deriving the picker/register sequence a fourth time.
- `core::marker` and `core::domain::project::{register_project, reconcile_projects,
  relocate_project}` as the complete, tested marker/reconciliation surface Phase 3's worktree work
  is told to mirror (D-16's own cross-reference: "this mirrors the rule Phase 3 applies to
  worktrees").
- `legend/marks.ts`'s `"project"` channel and its three marks, ready for any future surface that
  needs to reference project-switcher iconography (a fleet view, a settings screen) without
  inventing a fourth undeclared mark.
- The hand-rolled `window.__TAURI_INTERNALS__` mock pattern (this plan's Craft floor review,
  above) as a reusable technique for any future plan that wants real rendered screenshots without
  a live Tauri shell — not committed as project tooling here, but documented as a proven approach.

# Phase 2, Plan 02-04 — The Launch Sheet and `assemble_context_packet`

## What was built

- **`core::context_packet`** (new module, D-28) — `assemble_context_packet(conn, task_id)`, a
  pure `&Connection` read (no `&mut`, no `.transaction()`) that assembles the epic/task/criteria/
  worktree facts a run will use, and `render_prompt(packet, instruction)`, the one place prose is
  produced. Deliberately does NOT reuse `domain::worktree::base_ref_for_task` for a task with no
  worktree yet — that function cuts a real git branch as a side effect via
  `ensure_epic_integration_branch`, which a preview must never do (T-02-21). Instead re-derives the
  identical hypothetical value read-only.
- **`agent_run_preview`** (`commands/agent_run.rs`) — the launch sheet's one read: locks
  `AppState.db`, calls `assemble_context_packet`, projects into `ContextPacketDto` (camelCase,
  mirrors the `TaskDto`/`From` pattern). No insert/update/delete, no event — proven by a row-count
  test. `agent_run_start` now renders its sidecar prompt through the SAME `render_prompt` call
  (one renderer, two call sites, T-02-21), replacing plan 02-01's title+description placeholder,
  and validates a new `instruction: Option<String>` argument (trim, ≤4000 chars).
- **`launch-sheet/LaunchSheet.tsx`** (new, D-27) — a 640px/80vh centred overlay reusing
  `CommandPalette.tsx`'s scrim/`FocusScope`/`DismissableLayer`/portal mechanics rather than a new
  overlay pattern. Renders the preview's structured fields read-only (epic, task, criteria,
  branch/worktree facts in the Mono font stack), a pinned free-text instruction field and a
  permission-mode segmented control (`Accept Edits` default, D-36, one-to-one onto the adapter's
  four values). Enter submits from the body; Enter inserts a newline in the field, `⌘Enter`
  submits from inside it; Escape/Cancel call no start command — nothing is spawned until Start
  Work's own click fires.
- **`state/uiStore.ts`** — `launchSheetTaskId`, a new cross-tree field mirroring `activeAgentRunId`'s
  own precedent, so the sheet (mounted once in `App.tsx`, a peer of `CommandPalette`) can be
  triggered from `ItemDetailPanel.tsx`'s "Start Work" button and the board-list `start-work`
  action id (`w`, `board/BoardView.tsx`) without either importing the sheet component.
  `ItemDetailPanel.tsx`'s button now calls an `onStartWork` callback instead of `startAgentRun`
  directly — the sheet owns the actual start now.

## Review against the direction contract

- **Never a second implementation of the prompt.** `agent_run_preview` and `agent_run_start` both
  call `assemble_context_packet` + `render_prompt`; a unit test
  (`the_previewed_prompt_and_the_started_runs_prompt_come_from_the_same_renderer`) asserts this
  structurally rather than by inspection alone.
- **Mono utility applied inline** (branch name, base ref, worktree path) — this plan's files list
  does not include `styles/type.css`, so the `ui-monospace, "SF Mono", Menlo, Consolas, monospace`
  stack (02-UI-SPEC.md Typography Additions) is applied as a local `fontFamily` override on the
  specific spans that need it, rather than adding a shared `.type-mono` utility class this plan
  did not scope.
- **Never colour alone / 60-30-10:** no new colour token was introduced; the sheet reuses
  `--accent-nontext` for its primary action and selected mode (Phase 1's existing "primary
  interactive emphasis" reservation), `--divider`/`--surface-secondary`/`--text-muted-rack` for
  everything else, and `--destructive-text-rack` (02-03's own token) for the two error backstop
  states. **Fixed a pre-existing hex literal** (`color: "#ffffff"` on the Start Work button,
  02-01's own tracer) while touching this exact line for the callback-prop change — replaced with
  `var(--text-primary-rack)`, closing this plan's own hex-literal verify gate rather than leaving
  it as a second out-of-scope deferral (02-03-SUMMARY.md already logged the same line once).
- **No new mark introduced** — the sheet has no status glyph of its own, so `legend/marks.ts` is
  untouched by this plan (unlike 02-03, which was required to touch it).
- **Loading state:** no dedicated skeleton-row component exists yet anywhere in this codebase
  (02-UI-SPEC.md's own language, "the board's skeleton-row treatment," is aspirational — nothing
  in `board/BoardView.tsx` implements one today). `PreviewSkeleton` inside `LaunchSheet.tsx` is a
  minimal, self-contained equivalent (muted bars, never an empty dialog, never a spinner) scoped to
  this plan's own files rather than retrofitting a shared component this plan did not declare.

## Craft floor review

No live Tauri shell or headless-Chromium screenshot pass was run this session (this executor had
no GUI display available, matching most Phase 1 plans' own precedent, e.g. `01-02` through
`01-10`). `npm --prefix packages/desktop run test`/`run build` and `cargo test -p core`/`-p
desktop` are this plan's actual evidence; the plan's own `<verification>` block's manual step
(press Start Work, read the briefing, cancel, confirm nothing was created) is deferred to
`/gsd-verify-work` per `workflow.human_verify_mode: end-of-phase`, the same pattern 02-01/02-02/
02-03 used for their own manual steps.

## Known Stubs

None that block this plan's own goal. `ContextPacketDto.renderedPrompt` is carried over the wire
but not rendered verbatim in the sheet's body — the UI-SPEC calls for structured sections (epic/
task/criteria/worktree), not a raw prompt dump; the field exists so the Rust-side "one renderer"
invariant is provable end-to-end, and a future plan is free to add a raw-prompt toggle without any
Rust-side change.

## Known deferred surfaces (not stubs — explicit scope boundaries)

- **The board-list `w` keystroke's full reachability** was wired in this plan (`BoardView.tsx`'s
  `start-work` switch case), even though `board/BoardView.tsx` is not in this plan's declared
  `files_modified` — a necessary deviation (Rule 3): without it, `ItemDetailPanel.tsx`'s own
  `onStartWork` callback prop had no caller to supply it, since that component deliberately avoids
  importing `state/uiStore.ts` directly (an established precedent this plan preserved, not
  introduced).
- **`open-live-session` (`l`)** remains unwired, as it was before this plan — 02-08's own stated
  scope, not this plan's.
- **DESIGN.md itself** went unmaintained for plans `01-12` through `01-21` and `02-01` through
  `02-03` despite `01-UI-SPEC.md`'s binding requirement — a pre-existing, cross-plan gap this
  executor did not backfill (out of this plan's own scope), but did not repeat here.

## What the next plan inherits

- `core::context_packet::{ContextPacket, assemble_context_packet, render_prompt}` — Phase 4's
  `ContextAssembler` extends this signature (more inputs: prior summaries, diff-so-far) rather than
  replacing it, per D-28's own "costly reversibility" note.
- `commands/agent_run.rs`'s `ContextPacketDto`/`CriterionDto` — the wire shape any future Settings
  or fleet-view surface reading a task's briefing should reuse rather than re-deriving.
- `state/uiStore.ts`'s `launchSheetTaskId` — the established pattern (mirrors `activeAgentRunId`)
  for any future surface that needs to open an App.tsx-level overlay from deep inside the board
  tree without a store import in the deep component itself.
- `launch-sheet/LaunchSheet.tsx`'s `PreviewSkeleton` as a stopgap until a shared skeleton-row
  component exists — a future plan building one for the board proper should consider migrating
  this local copy to it rather than leaving two independent implementations.

# Phase 3, Plan 03-01 — Worktree Removal and the Refusal That Guards It

## What was built

- `WorktreeRemovalDialog.tsx` (new) reuses `board/DeleteConfirm.tsx`'s exact Radix
  `FocusScope`/`DismissableLayer`/`createPortal` overlay pattern verbatim (same `role="alertdialog"`
  scrim, `--surface-secondary` panel, `--radius-chrome` radius) and its destructive-button
  treatment (`--destructive-strip` background/border, `--text-primary-rack` text) for the Clean
  state's "Remove" button. **No new colour token, no new mark, and no new overlay mechanism** —
  this plan's own `03-UI-SPEC.md` explicitly scopes this dialog to introduce zero new legend marks
  (`legend/marks.ts` is untouched), so `packages/desktop/src/legend/marks.ts` does not appear in
  this plan's `files_modified` at all.
- The Dirty refusal state's single "OK" button reuses the Cancel button's secondary styling, never
  the destructive treatment — matching `DeleteConfirm.tsx`'s own "the safe action, never the
  destructive one, gets `autoFocus`" rule, applied here to the ONLY button the Dirty state renders.

## Review against the direction contract

- **Never colour alone:** the Dirty refusal's porcelain rows distinguish status by printed word
  (`Modified`/`Added`/`Deleted`/`Untracked`/`Changed`), never by colour — the row's status label
  uses the ambient `type-label` role with no colour override at all.
- **60/30/10 unaffected:** the one destructive-red use (the Clean state's "Remove" button) is the
  same button style Phase 1's `DeleteConfirm.tsx` already spends that budget on; this plan adds no
  new claim on it.
- **No new mark introduced** — confirmed above; `legend/marks.ts` is unmodified by this plan.

## Craft floor review

No live Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display
available to this executor, matching most Phase 1/2 plans' own precedent). The Impeccable design
hook ran automatically on every `Write`/`Edit` to `WorktreeRemovalDialog.tsx` and
`WorktreeSummary.tsx` and reported no deterministic design-quality issues. `cargo test --workspace`
and `npm --prefix packages/desktop run test`/`run build` are this plan's actual evidence.

## Known Stubs

None. The dialog's three states (Checking/Clean/Dirty) are all wired to the real
`worktree_remove_check`/`worktree_remove` commands — no mock data path exists anywhere in this
plan's production code.

## What the next plan inherits

- `WorktreeRemovalDialog.tsx`'s `PORCELAIN_STATUS_WORDS`/`PORCELAIN_FALLBACK_WORD` mapping — the
  reference shape for any future surface that needs to render `git status --porcelain` codes as
  human words (this plan's own copy is not extracted to a shared module, since only one surface
  needs it today).
- `remove_worktree_for_task`'s re-read-porcelain-inside-the-domain-function shape (packages/core) —
  the pattern any future destructive git action in this codebase should copy: never trust a
  renderer's earlier check as authorization to proceed.

# Phase 3, Plan 03-09 — The Missing-Worktree Decision Banner (WORK-06, D-45)

## What was built

- `MissingWorktreeBanner` (new, inside `item-detail/WorktreeSummary.tsx`) — an early return in the
  component's existing early-return ladder, inserted between the singleton-violation guard and the
  normal branch/path render. It REPLACES the branch/path line and plan 03-01's Remove Worktree
  action entirely whenever a task's worktree row reads `status === "missing"`; it never renders
  alongside them. The early return itself is the structural guarantee — there is no second guard
  anywhere in the file gating Remove Worktree against a missing row.
- One new legend mark: `worktree-missing` (`TriangleAlert`, agent channel, word "Missing") —
  `--destructive-text-rack` for the glyph, matching the existing `project-unreachable` precedent
  (`ProjectUnreachable.tsx`) for a destructive-toned recovery notice.
- **Zero new colour tokens.** The banner reuses `--destructive-text-rack` for the glyph, the
  ambient `type-label`/`type-body` roles for heading/body, and `--divider`/`--surface-dominant`/
  `--text-primary-rack` (the same trio `WorktreeRemovalDialog.tsx`'s own secondary-button style
  already uses) for both actions.
- **Both actions carry IDENTICAL visual treatment** — same border, background and text colour —
  because `03-UI-SPEC.md` is explicit this is a genuine either/or (Recreate vs. Remove Record), not
  a safe-default/destructive pair. `Remove Record` deliberately does NOT borrow
  `WorktreeRemovalDialog.tsx`'s destructive-fill button: nothing is destroyed on disk by it (the
  row being `missing` is exactly what means there is nothing there to destroy), and destructive
  weight would misreport what the action does.
- A shared `{ acting, error }` banner state (one object for the whole banner, not one per button)
  guards both actions against a second concurrent call. The guard reads a `useRef` rather than
  React state alone — two synchronous clicks in the same tick can both observe stale `state.acting`
  before a re-render flushes the `disabled` attribute to the DOM, so the ref is the actual guard and
  `state.acting` remains only the source of truth for what renders. On rejection the banner stays
  mounted with an inline error; it never unmounts and never clears itself locally — it disappears
  only when `worktree_recreate`/`worktree_forget_record`'s own `board:changed` emit invalidates
  `useWorktreeSummary` and the re-read row's `status` is no longer `"missing"`.

## Review against the direction contract

- **Never colour alone:** the banner's heading carries the literal words "This worktree is missing
  from disk," not a colour change alone; the glyph is paired with a printed legend word ("Missing"),
  matching every other agent-channel mark's own discipline.
- **60/30/10 unaffected:** the one destructive-toned use (the glyph) is the same
  `--destructive-text-rack` token every other recovery surface in this phase already spends that
  budget on; this plan adds no new claim on it and no new hex value anywhere in the file (verified
  by a `<verify>` grep gate with zero matches).
- **One new mark, published before any surface renders it a second way** — `worktree-missing` is
  appended to the existing `"agent"` channel in `legend/marks.ts`, no new `MarkChannel` member.

## Craft floor review

No live Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display
available to this executor, matching plan 03-01's own precedent). The Impeccable detector
(`detect.mjs --json`) was run directly against `WorktreeSummary.tsx` and `legend/marks.ts` and
reported zero findings for both. `cargo build --workspace` and
`npm --prefix packages/desktop run build`/`run test` (full suite, 334/334) are this plan's actual
evidence.

## Known Stubs

None. The banner's two actions are wired to the real `worktree_recreate`/`worktree_forget_record`
commands (plan 03-09 Task 1), which delegate straight to plan 03-03's domain verbs — no mock data
path exists anywhere in this plan's production code.

## What the next plan inherits

- `MissingWorktreeBanner`'s `{ acting, error }` + `useRef` guard shape — the reference pattern for
  any future surface that needs to guard two async actions sharing one row against synchronous
  double-clicks, where React state alone is not a fast-enough guard.
- `WorktreeSummaryDto.status` is now on the wire end to end (Rust `commands/agent_run.rs` through
  `adapters/tauri.ts`) — any future surface reading a task's worktree summary can branch on it
  without a second call.

# Phase 3, Plan 03-10 — The Orphan Recovery Modal and the Abandoned-Run Acknowledgment (PROC-04, PROC-05, D-46, D-49, D-50)

## What was built

- `OrphanRecoveryModal.tsx` (new, `packages/desktop/src/recovery/`) — the blocking launch-time
  overlay. Reuses `board/DeleteConfirm.tsx`'s exact `FocusScope`/`createPortal` overlay shape at a
  wider 560px fixed width (mirroring the launch sheet's own precedent of widening the same base
  pattern for denser content), with **one deliberate divergence**: the dismissable-layer primitive
  is never composed in at all — not mounted with no-op handlers, simply absent — so the modal has
  no Escape binding, no click-outside dismissal and no close button (D-46, T-03-10-01). A source
  gate (`grep -c 'DismissableLayer'` over non-comment lines, verified zero) makes this structural,
  not a convention. It closes itself the instant its own row list becomes empty and never before —
  a Kill All where every kill fails leaves all rows mounted with their own pid-naming failure copy,
  proven by this plan's own criterion-2 honesty test (Task 3).
- Each row's Kill action carries the `{ killing, failed }` local state
  `session/PermissionRequestCard.tsx`'s `RowState` pattern establishes, with the ONE deliberate
  divergence the UI-SPEC calls out: a permission card's failed answer clears back to answerable, a
  failed kill row's failure is PERMANENT — no retry button, only a terminal failure message naming
  the pid, because a process Flywheel could not kill needs a human at a terminal, not a second press
  of the same control.
- The leading glyph on every row reuses the existing `run-running` mark (`Loader`, its `agent-pulse`
  animation gated on `prefers-reduced-motion` exactly as `RunsSection.tsx`'s own badge) with
  different label copy ("Running (from a previous session)") — no new mark for this row, since it is
  genuinely the same "running" fact wearing different context copy.
- Mounted once in `App.tsx`, present across every app-shell branch (boot, first-run, main), self-
  conditioned on a non-empty pending-orphan list — structurally absent from the DOM otherwise.
- `run-abandoned` mark (new, `Unplug` glyph, agent channel) — deliberately a different glyph from
  `run-interrupted`'s `CircleSlash`: an interrupted run was a normal, user-initiated Stop, while an
  abandoned run is the product's own supervision failing to reach a clean end (D-49).
- `RunsSection.tsx`'s `abandoned` row variant renders the badge, one explanatory line (the watchdog
  sentence with the kill record's timestamp interpolated when a record exists and parsed, otherwise
  the honest weaker fallback — never inventing a reason the data does not support), and a single
  Acknowledge button guarded by the SAME `useRef` double-click fix plan 03-09's
  `MissingWorktreeBanner` introduced for the identical bug (React state does not flush the
  `disabled` attribute between two synchronous clicks).
- `agent_run_acknowledge` (new Tauri command) writes `acknowledged_at` through a compile-time-
  literal `UPDATE ... WHERE id = ?1 AND status = 'abandoned'` — no domain function backs it
  (deliberately excluded from this plan's `files_modified`), so acknowledging a non-abandoned run is
  a no-op rather than a state change of any kind.

## Review against the direction contract

- **Never colour alone:** the abandoned badge carries the literal word "Abandoned" plus a distinct
  glyph from every other terminal status; the modal's failure copy names the pid in words, not by a
  colour change.
- **60/30/10 unaffected:** the abandoned badge and the modal's Kill/Kill All buttons all reuse
  `--destructive-strip`/`--destructive-text-rack`, the same destructive-family budget Phase 2's
  "Failed" status and `DeleteConfirm.tsx`'s "Delete" button already spend — this plan adds meaning
  via glyph/word, not a new claim on the palette. Zero new colour tokens; zero raw hex literals
  (verified by this plan's own `<verify>` grep gate).
- **One new mark, published before any surface renders it** — `run-abandoned` is appended to the
  existing `"agent"` channel in `legend/marks.ts` before `RunsSection.tsx` references it.
- **Directory deviation from `03-PATTERNS.md`:** that document names
  `packages/desktop/src/components/OrphanRecoveryModal.tsx`, but no `components/` directory exists
  anywhere in this codebase — every surface lives in a domain-named folder (`board/`, `item-detail/`,
  `session/`, `settings/`, `projects/`, `launch-sheet/`). This plan follows the codebase's own
  convention and creates `packages/desktop/src/recovery/` instead, matching how every prior phase's
  pattern map has been treated as a starting reference, never a literal path contract.

## Craft floor review

No live Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display
available to this executor, matching every prior Phase 3 plan's own precedent). The Impeccable
detector (`detect.mjs --json`) was run directly against `OrphanRecoveryModal.tsx` and
`RunsSection.tsx` and reported zero findings for both. `cargo build --workspace`/`cargo test
--workspace` and `npm --prefix packages/desktop run build`/`run test` (full suite) are this plan's
actual evidence.

## Known Stubs

None. Both surfaces are wired to the real `orphanKill`/`acknowledgeAgentRun` commands — no mock data
path exists anywhere in this plan's production code.

## What the next plan inherits

- `OrphanRecoveryModal.tsx`'s "compose the overlay shape, omit the dismissable-layer primitive
  entirely" pattern — the reference shape for any future surface that must structurally guarantee it
  cannot be dismissed while an unresolved state remains.
- `RunSummaryDto.acknowledgedAt`/`abandonedReason` are now on the wire end to end — any future
  surface reading a task's runs can branch on either without a second call.
- The `packages/desktop/src/recovery/` directory now exists and holds this plan's one component; any
  future recovery-adjacent surface should land here rather than reopening the `components/` question
  `03-PATTERNS.md` raised and this plan declined.

# Phase 3, Plan 03-11 — The Needs Decision Pill and the Rail's Second Badge (WORK-06, PROC-05, D-46)

## What was built

- `recovery_task_ids_for_project`/`recovery_count_for_project`
  (`packages/core/src/query/recovery.rs`) — one `UNION` over `worktrees.status = 'missing'` and
  `agent_runs.status = 'abandoned' AND acknowledged_at IS NULL`, structurally mirroring
  `query::permissions::blocked_task_ids_for_project`/`blocked_count_for_project`. `UNION`, not
  `UNION ALL`, is what de-duplicates a task carrying BOTH conditions to exactly one row — a source
  gate proves the absence of `UNION ALL` the same way the module's own gate proves the absence of
  `format!`. Deliberately does NOT require the abandoned run to be the task's most recent run: a
  clean later run does not retroactively make an earlier, never-acknowledged abandonment seen.
- `board_recovery_summary` (new Tauri command) + `RecoverySummaryDto`, `boardRecoverySummary`
  (adapter) and `useRecoverySummary` (TanStack Query hook) — the same three-layer shape
  `board_blocked_summary`/`BlockedSummaryDto`/`useBlockedSummary` already established. Invalidated
  on `subscribeBoardChanged`, no polling: every command that resolves a recovery item
  (`worktree_recreate`, `worktree_forget_record`, `agent_run_acknowledge`) already emits
  `board:changed`, so the pill clears through the same push-invalidate path the rest of the board
  uses.
- `recovery-needed` mark (new, `TriangleAlert` glyph, agent channel) — deliberately the SAME glyph
  as `worktree-missing`'s banner icon, since the row pill is a rollup of that same underlying fact;
  mirrors `run-blocked`/`blocked-indicator`'s own shared-glyph precedent from Phase 2. Published in
  `legend/marks.ts` before `BoardRow.tsx` references it.
- `BoardRow.tsx`'s Needs Decision pill — trails the Blocked pill (or the status glyph alone) in the
  same no-`field-*`-class structural position that already exempts Blocked from the row's
  progressive-disclosure truncation ladder. Uses `--destructive-strip` for text/border on strip
  material, mirroring the Blocked pill's own `--blocked-text-strip` treatment shape rather than
  inventing a new one. Activating it opens the item detail panel via the same `onOpenDetail`
  destination the Blocked pill already uses.
- `ProjectRail.tsx`'s second count badge — `--destructive-text-rack` background, positioned at the
  OPPOSITE corner (bottom-right) from the existing Blocked badge/Unreachable glyph (both top-right)
  so the two never visually collide when both render on the same entry. Gated on
  `isCurrent && recoveryCount > 0`, exactly like the Blocked badge; a source gate over
  `ProjectRail.tsx` proves no `blockedCount + ` arithmetic combines the two counts.

## Review against the direction contract

- **Never colour alone:** the Needs Decision pill carries the literal words "Needs Decision" plus a
  distinct glyph (`TriangleAlert`) from Blocked's `ShieldAlert`; the rail's second badge is
  distinguished by its printed tooltip and its opposite-corner position, never colour alone.
- **60/30/10 unaffected, zero new colour tokens:** the pill/badge both reuse
  `--destructive-strip`/`--destructive-text-rack`, the same destructive-family budget Phase 2's
  "Failed" status and this phase's `run-abandoned`/`worktree-missing` marks already spend. Zero raw
  hex literals in `BoardRow.tsx` (verified by this plan's own `<verify>` grep gate, unchanged from
  03-09/03-10's identical gate).
- **Three independent distinguishing axes from Blocked** (03-UI-SPEC.md's own requirement): a
  different glyph (`TriangleAlert` vs. `ShieldAlert`), a different printed word ("Needs Decision"
  vs. "Blocked"), and a different colour family (destructive-red vs. blocked-amber).
- **Truncation ladder:** `BoardRow.tsx`'s header comment now names TWO truncation-exempt pills, not
  one — both hold their space and the title truncates instead, per 03-UI-SPEC.md's own rule.
- **Named gap:** the pill's activation opens the item detail panel plainly rather than scrolled to
  the worktree summary or runs section specifically — `03-CONTEXT.md`'s own flagged assumption
  anticipated this: no target-section mechanism exists on the panel yet (`uiStore.ts` carries no
  scroll target field), so Task 2 built the reachable half (open the panel) and named the gap here
  rather than building a scroll mechanism this plan's `files_modified` never scoped.

## Craft floor review

No live Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display
available to this executor, matching every prior Phase 3 plan's own precedent). The Impeccable
detector (`detect.mjs --json`) was run directly against `BoardRow.tsx`, `ProjectRail.tsx` and
`legend/marks.ts` and reported zero findings for all three. `cargo build --workspace`/`cargo test
--workspace` and `npm --prefix packages/desktop run build`/`run test` (full suite) are this plan's
actual evidence.

## Known Stubs

None. Both the pill and the rail badge are wired to the real `board_recovery_summary` read — no
mock data path exists anywhere in this plan's production code.

## What the next plan inherits

- `query::recovery`'s `UNION`-over-two-tables shape is the reference pattern for any future rollup
  that must merge two independent "needs attention" signals into one de-duplicated set without
  double-counting a task that trips both.
- `RecoverySummaryDto`/`useRecoverySummary` are on the wire end to end — any future surface needing
  "does this task have something the user hasn't seen" can read the same summary without a second
  query.
- The item detail panel still has no target-section mechanism — the next surface that needs to open
  it scrolled to a specific section (this plan's own named gap, or any future one) will need to add
  that mechanism once, rather than each caller inventing its own.

# Phase 3, Plan 03-12 — The Destructive-Action Gate Card (AGNT-07, D-55, D-56, D-57, D-58)

## What was built

- `destructive-gate` mark (`OctagonAlert`, agent channel, the tenth entry) — a stop-sign shape,
  categorically different from the `ShieldAlert` shield used everywhere else in this product's
  permission vocabulary. Published in `legend/marks.ts` before `PermissionRequestCard.tsx`
  references it.
- `PermissionRequestCard.tsx`'s `PermissionRequestRow` extends, rather than forks: one component,
  one `useRegionBindings` call, one `answer()` function. A non-null `destructiveCategory` selects:
  - the `destructive-gate` glyph in place of `blocked-indicator`'s shield;
  - a 4px `--destructive-text-rack` left-border stripe (new on this card — the routine variant
    carried no stripe of its own before this plan; see "Judgment calls" below);
  - the heading "Destructive action — needs your OK" above the existing tool-name line;
  - a per-category consequence sentence (`DESTRUCTIVE_CONSEQUENCE`, keyed by
    `DestructiveCategory::as_str()`'s exact strings) rendered in the Body role between the heading
    and the raw payload, with `overflowWrap: "anywhere"` so a long branch name wraps rather than
    truncating;
  - **reversed button emphasis** — Deny takes the filled/primary position (`DeleteConfirm.tsx`'s
    destructive-button styling, its contrast comment reused verbatim), Allow takes the outline/
    secondary position and reads "Allow, just this once";
  - the tertiary allow-always button **conditionally absent** from the JSX tree (never rendered-
    and-disabled) — D-57's "structurally absent," verified by a source gate rejecting any
    `disabled={...destructive...}` pattern.
- `Shift+A` (`answer-permission-allow-always`) is gated inert on the destructive variant inside
  this row's own handler — `state/keyboard.ts` is unchanged (still exactly 3
  `region: "permission-card"` entries), per the UI-SPEC's "same physical bindings, only which
  button each key's action visually occupies differs."

## The branch-name gap (flagged in the plan, resolved here)

Three of the six named categories' consequence sentences interpolate a branch name
(`force-push`, `branch-deletion`, `default-branch-push`), but `permission_requests
.destructive_category` stores only the category string — 03-07's classifier never persists the
matched branch alongside it. Rather than adding new plumbing, the renderer re-parses the SAME raw
command text already shown in the Mono payload block beneath the sentence (`commandTokensFromPayload`
+ `pushDestinationBranch`/`branchDeleteTarget`, mirroring `destructive.rs`'s own positional argv
parsing at display precision only). This parse is **never used for any gating decision** — the
real classification already happened server-side before the card ever mounted — and a branch this
parse cannot resolve falls back to a category-correct sentence that simply omits the name, never
to the fully generic uncategorized sentence. This is the "known cost" the plan's own
`flagged_assumptions` named in advance.

## Fail-closed copy (D-56 applied to text, not just gating)

`DESTRUCTIVE_CONSEQUENCE` covers the six categories `03-UI-SPEC.md`'s own copy table names.
Looking up any OTHER category string — an unrecognised one, or `recursive-delete` (a category the
Rust classifier genuinely produces but the UI-SPEC's own table does not cover) — falls back to the
generic `UNCATEGORIZED_CONSEQUENCE` sentence. The variant selection itself keys off "category is
non-null," never off a known-key match, so an unrecognised category still renders the full strong
treatment (stop sign, reversed emphasis, no allow-always) with an honest generic sentence — it
never falls through to the routine layout.

## Judgment call: the border stripe is new, not swapped

`03-UI-SPEC.md` describes the routine card as already carrying a "4px `--blocked-text-rack`/
`-strip` stripe" that the destructive variant swaps to `--destructive-text-rack`. The shipped
routine card (as of this plan's own `read_first`) carries no such stripe — only the glyph itself
uses `--blocked-text-rack`. Rather than retrofitting a stripe onto the routine card (out of this
plan's declared scope) or silently ignoring the spec's distinguishing axis, this plan adds the
stripe ONLY to the destructive variant — a new visual element for this variant specifically,
satisfying "a different border-stripe colour" as a real, testable distinction without changing the
routine card's established appearance.

## Review against the direction contract

- **Never colour alone:** the destructive variant carries a different glyph (`OctagonAlert` vs.
  `ShieldAlert`), a different heading, a full consequence sentence, and reversed button labels —
  colour is one of five independent signals, never the only one.
- **60/30/10 unaffected, zero new colour tokens:** reuses `--destructive-text-rack` and
  `--destructive-strip`, the same destructive-family budget Phase 2's "Failed" status and this
  phase's `run-abandoned`/`worktree-missing`/`recovery-needed` marks already spend.
- **The load-bearing decision is structural/behavioural, not visual:** the reversed button
  emphasis repurposes approve-by-muscle-memory as the safety mechanism — chosen over a typed
  confirmation and a timed delay, both considered and rejected on the same "rigidity is the
  feature, friction is not" reasoning that already settled D-43's worktree-removal refusal, and a
  timed delay would contradict D-58's "no second timeout mechanism." This decision survives Phase
  10.1's palette re-derivation untouched, since it claims no colour value of its own.
- **Inherited-ratio dependency unchanged:** this plan adds no colour value, so
  `theme/__tests__/contrast.test.ts` is byte-identical to its pre-plan state — re-confirmed passing
  (14/14) after every other change in this plan.

## Craft floor review

The Impeccable detector (`detect.mjs --json`) was run directly against
`PermissionRequestCard.tsx` and `legend/marks.ts` and reported zero findings for both. No live
Tauri shell or headless-Chromium screenshot pass was run this session (no GUI display available to
this executor, matching every prior Phase 3 plan's own precedent) — `npm --prefix packages/desktop
run test` (413/413) and `cargo test --workspace` (0 failed across every suite) are this plan's
actual evidence; final visual confirmation is deferred to `/gsd-verify-work` per
`workflow.human_verify_mode: end-of-phase`.

## Known Stubs

None. The destructive variant reads the real `destructiveCategory` field end to end — no mock data
path exists anywhere in this plan's production code.

## What the next plan inherits

- `DESTRUCTIVE_CONSEQUENCE`'s fallback-to-generic pattern (key not in the record → the honest
  generic sentence, never a silent blank or a routine-layout regression) is the reference shape
  for any future per-category copy table that must fail closed the same way D-56's classifier
  does.
- The branch-name re-parse in the renderer is a duplication of logic that already lives in
  `destructive.rs` — if a future plan needs MORE display-only detail out of a classified command
  (not just the branch), carrying it through `permission_requests` as a structured field rather
  than re-parsing raw command text a second time is the better-scoped fix; not built here since
  this plan's own `files_modified` never scoped a schema change.
- The routine permission-request card still carries no border stripe of its own — if a future
  plan (Phase 10.1's re-derivation, or an earlier fix) wants the routine/destructive distinction to
  read as a swap rather than an addition, that stripe needs to be added to the routine variant
  first.
