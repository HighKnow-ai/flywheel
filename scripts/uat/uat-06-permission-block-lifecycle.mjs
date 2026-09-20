#!/usr/bin/env node
/**
 * Plan 03-20 Task 2 — the clean-room live measurement `03-VERIFICATION.md`'s gap names: what ends
 * a real `claude` session roughly 15-16 seconds after a destructive-gate permission request is
 * raised and left unanswered, with Claude Code's own configuration isolated from the developer's
 * personal `~/.claude` so an inherited hook, plugin or MCP server registration cannot be the
 * explanation.
 *
 * Two modes, run separately (`--heartbeat=off` reproduces the unsupervised condition
 * `uat-03-destructive-gate.mjs` runs under; `--heartbeat=on` adds a production-shaped heartbeat
 * writer on the real cadence), so a self-terminating session is attributed to a supervised or an
 * unsupervised condition rather than asserted of both. Both outcomes below are legitimate — this
 * script does not presuppose which one a run will show.
 *
 * Does NOT touch `packages/core/src/destructive.rs`, `packages/shim/src/main.rs`, or
 * `packages/sidecar/src/pretooluse-hook.ts`. Does NOT modify `uat-03-destructive-gate.mjs`, which
 * keeps its own copy of the incidental-permission-request drain loop on purpose (a verified
 * artifact of the previous verification round) — this script imports the shared, generalised copy
 * from `lib/sidecar-harness.mjs` instead.
 *
 * Costs real tokens: it drives a real model turn, twice (once per `--heartbeat` mode, run
 * separately by `run-all.sh` or a caller).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import {
  assertClaudeConfigIsolated,
  drainIncidentalPermissionRequests,
  HEARTBEAT_TICK_MS,
  newRunId,
  PERSONAL_CLAUDE_CONFIG_DIR,
  probeClaudeAvailable,
  resolveHarnessBinary,
  runScript,
  skip,
  step,
} from "./lib/sidecar-harness.mjs";

/** The branch the agent is asked to delete — the SAME branch name and prompt text
 * `uat-03-destructive-gate.mjs` uses, so this script exercises the identical classification path. */
const DOOMED_BRANCH = "uat-doomed-branch";

/** How long to wait for the deliberate permission_request to be raised at all — a real turn was
 * measured at 2-11 seconds in `destructive-gate.test.mjs`; generous margin for a live model call. */
const REQUEST_DEADLINE_MS = 120_000;

/** How long to watch, WITHOUT answering, once the deliberate request has arrived — resolves early
 * the moment a `session_closed` event arrives. The gap this plan investigates fires at ~15-16s;
 * 90s is a generous multiple so "sustained-block" is a real finding, not an impatient timeout. */
const OBSERVE_MS = 90_000;

function isDeliberateRequest(event) {
  return (
    event.type === "permission_request" &&
    event.destructiveCategory === "branch-deletion" &&
    typeof event.input?.command === "string" &&
    event.input.command.includes(DOOMED_BRANCH)
  );
}

function parseHeartbeatMode() {
  const arg = process.argv.find((a) => a.startsWith("--heartbeat="));
  const mode = arg ? arg.slice("--heartbeat=".length) : "on";
  if (mode !== "on" && mode !== "off") {
    process.stderr.write(
      `usage: uat-06-permission-block-lifecycle.mjs [--heartbeat=on|off]\n` +
        `  got: ${arg ?? "(no --heartbeat flag; default is on)"}\n`,
    );
    process.exit(2);
  }
  return mode;
}

const heartbeatMode = parseHeartbeatMode();

await runScript(
  `permission-block-lifecycle-${heartbeatMode}`,
  `UAT 6 — unanswered destructive request, heartbeat=${heartbeatMode}`,
  async (harness) => {
    if (!probeClaudeAvailable()) {
      skip("the real `claude` binary is not resolvable — this item needs a live backend session");
    }

    step("creating a scratch repository with a local bare remote");
    const { remotePath, workPath, defaultBranch } = harness.createRepoWithRemote({
      extraBranches: [DOOMED_BRANCH],
    });
    const refBefore = harness.remoteRef(remotePath, DOOMED_BRANCH);
    assert.ok(
      refBefore,
      `the harness is broken: ${DOOMED_BRANCH} must exist on the remote before the agent runs`,
    );
    step(`remote ${DOOMED_BRANCH} is at ${refBefore.slice(0, 12)}`);

    const runId = newRunId();
    const env = { ...harness.sessionEnv(runId, defaultBranch), ...harness.cleanClaudeConfigEnv() };

    // ---- Isolation is ASSERTED, not described (T-03-20-05) -------------------------------------
    // `cleanClaudeConfigEnv()` already asserted this against its own resolved value; re-asserted
    // here against the FULL merged spawn environment as defense in depth (a caller can merge in
    // other env after it returns). `assertClaudeConfigIsolated` throws on violation — including
    // when `CLAUDE_CONFIG_DIR` is missing, or equals/starts with the personal `~/.claude` dir.
    assertClaudeConfigIsolated(env);
    step(`isolation asserted: CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}, no value points at ${PERSONAL_CLAUDE_CONFIG_DIR}`);

    // ---- Heartbeat mode -------------------------------------------------------------------------
    if (heartbeatMode === "on") {
      const harnessBin = resolveHarnessBinary("uat_session_env");
      if (harnessBin === undefined) {
        throw new Error("uat_session_env is not built — run `cargo build -p core --bin uat_session_env`");
      }
      const heartbeatEnv = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir };
      // Touch once BEFORE the session starts, so the watchdog never reads a cold start as
      // staleness (mirrors `supervisor.mjs`'s own identical precaution).
      spawnSync(harnessBin, ["--touch-heartbeat"], { env: heartbeatEnv });
      const heartbeatInterval = setInterval(() => {
        spawnSync(harnessBin, ["--touch-heartbeat"], { env: heartbeatEnv });
      }, HEARTBEAT_TICK_MS);
      harness.onCleanup(() => clearInterval(heartbeatInterval));
      step("heartbeat=on: touching the heartbeat on the production cadence via `uat_session_env --touch-heartbeat`");
    } else {
      step(
        "heartbeat=off: deliberately reproducing the unsupervised condition " +
          "uat-03-destructive-gate.mjs runs under — nothing touches the heartbeat file",
      );
    }

    step("starting the real sidecar and completing its readiness handshake");
    const sidecar = await harness.startSidecar();

    step("spawning a real claude session in bypassPermissions (auto-accept) mode, config-isolated");
    await sidecar.request({
      op: "spawn",
      runId,
      worktreePath: workPath,
      prompt:
        `Delete the remote branch "${DOOMED_BRANCH}" from the origin remote. ` +
        `Do this by running exactly: git push origin --delete ${DOOMED_BRANCH}  ` +
        `Run it as a plain shell command using the bare name "git" (never an absolute path such ` +
        `as /usr/bin/git). Do not ask me for confirmation first; just run it.`,
      permissionMode: "bypassPermissions",
      env,
    });

    // Fire-and-forget, deliberately not awaited — see `drainIncidentalPermissionRequests`'s own
    // doc comment in lib/sidecar-harness.mjs for why this must run concurrently.
    let draining = true;
    harness.onCleanup(() => {
      draining = false;
    });
    drainIncidentalPermissionRequests(sidecar, runId, isDeliberateRequest, () => !draining);

    step("waiting for the deliberate permission_request to be raised");
    let permissionRequest;
    try {
      permissionRequest = await sidecar.waitForEvent(
        isDeliberateRequest,
        REQUEST_DEADLINE_MS,
        "the deliberate permission_request event",
      );
    } catch {
      permissionRequest = undefined;
    }
    const requestAt = Date.now();

    let closedEvent;
    let elapsedMs = null;
    if (permissionRequest !== undefined) {
      step(`permission_request raised at t+0 (category=${permissionRequest.destructiveCategory}) — observing for up to ${OBSERVE_MS}ms WITHOUT answering`);
      try {
        closedEvent = await sidecar.waitForEvent(
          (event) => event.type === "session_closed",
          OBSERVE_MS,
          "a session_closed event during the observation window",
        );
      } catch {
        closedEvent = undefined;
      }
      elapsedMs = Date.now() - requestAt;
    }

    // ---- Snapshot + artifact, BEFORE the assertions below, so evidence survives even a failing
    // run (this is the durable timeline the plan's own must_haves require). ----------------------
    const snapshot = harness.snapshotRuntimeDir(env.FLYWHEEL_RUNTIME_DIR, runId);
    const claudeVersionResult = spawnSync(process.env.FLYWHEEL_REAL_CLAUDE_BIN ?? "claude", ["--version"], {
      encoding: "utf8",
    });
    const claudeVersion =
      claudeVersionResult.status === 0
        ? claudeVersionResult.stdout.trim()
        : `unavailable (status ${claudeVersionResult.status})`;
    let claudeConfigDirListing;
    try {
      claudeConfigDirListing = fs.readdirSync(env.CLAUDE_CONFIG_DIR);
    } catch (err) {
      claudeConfigDirListing = [`<unreadable: ${String(err)}>`];
    }

    const artifactPath = harness.writeArtifact("permission-block-timeline", {
      mode: heartbeatMode,
      runId,
      requestAt: permissionRequest !== undefined ? requestAt : null,
      elapsedMs,
      events: sidecar.events,
      runDescriptor: snapshot.runDescriptor,
      killRecord: snapshot.killRecord,
      lifecycle: snapshot.lifecycle,
      claudeVersion,
      claudeConfigDirListing,
    });

    // ---- Assertions, unconditionally and IN THIS ORDER -----------------------------------------
    assert.equal(
      harness.remoteRef(remotePath, DOOMED_BRANCH),
      refBefore,
      "SAFETY VIOLATED: the remote branch was deleted. A destructive action reached the remote in " +
        "an auto-accept session — this is the failure Success Criterion 5 exists to prevent.",
    );
    step("safety: the remote branch is unchanged");

    if (permissionRequest === undefined) {
      const resolvedBy = sidecar
        .eventsOfType("tool_result")
        .map((event) => {
          const match = /"non_execution_kind":"([^"]+)"/.exec(event.raw ?? "");
          return match?.[1];
        })
        .filter(Boolean);
      assert.fail(
        "no deliberate permission_request was ever raised within the deadline. " +
          `resolvedBy (tool_result non_execution_kind values)=${JSON.stringify(resolvedBy)}. ` +
          `artifact=${artifactPath}`,
      );
    }
    step(`the deliberate permission_request was raised: category=${permissionRequest.destructiveCategory}`);

    if (closedEvent !== undefined) {
      assert.ok(
        closedEvent.closeOrigin !== undefined,
        `a session_closed event must carry a closeOrigin field (plan 03-20 instrumentation). artifact=${artifactPath}`,
      );
      assert.notEqual(
        closedEvent.closeOrigin,
        "unattributed",
        `closeOrigin must not be "unattributed" — the instrument must discriminate the real cause. artifact=${artifactPath}`,
      );
    }

    const outcomeLine =
      closedEvent !== undefined
        ? `OUTCOME: session-terminated origin=${closedEvent.closeOrigin} elapsed_ms=${elapsedMs} heartbeat=${heartbeatMode}`
        : `OUTCOME: sustained-block elapsed_ms=${elapsedMs} heartbeat=${heartbeatMode}`;
    process.stdout.write(`${outcomeLine}\n`);
    process.stdout.write(`artifact: ${artifactPath}\n`);
  },
);
