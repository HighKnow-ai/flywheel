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

## Ground lightness floor

Filled by plan 14-09, from 14-08's measurements. It will state the lightness the dark ground must reach for a dark wash to read at
all (14-04 measured the dark washes at 1.02 to 1.04 against the ground, capped by the dark brand text lift), the tuned values that
result, and the count of simultaneously saturated rows on the demonstration board that the prohibition (the board must not read as
a permanent alarm) is checked against.

---

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
