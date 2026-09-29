---
status: testing
phase: 05-socratic-epic-authoring
source: [05-VERIFICATION.md, 05-40-SUMMARY.md, 05-41-SUMMARY.md, 05-42-SUMMARY.md, 05-43-SUMMARY.md]
started: 2026-09-25T15:55:00Z
updated: 2026-09-29T04:20:00Z
---

## Current Test

number: 1
name: Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03)
expected: |
  Running the live arm, the agent's challenge-stage turns push back on the stated premise and ask
  substantive clarifying questions — and those questions, with their offered options, are now
  visible in `05-LIVE-CHALLENGE-TRANSCRIPT.md` inside the turn that asked them, because round 10
  modelled `AskUserQuestion` at the adapter seam and rendered it into the sheet. The drafted
  acceptance criteria are usable as-is or clearly need amendment. Both verdict lines in the
  transcript get filled with your own words.
awaiting: user response

## Tests

### 1. Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03)
expected: The agent's challenge-stage turns push back on the framing and ask substantive clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or clearly need amendment. Both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` get filled.
why_human: |
  Judgment about live model dialogue quality and draft usefulness; no structural check can certify
  either. Additionally — new as of round 8's closure — this run will be the FIRST time
  `composeIsolatedClaudeConfigDir`'s credential-presentation mechanism is exercised against a real
  `~/.claude` directory and a real backend rather than against a synthetic fixture. Every committed
  test uses a synthetic fixture; `readClaudeAuthStatus` is by design never invoked from any
  self-test. If the composed directory does not actually authenticate, that is a new reportable
  finding, not a failure of this verification.
result: [pending]
previously_reported_round_10: "Live run 01M3DNC0G9CYAWSD8DYEGTRP8C (2026-09-26T01:30:43Z), the first live run after gap-closure round 9. Round 9's own fixes ALL HELD and are now confirmed in production, not just offline: the run exited 1 and the evidence sheet still grew 2645 -> 10556 bytes (written 4x including a `pre-proposal, results pending` checkpoint), the scratch root was preserved (`[uat] preserved scratch root (run failed)`), the uat-08-credential-path artifact survived, no turn deadline fired (2 full agent turns completed where the previous run died at 120000ms), and the terminating failure was classified from the wire's own error flag (`source=assistant_envelope_error_flag classifier=invalid_request`) rather than from prose. But SHAPE-01 and SHAPE-03 STILL cannot be judged, for two NEW reasons. (a) The agent asked its three clarifying questions through the `AskUserQuestion` tool; the harness captures only `assistant_text`, so the questions are absent from the evidence sheet — the transcript jumps from 'three things would materially change the shape of the spec:' straight to 'You didn't pick' — and the driver answered the tool with 'The user did not answer the questions' because it has no handler, so the Socratic exchange could never develop. (b) Every propose_epic/propose_assumption call was refused with 'Flywheel could not verify the authoring stage allows this call (no authoring stage marker could be read for this run)' although the run demonstrably started in the challenge stage; nothing reached the board, `Drafted criteria: 0`, and the shaped epic exists only as prose. The questions were recovered post hoc from Claude Code's own session JSONL inside the preserved scratch root — which only existed because round 9's preserveRoot fix worked."
previously_severity_round_10: blocker
resolved_since: |
  Both causes named in the round-10 report above are now closed — see gaps `G-05-8` below, closed by
  plans 05-40 through 05-43. (a) `AskUserQuestion` is modelled at the adapter seam, frozen from the
  real capture, replayed offline, rendered into the sheet, and answered by the driver; the tool is
  additionally disallowed for authoring sessions so the challenge stage is prose-only. (b) The stage
  marker is written at session start, proven end-to-end against the shipped hook binary.

  This test is re-opened as `[pending]` rather than marked resolved because the judgement it exists
  for has still never been made: no live run has been attempted since those fixes landed, so the
  dialogue-quality and draft-usefulness verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remain
  empty. The mechanism blocking the judgement is fixed; the judgement itself is unspent.
previously: |
  issue (round 9, 2026-09-25T11:12:22Z) — live run 01M3C48C3PV1NSGHERBZ587YB1. Authentication
  SUCCEEDED (`method=claude.ai loggedIn=true`), confirming plan 05-33's credential fix against a
  real ~/.claude for the first time. The run then failed at the turn-1 deadline (120000ms) and
  produced NO evidence sheet: `05-LIVE-CHALLENGE-TRANSCRIPT.md` was byte-unchanged and the
  credential-path artifact did not survive either. Opened gap `G-05-7`; closed by plans 05-36
  (evidence on every exit), 05-37 (unmodelled wire shapes) and 05-38 (idle-primary turn bounds),
  all three confirmed by the 2026-09-26 run above.

  blocked (round 8, 2026-09-25T16:25:00Z) — runs 01M3BSBJ05CJD49YFPC5VV26EG and
  01M3BSKG32D3QRDGEJJS2B7YHD both exited 1 with the backend's only reply being
  `Not logged in · Please run /login`. Root cause was NOT a missing login: config isolation and
  credential availability were the same switch, so isolating `CLAUDE_CONFIG_DIR` stripped the
  claude.ai OAuth credential. Closed by plan 05-33. No credential was spent by either run.
  Whether to spend one now remains the developer's own decision, still unanswered by design.

### 2. Does the Core Value hold live — the fixed marker mechanism against a real run
expected: |
  Running the live arm again, `propose_epic` / `propose_assumption` calls succeed instead of being
  refused with "no authoring stage marker could be read for this run", and the evidence sheet
  reports a non-zero `Drafted criteria`. The epic, its tasks and their drafted acceptance criteria
  land on the board as structured items rather than existing only as prose in the transcript. If
  the run still fails, it fails for a DIFFERENT reason than the marker read — that specific
  mechanism is now closed by a contract test against the shipped hook.
why_human: |
  This is exactly the live-run observation round 10's fix was built to make possible, but did not
  itself make. `05-VERIFICATION.md` re-scored roadmap SC2 and SC3/SHAPE-04 down from VERIFIED to
  PRESENT_BEHAVIOR_UNVERIFIED on this basis, and SHAPE-02/03/04's state in `REQUIREMENTS.md` was
  deliberately not upgraded on the strength of an unproven fix. Spending a credential to settle it
  is the developer's own call. Same live run as test 1 — one run answers both.
result: issue
reported: |
  Live run 01M3ENQMC3E4M2HP7014MA84PX (2026-09-26T10:56:17Z), the first live run after gap-closure
  round 10. Exit 1, but on entirely new ground — and round 10's own fixes are now confirmed in
  production, not merely offline.

  WHAT IS NOW PROVEN LIVE, for the first time in this phase:
  - The `no authoring stage marker could be read for this run` refusal is GONE — zero occurrences
    in the whole run log. G-05-8(b)'s mechanism is closed in production, exactly as the contract
    test predicted.
  - Proposals reached the board's write path: 13 `proposal_created` events applied through the real
    inbound bridge (`apply-proposal-created`), against `Drafted criteria: 0` and zero successful
    proposals in every prior live run.
  - `✅ SHAPE-01 — the agent challenges before any work is planned — challenged=true
    noWorkPlanned=refused`. First live PASS of a gating SHAPE criterion in this phase.
  - The Socratic exchange developed past turn one: 3 agent turns, 4 questions answered, `the
    conversation settled` rather than being cut off. The agent's second turn is a substantive
    push-back ("Four challenges to the framing") that disputes the premise itself.
  - The `AskUserQuestion` disallow held against the real backend: zero occurrences in the run. The
    agent asked its five clarifying questions as PROSE, captured verbatim in the evidence sheet —
    the exact outcome round 10 designed for, now proven against a real backend rather than as argv.

  WHY IT STILL FAILED — a NEW defect, not G-05-8:
  `❌ SHAPE-02 (no subtree was accepted)` and `❌ SHAPE-03/SHAPE-04 (not enough proposals to
  exercise all three verbs)`. The preserved scratch database gives the exact cause — of the 13
  pending proposals, `select target_type, count(*) from authoring_proposals group by 1` returns
  `epic: 1, assumption: 12`. ZERO tasks and ZERO criteria. `taskProposalId` and
  `criterionProposalId` are therefore both null, so the entire accept/reject/amend block at
  uat-08-socratic-authoring.mjs:6443-6510 is skipped wholesale, and `epics`/`tasks`/
  `acceptance_criteria` all remain at 0 rows.

  The agent had explicitly promised "five tasks ... acceptance criteria for each, and the
  assumption rows"; it emitted the epic and its 12 assumptions first and was snapshotted before the
  tasks followed. The harness drains proposals EXACTLY ONCE — `waitForEvent` for the first
  `proposal_created`, then a single `for (const event of sidecar.eventsOfType("proposal_created"))`
  pass at :6429 — and the comment directly above that loop claims it applies "every proposal_created
  event seen so far (AND ANY THAT ARRIVE OVER THE NEXT WINDOW)". There is no next window:
  `eventsOfType("proposal_created")` has exactly one call site in the file and `PROPOSAL_DEADLINE_MS`
  has exactly one use, in the first wait. The code does not implement the window its own comment
  promises.
severity: blocker

### 3. Credential seam's general reliability (carried forward)
expected: |
  A decision, not an observation: either accept the observed live authentication successes as
  sufficient evidence for `composeIsolatedClaudeConfigDir`, or state that a committed, repeatable
  test exercising it against a real `~/.claude` is still wanted.
why_human: |
  Judgment call about how much assurance is enough for a credential-handling mechanism. Every
  committed test uses a synthetic fixture and `readClaudeAuthStatus` is by design never invoked
  from any self-test, so this gap cannot close itself. Carried forward from round 8's closure
  (gap G-05-6, plan 05-33) and unchanged by round 10.
result: [pending]

## Summary

total: 3
passed: 0
issues: 1
pending: 2
skipped: 0
blocked: 0

## Gaps

- gap_id: G-05-6
  truth: "A backend message that is not agent speech is surfaced as a distinct error condition the instant it appears, and the run stops there rather than waiting out the proposal deadline."
  status: resolved
  resolved_by: 05-34-PLAN.md
  resolved_at: 2026-09-25
  severity: major
  test: 1
  reason: "Round 8 (2026-09-25): the CLI's `Not logged in · Please run /login` was captured as ordinary agent content and the run waited out the full 120000ms proposal deadline, because `readBackendRefusal` matched only text prefixed `API Error:`. Closed by plan 05-34: `classifyNonConversationTurn` now reads the wire's own facts — the assistant envelope's error flag and error code, and the result line's error flag and terminal reason, carried through the adapter seam as normalised fields — and names which `NON_CONVERSATION_SOURCES` member fired. Verified by the named offline scenario `unauthenticated-backend-first-turn`, which stops the driver at the first turn in ~70ms against a 10000ms deadline and confirms `advance-stage` was never called."
  debug_session: ""

- gap_id: G-05-6
  truth: "A doc comment describing the event model matches the shipped event model."
  status: resolved
  resolved_by: 05-34-PLAN.md, 05-35-PLAN.md
  resolved_at: 2026-09-25
  severity: minor
  test: 1
  reason: "Round 8: `sidecar-harness.mjs` still claimed neither ToolCallEvent nor ToolResultEvent carries a correlation id, contradicted by plan 05-30; and `scripts/uat/README.md`'s back-to-back-proposals bullet described a comparison the code no longer makes. Both corrected. Verified: `grep -c 'carries a correlation id, so there is nothing finer-grained' scripts/uat/lib/sidecar-harness.mjs` = 0, `grep -c 'as it shipped on 2026-09-24' scripts/uat/README.md` = 0, and the README scenario list now matches `Object.keys(SCENARIOS)` one to one at eleven."
  debug_session: ""

- gap_id: G-05-6
  truth: "The live acceptance arm can authenticate as the developer whose machine it runs on, using that developer's existing local agent credentials."
  status: resolved
  resolved_by: 05-33-PLAN.md
  resolved_at: 2026-09-25
  severity: blocker
  test: 1
  reason: "Round 8: `cleanClaudeConfigEnv()` pointed CLAUDE_CONFIG_DIR at an isolated temp directory, and because Claude Code stores the OAuth credential under CLAUDE_CONFIG_DIR, config isolation and credential availability were one switch — making SHAPE-01's and SHAPE-03's live judgements unreachable rather than merely unspent. Closed by plan 05-33: `composeIsolatedClaudeConfigDir` links the developer's own credential into the isolated directory by symbolic reference (`CREDENTIAL_LINK_ALLOWLIST` = `.credentials.json`, frozen) while `BEHAVIOURAL_CONFIG_DENYLIST` keeps their personal CLAUDE.md, settings, skills, agents, commands, hooks and plugins out; `assertClaudeConfigIsolated` throws on a planted behavioural entry or a non-allow-listed link; `assertBackendAuthenticated` reads auth state BEFORE `startSidecar()` and refuses with a named `HARNESS PRECONDITION FAILED:` cause; `scrubApiKeyEnv` removes every API-key variable from the spawn environment. No API-key fallback was introduced. Residual, carried into test 1: the mechanism has never been exercised against a real `~/.claude` — every committed test uses a synthetic fixture."
  debug_session: ""

- gap_id: G-05-7
  truth: "A live run that fails still writes the evidence sheet with whatever it captured, so a run that spent real tokens is never invisible after the fact."
  status: resolved
  resolved_by: 05-36-PLAN.md
  resolved_at: 2026-09-26
  resolution_evidence: "Confirmed in production by live run 01M3DNC0G9CYAWSD8DYEGTRP8C, which exited 1 and still grew the sheet 2645 -> 10556 bytes (4 writes, including a `pre-proposal, results pending` checkpoint), preserved the scratch root, and kept the credential-path artifact. Structural, not additive: `writeFileSync(evidencePath` call sites went 4 -> 0, replaced by a single `writeChallengeEvidence` writer invoked from one `finally`. The preserved scratch root is what made gap G-05-8(a) diagnosable at all."
  reason: "Live run 01M3C48C3PV1NSGHERBZ587YB1 spent real tokens, captured 539 characters of genuine agent speech across 2 chunks and a ~130-event trace, then discarded all of it. `evidencePath` is resolved at uat-08-socratic-authoring.mjs:4607 under a comment that states the intent explicitly — \"a refusal must be able to write the evidence sheet with whatever was captured before it fails the run\" (G-05-3, plan 05-24) — but every `fs.writeFileSync(evidencePath, ...)` site is downstream of the `await driveChallengeConversation(...)` call at :4614. A refusal RETURNED from that call reaches the writes; an exception THROWN from it (here, the turn-1 deadline) bypasses all of them. The guarantee was implemented for one failure shape and not the other. This is an eighth instance of the defect class README Item 8 records: the comment describes a guarantee the code does not provide. Worse, the `uat-08-credential-path` artifact plan 05-33 Task 3 added so that \"which credential authenticated a run can never again be invisible after the fact\" is likewise gone — the harness cleanup removed it on the failure path. 05-33 self-tested that the artifact RENDERS; nothing tested that it SURVIVES."
  severity: blocker
  test: 1
  root_cause: "Evidence writes are placed after the call that can throw, rather than in a finally-shaped path that runs on every exit."
  artifacts:
    - path: "scripts/uat/uat-08-socratic-authoring.mjs"
      issue: ":4607 resolves evidencePath with a comment promising failure-path evidence; every write site sits downstream of the throwing call at :4614"
    - path: "scripts/uat/lib/sidecar-harness.mjs"
      issue: "harness cleanup removes the run artifact directory on the failure path, destroying the credential-path artifact 05-33 wrote"
  missing:
    - "Write the evidence sheet on EVERY exit from the live arm — including an exception out of driveChallengeConversation — carrying whatever turns were captured, the failure cause, and the credential path"
    - "Preserve the run artifact directory when a run fails; cleanup may only remove it on success"
    - "A test that proves the sheet exists after a THROWN failure, not only after a returned refusal"
  debug_session: ""

- gap_id: G-05-7
  truth: "The live arm completes a first agent turn against the real backend within its own deadline."
  status: resolved
  resolved_by: 05-38-PLAN.md
  resolved_at: 2026-09-26
  resolution_evidence: "Confirmed in production by live run 01M3DNC0G9CYAWSD8DYEGTRP8C: no deadline fired and two full agent turns completed, where the previous run was killed at 120000ms mid-work. `TURN_DEADLINE_MS` is gone (bare references 0, `REPLAY_TURN_DEADLINE_MS` intact at 11); `LIVE_TOOL_CALL_IDLE_MS = 120_000` now bounds the mid-flight tool-call state that plan 05-25 had left backstopped only by the wall clock, and `LIVE_TURN_CEILING_MS = 900_000` resets on every progress signal. The constant carries a four-part derivation stating explicitly that 120000ms is a LOWER bound, that no upper bound exists in this repository, and that the ceiling firing would itself be a reportable finding rather than a number to raise."
  reason: "Turn 1 exceeded TURN_DEADLINE_MS = 120000 (uat-08-socratic-authoring.mjs:84). This is NOT a stall: the separate idle guard LIVE_TURN_IDLE_MS = 30000 never fired, and the captured event list shows continuous activity to the deadline — roughly 60 tool_call/tool_result pairs, several board_read_request round trips, and repeated permission_request drains. The backend is claude-opus-5 doing genuine exploratory tool work on its first turn. The deadline was calibrated against a scripted fake backend whose turns are instant, never against a real reasoning model's first turn."
  severity: major
  test: 1
  root_cause: "A wall-clock turn deadline calibrated on the offline fake, applied unchanged to a live reasoning model."
  artifacts:
    - path: "scripts/uat/uat-08-socratic-authoring.mjs"
      issue: ":84 TURN_DEADLINE_MS = 120_000 — a hard wall-clock bound on a turn, not an idle bound"
  missing:
    - "Bound a live turn by IDLE time (no event for N seconds), not by total wall-clock, so a productively-working agent is never failed for being thorough"
    - "If a wall-clock ceiling is kept as a backstop, set it from a measurement of a real first turn and state that measurement beside the constant"
  debug_session: ""

- gap_id: G-05-7
  truth: "Every event shape the shipped backend emits is modelled by the adapter rather than dumped as unrecognised raw text."
  status: resolved_partially
  resolved_by: 05-37-PLAN.md
  resolved_at: 2026-09-26
  resolution_evidence: "The two shapes this gap named ARE now modelled at the adapter seam: `grep -ci thinking` on `packages/sidecar/src/adapter.ts` / `claude-code-adapter.ts` went 0/0 -> 5 and 7, `rate_limit` 0/0 -> 2 and 8, with a real capture frozen as `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json` and the 200-char truncating logger replaced by `createUnmodelledEventSink`. Live run 01M3DNC0G9CYAWSD8DYEGTRP8C emitted no `unrecognised sidecar event` lines for either shape."
  residual: "The truth as WORDED — *every* event shape is modelled — is not fully met, and the same run proved it: the `AskUserQuestion` tool call is a third shape the harness does not model, and its payload is dropped from the evidence sheet rather than dumped to stderr. Carried forward as gap G-05-8(a) rather than marked closed, because closing a universally-quantified truth on two instances is exactly the overclaim this phase's Item 8 register exists to prevent."
  reason: "Two wire event types the real backend emits are absent from the entire repository. `thinking` content blocks: `grep -c thinking` reports 0 in both packages/sidecar/src/adapter.ts and claude-code-adapter.ts, yet claude-opus-5 emitted roughly eleven assistant messages whose content began with a thinking block during turn 1 — each normalised to `unknown` and dumped to stderr as `[uat] unrecognised sidecar event` with its full raw JSON. `rate_limit_event`: zero occurrences repo-wide, also dumped raw — and it carried real operational information the product will want (rateLimitType=seven_day, utilization=0.81, status=allowed_warning, surpassedThreshold=0.75). The harness's event model does not match the wire it consumes, which is the same root shape as G-05-6's MAJOR finding."
  severity: major
  test: 1
  root_cause: "The adapter's event model was built from the offline fixtures, which contain neither shape."
  artifacts:
    - path: "packages/sidecar/src/adapter.ts"
      issue: "no thinking-block or rate-limit event in the model"
    - path: "packages/sidecar/src/claude-code-adapter.ts"
      issue: "normaliseStreamEvent maps both shapes to unknown"
  missing:
    - "Model thinking content blocks explicitly — at minimum so they stop being dumped as raw unrecognised text"
    - "Model rate_limit_event and surface its utilization/threshold fields"
    - "Freeze a real captured fixture of each shape from this run's log, as the other shapes already are"
  debug_session: ""

- gap_id: G-05-8
  truth: "The clarifying questions the agent asks are visible in the evidence sheet a human judges SHAPE-01 from, and the driver answers them so the exchange can continue."
  status: resolved
  resolved_by: 05-41-PLAN.md, 05-42-PLAN.md
  resolved_at: 2026-09-26
  resolution_evidence: "Closed at the adapter seam, the remedy this class has taken since 05-30/05-34/05-37, rather than by harness-side reconstruction. `parseAskUserQuestionInput` normalises an `AskUserQuestion` tool_use block's questions and options into typed `ToolCallEvent.questions` data, order-preserving, never merged or de-duplicated, and absent-rather-than-empty on a malformed payload; the shape is frozen from the real live capture as `scripts/uat/fixtures/live-opus5-ask-user-question.json` and replayed offline as the named `ask-user-question` scenario (15/15 scenarios pass). `buildAgentExchange` is now the single builder behind all nine capture sites, so a deadline-path turn and a happy-path turn carry the same fields, and `renderQuestionsAsked`/`questionsFromTurn` put the questions and their offered options into the evidence sheet inside the turn that asked them. `extractOpenQuestions` reads the typed prompts before falling back to prose, so a question-mark-free closing turn carrying an unanswered tool question is no longer misread as settled, and the driver answers an offered option instead of returning `The user did not answer the questions.` Additionally `--disallowedTools AskUserQuestion` is now passed unconditionally for authoring sessions, so the challenge stage is structurally prose-only. Verified offline (sidecar 191/191, `--self-test`, `--replay-check` 15/15); the `--disallowedTools` change is proven as argv only, not against a real backend."
  reason: "Live run 01M3DNC0G9CYAWSD8DYEGTRP8C (2026-09-26): the agent asked its three clarifying questions through the `AskUserQuestion` tool rather than as assistant text. The harness captures only `assistant_text` chunks, so the questions never reached `05-LIVE-CHALLENGE-TRANSCRIPT.md` — the transcript reads `...three things would materially change the shape of the spec:` and then jumps straight to `You didn't pick — no problem.` The agent itself later refers to `the three questions you skipped`, confirming they were asked. Separately, the driver has no handler for the tool and answered it with the literal string `The user did not answer the questions.`, so the agent proceeded on stated defaults and the Socratic exchange could never develop past turn one. SHAPE-01 is `the agent challenges assumptions and asks clarifying questions` — the questions ARE the evidence, and the artifact a human is asked to judge does not contain them. This is the same root shape as G-05-7's third finding (a content-block type the harness does not model), and more damaging, because the unmodelled shape carries the feature under test rather than diagnostic noise. Recovered post hoc from Claude Code's own session JSONL inside the preserved scratch root — an artifact that only survived because plan 05-36's preserveRoot fix landed first."
  severity: blocker
  test: 1
  root_cause: "`AskUserQuestion` is not modelled at the adapter seam, so it is neither carried into the harness's turn capture nor exposed to the driver as something answerable."
  artifacts:
    - path: "packages/sidecar/src/claude-code-adapter.ts"
      issue: "no branch for an AskUserQuestion tool_use block; its question/option payload is not normalised into a typed event"
    - path: "scripts/uat/uat-08-socratic-authoring.mjs"
      issue: "the turn capture accumulates assistant_text chunks only, so a turn's questions are absent from the rendered evidence sheet"
    - path: "scripts/uat/lib/sidecar-harness.mjs"
      issue: "the inbound-request drain has no handler for AskUserQuestion; it resolves as an unanswered question rather than routing to the driver"
  missing:
    - "Carry the AskUserQuestion tool call's own question/option payload through the adapter seam as a typed event, the same remedy plans 05-30/05-34/05-37 used for prior instances of this class — not a harness-side reconstruction"
    - "Render the questions and their options into the evidence sheet as part of the agent's turn, so SHAPE-01's evidence is in the artifact a human reads"
    - "Give the driver a real handler so it selects an option (or answers in text) and the conversation continues, instead of returning `The user did not answer the questions.`"
    - "Freeze a fixture of the AskUserQuestion shape from this run's preserved session JSONL and replay it offline, as the other shapes already are"
  debug_session: ""

- gap_id: G-05-8
  truth: "An authoring session started in the challenge stage can write its outcome to the board — the epic, its tasks and their drafted acceptance criteria arrive as structured items."
  status: resolved_partially
  resolved_by: 05-40-PLAN.md
  resolved_at: 2026-09-26
  resolution_evidence: "The finding was stated before the fix, as the gap demanded: the WRITE side of the marker contract was wrong, not the read side — correcting this gap report's own `artifacts` entries, which named `mcp-permission-server.ts` and left the responsible side undetermined. `start_authoring_run` (`packages/core/src/domain/authoring_session.rs:145-156`) now writes the D-88 stage marker as the last step before `tx.commit()`, and a marker-write failure `bail!`s before commit so no `agent_runs` row survives without its marker. Proven end-to-end by `cargo test -p core --test authoring_stage_marker_contract` (3/3), which spawns the SHIPPED, compiled `stage-gate-hook.ts` as a real process against a marker a real `start_authoring_run` call produced — not a database-row assertion. The hook still fails closed on an absent, unparseable or unrecognised marker and still resolves the run id from its own environment; a third test asserts the challenge-stage denial reason and the fail-closed denial reason are provably distinct, so a challenging agent is now told it is still challenging rather than that its run is unusable. `advance_stage` has no agent-reachable caller. `cargo test --workspace` green."
  residual: "The truth as WORDED — the outcome ARRIVES on the board as structured items — was not yet met when this entry was first reconciled, and nothing in round 10 claimed it was. This is recorded as `resolved_partially` rather than `resolved` for the same reason G-05-7's third finding was: closing a truth about live behaviour on offline evidence is exactly the overclaim this phase's Item 8 register exists to prevent. `05-VERIFICATION.md` (round 10) independently re-scored roadmap SC2 and SC3/SHAPE-04 from VERIFIED down to PRESENT_BEHAVIOR_UNVERIFIED on the same basis."
  residual_update: "PARTIALLY DISCHARGED by live run 01M3ENQMC3E4M2HP7014MA84PX (2026-09-26T10:56:17Z), the first live run after round 10. The MECHANISM this gap named is confirmed closed in production: the `no authoring stage marker could be read for this run` refusal has zero occurrences in the run, and 13 proposals were applied through the real inbound bridge where every prior live run applied none. What the truth's own wording still lacks is the last leg — `epics`, `tasks` and `acceptance_criteria` all remain at 0 rows, because the 13 proposals were `epic: 1, assumption: 12` with no task or criterion for the accept path to act on. That shortfall has a different and independently located cause (the single-shot proposal drain) and is tracked as its own gap `G-05-9`, not as a recurrence of this one. Kept `resolved_partially` rather than promoted: the write path this gap was about now demonstrably works live."
  reason: "Live run 01M3DNC0G9CYAWSD8DYEGTRP8C (2026-09-26): every `propose_epic` and `propose_assumption` call was refused with `Flywheel could not verify the authoring stage allows this call (no authoring stage marker could be read for this run) — refusing it.` The run log nevertheless reports `run 01M3DNC0G9CYAWSD8DYEGTRP8C started in the challenge stage`, and the driver later advanced the stage through the D-90 human gate without error — so the marker was set for the run and the MCP tool could not read it. Nothing reached the board: the evidence sheet records `Drafted criteria: 0`, and the shaped epic (six tasks, each with acceptance criteria) exists only as prose in the conversation. SHAPE-02, SHAPE-03 and SHAPE-04 therefore have NO live evidence at all, only offline coverage. This is the project's Core Value failing in a live run — `every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob` — and in this run it was exactly a chat blob."
  severity: blocker
  test: 1
  root_cause: "A read-path or scoping mismatch between where the run's authoring stage marker is written and where the MCP proposal tools look for it — not a missing marker. Unlike G-05-8(a) this is a PRODUCT defect in the authoring gate, so the fix belongs in `packages/`, not `scripts/uat/`."
  artifacts:
    - path: "packages/sidecar/src/mcp-permission-server.ts"
      issue: "propose_* refuse on an unreadable stage marker for a run that demonstrably started in the challenge stage"
    - path: "packages/core"
      issue: "the stage marker's write path and the MCP tool's read path disagree for a harness-spawned authoring run; which side is wrong is undetermined"
  missing:
    - "Determine which side of the marker contract is wrong — the write at session start, or the read from the MCP tool's run context — and state the finding before fixing either"
    - "A regression that fails when a run started in the challenge stage cannot have its stage marker read by the proposal tools"
    - "Live-path coverage for SHAPE-02/03/04: the offline arms pass while the live board write has never once succeeded, which is precisely the offline/live divergence rule recorded in Item 8 (plan 05-26)"
  debug_session: ""

- gap_id: G-05-9
  truth: "An authoring session that has proposed an epic can hang tasks and acceptance criteria off it, so the drafted criteria SHAPE-03 is about can exist at all."
  status: failed
  correction: |
    CORRECTED 2026-09-26, before any closure plan was written. The `root_cause` first filed against
    this gap — a single-shot proposal drain in `uat-08-socratic-authoring.mjs` truncating a
    multi-burst decompose — is WRONG, and naming it would have sent a closure plan at the harness
    when the defect is in `packages/`. The superseded reasoning is kept verbatim under
    `superseded_root_cause` below rather than deleted.

    What refuted it: the agent SAID why it stopped, in turn 8 of the transcript, and it was right.
    "I stopped short of staging tasks. Staged proposals don't come back in `board_search`, so
    there's no proposal id to hang tasks and criteria off within this session." The tasks were never
    emitted, so no drain — however long its window — could have collected them. Measurement
    confirms the agent's account on every point; see `root_cause`.

    This is the THIRD consecutive round in which a gap report named the wrong artifact and
    measurement during planning caught it (rounds 9 and 10 are the prior two, both recorded in
    `scripts/uat/README.md` Item 8). The first two were written by the gap reporter; this one was
    written by the orchestrator reading a failed run. The rule those rounds earned — measure the
    named artifact before planning against it — is what caught this, and it has now earned its keep
    a third consecutive time.
  reason: "Live run 01M3ENQMC3E4M2HP7014MA84PX (2026-09-26) — the first run in which the board write path actually worked. 13 proposals were applied through the real inbound bridge, but the preserved scratch database shows what they were: `epic: 1, assumption: 12`, and ZERO of `targetType: task` or `targetType: criterion`. The agent had stated it would stage \"five tasks ... acceptance criteria for each, and the assumption rows\"; it emitted the epic and its assumptions first, and the harness snapshotted `list-pending` before the tasks arrived. Because `taskProposalId` and `criterionProposalId` are both null, the whole accept/reject/amend block is skipped and `epics`/`tasks`/`acceptance_criteria` stay at 0 rows — so SHAPE-02 fails as `no subtree was accepted` and SHAPE-03/SHAPE-04 fail as `not enough proposals to exercise all three verbs`, even though the proposal mechanism itself demonstrably works. This is NOT G-05-8 recurring: the stage-marker refusal that caused the previous live failure is entirely absent from this run."
  severity: blocker
  test: 2
  root_cause: |
    A staged proposal's id is never returned to the agent that staged it, and no tool can read it
    back — so a proposal can never become the parent of another proposal within its own session.
    Three measurements, all in `packages/`, close the loop:

    1. `stageAuthoringProposal` (`packages/sidecar/src/mcp-permission-server.ts:960`) resolves every
       `propose_*` tool call with exactly `{"staged": true}`. No id, for any of the four verbs.
    2. `proposeCriterionToolDefinition` (:577-599) declares `required: ["statement",
       "parent_proposal_id"]`, with `parent_proposal_id` at `minLength: 1`, and
       `parseProposeCriterionArgs` (:797) throws on a missing or empty one. Its own doc comment
       states the intent — "a drafted criterion has no canonical parent until its own parent
       proposal is accepted, so this is the schema-layer rejection point for a criterion with
       nowhere to hang."
    3. The agent's only read tools are `board_search`, `epic_get` and `task_list`
       (`AUTHORING_READ_TOOL_NAMES`, :145). `board_search` routes to
       `flywheel_core::query::search::search_items` over board rows; `authoring_proposals` appears
       nowhere in `packages/desktop/src-tauri/src/commands/board.rs`. Staged proposals are invisible
       to every read path the agent has.

    The consequence is stronger than this one run: `propose_criterion` is UNREACHABLE in a
    fresh-epic session, by construction. `Drafted criteria: 0` is not this run's bad luck — it is
    the only value the current design can produce, and SHAPE-03 ("the agent drafts acceptance
    criteria for each generated task") therefore cannot be satisfied live at all. Every prior live
    run was blocked before the proposal stage by G-05-8(b), so no run had ever reached far enough
    to expose this.

    `propose_task`'s `parent_proposal_id` is OPTIONAL (`required: ["title"]`, :553), so tasks were
    reachable without a parent; the agent declined to stage them for its own second, judgement-based
    reason (they are downstream of twelve un-triaged assumptions). That half is arguably correct
    behaviour rather than a defect. The criterion half is a hard deadlock.
  superseded_root_cause: "WRONG — kept for the record, see `correction` above. Claimed: the proposal drain is single-shot; `uat-08-socratic-authoring.mjs` awaits the FIRST `proposal_created` event, makes one pass over `sidecar.eventsOfType(\"proposal_created\")` at :6429 and immediately snapshots `list-pending`, while the comment above that loop promises it also applies \"any that arrive over the next window\". The comment/code divergence is REAL and still worth fixing as a latent defect — `eventsOfType(\"proposal_created\")` has exactly one call site and `PROPOSAL_DEADLINE_MS` only one use — but it is NOT what failed this run, because the tasks and criteria it would have collected were never emitted."
  recurrence_class: "The comment/code divergence noted in `superseded_root_cause` would be a TENTH instance of `scripts/uat/README.md` Item 8's defect class (a comment describing a guarantee the code does not provide) — but it is latent, not this run's cause, and must not be filed as this gap's fix. The genuine recurrence here is the OTHER standing rule: for the third consecutive round, a gap report named the wrong artifact and measurement caught it before planning."
  artifacts:
    - path: "packages/sidecar/src/mcp-permission-server.ts"
      issue: ":960 every propose_* call resolves with {\"staged\": true} and no proposal id, so the agent never learns what it just staged"
    - path: "packages/sidecar/src/mcp-permission-server.ts"
      issue: ":577-599/:797 propose_criterion requires a parent_proposal_id that no tool in the session can supply — the tool is unreachable in a fresh-epic session"
    - path: "packages/desktop/src-tauri/src/commands/board.rs"
      issue: ":227 board_search reads board rows via search_items; authoring_proposals is not read by any agent-visible tool, so a staged proposal cannot be looked up"
  missing:
    - "Return the staged proposal's id in the propose_* tool result, so the agent can parent a criterion to the epic or task it just proposed"
    - "Decide and record whether criteria may be drafted against an unaccepted parent at all — if D-07's 'no canonical parent until accepted' rule is to stand, then SHAPE-03's wording needs revisiting, because the two cannot both be true"
    - "A regression that fails when a fresh-epic session cannot reach propose_criterion — today the only signal is Drafted criteria: 0, which reads as the model's choice rather than a structural block"
    - "Separately and independently: close the latent single-shot drain in uat-08-socratic-authoring.mjs, or correct the comment that promises a window it does not implement"
  debug_session: ""

- gap_id: G-05-10
  truth: "An agent that has just staged a proposal knows its id, so `propose_criterion`'s required `parent_proposal_id` can be satisfied inside the same turn."
  status: failed
  reason: "Live run 01M3NNPEWEDMM0XXG5EVKGDQBD (2026-09-29, `node scripts/uat/uat-08-socratic-authoring.mjs`, exit 1) — the first live run after round 11's G-05-9 closure. The run reached all three D-88 stages, the criteria instruction was delivered verbatim, and the agent tried to comply. It could not, and said so in its own words in `05-LIVE-CHALLENGE-TRANSCRIPT.md` turn 6: \"`propose_criterion` requires `parent_proposal_id`. Everything I staged this session — 7 assumptions, 1 epic, 6 tasks — returned only `{\\\"staged\\\": true}` with no id, and `proposal_list` returns `{\\\"proposals\\\": [], \\\"truncated\\\": false}` after every one of them, at limits 100 and 500. `board_search` doesn't see them either. So the read-back path your instructions point at doesn't resolve in this session, and there's no other id source in these tools. I'm not going to invent an id.\" It then drafted ~20 criteria as prose in the chat instead. Outcome: `draftedCriteriaCount` 0, `criteriaReachabilityReading` `declined`, SHAPE-03/SHAPE-04 FAIL (`not enough proposals to exercise all three verbs`). SHAPE-01 and SHAPE-02 passed. The agent's reasoning was correct and its refusal to fabricate an id was the right call — this is a contract defect, not a model failure."
  severity: blocker
  test: 2
  root_cause: |
    Round 11 closed G-05-9 with a READ-BACK path (`proposal_list`) rather than with the fix
    G-05-9's own `missing[0]` named — "Return the staged proposal's id in the propose_* tool
    result". The read-back path cannot resolve inside the turn that stages the proposal, because
    staging and id-assignment are not the same transaction and are not even the same process hop.
    Three measurements:

    1. `stageAuthoringProposal` (`packages/sidecar/src/mcp-permission-server.ts:979`, shipped at
       `packages/sidecar/dist/mcp-permission-server.js:794`) writes the payload over the per-run
       socket and resolves the tool call the moment the supervisor answers `{received: true}`.
       `received` is an acknowledgement of RECEIPT, not of persistence — no row exists yet, so
       there is no id to return, and the literal `{"staged": true}` is all six propose/amend/delete
       verbs can say.
    2. The row is created later, out of band, when the host applies the relayed `proposal_created`
       event (`apply_proposal_created`, `packages/core/src/domain/authoring_proposal.rs:347`,
       driven from `packages/desktop/src-tauri/src/sidecar.rs:1680` in the app and from the
       `apply-proposal-created` ops call in the harness). Until that happens the `proposals` table
       has nothing for this run.
    3. `proposal_list` reads that same table — the `list_proposals` arm of `resolve_board_read`
       (`packages/core/src/query/authoring.rs`). It is therefore guaranteed to return an empty page
       for every proposal whose `proposal_created` event the host has not yet applied. In the UAT
       harness the application is deferred to `drainProposalsUntilQuiet`, which by construction
       runs only AFTER the agent's turn returns, so `proposal_list` is empty for the entire turn in
       which the agent needs it. In the desktop app the reader loop applies events promptly, but
       the tool still resolves before the round trip, so the same read is a race rather than a
       guarantee.

    Net: `propose_criterion` remains UNREACHABLE in a fresh-epic session. Round 11 changed which
    mechanism is missing, not whether one is. The offline `--board-read-check` slice passes because
    it applies the proposal synchronously before reading it back — it proves the dispatch works,
    never that the id is reachable from inside a live turn, which is the property SHAPE-03 needs.
  recurrence_class: |
    This is the twelfth consecutive gap-closure round on Phase 5 and the third in a row whose fix
    landed on instruction text or on a read path rather than on the write contract. Rounds 10, 11
    and 12 each reworded a `StageInstruction` (`CRITERIA_INSTRUCTION_TEXT` /
    `DISTILLATION_INSTRUCTION_TEXT`, `packages/core/src/domain/authoring_session.rs:316-353`) and
    each produced a new instance of the same class: the agent is told to do something the tool
    contract cannot support. The doc comment at `authoring_session.rs:328` records the previous
    live run that failed this way and attributes it to the agent "reasoning itself into waiting" —
    a prompting diagnosis for a contract defect. No further rewording of either instruction may be
    filed as this gap's fix.
  artifacts:
    - path: "packages/sidecar/src/mcp-permission-server.ts"
      issue: ":979 stageAuthoringProposal resolves every propose_*/amend_*/delete_* call with the literal {\"staged\": true} on a {received: true} receipt acknowledgement — the id does not exist yet, so it cannot be returned"
    - path: "packages/core/src/domain/authoring_proposal.rs"
      issue: ":347 apply_proposal_created assigns the id out of band, after the tool call has already resolved — staging and id-assignment are not one transaction"
    - path: "packages/core/src/query/authoring.rs"
      issue: "the list_proposals arm of resolve_board_read reads the proposals table, so proposal_list returns an empty page for anything the host has not yet applied — empty for the whole staging turn"
    - path: "scripts/uat/uat-08-socratic-authoring.mjs"
      issue: "drainProposalsUntilQuiet applies proposal_created events only after the agent's turn returns, which makes the in-turn emptiness of proposal_list structural rather than a race in this harness"
  missing:
    - "Make staging a proposal a synchronous core write that assigns the id and returns it in the propose_* tool result, so parent_proposal_id is satisfiable within the staging turn (this is G-05-9's missing[0], carried forward unclosed)"
    - "Keep the relayed proposal_created event path working for any host that still consumes it, without letting the tool result depend on that round trip"
    - "A regression that fails when a propose_* tool result carries no id, so a return to {\"staged\": true} cannot pass silently again"
    - "A live-path assertion that fails when proposal_list returns empty inside the same turn as a successful propose_* call"
  debug_session: ""
