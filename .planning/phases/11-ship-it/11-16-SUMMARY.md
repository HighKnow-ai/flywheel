---
phase: 11-ship-it
plan: 16
subsystem: live-path-tests-and-uat
tags: [uat-harness, fan-out, dispatcher, sidecar, real-claude-binary, permission-request, deferred-review]
requires: ["11-15"]
provides:
  - scripted coverage of register items D-REV-34 and D-REV-35 (their automatable halves)
  - scripts/uat/uat-13-fan-out-live.mjs and the uat_fanout_ops core bin behind it
  - a commit mode in the scripted fake claude, and a loopback stand-in for the model API
affects: [11-21 closure pass (the two routed claims below)]
tech-stack:
  added: []
  patterns:
    - "real dispatcher tick in a core bin; the Node harness forwards its spawn requests to the real sidecar and hands the sidecar's session_closed back to the production consumer"
    - "the model replaced by a loopback Messages-API server, so the real binary runs its real tools with no credential and no token"
    - "a control launch that must raise the thing the main launch asserts is absent"
    - "wave-two base asserted by git merge-base, with a control that parallel siblings do not contain each other"
key-files:
  created:
    - scripts/uat/uat-13-fan-out-live.mjs
    - packages/core/tests/bin/uat_fanout_ops.rs
  modified:
    - scripts/uat/run-all.sh
    - packages/core/Cargo.toml
    - packages/sidecar/test/fake-claude.mjs
    - packages/sidecar/test/real-claude-argv.test.mjs
    - .planning/DEFERRED-REVIEW.md
    - .planning/phases/11-ship-it/deferred-items.md
key-decisions:
  - "D-REV-34 is driven with four tasks, not three: three disjoint wave-one tasks against a cap of two, so the cap is the only thing that can hold one back."
  - "D-REV-35 is asked of the real binary through a loopback model server, not a real account: the two earlier tests keep the CLI off the network, so no tool call would ever happen, and a no-request assertion would be vacuous."
  - "The fake agent commits through plain git with its identity in the environment: the PATH shim raises a permission request for `git rev-parse` and for `git -c ...`. Logged, not fixed."
requirements-completed: [DIST-04]
status: complete
duration: ~35 min
completed: 2026-10-13
commits: 3
plan_head_before: 78b9b5e0fb7ffc241475aba113a8572634e559ae
actuals:
  tokens: 12600
  tasks: 2
  commits: 3
coverage:
  - deliverable: "uat-13: a whole fan-out through the real sidecar with only the model faked (cap, commit, merge, wave-two base)"
    verification:
      - kind: command
        ref: "node scripts/uat/uat-13-fan-out-live.mjs"
        status: pass
    human_judgment: false
  - deliverable: "the installed claude binary raises no permission_request for its read tools under the planning argv in default mode, with a control that does"
    verification:
      - kind: test
        ref: "packages/sidecar/test/real-claude-argv.test.mjs#argv: the real cli runs its own read tools without a permission_request under the planning launch argv in default mode"
        status: pass
      - kind: test
        ref: "packages/sidecar/test/real-claude-argv.test.mjs#argv: control - the same launch raises a permission_request for a tool that is not pre-approved"
        status: pass
    human_judgment: false
  - deliverable: "a real account and a real model following the commit instruction and the planning prompt"
    verification: []
    human_judgment: true
    rationale: "Needs a real login and a model's own behaviour; stays in the register for 11-21."
---

# Phase 11 Plan 16: A whole fan-out and the real binary's read tools Summary

One approved plan now drives the real sidecar through a scripted fake `claude` end to end with the real dispatcher tick and real git, and the installed `claude` is shown to run its read tools without a permission request under the exact planning argv, with a control that proves the instrument can see a request.

**This plan changed no production code.** Every commit is a `test(11-16)` or `docs(11-16)` commit. No RED run was manufactured: both behaviours already held, and I broke the line each check measures to show it can go red (below).

## D-REV-34: one approved plan, real sessions, merge, wave two on wave one

**Closed here (wiring):** `scripts/uat/uat-13-fan-out-live.mjs`, registered in `run-all.sh`, four sections each printing `D-REV-34` and a verdict. First run green.

| Section | What it asserts | Evidence |
|---|---|---|
| 1/4 cap | tick 1 spawns exactly 2 of 3 ready wave-one tasks; tick 2, run while both slots are still taken, spawns 0; live runs never exceed 2 over 7 ticks; every session returns from the sidecar as a completed `session_closed` | request counts, `liveRuns` after each tick |
| 2/4 commit | each of the 4 fake agents made exactly one commit, touching only its declared file | `git log --grep`, `git show --name-only` |
| 3/4 merge | every agent commit is an ancestor of the epic's integration branch; `main` did not move; at least 3 merge commits on the integration branch | `git merge-base --is-ancestor`, `git ls-tree`, `git rev-list --merges` |
| 4/4 base | all three wave-one commits are ancestors of the commit Task D was built on; control: Task A's branch does not contain Task B's commit | `git merge-base --is-ancestor`, never the plan's state column |

**What is real:** the sidecar as its own process, the core dispatcher tick (`dispatch_exec::run_pass`), the production `apply_session_closed`, the PATH shim, the watchdog wrapper, the scope marker (armed), the worktrees, the automatic merge, and git. **What is faked:** the model. `fake-claude.mjs` gained a commit mode that commits only when its `-p` prompt carries the dispatcher's commit instruction, so a commit existing proves the instruction travelled from the core, through the sidecar's argv, to the agent.

**Mutation check:** changing the fake's instruction match so it no longer recognised the briefing turned all four sections red (every task went `needs_attention`, no agent commits). Restored.

**Cleanup:** scratch app-data, worktree root, runtime directory and repository sit in one `mkdtemp` root, removed in a `finally` on failure too (T-11-45; the harness deliberately does not use `runScript`'s keep-on-failure convention, and prints its evidence instead). Verified no `flywheel-uat-uat-13-*` directory is left after a pass or a failure.

**Not proven, and a different claim:** a run against a real account (a real login, a packaged sidecar, a real model that actually follows the commit instruction). That is a model-behaviour claim; it is routed to plan 11-21. Also not exercised: the desktop crate's launch body itself. `uat_fanout_ops` mirrors its core steps (`start_agent_run` under the system actor, `assemble_context_packet`, `render_prompt` with `DISPATCHED_COMMIT_INSTRUCTION`, `arm_scope_marker_with`, the shim env), but not the credential block, drift warnings, criteria pinning, the per-repository spawn floor or the `board:changed` emit.

## D-REV-35: the installed CLI's read tools in `default` mode

**Closed here (pre-approval), against `claude` 2.1.287:** two tests added to `real-claude-argv.test.mjs`.

- `argv: the real cli runs its own read tools without a permission_request ...` builds the argv with `buildClaudeArgv` (planning launch: `default`, `submit_plan` the only pre-approved tool, the real permission MCP server on a real `startPermissionServer` socket), runs the real binary, and asserts: three tool results came back, none an error, the Read result carries the file's contents (the tool really ran), no `permission_request` arrived, and the process exited 0 inside 45 s.
- `argv: control - ...` runs the same launch with a scripted `Bash touch control.txt`, which is not on the CLI's read-only allow-list, and asserts a `permission_request` for `Bash` does arrive through the same socket. Without it, an absence would also be what a broken MCP wiring looks like.

**How, without a model.** The earlier two tests keep the CLI off the network (fake key, dead loopback port), so the CLI never makes a tool call and the plan's literal "run the real binary and assert no request" would pass vacuously. The model is replaced by a loopback server speaking the Messages API (`ANTHROPIC_BASE_URL`); `CLAUDE_CONFIG_DIR` is a scratch directory so the developer's own settings, hooks and permission rules cannot change the answer. No credential is used and no token is spent, which also keeps this inside the scope this plan set: a real account was not attempted. The harness for that is a model-replacement, not a transcription of an argv.

**Finding, recorded in the register:** this CLI version offers **no Grep or Glob tool** (its tool list is Agent, Bash, Edit, Read, Write, WebFetch and others). Search goes through Bash; `grep -rn` and `find` ran with no request. So what is proven is Read plus read-only Bash search, and the register's phrase "Read, Grep, Glob" is stale for this version. The test builds its search and listing calls from the tool list the CLI actually offers and prints that list (a version canary).

**Not proven, and a different claim:** a real model following the prompt's two entry forms without a correction round, calling `submit_plan`, and leaving the worktree clean. That is routed to plan 11-21. Also not covered: the hook `--settings` file a live planning launch passes (matchers for Bash and the authoring tools), so the argv here is the adapter's call minus that one flag.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added a core test-support binary and a Cargo.toml `[[bin]]`**
- **Found during:** Task 1
- **Issue:** the plan's file list names no Rust file, but the dispatcher tick (`run_pass`) and `apply_session_closed` are Rust, and the desktop launch body is `pub(crate)` behind an `AppHandle` and a 13-minute cold build. A Node script cannot call any of them. `uat_fleet_ops` (11-15) is the established seam.
- **Fix:** `packages/core/tests/bin/uat_fanout_ops.rs` plus its `[[bin]]` entry and a token on `run-all.sh`'s existing `cargo build` line. It refuses to run without `FLYWHEEL_APP_DATA_DIR`, `FLYWHEEL_WORKTREE_ROOT` and `FLYWHEEL_RUNTIME_DIR`.
- **Files modified:** packages/core/tests/bin/uat_fanout_ops.rs, packages/core/Cargo.toml, scripts/uat/run-all.sh
- **Commit:** 1d4ee75

**2. [Plan interpretation] Four tasks, not three**
- **Issue:** the plan's example (three tasks, two waves, cap two) puts two tasks in wave one, so the cap never binds and "exactly two, not three" is true of any dispatcher.
- **Fix:** wave one holds three disjoint tasks, wave two one. Tick 1 must spawn two of three; the third waits for a slot.
- **Commit:** 1d4ee75

**3. [Rule 1 - Bug in own harness] The fake agent's git calls raised permission requests**
- **Found during:** Task 1, first runs
- **Issue:** the fake ran `git -c user.email=... add` and `git rev-parse HEAD` through the real PATH shim, which classifies both as uncategorized and raises a `permission_request`; the sessions blocked until the harness timed out.
- **Fix:** identity through `GIT_AUTHOR_*` / `GIT_COMMITTER_*` environment variables, and `git log -1 --format=%H` instead of `rev-parse`. The product behaviour behind it is a coverage gap, logged not fixed (see below).
- **Files modified:** packages/sidecar/test/fake-claude.mjs
- **Commit:** 1d4ee75

**4. [Plan interpretation] D-REV-35 asked through a loopback model, not a real account**
- **Issue:** see "How, without a model" above. The plan's read-only-prompt run, as written, would exercise no tool.
- **Fix:** the loopback server, a control launch, and `CLAUDE_CONFIG_DIR` isolation.
- **Commit:** 449c8af

**Total deviations:** 4 (one blocking addition, two plan interpretations, one self-inflicted harness fix). **Impact:** none on scope; both register items are closed on exactly the half the plan named.

## Verification run

- `node scripts/uat/uat-13-fan-out-live.mjs`: exit 0, four passing sections (run four times across the work, plus the mutated failing run).
- `grep -c uat-13-fan-out-live scripts/uat/run-all.sh`: 1. `grep -cE "merge-base|git log" scripts/uat/uat-13-fan-out-live.mjs`: 4.
- `npm --prefix packages/sidecar test`: 297 pass, 0 fail, 0 skipped (295 before the two new tests). The argv tests ran and passed; the real binary was present, so nothing was skipped. The `-- --test-name-pattern "argv"` argument is swallowed by the package script (it appends to `node --test test/*.test.mjs` after a `&&`), so the whole suite ran.
- `grep -c buildClaudeArgv packages/sidecar/test/real-claude-argv.test.mjs`: 8. `grep -cE permission_request ...`: 4.
- **Not run:** `cargo test`. No core library code changed, only a new test-support binary that builds clean (`cargo build -p core --bin uat_fanout_ops`). `packages/core/tests/credentials.rs` was not run (it writes to the real login Keychain and hangs).

## Left for a human or a later plan

1. D-REV-34: a real account, a packaged sidecar, a real model that follows the commit instruction. Physical reason: a real login and a model's obedience. Routed to 11-21.
2. D-REV-35: a real model following the planning prompt and leaving the worktree clean. Same reason. Routed to 11-21.
3. Product, logged in `deferred-items.md`: the PATH shim raises a permission request for read-only git commands it does not list (`git rev-parse`, `git -c ... <sub>`, `git -C <dir> ...`), which would block a dispatched run and hold a cap slot. Fix shape given there; it needs its own tests, so it was not done in a test plan.

## Known Stubs

None.

## Threat Flags

None. T-11-45 mitigated (scratch root removed in a `finally`, failure included; the bin fails closed without the three variables; the harness asserts each directory sits inside the root). T-11-46 accepted and in fact stronger than planned: the real-binary test uses no credential at all.

## Self-Check: PASSED

All created files exist (`uat-13-fan-out-live.mjs`, `uat_fanout_ops.rs`); commits 1d4ee75, 449c8af and 35b2ff3 exist; the harness passes on re-run after the last edit. The `commits:` figure is measured from the persisted ledger at write time (3); the SUMMARY commit that follows makes a fourth.
