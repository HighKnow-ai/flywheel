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
| 05-18-01 | 18 | 1 (gap closure) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04 | A board read raised on the wire is answered from the real scratch board through the same dispatch the desktop app calls | integration (offline, tracer) | `node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check` | ✅ | ✅ green |
| 05-18-02 | 18 | 1 (gap closure) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04 | The dispatch's own scope, ceiling and unknown-kind edges | integration (TDD) | `cargo test -p core --test authoring_board_read` | ✅ | ✅ green |
| 05-18-03 | 18 | 1 (gap closure) | SHAPE-01 | An unanswered held request is a named harness failure, and a third held kind breaks a check | integration (offline self-test) + invariant gate | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-19-01 | 19 | 2 (gap closure) | SHAPE-01, SHAPE-05 | The finding is generalised in the UAT README and the ledger names a command per task | docs + gate | `test "$(grep -c 'board-read-check' scripts/uat/README.md)" -ge "1"` | ✅ | ✅ green |
| 05-19-02 | 19 | 2 (gap closure) | SHAPE-01, SHAPE-05 | The live arm completes and a human fills both verdict lines | manual (live) | `node scripts/uat/uat-08-socratic-authoring.mjs` | ✅ | ⬜ pending — live run not yet executed by this plan's Task 2 |
| 05-20-01 | 20 | 1 (gap closure G-05-2) | SHAPE-01, SHAPE-03 | A scripted multi-block agent turn (fake backend, real watchdog, real shipped normaliser) is captured whole through the real sidecar via `waitForTurn`, for zero tokens | integration (offline replay) | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` | ✅ | ✅ green |
| 05-20-02 | 20 | 1 (gap closure G-05-2) | SHAPE-01 | The turn boundary's own edges (cursor exclusion, in-order accumulation across an interleaved tool call, foreign-run-id exclusion, `backend_echo` exclusion, result-vs-idle end markers, deadline rejection naming captured chunk/char counts) each fail offline if the edge moves | unit (offline self-test, TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-20-03 | 20 | 1 (gap closure G-05-2) | SHAPE-01, SHAPE-03 | The evidence sheet records the whole conversation verbatim under one ordered heading with its own capture-integrity table, and cannot be mistaken for a live transcript when produced by the synthetic stand-in | unit (offline self-test) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-21-01 | 21 | 2 (gap closure G-05-2) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04 | The harness answers what the agent actually asked, composed only from a fixed answer bank (never the agent's own words), and calls `advance-stage` exactly once, only after the driver returns | unit (offline self-test) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-21-02 | 21 | 2 (gap closure G-05-2) | SHAPE-01 | Both conversational shapes — settling after answers, and running out of depth with an explicit, reported closing turn — proven offline against the REAL `driveChallengeConversation` | integration (offline replay, TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check` | ✅ | ✅ green |
| 05-21-03 | 21 | 2 (gap closure G-05-2) | SHAPE-01 | `readNoWorkPlanned` reads the field `ToolCallEvent` actually declares (`toolName`, pinned against `adapter.ts`), returns a three-valued reading (refused/unproven/violated), and fails a scenario where work is staged mid-challenge with no refusal | unit (offline self-test, TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-22-01 | 22 | 3 (gap closure G-05-2) | SHAPE-01, SHAPE-03, SHAPE-05 | `scripts/uat/README.md` Item 8 documents all four arms and the third (`G-05-2`) finding and rule; this ledger carries a row for every task in this closure | docs + gate | `test "$(grep -c '^### Item 8' scripts/uat/README.md)" = "1"` | ✅ | ✅ green |
| 05-22-02 | 22 | 3 (gap closure G-05-2) | SHAPE-01 | The credential-spend decision is gated `blocking-human`, so it is never auto-answered in any mode, including auto-mode | structural (gate config) | `grep -q 'gate="blocking-human"' .planning/phases/05-socratic-epic-authoring/05-22-PLAN.md` | ✅ | ✅ green — checkpoint gate confirmed `blocking-human`; the developer's answer, verbatim, was "Authorise one run" — Task 3 took Branch B |
| 05-22-03 | 22 | 3 (gap closure G-05-2) | SHAPE-01 | The developer's decision is executed and the outcome — decline, or one authorised live run — is recorded honestly, claiming no run that did not happen | integration (offline self-test regression) + manual (live, conditional on branch B) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ❌ red — Branch B taken, one live run executed (run `01M399FP80B184QM2RXTXJDZTK`, 2026-09-24T08:48:54.481Z) and it FAILED: no `proposal_created` event arrived within the 120s deadline. Root cause visible in the captured transcript's turn 3 — Anthropic's own safety classifier (`reasoning_extraction`) refused the distillation-instruction turn ("Opus 5 (1M context)'s safeguards flagged this message"), and the harness captured that API error text as if it were ordinary agent content (chars=432, endedBy=result) rather than surfacing it as a distinct error condition. This is a FOURTH, NEW failure mechanism — it is none of this wave's three self-naming classes (not a starved held request per plan 05-18; not a turn-capture timeout per plan 05-20, since the turn ended cleanly on `result`, not a deadline rejection; not a noWorkPlanned refused/unproven/violated misread per plan 05-21, since `unproven` is the objectively correct reading — no propose attempt was ever observed because the model's real turn never happened). Per this task's own instruction, NOT re-run; belongs in a fresh gap, not a patch here. `--self-test`/`--board-read-check`/`--replay-check` all still exit 0 — the instrument itself did not regress. No verdict line was filled; no other row was turned green on the strength of this run. **Closed in plan `05-24`**: `readBackendRefusal` (`scripts/uat/lib/sidecar-harness.mjs`) now names this exact failure class the instant it appears and stops the run there instead of waiting out the proposal deadline, proven offline by the `backend-refuses-mid-conversation` `--replay-check` scenario. This row's status stays red — the run it describes did fail, and rewriting it would erase the only record of the fourth failure class being found the expensive way. |
| 05-23-01 | 23 | 1 (gap closure G-05-3) | SHAPE-01 | The bounded gating window reports a genuine pass when work is legitimately proposed after the stage advances, while the OLD unscoped reading over the same run still reads `violated` — the CR-01 reproduction | integration (offline replay, tracer) | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario proposes-work-after-advance` | ✅ | ✅ green |
| 05-23-02 | 23 | 1 (gap closure G-05-3) | SHAPE-01 | A refused first `propose_*` attempt can no longer launder an unrefused second one into a false `"refused"` reading — each attempt is correlated with its own answer | unit (offline self-test, TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-23-03 | 23 | 1 (gap closure G-05-3) | SHAPE-02 | Three non-blocking `05-REVIEW.md` findings (WR-03 dead guard, IN-01 skip-conflated-with-failure, IN-02 unnamed timing constant) cleared with no behavioral change | docs + gate | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-24-01 | 24 | 2 (gap closure G-05-3) | SHAPE-01 | A backend-level Anthropic safety-classifier refusal is a named, self-describing failure class that stops the run where it happens instead of quietly waiting out the proposal deadline | integration (offline replay, tracer/TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario backend-refuses-mid-conversation` | ✅ | ✅ green |
| 05-24-02 | 24 | 2 (gap closure G-05-3) | SHAPE-03 | The transcript records the conversation exactly once — one shared `buildEvidenceExchanges` assembly path closes NF-01, the live body's own accidental duplicate first-turn capture | unit (offline self-test, TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --self-test` | ✅ | ✅ green |
| 05-25-01 | 25 | 3 (gap closure G-05-3) | SHAPE-01 | A turn paused mid-flight on an outstanding tool call is captured WHOLE, ending on the backend's own result marker rather than the idle marker — closing WR-04 | integration (offline replay, tracer/TDD) | `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario slow-tool-mid-turn` | ✅ | ✅ green |
| 05-25-02 | 25 | 3 (gap closure G-05-3) | SHAPE-01 | The live arm states its own permitted mid-turn pause (`LIVE_TURN_IDLE_MS`, 30s) at each of its two remaining capture sites rather than silently inheriting the 5s test default | unit (offline, runtime export check) | `node -e 'import("./scripts/uat/lib/sidecar-harness.mjs").then(m=>{if(typeof m.LIVE_TURN_IDLE_MS!=="number"\|\|!(m.LIVE_TURN_IDLE_MS>m.TURN_IDLE_MS))process.exit(1)})'` | ✅ | ✅ green |
| 05-26-01 | 26 | 4 (gap closure G-05-3) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | The fourth finding (`G-05-3`) and the sharpened offline-provability rule are recorded in `scripts/uat/README.md` Item 8, naming all seven `--replay-check` scenarios; no instrument code is touched by this documentation task | docs + gate | `git diff --quiet -- scripts/uat/lib scripts/uat/uat-08-socratic-authoring.mjs` | ✅ | ✅ green |
| 05-26-02 | 26 | 4 (gap closure G-05-3) | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 | The ledger carries a row for every task in this closure and no todo was filed for an already-closed defect — `.planning/todos/pending/` still holds exactly the one pre-existing, unrelated file | docs + gate | `test "$(ls -1 .planning/todos/pending/ \| wc -l \| tr -d ' ')" = "1"` | ✅ | ✅ green |

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
| Whether the challenge stage's live conversational behaviour is genuinely challenging (not agreeable validation) | SHAPE-01 | A live-conversation quality property — no autonomous check can judge "did the agent actually push back", only a human reading a real transcript can | `node scripts/uat/uat-08-socratic-authoring.mjs` | `05-LIVE-CHALLENGE-TRANSCRIPT.md` | Read the whole conversation the script now writes into the file — every turn, in order, not two sampled chunks — and fill its challenge-quality verdict line. **All known instrument defects behind gaps `G-05-2` and `G-05-3` are now closed and proven offline:** the gating reading is bounded at the challenge/decompose stage boundary and proven to report a genuine PASS on the successful path, not just a genuine fail (plan 05-23, closing CR-01/WR-01/WR-02); a backend-level safety-classifier refusal is a named failure class that stops the run where it happens instead of quietly waiting out the proposal deadline (plan 05-24); the transcript records each turn exactly once, never duplicated (plan 05-24, closing NF-01); and a mid-turn tool pause no longer truncates the capture (plan 05-25, closing WR-04). **What has NOT changed:** no completed post-fix live run exists anywhere in this phase as of this row's own writing — this closure (plans 05-23 through 05-26) deliberately spent no credentials, by design; both verdict lines in `05-LIVE-CHALLENGE-TRANSCRIPT.md` are still unfilled, and no ledger row above was turned green on the strength of a run that did not happen. Whether a live run happens at all remains the developer's own decision, never a precondition for the structural work above. |
| Whether the drafted acceptance criteria were mostly kept or mostly rewritten | SHAPE-03 | A quality judgment about draft usefulness, not a structural property | `node scripts/uat/uat-08-socratic-authoring.mjs` (the same run as the row above) | `05-LIVE-CHALLENGE-TRANSCRIPT.md` (the same file) | The script prints the drafted and amended criteria counts into the sheet; read them and fill the file's draft-usefulness verdict line. The instrument's capture, conversation-depth, gating-window, backend-refusal and idle-truncation defects (gaps `G-05-2` and `G-05-3`, plans 05-20/05-21/05-23/05-24/05-25) are all fixed and proven offline — the same caveat as the row above applies: no completed post-fix live run is recorded here yet, no credential has been spent, and the verdict line remains unfilled. |
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
