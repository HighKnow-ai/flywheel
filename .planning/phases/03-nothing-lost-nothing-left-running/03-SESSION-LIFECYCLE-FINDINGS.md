# Session Lifecycle Findings — Plan 03-20

Two clean-room live measurements of the scenario `03-VERIFICATION.md`'s gap names: a real `claude`
session, in `bypassPermissions` mode, asked to delete a remote branch, with the resulting
destructive-gate `permission_request` deliberately left unanswered. Claude Code's own configuration
was isolated to `CLAUDE_CONFIG_DIR=/tmp/flywheel-uat-claude-config` (a directory carrying ONLY a
copied `.credentials.json`, staged by a human outside any agent's sandbox — `mcpServers: {}`,
`hooks: {}`, `projects: 0` confirmed against the personal config's 15 projects before these runs).
`assertClaudeConfigIsolated` (`scripts/uat/lib/sidecar-harness.mjs`) asserted, at runtime, that no
value in the resolved spawn environment pointed at the developer's personal `~/.claude`.

## Measured runs

| Mode | Outcome | Origin | Elapsed ms | Effective stale_ms | stale_ms_source | Artifact path |
|------|---------|--------|-----------|---------------------|------------------|---------------|
| off | session-terminated | watchdog-heartbeat-stale | 7397 | 15000 | env | `/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-artifacts/permission-block-lifecycle-off-2026-09-20T09-05-31-410Z-permission-block-timeline.json` |
| on | sustained-block | n/a (no session_closed arrived) | 90001 | 15000 | env | `/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-artifacts/permission-block-lifecycle-on-2026-09-20T09-07-42-220Z-permission-block-timeline.json` |

Both runs used the harness's default stale window (`uat_session_env.rs` unconditionally emits
`FLYWHEEL_HEARTBEAT_STALE_MS`/`HEARTBEAT_STALE_MS` = 15000ms into the per-run spawn env) — neither
run set a non-default override.

## Hypotheses

| ID | Hypothesis | Signal that decides it | Disposition | Evidence |
|----|-----------|-------------------------|--------------|----------|
| H1 | The watchdog's own heartbeat-staleness kill ends the session. | A kill record for the run whose `reason` is `heartbeat-stale`, and a `stale_kill` line in the run's lifecycle file. | CONFIRMED | `off` run: `killRecord.reason` = `"heartbeat-stale"`; lifecycle line 3 has `event: "stale_kill"`, `since_start_ms: 16012`; the terminal `session_closed` carries `closeOrigin: "watchdog-heartbeat-stale"`, `exitSignal: "SIGKILL"`, `exitCode: null` — three independent on-disk/event records agreeing. Artifact: `.../permission-block-lifecycle-off-2026-09-20T09-05-31-410Z-permission-block-timeline.json`. **H1a** (whether plan 03-19's `FLYWHEEL_HEARTBEAT_STALE_MS=120000` override ever reached the watchdog at all): NOT directly retested in this plan — neither of the two runs above set a non-default override value, so this investigation cannot confirm or falsify 03-19's specific 120000ms scenario. What it DOES show: both runs recorded `stale_ms_source: "env"` (never `"default"`), meaning the watchdog reliably read whatever value the per-run spawn environment supplied (here, the harness's own 15000ms constant) — there is no instance in this investigation of the override-clobbering failure mode H1a proposed. Per 03-21's own Branch B text, the `stale_ms_source` field this plan added is the durable, direct-observation fix for the question 03-19 could previously only infer. |
| H2 | The `claude` CLI ends the session itself (e.g. an internal limit on a Bash tool call producing no output). | A `backend_exit` lifecycle line carrying a code or signal, with NO preceding `stale_kill` line and NO kill record for the run. | FALSIFIED | Neither run's lifecycle file contains a `backend_exit` line at all — in the `off` run, the watchdog's own group-wide `SIGKILL` (sent to itself as the group leader) ends the watchdog process before its own `child.on("exit")` handler for the backend gets to run, so `stale_kill` is the file's last line; the `on` run reached the full 90000ms window with no lifecycle event beyond `backend_spawned`. No claude-internal termination of the backend occurred in either measured run. |
| H3 | The supervisor (the sidecar or the adapter) signals the session's process group. | A `closeOrigin` of `supervisor-signal`, or a `signal_forwarded` lifecycle line, or a `session_closed` whose `reason` is `interrupted`. | FALSIFIED | Neither lifecycle file contains a `signal_forwarded` line. The one `session_closed` observed (`off` run) reports `reason: "failed"` and `closeOrigin: "watchdog-heartbeat-stale"` — never `"interrupted"`/`"supervisor-signal"`. Neither script ever called `interruptSession`/`killSession`. |
| H4 | The `claude` Bash tool's own per-call timeout kills the blocked `git` subprocess without ending the session. | The deliberate tool call settling with a timeout-shaped `tool_result` while NO `session_closed` event arrives, and the session surviving past `elapsedMs`. | FALSIFIED | Neither run shows a `tool_result` event for the deliberate `git push origin --delete uat-doomed-branch` call. In the `off` run a `session_closed` DID arrive, directly violating H4's own "no session_closed" precondition. In the `on` run the call never settled at all: the real CLI's own `tool_progress` heartbeat telemetry for that exact `tool_use_id` (`elapsed_time_seconds: 30, 60, 90`) shows it still genuinely pending at t+90000ms — not resolved by any internal per-call ceiling. |

## Disposition

**Disposition:** root-cause-identified

This disposition rests on H1, confirmed directly against the `--heartbeat=off` run: a real, on-disk
kill record naming `reason: "heartbeat-stale"` and a `stale_kill` lifecycle line
(`since_start_ms: 16012`) both independently corroborate the terminal `session_closed` event's own
`closeOrigin: "watchdog-heartbeat-stale"` — the single strongest piece of evidence is that all three
independent records (kill record, lifecycle timeline, terminal event) agree with each other. The
identical scenario, run with a production-shaped heartbeat writer (`--heartbeat=on`), sustained the
block for the full 90-second observation window with zero kill record, zero `stale_kill` line and
zero `session_closed` event: the watchdog reaped the `off` session precisely because nothing was
touching the heartbeat file, exactly as it is designed to (D-47/D-48, PROC-04), and exactly the
condition `uat-03-destructive-gate.mjs`'s own harness (which never touches the heartbeat file) has
always run under. Flywheel's own always-live Rust-core heartbeat thread means a real, running
application does not put a session into the unsupervised condition this gap's five prior
measurements were made under.

**Instruction for 03-21:**
- Take **Branch B** (disposition `root-cause-identified` with H1 CONFIRMED — "the watchdog's own
  heartbeat-staleness kill... the product is correct; the measurement was unsupervised"): land the
  harness correction only (default `uat-06-permission-block-lifecycle.mjs` to `--heartbeat=on`,
  document the stale-window hazard in `sidecar-harness.mjs`'s `startSidecar` doc comment). Do not
  touch `watchdog.ts`'s stale-kill condition — `must_haves.prohibitions` forbids suppressing,
  extending or conditioning it on a pending permission request.

## What this does not claim

- Whether this reproduces (or fails to reproduce) inside a packaged `.app` rather than under this
  script harness — both runs drove the dev-mode sidecar bundle (`packages/sidecar/dist/index.js`)
  directly via `scripts/uat/`, never the compiled Tauri binary's own `spawn_sidecar` path.
- Whether this reproduces on a machine other than this one — one developer machine, one measurement
  per condition, per the plan's own cost constraint.
- Whether the ~15-16s watchdog timing (or its absence under `--heartbeat=on`) is specific to this
  `claude` version. Both artifacts record `claudeVersion: "2.1.267 (Claude Code)"` — a different CLI
  version's own internal behaviour around a long-blocked Bash tool call (visible here via its
  `tool_progress` heartbeat telemetry) was not tested.
- H1a's specific claim, that plan 03-19's `FLYWHEEL_HEARTBEAT_STALE_MS=120000` override never
  reached the watchdog, was not directly retested with a non-default override value in this plan's
  own two runs (see H1's row above for what was and was not observed).
- Whether the measured 7397ms elapsed-from-request figure in the `off` run is representative of
  every run — it depends on how long the agent's own internal git housekeeping (nine incidental,
  auto-allowed `permission_request`s were observed before the deliberate one in both runs) takes
  before the deliberate command is even attempted, which is itself turn-to-turn variable.

## Acceptance run

Plan 03-21, Task 1: `scripts/uat/uat-06-permission-block-lifecycle.mjs` gained `--answer-after=<ms>`
and `--decision=deny|allow` — an acceptance-mode path that holds the deliberate `permission_request`
unanswered for exactly `--answer-after` ms (via `sidecar.assertNoEvent`, the only shape that can
express "stayed blocked"), then delivers the decision and asserts it was honoured.

Live run (`FLYWHEEL_UAT_CLAUDE_CONFIG_DIR=/tmp/flywheel-uat-claude-config`,
`claude 2.1.267 (Claude Code)`, `--heartbeat=on --answer-after=60000 --decision=deny`):

```
OUTCOME: answered-after-60000ms decision=deny honoured=true heartbeat=on
```

The request stayed genuinely unanswered for the full 60000ms window (`assertNoEvent` passed — no
`session_closed` arrived), the session closed 4755ms after the deny was delivered
(`closedAfterAnswerMs: 4755`, `closeOrigin: backend-exit`), the remote `uat-doomed-branch` ref was
unchanged before and after, and the agent's own output matched the same explanation regex
`uat-03-destructive-gate.mjs` uses (a worded refusal, not a bare exit code). Re-run a second time
after Task 2's harness-only change landed, with an identical result
(`closedAfterAnswerMs: 3836`, decision honoured) — the answer-honouring path does not depend on
which branch Task 2 took.

The pre-existing measurement-mode regression guard (`--heartbeat=on`, no `--answer-after`) was
re-run alongside and still prints its original `OUTCOME: sustained-block elapsed_ms=90000
heartbeat=on` line unchanged, confirming the acceptance-mode addition did not disturb the
measurement path plan 03-20 built.

This closes the half of Success Criterion 5 `03-VERIFICATION.md` left open: the session does stay
blocked for at least 60 seconds with a destructive request pending, and an answer delivered at the
end of that window is honoured end to end.

**Backstop truth (D-58 latency ceiling):** not separately probed by this plan. Both acceptance runs
closed within ~4-5 seconds of the answer being delivered (well inside the 60000ms window this plan
measured), and the prior `--heartbeat=on` measurement-mode run already established a 90-second
sustained block with zero termination artifacts. No run in this plan or 03-20 observed the backend
impose its own ceiling on a blocked tool call — `claude 2.1.267` tolerated a 90-second-plus hold in
every measured case. A dedicated probe of the backend's own maximum tolerable latency (if any)
remains unmeasured and is not claimed here.

## Source change

**Branch B** was taken, selected by this document's own `**Disposition:** root-cause-identified`
token (H1 CONFIRMED — the watchdog's own heartbeat-staleness kill).

No change was made to `packages/sidecar/src/watchdog.ts`'s stale-kill condition, per
`must_haves.prohibitions`. The only source change is a documentation addition: `startSidecar`'s doc
comment in `scripts/uat/lib/sidecar-harness.mjs` now names the stale-window hazard explicitly, so a
future caller measuring a long-lived session knows it must run a heartbeat writer or the watchdog
will (correctly) reap it. `uat-06-permission-block-lifecycle.mjs`'s own `--heartbeat` flag already
defaulted to `"on"` before this plan (`parseHeartbeatMode`'s existing fallback) — no code change was
needed there.

Evidence this was the correct branch: the two 03-20 measured outcomes (`--heartbeat=off`:
`closeOrigin: watchdog-heartbeat-stale` at `elapsed_ms=7397`; `--heartbeat=on`: sustained block for
the full 90s window, zero termination artifacts) plus this plan's own Task 1 acceptance runs (both
`honoured=true` under `--heartbeat=on`) are consistent with "the product is correct, a supervised
session survives" and inconsistent with any hypothesis requiring a source fix.

AGNT-07 is now supportable as **Complete**: the request-raising half was already verified closed by
`03-14`/`03-19`, and this plan closes the sustained-block-and-honoured-answer half with a repeatable,
machine-readable acceptance command (`uat-06 --answer-after=60000 --decision=deny`). PROC-04 is
reinforced, not just preserved: Task 3's three new regression-guard tests
(`close-provenance.test.mjs`, 6 -> 9 cases) prove directly that a pending permission request never
suppresses, extends or conditions the watchdog's stale-kill, that a session ending while a request is
pending still closes exactly once with its socket cleaned up, and that answering a `requestId` twice
settles it once.
