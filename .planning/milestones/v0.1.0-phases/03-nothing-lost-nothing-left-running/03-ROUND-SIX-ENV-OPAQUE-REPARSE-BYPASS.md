# Round six — `env -S`'s opaque-reparse wrapper detection, backslash-split — open finding

**Status:** OPEN — found 2026-09-21, during plan 03-31 (building the WR-02 decision-invariance
generator); not yet planned or fixed.
**Requirement:** AGNT-07 — "Destructive actions (force-push, branch deletion, recursive delete)
always require explicit confirmation, even when the session is running in an auto-accept
permission mode."
**Recorded:** 2026-09-21, during `/gsd-execute-phase 03` plan 03-31 execution.
**Severity:** Critical in kind. Proven live and non-destructively to reach zero human confirmation
at any layer, for a real, executable shell construct — not a hypothetical. Narrower in practice than
round five: it requires the specific `env -S` shape plus a nested PATH-defeating flag inside the
re-split argument (e.g. BSD `env`'s `-P` altpath), which is a less common idiom than round five's
plain function-shadow shapes.

## Why this file exists

`docs/destructive-gate-trust-boundary.md`'s own "rule for round six" requires that a newly found
bypass shape be treated as a **boundary failure**, documented and the boundary corrected, before any
corpus row addresses it. This file is that record. `docs/destructive-gate-trust-boundary.md` has
already been amended (Named residuals table + a new "Round six" narrative section) to carry this
finding; a future plan closes it in code.

Plan 03-31's own objective was to make the corpus "catch itself" — replace hand-written obfuscated
corpus rows with a generator (`obfuscationVariants`) asserting decision invariance under ordinary
shell obfuscation, mechanically, over every existing row. It worked exactly as designed: sweeping all
eleven keyed words (`function`, `alias`, `hash`, `eval`, `source`, `builtin`, `command`, `env`,
`PATH`, `git`, `rm`) against all twenty-nine `LAUNCHER_CORPUS` rows (141 generated variants) found
**exactly one** decision-invariance break — and, on inspection, that break generalizes to a real,
live, zero-human-confirmation bypass.

## The finding

Word `env`, row `env -S 'git push --force'` (`LAUNCHER_CORPUS` group 2, expects `deny`), split kind
backslash-at-offset-1: `e\nv -S 'git push --force'`.

```
$ target/debug/flywheel-shim --classify-invocation "env -S 'git push --force'"
{"category":"uncategorized","invokedBareName":false,"program":null}
$ target/debug/flywheel-shim --classify-invocation "e\nv -S 'git push --force'"
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
```

Through the real hook (`runHook`, proven shim environment, both `git`/`rm` shadowed):

```
env -S "-P /tmp git push --force"   => status 2, permissionDecision "deny"
e\nv -S "-P /tmp git push --force"  => status 0, no opinion (defer)
```

A real shell resolves `e\nv` identically to `env` (confirmed live, harmless payload only, D-63):

```
$ sh -c 'e\nv -S "echo REAL_ENV_RESOLVED_S_FLAG"'
REAL_ENV_RESOLVED_S_FLAG
```

## Root cause

`env -S STRING` re-splits `STRING` into its own argv, shell-style — including any further env flags
or `PATH=` assignment the string itself carries. `packages/shim/src/main.rs`'s
`resolve_segment_program_index` cannot safely re-parse that opaque re-split, so it forces
`ProgramResolution::Unresolvable` (which `classify_raw_command_text` turns into an unconditional
`Destructive(Uncategorized)`/deny) whenever it recognises the literal token `env` immediately
followed by `-S`, or any other unrecognised `env` flag (BSD's `-P` altpath, `-C` altwd, `-0`, `-v`).

That recognition is a **whole-token equality check** over `tokenize_shell_words(trimmed)` — the RAW,
un-normalized segment text, walked exactly once inside `classify_raw_command_text`'s segment loop
(`main.rs:1154`, `for segment in split_top_level_segments(trimmed)`). Unlike every other mechanism
plan 03-30's C1-C4 contract protects, this walk is **never retried against `shell_quote_removed`'s
output**. `tokenize_shell_words` resolves quote-TOGGLING correctly (so `e""nv`/`e''nv` are already,
correctly, recognised as `env` today — quote-adjacency concatenation was never broken by this), but
performs **zero backslash-escape resolution**. `e\nv` therefore never equals the literal string
`env`, and the wrapper is never recognised — the segment falls through to ordinary, non-gated
program-token treatment (`"e\nv"` is not `git`/`rm`, so the verdict is `Safe`).

Once the verdict is `Safe`, the two D-61 facts C1-C4 DO protect (`textCanShadowPathResolution`,
`namesGatedProgram`) are evaluated — and for THIS row's own harmless payload (`'git push --force'`,
no nested `PATH=`/`-i`/`-P`), neither fact happens to trigger (no shadow keyword, no `PATH=`
substring, `-S`'s own quotes get incidentally stripped by the SAME `shell_quote_removed` used
elsewhere, occasionally revealing a nested flag as a naive top-level token — which is how `-i`
happens to still get caught, by luck, while `-P` does not, because `-i` is one of the few flags this
scanner's `env`-branch explicitly checks for and `-P` is not).

**This is NOT a regression of C1-C4.** C1 (quote/backslash removal), C2 (union matching), C3
(indeterminacy) and C4 (bare-name scope) all hold exactly as plan 03-30 implemented them, for the
narrow class they were written to cover — the SAFE-verdict's own two D-61 facts. The break is in an
ADJACENT mechanism C1-C4 was never designed to reach: the wrapper-token recognition that decides
whether the invocation is even classified as `Unresolvable` in the first place, upstream of the
safe-verdict facts entirely.

## Exploitability — read this before prioritizing

- **Requires two things together:** (1) an agent (or something upstream of it) emitting a
  backslash-split `env` — an unusual shape for a coding agent to produce spontaneously, though
  trivially producible by a prompt-injected instruction or a malicious skill/tool definition — and
  (2) `env -S`'s own opaque re-split argument carrying a PATH-defeating flag the raw-text scan does
  not separately catch (proven: BSD `-P` altpath; NOT proven, but plausibly also open: any other
  env-implementation-specific search-path override this scanner's `env`-branch does not explicitly
  enumerate).
- **Proven live, non-destructively (D-63):** a harmless stub named `git` placed at an attacker-
  controlled altpath ran INSTEAD of the shim's real shadow entry, with the shim shadow directory
  genuinely first on `PATH` and a bare `git status` in the identical environment confirmed to reach
  the shim correctly as a control. This is not reasoning about what *might* happen — it is what
  *did* happen, for a harmless payload standing in for a destructive one.
- **Layer 2 does NOT provide a backstop here**, unlike Group 1's launcher shapes (`sh -c`, `nice`,
  …): `env -P`'s whole purpose is to search an ALTERNATE path for the program, so the shim's shadow
  directory is never consulted at all — this is closer in kind to `sudo`'s `secure_path` residual
  (already named, already deferred) than to an ordinary launcher wrapper.

## Disposition

Carried as a single, precisely-scoped, falsifiability-checked exception
(`KNOWN_OPEN_BOUNDARY_FAILURES` in `packages/sidecar/test/destructive-gate.test.mjs`) rather than
silently narrowing the WR-02 invariance sweep around it. The exception:

- fails loudly if a future fix closes the gap without updating the list (the row would start
  denying again, and the test's own assertion against the row's ORIGINAL expectation would then
  need the exception removed — the falsifiability check confirms the exception is still being
  exercised, catching the case where a corpus/word-list change silently stops reaching it); and
- is logged via a `console.warn` banner on every suite run naming this file and the boundary
  document's Named residuals table.

**AGNT-07 stays `Gaps Found`.** Requirements-completed tracking for plan 03-31 does not include
AGNT-07 for this reason, matching the same disposition prior rounds (see
`03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`) used when a bypass was found mid-closure.

## Recommended fix shape for round seven (not built here — scope, not solution)

Two candidate directions, matching the two options `docs/destructive-gate-trust-boundary.md`'s
"What was deliberately not done" section already weighs for the class generally:

1. **Extend the wrapper-token recognition itself** — retry `resolve_segment_program_index`'s
   `env`/`command`/`builtin` token-equality checks against `shell_quote_removed`'s output, the same
   way the safe-verdict's own C1-C4 facts already do, so a quote/backslash-split wrapper token is
   recognised identically to an unsplit one. Narrowest fix; keeps the existing philosophy intact.
2. **Widen the trigger, deliberately over-denying** — treat ANY quote character or backslash
   appearing directly adjacent to (or inside a run of letters spelling) `env`, `command`, or
   `builtin` as itself grounds to deny, mirroring the interim mitigation
   `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`'s own CR-01 fix considered for the raw-text scan.

Either requires a plan of its own, following the boundary-document-first ordering
`docs/destructive-gate-trust-boundary.md`'s "rule for round six" establishes — not folded into the
corpus-generator plan (03-31) that found it.
