---
phase: 02-one-agent-one-worktree-watched-live
plan: 03
subsystem: ui
tags: [typescript, react, vitest, design-tokens, lucide-react, keyboard, wcag]

# Dependency graph
requires:
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "Plan 02-01's SessionSurface.tsx and Start Work affordance, Plan 02-02's Stop
      control and session_closed terminal event — the surfaces this vocabulary will bind to in
      later plans"
provides:
  - "Four colour roles (--success-text-rack/--destructive-text-rack/--blocked-text-rack/--blocked-text-strip)
    in styles/tokens.css and their typed AGENT mirror in theme/tokens.ts, contrast-proven at
    7.0-8.0:1 (rack) / 4.5+:1 per-tint (blocked-strip)"
  - "legend/marks.ts's new \"agent\" MarkChannel and six marks: run-running/run-blocked/
    run-completed/run-failed/run-interrupted/blocked-indicator — published in the Legend before
    any surface renders them"
  - "state/keyboard.ts's eight new ActionIds (start-work, open-live-session, stop-session,
    toggle-raw-view, answer-permission-allow/-deny/-allow-always, open-settings), two new
    FocusRegions (session-surface, permission-card), and two new UiLayer members with
    bindingAllowedInLayer scoping"
  - "The Escape ladder's session-surface member (Escape returns to board) and the permission
    card's deliberate, documented exclusion from that ladder (T-02-16)"
affects: [02-04, 02-05, 02-06, 02-07, 02-08, 02-09, 02-10]

# Actuals (#2632)
actuals:
  tokens: 8154
  tasks: 3
  commits: 3
  plan_head_before: f107f59b52e5cdcddc5447ae703645526efd2f67

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vite `?raw` import (declared by vite/client.d.ts) as the drift-check mechanism for a
      hand-maintained CSS/TS token mirror — reads the real shipped tokens.css text at test time
      rather than a copy-pasted literal, with vitest.config.ts's test.css.include scoped
      narrowly to that one file (Vitest stubs .css imports to '' by default even under a ?raw
      query)"
    - "Layer-model forward-compatibility: UiLayer/EscapeLadderState gain members
      (session-surface, permission-card) and bindingAllowedInLayer/nextEscapeLayer are extended
      to recognise them before any component sets the corresponding state field — the vocabulary
      ships ahead of the surfaces that will wire it, so 02-07/02-08 only need to supply the
      field, not touch this module"

key-files:
  created:
    - packages/desktop/src/state/__tests__/keyboard-agent.test.ts
    - .planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md
  modified:
    - packages/desktop/src/styles/tokens.css
    - packages/desktop/src/theme/tokens.ts
    - packages/desktop/src/theme/__tests__/contrast.test.ts
    - packages/desktop/vitest.config.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/Legend.tsx
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/state/keyboard.ts

key-decisions:
  - "blocked-text-strip's threshold is asserted per-tint (looping all five STRIP workflow tints)
    rather than against one representative swatch, per 02-UI-SPEC.md's own instruction — a
    single weak tint fails the suite instead of being averaged away"
  - "session-surface ranks directly under the palette in the Escape ladder, ahead of detail — the
    live session surface replaces the item detail panel's own mount point, so the two states
    cannot be simultaneously open and the ordering has no real ambiguity to resolve later"
  - "UiLayer/EscapeLadderState gained the new members now, with no LayerState/uiStore.ts wiring
    yet — this plan's files_modified is deliberately narrow (tokens/marks/keyboard only); the
    actual session-surface-open / permission-card-pending state lives with the components that
    don't exist until 02-07/02-08"

patterns-established:
  - "Agent signal vocabulary is the single upstream source every later Phase 2 surface binds to:
    colour role -> theme/tokens.ts AGENT, glyph+word -> legend/marks.ts \"agent\" channel,
    keystroke -> state/keyboard.ts BINDINGS. No later plan may invent a parallel list for any of
    the three."

requirements-completed: [AGNT-06, PROC-06]

coverage:
  - id: D1
    description: "Four new colour roles ship with WCAG AA compliance proved by a runnable
      assertion against the shipped values (not the spec's stated ratios), and the AGENT/CSS
      mirror is drift-checked against the real file"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/theme/__tests__/contrast.test.ts (AGENT tokens describe block, all 5 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The agent mark channel — six marks published in the Legend, every glyph
      resolving to a real lucide-react export, run-interrupted framed as a normal outcome"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/legend/__tests__/legend.test.tsx (MARKS registry + agent channel + Legend surface describe blocks)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Eight new keyboard actions resolve through the one binding table with correct
      region/layer scoping, and the permission card is structurally excluded from the Escape
      ladder"
    requirement: AGNT-06
    verification:
      - kind: unit
        ref: "packages/desktop/src/state/__tests__/keyboard-agent.test.ts (all describe blocks)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The Legend surface, opened in the running packaged app, visibly shows the six
      new agent-channel marks with their glyphs and words"
    verification: []
    human_judgment: true
    rationale: "The rendered-row-count test (Legend surface describe block) proves this
      programmatically via React Testing Library, but actually launching the packaged app and
      looking at the Legend has not been observed by a human yet — same pattern 02-01/02-02-SUMMARY.md
      used for their own manual verification steps, deferred to end-of-phase UAT per
      workflow.human_verify_mode=end-of-phase."

duration: 45min
completed: 2026-09-10
status: complete
---

# Phase 2 Plan 3: Agent Signal Vocabulary — Colour, Marks and Keyboard Summary

**Four contrast-proven colour roles, six new Legend marks on a new "agent" channel, and eight keyboard actions with a deliberately non-dismissible permission card — the shared vocabulary every remaining Phase 2 surface (launch sheet, session surface, permission card, blocked indicator, Runs section) binds to rather than inventing its own.**

## Performance

- **Duration:** 45 min
- **Tasks:** 3/3 completed
- **Files modified:** 10 (8 modified, 2 created)

## Accomplishments

- **Four colour roles** (`--success-text-rack`, `--destructive-text-rack`, `--blocked-text-rack`, `--blocked-text-strip`) appended to `styles/tokens.css` and mirrored as a typed `AGENT` const in `theme/tokens.ts`, with `contrast.test.ts` asserting each against the exact WCAG AA thresholds 02-UI-SPEC.md's Color Additions table specifies — including a drift-check that reads the real `styles/tokens.css` text at test time (via Vite's `?raw` import) so the hand-maintained CSS/TS mirror cannot silently disagree.
- **The `agent` mark channel**: `marks.ts`'s `MarkChannel` union gains `"agent"`, and `MARKS` gains six entries (`run-running`, `run-blocked`, `run-completed`, `run-failed`, `run-interrupted`, `blocked-indicator`) with the exact glyphs/labels from 02-UI-SPEC.md's Run Status table — published in the Legend surface (proven by a rendered-row-count test) before any later plan renders them.
- **Eight new keyboard actions** in `state/keyboard.ts`'s single `BINDINGS` table: `w`/`l` on the board list (Start Work / Open Live Session, verified to not collide with Phase 1's nine existing letters — computed from `BINDINGS` at test time, not restated), `⌘.`/`r` on the new `session-surface` region (Stop Session / Toggle Raw View), `a`/`d`/`Shift+A` on the new `permission-card` region (Allow/Deny/Allow-always), and `⌘,` globally (Open Settings).
- **`bindingAllowedInLayer` extended** with two new `UiLayer` members (`session-surface`, `permission-card`) and a per-layer allow-list for the new actions — `answer-permission-*` fires only in the permission-card layer (T-02-15's mitigation, falsifiable by a test that a stray `a` on the board list never resolves to a permission action).
- **The Escape ladder** gains a `session-surface` member (Escape returns to the board) and **deliberately excludes the permission card entirely** — no `EscapeLayer` member represents it, proven both at compile time (a conditional-type assertion) and at runtime (`nextEscapeLayer` enumerated over every reachable state never yields it), satisfying T-02-16.

## Task Commits

Each task was committed atomically:

1. **Task 1: Four colour roles, contrast-proven** — `aa12a23` (feat)
2. **Task 2: The agent mark channel** — `f414fce` (feat)
3. **Task 3: Eight new keyboard actions + Escape exemption** — `95f4215` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `packages/desktop/src/styles/tokens.css` — four new custom properties
- `packages/desktop/src/theme/tokens.ts` — `AGENT` const group
- `packages/desktop/src/theme/__tests__/contrast.test.ts` — six new assertions + drift-check
- `packages/desktop/vitest.config.ts` — `test.css.include` scoped to `styles/tokens.css` (deviation, see below)
- `packages/desktop/src/legend/marks.ts` — `"agent"` channel + six marks
- `packages/desktop/src/legend/Legend.tsx` — `CHANNEL_LABELS["agent"]` (deviation, see below)
- `packages/desktop/src/legend/__tests__/legend.test.tsx` — agent-channel + glyph-resolvability + Legend-render tests
- `packages/desktop/src/state/keyboard.ts` — two new `FocusRegion`/`UiLayer` members, eight new `ActionId`s, their `BINDINGS`, `bindingAllowedInLayer` extension, Escape ladder wiring
- `packages/desktop/src/state/__tests__/keyboard-agent.test.ts` — new test file, every `<behavior>` case covered

## Decisions Made

- `blocked-text-strip`'s 4.5:1 threshold is asserted per-tint across all five `STRIP` workflow tints, not against one representative swatch — matches 02-UI-SPEC.md's own instruction that a single failing tint must fail the suite.
- `session-surface` ranks directly under the palette in the Escape ladder (ahead of `detail`) — the live session surface replaces the item-detail panel's own mount point per D-31, so the two are never simultaneously open and this ordering has no real ambiguity.
- `UiLayer`/`EscapeLadderState` gained their new members now, with no `LayerState`/`uiStore.ts` wiring — this plan's `files_modified` stays narrow (tokens/marks/keyboard only); the actual open/pending state lives with the components 02-07/02-08 build.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vitest stubs `.css` imports to `""` by default, even under a `?raw` query**
- **Found during:** Task 1, first `npm --prefix packages/desktop run test -- theme` run after writing the drift-check assertion
- **Issue:** The acceptance criterion requires the contrast test to read `styles/tokens.css` from disk and assert against its real content. A plain `?raw` import of a `.css` file returned an empty string under this project's Vitest config (`test.css` unset, so Vitest's default CSS-stub optimisation intercepts `.css` imports regardless of the `?raw` query) — confirmed by isolated reproduction: a `?raw` import of a `.ts` file worked immediately; the identical import of `.css` did not until `test.css` was configured.
- **Fix:** Added `test.css.include: [/styles\/tokens\.css/]` to `vitest.config.ts`, scoped narrowly to the one file that needs real content — every other `.css` import in the test suite keeps the default (faster) stub behavior.
- **Files modified:** `packages/desktop/vitest.config.ts`
- **Verification:** `npm --prefix packages/desktop run test -- theme` — 14/14 pass, including the drift-check; full suite (`npm --prefix packages/desktop run test`) still 188/188 pass afterward
- **Committed in:** `aa12a23`

**2. [Rule 3 - Blocking] `Legend.tsx`'s `CHANNEL_LABELS` is a `Record<MarkChannel, string>` — adding `"agent"` to the union without a matching key breaks `tsc`**
- **Found during:** Task 2, first `npm --prefix packages/desktop run build` after extending `MarkChannel`
- **Issue:** `Legend.tsx` is not in this plan's `files_modified`, but `CHANNEL_LABELS: Record<MarkChannel, string>` requires every union member to have a key — a missing `"agent"` entry is a compile error the moment `MarkChannel` gains that member, which this task's own change causes.
- **Fix:** Added `agent: "Agent"` to `CHANNEL_LABELS`.
- **Files modified:** `packages/desktop/src/legend/Legend.tsx`
- **Verification:** `npm --prefix packages/desktop run build` — clean, no `error TS`
- **Committed in:** `f414fce`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues this task's own changes caused, in files outside the plan's declared scope but required for the plan's own verify commands to pass).
**Impact on plan:** Both were necessary for the build to succeed at all. No scope creep beyond what each task's own acceptance criteria already required.

## Issues Encountered

Two of the plan's own `<verify>` grep gates produced false failures traced to pre-existing conditions outside this plan's scope, not to anything this plan introduced — both logged to `.planning/WINDOWS.md` (entries 4 and 5) rather than fixed here, per the executor's scope-boundary rule:

1. **Task 1's hex-literal gate** (`grep -rlE '#[0-9a-fA-F]{6}' packages/desktop/src | grep -vcE '...'` must equal `0`) reports `1` because of `ItemDetailPanel.tsx:219`'s pre-existing `color: "#ffffff"` — introduced by plan 02-01, not by this plan, and `ItemDetailPanel.tsx` is outside 02-03's `files_modified`. No hex literal exists in any file this plan actually touched.
2. **Task 2's single-MARKS gate** (`grep -c 'export const MARKS'` must equal `1`) reports `2` because the substring pattern also matches the pre-existing `export const MARKS_BY_ID` declaration (present since Phase 1 — verified the count was already `2` at the commit immediately before this plan started). The real acceptance criterion — exactly one `MARKS` array — is independently verified: `grep -c '^export const MARKS:'` returns `1`.

Full detail for both in `.planning/phases/02-one-agent-one-worktree-watched-live/deferred-items.md`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plans 02-04 through 02-10 can consume the agent signal vocabulary directly: `theme/tokens.ts`'s `AGENT` group for colour, `legend/marks.ts`'s `agent` channel for glyph+word, and `state/keyboard.ts`'s eight new `ActionId`s/`BINDINGS`/`bindingAllowedInLayer`/Escape-ladder wiring for keystrokes — none of them needs to invent a parallel list.
- **Not yet human-observed:** the Legend surface actually rendering the six new marks in the running packaged app (the plan's own `<verification>` block's manual step). Deferred to end-of-phase UAT per `workflow.human_verify_mode: end-of-phase`, same pattern 02-01/02-02-SUMMARY.md used. Logged to `.planning/WINDOWS.md`.
- **Two pre-existing, out-of-scope verify-gate false failures** (see "Issues Encountered") remain open in `.planning/WINDOWS.md` for whichever future plan owns `ItemDetailPanel.tsx` or wants to tighten the `marks.ts` grep pattern — neither blocks this plan's own goal.
- **UiLayer/EscapeLadderState's new members are unwired** — `session-surface`/`permission-card` exist in the type/function layer now, but no component sets `sessionSurfaceOpen`/would-be `permissionCardPending` state yet. Plans 02-07 (session surface) and 02-08 (permission card / item detail Runs section) own that wiring.

---
*Phase: 02-one-agent-one-worktree-watched-live*
*Completed: 2026-09-10*

## Self-Check: PASSED

All 2 files listed under `key-files.created` verified present on disk with `[ -f ]`. All 3 task
commits (`aa12a23`, `f414fce`, `95f4215`) verified present in `git log --oneline --all`. Every
`<acceptance_criteria>` item across Tasks 1-3 re-run and passing: `npm --prefix packages/desktop
run test -- theme` (14/14), `npm --prefix packages/desktop run test -- legend` (8/8), `npm
--prefix packages/desktop run test -- keyboard` (23/23), full suite `npm --prefix packages/desktop
run test` (188/188), `npm --prefix packages/desktop run build` (clean, no `error TS`), the
`--blocked-text-strip` single-declaration grep, and the structural `event.key ===` grep gate (0
matches outside `state/keyboard.ts`). The two grep-gate false failures (hex literal, MARKS count)
are documented above and in `.planning/WINDOWS.md` as pre-existing, out-of-scope conditions, not
plan defects. The plan-level `<verification>` block's one manual item (Legend visually inspected in
the running packaged app) is not re-run here — it requires a human at a GUI — see "Next Phase
Readiness".
