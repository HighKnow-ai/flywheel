# Requirements: Flywheel (by HighKnow)

**Defined:** 2026-09-08
**Core Value:** Every unit of agent work is anchored to a structured board item with real acceptance criteria — never a chat blob.

## v1 Requirements

Requirements for the initial release. The bar for v1 is the stated success criterion: **Cyril runs a full week of real work across his own projects from Flywheel without dropping back to a bare Claude Code terminal.** Research (`research/FEATURES.md`) established that the daily-use items are not a menu — each gap directly reproduces a reason to open a terminal.

### Data Model & Persistence

- [x] **DATA-01**: Every board mutation is written to an append-only event log in the same transaction as the mutable projection it updates, so audit trail and current state can never diverge
- [x] **DATA-02**: Every entity uses a client-generated globally unique identifier (ULID), never an auto-incrementing integer, so records created offline or on another device never collide
- [x] **DATA-03**: Every mutation records the actor that made it, with humans and agents represented as distinct actors in the same actor model
- [x] **DATA-04**: Agent work is started through a generic trigger record whose source is one of a known set, with `user_action` implemented and `schedule`/`webhook` accepted by the schema but unimplemented
- [x] **DATA-05**: The event log is readable as an ordered, resumable stream from any point via a cursor, so a future relay can subscribe and replay without a schema change
- [x] **DATA-06**: Worktrees, agent runs, sessions, session summaries and artifacts are first-class records with their own identity, not JSON blobs attached to a task
- [x] **DATA-07**: The database survives an unclean application termination without corruption or loss of committed work
- [x] **DATA-08**: Schema migrations run automatically on launch and are reversible within one version

### Board

- [x] **BOARD-01**: User can create, edit and delete epics, tasks and issues in a fixed three-level hierarchy that cannot be reconfigured
- [x] **BOARD-02**: Every task carries structured acceptance criteria as discrete, individually checkable items — not free prose
- [x] **BOARD-03**: Acceptance criteria are immutable once a task starts work; changing them creates a new revision rather than overwriting
- [x] **BOARD-04**: Items move through a fixed workflow (Backlog → Todo → In Progress → In Review → Done) that cannot be customised
- [x] **BOARD-05**: User can reorder and reprioritise items within an epic and within the backlog
- [x] **BOARD-06**: User can filter and search across all items in a project by text, status, epic and assignee
- [x] **BOARD-07**: User can drive board navigation and the common item actions entirely from the keyboard
- [x] **BOARD-08**: Board interactions complete without perceptible lag on a project containing at least 1,000 items
- [x] **BOARD-09**: Every item shows a chronological activity trail of what changed, when, and which actor changed it
- [x] **BOARD-10**: User can register multiple local git repositories as projects and switch between their boards

### Worktree & Branch Management

- [x] **WORK-01**: Starting work on a task creates a dedicated git worktree for that task
- [x] **WORK-02**: Branches follow the fixed topology: a task branch merges into its epic integration branch, which merges into the trunk
- [x] **WORK-03**: A worktree is never destroyed without first checking for uncommitted changes; if any exist, destruction is refused and surfaced to the user
- [x] **WORK-04**: Concurrent git operations against the same repository retry with exponential backoff and jitter on index-lock contention rather than failing the task
- [x] **WORK-05**: Agent spawn timing is desynchronised so that parallel starts do not collide on the same repository index
- [x] **WORK-06**: On launch, the application reconciles worktrees recorded in the database against those actually present on disk and surfaces any discrepancy to the user rather than silently repairing it
- [ ] **WORK-07**: User can see all worktrees across all projects, their disk usage, and reclaim stale ones
- [x] **WORK-08**: A task's worktree persists across many agent sessions and is only removed on explicit completion or user action

### Git & Forge Linkage

- [x] **LINK-01**: Every task is bound to exactly one branch whose name derives from the task identifier, so the branch is recognisable from the command line without Flywheel
- [x] **LINK-02**: Every board item shows its branch, its commits, and its current ahead/behind position relative to its integration target
- [x] **LINK-03**: Commits produced by an agent carry the task identifier in a commit-message trailer, so `git log` alone reveals which board item produced any change
- [x] **LINK-04**: User can navigate from a branch name or a commit hash back to the originating board item
- [x] **LINK-05**: A task's pull or merge request is linked to its board item, and the request's state (open, changes requested, merged, closed) is reflected on the item
- [x] **LINK-06**: Continuous-integration status for a task's branch is visible on its board item
- [x] **LINK-07**: Board status transitions follow git and forge state — opening a pull request moves the task to In Review, merging it moves the task to Done
- [x] **LINK-08**: Flywheel works against GitHub and GitLab, and degrades cleanly to local-only git when no forge is configured
- [x] **LINK-09**: User can see uncommitted changes in a task's worktree from the board without leaving the application
- [x] **LINK-10**: Work performed outside Flywheel on a task's branch — a manual commit from a terminal — is detected and reflected on the board item, never silently overwritten
- [x] **LINK-11**: User can open a task's worktree in their own editor or terminal in one action

### Process Supervision

- [x] **PROC-01**: Each agent session runs as a separate operating-system process in its own worktree directory
- [x] **PROC-02**: The supervisor never reads its own current working directory; every filesystem and git operation is issued against an explicit absolute path
- [x] **PROC-03**: Agent processes are managed as process groups so that termination reliably kills the whole tree, not just the parent
- [x] **PROC-04**: No agent process survives application quit; a worker self-terminates if its supervisor disappears
- [x] **PROC-05**: On launch, orphaned agent processes and in-flight runs from a previous session are detected and surfaced to the user for a decision rather than silently resumed
- [x] **PROC-06**: User can interrupt or stop a running agent session at any time and the worktree is left in a consistent, inspectable state
- [x] **PROC-07**: Agent output is streamed to the user live without unbounded memory growth on a long-running session

### Agent Integration

- [x] **AGNT-01**: All agent interaction goes through a single adapter interface; no supervisor code branches on which backend is in use
- [x] **AGNT-02**: A Claude Code adapter drives headless sessions and normalises their event stream into the adapter's common event type
- [x] **AGNT-03**: Agents run using the developer's existing local Claude Code credentials, with no credential ever leaving the machine
- [x] **AGNT-04**: An explicit API-key credential path is supported as a first-class alternative to local subscription credentials
- [ ] **AGNT-05**: Rate limits and session limits from the backend are detected, backed off from, and surfaced to the user rather than retried blindly
- [x] **AGNT-06**: Permission requests raised by a running agent surface to the user and block that agent until answered
- [x] **AGNT-07**: Destructive actions (force-push, branch deletion, recursive delete) always require explicit confirmation, even when the session is running in an auto-accept permission mode
- [ ] **AGNT-08**: The adapter reports token usage and cost per session

### Context Reconstitution

- [x] **CTX-01**: Every agent session ends by writing a structured summary to the board recording what changed, what remains, and what the next session must know
- [x] **CTX-02**: Session summaries are append-only; an existing summary is never overwritten or rewritten in place
- [x] **CTX-03**: A new session is primed automatically from the board — task, epic context, immutable acceptance criteria, prior session summaries, and the diff so far — with no chat transcript involved
- [x] **CTX-04**: Context assembly is a deterministic query, not a model call, so the same board state always produces the same context packet
- [x] **CTX-05**: Recent summaries are carried verbatim and older ones compacted, with the compaction boundary visible to the user
- [x] **CTX-06**: The system detects and surfaces when a new session's stated understanding contradicts a decision already recorded on the board
- [x] **CTX-07**: A task can be run through repeated session cycles with its acceptance criteria verifiably unchanged, demonstrated by an automated test over at least five cycles
- [x] **CTX-08**: User can discard a session's context and start a fresh one on the same worktree in a single action, losing no board state

### Socratic Epic Authoring

- [x] **SHAPE-01**: User can start a conversational session to shape a new epic, in which the agent challenges assumptions and asks clarifying questions before any work is planned — the live acceptance arm can authenticate as the developer on the developer's own claude.ai subscription login, with configuration isolation preserved and the credential referenced rather than copied (plans 05-33/05-34); a backend message the wire flags as an error is classified from that flag rather than from its prose, so a non-conversation first turn can no longer be counted as agent speech; the attempt/answer correlation remains exact by construction from plan 05-30 — a lookup on the correlation id the wire itself supplies, carried through the adapter seam, replacing the positional heuristic six consecutive rounds of narrowing had failed to make correct; a live run that ends for ANY reason — a thrown deadline included — now leaves its evidence sheet carrying the turns it captured and a named cause, so a run that spends a credential can no longer be invisible afterwards, which is what makes the judgement recoverable even from a failed run (plan 05-36); a live turn is now bounded by silence rather than by a wall-clock budget, so an agent doing genuine exploratory work is not failed for being thorough, and the surviving ceiling (`LIVE_TURN_CEILING_MS`) is a runaway bound whose only underlying measurement is a LOWER bound (plan 05-38); a reasoning-only assistant message and a `rate_limit_event` line — two wire shapes the real backend emitted and the adapter did not model — are now modelled, grounded in a real frozen capture, so a live run's stream is no longer partly illegible (plan 05-37); the credential seam from round 8 has still never been exercised against a real `~/.claude` by any committed test, which remains true; the live `tool_use` block's own `id` is still the one half of the correlation change this repository has no capture of; the live dialogue-quality judgement was still UNJUDGED as of round 11 (`05-LIVE-CHALLENGE-TRANSCRIPT.md`); round 10 additionally wrote the stage marker at session start so a challenging agent is refused with an actionable reason rather than an infrastructure error, modelled the `AskUserQuestion` payload at the adapter seam and rendered it into the evidence sheet — closing `G-05-7`'s stated residual — and removed the tool from an authoring session's tool set, proven as argv only; round 11 additionally gave D-88's criteria stage its own instruction naming `propose_criterion` and gave the agent `proposal_list` to read back a staged proposal's id, so the stage machine now delivers an instruction on every transition that has one and the opening prompt names the three stages once — an agent learns the machine from the product rather than from a denial; round 13 closes this requirement: the live UAT harness's stale-snapshot `reject-proposal` defect was fixed (quick task `260929-lq1` — the reject target is re-derived from a fresh `list-pending` snapshot taken after `accept-subtree`'s D-96 cascade), live run `01M3QQQM4GAYB2Y9RQMJDRWAX0` exited 0 with SHAPE-01, SHAPE-02 and SHAPE-03/SHAPE-04 all green, and no UNJUDGED line remains in `05-LIVE-CHALLENGE-TRANSCRIPT.md`. The credential seam is still exercised only against a synthetic fixture by committed tests; the developer accepted the four observed live successes as sufficient (`05-UAT.md` test 3) rather than requiring a new committed test, and the developer signed the SHAPE-01 challenge-quality verdict PASS on 2026-09-30 — the agent contradicted him on substance, catching a logical contradiction in his own answers and rejecting a constraint he had specified
- [x] **SHAPE-02**: The authoring session writes its outcome directly to the board as a structured epic with child tasks, not as a document — round 10 recorded, without re-scoring this requirement, that the live board write has never once succeeded in a live run; the coverage behind this checked state is offline and structural (`authoring_proposal.rs`, `authoring_acceptance.rs`, the replay scenarios), not a live-run observation; round 11 recorded, again without re-scoring, that the accept/reject/amend block was skipped wholesale in the only live run that ever reached it, because the proposals that block operates on could not be produced (`epic: 1, assumption: 12`, zero tasks, zero criteria) — and that this round removed that structural block offline (`proposal_list`, the criteria-stage instruction), with the live path still unobserved
- [x] **SHAPE-03**: The agent drafts acceptance criteria for each generated task, which the user can edit before accepting — the live acceptance arm can authenticate as the developer on the developer's own claude.ai subscription login, with configuration isolation preserved and the credential referenced rather than copied (plans 05-33/05-34); a backend message the wire flags as an error is classified from that flag rather than from its prose, so a non-conversation first turn can no longer be counted as agent speech; the attempt/answer correlation remains exact by construction from plan 05-30 — a lookup on the correlation id the wire itself supplies, carried through the adapter seam, replacing the positional heuristic six consecutive rounds of narrowing had failed to make correct; a live run that ends for ANY reason — a thrown deadline included — now leaves its evidence sheet carrying the turns it captured and a named cause, so a run that spends a credential can no longer be invisible afterwards, which is what makes the judgement recoverable even from a failed run (plan 05-36); a live turn is now bounded by silence rather than by a wall-clock budget, so an agent doing genuine exploratory work is not failed for being thorough, and the surviving ceiling (`LIVE_TURN_CEILING_MS`) is a runaway bound whose only underlying measurement is a LOWER bound (plan 05-38); a reasoning-only assistant message and a `rate_limit_event` line — two wire shapes the real backend emitted and the adapter did not model — are now modelled, grounded in a real frozen capture, so a live run's stream is no longer partly illegible (plan 05-37); the credential seam from round 8 has still never been exercised against a real `~/.claude` by any committed test, which remains true; the live `tool_use` block's own `id` is still the one half of the correlation change this repository has no capture of; the live draft-usefulness judgement was still UNJUDGED as of round 11 (`05-LIVE-CHALLENGE-TRANSCRIPT.md`); round 10 additionally wrote the stage marker at session start so a challenging agent is refused with an actionable reason rather than an infrastructure error, modelled the `AskUserQuestion` payload at the adapter seam and rendered it into the evidence sheet — closing `G-05-7`'s stated residual — and removed the tool from an authoring session's tool set, proven as argv only; round 11 closed the reachability gap: `propose_criterion` was unreachable in a fresh-epic session by construction for the whole life of this phase, and is now reachable through a run-scoped id read (`proposal_list`); D-88's criteria stage asks for criteria by tool name; and a criteria count of zero is now a reading with a named reason (`readCriteriaReachability`) rather than a bare number; round 13 closes this requirement: the live UAT harness's stale-snapshot `reject-proposal` defect was fixed (quick task `260929-lq1` — the reject target is re-derived from a fresh `list-pending` snapshot taken after `accept-subtree`'s D-96 cascade), live run `01M3QQQM4GAYB2Y9RQMJDRWAX0` exited 0 with SHAPE-01, SHAPE-02 and SHAPE-03/SHAPE-04 all green, and no UNJUDGED line remains in `05-LIVE-CHALLENGE-TRANSCRIPT.md`. The credential seam is still exercised only against a synthetic fixture by committed tests; the developer accepted the four observed live successes as sufficient (`05-UAT.md` test 3) rather than requiring a new committed test, and the developer signed the SHAPE-03 draft-usefulness verdict PASS on 2026-09-30 — run `01M3QQQM4GAYB2Y9RQMJDRWAX0` drafted 42 criteria (reachability reading: `drafted`), one of which was amended rather than accepted as written
- [x] **SHAPE-04**: User can accept, reject or amend any individual item the authoring session proposes, rather than accepting the set wholesale — round 10 recorded, without re-scoring this requirement, that the live board write has never once succeeded in a live run; the coverage behind this checked state is offline and structural (`authoring_proposal.rs`, `authoring_acceptance.rs`, the replay scenarios), not a live-run observation; round 11 recorded, again without re-scoring, that the accept/reject/amend block was skipped wholesale in the only live run that ever reached it, because the proposals that block operates on could not be produced (`epic: 1, assumption: 12`, zero tasks, zero criteria) — and that this round removed that structural block offline (`proposal_list`, the criteria-stage instruction), with the live path still unobserved
- [x] **SHAPE-05**: User can reopen and continue shaping an existing epic at any time, and the agent challenges changes against what the epic already contains

### Agent-Authored Backlog

- [x] **PROP-01**: A running agent can propose new tasks, issues and epics through a board tool interface exposed to it
- [x] **PROP-02**: Agent-proposed items enter a distinct proposed state and never appear as accepted work until a human triages them
- [x] **PROP-03**: No code path promotes a proposed item to active work except explicit human triage
- [x] **PROP-04**: Proposals are checked against existing items for duplicates before being surfaced
- [x] **PROP-05**: Proposal volume per agent run is rate-limited, and hitting the limit is surfaced rather than silently dropped
- [x] **PROP-06**: User can triage the proposal queue — accept, reject, merge into an existing item, or defer — in a dedicated view
- [x] **PROP-07**: Every proposal records which agent run produced it and what prompted it

### Planner & Parallel Fan-Out

- [ ] **PLAN-01**: The planner decomposes an epic into tasks each declaring the set of files it expects to modify
- [ ] **PLAN-02**: Before dispatch, the planner checks every pair of candidate parallel tasks for declared file-set overlap
- [ ] **PLAN-03**: When two tasks overlap, only that pair is downgraded to sequential execution — not the entire batch
- [x] **PLAN-04**: A running agent is prevented at the tool level from writing to files outside its task's declared file-set
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

- [x] **REVW-01**: User can review a task's full diff inside the application with syntax highlighting
- [x] **REVW-02**: User can review the accumulated diff of an epic's integration branch
- [x] **REVW-03**: User can check off a task's acceptance criteria against the diff during review
- [x] **REVW-04**: User can merge a task branch into its epic integration branch from within the application, with conflicts surfaced clearly
- [x] **REVW-05**: User can open a pull request or merge request for an epic integration branch in one action

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

### By Phase

| Phase | Name | Requirements | IDs |
|-------|------|--------------|-----|
| Phase 1 | The Board Is The Store Of Record | 15 | DATA-01, DATA-02, DATA-03, DATA-05, DATA-07, DATA-08, BOARD-01, BOARD-02, BOARD-04, BOARD-05, BOARD-06, BOARD-07, BOARD-08, BOARD-09, BOARD-10 |
| Phase 2 | One Agent, One Worktree, Watched Live | 15 | DATA-04, DATA-06, WORK-01, WORK-02, WORK-08, LINK-01, PROC-01, PROC-02, PROC-06, PROC-07, AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-06 |
| Phase 3 | Nothing Lost, Nothing Left Running | 8 | WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05, AGNT-07 |
| Phase 4 | `/clear` Is Free | 9 | BOARD-03, CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, CTX-07, CTX-08 |
| Phase 5 | Socratic Epic Authoring | 5 | SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05 |
| Phase 6 | Agents File Their Own Backlog | 7 | PROP-01, PROP-02, PROP-03, PROP-04, PROP-05, PROP-06, PROP-07 |
| Phase 7 | The Board Tells The Git Truth | 10 | LINK-02, LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, LINK-09, LINK-10, LINK-11 |
| Phase 8 | Review And Merge Inside Flywheel | 5 | REVW-01, REVW-02, REVW-03, REVW-04, REVW-05 |
| Phase 9 | Planned Fan-Out That Does Not Collide | 8 | AGNT-05, PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05, PLAN-06, PLAN-07 |
| Phase 10 | Fleet Supervision Across Every Project | 7 | WORK-07, AGNT-08, FLEET-01, FLEET-02, FLEET-03, FLEET-04, FLEET-05 |
| Phase 11 | Ship It | 4 | DIST-01, DIST-02, DIST-03, DIST-04 |

### By Requirement

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 1 | Complete |
| DATA-02 | Phase 1 | Complete |
| DATA-03 | Phase 1 | Complete |
| DATA-04 | Phase 2 | Complete |
| DATA-05 | Phase 1 | Complete |
| DATA-06 | Phase 2 | Complete |
| DATA-07 | Phase 1 | Complete |
| DATA-08 | Phase 1 | Complete |
| BOARD-01 | Phase 1 | Complete |
| BOARD-02 | Phase 1 | Complete |
| BOARD-03 | Phase 4 | Complete |
| BOARD-04 | Phase 1 | Complete |
| BOARD-05 | Phase 1 | Complete |
| BOARD-06 | Phase 1 | Complete |
| BOARD-07 | Phase 1 | Complete |
| BOARD-08 | Phase 1 | Complete |
| BOARD-09 | Phase 1 | Complete |
| BOARD-10 | Phase 1 | Complete |
| WORK-01 | Phase 2 | Complete |
| WORK-02 | Phase 2 | Complete |
| WORK-03 | Phase 3 | Complete |
| WORK-04 | Phase 3 | Complete |
| WORK-05 | Phase 3 | Complete |
| WORK-06 | Phase 3 | Complete |
| WORK-07 | Phase 10 | Pending |
| WORK-08 | Phase 2 | Complete |
| LINK-01 | Phase 2 | Complete |
| LINK-02 | Phase 7 | Complete |
| LINK-03 | Phase 7 | Complete |
| LINK-04 | Phase 7 | Complete |
| LINK-05 | Phase 7 | Complete |
| LINK-06 | Phase 7 | Complete |
| LINK-07 | Phase 7 | Complete |
| LINK-08 | Phase 7 | Complete |
| LINK-09 | Phase 7 | Complete |
| LINK-10 | Phase 7 | Complete |
| LINK-11 | Phase 7 | Complete |
| PROC-01 | Phase 2 | Complete |
| PROC-02 | Phase 2 | Complete |
| PROC-03 | Phase 3 | Complete |
| PROC-04 | Phase 3 | Complete |
| PROC-05 | Phase 3 | Complete |
| PROC-06 | Phase 2 | Complete |
| PROC-07 | Phase 2 | Complete |
| AGNT-01 | Phase 2 | Complete |
| AGNT-02 | Phase 2 | Complete |
| AGNT-03 | Phase 2 | Complete |
| AGNT-04 | Phase 2 | Complete |
| AGNT-05 | Phase 9 | Pending |
| AGNT-06 | Phase 2 | Complete |
| AGNT-07 | Phase 3 | Complete |
| AGNT-08 | Phase 10 | Pending |
| CTX-01 | Phase 4 | Complete |
| CTX-02 | Phase 4 | Complete |
| CTX-03 | Phase 4 | Complete |
| CTX-04 | Phase 4 | Complete |
| CTX-05 | Phase 4 | Complete |
| CTX-06 | Phase 4 | Complete |
| CTX-07 | Phase 4 | Complete |
| CTX-08 | Phase 4 | Complete |
| SHAPE-01 | Phase 5 | Complete — closed round 13: the harness's stale-snapshot `reject-proposal` defect fixed (`260929-lq1`); live run `01M3QQQM4GAYB2Y9RQMJDRWAX0` exited 0 with all gating SHAPE criteria green; developer verdict signed PASS 2026-09-30; credential seam accepted on four observed live successes (`05-UAT.md` test 3) |
| SHAPE-02 | Phase 5 | Complete |
| SHAPE-03 | Phase 5 | Complete — closed round 13: the harness's stale-snapshot `reject-proposal` defect fixed (`260929-lq1`); live run `01M3QQQM4GAYB2Y9RQMJDRWAX0` exited 0 with all gating SHAPE criteria green; developer verdict signed PASS 2026-09-30; credential seam accepted on four observed live successes (`05-UAT.md` test 3) |
| SHAPE-04 | Phase 5 | Complete |
| SHAPE-05 | Phase 5 | Complete |
| PROP-01 | Phase 6 | Complete |
| PROP-02 | Phase 6 | Complete |
| PROP-03 | Phase 6 | Complete |
| PROP-04 | Phase 6 | Complete |
| PROP-05 | Phase 6 | Complete |
| PROP-06 | Phase 6 | Complete |
| PROP-07 | Phase 6 | Complete |
| PLAN-01 | Phase 9 | Pending |
| PLAN-02 | Phase 9 | Pending |
| PLAN-03 | Phase 9 | Pending |
| PLAN-04 | Phase 9 | Complete |
| PLAN-05 | Phase 9 | Pending |
| PLAN-06 | Phase 9 | Pending |
| PLAN-07 | Phase 9 | Pending |
| FLEET-01 | Phase 10 | Pending |
| FLEET-02 | Phase 10 | Pending |
| FLEET-03 | Phase 10 | Pending |
| FLEET-04 | Phase 10 | Pending |
| FLEET-05 | Phase 10 | Pending |
| REVW-01 | Phase 8 | Complete |
| REVW-02 | Phase 8 | Complete |
| REVW-03 | Phase 8 | Complete |
| REVW-04 | Phase 8 | Complete |
| REVW-05 | Phase 8 | Complete |
| DIST-01 | Phase 11 | Pending |
| DIST-02 | Phase 11 | Pending |
| DIST-03 | Phase 11 | Pending |
| DIST-04 | Phase 11 | Pending |

**Coverage:**

- v1 requirements: 93 total
- Mapped to phases: 93 ✓
- Unmapped: 0
- Duplicated across phases: 0

---
*Requirements defined: 2026-09-08*
*Last updated: 2026-09-08 after roadmap creation (11 phases, 100% coverage)*
