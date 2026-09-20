---
phase: 03-nothing-lost-nothing-left-running
plan: 20
subsystem: infra
tags: [claude-code, watchdog, session-lifecycle, uat-harness, tdd, permission-gate]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: plans 03-01 through 03-19 (worktree lifecycle, process supervision, destructive-gate, UAT harness foundations)
provides:
  - "Close-provenance instrumentation: every session_closed event names which of three mechanisms ended it (closeOrigin, exitCode, exitSignal)"
  - "A clean-room live UAT harness (uat-06-permission-block-lifecycle.mjs) that measures an unanswered destructive-gate request twice, isolated from the developer's personal Claude Code config, and keeps a durable timeline artifact per run"
  - "A recorded, evidence-cited disposition (03-SESSION-LIFECYCLE-FINDINGS.md) naming H1 (watchdog heartbeat-staleness kill) as the confirmed root cause of the 15-16s early termination, and selecting plan 03-21's Branch B (harness-only fix)"
affects: [03-21, uat-harness, sidecar-adapter]

actuals:
  tokens: 16572
  tasks: 3
  commits: 5
plan_head_before: c7bc84f05e8950f0f354de671710e934d65910de

tech-stack:
  added: []
  patterns:
    - "Append-only per-run lifecycle JSONL (<runtime>/lifecycle/<runId>.jsonl), written by the watchdog and read back by the adapter — mirrors the existing kills/runs on-disk protocol convention"
    - "A LiveSession field capturing THIS RUN's own resolved per-run env value (runtimeDir), read by later terminal-event logic, instead of re-reading the adapter/sidecar's own ambient process.env — the general fix for the H1a-shaped 'env spread order' pitfall"
    - "UAT harness durable timeline artifacts written outside the per-run scratch directory's teardown reach (artifactDir() deliberately unregistered with onCleanup)"

key-files:
  created:
    - packages/sidecar/test/close-provenance.test.mjs
    - scripts/uat/uat-06-permission-block-lifecycle.mjs
    - .planning/phases/03-nothing-lost-nothing-left-running/03-SESSION-LIFECYCLE-FINDINGS.md
  modified:
    - packages/sidecar/src/watchdog.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/adapter.ts
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/run-all.sh
    - scripts/uat/README.md

key-decisions:
  - "resolveCloseOrigin must read a per-run-captured LiveSession.runtimeDir, never the adapter/sidecar's own ambient process.env.FLYWHEEL_RUNTIME_DIR — neither this harness's startSidecar() nor production's spawn_sidecar() ever sets that variable on the sidecar's own process; it is only ever passed per-run to the watchdog child. Found live: a real heartbeat-stale kill (real kill record on disk) still reported closeOrigin: unattributed until this fix landed."
  - "CLAUDE_CONFIG_DIR isolation isolates Claude Code's authentication, not only its settings/hooks/plugins/MCP registrations as first assumed — confirmed live via the zero-cost `claude auth status` diagnostic. cleanClaudeConfigEnv() now honours a FLYWHEEL_UAT_CLAUDE_CONFIG_DIR override pointing at a durable, human-staged, already-authenticated directory; this harness never copies, reads or writes .credentials.json itself."
  - "assertClaudeConfigIsolated (exported from sidecar-harness.mjs) is the enforced isolation gate the plan's must_haves.truths requires — checked both inside cleanClaudeConfigEnv() against its own resolved value and again by the calling script against the full merged spawn environment, throwing on violation including a MISSING CLAUDE_CONFIG_DIR key (which would silently fall back to the real ~/.claude)."
  - "Disposition root-cause-identified, H1 confirmed: the watchdog's own heartbeat-staleness kill ends an unsupervised session exactly as designed; a production-shaped (heartbeat=on) run of the identical scenario sustained the block for the full 90s window. Selects plan 03-21's Branch B — a harness-only correction, no change to watchdog.ts's stale-kill condition."

requirements-completed: [AGNT-07, PROC-04]

coverage:
  - id: D1
    description: "Close-provenance instrumentation: watchdog.ts writes an append-only lifecycle timeline (watchdog_started with effective stale_ms/stale_ms_source, backend_spawned, signal_forwarded, stale_kill, backend_exit); claude-code-adapter.ts exports resolveCloseOrigin and carries closeOrigin/exitCode/exitSignal on session_closed"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/close-provenance.test.mjs (6/6 pass, TDD RED commit 75af0f0 -> GREEN commit 7cb0690, bug-fix commit 3a26154)"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/watchdog.test.mjs (5/5 pass — regression guard)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A clean-room live UAT harness (uat-06-permission-block-lifecycle.mjs) that measures the unanswered-destructive-request scenario twice (--heartbeat=off / --heartbeat=on), with Claude Code's config isolation asserted at runtime, and writes one durable timeline artifact per run"
    requirement: PROC-04
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=off (live, exit 0, OUTCOME: session-terminated origin=watchdog-heartbeat-stale elapsed_ms=7397 heartbeat=off)"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=on (live, exit 0, OUTCOME: sustained-block elapsed_ms=90001 heartbeat=on)"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*#' scripts/uat/run-all.sh | grep -c uat-06-permission-block-lifecycle.mjs -> 2"
        status: pass
    human_judgment: false
  - id: D3
    description: "03-SESSION-LIFECYCLE-FINDINGS.md: a recorded, evidence-cited disposition across four named hypotheses, selecting exactly one branch of plan 03-21 Task 2"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "structural greps: 4 H-rows, 1 valid Disposition line, 2 on/off rows, 5 CONFIRMED/FALSIFIED tokens, zero debt markers — all pass"
        status: pass
    human_judgment: true
    rationale: "The hypothesis dispositions and the overall root-cause-identified/Branch-B selection are an evidentiary interpretation of two live measurements, not a boolean test outcome — worth a human read before 03-21 acts on it, even though every structural contract the plan requires is mechanically verified."

duration: 70min
completed: 2026-09-20
status: complete
---

# Phase 3 Plan 20: Session Lifecycle Investigation Summary

**Close-provenance instrumentation (watchdog + adapter) plus a config-isolated live UAT harness
that measured the unanswered destructive-gate scenario twice and root-caused the 15-16s early
termination to the watchdog's own heartbeat-staleness kill — confirmed absent under a
production-shaped (supervised) run.**

## Performance

- **Duration:** ~70 min (includes two human-decision checkpoints: the Task 1 tracer feedback gate,
  and a credential-isolation architectural decision surfaced mid-Task-2)
- **Started:** 2026-09-20T08:20:10Z
- **Completed:** 2026-09-20T09:15:00Z
- **Tasks:** 3 (Task 1 tracer/TDD, Task 2 auto, Task 3 auto)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- Every `session_closed` event now names which of three mechanisms ended the session
  (`closeOrigin`: `supervisor-signal` | `watchdog-heartbeat-stale` | `backend-exit` |
  `unattributed`), plus `exitCode`/`exitSignal` — proven against three deliberately-induced
  endings via a genuine RED→GREEN TDD cycle (test commit `75af0f0`, then `7cb0690`).
- Found and fixed a real bug in that same instrumentation, live: `resolveCloseOrigin` was reading
  the adapter/sidecar's own ambient `process.env.FLYWHEEL_RUNTIME_DIR` (never set there, in this
  harness or in production) instead of the per-run value every session actually resolves —
  `closeOrigin` silently reported `unattributed` even with a real on-disk `heartbeat-stale` kill
  record sitting right next to it. Fixed (`3a26154`), re-verified against the unit suite, then
  re-verified live.
- Built a config-isolated live measurement harness (`uat-06-permission-block-lifecycle.mjs`) that
  drives the real `claude` binary against a scratch repo, deliberately never answers the resulting
  destructive-gate permission request, and keeps a durable JSON timeline of everything that
  happened — twice, once unsupervised and once with a production-shaped heartbeat writer.
- Measured, live: `--heartbeat=off` terminates the session at `elapsed_ms=7397` with
  `closeOrigin=watchdog-heartbeat-stale`; `--heartbeat=on` sustains the block for the full 90s
  observation window with zero termination artifacts of any kind. Recorded a
  `root-cause-identified` disposition selecting plan 03-21's Branch B.
- Discovered, live, that `CLAUDE_CONFIG_DIR` isolation breaks Claude Code's own authentication
  (not only settings/hooks/plugins/MCP as first assumed) — surfaced via a checkpoint rather than
  worked around, since the fix (copying a credential file) was refused by Claude Code's own
  permission classifier and correctly required a human's own action outside this agent's sandbox.

## Task Commits

Each task was committed atomically (Task 1's TDD cycle produced two commits plus a live-discovered
fix commit; Tasks 2 and 3 one commit each):

1. **Task 1: Close provenance, end to end** — RED `75af0f0` (test), GREEN `7cb0690` (feat)
2. **Task 1 fix (discovered during Task 2's live run):** `3a26154` (fix)
3. **Task 2: The clean room — live unanswered-request measurement** — `234be13` (feat)
4. **Task 3: Record the disposition** — `33d9ff2` (docs)

**Plan metadata:** commit to follow this SUMMARY.

## Files Created/Modified

- `packages/sidecar/src/watchdog.ts` — append-only lifecycle JSONL timeline (`watchdog_started`,
  `backend_spawned`, `signal_forwarded`, `stale_kill`, `backend_exit`)
- `packages/sidecar/src/claude-code-adapter.ts` — exported `resolveCloseOrigin`; `LiveSession`
  gains `exitCode`/`exitSignal`/`runtimeDir`; `session_closed` carries the three new fields
- `packages/sidecar/src/adapter.ts` — `SessionClosedEvent` type gains the three optional fields
- `packages/sidecar/test/close-provenance.test.mjs` — the TDD test driving three real endings
- `scripts/uat/lib/sidecar-harness.mjs` — `cleanClaudeConfigEnv`, `assertClaudeConfigIsolated`,
  `PERSONAL_CLAUDE_CONFIG_DIR`, `artifactDir`, `writeArtifact`, `snapshotRuntimeDir`, exported
  `drainIncidentalPermissionRequests`
- `scripts/uat/uat-06-permission-block-lifecycle.mjs` — the new clean-room live measurement script
- `scripts/uat/run-all.sh`, `scripts/uat/README.md` — wired in as UAT 6a/6b, documented
- `.planning/phases/03-nothing-lost-nothing-left-running/03-SESSION-LIFECYCLE-FINDINGS.md` — the
  recorded disposition

## Decisions Made

See `key-decisions` in the frontmatter. In prose: (1) close-provenance must key off a per-run
captured value, never the adapter's own ambient env — a real live run surfaced the gap unit tests
had masked; (2) `CLAUDE_CONFIG_DIR` isolation also isolates auth, addressed via a durable,
human-staged override directory this harness never touches the credential contents of; (3) the
isolation assertion itself is now enforced in the shared harness function, not just inline in one
script; (4) the disposition is `root-cause-identified` (H1), selecting 03-21's Branch B.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `resolveCloseOrigin` read the wrong environment source**
- **Found during:** Task 2's first live `--heartbeat=off` run
- **Issue:** `emitSessionClosed` called `resolveCloseOrigin` with
  `process.env.FLYWHEEL_RUNTIME_DIR` — the adapter/sidecar's own ambient process environment.
  Neither this harness's `startSidecar()` nor production's `spawn_sidecar()` ever sets that
  variable on the sidecar process itself; it is only ever passed per-run, to the watchdog child.
  A real live run produced a genuine on-disk `heartbeat-stale` kill record and `stale_kill`
  lifecycle line, yet `closeOrigin` reported `unattributed`.
- **Fix:** `LiveSession` now carries `runtimeDir`, captured from the per-run spawn `env` object at
  construction time (the same value `writeHookSettings`/`writeRunDescriptor` already keyed off a
  few lines away); `emitSessionClosed` reads `session.runtimeDir` instead.
- **Files modified:** `packages/sidecar/src/claude-code-adapter.ts`
- **Verification:** `close-provenance.test.mjs` (6/6) and `watchdog.test.mjs` (5/5) re-run clean;
  the live `--heartbeat=off` measurement re-run and correctly reported
  `closeOrigin=watchdog-heartbeat-stale`.
- **Committed in:** `3a26154`

**2. [Rule 2 - Missing Critical] Isolation must_haves.truths was described, not enforced**
- **Found during:** Task 2, after the human-approved credential-staging decision (below)
- **Issue:** The plan's own `must_haves.truths` requires the isolation "asserted by the harness
  rather than described in a comment," and the initial implementation only asserted inline in one
  script, against a check (`CLAUDE_CONFIG_DIR.startsWith(harness.root)`) that would have
  incorrectly FAILED once a durable, non-`harness.root` override directory was introduced.
- **Fix:** `assertClaudeConfigIsolated` is now an exported harness function, called both inside
  `cleanClaudeConfigEnv()` (against its own resolved value) and by the calling script (against the
  full merged spawn env) — correctly handles the override case, and explicitly fails when
  `CLAUDE_CONFIG_DIR` is absent (not just when it points at the personal directory).
- **Files modified:** `scripts/uat/lib/sidecar-harness.mjs`, `scripts/uat/uat-06-permission-block-lifecycle.mjs`
- **Verification:** dry-run unit checks (durable override does not throw; missing key throws;
  personal-dir value throws; a leaked nested value throws) — all four pass, zero live cost.
- **Committed in:** `234be13`

### Human-decided (Rule 4 — architectural/security)

**3. `CLAUDE_CONFIG_DIR` isolation breaks Claude Code's own authentication**
- **Found during:** Task 2's first live run, which failed at `result: "Not logged in · Please run
  /login"` before ever reaching the destructive-command prompt (one live run's cost spent on this).
- **Why not auto-fixed:** the direct technical fix (copying `~/.claude/.credentials.json` into the
  scratch config dir) was refused by Claude Code's own permission classifier when attempted, and
  this project's own architecture constraint states credentials must never leave the desk. Per the
  classifier's own guidance, this was surfaced as a checkpoint rather than routed around.
- **Resolution:** the human staged a durable, already-authenticated `CLAUDE_CONFIG_DIR` at
  `/tmp/flywheel-uat-claude-config` themselves, outside this agent's sandbox, and confirmed
  isolation was still intact (`mcpServers: {}`, `hooks: {}`, `projects: 0`, vs. 15 personal
  projects). `cleanClaudeConfigEnv()` was then wired to honour `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` as
  an override — this harness never copies, reads or writes `.credentials.json` itself.
- **Committed in:** `234be13`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing-critical) + 1 human-decided (architectural).
**Impact on plan:** All three were necessary — the bug fix restores the instrument's own
correctness (the whole point of Task 1), the enforcement fix satisfies a stated `must_haves.truths`
literally, and the human decision was required by both a technical classifier boundary and the
project's own credential-handling constraint. No scope creep: the destructive-gate decision logic
was never touched.

## Issues Encountered

None beyond the deviations above, which are the substance of this investigation rather than
incidental problems. The pre-existing, environment-constrained sidecar test failures recorded in
`deferred-items.md` (`adapter.test.mjs`'s ordering test, `permission.test.mjs`'s MCP round trips)
were observed again in this session's own `adapter.test.mjs` run (`expected at least 4 events, got
2` — the exact, already-documented failure) and were not chased, per the plan's own scope boundary.

## User Setup Required

None for the shipped product code. The durable `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` directory
(`/tmp/flywheel-uat-claude-config`) is a UAT-harness-only convenience a developer stages once,
outside any agent's sandbox, to run `uat-06-permission-block-lifecycle.mjs` against a real
authenticated session — not a product runtime dependency.

## Next Phase Readiness

Plan 03-21 has everything Task 2 of this plan's `key_links` promised: two artifact paths, a
`**Disposition:** root-cause-identified` token, and an explicit `Instruction for 03-21` naming
Branch B. 03-21 should land the harness-only correction (default `uat-06` to `--heartbeat=on`,
document the stale-window hazard in `sidecar-harness.mjs`) and re-run its own Task 1 acceptance
command — no change to `watchdog.ts`'s stale-kill condition is indicated or permitted.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-20*
