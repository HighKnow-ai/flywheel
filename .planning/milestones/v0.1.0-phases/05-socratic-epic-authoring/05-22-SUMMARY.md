---
phase: 05-socratic-epic-authoring
plan: 22
subsystem: testing
tags: [uat, socratic-authoring, instrument-hardening, live-run, gap-closure]

requires:
  - phase: 05-socratic-epic-authoring (plans 05-20, 05-21)
    provides: the fixed capture instrument — whole-turn capture bounded by the backend's own end-of-turn marker, a conversation driver that answers what the agent actually asked, and a three-valued noWorkPlanned reading
provides:
  - "scripts/uat/README.md Item 8: a fourth documented arm (--replay-check), a third finding naming gap G-05-2, and one generalised rule — every property a live script asserts must be provable without a live run"
  - "05-VALIDATION.md: a ledger row for every task in this closure (05-20-01 through 05-22-03), each naming a command that was actually run and observed"
  - "the developer's credential-spend decision, taken as a gate="blocking-human" checkpoint, with his verbatim answer recorded"
  - "one authorised live uat-08 run, executed and its FAILURE recorded honestly — including a newly-discovered, fourth failure mechanism this wave's three self-naming classes do not cover"
affects: [phase-06-agent-authored-backlog, any-future-live-uat-script]

actuals:
  tokens: 5300
  tasks: 3
  commits: 2
plan_head_before: f03c537

tech-stack:
  added: []
  patterns:
    - "A live-arm failure is read for its own root cause before being classified into one of the wave's named failure classes — a failure naming a genuinely new mechanism gets recorded and deferred to a fresh gap, never patched in place or silently retried."

key-files:
  created: []
  modified:
    - .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md
    - .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md
    - scripts/uat/README.md

key-decisions:
  - "Developer's verbatim answer to the Task 2 checkpoint: \"Authorise one run\" — Branch B taken."
  - "The live run's failure (no proposal_created event within 120s) was diagnosed to its actual root cause — an Anthropic safety-classifier refusal (reasoning_extraction) on the distillation-instruction turn, silently captured by the harness as ordinary agent text — and recorded as a FOURTH, new failure mechanism outside this wave's three self-naming classes, per the task's explicit instruction not to re-run and not to patch a new mechanism into this closure."

requirements-completed: [SHAPE-01, SHAPE-03, SHAPE-05]

coverage:
  - id: D1
    description: "README Item 8 documents all four uat-08 arms, the third finding (gap G-05-2) and the generalised rule that every asserted property must be provable without a live run; 05-VALIDATION.md carries a ledger row per task in this closure"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "test \"$(grep -c '^### Item 8' scripts/uat/README.md)\" = \"1\""
        status: pass
      - kind: other
        ref: "for id in 05-20-01 05-20-02 05-20-03 05-21-01 05-21-02 05-21-03 05-22-01 05-22-02 05-22-03; do grep -q \"$id\" .planning/phases/05-socratic-epic-authoring/05-VALIDATION.md; done"
        status: pass
    human_judgment: false
  - id: D2
    description: "The credential-spend decision is gated blocking-human (never auto-answerable) and the developer's verbatim answer authorising exactly one run is recorded in the ledger"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "grep -q 'gate=\"blocking-human\"' .planning/phases/05-socratic-epic-authoring/05-22-PLAN.md"
        status: pass
    human_judgment: false
  - id: D3
    description: "One authorised live run executed exactly once; it did not complete (no proposal arrived), and the failure is recorded honestly with its real root cause — a fourth, new instrument-failure mechanism not covered by this wave's three self-naming classes — never re-run, never silently patched, no ledger row falsely turned green"
    requirement: "SHAPE-01"
    verification:
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check"
        status: pass
      - kind: other
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check"
        status: pass
    human_judgment: true
    rationale: "Whether the failure was correctly diagnosed as a genuinely NEW mechanism (rather than a mispatched instance of one of the three known classes) is a judgment call about the transcript's own content, not something an exit code proves. SHAPE-01's and SHAPE-03's actual dialogue-quality/draft-usefulness judgements remain outstanding — the live run never reached a judgeable state — so both verdict lines in 05-LIVE-CHALLENGE-TRANSCRIPT.md are still UNJUDGED and REQUIREMENTS.md's pre-existing 'Complete' status for SHAPE-01/SHAPE-03 (set before this gap-closure wave existed) is not re-earned by this plan."

duration: 20min (this continuation session; Task 1 ran in a prior session before the Task 2 checkpoint)
completed: 2026-09-24
status: complete
---

# Phase 5 Plan 22: uat-08 Instrument Hardening — Rule Recorded, Ledger Completed, One Authorised Live Run Fails on a New Mechanism Summary

**Closed gap G-05-2's documentation debt (README rule + nine-row ledger), then spent the developer's authorised live-run credit — which surfaced a genuinely new instrument-failure mechanism (an Anthropic safety-classifier refusal silently captured as agent text) rather than confirming the fix.**

## Performance

- **Duration:** ~20 min this continuation session (Task 1 committed in a prior session at 16:41:38+08; Task 2's checkpoint was answered by the developer between sessions; Task 3 ran and committed at 16:51:00+08)
- **Started:** 2026-09-24T08:41:38Z (Task 1 commit)
- **Completed:** 2026-09-24T08:51:31Z
- **Tasks:** 3 (Task 1: auto: Task 2: checkpoint:decision, resolved; Task 3: auto)
- **Files modified:** 3 (`scripts/uat/README.md`, `05-VALIDATION.md`, `05-LIVE-CHALLENGE-TRANSCRIPT.md`)

## Accomplishments

- `scripts/uat/README.md` Item 8 now documents all four `uat-08` arms (`--self-test`, `--board-read-check`, `--replay-check`, the live arm), the third finding against gap `G-05-2`, and the rule that would have prevented all three of this phase's instrument findings: every property a live script asserts must be provable without a live run.
- `05-VALIDATION.md` carries a ledger row for every one of the nine tasks in this closure (`05-20-01` through `05-22-03`), each naming a command that was actually run and observed rather than forecast.
- The developer's credential-spend decision was taken through a `gate="blocking-human"` checkpoint — never auto-answerable — and his verbatim answer ("Authorise one run") is recorded in the ledger.
- One live `uat-08` run was executed, exactly once, against the durable staged `CLAUDE_CONFIG_DIR` (`FLYWHEEL_UAT_CLAUDE_CONFIG_DIR=/tmp/flywheel-uat-claude-config`). It did not reach a judgeable state — no `proposal_created` event arrived within the 120s deadline (run `01M399FP80B184QM2RXTXJDZTK`, 2026-09-24T08:48:54.481Z).
- The failure was diagnosed to its real cause rather than assumed to be one of the three known classes: turn 3 of the captured transcript is not agent content at all — it is Anthropic's own safety-classifier refusal message (`reasoning_extraction`) for the distillation-instruction turn, which the harness's `waitForTurn` captured as ordinary text (`endedBy=result`) because an API-level content refusal arrives on the same event shape as a normal reply. This is recorded as a **fourth, new failure mechanism** — outside this wave's three self-naming classes — and, per the task's own instruction, was not re-run and not patched into this closure.
- `05-VALIDATION.md`'s `05-22-03` row is marked red with the failure recorded verbatim and its root cause named; `05-22-02` records the developer's verbatim answer. No verdict line in `05-LIVE-CHALLENGE-TRANSCRIPT.md` was filled; no ledger row was turned green on the strength of a run that did not complete.
- `--self-test`, `--board-read-check` and `--replay-check` all still exit 0 after the live run — the instrument itself (the capture/conversation-driver/criterion-reading fixes from plans 05-20/05-21) did not regress; the new failure is an API-level content-refusal handling gap, a different layer entirely.

## Task Commits

1. **Task 1: The rule recorded where the next author reads it, and a ledger row per task** — `1679b3f` (docs) — completed in a prior session
2. **Task 2: The developer decides whether one live run is worth its credentials** — checkpoint, no commit; resolved by the developer's verbatim answer "Authorise one run"
3. **Task 3: Execute the developer's decision, and record the outcome honestly either way** — `b16b3c5` (test)

**Plan metadata:** this SUMMARY's own commit (pending)

_Note: this SUMMARY covers a resumed plan — Task 1 was executed and committed by a prior executor session; this continuation picked up after the Task 2 checkpoint was answered and executed Task 3._

## Files Created/Modified

- `scripts/uat/README.md` — Item 8's fourth arm, third finding (`G-05-2`), and the generalised offline-provability rule (Task 1, prior session)
- `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md` — nine new ledger rows (Task 1, prior session); `05-22-02`/`05-22-03` rewritten with the decision and the live run's honest outcome (Task 3, this session)
- `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` — regenerated by the live run (run `01M399FP80B184QM2RXTXJDZTK`); both verdict lines remain `UNJUDGED`, exactly as the failed run leaves them

## Decisions Made

- **Developer's verbatim answer to the Task 2 checkpoint: "Authorise one run."** Selected option `authorise` — spend real API credentials on exactly one live `uat-08` run, per the plan's own gate design (a `blocking-human` decision that auto-mode cannot answer).
- **The live run's failure was classified as a fourth, new mechanism, not force-fit into one of this wave's three known classes.** It is not a starved held request (plan 05-18's class) — the event log shows every `permission_request`/`board_read_request` answered. It is not a turn-capture timeout naming captured chunk/char counts (plan 05-20's class) — the distillation turn ended cleanly on `result`, not on a deadline rejection. It is not a `noWorkPlanned` refused/unproven/violated misread (plan 05-21's class) — `unproven` is the objectively correct reading here, since no propose attempt was ever actually made (the model's real turn never happened). The actual cause — an Anthropic safety-classifier refusal on the distillation-instruction turn, captured by the harness as if it were ordinary agent content — is a distinct, previously-unseen failure surface (API-level content refusal vs. harness-level starvation/timeout/misread), and per Task 3's explicit instruction it is recorded here rather than patched or retried.

## Deviations from Plan

None — plan executed exactly as written, including its own explicit instruction for exactly this outcome ("If it fails, read the failure before touching anything... Record verbatim what the failure names... A failure naming a NEW mechanism belongs in a fresh gap, not a patch to this task").

## Issues Encountered

**The live run failed for a reason none of this wave's three self-naming failure classes cover.** Root cause: Anthropic's own model-safety classifier (`reasoning_extraction`) refused the distillation-instruction turn ("Before we move on: call `propose_assumption` once for EACH assumption you challenged in this stage...") with an API-level error, and the harness's `waitForTurn` captured that refusal's error text as if it were the agent's own reply (`chunks=1 chars=432 endedBy=result`) rather than recognizing it as a distinct API-error condition. Because no real model turn followed, no `propose_assumption`/`propose_task` call was ever made, and the subsequent 120s wait for a `proposal_created` event timed out with no proposal pending. This is a fourth, new failure mechanism — **not fixed by this plan**, and per this task's own explicit instruction, not patched into it. It belongs in a fresh gap for a future plan: the harness should distinguish an API-level safety/content-refusal error from ordinary captured agent text, most likely by inspecting the raw sidecar event for an error/refusal marker before treating its content as turn text.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The instrument-hardening lineage this phase carried (gap `G-05-1`, permission/board-read starvation; gap `G-05-2`, capture truncation/mid-generation-advance/vacuous-propose-reading) is closed and proven offline. A **new, fifth-in-sequence gap** is now visible: the harness does not distinguish an Anthropic safety-classifier refusal from ordinary agent text when capturing a turn. This should be filed and closed before the next live `uat-08` run is attempted, or a future authorised run risks repeating this exact failure for the same undiagnosed reason.
- SHAPE-01's dialogue-quality judgement and SHAPE-03's draft-usefulness judgement remain genuinely outstanding — no offline arm can close them, and this session's one authorised live run did not reach a judgeable state. `REQUIREMENTS.md`'s pre-existing "Complete" status for SHAPE-01/SHAPE-03 (set by an earlier plan, before this gap-closure wave existed) is unaffected by this plan and was not touched here; the mismatch between that status and the still-`UNJUDGED` verdict lines is the exact condition this whole gap-closure lineage exists to surface honestly, not to paper over.
- No further credentials should be spent on `uat-08` until the new capture gap (safety-refusal vs. ordinary text) is fixed — a retry against the same defect would very likely fail the same way for the same reason.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- FOUND: `scripts/uat/README.md`
- FOUND: `.planning/phases/05-socratic-epic-authoring/05-VALIDATION.md`
- FOUND: `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md`
- FOUND: commit `1679b3f` (Task 1)
- FOUND: commit `b16b3c5` (Task 3)
- Plan-level `<verify>` re-run: `--self-test` exit 0, `--board-read-check` exit 0, `--replay-check` exit 0, `grep -c '05-22-03' 05-VALIDATION.md` = 1 — all pass.

---

## Correction — appended 2026-09-24 (plan 05-26)

This SUMMARY's own "Next Phase Readiness" section above (unedited — this is an appended
correction, not a rewrite) said the safety-classifier defect this plan found "should be filed and
closed before the next live `uat-08` run is attempted." That sentence records what was believed at
the time it was written. It turned out to be only half right: the defect needed closing, and it
was — but it was never filed as a todo.

**Where it was actually closed:** plan `05-24`. `readBackendRefusal` (new,
`scripts/uat/lib/sidecar-harness.mjs`) reads a turn's accumulated text for the exact banner
Anthropic's own API-level safety-classifier refusal opens with, anchored at the start of the text
so ordinary prose is never misread as a refusal. `driveChallengeConversation` now stops the moment
a refusal lands on a captured turn — reporting it, settling `false`, and never discarding the turns
already captured — instead of continuing on to wait out the 120-second `proposal_created` deadline
this plan's own live run (`01M399FP80B184QM2RXTXJDZTK`) got stuck behind. This is proven offline,
for zero tokens, by the `backend-refuses-mid-conversation` `--replay-check` scenario, which
reproduces this plan's own captured turn 3 verbatim as its fixture.

**No todo was created for this defect, and none should be now.** A pending todo naming an
already-closed defect is noise a future reader would have to independently disprove — worse than no
todo at all. The one file actually sitting in `.planning/todos/pending/` as of this correction
(`2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md`) is pre-existing,
unrelated to this defect (a shipped-product adapter finding from this same debugging session, in a
different subsystem, on a different failure path — see that file's own "Provenance" note), and was
deliberately left untouched by this closure. A reader who finds exactly one pending todo should not
mistake it for the safety-classifier defect this correction resolves.
