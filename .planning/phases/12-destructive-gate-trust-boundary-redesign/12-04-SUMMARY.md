---
phase: 12-destructive-gate-trust-boundary-redesign
plan: 04
subsystem: security
tags: [destructive-gate, trust-boundary, git-hooks, rust, pre-push, human-in-the-loop, permission-socket]

requires:
  - phase: 12-destructive-gate-trust-boundary-redesign
    provides: "12-01's string-literal baseline pin (the gate this plan deliberately trips and regenerates) and 12-02's Layer 3 git-native pre-push gate (the refuse-outright branch this plan extends into ask-then-decide)"
provides:
  - "packages/shim/src/main.rs: a --gate-push <category-name> <token>... entry point, checked before the argv[0]-stem dispatch, reusing request_permission/print_denied unchanged -- no second socket/request/JSON implementation"
  - "packages/core/src/git_hooks.rs: pre_push_hook_script's branch-deletion and force-push cases now ask on the session's existing permission socket when one is available, falling back to the D-60 refuse-outright branch only when there is nothing to ask"
  - "packages/core/tests/git_hooks_pre_push.rs: five arms (allow, deny, no-socket, benign, stale-bake) measured against a real push and a real mock permission socket"
affects: [12-05]

actuals:
  tokens: 5463
  tasks: 2
  commits: 2
plan_head_before: 05da64ff1e95dec497b1e2ebbf365cd7a2c6dc5d

tech-stack:
  added: []
  patterns:
    - "A shell hook script's destructive-verdict branch delegates to the gating binary's own --gate-push mode (a thin CLI wrapper over an existing permission round trip) rather than reimplementing the ask -- one socket protocol, one answering surface, reused from both the PreToolUse interception path and the git-native pre-push path"

key-files:
  created: []
  modified:
    - packages/shim/src/main.rs
    - packages/core/src/git_hooks.rs
    - packages/core/tests/git_hooks_pre_push.rs
    - packages/core/tests/fixtures/shim-main-string-literals.baseline.txt

key-decisions:
  - "run_gate_push reuses the existing request_permission/print_denied functions unchanged rather than building a second request-construction/socket path -- D-55/D-58's fresh-connection, no-deadline contract already lives there."
  - "The ask branch continues to the next stdin line on an allow (rather than exiting), so a multi-ref push asks a separate question per destructive ref instead of stopping after the first allow."
  - "The nothing-to-ask D-60 fail-closed refusal from plan 12-02 is kept as the literal fallback inside the same case arm (not a separate code path), so a missing socket variable or non-executable baked shim binary degrades to the pre-12-04 behaviour exactly."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "A destructive push from a Flywheel-managed worktree raises a real permission request on the session's existing socket, naming the correct destructive category, and an allow answer lets the push actually complete (the remote ref genuinely changes)"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#branch_deletion_push_with_an_allow_answer_completes_and_the_request_names_it_truthfully"
        status: pass
    human_judgment: false
  - id: D2
    description: "A deny answer refuses the push and the remote ref is unchanged, with the shim's declined text on stderr"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#branch_deletion_push_with_a_deny_answer_is_refused_and_the_remote_ref_survives"
        status: pass
    human_judgment: false
  - id: D3
    description: "With no permission socket configured the push is still refused, never allowed -- the fail-closed path from plan 12-02 is preserved exactly"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#branch_deletion_push_with_no_socket_is_still_refused"
        status: pass
    human_judgment: false
  - id: D4
    description: "An ordinary fast-forward push raises NO permission request at all -- the socket is never even connected to"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#an_ordinary_push_raises_no_permission_request_at_all"
        status: pass
    human_judgment: false
  - id: D5
    description: "A stale baked shim binary path still renders the fallback refusal branch, so a stale bake degrades to a refusal rather than a silently skipped ask"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/core/tests/git_hooks_pre_push.rs#a_stale_baked_shim_path_still_renders_the_fallback_refusal_branch"
        status: pass
    human_judgment: false
  - id: D6
    description: "packages/shim/src/main.rs gains the new entry point and nothing else -- the string-literal baseline diff contains only the new entry point's own literals, additions only, none deleted"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_gate_no_new_launcher_tokens.rs#shim_main_string_literals_match_baseline"
        status: pass
      - kind: other
        ref: "git diff --numstat -- packages/core/tests/fixtures/shim-main-string-literals.baseline.txt (4 added, 0 deleted)"
        status: pass
    human_judgment: false

duration: ~31min
completed: 2026-10-01
status: complete
---

# Phase 12 Plan 4: Git-Native Push Gate Becomes a Real Question Summary

**A `--gate-push` entry point on the shim binary, invoked by the generated pre-push hook's new ask branch, turns plan 12-02's refuse-outright Layer 3 gate into a real permission request on the session's existing socket -- reusing `request_permission`/`print_denied` unchanged.**

## Performance

- **Duration:** ~31 min
- **Started:** ~2026-10-01T09:17:00Z
- **Completed:** 2026-10-01T09:47:43Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- `packages/shim/src/main.rs`: `run_gate_push` and its `--gate-push <category-name> <token>...` dispatch check, positioned before the `argv[0]`-stem `match` alongside the two existing `--classify-*` modes (the hook invokes the shim under its own filename, so the stem match would otherwise refuse to run it). An unrecognised category name, a missing category name, and zero tokens after the category each refuse with a named stderr line and a non-zero exit. The mode contains no socket connection, request construction, or JSON serialization of its own -- it calls the pre-existing `request_permission`/`print_denied` and never resolves `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM`, never execs anything.
- `packages/core/src/git_hooks.rs`'s `pre_push_hook_script`: both the branch-deletion and force-push cases gained an ask branch ahead of the existing D-60 fail-closed fallback -- when `FLYWHEEL_PERMISSION_SOCKET` is non-empty and the baked shim binary is executable, the script invokes it with `--gate-push <category> push <remote> <remote-ref> --delete|--force`, `continue`s to the next stdin line on allow (so a later destructive ref in the same push still gets its own question) and `exit 1`s on deny. The nothing-to-ask fallback from plan 12-02 is unchanged and still the literal next statement when there is no supervisor available.
- Regenerated `packages/core/tests/fixtures/shim-main-string-literals.baseline.txt` by re-running plan 12-01's extraction logic (a standalone script carrying the same extraction functions) against the modified `main.rs`: `git diff --numstat` showed 4 added, 0 deleted, and every added line is exactly the new flag literal (`--gate-push`) and its three refusal messages -- nothing resembling a program, launcher, or wrapper token. `resolve_segment_program_index`, `text_can_shadow_path_resolution`, `text_names_gated_program`, and `raw_text_names_path_defeating_wrapper` are confirmed byte-identical to their pre-plan state via `git diff`.
- `packages/core/tests/git_hooks_pre_push.rs`: five new arms measured against a real push and a real mock permission socket (allow, deny, no-socket, an ordinary/benign push proving the socket is never connected to, and a stale-bake unit arm), mirroring `destructive_classifier.rs`'s own `scratch_socket_path`/`spawn_mock_permission_server` helpers (copied, not shared, per this test file's self-contained precedent).

## Task Commits

Each task was committed atomically:

1. **Task 1: A --gate-push entry point on the shim, and the hook script delegating to it** - `4d1c435` (feat)
2. **Task 2: All four outcomes, measured against a real push and a real socket** - `35bde62` (test)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/shim/src/main.rs` - `run_gate_push` and the `--gate-push` pre-dispatch check
- `packages/core/src/git_hooks.rs` - `pre_push_hook_script`'s ask branch for branch-deletion and force-push, D-60 fallback retained
- `packages/core/tests/git_hooks_pre_push.rs` - five socket arms (allow/deny/no-socket/benign/stale-bake) plus two new self-contained socket-mock helpers
- `packages/core/tests/fixtures/shim-main-string-literals.baseline.txt` - regenerated, 4 lines added (the new flag + its three refusal messages), 0 deleted

## Decisions Made
- `run_gate_push` reuses the existing `request_permission`/`print_denied` functions unchanged rather than building a second request-construction/socket path -- D-55/D-58's fresh-connection, no-deadline contract already lives there, and duplicating it would be exactly the kind of parallel implementation the plan's own objective warns against.
- The ask branch `continue`s to the next stdin line on an allow (rather than exiting the hook), so a multi-ref push raises a separate question per destructive ref rather than stopping after the first allow -- asserted structurally as an acceptance criterion on the rendered script (T-12-18).
- The nothing-to-ask D-60 fail-closed refusal from plan 12-02 is kept as the literal next statement inside the same `case` arm, not split into a separate function or branch -- a missing socket variable or a non-executable baked shim binary degrades to exactly the pre-12-04 behaviour, with no new failure mode introduced.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' `<action>`, `<verify>`, and `<acceptance_criteria>` were followed as specified; no Rule 1-4 deviation was needed.

## Issues Encountered

None. One tooling note, not a deviation: the baseline-regeneration script from plan 12-01 (a temporary dev-only `#[test]` guarded by an env var) was not reusable verbatim since it was removed before that plan's own commit (by design, per its own SUMMARY). This plan regenerated the baseline via a standalone `rustc`-compiled script carrying the same extraction functions (byte-for-byte copied from `destructive_gate_no_new_launcher_tokens.rs`'s own `string_literals_in`/`strip_trailing_comment`/`string_literals_on_line`), run against the real `main.rs`, with the diff inspected line by line before committing -- the same anti-vacuity discipline plan 12-01 established, reproduced rather than re-derived from scratch.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Layer 3's branch-deletion and force-push gates are now real questions, not refusals: a Flywheel session with a supervisor available gets an allow/deny decision through the same permission socket the `PreToolUse` hook and the PATH shim already use, and the remote ref genuinely changes or survives depending on the answer.
- The nothing-to-ask and stale-bake fallbacks are both proven to degrade to a refusal, never to a silently skipped ask -- D-60's fail-closed discipline holds under both named failure modes.
- The string-literal baseline from plan 12-01 remains a live, deliberately-tripped-and-regenerated gate: this plan's own diff is the first legitimate widening since the baseline was created, and it is additions-only, fully attributable, and recorded in the commit message per the plan's own requirement.
- `cargo build --workspace` succeeds; `cargo test --workspace` (via the documented Keychain-test-skipping gate script) passes clean, 80 test binaries, 0 failures; `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm --prefix packages/sidecar test` passes clean, 217 passed, 0 failed, 6 skipped (pre-existing live-`claude` skips, unrelated to this plan).
- Plan 12-05 can proceed against a settled Layer 3 that now asks rather than refuses for both remote-reaching categories it covers (branch-deletion, force-push); `default-branch-push` and the non-push categories remain Layer 2's alone, unchanged by this plan.

---
*Phase: 12-destructive-gate-trust-boundary-redesign*
*Completed: 2026-10-01*

## Self-Check: PASSED

All modified files confirmed present on disk: `packages/shim/src/main.rs`,
`packages/core/src/git_hooks.rs`, `packages/core/tests/git_hooks_pre_push.rs`,
`packages/core/tests/fixtures/shim-main-string-literals.baseline.txt`. Both task commits
confirmed in `git log`: `4d1c435`, `35bde62`.
