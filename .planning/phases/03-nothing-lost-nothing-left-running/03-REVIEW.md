---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-20T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - packages/core/src/db/mod.rs
  - packages/core/src/runtime_protocol.rs
  - packages/core/tests/db_bootstrap.rs
  - packages/core/tests/runtime_protocol.rs
  - packages/shim/src/main.rs
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/src/pretooluse-hook.ts
  - packages/sidecar/src/watchdog.ts
  - packages/sidecar/test/close-provenance.test.mjs
  - packages/sidecar/test/destructive-gate.test.mjs
  - packages/sidecar/test/socket-permissions.test.mjs
  - scripts/uat/lib/sidecar-harness.mjs
  - scripts/uat/README.md
  - scripts/uat/run-all.sh
  - scripts/uat/uat-06-permission-block-lifecycle.mjs
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: issues_found
---

# Phase 03: Code Review Report (Incremental — quick task 260920-duy + plans 03-20 through 03-23)

**Reviewed:** 2026-09-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

This round covers two bodies of work since the last `03-REVIEW.md` (commit `69d9c1a`): quick task
260920-duy's fix for that review's own CR-01 (`shimWillIntercept`'s function/alias/`PATH=` shadow
bypass), and the phase's gap-closure wave (plans 03-20 through 03-23): close-provenance
instrumentation (`watchdog.ts`'s lifecycle JSONL timeline, `claude-code-adapter.ts`'s
`resolveCloseOrigin`), WR-01's permission-socket `chmod(0600)`, and WR-02's
`FLYWHEEL_APP_DATA_DIR` absolute-path guard.

**The three carried-forward findings from the prior review are addressed, verified against the
current code, not merely assumed:**

- **Old CR-01 (`shimWillIntercept` shadow bypass) — FIXED, verified.** `text_can_shadow_path_resolution`
  in `packages/shim/src/main.rs` now detects a shell function definition (`git() {`/`git () {`/
  `function git {`), `alias`, `hash`, `eval`/`source`/`.`, and any `PATH=` occurrence anywhere in the
  raw command text, and forces `invokedBareName: false` for all of them — confirmed by direct
  execution against the compiled `flywheel-shim` binary and by `destructive-gate.test.mjs`'s new
  table (lines 306-560), which exercises every one of the previously-bypassing payloads end-to-end
  through the shipped hook script, not just the classifier. **However, scrutinising this exact fix
  for a sibling gap surfaced a new, equally serious bypass — see new CR-01 below.**
- **Old WR-01 (permission socket left at umask-derived permissions under shared `/tmp`) — FIXED,
  verified.** `mcp-permission-server.ts`'s `startPermissionServer` now calls
  `fs.chmodSync(socketPath, 0o600)` inside the `listen` callback, and `socket-permissions.test.mjs`
  asserts the resulting mode is exactly `0600` and that the owning process can still connect
  afterward — a real, non-tautological test that would fail if the `chmod` call were removed or
  given the wrong mode. The `bind()`-to-`chmod()` window (the socket briefly exists at the
  umask-derived mode before hardening) is real but negligible in this product's stated
  single-developer local-first threat model, and the fallback path (a failed `chmod` degrades to
  "reachable at the previous mode" rather than throwing) is the correct call for a defense-in-depth
  layer whose caller cannot recover from a thrown error here.
- **Old WR-02 (`FLYWHEEL_APP_DATA_DIR` accepted a non-empty relative value) — FIXED, verified.**
  `app_data_dir()` in `packages/core/src/db/mod.rs` now asserts `path.is_absolute()` and returns a
  named error otherwise, mirroring `resolve_real_binary_from_env`'s shape exactly; the doc comment
  now states the actual behaviour. `db_bootstrap.rs` has a new positive test
  (`non_empty_relative_app_data_dir_override_is_rejected_by_name`) and the existing empty/absolute
  cases are re-verified. Every caller of this env var found in `scripts/uat/` (`sidecar-harness.mjs`'s
  `this.appDataDir`, derived from `fs.mkdtempSync(path.join(os.tmpdir(), ...))`) is unconditionally
  absolute, so the new rejection cannot break a legitimate harness invocation.

**New finding this round:** the CR-01 fix narrows `invokedBareName` correctly for shell
functions/aliases/`hash`/`PATH=`, but `classify_raw_command_text`'s own program-token resolution
(`resolve_segment_program_index`) never learned to see through a `command`/`builtin` prefix — an
ordinary, extremely common POSIX idiom used specifically to bypass shell functions and aliases.
Reproduced directly against the compiled binary: `flywheel-shim --classify-invocation "command git
push --force"` returns `{"category":"safe"}`, and the shipped hook script prints `{}` (no opinion)
for it — the exact same effect as a correctly-verified defer, but reached with **zero** verification
that the shim can actually intercept the command, defeating the very safety net `shimWillIntercept`
exists to provide. `command -p git push --force` is worse still: it is a complete, unconditional
bypass regardless of shim installation correctness, since `-p` makes bash search a hardcoded default
`PATH` that never includes the shim's shadow directory at all.

Two further, lower-severity observations from tracing `resolveCloseOrigin`'s evidence precedence and
the new `assertClaudeConfigIsolated` isolation guard are recorded as Warnings below.

## Critical Issues

### CR-01: `command`/`builtin` prefix defeats the destructive classifier entirely — the segment is misclassified as `"safe"`, skipping both `invokedBareName` and the hook's `shimWillIntercept` environment check

**File:** `packages/shim/src/main.rs:596-628` (`resolve_segment_program_index`) and `:630-685`
(`text_can_shadow_path_resolution`'s own doc comment, which states the false premise this bug
disproves)
**Issue:**

`resolve_segment_program_index` skips a leading run of `NAME=VALUE` assignment tokens, and — added by
plan 03-20 to close the measured `env PATH=... git ...` gap — a single leading `env` wrapper token
plus its own assignments. It does **not** skip a leading `command` or `builtin` token, even though
both are ordinary POSIX shell prefixes whose entire purpose is to force name resolution to bypass
shell functions and aliases (`command`) or to force a shell-builtin lookup (`builtin`) — the same
class of resolution-altering wrapper `env` already receives special handling for.

Consequently, for the raw command text `command git push --force`, `tokenize_shell_words` produces
`["command", "git", "push", "--force"]`; `resolve_segment_program_index` returns index `0` (no
assignment, and `tokens[0] != "env"`); `program_stem("command")` is `"command"`; and
`classify("command", ["git", "push", "--force"], ..)` returns `Verdict::Safe`, because
`destructive::classify`'s own top-level dispatch (`packages/core/src/destructive.rs`, its own module
doc comment lines 17-25) returns `Safe` for any program name outside `git`/`rm` by construction — it
has no opinion on `"command"` at all. The entire segment is therefore classified `Safe`, and
`--classify-invocation` never even reaches the point of computing `program`/`invokedBareName` for it.

Reproduced directly against the compiled binary:

```
$ ./target/debug/flywheel-shim --classify-invocation "command git push --force"
{"category":"safe"}
$ ./target/debug/flywheel-shim --classify-invocation "command -p git push --force"
{"category":"safe"}
$ ./target/debug/flywheel-shim --classify-invocation "builtin git push --force"
{"category":"safe"}
```

And end-to-end through the shipped hook script (no shim directory on `PATH` at all in this
reproduction — the hook never even gets far enough to check):

```
$ echo '{"tool_input":{"command":"command git push --force"}}' \
    | FLYWHEEL_SHIM_BIN=$(pwd)/target/debug/flywheel-shim node packages/sidecar/dist/pretooluse-hook.js
{}
```

This differs from a correctly-established defer in a way that matters: `pretooluse-hook.ts`'s
`category === "safe"` branch (`:210-213`) returns `{}` (no opinion) **unconditionally**, without ever
calling `shimWillIntercept`. For an ordinary bare `git push --force`, the hook only defers after
proving the shim's shadow directory is actually installed and leads `PATH` right now — the whole
point of that check is to catch the case where the shim environment is *not* correctly wired (a
misconfigured session, a future regression in `shim_env_for_run`, a test harness that forgot to set
`FLYWHEEL_SHIM_BIN`). `command git push --force` skips that verification entirely: if the shim
environment happens to be broken in exactly the scenario `shimWillIntercept` exists to catch, this
command sails through with **no gate of any kind** — not a hook denial, not a shim-level `ask`. In a
correctly-configured environment the plain `command` form (no `-p`) is still caught at execution time
by the shim's own `argv[0]` dispatch (since `command` without `-p` still searches the *current*
`$PATH`, which the shim shadows) — but `command -p git push --force` defeats even that: `-p` makes
bash search a fixed, default system `PATH` (e.g. `/bin:/usr/bin`) that never contains the shim's
shadow directory, so this form bypasses the shim unconditionally, with no dependency on any
misconfiguration at all.

The `text_can_shadow_path_resolution` doc comment (main.rs:650-654) states the reasoning that was
supposed to make this safe: *"`command` and `builtin` are deliberately NOT triggers: both force
resolution past functions/aliases into a real `PATH` search, which is exactly where the shim sits."*
This reasoning is correct **only if** `classify()` is actually applied to the real program name
(`"git"`) after unwrapping the `command`/`builtin` prefix — which `resolve_segment_program_index`
never does. The premise the fix relies on is false in the current implementation, which is exactly
why this shipped without a regression test catching it: `destructive-gate.test.mjs`'s CR-01 table
(lines 306-365) exercises `function`/`alias`/`hash`/`PATH=`/`env` forms exhaustively but never a
`command`/`builtin` prefix.

**Fix:** Unwrap a leading `command`/`builtin` token in `resolve_segment_program_index`, exactly the
way `env` is already unwrapped (including `command`'s own `-p`/`-v`/`-V` flags and any
`NAME=VALUE` arguments that may follow), so `classify()` is applied to the real program name:

```rust
fn resolve_segment_program_index(tokens: &[String]) -> Option<usize> {
    let mut idx = 0;
    while idx < tokens.len() && is_assignment_token(&tokens[idx]) {
        idx += 1;
    }
    if matches!(tokens.get(idx).map(String::as_str), Some("env") | Some("command") | Some("builtin")) {
        idx += 1;
        // Skip `command`'s own flags (-p, -v, -V) and any leading NAME=VALUE assignments.
        while idx < tokens.len()
            && (is_assignment_token(&tokens[idx]) || tokens[idx].starts_with('-'))
        {
            idx += 1;
        }
    }
    if idx < tokens.len() { Some(idx) } else { None }
}
```

Then, separately, make `command -p ...`/`command --default-path ...` an unconditional
`text_can_shadow_path_resolution` trigger (forcing `invokedBareName: false`) — unlike plain
`command`/`builtin`, `-p` genuinely defeats the shim regardless of environment correctness, so it
belongs in the same "cannot be proven safe" bucket as `PATH=`, not the "still reaches the shim's own
`PATH` search" bucket `command`/`builtin` alone are correctly placed in once the unwrap above lands.

Add a regression row to `destructive-gate.test.mjs`'s CR-01 table for `"command git push --force"`
(expect `category: "force-push"`, `invokedBareName: true`, since a bare `command git ...` still
reaches a real `PATH` search once unwrapped) and for `"command -p git push --force"` (expect
`invokedBareName: false`, since `-p` defeats the shim unconditionally) — today both silently return
`{"category":"safe"}` and neither would be caught by the existing suite.

## Warnings

### WR-01: `resolveCloseOrigin`'s `signal_forwarded` → `supervisor-signal` rule is effectively unreachable, giving false confidence that the close-provenance instrument distinguishes an externally-signalled shutdown from a genuine backend exit

**File:** `packages/sidecar/src/claude-code-adapter.ts:519-565` (`resolveCloseOrigin`) and
`packages/sidecar/src/watchdog.ts:266-289` (the `child.on("exit")` and signal-forwarding handlers)
**Issue:**

`resolveCloseOrigin`'s documented precedence order treats the lifecycle file's last parseable line
being `event: "signal_forwarded"` as evidence of `"supervisor-signal"` (rule 5, the fallback below
the kill-record and `stale_kill` checks). This rule is reachable only when `interruptionRequested` is
`false` (rule 1 always wins otherwise) **and** the lifecycle file's actual last line is
`signal_forwarded` rather than `backend_exit`.

Tracing `watchdog.ts`'s own event ordering shows this second condition is almost never true in
practice. When the watchdog forwards `SIGINT`/`SIGTERM` to the backend child (`:281-289`), it appends
`signal_forwarded` and then calls `child.kill(signal)`; once the backend actually exits from that
signal, the SAME process's `child.on("exit")` handler (`:266-270`) appends `backend_exit` — which,
being written strictly after `signal_forwarded` on every path where the forwarded signal takes
effect, becomes the new last line before `process.exit()` runs. The only two callers that route
through the adapter's own `interruptSession`/`killSession` (`claude-code-adapter.ts:882-940`) already
set `interruptionRequested = true` *before* signalling, so rule 1 resolves those cases before the
lifecycle file is ever consulted — meaning `resolveCloseOrigin`'s own fallback logic (rules 2-5) is
reached only for a termination the adapter itself did not initiate (e.g. an external `kill -TERM`
sent directly to the watchdog's process group, a session survived across an app restart, a shell
`Ctrl-C` on the whole foreground process group). In precisely that scenario — the one case rule 5
exists to attribute correctly — the trailing `backend_exit` line wins instead, and the termination is
misreported as `"backend-exit"` rather than `"supervisor-signal"`.

`close-provenance.test.mjs`'s own "supervisor-initiated" test (`:244-276`) only exercises the
`interruptionRequested`-true path (via `adapter.killSession`), so it cannot and does not exercise
rule 5 at all — there is no test in this file (or anywhere else in the reviewed set) that drives a
session to close via an externally-forwarded signal without going through the adapter's own
`interruptSession`/`killSession`, so this misattribution has no regression coverage either.

This is a diagnostics-only field (`closeOrigin` does not gate any execution decision), so it carries
no safety risk — but it does directly undermine plan 03-20's own stated purpose ("name which of three
mechanisms ended the session instead of guessing from the exit code alone") for exactly the
externally-signalled case, which is a real operational scenario (OS logout, a supervisor process
outside this app's own control, a manual `kill`).

**Fix:** Either (a) have the watchdog's signal handler set a flag it checks before appending
`backend_exit`, downgrading that append (or annotating it) so a `backend_exit` line that followed a
`signal_forwarded` line within the same run is still attributable to the forwarded signal — e.g. fold
the two into a single terminal lifecycle event (`{event: "backend_exit", via_signal: "SIGTERM"}`) —
or (b) have `resolveCloseOrigin` scan the lifecycle file for *any* `signal_forwarded` line, not only
the very last one, when the last line is `backend_exit` immediately preceded by a `signal_forwarded`
line for the run. Either way, add a test that spawns a session via `ClaudeCodeAdapter` and sends
`SIGTERM` directly to the watchdog's process group (bypassing `interruptSession`/`killSession`
entirely) to prove rule 5 (or its replacement) actually resolves to `"supervisor-signal"` in that
case.

### WR-02: `assertClaudeConfigIsolated` compares raw strings, so a `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` override that is (or contains) a symlink into the developer's personal `~/.claude` passes the isolation check while still resolving there

**File:** `scripts/uat/lib/sidecar-harness.mjs:49-64` (`assertClaudeConfigIsolated`)
**Issue:**

`assertClaudeConfigIsolated` correctly fails closed on the two cases its own doc comment names — a
missing/empty `CLAUDE_CONFIG_DIR`, and a value that equals or has `PERSONAL_CLAUDE_CONFIG_DIR` as a
path-separator-bounded prefix (the `!value.startsWith(\`${PERSONAL_CLAUDE_CONFIG_DIR}${path.sep}\`)`
check correctly handles the "differs only by a trailing separator" case named in this review's own
brief: a value ending in exactly `PERSONAL_CLAUDE_CONFIG_DIR + path.sep` is caught by the `startsWith`
arm even though it fails the plain `!==` arm). Both checks are pure string comparisons against
`PERSONAL_CLAUDE_CONFIG_DIR`, computed once via `path.join(os.homedir(), ".claude")` — neither ever
calls `fs.realpathSync` on the candidate value.

`cleanClaudeConfigEnv()` (`:240-247`) accepts `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR` as an operator-supplied
"durable override" pointing at "a directory a human has already staged, outside this process, with a
real login copied into it" — by its own design, an externally-controlled path this code does not
create. If that path is, or contains, a symlink resolving into the developer's real `~/.claude` (for
example `FLYWHEEL_UAT_CLAUDE_CONFIG_DIR=/tmp/staged-claude-config` where
`/tmp/staged-claude-config -> ~/.claude`, an easy mistake when staging a "real login" directory by
hand, or a stale symlink left over from a previous manual setup step), the string comparison sees a
path that neither equals nor is prefixed by `PERSONAL_CLAUDE_CONFIG_DIR` and passes the assertion —
while Claude Code itself, given that `CLAUDE_CONFIG_DIR`, would open the real personal directory the
whole mechanism exists to keep these live, cost-incurring UAT runs away from.

**Fix:** Resolve both sides through `fs.realpathSync` (tolerating `ENOENT` for a path that does not
exist yet, in which case the raw comparison is the best available check) before comparing:

```js
function resolveIfExists(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return p; // does not exist yet — compare the raw value, the best available check
  }
}

export function assertClaudeConfigIsolated(env) {
  assert.ok(/* ...unchanged presence check... */);
  const personalResolved = resolveIfExists(PERSONAL_CLAUDE_CONFIG_DIR);
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    const resolved = resolveIfExists(value);
    assert.ok(
      resolved !== personalResolved && !resolved.startsWith(`${personalResolved}${path.sep}`),
      `HARNESS FAILURE: spawn environment key "${key}" resolves to the developer's personal Claude ` +
        `config directory (${PERSONAL_CLAUDE_CONFIG_DIR}) via ${value}`,
    );
  }
}
```

## Info

### IN-01: `clear_run_runtime_files` stops at the first removal failure, potentially leaving later per-run files (including the new lifecycle timeline) behind

**File:** `packages/core/src/runtime_protocol.rs:361-380` (`clear_run_runtime_files`)
**Issue:**

The function's own doc comment states it "resolves ... who cleans stale files up" and implies all
four per-run files (`runs/`, `kills/`, `contention/`, and now `lifecycle/`) are removed together.
The loop over `paths`, however, `return`s `RuntimeIo::WriteFailed` on the first non-`NotFound`
error it hits, never attempting the remaining entries in the list. Since `lifecycle_dir` is now the
last of the four paths checked, a permission or transient I/O error removing the run descriptor or
kill record (checked first) would leave the lifecycle timeline (and any entries after the failing
one) on disk indefinitely — a resolved orphan's diagnostic files could accumulate rather than being
fully cleaned up, contrary to the doc comment's "no per-run diagnostic file outliving the run it
describes" claim. This is pre-existing loop structure (not introduced by plan 03-23's addition of the
fourth path) and the failure mode itself is rare (`fs::remove_file` failing for a reason other than
"not found" on a local scratch directory), so this is recorded as informational rather than a
warning.

**Fix:** Attempt every path unconditionally and collect failures, returning `WriteFailed` only if at
least one non-`NotFound` error occurred, so a failure removing one file never prevents an attempt at
the others:

```rust
let mut first_error = None;
for path in paths {
    if let Err(err) = fs::remove_file(&path) {
        if err.kind() != std::io::ErrorKind::NotFound && first_error.is_none() {
            first_error = Some(format!("failed to remove {path:?}: {err}"));
        }
    }
}
match first_error {
    Some(message) => RuntimeIo::WriteFailed(message),
    None => RuntimeIo::Written,
}
```

---

_Reviewed: 2026-09-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
