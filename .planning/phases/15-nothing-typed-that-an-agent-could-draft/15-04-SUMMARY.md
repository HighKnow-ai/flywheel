---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 04
subsystem: testing
tags: [uat, live-backend, rate-limit, claude-code, sidecar, credentials]

requires:
  - phase: 15-02
    provides: the live planner file-set chain and the `fake.invoked()` honesty discipline
  - phase: 15-03
    provides: uat-15's offline replay, clause scoring and the dispatch limit floor pins
provides:
  - "A live planner file-set observation recorded as a committed artifact (15-DRFT-01-LIVE.md)"
  - "A live account-limit observation at the `warning` tier, with raw wire line, normalised tier, gate transition and timestamps (15-DRFT-12-LIVE.md)"
  - "Both `--live` arms registered in scripts/uat/run-all.sh"
  - "FLYWHEEL_UAT_CREDENTIAL_SOURCE_DIR: the burn can spend a non-personal account's window"
  - "A measured burn-rate figure: 4 lanes x 25 min = 0.15 of a five-hour window"
affects: [account-limit, dispatch-gate, uat-harness, criterion-6]

tech-stack:
  added: []
  patterns:
    - "Credential source and behavioural config are separate knobs in the UAT harness"
    - "A live measurement must not be driven by an agent sharing the window it drains"

key-files:
  created:
    - .planning/phases/15-nothing-typed-that-an-agent-could-draft/15-DRFT-12-LIVE.md
  modified:
    - scripts/uat/uat-15-account-limit.mjs
    - scripts/uat/lib/sidecar-harness.mjs
    - scripts/uat/README.md
    - scripts/uat/run-all.sh

key-decisions:
  - "Task 1's blocking-human checkpoint resolved to `burn-both-now` with the scratch repo (decided before this session; not re-asked)"
  - "Criterion 6 stays OPEN: a `warning` tier was observed, and D-32 admits only `Rejected`"
  - "`limit_gate.rs`'s 'No hard limit has ever been observed' sentence STAYS — it is still true, and no code in that file was touched"
  - "No replay fixture generated: the fixture exists only for a real rejection"
  - "The sidecar stdin board issue filed mid-plan was WITHDRAWN as a misdiagnosis before commit"

patterns-established:
  - "Liveness of a live lane is read from the durable session timeline or the backend's own five_hour_utilization — never from the session .jsonl transcript or a flat event counter, both of which are silent by design in `-p` stream-json mode"
  - "An artifact states its own verdict in its own bytes, not only in the run's stdout report"

requirements-completed: [DRFT-01]

coverage:
  - id: D1
    description: "The planner declares each task's expected file-set, observed working against a live backend and recorded as a committed artifact"
    requirement: DRFT-01
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-14-planner-file-set.mjs --live --artifact 15-DRFT-01-LIVE.md"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real backend session limit observed live, backed off from, surfaced in the run's own gate state, and recorded"
    requirement: DRFT-12
    verification:
      - kind: e2e
        ref: "node scripts/uat/uat-15-account-limit.mjs --live --sessions 4 --max-minutes 25"
        status: pass
    human_judgment: true
    rationale: "Clauses (a)-(d) passed at the `warning` tier, but D-32 reserves criterion 6 for `Rejected`. Whether a warning-tier observation is acceptable progress, or the Rejected burn must be funded, is the owner's call — not automation's."
  - id: D3
    description: "The burn can spend a non-personal account's window, so the measurement never drains the window it runs in"
    verification:
      - kind: integration
        ref: "composeIsolatedClaudeConfigDir via FLYWHEEL_UAT_CREDENTIAL_SOURCE_DIR; claude auth status reports subscriptionType team"
        status: pass
    human_judgment: false

duration: ~5h elapsed (two interrupted windows), ~50min of live burn
completed: 2026-10-16
status: complete
---

# Phase 15 Plan 04: Live Observation For DRFT-01 And DRFT-12 Summary

**DRFT-01 closed with a live planner file-set artifact; DRFT-12 observed a real `warning`-tier session limit through the production gate seam, which leaves criterion 6 correctly open and the "never observed" sentence correctly in place.**

## Performance

- **Duration:** ~5h elapsed across two interrupted windows; ~50 min of actual live burn
- **Completed:** 2026-10-16
- **Tasks:** 3 of 3
- **Files modified:** 6

## Accomplishments

- **DRFT-01 met.** A real live planning run (`01M51NG5QWFJDH1QKXFEFST83V`) declared its task file-set, recorded in `15-DRFT-01-LIVE.md`. Both `--live` arms registered in `run-all.sh`.
- **A real limit tier observed live.** `warning` on the `seven_day` window, `resetsAt 1792411200`, captured with its raw wire line and driven through the production seam: gate `open → warning`, `maySpawn: true`, `mayAdvance: false`, exactly one `dispatch.gate_changed` event, no `agent_runs.status` write. Clauses (a)–(d) of criterion 6 all scored green.
- **Criterion 6 deliberately left open.** D-32 admits only `Rejected`. The artifact says so in its own bytes, and the script now emits that verdict itself rather than only printing it.
- **A burn-rate number nobody had.** 4 lanes × 25 min = **0.15** of a five-hour window. Reaching `Rejected` by this route needs ~6–7× the dose: hours, or many more lanes. The instrument works; the dose was too small.
- **The observer is no longer in the burn path.** Attempt 2 died because an executor agent drove the burn on the window it was draining. `--live` makes zero API calls of its own, so it is run from a terminal. `FLYWHEEL_UAT_CREDENTIAL_SOURCE_DIR` additionally lets the spent window belong to a different account.

## Task Commits

1. **Task 1: decision checkpoint** — resolved before this session to `burn-both-now` with the scratch repo. Not re-asked (`.continue-here.md` records it as a blocking anti-pattern).
2. **Task 2: live planner observation** — `b058d910`
3. **Task 3: burn, capture, verdict** — `87231e67` (text-only burn), `5a389663` (credential source), `a62dc962` + this commit (finding log, artifact, verdict)

## Deviations

- **`scripts/uat/lib/sidecar-harness.mjs`** is not in the plan's `files_modified`. Threading `FLYWHEEL_UAT_CREDENTIAL_SOURCE_DIR` into the `sourceConfigDir` parameter that `composeIsolatedClaudeConfigDir` already exposed was needed to stop the measurement draining the window it runs in. Default unchanged, so every existing caller is unaffected.
- **`packages/core/tests/limit_rejected_replay.rs` and `scripts/uat/fixtures/live-hard-limit-rejected.json` were not created.** Correct per the plan: both exist only for a real rejection. `limit_gate.rs` is untouched.

## A misdiagnosis, recorded because the misreading is reusable

Mid-run the lanes looked dead — `events=45` flat for six minutes, `five_hour_utilization=?`, `spawns=1/1/1/1`, and **zero assistant words** in every session `.jsonl`. A stdout-backpressure hypothesis was written into the README and a `critical` board issue was filed against `startSession` for leaving lane stdin open.

Both were wrong, and were withdrawn before this commit. The run had been streaming the whole time: the durable session timeline records 132,448 words. In `-p` / `--output-format stream-json` mode assistant text goes to stdout for the adapter to consume and is never written to the session transcript, and the script's `events` counter does not tick per text chunk. The `Warning: no stdin data received in 3s, proceeding without it` line is exactly what it says.

The rule now in the README: judge a live lane's liveness from the durable session timeline under `FLYWHEEL_UAT_ARTIFACT_DIR`, or from the backend's own `five_hour_utilization`. Never from the transcript, never from a flat counter.

## What criterion 6 still needs

More dose and patience, not a better instrument: many more concurrent lanes, or hours rather than minutes, ideally on an account whose window is already partly drained.
