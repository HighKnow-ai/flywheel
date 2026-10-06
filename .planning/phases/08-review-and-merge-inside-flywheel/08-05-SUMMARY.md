---
phase: 08-review-and-merge-inside-flywheel
plan: 05
subsystem: forge
tags: [rust, forge, git, pull-request, epic, push]
status: complete

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "git::push_branch, merge::is_integrated, criterion_anchors table"
provides:
  - "forge::request_body::assemble_epic_request_draft (pure, clockless, byte-stable epic draft)"
  - "forge::epic_request_preconditions / EpicRequestBlocker (NoIntegrationBranch, NothingToPropose, NoForgeConfigured, NoRemote)"
  - "forge::open_epic_request_at / EpicRequestOutcome (Opened, AlreadyOpen, PushRejected, PushedButNotOpened)"
affects: [08-08]

requirements-completed: [REVW-05]

duration: "~40 min"
completed: 2026-10-06

actuals:
  tokens: 10700
  tasks: 2
  commits: 2
plan_head_before: 59145ee720cbdceedc6f39b2db438b606c319c82

coverage:
  - deliverable: "Epic request draft assembled from the board: integration branch as head, default branch as target, criteria with real checked state and anchors, task roll-up with integrated marker; byte-identical twice; NULL branch refused and none cut"
    verification:
      - kind: test
        ref: "packages/core/tests/epic_request_draft.rs (12 draft tests)"
        status: pass
    human_judgment: false
  - deliverable: "Four named local preconditions checked before the forge is asked"
    verification:
      - kind: test
        ref: "packages/core/tests/epic_request_draft.rs (precondition_* x5)"
        status: pass
    human_judgment: false
  - deliverable: "Lookup-then-push-then-create sequence from the project checkout, plain push only, rejected push and push-without-request reported as distinct outcomes, CLI error taxonomy passed through, no status written"
    verification:
      - kind: test
        ref: "packages/core/tests/forge_live_chain.rs (epic_request_* x10, real bare remote, fake gh)"
        status: pass
    human_judgment: false
  - deliverable: "Opening twice for the same integration branch reuses the existing request"
    verification:
      - kind: test
        ref: "packages/core/tests/forge_live_chain.rs#epic_request_asked_twice_surfaces_the_existing_request_instead_of_creating_a_second"
        status: pass
    human_judgment: true
    rationale: "Plan marked this backstop. Proven against the fake gh only; the real forge CLIs' own duplicate behaviour is not exercised."

key-files:
  created:
    - packages/core/tests/epic_request_draft.rs
  modified:
    - packages/core/src/forge/request_body.rs
    - packages/core/src/forge/mod.rs
    - packages/core/tests/forge_live_chain.rs

key-decisions:
  - "Only an Open or ChangesRequested request for the head counts as already open; a merged or closed one does not block a new request"
  - "open_epic_request_at refuses Forge::Local itself, before any push, in addition to the local-variant precondition"
  - "A create failure after a successful push returns PushedButNotOpened with a generic detail; raw CLI stderr is logged, never returned"
  - "A missing default branch ref is an error from the precondition check, not NothingToPropose"
---

# Phase 8 Plan 05: Epic request in the core Summary

An epic's integration branch can be proposed to the forge in one call: a deterministic draft from the board, a plain push from the main checkout, then request creation, with each state the forge could not answer refused by name first and a half-completed attempt reported as exactly that.

## Accomplishments

- **Epic draft (0a38d65).** `assemble_epic_request_draft` sits beside the task assembler. Head is the integration branch, target the default branch, neither with a remote prefix. The body carries key and title, description, current-revision criteria with real checked state and a path:range evidence clause when anchored, and a task roll-up (key, title, status, checked/total criteria, integrated or not). No clock read, no writes. A NULL integration branch is a named error and stays NULL.
- **Preconditions, push, partial outcome (19ce4a6).** `epic_request_preconditions` names four local blockers. `open_epic_request_at` looks up an existing open request first (so asking twice reuses it, and an absent or unauthenticated CLI fails before any push), then pushes with `push_branch` from the project checkout, then creates. Push failure is `PushRejected`; a push that landed without a request is `PushedButNotOpened`. No status column is written and no poll is registered.
- The `create_request_at` doc comment now records three callers instead of two. No test counts them.
- 17 tests in `epic_request_draft.rs` and 10 new in `forge_live_chain.rs` (19 total there), using a real bare remote and the existing fake-CLI harness extended with `create_fail` and `unauth` flags.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | 0a38d65 | Epic request draft |
| 2 | 19ce4a6 | Preconditions, push-then-create, partial outcome |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test PATH race in the absent-CLI test**
- **Found during:** full-suite run after Task 2
- **Issue:** the absent-CLI test set `PATH` to an empty directory while other tests in the same binary spawned git outside `ENV_LOCK`, so one failed with "No such file or directory".
- **Fix:** the test's `PATH` now holds a symlink to `git` and nothing else (still no `gh`). Three consecutive runs of the binary pass.
- **Files modified:** packages/core/tests/forge_live_chain.rs
- **Commit:** 19ce4a6

**2. [Plan-conformance] Criteria SQL moved inside the function**
- The plan's acceptance grep looks for `superseded_at IS NULL` inside `assemble_epic_request_draft`, so the criteria statement is a local const there rather than a module const.

**3. [Rule 2 - Missing critical] `open_epic_request_at` refuses `Forge::Local` itself**
- Without it, a local project would be pushed and only then fail at create, reported as PushedButNotOpened. A test asserts nothing reaches the remote.

**Total deviations:** 1 auto-fixed bug, 1 added guard, 1 placement choice. **Impact:** none on scope.

## Issues Encountered

- `cargo test --workspace` blocks on `packages/core/tests/credentials.rs` (macOS Keychain dialog in an unattended session), as recorded in 08-03. Verification ran `cargo test -p core --lib` plus every test binary except `credentials` (84 binaries, 0 failures after fix 1) and `cargo build --workspace`.
- TDD note: implementation and its tests were committed together per task rather than as separate RED/GREEN commits.

## Follow-up (not implemented, by plan)

- No epic-request observer exists, so an epic request that merges carries nothing to Done (D-122, D-145). Same backlog item as 08-03.
- The compare-page fallback for a missing CLI is not built (research assumption A5 unverified).
- Plan 08-08 must allow-list the scheme of any forge-supplied URL before rendering it (T-08-05-07).

## Known Stubs

None.

## Threat Flags

None beyond the plan's `<threat_model>`. Mitigations verified by tests and greps: no `--force`/`--delete` in the request path, exactly one `push_branch` call placed after the lookup, zero `UPDATE tasks|epics SET` in forge/mod.rs, stderr not returned in the partial outcome.

## Next Phase Readiness

Plan 08-08 can call `assemble_epic_request_draft` and `epic_request_preconditions` under the DB lock, drop it, then call `open_epic_request_at`.

## Self-Check: PASSED

epic_request_draft.rs exists; commits 0a38d65 and 19ce4a6 found; plan grep gates hold (no clock, no `origin/`, no `ensure_epic_integration_branch` in request_body.rs; one `push_branch` after `request_for_branch_at`; zero force/delete flags; zero status writes).
