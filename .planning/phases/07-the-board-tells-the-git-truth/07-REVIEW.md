---
phase: 07-the-board-tells-the-git-truth
round: gap-closure (commits 80e56f5..5fde7d7)
reviewed: 2026-10-05T08:12:31Z
status: issues_found
scope:
  base: 43fe23e
  head: 87f1a3f
  commits_reviewed:
    - 80e56f5
    - 99abb90
    - 454abf6
    - b7545f4
    - fd9bbda
    - af4328a
    - 5fde7d7
files_reviewed:
  - packages/core/src/proc.rs
  - packages/core/src/forge/mod.rs
  - packages/core/src/forge/github.rs
  - packages/core/src/forge/gitlab.rs
  - packages/core/src/git.rs
  - packages/core/src/git_facts.rs
  - packages/core/src/lib.rs
  - packages/core/tests/bin/forge_probe.rs
  - packages/core/tests/forge_degrade.rs
  - packages/core/tests/forge_live_chain.rs
  - packages/core/tests/status_transitions.rs
  - packages/core/tests/subprocess_timeout.rs
  - packages/desktop/src-tauri/src/commands/forge.rs
  - packages/desktop/src-tauri/src/scheduler.rs
findings:
  blocker: 1
  high: 2
  medium: 2
  low: 1
  total: 6
---

# Phase 07 gap-closure round — Code Review

**Reviewed:** 2026-10-05T08:12:31Z
**Diff:** `43fe23e..87f1a3f` (`packages/` only)
**Status:** issues_found

## Summary

This round's stated goal — bound every `gh`/`glab`/`git` wait with `proc::output_with_timeout`
and restructure the four lock-holding call sites into resolve → dispatch → write phases — is
*mostly* delivered and the timeout guard itself (`proc.rs`) is well built: it correctly closes
stdin, drains stdout/stderr off dedicated threads so a large write can't deadlock it, kills and
reaps only the pid it itself spawned, and never leaks the child's captured output into its error
message. The new `forge_live_chain.rs` harness is real: it drives the production
`create_request_at`/`request_for_branch_at` path through actual child processes with only the
forge binary substituted, and it fails loudly (via `.expect()` panics, not silent success) if the
PATH substitution doesn't take.

However, the resolve/dispatch/write split that plan 07-11 introduces to let the DB mutex be
released during the network call has a real, newly-introduced race: because the lock is now
released and *re-acquired* around the forge tick's network phase, a manual board move that lands
in that window can be silently overwritten by a stale-relative-to-the-user forge observation —
precisely the failure mode D-121/LINK-10 are documented as structurally forbidding. That did not
reproduce in the pre-07-11 code because the old single-phase tick held the lock for the whole
operation, which serialized any concurrent manual write strictly before or after the tick. This is
the round's one BLOCKER. Two HIGH findings follow from the same restructuring: the claimed
"[`forge_and_repo_path`] spawns nothing" invariant is false whenever a project has no stored forge
override, and under a sustained forge/network outage the timeout guard's deliberate
abandon-the-reader-threads design leaks OS threads indefinitely rather than converting a freeze
into a bounded failure.

## Blocker Issues

### BL-01: Releasing the DB lock around the forge tick's network phase lets a manual board move be silently overwritten by a stale observation

**File:** `packages/desktop/src-tauri/src/scheduler.rs:422-463` (`run_forge_tick`, composing
`forge_tick_targets` at :323, `poll_forge_targets` at :369, `apply_forge_results` at :395), writing
through `packages/core/src/forge/transitions.rs:99-236` (`apply_forge_observation`)

**Issue:** Plan 07-11's restructuring deliberately releases `AppState.db` between reading the
forge tick's work list and running the network poll, then re-acquires it only to write
(`scheduler.rs:431` acquire → compute targets → drop; `:445` poll with no lock at all; `:456-461`
re-acquire → `apply_forge_results`). This is correct for its stated purpose (unblocking the UI
during a slow `gh`/`glab` call), but it removes a guarantee the *old* code provided for free: in
the pre-07-11 single-phase tick, the lock was held continuously from reading the worktree list
through writing the status change, so any other Tauri command that also needed the lock (e.g. a
manual board-column drag) was forced to wait until the tick fully finished — serializing the
manual write strictly *before* or *after* the tick's own write, never interleaved with it.

With the lock released mid-tick, a manual status change can now land in the window between the
network poll completing (whose result reflects the forge state as of the moment it was observed)
and `apply_forge_results` re-acquiring the lock to write. `apply_forge_observation`'s decision is
driven by `latest_forge_baseline` (read fresh from the `events` log at write time) compared
against `observed_state` (captured once, in the lock-free window) — neither of these two inputs
is affected by an intervening manual status write, because a manual move writes only a
`task.status_changed` event, never a forge-kind event. So when the observation implies a forward
transition (most importantly, the one into the terminal `Merged`/`done` state), the code reads the
task's *current* status fresh inside the same transaction and unconditionally overwrites it with
`"done"` even if a human just moved the card to `"backlog"` moments earlier — because
`set_task_status_in_tx` (`packages/core/src/domain/task.rs:446-485`) only special-cases the
current value being *equal* to the new value, never "changed by someone else since this
observation was captured."

**Concrete failure scenario:**
1. Task T is `in_review` with forge baseline `Open`.
2. `run_forge_tick` acquires the lock, resolves T's poll target, releases the lock
   (`scheduler.rs:431-440`).
3. `poll_forge_targets` calls `gh pr list` for T's branch with no lock held
   (`scheduler.rs:369-388`); the PR has in fact been merged on GitHub, so this call — once it
   returns, a few seconds later over a normal network — will report `Merged`.
4. While that call is in flight, the user drags T back to `backlog` in the Flywheel board (a
   deliberate, in-app action, fully unrelated to the forge). This Tauri command acquires the lock
   (now free), writes `status = "backlog"`, and releases it — succeeding well inside the poll's
   round-trip.
5. The poll returns `Merged`. `apply_forge_results` re-acquires the lock and calls
   `apply_forge_observation`: baseline is still `Open` (unaffected by step 4's status-only event),
   `observed_state` is `Merged`, so the detector fires, writes `forge.state_changed`, and calls
   `set_task_status_in_tx(tx, actor_id, task_id, "done")`. The current status read inside that
   same transaction is `"backlog"` (step 4's write) — different from `"done"` — so it is
   unconditionally overwritten to `"done"`.
6. The user's manual move is gone with no error, no conflict signal, and no event explaining why
   the card is back in Done. `forge/transitions.rs`'s own module header states this detector is
   "structurally incapable of overwriting a manual move in a loop" — this restructuring breaks
   that property for any manual write that lands inside the now-exposed lock-release window.

This is not theoretical window-chasing: `FORGE_POLL_SECS` is 120 seconds
(`packages/core/src/git_facts.rs:41`) and a real `gh pr list` round-trip over a normal network
(not even a hang) routinely takes one to several seconds, which is ample time for a user to
interact with the board. The same class of race applies to CI-failure events and to the
`in_review` transition, not only the merged/terminal case, but the terminal case is the most
damaging because D-121 makes it unrecoverable (nothing ever moves a `Merged`-baseline task again).

**Fix:** Re-validate the task's current status inside `apply_forge_observation`'s transaction
before writing, or carry a version/expected-status token from `forge_tick_targets` through to
`apply_forge_results` and treat a mismatch as "skip this result, a human has already moved this
card" rather than overwriting it. A minimal fix: have `apply_forge_observation` read the task's
current `status` alongside `project_id`/`epic_id` (it already reads the row at
`transitions.rs:110-116`) and skip the `set_task_status_in_tx` call (while still recording the
`forge.state_changed` event, so the observation isn't lost) whenever the current status does not
match the status the detector's own prior logic expects to be transitioning *from* — i.e. only
write the status column when the board hasn't moved out from under the observation since the
poll began.

## High Issues

### HI-01: `forge_and_repo_path`'s "spawns nothing" invariant is false, and the DB lock is held across the resulting `git` spawn in three call sites

**File:** `packages/core/src/forge/mod.rs:146-173` (`forge_and_repo_path`, doc comment at
:146-150 and module header at :19-23), called under lock at:
- `packages/desktop/src-tauri/src/commands/forge.rs:124` (`forge_request_for_task`, `drop(conn)`
  only at :130, *after* this call)
- `packages/desktop/src-tauri/src/commands/forge.rs:232` (`forge_open_request`, `drop(conn)` only
  at :233, *after* this call)
- `packages/desktop/src-tauri/src/scheduler.rs:338` (`forge_tick_targets`, called from
  `run_forge_tick` while `conn` is still locked at :431)

**Issue:** The module header (`forge/mod.rs:19-23`) states as the round's core invariant: "A
database lock must never be alive while a forge CLI runs... `forge_and_repo_path` takes a
`&Connection` and spawns nothing." The function's own doc comment repeats "spawns nothing."
Both are false whenever a project has no stored `forge` override: `forge_and_repo_path`
(`mod.rs:168-172`) falls through to `detect_forge_from_origin(&repo_path)` on `None`, which
(`mod.rs:129-141`) calls `crate::git::git_at(repo_path, ["remote", "get-url", "origin"])` —
`git_at` spawns `git` (via `spawn_git`, now bounded by `GIT_TIMEOUT_SECS = 120`, but still a real
subprocess spawn). All three call sites invoke `forge_and_repo_path` while the connection guard
returned by `state.db.lock()` is still in scope and not yet dropped, so the global
`AppState.db` mutex is held across this subprocess for every project that has never had its forge
explicitly set (i.e. every project relying on auto-detection from its origin remote — plausibly
the common case, not an edge case).

This is a reduced-severity version of the exact bug this whole round exists to fix: it is bounded
by `GIT_TIMEOUT_SECS` (120s) rather than unbounded, and it is a local config read (`git remote
get-url origin`) rather than a real network round-trip, so it is much less likely to hang for long
— but "much less likely" is not "cannot," on a slow/contended filesystem (a repo on a network
mount, a `.git/config` read stalling behind disk I/O), and worst case it still freezes every other
Tauri command behind the same mutex for up to two minutes, which is the user-visible symptom this
round was supposed to eliminate everywhere.

It is also measurably worse than the doc comment on `forge_tick_targets` claims: "several
worktrees in the same project cost one resolution, not one per worktree" (`scheduler.rs:320-322`)
is true only on the success path. On failure, `forge_tick_targets`'s memoization map
(`scheduler.rs:332-355`) only inserts on `Ok` (:340); a project whose `forge_and_repo_path` call
errors is never cached, so *every* tracked worktree belonging to that project re-attempts the
full resolution (database query + potential `git` spawn) from scratch, each one under the same
held lock. A project with many active worktrees and a resolution that reliably fails (or hangs)
would hold the mutex for up to `worktree_count × 120s` in the worst case, in a single tick.

**Fix:** Either (a) fix the doc comments to state the true, narrower invariant ("spawns a
`git` process only when no override is stored; never a network call"), or (b) finish the
intended invariant for real by moving the `None`-branch detection out from under the lock — have
callers resolve the *stored* override under the lock, and if it's absent, release the lock before
calling `detect_forge_from_origin`. Separately, cache resolution failures (not only successes) in
`forge_tick_targets`'s `resolved` map (e.g. `HashMap<String, Result<(Forge, PathBuf), String>>`)
so a failing project costs exactly one resolution attempt per tick, matching what the doc comment
already claims.

### HI-02: `output_with_timeout`'s abandoned reader threads leak indefinitely under a sustained hang, converting the original freeze into a slow thread/FD leak in exactly the scenario this round targets

**File:** `packages/core/src/proc.rs:108-131` (the `None` / timeout branch of `output_with_timeout`)

**Issue:** On timeout, the function deliberately drops the `stdout_thread`/`stderr_thread`/
`stdin_thread` `JoinHandle`s without joining them (:125-127), with the stated rationale that a
surviving grandchild process may hold the pipe open and joining would re-introduce the unbounded
wait this function exists to remove. That rationale is sound for *isolated* hangs — but dropping a
`JoinHandle` does not stop the thread; it detaches it, and the detached thread keeps blocking in
`read_to_end` until every copy of the pipe's write end closes, which may be never if the surviving
descendant is long-lived (e.g. a stuck `ssh` transport, a credential-helper subprocess, a `D`-state
process wedged on slow I/O).

The scenario this whole round was built to survive — a forge/network outage that makes `gh`/`glab`
hang — is precisely the scenario that triggers this leak repeatedly and without bound: the
scheduler's forge tick runs every `FORGE_POLL_SECS` (120 seconds, `git_facts.rs:41`) and the
fetch tick every `FETCH_INTERVAL_SECS` (300 seconds, `git_facts.rs:36`); if the outage persists,
every tick that touches an affected worktree/project times out and abandons two (or three, with
stdin) threads that may never exit. Over a sustained outage lasting hours, this leaks a steadily
growing number of OS threads (and the file descriptors they hold open) rather than failing
cleanly — eventually risking thread-creation failure (a hard crash) instead of the bounded,
recoverable "this call timed out, try again next tick" behavior the rest of the design achieves.
In other words: under the single most important failure mode this round targets, the fix degrades
from "the app freezes until you notice" to "the app slowly leaks resources until it crashes,"
which is a worse failure mode to debug in production because its symptoms are delayed and
non-obvious.

**Fix:** At minimum, cap the number of outstanding abandoned reader threads (e.g. a counter/
semaphore that refuses new spawns — or surfaces a loud warning — once some fixed number of prior
timeouts are still unresolved), so a sustained outage degrades into a visible, bounded error state
rather than an invisible, unbounded one. A more complete fix puts the direct child in its own
process group (`setsid`/`setpgid` via `pre_exec`, consistent with the "kill the whole tree"
guidance in this project's own architecture notes) and kills the group, not just the direct pid,
on timeout — then the reader threads really can be joined promptly because nothing is left alive
to keep the pipe's write end open.

## Medium Issues

### MED-01: Narrow kill/exit race can misreport a child that finished at the timeout boundary as `TimedOut` rather than its real result

**File:** `packages/core/src/proc.rs:91-106` (the deadline loop) and :108-131 (the kill branch)

**Issue:** The deadline loop breaks to the kill branch as soon as `try_wait()` returns `None` and
`start.elapsed() >= timeout` (:95-99). There is no final `try_wait()` immediately before
`child.kill()` (:123). If the child happens to exit — successfully or not — in the (very small)
window between the loop's last `try_wait()` and the `kill()` call, this function still calls
`child.kill()`/`child.wait()` and unconditionally returns `Err(TimedOut)` (:128-130), discarding
the child's real exit status and output. For a call site like `fetch_origin` or a forge poll that
completed its real work right at the ceiling, this misreports a legitimate success (or a
legitimate, informative failure) as an opaque timeout, which then propagates as "forge read
failed... skipping this worktree without applying an observation" rather than the actual result.

**Fix:** Call `child.try_wait()` once more immediately before `child.kill()`; if it now reports
`Some(status)`, take the `Some` branch (join stdin/stdout/stderr and return the real `Output`)
instead of falling into the timeout path.

### MED-02: The restructured scheduler forge tick (the code path BL-01 lives in) has zero test coverage

**File:** `packages/desktop/src-tauri/src/scheduler.rs:323-463`; absent from
`packages/core/tests/forge_live_chain.rs` and everywhere else

**Issue:** `forge_live_chain.rs` (07-12) is a genuine, real-child-process test of
`core::forge::create_request_at`/`request_for_branch_at` and `core::forge::transitions::
apply_forge_observation` — but it calls those functions directly, never through
`scheduler::run_forge_tick`/`forge_tick_targets`/`poll_forge_targets`/`apply_forge_results`, and
there is no test anywhere under `packages/desktop/src-tauri` (no `tests/` directory exists for
that crate at all). The specific three-phase restructuring that plan 07-11 introduces in
`scheduler.rs` — the exact code BL-01 and the failure-path half of HI-01 live in — is therefore
unverified by any automated test in this round; both of those findings were found by inspection
only.

**Fix:** Add integration coverage for the scheduler's `forge_tick_targets`/`poll_forge_targets`/
`apply_forge_results` composition (even a synchronous unit-style test calling the three functions
directly against a seeded DB + fake CLI, without needing a running Tauri app), including a
regression test for BL-01's manual-move-during-poll race once fixed.

## Low Issues

### LOW-01: Several `forge_live_chain.rs` tests don't assert `fake.invoked()`, unlike `assert_open_to_merged_chain`

**File:** `packages/core/tests/forge_live_chain.rs:994-1158` (e.g.
`github_branch_with_no_request_yields_no_request_and_no_transition`,
`github_request_with_no_ci_run_normalises_to_no_ci_result`,
`gitlab_request_with_no_head_pipeline_normalises_to_no_ci_result`, and others)

**Issue:** `assert_open_to_merged_chain` (the shared helper both "full chain" tests call) asserts
`fake.invoked()` before trusting any result (:929-933), explicitly to catch a failed PATH
substitution rather than silently exercising a real `gh`/`glab` on the developer's machine. Several
of the standalone tests exercise `request_for_branch_at` directly and assert on its result without
that same guard. In practice a real `gh`/`glab` run against the scratch repo these tests seed
(no real forge-side PR, explicit `forge` override forcing a CLI call) would very likely fail loudly
on its own (no repo context / not authenticated) and still fail the test via the `.expect(...)`
calls — so this is unlikely to produce a false pass — but it is an inconsistency in how rigorously
the "never silently trust a real CLI" guarantee is enforced across this file's own tests.

**Fix:** Add `assert!(fake.invoked(), ...)` to the remaining standalone tests for consistency with
`assert_open_to_merged_chain`'s own stated safety rationale.

## What's sound

- `proc::output_with_timeout`'s happy path is correct and well tested: stdin is closed (not
  inherited) when absent, draining stdout/stderr on dedicated threads genuinely prevents a
  pipe-buffer deadlock (proven by `subprocess_timeout.rs`'s `child_output_larger_than_pipe_buffer_
  still_completes`), and the timeout error message never echoes captured stdout/stderr.
- The kill-then-wait sequence only ever signals the pid this function itself spawned (`std::process
  ::Child::kill`'s own internal exited-status guard prevents a killed/recycled-pid mixup); a direct
  child that exits normally is correctly distinguished from one that's killed (`Ok(Output{status,..
  })` vs `Err(TimedOut)`), outside the narrow race in MED-01.
- `git_retry::with_lock_retry` correctly treats a `TimedOut` error as a non-lock failure and returns
  it after exactly one attempt, as both modules' doc comments claim — confirmed by reading
  `is_lock_contention`'s `.lock`-substring gate against the timeout message's actual text.
  `spawn_gh`/`spawn_glab`/`spawn_git` remain the sole `Command::new(...)` construction sites for
  their respective binaries (grep-verified across the workspace).
  `fetch_tick_targets`/`fetch_origin_for_targets` are a clean, fully correct application of the
  resolve-under-lock/dispatch-lock-free split — the fetch tick writes nothing to the database, so
  it has no re-acquire-and-write phase and therefore no equivalent of BL-01.
- `forge_live_chain.rs` genuinely drives real child processes through the production dispatch
  functions and would fail (not silently pass) if the resolve/dispatch split regressed back to
  taking a `Connection`, since `create_request_at`/`request_for_branch_at`'s signatures no longer
  accept one at all — the compiler-enforced half of the 07-11 invariant is real.
- `status_transitions.rs`'s new `applying_an_observation_for_a_deleted_task_writes_nothing_and_
  errors` test correctly proves the deleted-task-mid-window case is a hard error with zero partial
  writes (verified by reading `apply_forge_observation`'s transactional structure: `tx.query_row`
  on the `tasks` table fails before any event is appended, and the transaction never commits).

---

_Reviewed: 2026-10-05T08:12:31Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep (cross-file, call-chain trace against the restructured lock/spawn boundary)_
