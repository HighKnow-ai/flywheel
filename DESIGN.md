---
name: Flywheel
description: An Agentic Development Environment drawn as a production line's visual management, the Andon world.
colors:
  background: "#e6e8ec"
  foreground: "#111318"
  card: "#ffffff"
  primary: "#3c64dd"
  primary-foreground: "#ffffff"
  running: "#2a50c6"
  running-muted: "#e8edfc"
  attention: "#ffd400"
  attention-foreground: "#14120a"
  attention-muted: "#fff7cc"
  destructive: "#d42c1f"
  destructive-foreground: "#ffffff"
  destructive-text: "#b42318"
  secondary: "#f4f5f7"
  muted-foreground: "#525866"
  subtle-foreground: "#676d79"
  accent: "#eef0f3"
  border: "#d9dce1"
  input: "#858b96"
  ring: "#3c64dd"
  sidebar: "#f8f9fa"
  sidebar-primary: "#ffffff"
  sidebar-accent: "#e9ebef"
  strip: "#17191e"
  strip-foreground: "#f2f3f5"
  strip-muted-foreground: "#a4a9b3"
  lamp: "#25282f"
  chart-1: "#111318"
  chart-2: "#7d838f"
  chart-3: "#3c64dd"
  chart-4: "#c3c7ce"
  dark-background: "#0b0c0e"
  dark-foreground: "#eceef1"
  dark-card: "#1a1c20"
  dark-running: "#8ea8ff"
  dark-running-muted: "#19213a"
  dark-attention-muted: "#352d00"
  dark-destructive-text: "#ff8a7f"
  dark-secondary: "#23262b"
  dark-muted-foreground: "#a0a6b1"
  dark-subtle-foreground: "#80868f"
  dark-border: "#2c2f36"
  dark-input: "#6e7480"
  dark-ring: "#8ea8ff"
  dark-sidebar: "#121316"
  dark-sidebar-accent: "#1e2025"
  dark-strip: "#000000"
  dark-strip-muted-foreground: "#9aa0aa"
  dark-lamp: "#1a1c20"
  dark-chart-1: "#eceef1"
  dark-chart-4: "#4a4f58"
typography:
  lead:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "52px"
    lineHeight: 1
    fontFeature: "\"tnum\", \"lnum\""
  count:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "34px"
    lineHeight: 1
    fontFeature: "\"tnum\", \"lnum\""
  milestone:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "26px"
    lineHeight: 1.15
  title:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "24px"
    lineHeight: 1.2
  section:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  row:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.35
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  small:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.4
  meta:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
  condensed-label:
    fontFamily: "Barlow Semi Condensed, Barlow, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.06em"
  code:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-attention:
    backgroundColor: "{colors.attention}"
    textColor: "{colors.attention-foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-secondary-hover:
    backgroundColor: "{colors.accent}"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-ghost-hover:
    backgroundColor: "{colors.accent}"
  button-destructive:
    textColor: "{colors.destructive-text}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "34px"
  button-link:
    textColor: "{colors.running}"
    padding: "0"
  badge-attention:
    backgroundColor: "{colors.attention}"
    textColor: "{colors.attention-foreground}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  badge-running:
    backgroundColor: "{colors.running-muted}"
    textColor: "{colors.running}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  badge-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  badge-neutral:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.foreground}"
    typography: "{typography.small}"
    rounded: "{rounded.full}"
    padding: "0 10px"
    height: "24px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: "16px"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
    height: "34px"
---

# Design System: Flywheel

## Overview

**Creative North Star: "The Andon"**

Kanban came from Toyota's line, and so does the andon: a lamp a station lights when the line needs a person. Flywheel's visual world is that line's visual management, translated to a desktop app that supervises many coding agents at once. A neutral grey floor carries white cards; a graphite strip is the line's hardware; one loud colour, safety yellow, means a person is needed. Every surface is read before it is clicked: the state of the work is on the glass, not behind a hover.

The system is dense and calm. Most of any screen is neutral grey ink on white or near-black cards, and states that need nothing from you stay neutral, told apart by a Lucide icon and a word. Colour is spent only where it changes what you do next: yellow for Waiting on you, brand blue for an agent at work or your next action, red for Stopped or failed. It refuses the category default of a grey list of same-weight rows with one accent colour sprinkled everywhere.

The system is built on shadcn/ui and Tailwind v4: every colour is a CSS custom property under shadcn's variable name in one stylesheet of record, with a light scheme on the root and a dark scheme on `.dark` (set from `prefers-color-scheme`). The tokens, type, icons, primitives and the state badge are built, and every screen of the M2 flow draws on them (#107): the sidebar, the andon strip, the board, the Story view, the session feed and its request cards, Waiting on you, All agents and the dialogs. Settings, Worktrees, first run and the recovery dialog keep their layout in two small legacy stylesheets (`styles/admin-surfaces.css`, `styles/states-and-confirms.css`) that read every value from these tokens; the agent turn's markdown has its own (`session/markdown.css`). The Milestone header (#106) draws the count boxes, the graphite lead box and the stacked bar on the `chart-*` tokens and the `lead`/`count`/`milestone` type steps; the Roadmap strip (#131) sits above it on the same card, pill and row vocabulary.

**Key Characteristics:**
- Four tones, one meaning each: attention, running, destructive, neutral.
- Every state is an icon plus a word plus a tone, drawn by one component.
- Grey floor, white cards, a 1px border edge and a whisper of shadow; in dark the edge carries everything.
- Barlow for reading, Barlow Semi Condensed only for count and group labels, JetBrains Mono for keys, branches and commands.
- One curve for all motion; nothing animates under reduced motion.

## Colors

A neutral grey ramp with three signal hues and one hardware graphite; every token carries exactly one meaning, and contrast is asserted per role by a test, not by this file.

### Primary
- **Brand Blue** (`primary`, the same fill in both schemes): the HighKnow hue, pinned by the product. Filled primary buttons, the Running fill, a lit blue lamp, the checked checkbox, the text selection ground.
- **Running Ink** (`running`; lifted to `dark-running` on dark grounds): Running text and icons, the doing Task, links, the text caret. The pin is on the hue, so on near-black the same hue is lifted until it reads.
- **Running Tint** (`running-muted` / `dark-running-muted`): the Running pill's ground and the selected row.
- **Focus Ring** (`ring` / `dark-ring`): the 2px focus outline at a 2px offset everywhere.

### Secondary
- **Safety Yellow** (`attention`, identical in both schemes) with **Lamp Black** ink (`attention-foreground`): Waiting on you and nothing else. The lit lamp, the Needs-you count, the Waiting-on-you pill, the request card header, the Answer and Allow-once buttons.
- **Yellow Tint** (`attention-muted` / `dark-attention-muted`): the ground of a row or card that needs you.

### Tertiary
- **Signal Red** (`destructive`, identical in both schemes) with white ink: Stopped and failed fills.
- **Red Ink** (`destructive-text` / `dark-destructive-text`): Drop and other destructive text buttons.

### Neutral
- **Floor** (`background` / `dark-background`): the ground the cards sit on.
- **Ink** (`foreground` / `dark-foreground`): body text and the neutral pill's word.
- **Card** (`card` / `dark-card`): cards, panels, popovers and dialogs share one ground.
- **Inset** (`secondary` / `dark-secondary`, also `muted`): neutral pills, the secondary button ground, inset panels.
- **Hover** (`accent`; in dark it equals `dark-secondary`): the hover ground for ghost buttons, menus and rows.
- **Secondary Ink** (`muted-foreground` / `dark-muted-foreground`): secondary text, quiet states (Shaping, Merged, Dropped, Stale).
- **Meta Ink** (`subtle-foreground` / `dark-subtle-foreground`): meta, timestamps, chevrons, placeholders.
- **Edge** (`border` / `dark-border`): card edges, row rules, region edges, scrollbar thumbs.
- **Control Edge** (`input` / `dark-input`): the boundary of inputs, outline buttons, checkboxes and radios, held at 3:1 against the card.
- **Sidebar** (`sidebar`, `sidebar-primary` for the current item as a raised card, `sidebar-accent` for hover; dark siblings).
- **Strip Graphite** (`strip` / `dark-strip`), **Strip Ink** (`strip-foreground`), **Strip Meta** (`strip-muted-foreground`), **Unlit Lamp** (`lamp` / `dark-lamp`): the andon strip's hardware (`shell/AndonStrip.tsx`).
- **Bar Greys** (`chart-1` to `chart-4`): the stacked bar's segments for Merged, In review, Running (the brand fill) and Ready. Drawn by the Milestone header and each Epic's bar.

### Named Rules
**The One Meaning Rule.** Yellow is Waiting on you, blue is an agent at work or your next action, red is Stopped or failed, graphite is the strip. No other hue exists, there is no green, and no signal colour ever doubles as a ground.

**The Four Tones Rule.** Every state maps to exactly one tone: `attention`, `running`, `destructive` or `neutral`. Every neutral state is the same grey and is told apart by its icon and word. A screen never chooses a state colour itself.

**The Measured Floor Rule.** Text roles clear 4.5:1 and non-text roles (focus ring, control edge, lit lamp) clear 3:1 in both schemes; region steps may not shrink below their measured value. A token moves only while its role still passes the contrast test.

## Typography

**Display Font:** Barlow (with system-ui, sans-serif)
**Body Font:** Barlow (with system-ui, sans-serif)
**Label Font:** Barlow Semi Condensed (with Barlow)
**Mono Font:** JetBrains Mono (with ui-monospace, monospace)

**Character:** Barlow descends from the DIN road-sign lettering: plain, legible at a glance, at home on a factory board. All three families are SIL OFL 1.1 and self-hosted through `@fontsource` (Barlow 400, 400 italic, 500, 600, 700; Barlow Semi Condensed 600; JetBrains Mono 400), so a render on one machine matches another.

### Hierarchy
- **Lead** (52px, line-height 1, tabular): the one lead count in the Milestone header. Drawn by the Milestone header.
- **Count** (34px, line-height 1, tabular): count boxes. Drawn by the Milestone header.
- **Milestone** (26px, 1.15): the Milestone name. Drawn by the Milestone header.
- **Title** (24px, 1.2): a Story title.
- **Section** (600, 17px, 1.3): section headings.
- **Row** (15px, 1.35): row titles.
- **Body** (400, 14px, 1.45): body text, rows and buttons; the document default.
- **Small** (13px, 1.4): secondary text and pill words (pills set it at 600).
- **Meta** (500, 12px, 1.35): meta and labels.
- **Condensed Label** (Barlow Semi Condensed 600, uppercase, 0.06em tracking): count labels, strip labels and sidebar group names only.
- **Code** (JetBrains Mono 400): Story keys, branches, paths and commands; also every `code`, `kbd`, `pre` and `samp`.

### Named Rules
**The Tabular Count Rule.** Wherever a numeral counts, it is tabular and lining.

**The Condensed Is Hardware Rule.** The condensed uppercase face labels counts, the strip and sidebar groups. It never sits above a heading as an eyebrow.

## Layout

A desktop window, 900px minimum width. A light sidebar on the left; content to the right on the grey floor. Spacing is a 4px base: 8 inside a group, 12 to 16 between groups, 20 between regions; the space tokens (`xs` to `2xl`) carry it for screens still on inline styles. Rows are 44px, sidebar rows 36px.

The composition: a 72px andon strip across the content top on every screen, then a 56px top bar (Back, the breadcrumb, the ⌘K search and the surface's add or run controls; + Epic beside a filled + Story on the board, the Story view and the session feed), then the surface on the floor, 20px in from the edges, its content in cards up to 1240px wide. The board is the Roadmap strip (one slim row per Milestone), then the header of the Milestone picked on it, the Current one until another is picked (name, Exit test, lead box, count boxes, stacked bar), then the roster of that Milestone: one card per Epic, headed by its own stacked bar and "n of m Stories merged", its Stories as rows. Each Epic appears once. The Story view is a title card, the live agent's station, then Acceptance criteria beside Tasks, then Sessions. Not built yet: Needs you as a 400px column beside the roster, and the Story view beside a 470px roster at content widths of 1280px and up; today the Story view takes the whole content area at every width.

**The click model.** What you click decides where you land, and every place is shown in the breadcrumb:
- A project in the sidebar opens that project's board, replacing whatever was on top.
- A Story row, a sidebar session, a Needs-you card's title or a lamp opens the Story view, never the session.
- Open session / Open feed (labelled, terminal icon) opens that session's feed.
- Answer / Allow once on a Waiting-on-you item opens the feed scrolled to the open request.
- Start and Resume keep you where you are; the row turns Running. Shape, in the heading of an Epic card while the Epic is in Shaping (outline, over the rows' actions), keeps you there too and turns into Open session while its shaping session is live, and into Answer (attention) while that session waits on a Round. Once the Epic has Rounds and no live session, it is Continue shaping (outline, `rotate-ccw`, like Resume), which keeps you where you are and starts a fresh session that picks the open Round up.
- An Epic in Shaping carries its own chevron at the end of its card's heading: it opens the Epic's shaping view (the Epic card beside the Round dock), as Answer does. Neither opens the session.
- Back, Cmd-[ or the Story panel's close returns to the previous place, not "to the board".

**The Clickable Looks Clickable Rule.** Anything that navigates is a bounded object with a trailing chevron-right, an `accent` hover and the focus ring. Inert text never carries a chevron. Buttons carry an icon and a word; links are running ink.

## Elevation & Depth

A hybrid: regions are told apart by three things together, a ground step, the 1px edge, and a faint card shadow. Overlays lift with one larger shadow. No glow anywhere except a lit lamp's bulb, whose glow is its meaning.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 1px 2px rgb(15 20 30 / 0.08)`; dark `0 1px 2px rgb(0 0 0 / 0.5)`): every card, beside its `border` edge.
- **Overlay** (`box-shadow: 0 8px 24px rgb(15 20 30 / 0.16)`; dark `0 8px 24px rgb(0 0 0 / 0.6)`): popovers, dialogs, menus. Behind a dialog, a scrim of `rgb(15 20 30 / 0.4)` (dark `rgb(0 0 0 / 0.5)`).
- **Filled Button Lip** (`box-shadow: 0 1px 0 rgb(0 0 0 / 0.15)`): the primary and attention buttons only.

### Named Rules
**The Mandatory Edge Rule.** In dark the ground step between floor, card, sidebar and strip is small and a shadow cannot be seen on near-black, so every card, the sidebar and the strip draw their 1px `border` edge. The edge always differs from every ground it separates.

## Shapes

Gently rounded and consistent: cards, popovers and dialogs 10px (`lg`), buttons and inputs 8px (`md`), compact buttons 6px (`sm`), checkboxes 4px, pills and badges fully round. Borders are 1px. Two things wear a dashed outline, both meaning "not yet on the record": a Shaping state pill (a dashed control-edge ring on no ground) and a ghost field (a dashed primary edge on the running tint, `shaping/GhostCard.tsx`).

## Components

Primitives are shadcn/ui source, copied into the app and rethemed on these tokens, on Radix: Button, Badge, Card, Sidebar, Breadcrumb, Command, Dialog, AlertDialog, Popover, Tooltip, DropdownMenu, Sheet, Collapsible, Checkbox, RadioGroup, Label, Input, InputGroup, Textarea, ScrollArea, Separator, Skeleton and Kbd. The screens draw Button, Badge (through StateBadge), Sidebar, Breadcrumb, Command, Dialog, AlertDialog, Tooltip, Input, Textarea, Label and Kbd; Card's look (the 10px corner, the edge and the card shadow) is drawn directly on sections, which carry their own headings.

### Buttons
- **Shape:** 8px corners (6px at the extra-small size), 1px transparent border, semibold, icon (16px) and word with a 6px gap.
- **Sizes:** default 34px tall with 14px sides; small 30px; extra-small 24px at meta size; large 40px at row size; square icon sizes to match.
- **Default (primary):** brand blue fill, white word, the filled-button lip. Hover drops to 90% fill.
- **Attention:** safety yellow fill, lamp-black word, the lip. Only on an item that is Waiting on you (Answer, Allow once).
- **Neutral:** ink fill (`foreground`), card-coloured word, the lip. Only Deny leading a Gated action (direction.md rule 2), so approve-by-muscle-memory lands on the safe answer without spending blue or yellow on a refusal.
- **Secondary:** the inset ground, hover to `accent`.
- **Outline:** card ground with the control edge; hover and open darken the edge to ink.
- **Ghost:** no ground; `accent` on hover and while open.
- **Destructive:** red-ink text on no ground, `accent` on hover (Drop). Always confirmed in an AlertDialog.
- **Link:** running ink, no padding, underline on hover.
- **Focus / Disabled:** the 2px ring at a 2px offset; disabled at 50% with no pointer events. Colour transitions take the state duration on the one curve.

**The One Filled Action Rule.** One filled primary per region, brand blue. The only other filled action is attention, on a Waiting-on-you item. On a Gated action, Deny leads as the filled neutral (ink fill) and Allow once is outline.

### Chips (state pills and badges)
- **Style:** 24px tall, fully round, 10px sides, 13px semibold word, 15px icon, 6px gap.
- **Tones:** attention (yellow fill, bold), running (running tint ground, running ink), destructive (red fill, white, bold), neutral (inset ground, ink, a 1px edge). `secondary`, `outline` and `ghost` badges are for counts and kinds that are not states.

### Signature Component: StateBadge
The one place a state picks a colour. It takes a state (Story state, attention state, run status, Check result or Task state) and draws its Lucide icon, its word and its tone from one vocabulary; an unknown value is neutral with the dashed circle and prints itself. Quiet neutral states (Shaping, Merged, Dropped, Interrupted, Not run, Stale, Judged at review) take secondary ink. The `inline` variant drops the ground for sentences and dense cells, except attention and destructive, which keep their fill because yellow and red are only read as fills. There is no way to drop the meaning: hiding the word moves it into the accessible name. A live process may pulse its icon (1.6s, opacity to 0.45), omitted under reduced motion.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** `card`.
- **Shadow Strategy:** the card shadow (see Elevation & Depth).
- **Border:** 1px `border`, mandatory.
- **Internal Padding:** 16px (12px at the small size); the footer sits on a half-inset ground behind a top rule.

### Inputs / Fields
- **Style:** 34px tall, card ground, 1px control edge, 8px corners, 12px sides, body size; textarea grows with content from 64px. Placeholder in meta ink. The caret is running ink.
- **Focus:** the 2px ring at a 2px offset.
- **Error / Disabled:** a red edge with a faint red ring; disabled sits on the inset ground at 50%.

### Agent Station
The live agent on a Story (`board/StoryView.tsx`), under its title card while a session is live. A graphite block with the strip's edge while the agent works; the yellow tint with an attention edge while it waits on you. A 40px bulb (brand fill, the `bot` glyph; attention fill while waiting), the doing Task's title at row size, the state pill with the agent's pace ("Session 2 · 21m · last activity 8s ago"). On the right, Open session (filled primary) or Answer (attention), then Stop (outline; on graphite a light edge and strip ink), which always confirms in an AlertDialog. Below a rule (white at 15% on graphite, `border` on the tint), the live tail: the agent's last four lines (tool calls as feed lines, and its newest turn as one `bot` line when it came among them), the call in flight led by the loader and its running clock. On graphite the tail takes the `dark` scope, so running ink and a failed Check's red use their dark-ground values.

### Roadmap Strip
The project's Roadmap at the top of the board (`board/RoadmapStrip.tsx`, #131): one card headed "Roadmap" with the Milestone count and an outline "+ Milestone", then one 36px row per Milestone in Roadmap order. A row is a move handle (`grip-vertical`, subtle ink), the name at row size (semibold; regular in secondary ink once Done or Dropped), the state pill at meta size, the Exit test on one line in secondary ink ("Exit test not written yet" in meta ink), a `flag` and "Current" on the Current Milestone, and the trailing chevron. The columns are fixed so every row lines up. Clicking a row picks that Milestone for the header and roster below; the picked row takes the running tint across its whole width and a running-ink chevron. A Done or Dropped Milestone has no handle and does not drag: it keeps its place. A row drags natively; while it does, it fades to half and a 2px ring-coloured line marks where it lands (above the target when moving up, below when moving down). The keyboard moves it with the arrow keys on its handle or Alt and an arrow on the row, keeps the focus on the handle, and announces the new position. "+ Milestone" opens an inline one-line field at the foot of the card (Add Milestone filled, Cancel ghost, Escape closes), never a dialog.

The roadmap Round (#133) lives on the same card, never on a screen of its own. With no Round open, the header carries an outline "Revisit roadmap" (`compass`) before "+ Milestone", once the Roadmap has a Milestone, and a quiet small line after the Milestone count naming how the last Round ended: "Roadmap still holds · 2h", "Roadmap Round 2 dismissed" or "Roadmap Round 2 decided". Starting a Round opens nothing: the board stays put. An open Round puts a band under the header, in the Round dock's vocabulary: "Roadmap Round n" bold at row size, the trigger ("Revisit roadmap", "Epic FLY-3 done") in secondary ink, and the status. While the agent reads the Roadmap or files changes the band is the running tint with a pulsing `loader-circle` and running-ink status; while its session waits on the developer's decisions the band is yellow (`hand`, "Waiting on you · 1 of 4 decided") and the whole card takes the request card's 2px attention edge; once no session is live it is the inset band ("No live session: your decisions are kept") with Continue (outline, `rotate-ccw`). Open session (outline) or Continue, then Dismiss (ghost, `circle-minus`), sit at the band's end; Dismiss over undecided changes asks first, inline in the band: "Dismissing rejects the 3 undecided changes." with Dismiss Round (outline) and Keep it. Each proposed change is a ghost row under the Milestone it lands on (a new Milestone at the end of the list), inset 8px in the row: the ghost field's 1px dashed primary edge on the running tint, "Proposed" in running ink behind `circle-dashed`, the change in one line at row size, semibold ("New Epic "Roadmap Rounds" in Milestone "Shaping"", "Retire Milestone "Board and review""), Accept (outline), Amend (ghost, only when the change carries text: a new or amended Milestone, a new Epic) and Reject (ghost) on the right, and the agent's "Why:" line under it. Amend opens labelled one-line fields in place, at a 68ch measure, with Accept edit and Cancel; Reject opens the "Why not? (optional)" field. A rejected change shrinks to the Epic card's struck-through line (`ban`, "Rejected", the change struck, "Your reason: …"). No green anywhere: a decided Round says so in words.

### Round Dock
The Epic's shaping view (`shaping/EpicShapingView.tsx`, #123) is the Stage bar across the top, then the Epic card beside the dock: from 1280px side by side (card 5 parts, dock 7), below that stacked in reading order: the current Round, the Epic card, then the earlier Rounds (a Sheet, as direction.md first planned, would hide the Epic being shaped behind the questions about it). The Epic card is a title card (`layers`, the key in code face, the state pill, the title at title size) over the four spec fields, each a meta-size label with a ghost Edit and its prose at a 68ch measure ("Not written yet" in meta ink); editing opens a textarea in place with Save (outline) and Cancel. The dock (`shaping/RoundDock.tsx`) is one card per Round, newest first. A Round the session is held on wears the request card's frame: the 2px attention edge and the yellow band (`hand`, "Round n", "Waiting on you"); any other Round has the inset band and a 1px edge. Under the note, a bar that stays on screen while the questions scroll carries the region's one filled action, Accept all recommended (`check-check`), the tabular "n of m answered" and a hint. Each open question (`shaping/QuestionCard.tsx`) reads: the ink number chip inline before the question at row size (the title is kept for the folded line, never set above the question as an eyebrow), the grounding line in meta ink behind `file-text`, then the recommended answer already filled in, a running-tint box with a 1px primary edge, "Recommended" in running ink behind a check, the answer semibold and its "Because" line in secondary ink; then Accept (outline) and Answer differently (ghost), which opens a textarea on the recommendation, with the recommendation and its reason kept above it in running ink, Send answer, Cancel and a ⌘↩ hint. A Round outlives its session (#124): an open Round no live session is held on keeps the inset band, never yellow, and the dock still takes every answer; the band reads "No live session: your answers are kept" with Continue shaping (outline) at its end, or, while a fresh session reads the Rounds before its `round_wait` takes this one over, "The agent is reading your answers and picks this Round up". The shaping view's header then carries no control of its own: the band does, and its Epic card's pill names the same attention as the board's. On the board the Epic card's state pill reads Waiting on you (attention) while a live session is held on a Round, and Shaping Round waiting (neutral, `circle-dashed`) while a Round is open with no live session. An answered question folds to one 44px line: a check, a quiet number chip, the title, the answer in secondary ink, whose answer it was ("Recommended" or "Your answer") in meta ink, and Change (ghost) while the Round is open.

The Stage bar (`shaping/StageBar.tsx`, #126) is one card across both columns. Its top line holds the Epic's three Stages in order, joined by short control-edge rules and kept whole on one line (at narrow widths Close Stage drops to its own line rather than a name truncating): a closed Stage behind `circle-check` in secondary ink, the open one as a neutral chip (inset ground, 1px edge, `circle-dot`, semibold ink), one not started behind `circle` in meta ink; then, at the right, Close Stage (`step-forward`). Under a rule, what keeps the Stage open: "Challenge the spec stays open while 3 questions and 2 Proposals are still open:", then the open Round's unanswered questions on one line (`message-circle-question-mark`, "Round 2: 3 questions unanswered" semibold, their titles in secondary ink) and each undecided Proposal on its own (`circle-dashed`, "Proposal undecided · Change the Scope"). While that list has anything in it, Close Stage is an outline at half strength and `aria-disabled` (still in the tab order, so the keyboard reaches it and hears the list, which is its description); once it is empty, the line says nothing is open and what closing starts, and Close Stage becomes the region's one filled primary: the next action. An empty Problem, Scope or Exit test follows in meta ink behind `info`, "Not blocking: …", never yellow. Close Stage confirms in an AlertDialog ("Close Challenge the spec?", Keep it open, then the filled "Close and start Slice into Stories"), because a closed Stage stays closed. A session that could not start is said in the bar's always-mounted status line, with Shape as the way on, and cleared once a session is live. The Epic's last Stage keeps the button disabled with a line saying closing it makes the Stories Ready, which is not built yet. Each Stage numbers its Rounds from 1, so once a Stage closes its Rounds move below the current one, named with their Stage in secondary ink beside the number ("Round 1 · Challenge the spec"), and the dock waits for the new Stage's first Round ("No Round yet in Slice into Stories", naming Continue shaping when no session works the Stage).

A spec change an agent proposes (`shaping/GhostCard.tsx`, #125) is a ghost of the field it would rewrite, drawn under that field's text on the Epic card, never in an inbox: a 1px dashed primary edge on the running tint (the recommended answer's solid edge, made provisional), "Proposed Scope" in running ink behind `circle-dashed`, the agent's whole new text at the field's 68ch measure, its "Why:" line in secondary ink, then Accept (outline), Amend (ghost) and Reject (ghost). Amend opens a textarea on the proposed text with Accept edit (outline), Cancel and a ⌘↩ hint: editing and accepting are one act. Reject opens a one-line "Why not? (optional)" field beside Reject (outline) and Cancel. A rejected spec change is decided, so it loses the dashed edge and shrinks to two plain lines with no ground: `ban`, "Rejected" and the text struck through in secondary ink, then "Your reason: …" in meta ink. Reject always wears `ban`; `x` only ever means Cancel. Amend keeps the agent's "Why:" line above the textarea, and Cancel returns the focus to the button that opened the mode; once decided, the focus lands on the field's Edit. No blue fill and no yellow: a pending Proposal never holds the agent, so it is never Waiting on you.

An ADR offered inside the Round (`QuestionCard.tsx`'s ADR variant, #129) reads like any question (number chip, question, grounding), then the draft beside its bar lines, side by side once the card is 36rem wide (a container query) and stacked below that. The draft is an inset panel (`secondary` ground, 1px edge, 8px corners, top-aligned): a caption of `scroll-text`, "ADR draft" and the path in code face, then the file's text as it will be written, in the reading face with its line breaks kept, scrolling in place past 18rem so the answer stays in reach. Beside it, the four bar lines as a list: each label meta-size semibold in secondary ink ("Hard to reverse", "Surprising", "Losing alternative", "Relates to"), its line at small size in ink ("None" in meta ink), and then, under both, a meta line: "The bar lines are shown beside the ADR, never written into it." The caption's path wraps rather than truncating. The recommended answer keeps the running-tint box and reads "Yes, record it" or "No, don't record it" (never "Drop": that word is a Story's end state). The two answers are the two buttons, Yes (`check`) then No (`ban`), the recommended one outlined and the other ghost, with a hint that Yes attaches the ADR to the Epic and that either answer is final. Each button is named by its visible words and described by the question. Answered, it folds to the 44px line with no Change, and the focus moves to that line: "Yes. Accepted on the Epic:" and the file name in code face, or "No. Not recorded: no ADR is written" in the reading face. Accept all recommended leaves an ADR open, since its Yes decides a Proposal: the bar's hint says so, and once only ADRs are left open the button is off and the hint reads "Only the ADR is left: answer it Yes or No."

The Epic card's ADR and glossary chips (#129) sit in its title block under the Stage line, only when there is one: outline badges at meta size (the term and the file name alike), `scroll-text` and the ADR's file name in code face, or `book-a` and the glossary term. An ADR linked to the Epic has a solid edge. One accepted on the Epic that no Story has written yet has a dashed edge, the ghost's provisional mark, and "· not in the repo yet" (or "· not in GLOSSARY.md yet") in secondary ink. The full path is in the tooltip and in the chip's accessible name.

### Feed Rows
A tool call is one line (`session/FeedRow.tsx`, worded by `session/toolVerbs.ts`): the disclosure chevron, the kind's Lucide icon, a plain verb in a 108px semibold column (Read, Edited, Wrote, Ran, Searched; board tools by their meaning: Added Task, Finished Task, Ran Checks, Handed off, Posted Round, and Resumed Round n for `round_wait`, each of the two reading "Waiting on your answers" while it is held), what it acted on (code face for paths and commands, reading face for Task titles), then the metrics column on the right in meta ink, tabular: lines, `+added −removed`, "done" in ink for a clean command or "exit n" for a failed one, Check results, and the duration. A failed command is neutral ink beside `circle-x`; only a failed Check is red. Search targets are quoted, with the place searched ("“Dropped” in GLOSSARY.md"); a tool Flywheel has no verb for reads "Used" and its name in words. A call in flight reads in the progressive ("Running"), the loader leading its clock in running ink. No raw `mcp__` tool name is printed anywhere outside View raw.

### Navigation
- **Sidebar:** the `sidebar` ground behind a right edge; the current project or Story is a raised `sidebar-primary` card, hover is `sidebar-accent`; group names in the condensed label; session sub-items indent behind a 1px rule.
- **Breadcrumb:** names the project, then the Story, then the session; every crumb but the last goes to its place.
- **Andon strip:** one lamp per live Story session across the top of every screen, in every project: lit yellow (lamp-black ink, the hand) while it is Waiting on you, graphite with a blue bulb while its agent works, graphite with a red bulb while its Story is Stopped. Each lamp names the Story key and title and, below, what it waits on, what it is doing or why it stopped. A shaping session held on a Round lights a lamp of its own among the waiting ones (#124): the Epic's key and title, "Round n · Waiting on you", and a click opens the Epic's shaping view; the same Round counts in the sidebar's Waiting on you and its project's figure, has its own row under the project (the hand, the Epic, "Round n · Waiting on you", opening the Epic), and is listed in the queue, after the requests, in the request card's frame with Answer. Order: Waiting on you (longest first), Running, Stopped. Lamps that do not fit fold into a dashed "+n more" lamp that opens All agents, or Waiting on you when a folded lamp is lit; with none, the strip says "No agent running" and keeps its height. Clicking a lamp opens its Story, never its session; the current Story's lamp carries the strip-ink outline.

### Icons
Lucide (`lucide-react`, ISC), drawn at a 2px stroke: 16px by default, 15px inside pills, 18px in navigation. Every icon sits next to its word and is decorative; an icon alone needs a tooltip and an accessible label. Glyphs are imported by name, never the whole set.

### Motion
One curve, `cubic-bezier(0.16, 1, 0.3, 1)`: 160ms for a state change, 240ms for a lamp lighting. Overlays fade and scale in from 95% on the state duration. The live pulse is the only continuous motion. Under `prefers-reduced-motion` both durations go to zero and every animation and transition stops.

### Browser Surfaces
Selection is brand blue with white text; the caret is running ink; the focus outline is the 2px ring; scrollbars are thin, 8px, with an edge-coloured thumb on a transparent track; color-scheme follows the active scheme.

## Do's and Don'ts

### Do:
- **Do** draw every state through StateBadge: icon, word and one of the four tones.
- **Do** keep every colour a token in the one stylesheet of record, mirrored in the theme tokens and covered by the contrast test in both schemes.
- **Do** tint a row or card that needs you with the yellow tint, and the selected row with the running tint.
- **Do** give every card the 1px edge plus the card shadow; in dark the edge is mandatory.
- **Do** lift the brand hue's text on dark grounds (running ink, ring) rather than changing the brand fill.
- **Do** make anything that navigates a bounded object with a trailing chevron, an accent hover and the focus ring.
- **Do** confirm Drop and Stop in an AlertDialog.

### Don't:
- **Don't** use yellow for anything but Waiting on you, or let blue or red stand for anything beyond their one meaning.
- **Don't** introduce green or any new state hue; a passed Check reads from its icon and word.
- **Don't** let a colour carry meaning alone; every state has an icon and a word.
- **Don't** put more than one filled primary in a region.
- **Don't** glow anything but a lit lamp.
- **Don't** set the condensed uppercase label above a heading as an eyebrow.
- **Don't** draw an icon without its word unless it has a tooltip and an accessible label.
- **Don't** animate when reduced motion is requested.
