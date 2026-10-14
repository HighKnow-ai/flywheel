---
phase: 06-agents-file-their-own-backlog
verified: 2026-10-02T12:35:00Z
status: passed
score: 5/5 must-haves verified
covered_files:
  - ".planning/phases/06-agents-file-their-own-backlog/06-01-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-01-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-02-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-02-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-03-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-03-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-04-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-04-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-05-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-05-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-06-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-06-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-07-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-07-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-08-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-08-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-09-PLAN.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-09-SUMMARY.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-REVIEW.md"
  - ".planning/phases/06-agents-file-their-own-backlog/06-VALIDATION.md"
  - "packages/core/src/db/migrations/0015_proposal_triage_extension.sql"
  - "packages/core/src/db/migrations/0016_authoring_proposals_fts.sql"
  - "packages/core/src/db/mod.rs"
  - "packages/core/src/domain/authoring_proposal.rs"
  - "packages/core/src/domain/issue.rs"
  - "packages/core/src/query/authoring.rs"
  - "packages/core/src/query/search.rs"
  - "packages/core/tests/bin/uat_authoring_ops.rs"
  - "packages/core/tests/migration_safety.rs"
  - "packages/core/tests/proposal_channel.rs"
  - "packages/core/tests/proposal_duplicates.rs"
  - "packages/core/tests/proposal_limit.rs"
  - "packages/core/tests/proposal_no_promotion.rs"
  - "packages/core/tests/proposal_triage_verbs.rs"
  - "packages/desktop/src-tauri/src/commands/authoring.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src/App.tsx"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/authoring/ProposalRow.tsx"
  - "packages/desktop/src/authoring/useAuthoringQuery.ts"
  - "packages/desktop/src/board/TriageLane.tsx"
  - "packages/desktop/src/session/SessionSurface.tsx"
  - "packages/desktop/src/state/keyboard.ts"
  - "packages/desktop/src/state/uiStore.ts"
  - "packages/desktop/src/triage/TriageSurface.tsx"
  - "packages/desktop/src/triage/__tests__/triage-routing.test.tsx"
  - "packages/desktop/src/triage/__tests__/triage-surface.test.tsx"
  - "packages/sidecar/src/claude-code-adapter.ts"
  - "packages/sidecar/src/mcp-permission-server.ts"
  - "packages/sidecar/test/execution-hook-settings.test.mjs"
  - "packages/sidecar/test/propose-item-wire.test.mjs"
  - "scripts/uat/run-all.sh"
  - "scripts/uat/uat-10-agent-backlog.mjs"
covered_digest: "v1:sha256:ee6c238829aff4b8a737e1504023a046d49a69c887a301b593629a7649df972f"
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:
  - truth: "A running agent proposes a new task, issue or epic mid-session through a board tool, and it lands in a distinct proposed state — never appearing as accepted work, with no code path that promotes it except explicit human triage (Success Criterion 1, agent-driven half)."
    test: "Run `node scripts/uat/uat-10-agent-backlog.mjs --live` with a real `claude` binary so a real model decides, mid-session, to call `propose_item`."
    expected: "The live arm reports Criterion 1 as `observed`: the model's own tool call stages exactly one pending `authoring_proposals` row and no canonical row, before any human triage."
    why_human: "The offline arm (run by this verifier) exercises the structural/no-promotion half of Criterion 1 by calling the real wire functions synthetically — it proves the machinery cannot promote a proposal, but it cannot prove a real agent, mid-session, chooses to call propose_item and that the call reaches the MCP handler end-to-end through a live Claude Code process. That requires a real model call and tokens, which this verifier was instructed not to spend."
human_verification:
  - test: "Run `node scripts/uat/uat-10-agent-backlog.mjs --live` with a real `claude` binary."
    expected: "Per-criterion report marks Criterion 1 `observed` (a real agent's own `propose_item` call staged a pending row, no promotion occurred) and all five criteria end `observed`, none silently un-measured."
    why_human: "Requires a live model call (tokens)."
    result: passed
    executed: "2026-10-02 by the execute-phase orchestrator; see 06-UAT.md. All five criteria reported `observed`; Criterion 1 measured against a real claude session's own propose_item call (run 01M3XEAQ8AHRCJEXG4MNH5JBMF, proposal 01M3XEB5Q5KH9AAX28J6BCE0GE)."
---

# Phase 6: Agents File Their Own Backlog Verification Report

**Phase Goal:** Agents surface what they learn as proposed board items, and nothing an agent proposes becomes real work without Cyril saying so.
**Verified:** 2026-10-02T12:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (ROADMAP Success Criterion) | Status | Evidence |
|---|------|--------|----------|
| 1 | A running agent proposes a new task/issue/epic mid-session through a board tool, lands in a distinct proposed state, never appears as accepted work, no code path promotes it except explicit human triage | ✓ VERIFIED | Structural half proven by two source gates run as single named tests: `cargo test -p core --test proposal_no_promotion no_agent_reachable_module_writes_a_canonical_table` (PASS) and `...only_three_call_sites_reach_a_canonical_writer_from_the_staging_module` (PASS) — walks every `.rs`/`.tsx` file under `packages/core/src`, `packages/desktop/src-tauri/src`, `packages/desktop/src` and asserts the only three call sites reaching a canonical writer are accept/merge/materialise. The staging half is proven by `packages/core/tests/proposal_channel.rs` (271 lines) and by this verifier's own run of the offline UAT arm (`node scripts/uat/uat-10-agent-backlog.mjs --offline`), which staged 10 real rows through the real `buildProposeItemPayload`/`stageAuthoringProposal` wire and created zero canonical rows until triage. The one half no presence check can prove is a *real* agent, mid-session, actually choosing to call `propose_item` and that call reaching the live MCP handler — that requires `--live` (real tokens). The orchestrator ran it after verification: a real `claude` execution-run session called `propose_item` once, mid-session, of its own accord (run `01M3XEAQ8AHRCJEXG4MNH5JBMF`, proposal `01M3XEB5Q5KH9AAX28J6BCE0GE`, "Fix flaky retry test that drops events under load"), staging a pending row with the model's own rationale and promoting nothing. All five criteria reported `observed`. See `06-UAT.md`. |
| 2 | User triages the proposal queue in a dedicated view: accept, reject, merge into an existing item, or defer | ✓ VERIFIED | `packages/desktop/src/triage/TriageSurface.tsx` (621 lines) is a dedicated view wired from `TriageLane.tsx`'s header through `uiStore.setTriageSurfaceProjectId` → `App.tsx` mount. All four verbs call real hooks (`useMergeProposal`, `useDeferProposal`, plus pre-existing accept/reject) which call typed wrappers in `adapters/tauri.ts` → registered Tauri commands (`authoring_proposal_merge`, `authoring_proposal_defer`, `authoring_proposals_reject_bulk`, `authoring_proposals_defer_bulk`, `authoring_proposal_accept`, `authoring_proposal_reject`) → core domain writers. Ran `npm --prefix packages/desktop test -- triage-surface` (11/11 pass) and `-- triage-routing` (7/7 pass) directly. Offline UAT also exercised accept→task, reject, merge→issue (seeded task row unchanged), defer→recallable, end to end through real domain functions. |
| 3 | Each proposal shows which agent run produced it and what prompted it | ✓ VERIFIED | `TriageSurface.tsx:423-447`: renders `"From session {agentRunId.slice(0,8)}"`, a labelled "Rationale" block with `proposal.rationale`, and (when `originLogOffset` is non-null, including zero) a "Jump to turn" button calling `onOpenSession(agentRunId, epicId, logOffset)` which opens the session feed at that offset (proven by `triage-routing.test.tsx`'s "activating a row's turn-pointer control opens the run's session at the recorded offset, including zero" — ran and passed). Offline UAT confirmed a deferred proposal's rationale round-trips verbatim through `list-deferred`. |
| 4 | A proposal that duplicates an existing item is flagged as a duplicate before the user sees it | ✓ VERIFIED | Ran `cargo test -p core --test proposal_duplicates staging_flags_a_proposal_restating_an_existing_open_task` (PASS) and `a_score_exactly_equal_to_the_threshold_is_not_flagged` (PASS) — duplicate columns are written inside the same INSERT transaction, never computed on read. Offline UAT independently staged a near-duplicate and observed `duplicateOf`/`duplicateScore` present on the row before any triage action. `TriageSurface.tsx` renders `<DuplicateAnnotation candidate={proposal.duplicateCandidate} />` for every flagged row, which is link-only (never auto-drops/merges). |
| 5 | A chatty agent hits a per-run proposal limit and the user is told the limit was hit, rather than proposals being silently dropped | ✓ VERIFIED | Ran `cargo test -p core --test proposal_limit staging_an_eleventh_proposal_is_refused_and_creates_no_row` (PASS). Offline UAT staged exactly 10 proposals, had the 11th refused naming the limit and pointing at `report_summary`'s `remains` field, and confirmed `authoring_proposal_limit_notices` reports exactly one notice (`refusedCount=1`) for the run — the notice is re-derived from a `proposal.limit_exhausted` event, not stored twice. |

**Score:** 5/5 truths verified. The live-agent half of Criterion 1 was closed by a real `--live` UAT run after initial verification (see `06-UAT.md`).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/db/migrations/0015_proposal_triage_extension.sql` | Table rebuild adding target_type=issue, status=merged/deferred, rationale/origin_log_offset/duplicate_of/duplicate_score | ✓ VERIFIED | 86 lines, contains `authoring_proposals_new`; `migration_safety.rs` proves row/index/parent-link preservation |
| `packages/core/tests/proposal_channel.rs` | End-to-end proposal-channel test | ✓ VERIFIED | 271 lines |
| `packages/sidecar/test/propose-item-wire.test.mjs` | Wire-shape contract for `propose_item` | ✓ VERIFIED | 313 lines; ran as part of full sidecar suite (223/223 pass) |
| `packages/sidecar/test/execution-hook-settings.test.mjs` | Proof execution-run settings omit authoring stage-gate matcher | ✓ VERIFIED | 62 lines; `"the authoring-stage-gate PreToolUse array length is unchanged..."` observed passing in full suite run |
| `packages/core/tests/proposal_no_promotion.rs` | Source gate + adversarial corpus for PROP-03 | ✓ VERIFIED | 1196 lines; 4 of its named tests run directly, all PASS |
| `packages/core/src/domain/issue.rs` | `create_issue_in_tx` | ✓ VERIFIED | 602 lines, contains `pub fn create_issue_in_tx` |
| `packages/core/tests/proposal_triage_verbs.rs` | Tests for all 4 triage verbs + bulk + guards | ✓ VERIFIED | 778 lines |
| `packages/core/src/db/migrations/0016_authoring_proposals_fts.sql` | External-content FTS5 index | ✓ VERIFIED | 59 lines, contains `authoring_proposals_fts` |
| `packages/core/tests/proposal_duplicates.rs` | Threshold + edge cases | ✓ VERIFIED | 935 lines; 3 named tests run directly, all PASS |
| `packages/core/tests/proposal_limit.rs` | Boundary + precision + event tests | ✓ VERIFIED | 440 lines; boundary test run directly, PASS |
| `packages/core/src/query/authoring.rs` | `list_deferred_proposals`, five-status counts | ✓ VERIFIED | 777 lines, contains `list_deferred_proposals` |
| `packages/desktop/src/authoring/useAuthoringQuery.ts` | Merge/defer/bulk/deferred/limit-notice hooks | ✓ VERIFIED | 326 lines, contains `useMergeProposal` and the other five named hooks |
| `packages/desktop/src/adapters/tauri.ts` | Typed transport wrappers | ✓ VERIFIED | 1052 lines, contains `mergeAuthoringProposal` and siblings |
| `packages/desktop/src/triage/TriageSurface.tsx` | Dedicated triage view | ✓ VERIFIED | 621 lines (min 250) |
| `packages/desktop/src/triage/__tests__/triage-surface.test.tsx` | Component tests | ✓ VERIFIED | 355 lines; ran, 11/11 pass |
| `packages/desktop/src/triage/__tests__/triage-routing.test.tsx` | Routing/mount tests | ✓ VERIFIED | 246 lines; ran, 7/7 pass |
| `scripts/uat/uat-10-agent-backlog.mjs` | Scriptable phase-6 acceptance run | ✓ VERIFIED | 864 lines; `--self-test` and `--offline` both run and PASS |
| `packages/core/tests/bin/uat_authoring_ops.rs` | UAT bridge subcommands | ✓ VERIFIED | 611 lines, contains `merge-proposal`; exercised live by the offline UAT run |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `mcp-permission-server.ts` | `authoring_proposal.rs` | `buildProposeItemPayload → stageAuthoringProposal → sidecar.rs proposal_created → apply_proposal_created` | ✓ WIRED — exercised directly by offline UAT (staged 10 real rows through this exact path) |
| `proposal_no_promotion.rs` | `authoring_proposal.rs` / `packages/desktop/src` | Adversarial corpus + source-gate walker covering `.tsx` | ✓ WIRED — ran `the_no_promotion_gate_actually_reaches_the_frontend_tree`, PASS |
| `authoring_proposal.rs` | `issue.rs` | `merge_proposal_in_tx`/materialise Issue arm call `create_issue_in_tx` | ✓ WIRED — offline UAT's merge step produced a real `issues` row via this path with the seeded task left unchanged |
| `authoring_proposal.rs` | `search.rs` | `create_proposal_in_tx` calls `duplicate_candidate_for` inside its own transaction | ✓ WIRED — confirmed by `staging_flags_a_proposal_restating_an_existing_open_task` (PASS) and offline UAT |
| `authoring_proposal.rs` | `commands/authoring.rs` | `ProposalOutcome::LimitExhausted` → relayed error | ✓ WIRED — offline UAT's 11th call surfaced the exact refusal message naming the limit and `report_summary.remains` |
| `TriageSurface.tsx` | `useAuthoringQuery.ts` | reads/mutates through the six new hooks | ✓ WIRED — grep-confirmed imports and call sites; component tests exercise them |
| `TriageSurface.tsx` | `ProposalRow.tsx` | renders shipped row component | ✓ WIRED |
| `TriageLane.tsx` | `uiStore.ts` | `setTriageSurfaceProjectId` | ✓ WIRED — confirmed in both files; `triage-routing.test.tsx` exercises the full round trip |
| `App.tsx` | `TriageSurface.tsx` | mounted once at App level, gated on store trigger | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Self-test (no child process) | `node scripts/uat/uat-10-agent-backlog.mjs --self-test` | 8 assertions, all pass | ✓ PASS |
| Offline end-to-end (real wire functions, zero tokens) | `node scripts/uat/uat-10-agent-backlog.mjs --offline` | Criteria 2-5 `observed`; Criterion 1 `not-measured` (declared live-only by the script itself) | ✓ PASS |
| Structural no-promotion gate | `cargo test -p core --test proposal_no_promotion no_agent_reachable_module_writes_a_canonical_table -- --exact` (+3 siblings) | 4/4 pass | ✓ PASS |
| Duplicate-flag transaction-time write | `cargo test -p core --test proposal_duplicates staging_flags_a_proposal_restating_an_existing_open_task -- --exact` (+2 siblings) | 3/3 pass | ✓ PASS |
| Limit boundary (10th succeeds, 11th refused) | `cargo test -p core --test proposal_limit staging_an_eleventh_proposal_is_refused_and_creates_no_row -- --exact` | 1/1 pass | ✓ PASS |
| Triage surface component behavior | `npm --prefix packages/desktop test -- triage-surface` | 11/11 pass | ✓ PASS |
| Lane→surface routing + turn-pointer jump | `npm --prefix packages/desktop test -- triage-routing` | 7/7 pass | ✓ PASS |
| Sidecar full suite (includes wire + hook-settings tests) | `npm --prefix packages/sidecar test` (run twice during verification) | 223/223 pass each run | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files found and none declared in PLAN/SUMMARY for this phase. SKIPPED (not applicable — this phase uses `scripts/uat/uat-10-agent-backlog.mjs` as its acceptance harness instead, covered above under Behavioral Spot-Checks).

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|---|---|---|---|---|
| PROP-01 | 06-01, 06-09 | Agent can propose new tasks/issues/epics through a board tool | ✓ SATISFIED | `propose_item` wire + offline UAT staged real rows |
| PROP-02 | 06-01, 06-02, 06-03, 06-09 | Proposals enter a distinct proposed state, never accepted work until triaged | ✓ SATISFIED | source gate + adversarial corpus + offline UAT |
| PROP-03 | 06-02, 06-09 | No code path promotes a proposal except explicit human triage | ✓ SATISFIED | `proposal_no_promotion.rs` source gate run directly, PASS |
| PROP-04 | 06-04, 06-05, 06-06, 06-07, 06-09 | Duplicates flagged before surfaced | ✓ SATISFIED | `proposal_duplicates.rs` + offline UAT near-duplicate run |
| PROP-05 | 06-05, 06-07, 06-09 | Proposal volume rate-limited; hitting limit surfaced, never silently dropped | ✓ SATISFIED | `proposal_limit.rs` boundary test + offline UAT 11th-call refusal |
| PROP-06 | 06-03, 06-06, 06-07, 06-08, 06-09 | Dedicated triage view: accept/reject/merge/defer | ✓ SATISFIED | `TriageSurface.tsx` + component tests, all 4 verbs wired |
| PROP-07 | 06-01, 06-06, 06-07, 06-08, 06-09 | Every proposal records which run produced it and what prompted it | ✓ SATISFIED | `agentRunId`/rationale/`originLogOffset` rendered, "Jump to turn" wired |

No orphaned requirements — REQUIREMENTS.md maps exactly PROP-01..07 to Phase 6, and every ID appears in at least one plan's `requirements` field.

### Anti-Patterns Found

No unresolved `TBD`/`FIXME`/`XXX` markers found in any phase-modified file. No bulk-accept control exists anywhere in the modified files (every "bulk accept" grep hit is a code comment explaining its deliberate absence, consistent with D-104). The code-review-identified WR-01 (`is_fts5_syntax_error` can never match due to `.context()` wrapping, in `packages/core/src/query/search.rs`) is a real but masked bug — both call sites swallow the error via `.ok()` regardless of its text, confirmed by this verifier's own passing run of `a_title_containing_fts5_query_syntax_degrades_to_no_candidate_rather_than_an_error`. This does not block any of the five observable success criteria; it is a latent correctness gap the code review already surfaced and tracked as a WARNING, not a BLOCKER — carried forward here, not re-litigated. WR-02 (`TriageSurface` not wired into the keyboard layer model, so Escape doesn't close it) is a real UX regression but, per the review's own analysis (which this verifier's grep of `state/keyboard.ts` and `TriageSurface.tsx` corroborates), does not affect any accept/reject/merge/defer/bulk reachability and does not threaten the no-promotion-without-triage guarantee. Both are pre-existing, already-documented review findings carried into this report, not new gaps.

### Human Verification Required

### 1. Live-agent half of Success Criterion 1

**Test:** Run `node scripts/uat/uat-10-agent-backlog.mjs --live` with a real `claude` binary available.
**Expected:** The per-criterion report marks Criterion 1 `observed` — a real agent, mid-session, chose to call `propose_item` and the call staged a pending row through the live MCP handler, with no promotion to canonical work.
**Why human:** This verifier was explicitly instructed not to run the `--live` arm (it spends real tokens). The offline arm and the structural source gates prove every reachable half of Criterion 1 that doesn't require an actual model decision — the one piece left is a live model choosing to call the tool, which only the live arm exercises.

### Gaps Summary

No gaps. All five ROADMAP success criteria have either full behavioral evidence (criteria 2-5, via directly-run named tests and the offline UAT arm) or the maximum evidence reachable without spending live tokens (criterion 1 — structural no-promotion proven, staging-through-the-real-wire proven by offline UAT, only the "a real model decides to call the tool" slice left for the live arm). This routes to `human_needed`, not `gaps_found`: nothing is missing, broken, or unwired — one slice of one criterion needs a deliberate, token-spending run that is outside this verification's scope by explicit instruction.

---

_Verified: 2026-10-02T12:35:00Z_
_Verifier: Claude (gsd-verifier)_
