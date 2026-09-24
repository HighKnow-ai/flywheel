---
status: testing
phase: 05-socratic-epic-authoring
source: [05-VERIFICATION.md]
started: 2026-09-24T04:35:00Z
updated: 2026-09-24T04:35:00Z
---

## Current Test

number: 1
name: Live challenge quality (SHAPE-01's core claim)
expected: |
  Run `node scripts/uat/uat-08-socratic-authoring.mjs` in live mode (no `--self-test`) against a real
  `claude` binary and real credentials. Every structural prerequisite is now in place: 05-11's
  permission-request drain, 05-13's premise field, 05-12's composer, and 05-14's delivery-gated
  transcript integrity.

  During the `challenge` stage the agent must push back on the stated premise and ask substantive
  clarifying questions — not affirm or restate what was typed. The script writes
  `05-LIVE-CHALLENGE-TRANSCRIPT.md` with both verbatim replies and two `UNJUDGED` verdict lines;
  read the replies and fill the verdict lines in.
awaiting: user response

## Tests

### 1. Live challenge quality (SHAPE-01's core claim)
expected: Run `node scripts/uat/uat-08-socratic-authoring.mjs` in live mode (no `--self-test`) against a real `claude` binary and real credentials. During the `challenge` stage the agent pushes back on the developer's stated premise, asks substantive clarifying questions, and does not simply affirm or restate what was typed. The script writes `05-LIVE-CHALLENGE-TRANSCRIPT.md`; fill in its verdict lines after reading the two verbatim replies.
why_human: Judgment about live model dialogue quality — no structural check can certify it. The question-mark heuristic the script already applies is a proxy, not the property. Note this test spends real API credentials.
command: node scripts/uat/uat-08-socratic-authoring.mjs
evidence_file: .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md
result: [pending]

### 2. Product Kill Criterion — in-app vs. terminal comparison
expected: |
  `node scripts/uat/uat-09-product-kill-criterion.mjs --list-runs` to find a run id, then
  `node scripts/uat/uat-09-product-kill-criterion.mjs --in-app-run <runId> --terminal-project <projectId>`
  while performing the identical shaping exercise typed directly into a terminal.

  The instrument reads the in-app arm's elapsed time and amendment rate from the board (no stopwatch —
  `measure_authoring_run` already returns `elapsedMinutes` from run start to last acceptance), times the
  terminal arm on its own clock, computes the verdict by `computeKillCriterionVerdict`'s strict-inequality
  rule, and writes `05-KILL-CRITERION.md`.
why_human: The terminal arm is a human-paced baseline by definition — a scripted arm would measure the script's typing speed, not the developer's. Everything around that act is instrumented.
command: node scripts/uat/uat-09-product-kill-criterion.mjs --list-runs
evidence_file: .planning/phases/05-socratic-epic-authoring/05-KILL-CRITERION.md
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

<!-- No code gaps. The prior round's G-05-1 (uat-08 starved on unanswered permission requests) and
     G-05-2 (no human-turn surface in the app) are both closed — by 05-11 and by 05-12/05-13
     respectively — and the gap-closure round 05-14..05-17 closed the transcript-integrity blocker
     (CR-01) plus WR-04, WR-05 and WR-06. Both items above are human judgements with working
     instruments, not defects. -->
