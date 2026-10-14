# Phase 2 — External API Coverage Matrix

**Produced:** 2026-09-10 (plan time, by `gsd-planner`)
**Detector:** `api-coverage.cjs --json` over this phase's drafted PLAN bodies plus its ROADMAP
section → `detected: true`.

The external surface this phase integrates is **the `claude` CLI binary's command-line and signal
surface**, driven by `packages/sidecar` (`ClaudeCodeAdapter`), plus **the Model Context Protocol
server surface** the sidecar hosts for the permission gate. Flywheel deliberately does **not**
integrate `@anthropic-ai/claude-agent-sdk` for the session-driving path — see 02-RESEARCH.md
"The sidecar-shape decision": Anthropic's current documentation excludes third-party products from
the subscription-credential path through that library, which would make AGNT-03 a documented policy
violation.

Every capability starts as `INTEGRATE`. This table is the **subtraction record**: each `OPT-OUT`
carries a one-line reason. Capability names are as they appear in `code.claude.com/docs` (CLI
reference, headless, permission-modes), fetched 2026-09-10 and cited in 02-RESEARCH.md.

## `claude` CLI — invocation surface

| capability | decision | reason |
|---|---|---|
| `-p` / print (headless) mode | INTEGRATE | |
| `--output-format stream-json` | INTEGRATE | |
| `--permission-mode acceptEdits` | INTEGRATE | |
| `--permission-mode plan` | INTEGRATE | |
| `--permission-mode default` | INTEGRATE | |
| `--permission-mode bypassPermissions` | INTEGRATE | |
| `--permission-mode dontAsk` | OPT-OUT | Not exposed: the launch sheet offers exactly four modes so its labels map one-to-one to adapter values (D-27/D-36). A fifth, unsurfaced mode would be a permission state the run record cannot explain. |
| `--permission-mode auto` | OPT-OUT | Same reason as `dontAsk`, and an auto-approving mode contradicts the blocking gate AGNT-06 exists to build. |
| `--permission-prompt-tool` | INTEGRATE | |
| `--mcp-config` | INTEGRATE | |
| explicit MCP config in place of worktree `.mcp.json` autodiscovery | INTEGRATE | |
| `--dangerously-skip-permissions` | OPT-OUT | Bypasses the permission gate this phase exists to build; `bypassPermissions` is the surfaced, per-run-recorded equivalent a user can actually choose and the board can explain. |
| `--resume <session-id>` | OPT-OUT | D-30 makes a fresh session on the reused worktree the only v1 path, to rehearse the thesis before Phase 4 tests it. `resumeSession` stays declared and capability-gated as unimplemented. |
| `--continue` | OPT-OUT | Same reason as `--resume`. |
| `--bare` | OPT-OUT | Would disable the project's own instructions, skills and tool config the agent needs, and force API-key-only, breaking the local path AGNT-03 requires. Unused on both paths (02-09 Task 2). |
| `--input-format stream-json` (mid-session steering) | OPT-OUT | Typing into a running session to steer it mid-task is a Deferred Idea in 02-CONTEXT.md; no Phase 2 success criterion names it and it implies an unresearched adapter surface. |
| `--verbose` / `--include-partial-messages` (token-level deltas) | OPT-OUT | D-32's feed is one row per normalised event; token deltas would multiply the persisted session log for no rendering benefit and work against PROC-07's flat-memory design. |
| `--model` | OPT-OUT | No phase requirement or locked decision names per-run model selection; the user's own configured default applies. Revisit when a per-run model choice is actually requested. |
| `--add-dir` (additional working directories) | OPT-OUT | The task's worktree is the entire intended scope (WORK-01, PROC-01); widening it would dissolve the isolation the fixed topology provides. |
| `--allowed-tools` / `--disallowed-tools` | OPT-OUT | Authorisation runs through the permission-prompt tool plus project-scoped `permission_rules` (D-38), inspectable and revocable in Settings. A static flag list would be a second, invisible surface. |
| `--settings` (settings-file override) | OPT-OUT | The worktree's own project configuration is deliberately what the agent runs under; the only thing supplied explicitly per spawn is the permission-prompt MCP server (T-02-02). |
| hooks (`SessionStart`, `SessionEnd`, `PreToolUse`, …) | OPT-OUT | Nothing in Phase 2's scope needs them; the agent→board write path where a hook could earn its place is Phase 6. |
| `claude --version` (capability probe) | INTEGRATE | |
| `claude login` / auth management | OPT-OUT | Flywheel never manages the user's auth: the user runs `claude login` and Flywheel spawns their already-authenticated binary. That is the boundary pitfall 5 rates existential and D-39 keeps auditable. |
| `cwd` (explicit working directory on spawn) | INTEGRATE | |
| child-process environment injection | INTEGRATE | |
| SIGINT (end the current turn) | INTEGRATE | |
| SIGTERM (tear down the process tree) | INTEGRATE | |
| SIGKILL | OPT-OUT | SIGTERM lets Claude Code tear down its own sub-process tree and run SessionEnd hooks first; a hard kill strands the orphans pitfall 4 warns about. Last-resort escalation belongs to Phase 3. |

## `claude` CLI — `stream-json` event surface

| capability | decision | reason |
|---|---|---|
| `system` / `init` (session id, model, tools) | INTEGRATE | |
| `system` / `api_retry` | INTEGRATE | |
| `assistant` message events | INTEGRATE | |
| `user` message events | INTEGRATE | |
| tool-use / tool-result content blocks | INTEGRATE | |
| `result` — `total_cost_usd` | INTEGRATE | |
| `result` — per-model token usage | INTEGRATE | |
| `result` — `subtype` (success, error_max_turns, …) | INTEGRATE | |
| any unrecognised line shape | INTEGRATE | Normalised to an `unknown` event carrying the verbatim line and still persisted — nothing is dropped. |

## Model Context Protocol — server surface

| capability | decision | reason |
|---|---|---|
| stdio transport server | INTEGRATE | |
| tool registration (one tool: the permission prompt) | INTEGRATE | |
| tool call handling with a deferred (held-open) response | INTEGRATE | |
| resources | OPT-OUT | The server exists solely to gate permissions; resources would give the agent a second channel the board never sees. The agent-to-board channel is Phase 5/6. |
| prompts | OPT-OUT | The initial prompt is assembled by `assemble_context_packet` in the Rust core (D-28), not served to the agent over MCP. |
| sampling | OPT-OUT | Would let the agent request model calls through Flywheel — out of scope and incompatible with the credential boundary D-39 draws. |
| notifications / progress | OPT-OUT | Not needed for a single held tool call; revisit only if 02-05 Task 2's empirical check shows a per-call server-side timeout keepalives would address. |
| multiple servers per spawn | OPT-OUT | Exactly one server is supplied per spawn, explicitly, so a worktree's own configuration cannot substitute a second permission gate (T-02-02). |

## Not integrated at all

| surface | decision | reason |
|---|---|---|
| `@anthropic-ai/claude-agent-sdk` session-driving `query()` API | OPT-OUT | Current Anthropic docs exclude third-party products from the subscription-login path through this library, so AGNT-03 via the SDK would be a documented policy violation. The raw CLI is the supported path. |
| Anthropic Messages API (direct HTTP) | OPT-OUT | Flywheel supervises a harness; it never makes model calls itself. `assemble_context_packet` is a pure query, never a model call (D-28). |

---

*Phase: 2 — One Agent, One Worktree, Watched Live*
*Matrix produced at plan time so the `api-coverage.verify-pre` seal gate has a validated artifact
rather than re-detecting at seal time.*
