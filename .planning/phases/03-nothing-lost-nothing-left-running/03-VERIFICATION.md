---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-22T00:00:00Z
status: gaps_found
score: 4/5 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/ROADMAP.md"
  - ".planning/STATE.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-24-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-24-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-25-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-25-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-26-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-26-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-27-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-27-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-28-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-28-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-29-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-29-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-30-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-30-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-31-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-31-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-DESTRUCTIVE-GATE-BYPASS-CLASS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md"
  - "docs/destructive-gate-trust-boundary.md"
  - "packages/core/src/shim.rs"
  - "packages/core/tests/git_retry.rs"
  - "packages/shim/src/main.rs"
  - "packages/sidecar/src/pretooluse-hook.ts"
  - "packages/sidecar/test/destructive-gate.test.mjs"
  - "scripts/uat/README.md"
  - "scripts/uat/run-all.sh"
  - "scripts/uat/uat-07-launcher-shape-gate.mjs"
covered_digest: "v1:sha256:e4aa69cee4759973a92ed2b84db435783b7228c154a268f835366421b873c404"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Round five's CR-01 (quote/backslash-split obfuscation of `eval`/`git` inside a raw-text scan — `sh -c 'e\"\"val \"$(cat ./defs.sh)\"; git push --force'` and its `e\\val`/`g\"\"it` siblings) is CLOSED as designed, not merely claimed. I independently rebuilt the workspace and reproduced against the compiled `flywheel-shim` binary at HEAD: the control (unobfuscated `eval`) and all three obfuscated forms now report BOTH `namesGatedProgram:true` AND `textCanShadowPathResolution:true` (previously the split forms reported one or the other field `false`, which made the hook's AND defer). The eight launcher shapes (`sh -c \"git push --force\"` etc.) and `git commit -m \"fix: thing\"` still correctly report `textCanShadowPathResolution:false` and defer to layer 2 — confirmed directly, not inherited."
  gaps_remaining:
    - "AGNT-07 / Success Criterion 5 stays open. A NEW, different, live bypass (round six: `env -S`'s opaque-reparse wrapper detection, defeated by a backslash-split `env`) was found by plan 03-31's own obfuscation generator during this round's work and is independently reproduced below. It is not the same bypass round five closed — it is an adjacent mechanism (`resolve_segment_program_index`'s wrapper-token recognition) that the C1-C4 contract was never designed to reach."
    - "A second, separate finding (this session's code review's CR-01 — bash brace expansion, an unaddressed word-formation mechanism) reopens a documentation-soundness question the trust-boundary document has not yet answered. I independently reproduced it and judged it myself rather than inheriting the reviewer's characterization: see 'Independent judgment on CR-01 (brace expansion)' below."
  regressions: []
gaps:
  - truth: "An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (Success Criterion 5 / AGNT-07)."
    status: failed
    reason: >
      Two independent problems keep this truth false, both reproduced by me this session against the
      compiled binary and a real shell, using only `--classify-invocation` and harmless payloads
      (never a real git/rm invocation, per D-63):

      **1. Round six (primary blocker, already known and documented as OPEN by plan 03-31 itself).**
      `packages/shim/src/main.rs`'s `resolve_segment_program_index` recognises the wrapper token
      `env` by exact string equality over `tokenize_shell_words`'s RAW, un-normalized output — never
      retried against `shell_quote_removed`'s output the way the C1-C4 contract's own two safe-verdict
      facts are. `tokenize_shell_words` resolves quote-toggling but performs zero backslash-escape
      resolution, so a backslash-split `env` (`e\nv`) is never recognised as the wrapper token at all.
      Independent reproduction:
      ```
      $ target/debug/flywheel-shim --classify-invocation "env -S 'git push --force'"
      {"category":"uncategorized","invokedBareName":false,"program":null}     # correctly denies
      $ target/debug/flywheel-shim --classify-invocation "e\nv -S \"-P /tmp git push --force\""
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}  # DEFERS
      $ sh -c 'e\nv -S "echo REAL_ENV_RESOLVED"'
      REAL_ENV_RESOLVED    # confirms a real shell resolves e\nv to env identically
      ```
      For a nested payload carrying a PATH-defeating flag `text_can_shadow_path_resolution` does not
      independently re-check (BSD `env`'s `-P` altpath is the proven case; the unobfuscated `env -i`/
      `env -u PATH`/`command -p`/`builtin` wrapper cases ARE independently caught by a second scan
      pass over the quote-removed text, per the code review's own verification — `-S`/`-P` are the
      exception because `text_can_shadow_path_resolution` deliberately excludes them from its own
      trigger set and delegates entirely to the wrapper-token check that this obfuscation defeats).
      Zero human confirmation is reached at either layer for `sh -c 'e\nv -S "-P <altpath> git …"'`
      once `env` is backslash-split: Layer 1 defers (shown above) and Layer 2 never runs, because
      `env -P` performs its own alternate-PATH search that never consults the shim's shadow directory
      at all. This is not carried in `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`'s residual list as closed;
      it is the single, precisely-scoped, falsifiability-checked exception plan 03-31 itself added to
      `KNOWN_OPEN_BOUNDARY_FAILURES` and to `docs/destructive-gate-trust-boundary.md`'s Named
      residuals table and new "Round six" section — correctly reported prominently rather than
      quietly patched or silently excluded from the sweep. `AGNT-07` cannot read "always require
      explicit confirmation" while this shape reaches zero confirmation, and I confirm the finding
      is real rather than accepting the SUMMARY's own claim of it.

      **2. A second, independently-found finding from this session's own code review (CR-01 in
      `03-REVIEW.md`, dated 2026-09-22 — NOT the same CR-01 that round five closed): bash brace
      expansion is a real word-formation mechanism that C1 (quote/backslash removal) and C3
      (indeterminate word formation: `$`, backtick, letter-adjacent glob) do not model at all.**
      Independently reproduced:
      ```
      $ echo {gi,}t push --force
      git t push --force
      $ target/debug/flywheel-shim --classify-invocation '{gi,}t push --force'
      {"category":"safe","namesGatedProgram":false,"textCanShadowPathResolution":false}
      ```
      `text_names_gated_program`'s own doc comment claims to answer whether the raw text names `git`
      or `rm`; for this text it answers `false`, while a real shell resolves the first word to the
      literal program name via ordinary brace expansion the scanner never models. Grep confirms the
      string "brace" appears zero times in `docs/destructive-gate-trust-boundary.md` — the document's
      own "rule for round six" ("a newly found bypass shape is a boundary failure... amend this
      document first, only then a corpus row") has not yet been honored for this finding, because the
      review that found it ran after plan 03-31 closed. **I did not inherit the reviewer's
      characterization; I reproduced and extended it myself.** I confirmed with a harmless local PATH
      stub that `{gi,}t push --force` resolves through a REAL, ordinary `PATH` search (argv0 =
      `/tmp/…/git`, argv = `git t push --force` — broken git syntax, `t` is not a git subcommand) and
      that `{git,} push --force` (the empty alternative elides cleanly under word splitting) resolves
      to a clean `git push --force` invocation whose raw text DOES already trip `namesGatedProgram`
      (the literal substring "git" survives the `{`/`,` boundary) — so this specific two-alternative
      construction is NOT itself a live zero-confirmation bypass in either form I could construct: the
      first is syntactically broken, the second is still caught by the raw-text scan and, even where
      it were not, would only ever reach an ordinary `PATH` search Layer 2's own shadow directory
      still intercepts (confirmed: `--classify-command 'rm m -rf /tmp/x'` → `recursive-delete`, i.e.
      Layer 2's own argv-based classifier still flags the forwarded argv as destructive). I also
      independently tried brace-obfuscating one of the six shadow KEYWORDS the way round five
      obfuscated `eval` (`{ev,}al "echo …"`, `PA{T,}H=/tmp …`) and, like the reviewer, could not make
      either work: bash decides a leading word is an assignment lexically BEFORE brace expansion runs
      (confirmed live, harmless payload only: `PA{T,}H=/tmp …` errors "command not found", it is never
      treated as `PATH=/tmp`), and `{ev,}al` produces two separate words (`eval` and `al`), not one
      reassembled `eval` token, so no working shadow-keyword construction was found. **My own
      independent judgment on the severity, since the orchestrator asked me not to inherit the
      reviewer's framing: CR-01 (brace expansion) is a genuine documentation-soundness defect —
      `text_names_gated_program`'s claimed soundness is false for text using brace expansion — but it
      is NOT, on the evidence I could construct, an independent full zero-confirmation bypass the way
      round six is. It should still block a `passed`/`human_needed` verdict on its own terms (an
      unsound claim in a security-load-bearing function, undocumented, is itself a gap under this
      phase's own stated discipline — 'a scanner field whose false is read as proof is a claim, not a
      measurement, and any such field must name in this document the exact class for which its
      negative is sound', which `text_names_gated_program`'s current doc comment does not for brace
      expansion) — but round six alone is already sufficient to fail this truth, so CR-01's exact
      severity does not change the verdict, only what the next closure plan must also cover.**

      **On the question I was asked to judge independently — is C3 a genuine inversion, or an
      enumeration of three construct classes wearing an inversion's clothes?** I read
      `raw_text_word_formation_is_indeterminate` directly (`packages/shim/src/main.rs`). Its
      prose calls itself a refusal to "report absence it cannot prove," which is inversion language —
      but the implementation is a closed, positive list of exactly three trigger shapes: a literal `$`
      or backtick anywhere, or a `*`/`?`/`[` adjacent to a letter/digit/`_`. A genuine inversion would
      need some means of recognizing "this text's word formation is NOT fully determined by literal
      characters" for the general case and default to `true` unless positively proven determinate;
      what exists instead defaults to `true` only for the three shapes its authors already knew about
      (which happen to cover parameter expansion, command/arithmetic substitution, ANSI-C `$'...'`
      quoting — all `$`-prefixed — and pathname globbing) and defaults to `false` for everything else,
      including brace expansion, tilde expansion, and any future shell construct. This matches WR-03's
      own characterization in `03-REVIEW.md` almost exactly, and I concur with it independently: **C3
      is an enumeration of three specific, named mechanisms wearing an inversion's rhetorical clothes,
      not a genuine inversion.** The distinction matters because the document's own "rule for round
      six" is written against the inversion framing ("if you cannot write down the class for which the
      negative is sound, the field must report the unprovable case as unsafe") — and for brace
      expansion specifically, the class was never written down, which is exactly the failure mode that
      rule exists to prevent.
    artifacts:
      - path: "packages/shim/src/main.rs"
        issue: "resolve_segment_program_index's env-wrapper token-equality check runs only over tokenize_shell_words's raw, non-backslash-resolved output and is never retried against shell_quote_removed's output — the one mechanism among this closure's several text-normalization passes that the C1-C4 contract does not reach. A backslash-split env (e\\nv) escapes wrapper recognition entirely, and for env -S with a nested PATH-defeating flag (BSD -P altpath), this is a proven, live, zero-human-confirmation bypass."
      - path: "packages/shim/src/main.rs"
        issue: "text_names_gated_program (and, by the same gap, raw_text_can_shadow_path_resolution and raw_text_word_formation_is_indeterminate/C3) has no model of bash brace expansion ({alt1,alt2}) at all — a real, unconditional word-formation mechanism, distinct from the six mechanisms C1-C3 already cover. text_names_gated_program's false claim is unsound for text using it; independently reproduced this session and judged NOT to constitute a full bypass on its own (Layer 2's argv-based classifier still backstops the constructions found), but it is an undocumented, unresolved soundness gap in a security-load-bearing scanner."
      - path: "docs/destructive-gate-trust-boundary.md"
        issue: "Zero mentions of 'brace' anywhere in the document. The document's own 'rule for round six' requires a newly found bypass shape to be named and the document corrected before any corpus row addresses it; this has been done for round six (env -S) but not yet for the brace-expansion finding, which was found by a review that ran after 03-31 closed."
    missing:
      - "A round-seven plan implementing one of the two candidate fix directions 03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md already names: retry resolve_segment_program_index's env/command/builtin wrapper-token recognition against shell_quote_removed's output, OR deliberately over-deny on any quote/backslash adjacent to env/command/builtin."
      - "A Named-residuals row (or a fix) for bash brace expansion in docs/destructive-gate-trust-boundary.md, per the document's own round-six-onward discipline, before any new LAUNCHER_CORPUS row addresses it — whether the eventual fix folds brace-alternative expansion into C1's normalization (computing every alternative and re-scanning each) or C3's indeterminacy trigger (treating letter-adjacent {/}/, as indeterminate the way letter-adjacent globs already are)."
      - "WR-01 (03-REVIEW.md): an explicit null payload in the readProvenBoolean regression test, matching its own doc comment's enumerated cases."
      - "WR-02 (03-REVIEW.md): GROUP_3_COMMANDS derived by a stable marker (e.g. a group field on each LAUNCHER_CORPUS row) rather than a fixed index range guarded only by a total-length assertion, which a same-length reorder would defeat silently."
    deferred_items_note: "No later phase in ROADMAP.md addresses git/rm destructive-action gating or the shell-text scanner; nothing here is deferred to future roadmap phases."
---

# Phase 3: Nothing Lost, Nothing Left Running — Verification Report (Re-Verification)

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-22T00:00:00Z
**Status:** gaps_found
**Re-verification:** Yes — this report supersedes the prior `03-VERIFICATION.md` (`gaps_found`, 4/5),
whose single recorded gap (round five's quote/backslash-split obfuscation of `eval`/`git`) is CLOSED
by plans 03-29/03-30, independently confirmed below. But two further findings — one already known
and reported by plan 03-31 itself (round six, `env -S` backslash-split, OPEN), one found by the code
review that ran immediately before this verification (this session's own CR-01, bash brace
expansion) — keep AGNT-07 / Success Criterion 5 failing, on different and narrower shapes than
before.

## Independent reproduction: round five is genuinely closed

Rebuilt the workspace (`cargo build --workspace`, no recompilation needed — binary already at HEAD)
and drove the exact commands the prior verification's gap was built on directly against
`target/debug/flywheel-shim`:

| Command | Result | Verdict |
|---|---|---|
| `sh -c 'eval "$(cat ./defs.sh)"; git push --force'` (control) | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}` | denies (as before) |
| `sh -c 'e""val "$(cat ./defs.sh)"; git push --force'` | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}` | **now denies — was `false` before** |
| `sh -c 'e\val "$(cat ./defs.sh)"; git push --force'` | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}` | **now denies — was `false` before** |
| `sh -c 'eval "$(cat ./defs.sh)"; g""it push --force'` | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}` | **now denies — was `false` before** |
| `sh -c "git push --force"` (launcher-shape control) | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}` | still defers to layer 2, unchanged |
| `git commit -m "fix: thing"` (ordinary-command control) | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}` | still defers, unchanged |

Full workspace suites, run once each this session: `cargo test --workspace` — all crates pass;
`npm --prefix packages/sidecar test` — 96/96 pass, 0 fail; `npm --prefix packages/desktop test` —
440/440 pass across 32 files. No `TBD`/`FIXME`/`XXX` debt markers in any file this round's plans
(03-29..03-31) touched.

## Independent reproduction: round six (`env -S` backslash-split) is a real, open bypass

```
$ target/debug/flywheel-shim --classify-invocation "env -S 'git push --force'"
{"category":"uncategorized","invokedBareName":false,"program":null}
$ target/debug/flywheel-shim --classify-invocation "e\nv -S \"-P /tmp git push --force\""
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ sh -c 'e\nv -S "echo REAL_ENV_RESOLVED"'
REAL_ENV_RESOLVED
```
The unobfuscated form correctly denies (`uncategorized`/`invokedBareName:false` routes to the hook's
non-safe deny branch, since `shimWillIntercept` is never reached without `invokedBareName === true`).
The backslash-split form is classified `safe` with the AND-gate's two facts `true`/`false`, so the
hook defers unconditionally — and a real shell resolves `e\nv` to `env` identically, confirmed with a
harmless `echo` payload (D-63). Layer 2 provides no backstop for this shape specifically because BSD
`env -P` performs its own alternate-PATH search that never touches the shim's shadow directory — this
was proven live and non-destructively by plan 03-31 itself (a harmless stub named `git` at the
altpath ran instead of the shim). I did not re-run the live-shell proof (it requires constructing a
throwaway altpath directory and is already documented with full reproduction steps in
`03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md`); the `--classify-invocation` half above, which is the
part that determines the hook's decision, I reproduced directly myself.

## Independent reproduction and judgment: this session's CR-01 (brace expansion)

```
$ echo {gi,}t push --force
git t push --force
$ target/debug/flywheel-shim --classify-invocation '{gi,}t push --force'
{"category":"safe","namesGatedProgram":false,"textCanShadowPathResolution":false}
```
Confirmed `namesGatedProgram`'s `false` is unsound for this text — a real shell resolves the first
word to `git` via ordinary brace expansion, which neither C1 (quote/backslash removal) nor C3
(`$`/backtick/letter-adjacent-glob indeterminacy) models. I extended the reviewer's own testing with a
local harmless PATH stub to check whether this reaches a genuine bypass:
```
$ PATH="/tmp/cr01test:$PATH" sh -c '{gi,}t push --force'
ARGV: /tmp/cr01test/git t push --force        # broken: "t" is not a valid git subcommand
$ PATH="/tmp/cr01test:$PATH" sh -c '{git,} push --force'
ARGV: /tmp/cr01test/git push --force            # clean, but namesGatedProgram is ALREADY true for
$ target/debug/flywheel-shim --classify-invocation '{git,} push --force'                # this text
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-command 'rm m -rf /tmp/x'
recursive-delete                                # Layer 2's own argv classifier still flags it
```
I also independently tried brace-obfuscating one of the six shadow keywords, the way round five
obfuscated `eval` (`{ev,}al "echo …"`) and a brace-split `PATH=` assignment (`PA{T,}H=/tmp …`) —
both, like the reviewer's own attempts, produced broken shell syntax rather than a working shadow
construct (bash decides a leading word is an assignment BEFORE brace expansion runs; `{ev,}al`
produces two separate words, not a reassembled `eval` token).

**My own judgment, not inherited from the reviewer:** brace expansion is a genuine, undocumented
soundness gap in `text_names_gated_program`'s claim (the string "brace" appears zero times in
`docs/destructive-gate-trust-boundary.md`, confirmed by grep), and on the question the orchestrator
asked me to weigh — whether C3 is a genuine inversion or an enumeration of three construct classes
wearing an inversion's clothes — **I judge it to be the latter: an enumeration.** Its own doc comment
uses inversion language ("refuses to report absence it cannot prove"), but the code is a closed,
positive list of exactly three trigger shapes (`$`, backtick, letter-adjacent glob), which happens to
cover parameter/command/arithmetic expansion and ANSI-C quoting (all `$`-prefixed) and pathname
globbing, but has no representation at all for brace expansion, tilde expansion, or any future
mechanism. This is not, on the evidence I could construct, an independent full zero-confirmation
bypass the way round six is — every construction I found either produces broken shell syntax or is
still caught by the raw-text scan or Layer 2's own argv classifier — but it is a real gap the trust
boundary document's own stated discipline requires naming before any further corpus work proceeds,
and it does not change this truth's already-failing status (round six alone is sufficient).

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | Unchanged by plans 03-29..03-31 (`git diff --stat` confirms only `docs/destructive-gate-trust-boundary.md`, `packages/shim/src/main.rs`, `packages/sidecar/src/pretooluse-hook.ts`, `packages/sidecar/test/destructive-gate.test.mjs`, and one new findings doc were touched — no `packages/core/src` or `packages/desktop/src` file). Regression-only check per re-verification mode. Previously verified via `03-UAT.md` test 1. |
| 2 | User quits the application while a session is running and no agent process survives. | ✓ VERIFIED | Unchanged; no watchdog/supervisor file touched this round. `npm --prefix packages/sidecar test` (96/96, includes the watchdog/heartbeat/kill-record suite, confirmed passing this session) provides fresh regression evidence beyond a stale-file check. Previously verified via `03-UAT.md` test 1. |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database. | ✓ VERIFIED | Unchanged; no reconciliation file touched this round. `npm --prefix packages/desktop test` (440/440, confirmed passing this session) provides fresh regression evidence. Previously verified via `03-UAT.md` test 2. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — retry and spawn-stagger. | ✓ VERIFIED | Unchanged; `git_retry.rs` and `shim.rs`'s `shim_env_for_run` untouched this round. `cargo test --workspace` (confirmed passing this session, all crates including `flywheel-core`'s retry tests) provides fresh regression evidence. Previously verified via `03-UAT.md` test 5. |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (compound truth this SC and AGNT-07 share). | ✗ FAILED | **Round five's specific bypass (quote/backslash-split `eval`/`git`) is CLOSED, independently confirmed above.** But round six (`env -S` backslash-split, a proven live zero-confirmation bypass for BSD `env -P`) remains open, and this session's own code review found a second, distinct, undocumented soundness gap (brace expansion) that the boundary document has not yet named. Both independently reproduced above. |

**Score:** 4/5 truths verified (0 present-behavior-unverified; 1 failed, blocking).

## Requirements state — my ruling (per the orchestrator's explicit question)

`REQUIREMENTS.md` currently reads (confirmed by direct `grep`, not trusted from any verb's report):
`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`, `PROC-05` = `Complete`; `AGNT-07` =
`Gaps Found`.

**I consider the seven non-AGNT-07 requirements genuinely delivered**, not merely "blocked by the
phase-level verdict." Their implementations are in files plans 03-29..03-31 never touched (confirmed
by `git diff --stat` against the pre-03-29 commit: only `docs/destructive-gate-trust-boundary.md`,
`packages/shim/src/main.rs`, `packages/sidecar/src/pretooluse-hook.ts`,
`packages/sidecar/test/destructive-gate.test.mjs`, plus planning/tracking files, changed), and the
full workspace suites that prove them — `cargo test --workspace`, `npm --prefix packages/sidecar
test`, `npm --prefix packages/desktop test` — all pass, confirmed by me this session rather than
taken from the SUMMARY. Per the #2388 rule this orchestrator named, this `gaps_found` verdict will
revert those seven to non-`Complete` in `REQUIREMENTS.md` — that reversion is a bookkeeping
consequence of AGNT-07 sharing a phase with them, not a finding that their own work is incomplete or
should be redone. Whoever picks this phase back up should re-mark them `Complete` once the phase as a
whole clears, without re-verifying their underlying implementation.

**AGNT-07 is genuinely incomplete**, not a process artifact. Round six is a proven, live,
zero-human-confirmation bypass for a real, executable shell construct — independently reproduced by
me above, not merely inherited from the SUMMARY's claim. AGNT-07's own text — "Destructive actions
… always require explicit confirmation, even when the session is running in an auto-accept permission
mode" — is false as long as `env -S "-P <altpath> git push --force"` reaches zero confirmation once
`env` is backslash-split.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/shim/src/main.rs` | `resolve_segment_program_index`'s `env`-wrapper token check (main.rs:1154 segment loop) | Wrapper-token recognition runs only over raw, non-backslash-resolved tokens, never retried against `shell_quote_removed`'s output | 🛑 Blocker | Round six: `e\nv -S "-P <altpath> …"` reaches zero human confirmation at either layer. Already reported by plan 03-31 in `docs/destructive-gate-trust-boundary.md` and `03-ROUND-SIX-ENV-OPAQUE-REPARSE-BYPASS.md` — not a new finding, but independently re-confirmed live this session, not merely inherited. |
| `packages/shim/src/main.rs` | `text_names_gated_program` / C1 / C3 (main.rs:977-1066) | No model of bash brace expansion (`{alt1,alt2}`) anywhere in the C1-C4 contract | ⚠️ Warning | This session's own CR-01: `text_names_gated_program`'s `false` claim is unsound for brace-expanded text naming `git`/`rm`. Not, on the evidence constructed (by the reviewer or independently by me), a full bypass on its own — Layer 2's argv classifier and the raw-text scan still catch every construction found — but an undocumented soundness gap in a security-load-bearing function. |
| `docs/destructive-gate-trust-boundary.md` | whole document | Zero mentions of "brace" anywhere (confirmed by grep) | ⚠️ Warning | The document's own "rule for round six" requires naming a newly found bypass shape and correcting the document before any corpus row addresses it. This has been done for round six (`env -S`) but not yet for brace expansion, because the review that found it ran after plan 03-31 closed — expected sequencing, not a violation, but still an open item. |
| `packages/sidecar/test/destructive-gate.test.mjs` | `readProvenBoolean` regression (`destructive-gate.test.mjs:1147-1213`) | No explicit `null`-valued payload tested, though the function's own doc comment enumerates `null` as a case it collapses | ⚠️ Warning | WR-01 from `03-REVIEW.md`: the current implementation is correct for `null` by inspection (`typeof null === "object"`), so this is a coverage gap, not a live bug — but a future refactor could reintroduce the exact WR-01-shaped bug this test exists to catch. |
| `packages/sidecar/test/destructive-gate.test.mjs` | `GROUP_3_START_INDEX`/`GROUP_3_END_INDEX` (`destructive-gate.test.mjs:1420-1430`) | Fixed index range guarded only by a total-length assertion, not a content check | ⚠️ Warning | WR-02 from `03-REVIEW.md`: a same-length reorder of `LAUNCHER_CORPUS` would silently mistag which rows receive Group 3's extra obfuscation coverage, with no test failure to flag it. |

No `TBD`/`FIXME`/`XXX` debt markers found in any file this phase's plans 03-29..03-31 touched
(confirmed by direct grep, this session).

## Behavioral Spot-Checks

All commands below were run directly against the compiled `target/debug/flywheel-shim` binary at
HEAD (rebuilt this session via `cargo build --workspace`) using only `--classify-invocation`/
`--classify-command` (pure classification, never executes anything) or a harmless `echo`/stub-`git`
payload where real-shell resolution needed confirming — never a destructive command against a real
remote or worktree (D-63).

| Behavior | Command | Result | Status |
|---|---|---|---|
| Round five control: unobfuscated `eval` inside `sh -c` | `--classify-invocation "sh -c 'eval ...; git push --force'"` | `{"...":true,"...":true}` | ✓ PASS (denies) |
| Round five: `e""val` now closed | `--classify-invocation "sh -c 'e\"\"val ...; git push --force'"` | both fields `true` | ✓ PASS (denies — was FAIL in prior round) |
| Round five: `e\val` now closed | `--classify-invocation "sh -c 'e\\val ...; git push --force'"` | both fields `true` | ✓ PASS (denies — was FAIL in prior round) |
| Round five: `g""it` now closed | `--classify-invocation "sh -c 'eval ...; g\"\"it push --force'"` | both fields `true` | ✓ PASS (denies — was FAIL in prior round) |
| Launcher-shape control still defers | `--classify-invocation 'sh -c "git push --force"'` | `namesGatedProgram:true, textCanShadow:false` | ✓ PASS (defers to layer 2, unchanged) |
| Round six: unobfuscated `env -S` correctly denies | `--classify-invocation "env -S 'git push --force'"` | `{"category":"uncategorized","invokedBareName":false}` | ✓ PASS (denies) |
| Round six: backslash-split `env` bypasses | `--classify-invocation "e\\nv -S \"-P /tmp git push --force\""` | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}` | ✗ FAIL (defers — bypass confirmed) |
| Round six: real shell resolves `e\nv` (harmless payload) | `sh -c 'e\nv -S "echo REAL_ENV_RESOLVED"'` | `REAL_ENV_RESOLVED` | ✓ PASS (confirms obfuscation is real, not scanner-only) |
| CR-01: brace-expansion unsound claim | `--classify-invocation '{gi,}t push --force'` | `namesGatedProgram:false` | ✗ FAIL (claim unsound — real shell resolves to `git t ...`, confirmed via harmless PATH stub) |
| CR-01: Layer 2 backstop check | `--classify-command 'rm m -rf /tmp/x'` | `recursive-delete` | ✓ PASS (Layer 2's argv classifier still flags the forwarded argv even with the extra token) |
| Full sidecar suite | `npm --prefix packages/sidecar test` (run once) | 96/96 `ok`, 0 fail | ✓ PASS |
| Full desktop suite | `npm --prefix packages/desktop test` (run once) | 440/440 pass, 32 files | ✓ PASS |
| Full Rust suite | `cargo test --workspace` (run once) | all crates pass | ✓ PASS |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | Worktree never destroyed without checking for uncommitted changes | ✓ SATISFIED | Unchanged this round; genuinely delivered (see ruling above). `REQUIREMENTS.md` currently `Complete`; will be reverted by this `gaps_found` verdict per #2388 — bookkeeping only. |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git ops retry with backoff/jitter on index-lock contention | ✓ SATISFIED | Same as above. |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing desynchronised to avoid index collisions | ✓ SATISFIED | Same as above. |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | Launch reconciles worktrees in DB against disk, surfaces discrepancy | ✓ SATISFIED | Same as above. |
| PROC-03 | 03-02, 03-15 | Agent processes managed as process groups | ✓ SATISFIED | Same as above. |
| PROC-04 | 03-02, 03-10, 03-15, 03-17, 03-20, 03-21 | No agent process survives application quit | ✓ SATISFIED | Same as above. |
| PROC-05 | 03-06, 03-10, 03-11, 03-17, 03-23 | Orphaned processes/runs detected and surfaced on launch | ✓ SATISFIED | Same as above. |
| AGNT-07 | 03-07, 03-12, 03-14, 03-16, 03-19..03-31 | Destructive actions always require explicit confirmation, even in auto-accept mode | ✗ BLOCKED | Round six (independently reproduced) is a live, zero-confirmation bypass; CR-01 (brace expansion, independently reproduced and judged) is a further undocumented soundness gap. `REQUIREMENTS.md` line 272 reads `Gaps Found`, which is CORRECT and must NOT change. No orphaned requirement IDs: the phase's declared set (`WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05, AGNT-07`) exactly matches every ID any plan in this phase claims and every ID `REQUIREMENTS.md` maps to Phase 3. |

**Caution recorded, matching the orchestrator's own note:** `requirements.mark-complete` has no
shared-ID gate and has wrongly flipped `AGNT-07` to `Complete` at least once before (plan 03-26). I
did not trust any verb's output for the current state — the table above is from a direct `grep` of
`.planning/REQUIREMENTS.md` at HEAD, reproduced in this report.

## Human Verification Required

None. Every truth in this report was settled by direct source read, direct binary invocation, direct
shell invocation with harmless payloads, or a full-suite test run — no item required manual UI/UX
judgment or an unrunnable check.

---

_Verified: 2026-09-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
