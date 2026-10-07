---
phase: "1"
slug: "the-board-is-the-store-of-record"
status: draft
shadcn_initialized: false
preset: none
component_strategy: a-selfhost-radix
component_strategy_decided: "2026-09-09"
typeface: "Archivo (variable, wdth+wght axes) — OFL, Omnibus-Type"
icon_library: lucide-react
radius_strip: "2px"
radius_chrome: "6px"
created: "2026-09-09"
---

# Phase 1 — UI Design Contract

Platform: **macOS desktop only** (Tauri v2 native WebView). Visitor mode: **Operate** — the user is
in a task, all day, at high frequency. Scanability, consistency, native expectations and the real
usage scene outrank expression; brand lives in precise details; expression must never obscure task,
state, or a familiar affordance (Impeccable `operate.md`). This document is the structural and
behavioural contract for Phase 1's surfaces. It deliberately leaves the **visual world** — palette,
typeface, radius language, materials — open; see "Open Decisions the Builder Must Not Invent."

---

## Build Process Requirement — Binding on Every UI-Building Plan Task

This is an acceptance-criteria-bearing obligation, not advice. Every plan task in this phase that
creates or edits UI **must** include the following as checkable acceptance criteria, and the
executor must satisfy them before the task is done:

1. **Load `reference/craft-floor.md`** from the Impeccable skill (installed at
   `~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/reference/craft-floor.md`)
   immediately before editing UI — not after, not "if time allows."
2. **Run the detector once the surface is functionally complete:**
   `node ~/.claude/plugins/cache/impeccable/impeccable/4.0.4/skills/impeccable/scripts/detect.mjs --json <changed targets>`
   and fix everything it flags before marking the task done.
3. **Capture screenshots into `.impeccable/review/`** and spawn the shipped
   `impeccable-finish-reviewer` subagent against the phase's direction contract. **Until Gate A/B in
   "Open Decisions" clear, no direction contract exists** — in that case, review the built surface
   against this UI-SPEC's structural and behavioural contract instead (row anatomy, keyboard map,
   state inventory, token roles), and say so explicitly in the review output rather than skipping
   the step.
4. **End the task by having the shipped `impeccable-documenter` write or update `DESIGN.md`** from
   the built world.

The planner must encode these four steps as literal, checkable acceptance criteria on every
UI-building task in this phase's PLAN.md — not as prose in a task description.

---

## Selected Direction — Flight Progress Strips

**Status: CHOSEN by the owner, 2026-09-09.** Impeccable direction round, seed key `59b0beb9`
(`--scope direction --mode operate`). The roll assigned *Jacquard Card Chain*; the owner took the
`MY PICK` card instead, which the contract explicitly permits — a user's pick beats the dice. This
section supersedes the blocked visual-world entry that previously stood as Open Decision #1.

**Visual authority:** air-traffic control flight progress strips — one annotated strip per aircraft,
racked in sequence, the strip *being* the aircraft's state, read by a controller supervising many
flights at once.

**Thesis:** the board is a controller's rack, not a document. One strip per item, racked in order,
annotated in place, its phase printed on it and changed by keystroke. It refuses the category
default — the soft near-neutral list where status is a coloured word floating in whitespace.

### The disclosed risk, and how it is resolved

The card carried an honest risk: *a strip in a bay is a card in a column, and D-01 explicitly
rejected kanban.* That is resolved by taking **the rack, not the bays**. Within a bay, real strips
are a single ordered vertical stack; the controller's marks carry phase, and the strip slides within
the one rack. So:

- The board is **one vertical rack**, grouped into fixed status bands — never horizontal columns.
- Status is a **printed field on the strip plus its band position**, changed by keystroke, never by
  drag. This is D-01 and D-02 honoured literally, not worked around.
- Any future kanban surface (deferred in CONTEXT.md) is a second view over the same data and does not
  license columns here.

**If a build produces horizontal status columns, the direction has been misread.**

### The world

- **The rack** is the app's dark chrome — cool aluminium, low-chroma, receding: window ground,
  project rail, sticky band headers, detail-panel frame.
- **The strip** is the one light plane — a contiguous band of strip stock filling the content area,
  hairline-separated per row, so the list reads as one continuous racked field rather than as
  floating cards. Light content, dark chrome; uniformly-dark and uniformly-light are both the rut.
- **Strip stock is tinted per workflow state**, which is authentic to the source (real strips are
  colour-coded by flight phase). Five low-chroma tints in one paper family. **This tint is a second
  channel only** — every strip also carries its printed status word and the shape glyph from Row
  Anatomy. Meaning never rests on colour alone, per the inherited house rule.
- **Annotation is the interaction grammar.** Editing marks a strip; it does not open a form.

### Raises carried forward

The assigned direction was raised by two worlds it beat. Those donations are system discipline, not
clothes, and they transfer to the chosen direction intact:

- **Raised by Orienteering Map (declined):** a published, always-reachable legend. Every mark on a
  strip is defined in one legend surface reachable from the command palette, and **no mark may exist
  that the legend does not define.**
- **Raised by Drum Machine Step Row (declined):** state is an illuminated position on a fixed track,
  never a word floating in space — and an empty board reads as an empty rack ready to be filled, not
  as an apology.

### First viewport

The rack fills the window: dark chrome frame, project rail at the left edge, and the strip field
running the full height. Band headers are stamped rules naming each workflow state. Each strip
carries, at fixed stops, its `FLY-142` key, its title, and its annotation fields. The selected strip
is pulled proud of the rail — the one element allowed to break the plane. The brand blue marks
exactly one thing: the current position.

### Signature interaction

**Annotating a criterion.** With a strip selected, checking an acceptance criterion marks it in
place, advances the strip's checked/total count, and settles — the strip is annotated, never
replaced. Changing status re-racks that one strip into its new band with a single-row displacement,
never a list-wide reflow. This is also the performance thesis: one row moves, the rack does not
re-render.

### Motion grammar

Mechanical settle and single-row displacement. One easing curve across the entire product
(inherited house rule). **Never a fade** — a strip moves or it does not. `prefers-reduced-motion`
removes the displacement and applies the state change instantly; it never removes the state change.

### Type

**Status: LOCKED by the owner, 2026-09-09.** **Archivo** (OFL, Omnibus-Type) — self-hosted, workhorse
grotesque with true tabular figures (`tnum`/`lnum` GSUB features verified present in the shipped
variable font; see `01-02-SUMMARY.md`). Not one of Impeccable's banned training-data defaults.

Google Fonts merged Archivo's condensed/expanded static cuts into the single variable font's `wdth`
axis (62–125, default 100) some time after this constraint was written — there is no longer a
separately-published "Archivo Condensed" family to fetch. The condensed companion cut for the
stamped key and band headers is produced from the **same** variable file at a lower `wdth` value
rather than as a second font file, which is a better outcome for the "prefer variable font files to
keep the bundle small" preference than the two-file design implied when this constraint was written.

### Honest risk

Two, both live:

1. **Skeuomorphic drift.** Strip stock, rack rails and annotation marks can tip into a literal
   pastiche of paper and aluminium. The rule: the world supplies *structure, rhythm and state
   language*, not texture. No paper grain, no bevels, no drop shadows imitating physical strips.
2. **The tint family is low-chroma by necessity** (ink must clear AA on every stock), so the five
   tints are close in luminance and cannot carry status alone. The glyph and printed word are
   load-bearing, not decorative — removing them is a defect, not a simplification.

### Implementation consequence

- The rack/strip split maps cleanly onto the existing token roles below: `surface-dominant` and
  `surface-secondary` are rack values; `row-surface` is strip stock.
- Virtualization is unaffected — a strip is a fixed-height row, which is what the Performance
  Contract already requires.
- Selection "pulled proud of the rail" must be achieved without a layout-shifting transform, or it
  breaks the fixed-height row budget.

### What this section does NOT do

Per Impeccable, `shape` returns a direction and stops. **The direction contract itself — the
five-block `THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM` comment, closed with the `FINISH:`
line, carrying seed key `59b0beb9` — is authored by the builder at execution time**, as the first
child of the document body, and grepped for in the built output afterwards. This build is
**code-led**: no image generation was available this session, so there is no approved comp and no
comp round; the ambition lives in the FIRST VIEWPORT block and the signature interaction above, and
the finish reviewer audits those in behaviour.

---

## Design System

**Status: LOCKED by the owner, 2026-09-09** (Open Decisions #1/#2/#3 checkpoint, plan `01-02` Task
1). Binding for plans `01-03` through `01-11`.

| Property | Value |
|----------|-------|
| Tool | none — `shadcn` is deliberately NOT initialized (`shadcn_initialized: false`, decided, not deferred) |
| Preset | not applicable — no shadcn preset exists to derive |
| Component library | **self-hosted, hand-rolled Radix primitives** (option `a-selfhost-radix`). No preset to fight the two-material palette (dark rack `#171b22` vs warm paper strip stock `#ddd6c6`); deriving a shadcn preset by hand from the measured palette would have cancelled most of shadcn's benefit anyway. Radix still supplies the accessibility machinery the spec mandates (focus trapping, dismissable layers, roving tabindex) for the command palette and every picker. **Consequence:** pickers, the palette overlay and focus trapping are hand-wired in plans `01-04` and `01-09`, not generated. |
| Icon library | **Lucide** (`lucide-react`, ISC licence). Uniform 2px stroke, round linecaps/linejoins, outline-only — structurally satisfies "no filled glyphs mixed with outline ones." |
| Font | **Archivo** (OFL, Omnibus-Type) — a single self-hosted variable font (`wght` 100–900, `wdth` 62–125) covering both the workhorse grotesque cut (wdth 100, "Archivo") and the condensed companion cut for the stamped key and band headers (wdth ~75, "Archivo Condensed"). See `01-02-SUMMARY.md` for the tabular-figures verification and the note on why this ships as one variable file rather than two static families. |

### Component Inventory

Still omitted — `Tool: none` is now a **decision**, not a deferral. There is no shadcn registry to
enumerate under option `a-selfhost-radix`; the components this phase needs (pickers, command
palette, dialogs) are hand-authored against Radix primitives directly in the plans that need them
(`01-04`, `01-09`). `npx shadcn info` does not apply and will not be run.

### Registry Safety

Not applicable — no registry in use (`Tool: none`, decided).

### Radius Language — LOCKED 2026-09-09

Two radius tokens, never a hard-coded value:

| Token | Value | Usage | Rationale |
|-------|-------|-------|-----------|
| `--radius-strip` | `2px` | Strip stock rows — just enough softening to avoid a hard digital corner | Strips must read as near-square printed stock, authentic to the source material |
| `--radius-chrome` | `6px` | Interactive chrome — buttons, pickers, the command palette overlay | Chrome carries the mark's rounded-join character more openly, so app furniture stays visually distinct from the paper strip and the rack-vs-strip material split holds |

The focus ring follows the radius of whatever shape it wraps (strip radius on a strip, chrome
radius on a button/picker) rather than declaring its own.

---

## Surface Inventory

Every screen/region this phase ships:

| Surface | Kind | Always present? |
|---------|------|-----------------|
| App shell & window chrome | native macOS window, title bar, menu bar | yes, app-wide |
| Project switcher (left rail) | persistent chrome | yes, once ≥1 project is registered |
| Board list | primary surface | yes, per open project |
| Item detail | side panel | on demand (opened from a row) |
| Quick-add | inline row | on demand (created inline in the list) |
| Command palette | overlay | on demand (⌘K) |
| Search & filter | top-bar controls | yes, per open project |
| Activity trail | embedded section inside item detail | yes, whenever detail is open |
| First-run empty state | full-window state | only when zero projects are registered |
| Project-unreachable state | full-surface state, replaces board | only for a project whose marker fails verification (D-16) |

There is no kanban surface, no outline/tree surface, and no drag affordance anywhere in this phase
(D-01). There is no settings/customization screen for the hierarchy or workflow — rigidity is the
feature, and no affordance exists to reconfigure either (BOARD-01, BOARD-04).

---

## Information Architecture & Layout Topology

### App shell & window chrome

- Native macOS title bar, **visible** (not overlaid, not custom-drawn) — Phase 1 does not spend
  design budget re-skinning window chrome before the visual world is decided. Traffic lights behave
  natively.
- Window title: `{project name} — Flywheel` when a project is open; `Flywheel` when none is (first
  run). Single-window app in Phase 1 — no multi-window support.
- Minimum window width: **900px**, enforced via Tauri `minWidth`. Below the widths named in Row
  Anatomy, the OS simply refuses further shrinking rather than the UI attempting an unreadable
  layout.
- Menu bar (minimal, native, real destinations only — no placeholder items):
  - **Flywheel:** About Flywheel · Quit Flywheel (⌘Q)
  - **File:** Register Project… (⌘⇧O) · New Task (⌘N) · New Epic (⌘⇧N) · Close Window (⌘W)
  - **Edit:** standard macOS defaults (Cut/Copy/Paste/Undo/Redo) for native text-field behavior —
    nothing custom
  - **View:** Toggle Command Palette (⌘K) · Toggle Group By (if the secondary grouping lens ships,
    see Grouping below)
  - **Window:** standard macOS Window menu (Minimize, Zoom, Bring All to Front)
  - **Help:** deferred — no destination exists yet to point it at; flagged in Open Decisions rather
    than invented
  - The four custom File and View items above keep their printed shortcuts always — none is ever
    removed — but the app disables whichever ones the renderer's layer model would refuse
    whenever the item detail panel, a row-level picker, or the command palette is on top, so an
    item is never enabled-but-inert while a trapped layer is up (a disabled `MenuItem` also stops
    firing its key equivalent, which is what keeps a native accelerator like `⌘N` from reaching
    `on_menu_event` in the first place while the panel traps focus). Toggle Command Palette is the
    one exception that stays enabled over the detail panel (BOARD-07's discoverability
    guarantee) — it is disabled only under a row-level picker or the palette itself.

Corrected in plan `01-16` (G-01-1): the menu bar item list above is unchanged, but each custom
item's enabled state is now driven from `state/keyboard.ts`'s `bindingAllowedInLayer` via
`state/menuSync.ts`'s `useMenuLayerSync` and `src-tauri/src/commands/menu.rs`'s
`menu_set_action_enabled` — the affordance half of closing UAT gap G-01-1 (the native menu
accelerator bypassing the layer guard). The guard itself, and the fix's enforcement half, are
unchanged: `App.tsx`'s `menu:action` bridge now does nothing but `dispatchAction`, so a forwarded
id is admitted or refused identically whether it arrived as a keystroke or a click.

### Project switcher (left rail)

- A persistent narrow rail (collapsed width ~56–72px) on the left edge of the window, present
  whenever ≥1 project is registered. Not present pre-first-registration (see First-run state).
- Each entry shows the project's key prefix (e.g. `FLY`) as its glyph; the current project is
  visually distinguished (accent role, see Color & Token Roles). Hover or keyboard focus reveals the
  full project name via a tooltip.
- An unreachable project (D-16) renders its entry with a warning glyph *in addition to* its key
  glyph — never a colour change alone (see Accessibility). Selecting it opens the **Project
  unreachable** state instead of the board.
- A `+` affordance at the rail's bottom opens the registration flow (native macOS folder picker via
  Tauri's dialog API), the same flow as File → Register Project… (⌘⇧O).
- Keyboard: ⌘1…⌘9 switch directly to the Nth registered project (macOS tab-switch convention); the
  command palette also lists "Go to Project: {name}" for every registered project, so switching
  never depends on remembering a rail position.

### Board list (primary surface, D-01)

- A single dense, virtualized list, grouped by status (Backlog, Todo, In Progress, In Review, Done)
  in that fixed left-to-right/top-to-bottom order — never reorderable, never hideable as a set
  (individual groups can collapse, see below, but the five groups themselves are fixed).
- Each status group has a sticky header showing the status name and its item count (count remains
  visible even when the group is collapsed, so scale stays legible per BOARD-08's "no perceptible
  lag at 1,000+ items" — legibility of scale is part of that promise, not just render speed).
  Collapse/expand state is a local UI preference (Zustand, per-project), never written to the
  database — it is not board data.
- **How the three levels read in one flat list, without a tree:** Epics and Tasks are both workable
  items carrying the same fixed five-state workflow (see the flagged tension below) and both render
  as ordinary rows in their current status's group — an epic "In Progress" sits in the same group as
  its child tasks that are also "In Progress," never nested above them. The relationship reads
  through the row's **epic field** (a small pill showing the parent epic's key + title, truncated),
  not through visual indentation. This is deliberate: D-01 explicitly rejects an outline/tree.
- **Orphan tasks (D-13):** a task with no epic shows a muted "No epic" pill in that same field slot —
  never blank, never hidden, never requiring a filter to surface. Orphan tasks read exactly like any
  other task in their status group.
- **Issues:** per D-07, issues are proposals and notes, not units of work, and carry no acceptance
  criteria. This UI-SPEC reads that as issues also carrying **no five-state workflow status** in
  Phase 1 (PROP-* triage states are Phase 6, out of scope here). Issues therefore render in a
  separate, collapsible **"Issues"** region beneath the five status groups — ungrouped by status,
  sorted by rank/recency, each row showing key + title + kind (`bug`/`idea`/`question`/`risk`).
  **This is a judgment call, not a re-litigation of D-01/D-07/BOARD-04** (which is worded generically
  as "items"), and it is flagged in Open Decisions for planner/user confirmation before it locks in.
  Each issue row also carries a focusable **parent affordance** (plan `01-15`, G-01-EPIC-ASSIGN):
  it shows the epic or task key the issue currently sits under, or "No parent," and opens a picker
  (grouped Epics/Tasks options, reusing the same `ParentPicker` a task's own epic assignment uses)
  to reparent or detach it — a documented part of this surface, not an undiscoverable button.
- **Grouping affordances (delegated):** status grouping is the fixed, ever-on primary lens (D-01).
  A secondary **"Group by"** control (Status [default] / Epic / Assignee / Priority) is offered as a
  view-only lens over the same flat data — it changes clustering, never the underlying hierarchy or
  workflow, so it does not reopen any locked decision. This is scope the planner may cut without
  violating anything (Open Decisions #9).
- **Filters:** status (multi-select), epic (multi-select, including "No epic"), assignee
  (multi-select, including "Unassigned" — see the assignee-field flag below), priority, estimate,
  and free-text search — all executed as debounced indexed SQL in the Rust core (D-03); the renderer
  holds only the current result window, never a full copy to filter client-side. The epic filter's
  chip list covers every epic in the project, not only the epics present in the currently loaded
  window — corrected in plan `01-18` (G-01-2), which also removed the `FilterBar` prop that made
  the windowed derivation possible.

### Item detail — side panel (delegated decision)

**Decision: a side panel, not a full page and not a modal.**

**Why:** The persona is a developer supervising a fleet, glancing at the board dozens of times an
hour (PRODUCT.md "Operating Context"). A full page discards the list's context on every open —
wrong for a surface returned to constantly. A modal, per Impeccable's product constraints ("modal as
first thought is usually laziness… exhaust inline/progressive alternatives first"), blocks the list
entirely for what is frequently a quick glance-and-close interaction. A side panel keeps the list
visible and scrollable behind it, matches the row selection the user just made, and is the
Linear-reference-point's own pattern (D-01's explicit model).

- Fixed width **480px** in Phase 1 (not user-resizable yet — resizing is a cheap v1.1 add, not a
  structural decision, so it is not blocking).
- Opens via `Enter`/`o` on a selected row, or clicking a row. Closes via `Escape`, returning focus to
  the row that opened it.
- **Responsive rule:** below **1100px** total window width, the panel becomes an overlay (covers the
  right portion of the list with a scrim) rather than sharing horizontal space, so the list is never
  squeezed to unreadable column widths. Above 1100px, panel and list sit side by side.
- Contains: title (inline-editable), description (inline-editable), status/priority/estimate/
  assignee pickers, the acceptance-criteria list (tasks and epics only — never rendered for issues,
  per D-07), and the **Activity trail** (below).

### Quick-add (D-09)

- Inline row appended contextually — at the end of the group the user is focused in (or immediately
  below the currently selected row), never a separate dialog.
- `Enter` creates the item at the current position and immediately opens a new blank quick-add row
  below it, for rapid successive entry. `Escape` cancels without creating and closes the row.
- `Tab` while composing indents the new item to nest as a task under the nearest epic row above it in
  the same group; `Shift+Tab` outdents. This is the entirety of the nesting affordance in Phase 1 —
  there is no separate "assign epic" step required to nest at creation time.
- Detail and criteria are filled in afterward by opening the item (per D-09) — quick-add captures a
  title only.
- **Corrected in plan `01-20` (G-01-4):** opening quick-add guarantees the Backlog band is
  expanded first, because the row lives at the top of Backlog and a collapsed band would
  otherwise leave the keystroke with nothing focusable. Scoped to Backlog only, and to the
  current project only — no other band's collapse state is touched.
- **Corrected in plan `01-21` (CR-01):** that guarantee is a **one-time action** — taken when
  quick-add becomes reachable for a project (a fresh open, or the empty-board default) and on
  each explicit new open request — never a standing invariant re-asserted on every render. Band
  collapse is a local UI preference the user owns (see "Board list" above): a band the user
  collapses afterward stays collapsed until the user says otherwise, and pressing the new-task
  accelerator again is what re-expands it.

### Command palette (⌘K, D-02)

- Overlay, centered, opens over whatever surface currently has focus (list, detail panel, or app
  shell). Fuzzy-filters as the user types.
- Command set: every navigational and mutating action reachable elsewhere, so BOARD-07 coverage
  never depends on memorized single-letter bindings — see Keyboard Map for the exhaustive list of
  what the palette must expose.

### Search & filter

- A search field in the top bar (always visible, not itself inside the palette, since search is a
  primary daily action, not a discoverable extra). `⌘F` and `/` both focus it.
- Filter chips/dropdown sit adjacent to search in the top bar. See Board list bullet above for the
  filter dimensions.

### Activity trail (BOARD-09, D-19)

- Embedded as a scrollable section inside the item detail panel — not a separate surface, not a
  separate route.
- Rendered **newest-first** (top), even though the underlying query is ascending by event id
  (chronological by construction) — reversed for display because "what just happened" is the
  glance-value, matching the supervision persona.
- Each entry: actor (avatar/initial plus a badge distinguishing `human` vs `agent` vs `system`,
  never colour alone), a relative timestamp (absolute on hover), and a one-line human-rendered
  description built from the event's field-level before/after payload — e.g. "Changed status from
  Todo to In Progress," "Checked criterion 'Handles empty input,'" "Edited title." This is only
  possible because event payloads are designed for human rendering from day one (D-19's stated
  consequence).
- Initial window of 50 events with a "Load more" affordance beyond that — never renders an unbounded
  trail at once, consistent with the performance contract below.

---

## Row Anatomy (delegated decision)

**Fields, in fixed left-to-right order:** status glyph → key → title → estimate badge → epic pill →
assignee avatar → criteria checked/total → priority glyph → actor-of-last-change (avatar + relative
time).

**Corrected in plan `01-18` (G-01-2):** the epic pill's label is resolved from the project's full
epic roster (`useEpics`/`epic_list_all`) rather than from the currently loaded board window, so an
epic that sorts outside the loaded page still resolves. The pill has exactly three outcomes — `KEY
Title`, `No epic` (D-13's orphan-task bucket), and `Unknown epic` (see Copywriting Contract) — and
a long epic title follows the same truncate-never-wrap rule as the row's own title.

**Row layout decision:** rows are **fixed-height, single-line, truncate-not-wrap.** Titles never
wrap; they truncate with an ellipsis and expose the full text via native tooltip on hover/focus. This
is a deliberate simplification over RESEARCH.md's variable-height `measureElement` suggestion: a
dense, Linear-style list (D-01) reads better as uniform rows, and fixed-height virtualization is
cheaper and more predictable than measured virtualization — a direct improvement to BOARD-08's "no
perceptible lag" story, not a regression against it. The full, unwrapped title is always available in
the detail panel.

**Never dropped, at any supported window width (≥900px):**
- status glyph (a shape, not a colour — see Accessibility)
- key (`FLY-142`, monospace, fixed-width column)
- title (flex-grow, always the last thing to lose space)
- priority glyph
- **criteria checked/total** — D-08 requires this "visible wherever the item appears"; it is
  structurally exempt from the truncation ladder below, not merely last on it.

**Progressive disclosure ladder (first field dropped as width narrows, in this order):**
1. actor-of-last-change (avatar + timestamp) — first to go
2. epic pill
3. assignee avatar
4. estimate badge — last of the optional fields to go, before hitting the 900px floor

**Row height:** a single constant `estimateSize` for `@tanstack/react-virtual` (no
`measureElement`), overscan 8–12 rows.

**Minimum interactive hit target:** macOS is pointer-precise, not touch — the 44px touch-target
guideline does not apply. Minimum click/tap target for row-level icon affordances (status/priority
glyphs) is **24px**, with the row's full height as a fallback click target for opening detail.

**Status glyph (shape-based, not colour-based):** Backlog = dashed empty circle · Todo = empty
circle · In Progress = half-filled circle · In Review = circle with an eye/dot mark · Done = filled
circle with a check mark. Shape carries the meaning; colour is a redundant second channel, filled in
by the direction contract.

**Priority glyph:** a stacked-bars icon whose filled-bar count increases with priority level
(Linear-style), rendered in the priority-channel token role — **RESOLVED, Open Decisions #6:** 5
levels, No priority / Urgent / High / Medium / Low, keyed `0`–`4`; `No priority` sorts last despite
being keyed `0` (see Open Decisions #6 for the load-bearing ordering detail).

**RESOLVED, Open Decisions #4.** The assignee field (avatar, filter, `a` keybinding) is in scope: a
nullable `assignee_id` exists on tasks/epics, per BOARD-06's assignee-filtering requirement.

---

## Keyboard Map (BOARD-07 — exhaustive)

### Focus & selection model

Exactly one focus owner at a time, among: project rail, search field, board list (roving focus over
virtualized rows, not native tab order across 1,000+ DOM nodes), quick-add input, item detail panel,
command palette. `Tab`/`Shift+Tab` move between these regions; within a region, the bindings below
apply.

**Focus surviving a pushed delta (D-04) — hard requirement:** selection tracks the selected item's
**id**, never its list index. When the core pushes an event-log delta and the UI invalidates and
refetches:
- If the selected item's row position changes (someone reprioritized it), selection follows the same
  id to its new position; the viewport scrolls the minimum amount needed to keep it visible — it
  never resets to the top of the list.
- If the selected item is removed from the current filtered window (deleted, or newly excluded by an
  active filter), selection moves to the next-nearest surviving id in the previous order.
- This transition is a plain state change, not an animated re-render flash (see Motion). **A list
  that re-sorts under the user's cursor without preserving identity is a defect**, not a stylistic
  choice.

**Quick-add's focus delivery (corrected in plan `01-20`, G-01-4) — hard requirement:** the
"focused" promised by the Global table's ⌘N and ⌘⇧N rows below must survive virtualization. The
mechanism: opening quick-add raises a one-shot focus request in the UI store; the board scrolls
the quick-add row into view by the minimum distance needed; the row focuses its own input from an
effect when it mounts, consuming the request exactly once — so a row the virtualizer mounts late
still receives the cursor. Mount-time `autoFocus` alone is **not** sufficient on a virtualized
row and is retained only for the empty-board default (State Inventory's "zero items" row); a
request that is never consumed is cleared the moment quick-add closes; and a row re-mounting for
any other reason (the user scrolling back to it) must not take focus a second time. None of this
may happen for a keystroke the layer guard refused: a refused ⌘N/⌘⇧N leaves focus, the scroll
offset and every band's collapse state untouched.

### Global (anywhere in the app)

| Key | Action |
|-----|--------|
| ⌘K | Open command palette |
| ⌘1…⌘9 | Switch to the Nth registered project |
| ⌘F or `/` | Focus search field |
| ⌘⇧O | Register a new project |
| ⌘N | New task (opens quick-add, focused, in the current group) |
| ⌘⇧N | New epic (opens quick-add, focused, at the top level) |
| Escape | Close the top-most open layer (palette → detail panel → quick-add → clear selection), one layer per press |

### Board list (focus in the list, no text field focused)

| Key | Action |
|-----|--------|
| `j` / ↓ | Move selection down one row |
| `k` / ↑ | Move selection up one row |
| Home / End | Jump to first / last row in the current view |
| Enter / `o` | Open selected item in the detail panel |
| `c` | Create new item (opens quick-add at current position) |
| `s` | Open status picker for the selected item; while open, `1`–`5` select Backlog/Todo/In Progress/In Review/Done directly |
| `p` | Open priority picker for the selected item; while open, `0`–`4` select levels directly |
| `e` | Open estimate picker for the selected item |
| `a` | Open assignee picker for the selected item |
| `m` | Open epic picker for the selected item; tasks only — an epic has no epic parent |
| ⌘↑ / ⌘↓ | Reorder the selected item up/down within its priority band (manual rank, D-11) |
| ⌘⌫ | Delete selected item (destructive confirmation, see Copywriting Contract) |
| Escape | Clear selection |

### Quick-add (focus in the inline title input)

| Key | Action |
|-----|--------|
| Enter | Create item at current position; open a new blank quick-add row below for rapid entry |
| Tab | Nest the new task under the epic the current selection implies — the selected epic, or the selected task's epic; does nothing while quick-add is composing an epic |
| Shift+Tab | Remove the nesting |
| Escape | Cancel without creating; close the row |

Corrected in plan `01-15` (G-01-EPIC-ASSIGN): the original wording ("nest under the nearest epic
row above") named a row that can never exist, because quick-add is pinned to the top of the
Backlog band (see "Quick-add lives at the top of Backlog" in `BoardView.tsx`'s `rows` memo) — there
is never a row above it to be "nearest" to. The shipped behavior nests under whatever the current
selection implies instead, which is reachable from any selection state.

### Item detail panel (focus inside the panel)

| Key | Action |
|-----|--------|
| Escape | Close panel; return focus to the row that opened it |
| Tab / Shift+Tab | Move between fields (title, description, criteria list, pickers) |
| ⌘Enter | Save and close the currently edited field |
| `n` (criteria list focused) | Add a new criterion inline |
| Space / Enter (on a criterion row) | Toggle that criterion's checked state |
| `j` / `k` (criteria list focused) | Move between criteria rows before toggling |
| ⌘⌫ | Delete current item (destructive confirmation) |

### Command palette (focus in the palette)

| Key | Action |
|-----|--------|
| type | Fuzzy-filter commands and items |
| ↑ / ↓ | Move selection |
| Enter | Execute selected command |
| Escape | Close palette, restore focus to the triggering element |

**Palette command set (must include, so nothing is reachable only by memorized letter):** Go to
Project: {name} (one per registered project) · Register Project… · Create Task · Create Epic ·
Create Issue · Search Board · Filter by Status / Epic / Assignee / Priority · Toggle Group By · every
hot action available on the currently selected item (Set Status, Set Priority, Set Estimate, Set
Assignee, Set Epic, Delete).

---

## State Inventory

| Surface | State | Behavior / Copy |
|---------|-------|------------------|
| App (first run) | Zero projects registered | Full-window empty state, no project rail shown. See Copywriting Contract for exact copy. |
| Board | Project has zero items | Empty state within the list area; quick-add is already visible and focused so the first keystroke creates the first item. |
| Board | Empty filter/search result | Distinct copy from "zero items" — clarifies filters are active, offers "Clear Filters." |
| Board | Loading (cold project switch / initial query) | Skeleton rows matching row anatomy's shape, count filling the viewport — never a spinner in the middle of content (Impeccable operate.md). No layout shift when real data arrives. |
| Board | In-flight search/filter (debounced query round trip) | A small non-blocking indicator inside the search field itself; the currently-visible window never re-skeletons on a refetch, only on true zero-to-first-paint. |
| Board / Detail | Mutation or query error | Tauri `invoke` errors return synchronously (not via the push channel per D-04) — render as a transient inline toast anchored to the bottom of the window, persisting until dismissed or superseded (never auto-dismissing before it can be read, since this is expert software, not a marketing site). |
| Project switcher | Project unreachable (D-16) | Rail entry shows a warning glyph + "Unreachable" text (never colour alone). Selecting it opens a dedicated reconciliation state replacing the board: explains the marker mismatch, offers only "Locate Project…" (native folder picker) — never an auto-scan, never a silent rebind. |
| Board | 1,000+ item overflow | Virtualization renders only the visible window; group headers show item counts (numbers, not just density) so scale stays legible even when a group is collapsed. |
| Board row | Long title | Single-line truncation with ellipsis; full text via native tooltip on hover/focus; detail panel always shows the untruncated title. |
| Board / Detail | Moving an item to Done with unchecked criteria (D-08) | Non-modal inline confirmation requiring one keypress: "{checked}/{total} criteria unchecked. Mark Done anyway?" `Enter` confirms, `Escape` cancels and reverts the status change. Deliberately not a modal dialog — D-08 "warns but does not block," and a modal would block the rest of the list, which contradicts that intent even though a bare inline prompt still requires one acknowledgment for that specific action. |
| Board / Detail | Destructive delete (task/epic/issue) | Confirmation names the item type, key and title explicitly; see Copywriting Contract. |

---

## Performance Contract (BOARD-08)

- **Virtualization:** `@tanstack/react-virtual`, fixed `estimateSize` (see Row Anatomy — no
  `measureElement`), overscan 8–12 rows. **Corrected in plan `01-20` (G-01-4):** the renderer
  issues exactly one programmatic scroll — quick-add's scroll-into-view — addressed by **row
  index** into the current project's row list, never by item id, using the virtualizer's own
  index-scroll API with minimum-distance alignment (see "Quick-add's focus delivery" above).
- **Query window:** the Rust core returns a bounded, indexed page (e.g. `LIMIT 200`) per D-03; the
  renderer requests the next window via cursor-based pagination keyed by `(status, rank)` as the
  user scrolls near the loaded window's end. The renderer never holds all 1,000+ rows in memory at
  once, and never re-implements filter/sort/search client-side (D-03, hard).
- **Debounce:** 150ms keystroke-to-query debounce on search/filter inputs (per RESEARCH.md Flag 6).
- **What must never happen on the renderer's main thread:** any client-side filter/sort/search pass
  over a full item array; synchronous parsing of large activity-trail JSON payloads in one block —
  paginate the trail query too (see Activity trail, 50-event window). Quick-add's scroll-into-view
  must not introduce per-row measurement (the fixed `estimateSize` above stands) and must not
  become a client-side pass over the full item array either (plan `01-20`, G-01-4).
- **Measurable latency targets, each test-assertable:**
  - *Keystroke-to-paint* (search/filter typing): render settles within 250ms of the user pausing,
    measured at 1,000+ items in the project.
  - *Search-to-result* (Rust core query itself): under 50ms server-side at 1,000+ items — assertable
    directly via `cargo test --test perf_seed_1000` (RESEARCH.md already names this test hook).
  - *Reorder-to-settled* (keybinding press → row visually settled in new position): under 100ms —
    a single-row `UPDATE` plus the pushed-delta round trip.
  - *Picker open-to-usable* (status/priority/estimate/assignee): under 50ms — pure client-side UI
    state; the round trip to the core only happens after a choice is made, not to open the picker.
  - *List scroll*: 60fps through the full virtualized window at 1,000+ items. No automated e2e
    harness exists yet for this (RESEARCH.md notes Tauri WebDriver friction) — treat as a manual UAT
    check (`/gsd-verify-work`) for Phase 1, not a gap that blocks the phase.

---

## Motion

Intent and role only — no durations, easing curves, or choreography; those belong to the direction
contract (Open Decisions #1).

- **What moves, and why:** the selection highlight transitions between rows (signals "you moved,"
  not decoration); the detail panel slides in from the trailing edge (signals it is a peer surface
  anchored to the list, not a modal takeover); a status group's collapse/expand animates its height
  (so the list never jump-cuts); the Done-with-unchecked-criteria prompt appears briefly (no bounce);
  the command palette fades/scales in on open (standard palette pattern).
- **What must never move:** unrelated rows must never animate on a pushed-delta refetch unless their
  own position actually changed — one row's edit must not visually jostle its neighbours; no
  page-load choreography (Impeccable product constraint); no decorative hover motion beyond a static
  colour/elevation change (no bounce, no icon wiggle); the activity trail renders fully populated
  instantly on open — it does not animate each historical event into place.
- **`prefers-reduced-motion`:** all of the above collapse to instant state changes (snap, no
  interpolation) when set. This is a hard requirement, not best-effort — this is expert software run
  all day, and motion sensitivity is a real accessibility need here, not an edge case.
- Impeccable's `operate.md` gives a 150–250ms floor for product-UI transitions as a general
  guideline; the direction round should confirm or adjust it once real motion is designed — this
  document does not fix a number.

---

## Accessibility

- **Full keyboard operability (BOARD-07) is a hard product requirement, not a nicety** — every
  action in the Keyboard Map is reachable without a mouse; nothing exists only as a drag affordance
  (D-01 explicitly rejects drag for status changes).
- **Focus visibility:** every focusable element has a visible focus ring distinct from hover and
  selection. A selected-but-unfocused row (e.g. after `Escape` from the detail panel) must look
  visibly different from a focused row — see the `row-surface-selected` vs.
  `row-surface-selected-unfocused` token roles below.
- **Never colour alone:** status uses a distinct *shape* per state (see Row Anatomy) in addition to
  its colour role; priority uses a bar-count icon in addition to its colour role; the
  unreachable-project warning pairs an icon with the literal word "Unreachable," never a coloured dot
  alone.
- **Accessible names for virtualized rows:** each row's accessible name concatenates key, title,
  status, and priority (e.g. "FLY-142, Fix crash on quit, In Progress, priority High"). Virtualization
  must not silently break linear screen-reader navigation as rows scroll out of the mounted window —
  use `aria-setsize`/`aria-posinset` (or the ARIA grid/listbox pattern) so total count and position
  are announced even though only a window is mounted in the DOM.
- **Focus trapping:** the command palette and every picker (status/priority/estimate/assignee) trap
  focus while open and restore it to the triggering element on close.
- **Contrast:** every token role below must meet WCAG AA against its paired surface at minimum. This
  is a binding obligation on whatever the direction contract supplies — not an optional nicety
  deferred alongside the palette itself.

---

## Spacing Scale

Structural, not a visual-identity decision — safe to lock now.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon gaps, inline padding |
| sm | 8px | Compact element spacing (row-internal gaps) |
| md | 16px | Default element spacing |
| lg | 24px | Section padding (detail panel sections) |
| xl | 32px | Layout gaps |
| 2xl | 48px | Major section breaks |
| 3xl | 64px | Page-level spacing |

Exceptions: no 44px touch-target minimum applies (macOS desktop, pointer-precise input — see Row
Anatomy's 24px minimum interactive target instead).

---

## Typography

Sizes and weights are structural density decisions for a dense, Linear-style list and are locked now.
**Font family is not** — see Design System. No "Display" role: per Impeccable's `operate.md`,
product UI rarely needs a display face, and this is pure product surface with no marketing content.

| Role | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| Micro | 10px | Regular (400) | 1.2 | Badges, counts (criteria checked/total, estimate) |
| Label | 11px | Regular (400) | 1.3 | Metadata (epic pill, assignee, actor + timestamp) |
| Body | 13px | Regular (400) | 1.4 | Row titles, primary field content, description text |
| Heading | 15px | Semibold (600) | 1.25 | Panel section headers, status group headers |
| Display | not used | — | — | No marketing/display type on this surface (Impeccable `operate.md`) |

Exactly two weights across the whole surface: Regular (400) for body content, Semibold (600) reserved
for headings and the current-selection/emphasis state — never used decoratively.

---

## Color & Token Roles

**The visual world is now CHOSEN** (see Selected Direction — Flight Progress Strips). The role table
below still governs — it is the distinguishability contract, and it survives any revision of the
values. What follows it is the measured starting palette.

### Pinned brand, and the lifts it requires

`#3c64dd` (`hsl(225,70%,55%)`) is pinned by the owner. **The pin is on the hue, not the hex** — the
owner's own recorded rule: *"a brand that cannot be read on its own product surface has not been
honoured by being pasted in unchanged."* Measured here at the point of decision, per the inherited
house method:

| Pair | Ratio | Verdict |
|------|-------|---------|
| `#3c64dd` on rack `#1e232b` | **3.05:1** | Clears WCAG 1.4.11's 3:1 non-text minimum. **Fails AA 4.5:1 for body text.** Non-text use only. |
| `#7d99ff` on rack `#1e232b` | **5.92:1** | Clears AA. This is the inherited `--color-brand-lift` from HighKnow's existing token file, same hue — reused because the fact is identical. Use for any brand-coloured **text or glyph on the rack**. |
| `#3c64dd` on strip `#ddd6c6` | **3.57:1** | Clears 3:1 non-text (focus ring, rule, selection edge). **Fails AA for body text.** |
| `#2d4fb8` on strip `#ddd6c6` | **4.97:1** | Clears AA. Use for brand-coloured **text on a strip**. Lightest step in this hue family that passes; `#3459c9` measures 4.24 and fails. |

**These ratios are not the proof — a runnable assertion is.** The house method requires them
re-verified by a contrast test in the codebase, not by this table. Wave 0 owes that test.

### Measured starting palette

Rack (dark chrome):

| Token role | Value | Measured |
|---|---|---|
| `surface-dominant` — window ground | `#171b22` | — |
| `surface-secondary` — rail, band headers, panel frame | `#1e232b` | — |
| `divider` — rail hairline | `#2c333e` | Region divider, not an interactive boundary; 1.4.11 does not apply |
| `text-primary` on rack | `#eef1f6` | 13.94:1 ✓ |
| `text-muted` on rack | `#9aa4b5` | 6.28:1 ✓ |
| `accent` text/glyph on rack | `#7d99ff` | 5.92:1 ✓ |
| `accent` non-text on rack | `#3c64dd` | 3.05:1 ✓ non-text only |

Strip stock (the content plane) — five state tints, one paper family:

| State | Value | Ink `#1e232b` on it |
|---|---|---|
| Backlog | `#e6e1d6` | 12.10:1 ✓ |
| Todo | `#dfe4ea` | 12.34:1 ✓ |
| In Progress | `#efe6c8` | 12.64:1 ✓ |
| In Review | `#e6ddec` | 11.96:1 ✓ |
| Done | `#dde9dc` | 12.60:1 ✓ |

Ink and accents on strip stock (measured against the darkest stock, `#ddd6c6` reference):

| Token role | Value | Measured |
|---|---|---|
| `text-primary` | `#1e232b` | 10.90:1 ✓ |
| `text-muted` | `#4a5261` | 5.43:1 ✓ — tinted from the surface's own hue, never neutral grey (house rule) |
| `accent` text | `#2d4fb8` | 4.97:1 ✓ |
| `focus-ring` / selection edge | `#3c64dd` | 3.57:1 ✓ non-text |
| `destructive` text | `#9c351c` | 4.94:1 ✓ — `#b8452a` measures 3.70 and fails AA |

**The five tints are close in luminance by necessity** (ink must clear AA on all of them), so they
**cannot carry status alone**. The printed status word and the Row Anatomy shape glyph are
load-bearing. This is the same obligation the role table states; the palette does not relax it.

The conceptual 60/30/10 split applies structurally: rack dominant, rail/panel secondary, brand
reserved for exactly one thing — the current position.

| Role | Distinguishability Obligation | Usage |
|------|-------------------------------|-------|
| `surface-dominant` (~60%) | — | App background |
| `surface-secondary` (~30%) | Must read as visually receded behind `surface-dominant` | Project rail, detail panel background, sticky group headers |
| `accent` (~10%) | Reserved strictly for: the primary quick-add active state, the selected command in the palette, the current project in the rail, and the focused-row selection indicator. **Never** for decoration, and never more than one "loudest" element per view at a time (Impeccable: Restrained is the floor for product UI). | Primary interactive emphasis only |
| `destructive` | Must be distinguishable from `accent` without relying on the user recognizing which is "more saturated" — pair with an icon (see below) | Delete confirmations, destructive buttons, unreachable-project warning glyph |
| `status-channel` | 5 distinguishable values, each additionally paired with the shape glyph in Row Anatomy — never colour alone, and must remain distinguishable under macOS Increase Contrast and common colour-vision deficiencies | The five workflow states |
| `priority-channel` | Distinguishable levels, each paired with the bar-count icon in Row Anatomy; must not be confusable with `status-channel` at a glance | Priority indicator |
| `text-primary` | AA contrast against `surface-dominant` and `surface-secondary` | Row titles, primary content |
| `text-muted` | AA contrast while visually receding behind `text-primary` | Metadata (epic pill, assignee, actor+timestamp, estimate badge) |
| `focus-ring` | Must be visible against every other surface role it can appear on | Keyboard focus indicator |
| `divider` | — | Group separators, panel border |
| `row-surface` / `row-surface-hover` / `row-surface-selected` / `row-surface-selected-unfocused` | All four must be simultaneously distinguishable from one another (a selected-but-blurred row must not look identical to a focused-and-selected row) | Board row states |

---

## Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA (board, ongoing use) | Quick-add placeholder: "Type a title, press Enter to create…" (issues lane: "Add an issue…") |
| Primary CTA (first run) | Button: "Register Project…" |
| Empty state heading (first run) | "No projects yet" |
| Empty state body (first run) | "Register a local git repository to see its board. Flywheel never touches board content in the repo itself — only a small marker file." |
| Empty state heading (empty project) | "This board is empty" |
| Empty state body (empty project) | "Start typing below to create your first task or epic. Press Enter to save it." |
| Empty state heading (empty filter result) | "No items match these filters" |
| Empty state body (empty filter result) | "Try removing a filter or clearing the search." — CTA: "Clear Filters" |
| Epic pill, epic not resolvable | "Unknown epic" — distinct from the orphan-task "No epic" copy above; an internal identifier is never rendered in its place. Corrected in plan `01-18` (G-01-2). |
| Loading state | No copy — skeleton rows only, matching row anatomy's shape. |
| Error state (mutation/query failure) | "Couldn't {action} — {reason}. [Retry]" e.g. "Couldn't save this task — the database is unavailable. [Retry]" |
| Error state (search failure) | "Search failed — {reason}. Showing the last known results. [Retry]" |
| Project unreachable heading | "Can't find this project" |
| Project unreachable body | "Flywheel expected {project_name} at {last_known_path}, but the repository marker there no longer matches. Nothing was scanned or guessed automatically." — CTA: "Locate Project…" |
| Done-with-unchecked-criteria warning | "{checked}/{total} criteria unchecked. Mark Done anyway?" — `Enter` confirms, `Escape` cancels. |
| Destructive confirmation (delete) | Heading: "Delete {ItemType} {key}?" Body: "\"{title}\" and its acceptance criteria will be permanently removed. This can't be undone." Buttons: "Delete" (destructive role) / "Cancel." |
| Command palette empty result | "No matching commands or items" |

---

## UI Considerations

**The volume lesson (plans `01-19`/`01-20`, gaps G-01-2 and G-01-4):** two consecutive major UAT
gaps in this phase shared one root shape — an assumption true at small N and false at volume —
and neither was reachable by any fixture in the desktop suite, whose ceiling was 13 rows
(`epic-roster.test.tsx`) before this round. `packages/desktop/src/board/__tests__/volume.ts` is
the shared, self-checking fixture that now exists so a volume-shaped assertion does not have to be
rebuilt from scratch a third time.

State coverage resolved against this phase's shape (empty / loading / error / populated / partial /
overflow / long-text). Empty- and error-state **copy** live in Copywriting Contract above; this
section covers coverage status and references those rows rather than restating them.

Applicable state considerations resolved: 12 covered, 2 backstop, 0 unresolved.

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| zero-one-many | status band collapse toggle, quick-add open | ✅ covered | **Attributed to plan `01-21` (CR-01).** Collapse is user-owned (see "Board list" above); the automatic expansion fires on the rising edge of quick-add becoming reachable only, never on every render. The zero-item project is the case where the prior behavior was permanently inert: `effectiveQuickAddOpen` is always true there, so an unguarded re-assertion never went false. |
| empty | board list, zero items | ✅ covered | Quick-add is pre-focused; see Copywriting Contract "empty project" rows. |
| empty | board list, zero filter matches | ✅ covered | Distinct copy from zero-items empty state; "Clear Filters" CTA. |
| empty | first-run, zero projects | ✅ covered | Full-window state, no rail shown; see Copywriting Contract "first run" rows. |
| loading | board list, cold query | ✅ covered | Skeleton rows, no layout shift on data arrival (State Inventory). |
| loading | search/filter round trip | ✅ covered | In-field non-blocking indicator; window never re-skeletons (State Inventory). |
| error | mutation/query failure | ✅ covered | Persistent inline toast, synchronous invoke error path (State Inventory, Copywriting Contract). |
| error | project unreachable (D-16) | ✅ covered | Dedicated reconciliation state; explicit relocation only (State Inventory, Copywriting Contract). |
| overflow | board list, 1,000+ items | ✅ covered | Fixed-height virtualization + visible group counts (Performance Contract, State Inventory). **Amended in plan `01-20` (G-01-4):** this row's original claim covered rendering rows at volume, not focusing an off-window one — G-01-4 proved the quick-add row's focus needed its own coverage; see the row below. |
| overflow | quick-add row, board scrolled past the mounted window | ✅ covered | Scrolled into view and focused from an effect rather than relying on mount-time focus (see "Quick-add's focus delivery," Keyboard Map). Attributed to plan `01-20` (G-01-4). |
| long-text | row title | ✅ covered | Truncate-not-wrap + native tooltip; full text in detail panel (Row Anatomy). |
| zero-one-many | acceptance criteria, 0 vs many | ✅ covered | Checked/total badge always visible (D-08); Done-warning fires only when total > 0 and unchecked > 0. |
| partial | activity trail beyond 50 events | 🧪 backstop | "Load more" affordance assumed sufficient; not verified against a real 1,000+-event trail in this spec — executor should confirm pagination feels adequate during UAT. |
| overflow | project rail with many registered projects | 🧪 backstop | ⌘1–⌘9 covers the first nine; behavior beyond nine projects (scroll? overflow menu?) is not specified here — flagged for the planner to resolve, not silently dropped. |

---

## Open Decisions the Builder Must Not Invent

1. **The visual world — RESOLVED 2026-09-09, no longer blocked.** Both gates cleared. Gate A: the
   owner supplied the pinned brand colour `#3c64dd` and the HighKnow mark (`logo.svg`). Gate B: an
   Impeccable direction round (seed `59b0beb9`) returned **Flight Progress Strips**, chosen by the
   owner over the assigned roll. See **Selected Direction** above and the measured palette in Color
   & Token Roles. The three items that remained open inside the chosen world were closed by the
   owner on 2026-09-09 at plan `01-02` Task 1's decision checkpoint:
   - **The typeface — RESOLVED.** Archivo (OFL, self-hosted, variable). See Selected Direction § Type.
   - **The radius and stroke language — RESOLVED.** `--radius-strip: 2px`, `--radius-chrome: 6px`.
     See Design System § "Radius Language."
   - **Whether Flywheel carries the HighKnow lightbulb-brain mark or earns its own under it** —
     **RESOLVED 2026-10-07, owner decision: the HighKnow lightbulb-brain mark, for now.** Taken to
     unblock Phase 8.1's app icon and direction round; Flywheel earning its own mark under HighKnow
     stays available if it ever gets a commercial identity of its own. Recorded in
     `.planning/PROJECT.md` § Key Decisions.
     It did not block Phase 1: no surface in this spec renders a logo except the app icon and the
     About item. **Two corrections to the previous text of this bullet**, both found 2026-10-07:
     (1) it said the decision was "recorded as open in `PRODUCT.md`" — no `PRODUCT.md` exists in
     this project, the file is `PROJECT.md`, so the pointer dangled and the decision was recorded
     nowhere for a month; (2) Gate A above claims the owner supplied the mark as `logo.svg`, but no
     `logo.svg` exists anywhere in the repository, so Phase 8.1 must PRODUCE the asset, not wire up
     an existing one.
2. **shadcn / component-library adoption, and its preset — RESOLVED 2026-09-09.** Option
   `a-selfhost-radix`: no shadcn preset is derived; `shadcn` is not initialized at all. Self-hosted
   type plus hand-rolled unstyled Radix primitives supply the accessibility machinery instead. See
   Design System above for the full rationale and its consequence for plans `01-04`/`01-09`.
3. **Icon library — RESOLVED 2026-09-09.** Lucide (`lucide-react`, ISC). Uniform 2px stroke, round
   linecaps/linejoins, outline-only.
4. **Assignee field existence (RESEARCH.md Open Question A3) — RESOLVED 2026-09-09, owner decision,
   plan `01-03` Task 1.** **ACCEPTED.** A nullable `assignee_id TEXT REFERENCES actors(id)` exists on
   both `tasks` and `epics` (migration `0002_board_schema.sql`). BOARD-06 requires filtering by
   assignee and the `actors` table already exists from migration `0001_actors.sql`. Every assignee
   affordance named in this document — badge, filter, `a` keybinding — stays in scope; none was
   removed.
5. **Whether Epics and Tasks share the on-board five-state workflow while Issues are workflow-less
   — RESOLVED 2026-09-09, owner decision, plan `01-03` Task 1.** Option `uispec-reading` taken: this
   spec's reading stands as implemented behavior. `epics` and `tasks` share ONE `status` CHECK
   (`backlog|todo|in_progress|in_review|done`, BOARD-04) and one band-rendering path. `issues` carry
   no `status` column and keep their own separate, workflow-less lane in Phase 1 — the triage
   lifecycle (`proposed/triaged/accepted/rejected/merged_into_task`) is Phase 6's addition per
   `ARCHITECTURE.md` §2, out of scope here. Rationale: D-07 gives epics their own success criteria
   and therefore their own notion of done, so epics are units of work and belong in the five bands
   the Flight Progress Strips direction is built on.

   **This does not discard `ARCHITECTURE.md` §2's epic lifecycle language — it re-homes it.** The
   sketched `draft|active|integrating|done|archived` enum maps onto the five-state workflow plus two
   orthogonal columns, both added in migration `0002_board_schema.sql` now so Phase 8 needs no
   further schema change:
   - `integrating` → status `In Review` **plus** a nullable `epics.integration_branch TEXT` column.
   - `archived` → a nullable `epics.archived_at` timestamp, orthogonal to workflow — an archived epic
     retains whatever status it had.
   - `draft` / `active` → `Backlog` / `In Progress` respectively (no schema consequence — same status
     column, same values already listed above).
6. **Priority scale cardinality and labels — RESOLVED 2026-09-09, owner decision, plan `01-03` Task
   1.** 5-level Linear convention: **No priority / Urgent / High / Medium / Low**, keyed `0`–`4`
   exactly as this document's keyboard map already specifies. D-11 fixes the tie-break rule (priority
   sorts first, manual rank orders within a band); the label set above is what fixes the cardinality
   this item left open.

   **Load-bearing ordering detail:** `No priority` is `0` in the keymap but **sorts last**, not
   first — sorting unprioritised items first would hijack the top of every rack, which D-11's
   "priority sorts first" intent never meant. `packages/core::query::list_board`'s `ORDER BY`
   maps `priority = 0` to the bottom of the priority ordering explicitly (not by relying on the
   keymap's numeric value), and an explicit test in `packages/core/tests/outbox.rs` asserts a `No
   priority` item sorts below a `Low` item.
7. **Estimate scale (S/M/L vs. Fibonacci) — RESOLVED 2026-09-09, owner decision, plan `01-03` Task
   1.** **S / M / L**, stored as a nullable ordinal `INTEGER` 1–3 (`S=1, M=2, L=3`) — displayed as the
   letters, never as the number, so it sorts and filters natively without a lookup table. Per D-12 it
   is rendered and filterable and **aggregated nowhere** — no velocity, no burndown, no capacity, no
   sum or average anywhere in the UI or in any query. The letters were chosen over numeric points
   specifically because points invite the aggregate reading D-12 bans.
8. **Help menu destination** — the menu bar's Help item has no real destination to point to yet; not
   invented here.
9. **Whether the "Group by" secondary lens ships in Phase 1 at all** — included as a delegated
   enhancement over the fixed status grouping; the planner may cut it to reduce scope without
   violating any locked decision, since status grouping alone already satisfies D-01.
10. **Project-rail behavior beyond nine registered projects** — ⌘1–⌘9 covers the first nine; overflow
    handling (scroll vs. menu) is unresolved (see UI Considerations backstop row).
11. **Project key prefix origin (CONTEXT.md "Claude's Discretion") — RESOLVED 2026-09-09, owner
    decision, plan `01-03` Task 1.** User-typed with a derived default: at project registration, the
    registration flow pre-fills a suggested prefix derived from the repository directory name, and
    the user may type over it before confirming. The prefix is validated as short, uppercase,
    typeable and greppable (per D-10). **Once the first item in that project has been allocated a
    key, the prefix becomes immutable** — enforced in `packages/core::domain::project`, not merely
    documented, because `D-10` makes the key one-way once branches and commit trailers in real git
    history carry it. Keys are `PREFIX-N` with a monotonic per-project counter allocated in the same
    transaction as the insert (D-10), so there are no gaps and no races.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS
- [ ] Dimension 7 Inventory Provenance: PASS

**Approval:** pending
