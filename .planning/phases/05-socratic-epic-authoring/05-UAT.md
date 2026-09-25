---
status: partial
phase: 05-socratic-epic-authoring
source: [05-VERIFICATION.md]
started: 2026-09-25T15:55:00Z
updated: 2026-09-25T16:25:00Z
---

## Current Test

[testing paused — 1 item outstanding]

## Tests

### 1. Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03)
expected: Run `scripts/uat/uat-08-socratic-authoring.mjs` in live mode against a real `claude` binary and real credentials. The agent's challenge-stage turns push back on the framing and ask substantive clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or clearly need amendment. Both verdict lines get filled.
why_human: Judgment about live model dialogue quality and draft usefulness; no structural check can certify either.
result: blocked
blocked_by: third-party
reason: "Live arm run twice (runs 01M3BSBJ05CJD49YFPC5VV26EG and 01M3BSKG32D3QRDGEJJS2B7YHD), both exited 1 with the backend's only reply being `Not logged in \u00b7 Please run /login` (chunks=1 chars=33 endedBy=result). ROOT CAUSE IS NOT A MISSING LOGIN: `claude auth status` reports loggedIn=true, authMethod=claude.ai, subscriptionType=max, and `claude -p` returns normally from this shell. The live arm calls `harness.cleanClaudeConfigEnv()` (scripts/uat/uat-08-socratic-authoring.mjs, live path) which points CLAUDE_CONFIG_DIR at an isolated temp directory, and `assertClaudeConfigIsolated` actively asserts that no spawn-env value references the developer's personal ~/.claude. That directory is also where the claude.ai OAuth credential lives, so isolating the config necessarily strips the credential. Proven directly: `CLAUDE_CONFIG_DIR=$(mktemp -d) claude auth status` returns loggedIn=false, authMethod=none. No API credential was spent by either run. Both verdict lines remain UNJUDGED."

## Summary

total: 1
passed: 0
issues: 0
pending: 0
skipped: 0
blocked: 1

## Gaps

- truth: "A backend message that is not agent speech is surfaced as a distinct error condition the instant it appears, and the run stops there rather than waiting out the proposal deadline."
  status: failed
  reason: "Live arm 2026-09-25: the CLI's `Not logged in · Please run /login` was captured as ordinary agent content (endedBy=result, counted as the agent's first turn and as the distillation reply), the challenge conversation was recorded as having `settled after 1 agent turn(s)`, and the run then waited out the FULL 120000ms proposal deadline before failing. This is a seventh instance of the defect class plan 05-24 claimed to close: `readBackendRefusal` (scripts/uat/lib/sidecar-harness.mjs:401) matches only text whose prefix is BACKEND_REFUSAL_PREFIX = \"API Error:\", so it catches the safety-classifier refusal shape recorded in ledger row 05-22-03 and misses every other non-conversation backend message, including an unauthenticated CLI."
  severity: major
  test: 1
  root_cause: ""
  artifacts:
    - path: "scripts/uat/lib/sidecar-harness.mjs"
      issue: "readBackendRefusal is prefix-bound to \"API Error:\"; a non-conversation backend message with any other shape is indistinguishable from agent speech"
  missing:
    - "Detect a non-conversation backend message generically rather than by one hardcoded prefix, and fail the run at the point of detection instead of at the proposal deadline"
    - "An offline --replay-check scenario covering an unauthenticated-CLI first turn, asserted against the frozen control like the other shapes"
  debug_session: ""

- truth: "A doc comment describing the event model matches the shipped event model."
  status: failed
  reason: "scripts/uat/lib/sidecar-harness.mjs:445-446 still states `neither ToolCallEvent nor ToolResultEvent (packages/sidecar/src/adapter.ts) carries a correlation id, so there is nothing finer-grained` — directly contradicted by plan 05-30, which added exactly that correlation id to both events. Same doc-drift class as 05-REVIEW.md WR-01 (scripts/uat/README.md:227-230), which also remains unfixed."
  severity: minor
  test: 1
  root_cause: ""
  artifacts:
    - path: "scripts/uat/lib/sidecar-harness.mjs"
      issue: "stale doc comment at lines 445-446 contradicts the shipped adapter after plan 05-30"
    - path: "scripts/uat/README.md"
      issue: "WR-01, still open: back-to-back-proposals bullet describes a comparison this round's diff removed"
  missing:
    - "Correct both stale descriptions to match shipped behavior"
  debug_session: ""

- truth: "The live acceptance arm can authenticate as the developer whose machine it runs on, using that developer's existing local agent credentials."
  status: failed
  reason: "The live arm is structurally unable to authenticate for a developer whose auth is claude.ai OAuth (Pro/Max subscription). `cleanClaudeConfigEnv()` sets CLAUDE_CONFIG_DIR to an isolated temp directory and `assertClaudeConfigIsolated` enforces that nothing in the spawn env points at the personal ~/.claude — but Claude Code stores the OAuth credential under CLAUDE_CONFIG_DIR, so config isolation and credential availability are the same switch. Verified: `claude auth status` = loggedIn true / authMethod claude.ai / max; `CLAUDE_CONFIG_DIR=<temp> claude auth status` = loggedIn false / authMethod none. The isolation was wired into the live arm by plan 05-10; the one live run that DID reach the API (row 05-22-03, 2026-09-24) must therefore have authenticated via ANTHROPIC_API_KEY, which survives config isolation — an API-key billing path, not the subscription path this project's core constraint names. This directly contradicts PROJECT.md's execution-model constraint that agents run using the developer's existing local agent credentials, and it makes SHAPE-01's and SHAPE-03's live judgements UNREACHABLE by the current harness rather than merely unspent."
  severity: blocker
  test: 1
  root_cause: "CLAUDE_CONFIG_DIR is both the config root and the credential root for Claude Code; the harness isolates it to keep the developer's personal CLAUDE.md/settings/skills out of the run under test, and unavoidably removes the credential with them."
  artifacts:
    - path: "scripts/uat/lib/sidecar-harness.mjs"
      issue: "cleanClaudeConfigEnv() / assertClaudeConfigIsolated() isolate CLAUDE_CONFIG_DIR, which also strips the claude.ai OAuth credential"
    - path: "scripts/uat/uat-08-socratic-authoring.mjs"
      issue: "live path applies cleanClaudeConfigEnv() unconditionally, so the live arm can never authenticate via a subscription login"
  missing:
    - "Separate config isolation from credential availability for the live arm — isolate the config surface (CLAUDE.md, settings, skills) while still presenting the developer's own credential, or document ANTHROPIC_API_KEY as a hard precondition of the live arm and fail fast with that message instead of producing a 33-character 'Not logged in' agent turn"
    - "A precondition check that reads auth state BEFORE spawning and refuses the run with a named cause, rather than spending two 120s proposal deadlines discovering it"
  debug_session: ""
