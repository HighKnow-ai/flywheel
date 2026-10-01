---
phase: 12-destructive-gate-trust-boundary-redesign
verified: 2026-10-01T12:00:00Z
status: human_needed
score: 22/22 non-backstop must-haves verified
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
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-06-PLAN.md
  - .planning/phases/12-destructive-gate-trust-boundary-redesign/12-06-SUMMARY.md
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
  - packages/core/tests/project_reconciliation.rs
  - packages/shim/src/main.rs
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/sessionstart-hook.ts
  - packages/sidecar/test/sessionstart-hook.test.mjs
  - scripts/uat/run-all.sh
  - scripts/uat/uat-11-env-file-ordering.mjs
covered_digest: "v1:sha256:7c97daf02b20a78cf1ec83ed643f7baaad56b3258a36b52e5cb4a0490b7b6720"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 20/22
  gaps_closed:
    - "Truth 11 — relocate_project now re-installs the Layer 3 pre-push gate at the new repo_path, via a shared install_layer3_pre_push_gate helper also used by register_project"
  gaps_remaining: []
  regressions: []
advisory:
  - finding: "docs/destructive-gate-trust-boundary.md:941 (Round ten postmortem narrative) still reads 'installed once per registered project', contradicting the corrected 'installed at two points — registration and explicit relocation' claim earlier in the same document (line 141, corrected by 12-06)"
    category: other
    reason: "This is 12-REVIEW.md's WR-01, independently confirmed by this verification (grep -n 'installed once' docs/destructive-gate-trust-boundary.md still matches line 941). It is a self-contradiction within the document's own narrative, not a defect in the Layer 3 mechanism or in the Named Residuals table (truth 2), which is correctly widened. Does not undermine any must_have — the functional guarantee (Layer 3 installed at both registration and relocation) is real and tested. Fix: update line 941's wording to match line 141, per 12-REVIEW.md's suggested fix."
    evidence_status: "confirmed present by direct read; classified non-blocking by the phase's own code review (0 critical, 2 warning)"
  - finding: "The new source-scanning invariant test (destructive_gate_layer_coverage.rs:128-136) strips only whole-line comments ('//' at line start after trim), not trailing inline comments, which is narrower than its own doc comment's claim that 'a doc comment merely naming an identifier can never satisfy or invalidate the scan'"
    category: other
    reason: "This is 12-REVIEW.md's WR-02, independently confirmed by reading the filter closure `!line.trim_start().starts_with(\"//\")`. Not a live false-pass today — neither register_project nor relocate_project carries a trailing comment naming either identifier — so the invariant correctly holds for the two call sites that exist now. The gap is a future-robustness concern (a hypothetical third mutation path with a misleading trailing comment), not a present defect in truth coverage for D4/truth 11."
    evidence_status: "confirmed present by direct read of the filter logic; classified non-blocking by the phase's own code review (0 critical, 2 warning)"
human_verification:
  - test: "Confirm probe 1's live P1-restoration result is accepted as sufficient evidence for this phase, or request a second machine/claude-version measurement before relying on it generally"
    expected: "A human reviewer acknowledges the scope of the one macOS / claude 2.1.285 / bypassPermissions measurement (uat-11 artifact, probe1.verdict=\"restored\") and decides whether that is sufficient standing evidence, per 12-05-PLAN.md's own `verification: backstop` marker, which exists specifically so this is not auto-passed by a verifier"
    why_human: "Authored as a backstop truth in 12-05-PLAN.md's must_haves — the plan's own SUMMARY states the verifier must route this to human_needed rather than auto-pass it, even though the artifact already shows a pass, because it is one measurement on one configuration. Gap-closure plan 12-06 did not re-run this credential-spending live arm, by its own explicit scope fence, so this item is unchanged from the previous round."
  - test: "Confirm probe 2's live result (git --version stayed ordinary) is accepted as sufficient evidence that this phase's changes do not turn benign commands into permission requests"
    expected: "A human reviewer acknowledges the uat-11 artifact's probe2.verdict=\"success\" (a tool_result arrived for git --version, no permission_request was raised) as satisfying the ROADMAP's explicit acceptance clause second half, for this one measured session"
    why_human: "Authored as a backstop truth per 12-05-PLAN.md's must_haves, routed to human_needed by design rather than silently passed. Unchanged from the previous round."
  - test: "Confirm probe 3's live result (FLYWHEEL_PERMISSION_SOCKET reached the command shell) is accepted as sufficient evidence that the pre-push layer's ask-branch discriminator is real rather than assumed"
    expected: "A human reviewer acknowledges the uat-11 artifact's probe3.verdict=\"present\" as closing the specific uncertainty plan 12-04's ask branch depended on, for this one measured session"
    why_human: "Authored as a backstop truth per 12-05-PLAN.md's must_haves, routed to human_needed by design rather than silently passed. Unchanged from the previous round."
---

# Phase 12: Destructive-gate trust boundary redesign Verification Report

**Phase Goal:** Close the destructive-command gate's trust hole at a layer that does not depend on
`PATH` precedence the developer's login shell can reorder, with a two-sided acceptance clause: a
check that fails if the gate ever again reaches a decision it cannot justify, AND a check that fails
if ordinary agent commands become permission requests.
**Verified:** 2026-10-01T12:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (plan 12-06)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `docs/destructive-gate-trust-boundary.md` names a git-native interception layer (Layer 3) that does not depend on PATH precedence, and states P1 as unachievable rather than a load-bearing premise | ✓ VERIFIED | Unchanged from previous round — `## Layer 3` section, `### Why round ten was reverted` §2 verbatim |
| 2 | Named Residuals table carries rows for a deliberate `core.hooksPath` override, `default-branch-push` remaining Layer-2-only, an unregistered/never-firing `SessionStart` hook, and a refused install — and that refused-install row now covers both install call sites | ✓ VERIFIED | All four rows present; the refused-install row (line 433) widened by 12-06 to "whether the install is attempted at registration or at explicit relocation" — confirmed by direct read |
| 3 | An automated test fails the moment `packages/shim/src/main.rs` gains a string literal it does not carry today | ✓ VERIFIED | `cargo test -p core --test destructive_gate_no_new_launcher_tokens` — unaffected by 12-06, re-run live as part of this round's spot-checks (2/2 pass) |
| 4 | A real `git push origin --delete <branch>` run from a Flywheel-managed worktree is refused before any ref reaches the remote, with the shim absent from PATH | ✓ VERIFIED | Unchanged — re-confirmed by this round's `cargo test -p core --test git_hooks_pre_push` full run (24/24 pass, no regression) |
| 5 | A real force-push is refused with the remote ref unchanged | ✓ VERIFIED | Unchanged — same full-suite re-run |
| 6 | An ordinary fast-forward push, `git status` and `git --version` all exit 0 and raise no refusal under the same installed hook | ✓ VERIFIED | Unchanged — same full-suite re-run |
| 7 | A push from outside Flywheel's worktree root exits 0 — the developer's own terminal is never gated | ✓ VERIFIED | Unchanged — same full-suite re-run |
| 8 | When the repo already carries a non-Flywheel `core.hooksPath` or non-sample `pre-push`, install refuses, `register_project` still succeeds, and the refusal is a readable returned value | ✓ VERIFIED | Unchanged — `register_project` now routes through the shared `install_layer3_pre_push_gate` helper (refactor only, same three outcome arms, same stderr text, confirmed by direct read and by 12-REVIEW.md's independent diff trace); refusal tests still pass |
| 9 | `uninstall_pre_push_hook` returns the repository to its pre-install state | ✓ VERIFIED | Unchanged — same full-suite re-run |
| 10 | Every `DestructiveCategory` variant maps to at least one named interception layer in a table a test asserts is total | ✓ VERIFIED | `cargo test -p core --test destructive_gate_layer_coverage` — 5/5 pass (one new test added by 12-06), re-run live |
| 11 | **register_project installs Layer 3, but every path that can change a project's `repo_path` keeps it installed** | ✓ VERIFIED (gap closed) | `relocate_project` (packages/core/src/domain/project.rs:445-507) now calls `install_layer3_pre_push_gate(&canonical, project_id)` immediately after `tx.commit()` (line ~503), mirroring `register_project`'s own post-commit call (line ~349). Confirmed by direct read of both functions. Proven end-to-end by `relocating_to_a_fresh_clone_installs_the_pre_push_gate_at_the_new_path` (asserts `core.hooksPath` unset before, set to the project's hooks dir with `PRE_PUSH_MARKER` after) — re-run live by this verification, passes. The refusal arm (`a_refusal_never_fails_relocation`), the error arm (`an_install_error_never_fails_relocation`), and idempotency (`relocating_twice_to_the_same_clone_is_idempotent`) all re-run live, all pass. The totality invariant `every_repo_path_mutation_routes_through_the_layer3_install` (source-text scan of `project.rs`, asserting every function calling `set_repo_path(` also calls `install_layer3_pre_push_gate(`, non-vacuity-checked at ≥2 call sites) re-run live, passes |
| 12 | A `SessionStart` hook writes exactly one `export PATH=` line prepending the shim dir into `CLAUDE_ENV_FILE` | ✓ VERIFIED | Unaffected by 12-06 — unchanged from previous round |
| 13 | With `CLAUDE_ENV_FILE` unset / unwritable, or `FLYWHEEL_SHIM_BIN` unset, the script exits 0, throws nothing, writes nothing | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 14 | `writeHookSettings` carries both `PreToolUse` (byte-identical) and `SessionStart` entries | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 15 | No gate decision path changes — the full sidecar suite (every destructive-gate corpus row, every ordinary-usage row) stays green | ✓ VERIFIED | Orchestrator-reported 223/223 sidecar tests pass (grew from 217 — consistent with no regression, sidecar untouched by 12-06) |
| 16 | A destructive push raises a real permission request naming the correct category, and the human's answer decides it | ✓ VERIFIED | Unaffected by 12-06 — unchanged, re-confirmed by full-suite re-run |
| 17 | An allow answer lets the push actually complete | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 18 | A deny answer refuses the push, remote ref unchanged | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 19 | With no permission socket, the push is still refused (fail-closed preserved) | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 20 | An ordinary fast-forward push raises NO permission request — the socket is never even connected to | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 21 | `packages/shim/src/main.rs` gains only the new `--gate-push` entry point — baseline diff is additions only | ✓ VERIFIED | Unaffected by 12-06 (`main.rs` not in that plan's `files_modified`) — unchanged |
| 22 | `scripts/uat/uat-11-env-file-ordering.mjs` exists, is registered in `run-all.sh`, and its `--selftest` arm fails when the harness cannot observe its probes | ✓ VERIFIED | Unaffected by 12-06 — unchanged |
| 23 (backstop) | P1 restored: the agent's own command shell's first `PATH` segment is Flywheel's shim directory, in a real `bypassPermissions` session | ⚠️ Routed to human (backstop) | Same uat-11 artifact as the previous round (`probe1.verdict = "restored"`) — 12-06 did not re-spend this credential, by its own explicit scope fence. Still routed to human per `verification: backstop` |
| 24 (backstop) | `git --version` returns a tool result and never becomes a permission request, in that same session | ⚠️ Routed to human (backstop) | Same artifact: `probe2.verdict = "success"`. Still routed to human |
| 25 (backstop) | `FLYWHEEL_PERMISSION_SOCKET` is present in the agent's own command shell environment, in that same session | ⚠️ Routed to human (backstop) | Same artifact: `probe3.verdict = "present"`. Still routed to human |

**Score:** 22/22 non-backstop truths verified (was 20/22; truth 11 closed this round), 3 backstop truths routed to human by design (not counted toward score per their own `verification: backstop` markers).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/domain/project.rs` (`relocate_project`) | Keeps Layer 3 installed across relocation | ✓ VERIFIED | `install_layer3_pre_push_gate` called post-commit at line ~503; confirmed present and wired by direct read |
| `packages/core/src/domain/project.rs` (`install_layer3_pre_push_gate`) | Single shared helper rendering the install outcome for both mutation paths | ✓ VERIFIED | New private fn at line 214; `register_project` and `relocate_project` are its only two callers, confirmed by grep |
| `packages/core/tests/git_hooks_pre_push.rs` | Relocation install coverage: success, refusal, error, idempotency | ✓ VERIFIED | 4 new tests, all re-run live and passing (24/24 total in file) |
| `packages/core/tests/destructive_gate_layer_coverage.rs` | Source-level totality invariant over `repo_path` mutation paths | ✓ VERIFIED | `every_repo_path_mutation_routes_through_the_layer3_install` present, re-run live, passes; non-vacuity assertion (≥2 call sites) confirmed by direct read |
| `docs/destructive-gate-trust-boundary.md` | Relocation named as a second Layer 3 install point; refused-install residual row widened | ✓ VERIFIED | Lines 141-149 and 433 confirmed by direct read; see Advisory for one unrelated stale sentence elsewhere in the document (line 941, WR-01) that does not touch these two sections |
| All artifacts verified in the previous round (01-05 plans) | — | ✓ VERIFIED (unchanged) | Not re-derived here; see previous round's table, re-confirmed via this round's live full-suite re-run with no regression |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `register_project` | `install_layer3_pre_push_gate` | post-commit call, line ~349 | ✓ WIRED | Confirmed by direct read; behavior-preserving refactor of the previous inline match block, confirmed identical outcome arms by 12-REVIEW.md's independent diff trace |
| `relocate_project` | `install_layer3_pre_push_gate` | post-commit call, line ~503 | ✓ WIRED (was NOT WIRED — gap closed) | Confirmed by direct read; this is the exact link the previous round's Gap 1 reported missing |
| `install_layer3_pre_push_gate` | `crate::git_hooks::install_pre_push_hook` | direct call, all three outcome arms handled | ✓ WIRED | Confirmed by direct read — `Installed` (no-op), both `Refused*` (eprintln, no propagation), `Err` (eprintln, no propagation) |
| Generated `pre-push` hook script | shim binary `--gate-push` | baked absolute path, no PATH search | ✓ WIRED | Unaffected by 12-06 — unchanged from previous round |
| `sessionstart-hook.ts` | `writeHookSettings`'s `SessionStart` entry | `sessionStartHookScriptPath()` | ✓ WIRED | Unaffected by 12-06 — unchanged |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Relocation installs Layer 3 end-to-end | `cargo test -p core --test git_hooks_pre_push relocating` | 2 passed; 0 failed | ✓ PASS |
| Relocation refusal/error tolerance | `cargo test -p core --test git_hooks_pre_push relocation` | 2 passed; 0 failed | ✓ PASS |
| Third-mutation-path totality invariant | `cargo test -p core --test destructive_gate_layer_coverage every_repo_path` | 1 passed; 0 failed | ✓ PASS |
| Full Layer 3 offline suite (no regression) | `cargo test -p core --test git_hooks_pre_push` | 24 passed; 0 failed (was 20) | ✓ PASS |
| Full layer-coverage suite (no regression) | `cargo test -p core --test destructive_gate_layer_coverage` | 5 passed; 0 failed (was 4) | ✓ PASS |
| Project reconciliation suite (no regression) | `cargo test -p core --test project_reconciliation` | 14 passed; 0 failed | ✓ PASS |
| Debt-marker scan on all 12-06-touched files | `grep -nE "TBD\|FIXME\|XXX\|TODO\|HACK\|PLACEHOLDER"` | no matches | ✓ PASS |
| Commit trail | `git log --oneline` | `3f00324`, `ce817aa`, `3c30e61` all present, plus `66f68a2` (SUMMARY) and `0613065` (review) | ✓ PASS |

Full workspace (`cargo test`, 80 binaries) and sidecar suite (`npm test`, 223 tests) already confirmed passing with exit 0 by the orchestrator this run; not re-run here per the task's own instruction.

### Probe Execution

Not applicable — this phase's "probe" equivalent is `scripts/uat/uat-11-env-file-ordering.mjs`, unaffected by 12-06, covered under Behavioral Spot-Checks (self-test, previous round) and Human Verification (live arm, routed per its own `backstop` marker, unchanged this round).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| AGNT-07 | 12-01, 12-02, 12-03, 12-04, 12-05, 12-06 | Destructive actions always require explicit confirmation, even in auto-accept mode | ✓ SATISFIED | Previously partial (relocated-project path was an open hole). Now fully satisfied: `register_project` and `relocate_project` both install Layer 3 via the shared helper, with a test-enforced invariant against a future third path silently repeating the gap. REQUIREMENTS.md lists AGNT-07 as Complete under Phase 3; this phase closes the trust hole without reopening that requirement's status |
| BOARD-10 | 12-02 (key_link), 12-06 | User can register multiple local git repositories as projects | ✓ SATISFIED | Registration path verified previously; the companion `relocate_project` recovery path (also part of BOARD-10's project-management surface) is now also verified wired to Layer 3 |

No orphaned requirement IDs found mapped to Phase 12 beyond AGNT-07/BOARD-10.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `docs/destructive-gate-trust-boundary.md` | 941 | Stale claim ("installed once per registered project") left uncorrected in the Round-ten postmortem narrative, contradicting the corrected claim at line 141 | ⚠️ Warning (WR-01, carried from 12-REVIEW.md, still unresolved) | Documentation self-contradiction only; does not affect the Layer 3 mechanism, the Named Residuals table (truth 2), or any tested behavior. Non-blocking — see `advisory` frontmatter |
| `packages/core/tests/destructive_gate_layer_coverage.rs` | 128-136 | Comment-stripping in the new totality invariant strips whole-line `//` comments only, narrower than its own doc comment's claim | ⚠️ Warning (WR-02, carried from 12-REVIEW.md, still unresolved) | No live false-pass today (neither existing mutation path carries a misleading trailing comment); a future-robustness gap only. Non-blocking — see `advisory` frontmatter |

No debt markers (TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER) in any phase-12-touched file, including the files modified by 12-06.

### Human Verification Required

See `human_verification` in the frontmatter — three items, all unchanged from the previous round: the three `verification: backstop`-marked live guarantees (P1 restoration, `git --version` ordinariness, `FLYWHEEL_PERMISSION_SOCKET` presence), each already measured and passing per the uat-11 artifact from the prior round but deliberately routed to human acknowledgment by `12-05-PLAN.md`'s own design. The previous round's fourth human-verification item — "decide whether CR-01 blocks shipping" — is removed from this round: CR-01 is now resolved in code (not merely documented as accepted), so there is no longer a product-risk decision to make on it.

### Gaps Summary

No gaps remain. The single blocking gap from the previous round (`12-VERIFICATION.md` truth 11 / `12-REVIEW.md` CR-01 — `relocate_project` silently skipping the Layer 3 pre-push gate install) is closed: `relocate_project` now calls the same shared `install_layer3_pre_push_gate` helper that `register_project` uses, immediately after its own transaction commits, confirmed by direct code read and by five live-re-run tests (end-to-end success, refusal tolerance, error tolerance, idempotency, and a source-level totality invariant against a future third mutation path). `docs/destructive-gate-trust-boundary.md`'s Named Residuals table is correctly widened to cover both install call sites.

Two non-blocking documentation/test-robustness warnings remain open from `12-REVIEW.md` (WR-01: a stale sentence elsewhere in the trust-boundary doc; WR-02: the new invariant test's comment-stripping is narrower than its doc comment claims). Neither undermines a phase must_have — both are recorded under `advisory` for visibility and optional follow-up, not as gaps requiring a new closure plan.

Status is `human_needed` rather than `passed` solely because of the three `backstop`-marked live-session truths (23-25), which are deliberately designed by `12-05-PLAN.md` to always route to human acknowledgment rather than auto-pass, regardless of how many further gap-closure rounds run. This is unchanged from the previous round and is not itself a gap.

---

*Verified: 2026-10-01T12:00:00Z*
*Verifier: Claude (gsd-verifier)*
