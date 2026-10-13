---
created: 2026-09-26T01:37:59.815Z
title: G-05-8 AskUserQuestion invisible and board unwritable in live run
area: tooling
severity: blocker
files:
  - scripts/uat/uat-08-socratic-authoring.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
---

## Problem

Two defects surfaced by live run `01M3DNC0G9CYAWSD8DYEGTRP8C` (2026-09-26, phase 05,
the first live run after gap-closure round 9). The run authenticated as the developer on
the claude.ai subscription login, held a real two-turn conversation with `claude-opus-5`,
and then failed at the distillation turn on a backend `invalid_request`. Round 9's own
fixes all held — the evidence sheet grew 2645 → 10556 bytes on the failure path, the
credential-path artifact survived, and the scratch root was preserved — and it is only
because the scratch root survived that defect (a) below could be diagnosed at all.

### (a) `AskUserQuestion` is neither captured nor answered — SHAPE-01 is unjudgeable

The agent asked its three clarifying questions through the `AskUserQuestion` tool, not as
assistant text. Two consequences, from one root cause:

1. **The questions never reached the evidence sheet.** The harness captures only
   `assistant_text` chunks, so the transcript reads
   `"…three things would materially change the shape of the spec:"` immediately followed by
   `"You didn't pick — no problem."` — the questions themselves are absent. SHAPE-01 is
   "the agent challenges assumptions and asks clarifying questions"; the questions ARE the
   evidence, and they are silently missing from the artifact a human is asked to judge.
2. **The driver answered them with "The user did not answer the questions."** The harness
   has no handler for `AskUserQuestion`, so the Socratic exchange cannot develop past the
   first turn. The agent proceeded on stated defaults instead of being answered and pushed
   back on, which confounds any live judgement of challenge quality.

This is the same root shape as `G-05-7`'s third finding (reasoning blocks and
`rate_limit_event` unmodelled at the seam, dumped as raw text): a content-block type the
harness does not model. It is more damaging here because the unmodelled shape carries the
feature under test rather than diagnostic noise.

Recovered evidence: the three questions were `Triggers` (assigned-to-me / @mentioned /
activity-on-my-items / due-overdue), `Channels` (in-app / email / push / Slack) and
`Timing` (real-time per event / real-time in-app + digest / user-configurable), each option
annotated with its own hidden cost. They were recovered post hoc from Claude Code's own
session JSONL inside the preserved scratch root — not from the product's evidence sheet.

### (b) The board was unwritable for the whole live run — SHAPE-02/03/04 never exercised

Every `propose_epic` and `propose_assumption` call was refused:

    Flywheel could not verify the authoring stage allows this call
    (no authoring stage marker could be read for this run) — refusing it.

The run log nevertheless reports `run 01M3DNC0G9CYAWSD8DYEGTRP8C started in the challenge
stage`, and the driver later advanced the stage through the human gate (D-90) without
error. So the stage marker was set for the run and the MCP tool could not read it.

Nothing reached the board. The evidence sheet records `Drafted criteria: 0`, and the shaped
epic — six tasks, each with acceptance criteria — exists only as prose in the conversation.
SHAPE-02 (outcome written to the board as structured items), SHAPE-03 (drafted criteria the
user can edit before accepting) and SHAPE-04 (accept/reject/amend each item individually)
therefore have no live evidence at all, only offline coverage.

This is the project's Core Value failing in a live run: "every unit of agent work is
anchored to a structured board item with real acceptance criteria — never a chat blob." In
this run it was exactly a chat blob.

## Solution

TBD — needs planning as gap-closure round 10. Shape of the work, not a prescription:

- **(a)** Model `AskUserQuestion` at the adapter seam, the same remedy plans 05-30, 05-34
  and 05-37 used for the previous instances of this class: carry the tool call's own
  question/option payload through as a typed event rather than reconstructing it in the
  harness. Then (i) render it into the evidence sheet as part of the agent's turn, and
  (ii) give the driver a real handler so it can answer and the dialogue can continue.
  Freeze a fixture from this run's preserved session JSONL, as the other shapes already are.
- **(b)** Diagnose why the stage marker is unreadable from the MCP tool's side when the run
  demonstrably started in the challenge stage — a read-path/scoping mismatch, not a missing
  marker. This one is a product defect in the authoring gate, not an instrument defect, so
  the fix belongs in `packages/`, not `scripts/uat/`.
- Verify both offline before spending another credential; the round-9 rule that an offline
  arm proves a property only when it runs the same path the live arm will still applies.

Preserved artifacts for the next session (may age out of `$TMPDIR`):

- scratch root: `/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-socratic-authoring-PX6GnV`
- session JSONL with the full block structure, including the `AskUserQuestion` payload:
  `<scratch root>/claude-config/projects/-private-var-folders-…-repo/3b4a4da5-bd8b-407d-90d1-e3bcf9063fd5.jsonl`
- credential-path artifact:
  `$TMPDIR/flywheel-uat-artifacts/socratic-authoring-2026-09-26T01-30-43-579Z-uat-08-credential-path.json`
