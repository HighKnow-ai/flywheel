---
phase: 05-socratic-epic-authoring
plan: 03
subsystem: agent-authoring
tags: [pretooluse-hook, mcp-tool-gate, rusqlite, tauri-command, react, keyboard-map, legend]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-01's measured stage_gate_matcher: intercepts / denial_outcome: recoverable finding, and plan 05-02's authoring_session.rs/agent_runs.authoring_stage/mcp-permission-server.ts propose_task tool, all built on without re-deriving"
provides:
  - "D-88's stage machine as a structural gate: a PreToolUse hook (stage-gate-hook.ts) that reads a per-run <runtime>/stage/<runId>.json marker fresh per matched tool call and denies mcp__flywheel-permissions__(propose|amend|delete)_.* during the challenge stage — the SAME PreToolUse mechanism the destructive-command gate already uses, extended with a second matcher entry, never a second gating layer"
  - "advance_stage (rewritten) and return_to_stage (new): guarded UPDATE (WHERE id AND authoring_stage), the runtime marker written as the LAST step before commit so the row and the marker can never disagree, both taking a human actor id with no agent-reachable caller anywhere in this workspace (D-90), proven by a source-scanning gate over packages/sidecar/src"
  - "authoring_stage_advance/authoring_stage_return: the Tauri command surface for the one gate the whole phase depends on"
  - "The stage on screen: SessionSurface.tsx's AuthoringStageIndicator (all three stages, current marked) and AuthoringStageControls (Advance/Return, synchronously guarded, shared by a click and the n keyboard binding), plus a gate-missing banner keyed off a new flywheelStageGateMissing event discriminant"
affects: [05-04-*, 05-05-*, phase-05-verification]

actuals:
  tokens: 24265
  tasks: 3
  commits: 3
  plan_head_before: 4c7bfb60046f6a44dc2a5f5b3c4dbb8ae5e0e0b3

tech-stack:
  added: []
  patterns:
    - "A second PreToolUse matcher entry added to writeHookSettings alongside the existing Bash one — proves the destructive-gate mechanism (plan 03-07) generalizes to gating a second MCP server's tool names by a name-prefix regex, without a second gating layer or a second spawned process"
    - "Guarded UPDATE ... WHERE id = ?1 AND <state_column> = ?2, with a side-effecting write (here: a runtime marker file) deferred to the LAST step before commit — a marker-write failure rolls the whole transaction back rather than leaving the DB and the on-disk marker able to disagree (T-05-03-05)"
    - "Source-scanning structural gate over a DIFFERENT package's src tree (packages/core/tests asserting over packages/sidecar/src) — proves an agent-reachability claim as a property of the code rather than a promise in a comment, the same shape supervisor_cwd.rs already established within packages/core itself"
    - "A synchronously-guarded handler lifted OUT of the button component and shared between a click handler and a keyboard ActionId handler, so a click and a keypress can never race each other into two backend calls — the seventh sibling of this codebase's ackActingRef/answeringRef/stoppingRef re-entry-guard pattern, and the first one shared across two distinct trigger surfaces"

key-files:
  created:
    - packages/sidecar/src/stage-gate-hook.ts
    - packages/sidecar/test/authoring-stage-gate.test.mjs
    - packages/core/tests/authoring_stage.rs
    - packages/desktop/src/session/__tests__/authoring-stage.test.tsx
  modified:
    - packages/core/src/runtime_protocol.rs
    - packages/core/tests/runtime_protocol.rs
    - packages/core/src/domain/authoring_session.rs
    - packages/core/tests/authoring_tracer.rs
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/adapter.ts
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/legend/marks.ts
    - packages/desktop/src/legend/__tests__/legend.test.tsx
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/adapters/tauri.ts

key-decisions:
  - "write_authoring_stage/read_authoring_stage route through the shared crate::ids::is_ulid predicate BEFORE runtime_dir() is ever resolved — the exact join site session_log_path hardened in plan 03-15, applied here to close T-05-03-03 (arbitrary run id -> file path) at the same one place"
  - "The stage-gate hook resolves the run it decides against from its OWN FLYWHEEL_RUN_ID/FLYWHEEL_RUNTIME_DIR environment only, never from the hook payload — a grep gate (stage-gate-hook.ts never matches payload.(runId|run_id)|tool_input.runId) makes T-05-03-02 a build-time property, not a review note"
  - "transition_stage's ordering is deliberate: guarded UPDATE -> append_event -> write_authoring_stage LAST, right before commit. A marker-write failure returns Err before commit is ever called, so the row simply never moves — T-05-03-05's 'marker and row must never disagree' contract, verified by a real test that blocks the runtime dir and asserts the row stayed put"
  - "advance_stage/return_to_stage share one transition_stage body via a compute_next(current) closure — advance walks AuthoringStage::next(), return takes the caller's target unconditionally (D-90: asserts nothing about the target being earlier than current) — one guarded-UPDATE-plus-marker-write implementation, not two"
  - "authoring_stage_return (the Tauri command name) is deliberately excluded from the source-scanning gate's three forbidden names, matching 05-03-PLAN.md Task 2's own literal enumeration (advance_stage, return_to_stage, authoring_stage_advance) rather than a broader net the plan itself did not ask for"
  - "advance/return handlers live in SessionSurface.tsx itself (handleAdvanceStage/handleReturnStage with their own useRef guards), not inside AuthoringStageControls — the n keyboard binding and the button's onClick both call the SAME guarded function, so a synchronous click-then-keypress (or vice versa) can never issue two backend calls the way two independently-guarded copies could"
  - "previousAuthoringStage/AUTHORING_STAGES exported from SessionSurface.tsx and imported into CommandPalette.tsx for the return-stage entry, rather than a second, independently-maintained copy of D-88's fixed three-stage order in the palette file"
  - "flywheelStageGateMissing is a new optional field on SystemNoticeEvent (adapter.ts), mirroring sidecar.rs::emit_persistence_failure_notice's own flywheelPersistenceFailure discriminant exactly — the banner matches on this field, never on the notice's prose, which could drift"

patterns-established:
  - "A shared guarded-transition helper (transition_stage) parameterised by a compute_next closure — the shape a THIRD stage-machine verb (if this phase ever needed one) would extend without a third guarded-UPDATE-plus-marker-write copy"

requirements-completed: [SHAPE-01]

coverage:
  - id: D1
    description: "A proposal-writing MCP tool call is refused before its handler runs while the run is in the challenge stage; a read-only or non-proposal call is unaffected in every stage — the gate refuses a class, not a session"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/authoring-stage-gate.test.mjs (11 tests: challenge denies, decompose/criteria allow, missing/unrecognised marker denies, unset FLYWHEEL_RUN_ID/FLYWHEEL_RUNTIME_DIR denies, matcher regex matches propose_task and not approve_action/report_summary/a read tool)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/sidecar test (124/124)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Only a human command advances or returns the authoring stage — no code path reachable from a tool handler or the sidecar can call it, proven by a source-scanning gate, not a comment"
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_stage.rs#no_sidecar_source_names_the_human_only_advance_path"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_stage.rs#advance_walks_challenge_to_decompose_to_criteria, #advancing_past_criteria_errors_never_a_silent_no_op"
        status: pass
      - kind: other
        ref: "grep gate: grep -rn 'advance_stage|return_to_stage|authoring_stage_advance' packages/sidecar/src (comment-stripped) = 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Returning to an earlier stage is always allowed and leaves every already-staged proposal untouched; a marker-write failure rolls the whole transaction back, leaving the row at its prior value"
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_stage.rs#return_to_challenge_from_criteria_leaves_existing_proposal_rows_byte_identical"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_stage.rs#a_marker_write_failure_leaves_the_row_at_its_prior_value"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test authoring_stage (9/9), cargo test --workspace"
        status: pass
    human_judgment: false
  - id: D4
    description: "A failure to install the stage gate is visible on the session surface (a system_notice carrying flywheelStageGateMissing, rendered as a banner), never a silent degradation to an ungated session"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-stage.test.tsx (gate-missing banner: 3 tests — absent by default, renders on the run's own notice, ignores a notice for a different run)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (485/485)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The current authoring stage is visible while the session runs (all three stages, current marked); the Advance affordance names the stage it moves to and is disabled at the last stage; n in the session-surface region advances the stage without colliding with the global Cmd+N create-task binding"
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/session/__tests__/authoring-stage.test.tsx (stage indicator + Advance/Return control tests, 12 of the 15)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run build; npm --prefix packages/desktop run test -- src/legend (12/12)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The challenge stage does not degrade into agreeable validation — a live-conversation quality property, not a mechanism this or any prior plan can structurally prove"
    verification: []
    human_judgment: true
    rationale: "Flagged in 05-03-PLAN.md's own must_haves.prohibitions (category: values, status: unverified). This plan proves the STRUCTURAL half — no proposal tool is reachable during challenge (D1/D2 above) — but whether the model's actual conversational behaviour genuinely challenges rather than agrees is a live, human-paced judgment call no autonomous executor can perform or fabricate. Recorded in .planning/WINDOWS.md (entry #14, unrun-verify), alongside entry #13's still-open product kill criterion from plan 05-02 — both are judged together at end-of-phase UAT per workflow.human_verify_mode=end-of-phase."

duration: ~150min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 03: The Stage Gate Summary

**D-88's three-stage machine is now a structural refusal, not a prompt instruction: a `PreToolUse` hook denies `propose_task` before its handler ever runs while an authoring session sits in the `challenge` stage, only a human-driven Tauri command can ever advance or return that stage (proven by a source-scanning gate over the sidecar's own source), and the developer can see exactly which of the three stages a session is in and what Advance does next.**

## Performance

- **Duration:** ~150 min
- **Started:** 2026-09-23
- **Completed:** 2026-09-23
- **Tasks:** 3
- **Files created:** 4
- **Files modified:** 14

## Accomplishments

- **Task 1 — the stage marker and the hook.** `core::runtime_protocol` gained `write_authoring_stage`/`read_authoring_stage`, writing `<runtime_dir>/stage/<run_id>.json` through the same `atomic_write` idiom every other per-run runtime file already uses, routed through the shared `is_ulid` predicate before any path is built (closing T-05-03-03 the same way `session_log_path` did in plan 03-15). `clear_run_runtime_files` now removes the stage marker alongside the descriptor, kill record, contention log and lifecycle timeline it already cleaned up. `stage-gate-hook.ts` (new) mirrors `pretooluse-hook.ts`'s structure exactly: reads stdin fully, resolves `FLYWHEEL_RUN_ID`/`FLYWHEEL_RUNTIME_DIR` from its OWN environment (never the payload — T-05-03-02, backed by a grep gate), reads the marker fresh per call, and denies with a reason written against `05-SPIKE-FINDINGS.md`'s own quoted model response for `challenge`, allows for `decompose`/`criteria`, and fails closed on anything else. `writeHookSettings` now writes a SECOND `PreToolUse` entry (`mcp__flywheel-permissions__(propose|amend|delete)_.*`) beside the byte-identical existing `Bash` one. `startAuthoringSession` now emits a `system_notice` (carrying a new `flywheelStageGateMissing` field) instead of silently degrading when `writeHookSettings` fails — the authoring path's posture is deliberately stronger than the task-execution path's existing fail-open-with-log, per the plan's own threat table (T-05-03-01).
- **Task 2 — the human holds the gate.** `advance_stage` was rewritten (and `return_to_stage` added) around a shared `transition_stage` helper: a guarded `UPDATE ... WHERE id = ?1 AND authoring_stage = ?2` so a concurrent double-transition fails loudly rather than racing past a stage, and the runtime marker write moved to the LAST step before `commit` — a marker-write failure now returns an `Err` before the transaction ever commits, so the row and the on-disk marker can never disagree (T-05-03-05, proven by a test that blocks the runtime directory and asserts the row stayed at `challenge`). `return_to_stage` asserts nothing about its target beyond it being a valid stage name (D-90) and leaves every staged proposal's `status`/`payload` byte-identical, proven by a real before/after comparison. Both new Tauri commands (`authoring_stage_advance`/`authoring_stage_return`) resolve the human actor server-side and are registered in `main.rs`. `packages/core/tests/authoring_stage.rs` (new) adds a source-scanning gate — no file under `packages/sidecar/src` may name `advance_stage`, `return_to_stage` or `authoring_stage_advance` — turning D-90's "no agent-reachable caller" claim into a build failure rather than a review note.
- **Task 3 — the stage on screen.** `SessionSurface.tsx` gained `AuthoringStageIndicator` (all three stages rendered in fixed order, the current one marked via an existing rack-text-role colour, no new token) and `AuthoringStageControls` (Advance — labelled with the stage it moves to, disabled at `criteria` — and a "way back" Return control). Both are driven by handlers living in `SessionSurface` itself, guarded by a synchronous `useRef` and SHARED between the button's `onClick` and the new `n` keyboard binding (`state/keyboard.ts`'s `advance-stage` ActionId, scoped to the `session-surface` region — verified not to collide with the global `Cmd+N` create-task binding, which requires `meta`). `return-stage` is a command-palette-only ActionId; wiring it into `CommandPalette.tsx` was a necessary Rule 1 follow-on (an unreachable palette entry that fired nothing would have been worse than not adding it). `marks.ts` gained four `agent`-channel marks (three stage marks plus `proposal-pending`, which deliberately does NOT reuse the blocked glyph/colour per D-46 — a pending proposal burns no money). The gate-missing banner reuses `PersistenceFailureBanner`'s exact shape, keyed off the new `flywheelStageGateMissing` event field rather than matching on prose.

## Task Commits

Each task was committed atomically:

1. **Task 1: The stage marker and the hook that reads it** — `7ea7b82` (feat)
2. **Task 2: The human holds the gate — advance, go back, and no agent-reachable path to either** — `1624378` (feat)
3. **Task 3: The stage on screen** — `d75041a` (feat)

## Files Created/Modified

- `packages/sidecar/src/stage-gate-hook.ts` — the `PreToolUse` stage-gate hook
- `packages/sidecar/test/authoring-stage-gate.test.mjs` — 11 tests covering the hook's decisions, the matcher regex, and `writeHookSettings`' own shape
- `packages/core/src/runtime_protocol.rs` — `write_authoring_stage`/`read_authoring_stage`, `AuthoringStageMarker`, `clear_run_runtime_files` extended
- `packages/core/tests/runtime_protocol.rs` — round-trip, non-ULID rejection, malformed-marker, and cleanup tests
- `packages/core/src/domain/authoring_session.rs` — `transition_stage`, rewritten `advance_stage`, new `return_to_stage`
- `packages/core/tests/authoring_tracer.rs` — wrapped `advance_stage`-calling tests in a scratch `FLYWHEEL_RUNTIME_DIR` (now that `advance_stage` touches the filesystem)
- `packages/core/tests/authoring_stage.rs` — behavior tests plus the source-scanning structural gate
- `packages/sidecar/src/claude-code-adapter.ts` — `stageGateHookScriptPath`, `AUTHORING_STAGE_GATE_MATCHER`, `writeHookSettings` extended, the `system_notice`/`flywheelStageGateMissing` emission
- `packages/sidecar/src/adapter.ts` — `SystemNoticeEvent.flywheelStageGateMissing`
- `packages/desktop/src-tauri/src/commands/authoring.rs` — `authoring_stage_advance`, `authoring_stage_return`
- `packages/desktop/src-tauri/src/main.rs` — both commands registered
- `packages/desktop/src/session/SessionSurface.tsx` — the stage indicator, controls, gate-missing banner, guarded handlers
- `packages/desktop/src/state/keyboard.ts` — `advance-stage`/`return-stage` ActionIds
- `packages/desktop/src/legend/marks.ts` — four new `agent`-channel marks
- `packages/desktop/src/legend/__tests__/legend.test.tsx` — updated agent-channel count (10 -> 14) and the new marks' exact ids/glyphs/labels
- `packages/desktop/src/board/CommandPalette.tsx` — the `return-stage` palette entry
- `packages/desktop/src/adapters/tauri.ts` — `authoringStageAdvance`/`authoringStageReturn` typed wrappers
- `packages/desktop/src/session/__tests__/authoring-stage.test.tsx` — 15 tests covering the indicator, controls, keyboard binding, gate-missing banner, and the `BINDINGS` table entries

## Decisions Made

See `key-decisions` in frontmatter — all eight are load-bearing choices made while implementing the plan's own action items, not deviations from it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `CommandPalette.tsx` needed a `return-stage` case once the ActionId became palette-reachable**
- **Found during:** Task 3, after adding `return-stage` as a `command-palette`-region entry in `state/keyboard.ts`
- **Issue:** `CommandPalette.tsx`'s command list is generated from `allActionIds()`, so `return-stage` would appear in the palette automatically — but with no `case "return-stage":` in the palette's own switch, selecting it would silently do nothing: a dead menu entry, worse than not adding the ActionId at all.
- **Fix:** Added the case, mirroring `shape-epic`'s own direct-`run()` pattern; exported `AUTHORING_STAGES`/`previousAuthoringStage` from `SessionSurface.tsx` so the palette computes the same target stage rather than a second, independently-maintained copy of D-88's fixed order.
- **Files modified:** `packages/desktop/src/board/CommandPalette.tsx`, `packages/desktop/src/session/SessionSurface.tsx`
- **Verification:** `npm --prefix packages/desktop run build` succeeds; `CommandPalette.tsx` was not in the plan's own `files_modified` list, but the change was necessary to avoid shipping a broken command.
- **Committed in:** `d75041a` (Task 3's own commit)

**2. [Rule 1 - Bug] `legend.test.tsx`'s hardcoded agent-channel count (10) broke once this plan's four marks landed**
- **Found during:** Task 3's own `npm --prefix packages/desktop run test -- src/legend` run
- **Issue:** `has exactly ten entries with the exact ids/glyphs/labels...` asserted a fixed count and an exhaustive id list that predates this plan's four new marks.
- **Fix:** Updated the count to fourteen and added the four new marks' exact ids/glyphs/labels to the expected list; added one more assertion that the pending-proposal mark never reuses the blocked glyph/wording (D-46).
- **Files modified:** `packages/desktop/src/legend/__tests__/legend.test.tsx`
- **Verification:** `npm --prefix packages/desktop run test -- src/legend` (12/12 pass)
- **Committed in:** `d75041a` (Task 3's own commit)

**3. [Rule 3 - Blocking] `authoring_tracer.rs`'s pre-existing tests would have written to the developer's real app-data directory**
- **Found during:** Task 2, before running `cargo test -p core --test authoring_tracer`
- **Issue:** `advance_stage` now calls `write_authoring_stage` as part of its own transaction, which resolves `runtime_dir()` and writes a real file. Three tests in `authoring_tracer.rs` (carried over from plan 05-02) call `advance_stage` without ever setting `FLYWHEEL_RUNTIME_DIR` — after this plan's change, running the full test suite would have started writing real files into the developer's actual application-data directory on every `cargo test`.
- **Fix:** Wrapped all three tests in the same scratch-`FLYWHEEL_RUNTIME_DIR` env-lock helper `runtime_protocol.rs`/`launch_reconciliation.rs` already established.
- **Files modified:** `packages/core/tests/authoring_tracer.rs`
- **Verification:** `cargo test -p core --test authoring_tracer` (6/6 pass); confirmed no `~/Library/Application Support/Flywheel` (or platform equivalent) writes occur during the suite.
- **Committed in:** `1624378` (Task 2's own commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 1 — bugs directly caused by this plan's own changes, 1 Rule 3 — a blocking test-hygiene issue this plan's own change introduced). **Impact:** All three are necessary consequences of the plan's own file-level changes, not scope creep — none touch product behaviour beyond what the plan specifies.

## Issues Encountered

**The plan's own Task 3 `<verify>` hex-literal gate cannot pass as literally written.** `test "$(grep -cE '#[0-9a-fA-F]{3,8}' <file1> <file2>)" = "0"` compares against the literal string `"0"`, but `grep -c` over TWO files prints one `file:count` line PER FILE (never a single combined total) — so this comparison can never succeed regardless of content, a shell-scripting bug in the plan's own command, not a code defect. Checked per-file instead: both files report `0` individually, confirming the underlying invariant (no hex literal introduced) genuinely holds. Recorded in `.planning/WINDOWS.md` (entry #15, `deviation`).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The stage gate, the human-only transition, and the on-screen indicator are all proven end-to-end and committed; plans 05-04/05-05 (decompose/criteria, amend/delete, and the remaining verbs/target types) build on a genuinely enforced stage machine rather than a prompt-only one.
- `.planning/WINDOWS.md` carries two open, related deferrals into end-of-phase UAT: entry #13 (plan 05-02's product kill criterion) and entry #14 (this plan's own values prohibition — whether the challenge stage's live conversational behaviour is genuinely challenging, not agreeable validation). Both need a real human-paced session to judge and should be evaluated together.
- `SHAPE-01` is this plan's own declared requirement; it was already marked complete by plans 05-01/05-02 per the shared-ID gate's resolution — no new state transition needed here beyond re-confirming it.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All 4 created files found on disk.
- All 3 task commit hashes (`7ea7b82`, `1624378`, `d75041a`) found in git history.
- `cargo test -p core --test authoring_stage` (9/9), `cargo test -p core --test runtime_protocol` (25/25 including the 5 new authoring-stage tests), `cargo test -p core -p desktop` (all green, 0 failed) all pass.
- `npm --prefix packages/sidecar run build` and `npm --prefix packages/sidecar test` (124/124, including `authoring-stage-gate.test.mjs` 11/11) pass.
- `npm --prefix packages/desktop run build` and `npm --prefix packages/desktop run test` (485/485, including `authoring-stage.test.tsx` 15/15 and the updated `legend.test.tsx` 12/12) pass.
- Named grep gates: exactly one `matcher: "Bash"` in `claude-code-adapter.ts` (comment-stripped); zero payload-run-id reads in `stage-gate-hook.ts`; zero `advance_stage`/`return_to_stage`/`authoring_stage_advance` references under `packages/sidecar/src`; exactly 2 registrations of the new commands in `main.rs`; exactly 4 `--*-text-rack:` roles in `tokens.css` (no new token) — all return their expected values.
