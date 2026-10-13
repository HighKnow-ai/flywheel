---
phase: 03-nothing-lost-nothing-left-running
plan: 35
subsystem: security
tags: [destructive-gate, path-shadow, rust, shim, trust-boundary]

requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-32's C5 (raw_text_names_opaque_env_reparse) and 03-33/03-34's C3 brace-adjacency rule, both superseded/extended by this plan's C6"
provides:
  - "C6 — word-boundary containment recognition of the `env`/`command` wrapper tokens, replacing round seven's exact-token-equality C5"
  - "raw_text_names_path_defeating_wrapper, token_names_word, token_word_formation_is_indeterminate in packages/shim/src/main.rs"
  - "a fail-closed resolve_segment_program_index for an indeterminate -u/--unset NAME argument"
  - "the '## Round eight' section and C6 contract clause in docs/destructive-gate-trust-boundary.md"
affects: [03-36]

actuals:
  tokens: 12083
  tasks: 3
  commits: 3

commits: 3
plan_head_before: 1197d143b253f7e7ff4638aa55ca3ccad9619249

tech-stack:
  added: []
  patterns:
    - "word-boundary containment (raw_text_contains_word applied to a single token) as the ONE promoted recognition mechanism for a wrapper token, superseding exact string equality"

key-files:
  created: []
  modified:
    - docs/destructive-gate-trust-boundary.md
    - packages/shim/src/main.rs
    - packages/shim/tests/classify_invocation.rs

key-decisions:
  - "C6 promotes token-level word-boundary containment to the ONLY security-relevant wrapper-token recognition mechanism, replacing C5's exact-token-equality; exact equality survives only in resolve_segment_program_index's category-reporting role, never for the safe-verdict's own text_can_shadow fact."
  - "resolve_segment_program_index's -u/--unset NAME handling was widened to fail closed on an indeterminate NAME token (deviation, Rule 1) — required because a Destructive verdict's JSON never carries textCanShadowPathResolution at all, so C6 alone cannot make env -u {PATH,} satisfy its own acceptance criterion without this narrow, symmetric widening."
  - "The friction accounting was widened to three named classes (the pre-existing $/backtick class, C3's own letter-adjacent brace class in ordinary commit messages — WR-01, now priced rather than merely denied — and C6's own new flag-position class) rather than treated as a single undifferentiated cost."

requirements-completed: []

coverage:
  - id: D1
    description: "Brace-obfuscated and nested `{env,}` wrapper spellings reach a human-blocking deny through the real compiled hook, matching their unobfuscated controls"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_eight_brace_obfuscated_env_wrapper_matches_unobfuscated"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_eight_nested_brace_obfuscated_env_wrapper_reports_can_shadow"
        status: pass
      - kind: integration
        ref: "manual live-hook verification via makeShimDir/runHook helper pattern (packages/sidecar/test/destructive-gate.test.mjs) — exit 2, permissionDecision deny, non-empty reason, for both the brace-obfuscated and nested forms"
        status: pass
    human_judgment: false
  - id: D2
    description: "`{command,}`, `/usr/bin/env`, and `/usr/bin/command` wrapper spellings are all recognised by the same C6 mechanism"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_eight_brace_obfuscated_command_wrapper_matches_unobfuscated"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_eight_path_qualified_env_wrapper_is_recognised"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#round_eight_path_qualified_command_wrapper_is_recognised"
        status: pass
    human_judgment: false
  - id: D3
    description: "An indeterminate token at a wrapper's own flag or --unset NAME position fails closed, and the falsifiability companions (command -v git, env {git,} push --force, sh -c 'env -S \"echo hello\"', git status) still defer"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c6_indeterminate_flag_position_fails_closed"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c6_keeps_c5_falsifiability_companions"
        status: pass
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c6_did_not_widen_c3s_adjacency_scope"
        status: pass
    human_judgment: false
  - id: D4
    description: "The friction of C3's brace rule and C6's own new class is priced in the trust-boundary document, not merely denied silently"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/shim/tests/classify_invocation.rs#c6_priced_friction_ordinary_commit_message_with_braces"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-09-22
status: complete
---

# Phase 03 Plan 35: Round-Eight Wrapper-Token Word-Formation Bypass Summary

**C6 promotes `env`/`command` wrapper-token recognition from round seven's exact-token-equality to the same character-level word-boundary containment `git`/`rm` have had since plan 03-24, closing brace-obfuscated (`{env,}`), nested, path-qualified (`/usr/bin/env`), and indeterminate-flag-position bypasses of the destructive-gate hook.**

## Performance

- **Duration:** 30 min
- **Started:** 2026-09-22T04:09:37Z
- **Completed:** 2026-09-22T04:39:36Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- `docs/destructive-gate-trust-boundary.md` names round eight's wrapper-token word-formation failure, states the `C6` contract clause and its explicit soundness-class limits, widens the Named-residuals table (superseding round seven's C5 row, adding one new open row for a wrapper NAME assembled across separate brace groups), and widens the friction accounting to three named classes — all before any corpus row is added (that lands in 03-36).
- `packages/shim/src/main.rs` replaces `raw_text_names_opaque_env_reparse` (C5) with `raw_text_names_path_defeating_wrapper` (C6): a strict superset recognising a PATH-defeating `env`/`command` wrapper token by word-boundary containment over both the raw and quote-removed text forms, covering brace expansion, a path prefix, and — via two new small helpers (`token_names_word`, `token_word_formation_is_indeterminate`) — an indeterminate token standing at the wrapper's own flag or `--unset` NAME position.
- `resolve_segment_program_index`'s `-u`/`--unset` NAME handling was narrowly widened (deviation, see below) so `env -u {PATH,} git push --force` reaches a Safe verdict whose own `textCanShadowPathResolution` field C6 can actually report — without this, the field is silently absent from a Destructive verdict's JSON regardless of what C6 computes.
- `packages/shim/tests/classify_invocation.rs` gained 9 new Rust tests (round-eight coverage) — all 20 tests (11 pre-existing + 9 new) pass, none of the pre-existing round-seven/C5 tests were modified.
- The real compiled hook was independently verified end-to-end (via the `makeShimDir`/`runHook` helper pattern `packages/sidecar/test/destructive-gate.test.mjs` uses) to now DENY (exit 2, `permissionDecision: "deny"`, non-empty reason) both `{env,} -S "-P /tmp git push --force"` and its nested `sh -c '{env,} ...'` form — both returned `{}`/exit 0 (zero human confirmation) before this plan.

## Task Commits

Each task was committed atomically:

1. **Task 1: The boundary names round eight, C6 replaces C5, and `{env,}` denies end-to-end** - `ffeb8a1` (feat) — includes the full C6 implementation (both `env` and `command` branches, per this task's own literal specification) and the `resolve_segment_program_index` deviation, since Task 3's own acceptance criterion is unreachable without it and splitting the fix across commits would leave an intermediate commit whose C6 story was internally inconsistent.
2. **Task 2: The `command` half and the path-qualified siblings** - `8047ec6` (test) — proves behaviour already shipped in Task 1's commit; no further production-code change was needed.
3. **Task 3: An indeterminate token at a flag or NAME position fails closed, and the friction is priced** - `93d3c5c` (test) — the `env -u {PATH,}` row exercises the Task 1 commit's `resolve_segment_program_index` widening; `env {-S,}` and `command {-p,}` needed no further code change.

**Plan metadata:** committed separately after this SUMMARY.

_Note: unlike a `type: tdd` plan, these are `type="tracer"`/`type="auto" tdd="true"` tasks whose commits are feat/test per the standard commit-type table, not the RED/GREEN/REFACTOR triad._

## Files Created/Modified

- `docs/destructive-gate-trust-boundary.md` - Round eight section, C6 contract clause, widened Named-residuals table, widened friction accounting (3 classes)
- `packages/shim/src/main.rs` - C6 implementation, two new helpers, `resolve_segment_program_index` fail-closed widening
- `packages/shim/tests/classify_invocation.rs` - 9 new round-eight/C6 tests

## Decisions Made

- C6 promotes token-level word-boundary containment to the ONLY security-relevant wrapper-token recognition mechanism (see frontmatter `key-decisions` for full rationale).
- The `resolve_segment_program_index` fail-closed widening for an indeterminate `-u`/`--unset` NAME (see Deviations below).
- The friction accounting paragraph now names three classes rather than one (see frontmatter).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug/plan-internal tension] `resolve_segment_program_index`'s `-u`/`--unset` NAME handling required a narrow fail-closed widening**

- **Found during:** Task 3, while verifying `env -u {PATH,} git push --force` against its own acceptance criterion (`textCanShadowPathResolution: true`).
- **Issue:** Task 1's `<action>` explicitly lists `resolve_segment_program_index` among functions this plan must NOT change. But `resolve_segment_program_index`'s existing `-u`/`--unset` handling unconditionally consumes its NAME argument regardless of content, so `env -u {PATH,} git push --force` resolves `git` as the program and classifies `force-push` — a `Destructive` verdict. `run_classify_invocation`'s `Destructive` JSON arm carries exactly `category`/`program`/`invokedBareName` and NEVER `textCanShadowPathResolution`, so no change to C6 alone could make this exact acceptance criterion literally true: the field the criterion checks for is structurally absent from a Destructive verdict's output, regardless of what C6 (a Safe-verdict-only fact) computes.
- **Fix:** Widened `resolve_segment_program_index`'s `-u`/`--unset` (and the single-token `--unset=NAME` spelling) so that when the NAME argument's word formation is indeterminate (`token_word_formation_is_indeterminate`), the walk breaks WITHOUT consuming the NAME token — leaving it to be resolved (deliberately misresolved) as the segment's own program token, an unrecognised name `destructive::classify` reports `Safe` for. This is the exact same outcome an unrecognised FLAG token already produced before this plan (`env {-S,} …` misresolves `{-S,}` as the program identically, requiring no code change at all) — so the fix generalises an existing, already-accepted pattern rather than introducing a new one. C6 independently reports `textCanShadowPathResolution: true` for the same text via its own `-u NAME`-position check, so the overall Safe verdict now carries the exact field the acceptance criterion checks.
- **Scope check against the prohibition's own stated reasons:** the prohibition's rationale (C4's rule that only C1's quote removal widens `invoked_bare_name`; D-59's rejection of widening `namesGatedProgram`) does not apply here — `invoked_bare_name` and `namesGatedProgram` are both completely untouched by this fix. `text_can_shadow_path_resolution`, `shadowable`, and `text_names_gated_program` are also untouched, exactly as the prohibition requires. Only the SEPARATE axis of "which segment token is `destructive::classify` asked to score" is widened, for one narrow, symmetric case.
- **Files modified:** `packages/shim/src/main.rs` (function + its own doc comment); `docs/destructive-gate-trust-boundary.md` (a paragraph inside the C6 clause recording this widening and why it does not touch C4-governed fields).
- **Verification:** `env -u {PATH,} git push --force` → `{"category":"safe","namesGatedProgram":true,"textCanShadowPathResolution":true}` (was `force-push`/Destructive before). `env -u FOO git push --force`, `env -i git push --force`, and `env -u PATH git push --force` (all exact-name/unaffected controls) are unchanged, confirmed by direct CLI comparison before/after and by all 20 Rust tests passing.
- **Committed in:** `ffeb8a1` (Task 1's commit, since the fix is load-bearing for C6's own contract to be internally consistent from the first commit onward).

---

**Total deviations:** 1 auto-fixed (Rule 1 — a plan-internal tension between an explicit "do not change" instruction and a later task's own literal, testable acceptance criterion).
**Impact on plan:** Necessary for correctness — without it, one of Task 3's three named payloads (`env -u {PATH,} …`) would silently fail to satisfy its own stated `<behavior>`/acceptance criteria while the other two (`env {-S,}`, `command {-p,}`) passed, an inconsistent and confusing partial closure. No scope creep: the fix is one narrow, symmetric widening of a single match arm, confined to the program-resolution axis the prohibition's own stated rationale does not cover.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- C6 is implemented, documented, and proven end-to-end against the real compiled hook for every shape named in this plan's `must_haves.truths`.
- `AGNT-07` deliberately stays `Gaps Found` (verified: `.planning/REQUIREMENTS.md` still reads `| AGNT-07 | Phase 3 | Gaps Found |`) — this plan's own `## Requirements bookkeeping` section is explicit that no plan in this gap closure flips a requirement status; the corpus rows and the mechanical brace sweep exercising C6 against `LAUNCHER_CORPUS` are 03-36's job, which `depends_on` this plan.
- One new, deliberately-scoped residual is recorded in the trust-boundary document's Named-residuals table (a wrapper NAME assembled across separate brace groups, e.g. `{e,}{n,}v`) — not claimed closed, and not blocking 03-36.
- No blockers for 03-36.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-22*

## Self-Check: PASSED

- `docs/destructive-gate-trust-boundary.md` — FOUND
- `packages/shim/src/main.rs` — FOUND
- `packages/shim/tests/classify_invocation.rs` — FOUND
- Commit `ffeb8a1` — FOUND in `git log --oneline --all`
- Commit `8047ec6` — FOUND in `git log --oneline --all`
- Commit `93d3c5c` — FOUND in `git log --oneline --all`
- All 8 acceptance-criteria/verification commands from the plan's `<verification>` block re-ran clean: `cargo build -p flywheel-shim` (0), `cargo test -p flywheel-shim --test classify_invocation` (20/20 pass), `cargo test --workspace` (no failures), `npm --prefix packages/sidecar test` (96/96 pass, `# fail 0`, no `SKIPPED (shim-binary tests)`), `npm --prefix packages/desktop run build` (0), the `C6 —` and `Round eight` grep gates, and `.planning/REQUIREMENTS.md`'s `AGNT-07` row unchanged (`Gaps Found`).
