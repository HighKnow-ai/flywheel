# Roadmap: Flywheel (by HighKnow)

## Overview

Flywheel gets built as a sequence of vertical slices, each one something Cyril can open and use
on his own repositories. The journey starts with a board that is genuinely the store of record
(Phase 1), puts one Claude Code agent to work in a durable task worktree (Phase 2), and makes
that loop trustworthy enough to leave unattended (Phase 3). Phase 4 is the falsification test for
the entire product thesis: discard an agent's context mid-task and have the next session
reconstitute from the board alone. With the thesis proven, Phases 5 and 6 build the moat layers
that competitors cannot copy in a weekend — Socratic epic authoring and an agent-authored
backlog behind a human triage gate. Phases 7 and 8 close the daily-work loop by putting git and
forge truth on the board and moving diff review and merge inside the app. Phase 9 turns one agent
into a planned fan-out bounded by real file-set disjointness, Phase 10 generalises supervision
across every project, and Phase 11 ships a signed, self-updating macOS build that a stranger can
also build from source.

**Structure:** Vertical MVP. Every phase delivers an end-to-end capability the user can run and
see, not a technical layer. The research's build order is used as dependency information only —
its horizontal sequencing (schema → supervisor → worktree → adapter → context → …) is
deliberately not followed.

**Reachability of the thinnest slice:** The research identifies the thinnest vertical slice as
*a single task with two sequential agent sessions on one worktree, the second reconstituted
entirely from the board*. That slice completes at the end of **Phase 4** — the earliest the
dependency graph allows, given that the board must exist (Phase 1), an agent must run in a
worktree (Phase 2), and quitting mid-run must not destroy work or leak processes (Phase 3).

**Sequencing rationale for the moat:** Research flags Nimbalyst as able to add acceptance
criteria and an epic layer in weeks. Context reconstitution (Phase 4), Socratic authoring
(Phase 5) and the agent-authored backlog (Phase 6) are therefore sequenced *ahead of* the
commodity git/forge and diff-review surfaces (Phases 7-8), which Nimbalyst and Conductor already
have. The differentiators are validated by the midpoint, not at the end.

**Project-killer placement:** The four ranked project-killers from `research/PITFALLS.md` are
addressed in the phase that first makes them possible:

| Killer | Phase | Requirements |
|--------|-------|--------------|
| Git index-lock contention destroying work | Phase 3 (immediately after the first git write path exists, long before fan-out in Phase 9) | WORK-03, WORK-04, WORK-05, WORK-06 |
| Agents writing outside declared file-sets | Phase 9 (first phase in which a declared file-set exists) | PLAN-04, PLAN-05 |
| Context reconstitution degrading silently | Phase 4 (the phase that creates the risk) | CTX-02, CTX-06, CTX-07 |
| Zombie agent processes after quit | Phase 3 (immediately after the first worker process exists) | PROC-03, PROC-04, PROC-05 |

**Architectural seam placement:** The v1 seams that keep scheduled automations, teams, the relay
and additional backends additive rather than structural land as early as the vertical slices
allow — DATA-01, DATA-03 and DATA-05 in Phase 1; DATA-04 and AGNT-01 in Phase 2, the phase that
first starts agent work.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: The Board Is The Store Of Record** - Run real project structure on a fixed, fast, durable board with checkable acceptance criteria
- [ ] **Phase 2: One Agent, One Worktree, Watched Live** - Start work on a task and watch a Claude Code session do it in a worktree the task owns
- [ ] **Phase 3: Nothing Lost, Nothing Left Running** - Quit, crash or interrupt at any moment without destroying work or leaking agents
- [ ] **Phase 4: `/clear` Is Free** - Discard an agent's whole context and have the next session pick up from the board alone
- [ ] **Phase 5: Socratic Epic Authoring** - Be challenged while shaping an epic and walk away with board items, not a document
- [ ] **Phase 6: Agents File Their Own Backlog** - Agents propose what they learn into a triage lane that nothing escapes without a human
- [ ] **Phase 7: The Board Tells The Git Truth** - Answer "where does this task actually stand in git and on the forge?" without a terminal
- [ ] **Phase 8: Review And Merge Inside Flywheel** - Review an agent's diff against its acceptance criteria and land it in-app
- [ ] **Phase 9: Planned Fan-Out That Does Not Collide** - Turn one epic into several agents at once, bounded by real file-set disjointness
- [ ] **Phase 10: Fleet Supervision Across Every Project** - Answer "what is every agent everywhere doing, and what needs me?" in one glance
- [ ] **Phase 11: Ship It** - Install Flywheel like any Mac app; another developer builds it from source

## Phase Details

### Phase 1: The Board Is The Store Of Record

**Goal**: Cyril runs his real project structure on Flywheel's board — epics, tasks with individually checkable acceptance criteria, and a workflow he cannot bend — and it is still exactly there after a crash.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-05, DATA-07, DATA-08, BOARD-01, BOARD-02, BOARD-04, BOARD-05, BOARD-06, BOARD-07, BOARD-08, BOARD-09, BOARD-10
**Success Criteria** (what must be TRUE):

  1. User registers several of his own local git repositories as projects and switches between their boards.
  2. User creates epics, tasks and issues in the fixed three-level hierarchy, attaches discrete individually checkable acceptance criteria to a task, and moves items through the fixed Backlog → Todo → In Progress → In Review → Done workflow, with no way to reconfigure either.
  3. User searches, filters and reorders a project holding at least 1,000 items, and drives navigation and the common item actions entirely from the keyboard, with no perceptible lag.
  4. User opens any item and sees a chronological trail of what changed, when, and which actor — human or agent — changed it.
  5. User force-quits the application mid-work and relaunches (including across a version upgrade that migrates the database) with no committed change lost or corrupted, and can replay the project's entire change history in order from any cursor position.

**Plans**: 10/11 plans executed in 10 waves
**UI hint**: yes

Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Monorepo, Tauri shell, both test harnesses, and the migrating database entry point

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — The Flight Progress Strips visual foundation: direction contract, token roles, self-hosted type, marks legend, contrast assertion

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Tracer: register a repository, create a task from the quick-add, see it on the rack, survive a relaunch

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 01-04-PLAN.md — The fixed three-level hierarchy and the fixed five-state workflow, enforced by the schema
- [x] 01-05-PLAN.md — Durability: force-quit crash safety and backup-first migration safety

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 01-06-PLAN.md — Acceptance criteria as discrete, individually checkable rows on tasks and epics

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 01-07-PLAN.md — Reorder, prioritise, size and assign, with a total and reproducible board order

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 01-08-PLAN.md — FTS5 search, indexed filters, and no perceptible lag at 1,000+ items

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 01-09-PLAN.md — Full keyboard operability, the ⌘K command palette, and the native menu bar

**Wave 9** *(blocked on Wave 8 completion)*

- [x] 01-10-PLAN.md — Activity trail from the event log, and the cursor-resumable event stream

**Wave 10** *(blocked on Wave 9 completion)*

- [ ] 01-11-PLAN.md — Many local repositories as projects, bound by a committed identity marker

**Notes**: This is where the three structural seams land that would otherwise be retrofit
nightmares: the append-only event log written in the same transaction as the mutable projection
(DATA-01), actor attribution on every mutation with humans and agents as distinct actors of the
same model (DATA-03), and cursor-resumable ordered reads of that log so a future relay can
subscribe without a schema change (DATA-05). Criterion 3 is a design constraint on the first
board build, not a later optimisation — virtualised rendering and indexed queries from the start.
Research flag: verify during planning that a relay could genuinely subscribe and replay, and that
actor identity extends to multi-remote without migration.

### Phase 2: One Agent, One Worktree, Watched Live

**Goal**: Cyril presses Start Work on a board task and watches a Claude Code session do that task inside a git worktree that belongs to the task rather than to the session.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: DATA-04, DATA-06, WORK-01, WORK-02, WORK-08, LINK-01, PROC-01, PROC-02, PROC-06, PROC-07, AGNT-01, AGNT-02, AGNT-03, AGNT-04, AGNT-06
**Success Criteria** (what must be TRUE):

  1. User presses Start Work on a task and a dedicated git worktree appears on a branch whose name derives from the task identifier, chained to that task's epic integration branch — recognisable from a bare terminal without Flywheel.
  2. User watches the agent's output stream live for a long-running session, with the application's memory staying flat rather than growing with the transcript.
  3. The agent pauses on a permission request, the user answers it from the board, and the agent resumes.
  4. User stops a running session and finds the worktree intact and inspectable, then starts a second session on that same worktree — the worktree outlives the session.
  5. User sees the worktree, the agent run and the session as distinct linked records on the task, each started through a trigger record, and can point Flywheel at either his existing local Claude Code credentials or an explicit API key with nothing else in the product behaving differently.

**Plans**: TBD
**UI hint**: yes

**Notes**: Two more structural seams land here: the generic trigger record with `user_action`
implemented and `schedule`/`webhook` accepted-but-unimplemented (DATA-04), and the single agent
adapter interface that no supervisor code branches around (AGNT-01). PROC-02 is architectural,
not a check: the supervisor's cwd is set once at launch and never read, every filesystem and git
call takes an explicit absolute path. Credentials never leave the machine (AGNT-03), and the
API-key path is first-class from day one because research rates the credential-policy boundary
as an existential external dependency.

### Phase 3: Nothing Lost, Nothing Left Running

**Goal**: Cyril can quit, crash or interrupt Flywheel at any moment and know that no uncommitted work was destroyed and no agent is still spending his money.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: WORK-03, WORK-04, WORK-05, WORK-06, PROC-03, PROC-04, PROC-05, AGNT-07
**Success Criteria** (what must be TRUE):

  1. User tries to remove a worktree holding uncommitted changes; Flywheel refuses, shows exactly what would have been lost, and leaves the worktree alone.
  2. User quits the application while a session is running and no agent process survives — confirmed in the OS process table — including when the supervisor is killed rather than closed cleanly.
  3. User relaunches after a crash and is shown every orphaned process, every in-flight run and every worktree that disagrees with the database, and decides what happens to each; nothing is silently resumed and nothing is silently repaired.
  4. A stress run driving ten concurrent commits into one repository keeps every commit — index-lock collisions back off and retry instead of failing a task, and staggered spawn timing stops parallel starts colliding in the first place.
  5. An agent running in auto-accept permission mode still stops and asks before a force-push, a branch deletion or a recursive delete.

**Plans**: TBD
**UI hint**: yes

**Notes**: This phase exists as its own slice because two of the four ranked project-killers live
here and each deserves a dedicated plan with its own tests rather than being buried in Phase 2.
Criterion 4 addresses the reproduced failure in `anthropics/claude-code#55724`, where 8 of 13
parallel agents lost work to `.git/index.lock` collisions and auto-cleanup then deleted the
worktree — it is deliberately solved six phases before real fan-out arrives, not bolted on after
data loss. Research flag: expand the lock-contention evidence base and test against multiple git
versions during planning.

### Phase 4: `/clear` Is Free

**Goal**: Cyril throws away an agent's entire context in the middle of a task and the next session picks up exactly where the last one left off, reconstituted from the board alone.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: CTX-01, CTX-02, CTX-03, CTX-04, CTX-05, CTX-06, CTX-07, CTX-08, BOARD-03
**Success Criteria** (what must be TRUE):

  1. Every session ends by writing a structured summary to the board — what changed, what remains, what the next session must know — and no existing summary is ever overwritten or rewritten in place.
  2. User discards a session's context in a single action and starts a fresh session on the same worktree; the new session is primed automatically from the task, its epic context, its immutable acceptance criteria, prior summaries and the diff so far, with no chat transcript involved, and the same board state always produces the same context packet.
  3. User sees which summaries are being carried verbatim and exactly where compaction begins.
  4. When a new session states an understanding that contradicts a decision already recorded on the board, the user is told rather than left to discover it in the diff.
  5. An automated test runs one task through at least five session cycles and proves its acceptance criteria are unchanged; a user editing criteria after work has started creates a new revision instead of overwriting the original.

**Plans**: TBD
**UI hint**: yes

**Notes**: This phase is the falsification test for the whole product thesis and it completes the
thinnest vertical slice — one task, two sequential sessions on one worktree, the second
reconstituted entirely from the board. Context assembly is a deterministic query, never a model
call (CTX-04), so the packet is reproducible and diffable. The diff is ground truth because prose
degrades and a diff cannot. Research flag: build the synthetic multi-cycle test suite and the
context-quality metrics *before* shipping this phase — do not ship without evidence the thesis
holds.

### Phase 5: Socratic Epic Authoring

**Goal**: Cyril shapes a new epic by being challenged rather than interviewed, and walks away with structured board items instead of a document.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05
**Success Criteria** (what must be TRUE):

  1. User starts a conversational session to shape a new epic and the agent challenges his assumptions and asks clarifying questions before any work is planned.
  2. The session's outcome lands directly on the board as a structured epic with child tasks and drafted acceptance criteria for each task — not as a markdown file or a chat log.
  3. User accepts, rejects or amends each proposed item and each drafted criterion individually, rather than accepting the set wholesale.
  4. User reopens an epic weeks later, continues shaping it, and the agent challenges the change against what the epic already contains.

**Plans**: TBD
**UI hint**: yes

**Notes**: Sequenced ahead of the commodity git/forge and diff surfaces because research ranks
this among the three hardest-to-copy layers and rates the competitive window in weeks. This is
also the first phase where an agent writes structured items to the board through a tool
interface — the write path Phase 6 extends. Research flag: this is a high-assumption feature.
Spike the flow during planning to confirm epic authoring here really is faster and better than
prompting in a terminal, before building the full surface.

### Phase 6: Agents File Their Own Backlog

**Goal**: Agents surface what they learn as proposed board items, and nothing an agent proposes becomes real work without Cyril saying so.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: PROP-01, PROP-02, PROP-03, PROP-04, PROP-05, PROP-06, PROP-07
**Success Criteria** (what must be TRUE):

  1. A running agent proposes a new task, issue or epic mid-session through a board tool, and it lands in a distinct proposed state — never appearing as accepted work, with no code path that promotes it except explicit human triage.
  2. User triages the proposal queue in a dedicated view: accept, reject, merge into an existing item, or defer.
  3. Each proposal shows which agent run produced it and what prompted it.
  4. A proposal that duplicates an existing item is flagged as a duplicate before the user sees it.
  5. A chatty agent hits a per-run proposal limit and the user is told the limit was hit, rather than proposals being silently dropped.

**Plans**: TBD
**UI hint**: yes

**Notes**: The proposed-state gate is structural, not a convention — research is explicit that
backlog spam and auto-promotion are how trust in an agent-authored backlog collapses. Criterion 1
should be verified by proving no promotion path exists, not just that the happy path asks first.

### Phase 7: The Board Tells The Git Truth

**Goal**: Cyril can answer "where does this task actually stand in git and on the forge?" from the board, without opening a terminal.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: LINK-02, LINK-03, LINK-04, LINK-05, LINK-06, LINK-07, LINK-08, LINK-09, LINK-10, LINK-11
**Success Criteria** (what must be TRUE):

  1. Every board item shows its branch, its commits, how far ahead or behind its integration target it is, and any uncommitted changes sitting in its worktree.
  2. User pastes a commit hash or a branch name and lands on the board item that produced it; conversely `git log` alone reveals the task identifier for any agent-produced commit, via a commit-message trailer.
  3. Opening a pull request moves the task to In Review and merging it moves the task to Done, with the request's state and its CI result visible on the item.
  4. User commits by hand from his own terminal on a task's branch and Flywheel detects it and reflects it on the board item, never silently overwriting it.
  5. Flywheel works against a GitHub project and a GitLab project and degrades cleanly to local-only git when no forge is configured; from any task the user opens its worktree in his own editor or terminal in one action.

**Plans**: TBD
**UI hint**: yes

**Notes**: LINK-10 matters more than it looks: the moment the board and the working tree disagree
about a branch, the user stops trusting the board and goes back to the terminal — which is
exactly the v1 failure condition. Depends on Phase 4 rather than Phase 6, so it can be planned in
parallel with the Phase 5-6 moat work if capacity allows.

### Phase 8: Review And Merge Inside Flywheel

**Goal**: Cyril reviews an agent's work against the acceptance criteria that were agreed before it started, and lands it, without dropping back to a terminal.
**Mode:** mvp
**Depends on**: Phase 7
**Requirements**: REVW-01, REVW-02, REVW-03, REVW-04, REVW-05
**Success Criteria** (what must be TRUE):

  1. User reads a task's full diff with syntax highlighting inside the application, and reads the accumulated diff of its epic's integration branch.
  2. User checks off each of the task's acceptance criteria against the diff while reviewing it.
  3. User merges a task branch into its epic integration branch from within the application, and any conflict is surfaced clearly rather than failing silently or half-merging.
  4. User opens a pull request or merge request for a finished epic's integration branch in one action.

**Plans**: TBD
**UI hint**: yes

**Notes**: Criterion 2 is where the core value becomes a daily habit rather than a slogan — the
review surface is the moment structured acceptance criteria pay for themselves against a chat
blob. With this phase complete the full loop is closable in-app: shape → plan → run → reconstitute
→ review → merge.

### Phase 9: Planned Fan-Out That Does Not Collide

**Goal**: Cyril turns one epic into several agents working at once, with parallelism bounded by real file-set disjointness rather than optimism.
**Mode:** mvp
**Depends on**: Phase 3, Phase 6
**Requirements**: PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05, PLAN-06, PLAN-07, AGNT-05
**Success Criteria** (what must be TRUE):

  1. User asks the planner to decompose an epic and gets tasks that each declare the set of files they expect to modify, grouped into waves for dispatch.
  2. When two candidate tasks declare overlapping files, only that pair drops to sequential execution while the rest of the wave still runs in parallel — and the user can ask why any two tasks were sequenced and get an answer.
  3. An agent that tries to write a file outside its task's declared file-set is stopped at the tool level, and the attempt appears to the user as a scope event rather than a silent block.
  4. User caps global parallel width and the planner never exceeds it.
  5. When the backend returns a rate limit or session limit, Flywheel backs off and tells the user, instead of retrying blindly.

**Plans**: TBD
**UI hint**: yes

**Notes**: Criteria 2 and 3 are companion enforcement mechanisms, not alternatives — the pairwise
overlap check only sees *declared* files, while the tool-level pre-write hook catches undeclared
writes. Research measures ~35% of scoped tasks touching files outside their declared set without
tool-level enforcement, falling to ~4% with it. Criterion 5 exists partly for compliance optics:
visible backoff is what keeps Flywheel from looking like abuse to the backend.

### Phase 10: Fleet Supervision Across Every Project

**Goal**: Cyril answers "what is every agent, everywhere, doing — and what needs me?" in one glance, across every registered project.
**Mode:** mvp
**Depends on**: Phase 9
**Requirements**: FLEET-01, FLEET-02, FLEET-03, FLEET-04, FLEET-05, WORK-07, AGNT-08
**Success Criteria** (what must be TRUE):

  1. One view lists every agent running across every registered project and what each one is doing, distinguishing running, blocked, finished-awaiting-review and failed at a glance.
  2. A dedicated queue shows every agent currently blocked and waiting on a human, across all projects at once.
  3. User jumps from any fleet entry straight to that agent's live output and to its board item.
  4. User receives an operating-system notification when an agent becomes blocked or completes, without watching the window.
  5. User sees every worktree across all projects with its disk usage and reclaims stale ones, and sees token usage and cost for each session.

**Plans**: TBD
**UI hint**: yes

**Notes**: Generalises the single-project views proven in earlier phases; research is explicit
that multi-project aggregation only makes sense once single-project supervision is solid.
Criterion 2 is the one that decides whether fleet supervision beats tab-cycling through terminals.

### Phase 11: Ship It

**Goal**: Cyril installs Flywheel like any other Mac application and it keeps itself current, and another developer can clone the repository and build it.
**Mode:** mvp
**Depends on**: Phase 10
**Requirements**: DIST-01, DIST-02, DIST-03, DIST-04
**Success Criteria** (what must be TRUE):

  1. User installs a signed, notarized macOS build and opens it with no Gatekeeper warning.
  2. User is offered a new release from inside the application and updates without a manual reinstall.
  3. A developer clones the repository and builds a working desktop application by following the documented steps.
  4. The installed open-source application is fully functional standalone — no account, no network service, and no feature gated behind either.

**Plans**: TBD
**UI hint**: no

**Notes**: Criterion 4 is the open-core boundary made verifiable: the clean module seam between
the OSS desktop ADE and the future commercial relay must hold with the relay entirely absent.
Signing and notarization are documented and proven on Tauri — execution only, no research needed,
though the Apple Developer account ($99/yr) is a real prerequisite to budget before this phase.

## Requirement Coverage

All 93 v1 requirements map to exactly one phase. No orphans, no duplicates.

| Category | Count | Phases |
|----------|-------|--------|
| DATA (Data Model & Persistence) | 8 | 1 (DATA-01, 02, 03, 05, 07, 08), 2 (DATA-04, 06) |
| BOARD (Board) | 10 | 1 (BOARD-01, 02, 04, 05, 06, 07, 08, 09, 10), 4 (BOARD-03) |
| WORK (Worktree & Branch) | 8 | 2 (WORK-01, 02, 08), 3 (WORK-03, 04, 05, 06), 10 (WORK-07) |
| LINK (Git & Forge Linkage) | 11 | 2 (LINK-01), 7 (LINK-02 … LINK-11) |
| PROC (Process Supervision) | 7 | 2 (PROC-01, 02, 06, 07), 3 (PROC-03, 04, 05) |
| AGNT (Agent Integration) | 8 | 2 (AGNT-01, 02, 03, 04, 06), 3 (AGNT-07), 9 (AGNT-05), 10 (AGNT-08) |
| CTX (Context Reconstitution) | 8 | 4 (all) |
| SHAPE (Socratic Epic Authoring) | 5 | 5 (all) |
| PROP (Agent-Authored Backlog) | 7 | 6 (all) |
| PLAN (Planner & Parallel Fan-Out) | 7 | 9 (all) |
| FLEET (Fleet Supervision) | 5 | 10 (all) |
| REVW (Review & Merge) | 5 | 8 (all) |
| DIST (Distribution) | 4 | 11 (all) |
| **Total** | **93** | **11 phases** |

**Deliberate cross-category placements** (a requirement placed outside its category's home phase,
with reason):

| Requirement | Phase | Why |
|-------------|-------|-----|
| DATA-04 (trigger record) | 2 | The trigger abstraction first becomes real in the phase that first starts agent work |
| DATA-06 (worktrees/runs/sessions as first-class records) | 2 | Those entities first exist here; defining their tables in Phase 1 would be a horizontal layer for things that do not yet exist |
| BOARD-03 (acceptance criteria immutable once work starts) | 4 | Criteria immutability is a context-integrity mechanism; it is verified by the same multi-cycle drift test as CTX-07 |
| LINK-01 (branch name derives from task id) | 2 | The branch is named at worktree creation, in the phase that creates worktrees |
| WORK-07 (all worktrees, disk usage, reclaim stale) | 10 | It is a cross-project view; it only exists once multi-project supervision does |
| AGNT-05 (rate/session limit backoff) | 9 | Limits bite at fan-out width, and pair naturally with the user-set global width cap |
| AGNT-07 (destructive-action confirmation) | 3 | It belongs with the other "never destroy work" guarantees, not with the permission plumbing |
| AGNT-08 (token usage and cost per session) | 10 | Cost is consumed in the fleet view alongside the other per-session at-a-glance signals |

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. The Board Is The Store Of Record | 10/11 | In Progress|  |
| 2. One Agent, One Worktree, Watched Live | 0/TBD | Not started | - |
| 3. Nothing Lost, Nothing Left Running | 0/TBD | Not started | - |
| 4. `/clear` Is Free | 0/TBD | Not started | - |
| 5. Socratic Epic Authoring | 0/TBD | Not started | - |
| 6. Agents File Their Own Backlog | 0/TBD | Not started | - |
| 7. The Board Tells The Git Truth | 0/TBD | Not started | - |
| 8. Review And Merge Inside Flywheel | 0/TBD | Not started | - |
| 9. Planned Fan-Out That Does Not Collide | 0/TBD | Not started | - |
| 10. Fleet Supervision Across Every Project | 0/TBD | Not started | - |
| 11. Ship It | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-08*
*Granularity: fine · Structure: vertical MVP · 11 phases · 93/93 v1 requirements mapped*
