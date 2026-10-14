---
phase: 03-nothing-lost-nothing-left-running
plan: 04
subsystem: process-supervision
tags: [rust, git, backoff, path-shim, spawn-stagger]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-01's git.rs (git_at, the one Command::new(\"git\") site) and
      03-02's runtime_protocol.rs (runtime_dir) — this plan wraps the former and reuses the
      latter's on-disk-directory convention for the shim's own per-run install directory"
provides:
  - "core::git_retry — the single D-54 module: is_lock_contention (general lock-failure shape,
    not the literal index.lock string), with_lock_retry/RetryOutcome/LockExhausted,
    CollisionCounter, exhaustion_event_payload, SpawnFloor/wait_turn. git_at now retries a
    lock-shaped failure through it; the shim binary calls the exact same executor."
  - "packages/shim (flywheel-shim binary) + core::shim (resolve_shim_binary/resolve_real_git/
    install_for_run/shim_env_for_run) — D-51's PATH shim: every agent session's PATH now begins
    with a Flywheel-owned git that retries lock collisions and fails closed when misconfigured."
  - "SidecarHandle::send_spawn_request — the ONLY path a spawn request may take, enforcing D-52's
    per-repository spawn floor before ever writing to the sidecar's stdin."
affects: [03-07, 03-08, 03-12]

actuals:
  tokens: 14543
  tasks: 3
  commits: 3
plan_head_before: 639c807f2214cbeca335d6401a87cc4afcb785c3

tech-stack:
  added:
    - "packages/shim (flywheel-shim binary crate, new workspace member)"
  patterns:
    - "One shared backoff-and-retry module, called from two languages/binaries the same way:
      git_at (packages/core/src/git.rs) and the PATH shim binary (packages/shim/src/main.rs)
      both call core::git_retry::with_lock_retry — the workspace has exactly one sleep-and-retry
      loop for git, asserted by a source-scanning gate capping thread::sleep occurrences in
      packages/core/src at 2 (both inside git_retry.rs itself)."
    - "Fail-closed-by-construction dispatch: the shim binary reads argv[0] via an explicit match
      with an unknown-name arm that refuses to run anything, and resolves its target exactly once
      from an env var it never re-reads and never falls back from — no PATH lookup, no `which`,
      anywhere in that file."
    - "A real-world regression wording proved without ever appearing as a source-level literal:
      the #55724 error text is built via string concatenation in the test file specifically so
      the substring `index.lock` — the exact narrow match this matcher must NOT collapse to —
      never appears as a contiguous token in this crate's own source."

key-files:
  created:
    - packages/core/src/git_retry.rs
    - packages/core/src/shim.rs
    - packages/shim/Cargo.toml
    - packages/shim/src/main.rs
    - packages/core/tests/git_retry.rs
    - packages/core/tests/spawn_stagger.rs
  modified:
    - packages/core/src/git.rs
    - packages/core/src/lib.rs
    - Cargo.toml
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs

key-decisions:
  - "packages/shim/Cargo.toml depends on the core crate under the key `flywheel_core` (not the
    literal `core = { path = \"../core\" }` the plan's own action text names), mirroring
    packages/desktop/src-tauri/Cargo.toml's own documented fix for the identical collision: a
    dependency literally named `core` shadows the sysroot `core` crate in the extern prelude of
    the depending crate. Applied proactively from established in-repo precedent rather than
    discovered via a build failure."
  - "The shim's PATH/FLYWHEEL_REAL_GIT env additions are merged into a spawned session's
    environment from a NEW function (sidecar.rs's merge_shim_env_for_run), called after
    start_agent_run produces a real run_id — not folded into resolved_env_for_run itself, which
    intentionally runs BEFORE the run/worktree row is created (D-39, plan 02-09) so a credential
    failure never orphans a running row. The shim's install directory is keyed by run_id, which
    does not exist at that earlier point, so the two concerns cannot share one call site without
    either delaying credential resolution (regressing D-39) or predicting run ids before creation
    (out of scope). A shim-install failure still refuses the SPAWN itself, exactly as a credential
    failure does — though by this later point the row and worktree already exist, a narrower gap
    than a credential failure's, and one this plan's own text does not require closing."
  - "packages/shim/Cargo.toml adds a chrono dependency (not named in the plan's stated
    core/anyhow/serde_json triple) so the D-53 contention record's `at` field is RFC3339-formatted
    identically to every other on-disk timestamp this workspace writes (runtime_protocol.rs's
    started_at/killed_at) rather than inventing a second timestamp format for one JSON field."
  - "RETRY_MAX_ATTEMPTS=5 with a 200/400/800/1600ms curve sums to 3.0s of base delay before
    jitter (up to 480ms across 4 retries) — documented as ~3.48s worst case in git_retry.rs's own
    doc comment, the number the plan's own text names as what plan 03-12's session-feed retry row
    tells the user they are waiting for."

requirements-completed: [WORK-04, WORK-05]

coverage:
  - id: D1
    description: "Exactly one backoff-and-retry module in the workspace — git_at and the PATH
      shim binary both call the same with_lock_retry executor; no second sleep-and-retry loop
      exists anywhere in packages/core/src"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs (succeeds_first_try/two_collisions_then_success/
          a_non_lock_error/every_attempt_hitting_a_lock_error — 8 with_lock_retry tests)"
        status: pass
      - kind: other
        ref: "grep -rv '^\\s*//' packages/core/src | grep -c thread::sleep == 2 (both inside
          git_retry.rs); packages/shim/src/main.rs calls with_lock_retry, not a second loop"
        status: pass
    human_judgment: false
  - id: D2
    description: "is_lock_contention matches the general git lock-failure shape (config.lock,
      ref locks, the real #55724 wording, \"another git process\") and rejects an ordinary git
      error, never narrowed to the literal index.lock file name"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#matches_the_config_lock_wording_from_the_worktree_creation_collision"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#matches_the_real_55724_wording_without_the_literal_lock_file_name_appearing_in_this_source"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#does_not_match_an_unknown_revision_error"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/core/src/git_retry.rs | grep -c index.lock == 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "A retried git invocation that already succeeded is never re-executed — the
      retry loop stops at the first success"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#succeeds_first_try_invokes_the_closure_exactly_once_and_records_zero_collisions"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#two_collisions_then_success_invokes_the_closure_exactly_three_times"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every agent session is spawned with a Flywheel-owned PATH entry protecting the
      agent's OWN git invocations, not merely Flywheel's own git_at calls"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs shim module (install_for_run/shim_env_for_run
          round trip); sidecar.rs::merge_shim_env_for_run merges those entries after run.id
          exists, propagating an install failure as a refused spawn"
        status: pass
    human_judgment: true
    rationale: "No live Tauri app with a real spawned agent session was available to this
      executor — this plan proves shim_env_for_run/merge_shim_env_for_run produce and merge the
      correct entries, but not that a REAL spawned claude session's own git invocations actually
      resolve through the installed shim end to end. Plan 03-08's stress harness is the first
      point in this phase that exercises a real spawned process under this wiring."
  - id: D5
    description: "The shim resolves the real binary from an absolute path supplied once
      (FLYWHEEL_REAL_GIT) and never re-resolves through PATH; a missing/non-absolute/dangling
      value fails closed with an explanation naming the variable, without executing anything"
    requirement: "WORK-04"
    verification:
      - kind: integration
        ref: "packages/core/tests/git_retry.rs#shim::the_built_shim_exits_non_zero_and_names_the_variable_when_flywheel_real_git_is_unset"
        status: pass
      - kind: integration
        ref: "packages/core/tests/git_retry.rs#shim::the_built_shim_forwards_git_version_and_matches_real_gits_own_output"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/shim/src/main.rs | grep -cE 'Command::new(\"which\")|var_os(\"PATH\")|var(\"PATH\")' == 0"
        status: pass
    human_judgment: false
  - id: D6
    description: "The supervisor will not begin two spawns against the same repository closer
      together than a fixed floor — a real guarantee asserted by a test, not an observed
      tendency — and no ungated spawn path survives in the command layer"
    requirement: "WORK-05"
    verification:
      - kind: unit
        ref: "packages/core/tests/spawn_stagger.rs#same_repository_pair_is_staggered_while_a_different_repository_is_not"
        status: pass
      - kind: other
        ref: "packages/core/tests/spawn_stagger.rs#agent_run_rs_contains_no_bare_send_request_call_and_at_least_one_gated_spawn_call"
        status: pass
      - kind: other
        ref: "grep -v '^\\s*//' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -c '\\.send_request(' == 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "A retry sequence that succeeds writes no event and no row; the D-53 exhaustion
      payload's label string matches the Copywriting Contract sentence character for character"
    requirement: "WORK-04"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#exhaustion_event_payload_label_matches_the_copywriting_contract_sentence_exactly"
        status: pass
    human_judgment: false
  - id: D8
    description: "The whole workspace still builds and every pre-existing test still passes with
      the new shim crate as a real workspace member"
    verification:
      - kind: other
        ref: "cargo build --workspace; cargo test --workspace (full suite, 0 failures)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-09-15
status: complete
---

# Phase 3 Plan 4: One Backoff Policy, One Lock Matcher, One Spawn Floor Summary

**`git_retry.rs`'s single D-54 backoff/retry policy now protects both `git_at` and every agent's OWN `git` invocations via a new `packages/shim` PATH binary, and `SidecarHandle::send_spawn_request` makes D-52's per-repository spawn floor the only path a spawn request can take.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-09-15T02:24:00Z
- **Completed:** 2026-09-15T02:58:54Z
- **Tasks:** 3
- **Files modified:** 12

## Accomplishments

- `packages/core/src/git_retry.rs` — D-54's single module: `is_lock_contention` (the general git
  lock-failure shape, never the literal `index.lock` string), `with_lock_retry`/`RetryOutcome`/
  `LockExhausted`, `CollisionCounter`, `exhaustion_event_payload`, `SpawnFloor`/`wait_turn` — every
  tunable a named `pub const` with a doc-comment-stated tradeoff
- `git_at` (`packages/core/src/git.rs`) now retries a lock-shaped failure through
  `with_lock_retry`, keeping the ONE `Command::new("git")` construction exactly where it was —
  `supervisor_cwd.rs`'s structural gate still passes unchanged
- `packages/shim` (new workspace member, `flywheel-shim` binary) + `core::shim` — the PATH shim:
  dispatches on `argv[0]` via an explicit `match` (unknown names fail closed), resolves the real
  git binary exactly once from `FLYWHEEL_REAL_GIT` (never `PATH`, never `which`), retries lock
  failures through the same `with_lock_retry` executor `git_at` uses, and appends a D-53
  contention record to `<runtime>/contention/<run_id>.jsonl` on exhaustion — the only file it ever
  writes
- `SidecarHandle::send_spawn_request` — the ONLY path a spawn request may take, calling
  `SpawnFloor::wait_turn(repo_path)` before ever writing to the sidecar's stdin; `agent_run_start`
  now reads `repo_path` in the same `query_row` as `project_id` and routes through it instead of
  the bare `send_request`, proved by a source-scanning test reading the real command file from disk

## Task Commits

Each task was committed atomically:

1. **Task 1: One backoff policy, one lock matcher, one spawn floor** - `1832554` (feat)
2. **Task 2: The PATH shim binary, and the per-session directory that puts it in front of git** - `1b93de1` (feat)
3. **Task 3: The supervisor will not start two spawns against one repository too close together** - `5a8762d` (feat)

**Plan metadata:** committed alongside this SUMMARY (see final commit).

_Note: All three tasks carry `tdd="true"`, but this project's `workflow.tdd_mode` is not enabled
(absent from `.planning/config.json`), so gate enforcement (RED-evidence checks,
`test(...)`-then-`feat(...)` commit splitting) was not mandatory. Tests and implementation were
authored together and verified green before a single commit per task, matching the
"TDD-flavored, not strict TDD-gated" pattern plans 03-01/03-02/03-03 already established for this
phase._

## Files Created/Modified

- `packages/core/src/git_retry.rs` - the single D-54 backoff/retry/spawn-floor module
- `packages/core/src/git.rs` - `git_at` routes through `with_lock_retry`
- `packages/core/src/lib.rs` - declares `git_retry` and `shim`
- `packages/core/src/shim.rs` - supervisor-side shim resolution/install/env helpers
- `packages/shim/Cargo.toml`, `packages/shim/src/main.rs` - the new `flywheel-shim` binary crate
- `Cargo.toml` - adds `packages/shim` to the workspace members
- `packages/desktop/src-tauri/src/sidecar.rs` - `merge_shim_env_for_run`, `SidecarHandle::spawn_floor`/`send_spawn_request`
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - reads `repo_path` alongside `project_id`, calls `merge_shim_env_for_run` and `send_spawn_request`
- `packages/core/tests/git_retry.rs` - 19 tests (policy, matcher, counter, shim install/resolution, fail-closed branches)
- `packages/core/tests/spawn_stagger.rs` - 5 tests (floor timing + the no-bypass structural gate)

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/shim/Cargo.toml` depends on `core` under the aliased key `flywheel_core`, not the literal name the plan's action text used**
- **Found during:** Task 2, before writing `Cargo.toml` — anticipated from `packages/desktop/src-tauri/Cargo.toml`'s own documented comment about the identical collision, rather than discovered via a build failure
- **Issue:** The plan's `<action>` text says the shim crate "depends on `core = { path = "../core" }`". A dependency literally named `core` shadows the sysroot `core` crate in the extern prelude of the depending crate — `packages/desktop/src-tauri/Cargo.toml` already carries a multi-line comment documenting exactly this failure mode (verified there via `E0433 "cannot find 'option' in 'core'"`) and its fix (alias the dependency key to `flywheel_core`).
- **Fix:** `packages/shim/Cargo.toml` declares `flywheel_core = { path = "../core", package = "core" }`, and `packages/shim/src/main.rs` references `flywheel_core::` throughout, matching the desktop crate's own established convention.
- **Files modified:** packages/shim/Cargo.toml, packages/shim/src/main.rs
- **Verification:** `cargo build --workspace` succeeds
- **Committed in:** `1b93de1` (Task 2 commit)

**2. [Rule 1 - Bug] The shim's env merge could not live inside `resolved_env_for_run` without regressing D-39**
- **Found during:** Task 2, wiring `shim_env_for_run` into `sidecar.rs`
- **Issue:** The plan's `<action>` text says to "extend `resolved_env_for_run` ... to merge `shim_env_for_run`'s entries." `resolved_env_for_run` is called BEFORE `start_agent_run` (plan 02-09's D-39 fix, `agent_run_start`'s own comment), precisely so a credential-resolution failure never orphans a running `agent_runs` row. `shim_env_for_run` requires a `run_id`, which does not exist until `start_agent_run` creates the row — the two cannot share that one call site without either delaying credential resolution (regressing D-39) or predicting run ids before creation (out of this plan's scope).
- **Fix:** Added a separate `sidecar.rs::merge_shim_env_for_run(&mut env, run_id)`, called immediately after `run.id`/`worktree_path` become available (the same point `agent_run_start` already fetches `worktree_path` post-creation), merging the shim's `PATH`/`FLYWHEEL_REAL_GIT` entries into the already-resolved `env` map. A shim-install failure here still refuses the spawn.
- **Files modified:** packages/desktop/src-tauri/src/sidecar.rs, packages/desktop/src-tauri/src/commands/agent_run.rs
- **Verification:** `cargo test --workspace` full suite green (desktop's 20 unit tests unaffected); `agent_run_start`'s pre-existing D-39 ordering (credential resolution before `start_agent_run`) is byte-unchanged
- **Committed in:** `1b93de1` (Task 2 commit)

**3. [Rule 2 - Missing Critical] `packages/shim/Cargo.toml` needed a `chrono` dependency the plan's stated triple didn't name**
- **Found during:** Task 2, writing the D-53 contention record's JSON shape
- **Issue:** The plan's own JSON shape for the contention record names an `"at":…` field; every other on-disk timestamp this workspace writes (`runtime_protocol.rs`'s `started_at`/`killed_at`) is RFC3339 via `chrono::Utc::now().to_rfc3339()`. Omitting a proper timestamp format here (or inventing a second one, e.g. a bare Unix epoch integer) would create the exact kind of drift D-54's own "one policy" instinct argues against for a sibling on-disk protocol.
- **Fix:** Added `chrono` (matching `packages/core/Cargo.toml`'s own `default-features = false, features = ["clock"]` shape) to `packages/shim/Cargo.toml`.
- **Files modified:** packages/shim/Cargo.toml, packages/shim/src/main.rs
- **Verification:** `cargo build --workspace` succeeds; the contention-record JSON's `at` field parses as RFC3339
- **Committed in:** `1b93de1` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 anticipated-from-precedent blocking fix, 1 bug in the plan's own literal call-site instruction, 1 missing-critical consistency addition)
**Impact on plan:** All three were necessary for the code to compile and for the new on-disk shape to stay consistent with the rest of the codebase. No scope creep — every fix lives in a file this plan already creates or touches, and none contradicts any of the plan's own `<acceptance_criteria>` or `<verify>` gates (all of which pass unchanged).

## Issues Encountered

None beyond the three documented above as deviations — all three were anticipated or caught during
implementation, not discovered as regressions after the fact.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `git_retry::with_lock_retry`/`is_lock_contention`/`SpawnFloor` are ready for plan 03-07 (the
  destructive-action gate's backstop, reusing the same shim binary via a second `argv[0]` dispatch
  arm) and plan 03-08 (the stress-test harness driving ten concurrent commits into worktrees this
  shim now protects).
- `exhaustion_event_payload`'s exact Copywriting Contract string is ready for plan 03-12's session-
  feed retry row to render verbatim, and for whichever call site eventually appends a real
  `events` row on `LockExhausted` (this plan builds the payload producer and the typed error;
  wiring an actual `append_event` call at a `git_at`/domain-layer catch site for D-53's
  board-visible event is NOT done in this plan — no task in 03-04-PLAN.md's own scope names that
  wiring, and no `<acceptance_criteria>` requires it).
- D4's live end-to-end proof (a real spawned `claude` session's own `git commit` actually resolving
  through the installed shim) is the one deliverable this plan could not verify directly — carried
  forward to plan 03-08's stress harness, which is the first point in this phase that exercises a
  real spawned process under this wiring.
- No blockers for the next plan in this phase.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-15*

## Self-Check: PASSED

- All 6 created files verified present on disk (`packages/core/src/git_retry.rs`,
  `packages/core/src/shim.rs`, `packages/shim/Cargo.toml`, `packages/shim/src/main.rs`,
  `packages/core/tests/git_retry.rs`, `packages/core/tests/spawn_stagger.rs`).
- All 3 task commits (`1832554`, `1b93de1`, `5a8762d`) found in `git log --oneline --all`.
- Re-ran every plan-level `<verification>` command after all three tasks: `cargo test -p core
  --test git_retry` (19 passed), `cargo test -p core --test spawn_stagger` (5 passed),
  `cargo test -p core --test supervisor_cwd` (5 passed), `cargo build --workspace` (clean),
  `cargo test --workspace` (42 test-result blocks, all `ok`, zero `FAILED`).
- Re-ran every task's `<acceptance_criteria>` shell checks; all passed as documented inline above.
