---
status: testing
phase: 14-cycles-on-screen-state-in-colour
source: [14-VERIFICATION.md]
started: 2026-10-16T12:30:00Z
updated: 2026-10-16T12:30:00Z
---

## Current Test

number: 1
name: Does `merged` count as satisfied while drawn nowhere?
expected: |
  Criterion 3 names `merged` among the states that must be rendered by the single
  state component. The `merged` class is defined, tokenised, CVD-proven, contrast-checked
  and unit-tested through `StateBadge` — but no surface draws it through `StateBadge`.
  The word appears as plain text in `MergeConfirmSheet`, `ReviewSurface` and
  `WorktreeInventory`, and it is not seeded on the demonstration board.
  The owner decides whether a defined-and-proven-but-undrawn state satisfies criterion 3,
  or whether it owes a drawing site before the phase closes.
awaiting: user response

## Tests

### 1. Does `merged` count as satisfied while drawn nowhere?
expected: Criterion 3 names `merged` among the states the single component must render. It is defined, tokenised, CVD-proven, contrast-checked and unit-tested, but no surface draws it through `StateBadge`; the word appears as plain text in `MergeConfirmSheet`, `ReviewSurface` and `WorktreeInventory`. Verifier marked this UNCERTAIN — the one unverified must-have of twelve. (`ci_failed` differs: it has a wired call site and is merely not seeded.)
result: [pending]

### 2. Are the legacy blocked/destructive colour consumers acceptable, or should they go through StateBadge?
expected: Three sites colour a state through the older `--blocked-text-rack` / `--destructive-text-rack` roles rather than `StateBadge` — `ProjectRail.tsx:363` (the rail's Blocked count), `BlockedQueue.tsx:86` (the "Blocked" label) and `PermissionRequestCard.tsx:286`. The source gate cannot see them, because it only matches `--state-*`. This is the same class of defect as the already-filed red-beside-amber rail count, found independently by the verifier. The owner decides whether these are acceptable for now, or owe a rewire.
result: [pending]

### 3. Did "all good to me" cover the fleet as the colour surface, or does the goal's "the board" still owe something?
expected: The phase goal says "the board finally carries saturated state colour on a surface worth looking at". In the two screenshots the owner judged, the only state colour on the *board* surface is the two rail numerals — the measured figure is 2 of 1038 board rows (0.19%), by design after 14-09 found that washing all five classes turned the fleet into "a pastel plate". The colour actually lives on the *fleet* surface, which is 6 of 6 rows. The owner decides whether his verdict covered that reading of the goal, or whether the board itself still owes visible state colour.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
