---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-22T00:00:00Z
status: gaps_found
score: 5/6 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-35-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-35-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-36-PLAN.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-36-SUMMARY.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REQUIREMENTS-BOOKKEEPING.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW.md"
  - "docs/destructive-gate-trust-boundary.md"
  - "packages/shim/src/main.rs"
  - "packages/shim/tests/classify_invocation.rs"
  - "packages/sidecar/test/destructive-gate.test.mjs"
covered_digest: "v1:sha256:57c7f5a421b742d6ded12a97b897f05e74425924d415e84fb138cd5e106be3a5"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Round eight CR-01 (brace-expansion-obfuscated env/command WRAPPER tokens, e.g. {env,} -S \"-P <altpath> git push --force\" and {command,} -p git push --force) is CLOSED. Independently reproduced against the compiled flywheel-shim binary at HEAD (plan 03-35's C6, raw_text_names_path_defeating_wrapper): `--classify-invocation '{env,} -S \"-P /tmp git push --force\"'` now reports {\"category\":\"safe\",\"namesGatedProgram\":true,\"textCanShadowPathResolution\":true} — the AND-gate fact pair the D-61 hook reads — where the prior verification recorded textCanShadowPathResolution:false (a false claim of proven absence). Also independently confirmed at the real compiled hook level (packages/sidecar/dist/pretooluse-hook.js, shim genuinely on PATH via a from-scratch makeShimDir-style harness I built myself): the brace-obfuscated and nested sh -c forms now deny (exit 2, permissionDecision deny, reason \"this command's text can pre-empt PATH resolution and names a program Flywheel gates\"), where they previously returned {}/exit 0 (zero human confirmation). The unobfuscated control and an ordinary git status both produced the expected deny/defer respectively in the same harness, ruling out a harness artifact."
    - "The two path-qualified siblings (/usr/bin/env -S ..., /usr/bin/command -p ...) and the three indeterminate flag/NAME-position shapes (env {-S,}, command {-p,}, env -u {PATH,}) — found during 03-35's own planning pass, not named in any prior verification — are also independently reproduced as CLOSED: each now reports textCanShadowPathResolution:true against the compiled binary at HEAD."
    - "The falsifiability companions still correctly defer, confirmed independently: command -v git, env {git,} push --force, sh -c 'env -S \"echo hello\"', git status, git add src/{a,b}.rs, mkdir -p src/{a,b}, and env -u FOO git push --force (still routes to force-push/Destructive, not a false trigger on an unrelated --unset variable)."
    - "The mechanical brace-expansion sweep (OBFUSCATION_SPLIT_KINDS' new wrap-mechanism entry, plan 03-36 Task 1) now generates the round-eight CR-01 payload mechanically from the existing env -S corpus row, rather than requiring a human to hand-write it, and the decision-invariance assertion passes strict with zero carried KNOWN_OPEN_BOUNDARY_FAILURES exceptions (confirmed empty by direct grep)."
    - "The corpus (LAUNCHER_CORPUS, ORDINARY_USAGE_CORPUS) carries all round-eight shapes and both new falsifiability companions, all landing after the boundary document named the mechanism (enforced by plan 03-36's depends_on on 03-35) — confirmed by direct grep of every claimed row string."
    - "npm --prefix packages/sidecar test: 96/96 pass, # fail 0, no SKIPPED (shim-binary tests), independently re-run this session. cargo test -p flywheel-shim --test classify_invocation: 20/20 pass, independently re-run. cargo test --workspace: independently re-run in full this session, zero failures (no flake reproduced this run)."
  gaps_remaining: []
  regressions: []
gaps:
  - truth: "The document's friction accounting names the ordinary letter-adjacent brace-in-a-commit-message class that denies today and the new, narrower class C6 adds — the documented price stops understating the actual price (plan 03-35's own must-have truth, quoting 03-REVIEW.md WR-01)."
    status: failed
    reason: >
      This specific must-have truth is independently disproven for a NEW instance of the same failure
      mode it was written to close. Plan 03-35/03-36 correctly priced WR-01's class (the ordinary
      letter-adjacent brace, e.g. `git commit -m "add {foo}bar support"`) and correctly documented C6's
      OWN new class as narrowly as: "a token carrying a non-letter-adjacent brace or glob AND a `-`,
      standing immediately where `env`'s or `command`'s own flag belongs." I independently confirmed,
      by direct code read of `raw_text_names_path_defeating_wrapper` (main.rs:1232-1300) and by live
      reproduction against the compiled binary, that this stated boundary is FALSE: an entirely
      ordinary, non-obfuscated quoted argument that merely happens to mention `command`/`env`
      immediately followed by one of their gated flags in prose denies too — no brace, no glob, no
      dash-adjacency to a wrapper token anywhere in the original text.

      Root cause, confirmed by direct code read: `raw_text_names_path_defeating_wrapper` scans TWO
      forms — the raw text, and `shell_quote_removed(text)` (C1/C2's context-free quote/backslash
      stripper, reused here). `shell_quote_removed` strips every `'`/`"` character with NO
      quoting-context tracking, so `git commit -m "the command -p form"` becomes
      `git commit -m the command -p form` after stripping, which `tokenize_shell_words` then
      re-tokenizes on WHITESPACE into separate array elements — collapsing what was one quoted shell
      word into several. The wrapper-flag walk (`j = i + 1`) then sees the token `-p` immediately
      following the token `command` and fires, purely as an artifact of quote removal destroying the
      original word boundary, not because of any brace/glob/dash obfuscation the document's own C6
      clause names as the trigger.

      Independently reproduced against the compiled `flywheel-shim` binary at HEAD, this session,
      exactly as this round's own code review (`03-REVIEW.md`, WR-A) first found and I re-verified from
      a clean read rather than trusting the review's narration:
      ```
      $ flywheel-shim --classify-invocation 'git commit -m "the command -p form"'
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
      $ flywheel-shim --classify-invocation 'git commit -m "the env -i flag clears vars"'
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
      ```
      compared with the corpus's own control, which correctly still defers because no recognised flag
      token immediately follows "command" after quote-stripping:
      ```
      $ flywheel-shim --classify-invocation 'git commit -m "fix the command parser"'
      {"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
      ```

      This is judged a WARNING-class finding, not a security bypass: the effect is OVER-triggering
      (denying more than claimed), never under-triggering, so Success Criterion 5 / AGNT-07's core
      behavioral truth (destructive actions still stop and ask, even in auto-accept mode) is NOT
      violated by this defect — if anything it is over-satisfied. But it is a concrete, deterministic,
      independently-reproduced falsification of a factual claim this round's own authors wrote into a
      required artifact (`docs/destructive-gate-trust-boundary.md`), and it directly violates one of
      plan 03-35/03-36's own stated prohibitions ("must never add gate friction without pricing it, in
      the same change, in both the trust-boundary document and the ordinary-usage corpus"). This
      project's own established discipline across all eight prior verification rounds treats any
      mismatch between the document's claim and the code's actual behavior as itself a boundary failure
      requiring correction — independent of whether the mismatch is a bypass or an over-trigger — so I
      apply that same discipline here rather than waiving it because the direction happens to be safe.

      Not caught by any existing test: `ORDINARY_USAGE_CORPUS`'s only C6-friction row uses the
      brace-wrapped form (`"the command {-p,} form"`); no row exercises a plain, non-obfuscated mention
      of a recognised flag word after "env"/"command" in prose. The mechanical `obfuscationVariants`
      sweep only generates variants from `LAUNCHER_CORPUS` real invocations, never from prose-in-quotes
      shapes, so it cannot surface this either — confirmed by direct read of the sweep's own row
      source (`LAUNCHER_CORPUS.map((row) => row.command)`).
    artifacts:
      - path: "docs/destructive-gate-trust-boundary.md"
        issue: "The C6 clause's own soundness-class paragraph and the widened friction-accounting paragraph both state C6's new friction class as 'a token carrying a non-letter-adjacent brace or glob AND a -, standing immediately where env's or command's own flag belongs' — independently confirmed false. The actual class is broader: any quoted prose in which a recognised flag word happens to sit immediately after 'env'/'command' once shell_quote_removed's context-free quote stripping collapses the original word boundary."
      - path: "packages/shim/src/main.rs"
        issue: "raw_text_names_path_defeating_wrapper (C6, lines 1232-1300) computes flag-adjacency (j = i + 1) over shell_quote_removed's re-tokenized output, which has no memory of which tokens were originally inside a single quoted shell word versus genuinely space-separated in the raw command line — the same root cause WR-A traces, confirmed by direct code read."
      - path: "packages/sidecar/test/destructive-gate.test.mjs"
        issue: "ORDINARY_USAGE_CORPUS's only C6-friction row (\"the command {-p,} form\") is brace-obfuscated; no row exercises the plain non-obfuscated prose shape (e.g. 'the command -p form') that also denies, so the actual, broader friction class is untested and undocumented."
    missing:
      - "Either (a) narrow the flag-adjacency check so it is computed within a single tokenize_shell_words token's own original quoted span rather than after shell_quote_removed collapses quoting structure (03-REVIEW.md's own suggested fix), or (b) if the false positive is accepted as a deliberate trade like C3's brace-adjacency cost, correct docs/destructive-gate-trust-boundary.md's C6 soundness-class paragraph to state the true, broader scope (plain prose naming a recognised flag word immediately after env/command, not only brace/glob+dash forms) and add a representative non-brace ORDINARY_USAGE_CORPUS row (e.g. `git commit -m \"document the command -p flag behavior\"`, expect deny) pricing it."
    deferred_items_note: "No later phase in ROADMAP.md addresses git/rm destructive-action gating or the shell-text scanner; nothing here is deferred to future roadmap phases."
---

# Phase 3: Nothing Lost, Nothing Left Running — Verification Report (Re-Verification, round nine)

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-22T00:00:00Z
**Status:** gaps_found
**Re-verification:** Yes — this report supersedes the prior `03-VERIFICATION.md` (round eight,
`gaps_found`, 4/5). Round eight's single recorded gap — the live, zero-human-confirmation
brace/path-qualified/indeterminate-flag `env`/`command` wrapper-token bypass (CR-01) — is now CLOSED,
independently reproduced three ways below (classifier, real compiled hook, mechanical sweep). This is
the FIRST round of this phase's nine verification passes in which no live bypass of the destructive
gate is found by either this verification or the fresh code review that preceded it. A single new
gap remains: this round's own review's WR-A (a factual inaccuracy in the trust-boundary document's own
friction-pricing claim), a documentation/over-triggering defect rather than a security bypass.

## Independent reproduction: round eight (CR-01) is now genuinely closed

All five reproduced live: brace-obfuscated `env`/`command`, the nested `sh -c` form, the two
path-qualified siblings, and the indeterminate flag/NAME positions.

```
$ target/debug/flywheel-shim --classify-invocation '{env,} -S "-P /tmp git push --force"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}      # was false
$ target/debug/flywheel-shim --classify-invocation "sh -c '{env,} -S \"-P /tmp git push --force\"'"
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}      # was false
$ target/debug/flywheel-shim --classify-invocation '{command,} -p git push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}      # was false
$ target/debug/flywheel-shim --classify-invocation '/usr/bin/env -S "-P /tmp git push --force"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}      # was false, no obfuscation at all
$ target/debug/flywheel-shim --classify-invocation '/usr/bin/command -p git push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}      # was false
$ target/debug/flywheel-shim --classify-invocation 'env -u {PATH,} git push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'env {-S,} "-P /tmp git push --force"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'command {-p,} git push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
```

Falsifiability companions still correctly defer (proving C6 did not become a bare-presence/general
brace-presence rule):

```
$ target/debug/flywheel-shim --classify-invocation 'command -v git'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation 'env {git,} push --force'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation "sh -c 'env -S \"echo hello\"'"
{"category":"safe","namesGatedProgram":false,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'git status'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}
$ target/debug/flywheel-shim --classify-invocation 'env -u FOO git push --force'
{"category":"force-push","invokedBareName":true,"program":"git"}
```

**Real compiled hook, end-to-end, built from my own from-scratch harness (not narrated from the
review or the SUMMARY) — `makeShimDir`-equivalent shim directory with the binary copied under `git`
and `rm`, `FLYWHEEL_SHIM_BIN` pointed at the copy, `PATH` genuinely prefixed with the shim dir:**

```
$ echo '{"tool_input":{"command":"{env,} -S \"-P /tmp git push --force\""}}' | \
    env FLYWHEEL_SHIM_BIN="$SHIMDIR/git" PATH="$SHIMDIR:$PATH" node packages/sidecar/dist/pretooluse-hook.js
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
 "permissionDecisionReason":"Flywheel could not verify this command was safe (this command's text can
 pre-empt PATH resolution and names a program Flywheel gates, so its safety cannot be proven) —
 refusing it."}}
exit=2                                                                          # was {}/exit 0

$ echo "{\"tool_input\":{\"command\":\"sh -c '{env,} -S \\\"-P /tmp git push --force\\\"'\"}}" | \
    env FLYWHEEL_SHIM_BIN="$SHIMDIR/git" PATH="$SHIMDIR:$PATH" node packages/sidecar/dist/pretooluse-hook.js
deny, exit=2                                                                    # was {}/exit 0, nested form

$ echo '{"tool_input":{"command":"env -S \"-P /tmp git push --force\""}}' | \
    env FLYWHEEL_SHIM_BIN="$SHIMDIR/git" PATH="$SHIMDIR:$PATH" node packages/sidecar/dist/pretooluse-hook.js
deny, exit=2                                                                    # unobfuscated control, unchanged

$ echo '{"tool_input":{"command":"git status"}}' | \
    env FLYWHEEL_SHIM_BIN="$SHIMDIR/git" PATH="$SHIMDIR:$PATH" node packages/sidecar/dist/pretooluse-hook.js
{} exit=0                                                                       # ordinary command, still defers
```

The brace-obfuscated and nested forms now reach a human-blocking deny at exit 2 through the real,
shipped hook script — where round eight's verification recorded `{}`/exit 0 (zero human confirmation
in auto-accept mode) for the identical payloads. The unobfuscated control and an ordinary `git status`
in the same harness confirm this is the fix, not a harness artifact.

**Mechanical sweep (plan 03-36 Task 1), confirmed by direct source read:** `OBFUSCATION_SPLIT_KINDS`
now carries a fourth, `wrap`-mechanism `brace-expansion` entry; `occurrenceIsCompleteShellWord` guards
it; `braceVariantCount` is asserted `>= 30`; `KNOWN_OPEN_BOUNDARY_FAILURES` is still the literal empty
array `[]` (confirmed by direct grep — no exception was carved to make the sweep pass).

## Independent reproduction: this round's own code review's WR-A — the C6 friction claim is false (new gap)

`03-REVIEW.md` (committed `7e07389`) found no bypass, but found the trust-boundary document's own
soundness claim for C6 to be false: an ordinary, non-obfuscated commit message denies too, not only
the brace/glob+dash form the document and the one existing test price. I did not inherit the review's
characterization — I re-derived the root cause from a clean read of `raw_text_names_path_defeating_wrapper`
(main.rs:1232-1300) and independently reproduced the payloads:

```
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "the command -p form"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "the env -i flag clears vars"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}
$ target/debug/flywheel-shim --classify-invocation 'git commit -m "fix the command parser"'
{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}   # control: correctly defers
```

Root cause, confirmed by code read: `raw_text_names_path_defeating_wrapper` scans `shell_quote_removed(text)`
as its second form — a context-free quote/backslash stripper with no quoting-context tracking. Stripping
the quotes from `git commit -m "the command -p form"` yields `git commit -m the command -p form`, which
`tokenize_shell_words` then splits on whitespace into separate tokens, placing `-p` immediately after
`command` — exactly the adjacency the wrapper-flag walk treats as a real flag. This has nothing to do
with brace/glob obfuscation; it is quote removal destroying the original single-word boundary. This is
an OVER-triggering defect (denies more than claimed), not a bypass — Success Criterion 5's core
behavioral truth is not weakened by it — but it is a concrete, reproducible falsification of a written
claim in a required security artifact, and it recurs the exact failure mode (understated friction
pricing) that round eight's own fourth `missing:` item was about, in a new instance this round's own
fix introduced. See `gaps:` above for the full analysis and suggested fix.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria + merged plan must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | Unchanged by plans 03-35/03-36 (diff touches only `docs/destructive-gate-trust-boundary.md`, `packages/shim/src/main.rs`, `packages/shim/tests/classify_invocation.rs`, `packages/sidecar/test/destructive-gate.test.mjs`, `.planning/phases/03.../03-REQUIREMENTS-BOOKKEEPING.md` — no `packages/core` or `packages/desktop` file touched). Regression-only check per re-verification mode. Previously verified via `03-UAT.md` test 1. |
| 2 | User quits the application while a session is running and no agent process survives — including when the supervisor is killed rather than closed cleanly. | ✓ VERIFIED | Unchanged; no watchdog/supervisor file touched this round. Independently re-ran `npm --prefix packages/sidecar test` this session: 96/96 pass including the watchdog/heartbeat/interrupt-escalation tests (`ok 92`-`96`), `# fail 0`, no `SKIPPED`. |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database; nothing is silently resumed or repaired. | ✓ VERIFIED | Unchanged; no reconciliation file touched this round. Regression-only check per re-verification mode. `cargo test --workspace` (independently re-run in full this session) includes `launch_reconciliation.rs`'s 16 tests, all passing. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — index-lock collisions back off and retry, staggered spawn timing avoids collisions. | ✓ VERIFIED | Unchanged; `git_retry.rs`/`shim.rs`'s `shim_env_for_run` untouched this round. Independently re-ran `cargo test --workspace` in full this session: zero failures across every crate (no transient flake reproduced this run, unlike the documented pattern from 03-32/03-34's own runs). |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (Success Criterion 5 / AGNT-07's core behavioral claim). | ✓ VERIFIED | Round eight's live, zero-human-confirmation bypass (CR-01: brace-obfuscated/path-qualified/indeterminate-flag `env`/`command` wrapper tokens) is CLOSED, independently reproduced three ways above (classifier, real compiled hook via a from-scratch harness, and the mechanical brace-expansion sweep with zero carried exceptions). A fresh, independent code review (`03-REVIEW.md`) actively searched for a further bypass — including hand-constructed adversarial payloads not in either corpus — and found none. |
| 6 | (Plan 03-35 must-have) The documented price of C6's friction stops understating the actual price. | ✗ FAILED | `03-REVIEW.md`'s WR-A, independently re-derived and reproduced above: the trust-boundary document's own C6 soundness-class claim ("needs a brace-or-glob character AND a `-`") is false — an entirely ordinary, non-obfuscated quoted mention of `command -p`/`env -i` in prose (e.g. a commit message) also denies, via quote-removal-then-retokenization collapsing the original word boundary, not via any obfuscation the document names. Over-triggering (fail-safe direction), not a bypass — SC5 itself is not weakened — but it is a factual inaccuracy in a required artifact, unaddressed by this gap closure. |

**Score:** 5/6 truths verified (0 present-behavior-unverified; 1 failed, non-bypass, documentation-accuracy).

## Requirements state — my ruling

`REQUIREMENTS.md` currently reads (confirmed by direct `grep` at HEAD): all eight Phase-3 rows —
`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`, `PROC-05`, `AGNT-07` — read
`Gaps Found`. **This is correct and must not change.**

I agree with `03-REQUIREMENTS-BOOKKEEPING.md` section (f)'s ruling that the seven non-`AGNT-07`
requirements are genuinely delivered and unaffected by this round's diff (confirmed independently this
session by the same diff-isolation check: the round-nine diff touches only shim/sidecar-test/docs/
planning files, never a `packages/core` or `packages/desktop` file). I decline to re-mark them
`Complete` in this pass, because section (c)'s own condition is that the re-mark happens "once the
phase as a whole clears verification," and this pass still finds one open item (Truth 6 / WR-A). All
eight rows staying `Gaps Found` is the correct bookkeeping state, not an oversight.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/shim/src/main.rs` | `raw_text_names_path_defeating_wrapper` (C6, lines 1232-1300) | Flag-adjacency (`j = i + 1`) is computed over `shell_quote_removed`'s re-tokenized output, which loses track of which tokens were originally inside one quoted shell word — the root cause of WR-A | ⚠️ Warning | Ordinary, non-obfuscated prose mentioning a recognised flag word immediately after `env`/`command` denies, contradicting the trust-boundary document's own narrower stated claim. Over-triggering, not a bypass — independently confirmed this session, not inherited from the review's narration. |
| `docs/destructive-gate-trust-boundary.md` | C6 clause's soundness-class paragraph and the widened friction-accounting paragraph | States C6's friction class as requiring "a brace-or-glob character AND a `-`" — independently confirmed false; the actual class is broader (plain prose triggers it too) | ⚠️ Warning | The document's own stated discipline (accurate, narrow soundness claims) is not met for this specific clause. Same finding as the FAILED truth above; listed here for anti-pattern completeness. |
| `packages/shim/src/main.rs` | `resolve_segment_program_index` (main.rs:725-813), `text_can_shadow_path_resolution`'s `env`/`command` walk, `raw_text_names_path_defeating_wrapper` | The `env`/`command` wrapper flag-walk logic is independently hand-duplicated across three functions, kept in sync only by doc-comment cross-references (`03-REVIEW.md` WR-B, independently confirmed by direct code read of all three call sites) | ℹ️ Info | Maintainability risk, not a functional defect — this round's own fix (the fail-closed indeterminate-token extension) already had to be hand-applied to two of the three copies. No test failure or behavioral gap results from this today. |

No `TBD`/`FIXME`/`XXX` debt markers found in any file this round's plans (03-35, 03-36) touched or in
the files this round's review examined (confirmed by direct grep, this session).

## Behavioral Spot-Checks

All commands run directly against the compiled `target/debug/flywheel-shim` binary and the compiled
`packages/sidecar/dist/pretooluse-hook.js` at HEAD, using only `--classify-invocation` (pure
classification) or a harmless `echo`/marker payload where a real-shell/real-hook decision needed
confirming — never a destructive command against a real remote or worktree (D-63).

| Behavior | Command | Result | Status |
|---|---|---|---|
| Round eight CR-01 closed: brace-obfuscated `{env,} -S` | `--classify-invocation '{env,} -S "-P /tmp git push --force"'` | `textCanShadowPathResolution:true` | ✓ PASS (was FAIL in round eight) |
| Round eight: nested `sh -c` form closed | own harness | `textCanShadowPathResolution:true` | ✓ PASS |
| Round eight: `{command,} -p` closed | `--classify-invocation '{command,} -p git push --force'` | `true` | ✓ PASS |
| Round eight: path-qualified `/usr/bin/env -S` closed | `--classify-invocation '/usr/bin/env -S "-P /tmp git push --force"'` | `true` | ✓ PASS |
| Round eight: path-qualified `/usr/bin/command -p` closed | `--classify-invocation '/usr/bin/command -p git push --force'` | `true` | ✓ PASS |
| Round eight: indeterminate flag/NAME positions closed | `env {-S,} ...`, `command {-p,} ...`, `env -u {PATH,} ...` | all `true` | ✓ PASS |
| Falsifiability: `command -v git`, `env {git,} push --force`, `sh -c 'env -S "echo hello"'`, `git status`, `env -u FOO ...` still defer/route correctly | own harness | all correct | ✓ PASS |
| Real compiled hook, brace-obfuscated form, proven environment (from-scratch harness) | `PATH=$SHIMDIR:$PATH node pretooluse-hook.js` | `deny`, exit 2 | ✓ PASS (was `{}`/exit 0) |
| Real compiled hook, nested form, proven environment | same harness | `deny`, exit 2 | ✓ PASS |
| Real compiled hook, ordinary `git status`, proven environment | same harness | `{}`, exit 0 | ✓ PASS (correctly defers) |
| Mechanical sweep generates the CR-01 payload; `KNOWN_OPEN_BOUNDARY_FAILURES` still empty | direct source read | confirmed | ✓ PASS |
| `cargo test -p flywheel-shim --test classify_invocation` | full run | 20/20 pass | ✓ PASS |
| `npm --prefix packages/sidecar test` | full run | 96/96 pass, `# fail 0`, no `SKIPPED` | ✓ PASS |
| `cargo test --workspace` | full run (once this session) | zero failures across every crate | ✓ PASS |
| WR-A: ordinary prose mention of `command -p` denies (new gap) | `--classify-invocation 'git commit -m "the command -p form"'` | `textCanShadowPathResolution:true` | ✗ FAIL (contradicts the document's own narrower claim) |
| WR-A control: `fix the command parser` still defers | same | `false` | ✓ PASS (confirms the defect is adjacency-specific, not bare-presence) |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | Worktree never destroyed without checking for uncommitted changes | ✓ SATISFIED | Unchanged this round; genuinely delivered. `REQUIREMENTS.md` reads `Gaps Found` — correct bookkeeping consequence of sharing a phase with `AGNT-07`. |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git ops retry with backoff/jitter on index-lock contention | ✓ SATISFIED | Same as above; `cargo test --workspace` (full re-run, zero failures) includes the retry/exhaustion test suite. |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing desynchronised to avoid index collisions | ✓ SATISFIED | Same as above. |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | Launch reconciles worktrees in DB against disk, surfaces discrepancy | ✓ SATISFIED | Same as above. |
| PROC-03 | 03-02, 03-15 | Agent processes managed as process groups | ✓ SATISFIED | Same as above. |
| PROC-04 | 03-02, 03-10, 03-15, 03-17, 03-20, 03-21 | No agent process survives application quit | ✓ SATISFIED | Same as above; sidecar watchdog/heartbeat tests re-confirmed passing. |
| PROC-05 | 03-06, 03-10, 03-11, 03-17, 03-23 | Orphaned processes/runs detected and surfaced on launch | ✓ SATISFIED | Same as above. |
| AGNT-07 | 03-07, 03-12, 03-14, 03-16, 03-19..03-36 | Destructive actions always require explicit confirmation, even in auto-accept mode | ✗ BLOCKED | Round eight's live bypass (CR-01) is CLOSED, independently reproduced above — this is the first round with no live bypass found. One documentation-accuracy gap remains (WR-A, over-triggering, not a bypass) — see Truth 6. `REQUIREMENTS.md` reads `Gaps Found`, which is CORRECT and must NOT change. No orphaned requirement IDs: the phase's declared set exactly matches `REQUIREMENTS.md`'s Phase 3 mapping (confirmed by cross-referencing every plan's `requirements:` frontmatter field). |

## Human Verification Required

None. Every truth in this report was settled by direct source read, direct binary invocation, a
from-scratch real-hook harness I built and drove myself, or full independent test-suite re-runs — no
item required manual UI/UX judgment or an unrunnable check.

## Gaps Summary

Round eight's live, zero-human-confirmation bypass class (brace-expansion, path-qualification, and
indeterminate flag/NAME obfuscation of the `env`/`command` wrapper tokens) is CLOSED. This is
independently confirmed three separate ways — the classifier, a real compiled hook driven through a
harness I built from scratch (not narrated from any SUMMARY), and the mechanical brace-expansion sweep
now generating the exact bypass payload with zero carried exceptions — and is the first round of this
phase's nine verification passes to find no live bypass, corroborated by a fresh, independently-run
code review that actively searched for one and found none either.

One gap remains, found by this round's own code review (WR-A) and independently re-derived and
reproduced by me from a clean code read rather than trusted from the review's narration: the
trust-boundary document's own soundness claim for C6's friction class is false. An ordinary,
non-obfuscated commit message mentioning `command -p`/`env -i` in prose denies today, via
`shell_quote_removed`'s context-free quote stripping collapsing the original word boundary before
re-tokenization — not via any brace/glob obfuscation the document names as the trigger. This is an
over-triggering (fail-safe direction) defect, not a bypass, so Success Criterion 5's core behavioral
claim holds; but it is a concrete, reproducible falsification of a written claim in a required
security artifact, and it recurs the exact "friction understated" failure mode round eight's own
fourth `missing:` item addressed, in a new instance this round's own fix introduced. Two fixes are
available and neither requires re-opening C6's actual matching logic for the shapes already closed:
narrow the flag-adjacency check to operate within a token's original quoted span, or (if the
over-trigger is accepted as a deliberate trade) correct the document's claim and price the broader
class with a representative `ORDINARY_USAGE_CORPUS` row. A secondary, non-blocking maintainability
finding (WR-B: the `env`/`command` flag-walk is hand-duplicated across three functions) is recorded as
an INFO-level anti-pattern.

---

_Verified: 2026-09-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
