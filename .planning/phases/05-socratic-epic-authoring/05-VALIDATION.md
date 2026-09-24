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
| 05-11-01 | 11 | 1 (gap closure) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | The live arm's own drain loop answers incidental startup permission requests before the timed exchange, wired end to end ahead of the "waiting for the agent" wait | integration (live self-test) + source-order gate | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-11-02 | 11 | 1 (gap closure) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | The drain loop proven offline against a stub sidecar — no child process, no `claude` binary | integration (TDD, offline self-test) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-11-03 | 11 | 1 (gap closure) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | `scripts/uat/README.md` documents Item 8 like items 1-7; `05-VALIDATION.md`'s own 05-10-03 row names both arms | docs + gate | `test "$(grep -c '^### Item 8' scripts/uat/README.md)" = "1"` | ✅ | ✅ green |
| 05-12-01 | 12 | 2 | SHAPE-01, SHAPE-05 | A developer's typed line reaches a live authoring session end to end through a new `authoring_turn_send` command; the composer renders only for a live authoring run | integration + unit (React), TDD | `npm --prefix packages/desktop run test -- src/session/__tests__/authoring-composer.test.tsx` | ✅ | ✅ green |
| 05-12-02 | 12 | 2 | SHAPE-01, SHAPE-05 | Every turn the application sends persists before it emits and renders as exactly one feed row | unit (Rust) + unit (React), TDD | `cargo test -p desktop` | ✅ | ✅ green |
| 05-12-03 | 12 | 2 | SHAPE-01, SHAPE-05 | The backend's own restatement of a turn never doubles a row; typing into the composer never advances the stage | unit (Node) + unit (React), TDD | `npm --prefix packages/sidecar test` | ✅ | ✅ green |
| 05-13-01 | 13 | 2 (gap closure) | SHAPE-01 through SHAPE-05 | The opening prompt carries a stated premise when there is one, and asks for one — never inventing a framing — when there is not; the packet's own purity/determinism contracts unchanged | integration, TDD | `cargo test -p core --test epic_context_packet` | ✅ | ✅ green |
| 05-13-02 | 13 | 2 (gap closure) | SHAPE-01 through SHAPE-05 | A developer states the premise in the launch sheet; the spawned session's opening prompt carries it and the transcript opens with it attributed to the developer, recorded (never relayed twice) | integration (Rust) + unit (React), TDD | `npm --prefix packages/desktop run test -- src/launch-sheet/__tests__/launch-sheet.test.tsx` | ✅ | ✅ green |
| 05-13-03 | 13 | 2 (gap closure) | SHAPE-01 through SHAPE-05 | The in-app arm's two numbers come from a read-only board query with its own tests; the harness's `measure-run` never migrates the real fleet database; the phase's per-task map covers every gap-closure task | integration, TDD | `cargo test -p core --test authoring_measurement` | ✅ | ✅ green |

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

Each row below names the exact command that produces its evidence and the file that evidence
lands in (plan 05-17, closing `05-VERIFICATION.md`'s two `human_needed` entries). The human act
left in every row is reading a file and filling in one verdict line — never transcribing numbers
by hand, never hand-timing anything the instrument can time itself.

| Behavior | Requirement | Why Manual | Command | Evidence File | Human Act |
|----------|-------------|------------|---------|----------------|-----------|
| Whether the challenge stage's live conversational behaviour is genuinely challenging (not agreeable validation) | SHAPE-01 | A live-conversation quality property — no autonomous check can judge "did the agent actually push back", only a human reading a real transcript can | `node scripts/uat/uat-08-socratic-authoring.mjs` | `05-LIVE-CHALLENGE-TRANSCRIPT.md` | Read the two verbatim replies the script writes into the file and fill its challenge-quality verdict line. **Not yet run post-fix:** the prior attempt timed out before plan 05-11's drain fix landed, and no completed run since that fix is recorded anywhere in this phase — this row must not be read as implying a post-fix arm has already run. |
| Whether the drafted acceptance criteria were mostly kept or mostly rewritten | SHAPE-03 | A quality judgment about draft usefulness, not a structural property | `node scripts/uat/uat-08-socratic-authoring.mjs` (the same run as the row above) | `05-LIVE-CHALLENGE-TRANSCRIPT.md` (the same file) | The script prints the drafted and amended criteria counts into the sheet; read them and fill the file's draft-usefulness verdict line. |
| The wall-clock comparison against the terminal arm (`05-SPIKE-FINDINGS.md`'s Product Kill Criterion) | SHAPE-01, SHAPE-02 | Requires a human-paced timed comparison against prompting `claude` directly in a terminal — a scripted terminal arm would measure the script's typing speed, not the developer's | `node scripts/uat/uat-09-product-kill-criterion.mjs --list-runs` to find the run id, then `node scripts/uat/uat-09-product-kill-criterion.mjs --in-app-run <runId> --terminal-project <projectId>` | `05-KILL-CRITERION.md` | Perform the terminal arm at human pace while the instrument times it and reads the board back; the in-app arm's own elapsed span is now **board-derived** (`measure-run`'s `elapsedMinutes`), never hand-timed with a stopwatch as the original protocol described. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-24
