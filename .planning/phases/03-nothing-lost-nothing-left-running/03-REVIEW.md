---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - .planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md
  - docs/destructive-gate-trust-boundary.md
  - packages/shim/src/main.rs
  - packages/shim/tests/classify_invocation.rs
  - packages/sidecar/test/destructive-gate.test.mjs
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 3: Code Review Report (incremental — round-eight gap closure, plans 03-35/03-36)

**Reviewed:** 2026-09-22
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This is an incremental review of the six commits closing round eight of the destructive-gate
bypass class (plans 03-35 and 03-36): the promotion of `env`/`command` wrapper-token recognition
from exact-string-equality (C5) to word-boundary containment (C6), the fail-closed extension for
indeterminate flag/NAME positions, and the mechanical brace-expansion sweep added to the
adversarial corpus.

I did not find a bypass (a real destructive invocation that the gate would classify `safe` and let
through unasked). I compiled `flywheel-shim` and drove `--classify-invocation` directly against
several hand-constructed adversarial payloads not present in either corpus — brace/dash hybrid
flag tokens (`command -{p,} ...`), glob-obfuscated `--unset` NAME arguments
(`env -u PA[T]H ...`), and individually-quoted flag tokens inside a nested launcher
(`sh -c 'env "-S" "..."'`) — and in every case the existing C3/C4/C6 machinery already denies or
the real shell itself fails to execute the payload as an attacker would need it to (verified live,
non-destructively, per this codebase's own D-63 discipline). `cargo test -p flywheel-shim` (20/20)
and the sidecar's `destructive-gate.test.mjs` suite (all subtests, including the round-eight rows)
pass as shipped.

What I did find is a **materially under-priced friction regression** introduced by this round's
own C6 promotion: the trust-boundary document's own soundness claim for C6 ("needs ... a token
carrying BOTH a brace-or-glob character AND a dash") is false. An entirely ordinary quoted
argument — no brace, no glob, no obfuscation of any kind — that happens to mention `env`/`command`
immediately followed by one of their gated flags (`-p`, `-i`, `-u`, `-S`) anywhere in prose (a
commit message, a `--grep` pattern, a code comment passed as an argument) now denies whenever the
text also names `git`/`rm`. This is exactly the kind of language this very subsystem's own commits
and documentation use constantly, so it is likely to bite this project's own future development.
Full reproduction and root-cause trace below (WR-A). This is a WARNING per the review's own
weighting (over-refusal, not a bypass), but it directly contradicts a claim this round's own
authors wrote down as fact, and no test in either file catches it.

I also flag one maintainability concern (INFO): the wrapper-flag-walk logic for `env`/`command` is
now independently hand-duplicated in three functions in `packages/shim/src/main.rs`, kept in sync
only by doc-comment cross-references, not shared code.

`03-REQUIREMENTS-BOOKKEEPING.md` is a narrative/bookkeeping record with no executable content; I
checked its factual claims (the seven-plus-one requirement rows' current status) against a direct
`grep` of `.planning/REQUIREMENTS.md` and found no discrepancy — every row still reads exactly
`Gaps Found`, matching the document's own claim.

## Warnings

### WR-A: C6's own documented soundness claim is false — plain (non-obfuscated) mentions of `env`/`command` flags in ordinary quoted text now deny, not just the "contrived" brace case the doc and tests price

**File:** `packages/shim/src/main.rs:1232-1300` (`raw_text_names_path_defeating_wrapper`, C6), cross-referenced against `docs/destructive-gate-trust-boundary.md:234-326` (the C6 clause and its "priced friction" paragraph) and `packages/sidecar/test/destructive-gate.test.mjs:2075-2082` (`ORDINARY_USAGE_CORPUS`'s one C6 friction row)

**Issue:** The trust-boundary document states C6's new friction class as narrowly as:

> "a token carrying a non-letter-adjacent brace or glob AND a `-`, standing immediately where
> `env`'s or `command`'s own flag belongs, in text that also names `git` or `rm`. ... What C6
> deliberately does NOT charge, and why: bare presence of the word `env` or `command` would have
> denied `command -v git` and `git commit -m "fix the command parser"` (both measured as deferring
> today)"

and the corresponding test comment (`destructive-gate.test.mjs:2075-2082`) repeats the same claim
almost verbatim, presenting `git commit -m "the command {-p,} form"` as "the contrived one" versus
two plain-English defer rows ("fix the command parser", "set env vars") that supposedly prove C6
did not become a bare-presence scan.

This claim is false. `raw_text_names_path_defeating_wrapper` scans **two forms** of the text: the
raw text, and `shell_quote_removed(text)` (C1/C2's union, reused here). `shell_quote_removed`
strips every `'`/`"` character with **no quoting-context tracking at all** — that is its whole
documented purpose (context-free removal, to catch nested-shell re-parsing). The side effect: a
double-quoted argument like `"the command -p form"` — a single shell WORD, with internal spaces
that are *not* real word boundaries — has its quotes stripped and is then **re-tokenized on
whitespace by `tokenize_shell_words`**, at which point "the", "command", "-p" and "form" become
four *separate* array elements. The wrapper-flag walk (`j = i + 1`, `tokens.get(j)`) sees "-p"
immediately following "command" and fires — with **no brace, no glob, and no obfuscation
whatsoever** in the original text.

Verified live against the compiled `flywheel-shim` binary (`--classify-invocation`, D-63 — no
destructive command executed):

```
$ flywheel-shim --classify-invocation 'git commit -m "the command -p form"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}

$ flywheel-shim --classify-invocation 'git commit -m "document the command -p flag behavior"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}

$ flywheel-shim --classify-invocation 'git commit -m "the env -i flag clears vars"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}

$ flywheel-shim --classify-invocation 'git commit -m "describe env -u PATH behavior"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}

$ flywheel-shim --classify-invocation 'git commit -m "use env -S here"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}

$ flywheel-shim --classify-invocation 'git log --grep "the command -p flag"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
```

Every one of these denies today, combined with D-61's AND-gate whenever the text also names
`git`/`rm` — which an ordinary commit message about *this exact feature* routinely will (this
review's own required-reading files use phrases like "env -u PATH", "command -p", "env -S" dozens
of times). Compare the control, which correctly still defers because it has no dash-flag word
immediately after "command"/"env":

```
$ flywheel-shim --classify-invocation 'git commit -m "fix the command parser"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
```

Root cause: the flag-adjacency design (`raw_text_names_path_defeating_wrapper`'s `j = i + 1` walk)
assumes that "the next array element after the wrapper token" reflects real adjacency in the
shell's own word structure. C1's context-free quote removal (a deliberate, documented,
over-triggering-by-design choice for the *nested-shell* case) breaks that assumption for text
*inside* a single quoted argument: two words that are only adjacent because they share one quoted
string become adjacent tokens after quote removal, exactly reproducing the "ordinary mention"
over-triggering the flag-qualification (`-p`/`-i`/`-u`/`-S` instead of bare presence) was
specifically designed to avoid. C5 (round seven) already had this same defect for `env` alone (I
verified `git commit -m "use env -S here"` above); C6 (this round) newly extends it to `command`
and to `env`'s `-i`/`-u` flags, which is squarely inside this review's diff.

This is not caught by any existing test: `ORDINARY_USAGE_CORPUS`'s only C6-friction row uses the
brace-wrapped form (`"the command {-p,} form"`), and no row exercises a plain, non-obfuscated
mention of a recognised flag word after "env"/"command" in prose. The mechanical
`obfuscationVariants` sweep (`destructive-gate.test.mjs`) only generates variants from
`LAUNCHER_CORPUS` *commands* (real invocations), never from prose-in-quotes shapes, so it cannot
surface this either.

**Fix:** Either (a) narrow the flag-adjacency check so it is computed only within a single
`tokenize_shell_words` token's own *original* quoted span (i.e., derive adjacency before
`shell_quote_removed` collapses the quoting structure, not after), so that quote-internal spaces
are not mistaken for real word boundaries — likely by having the quote-removed retokenization
retain quote-boundary markers rather than plain whitespace-splittable text; or (b) if the false
positive is judged an acceptable/deliberate trade like C3's brace-adjacency cost, correct the trust
boundary document's soundness claim to state the true (much broader) scope, and add a representative
non-brace `ORDINARY_USAGE_CORPUS` row (e.g. `git commit -m "document the command -p flag behavior"`,
expect `deny`) so the cost is priced rather than contradicted by the document's own text.

### WR-B: The `env`/`command` wrapper flag-walk is hand-duplicated across three functions with no shared implementation

**File:** `packages/shim/src/main.rs:725-813` (`resolve_segment_program_index`), `:877-947` (`text_can_shadow_path_resolution`), `:1232-1300` (`raw_text_names_path_defeating_wrapper`)

**Issue:** The logic for walking past `env`'s own recognised flags (`--`, `-i`/`--ignore-environment`,
`-u`/`--unset[=NAME]`, `-S`/`--split-string`, any other `-`-prefixed token) and `command`'s own
flags (`-v`/`-V`/`-p`) is implemented independently, with separate loops and separate match arms,
in three different functions. The doc comments on all three explicitly acknowledge the
duplication and the drift risk ("Mirrors `resolve_segment_program_index`'s own env-flag walk...
closely enough to agree on where each flag's own argument ends"), and this round's own fix
(the fail-closed extension for indeterminate flag/NAME tokens) had to be applied by hand to two of
the three copies (`resolve_segment_program_index` and `raw_text_names_path_defeating_wrapper`) —
`text_can_shadow_path_resolution` was deliberately left unwidened, per its own doc comment,
because the two functions serve different fields. This is a maintainability risk that this
finding's own reasoning (WR-A) demonstrates in practice: a change to one flag-walk's behavior
(e.g., adding a new recognised `env` flag) requires the author to remember to update up to three
separate implementations and their cross-referencing doc comments, or a future flag addition will
silently apply to only one or two of the three functions.

**Fix:** Consider extracting a single, parameterized flag-walk helper (e.g.
`fn walk_wrapper_flags(tokens: &[String], start: usize, wrapper: WrapperKind) -> WalkOutcome`)
that each of the three call sites adapts to its own field (`ProgramResolution`,
`bool` for shadowability, `bool` for `text_can_shadow`), so a newly recognised flag is added in one
place. If the three call sites' differing semantics (consume-vs-detect, NAME-position rules) make
a single helper impractical, at minimum add a single source-of-truth table (flag name → semantic
class: "PATH-defeating", "opaque/unrecognised", "query-only") that all three functions iterate,
rather than three independent `match` trees.

## Info

### IN-01: `03-REQUIREMENTS-BOOKKEEPING.md` is purely narrative bookkeeping with no independently verifiable claim beyond requirement-table status

**File:** `.planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md`

**Issue:** Not a defect — noted for completeness. I cross-checked the document's central factual
claim (all eight Phase-3 requirement rows read `Gaps Found` in `.planning/REQUIREMENTS.md`) via a
direct `grep` of that file, per the document's own stated discipline ("confirm by direct grep,
never from a verb's own report"), and it matches. The rest of the document is a coverage map and a
procedural instruction for a future re-marking step; there is no code path to review here.

**Fix:** None required.

---

_Reviewed: 2026-09-22_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
