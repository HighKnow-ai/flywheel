---
phase: 05-socratic-epic-authoring
plan: 49
subsystem: authoring
tags: [uat-harness, mcp-server, held-request, proposalId, gap-closure, D-80, D-81, D-87, D-92, G-05-10]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-48)
    provides: the propose_/amend_/delete_ staging tool result resolving with
      {staged, proposalId} — the core-minted id this plan's harness now applies and relays
      in-turn, and the fixture key this plan's fixture rewrite matches
  - phase: 05-socratic-epic-authoring (plan 05-18)
    provides: drainInboundCoreRequests/HELD_INBOUND_REQUEST_TYPES/assertAllHeldRequestsAnswered
      (sidecar-harness.mjs) — the held-request registry this plan extends with a third kind
provides:
  - createProposalStagedHandler — the harness's held-request handler for proposal_created,
    applying the event to the database DURING the agent's own tool call and relaying the
    bridge's proposalId (or a named error) back as an authoring_proposal_answer op.
    Registered at both live drainInboundCoreRequests call sites.
  - HELD_INBOUND_REQUEST_TYPES (scripts/uat/lib/sidecar-harness.mjs) extended with
    proposal_created as a third held kind, closing a pre-existing red self-test.
  - stagedToolResultText(proposalId) — the one place the fixture builds a scripted staging
    tool_result body, matching the real stageAuthoringProposal contract; a --self-test check
    drives the real MCP server over a live socket and asserts the key sets agree.
  - assertProposalListNonEmptyInTurn(turn) — a pure, four-verdict (violated/satisfied/
    not-applicable/unknown) live-path assertion wired as a fail-closed gating check on the
    SHAPE-03/SHAPE-04 criterion, rendered in the evidence sheet.
affects: [any future phase-5 round exercising proposal_created, the criteria-stage evidence
  sheet's own rendered shape, any future third held-request kind added to
  packages/sidecar/src/index.ts]

# Actuals (#2632)
actuals:
  tokens: 11217
  tasks: 3
  commits: 3
plan_head_before: d626f9a2422a61a38a5c8d6bd8f4c11f5e3fef94

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A harness handler for a held sidecar event mirrors the shape of its sibling exactly
       (createProposalStagedHandler built to createBoardReadHandler's own four-key options
       object) — a try/catch converting a thrown bridge failure into a relayed {error} so
       the held call is never left hanging, never rethrown."
    - "A fixture's scripted tool-result body is built from ONE function
       (stagedToolResultText), never hand-written per call site, with a --self-test check
       driving the real product code over a live socket to assert the two shapes agree —
       the structural guard against fixture/product divergence, not just a snapshot pin."
    - "A live-path assertion returns one of a small, explicitly-named set of string verdicts
       (never a boolean), gated into a pass/fail criterion through a fail-closed ALLOW-list
       (PASSING_PROPOSAL_LIST_VERDICTS) — an unrecognised or absent verdict never passes by
       accident, mirroring PASSING_NO_WORK_READINGS' own established discipline in this file."

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/lib/sidecar-harness.mjs

key-decisions:
  - "HELD_INBOUND_REQUEST_TYPES (scripts/uat/lib/sidecar-harness.mjs) gained proposal_created
    as a third held kind, even though the plan's own files_modified frontmatter names only
    uat-08-socratic-authoring.mjs and fake-authoring-claude.mjs. Without this, drainInboundCoreRequests's
    own type filter would have silently discarded every proposal_created event before it ever
    reached createProposalStagedHandler's registration in the handlers map, making Task 1's
    entire mechanism unreachable dead code. Confirmed necessary, not speculative: this file's
    own pre-existing self-test ('every kind the sidecar can hold open has an answering
    handler') was already comparing HELD_INBOUND_REQUEST_TYPES.length (2) against
    packages/sidecar/src/index.ts's real answering-op count (3, since plan 05-48 already
    added the authoring_proposal_answer case) and was already red before this fix."
  - "The requestId de-duplication set (proposalStagedAppliedRequestIds) is module-level
    rather than threaded through createProposalStagedHandler's own parameter list, to keep
    the handler's signature the exact four-key shape (opsBin, appDataDir, sidecar, runId)
    the plan specifies, matching createBoardReadHandler's own shape. This is safe because
    the script drives exactly one authoring session per process."
  - "assertProposalListNonEmptyInTurn operates on a plain array of one turn's own raw
    tool_call/tool_result events (a slice of sidecar.events), not on accumulateTurn's
    returned object — accumulateTurn's toolCalls array carries tool_call events only, with
    no attached tool_result, so it cannot express the propose-then-list correlation this
    assertion needs. This kept the change scoped to uat-08-socratic-authoring.mjs alone,
    with no change to sidecar-harness.mjs's shared accumulateTurn."
  - "check() in --self-test is now async-tolerant (awaits fn()'s return value only if it is
    a thenable) rather than adding a parallel async-check helper. Every pre-existing
    synchronous check call site is unaffected (no await point is ever reached for a
    non-Promise return), and the new handler-driving checks explicitly await check(...)."
  - "Turn 4 of the drafts-criteria-after-second-advance fixture scenario was reordered:
    propose_criterion (parenting directly to the id turn 3's own staging result returned)
    now runs BEFORE the turn's one proposal_list call, rather than requiring a proposal_list
    round trip before staging. This models the FIXED contract (in-turn apply means no round
    trip is needed) while still keeping exactly one proposal_list call in the turn, whose
    non-empty result is what Task 3's assertion needs to exercise the 'satisfied' verdict."

requirements-completed: [SHAPE-02, SHAPE-03]

coverage:
  - id: D1
    description: "A proposal_created event is applied to the database DURING the agent's held
      tool call (never after the turn returns), and the bridge's core-minted proposalId is
      relayed back via createProposalStagedHandler, registered at both live
      drainInboundCoreRequests call sites."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#createProposalStagedHandler relays the bridge's proposalId into the authoring_proposal_answer op"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#a proposal_created event is applied exactly once when both the held handler and the sweep see it"
        status: pass
      - kind: other
        ref: "grep-verified: proposal_created: createProposalStagedHandler registered at exactly 2 live drainInboundCoreRequests call sites"
        status: pass
    human_judgment: false
  - id: D2
    description: "HELD_INBOUND_REQUEST_TYPES (scripts/uat/lib/sidecar-harness.mjs) is extended
      with proposal_created as a third held kind, without which the new handler would never
      be reached by drainInboundCoreRequests's own type filter."
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#every kind the sidecar can hold open has an answering handler"
        status: pass
    human_judgment: false
  - id: D3
    description: "The fixture's scripted staging tool_result bodies are all built from
      stagedToolResultText, matching the real stageAuthoringProposal contract's proposalId
      key; the criteria scenario's turn 4 parents its criterion directly from turn 3's own
      staging result instead of round-tripping through proposal_list."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#the fixture's staged tool-result body matches the shape the real MCP server produces"
        status: pass
      - kind: integration
        ref: "uat-08-socratic-authoring.mjs --replay-check (scenario=drafts-criteria-after-second-advance)"
        status: pass
    human_judgment: false
  - id: D4
    description: "assertProposalListNonEmptyInTurn is a named, gating live-path assertion:
      proposal_list returning empty inside the same turn as a successful staging call fails
      the run, through a fail-closed allow-list on the SHAPE-03/SHAPE-04 criterion, rendered
      in the evidence sheet beside criteriaReachabilityReading."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#an empty proposal_list inside a staging turn fails the live assertion"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#a proposal_list with rows after a staging call satisfies the assertion"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#a turn with no staging call is not-applicable"
        status: pass
      - kind: unit
        ref: "uat-08-socratic-authoring.mjs --self-test#an unrecognised proposal_list verdict is fail-closed — only satisfied/not-applicable pass"
        status: pass
    human_judgment: false

# Metrics
duration: ~80min
completed: 2026-09-29
status: complete
---

# Phase 5 Plan 49: A staged proposal is applied and answered in-turn, and the fixture stops inventing its own contract

**`createProposalStagedHandler` applies and answers a `proposal_created` event while the agent's own tool call is still held open, the fixture derives every scripted staging result from the real `{staged, proposalId}` shape instead of a hand-written `id`, and `assertProposalListNonEmptyInTurn` fails the run outright when `proposal_list` comes back empty inside a staging turn.**

## Performance

- **Duration:** ~80 min
- **Tasks:** 3 completed
- **Files modified:** 3

## Accomplishments

- `createProposalStagedHandler` (mirroring `createBoardReadHandler` exactly) applies one
  `proposal_created` event to the database DURING the held tool call via the
  `apply-proposal-created` bridge, then relays the bridge's `proposalId` — or a named error
  for `ignored`/`unknown_run`/`terminal_run` — back as an `authoring_proposal_answer` op.
  Registered at both live `drainInboundCoreRequests` call sites.
- `drainProposalsUntilQuiet` no longer claims the id-reachability property: its doc comment
  now states plainly it is a post-turn sweep for events with no held caller, and its scan
  skips any `requestId` `createProposalStagedHandler` already applied (via the shared
  `proposalStagedAppliedRequestIds` set) — one event is never applied twice.
- **Deviation (Rule 3):** `HELD_INBOUND_REQUEST_TYPES` in `scripts/uat/lib/sidecar-harness.mjs`
  gained `proposal_created` as a third held kind — without it, `drainInboundCoreRequests`'s own
  type filter would have discarded every `proposal_created` event before the new handler's
  registration in `handlers` could ever see it. This file's own pre-existing self-test
  ("every kind the sidecar can hold open has an answering handler") was already comparing the
  registry's length (2) against the sidecar's real answering-op count (3) and was already red.
- `stagedToolResultText(proposalId)` is the one place `fake-authoring-claude.mjs` builds a
  scripted staging tool-result body, replacing three hand-written `{staged: true, id: ...}`
  bodies with the real `{staged: true, proposalId}` shape. A new `--self-test` check drives
  the real `stageAuthoringProposal` over a live socket and asserts the two bodies' key sets
  agree — the structural guard against a future re-divergence.
- Turn 4 of the `drafts-criteria-after-second-advance` scenario now parents its criterion
  directly to the id turn 3's own staging result returned, with one `proposal_list` call
  still in the turn (after staging, review-only) whose scripted result is non-empty.
- `assertProposalListNonEmptyInTurn` returns one of four named verdicts (`violated`,
  `satisfied`, `not-applicable`, `unknown`) from a pure scan of one turn's own
  `tool_call`/`tool_result` events, correlated by the wire's own `toolUseId`. Wired into the
  live body as a fail-closed gating flag on the SHAPE-03/SHAPE-04 criterion
  (`PASSING_PROPOSAL_LIST_VERDICTS`: only `satisfied`/`not-applicable` pass) and rendered in
  the evidence sheet beside `criteriaReachabilityReading`.

## Task Commits

1. **Task 1: Apply and answer a staged proposal in-turn** - `3d3895f` (feat)
2. **Task 2: The fixture derives its tool results from the real contract** - `cb6a671` (fix)
3. **Task 3: Fail when `proposal_list` is empty inside a staging turn** - `d0f395a` (feat)

_Note: all three tasks touch `scripts/uat/uat-08-socratic-authoring.mjs`. Each task's own
self-tests and full-suite runs (`--self-test`, `--replay-check`, `--board-read-check`) were
verified green against that task's own incremental state — Task 1's commit alone, then Task
1+2, then Task 1+2+3 — before each commit, so the atomic-commit boundaries are real, not
retrofitted labels on one combined diff._

## Files Created/Modified

- `scripts/uat/uat-08-socratic-authoring.mjs` - `createProposalStagedHandler`,
  `PROPOSAL_STAGED_RELAY_OP`, `PROPOSAL_OUTCOME_ERROR_TEXT`, `proposalStagedAppliedRequestIds`,
  the two `drainInboundCoreRequests` registrations, `drainProposalsUntilQuiet`'s updated doc
  comment and dedup skip, `assertProposalListNonEmptyInTurn`,
  `STAGING_VERB_TOOL_NAME_FRAGMENTS`, `PASSING_PROPOSAL_LIST_VERDICTS`, the live-body
  `proposalListVerdict` computation and evidence-sheet wiring, and 7 new `--self-test` checks.
- `scripts/uat/lib/fake-authoring-claude.mjs` - `stagedToolResultText`, the three staging
  `tool_result` call sites converted to it, and the criteria scenario's turn 4 rewrite.
- `scripts/uat/lib/sidecar-harness.mjs` - `HELD_INBOUND_REQUEST_TYPES` extended with
  `proposal_created` (deviation, see Deviations below).

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `HELD_INBOUND_REQUEST_TYPES` needed a third entry for the new handler to ever be reachable**
- **Found during:** Task 1
- **Issue:** `drainInboundCoreRequests` (scripts/uat/lib/sidecar-harness.mjs) filters incoming
  events by `HELD_INBOUND_REQUEST_TYPES.includes(e.type)` BEFORE ever consulting its
  `handlers` map. That array still listed only `["permission_request", "board_read_request"]`,
  so registering `proposal_created: createProposalStagedHandler(...)` in the `handlers` map
  (exactly as the plan's action specifies) would have been unreachable dead code — the drain
  loop's own `waitForEvent` predicate would never match a `proposal_created` event at all.
- **Fix:** Added `"proposal_created"` as a third entry to `HELD_INBOUND_REQUEST_TYPES`, updated
  its doc comment and the drain loop's diagnostic label to name the third kind.
- **Files modified:** `scripts/uat/lib/sidecar-harness.mjs` (not in the plan's own
  `files_modified` frontmatter)
- **Verification:** This file's own pre-existing self-test, "every kind the sidecar can hold
  open has an answering handler" (compares `HELD_INBOUND_REQUEST_TYPES.length` against a grep
  count of `_answer` op cases in `packages/sidecar/src/index.ts`), was RED before this fix
  (2 vs 3, since plan 05-48 had already added the third answering op case) and is GREEN after.
- **Committed in:** `3d3895f` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking).
**Impact on plan:** Necessary for the plan's own Task 1 mechanism to function at all — without
it, every `proposal_created` event would remain invisible to the harness exactly as before this
plan, and the plan's own acceptance criteria ("both live `drainInboundCoreRequests` call sites
register a `proposal_created` handler") would be technically true while the handler never once
fires. No scope creep — the fix is a single array literal plus doc-comment accuracy.

## Issues Encountered

None. All three tasks' `<verify>` blocks passed; `cargo test --workspace` and
`npm --prefix packages/sidecar test` (198/198) were confirmed green before any task commit,
matching the plan's own verification block's claim that no Rust or sidecar source changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The structural gap `G-05-10` this plan and 05-48 together close (fixture/product
  divergence on the staging result shape, and the in-turn apply the live transcript's turn 6
  needed) is now closed on both the product side (05-48) and the harness side (this plan).
- The next live run of `uat-08-socratic-authoring.mjs` (no `--replay-check`/`--self-test`/
  `--board-read-check` flag) is the first opportunity to observe whether the real, un-scripted
  agent still reaches for `proposal_list` before `propose_criterion` now that the parent id is
  available directly from the staging result — `assertProposalListNonEmptyInTurn` will report
  a named verdict either way, rather than the silent emptiness the live transcript showed.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-29*

## Self-Check: PASSED

All 3 key files verified present on disk (`[ -f ]`); all 3 commits (`3d3895f`, `cb6a671`,
`d0f395a`) verified present in `git log --oneline --all`. All task-level `<acceptance_criteria>`
and the plan-level `<verification>` block were re-run and passed immediately before the final
commit boundary they belong to: `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`
(170/170, all 7 new check names present, 0 `[self-test] FAIL` lines); `--replay-check` (16/16
scenarios `✅ PASS`, including the rewritten `drafts-criteria-after-second-advance`);
`--board-read-check` (`✅ PASS`); the three grep-based per-task verify commands (handler
registered at exactly 2 call sites, `stagedToolResultText(` at 4+ sites,
`assertProposalListNonEmptyInTurn` at 3+ sites); `cargo test --workspace` (0 failed across
every crate); `npm --prefix packages/sidecar test` (198/198) — confirming the plan's own claim
that this plan changes no Rust and no sidecar source.
