# Requirements: Flywheel (by HighKnow)

**Defined:** 2026-09-08
**Core Value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.

## v1 Requirements

Requirements for the initial release. The bar for v1 is the stated success criterion: **Cyril runs a full week of real work across his own projects from Flywheel without dropping back to a bare Claude Code terminal.** Research (`research/FEATURES.md`) established that the daily-use items are not a menu — each gap directly reproduces a reason to open a terminal.

### Data Model & Persistence

- [ ] **DATA-01**: Every board mutation is written to an append-only event log in the same transaction as the mutable projection it updates, so audit trail and current state can never diverge
- [ ] **DATA-02**: Every entity uses a client-generated globally unique identifier (ULID), never an auto-incrementing integer, so records created offline or on another device never collide
- [ ] **DATA-03**: Every mutation records the actor that made it, with humans and agents represented as distinct actors in the same actor model
- [ ] **DATA-04**: Agent work is started through a generic trigger record whose source is one of a known set, with `user_action` implemented and `schedule`/`webhook` accepted by the schema but unimplemented
- [ ] **DATA-05**: The event log is readable as an ordered, resumable stream from any point via a cursor, so a future relay can subscribe and replay without a schema change
- [ ] **DATA-06**: Worktrees, agent runs, sessions, session summaries and artifacts are first-class records with their own identity, not JSON blobs attached to a task
- [ ] **DATA-07**: The database survives an unclean application termination without corruption or loss of committed work
- [ ] **DATA-08**: Schema migrations run automatically on launch and are reversible within one version

### Board

- [ ] **BOARD-01**: User can create, edit and delete epics, tasks and issues in a fixed three-level hierarchy that cannot be reconfigured
- [ ] **BOARD-02**: Every task carries structured acceptance criteria as discrete, individually checkable items — not free prose
- [ ] **BOARD-03**: Acceptance criteria are immutable once a task starts work; changing them creates a new revision rather than overwriting
- [ ] **BOARD-04**: Items move through a fixed workflow (Backlog → Todo → In Progress → In Review → Done) that cannot be customised
- [ ] **BOARD-05**: User can reorder and reprioritise items within an epic and within the backlog
- [ ] **BOARD-06**: User can filter and search across all items in a project by text, status, epic and assignee
- [ ] **BOARD-07**: User can drive board navigation and the common item actions entirely from the keyboard
- [ ] **BOARD-08**: Board interactions complete without perceptible lag on a project containing at least 1,000 items
- [ ] **BOARD-09**: Every item shows a chronological activity trail of what changed, when, and which actor changed it
- [ ] **BOARD-10**: User can register multiple local git repositories as projects and switch between their boards

### Worktree & Branch Management

- [ ] **WORK-01**: Starting work on a task creates a dedicated git worktree for that task
- [ ] **WORK-02**: Branches follow the fixed topology: a task branch merges into its epic integration branch, which merges into the trunk
- [ ] **WORK-03**: A worktree is never destroyed without first checking for uncommitted changes; if any exist, destruction is refused and surfaced to the user
- [ ] **WORK-04**: Concurrent git operations against the same repository retry with exponential backoff and jitter on index-lock contention rather than failing the task
- [ ] **WORK-05**: Agent spawn timing is desynchronised so that parallel starts do not collide on the same repository index
- [ ] **WORK-06**: On launch, the application reconciles worktrees recorded in the database against those actually present on disk and surfaces any discrepancy to the user rather than silently repairing it
- [ ] **WORK-07**: User can see all worktrees across all projects, their disk usage, and reclaim stale ones
- [ ] **WORK-08**: A task's worktree persists across many agent sessions and is only removed on explicit completion or user action

### Git & Forge Linkage

- [ ] **LINK-01**: Every task is bound to exactly one branch whose name derives from the task identifier, so the branch is recognisable from the command line without Flywheel
- [ ] **LINK-02**: Every board item shows its branch, its commits, and its current ahead/behind position relative to its integration target
- [ ] **LINK-03**: Commits produced by an agent carry the task identifier in a commit-message trailer, so `git log` alone reveals which board item produced any change
- [ ] **LINK-04**: User can navigate from a branch name or a commit hash back to the originating board item
- [ ] **LINK-05**: A task's pull or merge request is linked to its board item, and the request's state (open, changes requested, merged, closed) is reflected on the item
- [ ] **LINK-06**: Continuous-integration status for a task's branch is visible on its board item
- [ ] **LINK-07**: Board status transitions follow git and forge state — opening a pull request moves the task to In Review, merging it moves the task to Done
- [ ] **LINK-08**: Flywheel works against GitHub and GitLab, and degrades cleanly to local-only git when no forge is configured
- [ ] **LINK-09**: User can see uncommitted changes in a task's worktree from the board without leaving the application
- [ ] **LINK-10**: Work performed outside Flywheel on a task's branch — a manual commit from a terminal — is detected and reflected on the board item, never silently overwritten
- [ ] **LINK-11**: User can open a task's worktree in their own editor or terminal in one action

### Process Supervision

- [ ] **PROC-01**: Each agent session runs as a separate operating-system process in its own worktree directory
- [ ] **PROC-02**: The supervisor never reads its own current working directory; every filesystem and git operation is issued against an explicit absolute path
- [ ] **PROC-03**: Agent processes are managed as process groups so that termination reliably kills the whole tree, not just the parent
- [ ] **PROC-04**: No agent process survives application quit; a worker self-terminates if its supervisor disappears
- [ ] **PROC-05**: On launch, orphaned agent processes and in-flight runs from a previous session are detected and surfaced to the user for a decision rather than silently resumed
- [ ] **PROC-06**: User can interrupt or stop a running agent session at any time and the worktree is left in a consistent, inspectable state
- [ ] **PROC-07**: Agent output is streamed to the user live without unbounded memory growth on a long-running session

### Agent Integration

- [ ] **AGNT-01**: All agent interaction goes through a single adapter interface; no supervisor code branches on which backend is in use
- [ ] **AGNT-02**: A Claude Code adapter drives headless sessions and normalises their event stream into the adapter's common event type
- [ ] **AGNT-03**: Agents run using the developer's existing local Claude Code credentials, with no credential ever leaving the machine
- [ ] **AGNT-04**: An explicit API-key credential path is supported as a first-class alternative to local subscription credentials
- [ ] **AGNT-05**: Rate limits and session limits from the backend are detected, backed off from, and surfaced to the user rather than retried blindly
- [ ] **AGNT-06**: Permission requests raised by a running agent surface to the user and block that agent until answered
- [ ] **AGNT-07**: Destructive actions (force-push, branch deletion, recursive delete) always require explicit confirmation, even when the session is running in an auto-accept permission mode
- [ ] **AGNT-08**: The adapter reports token usage and cost per session

### Context Reconstitution

- [ ] **CTX-01**: Every agent session ends by writing a structured summary to the board recording what changed, what remains, and what the next session must know
- [ ] **CTX-02**: Session summaries are append-only; an existing summary is never overwritten or rewritten in place
- [ ] **CTX-03**: A new session is primed automatically from the board — task, epic context, immutable acceptance criteria, prior session summaries, and the diff so far — with no chat transcript involved
- [ ] **CTX-04**: Context assembly is a deterministic query, not a model call, so the same board state always produces the same context packet
- [ ] **CTX-05**: Recent summaries are carried verbatim and older ones compacted, with the compaction boundary visible to the user
- [ ] **CTX-06**: The system detects and surfaces when a new session's stated understanding contradicts a decision already recorded on the board
- [ ] **CTX-07**: A task can be run through repeated session cycles with its acceptance criteria verifiably unchanged, demonstrated by an automated test over at least five cycles
- [ ] **CTX-08**: User can discard a session's context and start a fresh one on the same worktree in a single action, losing no board state

### Socratic Epic Authoring

- [ ] **SHAPE-01**: User can start a conversational session to shape a new epic, in which the agent challenges assumptions and asks clarifying questions before any work is planned
- [ ] **SHAPE-02**: The authoring session writes its outcome directly to the board as a structured epic with child tasks, not as a document
- [ ] **SHAPE-03**: The agent drafts acceptance criteria for each generated task, which the user can edit before accepting
- [ ] **SHAPE-04**: User can accept, reject or amend any individual item the authoring session proposes, rather than accepting the set wholesale
- [ ] **SHAPE-05**: User can reopen and continue shaping an existing epic at any time, and the agent challenges changes against what the epic already contains

### Agent-Authored Backlog

- [ ] **PROP-01**: A running agent can propose new tasks, issues and epics through a board tool interface exposed to it
- [ ] **PROP-02**: Agent-proposed items enter a distinct proposed state and never appear as accepted work until a human triages them
- [ ] **PROP-03**: No code path promotes a proposed item to active work except explicit human triage
- [ ] **PROP-04**: Proposals are checked against existing items for duplicates before being surfaced
- [ ] **PROP-05**: Proposal volume per agent run is rate-limited, and hitting the limit is surfaced rather than silently dropped
- [ ] **PROP-06**: User can triage the proposal queue — accept, reject, merge into an existing item, or defer — in a dedicated view
- [ ] **PROP-07**: Every proposal records which agent run produced it and what prompted it

### Planner & Parallel Fan-Out

- [ ] **PLAN-01**: The planner decomposes an epic into tasks each declaring the set of files it expects to modify
- [ ] **PLAN-02**: Before dispatch, the planner checks every pair of candidate parallel tasks for declared file-set overlap
- [ ] **PLAN-03**: When two tasks overlap, only that pair is downgraded to sequential execution — not the entire batch
- [ ] **PLAN-04**: A running agent is prevented at the tool level from writing to files outside its task's declared file-set
- [ ] **PLAN-05**: An agent's attempt to write outside its declared file-set is surfaced to the user as a scope event, not silently blocked
- [ ] **PLAN-06**: The planner decides how many tasks run in parallel, and the user can cap that width globally
- [ ] **PLAN-07**: User can see why any two tasks were scheduled sequentially rather than in parallel

### Fleet Supervision

- [ ] **FLEET-01**: User can see, in one view, every agent running across every registered project and what each is doing
- [ ] **FLEET-02**: A dedicated queue shows every agent currently blocked and waiting on a human, across all projects
- [ ] **FLEET-03**: User can jump from any fleet entry directly to that agent's live output and its board item
- [ ] **FLEET-04**: The fleet view distinguishes running, blocked, finished-awaiting-review, and failed states at a glance
- [ ] **FLEET-05**: The user receives an operating-system notification when an agent becomes blocked or completes

### Review & Merge

- [ ] **REVW-01**: User can review a task's full diff inside the application with syntax highlighting
- [ ] **REVW-02**: User can review the accumulated diff of an epic's integration branch
- [ ] **REVW-03**: User can check off a task's acceptance criteria against the diff during review
- [ ] **REVW-04**: User can merge a task branch into its epic integration branch from within the application, with conflicts surfaced clearly
- [ ] **REVW-05**: User can open a pull request or merge request for an epic integration branch in one action

### Distribution

- [ ] **DIST-01**: The application installs and runs on macOS from a signed, notarized build
- [ ] **DIST-02**: The application updates itself to new releases without a manual reinstall
- [ ] **DIST-03**: A developer can clone the repository and build a working desktop application from source following the documented steps
- [ ] **DIST-04**: The open-source desktop application is fully functional standalone, with no feature gated behind an account or network service

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap. Each is preserved by a named v1 seam so that adding it is additive rather than structural.

### Scheduled Automations

- **AUTO-01**: User can schedule recurring agent runs on a cron-style schedule — *seam: `DATA-04` trigger abstraction*
- **AUTO-02**: A scheduled run can propose new tasks or epics for the coming period
- **AUTO-03**: User can see, pause and edit all scheduled automations

### Team Collaboration

- **TEAM-01**: Multiple human users share a project board — *seam: `DATA-03` multi-actor model*
- **TEAM-02**: Items can be assigned to specific humans or agents
- **TEAM-03**: Users have roles and permissions on a project
- **TEAM-04**: Users see each other's presence and activity in real time

### Relay, Web & Mobile

- **RLAY-01**: A hosted relay syncs board state from a developer's machine to the cloud — *seam: `DATA-01`/`DATA-05` append-only, cursor-readable event log*
- **RLAY-02**: User can view fleet status and the "needs you" queue from a mobile device
- **RLAY-03**: User can answer permission gates and approval requests from a mobile device
- **RLAY-04**: A web application offers full board authoring parity with the desktop

### Additional Agent Backends

- **BKND-01**: An OpenAI Codex CLI adapter — *seam: `AGNT-01` adapter interface*
- **BKND-02**: A Gemini CLI adapter, handling its weaker session-resume semantics through context reconstitution
- **BKND-03**: User can run different backends on different tasks within one epic
- **BKND-04**: Adapter interface is documented and third parties can implement one

### Deferred Conveniences

- **CONV-01**: Batch approval across several ready-to-merge tasks at once
- **CONV-02**: Per-task and per-epic cost and token budgets with hard stops
- **CONV-03**: Outward connectors mirroring the board to Linear, Jira or GitHub Issues
- **CONV-04**: Cycles or other time-boxed planning constructs
- **CONV-05**: Import of an existing backlog from another tracker
- **CONV-06**: Real-time forge updates via webhooks rather than polling — *seam: `LINK-05`/`LINK-06` forge state model*

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Cloud agent execution / remote sandboxes | Flywheel is local-first by constraint; the developer's machine is the runtime and credentials never leave it |
| General-purpose PM features (time tracking, burndown, portfolio reporting, resource planning) | Differentiation is agent-native, not Jira parity; research identified this long tail as the main reason tracker projects fail |
| Configurable workflows, custom fields, custom issue types | Research established that Linear beats Jira on rigidity, not features — and the primary board consumer is an agent parsing a predictable schema |
| Multi-account credential rotation | Directly contravenes backend terms of service and is the specific behaviour vendors enforce against |
| Building on top of a cloud tracker as store of record | Every candidate (Linear, Jira, GitHub Projects) lacks an offline mode, which is disqualifying for a local-first product — see `research/COMPETITION.md` |
| Embedding or forking Plane.so | Django + Postgres + Redis + Celery inside a desktop app is architecturally heavy, and AGPL-3.0 network copyleft conflicts with the open-core boundary |
| A general-purpose chat interface to the agent | The board is the interface; a chat surface reintroduces exactly the unstructured blob the product exists to eliminate |
| Windows and Linux builds in v1 | macOS is the developer's own platform; the success criterion is personal daily use. Not architecturally excluded — Tauri builds all three |
| Self-hosted relay in the open-source distribution | The relay is the commercial layer; open-sourcing it removes the revenue model |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (pending roadmap) | — | Pending |

**Coverage:**
- v1 requirements: 93 total
- Mapped to phases: 0
- Unmapped: 93 ⚠️

---
*Requirements defined: 2026-09-08*
*Last updated: 2026-09-08 after initial definition*
