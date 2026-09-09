---
phase: "1"
slug: "the-board-is-the-store-of-record"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-09-09"
updated: "2026-09-09"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (`packages/core`) + Vitest with Testing Library (`packages/desktop`) — see `01-RESEARCH.md` § Validation Architecture |
| **Config file** | `packages/core/Cargo.toml` test and `[[bin]]` targets; `packages/desktop/vitest.config.ts` — both created by plan **01-01** (Wave 1) |
| **Quick run command** | Rust layer: `cargo test -p core` · Frontend layer: `npm --prefix packages/desktop run test` |
| **Full suite command** | `cargo test --workspace && npm --prefix packages/desktop run test` |
| **Estimated runtime** | ~60s full suite — the crash-safety suite (process spawn + SIGKILL) and `perf_seed_1000` (1,000-row seed) dominate; everything else is sub-second |

---

## Sampling Rate

- **After every task commit:** the quick run command for that task's own layer — `cargo test -p core` for a core task, `npm --prefix packages/desktop run test` for a renderer task, both for a task that spans the IPC seam.
- **After every plan wave:** `cargo test --workspace && npm --prefix packages/desktop run test`
- **Before `/gsd-verify-work`:** full suite green, with `--test crash_safety` and `--test migration_safety` re-run specifically — they are the two suites that prove the phase's fifth success criterion.
- **Max feedback latency:** 60 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | — | T-01-SC | Human verifies three `SUS` npm packages before the first install; never auto-approved | checkpoint | *(blocking-human gate — no automated command)* | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | DATA-08 | T-01-02 | Default-deny capability manifest; renderer reaches Tauri only through the adapter seam | integration | `cargo build --workspace` · `npm --prefix packages/desktop run test` | ❌ W0 (this task creates both harnesses) | ⬜ pending |
| 1-01-03 | 01 | 1 | DATA-02, DATA-08 | T-01-09, T-01-10 | Four pragmas re-applied on every open; backup written before any DDL; core never reads process cwd | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-02-01 | 02 | 2 | — | — | Typeface, icons, component library and radius decided by a human, never invented | checkpoint | *(blocking-human gate — no automated command)* | ✅ | ⬜ pending |
| 1-02-02 | 02 | 2 | BOARD-07, BOARD-08 | T-01-11 | Self-hosted type; no font-CDN request leaves the machine | integration | `npm --prefix packages/desktop run build` | ✅ | ⬜ pending |
| 1-02-03 | 02 | 2 | BOARD-07, BOARD-08 | T-01-11 | Every recorded contrast ratio proved by a runnable assertion, not by a comment | unit | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-03-01 | 03 | 3 | — | — | Schema one-way doors confirmed before any board table is committed | checkpoint | *(blocking gate — no automated command)* | ✅ | ⬜ pending |
| 1-03-02 | 03 | 3 | DATA-01, DATA-02, DATA-03 | T-01-01, T-01-04, T-01-05, T-01-13, T-01-14 | No SQL built by string formatting; `actor_id` resolved in Rust, never renderer-supplied | tracer / integration | `cargo test -p core` · `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-03-03 | 03 | 3 | DATA-01, DATA-02, DATA-03 | T-01-04 | `events.actor_id` NOT NULL with a live foreign key; rollback writes neither row | unit | `cargo test -p core --test outbox` | ✅ | ⬜ pending |
| 1-04-01 | 04 | 4 | BOARD-01, BOARD-04, DATA-01, DATA-03 | T-01-15, T-01-16 | Invalid status rejected by the schema CHECK, not by app code; epic delete orphans rather than cascades | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-04-02 | 04 | 4 | BOARD-01, BOARD-04 | T-01-15 | Picker options derive from the core constant; no renderer-side state list | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-04-03 | 04 | 4 | BOARD-01, BOARD-04 | T-01-15 | Constraint violation asserted as a SQLite error, so an app-layer guard cannot pass it | unit | `cargo test -p core --test hierarchy_workflow` | ✅ | ⬜ pending |
| 1-05-01 | 05 | 4 | DATA-07 | T-01-10 | SIGKILL after commit loses nothing; abort before commit writes nothing | integration | `cargo test -p core --test crash_safety` | ✅ | ⬜ pending |
| 1-05-02 | 05 | 4 | DATA-08 | T-01-10, T-01-17, T-01-18 | Failed migration restores the backup and refuses to open; live file never deleted | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-05-03 | 05 | 4 | DATA-08 | T-01-10 | N-1 fixture migrates without data loss; bad migration leaves bytes identical | integration | `cargo test -p core --test migration_safety` | ✅ | ⬜ pending |
| 1-06-01 | 06 | 5 | BOARD-02 | T-01-01, T-01-04, T-01-05, T-01-20 | Toggle writes only the `checked` column; a check can never become an edit | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-06-02 | 06 | 5 | BOARD-02 | T-01-20 | Criteria count survives the narrowest window; Done warns and never blocks | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-06-03 | 06 | 5 | BOARD-02 | T-01-20 | Parent edit leaves every criterion field byte-identical, compared by content not by count | unit | `cargo test -p core --test criteria` | ✅ | ⬜ pending |
| 1-07-01 | 07 | 6 | BOARD-05 | T-01-01, T-01-21, T-01-22 | Assignee must reference a real actor; no aggregate over `estimate` in any query | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-07-02 | 07 | 6 | BOARD-05 | T-01-04 | Pickers issue no command on open; priority carries a glyph, not colour alone | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-07-03 | 07 | 6 | BOARD-05 | T-01-22 | A move rewrites exactly one row; board order is reproducible across reads | unit | `cargo test -p core --test ranking` | ✅ | ⬜ pending |
| 1-08-01 | 08 | 7 | BOARD-06, BOARD-08 | T-01-01, T-01-14, T-01-23, T-01-24 | Search term bound as a parameter and matched as a literal phrase; window always capped | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-08-02 | 08 | 7 | BOARD-06, BOARD-08 | T-01-24 | Renderer reorders and narrows nothing; one debounced query per settled input | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-08-03 | 08 | 7 | BOARD-06, BOARD-08 | T-01-01, T-01-24 | Punctuation and unicode terms return results, not parse errors; index proved by query plan | integration | `cargo test -p core --test perf_seed_1000 -- --nocapture` · `cargo test -p core --test search_filter` | ✅ | ⬜ pending |
| 1-09-01 | 09 | 8 | BOARD-07 | T-01-04, T-01-25 | Bare letters never fire while typing; selection tracks item id across a pushed delta | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-09-02 | 09 | 8 | BOARD-07 | T-01-02, T-01-26 | Palette commands generated from the binding table, never from item content | integration | `cargo build --workspace` · `npm --prefix packages/desktop run build` | ✅ | ⬜ pending |
| 1-09-03 | 09 | 8 | BOARD-07 | T-01-25 | Every binding has a palette entry, asserted by iterating the table | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-10-01 | 10 | 9 | BOARD-09, DATA-05 | T-01-01, T-01-24, T-01-28 | No second history store; cursor filters on project *and* origin | unit | `cargo test -p core` | ✅ | ⬜ pending |
| 1-10-02 | 10 | 9 | BOARD-09 | T-01-27 | Payload content rendered as text nodes, never through a raw-markup path | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |
| 1-10-03 | 10 | 9 | BOARD-09, DATA-05 | T-01-28 | Batches deliver every event exactly once; a second origin has its own cursor | integration | `cargo test -p core --test cursor_resume` · `cargo test -p core --test activity_trail` | ✅ | ⬜ pending |
| 1-11-01 | 11 | 10 | BOARD-10 | T-01-30 | Marker path and format decided by a human before one enters real git history | checkpoint | *(blocking-human gate — no automated command)* | ✅ | ⬜ pending |
| 1-11-02 | 11 | 10 | BOARD-10 | T-01-03, T-01-29, T-01-30, T-01-31 | Core enumerates no directories; reconciliation never rewrites the cached path | integration | `cargo test -p core --test project_reconciliation` | ✅ | ⬜ pending |
| 1-11-03 | 11 | 10 | BOARD-10 | T-01-02 | Unreachable surface offers exactly one explicit relocation action, no auto-recovery | component | `npm --prefix packages/desktop run test` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** no three consecutive tasks lack an automated verify. The three checkpoint
tasks (1-01-01, 1-02-01, 1-03-01, 1-11-01) are gates rather than work, and each is immediately
followed by a task carrying a runnable command.

---

## Wave 0 Requirements

Greenfield repo — no test tooling exists. **Wave 0 is plan 01-01 (Wave 1)**: it must stand up both
harnesses before any later task can carry a runnable `<automated>` verify command. Tasks 1-01-02 and
1-01-03 are the only tasks in the phase whose verify commands do not yet exist when they begin.

- [ ] Rust test harness reachable via `cargo test -p core` — `packages/core/Cargo.toml` (plan 01-01, task 2)
- [ ] Frontend test harness — `packages/desktop/vitest.config.ts` + `@testing-library/react` + `jsdom` (plan 01-01, task 2)
- [ ] Crash-safety harness binary — `packages/core/tests/bin/crash_harness.rs` and its `[[bin]]` target (plan 01-05, task 1)
- [ ] Shared seed fixture for a ≥1,000-item project — `packages/core/tests/common/mod.rs` `seed_project` (plan 01-08, task 3)
- [ ] Contrast assertion harness — `packages/desktop/src/theme/contrast.ts` and its suite (plan 01-02, task 3); `01-UI-SPEC.md` records this as owed by Wave 0

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full keyboard-only board navigation | BOARD-07 | Tauri WebDriver e2e has documented 2026 setup friction; research recommends component tests plus manual UAT | Plan 01-09 task 3 `<human-check>`: drive create, move, reorder, search, filter, criteria, legend and delete entirely from the keyboard with the mouse untouched from launch to finish |
| List scroll at 60fps through 1,000+ items | BOARD-08 | No e2e harness exists; the server-side half is asserted by `perf_seed_1000` | Plan 01-08 task 2 `<human-check>`: scroll the full seeded list and confirm no stall |
| Scroll-offset determinism of the virtual window | BOARD-08 | Authored as a `backstop` truth in plan 01-08 — abstains rather than passing silently | Scroll forward and back to the same offset; the same rows render in the same order |
| Relay subscribe-and-replay from a cursor | DATA-05 | No relay exists in v1 — the schema seam is the deliverable, not a running subscriber | Automated half exists: `replay_reconstructs_the_projection` and `a_second_origin_has_its_own_cursor` in plan 01-10 task 3. Manual half: replay the log from an arbitrary cursor and confirm the projection matches |
| Force-quit and relaunch across a real version upgrade | DATA-07, DATA-08 | The automated suites model the failures; the user's own confidence needs the real app | Plan 01-03 task 2 `<human-check>`: create items, ⌘Q, relaunch, confirm all present with the same keys and order |
| Marker file contents in a real repository | BOARD-10 | Requires the user's own repositories | Plan 01-11 task 3 `<human-check>`: open a registered repo in a terminal, confirm the marker holds only the project id and key, then rename the directory and confirm the unreachable state offers only explicit relocation |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency
- [x] Every runnable `<automated>` carries a `<fails_when>` sibling naming an observable signal
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
</content>
