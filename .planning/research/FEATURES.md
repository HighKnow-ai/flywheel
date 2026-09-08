# Feature Research: Agentic Development Environment (Flywheel)

**Domain:** Agentic Development Environment — fleet supervision of parallel AI coding agents, fused with an agent-writable project board
**Researched:** 2026-09-08
**Confidence:** MEDIUM (web-search-derived competitor claims, cross-checked across 2+ independent sources per product where possible; this market shipped and reshipped features through 2025-2026 faster than documentation settles — treat specific version/feature claims as directional, verify against the live product before committing to a UX pattern)

## Context: the two families this product sits between

**Family A — parallel-agent desktop tools (2025-2026 vintage, high churn).** Conductor (Melty Labs, macOS, $22M Series A), Crystal (stravu — **deprecated Feb 2026, replaced by Nimbalyst**), Vibe Kanban (**sunsetting**, continuing as community OSS), Terragon/Terry (**shut down**), Sculptor (Imbue, container-isolated, open source), Devin Desktop (Cognition, ACP-based multi-agent dashboard), Cursor Background Agents (cloud VM + Slack), Warp 2.0 / Oz (terminal-native ADE + cloud orchestrator), Factory Droid (terminal-native, "Missions" multi-agent), Amp (Sourcegraph, auto-spawned subagents), OpenHands (open-source autonomous agent, Docker-sandboxed), Charlie Labs (always-on "daemons" across Slack/Linear/GitHub), AgentsRoom (multi-project, multi-agent desktop + mobile cockpit — the closest existing analog to Flywheel's fleet-supervision ambitions). **Three of the eight tools most commonly cited in this space (Crystal, Vibe Kanban, Terragon) have already shut down or pivoted within the last ~6 months of research date.** This is a land-grab market with no entrenched incumbent and real mortality risk — a signal that supervision UX (not agent capability) is still unsolved and is where products are dying, not the differentiator they hoped for.

**Family B — modern issue trackers.** Linear (the UX benchmark), Jira (the incumbent everyone complains about), Plane.so (open-source Linear/Jira alternative), Height (sunset by Linear acquihire, referenced for pattern history), Shortcut, GitHub Projects, Notion.

Flywheel's bet is that neither family alone is sufficient: Family A tools have no durable work model (state lives in ephemeral chat/kanban-lite columns, not a real issue tracker), and Family B tools have no agent execution loop (the board is a record of intent, never a trigger of work). AgentsRoom is the closest thing to proof this gap is real — it already does multi-project/multi-agent status + notifications + a persistent markdown memory file, but that memory file is exactly the un-structured "chat blob" Flywheel's Core Value explicitly rejects.

---

## 1. Fleet Supervision

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Per-agent live status (running / blocked / done / error) surfaced in one list | Table stakes | S | Every tool in Family A has this in some form (Conductor's workspace list, Crystal's colored rail, AgentsRoom's per-project counters). Baseline is a colored dot + one-line status text. |
| Cross-project fleet view ("all agents, everywhere") | Differentiator | M | Only AgentsRoom does this today among Family A tools; Conductor, Crystal, Vibe Kanban, Sculptor are single-repo/single-workspace scoped. This is Flywheel's stated wedge (PROJECT.md: "one view answering what needs me") and it is **not yet table stakes in the market** — it is a genuine gap, but a gap AgentsRoom is actively closing, so treat as time-boxed differentiator, not permanent moat. |
| "Needs you" queue — a single filtered view of agents blocked on human input, separate from "still running" | Differentiator (should be table stakes; market hasn't converged) | S–M | Community explicitly asking for this on Claude Code's own GitHub issues ("no way to know which session is blocked... a dedicated event for waiting-on-user would be much more precise", issue #36885, still open). Crystal/crystl solved it locally with a color-changed rail item + OS notification. This is cheap to build and disproportionately valuable — build it first. |
| OS-level notification when an agent needs input or finishes | Table stakes | S | Crystal, Cursor (via Slack), AgentsRoom, Warp Oz all do this. Minimum bar: native OS notification on state transition to "blocked" or "done." |
| Live output tailing (streamed agent transcript, not just a status dot) | Table stakes | S–M | Universal across Family A — Conductor, Crystal, Sculptor, Warp all show a live terminal/chat pane per agent. Users will not trust a black box; they need to glance at *why* it's blocked. |
| Cost/token visibility per task/agent | Differentiator, trending toward table stakes | S | Not yet universal in Family A UIs (most surface it faintly if at all — this is one of the weaker areas across every tool researched). General agent-observability tooling (Datadog, Langfuse, Helicone) treats per-agent/per-task token attribution as an unsolved "emerging requirement," not solved practice. Cheap to add (Claude Code already reports token counts) and directly answers "is this task about to blow my budget" — worth shipping in v1 given loop-engineering users run many tasks per day. |
| Remote/mobile push notification + reply-from-notification when away from desk | Differentiator, but see flag below | M | Multiple third-party hacks exist specifically because official tools don't cover it well: claude-push (ntfy.sh + PermissionRequest hooks), CodeAgent Mobile, Claude Remote, AgentsRoom's native mobile app. The existence of a whole mini-ecosystem of bolt-on tools solving this for Claude Code alone is a strong signal of latent demand. **Flagged**: PROJECT.md defers mobile/web entirely to the paid cloud layer. See "Deferred-but-load-bearing" section below — a minimal local-network notification (not a full mobile app) may still be required for the daily-use test if the user ever leaves the machine mid-task, which loop engineering explicitly invites. |
| Aggregate "fleet health" dashboard (throughput, error rate, avg time-to-done trends) | Anti-feature for v1 | — | This is the sprint-burndown/portfolio-reporting instinct PROJECT.md explicitly excludes ("Rebuilding general-purpose PM features that do not serve agents"). Nothing in Family A ships this; it's a Family B enterprise habit that doesn't serve a solo loop-engineering user. Revisit only if/when team collaboration ships. |
| Full agent activity feed / audit log across the fleet (append-only) | Table stakes (infrastructure, not necessarily surfaced UI) | M | Directly required by PROJECT.md's "durable append-only event log" architectural constraint. Warp's Oz explicitly ships "full audit recording" for cloud background agents — this is expected once agents run somewhat unsupervised. Build the log now even if the UI on top of it is minimal in v1. |

**What existing tools get wrong here:** almost every Family A tool is scoped to one repository or one workspace at a time — multi-project is either absent or (AgentsRoom) bolted on as folder-grouping rather than a first-class model. None of them tie "needs you" back to a *structured reason* (a specific acceptance-criterion ambiguity, a specific permission prompt, a specific test failure) — it's always "check the transcript to find out why," which doesn't scale past a handful of agents. A structured board item with explicit blocking-reason metadata is where Flywheel can beat every Family A incumbent mechanically, not just conceptually.

---

## 2. Worktree & Branch Management

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| One isolated git worktree per unit of work, auto-created | Table stakes | S | Universal: Conductor, Crystal, Sculptor, Claude Code's own `--worktree` flag (native since Claude Code v2.1.49, Feb 2026). This is the baseline mechanic of the entire product category now — not differentiating, just required. |
| Auto-cleanup of worktrees on task completion/abandonment (no orphaned directories) | Table stakes | S | Crystal did this ("automatic worktree cleanup when sessions are deleted"); native Claude Code does too if the worktree is clean. Community guidance is unanimous that manual `rm -rf` of worktrees causes git corruption — must go through `git worktree remove`/`prune`. Cheap, and its absence is a fast trust-breaker (a `.git` that silently rots). |
| Fixed worktree→integration-branch→main topology (not agent/planner-chosen) | Differentiator (architectural, not UX) | M | No competitor product enforces a fixed topology — Conductor/Crystal/Sculptor all let one worktree map directly to a feature branch with no intermediate integration branch, meaning N parallel agents on one epic race independent PRs into main. PROJECT.md's decision to interpose an epic-integration branch is a genuine point of difference: it turns "N agents, N reviews" into "N agents, one epic-level review." Validate this doesn't just relocate merge-conflict pain rather than remove it (see below). |
| Pre-emptive file-overlap / merge-conflict detection *before* two agents both touch a file | Differentiator | M–L | Emerging pattern, not yet standard: the OSS tool `clash` explicitly does pairwise `git merge-tree` conflict-matrix checks across worktrees; GSD-core's own `execute-phase.md` already does declared-file-set overlap checking with a downgrade-to-sequential guard. This is the single most technically differentiating piece of the worktree story — most Family A tools (Conductor, Crystal, Sculptor) discover conflicts only at merge time, after both agents have already run. Building the guard *before* dispatch (using declared file-sets from planning, not just post-hoc diffing) is materially better than every shipping competitor. |
| Diff review UI per worktree (syntax-highlighted, commit-level) | Table stakes | S–M | Crystal had this ("diff visualization with syntax highlighting, commit tracking"); Vibe Kanban has "inline diff commenting" and device-emulated browser previews. Non-negotiable — a developer will not trust a merge they can't see. |
| One-click PR creation from a worktree/task | Table stakes | S | Universal: Conductor, Vibe Kanban, Terragon (RIP), Cursor Background Agents all auto-open a PR on completion with an AI-generated description. |
| Sync/pull agent's container changes back into local repo for manual testing ("spotlight testing" / "pairing mode") | Differentiator | M | Conductor's "Spotlight testing" and Sculptor's "Pairing Mode" both solve the same real pain (agent runs in isolation, but the human wants to run/debug it locally without a full merge). Worth having but is UX polish, not core-loop-critical for v1. |
| Multi-model / multi-agent race on the same task (run two backends, compare) | Anti-feature for v1 | — | Conductor's "multi-model mode" is real and liked, but it requires >1 agent backend, which PROJECT.md explicitly defers ("only the adapter seam ships in v1, not a second implementation"). Correctly out of scope; do not let it creep in via "just let people run Claude twice with different prompts" — that's a different feature (comparison-of-approaches) from fleet supervision and adds UI surface for zero v1 value. |
| Arbitrary agent-chosen worktree topology / branching strategy | Anti-feature | — | Every competitor that lets the topology be improvised (which is all of them) ends up with ad hoc branch sprawl and no consistent review unit. PROJECT.md's fixed topology is a deliberate rejection of this; keep it fixed. |

**Where Family A tools fall down:** conflict handling is almost universally reactive (discover at merge/PR time) rather than proactive (prevent dispatch of two agents onto overlapping files). Cleanup of stale worktrees is inconsistent — several tools (per community complaints) leave orphaned directories that require manual `git worktree prune`. None of the researched tools have an intermediate integration-branch concept; they go straight from task-worktree to main-targeted PR, which doesn't scale past a handful of concurrent agents on the same epic.

---

## 3. Agent Session Lifecycle

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Start a fresh agent session against a task | Table stakes | S | Baseline for every tool researched. |
| Resume an existing session (reconnect to a running/paused agent) | Table stakes | S–M | Devin Desktop, Warp, Conductor all support reattaching to a background session. Users expect to be able to walk away and come back. |
| Manual context reset (`/clear`) with explicit re-briefing | Table stakes | S | Native to Claude Code; the entire premise of Flywheel's Core Value depends on this being *cheap and safe*, which requires the board (not the transcript) to hold the state that survives the clear. |
| Automatic context compaction (`/compact`) as a fallback when a session runs long | Table stakes (if using Claude Code as backend) | S | Anthropic's own guidance: compact at ~60% context, not 90%; sessions should target <120k input tokens. This is inherited "for free" from the Claude Code SDK/CLI — Flywheel doesn't need to reimplement it, but does need to *not fight it* (e.g., don't let the board-reconstitution prompt itself become so large it forces compaction immediately). |
| Structured session-end summary written back to the board (not just a transcript) | Differentiator — this is the core of Flywheel's thesis | M | **No competitor product does this today.** Every researched tool (Devin, Cursor, Conductor, Crystal, Sculptor, Warp) treats the session transcript itself as the durable record, with "handoff" left to manual practice ("dump what you need to a markdown file, run /clear, then point the new session at that file" — current best-practice guidance is literally a manual workaround). AgentsRoom's "persistent memory markdown file" is the closest attempt at automating this and it is still an unstructured blob, exactly the anti-pattern Flywheel's Core Value rejects. This is the single highest-leverage differentiator in the whole research: making every session's exit produce a structured update to acceptance criteria / next-steps / decisions on the *board item*, not a file. |
| Context reconstitution: new session auto-primed from board item + acceptance criteria + prior summaries + current diff | Differentiator — the "wedge" per PROJECT.md | L | Directly implements PROJECT.md's stated differentiator. Nothing in the market does this; the closest analog (AgentsRoom's markdown memory) is unstructured and per-project rather than per-task. This *requires* feature 3's structured summaries and the board's schema to exist first — high dependency chain, high payoff. |
| Manual interrupt/redirect of a running agent mid-task | Table stakes | S | Claude Code supports this natively (Escape/interject); Warp and Cursor both support steering a running agent. Users will not tolerate "wait for it to finish before you can correct it." |
| Session cost/duration shown at hand-off (so the human knows what a `/clear` "cost") | Differentiator | S | Nobody surfaces this well today (see fleet-level cost visibility gap above); pairs naturally with the token-visibility feature in section 1. |
| Persisted raw transcript archive (for audit/debugging, not for context) | Table stakes (infra) | S | Cheap, low-risk, and useful when the summary is wrong — keep the raw transcript around even though it's not the source of truth. Every tool researched keeps this by default (it's just log storage). |
| Auto-summarization triggered on a timer/heuristic without user awareness | Anti-feature | — | Blind auto-compact silently drops detail per Anthropic's own documented risk ("a blind compact can drop detail you needed"). Flywheel should make summary-writing an explicit, board-visible event tied to session end, not a silent background heuristic the user can't inspect or correct. |

**How existing tools handle context exhaustion today:** almost entirely via the underlying CLI's own compaction (Claude Code's `/compact`), with "best practice" being a manual, disciplined habit of the human writing a handoff markdown file before clearing. This is exactly the gap-in-practice Flywheel's board-as-context-reconstitution thesis is designed to close — it is validated by the fact that the current advice across every source researched is "do this by hand, carefully," not "the tool does this for you."

---

## 4. Board Features

**What Linear does mechanically that Jira doesn't (verified across multiple 2026 comparison sources):**
- Sub-50ms perceived navigation (local-first / optimistic UI architecture) vs. Jira's 1.5–3s page transitions even after Atlassian's own performance work.
- Keyboard shortcuts as the *primary* interaction model (create issue, assign, set status, move — all keyboard-reachable), not a bolted-on accessibility layer over a mouse-first UI.
- A single opinionated hierarchy (Team → Roadmap → Project → Cycle → Issue → Sub-issue) instead of Jira's fully-configurable-and-therefore-unbounded field/workflow/scheme system.
- Triage as a first-class inbox (new issues land in a review queue, not straight into the backlog), preventing backlog rot.
- Cycles (time-boxed, auto-carry-forward) replace manual sprint ceremony/configuration.

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Epics → Tasks → Issues hierarchy (2-3 levels, fixed) | Table stakes | M | PROJECT.md already commits to this. Keep it fixed-depth like Linear (Project→Issue→Sub-issue), not infinitely nestable like Jira — infinite nesting is exactly the "too flexible... a mess" complaint developers level at Jira. |
| Status/workflow (fixed set: e.g. Backlog/Todo/In Progress/In Review/Done, not user-configurable state machines) | Table stakes | S | Linear ships an opinionated default workflow; Jira's fully custom workflow schemes are the #1 cited source of "why is this so slow and confusing." Do not build a workflow editor for v1. |
| Assignment (including agent-as-assignee, not just human) | Table stakes, but the agent-assignee part is a genuine extension | S | Every tracker supports human assignment; none of the researched Family B trackers natively model "an AI agent is the assignee and is expected to change status itself" — this is a small schema extension (multi-actor identity, already an architectural constraint in PROJECT.md) but a real point of departure from Linear/Jira/Plane's assumption that assignees are humans who manually drag cards. |
| Ordering/prioritization (drag-to-reorder backlog, priority field) | Table stakes | S | Baseline in every tracker researched. |
| Filtering/search (saved views, by status/assignee/label) | Table stakes | S–M | Plane's "custom filters that can be saved and shared" is representative baseline; do not need Jira's full JQL-equivalent query language for v1. |
| Keyboard-driven navigation (create/edit/move without leaving keyboard) | Table stakes for the target user (developer), differentiator vs. Jira specifically | M | This is mechanically *why* Linear feels good, per every comparison source researched. Given Flywheel's user is explicitly "developers running loop engineering," this is non-negotiable, not optional polish — skipping it reproduces the exact Jira complaint the target user is fleeing. |
| Comments/activity log per item (including agent-authored comments) | Table stakes | S | Standard in every tracker; the agent-authored variant (agent posts progress notes, not just a human) is an extension but a small one given the append-only event log is already an architectural constraint. |
| Sprint burndown, velocity charts, portfolio/time-tracking reporting | Anti-feature | — | PROJECT.md explicitly excludes this ("Rebuilding general-purpose PM features that do not serve agents (time tracking, sprint burndown, portfolio reporting)"). Confirmed by research: this is exactly the class of feature that makes Jira feel heavy and doesn't map to a solo/small-team loop-engineering workflow. |
| Fully configurable custom fields / workflow schemes per project | Anti-feature | — | The single most-cited mechanical reason Jira feels bad ("too flexible... an illusion of control that slows developers down"). An agent-native board benefits even more from a fixed schema than a human-only one does, because agents need a predictable, parseable structure to read/write reliably — configurability is actively hostile to the agent-authorship use case, not just UX debt. |
| Multi-user roles/permissions, presence indicators | Anti-feature for v1 (explicitly deferred) | — | PROJECT.md defers team collaboration to paid cloud but requires multi-actor identity to already exist in the schema — build the schema field, do not build the UI/permission-enforcement. |
| Cycles/sprints as a time-boxed planning construct | Differentiator (optional for v1) | M | Genuinely useful (Linear's Cycles auto-roll unfinished work) but not required for the daily-use test — a loop-engineering user draining a backlog continuously may not need sprint cadence at all. Candidate for v1.x, not v1. |

**What's genuinely table stakes vs. enterprise bloat, mechanically:** table stakes = fast (sub-100ms perceived), keyboard-first, opinionated fixed hierarchy and workflow, good search/filter, comments/activity. Enterprise bloat = configurable workflow schemes, configurable field schemas, time tracking, burndown/velocity reporting, granular permission matrices. The dividing line is *configurability* — every Jira complaint sourced above traces back to "too many options," and every Linear compliment traces back to "one good opinionated path." Flywheel should copy Linear's rigidity, not Jira's flexibility, and should copy it *more* aggressively than Linear does, because the primary board consumer is an agent that needs a predictable schema to parse and write, not a human who might want customization.

---

## 5. Agent↔Board Interaction (the differentiating area)

This is confirmed by research to be **essentially unoccupied market space**. No product surveyed does the full loop PROJECT.md describes (Socratic epic shaping → agent-authored backlog → bidirectional board mutation as the context-reconstitution substrate). The closest partial analogs:

| Existing partial analog | What it does | Gap vs. Flywheel's v1 scope |
|---|---|---|
| Devin's Linear/Jira integration + confidence scoring | Scores existing issues (green/yellow/red) for likely success *before* starting a session; can batch-score a whole backlog without spending agent time. Devin also asks clarifying questions when confidence is low. | This is board→agent (agent reads/scores issues) and a limited agent→human (asks questions), not agent→board authorship. Devin does not write new issues back or restructure an epic. |
| Charlie Labs "daemons" | Always-on agents that triage bugs, do dependency updates, and produce "artifacts that fit into real workflows (PRs, issues, investigation notes)" across GitHub/Linear/Slack, without being re-prompted each time. | Genuinely does propose/file issues autonomously — closest real-world precedent for "agent-authored backlog." But it's reactive/maintenance-scoped (bug triage, dep bumps), not epic-shaping or Socratic dialogue with a human. |
| Generic "Socratic requirements" prompting patterns (multiple 2025-2026 skills/tools, e.g. "deep-interview," various Claude Code "ask user question tool" patterns) | Confirms the *pattern* (LLM asks clarifying questions, challenges framing, surfaces hidden assumptions before executing) is established practice at the prompt-engineering level. | None of these are wired to a persistent board schema — they produce a spec document or a single session's plan, not epics/tasks that live on and get mutated by later agent runs. This is exactly GSD-core's own discuss/research/plan pattern (cited in PROJECT.md) applied to files, not yet to a live board. |
| Agentic project-management vendors (2026 marketing-heavy category: "agents that auto-create tasks from CRM/support signals, rebalance workload, cluster feedback into backlog items") | Confirms the *category concept* ("agent proposes backlog items") is a live 2026 trend, generally aimed at PM/ops teams reacting to external signals (customer feedback, support tickets). | These are about *external* signal ingestion (support tickets → backlog), not about a coding agent proposing new engineering tasks from what it discovers *while executing other tasks* — a materially different and narrower (more tractable) problem than what these vendors are solving. |

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Socratic epic authoring: agent challenges/questions the human while an epic is shaped, writes structured board output | Differentiator, in-scope per PROJECT.md | M–L | No shipping competitor does this against a live board (closest is prompt-level "ask clarifying questions" patterns and GSD-core's own file-based discuss/plan phases). This is a genuine wedge if executed well; the risk is not technical feasibility (the pattern is well-established at the conversation level) but making the *output* land as clean, parseable board structure rather than another wall of text. |
| Agent-authored backlog: agent proposes new tasks/issues/epics from what it learns mid-execution | Differentiator, in-scope per PROJECT.md | M | Charlie Labs' daemons prove this is viable in production for a narrower (maintenance-triage) scope. Extending it to "any executing agent can propose a new board item" is a natural generalization; the main design question is proposal *ceremony* — auto-file vs. propose-then-human-triages (see below). |
| Human triage queue for agent-proposed items (distinct from "needs you" execution queue) | Table stakes once agent-authorship exists | S | PROJECT.md explicitly states "the user triages them" — this must be a separate, filterable queue from the "agent blocked, needs input" queue in section 1, since triaging proposed work and unblocking running work are different cognitive modes. Cheap to build once the schema exists; skipping it means proposed items either get lost in the backlog (Linear's stated failure mode without a Triage inbox) or auto-pollute the board. |
| Agent updates status / attaches artifacts (diffs, test output, screenshots) to a board item as it works | Table stakes given the board-as-source-of-truth premise | S–M | Vibe Kanban already does the status-update half ("issue statuses updated automatically when coding agents start working and when PRs are created/merged") — this part of the feature is proven, low-risk, and should be considered baseline, not a stretch differentiator. |
| Fully autonomous board mutation with no human approval step (agent silently creates/closes/reprioritizes issues) | Anti-feature | — | Every partial analog researched (Devin, Charlie) keeps a human review step for anything beyond routine triage/maintenance work; full autonomy over prioritization is not what any production tool does today, and it directly conflicts with PROJECT.md's "the user triages them." Auto-file into a pending/proposed state, never auto-promote to active backlog. |
| Agent votes on / re-prioritizes existing backlog items unprompted | Anti-feature for v1 | — | This is the "agentic PM" vendor pattern (auto-rebalancing priority from external signals) — a different, riskier trust boundary than an agent proposing *new* items from its own work. Nothing in PROJECT.md's v1 scope calls for this; treat as clearly out of scope, not just deferred. |

**What "when it works" looks like, synthesized from the closest analogs:** Charlie's daemons show that agent-authored items land well when scoped narrowly (a specific PR, a specific investigation) and routed into the *existing* human workflow (GitHub issue, Linear ticket) rather than a novel inbox the human has to learn. Devin's confidence-scoring shows that pairing agent output with an explicit, visible confidence/uncertainty signal builds trust faster than silent autonomy. Combined, the recipe for Flywheel: agent-proposed board items should (a) be scoped to a concrete discovery, not vague, (b) land in a clearly separate proposed/pending lane, (c) carry a confidence or rationale note, and (d) never silently become active work.

---

## 6. Review & Merge

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Per-task diff review UI | Table stakes | S–M | Covered in section 2; repeated here because review-at-scale starts from single-diff review being good. |
| One-click PR creation with AI-generated description | Table stakes | S | Universal across Family A (Conductor, Vibe Kanban, Cursor, Terragon). |
| CI/test gating before merge is even offered as an option | Table stakes | M | "Quality gate" pattern (lint, type-check, security scan, test execution, single pass/fail) is now standard guidance across the AI-code-review tooling researched (Codacy, Shiplight, Autonoma, TestMu). Do not let an agent's own self-report of "tests pass" be the only gate — wire to the actual CI/test runner output. |
| Explicit acceptance-criteria checklist per task, checked (by agent or human) before marking done | Differentiator, and directly required by PROJECT.md's Core Value ("real acceptance criteria — never a chat blob") | M | Nothing in Family A ties review back to a structured acceptance-criteria list; PR descriptions are free text. This is a natural extension of the board schema and reinforces the Core Value mechanically, not just narratively. |
| Batch approval across multiple ready-to-merge tasks (approve N diffs in one motion when they're low-risk) | Differentiator | M | No Family A tool researched does this well; closest is Graphite's stack-aware merge queue (batches and tests multiple *human* PRs in parallel) — a pattern worth borrowing for agent-produced PRs across an epic once several sibling tasks land around the same time. Genuine v1.x candidate: valuable at fleet scale, but not required to clear the "stop using a bare terminal" bar with a handful of concurrent agents. |
| AI-assisted review comment/triage on the agent's own diff (bug-catcher style) | Differentiator | M–L | Devin Review (red/yellow/gray severity-tagged issues + interactive chat on the diff) and Graphite Agent (act-on-feedback loop) are the state of the art here. High value but high complexity, and arguably redundant in v1 given the *agent that wrote the diff* can already be asked to self-review before marking done — treat as v1.x, not v1. |
| Per-epic integration-branch review (one PR/review surface per epic, not one per task) | Differentiator (flows from the fixed topology decision in section 2) | M | Nothing in Family A does this since none of them have an integration-branch concept. This is where the fixed worktree topology pays off directly in review UX — the human reviews one coherent epic-level diff instead of stitching together N task-level diffs mentally. |
| Merge queue (auto-sequence and re-test multiple ready PRs) | Anti-feature for v1 | — | Graphite's merge queue is aimed at team-scale PR throughput; a solo loop-engineering user reviewing their own board doesn't need queue automation yet. Revisit only when team collaboration ships. |

---

## 7. Human-in-the-Loop Gating

| Feature | Category | Complexity | Notes |
|---|---|---|---|
| Tiered permission model (ask-every-time / auto-accept-edits / plan-only / full-auto) | Table stakes (inherited from Claude Code) | S | Claude Code already ships this (default/plan/auto-accept/bypass, cycled via Shift+Tab). Flywheel doesn't need to reinvent it — needs to surface *which mode each running agent is in* at the fleet level, since that's currently invisible once you have more than one session open. |
| Interrupt/redirect a running agent without killing the session | Table stakes | S | Native to Claude Code; must be exposed through Flywheel's supervisory UI per-agent, not just in a focused terminal. |
| Explicit approval gate on destructive/high-risk actions regardless of global mode (e.g. force-push, delete branch, `rm -rf`) | Table stakes | S–M | Community consensus (multiple sources) treats blanket-approving all commands as risky; a sane default retains hard gates on genuinely destructive ops even in auto-accept mode. Cheap safety net, high trust payoff. |
| Local notification the instant an agent needs a permission decision | Table stakes | S | Same feature as the "needs you" queue in section 1 — the gating event and the fleet-visibility event are the same underlying signal, viewed from two features. |
| Remote (off-machine) approve/deny of a permission prompt | Differentiator, deferred-but-flagged | M | See the "Deferred-but-load-bearing" section below — third-party tools (claude-push, CodeAgent Mobile) exist *purely* to solve this for Claude Code today, which is a strong signal it matters, but PROJECT.md correctly scopes full mobile to the paid cloud layer. |
| Configurable per-project / per-task default permission profile (e.g. this task-type is always auto-accept-edits) | Differentiator | S | Reduces prompt fatigue at fleet scale — with 5+ concurrent agents, per-prompt approval doesn't scale, but blanket bypass is unsafe. A per-task or per-epic default profile, set once, is a reasonable middle ground; nothing in Family A does this explicitly today (each session's mode is set ad hoc). |
| Silent full autonomy as the only mode (no gating available) | Anti-feature | — | Contradicts both the "human triages agent-authored items" requirement and general safety practice; also contradicts the local-first credentials trust model PROJECT.md commits to (the whole point of running locally is that the developer stays in control). |

---

## Feature Dependencies

```
Board schema (epics/tasks/issues, fixed hierarchy, statuses)
    └──requires──> nothing (foundational, build first)

Worktree lifecycle (create/cleanup, fixed topology)
    └──requires──> nothing (foundational, build first)

Agent session start/resume/interrupt
    └──requires──> Worktree lifecycle (a session needs a worktree to run in)

Structured session-end summary written to board item
    └──requires──> Board schema
    └──requires──> Agent session lifecycle (something must trigger "session ended")

Context reconstitution (board-as-context-substrate — the core differentiator)
    └──requires──> Structured session-end summary
    └──requires──> Board schema (acceptance criteria, prior summaries fields)
    └──requires──> Agent session start/resume

"Needs you" queue / fleet supervision status surface
    └──requires──> Agent session lifecycle (state transitions to surface)
    └──enhances──> Human-in-the-loop gating (same underlying event)

Agent-authored backlog (agents propose board items)
    └──requires──> Board schema
    └──requires──> Human triage queue (proposed items must land somewhere reviewable)

Human triage queue for proposed items
    └──requires──> Board schema
    └──conflicts with──> auto-promoting proposed items to active backlog (anti-feature)

Socratic epic authoring
    └──requires──> Board schema (must write structured output, not prose)
    └──enhances──> Agent-authored backlog (same conversational pattern, different trigger point)

File-overlap / merge-conflict pre-flight guard
    └──requires──> Worktree lifecycle
    └──requires──> Planner-declared file-sets (an upstream planning capability, not itself a board feature)

Per-epic integration-branch review
    └──requires──> Fixed worktree topology (task → epic branch → main)
    └──enhances──> Review & merge diff UI

Cost/token visibility
    └──requires──> Agent session lifecycle (event stream to attribute tokens to)
    └──enhances──> Fleet supervision status surface

Cross-project fleet view
    └──requires──> Fleet supervision status surface (single-project version first)
    └──requires──> Multi-actor/multi-project schema support already present per PROJECT.md constraints
```

### Dependency notes

- **Everything in section 5 (agent↔board interaction) requires the board schema to exist and be stable first.** This is the highest-risk sequencing dependency in the whole roadmap: Socratic authoring and agent-authored backlog are both v1-scoped per PROJECT.md, but both are dead in the water without a working, parseable board schema shipping first. Do not attempt to build them concurrently with the schema.
- **Context reconstitution (the stated core differentiator) has the longest dependency chain** — board schema → session lifecycle → structured summaries → reconstitution. This is not a "quick win" feature; budget it as a late-but-critical-path item, not an early one.
- **The "needs you" queue and human-in-the-loop gating share one underlying event stream** (agent transitions to blocked/awaiting-input). Building them as two separate features risks divergent state; model it once.
- **Cross-project fleet view depends on getting single-project fleet supervision right first** — AgentsRoom's existence proves the cross-project view is buildable, but every other researched tool ships single-project first and generalizes later; there's no evidence multi-project-first is a viable build order.

---

## MVP Definition

### Launch With (v1) — mapped against PROJECT.md's Active requirements

- [ ] Board schema: epics/tasks/issues, fixed hierarchy, fixed status workflow — the store of record (Core Value)
- [ ] Worktree lifecycle: create on task start, fixed task→epic-integration-branch→main topology, auto-cleanup
- [ ] Agent session start/resume/interrupt against Claude Code, with structured session-end summary written to the board item
- [ ] Context reconstitution: new session primed from board item + acceptance criteria + prior summaries + current diff (this is the entire point of the product — cannot be deferred)
- [ ] Single-project fleet status view: per-agent state (running/blocked/done/error), live output tail, OS notification on state change
- [ ] "Needs you" filtered queue, separate from "still running"
- [ ] Socratic epic authoring: conversational shaping that writes structured epic/task output to the board
- [ ] Agent-authored backlog: agents propose items mid-execution into a distinct human-triage lane
- [ ] File-overlap pre-flight guard before dispatching parallel tasks
- [ ] Diff review UI per task + per-epic integration-branch review; one-click PR creation
- [ ] Tiered permission gating (inherited from Claude Code) with hard gates on destructive actions regardless of mode, surfaced per-agent in the fleet view
- [ ] Multi-actor identity field, append-only event log, generic trigger abstraction in the schema (architectural, not user-facing in v1, but must exist per PROJECT.md constraint)

### Add After Validation (v1.x)

- [ ] Cross-project fleet view (once single-project supervision is proven solid)
- [ ] Cost/token visibility per task and per fleet
- [ ] Batch approval across multiple ready-to-merge tasks
- [ ] AI-assisted review/bug-catcher on agent's own diffs
- [ ] Cycles/time-boxed planning construct
- [ ] Per-task/per-epic default permission profiles (reduce prompt fatigue as fleet width grows)
- [ ] Sync-back / "pairing mode" to test agent output locally before merge

### Future Consideration (v2+, per PROJECT.md Out of Scope)

- [ ] Scheduled automations (trigger abstraction ships in v1, actual schedule-as-trigger-source deferred)
- [ ] Team collaboration: multi-user boards, roles, presence
- [ ] Mobile/web surfaces and the secure relay
- [ ] Additional agent backends (Codex CLI, Gemini CLI) beyond the adapter seam
- [ ] Merge queue automation, sprint burndown/velocity/portfolio reporting (deliberately, permanently out — not just deferred)

---

## Deferred-but-load-bearing: flags for the roadmap

PROJECT.md defers mobile/web and team collaboration entirely, and that's correct for scope discipline. Two things surfaced in research are worth flagging as risks to the daily-use success criterion specifically, even though they must stay technically deferred:

1. **Off-machine notification-when-blocked.** The success criterion is "a full week of real work... without dropping back to a bare terminal" — it does not require the user to never leave the machine. Loop engineering (the stated usage pattern) explicitly implies dispatching several agents and stepping away. If an agent blocks on a permission prompt or a Socratic question while the user is away, and there's zero notification channel outside the desktop app, the realistic failure mode is the user *reflexively opens a terminal* on another device or just loses a day of fleet throughput waiting for a glance back at the screen — precisely the outcome v1 exists to prevent. This does **not** require a mobile app or the relay; even a local push (e.g., desktop-OS notification the user's phone can mirror via existing OS-level notification sync, or a minimal webhook to an existing channel like Slack/ntfy the user already has) closes most of the gap without touching the deferred mobile/relay architecture. Recommend: keep it explicitly out of v1 scope as *product surface*, but don't let the event stream that would drive it (state transition to blocked) be anything other than trivially wireable to an external notifier later — this is likely already covered by the append-only event log constraint, so the risk is probably already mitigated architecturally; flagging to confirm during requirements.
2. **Agent-authored-backlog triage queue ergonomics at fleet scale.** This is in-scope for v1, but research shows every competitive analog that does something similar (Charlie Labs' daemons) keeps the proposal volume low by scoping tightly (one PR, one investigation). If Flywheel's agents propose liberally across many concurrent tasks, the triage queue itself can become the new "unread inbox" problem Linear's Triage view was built to solve for humans — and there's no existing product precedent for triaging *agent-proposed* items at volume to borrow patterns from. Not a scope change, but worth an explicit UX decision early (rate-limit proposals per task? require a minimum-confidence bar? bundle same-epic proposals?) rather than letting it emerge by accident.

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---|---|---|---|
| Board schema (epics/tasks/issues, fixed) | HIGH | MEDIUM | P1 |
| Worktree lifecycle + fixed topology | HIGH | MEDIUM | P1 |
| Structured session-end summary + context reconstitution | HIGH | HIGH | P1 |
| Single-project fleet status + "needs you" queue | HIGH | LOW-MEDIUM | P1 |
| Socratic epic authoring | HIGH | MEDIUM-HIGH | P1 |
| Agent-authored backlog + triage lane | HIGH | MEDIUM | P1 |
| File-overlap pre-flight guard | MEDIUM-HIGH | MEDIUM | P1 |
| Diff review + per-epic PR + CI gating | HIGH | MEDIUM | P1 |
| Tiered permission gating (inherited) + destructive-action hard gates | HIGH | LOW-MEDIUM | P1 |
| Cross-project fleet view | MEDIUM (HIGH long-term) | MEDIUM | P2 |
| Cost/token visibility | MEDIUM | LOW | P2 |
| Batch approval across tasks | MEDIUM | MEDIUM | P2 |
| AI bug-catcher review | MEDIUM | MEDIUM-HIGH | P2 |
| Off-machine blocked-notification (minimal, non-mobile) | MEDIUM-HIGH for daily use | LOW | P2 (flagged) |
| Cycles/time-boxed planning | LOW-MEDIUM | MEDIUM | P3 |
| Merge queue automation | LOW (solo user) | MEDIUM | P3 |
| Custom workflow/field configurability | NEGATIVE (actively hostile to agent-authorship) | — | Do not build |

**Priority key:** P1 must ship for launch; P2 should ship soon after, once P1 is proven; P3 deferred until team/scale needs justify it.

## The MINIMUM feature set for daily use instead of a bare terminal

Concretely, to pass "Cyril runs a full week of real work from Flywheel without dropping back to a bare Claude Code terminal," the following must ALL be true simultaneously — this is not a checklist to pick-and-choose from, because each gap directly reproduces a reason to open a terminal:

1. **Starting work is not slower than a terminal.** Picking up a task and getting an agent running against it must be at least as fast as `cd` + `claude`. If board→task→session takes more clicks/latency than opening a terminal, the user reverts on day one. (Requires: board schema, worktree lifecycle, fast session start.)
2. **The user never has to manually reconstruct context after a `/clear`.** This is the whole thesis — if reconstitution is flaky or incomplete even once in a way that loses real state, the user will stop trusting `/clear` and start keeping long-lived terminal sessions instead, which defeats the product. (Requires: structured summaries, context reconstitution — the single highest-risk P1 item.)
3. **The user can tell, at a glance, which of N running agents needs them** — without opening each one's transcript. Without this, fleet supervision degrades into tab-cycling through terminals, which is strictly worse than one terminal. (Requires: fleet status view, "needs you" queue.)
4. **Reviewing and merging agent output is not slower than reviewing a terminal-produced diff.** Diff review + PR creation must match or beat `git diff` + `gh pr create` for speed, or the user will merge from the terminal even if the agent ran through Flywheel. (Requires: diff review UI, one-click PR.)
5. **Shaping new work (the Socratic epic flow) must feel better than typing a prompt into a terminal**, not just "structurally superior." If it's slower or more friction-laden than just describing the task in a chat prompt, the user bypasses it for anything that isn't already a well-formed epic. (Requires: Socratic authoring UX to be fast and low-friction, not just correct.)
6. **Parallel dispatch must not silently corrupt work.** One file-overlap collision that destroys a task's worth of agent output will make the user revert to running one agent at a time by hand, which is a terminal-equivalent workflow even if run inside Flywheel's UI. (Requires: file-overlap pre-flight guard.)
7. **The user must be able to safely leave an agent running and trust a gate/notification will catch anything requiring them**, or they'll default to babysitting single sessions in a terminal instead of trusting the fleet. (Requires: permission gating with hard destructive-action gates + the "needs you" notification.)

Everything else researched here (cross-project view, cost visibility, batch approval, cycles, AI bug-catching) is real value but is not on the critical path to the specific "week of daily use" bar — those features make Flywheel *better than* a terminal at scale; the seven above are what stop it from being *worse than* a terminal for the very first task.

## Competitor Feature Analysis

| Feature area | Conductor / Crystal / Sculptor (Family A, single-project) | AgentsRoom (closest fleet analog) | Linear (board UX benchmark) | Flywheel's approach |
|---|---|---|---|---|
| Multi-project fleet view | Absent (single workspace/repo) | Present — folders grouped by zone, per-project counters | N/A (not agent-scoped) | Build as differentiator, single-project first |
| Durable work model | None — chat/transcript is the record | Unstructured markdown memory file | Full structured issue tracker, human-authored only | Structured board, agent-writable — the wedge |
| Worktree topology | Flat: worktree → feature branch → main | Per-agent worktree/branch, no integration tier | N/A | Fixed: task → epic-integration branch → main |
| Conflict detection | Reactive, at merge/PR time | Not specified/reactive | N/A | Proactive pre-flight file-overlap guard |
| Session handoff | Manual (user writes their own handoff notes) | Persistent markdown file (unstructured) | N/A | Structured summary → board item (context reconstitution) |
| Agent proposes new work | Not present (Charlie Labs is the outlier, narrow-scoped) | Not present | N/A (humans only) | In-scope v1: agent-authored backlog with human triage |
| Board rigidity | N/A | N/A | Deliberately opinionated/fixed hierarchy and workflow | Match or exceed Linear's rigidity — agents need it more than humans do |

## Sources

- [Conductor by Melty Labs: Parallel AI Coding Agents in Practice](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/)
- [Run Claude Code with Git worktrees | Conductor Docs](https://www.conductor.build/docs/guides/git-worktrees/run-claude-code-with-git-worktrees)
- [GitHub - stravu/crystal (now Nimbalyst)](https://github.com/stravu/crystal)
- [Crystal: Multi-Session Claude Code Management | Nimbalyst](https://nimbalyst.com/blog/crystal-supercharge-your-development-with-multi-session-claude-code-management/)
- [Running Claude Code in the Background: A Workflow Guide · crystl](https://crystl.dev/blog/claude-code-background/)
- [Vibe Kanban - Orchestrate AI Coding Agents](https://vibekanban.com/)
- [Vibe Kanban Tool Review - Eleanor Berger](https://elite-ai-assisted-coding.dev/p/vibe-kanban-tool-review)
- [GitHub - terragon-labs/terragon-oss (shutdown notice)](https://github.com/terragon-labs/terragon-oss)
- [Era of Virtual Employees: Terragon, Conductor, Cursor](https://www.thetoolnerd.com/p/era-of-virtual-employees-running)
- [Cognition launches Devin Desktop - Tech Edition](https://www.techedt.com/cognition-launches-devin-desktop-for-managing-ai-coding-agents-across-engineering-workflows)
- [Devin Review - Devin Docs](https://docs.devin.ai/work-with-devin/devin-review)
- [Devin's 2025 Performance Review | Cognition](https://cognition.ai/blog/devin-annual-performance-review-2025)
- [Cursor & Slack Integration | Slack Marketplace](https://slack.com/marketplace/A08SKDT6QUW-cursor)
- [Cursor background agents in Slack changed my workflow | Swizec Teller](https://swizec.com/blog/cursor-background-agents-in-slack-changed-my-workflow)
- [Sculptor: the missing UI for parallel coding agents - Imbue](https://imbue.com/blog/sculptor-announce)
- [GitHub - imbue-ai/sculptor](https://github.com/imbue-ai/sculptor)
- [Factory AI Review 2026 - Digital Applied](https://www.digitalapplied.com/blog/factory-ai-multi-agent-coding-platform-review)
- [Warp 2.0: the Agentic Development Environment](https://www.warp.dev/blog/reimagining-coding-agentic-development-environment)
- [Agentic Coding in 2026 - Sourcegraph](https://sourcegraph.com/blog/agentic-coding)
- [Claude Code Git Worktrees: Run 5 AI Agents in Parallel (2026 Guide)](https://devtoollab.com/blog/claude-code-git-worktrees-parallel-agents-guide)
- [OpenHands Review 2026 - AI Agent Index](https://theaiagentindex.com/agents/openhands)
- [Linear vs Jira: A 2026 Guide - Everhour](https://everhour.com/blog/linear-vs-jira/)
- [Linear vs Jira 2026 - Which Issue Tracker Should Engineers Use? - PromptedDev](https://prompteddev.com/blog/linear-vs-jira/)
- [Linear Project Management Guide - TMetric](https://blog.tmetric.com/linear-project-management-guide-features-workflow-and-benefits/)
- [Why Developers Hate Jira - Analytics India Magazine](https://analyticsindiamag.com/deep-tech/why-developers-hate-jira/)
- [Why Developers Hate Jira - The New Stack](https://thenewstack.io/why-developers-hate-jira-and-what-atlassian-is-doing-about-it/)
- [Plane project management - GitHub](https://github.com/geanttechnology/plane-project-management-software)
- [Charlie Labs Blog](https://charlielabs.ai/blog/)
- [Daemons work 24/7. No prompts required. | Charlie Labs](https://charlielabs.ai/)
- [How We Built Charlie, Part 15 | Charlie Labs](https://charlielabs.ai/blog/what-we-learned-building-charlie/)
- [AgentsRoom: multi-project & multi-agent orchestration](https://agentsroom.dev/)
- [AgentsRoom: Multi-Project Multi-Agent feature page](https://agentsroom.dev/features/multi-project-multi-agent)
- [AgentsRoom Agent Teams](https://agentsroom.dev/features/teams)
- [Using Claude Code: session management and 1M context | Anthropic](https://claude.com/blog/using-claude-code-session-management-and-1m-context)
- [Claude Code Context Management Guide - SitePoint](https://www.sitepoint.com/claude-code-context-management/)
- [Compacting Claude Code Sessions | Steve Kinney](https://stevekinney.com/courses/ai-development/claude-code-compaction)
- [Notification when Claude Code is waiting for user input · Issue #36885 · anthropics/claude-code](https://github.com/anthropics/claude-code/issues/36885)
- [Feature Request: Add YOLO mode to Shift+Tab cycle · Issue #15898](https://github.com/anthropics/claude-code/issues/15898)
- [Choose a permission mode - Claude Code Docs](https://code.claude.com/docs/en/permission-modes)
- [How I Built a Mobile Approval System for Claude Code - Medium](https://medium.com/@Purpom_aoki/how-i-built-a-mobile-approval-system-for-claude-code-so-i-can-finally-leave-my-desk-76b048b35c33)
- [CodeAgent Mobile](https://www.codeagent-mobile.com/)
- [Push Notifications for AI Coding Workflows | Claude Remote](https://www.clauderc.com/blog/2026-02-28-push-notifications-for-ai-coding-workflows/)
- [GitHub - clash-sh/clash: Avoid merge conflicts across git worktrees](https://github.com/clash-sh/clash)
- [Git Worktrees for AI Coding - MindStudio](https://www.mindstudio.ai/blog/git-worktrees-parallel-ai-coding-agents)
- [Meet Graphite Agent - Graphite](https://graphite.com/blog/introducing-graphite-agent-and-pricing)
- [Stacking up Graphite in the World of Code Review Tools - DEV](https://dev.to/heraldofsolace/stacking-up-graphite-in-the-world-of-code-review-tools-5fbn)
- [Why Coding Agents Need Independent Quality Gates - Codacy](https://blog.codacy.com/why-coding-agents-need-independent-quality-gates)
- [ACT gate Explained: Deterministic Merge Gates for AI-Written Code - AI Journal](https://aijourn.com/act-gate-explained-deterministic-merge-gates-for-ai-written-code/)
- [How to evaluate AI coding agents - Vercel](https://vercel.com/i/evaluating-ai-coding-agents)
- [GitHub - roy-reshef/socratic-ai-prompt-skill](https://github.com/roy-reshef/socratic-ai-prompt-skill)
- [How to track AI agent costs and token usage | Bigeye](https://www.bigeye.com/blog/how-to-track-ai-agent-costs-and-token-usage)
- [Making agentic token costs visible in production | Datadog](https://www.datadoghq.com/blog/making-agentic-token-costs-visible-in-production/)
- `.planning/PROJECT.md` (Flywheel project context, v1 scope, and architectural constraints)

---
*Feature research for: Agentic Development Environment (Flywheel)*
*Researched: 2026-09-08*
