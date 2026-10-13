---
phase: "12"
slug: "destructive-gate-trust-boundary-redesign"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-10-01"
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded from `12-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node's built-in `node --test` (sidecar) + `cargo test` (core/shim) — both already in use, no new framework |
| **Config file** | none — `packages/sidecar/test/*.test.mjs` run directly; `packages/core`/`packages/shim` use standard `cargo test` |
| **Quick run command** | `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude FLYWHEEL_RUNTIME_DIR="$(mktemp -d)" node --test test/destructive-gate.test.mjs` (run from `packages/sidecar`; zero credential spend) |
| **Full suite command** | `bash scripts/uat/run-all.sh` (includes the live, credential-spending arms) |
| **Estimated runtime** | ~30 seconds offline; the live arms are a scheduled, credential-spending event |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (plus `cargo test` for any `packages/core` / `packages/shim` change)
- **After every plan wave:** Run `bash scripts/uat/run-all.sh --no-build` (offline arms only)
- **Before `/gsd-verify-work`:** Full offline suite green, **PLUS** at least one live run proving BOTH halves — a destructive command stopped, and ordinary commands untouched
- **Max feedback latency:** 30 seconds (offline arms)

**This phase's sampling is stricter than the GSD default, deliberately.** Round ten passed every
offline test it had and still bricked the product. A green offline suite is necessary and explicitly
not sufficient here; the two-sided live confirmation is a non-negotiable phase gate, written into the
ROADMAP's own acceptance text.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(populated by `/gsd-validate-phase` once `12-*-PLAN.md` exist)* | — | — | — | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Acceptance criteria this phase is actually contracted to (no REQ-ID is mapped to Phase 12)

| Acceptance criterion (from ROADMAP.md) | Test Type | Automated Command | File Exists? |
|---|---|---|---|
| A destructive command never reaches a remote in a `bypassPermissions` session, even when the shell snapshot's `PATH` does not lead with the shim directory | integration (offline, fixture-driven) | `node --test test/destructive-gate.test.mjs` — new `core.hooksPath` arm asserting a `pre-push` script given a deletion / force-push stdin payload exits non-zero | ❌ Wave 0 |
| Ordinary commands (`git --version`, `git status`, `npm test`) never become permission requests, under the SAME environment conditions the destructive check uses | integration (offline, fixture-driven) — the mandatory positive arm | `node --test test/destructive-gate.test.mjs` — positive arm on the SAME fixture/test pair | ❌ Wave 0 |
| `CLAUDE_ENV_FILE` ordering holds (candidate A only) | live (credential-spending) | new `scripts/uat/uat-11-*.mjs` wrapping the minimal falsification run specified in `12-RESEARCH.md` Open Question 1 | ❌ Wave 0 |
| The fix addresses the root cause (PATH non-ownership), not a text-classifier symptom | structural / source gate | `grep`-based structural test asserting `packages/shim/src/main.rs` gained no new launcher-token recognition this phase | ❌ Wave 0 |

---

## Wave 0 Requirements

- [ ] A `pre-push`-hook fixture + offline test pair — covers remote-reaching deletion / force-push detection without a real remote (reuse the throwaway-local-bare-repo pattern already in `scripts/uat/uat-07-launcher-shape-gate.mjs`)
- [ ] A `SessionStart`-hook unit test mirroring `pretooluse-hook.ts`'s own test shape: asserts the script writes the expected `export PATH=` line when `CLAUDE_ENV_FILE` is set, and degrades silently (never throws) when it is not
- [ ] A new `scripts/uat/uat-11-*.mjs` implementing the exact falsification run from `12-RESEARCH.md` Open Question 1 — the one live, credential-spending item this phase must schedule explicitly

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `CLAUDE_ENV_FILE` wins against this machine's real shell snapshot on the installed `claude` binary in headless mode | ROADMAP fork option 1 | Requires a real, credential-spending Claude Code session; no offline harness can observe the snapshot-vs-`env` application order | Wrapped in `scripts/uat/uat-11-*.mjs` so the step is a script invocation, not a hand-driven walkthrough — the harness is the deliverable, the credential spend is the only manual part |

Everything else in this phase has, or must gain, an automated arm. A guarantee that "needs a live
session" is a gap to close with a harness script, not a standing reason to verify by hand.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s (offline arms)
- [ ] Both arms present: destructive-blocked AND benign-unaffected (one-sided verification is what shipped round ten)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
