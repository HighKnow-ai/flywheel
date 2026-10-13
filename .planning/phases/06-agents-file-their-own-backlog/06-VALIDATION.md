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
| **Framework (frontend)** | `vitest` 5.0.0 + `jsdom` 30.0.1 + `@testing-library/react` 16.3.3, config at `packages/desktop/vitest.config.ts`, run via `npm --prefix packages/desktop test`. 38 test files exist today, including `src/board/__tests__/triage-lane.test.tsx`. |
| **Config file** | none dedicated — workspace members from `Cargo.toml`; sidecar `package.json` scripts |
| **Quick run command** | `cargo test -p core --test authoring_proposal` |
| **Full suite command** | `cargo test --workspace`, then `npm --prefix packages/sidecar test`, then `npm --prefix packages/desktop test` |
| **Estimated runtime** | quick ~15s, full ~120s (measure and correct during Wave 0) |

The Rust and sidecar commands were re-confirmed to resolve during Phase 6 research
(`cargo metadata --no-deps` for the workspace members, `packages/sidecar/package.json` for the
scripts). The frontend commands were measured during Phase 6 planning.

**Correction (recorded during planning, 2026-09-30):** `06-RESEARCH.md` § Validation Architecture
states that no frontend test harness exists in `packages/desktop/src`. That is wrong. The harness
does exist — `packages/desktop/vitest.config.ts`, `vitest` 5.0.0, `jsdom` 30.0.1,
`@testing-library/react` 16.3.3, `"test": "vitest run"`, and 38 `*.test.tsx` / `*.test.ts` files
including `src/board/__tests__/triage-lane.test.tsx`. PROP-06 therefore gets real component tests,
not a manual walkthrough. Treat this file as authoritative over RESEARCH.md on that point.

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
| PROP-06 | Triage view: accept / reject / merge / defer | component tests (vitest + jsdom + Testing Library) plus Tauri-command tests and the scripted UAT bridge | new `packages/desktop/src/triage/__tests__/triage-surface.test.tsx`, alongside the existing `src/board/__tests__/triage-lane.test.tsx`; `uat_authoring_ops` binary pattern extended | harness ✅ exists, the TriageSurface test file is new |
| PROP-07 | Every proposal records its run and its rationale | unit | `rationale` round-trips; `agent_run_id` resolves into `agent_runs` | ❌ new test |

---

## Wave 0 Requirements

- [x] Source-gate test in `packages/core/tests/` — "no agent-reachable INSERT into canonical
      tables" (D-100 first half). Closed by plan 06-02.
- [x] Adversarial-corpus test (D-100 second half, mirroring the D-62 / AGNT-07 precedent) — drives
      every propose / amend / delete path and asserts zero canonical rows until triage. Closed by
      plan 06-02.
- [x] Frontend seam decided — no harness work needed. `packages/desktop` already has vitest +
      jsdom + Testing Library, so `TriageSurface` is covered by a real component test
      (`src/triage/__tests__/triage-surface.test.tsx`, added by plan 06-07) rather than by a
      manual walkthrough. The Tauri-command tests and the scripted UAT bridge remain as the
      second and third layers, not as substitutes. Closed by plan 06-07.
- [x] Extend `migration_safety.rs` with a case for the new table-rebuild migration
      (self-referential FK rebuild under `PRAGMA foreign_keys`). Closed by plan 06-01
      (`migration_0015_rebuild_preserves_self_referential_parent_link`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Triage view look and feel (visual hierarchy, whether the four actions read as distinct) | PROP-06 | Needs a human's visual judgement on a rendered window; no assertion can stand in for "this reads as bold and modern" | Launch the desktop app, open the proposal queue with at least one pending proposal, and judge the rendering |

This is the only manual item, and it is manual for *aesthetic judgement only* — the *behaviour* of
accept / reject / merge / defer is asserted by the component test, not by the human. Everything
else in this phase has an automated seam or a scripted UAT-bridge path. Per this project's standing
preference, script the bridge rather than adding manual steps.

---

## Phase 6 Ship Gate Result (plan 06-09)

The "one scripted UAT-bridge run that exercises `propose_item` from a real execution-run session"
the Sampling Rate section above calls for is `scripts/uat/uat-10-agent-backlog.mjs`, joined to
`scripts/uat/run-all.sh` by plan 06-09. Its **offline arm** (`--offline`, zero tokens, registered
in `run-all.sh`) ran green: `PASS — UAT 10 — phase-6 agent backlog loop (offline, zero tokens)`,
covering a near-duplicate flag (PROP-04), the volume limit and its notice (PROP-05), and all four
triage verbs — accept/reject/merge/defer (PROP-02, PROP-06, PROP-07) — through the real domain
functions. Criterion 1's live-only half (a real model's own decision to call `propose_item`) is
reported `not-measured` by the offline arm, by design — it is reachable only through the **live
arm** (`--live`, costs real tokens, listed as a MANUAL row in `run-all.sh` for a human to run
deliberately, never wired into an autonomous path). See `06-09-SUMMARY.md` for the full
per-criterion report and this plan's own findings.

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
