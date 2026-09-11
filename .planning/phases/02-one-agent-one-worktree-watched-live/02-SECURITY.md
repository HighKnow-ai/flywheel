---
phase: "02"
slug: "one-agent-one-worktree-watched-live"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high). T-02-42 was
# the only blocking open threat; its declared mitigation was implemented during this audit run.
threats_open: 0
asvs_level: 1
created: "2026-09-11"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register source: the `## STRIDE Threat Register` block in all 18 `*-PLAN.md` files — **84 distinct
threat ids** (47 `T-02-NN` + 37 `T-02G-NN-NN`). Seven ids appear in two registers each; where
severities disagreed the higher was taken (T-02-06: `medium` in 02-01, `high` in 02-07 → high).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Renderer ↔ Rust core | Tauri IPC. The renderer holds no filesystem or process capability of its own. | Board DTOs, bounded session-log windows, permission-request payloads. Never: credential values, never the app-data directory path. |
| Rust core ↔ Node sidecar | One supervised stdio pipe, newline-delimited JSON. | Spawn requests (absolute worktree path), events, acks. Credentials cross **only** in the spawn request's `env`, never in argv. |
| Node sidecar ↔ spawned `claude` | A child process in its own process group, cwd pinned to the task's worktree. | Prompt via argv; credential via environment only; stdout/stderr consumed by the sidecar. |
| Agent ↔ human (permission gate) | An in-sidecar MCP server over a unix socket; the CLI's `--permission-prompt-tool`. | Gated tool name + input, and a human allow/deny/allow-always decision. |
| Application ↔ macOS Keychain | `keyring` crate only; never a shell-out to `security`. | The single global API key. Read at exactly one point (`resolve_credential`). |

---

## Threat Register

**84 threats · 82 closed · 2 open (both below the `high` block threshold) · 0 blocking.**

Full per-threat evidence — file and line for every closed mitigation — is in the audit record
committed alongside this file. Summarised here by outcome:

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-42 | Repudiation | Credential precedence when a subscription session and an API key are both present | high | mitigate | Clause 2 (error, never silent fallback) `packages/core/src/credentials.rs:185-192`. Clause 1 (notice when precedence is unconfirmed) `packages/desktop/src/settings/SettingsSurface.tsx` `API_KEY_PRECEDENCE_NOTICE` — **added during this audit**, with tests in `settings-surface.test.tsx`. | closed |
| T-02G-17-03 | Denial of Service | A backend writing unbounded stderr | low | mitigate | `STDERR_DETAIL_MAX_CHARS` now enforced by append-then-truncate in `packages/sidecar/src/claude-code-adapter.ts` (was check-before-append, which one oversized line defeated). Test added in `adapter.test.mjs`. | closed |
| T-02-37 | Information Disclosure | A recorded worktree missing from disk rendered as if present | medium | mitigate | Null-field half implemented (`WorktreeSummary.tsx:41-46,69-83`). Missing-from-disk half has no data to act on — `WorktreeSummaryDto` carries no existence signal (`commands/agent_run.rs:926-935`). Self-disclosed by the executor, scoped to Phase 3 WORK-06. | **open — below `high` threshold (non-blocking)** |
| T-02-03 | Information Disclosure | Sidecar serialising its resolved environment | high | mitigate | Substantive claim verified: the sidecar never serialises `env`; the only two env reads are pre-spawn. **Register wording is stale** — it says the log writer "appends only lines received from stdout", which 02-17's stderr capture made false. Text needs correcting; the control holds. | closed (wording defect noted) |
| *(the other 79)* | — | — | — | mitigate | Verified present in the implementation, each with file:line evidence in the audit record. | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Only open threats at or above `high` count toward `threats_open`.*

---

## Mitigations verified by code reading only — never by observed behaviour

This section is the point of the audit, not a footnote. Each of these is structurally present in
the code and has never executed outside automated tests.

**The permission-rule grant/revoke path has never run in production.** Measured against the live
board after human UAT: `permission_rules` holds 0 rows, there are 0 `%rule%` events of any kind,
and the single permission request ever raised was answered rather than converted to a rule.

| Threat | Severity | What is unproven |
|---|---|---|
| T-02-24 | **high** | The cross-project scope constraint's *read* path. The `UNIQUE (project_id, tool_name)` constraint is structural and cannot be bypassed, but `matching_rule` has never returned a real rule. |
| T-02-27 | medium | The rule short-circuit (`commands/agent_run.rs:401-435`) has never executed; `permission_request.auto_resolved` has never been written outside tests. |
| T-02-04 | medium | The revoke path. |
| T-02-45 | medium | The project-name column in the rules table. |
| T-02-47 | medium | Skeleton-versus-empty-state in the rules table. |
| T-02-12 | high | The *absence* of git calls on the stop path is proven structurally, but no human has observed uncommitted agent work surviving a Stop — UAT test 4's worktrees were clean at verification time. |

**Conversely, these were exercised by a human and corroborated against the board:** the permission
gate blocking and resuming a real spawned process — and notably it fired on a *read-only* Bash
command, so the recorded Claude Code bash-safety-heuristic bypass caveat did not reproduce;
storing an API key through the write-only Settings field; credentials absent from argv and from 191
lines of persisted session JSONL; clean process teardown with no orphan.

---

## Accepted Risks Log

All 14 carry disposition `accept` in their authoring plan's register. Transcribed here, as required
— an accepted risk omitted from this log reverts to OPEN.

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-02-10 (low) | Accepted in 02-01's register. | Phase 02 plan author | 2026-09-11 |
| AR-02 | T-02-14 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-03 | T-02-26 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-04 | T-02-31 (low) | Bounded at `PermissionRequestCard.tsx:110,148-149`. | Phase 02 plan author | 2026-09-11 |
| AR-05 | T-02-34 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-06 | T-02-39 (low) | Bounded by `AGENT_RUNS_FOR_TASK_MAX_LIMIT=50` (`commands/agent_run.rs:860`, `RunsSection.tsx:300-301`). | Phase 02 plan author | 2026-09-11 |
| AR-07 | T-02G-12-02 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-08 | T-02G-13-04 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-09 | T-02G-14-04 (medium) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-10 | T-02G-14-05 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-11 | T-02G-15-03 (low) | Capped at `sidecar.rs:142,670-674`. | Phase 02 plan author | 2026-09-11 |
| AR-12 | T-02G-15-05 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-13 | T-02G-16-04 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |
| AR-14 | T-02G-18-04 (low) | Accepted in its authoring register. | Phase 02 plan author | 2026-09-11 |

---

## Findings outside the register

Recorded because an audit that only answers the questions it was asked is worth less than one that
reports what it found.

**1. No `## Threat Flags` section exists in any of the 18 SUMMARY files.** The executor recorded no
new attack surface through the designated channel. The one self-disclosed mitigation gap (T-02-37)
was filed under a non-standard `## Known Stubs` heading in `02-08-SUMMARY.md`, where a
`## Threat Flags`-scoped reader would miss it entirely. **Treat the absence of threat flags in this
phase as *unrecorded*, not as *none found*.**

**2. A test read the operator's real Keychain and asserted an unstated precondition about it.**
`packages/core/tests/credentials.rs`'s `resolve_credential_falls_back_to_the_global_default_without_a_project_override`
reaches the real Keychain through `resolve_credential`, but was the one Keychain-touching test in
that file taking neither the serialisation lock nor the `KeychainRestoreGuard`. It asserted "no key
is stored" — true until a human stored one through the product's own Settings surface during UAT
test 5, after which `cargo test` failed 3/3 on a machine whose code was correct. Fixed during this
audit: it now takes the lock and the guard, and *establishes* the precondition by clearing the entry
rather than assuming it. The operator's key is captured and restored either way, and was never at
risk — the file's existing `Drop` guard discipline was sound; this one test had simply been missed.

**3. T-02G-17-01's argv-only reasoning does not cover environment echo.** Its mitigation argues the
credential "is not a value the CLI could echo back from its command line" — true for argv, but the
credential *is* in the child's environment, and a backend that dumps its environment on error would
now place it in a `system_notice` event, the persisted JSONL, and the rendered feed. Both declared
mitigations are present, so the threat is CLOSED at ASVS L1; the gap in the *reasoning* is
structural rather than accidental and should be revisited if the ASVS level rises.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-11 | 84 | 82 | 2 (0 blocking) | gsd-security-auditor (ASVS L1, block_on high) |

Post-audit remediation the same day, verified directly rather than by re-running the full audit:
T-02-42 clause 1 implemented and tested; T-02G-17-03 bound enforced and tested; the non-hermetic
credential test repaired. Suites after remediation: **rust 222/222 · sidecar 39/39 · desktop
314/314 · TypeScript build clean.**

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (14 transcribed)
- [x] `threats_open: 0` confirmed — both remaining open threats are below the `high` block threshold
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-09-11

**Carried forward, not resolved here:** T-02-37 (Phase 3, WORK-06); the six code-only-verified
mitigations above, chief among them T-02-24 at `high`; T-02-03's stale register wording; and the
credential-precedence question itself, which is now *disclosed* to the operator rather than
*measured*. Measuring it needs a spend-authorized key alongside a live subscription session.
