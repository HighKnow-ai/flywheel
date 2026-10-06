---
phase: "08"
slug: "review-and-merge-inside-flywheel"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-06"
---

# Phase 08 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 8` from `08-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is filled once PLAN.md task IDs exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (integration tests in `packages/core/tests/*.rs`, fixtures in `tests/common/mod.rs` — `seeded_git_project()` gives a real git repo + registered project). Frontend: Vitest 5.0.0 + jsdom + Testing Library (`packages/desktop/vitest.config.ts`, `src/test/setup.ts`). |
| **Config file** | `packages/desktop/vitest.config.ts` (exists); Rust needs no config — new `tests/*.rs` files are Wave 0 |
| **Quick run command** | `cargo test -p core --test review_diff` (or `review_merge` / `criterion_anchors` / `epic_request_draft`) · `npx --prefix packages/desktop vitest run src/review` |
| **Full suite command** | `cargo test --workspace` and `npm --prefix packages/desktop test` plus `npx --prefix packages/desktop tsc --noEmit` |
| **Estimated runtime** | ~60 seconds quick · ~4 minutes full |

---

## Sampling Rate

- **After every task commit:** the single targeted `--test` / `vitest run <file>` for that task, plus `cargo test -p core --test supervisor_cwd` (the standing cwd-invariant gate from Phase 7)
- **After every plan wave:** `cargo test --workspace` and `npm --prefix packages/desktop test && npx --prefix packages/desktop tsc --noEmit`
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Requirement-level map from `08-RESEARCH.md`; task IDs are bound after planning.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | REVW-01 | — | `review_files` returns A/M/D/R + counts + binary + `old_path`; a rename patch includes `rename from/to`; binary yields no hunks | integration (real repo) | `cargo test -p core --test review_diff` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-01 | — | A `.rs` patch tokenizes through the refractor adapter (`.token.keyword`); an unregistered language renders plain without throwing | unit | `npx --prefix packages/desktop vitest run src/review/__tests__/highlight.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-01 | — | Per-file lazy fetch: opening a file requests its patch once; files start collapsed | component | `npx --prefix packages/desktop vitest run src/review/__tests__/file-diff.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-02 | — | Epic scope diff is `default...integration`; a NULL integration branch yields an explicit empty state and cuts no branch | integration | `cargo test -p core --test review_diff -- epic` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-03 | — | `check_criterion_with_anchor` stores a server-resolved sha; uncheck clears the anchor; a locked `revise_criterion` copies the anchor forward; hard delete cascades | integration | `cargo test -p core --test criterion_anchors` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-03 | — | Staleness: untouched → 0; changed → N; renamed or deleted path → stale; unresolvable sha → unknown | integration | `cargo test -p core --test criterion_anchors -- stale` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-03 | — | Context packet carries checked + anchor + stale line; no line when unchecked | integration | `cargo test -p core --test context_packet` | ✅ update | ⬜ pending |
| TBD | TBD | TBD | REVW-03 | — | Rail shows "no evidence" / "untouched since" / "file changed since"; Space toggles, `c` checks against the selection | component | `npx --prefix packages/desktop vitest run src/review/__tests__/criteria-rail.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-04 | T-08-01 | Clean merge: merge commit exists, event row written, no task status change, task worktree untouched | integration | `cargo test -p core --test review_merge -- clean` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-04 | T-08-01 | Conflict: files named, integration worktree clean afterwards (`porcelain` empty, no `MERGE_HEAD`), event written | integration | `cargo test -p core --test review_merge -- conflict` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-04 | T-08-01 | Pre-existing `MERGE_HEAD` or dirty integration worktree → recovered, or a named refusal | integration | `cargo test -p core --test review_merge -- recovery` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-04 | — | Already-integrated → no commit, no event; the marker derives from event + ancestry, so a freshly cut empty branch is NOT integrated | integration | `cargo test -p core --test review_merge -- marker` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-04 | T-08-01 | A per-epic lock rejects a second concurrent merge | unit | `cargo test -p core --test review_merge -- lock` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-04 | — | `supervisor_cwd` invariant still holds: one `Command::new("git")` construction site, `-C` first, no `current_dir` | gate | `cargo test -p core --test supervisor_cwd` | ✅ exists | ⬜ pending |
| TBD | TBD | TBD | REVW-05 | — | `assemble_epic_request_draft` is deterministic (two calls byte-identical), head/target correct, errors on a NULL integration branch | integration | `cargo test -p core --test epic_request_draft` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-05 | T-08-02 | Open flow against a fake `gh`: push, then `pr create --head <integration> --base <default>` | integration | `cargo test -p core --test forge_live_chain` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | REVW-05 | — | Epic sheet previews, then confirms with the id only (no title or body passed back) | component | `npx --prefix packages/desktop vitest run src/review/__tests__/epic-request.test.tsx` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | REVW-01..05 | — | New `ActionId` / region / layer: `v` does not collide; `bindingAllowedInLayer` scoped to the review layer | unit | `npx --prefix packages/desktop vitest run src/state` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/tests/review_diff.rs` — stubs for REVW-01, REVW-02
- [ ] `packages/core/tests/review_merge.rs` — stubs for REVW-04
- [ ] `packages/core/tests/criterion_anchors.rs` — stubs for REVW-03
- [ ] `packages/core/tests/epic_request_draft.rs` — stubs for REVW-05
- [ ] `packages/core/tests/common/mod.rs` — a git fixture giving two diverging task branches off an integration branch (one clean pair, one conflicting pair); set `FLYWHEEL_WORKTREE_ROOT` to a tempdir as `worktree_lifecycle.rs` does, so epic worktrees land under it
- [ ] `packages/desktop/src/review/__tests__/` — `highlight.test.ts`, `file-diff.test.tsx`, `criteria-rail.test.tsx`, `epic-request.test.tsx`
- [ ] `npm --prefix packages/desktop install react-diff-view@3.3.3 refractor@5.0.0` — vitest is already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Diff legibility and syntax-highlight colour in both themes at review width | REVW-01 | Visual judgement; token colour and contrast cannot be asserted meaningfully in jsdom | Open a task with a multi-language diff, read it in light and dark, confirm added/removed tint does not fight token colour |
| Criteria rail feels usable while reading a long diff | REVW-03 | Ergonomic judgement about pacing of a real review | Review a real multi-file task, check off each criterion against the diff without losing scroll position |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
