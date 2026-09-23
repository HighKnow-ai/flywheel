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

- [x] **Phase 1: The Board Is The Store Of Record** - Run real project structure on a fixed, fast, durable board with checkable acceptance criteria (completed 2026-09-10)
- [x] **Phase 2: One Agent, One Worktree, Watched Live** - Start work on a task and watch a Claude Code session do it in a worktree the task owns (completed 2026-09-12)
- [x] **Phase 3: Nothing Lost, Nothing Left Running** - Quit, crash or interrupt at any moment without destroying work or leaking agents (completed 2026-09-22)
- [ ] **Phase 4: `/clear` Is Free** - Discard an agent's whole context and have the next session pick up from the board alone
- [ ] **Phase 5: Socratic Epic Authoring** - Be challenged while shaping an epic and walk away with board items, not a document
- [ ] **Phase 6: Agents File Their Own Backlog** - Agents propose what they learn into a triage lane that nothing escapes without a human
- [ ] **Phase 7: The Board Tells The Git Truth** - Answer "where does this task actually stand in git and on the forge?" without a terminal
- [ ] **Phase 8: Review And Merge Inside Flywheel** - Review an agent's diff against its acceptance criteria and land it in-app
- [ ] **Phase 9: Planned Fan-Out That Does Not Collide** - Turn one epic into several agents at once, bounded by real file-set disjointness
- [ ] **Phase 10: Fleet Supervision Across Every Project** - Answer "what is every agent everywhere doing, and what needs me?" in one glance
- [ ] **Phase 10.1: Visual polish: brand assets and confirmed motion** (INSERTED) - A bolder, more modern direction; Flywheel wears its own mark and moves the way its contract says it moves
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

**Plans**: 21/21 plans executed — 20/20 executed (11/11 in 10 waves, plus 5 gap-closure plans 01-12 through 01-16 in 4 waves opened by conversational UAT, plus 01-17 and 01-18 for G-01-2, plus 01-19 and 01-20 for G-01-4), plus 1 planned gap-closure plan (01-21) for CR-01
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

- [x] 01-11-PLAN.md — Many local repositories as projects, bound by a committed identity marker

**Gap closure — Wave 1** *(from 01-UAT.md; both plans are independent and share no file)*

- [x] 01-12-PLAN.md — G-01-EPIC-ASSIGN: task_set_epic and issue_set_parent, the reparenting commands the registry never had
- [x] 01-13-PLAN.md — G-01-FOCUS: give useGlobalBindings the layer awareness the Escape ladder already has

**Gap closure — Wave 2** *(blocked on 01-12 and 01-13)*

- [x] 01-14-PLAN.md — G-01-EPIC-ASSIGN: the epic picker, the `m` binding, and a task's epic surviving creation

**Gap closure — Wave 3** *(blocked on 01-14)*

- [x] 01-15-PLAN.md — G-01-EPIC-ASSIGN: issues under an epic or a task, quick-add nesting, and BOARD-01 made true again

**Gap closure — Wave 4** *(from the second 01-UAT.md round; independent of 01-12 through 01-15)*

- [x] 01-16-PLAN.md — G-01-1: make the native macOS menu obey the layer guard instead of bypassing it

**Gap closure — Wave 5** *(G-01-2, the only gap left open by 01-VERIFICATION.md; independent of 01-12 through 01-16)*

- [x] 01-17-PLAN.md — G-01-2: give the epic roster its own unwindowed read path, end to end, and make the epic pill incapable of printing an internal id

**Gap closure — Wave 6** *(blocked on 01-17 — shares BoardView.tsx, useBoardQuery.ts and both new test files)*

- [x] 01-18-PLAN.md — G-01-2: move the filter chips and both parent pickers onto that roster, and pin its ordering, tie-break and idempotency contract

**Gap closure — Wave 7** *(G-01-4, the only gap left `status: failed` in 01-UAT.md; independent of 01-12 through 01-18)*

- [x] 01-19-PLAN.md — G-01-4: make quick-add's focus survive virtualization and a collapsed Backlog band, so ⌘N lands the cursor in its input from any scroll position

**Gap closure — Wave 8** *(blocked on 01-19 — shares quick-add-focus.test.tsx)*

- [x] 01-20-PLAN.md — G-01-4: a shared self-checking volume fixture, the forwarded-accelerator path proven at volume, and the focus contract recorded in 01-UI-SPEC.md

**Gap closure — Wave 9** *(CR-01, the only blocker left by 01-VERIFICATION.md — a regression introduced by 01-19's own expand-Backlog effect; shares BoardView.tsx and quick-add-focus.test.tsx with 01-19/01-20)*

- [x] 01-21-PLAN.md — CR-01: scope the forced Backlog expansion to the rising edge of quick-add becoming reachable, so a band the user collapses stays collapsed

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

**Plans**: 18/18 plans executed (10/10 executed in 8 waves; 4 gap-closure plans executed in 3 waves after verification found gaps; 4 more gap-closure plans added in 3 waves after human UAT found G-02-1..G-02-4)
**UI hint**: yes

Plans:
**Wave 1**

- [x] 02-01-PLAN.md — Tracer: Start Work spawns a real agent in a task-owned worktree and one event reaches the screen; plus the fixed branch topology and the PROC-02 structural gate

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Stop means interrupt, then force: the whole process group, and a worktree left exactly as the agent left it
- [x] 02-03-PLAN.md — The agent design vocabulary: four contrast-proven colour roles, six legend marks, eight keyboard actions

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-04-PLAN.md — The launch sheet and the deterministic context packet: see the briefing before tokens are spent

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 02-05-PLAN.md — The permission gate: an MCP tool call that does not resolve until a human answers, and project-scoped allow-always rules

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 02-06-PLAN.md — Answering from the board: one card in two mount points, the blocked row pill, the project-rail count

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 02-07-PLAN.md — The live feed for real: a bounded windowed read, structured rows, the raw escape hatch, the cost strip

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 02-08-PLAN.md — The records on the task: the worktree summary and the runs list, with one way into the session surface
- [x] 02-09-PLAN.md — The credential boundary: Keychain-backed API key, per-project override, resolved once per spawn, proven parity

**Wave 8** *(blocked on Wave 7 completion)*

- [x] 02-10-PLAN.md — The first Settings surface: credential path, per-project overrides, and revocable permission rules

**Gap closure** *(02-VERIFICATION.md status `gaps_found` — 4 failed truths, all four Criticals from 02-REVIEW.md)*

**Wave 1**

- [x] 02-11-PLAN.md — Gap CR-04/PROC-06: a Stop always reaches a terminal status, even when the sidecar never acks
- [x] 02-13-PLAN.md — Gap CR-01/DATA-06: decide and test what deleting a task with agent-run history does (blocking decision checkpoint)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-12-PLAN.md — Gap CR-03/PROC-07: one run's log-write failure can never silence the shared reader, and the skip is never silent

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-14-PLAN.md — Gap CR-02: quitting Flywheel kills every live session's process group, and WR-01's interrupt race

**UAT gap closure** *(`02-UAT.md` — four defects found by human testing on 2026-09-11, two of them blocking every remaining test)*

**Wave 1**

- [x] 02-15-PLAN.md — Gap G-02-1: the sidecar stub resolves its entrypoint from where Tauri actually runs it, and a dead sidecar aborts startup at its cause
- [x] 02-16-PLAN.md — Gap G-02-3: a feed row paints inside the slot the virtualizer reserved for it, and a long payload reads as one line that opens in place

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-17-PLAN.md — Gap G-02-2: the argv the real CLI accepts, and a failed spawn that says why

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 02-18-PLAN.md — Gap G-02-4: a run that ends on its own is recorded on the board as ended, with its cost and token counts

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

**Plans**: 38/38 plans executed, 36 executed — 19/19 executed in 8 waves, plus 4 gap-closure plans (03-20 .. 03-23) added in waves 9-11 after re-verification returned `gaps_found` on Success Criterion 5's sustained-block half, plus 5 gap-closure plans (03-24 .. 03-28) in waves 12-14 closing the launcher-shape bypass class per D-59 .. D-63, plus 3 planned gap-closure plans (03-29 .. 03-31) in waves 15-17 closing round five of that class — the reproduced quote/backslash obfuscation of the D-61 raw-text scan (CR-01), plus WR-01 and WR-02, plus 3 gap-closure plans (03-32 .. 03-34) in waves 18-20 closing round seven — the `env -S` opaque re-parse (positional, and backslash-split), bash brace expansion as an unmodelled word-formation mechanism, and review warnings WR-01/WR-02/WR-03, plus 2 planned gap-closure plans (03-35 .. 03-36) in waves 21-22 closing round eight — `env`/`command` wrapper-token recognition promoted from exact-token-equality to character-level word-boundary containment (C6), the brace-expansion split kind the adversarial sweep was missing, and the friction accounting WR-01 found understated, plus 2 planned gap-closure plans (03-37 .. 03-38) in waves 23-24 closing round nine — the first round with no live bypass, leaving only WR-A's falsified C6 friction claim: the document is corrected to the class C6 actually charges (branch (b), accept the over-trigger rather than narrow the predicate), the plain-prose class is priced in the corpus, and two new gates — `PROSE_FRICTION_SHAPES` and `FRICTION_CLASSES` — close the structural blind spot that let an unpriced friction class land
**UI hint**: yes

Plans:

- [x] 03-19-PLAN.md

**Wave 1**

- [x] 03-01-PLAN.md — Tracer: "Remove Worktree" end to end, and the refusal that guards it (WORK-03)
- [x] 03-02-PLAN.md — The watchdog: heartbeat file, per-session wrapper, kill record (PROC-03, PROC-04)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-03-PLAN.md — Migration 0006 and launch-time worktree reconciliation (WORK-06)
- [x] 03-04-PLAN.md — One backoff policy, the PATH shim, and the spawn floor (WORK-04, WORK-05)
- [x] 03-05-PLAN.md — Deleting a task once its worktree is gone (WORK-03; blocking decision checkpoint)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-06-PLAN.md — Orphan detection at launch: classify, kill, abandon (PROC-05; package-legitimacy checkpoint)
- [x] 03-07-PLAN.md — The destructive-action gate's enforcement: classifier, shim block, PreToolUse hook (AGNT-07)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 03-08-PLAN.md — The stress run: ten concurrent commits keep every commit (WORK-04, WORK-05)
- [x] 03-09-PLAN.md — The missing-worktree decision banner (WORK-06)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 03-10-PLAN.md — The orphan recovery modal and the abandoned-run acknowledgment (PROC-04, PROC-05)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 03-11-PLAN.md — "Needs Decision": the row pill and the project-rail count (WORK-06, PROC-05)

**Wave 7** *(blocked on Wave 6 completion)*

- [x] 03-12-PLAN.md — The destructive-action gate card (AGNT-07)
- [x] 03-13-PLAN.md — The git-lock contention signals: transient feed row and exhaustion trail entry (WORK-04)

**Wave 8 — gap closure** *(from `03-VERIFICATION.md`: Success Criterion 5 failed; two Critical review findings confirmed at HEAD. All five run in parallel — no shared files.)*

- [x] 03-14-PLAN.md — The destructive-push gate: remote branch deletion reaches the classifier, the shim and the socket (AGNT-07, WORK-04, WORK-05)
- [x] 03-15-PLAN.md — One run-id predicate at the one join site, and a stderr tail that cuts on a character boundary (PROC-03, PROC-04)
- [x] 03-16-PLAN.md — The destructive-gate card: one click one answer, and a deletion sentence that names the branch (AGNT-07)
- [x] 03-17-PLAN.md — Kill once, stop once: synchronous guards on the process-termination controls (PROC-04, PROC-05)
- [x] 03-18-PLAN.md — Remove once, and a missing worktree is missing even with an empty path (WORK-03, WORK-06)

**Wave 9 — gap closure** *(from the 2026-09-20 re-verification: Success Criterion 5 is PARTIAL. The request-raising half is verified closed by 03-19 + quick-260920-duy and is NOT reopened. The sustained-block half — "the session stays blocked until a human answers" — is unproven: five live runs saw the session self-terminate ~15-16s into an unanswered request, root cause unconfirmed.)*

- [x] 03-20-PLAN.md — Who ends the session? Close-provenance instrumentation, validated against three known killers, then a clean-room live measurement in both a supervised and an unsupervised condition (AGNT-07, PROC-04)

**Wave 10** *(blocked on Wave 9 — branches on 03-20's recorded disposition)*

- [x] 03-21-PLAN.md — The sustained block survives a sixty-second answer: the acceptance test that closes the gap on either outcome, plus the PROC-04 guard that a pending question buys no extra life (AGNT-07, PROC-04)

**Wave 11** *(blocked on Wave 10 — no file overlap between the two, they run in parallel)*

- [x] 03-22-PLAN.md — Reconcile AGNT-07's recorded status across REQUIREMENTS.md, 03-19-SUMMARY.md and STATE.md, and align the seven sibling statuses with the verification report (all 8 phase IDs)
- [x] 03-23-PLAN.md — The two open review warnings: an owner-only permission socket (WR-01), an absolute-path guard on FLYWHEEL_APP_DATA_DIR (WR-02), and the lifecycle timeline joining the runtime-file cleanup list (AGNT-07, PROC-05)

**Wave 12 — gap closure** *(from the open destructive-gate bypass class in `03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`: `destructive::classify` returns `Safe` for any program that is not literally `git`/`rm`, so eight ordinary launcher idioms defeat the text classifier. Closure approach decided as D-59 .. D-63. Both plans run in parallel — no shared files.)*

- [x] 03-24-PLAN.md — The hook's `safe` branch proves what its non-safe branch already proves (D-59, D-61) (AGNT-07)
- [x] 03-25-PLAN.md — A broken shim install fails loudly at spawn, never as a silently-denies-everything session (D-60's supervisor half) (AGNT-07)

**Wave 13** *(blocked on Wave 12 — both depend on 03-24, and run in parallel with each other)*

- [x] 03-26-PLAN.md — The adversarial corpus, asserted through the real hook against the real shim binary (D-62 item 1) (AGNT-07)
- [x] 03-27-PLAN.md — One live `claude` run measuring the launcher-wrapped class, against a throwaway local bare remote only (D-62 item 2, D-63) (AGNT-07)

**Wave 14** *(blocked on Wave 13 — needs both the corpus and the live run)*

- [x] 03-28-PLAN.md — The recorded trust boundary: what each layer proves and what it explicitly cannot see (D-62 item 3) (AGNT-07)

**Wave 15 — gap closure** *(round five of the destructive-gate bypass class, from `03-VERIFICATION.md` and `03-REVIEW.md` CR-01: D-61's raw-text scan matches keywords as literal contiguous substrings, so ordinary shell quote/backslash splitting — `e""val`, `e\val`, `g""it` — defeats both conjuncts of the hook's deny rule independently, and the hidden `eval` resolves before any PATH search so layer 2 never sees it either. Reproduced independently three times against the compiled binary using only `--classify-invocation`. Per the trust-boundary document's own rule for round five, the boundary is amended BEFORE any code or corpus change — that ordering is the wave structure below.)*

- [x] 03-29-PLAN.md — Layer 1 cannot prove absence: amend the boundary, name the C1-C4 contract, gate it (AGNT-07)

**Wave 16** *(blocked on Wave 15 — implements the contract the boundary now specifies)*

- [x] 03-30-PLAN.md — The scanner stops claiming absence it cannot prove: quote removal, union matching, indeterminacy refusal, and the hook's tri-state read (WR-01) (AGNT-07)

**Wave 17** *(blocked on Wave 16 — adversarial rows may only follow the corrected and implemented boundary)*

- [x] 03-31-PLAN.md — The corpus manufactures its own adversaries: decision invariance under obfuscation (WR-02), the recorded friction table, and a live measurement whose failures mean what they say (all 8 phase IDs)

**Wave 18 — gap closure** *(round seven, from `03-VERIFICATION.md`'s one failed truth — Success Criterion 5 / AGNT-07. Round six's `env -S` opaque re-parse is a proven, live, zero-human-confirmation bypass: `resolve_segment_program_index` recognises the wrapper token `env` only over `tokenize_shell_words`'s raw output, so a backslash-split `e\nv` escapes it entirely. Measured again during planning: the recognition is also POSITIONAL, so `sh -c 'env -S "-P /tmp git push --force"'` defers with no obfuscation at all. Per the trust-boundary document's own rule for round six, the boundary is amended BEFORE any code or corpus change — that ordering is the wave structure below.)*

- [x] 03-32-PLAN.md — Round seven: the boundary names the positional defect, C5 sees an opaque `env` re-parse anywhere, and the corpus carries no exception (AGNT-07, WR-02)

**Wave 19** *(blocked on Wave 18 — shares `main.rs`, the boundary document and the shim test file)*

- [x] 03-33-PLAN.md — Brace expansion, named in the boundary first: C3 gains its fourth mechanism and two doc comments stop overclaiming (AGNT-07, WR-03)

**Wave 20** *(blocked on Wave 19 — the document-before-corpus-row ordering, enforced as a real `depends_on` rather than a comment)*

- [x] 03-34-PLAN.md — The brace corpus rows and their priced friction, WR-01's null and numeric payloads, and the requirements bookkeeping record (AGNT-07, WR-01)

**Wave 21 — gap closure** *(round eight, from `03-VERIFICATION.md`'s one still-failed truth — Success Criterion 5 / AGNT-07. `env`/`command` wrapper-token recognition is exact-token-equality at all three sites that feed a security decision, so brace expansion (`{env,}`, `{command,}`) walks past it and the hook returns "no opinion" — zero confirmation in auto-accept — for a payload whose unobfuscated twin denies. Measured again during planning: the same root cause also defers for a PATH-QUALIFIED wrapper (`/usr/bin/env -S …`) with no obfuscation at all, and for an obfuscated flag or `--unset` NAME argument. Per the trust-boundary document's own rule for round six, the boundary is amended BEFORE any corpus row — that ordering is the wave structure below.)*

- [x] 03-35-PLAN.md — Round eight: the boundary names wrapper-token word formation, C6 promotes recognition from token equality to word-boundary containment, and the friction is priced (AGNT-07, WR-01)

**Wave 22** *(blocked on Wave 21 — the document-before-corpus-row ordering, enforced as a real `depends_on` rather than a comment)*

- [x] 03-36-PLAN.md — The sweep that would have caught it: a brace-expansion split kind, the round-eight corpus rows, and round eight's coverage map (all 8 phase IDs, WR-02)

**Wave 23 — gap closure** *(round nine, from `03-VERIFICATION.md`'s one still-failed truth. This is the FIRST round of the phase in which no live bypass is found by either verification or code review: round eight's CR-01 is closed. What remains is `03-REVIEW.md`'s WR-A — a factual inaccuracy in a required security artifact. `docs/destructive-gate-trust-boundary.md` claims C6 charges only an obfuscated brace/glob-plus-dash token at a wrapper's flag position; measured against the compiled binary, an entirely ordinary non-obfuscated quoted commit message mentioning `command -p` or `env -i` denies too, because C1's context-free quote removal re-tokenizes a quoted argument and makes prose words adjacent. Over-triggering, not a bypass — Success Criterion 5 holds — but it violates this round's own prohibition against adding friction without pricing it. **Branch (b) chosen: accept the over-trigger and correct the claim, not narrow the predicate** — branch (a) is unsound because the nested `sh -c '…'` shapes rounds seven and eight closed reach C6 through the same quote-internal adjacency. Per the document's own rule for round six, the boundary is amended BEFORE any corpus row — that ordering is the wave structure below.)*

- [x] 03-37-PLAN.md — Round nine: the document states the class C6 actually charges, the `env`/`command` asymmetry is asserted, and the declined narrowing becomes a named residual (AGNT-07, WR-A)

**Wave 24** *(blocked on Wave 23 — the document-before-corpus-row ordering, enforced as a real `depends_on` rather than a comment)*

- [x] 03-38-PLAN.md — The corpus prices the plain-prose class, `PROSE_FRICTION_SHAPES` sweeps what `obfuscationVariants` structurally could not, and `FRICTION_CLASSES` binds every documented class to a row (all 8 phase IDs, WR-A)

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

**Plans**: 9/14 plans executed
**UI hint**: yes

**Wave 1 — the tracer** *(the thinnest end-to-end slice, proven before anything expands out from it)*

- [x] 04-01-PLAN.md — Tracer: a session summary reaches the board and the next briefing carries it, verbatim and append-only (CTX-01, CTX-02, CTX-03, CTX-04)

**Wave 2** *(four independent expansions off the tracer — no file overlap between them)*

- [x] 04-02-PLAN.md — No session ends without a summary: D-64's `auto_generated` fallback, inside the terminal event's own transaction (CTX-01)
- [x] 04-03-PLAN.md — The agent authors its own summary: `report_summary` as a second tool on the existing per-run MCP socket (CTX-01, CTX-06)
- [x] 04-04-PLAN.md — Criteria lock and revisions: the lock is the first agent run, an edit appends, and no agent ever reads superseded wording (BOARD-03)
- [x] 04-05-PLAN.md — Compaction: a pure fold, five verbatim, lossless for decisions and total for narrative (CTX-05)

**Wave 3** *(blocked on 04-02 and 04-03 — the write surface meets the board)*

- [x] 04-06-PLAN.md — The tool call becomes a board row, and every prompt asks for one by exact tool name (CTX-01, CTX-02, CTX-06)

**Wave 4** *(blocked on 04-06 — shares `context_packet.rs`)*

- [x] 04-07-PLAN.md — The diff so far is ground truth: committed and uncommitted, stat and paths, never hunks (CTX-03)

**Wave 5** *(blocked on 04-05 and 04-07)*

- [x] 04-08-PLAN.md — The prompt folds, and says where the fold begins; the boundary reaches the desktop as structure (CTX-05, CTX-03)

**Wave 6** *(blocked on 04-08)*

- [x] 04-09-PLAN.md — The launch sheet shows the whole briefing: prior sessions, the compaction boundary, the diff (CTX-03, CTX-05, CTX-01)

**Wave 7** *(blocked on 04-04 and 04-09)*

- [ ] 04-10-PLAN.md — The revised marker, the one edit path, and the run's record of what it was told (BOARD-03, CTX-06)

**Wave 8** *(blocked on 04-07 and 04-10 — the third detector needs the revision pin)*

- [ ] 04-11-PLAN.md — Four fact-based drift detectors, no model anywhere, re-derived on every assembly (CTX-06)

**Wave 9** *(blocked on 04-11)*

- [ ] 04-12-PLAN.md — Drift surfaced: an activity-trail event, the existing needs-you signal, and a warning that blocks nothing (CTX-06)

**Wave 10** *(blocked on 04-12 — the flagship action, last because it shows everything before it)*

- [ ] 04-13-PLAN.md — Discard in one action: a bounded wait for the agent's summary, then the pre-filled launch sheet (CTX-08)

**Wave 11** *(blocked on 04-13 — the phase's ship gate)*

- [ ] 04-14-PLAN.md — Ten cycles, criteria byte-identical, plus the context-quality metrics the roadmap flagged (CTX-07, CTX-04, CTX-02)

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

### Phase 10.1: Visual polish: brand assets and confirmed motion (INSERTED)

**Goal**: Flywheel looks like a product built in 2026 — a bolder, more modern visual direction the
owner actually wants to look at all day — wearing its own mark and moving the way its design
contract says it moves.
**Requirements**: TBD
**Depends on:** Phase 10
**Plans:** 0 plans

Plans:

- [ ] TBD (run /gsd-plan-phase 10.1 to break down)

**Success Criteria** (what must be TRUE):

  0. The owner looks at the board with real data on it and judges it bold and modern — not, in
     his words on 2026-09-10, "a very old app." This is the criterion the phase exists for; the
     rest are the mechanics under it.
  1. The installed application's icon is HighKnow's/Flywheel's own mark, not the
     `create-tauri-app` scaffold default, on every artifact `tauri.conf.json` lists.
  2. The brand asset exists in the repository and any surface entitled to render it does so.
  3. Opening the item detail panel slides it in from the trailing edge; collapsing or expanding a
     status group animates its height; opening the command palette fades/scales it in — each
     collapsing to an instant state change under `prefers-reduced-motion`.
  4. The motion durations in `styles/motion.css` are the ones a direction round actually
     confirmed, not an unreviewed assertion.

**Notes**: Inserted after phase 01's second UAT round surfaced the gap between what
`01-UI-SPEC.md` specifies and what shipped. The colors were NOT part of that gap — the pinned
brand `#3c64dd` and its two contrast-lifted variants are correctly wired in `styles/tokens.css`
and deliberately restrained per the spec's "brand lives in precise details" rule. What was missing
is the mark and the motion.

**The direction itself is in scope, and this is the hard part.** On 2026-09-10, shown the board
rendering ~1,000 real items, the owner said it "feels like a very old app" and asked for something
"a bit more bold / modern." That is not a defect report — the surface he was looking at is the
*faithful* output of the locked contract. `01-UI-SPEC.md` selected **"Flight Progress Strips"**
(Impeccable direction round, seed `59b0beb9`): cream `#ddd6c6` strip stock on a dark navy rack,
`--radius-strip: 2px`, no elevation, hard dividers, brand rationed to small accents. Every one of
those is working as specified. So this phase cannot be scoped as component polish — it must
re-open the direction decision and **amend sections `01-UI-SPEC.md` marks LOCKED**, which no other
phase in this roadmap is permitted to do.

Two consequences to plan for:

  - **The measured palette must be re-derived, not recolored.** The AA contrast ratios in
    `01-UI-SPEC.md` § "Pinned brand, and the lifts it requires" (`#7d99ff` at 5.92:1 on the rack,
    `#2d4fb8` at 4.97:1 on the strip) were computed against the cream-strip/dark-rack pairing
    specifically. Change the ground and every one of those numbers is void — the owner's own
    recorded rule is that "a brand that cannot be read on its own product surface has not been
    applied."
  - **Re-run a direction round rather than freehanding it.** The current world was chosen by the
    owner from an Impeccable round; replacing it by taste-in-the-moment would discard the one
    process that produced an owner-endorsed answer last time.

Sequenced immediately before **Phase 11: Ship It** on purpose: the app icon is a distribution
artifact, so it must be right *before* signing and notarization rather than after.

Sequenced immediately before **Phase 11: Ship It** on purpose: the app icon is a distribution
artifact, so it must be right *before* signing and notarization rather than after. This phase is
blocked on one owner decision already recorded as open in `PRODUCT.md` and carried forward in
`01-UI-SPEC.md` Open Decisions #1 — whether Flywheel carries the HighKnow lightbulb-brain mark or
earns its own under it. There is no point drawing an icon before deciding whose mark it is.

The individual gaps are also filed on the board as issues THRE-1068 through THRE-1074, so this
phase is the roadmap view of work the board already tracks item-by-item.

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
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 10.1 → 11

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. The Board Is The Store Of Record | 21/21 | Complete    | 2026-09-10 |
| 2. One Agent, One Worktree, Watched Live | 18/18 | Complete    | 2026-09-12 |
| 3. Nothing Lost, Nothing Left Running | 38/38 | Complete    | 2026-09-22 |
| 4. `/clear` Is Free | 9/14 | In Progress|  |
| 5. Socratic Epic Authoring | 0/TBD | Not started | - |
| 6. Agents File Their Own Backlog | 0/TBD | Not started | - |
| 7. The Board Tells The Git Truth | 0/TBD | Not started | - |
| 8. Review And Merge Inside Flywheel | 0/TBD | Not started | - |
| 9. Planned Fan-Out That Does Not Collide | 0/TBD | Not started | - |
| 10. Fleet Supervision Across Every Project | 0/TBD | Not started | - |
| 10.1 Visual polish: brand assets and confirmed motion | 0/TBD | Not started | - |
| 11. Ship It | 0/TBD | Not started | - |

---
*Roadmap created: 2026-09-08*
*Granularity: fine · Structure: vertical MVP · 11 phases + 1 inserted (10.1) · 93/93 v1 requirements mapped*
