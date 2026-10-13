---
status: complete
quick_id: 260920-duy
description: fix CR-01 — a command text that can shadow PATH resolution must never be deferred to the shim
date: 2026-09-20
commits: 2
---

# Quick Task 260920-duy — Deferral must prove bash will actually reach the shim

## What was built

`packages/shim/src/main.rs`'s `classify_raw_command_text` now computes a second, independent fact
before it will ever call an invocation "bare name": `invoked_bare_name` is `true` only when the
program token names no path AND nothing else in the raw command text can pre-empt bash's own `PATH`
search before it gets there. That second half — `text_can_shadow_path_resolution` — fires on any of:
a shell function definition (`git() {` / `git () {`), the `function` keyword form, `alias`, `hash
-p`, `eval`/`source`/`.`, or a `PATH=` reassignment anywhere in the text. `resolve_segment_program_index`
also now skips leading `NAME=VALUE` assignment tokens AND a leading `env` wrapper (plus its own
assignment arguments) when choosing a segment's program token, so `PATH=/usr/bin git push --force`
and `env PATH=/usr/bin git push --force` both resolve their true destructive program (`git`) instead
of misclassifying the whole command as `safe`.

`packages/sidecar/src/pretooluse-hook.ts` needed no logic change — it already required
`invokedBareName === true` before deferring to `shimWillIntercept`. Its doc comments (module header
and `shimWillIntercept`'s own) are rewritten to state the two-fact split explicitly: the shim's
classifier proves the TEXT property, `shimWillIntercept` proves the ENVIRONMENT property, and both
must hold before the hook defers.

`packages/sidecar/test/destructive-gate.test.mjs` gained two table-driven tests: one asserting the
classifier-level `--classify-invocation` output for every row in Task 1's verify table (structural
proof the detection shipped in Rust, not the hook), and one running the shipped compiled hook against
the measured CR-01 bypass commands plus the ordinary bare command and a safe command, in one shim
directory shadowing both `git` and `rm`, asserting exit status, `permissionDecision`, and — for deny
rows — that `permissionDecisionReason` carries the correct classified-destructive consequence copy.

## Deliberate verdict change (named per the plan's own constraint)

`--classify-command`'s output protocol and its three pinned inputs (`branch-deletion`, `safe`,
`recursive-delete`) are byte-for-byte unchanged — verified below. The one deliberate change, following
from the assignment-skip fix: an assignment-prefixed destructive command (e.g.
`PATH=/usr/bin git push --force`) now prints its true category instead of `safe`. No existing test
asserted that input.

## Widened beyond the plan's own text (orchestrator-provided measurement)

The plan's own Task 1 scope was leading `NAME=VALUE` assignment tokens only. Live measurement taken
by the orchestrator against the rebuilt binary during this session found `env PATH=/usr/bin git push
--force` was a second TRUE bypass the plan's own scope did not cover — `env`'s own `PATH=` argument
also overrides the search `env` performs internally, and the original assignment-skip logic never
looked past a leading `env` token to find the real program. `resolve_segment_program_index` now also
unwraps a single leading `env` wrapper (plus its own leading assignment arguments) before choosing
the program token, closing this row too. `env git push --force` (no `PATH=`) — a "degraded only" row,
not a bypass, since a real `PATH` search still happens and the shim's runtime shadow still gates it —
is unaffected in externally observable behavior: it defers via the `shimWillIntercept` branch instead
of the `category === "safe"` short-circuit, but the hook still prints `{}` and exits 0 either way,
confirmed below.

## Measurement — before/after (this task's acceptance evidence)

`--classify-invocation`, rebuilt binary, this session:

| command text | before (orchestrator measurement) | after (this build) |
|---|---|---|
| `git push --force` (control) | `invokedBareName: true` | `invokedBareName: true` — unchanged |
| `git() { /usr/bin/git "$@"; }; git push --force` | `invokedBareName: true` (bypass) | `invokedBareName: false` — fixed |
| `alias git=/usr/bin/git; git push --force` | `invokedBareName: true` (bypass) | `invokedBareName: false` — fixed |
| `function git { /usr/bin/git "$@"; }; git push --force` | `invokedBareName: true` (bypass) | `invokedBareName: false` — fixed |
| `hash -p /usr/bin/git git; git push --force` | `invokedBareName: true` (bypass) | `invokedBareName: false` — fixed |
| `git () { /usr/bin/git "$@"; }; git push --force` (spaced-paren) | classifies on first segment: `uncategorized`, `invokedBareName: false` | unchanged |
| `PATH=/usr/bin git push --force` | `{"category":"safe"}` — unclassified bypass | `force-push`, `invokedBareName: false` — fixed |
| `env PATH=/usr/bin git push --force` (additional, not in plan text) | `{"category":"safe"}` — unclassified TRUE bypass | `force-push`, `invokedBareName: false` — fixed |
| `PATH=/usr/bin rm -rf /tmp/x` (additional) | `{"category":"safe"}` — unclassified TRUE bypass | `recursive-delete`, `invokedBareName: false` — fixed |
| `FOO=bar git push --force` (degraded only) | `invokedBareName: true` | `invokedBareName: true` — unchanged |
| `env git push --force` (degraded only) | `{"category":"safe"}` | now classifies `force-push`, `invokedBareName: true` — same net hook outcome (defer, exit 0, `{}`), confirmed below |
| `sh -c "git push --force"` (degraded only) | `{"category":"safe"}` | `{"category":"safe"}` — unchanged |
| `bash -c "git push --force"` (degraded only) | `{"category":"safe"}` | `{"category":"safe"}` — unchanged |
| `command git push --force` (degraded only) | `{"category":"safe"}` | `{"category":"safe"}` — unchanged |
| `eval "git push --force"` (degraded only) | `{"category":"safe"}` | `{"category":"safe"}` — unchanged |
| `rm() { /bin/rm "$@"; }; rm -rf /tmp/x` | `invokedBareName: true` (bypass) | `invokedBareName: false` — fixed |
| `(cd sub && git push --force )` (not a trigger) | `invokedBareName: true` | `invokedBareName: true` — unchanged |
| `echo $(git rev-parse HEAD) && git push --force` (not a trigger) | `invokedBareName: true` | `invokedBareName: true` — unchanged |
| `git status` | `{"category":"safe"}` | unchanged |

Shipped hook, end-to-end, one shim directory shadowing both `git` and `rm`, `FLYWHEEL_SHIM_BIN` set
and leading `PATH` correctly:

| command text | hook decision |
|---|---|
| `git push --force` (control) | status 0, `{}` — defers, unchanged |
| `git() { … }; git push --force` | status 2, `deny`, reason matches `/force-push/` |
| `alias git=…; git push --force` | status 2, `deny`, reason matches `/force-push/` |
| `function git { … }; git push --force` | status 2, `deny`, reason matches `/force-push/` |
| `PATH=/usr/bin git push --force` | status 2, `deny`, reason matches `/force-push/` |
| `env PATH=/usr/bin git push --force` | status 2, `deny`, reason matches `/force-push/` |
| `rm() { … }; rm -rf …` | status 2, `deny`, reason matches `/recursively delete/` |
| `/usr/bin/git push --force` | status 2, `deny` (unchanged — absolute path, hook's own refusal) |
| `env git push --force` (degraded only) | status 0, `{}` — defers, same net outcome as before |
| `git status` | status 0, `{}` — unchanged |

## Deviations from Plan

### Auto-fixed Issues

None beyond the deliberate, plan-anticipated verdict change (documented above).

### Scope widening (per explicit orchestrator instruction, not a Rule 1-3 auto-fix)

**1. `env PATH=...` bypass coverage** — the orchestrator's own live measurement against the rebuilt
binary found a second TRUE bypass row (`env PATH=/usr/bin git push --force`) the plan's Task 1 text
did not name. `resolve_segment_program_index` was extended to unwrap a leading `env` token (with its
own leading assignment arguments) so the real program token is found either way. Verified not to
regress any "degraded only" row into `deny` — see the before/after tables above.

## Self-Check

- `packages/shim/src/main.rs` — FOUND (modified, builds clean)
- `packages/sidecar/src/pretooluse-hook.ts` — FOUND (modified, builds clean, no logic change)
- `packages/sidecar/test/destructive-gate.test.mjs` — FOUND (modified, all tests pass)
- Commit `5d7a349` — FOUND in `git log`
- Commit `23c5b99` — FOUND in `git log`

## Verification

- `cargo build --workspace` — clean.
- `cargo test --workspace` — all suites pass, 0 failed.
- `npm --prefix packages/sidecar run test` — 66 pass, 0 fail, 0 skipped (real `claude` binary and
  compiled shim were both available this session).
- `npm --prefix packages/desktop test` — 440 pass across 32 files.
- `node --test --test-name-pattern '^(the (hook|shim)|--classify-command)' packages/sidecar/test/destructive-gate.test.mjs`
  — 12 pass (the Task 2 `<verify>` subset).
- Never-waits source gate (`createConnection|net\.|setTimeout|setInterval|await new Promise` over
  non-`//` lines of `pretooluse-hook.ts`) — `0`, still holds.
- `node scripts/uat/uat-03-destructive-gate.mjs` — the property this task needed held: a real live
  session raised `PROPERTY B.1 — gate raised: category=branch-deletion` for a bare
  `git push --delete`, i.e. the deferral 03-19 delivered still works for the ordinary case. The
  harness's overall assertion still fails on the pre-existing, out-of-scope finding (STATE.md,
  03-19): the session is terminated ~15-16s after the unanswered permission request, before the
  sustained-block assertion can be checked. This is the exact named-acceptable failure mode from the
  plan's own Task 3 — not a regression from this fix.
- No existing test was modified or weakened; all six pre-existing hook-decision cases and both
  pre-existing `--classify-command` cases pass unmodified.

## Follow-ups (not this task, carried from the plan)

- The ~15-16s live-session termination after an unanswered permission request (STATE.md, 03-19)
  remains open and unrelated to this fix.
- CR-02/WR-01 from `03-REVIEW.md` (the permission socket's `/tmp` permissions) are untouched here.

## Commits

| Commit | Scope |
|---|---|
| `5d7a349` | Task 1 — classifier refuses to call a shadowable invocation bare-name (`packages/shim/src/main.rs`) |
| `23c5b99` | Task 2 — regression tests + hook comment rewrite (`packages/sidecar/test/destructive-gate.test.mjs`, `packages/sidecar/src/pretooluse-hook.ts`) |
