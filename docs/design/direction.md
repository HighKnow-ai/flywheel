# Flywheel's visual world: Andon

Decided in [Pick Flywheel's new visual world from three rendered directions](https://github.com/HighKnow-ai/flywheel/issues/103) (Epic #97), with `impeccable` (new-work flow, Operate mode). It replaces "Mission Control", whose rules (no filled buttons, no tinted rows, brand spent only on progress) no longer bind. The evidence for the change is [`critique-2026-10.md`](critique-2026-10.md).

Cyril compared three code-rendered directions on 2026-10-21: **A, Plakat** (Swiss poster grid), **B, Andon**, and **C, Departures** (airport departures board). He picked **Andon**, with two changes: fewer colours, and a system built on shadcn/ui and Tailwind so that the build lands as one design. This file is the contract for that world. [ADR 0004](../adr/0004-tailwind-and-shadcn-ui-for-the-desktop-ui.md) records the stack decision. Story #105 builds the tokens and components, and #107 restyles the screens.

**Since #196 (2026-10-25), Flywheel takes HighKnow's tokens where they fit** ([ADR 0021](../adr/0021-highknow-tokens-are-the-source-and-public-sans-is-the-face.md)): the light ink, secondary ink, rules, control boundary, brand text, brand wash, brand hair and error, HighKnow's lifted brand and error text on dark, the Public Sans face, the `ease-out-quint` curve, and the mark in its real colours. The grounds, the dark scheme, safety yellow, graphite, the lamps and the Diff Tints stay Flywheel's own. § [From HighKnow](#from-highknow) lists the mapping. **Since 2026-10-27 the source is the published `@highknow/design` package** (ADR 0021, amendment of 2026-10-27), whose base is this contract's own values: the shared roles below live in its `theme.css`, Flywheel's roles in `globals.css`.

The mockup, rendered from code over demonstration data shaped like Flywheel's own M3 backlog, is [`directions/andon.html`](directions/andon.html). Open it in a browser and add `?theme=dark` for the dark scheme.

| | Light | Dark |
|---|---|---|
| Board, with the Milestone header | ![](directions/andon-board-light.webp) | ![](directions/andon-board-dark.webp) |
| Story, with its live agent | ![](directions/andon-story-light.webp) | ![](directions/andon-story-dark.webp) |
| Waiting on you: the agent's question | ![](directions/andon-wait-light.webp) | ![](directions/andon-wait-dark.webp) |

## Direction contract

- **Thesis.** Kanban came from Toyota's line, and so does the andon: a lamp a station lights when the line needs a person. Every live session is a lamp in one strip across the top of every screen, so "where is the agent" and "what needs me" always have the same answer. The world refuses the category default: a grey list of same-weight rows with one accent colour.
- **Own world.** A neutral grey floor with white cards on it. A graphite strip holds the lamps. Public Sans, HighKnow's face, with tabular numerals (Barlow until #196). One loud colour, safety yellow, means Waiting on you and nothing else. The brand blue means an agent at work or your next action. Red means Stopped or failed. Every other state is neutral and is told apart by its icon and word.
- **Story.** Cyril opens the app and reads, without opening anything, how far the Current Milestone has come, which agents are running, and which one needs him. He clicks the lit lamp or its row and answers.
- **First viewport.** The macOS window. A light sidebar (projects with their Needs-you counts, live sessions under each project). The andon strip across the content top, 72px. The breadcrumb and the add controls (+ Epic, + Story filled). The production-board Milestone header: name, Exit test, a dark count box "Stories merged 2/11", a box per state, and a stacked bar. Below it, two columns: Needs you as cards (400px) and the roster, with each Epic as a card and its Stories as rows.
- **Form.** Lean visual management (andon and production board). It was impeccable's own top-ranked candidate (#1 of seven), offered as the pick card beside the roll's assigned direction (Plakat) and a catalog challenger (Departures). Seed: `seed:3b9829d223c3d146`.
- **Signature interaction.** A lamp lights. When a session becomes Waiting on you, its lamp turns yellow in place and stays lit until the request is answered. Its row and Needs-you card take the yellow tint in the same frame. Nothing moves on screen and nothing opens.
- **Finish.** Unreviewed and undocumented is unfinished. The build (#105, #107) ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance. Today's `DESIGN.md` describes Mission Control and is replaced from the built world at that point.

## Colour: one meaning per colour

Cyril asked for fewer colours. Five hues carry meaning. Every other surface is a neutral grey, and states that are not attention, running or failure are neutral: their icon and word do the work.

| Colour | Light | Dark | Its one meaning |
|---|---|---|---|
| Safety yellow (`--attention`) | `#ffd400`, ink `#14120a` | same | **Waiting on you.** The lit lamp, the Needs-you count, the Waiting-on-you pill, the request card's header, the Answer button, and the tint of rows that need you. |
| Brand blue (`--primary`, `--running`) | `#3c64dd` fill, text `#22409c` | `#3c64dd` fill, text lifted to `#7d99ff` | **An agent at work, or your next action.** Running pills and lamps, the doing Task, the live-agent station, filled primary buttons, the focus ring, links. |
| Red (`--destructive`) | `#c0223a`, text `#c0223a` | `#c0223a`, text `#ff6b82` | **Stopped or failed.** Stopped pills and lamps, a failed Check, Drop and other destructive actions. |
| Graphite (`--strip`) | `#17191e` | `#000000` | **The live strip and the lead count.** Hardware, not a state. |
| Neutral grey ramp | see tokens | see tokens | Everything else: Shaping, Ready, In review, Merged, Dropped, passed / not run / timed out / stale Checks, open and done Tasks. |

No green anywhere but a diff: passed reads from the check icon and its word. The one exception is the pale pair of Diff Tints under an added or removed line on the review card (ADR 0011). The brand blue keeps the hue of the HighKnow mark (`hsl(225, 70%, 55%)`). On dark grounds its text is lifted to `#7d99ff`, HighKnow's own lift of the same hue, as PRODUCT.md's brand rule requires. Its text on light is HighKnow's brand ink `#22409c`, and the red is HighKnow's error `#c0223a` (hue 351°), used as the fill in both schemes and as the text on light.

### The mark

Wherever Flywheel shows a logo (the rail and the first-run empty state), it is the HighKnow mark in its real colours: the `#3c64dd` tile with the white glyph, `assets/logo.svg`, byte-identical to HighKnow's `docs/design/assets/logo.svg`, drawn as an `<img>`. It is the same in both schemes, as HighKnow's `Wordmark` keeps it: an image cannot read the page's tokens, so no scheme can recolour it. The mark is identity, not a state colour, so it isn't a use of the brand blue's one meaning. No ink-masked silhouette (#196 replaced A-08(c)'s ink mark). `theme/__tests__/brand-mark.test.tsx` holds this. The app icon under `src-tauri/icons` was already the full-colour tile.

## Tokens (shadcn/ui variable names, Tailwind v4)

Each token keeps the variable name shadcn/ui uses, so its generated components theme correctly without edits. Flywheel adds `attention`, `running`, `strip`, `lamp` and `subtle-foreground`. The shared roles are declared by `@highknow/design`'s `theme.css` and Flywheel's own in `globals.css`; in each, `:root` holds light, `.dark` holds dark, and `@theme inline` maps each name to a Tailwind colour (`--color-attention: var(--attention)`, so `bg-attention` works). `.dark` is set from `prefers-color-scheme` and from the existing theme setting. A value marked **HK** is HighKnow's (§ [From HighKnow](#from-highknow)).

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--background` | `#e6e8ec` | `#0b0c0e` | the floor the cards sit on |
| `--foreground` | `#12151c` HK | `#eceef1` | body text |
| `--card` / `--popover` | `#ffffff` | `#1a1c20` | cards, panels, popovers, dialogs |
| `--card-foreground` / `--popover-foreground` | `#12151c` HK | `#eceef1` | |
| `--primary` | `#3c64dd` HK | `#3c64dd` HK | filled primary button, Running fill, lamp bulb |
| `--primary-foreground` | `#ffffff` | `#ffffff` | text on primary |
| `--running` | `#22409c` HK | `#7d99ff` HK | Running text and icons, doing Task, links |
| `--running-muted` | `#eef1fd` HK | `#19213a` | Running pill ground, selected row |
| `--running-border` | `#c8d2f7` HK | `#2c3a6b` | a hairline in the brand hue on a `running-muted` surface. New in #196, no consumer yet: for the Stories after the design audit (#192) |
| `--attention` | `#ffd400` | `#ffd400` | Waiting on you (fills) |
| `--attention-foreground` | `#14120a` | `#14120a` | text on attention |
| `--attention-muted` | `#fff7cc` | `#352d00` | tint of a row or card that needs you |
| `--destructive` | `#c0223a` HK | `#c0223a` HK | Stopped and failed fills |
| `--destructive-foreground` | `#ffffff` | `#ffffff` | text on destructive |
| `--destructive-text` | `#c0223a` HK | `#ff6b82` HK | Drop and other destructive text buttons |
| `--secondary` / `--muted` | `#f4f5f7` | `#23262b` | neutral pills, secondary button ground, inset panels |
| `--secondary-foreground` | `#12151c` HK | `#eceef1` | |
| `--muted-foreground` | `#4a5261` HK | `#a0a6b1` | secondary text |
| `--subtle-foreground` | `#676d79` | `#90969f` | meta, chevrons, timestamps |
| `--accent` | `#eef0f3` | `#23262b` | hover |
| `--accent-foreground` | `#12151c` HK | `#eceef1` | |
| `--border` | `#cdd2dd` HK | `#2c2f36` | card edges, row rules, region edges |
| `--input` | `#8792a6` HK | `#6e7480` | control boundaries (inputs, outline buttons, radios) |
| `--ring` | `#3c64dd` HK | `#7d99ff` HK | focus ring, 2px, 2px offset |
| `--sidebar` | `#f8f9fa` | `#121316` | sidebar ground |
| `--sidebar-foreground` | `#12151c` HK | `#eceef1` | |
| `--sidebar-primary` | `#ffffff` | `#1a1c20` | current project or Story: a raised card in the sidebar |
| `--sidebar-primary-foreground` | `#12151c` HK | `#eceef1` | |
| `--sidebar-accent` | `#e9ebef` | `#1e2025` | sidebar hover |
| `--sidebar-border` / `--sidebar-ring` | `#e4e7ee` HK / `#3c64dd` HK | `#2c2f36` / `#7d99ff` HK | the rail's right edge and its rules; the rail's focus ring |
| `--strip` | `#17191e` | `#000000` | andon strip, lead count box, live-agent station |
| `--strip-foreground` | `#f2f3f5` | `#f2f3f5` | text on the strip |
| `--strip-muted-foreground` | `#a4a9b3` | `#9aa0aa` | secondary text on the strip |
| `--lamp` | `#25282f` | `#1a1c20` | an unlit lamp |
| `--diff-insert` / `--diff-delete` | `#e3f4e7` / `#fce6e4` | `#142a1b` / `#351816` | the ground of a line a diff adds or removes, on the review card only (ADR 0011) |
| `--chart-1` … `--chart-4` | `#12151c` HK · `#7d838f` · `#3c64dd` HK · `#c3c7ce` | `#eceef1` · `#7d838f` · `#3c64dd` HK · `#4a4f58` | stacked bar: Merged · In review · Running · Ready. Shaping is a hatch of chart-4, Dropped an outline; Waiting on you and Stopped use attention and destructive |
| `--ease-out-quint` | `cubic-bezier(0.16, 1, 0.3, 1)` HK | | the shared easing token; `--ease` is `var(--ease-out-quint)` |
| `--radius` | `0.625rem` | | cards 10px, buttons and inputs 8px, pills fully round |

### From HighKnow

Decided in #196 ([ADR 0021](../adr/0021-highknow-tokens-are-the-source-and-public-sans-is-the-face.md)). The source was HighKnow's token export, vendored here until 2026-10-27; it is now the published `@highknow/design` package, which declares each variable below itself (ADR 0021, amendment of 2026-10-27). The vendored copy and its equality test are retired; `theme/__tests__/contrast.test.ts` reads the package's values.

| HighKnow token | Value | Flywheel variables, light | Flywheel variables, dark |
|---|---|---|---|
| `color-ink` | `#12151c` | `--foreground` and every `*-foreground` on a light ground, `--chart-1` | |
| `color-ink-soft` | `#4a5261` | `--muted-foreground` | |
| `color-rule` | `#e4e7ee` | `--sidebar-border` (HighKnow's nav rail edge) | |
| `color-rule-strong` | `#cdd2dd` | `--border` | |
| `color-rule-control` | `#8792a6` | `--input` | |
| `color-brand` | `#3c64dd` | `--primary`, `--ring`, `--sidebar-ring`, `--chart-3` | `--primary`, `--chart-3` |
| `color-brand-ink` | `#22409c` | `--running` | |
| `color-brand-wash` | `#eef1fd` | `--running-muted` | |
| `color-brand-hair` | `#c8d2f7` | `--running-border` | |
| `color-brand-lift` | `#7d99ff` | | `--running`, `--ring`, `--sidebar-ring` |
| `color-error` | `#c0223a` | `--destructive`, `--destructive-text` | `--destructive` |
| `color-companion-dark-error` | `#ff6b82` | | `--destructive-text` |
| `font-sans` | `"Public Sans Variable", …` | `--font-ui` (and `--font-ui-condensed` through it) | same |
| `ease-out-quint` | `cubic-bezier(0.16, 1, 0.3, 1)` | `--ease-out-quint` | same |

**Why rule-strong is the border and rule is the rail's edge.** HighKnow draws `rule` between rows on a white page and keeps `rule-strong` for "a division read against content". Flywheel's `--border` edges cards on a grey floor: `#e4e7ee` on the floor `#e6e8ec` measures 1.01:1 and would vanish, and on a card it would fall below the 1.36:1 floor `contrast.test.ts` holds. `#cdd2dd` measures 1.52:1 on a card and 1.24:1 on the floor. `rule` is the exact use HighKnow gives it on its own nav rail, the rail's right edge, which is `--sidebar-border` here.

**Kept as Flywheel's own:** the grounds and the whole dark scale except the brand lift and the error text, safety yellow, graphite, the lamps, the Diff Tints, `--subtle-foreground`, `--accent`, `--sidebar-accent` and the chart neutrals. HighKnow has no matching role for any of them. `--running-border`'s dark `#2c3a6b` is Flywheel's: it keeps the brand hue and sits 1.46:1 on the dark `running-muted`, as the light pair sits 1.33:1.

**Contrast deviations: none.** Every HighKnow value was taken unchanged: each one passes on every Flywheel ground it is drawn on (the table below). One note for later work: `#8792a6` is the lightest blue-grey that clears 3:1 on white (HighKnow measured it), so it holds only on the card. On the sidebar it measures 2.98:1 and on the floor 2.56:1 (Flywheel's old `#858b96` was 2.79:1 on the floor). No control boundary is drawn on either today. A control placed there takes a card ground, or the value gets its own lightness step recorded here.

### Measured contrast per role

Measured with the WCAG 2 formula on the values above. `theme/__tests__/contrast.test.ts`, not this table, owns the numbers.

| Role | Light | Ratio | Dark | Ratio |
|---|---|---|---|---|
| Body text (foreground on card) | `#12151c` on `#ffffff` | 18.26:1 | `#eceef1` on `#1a1c20` | 14.68:1 |
| Body text on the floor | `#12151c` on `#e6e8ec` | 14.89:1 | `#eceef1` on `#0b0c0e` | 16.83:1 |
| Secondary text (muted-foreground on card) | `#4a5261` on `#ffffff` | 7.86:1 | `#a0a6b1` on `#1a1c20` | 6.97:1 |
| Secondary text on the floor | `#4a5261` on `#e6e8ec` | 6.41:1 | `#a0a6b1` on `#0b0c0e` | 8:1 |
| Meta and chevrons (subtle-foreground on card) | `#676d79` on `#ffffff` | 5.2:1 | `#90969f` on `#1a1c20` | 5.73:1 |
| Primary button | `#ffffff` on `#3c64dd` | 5.17:1 | `#ffffff` on `#3c64dd` | 5.17:1 |
| Running pill text | `#22409c` on `#eef1fd` | 8.17:1 | `#7d99ff` on `#19213a` | 5.96:1 |
| Link or Running text on card | `#22409c` on `#ffffff` | 9.2:1 | `#7d99ff` on `#1a1c20` | 6.4:1 |
| Waiting on you | `#14120a` on `#ffd400` | 13.09:1 | `#14120a` on `#ffd400` | 13.09:1 |
| Stopped or failed | `#ffffff` on `#c0223a` | 5.95:1 | `#ffffff` on `#c0223a` | 5.95:1 |
| Destructive text on card (Drop) | `#c0223a` on `#ffffff` | 5.95:1 | `#ff6b82` on `#1a1c20` | 6.24:1 |
| Neutral state pill | `#12151c` on `#f4f5f7` | 16.74:1 | `#eceef1` on `#23262b` | 13.06:1 |
| Strip text on a lamp | `#f2f3f5` on `#25282f` | 13.29:1 | `#f2f3f5` on `#1a1c20` | 15.37:1 |
| Strip secondary text on a lamp | `#a4a9b3` on `#25282f` | 6.26:1 | `#9aa0aa` on `#1a1c20` | 6.49:1 |
| Lit lamp on the strip | `#ffd400` on `#17191e` | 12.28:1 | `#ffd400` on `#000000` | 14.67:1 |
| Focus ring vs card (non-text, needs 3:1) | `#3c64dd` on `#ffffff` | 5.17:1 | `#7d99ff` on `#1a1c20` | 6.4:1 |
| Control boundary (input vs card, needs 3:1) | `#8792a6` on `#ffffff` | 3.14:1 | `#6e7480` on `#1a1c20` | 3.63:1 |
| Card vs floor (region) | `#ffffff` on `#e6e8ec` | 1.23:1 | `#1a1c20` on `#0b0c0e` | 1.15:1 |
| Strip vs floor (region) | `#17191e` on `#e6e8ec` | 14.33:1 | `#000000` on `#0b0c0e` | 1.07:1 |
| Sidebar vs floor (region) | `#f8f9fa` on `#e6e8ec` | 1.16:1 | `#121316` on `#0b0c0e` | 1.05:1 |
| Border vs card (region edge) | `#cdd2dd` on `#ffffff` | 1.52:1 | `#2c2f36` on `#1a1c20` | 1.27:1 |
| Border vs floor (region edge) | `#cdd2dd` on `#e6e8ec` | 1.24:1 | `#2c2f36` on `#0b0c0e` | 1.46:1 |
| Rail edge vs sidebar (sidebar-border) | `#e4e7ee` on `#f8f9fa` | 1.17:1 | `#2c2f36` on `#121316` | 1.39:1 |

Regions are told apart by three things together: a ground step, the 1px `--border` edge, and the card shadow (`0 1px 2px rgb(15 20 30 / 0.08)`). Mission Control measured 1.03 to 1.06 with no edge at all. In dark mode the ground step is small, so the edge is mandatory: every card, the sidebar and the strip draw their `--border` edge. The stacked bar's neutral segments (Ready `#c3c7ce`, 1.7:1 on white) are never the only carrier of a count: the count box above names every state with its number, icon and word.

## Type

- **Public Sans Variable** (HighKnow's face, since #196 and [ADR 0021](../adr/0021-highknow-tokens-are-the-source-and-public-sans-is-the-face.md)), at 400, 500, 600 and 700, for everything people read. The condensed role (`.type-condensed`, `--font-ui-condensed`) is the same family at 600, uppercase with 0.04 to 0.08em tracking, only for count labels, the strip's labels and sidebar group names, never as an eyebrow above a heading. **JetBrains Mono** 400 for Story keys, branches, paths and commands. Both are SIL OFL 1.1 and self-hosted through `@fontsource` packages (`@fontsource-variable/public-sans` 5.3.0), so a render on one machine matches another (PRODUCT.md house method). Numerals are tabular wherever they count: Public Sans carries a `tnum` feature, which `.tabular-nums` turns on, and `theme/__tests__/face.test.ts` reads the font file to prove it. Until #196 the face was Barlow, with Barlow Semi Condensed for the condensed role.
- **Scale:** 12 (meta, labels) · 13 (secondary) · 14 (body, rows, buttons) · 15 (row titles) · 17 (section headings) · 24 (Story title) · 26 (Milestone name) · 34 (count boxes) · 52 (the lead count). Weight steps from 400 to 700. The ratio between body and page title is 1.7, against Mission Control's 1.15.

## Icons

**Lucide** (`lucide-react`, ISC licence, already installed at 1.43.0, and shadcn/ui's default set). The Phosphor glyphs in the comparison round are replaced, because one set across shadcn's generated components and Flywheel's own is the cohesion the stack decision is for. Icons use a 2px stroke at 16px, 15px inside pills, and 18px in navigation. Every icon sits next to its word. An icon alone is allowed only with a tooltip and an `aria-label`.

| Meaning | Lucide icon |
|---|---|
| Story states: Shaping, Ready, Running, In review, Merged, Dropped | `circle-dashed`, `circle`, `loader-circle`, `git-pull-request`, `git-merge`, `circle-slash` |
| Attention: Waiting on you, Stopped | `hand`, `circle-pause` |
| Checks: passed, failed, not run, timed out, stale, judged at review | `circle-check`, `circle-x`, `circle`, `hourglass`, `history`, `git-pull-request` |
| Tasks: open, doing, done, dropped | `circle`, `loader-circle`, `circle-check`, `circle-slash` |
| Records: Milestone, Epic, project, worktree, session | `flag`, `layers`, `folder`, `box`, `terminal` |
| Repo knowledge: an ADR, a glossary term (#129) | `scroll-text`, `book-a` |
| Needs-you kinds: question, Gated action, permission request, review, shaping Round | `message-circle-question-mark`, `shield-alert`, `key-round`, `git-pull-request`, `circle-dashed` |
| Feed rows: Read, Edit, Run, Search, board tool, agent turn | `file-text`, `pencil`, `terminal`, `search`, `kanban`, `bot` |
| Actions: Start, Stop, Resume, Drop, add, Back, opens, Open session | `play`, `square`, `rotate-ccw`, `trash-2`, `plus`, `arrow-left`, `chevron-right`, `square-arrow-out-up-right` |
| Places: Needs you, All agents, Settings | `bell-ring`, `activity`, `settings` |

## Components

### shadcn/ui components the app uses

Compiled into `@highknow/design` (ADR 0004, amendment of 2026-10-27), shadcn/ui on Radix primitives with this contract's retheme; Flywheel imports them from the package and adds its `attention` tone to Button and Badge:

| Component | Where |
|---|---|
| `Button` | every action. Variants: `default` (filled primary), `attention` (added: Answer, Allow on a Waiting-on-you item), `secondary`, `outline`, `ghost`, `destructive` (text-styled Drop), `link` |
| `Badge` | state pills, Check chips, Needs-you kinds, counts. Variants follow the tones below |
| `Card` | Milestone header, Needs-you item, Epic group, Story panel, request cards |
| `Sidebar` | the project sidebar, its groups, and session sub-items |
| `Breadcrumb` | "flywheel / M3 Shaping / FLY-4" in the top bar |
| `Command` (cmdk) inside `Dialog` | the ⌘K palette |
| `Dialog` / `AlertDialog` | AlertDialog confirms Drop and Stop; Dialog holds the resume note and Write a Story |
| `Popover` | pickers (Epic, Milestone), the Always-allow pattern editor |
| `Tooltip` | every icon-only control, truncated titles, lamp details |
| `DropdownMenu` | row overflow (Move to Epic, Copy branch), project menu |
| `Sheet` | Needs you when the window is under 1280px (the shaping dock stacks instead: DESIGN.md, Round Dock) |
| `Collapsible` | a Task's note, a failed tool call, older sessions |
| `Checkbox` / `RadioGroup` / `Label` | the question card's choices, criteria acceptance at review |
| `Input` / `Textarea` | Other answers, Check commands, notes |
| `ScrollArea` | roster, feed, Story panel |
| `Separator` / `Skeleton` / `Kbd` | rules, loading rows, shortcut hints |

### Flywheel components, built from them

`AndonStrip` and `Lamp` · `MilestoneHeader` (`CountBox`, `StackedBar`) · `NeedsYouCard` · `EpicGroup` · `StoryRow` · `StatePill` · `AgentStation` (the live-agent block on a Story) · `CriterionRow` and `CheckChip` · `TaskRow` · `FeedRow` · `QuestionCard` · `GatedActionCard` · `PermissionRequestCard`.

### Rules

1. **Tones.** Every state maps to one tone: `attention` (Waiting on you), `running` (Running, doing Task), `destructive` (Stopped, failed Check), or `neutral` (everything else). `StatePill` takes a state and renders its icon, its word and its tone. No component picks a state colour itself.
2. **One filled primary action per region.** It is brand blue. The only other filled action colour is attention, and only on an item that is Waiting on you (Answer, Allow once on a permission request). On a Gated action, Deny leads as the filled neutral (`foreground` fill) and Allow once is outline, as in the M2 card the critique kept. Drop is a destructive text button, set apart from the primary, and always confirms in an AlertDialog.
3. **What is clickable looks clickable.** Anything that navigates (a Story row, a lamp, a Needs-you card, a sidebar session) is a bounded object with a trailing `chevron-right`, an `accent` hover and the focus ring. Inert text never carries a chevron. Buttons carry an icon and a word. Links are `running` text.
4. **Rows that need you are tinted** `attention-muted`. The selected row is `running-muted`.
5. **Depth:** cards use `--border` plus the card shadow. Popovers and dialogs use `0 8px 24px rgb(15 20 30 / 0.16)`. No glow anywhere, except the lit bulb of a lamp, whose glow is its meaning.
6. **Spacing:** 4px base; 8 inside a group, 12 to 16 between groups, 20 between regions. Rows are 44px, sidebar rows 36px.
7. **Motion:** one curve, HighKnow's `ease-out-quint` `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out-quint`, aliased as `--ease`), and one duration per job: 120ms feedback, 160ms state, 240ms a lamp lighting (the one authored moment), 260ms an overlay or disclosure arriving and 180ms leaving (DESIGN.md § Motion). A live dot may pulse. Under `prefers-reduced-motion` nothing moves, but colour and opacity still cross-fade (ADR 0023).
8. **Browser surfaces:** selection uses `--primary` with white text, scrollbars are thin `--border` thumbs, and the caret is `--running`.

## Click and navigation model

This keeps the model #104 shipped (`state/uiStore.ts`: `openStory`, `goBack`, `navHistory`; spec §7 "Click model") and gives each rule its visual form.

| You click | You land on | Never |
|---|---|---|
| A project in the sidebar | that project's board. It replaces whatever was showing: a session, the fleet, a Story | leaves a session or the fleet on top |
| A Story row: the roster, a sidebar session, a Needs-you card's title, a **lamp** | the Story view | opens the session |
| **Open session** / **Open feed** (labelled, `terminal` icon) on a row, the station, or the Story's session list | that session's feed | appears without a label |
| **Answer** / **Allow once** on a Waiting-on-you item | the session feed, scrolled to the open request | |
| **Start**, **Resume** | stays where you are. The row turns Running, and a lamp appears and lights blue | pushes into the feed |
| **Back**, ⌘[, or the Story panel's × | the previous place | goes "to the board" when you came from elsewhere |
| A row in All agents (a list of sessions) | that session. Its Story key opens the Story | |
| An OS notification for a request | the session feed at that request | |

- **Where you are** is always shown: the breadcrumb names the project, the Milestone or the Story, and the session. The sidebar marks the current project and Story as a raised card, and the selected lamp carries a white outline.
- **The Story view** has the roster beside it at content widths of 1280px and up (roster 470px, Story panel the rest). From 900px (the window's `minWidth`) to 1279px it takes the whole content area. The Story stays one place in `navHistory` either way.
- **The andon strip** shows every live session in every project, oldest Waiting-on-you first, then Running, then Stopped. Past the strip's width, it shows a "+n more" lamp that opens All agents. With nothing running, it shows one quiet line ("No agent running") and keeps its height, so the layout never jumps.

## Not chosen

- **A, Plakat** (Swiss grid; one cell per Story on every bar). It lent the fixed-scale discipline the stacked bars keep: every bar on the board uses the same scale.
- **C, Departures** (Needs you as a ranked departures board; dark means live). It lent "a row that changed stays lit until noticed", which is now the lamp's behaviour.
