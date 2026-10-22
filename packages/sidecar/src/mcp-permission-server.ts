/**
 * AGNT-06 — the permission-prompt MCP server: a tool call that does not resolve until a human
 * answers, relayed through the Rust core (02-RESEARCH.md "Permission-prompt MCP server (AGNT-06)").
 *
 * Two roles live in this one file, matching the two OS processes this mechanism spans — the
 * standalone role is a genuinely separate process the backend spawns per its own `--mcp-config`,
 * so the two cannot share in-memory state directly; a Unix domain socket is the relay between
 * them:
 *
 *  - `startPermissionServer` (SIDECAR-SIDE role): called from `claude-code-adapter.ts`'s
 *    `startSession`, BEFORE the backend is spawned ("starting a session starts the permission
 *    server first"). Opens a Unix domain socket the standalone role (below) connects to, and
 *    returns a handle whose `resolvePermission` is what the sidecar's own stdio loop
 *    (`index.ts`'s `permission_answer` op, via `ClaudeCodeAdapter.resolvePermission`) calls when
 *    the Rust core relays a decision. This role never imports the MCP SDK — it is a plain socket
 *    relay with no protocol awareness of MCP at all.
 *
 *    Plan 03-13 (D-53): this SAME socket now carries a SECOND message kind — a fire-and-forget
 *    NOTICE from the PATH shim binary (`packages/shim/src/main.rs`), reporting a git lock retry
 *    in progress or a retry budget's exhaustion. `03-CONTEXT.md` is explicit that the shim route
 *    through the existing permission channel rather than inventing a second answering surface,
 *    and a notice is the same shim talking to the same session. A notice connection is
 *    distinguished by a `kind` field the routine held-request payload never carries, and is
 *    closed IMMEDIATELY once parsed — a notice has no answer, so it is never added to `pending`
 *    (the held-connection map) at all. The held-request path below is otherwise byte-for-byte
 *    unchanged: no timer, no default, no local cache, for either message kind.
 *
 *  - The standalone MCP server (this module's own `main()`, run when the COMPILED file is
 *    invoked directly as `node mcp-permission-server.js <socketPath>`): this is the actual
 *    process the backend (`claude`, or `fake-claude.mjs` in tests) spawns per the `--mcp-config`
 *    `buildClaudeArgv` builds, hosting the permission tool over the stdio transport
 *    (`StdioServerTransport`, matching the backend's own documented `--permission-prompt-tool`
 *    contract), plus the Story agent's board tools (Tasks, issue #52; the hand-off and Check run, issue #53), which ride the same
 *    socket as held `kind: "board_tool"` calls the Rust core answers. Its handler connects a fresh socket to `socketPath` per call, forwards the
 *    request, and settles ONLY when the socket answers — no timer, no default, no local cache of
 *    a prior decision, no allowlist (02-RESEARCH.md pitfall 4: every allow-always lookup happens
 *    in the Rust core, never here — the sidecar asks and waits).
 */
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

/** The raw tool name registered on the MCP server. Declared once, alongside the fully-qualified
 * {@link PERMISSION_TOOL_NAME} it composes, so `buildClaudeArgv` and this server's own
 * registration can never disagree about either name. */
export const APPROVE_TOOL_NAME = "approve_action";

/** The MCP server name this module registers under — the `--mcp-config` key naming exactly one
 * server (T-02-02). */
export const MCP_SERVER_NAME = "flywheel-board";

/** The exact string `--permission-prompt-tool` is given — `mcp__{server}__{tool}`, the shape
 * Claude Code's own CLI reference documents. Declared exactly once in this sidecar's source. */
export const PERMISSION_TOOL_NAME = `mcp__${MCP_SERVER_NAME}__${APPROVE_TOOL_NAME}`;

/** Issue #52 (docs/mvp-spec.md §4.3): the Story agent's Task board tools, hosted on this SAME
 * server (no second process, no second `--mcp-config` entry). Mirrors `TASK_TOOL_NAMES` in
 * `packages/core/src/domain/task_tool.rs`, which is what parses and runs each call. */
export const TASK_TOOL_NAMES = ["task_list", "task_add", "task_update"] as const;

/** Issue #53 (docs/mvp-spec.md §4.4): the hand-off tool and the feedback-only Check tool, hosted on
 * the same server and relayed the same way. Mirrors `HANDOFF_TOOL_NAMES` in
 * `packages/core/src/domain/handoff.rs`, which is what parses and runs each call. */
export const HANDOFF_TOOL_NAMES = ["checks_run", "handoff"] as const;

/** Every board tool the Story agent has: held calls the Rust core answers. */
export const BOARD_TOOL_NAMES = [...TASK_TOOL_NAMES, ...HANDOFF_TOOL_NAMES] as const;

/** Issue #123 (docs/mvp-spec.md §3): the shaping session's board tools, hosted on the same server
 * and relayed the same way. Mirrors `SHAPING_TOOL_NAMES` in `packages/core/src/domain/shaping_tool.rs`,
 * which is what parses and runs each call. `round_post` is held until the developer has answered
 * every question in the Round, which can take days. `round_wait` (issue #124) is a later session's way
 * back onto a Round its killed predecessor left open, held the same way. `propose_spec_change`
 * (issue #125) files a Proposal on the Epic and is answered at once: a Proposal never holds the agent.
 * `propose_roadmap_change` and `roadmap_holds` (issue #133) are a roadmap Round's: the first files one
 * Roadmap change and is answered at once, the second closes the Round with "Roadmap still holds".
 * `propose_story` and `propose_story_order` (issue #127) slice the Epic into Stories, answered at once too. */
export const SHAPING_TOOL_NAMES = [
  "round_post",
  "round_wait",
  "propose_spec_change",
  "propose_roadmap_change",
  "roadmap_holds",
  "propose_story",
  "propose_story_order",
] as const;

export type ShapingToolName = (typeof SHAPING_TOOL_NAMES)[number];

export type BoardToolName = (typeof BOARD_TOOL_NAMES)[number] | ShapingToolName;

/** The kind of session the server serves, passed as its second argument. Each kind is listed only
 * its own tools: a Story session never sees `round_post`, a shaping session never sees the Task
 * tools, the hand-off or the permission prompt. */
export type SessionKind = "story" | "shaping";

const qualified = (name: string) => `mcp__${MCP_SERVER_NAME}__${name}`;

/** The Task tools' fully-qualified names. */
export const TASK_TOOL_QUALIFIED_NAMES = TASK_TOOL_NAMES.map(qualified);

/** The fully-qualified names `buildClaudeArgv` pre-approves with `--allowedTools`: writing the
 * checklist, running the Checks and handing off cost nothing and must never wait on a permission
 * card. */
export const BOARD_TOOL_QUALIFIED_NAMES = BOARD_TOOL_NAMES.map(qualified);

/** What each board tool tells the agent, and the arguments it takes. */
export const BOARD_TOOL_DEFINITIONS = [
  {
    name: "task_list",
    description:
      "Read your Story's Task checklist, in order: each Task's task_id, title, state (open, doing, done, dropped) and drop reason.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "task_add",
    description:
      "Append open Tasks to the end of your Story's checklist. If the checklist is empty, write your plan this way after reading the code and docs the Story touches. Each change is saved at once. Answers with the whole checklist.",
    inputSchema: {
      type: "object",
      properties: { titles: { type: "array", items: { type: "string" }, minItems: 1 } },
      required: ["titles"],
    },
  },
  {
    name: "task_update",
    description:
      "Move one Task to open, doing, done or dropped, and/or replace its note. At most one Task is doing: finish or reopen it first. A dropped Task needs a one-line reason. Each change is saved at once. Answers with the whole checklist.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        state: { type: "string", enum: ["open", "doing", "done", "dropped"] },
        reason: { type: "string", description: "One line, required when state is dropped and only then." },
        note: {
          type: "string",
          description:
            "What you have learned on this Task that the next session would otherwise have to find again: findings, file paths, decisions, what is left. Replaces the Task's previous note; an empty string clears it. At most 4000 characters.",
        },
      },
      required: ["task_id"],
    },
  },
  {
    name: "checks_run",
    description:
      "Run your Story's Checks now, for feedback only: each runs from the worktree root, one at a time, and nothing is recorded. Answers with each Check's command, result (passed, failed, timed_out) and output tail. Checks can take minutes. You cannot edit or delete a Check: only the developer can.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "handoff",
    description:
      "Hand your Story off for review once its work is committed. Bring your Task checklist up to date first, with no Task left doing: the hand-off is refused otherwise. Flywheel then runs every Check, records each result against your branch's commit, and moves the Story to In review whatever the results. Leave a summary for the next session: what it must know, and what was decided (including any Check you think is wrong, and why). End your turn once it answers.",
    inputSchema: {
      type: "object",
      properties: {
        next_session_must_know: { type: "string", minLength: 1 },
        decisions: { type: "string" },
      },
      required: ["next_session_must_know", "decisions"],
    },
  },
] as const;

/** What each shaping tool tells the agent, and the arguments it takes. */
export const SHAPING_TOOL_DEFINITIONS = [
  {
    name: "round_post",
    description:
      "Post the next Round of the Stage you are shaping: a one-paragraph note on what the Round settles, then the numbered questions of the decision frontier. Each question has a short title (the line it folds to once answered), the question itself with its choices if it has any, a grounding line (what you read that raised it), your recommended answer worded so that accepting it answers the question, and a one-line reason for it. The developer answers each question on the board, accepting your recommendation or writing their own, and every answer is saved as it is given. This call waits until every question is answered, however long that takes, then answers with every answer, in order. Do not also ask the questions in your reply. Refused while a Round is still open in the Stage: wait on that one with round_wait instead. When an answer settles a decision that is hard to reverse, would surprise a reader and beat a real alternative, offer it as an ADR: a question of kind \"adr\" whose `adr` carries the file's path (docs/adr/NNNN-slug.md, the next free number in the ADR index), its whole text as the Story will write it, and the bar lines shown beside it and never written into the file: why it is hard to reverse, why it would surprise a reader, which alternative lost, and which ADRs it relates to. Without the first three it is not an ADR: do not offer it. Check the ADR index first and supersede a related ADR rather than duplicate it. The developer answers an ADR question Yes or No, so recommend Yes or No: Yes attaches the ADR to the Epic as an accepted Proposal and the Epic's first Story writes it verbatim; No drops it.",
    inputSchema: {
      type: "object",
      properties: {
        note: { type: "string", minLength: 1, description: "One paragraph: what this Round settles." },
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              title: { type: "string", minLength: 1, maxLength: 120, description: "A few words naming the decision." },
              question: { type: "string", minLength: 1 },
              grounding: { type: "string", minLength: 1, description: "What you read that raised the question." },
              recommended_answer: { type: "string", minLength: 1, description: "Your answer, as the developer would give it." },
              because: { type: "string", minLength: 1, description: "One line: why you recommend it." },
              kind: {
                type: "string",
                enum: ["question", "adr"],
                description: "\"question\" (the default), or \"adr\" to offer an ADR draft, answered Yes or No.",
              },
              adr: {
                type: "object",
                description: "Only for kind \"adr\": the draft and its bar lines.",
                properties: {
                  path: { type: "string", minLength: 1, maxLength: 1000, description: "docs/adr/NNNN-slug.md" },
                  text: { type: "string", minLength: 1, maxLength: 20000, description: "The ADR's whole text, as the Story will write it." },
                  hard_to_reverse: { type: "string", minLength: 1, maxLength: 1000, description: "Why the decision is hard to reverse." },
                  surprising: { type: "string", minLength: 1, maxLength: 1000, description: "Why it would surprise a reader." },
                  losing_alternative: { type: "string", minLength: 1, maxLength: 1000, description: "Which alternative lost." },
                  relates_to: { type: "string", maxLength: 1000, description: "The ADRs it relates to (ADR-NNNN…), or none." },
                },
                required: ["path", "text", "hard_to_reverse", "surprising", "losing_alternative"],
              },
            },
            required: ["title", "question", "grounding", "recommended_answer", "because"],
          },
        },
      },
      required: ["note", "questions"],
    },
  },
  {
    name: "round_wait",
    description:
      "In a roadmap Round, wait until the developer has decided every change you proposed, then get each decision. Otherwise: wait on the Round still open in the Stage you are shaping, posted by an earlier session that has ended. Your packet shows the Round and the answers the developer has given so far. This call takes the Round over and waits until every question in it is answered, however long that takes (at once if it already is), then answers with every answer, in order, exactly as round_post would have. Takes no arguments. Refused when no Round has been posted in the Stage: post one with round_post.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "propose_spec_change",
    description:
      "Propose new text for one field of the Epic you are shaping: its problem, scope, out_of_scope or exit_test. Give the field's whole new text, not a diff, and one line on why. The change is filed as a Proposal on the Epic card, where the developer accepts it, amends it or rejects it with a reason; nothing on the Epic changes until they do. This call is answered at once with the Proposal's id: keep shaping, do not wait for the decision. A rejected Proposal and its reason reach your next session's packet; do not propose it again without new evidence.",
    inputSchema: {
      type: "object",
      properties: {
        field: { type: "string", enum: ["problem", "scope", "out_of_scope", "exit_test"] },
        text: { type: "string", minLength: 1, maxLength: 20000, description: "The field's whole new text." },
        why: { type: "string", minLength: 1, description: "One line: what in the Rounds or the code makes this the better text." },
      },
      required: ["field", "text", "why"],
    },
  },
  {
    name: "propose_roadmap_change",
    description:
      "In a roadmap Round, propose one change to the Roadmap, with one line on why. `change` is one of: create_milestone (title: the outcome in one line, no date; exit_test), amend_milestone (milestone_id; a new title and/or exit_test), reorder_milestone (milestone_id; before_milestone_id, or null for the end of the Roadmap), retire_milestone (milestone_id), add_epic (title; problem; milestone_id, which defaults to the Milestone after the Current one) or drop_epic (epic_id). Use the ids your packet shows. The change shows on the Roadmap strip as a ghost row the developer accepts, amends or rejects; nothing changes until they do. A Done Milestone is frozen, a Milestone holding an open Epic cannot be retired and an Epic holding an open Story cannot be dropped. This call is answered at once; once every change is proposed, call round_wait for the developer's decisions.",
    inputSchema: {
      type: "object",
      properties: {
        change: {
          type: "string",
          enum: ["create_milestone", "amend_milestone", "reorder_milestone", "retire_milestone", "add_epic", "drop_epic"],
        },
        milestone_id: { type: "string", description: "The Milestone the change lands on, or the new Epic's Milestone." },
        epic_id: { type: "string", description: "drop_epic: the Epic to drop." },
        before_milestone_id: {
          type: ["string", "null"],
          description: "reorder_milestone: the Milestone to move before, or null for the end of the Roadmap.",
        },
        title: { type: "string", maxLength: 200, description: "A new Milestone's outcome, a new title, or a new Epic's title." },
        exit_test: { type: "string", maxLength: 4000, description: "The Milestone's exit test: observable, with no date." },
        problem: { type: "string", maxLength: 4000, description: "add_epic: the problem the new Epic solves." },
        why: { type: "string", minLength: 1, description: "One line: what in the trigger or the board makes this change right." },
      },
      required: ["change", "why"],
    },
  },
  {
    name: "roadmap_holds",
    description:
      "In a roadmap Round, say the Roadmap still holds as it is, with one line on why. This closes the Round with a \"Roadmap still holds\" line on the timeline; then end your session. Refused once you have proposed a change in this Round: call round_wait instead.",
    inputSchema: {
      type: "object",
      properties: {
        why: { type: "string", minLength: 1, description: "One line: why the Roadmap still holds after the trigger." },
      },
      required: ["why"],
    },
  },
  {
    name: "propose_story",
    description:
      "Propose one Story for the Epic you are slicing: a thin vertical slice that ships and can be tested on its own. Give its title, a description of what it ships and how it is tested, and its place in the Epic's execution order: `after` or `before` a Story (its key, such as FLY-12) or a New Story you proposed (its proposal_id); without either it goes at the end. When it must run after another Story, give `runs_after` (a key or a proposal_id) and a one-line `runs_after_reason` naming the constraint, such as \"shares `FeedRow.tsx`\"; the constraint is shown on the board and never blocks. The Story shows as a ghost column where it would land, for the developer to accept, amend or reject; nothing is created until they do. This call is answered at once with the Proposal's id: keep slicing, do not wait for the decision. A rejected Story and its reason reach your next session's packet; do not propose it again without new evidence.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 500, description: "A few words naming the slice." },
        description: { type: "string", minLength: 1, maxLength: 20000, description: "What the slice ships and how it is tested." },
        after: { type: "string", description: "A Story key or a New Story's proposal_id: it comes right after that one." },
        before: { type: "string", description: "A Story key or a New Story's proposal_id: it comes right before that one." },
        runs_after: { type: "string", description: "A Story key or a New Story's proposal_id it must run after." },
        runs_after_reason: { type: "string", maxLength: 500, description: "One line: the constraint, such as \"shares `FeedRow.tsx`\"." },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "propose_story_order",
    description:
      "Propose moving a Story of the Epic you are slicing to another place in its execution order (action \"move\", with `after` or `before` a Story key or a New Story's proposal_id; without either it moves to the end), or retiring a Story still in Shaping (action \"retire\": it is dropped). Give one line on why. The Proposal shows on the Story's column for the developer to accept or reject; nothing changes until they do. This call is answered at once: keep slicing, do not wait for the decision.",
    inputSchema: {
      type: "object",
      properties: {
        story: { type: "string", minLength: 1, description: "The Story's key, such as FLY-12." },
        action: { type: "string", enum: ["move", "retire"] },
        after: { type: "string", description: "For a move: the Story key or New Story proposal_id it comes right after." },
        before: { type: "string", description: "For a move: the Story key or New Story proposal_id it comes right before." },
        why: { type: "string", minLength: 1, description: "One line: why it moves or goes." },
      },
      required: ["story", "action", "why"],
    },
  },
] as const;

/** The permission-prompt tool's own definition. */
const APPROVE_TOOL_DEFINITION = {
  name: APPROVE_TOOL_NAME,
  description: "Ask a human on the Flywheel board to allow or deny a gated tool call.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: {},
    },
    required: ["tool_name"],
  },
} as const;

/** The tools the server lists to a session of `kind`, in order. */
export function toolsFor(kind: SessionKind) {
  return kind === "shaping" ? [...SHAPING_TOOL_DEFINITIONS] : [APPROVE_TOOL_DEFINITION, ...BOARD_TOOL_DEFINITIONS];
}

/** Issue #52: the wire shape a Task tool call sends over the per-run socket. A HELD call, like the
 * permission request: the agent waits for the Rust core's answer (the checklist, or the reason it
 * refused). Carries no run, session or Story id: identity comes from the socket the call arrives
 * on, never from an argument. */
export interface BoardToolRequestPayload {
  kind: "board_tool";
  requestId: string;
  tool: BoardToolName;
  args: unknown;
}

function isBoardToolPayload(parsed: unknown): parsed is BoardToolRequestPayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    (parsed as { kind?: unknown }).kind === "board_tool" &&
    typeof (parsed as { requestId?: unknown }).requestId === "string"
  );
}

export interface PermissionRequestPayload {
  requestId: string;
  toolName: string;
  input: unknown;
  /** Issue #81: set by the shim on a Gated `git` call. An `allow` answer to such a request also
   * carries an `approval` the shim hands to its git child, so git's pre-push hook does not ask the
   * developer a second time for the same push. */
  issueApproval?: boolean;
}

/** Issue #81: the two questions about an issued approval. Answered at once, never held: `check`
 * (from the pre-push hook, via `flywheel-shim --check-push-approval`) answers `{approved}`, and
 * `revoke` (from the shim, once its git child exits) answers `{revoked}`. */
export interface PushApprovalPayload {
  kind: "push_approval_check" | "push_approval_revoke";
  approval?: unknown;
}

function isPushApprovalPayload(parsed: unknown): parsed is PushApprovalPayload {
  const kind = (parsed as { kind?: unknown } | null)?.kind;
  return kind === "push_approval_check" || kind === "push_approval_revoke";
}

/** Plan 03-13 (D-53): the shim's fire-and-forget notice shape — `kind` is what distinguishes this
 * from {@link PermissionRequestPayload} on the wire (the routine payload never carries a `kind`
 * field at all). `runId` is the shim's own `FLYWHEEL_RUN_ID`; every other field is notice-specific
 * (`attempt`/`max`/`repository`/`command` for a retry, `repository`/`command`/`attempts` for an
 * exhaustion) — carried through verbatim rather than typed per-kind here, since this module has no
 * opinion on what a notice's payload means, only on routing it to `onNotice` unanswered. */
export interface PermissionNoticePayload {
  kind: "git_retry" | "git_lock_exhausted";
  runId: string;
  [field: string]: unknown;
}

/**
 * Resolve the directory the permission socket file is created under. Deliberately NOT
 * `os.tmpdir()` unconditionally: on macOS, `os.tmpdir()`/`$TMPDIR` resolves to a long, per-session
 * sandboxed path (`/var/folders/.../T/`) that, joined with this file's own
 * `flywheel-permission-<uuid>.sock` name, routinely exceeds `sockaddr_un`'s ~104-byte `SUN_LEN`
 * limit — `UnixStream::connect` in `packages/shim/src/main.rs::request_permission` then fails with
 * "path must be shorter than SUN_LEN", which the shim (correctly) treats as
 * `PermissionOutcome::Error` and refuses the command, but the socket the destructive gate is
 * supposed to raise a question on was never reachable at all. `packages/core/tests/
 * destructive_classifier.rs::scratch_socket_path` already avoids this exact failure mode in the
 * Rust test suite by preferring `/tmp`; this mirrors that choice for the real production socket
 * plan 03-19 (G-03-3) is what finally exercises this code path against a live session for the
 * first time — no prior wiring ever let a destructive command reach this socket at all. `/tmp` is
 * short and present on every POSIX system this product ships on; fall back to `os.tmpdir()` only
 * if `/tmp` itself is not writable (never silently — the fallback still fails loud downstream if
 * its own path is also too long, rather than masking the condition here).
 */
function socketBaseDir(): string {
  try {
    fs.accessSync("/tmp", fs.constants.W_OK);
    return "/tmp";
  } catch {
    return os.tmpdir();
  }
}

function isNoticePayload(parsed: unknown): parsed is PermissionNoticePayload {
  return (
    parsed !== null &&
    typeof parsed === "object" &&
    typeof (parsed as { kind?: unknown }).kind === "string"
  );
}

/** Issue #100: the developer's answers to an `AskUserQuestion` call, keyed by each question's own
 * `question` text, each value the chosen option label, the labels of a multi-select joined with
 * ", ", or the developer's own free text. The Rust core builds and checks this map
 * (`flywheel_core::domain::question::answers_for`); this process passes it through untouched. */
export type QuestionAnswers = Record<string, string>;

/** What the Rust core relays to settle one held `approve_action` call. */
export interface PermissionReply {
  decision: "allow" | "deny";
  /** Issue #81: the push approval an `allow` to a Gated `git` call carries for the shim. */
  approval?: string;
  /** Issue #100: present only when the held call was an `AskUserQuestion` the developer answered. */
  answers?: QuestionAnswers;
}

/**
 * The JSON the permission-prompt tool answers Claude Code with, for one relayed reply.
 *
 * A plain `allow` passes the tool's input back unchanged. An answered `AskUserQuestion` (issue
 * #100) is also an `allow`, but its `updatedInput` carries the original `questions` plus an
 * `answers` record keyed by each question's `question` text, each value the chosen label (several
 * joined with ", ") or the developer's free text. Without `answers`, the CLI tells the agent "The
 * user did not answer the questions." Source: Claude Agent SDK docs, "Handle approvals and user
 * input" > "Handle clarifying questions" > "Return answers to Claude" and "Response format"
 * (https://code.claude.com/docs/en/agent-sdk/user-input), confirmed against `claude` 2.1.304 in
 * headless stream-json mode with `--permission-prompt-tool`: the agent's tool result read
 * `Your questions have been answered: "Which colour should the button be?"="Blue", "Which platforms
 * should we ship to?"="macOS, Linux"`.
 */
export function permissionPromptResponse(input: unknown, reply: PermissionReply): Record<string, unknown> {
  if (reply.decision !== "allow") return { behavior: "deny", message: "Denied by user" };
  if (reply.answers !== undefined) {
    const questions =
      input !== null && typeof input === "object" ? (input as { questions?: unknown }).questions : undefined;
    return { behavior: "allow", updatedInput: { questions: questions ?? [], answers: reply.answers } };
  }
  return { behavior: "allow", updatedInput: input ?? {} };
}

export interface PermissionServerHandle {
  /** The Unix domain socket path the standalone server (spawned by the backend) connects to —
   * embedded verbatim into the `--mcp-config` JSON `buildClaudeArgv` builds. */
  socketPath: string;
  /** Settle a held call. A `requestId` matching no held call is ignored with a logged notice and
   * resolves nothing else — never an error, and never treated as "resolve some other call
   * instead." */
  resolvePermission(requestId: string, decision: "allow" | "deny", answers?: QuestionAnswers): void;
  /** Issue #52: settle a held Task tool call with the core's checklist, or with the reason it
   * refused. Shares `pending` and the "an unknown requestId is ignored with a logged notice"
   * contract with {@link resolvePermission}. */
  answerBoardTool(requestId: string, result: unknown, error?: string): void;
  /** Stop listening and remove the socket file. Safe to call more than once. */
  close(): void;
}

/**
 * SIDECAR-SIDE role. Opens a fresh Unix domain socket and returns a handle. `onRequest` is
 * invoked once per incoming connection with the parsed `{requestId, toolName, input}` — the
 * caller (`ClaudeCodeAdapter.startSession`) uses this to emit the `permission_request`
 * `AgentEvent` upstream. Nothing here decides an outcome: every connection stays open,
 * unresolved, until {@link PermissionServerHandle.resolvePermission} is called for its
 * `requestId` — there is no timer, no default and no allowlist anywhere in this function.
 *
 * `onNotice` (plan 03-13, D-53) is invoked once per incoming connection whose parsed line carries
 * a `kind` field — a fire-and-forget message from the shim, never a held request. That
 * connection is closed IMMEDIATELY after `onNotice` runs and is never added to `pending`.
 */
export function startPermissionServer(
  onRequest: (payload: PermissionRequestPayload) => void,
  onNotice: (payload: PermissionNoticePayload) => void,
  onBoardTool?: (payload: BoardToolRequestPayload) => void,
): PermissionServerHandle {
  const socketPath = path.join(socketBaseDir(), `flywheel-permission-${randomUUID()}.sock`);
  // A stale socket file from a previous run that was killed without cleanup would make `listen`
  // fail with EADDRINUSE — never plausible for a UUID-derived path, but removing defensively
  // costs nothing and avoids a hypothetical collision.
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // Did not exist — the expected, common case.
  }

  let closed = false;
  const pending = new Map<string, net.Socket>();
  // Issue #81: held requests whose `allow` should carry an approval, and the approvals issued and
  // not yet revoked. In memory only, so an approval never outlives this session's socket.
  const wantsApproval = new Set<string>();
  const liveApprovals = new Set<string>();

  const server = net.createServer((socket) => {
    const rl = createInterface({ input: socket });
    rl.once("line", (line) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }

      // Issue #52: a Task tool call carries `kind: "board_tool"` exactly, checked BEFORE the broader
      // notice check below (which matches any string `kind`). It is HELD like a permission request,
      // because the agent needs the core's answer back. With no handler there is nobody to answer,
      // so the call is refused at once rather than left hanging.
      if (isBoardToolPayload(parsed)) {
        if (!onBoardTool) {
          socket.end(JSON.stringify({ error: "this session has no Task board tool" }) + "\n");
          return;
        }
        pending.set(parsed.requestId, socket);
        socket.on("close", () => pending.delete(parsed.requestId));
        onBoardTool(parsed);
        return;
      }

      // Issue #81: checked BEFORE the notice check below, which matches any string `kind`.
      if (isPushApprovalPayload(parsed)) {
        const approval = typeof parsed.approval === "string" ? parsed.approval : "";
        const answer =
          parsed.kind === "push_approval_check"
            ? { approved: approval !== "" && liveApprovals.has(approval) }
            : { revoked: liveApprovals.delete(approval) };
        socket.end(JSON.stringify(answer) + "\n");
        return;
      }

      // Plan 03-13 (D-53): a notice carries `kind`, the routine held-request payload never does.
      // Closed IMMEDIATELY — never added to `pending` — because a notice has no answer; the
      // held-connection path below is otherwise entirely unaffected by this branch's existence.
      if (isNoticePayload(parsed)) {
        onNotice(parsed);
        socket.end();
        return;
      }

      const request = parsed as PermissionRequestPayload;
      pending.set(request.requestId, socket);
      if (request.issueApproval === true) wantsApproval.add(request.requestId);
      socket.on("close", () => {
        pending.delete(request.requestId);
        wantsApproval.delete(request.requestId);
      });
      onRequest(request);
    });
  });
  // WR-01 (03-REVIEW.md): `socketBaseDir` moved from the per-user, mode-0700 OS temp directory to
  // the shared, world-listable `/tmp` to fit `sockaddr_un`'s SUN_LEN limit — the unguessable
  // `randomUUID()` filename component no longer restricts who can find the path, since `/tmp` is
  // listable by every local account. Set an explicit owner-only mode as soon as the socket exists
  // so the reachable audience does not depend on the process umask. Wrapped in a `try`/`catch`
  // whose catch body is deliberately empty apart from this comment: `listen` has already
  // succeeded by this point, so a failed hardening call must degrade to "the socket is reachable
  // but at the default mode" rather than throwing out of a function whose caller
  // (`ClaudeCodeAdapter.startSession`) cannot recover from a throw here without refusing an
  // entire session — a worse outcome than the warning this closes.
  server.listen(socketPath, () => {
    try {
      fs.chmodSync(socketPath, 0o600);
    } catch {
      // See comment above — a failed chmod degrades to the previous (umask-derived) mode.
    }
  });

  return {
    socketPath,
    resolvePermission(requestId, decision, answers) {
      const socket = pending.get(requestId);
      if (!socket) {
        // An answer whose request id matches no held call — ignored, resolves nothing else.
        console.error(`[flywheel-board] no held call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      const issue = decision === "allow" && wantsApproval.has(requestId);
      wantsApproval.delete(requestId);
      if (!issue) {
        const reply: PermissionReply = decision === "allow" && answers !== undefined ? { decision, answers } : { decision };
        socket.end(JSON.stringify(reply) + "\n");
        return;
      }
      const approval = randomBytes(32).toString("hex");
      liveApprovals.add(approval);
      socket.end(JSON.stringify({ decision, approval }) + "\n");
    },
    answerBoardTool(requestId, result, error) {
      const socket = pending.get(requestId);
      if (!socket) {
        console.error(`[flywheel-board] no held board tool call for requestId=${requestId} — ignoring`);
        return;
      }
      pending.delete(requestId);
      socket.end(JSON.stringify(error !== undefined ? { error } : { result: result ?? null }) + "\n");
    },
    close() {
      if (closed) return;
      closed = true;
      server.close();
      try {
        fs.unlinkSync(socketPath);
      } catch {
        // Already gone.
      }
    },
  };
}

/**
 * Issue #52: forward one Task tool call over a fresh socket and settle ONLY when the Rust core's
 * answer comes back through the sidecar. The arguments are passed through untouched: the core
 * parses and refuses them, this process validates nothing. A refusal reaches the agent as a tool
 * error carrying the core's own reason, so it can correct the call.
 */
function relayBoardToolCall(
  socketPath: string,
  tool: BoardToolName,
  args: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath, () => {
      const payload: BoardToolRequestPayload = { kind: "board_tool", requestId, tool, args };
      socket.write(JSON.stringify(payload) + "\n");
    });
    socket.on("error", (err) => reject(err));
    const rl = createInterface({ input: socket });
    rl.once("line", (line) => {
      let parsed: { result?: unknown; error?: string };
      try {
        parsed = JSON.parse(line) as { result?: unknown; error?: string };
      } catch (err) {
        reject(err);
        return;
      }
      if (typeof parsed.error === "string") {
        resolve({ content: [{ type: "text", text: parsed.error }], isError: true });
      } else {
        resolve({ content: [{ type: "text", text: JSON.stringify(parsed.result ?? null) }] });
      }
    });
  });
}

/**
 * The standalone MCP server role. Connects a FRESH socket per tool call to `socketPath`,
 * forwards the call, and resolves ONLY when the socket answers — never locally. The response
 * shape (`{behavior: "allow"|"deny", ...}`) matches Claude Code's own documented
 * `--permission-prompt-tool` contract. It hosts `approve_action` and the board tools ({@link BOARD_TOOL_NAMES}).
 */
async function runStandaloneServer(socketPath: string, kind: SessionKind): Promise<void> {
  const server = new Server({ name: MCP_SERVER_NAME, version: "0.1.0" }, { capabilities: { tools: {} } });
  const listed = toolsFor(kind);
  const relayed = new Set<string>(listed.map((tool) => tool.name).filter((name) => name !== APPROVE_TOOL_NAME));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listed }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === APPROVE_TOOL_NAME && kind === "story") {
      const args = (request.params.arguments ?? {}) as { tool_name?: string; input?: unknown };
      const requestId = randomUUID();

      return new Promise((resolve, reject) => {
        const socket = net.createConnection(socketPath, () => {
          socket.write(
            JSON.stringify({
              requestId,
              toolName: args.tool_name ?? "unknown_tool",
              input: args.input ?? null,
            }) + "\n",
          );
        });
        socket.on("error", (err) => reject(err));
        const rl = createInterface({ input: socket });
        rl.once("line", (line) => {
          let parsed: PermissionReply;
          try {
            parsed = JSON.parse(line) as PermissionReply;
          } catch (err) {
            reject(err);
            return;
          }
          resolve({ content: [{ type: "text", text: JSON.stringify(permissionPromptResponse(args.input, parsed)) }] });
        });
        // Deliberately no setTimeout/setInterval anywhere in this function — the promise settles
        // ONLY when the socket answers (AGNT-06's central falsifiability requirement).
      });
    }

    if (relayed.has(request.params.name)) {
      return relayBoardToolCall(socketPath, request.params.name as BoardToolName, request.params.arguments ?? {});
    }

    // A tool this session's kind does not have: a tool error the agent can read, never relayed.
    return {
      content: [{ type: "text", text: `${request.params.name} is not a tool of this ${kind} session` }],
      isError: true,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const socketPath = process.argv[2];
  if (!socketPath) {
    console.error("usage: mcp-permission-server.js <socketPath> [story|shaping]");
    process.exit(1);
  }
  const kind: SessionKind = process.argv[3] === "shaping" ? "shaping" : "story";
  runStandaloneServer(socketPath, kind).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
