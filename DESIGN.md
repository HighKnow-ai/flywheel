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

The system is built on shadcn/ui and Tailwind v4: every colour is a CSS custom property under shadcn's variable name in one stylesheet of record, with a light scheme on the root and a dark scheme on `.dark` (set from `prefers-color-scheme`). The tokens, type, icons, primitives and the state badge are built, and every screen of the M2 flow draws on them (#107): the sidebar, the andon strip, the board, the Story view, the session feed and its request cards, Waiting on you, All agents and the dialogs. Settings, Worktrees, first run and the recovery dialog keep their layout in two small legacy stylesheets (`styles/admin-surfaces.css`, `styles/states-and-confirms.css`) that read every value from these tokens; the agent turn's markdown has its own (`session/markdown.css`). The Milestone header and its count boxes have tokens (`chart-*`, the `lead`/`count`/`milestone` type steps) and arrive with #106.

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
- **Bar Greys** (`chart-1` to `chart-4`): the stacked bar's segments for Merged, In review, Running (the brand fill) and Ready. Reserved for the Milestone header.

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
- **Lead** (52px, line-height 1, tabular): the one lead count in the Milestone header. Reserved, not yet drawn.
- **Count** (34px, line-height 1, tabular): count boxes. Reserved, not yet drawn.
- **Milestone** (26px, 1.15): the Milestone name. Reserved, not yet drawn.
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

The composition: a 72px andon strip across the content top on every screen, then a 56px top bar (Back, the breadcrumb, the ⌘K search and the surface's add or run controls), then the surface on the floor, 20px in from the edges, its content in cards up to 1240px wide. The board is the roster: one card per Epic, its Stories as rows (the Milestone header mounts above it with #106). The Story view is a title card, the live agent's station, then Acceptance criteria beside Tasks, then Sessions. Not built yet: Needs you as a 400px column beside the roster, and the Story view beside a 470px roster at content widths of 1280px and up; today the Story view takes the whole content area at every width.

**The click model.** What you click decides where you land, and every place is shown in the breadcrumb:
- A project in the sidebar opens that project's board, replacing whatever was on top.
- A Story row, a sidebar session, a Needs-you card's title or a lamp opens the Story view, never the session.
- Open session / Open feed (labelled, terminal icon) opens that session's feed.
- Answer / Allow once on a Waiting-on-you item opens the feed scrolled to the open request.
- Start and Resume keep you where you are; the row turns Running.
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

Gently rounded and consistent: cards, popovers and dialogs 10px (`lg`), buttons and inputs 8px (`md`), compact buttons 6px (`sm`), checkboxes 4px, pills and badges fully round. Borders are 1px. A Shaping state pill is the one dashed outline: a dashed control-edge ring on no ground, the shape of something not yet solid.

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

### Navigation
- **Sidebar:** the `sidebar` ground behind a right edge; the current project or Story is a raised `sidebar-primary` card, hover is `sidebar-accent`; group names in the condensed label; session sub-items indent behind a 1px rule.
- **Breadcrumb:** names the project, then the Story, then the session; every crumb but the last goes to its place.
- **Andon strip:** one lamp per live Story session across the top of every screen, in every project: lit yellow (lamp-black ink, the hand) while it is Waiting on you, graphite with a blue bulb while its agent works, graphite with a red bulb while its Story is Stopped. Each lamp names the Story key and title and, below, what it waits on, what it is doing or why it stopped. Order: Waiting on you (longest first), Running, Stopped. Lamps that do not fit fold into a dashed "+n more" lamp that opens All agents; with none, the strip says "No agent running" and keeps its height. Clicking a lamp opens its Story, never its session; the current Story's lamp carries the strip-ink outline.

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
