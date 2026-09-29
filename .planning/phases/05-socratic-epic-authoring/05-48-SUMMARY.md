---
phase: 05-socratic-epic-authoring
plan: 48
subsystem: authoring
tags: [mcp-server, ipc, held-request, proposalId, gap-closure, D-80, D-81, D-92]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-05)
    provides: the propose_/amend_/delete_ write-tool family and D-87's held board_read round trip
      this plan's requestId/pending-socket shape is modelled on
  - phase: 05-socratic-epic-authoring (plan 05-44)
    provides: proposal_list, the interim (now-superseded) way an agent could look up a staged id
provides:
  - A propose_task/propose_epic/propose_criterion/propose_assumption/amend_proposal/delete_proposal
    tool result that resolves with `{staged: true, proposalId: "<26-char ULID>"}` — the core-minted
    row id, reachable within the same agent turn with no second tool call.
  - A held request/answer round trip (mint requestId, hold the socket, answer via
    answerProposalStaged/resolveProposalStaged/authoring_proposal_answer/
    relay_authoring_proposal_answer) mirroring D-87's board_read path exactly.
  - handle_inbound_proposal_created relaying exactly one answer on every ProposalOutcome variant,
    a poisoned db lock, and an apply_proposal_created error — never leaving a staging call hanging.
  - proposeCriterionToolDefinition and proposalListToolDefinition's descriptions updated to name
    the staging result's own proposalId as the parent-id source, not proposal_list.
affects: [05-49 (fixes fake-authoring-claude.mjs's own hand-written id fixture to match this real
  contract), any future phase-5 round exercising propose_criterion or the staging tool result shape]

# Actuals (#2632)
actuals:
  tokens: 9014
  tasks: 3
  commits: 3
plan_head_before: aebce74203fb1438829af68b7e695c13be2c3bdf

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A staging tool call is a HELD request/answer round trip (mint requestId, pending.set,
       answer via a dedicated answer* method), never a fire-and-forget receipt — the same shape
       every read tool in this file already uses, now shared by every write tool too."
    - "A proposal id is minted in exactly one place (Rust core's new_id() inside
       create_proposal_in_tx) and crosses back to the waiting tool call through one relay function
       per layer — the sidecar and the model never mint or fabricate identity."

key-files:
  created:
    - packages/sidecar/test/authoring-staging-id.test.mjs
  modified:
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/index.ts
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/sidecar.rs

key-decisions:
  - "The proposal id stays core-minted (new_id() in create_proposal_in_tx) — the sidecar-minted
    alternative was considered and rejected because it would hand back an id for a row that might
    never exist (terminal run, unknown run, failed validation), reintroducing the exact defect
    class this plan closes. Rated `costly`, not `one-way`; no checkpoint:decision inserted."
  - "packages/core/src/domain/authoring_proposal.rs is untouched — the core already minted and
    returned the id; the defect was the transport never carrying it back, not the domain logic."

requirements-completed: [SHAPE-03, SHAPE-04]

coverage:
  - id: D1
    description: "A propose_epic call staged over a real unix socket resolves with the
      core-minted proposalId in the same tool call — no second round trip."
    requirement: SHAPE-03
    verification:
      - kind: integration
        ref: "packages/sidecar/test/authoring-staging-id.test.mjs#a staged proposal's core-minted id comes back in the propose_epic tool result"
        status: pass
    human_judgment: false
  - id: D2
    description: "No host-side failure path (refused write, poisoned lock, malformed event,
      missing run, terminal run) leaves a staging call hanging — every path relays exactly one
      answer, or is one of the two named unreachable-to-answer paths (missing AppState/sidecar)."
    requirement: SHAPE-03
    verification:
      - kind: integration
        ref: "packages/sidecar/test/authoring-staging-id.test.mjs#a staging call whose host refuses the write is released with an error, never left hanging"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/authoring-staging-id.test.mjs#a staging answer carrying no proposalId is rejected rather than resolved"
        status: pass
      - kind: unit
        ref: "grep-verified: handle_inbound_proposal_created contains no unwrap()/expect()"
        status: pass
    human_judgment: false
  - id: D3
    description: "All six staging verbs (propose_task/epic/criterion/assumption,
      amend_proposal, delete_proposal) resolve with a 26-character proposalId; two
      byte-identical propose_task calls stage two distinct proposalId values (SHAPE-03
      adjacency); an empty/whitespace title is rejected before any socket write (SHAPE-03
      empty edge)."
    requirement: SHAPE-04
    verification:
      - kind: integration
        ref: "packages/sidecar/test/authoring-staging-id.test.mjs#every one of the six staging tools resolves with a 26-character proposalId"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/authoring-staging-id.test.mjs#two byte-identical propose_task calls resolve with two different proposalId values"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/authoring-staging-id.test.mjs#a propose_task with an empty title is rejected before any socket write"
        status: pass
    human_judgment: false
  - id: D4
    description: "propose_criterion's tool description names the staging result's own
      proposalId as the parent-id source instead of directing the agent to proposal_list;
      proposal_list is reframed as a review aid and stays registered."
    verification:
      - kind: unit
        ref: "grep-verified: proposeCriterionToolDefinition.description names proposalId, not proposal_list, as the source"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-09-29
status: complete
---

# Phase 5 Plan 48: Proposal staging returns the core-minted proposalId in the same tool call

**Every `propose_*`/`amend_*`/`delete_*` staging call is now a held request/answer round trip that resolves with `{staged: true, proposalId: "<26-char ULID>"}` — the row id the Rust core actually wrote — closing the structural gap (G-05-10) that made `propose_criterion`'s required `parent_proposal_id` unreachable.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 completed
- **Files modified:** 6 (plus 1 new test file)

## Accomplishments

- `stageAuthoringProposal` mints its own `requestId`, holds the socket, and resolves only when the
  answer carries a `proposalId` (or rejects with an error) — never a bare `{received: true}`
  receipt. Exported so the regression suite drives it directly.
- The connection handler's `authoring_proposal` branch now holds its socket in `pending` exactly
  like the `board_read` branch beside it, instead of closing immediately with a receipt.
- `answerProposalStaged` (sidecar handle), `resolveProposalStaged` (adapter interface + Claude
  Code implementation), the `authoring_proposal_answer` sidecar op, and
  `SidecarHandle::relay_authoring_proposal_answer` (Rust) carry the answer across the full
  socket → adapter → stdio → Rust core → stdio → adapter → socket round trip.
- `handle_inbound_proposal_created` relays exactly one answer for every `ProposalOutcome` variant
  (`Created`, `Ignored`, `UnknownRun`, `TerminalRun`), a poisoned db mutex, and an
  `apply_proposal_created` error — the two paths that structurally cannot relay (missing
  `AppState`, missing `SidecarHandle`) are the only permitted bare returns, each with an inline
  comment naming why. An inbound event carrying no `requestId` performs the write and the
  `board:changed` emit unchanged and relays nothing — full backward compatibility.
- New `authoring-staging-id.test.mjs` proves the end-to-end round trip, the never-hang guarantee,
  and pins all six staging verbs plus the SHAPE-03 adjacency and empty edges.
- `proposeCriterionToolDefinition`/`proposalListToolDefinition` descriptions now describe the real
  contract: the parent id comes from the staging result itself, not from calling `proposal_list`.

## Task Commits

1. **Task 1: End-to-end "stage an epic and get its id back" — one path, every layer** - `8964e25` (feat)
2. **Task 2: No host failure path may leave a staging call hanging** - `ffa0200` (fix)
3. **Task 3: The regression that pins the id across all six staging verbs** - `3dffa36` (docs)

_Note: Tasks 2 and 3 both touched `authoring-staging-id.test.mjs`; all tests the plan assigns to
Task 2 and Task 3 were written in the Task 1 commit (the file was created once, fully populated,
since all three tasks share the same file) — the test suite's green state at every commit boundary
was verified independently for each task before it was committed._

## Files Created/Modified

- `packages/sidecar/src/mcp-permission-server.ts` - `AuthoringProposalPayload.requestId`,
  tightened `isAuthoringProposalPayload`, held `authoring_proposal` branch, `answerProposalStaged`,
  exported `stageAuthoringProposal` now holding and resolving with `proposalId`, and the two
  updated tool descriptions.
- `packages/sidecar/src/adapter.ts` - `ProposalCreatedEvent.requestId`,
  `AgentAdapter.resolveProposalStaged`.
- `packages/sidecar/src/claude-code-adapter.ts` - `normalizeProposalNotice` carries `requestId`
  through; `ClaudeCodeAdapter.resolveProposalStaged` implementation.
- `packages/sidecar/src/index.ts` - `AuthoringProposalAnswerRequest` interface and the
  `"authoring_proposal_answer"` op case.
- `packages/desktop/src-tauri/src/commands/authoring.rs` - `handle_inbound_proposal_created`
  restructured to read `requestId` first and relay on every reachable outcome.
- `packages/desktop/src-tauri/src/sidecar.rs` - `SidecarHandle::relay_authoring_proposal_answer`.
- `packages/sidecar/test/authoring-staging-id.test.mjs` (new) - the six-test regression suite.

## Decisions Made

- The proposal id stays core-minted (`new_id()` in `create_proposal_in_tx`); the sidecar-minted
  alternative was explicitly rejected (see `key-decisions` above and the plan's own `FINDING A`)
  because it would hand back an id for a row that might not exist.
- `packages/core/src/domain/authoring_proposal.rs` was not touched — confirmed by `git diff` and
  by `cargo test -p core --test authoring_proposal` staying green (42/42) throughout.

## Deviations from Plan

None — plan executed exactly as written. The only implementation-order note (not a deviation from
any Rule 1-4 trigger) is that all six regression tests were written into
`authoring-staging-id.test.mjs` during Task 1 rather than incrementally across all three commits,
since the plan assigns the same single file to every task; each task's own subset of tests was
verified to pass (and, for the manual red-check, to fail) before that task's commit.

## Known Stubs

None.

## Issues Encountered

None. All three tasks' `<verify>` blocks passed on first attempt after fixing two authoring
mistakes caught immediately by the test suite itself: a JSDoc comment containing a literal `*/`
inside prose (fixed before any test ran — a TypeScript parse error, not a logic bug), and a test
call using `statement` instead of `assumption` for `buildProposeAssumptionPayload` (fixed after
the one resulting test failure).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 05-49 can now fix `scripts/uat/lib/fake-authoring-claude.mjs`'s hand-written
  `{staged: true, id: ...}` fixture (Finding B) to match this plan's real
  `{staged: true, proposalId: ...}` contract — the offline/live divergence this plan's
  measurement record identified is now closeable.
- `propose_criterion` is reachable in a single live session: stage a parent
  (`propose_epic`/`propose_task`), read its `proposalId` off the same tool result, and pass it
  straight to `propose_criterion` with no second tool call.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-29*

## Self-Check: PASSED

All 8 key files verified present on disk (`[ -f ]`); all 5 commits (`8964e25`, `ffa0200`,
`3dffa36`, `c7bef01`, `948b2ff`) verified present in `git log --oneline --all`. All task-level
`<acceptance_criteria>` and the plan-level `<verification>` block were re-run and passed
immediately before each commit (`npm --prefix packages/sidecar test`: 198/198;
`cargo build --workspace`: clean; `cargo test --workspace`: exit 0, no `FAILED`;
`cargo test -p core --test authoring_proposal`: 42/42, confirming the core stayed untouched).
