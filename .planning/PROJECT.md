# Flywheel (by HighKnow)

## What This Is

Flywheel is an Agentic Development Environment: a desktop application that lets one developer
supervise many AI coding agents at once, across many projects, by multiplexing git worktrees.
Work is not organised as chat sessions or as files in a `.planning/` folder — it lives as epics,
tasks and issues on a project board that the agents read from *and write to*. The agent challenges
you Socratically while you shape an epic, decomposes it into tasks, fans those tasks out into
isolated worktrees, executes them, and proposes new issues back onto the board as it learns.

It is for developers running "loop engineering" — continuously draining a backlog with agents
rather than hand-driving one terminal at a time. Cyril is the first user; the desktop application
is open source, and the collaboration/cloud layer is the commercial product.

## Core Value

**Every unit of agent work is anchored to a structured board item with real acceptance criteria —
never a chat blob.** If everything else fails, this must hold.

The corollary is the whole product thesis: *the board is the context-reconstitution mechanism that
makes `/clear` free.* A worktree is a cheap, durable resource owned by a task and outliving many
agent sessions; an agent context is expensive, short-lived and disposable. Chat-native tools cannot
discard a context without losing the thread, so their contexts rot. A board-native ADE can discard
contexts constantly and lose nothing, because every new session reconstitutes from the issue, its
acceptance criteria, prior session summaries and the diff so far. That asymmetry is the wedge.

## Business Context

- **Customer**: Developers and small teams running multiple AI-assisted projects in parallel; Cyril first.
- **Revenue model**: Open core. The desktop ADE (board, agent supervision, worktrees) is OSS and fully usable solo. Relay, sync, mobile, web, and team collaboration are the paid cloud.
- **Success metric**: v1 — Cyril runs a full week of real work across his own projects from Flywheel without dropping back to a bare Claude Code terminal.
- **Strategy notes**: Positioning and competitive landscape to be established by `.planning/research/` before requirements are frozen.

## Requirements

### Validated

- ✓ **The board is the store of record** — Phase 1. Epics, tasks and issues live in SQLite with a
  fixed three-level hierarchy, individually checkable acceptance criteria, and a five-state workflow
  that has no reconfiguration path (the CHECK constraint, not app code, is the authority). Search,
  filter and reorder hold at 1,000+ items, every item carries an actor-attributed activity trail, and
  the whole thing survives force-quit and a migrating relaunch. 22/22 must-haves and all 15
  requirement IDs verified; 277 automated tests green. **The half still owed is agents writing to it**
  — Phase 1 proved the store, not yet the agent loop over it (Phase 6).

### Active

- [ ] Board-native work model: epics, tasks and issues are the primary artifact, replacing `.planning/` files as the store of record for phase structure
- [ ] Socratic epic authoring: the agent challenges the user while an epic is being shaped, in the manner of GSD's discuss/research/plan phases, and writes the resulting structure as board items
- [ ] Agent-authored backlog: agents propose new tasks, issues and epics from what they learn while working; the user triages them
- [ ] Multi-project fleet supervision: one view answering "what is every agent, everywhere, doing — and what needs me?"
- [ ] Git worktree multiplexing with fixed topology: task worktree → epic integration branch → main
- [ ] Planner-sized fan-out: the planner decides parallel width and wave grouping from declared file-sets, with a runtime file-overlap guard as a safety net
- [ ] Ephemeral agent sessions: many disposable sessions per durable task worktree, each reconstituted from the board rather than from a transcript
- [ ] Claude Code as the v1 agent backend, using the developer's existing local credentials
- [ ] Agent adapter seam: a documented interface so Codex, Gemini CLI and others can be added later without a core rewrite
- [ ] Extension-ready foundations — **2 of 3 landed in Phase 1.** Multi-actor identity ships
  (`actors.type IN ('human','agent','system')`, every mutation actor-attributed server-side) and the
  durable append-only event log ships (`events`, gap-free and resumable from any cursor, proved by
  `cursor_resume.rs`). **The generic trigger abstraction is NOT built** — no scheduler crate is
  vendored and no trigger type is stubbed, so schedule-as-trigger-source is still a retrofit rather
  than the drop-in the architecture constraint requires. Close this before the automations milestone.
- [ ] Cap the epic roster before an agent can create epics — **emerged in Phase 1.** `epic_roster`
  deliberately returns every epic in a project, exempt from the `DEFAULT_LIMIT`/`MAX_LIMIT` cap
  (`01-SECURITY.md` AR-01-04). It is safe only because one human creates epics one at a time; it
  becomes an unbounded response the moment an agent or a bulk import gets that path. Recorded here
  rather than left as an accepted-risk row, because the trigger is a scheduled later phase.

### Out of Scope

- Scheduled automations ("every Monday, suggest what to work on") — deferred to a later milestone, but the generic trigger abstraction must make schedule-as-trigger-source a drop-in
- Team collaboration: multi-user boards, roles, presence, shared projects — the paid-cloud hook, deferred, but multi-actor identity must exist in the v1 schema
- Mobile and web surfaces, and the secure relay that serves them — deferred, but the append-only event log must be designed as something a relay can subscribe to
- Additional agent backends (Codex CLI, Gemini CLI) — only the adapter seam ships in v1, not a second implementation
- Cloud agent execution / remote sandboxes — Flywheel is local-first; the developer's machine is the runtime and credentials never leave it
- Rebuilding general-purpose PM features that do not serve agents (time tracking, sprint burndown, portfolio reporting) — differentiation is agent-native, not Jira parity

## Context

**Origin.** The user runs GSD-core and superpowers today. GSD structures work as phases in a
`.planning/` folder; the insight driving Flywheel is that this structure wants to be a live,
queryable, agent-writable board rather than markdown files — and that once it is, agents can
participate in backlog shaping rather than only consuming plans.

**How GSD-core solves parallelism today** (studied during questioning, `workflows/execute-phase.md`):
its unit of parallel work is the *plan*, not the epic or the task. The planner declares each plan's
`files_modified` up front and assigns a wave number from dependency analysis. Waves run in sequence;
plans within a wave run in parallel, each in its own git worktree. Before spawning, a pairwise
`files_modified` overlap check across the wave downgrades that wave to sequential if any two plans
touch the same file (`execute-phase.md:595`) — a runtime guard that exists precisely because the
planner's file forecast is frequently wrong. The transferable lesson: **the partitioning key for
parallelism is file-set disjointness, not issue hierarchy.** Two tasks in the same epic that both
edit one schema file cannot run in parallel however you slice epics.

**Known failure mode to design against.** GSD carries an explicit guard against the orchestrator's
working directory drifting into an agent's worktree (`execute-phase.md:514`). At fleet scale across
multiple projects this gets materially worse. The supervisor process must never share a working
directory with a worker.

**Open question deferred to research.** Whether to build the PM core from scratch (agent-native
schema, maximum differentiation, most work) or integrate an existing tool (Linear / Jira / Plane —
fastest, but agent state is bolted onto a schema that never wanted it). The user's stated
requirement that agents author and mutate board items bidirectionally, and that the board serve as
the context-reconstitution substrate, pressures this toward owning the core — but the tradeoff is
explicitly left to the competitive and architecture research to argue.

**Prior exploration.** No spikes or sketches exist yet.

## Constraints

- **Architecture**: No v1 decision may foreclose scheduled automations, team collaboration, the mobile/web relay, or additional agent backends — Explicitly stated as a hard requirement: "I don't want the code structure or architecture to limit me in any way later." These are cheap to accommodate now and near-impossible to retrofit.
- **Execution model**: Local-first. Agents run on the developer's machine using their existing local agent credentials — Credentials must never leave the desk; this is also what makes the OSS desktop app independently useful.
- **Agent backend**: Claude Code only in v1, behind an adapter interface — Ship one backend well; prove the seam without paying for a second auth/streaming/tooling integration.
- **Surface**: Desktop only in v1 — Smallest v1 that proves the loop. Mobile and web are a separate milestone.
- **Licensing**: Desktop ADE open source; cloud/relay/teams commercial — The open/paid boundary must fall on a clean module seam in the codebase, not be retrofitted later.
- **Naming**: Product is "Flywheel" by HighKnow — "Harness" collides directly with Harness.io, a large company in the identical category (developer tooling / SDLC automation).
- **Tech stack**: Undecided; desktop shell (Tauri vs Electron vs native) deferred to research — Load-bearing choice; must be argued against process supervision needs, node-based agent CLIs, and future web parity rather than assumed.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Board replaces `.planning/` as the store of record | Agents must write to the work model, not just read plans from it; a live board enables Socratic authoring and agent-proposed backlog items | ✓ Half-validated (Phase 1) — the board exists, is durable across crash and migration, and holds the full work model. Agents reading/writing it is unproven until Phase 6 |
| Board is the context-reconstitution mechanism | Decouples durable work state from ephemeral agent context, making `/clear` free instead of lossy — the core differentiator vs chat-native tools | — Pending |
| Worktree topology is fixed: task → epic integration branch → main | Planner-chosen topology creates a combinatorial testing surface for little gain; the epic integration branch prevents N agents racing merges into main and gives the board one reviewable PR per epic | — Pending |
| Planner decides fan-out width and wave grouping, not topology | Parallelism is bounded by file-set disjointness; the planner's job is declaring file-sets and grouping waves, with a runtime overlap guard for when the forecast is wrong | — Pending |
| Worktrees are durable; agent sessions are ephemeral | A worktree is cheap and owned by a task; contexts are expensive and rot. Many sessions per worktree, each reconstituted from the board | — Pending |
| Claude Code only in v1, behind an adapter seam | Proves the abstraction is designed without paying to implement a second backend | — Pending |
| Desktop-only v1; relay/mobile/web deferred | Smallest v1 that proves the loop end to end | — Pending |
| Multi-actor identity, append-only event log, generic trigger abstraction in v1 schema | The three retrofits that would otherwise be structural rewrites when teams, relay sync, and automations arrive | ◐ 2 of 3 landed (Phase 1). Identity and event log ship and are test-proved; the trigger abstraction was not built and remains a genuine retrofit risk |
| Open desktop / paid cloud | Adoption via OSS desktop; monetise the collaboration layer that only makes sense hosted | — Pending |
| Name: Flywheel, not Harness | Harness.io is a large incumbent in the identical category; Flywheel's only namesake is in an unrelated industry, and it names the thesis | — Pending |
| Build-vs-integrate for the PM core is deliberately open | Highest-leverage architectural fork; deferred to research rather than decided on instinct | ✓ Resolved by Phase 1 — **build**. The PM core is a Rust/`rusqlite` board owning its own schema, migrations and event log. Decided by shipping it, not by a separate research round; the integrate option is now closed without having been separately argued |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Business Context check — customer, revenue model, success metric still accurate?
4. Audit Out of Scope — reasons still valid?
5. Update Context with current state

---
*Last updated: 2026-09-10 after Phase 1*
