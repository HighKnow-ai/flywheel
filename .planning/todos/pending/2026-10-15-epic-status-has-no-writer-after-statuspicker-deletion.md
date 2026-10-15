---
created: 2026-10-15T00:00:00.000Z
title: Epic status has no writer after StatusPicker deletion
area: desktop
severity: major
resolves_phase: 14
files:
  - packages/desktop/src/board/pickers/StatusPicker.tsx:deleted
  - packages/desktop/src-tauri/src/commands/epic.rs
  - packages/core/src/domain/epic.rs
---

## Problem

Plan 13-07 deleted `StatusPicker.tsx` to satisfy DRFT-04 ("status is derived, not nudged").
The picker moved **epics as well as tasks**, but D-19 specifies its deletion without saying
what epics do instead, and the plan scopes DRFT-04 to tasks only.

Consequence in shipped product code: **nothing in the renderer can change an epic's
status.** `epic_set_status` (IPC) and `set_epic_status` (core) both still exist and still
work; they simply have no caller. An epic created today keeps whatever status it was created
with, for the lifetime of the board, with no UI affordance to move it.

The task half of this is correct and deliberate — the deriver owns `tasks.status`. The epic
half is an unintended gap: task status became *derived*, epic status became *frozen*.

## Why this is filed rather than fixed

Deriving epic status from its tasks is new behaviour with an unmade product decision at its
centre (what aggregation rule — all-done, any-in-progress, weighted?). Epics also have no
surface of their own until Phase 14 builds the Cycle and roadmap region, which is where
epic progress is meant to be read. Fixing it in Phase 13 would mean inventing both the rule
and its surface with no consumer to judge them against.

Owner decision, 2026-10-15: file it, resolve in Phase 14 against the real surface.

## Note on requirement state

DRFT-04 is marked **complete** in REQUIREMENTS.md. That is defensible — it is scoped to
tasks — but it means this gap sits behind a satisfied requirement and will not be surfaced
by requirement traceability. This todo is the only record.

## Acceptance

- An epic's status either derives from its tasks under a stated rule, or has an explicit
  human control on the Phase 14 surface.
- Whichever is chosen, `epic_set_status`'s reachability matches it (see the companion todo
  on orphaned status commands).
