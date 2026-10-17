# Claude Code CLI: resuming a session, and telling a crash from a refusal from a normal stop

Research for issue #24 (map #4). Question: what does the `claude` CLI, driven headless in
`stream-json` mode the way `packages/sidecar/src/claude-code-adapter.ts` drives it, offer for
resuming a session, what does a refusal or a `[reasoning_extraction]` stop look like, and how are a
crash, a refusal and a normal stop told apart?

Sources are tagged on every claim:

- **[obs]** observed on this machine, `claude` **2.1.292**, model `haiku` (Haiku 4.5), 2026-10-17.
  Raw captures were made in a scratch directory and are not committed. Each row below quotes the
  fields that matter.
- **[help]** `claude --help` output from 2.1.292.
- **[docs:…]** official Claude Code or Claude Platform docs (URLs in the source list at the end).
- **[repo]** this repository: code or committed fixtures.

## 1. What Flywheel does today

- Execution run argv (`buildClaudeArgv`): `-p <prompt> --output-format stream-json --verbose
  --permission-mode <m>`, plus `--permission-prompt-tool`/`--mcp-config`, `--allowedTools`
  entries and `--settings`. No `--resume`, `--continue`, `--session-id`, `--max-turns`,
  `--fork-session` or `--no-session-persistence`. [repo `claude-code-adapter.ts` ~L410-447]
- Authoring run argv adds `--input-format stream-json` and keeps stdin open. [repo ~L497-518]
- The parser keeps `session_id` from `system/init` and from `result`. From `result` it also keeps
  `subtype`, `is_error`, `terminal_reason`, cost and usage. It never reads `result.stop_reason`,
  `errors`, `api_error_status` or `origin`. On assistant lines it never reads the envelope's
  `error` or `is_api_error_message`. [repo ~L585-600, L1054-1076]
- Close classification comes from the process exit alone: `interrupted` if Flywheel asked for the
  stop, `completed` if the exit code is 0, `failed` otherwise. The result line plays no part.
  [repo ~L1665-1671]
- `resumeSession()` is declared on the adapter seam. It is stubbed: it throws
  `CapabilityUnsupportedError("supportsResume")`. [repo `adapter.ts` L6-8, L554-556;
  `claude-code-adapter.ts` L2001-2003]
- The one refusal ever seen live (run `01M399FP80B184QM2RXTXJDZTK`, Opus 5, authoring) was recorded
  as rendered text only. It was an ordinary assistant text turn starting `API Error: Opus 5 (1M
  context)'s safeguards flagged this message …` with `Details: \`[reasoning_extraction]\``,
  followed by a clean `result` line. No raw stream-json for it was captured. A text-banner reader
  in the UAT harness detects it. [repo `scripts/uat/lib/fake-authoring-claude.mjs` L436-480,
  `scripts/uat/lib/sidecar-harness.mjs` L950-1000, `scripts/uat/README.md` L397, L525-533]

## 2. Resume facts

| Fact | Evidence |
|---|---|
| `--resume <id>` works in `-p` + `stream-json` mode. The conversation comes back: the resumed run recalled a word set in the first run. | [obs] run2: `init.session_id` = original id, `result.result` = `PELICAN` |
| A plain `--resume` **keeps the same session id** and appends to the same transcript file. | [obs] run2: same id, same `.jsonl`, file grew |
| `--fork-session` (with `--resume`/`--continue`) mints a **new id**. It writes a new `.jsonl` holding a copy of the whole history. The original is left untouched. | [obs] run3: new id `15568101-…`, new 210 kB file; [help]; [docs:sessions-sdk] |
| `--continue` resumes the most recent session **recorded under the launch cwd**. `claude -p --continue` includes `-p` and SDK sessions. Plain interactive `--continue` skips them. | [obs] run9 picked the latest session in that dir; [docs:cli] `--continue` row |
| `--session-id <uuid>` lets the **caller choose the id up front**. Reusing an id that already exists fails at once: exit 1, stderr `Error: Session ID … is already in use.`, **empty stdout, no `init` and no `result`**. | [obs] run6, run7; [help] |
| Resuming an unknown id gives exit 1, plus a `result` with `subtype:"error_during_execution"`, `is_error:true`, `num_turns:0` and `errors:["No conversation found with session ID: …"]`. The same text goes to stderr. | [obs] run5; [docs:sessions] |
| `--resume` also accepts the absolute path to a session's `.jsonl` file in place of an id. | [docs:headless], [docs:cli] |
| `--resume <id>` finds the session from **any cwd**. It searches the current project dir and its git worktrees first, then every other project on the machine (since v2.1.223). The run then executes in the *launch* cwd: `init.cwd` was the new directory. The transcript is still appended to the **original** project dir's file. | [obs] run4 launched from `…/other`, `init.cwd` = `…/other`, the original file under `…-scratchpad-exp/` grew, and nothing was written under `…-other/`; [docs:sessions] |
| Transcripts live at `$CLAUDE_CONFIG_DIR/projects/<cwd with every non-alphanumeric char → "-">/<session-id>.jsonl` (default `~/.claude/projects/…`). Names over 200 chars are truncated and hashed. They are **retained 30 days** by default (`cleanupPeriodDays`). `--no-session-persistence` disables writing them. | [docs:sessions]; [obs] path confirmed; this machine sets `CLAUDE_CONFIG_DIR=/Users/cymarechal/cymarechal/.claude` |
| The transcript format is **internal and changes between versions**. Records seen: `queue-operation`, `attachment`, `user`, `assistant`, `system/stop_hook_summary`, `last-prompt`, `cost-state`, `atis-latch`. Each carries `cwd`, `gitBranch`, `sessionId`, `parentUuid` and `version`. Docs say to use `/export` or SDK readers rather than parse it. | [obs]; [docs:sessions] |
| **What survives:** prompts, every tool call and tool result, and assistant turns (the "full context"). The **filesystem is not snapshotted.** The system prompt is recorded on the first request and reused verbatim on resume until compaction (`--system-prompt-snapshot`). Flags such as `--permission-mode`, `--allowedTools`, `--mcp-config` and `--settings` are per-launch and must be passed again. | [docs:sessions-sdk], [docs:cli] system-prompt-snapshot; [obs] resumed run recalled the last tool call and its result |
| **Resume after a hard kill works.** After SIGKILL mid-tool (run11) and SIGTERM mid-turn (run13), `--resume` restored the conversation, including the in-flight tool call. | [obs] run14/run15 recalled `GIRAFFE` and the last Bash call |
| An interrupted turn is **not continued** on resume. The next prompt drives the conversation. `CLAUDE_CODE_RESUME_INTERRUPTED_TURN=1` makes the CLI continue the interrupted turn itself, with the continuation prompt `CLAUDE_CODE_RESUME_PROMPT` (default "Continue from where you left off."). `…_MAX_AGE_MS` bounds how stale that transcript may be. The continued turn's result carries `resume_reason` (e.g. `interrupted_turn`). | [docs:headless] "Stop a run with SIGTERM"; [docs:env-vars]; [docs:ts] `resume_reason` |
| **Resume can emit more than one `result` line.** When the session had a background task orphaned by the kill, the resumed run first emitted `system/task_notification`, a second `init`, and then a zero-turn `result` (`num_turns:0`, `result:""`, `origin:{kind:"task-notification"}`). Only after that came the real `init` → turn → `result`. | [obs] run14; [docs:ts] `origin` and the "empty results with `num_turns: 0`" paragraph |
| Worktree binding on resume (worktree refused or unverified → `error_during_execution` with `startup_failure_reason` `worktree_resume_refused`/`worktree_unverified`) applies **only to worktrees Claude Code itself entered** (`--worktree`/`EnterWorktree`). Flywheel creates its own worktrees and spawns with `cwd` = the worktree, so the session's project dir is simply that worktree path. | [docs:worktrees] "Resume a worktree session", "The session resumes outside its worktree" |
| A session held by a running **background** session refuses `--continue` with `startup_failure_reason:"session_held_by_background"`. | [docs:ts] `startup_failure_reason` |
| Cost on resume: `total_cost_usd`/`modelUsage` include the totals restored from earlier runs, so the result reports the conversation's whole spend. | [docs:headless]; [docs:ts] |
| A Usage-Policy refusal **re-triggers on resume**: the classifier sees the whole transcript. Docs say to retry in a **new session** (not `--continue`) or switch `--model`. | [docs:errors] "Usage Policy refusal" |

## 3. Stop facts: what the stream shows

### The final `result` line

`subtype` is one of `success | error_max_turns | error_during_execution | error_max_budget_usd |
error_max_structured_output_retries`. Every variant carries `is_error`, `session_id`, `num_turns`,
`total_cost_usd`, `usage`, `stop_reason` (`string|null`) and an optional `terminal_reason`. Error
variants add `errors: string[]`. [docs:ts] `SDKResultMessage`; [docs:agent-loop] "Handle the
result".

- `stop_reason` is the **model's** stop reason on the final turn: `end_turn`, `max_tokens`,
  `tool_use`, `stop_sequence`, `refusal`, `tool_deferred`. It is `null` on the result the CLI
  synthesises after a crash. Docs: "To detect refusals, check `stop_reason === "refusal"`."
  [docs:agent-loop]
- `terminal_reason` is the **loop's** reason for ending: `completed`, `max_turns`,
  `aborted_streaming`, `aborted_tools`, `hook_stopped`, `stop_hook_prevented`, `api_error`,
  `model_error`, `prompt_too_long`, `budget_exhausted`, `blocking_limit`, `turn_setup_failed`,
  `tool_deferred`, and others. [docs:ts] (the full list is at `terminal_reason`)
- The result can also carry `api_error_status` (HTTP status), `origin` (`task-notification` for
  injected follow-up turns), `result_index` (0-based delivery order; a gap means a lost result) and
  `startup_failure_reason`. [docs:ts]
- An observed success result also carries an **undocumented `safety_stops` field (integer, `0`)**.
  It is presumably a refusal counter, but this is unverified: no refusal was observed. [obs] run1
- **`subtype` lies on API errors.** The committed unauthenticated capture has
  `subtype:"success"` with `is_error:true`, `terminal_reason:"api_error"` and
  `stop_reason:"stop_sequence"`. The assistant line before it has a synthetic model `<synthetic>`,
  envelope `error:"authentication_failed"` and `is_api_error_message:true`. [repo
  `scripts/uat/fixtures/unauthenticated-cli-first-turn.json`, captured on 2.1.273]
- Trailing events can follow the `result` line: `prompt_suggestion`, background-task
  `task_notification`/`task_updated`, a second result for a background-task turn. **Do not treat
  the first `result` as end-of-run.** Read until EOF. [docs:agent-loop]; [obs] run10 emitted
  `task_*` events after its result.
- A `-p` run **stays alive after its result** while background work it started is running, up to
  a 10-minute idle cap (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`). [docs:headless] "Background tasks
  at exit"; [obs] run10 still alive 12 s after its success result.

### Refusal (including `[reasoning_extraction]`): not observed, from docs and the repo's one capture

- At the API, a classifier refusal is a **normal response, not an error**: `stop_reason:"refusal"`,
  with `stop_details.category` ∈ `cyber | bio | frontier_llm | reasoning_extraction |
  general_harms | null`. It can arrive before any output or mid-stream after partial output;
  partial output must be discarded. `reasoning_extraction`, `bio` and `frontier_llm` refusals
  before any output **are billed**. `reasoning_extraction` "has no recommended fallback model, so
  change the prompt rather than retry". [docs:refusals]
- Claude Code renders it as assistant text beginning `API Error: <model>'s safeguards flagged
  this message …` (or `… can't help with this. Start a new session to continue.` for the Usage
  Policy wording). Since v2.1.234 it ends with a line `` Details: `[reasoning_extraction]` `` naming
  the category, plus a Request ID. [docs:errors] "Usage Policy refusal", "Safeguards flagged a
  request for Claude's reasoning"; [repo] verbatim live text above
- `[reasoning_extraction]` means safeguards judged the request to be asking the model to reproduce
  its internal reasoning in the output: a `<thinking>` section, a scratchpad, a `reasoning` JSON
  field. The instruction can come from the prompt **or from loaded customisations**: CLAUDE.md,
  skills, subagent prompts, output styles, MCP tool descriptions. [docs:errors]
- Automatic model fallback: Claude Code re-runs a flagged request on a fallback model for
  cyber/bio flags on Fable/Opus 5.5/Sonnet 5.5/Opus 5. Under `-p`, if `switchModelsOnFlag:false`
  is set, the turn simply **ends with the refusal**. The session then continues on the fallback
  model. [docs:model-config] "Automatic model fallback"
- What is **not** confirmed for the CLI stream: whether the result line carries
  `stop_reason:"refusal"`, whether `is_error` is true, which `terminal_reason` it has, and whether
  the assistant envelope has an `error` field. Docs say `result.stop_reason` carries `refusal`.
  The repo's live run saw a "clean `result` line", but its fields were never recorded. **Mark it
  unobserved.** It was deliberately not provoked here.

### Observed stop shapes

| Run | How it ended | Exit | `result` line | Key fields |
|---|---|---|---|---|
| run1 | normal | 0 | yes | `success`, `is_error:false`, `stop_reason:end_turn`, `terminal_reason:completed` |
| run8 | `--max-turns 1` hit | **1** | yes | `error_max_turns`, `is_error:true`, `stop_reason:tool_use`, `terminal_reason:max_turns`, `errors:["Reached maximum number of turns (1)"]` |
| run12 | **SIGINT** mid-turn | **0** | yes | `error_during_execution`, `is_error:true`, `stop_reason:null`, `terminal_reason:aborted_streaming`; preceded by a `user` line `[Request interrupted by user]` |
| run13 | **SIGTERM** mid-turn | **143** | **no** | stream just stops after the last tool_result. Docs: "leaves the turn … unfinished and records no result" |
| run11 | **SIGKILL** mid-tool | **-9 (signal)** | **no** | stream just stops |
| run5 | resume unknown id | 1 | yes | `error_during_execution`, `errors:["No conversation found …"]`, `num_turns:0` |
| run7 | duplicate `--session-id` | 1 | **no, empty stdout** | stderr only |
| fixture | not logged in | not recorded | yes | **`subtype:"success"`** + `is_error:true` + `terminal_reason:"api_error"`; assistant envelope `error:"authentication_failed"` |

Argument-validation errors (e.g. stream-json without `--verbose`) exit 1 before any stdout line,
with the reason only on stderr. [repo adapter comment L415-422; docs:headless]

## 4. Detection table

Read the whole stream to EOF, keep the **last `result` whose `origin.kind` is not
`task-notification`**, and combine it with the process exit.

| Outcome | Exit | Last `result`? | How to detect |
|---|---|---|---|
| **Normal stop** | 0 | yes | `is_error:false` **and** `terminal_reason:"completed"` (or absent on old versions) **and** `stop_reason` ≠ `"refusal"` |
| **Refusal** (classifier, incl. `[reasoning_extraction]`) | 0 expected (unobserved) | yes, expected | Docs: `result.stop_reason === "refusal"`. Backstop: the final assistant text starts `API Error:` and contains `safeguards flagged` / `can't help with this`; the category is read from `` Details: `[<category>]` ``. **Unobserved in raw stream-json.** Keep the text reader until a capture confirms the wire field. |
| **Max turns / budget** | **1** | yes | `subtype:"error_max_turns"` / `"error_max_budget_usd"`, `terminal_reason:"max_turns"` / `"budget_exhausted"` |
| **API / auth error** | non-zero per docs | yes | `is_error:true` with `terminal_reason:"api_error"` (subtype may still say `success`); assistant envelope `error:<category>`, `is_api_error_message:true`; `api_error_status` |
| **Interrupted, graceful** (SIGINT or SDK interrupt) | **0** | yes | `subtype:"error_during_execution"`, `terminal_reason:"aborted_streaming"` (or `aborted_tools` when cut during a tool), a `[Request interrupted by user]` user line |
| **Killed** (SIGTERM, SIGKILL, OOM, watchdog) | 143 / signal | **no** | Missing terminal `result` + non-zero exit or signal. The session is still resumable from the transcript. |
| **Crashed inside the CLI** | non-zero | yes, synthesised | `error_during_execution`, `stop_reason:null`, cost fields may be zeroed, `queued_turn_count` absent, then the process exits [docs:agent-loop, docs:ts] |
| **Failed to start** | 1 | sometimes | `result` with `num_turns:0` and `startup_failure_reason`/`errors`, or no stdout at all and only stderr (arg errors, duplicate `--session-id`). `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1` makes more of these emit a result. |

## 5. Gaps in today's adapter (facts, not recommendations)

- Exit code alone misclassifies two cases. SIGINT-interrupted runs exit **0** and would read
  `completed`. Max-turns runs exit **1** and would read `failed`, though they are a resumable limit.
  A refusal very likely exits 0 and would read `completed`.
- `result.stop_reason`, `errors`, `origin` and the assistant envelope's `error` are not parsed.
  These are where a refusal, an API error category and an injected background turn are named.
- The adapter does not pass `--session-id`, so a session's id is first known when `init` arrives.
  A run killed before `init` leaves no id on record. With `--session-id` the id is fixed before
  spawn, at the cost of the "already in use" failure if it is reused.
- Flywheel stops runs with signals (`-child.pid`, SIGTERM then escalation). Per docs, SIGTERM
  "records no result". Sending SIGINT first would make the CLI close the turn and emit a result.

## Sources

- [help] `claude --help`, Claude Code 2.1.292 (`claude --version`).
- [docs:headless] https://code.claude.com/docs/en/headless — exit codes, SIGTERM/143, background
  wait, `--continue`/`--resume`, cross-dir resume.
- [docs:cli] https://code.claude.com/docs/en/cli-reference — `--resume`, `--continue`,
  `--fork-session`, `--session-id`, `--max-turns`, `--no-session-persistence`,
  `--system-prompt-snapshot`.
- [docs:sessions] https://code.claude.com/docs/en/sessions — lookup order, transcript location
  and retention, format is internal.
- [docs:sessions-sdk] https://code.claude.com/docs/en/agent-sdk/sessions — continue/resume/fork
  semantics, what is restored, filesystem not snapshotted.
- [docs:agent-loop] https://code.claude.com/docs/en/agent-sdk/agent-loop — result subtypes,
  `stop_reason` incl. `refusal`, crash result shape, trailing events.
- [docs:ts] https://code.claude.com/docs/en/agent-sdk/typescript — `SDKResultMessage`,
  `terminal_reason` values, `origin`, `resume_reason`, `startup_failure_reason`,
  `SDKAssistantMessageError`.
- [docs:errors] https://code.claude.com/docs/en/errors — Usage Policy refusal, cyber flag,
  "Safeguards flagged a request for Claude's reasoning" (`[reasoning_extraction]`).
- [docs:model-config] https://code.claude.com/docs/en/model-config — automatic model fallback on
  flagged requests, `switchModelsOnFlag`.
- [docs:worktrees] https://code.claude.com/docs/en/worktrees — resume into worktrees, refusal
  results.
- [docs:env-vars] https://code.claude.com/docs/en/env-vars — `CLAUDE_CODE_RESUME_INTERRUPTED_TURN`
  (+ `_MAX_AGE_MS`, `CLAUDE_CODE_RESUME_PROMPT`), `CLAUDE_CODE_STARTUP_FAILURE_RESULTS`,
  `CLAUDE_CODE_TRANSCRIPT_LOCAL_GC`.
- [docs:refusals] https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback —
  `stop_reason:"refusal"`, `stop_details.category`, billing, partial output.
- [repo] `packages/sidecar/src/claude-code-adapter.ts`, `packages/sidecar/src/adapter.ts`,
  `scripts/uat/fixtures/unauthenticated-cli-first-turn.json`,
  `scripts/uat/lib/fake-authoring-claude.mjs`, `scripts/uat/lib/sidecar-harness.mjs`,
  `scripts/uat/README.md`.
