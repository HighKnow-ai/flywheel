# Claude Code CLI: resuming a session and detecting a refusal

**Question** (wayfinder ticket "What does Claude Code's CLI offer for resuming a session and detecting a refusal?"): the facts an execution-reliability decision needs. What the `claude` CLI offers for resuming a headless `stream-json` session, what a refusal or a `[reasoning_extraction]` stop looks like on the wire, and how a crash, a refusal, a max-turns stop and a normal stop are told apart.

**Researched:** 2026-10-17, against `claude` **2.1.292** (`claude --version`). This file states facts. It makes no decision.

## Sources and how claims are marked

Every claim carries one or more tags:

| Tag | Source |
|---|---|
| `[D:headless]` | https://code.claude.com/docs/en/headless ("Run Claude Code programmatically") |
| `[D:sessions]` | https://code.claude.com/docs/en/sessions ("Manage sessions") |
| `[D:sdk-sessions]` | https://code.claude.com/docs/en/agent-sdk/sessions ("Work with sessions") |
| `[D:loop]` | https://code.claude.com/docs/en/agent-sdk/agent-loop ("How the agent loop works"), section "Handle the result" |
| `[D:ts]` | https://code.claude.com/docs/en/agent-sdk/typescript, `SDKResultMessage`, `SDKAssistantMessage`, `startup_failure_reason`, `resume_reason` (raw `.md` read, not a summary) |
| `[D:cli]` | https://code.claude.com/docs/en/cli-reference |
| `[D:env]` | https://code.claude.com/docs/en/env-vars |
| `[D:errors]` | https://code.claude.com/docs/en/errors, sections "Usage Policy refusal", "Safety measures flagged a cybersecurity topic", "Safeguards flagged a request for Claude's reasoning" |
| `[D:worktrees]` | https://code.claude.com/docs/en/worktrees, sections "Resume a worktree session" and "The session resumes outside its worktree" |
| `[D:cost]` | https://code.claude.com/docs/en/agent-sdk/cost-tracking, section "Recover totals after a session crash" |
| `[D:api-refusals]` | https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback, section "What a refusal looks like" |
| `[H]` | `claude --help` output, version 2.1.292 |
| `[P1]`..`[P7]` | Live probes run for this research, `--model haiku`, in scratch directories, a few cents in total. See "Probes" at the end |
| `[R]` | This repository: `packages/sidecar/src/claude-code-adapter.ts`, `scripts/uat/fixtures/unauthenticated-cli-first-turn.json`, `scripts/uat/lib/fake-authoring-claude.mjs`, and the `planning-archive` tag's phase 05 records |
| **UNVERIFIED** | Could not be confirmed against a primary source or an observation. Read as an open question |

The Agent SDK pages are cited because they document the CLI's own `stream-json` message shapes: the SDK drives the same binary, and the headless page links to them for the stream's types `[D:headless]`. Every result-line field quoted below was also observed on the raw CLI stream unless it is marked otherwise.

## What Flywheel spawns today

`[R]` `buildClaudeArgv` (task execution) spawns:

```
claude -p <prompt> --output-format stream-json --verbose --permission-mode <mode>
       [--permission-prompt-tool <tool> --mcp-config <cfg> [--allowedTools <name>]...]
       [--settings <hooks.json>]
```

`buildAuthoringClaudeArgv` (authoring) spawns the same thing with `--input-format stream-json` and no positional prompt, plus `--disallowedTools AskUserQuestion`.

Flags it does **not** use today: `--resume`, `--continue`, `--session-id`, `--fork-session`, `--max-turns`, `--max-budget-usd`, `--no-session-persistence`, `--bare`, `--permission-prompts none` `[R]`. `resumeSession()` on the adapter returns `defaultResumeSession()`, which is a capability-unsupported stub `[R]`.

What it already reads from the stream `[R]`: `system/init` (`session_id`, `model`), the `result` line's `subtype`, `total_cost_usd`, `session_id`, `usage`, `is_error` and `terminal_reason`. It does **not** read `stop_reason`, `errors`, `num_turns`, `api_error_status`, or the assistant envelope's `error` field. A comment in the adapter says not to classify on `subtype`, because an unauthenticated run reports `subtype: "success"` with `is_error: true` `[R]` (the fixture `unauthenticated-cli-first-turn.json` confirms it). Close attribution (`resolveCloseOrigin`) separates a supervisor signal, a watchdog heartbeat kill and a backend exit `[R]`.

## Part 1: resuming a session

### The flags

| Flag | What it does | Source |
|---|---|---|
| `--session-id <uuid>` | Use this exact ID for a **new** conversation. It must be a valid UUID | `[H]` `[D:cli]`, observed `[P1]` |
| `-r, --resume <id \| name \| path>` | Resume a specific session by ID or name. In place of an ID it also takes the absolute path to a session's `.jsonl` transcript | `[H]` `[D:cli]` `[D:headless]` |
| `-c, --continue` | Resume the most recent conversation in the current directory. `claude -p --continue` includes `-p` and SDK sessions; interactive `--continue` skips them | `[H]` `[D:cli]` `[D:sessions]` |
| `--fork-session` | With `--resume` or `--continue`: write to a new session ID that starts from a copy of the history. The original is left unchanged | `[H]` `[D:cli]` `[D:sdk-sessions]`, observed `[P3]` |
| `--no-session-persistence` | `-p` only: write no transcript, so the session cannot be resumed | `[H]` `[D:cli]` |
| `--max-turns <n>` | `-p` only: cap the tool-use turns. The run "exits with an error when the limit is reached". **Not listed in `claude --help` 2.1.292**, but documented and accepted | `[D:cli]`, `[H]` (absent), observed `[P4]` |
| `--max-budget-usd <amount>` | `-p` only: stop once estimated spend reaches the cap. Spend can pass the cap by one response | `[H]` `[D:cli]` `[D:loop]` |

How to capture the session ID: `system/init` carries `session_id` as its first non-hook event, and every `result` line carries `session_id`, error results included `[D:sdk-sessions]` `[D:loop]`, observed `[P1]`–`[P5]`. With `--session-id`, Flywheel can choose the ID before it spawns, so it doesn't have to parse it out of the stream: the init and result lines echoed the UUID that was passed in `[P1]`.

### Where transcripts live

- `~/.claude/projects/<project>/<session-id>.jsonl`, or `$CLAUDE_CONFIG_DIR/projects/...` when that variable is set. `<project>` is the absolute working directory with every non-alphanumeric character replaced by `-`. A converted name longer than 200 characters is truncated and gets a hash appended `[D:sessions]` `[D:sdk-sessions]`. Observed: the probe transcript landed at `$CLAUDE_CONFIG_DIR/projects/-private-tmp-claude-501--Users-...-scratchpad-probe-A/<sid>.jsonl` `[P1]`.
- Each line is a JSON entry for a message, a tool use or metadata. **The entry format is internal and changes between versions**, and scripts that parse the files directly can break on any release `[D:sessions]`. Observed entry types included `queue-operation`, `attachment`, `user`, `assistant`, `last-prompt`, `atis-latch` and `system/stop_hook_summary`. Every message entry carried `cwd`, `sessionId` and `gitBranch` `[P1]`.
- Default retention is 30 days (`cleanupPeriodDays`). `CLAUDE_CODE_SKIP_PROMPT_HISTORY` or `--no-session-persistence` suppresses writes. `CLAUDE_CODE_PROJECT_DIR_NAME` together with `CLAUDE_CONFIG_DIR` pins the project directory name (v2.1.234+) `[D:sessions]`.
- When resumed, a session keeps appending to its **original** transcript file. A resume launched from directory B wrote into the file under A's project directory `[P2]`.

### Lookup: where `--resume <id>` finds the session

It looks in the current project directory and its git worktrees first, then every other project on the machine. The cross-project search resolves only when exactly one other project holds the ID (v2.1.223+). An unknown ID reports `No conversation found with session ID: <id>` `[D:sessions]` `[D:cli]`. Resume works on the same machine only `[D:sdk-sessions]`.

### What a resumed headless session restores, and what it does not

| Aspect | Restored? | Source |
|---|---|---|
| Conversation history, including tool calls and results | Yes, in full. The probe's resumed run quoted the first prompt of the original run | `[D:sessions]` `[D:loop]`, observed `[P2]` |
| Model | Yes, apart from documented exceptions | `[D:sessions]` |
| Session ID | The same ID, unless `--fork-session` is passed | observed `[P2]` (same) and `[P3]` (new ID) |
| **Working directory** | **No. The resumed process runs in the directory it was launched from.** Resuming A's session from B gave `system/init.cwd` = B, and `pwd` through the Bash tool printed B | observed `[P2]`; the docs don't state the plain-directory case. The worktree case is below |
| Worktree binding (worktrees that **Claude Code itself** entered, under `.claude/worktrees/` or via `EnterWorktree`) | Re-entered on resume, `-p` included (v2.1.212+). A refusal stops a `-p` resume with a stderr error, except when the worktree is gone, in which case it resumes in the launch directory | `[D:worktrees]` |
| Permission mode | **No, under `-p`.** `claude -p --resume` starts in the mode a new `-p` run would, except that a session that ended in plan mode resumes in plan mode under certain conditions. Pass `--permission-mode` explicitly | `[D:sessions]` |
| `--mcp-config`, `--settings`, `--plugin-dir`, `--fallback-model`, `--add-dir` | **No. Pass them again on resume.** The standard settings files are re-read | `[D:sessions]` |
| "Allow for this session" permission grants | Not carried into a separate `--fork-session` process; that process re-approves | `[D:sessions]` |
| Background Bash and Monitor tasks | No. A background task that ended with the old process shows up as a note that it did not finish | `[D:sessions]` |
| Filesystem state | Not managed: "Sessions persist the conversation, not the filesystem" | `[D:sdk-sessions]` |
| Cost totals | `total_cost_usd` and `modelUsage` on a resumed run **include earlier runs' spend**. `--max-budget-usd` does not count the restored totals | `[D:headless]` `[D:cli]` `[D:ts]` |

### Resuming after a crash or a kill

- A tool that was still running when the process ended "doesn't finish or run again when you resume". Claude sees the call marked as cut off and is told to check whether it took effect before it runs it again `[D:sessions]`.
- SIGTERM: exit code **143**. The in-progress turn is left unfinished and **no result is recorded**. A running Bash command's process tree is terminated and recorded as killed. `SessionEnd` hooks run. To end the turn cleanly, send SIGINT (or the SDK's `interrupt()`) first `[D:headless]`. Observed: exit 143 and no `result` line `[P6]`.
- SIGKILL: exit **137** and no `result` line `[P6]`. A later `--resume` of the killed session worked. The transcript then held a synthetic assistant entry with the text `"No response requested."` after the cut-off tool result, then the new prompt `[P7]`. That synthetic entry is observed behaviour, not documented, and is an internal format.
- On resume, Claude Code leaves an interrupted turn as it is, and the next prompt drives the conversation. `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` makes it continue the interrupted turn instead, with `CLAUDE_CODE_RESUME_PROMPT` (default `Continue from where you left off.`) and an age bound, `CLAUDE_CODE_RESUME_INTERRUPTED_TURN_MAX_AGE_MS` (v2.1.211+). A turn continued this way carries `resume_reason` (for example `interrupted_turn`) on its result `[D:headless]` `[D:env]` `[D:ts]`. **UNVERIFIED by probe.**
- Two processes resuming the same session without forking interleave their messages into one transcript `[D:sessions]`.

## Part 2: what the stream says at the end of a run

### The `result` line

`[D:ts]` documents two arms:

- `subtype: "success"`, which has `result: string`.
- `subtype` one of `"error_max_turns" | "error_during_execution" | "error_max_budget_usd" | "error_max_structured_output_retries"`, which has `errors: string[]` and no `result`.

Both arms carry `is_error: boolean`, `stop_reason: string | null`, `terminal_reason?`, `num_turns`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, and the optional `api_error_status` and `result_index`.

- `stop_reason` is the model's stop reason on the final turn. Common values are `end_turn`, `max_tokens` and **`refusal`**. On loop-produced error results it carries the last assistant response's value. On the result synthesised after a crash it is `null`. "To detect refusals, check `stop_reason === "refusal"`" `[D:loop]`.
- `terminal_reason` is why the loop ended. It is one of `completed`, `max_turns`, `tool_deferred`, `aborted_streaming`, `aborted_tools`, `hook_stopped`, `stop_hook_prevented`, `background_requested`, `blocking_limit`, `rapid_refill_breaker`, `prompt_too_long`, `image_error`, `model_error`, `api_error`, `malformed_tool_use_exhausted`, `budget_exhausted`, `structured_output_retry_exhausted`, `tool_deferred_unavailable` or `turn_setup_failed` `[D:ts]`. No `refusal` value is listed.
- `startup_failure_reason` appears only on the `error_during_execution` result written before exiting on a known startup failure, for example `worktree_resume_refused`, `cwd_unavailable` or `session_held_by_background`. Several values need `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1`, and without it they end with stderr, a non-zero exit and **no result line** `[D:ts]`.
- The assistant envelope's optional `error` field is one of `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error` or `unknown`. `aborted: true` marks a message an interrupt cut short `[D:ts]`. No refusal value is listed.
- Assistant messages in the CLI stream carried `message.stop_reason: null` on every observed block, because they are emitted per content block. **Read `stop_reason` from the result line, not from assistant lines** `[P1]`–`[P4]`.
- Exit code: 0 on success, non-zero when the run fails. Failures inside the run, such as missing auth, are printed as the result on stdout. Invalid flags go to stderr before the run starts `[D:headless]`.

### Observed and documented terminal shapes

| Ending | Result line | Exit | Source |
|---|---|---|---|
| Normal stop | `subtype:"success"`, `is_error:false`, `stop_reason:"end_turn"`, `terminal_reason:"completed"` | 0 | observed `[P1]` `[P2]` `[P3]` `[P7]` |
| Max turns (`--max-turns 1`) | `subtype:"error_max_turns"`, `is_error:true`, `stop_reason:"tool_use"`, `terminal_reason:"max_turns"`, `errors:["Reached maximum number of turns (1)"]`, `result` absent | 1 | observed `[P4]`; `[D:loop]` `[D:cli]` |
| Max budget | `subtype:"error_max_budget_usd"`, `terminal_reason:"budget_exhausted"` (the docs list the value but don't pair it with the subtype) | non-zero | `[D:loop]` `[D:ts]`; **UNVERIFIED by probe** |
| Resume of an unknown ID | `subtype:"error_during_execution"`, `is_error:true`, `stop_reason:null`, `terminal_reason` absent, `num_turns:0`, `errors:["No conversation found with session ID: …"]`, and the same text on stderr | 1 | observed `[P5]` |
| API or auth error inside the run | `subtype:"success"` (sic), `is_error:true`, `terminal_reason:"api_error"`; the assistant envelope has `error:"authentication_failed"` and `is_api_error_message:true`, and model `"<synthetic>"` | unrecorded | `[R]` fixture captured on 2.1.273 |
| Process crash (Claude Code's own) | A final `error_during_execution` with `stop_reason:null` and possibly zeroed cost, then the process exits | non-zero | `[D:loop]` `[D:cost]`; **UNVERIFIED by probe** |
| SIGTERM from the supervisor | **No result line** | 143 | `[D:headless]`, observed `[P6]` |
| SIGKILL or OOM | **No result line** | 137 | observed `[P6]` |
| Startup failure (most kinds) | No result line unless `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1`; stderr message | non-zero | `[D:ts]` |
| Model refusal | See below | see below | see below |

### What a refusal looks like

**At the API layer** `[D:api-refusals]`, a refusal is an HTTP 200 with `stop_reason: "refusal"`, usually empty `content`, and `stop_details: {type:"refusal", category, explanation}`. `category` is one of `cyber`, `bio`, `frontier_llm`, **`reasoning_extraction`**, `general_harms`, or `null`. A refusal can arrive before any output or mid-stream after partial output, and partial output "should be treated as incomplete and discarded". Refusals before any output in the `bio`, `frontier_llm` and `reasoning_extraction` categories are billed.

**At the Claude Code layer** `[D:errors]`, the CLI renders the refusal as text that starts with `API Error:`:

- Usage Policy: `API Error: <model> can't help with this. Start a new session to continue.` (before v2.1.219: `Claude Code is unable to respond to this request, which appears to violate our Usage Policy…`).
- Cyber safeguards: `API Error: <model>'s safeguards flagged this message…`. On models with automatic fallback (Opus 5.5, Sonnet 5.5) it reads `<model>'s safeguards flagged this session`.
- Reasoning extraction: any of the above plus the line ``Details: `[reasoning_extraction]` `` (v2.1.234+). The trigger is an instruction to write out thinking verbatim or in a fixed format, such as a `<thinking>` section, a scratchpad, or a `reasoning` field in JSON or in a tool input. The instruction can sit in the prompt, CLAUDE.md, a skill, a subagent prompt, an output style or **an MCP tool description**.
- **Resuming does not clear a refusal.** "The check evaluates the full conversation… sending a new message in the same session usually re-triggers the same refusal. The same applies after exiting and reopening the session with `--continue` or `--resume`, since the transcript on disk still contains the triggering content." Under `-p`, the documented recovery is to "retry with a rephrased prompt in a new session without `--continue`", and switching `--model` "may" help.

**The real `reasoning_extraction` refusal this project hit** `[R]` (live run `01M399FP80B184QM2RXTXJDZTK`, 2026-09-24, Opus 5 1M; recorded under the `planning-archive` tag, 05-22-SUMMARY and 05-VALIDATION row 05-22-03, and reproduced verbatim in `fake-authoring-claude.mjs`): the text `API Error: Opus 5 (1M context)'s safeguards flagged this message (…aup). This sometimes happens with safe, normal conversations. … Details: \`[reasoning_extraction]\` … Request ID: req_…` arrived as an ordinary assistant text block, and the turn **ended on a normal `result` line** (`endedBy=result`). The trigger was a Flywheel distillation instruction ("call `propose_assumption` once for EACH assumption you challenged…"). The harness kept only normalised events, so **no raw `stream-json` capture of a refusal exists**. The values of `is_error`, `stop_reason`, `terminal_reason` and the assistant `error` on that result line were never recorded.

**What is not verified about refusals:**

1. **UNVERIFIED:** whether the CLI's `result.stop_reason` reads `"refusal"` on a Claude Code refusal. `[D:loop]` says to check it, but the CLI renders the refusal as synthetic `API Error:` text, the same family as the auth fixture, which carried `stop_reason:"stop_sequence"` and `is_error:true`. Both shapes are plausible.
2. **UNVERIFIED:** whether `is_error` is `true` and `terminal_reason` is `"api_error"` on a refusal. That is true of the auth-error fixture `[R]`, but nobody has observed it for a refusal.
3. **UNVERIFIED:** whether `stop_details` (with `category`) is passed through anywhere in the CLI stream. The auth fixture's assistant envelope has a `stop_details: null` key `[R]`, which suggests the field is carried, but no refusal has been captured.
4. **UNVERIFIED:** the exit code of a `-p` run whose last turn was refused.
5. The banner text is documented, but it is versioned wording: it changed at v2.1.203, v2.1.219 and v2.1.234 `[D:errors]`. A text match is fragile across upgrades, although today it is the only signal this repository has seen.

This research deliberately did not provoke a refusal to settle points 1 to 4. A capture is still needed: a deliberately reasoning-extraction-shaped prompt in a throwaway session, with the raw stream saved, is the cheapest way to get one.

### Telling the endings apart (facts only)

| Signal | Normal | Max turns | Budget | Refusal | Crash or API error | Supervisor kill |
|---|---|---|---|---|---|---|
| `result` line present | yes | yes | yes | yes `[R]` | yes, for a CLI-handled crash `[D:loop]`; no for most startup failures `[D:ts]` | **no** `[P6]` |
| `subtype` | `success` | `error_max_turns` | `error_max_budget_usd` | **UNVERIFIED** (an API-error result can read `success` `[R]`) | `error_during_execution` (crash), or `success` with `is_error` (API error `[R]`) | none |
| `is_error` | `false` | `true` | `true` (assumed, **UNVERIFIED**) | **UNVERIFIED** | `true` | none |
| `stop_reason` | `end_turn` | last turn's value (`tool_use` observed) | last turn's value | `refusal` per the docs; **UNVERIFIED** on the CLI | `null` (crash) | none |
| `terminal_reason` | `completed` | `max_turns` | `budget_exhausted` | **UNVERIFIED** | `api_error`, `model_error`, …; absent on a startup error `[P5]` | none |
| Text | model reply | none (`errors[]`) | none (`errors[]`) | starts with `API Error:`, maybe ``Details: `[reasoning_extraction]` `` `[D:errors]` `[R]` | `API Error: …` or `errors[]` | none |
| Exit code | 0 | 1 `[P4]` | non-zero | **UNVERIFIED** | non-zero (1 observed for a startup error `[P5]`) | 143 for TERM, 137 for KILL `[P6]` |
| Resumable? | yes | yes, "resume with a higher limit" `[D:sdk-sessions]` | yes | resumable, but **the same refusal usually re-triggers** `[D:errors]` | yes; the cut-off tool is flagged `[D:sessions]` | yes `[P7]` |

## Probes

All probes ran on 2026-10-17 with claude 2.1.292 and `--model haiku`, using `--output-format stream-json --verbose` and stdin from `/dev/null`. Directories A and B were empty scratch directories.

- **P1:** `claude -p "say hi" --session-id <uuid>` in A. Result: `success`/`end_turn`/`completed`, exit 0. The init and result lines echoed the given UUID, and the transcript appeared under A's project directory.
- **P2:** from B, `claude -p "<run pwd; quote my first message>" --resume <P1 uuid>`. Result: the same session ID, `init.cwd` = B, `pwd` = B, and the first message was quoted correctly. The transcript was appended to A's file.
- **P3:** from A, `--resume <P1 uuid> --fork-session`. Result: a new session ID, `success`.
- **P4:** `--max-turns 1` with a two-tool-call prompt. Result: `error_max_turns`, `is_error:true`, `stop_reason:"tool_use"`, `terminal_reason:"max_turns"`, `num_turns:2`, `errors:["Reached maximum number of turns (1)"]`, exit 1.
- **P5:** `--resume 00000000-0000-4000-8000-000000000000`. Result: `error_during_execution`, `is_error:true`, `stop_reason:null`, `num_turns:0`, the error text in `errors[]` and on stderr, exit 1.
- **P6:** a run killed mid-turn after its first `tool_use`. SIGTERM gave exit 143 and no result line. SIGKILL gave exit 137 and no result line.
- **P7:** `--resume` of the SIGKILLed session. Result: `success`. The transcript showed a synthetic `"No response requested."` assistant entry after the cut-off turn.
