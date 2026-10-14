---
phase: 04-clear-is-free
plan: 03
subsystem: agent-adapter
tags: [mcp, unix-socket, claude-code-adapter, session-summary, sidecar]

requires:
  - phase: 04-clear-is-free
    provides: "04-01's session_summaries table and SummaryFields/DecisionEntry shape — this
      plan's SummaryReportedEvent mirrors those field names one-for-one so the Rust side
      needs no renaming table"
provides:
  - "report_summary, a second MCP tool on the existing per-run permission server, relayed as a
    second message kind (session_summary) over the existing per-run Unix socket"
  - "SummaryReportedEvent in the sidecar's AgentEvent union and AdapterCapabilities.supportsSummaryReporting"
  - "buildClaudeArgv's --allowedTools pre-approval of the summary tool, so the agent's own closing
    call never waits on a human"
affects: [04-06]

actuals:
  tokens: 8520
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Second message kind on an existing per-run socket, not a second socket or a second
      --mcp-config server entry — the precedent D-53's git-retry notice already set, now applied
      to a second tool call rather than a fire-and-forget notice"
    - "Exact-kind discriminator checked BEFORE a broader existing check (isSummaryPayload's
      kind === 'session_summary' runs before isNoticePayload's 'any string kind') so two message
      kinds sharing one socket can never collide"
    - "Exported tool-definition object (summaryToolDefinition) so a structural test reads the
      SAME object the server registers, never a duplicated literal that could drift"

key-files:
  created:
    - packages/sidecar/test/summary-report.test.mjs
  modified:
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/test/real-claude-argv.test.mjs

key-decisions:
  - "The summary connection is answered with a receipt acknowledgement ({received: true}) and
    closed immediately, never added to the pending held-call map — a summary is not a held call,
    and this keeps a flood of summary calls from exhausting the map the permission gate depends
    on (T-04-10)"
  - "SummaryReportPayload (the wire shape) carries no runId field at all — identity is derived
    from which socket the call arrives on; the sidecar fills runId from the startSession closure
    when it maps the payload to SummaryReportedEvent, never from the model's own tool-call
    arguments (T-04-01)"
  - "The report_summary tool name is pre-approved via --allowedTools inside the SAME
    permissionPromptToolName/mcpConfig branch buildClaudeArgv already had, so the closing call
    never routes through approve_action and stalls on a human (D-46)"

requirements-completed: [CTX-01, CTX-06]

coverage:
  - id: D1
    description: "report_summary is registered as a second tool on the existing MCP server, relayed as a second kind on the existing per-run socket, and its input schema carries no run/task/project/worktree field"
    requirement: CTX-01
    verification:
      - kind: unit
        ref: "test/summary-report.test.mjs#a_session_summary_payload_round-trips_with_a_receipt_ack_and_fires_only_onSummary"
        status: pass
      - kind: unit
        ref: "test/summary-report.test.mjs#the_summary_tool_schema_carries_no_run/task/project/worktree_property_name,_read_from_the_object_the_server_registers"
        status: pass
    human_judgment: false
  - id: D2
    description: "The approve_action held-request path is behaviourally unchanged by this plan's own change"
    verification:
      - kind: unit
        ref: "test/summary-report.test.mjs#the_held_permission-request_path_is_undisturbed:_nothing_is_written_back_until_resolvePermission_is_called"
        status: pass
      - kind: unit
        ref: "test/permission.test.mjs (all 8 pre-existing permission-flow tests, unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A git_retry notice and a session_summary report never collide on the shared socket"
    verification:
      - kind: unit
        ref: "test/summary-report.test.mjs#a_git_retry_notice_is_still_routed_to_onNotice,_never_onSummary"
        status: pass
    human_judgment: false
  - id: D4
    description: "buildClaudeArgv pre-approves exactly the summary tool via --allowedTools, so the closing report_summary call never waits on a human permission prompt"
    requirement: CTX-06
    verification:
      - kind: unit
        ref: "test/real-claude-argv.test.mjs#buildClaudeArgv_pre-approves_the_summary_tool_via_--allowedTools_when_supplied,_and_omits_the_flag_when_it_isn't"
        status: pass
    human_judgment: false
  - id: D5
    description: "Malformed input on the shared socket (unparseable JSON, an unrecognised kind) never fires onSummary and never crashes the server"
    verification:
      - kind: unit
        ref: "test/summary-report.test.mjs#malformed_input_(unparseable_JSON,_and_an_unrecognised_kind)_never_fires_onSummary_and_never_crashes_the_server"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 3: `report_summary` MCP Tool Summary

**A second MCP tool on the sidecar's existing per-run permission server lets the agent report its own closing summary as a distinct socket message kind, pre-approved via `--allowedTools` so the call never stalls on a human, with the tool's own input schema provably carrying no run/task/project/worktree id.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-09-23T00:00:25Z
- **Completed:** 2026-09-23T00:10:22Z
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- `SummaryReportedEvent` added to the sidecar's `AgentEvent` union (`adapter.ts`), mirroring
  `packages/core/src/domain/session_summary.rs`'s `SummaryFields` field names one-for-one, plus
  `AdapterCapabilities.supportsSummaryReporting`
- `report_summary` registered as a second tool on the existing MCP permission server
  (`mcp-permission-server.ts`), relayed as a second `kind: "session_summary"` message on the
  SAME per-run Unix socket `git_retry`/`git_lock_exhausted` notices already travel — zero new
  socket, zero new spawned process, zero new `--mcp-config` entry
- The summary connection resolves with a receipt acknowledgement (`{received: true}`) and closes
  immediately, never entering the held-call `pending` map — behaviourally distinct from
  `approve_action`'s held-request path, which stays byte-for-byte unchanged
- `claude-code-adapter.ts` wires the third `onSummary` callback (`normalizeSummaryNotice`, filling
  `runId` from the session's own closure — never from the payload) and `buildClaudeArgv` now
  pre-approves the fully-qualified summary tool name via `--allowedTools`, so the agent's own
  closing call never waits on a human the way a gated tool call would (D-46)
- `test/summary-report.test.mjs` (5 tests, 242 lines) proves the round trip, the undisturbed
  held-request path, the git-notice/summary non-collision, the no-id-argument structural
  contract (reading the exported `summaryToolDefinition` object directly), and malformed-input
  resilience; `test/real-claude-argv.test.mjs` gains one unit assertion on the `--allowedTools`
  wiring
- Full sidecar suite: 104/104 passing (98 pre-existing + 6 new)

## Task Commits

Each task was committed atomically:

1. **Task 1: The event and the capability** - `2729526` (feat)
2. **Task 2: The second tool on the existing server, and the second kind on the existing socket** - `b92830f` (feat)
3. **Task 3: Prove the surface, including the property that makes it trustworthy** - `bf66522` (test)

_No plan metadata commit required beyond these three — STATE.md/ROADMAP.md updates follow in
this same session._

## Files Created/Modified

- `packages/sidecar/src/adapter.ts` - `SummaryReportedEvent` in the `AgentEvent` union,
  `AdapterCapabilities.supportsSummaryReporting`
- `packages/sidecar/src/mcp-permission-server.ts` - `REPORT_SUMMARY_TOOL_NAME`/`SUMMARY_TOOL_NAME`
  constants, `SummaryReportPayload`, `isSummaryPayload`, `summaryToolDefinition`, the third
  `onSummary` parameter on `startPermissionServer`, and the two-branch `CallToolRequestSchema`
  dispatch in `runStandaloneServer`
- `packages/sidecar/src/claude-code-adapter.ts` - `normalizeSummaryNotice`, the third callback at
  the `startPermissionServer` call site, `buildClaudeArgv`'s `summaryToolName` option, and
  `CAPABILITIES.supportsSummaryReporting: true`
- `packages/sidecar/test/summary-report.test.mjs` - 5 tests proving the write surface over a real
  socket
- `packages/sidecar/test/real-claude-argv.test.mjs` - 1 new assertion on `--allowedTools` wiring

## Decisions Made

- The summary connection is answered with a receipt acknowledgement and closed immediately, never
  added to `pending` — a summary is not a held call (T-04-10's DoS mitigation)
- `SummaryReportPayload` carries no `runId` field at all; identity is derived from the socket the
  call arrives on, and the sidecar fills `runId` from the `startSession` closure when mapping to
  `SummaryReportedEvent` (T-04-01)
- The summary tool is pre-approved via `--allowedTools` inside the same
  `permissionPromptToolName`/`mcpConfig` branch `buildClaudeArgv` already had, rather than as an
  independent flag — so a caller that supplies a summary tool name without the permission-prompt
  pair gets no half-wired argv

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The agent-facing write surface (this plan) and the Rust-core read side (04-01, already landed)
  are both proven independently. Plan 04-06 (the reader-loop branch and the transactional row
  write) is the remaining half that connects `summary_reported` events arriving on the sidecar's
  stdout to `domain::session_summary::create_summary` — no interface gap to close before that
  plan starts: `SummaryReportedEvent`'s field names already mirror `SummaryFields` one-for-one.
- No blockers for 04-06.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/sidecar/test/summary-report.test.mjs
- FOUND: packages/sidecar/src/adapter.ts (SummaryReportedEvent, supportsSummaryReporting)
- FOUND: packages/sidecar/src/mcp-permission-server.ts (REPORT_SUMMARY_TOOL_NAME, SUMMARY_TOOL_NAME)
- FOUND commit 2729526 in git log
- FOUND commit b92830f in git log
- FOUND commit bf66522 in git log
- npm --prefix packages/sidecar run build: clean, no TypeScript errors
- npm --prefix packages/sidecar test: 104/104 passing
