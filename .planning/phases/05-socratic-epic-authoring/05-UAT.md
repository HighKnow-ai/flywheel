---
status: complete
phase: 05-socratic-epic-authoring
source: [05-VERIFICATION.md]
started: 2026-09-25T15:55:00Z
updated: 2026-09-25T20:15:00Z
---

## Current Test

[testing complete]

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
result: issue
reported: "Live run 01M3C48C3PV1NSGHERBZ587YB1 (2026-09-25T11:12:22Z). Authentication SUCCEEDED — the run logged `backend authenticated as the developer: method=claude.ai loggedIn=true`, confirming plan 05-33's credential fix against a real ~/.claude for the first time. The run then failed at the turn-1 deadline (120000ms) and produced NO evidence sheet: 05-LIVE-CHALLENGE-TRANSCRIPT.md is byte-unchanged from the previous run, and the uat-08-credential-path artifact the run logged writing does not survive either. SHAPE-01 and SHAPE-03 remain unjudged — not because the agent failed to challenge, but because the instrument discarded what it captured."
severity: blocker
previously: |
  blocked (round 8, 2026-09-25T16:25:00Z) — runs 01M3BSBJ05CJD49YFPC5VV26EG and
  01M3BSKG32D3QRDGEJJS2B7YHD both exited 1 with the backend's only reply being
  `Not logged in · Please run /login`. Root cause was NOT a missing login: config isolation and
  credential availability were the same switch, so isolating `CLAUDE_CONFIG_DIR` stripped the
  claude.ai OAuth credential. Closed by plan 05-33. No credential was spent by either run.
  Whether to spend one now remains the developer's own decision, still unanswered by design.

## Summary

total: 1
passed: 0
issues: 1
pending: 0
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
  status: failed
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
  status: failed
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
  status: failed
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
