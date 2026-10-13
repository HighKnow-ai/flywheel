---
created: 2026-10-05T17:09:00.000Z
title: git_identity builds a table name into SQL with format!, against the crate convention
area: core
severity: trivial
files:
  - packages/core/src/git_identity.rs:62-69
source: phase-07 verification, Backlog Candidate 5 (code review WR-01)
---

## Problem

`git_identity.rs` interpolates a table name into its SQL with `format!`. The interpolated
value is hardcoded to `"epics"` or `"tasks"`, so this is not exploitable — there is no path
by which external input reaches it.

It is filed because `packages/core` otherwise holds a no-`format!`-SQL convention with a grep
gate behind it, and this site sits outside that gate. The risk is not the current code; it is
that a future change widens the interpolated value to something caller-supplied, and the
convention that would have caught it has already been quietly broken here.

## Fix

Replace the interpolation with an explicit `match` that selects between two fully-written
static SQL strings, one per table. That keeps the SQL constant-folded, satisfies the crate's
grep gate, and removes the shape entirely rather than documenting an exception to it.

If the grep gate does not currently cover this file, extend it so the convention is enforced
across the whole crate rather than the part that happens to be scanned.
