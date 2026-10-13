---
phase: 03-nothing-lost-nothing-left-running
plan: 21
subsystem: infra
tags: [claude-code, watchdog, session-lifecycle, uat-harness, permission-gate, gap-closure]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-20's close-provenance instrumentation, clean-room UAT harness, and recorded disposition (root-cause-identified/H1 CONFIRMED, selecting Branch B)"
provides:
  - "A repeatable, machine-readable acceptance command (uat-06 --answer-after=60000 --decision=deny) proving a destructive permission request survives at least 60 seconds unanswered and an answer delivered at the end of that window is honoured end to end"
  - "Branch B landed: a documentation-only harness correction (startSidecar's doc comment names the stale-window hazard); no change to watchdog.ts's stale-kill condition"
  - "Three new PROC-04 regression-guard tests proving a pending permission request never suppresses, extends or conditions the watchdog's stale-kill, that a session ending with a request pending still closes exactly once with its socket cleaned up, and that answering a requestId twice settles it once"
affects: [03-22, uat-harness, sidecar-adapter]

plan_head_before: 211b4c47cb25b1c1ce59cc4cc1f4cd991fd9fd69
actuals:
  tokens: 6484
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "uat-06's acceptance mode: assertNoEvent(session_closed) for the hold window, THEN answer, THEN a positive wait for session_closed — the only shape that proves 'stayed blocked, then was honoured' rather than merely 'eventually closed'"
    - "Connecting a raw net.Socket directly to startPermissionServer's own socketPath, bypassing ClaudeCodeAdapter/fake-claude's real MCP round trip entirely, when a unit test only needs to exercise PermissionServerHandle's own resolvePermission idempotency"

key-files:
  created: []
  modified:
    - scripts/uat/uat-06-permission-block-lifecycle.mjs
    - scripts/uat/lib/sidecar-harness.mjs
    - packages/sidecar/test/close-provenance.test.mjs
    - .planning/phases/03-nothing-lost-nothing-left-running/03-SESSION-LIFECYCLE-FINDINGS.md

key-decisions:
  - "Branch B taken, selected by 03-SESSION-LIFECYCLE-FINDINGS.md's own `**Disposition:** root-cause-identified` token (H1 CONFIRMED). No change to packages/sidecar/src/watchdog.ts's stale-kill condition, per must_haves.prohibitions -- the watchdog did exactly its job against an unsupervised measurement; the product was never broken. The only source change is a documentation addition (startSidecar's doc comment); uat-06's --heartbeat flag already defaulted to \"on\" before this plan."
  - "For --decision=allow (not exercised by this plan's own acceptance run, but required by the CLI contract), 'honoured' means the destructive action DID reach the remote -- the opposite of --decision=deny's 'remote unchanged' check. The unconditional safety assertion is skipped only in that one branch."
  - "permission.test.mjs's 5-of-7 documented failures (deferred-items.md) were investigated live and found to trace to a DIFFERENT, unrelated cause than the recorded 'grandchild-process/stdio-transport sandbox constraint': that file never sets FLYWHEEL_RUNTIME_DIR, which watchdog.ts's own fail-closed guard (present since plan 03-02) refuses to spawn without. close-provenance.test.mjs's existing idiom already sets it correctly, so all three new Task 3 tests pass with no skip needed in this environment -- deferred-items.md was not edited (out of this plan's declared files_modified), and this finding is recorded here, not chased further."

requirements-completed: [AGNT-07, PROC-04]

coverage:
  - id: D1
    description: "uat-06-permission-block-lifecycle.mjs gains --answer-after=<ms> and --decision=deny|allow: acceptance mode holds a raised permission_request unanswered for the given window (assertNoEvent), delivers the decision, and asserts it was honoured (remote unchanged + worded explanation for deny; remote deleted for allow)"
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=on --answer-after=60000 --decision=deny (live, run twice: OUTCOME: answered-after-60000ms decision=deny honoured=true heartbeat=on)"
        status: pass
      - kind: e2e
        ref: "node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=on (live, measurement-mode regression guard, unchanged: OUTCOME: sustained-block elapsed_ms=90000 heartbeat=on)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Branch B landed: startSidecar's doc comment (scripts/uat/lib/sidecar-harness.mjs) names the stale-window hazard; no change to watchdog.ts's stale-kill condition"
    requirement: AGNT-07
    verification:
      - kind: other
        ref: "git diff (plan-start SHA)..HEAD -- packages/sidecar/src/watchdog.ts returns nothing"
        status: pass
      - kind: e2e
        ref: "re-run of uat-06 --heartbeat=on --answer-after=60000 --decision=deny after the doc-only change, still honoured=true"
        status: pass
    human_judgment: true
    rationale: "Confirming the disposition token and evidence genuinely selected Branch B (rather than a green line manufactured to fit) is an evidentiary judgment (T-03-21-04's own threat register entry), not a boolean test outcome."
  - id: D3
    description: "PROC-04 regression guard: three new cases in close-provenance.test.mjs (6 -> 9) proving a pending permission request never suppresses/extends the watchdog's stale-kill, a session ending with a request pending still closes exactly once with its socket removed, and answering a requestId twice settles it once"
    requirement: PROC-04
    verification:
      - kind: unit
        ref: "packages/sidecar/test/close-provenance.test.mjs (9/9 pass, # fail 0)"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/watchdog.test.mjs (5/5 pass -- regression guard)"
        status: pass
      - kind: other
        ref: "cargo test --workspace (all suites ok, zero FAILED)"
        status: pass
      - kind: other
        ref: "npm --prefix packages/sidecar run test (75/75 pass, 0 fail -- see Issues Encountered for the deferred-items.md discrepancy this surfaced)"
        status: pass
    human_judgment: false

duration: 33min
completed: 2026-09-20
status: complete
---

# Phase 3 Plan 21: Sixty-Second Permission Answer — Gap Closure Summary

**A repeatable, machine-readable acceptance command proves a destructive permission request
survives 60+ seconds unanswered and is honoured end to end when answered; Branch B (harness-only,
no source fix) is landed per plan 03-20's disposition; three new regression tests prove PROC-04's
guarantee holds even with a question pending.**

## Performance

- **Duration:** ~33 min (includes ~3.5 min of live-session wait time across three acceptance runs)
- **Started:** 2026-09-20T09:20:00Z (approx.)
- **Completed:** 2026-09-20T09:52:33Z
- **Tasks:** 3 (all `type="auto"`)
- **Files modified:** 4

## Accomplishments

- `scripts/uat/uat-06-permission-block-lifecycle.mjs` gained `--answer-after=<ms>` and
  `--decision=deny|allow`, an acceptance-mode path that holds a raised destructive
  `permission_request` genuinely unanswered for the given window (`assertNoEvent(session_closed)`
  — the only shape that can express "stayed blocked"), then delivers the decision and asserts it
  was honoured. Live-verified twice: `OUTCOME: answered-after-60000ms decision=deny honoured=true
  heartbeat=on`, with the request unanswered for the full 60s and the session closing 3836-4755ms
  after the deny was delivered. The pre-existing measurement-mode path (`--heartbeat=on`, no
  `--answer-after`) is unchanged and still prints its original `sustained-block` outcome.
- Read `03-SESSION-LIFECYCLE-FINDINGS.md`'s `**Disposition:** root-cause-identified` token (H1
  CONFIRMED) and took **Branch B**: the watchdog's own heartbeat-staleness kill was correct against
  an unsupervised measurement; the product was never broken. Landed the harness-only correction —
  `startSidecar`'s doc comment in `scripts/uat/lib/sidecar-harness.mjs` now names the stale-window
  hazard for any future long-lived-session caller. `uat-06`'s `--heartbeat` flag already defaulted
  to `"on"` before this plan; no code change was needed there. **No change was made to
  `packages/sidecar/src/watchdog.ts`'s stale-kill condition**, per `must_haves.prohibitions`.
  Re-ran Task 1's acceptance command after landing the doc change: still `honoured=true`.
- Added three regression-guard tests to `packages/sidecar/test/close-provenance.test.mjs` (6 -> 9
  top-level cases, `# fail 0`): a pending permission request does not extend the watchdog's stale
  window (Test 7); exactly one `session_closed` event and a removed socket file when a session ends
  with a request pending (Test 8); resolving the same `requestId` twice settles it once, verified by
  connecting directly to `startPermissionServer`'s own socket, bypassing `ClaudeCodeAdapter`/
  `fake-claude.mjs` entirely (Test 9).
- Recorded `## Acceptance run` and `## Source change` sections in
  `03-SESSION-LIFECYCLE-FINDINGS.md`, closing the loop: AGNT-07 is now supportable as **Complete**.

## Task Commits

1. **Task 1: The sixty-second answer** — `ef941bd` (feat)
2. **Task 2: Act on the recorded disposition (Branch B)** — `082b17e` (docs)
3. **Task 3: PROC-04 regression guard** — `c5082db` (test)
4. **Findings document update** — `46d9f84` (docs)

**Plan metadata:** commit to follow this SUMMARY.

## Files Created/Modified

- `scripts/uat/uat-06-permission-block-lifecycle.mjs` — `--answer-after`/`--decision` CLI flags,
  acceptance-mode flow, honoured-answer assertions, artifact fields
  (`answerAfterMs`/`decision`/`closedAfterAnswerMs`/`closeOrigin`)
- `scripts/uat/lib/sidecar-harness.mjs` — `startSidecar`'s doc comment names the stale-window
  hazard (Branch B)
- `packages/sidecar/test/close-provenance.test.mjs` — Tests 7, 8, 9 (PROC-04 regression guard)
- `.planning/phases/03-nothing-lost-nothing-left-running/03-SESSION-LIFECYCLE-FINDINGS.md` —
  `## Acceptance run` and `## Source change` sections

## Decisions Made

See `key-decisions` in the frontmatter. In prose: (1) Branch B, selected by the disposition token
plan 03-20 recorded — harness documentation only, no product code change; (2) `--decision=allow`'s
honoured-effect is the opposite of `--decision=deny`'s (remote deleted, not unchanged) — implemented
but not exercised by this plan's own required acceptance run (which uses the default `deny`); (3)
the `deferred-items.md` `permission.test.mjs` entry's documented cause (grandchild-process/
stdio-transport sandbox constraint) does not match what live investigation found in this
environment — a missing `FLYWHEEL_RUNTIME_DIR` env var, unrelated to process spawning — recorded
here as a finding, `deferred-items.md` itself left untouched (not in this plan's declared files).

## Deviations from Plan

None — plan executed exactly as written. Branch B was taken exactly as 03-20's `Instruction for
03-21` specified, with no source change beyond the sanctioned doc comment.

## Issues Encountered

**`npm --prefix packages/sidecar run test` (the plan's own required end-of-plan full run) reported
75/75 pass, 0 fail** — better than `deferred-items.md`'s recorded baseline (38 passed/16 failed/1
cancelled out of 55, attributed to a "grandchild-process/stdio-transport sandbox constraint" across
`adapter.test.mjs`, `permission.test.mjs`, `shutdown.test.mjs`, `stop.test.mjs`,
`destructive-gate.test.mjs`). Investigating `permission.test.mjs`'s specific failure directly (it
never sets `FLYWHEEL_RUNTIME_DIR`, and `watchdog.ts`'s own fail-closed guard — present since plan
03-02, unrelated to this plan's diff — refuses to spawn the backend without it) showed the SAME test
passes cleanly once that one env var is set. This does not prove every file in `deferred-items.md`'s
list shares the identical root cause, and per this plan's own scope boundary that file was not
edited or otherwise chased further — recorded here as a finding for whoever next touches those
files, not treated as this plan's own fix.

## User Setup Required

None. The durable `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` directory
(`/tmp/flywheel-uat-claude-config`) plan 03-20 already documented was reused unchanged for this
plan's live runs.

## Next Phase Readiness

**AGNT-07 is now supportable as Complete.** The request-raising half was already verified closed
(03-14/03-19); this plan closes the sustained-block-and-honoured-answer half `03-VERIFICATION.md`
left open (Success Criterion 5), with a repeatable, machine-readable acceptance command
(`uat-06-permission-block-lifecycle.mjs --heartbeat=on --answer-after=60000 --decision=deny`).
PROC-04 is reinforced with a direct regression guard proving a pending question buys no extra life.
Plan 03-22 can read this judgement directly from this SUMMARY and from
`03-SESSION-LIFECYCLE-FINDINGS.md`'s `## Source change` section.

## Self-Check: PASSED

- `scripts/uat/uat-06-permission-block-lifecycle.mjs` — FOUND, modified, syntax-checked, live-run
  twice (exit 0 both times).
- `scripts/uat/lib/sidecar-harness.mjs` — FOUND, modified, syntax-checked.
- `packages/sidecar/test/close-provenance.test.mjs` — FOUND, modified, 9/9 tests pass.
- `.planning/phases/03-nothing-lost-nothing-left-running/03-SESSION-LIFECYCLE-FINDINGS.md` — FOUND,
  `## Acceptance run` and `## Source change` sections present.
- Commits `ef941bd`, `082b17e`, `c5082db`, `46d9f84` — all present in `git log --oneline`.
- `git diff 211b4c47cb25b1c1ce59cc4cc1f4cd991fd9fd69..HEAD -- packages/sidecar/src/watchdog.ts`
  returns nothing — confirmed no change to the stale-kill condition.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-20*
