# Phase 14 Direction: state in colour

**Status:** ADOPTED by 14-CONTEXT D-15 to D-20 (owner, discuss-phase). This document records them; it does not reopen them.
**Companion:** `14-HIERARCHY.md` is the standard for the Cycle region. Colour is not a channel that carries hierarchy there, and
nothing in this document changes that. This document is about STATE: what colour means when it appears on a row.

The decision in one paragraph. Phase 8.1 decided that colour appears only as a data channel (D-11) and spent the brand on
progress. That was right about a backlog row and wrong about a blocked agent. A developer supervising many agents needs to see,
without reading, which of them is waiting for him. So Phase 14 adds saturated STATE colour, defined by what the developer must DO
about a state, drawn by ONE component, and never drawn without a glyph and a word.

---

## SUPERSEDES

Each row names text this document voids, by document and section. The voided text stays in its file. A reader who finds that text
there should treat it as history. Three rows: the decision, and the two permitted brand uses it orphans.

| Document | Voided section | What replaces it here |
|----------|----------------|------------------------|
| `08.1-CONTEXT.md` | **D-11**: "Colour appears only as a data channel. Progress fill, `▲N` ahead, blocked, failed, done. Nothing else is coloured: no tinted rows, no status fills, no pills with backgrounds." | Void only where it was wrong. **What stands:** a backlog row is not a signal, so the five task workflow statuses keep NO colour (D-16), progress stays the brand's, and `▲N` ahead stays a brand data channel. **What is void:** "blocked, failed" as the only run states that may be coloured, and "no tinted rows, no status fills, no pills with backgrounds" for the states in § The five classes below. A blocked agent is a signal, and so are the other states in the needs-you, running, failed and merged classes. They are drawn by `legend/StateBadge.tsx` in the four token roles of § The four roles, always with a glyph and a word. |
| `08.1-UI-SPEC.md` | § "The brand rule (D-12), and the rule it replaced", item 6 (D-199): "the run status: the `running` state's colour role and the spinner that stands for it" | The state vocabulary owns this signal. `running` is the running class, drawn from `--state-running-*`. No run status spends the brand any more. The item stays in the specification marked as voided by Phase 14, and `USE.runStatus` is removed from the allowlist. |
| `08.1-UI-SPEC.md` | § "The brand rule (D-12), and the rule it replaced", the recorded-not-decided use "the pending-proposal count on an epic row" (`BoardRow.tsx`, `--accent-text-strip`, D-82) | The state vocabulary owns this signal. A pending proposal is in the needs-you class (D-15) and the epic row draws it through `StateBadge`. The bullet stays in the specification marked as voided by Phase 14, and `USE.proposalCount` is removed from the allowlist. |

---

## The five classes

Defined by meaning, then enumerated (D-15). Criterion 3's six states are the floor. A class is named for what the developer must do.

| Class | Members | Why it sits here |
|---|---|---|
| **needs-you** | blocked, awaiting review, abandoned, needs-decision, proposals pending | The fleet's NEEDS YOU band (`bandForState`) already groups abandoned with blocked. The band header and the colour must teach one thing. An abandoned session is not an error, so it does not take the failed class. |
| **running** | running | The agent is working and nothing is asked of the developer. |
| **failed** | failed, CI failed | Something broke. |
| **merged** | merged | The work landed. Shares the GitMerge glyph with the criteria channel's Integrated on purpose: one fact, one glyph. |
| **quiet** | completed, interrupted, and any state the vocabulary does not know | Glyph, word and muted ink with no saturation. A state that does not need the developer is not painted as if it did. An unknown value prints its raw value. |

`completed` and `interrupted` are quiet. Keeping `completed` in success green beside a saturated `merged` was rejected (D-17): it is
the confusion the single-component rule exists to prevent.

The five task workflow statuses keep no colour (D-16). `RUN_STATUS_COLOR_ROLES` is
deleted (D-17); the component is the only vocabulary.

---

## The four roles

Four tokens per class (D-18), one per way the product draws. Spelling: `--state-<class>-<role>`. Twenty properties in both mode blocks,
mirrored in `theme/tokens.ts`.

| Role | Used for | Floor |
|---|---|---|
| `text` | the word, and the glyph when it shares the word's ink | 4.5:1 (AA) on every surface it sits on AND on all four state washes |
| `wash` | a tinted ground behind a state | the weakest existing text role keeps 4.5:1 on it, so a wash can only be as strong as that budget allows |
| `edge` | a full 1px boundary around a state | 3:1 non-text. Always a full boundary on all four sides, never a 2px side stripe: the side-border ban is asserted by `brand-rule.test.ts` and A-06 reserves the 2px side rule for selection. |
| `mark` | the glyph on its own | 3:1 non-text, its own floor instead of borrowing the text role |

The values were derived by search against these floors, not by eye. The table and the ratios are in `14-04-SUMMARY.md` and in the
comments of both mode blocks of `styles/tokens.css`.

**None of the twenty values is a brand hex.** `#3c64dd` and `#5175e1` appear in no `--state-*` value, so the component is NOT a brand
consumer and needs no `BRAND_USES` entry. That is why the allowlist only shrinks in this change.

---

## The one consumer

`legend/StateBadge.tsx` is the only file that names a `--state-*` token. `theme/__tests__/state-token-gate.test.ts` fails the build
when any other production file does. The component takes a state value and a variant (`text`, `wash`, `edge`, `mark`) and cannot
draw without a glyph and either a word or an accessible name carrying it.

The component also takes `pulse`, which puts the `agent-pulse` class on the glyph: the one continuous-motion exception (a process alive right now). The caller omits it under reduced motion, as the three run badges did before the rewire.

Awaiting review has its own mark (`run-awaiting-review`, Eye). It REPLACES D-170's reuse of the In Review mark rather than sitting
beside it, so the status channel keeps In Review for a task and the run channel has its own glyph (D-19). `run-merged` is registered
beside it.

---

## CVD thresholds

Written by plan 14-08, VIS-03. Implemented in `theme/cvd.ts` with no dependency; asserted by `theme/__tests__/cvd.test.ts` over every
unordered pair of the five classes (ten pairs), for the `text` and the `wash` role, in both modes, under each of the three deficiencies.

| Choice | Decision | Why | Rejected |
|---|---|---|---|
| Simulation | Machado, Oliveira and Fernandes 2009, severity 1.0, one 3x3 matrix per deficiency applied in linear sRGB | Physiologically based, the model most simulation tools use; nine coefficients per deficiency, so it is a few lines. Every row sums to 1, so a grey is unchanged (asserted). | Brettel-Vienot-Mollon 1997: needs a per-deficiency half-plane test and an LMS conversion, more code for a result close to Machado at full severity. The older Vienot 1999 matrices: protanopia and deuteranopia only, tritanopia left out, and tritanopia is a pair the plan names. |
| Metric | CIE76 colour difference (Euclidean distance in CIELAB, D65) between the two SIMULATED colours | A perceptual space, so the number is comparable across hues; about ten lines; the text and the wash floors below are both stated in it. | CIEDE2000: a hundred lines of corrections whose point is fine hue and lightness weighting near neutrals, and it divides lightness differences on near-white by about 1.7, which would only make the wash numbers look worse without changing a verdict about people. WCAG contrast: a luminance ratio throws away exactly the hue distance this measures. Euclidean distance in RGB: not perceptual. |
| Text floor | **10** | Two ink colours in the same line of text must be told apart without placing them side by side. Differences below about 5 are read as one colour with a variation, and 10 is where two category colours stay separable at 14px and in a one-pixel outline. | 2.3 (the just-noticeable difference): that is the floor for detecting a difference side by side, not for naming a category. 20 and above: the four hues of the vocabulary cannot be spread that far in both modes while each keeps its 4.5:1 floor. |
| Wash floor | **2.3**, the classical just-noticeable difference | A wash is a faint ground tint held to the luminance budget of the weakest text role, so it is a reinforcing channel and never the identifier: the glyph and the word identify. It need only be a perceptible difference, and below the just-noticeable difference it would not be one. | A floor equal to the text floor: the wash cannot reach it and still leave every text role AA on it (see Ground lightness floor). |

The quiet class has no wash: its wash is the transparent rest value, so the ground stands in for it and the pair is "tinted against not
tinted".

**Rounding, by one rule.** A simulated colour is rounded to the nearest 8-bit channel; the metric is computed from those channels and rounded to two decimals; a
pair passes when that rounded value is greater than or equal to the floor. `cvd.test.ts` builds a pair at each floor out of greys (one
8-bit step either side) and asserts the pass and the fail, so each floor is a measured edge and not an untested constant.

### What was measured, and what moved

Before any value moved, 7 of the 120 asserted pair-under-deficiency checks failed (text: 1; wash: 6). All seven were real:

| Mode | Role | Pair | Deficiency | Separation | Floor |
|---|---|---|---|---|---|
| light | text | needs-you `#966708` / failed `#db1f2f` | deuteranopia | 5.68 | 10 |
| light | wash | running `#edfafd` / merged `#faf7fd` | protanopia | 0.60 | 2.3 |
| light | wash | running `#edfafd` / merged `#faf7fd` | deuteranopia | 0.73 | 2.3 |
| light | wash | needs-you `#fef6e7` / failed `#fef6f7` | tritanopia | 1.46 | 2.3 |
| light | wash | running `#edfafd` / failed `#fef6f7` | protanopia | 2.24 | 2.3 |
| dark | wash | failed `#240508` / quiet (ground `#0a0a0a`) | protanopia | 1.28 | 2.3 |
| dark | wash | needs-you `#130d01` / failed `#240508` | deuteranopia | 1.49 | 2.3 |

The floors were fixed before the numbers were seen, and no floor moved. The values moved:

- **Light failed text `#db1f2f` to `#bb1b28`.** A saturated red and an amber collapse to two olive browns of nearly the same lightness under
  deuteranopia, and hue is all that separated them. Only lightness is left to separate them, so the red goes darker: same hue and
  saturation (355 / 75), lightness stepped down until the separation cleared the floor with a margin (11.2, against 5.7). The
  darker red still clears AA by a wide margin (5.93 on the worst ground). The lighter direction cannot work: `#e12d3c`, where the
  separation first clears 10, is 4.21:1.
- **The four light washes** moved by 1.2 to 3.0 CIE76 units and **the four dark washes** by 0.5 to 2.5, found by a bounded search: each wash
  free to move within 15 degrees of its hue (25 in dark), subject to every text role at 4.5:1 and every non-text role at 3:1 on it,
  minimising the shortfall against a 2.5 target and then the distance from the previous value. The shortfall went to zero in both
  modes. The changes are small because the constraint is tight, and they cost nothing that the proofs in `contrast.test.ts` do not still hold.

Measured separations of the shipped values (minimum over the three deficiencies; the deficiency that sets it is in the test's failure
message when a pair fails):

| Mode | Role | Nearest pair | Separation |
|---|---|---|---|
| light | text | running / quiet, protanopia | 10.9 |
| light | text | needs-you / failed, deuteranopia | 11.2 |
| dark | text | merged / quiet, tritanopia | 19.3 |
| light | wash | running / failed, protanopia | 2.6 |
| dark | wash | needs-you / failed, protanopia | 2.6 |

The text pairs of the light mode sit within one unit of the floor on two pairs. That is where a hue shift in the next tuning pass can break
the proof, and it is the point of having the proof.

**Which pairs rely on the glyph and the word alone.** None fails its floor, but a wash at 2.6 is a perceptible difference and nothing more.
Under every deficiency, and equally for a person with typical vision, the state is identified by its glyph and its word first; the wash
and the ink are the faster channel and not a sufficient one (D-15, criterion 3).

### Forced colors

Measured by plan 14-08 in `vitest.browser.forced-colors.config.ts` and `board/__tests__/browser/forced-colors.browser.test.tsx`
(22 tests, one run per arm of the browser suite).

**The engine is Chromium, not WebKit.** Forced colors is a Windows mechanism and the Windows shell renders in WebView2, which is Chromium. The
other browser arms use WebKit for the macOS shell. Under WebKit with `forcedColors: "active"` the media query reports true and
nothing is substituted (the computed `color` stayed `rgb(150, 103, 8)`), so a WebKit arm would pass whether or not the product
survives. The test asserts the substitution itself (the ink equals `CanvasText` and is not the class token), not only the media query, and
fails under WebKit with the claim set. The arm runs only this test: the rest of the browser suite measures painted colour, which forced
colors removes by definition.

**What the system does to a state.** All five class inks, the glyphs and the edge borders collapse to `CanvasText`; the wash
background collapses to `Canvas` and so paints nothing; the edge variant keeps its 1px solid border on all four sides (the engine forces the
border colour, it does not drop the border). The five states are therefore told apart by glyph and word alone, which the test asserts for
all ten pairs.

**The fallback is a measured no-op.** Nothing was added to `styles/tokens.css`, so the per-mode parse in `contrast.test.ts` still slices
the same two blocks. The glyph is drawn (14 by 14), the word or the accessible name survives, the edge variant's boundary survives, and
the pairs are told apart, all with no `forced-colors` rule. The wash is the one channel lost, and it is acceptable only because a wash
is never the sole carrier of a state (D-15): that stays true as a constraint on any caller, not only on the component.

**Hand-off to 14-09.** The needs-decision and CI-failed chips in `BoardRow.tsx`, which still spend `--destructive-strip`, were measured in
the same arm: under forced colors each keeps its glyph, its word and its 1px solid border (forced to `CanvasText`), exactly as the edge
variant does, so the pending rewire to `StateBadge` does not need a forced-colors fix. Asserted in the same file.

## Ground lightness floor

Settled by plan 14-09, on the demonstration board, from 14-08's measurements. **The floor is confirmed, not revised, and the board is the
new evidence: it shows what the limit costs.** The limit is still set by the weakest EXISTING text role (14-08 below): `blockedTextRack` in
light, the dark brand text lift in dark. Nothing in this plan touched either, so no floor constant moved (asserted over the plan's commit range).

What the board adds is that the WCAG ratio is the wrong unit for "can it be seen". A wash held under every text floor sits 1.02 to 1.07 from
the ground by contrast ratio and can still be a long way off by colour difference, because the ratio ignores chroma. Measured as CIE76
(`theme/cvd.ts`'s metric) against the ground, and pinned by `theme/__tests__/wash-visibility.test.ts`:

| Mode | needs-you | running | failed | merged | Read on the real fleet |
|---|---|---|---|---|---|
| light, before | 8.25 | 4.15 | 3.76 | 5.40 | needs-you a faint ivory chip; the others barely a tint |
| light, **shipped** | **20.0** | 4.15 | 3.76 | 5.40 | needs-you plainly a plate; failed a faint pink; running and merged stay ink |
| dark, shipped (unmoved) | 4.43 | 4.14 | 16.93 | 15.31 | failed a visible plate; needs-you and running a tint you must look for |

**Dark needs-you cannot be fixed inside the envelope, and that is stated plainly.** A search over every 8-bit colour within 15 degrees of the
class hue that clears every text and non-text role at 4.5 and 3 on it, and keeps every wash pair and every wash-against-ground pair 2.5 or more
apart under all three deficiencies, found at best 4.79 against the 4.43 shipped. A move that raises a tint from "hard to see" to "slightly less hard
to see" is not a tuning and was not made. The cause is arithmetic: amber needs both the red and the green channel, and each spends the luminance
budget the brand text lift leaves (4.51 on the running wash, floor 4.5). What would change it is outside this phase: raising the dark brand text lift,
or drawing the wash on a surface with a different contrast budget than a text chip. That is Phase 18's dark-first work. Until then a dark needs-you
state is carried by its ink, glyph and word, which is what D-15 says every state is carried by anyway.

**The same search found that the light needs-you wash had room.** The most any colour within 15 degrees of the hue could be, with every floor held,
was 25.5 from the ground; 20.0 (`#fffad3`, weakest text role `#9a6700` at 4.61, wash pairs still 2.60 or more apart)
is the value shipped, as the strongest the search found up to a 20 cap and a visibly plate-like one on the board. The other three light washes had no
room (running 4.15, failed 3.76 are their own maxima; merged could reach 6.12) and did not move.

### Measured by plan 14-08 (VIS-04)

Every text role in `contrast.test.ts` (twelve: seven pre-existing, five state inks) is now measured on every surface, and the four tinted
state washes are surfaces (nine in all, the quiet wash being the transparent ground). Every mark and edge is held to 3:1 on the same nine.
Measured against the shipped stylesheet's own block for each mode, not a transcribed value; a role missing from one block, or spelled
in anything but lowercase six-digit hex, is a drift error.

| Mode | Weakest text pair | Weakest non-text pair | What bounds the wash |
|---|---|---|---|
| light | `blockedTextRack` `#9a6700` on the selected row surface, 4.53 (on a wash: 4.55, merged and running) | `stateFailedEdge` on the selected row surface, 3.01 | `blockedTextRack`, then `textPlaceholder` |
| dark | the brand text lift `accentTextRack` `#5175e1` on the selected row surface and on the running wash, 4.51 | `stateFailedEdge` on the running wash, 3.01 | the brand text lift, then the state inks themselves |

The limit is what 14-04 found and this plan confirms by search: the ground lightness a wash can reach is set by the weakest EXISTING text
role. Light washes sit 1.03 to 1.07 from the ground and dark washes 1.02 to 1.04. Widening that is a change to `blockedTextRack` or to the
brand text lift, which this plan does not touch. A second limit now sits on the same budget: **the CVD margin of the light washes is thin.** With
each wash held within 15 degrees of its hue, the best the search found keeps every pair 2.5 or more apart (shipped: 2.6, floor 2.3); freeing the hue
reaches more, but only by turning the failed wash orange and the merged wash blue, which is not a tuning. So a stronger wash is not
free of cost on the colour-vision proof either, and plan 14-09 must re-run `cvd.test.ts` after any wash it moves.

---

## Settled on the demonstration board (plan 14-09)

**The board.** `target/demo-board/appdata/flywheel.db`, re-seeded by `scripts/demo-board.sh` at the start of the plan (5 Cycles, 278 epics, 760 tasks,
the seeder's `SEEDED` line unchanged from 14-03). Lead epic `FLY-1015` (14-03), active Cycle `FLY-1`. The real application was launched against it (the
debug build, its frontend from the dev server; the release binary on disk predates Phase 14 and was not used) and looked at in both appearances.
Dark is the machine's own; light was reached by switching the system appearance for the capture and switching it back. Nothing below was judged on a
fixture row or a swatch sheet.

**Rounds.** Four: (1) the Cycle region, (2) the epic roster's container ladder, (3) the ladder's cell-width correction and its shed-cell fix, (4) the washes.
Each ended with the gate envelope re-run. The last round changed one token value (the light needs-you wash) and one rule (the fleet draws needs-you and
failed on a wash). The first three changed no colour value: what the board showed was wrong there was structure.

### Which classes carry a wash

A wash is the loudest of the four roles, and its job is to make a row findable. Decided per class, and each decision made against the alternative seen on
the board (a wash behind all five on the fleet, which was looked at in both appearances before it was rejected).

| Class | Wash | Reason | The rejected alternative, as seen |
|---|---|---|---|
| needs-you | **yes** | the class that asks the developer to act. Three of the fleet's six rows. It is the one place a plate pays for itself. | Ink only, seen in dark before any wash was drawn: the amber glyph and word read clearly, so the case for a plate is findability and not legibility. |
| failed | **yes** | something broke and he has not seen it yet. One row. | Ink only, seen in dark: legible. The wash adds a plate that is visible in dark (16.9) and faint in light (3.8), the right way round for a class that must not be missed on a dark board. |
| running | no, ink only | the agent works and nothing is asked. At fleet density this is the majority state, so a plate on each is a coloured field the eye learns to ignore. | A wash behind both running rows made the RUNNING band the same weight as NEEDS YOU, and the band header stopped being the thing that told them apart. |
| merged | no, ink only | the work landed; a fact, not an ask. No row on the demonstration fleet or the board draws it, so there is nothing to see it on: decided on the class's meaning and recorded as not exercised. | Not seen. |
| quiet | no (the transparent rest value, as 14-04 set it) | a state that does not need the developer is not painted as if it did. | n/a |

This is enforced, not advised: `legend/StateBadge.tsx` exports `rowVariant(state)`, which returns `wash` for needs-you and failed and `text` for
everything else, `FleetSurface` draws through it, and tests pin both. All four washes keep their values, because `cvd.test.ts` and `contrast.test.ts`
assert them as a set of ten pairs and four surfaces: making a class's wash transparent to say "no wash" would collapse two washes to one value and
fail the CVD pair floor, which is lowering a gate to express a design. The wash tokens are a vocabulary; `rowVariant` is the decision about use.

### Which values moved

One. Light needs-you wash `#fefcec` to `#fffad3` in `styles/tokens.css` and `theme/tokens.ts` in one commit. Every other value (ink, edge, mark, the other
seven washes) is unmoved, on the evidence of the board: the inks read at 4.6:1 and better on both grounds, the edge chip (Blocked, Needs Decision) is
clear, and 14-08's CVD margins are intact. The dark brand text lift and `blockedTextRack` were not touched. No floor constant changed.

### The count of simultaneously saturated rows

Counted on the seeded board, in the application, not estimated. A row is saturated when it draws a state that is not quiet. The count does not depend on
the appearance (a row carries a state or it does not); what the appearance changes is how much of the saturation is SEEN, and that is in the table above.

| Surface | Rows | Saturated | Which |
|---|---|---|---|
| Fleet, All agents | 6 | **6** (of 6) | needs-you 3 (blocked, awaiting review, abandoned), running 2, failed 1; 4 on a wash |
| Board, epic roster | 278 epics | **0** | an epic row draws no state; its running count is a plain figure |
| Board, task rows | 760 tasks | **2** | Blocked on FLY-1020, Needs Decision on FLY-1031; the most on one screen with both epics open was 2 |
| Review-queue rail | 2 counts | 2 | Blocked (amber) and Needs decision (red, see below) |

On the board that is 2 of 1038 rows, 0.19 percent: it does not read as an incident dashboard, and the 14-04 prohibition holds there. On the fleet, every
row is a state by construction (the surface lists agents), and the answer is the shape: half of it is needs-you, the running rows are calm ink, and one
red. That ratio is the seeded one, not a measured fleet; a real fleet of thirty running agents is thirty cyan inks and no plates, which is why running
is ink only. **Not exercised:** `ci_failed` (nothing seeded), `merged` (no surface draws it), the proposal mark on a task row.

### Three findings from the live surface that are not value tuning, and what was done

1. **A real Cycle goal has no length limit, and the demonstration board's goals are whole roadmap paragraphs.** The region filled the window with a 10-line
   goal and four 4-line later Cycles and left one roster row on screen. Fixed in `CycleRegion.tsx` (loud goal two lines, each later Cycle one, the full text
   stays in the document and in `title`). The seeder's goal text running on into `Mode: mvp Depends on: ... Success Criteria` is a seeder defect (it takes
   the rest of the roadmap line); not fixed here, it is not in this plan's files and the clamp makes it harmless to the region.
2. **The application shell sizes its content child to max-content** (`App.tsx` line 395 is a flex item with no `min-width: 0`), so the first clamped goal
   pushed the whole board, filter bar and close control included, past the window edge. The region now carries `contain: inline-size`. The shell itself is
   still the root cause for any future wide intrinsic content; not changed (not this plan's file).
3. **The epic roster's container ladder was wrong at the default window.** At the 1016px pane every roster title read `1...` (22px), and the strip the
   ladder meant to shed carries an inline `display: flex` a class rule cannot beat, so below 900px the template lost a column and the cell stayed. Rungs
   moved from 900 and 640 to 1160 and 940 from the template's own arithmetic (in `App.css`), the shed is `!important`, and a browser test holds the title to
   160px and the row to one line at seven widths from 716 to 1200. This is the roster, the thing the statement says leads; leaving it at `1...` would have made
   the region's judgement meaningless.

**14-03's open question.** Does the application show running and blocked on first launch? **Yes.** After the launch, `agent_runs` held running 2, blocked 1,
abandoned 1, completed 1, failed 1 (the seeded set, intact), the fleet listed Blocked, Awaiting review, Abandoned, Running x2 and Failed, and the board showed the
Blocked chip on FLY-1020. The residue 14-03 predicted is real: every launch writes three false `agent_run.abandoned` events for the three live runs before the
trigger cancels the status write (7 in the demonstration database after two launches: 1 seeded, 6 false). Cosmetic, as 14-03 said. The board's own summary line
says "1 agent running" where the fleet lists two: the second run is an authoring-session run that belongs to no epic in the Cycle.

**The needs-decision and CI-failed pills.** Rewired through `StateBadge` (`edge` variant, as Blocked is). Needs Decision now draws amber beside Blocked, in both
appearances, on the real board. **One sibling is not fixed and should be filed:** the review-queue rail's "Needs decision" count (`ProjectRail`) still draws red
beside the amber "Blocked" count, the same fact in a different class beside its own pill. It is a count figure, not a pill, in another file, and the plan did
not name it.

## The Cycle region against 14-HIERARCHY.md (plan 14-09)

Judged by the statement's section-4 procedure, on the demonstration board, in dark in the running application and in light in the running application, with
four later Cycles present, at the default 1200 by 800 window. In the order done: squint, name the levels, cover the colour, read the figure, test the absences.

**Before shaping (both appearances).** Step 1 failed: the eye landed on the region's loud goal and the region as a whole outweighed the roster, which was a single
row at the bottom edge. Step 2 failed: the later Cycles were four-line paragraphs and read as a second block, not a quiet level. Steps 3 and 4 passed (the region
carries no colour; the figure read `7/27 tasks done`). The roster itself read `1...` (see finding 3).

**What changed.** The loud goal clamped to two lines beside the close control, the facts (counts, fraction, scope drift) on their own row beneath it, each later Cycle
one line with an ellipsis, the region's width made its container's, and the roster ladder repaired. Spacing, type step, weight and position only; no state token.

**After.** 1. Squint: the eye lands on the two-line goal, then the roster rows under it, and six roster rows fit beneath the region; the roster is not outweighed.
2. Levels: loud = the goal, quiet = four one-line Cycles at body weight, frame = the container and its one divider, no box, icon or banner. 3. Colour covered:
the levels hold in type, weight and spacing. 4. The figure says where the work stands and nothing else. 5. Absences: not forced in the application (the demonstration
board has an active Cycle with epics and tasks); held by the existing 14-01/14-02 tests in words ("No cycle is active.", "No tasks in this cycle yet", "no epics yet").

**The region now realises the statement's structure, in both appearances, with these named for plan 14-10:**
- **The perceptual half is the owner's.** Whether it reads as the focal arrangement at his own density is not asserted by anything here (`verification: backstop`).
- **The later Cycles are in primary ink, not muted.** The statement's table puts them at the body step, which is what they are, but beside a roster of bold titles
  four full-ink body lines are the busiest part of the region. If the owner's squint test lands on them, the statement allows muting (it names muted ink for the frame,
  not for Level 2), so that is a statement amendment and not a bug.
- **Step 5 was not exercised in the running application.**
- **The ordering constraint is not fully met in git history, and cannot be.** `14-HIERARCHY.md`'s first commit (`f853e244`, 18:45) is NOT an ancestor of
  `CycleRegion.tsx`'s first commit (`a5c6f7d7`, plan 14-01, 18:20): 14-01 created the file as a minimal slice (goal at the heading step, a muted fraction, a divider)
  twenty-five minutes before the statement was written. The statement does predate every commit that shaped the three levels (`8db0e8d8` onward, this plan's included),
  but the plan's own verification command asserts the stronger thing and exits 1. History is not rewritten to satisfy it. The weaker, true claim is recorded here for
  the verdict.

## What this document does not decide

The dark-first switch, the per-surface signal budget and the final per-surface verdict are Phase 18, by roadmap decision 3. This
document decides the vocabulary and the single consumer. It does not decide how loud any one surface may be.

---

## Pre-change audit (taken before plan 14-07 touched `packages/`)

Everything below was read from the tree before one source line was edited. It is the diff the allowlist change had to make.

### 1. Every brand use, from `BRAND_USES`

Twelve files. "Removed" means the code that spent the brand is rewired to spend a state token through the component.

| File | Count now | `USE` keys now | This change | Count after | `USE` keys after |
|---|---|---|---|---|---|
| `App.css` | 1 | selection | untouched | 1 | selection |
| `board/BoardRow.tsx` | 2 | commitsAhead, proposalCount | **proposalCount removed** (rewired to `proposals_pending`); commits-ahead kept | 1 | commitsAhead |
| `board/BoardView.tsx` | 1 | textAction | untouched | 1 | textAction |
| `board/EpicHeaderRow.tsx` | 2 | progress, commitsAhead | untouched | 2 | progress, commitsAhead |
| `board/TriageLane.tsx` | 2 | textAction | untouched | 2 | textAction |
| `item-detail/ActivityTrail.tsx` | 1 | textAction | untouched | 1 | textAction |
| `item-detail/ForgeSection.tsx` | 3 | textAction | untouched | 3 | textAction |
| `legend/runStatus.ts` | 1 | runStatus | **removed** (`RUN_STATUS_COLOR_ROLES.running` deleted) | entry gone | none |
| `recovery/OrphanRecoveryModal.tsx` | 1 | runStatus | **removed** (the Running glyph rewired to `running`) | entry gone | none |
| `review/EpicRequestSheet.tsx` | 1 | textAction | untouched | 1 | textAction |
| `session/FeedRow.tsx` | 1 | developerTurn | untouched | 1 | developerTurn |
| `session/SessionSurface.tsx` | 1 | authoringStage | untouched: the one use is the authoring stage indicator, not the run badge, which reaches its colour through the deleted map | 1 | authoringStage |

Expected post-change `BRAND_USES`: ten entries. Expected post-change `USE` keys: progress, commitsAhead, textAction, authoringStage,
developerTurn, selection (six).

### 2. Orphaned `USE` phrases

Two keys no remaining file claims. Each is removed from the `USE` map, marked voided in the specification, and has its own row in the
SUPERSEDES table above (two orphaned keys, two strike rows).

| Key | Phrase | Specification location |
|---|---|---|
| `runStatus` | "the run status" | § The brand rule, item 6 (D-199) |
| `proposalCount` | "the pending-proposal count on an epic row" | § The brand rule, the "two further existing uses" list |

### 3. Every consumer call site

| File and line | Draws today | Becomes |
|---|---|---|
| `item-detail/RunsSection.tsx:86` | glyph + `RUN_STATUS_LABELS` word, ink from `RUN_STATUS_COLOR_ROLES[status]`, `agent-pulse` on the glyph while running | `StateBadge` per run status; the pulse stays |
| `fleet/FleetSurface.tsx:330` | the same shape, for the seven fleet states | `StateBadge` per fleet state; the pulse stays |
| `session/SessionSurface.tsx:94` | the same shape, for the six run statuses | `StateBadge` per status; the pulse stays |
| `recovery/OrphanRecoveryModal.tsx:243` | a `Loader` glyph in the brand text role, the words "Running (from a previous session)" in primary ink | `StateBadge` `running`, `mark` variant, label hidden: the glyph takes the running mark role and carries the word as its accessible name, the visible sentence stays as written |
| `board/BoardRow.tsx:345` blocked chip | glyph + "Blocked" in `--blocked-text-strip` with a 1px border | **A STATE** (needs-you). `StateBadge` `edge` variant: a full 1px boundary on all sides, inside the existing clickable wrapper |
| `board/BoardRow.tsx:428` commits-ahead | `▲N` in the brand text role | **A DATA CHANNEL** D-11 was right about. Untouched, keeps its brand use |
| `board/BoardRow.tsx:498` pending-proposal count | `FileClock` + count in `--accent-text-strip` | **A STATE** (needs-you, D-15 names proposals pending). `StateBadge` `proposals_pending`, label hidden, beside the count |

Not rewired, and why: the needs-decision pill and the CI-failed pill in the same file are in the vocabulary (needs-you and failed) but
spend `--destructive-strip`, not the brand, are not named by this plan's five consumers and do not move the allowlist. They are a
follow-on, recorded in the plan 14-07 SUMMARY. The epic distribution strip's done segment is progress, a data channel, not a state
class.

### 4. `contrast.test.ts` reader risk

**No.** The Dot-ink reader scans for `aria-label="uncommitted changes"` followed within 400 characters by `color: "var(--…)"`. That span
sits below the blocked chip and below the commits-ahead span, and this change edits neither it nor the 400 characters after it. The
reader is re-run after the edit to prove it.

### 5. Brand value in the state tokens

**No.** None of the twenty `--state-*` values is `#3c64dd` or `#5175e1` (read from `styles/tokens.css`). The component is not a brand
consumer.

### 6. Awaiting-review mark

Read from `14-04-SUMMARY.md`: the new `run-awaiting-review` mark REPLACES the reuse of In Review. `RUN_STATUS_MARK_IDS.awaiting_review` is
already `run-awaiting-review`, so the consumer rewire agrees with it.
