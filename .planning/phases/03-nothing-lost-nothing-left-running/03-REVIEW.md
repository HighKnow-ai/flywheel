---
phase: 03-nothing-lost-nothing-left-running
reviewed: 2026-09-22T00:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - docs/destructive-gate-trust-boundary.md
  - packages/shim/tests/classify_invocation.rs
  - packages/sidecar/test/destructive-gate.test.mjs
  - .planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 3: Code Review Report (round nine, incremental)

**Reviewed:** 2026-09-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found (no blockers — one maintainability warning, two informational notes)

## Summary

This is an incremental review of round nine only (plans 03-37 and 03-38), diffed against the prior
review commit `7e07389`. Confirmed by `git diff --stat` that this round touched exactly the four
files in scope, and that `packages/shim/src/main.rs` is byte-identical since the prior round — the
round's own central claim ("this is a document/corpus correction, not a predicate change") holds
structurally, not just by assertion.

Verification performed:

- `cargo build --workspace` — clean.
- `cargo test -p flywheel-shim --test classify_invocation` — 24/24 passed (20 pre-existing + 4
  round-nine additions: `round_nine_plain_prose_wrapper_flag_adjacency_denies`,
  `round_nine_env_charges_any_dash_command_charges_only_the_p_run`,
  `round_nine_prose_controls_still_defer`, `round_nine_quote_removed_form_is_load_bearing`).
- `cargo test --workspace` — all green, no regressions elsewhere.
- `npm --prefix packages/sidecar test` — 98/98 passed, 0 skipped (up from 96, confirming the
  `ORDINARY_USAGE_CORPUS` rows, `PROSE_FRICTION_SHAPES` sweep, and `FRICTION_CLASSES` gate all
  execute rather than silently no-op).
- Hand-verified every live measurement quoted in the document's `## Round nine` section
  (`git commit -m "the command -p form"`, `git commit -m "document the command -p flag behavior"`,
  `git commit -m "the env -i flag clears vars"`, `git log --grep "the command -p flag"`, and the
  `git commit -m "fix the command parser"` control) directly against the compiled
  `target/debug/flywheel-shim` binary — every one matches the document's claimed JSON output
  exactly.
- Hand-verified the document's central asymmetry claim (`env`'s recognised-flag set is OPEN —
  charges on any dash-prefixed follower including `--help`/`-x` — while `command`'s is CLOSED —
  charges only when the walk reaches `-p`) against the binary for both wrappers' `--help` forms and
  `command --verbose -p`; all match the claimed behavior.
- Traced `round_nine_quote_removed_form_is_load_bearing`'s falsifiability against branch (a)
  (co-location/original-quoted-span narrowing): both pinned nested payloads
  (`sh -c 'env -S "-P /tmp git push --force"'`, `sh -c '{env,} -S "-P /tmp git push --force"'`) put
  the wrapper and its flag inside the *same* originally-quoted shell word as the prose false
  positive does, for the same structural reason the document's own rejection argument gives — a
  future branch-(a) implementation that silences the prose false positive would silence these two
  assertions too, so the test is genuinely falsifiable against the rejected alternative, not merely
  descriptive of current behavior.
- Confirmed `ORDINARY_USAGE_CORPUS` gained exactly the 4 deny + 4 defer rows the requirements
  bookkeeping file claims (plus one pre-existing row's `why` corrected in place, not counted as
  new), matching `03-REQUIREMENTS-BOOKKEEPING.md`'s own accounting.
- Confirmed `PROSE_FRICTION_SHAPES` (16 rows) × `PROSE_FRICTION_TEMPLATES` (2 rows) = 32 variants,
  meeting the assertion floor exactly, and that the 16 shapes span `env`'s full recognised-flag set
  (all six named flags), two unrecognised-flag charging cases, and `command`'s full closed set
  (`-p`, `--verbose -p`, `-v`, `-V`, `--help`, ordinary word) — not a "convenient subset."
- Confirmed `FRICTION_CLASSES`'s four `docAnchor` strings are all present, verbatim, in
  `docs/destructive-gate-trust-boundary.md` at HEAD, and that each `representative` command string
  matches exactly one `ORDINARY_USAGE_CORPUS` row with the claimed `expect`.

No bypass, logic error, or security issue was found in this round's own changes. The document's
corrected claim matches the compiled binary's behavior in every case checked, including the
asymmetry this round singled out as the highest-risk claim to verify independently rather than trust.

## Warnings

### WR-01: `FRICTION_CLASSES`'s new anchor does not follow this file's own established reflow-safety precedent

**File:** `packages/sidecar/test/destructive-gate.test.mjs:2910-2915` (the
`plain-prose-wrapper-flag-adjacency` row) and `2929-2939` (the matching assertion)

**Issue:** The `docAnchor` for this row (`"plain-prose quoted commit message that merely MENTIONS a
recognised"`) is matched with `content.includes(row.docAnchor)` against the raw, un-normalized file
contents. That string happens to sit entirely within one hard-wrapped markdown line today, so the
match currently succeeds — but nothing pins it there. Nineteen lines above this exact same test
function (line ~3041), the pre-existing "C-contract status" anchor check in the very same file
explicitly normalizes whitespace before comparing (`content.replace(/\s+/g, " ")`) with the
recorded rationale: "a reflow of this paragraph's line breaks alone does not trip this gate." The
new round-nine anchor ignores that established precedent in the same file, so a purely cosmetic
rewrap of the `## Round nine` narrative paragraph (e.g. `prettier`-style reflow, or a future author
tightening the prose) would silently break this specific `FRICTION_CLASSES` row and fail the whole
test — not because the friction class stopped being documented, but because of line-wrap placement
alone. This is exactly the kind of noisy, non-diagnostic test failure the sibling check up the file
was written to prevent.

**Fix:** Normalize whitespace before the `includes` check, mirroring the existing precedent:

```js
const normalizedContent = content.replace(/\s+/g, " ");
// ...
assert.ok(
  normalizedContent.includes(row.docAnchor.replace(/\s+/g, " ")),
  ...
);
```

## Info

### IN-01: The document's own worked example and the corpus's "non-commit template" row use different `git` subcommands

**File:** `docs/destructive-gate-trust-boundary.md:608-609` vs.
`packages/sidecar/test/destructive-gate.test.mjs:2110-2118`

**Issue:** The document's `## Round nine` measurements block demonstrates the non-commit-message
member of the class with `git log --grep "the command -p flag"`, while the corpus's own comment
("a non-commit template pricing the class as a property of quoted arguments generally") uses
`git grep "command -p"` — a different subcommand entirely (`git grep` searches the working tree;
`git log --grep` searches commit messages). Both are independently measured and both pass, so this
is not a correctness defect, but a reader cross-referencing the document's worked example against
the corpus row pricing the same claim will not find the same command — a small, avoidable
friction for anyone trying to verify the document-to-corpus mapping by eye rather than by the
`FRICTION_CLASSES` gate (which does not check this particular pair, since `git grep` isn't one of
its four `representative` rows).

**Fix:** Either align the document's worked example to `git grep "command -p"`, or add a short note
that the two are deliberately different `git` subcommands exercising the same class, so a reader
isn't left to wonder whether the mismatch is intentional.

### IN-02: `FRICTION_CLASSES`'s test title claims full bidirectionality it only partially delivers

**File:** `packages/sidecar/test/destructive-gate.test.mjs:2918-2919`

**Issue:** The test title reads "a friction class named in the trust-boundary document must have a
corpus row of that exact shape, **and vice versa**." The body does check both directions, but only
for the four hand-curated `FRICTION_CLASSES` rows — it does not scan the rest of
`ORDINARY_USAGE_CORPUS` (25 rows) to confirm every deny/defer row there maps to some class named in
the document. A corpus row added later pricing an undocumented class would not be caught by this
gate; only the reverse (a documented class with no corpus row, which is what round nine actually
was) is mechanically enforced across the whole corpus. This isn't a functional bug — the gate does
exactly what round nine needed — but the title's "and vice versa" phrasing slightly overstates the
gate's actual scope for a future reader deciding whether they can skip manually cross-checking a
new corpus row against the document.

**Fix:** Either narrow the title to name the four curated classes explicitly, or add a short comment
above `FRICTION_CLASSES` clarifying that the "vice versa" direction is checked only for rows present
in this table, not for every `ORDINARY_USAGE_CORPUS` row.

---

_Reviewed: 2026-09-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
