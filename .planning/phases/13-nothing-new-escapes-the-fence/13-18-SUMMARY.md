---
phase: 13-nothing-new-escapes-the-fence
plan: 18
subsystem: docs
tags: [documentation, claude-md, amendments, gap-closure, wr-11]

requires:
  - phase: 13-04
    provides: the "not installed" row wording this plan copies
  - phase: 13-11
    provides: RunKind::classify and the RUN_KIND_*_PREDICATE mirrors that A-07 records
  - phase: 13-14
    provides: the identifier-component gate that A-06 records
provides:
  - CLAUDE.md Technology Stack rows 50, 53, 56 that match the tree
  - amendments A-06 and A-07 in PROJECT.md Key Decisions (trail A-01..A-07, no gap)
  - ROADMAP.md F6 row and DRFT-09 placement note stating what shipped
affects: [phase-14-planning, every-agent-session]

status: complete
plan_head_before: 77be710a857f1363c9954370c091426831583966
actuals:
  tokens: 1800
  tasks: 2
  commits: 2

key-files:
  created: []
  modified:
    - CLAUDE.md
    - .planning/PROJECT.md
    - .planning/ROADMAP.md

key-decisions:
  - "A-06 records the FNC-04 gate widening and states the .sql scan question as still open."
  - "A-07 records (owner decision, 2026-10-15) that agent_runs.kind is not added; RunKind::classify is the one definition."

requirements-completed: [DRFT-09, FNC-04]

coverage:
  - id: D1
    description: "CLAUDE.md rows 50, 53, 56 no longer state anything the tree contradicts; each claim has a recorded grep"
    requirement: FNC-04
    verification:
      - kind: command
        ref: "grep -c 'Agent SDK supports' CLAUDE.md (0); grep -rIn 'tokio::process' packages/core/src packages/desktop/src-tauri/src (no output)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A-06 and A-07 are recorded in A-05's shape; the F6 row describes what shipped"
    requirement: DRFT-09
    verification:
      - kind: command
        ref: "grep -c 'A-0[1-7]' .planning/PROJECT.md (7); grep -c 'replaces it' .planning/ROADMAP.md (0)"
        status: pass
    human_judgment: false
---

# Phase 13 Plan 18: Documentation Reconciliation Summary

**Three false `CLAUDE.md` Technology Stack rows corrected, amendments A-06 (identifier-component PM gate) and A-07 (no `agent_runs.kind` column) recorded, and the roadmap F6 wording changed to what shipped.**

Duration: about 10 min. Completed 2026-10-15. 2 tasks, 3 files, no code touched.

## Accomplishments

- `CLAUDE.md` rows 50, 53 and 56 now match the tree, in the same "**not installed** / what is real" voice plan 13-04 used.
- `PROJECT.md` Key Decisions carries A-06 and A-07 directly after A-05, same row shape. A-06 says `.sql` is still unscanned and the question is open.
- `ROADMAP.md` F6 no longer says the column "replaces" the inference.

## The three corrected `CLAUDE.md` rows (verbatim)

Row 50:
`| Sidecar runtime | Node.js LTS, bundled as `flywheel-node` | 22.x — pinned by `NODE_VERSION` in `packages/sidecar/scripts/stage-runtime.mjs` | `pkg` and `nexe` are **not installed** and not used. The three `externalBin` entries in `tauri.conf.json` (`flywheel-sidecar`, `flywheel-node`, `flywheel-shim`) are staged by `packages/sidecar/scripts/stage-runtime.mjs`. The Node version is constrained by Tauri and the sidecar's own code, not by an Agent SDK (see the Agent backend row: the SDK is not a dependency). |`

Row 53:
`| Git — worktree lifecycle | System `git` CLI driven through `packages/core/src/git.rs` and `proc::output_with_timeout` (`std::process`, a deadline-watched child) — `tokio::process` is not the mechanism | git ≥ 2.44 | create / remove / list / prune, branch topology, merges. Never `git2` for these. |`

Row 56:
`| PTY | `node-pty` — **not installed**; `packages/sidecar/package.json` has one runtime dependency, `@modelcontextprotocol/sdk` | n/a | Adopt only if headless `stream-json` mode proves insufficient, and then inside the sidecar. Never terminate a PTY in Rust and relay bytes to Node. |`

## Verifying greps, run on the tree after plans 13-12..13-17 landed

| Claim | Command | Observed |
|---|---|---|
| Row 50 externalBin entries | `grep -n externalBin -A6 packages/desktop/src-tauri/tauri.conf.json` | `binaries/flywheel-sidecar`, `flywheel-node`, `flywheel-shim` |
| Row 50 packaging script and pin | `grep -n NODE_VERSION packages/sidecar/scripts/stage-runtime.mjs` | `const NODE_VERSION = "22.23.3";` |
| Row 50 no pkg/nexe in use | `grep -n 'pkg\|nexe' CLAUDE.md` | one line (row 50), polarity is "not installed" |
| Row 50 SDK clause gone | `grep -c 'Agent SDK supports' CLAUDE.md` | 0 |
| Row 53 no tokio::process | `grep -rIn 'tokio::process' packages/core/src packages/desktop/src-tauri/src` | no output (exit 1) |
| Row 53 real mechanism | `grep -n 'std::process' packages/core/src/proc.rs packages/core/src/git.rs` | `proc.rs:14`, `git.rs:20`; `output_with_timeout` defined in `proc.rs` |
| Row 53 binding rule | ``grep -c 'Never `git2`' CLAUDE.md`` | 1 |
| Row 56 one runtime dep, no node-pty | `node -e` over `packages/sidecar/package.json` | `["@modelcontextprotocol/sdk"]`, exit 0 |
| Acceptance counts | `grep -c` for `stage-runtime`, `flywheel-sidecar`, `output_with_timeout` | 1, 1, 1 |
| No column exists | `grep -rIn 'agent_runs\.kind' packages/core/src`; `grep -rIn 'ADD COLUMN kind' packages/core/src/db/migrations` | no output on both |
| Diff confined | `git diff -U0 CLAUDE.md` | three hunks, at lines 50, 53, 56 |

## A-06 and A-07 (verbatim)

A-06: `| **A-06** A-02 extended: criterion 3's forbidden-word gate matches a corpus word used as an identifier COMPONENT (prefix at an identifier boundary), not only as a standalone whole word, so `sprint_id`, `overdueCount`, `velocity_per_week` and `story_points_total` fail the build | A-02 bought whole-word matching so `Vec::with_capacity` would not fail the build, and that exclusion is unchanged; it did not license compound identifiers, and criterion 3's own wording is "a build containing `story_point` … fails", which the plural satisfies. Phase 14 adds schema, which is where the blind spot bites. Still open, not settled by this row: `.sql` files remain unscanned (deferred by `13-CONTEXT.md`; `SCANNED_EXTENSIONS` in `pm_vocabulary_gate.rs` makes reversal a one-token edit), and the counter-argument stands — a Phase 14 `cycles` table with a `sprint_length_days` column passes the spine pin, table classification and the PM gate today (Phase 13 FNC-04, plan 13-14) | ✓ Recorded (Phase 13) |`

A-07: `| **A-07** F6 amended (owner decision, 2026-10-15): the `agent_runs.kind` column is NOT added; run kind has one definition in code, `RunKind::classify`, with `RUN_KIND_*_PREDICATE` mirroring it in SQL | That satisfies F6's intent ("run kind is inferred from column shape in four places" becomes one definition) without a schema change. A column means another `tasks`/`agent_runs` rebuild on a spine this phase pinned, for a value already derivable from the row; DRFT-09's own text concerns not throttling and refusal wording and names no column, so it is met on its text. The column stays available at the cost of one migration if a query ever needs to filter on kind without the predicate (Phase 13 DRFT-09, plan 13-11) | ✓ Recorded (Phase 13) |`

The A-06 clause that keeps the `.sql` question open: "Still open, not settled by this row: `.sql` files remain unscanned (deferred by `13-CONTEXT.md` ...)".

## Corrected F6 line

`| F6 | 13 | Run kind is inferred from column shape in four places; it now has one definition, `RunKind::classify`, mirrored by `RUN_KIND_*_PREDICATE` in SQL (the `agent_runs.kind` column was deliberately not added — see PROJECT.md A-07) |`

## ROADMAP.md placement note (plan said line 377)

The note is at line 394, not 377, because earlier plans added lines. It said DRFT-09 "lands with `agent_runs.kind` (F6)", which asserts the column, so it was changed to point at `RunKind::classify` and A-07. Only that clause moved.

## Deviations from Plan

**1. [Plan arithmetic] `grep -c 'not installed' CLAUDE.md` prints 5, not at least 6.** The plan counted the Agent backend row among the four plan-13-04 rows marked "not installed". That row says "not a dependency" instead, so only three prior lines carry the phrase (git2, Monaco, xyflow). With rows 50 and 56 the count is 5. Both new rows are marked. I did not pad the phrase onto the Agent backend row because the plan says to touch no other row.

**2. [Plan grep too broad] The plan's migration grep `agent_runs.kind\|ALTER TABLE agent_runs` matches four unrelated migration lines** (`ADD COLUMN exit_summary_id`, `criteria_revision_pin`, and two `RENAME TO agent_runs` rebuilds). None adds a `kind` column. I replaced it with `agent_runs\.kind` over `packages/core/src` and `ADD COLUMN kind` over the migrations; both return nothing, so A-07 records a real divergence.

**Total deviations:** 2, both in the plan's own check wording; no tree change needed. **Impact:** none.

## Deferred (out of this plan's files)

- `.planning/ROADMAP.md:104` (Phase 13 goal text) and `.planning/REQUIREMENTS.md:222` (DRFT-09 line) still say the cap "lands with `agent_runs.kind`". The plan limited ROADMAP edits to the F6 row and the placement note and did not list REQUIREMENTS.md. They are placement prose, not shipped claims, but they carry the same stale wording. A follow-up one-line edit each would close them.

## Task Commits

1. Task 1: `543f24fc` docs(13-18): make CLAUDE.md Technology Stack rows 50, 53, 56 true (WR-11)
2. Task 2: `1c00fafc` docs(13-18): record amendments A-06 and A-07, correct the F6 wording

## Verification

Backstop tests, scoped: `RUST_TEST_THREADS=1 cargo test -p core --test run_kind` 17 passed (run together with another target in one invocation), `--test proposal_limit_per_kind` 15 passed. No cap behaviour changed.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

CLAUDE.md, PROJECT.md and ROADMAP.md edits confirmed by the greps above; commits `543f24fc` and `1c00fafc` exist.
