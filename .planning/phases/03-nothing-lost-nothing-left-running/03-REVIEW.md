---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - packages/shim/src/main.rs
  - packages/sidecar/src/pretooluse-hook.ts
  - packages/sidecar/test/destructive-gate.test.mjs
  - docs/destructive-gate-trust-boundary.md
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 03: Code Review Report (round six — reviewing round five's changes)

**Reviewed:** 2026-09-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

This is round six of an adversarial review of the destructive-gate closure. Round five's C1-C4
contract (`shell_quote_removed`, `raw_text_word_formation_is_indeterminate`,
`text_names_gated_program`, `raw_text_can_shadow_path_resolution`) genuinely closes the specific
counterexample it was built against — the quote/backslash-split `eval`/`git` obfuscations — and
`readProvenBoolean`'s tri-state read genuinely closes WR-01 (a missing/malformed field can no
longer be silently absorbed by the other field's real `false`). The already-known, already-carried
`env -S`/backslash residual (round six proper, documented in
`docs/destructive-gate-trust-boundary.md` and `KNOWN_OPEN_BOUNDARY_FAILURES`) is correctly scoped
and correctly falsifiability-checked; I did not re-report it.

Per this review's brief, I spent my own attention on: (1) whether C3's trigger set
(`$`, backtick, letter-adjacent `*`/`?`/`[`) is the complete set of bash mechanisms that determine
word formation, and (2) whether `resolve_segment_program_index`'s wrapper-recognition defect (only
ever walking the RAW, non-backslash-resolved token stream) generalizes beyond `env`.

**On (2): no new live bug found.** I checked `command -p`, `env -i`, `env -u PATH`,
`env --unset=PATH`, `builtin`, and a bare `PATH=` assignment under backslash-obfuscation
(`c\ommand -p …`, `e\nv -i …`, `e\nv -u PATH …`, `b\uiltin …`, `PA\TH=… `) directly against the
compiled binary. Every one of them is caught (`textCanShadowPathResolution:true`, hook denies) —
NOT via `resolve_segment_program_index`'s own wrapper recognition (which does fail to recognise the
obfuscated wrapper token, exactly as it does for `env -S`), but via a second, independent backstop:
`classify_raw_command_text` runs `text_can_shadow_path_resolution` a SECOND time over
`shell_quote_removed(trimmed)` (main.rs:1142-1151), and that C1-normalized text is re-tokenized and
re-scanned, catching the obfuscated wrapper/flag combination on the second pass. `env -S` has no
such backstop specifically because `text_can_shadow_path_resolution` deliberately excludes `-S` from
its own trigger set by design (per its own doc comment, main.rs:790-796), delegating that case
entirely to `resolve_segment_program_index`'s `Unresolvable` arm — which is exactly the one path
with no second-pass backstop. So the round-six residual is narrower than "any sibling wrapper path
has the same defect" — it is specifically "any `env` flag `text_can_shadow_path_resolution` does not
independently re-check" (i.e. `-S` and any unrecognised flag), which the document already names in
general terms. This is a verification, not a finding — recorded here so it isn't silently re-derived
next round.

**On (1): a genuine, undocumented gap, but not a proven full bypass.** See CR-01 below — bash brace
expansion is a real, unaddressed word-formation mechanism, confirmed live (never against a real
git/rm) to make `text_names_gated_program`'s `false` claim unsound for text the scanner reports as
naming neither gated program. I was not able to construct a full end-to-end zero-confirmation
exploit within this review's budget (Layer 2's own `argv[0]` dispatch backstops the one live
construction I found), but the gap itself is real, is not named anywhere in the trust boundary
document, and — per that document's own stated discipline — an unnamed gap is a finding regardless
of whether I could escalate it to a full exploit chain.

## Critical Issues

### CR-01: Bash brace expansion is an unaddressed word-formation mechanism — `namesGatedProgram`'s `false` is not sound for it

**File:** `packages/shim/src/main.rs:925-1066` (`shell_quote_removed`,
`raw_text_word_formation_is_indeterminate`, `text_names_gated_program`,
`raw_text_can_shadow_path_resolution`)
**File:** `docs/destructive-gate-trust-boundary.md:150-211` (C1-C4 contract, Named residuals)

**Issue:** C1 (`shell_quote_removed`) strips only `'`, `"`, and backslash-escapes. C3
(`raw_text_word_formation_is_indeterminate`) treats only `$`, a backtick, and a letter-adjacent
`*`/`?`/`[` as indeterminate. Neither touches `{`, `}`, or `,` — the syntax of bash brace expansion,
a real, unconditional (no matching-filename requirement, unlike globbing) word-formation mechanism
that runs before every other expansion. This is a distinct mechanism from parameter/command/
arithmetic expansion (all `$`-prefixed, already covered) and from pathname globbing (already
covered by C3's `*`/`?`/`[` rule) — the review brief's own list of constructs to check against C3's
trigger set names it explicitly, and it is not among the six.

Confirmed live, non-destructively (D-63 — `echo`/`env`/`set --` only, never git or rm):

```
$ echo {gi,}t push --force
git t push --force
$ echo {r,}m -rf /tmp/nonexistent-x
rm m -rf /tmp/nonexistent-x
$ target/debug/flywheel-shim --classify-invocation '{gi,}t push --force'
{"category":"safe","namesGatedProgram":false,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation '{r,}m -rf /tmp/nonexistent-x'
{"category":"safe","namesGatedProgram":false,"textCanShadowPathResolution":false}
```

`text_names_gated_program`'s own doc comment (main.rs:977-989) claims to answer "does the raw
command text name one of the two programs `install_for_run` shadows." For this text it answers
`false` — but the real shell, confirmed live, resolves the first word to the literal program name
`git`/`rm` via ordinary word formation the scanner never modelled. This is exactly the class
`docs/destructive-gate-trust-boundary.md`'s own "Round six" section warns about: "a scanner field
whose `false` is read as proof is a claim, not a measurement." Neither the C1-C4 contract, the
"Explicitly cannot see" lists, nor the Named residuals table names brace expansion anywhere — the
document's only generic catch-all residual ("A gated keyword assembled by a mechanism that is
neither C1's quote removal nor one of C3's named expansion characters") is worded around the six
shadow-construct *keywords* (`function`/`alias`/`hash`/`eval`/`source`/`builtin`), not around
`text_names_gated_program`'s own "names git/rm" claim — a different function with its own, separate
soundness claim that this residual does not cover.

**What I could and could not escalate this to, stated plainly so the finding is not overclaimed:**
- I attempted to build a brace-expansion `PATH=` override (`PA{T,}H=/tmp git push --force`, which
  DOES expand to two leading words `PATH=/tmp PAH=/tmp` — confirmed via `set --`). This does **not**
  work as an attack: bash decides whether a word is a leading assignment lexically, on the word as
  WRITTEN, before brace expansion ever runs (confirmed live: `bash -c 'PA{T,}H=/tmp env | grep
  ^PATH='` errors `command not found: PATH=/tmp`, proving bash tries to *execute* the expanded
  result rather than treat it as an assignment). This specific vector is closed by shell semantics,
  not by the classifier.
- For the `{gi,}t`/`{r,}m` program-name case above, Layer 2 (the shim's own `argv[0]` dispatch,
  `packages/shim/src/main.rs`'s `run_git`/`run_rm`) still backstops the actual `execvp` in a
  genuinely proven environment, because nothing about brace expansion pre-empts the real `PATH`
  search the way a function/alias/`PATH=` shadow does — confirmed by classifying the REAL forwarded
  argv the shim would receive: `--classify-command 'rm m -rf /tmp/x'` → `recursive-delete`. So
  neither construction I found is, by itself, a full zero-confirmation bypass.
- I did **not** manage to construct a clean brace-expansion obfuscation of one of the six shadow
  *keywords* (`eval`/`function`/`alias`/`source`/`hash`/`builtin`) — the one class that WOULD defeat
  Layer 2 too, the way round five's `eval` obfuscation did — because brace expansion with any
  `,`-separated alternative structurally produces two-or-more resultant words at the split position,
  and every reconstruction I tried (`{ev,}al …`, `{funct,}ion …`, `{ali,ali}as …`) either shifted a
  subsequent argument's position and broke the intended syntax, or (for `alias` specifically)
  depends on `expand_aliases` being enabled, which bash disables by default in non-interactive
  scripts — I could not rule this out, only fail to construct it in the time available.

**Fix:** Extend C1/C3 (or add a C5) to treat brace-expansion syntax (`{`, `}`, `,` inside an
unquoted, unescaped run) as either normalized-away (mirroring C1's quote/backslash removal, computing
all brace-expansion alternatives and re-running the existing scan over each) or as a new
indeterminacy trigger (mirroring C3's glob-adjacency rule: a `{`/`}`/`,` immediately adjacent to a
letter/digit/`_` reports "cannot prove absence" rather than a confident `false`). At minimum, before
either is implemented, add brace expansion to
`docs/destructive-gate-trust-boundary.md`'s Named residuals table with its own concrete reopening
trigger, so a future reader does not have to rediscover this by reading source — the document's own
rule for round six ("a newly found bypass shape is a boundary failure... amend this document first")
applies here.

## Warnings

### WR-01: `readProvenBoolean`'s test suite never exercises an explicit `null` payload

**File:** `packages/sidecar/src/pretooluse-hook.ts:209-221`
**File:** `packages/sidecar/test/destructive-gate.test.mjs:1147-1213`

**Issue:** `readProvenBoolean`'s own doc comment explicitly names the cases it exists to collapse to
`undefined`: "absent, `null`, a string, a number." The WR-01 regression test (`p1`-`p5`) exercises an
entirely-absent field (`p1`, `p2`) and a non-boolean string (`p3`), but never a field explicitly
present with value `null` (e.g. `JSON.parse('{"textCanShadowPathResolution":null,...}')`). The
current implementation (`typeof value === "boolean" ? value : undefined`) is correct for `null` by
inspection — `typeof null === "object"` — but the doc comment's own enumeration of cases is not
matched by the test's own enumeration of payloads, so a future refactor of `readProvenBoolean` that
accidentally special-cased `null` (e.g. `value === null || value === undefined ? undefined : value`,
which would let a numeric `0`/`NaN` slip through as falsy-not-`false`) would not be caught by this
suite.

**Fix:** Add a sixth payload to the WR-01 test — `{ category: "safe", textCanShadowPathResolution:
null, namesGatedProgram: true }` — asserting deny with the reason naming
`textCanShadowPathResolution`, mirroring `p1`/`p2`/`p3`.

### WR-02: `GROUP_3_COMMANDS`'s index-range derivation is not robust to a same-length reorder of `LAUNCHER_CORPUS`

**File:** `packages/sidecar/test/destructive-gate.test.mjs:1420-1430`

**Issue:** `GROUP_3_START_INDEX = 16` / `GROUP_3_END_INDEX = 23` are guarded only by
`assert.equal(LAUNCHER_CORPUS.length, 29, ...)` (line 1600-1603). That guard catches a row being
added or removed anywhere in the array, but not a reorder that preserves the total count — e.g.
swapping a Group 4 row with a Group 3 row while leaving the array at 29 entries would silently
mistag which rows receive the midpoint-split augmentation (`obfuscationVariantDetails`'s own
extra coverage for the seven rows inside an opaque `sh -c '...'` payload), with no test failure to
flag it. The comment at line 1420-1425 acknowledges the array "can only drift if the corpus's own
row count or group boundaries change" but the length assertion only checks the first half of that
claim.

**Fix:** Derive `GROUP_3_COMMANDS` by filtering on a stable marker instead of a fixed index range —
e.g. tag each `LAUNCHER_CORPUS` row with its own `group: 3` field (cheap, and also documents intent
inline) and build the set via `LAUNCHER_CORPUS.filter(r => r.group === 3)`, or at minimum assert that
`LAUNCHER_CORPUS[GROUP_3_START_INDEX].command` and `LAUNCHER_CORPUS[GROUP_3_END_INDEX - 1].command`
equal their expected literal strings so a reorder trips a assertion instead of silently mistagging.

### WR-03: `obfuscationVariants` can only regression-test the three obfuscation mechanisms its authors already knew about

**File:** `packages/sidecar/test/destructive-gate.test.mjs:1438-1513`

**Issue:** `OBFUSCATION_SPLIT_KINDS` is a fixed array of three character-insertion patterns (empty
double-quote, empty single-quote, backslash) — exactly the mechanisms round five's own bypasses used.
The generator has no way to produce, and therefore no way to ever flag, an obfuscation built from a
categorically different bash mechanism — brace expansion (CR-01 above), tilde expansion, `$'...'`
ANSI-C quoting-as-a-literal-word, or any future construct. This is precisely why CR-01 was not caught
by this suite despite the suite's own stated purpose ("a future row gains this adversarial coverage
the instant it is written... rather than waiting for someone to remember its hand-written obfuscated
twin — the exact pattern that let round five ship undetected", lines 1230-1236): the generator only
protects against regressions in the mechanisms it was built to sweep, not against the next
categorically-new mechanism, which is exactly the situation round five itself was in before it was
found. This is not a defect in the generator's own logic (its three mechanisms are swept correctly
and exhaustively across the whole corpus), but the suite's framing risks reading "the generator
sweeps the corpus" as "the corpus is now protected against obfuscation" when it is only protected
against the three known mechanisms.

**Fix:** No code fix required, but the module comment (lines 1230-1236) and
`docs/destructive-gate-trust-boundary.md`'s own framing of the generator should say plainly that
`OBFUSCATION_SPLIT_KINDS` is a closed, named list of mechanisms, not an open-ended fuzzer, so a
future reader does not mistake "the sweep passed" for "no new word-formation mechanism can bypass
this."

## Info

### IN-01: `obfuscationVariantDetails` only ever obfuscates the FIRST occurrence of a keyed word in a row's command text

**File:** `packages/sidecar/test/destructive-gate.test.mjs:1454-1479`

**Issue:** `obfuscationVariantDetails` finds the first word-boundary match and stops (`break` at line
1476 once `occurrenceIndex` is set). Several `LAUNCHER_CORPUS` rows contain the same keyed word more
than once — e.g. `'git() { /usr/bin/git "$@"; }; git push --force'` contains `git` three times — but
the generator only ever produces variants that split the FIRST occurrence. A hypothetical bug that
only manifests when a LATER occurrence of a keyword is the one obfuscated (e.g. the function body's
own inner `git`, or the trailing invocation rather than the definition) would never be exercised by
this sweep.

**Fix:** No action required for this review's scope — flagging for awareness. If the generator is
extended later, consider sweeping all occurrences of a keyed word per row, not just the first.

---

_Reviewed: 2026-09-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
