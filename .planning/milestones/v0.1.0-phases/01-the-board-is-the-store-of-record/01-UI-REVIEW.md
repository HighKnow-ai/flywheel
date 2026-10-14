---
phase: "01"
slug: "the-board-is-the-store-of-record"
audit_date: "2026-09-10"
audited_against: "01-UI-SPEC.md"
method: "code-only (no browser MCP available; workflow.live_dom_uat is off)"
overall: 18
max: 24
pillars:
  copywriting: 3
  visuals: 2
  color: 4
  typography: 3
  spacing: 3
  experience_design: 3
---

# Phase 01 — UI Review

Retroactive 6-pillar visual audit of the implemented frontend, graded against `01-UI-SPEC.md`'s
design contract (943 lines, direction **Flight Progress Strips**, seed key `59b0beb9`).

**Overall: 18/24**

| Pillar | Score | One-line verdict |
|--------|-------|------------------|
| Copywriting | 3/4 | 13 of 14 contract rows implemented verbatim; the search-failure state has no copy |
| Visuals | 2/4 | Rack/strip world is real and disciplined, but **two of the direction's own signature moves are missing** |
| Color | 4/4 | Zero hardcoded hex outside the token file; contrast proved by a runnable test, not a table |
| Typography | 3/4 | Scale and two-weight rule exact; the condensed cut is defined but used nowhere |
| Spacing | 3/4 | Scale tokenized and used in all 20 components; three off-scale literals remain |
| Experience Design | 3/4 | Virtualized-a11y done the hard way and correctly; two ARIA/keyboard correctness defects |

**Method and its limit.** This is a **code-only** audit. No Playwright MCP was available and
`workflow.live_dom_uat` is `false`, so no screenshot was taken and no rendered pixel was compared
against the spec. Everything below was established by reading source, CSS, the token files and the
test suite. A finding phrased as "absent" means *no code implements it*, which is a strong claim; a
finding about how something *looks* when rendered is outside what this pass can settle.

---

## Pillar 1 — Copywriting: 3/4

**What holds.** The Copywriting Contract is implemented almost literally. Thirteen of its fourteen
checkable rows appear in source verbatim, including the ones most often paraphrased away: the
quick-add placeholder with its ellipsis, the issues-lane variant, all three empty-state heading/body
pairs, `Clear Filters`, the orphan-vs-unresolvable epic distinction (`No epic` vs `Unknown epic`,
corrected in plan 01-18), the project-unreachable heading and body with its "Nothing was scanned or
guessed automatically" reassurance, the Done warning with its `{checked}/{total}` shape, the
destructive confirmation's three-part heading/body/buttons, and the palette's empty result. Two
strings that first scanned as missing are in fact present and correct — `Can&rsquo;t find this
project` (typographic apostrophe as an HTML entity) and `This can't be undone` (line-wrapped across
JSX lines). The voice is consistent: plain, specific, no exclamation, failure messages name the
action and the reason.

**Finding C-1 (minor) — the search-failure state has no copy and no code path.**
The contract specifies: `Search failed — {reason}. Showing the last known results. [Retry]`. No
string resembling it exists anywhere in `packages/desktop/src`, and neither `FilterBar.tsx` nor
`useBoardQuery.ts` contains an `isError` branch for the search query. The mutation-failure sibling
*is* implemented (`Couldn't register this project — {message}` in `FirstRun.tsx` /
`RegisterProjectFlow.tsx`), so the pattern exists and was simply not extended to search. Note that
`01-UI-SPEC.md` § UI Considerations marks `error | mutation/query failure` as `✅ covered` — that row
is accurate for mutations and overstated for the search query path.

*Fix:* add an error branch to the search query surface rendering the contracted string, keeping the
last successful result set mounted (the copy promises exactly that — "Showing the last known
results", i.e. do not blank the list on a failed refetch).

---

## Pillar 2 — Visuals: 2/4

**What holds, and it is substantial.** The direction was taken seriously rather than decorated onto
a default list:

- **The direction contract is authored as specified.** `index.html`'s body opens with the five-block
  `THESIS / OWN-WORLD / STORY / FIRST VIEWPORT / FORM` comment carrying seed key `59b0beb9` and
  closed by the `FINISH:` line, exactly as `01-UI-SPEC.md` § "What this section does NOT do" required
  of the builder.
- **The rack/strip material split is real.** Rack tokens (`surface-dominant`, `surface-secondary`,
  `divider`) dress the ground, rail, band headers and panel frame; strip tokens are the one light
  plane. `BoardRow` composites its state tint and its selection overlay in a single `linear-gradient`
  over `STRIP_BACKGROUND[status]`, hairline-separated by `borderBottom: 1px solid var(--divider)` —
  which is what produces "one continuous racked field" rather than floating cards.
- **The rack is vertical. There are no horizontal status columns** anywhere — the disclosed risk the
  spec warned would mean "the direction has been misread" was avoided.
- **No skeuomorphic drift.** No paper grain, no bevels, no shadow imitating physical strips. The one
  `boxShadow` in the codebase is on `DoneWarning`'s floating prompt, which is a legitimate overlay
  elevation, not strip texture.
- **The legend donation is enforced structurally.** `legend/marks.ts` is a single registry of 31
  marks and the row's glyph is read from it, so "no mark may exist that the legend does not define"
  is a code property rather than a promise.
- **Radius language honoured:** `--radius-strip: 2px` on stock, `--radius-chrome: 6px` on chrome, no
  hard-coded radii.

**Finding V-1 (major) — sticky band headers are specified, commented as present, and absent.**
`01-UI-SPEC.md` § "Board list" states "Each status group has a **sticky header** showing the status
name and its item count," and § "The world" lists "sticky band headers" among the rack surfaces.
There is **no `position: sticky` anywhere in the codebase** — `grep` finds the word only inside
comments, and `.status-band` (the class `StatusBand.tsx` applies) has **no CSS rule at all**. The
band header is an ordinary virtualized row that scrolls out of view with its items. Three separate
doc comments assert the property the code does not have (`StatusBand.tsx:2`, `BoardView.tsx:4`,
`tokens.css:11`), which is worse than silence: a future reader will trust them.

This is not cosmetic at this phase's stated volume. On the seeded 1,067-item board, scrolling into
the middle of a long band leaves nothing on screen naming which workflow state you are looking at —
and "the strip's phase is printed on it" only tells you the row's status, not the band boundary you
have crossed. The spec tied band-header legibility to BOARD-08 explicitly ("legibility of scale is
part of that promise, not just render speed").

*Fix:* the `@tanstack/react-virtual` sticky-header pattern — render the active band header as a
separate absolutely-positioned element above the scroll viewport, driven by which band the topmost
visible index falls in, rather than trying to make a virtual row sticky. Delete the three comments if
the property is deliberately dropped instead.

**Finding V-2 (major) — the selected strip is never "pulled proud of the rail."**
The direction's FIRST VIEWPORT block, reproduced verbatim into `index.html`, says: "The selected
strip is pulled proud of the rail — **the one element allowed to break the plane**." In
`BoardRow.tsx` selection is expressed only as `--row-surface-selected`, a 14%-alpha brand tint
composited into the row background, plus a 2px focus outline inset by `-2px`. Nothing breaks the
plane: no lateral offset, no raised edge, no leading accent bar, no elevation.

The spec anticipated the tension and constrained the solution — "must be achieved without a
layout-shifting transform, or it breaks the fixed-height row budget" — and the build resolved it by
omitting the move rather than by finding a non-shifting expression of it. Options that respect the
budget: a leading `inset box-shadow` edge in `--accent-nontext` (no layout cost), a `translateX` on
the row's inner content only (the row box keeps its height), or an outdented left rule. With the
signature move absent, the selected row is a tinted row — competent, but the one gesture that was
supposed to distinguish this surface from "the soft near-neutral list" the thesis explicitly refuses.

**Owner context worth recording.** Separately from this audit, the owner has said the shipped "Flight Progress Strips" direction reads as dated to him, and wants Flywheel's UI to read as bold and modern. V-1 and V-2 are worth reading in that light: the two absent elements are precisely the ones carrying the direction's confidence, and a direction stripped of its signature moves will read as a plain list regardless of how well its tokens are organised. Whether the answer is to *complete* this direction or to *replace* it is an owner decision, not an audit finding — but these two gaps mean the direction has not yet been seen as designed, so a judgement that it "reads as dated" is currently a judgement on an incomplete execution of it. The untracked phase directory
`.planning/phases/10.1-visual-polish-brand-assets-and-confirmed-motion/` is the natural home for
whichever way that goes.

---

## Pillar 3 — Color: 4/4

**Zero findings.** This pillar is exemplary and should be the model for the rest of the product.

- **One source of truth, enforced.** `styles/tokens.css` declares every colour; `theme/tokens.ts`
  mirrors them as typed constants solely so the contrast test can consume them. A grep for
  `#rrggbb` across every `.ts`/`.tsx` in `src` outside those two files and the test directory returns
  **zero files**.
- **Every measured value from the spec's palette is implemented at its exact hex** — the seven rack
  roles, all five strip-state tints, the four ink/accent-on-strip roles.
- **The brand pin was honoured as a hue, not a hex.** `--accent-nontext: #3c64dd` is used only for
  non-text (focus ring, rail edge, selection overlay, `::selection`); `--accent-text-rack: #7d99ff`
  (5.92:1) and `--accent-text-strip: #2d4fb8` (4.97:1) carry brand-coloured *text*. This is the
  spec's own recorded rule — "a brand that cannot be read on its own product surface has not been
  honoured by being pasted in unchanged" — implemented rather than quoted.
- **The ratios are proved by a runnable assertion, not by the table.** `theme/contrast.ts` plus
  `theme/__tests__/contrast.test.ts` is the Wave 0 obligation the spec named, and it is green.
- **Never colour alone.** Status carries a glyph from the legend registry *and* its printed word
  alongside the tint; priority uses a bar-count glyph; the unreachable project pairs an icon with the
  literal word. The spec called the glyph and word "load-bearing, not decorative" — they are present.
- **All four row states are pairwise distinct**, including the `selected-unfocused` role at a
  different hue family (`rgba(74,82,97,…)` vs the brand-tinted others), which is what makes
  "selected but blurred after Escape" visually different from "selected and focused."

---

## Pillar 4 — Typography: 3/4

**What holds.** The locked scale is implemented exactly: `type-micro` 10px/1.2, `type-label`
11px/1.3, `type-body` 13px/1.4, `type-heading` 15px/600/1.25. Exactly two weights exist in the
stylesheet — 400 and 600 — with no third weight and no decorative use of semibold. No "Display" role
was invented. Archivo ships **self-hosted** as a single variable file (`/fonts/Archivo-Variable.ttf`,
`font-weight: 100 900`, `font-stretch: 62% 125%`) with `font-display: swap`, so no request leaves the
machine to render text (threat T-01-11's own property). Tabular figures are wired as a `.tabular-nums`
utility with explicit `tnum`/`lnum` feature settings — verified present in the font binary by
fontTools inspection before the typeface was locked — and it is applied across all nine surfaces that
render columnar numerics.

**Finding T-1 (minor) — the condensed companion cut is defined but used by nothing.**
`.type-condensed { font-stretch: 75%; }` exists in `type.css`, and the spec's § Type section goes to
real length justifying it: Google Fonts merged Archivo's condensed cut into the variable font's
`wdth` axis, so the companion is produced "from the **same** variable file at a lower `wdth` value
rather than as a second font file," explicitly "for the stamped key and band headers." A grep for
`type-condensed` across every component returns **nothing** — `StatusBand` uses `type-heading`, and
`BoardRow`'s key field uses no width class. The axis work was done and then never spent.

The consequence is textural: "stamped" is what distinguishes the key and the band rule from ordinary
body text in this direction, and at default width they read as simply more body copy. This finding
and V-1 both land on the band header, and fixing them together is one small change.

*Fix:* add `type-condensed` to `StatusBand`'s label and to `BoardRow`'s key field.

---

## Pillar 5 — Spacing: 3/4

**What holds.** The full seven-step scale is tokenized (`--space-xs` 4 → `--space-3xl` 64) at exactly
the spec's values, and it is genuinely used: all 20 non-test components reference `var(--space-*)`,
with no component falling back to ad-hoc numbers for its layout. The macOS exception is honoured
correctly — no 44px touch targets, and interactive glyph targets carry the spec's `minWidth: 24,
minHeight: 24` instead. The progressive-disclosure ladder is implemented with **container queries**
on `.board-row` itself (`container-type: inline-size`), which is the right mechanism rather than
viewport media queries: the row narrows when the detail panel opens, not only when the window does,
and the drop order (actor → epic pill → assignee → estimate) matches Row Anatomy.

**Finding S-1 (minor) — three off-scale literals.**

| Location | Value | Assessment |
|----------|-------|------------|
| `QuickAdd.tsx:138` | `padding: "1px var(--space-xs)"` | Defensible — a sub-scale optical adjustment on a 10–11px pill; the horizontal axis is tokenized. The scale starts at 4px, which is too coarse for this one case |
| `BoardRow.tsx:250` | `padding: "1px var(--space-xs)"` | Same case, same pill shape |
| `ProjectRail.tsx:61,57` | `padding: "6px 2px"`, `gap: 2` | **Genuine drift** — 6px and 2px are not on the scale and are not hairlines; nothing about the rail entry requires off-scale values |

*Fix:* move the rail entry to `var(--space-xs)`/`var(--space-sm)`. For the two pills, either accept
`1px` as a documented optical exception (a comment naming it as such) or add a `--space-2xs: 2px`
step; the current state is silent drift either way.

---

## Pillar 6 — Experience Design: 3/4

**What holds, including the genuinely hard part.** This is strong work:

- **Virtualized accessibility is done correctly**, which is the thing most builds get wrong.
  `BoardRow` carries `aria-setsize` from the band's **true** item count (sourced from the core's
  per-band counts, not from the mounted window) and `aria-posinset` from the row's true index, so a
  screen reader announces "item 847 of 1,067" even though only a window is in the DOM. The spec
  demanded exactly this and the build did not shortcut it.
- **Accessible names concatenate key, title, status and priority**, per spec.
- **Layer-gated keyboard model.** `bindingAllowedInLayer` decides in one place which bindings the
  topmost layer owns; the palette and every picker trap focus; the native menu accelerators are
  routed through the same guard (the defect where they bypassed it was found in UAT and closed by
  plan 01-16, with `menu-bridge.test.tsx` as the regression).
- **`prefers-reduced-motion` is a hard collapse, not best-effort** — the media query zeroes both
  duration tokens *and* applies `animation-duration: 0s !important` / `transition-duration: 0s
  !important` globally, while leaving the state change itself intact. Exactly the spec's requirement.
- **One easing curve** (`--ease`) across the product, two duration tokens, and no fade — the motion
  grammar as specified.
- **State coverage:** 12 of 14 categories resolved, 2 honestly marked `🧪 backstop` rather than
  claimed.

**Finding X-1 (major) — `aria-selected` on `role="listitem"` is invalid, so selection is not
announced.** `BoardView.tsx:667` declares `role="list"` and `BoardRow.tsx:199-204` gives each row
`role="listitem"` together with `aria-selected`, `aria-setsize` and `aria-posinset`. `aria-selected`
is **not a supported attribute on `listitem`** — it is defined for `option`, `row`, `gridcell`, `tab`
and `treeitem`. Assistive technology will ignore it, so the board's single most important piece of
state — which strip is selected — is conveyed visually (tint + outline) and **not** to a screen
reader, in a product whose hard requirement is full non-mouse operability.

The spec offered the remedy directly: "use `aria-setsize`/`aria-posinset` (**or the ARIA
grid/listbox pattern**)". And the codebase already contains the correct implementation —
`CommandPalette.tsx:575-584` uses `role="listbox"` / `role="option"` properly. The board list is the
one place it was not applied.

*Fix:* `role="list"` → `role="listbox"` (with `aria-multiselectable="false"`) and `role="listitem"` →
`role="option"`. `aria-setsize`/`aria-posinset` remain valid on `option`, so nothing already working
is lost.

**Finding X-2 (minor, acknowledged upstream) — the band collapse toggle is an interactive control
that no keyboard can reach.** `StatusBand` renders `role="button"` with `aria-expanded` and an
`onClick`, but `tabIndex={-1}` — deliberately excluded from the tab order. `01-VERIFICATION.md` truth
#14 already records this as "mouse-only by design… a pre-existing design choice, not a regression,"
and the Keyboard Map does not assign collapse a binding, so this is a **known** state rather than a
discovered one. It is still an internal inconsistency worth resolving explicitly: a node that claims
`role="button"` and `aria-expanded` advertises itself to assistive technology as an operable control,
then cannot be operated. Either give collapse a binding in the Keyboard Map (it is a per-project UI
preference, so a cheap one), or drop the button role and expose the band as a non-interactive header
with the toggle as a separately-labelled control. The current shape promises a capability it withholds
— and it is the one affordance in the product reachable *only* by mouse, in a product whose stated
invariant is the mouse untouched.

---

## Top fixes, in order

1. **V-1 — implement sticky band headers** (or delete the three comments claiming they exist). The
   largest gap between contract and build, and it costs real orientation at 1,000+ items.
2. **X-1 — `listbox`/`option` instead of `list`/`listitem`** so `aria-selected` actually announces.
   A two-line change; the correct pattern already exists in `CommandPalette.tsx`.
3. **V-2 — give the selected strip a non-shifting way to break the plane.** The direction's signature
   move; an inset leading edge satisfies it within the fixed-height row budget.
4. **T-1 — spend the condensed cut** on the stamped key and band headers (pairs with fix 1).
5. **C-1 — add the search-failure error branch and its contracted copy.**
6. **S-1 — retire `ProjectRail`'s off-scale `6px 2px` / `gap: 2`.**

None of these is a blocker. Fixes 1, 2 and 4 are small and well-localised; 3 is a design decision
with a cheap implementation once chosen.

---

## Sign-Off against the spec's own checker dimensions

- [x] Dimension 1 Copywriting: **PASS** (one unimplemented row, C-1)
- [ ] Dimension 2 Visuals: **PASS WITH FINDINGS** — V-1 and V-2 are contract items, not preferences
- [x] Dimension 3 Color: **PASS** — no findings
- [x] Dimension 4 Typography: **PASS** (T-1: defined-but-unused condensed cut)
- [x] Dimension 5 Spacing: **PASS** (S-1: three off-scale literals)
- [x] Dimension 6 Registry Safety: **PASS** — `legend/marks.ts` is the single registry and the row
      reads its glyph from it; no mark exists that the legend does not define
- [x] Dimension 7 Inventory Provenance: **PASS** — every surface in the Surface Inventory maps to a
      shipped component; no invented surface found

**Audit:** `/gsd-ui-review 01`, code-only, 2026-09-10. Overall **18/24**.
