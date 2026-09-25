---
status: testing
phase: 05-socratic-epic-authoring
source: [05-VERIFICATION.md]
started: 2026-09-25T15:55:00Z
updated: 2026-09-25T19:30:00Z
---

## Current Test

number: 1
name: Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03)
expected: |
  Run `node scripts/uat/uat-08-socratic-authoring.mjs` in live mode against a real `claude`
  binary and the developer's own claude.ai credential.

  During the challenge stage the agent pushes back on the developer's stated premise and asks
  substantive clarifying questions rather than affirming it; the drafted acceptance criteria are
  usable as-is or clearly need amendment. Both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md`
  get filled with the developer's own words.

  Three outcomes are worth REPORTING rather than treating as failures:
    - a refusal naming an authentication method the harness does not accept;
    - a reading of `uncorrelatable` (the live `tool_use` block carries no id — the one assumption
      plan 05-30 could not measure offline);
    - the composed config directory failing to authenticate at all, which would contradict plan
      05-33's single manual measurement and is itself a new finding.
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
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

- truth: "A backend message that is not agent speech is surfaced as a distinct error condition the instant it appears, and the run stops there rather than waiting out the proposal deadline."
  status: resolved
  resolved_by: 05-34
  severity: major
  test: 1
  reason: "Round 8 (2026-09-25): the CLI's `Not logged in · Please run /login` was captured as ordinary agent content and the run waited out the full 120000ms proposal deadline, because `readBackendRefusal` matched only text prefixed `API Error:`. Closed by plan 05-34: `classifyNonConversationTurn` now reads the wire's own facts — the assistant envelope's error flag and error code, and the result line's error flag and terminal reason, carried through the adapter seam as normalised fields — and names which `NON_CONVERSATION_SOURCES` member fired. Verified by the named offline scenario `unauthenticated-backend-first-turn`, which stops the driver at the first turn in ~70ms against a 10000ms deadline and confirms `advance-stage` was never called."
  debug_session: ""

- truth: "A doc comment describing the event model matches the shipped event model."
  status: resolved
  resolved_by: 05-34, 05-35
  severity: minor
  test: 1
  reason: "Round 8: `sidecar-harness.mjs` still claimed neither ToolCallEvent nor ToolResultEvent carries a correlation id, contradicted by plan 05-30; and `scripts/uat/README.md`'s back-to-back-proposals bullet described a comparison the code no longer makes. Both corrected. Verified: `grep -c 'carries a correlation id, so there is nothing finer-grained' scripts/uat/lib/sidecar-harness.mjs` = 0, `grep -c 'as it shipped on 2026-09-24' scripts/uat/README.md` = 0, and the README scenario list now matches `Object.keys(SCENARIOS)` one to one at eleven."
  debug_session: ""

- truth: "The live acceptance arm can authenticate as the developer whose machine it runs on, using that developer's existing local agent credentials."
  status: resolved
  resolved_by: 05-33
  severity: blocker
  test: 1
  reason: "Round 8: `cleanClaudeConfigEnv()` pointed CLAUDE_CONFIG_DIR at an isolated temp directory, and because Claude Code stores the OAuth credential under CLAUDE_CONFIG_DIR, config isolation and credential availability were one switch — making SHAPE-01's and SHAPE-03's live judgements unreachable rather than merely unspent. Closed by plan 05-33: `composeIsolatedClaudeConfigDir` links the developer's own credential into the isolated directory by symbolic reference (`CREDENTIAL_LINK_ALLOWLIST` = `.credentials.json`, frozen) while `BEHAVIOURAL_CONFIG_DENYLIST` keeps their personal CLAUDE.md, settings, skills, agents, commands, hooks and plugins out; `assertClaudeConfigIsolated` throws on a planted behavioural entry or a non-allow-listed link; `assertBackendAuthenticated` reads auth state BEFORE `startSidecar()` and refuses with a named `HARNESS PRECONDITION FAILED:` cause; `scrubApiKeyEnv` removes every API-key variable from the spawn environment. No API-key fallback was introduced. Residual, carried into test 1: the mechanism has never been exercised against a real `~/.claude` — every committed test uses a synthetic fixture."
  debug_session: ""
