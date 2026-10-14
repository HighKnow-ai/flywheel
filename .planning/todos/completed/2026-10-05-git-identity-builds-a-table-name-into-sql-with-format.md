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

## Resolution

Resolved by plan 13-05 (Phase 13, FNC-02), 2026-10-14.

- `git_identity.rs` no longer interpolates a table name into SQL. Its two surviving `format!` calls
  (`--disambiguate={sha}` and the `--format=` argument) build git CLI arguments, not SQL. No code
  change was needed in that file. Grep: `(FROM|INTO|UPDATE|JOIN)\s+\{` over `packages/core/src`
  reports no non-comment line.
- The convention is now a crate-wide gate, not a grep nobody runs:
  `no_sql_statement_interpolates_a_table_name` in `packages/core/tests/proposal_no_promotion.rs`,
  with `the_table_name_interpolation_gate_fires_on_a_planted_violation` proving the matcher fires.
- The gate's first run found one real site elsewhere: `query/search.rs` built its two FTS5 table
  names into a const template with `.replace("{table}", ...)`. Replaced with one static statement
  per table.
