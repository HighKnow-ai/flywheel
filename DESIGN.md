---
name: Flywheel
description: An Agentic Development Environment drawn as a production line's visual management, the Andon world.
colors:
  background: "#e6e8ec"
  foreground: "#12151c"
  card: "#ffffff"
  primary: "#3c64dd"
  primary-foreground: "#ffffff"
  running: "#22409c"
  running-muted: "#eef1fd"
  running-border: "#c8d2f7"
  attention: "#ffd400"
  attention-foreground: "#14120a"
  attention-muted: "#fff7cc"
  destructive: "#c0223a"
  destructive-foreground: "#ffffff"
  destructive-text: "#c0223a"
  secondary: "#f4f5f7"
  muted-foreground: "#4a5261"
  subtle-foreground: "#676d79"
  accent: "#eef0f3"
  border: "#cdd2dd"
  input: "#8792a6"
  ring: "#3c64dd"
  sidebar: "#f8f9fa"
  sidebar-primary: "#ffffff"
  sidebar-accent: "#e9ebef"
  sidebar-border: "#e4e7ee"
  strip: "#17191e"
  strip-foreground: "#f2f3f5"
  strip-muted-foreground: "#a4a9b3"
  lamp: "#25282f"
  diff-insert: "#e3f4e7"
  diff-delete: "#fce6e4"
  chart-1: "#12151c"
  chart-2: "#7d838f"
  chart-3: "#3c64dd"
  chart-4: "#c3c7ce"
  dark-background: "#0b0c0e"
  dark-foreground: "#eceef1"
  dark-card: "#1a1c20"
  dark-running: "#7d99ff"
  dark-running-muted: "#19213a"
  dark-running-border: "#2c3a6b"
  dark-attention-muted: "#352d00"
  dark-destructive-text: "#ff6b82"
  dark-secondary: "#23262b"
  dark-muted-foreground: "#a0a6b1"
  dark-subtle-foreground: "#80868f"
  dark-border: "#2c2f36"
  dark-input: "#6e7480"
  dark-ring: "#7d99ff"
  dark-sidebar: "#121316"
  dark-sidebar-accent: "#1e2025"
  dark-strip: "#000000"
  dark-strip-muted-foreground: "#9aa0aa"
  dark-lamp: "#1a1c20"
  dark-diff-insert: "#142a1b"
  dark-diff-delete: "#351816"
  dark-chart-1: "#eceef1"
  dark-chart-4: "#4a4f58"
typography:
  lead:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "52px"
    lineHeight: 1
    fontFeature: "\"tnum\", \"lnum\""
  count:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "34px"
    lineHeight: 1
    fontFeature: "\"tnum\", \"lnum\""
  milestone:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "26px"
    lineHeight: 1.15
  title:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    lineHeight: 1.2
  section:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  row:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    lineHeight: 1.35
  body:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  small:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    lineHeight: 1.4
  meta:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
  condensed-label:
    fontFamily: "Public Sans Variable, ui-sans-serif, system-ui, sans-serif"
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
- Public Sans (HighKnow's face) for reading, its condensed uppercase role only for count and group labels, JetBrains Mono for keys, branches and commands.
- HighKnow's tokens where they fit (ADR 0021): the ink, rules, brand text and error come from `docs/design/highknow-tokens.json`; the grounds, the dark scheme, yellow, graphite, the lamps and the Diff Tints are Flywheel's own.
- One curve for all motion; nothing animates under reduced motion.

## Colors

A neutral grey ramp with three signal hues and one hardware graphite; every token carries exactly one meaning, and contrast is asserted per role by a test, not by this file.

### Primary
- **Brand Blue** (`primary`, the same fill in both schemes): the HighKnow hue, pinned by the product, and the tile of the mark (below). Filled primary buttons, the Running fill, a lit blue lamp, the checked checkbox, the text selection ground.
- **Running Ink** (`running`, HighKnow's brand ink; lifted to `dark-running`, HighKnow's brand lift, on dark grounds): Running text and icons, the doing Task, links, the text caret. The pin is on the hue, so on near-black the same hue is lifted until it reads.
- **Running Tint** (`running-muted`, HighKnow's brand wash / `dark-running-muted`): the Running pill's ground and the selected row.
- **Running Hair** (`running-border`, HighKnow's brand hair / `dark-running-border`): a hairline in the brand hue on a running-tint surface. No consumer yet (#196 added it for the Stories after the design audit).
- **Focus Ring** (`ring` / `dark-ring`): the 2px focus outline at a 2px offset everywhere.

### Secondary
- **Safety Yellow** (`attention`, identical in both schemes) with **Lamp Black** ink (`attention-foreground`): Waiting on you and nothing else. The lit lamp, the Waiting-on-you count, a Needs-you count while one of its items is Waiting on you (an inset count otherwise), the Waiting-on-you pill, the request card header, the Answer and Allow-once buttons.
- **Yellow Tint** (`attention-muted` / `dark-attention-muted`): the ground of a row or card that needs you. On the roster that is every Story row Waiting on you, Stopped or In review (#159), its state pill saying which; in the Needs-you list, where every card needs you, only a card Waiting on you.

### Tertiary
- **Signal Red** (`destructive`, HighKnow's error, identical in both schemes) with white ink: Stopped and failed fills.
- **Red Ink** (`destructive-text`, HighKnow's error / `dark-destructive-text`, HighKnow's dark error): Drop and other destructive text buttons.

### Neutral
- **Floor** (`background` / `dark-background`): the ground the cards sit on.
- **Ink** (`foreground` / `dark-foreground`): body text and the neutral pill's word.
- **Card** (`card` / `dark-card`): cards, panels, popovers and dialogs share one ground.
- **Inset** (`secondary` / `dark-secondary`, also `muted`): neutral pills, the secondary button ground, inset panels.
- **Hover** (`accent`; in dark it equals `dark-secondary`): the hover ground for ghost buttons, menus and rows.
- **Secondary Ink** (`muted-foreground` / `dark-muted-foreground`): secondary text, quiet states (Shaping, Merged, Dropped, Stale).
- **Meta Ink** (`subtle-foreground` / `dark-subtle-foreground`): meta, timestamps, chevrons, placeholders.
- **Edge** (`border`, HighKnow's rule-strong / `dark-border`): card edges, row rules, region edges, scrollbar thumbs.
- **Control Edge** (`input`, HighKnow's rule-control / `dark-input`): the boundary of inputs, outline buttons, checkboxes and radios, held at 3:1 against the card. It measures under 3:1 on the sidebar and the floor, so a control sits on a card.
- **Sidebar** (`sidebar`, `sidebar-primary` for the current item as a raised card, `sidebar-accent` for hover, `sidebar-border` for the rail's edge, HighKnow's rule; dark siblings).
- **Strip Graphite** (`strip` / `dark-strip`), **Strip Ink** (`strip-foreground`), **Strip Meta** (`strip-muted-foreground`), **Unlit Lamp** (`lamp` / `dark-lamp`): the andon strip's hardware (`shell/AndonStrip.tsx`).
- **Bar Greys** (`chart-1` to `chart-4`): the stacked bar's segments for Merged, In review, Running (the brand fill) and Ready. Drawn by the Milestone header and each Epic's bar.
- **Diff Tints** (`diff-insert` / `dark-diff-insert`, `diff-delete` / `dark-diff-delete`): the grounds of a line a diff adds (pale green) and removes (pale red), inside the review card's diff and nowhere else (ADR 0011). Each line also carries its `+` or `−`, so the change never rests on the tint.

### Named Rules
**The One Meaning Rule.** Yellow is Waiting on you, blue is an agent at work or your next action, red is Stopped or failed, graphite is the strip. No other hue exists, there is no green, and no signal colour ever doubles as a ground. The one exception is the Diff Tints (ADR 0011): two pale grounds that mean an added or a removed line inside a diff, never a state, and never drawn outside a diff.

**The Four Tones Rule.** Every state maps to exactly one tone: `attention`, `running`, `destructive` or `neutral`. Every neutral state is the same grey and is told apart by its icon and word. A screen never chooses a state colour itself.

**The Mark Rule.** Wherever Flywheel shows a logo (the rail and first run), it is the HighKnow mark in its real colours: the brand-blue tile with the white glyph, `assets/logo.svg` drawn as an image, the same in both schemes. It is identity, not a state, and no scheme recolours it.

**The Measured Floor Rule.** Text roles clear 4.5:1 and non-text roles (focus ring, control edge, lit lamp) clear 3:1 in both schemes; region steps may not shrink below their measured value. A token moves only while its role still passes the contrast test.

## Typography

**Display Font:** Public Sans Variable (with ui-sans-serif, system-ui, sans-serif)
**Body Font:** Public Sans Variable
**Label Font:** Public Sans Variable, uppercase and tracked
**Mono Font:** JetBrains Mono (with ui-monospace, monospace)

**Character:** Public Sans is HighKnow's face (ADR 0021), a plain workhorse UI sans that carries tabular figures. One family, told apart by size and weight. Both families are SIL OFL 1.1 and self-hosted through `@fontsource` (`@fontsource-variable/public-sans` roman and italic, every weight in one variable file; JetBrains Mono 400), so a render on one machine matches another. Barlow was the face until #196.

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
- **Condensed Label** (Public Sans 600, uppercase, 0.06em tracking): count labels, strip labels and sidebar group names only.
- **Code** (JetBrains Mono 400): Story keys, branches, paths and commands; also every `code`, `kbd`, `pre` and `samp`.

### Named Rules
**The Tabular Count Rule.** Wherever a numeral counts, it is tabular and lining.

**The Condensed Is Hardware Rule.** The condensed uppercase face labels counts, the strip and sidebar groups. It never sits above a heading as an eyebrow.

## Layout

A desktop window, 900px minimum width. A light sidebar on the left; content to the right on the grey floor. Spacing is a 4px base: 8 inside a group, 12 to 16 between groups, 20 between regions; the space tokens (`xs` to `2xl`) carry it for screens still on inline styles. Rows are 44px, sidebar rows 36px.

The composition: a 72px andon strip across the content top on every screen, then a 56px top bar (Back, the breadcrumb, the ⌘K search and the surface's add or run controls; + Epic beside a filled + Story on the board, the Story view and the session feed), then the surface on the floor, 20px in from the edges, its content in cards up to 1240px wide. The board is the Roadmap strip (one slim row per Milestone), then the header of the Milestone picked on it, the Current one until another is picked (name, Exit test, lead box, count boxes, stacked bar), then Needs you (#156) as a 400px column on the left beside the roster of that Milestone: one card per Epic, headed by its own stacked bar and "n of m Stories merged", its Stories as rows. Each Epic appears once. The column needs a window 1280px wide (a board 1032px wide, the sidebar aside), and with it the board's cards may run to 1660px (the column, a 20px gap and the 1240px roster), so the Roadmap strip and the Milestone header span both; below that the roster takes the width and Needs you opens as a Sheet from an outline "Needs you" button in the top bar, before + Epic. The Story view is a title card, the live agent's station, then Acceptance criteria beside Tasks, then Sessions. Not built yet: the Story view beside a 470px roster at content widths of 1280px and up; today the Story view takes the whole content area at every width.

**The click model.** What you click decides where you land, and every place is shown in the breadcrumb:
- A project in the sidebar opens that project's board, replacing whatever was on top.
- A Story row, a sidebar session, a Needs-you card's title or a lamp opens the Story view, never the session.
- Open session / Open feed (labelled, terminal icon) opens that session's feed.
- Answer / Allow once on a Waiting-on-you item opens the feed scrolled to the open request.
- Start and Resume keep you where you are; the row turns Running. Shape, in the heading of an Epic card while the Epic is in Shaping (outline, over the rows' actions), keeps you there too and turns into Open session while its shaping session is live, and into Answer (attention) while that session waits on a Round. Once the Epic has Rounds and no live session, it is Continue shaping (outline, `rotate-ccw`, like Resume), which keeps you where you are and starts a fresh session that picks the open Round up.
- An Epic in Shaping carries its own chevron at the end of its card's heading: it opens the Epic's shaping view (the Epic card beside the Round dock), as Answer does. Neither opens the session.
- A Milestone in Shaping (#132) carries the same control on its Roadmap strip row and beside its state pill in the Milestone header: Shape, Answer, Open session or Continue shaping. Shape there starts the session and opens the Milestone's shaping view, so the Exit test Stage and the dock are on screen when the first Round lands. In the header a chevron after it opens the view at any time.
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

Gently rounded and consistent: cards, popovers and dialogs 10px (`lg`), buttons and inputs 8px (`md`), compact buttons 6px (`sm`), checkboxes 4px, pills and badges fully round. Borders are 1px. Two things wear a dashed outline, both meaning "not yet on the record": a Shaping state pill (a dashed control-edge ring on no ground) and a ghost (a dashed primary edge on the running tint: a ghost field, `shaping/GhostCard.tsx`, a ghost Story column and a pending runs-after bracket, `shaping/StoryColumns.tsx`).

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

### Review Card
An In review Story's review (`review/ReviewCard.tsx`, #155, #157), under the title card in the Story view, where the Acceptance criteria panel stands otherwise (the Tasks panel then takes the full width). A card headed `git-pull-request` "Review" at section size, then the diff in secondary ink (`file-diff`, "14 files · +1286 −212", tabular), and at the header's right end **Re-run Checks** (small outline, `refresh-cw`) whenever any criterion has a Check, with what the last run recorded in meta ink beside it ("Ran 2 Checks at 9f3c2ab: 1 passed, 1 failed."), "Running every Check in the worktree…" behind a spinning `loader-circle` while it runs, and a refusal in red under it; it is held at half strength while a session is live. In the spec's order: the Checks not passing at this commit first, on an inset panel ("1 Check not passing at this commit" semibold), each with its result chip (and Stale), its command (`square-terminal`, code face) and its output tail in a code-face block on the card ground, scrolled to its end, where the failure summary is, and under it each of the handing-off agent's objections to that Check (`message-square-warning`, "Agent objects:" semibold, then the reason; when the agent objected to a command since edited, that command follows in meta ink). A Check objection is shown once, beside the Check's first appearance: in the failing panel, or else under the criterion's Check chip. Then each criterion with a checkbox, its statement semibold, and under it its Check chip and command or the quiet "Judged at review" pill. Ticking is the developer's acceptance. A criterion whose Check passed at this commit and is not accepted yet is pre-ticked as a suggestion only, a ghost tick: its checkbox wears the dashed primary edge on the running tint (Shapes: not yet on the record) with the tick in running ink, while it stays unchecked to assistive tech, and a running-ink meta line behind `circle-dashed` says "Suggested · Check passed at this commit: tick to accept." Then the warnings behind a top rule, when any Task is open or doing: "2 Tasks not done" (`list-todo`) semibold in ink, with a meta line saying they do not hold Merge. Then "3 changed files" semibold and each file of the diff as a bordered disclosure: a header row on the inset ground with a rotating `chevron-right`, the path in the code face, a rename's "from" path, the status word (Modified, Added, Deleted, Renamed, Copied, Type changed) and "+6 −2" in tabular meta. Open, it draws the file's patch with `react-diff-view`, unified, on the card ground in the code face at meta size: each hunk's `@@` header as a muted inset band, muted tabular line numbers, an added line on the Diff Tint for inserts and marked `+`, a removed one on the delete tint and marked `−`. Each patch is read only while its file is open; every file opens by default unless the diff has more than 12 files. A binary file has no chevron and says "Binary file: not shown."; a patch over 512 KB says it is too large to show here. The footer sits on the half-inset ground behind a top rule: on the left what still holds Merge ("Accept 2 more criteria to merge.", a live session, an ADR marked Not an ADR or Wrong decision, uncommitted files), or what Merge will do; on the right the one action. Merge (`git-merge`) is the region's filled primary; while anything holds it, it stays in the tab order at half strength, `aria-disabled` and described by that line. While a Check is not passing, the action is instead an outline "Merge with failing Check…" in red ink, which confirms in an AlertDialog listing those Checks on an inset panel, with Not yet and "Merge with 1 failing Check" in the destructive style, as Stop and Drop confirm. A refused Merge says the core's reason under the action. Before Merge sits Request changes… (outline, `message-square-reply`, #158). It opens a composer in the footer itself, never a dialog: "What should change?" (small, semibold), a meta-ink hint ("One review point per line. The agent adds a Task for each…"), the textarea with the focus, then Cancel (ghost) and Send back to Running (`undo-2`), which takes the region's filled primary while Merge steps aside. Escape cancels and gives the focus back to Request changes; ⌘Enter sends; an empty send says "Write at least one review point." in red ink under the field. When the review has ADR review points (#164), they are listed under the field, "Also sent: 4 ADR review points" in meta ink and each point behind `scroll-text` at small size, as the core will write them; the field may then stay empty. A branch that would conflict with its base branch reads **Rebase needed** before everything else, on the same inset panel as the failing Checks: `git-merge-conflict` and "Rebase needed" semibold, "Merging into the base branch would conflict in 2 files." in secondary ink, a small outline Request rebase… (`undo-2`) at the panel's end, then each conflicting path in the code face. The footer's first line then says "Rebase needed: merging would conflict in 2 files." and Merge is held. Request rebase opens the same composer pre-filled with the core's comment naming the base branch and those paths. Between the failing Checks and the criteria sits the Decisions section (`review/DecisionsSection.tsx`, #161), left out when the Story changes no ADR and no glossary term: "Decisions" semibold with the count in secondary ink ("5 ADR and glossary changes", tabular), then one inset panel whose entries are split by row rules, never cards inside the card. An edited, renamed or deleted ADR and the glossary are one 36px row each: a file icon (`file-pen`, `file-x`, `book-a` for the glossary), the path in code face, what happened ("Edited", "Renamed from …") in secondary ink and the line counts at the end. A new ADR is a block: `scroll-text`, its title semibold, under it its path in code face, "New ADR" and its counts in meta; on the right its decision (#164), a radio group on the card ground with the control edge: Keep (checked by default), Not an ADR and Wrong decision, wrapping to two lines at the minimum width. Keep and Not an ADR are stored on the pick; Wrong decision opens two labelled textareas in place, indented to the title and side by side once the card is wide enough ("What is wrong?", "What should it be?"), with Cancel (ghost) and Record Wrong decision (outline), and stores nothing until Record; a missing answer says "Say both what is wrong and what it should be." in red ink. A stored Not an ADR or Wrong decision adds one small line behind `file-x`: the decision semibold, then in secondary ink "Merge waits. Request changes asks the agent to delete the file…" or "…sends both answers as one review point on the code and the ADR." Each change's flags sit under its path, indented to it: one small line each behind `circle-alert` in ink, the flag semibold ("Wording or supersede?", "Renumber", "Supersession line missing") and what to do in secondary ink, paths in code face. A flag spends no signal colour: it asks the developer to look, it does not hold Merge. Under them, indented to the title, the four bar lines as labelled pairs, two columns once the card is wide enough and one at the minimum width, with a meta line saying where they came from (the hand-off, or shaping, where the ADR was accepted on the Epic); without any, "No bar lines" semibold and a line saying to judge it from the file. Then "Related live ADRs": each a `book-marked` line with its number in code face and its title. On the board, an In review Story's row action is Open review (outline, `git-pull-request`), which opens the Story.

### Make Ready
A Shaping Story whose Epic's shaping is closed (a New Story from execution, #166) is made Ready by the developer: Make Ready (filled primary, small, `circle-check`), the Story's one next action as Start is once it is Ready, so it takes Start's place in the Story view's title card and on its roster row. It keeps you where you are; the row turns Ready and offers Start. The core says whether it is offered (`story_make_ready_offer` in the Story view, `canMakeReady` on the roster's one read): not while the Epic is still being shaped (closing its criteria Stage makes the Story Ready) nor past Shaping. While the Story has no criterion the title card shows it disabled, its refusal as its description and as a line in secondary ink under the state ("Make Ready waits: FLY-13 has no Acceptance criterion yet; …"); the row shows its counts instead.

### Roadmap Strip
The project's Roadmap at the top of the board (`board/RoadmapStrip.tsx`, #131): one card headed "Roadmap" with the Milestone count and an outline "+ Milestone", then one 36px row per Milestone in Roadmap order. A row is a move handle (`grip-vertical`, subtle ink), the name at row size (semibold; regular in secondary ink once Done or Dropped), the state pill at meta size, the Exit test on one line in secondary ink ("Exit test not written yet" in meta ink), a `flag` and "Current" on the Current Milestone, and the trailing chevron. The columns are fixed so every row lines up. Clicking a row picks that Milestone for the header and roster below; the picked row takes the running tint across its whole width and a running-ink chevron. A Done or Dropped Milestone has no handle and does not drag: it keeps its place. A row drags natively; while it does, it fades to half and a 2px ring-coloured line marks where it lands (above the target when moving up, below when moving down). The keyboard moves it with the arrow keys on its handle or Alt and an arrow on the row, keeps the focus on the handle, and announces the new position. "+ Milestone" opens an inline one-line field at the foot of the card (Add Milestone filled, Cancel ghost, Escape closes), never a dialog. While any Milestone is in Shaping (#132), every row ends in a 144px slot after its chevron, outside the row's own button, so the columns still line up; a Milestone in Shaping carries its extra-small shaping control there (Shape outline, Answer attention, Open session or Continue shaping), the rest leave it empty, and so does the picked row, whose Milestone header right below carries the same control. On the strip a refusal to start is the button's tooltip, not a line.

The roadmap Round (#133) lives on the same card, never on a screen of its own. With no Round open, the header carries an outline "Revisit roadmap" (`compass`) before "+ Milestone", once the Roadmap has a Milestone, and a quiet small line after the Milestone count naming how the last Round ended: "Roadmap still holds · 2h", "Roadmap Round 2 dismissed" or "Roadmap Round 2 decided". Starting a Round opens nothing: the board stays put. An open Round puts a band under the header, in the Round dock's vocabulary: "Roadmap Round n" bold at row size, the trigger ("Revisit roadmap", "Epic FLY-3 done") in secondary ink, and the status. While the agent reads the Roadmap or files changes the band is the running tint with a pulsing `loader-circle` and running-ink status; while its session waits on the developer's decisions the band is yellow (`hand`, "Waiting on you · 1 of 4 decided") and the whole card takes the request card's 2px attention edge; once no session is live it is the inset band ("No live session: your decisions are kept") with Continue (outline, `rotate-ccw`). Open session (outline) or Continue, then Dismiss (ghost, `circle-minus`), sit at the band's end; Dismiss over undecided changes asks first, inline in the band: "Dismissing rejects the 3 undecided changes." (announced) with Dismiss Round (outline) and Keep it, which takes the focus. After Revisit roadmap the focus moves to the band's first action; after a dismissal, back to Revisit roadmap. Each proposed change is a ghost row under the Milestone it lands on, in that Milestone's own list of proposed changes (new Milestones in a list after the Roadmap's), inset 8px in the row: the ghost field's 1px dashed primary edge on the running tint, "Proposed" in running ink behind `circle-dashed`, the change in one line at row size, semibold ("New Epic "Roadmap Rounds" in Milestone "Shaping"", "Retire Milestone "Board and review""), then the agent's "Why:" line, then Accept (outline), Amend (ghost, only when the change carries text: a new or amended Milestone, a new Epic) and Reject (ghost), which sit to the right of the change and its why once the row is 40rem wide (a container query) and below them under that. A decision moves the focus to the next undecided change, never onto a Milestone's move handle. Amend opens labelled one-line fields in place, at a 68ch measure, with Accept edit and Cancel; Reject opens the "Why not? (optional)" field. A rejected change shrinks to the Epic card's struck-through line (`ban`, "Rejected", the change struck, "Your reason: …"). No green anywhere: a decided Round says so in words. Wherever Waiting on you shows a held roadmap Round, it reads "Roadmap" with no key and "Round n" (the andon lamp, fleet-wide, names the project: "flywheel Roadmap"); the queue's card wears `circle-dashed` and Decide rather than the question glyph and Answer.

### Since You Last Looked
What changed on the project since the Developer last opened its board (`board/SinceYouLastLooked.tsx`, #167), one card just above the roster. Folded by default to one 44px disclosure row: a chevron that turns down when open, `history`, the count semibold and tabular ("7 events") then "since you last looked" at row size, and on the right in meta ink "over the last 4h 12m". Unfolded, below a rule, one 36px line per event, oldest first: the age right-aligned in meta ink, the kind's Lucide icon in secondary ink (`arrow-right` a state move, `send` a hand-off, `flag` an Epic or Milestone, `file-plus-2` a Proposal filed, `check` and `x` one decided, `messages-square` a Round), the record's key in code face and its title semibold (a Milestone has no key; a roadmap Round reads "Roadmap"), then the core's sentence in secondary ink, a state move naming its states in the glossary's words from StateBadge's vocabulary ("Moved Story from In review to Merged"). Past the newest 200 a meta line says "The newest 200 of n". With nothing new it is one inert line, "Nothing changed since you last looked", with no chevron. Nothing on it needs the Developer, so it spends no signal colour and no row is tinted. Opening the board is the visit; what lands while it is open is seen live on the board and never added.

### Confirm exit test
Confirming an Epic or a Milestone Done is the developer's act, and the click is also the consent to a roadmap Round (#134, `board/ConfirmExitTest.tsx`). It shows on an Epic card's heading, in the slot the shaping control holds, once shaping is closed and every Story is Merged or Dropped (the slot is 152px at least, so every Epic's bar keeps its column); and on a Milestone once every Epic is Done, in the shaping control's place (#132): beside the state pill in the picked Milestone's header, and in the slot at the end of any other Milestone's strip row, the picked row's slot left empty because its header carries it. Confirm exit test (`circle-check-big`) is the region's filled primary on the card and the header, the next action, and an outline at the extra-small size in a strip row. It opens an AlertDialog, 32rem wide: "Confirm the exit test of Rounds?" (the record as its card heads it), the exit test quoted in an inset panel captioned "Exit test · FLY-3", what Done means in secondary ink ("A Done Epic stays done"), then, in ink because it is what the click consents to, the Round it starts in the words of its packet ("Confirming also starts a short roadmap Round on "Shaping": an agent asks whether its exit test is still reachable, and whether an Epic is missing or one to drop"), or, with a Round already open, that the trigger is noted on it instead. The footer reads Not met: reopen shaping (ghost, `undo-2`, set apart at its start: Decline, the other answer, never offered on a Milestone still in Shaping), then Not yet, then the filled Confirm Done (`check`). Either answer removes the control, so what follows is said once by the board (`ConfirmExitTestOutcome`): a polite announcement ("FLY-3 Rounds is Done. Roadmap Round 2 started, on the Roadmap strip.", "Shaping reopened on FLY-3 Rounds."); the keyboard moves, without scrolling the board, to the Round's band after a confirmation and to Shape (or the Milestone's row) after a decline. A session that could not start opens a dialog of its own, "Rounds is Done", with the reason in code face and Continue on the strip as the way on. A Done confirmed while a Round is open adds a line to that Round's band (`list-plus`, "Also noted: Epic FLY-4 done." semibold, then "The Round's next session reads it." in the band's secondary ink).

### Adding and Moving Records
Creating an Epic or a Story and moving a Story between Epics each have a control where the record goes (#168, `board/AddRecordControls.tsx`, `board/MoveToEpic.tsx`), beside the top bar's + Epic and filled + Story, which stay for a record whose place is not on screen. An open Epic's card heading carries a ghost small "+ Story" before its action slot, so the slot keeps its column; it opens Write a Story with that Epic and its Milestone already chosen. An open Milestone's header carries an outline small "+ Epic" after its state pill and shaping control; it opens Add an Epic on that Milestone. Neither shows on a Done or Dropped record. An open Story's title card carries an outline "Move to Epic…" (`arrow-right-left`, a trailing chevron-down) before Drop: a menu of the project's other open Epics under their Milestone names (condensed meta captions, separated by a rule), each Epic its key in code face at meta size and its title. Picking one moves the Story at once, with no confirmation: nothing is lost, and moving it back is the same act. A refusal is said in the title card, as Start's is.

### Roster
The Milestone's Epics, one card each, its Stories as rows (`board/StoryBoard.tsx`, #107, #116, #159). An Epic's card is headed by its title at section size, its state pill (or its attention), its stacked bar and "n of m Stories merged"; an Epic in Shaping adds a shaping marker under its title in secondary ink at meta size: `messages-square` and where its shaping has got to ("Stage 2 of 3, Slice into Stories · Round 3 · 2 of 5 answered", "· Round 1 answered", "· no Round yet", or "Not shaped yet"), truncated with the whole line in its tooltip. A Story row is a 152px state column (the state pill, or the attention pill in its place), then the key in code face and the title at row size, semibold (regular in secondary ink once Merged or Dropped), and under them one meta line in meta ink: "Stopped: usage limit" in red ink and "· was doing …", or "Doing: …" (the *doing* Task), or for an In review row `file-diff` and its diff in secondary ink, tabular ("+1286 −212 · 14 files"), or "Dropped: kept readable, no worktree". At the right, the row's one next action (Answer, Resume, Open session, Start, Make Ready, Open review), or, where it has none, "criteria x/y · tasks x/y" in secondary ink at meta size, tabular: criteria accepted or whose Check passed at the head last handed off, out of all; Tasks done, out of all but the Dropped ones. Then the chevron. A row Waiting on you, Stopped or In review is tinted yellow, the word in its pill saying which; the row you are on takes the running tint otherwise. Every figure on a row comes from the core's one roster read (`roster_rows`): a row reads nothing of its own.

### Needs you
Everything in the project waiting on the developer (`board/NeedsYou.tsx`, #156), in the core's rank (`needs_you_list`, spec §2): Gated actions, permission requests and questions mixed by age, then Stopped, then Review and judged-on changes mixed by age, then Confirm exit test, then Proposals, then Shaping Rounds waiting, oldest first within each. Nothing is reordered by hand. A heading on the floor (`bell-ring`, "Needs you" at section size, the count) over one card per item, 10px apart; the column sticks to the top of the board while the roster scrolls, and scrolls its own list past the window's height. Each card, 16px in, reads top to bottom: the lead line (the item's attention as a StateBadge at meta size, then the kind's icon and word in secondary ink where the pill does not already say it: "Gated action", "Permission request", "Question", "Missing worktree"; a Confirm exit test wears an outline kind badge, `circle-check-big`), its age on the right in meta ink, tabular; the record as a bounded button (an Epic's `layers` or a Milestone's `flag`, the key in code face, the title at row size, semibold, two lines at most, the trailing chevron, an `accent` hover) opening the Story, the Epic or the Milestone; the one-line detail in secondary ink ("Stopped: usage limit · was doing …", "Handed off: its diff and criteria wait for your review", the exit test on two lines, "Round 2 · 1 of 4 answered", "Round 2 · No live session: your answers are kept"); then its action. A Gated action or permission request has no detail line: under a rule in the card's attention edge sits its permission-request card without its own yellow header (`RequestHeaderless`, since the lead line already names the kind): the header's note as a meta line ("No rule can cover it"), the `pre` with the literal command, and Deny leading on a Gated action. A question's detail is its first question; Answer (attention, `aria-expanded`) unfolds its form in place, so one question never fills the column. No key answers a request from here. When an action done here takes its card off the list, a polite live region says so ("FLY-2 off the list. 6 items need you.") and the keyboard lands on the record of the card now in its place. Yellow is Waiting on you only: a request's card and a Round a live session is held on wear the 2px attention edge with the yellow tint behind the lead, record and detail; a Stopped Story wears the red Stopped pill on a plain card; Review, Confirm exit test, Proposals and a Round no session works are plain cards with neutral pills. The Proposals running Stories filed are one card however many there are (#162): an outline kind badge (`lightbulb`, "Proposals"), the age of the oldest, then "4 from 3 Stories" at row size, semibold and inert (it opens nothing itself, so no chevron), "On 1 Epic and the Roadmap" in secondary ink, and Triage (outline, `list-checks`), which opens the triage drawer. The actions are the controls every other place offers: Resume (its dialog), Recreate worktree (`box`), Open review (outline, opens the Story view), Confirm exit test (the same AlertDialog as the Epic card); of Resume, Recreate worktree and Confirm exit test only the first in the list is filled, the region's one filled primary, and the others are outlines; Answer (attention, opens the shaping view; Decide for a roadmap Round, which moves the keyboard to the Round's band on the strip), Continue shaping (outline; Continue for a roadmap Round). A Review item whose branch would conflict (#158) adds `git-merge-conflict` and "Rebase needed" in secondary ink after its In review pill, and its detail names the paths ("Merging would conflict in README.md: request a rebase from its review"); its action stays Open review, where Request rebase is. With nothing in it, one card says "Nothing needs you" and what would show. Below the 1280px window the same list sits in a 440px Sheet from the right, on the floor ground under a card-coloured header (title, count, "Most urgent first. Every action works here."). The sidebar's figure for each project is the length of the same list, read under the same key.

A judged-on change (`board/JudgedOnChange.tsx`, #163), an Amend criterion or a Story session's Amend Epic spec, is a plain card whose lead is an outline kind badge (`scale`, "Amend criterion" or "Amend Epic spec") and whose record is the criterion's Story or the Epic. Under it, on an inset panel (`muted` ground, `border` edge), the change as a before and after, labelled in meta ink with what it rewrites ("Criterion", or the spec field: "Scope"): the text the board holds now behind `minus`, struck through in secondary ink ("Empty" in subtle ink when there is none), then the proposed text behind `plus` in running ink, in ink on the running tint inside the 1px dashed primary edge, the ghost card's shape for what is not on the record yet. An Amend criterion that proposes a new Check command adds the Check's before and after the same way, under `square-terminal`, in the code face. Then one line in ink says what accepting does ("Accepting clears its acceptance and marks its Check's last run stale", "… the new Check reads not run", "Accepting reaches every Story of the Epic from its next session"), the agent's "Why:" and "Evidence:" (code face) in secondary ink, and "Filed by FLY-5's session" in meta ink. Accept (outline), Edit (ghost, `pen-line`) and Reject (ghost, `ban`) close the card: the shared ProposalDecision of the ghost card and the triage drawer, its edit control worded Edit as spec §5 names it; no fill and no yellow, since a Proposal never holds its agent. Edit swaps the diff for the proposed text in a textarea ("Your criterion", or "Your Scope") and, for a criterion, an "Its Check command" field in the code face (blank keeps the Check), under the why, with Accept edit (outline), Cancel and the ⌘↩ hint; Reject opens the one-line "Why not? (optional)" field. Cancel returns the keyboard to the button that opened the mode; once decided, the card leaves the list as any other does.

### Triage Drawer
The Proposals running Stories filed (`proposals/ProposalDrawer.tsx`, #162), in a 560px Sheet from the right on the floor ground, under a card-coloured header: `lightbulb` "Triage Proposals" at section size with the count, then "Filed by running Stories, grouped by where each lands. Deciding never pauses an agent." Triage on the Needs-you row opens it at the top; an Epic row's "n Proposals" (ghost, small, `lightbulb`, tabular, between the Epic's bar and + Story, only while it has any) opens it with that Epic's group heading in view and holding the keyboard. The groups follow the core's order (`proposal_list_for_triage`): each Epic in Roadmap order, headed on the floor by `layers`, its key in code face and its title at row size, semibold, with the group's count in meta ink at the right; then "Roadmap · after this Milestone" (`compass`) for New Epics. Each Proposal is a card, 16px in: the kind as an outline badge with its icon (New Story `file-plus-2`, Reorder `arrow-up-down`, Retire Story `circle-minus`, New Epic `layers`) and its age on the right in meta ink; what it names at row size, semibold (a Reorder or Retire leads with the Story's key in code face); the change in secondary ink (a New Story's description, a New Epic's problem, each four lines at most, then where it is created in meta ink: "Created in Shaping, at the end of the Epic's order", "Created in Shaping, in Milestone "Board and review""), a Reorder's as a before and after on an inset panel ("Now" over the struck `after FLY-6` in secondary ink, "Proposed" in running ink over `after FLY-5` in ink, semibold, both in code face), a Retire's "Drops it before it starts."; a duplicate (#165) carries, right under what it names, an inset panel in secondary ink behind `copy`: "Duplicate of "…"" in ink, semibold, then ", filed by" the original's Story key in code face and "Accepting that one closes this one." (neutral like the rest of the card: a duplicate holds no agent, so it gets no signal hue); then "Why: …" in ink; the evidence in code face at meta size behind `scan-search`; "Filed by" the Story's key and title in meta ink; a New Story's card then lists the criteria it carries (#166) under "n Acceptance criteria" in secondary ink at meta size, semibold: each statement at small size behind a `circle-check` in subtle ink, its Check under it in code face at meta size behind `square-terminal`, or "Judged at review" in subtle ink, and its created line ends "; you make it Ready"; then the shaping ghost's own controls (`ProposalDecision` in `shaping/GhostCard.tsx`): Accept (outline), Amend (ghost, only where there is text to edit: a New Story's title and description, a New Epic's title and problem, as labelled fields with the why kept above them, Accept edit and Cancel, ⌘↩), Reject (ghost, the "Why not? (optional)" field). No card is tinted and no action is filled: nothing in it holds an agent. A decided card leaves the drawer; the keyboard lands on Accept of the card now in its place (or on "Nothing to triage" once none is left) and a polite live region says "Decided. 3 Proposals left to triage." A judged-on change (an amended criterion or Epic spec) is not in the drawer: it is its own Needs-you item (#163).

### Round Dock
The Epic's shaping view (`shaping/EpicShapingView.tsx`, #123) is the Stage bar across the top, then the Epic card beside the dock: from 1280px side by side (card 5 parts, dock 7), below that stacked in reading order: the current Round, the Epic card, then the earlier Rounds (a Sheet, as direction.md first planned, would hide the Epic being shaped behind the questions about it). The Epic card is a title card (`layers`, the key in code face, the state pill, the title at title size) over the four spec fields, each a meta-size label with a ghost Edit and its prose at a 68ch measure ("Not written yet" in meta ink); editing opens a textarea in place with Save (outline) and Cancel. The dock (`shaping/RoundDock.tsx`) is one card per Round, newest first. A Round the session is held on wears the request card's frame: the 2px attention edge and the yellow band (`hand`, "Round n", "Waiting on you"); any other Round has the inset band and a 1px edge. Under the note, a bar that stays on screen while the questions scroll carries the region's one filled action, Accept all recommended (`check-check`), the tabular "n of m answered" and a hint. Each open question (`shaping/QuestionCard.tsx`) reads: the ink number chip inline before the question at row size (the title is kept for the folded line, never set above the question as an eyebrow), the grounding line in meta ink behind `file-text`, then the recommended answer already filled in, a running-tint box with a 1px primary edge, "Recommended" in running ink behind a check, the answer semibold and its "Because" line in secondary ink; then Accept (outline) and Answer differently (ghost), which opens a textarea on the recommendation, with the recommendation and its reason kept above it in running ink, Send answer, Cancel and a ⌘↩ hint. A Round outlives its session (#124): an open Round no live session is held on keeps the inset band, never yellow, and the dock still takes every answer; the band reads "No live session: your answers are kept" with Continue shaping (outline) at its end, or, while a fresh session reads the Rounds before its `round_wait` takes this one over, "The agent is reading your answers and picks this Round up". The shaping view's header then carries no control of its own: the band does, and its Epic card's pill names the same attention as the board's. On the board the Epic card's state pill reads Waiting on you (attention) while a live session is held on a Round, and Shaping Round waiting (neutral, `circle-dashed`) while a Round is open with no live session. An answered question folds to one 44px line: a check, a quiet number chip, the title, the answer in secondary ink, whose answer it was ("Recommended" or "Your answer") in meta ink, and Change (ghost) while the Round is open.

The Stage bar (`shaping/StageBar.tsx`, #126) is one card across both columns. Its top line holds the Epic's three Stages in order, joined by short control-edge rules and kept whole on one line (at narrow widths Close Stage drops to its own line rather than a name truncating): a closed Stage behind `circle-check` in secondary ink, the open one as a neutral chip (inset ground, 1px edge, `circle-dot`, semibold ink), one not started behind `circle` in meta ink; then, at the right, Close Stage (`step-forward`). Under a rule, what keeps the Stage open: "Challenge the spec stays open while 3 questions and 2 Proposals are still open:", then the open Round's unanswered questions on one line (`message-circle-question-mark`, "Round 2: 3 questions unanswered" semibold, their titles in secondary ink) and each undecided Proposal on its own (`circle-dashed`, "Proposal undecided · Change the Scope"). While that list has anything in it, Close Stage is an outline at half strength and `aria-disabled` (still in the tab order, so the keyboard reaches it and hears the list, which is its description); once it is empty, the line says nothing is open and what closing starts, and Close Stage becomes the region's one filled primary: the next action. An empty Problem, Scope or Exit test follows in meta ink behind `info`, "Not blocking: …", never yellow. Close Stage confirms in an AlertDialog ("Close Challenge the spec?", Keep it open, then the filled "Close and start Slice into Stories"), because a closed Stage stays closed. A session that could not start is said in the bar's always-mounted status line, with Shape as the way on, and cleared once a session is live. The Epic's last Stage, Write the Acceptance criteria (#128), also lists each Story still in Shaping with no criterion on its own line (`list-checks`, the key in code face, the title semibold, "· no criterion yet" in secondary ink), and the lead sentence counts them ("… while 2 Proposals are still open and 1 Story has no criterion:"). A Story with an undecided criterion Proposal is named once, through that Proposal ("… to FLY-10"), never again as a Story with no criterion, so one decision never reads as two blockers; a rejection brings it back. An Epic with no Story left says "… while the Epic has no Story to make Ready." Once nothing is open its line reads "Nothing in Write the Acceptance criteria is open. It is the Epic's last Stage: closing it settles its answers and makes the Epic and its Stories Ready, each with its criteria and Checks", Close Stage is filled, and the dialog's filled action is "Close and make the Epic Ready". The close starts no session; the status line says "Write the Acceptance criteria is closed: the Epic and its 3 Stories are Ready.", with every Stage closed the bar keeps one secondary line under its steps, "Every Stage is closed: shaping is done.", and the dock waits for no Round: its "No Round yet" card is gone. Each Stage numbers its Rounds from 1, so once a Stage closes its Rounds move below the current one, named with their Stage in secondary ink beside the number ("Round 1 · Challenge the spec"), and the dock waits for the new Stage's first Round ("No Round yet in Slice into Stories", naming Continue shaping when no session works the Stage).

A spec change an agent proposes (`shaping/GhostCard.tsx`, #125) is a ghost of the field it would rewrite, drawn under that field's text on the Epic card, never in an inbox: a 1px dashed primary edge on the running tint (the recommended answer's solid edge, made provisional), "Proposed Scope" in running ink behind `circle-dashed`, the agent's whole new text at the field's 68ch measure, its "Why:" line in secondary ink, then Accept (outline), Amend (ghost) and Reject (ghost). Amend opens a textarea on the proposed text with Accept edit (outline), Cancel and a ⌘↩ hint: editing and accepting are one act. Reject opens a one-line "Why not? (optional)" field beside Reject (outline) and Cancel. A rejected spec change is decided, so it loses the dashed edge and shrinks to two plain lines with no ground: `ban`, "Rejected" and the text struck through in secondary ink, then "Your reason: …" in meta ink. Reject always wears `ban`; `x` only ever means Cancel. Amend keeps the agent's "Why:" line above the textarea, and Cancel returns the focus to the button that opened the mode; once decided, the focus lands on the field's Edit. No blue fill and no yellow: a pending Proposal never holds the agent, so it is never Waiting on you.

An ADR offered inside the Round (`QuestionCard.tsx`'s ADR variant, #129) reads like any question (number chip, question, grounding), then the draft beside its bar lines, side by side once the card is 36rem wide (a container query) and stacked below that. The draft is an inset panel (`secondary` ground, 1px edge, 8px corners, top-aligned): a caption of `scroll-text`, "ADR draft" and the path in code face, then the file's text as it will be written, in the reading face with its line breaks kept, scrolling in place past 18rem so the answer stays in reach. Beside it, the four bar lines as a list: each label meta-size semibold in secondary ink ("Hard to reverse", "Surprising", "Losing alternative", "Relates to"), its line at small size in ink ("None" in meta ink), and then, under both, a meta line: "The bar lines are shown beside the ADR, never written into it." The caption's path wraps rather than truncating. The recommended answer keeps the running-tint box and reads "Yes, record it" or "No, don't record it" (never "Drop": that word is a Story's end state). The two answers are the two buttons, Yes (`check`) then No (`ban`), the recommended one outlined and the other ghost, with a hint that Yes attaches the ADR to the Epic and that either answer is final. Each button is named by its visible words and described by the question. Answered, it folds to the 44px line with no Change, and the focus moves to that line: "Yes. Accepted on the Epic:" and the file name in code face, or "No. Not recorded: no ADR is written" in the reading face. Accept all recommended leaves an ADR open, since its Yes decides a Proposal: the bar's hint says so, and once only ADRs are left open the button is off and the hint reads "Only the ADR is left: answer it Yes or No."

The Epic card's ADR and glossary chips (#129) sit in its title block under the Stage line, only when there is one: outline badges at meta size (the term and the file name alike), `scroll-text` and the ADR's file name in code face, or `book-a` and the glossary term. An ADR linked to the Epic has a solid edge. One accepted on the Epic that no Story has written yet has a dashed edge, the ghost's provisional mark, and "· not in the repo yet" (or "· not in GLOSSARY.md yet") in secondary ink. The full path is in the tooltip and in the chip's accessible name.

A Milestone's shaping view (`shaping/MilestoneShapingView.tsx`, #132) is the Epic's view for its one Stage, Exit test. The Stage bar is the one-step variant: the single Exit test chip, the open list, the Stage named as a Stage throughout ("The Exit test Stage stays open while…", "Close the Exit test Stage?") so it never reads as the exit test itself, and once nothing is open the line "Nothing in the Exit test Stage is open. It is the Milestone's only Stage: closing it settles its answers and makes the Milestone Ready", Close Stage filled, confirmed with "Close and make it Ready"; afterwards the bar's status line says "The Exit test Stage is closed: the Milestone is Ready.", and the dock, as the Epic's does once every Stage is closed, waits for no Round: its "No Round yet" card is gone. The breadcrumb names the Milestone by its title, as its lamp does. The Milestone card replaces the Epic card: `flag`, "Milestone 2 of 5" (its place on the Roadmap, tabular), the state pill (attention in its place while a Round waits, read by the same hook as the board's Milestone header, so the two agree) and "Current" when it is, a ghost Edit at the row's end, the title at title size, then the exit test as the one field, a meta-size label with its own ghost Edit and its prose at a 68ch measure ("Not written yet" in meta ink). Both are the developer's to edit by hand (#149), as the Epic card's spec fields are: Edit on the title opens a one-line field at title size in place of the heading, Enter saving it; Edit on the exit test opens a textarea at the 68ch measure; each has Save (outline) and Cancel (ghost), Escape cancels, and the focus returns to the Edit that opened it. A blank title is refused in place ("A Milestone needs a title"); a blank exit test clears it. A Done or Dropped Milestone offers no Edit. An agent's `propose_exit_test` is the ghost under the exit test ("Proposed Exit test"), decided the same way, a rejected one struck through; a pending ghost stays under the textarea while the exit test is edited, and is still to decide after the save. Under a rule, "Around it on the Roadmap": the Milestone before (`arrow-up`) and after (`arrow-down`) it, each its name semibold, its state in secondary ink and its exit test at small size, because the exit test must be told apart from theirs. Once a ghost is decided the focus lands on the exit test's Edit, or on the exit test itself when the Milestone offers no Edit. The dock is the same `RoundDock`, with the Milestone's own Continue shaping on the band.
### Story Columns
Slicing an Epic (`shaping/StoryColumns.tsx`, #127) hangs its Stories off the Epic card: under the Epic card and the current Round, across both columns, before the earlier Rounds, shown once the Epic has a Story or a Story Proposal or its Slice Stage has opened. A section heading on the floor (`columns-3`, "Stories" at section size, then "3 Stories · 2 proposed · in execution order, left to right" in meta ink, tabular) heads a row of 17.5rem columns that scrolls sideways when it is wider than the content. While any column is past an edge, an outline button at the heading's end for each such side says so and scrolls that way ("‹ 1 earlier", "2 more · 2 to decide ›"), and on opening the strip scrolls the first pending Proposal into view; the columns sit on the floor, never inside a card, because each is a card of its own. A Story column is a card: the ink order chip (the question card's number chip), the key in code face, the state pill at meta size on the right, the title at row size and the description in secondary ink, cut at six lines with the whole text in the tooltip. A Dropped Story leaves the order. A pending New Story is a ghost column standing where it would land: the ghost field's dashed primary edge on the running tint, a dashed order chip, `circle-dashed` "Proposed Story" in running ink, its title and its whole description in ink, then Accept (outline), Amend (ghost) and Reject (ghost) on one line. Amend opens its title (a field that grows to the whole title, Enter never breaking it), description and, when it runs after another, "Why it runs after …" in place, with Accept edit, Cancel and the ⌘↩ hint; its place and what it runs after are not editable. A pending move or retirement sits at the foot of its Story's column as a dashed plate (`arrow-right-left` "Proposed move" or `circle-slash` "Proposed retirement" in running ink), saying where the Story would land, naming that place as the columns do ("Moves after FLY-12 Feed row", or a pending Story's dashed order chip and its title on one line) or that it would be dropped, the agent's "Why:" line, then Accept (outline) and Reject (ghost). A runs-after constraint is a bracket above the columns, its feet running down to the two columns it links, the arrow just left of the waiting Story's centre and the start just right of the other's, so a Story that waits and is waited on carries two feet. Its label sits over the arrow's end, so it reads as a sentence about the Story under it, on a floor-coloured knockout that the feet of the brackets above pass behind: its two ends named as the columns name them (the key in code face, or a pending Story's dashed order chip), "runs after" semibold, then the one-line reason in secondary ink. A bracket is solid in control-edge grey between two Stories, and dashed primary with running ink when either end is still a Proposal. The longest bracket sits highest, so the short ones stay nearest the columns they join. The constraint never blocks anything; a Story placed before the one it runs after says "yet comes first" and nothing more. From the criteria Stage on (#128), each Story column stacks its Acceptance criteria under its description, before any move or retirement plate, under a rule: a meta-size heading (`list-checks`, "Acceptance criteria" semibold in secondary ink, then the tabular count, "2 · 1 proposed", in meta ink), then the criteria as `board/CriteriaList.tsx` draws them in its compact variant: the statement semibold at small size, then the Check's command on its own line (`square-terminal` and the command in code face at meta size, as a proposed criterion shows it), then its result chip followed by Change and Remove (ghost, extra-small), or the quiet "Judged at review" pill followed by Add Check, the controls kept beside the chip they act on; "No criterion yet" in secondary ink while there is none and none proposed. A pending criterion is a dashed plate under them, the move plate's frame: `circle-dashed` "Proposed criterion" in running ink, the statement semibold in ink, then its Check (`square-terminal` and the command in code face, or the "Judged at review" pill), then Accept (outline), Amend and Reject (ghost), all extra-small so the three sit on one line in the column. Amend opens "Criterion" (a textarea) and "Check command (blank: judged at review)" (code face) in place, with Accept edit, Cancel and the ⌘↩ hint; the Story it is on is not editable. Rejected Story and criterion Proposals shrink under the columns to the rejected spec change's two lines: `ban`, "Rejected", the title, "Move FLY-12" or the criterion's statement struck through, then "Your reason: …".

### Feed Rows
A tool call is one line (`session/FeedRow.tsx`, worded by `session/toolVerbs.ts`): the disclosure chevron, the kind's Lucide icon, a plain verb in a 108px semibold column (Read, Edited, Wrote, Ran, Searched; board tools by their meaning: Added Task, Finished Task, Ran Checks, Handed off, Posted Round, and Resumed Round n for `round_wait`, each of the two reading "Waiting on your answers" while it is held), what it acted on (code face for paths and commands, reading face for Task titles), then the metrics column on the right in meta ink, tabular: lines, `+added −removed`, "done" in ink for a clean command or "exit n" for a failed one, Check results, and the duration. A failed command is neutral ink beside `circle-x`; only a failed Check is red. Search targets are quoted, with the place searched ("“Dropped” in GLOSSARY.md"); a tool Flywheel has no verb for reads "Used" and its name in words. A call in flight reads in the progressive ("Running"), the loader leading its clock in running ink. No raw `mcp__` tool name is printed anywhere outside View raw.

### Navigation
- **Sidebar:** the `sidebar` ground behind a right edge; the current project or Story is a raised `sidebar-primary` card, hover is `sidebar-accent`; group names in the condensed label; session sub-items indent behind a 1px rule. A project's figure is its Needs-you item count (#156): yellow while one of its items is Waiting on you, an inset count otherwise; there is no separate Needs decision figure.
- **Breadcrumb:** names the project, then the Story, then the session; every crumb but the last goes to its place.
- **Andon strip:** one lamp per live Story session across the top of every screen, in every project: lit yellow (lamp-black ink, the hand) while it is Waiting on you, graphite with a blue bulb while its agent works, graphite with a red bulb while its Story is Stopped. Each lamp names the Story key and title and, below, what it waits on, what it is doing or why it stopped. A shaping session held on a Round lights a lamp of its own among the waiting ones (#124): the Epic's key and title, "Round n · Waiting on you", and a click opens the Epic's shaping view; the same Round counts in the sidebar's Waiting on you and its project's figure, has its own row under the project (the hand, the Epic, "Round n · Waiting on you", opening the Epic), and is listed in the queue, after the requests, in the request card's frame with Answer. A Milestone's held Round (#132) does all of the same, named by the Milestone's title with no key, and opens the Milestone's shaping view. Order: Waiting on you (longest first), Running, Stopped. Lamps that do not fit fold into a dashed "+n more" lamp that opens All agents, or Waiting on you when a folded lamp is lit; with none, the strip says "No agent running" and keeps its height. Clicking a lamp opens its Story, never its session; the current Story's lamp carries the strip-ink outline.

### Icons
Lucide (`lucide-react`, ISC), drawn at a 2px stroke: 16px by default, 15px inside pills, 18px in navigation. Every icon sits next to its word and is decorative; an icon alone needs a tooltip and an accessible label. Glyphs are imported by name, never the whole set.

### Motion
One curve, HighKnow's `ease-out-quint` `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-quint`, aliased as `--ease`): 160ms for a state change, 240ms for a lamp lighting. Overlays fade and scale in from 95% on the state duration. The live pulse is the only continuous motion. Under `prefers-reduced-motion` both durations go to zero and every animation and transition stops.

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
- **Don't** recolour the mark: no ink silhouette, no scheme-dependent fill.
- **Don't** set the condensed uppercase label above a heading as an eyebrow.
- **Don't** draw an icon without its word unless it has a tooltip and an accessible label.
- **Don't** animate when reduced motion is requested.
