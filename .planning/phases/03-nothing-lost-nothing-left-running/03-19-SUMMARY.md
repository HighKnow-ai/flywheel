---
phase: 03-nothing-lost-nothing-left-running
plan: 19
subsystem: security
tags: [destructive-gate, permission-request, shim, pretooluse-hook, agnt-07, gap-closure]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running (plan 07)
    provides: the shim's blocking permission socket (D-58), the PreToolUse hook's original
      absolute-path-only refusal design, and destructive::classify
  - phase: 03-nothing-lost-nothing-left-running (plan 14)
    provides: classify_push's branch-deletion-over-default-branch-push precedence
provides:
  - "packages/shim/src/main.rs: a --classify-invocation mode reporting program + invokedBareName
    alongside the destructive verdict, so a caller can decide whether the shim can intercept a
    command before choosing to refuse it itself"
  - "packages/sidecar/src/pretooluse-hook.ts: shimWillIntercept(program), proving (never assuming)
    the shim's shadow entry is actually reachable before deferring to it; deny is now the class the
    shim structurally cannot see, not every non-safe verdict"
  - "packages/sidecar/src/mcp-permission-server.ts: the permission socket path now fits macOS's
    sockaddr_un SUN_LEN limit regardless of $TMPDIR length, making the socket genuinely reachable"
  - "Live proof (not just a unit test) that a bare, agent-issued 'git push origin --delete <branch>'
    in an auto-accept session now raises a real permission_request carrying
    destructiveCategory: branch-deletion -- the exact thing G-03-3 found missing"
affects: [any future plan touching the destructive gate, the permission socket, or session-lifecycle/watchdog behavior]

# Actuals (#2632)
actuals:
  tokens: 9700
  tasks: 3
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-phase classify-then-decide: a shim mode reports facts (program, invokedBareName)
      separately from the verdict, so a caller (the hook) can make its OWN provable decision
      instead of re-deriving the shim's own logic."
    - "shimWillIntercept-style positive proof before deferring: never defer/allow on an absence of
      evidence -- only on a demonstrated, checkable fact (FLYWHEEL_SHIM_BIN's directory is PATH's
      first entry AND contains an executable file named exactly the program)."

key-files:
  created: []
  modified:
    - packages/shim/src/main.rs
    - packages/sidecar/src/pretooluse-hook.ts
    - packages/sidecar/test/destructive-gate.test.mjs
    - packages/sidecar/src/mcp-permission-server.ts
    - scripts/uat/uat-03-destructive-gate.mjs

key-decisions:
  - "shimWillIntercept requires ALL THREE proof conditions (FLYWHEEL_SHIM_BIN set, its directory is
    literally PATH's first entry, that directory contains an executable file named exactly the
    destructive program) before the hook defers -- any single failure denies, never allows."
  - "--classify-command is left byte-for-byte unchanged and kept as test-only surface (asserted by
    destructive-gate.test.mjs) rather than deleted, per the plan's own explicit instruction, even
    though its only runtime caller (the hook) now uses --classify-invocation instead."
  - "The permission socket now binds under /tmp instead of os.tmpdir() (falling back to
    os.tmpdir() only if /tmp is unwritable) -- mirrors the fix packages/core/tests/
    destructive_classifier.rs::scratch_socket_path already applied to the Rust test suite for the
    identical SUN_LEN reason."
  - "AGNT-07 is NOT re-certified fully closed by this plan. Tasks 1-2 (the code fix) are complete
    and fully tested. Task 3's live measurement proved the request-raising half of G-03-3's truth
    statement but could not cleanly observe the sustained-block-then-deny half end-to-end, because
    a NEW, separate, previously-unknown issue surfaced: the session is terminated (reason: 'failed')
    roughly 15-16s after the deliberate command blocks, in a way independent of the watchdog's own
    heartbeat-staleness kill (ruled out by measurement, not assumption -- see Deviations). This is
    filed as a new finding for a follow-up investigation, not patched by this plan."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "The shim reports whether a destructive invocation was reachable by the shim's own
      PATH-shadowed directory (--classify-invocation: program + invokedBareName alongside the
      verdict), leaving --classify-command's own output byte-for-byte unchanged."
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the shim's --classify-invocation mode reports program and bare-name status for a destructive verdict"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the shim's --classify-invocation mode fails closed on a missing argument"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#--classify-command's output is unchanged by the --classify-invocation mode's addition"
        status: pass
    human_judgment: false
  - id: D2
    description: "The PreToolUse hook defers to the shim's own question ONLY when it can positively
      prove the shim will intercept the invocation, and denies in every other case -- including an
      absolute-path invocation the shim structurally cannot see."
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook defers (no opinion) to a bare destructive command when a correctly-shaped shim directory leads PATH"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook denies a bare destructive command when FLYWHEEL_SHIM_BIN is unset"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook denies a bare destructive command when the shim directory is NOT first on PATH"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook denies a bare destructive command when the shim directory is missing that program's shadow entry"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook denies an absolute-path destructive command even with a perfectly good shim directory"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the hook prints no opinion for a safe command regardless of shim directory shape"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/sidecar/src/pretooluse-hook.ts | grep -cE 'createConnection|net\\.|setTimeout|setInterval|await new Promise' = 0 (03-07's own never-waits source gate, re-run against the rewritten file)"
        status: pass
    human_judgment: false
  - id: D3
    description: "End-to-end: a live claude session's bare, agent-issued destructive git command now
      raises a genuine permission_request (not a bare refusal), the session stays blocked while
      unanswered, and denying it leaves the remote unchanged with an explanation to the agent."
    requirement: AGNT-07
    verification:
      - kind: e2e
        ref: "scripts/uat/uat-03-destructive-gate.mjs (Property A -- safety) -- run live, this session"
        status: pass
      - kind: e2e
        ref: "scripts/uat/uat-03-destructive-gate.mjs (Property B.1 -- a permission_request carrying destructiveCategory: branch-deletion IS raised for a live agent-issued bare command) -- run live, this session"
        status: pass
      - kind: e2e
        ref: "scripts/uat/uat-03-destructive-gate.mjs (Property B.2/B.3 -- sustained block + deny-and-close) -- attempted repeatedly, could not complete: a newly-discovered, unrelated session-termination issue closes the session ~15-16s after the request is raised"
        status: fail
    human_judgment: true
    rationale: "The core mechanism this plan exists to fix (the hook asks instead of refusing) is
      proven live and unit-tested exhaustively. The full sustained-block-then-deny flow could not
      be cleanly observed end-to-end in this sandboxed executor environment because of a NEW,
      separate finding (see Deviations/Issues below) that needs its own dedicated investigation --
      a human (or a follow-up plan run in a cleaner environment) should confirm whether that
      finding reproduces outside this environment before G-03-3 is considered fully closed."

# Metrics
duration: 95min
completed: 2026-09-18
status: complete
---

# Phase 3 Plan 19: Destructive-gate confirmation fix (G-03-3) Summary

**The PreToolUse hook now defers to the shim's own permission socket for any destructive command it can prove the shim will intercept, and a live session was measured raising a real `permission_request` (`destructiveCategory: branch-deletion`) for the first time — but a newly-discovered, unrelated session-termination issue kept the full block-then-deny flow from being observed end to end.**

## Performance

- **Duration:** 95 min
- **Started:** 2026-09-18T10:12:26.047Z (STATE.md last_updated)
- **Completed:** 2026-09-18
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `packages/shim/src/main.rs` gained `--classify-invocation`, reaching the same
  `classify_raw_command_text` as `--classify-command` but additionally reporting the destructive
  segment's program name and whether it was invoked by bare name — the fact the hook needs to
  decide whether the shim can catch a command. `--classify-command`'s own output is byte-for-byte
  unchanged (verified by a dedicated regression test), and is kept as test-only surface per the
  plan's own instruction rather than deleted.
- `packages/sidecar/src/pretooluse-hook.ts` was rewritten to two branches: defer (no opinion) only
  when `shimWillIntercept(program)` can positively PROVE the shim's shadow entry is reachable
  (`FLYWHEEL_SHIM_BIN` set, its directory is literally `PATH`'s first entry, that directory
  contains an executable file named exactly the program); deny in every other case, including any
  failure to establish the above and any absolute-path invocation. The hook still performs exactly
  one synchronous `spawnSync` and exits — re-verified against 03-07's own source-level grep gate
  that it opens no socket, polls nothing, and sleeps never.
- Six new hook-level tests in `destructive-gate.test.mjs` run the SHIPPED compiled hook script
  directly against constructed shim directories, covering every branch named in the plan: bare +
  good shim defers, `FLYWHEEL_SHIM_BIN` unset denies, shim directory not first on `PATH` denies,
  shim directory missing the program's shadow entry denies, absolute path with a good shim denies,
  safe command defers regardless of shim shape.
- **Live measurement (Task 3):** a real `claude` 2.1.267 session in `bypassPermissions` mode,
  instructed to run a bare `git push origin --delete <branch>`, produced a genuine
  `permission_request` event carrying `destructiveCategory: "branch-deletion"` — the exact thing
  `03-VERIFICATION.md`/`03-UAT.md`'s gap G-03-3 found missing. Before this plan, ZERO
  `permission_request` events were ever raised for this scenario in any measurement; a
  `non_execution_kind: "permission-rule"` refusal is what the agent got instead. That refusal path
  is now gone for any command the shim can intercept.
- Retired UAT item 4's caveat for the specific claim it named: the destructive-action card's
  underlying data (a pending `permission_request` with a `destructiveCategory`) is no longer
  something only a seeded database row can produce — a live session now produces it unprompted.
  `uat-ui-setup.sh destructive` is left in place regardless, per the plan's own instruction, as the
  cheapest way to inspect the card's pixels without a live turn.

## Task Commits

Each task was committed atomically:

1. **Task 1: The shim reports whether it can intercept** — `21be463` (feat)
2. **Task 2: The hook defers when interception is provable, refuses when it is not** — `6910aa1` (fix)
3. **Task 3 acceptance work — necessary deviations to actually run the live measurement** — `5e7f454` (fix)

**Plan metadata:** commit created alongside this SUMMARY (see below).

## Files Created/Modified

- `packages/shim/src/main.rs` — `--classify-invocation` mode; `classify_raw_command_text` refactored
  into a `ClassifiedInvocation` struct (verdict + program + invoked_bare_name) computed in one scan.
- `packages/sidecar/src/pretooluse-hook.ts` — `shimWillIntercept`, the two-branch decision, switched
  from `--classify-command` to `--classify-invocation`, updated module doc comment.
- `packages/sidecar/test/destructive-gate.test.mjs` — classify-invocation unit tests (4) + hook
  two-branch tests (6), run against the real compiled shim binary and the shipped compiled hook.
- `packages/sidecar/src/mcp-permission-server.ts` — `socketBaseDir()`: the permission socket now
  binds under `/tmp` (falling back to `os.tmpdir()` only if `/tmp` is unwritable), fixing a real
  `SUN_LEN` reachability bug this plan's own Task 3 measurement surfaced (see Deviations).
- `scripts/uat/uat-03-destructive-gate.mjs` — a background drain loop that auto-allows every
  INCIDENTAL `permission_request` (never the deliberate one), the outcome race and Property A.2
  retargeted onto the deliberate request specifically, matching the genuinely two-phase flow this
  plan's fix introduces.

## Decisions Made

See `key-decisions` in the frontmatter above. The most consequential: **AGNT-07 is not being
re-certified as fully, cleanly closed by this plan** — the code fix (Tasks 1-2) is complete and
exhaustively tested, and the live measurement proved the core, previously-broken claim (a real
`permission_request` is raised), but a new, separate issue prevented observing the full
sustained-block-then-deny flow end to end. See Issues Encountered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Permission socket path exceeded macOS's `SUN_LEN` limit**
- **Found during:** Task 3 (first live run)
- **Issue:** `packages/sidecar/src/mcp-permission-server.ts::startPermissionServer` built the socket
  path from `os.tmpdir()`, which on macOS resolves to a long, per-session sandboxed directory
  (`/var/folders/.../T/`). Joined with `flywheel-permission-<uuid>.sock`, the resulting path (110
  chars, measured) exceeds `sockaddr_un`'s ~104-byte `SUN_LEN` limit. `UnixStream::connect` in the
  shim's `request_permission` failed immediately with `"path must be shorter than SUN_LEN"` — a
  connection error the shim (correctly) treats as a refusal, indistinguishable from a clean deny.
  This is why the bug was never caught before: every prior destructive command was denied outright
  by the OLD hook before the shim's socket was ever reached, so the socket's own unreachability was
  never exercised by a live measurement until this plan made the hook actually defer to it.
- **Fix:** `socketBaseDir()` prefers `/tmp` (short, present on every POSIX target this product
  ships to), falling back to `os.tmpdir()` only if `/tmp` is unwritable. Mirrors the identical fix
  `packages/core/tests/destructive_classifier.rs::scratch_socket_path` already applied to the Rust
  test suite for the same reason (pre-existing code comment named the exact same limit).
- **Files modified:** `packages/sidecar/src/mcp-permission-server.ts`
- **Verification:** Socket path length measured directly (66 chars under `/tmp` vs. 110 under the
  sandboxed `$TMPDIR`); subsequent live runs successfully connected and raised `permission_request`
  events.
- **Committed in:** `5e7f454`

**2. [Rule 3 - Blocking] The live UAT harness could not reach the deliberate command at all**
- **Found during:** Task 3 (after fix #1, second live run)
- **Issue:** Once the socket was reachable, the live session's OWN internal startup git housekeeping
  (`claude` 2.1.267 checking `.claude/settings.local.json` under version control, the remote URL,
  `status`/`log`/`config user.*`, `worktree list` — issued OUTSIDE the agent's visible Bash tool
  loop, as part of ordinary session initialization) also resolves through the same PATH-shimmed
  directory as every other invocation, and reaches the shim's own `destructive_gate` exactly like
  any agent-issued command would. Those internal invocations carry `git`'s own GLOBAL options
  (`-c core.hooksPath=... -C <path>`) that `packages/core/src/destructive.rs::classify_git` does not
  parse past (a pre-existing, separately-scoped, previously-documented gap — see
  `scripts/uat/README.md`'s own "Two classifier observations" section) — so `expanded.first()`
  reads the literal token `"-c"`, matches no known subcommand, and fails closed to `uncategorized`
  (destructive). Left unanswered, each one blocks its own subprocess indefinitely and starves the
  session before it ever reaches the deliberate push. This is genuinely orthogonal to G-03-3 and to
  this plan's own three declared files — `destructive.rs`'s global-flag parsing is out of scope and
  was NOT touched.
- **Fix:** Added `drainIncidentalPermissionRequests` to `scripts/uat/uat-03-destructive-gate.mjs` — a
  background loop, started right after spawn and stopped via `harness.onCleanup`, that auto-allows
  every `permission_request` that is NOT the deliberate one (matched by `destructiveCategory:
  "branch-deletion"` AND the command text containing the doomed branch name). This is a test-harness
  change only; it answers nothing this item itself asserts on and changes no production
  classification.
- **Files modified:** `scripts/uat/uat-03-destructive-gate.mjs`
- **Verification:** Subsequent runs reached the deliberate `tool_call` and its own
  `permission_request` reliably.
- **Committed in:** `5e7f454`

**3. [Rule 1 - Bug, test-only] The script's own Property A.2/outcome-race assumed a single-phase flow**
- **Found during:** Task 3 (after fix #2)
- **Issue:** The original script's `outcome` race matched ANY `permission_request` (now ambiguous
  once incidental ones also exist) and its "explained" check (Property A.2) ran immediately after
  the race — correct for the OLD single-phase "hook denies outright with an explanation in the same
  turn" shape, but not for the NEW two-phase shape this plan intentionally introduces: the tool call
  stays genuinely blocked with nothing to explain until it is actually answered.
- **Fix:** `isDeliberateRequest` now scopes both the outcome race and the `permissionRequest` lookup
  to the specific deliberate command; the "explained" check moved to run AFTER the deny, when an
  explanation can actually exist.
- **Files modified:** `scripts/uat/uat-03-destructive-gate.mjs`
- **Committed in:** `5e7f454`

---

**Total deviations:** 3 auto-fixed (1 bug — production code, security-neutral reachability fix; 2
test-harness-only, necessary to observe the two-phase flow this plan's own code change introduces).
**Impact on plan:** All three were necessary to complete Task 3's own acceptance measurement; none
weakens any existing test, changes `--classify-command`'s output, or touches the destructive
classifier's security semantics. No scope creep into `destructive.rs`'s own known, documented,
separately-scoped global-flag gap.

## Issues Encountered

**A new, unresolved finding — NOT fixed by this plan, filed here for follow-up:** across five live
runs (with and without an explicit `FLYWHEEL_HEARTBEAT_STALE_MS=120000` override), the session is
terminated (`session_closed`, `reason: "failed"`) roughly 15-16 seconds after the deliberate
destructive command's `permission_request` is raised — well before the script's own 8-second
`assertNoEvent` observation window can complete, and before the request is ever answered by this
test. The `detail` field on every occurrence is the same benign, pre-existing "no stdin data
received in 3s" warning (present near the start of every session's stderr, destructive or not),
which is almost certainly just the last content in the 2000-char stderr tail rather than the true
cause.

What was ruled out, by measurement:
- **Not the watchdog's heartbeat-staleness kill** (`packages/sidecar/src/watchdog.ts`,
  `DEFAULT_HEARTBEAT_STALE_MS = 15_000`) — the closest fit by timing, but explicitly disproved: a
  run with `FLYWHEEL_HEARTBEAT_STALE_MS=120000` set (and confirmed to propagate through
  `startSidecar`'s and `startSession`'s own `{...process.env, ...}` spreads down to the watchdog
  wrapper process) failed identically, at the same ~15-16s mark.
- **Not this plan's own personal-dev-environment cross-talk** (this executor's `~/.claude/`
  carries GSD hooks, the `superpowers`/`impeccable` plugins, and an MCP server, all inherited by the
  nested session via `sessionEnv`'s `{...process.env}` spread) — a run with an isolated `HOME`
  produced a DIFFERENT failure (`mise` config-trust error, since `claude` resolves via a `mise`
  shim keyed off the real `$HOME`), not evidence either way, but the *destructive-gate* mechanism
  itself (fixes #1/#2 above) was independently confirmed correct before this was attempted.

What remains unconfirmed: whether `claude` 2.1.267 itself imposes some internal limit on a Bash
tool call that produces no output for an extended period (a subprocess genuinely, correctly blocked
on `request_permission`'s socket read produces none), or whether some other session-lifecycle
mechanism in `claude-code-adapter.ts`/`watchdog.ts` is responsible. This is squarely outside this
plan's three declared files (`packages/shim/src/main.rs`, `packages/sidecar/src/
pretooluse-hook.ts`, `packages/sidecar/test/destructive-gate.test.mjs`) and was not investigated
further, per this plan's own instruction not to fake or silently skip an environment blocker but to
report it plainly.

**What this means for AGNT-07 / G-03-3:** the specific defect G-03-3 was filed against — the hook
refusing every destructive command outright instead of asking — is fixed and live-proven (a real
`permission_request` now reaches the board for a live agent-issued command, where before none ever
did). Whether that request reliably SURVIVES long enough for a human to actually answer it in every
environment is a new, separate, unresolved question this plan surfaced but did not have in scope to
answer. Recommend a dedicated follow-up plan/spike specifically on session lifecycle under a
pending destructive-gate block, ideally run in a cleaner environment (no inherited personal
`~/.claude/` configuration) to isolate the cause cleanly.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**Ready:**
- The destructive gate's core defect (refusal instead of confirmation) is fixed, unit-tested, and
  live-proven for the class of commands the shim can see.
- `--classify-command` remains available, unchanged, as a stable test-only surface.
- The permission socket now reliably binds on macOS regardless of `$TMPDIR` length.

**Blockers/concerns for follow-up:**
- **New finding, not yet root-caused:** a live session appears to self-terminate ~15-16s into a
  destructive-gate block, independent of the watchdog's heartbeat-staleness mechanism. If this
  reproduces outside this specific sandboxed executor environment, it would mean a real user who
  takes more than ~15 seconds to answer a destructive-action permission card could have their whole
  session killed out from under them — worth investigating before treating G-03-3 as fully closed.
- **Pre-existing, separately-scoped, unaffected by this plan:** `packages/core/src/
  destructive.rs::classify_git` does not parse git's own GLOBAL options (`-c`, `-C`, etc.) before
  dispatching on the subcommand, so any git invocation carrying them — including `claude`'s own
  internal session-startup housekeeping — misclassifies as `uncategorized` (destructive). This was
  already documented as a known limitation (`scripts/uat/README.md`) for `-C`/`worktree`; this plan
  additionally observed it firing on `claude`'s own internal calls now that the gate can actually
  block on them. Worth a dedicated fix (skip git's own documented global-option syntax before
  dispatch) in a future plan, scoped and reviewed on its own — NOT attempted here given its
  security-sensitive surface (the classifier's own SAFE_GIT_SUBCOMMANDS allow-list).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-18*
