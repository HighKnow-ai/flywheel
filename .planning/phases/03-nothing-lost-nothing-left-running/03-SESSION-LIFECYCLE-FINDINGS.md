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
