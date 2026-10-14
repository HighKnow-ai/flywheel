---
phase: "2"
slug: "one-agent-one-worktree-watched-live"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-09-10"
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust `cargo test` (`packages/core`, existing `packages/core/tests/*.rs` integration-test pattern — `crash_safety.rs`'s real-spawned-process harness is the direct precedent) + Vitest with Testing Library (`packages/desktop`). Sidecar-level Node tests if the permission-MCP logic lands there. See `02-RESEARCH.md` § Validation Architecture. |
| **Config file** | `packages/core/Cargo.toml` (test targets; `tempfile` dev-dependency) · `packages/desktop/vitest.config.ts` — both already exist from Phase 1 |
| **Quick run command** | Rust layer: `cargo test -p core` · Frontend layer: `npm --prefix packages/desktop run test` |
| **Full suite command** | `cargo test --workspace && npm --prefix packages/desktop run test` |
| **Estimated runtime** | ~90s full suite — this phase adds real-process spawn/kill harnesses (`worktree_lifecycle`, `stop_lifecycle`, `permission_gate`) on top of Phase 1's measured ~11s baseline (Rust ~2s, Vitest ~8.8s) |

---

## Sampling Rate

- **After every task commit:** the quick run command for that task's own layer — `cargo test -p core` for a core task, `npm --prefix packages/desktop run test` for a renderer task, both for a task that spans the IPC seam or the sidecar boundary.
- **After every plan wave:** `cargo test --workspace && npm --prefix packages/desktop run test`
- **Before `/gsd-verify-work`:** full suite green, with the PROC-06 real-process-kill test (`stop_lifecycle`) re-run explicitly — per `PITFALLS.md`'s "Looks Done But Isn't" item, force-quit and crash scenarios must leave no orphaned agent processes.
- **Max feedback latency:** 90 seconds.

---

## Per-Task Verification Map

*Seeded as `draft` by `/gsd-plan-phase`. Populated per task once PLAN.md files exist — `/gsd-validate-phase` fills and signs off this table.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *pending* | — | — | — | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

From `02-RESEARCH.md` § Validation Architecture → Wave 0 Gaps:

- [ ] `packages/core/tests/worktree_lifecycle.rs` — covers WORK-01, WORK-08, and D-30's worktree-reuse check
- [ ] `packages/core/tests/branch_naming.rs` — covers LINK-01 and D-24/D-25/D-26's two-fixed-shapes branch derivation
- [ ] `packages/core/tests/permission_gate.rs` (or a sidecar-side Node equivalent) — covers AGNT-06's blocking permission gate
- [ ] A CI lint/grep rule rejecting bare-relative-path git/fs calls in the supervisor — covers PROC-02 structurally rather than by convention (`ARCHITECTURE.md` §1 describes this as defense in depth; nothing implements it yet)
- [ ] `triggers.source` CHECK-constraint assertion — extends the existing `migration_safety.rs` pattern to cover DATA-04's "schema is the authority" requirement, proving `schedule`/`webhook` insert cleanly with no app code implementing them
- [ ] A `stop_lifecycle.rs` harness modelled on `crash_safety.rs` — covers PROC-06's SIGINT-then-SIGTERM-of-process-group mapping and the "worktree left dirty and inspectable" outcome

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Streaming a long agent session keeps application memory flat rather than growing with the transcript | PROC-07 | A memory-profiling test is disproportionately expensive at this scale; the windowed-read design (`query::events::activity_trail`'s `LIMIT`/`OFFSET` pattern) makes it true by construction, so the check is that the design was followed plus one observed long run | Start a long-running session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor — it must stay flat while the transcript grows on disk. Confirm the renderer holds a bounded window, never the whole transcript. |
| A permission request pauses the agent, is answered from the board, and the agent resumes | AGNT-06 | The automated `permission_gate` test covers the MCP round-trip; the end-to-end "answered from the board" path crosses the renderer and a real `claude` process | Press Start Work on a task whose work needs a permission decision, confirm the board surfaces the request and the agent is genuinely blocked, answer it, and confirm the agent resumes rather than restarting. |
| Credential path parity: local Claude Code credentials vs. an explicit API key behave identically | AGNT-03, AGNT-04 | Requires two real credential configurations on one machine | Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm nothing else in the product behaves differently, and confirm the key never appears in argv (`ps`) or in the persisted session JSONL. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
