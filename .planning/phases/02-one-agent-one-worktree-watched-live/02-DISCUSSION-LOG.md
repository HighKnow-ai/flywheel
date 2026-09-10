# Phase 2: One Agent, One Worktree, Watched Live - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-10
**Phase:** 2-One Agent, One Worktree, Watched Live
**Areas discussed:** Worktree & branch layout, What Start Work does, Watching the session live, Permission gate

All four gray areas offered were selected. No area was skipped, no additional round was requested.

---

## Worktree & branch layout

### Q1 — Where should a task's worktree directory live on disk?

| Option | Description | Selected |
|--------|-------------|----------|
| Visible Flywheel root | `~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/` — one predictable place for every project's worktrees, never inside a repo, trivially `cd`-able from a bare terminal (criterion 1). Keeps agent-written trees out of the tree agents are editing, same instinct as D-14. | ✓ |
| Sibling of the repo | `<repo-parent>/<repo-name>.worktrees/<TASK-KEY>/` — a project's worktrees sit next to the project. Cost: scatters directories across wherever repos live, writes into a parent directory Flywheel doesn't own. | |
| Inside the repo, gitignored | `<repo>/.flywheel/worktrees/<TASK-KEY>/` — closest to the code, self-contained. Cost: nests a working tree inside a working tree, so ripgrep/test runners/watchers/builds traverse every agent's tree. | |

**User's choice:** Visible Flywheel root
**Notes:** → D-23.

### Q2 — What should a task branch be named, given its key is THRE-142?

| Option | Description | Selected |
|--------|-------------|----------|
| Namespaced key + slug | `flywheel/thre-142-fts5-search-and-filters` — the prefix distinguishes agent branches from hand-cut ones, which matters from Phase 7 (LINK-10) and at fan-out; slug makes `git branch` readable. Effectively one-way like D-10. | ✓ |
| Key + title slug | `thre-142-fts5-search-and-filters` — same readability, no namespace; nothing says Flywheel created it. | |
| Bare key only | `thre-142` — shortest, exactly greppable, nothing to drift. Cost: `git branch` becomes a wall of opaque keys. | |

**User's choice:** Namespaced key + slug
**Notes:** → D-24. Slug fixed at creation; not rewritten on task rename.

### Q3 — What does a task with no epic branch from and merge back into? (D-13's hole)

| Option | Description | Selected |
|--------|-------------|----------|
| Straight off the trunk | Epic-less task branches from `default_branch` and targets it directly, no integration branch between. Topology stays fixed as two shapes, neither planner- nor agent-chosen. | ✓ |
| Require an epic first | Start Work refuses and prompts to pick/create an epic. Zero exceptions to WORK-02. Cost: hard block on the quick-fix task D-13 exists to permit. | |
| Adopt into a catch-all epic | Orphans auto-filed under a standing "Unfiled" epic owning its own integration branch. Cost: an epic the user never authored appears on the board. | |

**User's choice:** Straight off the trunk
**Notes:** → D-26.

### Q4 — When should an epic's integration branch be cut, and from what?

| Option | Description | Selected |
|--------|-------------|----------|
| Lazily, at first Start Work | `flywheel/epic/thre-100-<slug>` cut from the current trunk tip at the first Start Work under that epic; name written to the `epics.integration_branch` column migration 0002 already added. Unworked epics leave no branch; base is as fresh as possible. | ✓ |
| Eagerly, at epic creation | Branch exists from the moment the epic is authored. Cost: branches accumulate for epics never worked, from a stale base. | |
| Explicit action on the epic | User cuts it via a "Set up integration branch" action. Most control, most steps, one more thing to forget. | |

**User's choice:** Lazily, at first Start Work
**Notes:** → D-25.

### Continue check

Asked whether to keep going on this area or move on. **Chose "Next area"**, delegating slug drift on
rename and directory-name collision handling to Claude.

---

## What Start Work does

### Q1 — What happens between the keypress and the agent's first token?

| Option | Description | Selected |
|--------|-------------|----------|
| Launch sheet, then go | Sheet pre-filled with what the agent will be told, plus an optional instruction box and the run's permission mode; Enter starts. Makes the briefing visible and correctable before tokens are spent, and is the surface Phase 4's context packet slots into. | ✓ |
| Straight to work | One keypress, no sheet. Fastest loop, purest "the board is the briefing." Cost: nowhere to add steering; nothing shows what the agent was told until you read the transcript. | |
| Spawn idle, you type | Worktree and session created, agent waits for the first typed message. Most control. Cost: makes the board optional — the thing the product exists to avoid. | |

**User's choice:** Launch sheet, then go
**Notes:** → D-27.

### Q2 — What does Phase 2 put in front of the agent, before Phase 4's context reconstitution?

| Option | Description | Selected |
|--------|-------------|----------|
| A real context packet | Build `assembleContextPacket(taskId)` now as a pure deterministic query — epic, task, every criterion with its verification hint, branch/worktree facts. Same signature Phase 4 extends; reproducible and testable today. | ✓ |
| A prose brief | Same facts as a markdown prompt string, no typed structure. Fastest; identical to the agent. Cost: Phase 4 replaces it wholesale and rebuilds the reproducibility contract. | |
| A pointer plus a board tool | Tell the agent only the key and give it a read tool. Fewest tokens up front. Cost: the agent↔board channel is Phase 5/6. | |

**User's choice:** A real context packet
**Notes:** → D-28.

### Q3 — Should starting a session move the task's status, and should ending one move it back?

| Option | Description | Selected |
|--------|-------------|----------|
| Move in, never move out | Start → In Progress, agent-attributed, landing in the activity trail like any mutation. Nothing moves it out; In Review is a human judgement. The board tells the truth about what is running without an agent promoting its own work. | ✓ |
| Move both ways | Start → In Progress, clean finish → In Review. Full lifecycle with no keystrokes. Cost: a successful-but-useless session parks the task in the review lane. | |
| Never move it | Status is the user's alone. Maximum honesty. Cost: hand-moving every task right after pressing Start Work. | |

**User's choice:** Move in, never move out
**Notes:** → D-29.

### Q4 — What does a second session on the same task get? (criterion 4)

| Option | Description | Selected |
|--------|-------------|----------|
| Always a fresh session | Worktree reused as-is (dirty and all), brand-new session against a freshly assembled packet. Native `--resume` deliberately unused; `resumeSession` stays capability-gated in the adapter. Rehearses the product thesis early. | ✓ |
| Ask: resume or fresh | Choose per start. Cost: two code paths from day one, a decision every time, a resume path competing with the mechanism the product bets on. | |
| Resume when possible | Reattach if resumable, else fresh. Cheapest continuity. Cost: contexts rot as in chat-native tools; the board never gets exercised. | |

**User's choice:** Always a fresh session
**Notes:** → D-30.

### Continue check

**Chose "Next area"**, delegating the DATA-04 trigger record's write on each start and the
already-running-session guard to Claude.

---

## Watching the session live

### Q1 — Where does the live session live in the app?

| Option | Description | Selected |
|--------|-------------|----------|
| Its own full surface | Pushed into from a task, popped back out of; the board stays the board. A long run wants the whole window, and Phase 10's fleet view needs exactly this surface to jump into. | ✓ |
| A tab in the detail panel | The 480px side panel grows a Session tab beside the activity trail. Cheapest. Cost: too narrow for tool output; competes with the panel's job. | |
| A dockable bottom pane | Resizable terminal-style pane under the board. Closest to the terminal habit. Cost: a third layout axis on top of the below-1100px overlay rule. | |

**User's choice:** Its own full surface
**Notes:** → D-31.

### Q2 — What do you see on that surface while an agent works?

| Option | Description | Selected |
|--------|-------------|----------|
| Structured feed, raw on demand | Each normalised event as a row — prose for assistant text, collapsed expandable tool calls, blocking permission cards, cost/tokens in a status strip — plus "view raw" onto the persisted JSONL. What AGNT-02's normalisation is for; the raw log exists anyway. | ✓ |
| Structured feed only | Same rendering, no raw escape hatch. Cost: no way to check ground truth from inside the app when the feed renders wrong. | |
| Raw terminal stream | Verbatim, terminal-style. Familiar, zero interpretation risk. Cost: nothing skimmable; a blocking request is just more scrolling text; the common event type normalises for nobody. | |

**User's choice:** Structured feed, raw on demand
**Notes:** → D-32.

### Q3 — How much scrollback, given PROC-07 forbids memory growing with the transcript?

| Option | Description | Selected |
|--------|-------------|----------|
| All of it, windowed | Bounded in-memory window; scrolling up pages older events back from the persisted log — same shape as the board's virtualized windowed queries, proven at 1,000+ items. Flat memory by construction. | ✓ |
| Live tail, log for the rest | Fixed ring buffer, with a button to open the full log outside the app. Least code. Cost: reviewing an hour-old run means leaving Flywheel. | |
| Everything until a hard cap | Whole session in memory to a ceiling, then drop oldest with a truncation marker. Cost: satisfies PROC-07 by ceiling, and a long unattended run finds the ceiling. | |

**User's choice:** All of it, windowed
**Notes:** → D-33.

### Q4 — Where does the persisted session log live?

| Option | Description | Selected |
|--------|-------------|----------|
| Beside the database | `<app-data>/sessions/<run-id>.jsonl`, with a path reference on the session row. Follows D-14; matches DATA-06's `storage_ref` shape; outlives the worktree. | ✓ |
| Inside the worktree | `<worktree>/.flywheel/session-<run-id>.jsonl` — next to the code, greppable from the same terminal. Cost: written into the tree the agent is editing, could be committed, dies with the worktree. | |
| In the database | One store to back up, query and migrate. Cost: hundreds of MB of transcript in the file holding the board, carried by every migration. | |

**User's choice:** Beside the database
**Notes:** → D-34.

### Q5 — What should Stop mean? (PROC-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Graceful, then force | Interrupt, let the current tool call finish, kill the process group on timeout. Tree left dirty and inspectable; run closes as `interrupted`; nothing auto-committed. | ✓ |
| Graceful, then commit WIP | Same shutdown, then a WIP commit on the task branch so nothing can be lost. Cost: writes git history the user didn't author; Phase 3's premise is refusing to touch a dirty tree. | |
| Stop and also pause | Two verbs — Pause suspends and stays reattachable, Stop ends. Cost: a suspended agent still holds a session and a slot; reattach is the resume path already declined. | |

**User's choice:** Graceful, then force
**Notes:** → D-35. This was a fifth question in this area, asked because Stop semantics fall out of the
session-surface decisions rather than the permission gate.

### Continue check

**Chose "Next area"**, delegating the surface's keyboard entry point and a finished run's terminal
state to Claude.

---

## Permission gate

### Q1 — What permission mode does a session start in by default?

| Option | Description | Selected |
|--------|-------------|----------|
| Accept edits, ask for the rest | Agent edits freely inside its own worktree, stops for shell, network, anything outside the tree. Edits on a throwaway branch in an isolated worktree are the one class the topology already makes safe to undo. Launch sheet overrides per run. | ✓ |
| Ask every time | Every tool call waits. Safest posture; teaches you what the agent does. Cost: unusable unattended — changed on day one and never changed back. | |
| Plan first | Read-only until you approve an approach. Strongest fit with criteria agreed before work. Cost: two round trips per task, including the obvious ones. | |

**User's choice:** Accept edits, ask for the rest
**Notes:** → D-36.

### Q2 — How do you find out an agent has blocked, while looking elsewhere?

| Option | Description | Selected |
|--------|-------------|----------|
| Board-visible state + count | Distinct blocked state on the task row, plus a needs-you count on the project rail. Makes the board the answer to "what needs me?" — the per-project half of what FLEET-02 generalises. | ✓ |
| Only on the session surface | Blocking card in the feed and nowhere else. Smallest surface. Cost: an agent sits blocked and silent — the failure mode that sends people back to terminal tabs. | |
| OS notification too | Board state and count plus a macOS notification. Strongest signal. Cost: FLEET-04 owns notifications in Phase 10. | |

**User's choice:** Board-visible state + count
**Notes:** → D-37. OS notifications explicitly left to Phase 10.

### Q3 — Is there an "allow always", and what does it cover?

| Option | Description | Selected |
|--------|-------------|----------|
| Per project, this tool | Allow once / deny / allow this tool for this project — a stored, inspectable, revocable project-scoped rule. Prompt fatigue kills unattended running; the project is the honest blast radius. | ✓ |
| This session only | Nothing outlives the process. Cost: since every start is fresh, the same prompt returns on every run of every task. | |
| Globally, this tool | Fewest prompts ever. Cost: a rule granted on a scratch repo is live on production, long after you've forgotten granting it. | |

**User's choice:** Per project, this tool
**Notes:** → D-38.

### Q4 — Where is the credential path chosen? (AGNT-03/AGNT-04, criterion 5)

| Option | Description | Selected |
|--------|-------------|----------|
| Global default, project override | A Settings surface (the app's first) holds the default — local Claude Code login, or an API key in the macOS Keychain, never in the DB or a config file — and any project may override. Separates billing/risk per repo; keeps the boundary PITFALLS calls existential in one auditable place. | ✓ |
| Global only | One choice, one place. Cost: no per-repo separation without flipping a global switch. | |
| Per run, on the launch sheet | Decided in the moment, visible on every start. Cost: another decision dozens of times a day; no stable answer to "what is this project running on?" | |

**User's choice:** Global default, project override
**Notes:** → D-39.

### Continue check

**Chose "Wrap up"**, delegating where project-scoped allow rules are reviewed/revoked, what happens
to an unanswered request, and whether a denial kills the session or only that tool call.

---

## Final check

Offered a further round covering the Node sidecar's shape, how run/session/worktree records render on
a task, whether the DATA-04 trigger surfaces in v1, and mid-session steering. **Chose "I'm ready for
context"** — those are recorded in CONTEXT.md under Claude's Discretion, flagged as not-asked.

## Claude's Discretion

- The Node sidecar's shape — one process for all sessions vs one per session; Agent SDK vs shelling
  the user's own authenticated `claude` CLI. Flagged in CONTEXT.md as **not purely an implementation
  detail**, because `PITFALLS.md` pitfall 5 ties the choice directly to AGNT-03's auditability.
- How worktree / agent-run / session records render on a task (criterion 5), and what ten runs look like.
- Whether the DATA-04 trigger record surfaces in the UI at all, or exists purely as a schema row.
- Whether the user can type into a running session to steer it mid-task.
- What a failed or errored run looks like on the board and on the session surface.
- Slug drift on task rename, and directory-name collisions.
- Whether the `flywheel/` namespace and `~/Flywheel/` root are configurable (default: fixed).
- The precise field split across trigger / run / session / permission-request records.
- Where project-scoped allow rules are reviewed and revoked; unanswered-request timeout; whether a
  denial ends the session or only the tool call.
- The session surface's keyboard entry point and a finished run's terminal state.

## Deferred Ideas

- OS notifications on block/complete — FLEET-04, Phase 10.
- Cross-project needs-you queue — FLEET-02, Phase 10.
- Per-session cost/token display beyond a live strip — AGNT-08, Phase 10.
- Native session resume — adapter keeps `resumeSession` and `supportsResume`, unimplemented.
- Mid-session steering (interrupt/redirect) — table stakes per `FEATURES.md` §3, but unnamed by any
  Phase 2 criterion.
- Per-task / per-epic default permission profiles — belongs with fan-out, Phase 9.
- Correcting `RLAY-01` — carried forward unresolved from Phase 1 (D-21); milestone-boundary action.
