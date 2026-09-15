---
phase: 03-nothing-lost-nothing-left-running
plan: 12
subsystem: agent-safety
tags: [destructive-action-gate, permission-card, react, rust, tauri, sqlite]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-07's compiled D-56 classifier (packages/core/src/destructive.rs),
      permission_requests.destructive_category (migration 0007), and the shim/hook gate that
      blocks a destructive request indefinitely until this card answers it; 03-11's
      recovery-needed mark append pattern (the ninth agent-channel entry this plan extends to
      the tenth)"
provides:
  - "pending_requests_for_run/PendingPermissionRequestDto/PendingPermissionRequestDto (TS) all
    carry destructive_category end to end — one query, one round trip, no second read"
  - "The destructive variant of PermissionRequestCard: destructive-gate mark, per-category
    consequence copy (DESTRUCTIVE_CONSEQUENCE, fail-closed to a generic sentence for any
    unrecognised or uncovered category), reversed Deny-filled/Allow-outline emphasis, and the
    tertiary allow-always button conditionally absent from the tree"
affects: [phase-3-verification]

# Actuals (#2632)
actuals:
  tokens: 11981
  tasks: 3
  commits: 3
plan_head_before: a5c4164

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A single presentational component branches on one nullable field (destructiveCategory)
      to select between two fully-distinct visual/behavioural treatments, rather than forking
      into a second component — extends PermissionRequestRow in place, one useRegionBindings
      call, one answer() function, so the tertiary action can never regress back in by being
      built in a code path the destructive branch forgot to exclude"
    - "Fail-closed default applied to COPY, not just gating: a per-category consequence-sentence
      lookup falls back to a generic-but-honest sentence for any category key the table does not
      hold (an unrecognised string OR a real classifier category the UI-SPEC's own copy table
      doesn't cover), mirroring destructive.rs's own Uncategorized default"
    - "Display-only re-derivation of a value the write path never persisted (a branch name),
      explicitly scoped to never influence any gating decision — the real classification already
      happened server-side before the card mounted"

key-files:
  created: []
  modified:
    - packages/core/src/query/permissions.rs
    - packages/core/tests/permission_gate.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/session/PermissionRequestCard.tsx
    - packages/desktop/src/session/__tests__/permission-card.test.tsx
    - DESIGN.md

key-decisions:
  - "Three of the six named categories' consequence sentences need a branch name that
    permission_requests.destructive_category never stores (03-07's classifier persists only
    the category string). Rather than adding a new column or a project-context prop, the
    renderer re-parses the SAME raw command text already shown in the Mono payload block, at
    display precision only, never used for any gating decision — the flagged assumption the
    plan itself named in advance, resolved rather than deferred."
  - "recursive-delete (a real DestructiveCategory the Rust classifier produces) has no
    dedicated sentence in 03-UI-SPEC.md's own six-row copy table, so it falls back to the
    generic uncategorized sentence — implemented literally as the plan's own action text
    specifies ('fall back to the uncategorized sentence for any key the record does not hold'),
    not corrected to a bespoke sentence, since the UI-SPEC's own table is the copy authority."
  - "Shift+A (answer-permission-allow-always) is gated inert INSIDE this row's own handler on
    the destructive variant, not left to fire silently against a backend write path that would
    reject it — 03-UI-SPEC.md's Keyboard Map Additions states Shift+A 'has no effect' on this
    variant, which is a behavioural claim, not just a visual one. state/keyboard.ts itself is
    untouched (still exactly 3 permission-card entries)."
  - "The destructive variant's 4px left-border stripe is NEW to this variant, not swapped from
    an existing one on the routine card — 03-UI-SPEC.md describes the routine card as already
    carrying a --blocked-text-rack stripe, but the shipped card (read fresh, this session) had
    none; only the glyph itself used that token. Adding a stripe to the routine card was out of
    this plan's declared files_modified, so the stripe was added only where the plan's own
    acceptance criteria required a new, testable distinguishing axis."

patterns-established:
  - "Per-category copy tables keyed by the same classifier-minted strings the database stores
    (DestructiveCategory::as_str()) are the reference shape for any future UI that must render
    different text per enum-like category value without a second source of truth for the
    vocabulary."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "A pending permission request carrying a destructive category renders a
      visually distinct variant of the existing permission card, in the same two mount points,
      over the same underlying row"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#destructive (20 tests)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/permission_gate.rs#pending_requests_for_run_round_trips_the_destructive_category_or_none"
        status: pass
    human_judgment: false
  - id: D2
    description: "Stop-sign glyph, 'Destructive action — needs your OK' heading, per-category
      consequence sentence, raw payload in Mono"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#destructive (glyph/heading/consequence tests + 6 named-category sentence tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Reversed button emphasis: Deny filled/primary, Allow outline/secondary
      reading 'Allow, just this once' — proved by comparing both variants' renders, not by
      asserting a colour in isolation"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#reverses the reflex"
        status: pass
    human_judgment: false
  - id: D4
    description: "No category value — named, uncategorized or unknown — ever produces a card
      offering the tertiary allow-always grant; the button is structurally absent, never merely
      disabled"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#exhaustive absence of the allow-always button (8-way it.each)"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src/session/PermissionRequestCard.tsx | grep -c 'disabled={.*destructive' == 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "The keyboard map is unchanged — the destructive variant reuses the same two
      action ids through the same region mechanism, no new key-map entry"
    requirement: "AGNT-07"
    verification:
      - kind: other
        ref: "grep -c 'region: \"permission-card\"' packages/desktop/src/state/keyboard.ts == 3"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/permission-card.test.tsx#pressing d resolves through the shared binding table on the destructive variant; Shift+A is inert"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full-suite regression-free: 413/413 desktop tests, every cargo workspace
      suite green, contrast.test.ts byte-identical and still passing, both builds clean"
    verification:
      - kind: other
        ref: "npm --prefix packages/desktop run test (413/413 pass)"
        status: pass
      - kind: other
        ref: "cargo test --workspace (0 failed across every suite)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/desktop run build / cargo build --workspace"
        status: pass
    human_judgment: true
    rationale: "No live Tauri shell or headless-Chromium screenshot pass was run this session
      (no GUI display available to this executor, matching every prior Phase 3 plan's own
      precedent). The Impeccable detector (detect.mjs --json) was run directly against
      PermissionRequestCard.tsx and legend/marks.ts and reported zero findings, and every
      behavioural/copy assertion is covered by an automated test, but final visual confirmation
      of the stop sign, the consequence sentence and the reversed button pair in the running app
      — plus the plan's own <human-check> (two real destructive attempts against a live session)
      — is deferred to the phase's consolidated end-of-phase UAT per
      workflow.human_verify_mode: end-of-phase."

# Metrics
duration: ~25min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 12: The Destructive-Action Gate Card Summary

**A destructive-action gate variant of the permission card — stop-sign glyph, per-category consequence copy, and reversed Deny-filled/Allow-outline emphasis that repurposes approve-by-muscle-memory as the safety mechanism, with the tertiary allow-always action structurally absent from the tree.**

## Performance

- **Duration:** ~25 min (three task commits span 12 min wall-clock; total includes required reading of 03-UI-SPEC.md, 03-PATTERNS.md, both prior-wave SUMMARYs, and the current shipped code for every file this plan touches, per the plan's own read_first gates)
- **Started:** 2026-09-15T09:01:08Z (first commit)
- **Completed:** 2026-09-15T09:13:06Z (last task commit)
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments

- `pending_requests_for_run` (`packages/core/src/query/permissions.rs`) now selects
  `destructive_category` on every row, `None` for a routine request — with a comment restating
  that this read still returns ALL pending rows for a run, never just the latest (Phase 2's own
  fix, unchanged). `PendingPermissionRequestDto` (Tauri command + TypeScript mirror) carries the
  same field through the existing `agent_run_pending_permissions` command — no new command added.
- `PermissionRequestCard.tsx`'s `PermissionRequestRow` extends into the destructive variant: the
  `destructive-gate` mark (`OctagonAlert`, the tenth agent-channel entry), the heading "Destructive
  action — needs your OK" above the tool name, a per-category consequence sentence
  (`DESTRUCTIVE_CONSEQUENCE`, fail-closed to a generic sentence for any category the six-row table
  doesn't cover — including `recursive-delete`, a real classifier category the UI-SPEC's own copy
  table omits), reversed button emphasis (Deny filled/primary using `DeleteConfirm.tsx`'s
  destructive styling, Allow outline/secondary reading "Allow, just this once"), and the tertiary
  allow-always button conditionally absent from the JSX — never rendered-and-disabled.
- `Shift+A` gated inert on the destructive variant inside this row's own handler (not by touching
  `state/keyboard.ts`, which stays at exactly 3 `permission-card` entries).
- 28 new/updated tests: the round-trip test in `permission_gate.rs`, and 28 tests in
  `permission-card.test.tsx` covering every `<behavior>` bullet — null-category-unchanged, glyph/
  heading/consequence/payload, no allow-always button, reversed background/label, the
  reflex-reversal comparison, keyboard behavior, double-press guard, independent concurrent cards,
  long-branch wrapping, unrecognised-category and `recursive-delete` fallback, one test per named
  category's own sentence, and the exhaustive 8-way absence test.
- `DESIGN.md` gained a Phase 3 Plan 03-12 entry naming the variant, the mark, the reused tokens,
  the branch-name re-parse (a known cost flagged in the plan itself and resolved here), the
  fail-closed copy fallback, the reversed-emphasis reasoning, and the judgment call that the
  border stripe is new to this variant rather than swapped from an existing routine-card stripe.

## Task Commits

Each task was committed atomically:

1. **Task 1: Carry the category from the row to the renderer** - `961797b` (feat)
2. **Task 2: The variant — stop sign, consequence sentence, reversed emphasis, no third action** - `4d05407` (feat)
3. **Task 3: Prove the reflex reversal and the absent third action, and record the variant in DESIGN.md** - `3e3f09e` (test)

**Plan metadata:** committed alongside this SUMMARY.

## Files Created/Modified

- `packages/core/src/query/permissions.rs` - `destructive_category` added to `PendingPermissionRequest` and its SELECT (Task 1)
- `packages/core/tests/permission_gate.rs` - round-trip test against `DestructiveCategory::as_str()` (Task 1)
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `PendingPermissionRequestDto.destructive_category` (Task 1)
- `packages/desktop/src/adapters/tauri.ts` - `PendingPermissionRequestDto.destructiveCategory` (Task 1)
- `packages/desktop/src/legend/marks.ts` - `destructive-gate` mark, the tenth agent-channel entry (Task 2)
- `packages/desktop/src/legend/__tests__/legend.test.tsx` - agent-channel count bumped 9 -> 10 (Task 2, Rule 3)
- `packages/desktop/src/session/PermissionRequestCard.tsx` - the destructive variant (Task 2)
- `packages/desktop/src/session/__tests__/permission-card.test.tsx` - 28 new tests (Tasks 2-3)
- `DESIGN.md` - Phase 3 Plan 03-12 entry (Task 3)

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adding a tenth agent-channel mark broke the existing legend suite's fixed count**
- **Found during:** Task 2, first run of the full desktop test suite after appending `destructive-gate`
- **Issue:** `legend/__tests__/legend.test.tsx` asserted exactly nine agent-channel marks by name (bumped there by 03-11); adding a tenth mark made that assertion fail.
- **Fix:** Updated the assertion to ten entries, added `destructive-gate` to the expected list, and added a legend-row rendering test mirroring the existing pattern for `worktree-missing`/`recovery-needed`.
- **Files modified:** `packages/desktop/src/legend/__tests__/legend.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test` — 405/405 pass (413/413 after Task 3's own additions)
- **Committed in:** `4d05407` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking). **Impact:** Necessary for the test suite to stay
green after a planned, expected registry growth; no scope creep — the fix only updates an existing
assertion's fixed count and adds a matching legend-row test, the same fix 03-11 made for the exact
same reason one plan earlier.

## Issues Encountered

- **The UI-SPEC describes a 4px border stripe on the ROUTINE permission card that does not exist
  in the shipped code** (only the glyph itself carries `--blocked-text-rack`). Resolved as a
  judgment call, documented in `key-decisions` above and in `DESIGN.md`: the stripe is added only
  to the destructive variant rather than retrofitting the routine card (out of this plan's
  declared `files_modified`) or silently dropping the distinguishing axis.
- **`permission_requests.destructive_category` never stores the branch name three of the six
  consequence sentences need** — exactly the assumption the plan's own `flagged_assumptions` named
  in advance. Resolved by a best-effort re-parse of the raw command text already rendered in the
  Mono payload block, explicitly scoped to display-only use (never a gating decision), with a
  category-correct fallback sentence when the parse cannot resolve a name.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- This was the FINAL plan of Phase 3 (Nothing Lost, Nothing Left Running) — all 13 plans now have
  matching SUMMARYs.
- **Outstanding for the phase's consolidated end-of-phase UAT** (per
  `workflow.human_verify_mode: end-of-phase`): this plan's own `<human-check>` (two real
  destructive attempts against a live session, confirming the stop sign, consequence sentence,
  reversed buttons, and that the Settings permission-rules table gains no row after answering
  Allow) plus every other Phase 3 plan's deferred human-verify items — 03-07's real force-push
  session check chief among them, since it shares the exact same permission-request row this card
  renders.
- The branch-name re-parse in the renderer duplicates logic that already lives in
  `destructive.rs`. If a future plan needs more display-only detail out of a classified command,
  carrying it through `permission_requests` as a structured field is the better-scoped fix — not
  built here since this plan's `files_modified` never scoped a schema change.
- No blockers. `cargo build --workspace`/`cargo test --workspace` (0 failed across every suite)
  and `npm --prefix packages/desktop run build`/`run test` (413/413 pass) all green after this
  plan's additions.

## Self-Check: PASSED

All key files verified present on disk. All three task commits (`961797b`, `4d05407`, `3e3f09e`)
verified present in `git log`. `cargo build --workspace`, `cargo test -p core --test
permission_gate` (13/13), `cargo test --workspace` (0 failed across every suite), `npm --prefix
packages/desktop run build`, and `npm --prefix packages/desktop run test` (413/413 pass) all
re-confirmed before this SUMMARY was written. `grep -c 'destructive-gate'
packages/desktop/src/legend/marks.ts` returns `1`. `grep -ciE 'destructive-gate|Destructive
action' DESIGN.md` returns `3`. `grep -c 'region: "permission-card"'
packages/desktop/src/state/keyboard.ts` returns `3` (unchanged).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*
