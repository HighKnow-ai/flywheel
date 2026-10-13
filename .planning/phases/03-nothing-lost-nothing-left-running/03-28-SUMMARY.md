---
phase: 03-nothing-lost-nothing-left-running
plan: 28
subsystem: infra
tags: [destructive-gate, security-hardening, documentation, trust-boundary, node, rust]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-24's safe-branch environment proof (shimShadowDirectoryProven) and D-61 text-shadow rule; 03-25's install/spawn-time verification; 03-26's checked-in LAUNCHER_CORPUS (D-62 item 1); 03-27's live launcher-wrapped measurement (D-62 item 2)"
provides:
  - "docs/destructive-gate-trust-boundary.md (D-62 item 3): what each of the three layers (supervisor install, PreToolUse hook, shim runtime interception) is trusted to prove and what it explicitly cannot see, a four-row-minimum named-residuals table, a layer-to-corpus map over plan 03-26's LAUNCHER_CORPUS groups, a record of plan 03-27's live measurement, and the round-five rule: a new bypass shape is a boundary failure, not a missing corpus row"
  - "Three one-line cross-references from packages/shim/src/main.rs, packages/sidecar/src/pretooluse-hook.ts and packages/sidecar/test/destructive-gate.test.mjs's LAUNCHER_CORPUS header to the boundary document"
  - "A structural gate test in destructive-gate.test.mjs, carrying no skip condition, that reads the boundary document from disk and fails the suite if it is narrowed (fewer than 3 \"Explicitly cannot see\" headings, a missing implementing-file reference, or a residuals table under 4 rows)"
affects: [security-review, agnt-07-closure, 03-VERIFICATION.md]

# Actuals (#2632)
actuals:
  tokens: 5514
  tasks: 2
  commits: 2
  plan_head_before: ed72a99274e51de3fd211f6dbf85c84116c175b2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The trust-boundary document is resolved from the test file the same way resolveShimBinaryForTest resolves the compiled shim binary (path.resolve(__dirname, '..', '..', '..') to the workspace root, then a fixed relative path) — no hand-built relative path of its own."
    - "A doc-comment cross-reference is ONE line naming the document's path, never a restatement of its contents — the discipline this plan's own scope boundary required, so the reference cannot itself drift from the document it points at."

key-files:
  created:
    - docs/destructive-gate-trust-boundary.md
  modified:
    - packages/shim/src/main.rs
    - packages/sidecar/src/pretooluse-hook.ts
    - packages/sidecar/test/destructive-gate.test.mjs

key-decisions:
  - "The residuals table's four required rows (sudo's secure_path, an indirection-hidden shadow construct, Claude Code's internal git housekeeping outside the Bash matcher, macOS-only measurement) are asserted structurally by counting markdown table rows under the \"## Named residuals\" heading, not by grepping for each case's own keywords — a future fifth or sixth row still passes, but the table can never silently shrink below four without the gate failing."
  - "The internal-git-housekeeping residual cites scripts/uat/uat-03-destructive-gate.mjs's drainIncidentalPermissionRequests doc comment rather than restating it, per the plan's own instruction — that doc comment is the primary source and this document is a pointer to it, not a second copy."
  - "AGNT-07's status is untouched by this plan, by design — .planning/REQUIREMENTS.md, .planning/STATE.md and .planning/ROADMAP.md are unmodified (verified by git diff --stat against the plan-start SHA). Re-verification against all three D-62 deliverables together decides AGNT-07's status, not this plan."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "docs/destructive-gate-trust-boundary.md exists, tracked by git, and carries one section per layer (each naming its implementing file, with a \"Trusted to prove\" and an \"Explicitly cannot see\" subsection), a residuals table with the four required rows, a layer-to-corpus map over plan 03-26's LAUNCHER_CORPUS groups, a \"what was deliberately not done\" section, a recorded live-measurement section citing plan 03-27's result, and a closing round-five rule"
    requirement: "AGNT-07"
    verification:
      - kind: other
        ref: "grep -c 'Explicitly cannot see' / 'secure_path' / 'D-59' / 'D-62' / each implementing file path against docs/destructive-gate-trust-boundary.md (this session, all thresholds met)"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/destructive-gate.test.mjs#the recorded trust boundary (docs/destructive-gate-trust-boundary.md) still names all three layers, their residuals and the files that implement them — D-62 item 3's structural gate"
        status: pass
    human_judgment: false
  - id: D2
    description: "Each of packages/shim/src/main.rs, packages/sidecar/src/pretooluse-hook.ts and packages/sidecar/test/destructive-gate.test.mjs names docs/destructive-gate-trust-boundary.md at least once, restating nothing beyond one line; no behaviour changed (the diff in the two source files is comment lines only)"
    requirement: "AGNT-07"
    verification:
      - kind: integration
        ref: "cargo build --workspace && npm --prefix packages/sidecar run build && node --test packages/sidecar/test/destructive-gate.test.mjs (29/29 pass, fail 0, no SKIPPED lines)"
        status: pass
      - kind: integration
        ref: "cargo test --workspace (no test result: FAILED line)"
        status: pass
    human_judgment: false
  - id: D3
    description: "AGNT-07's own status is not touched by this plan — re-verification against all three D-62 deliverables (03-26's corpus, 03-27's live run, this document) decides it, not the plan that produced the last artifact"
    verification: []
    human_judgment: true
    rationale: "This plan's own scope boundary forbids editing .planning/REQUIREMENTS.md, .planning/STATE.md and .planning/ROADMAP.md, verified by git diff --stat against the plan-start SHA showing no changes to any of the three. Whether AGNT-07 can now leave Gaps Found is a re-verification judgment call over all three D-62 deliverables together, which this plan does not make."

# Metrics
duration: 22min
completed: 2026-09-21
status: complete
---

# Phase 3 Plan 28: The Destructive-Gate Trust Boundary (D-62 Item 3) Summary

**`docs/destructive-gate-trust-boundary.md` now records what each of the three destructive-gate layers is trusted to prove and what it explicitly cannot see, with a four-row residuals table, a layer-to-corpus map over plan 03-26's adversarial corpus, and a structural test that fails the suite the moment the document is narrowed — closing D-62's third and last deliverable so AGNT-07 is ready for re-verification.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-09-21T09:46:06+08:00 (approx., immediately after plan 03-27)
- **Completed:** 2026-09-21T10:07:59+08:00
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `docs/destructive-gate-trust-boundary.md` — a new document with one section per layer (Layer 0: `packages/core/src/shim.rs`'s install-time verification; Layer 1: `packages/sidecar/src/pretooluse-hook.ts`'s environment-plus-text proof; Layer 2: `packages/shim/src/main.rs`'s runtime `PATH`-shadow interception), each carrying a "Trusted to prove" and an "Explicitly cannot see" subsection. Layer 1's section states plainly that the hook never waits and can therefore never be the layer that asks a human — the property that makes layer 2 load-bearing rather than redundant.
- A named-residuals table with the four minimum rows the plan requires: `sudo`'s `secure_path` (open, pointed at the corpus's own `sudo git push --force` row), an indirection-hidden shadow construct (a `source` pulling in a definition the raw-text scan cannot follow into the sourced file), Claude Code's internal git housekeeping outside the `Bash` matcher (cited from `uat-03-destructive-gate.mjs`'s `drainIncidentalPermissionRequests` doc comment, not restated), and macOS-only measurement.
- A layer-to-corpus map naming each of plan 03-26's `LAUNCHER_CORPUS` groups (the eight launcher shapes, the `env`/`command` unwrap pair, the `builtin`/`PATH=`/`env -i`/`env -u PATH`/`env -S`/`command -p` family, the shadow shapes, and the non-trigger/harmless controls) and the layer trusted to catch each, built from the corpus's own `why` fields.
- A "what was deliberately not done" section naming D-59's rejected launcher-enumeration option and its deferred allow-listing option, each with the sixth-round reopening trigger named in `03-CONTEXT.md`'s own "Deferred" section.
- A recorded live-measurement section citing plan 03-27's `uat-07-launcher-shape-gate.mjs` PASS against `claude 2.1.267`, and the closing round-five rule: a new bypass shape is a boundary failure, and amending this document precedes appending a corpus row.
- Three one-line references added to the module doc comments of `packages/shim/src/main.rs` and `packages/sidecar/src/pretooluse-hook.ts`, and to the `LAUNCHER_CORPUS` header comment in `packages/sidecar/test/destructive-gate.test.mjs` — each naming the document's path without restating its contents.
- A new structural-gate test in `destructive-gate.test.mjs`, carrying no skip condition, that reads the document from disk (resolved the same way `resolveShimBinaryForTest` resolves the compiled shim binary) and asserts it is non-empty, carries at least three "Explicitly cannot see" headings, names all three implementing files, and has a residuals table with at least four rows — each assertion message states what a failure means for the boundary.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the trust boundary — what each layer proves, and what it explicitly cannot see** - `29d896d` (docs)
2. **Task 2: Make the boundary reachable from the code, and gate it so it cannot rot** - `a03af20` (test)

**Plan metadata:** committed separately (see below).

## Files Created/Modified

- `docs/destructive-gate-trust-boundary.md` — new. The recorded trust boundary (D-62 item 3): three layer sections, a residuals table, a layer-to-corpus map, a "what was deliberately not done" section, a recorded live-measurement section, and the round-five closing rule.
- `packages/shim/src/main.rs` — one-line module-doc-comment reference to the boundary document, added at the end of the existing comment block. No behaviour change.
- `packages/sidecar/src/pretooluse-hook.ts` — one-line module-doc-comment reference to the boundary document. No behaviour change.
- `packages/sidecar/test/destructive-gate.test.mjs` — one-line reference added to the `LAUNCHER_CORPUS` header comment; new structural gate test (`resolveTrustBoundaryDocForTest` plus one `test(...)` block) appended at the end of the file. No existing test changed.

## Decisions Made

See `key-decisions` in frontmatter. Summary: the residuals-row count is asserted structurally (row counting under the "## Named residuals" heading) rather than by keyword grepping each case, so the gate catches a shrinking table regardless of which specific case someone deletes; the internal-git-housekeeping residual cites `uat-03-destructive-gate.mjs`'s existing doc comment rather than duplicating it; AGNT-07's status is deliberately untouched, verified by `git diff --stat` against the plan-start SHA showing no changes to `.planning/REQUIREMENTS.md`, `.planning/STATE.md` or `.planning/ROADMAP.md`.

## Deviations from Plan

None — plan executed exactly as written. No source behaviour was changed (the diff in `packages/shim/src/main.rs` and `packages/sidecar/src/pretooluse-hook.ts` is comment lines only, confirmed by `git diff`), no destructive git command was executed at any point (D-63 honored — every verification was `cargo build`/`cargo test`/`node --test`/`grep`/`git diff --stat`, never a `git push`/`rm` against a real remote or worktree), and no `.planning/` requirements/state/roadmap file was touched.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **All three D-62 deliverables now exist**, so AGNT-07 is ready for re-verification:
  1. The checked-in adversarial corpus (`LAUNCHER_CORPUS`, 29 rows) — `packages/sidecar/test/destructive-gate.test.mjs`, plan 03-26.
  2. The live `claude` run — `scripts/uat/uat-07-launcher-shape-gate.mjs`, plan 03-27 (measured PASS against `claude 2.1.267`).
  3. The recorded trust boundary — `docs/destructive-gate-trust-boundary.md`, this plan.
- **This plan does NOT flip AGNT-07's status.** `.planning/REQUIREMENTS.md`, `.planning/STATE.md` and `.planning/ROADMAP.md` are unmodified by this plan (verified). Re-verification decides AGNT-07's status against all three deliverables together — the next step is `/gsd-verify-work` or an equivalent re-verification pass over Phase 3's AGNT-07 requirement.
- The residuals this document names as still open (`sudo`'s `secure_path`, an indirection-hidden shadow construct, and macOS-only measurement) are not closed by this plan and are not claimed to be — they are named, with reopening triggers, exactly as D-62 item 3 requires. A sixth bypass round is the trigger for revisiting D-59's rejected/deferred options.
- No git command ran against any remote or worktree while working this plan (D-63 honored throughout).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*

## Self-Check: PASSED

- FOUND: `docs/destructive-gate-trust-boundary.md`
- FOUND: `packages/shim/src/main.rs` (modified)
- FOUND: `packages/sidecar/src/pretooluse-hook.ts` (modified)
- FOUND: `packages/sidecar/test/destructive-gate.test.mjs` (modified)
- FOUND commit: `29d896d` (docs — Task 1)
- FOUND commit: `a03af20` (test — Task 2)
- Re-ran plan-level `<verification>`: `test -f docs/destructive-gate-trust-boundary.md` succeeds and `git ls-files -- docs/destructive-gate-trust-boundary.md` is non-empty; `cargo build --workspace` succeeds; `npm --prefix packages/sidecar run build && node --test packages/sidecar/test/destructive-gate.test.mjs` reports 29/29 pass, `# fail 0`, no `SKIPPED (shim-binary tests)` line; `cargo test --workspace` shows no `test result: FAILED` line; `git diff --stat ed72a99..HEAD` names exactly the four `files_modified` files and does NOT name `.planning/REQUIREMENTS.md`, `.planning/STATE.md` or `.planning/ROADMAP.md`.
