---
created: 2026-09-26T19:40:00.000Z
title: Socratic challenge should be structured like GSD's questioning, not one wall of questions
area: authoring
severity: major
resolves_phase: 5.1
files:
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/desktop/src/session/SessionSurface.tsx
  - .planning/REQUIREMENTS.md
---

## Problem

SHAPE-01 requires only that "the agent challenges assumptions and asks clarifying
questions before any work is planned." It says nothing about the *shape* of the exchange,
and the shape is now known to be the weak part.

Live run `01M3ENQMC3E4M2HP7014MA84PX` (2026-09-26) passed SHAPE-01 on substance — the agent
disputed the developer's own framing ("a tray-only feature can't *ping* anyone — it can
only greet them") and argued part of the feature might not need building at all ("half of
this might be a saved filter"). Cyril read the transcript and judged the substance
acceptable but the structure insufficient.

The observed shape was:

1. Turn 2 — a single wall of five numbered questions, each with a pre-supplied default,
   plus a sixth "hardest to reverse" fork. This reads as a well-run requirements
   interview, which is the mode Flywheel is positioned *against*.
2. Turn 4 — the actual challenges, arriving only after the developer had answered.

Cyril wants this to work the way GSD's own questioning does: staged, adaptive rounds —
one focused question at a time, the answer shaping the next question, with the exchange
accumulating into a recorded artifact — rather than one batch emitted up front and
challenges appended afterwards.

## Why this is not a phase 5 item

Raised on phase 5's eleventh gap-closure round, in the same breath as wanting that phase
closed. SHAPE-01 already passes live. Adding a new requirement to a phase at this point is
the exact mechanism that has kept it open for ten rounds. Decision (2026-09-26): close
phase 5 on `G-05-9` alone, then insert **phase 5.1** for this rework.

## Not to be confused with

"Do it from the UI, not a Claude Code session" was raised at the same time and is **already
built** — `CommandPalette.tsx:388` → `startAuthoringSessionForProject`,
`SessionSurface.tsx:1287`'s `AuthoringComposer`, the stage indicator's Advance/Return
controls (plan 05-03), and `ProposalTray` (plan 05-12). The Claude Code session visible in
the phase 5 transcripts is the UAT harness's automation instrument, not the product
surface. No build work is implied by that half of the request — though phase 5.1 may want
to ask whether acceptance evidence should be gathered through the UI path rather than the
harness path.

## What a phase 5.1 needs to decide

- Whether "structured" means the agent is *prompted* into staged questioning, or the
  authoring session *enforces* one-question-at-a-time structurally (the way the challenge
  stage gate enforces no-proposals-before-advance).
- Whether the questions and their answers become a recorded artifact on the epic — which
  would make them reviewable the way GSD's own discussion log is.
- How this interacts with `--disallowedTools AskUserQuestion` (plan 05-41), which made the
  challenge stage deliberately prose-only. Structured questioning may want a typed
  question surface back — but as Flywheel's own, not the backend's.
