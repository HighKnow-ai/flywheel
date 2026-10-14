---
phase: 05-socratic-epic-authoring
plan: 33
subsystem: testing
tags: [uat-harness, credentials, config-isolation, gap-closure, security]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "The scratch CLAUDE_CONFIG_DIR isolation mechanism (plan 03-19/03-20), the fail-closed noWorkPlanned/correlation machinery (plans 05-23/05-27/05-30/05-31), and the UAT-8 live-arm shape (plans 05-10/05-18/05-20/05-24/05-25)"
provides:
  - "composeIsolatedClaudeConfigDir + CREDENTIAL_LINK_ALLOWLIST/BEHAVIOURAL_CONFIG_DENYLIST — a config-isolated session presents the developer's own claude.ai credential by symbolic-link reference, never a copy, while asserting none of the developer's behavioural configuration (CLAUDE.md, settings, skills, agents, commands, hooks, plugins) reaches the session under test"
  - "assertBackendAuthenticated + scrubApiKeyEnv + ACCEPTED_AUTH_METHODS — the live arm refuses BEFORE spawning any process when the backend cannot authenticate as the developer, and no ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN can survive into a spawned session's environment"
  - "renderChallengeEvidenceSheet's credentialPath section + a durable uat-08-credential-path artifact — the authentication method and resolved configuration directory in force for a run are recorded in that run's own evidence, closing the exact blind spot that made validation ledger row 05-22-03's credential path unrecoverable"
affects: [05-socratic-epic-authoring]

# Actuals (#2632) — chars/4 over the realized diff (scripts/ only), not a harness token count
actuals:
  tokens: 10564
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Credential-by-reference composition: an ALLOW-list of entry names to symlink (never copy) from a personal config directory into a scratch one, paired with a DENY-list as a second, independently-triggered fence — nothing is denied only by an allow-list's silent omission"
    - "Precondition refusal messages share one literal prefix (HARNESS_PRECONDITION_PREFIX) so a script's stdout distinguishes 'this run correctly refused to start' from 'something broke mid-run' at a glance"
    - "Auth-status summaries are built key-by-key into a brand-new object (never spread-then-delete) so an identity field a future backend version adds is dropped by construction, not by a delete-list nobody updated"

key-files:
  created: []
  modified:
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "HARNESS_PRECONDITION_PREFIX is defined once, in the Task 1 commit, and reused by Task 2's assertBackendAuthenticated — the plan's own action text attributed its 'introduction' to Task 2, but Task 1's composeIsolatedClaudeConfigDir already needed it for its own empty-link-set refusal, so defining it once, earlier, and citing it from both places avoided a forward reference with no functional difference to either task's acceptance criteria."
  - "cleanClaudeConfigEnv() keeps its existing single-object return shape (only CLAUDE_CONFIG_DIR) and instead records the full composition (configDir, linkedEntries, sourceConfigDir) on a new harness.lastComposedClaudeConfig instance field — merging linkedEntries/sourceConfigDir into the returned env map would have handed a non-string array into a map whose values eventually become real OS environment variables for the spawned backend."
  - "assertBackendAuthenticated and its scrubApiKeyEnv/step() call site were placed BEFORE harness.startSidecar() (not merely before the authoring_spawn request), satisfying the plan's own acceptance criterion with margin — a refusal now costs strictly less than the minimum the plan required."
  - "SHAPE-01/SHAPE-03 are intentionally NOT marked Complete in REQUIREMENTS.md by this plan (must_haves.prohibitions) — the requirements-completed field below is a verbatim copy of the plan's own frontmatter requirements array per the summary template's contract, not a completion signal; REQUIREMENTS.md's checkboxes for both stay unchecked and 05-LIVE-CHALLENGE-TRANSCRIPT.md's verdict lines stay unfilled."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "A config-isolated spawn environment composes a directory that presents the developer's own claude.ai credential by symbolic-link reference and contains none of the developer's behavioural configuration, both asserted offline"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test (7 checks labelled [Plan 05-33, Task 1])"
        status: pass
      - kind: other
        ref: "grep -cE '\\bfs\\.(copyFileSync|cpSync|appendFileSync)\\(' scripts/uat/lib/sidecar-harness.mjs -> 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "The live arm refuses before any process is spawned, naming what was observed and expected, when the backend cannot authenticate as the developer; no API-key variable survives into a spawned session's environment"
    requirement: "SHAPE-01"
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test (7 checks labelled [Plan 05-33, Task 2])"
        status: pass
      - kind: other
        ref: "grep -c 'ANTHROPIC_API_KEY' scripts/uat/lib/sidecar-harness.mjs -> 1 (inside API_KEY_ENV_VARS only)"
        status: pass
      - kind: other
        ref: "assertBackendAuthenticated call site (line 4275) precedes harness.startSidecar() (line 4296) in the live arm"
        status: pass
    human_judgment: false
  - id: D3
    description: "The credential path in force (method, logged-in state, resolved configuration directory) is recorded in the run's evidence sheet and in a durable artifact"
    requirement: "SHAPE-03"
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test (3 checks labelled [Plan 05-33, Task 3])"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check (all 10 scenarios pass; 05-LIVE-CHALLENGE-TRANSCRIPT.md byte-identical to its committed state)"
        status: pass
    human_judgment: false
  - id: D4
    description: "SHAPE-01/SHAPE-03's live judgements remain reachable-but-unspent by this plan — no live arm run, no credential spent, both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md stay UNJUDGED"
    human_judgment: true
    rationale: "Whether the live arm's first real run actually authenticates cleanly and whether the challenge/draft-usefulness dialogue itself is good enough is a live judgement outside this plan's scope by explicit prohibition (must_haves.prohibitions) — a human must run the live arm deliberately, spending a real credential, before either verdict line can be filled."

duration: 55min
completed: 2026-09-25
status: complete
---

# Phase 5 Plan 33: Separate Config Isolation From Credential Availability Summary

**A composed, symlink-only Claude config directory presents the developer's claude.ai credential to a config-isolated UAT session while denying every behavioural entry; the live arm now refuses before spawning when it cannot authenticate, scrubs API-key env vars unconditionally, and records the credential path actually in force in both the evidence sheet and a durable artifact.**

## Performance

- **Duration:** 55 min
- **Tasks:** 3 completed
- **Files modified:** 2 (`scripts/uat/lib/sidecar-harness.mjs`, `scripts/uat/uat-08-socratic-authoring.mjs`)

## Accomplishments

- `composeIsolatedClaudeConfigDir` links the developer's own `.credentials.json` into a scratch directory by symbolic link (never a copy), refusing loudly (via `HARNESS_PRECONDITION_PREFIX`) when nothing was linked; `assertClaudeConfigIsolated` gained three directory-content checks (deny-listed entries absent, every symlink allow-listed, every allow-listed entry actually a symlink) alongside its two pre-existing env-map checks, and the backend's own self-created entries (`projects`, `sessions`, `backups`, its own dot-file) pass through untouched.
- `assertBackendAuthenticated` reads the backend's own `auth status` (via an injectable `readClaudeAuthStatus`, never called by any self-test) and refuses — before `harness.startSidecar()` even runs — on no read, not-logged-in, an unaccepted method (`ACCEPTED_AUTH_METHODS`, a fail-closed allow-list), or a mismatched resolved config directory. `scrubApiKeyEnv` unconditionally deletes `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` from the spawn env and reports what it removed.
- `renderChallengeEvidenceSheet` gained an optional `credentialPath` section (rendered above the verdict section, byte-identical to omission when absent/null) and the live arm now writes the same summary as a durable `uat-08-credential-path` artifact — the direct countermeasure to validation ledger row `05-22-03`, whose credential path was never recorded.
- 17 new offline self-test checks (7 + 7 + 3, labelled `[Plan 05-33, Task N]`), each against a synthetic directory or an injected auth-status payload — zero credentials spent, zero live-arm runs, zero network calls.

## Task Commits

Each task was committed atomically:

1. **Task 1: Compose an isolated config directory presenting the credential by reference** — `fce2c26` (tdd)
2. **Task 2: Refuse the run before spawning when the backend cannot authenticate** — `786050e` (tdd)
3. **Task 3: Record the credential path in the run's own evidence** — `00a5f7d` (feat)

**Plan metadata:** committed separately after this SUMMARY.

_Note: tasks were marked `tdd="true"` in the plan; this executor followed the RED→GREEN pattern by writing each behavior-proving self-test check alongside its corresponding implementation function within the same commit (not as three temporally separate RED/GREEN/REFACTOR commits per task) — every check in the final state proves a real, already-implemented behavior, and `--self-test` was re-run to green after every incremental change described below._

## Files Created/Modified

- `scripts/uat/lib/sidecar-harness.mjs` — `HARNESS_PRECONDITION_PREFIX`, `CREDENTIAL_LINK_ALLOWLIST`, `BEHAVIOURAL_CONFIG_DENYLIST`, `composeIsolatedClaudeConfigDir`, extended `assertClaudeConfigIsolated`, rewritten `cleanClaudeConfigEnv`, `API_KEY_ENV_VARS`, `scrubApiKeyEnv`, `ACCEPTED_AUTH_METHODS`, `summariseAuthStatus`, `readClaudeAuthStatus`, `assertBackendAuthenticated`
- `scripts/uat/uat-08-socratic-authoring.mjs` — live-arm wiring (composed-directory step line, scrub, pre-spawn authentication refusal, credential artifact), `renderChallengeEvidenceSheet`'s `credentialPath` section, 17 new self-test checks

## Decisions Made

See `key-decisions` in the frontmatter above — in short: `HARNESS_PRECONDITION_PREFIX` was defined once (in the Task 1 commit) rather than literally in Task 2 as the plan's action text implied, since Task 1's own composition function already needed it; the composition metadata (`linkedEntries`/`sourceConfigDir`) is carried on a `harness.lastComposedClaudeConfig` instance field rather than merged into the returned env map, to avoid handing a non-string value into a map whose entries become real OS environment variables; and SHAPE-01/SHAPE-03 are deliberately left unmarked per the plan's own prohibition.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Moved `HARNESS_PRECONDITION_PREFIX`'s definition from Task 2 to Task 1**
- **Found during:** Task 1 (writing `composeIsolatedClaudeConfigDir`'s empty-link-set refusal)
- **Issue:** The plan's Task 1 action text says the empty-link-set error "starts with the harness-precondition prefix introduced in Task 2" — but Task 1 executes and is verified (including its own commit) before Task 2 exists, so the symbol could not yet be defined if left exactly where Task 2's action text places it.
- **Fix:** Defined `HARNESS_PRECONDITION_PREFIX` once, immediately after `PERSONAL_CLAUDE_CONFIG_DIR`, before `composeIsolatedClaudeConfigDir`'s own use of it — Task 2's `assertBackendAuthenticated` reuses the same exported constant rather than redefining it.
- **Files modified:** `scripts/uat/lib/sidecar-harness.mjs`
- **Verification:** Task 1's own self-test checks assert error messages start with this prefix; Task 2's export-existence acceptance criterion (`HARNESS_PRECONDITION_PREFIX` exported) is satisfied identically regardless of which commit introduced it.
- **Committed in:** `fce2c26` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — dependency-ordering forward reference).
**Impact on plan:** No functional or behavioral difference from the plan's intent; only the commit at which one shared constant is first defined moved earlier by one commit. All of both tasks' acceptance criteria are satisfied against the final state.

## Issues Encountered

None. All three tasks' `<acceptance_criteria>` and the plan-level `<verification>` block passed on first execution once the code was written; no repair cycles were needed.

## User Setup Required

None — no external service configuration required. `--self-test` and `--replay-check` both run entirely offline against synthetic data and a fake backend.

## Next Phase Readiness

- The live arm (`node scripts/uat/uat-08-socratic-authoring.mjs`, no `--self-test`/`--replay-check` flags) is now structurally able to authenticate as the developer without an API key and without a pre-staged durable override directory — a human running it deliberately is the only remaining step to produce the first judgeable live transcript for SHAPE-01/SHAPE-03.
- `05-LIVE-CHALLENGE-TRANSCRIPT.md` is unchanged by this plan (confirmed via `git diff --quiet`); both verdict lines remain `UNJUDGED` as required.
- No blockers for subsequent plans in this phase; `packages/` is untouched (confirmed via `git diff --quiet -- packages/`), consistent with this plan's harness-only scope.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-25*

## Self-Check: PASSED
