---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-22T00:00:00Z
status: gaps_found
score: 4/5 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-32-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-32-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-33-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-33-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-34-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-34-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-CONTEXT.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW.md"
  - "docs/destructive-gate-trust-boundary.md"
  - "packages/shim/src/main.rs"
  - "packages/shim/tests/classify_invocation.rs"
  - "packages/sidecar/test/destructive-gate.test.mjs"
covered_digest: "v1:sha256:f1347c6c2180edafce66e66f0ee707e5320fea557acee9bbc035d483cbe53947"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Round six (env -S backslash-split opaque-reparse: e\\nv -S \"-P <altpath> ...\") is CLOSED. Independently reproduced against the compiled flywheel-shim binary at HEAD (d0c1e3f/plan 03-32's own commits): `--classify-invocation \"e\\nv -S \\\"-P /tmp git push --force\\\"\"` now reports {\"category\":\"uncategorized\",\"invokedBareName\":false,\"program\":null} — the same deny-routing verdict as the unobfuscated control — where the prior verification recorded it reporting safe/defers. Also independently confirmed at the real hook level (packages/sidecar/dist/pretooluse-hook.js, shim genuinely on PATH): both the control and the backslash-split form deny with the same 'could not confidently classify' reason."
    - "WR-01 (readProvenBoolean null/numeric payload coverage) is CLOSED — confirmed p6 (explicit null) and p7 (a number) exist and assert deny, matching the function's own doc-comment enumeration."
    - "WR-02 (GROUP_3_COMMANDS derived from a fixed index range) is CLOSED for its original scope — confirmed every LAUNCHER_CORPUS row now carries an integer `group` field and GROUP_3_COMMANDS is derived from it, not a position range."
    - "WR-03 (is C3 a genuine inversion or an enumeration?) is resolved as a documented ruling, not silently dropped — docs/destructive-gate-trust-boundary.md and main.rs's own C3 doc comment now state plainly that C3 is a closed, positive enumeration of four named mechanisms, not a general inversion. I independently re-read raw_text_word_formation_is_indeterminate and concur this is an accurate, not aspirational, description."
  gaps_remaining:
    - "AGNT-07 / Success Criterion 5 stays open. A NEW live, zero-human-confirmation bypass — this session's code review's CR-01 (brace-expansion-obfuscated env/command WRAPPER tokens, e.g. {env,} -S \"-P <altpath> git push --force\" and {command,} -p git push --force) — is independently reproduced below, three ways, exactly as the review reproduced it. This is judged an ADJACENT mechanism, not incomplete closure of round six/seven's own scope: round six/seven's fix (C5, raw_text_names_opaque_env_reparse) closes backslash/quote-SPLIT obfuscation of the literal token `env`, retried over both raw and shell_quote_removed forms — but brace expansion is a word-formation mechanism neither C1's quote/backslash removal nor C5's token-exact matching touches at all, and I confirmed by direct code read that env/command never received the character-level raw_text_contains_word treatment that git/rm and the six KEYWORD_TRIGGERS already have. This is a new residual (round eight), not a regression in round seven's own closure."
    - "WR-01 from THIS round's review (friction breadth): confirmed independently — git commit -m \"add {foo}bar support\" now denies, and the trust-boundary document's own accounting paragraph and the brace rule's own doc comment price only the single xargs -I{} rm {} case, not this much more common commit-message-with-braces shape. WARNING-level, not blocking on its own (over-triggering is D-61's accepted direction), but the documented price is narrower than the actual price."
    - "WR-02 from THIS round's review (OBFUSCATION_SPLIT_KINDS has no brace-split kind): confirmed by direct read of destructive-gate.test.mjs — the decision-invariance generator sweeps empty-double-quote/empty-single-quote/backslash splits over every KEYED_WORDS entry (env and command included) but never a brace-expansion split, which is exactly why this round's own CR-01 was never caught mechanically the way round six's backslash-split env defect was. Contributing cause of the CR-01 blocker remaining open, not a separate blocker."
  regressions: []
gaps:
  - truth: "An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (Success Criterion 5 / AGNT-07)."
    status: failed
    reason: >
      Independently reproduced, three ways, against the compiled binary and real compiled hook at
      HEAD (d0c1e3f5/cdb1567e — no code changed since; `cargo build -p flywheel-shim` recompiled
      nothing). I did not inherit the code review's characterization; I reran every command myself
      this session, including one the review did not show (a direct comparison against the same
      hook harness with the shim NOT genuinely on PATH, to rule out a harness artifact before
      trusting the "genuinely proven environment" result).

      **1. The classifier itself.** `resolve_segment_program_index`'s `env`/`command` wrapper-token
      recognition, `text_can_shadow_path_resolution`'s own `env`/`command` token walk, and this
      round's new C5 (`raw_text_names_opaque_env_reparse`) all match the literal token `env` (or
      `command`) by exact string equality — over `tokenize_shell_words`'s output for the first two,
      and over both the raw and `shell_quote_removed` forms for C5. None of the three ever applies
      the character-level, word-boundary substring scan (`raw_text_contains_word`) that `git`/`rm`
      (`text_names_gated_program`) and the six `KEYWORD_TRIGGERS` (`raw_text_can_shadow_path_resolution`)
      already have. Bash's brace expansion assembles the literal word `env` from `{env,}` with
      nothing letter-adjacent to the resulting `{`/`}` (confirmed live, harmless: `bash -c '{env,} -S
      "echo TEST"'` prints `TEST`), so C3's brace-adjacency trigger — deliberately, correctly,
      letter-adjacency-scoped — never fires on it either. Reproduced directly:
      ```
      $ target/debug/flywheel-shim --classify-invocation '{env,} -S "-P /tmp git push --force"'
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
      $ target/debug/flywheel-shim --classify-invocation "sh -c '{env,} -S \"-P /tmp git push --force\"'"
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
      $ target/debug/flywheel-shim --classify-invocation '{command,} -p git push --force'
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
      ```
      Compare the already-closed unobfuscated and backslash-split forms of the same payload, both
      correctly routed to deny today:
      ```
      $ target/debug/flywheel-shim --classify-invocation 'env -S "-P /tmp git push --force"'
      {"category":"uncategorized","invokedBareName":false,"program":null}
      $ target/debug/flywheel-shim --classify-invocation "e\nv -S \"-P /tmp git push --force\""
      {"category":"uncategorized","invokedBareName":false,"program":null}
      $ target/debug/flywheel-shim --classify-invocation 'command -p git push --force'
      {"category":"force-push","invokedBareName":false,"program":"git"}
      ```
      Since `textCanShadowPathResolution` and `namesGatedProgram` are never both `true` for any of
      the three brace forms, D-61's AND-gate never fires. `namesGatedProgram` is honest (the literal
      substring `git` is present); the gap is entirely in `textCanShadowPathResolution` staying `false`.

      **2. The real, compiled hook, run directly (not narrated).** I built my own harness against
      `packages/sidecar/dist/pretooluse-hook.js`, driving it exactly as `destructive-gate.test.mjs`'s
      own `runHook`/`makeShimDir` helpers do, first WITHOUT the shim genuinely on `PATH` (to rule out
      a harness artifact) and then WITH it:
      ```
      # FLYWHEEL_SHIM_BIN set, PATH NOT prefixed with the shim dir (environment unprovable)
      $ node pretooluse-hook.js <<< '{"tool_input":{"command":"{env,} -S \"-P /tmp git push --force\""}}'
      {"hookSpecificOutput":{...,"permissionDecision":"deny","permissionDecisionReason":"...could not verify this command was safe (the shim's shadow directory could not be proven installed and leading PATH)..."}}
      exit=2

      # FLYWHEEL_SHIM_BIN set AND PATH genuinely prefixed with the shim dir (the production shape)
      $ PATH=$SHIMDIR:$PATH node pretooluse-hook.js <<< '{"tool_input":{"command":"{env,} -S \"-P /tmp git push --force\""}}'
      {}
      exit=0
      ```
      `{}`/exit 0 is "no opinion" — the hook defers entirely to whatever permission mode governs the
      session, byte-identical to what an ordinary `git status` produces in the same environment. In
      auto-accept mode this reaches zero human confirmation. The control (unobfuscated `env -S`) and
      the already-closed backslash-split form both deny with the same harness and the same
      shim-genuinely-on-PATH environment, confirming the difference is the brace obfuscation, not the
      harness:
      ```
      $ PATH=$SHIMDIR:$PATH node pretooluse-hook.js <<< '{"tool_input":{"command":"env -S \"-P /tmp git push --force\""}}'
      deny, exit=2
      $ PATH=$SHIMDIR:$PATH node pretooluse-hook.js <<< '{"tool_input":{"command":"e\\nv -S \"-P /tmp git push --force\""}}'
      deny, exit=2
      $ PATH=$SHIMDIR:$PATH node pretooluse-hook.js <<< '{"tool_input":{"command":"sh -c '"'"'{env,} -S \"-P /tmp git push --force\"'"'"'"}}'
      {} exit=0   # nested form, same bypass
      ```

      **3. Layer 2 provides no backstop for this shape either (D-63: a harmless stub `git`, never a
      real push).** With the shim's shadow directory genuinely first on `PATH`, and a harmless stub
      `git` (prints a marker, exits) planted at an alternate directory:
      ```
      $ PATH=$SHIMDIR:$PATH FLYWHEEL_REAL_GIT=$(command -v git) \
          sh -c '{env,} -S "-P '"$ALTDIR"' git status"'
      ALTPATH_STUB_REACHED_NOT_THE_SHIM_INDEPENDENT_CHECK
      ```
      The altpath stub was reached, not the shim — BSD `env -P`'s own alternate-PATH search never
      touches the shim's shadow directory, so there is no second layer once Layer 1 misclassifies the
      text as `safe`.

      **On the question I was asked to rule on — same class round seven just closed, or an adjacent
      mechanism?** I judge it ADJACENT (round eight), by direct code read, not by inference from the
      review's framing: round six's specific defect was recognizing the token `env` only over RAW,
      non-backslash-resolved tokens; round seven's fix (C5) retries the SAME exact-token match over
      BOTH the raw text and `shell_quote_removed`'s output — both are still exact TOKEN-equality
      checks. Brace expansion never produces a token literally equal to `env`; it produces the
      distinct token `{env,}`, in both the raw and quote-removed forms, because `shell_quote_removed`
      only strips quote/backslash characters, never brace syntax. The fix that would close this (a
      `raw_text_contains_word`-style character-level scan for `env`/`command`, mirroring what
      `git`/`rm`/the six `KEYWORD_TRIGGERS` already have) is a different code path than anything C5
      touches. I confirmed this is not already covered by any existing test: `cargo test -p
      flywheel-shim --test classify_invocation -- --list` shows five `c3_brace_*` tests, none
      exercising `env`/`command` wrapper obfuscation. I also confirmed the trust-boundary document's
      Named-residuals table entry for brace expansion covers ONLY the OLD, already-ruled-on case
      (`{git,}`/`{gi,}t` — a gated PROGRAM name assembled by braces) and contains zero mentions of
      `env`/`command` wrapper-token brace obfuscation (`grep -n 'env,}\|command,}' docs/*.md` — no
      hits). Per the document's own stated discipline ("a newly found bypass shape is a boundary
      failure... amend this document first, only then a corpus row"), this finding has not yet been
      named there.

      AGNT-07's own text — "Destructive actions ... always require explicit confirmation, even when
      the session is running in an auto-accept permission mode" — is false while
      `sh -c '{env,} -S "-P <altpath> git push --force"'` reaches zero confirmation at either layer.
    artifacts:
      - path: "packages/shim/src/main.rs"
        issue: "resolve_segment_program_index's env/command wrapper-token check, text_can_shadow_path_resolution's own env/command token walk, and C5 (raw_text_names_opaque_env_reparse) all match the literal tokens `env`/`command` by exact token equality — never by the character-level, word-boundary raw_text_contains_word scan that git/rm and the six KEYWORD_TRIGGERS already have. Brace expansion ({env,}, {command,}) assembles the literal word with no letter-adjacent character, so it escapes C3's brace-adjacency trigger too. This is a proven, live, zero-human-confirmation bypass for env -S/-P and command -p, independently reproduced at the classifier, the real compiled hook, and Layer 2's runtime PATH behavior."
      - path: "docs/destructive-gate-trust-boundary.md"
        issue: "The Named-residuals table's brace-expansion row covers only the OLD case (a gated PROGRAM name — git/rm — assembled by braces, already ruled on). Zero mentions of env/command wrapper-token brace obfuscation anywhere in the document, which the document's own stated discipline requires before any fix or corpus row addresses this new shape."
      - path: "packages/sidecar/test/destructive-gate.test.mjs"
        issue: "OBFUSCATION_SPLIT_KINDS (the decision-invariance generator that already sweeps env/command via empty-quote and backslash splits) has no brace-expansion split kind, even though this same round taught C3 a whole new brace-expansion mechanism. This is why CR-01 shipped without the generator catching it mechanically, the way it caught round six's backslash-split env defect."
    missing:
      - "A fix giving env and command the same raw-text, character-level, word-boundary substring-scan companion git/rm and the six KEYWORD_TRIGGERS already have (e.g. extending raw_text_can_shadow_path_resolution's scan, or an equivalent, to include env/command), so {env,}/{command,} are caught by presence the same way {alias,} already is."
      - "A Named-residuals row (or the fix itself) in docs/destructive-gate-trust-boundary.md naming the env/command wrapper-token brace-obfuscation shape specifically, distinct from the already-ruled-on gated-program-name brace case, per the document's own round-six-onward discipline: amend the document before any new corpus row addresses this shape."
      - "A brace-expansion split kind added to OBFUSCATION_SPLIT_KINDS (packages/sidecar/test/destructive-gate.test.mjs), swept over KEYED_WORDS (env/command already members), so the automated invariance sweep would have caught this mechanically and will catch any regression."
      - "Either broaden the trust-boundary document's friction-accounting paragraph to name the ordinary letter-adjacent {word}/{word}text-in-a-commit-message class explicitly, or add an ORDINARY_USAGE_CORPUS row pricing it — the gap between what is priced (one xargs -I{} rm {} row) and what actually denies (any git/rm text containing an ordinary letter-adjacent brace shape) should not persist silently."
    deferred_items_note: "No later phase in ROADMAP.md addresses git/rm destructive-action gating or the shell-text scanner; nothing here is deferred to future roadmap phases."
---

# Phase 3: Nothing Lost, Nothing Left Running — Verification Report (Re-Verification, round eight)

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-22T00:00:00Z
**Status:** gaps_found
**Re-verification:** Yes — this report supersedes the prior `03-VERIFICATION.md` (`gaps_found`,
4/5). That report's two recorded gaps (round six `env -S` backslash-split, and the OLD CR-01
gated-program-name brace obfuscation `{gi,}t`/`{git,}`) are CLOSED, independently reproduced below.
A NEW gap — this session's code review's CR-01 (brace-expansion-obfuscated `env`/`command` WRAPPER
tokens) — keeps AGNT-07 / Success Criterion 5 failing, on a narrower and different shape than
before.

## Independent reproduction: round six (`env -S` backslash-split) is now genuinely closed

```
$ target/debug/flywheel-shim --classify-invocation "env -S 'git push --force'"
{"category":"uncategorized","invokedBareName":false,"program":null}          # control, denies
$ target/debug/flywheel-shim --classify-invocation "e\nv -S \"-P /tmp git push --force\""
{"category":"uncategorized","invokedBareName":false,"program":null}          # NOW denies too
$ sh -c 'e\nv -S "echo REAL_ENV_RESOLVED"'
REAL_ENV_RESOLVED                                                            # confirms real-shell equivalence
```

Also confirmed at the real compiled hook level (own harness, shim genuinely on `PATH`): both the
control and the backslash-split form return the deny decision `{"...":"deny","...":"could not
confidently classify this command as safe..."}`, exit 2. Round six is closed.

## Independent reproduction and judgment: this session's own review CR-01 (brace-obfuscated `env`/`command` wrapper tokens) — a live, reproduced, unaddressed bypass

I did not inherit the code review's characterization. I reproduced all three of its evidence layers
myself, from a clean rebuild (`cargo build -p flywheel-shim`, nothing recompiled — binary already at
HEAD `cdb1567e`), plus one control the review did not show (the same hook harness with the shim NOT
genuinely on `PATH`, to rule out a harness artifact before trusting the "genuinely proven
environment" result).

**Layer 1 — the classifier itself:**

```
$ target/debug/flywheel-shim --classify-invocation '{env,} -S "-P /tmp git push --force"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation "sh -c '{env,} -S \"-P /tmp git push --force\"'"
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation '{command,} -p git push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ bash -c '{env,} -S "echo TEST_ENV_BRACE_OBFUSCATION_INDEPENDENT"'
TEST_ENV_BRACE_OBFUSCATION_INDEPENDENT   # harmless payload, confirms real bash resolves {env,} to env
```

`textCanShadowPathResolution` and `namesGatedProgram` are never both `true`, so D-61's AND-gate never
fires. Compare the unobfuscated and already-closed backslash-split controls, both correctly denying:

```
$ target/debug/flywheel-shim --classify-invocation 'env -S "-P /tmp git push --force"'
{"category":"uncategorized","invokedBareName":false,"program":null}
$ target/debug/flywheel-shim --classify-invocation 'command -p git push --force'
{"category":"force-push","invokedBareName":false,"program":"git"}
```

**Layer 1, at the real hook — with my own harness-artifact control:**

```
# WITHOUT the shim genuinely on PATH (environment unprovable) — denies for the RIGHT reason:
$ node pretooluse-hook.js <<< '{"tool_input":{"command":"{env,} -S \"-P /tmp git push --force\""}}'
deny, "...could not verify this command was safe (the shim's shadow directory could not be proven
installed and leading PATH)...", exit=2

# WITH the shim genuinely on PATH (the production shape, matching makeShimDir/runHook's own construction):
$ PATH=$SHIMDIR:$PATH node pretooluse-hook.js <<< '{"tool_input":{"command":"{env,} -S \"-P /tmp git push --force\""}}'
{}
exit=0
```

`{}`/exit 0 is "no opinion" — the hook defers entirely to the session's own permission mode; in
auto-accept mode this reaches zero human confirmation. I confirmed the control and the
already-closed backslash-split form both still deny under the identical shim-on-PATH harness, and
the nested `sh -c '{env,} -S "..."'` form produces the identical bypass — so the difference is the
brace obfuscation specifically, not an artifact of my harness.

**Layer 2 — no backstop either (D-63: a harmless stub `git`, never a real push):**

```
$ PATH=$SHIMDIR:$PATH FLYWHEEL_REAL_GIT=$(command -v git) \
    sh -c '{env,} -S "-P '"$ALTDIR"' git status"'
ALTPATH_STUB_REACHED_NOT_THE_SHIM_INDEPENDENT_CHECK
```

The alt-path stub was reached, not the shim. BSD `env -P`'s own alternate-`PATH` search never
touches the shim's shadow directory, so there is no second layer once Layer 1 misclassifies the text
as `safe`.

**My own judgment on "is this the same class round seven just closed, or adjacent?" — by direct code
read, not by inference from the review's framing:** ADJACENT (round eight). Round six's defect was
`env`-token recognition over RAW, non-backslash-resolved tokens only; round seven's fix (C5,
`raw_text_names_opaque_env_reparse`) retries the identical exact-TOKEN match over both the raw text
and `shell_quote_removed`'s output — still token-equality in both forms. `{env,}` never tokenizes to
a token equal to `"env"` in either form, because `shell_quote_removed` strips only quote/backslash
characters, never brace syntax — confirmed by reading `shell_quote_removed`'s own implementation
(main.rs, the quote/backslash-stripping loop) and `raw_text_names_opaque_env_reparse`'s own `tokens[i]
== "env"` check. The fix that would close this — the same character-level, word-boundary
`raw_text_contains_word` scan that `git`/`rm`/the six `KEYWORD_TRIGGERS` already get — is a different
code path C5 never touches. I confirmed no existing test exercises this: `cargo test -p flywheel-shim
--test classify_invocation -- --list` lists five `c3_brace_*` tests, none naming `env` or `command`.
I confirmed the trust-boundary document's brace-expansion Named-residuals row covers only the OLD
case (a gated PROGRAM name — `git`/`rm` — assembled by braces, e.g. `{git,}`/`{gi,}t`, already ruled
on in the prior verification round): `grep -n 'env,}\|command,}' docs/destructive-gate-trust-boundary.md`
returns zero hits. This is a genuinely new residual, not incomplete closure of round six/seven's own
scope, but it fails the same truth regardless of classification.

## Independent confirmation: this round's own WR-01 (friction breadth) and WR-02 (missing brace split kind)

```
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "add {foo}bar support"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}   # now denies
```

Confirmed: an ordinary commit message containing a letter-adjacent brace pattern now denies, and
`docs/destructive-gate-trust-boundary.md`'s friction-accounting paragraph and the brace rule's own
doc comment price only the single `xargs -I{} rm {}` shape. This is the accepted over-triggering
direction (D-61) and is WARNING, not blocking, on its own — but the documented price is narrower
than the actual price.

Confirmed by direct read of `packages/sidecar/test/destructive-gate.test.mjs`: `OBFUSCATION_SPLIT_KINDS`
sweeps empty-double-quote/empty-single-quote/backslash splits over `KEYED_WORDS` (which already
lists `env`/`command`), but has no brace-expansion split kind — exactly why this round's own CR-01
was never caught mechanically the way round six's backslash-split `env` defect was.

## Ruling on the flaky-UAT deferral (03-34-SUMMARY.md, WINDOWS.md #11)

`bash scripts/uat/run-all.sh` failed 4/6 live-`claude`-session items (UAT 3, 5, 6a, 6b) during
03-34's own verification. I independently confirmed the diff-isolation claim underlying the
"pre-existing flakiness, not a regression" judgment: `git diff --stat 35fba7c~1..b613fd8` (plan
03-34's own commit range) touches exactly `packages/sidecar/test/destructive-gate.test.mjs` (test
data) plus planning/tracking files — never `packages/shim/src/main.rs` or
`packages/sidecar/src/pretooluse-hook.ts`, the files the live UAT scripts' pass/fail actually depends
on. I also reproduced a directly comparable flake myself this session: `cargo test --workspace` failed
once on `a_worktree_survives_two_runs_with_an_epic` (`packages/core`, a file this round's plans never
touched) with a tempdir/git-init race under parallel execution, then passed both in isolation
(`cargo test -p core --test worktree_lifecycle ... --exact`) and on a second full-workspace run — the
same transient, load-dependent pattern this phase's own `WINDOWS.md` already documents five times
(entries 8, 9, 10, plus 03-24/03-26/03-29/03-30/03-32's own SUMMARYs). I did not re-run the live
`claude`-session UAT scripts myself (real API budget, and not the deciding evidence for this
verdict — CR-01 above independently fails Truth 5 regardless). **My ruling: this is credible,
established-pattern flakiness, not a regression from 03-34's diff** — but it is unconfirmed by me at
the live-session level, so I record it as inherited, diff-isolation-corroborated judgment, not a
truth I personally verified end to end. It does not change the phase's overall status, which is
already `gaps_found` on CR-01 alone.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | Unchanged by plans 03-32..03-34 (`git diff --stat 27eda82~1..b613fd8` confirms no `packages/core` or `packages/desktop` file touched — only `docs/destructive-gate-trust-boundary.md`, `packages/shim/src/main.rs`, `packages/shim/tests/classify_invocation.rs`, `packages/sidecar/test/destructive-gate.test.mjs`, and planning/tracking files). Regression-only check per re-verification mode (Step 0). Previously verified via `03-UAT.md` test 1. |
| 2 | User quits the application while a session is running and no agent process survives. | ✓ VERIFIED | Unchanged; no watchdog/supervisor file touched this round (same diff-isolation evidence above). Previously confirmed passing via full `npm --prefix packages/sidecar test` runs this phase; regression-only check this round. |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database. | ✓ VERIFIED | Unchanged; no reconciliation file touched this round. Regression-only check per re-verification mode. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — retry and spawn-stagger. | ✓ VERIFIED | Unchanged; `git_retry.rs`/`shim.rs`'s `shim_env_for_run` untouched this round. Independently re-ran `cargo test --workspace` this session (one transient, load-dependent failure in an unrelated, untouched `packages/core` test — `a_worktree_survives_two_runs_with_an_epic` — reproduced as isolated-pass/parallel-flake, matching this phase's own established pattern, not a regression); a second full run passed clean. |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (compound truth this SC and AGNT-07 share). | ✗ FAILED | Round six (`env -S` backslash-split) and the OLD CR-01 (`{gi,}t`/`{git,}` gated-program-name brace obfuscation) are both CLOSED, independently confirmed above. But this session's code review found a NEW live bypass — brace-expansion-obfuscated `env`/`command` WRAPPER tokens (`{env,} -S "-P <altpath> ..."`, `{command,} -p ...`) — independently reproduced three ways above (classifier, real compiled hook with a harness-artifact control, and Layer 2 runtime behavior), judged an adjacent mechanism (round eight), not incomplete round-seven closure. |

**Score:** 4/5 truths verified (0 present-behavior-unverified; 1 failed, blocking).

## Requirements state — my ruling (per the orchestrator's explicit question)

`REQUIREMENTS.md` currently reads (confirmed by direct `grep` at HEAD, not trusted from any verb's
report): all eight Phase-3 rows — `WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`,
`PROC-05`, `AGNT-07` — read `Gaps Found`. **This is correct and must not change.**

I agree with `03-REQUIREMENTS-BOOKKEEPING.md`'s ruling that the seven non-`AGNT-07` requirements are
genuinely delivered — their implementations live in files this gap-closure sequence (03-32..03-34)
never touched, confirmed independently this session by the same `git diff --stat` isolation check —
but I decline to re-mark them `Complete` in this pass, because `03-REQUIREMENTS-BOOKKEEPING.md`'s own
instruction (c) is explicit that the re-mark happens "once the phase as a whole clears verification,"
and this pass finds the phase does NOT clear (Truth 5 / AGNT-07 remains failed, on a new shape). All
eight rows staying `Gaps Found` is the correct bookkeeping state after this verification, not an
oversight.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/shim/src/main.rs` | `resolve_segment_program_index`, `text_can_shadow_path_resolution`'s `env`/`command` token walk, `raw_text_names_opaque_env_reparse` (C5) | `env`/`command` wrapper-token recognition is exact-TOKEN-equality only, in all three call sites — never the character-level `raw_text_contains_word` scan `git`/`rm`/the six `KEYWORD_TRIGGERS` already have | 🛑 Blocker | Brace-expansion-obfuscated `{env,}`/`{command,}` reaches zero human confirmation at either layer, independently reproduced this session three ways (classifier, real hook with harness-artifact control, Layer 2 altpath behavior). This is this session's code review's CR-01, independently confirmed, not inherited. |
| `docs/destructive-gate-trust-boundary.md` | Named-residuals table | The brace-expansion row covers only the OLD gated-program-name case; zero mentions of `env`/`command` wrapper-token brace obfuscation | ⚠️ Warning | The document's own stated discipline requires naming a newly found bypass shape before any fix or corpus row addresses it — not yet done for this shape, because the review that found it ran immediately before this verification pass. |
| `packages/sidecar/test/destructive-gate.test.mjs` | `OBFUSCATION_SPLIT_KINDS` (decision-invariance generator) | No brace-expansion split kind, despite this round teaching C3 a whole new brace-expansion mechanism | ⚠️ Warning | This is why CR-01 was never caught mechanically by the sweep, the way round six's backslash-split `env` defect was. Contributing cause of the still-open blocker above, not a separate blocker. |
| `docs/destructive-gate-trust-boundary.md` / `packages/shim/src/main.rs` (C3 brace-adjacency doc comment) | friction-accounting paragraph / brace rule's own doc comment | Prices only the single `xargs -I{} rm {}` shape; the actual friction (`git commit -m "add {foo}bar support"` now denies) is materially broader | ⚠️ Warning | This round's own WR-01: confirmed independently — over-triggering is the accepted direction (D-61), so not blocking, but the documented price understates the actual price. |

No `TBD`/`FIXME`/`XXX` debt markers found in any file this round's plans (03-32..03-34) touched
(confirmed by direct grep, this session).

## Behavioral Spot-Checks

All commands run directly against the compiled `target/debug/flywheel-shim` binary and the compiled
`packages/sidecar/dist/pretooluse-hook.js` at HEAD (`cdb1567e`; `cargo build -p flywheel-shim`
recompiled nothing) using only `--classify-invocation`/`--classify-command` (pure classification) or
a harmless `echo`/marker-stub payload where real-shell resolution or a real runtime PATH decision
needed confirming — never a destructive command against a real remote or worktree (D-63).

| Behavior | Command | Result | Status |
|---|---|---|---|
| Round six control: unobfuscated `env -S` denies | `--classify-invocation 'env -S "-P /tmp git push --force"'` | `uncategorized`/`invokedBareName:false` | ✓ PASS (denies) |
| Round six: backslash-split `env` now closed | `--classify-invocation "e\nv -S \"-P /tmp git push --force\""` | same as control | ✓ PASS (denies — was FAIL in prior round) |
| Round six: real hook, shim on PATH, control + backslash-split | own node harness, `PATH=$SHIMDIR:$PATH` | both `deny`, exit 2 | ✓ PASS |
| CR-01 (this round): brace-obfuscated `{env,} -S` | `--classify-invocation '{env,} -S "-P /tmp git push --force"'` | `safe`, `textCanShadow:false` | ✗ FAIL (defers — live bypass confirmed) |
| CR-01: real bash resolves `{env,}` to `env` (harmless echo) | `bash -c '{env,} -S "echo TEST..."'` | prints marker | ✓ PASS (confirms obfuscation is real) |
| CR-01: real hook, shim NOT on PATH (harness-artifact control) | own node harness, no PATH prefix | `deny`, exit 2, "could not verify shim installed" | ✓ PASS (correct reason, rules out harness bug) |
| CR-01: real hook, shim genuinely on PATH (production shape) | own node harness, `PATH=$SHIMDIR:$PATH` | `{}`, exit 0 | ✗ FAIL (no opinion — zero confirmation in auto-accept) |
| CR-01: nested `sh -c '{env,} ...'` form | same harness | `{}`, exit 0 | ✗ FAIL (same bypass) |
| CR-01: `{command,} -p` variant | `--classify-invocation '{command,} -p git push --force'` | `safe`, `textCanShadow:false` | ✗ FAIL (same bypass, second wrapper token) |
| CR-01: Layer 2 backstop check (harmless altpath stub, never real git) | shim on PATH, `env -P` altpath pointed at a stub | stub reached, not the shim | ✗ FAIL (no Layer-2 backstop for this shape) |
| WR-01 (this round): friction breadth | `--classify-invocation 'git commit -m "add {foo}bar support"'` | `textCanShadow:true` | confirms WARNING (denies; undocumented breadth) |
| WR-02 (this round): no brace split kind in generator | direct read of `OBFUSCATION_SPLIT_KINDS` | 3 kinds (quote×2, backslash), no brace kind | confirms WARNING (contributing cause) |
| No test exercises CR-01's shape | `cargo test -p flywheel-shim --test classify_invocation -- --list \| grep brace` | 5 `c3_brace_*` tests, none naming `env`/`command` | confirms gap is untested |
| Full Rust suite (regression) | `cargo test --workspace` (run twice — first run hit one transient, isolation-confirmed flake in an untouched `packages/core` test) | second run: all crates pass | ✓ PASS (flake, not regression — matches established pattern) |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | Worktree never destroyed without checking for uncommitted changes | ✓ SATISFIED | Unchanged this round; genuinely delivered (ruling above). `REQUIREMENTS.md` reads `Gaps Found` — correct bookkeeping consequence of sharing a phase with `AGNT-07`. |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git ops retry with backoff/jitter on index-lock contention | ✓ SATISFIED | Same as above. |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing desynchronised to avoid index collisions | ✓ SATISFIED | Same as above. |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | Launch reconciles worktrees in DB against disk, surfaces discrepancy | ✓ SATISFIED | Same as above. |
| PROC-03 | 03-02, 03-15 | Agent processes managed as process groups | ✓ SATISFIED | Same as above. |
| PROC-04 | 03-02, 03-10, 03-15, 03-17, 03-20, 03-21 | No agent process survives application quit | ✓ SATISFIED | Same as above. |
| PROC-05 | 03-06, 03-10, 03-11, 03-17, 03-23 | Orphaned processes/runs detected and surfaced on launch | ✓ SATISFIED | Same as above. |
| AGNT-07 | 03-07, 03-12, 03-14, 03-16, 03-19..03-34 | Destructive actions always require explicit confirmation, even in auto-accept mode | ✗ BLOCKED | Round six and the OLD brace CR-01 are closed; a NEW live bypass (this round's own review's CR-01 — env/command wrapper-token brace obfuscation) is independently reproduced above. `REQUIREMENTS.md` reads `Gaps Found`, which is CORRECT and must NOT change. No orphaned requirement IDs: the phase's declared set exactly matches `REQUIREMENTS.md`'s Phase 3 mapping. |

## Human Verification Required

None. Every truth in this report was settled by direct source read, direct binary invocation, direct
real-hook invocation with a harness-artifact control, direct shell invocation with harmless payloads,
or targeted regression re-runs — no item required manual UI/UX judgment or an unrunnable check.

## Gaps Summary

The phase remains blocked on a single truth (Success Criterion 5 / AGNT-07), on its third distinct
shape in as many verification rounds: round five's quote/backslash-split obfuscation of
`eval`/`git` (closed), round six's backslash-split `env -S`/`-P` (closed this round), and now this
round's own code review's CR-01 — brace-expansion-obfuscated `env`/`command` wrapper tokens, a
mechanism none of C1 through C5 was built to see, because `env`/`command` never received the
character-level raw-text scan `git`/`rm`/the six `KEYWORD_TRIGGERS` already have. I independently
reproduced this three ways (the classifier, the real compiled hook — with a harness-artifact control
to rule out a harness bug — and Layer 2's runtime PATH behavior via a harmless altpath stub), and
independently confirmed by direct code read that this is a new, adjacent mechanism rather than
incomplete closure of round six/seven's own scope. Two further, non-blocking findings from this
round's own review (WR-01: undocumented friction breadth; WR-02: the obfuscation generator's missing
brace-split kind, which is exactly why CR-01 shipped uncaught) remain open as WARNINGs. All seven
non-`AGNT-07` requirements are genuinely delivered and unaffected by this round's narrow diff, but
stay `Gaps Found` in `REQUIREMENTS.md` as a correct bookkeeping consequence until the phase clears as
a whole.

---

_Verified: 2026-09-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
