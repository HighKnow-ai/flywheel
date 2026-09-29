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
import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Plan 05-34 (G-05-6 closure): the frozen real capture of an unauthenticated CLI's first turn —
 * see the fixture's own `note` field for the full provenance. Read once at MODULE LOAD, so the
 * `unauthenticated-backend-first-turn` scenario below and the assertions in
 * `uat-08-socratic-authoring.mjs` that check it cannot drift from the real capture by retyping a
 * copy of it (README Item 8's third rule: a fixture that cannot express a real shape is the gap —
 * extend the fixture vocabulary, then read the REAL values into it, never retype them).
 */
const UNAUTHENTICATED_FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "unauthenticated-cli-first-turn.json");
const UNAUTHENTICATED_FIXTURE = JSON.parse(fs.readFileSync(UNAUTHENTICATED_FIXTURE_PATH, "utf8"));
const UNAUTHENTICATED_ASSISTANT_LINE = UNAUTHENTICATED_FIXTURE.lines.find((line) => line.type === "assistant");
const UNAUTHENTICATED_RESULT_LINE = UNAUTHENTICATED_FIXTURE.lines.find((line) => line.type === "result");
const UNAUTHENTICATED_LOGIN_NOTICE_TEXT = UNAUTHENTICATED_ASSISTANT_LINE.message.content.find(
  (block) => block.type === "text",
).text;

/**
 * Plan 05-37 (Task 3, gap G-05-7): the frozen real captures of a rate-limit notice and a
 * reasoning-only assistant message — both from live run `01M3C48C3PV1NSGHERBZ587YB1` — read once at
 * MODULE LOAD, exactly like the unauthenticated-CLI fixture above, so the `unmodelled-wire-shapes`
 * scenario below cannot drift from the frozen fixture Task 2 built by retyping a copy of it.
 */
const UNMODELLED_SHAPES_FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "live-opus5-unmodelled-shapes.json");
const UNMODELLED_SHAPES_FIXTURE = JSON.parse(fs.readFileSync(UNMODELLED_SHAPES_FIXTURE_PATH, "utf8"));
const UNMODELLED_RATE_LIMIT_LINE = UNMODELLED_SHAPES_FIXTURE.shapes.find(
  (shape) => shape.expectedEventType === "rate_limit",
).line;
const UNMODELLED_REASONING_CONTENT_BLOCK = UNMODELLED_SHAPES_FIXTURE.shapes.find(
  (shape) => shape.expectedEventType === "thinking",
).line.message.content[0];

/**
 * Plan 05-42 (gap G-05-8(a)): the frozen real capture of live run `01M3DNC0G9CYAWSD8DYEGTRP8C`'s
 * `AskUserQuestion` tool call (plan 05-41's own fixture) — read once at MODULE LOAD, exactly like
 * the fixtures above, so the `ask-user-question` scenario below cannot drift from the real capture
 * by retyping a copy of it. `ASK_USER_QUESTION_TOOL_USE_BLOCK` is the fixture's own `tool_use`
 * content block, imported verbatim (never retyped as an object literal here) — the exact discipline
 * `scripts/uat/README.md` Item 8's third rule requires.
 */
const ASK_USER_QUESTION_FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "live-opus5-ask-user-question.json");
const ASK_USER_QUESTION_FIXTURE = JSON.parse(fs.readFileSync(ASK_USER_QUESTION_FIXTURE_PATH, "utf8"));
const ASK_USER_QUESTION_TOOL_USE_BLOCK = ASK_USER_QUESTION_FIXTURE.shapes.find(
  (shape) => shape.name === "ask-user-question",
).line.message.content[0];

/**
 * Plan 05-46 (gap G-05-9): the id `drafts-criteria-after-second-advance`'s own `propose_criterion`
 * call names as its `parent_proposal_id` — the SAME id its own `proposal_list` call reports back
 * as a pending proposal's id. A 26-character synthetic ULID-shaped string (obviously fake, never a
 * real captured id), declared once here and read by both the scenario below and by
 * `uat-08-socratic-authoring.mjs`'s own assertions (via `SCENARIOS[...].readBackProposalId`) —
 * never retyped as a second literal, so the two cannot drift apart.
 */
const CRITERIA_SCENARIO_READ_BACK_PROPOSAL_ID = "01FAKECRITERIONPARENTIDA01";

/**
 * The scripted turn fixtures, keyed by scenario name. Each scenario is `{ turns, fallback }`:
 * `turns` is an array of arrays of content blocks (`{ type: "text", text }` or
 * `{ type: "tool_use", name, input }`) — one array per conversational turn, each block becoming
 * its own separate stdout line; `fallback` is the content-block array replayed for every turn
 * beyond the scripted ones, so a session stays answerable after the stage advances.
 *
 * A content block may also carry an optional numeric `delayMs` (plan 05-25, WR-04 closure): before
 * emitting THAT block's own stdout line, `emitTurn` waits `delayMs` milliseconds first. This is the
 * ONLY way this repository can express a REAL mid-turn pause — every block without `delayMs` keeps
 * emitting immediately, so every scenario's existing timing is completely unchanged. Before this
 * plan, no fixture here could pause at all, which is exactly why no offline arm could reproduce
 * WR-04 (a real Bash tool call that takes longer than the idle window, with nothing else on the
 * wire in the meantime): the fake backend always replied instantly, so the idle window was never
 * actually tested against a genuine mid-turn gap. `delayMs` is stripped from the block before it is
 * written to stdout — it is a fixture-authoring convenience, never part of the wire shape a real
 * `claude` CLI turn carries.
 *
 * A content block may also carry an optional `role` (plan 05-27, G-05-4 closure), mirroring exactly
 * how `delayMs` was introduced above: default `"assistant"`; the only other permitted value is
 * `"user"`. `emitTurn` uses it for the stream envelope's own top-level `type` and for
 * `message.role`, then strips it from the block before writing, alongside `delayMs`, so it never
 * appears in the wire shape itself. Before this plan, no scenario here could put a `tool_result` on
 * the wire AT ALL — `emitTurn` wrapped every block in an envelope whose `type` was always
 * `"assistant"`, and `claude-code-adapter.ts` only normalises a `tool_result` content block out of a
 * `type: "assistant" | "user"` envelope carrying one. A `tool_result` block is delivered on a
 * `user`-role envelope on the real wire (the CLI reports a tool's own result back as a user-role
 * turn), which is the exact shape this field exists to express — the same gap `delayMs` closed for
 * a mid-turn pause, now closed for a `tool_result` block at all.
 *
 * A content block may also carry an optional `envelopeExtra` object (plan 05-34, G-05-6 closure),
 * mirroring exactly how `delayMs`/`role` were introduced above: before this field, no scenario here
 * could put an ENVELOPE-LEVEL field (a sibling of `type`/`message`, not inside `message.content`)
 * on the wire at all, so no offline arm could reproduce the exact shape that defeated gap G-05-6's
 * live run — a real unauthenticated CLI stream whose assistant envelope carries its own `error`/
 * `is_api_error_message` fields. `emitTurn` merges `envelopeExtra`'s own keys into the emitted
 * envelope object ALONGSIDE `type`/`message` (never inside `message.content`), then strips
 * `envelopeExtra` from the block before it is written, alongside `delayMs`/`role`, so it never
 * appears inside the block's own wire shape.
 *
 * A SCENARIO (not a block) may also carry an optional `resultExtra` object (plan 05-34, G-05-6
 * closure), for the same reason and merged the same way: before this field, no scenario here could
 * put a field on the terminating `result` line beyond what `emitTurn` always emits, so no offline
 * arm could reproduce the real capture's own `is_error`/`terminal_reason` result-line fields.
 * `emitTurn` merges `resultExtra`'s own keys into every `result` line it emits for that scenario,
 * alongside `type`/`subtype`/`total_cost_usd`/`session_id`/`usage`.
 *
 * `unauthenticated-backend-first-turn` (plan 05-34, G-05-6 closure) replays the REAL captured
 * stream frozen at `scripts/uat/fixtures/unauthenticated-cli-first-turn.json` — an unauthenticated
 * `claude` CLI's first turn, captured offline at zero credential cost. Its single scripted turn's
 * text, `envelopeExtra` and this scenario's own `resultExtra` are all read from that frozen fixture
 * at MODULE LOAD (see the constants declared above), never retyped as literals here, so the
 * scenario and the capture cannot drift. The fallback turn must never be reached — the whole point
 * of this scenario is that the wire's own error facts stop `driveChallengeConversation` on turn one,
 * before the full proposal deadline gap G-05-6's own live run waited out.
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
/**
 * Plan 05-37 (Task 3, gap G-05-7): a scenario may also carry an optional top-level `preamble` array
 * — raw wire objects printed VERBATIM, in order, immediately after the init line and before any
 * turn. Exists so a scenario can replay a top-level line type that is not a turn at all (a
 * `rate_limit_event` line arrives independently of any assistant turn on the real wire) — no
 * existing scenario shape could express that, since every block a scenario declares up to this
 * point is a `message.content` entry `emitTurn` wraps in a turn envelope. `main()` prints each
 * `preamble` entry with `printLine` directly, with no wrapping and no stripping of any kind — it is
 * already a complete, real wire-shaped object (read from `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json`
 * below, never retyped).
 */

/** Plan 05-38 (Task 3, gap G-05-7): the per-block pause `works-continuously-past-old-deadline`
 * (below) uses for EVERY delayed block — deliberately small enough that no INDIVIDUAL gap ever
 * approaches either the mid-flight window or the short ceiling the matching `--replay-check` branch
 * passes (`REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS`/`REPLAY_CONTINUOUS_WORK_CEILING_MS`,
 * `uat-08-socratic-authoring.mjs`), while enough of them chained together comfortably exceed that
 * same ceiling in TOTAL — the exact combination live run `01M3C48C3PV1NSGHERBZ587YB1`'s own turn 1
 * produced. */
const CONTINUOUS_WORK_GAP_MS = 400;

/**
 * Plan 05-38 (Task 3, gap G-05-7): builds `works-continuously-past-old-deadline`'s single scripted
 * turn — `repetitions` repetitions of (a reasoning block, a tool-use block carrying its own id, its
 * own matching tool-result block), reproducing live run `01M3C48C3PV1NSGHERBZ587YB1`'s turn-1 SHAPE
 * in miniature (roughly sixty tool-call/tool-result pairs and repeated reasoning, all inside one
 * unbroken 120000ms turn). Finished by one text block carrying a question, so
 * `driveChallengeConversation` behaves exactly as it does on a real challenge turn, and `emitTurn`'s
 * own `result` line ends it. Every block after the first carries `delayMs: CONTINUOUS_WORK_GAP_MS` —
 * the delays are chosen so the TOTAL comfortably exceeds the short ceiling the matching
 * `--replay-check` branch passes while every INDIVIDUAL gap stays small, because that combination is
 * exactly what the real run produced and exactly what the superseded arrangement (an unconditional
 * wall-clock deadline from call start) could not survive.
 */
function buildContinuousWorkTurn(repetitions) {
  const blocks = [{ type: "text", text: "Let me look at a few things before I answer." }];
  for (let i = 1; i <= repetitions; i += 1) {
    blocks.push({
      type: "thinking",
      thinking: `Weighing angle ${i} before I ask anything.`,
      delayMs: CONTINUOUS_WORK_GAP_MS,
    });
    blocks.push({
      type: "tool_use",
      name: "Bash",
      id: `toolu_wcpd_${i}`,
      input: { command: "git status --short" },
    });
    blocks.push({
      type: "tool_result",
      role: "user",
      tool_use_id: `toolu_wcpd_${i}`,
      text: "clean",
      delayMs: CONTINUOUS_WORK_GAP_MS,
    });
  }
  blocks.push({
    type: "text",
    text: "Who is the audience for this feature? Where should the notification appear?",
    delayMs: CONTINUOUS_WORK_GAP_MS,
  });
  return blocks;
}

/**
 * Plan 05-49 (Task 2, G-05-10 — closing the fixture/product divergence): the ONE place a scripted
 * staging `tool_result` body is built in this file, so every fixture entry derives from the SAME
 * shape the real `stageAuthoringProposal` (`packages/sidecar/src/mcp-permission-server.ts`) resolves
 * with — `{staged: true, proposalId}` — rather than each scenario hand-writing its own copy that can
 * silently drift from the product's own key name. Before this plan, three separate call sites here
 * each hand-wrote `{staged: true, id: ...}` — the key that was NEVER what the real server produced
 * (`proposalId`, since plan 05-48) — so the offline `--replay-check` slice validated the harness
 * against the fixture's own invention rather than the real contract. `--self-test`'s own
 * "the fixture's staged tool-result body matches the shape the real MCP server produces" check
 * drives this function's own output against the real `stageAuthoringProposal` and asserts the two
 * key sets agree, so a future product-side rename fails that check instead of quietly resuming this
 * exact divergence.
 */
export function stagedToolResultText(proposalId) {
  return JSON.stringify({ staged: true, proposalId });
}

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
          // Plan 05-30 (G-05-5 closure): every tool_use block in this scenario carries its own
          // distinct id — no tool_result follows in this scenario, so the id has nothing to pair
          // with, but the plan's own instruction is to id every tool_use block regardless.
          id: "toolu_swdc_propose",
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
        { type: "tool_use", name: "Bash", id: "toolu_pwaa_bash1", input: { command: "git status --short && ls" } },
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
        { type: "tool_use", name: "Bash", id: "toolu_pwaa_bash2", input: { command: "true" } },
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
          // Plan 05-30 (G-05-5 closure): every tool_use block in this scenario carries its own
          // distinct id — no tool_result follows this one either, so the id has nothing to pair
          // with here, but every tool_use block in this scenario is idded regardless.
          id: "toolu_pwaa_propose",
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

  // Plan 05-25 (WR-04 closure, 05-REVIEW.md): the ONE scenario that exercises `delayMs` — a short
  // text block, a Bash `tool_use` block, then a text block that PAUSES for real before it is
  // emitted, then one more text block, all in the SAME scripted turn. The pause (1500ms) is
  // comfortably larger than the short, explicit `idleMs` the matching `--replay-check` branch
  // passes (300ms — short enough that the PRE-FIX idle policy, which reset its timer on ANY event
  // and never suppressed the window for an outstanding tool call, would certainly have truncated
  // this capture at the idle marker) and comfortably smaller than `REPLAY_TURN_DEADLINE_MS`
  // (10000ms), so the reproduction stays fast while the assertion stays decisive. Proves the WHOLE
  // turn — every block, including the one emitted AFTER the real pause — is captured, ending on
  // the backend's own result marker, never the idle marker.
  "slow-tool-mid-turn": {
    turns: [
      [
        { type: "text", text: "Let me check the repo before answering." },
        { type: "tool_use", name: "Bash", input: { command: "sleep 5 && git status --short" } },
        {
          type: "text",
          text: "That took a while, but here's what I found:",
          delayMs: 1500,
        },
        {
          type: "text",
          text: "The repo is clean and ready — go ahead and describe what you'd like built.",
        },
      ],
    ],
    fallback: [
      { type: "text", text: "Noted — I'll keep that in mind as we continue." },
    ],
  },

  // Plan 05-27 (gap G-05-4): the collision `readNoWorkPlanned`'s own per-attempt scan could not
  // see — two `propose_*` tool calls issued back-to-back, in ONE scripted turn, before either is
  // answered, then two `tool_result` blocks answering them in order (the first refusing, the
  // second not). BOTH results are deliberately UNNAMED (no `name` field at all) — this is the live
  // wire's own shape: `claude-code-adapter.ts:598-600` normalises every `tool_result` with no
  // `toolName`, because the CLI's own `tool_result` content block carries a `tool_use_id`, not a
  // tool name. The 05-23 fixture's wrong-tool-name exclusion (`unrefusedThenRefused` in this file's
  // sibling self-test) cannot apply here — this is the fixture that was being avoided. Both
  // `tool_result` blocks ride the `role: "user"` envelope (the shape a real tool result actually
  // uses), which is the exact capability this plan's `role` field exists to express. The turn opens
  // and closes on plain text carrying no interrogative fragment, so `driveChallengeConversation`
  // settles after this one turn, mirroring `stages-work-during-challenge` above.
  "back-to-back-proposals": {
    turns: [
      [
        { type: "text", text: "This premise is clear enough — I'll stage the work now." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_task",
          // Plan 05-30 (G-05-5 closure): ids added so the live wire shape (two back-to-back
          // propose attempts, each with its own tool_use_id-bearing answer) matches what the
          // product now actually reads. The refusing result below carries THIS id — it answers
          // the FIRST attempt, mirroring exactly which result the pre-05-30 claimed-index pairing
          // paired it with, so this fixture's own expected readings are unchanged by this edit.
          id: "toolu_btb_1",
          input: { title: "Build notifications", description: "Notify the user of run outcomes." },
        },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_assumption",
          id: "toolu_btb_2",
          input: { assumption: "Notifications are opt-in by default." },
        },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_btb_1",
          text: "still in the challenge stage — no proposals yet.",
        },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_btb_2",
          text: "proposal created successfully.",
        },
        { type: "text", text: "I've staged both items for your review." },
      ],
    ],
    fallback: [
      { type: "text", text: "Still staging more work based on what you've told me." },
    ],
  },

  // Plan 05-30 (gap G-05-5): the vacuous-pass shape this plan closes — a propose attempt's OWN real,
  // unrefused answer sits BEHIND an unrelated tool's result, and that unrelated result's own text
  // happens to match the stage-gate refusal wording. A pairing that infers its answer from POSITION
  // (the earliest unclaimed subsequent tool_result, whatever order the two interleave in) claims the
  // unrelated board_search result as the propose attempt's own answer, reads a refusal that was never
  // about this attempt, and certifies a genuine SHAPE-01 violation as a pass. A pairing that looks up
  // the wire's own correlation id instead pairs each attempt with its OWN result regardless of
  // interleaving, and reads this shape correctly: `violated`. This scenario is the ordinary case, not
  // a contrived one — `mcp-permission-server.ts`'s three read tools (including `board_search`) are
  // pre-approved in every stage including the challenge stage, so an agent issuing a read alongside a
  // staged proposal is exactly the shape a real session can produce.
  "interleaved-read-during-proposal": {
    turns: [
      [
        { type: "text", text: "This premise is clear enough — I'll stage the work now." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_task",
          id: "toolu_propose_1",
          input: { title: "Build notifications", description: "Notify the user of run outcomes." },
        },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__board_search",
          id: "toolu_read_1",
          input: { term: "notifications" },
        },
        {
          // The UNRELATED read's own result — its text coincidentally matches the stage-gate
          // refusal wording, which is the coincidence that makes this gap severe rather than
          // merely untidy. Answers toolu_read_1, NOT the propose attempt.
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_read_1",
          text: "board_search is unavailable during challenge stage",
        },
        {
          // The propose attempt's REAL answer — not refusing. Answers toolu_propose_1.
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_propose_1",
          text: "proposal created successfully.",
        },
        { type: "text", text: "I've staged that item for your review." },
      ],
    ],
    fallback: [
      { type: "text", text: "Still staging more work based on what you've told me." },
    ],
  },

  // Plan 05-31 (Task 2, gap G-05-5): the absent-id decision's own end-to-end proof — a backend
  // that supplies NO correlation ids at all. The `tool_use` block below declares no `id`; the
  // `tool_result` block below declares no `tool_use_id`. This is the shape `05-30-PLAN.md`'s
  // Task 1 STEP 5 reasoned about but never drove through the real sidecar: through the real
  // shipped normaliser (`claude-code-adapter.ts::normaliseStreamEvent`), a `tool_use`/
  // `tool_result` pair declaring neither key must normalise onto `ToolCallEvent`/
  // `ToolResultEvent` objects carrying NO `toolUseId` key at all — never fabricated, never
  // adopted from a neighbouring field — so the harness's own pairing correctly reads
  // `uncorrelatable` and SHAPE-01 does not pass. The result's own text deliberately does NOT
  // match the stage-gate refusal wording (`CHALLENGE_REFUSAL_PATTERN`), so that a reintroduced
  // positional fallback would read `violated` — a WRONG but at least DIFFERENT reading — rather
  // than coincidentally agreeing with the `uncorrelatable` abstention this scenario proves. The
  // turn opens and closes on plain text carrying no interrogative fragment, so
  // `driveChallengeConversation` settles after this one turn, mirroring
  // `stages-work-during-challenge` and `interleaved-read-during-proposal` above.
  "proposal-without-correlation-ids": {
    turns: [
      [
        { type: "text", text: "This premise is clear enough — I'll stage the work now." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_task",
          // Deliberately NO `id` field — the shape a backend that emits no correlation ids
          // would produce. Do not add one to make anything pass.
          input: { title: "Build notifications", description: "Notify the user of run outcomes." },
        },
        {
          type: "tool_result",
          role: "user",
          // Deliberately NO `tool_use_id` field — paired with the `tool_use` block's own
          // absent `id` above. The text below does NOT match the refusal wording, on purpose:
          // see this scenario's own doc comment above.
          text: "proposal created successfully.",
        },
        { type: "text", text: "I've staged that item for your review." },
      ],
    ],
    fallback: [
      { type: "text", text: "Still staging more work based on what you've told me." },
    ],
  },

  // Plan 05-34 (gap G-05-6): replays the REAL captured stream of an unauthenticated `claude` CLI's
  // first turn — the exact shape that defeated the live run this gap exists to close (an
  // unauthenticated backend's login-notice text was counted as agent speech, the conversation was
  // recorded as settled, and the run then waited out the full 120000ms proposal deadline before
  // failing). Every value below is read from the frozen fixture at module load (see the constants
  // declared above this object) — never retyped — so this scenario and the real capture cannot
  // drift apart. The fallback turn must never be reached: the whole point of this scenario is that
  // the wire's own error facts stop the driver on turn one.
  "unauthenticated-backend-first-turn": {
    turns: [
      [
        {
          type: "text",
          text: UNAUTHENTICATED_LOGIN_NOTICE_TEXT,
          envelopeExtra: {
            error: UNAUTHENTICATED_ASSISTANT_LINE.error,
            is_api_error_message: UNAUTHENTICATED_ASSISTANT_LINE.is_api_error_message,
          },
        },
      ],
    ],
    fallback: [
      {
        type: "text",
        text: "This fallback turn must never be reached — the wire's own error facts must stop the driver on turn one.",
      },
    ],
    resultExtra: {
      is_error: UNAUTHENTICATED_RESULT_LINE.is_error,
      terminal_reason: UNAUTHENTICATED_RESULT_LINE.terminal_reason,
    },
  },

  // Plan 05-36 (Task 1, gap G-05-7): reproduces the EXACT mechanism that destroyed live run
  // `01M3C48C3PV1NSGHERBZ587YB1` — a turn wait that exceeds its own wall-clock deadline. `emitTurn`
  // ALWAYS writes a `result` line after a turn's blocks (see this file's own module doc comment),
  // so the ONLY way a scenario can outlive a deadline is a block carrying a `delayMs` longer than
  // the deadline the harness passes. An outstanding tool call is what makes the wall clock the ONLY
  // backstop: WR-04's own idle policy (`scripts/uat/lib/sidecar-harness.mjs::waitForTurn`) stands
  // the idle window down entirely while a tool call has no matching `tool_result` — which is
  // precisely why the real run died on the wall clock with the idle guard never having a chance to
  // fire. This scenario's own `tool_use` block therefore carries an id that nothing, in this turn
  // or any other, ever answers. The final text block's `delayMs` is comfortably longer than
  // `REPLAY_THROWN_DEADLINE_MS` (`uat-08-socratic-authoring.mjs`) and must never actually be
  // observed by the harness — the wall-clock deadline fires first, exactly as it did live.
  "turn-deadline-exceeded": {
    turns: [
      [
        { type: "text", text: "Let me get oriented before shaping this." },
        {
          type: "tool_use",
          name: "Bash",
          id: "toolu_turn_deadline_never_answered",
          input: { command: "git status --short && ls" },
        },
        {
          type: "text",
          text: "Still thinking this through — one more thing before I ask you anything.",
          delayMs: 4_000,
        },
      ],
    ],
    fallback: [
      { type: "text", text: "This fallback turn must never be reached — the deadline fires before it." },
    ],
  },

  // Plan 05-37 (Task 3, gap G-05-7): both new wire shapes Task 1 modelled, replayed through the
  // REAL sidecar and the REAL shipped normaliser — proving they flow end to end offline, and that
  // modelling them did not swallow the ordinary conversation happening around them. `preamble`
  // carries the frozen rate-limit line (a top-level line unrelated to any turn, exactly as it
  // arrives on the real wire); turn 1 opens with the frozen reasoning-only content block — imported
  // from the SAME fixture Task 2 froze, never retyped — followed by an ordinary text block carrying
  // two questions that match `ANSWER_BANK` entries in `uat-08-socratic-authoring.mjs`, so the real
  // `driveChallengeConversation` answers them and sends a developer turn; turn 2 is an ordinary
  // settling reply (no question mark), so the conversation settles cleanly on turn 2 with both new
  // shapes already having crossed the wire during turn 1.
  "unmodelled-wire-shapes": {
    preamble: [UNMODELLED_RATE_LIMIT_LINE],
    turns: [
      [
        { ...UNMODELLED_REASONING_CONTENT_BLOCK },
        {
          type: "text",
          text: "Who is the audience for this feature? Where should the notification appear?",
        },
      ],
      [{ type: "text", text: "Understood — settling on that scope now, nothing further to ask." }],
    ],
    fallback: [
      {
        type: "text",
        text: "This fallback turn must never be reached — the conversation settles cleanly on turn 2.",
      },
    ],
  },

  // Plan 05-38 (Task 3, gap G-05-7): the mechanism that actually killed live run
  // `01M3C48C3PV1NSGHERBZ587YB1` — a turn that works continuously, well past the old wall-clock
  // deadline, and still completes. See `buildContinuousWorkTurn`'s own doc comment above for the
  // full shape and the arithmetic this scenario depends on. Turn 2 (the fallback) is an ordinary
  // settling reply with no question mark — the SAME pattern `unmodelled-wire-shapes` above uses —
  // since turn 1's own closing question means `driveChallengeConversation` answers it and waits for
  // a second turn before settling.
  "works-continuously-past-old-deadline": {
    turns: [buildContinuousWorkTurn(5)],
    fallback: [
      { type: "text", text: "Understood — settling on that scope now, nothing further to ask." },
    ],
  },

  // Plan 05-42 (gap G-05-8(a)): replays the REAL captured `AskUserQuestion` tool call frozen at
  // `scripts/uat/fixtures/live-opus5-ask-user-question.json` — the exact wire shape whose three
  // questions and eleven option labels went missing from the evidence sheet on live run
  // `01M3DNC0G9CYAWSD8DYEGTRP8C`. A short opening text block, then the imported `tool_use` block
  // verbatim, then a `tool_result` block carrying the fixture's own `cliAnsweredToolResult` text
  // (replaying what the CLI's non-interactive mode actually did — it answers the call itself, since
  // no human is there to pick — never an idealised answer), then a closing text block carrying NO
  // question mark at all. The only thing that can keep the conversation going past this turn is the
  // driver reading the tool call's own typed questions, not its prose.
  "ask-user-question": {
    turns: [
      [
        { type: "text", text: "Before I stage anything, a few things would materially change the shape of this." },
        { ...ASK_USER_QUESTION_TOOL_USE_BLOCK },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: ASK_USER_QUESTION_FIXTURE.cliAnsweredToolResult.tool_use_id,
          text: ASK_USER_QUESTION_FIXTURE.cliAnsweredToolResult.content,
        },
        { type: "text", text: "Noted — moving on without those picks locked in." },
      ],
    ],
    fallback: [{ type: "text", text: "Still here if you need anything else." }],
  },

  // Plan 05-46 (gap G-05-9), Task 3: drives D-88's WHOLE three-stage machine offline —
  // challenge -> decompose -> criteria, replying to BOTH stage instructions, and staging a
  // criterion against an id read back via plan 05-44's `proposal_list` tool. `stageTargets`
  // (read by `uat-08-socratic-authoring.mjs`'s own replay-body loop) declares both advances;
  // every scenario that omits it defaults to a single "decompose" advance, so this is the ONLY
  // scenario in this file that reaches the criteria stage at all.
  //
  // THE BOUND (Task 3(c)): this scenario drives the REAL sidecar, the REAL watchdog and the
  // REAL shipped normaliser, and it proves ordering, capture, correlation and every reading
  // computed from the event stream. It opens no socket — no real `claude` CLI ever exists in
  // this arm, so no MCP tool call this scenario's tool_use blocks NAME is ever actually
  // dispatched to a real MCP server. NO ROW REACHES THE BOARD: `apply-proposal-created` is
  // never called and `list-pending` is never called either. The drafted-criteria count the
  // replay body computes for this scenario is a READING derived from the wire's own
  // tool_call/tool_result correlation (the same `correlateProposeAttempts` the shipped product
  // code uses), never a database row count. The board-write leg — that a criterion staged
  // against a still-pending parent id actually materialises — is owned by
  // `--board-read-check` (plan 05-44 Task 2) and by `cargo test -p core --test
  // authoring_criterion_reachability`, not by this scenario.
  //
  // Turns 1-2 mirror `proposes-work-after-advance`'s own clean-challenge shape verbatim (three
  // questions matching distinct ANSWER_BANK patterns, then a settling reply with no question) —
  // the challenge stage's own shape is not this scenario's point and is reused rather than
  // re-invented.
  "drafts-criteria-after-second-advance": {
    stageTargets: ["decompose", "criteria"],
    readBackProposalId: CRITERIA_SCENARIO_READ_BACK_PROPOSAL_ID,
    turns: [
      // Turn 1 — three questions, each matching a distinct ANSWER_BANK pattern. NO propose tool
      // call anywhere in this turn.
      [
        { type: "text", text: "Let me get oriented before shaping this." },
        { type: "tool_use", name: "Bash", id: "toolu_dcsa_bash1", input: { command: "git status --short && ls" } },
        {
          type: "text",
          text:
            "Who can dismiss a notification once it fires?\n" +
            "Does an unattended run finishing on its own warrant a notification?\n" +
            "Should multiple notifications ever batch together?",
        },
      ],
      // Turn 2 — the reply to the developer's answers. No interrogative fragment at all: this is
      // what makes the conversation SETTLE.
      [
        { type: "text", text: "Good — locking that in." },
        { type: "tool_use", name: "Bash", id: "toolu_dcsa_bash2", input: { command: "true" } },
        {
          type: "text",
          text:
            "Got it — only the assignee dismisses it, an unattended finish alone doesn't warrant " +
            "one, and no batching in this slice. That's enough to move forward.",
        },
      ],
      // Turn 3 — the reply to the DISTILLATION instruction (entering decompose): a propose_epic
      // and a propose_assumption tool-use block, each carrying its own distinct id and followed
      // by its own tool_result block naming that SAME id as tool_use_id — the real correlation
      // pair plan 05-30's id-based pairing depends on. Split across multiple content blocks (an
      // opening block, propose_epic + its result, propose_assumption + its result, a closing
      // block) so the multi-chunk capture is exercised, matching this file's own convention.
      [
        { type: "text", text: "Now that we're decomposing, I'll stage the shape I've settled on." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_epic",
          id: "toolu_dcsa_epic",
          input: { title: "Run notifications", description: "Notify the developer when a run needs them." },
        },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_dcsa_epic",
          text: stagedToolResultText(CRITERIA_SCENARIO_READ_BACK_PROPOSAL_ID),
        },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_assumption",
          id: "toolu_dcsa_assumption",
          input: { statement: "Only the assignee dismisses a notification.", answer: "confirmed" },
        },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_dcsa_assumption",
          text: stagedToolResultText("01FAKEASSUMPTIONPROPOSALA1"),
        },
        { type: "text", text: "Epic and assumption both staged for your review." },
      ],
      // Turn 4 — the reply to the CRITERIA instruction (entering criteria): plan 05-49 (G-05-10)
      // rewrites this turn to model the FIXED contract — the agent already holds the epic
      // proposal's own id from turn 3's own staging result (`readBackProposalId`), so it parents
      // the criterion DIRECTLY, with no `proposal_list` round trip in between. A single
      // `proposal_list` call still appears in this SAME turn, AFTER the criterion is staged, as a
      // review action — its scripted result is now the ONE thing that would go empty if the
      // in-turn apply this plan's Task 1 ships ever regressed back to an out-of-band apply, which
      // is exactly what `assertProposalListNonEmptyInTurn` (Task 3) exists to catch. Also split
      // across multiple content blocks.
      [
        { type: "text", text: "I already have the epic proposal's own id from staging it — parenting directly." },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__propose_criterion",
          id: "toolu_dcsa_criterion",
          input: {
            statement: "A notification tray entry appears within one second of the triggering event.",
            parent_proposal_id: CRITERIA_SCENARIO_READ_BACK_PROPOSAL_ID,
          },
        },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_dcsa_criterion",
          text: stagedToolResultText("01FAKECRITERIONROWIDXXXA1"),
        },
        {
          type: "tool_use",
          name: "mcp__flywheel-permissions__proposal_list",
          id: "toolu_dcsa_list",
          input: {},
        },
        {
          type: "tool_result",
          role: "user",
          tool_use_id: "toolu_dcsa_list",
          text: JSON.stringify({
            proposals: [
              { id: CRITERIA_SCENARIO_READ_BACK_PROPOSAL_ID, verb: "propose", targetType: "epic", status: "pending" },
            ],
            truncated: false,
          }),
        },
        { type: "text", text: "Criterion staged against the still-pending epic proposal." },
      ],
    ],
    fallback: [{ type: "text", text: "Still here if you need anything else." }],
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
 * `ClaudeStreamResult` wire shapes so the shipped normaliser needs no special-casing to read it.
 *
 * Async (plan 05-25, WR-04 closure): a block carrying `delayMs` is awaited, via a real timer,
 * BEFORE its own stdout line is written — the ONLY way this file can express a genuine mid-turn
 * pause. `delayMs` itself is stripped before the block is written; it is a fixture-authoring
 * field, never part of the wire shape. Every block without `delayMs` still emits immediately, so
 * every scenario's pre-existing timing is unchanged.
 *
 * `resultExtra` (plan 05-34, G-05-6 closure): when the CALLING scenario declares one, its own keys
 * are merged into every `result` line this call emits, alongside `type`/`subtype`/`total_cost_usd`/
 * `session_id`/`usage` — `undefined` (no scenario-level field) merges nothing, so every
 * pre-existing scenario's result line is byte-for-byte unchanged. Each block's own `envelopeExtra`,
 * when present, is merged into that block's own envelope object the same way, then stripped from
 * the block before it is written — a fixture-authoring field, never part of the wire shape. */
async function emitTurn(blocks, messageId, resultExtra) {
  for (const block of blocks) {
    if (typeof block.delayMs === "number" && block.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, block.delayMs));
    }
    const { delayMs: _delayMs, role: _role, envelopeExtra, ...wireBlock } = block;
    const envelopeRole = block.role ?? "assistant";
    printLine({
      type: envelopeRole,
      message: { id: messageId, role: envelopeRole, content: [wireBlock] },
      ...(envelopeExtra && typeof envelopeExtra === "object" ? envelopeExtra : {}),
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
    ...(resultExtra && typeof resultExtra === "object" ? resultExtra : {}),
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

  // Plan 05-37 (Task 3, gap G-05-7): a scenario-level preamble — raw wire objects printed VERBATIM,
  // in order, immediately after the init line and before any turn. See SCENARIOS's own doc comment
  // above for why this exists (a top-level line unrelated to any turn, e.g. rate_limit_event).
  if (Array.isArray(scenario.preamble)) {
    for (const preambleLine of scenario.preamble) {
      printLine(preambleLine);
    }
  }

  let turnIndex = 0;
  // Plan 05-25 (WR-04 closure): `emitTurn` is now async (it may genuinely pause mid-turn via
  // `delayMs`), so a turn's own emission must be SERIALISED behind whichever turn came before it —
  // two overlapping turns whose stdout lines interleave would prove the wrong thing entirely. Each
  // incoming line is parsed and its turn selected SYNCHRONOUSLY, in arrival order, then chained
  // onto this queue; only the actual emission (the part that may pause) waits its turn.
  let turnQueue = Promise.resolve();
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
    const messageId = `fake-msg-${turnIndex}`;
    turnQueue = turnQueue
      .then(() => emitTurn(blocks, messageId, scenario.resultExtra))
      .catch((err) => {
        process.stderr.write(`fake-authoring-claude: emitTurn failed: ${String(err)}\n`);
      });
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
