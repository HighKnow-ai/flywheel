---
phase: 03-nothing-lost-nothing-left-running
verified: 2026-09-21T00:00:00Z
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
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-DESTRUCTIVE-GATE-BYPASS-CLASS.md"
  - ".planning/phases/03-nothing-lost-nothing-left-running/03-REVIEW.md"
  - "docs/destructive-gate-trust-boundary.md"
  - "packages/core/src/shim.rs"
  - "packages/core/tests/git_retry.rs"
  - "packages/shim/src/main.rs"
  - "packages/sidecar/src/pretooluse-hook.ts"
  - "packages/sidecar/test/destructive-gate.test.mjs"
  - "scripts/uat/README.md"
  - "scripts/uat/run-all.sh"
  - "scripts/uat/uat-07-launcher-shape-gate.mjs"
covered_digest: "v1:sha256:fbd75d57de58d90b4492560c0d08cc135d69839241173b107194336a617de2b1"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "The launcher-shape class recorded in 03-DESTRUCTIVE-GATE-BYPASS-CLASS.md (sh -c, bash -c, nice, nohup, timeout, xargs, sudo, setsid all classifying `safe` with no hook-level check): CLOSED as designed, not merely claimed. Plan 03-24's D-59/D-60/D-61 changes make the hook's `safe` branch call shimShadowDirectoryProven() before trusting any safe verdict; I independently reproduced all eight forms classifying `{\"category\":\"safe\",\"namesGatedProgram\":true,\"textCanShadowPathResolution\":false}` against the compiled binary, confirmed the hook's AND-gate correctly defers these to layer 2 (no shadow construct present), and confirmed by direct source read + a live D-62 item 2 measurement (uat-07-launcher-shape-gate.mjs, PASS, properties A/B/C all held) that layer 2's runtime PATH-shadow interception genuinely catches this class end to end — not merely inferred from reading shim_env_for_run."
  gaps_remaining:
    - "AGNT-07 / Success Criterion 5 stays open under a NEW bypass, independently reproduced this round (see gaps below)."
  regressions: []
gaps:
  - truth: "An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (Success Criterion 5 / AGNT-07)."
    status: failed
    reason: >
      CR-01 from 03-REVIEW.md is real and independently reproduced against the compiled
      `flywheel-shim` binary and a real `/bin/sh`, using only `--classify-invocation` (no destructive
      command executed, per D-63). The raw-text shadow scan D-61 introduced
      (`raw_text_contains_word`, consumed by `text_names_gated_program` and
      `raw_text_can_shadow_path_resolution`, `packages/shim/src/main.rs:906-972`) matches a keyword
      as a literal, contiguous substring. A real POSIX shell resolves an adjacent empty-quote pair or
      a backslash escape inside a word back into the plain word (`e""val` -> `eval`), but this scanner
      does not perform that normalization, so it sees a different, non-matching string.

      Independent reproduction (this session, direct binary invocation):
      `sh -c 'e""val "$(cat ./defs.sh)"; git push --force'` classifies
      `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}` — the control
      (unobfuscated `eval` in the same position) correctly reports `textCanShadowPathResolution:
      true`. I also confirmed, with a harmless `echo` payload only (never git), that a real shell
      genuinely resolves the obfuscated form: `sh -c 'e""val "echo RESOLVED_BY_EMPTY_QUOTES"'` prints
      `RESOLVED_BY_EMPTY_QUOTES`. I further confirmed the AND-gate's other input is independently
      defeatable the same way (`g""it push --force` at top level tokenizes correctly via
      `tokenize_shell_words` and IS classified `force-push`, but the same obfuscation applied to `git`
      INSIDE a quoted `sh -c` payload collapses `namesGatedProgram` to `false` too:
      `sh -c 'eval "$(cat ./defs.sh)"; g""it push --force'` ->
      `{"namesGatedProgram":false,"textCanShadowPathResolution":true}`).

      `pretooluse-hook.ts`'s safe branch (`packages/sidecar/src/pretooluse-hook.ts:263-286`) denies
      only when `textCanShadow && namesGatedProgram` are BOTH true (read verbatim from source). A
      false on either conjunct — trivially reachable via ordinary quote-splitting of either the
      shadow keyword or the gated-program name — makes the AND false, so the hook prints `{}` (defers)
      unconditionally. Because the shadow construct (the hidden `eval`) executes and redefines `git`
      as a shell function BEFORE any `PATH` search ever runs in the same shell, layer 2
      (`packages/shim/src/main.rs`'s `argv[0]`/`execvp` dispatch) never sees this invocation either —
      unlike the eight plain launcher forms (`sh -c "git push --force"` etc.) that this round's D-59
      fix correctly defers to layer 2's runtime interception because those forms perform a genuine
      `PATH` search. CR-01's shape performs no such search at all. Zero human confirmation is reached
      at any layer for this shape, which is exactly the wording AGNT-07 is written on ("always require
      explicit confirmation").

      This is judged, independently of the reviewer, to be genuinely outside the residual
      `docs/destructive-gate-trust-boundary.md` already names for Layer 1's text scan ("A shadow
      construct reached through an indirection the raw-text scan cannot see — for example, a shell
      function definition sourced from a file whose own name carries no shadow keyword"). That
      residual is specifically about content the scanner cannot access at all (a definition living in
      a file the text only names). CR-01 needs no external file — the keyword is present in the exact
      text the scanner was handed, merely reassembled by ordinary shell word-formation the scanner
      never performs. Per the document's own "rule for round five" (lines 156-165): this is a
      BOUNDARY failure, not a missing corpus row. The layer whose claim is wrong: Layer 1
      (`pretooluse-hook.ts`, via the shim's `--classify-invocation` text facts) is documented as
      "Trusted to prove... whether the raw command text can pre-empt PATH resolution before it
      happens" (trust-boundary doc, lines 45-55) — demonstrably false as written; the scanner cannot
      prove this for any text containing ordinary shell quote/backslash splitting of the keyword.
      `docs/destructive-gate-trust-boundary.md` must be corrected (its Layer 1 "Trusted to prove"
      claim amended, and this shape added to "Named residuals" only if a decision is made to accept
      it as a residual rather than fix it) before any new `LAUNCHER_CORPUS` row is added, per the
      document's own stated discipline — appending a row first is the exact failure mode the document
      says produced rounds one through four.
    artifacts:
      - path: "packages/shim/src/main.rs"
        issue: "raw_text_contains_word (lines 906-932), consumed by text_names_gated_program and raw_text_can_shadow_path_resolution, does no shell-quote/backslash normalization before matching — an adjacent empty-quote pair or backslash inside a keyword defeats the match while a real shell resolves it to the plain word."
      - path: "packages/sidecar/src/pretooluse-hook.ts"
        issue: "Lines 276-282: the safe-branch deny rule is `textCanShadow && namesGatedProgram`; a false on either conjunct (independently reachable via quote-splitting of either input) makes the whole expression false and the hook defers unconditionally, with no fallback proof and no reliance on layer 2 (which cannot see this shape either, because the shadow function resolves before any PATH search)."
      - path: "docs/destructive-gate-trust-boundary.md"
        issue: "Layer 1's 'Trusted to prove' claim (lines 45-55) states this layer proves whether raw command text can pre-empt PATH resolution; CR-01 is a reproduced counterexample where it does not. The document has not yet been corrected to reflect this, and per its own stated rule for round five, correction must precede any new corpus row."
    missing:
      - "A shell-word-normalization pass (or, per the review's suggested interim mitigation, a deliberately over-triggering scan on any quote/backslash adjacent to letters that could spell a gated keyword) applied to the raw text before raw_text_contains_word runs, mirroring the quote-concatenation handling tokenize_shell_words already performs for the top-level non-opaque case."
      - "LAUNCHER_CORPUS rows exercising both the \"\"-split and \\-split forms of the shadow keyword AND of the gated-program name, each asserting expect: deny, added only after the boundary document is corrected (per the document's own stated sequencing)."
      - "docs/destructive-gate-trust-boundary.md's Layer 1 'Trusted to prove' claim corrected to state what the raw-text scan actually proves today, plus a decision on whether CR-01's shape becomes a fixed case or a newly named residual."
      - "A decision on the two secondary findings from 03-REVIEW.md (WR-01, WR-02) — see Anti-Patterns Found below — at minimum WR-02's missing adversarial-obfuscation corpus coverage, which is the same test-coverage gap that let four prior rounds and this one ship undetected by the enumeration itself."
---

# Phase 3: Nothing Lost, Nothing Left Running — Verification Report (Re-Verification)

**Phase Goal:** "Cyril can quit, crash or interrupt Flywheel at any moment and know that no
uncommitted work was destroyed and no agent is still spending his money."
**Verified:** 2026-09-21T00:00:00Z
**Status:** gaps_found
**Re-verification:** Yes — this report supersedes the 2026-09-20T12:09:41Z report (`gaps_found`,
4/5), which was itself a re-verification. That report's single recorded gap (the launcher-shape
class — `sh -c`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid` all classifying
`safe` with no hook-level check at all) is CLOSED by plans 03-24..03-28's D-59..D-63 changes, and I
independently confirmed the closure rather than trusting the SUMMARYs. But `03-REVIEW.md`'s CR-01
finding — surfaced independently by the code review that ran immediately before this verification —
is a NEW, different bypass in the same raw-text scan D-61 introduced to close the prior gap, and I
independently reproduced it end to end against the compiled binary and a real shell using only
`--classify-invocation` (never executing a destructive command, per D-63). AGNT-07 / Success
Criterion 5 therefore remains open, on a different and narrower shape than before.

**On the two questions the orchestrator asked me to weigh independently (not inherited from the
reviewer or the orchestrator):**

1. **Is CR-01 genuinely outside the residual `docs/destructive-gate-trust-boundary.md` already
   names?** Yes. The document's second named residual is specifically about an indirection the raw
   scan cannot follow — content living in a *file the text only names* (`source ./somefile.sh`
   whose own contents the scanner never reads). CR-01 needs no external file: the keyword `eval` (or
   `git`) is present in the exact string the scanner receives, merely split by an empty quote pair or
   backslash that a real shell reassembles and the scanner does not. This is a different mechanism —
   a false negative in the scanner's own matching discipline on text it already has, not a blind spot
   about text it never sees.
2. **Per the document's own rule for round five, is this a boundary failure, and which layer's claim
   is wrong?** Yes, a boundary failure. Layer 1 (`pretooluse-hook.ts`, via the shim's
   `--classify-invocation` text facts) is documented as "Trusted to prove... whether the raw command
   text can pre-empt PATH resolution before it happens." CR-01 is a reproduced, concrete counterexample
   where it does not: the reported `textCanShadowPathResolution: false` is wrong for a string that,
   when handed to a real shell, does pre-empt PATH resolution. That "Trusted to prove" claim is false
   as written and needs correction before a new corpus row is added — appending a row first is exactly
   the failure mode the document itself names as having produced rounds one through four.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone. | ✓ VERIFIED | Unchanged by this round's diff (plans 03-24..03-28 touch only `packages/shim/src/main.rs`, `packages/sidecar/src/pretooluse-hook.ts`, `packages/core/src/shim.rs`, `packages/sidecar/test/destructive-gate.test.mjs`, `docs/destructive-gate-trust-boundary.md`, `scripts/uat/*`). Regression-only check per re-verification mode: no file on this truth's path (WORK-03) was modified. Previously verified via `03-UAT.md` test 1. |
| 2 | User quits the application while a session is running and no agent process survives. | ✓ VERIFIED | Unchanged by this round's diff. No file on the PROC-03/PROC-04 path (`watchdog.ts`, supervisor kill logic) was modified by plans 03-24..03-28. Previously verified via `03-UAT.md` test 1. |
| 3 | User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database. | ✓ VERIFIED | Unchanged by this round's diff. No file on the PROC-05/WORK-06 path was modified by plans 03-24..03-28. Previously verified via `03-UAT.md` test 2. |
| 4 | A stress run driving ten concurrent commits into one repository keeps every commit — retry and spawn-stagger. | ✓ VERIFIED | Unchanged by this round's diff. `git_retry.rs`'s lock-retry logic and `shim.rs`'s `shim_env_for_run` structure were touched by plan 03-25 only for the NEW post-install verification checks (additive, does not alter retry/stagger paths). Previously verified via `03-UAT.md` test 5. |
| 5 | An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete (compound truth this SC and AGNT-07 share). | ✗ FAILED | **The specific bypass this round's plans (03-24..03-28) targeted — the eight-launcher-shape class with zero hook-level check — is CLOSED, independently confirmed (see gaps_closed).** But a NEW bypass in the very mechanism built to close it (D-61's raw-text scan) is real and independently reproduced this session: `sh -c 'e""val "$(cat ./defs.sh)"; git push --force'` classifies `safe` with `textCanShadowPathResolution: false` (control with unobfuscated `eval` correctly reports `true`); a real shell resolves the obfuscated form to the exact same word. Zero human confirmation is reached at any layer for this shape. See Gaps below for the full independently-reproduced trace. |

**Score:** 4/5 truths verified (0 present-behavior-unverified; 1 failed, blocking).

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/shim/src/main.rs` | 906-972 | `raw_text_contains_word` performs no shell-quote/backslash normalization before literal substring matching | 🛑 Blocker | CR-01: defeats the D-61 raw-text shadow scan via ordinary quote-splitting; independently reproduced (see Gaps). |
| `packages/sidecar/src/pretooluse-hook.ts` | 276-282 | The safe branch's "missing field → unsafe" per-field discipline is ANDed, collapsing the whole expression to `false` (defer) if either field is unprovable/false | ⚠️ Warning | WR-01 from `03-REVIEW.md`: latent fail-open composition bug. Not currently reachable — every `ClassifiedInvocation` return path in the shipped binary sets both fields together as real booleans, so this cannot fire against the current binary. Recorded for visibility; does not block this verification's status determination on its own (CR-01 already blocks), but should be fixed alongside CR-01 since the fix touches the same code. |
| `packages/sidecar/test/destructive-gate.test.mjs` | 943-1153 (`LAUNCHER_CORPUS`) | No corpus row exercises keyword obfuscation via quote-splitting or backslash-escaping inside a quoted payload | ⚠️ Warning | WR-02 from `03-REVIEW.md`: the same test-coverage gap that let four prior rounds and this one ship without the enumeration catching itself. Independently confirmed by grep — no `e""val`, `e\val`, `g""it`, or `g\it` style row exists anywhere in the corpus. |
| `docs/destructive-gate-trust-boundary.md` | 45-55 | Layer 1's "Trusted to prove" claim is now factually false, per the document's own rule for round five | 🛑 Blocker (same gap as CR-01, different artifact) | The document has not yet been corrected to reflect CR-01's counterexample. Per its own stated discipline, correction must happen before a new corpus row is added. |

No `TBD`/`FIXME`/`XXX` debt markers were found in any file this phase's plans 03-24..03-28 touched.

## Behavioral Spot-Checks

All commands below were run directly against the compiled `target/debug/flywheel-shim` binary using
only `--classify-invocation` (pure classification, never executes anything, per D-63). Where shell
resolution needed confirming, only a harmless `echo` payload was used — no destructive git command
was executed against any remote or worktree at any point during this verification.

| Behavior | Command | Result | Status |
|---|---|---|---|
| Control: unobfuscated `eval` inside `sh -c` is correctly caught | `flywheel-shim --classify-invocation "sh -c 'eval \"\$(cat ./defs.sh)\"; git push --force'"` | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}` | ✓ PASS (correctly denies via hook AND) |
| CR-01: empty-quote-split `eval` defeats the scan | `flywheel-shim --classify-invocation "sh -c 'e\"\"val \"\$(cat ./defs.sh)\"; git push --force'"` | `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}` | ✗ FAIL (hook AND is false, defers — bypass confirmed) |
| CR-01 variant: quote-split `git` also defeats `namesGatedProgram` | `flywheel-shim --classify-invocation "sh -c 'eval \"\$(cat ./defs.sh)\"; g\"\"it push --force'"` | `{"category":"safe","namesGatedProgram":false,"textCanShadowPathResolution":true}` | ✗ FAIL (AND is false, defers — confirms the AND-gate is defeatable via either conjunct) |
| Shell genuinely resolves the obfuscated form (harmless payload only) | `sh -c 'e""val "echo RESOLVED_BY_EMPTY_QUOTES"'` | `RESOLVED_BY_EMPTY_QUOTES` | ✓ PASS (confirms the obfuscation is not a scanner-only artifact — a real shell really does resolve it) |
| Launcher-shape class (this round's target) still correctly defers to layer 2, unobfuscated | `flywheel-shim --classify-invocation "sh -c \"git push --force\""` (and the same for `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid`) | All eight: `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":false}` | ✓ PASS (as designed — no shadow construct present, so layer 2's real PATH search still catches these; confirmed also by the live D-62 item 2 UAT, `uat-07-launcher-shape-gate.mjs`, PASS) |
| Existing adversarial corpus is fully green (does not contradict CR-01 — it has no row that would catch it) | `node --test packages/sidecar/test/destructive-gate.test.mjs` (single file, run once) | 27/27 subtests `ok`, 0 `not ok` | ✓ PASS (confirms WR-02: green suite, real bypass — the enumeration does not catch itself, exactly as the review and the bypass-class document both predict) |

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | Worktree never destroyed without checking for uncommitted changes | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git ops retry with backoff/jitter on index-lock contention | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing desynchronised to avoid index collisions | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | Launch reconciles worktrees in DB against disk, surfaces discrepancy | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| PROC-03 | 03-02, 03-15 | Agent processes managed as process groups | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| PROC-04 | 03-02, 03-10, 03-15, 03-17, 03-20, 03-21 | No agent process survives application quit | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| PROC-05 | 03-06, 03-10, 03-11, 03-17, 03-23 | Orphaned processes/runs detected and surfaced on launch | ✓ SATISFIED | Unchanged this round; `REQUIREMENTS.md` correctly marks `Complete`. |
| AGNT-07 | 03-07, 03-12, 03-14, 03-16, 03-19, 03-20, 03-21, 03-22, 03-23, 03-24, 03-25, 03-26, 03-27, 03-28 | Destructive actions always require explicit confirmation, even in auto-accept mode | ✗ BLOCKED | CR-01, independently reproduced this session (see Gaps). `REQUIREMENTS.md` line 272 currently reads `Gaps Found`, which is CORRECT and must NOT be changed to `Complete` by this verification. No orphaned requirement IDs found — the phase's declared set (`WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05, AGNT-07`) exactly matches every ID any plan in this phase claims, and every ID `REQUIREMENTS.md` maps to Phase 3. |

**Caution recorded per the orchestrator's own note:** `requirements.mark-complete` has no shared-ID
gate and wrongly flipped AGNT-07 to `Complete` once already during this closure (plan 03-26, caught
and reverted). I did not trust that verb's output — the status above is from a direct `grep` of
`.planning/REQUIREMENTS.md` at HEAD, reproduced in this report's tool output.

## Human Verification Required

None. Every truth in this report was settled by direct source read, direct binary invocation, or a
single targeted test-file run — no item required manual UI/UX judgment or an unrunnable check.

---

_Verified: 2026-09-21T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
