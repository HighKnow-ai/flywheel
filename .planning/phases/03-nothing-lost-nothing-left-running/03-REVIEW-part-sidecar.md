---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-15T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - Cargo.toml
  - packages/shim/Cargo.toml
  - packages/shim/src/main.rs
  - packages/sidecar/package.json
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/mcp-permission-server.ts
  - packages/sidecar/src/pretooluse-hook.ts
  - packages/sidecar/src/watchdog.ts
  - packages/sidecar/test/adapter.test.mjs
  - packages/sidecar/test/destructive-gate.test.mjs
  - packages/sidecar/test/mock-decision-hook.mjs
  - packages/sidecar/test/stop.test.mjs
  - packages/sidecar/test/watchdog.test.mjs
  - DESIGN.md
findings:
  critical: 1
  warning: 4
  info: 1
  total: 6
status: issues_found
---

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
