# Architecture Research: Flywheel (Agentic Development Environment)

**Domain:** Local-first desktop app supervising many AI coding agents across many projects via git worktree multiplexing, with an agent-writable board as store of record.
**Researched:** 2026-09-08
**Confidence:** HIGH on process/schema/adapter design (verified against current CLI docs for Claude Code, Codex CLI, Gemini CLI); MEDIUM on desktop-shell specifics (deferred to STACK.md) — this document treats the shell as an implementation detail behind the process boundary, not a dependency of the architecture.

---

## 1. Process Topology — Structural cwd-Drift Elimination

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│  RENDERER PROCESS(ES)  — one per window (Electron/Tauri renderer)         │
│  Board view · Fleet view · Session viewer · Epic-authoring chat           │
│  NO filesystem access. NO git access. Talks to Supervisor over IPC only.  │
└───────────────────────────────┬────────────────────────────────────────--┘
                                 │ IPC / local RPC (request-response + subscribe)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  SUPERVISOR PROCESS  (single, long-lived, one per app instance)           │
│  ─────────────────────────────────────────────────────────────────────── │
│  • Domain DB (SQLite) — mutable projection + append-only event log        │
│  • Planner (fan-out, wave grouping, overlap guard)                        │
│  • Context Assembler (builds packets from DB, no LLM call)                │
│  • Worktree Manager (git plumbing, always explicit paths — see below)     │
│  • Adapter Registry (spawns/owns worker processes)                        │
│  • MCP Board-Server (agent write path)                                    │
│  • Trigger dispatcher (user_action today; schedule/webhook are future     │
│    producers into the same table)                                        │
│                                                                            │
│  Own cwd is pinned at launch to the app's data directory and NEVER        │
│  reassigned. `process.chdir()` is banned repo-wide (lint rule). Every     │
│  git/fs call takes an explicit absolute path as an argument — cwd is      │
│  never an implicit parameter anywhere in this process.                    │
└───────┬───────────────────────┬───────────────────────┬──────────────────┘
        │ spawn(cwd=worktreeA)  │ spawn(cwd=worktreeB)   │ spawn(cwd=worktreeC)
┌───────▼──────────┐   ┌────────▼─────────┐   ┌──────────▼────────┐
│ WORKER PROCESS A  │   │ WORKER PROCESS B  │   │ WORKER PROCESS C   │
│ (Claude Code CLI)  │   │ (Claude Code CLI)  │   │ (Claude Code CLI)   │
│ cwd = worktree A   │   │ cwd = worktree B   │   │ cwd = worktree C    │
│ separate OS process, separate memory, separate cwd register — cannot     │
│ mutate the Supervisor's cwd under any circumstance.                      │
│ stdout: JSONL event stream → Supervisor (one-way, narrow channel)        │
└────────────────────┘   └────────────────────┘   └─────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|-----------------|-------------------------|
| Renderer | Presentation only; board/fleet/session UI | Electron/Tauri webview + framework (deferred to STACK.md) |
| Supervisor | Owns DB, planner, context assembly, adapter lifecycle, trigger dispatch | Single Node/Rust process; no LLM reasoning of its own except optional planner-assist calls |
| Worker | Runs exactly one agent CLI session in exactly one worktree | `child_process.spawn(cmd, args, { cwd: absPath, env })`, stdout piped as JSONL |
| Persistence | Domain DB + git worktrees on disk | Embedded SQLite (or equivalent) + native git via explicit-path wrapper |

### Why cwd-drift is structurally impossible, not merely guarded against

GSD-core's guard (`execute-phase.md:495-567`, marked `# gsd:guard=orchestrator-cwd-drift`) exists because its orchestrator is **a single long-lived conversational agent process** whose own shell/tool state can be left pointed inside a worktree after a nested `Agent(isolation="worktree")` dispatch returns — the orchestrator and the thing it dispatches share a process identity (the same LLM conversation, the same tool-call shell), so a `cd` performed on its behalf can outlive the dispatch. The guard is a runtime `git rev-parse --show-toplevel` + branch-namespace check that runs on every wave entry because the failure is otherwise silent and catastrophic (a wrong-base merge of ~1000 files, per the guard's own comment).

Flywheel's Supervisor is not an LLM shelling out with inherited state — it is deterministic application code. Two independent design choices make the GSD failure mode categorically unrepresentable, not just detected:

1. **Process separation, not shell-state separation.** Each agent session is a genuinely separate OS process (`child_process.spawn`), not a nested tool call inside the Supervisor's own execution context. A child process's cwd cannot leak back into the parent's cwd at the OS level — there is no mechanism by which it could, unlike a single process whose internal shell state a nested call might mutate.
2. **cwd is never an addressing mechanism in Supervisor code.** Every git operation goes through one wrapper (`gitAt(absPath, args)` → `git -C <absPath> ...`) and every filesystem operation takes an absolute path resolved from the DB record (`Worktree.path`), never `process.cwd()`. The Supervisor's own cwd is set once at process launch to the app data directory and is never read as an implicit argument anywhere. Even if something external mutated it, no code path would notice or be affected, because nothing depends on it.

Defense in depth (belt-and-suspenders, not load-bearing): a repo-wide ESLint rule (`no-restricted-syntax` on `process.chdir`) and a CI check that greps for bare `cwd`-less `git`/`fs` calls in `packages/core`, so a future contributor cannot reintroduce the pattern GSD had to guard against at runtime.

**Confidence:** HIGH — this is an architectural argument grounded directly in the reference implementation studied (`execute-phase.md`), not an external claim requiring verification.

---

## 2. Domain Schema — Concrete Entities and Relationships

### Entity-Relationship Overview

```
Actor (human|agent|system) ─── attributed on every mutation & every Event row
   │
Project ──1:N── Epic ──1:N── Task ──1:1── Worktree ──1:N── AgentRun ──1:N── SessionSummary
                   │            │                              │  │
                   │            └──1:N── Issue (agent-proposed)│  ├──1:N── Event
                   └──1:N── Issue                               │  ├──1:N── Artifact (diff/log/snapshot)
                                                                  │  └──1:N── PermissionRequest
                                                                  │
Trigger (user_action|schedule|webhook) ──1:N── AgentRun (via trigger_id)
```

### Entities

| Entity | Key fields | Notes |
|--------|-----------|-------|
| **Actor** | id, type (`human`&#124;`agent`&#124;`system`), display_name, auth_ref (nullable) | Exists from day one even in single-user v1. Every mutation and every Event row carries an `actor_id`. |
| **Project** | id, name, repo_path (absolute), default_branch | |
| **Epic** | id, project_id, title, description, status (`draft`&#124;`active`&#124;`integrating`&#124;`done`&#124;`archived`), integration_branch, created_by | |
| **Task** | id, epic_id (nullable), title, description, acceptance_criteria (structured list), status, declared_file_set (globs), wave (nullable), worktree_id (nullable until first run), created_by | `declared_file_set` feeds the planner (Section 4). |
| **Issue** | id, project_id, epic_id/task_id (nullable), title, body, kind (`bug`&#124;`idea`&#124;`question`&#124;`risk`), status (`proposed`&#124;`triaged`&#124;`accepted`&#124;`rejected`&#124;`merged_into_task`), origin (`human`&#124;`agent`), proposed_by | The agent-proposal inbox; separate lifecycle from Task (Section 6). |
| **Worktree** | id, task_id (1:1, owning), path (absolute), branch, base_branch, status (`active`&#124;`stale`&#124;`merged`&#124;`abandoned`) | Durable — outlives many AgentRuns. |
| **AgentRun** (session) | id, worktree_id, task_id, adapter (`claude_code`&#124;`codex`&#124;`gemini`, string/enum), actor_id, trigger_id, status, cost_usd, tokens_in/out, external_session_id, exit_summary_id | Ephemeral — many per Worktree. First-class, not JSON-on-Task. |
| **SessionSummary** | id, agent_run_id, worktree_id, task_id, content (structured), diff_ref, created_at | Produced at session end (Section 3). Independently queryable across runs. |
| **Event** | id, stream_id, actor_id, type, payload (JSON), occurred_at, sequence (monotonic per project) | Append-only, immutable — the change feed (Section 2.1). |
| **Trigger** | id, source (`user_action`&#124;`schedule`&#124;`webhook`&#124;`agent_proposal`), config (JSON), target, enabled, created_by, last_fired_at | Generic fan-in for anything that starts agent work (Section 2.3). |
| **PermissionRequest** | id, agent_run_id, tool_name, input_payload, status, resolved_by, resolved_at | |
| **Artifact** | id, agent_run_id, worktree_id, kind (`diff`&#124;`file_snapshot`&#124;`log`&#124;`screenshot`), storage_ref | |

### 2.1 Event log vs. mutable projection: CQRS-lite with an outbox, not full event sourcing

Every mutation runs in **one DB transaction** that writes/updates the relevant mutable row (`tasks`, `epics`, `issues`, `agent_runs`, …) **and** appends a row to `events`, so the two can never diverge. This is the standard **transactional outbox pattern**:

- **Mutable tables** are what the renderer reads and subscribes to for live UI (list tasks where status=in_progress, join epic→task→worktree, etc.) — normal relational queries, not event replay.
- **`events`** is what a future relay subscribes to: a strictly monotonic per-project `sequence` lets a remote subscriber ask "everything since sequence N" — a resumable cursor, no replay-from-genesis required.

Full event sourcing (state derived by replaying all events on every read) was rejected: replay cost grows unboundedly over a project's life with thousands of agent-run events, and the renderer's query ergonomics (filter/sort/join across current state) are far simpler against normalized mutable tables than against a materialized-view rebuild. The event log is a record of *what happened* for audit and sync — not the query interface.

### 2.2 Agent runs, worktrees, branches, diffs, summaries are first-class

`Worktree`, `AgentRun`, `SessionSummary`, `Artifact` are top-level tables with their own primary keys and foreign keys into `Task` — not JSON blobs attached to a Task row. This is load-bearing for three things that would otherwise be impossible: (a) the fleet-supervision view needs `SELECT * FROM agent_runs WHERE status='running'` across all projects; (b) `SessionSummary` must be independently queryable and orderable across many runs per worktree for context reconstitution (Section 3); (c) diffs/artifacts need an independent storage lifecycle (large blobs, retention/cleanup) decoupled from task rows.

### 2.3 Generic trigger abstraction

`Trigger.source` is one of `user_action | schedule | webhook | agent_proposal`. All sources funnel through the same `TriggerFired` event type and the same command handler, `startAgentRun(taskId, triggerId)`. In v1, only `user_action` triggers exist — clicking "Run" in the UI inserts a `Trigger(source=user_action)` row and fires it inline. The schema and the command handler are indifferent to *who* produces `Trigger` rows: a future `SchedulerDaemon` inserting `Trigger(source=schedule)` rows on a cron tick, or a `WebhookListener` inserting `Trigger(source=webhook)` rows on inbound HTTP, are new **producers** only — zero change to `startAgentRun`, `AgentRun`, or anything downstream. See Section 7 for what breaks without this seam.

---

## 3. Context-Reconstitution Mechanism

This is the product's core wedge: worktrees are durable and task-owned; sessions are ephemeral and disposable; each new session rebuilds context from the board, not from a transcript.

### The context packet

Assembled by a Supervisor-side **ContextAssembler** — a pure, deterministic query function `assembleContextPacket(taskId) -> ContextPacket`, **not an LLM call**, so it is cheap, reproducible, and testable. Contents, in order:

1. **Task record** — title, description, structured acceptance criteria (never prose the agent has to re-parse).
2. **Epic context** — epic goal, integration-branch topology, epic-wide constraints (an epic-scoped equivalent of a north-star doc).
3. **Recent SessionSummaries** for this task's worktree, most recent first, verbatim up to a cap (e.g. last 3–5); older ones are compacted (Section 3.2).
4. **Diff-so-far** — `git diff <base>...HEAD` for the worktree; full diff if small, file-list + stat with on-demand full-diff tool access if large.
5. **Unresolved PermissionRequests / human triage notes** since the last session.
6. **Open Issues** proposed by prior sessions on this task that are still `proposed`/`triaged` — so a new session doesn't re-discover what a previous one already flagged.
7. **Project conventions** — CLAUDE.md-equivalent / project skills, same role as in GSD.

### Who assembles it, and where summaries are produced

- **Assembly**: Supervisor, at `AgentRun` creation, before the worker process is spawned. The packet is handed to the Agent Adapter as part of `startSession`/`resumeSession` (Section 5).
- **Production**: at the *end* of every AgentRun, the adapter's closing turn (or a dedicated `report_summary` tool exposed via the MCP board-server, Section 6) asks the agent to emit a structured summary — what changed, what's left, what it would tell the next session, open questions. The Supervisor captures this and writes `SessionSummary`, linked to `AgentRun` and `Worktree`.
- **Fallback**: if a session is interrupted/crashes before emitting one, the Supervisor synthesizes a best-effort summary from the diff + event log, flagged `auto_generated: true`, so reconstitution never has a hard gap.

### 3.2 Preventing silent degradation across many sessions

This is the "telephone game" risk with any summary-of-summaries scheme. Mitigations, layered:

- **Verbatim cap + compaction, not unbounded prose accumulation.** Only the last N summaries are included verbatim; once a worktree's summary count exceeds a threshold, the oldest ones are compacted into a single "epoch summary" that preserves decisions and open questions but drops narrative — analogous to log compaction, not a straight LLM re-summarization chain (which would itself drift).
- **Ground truth is the diff, not accumulated prose.** The packet always includes the actual `git diff`, so "what's really true" is re-derived from git state every session rather than inherited from a chain of summaries. This is precisely the anti-rot property chat-native tools lack: a transcript only ever grows, and its ground truth is whatever the model last said about itself; the board's ground truth is the diff, which cannot drift.
- **Acceptance criteria are immutable and pulled from `Task`, never from any summary** — criteria can never be silently rephrased away over many sessions.
- **Staleness detection.** Each `SessionSummary` stores `diff_ref` (the commit range it was written against). If new commits landed since (e.g. a human edited the worktree directly), the packet surfaces "N commits since last summary" plus their messages, so a fresh session isn't blind to out-of-band changes.
- **Integrity check.** The Supervisor can compare a summary's claimed touched-files against the actual `git diff --name-only` for that range and flag mismatches in the packet as a warning line, rather than trusting summary text blindly.

---

## 4. Planner and Fan-Out

### What GSD-core does (studied from `execute-phase.md`)

- The unit of parallelism is the **plan**, not the epic/task hierarchy. Each plan declares `files_modified` up front (frontmatter) and is assigned a `wave` number by dependency analysis; waves run sequentially, plans within a wave run in parallel, each in its own worktree.
- **Pre-spawn runtime guard**: before spawning any wave, a pairwise overlap check across every plan's `files_modified` runs; if any two plans in the wave share a file, the **entire wave** is downgraded to sequential execution (`execute-phase.md:595-627`), and the overlap is reported as a planning defect for the user to consider replanning.
- **Per-plan worktree gating**: submodule paths are intersected against each plan's `files_modified`; a plan touching a submodule path loses worktree isolation individually, even inside an otherwise-parallel wave (`per-plan-worktree-gate.md`, referenced at step 2.5).
- **Orchestrator cwd-drift guard**: a hard runtime check at wave-execution entry (Section 1 above).

The transferable lesson, already captured in PROJECT.md: **the partitioning key for parallelism is file-set disjointness, not issue hierarchy.**

### Flywheel's equivalent, and what to improve

The **Planner** is a Supervisor-side component (it may invoke an LLM for judgment on decomposition, but only ever writes structured output back to the DB — it is not itself a long-running conversational agent).

1. **Where the declared file-set comes from.** Primarily human/agent-declared during Socratic task decomposition — the epic-authoring conversation asks "what will this touch?" and records it on `Task.declared_file_set`. If omitted, the Planner can generate a first-pass forecast via a lightweight LLM read of the repo structure before fan-out, but this is stored with `source: planner_inferred` (vs. `source: declared`), distinguishing forecast from commitment.
2. **Wave grouping**: build a dependency graph from explicit `depends_on` task links plus file-set overlap within the same epic; two tasks with overlapping `declared_file_set` cannot share a wave. Persist as `Task.wave`, matching GSD's model.
3. **Pre-spawn overlap guard**: same pairwise check as GSD, run before spawning any AgentRun in a wave.
4. **Improvement — per-pair, not whole-wave, downgrade.** Because Flywheel's units are per-task worktrees (cheap to serialize individually via a lock), a detected overlap between task A and task B need only sequentialize *that pair*, not demote every task in the wave to sequential — a finer-grained version of GSD's whole-wave downgrade, made possible because Flywheel worktrees are already isolated at the git level rather than GSD's shorter-lived per-plan worktrees.
5. **Improvement — a live, mid-run guard, not just pre-spawn.** GSD's guard only runs once, before a wave is dispatched, because its plans are short-lived single-shot executions. Flywheel's tasks run long-lived worktrees across many sessions, so a forecast can be wrong *mid-flight*, well after dispatch. The Supervisor periodically (or on every commit event from a worker) diffs each active worktree's actual touched files (`git diff --name-only <base>...HEAD`) against the declared/actual file-sets of other active worktrees in the same wave.
6. **What happens when the forecast is wrong mid-run.** Rather than killing a running agent mid-edit (expensive, discards progress), a detected live collision: (a) raises an `Issue` documenting the forecast miss and surfaces it to the human, and (b) blocks the *later* of the two worktrees from merging into the epic integration branch until the earlier one merges and the later rebases. The overlap becomes a **merge-order constraint discovered lazily at the epic integration branch**, not a hard mid-session abort — the cheapest intervention point given that actual damage from an overlap is only realized at merge time, not during isolated editing.
7. **Topology is fixed**, per the PROJECT.md decision (task worktree → epic integration branch → main): the Planner never chooses topology, unlike GSD's planner, which also owns `branching_strategy`. This removes a whole class of decision GSD has to make.

---

## 5. Agent Adapter Interface

### Contract

```typescript
interface AgentAdapter {
  readonly id: 'claude_code' | 'codex' | 'gemini' | string;
  readonly capabilities: AdapterCapabilities; // supportsResume, supportsLiveInterrupt, supportsPermissionStreaming

  startSession(params: {
    worktreePath: string;           // absolute; passed as explicit cwd to spawn()
    contextPacket: ContextPacket;
    permissionMode: 'plan' | 'edit' | 'auto';
  }): AsyncIterable<AgentEvent>;

  resumeSession(params: {
    externalSessionId: string;
    worktreePath: string;
    contextPacket: ContextPacket;    // still supplied even on resume — see below
  }): AsyncIterable<AgentEvent>;

  interrupt(runHandle: RunHandle): Promise<void>;

  respondToPermission(runHandle: RunHandle, requestId: string,
                       decision: 'allow' | 'deny' | 'allow_always'): Promise<void>;
}

type AgentEvent =
  | { type: 'init'; externalSessionId: string; model: string; tools: string[] }
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'tool_result'; name: string; output: unknown }
  | { type: 'permission_request'; requestId: string; tool: string; input: unknown }
  | { type: 'cost_update'; costUsd: number; tokensIn: number; tokensOut: number }
  | { type: 'result'; status: 'completed' | 'failed' | 'interrupted'; costUsd: number;
      filesChanged: string[] }
  | { type: 'error'; message: string };
```

Every adapter normalizes its backend's native event/result schema into this union; the Supervisor never branches on backend identity outside the adapter implementation itself.

**Why the context packet is still supplied on resume, not just on cold start:** native session resume (where supported) restores conversational continuity, but the *board* may have changed since the session paused (human triage, other sessions' commits) — the packet still carries a fresh diff-so-far and any new Issues/PermissionRequests, so resume is "continue this session, but re-anchor to current board state," not "trust the stale conversation alone."

### Validated against three backends (verified via current docs, not training-data recall)

| Capability | Claude Code | Codex CLI | Gemini CLI |
|---|---|---|---|
| Non-interactive / headless exec | `-p`/`--print`, runs the same agent loop and exits | `codex exec` | Non-TTY / piped-stdin triggers headless mode |
| Structured event stream | `--output-format stream-json`, one JSON object per line, starts with an `init` system event carrying session ID, model, tools, MCP servers | `--json` → JSONL: `turn.started`, `turn.completed` (with usage), `turn.failed`, `item.started/updated/completed` | `--output-format json` or JSONL; less granular per-event detail in current docs |
| Session resume | `--resume <id>` / `--continue`; JSON result includes `session_id` | `codex exec resume <SESSION_ID>` or `--last`; session ID obtainable from `thread.started` event | Interactive `/checkpoint save|load`; **session ID is not yet reliably surfaced in headless JSON output** (open gap, tracked as `google-gemini/gemini-cli#14435` at time of research) |
| Permission / approval control | Permission modes (`plan`, `acceptEdits`, `bypassPermissions`, …), `--allowedTools`/`--disallowedTools`, `can_use_tool` callback in SDK | Approval modes, `--json` surfaces tool/approval events | Approval/sandboxing config exists; less standardized event surface for approvals in current docs |
| Cost/usage reporting | `result` event carries `total_cost_usd`; usage object includes cache read/write token counts | `turn.completed` carries token usage | Usage stats included in JSON result |

**Does the interface break on Codex or Gemini?** No — but capability probing is required, not assumed:
- **Codex** maps cleanly: `turn.started/turn.completed/turn.failed/item.*` → the adapter's `AgentEvent` union; `codex exec resume <id>` → `resumeSession`. Full capability parity with Claude Code's adapter.
- **Gemini** exposes the same *shape* of capability (headless mode, JSON output, some approval config) but session resume is presently weaker — no clean session ID in headless JSON as of this research. The Gemini adapter sets `capabilities.supportsResume = false`; the Supervisor then treats every Gemini session as non-resumable and relies more heavily on the context packet for continuity (Section 3) rather than the backend's native resume. This is the interface working *as designed*: the context-reconstitution mechanism is the fallback path precisely for when a backend's native resume is weak or absent, so the product is not structurally dependent on any one backend's resume maturity. If Gemini's session-ID gap closes upstream, the adapter flips `supportsResume` to `true` with no Supervisor-side change required.

**Confidence:** HIGH for Claude Code and Codex (both verified against current docs with concrete flag/event names); MEDIUM for Gemini's exact event granularity and approval-event surface (docs describe the modes but are less explicit about a fully itemized event schema at time of research) — flag Gemini adapter implementation as a phase needing deeper research when that backend is actually built.

---

## 6. Agent↔Board Write Path

**No direct agent writes to canonical `Task`/`Epic` tables, ever.** Two distinct channels, both gated:

### (a) Socratic epic-authoring session
This is a live, human-supervised interactive session — the human is present and driving. The agent proposes epic/task structure via a structured tool call; the UI renders it as an editable **draft** (`Epic.status = draft`); nothing becomes a live, planner-eligible Epic/Task until the human explicitly commits it. The human is the write-gate for structure created during authoring, mediated through the UI, not by convention.

### (b) Backlog proposals during autonomous execution
An agent working a task that discovers new work calls an **MCP server that exposes the board as tools** — this is the write seam. Tools: `propose_issue`, `report_summary`, `request_permission`, `list_my_task` (read-only, scoped). Every `propose_issue` call inserts into the `Issue` table with `status = proposed`; it can never insert into `Task`/`Epic` directly. `Issue`'s terminal states (`accepted` → promoted into a real Task, `rejected`, `merged_into_task`) are only reachable via human (or, later, policy-driven) triage action — **the schema enforces the queue, not convention**: there is no code path by which an `Issue` row becomes a `Task` row except an explicit triage transition.

### Failure modes and mitigations

| Failure mode | Mitigation |
|---|---|
| Agent spamming the backlog | Rate-limit `propose_issue` calls per `AgentRun` (configurable cap), enforced inside the MCP tool handler; near-duplicate detection (title match / embedding similarity) collapses repeats into one `Issue` with an incremented counter rather than N rows; triage UI supports bulk-reject/bulk-merge. |
| Agents editing each other's items | Agents get no write access to `Task`/`Epic` at all. MCP tool calls are authorization-scoped to the `task_id`/`agent_run_id` the session was started for — server-side, not prompt-enforced — so a session literally has no tool that can address another task's `Issue`s or another `AgentRun`'s `SessionSummary`/`PermissionRequest` rows. |
| Malicious/hallucinated tool arguments | Every MCP tool input is schema-validated before any DB write (reject malformed refs); every agent-originated write goes through the same event-log transaction as human writes, so it is equally auditable and revertable. |

---

## 7. Extension Seams for the Deferred Four

| Deferred capability | Named v1 seam | What breaks without it |
|---|---|---|
| **Scheduled automations** | `Trigger` entity (Section 2.3) with `source = schedule` representable in the schema now, plus `AgentRun.trigger_id` on every run, even though no `SchedulerDaemon` process exists yet | Without a `trigger_id` FK, "start work" is hardcoded to a UI handler; adding schedules later means threading a *new* causation concept through the event log, cost attribution, and the fleet view's "why is this running" query — a migration touching every table that currently assumes human-initiated causation. |
| **Team collaboration** | `Actor` entity (`type: human|agent|system`) attributed on every mutation and every `Event` row, from day one, even with exactly one human Actor provisioned in v1 | Retrofitting "who did this" onto years of event history is a lossy migration — past events can't be attributed to actors that didn't exist as a schema concept. Every "assigned to / commented by / approved by" feature needs an actor FK that would otherwise be bolted on post hoc across every table. |
| **Mobile/web relay** | Append-only `events` table with a strictly monotonic per-project `sequence`, written in the same transaction as every mutable-table write (transactional outbox pattern, Section 2.1), from day one, even though nothing reads it remotely in v1 | Without a durable ordered change feed, a later relay has only bad options: poll mutable tables for diffs (lossy, misses transient states, no replay) or bolt on change-data-capture after the fact (has to re-derive ordering/causality that was never recorded). The relay's entire sync protocol needs only "the event table exists, is append-only, has a stable cursor" — unimplementable retroactively without rewriting how every write happens. |
| **Additional agent backends** | `AgentAdapter` interface (Section 5) + `AgentRun.adapter` as a string column + capability probing, with exactly one implementation (Claude Code) shipped in v1 | If Supervisor code called Claude-Code-specific flags/event shapes inline throughout the planner, context assembler, permission handling, and cost tracking rather than through one normalized interface, adding Codex/Gemini later means auditing and duplicating every call site instead of writing one new adapter file. |

---

## 8. Open-Core Module Boundary

```
packages/
├── core/            (OSS)  — schema, event log, planner, context assembler,
│                             AgentAdapter interface + Claude Code adapter,
│                             worktree manager, MCP board-server.
│                             Zero network calls except to the agent CLIs
│                             themselves and to Anthropic via the user's own
│                             local credentials.
├── desktop/         (OSS)  — Electron/Tauri shell, renderer UI, IPC bridge
│                             to core. "The OSS desktop app."
├── relay-client/    (OSS, thin) — reads the event-log cursor, POSTs batches
│                             to a *configured* relay URL. Disabled by
│                             default. Contains zero commercial logic — no
│                             auth, billing, or hosted infra client-side.
├── relay/           (commercial) — hosted sync server: subscribes to the
│                             event log via relay-client, multi-actor auth,
│                             presence, mobile/web API.
└── cloud-app/       (commercial) — mobile/web frontends, calling relay's API.
```

**The seam is `relay-client`**, not a feature flag inside `core`. `core` and `desktop` are 100% functional and useful with zero paid dependency; the paid product is purely the *server* (`relay`) plus a thin, inert client shim that does nothing until pointed at a relay URL. Team collaboration (multi-actor boards, roles, presence) lives entirely server-side in `relay` — `core`'s `Actor` table already exists, so once remote events start arriving via `relay-client`, a second actor's writes are just a new *source* of events, consumed identically to local UI-originated ones.

**Enforcement:** `core` and `desktop` package manifests must never depend on `relay`/`cloud-app`; only `relay-client` may exist in the OSS dependency graph, and it must build and run with zero commercial package present — verified in CI by building the OSS packages from a checkout with `relay`/`cloud-app` stripped.

**License boundary:** OSS packages (Apache-2.0/MIT-class); `relay`/`cloud-app` closed or BSL-class, matching the PROJECT.md constraint that the open/paid boundary "must fall on a clean module seam in the codebase, not be retrofitted later."

---

## 9. Build Order

### Dependency-ordered sequence

| # | Component | Depends on | Why here |
|---|---|---|---|
| 1 | **Domain schema + persistence layer** | — | Everything depends on it; the mutable-projection + event-log outbox pattern (Section 2.1) and the `Actor`/`Trigger` columns (Section 7) must exist from the first migration — retrofitting them is exactly the risk the deferred-capability seams warn about. |
| 2 | **Supervisor process skeleton + cwd-safety discipline** | 1 | Explicit-path-only git/fs wrapper, `process.chdir` ban, IPC server stub. Must exist before any worktree/agent code so the discipline (Section 1) is baked in from the first git call, not retrofitted. |
| 3 | **Worktree manager** | 1, 2 | Create/list/remove worktrees against the fixed task→epic-integration-branch→main topology; every call takes explicit paths. |
| 4 | **Agent adapter interface + Claude Code adapter** | 2, 3 | The seam (Section 5), implemented against Claude Code only per the v1 constraint. Spawns worker processes with explicit cwd into an existing worktree. |
| 5 | **Context assembler** | 1 | Pure query layer, independent of 4, but only useful once 4 exists to consume its output. |
| 6 | **MCP board-server (agent write path)** | 1, 4 | `propose_issue`/`report_summary`/`request_permission` tools; needs `Issue`/`SessionSummary`/`PermissionRequest` tables and an adapter session to expose the server to. |
| 7 | **Renderer/UI shell** (single-project board view) | 1, 2 | Read-only board first (list epics/tasks, status), then task creation, then "Run" wired to 4. |
| 8 | **Planner** (fan-out, wave grouping, overlap guard) | 3, 4, 6 | Only meaningful once there is more than one task worth parallelizing. |
| 9 | **Fleet / multi-project supervision view** | all above | A view over state that must already be correct for one project before aggregating many — last by construction. |

Deferred-seam scaffolding (`Trigger`, `Actor`, `Event` tables/columns) is not a separate later phase — it is folded into step 1 at schema-design cost, not retrofit cost.

### Thinnest end-to-end vertical slice

Single project, one task (epic optional), no fan-out, no fleet view:

1. UI shows one Task with acceptance criteria.
2. User clicks "Run" → Supervisor inserts `Trigger(source=user_action)` inline.
3. Supervisor creates a `Worktree` for the task (component 3).
4. `ContextAssembler` builds a packet — trivial on a first session, no summaries yet (component 5).
5. Claude Code adapter starts a session in that worktree with the packet (component 4); events stream into `AgentRun`/`Event` rows, rendered live in the UI (component 7).
6. Session ends; `SessionSummary` is captured.
7. User closes the session (the `/clear` equivalent) and later starts a **new** session on the **same task**.
8. The new context packet now includes the prior summary + diff-so-far; the agent continues with no transcript.

That loop — one task, two sequential ephemeral sessions on one durable worktree, reconstituted entirely from the board — is the whole product thesis in miniature. It exercises components 1–5 and 7 without requiring the planner (8) or fleet view (9), and it is the correct first phase to build and demo: everything else is width (more tasks, more projects) or gates (planner safety, agent-proposed writes) layered on top of a loop that must work end to end first.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Session summary as the only source of continuity
**What people do:** Treat the LLM-authored session summary as sufficient context on its own, the way a transcript-continuation product would.
**Why it's wrong:** Summaries are lossy and can drift over many sessions (telephone game); trusting them alone reproduces the exact rot the board model is meant to avoid.
**Do this instead:** Always pair summaries with the live diff and immutable acceptance criteria as ground truth (Section 3.2).

### Anti-Pattern 2: Letting agents write directly to Task/Epic
**What people do:** Give an agent's MCP tools direct `UPDATE task SET ...` access "for convenience," reasoning that a triage queue adds friction.
**Why it's wrong:** Removes the only structural gate against backlog spam and cross-task interference (Section 6); becomes a prompt-injection/hallucination blast radius instead of a schema-enforced boundary.
**Do this instead:** Route every agent-originated mutation through the MCP board-server into `Issue` (proposal) or scoped `SessionSummary`/`PermissionRequest` rows; human or policy owns the promotion transition.

### Anti-Pattern 3: cwd as an implicit git/fs argument anywhere in the Supervisor
**What people do:** `cd` into a worktree "just for this operation" and `cd` back, or rely on a spawned subprocess's inherited cwd for a Supervisor-side git call.
**Why it's wrong:** This is precisely the mechanism behind GSD's guarded failure mode — a shared mutable cwd is a race condition waiting to happen the moment two operations interleave.
**Do this instead:** Every Supervisor git/fs call takes an explicit absolute path; Supervisor cwd is set once at launch and never read (Section 1).

---

## Sources

- `~/.claude/gsd-core/workflows/execute-phase.md` (lines 495–812 read directly) — wave grouping, `files_modified` pairwise overlap guard, per-plan worktree gating, orchestrator cwd-drift guard (`#48`).
- `.planning/PROJECT.md` — constraints, requirements, and the GSD-parallelism lesson already distilled by the user.
- [Headless Mode — Claude Code Docs](https://cld-docs.onlinetool.cc/en/docs/claude-code/headless.html) — `-p`/`--print`, `--output-format stream-json`, `--resume`, permission modes.
- [Track cost and usage — Claude Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/cost-tracking) — `total_cost_usd`, cache token accounting.
- [Streaming Input — Claude Agent SDK Docs](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) — session resume model, permission modes (`default`, `dontAsk`, `acceptEdits`, `bypassPermissions`, `plan`, `auto`).
- [Non-interactive mode — Codex CLI Docs](https://developers.openai.com/codex/noninteractive) — `codex exec --json`, `turn.started/completed/failed`, `item.*` events.
- [Codex CLI Session Lifecycle: Archive, Resume, Fork, Compact](https://codex.danielvaughan.com/2026/06/05/codex-cli-session-lifecycle-archive-resume-fork-compact-management/) — `codex exec resume <id>`, `--last`.
- [Headless mode — Gemini CLI Docs](https://geminicli.com/docs/cli/headless/) — non-TTY headless trigger, `--output-format json`.
- [Gemini Headless Mode JSON Output must mention Session ID for later resume — Issue #14435](https://github.com/google-gemini/gemini-cli/issues/14435) — confirms the session-ID-in-headless-JSON gap used to justify Gemini's `supportsResume: false` in Section 5.

---
*Architecture research for: Flywheel (Agentic Development Environment)*
*Researched: 2026-09-08*
