# Pitfalls Research

**Domain:** Agentic Development Environment (ADE) — desktop supervisor for parallel AI coding agents via git worktree multiplexing, with an agent-writable board as store of record
**Researched:** 2026-09-08
**Confidence:** MEDIUM (cross-checked web sources, one primary GitHub issue, no direct interviews; domain moves fast — recheck before each major architecture decision)

## Top 5 Project-Killers

Ranked by how directly they threaten the core value ("every unit of agent work is anchored to a structured board item — never a chat blob") and the v1 success metric (a full week of real work without dropping to a bare terminal).

1. **Worktree lock contention destroys work at exactly the fan-out width Flywheel promises.** (Pitfall 1) A real, filed Claude Code bug shows 8 of 13 parallel agents losing work to `.git/index.lock` collisions, with auto-cleanup then deleting the worktree — permanently destroying the uncommitted diff. This isn't a corner case; it is what happens the first time a user tries the headline feature at scale.
2. **Context reconstitution silently degrades instead of failing loudly.** (Pitfall 3) The core differentiation claim — "the board makes `/clear` free" — is falsifiable in exactly the way context rot always is: quietly, session over session, with no error to catch it. If reconstituted context loses acceptance criteria or prior decisions without anyone noticing, the product's central bet fails invisibly.
3. **Agents editing outside their declared file-set poisons the planner's own parallelism guarantee.** (Pitfall 2 / PROJECT.md's own stated risk) Measured elsewhere: ~35% of scoped AI coding tasks touch unrelated files without enforcement; a pre-tool-use scope hook cuts that to ~4%. Flywheel's entire wave-scheduling model (file-set disjointness) is void if this isn't enforced at the tool-call layer, not just the plan layer.
4. **Retrofitting the event log / multi-actor identity / relay-readiness after v1 ships is a rewrite, not a migration.** (Pitfall 7) PROJECT.md already commits to building these in from day one — correctly, per every local-first sync post-mortem researched. The risk is not deciding this wrong; it's letting schedule pressure erode it during v1 execution ("we'll just add the event log in phase 6").
5. **Driving agents on the user's personal Claude subscription credentials is an unstated compliance dependency.** (Pitfall 5) Anthropic actively enforces against OAuth-token use in third-party harnesses; PROJECT.md's constraint that "credentials never leave the desk" reduces but does not eliminate this risk, since Flywheel *is* a third-party harness driving the CLI programmatically. A policy shift here is outside Flywheel's control and could invalidate the v1 execution model overnight.

---

## Critical Pitfalls

### Pitfall 1: Worktree lock contention silently destroys agent work at fan-out

**What goes wrong:**
When N agents run in parallel worktrees that share one repository's `.git/` directory, concurrent `git commit`/`git add` operations collide on `.git/index.lock`. A real, filed Claude Code issue (anthropics/claude-code#55724) documents this precisely: at 13 parallel agents, 8 of 13 failed with `Unable to create '.git/index.lock': File exists`. Worse, when the framework's auto-cleanup then removes the "failed" worktree, it destroys the agent's uncommitted work permanently — there was no crash in the agent, only a lock collision, but the outcome is identical to data loss.

**Why it happens:**
Worktrees have independent index files for staging, but ref updates, loose-ref writes, and object packing still touch the shared `.git/` directory. Locks are held for milliseconds, but at any meaningful fan-out width the probability of two agents committing in the same tens-of-milliseconds window approaches certainty. This is exactly the scenario Flywheel's "planner-sized fan-out" is designed to produce.

**How to avoid:**
- Retry `git commit`/`git add` on `index.lock` failure with exponential backoff (200ms → 400ms → 800ms, 3–5 attempts). This alone resolves nearly all transient collisions per the primary-source postmortem.
- **Never destroy a worktree on agent-process exit without first checking `git status --porcelain` for uncommitted changes.** Treat "uncommitted changes present" as a hard stop requiring human or supervisor-level recovery, never silent deletion.
- Add small random jitter (100–500ms) to worktree/agent spawn timing within a wave to desynchronize simultaneous git operations rather than relying purely on retries.
- Consider whether Flywheel's own supervisor should serialize all git-mutating operations across a project through a single queue/lock at the supervisor level, independent of git's own locking, so retries are deterministic and observable rather than opaque CLI failures.

**Warning signs:**
- Any spike in agent task failures correlated with wave width, not with task content.
- Agents reporting generic git errors instead of task-specific failures.
- Worktrees disappearing from disk without a corresponding "task complete" or "task failed with diff preserved" board state.

**Phase to address:** Core git worktree orchestration layer — must be solved before the first multi-agent wave ships, not bolted on after. This is infrastructure, not a feature; treat it as a blocking dependency of "planner-sized fan-out."

**Severity:** Kills the project's headline promise if unaddressed — every user's first parallel run risks losing work, which is the single fastest way to destroy trust in "the worktree is durable and safe."

---

### Pitfall 2: Agents modify files outside their declared file-set, invalidating the planner's parallelism guarantee

**What goes wrong:**
Flywheel's whole fan-out model depends on the planner's declared `files_modified` being accurate, downgrading a wave to sequential only when a pairwise overlap check catches a conflict *before* dispatch. But agents routinely touch files outside a stated scope — renaming a variable while "just" fixing a function, reformatting a file they opened to read, following an abstraction they invented mid-task. GSD-core's own execute-phase workflow already treats the planner's forecast as "frequently wrong" (PROJECT.md, Origin section) — that's a description of the *planning-time* problem; the *runtime* problem (an agent quietly writing to an undeclared file) is a distinct and larger failure surface, because the overlap guard only ever sees what was declared, not what actually happened.

**Why it happens:**
Coding agents are trained to produce coherent, "clean" diffs — an LLM asked to fix one function will often also fix an adjacent one it judges related. There is no default mechanical constraint stopping a tool call from writing to any path in the worktree.

**How to avoid:**
- Enforce the file-set at the tool-call layer, not just the plan layer: a pre-write hook that checks every `Edit`/`Write` tool call against the task's declared file-set and blocks (or flags for scope-expansion approval) anything outside it. One documented case study found this exact intervention cut unrelated-file changes in scoped tasks from ~35% to ~4%.
- Distinguish "blocked, ask the user" from "blocked, auto-reject and continue" — the former is safer for early versions where trust in the enforcement mechanism itself is still being built.
- Log every scope-boundary event as a board-visible artifact (not just a terminal message), since the whole point of the board-native model is that this kind of signal should never live only in a transcript.
- Keep this distinct from the wave-level "runtime file-overlap guard" already planned — that guard catches two tasks colliding on a declared file; this pitfall is about a task quietly writing to a file it never declared, which the overlap guard cannot see at all.

**Warning signs:**
- Diffs at merge time touching files never listed in the task's acceptance criteria or file-set.
- Post-merge integration failures traced to a file no task claimed ownership of.
- Growing "surprise diff" size relative to declared scope over a project's lifetime (agents drift wider as codebase familiarity/confidence increases).

**Phase to address:** Same phase as worktree orchestration/fan-out — this is a companion enforcement mechanism to the overlap guard, not a separate later feature.

**Severity:** Degrades trust and correctness silently; does not crash the app, but erodes the parallelism guarantee the entire architecture is built on, and produces exactly the "integration breakage that only appears at merge" failure mode named in the research question.

---

### Pitfall 3: Reconstituted context degrades silently instead of failing loudly ("context rot" reborn inside the fix for context rot)

**What goes wrong:**
Flywheel's core differentiation claim is that reconstituting an agent's context from structured board data (issue + acceptance criteria + prior session summaries + diff-so-far) avoids the lossy `/clear` and "summary of a summary of a summary" degradation that afflicts chat-native tools. But the underlying mechanism that makes this *possible* — summarizing prior sessions into something the next session's context window can hold — is subject to exactly the same failure physics as the problem it claims to solve, one layer down: session-summary quality degrades across successive summarize-then-resummarize cycles, acceptance criteria get paraphrased into vaguer language each pass, and decisions already made get "re-derived" by a fresh agent that no longer has the reasoning trail, only the conclusion.

**Why it happens:**
Context rot is a structural property of how LLMs handle growing/compressed context, not an implementation bug specific to chat UIs — research on this is explicit that "the fix isn't making models better at long contexts, it's keeping their context short," which is exactly Flywheel's bet. But "short" context built from repeated summarization is still lossy; specific function names, edge cases, and rejected alternatives are exactly the details that collapse first when a summary is itself resummarized. A board schema that stores only the *current* summary (mutable state, no history) makes this worse, because there is nothing to detect drift against.

**How to avoid:**
- Never overwrite prior session summaries in place. Store them as an append-only sequence per task (this also satisfies the "durable append-only event log" architectural constraint already committed to in PROJECT.md) so degradation is auditable and, if detected, a session can be reconstituted from an earlier, less-degraded summary rather than the most recent one.
- Keep acceptance criteria as first-class structured fields on the board item, never folded into prose summaries — they should never depend on surviving a summarization pass, because they're the one thing that must never drift.
- Store the actual diff-so-far as ground truth alongside any narrative summary; treat the summary as an index into the diff, not a replacement for it, since diffs cannot "degrade" the way prose can.
- Build a detectable signal for drift: e.g., flag when a new session's stated understanding of acceptance criteria disagrees with the stored structured criteria, or when a session re-proposes a decision already recorded as made.
- Resist the temptation to save tokens by summarizing summaries. If a task's history grows too long for one context reconstitution, that is itself a signal the task should have been decomposed smaller — not a summarization problem to solve harder.

**Warning signs:**
- Agents re-litigating decisions already recorded on the board (a directly observable, loggable event: "session proposed X, board already records X was rejected").
- Acceptance criteria text drifting between what a task was created with and what a session five summaries later "remembers" it needs.
- Task completion quality declining measurably on tasks with long session histories vs. short ones, holding task complexity constant.

**Phase to address:** This must be validated during the phase that builds context reconstitution itself, with an explicit test: run the same task through 5+ synthetic session cycles and diff the reconstituted context against the original acceptance criteria. Do not treat this as "done" until that test exists — it is the direct verification of the Core Value statement in PROJECT.md.

**Severity:** Kills the core differentiation claim if it degrades invisibly; the danger is specifically that it *looks* solved (no crash, no error) while quietly becoming exactly the chat-native failure mode it was built to avoid.

---

### Pitfall 4: Zombie agent processes and orphaned worktrees survive app quit

**What goes wrong:**
Desktop apps that `spawn()` child processes (here: Claude Code CLI instances) commonly fail to clean them up on app exit. Documented failures span both major desktop shells: on Tauri/Windows, processes spawned via `Command.spawn()` cannot always be killed even when `kill()` reports success; on Electron, an unreferenced spawned child can itself prevent the app from exiting cleanly. When Flywheel's supervisor process quits (crash, force-quit, update install) while N agent CLI processes are running across M projects, those processes and their worktrees can be left running — burning tokens unattended, holding file locks, and leaving worktrees the app no longer tracks as "in progress."

**Why it happens:**
Process lifecycle management across a parent-child boundary is an OS-and-shell-specific problem the desktop framework does not solve automatically; killing a direct child does not kill its own descendants unless process-group semantics are handled explicitly, and neither Electron nor Tauri guarantee this out of the box.

**How to avoid:**
- Use process groups (not bare PIDs) when spawning agent CLI processes, and kill the whole group on supervised shutdown.
- Implement the "child monitors parent, self-terminates if parent dies" pattern as a belt-and-braces backstop, independent of the supervisor's own cleanup path — this survives even ungraceful supervisor crashes.
- On app startup, reconcile: scan for any agent processes or worktrees the board thinks are "in progress" that have no live process behind them, and surface them to the user rather than silently resuming or silently ignoring them.
- Persist a "last known good" heartbeat per running session so a crash-recovery pass on next launch can distinguish "still running, reattach" from "orphaned, needs cleanup" from "died mid-work, needs resumption decision."

**Warning signs:**
- CPU/token usage continuing after the app is quit.
- Worktree directories present on disk with no corresponding board task state.
- Users reporting "phantom" API usage on their Anthropic account after closing Flywheel.

**Phase to address:** Process supervision layer, built alongside the worktree orchestration core — this is not a polish-later item; unattended token burn is a direct financial harm to users on metered plans.

**Severity:** Degrades trust badly and can cause real financial harm (unattended API/token spend); does not by itself kill the architecture, but a single bad incident (discovered runaway spend) will be reported publicly and damage OSS adoption fast.

---

### Pitfall 5: Local credential reuse is a compliance dependency Flywheel doesn't control

**What goes wrong:**
PROJECT.md commits to "Claude Code as the v1 agent backend, using the developer's existing local credentials," with the explicit rationale that credentials never leave the desk. Reasonable for privacy — but Anthropic has an active, evolving enforcement posture against using subscription (OAuth) credentials in third-party tools/harnesses. Reported enforcement patterns show waves of account suspensions targeting exactly this pattern (multi-account rotation, third-party harness use of subscription OAuth tokens), even though holding multiple accounts per se is not a violation. Separately, users running several concurrent Flywheel-driven agent sessions on one account are already hitting session-limit and rate-limit friction reported by other Claude Code power users (5-hour rolling limits, weekly caps, and reports of the session meter consuming faster than actual token usage under concurrent multi-session use).

**Why it happens:**
Anthropic's terms distinguish "use Claude Code as intended" from "use Claude subscription auth as a backend for a separate product" — and Flywheel's supervisor process, spawning and orchestrating many Claude Code sessions across many worktrees, sits closer to the second category than a single interactive terminal session does, even though it's driving the same official CLI a human would use directly.

**How to avoid:**
- Document clearly for users which auth path Flywheel uses (ideally: literally shelling out to the user's own already-authenticated `claude` CLI, not intercepting or replaying OAuth tokens itself) and keep that boundary architecturally explicit and auditable.
- Support the `ANTHROPIC_API_KEY` / `apiKeyHelper` path as a first-class alternative for users who want to run at fleet scale without touching subscription-limit or ToS ambiguity — this is Anthropic's own documented sanctioned path for automation.
- Build in visible rate-limit/session-limit backoff and queuing so Flywheel doesn't inadvertently look like abuse (bursty, many-concurrent-session usage patterns) even when the user's intent is legitimate.
- Track Anthropic's policy posture as an ongoing external dependency — this is not a "solve once" item; revisit at each milestone, since enforcement policy has already shifted materially within the past year of this research.

**Warning signs:**
- User reports of account warnings/suspensions correlated with Flywheel usage.
- Rate-limit errors surfacing during normal single-project fleet use (a signal Flywheel's usage pattern is tripping thresholds tuned for interactive use).
- Anthropic ToS or Claude Code docs changes explicitly naming orchestration/multi-agent-supervisor use cases.

**Phase to address:** Agent adapter seam — the credential-handling boundary must be designed explicitly and documented, not left as an implicit assumption of "just shell out to claude." Address in the same phase as the Claude Code adapter itself.

**Severity:** Existential risk that is entirely outside Flywheel's control — a policy shift could break the v1 execution model overnight. Mitigation reduces likelihood and blast radius but cannot eliminate it; this belongs in the roadmap's risk register, not just its architecture.

---

## Moderate Pitfalls

### Pitfall 6: Board governance is missing on day one, and agent-authored backlog spam arrives before trust is established

**What goes wrong:**
PROJECT.md's active requirement "agents propose new tasks, issues and epics from what they learn" is exactly the feature research shows causes backlog trust collapse if ungoverned: agents create low-value or duplicate issues, mutate items other agents (or the user) depend on mid-flight, and cause status churn that erodes the human's trust in the board as source of truth. Industry data on AI-assisted triage shows duplicate detection is achievable (70–85% accuracy via embeddings) but only when built deliberately — it is not a side effect of letting agents write freely.

**Why it happens:**
An agent given write access to a shared, persistent artifact and no rate limit, no duplicate check, and no ownership/locking model will use that access exactly as often as it "learns something worth noting" — which, for an LLM narrating its own reasoning, is often. Multiple agents working different tasks in the same project can independently propose near-duplicate issues with no visibility into each other's proposals.

**How to avoid:**
- Ship agent-authored items in a distinct "proposed" state, never directly into the active backlog — the user triages before anything an agent writes becomes a first-class board item other agents can depend on.
- Add duplicate detection (even simple text/embedding similarity against existing proposed+active items) before an agent-authored item is surfaced to the user, not after.
- Never let an agent mutate a board item another task currently depends on without an explicit ownership/lock check — this is the same "declared file-set" discipline applied to board data instead of source files, and should reuse the same enforcement pattern.
- Rate-limit or batch agent-authored proposals per session rather than allowing unbounded real-time writes, so a single confused agent can't flood the backlog in one run.

**Warning signs:**
- Proposed-item volume growing faster than triage throughput.
- User triage sessions increasingly rejecting/dismissing agent proposals (a leading indicator of trust erosion before the user says so explicitly).
- Two agents independently proposing near-identical issues within the same project.

**Phase to address:** Ship the "proposed, not active" governance gate in the same phase as agent-authored backlog itself — do not ship write access before the triage boundary exists, even for v1.

**Severity:** Degrades adoption and trust; recoverable with product changes, but a bad first impression here (user opens the board to a wall of low-value agent-authored noise) directly undermines the "board as trusted store of record" core value.

---

### Pitfall 7: Local-first schema decisions made for v1 speed foreclose the sync/team layer later

**What goes wrong:**
PROJECT.md correctly identifies the three retrofits that are normally fatal if deferred — multi-actor identity, an append-only event log, and a generic trigger abstraction — and commits to building them into the v1 schema. The pitfall is not that this decision is wrong; industry pattern strongly supports it (the classic failure is mutable-state-only persistence with no event log, discovered only when sync is bolted on later and there is no record of *what changed and in what order* to reconcile). The pitfall is schedule pressure during execution causing these to be "simplified for v1" in ways that look harmless locally (e.g., a single-user-implicit `updated_by` column instead of real actor identity; last-write-wins mutation with no change history) but are exactly the shortcuts that make sync impossible to retrofit without a rewrite.

**Why it happens:**
None of these three foundations pay for themselves in a single-user, single-device v1 — they exist purely to keep a door open a milestone or two away, which is precisely the kind of investment that erodes under deadline pressure because nothing visibly breaks if you skip it now.

**How to avoid:**
- Treat "does this board mutation append an event, not just update state" as a mechanical checklist item in code review for every schema-touching phase — not a discussion, a lint rule if feasible.
- Model every board item field as owned by an actor from day one, even when that actor is always "the local user" or "the local agent process" in v1 — the field existing and being populated correctly is what matters, not that it's exercised by multiple real users yet.
- Use logical/hybrid clocks (not raw wall-clock timestamps) for event ordering from the start, even locally — retrofitting ordering semantics after events already exist without them is exactly the "we CRDT'd our entire database and now everything is confusing" failure mode documented in local-first postmortems.
- Do not let "it's just local-first v1, nobody's syncing yet" become license to skip designing conflict *detection* (not full resolution — v1 has one writer, so resolution is trivial) into the event schema. Detection wiring is what's expensive to retrofit; resolution logic can genuinely wait.

**Warning signs:**
- Any schema migration during v1 that changes a field from event-sourced to directly-mutated for convenience.
- `updated_by`/`created_by` fields that are hardcoded or assumed rather than genuinely populated per-actor.
- Timestamps used as the sole ordering mechanism anywhere events matter.

**Phase to address:** The foundational data-model phase, before board-native work model ships — this is the one category of pitfall in this document where "phase to address" is unambiguous, because PROJECT.md already scopes it that way. The risk is entirely about *holding the line* during later phases, not about deciding it now.

**Severity:** Does not kill v1, but silently forecloses the entire commercial roadmap (relay, teams, mobile/web) that PROJECT.md depends on for the business model — a deferred-but-fatal risk.

---

### Pitfall 8: Open-core boundary placed on the wrong seam invites "crippled core" perception

**What goes wrong:**
PROJECT.md's constraint is explicit and directionally correct: desktop ADE is OSS, "collaboration/cloud layer" is commercial, and the boundary must "fall on a clean module seam in the codebase, not be retrofitted later." Industry pattern shows the two failure modes on either side of that seam: place it too generously (OSS edition barely useful, a "crippled core" demo) and the OSS community that would drive adoption never forms; place it too stingily in the other direction (give away collaboration primitives the paid tier needed) and there's no commercial product left. A related, more insidious failure: contributors submitting PRs that touch functionality later deemed "should have been commercial" get their work rejected, and the rejection reads as bad faith even when it isn't, because the boundary wasn't documented before the contribution was made.

**Why it happens:**
The boundary is usually easy to state in principle ("solo desktop = free, team/cloud = paid") and hard to hold in practice, because individual features don't sort cleanly — e.g., is "multi-actor identity in the schema" (already committed as v1 OSS scope per PROJECT.md) a free feature or infrastructure for a paid one? PROJECT.md gets this specific case right by scoping identity as schema-level OSS infrastructure with team *features* (roles, presence, shared projects) as the paid layer — that is the correct seam. The risk is drift from that principle under commercial pressure later.

**How to avoid:**
- Publish the open/paid boundary explicitly and early (even in v1 docs) so contributors know before they invest effort, not after a PR is rejected.
- Keep the rule PROJECT.md already states — "infrastructure/schema is OSS, hosted multi-user/relay experience is paid" — as a literal, checkable test applied to every new feature at planning time, not a retrospective judgment call.
- Make sure the OSS desktop app is independently excellent for the stated primary use case (solo developer, full week of real work) — this is already the v1 success metric, and holding it is the single best defense against "crippled core" perception, because the OSS product must never feel like a funnel.

**Warning signs:**
- A feature planning discussion where the answer to "OSS or paid?" is "whichever makes more revenue" rather than "which side of the schema/experience line does this sit on."
- Community contributions arriving for functionality later reclassified as paid.
- OSS users reporting the desktop app feels deliberately limited rather than genuinely complete for solo use.

**Phase to address:** Decide and document the boundary test during the architecture-defining phase (alongside the data-model work in Pitfall 7); re-verify at each milestone that new features still classify cleanly.

**Severity:** Degrades community trust and adoption velocity if mishandled; unlikely to kill the project outright given PROJECT.md's boundary is already well-reasoned, but drift here is slow and easy to miss until reputational damage is already done.

---

## Minor Pitfalls

### Pitfall 9: Supervisor cwd drift into a worker's worktree

**What goes wrong:** GSD-core already carries an explicit guard against this (PROJECT.md, `execute-phase.md:514`); at Flywheel's fleet scale (multiple projects, many concurrent worktrees) the blast radius of a drifted cwd is larger — a supervisor-level operation accidentally executed against a worker's directory rather than its own state.

**How to avoid:** The supervisor process must never `cd` into a worker's worktree for any operation; all cross-directory operations should take an explicit path argument rather than relying on process cwd, and this should be enforced structurally (e.g., a lint/test that greps for bare relative-path git operations in supervisor code) rather than relied on as a convention.

**Phase to address:** Same phase as worktree orchestration core.

---

### Pitfall 10: Streaming output backpressure across many concurrent agent sessions

**What goes wrong:** Supervising many concurrent agent CLI processes' streaming stdout at fleet scale (multiple projects × multiple worktrees) can produce backpressure the supervisor UI wasn't designed for — either dropped output (losing the audit trail of what an agent actually did) or a supervisor process that itself becomes unresponsive under high-throughput streaming from many sources at once.

**How to avoid:** Buffer and persist raw agent output to durable per-session logs independently of what the UI renders in real time, so UI backpressure never causes silent output loss; treat the UI stream as a "best effort live view" and the persisted log as ground truth.

**Phase to address:** Process supervision layer, alongside crash recovery design.

---

### Pitfall 11: Agents hang on unattended interactive prompts

**What goes wrong:** A tool an agent invokes (package installer, dev server, git itself in some cases) can drop into an interactive confirmation prompt with no human present to answer it, hanging the agent session indefinitely and burning wall-clock time (and, if watched by a supervisor with generous timeouts, token/session budget) for no output. This is a widely reported failure across agent CLIs generally (Gemini CLI and others have open issues on exactly this), not unique to Claude Code, but Flywheel's unattended/fleet-scale model makes it more costly since no human is watching most sessions most of the time.

**How to avoid:** Detect non-TTY/non-interactive execution and configure agent-invoked subprocesses accordingly where possible (`--yes`/`--no-confirm` conventions); set a hard idle-output timeout per session distinct from a total-runtime budget, so a hung prompt is caught and surfaced (as a board-visible "needs human input" state) rather than silently consuming budget until the outer cap trips.

**Phase to address:** Process supervision layer.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|--------------------|-----------------|------------------|
| Skip the file-set enforcement hook, rely on the planner's declared scope only | Faster to ship parallel fan-out | Silent scope creep invalidates the wave-scheduling guarantee (Pitfall 2) | Never for v1 — it's a companion to the overlap guard, not optional polish |
| Store only the latest session summary per task, not an append-only sequence | Simpler schema, less storage | No way to detect or recover from summarization drift (Pitfall 3); also violates the already-committed event-log constraint | Never |
| Destroy a worktree immediately on agent process exit without a status check | Simpler cleanup code | Silent data loss on lock-contention failures (Pitfall 1) | Never |
| Hardcode `created_by`/`updated_by` to a single implicit local actor | Faster v1 schema | Blocks multi-actor identity retrofit later (Pitfall 7) | Never — PROJECT.md already commits against this |
| Let agents write directly to active backlog without a "proposed" staging state | Faster to demo agent-authored backlog | Backlog trust collapse under spam/duplicates (Pitfall 6) | Only for an internal single-user dogfood build, never for the first real users |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|--------------|------------------|--------------------|
| Claude Code CLI (subprocess) | Assuming a clean process tree kill on supervisor shutdown | Use process-group kill + child-monitors-parent self-terminate backstop (Pitfall 4) |
| Claude subscription OAuth | Treating "existing local credentials" as risk-free because they never leave the desk | Prefer/support `ANTHROPIC_API_KEY`/`apiKeyHelper` as the documented automation-sanctioned path; document the boundary (Pitfall 5) |
| git worktree + shared `.git/` | Assuming worktree isolation means full operational isolation | Add retry/backoff on lock contention; never destroy a worktree with uncommitted changes (Pitfall 1) |
| git submodules / LFS inside worktrees | Assuming a new worktree inherits initialized submodules | Explicit `git submodule update --init --recursive` per new worktree; force-removal needed for worktrees with checked-out submodules |
| macOS distribution | Shipping unsigned/unnotarized builds and discovering Gatekeeper blocks users | Budget for the $99/yr Apple Developer account and notarization pipeline from the first distributable build, not at "launch" |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| N worktrees × M projects, each with its own `node_modules`/venv | Disk exhaustion, slow worktree creation | Consider shared package-manager caches (pnpm store, uv cache) referenced by each worktree rather than full duplication; surface disk usage per project in the fleet view | Becomes visible well before "many projects" — even 5-10 worktrees on one JS monorepo can be tens of GB |
| Unbounded concurrent agent sessions per account | Rate-limit errors, session-meter overconsumption | Queue/backoff at the supervisor level tuned to the credential path in use (subscription vs API key) (Pitfall 5) | Reported by real users already at modest concurrent-session counts on subscription plans |
| Streaming stdout from many concurrent sessions rendered live in one UI | UI jank, dropped output | Persist raw logs independent of UI render path (Pitfall 10) | Scales with fleet width, not project size — hits early in multi-project use |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing or proxying the user's Claude OAuth token instead of shelling out to their already-authenticated CLI | Directly triggers Anthropic's stated enforcement target (third-party harness use of subscription auth) | Architect the adapter to invoke the user's own `claude` binary/session rather than intercept or replay tokens (Pitfall 5) |
| Agent-writable board with no per-item ownership/lock model | An agent (or a bug) silently mutates a board item another in-flight task depends on | Ownership/lock check on mutation, same discipline as file-set enforcement (Pitfall 6) |
| .gitignore'd secrets (`.env`) needed by agents inside worktrees | Copying `.env` into every worktree multiplies the surface area where a leaked/committed secret can occur | Symlink or inject secrets at agent-launch time rather than copying into the worktree's working tree; never let an agent's diff include a `.env` file by construction |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-------------------|
| Agent-authored board spam with no visual distinction from human-authored items | Trust erosion, "I can't tell what's real anymore" | Distinct visual/state treatment for agent-proposed items pending triage (Pitfall 6) |
| Silent context degradation with no indicator | User discovers a regression session later, can't tell why | Surface reconstitution confidence/drift signals in the UI, not just internally (Pitfall 3) |
| No visible "this agent is stuck on a prompt" state | User assumes agent is working when it's actually hung | Distinct board/fleet-view state for "needs human input" vs "running" vs "failed" (Pitfall 11) |

## "Looks Done But Isn't" Checklist

- [ ] **Worktree cleanup:** Often missing the uncommitted-changes check before deletion — verify no code path ever calls worktree-remove without a preceding `git status --porcelain` guard.
- [ ] **File-set enforcement:** Often implemented only as planner-time declaration — verify a runtime tool-call-level hook actually blocks/flags out-of-scope writes, not just plan-time overlap checking.
- [ ] **Context reconstitution:** Often "tested" only on session 1→2 — verify it's been tested across 5+ synthetic resummarization cycles with acceptance-criteria-drift checked explicitly.
- [ ] **Process cleanup on quit:** Often tested only on graceful quit — verify force-quit and crash scenarios also leave no orphaned agent processes (test via kill -9 on the supervisor, not just the quit menu item).
- [ ] **Event log:** Often present in schema but not actually append-only in practice — verify no code path does an in-place UPDATE where an INSERT-of-event should occur.
- [ ] **Agent-authored board items:** Often shippable as "agents can create issues" without the staging/triage gate — verify a "proposed" state exists and is the only entry point for agent-created items before they're indistinguishable from human-created ones.
- [ ] **macOS distribution:** Often works on the developer's own signed dev machine — verify a truly clean machine (no prior trust) can install and run the notarized build without Gatekeeper friction.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|----------------|------------------|
| Worktree lock-contention data loss (Pitfall 1) | LOW once caught, HIGH if undetected | If uncommitted-changes guard exists: recover via `git stash`/manual commit from the preserved worktree. If it doesn't exist and data was already deleted: unrecoverable — this is why prevention here is non-negotiable |
| Scope-creep merge breakage (Pitfall 2) | MEDIUM | Revert the offending file's changes from the task branch, re-scope and re-run just that file's needed change as its own declared task |
| Undetected context drift (Pitfall 3) | MEDIUM-HIGH | Reconstitute from an earlier, less-degraded stored summary in the append-only sequence rather than the latest one; this recovery path only exists if summaries were never overwritten in place |
| Orphaned agent processes burning tokens (Pitfall 4) | LOW | Startup reconciliation pass kills/flags orphans; user-facing "unexpected usage" investigation tooling if financial impact already occurred |
| Board spam / trust erosion (Pitfall 6) | MEDIUM | Retroactively apply a "proposed" gate and bulk-triage/archive existing low-value agent-authored items; communicate the governance change to rebuild trust |
| Schema missing event log / actor identity (Pitfall 7) | HIGH | This is close to a rewrite if discovered post-launch — the entire point of the prevention strategy is that this recovery path should never need to be exercised |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|--------------------|----------------|
| Worktree lock contention destroys work | Worktree orchestration core | Load-test with 10+ parallel agents committing concurrently; confirm zero data loss and observable retry/backoff behavior |
| Agents write outside declared file-set | Worktree orchestration core (paired with runtime overlap guard) | Deliberately instruct a test agent to "also clean up" an undeclared file; confirm the hook blocks/flags it |
| Context reconstitution degrades silently | Board-native work model / context reconstitution phase | Run a task through 5+ synthetic session cycles; diff reconstituted acceptance criteria against originals programmatically |
| Zombie processes / runaway spend | Process supervision phase | Force-kill the supervisor mid-run; verify no orphaned agent processes and no silent continued spend |
| Local credential compliance risk | Agent adapter seam phase | Document and test both the shelled-CLI path and the `ANTHROPIC_API_KEY` path; confirm neither intercepts/replays OAuth tokens |
| Agent-authored board spam | Agent-authored backlog phase | Confirm agent-created items are unreachable as "active" without passing through a human triage step |
| Local-first schema forecloses sync | Foundational data-model phase | Schema review checklist: every mutation is an event append; every field has a real actor; ordering uses logical/hybrid clocks, not wall-clock only |
| Open-core boundary drift | Architecture-defining phase, re-verified each milestone | New-feature classification against the published OSS/paid boundary test at each planning cycle |
| Supervisor cwd drift into worker worktree | Worktree orchestration core | Structural check (lint/test) that supervisor code never performs bare-relative-path git ops |
| Streaming backpressure / hung prompts | Process supervision phase | Fleet-scale streaming load test; explicit idle-timeout test with a deliberately-hung interactive subprocess |
| Desktop distribution friction | Distribution/packaging phase | Install and run the signed, notarized build on a genuinely clean, untrusted machine before any public release |

## Sources

- [AI Agent Pull Requests on GitHub: Frequency, Structure, and Merge Conflict Rates (arXiv)](https://arxiv.org/html/2607.04697v2) — MEDIUM confidence, academic dataset analysis (27.67% conflict rate, per-agent breakdown)
- [AgenticFlict: A Large-Scale Dataset of Merge Conflicts in AI Coding Agent PRs (arXiv)](https://arxiv.org/pdf/2604.03551) — MEDIUM confidence (19.8% identical-instance textual conflict rate)
- [Agent isolation: worktree — parallel agents lose work due to git lock contention + auto-cleanup, anthropics/claude-code#55724](https://github.com/anthropics/claude-code/issues/55724) — HIGH confidence, primary-source filed issue with reproduced failure data (8/13 agents failed at scale)
- [Common Git Worktree Mistakes and How to Fix Them (BSWEN)](https://docs.bswen.com/blog/2026-03-30-git-worktree-troubleshooting/) — LOW-MEDIUM confidence, practitioner writeup
- [git-worktree(1) Manual Page](https://git-scm.com/docs/git-worktree) — HIGH confidence, official docs
- [What Is Context Rot in AI Agents and How Do You Fix It? (MindStudio)](https://www.mindstudio.ai/blog/what-is-context-rot-ai-agents-how-to-fix) — LOW-MEDIUM confidence, vendor blog, cross-checked across multiple independent posts on the same phenomenon
- [Context Rot: Why LLMs Degrade as Context Grows (Morph)](https://www.morphllm.com/context-rot) — LOW-MEDIUM confidence
- [The token bill came due: how runaway agents blow your AI budget (TrustGate AI)](https://www.trustgateai.io/blog/token-bill-runaway-agents) — LOW confidence, vendor blog (cited $47k/11-day runaway-loop example — treat as illustrative, not verified)
- [Two Multi-Account Claude Code Architectures: One Anthropic Accepts, One They Ban (DEV Community)](https://dev.to/vainamoinen/two-multi-account-claude-code-architectures-one-anthropic-accepts-one-they-ban-2om7) — LOW-MEDIUM confidence, practitioner analysis, cross-checked against Anthropic's own docs
- [Legal and compliance — Claude Code Docs](https://code.claude.com/docs/en/legal-and-compliance) — HIGH confidence, official docs
- [Anthropic officially bans using subscription authentication for third-party Claude use (AlternativeTo News)](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use) — MEDIUM confidence, news reporting on policy change
- [AI Agent Sprawl: Why Ungoverned Agent Fleets Are Your Next Security Crisis (Cordum)](https://cordum.io/blog/ai-agent-sprawl-management) — LOW confidence, vendor blog
- [AI Backlog Grooming: How Engineering Teams Cut Triage Time (Augment Code)](https://www.augmentcode.com/guides/ai-backlog-grooming) — LOW confidence, vendor blog (70-85% duplicate-detection accuracy figure — treat as directional)
- [Local-First Software: Principles, Patterns, and Technologies](https://wal.sh/research/local-first) — LOW-MEDIUM confidence
- [Using CRDTs + Sync as a Database (Patrick Jackson)](https://jackson.dev/post/crdts_as_database/) — LOW-MEDIUM confidence, practitioner writeup ("we CRDT'd our entire database" failure mode)
- [Open Core (OCV Handbook)](https://handbook.opencoreventures.com/how-we-work/open-core) — MEDIUM confidence, VC-backed open-core practitioner handbook
- [Open Source Business Models: Open Core vs Crippled Core (Peter Zaitsev)](https://peterzaitsev.com/open-source-business-models-open-core-vs-crippled-core/) — MEDIUM confidence, well-known OSS-business practitioner (Percona founder)
- [Linear – Migration guide](https://linear.app/switch/migration-guide) — HIGH confidence, official docs
- [Is Linear Worth It? Honest Review for Engineering Teams (2026)](https://get-alfred.ai/blog/is-linear-worth-it) — LOW confidence, vendor/review blog (latency figures — directional only)
- [How to Notarize & Publish an Electron App on macOS (2026) (Forasoft)](https://www.forasoft.com/blog/article/the-pain-of-publishing-electron-apps-on-macos-303) — LOW-MEDIUM confidence, practitioner writeup, cross-checked against Electron/Tauri official docs
- [macOS Code Signing — Tauri](https://v2.tauri.app/distribute/sign/macos/) — HIGH confidence, official docs
- [Code Signing — Electron](https://www.electronjs.org/docs/latest/tutorial/code-signing) — HIGH confidence, official docs
- [Kill process on exit, tauri-apps/tauri Discussion #3273](https://github.com/orgs/tauri-apps/discussions/3273) — MEDIUM confidence, primary-source maintainer/community discussion
- [Spawning and unreferencing a child process prevents electron from exiting, electron/electron#34808](https://github.com/electron/electron/issues/34808) — MEDIUM-HIGH confidence, primary-source filed issue
- [Agent hangs on interactive shell prompts, google-gemini/gemini-cli#10909](https://github.com/google-gemini/gemini-cli/issues/10909) — MEDIUM-HIGH confidence, primary-source filed issue (cross-domain, same class of failure applies to any agent CLI)
- [How Do I Keep AI Coding Agent Changes Small Enough to Review (slaptijack)](https://slaptijack.com/articles/how-to-keep-ai-coding-agent-changes-small-enough-to-review.html) / related PreToolUse-hook case study — LOW-MEDIUM confidence, practitioner writeup (35%→4% scope-violation reduction figure — treat as illustrative single-source data point, not a benchmark)
- [Git Worktree with Submodules — Setup & Troubleshooting](https://www.gitworktree.org/guides/submodules) — LOW-MEDIUM confidence, practitioner reference site

---
*Pitfalls research for: Flywheel (ADE — multi-agent desktop supervisor with agent-writable board)*
*Researched: 2026-09-08*
