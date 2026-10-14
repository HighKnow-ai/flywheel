---
phase: 12-destructive-gate-trust-boundary-redesign
plan: 06
subsystem: security
tags: [destructive-gate, trust-boundary, pre-push-hook, relocate-project, git-hooks, gap-closure]

requires:
  - phase: 12-destructive-gate-trust-boundary-redesign
    provides: "12-02's install_pre_push_hook/PrePushInstall and register_project's post-commit install block — this plan extracts and reuses that logic rather than re-deriving it"
provides:
  - "packages/core/src/domain/project.rs: install_layer3_pre_push_gate, a shared private helper both register_project and relocate_project call after their own transaction commits, so a relocated or re-cloned project keeps the Layer 3 pre-push gate instead of silently losing it"
  - "packages/core/tests/destructive_gate_layer_coverage.rs: every_repo_path_mutation_routes_through_the_layer3_install, a source-level invariant that fails the moment a third function changes repo_path without installing Layer 3"
  - "docs/destructive-gate-trust-boundary.md: Layer 3 named as installed at both registration and relocation; the REFUSED-install Named Residuals row widened to cover both call sites"
affects: []

actuals:
  tokens: 7620
  tasks: 3
  commits: 3
plan_head_before: ed345fe39e5990d56e9f70eab2e1e4445f085a0d

tech-stack:
  added: []
  patterns:
    - "A single private helper renders every outcome of a side-effecting install for all of its call sites, so a source-level text-scan test (comment-stripped, split into per-function chunks on a start-of-line fn prefix) can assert no future call site skips it — promotes a convention into a compile-adjacent, test-enforced invariant rather than a code-review habit"

key-files:
  created: []
  modified:
    - packages/core/src/domain/project.rs
    - packages/core/tests/git_hooks_pre_push.rs
    - packages/core/tests/destructive_gate_layer_coverage.rs
    - docs/destructive-gate-trust-boundary.md

key-decisions:
  - "Promoted the noun from 'the registration path' (singular) to 'every path that can change repo_path' (plural), per the plan's own assumption_delta_decision: one shared helper plus a source-level invariant test is a strictly shorter diff than duplicating register_project's match block into relocate_project, and is the only shape that makes a future third mutation path a compile-or-test failure rather than a silent omission."
  - "The invariant test (every_repo_path_mutation_routes_through_the_layer3_install) scans source text rather than parsing it with a Rust parser — no new dependency, and the file's own documented convention (every top-level fn/pub fn starts at column 0) makes a line-prefix split sufficient. Comment lines are stripped first so a doc comment merely naming an identifier can never satisfy or invalidate the scan."
  - "docs/destructive-gate-trust-boundary.md's REFUSED-install residual row is widened in place, not duplicated — the plan's own prohibition against adding a new residual row for relocation (it is covered now, not an accepted gap) is honored by correcting the existing row's wording instead."

requirements-completed: [AGNT-07, BOARD-10]

coverage:
  - id: D1
    description: "relocate_project installs Layer 3 at the new repo_path, proven against a real git clone whose core.hooksPath is asserted unset beforehand"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#relocating_to_a_fresh_clone_installs_the_pre_push_gate_at_the_new_path"
        status: pass
    human_judgment: false
  - id: D2
    description: "Both install refusal conditions and the install error condition leave the relocation successful and the developer's own hook configuration untouched"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#a_refusal_never_fails_relocation"
        status: pass
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#an_install_error_never_fails_relocation"
        status: pass
    human_judgment: false
  - id: D3
    description: "A repeated relocation is idempotent down to the hook script's bytes and the hooks directory's entry count"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#relocating_twice_to_the_same_clone_is_idempotent"
        status: pass
    human_judgment: false
  - id: D4
    description: "One helper renders the install outcome for both mutation paths, and a test fails if a third mutation path appears without it"
    requirement: BOARD-10
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_gate_layer_coverage.rs#every_repo_path_mutation_routes_through_the_layer3_install"
        status: pass
    human_judgment: false
  - id: D5
    description: "docs/destructive-gate-trust-boundary.md names relocation as a Layer 3 install point and the REFUSED-install residual row is widened, not duplicated"
    requirement: BOARD-10
    verification:
      - kind: other
        ref: "grep -ic relocat docs/destructive-gate-trust-boundary.md (returns 6, was 0)"
        status: pass
      - kind: other
        ref: "grep -c 'a repository where the \\`pre-push\\` install is REFUSED' docs/destructive-gate-trust-boundary.md (returns 1)"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-10-01
status: complete
---

# Phase 12 Plan 06: relocate_project keeps the Layer 3 pre-push gate installed Summary

**A shared `install_layer3_pre_push_gate` helper makes `register_project` and `relocate_project` install the same Layer 3 git pre-push gate, closing the silent gap where a relocated or re-cloned project lost force-push/branch-deletion protection with no refusal, no log line, and no documented residual.**

## Performance

- **Duration:** 45 min
- **Tasks:** 3 completed
- **Files modified:** 4

## Accomplishments

- `relocate_project` now re-installs the Layer 3 pre-push gate at the new `repo_path` immediately after its transaction commits, mirroring `register_project`'s own post-commit block — proven against a real `git clone` whose `core.hooksPath` is asserted unset before relocation and carries the expected `hooks_dir_for_repo` value and `PRE_PUSH_MARKER` script afterward.
- Both install refusal conditions (a foreign `core.hooksPath`, a pre-existing non-sample executable `pre-push`) and the install error condition (a relocation target that isn't a git repository) leave the relocation `Ok` and the developer's own hook configuration byte-identical — never propagated as a relocation failure.
- Relocating twice to the same clone is idempotent: `core.hooksPath` reads back unchanged, the installed `pre-push` script's bytes are unchanged, and the project's hooks directory holds exactly one entry.
- `register_project` and `relocate_project` both route through one new private helper, `install_layer3_pre_push_gate`, eliminating the duplicated match block and the drift risk it carried.
- A source-level invariant test, `every_repo_path_mutation_routes_through_the_layer3_install`, scans `project.rs`'s source text (comments stripped) and fails the instant a third function calls `set_repo_path(` without also calling `install_layer3_pre_push_gate(` — so a future mutation path cannot silently repeat this gap.
- `docs/destructive-gate-trust-boundary.md` now names both registration and relocation as Layer 3 install points, and the Named Residuals row for a REFUSED install is widened to cover either call site instead of registration alone.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end — a relocated clone comes out with Layer 3 installed** - `3f00324` (feat)
2. **Task 2: The refusal, error and idempotency arms of relocation** - `ce817aa` (test)
3. **Task 3: The third-path invariant, and the document corrected to match the code** - `3c30e61` (test)

_Note: no TDD cycle — this is a `type: execute` gap-closure plan, not `type: tdd`._

## Files Created/Modified

- `packages/core/src/domain/project.rs` - New private `install_layer3_pre_push_gate` helper; `register_project`'s inline match block replaced by a call to it; `relocate_project` gains a post-commit call to it plus an extended doc comment explaining why relocation needs its own install
- `packages/core/tests/git_hooks_pre_push.rs` - Four new tests: the end-to-end relocation install proof, the two refusal/error tolerance tests, and the idempotency test
- `packages/core/tests/destructive_gate_layer_coverage.rs` - New `every_repo_path_mutation_routes_through_the_layer3_install` invariant test, plus a fifth bullet in the module doc describing it
- `docs/destructive-gate-trust-boundary.md` - Layer 3's "Trusted to prove" section amended to name both install points; the REFUSED-install Named Residuals row widened to cover relocation

## Decisions Made

- Promoted the scope from "the registration path" to "every path that can change `repo_path`" — one shared helper plus a source-level invariant test, rather than duplicating the match block into `relocate_project`. See `key-decisions` in the frontmatter for the full rationale.
- The invariant test scans source text rather than using a Rust parser, relying on the file's own documented column-0 convention for top-level functions — no new dependency, and comment lines are stripped first so a doc comment naming either identifier can never satisfy or invalidate the scan.
- The trust-boundary document's REFUSED-install residual row is corrected in place, not duplicated with a new row for relocation, per the plan's own prohibition.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 12 is now fully closed: all 6 plans (01-06) have SUMMARY.md, the single blocking gap from `12-VERIFICATION.md` (truth 11) and `12-REVIEW.md` (CR-01) is resolved, and `cargo test --workspace` passes with no `FAILED` lines. The three `verification: backstop` truths (23/24/25) and the "does CR-01 block shipping" product-risk decision from `12-VERIFICATION.md`'s `human_verification` section remain for a human to acknowledge — this plan does not re-run the credential-spending `uat-11` live arm or re-litigate those backstop truths, per its own explicit scope fence. No blockers for proceeding to `/gsd-verify-work 12` or the next phase.

---
*Phase: 12-destructive-gate-trust-boundary-redesign*
*Completed: 2026-10-01*

## Self-Check: PASSED

- All four `files_modified` paths confirmed present on disk.
- All three task commits (`3f00324`, `ce817aa`, `3c30e61`) confirmed in `git log`.
- Re-ran `cargo test -p core --test git_hooks_pre_push` (24 passed), `--test destructive_gate_layer_coverage` (5 passed), `--test destructive_gate_no_new_launcher_tokens` (2 passed), `--test project_reconciliation` (14 passed) — all pass, matching every task's `<verify>` block.
- Re-ran the plan-level `cargo test --workspace` — exit 0, no `FAILED` line (see Deviations: none).
