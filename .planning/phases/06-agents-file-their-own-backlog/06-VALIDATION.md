---
phase: "6"
slug: "agents-file-their-own-backlog"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-30"
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 6` from `06-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is filled once PLAN.md tasks exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (Rust core)** | `cargo test` — one integration-test binary per concern under `packages/core/tests/` |
| **Framework (sidecar)** | Node built-in `node --test`, invoked via `npm --prefix packages/sidecar test` (its `test` script runs `tsc` first) |
| **Framework (frontend)** | **none exists** — no `*.test.tsx` / `vitest.config.*` / `jest.config.*` in `packages/desktop/src`. See Wave 0. |
| **Config file** | none dedicated — workspace members from `Cargo.toml`; sidecar `package.json` scripts |
| **Quick run command** | `cargo test -p core --test authoring_proposal` |
| **Full suite command** | `cargo test --workspace` then `npm --prefix packages/sidecar test` |
| **Estimated runtime** | quick ~15s, full ~120s (measure and correct during Wave 0) |

All five commands above were re-confirmed to resolve during Phase 6 research
(`cargo metadata --no-deps` for the workspace members, `packages/sidecar/package.json` for the
scripts) — they are not guesses.

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p core --test authoring_proposal`
- **After every plan wave:** Run `cargo test --workspace && npm --prefix packages/sidecar test`
- **Before `/gsd-verify-work`:** Full suite must be green, plus one scripted UAT-bridge run that
  exercises `propose_item` from a real execution-run session
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(seeded at plan time — one row per PLAN.md task, filled by `/gsd-validate-phase`)* | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement → seam (from research, pre-task)

| Req ID | Behavior | Test Type | Seam | Exists? |
|--------|----------|-----------|------|---------|
| PROP-01 | Execution-run agent calls `propose_item` and stages a row | integration | `packages/core/tests/authoring_proposal.rs` | ❌ new test |
| PROP-02 | Proposed items enter a pending state, never the canonical tables | unit | same file (accept-path tests already assert `materialised_id` stays `None`) | partial — `issue` target-type case is new |
| PROP-03 | No code path promotes without triage | source-scan gate | new gate reusing the existing `sources_under` helper | ❌ new gate |
| PROP-04 | Duplicates flagged before the user sees them | unit | `duplicate_of` / `duplicate_score` populated inside `create_proposal`'s own transaction | ❌ new test |
| PROP-05 | Volume limit surfaced, never a silent drop | integration | over-limit `propose_item` call returns a named tool error | ❌ new test |
| PROP-06 | Triage view: accept / reject / merge / defer | Tauri-command tests + UAT bridge | `uat_authoring_ops` binary pattern, extended | ❌ no frontend harness |
| PROP-07 | Every proposal records its run and its rationale | unit | `rationale` round-trips; `agent_run_id` resolves into `agent_runs` | ❌ new test |

---

## Wave 0 Requirements

- [ ] Source-gate test in `packages/core/tests/` — "no agent-reachable INSERT into canonical
      tables" (D-100 first half). No equivalent exists today.
- [ ] Adversarial-corpus test (D-100 second half, mirroring the D-62 / AGNT-07 precedent) — drives
      every propose / amend / delete path and asserts zero canonical rows until triage.
- [ ] Decide the frontend seam: either add a component-test harness to `packages/desktop`
      (currently none) or validate `TriageSurface` at the Tauri-command layer plus a UAT-bridge
      script. The plan must make this choice explicitly, not leave it implicit.
- [ ] Extend `migration_safety.rs` with a case for the new table-rebuild migration
      (self-referential FK rebuild under `PRAGMA foreign_keys`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Triage view look and feel (layout, affordance of the four actions) | PROP-06 | Needs a human's visual judgement on a rendered window; no harness can assert "this reads as bold and modern" | Launch the desktop app, open the proposal queue with at least one pending proposal, and confirm accept / reject / merge / defer are each reachable and legible |

Everything else in this phase has an automated seam or a scripted UAT-bridge path. Per this
project's standing preference, script the bridge rather than adding manual steps.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
