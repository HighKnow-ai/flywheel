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

- ✓ **Ephemeral agent sessions, reconstituted from the board** — Phase 4. Discarding an agent's whole
  context is a single action, and the next session is primed automatically from the task, its epic,
  its acceptance criteria, prior session summaries and the diff so far — no chat transcript anywhere
  in the path. The same board state deterministically produces the same context packet; the user is
  shown which summaries are carried verbatim and exactly where compaction begins. Every session ends
  by writing a structured summary in the same transaction that marks the run terminal, on both the
  natural-close and the Stop/Discard path, so there is no committed state in which a run is terminal
  and its narrative is missing — and summaries are append-only, never overwritten. When a new
  session's understanding contradicts something already on the board (criteria revised since the last
  run, claimed files that do not match, a stale summary), the user is told in the run's own prompt
  rather than left to find it in the diff. 5/5 roadmap success criteria and all 9 requirement IDs
  (CTX-01…CTX-08, BOARD-03) verified; a 10-cycle reconstitution harness proves criteria survive
  unchanged across sessions. **This is the phase that makes the core-value corollary true rather than
  merely intended** — it took a gap-closure round (plans 04-15/04-16) to get there.

- ✓ **The destructive-command gate no longer rests on a premise Flywheel cannot keep** — Phase 12. The
  gate's load-bearing premise P1 ("Flywheel's shim directory is position 0 of the `PATH` of the process
  that runs the command") was found unachievable: Claude Code runs every agent `Bash` command in a shell
  that first sources a snapshot built from the developer's own login shell, and that init rewrites `PATH`
  from scratch. Rather than harden the classifier an eleventh time, the phase moved interception to a
  layer the login shell cannot reorder — Layer 3, git's own `pre-push` hook installed via
  `core.hooksPath`. A real `git push origin --delete`, a real force-push and a history rewrite are now
  refused before any ref reaches the remote **with the shim absent from `PATH` entirely**, while ordinary
  fast-forward pushes, `git status` and `git --version` stay untouched, and a push from the developer's
  own terminal outside Flywheel's worktree root is never gated. A detected destructive push becomes a
  real permission request whose allow actually completes the push and whose deny leaves the remote ref
  unchanged; with no permission socket it still fails closed. The layer is installed at **every** path
  that can change a project's `repo_path` (registration and explicit relocation), enforced by a source
  invariant that fails if a third mutation path ever skips it. 22/22 non-backstop truths verified; the
  three live-session truths were routed to a human by design and accepted on 2026-10-02.
  **The lesson is methodological:** round ten passed every offline test it had and still bricked the
  product by turning `git --version` into a permission request, so this phase's acceptance clause was
  deliberately two-sided — a check that fails if the gate decides something it cannot justify, AND a
  check that fails if ordinary commands become permission requests.

- ✓ **Agents file their own backlog, and nothing they propose becomes real work without the user**
  — Phase 6. A running agent surfaces what it learns mid-session through a `propose_item` board
  tool, and the row lands in a distinct proposed state carrying its own rationale and a pointer to
  the turn that produced it. The no-promotion guarantee is **structural, not conventional**: a
  source gate walks every `.rs`/`.tsx` file under `packages/core/src`, `packages/desktop/src-tauri/src`
  and `packages/desktop/src` and fails if any module outside the four canonical-writer domain modules
  issues a direct write against `epics`/`tasks`/`issues`/`acceptance_criteria`, bounding the staging
  module to exactly three call sites (accept/merge/materialise). A 17-case adversarial corpus proves
  zero canonical rows exist before an explicit human triage action, across every verb x target-type
  combination and both entry routes. Triage is a dedicated view (`TriageSurface.tsx`) with all four
  verbs plus two bulk paths, run provenance, a jump-to-turn control, and a duplicate annotation that
  is link-only and never auto-drops or auto-merges. Duplicates are flagged inside the staging INSERT
  itself (external-content FTS5 index, measured bm25 threshold of -21.0), never recomputed on read.
  A chatty agent is stopped at a fixed 10 proposals per run with a loud refusal naming the limit, and
  the throttled run gets a notice re-derived from its own event log rather than stored twice. 5/5
  roadmap success criteria and all 7 requirement IDs verified. The live-agent half of criterion 1 was
  measured, not inferred: `scripts/uat/uat-10-agent-backlog.mjs --live` drove a real `claude`
  execution-run session that chose to call `propose_item` on its own.

- ✓ **Multi-project fleet supervision** — Phase 10. One view lists every agent across every
  registered project with what each is doing, distinguishing running, blocked, finished-awaiting-review
  and failed; a dedicated cross-project queue shows every agent blocked on a human and is answerable
  in place at one keystroke per agent; any fleet row jumps to that agent's live session and to its
  board item in any project; the OS raises a banner when an agent blocks, finishes or fails (coalesced
  at 3s, on the pinned `tauri = "=2.11.5"` with `tauri-plugin-notification =2.4.0` per D-181, no
  click-through); and every worktree across all projects is listed with its disk usage and reclaimable
  in a multi-select batch, with token usage and cost surfaced per session and totalled for the fleet.
  5/5 roadmap success criteria and all 7 requirement IDs verified by automated evidence. The cross-project
  read returns a full 200-row window in 4ms under 5,000 runs. Reclaim eligibility is **derived** from
  facts already recorded — nothing writes `worktrees.status = 'stale'`, so there is no populator to drift.
  What was NOT observed: macOS actually drawing a banner, and the first-run permission prompt (D-REV-52,
  D-REV-53) — both physically unautomatable and queued in `DEFERRED-REVIEW.md`.

### Active

- [ ] Board-native work model: epics, tasks and issues are the primary artifact, replacing `.planning/` files as the store of record for phase structure
- [ ] Socratic epic authoring: the agent challenges the user while an epic is being shaped, in the manner of GSD's discuss/research/plan phases, and writes the resulting structure as board items
- [ ] Git worktree multiplexing with fixed topology: task worktree → epic integration branch → main
- [ ] Planner-sized fan-out: the planner decides parallel width and wave grouping from declared file-sets, with a runtime file-overlap guard as a safety net
- [ ] Claude Code as the v1 agent backend, using the developer's existing local credentials
- [ ] Agent adapter seam: a documented interface so Codex, Gemini CLI and others can be added later without a core rewrite
- [ ] Extension-ready foundations — **2 of 3 landed in Phase 1.** Multi-actor identity ships
  (`actors.type IN ('human','agent','system')`, every mutation actor-attributed server-side) and the
  durable append-only event log ships (`events`, gap-free and resumable from any cursor, proved by
  `cursor_resume.rs`). **The generic trigger abstraction is NOT built** — no scheduler crate is
  vendored and no trigger type is stubbed, so schedule-as-trigger-source is still a retrofit rather
  than the drop-in the architecture constraint requires. Close this before the automations milestone.
- [ ] Bound the context packet before task histories get long — **emerged in Phase 4.**
  `context_packet.rs`'s `SUMMARIES_SQL` reads every summary and decision for a task with no cap
  (`04-VERIFICATION.md`, Anti-Patterns). Reconstitution is deterministic but has no tested scale
  ceiling, so a long-lived task's packet grows without bound — which would degrade the exact
  mechanism Phase 4 just validated. Not a correctness bug today; it is the scale ceiling that makes
  `/clear` stop being free.

- [ ] Four destructive categories are still Layer-2-only — **emerged in Phase 12.** Layer 3 removed the
  `PATH`-precedence dependence for the three remote-reaching categories it covers, but `hard-reset`,
  `force-clean`, `recursive-delete` and `default-branch-push` are still guarded only by the shim, and
  therefore still rest on the P1 premise this phase proved unachievable *by default*. `CLAUDE_ENV_FILE`
  (the `SessionStart` hook from plan 12-03) is the general PATH-ownership fix that restores P1 by
  construction, and plan 12-05's live run promoted it from `[CITED]` to `[VERIFIED]` — but scoped to one
  measurement: one macOS machine, `claude 2.1.285`, `bypassPermissions`. Two caveats stay open and are
  recorded as the mechanism's reopen triggers: an upstream report that the file is written but never
  sourced on some builds (`anthropics/claude-code#27987`, Windows, unconfirmed on macOS), and Anthropic's
  own Settings and Hooks guides describing `CLAUDE_ENV_FILE`'s role in contradictory terms
  (`anthropics/claude-code#19357`, closed "not planned"). These four categories want either a second
  non-`PATH` interception layer or a second independent measurement before they can be called closed.
- [ ] Name the `core.hooksPath` override as an accepted risk the user can see — **emerged in Phase 12.**
  A developer (or a tool) that sets a competing `core.hooksPath`, or rewrites the generated `pre-push`
  hook, silently removes Layer 3; install also *refuses* outright when a non-Flywheel hook is already
  present, and registration still succeeds in that case. All of this is correct and deliberate, and all
  of it is recorded in the trust-boundary document's Named Residuals table — but none of it is visible
  in the product. The board should be able to tell the user that a project's gate is not installed.

- [ ] `is_fts5_syntax_error` can never match — **emerged in Phase 6** (`06-REVIEW.md` WR-01).
  `query/search.rs`'s FTS5 syntax-error degradation helper tests `err.to_string()` for `"fts5"`,
  but every call site wraps the error with `.context(...)` first, and `anyhow::Error`'s `Display`
  prints only the top-level context message. The check is therefore always false, so the documented
  "always degrades to an empty result rather than a parse error" contract is not implemented as
  written. Masked today because both duplicate-detection call sites discard the error via `.ok()`
  regardless — a latent bug, not a live one, but the contract is a lie until it is fixed.
- [ ] `TriageSurface` is outside the keyboard layer model — **emerged in Phase 6**
  (`06-REVIEW.md` WR-02). The dedicated triage view is not registered in `state/keyboard.ts`'s
  `LayerState`/`topLayer`, so Escape does not close it and global bindings can still reach around a
  full-screen replacement view. `SessionSurface` and `SettingsSurface` share the same gap, which
  makes this a general fix to the layer model rather than a per-surface patch. No triage-safety
  consequence — nothing reachable this way can promote or bulk-accept — but a real UX regression risk.

- [ ] Two tiers of the forge tick still hold the database mutex across git — **emerged in Phase 10**
  (`10-REVIEW.md` WR-01, partially fixed). The forge *detection* path now reads the stored forge under
  the lock and runs `git remote get-url origin` after dropping it, which was the default path because
  `projects.forge` is NULL until set. But the hot and cold tier ticks still hold the mutex across all
  their git reads, so "no mutex is held across a subprocess" is still not true repo-wide and a hung
  repository can still freeze every command for up to 120s. The larger restructuring was deliberately
  not taken.
- [ ] Worktree reclaim is not atomic across git and the database — **emerged in Phase 10**
  (`10-REVIEW.md` WR-04/WR-05, partially fixed). Reclaim now re-checks for a live run immediately
  before removal via a reclaim-only path, but that only narrows the race to the gap between the query
  and the `git` call — it does not close it. A removal killed at the 120s ceiling can still leave a
  half-deleted worktree that can never be reclaimed again, and the shared-connection read-then-write
  paths still use deferred transactions, leaving the `SQLITE_BUSY_SNAPSHOT` hazard on their side.
- [ ] One Rust suite takes ~503s — **emerged in Phase 10.** The worktree size walk's suite runs for
  over eight minutes because its fixture walks a real repository root (measured at 92GB allocated,
  31–51s for a single walk in an unoptimised build). The whole workspace suite is green, but this one
  suite is most of its wall-clock and was twice misread in-phase as a hang. Bound the fixture.

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
| Board is the context-reconstitution mechanism | Decouples durable work state from ephemeral agent context, making `/clear` free instead of lossy — the core differentiator vs chat-native tools | ✓ Validated (Phase 4) — the falsification test passed. Discard is one action, the next session is primed from board state alone with no transcript, the same board state yields the same packet, and a 10-cycle harness proves criteria survive. What the thesis did not anticipate is how much of the difficulty is *transactional*: the guarantee is only as good as the atomicity of the write that ends a session, and two of the five success criteria initially failed on exactly that |
| Worktree topology is fixed: task → epic integration branch → main | Planner-chosen topology creates a combinatorial testing surface for little gain; the epic integration branch prevents N agents racing merges into main and gives the board one reviewable PR per epic | — Pending |
| Planner decides fan-out width and wave grouping, not topology | Parallelism is bounded by file-set disjointness; the planner's job is declaring file-sets and grouping waves, with a runtime overlap guard for when the forecast is wrong | — Pending |
| Worktrees are durable; agent sessions are ephemeral | A worktree is cheap and owned by a task; contexts are expensive and rot. Many sessions per worktree, each reconstituted from the board | — Pending |
| Claude Code only in v1, behind an adapter seam | Proves the abstraction is designed without paying to implement a second backend | — Pending |
| Desktop-only v1; relay/mobile/web deferred | Smallest v1 that proves the loop end to end | — Pending |
| Multi-actor identity, append-only event log, generic trigger abstraction in v1 schema | The three retrofits that would otherwise be structural rewrites when teams, relay sync, and automations arrive | ◐ 2 of 3 landed (Phase 1). Identity and event log ship and are test-proved; the trigger abstraction was not built and remains a genuine retrofit risk |
| Open desktop / paid cloud | Adoption via OSS desktop; monetise the collaboration layer that only makes sense hosted | — Pending |
| Name: Flywheel, not Harness | Harness.io is a large incumbent in the identical category; Flywheel's only namesake is in an unrelated industry, and it names the thesis | — Pending |
| Move destructive-command interception to a layer the login shell cannot reorder | The gate's P1 premise (Flywheel's shim wins `PATH[0]`) is not achievable by any mechanism Flywheel controls — Claude Code sources a snapshot of the developer's own login shell, which rewrites `PATH` from scratch. Ten rounds of hardening the raw-text classifier could not fix a premise; a design change could | ✓ Validated (Phase 12) — Layer 3, git's own `pre-push` hook installed via `core.hooksPath`, refuses branch deletion, force-push and history rewrite with the shim absent from `PATH` entirely. P1 is now documented as unachievable rather than load-bearing, and the shim's classifier is fenced by a string-literal baseline test so it cannot be quietly widened again |
| Accept the `core.hooksPath` override as a named residual rather than adding another raw-text check | Adding a companion check to the shim would have widened exactly the classifier this phase was fencing off, to defend against a developer deliberately disabling their own gate | ✓ Shipped as an ACCEPT ruling (Phase 12), structurally fenced — the baseline-pin test fails if the classifier grows, so the residual cannot be silently traded for scope creep. Still owed: surfacing it in the product, not only in the document |
| Two-sided acceptance for any gate change | Round ten passed every offline test it had and still bricked the product by turning `git --version` into a permission request. One-sided verification is not sufficient where a false positive is as damaging as a false negative | ✓ Validated (Phase 12) — the phase's acceptance clause required both a check that fails if the gate decides something it cannot justify and a check that fails if ordinary commands become permission requests; the live run asserted `git --version` stays ordinary as a hard assert, never a recordable outcome |
| Build-vs-integrate for the PM core is deliberately open | Highest-leverage architectural fork; deferred to research rather than decided on instinct | ✓ Resolved by Phase 1 — **build**. The PM core is a Rust/`rusqlite` board owning its own schema, migrations and event log. Decided by shipping it, not by a separate research round; the integrate option is now closed without having been separately argued |
| Flywheel ships under the HighKnow lightbulb-brain mark, for now | Owner decision 2026-10-07, taken to unblock Phase 8.1's app icon and direction round. One asset to produce, no naming or identity work. The alternative — Flywheel earning its own mark under HighKnow — matches the open-desktop/paid-cloud split and stays available if Flywheel ever gets a commercial identity of its own | ✓ Decided (2026-10-07), not yet built. `logo.svg` does NOT exist in the repository despite `01-UI-SPEC.md` stating the owner supplied it, so Phase 8.1 success criterion 2 ("the brand asset exists in the repository") starts from zero. This decision had been open since 2026-09-09 and was recorded nowhere: `01-UI-SPEC.md` Open Decision #1 pointed at `PRODUCT.md`, a file that does not exist in this project (the file is `PROJECT.md`), so the pointer dangled for a month |

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

> Note: Phases 2, 3 and 5 completed without a full PROJECT.md evolution pass, so their
> requirement and decision outcomes are not yet reflected above — except for the two Active
> requirements Phase 5 actually closed (`epic_roster`'s unbounded read, by plan 05-04; and what
> `mark_abandoned` owes the board, by plan 05-09), which were removed from Active during the
> Phase 12 transition because leaving them listed was actively misleading. Worth a catch-up read
> of `02-VERIFICATION.md`, `03-VERIFICATION.md` and `05-VERIFICATION.md` before the next
> milestone review.

---
*Last updated: 2026-10-12 after Phase 10*
