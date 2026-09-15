---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-15T09:29:30Z
depth: standard
files_reviewed: 75
findings:
  critical: 9
  warning: 14
  info: 4
  total: 27
status: issues_found
parts:
  - 03-REVIEW-part-core.md
  - 03-REVIEW-part-tauri.md
  - 03-REVIEW-part-frontend.md
  - 03-REVIEW-part-sidecar.md
---

# Phase 03 Code Review — Nothing Lost, Nothing Left Running

Scope was 75 changed source files (~330k tokens), too large for a single reviewer context, so the review was split into four subsystem passes that together cover every file in scope. This document is the merged report; each part file is retained alongside it.

| Severity | Count |
|---|---|
| Critical | 9 |
| Warning | 14 |
| Info | 4 |
| **Total** | **27** |

---

# Part: Rust core (`packages/core`)

# Phase 03: Code Review Report (Part 1 of 4 — Rust core crate)

**Reviewed:** 2026-09-15T09:27:25Z
**Depth:** standard
**Files Reviewed:** 31
**Status:** issues_found

## Summary

This part reviews `packages/core`, the Rust crate that owns the SQLite database, the destructive-
command classifier, the on-disk runtime protocol (heartbeat/kill-record/run-descriptor), the git
wrapper, and the PATH-shim installer. The migrations, domain transaction discipline (one
`conn.transaction()`, row write + event append, one commit), pid-reuse-safe liveness check
(`process_is_alive`'s millisecond/second unit reconciliation), worktree dirty-tree guard
(`remove_worktree_for_task`'s unconditional re-read of `git status --porcelain`, no force/override
parameter anywhere in the call chain), and the migration-rebuild-with-FK-recheck logic in
`db::open_and_migrate` are all careful, well-tested, and match their extensive doc comments.

However, one genuine security-relevant gap was found in the destructive-action classifier
(`destructive.rs`): a `git push` that deletes a non-default remote branch is classified `Safe` and
never raises a permission request, directly contradicting D-56's fail-closed design and the whole
point of this classifier. Four further warnings cover an inaccurate audit-log field, a bypassed
lock-retry path, a cleanup function that gives up early and whose failures are invisible to every
caller, and a kill-record trust path that never independently confirms the process actually died
before deleting the only durable record of it.

## Critical Issues

### CR-01: `git push --delete`/`-d`/colon-refspec deletion of a non-default remote branch is classified `Safe`, bypassing the destructive-action gate entirely

**File:** `packages/core/src/destructive.rs:186-223` (`classify_push`)
**Issue:**

`classify_push` only ever inspects an invocation for two things: whether a `--force`/`-f`/
`--force-with-lease` flag is present, and whether any positional refspec's *destination* names the
project's default branch (`refspec_targets_branch`). It has no handling at all for git's remote
branch-deletion syntax:

- `git push origin --delete feature-branch`
- `git push origin -d feature-branch`
- `git push origin :feature-branch` (empty-source colon refspec)

For all three forms, `--delete`/`-d` is silently dropped (checked only against `"force"`/
`"force-with-lease"` in the `--`-prefixed branch, and only against `"-f"` in the short-flag branch —
never recognised, never treated as a signal), and the branch name being deleted is compared only
against the project's own *default* branch. When the branch being deleted is anything other than
the default branch (someone else's feature branch, a release branch, a CI-relied-upon ref), none of
`classify_push`'s checks fire, `force` stays `false`, `targets_default` stays `false`, and the
function falls through to its own final line: `Verdict::Safe`.

This is a genuine remote branch deletion — functionally equivalent in destructiveness to `git
branch -D` (already correctly caught by `classify_branch` as `BranchDeletion`), except it deletes
the ref on the *remote*, potentially destroying another developer's or CI's only copy of that
history. It is exactly the class of operation D-56 and this module's own doc comment exist to
catch: "Every `match` that decides a verdict for a subcommand with a destructive form ends in a
default arm returning `Verdict::Destructive`... `Safe` is returned ONLY from an explicit, named,
recognised-harmless invocation shape." `classify_push`'s own internal fallthrough violates that
rule: it defaults to `Safe` for any push shape it does not specifically recognise as force or
default-branch-targeting, rather than defaulting to `Uncategorized` the way the outer
`classify_git` dispatcher does.

(Deleting the *default* branch specifically is still caught, because `refspec_targets_branch`
treats a colon-refspec's destination — including an empty-source delete refspec — as "targeting"
that branch regardless of whether content is being pushed or the ref is being removed, and
`git push origin --delete main`'s positional `"main"` also happens to equal the default branch
name. The gap is specifically non-default branches.)

No test in `packages/core/tests/destructive_classifier.rs` exercises `--delete`, `-d`, or a
colon-refspec deletion on `push` at all — this is an untested code path, not just an unhandled one.

**Fix:** Detect a delete-shaped push explicitly (a `--delete`/`-d` flag, or a positional refspec
whose *source* half is empty, e.g. `:branch`) and classify it as `DestructiveCategory::BranchDeletion`
(or a new dedicated category) regardless of which branch is named — mirroring `classify_branch`'s
own unconditional `-d`/`-D`/`--delete` detection:

```rust
fn classify_push(rest: &[String], default_branch: Option<&str>) -> Verdict {
    let mut force = false;
    let mut delete = false;
    let mut positional: Vec<&str> = Vec::new();
    let mut iter = rest.iter();
    while let Some(arg) = iter.next() {
        if arg == "--" {
            positional.extend(iter.map(String::as_str));
            break;
        }
        if let Some(flag) = arg.strip_prefix("--") {
            let flag_name = flag.split('=').next().unwrap_or(flag);
            if flag_name == "force" || flag_name == "force-with-lease" {
                force = true;
            }
            if flag_name == "delete" {
                delete = true;
            }
        } else if arg.starts_with('-') && arg.len() > 1 {
            if arg == "-f" { force = true; }
            if arg == "-d" { delete = true; }
        } else {
            positional.push(arg.as_str());
        }
    }

    let targets_default = default_branch
        .map(|branch| positional.iter().any(|p| refspec_targets_branch(p, branch)))
        .unwrap_or(false);
    let is_colon_delete_refspec = positional.iter().any(|p| p.starts_with(':') && !p[1..].is_empty());

    if targets_default {
        return Verdict::Destructive(DestructiveCategory::DefaultBranchPush);
    }
    if delete || is_colon_delete_refspec {
        return Verdict::Destructive(DestructiveCategory::BranchDeletion);
    }
    if force {
        return Verdict::Destructive(DestructiveCategory::ForcePush);
    }
    Verdict::Safe
}
```

Add positive test cases mirroring the existing `branch_deletion_*` tests, e.g.
`classify("git", &["push", "origin", "--delete", "feature"], None)` and
`classify("git", &["push", "origin", ":feature"], None)` both asserting
`Verdict::Destructive(DestructiveCategory::BranchDeletion)`.

## Warnings

### WR-01: `close_agent_run` writes a hardcoded, potentially false `"before"` value into the non-repudiable event log

**File:** `packages/core/src/domain/agent_run.rs:219-276` (payload at `agent_run.rs:252-258`)
**Issue:**

`close_agent_run`'s own SELECT only reads `project_id, task_id, worktree_id` from the `agent_runs`
row before updating it — it never reads the row's current `status`:

```rust
let existing: Option<(String, String, Option<String>)> = tx
    .query_row(
        "SELECT project_id, task_id, worktree_id FROM agent_runs WHERE id = ?1",
        ...
```

Yet the event payload it appends hardcodes the prior status as literally `"running"`:

```rust
let payload = serde_json::json!({
    "field": "agent_run",
    "before": "running",
    "after": status.as_str(),
    "label": format!("Agent run {}", status.as_str()),
});
```

`close_agent_run` is called by `apply_session_closed` (`agent_run.rs:456`) whenever the run's
current status is neither already-terminal nor backfilled — which includes `blocked`, not only
`running` (a run can be closed by a `session_closed` event while it is mid-permission-request).
When that happens, the appended `agent_run.closed` event records `"before": "running"` even though
the row's actual prior status was `blocked` — a factually incorrect entry in exactly the append-only
event log this codebase's own doc comments describe as "the non-repudiable record the core value
rests on" (`domain/task.rs:230-236`).

Compare `interrupt_agent_run` and `mark_abandoned` in the same file, which both correctly read and
use the row's actual current status for their own `"before"` field — `close_agent_run` is the one
outlier.

**Fix:** Read `status` alongside the other columns and use it as the payload's `"before"` value:

```rust
let existing: Option<(String, String, Option<String>, String)> = tx
    .query_row(
        "SELECT project_id, task_id, worktree_id, status FROM agent_runs WHERE id = ?1",
        params![run_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .optional()
    .context("failed to read agent_runs row before close")?;

let Some((project_id, task_id, _worktree_id, current_status)) = existing else { ... };
...
let payload = serde_json::json!({
    "field": "agent_run",
    "before": current_status,
    "after": status.as_str(),
    "label": format!("Agent run {}", status.as_str()),
});
```

### WR-02: `rev_parse_verify` constructs its own `Command::new("git")`, bypassing `git_at`/the D-51/D-54 lock-retry policy, and falsifying the module's own "ONE construction site" doc claim

**File:** `packages/core/src/git.rs:74-88` (`rev_parse_verify`), contradicting the module doc
comment at `packages/core/src/git.rs:1-11`
**Issue:**

`git.rs`'s own top-of-file doc comment states: "the ONE place in this workspace that constructs a
`Command::new("git")`. `packages/core/tests/supervisor_cwd.rs` ... asserts this structurally."
`rev_parse_verify` is a second, independent `Command::new("git")` construction site in the very same
file:

```rust
pub fn rev_parse_verify(repo_path: &Path, ref_name: &str) -> anyhow::Result<bool> {
    ...
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(["rev-parse", "--verify", "--quiet", ref_name])
        .output()
        ...
    Ok(output.status.success())
}
```

`supervisor_cwd.rs`'s `every_git_command_construction_lives_in_git_rs` test only asserts that no
`Command::new("git")` exists *outside* `git.rs` — it does not (and, per its own name, was never
meant to) assert there is only one *inside* `git.rs`. So the doc comment's stronger claim is false
and nothing currently catches the drift.

The practical consequence: `rev_parse_verify` (called by `worktree_add` to check for an
already-existing branch, and by `recreate_worktree_for_task` to probe whether a recorded branch
survived) never routes through `git_retry::with_lock_retry`, unlike every other git invocation in
this crate. It also cannot distinguish "the ref genuinely does not exist" from "git could not
resolve the ref right now due to a lock-shaped transient failure" — both read as a plain non-zero
exit and both collapse to `false`. Since `worktree_add`'s guard exists specifically to give a clean
"branch already exists" error instead of a raw git failure, a transient failure here means that
guard silently does not fire, and the *real* git error (which will itself retry correctly through
`git_at`, since it's a normal error not a lock collision) surfaces with a less actionable message
than intended.

**Fix:** Route `rev_parse_verify` through `git_at` like every other call in this file, e.g. by
using `git_at(repo_path, &["rev-parse", "--verify", "--quiet", ref_name])` and mapping its `Result`
to a `bool` (treating any `Err` whose text is not a real spawn failure as "ref does not exist"), or
at minimum wrap the existing `Command::new("git")` invocation in `git_retry::with_lock_retry` the
same way `git_at` does. If a second, deliberately-unretried construction site is truly wanted here,
update the module doc comment to stop claiming uniqueness, and add a real test asserting there is
exactly one `Command::new("git")` inside `git.rs` (or explicitly enumerating the two, with a comment
explaining why the second is exempt) so this can't silently drift further.

### WR-03: `clear_run_runtime_files` gives up on the first cleanup failure, and every caller discards its result entirely — a real I/O fault is invisible everywhere

**File:** `packages/core/src/runtime_protocol.rs:352-370`; discarded at call sites
`packages/core/src/domain/agent_run.rs:730`, `:756`, `:837`
**Issue:**

```rust
pub fn clear_run_runtime_files(run_id: &str) -> RuntimeIo {
    ...
    let paths = [ /* runs/, kills/, contention/ */ ];
    for path in paths {
        if let Err(err) = fs::remove_file(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                return RuntimeIo::WriteFailed(format!("failed to remove {path:?}: {err}"));
            }
        }
    }
    RuntimeIo::Written
}
```

If removing the *first* path (the run descriptor) fails for a reason other than "not found" (e.g. a
permissions error), the function returns immediately and never attempts to remove the kill record
or the contention log — the two other files it exists to clean up.

Worse, every call site that invokes it discards the returned `RuntimeIo` outright:

```rust
mark_abandoned(conn, &run_id, actor_id, Some(&record.reason))?;
runtime_protocol::clear_run_runtime_files(&run_id);   // return value never inspected
```

This appears in `reconcile_agent_runs` (twice) and `kill_orphan`. The module's own doc comment
states its functions exist so "a runtime-file I/O fault for ONE session must never take down the
shared sidecar reader task or the rest of the supervisor" and promises "never a silently swallowed
`let _ =`" — but functionally, not binding the return value at all is identical to `let _ =`: a
genuine cleanup failure here is never logged, surfaced to the UI, or retried anywhere in the
reviewed code. Stale runtime files (in practice fairly low-impact, since run ids are ULIDs and never
reused) would simply accumulate with zero visibility that cleanup is failing.

**Fix:** Attempt to remove all three paths regardless of an earlier failure, and aggregate any
non-`NotFound` errors into a single `WriteFailed` (or a `Vec` of failures) rather than
short-circuiting on the first one:

```rust
let mut failures = Vec::new();
for path in paths {
    if let Err(err) = fs::remove_file(&path) {
        if err.kind() != std::io::ErrorKind::NotFound {
            failures.push(format!("{path:?}: {err}"));
        }
    }
}
if failures.is_empty() { RuntimeIo::Written } else { RuntimeIo::WriteFailed(failures.join("; ")) }
```

And have at least one call site (or a shared helper) log a `RuntimeIo::WriteFailed` result rather
than discarding it unconditionally, so a persistent cleanup fault is discoverable.

### WR-04: `reconcile_agent_runs` trusts a kill record's mere existence without confirming the process actually died, then deletes the only durable record of it

**File:** `packages/core/src/domain/agent_run.rs:695-762` (`reconcile_agent_runs`), specifically
the `KillRecordRead::Found` arm at `agent_run.rs:727-732`
**Issue:**

```rust
match runtime_protocol::read_kill_record(&run_id) {
    KillRecordRead::Found(record) => {
        mark_abandoned(conn, &run_id, actor_id, Some(&record.reason))?;
        runtime_protocol::clear_run_runtime_files(&run_id);
        continue;
    }
    ...
}
```

A `Found` kill record is treated as sufficient proof the run's process group is gone: the row is
marked `abandoned` and — critically — `clear_run_runtime_files` deletes the run descriptor
(`runs/<run_id>.json`), the only durable record of the pid + start time this reconciler (or a future
launch's reconciler) could ever use to detect the process again.

But `write_kill_record`'s own doc comment (`runtime_protocol.rs:76-78`) states the record is written
"BEFORE the kill signal is sent, so the explanation survives even when the kill itself is the last
thing the watchdog does" — i.e. the record's existence proves the watchdog *decided* to kill the
process, not that the kill *succeeded*. Nowhere in this arm is `process_is_alive` consulted to
confirm the descriptor's process is actually gone before treating it as resolved. Contrast this with
`kill_orphan` in the very same file, which — for the user-initiated kill path — explicitly sends the
signal, sleeps, and *re-checks liveness* before deciding what to report.

In the (rare, but real) case where a watchdog's kill signal fails to actually terminate the process
group (a process wedged in an uninterruptible I/O state, or the watchdog itself crashing between
writing the record and sending the signal), this code path would: (1) mark the run `abandoned` in
the database — a board fact asserting the process is gone — and (2) delete the one file
(`runs/<run_id>.json`) any future reconciliation pass would need to detect that it is, in fact,
still running. The process becomes permanently invisible to Flywheel from that point on, which is
in direct tension with this phase's own "nothing left running" goal. (This finding's real-world
likelihood depends partly on whether `packages/sidecar/src/watchdog.ts` — out of this review's
scope — performs its own liveness recheck before considering a kill "done"; if it does, this Rust
side is a second, redundant layer of protection that is currently missing.)

**Fix:** Before trusting a `Found` kill record, also consult the run's own descriptor (already read
into `descriptors` in the same function) and `process_is_alive`. If the descriptor's process is
still alive despite a kill record naming it, treat it the same as the "genuinely alive" branch below
(push a `LiveOrphan`, write nothing) rather than the "resolved" branch — or, at minimum, keep the
kill record and descriptor on disk (skip `clear_run_runtime_files`) until liveness is independently
confirmed dead, so a failed kill is never permanently un-trackable.

## Info

### IN-01: `classify_rebase`'s "contains a slash" heuristic also flags a local branch name containing a slash

**File:** `packages/core/src/destructive.rs:269-282`
**Issue:** `classify_rebase` treats any rebase upstream argument containing `/` (or starting with
`refs/remotes/`) as a remote-tracking ref, classifying it `HistoryRewrite`. A purely local branch
whose own name contains a slash (a common convention, e.g. `feature/login-page`) would also match
this check and be flagged destructive even though `git rebase feature/login-page` never touches
published history. This is fail-closed (never silently unsafe) and therefore not a defect in the
security sense, but it is a real, user-visible false positive (an unnecessary permission-gate
prompt) worth a code comment and a regression test acknowledging the tradeoff, or a small
refinement (e.g. checking the argument against known local branch names first, or specifically
matching a remote name prefix like `<remote>/`) if it proves noisy in practice.
**Fix:** Optional — document the known false-positive as an accepted tradeoff, or refine the
heuristic (e.g. resolve `git for-each-ref refs/heads/` first and only classify as `HistoryRewrite`
when the upstream is *not* a known local branch).

---

_Reviewed: 2026-09-15T09:27:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

# Part: Tauri backend (`packages/desktop/src-tauri`)

# Phase 03: Code Review Report (Part 2/4 — Tauri backend)

**Reviewed:** 2026-09-15
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This part covers the Tauri desktop backend's command surface, sidecar supervisor, app state, and
capability manifest. The phase's stated invariants (single DB writer, default-deny capabilities,
pid+start-time safety, no panics on per-run I/O faults) are largely honored, and the new
crash/orphan-recovery commands (`worktree_remove_check`, `worktree_remove`, `worktree_recreate`,
`worktree_forget_record`, `agent_run_acknowledge`, `agent_runs_pending_orphans`, `orphan_kill`) are
individually careful about actor resolution and idempotence.

Two issues rise to Critical:

1. `agent_run_log_window` and `agent_run_raw_window` pass an entirely unvalidated,
   renderer-supplied `agent_run_id` string straight into a filesystem path join
   (`session_log_path`), with no format check and no existence check against the `agent_runs`
   table — a path-traversal / arbitrary-file-read primitive reachable from any code that can
   invoke a Tauri command. This is the exact class of bug `sidecar.rs`'s own
   `is_plausible_run_id` guard was written to close for the *sidecar-to-core* boundary
   (T-02G-12-01) — but the guard was never applied to the *IPC-to-core* boundary, which is the
   more directly attacker-reachable one of the two.
2. The sidecar's own startup readiness handshake (the code this exact phase's crash-avoidance
   discipline is built around) can panic on a `String::truncate` call that is not guaranteed to
   land on a UTF-8 char boundary, if the sidecar's stderr output during the 5-second handshake
   window straddles the 4096-byte cap with a multi-byte character.

Two Warnings: a docstring/behavior mismatch in `worktree_recreate` (claims the DB lock is
dropped before the git shell-out; it isn't), and a silent-truncation bug in the raw log window
reader when a line fails UTF-8 decoding.

## Critical Issues

### CR-01: Path traversal / arbitrary file read via `agent_run_id` in the raw/structured log-window commands

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:858-870` (`agent_run_log_window`) and `:896-911` (`agent_run_raw_window`)

**Issue:** Both commands take `agent_run_id: String` directly from the IPC boundary and pass it,
completely unvalidated, into `flywheel_core::session_log::read_window` / `count_lines` /
`session_log_path`, which (see `packages/core/src/session_log.rs:25-27`) does:

```rust
pub fn session_log_path(agent_run_id: &str) -> anyhow::Result<PathBuf> {
    Ok(sessions_dir()?.join(format!("{agent_run_id}.jsonl")))
}
```

`PathBuf::join` on an argument containing `..` segments walks up out of `sessions_dir()`, and — on
both Unix and Windows — `join` with an argument that is itself *absolute* discards the base path
entirely and returns the argument verbatim. Since `agent_run_id` is attacker-controlled input with
no shape check anywhere on this call path, a caller of `agent_run_raw_window` (or
`agent_run_log_window`) with e.g. `agent_run_id = "/Users/victim/.ssh/some_key"` or
`agent_run_id = "../../../../etc/some_file"` causes the command to open and return the contents of
`*.jsonl`-suffixed files anywhere on the filesystem the app process can read — an arbitrary-file-read
primitive. Neither command checks that `agent_run_id` names a real row in `agent_runs` before doing
this, and neither command is gated by the capabilities manifest (per this project's own comment in
`capabilities/default.json`, app commands are reachable purely via `generate_handler!`, with **no**
additional ACL check) — so once reachable via `invoke`, nothing else in this codebase stops it.

Compare with `sidecar.rs`'s own `is_plausible_run_id` (lines 473-481), which exists specifically
"to stop a `runId` read off an untrusted sidecar stdout line from ever being joined into a
filesystem path unchecked" — the exact same risk, but that guard was applied to the *less*
attacker-reachable boundary (sidecar stdout, produced by a process this app itself spawned) and
never applied to the *more* attacker-reachable one (an IPC command argument, reachable by anything
that can call `invoke`, e.g. a compromised renderer bundle, a supply-chain-compromised npm
dependency, or any future webview content).

**Fix:** Validate `agent_run_id`'s shape before it ever reaches `session_log_path` — reuse (and
make non-crate-private) `sidecar::is_plausible_run_id`, or duplicate the same 26-char-alphanumeric
check, in both commands:

```rust
#[tauri::command]
pub fn agent_run_log_window(
    agent_run_id: String,
    offset: Option<i64>,
    limit: Option<i64>,
) -> Result<LogWindowDto, String> {
    if !crate::sidecar::is_plausible_run_id(&agent_run_id) {
        return Err("agent_run_id is not a valid run id".to_string());
    }
    let limit = resolve_log_window_limit(limit);
    let offset = offset.unwrap_or(0).max(0);

    flywheel_core::session_log::read_window(&agent_run_id, offset as usize, limit as usize)
        .map(LogWindowDto::from)
        .map_err(|e| e.to_string())
}
```

and the same guard at the top of `agent_run_raw_window`. Stronger still: also require the id to
resolve to a real `agent_runs` row (a cheap `SELECT 1 FROM agent_runs WHERE id = ?1` against
`state.db`) before touching the filesystem, so even a plausibly-shaped but nonexistent id is
rejected before any I/O. Consider making `is_plausible_run_id` `pub` in `session_log.rs` itself
(next to `session_log_path`) so every call site — sidecar reader loop and IPC commands alike — is
forced through the same guard rather than relying on each caller to remember to apply it.

### CR-02: Potential panic on a non-UTF-8-boundary `String::truncate` in the sidecar readiness handshake

**File:** `packages/desktop/src-tauri/src/sidecar.rs:802-808`

**Issue:**

```rust
Some(CommandEvent::Stderr(bytes)) => {
    if stderr_tail.len() < READINESS_STDERR_TAIL_CAP {
        stderr_tail.push_str(&String::from_utf8_lossy(&bytes));
        stderr_tail.push('\n');
        stderr_tail.truncate(stderr_tail.len().min(READINESS_STDERR_TAIL_CAP));
    }
}
```

`String::truncate(new_len)` panics if `new_len` does not lie on a UTF-8 char boundary. The check
above only guards the *pre-push* length against `READINESS_STDERR_TAIL_CAP` (4096); after pushing
a chunk of stderr, the string's length can land anywhere past the cap, and
`stderr_tail.len().min(READINESS_STDERR_TAIL_CAP)` will very likely truncate to exactly byte 4096
whenever the accumulated tail exceeds it. If a multi-byte UTF-8 character (e.g. any non-ASCII
character in a Node stack trace, a colorized/box-drawing CLI error, or any emoji in a dependency's
warning output) straddles that exact byte offset, this call panics.

This runs inside `tauri::async_runtime::block_on(...)`, invoked synchronously from `main.rs`'s
`.setup()` closure — the same call site whose own doc comment (lines 772-781) explains that a
panic escaping this exact code path previously aborted the whole process before a window was ever
shown, because `.setup()` runs in a frame that cannot unwind. In other words: this is precisely the
panic-must-never-happen path this phase's own commentary is about, and it contains a reachable
panic condition, triggered by nothing more exotic than a sidecar emitting >4KB of stderr containing
a multi-byte character near the cap boundary during the 5-second startup window (e.g. a genuine
Node crash stack trace, which is exactly the scenario the handshake exists to surface gracefully).

**Fix:** Truncate on a valid char boundary, not a raw byte count:

```rust
if stderr_tail.len() < READINESS_STDERR_TAIL_CAP {
    stderr_tail.push_str(&String::from_utf8_lossy(&bytes));
    stderr_tail.push('\n');
    if stderr_tail.len() > READINESS_STDERR_TAIL_CAP {
        let mut cut = READINESS_STDERR_TAIL_CAP;
        while cut > 0 && !stderr_tail.is_char_boundary(cut) {
            cut -= 1;
        }
        stderr_tail.truncate(cut);
    }
}
```

(or accumulate into a `Vec<u8>` and only `String::from_utf8_lossy` once, at the point the tail is
actually used in an error message, which sidesteps the boundary problem entirely).

## Warnings

### WR-01: `worktree_recreate`'s docstring claims the DB lock is dropped before the git shell-out; the code holds it throughout

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:1191-1222`

**Issue:** The doc comment states:

> "`recreate_worktree_for_task` shells out to git; the connection lock is dropped before that call
> so a slow git operation never holds `state.db` (mirrors `agent_run_start`'s own
> resolve-before-lock discipline for `send_spawn_request`, see the comment above it)."

But the implementation does the opposite — the lock is held for the entire duration of the call
that shells out to git:

```rust
{
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::worktree::recreate_worktree_for_task(&mut conn, &task_id, &actor_id)
        .map_err(|e| e.to_string())?;
}
```

`state.db` is the single `Mutex<Connection>` every other command in this codebase locks first
(per this same file's own CR-01 note on `agent_run_stop`, lines 338-345, about exactly this
failure mode for the sidecar interrupt wait). Holding it across a git worktree-add operation —
which, per D-52/WORK-05's own spawn-floor machinery elsewhere in this codebase, can retry under
lock contention — means every other board read, task mutation, and agent-run interaction freezes
for the duration. This is the same class of hazard CR-01 was written to eliminate for
`agent_run_stop`, but reintroduced here, with a docstring that incorrectly asserts it was avoided.
`worktree_remove` (`:1163-1189`) has the identical shape (lock held across
`remove_worktree_for_task`'s own git shell-out) but at least makes no false claim about it.

**Fix:** Either correct the docstring to reflect actual behavior, or — preferably — restructure so
the mutex is not held across the git subprocess call, mirroring `worktree_remove_check`'s existing
pattern of reading what's needed, dropping the lock, doing the filesystem/git work, then
re-acquiring only for the final write:

```rust
let actor_id = {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    flywheel_core::domain::actor::local_human_actor_id(&conn).map_err(|e| e.to_string())?
};
// ... perform the git operation without holding state.db, then re-lock only for the
// row write that records the outcome ...
```

Note this likely requires `recreate_worktree_for_task`/`remove_worktree_for_task` in
`packages/core` to be split into a git-only phase and a DB-write phase — out of this file's own
scope to fix alone, but the docstring should not claim a guarantee the current split cannot
provide.

### WR-02: `read_raw_line_window` silently truncates the returned window on the first UTF-8 decode error

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:918-947`

**Issue:**

```rust
for (line_number, line_result) in reader.lines().enumerate() {
    if line_number >= total { break; }
    if line_number < offset { continue; }
    if out.len() >= limit { break; }
    let Ok(text) = line_result else { break; };
    out.push(RawLogLineDto { line: line_number as i64, text });
}
```

`total` (the window's own `total` field) is computed independently via
`session_log::count_lines`, before this loop runs. If any single line in the file fails to decode
as valid UTF-8 (`reader.lines()` returns `Err` on invalid UTF-8 bytes), the loop `break`s
unconditionally — silently ending the read for every line after that point, even lines well before
`offset + limit`. The function returns `Ok` with whatever was collected so far; the caller
(`agent_run_raw_window`) has no way to know the window is short, and the DTO's own `total` field
(from `count_lines`, computed separately) will disagree with what the renderer actually receives —
with no error, warning, or indication surfaced anywhere. A single corrupted/truncated line
partway through a large session log (plausible after an ungraceful process kill mid-write, which
this exact phase is designed to handle) silently hides every subsequent line in the raw log viewer.

**Fix:** Skip the bad line instead of aborting the whole read, so one corrupt line does not
suppress the rest of the file:

```rust
let text = match line_result {
    Ok(text) => text,
    Err(_) => continue,
};
out.push(RawLogLineDto { line: line_number as i64, text });
```

(adjust the `out.len() >= limit` check's relationship to `line_number` accordingly if skipped lines
should still count toward pagination).

## Info

### IN-01: `capabilities/default.json`'s "full app-command roster" comment is out of sync with `main.rs`'s actual `generate_handler!` list

**File:** `packages/desktop/src-tauri/capabilities/default.json:4`, cross-referenced against `packages/desktop/src-tauri/src/main.rs:99-165`

**Issue:** The capability manifest's `description` field enumerates, for auditability, "the full
app-command roster" reachable via `generate_handler!`. Comparing that enumerated list against the
actual list in `main.rs`, four registered commands are missing from the roster comment:
`task_set_epic`, `epic_list_all`, `issue_set_parent`, and `menu_set_action_enabled`. Since the
document's own stated purpose is to be the audit trail for "every #[tauri::command] handler this
app exposes" (given these commands receive no separate ACL entry), an out-of-date roster
undermines that stated audit value — a reviewer scanning only this comment would not learn these
four commands exist. This predates phase 03 for at least three of the four (task/epic/issue
commands look like phase 01/02 additions), so it may be a pre-existing gap rather than something
introduced by this phase, but it is visible in a file under this phase's own review scope and is
worth closing.

**Fix:** Update the roster comment to match `generate_handler!` exactly, or better, generate/verify
it mechanically (e.g. a test that parses `main.rs`'s `generate_handler!` list and asserts every
name appears in the capabilities description) so the two cannot drift again silently.

---

_Reviewed: 2026-09-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

# Part: Desktop frontend (`packages/desktop/src`)

# Phase 03 (Part 3/4 — Desktop Frontend): Code Review Report

**Reviewed:** 2026-09-15T09:25:36Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Reviewed the desktop React frontend slice of Phase 03 ("Nothing Lost, Nothing Left Running"):
recovery surfaces (orphan modal, missing-worktree banner, worktree-removal dialog, abandoned-run
acknowledge), the destructive-action permission gate, and the board's Needs Decision pill / rail
badge. The phase's own structural invariants (no dirty-worktree escape hatch, no allow-always on
the destructive gate, two independently-counted rail badges, fail-closed partial reads) all hold
in the code as written and are exercised by the accompanying tests.

The one thing that does **not** hold consistently is the double-activation guard the phase's own
prior plans (03-09, 03-10) already diagnosed and fixed twice: a `useState`-only "in flight" flag
does not stop a second synchronous activation before React flushes the re-render that disables the
button, so a `useRef` guard is required alongside the state flag. Two of the four surfaces that
introduced this pattern in this phase (`WorktreeSummary`'s Recreate/Remove-Record banner,
`RunsSection`'s Acknowledge) carry the `useRef` fix and say so in their own comments. The other two
surfaces that ship in this exact phase — the permission-request card's Allow/Deny/Allow-always
actions and the worktree-removal dialog's Remove action — plus the orphan-recovery modal's
Kill/Kill All (also this phase) and the live session surface's Stop control do **not** carry the
ref guard, despite `PermissionRequestCard.tsx`'s own doc comment citing "T-02-29" for exactly this
class of guard. This is the review's primary finding, filed as five separate BLOCKERs below since
each is an independently reachable path to a duplicate destructive/state-changing command.

## Critical Issues

### CR-01: `PermissionRequestCard`'s Allow/Deny/Allow-always guard is state-only, not ref-guarded — the exact bug this phase already fixed twice elsewhere

**File:** `packages/desktop/src/session/PermissionRequestCard.tsx:182-194`

**Issue:** `answer()` guards re-entry with `if (state.answering) return;` alone:

```ts
async function answer(decision: PermissionDecision) {
  // A second activation while disabled invokes nothing (T-02-29) — the guard the UI layer adds
  // on top of the core's own guarded once-only write.
  if (state.answering) return;
  setState({ answering: true, error: null });
  ...
```

`state.answering` is React state read from the render closure; `setState` does not synchronously
update the closure `answer()` captured, and the `disabled` attribute on the Allow/Deny/Allow-always
buttons is not guaranteed to be in the DOM before a second, closely-spaced activation reaches this
same `answer()` call. `WorktreeSummary.tsx`'s `MissingWorktreeBanner` (this same phase, plan 03-09)
and `RunsSection.tsx`'s abandoned-run Acknowledge (this same phase, plan 03-10) both encountered
this exact defect and fixed it with a `useRef` guard, with a code comment explaining precisely why
`state.answering`-equivalent alone is insufficient. `PermissionRequestCard.tsx` is the single most
reused component in this review's scope — it backs the routine Allow/Deny/Allow-always card AND the
destructive-action gate's Deny/"Allow, just this once" (03-UI-SPEC.md's reversed-emphasis variant,
D-56/D-57) in both the feed and compact mount points. A double-activation here can send two
`agent_run_answer_permission` calls for the same request id, including two DIFFERENT decisions if
the guard is raced (e.g. a fast Allow-then-Deny double-tap), which the current guard cannot rule
out under the documented race.

Note: the existing test `"activating Allow twice in immediate succession calls the answer spy
exactly once"` (`session/__tests__/permission-card.test.tsx:116-132`) passes today only because
`fireEvent.click` in Testing Library flushes React state synchronously inside `act()` between the
two dispatched clicks — it does not reproduce the real browser race the phase's own prior fixes
were written to close, and gives false confidence that this component is already guarded.

**Fix:**
```ts
const answeringRef = useRef(false);

async function answer(decision: PermissionDecision) {
  if (answeringRef.current) return;
  answeringRef.current = true;
  setState({ answering: true, error: null });
  try {
    await onAnswer(request.id, decision);
  } catch {
    answeringRef.current = false;
    setState({ answering: false, error: "Could not send your answer. Try again." });
  }
}
```

---

### CR-02: `WorktreeRemovalDialog`'s Remove button is state-only guarded — double-activation can issue two `worktree_remove` calls

**File:** `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx:92-103`

**Issue:** Same pattern as CR-01:

```ts
async function handleRemove() {
  // A second activation while disabled invokes nothing — the guard the UI layer adds on top of
  // the backend's own guarded removal.
  if (removeState.removing) return;
  setRemoveState({ removing: true, error: null });
  ...
```

`removeState.removing` is `useState`, not a `useRef`. The backend re-checking porcelain on every
call (D-43) limits the blast radius to "the second call also succeeds harmlessly or the second call
errors on an already-removed worktree," but this is still an unguarded duplicate destructive
command dispatch from the one button in this dialog whose entire reason for existing is to be the
sole gate on an irreversible action.

**Fix:** Add a `useRef` guard mirroring `WorktreeSummary.tsx`'s `actingRef`:
```ts
const removingRef = useRef(false);

async function handleRemove() {
  if (removingRef.current) return;
  removingRef.current = true;
  setRemoveState({ removing: true, error: null });
  try {
    await removeWorktree.mutateAsync();
    onClose();
  } catch {
    removingRef.current = false;
    setRemoveState({ removing: false, error: "Could not remove the worktree. Try again." });
  }
}
```

---

### CR-03: `OrphanRecoveryModal`'s Kill / Kill All have no in-flight guard at all — not even the state check the other unguarded surfaces have

**File:** `packages/desktop/src/recovery/OrphanRecoveryModal.tsx:106-143`

**Issue:** `handleKill` calls `killOne` unconditionally, with no check of the row's own `killing`
flag before dispatching:

```ts
function handleKill(runId: string) {
  setRows((prev) => (prev ?? []).map((row) => (row.orphan.runId === runId ? { ...row, killing: true } : row)));
  void killOne(runId);
}
```

The only thing preventing a second `orphanKill(runId)` call is the Kill button's own conditional
render (`row.failed ? … : row.killing ? "Killing…" : <button onClick={() => handleKill(...)}>`),
which — same race as CR-01/CR-02 — is not guaranteed to have committed before a second activation
reaches `handleKill`. `handleKillAll` has the identical gap, and is worse in effect: it reads the
CURRENT `rows` state synchronously to build `targets`, so two closely-spaced Kill All presses before
the first `setRows` commits will compute the *same* `targets` list twice and fire `orphanKill` twice
per orphan in the list:

```ts
function handleKillAll() {
  const targets = (rows ?? []).filter((row) => !row.killing && !row.failed);
  setRows(...)
  for (const target of targets) {
    void killOne(target.orphan.runId);
  }
}
```

This is the same defect class named in this phase's own prior fixes (WorktreeSummary/RunsSection),
but here there isn't even the (insufficient) `state.acting`-style precondition check — the guard is
entirely absent, relying only on React's render timing. Killing an orphaned process twice is likely
low-consequence on most platforms (a second `SIGKILL`/`SIGTERM` against an already-dead PID
typically no-ops), but this is the one modal in the app explicitly designed to be the last word on
"is anything still running and spending tokens" (D-46) — a duplicate in-flight kill request racing
the first response is exactly the kind of ambiguity this surface exists to eliminate.

**Fix:** Add a per-row ref set (or a single `Set<string>` ref of in-flight run ids) guarding both
`handleKill` and the per-target dispatch inside `handleKillAll`:
```ts
const killingRef = useRef<Set<string>>(new Set());

async function killOne(runId: string) {
  if (killingRef.current.has(runId)) return;
  killingRef.current.add(runId);
  try {
    const outcome = await orphanKill(runId);
    ...
  } finally {
    if (/* not resolved to removal */) killingRef.current.delete(runId);
  }
}
```
(Adjust exactly where the ref is cleared so a permanently-failed row does not re-admit a retry —
there is deliberately no retry affordance per this file's own doc comment.)

---

### CR-04: `SessionSurface`'s Stop control has no re-entry guard whatsoever — not even a `state.acting`-style precondition

**File:** `packages/desktop/src/session/SessionSurface.tsx:574-586, 683-700`

**Issue:**
```ts
function handleStop() {
  setStopping(true);
  stopAgentRun(agentRunId)
    .then((result) => {
      if (isRunStatus(result.status)) setStatus(result.status);
      setStopWarning(result.sidecarWarning);
    })
    .catch(() => setStopping(false));
}
```
called from:
```tsx
<button type="button" onClick={handleStop} disabled={stopping} ...>
```

Unlike every other unguarded handler in this review (CR-01–CR-03), `handleStop` does not even check
`if (stopping) return;` before dispatching — the ONLY thing standing between one click and two
`agent_run_stop` calls is the `disabled` attribute's own render timing, the exact race this phase's
own prior fixes exist to close. `agent_run_stop`'s own doc comment (`adapters/tauri.ts:307-318`)
describes an "interrupt, then force" semantics, so a duplicate call is plausibly idempotent
server-side, but that is an assumption this file makes silently rather than one the frontend
enforces — every other action in this review at least attempts a JS-level guard.

**Fix:**
```ts
const stoppingRef = useRef(false);

function handleStop() {
  if (stoppingRef.current) return;
  stoppingRef.current = true;
  setStopping(true);
  stopAgentRun(agentRunId)
    .then((result) => {
      if (isRunStatus(result.status)) setStatus(result.status);
      setStopWarning(result.sidecarWarning);
    })
    .catch(() => {
      stoppingRef.current = false;
      setStopping(false);
    });
}
```

---

### CR-05: Missing-worktree banner is bypassable when `path` is empty, silently exposing "Remove Worktree" on a `status: "missing"` row

**File:** `packages/desktop/src/item-detail/WorktreeSummary.tsx:238-240, 304-319`

**Issue:** The file's own doc comment (lines 38-45) states the missing-worktree decision banner is
"an early return… there is no second guard anywhere in this file for that; the early return IS the
guarantee" that Remove Worktree is structurally unreachable while the row is `missing`. The actual
guard, however, is compound:

```ts
if (summary.status === "missing" && isNonEmptyString(summary.path)) {
  return <MissingWorktreeBanner taskId={taskId} path={summary.path} />;
}
```

If `summary.status === "missing"` but `summary.path` is falsy/empty (a malformed or defensively-
degraded wire response — this file elsewhere explicitly designs for exactly that possibility via
`PossiblyPartialSummary`/T-02-37), this condition is false, execution falls through past the
early-return ladder into the ordinary branch/path render, and the **Remove Worktree button renders
for a row Flywheel itself believes is missing from disk** — the one outcome the file's own doc
comment says is structurally impossible. `worktree_remove` would then run against a path git cannot
find, which is a confusing failure mode rather than a guarded one, and — worse — it is the exact
kind of "trust the compile-time contract instead of failing closed" gap T-02-37 exists to close,
in the one file that otherwise defends against it everywhere else.

**Fix:** Gate on `status === "missing"` alone for the early return (never require `path` to be
non-empty to suppress the destructive action), and let the banner itself render its own "path
unavailable" fallback:
```ts
if (summary.status === "missing") {
  return (
    <MissingWorktreeBanner
      taskId={taskId}
      path={isNonEmptyString(summary.path) ? summary.path : "an unknown location"}
    />
  );
}
```

## Warnings

### WR-01: Dirty-worktree heading can read "0 uncommitted changes" while still listing real entries

**File:** `packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx:183-196`

**Issue:** The Dirty branch is reached whenever `dirtyCount !== 0 || entries.length !== 0` (i.e.
anything that isn't the exact `dirtyCount === 0 && entries.length === 0` Clean case). The heading
text and pluralisation are derived from `dirtyCount` alone (`Can't remove — {dirtyCount} uncommitted
{plural}`), but a response with `dirtyCount: 0` and a non-empty `entries` array (a plausible partial
inconsistency from the same class of malformed read `looksPartial` already defends against) renders
"Can't remove — 0 uncommitted changes" above a non-empty list of real entries — refusing correctly
(safe), but with a self-contradicting heading. `looksPartial` catches `dirtyCount > 0 && entries.length
=== 0` and empty-path entries, but not this inverse mismatch.

**Fix:** Extend the `looksPartial` check (or the heading derivation) to also treat
`dirtyCount !== entries.length` as a partial/inconsistent read:
```ts
const looksPartial =
  (dirtyCount > 0 && entries.length === 0) ||
  entries.some((entry) => entry.path === "") ||
  dirtyCount !== entries.length;
```

### WR-02: `WorktreeSummaryDto.status` is matched by exact string literal with no defensive fallback for an unrecognised value

**File:** `packages/desktop/src/item-detail/WorktreeSummary.tsx:238`, cross-referenced against `packages/desktop/src/adapters/tauri.ts:220-224`

**Issue:** `worktreeSummary.status` is typed as a bare `string` on the wire (`adapters/tauri.ts`'s
`WorktreeSummaryDto`), and the UI's only branch on it is the literal equality `summary.status ===
"missing"`. If the backend ever emits a status value with different casing, a synonym, or a new
recovery-state string this component doesn't yet know about, the row silently falls through to the
normal branch/path render — including the (otherwise-guarded, per CR-05's fix) Remove Worktree
action — with no visible signal that anything is unusual. This is a cross-boundary assumption this
file's own doc comments elsewhere are careful to defend against (`PossiblyPartialSummary`,
`violatesSingleton`) but do not apply to `status`.

**Fix:** Treat any `status` value that is neither a known "healthy" value nor `"missing"` as at
least worth a visible, non-blocking notice (mirroring the `violatesSingleton` treatment already used
a few lines below), rather than silent pass-through to the normal render.

### WR-03: `RunSummaryDto.abandonedReason` is parsed with `new Date(...)` with no validity check

**File:** `packages/desktop/src/item-detail/RunsSection.tsx:300-308`

**Issue:**
```tsx
{run.abandonedReason
  ? `Flywheel wasn't running to supervise this session — it was stopped at ${new Date(
      run.abandonedReason,
    ).toLocaleString()} because Flywheel had died.`
  : "This run never finished, and Flywheel doesn't know why it stopped."}
```
`adapters/tauri.ts`'s doc comment on `abandonedReason` (lines 194-198) explains it is `null` unless
"a kill record exists for it and parsed successfully" server-side, which makes a malformed value
unlikely — but if the wire value is ever a non-parseable string (a future schema drift, or a
partially-written kill record), `new Date(x).toLocaleString()` renders the literal string
`"Invalid Date"` into this explanatory sentence shown to the user, rather than falling back to the
honest "doesn't know why it stopped" sentence the `null` branch already provides.

**Fix:**
```ts
const abandonedAt = run.abandonedReason ? new Date(run.abandonedReason) : null;
const abandonedAtValid = abandonedAt !== null && !Number.isNaN(abandonedAt.getTime());
```
and branch on `abandonedAtValid` instead of the raw truthiness of `run.abandonedReason`.

### WR-04: `OrphanRecoveryModal`'s "Killing…" row shows no distinct treatment when a kill result arrives as neither killed nor an outright error, if the promise never settles

**File:** `packages/desktop/src/recovery/OrphanRecoveryModal.tsx:106-128`

**Issue:** Not a functional bug today, but worth noting alongside CR-03: `killOne` has no timeout —
if `orphanKill` never resolves or rejects (a hung IPC call), the row is stuck showing "Killing…"
forever with no path back to a Kill button or a failure state, and (per CR-03's `anyUnresolved`
check) "Kill All" stays enabled and could be re-pressed, re-dispatching kills for every OTHER
still-Kill-able row while this one row is silently stuck. Low likelihood, but this modal is
explicitly the app's last line of defense against a lied-about clean launch (03-10 Task 3's own
"criterion 2 honesty" test), so an unbounded hang here is worth a defensive timeout.

**Fix:** Consider a bounded timeout on `orphanKill` (or a visible "taking longer than expected"
state after N seconds) so a hung IPC call cannot leave a row silently un-actionable forever.

## Info

### IN-01: Per-file duplication of `relativeTime`/`MONO_STACK`/status-badge lookups is consistent with this codebase's own stated convention, not an oversight

**File:** `packages/desktop/src/item-detail/RunsSection.tsx`, `packages/desktop/src/recovery/OrphanRecoveryModal.tsx`, `packages/desktop/src/session/SessionSurface.tsx`, `packages/desktop/src/item-detail/WorktreeSummary.tsx`

**Issue:** `relativeTime`, `MONO_STACK`, `prefersReducedMotion`, and the run-status label/colour/mark
lookup tables are each re-declared verbatim (or near-verbatim) in three-to-four files rather than
imported from one shared module. Each file's own doc comment explicitly cites this as a deliberate,
established per-file convention rather than an accident, so this is not filed as a defect — flagged
only as an observation for the reviewer of a future phase: if a fifth or sixth surface needs the
same helpers, the duplication cost (a bug fix in one copy not propagating to the others — e.g. a
future change to `relativeTime`'s boundary rounding) starts to outweigh the stated benefit of
per-file independence.

**Fix:** No action required for this phase. Consider extracting a shared `formatting.ts` if a future
plan adds a fifth call site.

---

_Reviewed: 2026-09-15T09:25:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

# Part: Sidecar, shim & design record

# Phase 03: Code Review Report (Part 4/4 — Sidecar, Shim, Workspace Manifest, DESIGN.md)

**Reviewed:** 2026-09-15T00:00:00Z
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

This slice covers the Node sidecar (agent-adapter driver, permission relay, watchdog wrapper,
`PreToolUse` hook), the Rust PATH-shim binary, the workspace `Cargo.toml`, and `DESIGN.md`. The
watchdog/heartbeat/kill-record mechanism (D-47/D-48) is well-tested against real spawned processes
and correctly avoids touching SQLite. The three phase-context items called out for special
scrutiny were investigated directly:

1. **`start_time` unit mismatch (ms vs seconds):** verified CORRECT, not a live bug. Both
   `watchdog.ts`'s `processStartTimeMs` and `claude-code-adapter.ts`'s `readOsProcessStartTimeMs`
   write epoch **milliseconds**; `packages/core/src/runtime_protocol.rs::process_is_alive` (line
   337) explicitly does `process.start_time().saturating_mul(1000) == start_time` to compare
   like-for-like against `sysinfo`'s seconds. This is documented and consistent across all three
   writers I could find. No finding recorded for this item.
2. **Shim argv classification on a leading global flag (e.g. `git -C <dir> status`):** confirmed
   still present and confirmed **not a security bypass but a severe false-positive/availability
   bug** — see CR-01 below.
3. **`destructive-gate.test.mjs` spends real API budget on every `npm test`:** confirmed, and
   confirmed **not gated behind an opt-in flag** — see WR-01 below.

Beyond those three directed checks, this pass also found that the shim's real-git/real-rm
invocations silently discard the child's stdin (WR-02), a narrow but real initialization-order
hazard in the sidecar's permission-server callbacks (WR-03), and a missing timeout on the
`PreToolUse` hook's own shell-out to the shim binary (WR-04).

## Critical Issues

### CR-01: The shim's destructive-command classifier treats any git invocation with a leading global flag as `Uncategorized`/destructive — including the specific case flagged for this review, `git -C <dir> status`

**File:** `packages/shim/src/main.rs:290-306` (call site: `run_git` forwards `string_args` — the
full argv after `git` — straight into `destructive_gate`/`classify` with no global-flag handling),
corroborated by `packages/core/src/destructive.rs:156-175` (`classify_git`, root cause — outside
this review's file scope but directly observable from `main.rs`'s own call pattern).

**Issue:** `classify_git` takes `expanded.first()` as *the* subcommand with no allowance for a
leading global flag (`-C`, `-c`, `--git-dir`, `--work-tree`, `--no-pager`, `-P`, etc.). For
`git -C /some/repo status`, `expand_short_clusters` leaves `"-C"` untouched (it only expands
clusters longer than 2 chars — `"-C".len() == 2`, so `is_cluster` is false), so
`subcommand = "-C"`. That string matches none of `push`/`branch`/`reset`/`clean`/`rebase`/
`filter-branch`/`SAFE_GIT_SUBCOMMANDS`, so it falls to the final arm:
`_ => Verdict::Destructive(DestructiveCategory::Uncategorized)`.

The practical effect: **every** git invocation prefixed with a global flag — not just `-C`, any
of them — is classified `Destructive(Uncategorized)` regardless of what the actual subcommand is,
even read-only ones like `status`/`log`/`diff`. Because `main.rs`'s own module doc states the shim
"blocks indefinitely" on a destructive verdict with "no read deadline… ever set," and the
`--classify-command` mode used by `pretooluse-hook.ts` reaches the exact same `classify_git` code
path (confirmed: it tokenizes the full command text, takes token 0 as the program stem — correctly
`"git"` there — then passes the *remaining* tokens, including the leading `-C`, straight to
`classify_git` the same way), **both** enforcement points (shim `PATH` shadow and `PreToolUse`
hook) hang the agent on a human's board answer for what is very often a harmless read command. This
is confirmed fail-closed (never a silent bypass toward *allowing* something dangerous), but it
directly undermines the product's stated design — "a `Safe` verdict falls straight into the normal
exec path with no permission round trip at all" — for an extremely common invocation shape, and it
can indefinitely stall an unattended/autonomous run on a command that was never actually dangerous.
Given this product's whole premise is running many agents with minimal supervision, an indefinite
hang on `git -C <worktree> status` is a severe regression, not a cosmetic false positive.

**Fix:** Skip leading option tokens before selecting the subcommand, e.g. in `classify_git`:
```rust
fn classify_git(args: &[String], default_branch: Option<&str>) -> Verdict {
    let expanded = expand_short_clusters(args);
    // Skip global options (and any value they consume) before treating a token as the subcommand.
    let mut i = 0;
    while i < expanded.len() && expanded[i].starts_with('-') {
        // Options like -C/-c/--git-dir/--work-tree/--namespace take a value as the NEXT token
        // (unless given as --opt=value); options like --no-pager/-P/--bare do not.
        i += if takes_value(&expanded[i]) && !expanded[i].contains('=') { 2 } else { 1 };
    }
    let Some(subcommand) = expanded.get(i) else {
        return Verdict::Destructive(DestructiveCategory::Uncategorized);
    };
    let rest = &expanded[i + 1..];
    match subcommand.as_str() {
        // ...unchanged...
    }
}
```
At minimum, add a regression test asserting `classify("git", &["-C", "/tmp", "status"], None)` is
`Verdict::Safe`, and a matching case in `destructive-gate.test.mjs`/`--classify-command` coverage
for `git -C <dir> status`.

## Warnings

### WR-01: `destructive-gate.test.mjs` is not isolated from `npm test` and spends real API budget on every default test run

**File:** `packages/sidecar/package.json:9`, `packages/sidecar/test/destructive-gate.test.mjs:1-354`

**Issue:** `"test": "npm run build && ... node --test test/*.test.mjs"` globs every file under
`test/`, including `destructive-gate.test.mjs`. That file's live tests (lines 260-303, 307-353)
run against the real `claude` binary using the developer's own OAuth credentials whenever `claude`
answers `--version` (`AVAILABLE`, line 77) — there is no separate opt-in env var (unlike, say,
gating on `FLYWHEEL_RUN_LIVE_TESTS=1`); the only condition is "is the CLI installed and
authenticated," which is true on essentially every machine this project is developed on (it's a
Claude Code project). Every plain `npm test` therefore: (a) makes real, billed API calls, (b) is
non-deterministic/network- and model-load-dependent (the file's own comment admits turns measured
at "2-11 seconds," with a 90s deadline treated as a harness failure), and (c) will fail spuriously
in any CI runner that has no authenticated `claude` session available under a different failure
mode than a clean skip (it depends entirely on whether `--version` happens to succeed).

**Fix:** Gate the live-binary tests behind an explicit opt-in, not just binary presence, e.g.:
```js
const LIVE_TESTS_ENABLED = process.env.FLYWHEEL_RUN_LIVE_TESTS === "1";
const SKIP_REASON = !LIVE_TESTS_ENABLED
  ? "live-binary tests are opt-in — set FLYWHEEL_RUN_LIVE_TESTS=1 to run them"
  : AVAILABLE ? undefined : `...`;
```
and split `package.json`'s `test` script so the default (`npm test`) runs only the hermetic
suites, with a separate `test:live` (or CI job) opting into the real-binary/API-cost tests
deliberately.

### WR-02: The shim's real-git/real-rm child processes never receive stdin — `Command::output()` closes it, silently breaking any command that reads from stdin

**File:** `packages/shim/src/main.rs:316-319` (`run_git`'s retry closure), `packages/shim/src/main.rs:375` (`run_rm`)

**Issue:** Both `run_git`'s retry closure and `run_rm` invoke the real binary via
`Command::new(...).args(...).output()`. Per `std::process::Command::output`'s own documented
contract, stdin is **not** inherited from the parent — "any attempt by the child process to read
from the stdin stream will result in the stream immediately closing." Since the shim replaces
`git`/`rm` on `PATH` for every agent-invoked shell command, this means any git subcommand that
would normally consume stdin — `git apply`/`git am` reading a patch piped in, `git commit` falling
back to opening an editor when no `-m` is given (git detects non-interactive/closed stdin and
aborts rather than editing), interactive index/rebase flows, credential-helper prompts, etc. — now
silently behaves differently than a direct invocation of the real binary would: it fails fast
(EOF) rather than doing what the agent's shell command intended. This is invisible to the agent
until it tries one of these patterns, at which point the retry loop (built to detect *lock*
contention in stderr) will not recognize this as a lock failure and will surface a confusing
one-shot failure instead.

**Fix:** Inherit stdin explicitly rather than relying on `.output()`'s default, e.g. build the
child with `.stdin(Stdio::inherit())` and capture stdout/stderr via `.stdout(Stdio::piped())`/
`.stderr(Stdio::piped())` + `.spawn()`/`.wait_with_output()` instead of the all-in-one `.output()`
helper. At minimum, document this as a known limitation (it currently is not documented anywhere
in `main.rs`'s otherwise extensive module doc comment) so a future debugging session doesn't have
to rediscover it.

### WR-03: `ClaudeCodeAdapter.startSession`'s permission-server callbacks close over `session` before it is assigned — a real (if narrow) crash hazard shared by every concurrent session in the process

**File:** `packages/sidecar/src/claude-code-adapter.ts:558` (`let session!: LiveSession;`),
`:559-593` (`startPermissionServer(...)` callbacks reading/writing `session.nextSeq`),
`:646` (`spawn(...)`, before `session` is ever assigned), `:661-672` (`session = {...}` — the
first real assignment).

**Issue:** `session` is declared with a definite-assignment assertion but left `undefined` until
line 661 — well *after* `startPermissionServer` has already started listening (line 559) and after
the backend has already been spawned (line 646). Both `onRequest`/`onNotice` callbacks passed to
`startPermissionServer` dereference `session.nextSeq`/`session.onEvent` unconditionally. If either
callback fires before line 661 executes, `session` is `undefined` and the callback throws a
`TypeError` synchronously inside a `readline`/socket `'line'` event handler — an exception with no
local catch, which propagates as an uncaught exception and can crash the entire sidecar Node
process, tearing down every other concurrently-running session it supervises (the whole point of
`liveSessions` being a shared per-process map). In practice this window is extremely unlikely to
be hit in production (the backend must actually start, connect its own `--mcp-config` MCP server,
and get an LLM turn to call the approval tool before this could fire, all of which takes far
longer than the few synchronous statements between lines 646 and 661) — but it is a real,
unguarded ordering dependency rather than a structural guarantee, and it is cheap to remove.

**Fix:** Either move `session = {...}` to before `spawn(...)` (constructing `child`/`closed`
lazily or via a placeholder that's patched right after `spawn` returns), or make the two callbacks
resilient to being invoked before `session` exists (buffer the payload and replay once `session` is
set). Prefer the former — it removes the hazard rather than working around it.

### WR-04: `pretooluse-hook.ts`'s shell-out to the shim binary has no timeout, in a file whose entire design goal is "never waits"

**File:** `packages/sidecar/src/pretooluse-hook.ts:112`

**Issue:** `spawnSync(shimBin, ["--classify-command", command], { encoding: "utf8" })` has no
`timeout` option. The module's own doc comment states this hook "NEVER waits" and must be "fast
enough that its own timeout can never matter" precisely because a `PreToolUse` hook that overruns
the backend's own configured timeout is silently cancelled and the tool call proceeds anyway
(RESEARCH.md's own reproduced finding, cited in this file's header). `--classify-command` mode is
documented as pure/synchronous/socket-free, so it should return near-instantly — but that is an
invariant of a *different* compiled binary (`flywheel-shim`), enforced by convention, not by this
call site. A future regression in the shim (or an unexpected disk-stall on a networked/loop-mounted
filesystem) would make this hook hang with no bound, defeating the "this hook can never become a
cancellable interception point" guarantee this exact file exists to uphold.

**Fix:** Add a defensive timeout, e.g. `spawnSync(shimBin, [...], { encoding: "utf8", timeout:
2_000 })`, and treat `result.signal` (a `SIGTERM` from a timeout) the same as `result.error` —
fail closed with a distinct reason string, matching this file's own `failClosed` convention.

## Info

### IN-01: Module doc comment miscounts `DestructiveCategory`'s variants as "seven" when there are eight

**File:** `packages/shim/src/main.rs:58-59`, `packages/shim/src/main.rs:579-582`

**Issue:** The module doc and `run_classify_command`'s doc comment both describe
`--classify-command`'s output as "`safe`, or one of `DestructiveCategory::as_str()`'s seven
destructive names." `packages/core/src/destructive.rs:40-49` defines eight variants
(`ForcePush`, `BranchDeletion`, `DefaultBranchPush`, `HardReset`, `ForceClean`, `HistoryRewrite`,
`RecursiveDelete`, `Uncategorized`) — all eight are destructive-category strings the classifier can
emit (matching `pretooluse-hook.ts`'s own `CONSEQUENCE_COPY` table, which correctly has 8 entries
including `uncategorized`). Purely a stale comment, not a behavioral issue.

**Fix:** Update both comments to say "eight."

---

_Reviewed: 2026-09-15T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
