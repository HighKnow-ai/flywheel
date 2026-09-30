---
phase: 06-agents-file-their-own-backlog
plan: 01
subsystem: authoring
tags: [rust, sqlite, mcp, typescript, sidecar, claude-code]

# Dependency graph
requires: []
provides:
  - "propose_item MCP tool: an ordinary task-execution run's one write surface onto its own project's triage lane"
  - "writeHookSettings(runtimeDir, runId, includeAuthoringStageGate): the fix for the execution-run/authoring stage-gate collision (06-RESEARCH.md Pitfall 1)"
  - "Migration 0015: authoring_proposals rebuilt in one pass — target_type += issue, status += merged/deferred, plus rationale/origin_log_offset/duplicate_of/duplicate_score"
  - "ProposalProvenance: rationale + server-resolved origin_log_offset threaded through create_proposal(_in_tx), validated and written in the same INSERT"
  - "ProposalPayload::Issue (Rust) — field named issue_kind, not kind, to avoid colliding with the enum's own serde(tag = \"kind\")"
affects: [06-02, 06-03, 06-04, 06-05, 06-06, 06-07, 06-08, 06-09]

actuals:
  tokens: 31010
  tasks: 1
  commits: 1

tech-stack:
  added: []
  patterns:
    - "Settings-file two-branch write gated by run kind (includeAuthoringStageGate: boolean), rather than a run-kind branch inside the hook script itself"
    - "Provenance struct (ProposalProvenance) threaded as one parameter through a domain writer instead of two positional trailing Options, so authoring callers state 'no execution-run provenance' once, at the call site (::NONE)"

key-files:
  created:
    - packages/core/src/db/migrations/0015_proposal_triage_extension.sql
    - packages/core/tests/proposal_channel.rs
    - packages/sidecar/test/propose-item-wire.test.mjs
    - packages/sidecar/test/execution-hook-settings.test.mjs
  modified:
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/tests/migration_safety.rs
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/test/authoring-stage-gate.test.mjs
    - packages/core/tests/authoring_acceptance.rs
    - packages/core/tests/authoring_board_read.rs
    - packages/core/tests/authoring_criterion_reachability.rs
    - packages/core/tests/authoring_lifecycle.rs
    - packages/core/tests/authoring_measurement.rs
    - packages/core/tests/authoring_proposal.rs
    - packages/core/tests/authoring_stage.rs
    - packages/core/tests/authoring_tracer.rs
    - packages/core/tests/epic_context_packet.rs

key-decisions:
  - "Migration 0015 bundles ALL FOUR shape changes (target_type += issue, status += merged/deferred, rationale/origin_log_offset, duplicate_of/duplicate_score) into ONE table rebuild rather than two (checkpoint option-a). Rationale: one backup/restore risk window instead of two on a table that keeps decided rows forever (D-83); one place to re-create all four dropped indexes; follows the existing 0006_recovery_statuses.sql rebuild recipe exactly. duplicate_of/duplicate_score are shaped now even though plan 06-04 writes them, because the bm25 threshold 06-04 measures is a value rather than a column type."
  - "Tracer feedback gate resolved by coordinator decision, not a manual UI pass: the human-check (open a task's session surface, confirm the triage lane shows the staged proposal with its rationale legible, confirm accept mints a task) was approved on the automated DB-level evidence already proven by proposal_channel.rs's 6 tests, and the visual end-to-end proof was deliberately deferred to plan 06-09's scripted UAT harness (scripts/uat/uat-10-agent-backlog.mjs, joining scripts/uat/run-all.sh, already scheduled for wave 8). This matches the project's standing preference for a durable, re-runnable automated harness over a one-off human look — recorded as WINDOWS.md entry #19 (kind: unrun-verify) rather than silently closed."
  - "ProposalPayload::Issue's Rust field is named issue_kind, not kind, even though 06-01-PLAN.md's own action text specified kind — serde's #[serde(tag = \"kind\")] on the enum's own discriminant collides with a same-named variant field at compile time (verified this session: 'variant field name kind conflicts with internal tag'). The MCP tool's user/model-facing schema property stays named kind; buildProposeItemPayload (sidecar) is the one translation point that renames it to issue_kind for the wire shape the Rust core deserialises. Documented as a Rule 1 auto-fixed bug below."
  - "KNOWN LIMITATION for the next plan that touches the frontend: ProposalDto (packages/desktop/src-tauri/src/commands/authoring.rs) carries no rationale field today, and TriageLane.tsx cannot render what the Tauri command layer does not expose. The triage lane shows a staged proposal's title today, but not its rationale — that wiring (ProposalDto.rationale, per 06-01-PLAN.md's own 'Artifacts this phase produces' list) is out of THIS plan's declared files_modified and lands in a later 06-0x plan. Whichever plan adds ProposalDto.rationale should treat this note as the reason that field is missing, not rediscover the gap."

patterns-established:
  - "Pattern: an execution-run vs. authoring-run behavioral fork lives in the CALL SITE's boolean argument (writeHookSettings's includeAuthoringStageGate), never as a run-kind conditional inside the shared underlying script/function it configures."

requirements-completed: []  # PROP-01/PROP-02/PROP-07 are also declared by sibling plans 06-02/06-03/06-06/06-07/06-08/06-09 still in flight — shared-ID gate (#2388) holds them open until every declaring plan finishes.

coverage:
  - id: D1
    description: "propose_item MCP tool declared on the shared flywheel-permissions server, pre-approved for execution runs only via buildClaudeArgv's new proposeItemToolName option, refusing malformed input before any socket write"
    requirement: PROP-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/propose-item-wire.test.mjs (10 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "writeHookSettings's includeAuthoringStageGate parameter fixes the execution-run/authoring-stage-gate collision (06-RESEARCH.md Pitfall 1): an execution run's settings file carries no AUTHORING_STAGE_GATE_MATCHER entry, an authoring run's still carries two"
    requirement: PROP-01
    verification:
      - kind: unit
        ref: "packages/sidecar/test/execution-hook-settings.test.mjs (3 tests)"
        status: pass
      - kind: integration
        ref: "packages/sidecar/test/authoring-stage-gate.test.mjs#an execution-run startSession writes exactly ONE PreToolUse entry, byte-identical to the pre-existing Bash entry"
        status: pass
    human_judgment: false
  - id: D3
    description: "Migration 0015 rebuilds authoring_proposals in one pass, preserving every row and the self-referential parent_proposal_id link, re-creating all four indexes, and accepting the two widened CHECK vocabularies"
    verification:
      - kind: integration
        ref: "packages/core/tests/migration_safety.rs#migration_0015_rebuild_preserves_self_referential_parent_link"
        status: pass
    human_judgment: false
  - id: D4
    description: "An execution-run proposal_created event stages exactly one pending row with its rationale and a server-resolved origin_log_offset, no canonical row; accept_proposal mints exactly one task; identical-content and zero-offset edge cases hold; ordering is created_at DESC, id DESC"
    requirement: PROP-02
    verification:
      - kind: integration
        ref: "packages/core/tests/proposal_channel.rs (6 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The board's triage lane visually shows a staged proposal (with rationale legible) and accepting it from the lane puts a real task on the board"
    requirement: PROP-07
    verification: []
    human_judgment: true
    rationale: "Deferred by coordinator decision to plan 06-09's scripted UAT harness (scripts/uat/uat-10-agent-backlog.mjs) rather than a manual visual pass now — approved on the automated DB-level evidence in D4 instead. Recorded as WINDOWS.md entry #19 (kind: unrun-verify, status: open) so it stays visible until that harness closes it."

duration: 79min
completed: 2026-09-30
status: complete
---

# Phase 6 Plan 1: Execution-Run Proposal Channel Tracer Summary

**An ordinary task-execution agent can now call `propose_item` to stage a pending proposal end to end — migration 0015, the MCP tool, the Pitfall-1 stage-gate fix, and provenance columns, proven by 19 new automated tests.**

## Performance

- **Duration:** 79 min
- **Started:** 2026-09-30T03:16:00Z (approx.)
- **Completed:** 2026-09-30T04:35:00Z
- **Tasks:** 1 (tracer) + 1 pre-resolved checkpoint (migration-shape decision, option-a)
- **Files modified:** 21

## Accomplishments
- `propose_item` MCP tool declared on the shared `flywheel-permissions` server, pre-approved for execution runs only, refusing malformed input (bad `target_type`, empty title, empty rationale, invalid issue `kind`) before any socket write
- Fixed 06-RESEARCH.md Pitfall 1: `writeHookSettings` no longer unconditionally stage-gates every session — an execution run's settings file carries exactly one `PreToolUse` entry, an authoring run's carries two, byte-identical to before this plan on both branches
- Migration `0015_proposal_triage_extension.sql` rebuilds `authoring_proposals` in one pass: `target_type` += `issue`, `status` += `merged`/`deferred`, plus `rationale`, `origin_log_offset`, `duplicate_of`, `duplicate_score` — every existing row, the self-referential `parent_proposal_id` link, and all four indexes survive
- `ProposalProvenance` threads `rationale` (validated, stored verbatim) and `origin_log_offset` (resolved server-side from `session_log::count_lines`, before the write transaction opens) through `create_proposal`/`create_proposal_in_tx`
- Accepting a staged execution-run proposal through the existing `accept_proposal` command mints exactly one task — no new acceptance path was needed

## Task Commits

Each task was committed atomically:

1. **Task 1: Tracer — execution-run agent proposes, row lands pending, accept mints a task** - `85d7753` (feat)

**Plan metadata:** commit follows this SUMMARY

_Note: TDD is not applicable to this plan._

## Files Created/Modified
- `packages/core/src/db/migrations/0015_proposal_triage_extension.sql` - the one-pass `authoring_proposals` rebuild
- `packages/core/src/db/mod.rs` - registers migration 0015 (single `include_str!` line)
- `packages/core/src/domain/authoring_proposal.rs` - `ProposalTargetType::Issue`, `ProposalPayload::Issue`, `ISSUE_KINDS`, `ProposalProvenance` (+ `::NONE`), `MAX_PROPOSAL_RATIONALE_LEN`, threaded provenance through the write path, server-resolved `origin_log_offset` in `apply_proposal_created`
- `packages/core/src/epic_context_packet.rs` - added the `Issue` arm to `payload_label`'s exhaustive match
- `packages/core/tests/proposal_channel.rs` - new: the end-to-end staging test (6 tests)
- `packages/core/tests/migration_safety.rs` - new case: `migration_0015_rebuild_preserves_self_referential_parent_link`
- `packages/sidecar/src/claude-code-adapter.ts` - `writeHookSettings`'s new `includeAuthoringStageGate` parameter (exported), both call sites updated, `buildClaudeArgv`'s new `proposeItemToolName` option
- `packages/sidecar/src/mcp-permission-server.ts` - `PROPOSE_ITEM_TOOL_NAME`, `EXECUTION_PROPOSE_ITEM_TOOL_NAME`, `PROPOSE_ITEM_TARGET_TYPES`, `PROPOSE_ITEM_ISSUE_KINDS`, `proposeItemToolDefinition`, `buildProposeItemPayload`, registration + dispatch branch, widened `AuthoringProposalPayload` (targetType += issue, new `rationale` field)
- `packages/sidecar/src/adapter.ts` - widened `ProposalCreatedEvent.targetType`, added `.rationale`
- `packages/sidecar/test/propose-item-wire.test.mjs` - new: wire-shape contract (10 tests)
- `packages/sidecar/test/execution-hook-settings.test.mjs` - new: direct unit test of both `writeHookSettings` branches (3 tests)
- `packages/sidecar/test/authoring-stage-gate.test.mjs` - fixed an existing assertion that encoded the Pitfall-1 bug as correct behavior
- 9 `packages/core/tests/authoring_*.rs` / `epic_context_packet.rs` files - mechanically updated for `create_proposal`'s new `provenance: ProposalProvenance` parameter (every existing authoring caller now passes `ProposalProvenance::NONE`)

## Decisions Made

**1. Migration 0015 shape (checkpoint, option-a — one rebuild now).** Bundles the CHECK-vocabulary widenings (`target_type` += `issue`, `status` += `merged`/`deferred`) with all four new columns (`rationale`, `origin_log_offset`, `duplicate_of`, `duplicate_score`) into a single table rebuild. One backup/restore risk window instead of two on a table that keeps decided rows forever (D-83); one place to re-create all four dropped indexes; `duplicate_of`/`duplicate_score` exist from this plan onward even though plan 06-04 is the one that writes them, because the bm25 threshold that plan measures is a value, not a column-type decision. Follows `0006_recovery_statuses.sql`'s documented rebuild recipe exactly.

**2. Tracer feedback gate resolved by coordinator decision, not a manual UI pass.** The tracer's own `<verify><human-check>` (open a task's session surface, confirm the triage lane shows the staged proposal with its rationale legible, confirm accept mints a task) was approved on the automated DB-level evidence already proven by `proposal_channel.rs`'s 6 passing tests. The visual end-to-end proof was deliberately deferred to plan 06-09's scripted UAT harness (`scripts/uat/uat-10-agent-backlog.mjs`, joining `scripts/uat/run-all.sh` — already scheduled for wave 8 of this phase), matching this project's standing preference for a durable, re-runnable automated harness over a one-off manual look. Recorded as `WINDOWS.md` entry #19 (`kind: unrun-verify`, `status: open`) so the deferral stays visible rather than silently closed.

**3. `ProposalDto.rationale` gap — known limitation for a later plan.** The triage lane (`TriageLane.tsx`) shows a staged proposal's title today, but not its rationale, because `ProposalDto` (`packages/desktop/src-tauri/src/commands/authoring.rs`) carries no `rationale` field yet. Wiring that field is outside this plan's declared `files_modified` — it is listed under `06-01-PLAN.md`'s own "Artifacts this phase produces" section as a not-yet-shipped symbol, and lands in a later 06-0x plan. That plan should treat this note as the reason the field is missing, not rediscover the gap.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ProposalPayload::Issue`'s field renamed from `kind` to `issue_kind`**
- **Found during:** Task 1, first `cargo build -p core` after adding the enum variant exactly as `06-01-PLAN.md`'s action text specified (`Issue { title: String, body: Option<String>, kind: String }`)
- **Issue:** the enclosing `ProposalPayload` enum is `#[serde(tag = "kind", rename_all = "snake_case")]` — serde refuses to compile a variant field whose serialised name collides with the enum's own internal tag, with the exact error `variant field name "kind" conflicts with internal tag`
- **Fix:** renamed the Rust field to `issue_kind` (and its `validate_payload` arm accordingly); the MCP tool's own user/model-facing schema property stays named `kind`, and `buildProposeItemPayload` (sidecar) is the one translation point that renames it to `issue_kind` when building the wire payload the Rust core deserialises
- **Files modified:** `packages/core/src/domain/authoring_proposal.rs`, `packages/sidecar/src/mcp-permission-server.ts`
- **Verification:** `cargo build -p core` clean; `propose-item-wire.test.mjs`'s "carries issue_kind, never a bare kind matching the issue category" test asserts the wire shape explicitly
- **Committed in:** `85d7753`

**2. [Rule 3 - Blocking] `create_proposal`'s new `provenance` parameter required updating 9 pre-existing test files (~101 call sites)**
- **Found during:** Task 1, `cargo test -p core --no-run` after threading `ProposalProvenance` through `create_proposal`/`create_proposal_in_tx` per the plan's own action text ("every existing authoring caller passes `ProposalProvenance::NONE`")
- **Issue:** every existing call site of the public `create_proposal` function (in `authoring_proposal.rs`, `authoring_tracer.rs`, `authoring_acceptance.rs`, `authoring_measurement.rs`, `authoring_lifecycle.rs`, `authoring_stage.rs`, `authoring_board_read.rs`, `authoring_criterion_reachability.rs`, `epic_context_packet.rs`) failed to compile against the new 7th parameter — none of these files are in `06-01-PLAN.md`'s own `files_modified` list, but the plan's action text explicitly required this signature change
- **Fix:** appended `ProposalProvenance::NONE` to every call site (a scripted, paren-balance-aware transform, spot-checked by diff before running), and added `ProposalProvenance` to each file's existing import list
- **Files modified:** the 9 files listed above under Files Created/Modified
- **Verification:** `cargo test --workspace` — 756/756 pass, all pre-existing assertions unchanged
- **Committed in:** `85d7753`

**3. [Rule 1 - Bug] Fixed a pre-existing test that encoded the exact Pitfall-1 bug as correct behavior**
- **Found during:** Task 1, `npm --prefix packages/sidecar test` after wiring `includeAuthoringStageGate`
- **Issue:** `authoring-stage-gate.test.mjs`'s "writeHookSettings writes exactly two PreToolUse entries..." test asserted that an ordinary execution-run `startSession` spawn produces TWO `PreToolUse` entries (including the authoring stage-gate matcher) — this was the OLD, buggy, unconditional-write behavior `06-RESEARCH.md` Pitfall 1 names as the thing to fix, encoded as if it were the correct shape
- **Fix:** rewrote the test and its title to assert the corrected shape (exactly ONE entry, no authoring stage-gate matcher, for an execution-run `startSession`); updated the file's own header doc comment, which had documented `writeHookSettings` as "a private function this module never exports" (now exported)
- **Files modified:** `packages/sidecar/test/authoring-stage-gate.test.mjs`
- **Verification:** `npm --prefix packages/sidecar test` — 211/211 pass
- **Committed in:** `85d7753`

**4. [Rule 3 - Blocking] `epic_context_packet.rs`'s `payload_label` needed an `Issue` arm**
- **Found during:** Task 1, `cargo build --workspace` after adding `ProposalPayload::Issue`
- **Issue:** `payload_label`'s match over `ProposalPayload` is exhaustive without a wildcard arm; adding the new variant left it non-exhaustive
- **Fix:** added the `Issue { title, .. } => title.clone()` arm, matching the existing `Epic`/`Task` pattern
- **Files modified:** `packages/core/src/epic_context_packet.rs`
- **Verification:** `cargo build --workspace` clean
- **Committed in:** `85d7753`

**5. [Rule 3 - Blocking] `target_row_exists`'s match over `ProposalTargetType` needed an `Issue` arm**
- **Found during:** Task 1, `cargo build -p core` after adding `ProposalTargetType::Issue`
- **Issue:** non-exhaustive match (`E0004`)
- **Fix:** added a real `SELECT 1 FROM issues WHERE id = ?1` arm (the `issues` table has existed since `0002_board_schema.sql`) rather than a placeholder — no `amend`/`delete` verb reaches an `issue` target in this plan (an execution run's `propose_item` call only ever builds `verb: "create"`), but the match must stay exhaustive over every `ProposalTargetType` regardless of which combination is reachable today
- **Files modified:** `packages/core/src/domain/authoring_proposal.rs`
- **Verification:** `cargo build --workspace` clean
- **Committed in:** `85d7753`

---

**Total deviations:** 5 auto-fixed (2 bugs, 3 blocking compile issues). **Impact:** all five were necessary to make the plan's own action text compile and pass its own acceptance criteria; none introduced scope creep — the two "bug" fixes correct a genuine serde naming collision and a pre-existing test that had baked in the exact defect this plan fixes, and the three "blocking" fixes are mechanical exhaustiveness/call-site updates the plan's own signature change required.

## Issues Encountered
None beyond the deviations documented above.

## Authentication Gates
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The proposal channel is proven end-to-end at the database and MCP layers; plans 06-02 through 06-08 can build the triage verbs (merge/defer/bulk actions), duplicate detection, and volume limiting directly on top of `ProposalProvenance` and migration 0015's column set without a second rebuild.
- **Blocker/gap for a later plan:** `ProposalDto` (Tauri command layer) and `TriageLane.tsx` do not yet expose `rationale` — see Decision 3 above. Whichever plan adds `ProposalDto.rationale` should link back to this SUMMARY.
- **Open item:** `WINDOWS.md` entry #19 — the visual end-to-end proof (triage lane rendering, accept-mints-a-task from the UI) is deferred to plan 06-09's `scripts/uat/uat-10-agent-backlog.mjs`. That plan should close this entry when its harness runs green.

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-09-30*
