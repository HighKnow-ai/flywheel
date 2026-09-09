# DESIGN.md — Phase 1

**Status:** The Flight Progress Strips visual world is authored (`01-02`) and its first real
surface is built (`01-03`): a working rack — registration, the five status bands, quick-add,
persistence. The project rail, command palette, item detail panel and pickers land in later
plans.

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
