---
created: 2026-10-05T17:05:00.000Z
title: Forge resolution failures are not memoised, so they retry per worktree every tick
area: desktop
severity: major
files:
  - packages/desktop/src-tauri/src/scheduler.rs
source: phase-07 verification, Backlog Candidate 4 (related to code review HI-01)
---

## Problem

`forge_tick_targets` memoises per-project forge resolution in a `resolved: HashMap<...>`, but
it only inserts on a **successful** resolution. A project whose `forge_and_repo_path` call
returns an error is therefore re-attempted for every tracked worktree belonging to that
project, on every tick.

Each attempt includes the bounded local `git remote get-url origin` spawn that
`detect_forge_from_origin` performs when no `projects.forge` override is stored — and that
happens while the DB lock is held, because resolution is deliberately the under-lock phase
of the restructured tick.

Each individual attempt is bounded by `GIT_TIMEOUT_SECS = 120`, so this cannot reproduce the
unbounded app-wide freeze that phase 07's Gap 1 was about. But a project with many worktrees
and a reliably-failing resolution (a deleted repo path, a corrupt git dir, a permissions
problem) could still hold the lock for `worktree_count × up to 120s` within a single tick —
which is the same *class* of symptom the gap-closure round was built to eliminate, reached by
a different route.

## Fix

Cache the `Result`, not only the `Ok`, in the `resolved` map: a project whose resolution
failed should be attempted once per tick at most, not once per worktree. Consider also
logging the failure once per tick rather than once per worktree, so a broken project does not
flood stderr.

A fuller fix would move `detect_forge_from_origin`'s spawn out of the under-lock phase
entirely — resolution would then take no lock at all — but that is a larger change than this
item needs, and the per-tick cache removes the multiplier that makes it matter.
