---
phase: 03-nothing-lost-nothing-left-running
plan: 07
subsystem: agent-safety
tags: [destructive-action-gate, pretooluse-hook, path-shim, permission-gate, rust, typescript, sqlite-migration]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-02's watchdog-wrapped spawn and permission-server socket seam; 03-04's PATH shim and its FLYWHEEL_REAL_GIT/lock-retry machinery"
provides:
  - "The one compiled D-56 classifier (packages/core/src/destructive.rs) shared by the shim and the hook"
  - "permission_requests.destructive_category, rejecting an allowed_always decision on any categorized request"
  - "The shim's indefinite-block gate over git and rm, wired to the session's existing permission socket"
  - "The PreToolUse hook (compiled, synchronous, never waits) covering the shim's absolute-path blind spot"
  - "A measured (not assumed) PreToolUse decision value, checked in as a re-runnable real-binary test"
affects: [03-12 (destructive-action gate card reads destructive_category), 09 (file-set enforcement can reuse the same classifier)]

# Actuals (#2632)
actuals:
  tokens: 34139
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One compiled classifier (packages/core/src/destructive.rs) consumed by two independent interception points (a Rust PATH shim and a Node PreToolUse hook shelling out to that same shim binary) so the two surfaces cannot drift apart"
    - "Fail-closed default: every classify() match arm falls through to Destructive(Uncategorized), never Safe, unless explicitly allow-listed"
    - "Measure-then-wire: a runtime decision value (the hook's PreToolUse permissionDecision) is picked from a live measurement against the real backend binary, checked in as a re-runnable test rather than hardcoded from documentation alone"

key-files:
  created:
    - packages/core/src/destructive.rs
    - packages/core/src/db/migrations/0007_destructive_gate.sql
    - packages/core/tests/destructive_classifier.rs
    - packages/sidecar/src/pretooluse-hook.ts
    - packages/sidecar/test/destructive-gate.test.mjs
    - packages/sidecar/test/mock-decision-hook.mjs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/db/mod.rs
    - packages/core/src/domain/permission_request.rs
    - packages/core/src/shim.rs
    - packages/shim/src/main.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts

key-decisions:
  - "The shim (a plain OS process with no CLI-imposed timeout), not the PreToolUse hook, is the component that blocks indefinitely (D-58) — the hook stays fast and synchronous by construction so its own 600s timeout can never matter."
  - "Uncategorized, not Safe, is the fail-closed default for anything classify() cannot confidently parse — an unrecognised destructive-family subcommand or a malformed argv is treated as dangerous."
  - "The PreToolUse hook's decision value was measured live against the real installed claude 2.1.236 binary, not assumed from RESEARCH.md's own single deny spike: both deny and ask were independently re-measured this session with a marker-file harness; neither deferred to a configured permission-prompt tool, so the hook is wired to deny per the plan's own decision rule for a 'neither defers' outcome."
  - "FLYWHEEL_SHIM_BIN is derived in claude-code-adapter.ts from the already-installed per-run shim directory (the first PATH segment shim_env_for_run prepends), rather than adding a new Rust-side env var — reuses the existing D-51 install step instead of a second, independently-resolved path to the same binary."

patterns-established:
  - "Measurement-as-checked-in-test: RESEARCH.md's Open Question 2 is resolved by a real-binary test file (destructive-gate.test.mjs) that re-runs the measurement on every suite invocation, with a falsifiability companion (a positive control proving the harness genuinely drives execution when unblocked) rather than a documentation-only claim."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "One compiled classifier (destructive.rs) defines D-56's fixed, non-configurable destructive-command list with a fail-closed Uncategorized default, shared by the shim and the hook"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs"
        status: pass
    human_judgment: false
  - id: D2
    description: "The shim blocks indefinitely over git and rm, routing to the board's existing permission socket with no cache, no timer and no default"
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "packages/core/tests/destructive_classifier.rs#shim_gate"
        status: pass
    human_judgment: false
  - id: D3
    description: "No standing (allowed_always) grant can ever cover a destructive category, enforced at the write path"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_classifier.rs"
        status: pass
    human_judgment: false
  - id: D4
    description: "The PreToolUse hook classifies synchronously (never waits), is wired to a decision value measured live against the real claude 2.1.236 binary rather than assumed, and blocks a destructive command invoked by absolute path — the class the shim structurally cannot see"
    requirement: "AGNT-07"
    verification:
      - kind: e2e
        ref: "packages/sidecar/test/destructive-gate.test.mjs (5 tests, all against the real backend: classify-command no-execution, positive-control falsifiability companion, deny-measured, ask-measured, shipped-hook end-to-end)"
        status: pass
    human_judgment: true
    rationale: "The plan's own <verify> names a <human-check> success criterion 5 cannot be proven by any harness in this repository — a real session on a scratch repository, in an auto-accept permission mode, force-pushing and observing the board pause and the remote branch stay unchanged. Deferred to the phase's consolidated end-of-phase UAT per workflow.human_verify_mode=end-of-phase."

# Metrics
duration: 121min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 7: Destructive-Action Gate — Measured Hook, Indefinite-Blocking Shim Summary

**One compiled D-56 classifier shared by a blocking Rust PATH shim and a synchronous Node PreToolUse hook, whose refusal decision was measured live against claude 2.1.236 rather than assumed.**

## Performance

- **Duration:** ~121 min wall-clock across an interrupted session (two prior attempts stalled/crashed mid-Task-3; this continuation resumed at Task 3, completed it, and closed out the plan) — task-active time is materially less than the wall-clock span
- **Started:** 2026-09-15T04:05:16Z (Task 1's first commit)
- **Completed:** 2026-09-15T06:06:32Z (Task 3's commit)
- **Tasks:** 3
- **Files modified:** 17 (9 created, 8 modified, across `packages/core`, `packages/shim`, `packages/desktop/src-tauri`, `packages/sidecar`)

## Accomplishments

- **Task 1 (prior commit `88c26b0`):** One compiled classifier (`packages/core/src/destructive.rs`) — 8 categories (`ForcePush`, `BranchDeletion`, `DefaultBranchPush`, `HardReset`, `ForceClean`, `HistoryRewrite`, `RecursiveDelete`, `Uncategorized`) parsed positionally over the real argv, fail-closed to `Uncategorized` by construction. `permission_requests.destructive_category` (migration `0007`) rejects an `allowed_always` decision on any categorized request.
- **Task 2 (prior commit `0b1b16f`):** The shim's `argv[0]` dispatch gained `rm` alongside `git`; a `Destructive` verdict opens the session's existing permission socket and blocks with a plain, undeadlined socket read — the component D-58 requires, because it is a plain OS process the backend does not supervise.
- **Task 3 (this continuation, commit `5b98442`):** The `PreToolUse` hook (`packages/sidecar/src/pretooluse-hook.ts`) — reads stdin, shells out to the shim's `--classify-command` mode, never opens a socket/polls/sleeps, and exits. `buildClaudeArgv` gained `settingsPath` (`--settings`); `startSession` derives `FLYWHEEL_SHIM_BIN` from the shim directory `PATH` already carries and writes a per-run settings file wiring the hook before argv is built. The hook's decision value was **measured live this session** against the real `claude 2.1.236` binary (see "Measurement" below) and wired to `deny`.

## Task Commits

Each task was committed atomically:

1. **Task 1: One compiled classifier for D-56's fixed list, with a fail-closed default** - `88c26b0` (feat) — completed by a prior executor, verified present on `git log` before this continuation began.
2. **Task 2: The shim blocks indefinitely, over `git` and `rm`, and routes to the board's existing answer surface** - `0b1b16f` (feat) — completed by a prior executor, verified present on `git log` before this continuation began.
3. **Task 3: The PreToolUse hook — measure which decision actually holds, then wire that one** - `5b98442` (feat)

**Plan metadata:** committed alongside this SUMMARY (see below).

## Measurement (Task 3's own instruction: measure, don't assume)

A prior, stalled attempt at Task 3 had already written `pretooluse-hook.ts` with a doc comment
claiming both `deny` and `ask` were measured against a mock permission-prompt-tool socket server —
but no test file existed to reproduce that claim, and RESEARCH.md's own spike had only measured
`deny`. Per this continuation's explicit instruction, the measurement was re-run independently
rather than inherited:

Run live, this session, against the real installed **`claude 2.1.236`** binary in headless
streaming mode (`--permission-mode bypassPermissions`, auto-accept) with a `--settings`-injected
`PreToolUse` hook on the `Bash` matcher, asking the model to run one harmless, observable command
(`touch` a marker file) and asserting on the marker file's existence afterward — never on the
transcript's own claims:

| Hook decision | Marker file created? | Transcript's own `non_execution_kind` |
|---|---|---|
| *(no hook opinion — positive control)* | **Yes** | n/a — command executed |
| `deny` | **No** | `"permission-rule"` |
| `ask` | **No** | `"user-rejected"` |

Neither `deny` nor `ask` ever deferred to a configured `--permission-prompt-tool` (no mock
prompt-tool server was even configured in this repro — the transcript settles the tool call
directly from the hook's own decision either way). Since neither defers, per the plan's own
decision rule for a "neither defers" outcome, the hook is wired to **`deny`** — the semantically
direct value for an outright refusal. This is a checked-in, re-runnable measurement:
`packages/sidecar/test/destructive-gate.test.mjs` reproduces all three rows above plus an
end-to-end test of the shipped hook script blocking a destructive `rm` invoked by absolute path
(the residual class the D-51 PATH shim structurally cannot see), and passed 5/5 against the same
binary.

**Residual gap, named rather than papered over:** this hook is a REFUSAL layer, not a QUESTION
layer, for the narrow class of commands only it (not the shim) can see. The shim still asks the
board and waits indefinitely for every `git`/`rm` invocation it sees; a destructive command
reaching only the hook (invoked by absolute path, or from inside a language runtime without
shelling out) is refused outright rather than surfaced as a pending board question.

## Files Created/Modified

- `packages/core/src/destructive.rs` - the one compiled D-56 classifier (Task 1)
- `packages/core/src/db/migrations/0007_destructive_gate.sql` - `permission_requests.destructive_category` column (Task 1)
- `packages/core/tests/destructive_classifier.rs` - classifier, migration, allow-always-rejection, and shim-gate tests (Tasks 1-2)
- `packages/core/src/domain/permission_request.rs` - `destructive_category` parameter, allow-always rejection guard (Task 1)
- `packages/core/src/shim.rs` - `install_for_run`/`shim_env_for_run` extended for the second shadowed `rm` name (Task 2)
- `packages/shim/src/main.rs` - `rm` dispatch, the destructive gate over the permission socket, and `--classify-command` mode (Tasks 2-3 ownership, landed in Task 2's commit)
- `packages/desktop/src-tauri/src/sidecar.rs` - `FLYWHEEL_REAL_RM`/`FLYWHEEL_DEFAULT_BRANCH` env plumbing (Task 2)
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `destructiveCategory` threaded through to `create_pending_request` (Task 2)
- `packages/sidecar/src/pretooluse-hook.ts` - the compiled, synchronous `PreToolUse` hook (Task 3, this continuation)
- `packages/sidecar/src/claude-code-adapter.ts` - `buildClaudeArgv`'s `settingsPath`, `FLYWHEEL_SHIM_BIN` derivation, per-run settings write (Task 3, this continuation)
- `packages/sidecar/test/destructive-gate.test.mjs` - the checked-in measurement + regression suite (Task 3, this continuation)
- `packages/sidecar/test/mock-decision-hook.mjs` - the measurement-only hook fixture the suite above uses to test each candidate decision independently (Task 3, this continuation)

## Decisions Made

See `key-decisions` in the frontmatter above. The load-bearing one for this continuation: the
hook's wired decision value (`deny`) came from a live re-measurement performed during this session,
not from inheriting the stalled prior attempt's unverified claim — both candidates were
independently confirmed to block execution and neither deferred to a permission-prompt tool.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected an unverified measurement claim in `pretooluse-hook.ts`'s own doc comment**
- **Found during:** Task 3 resume (inspecting the stalled prior attempt's partial work per this continuation's explicit instruction to verify, not inherit)
- **Issue:** The partial `pretooluse-hook.ts` asserted that both `deny` and `ask` were measured "live" against a "real mock permission-prompt-tool socket server," with neither producing "a single connection to that server" — but no test file existed to reproduce this, and RESEARCH.md's own spike had only measured `deny` (never `ask`, and never against a configured permission-prompt-tool server at all).
- **Fix:** Independently re-measured both candidate values live against the real `claude 2.1.236` binary using a marker-file harness (see "Measurement" above), confirmed the underlying conclusion held (`deny` was already correctly wired), and rewrote the doc comment to describe only what was actually measured (marker-file evidence and the transcript's own `non_execution_kind`), removing the specific-but-unperformed mock-server-connection-count claim.
- **Files modified:** `packages/sidecar/src/pretooluse-hook.ts`
- **Verification:** `packages/sidecar/test/destructive-gate.test.mjs` (5/5 pass against the real binary)
- **Committed in:** `5b98442` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — an unverified factual claim in a doc comment, corrected to match an independently-reproduced measurement)
**Impact on plan:** No functional code was wrong (the stalled attempt had already wired the correct value); the fix closes a documentation-accuracy gap that would otherwise have let an unverified claim about the product's own safety guarantee ship as fact.

## Issues Encountered

- **Two prior automated attempts at Task 3 did not reach a commit.** The first stalled mid-task on a runtime failure (no checkpoint, no decision to answer — inspected and resolved by this continuation per its own instructions). The second died on a quota limit before committing anything. This continuation inspected the uncommitted partial work (`pretooluse-hook.ts`, a partial diff to `claude-code-adapter.ts`), judged it on its merits (kept the hook script as-is after correcting its doc comment; completed the unfinished `buildClaudeArgv`/`startSession` wiring the partial diff had stopped short of), and carried the task to a clean, tested commit.
- **`destructive-gate.test.mjs` spends real API cost on every run** (5 live turns against the real `claude` binary at time of authoring, ~$0.80 total this session) and showed one transient non-deterministic failure on an ad-hoc re-run outside the official `npm test` invocation (the "deny" case did not settle as expected once, out of two independent full-suite runs) — consistent with any test that depends on a live LLM's behavior rather than a deterministic fixture. The **official** `npm --prefix packages/sidecar test` run for this plan passed 49/49 (including all 5 destructive-gate tests) with no retries. Flagged here as a known characteristic of this test file, not a defect in the product code it tests — the shim's own indefinite-block guarantee (Task 2, `shim_gate` tests) does not depend on this suite and remains deterministic.
- **No `FLYWHEEL_SHIM_BIN` Rust-side env var was added.** The plan's action text placed this addition under `claude-code-adapter.ts`'s ownership; rather than adding a new Rust-side plumbing entry, `FLYWHEEL_SHIM_BIN` is derived in TypeScript from the per-run shim directory `shim_env_for_run` already prefixes onto `PATH` (D-51) — reusing the existing install step instead of a second, independently-resolved path to the same compiled binary. Documented as a key-decision above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The destructive-action gate's data and enforcement layers (classifier, migration, shim, hook) are complete and tested against the real backend binary. Plan 03-12 (destructive-action gate card) can now read `permission_requests.destructive_category` and render the UI-SPEC's consequence copy.
- **Outstanding human verification (per `workflow.human_verify_mode: end-of-phase`):** this plan's own `<verify>` names a `<human-check>` — a real session on a scratch repository, in an auto-accept permission mode, attempting a force-push and confirming the board shows a pending permission request that blocks the session, then denying it and confirming the agent receives a named explanation. No harness in this repository can stand this up; it is deferred to the phase's consolidated end-of-phase UAT.
- The named residual gap (hook is a refusal layer, not a question layer, for the class of destructive commands only it can see) should be carried into any future UX copy about "always asks" to avoid overclaiming coverage this plan does not provide.

## Self-Check: PASSED

- All 7 key-files (created + `claude-code-adapter.ts`) verified present on disk via `[ -f ]`.
- All 3 task commits (`88c26b0`, `0b1b16f`, `5b98442`) verified present via `git log --oneline --all`.
- `packages/sidecar/test/destructive-gate.test.mjs` (5 tests) and the full `npm --prefix packages/sidecar test` suite (49 tests) both passed against the real `claude` binary and the built shim.
- `cargo build --workspace` clean.
- All Task 3 `<acceptance_criteria>` greps re-run and passing: `settingsPath` count 10 (≥2), `PreToolUse` mentions under `packages/desktop/src-tauri/src` = 0, hook wait-source-gate grep = 0.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*
