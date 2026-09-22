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
