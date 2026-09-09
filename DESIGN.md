# DESIGN.md — Phase 1, Plan 01-02

**Status:** The Flight Progress Strips visual world is authored. This plan ships the theme
foundation — token roles, type scale, motion contract, and the marks legend — that every board
surface built from `01-03` onward consumes. It does not ship the board itself (rail, strips,
detail panel, palette): those land starting `01-03`.

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
