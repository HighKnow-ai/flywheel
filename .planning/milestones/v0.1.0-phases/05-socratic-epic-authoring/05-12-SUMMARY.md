---
phase: 05-socratic-epic-authoring
plan: 12
subsystem: ui
tags: [tauri, react, authoring, session-feed, sidecar, tdd]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: the authoring stage machine (D-88/D-90), the proposal tray and its decision relays, the sidecar's send_authoring_turn/authoring_turn wire op, and the session feed/FeedRow rendering pipeline plans 05-01 through 05-11 already built
provides:
  - The one seam between a developer and a live authoring session's conversation — a composer, a Tauri command, and a wrapper — closing gap G-05-2
  - A transcript contract where every turn the application sends (developer-typed or system-generated) persists before it is emitted and renders exactly one row, attributed to the right speaker
  - A named backend_echo event distinguishing the backend's own restatement of a turn from the agent's actual prose
affects: [05-13-socratic-epic-authoring, 05-VERIFICATION, 05-UAT]

# Actuals (#2632)
actuals:
  tokens: 10623
  tasks: 3
  commits: 8

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Command surfacing its own delivery failure (authoring_turn_send) rather than the fire-and-forget/best-effort discipline every sibling authoring relay uses — documented explicitly as the one deliberate departure."
    - "Synchronous-dispatch ref guard (sendingRef) on a composer, extending the stoppingRef/advancingStageRef family already established in this file."
    - "A transcript event carrying no seq (developer_turn, written directly by the Rust core rather than through the sidecar's per-session counter) keyed by its own minted turnId instead."

key-files:
  created:
    - packages/desktop/src/session/__tests__/authoring-composer.test.tsx
  modified:
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/session/FeedRow.tsx
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/adapter.test.mjs

key-decisions:
  - "SidecarHandle::send_authoring_turn's signature widening (app handle + AuthoringTurnOrigin) landed in the SAME commit as Task 1's new command rather than waiting for Task 2's own commit, since the command's own call needed the final signature immediately — documented as a deviation below."
  - "All three system-generated turns (reject/amend/distillation) and the developer's own typed turn render through the SAME developer_turn row kind, discriminated only by an origin field on the persisted line — from the model's perspective, and the transcript's, all four are the human side of the conversation."
  - "The composer mounts inside its own flex column alongside the feed (raw or structured view), as a sibling of — never inside — the proposal tray's column, so the tray's own column width is unaffected."

requirements-completed: [SHAPE-01, SHAPE-05]

coverage:
  - id: D1
    description: "A developer can type a message into an authoring session's composer and the text reaches the live session through a new authoring_turn_send Tauri command."
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-composer.test.tsx#SessionSurface — authoring composer"
        status: pass
      - kind: integration
        ref: "cargo build --workspace"
        status: pass
    human_judgment: false
  - id: D2
    description: "The composer renders only for a live authoring run and disappears once the run reaches a terminal status; typing into it never advances the authoring stage."
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-composer.test.tsx#renders no composer for an ordinary task-execution run"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-composer.test.tsx#a bare Advance keypress while the composer holds focus does not advance the stage"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every turn the application sends into an authoring session — the developer's own, the two proposal-decision relays, and the distillation instruction — is persisted to the session log before it is emitted, and renders as exactly one feed row attributed to the right speaker."
    requirement: "SHAPE-05"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#sidecar::persist_tests::authoring_turn_line_carries_type_run_id_text_and_origin"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#sidecar::persist_tests::two_builder_calls_with_different_turn_ids_never_collide_on_one_feed_key"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-composer.test.tsx#buildFeedRows: two developer-turn entries never collide on one feed key"
        status: pass
    human_judgment: false
  - id: D4
    description: "The backend's own restatement of a turn (arriving on the model stream as a user-role message) never renders a second, duplicate row beside the core's own developer_turn record."
    requirement: "SHAPE-05"
    verification:
      - kind: unit
        ref: "packages/sidecar/test/adapter.test.mjs#normaliseStreamEvent: a user-role message's text block normalises to backend_echo, not assistant_text (Task 3)"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-composer.test.tsx#a feed window holding both a core-written turn and the backend's echo of the same text renders one row"
        status: pass
    human_judgment: false
  - id: D5
    description: "A send that does not reach the live session reports that failure and keeps the typed text in the composer, rather than silently discarding it."
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-composer.test.tsx#a rejected send leaves the typed text in place and surfaces a worded message"
        status: pass
    human_judgment: false

# Metrics
duration: 33min
completed: 2026-09-24
status: complete
---

# Phase 05 Plan 12: Authoring Composer Summary

**One typed line now reaches a live authoring session's stdin end to end — a new `authoring_turn_send` Tauri command, a composer on `SessionSurface`, and a transcript contract where every application-sent turn persists before it emits and renders exactly one row.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-09-23T23:10:19Z
- **Completed:** 2026-09-23T23:43:01Z
- **Tasks:** 3
- **Files modified:** 10 (1 created, 9 modified)

## Accomplishments

- Closed gap G-05-2: the challenge stage — the stage the whole phase is about — now has a human channel. A developer can type into the composer and see the reply, with D-88's tool gate and D-90's human-only advance both untouched.
- `authoring_turn_send` (Rust command) validates (trim, empty-reject, an 8000-character ceiling), confirms the run carries a live authoring stage and a status that can still receive a turn, then relays through the sidecar — and unlike every sibling authoring relay in this codebase, it **surfaces** delivery failure instead of swallowing it, because a developer who pressed send is entitled to know it did not land.
- `SidecarHandle::send_authoring_turn` now persists every turn to the session log (a new pure, unit-tested `build_authoring_turn_line` builder) and emits it on `agent:event` — in that order — BEFORE the sidecar request is ever sent, closing the gap where the three existing system-generated relays (reject/amend/distillation) left no trace in the transcript at all.
- A `developer_turn` feed row (accent-coloured, visually distinct from `assistant_text`) and a `backend_echo` event (suppressed, since the backend restates what the core already recorded) together guarantee every turn renders exactly once.

## Task Commits

Each task followed RED → GREEN per its own `tdd="true"` gate:

1. **Task 1: End-to-end — one typed line reaches the live session** (tracer)
   - `test(05-12)` — `c38ad01` (RED: 5/6 composer cases failing, textbox not found)
   - `feat(05-12)` — `4b6757b` (GREEN: command, wrapper, composer, and the widened `send_authoring_turn` signature its own call needed)
2. **Task 2: Every turn the app sends leaves exactly one transcript row**
   - `test(05-12)` — `aeac840` (RED: developer_turn falls through to the raw-row branch)
   - `feat(05-12)` — `d08cdec` (GREEN: `FeedRow.tsx`'s new variant/case, `buildFeedRows`/`keyForEvent` mapping)
3. **Task 3: The backend's own restatement never doubles a turn, and typing never advances the stage**
   - `test(05-12)` — `6d7bbf4` (RED: sidecar normaliser case)
   - `feat(05-12)` — `5b6323c` (GREEN: `backend_echo` event + normaliser split)
   - `test(05-12)` — `853ac89` (RED: renderer suppression case — two rows for one echoed turn)
   - `feat(05-12)` — `21c4e37` (GREEN: `backend_echo` added to `SUPPRESSED_EVENT_TYPES`)

**Plan metadata:** this commit (docs: complete plan)

_No `refactor` commit was needed for any task — each GREEN implementation was minimal and needed no cleanup pass._

## Files Created/Modified

- `packages/desktop/src-tauri/src/commands/authoring.rs` — new `authoring_turn_send` command; the three existing relay call sites updated to the widened `send_authoring_turn` signature
- `packages/desktop/src-tauri/src/main.rs` — registers `authoring_turn_send`
- `packages/desktop/src-tauri/src/sidecar.rs` — `AuthoringTurnOrigin`, `build_authoring_turn_line`, widened `send_authoring_turn` (persist-then-emit), two new unit tests
- `packages/desktop/src/adapters/tauri.ts` — `sendAuthoringTurn` wrapper
- `packages/desktop/src/session/SessionSurface.tsx` — `AuthoringComposer` component, layout restructure (feed + composer share a column, tray stays its own sibling), `buildFeedRows`/`keyForEvent` extensions, `backend_echo` suppression
- `packages/desktop/src/session/FeedRow.tsx` — `developer_turn` row variant and render case
- `packages/desktop/src/session/__tests__/authoring-composer.test.tsx` — new file, 10 cases across all three tasks
- `packages/sidecar/src/adapter.ts` — `BackendEchoEvent` added to the `AgentEvent` union
- `packages/sidecar/src/claude-code-adapter.ts` — normaliser splits a user-role text block to `backend_echo`
- `packages/sidecar/test/adapter.test.mjs` — three new normalisation cases

## Decisions Made

- `SidecarHandle::send_authoring_turn`'s signature widening (Task 2's own job per the plan's task split) landed in the same commit as Task 1's new command, because that command's own call site needed the final `(app, run_id, text, origin)` shape to compile at all — see Deviations below.
- All four turn sources (developer-typed, reject, amend, distillation) render through the SAME `developer_turn` row kind, discriminated only by a persisted `origin` field — not by a second row kind — since from the model's perspective and the transcript's, all four are the human side of the conversation.
- The composer mounts inside its own flex column together with the feed (whichever view — raw or structured — is active), as a sibling of the proposal tray's column rather than inside it, so the tray's fixed 320px width is unaffected regardless of composer visibility.
- The maximum turn length is 8000 characters — several times the staged-proposal bounds (500/1000), since a turn is free conversation, not a title or a field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Task 1's own command required Task 2's signature widening to compile**
- **Found during:** Task 1 (writing `authoring_turn_send`)
- **Issue:** The plan splits `SidecarHandle::send_authoring_turn`'s signature widening (app handle + `AuthoringTurnOrigin`) into Task 2, but Task 1's own command needs to call it with a surfaced error and (once Task 2 exists) the persist-before-emit discipline. Writing Task 1's command against the OLD 2-argument signature and then immediately changing it again in Task 2 would mean re-touching the same call site twice for no benefit.
- **Fix:** Implemented the widened `send_authoring_turn` signature (and the three existing relay call sites' updates) as part of Task 1's own commit, then completed Task 2's remaining renderer-side work (`FeedRow.tsx`, `buildFeedRows`, `keyForEvent`) in its own RED/GREEN pair. Task 1's own TDD gate (the composer test file) still ran a true RED→GREEN cycle; only the Rust-side prerequisite landed one commit early.
- **Files modified:** `packages/desktop/src-tauri/src/sidecar.rs`, `packages/desktop/src-tauri/src/commands/authoring.rs`
- **Verification:** `cargo build --workspace` and `cargo test -p desktop` both green in the Task 1 commit; Task 2's own verify commands (grep counts, vitest) still ran and passed against files whose corresponding logic had not yet moved to Task 2's commit, confirming no double-work and no silently-missing behaviour.
- **Committed in:** `4b6757b` (Task 1's GREEN commit)

**2. [Rule 1 - Bug] A false-pass in the Task 2 RED-phase render test**
- **Found during:** Task 2 (writing the developer_turn render test)
- **Issue:** The initial `waitFor(() => expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0))` assertion succeeded immediately because `StartingSessionRow` (the "Starting session…" placeholder) also carries `role="listitem"` — the test would have reported RED for the wrong reason (a race, not the missing developer_turn mapping) had it been left in place.
- **Fix:** Replaced the two-step assertion with `screen.findByText(...)`, which polls until the actual feed content resolves.
- **Files modified:** `packages/desktop/src/session/__tests__/authoring-composer.test.tsx`
- **Verification:** Re-ran the RED test to confirm it fails on the intended assertion (text not found), then re-ran after the GREEN implementation to confirm it passes.
- **Committed in:** `d08cdec` (folded into Task 2's GREEN commit, since the fix was to the just-written RED test itself, not yet-committed at the time it was found)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug). **Impact on plan:** Neither affects the shipped behaviour or the plan's `must_haves`/threat register — the first is a commit-boundary reorganisation with identical end-state code, the second is a test-authoring correction caught before the RED commit landed.

## Issues Encountered

None beyond the two deviations above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The one seam this plan closes (G-05-2) unblocks the Product Kill Criterion's in-app timed-comparison arm (`05-SPIKE-FINDINGS.md`): a developer can now say what they want to build and answer the agent's challenges inside the app.
- `05-13-PLAN.md` (or whichever plan is next in this phase) can build on a session transcript that already has a stable, tested contract for turns sent from either side of the conversation.
- `SHAPE-01`/`SHAPE-05` are declared by numerous sibling plans in this phase (05-01 through 05-13) and stay `Incomplete` in the traceability table until every declaring plan has its own SUMMARY — this plan's own work toward them is done; the shared-ID gate is working as designed, not a gap.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- All 10 key files (1 created, 9 modified) confirmed present on disk.
- All 8 task commits (`c38ad01`, `4b6757b`, `aeac840`, `d08cdec`, `6d7bbf4`, `5b6323c`, `853ac89`, `21c4e37`) confirmed in `git log`.
- Plan-level `<verification>` re-run: `cargo build --workspace` clean; `cargo test --workspace` green (0 failures); `cargo test -p desktop` 35/35; `npm --prefix packages/desktop run build` clean; `npm --prefix packages/desktop run test` 548/548; `npm --prefix packages/sidecar test` 143/143; `SessionSurface.tsx` holds zero `invoke(` calls and zero hex colour literals; `authoring_turn_send` registered exactly once in `main.rs` and reached only through `sendAuthoringTurn` in `adapters/tauri.ts`.
