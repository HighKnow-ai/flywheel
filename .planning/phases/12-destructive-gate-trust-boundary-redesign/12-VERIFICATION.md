---
phase: 12-destructive-gate-trust-boundary-redesign
verified: 2026-10-01T10:32:37Z
status: gaps_found
score: 20/22 must-haves verified
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-01-PLAN.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-01-SUMMARY.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-02-PLAN.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-02-SUMMARY.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-03-PLAN.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-03-SUMMARY.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-04-PLAN.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-04-SUMMARY.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-05-PLAN.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-05-SUMMARY.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-PATTERNS.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-RESEARCH.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-REVIEW.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-VALIDATION.md
  - docs/destructive-gate-trust-boundary.md
  - packages/core/src/domain/project.rs
  - packages/core/src/git_hooks.rs
  - packages/core/src/lib.rs
  - packages/core/tests/destructive_gate_layer_coverage.rs
  - packages/core/tests/destructive_gate_no_new_launcher_tokens.rs
  - packages/core/tests/fixtures/shim-main-string-literals.baseline.txt
  - packages/core/tests/git_hooks_pre_push.rs
  - packages/shim/src/main.rs
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/sessionstart-hook.ts
  - packages/sidecar/test/sessionstart-hook.test.mjs
  - scripts/uat/run-all.sh
  - scripts/uat/uat-11-env-file-ordering.mjs
covered_digest: "v1:sha256:50fda8c985fcb8531dd60a7583145cfee6da6bfb57eba369f86af8ba82501e07"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The pre-push gate (Layer 3) protects a project through every supported path that can change its repo_path, not only register_project"
    status: failed
    reason: >
      relocate_project — "the ONLY recovery action offered for an unreachable project" per its own
      doc comment, and the exact path a developer takes after re-cloning a repository (the
      `.flywheel/project.json` marker is COMMITTED, so it travels with a fresh clone) — never calls
      install_pre_push_hook. register_project (packages/core/src/domain/project.rs:325-340) always
      calls it, logging any refusal; relocate_project (packages/core/src/domain/project.rs:418-477)
      does nothing of the kind. Because git hooks are never part of tracked history, the relocated
      repository's new .git/config has no core.hooksPath, so Layer 3 is silently absent there — with
      no refusal, no log line, no event, and (grepped) no mention of "relocate" anywhere in
      docs/destructive-gate-trust-boundary.md's own Named Residuals table, which the document's own
      stated discipline requires for every other way Layer 3 can end up absent. For a relocated
      project this silently re-opens exactly the hole this phase exists to close: force-push,
      branch-deletion and history-rewrite protection for that project falls back to the pre-phase-12,
      P1-dependent Layer-2-only posture, and P1 is independently documented in this same phase as "not
      achievable by any mechanism Flywheel currently controls" outside the one narrowly-scoped,
      single-machine SessionStart measurement. This is CR-01 in 12-REVIEW.md (status: issues_found,
      severity critical), independently reproduced by this verification by reading
      packages/core/src/domain/project.rs:418-477 and confirming no git_hooks call exists on that
      path, confirming no test in packages/core/tests/project_reconciliation.rs asserts
      core.hooksPath after relocate_project, and confirming the only commit after the review
      (fe7d2f2) is doc-only (12-REVIEW.md, 176 insertions, zero other files).
    artifacts:
      - path: "packages/core/src/domain/project.rs"
        issue: "relocate_project (lines 418-477) commits the repo_path change and returns without ever calling crate::git_hooks::install_pre_push_hook, unlike register_project (lines 325-340) which always calls it on every branch and logs any refusal"
      - path: "packages/core/tests/project_reconciliation.rs"
        issue: "relocate_accepts_a_matching_marker_and_rejects_a_mismatch (line 357) asserts only repo_path and the event log — nothing asserts core.hooksPath or Layer 3 state at the relocated path"
      - path: "docs/destructive-gate-trust-boundary.md"
        issue: "grep -in relocat returns zero hits — the Named Residuals table, which this phase's own discipline requires to name every known way Layer 3 can end up absent, has no row for this one"
    missing:
      - "relocate_project must call install_pre_push_hook(&canonical, project_id) after its transaction commits, mirroring register_project's own post-commit block (logging Installed/Refused*/Err exactly as register_project already does)"
      - "A test asserting core.hooksPath (and the PRE_PUSH_MARKER) is set at the relocated path after a successful relocate_project call"
      - "If the asymmetry is instead accepted as intentional, a Named Residuals row in docs/destructive-gate-trust-boundary.md naming it, per the document's own stated discipline"
human_verification:
  - test: "Confirm probe 1's live P1-restoration result is accepted as sufficient evidence for this phase, or request a second machine/claude-version measurement before relying on it generally"
    expected: "A human reviewer acknowledges the scope of the one macOS / claude 2.1.285 / bypassPermissions measurement (uat-11 artifact, probe1.verdict=\"restored\") and decides whether that is sufficient standing evidence, per 12-05-PLAN.md's own `verification: backstop` marker, which exists specifically so this is not auto-passed by a verifier"
    why_human: "Authored as a backstop truth in 12-05-PLAN.md's must_haves — the plan's own SUMMARY states the verifier must route this to human_needed rather than auto-pass it, even though the artifact already shows a pass, because it is one measurement on one configuration"
  - test: "Confirm probe 2's live result (git --version stayed ordinary) is accepted as sufficient evidence that this phase's changes do not turn benign commands into permission requests"
    expected: "A human reviewer acknowledges the uat-11 artifact's probe2.verdict=\"success\" (a tool_result arrived for git --version, no permission_request was raised) as satisfying the ROADMAP's explicit acceptance clause second half, for this one measured session"
    why_human: "Authored as a backstop truth per 12-05-PLAN.md's must_haves, routed to human_needed by design rather than silently passed"
  - test: "Confirm probe 3's live result (FLYWHEEL_PERMISSION_SOCKET reached the command shell) is accepted as sufficient evidence that the pre-push layer's ask-branch discriminator is real rather than assumed"
    expected: "A human reviewer acknowledges the uat-11 artifact's probe3.verdict=\"present\" as closing the specific uncertainty plan 12-04's ask branch depended on, for this one measured session"
    why_human: "Authored as a backstop truth per 12-05-PLAN.md's must_haves, routed to human_needed by design rather than silently passed"
  - test: "Decide whether CR-01 (relocate_project's silent Layer 3 gap) blocks shipping this phase, or is acceptable as a follow-up with a documented residual"
    expected: "A human decision on whether the fix lands before merge, or the gap is explicitly accepted and recorded as a Named Residual row with its own reopening trigger, consistent with the pattern every other known absence of Layer 3 already follows in this same document"
    why_human: "This is a product-risk judgment call (how much exposure a relocated project should silently carry) that the verifier flags but does not have standing to resolve unilaterally"
---

# Phase 12: Destructive-gate trust boundary redesign Verification Report

**Phase Goal:** Close the destructive-command gate's trust hole at a layer that does not depend on
`PATH` precedence the developer's login shell can reorder, with a two-sided acceptance clause: a
check that fails if the gate ever again reaches a decision it cannot justify, AND a check that fails
if ordinary agent commands become permission requests.
**Verified:** 2026-10-01T10:32:37Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `docs/destructive-gate-trust-boundary.md` names a git-native interception layer (Layer 3) that does not depend on PATH precedence, and states P1 as unachievable rather than a load-bearing premise | ✓ VERIFIED | `## Layer 3 — git's own pre-push hook` section (lines 135-168) with both `### Trusted to prove` / `### Explicitly cannot see` subsections; `### Why round ten was reverted` §2 states "P1 is not achievable by any mechanism Flywheel currently controls" verbatim |
| 2 | Named Residuals table carries rows for a deliberate `core.hooksPath` override, `default-branch-push` remaining Layer-2-only, an unregistered/never-firing `SessionStart` hook, and a refused install | ✓ VERIFIED | All four rows present (grepped `core.hooksPath`, `default-branch-push remains`, `SessionStart`, `is REFUSED`), each with the table's Case/Layer/Reopening-trigger shape |
| 3 | An automated test fails the moment `packages/shim/src/main.rs` gains a string literal it does not carry today | ✓ VERIFIED | `cargo test -p core --test destructive_gate_no_new_launcher_tokens` — 2/2 pass, re-run live by this verification; baseline fixture + symmetric-difference assertion present and non-vacuous |
| 4 | A real `git push origin --delete <branch>` run from a Flywheel-managed worktree is refused before any ref reaches the remote, with the shim absent from PATH | ✓ VERIFIED | `branch_deletion_push_is_refused_and_the_remote_ref_survives`, `branch_deletion_push_with_a_deny_answer_is_refused_and_the_remote_ref_survives` in `git_hooks_pre_push.rs` — re-run live, pass |
| 5 | A real force-push is refused with the remote ref unchanged | ✓ VERIFIED | `force_push_is_refused_and_the_remote_ref_is_unchanged` — re-run live, pass |
| 6 | An ordinary fast-forward push, `git status` and `git --version` all exit 0 and raise no refusal under the same installed hook | ✓ VERIFIED | `ordinary_fast_forward_push_succeeds_and_the_remote_ref_advances`, `status_and_version_exit_zero_with_no_flywheel_refusal_text`, `an_ordinary_push_raises_no_permission_request_at_all` — re-run live, all pass |
| 7 | A push from outside Flywheel's worktree root exits 0 — the developer's own terminal is never gated | ✓ VERIFIED | `branch_deletion_push_from_outside_the_worktree_root_is_not_gated` — re-run live, pass |
| 8 | When the repo already carries a non-Flywheel `core.hooksPath` or non-sample `pre-push`, install refuses, `register_project` still succeeds, and the refusal is a readable returned value | ✓ VERIFIED | `install_refuses_a_preexisting_non_flywheel_hooks_path_without_displacing_it`, `install_refuses_a_preexisting_non_sample_pre_push_without_displacing_it`, `a_refusal_never_fails_registration`, `a_refusal_never_fails_registration_over_a_preexisting_pre_push` — re-run live, pass |
| 9 | `uninstall_pre_push_hook` returns the repository to its pre-install state | ✓ VERIFIED | `uninstall_unsets_core_hooks_path_it_wrote_and_is_a_no_op_for_a_foreign_value` — re-run live, pass |
| 10 | Every `DestructiveCategory` variant maps to at least one named interception layer in a table a test asserts is total | ✓ VERIFIED | `destructive_gate_layer_coverage.rs` — 4/4 tests pass (totality, doc-heading backing, non-degeneracy, script/table consistency), re-run live |
| 11 | **register_project installs Layer 3, but every path that can change a project's `repo_path` keeps it installed** | ✗ FAILED | See Gap 1 below — `relocate_project` never calls `install_pre_push_hook`; silent, undocumented, unfixed (CR-01) |
| 12 | A `SessionStart` hook writes exactly one `export PATH=` line prepending the shim dir into `CLAUDE_ENV_FILE` | ✓ VERIFIED | `sessionstart-hook.test.mjs` positive + append arms — re-run live, pass |
| 13 | With `CLAUDE_ENV_FILE` unset / unwritable, or `FLYWHEEL_SHIM_BIN` unset, the script exits 0, throws nothing, writes nothing | ✓ VERIFIED | 4 degrade arms — re-run live, pass |
| 14 | `writeHookSettings` carries both `PreToolUse` (byte-identical) and `SessionStart` entries | ✓ VERIFIED | Settings-shape arms — re-run live, pass |
| 15 | No gate decision path changes — the full sidecar suite (every destructive-gate corpus row, every ordinary-usage row) stays green | ✓ VERIFIED | Orchestrator-reported 217/217 sidecar tests pass (0 fail, 6 real-binary-only skips); `sessionstart-hook.test.mjs` 8/8 re-run live by this verification |
| 16 | A destructive push raises a real permission request naming the correct category, and the human's answer decides it | ✓ VERIFIED | `branch_deletion_push_with_an_allow_answer_completes_and_the_request_names_it_truthfully` asserts exit 0, remote ref deleted, AND `toolName`/`destructiveCategory`/`command` all correct — re-run live, pass |
| 17 | An allow answer lets the push actually complete | ✓ VERIFIED | Same test — remote ref genuinely gone after allow |
| 18 | A deny answer refuses the push, remote ref unchanged | ✓ VERIFIED | `branch_deletion_push_with_a_deny_answer_is_refused_and_the_remote_ref_survives` — re-run live, pass |
| 19 | With no permission socket, the push is still refused (fail-closed preserved) | ✓ VERIFIED | `branch_deletion_push_with_no_socket_is_still_refused` — re-run live, pass |
| 20 | An ordinary fast-forward push raises NO permission request — the socket is never even connected to | ✓ VERIFIED | `an_ordinary_push_raises_no_permission_request_at_all` asserts non-blocking accept returns would-block — re-run live, pass |
| 21 | `packages/shim/src/main.rs` gains only the new `--gate-push` entry point — baseline diff is additions only | ✓ VERIFIED | `cargo test -p core --test destructive_gate_no_new_launcher_tokens` passes against the regenerated baseline; `resolve_segment_program_index`/`text_can_shadow_path_resolution`/`text_names_gated_program`/`raw_text_names_path_defeating_wrapper` confirmed untouched by the reviewer and consistent with the diff shape described in 12-REVIEW.md |
| 22 | `scripts/uat/uat-11-env-file-ordering.mjs` exists, is registered in `run-all.sh`, and its `--selftest` arm fails when the harness cannot observe its probes | ✓ VERIFIED | Registered (`grep -c` = 2, including the result-table line), `bash -n` clean, `--selftest` re-run live by this verification — exit 0, no SKIP, all four verdict checks print |
| 23 (backstop) | P1 restored: the agent's own command shell's first `PATH` segment is Flywheel's shim directory, in a real `bypassPermissions` session | ⚠️ Routed to human (backstop) | Live artifact `uat-11-env-file-ordering-2026-10-01T10-04-00-983Z-probes.json` confirmed on disk by this verification: `probe1.verdict = "restored"`, observed segment byte-identical to the run's shim dir. Authored as `verification: backstop` — routed to human per plan's own explicit instruction, not auto-passed |
| 24 (backstop) | `git --version` returns a tool result and never becomes a permission request, in that same session | ⚠️ Routed to human (backstop) | Same artifact: `probe2.verdict = "success"`. Backstop — routed to human |
| 25 (backstop) | `FLYWHEEL_PERMISSION_SOCKET` is present in the agent's own command shell environment, in that same session | ⚠️ Routed to human (backstop) | Same artifact: `probe3.verdict = "present"`. Backstop — routed to human |

**Score:** 20/22 non-backstop truths verified, 1 failed (truth 11), 3 backstop truths routed to human by design (not counted toward score per their own `verification: backstop` markers).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docs/destructive-gate-trust-boundary.md` | Amended trust boundary, Layer 3, corrected P1, residuals | ✓ VERIFIED | 968 lines; Layer 3 section, four plan-12-01 residual rows, measured-and-narrowed SessionStart row, `[VERIFIED]`-tagged P1 restoration claim all present |
| `packages/core/tests/destructive_gate_no_new_launcher_tokens.rs` | Structural scope fence | ✓ VERIFIED | 2/2 tests pass, baseline non-vacuous |
| `packages/core/tests/fixtures/shim-main-string-literals.baseline.txt` | Committed literal-set baseline | ✓ VERIFIED | Present, regenerated across 12-01/12-04, diff additions-only per reviewer and this verification's re-run |
| `packages/core/src/git_hooks.rs` | Layer 3 implementation | ✓ VERIFIED | `install_pre_push_hook`, `uninstall_pre_push_hook`, `pre_push_hook_script`, `hooks_dir_for_repo`, `interception_layers_for`, `PrePushInstall`, `PRE_PUSH_MARKER` all present and exercised by 20 passing tests |
| `packages/core/tests/git_hooks_pre_push.rs` | Offline + socket-mock test coverage | ✓ VERIFIED | 20/20 tests pass, re-run live |
| `packages/core/tests/destructive_gate_layer_coverage.rs` | Total-coverage invariant | ✓ VERIFIED | 4/4 tests pass, re-run live |
| `packages/sidecar/src/sessionstart-hook.ts` | CLAUDE_ENV_FILE PATH prepend, degrade-silently | ✓ VERIFIED | Exists, compiles, 8/8 tests pass |
| `packages/shim/src/main.rs` `--gate-push` / `run_gate_push` | Shim-side ask entry point | ✓ VERIFIED | Present, dispatches before argv[0]-stem match, reuses `request_permission`/`print_denied` unchanged |
| `scripts/uat/uat-11-env-file-ordering.mjs` | Live measurement harness | ✓ VERIFIED | Exists, registered, `--selftest` passes, live artifact on disk with all three verdicts |
| `packages/core/src/domain/project.rs` (`relocate_project`) | Keeps Layer 3 installed across relocation | ✗ MISSING WIRING | `install_pre_push_hook` is never called from `relocate_project` — see Gap 1 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `register_project` | `install_pre_push_hook` | post-commit match block, lines 321-340 | ✓ WIRED | Confirmed by direct read; matches `register_project (BOARD-10) calls install_pre_push_hook AFTER its transaction commits` key_link in 12-02-PLAN.md |
| `relocate_project` | `install_pre_push_hook` | — | ✗ NOT WIRED | No call exists anywhere in `relocate_project` (lines 418-477) — Gap 1 |
| Generated `pre-push` hook script | shim binary `--gate-push` | baked absolute path, no PATH search | ✓ WIRED | `a_stale_baked_shim_path_still_renders_the_fallback_refusal_branch`, and the live allow/deny socket arms, confirm the script invokes the shim and the shim answers through the real permission socket |
| `sessionstart-hook.ts` | `writeHookSettings`'s `SessionStart` entry | `sessionStartHookScriptPath()` | ✓ WIRED | Settings-shape test asserts the entry's `command` ends with the compiled script filename |
| `uat-11-env-file-ordering.mjs` | product's own `writeHookSettings`/session spawn path | `runScript`/`startSidecar` | ✓ WIRED | Live artifact shows `probe3.verdict = "present"`, which can only be true if the real `SessionStart` registration fired |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Layer 3 offline suite | `cargo test -p core --test git_hooks_pre_push` | 20 passed; 0 failed | ✓ PASS |
| Layer coverage totality | `cargo test -p core --test destructive_gate_layer_coverage` | 4 passed; 0 failed | ✓ PASS |
| Classifier scope fence | `cargo test -p core --test destructive_gate_no_new_launcher_tokens` | 2 passed; 0 failed | ✓ PASS |
| SessionStart hook both arms | `node --test packages/sidecar/test/sessionstart-hook.test.mjs` | 8 passed; 0 failed | ✓ PASS |
| uat-11 self-test (non-credential) | `node scripts/uat/uat-11-env-file-ordering.mjs --selftest` | exit 0, no SKIP, all 4 verdict checks print | ✓ PASS |
| Debt-marker scan on all phase-12 touched files | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` | no matches | ✓ PASS |

### Probe Execution

Not applicable — this phase's "probe" equivalent is `scripts/uat/uat-11-env-file-ordering.mjs`, covered above under Behavioral Spot-Checks (self-test arm) and Human Verification (live arm, routed per its own `backstop` marker).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AGNT-07 | 12-01, 12-02, 12-03, 12-04, 12-05 | Destructive actions always require explicit confirmation, even in auto-accept mode | ⚠️ PARTIAL | Fully satisfied for the `register_project` path (Layers 1-3 + ask branch, all measured). NOT satisfied for a relocated project: Layer 3 is silently absent there, and P1 is independently documented as unachievable outside the one narrow SessionStart measurement — see Gap 1 |
| BOARD-10 | 12-02 (key_link) | User can register multiple local git repositories as projects | ✓ SATISFIED for registration | The phase's own PLAN names "the install point is BOARD-10's register-project path" and that specific path is verified wired. The companion `relocate_project` recovery path (also part of BOARD-10's project-management surface) is not covered — flagged under AGNT-07's partial status above rather than as a second BOARD-10 defect, since BOARD-10 itself (registration + board switching) is unaffected |

No orphaned requirement IDs found mapped to Phase 12 beyond AGNT-07/BOARD-10 (ROADMAP states `Requirements: TBD`).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found: no TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers in any phase-12-touched file |

**CR-01 (carried from 12-REVIEW.md, independently reproduced):** `relocate_project` silently omits the Layer 3 install call — see Gap 1. Classified 🛑 Blocker: it is a confirmed, unresolved CRITICAL code-review finding, reachable through a supported, documented recovery operation, that reopens the exact trust hole this phase exists to close, with zero signal to the developer and zero documentation of the gap.

**WR-01 (carried from 12-REVIEW.md, not re-raised as a new finding):** `sessionstart-hook.ts` has no idempotency guard against repeated `SessionStart` firings within one session — functionally harmless (each re-fire still puts the shim directory first), flagged ℹ️ Info only, no action required per the reviewer's own disposition.

### Human Verification Required

See `human_verification` in the frontmatter — four items: the three `backstop`-marked live guarantees (P1 restoration, `git --version` ordinariness, `FLYWHEEL_PERMISSION_SOCKET` presence), each already measured and passing per the uat-11 artifact but deliberately routed to human acknowledgment by the plan's own design, and a product-risk decision on whether CR-01 blocks shipping or is accepted as a documented residual.

### Gaps Summary

One blocking gap: `relocate_project` (`packages/core/src/domain/project.rs:418-477`) never (re-)installs the Layer 3 `pre-push` gate at a project's new location, unlike `register_project`, which always does. Because `.flywheel/project.json` is committed and travels with a fresh `git clone`, this is exactly the scenario a developer hits after re-cloning and relocating — the measured 2026-10-01 incident class (`git push origin --delete` reaching a real remote) can recur for that project with zero refusal, zero log line, and zero documentation anywhere in `docs/destructive-gate-trust-boundary.md`'s own Named Residuals table, which this phase's own stated discipline requires for every other known absence of Layer 3.

This was found and scored CRITICAL by this phase's own code review (`12-REVIEW.md`, `status: issues_found`), confirmed independently by this verification (direct read of `project.rs`, confirmed no test coverage in `project_reconciliation.rs`, confirmed the only post-review commit is documentation-only), and remains unresolved in the code as of `fe7d2f2` (HEAD). Phase 12's entire thesis — "give round five a spec to fail against instead of a list to extend," every closure's own Named-Residuals discipline — is directly contradicted by an undocumented silent gap of exactly this shape.

Both the fix (wire `install_pre_push_hook` into `relocate_project`, mirroring `register_project`'s own post-commit block, plus a test asserting `core.hooksPath` at the relocated path) and the alternative (explicitly accept the asymmetry and add its own Named Residuals row) are small, well-scoped, and already specified in `12-REVIEW.md`'s own suggested fix. Neither has landed.

Everything else this phase set out to do is verified: Layer 3 is real, offline-tested across five outcomes (allow/deny/no-socket/benign/outside-worktree), the classifier scope fence holds with additions-only diffs at both plans that touched `main.rs`, the `SessionStart`/`CLAUDE_ENV_FILE` mechanism is implemented with both documented caveats and degrades silently, and the one credential-spending live measurement was actually spent, with its artifact on disk, showing all three probes passing (`restored`/`success`/`present`) — not merely claimed in a SUMMARY.

---

*Verified: 2026-10-01T10:32:37Z*
*Verifier: Claude (gsd-verifier)*
