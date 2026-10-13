/**
 * D-88 (plan 05-03): the authoring stage gate. A standalone Node entry point invoked per matched
 * `PreToolUse` call — `writeHookSettings`'s second `PreToolUse` entry
 * (`claude-code-adapter.ts`), matching `mcp__flywheel-permissions__(propose|amend|delete)_.*`.
 * Structurally mirrors `pretooluse-hook.ts`: reads the hook payload from stdin (fully drained
 * before deciding, matching that file's own `readStdin` discipline), resolves THIS session's own
 * `FLYWHEEL_RUN_ID`/`FLYWHEEL_RUNTIME_DIR` from its own environment — never from the hook payload,
 * which is model-adjacent data a spoofed `runId` inside it must never be trusted to name another
 * run's stage (T-05-03-02) — reads `<runtimeDir>/stage/<runId>.json` FRESH per call (no cache: a
 * socket-free file read is what keeps this check live without a poll loop), and decides:
 *
 * - stage is `decompose`/`criteria` -> print no opinion, exit 0 (the call proceeds to the MCP
 *   handler — matching this call is never the same thing as denying it).
 * - stage is `challenge` -> deny, naming the stage and what to do instead: keep challenging, and
 *   recommend advancing once the framing feels settled — the developer holds the advance gate.
 *   Written against `05-SPIKE-FINDINGS.md`'s own quoted model response ("still in the challenge
 *   stage — no proposals yet").
 * - the marker is absent, unreadable, carries an unrecognised stage, or `FLYWHEEL_RUN_ID`/
 *   `FLYWHEEL_RUNTIME_DIR` is unset -> FAIL CLOSED: deny, exactly like
 *   `pretooluse-hook.ts::failClosed`'s own shape and exit code. A gate that cannot establish the
 *   stage must never conclude the stage is permissive (T-05-03-06's accepted DoS — loud and
 *   recoverable, never a silent bypass).
 *
 * The existing `matcher: "Bash"` `PreToolUse` entry (the destructive-command gate,
 * `pretooluse-hook.ts`) stays byte-identical alongside this one — `writeHookSettings` adds this as
 * a SECOND entry, never a replacement.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The measured, wired decision value — mirrors `pretooluse-hook.ts`'s own single named constant,
 * so a future re-measurement changes exactly one line in each file. */
const WIRED_DECISION = "deny" as const;

function printDecision(decision: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(decision));
}

/** Fail closed: print the destructive decision, naming why this hook could not confirm the stage
 * allows this call, and exit non-zero — the same shape `pretooluse-hook.ts::failClosed` prints. */
function failClosed(reason: string): never {
  printDecision({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: WIRED_DECISION,
      permissionDecisionReason: `Flywheel could not verify the authoring stage allows this call (${reason}) — refusing it.`,
    },
  });
  process.exit(2);
}

/** Deny for the `challenge` stage — the reason string is written against `05-SPIKE-FINDINGS.md`'s
 * own quoted model response ("still in the challenge stage — no proposals yet"), extended with
 * what the model should do instead and who holds the advance gate (D-90). */
function denyForChallengeStage(): never {
  printDecision({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: WIRED_DECISION,
      permissionDecisionReason:
        "still in the challenge stage — no proposals yet. Keep challenging the framing; recommend " +
        "advancing once you believe it is settled, but only the developer can advance the stage.",
    },
  });
  process.exit(2);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.resume();
  });
}

async function main(): Promise<void> {
  // Drained fully before any decision, mirroring pretooluse-hook.ts's own readStdin discipline —
  // never parsed for a run id (T-05-03-02): this hook's decision is driven entirely by its OWN
  // environment and the marker file that environment names, never by anything the payload claims.
  await readStdin();

  const runId = process.env.FLYWHEEL_RUN_ID;
  if (!runId) {
    failClosed("FLYWHEEL_RUN_ID is not set");
  }

  const runtimeDir = process.env.FLYWHEEL_RUNTIME_DIR;
  if (!runtimeDir) {
    failClosed("FLYWHEEL_RUNTIME_DIR is not set");
  }

  let raw: string;
  try {
    raw = readFileSync(join(runtimeDir, "stage", `${runId}.json`), "utf8");
  } catch {
    failClosed("no authoring stage marker could be read for this run");
  }

  let marker: { stage?: unknown };
  try {
    marker = JSON.parse(raw);
  } catch {
    failClosed("the authoring stage marker did not parse as JSON");
  }

  const stage = marker.stage;
  if (stage === "decompose" || stage === "criteria") {
    printDecision({});
    process.exit(0);
  }
  if (stage === "challenge") {
    denyForChallengeStage();
  }

  failClosed(`the authoring stage marker carried an unrecognised stage (${JSON.stringify(stage)})`);
}

main();
