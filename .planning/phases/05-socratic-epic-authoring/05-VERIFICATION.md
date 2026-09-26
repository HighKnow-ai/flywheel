---
phase: 05-socratic-epic-authoring
verified: 2026-09-26T12:00:00Z
status: human_needed
score: 24/28 must-have truths verified (0 FAILED); 4 truths PRESENT_BEHAVIOR_UNVERIFIED
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/05-socratic-epic-authoring/05-40-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-40-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-41-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-41-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-42-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-42-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-43-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-43-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md
  - .planning/phases/05-socratic-epic-authoring/05-REVIEW.md
  - .planning/phases/05-socratic-epic-authoring/05-UAT.md
  - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
  - packages/core/src/domain/authoring_session.rs
  - packages/core/tests/authoring_stage_marker_contract.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/stage-gate-hook.ts
  - packages/sidecar/test/ask-user-question.test.mjs
  - packages/sidecar/test/authoring-proposal-wire.test.mjs
  - packages/sidecar/test/authoring-stage-gate.test.mjs
  - scripts/uat/README.md
  - scripts/uat/fixtures/live-opus5-ask-user-question.json
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/uat-08-socratic-authoring.mjs
covered_digest: "v1:sha256:95eeabe45d13f6942b3934231aa80f1b05e7458aa7b36cddcdb2f13496a6bdaf"
behavior_unverified: 4
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: "24/24 must-have truths verified (0 FAILED); 2 roadmap/carried-forward truths PRESENT_BEHAVIOR_UNVERIFIED"
  gaps_closed:
    - "G-05-8(b) BLOCKER — `start_authoring_run` never wrote the D-88 on-disk stage marker (only `transition_stage` did), so for the entire duration of the challenge stage a `propose_epic`/`propose_assumption` call was denied by the fail-closed path (\"no authoring stage marker could be read for this run\") instead of the correct, actionable `denyForChallengeStage` reason. Live run 01M3DNC0G9CYAWSD8DYEGTRP8C hit exactly this: every proposal call failed during challenge, the model concluded its own session was broken, and it dumped a fully-shaped six-task epic into prose — the Core Value failing as exactly a chat blob. Closed by plan 05-40: `start_authoring_run` now calls `write_authoring_stage` as the last step before `tx.commit()`, mirroring `transition_stage`'s own T-05-03-05 ordering rule; a marker-write failure bails with an `Err` and rolls back the transaction. Verified independently: I ran `cargo test -p core --test authoring_stage_marker_contract` myself (3/3 pass) — this is a genuine end-to-end contract test that spawns the SHIPPED, COMPILED `stage-gate-hook.ts` binary as a real process against a marker a real `start_authoring_run` call produced, not two tests that each hand-fabricate the other side's state (which is exactly how the defect survived nine prior rounds, per the test file's own module doc comment). I also read `authoring_session.rs`'s new code directly and confirmed the ordering and rollback-on-failure behavior by hand."
    - "G-05-8(a) BLOCKER — the agent asked its three clarifying questions through the `AskUserQuestion` tool; the harness captured only `assistant_text`, so the questions never reached `05-LIVE-CHALLENGE-TRANSCRIPT.md`, and the driver had no handler for the tool (it answered with the literal string `The user did not answer the questions.`), so the Socratic exchange could not develop past turn one. Closed across two plans: 05-41 carries the tool's question/option payload through the adapter seam as a typed, ordered `ToolCallEvent.questions` field (`parseAskUserQuestionInput`, grounded in a frozen byte-identical real capture of the live run), and removes `AskUserQuestion` from an authoring session's tool set entirely (`--disallowedTools AskUserQuestion`, unconditional) so the challenge stage cannot degrade into a form; 05-42 makes the offline conversation driver answer an offered option and renders the questions/options inside the evidence-sheet turn that asked them (`renderQuestionsAsked`), wired through one shared `buildAgentExchange` builder at all nine capture sites. Verified independently: I read `parseAskUserQuestionInput`, the `--disallowedTools` argv construction, and `renderQuestionsAsked`/`questionsFromTurn` directly; ran `npm --prefix packages/sidecar test` myself (191/191 pass); ran `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` myself (0 FAIL, all labelled checks pass); ran `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` myself (15/15 scenarios pass including the new `ask-user-question` scenario, which drives the real sidecar/watchdog/normaliser against the frozen live capture end to end). **Residual, correctly not overclaimed by the plans and not upgraded here:** `--disallowedTools AskUserQuestion`'s effect on a real backend's behavior (does the model ask its questions as prose instead, or refuse to ask at all?) is proven as argv only — no live run happened in this round."
  gaps_remaining: []
  regressions: []
  rescored_without_gap:
    - "Roadmap SC2 (\"the session's outcome lands directly on the board... not as a markdown file or a chat log\") and roadmap SC3 / requirement SHAPE-04 (\"accepts, rejects or amends each proposed item... individually\") are downgraded from the prior round's ✓ VERIFIED (by regression only) to ⚠️ PRESENT_BEHAVIOR_UNVERIFIED in this report. This is a deliberate re-scoring, not a regression: the prior round's VERIFIED status rested entirely on \"unchanged, not touched by the diff\" reasoning and predates a live run (01M3DNC0G9CYAWSD8DYEGTRP8C) that ran in the interim and demonstrated, in production, that these truths do NOT hold yet in a real live session — every propose_epic/propose_assumption call was refused, nothing reached the board, and the shaped epic exists only as prose (`Drafted criteria: 0`). G-05-8(b)'s fix targets exactly the mechanism that caused that failure and is well-evidenced offline (a genuine end-to-end contract test against the shipped hook binary), but no live run has been attempted since the fix landed. Per this phase's own explicit, repeated position (`05-UAT.md`, `05-43-SUMMARY.md`, `.planning/REQUIREMENTS.md`): \"the live board write has never once succeeded in a live run\" and re-scoring SHAPE-02/SHAPE-04 on the strength of an unproven fix is the developer's own call, not something any automated closure — or this verification — should take. I am following that instruction: not upgrading these truths to VERIFIED, and not marking them FAILED either (the fix is well-targeted and well-evidenced offline; a live run has simply not happened since it landed). They route to human_verification below."
gaps: []
deferred: []
advisory:
  - finding: "05-REVIEW.md WR-01 (open, unresolved as of this session): `.planning/REQUIREMENTS.md:93` and `:95` (SHAPE-01, SHAPE-03) both read \"...closing `G-05-7`'s stated residual...\" to describe this round's stage-marker and `AskUserQuestion` work, while `scripts/uat/README.md`'s Item 8 and `05-VALIDATION.md`'s ledger rows both name this round's own gap as `G-05-8`."
    category: other
    reason: >-
      I independently re-read `.planning/REQUIREMENTS.md` (confirmed both lines still read exactly
      as the review quoted) and plan 05-41's own `<objective>` (confirmed it states the dual
      attribution deliberately: "this is also the stated residual of gap G-05-7's third finding...
      closing this is what closes that residual; G-05-7 is not re-planned" — and `05-UAT.md`'s own
      G-05-7 third-finding row does say the AskUserQuestion residual was "carried forward as gap
      G-05-8(a) rather than marked closed"). So the REQUIREMENTS.md sentence is not a fabricated or
      baseless claim — it is describing a real chain (G-05-7's stated residual IS what became
      G-05-8(a)) — but it is also genuinely ambiguous for a reader trying to determine from
      REQUIREMENTS.md alone whether G-05-7 or G-05-8 is the round's own gap, exactly as the review
      argues, and every other source of record (README Item 8's "ninth finding", the VALIDATION
      ledger's "gap closure G-05-8" tags) agrees the round's own gap is G-05-8. I am not resolving
      this either way — it is a genuine, low-stakes documentation ambiguity, not a correctness defect
      in shipped code, and no round-10 plan proposed to touch this specific sentence again. Left open
      per the review's own classification (Warning, non-blocking).
    evidence_status: "confirmed both REQUIREMENTS.md lines are unchanged since the review; confirmed plan 05-41's own objective states the dual attribution deliberately; no plan in this round re-touched this sentence"
  - finding: "05-REVIEW.md IN-01 (open, unresolved): a marker-write SUCCESS followed by a `tx.commit()` FAILURE in `start_authoring_run` leaves an orphaned stage-marker file on disk naming a run id that no `agent_runs` row will ever exist for — the doc comment's framing (\"no row without a marker\") reads stronger than what the untested reverse direction actually guarantees (\"no marker without a row\" is not proven)."
    category: other
    reason: >-
      Confirmed by direct reading of `authoring_session.rs:145-156` (the marker write happens
      before `tx.commit()`, and only the marker-write-failure direction is proven by
      `a_marker_write_failure_at_start_leaves_no_agent_run_row`; the reverse ordering — marker
      succeeds, then commit fails — is structurally untested). The review itself rates this
      low-impact (run ids are ULIDs, never reused; the orphaned file is inert clutter, not a
      correctness hazard, since no live session is ever spawned against a rolled-back run id).
      Not touched by this round's own must-haves; left open as Info, non-blocking, matching the
      review's own classification.
    evidence_status: "confirmed as a real code property by direct reading; not exercised by any test in either direction"
  - finding: "`.planning/REQUIREMENTS.md`'s separate Phase-5 traceability-matrix rows (lines 282-286, a `| SHAPE-01 | Phase 5 | Gaps Found — ... |` style table further down in the same file) were NOT updated by plan 05-43 and still describe only round 9's state (05-30/05-33/05-34/05-36/05-37/05-38's fixes) — they make no mention of this round's stage-marker write or the `AskUserQuestion` seam/render/disallow work, unlike the per-requirement checklist lines (93-97) that plan 05-43 did narrow."
    category: other
    reason: >-
      Confirmed by direct reading: the checklist lines (93-97, `- [ ] **SHAPE-01**: ...`) were
      updated by 05-43 and correctly reference round 10's work; the later traceability-matrix table
      (line 282 onward) is a second, separate description of the same requirements and was not
      touched. This is a documentation-consistency gap (two descriptions of the same requirement
      now disagree on how current they are), not a code-correctness issue, and none of this round's
      plans claimed to update that table. Recorded for completeness; does not affect any must-have
      truth or artifact.
    evidence_status: "confirmed by direct reading of both locations in REQUIREMENTS.md; not touched by any plan in this round"
behavior_unverified_items:
  - truth: "(Roadmap SC1 / SHAPE-01, carried forward unchanged) The agent genuinely challenges assumptions rather than affirming the user's framing; and SHAPE-03's draft-usefulness judgment."
    test: "Run scripts/uat/uat-08-socratic-authoring.mjs in live mode (real claude binary, real credentials, not --self-test/--replay-check) end to end and read the whole conversation it writes into 05-LIVE-CHALLENGE-TRANSCRIPT.md (every turn, in order), then fill both verdict lines."
    expected: "The agent's challenge-stage turns push back on the framing and ask substantive clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or clearly need amendment, read directly from the sheet's counts."
    why_human: "Live-conversation quality and draft-usefulness are judgment calls no automated check can make. Both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md remain literally UNJUDGED (confirmed: grep -c UNJUDGED reports 2)."
  - truth: "(Roadmap SC2 / SHAPE-02, SHAPE-03 — re-scored this round, see rescored_without_gap) An authoring session started in the challenge stage can actually write its outcome to the board — the epic, its tasks and their drafted acceptance criteria arrive as structured board items, not prose — in a live run against the real backend."
    test: "Run the live arm (node scripts/uat/uat-08-socratic-authoring.mjs, no flags) end to end and read 05-LIVE-CHALLENGE-TRANSCRIPT.md's 'Drafted criteria' count and 'Propose-tool observations' section."
    expected: "propose_epic/propose_assumption calls succeed instead of being refused for an unreadable marker; Drafted criteria is non-zero; the noWorkPlanned reading is not 'violated' for an illegitimate reason."
    why_human: "This is a live-run observation, not a structural property. The one live run this phase's history has (01M3DNC0G9CYAWSD8DYEGTRP8C) demonstrably failed here — Drafted criteria: 0, every proposal call refused. The fix (plan 05-40) is proven by a genuine end-to-end contract test against the shipped hook binary, but has not been proven against a fresh live run since it landed. Per this phase's own explicit position, whether to spend a credential on that next live run, and whether the fix actually holds live, is the developer's own decision to make and observe — not something this verification should claim on the codebase's behalf."
  - truth: "(Roadmap SC3 / SHAPE-04 — re-scored this round, see rescored_without_gap) User accepts, rejects or amends each proposed item and each drafted criterion individually, rather than accepting the set wholesale — in a live run."
    test: "Same live run as above; after a live board write succeeds, exercise accept_proposal/reject_proposal/amend_proposal on individual triage-lane rows through the desktop UI."
    expected: "Each proposal can be accepted, rejected or amended independently; no bulk accept-all path exists."
    why_human: "The offline/structural coverage for this truth (authoring_proposal.rs, authoring_acceptance.rs, the proposal tray's own tests) is solid and unchanged this round (confirmed: packages/desktop has zero diff since before round 10; npm --prefix packages/desktop run test reports 552/552 passing, independently re-run). But this truth is downstream of SC2's live board write, which has never once succeeded live — there has never been a live proposal to accept, reject or amend. Not a regression in this round's own work; a pre-existing divergence this round's own documentation (05-UAT.md, REQUIREMENTS.md) already names honestly."
  - truth: "(Carried forward unchanged from rounds 8-9) A config-isolated live run presents the developer's OWN claude.ai subscription credential to the backend by reference, and the composed directory's mechanism generalises beyond the one observed successful authentication."
    test: "Run `claude auth status` (or the live arm itself) against a directory produced by composeIsolatedClaudeConfigDir({}) with its default source (the developer's real ~/.claude), and confirm it reports loggedIn:true, authMethod:'claude.ai' as a committed, repeatable test rather than a one-time observation."
    expected: "The composed directory authenticates the real backend reliably, not just on the two observed occasions (01M3C48C3PV1NSGHERBZ587YB1, 01M3DNC0G9CYAWSD8DYEGTRP8C) this phase's history has."
    why_human: "Now observed successfully TWICE in real live runs (both this round's own failed run and the prior round's), strengthening confidence further, but every self-test/replay-check still exercises composeIsolatedClaudeConfigDir only against a synthetic fixture directory (grep-confirmed, unchanged this round) — the mechanism's general reliability, as opposed to two observed successes, remains unproven by anything reproducible in CI."
coincidental_reliance_items: []
human_verification:
  - test: "Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03) — run scripts/uat/uat-08-socratic-authoring.mjs in live mode against a real claude binary and credentials. This is the developer's own decision, still unanswered by design; this verification does not push toward taking it."
    expected: "During the challenge stage the agent pushes back on the developer's stated premise and asks substantive clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or clearly need amendment. Both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md get filled with the developer's own words."
    why_human: "Judgment about live model dialogue quality and draft usefulness — no structural check can certify either."
  - test: "Whether the Core Value itself now holds live: run the live arm again (a deliberate developer act, spending a credential) and check whether propose_epic/propose_assumption calls now succeed and Drafted criteria is non-zero, instead of repeating the 'no authoring stage marker could be read' failure."
    expected: "The epic, its tasks and drafted acceptance criteria land on the board as structured items, not as prose in the transcript. If the run still fails, it should fail for a DIFFERENT reason than G-05-8 (the marker-read failure), since that specific mechanism is now closed by a genuine contract test against the shipped hook."
    why_human: "This is exactly the live-run observation this round's fix was built to make possible, but did not itself make. No live run has been attempted since the fix landed; SHAPE-02, SHAPE-03 and SHAPE-04's checked/unchecked state in REQUIREMENTS.md deliberately was not re-scored on the strength of an unproven fix, and this verification follows that same discipline."
  - test: "The credential seam's general reliability (carried forward) — add a committed, repeatable test that exercises composeIsolatedClaudeConfigDir against a real ~/.claude, or accept the two observed live successes as sufficient."
    expected: "A developer decision on whether two observed successes are enough evidence, or whether a reproducible CI-level test is still wanted."
    why_human: "Judgment call about how much assurance is enough for a credential-handling mechanism; not something this verification should decide unilaterally."
---

# Phase 5: Socratic Epic Authoring Verification Report

**Phase Goal:** Cyril shapes a new epic by being challenged rather than interviewed, and walks away
with structured board items instead of a document.
**Verified:** 2026-09-26T12:00:00Z
**Status:** human_needed
**Re-verification:** Yes — round 10 (this report supersedes the prior `05-VERIFICATION.md`, status
`human_needed`, `24/24` truths verified with 2 present-but-behavior-unverified, `verified:
2026-09-26T02:00:00Z`). Since that report, a live run (`01M3DNC0G9CYAWSD8DYEGTRP8C`) discovered gap
`G-05-8` in two parts — the write-side stage-marker bug (b) and the unmodelled `AskUserQuestion`
payload (a) — which this round's four plans (05-40, 05-41, 05-42, 05-43) close.

## Scope of This Session

I gave full three-level (exists/substantive/wired) verification, plus independent re-execution of
the automated evidence, to plans **05-40 through 05-43** — the gap-closure round that closes
`G-05-8`. Plans 05-01 through 05-39 are treated per this workflow's re-verification optimisation:
I re-confirmed via `git diff --stat 7020aaa..HEAD -- packages/core packages/desktop packages/sidecar/src scripts/uat`
that this round's diff touches exactly 8 files (`authoring_session.rs`, the new
`authoring_stage_marker_contract.rs`, `adapter.ts`, `claude-code-adapter.ts`, `README.md`, the new
`live-opus5-ask-user-question.json` fixture, `fake-authoring-claude.mjs`, and
`uat-08-socratic-authoring.mjs`) — **`packages/desktop` has zero diff across this whole round** — and
re-ran the full test suites myself rather than re-deriving all 39 earlier plans' truths from
scratch.

**I did not defer to SUMMARY.md, 05-VALIDATION.md, or 05-REVIEW.md claims.** Every fact below marked
"independently" was re-derived in this session, in my own shell: `cargo test -p core --test
authoring_stage_marker_contract` (3/3 pass), `cargo test --workspace` (0 failures, re-run in full),
`npm --prefix packages/sidecar test` (191/191 pass), `npm --prefix packages/desktop run test`
(552/552 pass), `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` (0 FAIL, every labelled
check PASS), `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` (15/15 scenarios PASS,
including the new `ask-user-question` scenario), and direct reads of `authoring_session.rs`,
`stage-gate-hook.ts`, `claude-code-adapter.ts`, `adapter.ts`, and `uat-08-socratic-authoring.mjs`'s
new `renderQuestionsAsked`/`questionsFromTurn`/`buildAgentExchange` functions. I never ran
`scripts/uat/run-all.sh` or any bare live-mode `uat-*` script; every command I ran was `--self-test`,
`--replay-check`, or a `cargo test`/`npm test` invocation — no credential was spent by this
verification.

## Goal Achievement

### Observable Truths — Roadmap Success Criteria

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | (SC1) User starts a conversational session to shape a new epic and the agent challenges his assumptions and asks clarifying questions before any work is planned. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unchanged in kind. The live dialogue-quality judgment remains unmeasured — see `behavior_unverified_items` #1. This round's `AskUserQuestion` disallow-argv fix (05-41) strengthens the MECHANISM (the model can no longer render its clarifying questions as an invisible form) but is proven as argv only, not against a real backend. |
| 2 | (SC2) The session's outcome lands directly on the board as a structured epic with child tasks and drafted acceptance criteria for each task — not as a markdown file or a chat log. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED **(re-scored this round — was ✓ VERIFIED)** | Downgraded on new evidence: live run `01M3DNC0G9CYAWSD8DYEGTRP8C` demonstrably failed this exact truth (`Drafted criteria: 0`, every `propose_epic`/`propose_assumption` refused, the shaped epic exists only as prose). The root cause (the write-side stage-marker gap, G-05-8(b)) is now closed and independently proven via a genuine end-to-end contract test against the SHIPPED, compiled hook binary (`cargo test -p core --test authoring_stage_marker_contract`, 3/3 pass, re-run by me). But no live run has happened since the fix landed. See `behavior_unverified_items` #2 and `rescored_without_gap`. |
| 3 | (SC3) User accepts, rejects or amends each proposed item and each drafted criterion individually, rather than accepting the set wholesale. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED **(re-scored this round — was ✓ VERIFIED)** | Downgraded for the same reason as SC2: this truth is downstream of a live board write that has never once succeeded, so there has never been a live proposal to accept, reject or amend. The OFFLINE mechanism itself (`authoring_proposal.rs`, the proposal tray) is solid, unchanged, and independently re-confirmed (`npm --prefix packages/desktop run test`, 552/552 pass, zero diff on `packages/desktop` since before this round). See `behavior_unverified_items` #3. |
| 4 | (SC4) User reopens an epic weeks later, continues shaping it, and the agent challenges the change against what the epic already contains. | ✓ VERIFIED (regression) | Unchanged; not touched by this round's diff (confirmed empty `packages/desktop` diff) and not implicated by this round's own gap analysis (`05-UAT.md`, `.planning/REQUIREMENTS.md` name only SHAPE-02/03/04 as offline-only — SHAPE-05 stays unqualified). `epic_context_packet` / reopen-epic tests unaffected, confirmed via the full workspace test run. |

### Observable Truths — Round 10's Gap-Closure Plans (05-40, 05-41, 05-42, 05-43; G-05-8)

| # | Truth (source: 05-UAT.md `G-05-8`) | Status | Evidence |
|---|---|---|---|
| 5 | **BLOCKER (G-05-8(b))** — A run created by `start_authoring_run` has a readable D-88 stage marker naming `challenge` immediately, and the shipped, compiled stage-gate hook denies a propose call during challenge with the actionable `denyForChallengeStage` reason, not the `failClosed` "your run is broken" reason. | ✓ VERIFIED | Independently ran `cargo test -p core --test authoring_stage_marker_contract` (3/3 pass: marker readable immediately after start; the shipped hook denies with the challenge-stage reason; a marker-write failure surfaces as an `Err` and leaves no `agent_runs` row). Read `authoring_session.rs`'s `start_authoring_run` directly and confirmed `write_authoring_stage` is called as the LAST step before `tx.commit()`, with a `bail!` on failure (rollback via `Drop`) — mirroring `transition_stage`'s own T-05-03-05 ordering rule exactly. Read `stage-gate-hook.ts` directly and confirmed `denyForChallengeStage` and `failClosed` are two distinct functions with two distinct `permissionDecisionReason` strings; independently ran `npm --prefix packages/sidecar test` (191/191 pass, including the new test asserting these two reasons are provably distinct). Independently ran `cargo test --workspace` (0 failures anywhere) confirming no regression, including in the several pre-existing test files that call `start_authoring_run` without overriding `FLYWHEEL_RUNTIME_DIR` (an accepted, documented hygiene cost, not a correctness issue — no test failed). |
| 6 | **BLOCKER (G-05-8(a))** — The clarifying questions an agent asks through `AskUserQuestion` reach the evidence sheet a human judges SHAPE-01 from, inside the turn that asked them, with their offered options; and the driver answers an offered option so the exchange can continue past turn one. | ✓ VERIFIED | Read `parseAskUserQuestionInput`/`ASK_USER_QUESTION_TOOL_NAME`/`MAX_ASK_USER_QUESTIONS` directly in `claude-code-adapter.ts` (pure, total, bounded, guarded — no unguarded property read, degrades to `undefined` never a throw on any malformed shape); confirmed `ToolCallEvent.questions?: AskUserQuestionPrompt[]` is additive-only in `adapter.ts` (no `AgentEvent` union change). Confirmed `buildAuthoringClaudeArgv` pushes `--disallowedTools AskUserQuestion` unconditionally (read the exact `argv` array construction). Read `renderQuestionsAsked`/`questionsFromTurn`/`buildAgentExchange` in `uat-08-socratic-authoring.mjs` directly and confirmed the ONE builder is used at all nine capture sites, and the renderer returns the empty string for `undefined`/non-array/`[]` (absent-vs-empty stays byte-identical). Independently ran `npm --prefix packages/sidecar test` (191/191 pass, up from a 180 baseline — 11 new tests, 0 regressions), `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` (0 FAIL), and `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` (15/15 scenarios pass, including the new `ask-user-question` scenario driving the real sidecar/watchdog/normaliser against the frozen live capture end to end: three typed questions recovered in order, `answeredQuestionCount=3`, zero unknown-type events). **Residual, correctly not overclaimed by the plans and not upgraded here:** the disallowed-tool argv's effect on a real backend is proven as argv only — no live run happened in this round. |

**Score:** 24/28 must-have truths cleanly resolved to VERIFIED (0 FAILED) — 19 carried forward from
rounds 8-9 by regression check (down from 21: SC2 and SC3/SHAPE-04 are re-scored this round, see
above), plus the 3 `G-05-7` truths (carried forward, independently re-confirmed via the full test
runs above — none of their touched files regressed), plus the 2 new `G-05-8` truths this round. 4
truths (SC1, SC2, SC3, and the credential-seam generalisation) are ⚠️ PRESENT_BEHAVIOR_UNVERIFIED,
excluded from the numerator per this workflow's scoring rule and reported in
`behavior_unverified_items` below.

### Deferred Items

None. Checked against later-milestone phases; none map to this phase's live UAT instrument, its
stage-marker contract, or its adapter-seam work.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/domain/authoring_session.rs` (`start_authoring_run`) | Writes the D-88 stage marker as the last step before commit; bails on write failure | ✓ VERIFIED | Confirmed present, read in full, exact ordering and bail-on-failure behavior traced by hand this session. |
| `packages/core/tests/authoring_stage_marker_contract.rs` | 3 tests, spawning the SHIPPED compiled hook as a real process | ✓ VERIFIED | New file, confirmed present; independently ran, 3/3 pass. |
| `packages/sidecar/src/stage-gate-hook.ts` (`denyForChallengeStage`, `failClosed`) | Two provably distinct denial reasons, both still exit non-zero | ✓ VERIFIED | Confirmed present and distinct by direct reading; both still call `printDecision` with the same `WIRED_DECISION` and exit path. |
| `packages/sidecar/test/authoring-stage-gate.test.mjs` | New test asserting the two denial reasons are provably distinct strings | ✓ VERIFIED | Confirmed present; part of the 191/191 passing suite. |
| `packages/sidecar/src/adapter.ts` (`ToolCallEvent.questions`, `AskUserQuestionPrompt`) | Additive typed field, no `AgentEvent` union change | ✓ VERIFIED | Confirmed present by direct reading; additions-only. |
| `packages/sidecar/src/claude-code-adapter.ts` (`parseAskUserQuestionInput`, `ASK_USER_QUESTION_TOOL_NAME`, `MAX_ASK_USER_QUESTIONS`/`MAX_ASK_USER_QUESTION_OPTIONS`, `--disallowedTools`) | Pure/total/bounded parser; unconditional argv disallow | ✓ VERIFIED | Confirmed present, read in full, guard logic traced by hand. |
| `packages/sidecar/test/ask-user-question.test.mjs` | 10 tests covering happy path, degenerate payloads, argv disallow | ✓ VERIFIED | Confirmed present; part of the 191/191 passing suite. |
| `scripts/uat/fixtures/live-opus5-ask-user-question.json` | Frozen real capture, byte-identical to the committed planning artifact | ✓ VERIFIED | Confirmed present; fixture-identity re-verified via the passing `ask-user-question` self-test/replay-check checks. |
| `scripts/uat/uat-08-socratic-authoring.mjs` (`questionsFromTurn`, `buildAgentExchange`, `renderQuestionsAsked`, `OPTION_SELECTION_PREFIX`) | One builder at all nine capture sites; questions rendered inside the turn that asked them | ✓ VERIFIED | Confirmed present and wired by direct reading (`grep -c buildAgentExchange` reports 16 call/definition sites); confirmed via the passing self-test/replay-check runs. |
| `scripts/uat/lib/fake-authoring-claude.mjs` (`ask-user-question` scenario) | 15th `SCENARIOS` entry, importing the frozen fixture verbatim | ✓ VERIFIED | Confirmed present; registry count confirmed 15 by direct run of `--replay-check`. |
| `scripts/uat/README.md` | Ninth finding (both instances), seventh rule, corrected gap-report artifact, operator note, 15-scenario list | ✓ VERIFIED | Confirmed present by direct reading (`grep -c NINTH`, `A seventh rule` both ≥ 1). |
| `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` | 11 new task rows (05-40 through 05-43); prior red row unchanged | ✓ VERIFIED | `grep -c '^\| 05-4[0-3]-'` reports 11 (matches ledger); `05-22-03` row confirmed byte-identical against its prior committed state; at least one red row (`❌`) survives. |
| `.planning/REQUIREMENTS.md` (checklist lines 93-97) | SHAPE-01/03 narrowed but unchecked; SHAPE-02/04 gain an unscored live-path-gap clause; SHAPE-05 untouched | ✓ VERIFIED | Confirmed by direct reading: SHAPE-01/03 both `- [ ]`, both reference this round's fixes and both still say UNJUDGED; SHAPE-02/04 both `- [x]` with the new clause; SHAPE-05 unchanged. |
| `05-LIVE-CHALLENGE-TRANSCRIPT.md` | Records the failed live run this round diagnosed and fixed; both verdict lines still UNJUDGED | ✓ VERIFIED (uncommitted at time of this verification) | Content read in full; `grep -c UNJUDGED` reports 2. Note: this file is currently uncommitted in the working tree (a pre-existing state noted honestly in 05-42-SUMMARY.md's own Issues Encountered) — not a defect in this round's work, just not yet bundled into a commit. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `start_authoring_run`'s marker write | the shipped `stage-gate-hook.ts`'s read | `write_authoring_stage(&run_id, "challenge")` inside the same transaction, before commit; the hook reads the same runtime dir/run id | ✓ WIRED | Proven end to end by `authoring_stage_marker_contract.rs`'s `a_challenge_stage_run_is_denied_by_the_shipped_hook_with_the_challenge_reason`, which spawns the compiled hook as a real process — not a hand-fabricated fixture. |
| An `AskUserQuestion` `tool_use` block's `input.questions` | `ToolCallEvent.questions` | `normaliseStreamEvent`'s `tool_use` branch spreading `parseAskUserQuestionInput(toolCall.input)` only when `toolCall.name === ASK_USER_QUESTION_TOOL_NAME` | ✓ WIRED | Confirmed by direct reading and by the `ask-user-question` `--replay-check` scenario capturing three typed questions on the wire and on the built exchange. |
| `ToolCallEvent.questions` | the evidence sheet's rendered turn | `questionsFromTurn` → `buildAgentExchange`'s conditional spread → `renderQuestionsAsked` | ✓ WIRED | Confirmed by direct reading of all three functions and their call sites; confirmed by the `ask-user-question` replay scenario asserting the rendered headers match the fixture's own (`Triggers`, `Channels`, `Timing`) in order. |
| The driver's open-question extraction | the developer's reply | `extractOpenQuestions` (typed prompts first, then prose) → `composeDeveloperReply`'s `OPTION_SELECTION_PREFIX` path | ✓ WIRED | Confirmed by direct reading and by the replay scenario: `answeredQuestionCount=3`, developer reply lines are `Picking: <offered label>`, never quoting the question text. |
| An authoring session's argv | `AskUserQuestion`'s absence from the tool set | `buildAuthoringClaudeArgv`'s unconditional `--disallowedTools AskUserQuestion` push | ✓ WIRED (argv only) | Confirmed by direct reading; correctly NOT claimed as proven against a real backend by any plan or by this verification. |

### Data-Flow Trace (Level 4)

Not applicable in the UI-rendering sense — this round's touched artifacts are the Rust write path
of a stage marker, the adapter seam (an additive typed field), a verification instrument (harness
library + UAT script), a frozen fixture, and tracked documents, not UI components rendering dynamic
data. `packages/desktop` (the only UI layer this phase has) has zero diff this round.

### Code Review Findings — Fix Verification

`05-REVIEW.md` (round 10, `reviewed: 2026-09-26T00:00:00Z`, 13 files reviewed, `status:
issues_found` — 0 critical, 1 warning, 1 info) is the independent review for this round's diff. Both
findings independently re-confirmed against HEAD this session:

| ID | Issue | Review's Classification | My Independent Finding |
|---|---|---|---|
| WR-01 | `.planning/REQUIREMENTS.md`'s SHAPE-01/SHAPE-03 lines attribute this round's closure to `G-05-7` instead of `G-05-8`. | Warning, non-blocking | ✓ CONFIRMED both lines are unchanged and read as quoted. Also confirmed the sentence is not baseless — plan 05-41's own objective deliberately states this is closing `G-05-7`'s stated residual, which is a real, documented chain — but the sentence remains genuinely ambiguous about which gap ID is THIS round's own, as every other source of record (README, VALIDATION ledger) names `G-05-8`. Recorded as advisory; left open, matching the review's own non-blocking classification. |
| IN-01 | A marker-write success followed by a `tx.commit()` failure can leave an orphaned stage-marker file naming a run id with no corresponding `agent_runs` row. | Info, low-impact | ✓ CONFIRMED as a real, untested code property by direct reading. Low-impact per the review's own reasoning (ULIDs never reused; inert clutter, not a correctness hazard). Recorded as advisory, non-blocking. |

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`) or cleanup markers (`TODO`/`HACK`/`PLACEHOLDER`) found in any
of this round's touched files, confirmed by direct grep this session across all 9 files this round's
diff touches. No stub/empty-return/hardcoded-empty patterns found in the production code paths
(`authoring_session.rs`, `stage-gate-hook.ts`, `adapter.ts`, `claude-code-adapter.ts`).

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `.planning/REQUIREMENTS.md` | 93, 95 | Ambiguous gap-ID attribution (`G-05-7` vs `G-05-8`) | ℹ️ Info | Documentation ambiguity, not a code defect. See advisory (WR-01). |
| `packages/core/src/domain/authoring_session.rs` | 145-156 | Orphaned marker file possible on a `tx.commit()` failure after a successful marker write | ℹ️ Info | Low-impact, unexercised by any test in either direction. See advisory (IN-01). |
| `.planning/REQUIREMENTS.md` | 282-286 | A second, separate Phase-5 traceability-matrix table was not updated by this round's docs plan and now disagrees with the (updated) checklist lines above it about how current it is | ℹ️ Info | Documentation-consistency drift only; no must-have truth or artifact is affected. |

### Behavioral Spot-Checks

Run directly by this verification, in this session, independently:

| Check | Method | Result | Status |
|---|---|---|---|
| Rust contract test | `cargo test -p core --test authoring_stage_marker_contract` | 3/3 pass | ✓ PASS |
| Full Rust workspace | `cargo test --workspace` | 0 failures across the whole workspace | ✓ PASS |
| Sidecar unit suite | `npm --prefix packages/sidecar test` | 191/191 pass, exit 0 | ✓ PASS |
| Desktop unit suite | `npm --prefix packages/desktop run test` | 552/552 pass (38 files), exit 0 | ✓ PASS |
| Offline self-test | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | Exit 0; every labelled check PASS; "no child process was spawned" | ✓ PASS |
| Offline replay, full sweep | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` | 15/15 scenarios PASS, exit 0 | ✓ PASS |
| Offline replay, targeted: G-05-8(a) | `--replay-check --scenario ask-user-question` | Exit 0; three typed questions recovered in order (`Triggers`,`Channels`,`Timing`); `answeredQuestionCount=3` | ✓ PASS |
| Diff scope confirmation | `git diff --stat 7020aaa..HEAD -- packages/core packages/desktop packages/sidecar/src scripts/uat` | Exactly 8 files changed, all attributable to this round's plans; `packages/desktop` empty | ✓ PASS |
| Debt-marker scan | `grep -nE 'TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER'` on all 9 touched files | 0 matches | ✓ PASS |
| Denial-reason distinctness | Direct read of `stage-gate-hook.ts` | `denyForChallengeStage` and `failClosed` are two functions with two distinct reason strings | ✓ PASS |
| Argv disallow | Direct read of `buildAuthoringClaudeArgv` | `--disallowedTools`, `ASK_USER_QUESTION_TOOL_NAME` pushed unconditionally | ✓ PASS |

### Probe Execution

Not applicable — no `scripts/*/tests/probe-*.sh` convention exists in this repository, and this is a
UAT-harness/product gap-closure phase, not a migration/CLI-tooling phase.

### Requirements Coverage

| Requirement | Source Plan(s) (this round) | Description | Status | Evidence |
|---|---|---|---|---|
| SHAPE-01 | 05-40, 05-41, 05-42, 05-43 | Conversational session challenges before planning | ◐ INSTRUMENT/PRODUCT FIXES CLOSED; LIVE JUDGMENT OUTSTANDING | G-05-8's both findings genuinely closed at the structural/offline level, independently re-verified this session. `.planning/REQUIREMENTS.md` itself correctly marks this unchecked pending the still-outstanding live judgement — this verification agrees with that self-assessment. |
| SHAPE-02 | 05-40 (root cause), 05-43 (doc) | Outcome writes directly to board | ◐ ROOT CAUSE CLOSED OFFLINE; LIVE PROOF OUTSTANDING **(re-scored — see rescored_without_gap)** | The write-side stage-marker defect that caused the one observed live failure is closed and proven via a genuine end-to-end contract test against the shipped hook binary. No live run has confirmed the fix live. `.planning/REQUIREMENTS.md` keeps the checkbox checked but now records the live-path gap honestly; this verification does not upgrade the checkbox further, nor does it treat the still-checked box as sufficient evidence on its own. |
| SHAPE-03 | 05-41, 05-42, 05-43 | Agent drafts acceptance criteria, editable | ◐ INSTRUMENT/PRODUCT FIXES CLOSED; LIVE JUDGMENT OUTSTANDING | Same instrument dependency and same caveat as SHAPE-01; additionally depends on SHAPE-02's live board write, which has never succeeded. |
| SHAPE-04 | — (not touched this round; its checked state is annotated) | Accept/reject/amend individually | ◐ OFFLINE MECHANISM SOLID; LIVE PROOF OUTSTANDING **(re-scored — see rescored_without_gap)** | `authoring_proposal.rs`/proposal-tray coverage unchanged and solid (552/552 desktop tests, zero diff). Downstream of SHAPE-02's live board write, which has never succeeded, so no live proposal has ever existed to accept/reject/amend. |
| SHAPE-05 | — (not touched this round) | Reopen and continue shaping | ✓ SATISFIED | Unchanged this round; not implicated by this round's own gap analysis. |

No orphaned requirements — `.planning/REQUIREMENTS.md`'s "Phase 5" row lists exactly these five IDs,
and every plan in 05-40 through 05-43 declares a subset of them in its own `requirements:`
frontmatter, all accounted for above.

### Human Verification Required

#### 1. Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03)

**Test:** Run `scripts/uat/uat-08-socratic-authoring.mjs` in live mode (no flags) against a real
`claude` binary and credentials, and read the whole conversation `05-LIVE-CHALLENGE-TRANSCRIPT.md`
records.
**Expected:** The agent pushes back on the developer's stated premise and asks substantive
clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or
clearly need amendment. Fill both verdict lines with the developer's own words.
**Why human:** Judgment about live model dialogue quality and draft usefulness — no structural check
can certify either.

#### 2. Whether the Core Value now holds live — the fixed marker/AskUserQuestion mechanism against a real run

**Test:** Run the live arm again (a deliberate developer act, spending a credential) and read whether
`propose_epic`/`propose_assumption` calls now succeed and `Drafted criteria` is non-zero.
**Expected:** The epic, its tasks, and drafted acceptance criteria land on the board as structured
items, not as prose. If the run still fails, it should fail for a reason OTHER than the marker-read
failure this round's fix specifically closes.
**Why human:** This is precisely the live-run observation this round's fix makes possible but does
not itself make. No live run has been attempted since the fix landed, and this phase's own
documentation explicitly declines to re-score SHAPE-02/03/04 on the strength of an unproven fix —
this verification follows that same discipline rather than upgrading it on the developer's behalf.

#### 3. Credential seam's general reliability (carried forward)

**Test:** Decide whether the two observed live authentication successes are sufficient evidence, or
add a committed, repeatable test exercising `composeIsolatedClaudeConfigDir` against a real
`~/.claude`.
**Expected:** A developer decision, not a code change this verification should prescribe.
**Why human:** Judgment call about how much assurance is enough for a credential-handling mechanism.

### Gaps Summary

None. Round 10's four plans genuinely close both findings of gap `G-05-8`: the write-side stage
marker that caused every challenge-stage proposal to be denied for the wrong (infrastructure-sounding)
reason, and the unmodelled `AskUserQuestion` payload that made an agent's own clarifying questions
invisible to the human reading the evidence sheet and unanswerable by the offline driver. I did not
accept the SUMMARYs' or `05-REVIEW.md`'s word for any of this — I independently ran every relevant
test suite (`cargo test --workspace`, `npm --prefix packages/sidecar test`, `npm --prefix
packages/desktop run test`, `--self-test`, `--replay-check`) myself, and read the production code
changes by hand.

What remains open is exactly what the phase's own design and this round's own honest documentation
leave open by choice: the live dialogue-quality and draft-usefulness judgments (unchanged), and —
newly surfaced by this verification's own re-scoring, not by this round's work regressing anything —
the fact that the write-path fix, however well-evidenced offline, has not yet been proven against a
fresh live run. I deliberately did NOT upgrade SC2/SC3 (SHAPE-02/SHAPE-04) back to VERIFIED on the
strength of the offline fix alone, per this phase's own explicit, repeated instruction that this is
the developer's call to make, not an automated closure's or a verifier's. Two documentation-level
findings (05-REVIEW.md's WR-01, IN-01) remain open, both confirmed real but non-blocking, matching
the review's own classification. A third, new documentation-consistency finding (a stale
traceability-matrix table further down in `.planning/REQUIREMENTS.md`) is recorded as advisory.

---

_Verified: 2026-09-26T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
