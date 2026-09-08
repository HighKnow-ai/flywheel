# Flywheel Research Summary

**Project:** Flywheel (by HighKnow)  
**Domain:** Agentic Development Environment (ADE) — local-first desktop supervisor for parallel AI coding agents with an agent-writable project board  
**Researched:** 2026-09-08  
**Confidence:** HIGH on architecture and build decision; MEDIUM on features and competitive dynamics (this market moves fast)

---

## Executive Summary

Flywheel is a local-first desktop app that solves a real gap in the market: every existing product for supervising multiple AI agents treats the work-in-progress state as either ephemeral chat threads (Conductor, Nimbalyst) or API-bound cloud schemas (Linear, Jira). Flywheel's wedge is a structured, agent-writable project board that is the *only* persistent thing — agent sessions are disposable, worktrees are durable, and reconstituting an agent's context from board items instead of a transcript makes `/clear` genuinely free. Research found no shipping product combining all four of: (a) structured acceptance criteria as first-class fields, (b) explicit session-worktree-task linkage, (c) local-first offline execution, and (d) multi-project fleet supervision.

**Build-vs-integrate decision, resolved by COMPETITION.md research:** Build the PM core from scratch. Every cloud-only candidate (Linear, Jira, GitHub Projects) fails the hard local-first constraint outright; Plane.so is technically self-hostable but trades a simpler schema for a heavier, AGPL-licensed server stack. The schema Flywheel needs — epics/tasks/issues with structured acceptance criteria, worktree linkage, and an append-only event log — is deliberately bounded and achievable, and owning it keeps the open-core boundary (desktop OSS / relay-commerce) clean and defensible. Confidence: HIGH.

**Key risk, from market observation:** Nimbalyst (MIT-licensed successor to Crystal) already ships local desktop, Claude Code sessions, git worktrees, and a kanban board; adding structured acceptance criteria and an epic layer is a matter of weeks for a team shipping at their velocity. Flywheel's moat is not the combination itself (Nimbalyst can copy that) but shipping the harder-to-copy layers first: Socratic epic authoring, agent-proposed backlog items, and the context-reconstitution mechanism that makes the board a genuine context substrate, not just a task tracker. Build and validate those before platform commoditizes.

---

## Key Findings

### Recommended Stack (from STACK.md)

**Desktop shell:** Tauri v2 (Rust core + bundled Node.js sidecar + React UI in OS WebView), not Electron. Smaller footprint (~50-80MB with Node sidecar, vs. ~200MB+ Electron+Chromium), default-deny permission model that structurally prevents supervisor drift into worker worktrees, and an official sidecar pattern that keeps the Claude Agent SDK (TypeScript-first) in the Node runtime where it belongs instead of forcing a Rust reimplementation. Confidence: MEDIUM.

**Persistence layer:** `rusqlite` 0.40.x (embedded SQLite, Rust core, WAL mode) as the local store of record. Do not adopt a sync vendor (PowerSync, Zero, ElectricSQL) now; instead, design the v1 schema so any of them can bolt on later without a rewrite. The key is building three things that every sync engine expects: (1) append-only event log as source of truth with materialized "current state" tables, (2) client-generated globally-unique keys (ULIDs, not AUTOINCREMENT), (3) actor attribution on every mutation. Schema-first, vendor-second. Confidence: MEDIUM-LOW on which vendor wins eventually (this market moved twice in 12 months), MEDIUM-HIGH on the "defer vendor, design the schema" strategy itself.

**Agent integration:** Claude Agent SDK 0.3.x, headless mode (`--output-format stream-json`), driving the user's own local `claude` CLI credentials rather than intercepting OAuth tokens. This is Anthropic's sanctioned automation path and satisfies the local-first, credentials-never-leave-desk constraint. Behind an `AgentAdapter` interface so Codex CLI and Gemini CLI can be added later without rewriting the core. Confidence: HIGH for Claude Code integration, MEDIUM for the abstraction's resistance to future backends.

**Frontend:** React 18-19 + TanStack Query (for UI-relay reusability later) + React Flow (DAG/board views) + `react-diff-view` (unified diff review).

### Expected Features (from FEATURES.md)

**The v1 "minimum for daily use" — must all ship together or the product is worse than a terminal:**

1. **Board as store of record** — epics/tasks/issues with fixed hierarchy, fixed workflow (Backlog/Todo/In Progress/In Review/Done), structured acceptance criteria — not configurable, not flexible, deliberately opinionated like Linear not Jira.
2. **Worktree lifecycle and fixed topology** — task spawns one worktree, fixed branch chain (task → epic-integration-branch → main), auto-cleanup. One file-overlap collision that destroys work will make the user revert to one-agent-at-a-time.
3. **Structured session-end summary written to board** — every session ending captures what changed, what's left, what the next session should know, into a board-visible summary; this is the entire differentiator vs. chat-native tools.
4. **Context reconstitution** — new session is auto-primed from board item + acceptance criteria + prior summaries + diff-so-far. This is the thesis: `/clear` is free because the thread was never on the chat; it was on the board.
5. **Single-project fleet status + "needs you" queue** — in one glance, which agent needs input; without this, fleet supervision is tab-cycling through terminals.
6. **Socratic epic authoring** — conversational shaping that writes structured epic/task output to the board; agents challenge the human on assumptions before work begins, then emit boilerplate acceptance criteria.
7. **Agent-authored backlog** — agents propose new tasks mid-execution into a distinct human-triage lane; prevents backlog spam with a structural gate (proposed → triaged → accepted → active).
8. **File-overlap pre-flight guard** — before dispatching parallel tasks, check for pairwise declared-file-set overlap; if collision found, downgrade that pair to sequential instead of the whole wave.
9. **Diff review + one-click PR** — per-task diff UI with syntax highlight, per-epic integration-branch diff, one-click PR creation matching the fixed topology.
10. **Permission gating with hard destructive-action gates** — inherited from Claude Code, surfaced per-agent in fleet view; gate on force-push/delete/rm even in auto-accept mode.

These are not a menu to pick from — each gap directly reproduces a reason to open a terminal. Research on competing tools (Conductor, Nimbalyst, Linear) confirms every v1 shipped product that skipped one of these reported early users reverting to workaround workflows.

**Deferred to v1.x or v2+:**
- Cross-project fleet view (get single-project right first)
- Cost/token visibility per task (nice-to-have, low complexity)
- Batch approval across multiple ready-to-merge tasks
- Cycles/time-boxed planning construct
- Scheduled automations (trigger abstraction ships in v1, schedule-as-source does not)
- Team collaboration, mobile/web, additional agent backends

### Architecture Approach (from ARCHITECTURE.md)

**Process topology:** Supervisor process (one, long-lived) owns the database, planner, context assembly, and worker lifecycle. Supervisor's cwd is set once at launch and never read; every git/fs operation takes an explicit absolute path. Worker processes (one per agent session) are spawned into their own worktree cwd and cannot mutate the supervisor's state — this structure makes GSD-core's guard against "orchestrator cwd drift into a worker's directory" not just detectable but architecturally impossible. This is not a minor detail; at fleet scale across multiple projects, cwd collisions are catastrophic.

**Domain schema:** Event-sourced with mutable projection and transactional outbox. Every mutation appends an `Event` row in the same transaction as updating mutable tables (epics, tasks, issues, agent_runs), so audit trail and current state never diverge. `Trigger` entity (user_action today, schedule/webhook later), `Actor` entity (single human+system in v1, but multi-actor schema exists), ULID primary keys (not AUTOINCREMENT), and `SessionSummary` as an append-only sequence per worktree, not overwritten in place. This design satisfies three PROJECT.md constraints that would otherwise be retrofit nightmares: multi-actor identity for teams, append-only event log for relay sync, and generic trigger abstraction for automations.

**Context reconstitution:** Pure query function (not an LLM call) that assembles a packet from task record + epic context + recent summaries (verbatim for last 3-5, compacted for older) + diff-so-far + unresolved permission requests + open issues from prior sessions + project conventions. Ground truth is the diff (cannot degrade like prose), acceptance criteria are immutable, summaries are append-only (telephone-game risk is auditable). Context deserves to be treated as **the** core differentiator architecturally — everything else (UI, fleet view, Socratic authoring) is valuable but derivative.

**Agent adapter interface:** `startSession(worktreeePath, contextPacket, permissionMode)` → `AsyncIterable<AgentEvent>`. Every adapter normalizes its backend's native event schema (Claude Code's stream-json, Codex's turn.started/completed, Gemini's approval events) into one union type; supervisor never branches on backend identity outside the adapter. Validated against current docs for Claude Code, Codex, Gemini — interface resists all three without forcing architectural change when a backend's capability (like session resume) is weak or absent.

**Build order:** (1) Domain schema + persistence, (2) Supervisor skeleton + cwd discipline, (3) Worktree manager, (4) Agent adapter + Claude Code, (5) Context assembler, (6) MCP board-server (agent write path), (7) Renderer/single-project board UI, (8) Planner (fan-out guard), (9) Fleet/multi-project view. The thinnest vertical slice is a single task with two sequential sessions on one worktree, reconstituted entirely from the board — exercises 1-5 and 7 without requiring the planner or fleet view.

### Critical Pitfalls (from PITFALLS.md)

1. **Worktree lock contention destroys work at fan-out width (CRITICAL).** Real filed issue (claude-code#55724): 8 of 13 parallel agents lost work to `.git/index.lock` collisions, then auto-cleanup deleted the worktree. Mitigation: retry `git commit`/`git add` with exponential backoff (200ms→400ms→800ms); **never destroy a worktree without checking `git status --porcelain` for uncommitted changes first**; add jitter to spawn timing to desynchronize git operations. Must be solved before first multi-agent wave ships, not bolted on after. This is the single fastest way to destroy user trust.

2. **Agents modify files outside declared file-set, invalidating the planner's parallelism guarantee (CRITICAL).** ~35% of scoped AI tasks touch unrelated files without tool-level enforcement; a pre-write hook checking every Edit/Write tool call against declared file-set cuts this to ~4%. The overlap guard only sees declared files; the tool-level guard catches undeclared writes. These are companion enforcement mechanisms, not alternatives.

3. **Context reconstitution silently degrades via telephone-game degradation (CRITICAL).** The board-as-context thesis fails invisibly if summaries are overwritten in place (no audit trail of degradation) or if acceptance criteria drift across session cycles. Mitigation: summaries are append-only (same rows, never overwritten), acceptance criteria are immutable and stored separately from prose, diff-so-far is ground truth, and a detection signal surfaces when a new session contradicts what the board says was decided. Test this explicitly by running the same task through 5+ synthetic session cycles and diffing reconstituted context against originals.

4. **Zombie agent processes survive app quit, burning unattended tokens (CRITICAL).** Tauri/Electron don't guarantee child cleanup on exit. Use process groups not bare PIDs; implement "child monitors parent, self-terminates if parent dies" as backstop; reconcile on startup (surface orphaned worktrees to user, don't silently resume). This is financial harm (unattended API spend) and reputational damage if discovered.

5. **Local credential reuse hits Anthropic compliance boundaries (EXISTENTIAL).** Anthropic actively enforces against third-party harness use of subscription OAuth tokens; Flywheel's model (driving the user's own local `claude` CLI) reduces risk but doesn't eliminate it. Support `ANTHROPIC_API_KEY`/`apiKeyHelper` path as first-class alternative; build visible rate-limit/session-limit backoff so Flywheel doesn't look like abuse. This is outside Flywheel's control — a policy shift could invalidate v1 overnight. Flag as ongoing external dependency for milestones, not solve-and-forget.

---

## Implications for Roadmap

Research surfaces a clear dependency order and risk ordering. The vertical slice (single task, two sequential sessions, board-reconstituted context) must ship before planner, fleet view, or agent-authored backlog — they all depend on the core loop working end-to-end.

### Suggested Phases

**Phase 1: Foundational Data Model & Supervisor Core**
- Everything depends on this; worktree lock contention and context rot stem from mistakes here, not later
- Delivers: domain schema (epics/tasks/issues, acceptance criteria), event-sourced persistence (append-only events, actor attribution, ULIDs), supervisor skeleton with cwd-safety discipline
- Avoids: Pitfalls 3, 7 (retrofit nightmares)

**Phase 2: Worktree Manager & Process Supervision**
- Worktree operations and agent-process lifecycle must be bulletproof before parallel agents run
- Delivers: fixed topology, lock-contention retry logic, process group management, orphan reconciliation
- Avoids: Pitfalls 1, 4, 9

**Phase 3: Claude Code Adapter & Context Assembler**
- The agent-worktree-context loop must work before anything else makes sense
- Delivers: adapter interface, headless mode integration, context packet assembly
- Avoids: Pitfall 5 (credential boundaries documented)

**Phase 4: Session-End Summarization & Context Reconstitution**
- This is the thesis; test it end-to-end on the vertical slice
- Delivers: session-end capture, append-only summaries, reconstitution from board + diff across 5+ session cycles
- Critical test: run same task through 5+ sessions; diff acceptance criteria against originals to ensure no silent drift

**Phase 5: Renderer UI & Single-Project Board View**
- Need visible board for Phases 1-4 validation
- Delivers: board view (read-only, then create/edit), session viewer, single-project fleet view, diff review UI

**Phase 6: MCP Board-Server & Socratic Authoring**
- Agents need to propose work and emit summaries
- Delivers: MCP tools (propose_issue, report_summary), Issue table with "proposed" state gate, Socratic epic authoring, duplicate detection
- Avoids: Pitfalls 2, 6 (scope creep, backlog spam)

**Phase 7: Planner & File-Overlap Guard**
- Multi-agent fan-out only possible once per-task file-set enforcement exists
- Delivers: planner with wave grouping, pairwise overlap check, tool-level pre-write hook, mid-flight collision detection
- Avoids: Pitfalls 1, 2

**Phase 8: Agent-Authored Backlog & Triage**
- Governance gate (proposed state) is non-negotiable or trust collapses
- Delivers: Issue flows with triage queue, duplicate detection, rate-limiting, triage UI

**Phase 9: Multi-Project Fleet View**
- Generalize single-project views only once proven solid

**Phase 10: Distribution, Signing, Notarization**
- Tauri's defaults work; macOS budgeting is real ($99/yr Apple Developer account)

### Phase Ordering Rationale

1. Schema first, then supervise — everything depends on the schema being correct
2. Worktree safety before agents — lock contention and process cleanup must be infrastructure, not bolted-on after data loss
3. Agent loop before anything else — adapter + context assembly + session lifecycle blocks all downstream work
4. Reconstitution validation early — this is the thesis; test it on vertical slice before scaling
5. Board UI for validation — Phases 1-4 need visibility; basic board view is prerequisite for testing
6. Agent writes and Socratic authoring together — both require stable board state
7. Planner + file-set enforcement together — companion mechanisms, not alternatives
8. Backlog governance in Phase 8 — agent-authored items in scope; triage gate is non-negotiable
9. Fleet view last — multi-project aggregation only makes sense once single-project is proven

### Research Flags

**Phases needing deeper research during planning:**
- **Phase 1 (Schema):** Can relay actually subscribe to event log and replay events? Can actor identity extend to multi-remote without schema migration?
- **Phase 2 (Worktree):** Expand lock-contention evidence base; test with multiple git versions
- **Phase 4 (Context Reconstitution):** Build synthetic test suite before shipping; measure context-quality metrics explicitly
- **Phase 6 (Socratic Authoring):** Spike with target users to confirm epic-authoring flow is faster/better than terminal; this is a high-assumption feature

**Phases with standard patterns (skip research-phase):**
- **Phase 5 (Renderer/UI):** React + TanStack Query + Tauri are proven; no novel research needed
- **Phase 10 (Distribution):** Tauri's signing/notarization documented and proven; execution only

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| **Build Decision** | **HIGH** | COMPETITION.md exhaustive: every cloud option fails local-first; Plane trades simpler schema for AGPL+server overhead |
| **Architecture** | **HIGH** | Grounded in GSD-core's execute-phase.md; supervisor-worker separation and cwd-safety proven |
| **Stack** | **MEDIUM-HIGH** | Tauri + Node sidecar verified; sync landscape moved twice in 12 months, so deferring vendor choice (not schema) is sound |
| **Features** | **MEDIUM** | Derived from competitor analysis; but this category has 4 deaths/pivots in 18 months — user validation will refute/confirm |
| **Pitfalls** | **MEDIUM** | Lock contention is HIGH (filed issue + postmortem); context rot is MEDIUM (LLM research, not agent-specific); credential risk is MEDIUM (policy observed, external dependency) |
| **Market Positioning** | **MEDIUM-HIGH** | Nimbalyst threat is HIGH (shipped, observable velocity); "nobody has the combination" is HIGH; open-core model is MEDIUM (based on precedent) |

**Overall:** MEDIUM-HIGH for architecture and build decision; MEDIUM for features and competitive landscape

### Gaps to Address

1. **Socratic authoring UX validation** — Assumption: it's faster than terminal prompting. Validate with spec-driven developers during Phase 6 planning.
2. **Context-reconstitution degradation measurement** — Build explicit metrics and test suite (Phase 4 spike); don't ship without evidence thesis holds.
3. **Nimbalyst reconnaissance** — They are fast (Crystal→Nimbalyst in ~2 months). Checkpoint at Phase 5-6 before Socratic authoring ships.
4. **Anthropic credential-policy monitoring** — External dependency with history of shifts. Milestone-level review item, not one-time decision.
5. **Session-resume semantics for Gemini CLI** — Claude Code and Codex support it; Gemini's headless JSON doesn't yet (open issue). Handle explicitly when Gemini adapter is built.

---

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — constraints, decisions, deferred capabilities
- `ARCHITECTURE.md` — schema, event sourcing, adapter interface, build order (verified against Claude Code/Codex/Gemini CLI docs)
- `anthropics/claude-code#55724` — worktree lock contention data loss (filed issue, reproduced)
- `git-scm.com/docs/git-worktree` — official git-worktree behavior

### Secondary (MEDIUM confidence)
- `STACK.md` — Tauri, Node sidecar, SQLite, Agent SDK (verified against official docs 2026-09-08)
- `FEATURES.md` — competitor analysis (21 products mapped), feature dependencies
- `COMPETITION.md` — build-vs-integrate analysis, market map, positioning
- `PITFALLS.md` — context rot, credential risks, deployment pitfalls

### Tertiary (MEDIUM-LOW confidence)
- Market churn (4 deaths/pivots in 18 months) — subject to fast changes
- Sync-engine landscape (PowerSync Beta, Zero 1.0, Electric pivot) — 2026 data, moves monthly

---

**Research completed:** 2026-09-08  
**Build decision:** Build the PM core from scratch  
**Positioning:** "The board that survives your agent's context window — so `/clear` is free"  
**Beachhead:** Solo and small-team developers with structured (spec-driven) workflows  
**Threat:** Nimbalyst can add acceptance-criteria + epics in weeks; Flywheel's moat is shipping harder-to-copy layers first (Socratic authoring, agent-authored backlog, context reconstitution)  
**Ready for roadmap:** yes
