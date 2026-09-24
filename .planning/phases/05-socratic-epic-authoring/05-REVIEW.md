---
phase: 05-socratic-epic-authoring
reviewed: 2026-09-24T06:02:50Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - packages/core/src/query/authoring.rs
  - packages/core/tests/authoring_board_read.rs
  - packages/core/tests/authoring_measurement.rs
  - packages/core/tests/bin/uat_authoring_ops.rs
  - packages/core/tests/epic_context_packet.rs
  - packages/desktop/src-tauri/src/commands/authoring.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - scripts/uat/README.md
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/run-all.sh
  - scripts/uat/uat-08-socratic-authoring.mjs
  - scripts/uat/uat-09-product-kill-criterion.mjs
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-09-24T06:02:50Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

This is the incremental slice covering plans 05-14 through 05-19 (diff range `75803a3..HEAD`), whose
newest and least-reviewed work is plan 05-18's `resolve_board_read` extraction and the
`answer-board-read` bridge verb it required.

**The extraction is faithful and, incidentally, fixes a latent bug.** I diffed
`handle_inbound_board_read_request` byte-for-byte against its pre-extraction body and confirmed the
clamp/peek arithmetic and the three-way `readKind` dispatch moved into
`query::authoring::resolve_board_read` verbatim, with no duplicate copy left behind in the desktop
handler — exactly what the scope note asked me to verify. Better still: the pre-extraction handler
destructured `runId`/`requestId`/`readKind` together and returned *silently* (never relaying an
answer) if `readKind` was absent — an unanswered held call, the exact starvation class this whole
plan exists to close. The extracted `resolve_board_read` no longer treats a missing `readKind` as an
early return; it falls through to the `other => anyhow::bail!(...)` arm, which **is** relayed as an
error. This is a real, if incidental, improvement, not a regression.

**The `answer-board-read` test-bridge guard is intact.** `uat_authoring_ops.rs`'s new
`answer-board-read` subcommand is dispatched from the ordinary `match subcommand` arm, *after*
`open_conn()` — meaning it still goes through the `FLYWHEEL_APP_DATA_DIR`-or-refuse guard like every
other write-capable subcommand. It is correctly **not** grouped with the three read-only exceptions
(`measure-run`, `recent-authoring-runs`, `measure-board-counts`), which deliberately open the
developer's real database read-only, before any migration and before the scratch-dir guard.

**The `resolve_board_read` allowlist entry is honest.** Its two inline `SELECT`s really are
cardinality-one/aggregate (a `PRIMARY KEY` lookup on `agent_runs.id`, and a `COUNT(*)` with no
`GROUP BY`), matching the same shape `get_epic_for_agent`/`BLOCKED_COUNT_SQL` are already
allowlisted for — this is not papering over an unbounded read.

Two issues surfaced during this pass, both in code this diff touched:

1. The gate meant to catch exactly this class of drift (`epic_context_packet.rs`'s
   `unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist`) has a
   scanning blind spot that let a genuinely new, un-LIMIT'd `SELECT` in `measure_authoring_run` slip
   through completely unlisted and undetected.
2. `scripts/uat/README.md` — explicitly in scope, and the file whose own opening line calls itself
   "the tooling" documenting what each script proves — was never updated for the new UAT item 9
   (`uat-09-product-kill-criterion.mjs`), despite `run-all.sh` now running it on every pass.

## Warnings

### WR-01: The unbounded-SELECT allowlist gate has a chunk-level masking blind spot, and a new unbounded query already exploits it

**File:** `packages/core/src/query/authoring.rs:395-404` (the `last_accepted_at` query inside
`measure_authoring_run`), gated (or rather, not gated) by
`packages/core/tests/epic_context_packet.rs:689-868`

**Issue:** This diff's WR-05 fix in `measure_authoring_run` correctly split one combined,
`LIMIT`-bounded read into two separate reads — a bounded `proposal_stmt`/`amended_stmt` pair and an
**unbounded** `last_accepted_at` aggregate (`SELECT MAX(e.occurred_at) FROM events e JOIN
authoring_proposals p ... WHERE ... AND e.event_type = 'proposal.accepted'`, no `ORDER BY`, no
`LIMIT`, deliberately — the doc comment above it explains why this one is safe: `MAX` with no
`GROUP BY` always returns exactly one row).

That query is a legitimate, safe, cardinality-one aggregate — the same shape `get_epic_for_agent`
and `BLOCKED_COUNT_SQL` are already named for in `ALLOWED_UNBOUNDED_SELECTS`. But **it was never
added to that allowlist**, and this diff's own change to `epic_context_packet.rs` (see
`git diff 75803a3..HEAD -- packages/core/tests/epic_context_packet.rs`) only ever added one new
entry — `resolve_board_read` — never `measure_authoring_run`.

The reason this slipped past `cargo test -p core --test epic_context_packet
unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist` (confirmed:
it still passes) is a real gap in the scanner itself, not luck: `scan_file_for_unbounded_selects`
splits the source into coarse chunks at `fn`/`const` boundaries, then concatenates **every string
literal in the whole chunk** via `extract_string_literals` before checking
`literal_text.contains("LIMIT")`. `measure_authoring_run` is one chunk. That chunk *also* contains
`proposal_stmt`'s and `amended_stmt`'s own `LIMIT ?2` literals, so the concatenated `literal_text`
contains the substring `"LIMIT"` — and the scanner's `if literal_text.contains("LIMIT") { continue;
}` short-circuits the **entire chunk**, including the un-LIMIT'd `last_accepted_at` query sitting
right next to them.

This directly contradicts the allowlist's own stated guarantee: "a rename or a genuinely new
unbounded read both surface as a real diff here, not a silent pass" (`ALLOWED_UNBOUNDED_SELECTS`'s
doc comment). A genuinely new unbounded read was added in this very diff and it was a silent pass.
The query itself is not dangerous today, but the mechanism that is supposed to force every new
unbounded read to be named and justified did not do its job here, and would just as silently pass a
future *unsafe* unbounded read added inside any function/const chunk that happens to contain even
one unrelated `LIMIT`-bearing literal elsewhere in its body.

**Fix:** Either of:
- Add `"measure_authoring_run"` to `ALLOWED_UNBOUNDED_SELECTS` in `epic_context_packet.rs` with the
  honest cardinality-one justification (matches this file's own stated discipline of naming every
  tolerated exception), or
- Tighten the scanner to check for `LIMIT` per-`SELECT`-statement rather than per-chunk (e.g. split
  `literal_text` on `SELECT` boundaries and require each resulting segment to contain `LIMIT` unless
  the chunk's own identifier is allowlisted), so a future chunk mixing a bounded and an unbounded
  read can't mask the unbounded one.

```rust
// epic_context_packet.rs — minimal fix, naming the debt honestly like every other entry:
const ALLOWED_UNBOUNDED_SELECTS: &[&str] = &[
    // ...
    "measure_authoring_run", // authoring.rs — its last_accepted_at read is a MAX() aggregate with
                              // no GROUP BY, always exactly one row, the same shape
                              // get_epic_for_agent/BLOCKED_COUNT_SQL are allowlisted for; the
                              // scanner's own chunk-level literal concatenation currently masks
                              // this because the SAME function also contains two LIMIT'd reads —
                              // named explicitly here rather than relying on that masking.
];
```

### WR-02: `scripts/uat/README.md` documents nothing about the new UAT item 9

**File:** `scripts/uat/README.md` (no changes touching item 9 anywhere in the file)

**Issue:** `scripts/uat/run-all.sh` was updated in this diff to run
`node scripts/uat/uat-09-product-kill-criterion.mjs` as `"UAT 9 — Product Kill Criterion, in-app vs
terminal-paced (05-17-PLAN.md)"` on every pass. `uat-09-product-kill-criterion.mjs` is a new,
527-line script with three distinct modes (`--self-test`, `--list-runs [n]`, `--in-app-run <runId>
[...]`) and a documented behavior that matters for anyone reading `run-all.sh`'s output: run with no
flags (exactly how `run-all.sh` invokes it), it always prints a usage line and unconditionally
SKIPs, because the live comparison needs a human operator at the terminal.

None of this is documented in `README.md`. Every other item (1 through 8) has: a row in the summary
table near the top, a dedicated `### Item N` section explaining what it proves and how to read its
output, and an entry in the "Pieces" table at the bottom. Item 9 has none of the three. A developer
running `bash scripts/uat/run-all.sh` and seeing `⏭️  SKIP UAT 9 — Product Kill Criterion...` in the
results table has no doc in this directory explaining that this is expected, how to actually run the
live comparison (`--list-runs` then `--in-app-run`), or what the `05-KILL-CRITERION.md` sheet it
writes means — the exact gap this README's own opening line says it exists to close ("That is a
statement about missing tooling, not about the guarantees. This directory is the tooling.").

**Fix:** Add a `### Item 9 — Product Kill Criterion comparison` section (mirroring Item 8's
structure: what each of the three arms does, that it always skips unattended, and how to read
`05-KILL-CRITERION.md`), a row in the top summary table, and an entry in the "Pieces" table
referencing `packages/core/tests/bin/uat_authoring_ops.rs`'s three read-only subcommands.

## Info

### IN-01: `measure_authoring_run`'s proposal-derived counts can silently under-count for a run whose proposal count exceeds the bound

**File:** `packages/core/src/query/authoring.rs:369-389`

**Issue:** `accepted_task_proposals`, `accepted_criterion_proposals`, and (transitively,
via `accepted_criterion_ids`) `amended_before_accept` are all derived from `proposal_stmt`'s result,
which is bounded and ordered `created_at DESC, id DESC LIMIT ?2`. Under a bound smaller than the
run's true total proposal count, proposals *older* than the newest `resolved_limit` are excluded
from the window entirely, so any accepted/amended proposal among them is silently dropped from these
three counts. (`last_accepted_at`/`elapsed_minutes` are unaffected — they now use the separate,
genuinely unbounded aggregate this diff introduced, which is exactly why WR-05 was fixed for those
two fields specifically.)

In production this function is only ever called with `limit = 200`
(`uat_authoring_ops.rs`'s `measure-run` subcommand), so a single authoring run would need to
generate more than 200 accepted/amended task-or-criterion proposals to trigger under-counting —
unlikely in practice, but worth flagging because this function is the Product Kill Criterion's own
measurement instrument: a silently wrong `accepted_criterion_proposals`/`amended_before_accept`
count would directly skew `computeKillCriterionVerdict`'s amendment-rate calculation
(`uat-09-product-kill-criterion.mjs`) without any error or indication that truncation occurred (no
`truncated` flag is returned here, unlike `resolve_board_read`'s pattern). The existing tests cover
*reproducibility* under a small bound (`the_measurement_is_reproducible_under_a_bound_smaller_than_the_data`)
but not *accuracy* under one.

**Fix:** Either document this as an accepted limitation in `AuthoringRunMeasurement`'s own doc
comment (a one-line caveat: "counts are bounded by `limit`; a run with more than `limit` accepted
proposals under-reports"), or add a `truncated: bool` field mirroring `resolve_board_read`'s own
peek-past-the-limit idiom, computed from a `COUNT(*)` against the same `WHERE agent_run_id = ?1`
predicate, so a truncated measurement is at least visible on the rendered Kill Criterion sheet rather
than silent.

---

_Reviewed: 2026-09-24T06:02:50Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
