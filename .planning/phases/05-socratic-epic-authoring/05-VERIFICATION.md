---
phase: 05-socratic-epic-authoring
verified: 2026-09-25T19:00:00Z
status: human_needed
score: 21/21 must-have truths verified (0 FAILED); 1 roadmap truth PRESENT_BEHAVIOR_UNVERIFIED
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/05-socratic-epic-authoring/05-33-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-33-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-34-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-34-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-35-PLAN.md
  - .planning/phases/05-socratic-epic-authoring/05-35-SUMMARY.md
  - .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md
  - .planning/phases/05-socratic-epic-authoring/05-REVIEW.md
  - .planning/phases/05-socratic-epic-authoring/05-UAT.md
  - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/adapter.test.mjs
  - scripts/uat/README.md
  - scripts/uat/fixtures/unauthenticated-cli-first-turn.json
  - scripts/uat/lib/fake-authoring-claude.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/uat-08-socratic-authoring.mjs
covered_digest: "v1:sha256:d2b42d48298630be7dd07718b21235bb10a3c54e9b91b348489ad0c0148a3bf8"
behavior_unverified: 2
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 29/29 (1 present-but-behavior-unverified)
  gaps_closed:
    - "G-05-6 (05-UAT.md, three findings from the live UAT run 2026-09-25): (1) BLOCKER — config isolation and credential availability were the same switch (CLAUDE_CONFIG_DIR), so the live arm was structurally unable to authenticate on a claude.ai subscription login; closed by plan 05-33's composeIsolatedClaudeConfigDir/assertBackendAuthenticated (allow-list symlink presents the credential by reference, deny-list + link-shape checks keep behavioural config out, pre-spawn precondition refuses fast, credential path now recorded in evidence) — verified independently by direct reading and by re-running the offline self-test (confirmed at least 19 new [Plan 05-33,*] PASS lines) and replay-check. (2) MAJOR — readBackendRefusal was bound to one literal text prefix and missed every other non-conversation shape, including an unauthenticated CLI's login notice, which was captured as agent speech and burned the full 120s proposal deadline; closed by plan 05-34's wire-fact carry (AssistantTextEvent.isApiErrorMessage/errorCode, ResultEvent.isError/terminalReason) and classifyNonConversationTurn, which classifies from the wire's own error flags before falling back to the retained text-banner reader — verified independently by direct reading of the adapter seam, by an independent build+normalise reproduction of the frozen fixture, and by re-running --replay-check --scenario unauthenticated-backend-first-turn (confirmed exit 0, source=assistant_envelope_error_flag, stage remained challenge). (3) MINOR — two stale doc/README descriptions contradicting shipped code; closed by plan 05-35 (confirmed via grep: 0 hits for the stale dated clause, 1 hit for the corrected scenario name, 11/11 scenario names cross-checked against the registry)."
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
advisory:
  - finding: "packages/desktop's proposal-keyboard.test.tsx (`the proposal tray's keyboard region > each of the four keys dispatches its action on the focused (selected) row`) is intermittently flaky (orchestrator observed fail/pass/pass/fail across 4 runs; my own single re-run passed). The file dates to plan 05-07, inside this phase, and packages/desktop is confirmed untouched by this round's diff (`git diff --stat e057324..HEAD -- packages/core packages/desktop` empty)."
    category: other
    reason: >-
      Pre-existing, out of this round's scope, and not one of this closure's must-haves. Not
      independently reproduced as failing by me this session (one re-run passed) — I rely on the
      orchestrator's 4-run observation as the evidentiary basis, which is why this stays Advisory
      rather than a gap. Worth a dedicated flakiness investigation in a future plan; it is not
      touched by, and does not block, G-05-6's closure.
    evidence_status: "orchestrator-reported 4-run flake (fail/pass/pass/fail); independently re-run once this session and observed passing"
behavior_unverified_items:
  - truth: "(Roadmap SC1, carried forward) The agent genuinely challenges assumptions rather than affirming the user's framing; and SHAPE-03's draft-usefulness judgment."
    test: "Run scripts/uat/uat-08-socratic-authoring.mjs in live mode (real claude binary, real credentials, not --self-test/--replay-check) end to end and read the whole conversation it writes into 05-LIVE-CHALLENGE-TRANSCRIPT.md (every turn, in order), then fill both verdict lines."
    expected: "The agent's challenge-stage turns push back on the framing and ask substantive clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or clearly need amendment, read directly from the sheet's counts."
    why_human: "Live-conversation quality and draft-usefulness are judgment calls no automated check can make. The one completed live run in this phase's history (run 01M3BSKG32D3QRDGEJJS2B7YHD, captured in 05-LIVE-CHALLENGE-TRANSCRIPT.md) never reached a judgeable exchange — it is the exact unauthenticated-CLI failure this round's plans 05-33/05-34 were written to fix. 05-LIVE-CHALLENGE-TRANSCRIPT.md is confirmed byte-identical to its pre-closure state; both verdict lines remain UNJUDGED. No live run was attempted this round, by design (all three plans prohibited spending a credential)."
  - truth: "(New, this round) A config-isolated live run presents the developer's OWN claude.ai subscription credential to the backend by reference, and the composed directory actually satisfies the real `claude` binary's own authentication check end to end."
    test: "Run `claude auth status` (or the live arm itself) against a directory produced by composeIsolatedClaudeConfigDir({}) with its default source (the developer's real ~/.claude), and confirm it reports loggedIn:true, authMethod:'claude.ai' — this reaches no API and spends nothing, but no such check exists as a committed, repeatable test."
    expected: "The composed directory authenticates the real backend exactly as the plan's one-time manual measurement found."
    why_human: "Every self-test and replay-check exercising this mechanism (grep-confirmed: `composeIsolatedClaudeConfigDir(` is called only against synthetic `source` directories built inside the test files) uses a synthetic stand-in credential file, never the developer's real ~/.claude, and `readClaudeAuthStatus` — the ONE function that would run the real `claude auth status` against a composed directory — is by the plan's own acceptance criteria never invoked from any self-test (\"No self-test check invokes readClaudeAuthStatus; every authentication check injects its own reader\"). The claim that the composed directory actually satisfies the real binary's auth check rests on a single manual measurement recorded in 05-33-PLAN.md's prose (taken once, at zero cost, before any code was written) — real, but not reproducible from the repository, and not re-run this session (doing so would require access to a real ~/.claude on the verifying machine, which this environment does not have configured for this developer). The eventual live run is therefore not only the live-dialogue-quality judgment call — it is also the FIRST end-to-end proof that this round's fix actually works against a real credential, not only against synthetic fixtures."
coincidental_reliance_items: []
human_verification:
  - test: "Live challenge quality (SHAPE-01) and draft usefulness (SHAPE-03) — run scripts/uat/uat-08-socratic-authoring.mjs in live mode against a real claude binary and credentials. This is the developer's own decision, still unanswered by design; this verification does not push toward taking it."
    expected: "During the challenge stage the agent pushes back on the developer's stated premise and asks substantive clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or clearly need amendment. Both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md get filled with the developer's own words. Two outcomes worth reporting rather than treating as failures, per 05-35-PLAN.md's own human-check: a refusal naming an authentication method the harness does not accept, and a reading of `uncorrelatable` (meaning the live tool_use block carries no id — the one assumption plan 05-30 could not measure offline)."
    why_human: "Judgment about live model dialogue quality and draft usefulness; no structural check can certify either. Additionally — and this is new information this round surfaces — this run will be the first time composeIsolatedClaudeConfigDir's credential-presentation mechanism is exercised against a real ~/.claude directory and a real backend rather than against a synthetic fixture; if the composed directory does not actually authenticate (contradicting the plan's one-time manual measurement), that is itself a new, reportable finding, not a failure of this verification."
---

# Phase 5: Socratic Epic Authoring Verification Report

**Phase Goal:** Cyril shapes a new epic by being challenged rather than interviewed, and walks away
with structured board items instead of a document.
**Verified:** 2026-09-25T19:00:00Z
**Status:** human_needed
**Re-verification:** Yes — this replaces the prior `05-VERIFICATION.md` (status `human_needed`,
29/29 with 1 present-but-behavior-unverified, 2026-09-25T14:00:00Z). That report's own outstanding
human-verification item (no completed, judgeable live run) is unchanged in kind, but a live UAT run
executed between that report and this one (`05-UAT.md`) discovered gap `G-05-6` — three NEW findings
this round's three plans (05-33, 05-34, 05-35) close.

## Scope of This Session

This session executed only the three gap-closure plans 05-33/05-34/05-35 (`--gaps-only`), targeting
gap `G-05-6` from `05-UAT.md`. Plans 05-01 through 05-32 were already complete, already verified in
the prior `05-VERIFICATION.md` (status `human_needed`, no `gaps:`), and are treated as established —
quick regression check only, per this workflow's re-verification optimisation. This report covers
the WHOLE phase's goal, not just this round's diff.

## Goal Achievement

### Observable Truths — Roadmap Success Criteria (regression-checked this session)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | (SC1) User starts a conversational session to shape a new epic and the agent challenges his assumptions and asks clarifying questions before any work is planned. | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Structural mechanism unchanged and still holds (proposal tools structurally gated by stage until a human advances; `packages/core`/`packages/desktop` confirmed untouched by this round's diff: `git diff --stat e057324..HEAD -- packages/core packages/desktop` empty). The live dialogue-quality judgment itself remains unmeasured — see behavior_unverified_items #1. |
| 2 | (SC2) The session's outcome lands directly on the board as a structured epic with child tasks and drafted acceptance criteria for each task — not as a markdown file or a chat log. | ✓ VERIFIED | Unchanged; not touched by this round's diff. `cargo build` and `cargo test` reported by the orchestrator this session as pass (0 failures, all crates); `npm --prefix packages/sidecar test` 158/158 pass (re-confirmed: adapter.ts/claude-code-adapter.ts field additions did not regress the rest of the suite). |
| 3 | (SC3) User accepts, rejects or amends each proposed item and each drafted criterion individually, rather than accepting the set wholesale. | ✓ VERIFIED | Unchanged; not touched by this round's diff. Same regression basis as SC2. |
| 4 | (SC4) User reopens an epic weeks later, continues shaping it, and the agent challenges the change against what the epic already contains. | ✓ VERIFIED | Unchanged; not touched by this round's diff. Same regression basis as SC2. |

### Observable Truths — This Round's Gap-Closure Plans (05-33, 05-34, 05-35; G-05-6)

| # | Truth (source plan) | Status | Evidence |
|---|---|---|---|
| 5 | A config-isolated live run presents the developer's OWN claude.ai subscription credential to the backend, by reference, with no API key anywhere in the resolved spawn environment (05-33). | ✓ VERIFIED (structural), see also behavior_unverified_items #2 | `composeIsolatedClaudeConfigDir`, `CREDENTIAL_LINK_ALLOWLIST` (`Object.freeze([".credentials.json"])`) confirmed by direct reading (`sidecar-harness.mjs:58,122`); `grep -cE '\bfs\.(copyFileSync\|cpSync\|appendFileSync)\('` reports `0` — no duplication call exists, so the mechanism cannot copy. The structural correctness of the linking/scrubbing logic is proven by 19 re-run `[Plan 05-33, Task 1/2/3]` self-test PASS lines (independently re-run this session, exit 0). The unmeasured half — whether the composed directory actually satisfies the REAL `claude` binary's auth check — is not covered by any committed test; see behavior_unverified_items #2. |
| 6 | The developer's personal behavioural configuration is absent from the config directory the session under test runs against, asserted by a directory-content check that throws, not a comment (05-33). | ✓ VERIFIED | `BEHAVIOURAL_CONFIG_DENYLIST` confirmed present (`sidecar-harness.mjs:72`); `assertClaudeConfigIsolated`'s three content checks (denylist-absent, allowlist-only-symlinks, allowlist-entries-are-symlinks) confirmed by direct reading and by re-running `[Plan 05-33, Task 1]` self-tests this session — "a planted behavioural entry... makes assertClaudeConfigIsolated throw, naming that entry" and "an extra, non-allow-listed symbolic link... makes assertClaudeConfigIsolated throw" both PASS. |
| 7 | The live arm reads the backend's authentication state BEFORE spawning anything and refuses the run with a named, accurate cause when it cannot authenticate as the developer (05-33). | ✓ VERIFIED | `assertBackendAuthenticated` confirmed present (`sidecar-harness.mjs:324`), confirmed by direct reading to refuse on null/not-logged-in/unrecognised-method/directory-mismatch, each with a named message prefixed `HARNESS PRECONDITION FAILED:`. 6 re-run `[Plan 05-33, Task 2]` self-test PASS lines confirm every refusal path. Call-site ordering (`assertBackendAuthenticated` before `harness.startSidecar()`) is asserted by the plan's own acceptance criteria and not contradicted by any reading this session. |
| 8 | The credential path actually in force is recorded in the run's own evidence (05-33). | ✓ VERIFIED | `renderChallengeEvidenceSheet`'s `credentialPath` input confirmed by direct reading and by 3 re-run `[Plan 05-33, Task 3]` self-test PASS lines: byte-identical-when-absent, heading ordered above the verdict section, and no identity string leaks through. |
| 9 | Every property in 05-33 is proven by `--self-test` against synthetic directories and injected auth-status payloads — no live arm, no credential spent, no network call (05-33). | ✓ VERIFIED | `05-LIVE-CHALLENGE-TRANSCRIPT.md` confirmed byte-identical to its pre-round state (same file, unchanged — see truth #20 below); `--self-test` re-run this session, exit 0, no child process spawned (confirmed by the script's own closing line: "no child process was spawned"). |
| 10 | A backend message that is not agent speech is identified from a wire fact, not from prose shape (05-34). | ✓ VERIFIED | `classifyNonConversationTurn` confirmed by direct reading (`sidecar-harness.mjs:784`) to check `NON_CONVERSATION_SOURCES`-named wire signals (assistant envelope error flag, result-line error flag) before falling back to the retained text-banner reader. Independently reproduced this session: `AssistantTextEvent.isApiErrorMessage`/`errorCode` and `ResultEvent.isError`/`terminalReason` confirmed present on `adapter.ts` (lines 39,44,140,145) and populated in `claude-code-adapter.ts::normaliseStreamEvent` (lines 669, 693-695) via conditional spread. |
| 11 | The run stops at the turn where the non-conversation message appears, instead of counting it as an agent turn and waiting out the full proposal deadline (05-34). | ✓ VERIFIED | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario unauthenticated-backend-first-turn` independently re-run this session, exit 0; observed log line: "driver stopped at the unauthenticated first turn — source=assistant_envelope_error_flag elapsed=70ms (well under REPLAY_TURN_DEADLINE_MS=10000ms) — settled=false", followed by "skipping advance-stage for this scenario" and a confirmed `authoringStage=challenge` read-back. |
| 12 | An unauthenticated backend's first turn is reproducible offline, end to end through the real sidecar and the real shipped normaliser, as a named `--replay-check` scenario (05-34). | ✓ VERIFIED | Same run as #11. `node -e "...Object.keys(SCENARIOS).length..."` independently run this session: returns `11`, includes `unauthenticated-backend-first-turn`. Full `--replay-check` (all 11 scenarios) independently re-run this session, exit 0. |
| 13 | The wire facts the backend already sends reach the harness as normalised fields rather than being dropped at the adapter seam (05-34). | ✓ VERIFIED | Confirmed by direct reading of `claude-code-adapter.ts:669,693-695` and `adapter.ts:39,44,140,145`, independently (not merely re-quoted from 05-REVIEW.md). |
| 14 | A block or line declaring none of the wire-error fields normalises without throwing and omits each absent field entirely (05-34). | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED (narrow edge case) | The conditional-spread idiom correctly omits absent/malformed fields on an ORDINARY object lacking them (confirmed by direct reading and by the orchestrator's reported 158/158 sidecar-test pass, which includes `adapter.test.mjs`'s has-own-property assertions). However, I independently reproduced a genuine throw on the degenerate case where the parsed line is the JSON literal `null` itself (not an object lacking fields, but no object at all): `node -e` against the built `dist/claude-code-adapter.js`, calling `normaliseStreamEvent(null, 'null', ...)`, threw `Cannot read properties of null (reading 'type')`. This is pre-existing code (not introduced by this round — confirmed: 05-REVIEW.md's WR-03 labels it "pre-existing code" and it sits at `claude-code-adapter.ts:596`, ahead of this round's own additions), but it directly undercuts an unqualified reading of this truth and sits in the exact function this round's own plan required to "normalise without throwing." See Anti-Patterns Found. |
| 15 | The doc comment describing the event model matches the shipped event model (05-34). | ✓ VERIFIED | `test "$(grep -c 'carries a correlation id, so there is nothing finer-grained' scripts/uat/lib/sidecar-harness.mjs)" = "0"` independently re-run this session, passes — the false sentence is confirmed gone. |
| 16 | Every shipped description in `scripts/uat/` matches the code it describes — no bullet survives describing a comparison the code no longer makes (05-35). | ✓ VERIFIED, with one narrow residual (see Anti-Patterns) | `grep -c 'as it shipped on 2026-09-24' scripts/uat/README.md` independently re-run this session, reports `0` — the specific stale clause 05-REVIEW.md's prior-round WR-01 flagged is confirmed removed. However, this round's OWN review (`05-REVIEW.md`, this closure) found a NEW instance of the same defect class inside `uat-08-socratic-authoring.mjs` itself (WR-01, this round) — see Anti-Patterns Found. The truth as stated ("no bullet survives...") is true for the README target it names; the recurrence inside the script proper is a distinct, narrower finding. |
| 17 | README Item 8 records the seventh finding, its root cause, and the rule it earns (05-35). | ✓ VERIFIED | `grep -c 'SEVENTH' scripts/uat/README.md` independently re-run this session, reports `1`. `unauthenticated-backend-first-turn` and `CREDENTIAL_LINK_ALLOWLIST` both confirmed present by direct grep. |
| 18 | An operator can read, in one place, how the live arm authenticates, what it isolates, and what makes it refuse (05-35). | ✓ VERIFIED | Confirmed by direct reading: README names `CREDENTIAL_LINK_ALLOWLIST`, `BEHAVIOURAL_CONFIG_DENYLIST`, `assertBackendAuthenticated`, `scrubApiKeyEnv` in an operator-facing section. |
| 19 | The validation ledger carries a row for every task in this closure, each naming a command actually run and observed (05-35). | ✓ VERIFIED | `grep -cE '^\| 05-3[3-5]-0[0-9] \|' 05-VALIDATION.md` independently re-run this session, reports `8`. |
| 20 | No existing ledger row is turned green and the red `05-22-03` row is textually unchanged; `05-LIVE-CHALLENGE-TRANSCRIPT.md` untouched, both verdict lines unfilled (05-35). | ✓ VERIFIED | `grep -c '^| 05-22-03 |.*❌ red' 05-VALIDATION.md` reports `1`, independently re-run. `05-LIVE-CHALLENGE-TRANSCRIPT.md` confirmed by direct reading: run `01M3BSKG32D3QRDGEJJS2B7YHD`, both verdict lines still literally `UNJUDGED`. `git diff --stat e057324..HEAD` confirms the transcript file is absent from the round's changed-file list. |
| 21 | SHAPE-01 and SHAPE-03 remain unchecked and both live verdict lines remain UNJUDGED (05-35). | ✓ VERIFIED | `grep -c '^- \[ \] \*\*SHAPE-01\*\*' .planning/REQUIREMENTS.md` and the SHAPE-03 equivalent both independently re-run this session, report `1` each; `grep -c '^- \[x\] \*\*SHAPE-0[245]\*\*'` reports `3`; `grep -ci 'ANTHROPIC_API_KEY' .planning/REQUIREMENTS.md` reports `0`. |

**Score:** 21/21 truths cleanly resolved to VERIFIED or an explicitly-scoped VERIFIED-with-residual
(0 FAILED). 1 roadmap truth (#1) and 1 this-round truth (#14) are ⚠️ PRESENT_BEHAVIOR_UNVERIFIED,
excluded from the numerator per this workflow's scoring rule and reported separately below and in
`behavior_unverified_items`. A second, NEW behavior-unverified item (the credential mechanism's
real-world efficacy against a real `~/.claude`, not only synthetic fixtures) is also recorded there
even though no single 05-33 must-have truth names it explicitly — it is the necessary sibling of
truth #5 and is exactly the kind of gap this workflow's Level-4 data-flow discipline exists to catch.

### Deferred Items

None. Checked against `roadmap.analyze`'s later-phase entries; none map to this phase's live UAT
instrument or its credential seam.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `scripts/uat/lib/sidecar-harness.mjs` (`CREDENTIAL_LINK_ALLOWLIST`, `BEHAVIOURAL_CONFIG_DENYLIST`, `composeIsolatedClaudeConfigDir`, `HARNESS_PRECONDITION_PREFIX`, `API_KEY_ENV_VARS`, `scrubApiKeyEnv`, `ACCEPTED_AUTH_METHODS`, `summariseAuthStatus`, `readClaudeAuthStatus`, `assertBackendAuthenticated`) | Credential-presentation + auth-precondition mechanism | ✓ VERIFIED | All ten symbols confirmed present by direct grep this session, at the line numbers cited above. |
| `scripts/uat/lib/sidecar-harness.mjs` (`NON_CONVERSATION_SOURCES`, `classifyNonConversationTurn`) | Categorical non-conversation classifier | ✓ VERIFIED | Both confirmed present (lines 727, 784). |
| `packages/sidecar/src/adapter.ts` (`AssistantTextEvent.isApiErrorMessage/errorCode`, `ResultEvent.isError/terminalReason`) | Wire-error fields carried onto normalised events | ✓ VERIFIED | Confirmed present, correctly typed, documented. |
| `packages/sidecar/src/claude-code-adapter.ts` (`normaliseStreamEvent`) | Reads envelope/result error fields via conditional spread | ✓ VERIFIED, WITH ONE ADJACENT ROBUSTNESS GAP | Each field correctly spread on strict type checks; the adjacent, pre-existing `null`-line throw is a separate finding (see Anti-Patterns). |
| `packages/sidecar/test/adapter.test.mjs` | New round-trip/absence/fixture-based tests | ✓ VERIFIED | Orchestrator-confirmed 158/158 pass this session; frozen-fixture test presence confirmed by direct reading. |
| `scripts/uat/fixtures/unauthenticated-cli-first-turn.json` | Real frozen capture, 3 lines, error fields present | ✓ VERIFIED | Confirmed by the earlier round's grep gates (`is_api_error_message`, `is_error`, `terminal_reason` all present ≥1); no credential material found in the file (structurally guaranteed — captured from an empty config directory). |
| `scripts/uat/lib/fake-authoring-claude.mjs` (`unauthenticated-backend-first-turn` scenario) | Replays the frozen capture offline | ✓ VERIFIED | Confirmed present; registry count 11, independently confirmed this session. |
| `scripts/uat/README.md` | Corrected bullet, seventh finding, fifth rule, credential-seam section | ✓ VERIFIED | All four independently confirmed present this session by direct grep. |
| `05-LIVE-CHALLENGE-TRANSCRIPT.md` | Untouched, both verdict lines UNJUDGED | ✓ VERIFIED | Confirmed by direct reading. |
| `05-VALIDATION.md` | 8 new task rows, red row unchanged | ✓ VERIFIED | Confirmed by direct grep. |
| `.planning/REQUIREMENTS.md` | SHAPE-01/SHAPE-03 unchecked, narrowed, no API-key mention | ✓ VERIFIED | Confirmed by direct grep. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `composeIsolatedClaudeConfigDir` | the live arm's spawn env | `cleanClaudeConfigEnv` → `Object.assign(env, harness.cleanClaudeConfigEnv())` | ✓ WIRED | Confirmed by direct reading; the live arm's call site is unchanged in shape, extended with a `step()` line. |
| `assertClaudeConfigIsolated(env, {configDir})` | the composed directory's own entries | lstat-based content checks | ✓ WIRED | Confirmed by direct reading and by 6 re-run self-test PASS lines this session. |
| `assertBackendAuthenticated` | the live arm | called before `harness.startSidecar()` | ✓ WIRED (structurally) | Confirmed by direct reading of call order; NOT exercised against a real backend by any committed test — see behavior_unverified_items #2. |
| `summariseAuthStatus` | `renderChallengeEvidenceSheet`'s credential-path section | `credentialPath` input | ✓ WIRED | Confirmed by direct reading and 3 re-run self-test PASS lines. |
| the assistant envelope's `is_api_error_message`/`error` | `AssistantTextEvent.isApiErrorMessage`/`errorCode` | `normaliseStreamEvent`'s conditional spread | ✓ WIRED | Confirmed by direct reading; independently reproduced this session against the real fixture data shape. |
| the result line's `is_error`/`terminal_reason` | `ResultEvent.isError`/`terminalReason` | `normaliseStreamEvent`'s conditional spread | ✓ WIRED | Confirmed by direct reading. |
| `classifyNonConversationTurn` | `accumulateTurn`'s `nonConversation` field | both return paths, renamed from `refusal` | ✓ WIRED | Confirmed by direct reading and grep (`nonConversation` appears ≥2 times as required). |
| `accumulateTurn`'s `nonConversation` | the driver's stop-at-detection path | `runReplayCheckScenario`'s branch for the new scenario | ✓ WIRED | Confirmed by independently re-running `--replay-check --scenario unauthenticated-backend-first-turn` this session; observed the driver stop on turn one, well under the deadline. |
| the fake backend's `unauthenticated-backend-first-turn` scenario | the harness's own gate before `advance-stage` | `scenarioName === "backend-refuses-mid-conversation" \|\| scenarioName === "unauthenticated-backend-first-turn"` | ⚠️ WIRED BUT FRAGILE | Functionally correct for the two scenarios that exist today (confirmed by the passing replay run), but the gate is a literal scenario-NAME list rather than a read of `conversation.nonConversation` — the generalised signal the code's own adjacent comment claims was used. See Anti-Patterns Found (WR-01, this round). A third non-conversation scenario added without updating this list would silently reintroduce the exact D-90 defect this closure exists to prevent. |

### Data-Flow Trace (Level 4)

Not applicable in the UI-rendering sense — this round's touched artifacts are the adapter seam (four
TypeScript interface fields and a normaliser function), a verification instrument (harness library +
UAT script), a frozen fixture, and tracked documents, not UI components rendering dynamic data.
Level-4-style tracing WAS applied to the credential mechanism specifically (see behavior_unverified_items
#2): the self-test/replay-check evidence traces only to synthetic fixture directories and injected
payloads, never to the real `~/.claude` + real `claude auth status`, which is the "static fallback
only, never the real source" pattern Level 4 exists to flag — reported honestly rather than counted
as a full pass.

### Code Review Findings — Fix Verification

`05-REVIEW.md` (this round, `reviewed: 2026-09-25T00:00:00Z`, 8 files reviewed, `status: issues_found`
— 0 critical, 3 warning, 0 info) is the independent review for this round's diff. Every finding
independently re-confirmed against HEAD this session, not taken on the review's word:

| ID | Issue | Review's Classification | My Independent Finding |
|---|---|---|---|
| WR-01 (this round) | The `--replay-check` advance-stage skip is gated on a literal two-scenario `\|\|` name list, while the adjacent comment claims the behaviour was "generalised by plan 05-34 (G-05-6)" — the generalised signal `conversation.nonConversation` exists and is unused there. | Warning, non-blocking | ✓ CONFIRMED, reproduced by direct reading of `uat-08-socratic-authoring.mjs:4281`. This is the same defect *class* (positional/name-based inference standing in for a fact the code already computed) this entire phase's Item 8 rule exists to eliminate — recurring here inside the instrument meant to catch its recurrence. Real, not cosmetic; a future third non-conversation scenario not added to this literal list would silently reopen gap G-05-3/G-05-6's exact failure mode. Kept as a Warning (not elevated to a blocker) because it is correct for every scenario that exists TODAY, is not exercised as wrong by any current test, and the review itself — independently tasked with adversarial scrutiny of this exact diff — rated it non-blocking. |
| WR-02 (this round) | `isApiErrorMessage` silently drops an explicit wire `false`, unlike its sibling `isError` which explicitly carries a literal `false`. | Warning, non-blocking | ✓ CONFIRMED by direct reading, `claude-code-adapter.ts:669`: `envelope.is_api_error_message === true ? {...} : {}` (boolean-only membership, not `typeof === "boolean"`). No capture in this repository exercises an explicit `false` on this field, so the asymmetry is currently unreachable by any known real backend shape, but it is a genuine, unintentional-looking inconsistency between two fields introduced in the identical commit for the identical purpose. |
| WR-03 (this round, on pre-existing code) | `normaliseStreamEvent` can throw on a stdout line that parses as JSON `null`. | Warning, non-blocking | ✓ CONFIRMED AND INDEPENDENTLY REPRODUCED this session (not merely re-read): `node -e` against the built `dist/claude-code-adapter.js` calling `normaliseStreamEvent(null, 'null', 'run1', 1, <at>)` threw `TypeError: Cannot read properties of null (reading 'type')`. This sits inside a synchronous `readline` `'line'` handler, outside the `try`/`catch` that guards `JSON.parse`, and an uncaught throw there crashes the sidecar process for the whole fleet, not just the run whose backend emitted the line — a real, if narrow-probability (requires a bare `null` line), robustness gap directly adjacent to the exact function this round's own plan required to "normalise without throwing" on an absent-field block. Pre-existing (not introduced by 05-33/05-34/05-35's own diff), and kept as a Warning per the review's own severity call and the low real-world likelihood of a genuine Claude Code CLI ever emitting a bare `null` line — but flagged prominently here rather than allowed to quietly recur an eighth time under a different name. |

### Requirements Coverage

| Requirement | Source Plan(s) (this round) | Description | Status | Evidence |
|---|---|---|---|---|
| SHAPE-01 | 05-33, 05-34, 05-35 | Conversational session challenges before planning | ◐ INSTRUMENT + CREDENTIAL SEAM FIXED; LIVE JUDGMENT OUTSTANDING | The prior live-run blocker (config isolation stripping the credential) and the non-conversation-classification gap (readBackendRefusal's prose-bound prefix) are both genuinely closed at the structural level, verified independently this session. `.planning/REQUIREMENTS.md` itself correctly marks this "Gaps Found" pending the still-outstanding live judgment — this verification agrees with that self-assessment rather than overriding it, and additionally flags that the credential mechanism's real-world efficacy is itself still unproven against a real `~/.claude` (behavior_unverified_items #2). |
| SHAPE-02 | — (not touched this round) | Outcome writes directly to board | ✓ SATISFIED | Truth #2, unchanged this round; `REQUIREMENTS.md` correctly marks Complete. |
| SHAPE-03 | 05-33, 05-34, 05-35 (same seam) | Agent drafts acceptance criteria, editable | ◐ INSTRUMENT + CREDENTIAL SEAM FIXED; LIVE JUDGMENT OUTSTANDING | Same instrument dependency and same caveat as SHAPE-01. Draft-usefulness human judgment still outstanding. |
| SHAPE-04 | — (not touched this round) | Accept/reject/amend individually | ✓ SATISFIED | Truth #3, unchanged this round; `REQUIREMENTS.md` correctly marks Complete. |
| SHAPE-05 | — (not touched this round) | Reopen and continue shaping | ✓ SATISFIED | Truth #4, unchanged this round; `REQUIREMENTS.md` correctly marks Complete. |

No orphaned requirements — `.planning/REQUIREMENTS.md`'s "Phase 5" row lists exactly these five IDs,
all accounted for above.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `scripts/uat/uat-08-socratic-authoring.mjs` | ~4281 | Literal two-scenario-name `\|\|` gate, contradicting the adjacent comment's "generalised" claim; `conversation.nonConversation` exists and is unused here | ⚠️ Warning | A future non-conversation scenario not added to this list silently reopens the D-90/G-05-3 failure class inside the very instrument meant to catch it. Correct today; fragile going forward. |
| `packages/sidecar/src/claude-code-adapter.ts` | 669 | `isApiErrorMessage` uses `=== true` membership instead of `typeof === "boolean"`, unlike its sibling `isError` | ⚠️ Warning | An explicit wire `false` on this field (currently unobserved in any capture) would be indistinguishable from an absent field. No known real backend shape triggers this today. |
| `packages/sidecar/src/claude-code-adapter.ts` | ~596, ~1117, ~1344 | `normaliseStreamEvent(parsed, ...)` is called without checking `parsed !== null`/`typeof parsed === "object"`; a stdout line that parses as JSON `null` throws inside a synchronous readline handler, uncaught | ⚠️ Warning | Independently reproduced this session (see Code Review Findings, WR-03). Pre-existing, narrow-probability trigger, but the failure mode (uncaught exception crashing the shared sidecar process for the whole fleet) is more severe than a typical "Warning" implies if it is ever hit; flagged here rather than allowed to recur silently. |

No debt markers (`TBD`/`FIXME`/`XXX`) or cleanup markers (`TODO`/`HACK`/`PLACEHOLDER`) found in this
round's touched files, confirmed by direct grep this session across every file this round's diff
touched.

### Behavioral Spot-Checks

Run directly by this verification, in this session, not re-quoted from any SUMMARY or from the
orchestrator's pre-verification facts alone (each independently reproduced):

| Check | Method | Result | Status |
|---|---|---|---|
| Offline self-test | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | Exit 0; observed 19+ `[Plan 05-33, *]` PASS lines plus the full pre-existing battery; closing line "no child process was spawned" | ✓ PASS |
| Offline replay, full 11-scenario run | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` | 11/11 scenarios PASS, exit 0 (including the new `unauthenticated-backend-first-turn`) | ✓ PASS |
| Offline replay, targeted new scenario | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario unauthenticated-backend-first-turn` | Exit 0; observed `source=assistant_envelope_error_flag elapsed=70ms`, stage confirmed still `challenge` | ✓ PASS |
| `packages/desktop`'s flaky test, isolated re-run | `npx vitest run "src/authoring/__tests__/proposal-keyboard.test.tsx"` (from `packages/desktop`) | 8/8 pass this run | ✓ PASS (this run) — see Advisory for the orchestrator's 4-run flake finding |
| Adjacent robustness gap, adversarial probe | `node -e` calling `normaliseStreamEvent(null, 'null', ...)` against the built `dist/claude-code-adapter.js` | `TypeError: Cannot read properties of null (reading 'type')` | ✗ THREW — confirms WR-03, reported under Anti-Patterns Found, not elevated to a gap |
| Symbol presence, all ten G-05-6 credential/classification exports | `grep -n` against `sidecar-harness.mjs` | All ten symbols present at the expected lines | ✓ PASS |
| Scenario registry count | `node -e` importing `fake-authoring-claude.mjs` | `11 true` (count, and `unauthenticated-backend-first-turn` present) | ✓ PASS |
| `packages/core`/`packages/desktop` untouched this round | `git diff --stat e057324..HEAD -- packages/core packages/desktop` | empty output | ✓ PASS |
| `05-LIVE-CHALLENGE-TRANSCRIPT.md` untouched this round | direct read + absence from `git diff --stat e057324..HEAD` file list | confirmed untouched, both verdict lines UNJUDGED | ✓ PASS |

### Human Verification Required

#### 1. Live challenge quality (SHAPE-01), draft usefulness (SHAPE-03), AND whether the new credential seam actually works against a real backend

**Test:** Run `scripts/uat/uat-08-socratic-authoring.mjs` in live mode (no flags) against a real
`claude` binary and credentials, and read the whole conversation `05-LIVE-CHALLENGE-TRANSCRIPT.md`
records.
**Expected:** The agent pushes back on the developer's stated premise and asks substantive
clarifying questions rather than affirming it; the drafted acceptance criteria are usable as-is or
clearly need amendment. Fill both verdict lines with the developer's own words. Per 05-35-PLAN.md's
own human-check, two outcomes are worth reporting rather than treating as failures: a refusal naming
an authentication method the harness does not accept, and a reading of `uncorrelatable` (meaning the
live `tool_use` block carries no id).
**Why human:** Judgment about live model dialogue quality and draft usefulness — no structural check
can certify either. This session additionally confirms that the credential-presentation mechanism
this round shipped (`composeIsolatedClaudeConfigDir`) has ONLY ever been exercised against synthetic
fixture directories in every committed test (grep-confirmed: no self-test calls it against the real
default `PERSONAL_CLAUDE_CONFIG_DIR`, and `readClaudeAuthStatus` — the function that would run the
real `claude auth status` — is by design never invoked from any self-test). The claim that it
actually authenticates rests on one manual, non-reproducible measurement recorded in the plan's prose.
This live run is therefore not only the dialogue-quality judgment call, but also the first real proof
that this round's fix works end to end against the developer's actual credential — a genuinely new
consideration this round introduces, not present in the prior report's framing of this same
outstanding item.

### Gaps Summary

None. This round's three plans genuinely close all three findings of gap `G-05-6`: the credential/
config-isolation conflation (BLOCKER), the prose-bound non-conversation classifier (MAJOR), and two
stale descriptions (MINOR). I did not accept the SUMMARYs' or the prior review's word for any of
these — I independently re-read the shipped `composeIsolatedClaudeConfigDir`/`assertBackendAuthenticated`/
`classifyNonConversationTurn` implementations, independently re-ran `--self-test` and `--replay-check`
(including the specific new scenario), and independently reproduced one of this round's own review
findings (WR-03) by direct code execution rather than by trusting the review's prose description of it.

What remains open is exactly what the phase's own design leaves open by choice, now with one sharpened
edge: the live dialogue-quality and draft-usefulness judgments, which no automated instrument can
make — AND, newly visible this round, the fact that the credential mechanism meant to make that live
run reachable has itself never been proven against a real credential by any committed, reproducible
test. Neither is a gap in this closure's own work (both are explicitly out of scope by the plans'
own prohibitions, which were followed faithfully), but both deserve to be named rather than assumed
away, which is why this report routes to `human_needed` rather than `passed` and expands the human-
verification item's own scope rather than repeating the prior report's wording verbatim.

Three Warning-level findings (WR-01, WR-02, WR-03) and one pre-existing, unrelated flaky test are
recorded above and in the frontmatter's `advisory`/anti-pattern sections. None is elevated to a
blocker: none is a debt marker, none is new-scope in the sense of contradicting a stated must-have,
and each was independently re-derived (not merely re-quoted) and found consistent with the
independent code review's own non-blocking severity call.

---

_Verified: 2026-09-25T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
