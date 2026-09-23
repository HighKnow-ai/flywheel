---
phase: "05"
slug: "socratic-epic-authoring"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-09-23"
---

# Phase 05 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Filled in by plan 05-10
> Task 2, after every plan in the phase had already executed and reported its own evidence — this
> document records what actually ran, not a forecast written before Wave 1 started.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (workspace-native, `packages/core` + `packages/desktop/src-tauri`); Node/sidecar: `node --test` (`packages/sidecar`'s own `npm test` script); Desktop: `vitest run` (`packages/desktop`'s own `npm run test`) |
| **Config file** | `packages/core/Cargo.toml` (workspace); `packages/sidecar/package.json`'s `test` script; `packages/desktop` (Vitest, no separate config file — uses defaults) |
| **Quick run command** | `cargo test -p core --test <name>` / `node --test packages/sidecar/test/<file>.test.mjs` / `npx vitest run <file>` (run from `packages/desktop`) |
| **Full suite command** | `cargo test --workspace` / `npm --prefix packages/sidecar test` / `npm --prefix packages/desktop run test` |
| **Estimated runtime** | ~35s Rust workspace, ~5s sidecar, ~10s desktop (measured this session) |

---

## Sampling Rate

- **After every task commit:** the task's own named `<automated>` command(s), per the per-task map below.
- **After every plan wave:** the full suite for every package the wave touched (`cargo test --workspace`, `npm --prefix packages/sidecar test`, `npm --prefix packages/desktop run test`).
- **Before `/gsd-verify-work`:** all three full suites green — confirmed this session: `cargo test --workspace` (0 failures), `npm --prefix packages/desktop run test` (534/534), `npm --prefix packages/sidecar test` (140/140, unchanged by this plan).
- **Max feedback latency:** ~35 seconds (`cargo test --workspace`, the slowest of the three full suites).

---

## Per-Task Verification Map

Every task across all ten plans in this phase, with its own actual `<automated>` command as written in
that plan's `PLAN.md` (the primary/first command where a task carried several) and its status as
measured at the end of this plan's own execution. `✅` means the command was re-run this session (for
05-10's own three tasks) or is covered by the full-suite re-run every subsequent plan's own `<verify>`
performed (for plans 05-01 through 05-09 — each SUMMARY's own "Self-Check: PASSED" section is the
per-plan evidence; this table does not re-litigate it, only maps it).

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------------|-----------|--------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SHAPE-01, SHAPE-02 | Conversation transport measured live against the real `claude` binary | integration (live spike) | `node scripts/spike/authoring-transport-spike.mjs --self-test` | ✅ | ✅ green |
| 05-01-02 | 01 | 1 | SHAPE-01, SHAPE-02 | Stage-gate matcher measured live; denial is recoverable | integration (live spike) | `node scripts/spike/authoring-stage-gate-spike.mjs --self-test` | ✅ | ✅ green |
| 05-01-03 | 01 | 1 | SHAPE-01, SHAPE-02 | Nimbalyst re-scout recorded; product kill criterion named | manual/recorded | `test -s 05-COMPETITIVE-RESCOUT.md && grep -c 'Nimbalyst' …` | ✅ | ✅ green |
| 05-02-01 | 02 | 2 | SHAPE-01, SHAPE-02, SHAPE-04 | Proposed task reaches the tray; accepting it writes a real task, never a raw `INSERT` in the proposal module | integration | `cargo test -p core --test authoring_tracer` | ✅ | ✅ green |
| 05-02-02 | 02 | 2 | SHAPE-01, SHAPE-02, SHAPE-04 | `propose_task` tool carries no identity property | unit + gate | `npm --prefix packages/sidecar test` | ✅ | ✅ green |
| 05-02-03 | 02 | 2 | SHAPE-01, SHAPE-02, SHAPE-04 | Session starts, proposal arrives, accept lands on the board | unit (React) + gate | `npm --prefix packages/desktop run test -- src/authoring/__tests__/proposal-tray.test.tsx` | ✅ | ✅ green |
| 05-03-01 | 03 | 3 | SHAPE-01 | `PreToolUse` hook denies a proposal-writing tool during `challenge`, allows after; the run resolves its own id from its own environment only | unit (Node) + gate | `npm --prefix packages/sidecar test` | ✅ | ✅ green |
| 05-03-02 | 03 | 3 | SHAPE-01 | Only a human-actor caller may `advance_stage`/`return_to_stage`; no `packages/sidecar/src` caller exists | integration + source-scanning gate | `cargo test -p core --test authoring_stage` | ✅ | ✅ green |
| 05-03-03 | 03 | 3 | SHAPE-01 | The current stage and the Advance affordance are visible; a missing gate shows a banner, never a silent degrade | unit (React) | `npm --prefix packages/desktop run test -- src/session/__tests__/authoring-stage.test.tsx` | ✅ | ✅ green |
| 05-04-01 | 04 | 3 | SHAPE-01, SHAPE-05 | Epic-scoped packet is a pure query (no model/network/git call, no mutation) | integration | `cargo test -p core --test epic_context_packet` | ✅ | ✅ green |
| 05-04-02 | 04 | 3 | SHAPE-01, SHAPE-05 | `epic_roster`'s AR-01-04 exemption closed with a surfaced-truncation ceiling; the agent's own reads stay `DEFAULT_LIMIT`/`MAX_LIMIT`-clamped | integration | `cargo test -p core --test epic_roster` | ✅ | ✅ green |
| 05-04-03 | 04 | 3 | SHAPE-01, SHAPE-05 | Five consecutive assemblies are `PartialEq`-equal and write nothing; every `SELECT` under `query/` is bounded or named in the allowlist | integration + gate | `cargo test -p core --test epic_context_packet` | ✅ | ✅ green |
| 05-05-01 | 05 | 4 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-05 | Six write tools, all schema-validated, none carrying an identity property | unit (Node) + gate | `npm --prefix packages/sidecar test` | ✅ | ✅ green |
| 05-05-02 | 05 | 4 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-05 | Three capped read tools, answered by the core over a held socket message — never by the sidecar opening the database | unit (Node) + integration | `npm --prefix packages/sidecar test` | ✅ | ✅ green |
| 05-05-03 | 05 | 4 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-05 | Advancing out of `challenge` returns a distillation instruction naming `propose_assumption`; a decision renders as a turn | integration | `cargo test -p core --test authoring_distillation` | ✅ | ✅ green |
| 05-06-01 | 06 | 5 | SHAPE-02, SHAPE-03, SHAPE-04 | `accept_proposal` covers every verb/target-type combination through its canonical writer, never a local `INSERT`/`UPDATE` | integration (TDD) | `cargo test -p core --test authoring_proposal` | ✅ | ✅ green |
| 05-06-02 | 06 | 5 | SHAPE-02, SHAPE-03, SHAPE-04 | `reject_proposal`/`amend_proposal` relay a decision turn; no `DELETE FROM authoring_proposals` anywhere | integration + gate | `cargo test -p core --test authoring_proposal` | ✅ | ✅ green |
| 05-06-03 | 06 | 5 | SHAPE-02, SHAPE-03, SHAPE-04 | `accept_subtree` is the ONE bulk path; no accept-all identifier exists in the three scanned source trees | integration + source-scanning gate | `cargo test -p core --test authoring_proposal no_accept_all` | ✅ | ✅ green |
| 05-07-01 | 07 | 6 | SHAPE-03, SHAPE-04 | The tray's row anatomy renders nested criteria; no `invoke(` call outside the query layer | unit (React) + gate | `npm --prefix packages/desktop run test -- src/authoring/__tests__/proposal-tray.test.tsx` | ✅ | ✅ green |
| 05-07-02 | 07 | 6 | SHAPE-03, SHAPE-04 | Every verb guarded against a double-dispatch; the amend editor never imports the board's own criteria editor | unit (React) + gate | `npm --prefix packages/desktop run test -- src/authoring/__tests__/proposal-tray.test.tsx` | ✅ | ✅ green |
| 05-07-03 | 07 | 6 | SHAPE-03, SHAPE-04 | The tray's own keyboard region never collides with the board list; the tray and the feed cannot force each other's queries to refetch | unit (React) + full suite | `npm --prefix packages/desktop run test` | ✅ | ✅ green |
| 05-08-01 | 08 | 7 | SHAPE-02, SHAPE-04 | `authoring_proposals_pending` serves the lane's own bounded, project-scoped read; no `JOIN epics` | integration | `cargo test -p core --test authoring_proposal` | ✅ | ✅ green |
| 05-08-02 | 08 | 7 | SHAPE-02, SHAPE-04 | `TriageLane.tsx` renders `IssuesLane`'s sibling shape, reusing `ProposalRow.tsx` verbatim | unit (React) | `npm --prefix packages/desktop run test -- src/board/__tests__/triage-lane.test.tsx` | ✅ | ✅ green |
| 05-08-03 | 08 | 7 | SHAPE-02, SHAPE-04 | A pending proposal survives its run reaching every terminal status, staying pending and acceptable | integration + unit (React) + full suite | `npm --prefix packages/desktop run test` | ✅ | ✅ green |
| 05-09-01 | 09 | 5 | SHAPE-01, SHAPE-05 | `session_summaries` generalised to nullable `task_id`/new `epic_id`; exactly one `INSERT INTO session_summaries` site | integration + gate | `cargo test -p core --test authoring_lifecycle` | ✅ | ✅ green |
| 05-09-02 | 09 | 5 | SHAPE-01, SHAPE-05 | Every terminal path (Stop/Discard/`mark_abandoned`/natural close) leaves a summary | integration | `cargo test -p core --test authoring_lifecycle` | ✅ | ✅ green |
| 05-09-03 | 09 | 5 | SHAPE-01, SHAPE-05 | Cost/tokens written generically; pending proposals never join the blocked/recovery rail; the spawn floor already covers authoring spawns | integration + unit (React) | `cargo test -p core --test authoring_lifecycle` | ✅ | ✅ green |
| 05-10-01 | 10 | 8 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | Reopening an epic threads `epic_id` through `authoring_run_start`→`assemble_epic_context_packet`; a running session routes to it, no second run | integration + unit (React) | `cargo test -p core --test epic_context_packet` / `npm --prefix packages/desktop run test -- src/board/__tests__/reopen-epic.test.tsx` | ✅ | ✅ green |
| 05-10-02 | 10 | 8 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | One test per roadmap success criterion, journeying the whole write path against a real temporary database | integration | `cargo test -p core --test authoring_acceptance` | ✅ | ✅ green |
| 05-10-03 | 10 | 8 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | A live acceptance script joins `run-all.sh`; the ledger matches the evidence | integration (live) + self-test | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` (offline arm) / `node scripts/uat/uat-08-socratic-authoring.mjs` (live arm) | ✅ | ⚠️ offline arm (`--self-test`) green; live arm pending a deliberate human run (plan 05-11 wired the missing permission drain — see `scripts/uat/README.md` Item 8) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — this phase's own Wave 1 (05-01, the
measurement spike) served the role a synthetic Wave 0 usually would: it stood up the transport/
stage-gate spike harnesses and the fixture conventions (`common::seeded_project`, zero-padded
ordinal markers, the `FLYWHEEL_RUNTIME_DIR` scratch-env-lock pattern) every subsequent plan's test
files reused rather than re-deriving.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Whether the challenge stage's live conversational behaviour is genuinely challenging (not agreeable validation) | SHAPE-01 | A live-conversation quality property — no autonomous check can judge "did the agent actually push back", only a human reading a real transcript can | `node scripts/uat/uat-08-socratic-authoring.mjs` against a real repository — the live run now answers startup permission requests automatically (plan 05-11 wired `drainIncidentalPermissionRequests`), so a reviewer who previously hit the 120s timeout should instead reach the two verbatim-reply step lines; read the recorded transcript per its own `<human-check>` instructions (05-11-PLAN.md Task 3) |
| Whether the drafted acceptance criteria were mostly kept or mostly rewritten | SHAPE-03 | A quality judgment about draft usefulness, not a structural property | Same live run (now answers startup permission requests automatically) — the script records the amendment count and the reviewer judges whether the ratio indicates useful drafts |
| The wall-clock comparison against the terminal arm (`05-SPIKE-FINDINGS.md`'s Product Kill Criterion) | SHAPE-01, SHAPE-02 | Requires a human-paced timed comparison against prompting `claude` directly in a terminal — not something a script can fabricate | Same live run (now answers startup permission requests automatically); the comparison arm is defined in `05-SPIKE-FINDINGS.md`'s own `## Product Kill Criterion` section |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-24
