---
phase: 12-destructive-gate-trust-boundary-redesign
reviewed: 2026-10-01T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/core/src/domain/project.rs
  - packages/core/tests/destructive_gate_layer_coverage.rs
  - packages/core/tests/git_hooks_pre_push.rs
  - docs/destructive-gate-trust-boundary.md
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-10-01
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This is an incremental review of plan 12-06's gap-closure diff: `register_project` and
`relocate_project` were refactored to route through a new shared private helper,
`install_layer3_pre_push_gate`, and `relocate_project` now calls it after its own transaction
commits. This closes the previous review's CR-01 (`relocate_project` silently skipping the Layer 3
pre-push gate install).

**CR-01 closure verified.** I traced the full diff against `fe7d2f2` (the previous review's base),
confirmed the extraction is a faithful, behavior-preserving refactor of `register_project`'s
original inline match (same three outcome arms, same stderr messages, now parameterized by
`repo_path`/`project_id` instead of closed-over locals), confirmed `relocate_project` calls the
helper only after `tx.commit()` succeeds (never propagated as a relocation failure, matching the
pattern `register_project` already used), and confirmed both call sites are the only two
`set_repo_path(` call sites in the file. I compiled the crate (`cargo check --tests`, clean, no
warnings) and ran the new tests directly: `destructive_gate_layer_coverage`'s
`every_repo_path_mutation_routes_through_the_layer3_install` (the new source-level totality
invariant) and all four new `git_hooks_pre_push.rs` relocation tests
(`relocating_to_a_fresh_clone_installs_the_pre_push_gate_at_the_new_path`,
`a_refusal_never_fails_relocation`, `an_install_error_never_fails_relocation`,
`relocating_twice_to_the_same_clone_is_idempotent`) — all pass. The new tests exercise real `git`
subprocesses (clone, config readback) rather than mocking, and correctly cover the refusal, error,
and idempotency arms the plan's acceptance criteria called for.

No correctness or security defects found in the new code. Two warnings: one is a documentation
inconsistency this diff should have caught but did not (a stale "installed once" claim elsewhere
in the trust-boundary doc that now contradicts the just-updated "installed at two points" claim);
the other is a minor robustness gap in the new source-scanning test's own stripping logic relative
to the guarantee its doc comment claims.

## Warnings

### WR-01: Stale "installed once per registered project" claim left uncorrected elsewhere in the trust-boundary doc

**File:** `docs/destructive-gate-trust-boundary.md:941`
**Issue:** This diff correctly rewrote the Layer 3 section's own "Trusted to prove" paragraph
(line ~141) from "Installed once per registered project" to "Installed at two points —
registration (`register_project`) and explicit relocation (`relocate_project`)", and correctly
updated the refusal residual row (line 433) to say "whether the install is attempted at
registration or at explicit relocation." But the "## Round ten" postmortem section, which also
describes Layer 3 as part of its own narrative ("Branch two... is TAKEN for the remote-reaching
categories: Layer 3, above, is exactly that layer, **installed once per registered project** via
`core.hooksPath`..."), still carries the pre-12-06 claim verbatim and was not touched by this diff.
This is precisely the kind of claim-drift this document's own stated purpose (give round five — and
by extension round eleven — "a spec to fail against instead of a list to extend") exists to
prevent: a reader who reaches line 941 before line 141 now reads a claim the rest of the document
has already retracted.
**Fix:** Update line 941 to match the corrected claim, e.g.:
```markdown
   layer, installed at registration and re-installed at explicit relocation via `core.hooksPath`
   and reached through git's own hook configuration rather than a `PATH` search.
```

### WR-02: The new source-scanning test's comment-stripping only covers whole-line comments, weaker than its own doc comment claims

**File:** `packages/core/tests/destructive_gate_layer_coverage.rs:128-136`
**Issue:** The test's doc comment states: "comment lines are stripped first so a doc comment merely
naming an identifier can never satisfy or invalidate the scan below." The implementation only
strips lines whose *trimmed form* begins with `//` (`source.lines().filter(|line|
!line.trim_start().starts_with("//"))`). A trailing inline comment on a code line — e.g. `foo(); //
see install_layer3_pre_push_gate for why` — is not stripped, because the *line itself* does not
start with `//`; only a full-line comment is excluded. If a future mutation path called
`set_repo_path(` and merely *mentioned* `install_layer3_pre_push_gate(` in a trailing comment
without actually calling it, this invariant would pass vacuously — exactly the failure mode the
test's own doc comment claims is impossible. This doesn't affect today's two functions (neither
carries a trailing comment naming the helper), so it is not a live false-pass today, but the
guarantee as documented is stronger than the guarantee as implemented.
**Fix:** Either strip trailing `//` comments too (e.g., split each line on the first unquoted `//`
before filtering — careful with `//` inside string literals, which this codebase's own style mostly
avoids in this file), or narrow the doc comment to say "whole-line comments" rather than implying
all comments are excluded.

---

_Reviewed: 2026-10-01_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
