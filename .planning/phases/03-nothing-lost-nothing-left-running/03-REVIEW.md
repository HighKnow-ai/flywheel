---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - docs/destructive-gate-trust-boundary.md
  - packages/shim/src/main.rs
  - packages/shim/tests/classify_invocation.rs
  - packages/sidecar/test/destructive-gate.test.mjs
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 03: Code Review Report — round eight (incremental, since `cb790c4`)

**Reviewed:** 2026-09-22
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The four gap-closure findings from the last review (CR-01 brace expansion, WR-01
`readProvenBoolean` null payload, WR-02 `GROUP_3_COMMANDS` index range, WR-03 the C3
enumeration-vs-inversion ruling) all check out — I traced each fix against the code and the new
tests and did not find a regression in any of them. `GROUP_3_COMMANDS` is genuinely derived from
`row.group`, never an index range; the `readProvenBoolean` tests (`p6`/`p7`) genuinely exercise
`null` and a numeric `0`; the WR-03 ruling is correctly reflected in the code (C3 stays a closed,
positive enumeration) and in `ORDINARY_USAGE_CORPUS`'s `git add *.rs` falsifiability row.

But this round's own new work — C5's `raw_text_names_opaque_env_reparse` and C3's brace-adjacency
trigger — leaves open a **live, reproduced, zero-human-confirmation bypass of the destructive
gate**, using the same "env"/"command" wrapper-token class round six and seven just spent two
plans closing, obfuscated by a mechanism (brace expansion) neither C1-C5 nor the wrapper-token
walk was built to see through. I reproduced this three times against the compiled binaries — the
`--classify-invocation` classifier, the real compiled `pretooluse-hook.js` in a genuinely proven
environment, and a live runtime confirmation that Layer 2 provides no backstop either — never
running a real `git`/`rm` against a real target, per D-63. This is the CR-01 finding below and it
is the most important thing in this review.

Two further findings, both WARNING-level: the brace rule's priced friction is materially wider
than what the trust-boundary document prices (an ordinary quoted commit message containing a
letter-adjacent `{word}`/`{word}text` shape now denies, not just the one documented `xargs -I{}
rm {}` row), and the round's own adversarial obfuscation generator (`OBFUSCATION_SPLIT_KINDS`)
was never extended to generate brace-expansion splits even though this same round taught C3 a
whole new brace-expansion mechanism — which is exactly why CR-01 below shipped without the
generator catching it mechanically, the way it caught round six's backslash-split `env` defect.

## Narrative Findings (AI reviewer)

### CR-01: Brace-expansion-obfuscated `env`/`command` wrapper tokens fully defeat the gate — reproduced live, no human confirmation required

**Files:**
`packages/shim/src/main.rs:724-792` (`resolve_segment_program_index`'s `env`/`command` unwrap),
`packages/shim/src/main.rs:856-926` (`text_can_shadow_path_resolution`'s own `env`/`command` token
walk), `packages/shim/src/main.rs:1056-1063` (`raw_text_can_shadow_path_resolution` — the
`raw_text_contains_word` companion that protects six other keywords but not these two),
`packages/shim/src/main.rs:1157-1197` (C5, `raw_text_names_opaque_env_reparse`)

**Issue:**

Round six and seven closed a real bypass in which a backslash-split or launcher-nested `env`
token defeated the gate. Both fixes — the second quote-removed pass in
`resolve_segment_program_index`'s caller, and C5's presence-anywhere scan — recognise `env` (and
`resolve_segment_program_index` also recognises `command`) only as an exact-string TOKEN match,
after C1's quote/backslash removal. Neither ever applies the character-level, word-boundary
substring scan (`raw_text_contains_word`) that protects `git`/`rm` (`text_names_gated_program`)
and the six `KEYWORD_TRIGGERS` — `function`, `alias`, `hash`, `eval`, `source`, `builtin`
(`raw_text_can_shadow_path_resolution`). Those six get a raw-text companion specifically so a
keyword hiding inside a token like `{alias,}` or `al{i,}as` is still found by character-level
scanning; `env` and `command` never got the same companion — `raw_text_can_shadow_path_resolution`'s
own `KEYWORD_TRIGGERS` constant (main.rs:1057) simply does not list them, with no comment
explaining the omission as deliberate.

Bash's brace expansion assembles the literal word `env` (or `command`) from `{env,}` /
`{command,}` — verified live, harmless:

```
$ bash -c '{env,} -S "echo TEST_ENV_BRACE_OBFUSCATION"'
TEST_ENV_BRACE_OBFUSCATION
```

Because the resulting `{`/`}` sit next to whitespace on both sides (not a letter), C3's
brace-adjacency trigger — which is deliberately, correctly, asymmetric and letter-adjacency-scoped
(confirmed by reading `raw_text_word_formation_is_indeterminate`, main.rs:1103-1127, and its own
tests) — never fires either. So this exact obfuscation is invisible to every mechanism this round
shipped.

**Reproduction 1 — the classifier (D-63: `--classify-invocation` only, never executed):**

```
$ target/debug/flywheel-shim --classify-invocation '{env,} -S "-P /tmp git push --force"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation "sh -c '{env,} -S \"-P /tmp git push --force\"'"
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
```

Compare the already-closed, unobfuscated and backslash-split forms of the identical payload, both
correctly fail-closed today:

```
$ target/debug/flywheel-shim --classify-invocation 'env -S "-P /tmp git push --force"'
{"category":"uncategorized","invokedBareName":false,"program":null}
$ target/debug/flywheel-shim --classify-invocation 'e\nv -S "-P /tmp git push --force"'
{"category":"uncategorized","invokedBareName":false,"program":null}
```

Since `textCanShadowPathResolution` and `namesGatedProgram` are never both `true`, D-61's AND-gate
never fires for the brace form. `namesGatedProgram` is honest (`git` is literally present); the
gap is entirely in `textCanShadowPathResolution` staying `false`.

**Reproduction 2 — the real hook, real shim, genuinely proven environment:**

Drove the shipped, compiled `packages/sidecar/dist/pretooluse-hook.js` with `FLYWHEEL_SHIM_BIN`
pointed at a real copy of the compiled shim and the shim's shadow directory genuinely first on
`PATH` (the exact construction `destructive-gate.test.mjs`'s own `makeShimDir`/`runHook` helpers
use):

```
$ FLYWHEEL_SHIM_BIN=$SHIMDIR/git PATH=$SHIMDIR:$PATH node pretooluse-hook.js <<< \
    '{"tool_input":{"command":"{env,} -S \"-P /tmp git push --force\""}}'
{}
exit=0
```

`{}` at exit 0 is "no opinion" — byte-identical to the decision an ordinary `git status` produces
in the same environment. The nested `sh -c '{env,} -S "-P /tmp git push --force"'` form produces
the identical `{}`/exit-0 decision.

**Reproduction 3 — Layer 2 provides no backstop either (D-63: a harmless `git status` payload, a
planted stub, never a real destructive command):**

With the shim's shadow directory genuinely first on `PATH`, and a harmless stub `git` (that only
prints a marker and exits) planted at an alternate directory:

```
$ PATH=$SHIMDIR:$PATH FLYWHEEL_REAL_GIT=$(command -v git) \
    sh -c '{env,} -S "-P '"$ALTDIR"' git status"'
ALTPATH_STUB_REACHED_NOT_THE_SHIM
```

The altpath stub was reached, not the shim — confirming, for this obfuscation mechanism, exactly
what round six's own record already established for the non-obfuscated `-P` form: `env`'s own
`-P` altpath search bypasses the shim's shadow directory entirely at runtime, so there is no
second layer to fall back on once Layer 1 misclassifies the text as `safe`.

**A second, independent instance of the same root cause — `command -p`:**

```
$ target/debug/flywheel-shim --classify-invocation '{command,} -p git push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
```

Compare the unobfuscated form, correctly denied today:

```
$ target/debug/flywheel-shim --classify-invocation 'command -p git push --force'
{"category":"force-push","invokedBareName":false,"program":"git"}
```

`command -p` forces a hardcoded default `PATH` (e.g. `/bin:/usr/bin`) that can never contain the
shim's shadow directory — the same "unconditional, environment-independent bypass" this file's own
doc comment (main.rs:826-830) already names for the unobfuscated form. The brace-obfuscated form
is invisible to the same gap: `resolve_segment_program_index` never recognises `{command,}` as the
`command` wrapper (so it tries, and fails, to classify a program literally named `{command,}`,
which `classify()` does not recognise and reports `Safe`), and neither `text_can_shadow_path_resolution`
nor its raw-text companion nor C5 catch it, for the identical reason.

**Why this is not already covered by the "Named residuals" table:** the table's closest row —
"A gated keyword assembled by a mechanism that is neither C1's quote removal nor one of C3's
named expansion characters" — is scoped to a "gated keyword" installing a shadow (function/alias/
eval/etc., the residual's own examples) and its reopening trigger is "any bypass shape whose raw
text carries none of those characters and still installs a shadow." `env`/`command` are wrapper
tokens, a third category this residual's own language does not name, and the mechanism here is not
"installing a shadow" — it is silently mis-resolving the segment's own program token so the
destructive verdict is never reached at all. Per this document's own "rule for round six": *"A
newly found bypass shape is a boundary failure, not a missing corpus row… Only after this document
is corrected does a new row belong in `LAUNCHER_CORPUS`."* This finding is exactly that — a new
boundary failure, not a corpus gap, and it needs its own named residual/round before a fix lands.

**Fix (concrete direction, not prescriptive):** give `env` and `command` the same raw-text,
word-boundary substring-scan companion the six `KEYWORD_TRIGGERS` and `git`/`rm` already have —
e.g. add `env` and `command` to a `raw_text_contains_word`-based scan feeding `text_can_shadow`
(mirroring C2's existing union-matching discipline), so `{env,}`/`{command,}` are caught by
character-level presence the same way `{alias,}` already is via `raw_text_can_shadow_path_resolution`.
Over-triggering (a false positive costs one deny) is the accepted direction per this file's own
D-61 discipline; under-triggering here costs an ungated force-push with zero confirmation.

### WR-01: The brace rule's priced friction is materially wider than what the trust-boundary document records

**File:** `packages/shim/src/main.rs:1118-1125` (the brace-adjacency loop in
`raw_text_word_formation_is_indeterminate`); `docs/destructive-gate-trust-boundary.md:247-251`
(the "Record the friction..." paragraph) and `:1100-1102` (the brace rule's own doc comment, which
names only `xargs -I{} rm {}` as the priced case)

**Issue:** the document's own accounting paragraph names only `$`/backtick as the AND-gate's
priced friction ("a command whose text names `git` or `rm` and also carries a `$` or a backtick
will be denied where it is deferred today") and the brace rule's own doc comment prices exactly
one row (`xargs -I{} rm {}`). In practice the friction is much broader — any text naming `git`/`rm`
that also contains an ordinary letter-adjacent `{word}` or `{word}text` shape now denies, which is
a common pattern in commit messages, doc edits, and code snippets an agent might legitimately pass
through `git commit -m`. Reproduced against the compiled binary:

```
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "add {foo}bar support"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "fix ${VAR}text bug"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "See docs/{README}text"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
```

Each of these is an ordinary, harmless `git commit` an agent could plausibly write, and each now
denies where it deferred before plan 03-33. `ORDINARY_USAGE_CORPUS` only prices the `xargs -I{} rm
{}` shape; there is no corresponding row for this much more common "ordinary commit message
happens to contain a brace" case.

**Fix:** either broaden the trust-boundary document's friction paragraph to name this class
explicitly (so it is a recorded decision, not a surprise), or add an `ORDINARY_USAGE_CORPUS` row
pricing an ordinary commit-message-with-braces shape the same way the xargs row already prices the
placeholder shape — whichever the team decides, the gap between what is priced and what actually
denies should not persist silently.

### WR-02: `OBFUSCATION_SPLIT_KINDS` never gained a brace-expansion split kind, even though this round taught C3 brace expansion

**File:** `packages/sidecar/test/destructive-gate.test.mjs:1564-1572` (`OBFUSCATION_SPLIT_KINDS`),
`:1641-1669` (`KEYED_WORDS`, which already lists `env` and `command`)

**Issue:** the round-six/seven decision-invariance generator (`obfuscationVariants`) sweeps every
`KEYED_WORDS` entry — including `env` and `command` — across three split mechanisms:
empty-double-quote, empty-single-quote, and backslash. It never generates a brace-expansion split
(`{w,}` or `w{,}`), even though plan 03-33, landing in this very round, taught the classifier a
whole new word-formation mechanism (brace expansion) and even added a dedicated brace-adjacency
trigger to C3. Had a brace-split kind existed in this generator, sweeping `env`/`command` (already
members of `KEYED_WORDS`) with it would have mechanically produced and flagged the exact CR-01
payload above — the same way this generator already caught round six's backslash-split `env`
defect before a human had to find it by hand. This is the precise coverage gap the generator
exists to close, left unclosed for the one word-formation mechanism this round itself introduced.

**Fix:** add a fourth `OBFUSCATION_SPLIT_KINDS` entry (or a parallel generator) that wraps the
keyed word's own text in a `{`/`,}`-style brace pair with an empty second alternative
(`word` → `{word,}`), and sweep it the same way. This would need to run through the invariance
loop's own `KEYED_WORDS`/`GROUP_3_COMMANDS` machinery, not just the two `env`/`command`-specific
payloads CR-01 above uses — the whole point of the existing generator is to make this systematic
rather than hand-written.

---

_Reviewed: 2026-09-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
