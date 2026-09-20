---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-20T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - packages/core/Cargo.toml
  - packages/core/src/db/mod.rs
  - packages/core/src/destructive.rs
  - packages/core/src/session_log.rs
  - packages/core/tests/bin/uat_seed_ui.rs
  - packages/core/tests/bin/uat_session_env.rs
  - packages/core/tests/db_bootstrap.rs
  - packages/core/tests/destructive_classifier.rs
  - packages/core/tests/session_log_window.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/item-detail/__tests__/worktree-removal.test.tsx
  - packages/desktop/src/item-detail/__tests__/worktree-summary.test.tsx
  - packages/desktop/src/item-detail/WorktreeRemovalDialog.tsx
  - packages/desktop/src/item-detail/WorktreeSummary.tsx
  - packages/desktop/src/recovery/__tests__/orphan-recovery.test.tsx
  - packages/desktop/src/recovery/OrphanRecoveryModal.tsx
  - packages/desktop/src/session/__tests__/permission-card.test.tsx
  - packages/desktop/src/session/__tests__/session-surface.test.tsx
  - packages/desktop/src/session/PermissionRequestCard.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/shim/src/main.rs
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/test/destructive-gate.test.mjs
  - packages/sidecar/src/pretooluse-hook.ts
  - scripts/uat/lib/long-lived-backend.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/lib/supervisor.mjs
  - scripts/uat/README.md
  - scripts/uat/run-all.sh
  - scripts/uat/uat-01-supervisor-kill.sh
  - scripts/uat/uat-03-destructive-gate.mjs
  - scripts/uat/uat-05-concurrent-commits.mjs
  - scripts/uat/uat-ui-setup.sh
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 03: Code Review Report (Incremental — plans 03-14 through 03-19)

**Reviewed:** 2026-09-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

This is an incremental review of everything that changed since commit `da16c0a` (the prior,
already-merged 03-REVIEW.md), covering plans 03-14 through 03-19: `classify_push`'s branch-deletion
and leading-`+`-refspec fixes (03-14), the permission-card consequence-copy fix for a push-shaped
deletion (03-16), the double-click/double-dispatch synchronous-tick guards added across
`PermissionRequestCard`, `SessionSurface`, `WorktreeRemovalDialog`, and `OrphanRecoveryModal`
(03-16/03-17/03-18), the `MissingWorktreeBanner` gating fix (03-18), the `session_log_path`
path-traversal guard (03-15), the `push_bounded_stderr_tail` UTF-8-boundary panic fix (03-15), the
new `FLYWHEEL_APP_DATA_DIR` test/production seam (03-15), the new `scripts/uat/` live-stack
harnesses (03-15/03-19), and — the highest-stakes change in this window — plan 03-19's rewrite of
`pretooluse-hook.ts` to defer to the shim's own permission socket instead of unconditionally
denying every non-`safe` verdict (G-03-3).

Most of this window is careful, well-tested work: the `classify_push` fixes are backed by thorough
positive/negative test matrices in both Rust and the TS consequence-copy resolver, the ref-guard
double-click fixes all correctly clear their guard on failure and correctly leave it set on success
(verified against each component's own unmount/removal path), and the `session_log_path` guard has
both a Rust-side and a call-site regression test proving a traversal-shaped id is rejected before
any path is even constructible.

However, plan 03-19's central new mechanism — `shimWillIntercept()` in `pretooluse-hook.ts`, which
decides whether the hook may trade its own refusal for the shim's later question — has a real,
provable soundness gap: it proves the shim binary is *reachable* on `PATH`, but never proves that
bash's own command-name resolution for the literal command text will actually *reach* that `PATH`
entry. A destructive `git`/`rm` invocation preceded, in the same command text, by a shell function
definition of the same name resolves to that function (shell function/alias resolution happens
before `PATH` search) — completely bypassing both the hook's new defer branch and the shim itself.
Before this plan, the same command text would have been denied outright (fail-closed); after it,
the hook now allows it through with zero gating. This is a regression this exact plan introduced,
directly in the file it is proudest of hardening. A second, lower-severity finding: the permission
socket's base directory was moved from the OS per-user `os.tmpdir()` to the shared, world-readable
`/tmp` to fix a `SUN_LEN` failure, without also tightening the socket file's own permissions —
narrowing the socket's access boundary on any shared/multi-user machine.

## Critical Issues

### CR-01: `shimWillIntercept()` proves the shim is *reachable*, not that it will *actually intercept* — a shell function/alias definition ahead of the destructive segment bypasses both the hook's new defer branch and the shim itself

**File:** `packages/sidecar/src/pretooluse-hook.ts:101-121` (`shimWillIntercept`) and `:196-203` (the new defer branch)
**Issue:**

Plan 03-19 changed the hook from "deny every non-`safe` verdict" to a two-branch design: defer
(allow) when `shimWillIntercept(program)` is provably true, deny otherwise. `shimWillIntercept`
establishes exactly three facts, all via plain filesystem stat calls against the *hook process's
own* `FLYWHEEL_SHIM_BIN`/`PATH` env vars:

```ts
function shimWillIntercept(program: string): boolean {
  const shimBin = process.env.FLYWHEEL_SHIM_BIN;
  if (!shimBin) return false;
  const pathValue = process.env.PATH;
  if (!pathValue) return false;
  const firstSegment = pathValue.split(pathDelimiter)[0];
  if (!firstSegment) return false;
  if (resolvePath(dirname(shimBin)) !== resolvePath(firstSegment)) return false;
  const candidate = join(firstSegment, program);
  try {
    accessSync(candidate, fsConstants.X_OK);
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}
```

This proves "a shadow `git`/`rm` executable sits at the front of `PATH`." It does **not**, and
structurally *cannot* by inspecting the filesystem alone, prove that the specific raw command text
under classification will actually resolve the bare token `git`/`rm` through a `PATH` search at
all. Bash resolves a simple command's name in this order: **shell functions and aliases first,
then builtins, then `PATH` search.** A command that defines a shell function named `git` earlier in
the *same* command string will have every subsequent bare `git` invocation call that function
instead — `PATH`, and therefore the shim's shadow entry, is never consulted.

Concretely, the command text:

```
git() { /usr/bin/git "$@"; }; git push --force
```

is classified by the (unchanged) `classify_raw_command_text`/`tokenize_shell_words` machinery in
`packages/shim/src/main.rs` exactly as intended for its *last* top-level segment: `program: "git"`,
`category: "force-push"`, `invokedBareName: true` (the token `"git"` contains no `/`). The hook then
calls `shimWillIntercept("git")`, which finds the shadow `git` executable at the front of `PATH` and
returns `true` — so the hook prints `{}` and exits 0, **allowing the tool call to proceed with no
gate at all**. But when bash actually executes the full command text, it resolves the bare `git` in
`git push --force` to the just-defined shell function — which this payload defines to call
`/usr/bin/git` directly, an absolute-path invocation that never touches the `PATH`-shadowed
directory. The force-push executes with zero gating: no hook refusal, no shim `request_permission`
round trip, no `permission_request` ever raised.

**Before plan 03-19**, this exact command text would have been denied outright by the hook (every
non-`safe` verdict was an unconditional `deny`) — so this is a genuine, plan-introduced regression,
not a pre-existing gap. `destructive-gate.test.mjs`'s new `--classify-invocation`/hook tests (lines
260-436) only exercise `shimWillIntercept`'s three documented failure modes (no `FLYWHEEL_SHIM_BIN`,
shim not first on `PATH`, missing shadow entry, absolute-path invocation) — none of them construct a
command whose text itself redefines the destructive program's name before invoking it, so this gap
has no regression test and would not be caught by the existing suite.

The same class of bypass applies to `rm` (`rm() { /bin/rm "$@"; }; rm -rf ...`), and does not
require the more exotic `env`/`sh -c` wrapper forms named in this plan's own threat model — a plain
shell function definition in the same one-line Bash tool call is sufficient, is completely ordinary
POSIX shell syntax, and requires no interactive shell (`bash -c` honors function definitions,
unlike aliases, which need `shopt -s expand_aliases`).

**Fix:** `shimWillIntercept` needs to prove more than "the shadow file exists on `PATH`" — it needs
to prove bash's own name resolution for *this exact command text* cannot be diverted before reaching
`PATH`. Two viable directions:

1. **Narrow the deferral eligibility at the classification boundary.** Have
   `classify_raw_command_text` (or a new check alongside it) reject deferral eligibility — i.e.
   report `invokedBareName: false` — whenever the raw command text contains a function definition,
   `alias`, or (`export`ed or bare) reassignment of `PATH` anywhere before the destructive segment.
   A cheap, effective version: if the text contains `function\s+git\b`, `\bgit\s*\(\s*\)\s*\{`, or
   `\balias\s+git=` (and the `rm` equivalents) ahead of the destructive segment, fail closed
   (`invokedBareName: false`), forcing the hook's existing deny path.
2. **Stop deferring for bare names at all**, and instead widen the hook's own absolute-path-only
   remit — accepting the residual gap that a provably-shim-reachable command still gets a hook-level
   `deny` rather than a shim-level `ask` (regressing Property B for that class, but never regressing
   Property A/safety, which is the property this finding shows is currently violated).

Whichever direction is chosen, add a regression test to `destructive-gate.test.mjs`'s
"pretooluse-hook.ts" section that runs the shipped hook against
`git() { :; }; git push --force` (or an equivalent function-shadow payload) under a correctly-shaped
shim directory, and asserts the hook does **not** defer (`status === 2`, `permissionDecision ===
"deny"`) for it — today it does defer, which is exactly the bug.

## Warnings

### WR-01: The permission socket's base directory was widened from the OS per-user tmp dir to the shared `/tmp`, without tightening the socket file's own permissions

**File:** `packages/sidecar/src/mcp-permission-server.ts:82-105` (`socketBaseDir`), `:143`
**Issue:**

Plan 03-19 changes `startPermissionServer`'s socket path from the default `os.tmpdir()` (on macOS,
a long, per-*user*, mode-0700 path under `/var/folders/.../T/`) to `/tmp` — a directory every local
user on the machine can list and create files in (`drwxrwxrwt`) — specifically to fit
`sockaddr_un`'s `SUN_LEN` limit. The fallback to `os.tmpdir()` only fires if `/tmp` itself is not
writable, so on every normal macOS/Linux install this is now the path taken unconditionally.

The socket filename does carry an unguessable `randomUUID()` component, so a would-be attacker on a
shared machine cannot predict the path — but they do not need to: `/tmp` is listable, so
`flywheel-permission-<uuid>.sock` is trivially discoverable by any other local account simply by
listing the directory while a session is live. Nothing in `startPermissionServer` sets an explicit,
restrictive mode on the socket file after `server.listen(socketPath)` (no `fs.chmodSync` call
anywhere in this file) — the socket inherits whatever the process's default umask produces, which on
most developer machines is `0755` (owner rwx, group/other r-x). Whether that permits a connect from
another local user is somewhat platform-dependent, but relying on umask defaults for a socket that
answers "should this destructive git/rm command be allowed to run" is fragile at best: this is the
one channel that ultimately decides whether a live destructive command executes (D-58), and it now
lives in a directory it did not live in before this plan, with no explicit permission hardening
added to compensate for the move.

This is materially lower severity than CR-01 (it requires a second local account on the same
machine, which is outside this product's stated single-developer local-first threat model), but it
is a real, plan-introduced narrowing of the socket's access boundary, and the fix is cheap.

**Fix:** Immediately after `server.listen(socketPath)`, explicitly set the socket file to
owner-only:

```ts
server.listen(socketPath, () => {
  try {
    fs.chmodSync(socketPath, 0o600);
  } catch {
    // best-effort hardening only — listen() already succeeded
  }
});
```

Consider also verifying the connecting peer's uid via `net.Socket`'s underlying file descriptor
(Node does not expose `SO_PEERCRED`/`LOCAL_PEERCRED` directly, but a native addon or a `ucred`-style
check could be layered on later) if this socket is ever expected to run on genuinely shared
machines; for now the `chmod` alone closes the gap the directory move opened.

### WR-02: `FLYWHEEL_APP_DATA_DIR` override is not validated as absolute, unlike every other path-resolution env var this codebase defines

**File:** `packages/core/src/db/mod.rs:186-207` (`app_data_dir`)
**Issue:**

The new `FLYWHEEL_APP_DATA_DIR` override accepts any non-empty value verbatim:

```rust
fn app_data_dir() -> anyhow::Result<PathBuf> {
    if let Some(over) = std::env::var_os("FLYWHEEL_APP_DATA_DIR") {
        if !over.is_empty() {
            return Ok(PathBuf::from(over));
        }
    }
    ...
}
```

Every other production path-resolution env var in this workspace that this review has seen
(`FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM` in `packages/shim/src/main.rs::resolve_real_binary_from_env`)
explicitly asserts the value is absolute and rejects a relative one with a named error. This
function's own doc comment claims "Never reads or sets the process working directory... an empty
override is ignored rather than resolving to a relative path" — but a *non-empty relative* value
(e.g. a developer accidentally exporting `FLYWHEEL_APP_DATA_DIR=appdata` instead of an absolute
scratch path) is not rejected at all; it silently resolves relative to whatever the process's
working directory happens to be at the moment `app_data_dir()` is first called, which is exactly
the failure mode the doc comment says this function avoids for the *empty* case but does not
actually guard for the *relative* case.

In practice this is scoped to test/UAT harnesses (`scripts/uat/*` always exports an absolute
`mktemp -d`-derived path), so the blast radius today is low — but the function's own doc comment
overstates the guarantee it provides, and a future caller trusting that doc comment could be
surprised.

**Fix:** Mirror `resolve_real_binary_from_env`'s pattern:

```rust
fn app_data_dir() -> anyhow::Result<PathBuf> {
    if let Some(over) = std::env::var_os("FLYWHEEL_APP_DATA_DIR") {
        if !over.is_empty() {
            let path = PathBuf::from(&over);
            anyhow::ensure!(
                path.is_absolute(),
                "FLYWHEEL_APP_DATA_DIR does not name an absolute path: {path:?}"
            );
            return Ok(path);
        }
    }
    ...
}
```

## Info

### IN-01: `push_bounded_stderr_tail` can transiently allocate far beyond `cap` before truncating back down

**File:** `packages/desktop/src-tauri/src/sidecar.rs:211-227` (`push_bounded_stderr_tail`)
**Issue:**

The function's own doc comment frames this fix as being about avoiding a `String::truncate` panic
on a non-UTF-8-boundary cut (correctly fixed — see the well-designed `stderr_tail_tests` module).
It does not, however, bound peak memory the way the original code's structure suggested it might:
`tail.push_str(&String::from_utf8_lossy(bytes))` appends the *entire* incoming chunk before ever
truncating, so a single oversized `CommandEvent::Stderr` chunk (bounded in practice by the OS pipe
buffer / however Tauri's shell plugin chunks stdout, not by anything in this function) is fully
materialized in memory before the subsequent truncate brings `tail` back under `cap`. This is a
pre-existing characteristic of the original code too (not a regression), and the readiness-handshake
window this runs in is short and bounded (`STARTUP_READINESS_TIMEOUT`), so the practical risk is
low — noting it only because the doc comment's framing ("bounded... so a byte flood... cannot grow
this function's memory use") reads as a stronger guarantee than the implementation actually
provides.

**Fix:** If tightening this is ever worth it, truncate the incoming `bytes` slice to at most `cap`
bytes (on a UTF-8-safe boundary) before lossily decoding it, rather than decoding the full chunk and
truncating the `String` afterward. Not urgent given the bounded handshake window.

---

_Reviewed: 2026-09-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
