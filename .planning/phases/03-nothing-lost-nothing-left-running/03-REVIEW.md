---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-21T02:23:21Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - docs/destructive-gate-trust-boundary.md
  - packages/core/src/shim.rs
  - packages/core/tests/git_retry.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/shim/src/main.rs
  - packages/sidecar/src/pretooluse-hook.ts
  - packages/sidecar/test/destructive-gate.test.mjs
  - scripts/uat/README.md
  - scripts/uat/run-all.sh
  - scripts/uat/uat-07-launcher-shape-gate.mjs
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-09-21T02:23:21Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This is round five of a destructive-gate closure whose own decision record predicts that the next
bypass will again be found by someone looking, not by the enumeration catching itself. It was found
by looking, and it is real: `packages/shim/src/main.rs`'s D-61 raw-text shadow-construct scan
(`raw_text_can_shadow_path_resolution` / `text_names_gated_program`, both built on
`raw_text_contains_word`) is a naive literal-substring match with no shell-quoting awareness. A
trivially ordinary shell obfuscation — splitting a keyword with an adjacent empty quote pair or a
backslash (`e""val`, `e\val`, `g""it`) — is resolved by any real POSIX shell back into the plain
word, but is invisible to this scanner. I reproduced this end-to-end against the actual compiled
`flywheel-shim` binary and a real `/bin/sh`: the classifier reports a `safe` verdict with
`textCanShadowPathResolution: false` for a command that, when actually executed, defines a shell
function shadowing `git` and then calls it — the exact class D-59/D-60/D-61 exist to close, with
**zero** human confirmation reached at any layer. This is not the residual the trust-boundary
document already names (that residual is about a definition sourced from an *external file*; this
is the keyword hiding in plain sight in the *same* command text via ordinary quote mechanics) — per
the document's own rule, this is a boundary failure, not a known-open case, and the document is
wrong until corrected.

Two secondary findings accompany it: a latent fail-open composition gap in `pretooluse-hook.ts`'s
own "missing field → unsafe" discipline that the AND-combination silently defeats (currently
unreachable given the shipped binary's behavior, but contradicts the file's own stated invariant),
and the total absence of any adversarial-obfuscation row in `LAUNCHER_CORPUS` — the same gap in test
coverage that let four prior rounds, and now this one, ship without the enumeration catching itself.

## Critical Issues

### CR-01: D-61's raw-text shadow scan is defeated by ordinary shell quote/backslash splitting of the keyword itself — a full destructive-gate bypass, reproduced live

**File:** `packages/shim/src/main.rs:906-972` (primitive: `raw_text_contains_word`, consumers:
`text_names_gated_program`, `raw_text_can_shadow_path_resolution`), reached through
`packages/sidecar/src/pretooluse-hook.ts:263-286`

**Issue:** `raw_text_can_shadow_path_resolution` and `text_names_gated_program` both scan the raw
command text for a keyword as a literal, contiguous, word-bounded substring
(`raw_text_contains_word`). This is the layer D-61 introduced specifically to see *inside* an opaque
single-quoted `sh -c '…'` payload that the whole-token scan cannot split — but it does no
shell-quoting normalization of its own. Any construct a real shell resolves back into a plain word —
an adjacent empty quote pair (`e""val`, `e''val`) or a backslash escape (`e\val`) — reads as a
*different* string to this scanner (the keyword is not contiguous), while a real `/bin/sh` merges it
into the exact same word it would form unobfuscated.

I reproduced this against the real compiled binary and a real shell:

```
$ target/debug/flywheel-shim --classify-invocation \
    "sh -c 'e\"\"val \"\$(cat ./defs.sh)\"; git push --force'"
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
```

(Control, unobfuscated `eval` in the same position, correctly reports `textCanShadowPathResolution:
true`.) And confirmed the obfuscated form is genuinely honored by a real shell, including the actual
attack shape — a shell function shadowing `git` defined via the hidden `eval`, then invoked bare in
the same payload:

```
$ sh -c 'git() { echo "SHADOWED FUNCTION CALLED INSTEAD OF REAL GIT"; }; \
    e""val "git() { echo shadowed; }"; git status'
shadowed
```

End to end: `pretooluse-hook.ts`'s safe branch (lines 276-282) computes `textCanShadow =
classification.textCanShadowPathResolution !== false` → `false`; the AND-gate at line 278
(`textCanShadow && namesGatedProgram`) is `false && true` → the command is **not** denied — the hook
prints `{}` (no opinion) and the tool call proceeds. The real shell then executes the obfuscated
`eval`, installs the shadow function, and the subsequent bare `git status`/`git push --force` in the
*same* shell context is intercepted by that shell function before any `PATH` search ever runs — Layer
2 (`packages/shim/src/main.rs`'s `argv[0]` dispatch, D-51) never sees an `execvp` of a shadowed name
at all, because the function resolves before `PATH` resolution is ever consulted. No layer asks a
human. The same primitive also lets `git`/`rm` itself be hidden from `namesGatedProgram`
independently (`g""it push --force` → `namesGatedProgram: false`), which is a second way to defeat
the same AND-gate.

This is not "sudo's `secure_path`" or "an indirection sourced from an external file" — the two
residuals `docs/destructive-gate-trust-boundary.md`'s Named-residuals table (lines 100-105) already
names for Layer 1's text scan. The documented residual is specifically about a definition living in
a *file the text only names* (`source ./somefile.sh`); this bypass needs no external file at all —
the keyword is present in the very same command text, merely reassembled by ordinary shell word
formation the scanner never performs. Per the trust boundary document's own closing rule ("The rule
for round five", lines 156-165): this is a boundary failure. **Layer 1 (`pretooluse-hook.ts`, via
the shim's `--classify-invocation` text facts) is the layer trusted to prove "nothing in the raw
command text … can pre-empt bash's own PATH search before it happens" (trust-boundary doc, line
45-55) and it does not** — the document's "Trusted to prove" claim for Layer 1 is false as written
and must be corrected before another corpus row is added, exactly as the document itself requires.

**Fix:** The raw-text scanners need to operate on shell-word-normalized text, not literal source
bytes — at minimum, strip adjacent empty-quote pairs (`''`, `""`) and backslash-escapes from the raw
text (a cheap, conservative normalization pass — it does not need to be a full shell parser) before
running `raw_text_contains_word`, mirroring the same quote-concatenation handling
`tokenize_shell_words` already performs correctly for the top-level, non-opaque case. Given this
file's own stated philosophy ("over-triggering costs only a deny-instead-of-ask … under-triggering
costs an ungated force-push" — line 787), an acceptable interim mitigation is to widen the trigger
further: treat *any* quote character (`'`, `"`) or backslash appearing directly adjacent to (or
inside a run of) letters that could plausibly spell a gated keyword as itself a
`textCanShadowPathResolution` trigger, deliberately over-denying rather than risk this exact silent
miss. Whichever fix ships, add `LAUNCHER_CORPUS` rows exercising both the `""`-split and
`\`-split forms (see WR-02) so this class cannot regress silently a sixth time.

## Warnings

### WR-01: The safe branch's "missing field → unsafe" discipline does not survive its own AND-combination

**File:** `packages/sidecar/src/pretooluse-hook.ts:276-282`

**Issue:** The module doc comment (lines 34-37) states: "An unreported or non-boolean-`false` field
is read as `true` (unsafe)." That is true *per field*, but the two fields are then ANDed
(`textCanShadow && namesGatedProgram`) to decide whether to deny. If a shim binary ever reports only
one of the two D-61 fields (e.g. a future partial/buggy revision emits
`{"category":"safe","namesGatedProgram":false}` with `textCanShadowPathResolution` entirely absent),
the missing field correctly defaults to `true` (unsafe) in isolation, but the AND with the genuinely
present `false` collapses the whole expression to `false` — the hook **defers** despite one of the
two required proofs being entirely unestablished. This exactly re-creates the asymmetric-trust shape
that produced the original D-59 finding, just one level down. It is not reachable today: every
`ClassifiedInvocation` return path in `packages/shim/src/main.rs` sets both `text_can_shadow` and
`names_gated_program` together, and `serde_json::json!` always serializes both keys for a `bool`
field, so the shipped binary can never emit one without the other. It is nonetheless a latent
fail-open composition bug that contradicts the file's own stated invariant, and it means the
install-time `verify_shadow_entry_speaks_classification` probe (`packages/core/src/shim.rs:276-330`)
— which only checks that both fields are present as booleans for ONE fixed probe text — is not
sufficient future-proofing against this specific composition failure if a later change to
`classify_raw_command_text` ever separates the two computations.

**Fix:** Treat "either field unprovable" as denying on its own, independent of the other field's
value — e.g. `if (textCanShadow === undefined-as-unsafe || namesGatedProgram === undefined-as-unsafe)
deny for that reason alone`, before ever evaluating the AND for the genuine-values case. Concretely,
distinguish "field absent/malformed" from "field present and `false`" at the type level (e.g. an
explicit tri-state) so a missing field cannot silently participate in the AND as if it were a
verified `false`.

### WR-02: `LAUNCHER_CORPUS` has no row exercising keyword obfuscation inside a quoted payload

**File:** `packages/sidecar/test/destructive-gate.test.mjs:1052-1098` (Group 3), and the file's own
module doc comment's framing of what the corpus is "evidence for"

**Issue:** Group 3 of `LAUNCHER_CORPUS` (the set only D-61 catches) exercises `function`, `alias`,
`hash`, `eval`, `source`, and the `()`-adjacent function-definition shape — but every row spells the
keyword literally and unobfuscated inside the quoted `sh -c '…'` payload. None exercises the
trivially-available shell idiom of splitting the keyword with an empty quote pair or a backslash
(CR-01). This is precisely the class of gap the file's own doc comment (lines 1-32) says the prior
four rounds shared: "Each round was found by someone looking, never by the enumeration catching
itself." The corpus currently cannot catch CR-01's class even after it is fixed, because nothing in
it regresses if the fix is later reverted or narrowed.

**Fix:** Add corpus rows for at least `e""val`/`e\val` (and the `g""it`/`g\it` variant defeating
`namesGatedProgram` directly) once CR-01 is fixed, each asserting `expect: "deny"` — mirroring the
existing Group 3 rows' shape exactly, so a future regression on either scanner is caught by the
existing "unprovable matrix" and unwrapped-corpus test machinery without any new test infrastructure.

---

_Reviewed: 2026-09-21T02:23:21Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
