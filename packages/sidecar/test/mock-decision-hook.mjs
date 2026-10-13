#!/usr/bin/env node
/**
 * A measurement-only `PreToolUse` hook fixture (plan 03-07, `destructive-gate.test.mjs`) —
 * DISTINCT from the shipped `src/pretooluse-hook.ts`, whose decision value is fixed to the one
 * result the measurement below actually wired. This fixture instead emits whichever decision
 * `TEST_HOOK_DECISION` names, so the test file can measure each CANDIDATE value independently
 * against the real `claude` binary — the whole point of Task 3's "measure, don't assume"
 * instruction, rather than trusting a decision value nobody watched fail.
 *
 * Reads its own stdin to completion before deciding (mirrors the real hook's own contract);
 * never opens a socket, never polls and never sleeps.
 *
 * `TEST_HOOK_DECISION` unset or `"none"` emits an EMPTY decision object — no `PreToolUse` verdict
 * at all — which is the positive-control / falsifiability-companion case: proof that, absent any
 * hook opinion, the harness genuinely drives the real backend to execute the harmless command it
 * is asked to run, so the later "blocked" assertions are not vacuously true.
 */
let data = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  data += chunk;
});
process.stdin.on("end", () => {
  void data; // this fixture does not need to parse the payload — it always emits the same fixed decision
  const decision = process.env.TEST_HOOK_DECISION;
  if (!decision || decision === "none") {
    process.stdout.write("{}");
    process.exit(0);
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: "destructive-gate.test.mjs measurement harness",
      },
    }),
  );
  // Mirrors the real hook's own exit convention (2 for a blocking decision, 0 otherwise) so this
  // fixture behaves like a normal PreToolUse hook script. The test asserts on the marker file's
  // existence, never on this exit code.
  process.exit(decision === "deny" ? 2 : 0);
});
