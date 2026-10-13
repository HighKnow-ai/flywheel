# Phase 5: Socratic Epic Authoring - Research

**Researched:** 2026-09-23
**Domain:** Multi-stage agent conversation control (Claude Code CLI headless mode), SQLite schema evolution for a staging/proposal model, MCP tool-server extension, board-native UI for a proposal tray/triage lane
**Confidence:** MEDIUM — the board/schema/UI patterns this phase extends are HIGH confidence (read directly from shipped code); the single most load-bearing new mechanism (how a continuous multi-turn Socratic conversation is actually driven, and how a tool can be made stage-gated) rests on CLI behavior that is real but officially under-documented, so it is flagged LOW/MEDIUM and named as this phase's required spike.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Decision numbering continues from Phase 4 (D-01–D-22 are Phase 1, D-23–D-40 are Phase 2, D-41–D-63 are Phase 3, D-64–D-79 are Phase 4).

**Where proposals live before they are accepted**
- **D-80:** A session-scoped staging table holds every proposed epic, task and criterion; the canonical tables are untouched until acceptance — and staged rows outlive the session. Rejected: real rows immediately in `backlog`; the `issues` lane as staging area. Reversibility: one-way (migration).
- **D-81:** A proposal carries a uniform verb — `create`, `amend` or `delete` — plus an optional target id. An `amend` accepted against a criterion already locked by D-76 materialises as a D-77 revision row, never an `UPDATE`. Rejected: create+amend with deletion reserved to humans; additive-only proposals. Reversibility: one-way.
- **D-82:** Pending proposals surface as a board-level triage lane, alongside the existing workflow-less `IssuesLane`. This lane is what Phase 6's triage surface extends rather than reinvents. Rejected: a `proposed` section inside `ItemDetailPanel.tsx`; visibility only inside the authoring surface.
- **D-83:** A decided proposal row stays, marked terminal (`accepted`/`rejected`), and the rejected set is primed into every later session for this epic. Must ship bounded (STATE's unbounded-read warning). Rejected: consume-on-accept-delete-on-reject with history in the event log; consume-accepted-keep-rejected.

**The authoring session itself**
- **D-84:** An epic-authoring session IS an `agent_run`. `agent_runs.task_id` becomes nullable, a nullable `epic_id` is added, and `triggers.target_task_id` is loosened the same way. Rejected: a separate `authoring_sessions` table; a synthetic placeholder task. Reversibility: one-way (CHECK-constrained table rebuild following `0006_recovery_statuses.sql`'s sequence, plus an audit of every call site assuming `task_id` is present).
- **D-85:** The conversation renders on `SessionSurface.tsx`, with a live proposal tray beside the feed. Same route, same chrome. Rejected: a dedicated authoring surface with its own route/layout; a board-native flow with no transcript.
- **D-86:** The authoring agent runs read-only in the project's registered main checkout. `cwd` is the repository root from `projects`; D-36's accept-edits default explicitly does NOT apply. Rejected: a dedicated read-only worktree off the trunk; board-only access with no repo reads.
- **D-87:** Priming is an epic-scoped packet plus a small set of capped read tools (search, get_epic, list_tasks). This phase must close `epic_roster`'s exemption from `DEFAULT_LIMIT`/`MAX_LIMIT` (01-SECURITY.md AR-01-04). Rejected: packet with no read tools; read tools with no packet.

**What makes it Socratic rather than an interview**
- **D-88:** A three-stage machine — challenge → decompose → criteria — where the proposal tools do not exist in the tool set until the stage advances. Enforced by *absence*, not instruction. Rejected: a precondition inside the write tools refusing until N challenges answered (a counter is a crude proxy); a system prompt alone. Reversibility: costly.
- **D-89:** The challenge stage is free conversation; advancing distils it into staged assumption rows that go through the same accept/amend path as every other proposal. Rejected: structured challenges from turn one; prose-only with structure appearing only at the proposal stage.
- **D-90:** Cyril holds the advance gate; the agent may recommend advancing but never advances itself. Going back is always allowed, and staged proposals survive the return. Rejected: recording each return as a numbered pass; letting the agent advance on its own judgement.
- **D-91:** SHAPE-05's reopening challenge is model judgement, grounded on a fact packet (answered assumptions, task roster with criteria/statuses, rejected-proposal set). Phase 4's D-72/D-73 ban on model judgement does NOT extend here — a human is in the loop and every output is gated. Rejected: mechanical conflict detection on top; mechanical detection only with no judgement.

**Deciding on proposals**
- **D-92:** Granularity is per-row, down to the individual criterion (forced by SHAPE-04/SHAPE-03/D-06).
- **D-93:** Rejection is a turn in the conversation — the agent sees it, optionally with a reason, and may re-propose. Rejected: terminal/silent rejection; a structural bar on re-proposing enforced in the tool handler.
- **D-94:** Amend means editing the staged row and accepting the version Cyril wrote — the board never receives a version he did not accept. Rejected: accept-then-edit via `ItemDetailPanel`/`AcceptanceCriteriaList`; offering both paths.
- **D-95:** Bulk accept is subtree-scoped (a task with its drafted criteria); no tray-wide accept-all. Rejected: accept-all-remaining; no bulk path at all.
- **D-96:** An accepted proposal materialises immediately as a real row in `backlog`; accepting a child implies accepting its parent. Rejected: materialising only on an explicit whole-epic commit; materialising immediately but hiding from the default board view.

### Claude's Discretion

The following were **not** discussed. Resolve against the decisions above and canonical references — do not re-ask the user:

- The high-assumption spike, and its kill criterion (what it measures, comparison arm, what result changes the plan). Decide **before** surface work is planned.
- The Nimbalyst competitive re-scout (STATE.md standing action, not yet done).
- Where the authoring write/read tools live: a second tool set on `mcp-permission-server.ts` (the D-64/D-53 precedent), a separate board MCP server, or a new sidecar stdio op. Build so Phase 6's `propose_issue` extends the same seam.
- What a closing summary means for an authoring run (no task/diff/worktree) — same tool with nullable fields, a sibling tool, or nothing.
- Whether `mark_abandoned` now has a second caller (D-84 gives it a second kind of run to reconcile).
- How a session is started when no epic exists yet, and whether D-27's launch sheet applies.
- Stop and Discard semantics for an authoring run (D-35/D-66 were written for a dirty worktree; neither premise holds here).
- What the criteria stage drafts (does the agent draft the verification hint too; can a criterion without one be accepted).
- The keyboard map (accept/reject/amend/bulk-accept-subtree/advance under D-02, against `01-UI-SPEC.md`'s locked Keyboard Map — Phase 10.1 reopens sections marked LOCKED; build against it as-is, do not pre-empt).
- How the tray renders while the feed streams (D-33's windowed read vs. `SessionSurface.tsx`'s `StatusStrip` constraint).
- Cost attribution and the project-rail needs-you count for an authoring run (D-37/D-46 need a reading for a conversation, not a task).
- What happens to a staged proposal whose target item is deleted underneath it (D-81's `amend`/`delete` verbs vs. D-44's task deletion).
- Whether authoring runs count toward D-52's per-repository spawn stagger, given D-86 puts them in the main checkout.
- Key allocation timing (D-96 materialises on accept, so per-project keys (D-10) allocate in acceptance order, not proposal order — confirm nothing renders a staged proposal as though it already had a key).

### Deferred Ideas (OUT OF SCOPE)

- Mechanical conflict/near-duplicate detection (lands with Phase 6's `propose_issue` spam control; this phase is a second consumer once it exists).
- A structural bar on re-proposing a rejected item in the tool handler (revisit only if a model demonstrably keeps pushing rejected proposals).
- A dedicated authoring surface with its own route/layout (revisit only with evidence `SessionSurface` + tray measurably loses to a terminal).
- A tray-wide accept-all-remaining action.
- Recorded stage passes (numbering each return to the challenge stage).
- A dedicated read-only worktree for authoring sessions (attractive if the main-checkout read-only posture proves hard to guarantee).
- Structured challenges from the first turn (every challenge a row Cyril answers, rather than prose distilled on advance).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHAPE-01 | User can start a conversational session to shape a new epic, in which the agent challenges assumptions and asks clarifying questions before any work is planned | D-88's tool-absence-by-stage mechanism (Architecture Patterns §1); the process-lifetime fork (single continuous stream-json process vs. sequential one-shot turns) that decides how "before any work is planned" is structurally enforced |
| SHAPE-02 | The authoring session writes its outcome directly to the board as a structured epic with child tasks, not as a document | D-80 staging table + D-96 accept-materialises-immediately pattern; `domain::session_summary::create_summary`'s scoped-write precedent (Code Examples §2) |
| SHAPE-03 | The agent drafts acceptance criteria for each generated task, which the user can edit before accepting | D-94's edit-the-staged-row-then-accept path; D-06/D-92's per-criterion-row granularity, already proven by `acceptance_criteria`'s own table shape |
| SHAPE-04 | User can accept, reject or amend any individual item the authoring session proposes, rather than accepting the set wholesale | D-92 (per-row) + D-95 (subtree-scoped bulk, no accept-all) — both directly testable against the staging table's row count |
| SHAPE-05 | User can reopen and continue shaping an existing epic at any time, and the agent challenges changes against what the epic already contains | D-83's bounded rejected-set precedent (mirrors `SUMMARIES_SQL`'s own bounding gap warning); D-91's grounded-judgement carve-out from Phase 4's D-72/D-73 ban |
</phase_requirements>

## Summary

This phase has almost no open *product* decisions left — CONTEXT.md's 17 decisions (D-80..D-96) already settle staging, verbs, the triage lane, the three-stage tool-absence machine, and per-row acceptance. What remains genuinely open, and what this research is for, is whether the mechanisms those decisions assume are *technically real* against the actual installed stack (`claude` CLI 2.1.267, driven by direct subprocess spawn — this codebase does **not** use `@anthropic-ai/claude-agent-sdk`; every prior phase built `claude-code-adapter.ts` directly against the CLI's `-p`/`--output-format stream-json` contract).

Two findings are load-bearing enough to change how the planner sequences work:

1. **Dynamic MCP tool-list changes do not work in the installed Claude Code CLI.** A server that adds/removes tools mid-session and sends `notifications/tools/list_changed` is not re-fetched by the client — this is an open, confirmed Anthropic bug (`anthropics/claude-code#77314`). `--disallowedTools` also does not gate MCP server tools in print mode (`anthropics/claude-code#12863`). This means D-88's "the proposal tools do not exist in the tool set until the stage advances" **cannot** be implemented by dynamically registering/deregistering MCP tools inside one live session. The only proven mechanism in this codebase that can deterministically deny a specific tool call based on live, mutable state is the `PreToolUse` hook this project already ships for the destructive-command gate (`packages/sidecar/src/pretooluse-hook.ts`, wired via `writeHookSettings`/`--settings`, D-55) — hooks fire before any permission-mode check, in every mode, and can match MCP tool names with a regex matcher (`mcp__flywheel-authoring__.*`). Recommendation: extend this exact mechanism rather than inventing a second one. See Architecture Pattern 1.

2. **A genuinely continuous, multi-turn Socratic conversation needs a CLI capability this codebase has never used.** Every existing adapter call is `-p <one prompt>` — one shot, one process, one `agent_run`. Real back-and-forth chat (Cyril typing follow-ups while the *same* process stays warm) requires `--input-format stream-json`, which keeps `claude` running with stdin open and accepts one JSON-line user message per turn. This flag is real (present since 2.1.258, the installed binary is 2.1.267) but is the subject of two separate open Anthropic documentation-gap issues (`#24594`, `#44911`) — its exact message shape and duration/reliability characteristics are not authoritatively documented, and a known bug produces duplicate entries in the persisted session `.jsonl` (`#5034`). The alternative — sequential one-shot `-p` turns, each one reconstructing context fresh (no native `--resume`, exactly D-30's existing precedent) — is far cheaper to build on the existing watchdog/heartbeat/kill-record apparatus but multiplies `agent_runs` rows per conversation, complicating D-84's "an epic-authoring session IS an agent_run" framing and D-85's single-`SessionSurface`-per-run reuse. This is squarely the assumption the phase's own Notes flag for a pre-build spike; both this fork and the tool-absence mechanism above should be resolved by the same spike. See Architecture Pattern 2 and Open Questions.

Everything else — the staging schema, the accept/reject/amend materialisation path, the epic-scoped context packet, the triage lane, the CHECK-constrained table rebuild for nullable `task_id` — is a direct extension of patterns already shipped and load-bearing-tested in Phases 1–4. No new external package is required.

**Primary recommendation:** Build the stage gate on the existing `PreToolUse` hook (extend its matcher list, do not invent a second gating mechanism), spike the single-process-vs-sequential-process fork for the conversation itself before writing the full plan, and treat every other mechanism in this phase as "extend the nearest existing precedent" (context_packet.rs → epic packet; session_summary.rs → proposal write path; 0006's rebuild sequence → the `agent_runs`/`triggers` nullable-`task_id` migration; `IssuesLane.tsx` → the triage lane; `board.rs`'s `DEFAULT_LIMIT`/`MAX_LIMIT` clamp → the newly-capped `epic_roster`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Stage machine (challenge/decompose/criteria) enforcement | API / Backend (sidecar `PreToolUse` hook + Rust core stage state) | Browser/Client (stage indicator render) | The gate must be unbypassable by the model regardless of what the renderer shows; the hook process is spawned per tool call and reads authoritative state, not UI state |
| Proposal staging (create/amend/delete rows) | Database / Storage (new staging table, `rusqlite`) | API / Backend (Rust write path) | D-80 explicitly makes this a schema-authority decision, mirroring the five-state CHECK precedent |
| Accept/reject/amend materialisation | API / Backend (Rust domain functions) | Database / Storage (transactional write + event) | Every mutation is actor-attributed and event-logged in one transaction (DATA-03) — this is core-crate territory, not UI territory |
| Epic-scoped context packet assembly | API / Backend (`context_packet.rs` sibling, pure query) | — | CTX-04's determinism contract (no model call, no mutation) is a backend purity guarantee the UI cannot provide |
| Conversation transport (spawn, stream, stdin turns) | API / Backend (Node sidecar, `claude-code-adapter.ts`) | — | AGNT-01's adapter seam already owns this; the sidecar is the only process that talks to the `claude` binary |
| Proposal tray + triage lane rendering | Browser/Client (React, `SessionSurface.tsx` / new `TriageLane.tsx`) | — | Presentation of already-fetched staged-proposal rows; no business logic belongs here (D-94's amend edits the staged row via the same Rust write path, never a local-only edit) |
| Read tools (search/get_epic/list_tasks) exposed to the agent | API / Backend (query layer, capped) | — | D-87 explicitly closes `epic_roster`'s unbounded exemption here — this is a `DEFAULT_LIMIT`/`MAX_LIMIT` clamp in the same tier as every other board query |

## Standard Stack

### Core

No new external package is required. This phase extends four packages already pinned in the workspace:

| Library | Version (verified in this repo) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rusqlite` | 0.40 (bundled, serde_json, chrono features) [VERIFIED: packages/core/Cargo.toml:19] | Staging table, nullable-column migrations | Already the store-of-record; D-80/D-84's schema changes are ordinary `rusqlite_migration` migrations |
| `rusqlite_migration` | 2.6 [VERIFIED: packages/core/Cargo.toml:20] | Versioned schema migrations, including the CHECK-constrained table rebuild D-84 requires | `0006_recovery_statuses.sql` is the exact worked pattern to copy |
| `@modelcontextprotocol/sdk` | 1.30.0 [VERIFIED: packages/sidecar/package.json] | Registers the authoring tool set (propose_epic/propose_task/propose_criterion/advance_stage/read tools) on the existing standalone MCP server process | Already hosts `approve_action` and `report_summary`; this is a third and fourth+ tool set through the identical `ListToolsRequestSchema`/`CallToolRequestSchema` pattern |
| `claude` CLI (Claude Code) | 2.1.267 installed [VERIFIED: `claude --version` on this machine] | Drives the authoring conversation | This codebase does not use `@anthropic-ai/claude-agent-sdk` anywhere — every adapter call is a direct CLI subprocess spawn (`claude-code-adapter.ts`). Treat CLAUDE.md's SDK recommendation as aspirational/superseded by the as-built adapter; plan against the CLI contract, not the SDK |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| None new | — | — | This phase is schema + tool-surface + UI work on the existing stack; no supporting library is load-bearing |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| PreToolUse-hook-based stage gate | Dynamic MCP tool registration + `notifications/tools/list_changed` | **Ruled out** — confirmed broken in the installed CLI (`anthropics/claude-code#77314`); do not attempt |
| PreToolUse-hook-based stage gate | `--allowedTools`/`--disallowedTools` per-stage re-invocation | `--disallowedTools` does not gate MCP tools in print mode (`anthropics/claude-code#12863`); `--allowedTools` is additive/pre-approval only, not a restrictive allow-list, and is fixed at spawn — cannot change mid-process |
| Sequential one-shot `-p` turns (context reconstituted each turn, no native resume) | `--input-format stream-json` single continuous process | The continuous-process option gives a genuinely live back-and-forth conversation but rests on an under-documented flag (two open Anthropic doc-gap issues) with a known duplicate-log bug; the sequential option is cheap, proven (D-30's exact precedent), but multiplies `agent_runs` rows per conversation and complicates D-84's singular framing. **This fork is the phase's required spike — do not commit to either in the plan without running it first.** |

**Installation:**
```bash
# No new packages. Existing Cargo.toml / package.json already carry every dependency this phase needs.
```

**Version verification:** `rusqlite`/`rusqlite_migration`/`@modelcontextprotocol/sdk` versions above were read directly from `packages/core/Cargo.toml` and `packages/sidecar/package.json` in this session — not looked up against a registry, since no new package is being added. The `claude` CLI version was read directly from the installed binary on this machine (`claude --version` → `2.1.267 (Claude Code)`) — the actual execution target for this phase's spike, not a training-data assumption.

## Package Legitimacy Audit

**No external packages are introduced by this phase.** The Package Legitimacy Gate protocol is not applicable — every dependency used above already exists in `packages/core/Cargo.toml` and `packages/sidecar/package.json` and was verified in a prior phase.

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
Cyril (UI)                         Rust core (rusqlite)                 Node sidecar                    claude CLI (subprocess)
    |                                     |                                   |                                  |
    | "Shape a new epic"                  |                                   |                                  |
    |------------------------------------>|                                   |                                  |
    |                                     | assemble_epic_context_packet()   |                                  |
    |                                     | (sibling of context_packet.rs,   |                                  |
    |                                     |  pure query: epic OR none,       |                                  |
    |                                     |  D-83 rejected set, prior        |                                  |
    |                                     |  distilled assumptions)          |                                  |
    |                                     |---------------------------------->|                                 |
    |                                     |                                   | writeHookSettings() extended    |
    |                                     |                                   | with a matcher for the          |
    |                                     |                                   | authoring MCP server's write    |
    |                                     |                                   | tools (Pattern 1, below)        |
    |                                     |                                   |--------------------------------->|
    |                                     |                                   |   spawn claude -p (or            |
    |                                     |                                   |   --input-format stream-json —   |
    |                                     |                                   |   see Pattern 2 / Open Questions)|
    |                                     |                                   |                                  |
    |<==== live feed (SessionSurface.tsx, unchanged) ============================================================|
    |                                     |                                   |                                  |
    |         [Stage: challenge]  agent asks questions, calls NO proposal tool (none registered as callable —    |
    |          per Pattern 1, the PreToolUse hook denies any authoring-write tool call while stage=challenge)    |
    |                                     |                                   |                                  |
    | clicks "Advance" (D-90: human-only gate)                                                                   |
    |------------------------------------>| writes stage=decompose to the    |                                  |
    |                                     | per-run stage file (Pattern 1)   |                                  |
    |                                     | + distils assumption rows (D-89) |                                  |
    |                                     |                                   |                                  |
    |         [Stage: decompose]  agent calls propose_task/propose_epic — hook now ALLOWS (matcher checks live   |
    |          stage file, matches nothing to deny) — MCP tool handler INSERTs into staging table (D-80/D-81)    |
    |<==== proposal tray updates (new staged row) ================================================================|
    |                                     |                                   |                                  |
    | accept / reject / amend one row (D-92, per-criterion granularity)                                          |
    |------------------------------------>| accept: materialise into         |                                  |
    |                                     | epics/tasks/acceptance_criteria  |                                  |
    |                                     | (D-96, same transaction as the   |                                  |
    |                                     | events-log append, DATA-01)      |                                  |
    |                                     | reject: mark terminal (D-83),    |                                  |
    |                                     | primed into future sessions      |                                  |
```

### Recommended Project Structure

```
packages/core/src/
├── db/migrations/0010_authoring_staging.sql     # D-80/D-81/D-83 staging table; D-87's epic_roster cap
├── db/migrations/0011_authoring_runs.sql        # D-84's CHECK-constrained rebuild (nullable task_id, nullable epic_id, loosened triggers.target_task_id)
├── domain/authoring_proposal.rs                  # create_proposal/accept_proposal/reject_proposal/amend_proposal — the D-80..D-96 write path, following session_summary.rs's "single scoped writer" discipline
├── epic_context_packet.rs                        # sibling of context_packet.rs — D-87's epic-scoped packet, same pure-query/omit-heading contract
└── query/authoring.rs                            # the triage-lane query + capped list_epics (D-87), same DEFAULT_LIMIT/MAX_LIMIT clamp as board.rs

packages/sidecar/src/
├── mcp-authoring-server.ts (or a 3rd+ tool set on mcp-permission-server.ts — Discretion item)
├── pretooluse-hook.ts                            # EXTEND: add a matcher for the authoring MCP server's write-tool names, reading a per-run stage marker (Pattern 1)
└── claude-code-adapter.ts                        # EXTEND: startAuthoringSession — spike-dependent (Pattern 2)

packages/desktop/src/
├── session/SessionSurface.tsx                    # unchanged route (D-85); add the proposal tray as a new side panel
├── authoring/ProposalTray.tsx                    # new — renders staged proposals, per-row accept/reject/amend, subtree bulk-accept (D-95)
├── board/TriageLane.tsx                          # new, sibling of IssuesLane.tsx (D-82) — same collapsible-lane pattern
```

### Pattern 1: Deterministic stage gating via the existing `PreToolUse` hook, not dynamic MCP tool registration

**What:** The stage machine (D-88) is enforced by extending the `PreToolUse` hook this project already ships for the destructive-command gate (Phase 3, D-55/D-58), not by adding/removing MCP tools mid-session.

**When to use:** Any time a tool's availability must change based on live, mutable application state within one running `claude` process.

**Why this is the right mechanism (not a workaround):**
- MCP's `notifications/tools/list_changed` exists in the spec, but the installed Claude Code CLI does not re-fetch `tools/list` on receiving it — a confirmed, still-open Anthropic bug: "MCP client does not re-fetch tools/list on notifications/tools/list_changed — new tools unreachable until full session restart" [CITED: github.com/anthropics/claude-code/issues/77314].
- `--disallowedTools` is documented to have no effect on MCP server tools specifically in `-p` (print) mode [CITED: github.com/anthropics/claude-code/issues/12863].
- `--allowedTools` is an *additive pre-approval* list (skip the permission prompt), not a restrictive allow-list, and — like every other CLI flag — is fixed at process spawn; it cannot be changed for an already-running process [VERIFIED: packages/sidecar/src/claude-code-adapter.ts:223-264, `buildClaudeArgv`'s `summaryToolName`/`permissionPromptToolName` composition, all argv, all fixed at spawn].
- `PreToolUse` hooks, by contrast, fire "before any permission-mode check, in every permission mode, including dontAsk," and a `deny` decision blocks the tool even in `bypassPermissions` mode [CITED: web search summary of code.claude.com/docs/en/hooks-guide]. Hook matchers support MCP tool names via regex, e.g. `mcp__<server>__.*` to cover every tool on one server [CITED: web search summary, MCP Tool Hooks in Claude Code guides].
- This project already has a working, live-measured implementation of exactly this shape: `writeHookSettings` writes a per-run `--settings` JSON with `hooks.PreToolUse[0].matcher = "Bash"` pointing at `pretooluse-hook.ts`, injected via `--settings <file>` [VERIFIED: packages/sidecar/src/claude-code-adapter.ts:132-156, `writeHookSettings`]. Phase 3's STATE.md decisions record this pattern being verified live against real `claude` 2.1.236/2.1.267 binaries multiple times (03-19, 03-27).

**Recommended shape:**
1. Add a second `PreToolUse` matcher entry (alongside the existing `"Bash"` one) whose `matcher` is a regex covering the authoring MCP server's proposal-writing tool names (e.g. `mcp__flywheel-authoring__propose_.*|mcp__flywheel-authoring__amend_.*|mcp__flywheel-authoring__delete_.*`) — read-only tools (`search`, `get_epic`, `list_tasks`) and `advance_stage`'s own recommendation call are never matched, so they always execute.
2. The hook script (already a Node subprocess invoked per matched call) reads a small per-run stage marker written by the Rust core whenever Cyril clicks Advance — following the existing per-run file convention (`runs/<runId>.json`, `shim/<runId>/`, `settings/<runId>.json`) [VERIFIED: packages/sidecar/src/claude-code-adapter.ts:103-108, `permissionSettingsPath`]. A fresh file read per call keeps the check live without a socket round-trip.
3. Deny with a human-readable reason ("still in the challenge stage — no proposals yet") so the model understands why, rather than a bare refusal.

**Caveat:** this is a hook-mediated *refusal*, not literal tool-list absence — the model still sees the tool declared and can attempt (and be denied) calling it. D-88's stated rationale ("there is literally no tool the agent could call") is not met to the letter by this mechanism; it is met to the tested behavior ("assert that no proposal row exists before the stage advanced" — the hook denies before the MCP handler ever runs, so no row is ever written). Flag this distinction explicitly to the planner as a deliberate, evidence-driven substitution for the decision's literal mechanism, not a silent downgrade.

### Pattern 2: The conversation-transport fork — spike before committing

**What:** Every existing adapter call (`buildClaudeArgv`) is one-shot: `-p <prompt>`, one process, one result, session ends [VERIFIED: packages/sidecar/src/claude-code-adapter.ts:236-251]. A genuinely live, multi-turn Socratic exchange — the thing that has to beat typing into a terminal (FEATURES.md) — needs either:

- **Option A — single continuous process, `--input-format stream-json`.** Keeps `claude` running with stdin open; each of Cyril's follow-up messages is one JSON line delivered at the next turn boundary, without relaunching the binary [CITED: web search summary of Claude Code CLI multi-turn streaming input, confirmed present since 2.1.258]. The installed binary (2.1.267) is newer than the version that introduced this. However: this flag's exact input message JSON shape is the subject of an open Anthropic documentation-gap issue, "`--input-format stream-json` usage is undocumented beyond the CLI flags table" [CITED: github.com/anthropics/claude-code/issues/24594], and a second: "Headless stream-json docs omit input format and UTF-8 text handling" [CITED: github.com/anthropics/claude-code/issues/44911]. A separate bug produces duplicate entries in the persisted session `.jsonl` under this input mode [CITED: github.com/anthropics/claude-code/issues/5034]. This option keeps D-84's "an epic-authoring session IS an agent_run" literally true (one process, one run, one `SessionSurface` per D-85) but its exact reliability and message contract are unverified against this project's own binary.
- **Option B — sequential one-shot `-p` turns, no native resume.** Matches this codebase's existing, proven precedent exactly: D-30 already establishes "native `--resume`/`--continue` is deliberately unimplemented... every session is exactly one `AgentRun`" [VERIFIED: packages/core/src/db/migrations/0003_agent_runtime.sql:10-14]. Each of Cyril's messages spawns a fresh `claude -p` with the conversation-so-far folded into the prompt (mirroring how `context_packet.rs` reconstructs context from board state rather than a transcript). Cheap, uses zero unverified CLI surface, and reuses the entire watchdog/heartbeat/kill-record/reconciliation apparatus unchanged per turn. Cost: multiplies `agent_runs` rows per authoring conversation (one per user turn, not one per session), which is a real tension with D-84's singular phrasing and D-85's "same `SessionSurface.tsx`" reuse — the UI would need to stitch several runs into one visually-continuous feed, which is new surface-composition work `SessionSurface.tsx` does not do today (it renders one run).

**Recommendation:** This is precisely the assumption the phase's own Notes/ROADMAP.md flag for a pre-build spike ("confirm epic authoring here really is faster and better than prompting in a terminal, before building the full surface"). Fold this technical fork into that same spike: build the smallest possible harness that drives 3-4 conversational turns both ways against the real 2.1.267 binary, and let the measured behavior (does `--input-format stream-json` actually deliver turns reliably without the duplicate-log bug corrupting the persisted transcript?) decide, rather than assuming either option in the plan. **Do not write the phase's PLAN.md tasks assuming Option A works until this spike has run once against the real binary** — this is the single highest-uncertainty technical claim in this research.

### Anti-Patterns to Avoid

- **Registering the authoring tools on a second, dynamically-updated MCP server and expecting the tool set to change mid-session** — confirmed broken (Pattern 1). Register the full tool set once at spawn; gate at the hook layer.
- **Reusing `--allowedTools`/`--disallowedTools` as the stage gate** — both are fixed at spawn and/or do not apply to MCP tools in print mode (Pattern 1).
- **Letting a staged proposal's accept path issue a raw `UPDATE` against a locked (D-76) criterion** — D-81 requires this go through `revise_criterion`'s existing revision-chain machinery [VERIFIED: packages/core/src/domain/acceptance_criterion.rs:375-534, `revise_criterion`], never a direct write, exactly as Phase 4 built it.
- **Treating the epic-scoped context packet as a place to call the model or write to the database** — `context_packet.rs`'s own header comment is explicit: "no model call, no network call, no mutation of any kind" [VERIFIED: packages/core/src/context_packet.rs:1-4]; the sibling packet for D-87 must hold the identical contract (CTX-04's determinism).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stage-dependent tool availability | A custom MCP proxy that filters `tools/list` responses per stage | The existing `PreToolUse` hook (Pattern 1) | The MCP-layer approach is confirmed non-functional against the installed CLI (issue #77314); the hook layer is already proven live in this codebase |
| CHECK-constraint schema change (nullable `agent_runs.task_id`) | A hand-written `ALTER TABLE` | `0006_recovery_statuses.sql`'s exact rebuild sequence (`CREATE TABLE _new` / `INSERT INTO _new SELECT ...` / `DROP TABLE` / `RENAME TO`), including the `PRAGMA foreign_keys` toggle at the connection level before `to_latest()` | SQLite cannot ALTER a CHECK constraint in place; this project has already solved the exact problem once, including the `DROP TABLE`-drops-indexes gotcha (indexes must be recreated after rename) |
| Criterion revisioning for an `amend` against an already-materialised, locked criterion | A new edit/versioning mechanism for staged authoring | `domain::acceptance_criterion::revise_criterion` + `criteria_locked_for_task` [VERIFIED: packages/core/src/domain/acceptance_criterion.rs:330-534] | D-76/D-77/D-78/D-79 already built exactly this; a second mechanism would fork the revision-chain invariant this project depends on for run-pinned criteria (D-78) |
| Bounding the epic list handed to the agent | A custom pagination scheme | The `DEFAULT_LIMIT`/`MAX_LIMIT`/`clamp` pattern already used four times in this codebase (`board.rs:13-19`, `events.rs:15-22`, `agent_run.rs:467-468,1587-1588`) [VERIFIED: grep across packages/desktop/src-tauri/src/commands/] | One consistent, already-tested clamp idiom; `list_epics` in `domain/epic.rs:58-75` is the one function in the whole crate still exempt (AR-01-04) — this phase closes that gap using the pattern already proven elsewhere, not inventing a new one |
| A second socket/IPC channel between sidecar and Rust core for the authoring write tools | A new transport | The existing per-run Unix socket in `mcp-permission-server.ts`, carrying a third+ message `kind` (following the precedent `session_summary`/`git_retry`/`git_lock_exhausted` already set, D-53/D-64) | Zero new socket, zero new spawned process, zero new `--mcp-config` entry — matches D-64's own stated rationale verbatim |

**Key insight:** Every mechanism this phase needs except two (the stage gate's exact enforcement point, and the conversation's process lifetime) is a same-shape extension of a pattern this codebase has already built and load-bearing-tested across four prior phases. Treat "which existing file is this a sibling of" as the first question for every task in the plan.

## Common Pitfalls

### Pitfall 1: Assuming MCP tool-list changes propagate mid-session
**What goes wrong:** A plan task reads "register `propose_task` only once the challenge stage ends" and the builder implements it as a dynamic tool registration on the MCP server, following D-88's literal wording.
**Why it happens:** The MCP spec explicitly supports `notifications/tools/list_changed`, and it is a natural reading of "the tool does not exist" — but the *client* (the installed Claude Code CLI) does not honor it.
**How to avoid:** Plan the stage gate against Pattern 1 (`PreToolUse` hook) from the start; do not leave "how the tool set changes" as an implementation detail for the builder to improvise, since the obvious reading is the broken one.
**Warning signs:** A task description says "the MCP server conditionally returns tools based on stage" without naming the hook mechanism.

### Pitfall 2: Building the continuous-conversation transport before spiking it
**What goes wrong:** The plan commits to `--input-format stream-json` for the whole authoring surface, then discovers mid-implementation that the message shape doesn't match what was assumed, or that the duplicate-`.jsonl`-entry bug corrupts the persisted session log this project relies on for the activity trail.
**Why it happens:** The flag is real and works in isolated community reports, but has no first-party documentation beyond the CLI flags table — exactly the gap the phase's own Notes already warn about ("spike the flow during planning").
**How to avoid:** Run the spike (Pattern 2) before Task 1 of the plan, not as a plan task itself; let its result pick Option A or B before any UI/schema work assumes either shape.
**Warning signs:** A plan task references `--input-format stream-json` with a specific JSON shape that was never verified against the real 2.1.267 binary in this session.

### Pitfall 3: Losing the criteria-are-first-class invariant when distilling the challenge stage
**What goes wrong:** D-89's "distil the conversation into staged assumption rows" gets implemented by folding assumptions into a task/epic's free-text `description` field instead of discrete rows, because that's the path of least resistance for a first draft.
**Why it happens:** The model naturally wants to write prose; a distilled *row per assumption* is more work to design and render than one paragraph.
**How to avoid:** `PITFALLS.md`'s own Pitfall 3 states the general rule this phase must not violate: "Keep acceptance criteria as first-class structured fields... never folded into prose summaries" [VERIFIED: .planning/research/PITFALLS.md:81]. The same discipline applies to distilled assumptions and to drafted criteria — each is its own staging-table row with its own id, never text inside another row's field.
**Warning signs:** A staged proposal's `payload` is a single long string rather than a set of addressable fields the tray can accept/reject/amend individually (which SHAPE-03/SHAPE-04 require at the per-item level).

### Pitfall 4: Letting the epic-scoped packet or its read tools become a second unbounded surface
**What goes wrong:** `epic_roster`'s cap (D-87) gets closed, but the new `search`/`get_epic`/`list_tasks` read tools exposed to the agent are implemented as thin, unbounded wrappers around existing query functions, reopening the exact class of gap D-87 exists to close.
**Why it happens:** The existing query functions (`list_board`, `list_epics`) already take a `limit` parameter — it's easy to wire a tool that passes `i64::MAX` or omits the parameter "to keep it simple for the agent."
**How to avoid:** Every new read tool must apply the same `DEFAULT_LIMIT`/`MAX_LIMIT`/`clamp` idiom already used four times in this codebase (Don't Hand-Roll, above) — never a raw pass-through.
**Warning signs:** A tool's `inputSchema` has no `limit` property, or the handler calls a query function with a caller-supplied or absent limit.

## Code Examples

### 1. The CHECK-constrained table rebuild D-84 requires (copy this sequence exactly)

```sql
-- Source: packages/core/src/db/migrations/0006_recovery_statuses.sql (this project's own prior
-- migration, the worked example named in CONTEXT.md's canonical_refs)
-- SQLite cannot ALTER a CHECK constraint or a NOT NULL constraint in place — full rebuild only.

CREATE TABLE agent_runs_new (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26),
    worktree_id TEXT REFERENCES worktrees(id),
    task_id TEXT REFERENCES tasks(id),      -- D-84: NOT NULL removed
    epic_id TEXT REFERENCES epics(id),      -- D-84: new nullable column
    project_id TEXT NOT NULL REFERENCES projects(id),
    trigger_id TEXT NOT NULL REFERENCES triggers(id),
    adapter TEXT NOT NULL DEFAULT 'claude_code',
    actor_id TEXT NOT NULL REFERENCES actors(id),
    status TEXT NOT NULL CHECK (status IN ('running', 'blocked', 'completed', 'failed', 'interrupted', 'abandoned')),
    external_session_id TEXT,
    permission_mode TEXT NOT NULL,
    cost_usd REAL,
    tokens_in INTEGER,
    tokens_out INTEGER,
    log_path TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    acknowledged_at TEXT,
    exit_summary_id TEXT,
    criteria_revision_pin TEXT
);

INSERT INTO agent_runs_new (
    id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
    started_at, ended_at, acknowledged_at, exit_summary_id, criteria_revision_pin
)
SELECT
    id, worktree_id, task_id, NULL, project_id, trigger_id, adapter, actor_id, status,
    external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
    started_at, ended_at, acknowledged_at, exit_summary_id, criteria_revision_pin
FROM agent_runs;

DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;

-- DROP TABLE drops indexes; RENAME TO does not resurrect them — recreate every one that existed:
CREATE INDEX idx_agent_runs_task_started ON agent_runs (task_id, started_at DESC);
CREATE INDEX idx_agent_runs_project_status ON agent_runs (project_id, status);

-- Connection-level, BEFORE calling MIGRATIONS.to_latest() — not inside this file's own SQL,
-- because rusqlite_migration runs every migration body inside its own transaction and SQLite
-- ignores PRAGMA foreign_keys once a transaction is already open (0006's own documented finding).
-- PRAGMA foreign_keys = OFF;  ... to_latest() ...  PRAGMA foreign_keys = ON; foreign_key_check();
```

### 2. The single-writer, run-derived-identity pattern every new authoring write tool must follow

```rust
// Source: packages/core/src/domain/session_summary.rs's create_summary (D-64/D-65's precedent,
// named directly in CONTEXT.md's canonical_refs as "every authoring write tool should follow
// that rule exactly")
//
// task_id/project_id/worktree_id are resolved from the agent_runs row INSIDE the same
// transaction — never accepted as a caller-supplied parameter. A caller cannot attribute a
// proposal to a run it does not drive. Apply this identically to a new
// domain::authoring_proposal::create_proposal(conn, agent_run_id, verb, target_id, payload):
// resolve epic_id (nullable per D-84) from agent_runs, never from the MCP tool's own arguments.
```

### 3. The `PreToolUse` settings shape to extend (Pattern 1)

```typescript
// Source: packages/sidecar/src/claude-code-adapter.ts:138-157, writeHookSettings — EXTEND this
// function's `hooks.PreToolUse` array with a second matcher entry, rather than replacing the
// existing "Bash" one (the destructive-command gate must keep working unchanged for any Bash
// call an authoring session's read-only posture still permits, e.g. `git log`).
const settings = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [{ type: "command", command: `${process.execPath} ${pretoolUseHookScriptPath()}` }],
      },
      {
        // New: matches every write-capable tool on the authoring MCP server by name prefix.
        // mcp__<server>__.* is confirmed by community documentation to be the correct regex
        // shape for "every tool from one MCP server" [CITED].
        matcher: "mcp__flywheel-authoring__(propose|amend|delete)_.*",
        hooks: [{ type: "command", command: `${process.execPath} ${stageGateHookScriptPath()}` }],
      },
    ],
  },
};
```

### 4. The clamp idiom every new bounded read must use

```rust
// Source: packages/desktop/src-tauri/src/commands/board.rs:13,19,192 (verified this session)
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;
fn resolve_limit(limit: Option<i64>) -> i64 {
    limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT)
}
// Apply this same shape to domain::epic::list_epics (D-87's obligation — currently unwindowed,
// packages/core/src/domain/epic.rs:58-75) and to every new authoring read tool.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Assume MCP dynamic tool list changes work because the spec supports them | Verify against the actual client — Claude Code CLI does not re-fetch on `list_changed` as of the currently installed 2.1.267 | Confirmed open as of this research session (2026-09) | Any stage-gating design based on tool-list mutation must be redesigned around hook-based denial instead |
| Assume `-p` is strictly one-shot | `--input-format stream-json` (CLI ≥2.1.258) supports a long-lived process accepting sequential user turns via stdin | Present in the installed 2.1.267 binary, but still undocumented beyond the flags table as of this research session | Opens a genuinely new adapter capability this codebase has never exercised — must be spiked, not assumed |

**Deprecated/outdated:** None — this phase does not touch anything the project has already deprecated.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `--input-format stream-json` reliably delivers sequential user turns to one long-lived `claude` process without corrupting the persisted `.jsonl` log, against the specific installed 2.1.267 binary | Architecture Pattern 2 | If wrong, Option A's entire conversation-transport design is unusable and the plan must fall back to Option B (sequential one-shot turns), which has different data-model implications (agent_runs multiplicity) that ripple into D-84's schema and D-85's UI reuse |
| A2 | A `mcp__<server>__.*`-shaped regex matcher on a `PreToolUse` hook correctly intercepts calls to tools on a *second* MCP server (the authoring server) the same way it already does for the existing permission server's tools | Architecture Pattern 1, Code Example 3 | If wrong, the stage gate has no enforcement point at all, and D-88's "literally no tool the agent could call" becomes literally no enforcement of that claim — a silent regression to "the model just decides for itself," the exact failure D-88 exists to prevent |
| A3 | The `claude` CLI's `PreToolUse` hook denial for an MCP tool call surfaces to the model as a clear, actionable refusal (not a fatal stream error) mid multi-turn conversation | Architecture Pattern 1 | If wrong, a denied proposal call could kill the whole conversation rather than prompting the agent to keep challenging — directly undermining SHAPE-01's "before any work is planned" flow |

**If this table is empty:** N/A — three assumptions above need the phase's own spike to resolve before planning commits to either transport option or finalizes the hook's exact wiring.

## Open Questions

1. **Does Option A (`--input-format stream-json`) or Option B (sequential one-shot `-p` turns) drive the authoring conversation?**
   - What we know: Option A exists in the installed CLI and matches D-84/D-85's singular-session framing most naturally; Option B is proven, cheap, and matches D-30's existing precedent but multiplies `agent_runs` rows per conversation.
   - What's unclear: Option A's exact reliability, message shape, and log-corruption risk against this project's own binary and its own `session_log.rs` persistence path.
   - Recommendation: Resolve via the phase's own required spike (ROADMAP.md Notes), before Task 1 of the plan. This is the single highest-leverage unresolved question in the phase — it determines the shape of the sidecar adapter work, the `agent_runs`/`epic_id` cardinality, and how `SessionSurface.tsx` composes multiple runs (if Option B is chosen).

2. **Where do the authoring read/write tools live** (a second tool set on `mcp-permission-server.ts`, a separate board MCP server, or a new sidecar stdio op)?
   - What we know: CONTEXT.md leaves this to Discretion, explicitly deferring to `ARCHITECTURE.md` §6 and Anti-Pattern 2, and requiring Phase 6's `propose_issue` extend the same seam.
   - What's unclear: whether a *second* MCP server process (vs. more tools on the existing one) changes the `PreToolUse` matcher story — a second server would need its own `--mcp-config` entry and its own tool-name prefix, which is a straightforward extension of Pattern 1's regex but adds one more moving part to verify in the spike.
   - Recommendation: Default to extending `mcp-permission-server.ts` with a third+ tool set (matching D-64's own stated precedent and rationale — "zero new socket, zero new spawned process, zero new `--mcp-config` entry") unless the spike surfaces a concrete reason (e.g. tool-count/context-window pressure) to split it out.

3. **What does `mark_abandoned` owe an authoring run** that has no worktree, no diff, and (under Option A) may sit idle mid-conversation waiting on a human for long stretches?
   - What we know: D-84 gives `mark_abandoned` a second kind of run to reconcile; Phase 3's heartbeat-staleness kill already exists and is live-measured against real sessions.
   - What's unclear: whether an authoring session's "idle while Cyril thinks" state needs a different heartbeat cadence than an unattended coding run, given AGNT-07's sustained-block-and-honoured-answer precedent was built for a *blocked-on-permission* run, not a *conversational* one.
   - Recommendation: Explicitly test the heartbeat/watchdog interaction for an authoring run during the spike — do not assume the existing heartbeat cadence is correct for a human-paced conversation without measuring it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI | The entire authoring session (subprocess spawn target) | ✓ [VERIFIED: `claude --version` this session] | 2.1.267 | — |
| `rusqlite`/`rusqlite_migration` | Staging schema, CHECK-constrained rebuild | ✓ [VERIFIED: packages/core/Cargo.toml] | 0.40 / 2.6 | — |
| `@modelcontextprotocol/sdk` | Authoring tool registration | ✓ [VERIFIED: packages/sidecar/package.json] | 1.30.0 | — |
| `--input-format stream-json` support | Architecture Pattern 2 Option A | Present in the installed binary per CLI flags table, but behavior unverified in this session (no live spike run — see Assumptions A1) | 2.1.267 (flag introduced ≥2.1.258) | Fall back to Option B (sequential one-shot `-p` turns), which needs no new CLI surface at all |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** Option A's stream-json transport — Option B is a fully viable, lower-risk fallback using only CLI surface this codebase already exercises in every other phase.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust: `cargo test` (packages/core, workspace-native); Node/sidecar: `node --test` (built-in test runner, per `packages/sidecar/package.json`'s `"test"` script); Desktop: `vitest run` [VERIFIED: packages/desktop/package.json:10] |
| Config file | packages/core/Cargo.toml (workspace); packages/sidecar/package.json `test` script; packages/desktop (Vitest, no separate config file observed this session — uses defaults) |
| Quick run command | `cargo test --package core <test_name>` / `node --test packages/sidecar/test/<file>.test.mjs` / `npx vitest run <file>` |
| Full suite command | `cargo test --workspace` / `npm run test` (packages/sidecar) / `npm run test` (packages/desktop, `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHAPE-01 | No proposal row exists before the challenge stage advances (D-88's own named test) | integration (Rust, real spawned `claude` process — matches `packages/sidecar/test/real-claude-argv.test.mjs`'s pattern) | `node --test packages/sidecar/test/authoring-stage-gate.test.mjs -x` | ❌ Wave 0 |
| SHAPE-02 | Accepting a staged proposal materialises a real `epics`/`tasks` row in the same transaction as its `events` append | integration (Rust) | `cargo test --package core accept_proposal_materialises_atomically -x` | ❌ Wave 0 |
| SHAPE-03 | A drafted criterion can be edited (D-94: edit-the-staged-row) before it is ever written to `acceptance_criteria` | unit (Rust) | `cargo test --package core amend_criterion_proposal -x` | ❌ Wave 0 |
| SHAPE-04 | Per-row accept/reject/amend, plus subtree-scoped bulk accept (D-95), with no tray-wide accept-all code path present | unit + a structural `<verify>` grep gate (mirrors this codebase's existing "no accept-all" pattern) | `cargo test --package core per_row_and_subtree_accept -x` + `grep -rn "accept_all_remaining" packages/` (must be empty) | ❌ Wave 0 |
| SHAPE-05 | Reopening an epic primes the D-83 rejected set and prior distilled assumptions into the new session's packet | unit (Rust, pure query — mirrors `context_packet.rs`'s own test style) | `cargo test --package core epic_context_packet_primes_rejected_set -x` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the relevant package's quick-run command above.
- **Per wave merge:** full suite for every touched package (`cargo test --workspace`, sidecar `npm test`, desktop `npm test`).
- **Phase gate:** all three full suites green, plus the phase's own spike result (Pattern 2) recorded as a decision before `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `packages/sidecar/test/authoring-stage-gate.test.mjs` — a real-`claude`-process test proving the hook denies a proposal tool call during the challenge stage and allows it after advance (extends the existing `real-claude-argv.test.mjs`/`destructive-gate.test.mjs` pattern).
- [ ] `packages/core/tests/authoring_proposal.rs` — covers SHAPE-02/03/04's accept/reject/amend/bulk-accept transactional behavior (sibling of `packages/core/tests/criteria.rs`/`criteria_pin.rs`).
- [ ] `packages/core/tests/epic_context_packet.rs` — covers SHAPE-05, sibling of the existing `packages/core/tests/context_packet.rs`.
- [ ] The spike harness itself (Pattern 2) — a throwaway script driving the real 2.1.267 binary through both Option A and Option B, whose *output* is a recorded decision, not a shipped test.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No new auth surface — reuses the existing local-credential model (AGNT-03/04), unchanged by this phase |
| V3 Session Management | yes | `agent_runs` is already the session-identity anchor; D-84's nullable `task_id`/new `epic_id` must not weaken the existing "identity derived from the run, never the caller" discipline (`session_summary.rs`'s pattern, Code Example 2) |
| V4 Access Control | yes | Every new MCP tool must be scoped server-side to the `agent_run_id` it was spawned for, exactly as `ARCHITECTURE.md` §6's failure-modes table requires ("MCP tool calls are authorization-scoped to the `task_id`/`agent_run_id` the session was started for — server-side, not prompt-enforced") [CITED: .planning/research/ARCHITECTURE.md:259] |
| V5 Input Validation | yes | Every authoring MCP tool's `inputSchema` must reject malformed refs before any DB write, matching the existing `summaryToolDefinition`'s `required`/typed-properties pattern [VERIFIED: packages/sidecar/src/mcp-permission-server.ts:300-326] |
| V6 Cryptography | no | Nothing in this phase touches secrets or crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Agent proposes a criterion/task targeting another epic's task via a spoofed `target_id` | Tampering / Elevation of Privilege | Resolve the proposal's own `epic_id`/`agent_run_id` scope from the `agent_runs` row server-side (never trust the tool call's arguments), exactly as `create_summary`'s existing discipline (Code Example 2); reject any `amend`/`delete` verb whose target row's `epic_id` does not match the run's own scope |
| Agent floods proposals to fill the tray / spam the triage lane | Denial of Service | Not explicitly decided in CONTEXT.md for this phase (Phase 6's `propose_issue` rate-limit is the named precedent, `ARCHITECTURE.md` §6's failure-modes table) — flag to the planner: consider whether a per-session proposal cap belongs in this phase or can wait for Phase 6's shared mechanism |
| Hook script (Pattern 1) fails to load or errors, silently disabling the stage gate | Tampering (bypassed control) | Match the existing `writeHookSettings` discipline: a settings-write failure degrades to "no hook injected" and is logged, never thrown — but this specific failure mode is more severe for the authoring gate than for the destructive-command gate, since a missing stage gate means "the challenge stage can be skipped entirely," directly defeating SHAPE-01. Recommend: surface this failure to the UI (visible banner) rather than silently degrading, unlike the destructive gate's current fail-open-with-log posture |

## Sources

### Primary (HIGH confidence — read directly from this repository this session)
- `packages/core/src/db/migrations/0002_board_schema.sql`, `0003_agent_runtime.sql`, `0006_recovery_statuses.sql`, `0008_session_summaries.sql`, `0009_criteria_revisions.sql` — full schema history and the CHECK-constrained rebuild pattern
- `packages/core/src/context_packet.rs` — pure-query packet assembler and its purity contract
- `packages/core/src/domain/epic.rs` (`list_epics`, unbounded — AR-01-04), `packages/core/src/domain/acceptance_criterion.rs` (`revise_criterion`, `criteria_locked_for_task`)
- `packages/sidecar/src/mcp-permission-server.ts` — the two-role MCP tool server pattern, `summaryToolDefinition`
- `packages/sidecar/src/claude-code-adapter.ts` — `buildClaudeArgv`, `writeHookSettings`, the full spawn sequence
- `packages/desktop/src-tauri/src/commands/board.rs`, `events.rs`, `agent_run.rs` — the `DEFAULT_LIMIT`/`MAX_LIMIT`/`clamp` idiom
- `packages/desktop/src/board/IssuesLane.tsx`, `packages/desktop/src/session/SessionSurface.tsx` (StatusStrip) — UI patterns this phase extends
- `.planning/research/ARCHITECTURE.md` §6 (Agent↔Board Write Path) and Anti-Pattern 2
- `.planning/research/PITFALLS.md` Pitfall 3
- `.planning/phases/01-the-board-is-the-store-of-record/01-SECURITY.md` AR-01-04
- `claude --version` on this machine → `2.1.267 (Claude Code)`

### Secondary (MEDIUM confidence — WebSearch/WebFetch, cross-checked against official docs pages where available)
- code.claude.com/docs/en/headless (fetched directly this session) — `-p` semantics, `--output-format`/`--input-format` mentions, `--continue`/`--resume` behavior, `--allowedTools`
- github.com/anthropics/claude-code/issues/77314 — MCP `list_changed` not re-fetched
- github.com/anthropics/claude-code/issues/12863 — `--disallowedTools` does not gate MCP tools in `-p` mode
- github.com/anthropics/claude-code/issues/24594, /44911 — `--input-format stream-json` documentation gaps
- github.com/anthropics/claude-code/issues/5034 — duplicate `.jsonl` entries under stream-json input
- Web search summaries of Claude Code hooks documentation (PreToolUse timing/matcher semantics) and MCP tool-hook community guides (regex matcher shape for MCP tool names)

### Tertiary (LOW confidence — not independently verified against the real binary this session)
- The exact JSON message shape for `--input-format stream-json` follow-up turns (community-sourced examples, not confirmed against 2.1.267) — this is exactly what Assumption A1 and the required spike must close

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version cited was read directly from this repo's own manifests; no new package is proposed
- Architecture (schema/write-path/UI extension patterns): HIGH — every pattern cited was read directly from shipped, tested source in this repo
- Architecture (stage-gate mechanism, conversation transport): MEDIUM/LOW — technically real per official CLI flag references and Anthropic's own issue tracker, but not verified live against the installed binary in this session; this is precisely the phase's required spike
- Pitfalls: HIGH for schema/criteria/read-bounding pitfalls (directly evidenced in this repo's own PITFALLS.md and prior-phase decisions); MEDIUM for the two CLI-behavior pitfalls (evidenced by open GitHub issues, not first-party confirmation)

**Research date:** 2026-09-23
**Valid until:** 14 days — this research leans heavily on the exact behavior of an actively-developed CLI (`claude` 2.1.267) whose flag semantics have changed release-to-release per its own changelog notes surfaced during this research (e.g. `--input-format stream-json` introduced 2.1.258, `--permission-prompts` requires 2.1.259, capability strings requiring 2.1.205+); re-verify the CLI version and the two load-bearing GitHub issues before planning if more than two weeks elapse.
