---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-15T09:27:25Z
depth: standard
files_reviewed: 31
files_reviewed_list:
  - packages/core/Cargo.toml
  - packages/core/src/db/migrations/0006_recovery_statuses.sql
  - packages/core/src/db/migrations/0007_destructive_gate.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/destructive.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/permission_request.rs
  - packages/core/src/domain/task.rs
  - packages/core/src/domain/worktree.rs
  - packages/core/src/git_retry.rs
  - packages/core/src/git.rs
  - packages/core/src/lib.rs
  - packages/core/src/query/agent_runs.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/query/permissions.rs
  - packages/core/src/query/recovery.rs
  - packages/core/src/runtime_protocol.rs
  - packages/core/src/shim.rs
  - packages/core/tests/bin/commit_stress_harness.rs
  - packages/core/tests/destructive_classifier.rs
  - packages/core/tests/git_retry.rs
  - packages/core/tests/launch_reconciliation.rs
  - packages/core/tests/lock_contention.rs
  - packages/core/tests/permission_gate.rs
  - packages/core/tests/reconcile_worktrees.rs
  - packages/core/tests/recovery_statuses.rs
  - packages/core/tests/recovery_summary.rs
  - packages/core/tests/runtime_protocol.rs
  - packages/core/tests/session_close_lifecycle.rs
  - packages/core/tests/spawn_stagger.rs
  - packages/core/tests/task_delete_with_run_history.rs
  - packages/core/tests/worktree_removal.rs
findings:
  critical: 1
  warning: 4
  info: 1
  total: 6
status: issues_found
---

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
