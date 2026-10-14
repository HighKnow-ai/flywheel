---
phase: "09"
slug: "planned-fan-out-that-does-not-collide"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-09"
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Test Infrastructure and Wave 0 are seeded from `09-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is filled once plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (integration tests in `packages/core/tests/*.rs`, helper `tests/common/mod.rs` with the real-git `seeded_git_project()`); sidecar: `node --test test/*.test.mjs` after `tsc`; desktop: Vitest 5.0.0 + jsdom |
| **Config file** | Rust: none · `packages/sidecar/package.json` `scripts.test` · `packages/desktop/vitest.config.ts` |
| **Quick run command** | `cargo test -p core --test <name>` · `npm --prefix packages/sidecar test` · `npm --prefix packages/desktop run test -- <path>` |
| **Full suite command** | `cargo test --workspace` && `npm --prefix packages/sidecar test` && `npm --prefix packages/desktop test` && `npx --prefix packages/desktop tsc --noEmit` |
| **Estimated runtime** | ~60 seconds for a targeted run |

---

## Sampling Rate

- **After every task commit:** the task's targeted `cargo test -p core --test <name>` or `node --test` file, plus `cargo test -p core --test supervisor_cwd`
- **After every plan wave:** `cargo test --workspace`, `npm --prefix packages/sidecar test`, `npm --prefix packages/desktop test`, `npx --prefix packages/desktop tsc --noEmit`
- **Before `/gsd-verify-work`:** full suite green, plus one run of the credential-gated live scope test against the installed `claude`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD — filled from PLAN.md tasks | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/tests/file_set_overlap.rs` — PLAN-02 overlap truth table, validation refusals
- [ ] `packages/core/tests/dispatch_plan.rs` — edges, waves, `why`, plan lifecycle events (PLAN-01, PLAN-02, PLAN-07)
- [ ] `packages/core/tests/dispatch_cap.rs` — PLAN-06 cap never exceeded, occupancy
- [ ] `packages/core/tests/dispatch_limit_gate.rs` — AGNT-05 limit gate
- [ ] `packages/core/tests/dispatch_auto_merge.rs` — PLAN-03 merged-not-finished readiness, D-155/156
- [ ] `packages/core/tests/scope_marker_contract.rs` — PLAN-04 write-side marker contract, D-150 unarmed
- [ ] `packages/core/tests/scope_events.rs` — PLAN-05 scope events + close-time backstop
- [ ] `packages/core/tests/scope_widen.rs` — D-152 widen refusal/acceptance
- [ ] `packages/sidecar/test/scope-hook.test.mjs` (+ conformance corpus JSON shared with the Rust matcher test)
- [ ] `packages/sidecar/test/scope-hook-live.test.mjs` — credential-gated, skips visibly
- [ ] `packages/sidecar/test/rate-limit-wire.test.mjs` — AGNT-05 wire shapes
- [ ] `packages/sidecar/test/submit-plan-wire.test.mjs` — PLAN-01 wire
- [ ] `fake-claude.mjs` additions: configurable `rate_limit_event`; `submit_plan` through the real MCP socket
- [ ] Extend `execution-hook-settings.test.mjs` (entry counts) and `spawn_stagger.rs` (no-bypass gate covers the dispatcher)
- [ ] Framework install: none needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real hard rate-limit / session-limit presentation | AGNT-05 | Cannot be forced on demand against the live backend; no hard limit has been observed | Queued in `.planning/DEFERRED-REVIEW.md` as an unobserved residual; covered by fixtures meanwhile |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
