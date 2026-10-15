---
phase: 14-cycles-on-screen-state-in-colour
plan: 07
subsystem: state-vocabulary
tags: [colour, state, brand-allowlist, supersedes, vis-01, vis-02]
requires: ["14-04"]
provides:
  - "14-DIRECTION.md: SUPERSEDES table naming D-11, the five classes, the four roles, and the pre-change audit"
  - "RUN_STATUS_COLOR_ROLES deleted; the runs section, fleet, session surface, orphan modal and board row render state through StateBadge"
  - "08.1-UI-SPEC.md § The brand rule: the run-status use and the pending-proposal use struck as voided by Phase 14"
  - "brand-rule.test.ts: allowlist moved, VOIDED check added, tsc clean"
affects: [14-08, 14-09]
tech-stack:
  added: []
  patterns: ["a struck-through spec phrase enforced by a test (VOIDED)", "one badge component with an optional pulse for the single motion exception"]
key-files:
  created:
    - .planning/phases/14-cycles-on-screen-state-in-colour/14-DIRECTION.md
  modified:
    - .planning/milestones/v0.1.0-phases/08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md
    - packages/desktop/src/theme/__tests__/brand-rule.test.ts
    - packages/desktop/src/test/node-shims.d.ts
    - packages/desktop/src/legend/runStatus.ts
    - packages/desktop/src/legend/StateBadge.tsx
    - packages/desktop/src/item-detail/RunsSection.tsx
    - packages/desktop/src/fleet/FleetSurface.tsx
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
    - packages/desktop/src/board/BoardRow.tsx
decisions:
  - "Both orphaned brand uses (the run status, the pending-proposal count) are struck in the spec, not deleted, and the items are not renumbered."
  - "StateBadge gained an optional pulse prop so the running glyph keeps agent-pulse; the callers still omit it under reduced motion."
  - "The needs-decision and CI-failed pills in BoardRow are in the vocabulary but are not among this plan's five consumers and were left as they were."
requirements-completed: [VIS-01, VIS-02]
metrics:
  duration: "about 12 minutes"
  completed: 2026-10-15
status: complete
actuals:
  tokens: 45000
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 94ccccdbcba1d2361bbb51da4fa87fc605fec69a
---

# Phase 14 Plan 07: One vocabulary, one consumer, one recorded decision Summary

`RUN_STATUS_COLOR_ROLES` is deleted and every run state on five surfaces renders through `StateBadge`, in the same commit that moves the brand allowlist, strikes the two orphaned uses in the specification and lets `14-DIRECTION.md` supersede D-11 by name. `npx tsc --noEmit` is clean for the first time this phase.

## What was built

- **Task 1** (`bfbdd76a`): `14-DIRECTION.md`. A `## SUPERSEDES` table of three rows (D-11, and the two struck brand uses), the five classes, the four roles with their floors, headed sections for 14-08 (CVD thresholds) and 14-09 (ground lightness floor), a statement of what the document does not decide (Phase 18), and the pre-change audit. No file under `packages/` was touched by that commit.
- **Tasks 2 and 3, one commit** (`c0df838a`): the rewire, the allowlist, the specification and the tests. They are one commit on purpose: after the rewire alone, the allowlist test fails (it did; see the RED below), so a split would leave an intermediate commit with a contradictory allowlist. The plan says the same ("committed as one unit").
- **Fix** (`6bd297b5`): `src/test/node-shims.d.ts` gains the two `node:fs` members `brand-rule.test.ts` uses.

## The audit against what happened

| File | Predicted count | Observed | `USE` keys after |
|---|---|---|---|
| `App.css` | 1 | 1 | selection |
| `board/BoardRow.tsx` | 1 | 1 | commitsAhead |
| `board/BoardView.tsx` | 1 | 1 | textAction |
| `board/EpicHeaderRow.tsx` | 2 | 2 | progress, commitsAhead |
| `board/TriageLane.tsx` | 2 | 2 | textAction |
| `item-detail/ActivityTrail.tsx` | 1 | 1 | textAction |
| `item-detail/ForgeSection.tsx` | 3 | 3 | textAction |
| `legend/runStatus.ts` | entry gone | entry gone | none |
| `recovery/OrphanRecoveryModal.tsx` | entry gone | entry gone | none |
| `review/EpicRequestSheet.tsx` | 1 | 1 | textAction |
| `session/FeedRow.tsx` | 1 | 1 | developerTurn |
| `session/SessionSurface.tsx` | 1 | 1 | authoringStage |

Twelve files audited, ten remain. The RED was real and on an assertion: after the rewire and before the allowlist edit, `brand-rule.test.ts` failed with `BoardRow.tsx` expected 2 received 1, and `legend/runStatus.ts` and `recovery/OrphanRecoveryModal.tsx` expected but absent. That is exactly the predicted diff.

Orphaned `USE` keys: `runStatus` and `proposalCount` (two), with two strike rows in the SUPERSEDES table (plus the D-11 row: three rows, which is one plus the number of struck phrases). Six `USE` keys remain, and a node one-liner confirms none is unclaimed.

## The consumers

| Site | Became |
|---|---|
| `RunsSection.tsx`, `SessionSurface.tsx` `RunStatusBadge` | `<StateBadge state={status} pulse={pulsing} />` |
| `FleetSurface.tsx` state cell | `<StateBadge state={state} pulse={pulsing} />` inside the `data-field="state"` cell |
| `OrphanRecoveryModal.tsx` | `<StateBadge state="running" variant="mark" hideLabel pulse={pulsing} />`; the visible sentence stays |
| `BoardRow.tsx` blocked chip | `<StateBadge state="blocked" variant="edge" />` inside the existing clickable wrapper: a full 1px boundary, no side stripe |
| `BoardRow.tsx` pending-proposal count | `<StateBadge state="proposals_pending" hideLabel />` beside the count |
| `BoardRow.tsx` commits-ahead | untouched: a data channel D-11 was right about, keeps its brand use |

`completed` and `interrupted` map to the quiet class through `STATE_VOCABULARY`, so `completed` no longer wears success green beside a saturated `merged` (D-17). The reader in `contrast.test.ts` (the `aria-label="uncommitted changes"` Dot) was not moved: the edit touched neither that span nor the 400 characters after it, and the test passes without change.

## Verification

- `npx vitest run` over the whole desktop suite: 96 files, 1606 passed (2 expected fail). Baseline was 1591 across 95 files; the extra file and tests came from plans 14-05 and 14-06 and this plan's additions.
- `npx vitest run src/theme`: 183 passed, including the state-token gate unchanged and `contrast.test.ts` with no "update this reader" message.
- `npx tsc --noEmit`: no output, clean.
- `grep -rn RUN_STATUS_COLOR_ROLES packages/desktop/src`: 0. All five consumers import `StateBadge`: 5. Six of the surviving `runStatus.ts` exports named in the acceptance grep match.
- `The brand rule (D-12)` heading count in the specification: 1, byte-identical.

### The two planted-violation proofs, verbatim

Plant 1, `const planted = "var(--accent-text-rack)";` appended to `fleet/FleetSurface.tsx` (a rewired consumer), reverted from a copy:

```
AssertionError: a brand-token use outside BRAND_USES: widen 08.1-UI-SPEC.md § The brand rule AND the allowlist, or remove the use: expected { 'App.css': 1, …(10) } to deeply equal { 'App.css': 1, …(9) }
+ Received
+   "fleet/FleetSurface.tsx": 1,
```

Plant 2, a stale `"fleet/FleetSurface.tsx": { count: 1, uses: ["textAction"] }` entry in `BRAND_USES` with no brand use in the file, reverted from a copy:

```
AssertionError: a brand-token use outside BRAND_USES: widen 08.1-UI-SPEC.md § The brand rule AND the allowlist, or remove the use: expected { 'App.css': 1, …(9) } to deeply equal { 'App.css': 1, …(10) }
- Expected
-   "fleet/FleetSurface.tsx": 1,
```

Both name the file, in opposite directions, and both files were restored byte-identical (`diff` against the saved copy printed "restored").

### The struck specification items, new text

Item 6 of § The brand rule: `6. **(D-199, voided by Phase 14)** ~~the run status: the `running` state's colour role and the spinner that stands for it~~.` followed by a paragraph naming D-17 and `14-DIRECTION.md` § SUPERSEDES and saying the text above stays as history. The pending-proposal bullet is struck the same way, naming D-15 and D-17. The "Two further existing uses" lead-in gained a clause saying the first of the two is voided by Phase 14.

**Renumbering:** none. I checked `08.1-UI-SPEC.md` for any SUPERSEDES or AUTHORITATIVE row that points at an item number of this list (searched "item N" and the brand-rule wording): the only references are inside § The brand rule itself ("item 8", which is still item 8). Items 7 and 8 keep their numbers.

## Deviations from Plan

**1. [Rule 3 - Blocking] The `node:fs` fix uses the repo's shim file, not "no import at all".** The orchestrator brief said to follow `state-token-gate.test.ts` and drop `node:fs`. I tried exactly that with an `import.meta.glob` of the specification: Vite answers `Denied ID .../.planning/milestones/.../08.1-UI-SPEC.md?raw`, which is the reason the test's own header gave for using `node:fs`. So the test keeps `node:fs`, and `src/test/node-shims.d.ts` (the repo's existing "typed to the exact surface used" file) gained `existsSync` and `globSync`. **Commit:** `6bd297b5`.

**2. [Rule 2 - Missing critical functionality] `StateBadge` gained an optional `pulse` prop.** The three run badges and the orphan modal put `agent-pulse` on the running glyph, "the one continuous-motion exception this product allows", and a source test in `session/__tests__/finish.test.tsx` pins it. The component had no way to carry it. The caller still computes `pulsing` and omits it under reduced motion. A test in `state-badge.test.tsx` covers it. **Commit:** `c0df838a`.

**3. [Rule 3 - Blocking] Three existing assertions rewritten for the new shape.** `finish.test.tsx` pinned the old `className=` source text; `blocked-indicator.test.tsx` pinned `blockedMark?.glyph` in `BoardRow.tsx`; `fleet-surface.test.tsx` pinned `--text-muted-rack` on an interrupted row. Each now asserts the new fact (the component call, the `data-state-class`), not a weaker one. **Commit:** `c0df838a`.

**4. [Process] Task 1's commit was amended once.** My own acceptance grep (`TBD|TODO|to be decided`, case-insensitive) matched the word "Todo" in a list of task status names. I removed the list ("the five task workflow statuses keep no colour") and amended before any other commit. The final commit still touches only `14-DIRECTION.md`.

**5. [Addition] A `VOIDED` check in `brand-rule.test.ts`.** Not in the plan. Striking text in the specification instead of deleting it leaves the phrase present, so the existing one-direction check could not tell a struck use from a live one. The new test requires every mention of a voided phrase to follow `~~` and the allowlist not to claim it.

**Total deviations:** 1 blocking-rule alternative to the brief, 1 missing-functionality addition, 1 set of test updates, 1 process amend, 1 added check. **Impact:** none on scope; every acceptance criterion holds.

## Hand-offs

- **Follow-on (not done):** the needs-decision pill and the CI-failed pill in `BoardRow.tsx` are in `STATE_VOCABULARY` (needs-you and failed) but still spend `--destructive-strip`. They are not among this plan's five consumers and move no allowlist entry. Until they are rewired, a needs-decision pill reads in red beside a needs-you amber Blocked chip, which D-15 says is the wrong lesson. 14-09 (tuning) or a small follow-up plan should route them through `StateBadge`.
- **14-08 / 14-09:** the sections `## CVD thresholds` and `## Ground lightness floor` in `14-DIRECTION.md` are headed and described, to be filled in place. `StateBadge` glyphs are now 14px everywhere; the orphan modal's running glyph was 16px and the board row's glyphs 12px.
- The brand is now spent in six live ways: progress, commits-ahead, text links and actions, the authoring stage, the developer's turn, and the selection highlight (plus the focus ring and primary-action emphasis, which the allowlist does not track as separate files).

## Known Stubs

None.

## Threat Flags

None. No network, auth, file-access or schema surface was added. The `node:fs` shim is test-only typing.

## Self-Check: PASSED

`14-DIRECTION.md` exists; commits `bfbdd76a`, `6bd297b5` and `c0df838a` are in `git log`; `git rev-list --count 94ccccdb..HEAD` was 3 at write time.
