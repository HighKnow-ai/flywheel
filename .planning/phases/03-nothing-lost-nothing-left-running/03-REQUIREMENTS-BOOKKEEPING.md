# Phase 3 requirements bookkeeping — the record, not the flip

This file exists because `03-VERIFICATION.md`'s ruling on the seven sibling requirement IDs
(`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`, `PROC-05`) is bookkeeping that
belongs to a LATER step than this gap-closure plan (03-34) — "once the phase as a whole clears
verification," which has not happened while this plan runs. This plan (03-34) writes the record
only. It does not edit `.planning/REQUIREMENTS.md`, does not run `requirements.mark-complete`, and
changes no requirement status.

## (a) The ruling, stated as the verifier stated it

`03-VERIFICATION.md`'s "Requirements state — my ruling" section considers `WORK-03`, `WORK-04`,
`WORK-05`, `WORK-06`, `PROC-03`, `PROC-04` and `PROC-05` **genuinely delivered**, not merely
"blocked by the phase-level verdict." Their implementations live in files plans 03-29 through
03-31 never touched (confirmed there by `git diff --stat` against the pre-03-29 commit: only
`docs/destructive-gate-trust-boundary.md`, `packages/shim/src/main.rs`,
`packages/sidecar/src/pretooluse-hook.ts`, `packages/sidecar/test/destructive-gate.test.mjs`, plus
planning/tracking files, changed) — and this gap-closure sequence (03-32 through 03-34) touches
the same narrow file set, never anything the seven requirements' own implementations live in.
`cargo test --workspace`, `npm --prefix packages/sidecar test` and `npm --prefix packages/desktop
test` all pass. Their non-`Complete` status in `.planning/REQUIREMENTS.md` is a bookkeeping
consequence of sharing a phase with `AGNT-07`, not a finding against their own work.

## (b) The seven IDs, their source plans, and what each covers

| Requirement | Source Plans | Description |
|---|---|---|
| WORK-03 | 03-01, 03-05, 03-18 | A worktree is never destroyed without first checking for uncommitted changes; if any exist, destruction is refused and surfaced to the user |
| WORK-04 | 03-04, 03-08, 03-13, 03-14 | Concurrent git operations against the same repository retry with exponential backoff and jitter on index-lock contention rather than failing the task |
| WORK-05 | 03-04, 03-08, 03-14 | Agent spawn timing is desynchronised so that parallel starts do not collide on the same repository index |
| WORK-06 | 03-03, 03-09, 03-11, 03-18 | On launch, the application reconciles worktrees recorded in the database against those actually present on disk and surfaces any discrepancy to the user rather than silently repairing it |
| PROC-03 | 03-02, 03-15 | Agent processes are managed as process groups so that termination reliably kills the whole tree, not just the parent |
| PROC-04 | 03-02, 03-10, 03-15, 03-17, 03-20, 03-21 | No agent process survives application quit; a worker self-terminates if its supervisor disappears |
| PROC-05 | 03-06, 03-10, 03-11, 03-17, 03-23 | On launch, orphaned agent processes and in-flight runs from a previous session are detected and surfaced to the user for a decision rather than silently resumed |

## (c) Instruction for whoever picks the phase back up

Re-mark these seven `Complete` in `.planning/REQUIREMENTS.md` **once the phase as a whole clears
verification** — WITHOUT re-verifying their underlying implementation. The ruling above is already
the verification; re-running it would be redundant, not more rigorous. Do this only after the
phase's own verification (a fresh `03-VERIFICATION.md` pass covering plan 03-34's gap closure)
reports the phase clear.

## (d) The caution — read this before touching `.planning/REQUIREMENTS.md`

`requirements.mark-complete` has **no shared-ID gate** and has wrongly flipped `AGNT-07` to
`Complete` at least once before, in plan 03-26 — a tooling defect the verifier's own report names
explicitly ("`requirements.mark-complete` has no shared-ID gate and has wrongly flipped `AGNT-07`
to `Complete` at least once before"). The re-marking this file's instruction (c) describes must be
a **line-scoped edit** of `.planning/REQUIREMENTS.md` — touching exactly the seven rows named
above, nothing else — and whoever performs it must confirm by **direct grep**, never from a verb's
own report, that `AGNT-07`'s row still reads `| AGNT-07 | Phase 3 | Gaps Found |` afterward. This
mirrors the verifier's own working method in `03-VERIFICATION.md`: "I did not trust any verb's
output for the current state — the table above is from a direct `grep` of
`.planning/REQUIREMENTS.md` at HEAD."

## (e) `AGNT-07`'s own status rule

`AGNT-07` stays `Gaps Found` until this phase's verification clears on its own evidence — not on
this file's say-so, and not on any individual gap-closure plan's own SUMMARY claiming so. Three
gap-closure plans address the four `missing:` items `03-VERIFICATION.md` recorded against Success
Criterion 5 / `AGNT-07`:

| `missing:` item (03-VERIFICATION.md) | Covered by |
|---|---|
| A round-seven plan closing the `env -S` backslash-split/nested opaque-reparse bypass (retrying `resolve_segment_program_index`'s wrapper-token recognition against `shell_quote_removed`'s output, or deliberately over-denying) | Plan 03-32 — `raw_text_names_opaque_env_reparse` (C5), folded into the safe verdict's own D-61 AND-gate |
| A Named-residuals row (or a fix) for bash brace expansion in `docs/destructive-gate-trust-boundary.md`, before any new `LAUNCHER_CORPUS` row addresses it | Plan 03-33 (document amended first: C3's fourth mechanism, the WR-03 ruling, the `text_names_gated_program` soundness-class paragraph, the Named-residuals row) — then plan 03-34 Task 1 (the corpus rows exercising it, landing only after the document named the mechanism, enforced by `depends_on`) |
| WR-01 (03-REVIEW.md): an explicit `null` payload in the `readProvenBoolean` regression test, matching its own doc comment's enumerated cases | Plan 03-34 Task 2 (`p6`: explicit `null`, `p7`: a number — the two remaining doc-comment cases) |
| WR-02 (03-REVIEW.md): `GROUP_3_COMMANDS` derived by a stable marker rather than a fixed index range a same-length reorder could silently defeat | Plan 03-32 Task 3(a) (the `group` field added to every `LAUNCHER_CORPUS` row) |

Whether these four closures are sufficient for `AGNT-07` to leave `Gaps Found` is a determination
for the phase's own verification pass, not this file. This file records the coverage map so a
reader can check it without re-deriving it — it makes no ruling of its own on `AGNT-07`.

## No requirement status was changed by this plan

`.planning/REQUIREMENTS.md` is not in this task's diff. Every phase-3 requirement row — the seven
named above plus `AGNT-07` — reads exactly the status it read before plan 03-34 ran.

## (f) Round eight — the coverage map for this gap closure

**What round eight found, in the verifier's own framing.** `03-VERIFICATION.md` (round eight,
`gaps_found`, 4/5) found Truth 5 / `AGNT-07` staying open on its FOURTH distinct shape in as many
rounds: brace-expansion- and path-prefix-obfuscated `env`/`command` wrapper tokens. The verifier
judged this an ADJACENT mechanism rather than incomplete closure of round six/seven's own scope,
because `env` and `command` were recognised by exact token equality while `git`/`rm` and the six
`KEYWORD_TRIGGERS` were recognised by character-level, word-boundary scanning — the same
distinction round six's and round seven's own closures already drew for their own defects.

**The four `missing:` items, quoted from `03-VERIFICATION.md`, mapped to the plan and task that
covered each:**

| `missing:` item (`03-VERIFICATION.md`, quoted) | Covered by |
|---|---|
| "A fix giving env and command the same raw-text, character-level, word-boundary substring-scan companion git/rm and the six KEYWORD_TRIGGERS already have (e.g. extending raw_text_can_shadow_path_resolution's scan, or an equivalent, to include env/command), so {env,}/{command,} are caught by presence the same way {alias,} already is." | Plan 03-35 Tasks 1-3 — C6 (`raw_text_names_path_defeating_wrapper`) |
| "A Named-residuals row (or the fix itself) in docs/destructive-gate-trust-boundary.md naming the env/command wrapper-token brace-obfuscation shape specifically, distinct from the already-ruled-on gated-program-name brace case, per the document's own round-six-onward discipline: amend the document before any new corpus row addresses this shape." | Plan 03-35 Task 1(a) — the Named-residuals row naming the wrapper-token brace shape, landing before any corpus row; the ordering enforced by plan 03-36's own `depends_on` |
| "A brace-expansion split kind added to OBFUSCATION_SPLIT_KINDS (packages/sidecar/test/destructive-gate.test.mjs), swept over KEYED_WORDS (env/command already members), so the automated invariance sweep would have caught this mechanically and will catch any regression." | Plan 03-36 Task 1 — the `brace-expansion`/`wrap`-mechanism entry, `occurrenceIsCompleteShellWord`, and the `braceVariantCount` floor |
| "Either broaden the trust-boundary document's friction-accounting paragraph to name the ordinary letter-adjacent {word}/{word}text-in-a-commit-message class explicitly, or add an ORDINARY_USAGE_CORPUS row pricing it — the gap between what is priced (one xargs -I{} rm {} row) and what actually denies (any git/rm text containing an ordinary letter-adjacent brace shape) should not persist silently." | BOTH: plan 03-35 Task 3 for the document half (the widened three-class friction paragraph) AND plan 03-36 Task 2(c) for the corpus half (the four new `ORDINARY_USAGE_CORPUS` rows, including `add {foo}bar support`) |

**Two shapes this gap closure found on its own, that `03-VERIFICATION.md` did not name** — recorded
here so the next verifier does not have to rediscover them:

- **The path-qualified wrapper tokens** — `/usr/bin/env -S "-P /tmp git push --force"` and
  `/usr/bin/command -p git push --force` — both measured as deferring at HEAD with NO obfuscation
  whatsoever (`program_stem` strips a path prefix for the PROGRAM token; no site ever stripped one
  for a WRAPPER token until C6's boundary rule made `/` a boundary character). Closed by plan 03-35
  Task 1 (C6's word-boundary containment, which recognises the token regardless of a leading path
  prefix) and covered by a named Rust test
  (`round_eight_path_qualified_env_wrapper_is_recognised`,
  `round_eight_path_qualified_command_wrapper_is_recognised`,
  `packages/shim/tests/classify_invocation.rs`) — this is a named-test closure, not a mechanical
  sweep closure, since the mechanical sweep only wraps a word in braces, never strips a path
  prefix.
- **The indeterminate flag/NAME positions** — a brace-wrapped `-S` (`env`), a brace-wrapped `-p`
  (`command`), and a brace-wrapped `--unset` NAME argument (`env -u {PATH,}`). Closed by plan 03-35
  Task 3 (the fail-closed extension inside C6, plus the narrow `resolve_segment_program_index`
  widening for the `--unset` NAME position) and covered by a named Rust test
  (`c6_indeterminate_flag_position_fails_closed`, `packages/shim/tests/classify_invocation.rs`).
  The `env -u {PATH,} git push --force` shape is ALSO covered by the mechanical sweep (plan 03-36
  Task 1) — it is the one brace variant the sweep generates on its own, because `PATH` is already a
  `KEYED_WORDS` member — and is additionally asserted as an explicit `LAUNCHER_CORPUS` row (plan
  03-36 Task 2(a)) so the shape is checked twice, by two independent mechanisms.

**The status rule, restated because it is the thing most likely to be dropped.** All eight
Phase-3 rows in `.planning/REQUIREMENTS.md` (`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`,
`PROC-04`, `PROC-05`, `AGNT-07`) still read `Gaps Found` after plans 03-35 and 03-36 — that is the
correct bookkeeping state, not an oversight. Section (c)'s re-mark of the seven siblings remains
gated on a FRESH verification pass covering this gap closure (plans 03-35 and 03-36) reporting the
phase clear, and when it happens it must follow section (d)'s discipline exactly: a line-scoped
edit touching exactly those seven rows, never a shared-ID-blind marking verb, followed by a direct
grep confirming `AGNT-07`'s own row is unchanged.

No requirement status was changed by plan 03-35 or plan 03-36.

## (g) Round nine — the coverage map for this gap closure

**The gap, in one sentence.** The trust-boundary document's C6 friction claim was narrower than
C6's measured behaviour: an ordinary, non-obfuscated quoted argument mentioning a recognised
wrapper flag right after `env`/`command` denies too, not only an obfuscated brace/glob token
standing at a wrapper's flag position, as the document previously claimed.

**The branch decision and its rationale, in short form.** Branch (b) — accept the over-trigger,
correct the claim, price it — chosen over branch (a) (narrowing the predicate to compute adjacency
within a token's original quoted span). Branch (a) is unsound, not merely costlier: the nested
`sh -c 'env -S "..."'` shapes rounds seven and eight closed reach C6 through the exact same
quote-internal adjacency the prose false positive depends on, so a rule that silences the false
positive silences those closed bypasses too. No syntactic property distinguishes a quoted shell
payload from a quoted commit message, and enumerating outer programs to supply one is banned by
D-59. Full rationale in `docs/destructive-gate-trust-boundary.md`'s own `## Round nine` section.

**The coverage map: which plan covered which half of `03-VERIFICATION.md`'s `missing:` item.**

| Half of the gap | Covered by |
|---|---|
| The corrected document claim, C6's widened soundness-class paragraph, the branch decision and rejected alternative, and the classifier-level Rust tests bounding the corrected class from both sides | Plan 03-37 (all tasks) |
| The priced `ORDINARY_USAGE_CORPUS` rows (four deny, four defer) pricing the corrected class through the real hook, and the corrected `why` on the pre-existing brace-flag row | Plan 03-38 Task 1 |
| The prose-shape generator (`PROSE_FRICTION_SHAPES`, `PROSE_FRICTION_TEMPLATES`, `proseFrictionVariants`) that mechanically produces the class round nine found by hand | Plan 03-38 Task 2 |
| The document-to-corpus class gate (`FRICTION_CLASSES`) and the structural-gate's round-nine anchors (heading pin, raised Named-residuals floor) | Plan 03-38 Task 3 |

**The structural blind spot, and how it was closed.** `obfuscationVariants` generates every
variant from `LAUNCHER_CORPUS.map((row) => row.command)` — real invocations — so it structurally
cannot reach a prose-in-quotes shape no matter how many split kinds it gains; that is why round
nine's class was found by a human reading `main.rs`, not by the sweep. Two mechanisms close this in
response: `PROSE_FRICTION_SHAPES` (plan 03-38 Task 2) is a second, sibling generator over prose
shapes (wrapper + follower), independent of any corpus row, so the same class is now produced
mechanically; `FRICTION_CLASSES` (plan 03-38 Task 3) binds every friction class the trust-boundary
document names to a corpus row of that exact shape, so a class can no longer be claimed in the
document without a row pricing it, nor priced without a claim naming it — the absence of exactly
this binding is what let round nine's false claim land undetected.

**A note on the document's own shape, recorded so a future reader is not confused by the plan's
own wording.** `03-38-PLAN.md`'s Task 3 instructions describe anchoring two `FRICTION_CLASSES` rows
to "the corrected third bullet" and "the new fourth bullet" of the friction-accounting list. In
fact plan 03-37 corrected the THIRD bullet in place to state the general, corrected class directly
(`03-37-SUMMARY.md`: "corrected the friction accounting's third bullet ... to the measured class")
rather than adding a separate fourth bullet — consistent with this plan's own
`assumption_delta_decision`, which promotes the general wrapper-flag-adjacency class to primary and
demotes the brace/indeterminate form to a variant described inside it, not a sibling class. The
`FRICTION_CLASSES` `c6-corrected` and `plain-prose-wrapper-flag-adjacency` rows are both genuinely
present and both anchor into text that exists in the document today — `c6-corrected` into the
friction-accounting bullet's own lead-in, `plain-prose-wrapper-flag-adjacency` into a distinct
sentence inside the `## Round nine` narrative section — so the gate still asserts two independently
locatable anchors, just not two separate bullets. This is a Rule 1/3-class deviation from the
plan's literal wording, not from its intent, and is also recorded in `03-38-SUMMARY.md`'s own
Deviations section.

**Restated: §(c)'s gate and §(d)'s caution, unchanged in substance.** The seven sibling IDs
(`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`, `PROC-05`) are re-marked
`Complete` only once the phase as a whole clears verification — never by this file, never by an
individual gap-closure plan's own SUMMARY. When that re-marking happens, it must be a
**line-scoped edit** of exactly those seven rows in `.planning/REQUIREMENTS.md`, never a
shared-ID-blind marking verb, followed by a **direct grep** confirming
`| AGNT-07 | Phase 3 | Gaps Found |` is unchanged — `requirements.mark-complete` has no shared-ID
gate and has wrongly flipped `AGNT-07` before (plan 03-26).

**No requirement status was changed by this plan.** All eight Phase-3 rows in
`.planning/REQUIREMENTS.md` (`WORK-03`, `WORK-04`, `WORK-05`, `WORK-06`, `PROC-03`, `PROC-04`,
`PROC-05`, `AGNT-07`) still read `Gaps Found` after plans 03-37 and 03-38 — that is the correct
bookkeeping state, not an oversight, confirmed by direct grep of `.planning/REQUIREMENTS.md` at
HEAD as part of this plan's own verify block.
