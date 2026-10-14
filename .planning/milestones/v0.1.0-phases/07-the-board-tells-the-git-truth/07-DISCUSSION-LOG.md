# Phase 7: The Board Tells The Git Truth - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-02
**Phase:** 7-the-board-tells-the-git-truth
**Areas discussed:** Freshness & outside commits, Forge access & who opens the PR, Who owns the status column, Hash-to-task round trip, Opening the worktree (LINK-11)

---

## Freshness & outside commits

### What makes the board notice a git change, including a hand-typed commit?

| Option | Description | Selected |
|--------|-------------|----------|
| One periodic tick in Rust | A single scheduled job re-reads every tracked worktree on a fixed interval and emits one event the board invalidates off; reuses the existing emit→invalidate path and `tokio-cron-scheduler` | ✓ |
| Filesystem watcher per worktree | Add `notify` and watch each worktree's `.git` and working tree — near-instant, at the cost of a new dependency, one watcher per worktree and FSEvents noise filtering | |
| On demand only | Re-read on task open, board return or window focus — zero background cost, but the board can sit visibly stale | |
| Tick, plus watch the active ones | Tick as the floor, watcher on worktrees with a live session or open panel — fast where you look, two mechanisms to keep in agreement | |

**User's choice:** One periodic tick in Rust
**Notes:** There is no polling, no `refetchInterval` and no filesystem watcher anywhere in the codebase today; the only live-update mechanism is Rust `app.emit(…)` → `useBoardQuery.ts` invalidation.

### As the fleet grows to dozens of worktrees, what gives — cost or freshness?

| Option | Description | Selected |
|--------|-------------|----------|
| Tiered: hot fast, cold slow | Live-session or open-panel worktrees on a short interval, everything else on a long one | ✓ |
| One interval for everything | One number to reason about, no tiering logic — but git subprocess cost grows linearly with the fleet | |
| Fixed budget, round robin | Each tick refreshes the N stalest worktrees, so cost is constant and freshness degrades instead | |

**User's choice:** Tiered: hot fast, cold slow
**Notes:** Two intervals, one mechanism — explicitly not two mechanisms.

### What does the board do with a commit no agent run produced?

| Option | Description | Selected |
|--------|-------------|----------|
| Mark it and log it | A "made outside Flywheel" marker in the commit list plus one `events` row; reuses the events table and ActivityTrail | ✓ |
| Just show it, unmarked | Appears like any other commit; least code, but agent and human commits become indistinguishable | |
| Mark, log, and flag the item | Adds a persistent board-card indicator needing acknowledgement (the D-37 blocked-agent treatment) | |

**User's choice:** Mark it and log it
**Notes:** `drift.rs`'s existing `StaleSinceLastSummary` detector already carries outside work into the next agent's context packet for free, so this decision is purely about what the user sees.

### Which copy of the integration target does ahead/behind compare against?

| Option | Description | Selected |
|--------|-------------|----------|
| `origin/<target>`, fetched slowly | Compare against the remote-tracking ref, fetch on its own slower cadence, label the figure with its fetch age | ✓ |
| Local target ref only, never fetch | Zero network, works offline — but "behind: 0" is a lie whenever the local trunk is stale | |
| `origin/<target>`, fetched every tick | Always current — but a network round trip per repository per tick | |

**User's choice:** `origin/<target>`, fetched slowly
**Notes:** The target itself was already settled by D-25/D-26 — epic integration branch, or trunk for an epic-less task — so only the local-versus-remote question was open.

---

## Forge access & who opens the PR

### How does Flywheel learn the PR/MR state and CI result?

| Option | Description | Selected |
|--------|-------------|----------|
| Shell out to `gh` / `glab` | Thin adapter over the already-authenticated CLIs; no token to store, structured JSON output, core still makes zero network calls | ✓ |
| REST with a stored token | Add an HTTP client and a Keychain PAT via `credentials.rs`; one uniform transport, but a secret to guard and the first network dependency in the core | |
| CLI first, REST fallback | Works on every machine — but two complete implementations of one forge contract | |

**User's choice:** Shell out to `gh` / `glab`
**Notes:** No HTTP client exists anywhere in the workspace — no `reqwest`, no `ureq`. This also follows the project's standing preference for the developer's existing local credentials over a secret Flywheel stores.

### Who opens the pull request?

| Option | Description | Selected |
|--------|-------------|----------|
| Flywheel, from the item | An action on the task opens the PR via `gh`/`glab`, pre-filled from the board item — title, acceptance criteria, session summaries, derived target | ✓ |
| You open it, Flywheel watches | Observe-only; no create path and no body template, but the user leaves the app for the one action that advances the task | |
| The agent opens it, as its last act | A board tool alongside the summary — closes the loop unattended, but an agent misjudging "done" pushes and opens a real request | |

**User's choice:** Flywheel, from the item
**Notes:** Externally-opened requests are detected either way; LINK-05 requires the state to be reflected whoever opened it.

### How does Flywheel decide which forge a project has?

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect, with an override | Read the origin remote host at registration, store as a per-project setting the user can change — rescues self-hosted instances | ✓ |
| Auto-detect only, no setting | Pure derivation, nothing stored — but self-hosted silently degrades to local-only | |
| Ask the CLIs who claims it | `gh repo view` then `glab repo view`; the CLIs resolve their own hosts config — at two subprocess spawns per project | |

**User's choice:** Auto-detect, with an override

### What does the item panel look like with no forge configured?

| Option | Description | Selected |
|--------|-------------|----------|
| The forge section is absent | Nothing renders where PR state and CI would go; git facts render in full — `WorktreeSummary.tsx`'s absence-is-the-design discipline | ✓ |
| A labelled empty state | Discoverable, but permanent furniture on every item of a project that may never have a forge | |
| Absent, with one project-level notice | Discoverability without per-item cost — but a third place to look for a project's state | |

**User's choice:** The forge section is absent

---

## Who owns the status column

### Who writes the status when the forge says a PR opened?

| Option | Description | Selected |
|--------|-------------|----------|
| Edge-triggered, then hands off | The core writes the transition only on an observed change of forge state and never re-asserts it; a later manual move stands | ✓ |
| Automatic and authoritative | Every tick reconciles status to forge state — the board can never disagree, but a manual move snaps back within one interval | |
| Proposed, never applied | A one-click suggestion on the item; the user always owns the column, but the board asks rather than tells | |

**User's choice:** Edge-triggered, then hands off
**Notes:** This is what reconciles LINK-07 with D-29 ("nothing ever moves it out") — the mechanism is structurally incapable of overwriting a manual move in a loop, which is a stronger guarantee than a confirmation prompt. Attribution was not asked: the seeded "Flywheel" system actor in `0001_actors.sql` and `actor.rs`'s `system_actor()` are already documented for exactly this, making this phase their first real consumer.

### Which forge transitions move the column?

| Option | Description | Selected |
|--------|-------------|----------|
| Only those two, forward only | PR opened → In Review, merged → Done; everything else renders and moves nothing | ✓ |
| Add the two backward moves | Changes requested and closed-unmerged return to In Progress — tighter tracking, but backward moves read as the board second-guessing you | |
| Full mapping, forge drives the column | Maximally honest — but the columns stop being yours, and local-only projects follow different rules | |

**User's choice:** Only those two, forward only

### A merge carries a task to Done with unchecked acceptance criteria. What happens?

| Option | Description | Selected |
|--------|-------------|----------|
| Move it, and say so loudly | Status follows git; the unchecked criteria raise a visible unresolved marker plus an `events` row | ✓ |
| Move it, note it quietly | No new mechanism — but "Done with unmet criteria" becomes a state you scroll past | |
| Refuse the move | Criteria genuinely gate completion — but the board then openly contradicts git | |

**User's choice:** Move it, and say so loudly

### How far does a CI failure reach?

| Option | Description | Selected |
|--------|-------------|----------|
| Visible on the item, plus a flag | Indicator with a link out to the run, and a failure raises a board-visible flag (the D-37 treatment); never changes status | ✓ |
| Display only | Least machinery, no nagging — but a red build is only discoverable by opening the task | |
| Flag it and move it back | Closes the loop — but a flaky test reshuffles the board, contradicting forward-only | |

**User's choice:** Visible on the item, plus a flag

---

## Hash-to-task round trip

### How much goes in the trailer block?

| Option | Description | Selected |
|--------|-------------|----------|
| Task key and run id | `Flywheel-Task: <key>` plus `Flywheel-Run: <run-id>` — a hash resolves to the exact session, not just the task | ✓ |
| Task key only | Exactly what LINK-03/04 ask, smallest footprint — but you then match run history by timestamp | |
| Task, run, and epic | The whole hierarchy out of `git log` — but the epic is already one hop from the task | |

**User's choice:** Task key and run id
**Notes:** The key itself was not a question — D-10 enforces a project's key prefix as immutable once the first item key is allocated, with `project.rs` citing commit trailers as the reason.

### How does the trailer actually get onto a commit?

| Option | Description | Selected |
|--------|-------------|----------|
| A `commit-msg` hook | Installed into the per-project `core.hooksPath` directory `git_hooks.rs` already owns; derives the task from the branch, guarded to `flywheel/` branches; catches every commit including hand-typed ones | ✓ |
| Tell the agent to do it | Zero machinery — but depends on model compliance, and the user's own commits never get stamped | |
| Per-worktree git config | Declarative — but `commit.template` only pre-fills an interactive editor, and agents commit with `-m` | |

**User's choice:** A `commit-msg` hook
**Notes:** This forced a derived constraint (recorded as D-129): because the hook stamps every commit on a `flywheel/` branch, trailer presence can no longer distinguish an agent commit from a hand-typed one, so the "made outside Flywheel" marker must be computed from agent-run coverage instead.

### Where do you paste a hash to land on the board item?

| Option | Description | Selected |
|--------|-------------|----------|
| The existing command palette | `CommandPalette.tsx` learns to recognise a hex string or `flywheel/…` branch name; one entry point, no new surface | ✓ |
| The filter bar's search field | Also no new surface — but the filter bar narrows a visible list, the wrong gesture for resolving one off-screen item | |
| A dedicated go-to-commit surface | Purpose-built — but a third way to find things in an app that already has two | |

**User's choice:** The existing command palette

### Where does the answer come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Read git, store nothing | Ask git for the commit's trailers across registered repos — `drift.rs`'s D-75 derive-at-read-time discipline applied | ✓ |
| A sha-to-task index | Instant, answers even after a worktree is gone — but a second source of truth about git that can disagree with git | |
| Index only, no fallback | Simplest query — but a hash from a rebase or an un-ticked branch fails with git holding the answer | |

**User's choice:** Read git, store nothing

---

## Opening the worktree (LINK-11)

### What should the one action do?

| Option | Description | Selected |
|--------|-------------|----------|
| Two actions, both configurable | "Open in editor" and "Open in terminal", each a configurable command template with the worktree path substituted; defaults `code <path>` and the system terminal | ✓ |
| Editor only, configurable | Half the surface — but LINK-11 names "editor or terminal" | |
| Hand off to the OS | Reveal in Finder — zero configuration, but two more clicks than the requirement asks for | |

**User's choice:** Two actions, both configurable
**Notes:** `WorktreeSummary.tsx`'s header comment already reserves this slot and its own structural gate greps for its absence today; this decision retires that gate.

---

## Claude's Discretion

- Exact interval values for the hot and cold tiers and for the fetch cadence (constants in one place, not settings).
- Whether the tiers and the fetch are one scheduler job with internal partitioning or separate jobs.
- The commit-list window on the item, and the shape of the uncommitted-changes view (should follow D-42's already-shipped porcelain-as-rows rendering).
- Trailer-block ordering, and whether the hook uses `git interpret-trailers` or a direct append.
- How the forge adapter normalises GitHub's and GitLab's differing request-state and CI-conclusion vocabularies — but the normalised model must be named explicitly as the CONV-06 seam.
- Error wording for "CLI installed but not authenticated" versus "CLI not installed" — different situations, should read differently.
- Board-card density and placement were explicitly handed to `/gsd-ui-phase 7` rather than decided here.

## Deferred Ideas

- Backward status transitions (changes-requested or closed-unmerged → In Progress) — rejected for this phase.
- Webhook-driven forge updates — already CONV-06; the adapter's normalised state model is the seam.
- A sha→task index — rejected as a second source of truth; this is the shape it would take if hash resolution for removed worktrees ever becomes a real need.
- Epic-level rollup of git state — not raised, a natural Phase 9 concern.
- A `flywheel` CLI verb (`flywheel open <sha>`) — the terminal-side half of the round trip; no CLI surface exists in v1.
