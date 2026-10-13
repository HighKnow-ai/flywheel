---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-15T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src-tauri/src/state.rs
findings:
  critical: 2
  warning: 2
  info: 1
  total: 5
status: issues_found
---

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
