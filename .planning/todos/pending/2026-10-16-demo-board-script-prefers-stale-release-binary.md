---
created: 2026-10-16T00:00:00.000Z
title: demo-board.sh prefers a stale release binary over the current debug build
area: tooling
severity: minor
files:
  - scripts/demo-board.sh
source: phase-14 plan 14-10 owner verdict, known-open items
---

## Problem

`scripts/demo-board.sh` loops `release debug` and takes the first binary found (lines about 56 to 62). The release binary on disk predates Phase 14 (mtime 2026-10-12), so a bare run shows an old frontend. `scripts/capture-cycle-region.mjs` works around it by building and launching the debug binary itself; the script was not fixed.

## Acceptance

- The script launches the newest of the binaries it finds, or names the one it chose and its mtime.
