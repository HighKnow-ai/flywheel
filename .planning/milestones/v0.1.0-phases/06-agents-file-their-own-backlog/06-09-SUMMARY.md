---
phase: 06-agents-file-their-own-backlog
plan: 09
subsystem: authoring
tags: [rust, sqlite, mcp, node, sidecar, uat-harness, bm25]

# Dependency graph
requires:
  - phase: 06-agents-file-their-own-backlog (plans 06-01 through 06-08)
    provides: "the full propose/stage/duplicate/limit/triage domain surface this plan's harness exercises end to end — propose_item, create_proposal_in_tx, merge/defer/bulk verbs, duplicate detection, the volume limit, and the triage command layer"
provides:
  - "scripts/uat/uat-10-agent-backlog.mjs: the phase-6 ship gate — --self-test (offline, no process), --offline (zero tokens, real wire functions + real domain functions), --live (one real model call, then the same walk)"
  - "packages/core/tests/bin/uat_authoring_ops.rs: seven new bridge subcommands (propose-item, merge-proposal, defer-proposal, reject-bulk, defer-bulk, list-deferred, limit-notices)"
  - "ClaudeCodeAdapter.startSession's onProposal wiring (Rule 1 bug fix) — an execution run's propose_item call now actually resolves instead of hanging forever"
  - "scripts/uat/run-all.sh: UAT 10 (offline) registered via run_item; UAT 10-live listed as MANUAL text, never reachable from an executor-callable path"
affects: []

actuals:
  tokens: 15120
  tasks: 3
  commits: 4

plan_head_before: 315a49a5b1926fea188f02ef798a6067266521fa

tech-stack:
  added: []
  patterns:
    - "A harness-served startPermissionServer instance (with its own onProposal callback shelling out to the bridge) proves the real buildProposeItemPayload/stageAuthoringProposal wire functions offline — the same technique propose-item-wire.test.mjs's own socket-level tests already use, applied here as a reusable offline arm rather than a one-off unit test."
    - "A proposal-staging bridge subcommand (propose-item) built from positional CLI args, reused identically by both the offline arm (synthetic payloads) and the live arm (fields read off a real captured proposal_created wire event) — one translation function (proposalPayloadToCliArgs), tested directly by --self-test, never two divergent copies."
    - "A separate, throwaway agent_run for one-off board seeding (the merge target task), kept apart from the main walk's run so seeding never spends a slot of the run-scoped 10-proposal budget being tested."

key-files:
  created:
    - scripts/uat/uat-10-agent-backlog.mjs
  modified:
    - packages/core/tests/bin/uat_authoring_ops.rs
    - packages/sidecar/src/claude-code-adapter.ts
    - scripts/uat/run-all.sh
    - .planning/phases/06-agents-file-their-own-backlog/06-VALIDATION.md

key-decisions:
  - "[Rule 1 - Bug, found while building the live arm] ClaudeCodeAdapter.startSession (the sidecar's \"spawn\" op — every task-execution run) called startPermissionServer with only 3 of its 5 callbacks (onRequest, onNotice, onSummary), leaving onProposal at its default no-op. An execution run's propose_item call connects the socket, writes its payload, and startPermissionServer holds the connection in pending waiting for answerProposalStaged — which nothing ever called, because the no-op onProposal never emitted the proposal_created event that would let anything answer it. The tool call would hang forever on a real run. startAuthoringSession already wires this correctly; the fix mirrors it exactly for the execution-run path (packages/sidecar/src/claude-code-adapter.ts). resolveProposalStaged and the authoring_proposal_answer op are both already generic over run kind, so no other wiring was needed. **This is the strongest evidence in the phase that building the scripted harness was the right call**: plan 06-01's tracer feedback gate was approved on automated evidence (proposal_channel.rs 6/6, cargo test --workspace 756/756) while this hang was already live in the shipped code — those suites could not have caught it because none of them spawn a real ClaudeCodeAdapter.startSession and drive a live socket round-trip; proposal_channel.rs calls apply_proposal_created directly at the DB layer, and propose-item-wire.test.mjs constructs its own startPermissionServer by hand in the test rather than going through startSession's real wiring. Nine rounds of green tests, one layer removed from where the defect actually lived."
  - "The seed task (the merge target) is staged and accepted through its own, separate agent_run — not the main run the whole walk uses — specifically so seeding never spends one of the main run's 10-proposal budget. The bridge offers no subcommand to create an agent_run under an externally-chosen id, and create_proposal_in_tx only cares that a real agent_runs row exists (never whether it carries an authoring_stage), so start-run's own minted id is reused directly as the sidecar's own spawn runId in --live."
  - "Empirical finding, while building the offline arm's near-duplicate check: bm25's score is a SUM over every matching query term, so a short title-only restatement measurably under-scores the pinned DUPLICATE_BM25_THRESHOLD (-21.0) even against a realistic 8-9 document corpus — measured directly: a 5-word title alone scored around -8.6 (not flagged), the identical title plus a shared multi-sentence body scored -53.8 (flagged). The near-duplicate now restates BOTH the first proposal's title AND its body verbatim-ish, matching the shape 06-04-SUMMARY.md's own pinned fixture used (title+body pairs, never title alone). Also confirmed: with fewer than ~7-8 documents in the corpus, IDF collapses toward zero regardless of word choice (measured: two near-identical 11-word titles in a two-document corpus scored around -0.00002) — the offline arm therefore stages 7 generic filler proposals BEFORE the first proposal and its near-duplicate, mirroring why 06-04-SUMMARY.md's own fixture used a 20-filler-row corpus for the identical reason."
  - "The offline arm never hand-writes a staged-proposal tool-result literal anywhere (enforced by a source gate: grep -c 'staged.*true' == 0). It builds the wire payload with the REAL buildProposeItemPayload and stages it through the REAL stageAuthoringProposal against a socket the script itself serves with the REAL startPermissionServer — the same functions packages/sidecar/test/propose-item-wire.test.mjs exercises directly — answering every held call by shelling out to the bridge's propose-item, which calls the SAME apply_proposal_created function commands::authoring::handle_inbound_proposal_created calls in production. This is the exact defect class 06-04-SUMMARY.md and this directory's own README.md document at length for Phase 5's fake-authoring-claude.mjs (twelve rounds of offline green coexisting with live red) — closed here by construction rather than by discipline."
  - "WINDOWS.md #19 and #21 are CLOSED (gsd_run windows fixed 19, 21) — see the Broken Windows Ledger section below for exactly what is and is not covered."

patterns-established: []

requirements-completed: [PROP-01, PROP-02, PROP-03, PROP-04, PROP-05, PROP-06, PROP-07]

coverage:
  - id: D1
    description: "An execution-run proposal (propose_item) lands pending, attributable to its run and its rationale, never auto-promoted — proven through the real wire and domain functions, not a constructed DB row"
    requirement: PROP-01
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-10-agent-backlog.mjs --offline (the whole walk, including the first proposal staged via the real buildProposeItemPayload/stageAuthoringProposal)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/proposal_channel.rs (6 tests, pre-existing, DB-layer)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every proposal lands in a distinct pending state and is never promoted except through explicit human triage (accept/reject/merge/defer)"
    requirement: PROP-02
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-10-agent-backlog.mjs --offline"
        status: pass
    human_judgment: false
  - id: D3
    description: "No code path promotes a proposed item to active work except explicit human triage — the source gate (plan 06-02) plus this plan's own walk, which never produces a canonical row except through the four named verbs"
    requirement: PROP-03
    verification:
      - kind: unit
        ref: "shell gate: grep -c 'INSERT INTO|UPDATE [a-z_]+ SET' over packages/core/tests/bin/uat_authoring_ops.rs (non-comment lines) == 0 — the bridge itself contains no SQL of its own"
        status: pass
    human_judgment: false
  - id: D4
    description: "A near-duplicate proposal is flagged with a resolved candidate id and score before any triage decision is made"
    requirement: PROP-04
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-10-agent-backlog.mjs --offline (near-duplicate stage: duplicateOf equals the first proposal's own id)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A chatty run's 11th proposal is refused loudly, naming the limit and pointing at report_summary, and exactly one derived limit notice exists for the run"
    requirement: PROP-05
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-10-agent-backlog.mjs --offline (11th-proposal refusal + limit-notices check)"
        status: pass
    human_judgment: false
  - id: D6
    description: "All four triage verbs (accept, reject, merge, defer) each produce their promised board outcome, driven through the real domain functions — accept mints a canonical row, reject marks terminal, merge mints a child issue leaving its target task row unchanged, defer mints nothing and is recallable via list-deferred"
    requirement: PROP-06
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-10-agent-backlog.mjs --offline (verb walk)"
        status: pass
    human_judgment: true
    rationale: "The VERB behaviour is fully proven by this script against the real domain functions. The 'dedicated view' half of PROP-06 — that these verbs are reachable from TriageSurface.tsx specifically — is proven separately by component tests (packages/desktop/src/triage/__tests__/*, plans 06-07/06-08) and is out of this script's own reach (it never renders anything); marked human_judgment true only because the one remaining purely-aesthetic question (06-VALIDATION.md's single Manual-Only Verification: does the view read as bold and modern) is still genuinely a human's call."
  - id: D7
    description: "Every proposal records which agent run produced it and what prompted it (rationale) — proven via a real read surface, not just a stored column"
    requirement: PROP-07
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-10-agent-backlog.mjs --offline (the deferred proposal's rationale round-trips through list-deferred)"
        status: pass
      - kind: integration
        ref: "packages/core/tests/proposal_channel.rs (run/rationale attribution, pre-existing)"
        status: pass
    human_judgment: false
  - id: D8
    description: "A real claude execution-run session's own decision to call propose_item, mid-session, observed live — the live-only half of PROP-01 / ROADMAP Phase 6 success criterion 1"
    verification: []
    human_judgment: true
    rationale: "Requires spending real tokens against a live, credentialed backend. Not executed this session, consistent with every other live arm this phase and prior phases have deferred for the identical reason (e.g. WINDOWS.md #16 for uat-08-socratic-authoring.mjs). A human runs `node scripts/uat/uat-10-agent-backlog.mjs --live` deliberately; `run-all.sh` lists only its command, as MANUAL text, never wired into an executor-callable path."
  - id: D9
    description: "ClaudeCodeAdapter.startSession's missing onProposal wiring, fixed — an execution run's propose_item call now actually resolves instead of hanging forever (Rule 1 bug, found while building this plan's own live arm)"
    verification:
      - kind: integration
        ref: "npm --prefix packages/sidecar test (215/215, no regressions)"
        status: pass
    human_judgment: false

duration: "~90 min of active work across two sessions, interrupted ~17h apart (commits span 2026-09-30T18:08 to 2026-10-01T11:44); see Task Commits for exact timestamps"
completed: 2026-10-01
status: complete
---

# Phase 6 Plan 9: The Scriptable Acceptance Run Summary

**`uat-10-agent-backlog.mjs` proves the whole propose→duplicate→limit→triage loop end to end through the real wire and domain functions (zero tokens in `--offline`), closes WINDOWS.md #19/#21, and found — along the way — a genuine production bug: an execution run's `propose_item` call could never actually resolve.**

## Performance

- **Duration:** ~90 min of active work, across two sessions interrupted roughly 17 hours apart (the coordinator confirmed the interruption was not a stop-for-a-problem). Commits span 2026-09-30T18:08:51+08:00 to 2026-10-01T11:44:22+08:00.
- **Tasks:** 3
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments

- Seven new `uat_authoring_ops` bridge subcommands (`propose-item`, `merge-proposal`, `defer-proposal`, `reject-bulk`, `defer-bulk`, `list-deferred`, `limit-notices`), each writing through the real domain or query function it names, verified by a source gate that the bridge contains no SQL of its own.
- **[Rule 1 — Bug] Fixed a genuine production defect found while building the live arm:** `ClaudeCodeAdapter.startSession` (the sidecar's `"spawn"` op, every task-execution run) never wired `startPermissionServer`'s `onProposal` callback — an execution run's real `propose_item` tool call would connect, write its payload, and then hang forever, because nothing ever emitted the `proposal_created` event that lets anything answer it. Fixed by mirroring `startAuthoringSession`'s own correct wiring. See Deviations below for the full finding, including which pre-existing green suites could not have caught it and why.
- `scripts/uat/uat-10-agent-backlog.mjs`: three modes (`--self-test`, `--offline`, `--live`). The offline arm drives the REAL `buildProposeItemPayload`/`stageAuthoringProposal` against a socket the script itself serves with the REAL `startPermissionServer`, answering every held call by shelling out to the bridge's `propose-item` — no fixture anywhere hand-writes a staged-proposal tool-result literal (enforced by a source gate). It walks: 7 generic filler proposals (bm25 needs a realistic corpus — see Deviations), the first proposal, a near-duplicate (asserts the real `duplicateOf`/`duplicateScore`), one more filler to reach the 10-proposal limit, an 11th that is refused (asserting the exact refusal text and a derived limit notice), and all four triage verbs (accept/reject/merge/defer), each asserted against real `board-counts`/`list-deferred` reads.
- `scripts/uat/run-all.sh`: `UAT 10` (the offline arm) registered via `run_item`, reporting a real PASS/FAIL/SKIP row; `UAT 10-live` listed as MANUAL text for a human to run deliberately — a source gate confirms the live arm is never wired into `run_item`.
- `.planning/phases/06-agents-file-their-own-backlog/06-VALIDATION.md`: all four Wave 0 Requirements now marked closed and attributed to the plan that closed them; a new "Phase 6 Ship Gate Result" section records this plan's actual green run.
- All three full suites re-run and green: `cargo test --workspace` (no failures), `npm --prefix packages/desktop test` (570/570), `npm --prefix packages/sidecar test` (215/215, including the `onProposal` fix).

## Task Commits

Each task was committed atomically:

1. **Task 1: The bridge subcommands for every new verb** — `6af1154` (feat, 2026-09-30T18:08:51+08:00)
2. **Task 2: `uat-10-agent-backlog.mjs` — the offline arm and `--self-test`**, plus the Rule-1 production bug fix it surfaced — `e2196e8` (fix, 2026-10-01T11:24:35+08:00), `a302533` (feat, 2026-10-01T11:42:18+08:00)
3. **Task 3: Register the item in the runner and record what stays manual** — `b86d6f9` (feat, 2026-10-01T11:44:22+08:00)

**Plan metadata:** commit follows this SUMMARY

_Note: TDD is not applicable to this plan._

## Files Created/Modified

- `scripts/uat/uat-10-agent-backlog.mjs` — new: the phase-6 acceptance script (872 lines), three modes
- `packages/core/tests/bin/uat_authoring_ops.rs` — seven new subcommands, extended usage block and module header
- `packages/sidecar/src/claude-code-adapter.ts` — `startSession`'s missing `onProposal` wiring (Rule 1 fix)
- `scripts/uat/run-all.sh` — `UAT 10` row (offline, via `run_item`) and the `UAT 10-live` MANUAL row
- `.planning/phases/06-agents-file-their-own-backlog/06-VALIDATION.md` — Wave 0 Requirements attributed to their closing plans; new "Phase 6 Ship Gate Result" section

## Decisions Made

See `key-decisions` in the frontmatter for full rationale. Summary:

1. **The Rule 1 production bug** (missing `onProposal` wiring) — the phase's strongest evidence that the scripted harness was worth building; see Deviations below.
2. **The seed task uses its own, separate `agent_run`** so seeding the merge target never spends a slot of the main walk's 10-proposal budget.
3. **The near-duplicate restates title AND body**, not title alone — bm25 needs the extra matching terms to cross the pinned threshold (measured empirically; see Deviations).
4. **The offline arm never hand-writes a tool-result literal** — it drives the real wire functions against a socket it serves itself.
5. **WINDOWS.md #19 and #21 are closed** — see the Broken Windows Ledger section.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ClaudeCodeAdapter.startSession` never wired `onProposal` — an execution run's `propose_item` call could never resolve**

- **Found during:** Task 2, while designing the `--live` arm's real session spawn (before writing any live-arm code — the gap was found by reading `claude-code-adapter.ts` to understand how a real `propose_item` call would be answered)
- **Issue:** `startPermissionServer(onRequest, onNotice, onSummary, onProposal?, onBoardRead?)`'s `onProposal` parameter defaults to a no-op. `ClaudeCodeAdapter.startAuthoringSession` passes all 5 callbacks; `ClaudeCodeAdapter.startSession` (the "spawn" op — every ordinary task-execution run, and the ONLY path `propose_item` is pre-approved on) passed only 3. A real execution run's `propose_item` tool call connects the socket, writes its payload, and `startPermissionServer` holds the connection in its `pending` map waiting for `answerProposalStaged` to be called — which nothing could ever call, because the no-op `onProposal` never emitted the `proposal_created` `AgentEvent` that anything downstream (the real app, or this plan's own UAT harness) needs in order to answer it. The tool call would hang forever on a genuinely live run.
- **Fix:** Added the missing 4th callback to `startSession`'s `startPermissionServer(...)` call, mirroring `startAuthoringSession`'s own identical wiring exactly (`normalizeProposalNotice` → `session.onEvent`). `resolveProposalStaged`/the `authoring_proposal_answer` op are both already generic over run kind (keyed by `liveSessions.get(runId)`, not by how the run was spawned), so no other production code needed to change.
- **Why this matters more than an ordinary bug fix:** plan 06-01's tracer feedback gate was approved on automated DB-level evidence (`proposal_channel.rs` 6/6 passing, `cargo test --workspace` 756/756 passing) — and both suites were green the entire time this hang was live in the shipped code. Neither suite could have caught it: `proposal_channel.rs` calls `apply_proposal_created` directly against a `Connection`, never through a spawned `ClaudeCodeAdapter.startSession`; `packages/sidecar/test/propose-item-wire.test.mjs` (06-05's own socket-level tests) constructs its own `startPermissionServer` call with all the right callbacks wired BY HAND inside the test, rather than going through `startSession`'s real production wiring. Nine rounds of green tests across two plans, every one of them one layer removed from the exact line that was broken. This is the concrete argument for why `/gsd:plan-phase`'s planner correctly scheduled a real, scripted, end-to-end acceptance run as this phase's ship gate instead of trusting the sum of its unit-level green checkmarks.
- **Files modified:** `packages/sidecar/src/claude-code-adapter.ts`
- **Verification:** `npm --prefix packages/sidecar run build` (clean), `npm --prefix packages/sidecar test` (215/215, no regressions — the fix only ADDS a previously-unreachable callback registration, touching no existing behaviour)
- **Committed in:** `e2196e8`

---

**Total deviations:** 1 auto-fixed (1 Rule 1 production bug, found and fixed while building this plan's own live arm). **Impact:** necessary for `--live` to be runnable at all; a scoped, additive fix (one new callback registration) with no regressions across the full sidecar suite. No scope creep — this is squarely the class of defect a scripted harness exists to catch, and it is now caught and fixed rather than merely documented as a finding.

## Issues Encountered

**bm25's score is corpus-size- and overlap-length-sensitive, in a way that is easy to under-estimate when writing a fixture by hand.** While building the offline arm's near-duplicate check, a straightforward "restate the title with different wording" fixture repeatedly scored nowhere near the pinned `DUPLICATE_BM25_THRESHOLD` (-21.0) — measured directly: a two-document corpus (first proposal + its near-duplicate alone) scored around -0.00002 (IDF collapses toward zero with too few documents, regardless of word choice); an 8-9 document corpus with a 5-word title-only restatement scored around -8.6 (still not flagged); the SAME title plus a shared, multi-sentence body scored -53.8 (flagged, comfortably). The fix — 7 generic filler proposals staged first, and the near-duplicate restating both title and body — mirrors exactly why `06-04-SUMMARY.md`'s own pinned fixture used a 20-filler-row corpus and title+body pairs rather than titles alone. Not a product defect: `DUPLICATE_BM25_THRESHOLD` and its own measured ranges in `query::search.rs` are unchanged by this finding; it is a property of how any bm25-based fixture must be built, now recorded here for the next person who writes one.

## TDD Gate Compliance

Not applicable — this plan carries no `tdd="true"` tasks.

## Authentication Gates

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Broken Windows Ledger

- **Entry #19 (06-01's tracer human-check: "triage lane shows staged proposal, rationale legible, accept mints a task") is now CLOSED** (`gsd_run windows fixed 19`). What closes it: the full propose→triage→accept loop is now proven end to end against the real domain functions by this plan's `--offline` arm (a staged proposal's rationale survives and is readable via `list-deferred`; accepting a proposal mints a real canonical row), and the UI's own ability to render that rationale legibly is proven separately by the passing component tests plan 06-07 added (`TriageSurface.tsx`'s rationale block, `triage-surface.test.tsx`). What stays open elsewhere, deliberately not re-recorded here: the single purely-aesthetic judgement — does the rendered view read as "bold and modern" — remains 06-VALIDATION.md's one Manual-Only Verification, unaffected by this closure.
- **Entry #21 (06-08's remaining live-app check: "launch the packaged app, open the triage surface via the board, confirm the four verbs are reachable/legible") is now CLOSED** (`gsd_run windows fixed 21`). What closes it: "reachable" is proven at the component level by `triage-routing.test.tsx` (06-08) and, now, functionally end to end by this plan's `--offline` arm driving all four verbs through the real domain functions against a real scratch board. What stays open elsewhere: the same single aesthetic-judgement Manual-Only item as #19 — this closure does not claim a human has looked at a rendered window, only that the mechanism the human would be looking at is proven to work.
- **No new entries added.** This plan's own live-arm gap (D8 above: a real model's decision to call `propose_item`, not run this session) is tracked through this SUMMARY's own `coverage` block (`human_judgment: true`) rather than a new WINDOWS.md entry — it is the SAME kind of deferred-live-arm gap WINDOWS.md #16 already tracks for `uat-08-socratic-authoring.mjs`, and `scripts/uat/README.md`'s own convention is to track that in the script's own documentation and the phase's SUMMARY, not duplicate it into a second ledger entry.

## Next Phase Readiness

- Phase 6 is now 9/9 plans executed. All seven requirements (PROP-01 through PROP-07) are satisfied by this plan's own completion (the shared-ID gate releases them here, as the last declaring plan).
- Ready for `/gsd-verify-work 6` and `/gsd-plan-phase 7`.
- **One genuinely open item, tracked honestly rather than silently claimed:** the live arm's own measurement of a real model's decision to call `propose_item` (D8 above) has not been run. `node scripts/uat/uat-10-agent-backlog.mjs --live` is ready for a human to run deliberately — `run-all.sh` lists its exact command as a MANUAL row.
- **One genuinely open item, structurally unrelated to this plan's own scope:** 06-VALIDATION.md's single remaining Manual-Only Verification (visual judgement of the triage view's look and feel) is unaffected by this plan and stays open for the same reason it always has — no script can assert "this reads as bold and modern."

---
*Phase: 06-agents-file-their-own-backlog*
*Completed: 2026-10-01*

## Self-Check: PASSED

- FOUND: scripts/uat/uat-10-agent-backlog.mjs
- FOUND: packages/core/tests/bin/uat_authoring_ops.rs (seven new subcommands)
- FOUND: packages/sidecar/src/claude-code-adapter.ts (onProposal wiring)
- FOUND: scripts/uat/run-all.sh (UAT 10 row + UAT 10-live MANUAL row)
- FOUND: .planning/phases/06-agents-file-their-own-backlog/06-VALIDATION.md (Wave 0 attributions + Ship Gate Result section)
- FOUND: 6af1154 (Task 1 commit)
- FOUND: e2196e8 (Rule 1 fix commit)
- FOUND: a302533 (Task 2 commit)
- FOUND: b86d6f9 (Task 3 commit)
- cargo build -p core --bin uat_authoring_ops: clean
- cargo test --workspace: all green (no failures)
- npm --prefix packages/sidecar test: 215/215 pass
- npm --prefix packages/desktop test: 570/570 pass
- node scripts/uat/uat-10-agent-backlog.mjs --self-test: PASS
- node scripts/uat/uat-10-agent-backlog.mjs --offline: PASS (run twice, deterministic both times)
- bash -n scripts/uat/run-all.sh: no syntax error
- bash scripts/uat/run-all.sh --no-build: table includes UAT 10 as PASS, UAT 10-live as MANUAL
- WINDOWS.md #19 and #21: status fixed
- All plan-level `<verification>` commands re-run and confirmed passing
