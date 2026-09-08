---
phase: "1"
slug: "the-board-is-the-store-of-record"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-09"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (core) + Vitest (frontend) — see `01-RESEARCH.md` § Validation Architecture |
| **Config file** | none — Wave 0 installs (greenfield repo: no test tooling exists yet) |
| **Quick run command** | `{quick command — planner fills from the task's own layer}` |
| **Full suite command** | `{full command — planner fills after Wave 0 scaffolds both harnesses}` |
| **Estimated runtime** | ~{N} seconds |

---

## Sampling Rate

- **After every task commit:** Run `{quick run command}`
- **After every plan wave:** Run `{full suite command}`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Greenfield repo — no test tooling exists. Wave 0 must stand up both harnesses before any
task can carry a runnable `<automated>` verify command.

- [ ] Rust test harness reachable via `cargo test` in the Tauri core crate
- [ ] Frontend test harness (Vitest) configured for the React app
- [ ] Crash-safety harness binary (per `01-RESEARCH.md`) for DATA-07
- [ ] Shared fixtures: seeded SQLite database and a ≥1,000-item project for BOARD-08

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full keyboard-only board navigation | BOARD-07 | Tauri WebDriver e2e has documented 2026 setup friction; research recommends component tests + manual UAT | Drive create / move / reorder / search / open-detail entirely from the keyboard with the mouse untouched |
| Relay subscribe-and-replay from a cursor | DATA-05 | No relay exists in v1 — the schema seam is the deliverable, not a running subscriber | Replay the event log from an arbitrary cursor and assert the resulting projection equals current state |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
