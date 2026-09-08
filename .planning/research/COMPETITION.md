# Competition & Positioning Research: Flywheel

**Project:** Flywheel (by HighKnow)
**Domain:** Agentic Development Environment (ADE) — local-first multi-agent supervision + agent-writable project board
**Researched:** 2026-09-08 (all claims below checked against sources on or before this date; product status in this category changes fast — treat anything older than ~60 days as due for a re-check)
**Confidence:** MEDIUM-HIGH overall (HIGH on execution-model/pricing/licence facts, which are directly sourced; MEDIUM on "does anyone already build the wedge," which is an inference from product docs rather than a confirmed absence)

This document resolves the build-vs-integrate fork left open in `PROJECT.md` and gives the
positioning Flywheel should ship with. It supersedes instinct on both points — read Part 6 first
if you only read one section.

---

## 1. Market Map

Two populations exist and barely talk to each other: **agent orchestration tools** (start from
"how do I run many coding agents") and **PM tools growing agent capability** (start from "how do I
track work" and are bolting agents on). Flywheel sits deliberately at the intersection nobody in
either population has claimed.

### 1a. Parallel-agent / multi-agent desktop and orchestration tools

| Product | What it does | Execution model | Work-item model | Pricing | Licence | Status (Sep 2026) |
|---|---|---|---|---|---|---|
| **Conductor** (Melty Labs) | Mac app; spins up a git worktree + branch per "workspace," attaches a Claude Code/Codex session | Local (BYO subscription) | None — workspaces, not structured items | Free app, BYO model subscription | Closed source | Alive, $22M Series A, actively shipping |
| **Crystal → Nimbalyst** (Stravu) | Desktop app (+ iOS companion) running Claude Code/Codex sessions on a kanban board with WYSIWYG task cards | Local, local-first | **Yes — closest analog to Flywheel.** Kanban columns = session/task states; tasks have status/tags/priority. No epic hierarchy, no acceptance-criteria field | Free for individuals; team tier free-in-beta | **MIT** (flipped from closed source, Apr 2026) | Alive, actively developed — direct successor to Crystal (deprecated Feb 2026) |
| **Vibe Kanban** (Bloop) | Web-based kanban orchestrating local agents (Claude Code, Codex, OpenCode…), one worktree per task | Local agents, web UI | Yes — kanban board, no epic hierarchy or acceptance criteria surfaced | Was free | Apache 2.0 (opened on sunset) | **Dead as a company** — Bloop shut down Apr 2026; repo now community-maintained, cloud features (shared boards) switched off |
| **Terragon (Terry)** | Cloud background agents in remote sandboxes; web dashboard, CLI, GitHub comments, mobile | **Cloud** | Task list, not structured board | Was subscription | Open-sourced on shutdown | **Dead** — shut down, snapshot released Jan 2026 |
| **Sculptor** (Imbue) | Mac desktop app; parallel Claude Code agents in isolated Docker sandboxes | Local (Docker on your machine) | Task assignment per workspace, no hierarchy | Free (beta) | Open source | Alive, experimental/beta as of mid-2026 |
| **Charlie Labs (Charlie / Daemons)** | Always-on cloud "autonomous software engineer"; V2 adds durable multi-step runtime + persistent "daemon" roles watching GitHub/Linear/Slack/Sentry | **Cloud** | None owned — operates on GitHub Issues / Linear as source of truth | Not published (enterprise-leaning) | Closed | Alive, actively shipping (V2 spring 2026) |
| **Factory (Droids)** | Full-SDLC cloud agent platform: code, test, review, docs, deploy | **Cloud** | Task/PR-centric, no owned board | Pro $20, Plus $100, Max $200/mo; Teams/Enterprise custom | Closed | Alive, large — $150M Series C Apr 2026 at $1.5B valuation, enterprise customers (Nvidia, Adobe, MongoDB) |
| **Devin** (Cognition) | Cloud autonomous engineer; ACU-based compute billing | **Cloud** | Session/task list; integrates into Linear/Jira/Slack as PM layer | Free / Pro $20 / Max $200 / Teams $80+$40 seat / Enterprise | Closed | Alive, large, well-funded (also acquired Windsurf) |
| **OpenHands** | Open-source agent framework + web interface; file/terminal/browser tool use | Local **or** self-hosted cloud | None owned — task-driven, not board-native | Free core (OSS); enterprise tier | **MIT** | Alive — 80k+ GitHub stars, 9M downloads, $18.8M Series A |
| **Cursor (Background Agents / Composer)** | IDE with up to 8 parallel cloud/local agents, each in its own worktree or remote VM | Hybrid (local editor, agents can run cloud) | None — chat threads, not board items | Hobby free / Pro $20 / Pro+ $60 / Ultra $200; Teams $40–120/seat | Closed | Alive and dominant — **acquired by SpaceX for $60B**, closed Aug 14 2026 (all-stock; ~$2.6B ARR at deal time) |
| **Warp** | AI-native terminal: Agent Mode (interactive), Cloud Agents ("Oz," event-triggered) | Hybrid | None — Warp Drive is shared context/rules, not a board | Free tier + paid; team "Warp Drive" | Closed | Alive, actively shipping, cross-platform since 2026 |
| **Amp** (Sourcegraph, spun off Dec 2025) | Standalone coding agent, CLI + "Threads" (chat history) stored on Sourcegraph's servers | Local agent, cloud thread storage | None — threads, not board items | Free (ad-supported, trains on data) / paid "Smart Mode" (zero data retention) | Closed | Alive, independent company since Dec 2025 |
| **Google Antigravity** | VS Code fork; "Manager view" spawns/monitors up to 5 parallel agents across workspaces | Hybrid, Google-model-backed | None — task list in Manager view, not a persistent structured board | Free preview (20 req/day) + Google AI Pro $20/Ultra $100; 2.0 adds Enterprise Agent Platform | Closed | Alive, Google-backed, "2.0" 5-surface platform launched May 2026 |
| **Claude Code native (worktrees + subagents)** | `--worktree` / `-w` flag (native, shipped Feb 2026) creates an isolated worktree per session; subagents can declare `isolation: "worktree"` | Local (your machine, your credentials) | None — no persistent work-item concept, session-scoped only | Included in Claude Code subscription | Closed (Anthropic) | Alive, actively expanding — **this is the platform capability Flywheel is built on top of, and also Anthropic's most direct path to competing with Flywheel later** |
| **Claude Squad / Gastown / Multiclaude / dmux** | Open-source tmux-based multiplexers spawning several local CLI agents in separate panes + worktrees | Local | None — terminal panes, not board items | Free (OSS) | MIT/Apache-family | Alive, niche, community-maintained |
| **Beads (`bd`)** (Steve Yegge) | Git-backed, Dolt-based graph issue tracker built specifically as agent memory ("solves the 50 First Dates problem") — hash IDs, dependency graph, hierarchical epics, LLM memory compaction | Local, git-native (travels with the repo) | **Yes — closest conceptual analog to the context-reconstitution wedge**, but CLI/database only, no board UI, no fleet view, no worktree/session linkage, no Socratic authoring | Free | Open source | Alive, released Oct 2025, actively used |

### 1b. AI-native / agent-aware project management

| Product | Agent story | Execution model | Work-item model | Pricing | Licence | Status |
|---|---|---|---|---|---|---|
| **Linear** (Agent Sessions / Coding Sessions) | Agents are full workspace members: assignable to issues, `@mentioned`, run "coding sessions" via Claude Code/Codex that draft a PR and attach a diff to the issue; 6-state session lifecycle (pending/active/error/awaitingInput/complete/stale) | **Cloud only, GraphQL API** — no offline mode | Issues/projects/cycles — mature human-first schema now growing agent fields | Free / Basic $10 / Business $16 / Enterprise custom, per user | Closed, cloud SaaS | Alive, **moving very fast** — major agent-session and coding-environment ships Jun–Aug 2026 |
| **Jira (Rovo)** | Rovo Agents reached GA: assignable, `@mentionable`, embedded in workflows; generate PRDs → epics → issues; "Max mode" plans multi-step work | **Cloud** (Data Center self-host exists but is enterprise-heavy, not a fit here) | Issues/epics — the most mature hierarchical schema of any tool here | Jira + Rovo bundled into Atlassian pricing | Closed | Alive, huge distribution — 5M+ MAU on Rovo |
| **Plane.so** | Native MCP server, agent framework with `@mention` support, "Agent Run" lifecycle tracking, OAuth apps, webhooks | **Self-hostable** (Docker/Kubernetes) or cloud | Issues/cycles/epics — general-purpose PM schema retrofitted with agent fields | Free self-hosted Community Edition; paid Cloud + Business/Enterprise | **AGPL-3.0** (Community Edition) | Alive, actively developed, explicitly marketing "AI-native PM" |
| **Height** | Was building toward "autonomous project collaboration" (Height 2.0, Oct 2024) | Cloud | Issues | N/A | N/A | **Dead** — announced shutdown Mar 2025, offline Sep 2025. Cautionary tale: closest prior attempt at "PM tool becomes agent-native," and it died before shipping the vision |
| **GitHub Projects + Copilot coding agent** | Assign an Issue to Copilot (VS Code, Slack, or web); Copilot works in an isolated GitHub Actions sandbox, iterates against tests, opens a PR | **Cloud** (GitHub Actions sandbox) | Issues/Projects v2 — historically weak custom-field/hierarchy support, improving | Bundled into GitHub Copilot seats | Closed | Alive, GA since Mar 2026, enormous distribution by default (every GitHub repo) |
| **Devin ↔ Linear/Jira integrations** | Assign Devin directly on an issue in Linear/Jira; Devin scopes, plans, and links back a PR | Devin's compute is cloud; PM system is whichever the team already uses | Uses the host tool's schema, adds nothing agent-native to it | Devin pricing (above) + host tool pricing | — | Alive |
| **Cosine (Genie)** | Integrates into Jira, Linear, Trello, Asana, Slack, GitHub — assign from any of them | Cloud | Uses host tool's schema | Not published | Closed | Alive |
| **Charlie Labs / Daemons** | (see 1a) — operates against GitHub Issues/Linear as source of truth rather than owning a schema | Cloud | Borrowed, not owned | — | Closed | Alive |

**Reading the two tables together:** every cloud-native PM tool (Linear, Jira, GitHub Projects) is
adding agent *assignability* to an existing human-first schema. None of them have redesigned the
schema itself for agent sessions, worktrees, diffs, or acceptance-criteria-as-structured-fields —
and given they are SaaS products, none of them can satisfy a local-first, offline, credentials-stay-on-device
constraint even if they wanted to. Every orchestration tool that does own a work-item schema
(Nimbalyst, Vibe Kanban) treats it as a lightweight status board, not a context-reconstitution
substrate. Beads is the one project explicitly built to solve context loss, and it deliberately
stays a headless memory layer rather than a supervised, multi-project, human-in-the-loop product.

---

## 2. The Gap Analysis — Is the Wedge Real?

**Flywheel's claimed wedge:** the board is the context-reconstitution mechanism that makes
discarding an agent context free — work is anchored to structured items with acceptance criteria,
so sessions are disposable and the thread is never lost.

**Verdict: the wedge is real, but it is not virgin territory — it is flanked from two directions,
and the flanking parties are shipping fast.**

**No shipping product already does this end-to-end.** Specifically, nothing found combines all
four of: (a) a structured work-item hierarchy with acceptance criteria as a first-class field, (b)
explicit session-to-worktree-to-task linkage where many disposable sessions attach to one durable
worktree, (c) local-first execution with credentials that never leave the machine, and (d)
multi-project fleet supervision in one view. Every candidate is missing at least two of these.

**Who is closest, and what they'd need to close the gap:**

- **Nimbalyst** (MIT, local desktop, kanban + Claude Code/Codex sessions + git worktrees) has (b)
  and (c) largely built already, and ships (a) in skeleton form (status/tags/priority, no
  acceptance criteria, no epic→task hierarchy). It is missing: acceptance criteria as a schema
  field, an epic layer, Socratic authoring, agent-authored backlog proposals, and multi-project
  fleet supervision (it appears workspace-scoped, not fleet-scoped). **This is the single most
  concrete threat in the market.** Given the team already flipped Crystal→Nimbalyst and
  closed-source→MIT within roughly two months, adding an acceptance-criteria field and an epic
  layer to an existing kanban schema is a matter of weeks, not months, for a team already shipping
  at that velocity. What they lack that is harder to bolt on fast: the Socratic-authoring UX, the
  agent-proposes-backlog-items loop, and — critically — a commercial cloud/relay/team layer, since
  they are MIT with no visible paid tier design yet.
- **Beads** has (a) in its most rigorous form (hierarchical epics, dependency graph, explicitly
  designed against context loss) and travels with the repo (satisfying local-first by
  construction), but it is a CLI/database, not a supervised product: no UI, no fleet view, no
  Socratic authoring, no worktree/session orchestration of its own — it assumes you already have
  an agent loop and bolts memory onto it. To close the gap it would need a full desktop
  application layer, which is a much larger lift than Nimbalyst's gap (they'd be building a UI and
  supervision layer from scratch, not adding fields to an existing one).
- **Linear** has the most credible engineering velocity and distribution of anyone on the PM side
  (weekly-cadence agent-session shipping through mid-2026) but is structurally blocked from
  satisfying local-first — it is a multi-tenant SaaS company; making the workspace function
  offline with on-device data as the store of record is not a feature, it is a different company.
  This protects Flywheel's beachhead specifically, not the wedge in general — a team-scale version
  of this idea could plausibly come from Linear for developers who don't require local-first.
- **GitHub Copilot coding agent** approximates one slice of the wedge by re-reading the issue on
  every assignment (so context is nominally reconstitutable from the issue text), but it has no
  epic/acceptance-criteria structure beyond issue body text, no fleet supervision, and is
  cloud-sandboxed only.

**Net assessment:** the wedge is a real, currently-unclaimed *combination*, not a real, currently-unclaimed
*idea*. Every individual piece exists somewhere. The moat, if there is one, is in shipping the
combination faster and more coherently than Nimbalyst can bolt it onto their existing product, or
than Anthropic can bolt it onto Claude Code's existing worktree/subagent primitives. That is a
speed and execution argument, not a "nobody has thought of this" argument — plan and message
accordingly.

---

## 3. Positioning Recommendation

**Positioning statement:**
For developers running several AI coding agents across several projects at once, Flywheel is the
local-first Agentic Development Environment where work lives on a structured, agent-writable
board instead of in a chat thread — so every agent session is disposable, and throwing one away
never costs you the plan. Unlike chat-native fleet tools (Conductor, Nimbalyst, Sculptor), the
board — not the conversation — is the source of truth. Unlike cloud PM tools growing agent features
(Linear, Jira), the board runs entirely on your machine, on your own agent credentials, and works
offline.

**Sharpest one-line pitch:**
"The board that survives your agent's context window — so `/clear` is free."

**Named enemy:**
"Chat-native fleet tools, but disposable." Concretely: *"Conductor and Nimbalyst give you a
dashboard of chat threads running in worktrees — when the thread dies, so does the plan. Flywheel
gives you a board of structured tasks with acceptance criteria — when the session dies, the next
one just reads the task and picks up where it left off."* Use Conductor/Nimbalyst as the named
enemy, not Linear/Jira — the honest primary substitute for Flywheel's beachhead user today is a
chat-multiplexer, not a PM tool; Linear/Jira are the enemy for the *second* audience (developers
who currently track agent work as Linear issues and are frustrated by the mismatch), worth a
secondary landing page ("Linear, but the agent can write to the board without waiting on your
review queue, and it works when your wifi doesn't").

**Beachhead segment:**
Solo and small-team developers already practicing structured, spec-driven agent workflows (GSD,
superpowers, spec-driven development generally) who are running multiple agents across multiple
personal or client repos and feel the fleet-supervision pain acutely — not enterprise (Factory,
Devin, Charlie, Copilot coding agent already own that governance-and-scale conversation with
budgets Flywheel cannot match), not casual single-repo vibe-coders (Cursor/Lovable/Antigravity own
that with vastly larger distribution). This is exactly the "Cyril" profile in `PROJECT.md`: the
first 100 users look like people who already maintain a `.planning/`-style discipline by hand and
are the natural early adopters for "now it's a live board instead of markdown files."

**Open-core boundary assessment:**
Compared to GitLab (OSS core / paid governance), Sentry and Cal.com (OSS core / paid hosted-and-managed),
Supabase and PostHog (OSS core / paid scale-and-team features), Flywheel's proposed
boundary — desktop ADE free and fully solo-usable, cloud relay/sync/mobile/web/team-collaboration
paid — matches the pattern that has worked repeatedly in this category: **the free tier is
independently valuable (satisfies adoption), and the paid tier is genuinely operational
infrastructure (multi-device sync, presence, relay, mobile clients) that a motivated solo user has
little reason to self-host even if they technically could.** This is more defensible than gating
features behind a licence check, because the value being sold is "we run the hard infrastructure
for you," not "we unlocked a checkbox." The specific risk: if the append-only event log's *format*
is fully documented (which `PROJECT.md` requires for future extensibility), a sufficiently
motivated user could self-host a bare relay in an afternoon using off-the-shelf sync tooling — but
that is also true of Sentry, Cal.com, and Supabase's protocols, and none of them have found this
fatal, because most solo developers value not-operating-infrastructure more than they value saving
$10–20/month. **Recommendation:** keep the event log *schema* open (required for the "no
architectural foreclosure" constraint) but keep the relay's actual sync/merge/conflict-resolution
implementation, presence, and mobile clients closed-source and cloud-hosted-only — the same split
GitLab, Sentry, and Supabase all use.

---

## 4. Thesis Risks, Rated

| Risk | Probability (12 mo) | Impact | Notes |
|---|---|---|---|
| **Anthropic ships a native persistent board (not just worktrees/subagents) into Claude Code / Claude Code Desktop** | HIGH | HIGH | Anthropic shipped native `--worktree` support in Feb 2026 and is visibly moving toward "manager" style multi-agent supervision (industry-wide pattern — Antigravity, Cursor, Warp all built this in the same window). Anthropic owns the agent and the credentials Flywheel depends on; if they add a persistent, structured work-item layer, this is closer to an extinction event than a competitive event for the "local supervision" half of the pitch. **Mitigation already in the architecture:** the adapter seam (Claude Code as one of several future backends) is the correct hedge — it's what stops Flywheel being purely a skin on one vendor's roadmap. Anthropic has shown zero indication of wanting to own team-collaboration/PM/relay, which is where the actual business model lives — so even in the worst case, the desktop OSS layer may get commoditized while the cloud layer survives. |
| **Nimbalyst (or a similarly-positioned MIT project) adds epics + acceptance criteria + fleet view** | HIGH | MEDIUM-HIGH | Analyzed in Part 2. Fast-moving, already has the harder infrastructure (local desktop, worktrees, sessions) built; the delta to Flywheel's schema is comparatively small. What they lack — Socratic authoring, agent-proposed backlog, and a real commercial layer — is exactly what Flywheel should invest in first and market hardest, since it is the harder-to-copy half. |
| **Linear (or Jira) closes the agent-native-schema gap on the PM side** | MEDIUM | HIGH | Linear's agent-session shipping velocity through mid-2026 is the fastest of any PM incumbent. But cloud-only is a structural, not a feature, gap versus Flywheel's local-first requirement — Linear would have to become a fundamentally different kind of company to compete for this specific beachhead. Real risk is Linear satisfying the *team* version of this pitch and leaving Flywheel only the *solo/local* niche — which is actually consistent with the beachhead chosen in Part 3, so this risk mostly caps Flywheel's ceiling rather than killing the wedge. |
| **The local-execution model loses to cloud-agent-execution as the default** | MEDIUM | HIGH | The market is visibly bifurcating toward cloud/sandboxed execution (Devin, Factory, Charlie, Copilot coding agent, Cursor Background Agents, the now-dead Terragon). If enterprises and even solo developers converge on "agents just run somewhere else," local-first stops being a selling point and starts being a limitation. Mitigated by the beachhead choice (privacy/credential-sensitive developers, regulated-industry devs, and people who explicitly distrust sending code to third-party sandboxes are a durable, if minority, niche) — but this is the risk most likely to cap total addressable market rather than being survivable by pivoting, since local-first is a stated hard constraint, not a default. |
| **Category mortality / thin moats generally** | — (already observed) | MEDIUM | Vibe Kanban (dead, Apr 2026), Terragon (dead, Jan 2026), Height (dead, Sep 2025), Crystal (deprecated into Nimbalyst, Feb 2026) — four notable deaths/pivots in this exact category inside about 18 months. This cuts two ways: competitors may not survive long enough to out-execute Flywheel, but it also means the category commoditizes fast and "we shipped first" is not a moat on its own — the open-core cloud business, not the desktop app, has to be the actual defensible asset. |
| **GitHub becomes the default "issue → agent → PR" loop by sheer distribution** | MEDIUM-HIGH | MEDIUM | Copilot coding agent + Projects is "good enough" and already open in every repo's second tab — many developers will never evaluate a dedicated tool because the default is adequate. This is a distribution risk, not a product risk: GitHub Projects' schema and cloud-only sandboxing don't threaten the wedge itself, but they threaten whether anyone bothers looking past the free-with-your-repo option. |

---

## 5. Build vs Integrate — the Decision

### Option 1 — Build the PM core from scratch
Agent-native schema (epics/tasks/issues, acceptance criteria, worktree links, session log,
multi-actor identity, append-only event log) owned outright. Maximum differentiation, but you own
the "why doesn't your tracker do X" long tail forever.

### Option 2 — Integrate an existing tool
Evaluated concretely against the hard local-first/offline constraint and the agent-write
requirement:

| Tool | API | Offline/local-first viability | Verdict |
|---|---|---|---|
| **Linear** | GraphQL; OAuth Agent Sessions exist; rate limits 2,500 req/hr (API key) or 200–250k complexity points/hr (workspace-scaled for OAuth apps) | **None — cloud SaaS only, no offline mode at all.** The workspace does not function without Linear's servers. | **Disqualified.** Store of record would be unavailable offline, directly violating the stated hard constraint. |
| **Jira** | REST, three simultaneous rate-limit systems (points/hr, burst/sec, per-issue writes); Data Center self-host exists but is enterprise infrastructure, not a fit for a solo-usable open desktop app | Cloud-only in the relevant edition; Data Center is heavy, licensed, server-operated | **Disqualified**, same reason, plus Jira's schema is the least agent-native of the four. |
| **GitHub Projects** | GraphQL v2, 5,000 points/hr per user, no offline mode; Projects v2 historically weak on custom fields/hierarchy | Cloud-only | **Disqualified** as sole store of record — though GitHub Issues is the most plausible **outbound sync target** later (see Option 3), since it's where most target repos' issues already live. |
| **Plane.so** | REST + OAuth 2.0 + webhooks + native MCP server + typed SDKs; **AGPL-3.0**, genuinely self-hostable on Docker/Kubernetes | **Technically the only candidate that could satisfy local-first** — but self-hosting means running a Next.js frontend, Django backend, Postgres, Redis, and Celery workers locally just to back a single-user desktop kanban board. That is a heavy, unusual packaging problem for a lightweight Tauri/Electron-class desktop app, and it does not remove the schema work — Plane's issue model has no first-class concept of git worktrees, agent sessions, diffs, or acceptance criteria as structured fields, so you'd still be building the agent-native layer on top, just now inside someone else's much larger general-PM surface (sprints, cycles, wiki, docs) that `PROJECT.md` explicitly rules out chasing. AGPL-3.0 is also a real business-model complication: its copyleft obligations attach over the network, which sits awkwardly right at the open-core seam (desktop OSS / proprietary cloud) Flywheel most needs to keep clean. | **Not disqualified on offline grounds, but disqualified on architecture and licence grounds** — integrating it trades "build a small schema" for "operate someone else's server stack plus still build the schema on top, under a licence that fights your own business-model boundary." |

**Conclusion on Option 2:** every cloud-only candidate fails the hard local-first constraint
outright — this is not a close call, it is stated as disqualifying in the question itself and the
research confirms none of the three (Linear, Jira, GitHub) has an offline mode. Plane is the one
partial exception, and even there, integrating buys you a heavier, licence-encumbered path to the
same schema work you'd have to do anyway.

### Option 3 — Own the core, sync outward
Not actually a distinct architectural fork from Option 1 — it is Option 1 plus a deferred,
additive feature. `PROJECT.md`'s v1 schema already mandates the two things this needs: an
append-only event log ("something a relay can subscribe to") and multi-actor identity. Connectors
to Linear/Jira/GitHub Issues are bounded, addable work once a real multi-team customer asks for
them (all three offer webhooks + REST/GraphQL adequate for one-way or eventually two-way mirroring)
— this is not a v1 concern and does not change the v1 recommendation.

### RECOMMENDATION

**Build the PM core from scratch (Option 1), architected from day one so Option 3's outward
connectors are a natural additive layer later, not a rewrite. Confidence: HIGH.**

Weighing the explicit factors:
- **Time-to-v1:** the schema Flywheel actually needs (epics/tasks/issues, acceptance criteria,
  worktree links, session log, event log, multi-actor identity) is small and deliberately
  bounded — `PROJECT.md` already rules out chasing sprint burndown, time tracking, and portfolio
  reporting. That scope is arguably *smaller* than standing up and then stripping down Plane's
  general-PM surface to fit.
- **Differentiation:** maximal — this is the only option under which the context-reconstitution
  wedge (Part 2) can be a first-class schema property rather than a convention layered on top of
  someone else's issue-body text.
- **Local-first/offline:** trivially satisfied by an embedded local database (e.g., SQLite —
  single file, zero server process, plays naturally with a Tauri-class shell); this is the
  constraint that disqualifies two of the three cloud options outright and makes the third
  (Plane) architecturally awkward.
- **Agents writing autonomously and challenging the human mid-authoring:** needs zero-latency,
  offline-capable, schema-flexible local writes during a live Socratic exchange. A network-bound
  external API — even Plane's, self-hosted or not — adds a running-server dependency and
  round-trip latency that fights exactly this requirement.
- **Deferred team-collaboration requirement:** satisfied by building the event log and multi-actor
  identity into v1 regardless of which option is chosen — this factor doesn't discriminate between
  options, it's already a fixed cost.
- **Open-core business model:** owning the schema keeps the open/paid boundary on a clean module
  seam (local core vs. cloud relay) as `PROJECT.md` requires; integrating a third party's cloud
  tool as the store of record would make Flywheel's "paid layer" partly rent-seeking on top of
  someone else's product, which is a much weaker business to pitch.
- **Adoption friction for developers already on Linear/Jira:** this is the real cost of the
  recommendation (see counter-argument below), and it is not zero.

### Strongest argument AGAINST this recommendation

**Speed-to-validated-traction, and the category's mortality rate, may matter more than
architectural purity.** A developer who already lives in Linear or Jira has to migrate backlog and
habit to adopt Flywheel's own tracker — real friction, and exactly the kind of friction "just
integrate with what people already have open" is designed to remove. Nimbalyst is live proof that
a "good enough" bolted-on tracker (kanban + worktrees + sessions, no acceptance criteria, no
epics) can already be shipping and gathering real users while a from-scratch schema is still being
designed — and this category kills products that take too long to reach real usage (four
dead/pivoted competitors in 18 months, per Part 4). If Cyril's stated v1 success metric is simply
"a full week of real work without dropping to a bare terminal," a thin board bolted onto local
files or even GitHub Issues might clear that bar in a fraction of the build time a from-scratch
schema requires — and it would let the roadmap spend its early phases proving the supervision and
Socratic-authoring loop instead of the storage layer. The counter-counter-argument is that this
research found no *cloud* integration option that survives the local-first constraint at all, so
"integrate" in practice would mean either violating a stated hard constraint or accepting Plane's
heavy self-hosted footprint — but if that constraint were ever relaxed for v1 (e.g., "local cache
of a cloud store, sync when online" instead of "local is the sole store of record"), this
counter-argument would become significantly stronger and worth revisiting.

---

## 6. Sources

All checked 2026-09-08 unless a specific in-page date is cited above.

- Conductor: [conductor.build docs](https://www.conductor.build/docs/guides/parallel-agents/run-multiple-claude-code-sessions), [madewithlove.com writeup](https://madewithlove.com/blog/conductor-running-multiple-ai-coding-agents-in-parallel/)
- Crystal/Nimbalyst: [github.com/stravu/crystal](https://github.com/stravu/crystal), [nimbalyst.com](https://nimbalyst.com), [rywalker.com/research/nimbalyst](https://rywalker.com/research/nimbalyst)
- Vibe Kanban: [vibekanban.com](https://www.vibekanban.com/release-notes), [github.com/BloopAI/vibe-kanban issue #3433](https://github.com/BloopAI/vibe-kanban/issues/3433), [nimbalyst.com writeup on the sunset](https://nimbalyst.com/blog/vibe-kanban-after-bloop-whats-next/)
- Terragon: [github.com/terragon-labs/terragon-oss](https://github.com/terragon-labs/terragon-oss), [docs.terragonlabs.com](https://docs.terragonlabs.com/docs)
- Sculptor: [imbue.com/product/sculptor](https://imbue.com/product/sculptor), [github.com/imbue-ai/sculptor](https://github.com/imbue-ai/sculptor)
- Charlie Labs: [charlielabs.ai/blog](https://charlielabs.ai/blog/), [charlielabs.ai — CAOS](https://charlielabs.ai/coding-agents-as-operating-systems/)
- Factory AI: [enterprisedna.co coverage of Series C](https://enterprisedna.co/resources/news/factory-ai-series-c-enterprise-coding-agents-2026/), [theaiagentindex.com](https://theaiagentindex.com/agents/factory-ai)
- Devin/Cognition: [usecarly.com pricing breakdown](https://www.usecarly.com/blog/devin-pricing/), [docs.devin.ai/integrations/linear](https://docs.devin.ai/integrations/linear)
- OpenHands: [openhands.dev blog](https://www.openhands.dev/blog/open-source-ai-coding-agents)
- Cursor / Anysphere / SpaceX acquisition: [cnbc.com](https://www.cnbc.com/2026/06/16/spacex-spcx-cursor-acquisition-ipo.html), [fool.com](https://www.fool.com/investing/2026/06/29/spacexs-60-billion-cursor-deal-changes-everything/), [satnews.com — deal close](https://satnews.com/2026/08/13/spacex-finalizes-regulatory-procedures-to-close-60-billion-acquisition-of-ai-platform-cursor/); Cursor pricing: [nxcode.io](https://www.nxcode.io/resources/news/cursor-ai-pricing-plans-guide-2026)
- Warp: [warp.dev blog](https://www.warp.dev/blog/introducing-the-warp-agent-cli-coding-agent)
- Amp: [zoltanbourne.substack.com](https://zoltanbourne.substack.com/p/early-preview-of-amp-the-new-ai-coding), [gvrooyen.substack.com](https://gvrooyen.substack.com/p/getting-started-with-amp)
- Google Antigravity: [developers.googleblog.com](https://developers.googleblog.com/build-with-google-antigravity-our-new-agentic-development-platform/), [en.wikipedia.org/wiki/Google_Antigravity](https://en.wikipedia.org/wiki/Google_Antigravity), pricing via [layer3labs.io](https://www.layer3labs.io/guides/google-antigravity-pricing)
- Claude Code native worktrees: [Boris Cherny announcement, X/Threads](https://x.com/bcherny/status/2025007393290272904), [code.claude.com/docs/en/worktrees](https://code.claude.com/docs/en/worktrees)
- Claude Squad / Gastown / dmux: [github.com/smtg-ai/claude-squad](https://github.com/smtg-ai/claude-squad), [shipyard.build/blog/claude-code-multi-agent](https://shipyard.build/blog/claude-code-multi-agent/)
- Beads: [github.com/steveyegge/beads](https://github.com/steveyegge/beads), [Steve Yegge's launch post](https://steveyegge.spicytakes.org/post/2025-11-12-introducing-beads-a-coding-agent-memory-system), [ianbull.com/posts/beads](https://ianbull.com/posts/beads/)
- Linear agents/coding sessions: [linear.app/agents](https://linear.app/agents), [linear.app/changelog/2026-08-20-coding-environments](https://linear.app/changelog/2026-08-20-coding-environments), [linear.app/docs/coding-sessions](https://linear.app/docs/coding-sessions), rate limits at [linear.app/developers/rate-limiting](https://linear.app/developers/rate-limiting), pricing at [costbench.com](https://costbench.com/software/developer-tools/linear/)
- Jira Rovo: [atlassian.com/software/rovo](https://www.atlassian.com/software/rovo), [support.atlassian.com/rovo/docs/agents](https://support.atlassian.com/rovo/docs/agents/); Jira API limits: [developer.atlassian.com/cloud/jira/platform/rate-limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
- Plane.so: [plane.so/open-source](https://plane.so/open-source), [developers.plane.so](https://developers.plane.so/), [developers.plane.so/dev-tools/agents/building-an-agent](https://developers.plane.so/dev-tools/agents/building-an-agent)
- Height shutdown: [Hacker News thread](https://news.ycombinator.com/item?id=43454034), [alternativeto.net news](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/)
- GitHub Projects/Copilot coding agent: [baeseokjae.github.io — Copilot coding agent guide](https://baeseokjae.github.io/posts/github-copilot-coding-agent-guide-2026/); GraphQL rate limits: [docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)
- Cosine/Genie: [cosine.sh](https://cosine.sh/), [tooldirectory.ai/tools/cosine](https://tooldirectory.ai/tools/cosine)
- Open-core precedent (GitLab, Sentry, PostHog, Supabase): [landbase.com fastest-growing OSS dev tools](https://www.landbase.com/blog/fastest-growing-open-source-dev-tools), [newsletter.posthog.com](https://newsletter.posthog.com/p/the-companies-that-shaped-posthog)

---

*Research completed: 2026-09-08*
*Resolves: PROJECT.md Key Decision "Build-vs-integrate for the PM core is deliberately open"*
*Ready for requirements/roadmap: yes*
