---
phase: 05-socratic-epic-authoring
plan: 02
subsystem: agent-authoring
tags: [rusqlite, sqlite-migration, mcp-tool, claude-code-stream-json, tauri-command, react, zustand, tanstack-query]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-01's measured transport_decision (option-a) and stage-gate mechanism finding, which this plan implements without re-deriving"
provides:
  - "An epic-authoring session as a first-class agent_runs row (D-84's assumption-delta promote): task_id/epic_id nullable, a run_subject accessor as the one read path for a run's subject, agent_runs.authoring_stage carrying D-88's three-stage vocabulary"
  - "authoring_proposals: the D-80/D-81/D-83 staging table, its create_proposal/apply_proposal_created/accept_proposal/pending_proposals_for_run domain write path, materialising exclusively through the canonical domain::task::create_task_in_tx writer"
  - "propose_task: a third role on the existing flywheel-permissions MCP server, a third authoring_proposal message kind over the existing per-run socket, zero new process"
  - "startAuthoringSession: the Option A (--input-format stream-json, one long-lived process) spawn path, sharing the sidecar's existing liveSessions registry with ordinary task-execution runs"
  - "authoring_run_start / authoring_proposals_for_run / authoring_proposal_accept: the desktop command surface, plus ProposalTray.tsx and the Shape an Epic command-palette entry"
affects: [05-03-*, 05-04-*, 05-05-*, phase-05-verification]

actuals:
  tokens: 35650
  tasks: 3
  commits: 3
  plan_head_before: a709eb37173eccf5267ecc8caee66799d5564d7d

tech-stack:
  added: []
  patterns:
    - "Rebuild-then-add-staging-table migration pairing (0010 rebuilds agent_runs/triggers under the CHECK-constrained sequence 0006_recovery_statuses.sql established, 0011 adds a brand-new table with no rebuild needed) — the same two-migration shape a later phase with a second nullable-subject need can reuse"
    - "A third message kind on an existing per-run Unix socket (kind: \"authoring_proposal\", checked before the generic notice branch) — the same D-53/D-64 pattern, now proven a third time; a fourth capability can reuse it without a new socket or process"
    - "startPermissionServer's fourth callback (onProposal) is optional with a default no-op, so every pre-existing call site (production and all prior test suites) kept compiling unchanged — additive capability growth on a shared function signature"

key-files:
  created:
    - packages/core/src/db/migrations/0010_authoring_runs.sql
    - packages/core/src/db/migrations/0011_authoring_staging.sql
    - packages/core/src/domain/authoring_session.rs
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/tests/authoring_tracer.rs
    - packages/sidecar/test/authoring-proposal-wire.test.mjs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src/authoring/ProposalTray.tsx
    - packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/mod.rs
    - packages/core/src/domain/agent_run.rs
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/trigger.rs
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/index.ts
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src/App.tsx
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/board/CommandPalette.tsx
    - packages/desktop/src/board/useBoardQuery.ts
    - packages/desktop/src/session/SessionSurface.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts

key-decisions:
  - "AgentRun.task_id became Option<String>, epic_id and authoring_stage were added, and domain::agent_run::run_subject is the ONE read path for a run's subject — a source-scanning gate in authoring_tracer.rs asserts no file outside agent_run.rs reads the qualified literal agent_runs.task_id"
  - "accept_proposal materialises the create/task path exclusively through a new domain::task::create_task_in_tx (create_task's own statement body, factored out so a caller composing it with another write in the SAME transaction never issues a second INSERT INTO tasks) — a grep gate over authoring_proposal.rs asserts zero canonical INSERT statements"
  - "startPermissionServer's onProposal callback is optional (default no-op) rather than a required fourth positional argument, so the ~15 pre-existing call sites across sidecar tests needed zero changes — an additive capability growth, not a breaking signature change"
  - "buildClaudeArgv and buildAuthoringClaudeArgv share ONE pushPermissionPromptFlags helper for the --permission-prompt-tool/--mcp-config pair — the plan's own acceptance criterion (a comment-stripped count of exactly 1 for the literal \"mcp-config\" in claude-code-adapter.ts) required this factoring once a second argv-builder needed the same pair"
  - "The shape-epic command's actual logic (startAuthoringSessionForProject) lives in board/useBoardQuery.ts beside openLiveSessionForTask, called directly from CommandPalette.tsx's own switch case — mirrors create-issue's own direct-run() pattern rather than routing through dispatchAction's synthetic-keydown indirection, which only works for global-region bindings that carry a real key (shape-epic is palette-only, no key binding yet)"
  - "ProposalTray mounts inside SessionSurface.tsx gated on a new authoringStage prop, threaded from a new activeAgentRunAuthoringStage field in state/uiStore.ts (the third argument to setActiveAgentRunId, defaulting to null so every pre-existing 1-2-argument call site kept working unchanged)"

patterns-established:
  - "Domain functions that must compose inside a caller's own transaction are split into a public conn-opening wrapper plus a private/pub(crate) _in_tx sibling taking &Transaction — create_task_in_tx following close_agent_run_in_tx's and insert_summary_row's own precedent exactly"

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-04]

coverage:
  - id: D1
    description: "An authoring session is a first-class agent_runs row with no task and no worktree, carrying D-88's authoring_stage, and domain::agent_run::run_subject is the sole read path for what a run is about"
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_tracer.rs#a_proposed_task_becomes_a_real_task_end_to_end"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_tracer.rs#agent_runs_check_rejects_a_row_carrying_both_task_id_and_epic_id"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_tracer.rs#no_call_site_outside_agent_run_module_reads_agent_runs_task_id_as_a_qualified_literal"
        status: pass
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false
  - id: D2
    description: "A staged proposal (authoring_proposals) is durable board state that outlives the session and touches no canonical table until a human accepts it"
    requirement: SHAPE-02
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_tracer.rs#a_proposed_task_becomes_a_real_task_end_to_end"
        status: pass
      - kind: other
        ref: "grep gate: zero occurrences of INSERT INTO (tasks|epics|acceptance_criteria) in authoring_proposal.rs"
        status: pass
    human_judgment: false
  - id: D3
    description: "propose_task is a third role on the existing flywheel-permissions MCP server (zero new socket/process), identity resolved from the socket never the tool call's own arguments"
    requirement: SHAPE-02
    verification:
      - kind: unit
        ref: "packages/sidecar/test/authoring-proposal-wire.test.mjs (5 tests)"
        status: pass
      - kind: other
        ref: "grep gate: comment-stripped mcp-config count in claude-code-adapter.ts is exactly 1"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/sidecar test (113/113)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The desktop command surface (authoring_run_start/authoring_proposals_for_run/authoring_proposal_accept), the proposal tray, and the Shape an Epic command-palette entry are wired end-to-end"
    requirement: SHAPE-04
    verification:
      - kind: unit
        ref: "packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx (6 tests)"
        status: pass
      - kind: integration
        ref: "npm --prefix packages/desktop run test (469/469)"
        status: pass
      - kind: integration
        ref: "cargo build --workspace / npm --prefix packages/desktop run build"
        status: pass
    human_judgment: false
  - id: D5
    description: "Product kill criterion: one real timed in-app shaping run judged against the terminal comparison arm (05-SPIKE-FINDINGS.md)"
    verification: []
    human_judgment: true
    rationale: "Requires a live, human-paced Socratic conversation with the real claude binary and a human's own judgement of the resulting criteria quality — not something an autonomous executor can perform or fabricate. Deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase (WINDOWS.md entry #13, unrun-verify)."

duration: ~130min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 02: Tracer — a Proposed Task Becomes a Real Task Summary

**The phase's tracer, proven end-to-end: an epic-authoring session is a real, supervised `agent_runs` row with no task and no worktree; the agent stages exactly one proposal through a third role on the existing MCP permission server; the proposal lands as a durable, untouchable-until-decided `authoring_proposals` row; and one Accept click in a new `ProposalTray` materialises it as a real `backlog` task through the same canonical writer every other task-creation path uses.**

## Performance

- **Duration:** ~130 min
- **Completed:** 2026-09-23
- **Tasks:** 3
- **Files created:** 9
- **Files modified:** 19

## Accomplishments

- **Task 1 — the core tracer.** Migrations `0010_authoring_runs.sql` (the CHECK-constrained rebuild of `agent_runs`/`triggers`, following `0006_recovery_statuses.sql`'s exact four-step sequence) and `0011_authoring_staging.sql` (the brand-new `authoring_proposals` table, no rebuild needed) land D-80/D-81/D-83/D-84's shape. `domain::authoring_session` carries D-88's three-stage vocabulary and `start_authoring_run`/`advance_stage` (the latter human-actor-only, with no agent-reachable caller anywhere in this workspace). `domain::authoring_proposal` carries the staging write path — `create_proposal`, `apply_proposal_created` (the inbound-event applier mirroring `session_summary::apply_summary_reported`'s guard sequence), `accept_proposal` (materialising the `create`/`task` path exclusively through a newly-factored `domain::task::create_task_in_tx`), and a bounded `pending_proposals_for_run`. The assumption-delta promote (`AgentRun.task_id: Option<String>`, a new `epic_id`, and `run_subject`/`RunSubject` as the one accessor) turned out to touch only `domain/agent_run.rs` itself at the type-checker level — every other reader of an `agent_runs` row does so through a task-id-scoped query that stays correct regardless of the column's nullability. `authoring_tracer.rs` proves the full path (start → advance to `decompose` → stage a proposal → assert zero canonical rows → accept → assert exactly one `backlog` task with a real key) plus both companion invariants named in the plan's assumption-delta decision.
- **Task 2 — the agent reaches the write surface.** `propose_task` is a third role on the existing `flywheel-permissions` MCP server (D-64's precedent applied a second time): a `propose_` prefix convention documented as load-bearing for plan 05-03's stage-gate matcher, an `AuthoringProposalPayload` carrying `kind: "authoring_proposal"` as a third message kind on the same per-run socket, and `buildProposeTaskPayload` extracted as a pure, unit-testable validator (empty title rejected before any socket write). `startAuthoringSession` implements `05-SPIKE-FINDINGS.md`'s measured `transport_decision: option-a` shape verbatim (`-p --input-format stream-json --output-format stream-json --verbose`, the opening turn written to the child's own stdin, stdin left open) and joins the SAME `liveSessions` registry `startSession` uses, so `interruptSession`/`killSession`/`resolvePermission` need no changes to work identically for an authoring run.
- **Task 3 — the board.** `authoring_run_start` mirrors `agent_run_start`'s own credential-before-row-creation ordering (D-39), fixes the permission mode to D-86's read-only posture, and sends an `authoring_spawn` request carrying the project's registered `repo_path` as `cwd` — never a worktree path. `ProposalTray.tsx` mounts beside the session feed only when the run carries an `authoringStage`, rendering one row per pending proposal with its title and target type, guarded against double-accept by the codebase's own sixth sibling of the `ackActingRef`/`answeringRef` synchronous-ref pattern, and rendering no project-key-shaped text on a pending row (D-96: the key is allocated only at acceptance). The `Shape an Epic` command-palette entry starts the run and opens the session surface on the returned id.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end "a proposed task becomes a real task" — one path, at the core** — `7b7d032` (feat)
2. **Task 2: The same path reaches the agent — one write tool on the existing MCP server** — `734f375` (feat)
3. **Task 3: The same path reaches the screen — start a session, watch the proposal arrive, accept it** — `67f8d69` (feat)

## Files Created/Modified

- `packages/core/src/db/migrations/0010_authoring_runs.sql` — the `agent_runs`/`triggers` CHECK-constrained rebuild (nullable `task_id`, new `epic_id`/`authoring_stage`/`target_epic_id`)
- `packages/core/src/db/migrations/0011_authoring_staging.sql` — the `authoring_proposals` staging table
- `packages/core/src/domain/authoring_session.rs` — `AuthoringStage`, `start_authoring_run`, `current_stage`, `advance_stage`
- `packages/core/src/domain/authoring_proposal.rs` — `ProposalPayload`, `create_proposal`, `apply_proposal_created`, `accept_proposal`, `pending_proposals_for_run`
- `packages/core/src/domain/agent_run.rs` — `AgentRun.task_id: Option<String>`, `epic_id`, `authoring_stage`, `RunSubject`/`run_subject`
- `packages/core/src/domain/task.rs` — `create_task_in_tx` factored out of `create_task`
- `packages/core/src/domain/trigger.rs` — `create_user_action_trigger_for_epic`
- `packages/core/tests/authoring_tracer.rs` — the tracer's own end-to-end proof plus both assumption-delta invariants
- `packages/sidecar/src/mcp-permission-server.ts` — `propose_task` tool, `AuthoringProposalPayload`, `onProposal` callback
- `packages/sidecar/src/adapter.ts` — `ProposalCreatedEvent`, `StartAuthoringSessionOptions`, `supportsAuthoring`
- `packages/sidecar/src/claude-code-adapter.ts` — `buildAuthoringClaudeArgv`, `normalizeProposalNotice`, `startAuthoringSession`, `pushPermissionPromptFlags`
- `packages/sidecar/src/index.ts` — `authoring_spawn` op
- `packages/sidecar/test/authoring-proposal-wire.test.mjs` — the wire-shape proof
- `packages/desktop/src-tauri/src/commands/authoring.rs` — the three Tauri commands and `handle_inbound_proposal_created`
- `packages/desktop/src-tauri/src/sidecar.rs` — the `proposal_created` reader-loop branch
- `packages/desktop/src/authoring/ProposalTray.tsx` — the tray
- `packages/desktop/src/authoring/__tests__/proposal-tray.test.tsx` — the tray's own proof
- `packages/desktop/src/session/SessionSurface.tsx` — the `authoringStage` prop and the tray mount
- `packages/desktop/src/state/uiStore.ts` — `activeAgentRunAuthoringStage`
- `packages/desktop/src/board/useBoardQuery.ts` — `useAuthoringProposals`, `startAuthoringSessionForProject`
- `packages/desktop/src/board/CommandPalette.tsx` — the `shape-epic` case
- `packages/desktop/src/state/keyboard.ts` — the `shape-epic` `ActionId`
- `packages/desktop/src/adapters/tauri.ts` — `startAuthoringRun`, `authoringProposalsForRun`, `acceptAuthoringProposal`

## Decisions Made

See `key-decisions` in frontmatter — all five are load-bearing choices made while implementing the plan's own action items, not deviations from it.

## Deviations from Plan

None — plan executed exactly as written. Two implementation refinements were made strictly to satisfy the plan's own machine-checked acceptance criteria (documented as key-decisions, not deviations, since neither changed behaviour outside what the plan specified):

- `startPermissionServer`'s new `onProposal` parameter made optional (default no-op) rather than required, so the plan's own precedent ("mirrors `onSummary`") could be satisfied without touching roughly a dozen pre-existing test call sites.
- `pushPermissionPromptFlags` factored out of `buildClaudeArgv`/`buildAuthoringClaudeArgv` so the plan's own literal acceptance criterion (comment-stripped `mcp-config` count of exactly 1) held once a second argv-builder needed the identical flag pair.

## Issues Encountered

None. One transient sidecar test failure (an unrelated real-`claude`-binary latency test) self-resolved on immediate re-run and was confirmed not to reproduce, matching this phase's own documented pattern for live-session flakiness (WINDOWS.md entries #8-#12).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The tracer is proven end-to-end and committed; plans 05-03 (the stage gate), 05-04 and 05-05 (decompose/criteria, amend/delete, and the remaining verbs/target types) expand off this proven path rather than exploring.
- `accept_proposal`'s non-`create`/`task` branches return a typed "not yet implemented in this plan" error, exactly as the plan specifies — plan 05-05 is where those verbs/target types materialise.
- The product kill criterion (`05-SPIKE-FINDINGS.md`'s timed comparison against a terminal-plus-quick-add run) is NOT yet judged — it requires a live human-paced conversation this autonomous executor cannot perform. Recorded in `.planning/WINDOWS.md` (entry #13, `unrun-verify`) for the end-of-phase UAT consolidation `workflow.human_verify_mode=end-of-phase` already routes toward.
- `SHAPE-01`/`SHAPE-02`/`SHAPE-04` remain reported per the shared-ID gate's own resolution — this plan's own three requirement IDs are marked complete below; SHAPE-03/SHAPE-05 are later plans' concern.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All 9 created files found on disk.
- All 3 task commit hashes (`7b7d032`, `734f375`, `67f8d69`) found in git history.
- `cargo test --workspace` exit 0 (0 failures across every crate, including `authoring_tracer` 6/6 and `migration_safety` 5/5).
- `npm --prefix packages/sidecar test` 113/113 pass (including `authoring-proposal-wire.test.mjs` 5/5).
- `npm --prefix packages/desktop run test` 469/469 pass (including `proposal-tray.test.tsx` 6/6).
- `cargo build --workspace` and `npm --prefix packages/desktop run build` both succeed with zero new warnings.
- All named grep gates (migration registration count, no canonical INSERT in the staging module, no identity property on any tool schema, exactly one `mcp-config` occurrence, no hex literal in `ProposalTray.tsx`, three commands in `main.rs`, `proposal_created` after `session_closed` in file order) return their expected values.
