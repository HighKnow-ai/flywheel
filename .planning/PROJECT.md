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

## Current Milestone: v0.2.0 The Board Thinks With You

**Goal:** Flywheel's interface becomes the place work is *shaped* with agents — PRDs, decisions,
decomposition and review — instead of a form work is encoded into, and it looks like a tool worth
returning to.

**Target features:**
- PRD as a first-class board record, drafted in a session where the agent challenges the user (SHAPE-01's Socratic arm raised to product level), signed off, carrying the acceptance bar, linked down to the epics that realise it
- ADR as a first-class board record — proposed / accepted / superseded — linked to its PRD and the epics it constrains; an agent that hits a real fork mid-session proposes the decision rather than silently choosing
- A phase (cycle) layer grouping epics, with progress and roadmap always on screen; the fixed epic→task→issue spine underneath is untouched so BOARD-01 still holds
- Agent drafts, human accepts, everywhere: file-set declaration, acceptance criteria, task titles/bodies/decomposition, and status/priority/estimates all gain an agent-authored path. Design rule for the milestone: **no form a human fills that an agent could have drafted**
- Agent-assisted review: the agent pre-reviews its own diff against the task's acceptance criteria and the user adjudicates, rather than reading the diff cold
- A dark-first visual direction with high contrast and saturated accents, colour carrying real state signal (running, blocked, failed, merged), applied to the new IA once it exists
- Carried unmet from v0.1.0: PLAN-01 (planner declares file-sets — the dependency that lets the hand-typed path form be deleted), AGNT-05 (live rate/session-limit observation), DIST-01 (signed, notarized macOS build — orphaned, mapped to no phase in any roadmap until now)

**Why this milestone, in one line.** The encoding forms are not a design oversight — they are
fallbacks for agentic paths that were coded but never proven live. The hand-typed file paths at
`packages/desktop/src/dispatch/WavePlanSheet.tsx:201` exist precisely because PLAN-01 was never
executed against a real planning run, and Phase 8's audit found every task with a worktree carries
zero acceptance criteria because nobody uses a composer that is work. Phase 8.1 already spent 21
plans on visual polish; what shipped is what the user is looking at. So information architecture
leads and the visual round follows it, on the surfaces this milestone creates.

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
  source gate (`no_agent_reachable_module_writes_a_canonical_table`) walks every source file under
  `packages/core/src`, `packages/desktop/src-tauri/src` and `packages/sidecar/src` and fails if any module
  outside the four canonical-writer domain modules issues a direct write against
  `epics`/`tasks`/`issues`/`acceptance_criteria`, bounding the staging module to exactly three call sites
  (accept/merge/materialise). `packages/desktop/src` is reached only by
  `the_no_promotion_gate_actually_reaches_the_frontend_tree`, which asserts the walker is not a `.rs`-only
  no-op; it does not scan the frontend for canonical writes. A 17-case adversarial corpus proves
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

- ✓ **A cycle layer above epics, with roadmap and progress always on screen** — Phase 14. The current
  Cycle's goal and its folded progress are permanently visible, the planned Cycles ahead read as single
  lines, and closing a Cycle asks per unfinished epic rather than silently moving work. The fold is
  proven equal to a full count at 900+ tasks, scope drift is derived from the event log rather than
  stored, and the `cycles` table was added through the spine pin, the table classification and the
  column allowlist in one diff — so the fixed epic→task→issue spine underneath is untouched and
  BOARD-01 still holds. 12/12 must-haves verified, two of them by recorded owner acceptance
  (`14-UAT.md`): that `merged` is defined, tokenised and CVD/contrast-proven but drawn on no surface,
  and that the hierarchy statement predates the commits that shaped the region without being a git
  ancestor of the first tracer commit.

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


- [ ] **v0.2.0** PRD and ADR as first-class board records, authored with a challenging agent and linked to the epics they govern
- [ ] **v0.2.0** Every encoding form gains an agent-drafts/human-accepts path — file-sets, acceptance criteria, task decomposition, and status/priority/estimates
- [ ] **v0.2.0** Agent-assisted review: the agent adjudicates its own diff against the task's criteria first
- [ ] **v0.2.0** A dark-first, high-contrast visual direction where colour carries state, applied to the new IA
  — **the vocabulary landed in Phase 14, the application has not.** Five state classes, four roles and
  one component (`StateBadge`) ship behind a source gate, CVD-proven and contrast-checked per mode, with
  colour never the only channel. What is still owed is the second half of the sentence: Phase 14 measured
  2 saturated rows of 1038 on the board surface (0.19%) and the owner accepted that reading, so the
  direction currently lives on the fleet surface. Applying it across every surface the milestone builds
  is Phase 18, which also carries the one value that could not be made visible inside the contrast
  envelope (the dark needs-you wash, best 4.79 against 4.43 shipped).

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
| **A-01** Criterion 2 reads "refactored, deleted, or allow-listed" (was "refactored or allow-listed") | `start_agent_run`'s raw `tasks.status` write is redundant once status is derived, so it is deleted rather than allow-listed (Phase 13 D-13) | ✓ Recorded (Phase 13) |
| **A-02** Criterion 3's forbidden-word gate is a whole-word scan with two named idiom exclusions | The literal substring reading fails the build on idiomatic Rust (`with_capacity`, the timeout `deadline` in `proc.rs`); a whole-word match keeps all ten words and fires only on PM-shaped use (Phase 13 D-20) | ✓ Recorded (Phase 13) |
| **A-03** D-122's forward-only rule is re-expressed as a floor on the deriver, and the floor does not bind human authority acts | Forward-only is a property of the derived candidate, not of the board: a human may still lower status deliberately (Phase 13 D-10, D-11) | ✓ Recorded (Phase 13) |
| **A-04** The roadmap's research flag is answered: acknowledged decisions never drop from the context packet, and the bound is on the input, not the residue | `acknowledged_decisions` is drift machinery (D-73) and never affects inclusion; the window bounds what the fold reads, so the fold stays lossless over whatever it is given (Phase 13 D-01, D-07) | ✓ Recorded (Phase 13) |
| **A-05** D-109 amended (owner decision, 2026-10-15): the proposal cap is per run kind, with the execution value unchanged at 10 | The 10-per-run cap applied to authoring runs by accident and would have throttled a 42-draft decomposition. Values are compile-time constants selected by a `const fn` (execution 10, planning 30, authoring 60), never settings; 100 for authoring was rejected because 100 pending items in one run is the unreviewable queue the research round warns against (Phase 13 DRFT-09) | ✓ Recorded (Phase 13) |
| **A-06** A-02 extended: criterion 3's forbidden-word gate matches a corpus word used as an identifier COMPONENT (prefix at an identifier boundary), not only as a standalone whole word, so `sprint_id`, `overdueCount`, `velocity_per_week` and `story_points_total` fail the build | A-02 bought whole-word matching so `Vec::with_capacity` would not fail the build, and that exclusion is unchanged; it did not license compound identifiers, and criterion 3's own wording is "a build containing `story_point` … fails", which the plural satisfies. Phase 14 adds schema, which is where the blind spot bites. Still open, not settled by this row: `.sql` files remain unscanned (deferred by `13-CONTEXT.md`; `SCANNED_EXTENSIONS` in `pm_vocabulary_gate.rs` makes reversal a one-token edit), and the counter-argument stands — a Phase 14 `cycles` table with a `sprint_length_days` column passes the spine pin, table classification and the PM gate today (Phase 13 FNC-04, plan 13-14) | ✓ Recorded (Phase 13) |
| **A-07** F6 amended (owner decision, 2026-10-15): the `agent_runs.kind` column is NOT added; run kind has one definition in code, `RunKind::classify`, with `RUN_KIND_*_PREDICATE` mirroring it in SQL | That satisfies F6's intent ("run kind is inferred from column shape in four places" becomes one definition) without a schema change. A column means another `tasks`/`agent_runs` rebuild on a spine this phase pinned, for a value already derivable from the row; DRFT-09's own text concerns not throttling and refusal wording and names no column, so it is met on its text. The column stays available at the cost of one migration if a query ever needs to filter on kind without the predicate (Phase 13 DRFT-09, plan 13-11) | ✓ Recorded (Phase 13) |
| State colour is budgeted, not applied as a blanket wash | Phase 14's plan 14-09 washed all five state classes across the fleet and the result was "a pastel plate" — colour everywhere carries no signal. The ruling: `needs-you` and `failed` carry a row wash; `running`, `merged` and `quiet` stay ink-only, and the direction is measured as a percentage of saturated rows rather than asserted | ✓ Validated (Phase 14) — colour reads as state because it is scarce. The cost is that the board surface itself measures 0.19% saturated and the signal effectively lives on the fleet; the owner accepted that reading in UAT, and Phase 18 owns raising it per-surface without returning to the pastel plate |

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
*Last updated: 2026-10-16 after Phase 14*
