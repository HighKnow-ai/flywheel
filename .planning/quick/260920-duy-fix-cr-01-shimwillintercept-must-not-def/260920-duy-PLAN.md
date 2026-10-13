---
quick_id: 260920-duy
description: fix CR-01 — a command text that can shadow PATH resolution must never be deferred to the shim
date: 2026-09-20
mode: quick
requirements: [AGNT-07]
files_modified:
  - packages/shim/src/main.rs
  - packages/sidecar/src/pretooluse-hook.ts
  - packages/sidecar/test/destructive-gate.test.mjs
---

# Quick Task 260920-duy — Deferral must prove bash will actually reach the shim

## Why

Plan 03-19 traded the PreToolUse hook's own refusal for the shim's question, gated on
`shimWillIntercept(program)`. That gate proves the shim is **reachable** — `FLYWHEEL_SHIM_BIN` set,
its directory first on `PATH`, an executable shadow named `program` inside it. It does not prove
that bash's own name resolution **for this command text** will ever perform a `PATH` search. Bash
resolves aliases and shell functions before it ever looks at `PATH`; a command that defines a
function named `git` in the same text never reaches the shim at all.

Re-measured against the built binaries during planning (not inherited from the review), with a
correctly-shaped shim directory leading `PATH`:

| command text | `--classify-invocation` today | hook today | correct |
|---|---|---|---|
| `git push --force` | `invokedBareName: true` | `{}` defer | yes |
| `git() { /usr/bin/git "$@"; }; git push --force` | `invokedBareName: true` | `{}` defer | **NO — bypass** |
| `alias git=/usr/bin/git; git push --force` | `invokedBareName: true` | `{}` defer | **NO — bypass** |
| `function git { /usr/bin/git "$@"; }; git push --force` | `invokedBareName: true` | `{}` defer | **NO — bypass** |
| `rm() { /bin/rm "$@"; }; rm -rf /tmp/x` | `invokedBareName: true` | `{}` defer | **NO — bypass** |
| `PATH=/usr/bin git push --force` | `{"category":"safe"}` | `{}` allow | **NO — bypass, and not even classified** |
| `/usr/bin/git push --force` | `invokedBareName: false` | `deny` | yes |
| `git status` | `{"category":"safe"}` | `{}` | yes |

Rows 2-5 are CR-01: a destructive command executes with neither a refusal nor a confirmation, where
before 03-19 it was denied. Row 6 was found while planning this fix and is worse in kind — the
leading `PATH=` assignment token is taken for the program name (`program_stem("PATH=/usr/bin")` is
`bin`, which classifies `Safe`), so the command is never classified as destructive at all, by either
mode. It is the same defect class (text that defeats a `PATH` lookup), it is five lines from the
same function, and it is not a 03-19 regression — it has been open since 03-07. It is in scope here
rather than filed, because leaving a measured, unclassified force-push bypass open while fixing its
siblings would be a silent scope reduction.

**Not in scope, and deliberately so:** wrapper forms (`env git push --force`, `sh -c 'git push
--force'`, `xargs`). They were reasoned through, not overlooked: every one of them still performs a
real `PATH` search for `git` inside the wrapper, so the shim's shadow entry *does* intercept them at
runtime. They are the class the shim genuinely catches; only constructs that **defeat** the `PATH`
search bypass it, and those are exactly what this task detects.

## Decision — the detection belongs in the Rust classifier, not in the hook's TypeScript

`invokedBareName` becomes false for a shadowable text. The hook's decision logic is unchanged (it
already requires `invokedBareName === true`); its only edit is the doc comment. Argued, not
defaulted:

1. **The parser already lives there.** `split_top_level_segments` and `tokenize_shell_words` are in
   `packages/shim/src/main.rs`. A hook-side scan would be a second shell-text parser, in a second
   language, able to disagree with the first — the exact drift class this codebase already paid to
   close once (`is_plausible_run_id` was made to delegate to the shared `is_ulid` rather than
   re-implement it, plan 03-15).
2. **The field was wrong, not merely under-specified.** `main.rs` already documents
   `invoked_bare_name` as "exactly the class the shim's own shadow entry could intercept." A
   function-shadowed `git` is not in that class. Fixing it at the mint site means no present or
   future consumer can re-open the bypass by forgetting a caller-side check; fixing it in the hook
   would leave the field lying to the next reader.
3. **It splits the proof along the only line either side can actually see.** The shim proves the
   *text* property — can name resolution reach a `PATH` search at all? Only the parser can answer
   that. The hook proves the *environment* property — is the shadow installed and first on `PATH`
   right now? Only the hook process can answer that. Both must hold to defer, and neither half can
   establish the other's.
4. **The shim is the thing that must actually intercept.** "Can I be reached by this text?" belongs
   next to the interceptor.

**Rejected:** the review's direction 2 ("stop deferring for bare names at all"). It restores safety
by destroying the confirmation property 03-19 just delivered — the destructive permission card
becomes unreachable from a live session again, and AGNT-07's "require explicit confirmation" goes
back to being a refusal. The narrow fix keeps the ask for the ordinary case and denies only the
shadowed one.

**Residual, named:** the hook's safety now depends on the compiled shim being at least this build.
Production installs both from the same workspace build, and the test suite below resolves the shim
from `target/{debug,release}`, so a stale binary fails the suite rather than passing quietly.

## Tasks

### Task 1 — The classifier refuses to call a shadowable invocation a bare-name invocation

**files:** `packages/shim/src/main.rs`

**action:**

Two changes inside the existing `classify_raw_command_text` machinery. No new parser: reuse
`split_top_level_segments` and `tokenize_shell_words`.

**(a) Add `fn text_can_shadow_path_resolution(text: &str) -> bool`** — true when the raw command
text contains any construct that can pre-empt bash's `PATH` search. Fail closed by design: it
triggers on presence **anywhere** in the text, quoted or not, without trying to establish that the
construct precedes the destructive segment. Two reasons, both worth stating in the doc comment: the
segment splitter is explicitly a pragmatic approximation of shell grammar (its own comment says so),
so positional ordering is too weak a foundation for a security decision; and over-triggering costs
only a deny-instead-of-ask on a destructive command, which is exactly the pre-03-19 behaviour, while
under-triggering costs an ungated force-push.

Triggers, each documented with the resolution step it defeats:

| trigger | detected as | defeats |
|---|---|---|
| `git() {`, `git () {` | a `(` followed by optional whitespace then `)`, scanned over the raw text | shell function definition |
| `function git { … }` | a token equal to `function` | the paren-less definition form |
| `alias git=…` | a token equal to `alias` | alias expansion |
| `hash -p /usr/bin/git git` | a token equal to `hash` | bash's command hash table |
| `eval …`, `source f`, `. f` | a token equal to `eval`, `source`, or exactly `.` | arbitrary definitions pulled in from elsewhere |
| `PATH=…`, `export PATH=…` | the substring `PATH=` over the raw text | the `PATH` search itself |

The empty-parens shape is deliberately narrow enough that command substitution (`$(git rev-parse)`)
and a subshell (`(cd sub && git push)`) do not match — in both, the `(` is followed by a
non-`)` character. `command` and `builtin` are deliberately **not** triggers: both force resolution
past functions and aliases into a `PATH` search, which is where the shim sits, so they reach it.
Keyword triggers are whole-token equality over the already-tokenized segments, never substring
matching, so `unaliased-thing` or a path containing `hash` does not trip them.

**(b) Skip leading `NAME=VALUE` assignment tokens** when choosing a segment's program token, so the
program of `PATH=/usr/bin git push --force` is `git`, not the mis-stemmed `bin`. An assignment token
is one whose first `=` is preceded by a non-empty name matching `[A-Za-z_][A-Za-z0-9_]*` — so
`--flag=value` and `/usr/bin/x=y` are not assignments. A segment consisting only of assignments has
no program and is skipped as before.

Wire both into `classify_raw_command_text`: compute the shadow flag once over the trimmed text
before the segment loop, and set `invoked_bare_name` to `!first.contains('/') && !shadowable`, where
`first` is now the post-assignment-skip program token. Update the `ClassifiedInvocation` doc comment
and the `--classify-invocation` module-level comment so the field's contract reads as the two facts
it now carries: the token names no path, *and* nothing in the text can divert resolution away from
`PATH`.

`--classify-command`'s protocol is untouched — it still reads only `.verdict` and still prints one
word. One deliberate, stated behaviour change follows from (b) and only from (b): for an
assignment-prefixed destructive command it now prints the true category instead of `safe`. That is
the bug being fixed, no existing test asserts that input, and the three inputs the suite does assert
(`branch-deletion`, `safe`, `recursive-delete`) are unchanged — pinned in the verify below.

**verify:**

```bash
cargo build -p flywheel-shim
node -e '
const {execFileSync} = require("node:child_process");
const assert = require("node:assert/strict");
const bin = "./target/debug/flywheel-shim";
const run = (t) => JSON.parse(execFileSync(bin, ["--classify-invocation", t], {encoding:"utf8"}));
const FORCE_SHADOWED = {category:"force-push", program:"git", invokedBareName:false};
// Control: an ordinary bare invocation must STILL be deferrable, or the fix has simply
// destroyed the ask that 03-19 delivered rather than narrowing it.
assert.deepEqual(run("git push --force"), {category:"force-push", program:"git", invokedBareName:true});
assert.deepEqual(run("git push origin --delete x"), {category:"branch-deletion", program:"git", invokedBareName:true});
// The measured bypasses.
assert.deepEqual(run("git() { /usr/bin/git \"$@\"; }; git push --force"), FORCE_SHADOWED);
assert.deepEqual(run("function git { /usr/bin/git \"$@\"; }; git push --force"), FORCE_SHADOWED);
// The space-before-parens spelling classifies on its FIRST segment instead (measured: `git ()`
// tokenizes as program `git` with subcommand `()`, which classify_git already calls uncategorized).
// Still destructive, still a deny — assert what it actually is, not what symmetry suggests.
assert.deepEqual(run("git () { /usr/bin/git \"$@\"; }; git push --force"), {category:"uncategorized", program:"git", invokedBareName:false});
assert.deepEqual(run("alias git=/usr/bin/git; git push --force"), FORCE_SHADOWED);
assert.deepEqual(run("hash -p /usr/bin/git git; git push --force"), FORCE_SHADOWED);
assert.deepEqual(run("PATH=/usr/bin git push --force"), FORCE_SHADOWED);
assert.deepEqual(run("rm() { /bin/rm \"$@\"; }; rm -rf /tmp/x"), {category:"recursive-delete", program:"rm", invokedBareName:false});
// Not triggers: these still reach a real PATH search, so the shim still catches them.
// (Both measured true today — they must stay true, or the detection has over-triggered.)
assert.deepEqual(run("(cd sub && git push --force )"), {category:"force-push", program:"git", invokedBareName:true});
assert.equal(run("echo $(git rev-parse HEAD) && git push --force").invokedBareName, true);
assert.deepEqual(run("git status"), {category:"safe"});
assert.deepEqual(run("GIT_AUTHOR_NAME=x git status"), {category:"safe"});
console.log("classify-invocation shadow detection ok");
'
test "$(./target/debug/flywheel-shim --classify-command 'git push origin --delete x')" = "branch-deletion"
test "$(./target/debug/flywheel-shim --classify-command 'git status')" = "safe"
test "$(./target/debug/flywheel-shim --classify-command 'rm -rf /tmp/x')" = "recursive-delete"
```

**done:** `--classify-invocation` reports `invokedBareName: false` for every text that can divert
name resolution away from `PATH`, still reports `true` for an ordinary bare invocation, and
`--classify-command`'s three asserted outputs are byte-for-byte what they were.

### Task 2 — Regression tests, and a hook comment that stops over-claiming

**files:** `packages/sidecar/test/destructive-gate.test.mjs`, `packages/sidecar/src/pretooluse-hook.ts`

**action:**

**Tests.** Two table-driven additions in `destructive-gate.test.mjs`, placed beside the existing
`--classify-invocation` and `pretooluse-hook.ts` sections, using the existing `makeShimDir` and
`runHook` helpers and gated on `SHIM_SKIP_REASON` exactly as their neighbours are.

*Table A — classifier level.* The same rows as Task 1's verify, asserted through the compiled shim.
This is also the structural proof that the detection shipped in Rust and not in the hook: the hook
is not in this call path at all.

*Table B — hook decision level, the measured table.* Build **one** shim directory containing shadow
entries for both `git` and `rm`, then run the shipped hook against every row below in that same
directory, so the only variable between a defer row and a deny row is the command text. The `rm`
shadow matters: without it the `rm` row would deny for the wrong reason (missing shadow entry) and
prove nothing.

| command text | expect |
|---|---|
| `git push --force` | status 0, decision `{}` |
| `git() { /usr/bin/git "$@"; }; git push --force` | status 2, `permissionDecision: "deny"` |
| `alias git=/usr/bin/git; git push --force` | status 2, `permissionDecision: "deny"` |
| `function git { /usr/bin/git "$@"; }; git push --force` | status 2, `permissionDecision: "deny"` |
| `PATH=/usr/bin git push --force` | status 2, `permissionDecision: "deny"` |
| `rm() { /bin/rm "$@"; }; rm -rf /tmp/flywheel-260920-duy-victim` | status 2, `permissionDecision: "deny"` |
| `/usr/bin/git push --force` | status 2, `permissionDecision: "deny"` |
| `git status` | status 0, decision `{}` |

For each deny row also assert `permissionDecisionReason` matches the classified-destructive copy for
its category (`/force-push/` for the git rows, `/recursively delete/` for the `rm` row). Without that
assertion a deny arriving from the fail-closed path — an un-invokable shim, an unparseable verdict —
would satisfy the test while proving nothing about this fix.

The first row is the falsifiability companion this file's own style requires: if it ever starts
denying, the fix has destroyed the deferral rather than narrowed it, and AGNT-07's confirmation is
gone again.

**Hook comment.** `shimWillIntercept`'s doc comment and the module header currently read as though
that function establishes interception on its own. Rewrite both to state the split settled above:
the shim's classifier proves the command text can still reach a `PATH` search (reported as
`invokedBareName`), this function proves the shadow is installed and leads `PATH` right now, and the
hook may defer only when both hold. Name the bypass class in one sentence so the next reader knows
why the field is not merely a slash check. **No logic change in this file** — it already requires
`invokedBareName === true`, which is the whole reason the fix fits in the classifier.

One mechanical caution: the never-waits source gate below strips `//` lines but not block-comment
`*` lines, so describe the no-socket/no-poll/no-sleep property in plain words and never by naming
the banned APIs, or the new prose invalidates the gate that guards it.

**verify:**

```bash
npm --prefix packages/sidecar run build
node --test --test-name-pattern '^(the (hook|shim)|--classify-command)' packages/sidecar/test/destructive-gate.test.mjs
test "$(grep -v '^[[:space:]]*//' packages/sidecar/src/pretooluse-hook.ts | grep -cE 'createConnection|net\.|setTimeout|setInterval|await new Promise')" = "0"
```

(The name pattern runs the classifier and hook-decision tests only — about two seconds, no live
`claude` turn and no token spend. The full file runs in Task 3.)

**done:** The exact measured bypass payload is asserted `deny` by a checked-in test, the ordinary
bare command is still asserted `{}` in the same shim directory, and the hook still opens no socket,
polls nothing and sleeps never.

### Task 3 — Nothing else moved

**files:** none (acceptance only)

**action:**

Run the suites that own the surrounding behaviour and confirm none of them weakened. All six
pre-existing hook decision cases and both pre-existing `--classify-command` cases must pass
unmodified — if any needed an edit to stay green, stop and re-read Task 1 rather than editing the
test.

Then run the live acceptance harness `node scripts/uat/uat-03-destructive-gate.mjs`. The property
this task needs from it is that a real session still raises a `permission_request` carrying
`destructiveCategory` for a bare `git push --delete` — i.e. the deferral that 03-19 delivered still
works for the ordinary case. Note before running: STATE.md carries an open, un-root-caused finding
that a real session is terminated roughly 15-16 seconds after an unanswered request, so this harness
may still fail its *sustained-block* assertion. That failure is pre-existing and out of scope. A
failure to raise the request at all is not — that would mean this fix over-triggered and swallowed
the ordinary path, and must be fixed here.

**verify:**

```bash
npm --prefix packages/sidecar run test
cargo test -p core
node scripts/uat/uat-03-destructive-gate.mjs
```

**done:** The full sidecar suite and the core Rust tests pass with no existing assertion edited, and
a live session still raises a real destructive `permission_request`.

## Constraints

- **Fail closed.** Any uncertainty about whether bash will reach the shim resolves to `deny`. The
  detection triggers on presence anywhere in the text, never on a positional argument about where
  the construct sits relative to the destructive segment.
- **The hook still never waits.** It classifies, decides and exits; the shim owns the block on
  `FLYWHEEL_PERMISSION_SOCKET`. The 03-07 source gate asserting this is preserved verbatim in
  Task 2's verify.
- **No existing test weakened.** The six hook decision cases and the `--classify-command` cases pass
  unmodified.
- `--classify-command`'s output protocol is unchanged, and its three asserted inputs are
  byte-for-byte unchanged. The single deliberate verdict change (assignment-prefixed destructive
  commands now classify truthfully instead of `safe`) is stated in Task 1 and is the fix for row 6.
- `rm` is in scope exactly as `git` is — `recursive-delete` is one of AGNT-07's three named
  families.

## Follow-ups (not this task)

- The ~15-16s live-session termination after an unanswered permission request (STATE.md, 03-19)
  remains open and unrelated to this fix.
- CR-02/WR-01 from `03-REVIEW.md` (the permission socket's `/tmp` permissions) are untouched here.
