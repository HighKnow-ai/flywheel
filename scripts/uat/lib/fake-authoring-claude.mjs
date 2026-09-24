#!/usr/bin/env node
/**
 * A deterministic stand-in for the `claude` CLI in the Option-A authoring shape (D-89), the
 * authoring-mode sibling of `packages/sidecar/test/fake-claude.mjs` — same conventions (shebang,
 * `printLine`, a scenario selected by environment variable), a different shape: this one drives a
 * MULTI-TURN, MULTI-CHUNK conversation instead of one fixed three-line sequence, because that is
 * the exact shape `uat-08-socratic-authoring.mjs --replay-check` needs to prove the harness's own
 * turn-boundary primitive (`SidecarClient.waitForTurn`, `scripts/uat/lib/sidecar-harness.mjs`)
 * against the REAL sidecar, the REAL watchdog and the REAL normaliser — for zero tokens, with no
 * network call and no `claude` binary anywhere in the path.
 *
 * This file is NEVER reachable from `uat-08`'s live arm — only `--replay-check` points
 * `FLYWHEEL_CLAUDE_BIN` at it, and the live arm's own `probeClaudeAvailable()` precondition and
 * its own build of `FLYWHEEL_CLAUDE_BIN` are untouched by `--replay-check`. A transcript this
 * script produces is SYNTHETIC — scripted dialogue, not a real model — and
 * `uat-08`'s own evidence-sheet renderer refuses to let a synthetic run carry a fillable verdict
 * line (see `renderChallengeEvidenceSheet`'s `synthetic` flag).
 *
 * Behaviour:
 * - Prints one `system`/`init` line on start, carrying a session id and a model name that visibly
 *   identify this backend as synthetic — a human or a script reading raw output must never mistake
 *   it for the real CLI.
 * - Reads newline-delimited JSON from its OWN stdin (inherited, ultimately, from the sidecar's
 *   child through the watchdog wrapper — see `watchdog.ts`'s own `stdio: ["inherit", "pipe",
 *   "pipe"]`) — the exact envelope `claude-code-adapter.ts`'s `authoringUserTurnLine` writes
 *   (`type: "user"`, `message.role: "user"`, one text content block). Every turn, including the
 *   opening prompt, arrives this way; every other line is ignored.
 * - For the Nth received turn, emits the Nth scripted turn of the selected scenario as a SEQUENCE
 *   of SEPARATE stdout lines — one content block per line, sharing one `message.id` — terminated
 *   by exactly one `result` line (`subtype: "success"`, a usage block). This is the live-measured
 *   shape `scripts/spike/authoring-transport-spike.mjs:114-119` records: one logical turn emits
 *   MULTIPLE stream-json lines, one content block each. Beyond the scripted turns, replies with the
 *   scenario's own fallback turn so a session stays answerable after the stage advances.
 * - Every argv flag this process receives is IGNORED. The argv `buildAuthoringClaudeArgv` builds is
 *   real product code — ignoring it here is deliberate: this file must encode no assumption about
 *   its shape, only about the stdin turn envelope and the stdout stream-json shape.
 * - Exits 0 when stdin ends (the parent closed the pipe) and on SIGTERM (the watchdog's own group
 *   signal, `killSession`'s negative-pid `SIGTERM`) — never lingers past either.
 * - Never opens a socket, never imports the MCP SDK, never touches the network or the filesystem.
 *
 * Exports `SCENARIOS` (the fixture data), `DEFAULT_SCENARIO` and `SCENARIO_ENV_VAR` so
 * `uat-08-socratic-authoring.mjs` asserts against the SAME strings this backend emits, rather than
 * a second copy of them that could drift. The CLI behaviour below sits behind a main-module guard
 * — importing this file for its exports spawns nothing.
 */
import { createInterface } from "node:readline";

/**
 * The scripted turn fixtures, keyed by scenario name. Each scenario is `{ turns, fallback }`:
 * `turns` is an array of arrays of content blocks (`{ type: "text", text }` or
 * `{ type: "tool_use", name, input }`) — one array per conversational turn, each block becoming
 * its own separate stdout line; `fallback` is the content-block array replayed for every turn
 * beyond the scripted ones, so a session stays answerable after the stage advances.
 *
 * `truncation-repro` replays the exact shape of the 2026-09-24 live run that produced an
 * unjudgeable transcript (`.planning/debug/uat-08-live-transcript-unjudgeable.md`, Evidence
 * E4/E5): turn 1 is a pre-tool-call preamble, a tool call, then a narration block that references
 * the tool's own result; turn 2 opens with a promise that ends at a colon — the exact point the
 * old one-event capture stopped reading — followed by a SEPARATE block carrying the three
 * numbered questions the old capture dropped entirely. Turn 2's total character count (both text
 * blocks) is deliberately far larger than its first block alone, so a regression back to
 * first-chunk-only capture is caught by a wide margin, not a coin flip.
 */
export const SCENARIOS = {
  "truncation-repro": {
    turns: [
      // Turn 1 — the reply to the opening prompt.
      [
        {
          type: "text",
          text: "I'll start by getting oriented in the repo before we shape this.",
        },
        {
          type: "tool_use",
          name: "Bash",
          input: { command: "git status --short && ls" },
        },
        {
          type: "text",
          text:
            "Board's empty and so is the repo — this is greenfield shaping, so let me pin down " +
            "the shape before proposing anything. You've already settled delivery: in-app only.",
        },
      ],
      // Turn 2 — the reply to the follow-up. This is RC-A's own reproduction: two SEPARATE
      // content blocks, the second far larger than the first, exactly where the old harness
      // stopped reading.
      [
        {
          type: "text",
          text: "Three things would materially change what gets built:",
        },
        {
          type: "text",
          text:
            "1. Who can dismiss a notification once it fires — just the recipient, or can anyone " +
            "with board access clear it for everyone?\n" +
            "2. Should a notification survive the app restarting, or is it fine if it's gone the " +
            "moment you close Flywheel and reopen it later?\n" +
            "3. When an agent finishes a run unattended, does that alone warrant a notification, " +
            "or only when the run specifically needs you — a decision, a blocked permission, " +
            "something it can't resolve on its own?",
        },
      ],
    ],
    fallback: [
      {
        type: "text",
        text: "Noted — I'll keep that in mind as we continue.",
      },
    ],
  },

  // Plan 05-21 (G-05-2, `driveChallengeConversation`'s own two conversational shapes) — both
  // scripted with multi-block turns (a `tool_use` interleaved with the text blocks), so they also
  // keep exercising the turn boundary `truncation-repro` above was built to prove.
  "settles-after-answers": {
    turns: [
      // Turn 1 — three questions, one per topic the harness's own answer bank covers (audience,
      // surface, restart-persistence).
      [
        { type: "text", text: "Let me get oriented before shaping this." },
        { type: "tool_use", name: "Bash", input: { command: "git status --short && ls" } },
        { type: "text", text: "Three things would decide the shape here:" },
        {
          type: "text",
          text:
            "Who is the audience for a notification?\n" +
            "What surface does it appear on?\n" +
            "Does it need to survive an app restart?",
        },
      ],
      // Turn 2 — the reply to the developer's answers. No interrogative fragment at all: this is
      // what makes the conversation SETTLE.
      [
        { type: "text", text: "Good — locking that in." },
        { type: "tool_use", name: "Bash", input: { command: "true" } },
        {
          type: "text",
          text:
            "Got it — the assignee only, an in-app tray, and it survives a restart. That's enough " +
            "to move forward.",
        },
      ],
    ],
    fallback: [
      { type: "text", text: "Noted — I'll keep that in mind as we continue." },
    ],
  },
  "never-settles": {
    // Every scripted turn AND the fallback turn end with a further question — the conversation can
    // never settle on its own, so the driver must hit `MAX_AGENT_TURNS` and escape via the closing
    // turn rather than loop forever.
    turns: [
      [
        { type: "text", text: "Let me think about this out loud first." },
        { type: "tool_use", name: "Bash", input: { command: "true" } },
        { type: "text", text: "Before I draft anything: what should trigger a notification in the first place?" },
      ],
    ],
    fallback: [
      { type: "text", text: "Understood — but one more thing: are you sure that's the only trigger we need?" },
    ],
  },

  // Plan 05-21 (Task 3, G-05-2): the agent stages work during the challenge stage — a `tool_use`
  // block naming a FULLY-QUALIFIED propose tool (the real wire shape `AUTHORING_PROPOSE_TASK_TOOL_NAME`,
  // `packages/sidecar/src/mcp-permission-server.ts`, produces on a real session), with NO tool_result
  // refusal following it. Proves `readNoWorkPlanned` reads this as `"violated"` — the one reading
  // that makes SHAPE-01's second half actually fail.
  "stages-work-during-challenge": {
    turns: [
      [
        { type: "text", text: "This premise is clear enough — I'll get started." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_task",
          input: { title: "Build notifications", description: "Notify the user of run outcomes." },
        },
        { type: "text", text: "I've staged the first task for your review." },
      ],
    ],
    fallback: [
      { type: "text", text: "Still staging more work based on what you've told me." },
    ],
  },

  // Plan 05-23 (CR-01 closure): the fixture that reaches decompose LEGITIMATELY — a clean
  // challenge stage (no propose call anywhere in turns 1-2), settles after one round of answers,
  // then — on the turn the post-advance developer message triggers — makes the real,
  // fully-qualified decompose-stage propose call `stages-work-during-challenge` above also uses.
  // This is the exact combination CR-01's own defect needed and that no offline arm exercised
  // before this plan: a propose call that provably lands AFTER the challenge-stage window closes.
  "proposes-work-after-advance": {
    turns: [
      // Turn 1 — three questions, each matching a distinct ANSWER_BANK pattern. NO propose tool
      // call anywhere in this turn.
      [
        { type: "text", text: "Let me get oriented before shaping this." },
        { type: "tool_use", name: "Bash", input: { command: "git status --short && ls" } },
        {
          type: "text",
          text:
            "Who can dismiss a notification once it fires?\n" +
            "Does an unattended run finishing on its own warrant a notification?\n" +
            "Should multiple notifications ever batch together?",
        },
      ],
      // Turn 2 — the reply to the developer's answers. No interrogative fragment at all: this is
      // what makes the conversation SETTLE. Still no propose tool call.
      [
        { type: "text", text: "Good — locking that in." },
        { type: "tool_use", name: "Bash", input: { command: "true" } },
        {
          type: "text",
          text:
            "Got it — only the assignee dismisses it, an unattended finish alone doesn't warrant " +
            "one, and no batching in this slice. That's enough to move forward.",
        },
      ],
      // Turn 3 — the legitimate decompose-stage proposal, the turn the post-advance developer
      // turn (the distillation instruction) triggers.
      [
        { type: "text", text: "Now that we're decomposing, I'll stage the first task." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_task",
          input: { title: "Build notifications", description: "Notify the user of run outcomes." },
        },
        { type: "text", text: "I've staged the first task for your review." },
      ],
    ],
    fallback: [
      { type: "text", text: "Still here if you need anything else." },
    ],
  },

  // Plan 05-24 (gap G-05-3): reproduces the exact mechanism that killed this phase's only
  // authorised live run — an Anthropic API-level safety-classifier refusal, rendered by the CLI on
  // the SAME event shape a genuine reply uses (an `assistant_text` block followed by a clean
  // `result` line), landing mid-conversation. Turn 1 is an ordinary multi-block challenge turn
  // carrying questions that match `ANSWER_BANK` patterns, so the driver answers it and the loop
  // runs at least once before the refusal lands. Turn 2's text is reproduced VERBATIM from turn 5
  // of `05-LIVE-CHALLENGE-TRANSCRIPT.md` (run `01M399FP80B184QM2RXTXJDZTK`), classifier code and
  // request id intact. The fallback turn is ordinary text and must never be reached — the whole
  // point of this scenario is that `driveChallengeConversation` stops at the refusal.
  "backend-refuses-mid-conversation": {
    turns: [
      // Turn 1 — three questions, each matching a distinct ANSWER_BANK pattern, so the driver
      // composes a reply and sends a developer turn before the refusal ever lands.
      [
        { type: "text", text: "Let me get oriented before shaping this." },
        { type: "tool_use", name: "Bash", input: { command: "git status --short && ls" } },
        {
          type: "text",
          text:
            "Who can dismiss a notification once it fires?\n" +
            "Does it need to survive an app restart?\n" +
            "Should multiple notifications ever batch together?",
        },
      ],
      // Turn 2 — the refusal itself, verbatim from the real captured transcript. A single text
      // block, exactly as the real backend emitted it, followed by the usual single `result` line.
      [
        {
          type: "text",
          text:
            "API Error: Opus 5 (1M context)'s safeguards flagged this message " +
            "(https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal " +
            "conversations. Claude Code can't respond to this message with Opus 5 (1M context).\n" +
            "\n" +
            "Try rephrasing the request in a new session or change your model.\n" +
            "\n" +
            "Learn more: https://support.claude.com/en/articles/16049681\n" +
            "\n" +
            "Details: `[reasoning_extraction]`\n" +
            "\n" +
            "Request ID: req_011CfMyQ7EQg8jnFnSugjHVw",
        },
      ],
    ],
    fallback: [
      { type: "text", text: "This fallback turn must never be reached — the refusal must stop the driver first." },
    ],
  },
};

/** The scenario `--replay-check` drives by default — the exact reproduction of the truncation
 * this whole plan closes. Kept as a named constant so the fixture selection and the assertions
 * that read it agree on the exact literal. */
export const DEFAULT_SCENARIO = "truncation-repro";

/** The environment variable `uat-08-socratic-authoring.mjs --replay-check` sets on the sidecar
 * process it spawns (which this backend inherits, per `startAuthoringSession`'s own
 * `{ ...process.env, ...options.env }` merge) to select which entry of {@link SCENARIOS} this
 * backend replays. */
export const SCENARIO_ENV_VAR = "FLYWHEEL_UAT_FAKE_AUTHORING_SCENARIO";

const SESSION_ID = "fake-authoring-session-0001";

/** Visibly synthetic — a human or a script reading raw stream-json must never mistake this for a
 * real model's name. */
const SYNTHETIC_MODEL_NAME =
  "synthetic-fake-authoring-claude (scripts/uat/lib/fake-authoring-claude.mjs — not a real model)";

function printLine(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Emit one turn's content blocks as separate stdout lines sharing one `message.id`, terminated
 * by exactly one `result` line. Mirrors `claude-code-adapter.ts`'s own `ClaudeStreamMessage`/
 * `ClaudeStreamResult` wire shapes so the shipped normaliser needs no special-casing to read it. */
function emitTurn(blocks, messageId) {
  for (const block of blocks) {
    printLine({
      type: "assistant",
      message: { id: messageId, role: "assistant", content: [block] },
    });
  }
  printLine({
    type: "result",
    subtype: "success",
    total_cost_usd: 0,
    session_id: SESSION_ID,
    usage: {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      output_tokens: 0,
    },
  });
}

function main() {
  const scenarioName = process.env[SCENARIO_ENV_VAR] ?? DEFAULT_SCENARIO;
  const scenario = SCENARIOS[scenarioName];
  if (scenario === undefined) {
    process.stderr.write(
      `fake-authoring-claude: unknown scenario "${scenarioName}" (known: ${Object.keys(SCENARIOS).join(", ")})\n`,
    );
    process.exit(1);
  }

  printLine({
    type: "system",
    subtype: "init",
    session_id: SESSION_ID,
    model: SYNTHETIC_MODEL_NAME,
  });

  let turnIndex = 0;
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Not a turn envelope — ignore, mirroring the real CLI's own tolerance of stray input.
      return;
    }
    if (parsed?.type !== "user") return;

    const blocks = scenario.turns[turnIndex] ?? scenario.fallback;
    turnIndex += 1;
    emitTurn(blocks, `fake-msg-${turnIndex}`);
  });

  rl.on("close", () => {
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    process.exit(0);
  });
}

// Behind a main-module guard: importing this file for SCENARIOS/DEFAULT_SCENARIO/SCENARIO_ENV_VAR
// spawns nothing and reads no stdin.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
