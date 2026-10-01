#!/usr/bin/env node
/**
 * D-105 — the harness's own supervision gate. ZERO TOKENS, no `claude` binary required.
 *
 * WHY THIS EXISTS. `uat-03-destructive-gate.mjs` spent real credentials to report
 * "the session must not close while a destructive permission request is unanswered", and the real
 * cause was that uat-03 never touched the heartbeat file: `watchdog.ts` SIGKILLed its whole process
 * group as an unsupervised orphan at spawn+16.046s, 7.084s into uat-03's own 8000ms
 * `assertNoEvent` window. Measured in
 * `permission-block-lifecycle-off-2026-10-01T04-02-59-058Z-permission-block-timeline.json`:
 * `closeOrigin: "watchdog-heartbeat-stale"`, `heartbeat_age_ms: null`, `since_start_ms: 16014`.
 * The item asserted a property its own environment could not sustain.
 *
 * WHY IT IS A GATE AND NOT A PATCH. The writer was hand-rolled in five of the seven items that call
 * `harness.sessionEnv`, and absent from two (uat-03 and uat-05). Restoring it per-script would have
 * been the ninth round of that shape. `sessionEnv` now runs it by default, and THIS script is what
 * keeps that true — it asserts the general property rather than the uat-03 instance:
 *
 *   PROPERTY S1 (supervised, the fix). A session resolved through `sessionEnv`'s DEFAULT survives an
 *   `assertNoEvent` window that extends past the watchdog's staleness deadline. This is exactly the
 *   shape uat-03 and uat-05 need, and it FAILS if the heartbeat writer is ever removed from the
 *   harness or stops being the default.
 *
 *   PROPERTY S2 (unsupervised, the teeth). A session that explicitly opts out
 *   (`{ heartbeat: "off" }`) is STILL reaped, on time, with `closeOrigin: "watchdog-heartbeat-stale"`.
 *   Without this, "make everything supervised" could silently defang `uat-01-supervisor-kill.sh` and
 *   `uat-06 --heartbeat=off`, whose whole subject is the watchdog firing. S1 without S2 is a green
 *   row that cannot go red.
 *
 *   PROPERTY S3 (the loud failure). An item whose `assertNoEvent` window does not FIT the remaining
 *   watchdog budget fails immediately, deterministically, naming itself an instrument defect —
 *   instead of sleeping through the window and then reporting whichever verdict the race happened to
 *   produce. This is the half that stops the next round: a mis-specified item can no longer pass by
 *   luck on a fast model turn, which is how this class of defect stays invisible.
 *
 * WHAT MAKES IT FREE. The backend leaf is `lib/long-lived-backend.mjs`, the same stub
 * `uat-01-supervisor-kill.sh` uses, for the same measured reason: the real binary will not stay alive
 * across the stale window on demand, so a test built on it would be timing the model rather than the
 * watchdog. Everything above the leaf is the real product — real sidecar, real ClaudeCodeAdapter,
 * real watchdog wrapper, real process group, real runtime protocol on disk, real `Harness`. Nothing
 * about supervision depends on which binary sits at the leaf, so nothing is weakened by stubbing it.
 *
 * Two arms, run separately (same convention as `uat-06`'s `--heartbeat`), because each needs its own
 * `Harness` and leaves its own artifact:
 *
 *   --mode=supervised     asserts S1
 *   --mode=unsupervised   asserts S3 then S2
 *
 * Runtime is ~20s per arm: the stale window is deliberately the production 15000ms rather than a
 * shortened one, because a window chosen to make a test fast is the same mistake as a window chosen
 * to fit a budget.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { heartbeatStaleMs, newRunId, runScript, step } from "./lib/sidecar-harness.mjs";

const LONG_LIVED_BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), "lib", "long-lived-backend.mjs");

/** How long after spawn the arms wait before opening their window — a stand-in for the real model
 * turn uat-03 waits through before it reaches its own assertion. The measured value was 8.962s; 6s
 * is shorter, which makes S1 STRICTER: a shorter lead means a longer window is needed to straddle the
 * deadline, and S1 asks for one. */
const SIMULATED_TURN_MS = 6_000;

function parseMode() {
  const flag = process.argv.slice(2).find((arg) => arg.startsWith("--mode="));
  const mode = flag?.slice("--mode=".length);
  if (mode !== "supervised" && mode !== "unsupervised") {
    process.stderr.write("usage: --mode=supervised|unsupervised\n");
    process.exit(2);
  }
  return mode;
}

const mode = parseMode();
const staleMs = heartbeatStaleMs();

await runScript(
  `harness-supervision-${mode}`,
  `Harness supervision gate — ${mode} (D-105, zero tokens)`,
  async (harness) => {
    step("creating a scratch repository");
    const { workPath, defaultBranch } = harness.createRepoWithRemote();

    const runId = newRunId();
    // THE LINE UNDER TEST. The supervised arm passes no options at all — it asserts that the DEFAULT
    // is the safe one, which is the whole fix. Writing `{ heartbeat: "sustain" }` here would make
    // this gate pass even if the default were flipped back to unsupervised.
    const env =
      mode === "supervised"
        ? harness.sessionEnv(runId, defaultBranch)
        : harness.sessionEnv(runId, defaultBranch, { heartbeat: "off" });

    step("starting the real sidecar with the long-lived stub at the backend leaf");
    const sidecar = await harness.startSidecar({ env: { FLYWHEEL_CLAUDE_BIN: LONG_LIVED_BACKEND } });

    const spawnedAt = Date.now();
    await sidecar.request({
      op: "spawn",
      runId,
      worktreePath: workPath,
      prompt: "stay alive (the stub ignores this)",
      permissionMode: "bypassPermissions",
      env,
    });
    step(`session spawned; stale window is ${staleMs}ms`);

    if (mode === "unsupervised") {
      // ---- PROPERTY S3 — the loud failure, asserted BEFORE the watchdog gets a chance to fire ----
      // A 10x-the-budget window must be refused on the arithmetic, instantly. The elapsed-time check
      // is the load-bearing half: a check that merely threw would be indistinguishable from
      // assertNoEvent sleeping the whole window and then failing, which is the behaviour being
      // replaced.
      const askedForMs = staleMs * 10;
      const startedAt = Date.now();
      await assert.rejects(
        () => sidecar.assertNoEvent((event) => event.type === "session_closed", askedForMs, "a window that cannot fit"),
        (err) => {
          assert.match(
            err.message,
            /INSTRUMENT DEFECT/,
            `a window of ${askedForMs}ms against a ${staleMs}ms budget must be refused as an ` +
              `instrument defect, not slept through. Got: ${err.message}`,
          );
          assert.match(err.message, /Fix the ENVIRONMENT, never the assertion/);
          return true;
        },
      );
      const refusedAfterMs = Date.now() - startedAt;
      assert.ok(
        refusedAfterMs < 1_000,
        `the refusal must be immediate arithmetic, not a slept window — took ${refusedAfterMs}ms ` +
          `for a ${askedForMs}ms request`,
      );
      step(`PROPERTY S3 — an unfittable window was refused in ${refusedAfterMs}ms, before being attempted`);

      // ---- PROPERTY S2 — the opt-out still has teeth -------------------------------------------
      const closed = await sidecar.waitForEvent(
        (event) => event.type === "session_closed",
        staleMs * 2 + 10_000,
        "the watchdog's stale kill",
      );
      const closedAfterMs = Date.now() - spawnedAt;
      assert.equal(
        closed.closeOrigin,
        "watchdog-heartbeat-stale",
        "an unsupervised session must be reaped BY THE WATCHDOG, not die some other way — otherwise " +
          "uat-01 and uat-06 --heartbeat=off are measuring something else. " +
          `Got closeOrigin=${JSON.stringify(closed.closeOrigin)} reason=${JSON.stringify(closed.reason)}`,
      );
      // The band is the stale window plus up to one poll interval (2s), plus slack for process
      // startup and event delivery. Asserted so a watchdog that fired for an unrelated reason, or
      // far too early, cannot be read as this property holding.
      assert.ok(
        closedAfterMs >= staleMs && closedAfterMs <= staleMs + 10_000,
        `the reap must land in the ${staleMs}-${staleMs + 10_000}ms band from spawn (stale window ` +
          `plus one ${2_000}ms poll plus slack) — got ${closedAfterMs}ms`,
      );
      step(`PROPERTY S2 — reaped at spawn+${closedAfterMs}ms with closeOrigin=${closed.closeOrigin}`);
      return;
    }

    // ---- PROPERTY S1 — the fix ------------------------------------------------------------------
    // Shaped exactly like uat-03: wait out a turn, THEN open a window. The window is chosen so it
    // provably straddles the deadline an unsupervised session would hit, which is what makes this
    // arm fail if the writer is ever removed.
    await new Promise((resolve) => setTimeout(resolve, SIMULATED_TURN_MS));
    const elapsedMs = Date.now() - spawnedAt;
    const windowMs = staleMs - elapsedMs + 5_000;
    assert.ok(
      windowMs > 0 && elapsedMs + windowMs > staleMs,
      `this gate is broken: the window must extend past the ${staleMs}ms deadline to test anything ` +
        `(elapsed ${elapsedMs}ms + window ${windowMs}ms)`,
    );
    step(
      `opening a ${windowMs}ms window ${elapsedMs}ms into the session — it ends at spawn+` +
        `${elapsedMs + windowMs}ms, past the ${staleMs}ms deadline an unsupervised session would hit`,
    );
    await sidecar.assertNoEvent(
      (event) => event.type === "session_closed",
      windowMs,
      "a session supervised by sessionEnv's DEFAULT must outlive the watchdog's staleness window — " +
        "if this failed with closeOrigin watchdog-heartbeat-stale, the harness stopped sustaining " +
        "the heartbeat and every live UAT item that asserts past the stale window is now racing",
    );
    step(`PROPERTY S1 — the session was still alive at spawn+${Date.now() - spawnedAt}ms`);
  },
);
