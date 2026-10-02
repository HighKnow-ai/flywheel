# Phase 7: The Board Tells The Git Truth - Research

**Researched:** 2026-10-02
**Domain:** Git/forge state surfacing (polling), commit-trailer round trip, status-transition automation
**Confidence:** HIGH for codebase integration points (read directly this session), MEDIUM for the
GitHub/GitLab CLI JSON contracts (probed live this session against public repositories, not this
project's own forge), LOW/ASSUMED for nothing load-bearing — every package-shaped claim in this
phase resolves to CLI tools already installed and authenticated on this machine, not a new
dependency.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Decision numbering continues from Phase 6 (D-01–D-22 Phase 1, D-23–D-40 Phase 2, D-41–D-63
Phase 3, D-64–D-79 Phase 4, D-80–D-96 Phase 5, D-97–D-112 Phase 6). This phase's locked
decisions are D-113 through D-130, copied verbatim from `07-CONTEXT.md`:

- **D-113:** One periodic tick in the Rust core is the single mechanism that notices a git
  change — re-reads tracked worktrees on a schedule, emits one event the frontend invalidates
  off (`app.emit(…)` → `useBoardQuery.ts`), via `tokio-cron-scheduler` 0.15. No filesystem
  watcher, no on-demand-only refresh. Worst case: board is at most one interval behind git.
- **D-114:** The tick is tiered — hot worktrees (live agent session or open detail panel) on a
  short interval, every other tracked worktree on a long one. A cold task may be up to a minute
  stale. Rejected: one flat interval; a fixed per-tick round-robin budget.
- **D-115:** A commit on a task's branch that no agent run produced is marked in the commit list
  ("made outside Flywheel") and written to the `events` trail with a timestamp. No new status,
  nothing interrupted. Rejected: unmarked rendering; a persistent board-card indicator requiring
  acknowledgement.
- **D-116:** Ahead/behind compares against `origin/<target>`, with `git fetch` on its own slower
  cadence and the figure labelled with its fetch age. Target is already derivable (D-25/D-26).
  Reversible. Rejected: comparing against the local target ref and never fetching; fetching
  every tick.
- **D-117:** A thin adapter shelling out to the user's installed `gh` and `glab` CLIs — no token
  for Flywheel to mint/store/rotate, both emit structured JSON, zero HTTP client in this
  workspace. Costly-to-reverse (re-deriving every forge field from a different response shape).
  Rejected: REST with a PAT in Keychain; CLI-first-with-REST-fallback.
- **D-118:** Flywheel opens the pull request itself, from an action on the item, pre-filled from
  the board item (title from the task, body from acceptance criteria and session summaries,
  target derived from the epic integration branch or trunk). Externally-opened requests are
  still detected regardless. Rejected: observe-only; agent-opens-it-as-last-act.
- **D-119:** The forge is auto-detected from the origin remote's host at project registration and
  stored as a per-project setting the user can override (`github.com` → `gh`, `gitlab.com` →
  `glab`, no remote → local-only). Rejected: pure derivation with nothing stored; asking the CLIs
  via `gh repo view`/`glab repo view`.
- **D-120:** With no forge configured, the forge section of the item panel is absent entirely —
  `WorktreeSummary.tsx`'s own "absence is the design" discipline. Rejected: a labelled empty
  state; a single project-level notice.
- **D-121:** Status transitions are edge-triggered and then hand the column back — the core
  writes a transition only when it observes forge state *change*, never re-asserts it on a later
  tick. Reconciles LINK-07 with D-29 ("nothing ever moves it out" except this mechanism's own
  forward edges). Costly-to-reverse. Rejected: level-triggered reconciliation on every tick;
  proposing the transition as a one-click suggestion.
- **D-122:** Only the two transitions LINK-07 names, and only forward: request opened →
  `in_review`, merged → `done`. Changes requested/closed-unmerged/CI failure render but move
  nothing. Rejected: adding the two backward moves; a full forge-projection mapping.
- **D-123:** A merge carries a task to Done even with unchecked acceptance criteria, and raises a
  visible unresolved marker plus an `events` row. Rejected: leaving criteria visibly unchecked
  with no marker; refusing the move and stopping at In Review.
- **D-124:** CI result is visible on the item with a link out to the run, and a failure also
  raises a board-visible flag (the D-37 blocked-agent treatment) but never changes status.
  Rejected: display-only with no board propagation; flagging plus returning to `in_progress`.
- **D-125:** Two trailers: `Flywheel-Task: <key>` and `Flywheel-Run: <run-id>`. The task key is
  not a choice (D-10's immutable-prefix argument); the run id is second because what the user
  usually wants from a surprising commit is the session that produced it. One-way (irreversible
  once stamped commits exist). Rejected: task key alone; adding `Flywheel-Epic:` as a third line.
- **D-126:** A `commit-msg` hook does the stamping, installed into the same per-project
  `core.hooksPath` directory `git_hooks.rs` already owns for the Phase 12 pre-push hook. Derives
  the task from the current branch name, appends trailers when absent, guarded to fire only on
  `flywheel/`-namespaced branches. **HARD CONSTRAINT:** every git invocation goes through
  `crate::git::git_at` — `packages/core/tests/supervisor_cwd.rs` asserts `Command::new("git")`
  appears exactly once in this workspace. Rejected: instructing the agent to write trailers
  itself; per-worktree `commit.template`/`trailer.*` git config.
- **D-127:** The existing command palette resolves git identifiers — `CommandPalette.tsx` learns
  to recognise a hex string or a `flywheel/…` branch name and resolve it to its item alongside
  normal results. Rejected: folding into `FilterBar.tsx`'s FTS search; a dedicated go-to-commit
  surface.
- **D-128:** Resolution reads git and stores nothing — a pasted hash is answered by asking git
  for the commit's trailers across registered repositories until one resolves (`git cat-file`/
  `git show -s`). Follows `drift.rs`'s D-75 discipline: derive at read time, never cache a
  verdict. Rejected: a sha→task index populated by the tick, with git as fallback; an index with
  no fallback.
- **D-129 (derived constraint, forced by D-126):** "Made outside Flywheel" is decided by
  agent-run coverage, not by trailer presence — because the `commit-msg` hook stamps every
  commit on a `flywheel/` branch, a hand-typed commit carries the same trailers as an agent's.
  D-115's marker must be computed from whether a recorded `agent_runs` range covers the commit
  (or committer identity), never from trailer absence.
- **D-130:** Two actions on the item, each running a configurable command template with the
  worktree path substituted — "Open in editor" defaulting to `code <path>`, "Open in terminal"
  defaulting to the system terminal. Retires `WorktreeSummary.tsx`'s own structural `<verify>`
  gate reserving this slot. Rejected: editor-only; revealing the folder in Finder.

### Claude's Discretion

- The exact interval values for D-114's hot and cold tiers, and for D-116's fetch cadence — pick
  defaults that are explainable, and make them constants in one place rather than settings.
- Whether the two tiers and the fetch live as one scheduler job with internal partitioning or as
  separate jobs — a structure question, not a behaviour question.
- The commit-list window on the item (how many commits render before "show more"), and the shape
  of the uncommitted-changes view, which should follow D-42's already-shipped
  `git status --porcelain`-as-rows rendering rather than inventing a second presentation.
- The precise trailer-block ordering and whether the hook writes them via
  `git interpret-trailers` or by direct append.
- How the forge adapter normalises GitHub's and GitLab's differing request-state and
  CI-conclusion vocabularies into one internal model — but the model itself is the CONV-06 seam
  and should be named explicitly, not left implicit in the adapter.
- Error presentation when `gh`/`glab` is installed but not authenticated, versus not installed
  at all — these are different user situations and should read differently, but the wording is
  discretion.

### Deferred Ideas (OUT OF SCOPE)

- **Backward status transitions** — changes-requested or closed-unmerged returning a task to
  In Progress. Rejected in D-122 for this phase; revisit only if forward-only proves to leave
  stalled tasks looking reviewed in practice.
- **Webhook-driven forge updates** — already a named future convenience (CONV-06). D-117's
  adapter and its normalised state model are the seam; nothing in this phase may assume polling
  is the only possible source.
- **A sha→task index** — rejected in D-128 as a second source of truth. If hash resolution for
  commits on removed worktrees ever becomes a real need, this is the shape it would take.
- **Epic-level rollup of git state** — how an epic summarises its tasks' branches and
  ahead/behind. Not raised, not scoped; a natural Phase 9 (fan-out) concern.
- **A `flywheel` CLI verb** (`flywheel open <sha>`) — the terminal-side half of D-127's round
  trip. No CLI surface exists in v1.
- **Not in this phase at all:** reviewing or merging a diff inside Flywheel (Phase 8), fan-out
  across many tasks (Phase 9), board-card visual density/placement (`/gsd-ui-phase 7` owns that
  contract).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| LINK-02 | Every board item shows its branch, its commits, and its current ahead/behind position relative to its integration target | Architecture Pattern 1 (ahead/behind via `rev-list --left-right --count`); reuses existing `git_at`, `worktree_list`; D-116's fetch-age labelling; Validation Architecture test row |
| LINK-03 | Commits produced by an agent carry the task identifier in a commit-message trailer, so `git log` alone reveals which board item produced any change | Architecture Pattern 2 (`commit-msg` hook, sibling to existing `pre-push` hook in `git_hooks.rs`); D-125/D-126 trailer spec; Pitfall 2 (namespace-guard correctness) |
| LINK-04 | User can navigate from a branch name or a commit hash back to the originating board item | D-127/D-128; `CommandPalette.tsx` extension point (read this session); Security Domain row on input validation for the pasted ref string |
| LINK-05 | A task's pull or merge request is linked to its board item, and the request's state is reflected on the item | Pattern 3 + Code Examples (`gh pr view --json state,...` / `glab mr view -F json`, both live-probed this session) |
| LINK-06 | Continuous-integration status for a task's branch is visible on its board item | Code Examples (`statusCheckRollup` array reduction for GitHub; `head_pipeline.status` for GitLab); Pitfall 1 (shape divergence) |
| LINK-07 | Board status transitions follow git and forge state — PR open moves to In Review, merge moves to Done | D-121/D-122; existing `set_task_status` (verified signature, no-op-on-redundant-write already built in); Open Question 1 (restart-safe edge baseline) |
| LINK-08 | Flywheel works against GitHub and GitLab, and degrades cleanly to local-only git when no forge is configured | D-119/D-120; Environment Availability table (both CLIs confirmed installed/authenticated); Validation Architecture `forge_degrade` test row |
| LINK-09 | User can see uncommitted changes in a task's worktree from the board without leaving the application | Reuses existing `git_status_porcelain` + `WorktreeRemovalDialog.tsx`'s already-shipped porcelain-as-rows pattern (D-42) |
| LINK-10 | Work performed outside Flywheel on a task's branch is detected and reflected, never silently overwritten | D-115/D-129 (agent-run-coverage-based detection, not trailer-based); `drift.rs`'s existing `StaleSinceLastSummary` detector already surfaces this to the next agent for free |
| LINK-11 | User can open a task's worktree in their own editor or terminal in one action | D-130; `WorktreeSummary.tsx`'s already-reserved slot (header comment confirms its own `<verify>` gate greps for this); `code` CLI confirmed installed this session as the default template |
</phase_requirements>

## Summary

Phase 7 adds no new runtime dependency and no new transport. Every mechanism it needs is either
already vendored and idle (`tokio-cron-scheduler` 0.15, declared in `packages/core/Cargo.toml`
since Phase 1/12 but never started), already the sole git entry point (`git::git_at`, with a
structural test forbidding a second `Command::new("git")` construction site), or a CLI binary the
developer already has installed and authenticated (`gh` 2.102.0, `glab` 1.120.0, both confirmed
present and logged in on this machine). The work is: (1) stand up one scheduler job with two
intervals plus a slower fetch job, reading git facts through the existing `git_at`/
`git_status_porcelain`/`diff_stat_and_names` functions and emitting through the existing
`app.emit("board:changed", …)` → `useBoardQuery.ts` invalidation path; (2) a `commit-msg` hook,
sibling to the already-shipped `pre-push` hook in `git_hooks.rs`, written into the same
`core.hooksPath` directory, appending two commit trailers derived from the branch name; (3) a thin
Rust module shelling out to `gh pr view --json …` / `glab mr view -F json`, normalizing both into
one internal forge-state enum, feeding `set_task_status` (the existing, schema-validated status
writer) through an edge-triggered check; (4) two new UI affordances (open-in-editor,
open-in-terminal) and one extension to the existing command palette.

**Primary recommendation:** Build the forge adapter as a pure shell-out-and-parse module with zero
new crates, verified this session against real `gh pr view --json` and `glab mr view -F json`
output on public repositories (not merely training-data recollection of their shapes) — the exact
field names below are drawn from those live probes, not assumed.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Git facts (branch, commits, ahead/behind, porcelain) | Rust core (`packages/core`) | Desktop UI (render only) | `git_at` is the sole git construction site; the core already owns every other git read (worktree summary, diff stat) |
| Scheduler tick (hot/cold tiers) | Rust core (`packages/core`, driven by `tokio-cron-scheduler` inside the Tauri runtime) | — | The scheduler must run where the git reads happen and where `app.emit` is reachable; `tokio` the async runtime lives in `packages/desktop/src-tauri`, not `packages/core` itself (core is sync) — core exposes a plain sync function, desktop's existing tokio runtime calls it on a schedule |
| Forge state (PR/MR state, CI result) | Rust core (shell-out adapter) | — | D-117: zero HTTP client in this workspace; the core already owns `credentials.rs`'s "no secret crosses argv" discipline this adapter inherits for free since `gh`/`glab` hold their own tokens |
| Commit-trailer stamping | Git itself, via `commit-msg` hook | Rust core (hook installer) | Must catch hand-typed commits with zero model compliance; `git_hooks.rs` already owns the per-project `core.hooksPath` directory this hook is installed into |
| Status transitions (In Review / Done) | Rust core (`domain::task::set_task_status`) | — | The schema CHECK constraint is the sole authority on valid status values; this phase's writer must go through the existing function, never update `tasks.status` directly |
| Git-identifier resolution (hash/branch → item) | Rust core (read-time git query) | Desktop UI (`CommandPalette.tsx`) | D-128: derived at read time from git itself, never a stored index — the core answers the query, the palette is just a new input source |
| Open-in-editor / open-in-terminal | Desktop UI (Tauri command invoking a shell) | — | A configurable command template substituting the worktree path; no new UI surface, extends `WorktreeSummary.tsx`'s already-reserved slot |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `tokio-cron-scheduler` | 0.15 (already in `packages/core/Cargo.toml:44`, confirmed via `Read` this session) `[VERIFIED: packages/core/Cargo.toml:44]` | D-113's periodic tick, D-116's fetch cadence | Already vendored specifically for this phase's trigger abstraction (`domain/trigger.rs:92` comment: "vendored in this... milestone"); starting it is this phase's first real use, not a new dependency |
| `gh` CLI | 2.102.0, installed and authenticated to `github.com` as `cymarechal` on this machine `[VERIFIED: gh --version / gh auth status, run this session]` | D-117's GitHub half of the forge adapter | Official GitHub CLI; emits structured `--json` output; inherits the developer's existing login, no token for Flywheel to mint |
| `glab` CLI | 1.120.0, installed and authenticated to `gitlab.com` as `cyril535` on this machine `[VERIFIED: glab --version / glab auth status, run this session]` | D-117's GitLab half of the forge adapter | Official GitLab CLI; `-F json` emits the raw GitLab REST MR object; same credential-inheritance property as `gh` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `code` CLI | VS Code 1.140.0, present at `/Applications/Visual Studio Code.app/...`, confirmed on `PATH` `[VERIFIED: which code / code --version, run this session]` | D-130's default "Open in editor" command template | Only as the *default* value of a configurable template — the user can override it; do not hard-code `code` as the only option |
| `rusqlite_migration` | 2.6 (already in `packages/core/Cargo.toml:30`) `[VERIFIED: packages/core/Cargo.toml:30]` | New migration for the per-project forge setting + any forge-state persistence | Already this crate's sole migration mechanism; this phase's migration (after `0016`) follows the identical `ALTER TABLE` + CHECK pattern `0005_credentials.sql` already used for `projects.credential_mode` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shelling out to `gh`/`glab` | A GitHub/GitLab REST client crate (e.g. `octocrab`, `gitlab` crate) with a stored PAT | D-117 already rejected this: it introduces the first HTTP client dependency into the core and a secret Flywheel must mint, store, rotate — explicitly against the project's credential posture (`credentials.rs`) |
| One scheduler job | A filesystem watcher (`notify` crate) | D-113 already rejected this: not a dependency today, one watcher per worktree does not scale with the fleet, and build-artifact noise would need filtering |

**Installation:** None. Every tool this phase needs is either already a declared Cargo dependency
or a CLI binary on the developer's own `PATH`. No `npm install`, no `cargo add`.

**Version verification:** `gh --version` → `2.102.0 (2026-09-30)`; `glab --version` →
`1.120.0 (78790114c)`; `cargo tree -p core | grep tokio-cron-scheduler` would confirm the exact
resolved version, but `Cargo.toml`'s own pin (`"0.15"`) was read directly this session and is the
authoritative source already. All version numbers above were observed by running the actual
command on this machine this session, not recalled from training data.

## Package Legitimacy Audit

**Not applicable.** This phase introduces zero new package-manager dependencies (no `npm install`,
no `cargo add`). Every tool used is either an existing workspace dependency (`tokio-cron-scheduler`,
`rusqlite_migration`) or a CLI binary the developer already has installed via their own package
manager (`gh`, `glab`, `code`) — none of these are resolved through this project's own
`Cargo.toml`/`package.json` and so carry no slopsquatting surface for this project's dependency
tree. The Package Legitimacy Gate is skipped per its own trigger condition ("whenever this phase
installs external packages").

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────────────────────┐
                     │        Rust core (packages/core)              │
                     │                                               │
  tokio-cron-        │  ┌──────────────┐      ┌──────────────────┐  │
  scheduler (desktop  │  │ hot tick job │──┐   │  fetch job        │  │
  src-tauri's tokio   │  │ (D-114, short)│  │   │  (D-116, slower)  │  │
  runtime drives it)──┼─▶│ cold tick job│  │   │  git fetch origin │  │
                     │  │ (D-114, long) │  │   └─────────┬────────┘  │
                     │  └──────┬───────┘  │             │           │
                     │         │           │             ▼           │
                     │         ▼           │   ┌───────────────────┐ │
                     │  git_at() / git_status_porcelain() /          │
                     │  diff_stat_and_names() / rev-list --count ─────┘│
                     │         │                                      │
                     │         ▼                                      │
                     │  domain::task::set_task_status() (D-121/D-122) │
                     │         │ (only on forge-state EDGE, never level)│
                     │         ▼                                      │
                     │  append_event() → events table (D-115/123/124) │
                     └─────────┬───────────────────────┬──────────────┘
                                │                       │
                     app.emit("board:changed")   forge adapter module
                                │                 (shells out to gh/glab,
                                ▼                  D-117)
                  ┌─────────────────────────┐            │
                  │ useBoardQuery.ts         │◀───────────┘
                  │ (TanStack Query          │   gh pr view --json / glab mr view -F json
                  │  invalidation, existing) │   (D-118 also: gh pr create / glab mr create)
                  └───────────┬─────────────┘
                              ▼
          ┌───────────────────────────────────────────┐
          │ WorktreeSummary.tsx (git facts + D-130      │
          │   open-in-editor/terminal actions)          │
          │ New forge section (D-120: absent if no      │
          │   forge configured)                          │
          │ CommandPalette.tsx (D-127: hash/branch →item)│
          │ ActivityTrail.tsx (D-115/123/124 event kinds)│
          └───────────────────────────────────────────┘

  Separately, on every commit (agent OR hand-typed) on a flywheel/-namespaced branch:
  git commit ──▶ commit-msg hook (new, sibling to git_hooks.rs's pre-push hook,
                  same core.hooksPath dir) ──▶ appends Flywheel-Task / Flywheel-Run trailers
```

### Recommended Project Structure
```
packages/core/src/
├── git.rs                  # existing — add ahead/behind read (rev-list --count) here
├── git_hooks.rs             # existing — add commit-msg install/uninstall beside pre-push
├── branch.rs                 # existing — task_branch_name() is the hook's lookup key
├── forge/                    # NEW module
│   ├── mod.rs                # normalized ForgeState enum (CONV-06 seam, named explicitly)
│   ├── github.rs              # gh pr view --json wrapper + parser
│   └── gitlab.rs              # glab mr view -F json wrapper + parser
├── scheduler.rs               # NEW — D-113/D-114 tick jobs + D-116 fetch job, started from desktop
└── db/migrations/
    └── 0017_forge_setting.sql # NEW — projects.forge column, forge-state persistence if any

packages/desktop/src/
├── board/CommandPalette.tsx   # extended — hash/branch resolution (D-127)
├── item-detail/
│   ├── WorktreeSummary.tsx    # extended — D-130 open-in-editor/terminal actions
│   └── ForgeSection.tsx        # NEW — PR/MR state + CI, absent when no forge (D-120)
```

### Pattern 1: Ahead/behind against a fetched remote ref, with staleness label
**What:** Compare the task branch to `origin/<integration-target>` via `git rev-list
--left-right --count <target>...<branch>`, where `<target>` is `origin/<epic-integration-branch>`
or `origin/<trunk>` (already derivable from D-25/D-26's branch-naming functions). The comparison
ref is updated only by the separate, slower `git fetch` job (D-116); the UI renders the
ahead/behind figure next to a "as of Xm ago" label sourced from when that fetch last succeeded.
**When to use:** Every git-facts read on an item with a worktree.
**Example:**
```rust
// Illustrative shape, following git.rs's existing one-call-per-function convention
// (git_status_porcelain, diff_stat_and_names). Not yet written — no such function exists in
// git.rs as of this session; this is the pattern to add, not a verified existing function.
pub fn ahead_behind(repo_path: &Path, target_ref: &str, branch: &str) -> anyhow::Result<(u32, u32)> {
    let output = git_at(repo_path, &["rev-list", "--left-right", "--count",
        &format!("{target_ref}...{branch}")])?;
    // stdout is "<behind>\t<ahead>" — left side is target_ref-only commits (behind),
    // right side is branch-only commits (ahead).
    let text = String::from_utf8_lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let behind = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let ahead = parts.next().unwrap_or("0").parse().unwrap_or(0);
    Ok((ahead, behind))
}
```

### Pattern 2: `commit-msg` hook deriving the task key from the branch name
**What:** A POSIX `sh` script, structurally identical in spirit to `git_hooks.rs`'s existing
`pre-push_hook_script` (same marker-comment-for-recognition idiom, same `core.hooksPath`
directory, same `flywheel/`-namespace guard), that reads the current branch via
`git rev-parse --abbrev-ref HEAD` (baked real-git path, not a `PATH` search — same discipline the
existing pre-push script already follows), extracts the task key from the `flywheel/<key>-<slug>`
shape, and appends two trailers to the commit message file git passes as `$1` — *only* if they are
not already present (so a `git commit --amend` or a cherry-pick does not duplicate them).
**When to use:** Installed once per project registration, alongside the existing pre-push hook
install, both living in `hooks_dir_for_repo(project_id)`.
**Example:**
```sh
# Illustrative — mirrors git_hooks.rs's existing pre-push_hook_script structure and baked-path
# convention. Not yet written.
#!/bin/sh
# flywheel-commit-msg-trailer: generated by packages/core/src/git_hooks.rs
FLYWHEEL_REAL_GIT='/usr/bin/git'
branch=$("$FLYWHEEL_REAL_GIT" rev-parse --abbrev-ref HEAD)
case "$branch" in
  flywheel/*) ;;
  *) exit 0 ;;   # untouched outside the flywheel/ namespace (D-126)
esac
task_key=$(echo "$branch" | sed -n 's#^flywheel/\([a-z0-9]*-[0-9]*\).*#\1#p')  # shape illustrative
if ! grep -q '^Flywheel-Task:' "$1"; then
  printf '\nFlywheel-Task: %s\nFlywheel-Run: %s\n' "$task_key" "${FLYWHEEL_RUN_ID:-manual}" >> "$1"
fi
exit 0
```
The exact derivation regex, trailer-append mechanism (`git interpret-trailers` vs. direct append),
and run-id sourcing (an env var the sidecar sets per-session vs. a lookup) are left to planning —
D-125/D-126 fix the two trailer *keys* and the *hook-based* mechanism, not the script's internals.

### Pattern 3: Normalizing GitHub and GitLab into one forge-state enum
**What:** `gh pr view --json state,statusCheckRollup,mergeStateStatus,reviewDecision` and
`glab mr view -F json` (optionally with `-R owner/repo`) return genuinely different JSON shapes —
confirmed by running both this session (see Code Examples below) — that must fold into one
internal enum before touching `set_task_status`.
**When to use:** Every forge-state read, GitHub or GitLab.
**Example:** see Code Examples section.

### Anti-Patterns to Avoid
- **Polling the forge on the same tick as the git-facts scheduler:** D-116 explicitly decouples
  network cost from the tick rate; `gh`/`glab` calls hit a real API rate limit the local git reads
  never do, so they belong on their own cadence, not piggybacked on the hot-tier tick.
- **Re-asserting status on every tick ("level-triggered"):** D-121 explicitly rejects this — a
  manual board move would snap back within one interval, which is the exact LINK-10 failure this
  phase exists to prevent.
- **Caching a sha→task index:** D-128 explicitly rejects this as a second source of truth about
  git that can disagree with git itself.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Talking to GitHub's/GitLab's API | A hand-rolled REST client with token management | `gh pr view --json` / `glab mr view -F json` | D-117: these CLIs already normalize auth, already emit structured JSON, and keep the token off this process's argv/env entirely |
| Deriving the task's branch name a second time | A parallel branch-name parser in the forge/scheduler modules | `branch::task_branch_name` / `branch::epic_integration_branch_name` (already exist) | One derivation function per name-kind is this crate's own established rule; a second copy risks silently drifting from D-24/D-25 |
| A cron/interval primitive | A hand-rolled `std::thread::sleep` loop | `tokio-cron-scheduler` (already vendored) | Already chosen and vendored specifically for this milestone's trigger abstraction — writing a sleep loop duplicates a dependency already paid for |
| Status-vocabulary validation | An app-level allow-list of valid statuses | The existing `status TEXT NOT NULL CHECK (status IN (...))` constraint (`0002_board_schema.sql:41,67`, confirmed via `Read` this session: `status TEXT NOT NULL CHECK (status IN ('backlog', 'todo', 'in_progress', 'in_review', 'done'))`) | `set_task_status` already defers to this constraint by design; this phase's D-121/D-122 writer must go through `set_task_status`, never bypass it |

**Key insight:** Every "don't hand-roll" item in this phase is not a third-party-library
substitution — it is "don't rebuild a function or mechanism this same codebase already built two
phases ago." The research risk here is drift from existing conventions, not missing an external
library.

## Common Pitfalls

### Pitfall 1: Treating `glab`'s JSON shape as a GitHub-shaped object
**What goes wrong:** `glab mr view -F json` returns the raw GitLab REST MR object (`state`:
`"opened"`/`"closed"`/`"merged"`, `head_pipeline.status`: `"running"`/`"success"`/`"failed"`/etc.,
`detailed_merge_status`), which is structurally unrelated to `gh pr view --json`'s GraphQL-shaped
object (`state`: `"OPEN"`/`"CLOSED"`/`"MERGED"`, `statusCheckRollup`: an array of per-check objects
with `conclusion`: `"SUCCESS"`/`"FAILURE"`/etc.). Both were confirmed live this session (see Code
Examples). A normalizer written against only one of the two, or against a half-remembered guess
of the other's shape, will silently misclassify forge state for whichever CLI it did not test
against.
**Why it happens:** Both tools market themselves as the CLI equivalent of each other, which
invites assuming shape parity that does not exist.
**How to avoid:** Build the GitHub and GitLab parsers as two separate, independently-tested
modules producing the same internal enum; test each against real `gh`/`glab` output (or a frozen
fixture of that real output) rather than against each other's assumed shape.
**Warning signs:** A CI-result pill rendering "unknown" for every GitLab MR but working for every
GitHub PR (or vice versa) is this pitfall manifesting.

### Pitfall 2: Trailer stamping that fires on the main checkout
**What goes wrong:** If the `commit-msg` hook's branch-namespace guard is missing or wrong, every
commit in the developer's main checkout (not just `flywheel/`-namespaced worktree branches) gets
stamped with trailers — since `core.hooksPath` is per-repository and shared by every linked
worktree, including the main checkout, per `git_hooks.rs`'s own header comment.
**Why it happens:** `core.hooksPath` is repo-wide, not worktree-scoped (this codebase does not
enable `extensions.worktreeConfig`, per the existing pre-push hook's header comment) — a hook
installed for "the task's worktree" actually fires for every worktree of that repository.
**How to avoid:** Mirror the pre-push hook's own territory-check idiom, but keyed on branch name
rather than `$PWD`: exit 0 immediately unless the current branch starts with `flywheel/`.
**Warning signs:** A commit made by hand in the main checkout, on `main` or any
non-`flywheel/`-prefixed branch, suddenly carries `Flywheel-Task:`/`Flywheel-Run:` trailers.

### Pitfall 3: Edge-triggered status writes that miss a transition because they poll too coarsely
**What goes wrong:** If the forge-state poll only ever compares "current forge state" to "last
known forge state" stored in memory (not persisted), an application restart between two polls
loses the "last known" baseline and re-fires a transition that already happened (e.g. re-opening
→ moves to In Review a second time, which is harmless since `set_task_status` no-ops on a
redundant transition — but if the restart happens between "opened" and "merged" with no edge
recorded, a fast open-and-merge cycle could be missed entirely if the only state ever observed
after restart is "merged" with no record of having already fired "opened").
**Why it happens:** D-121's edge-triggered design needs *some* durable record of "what forge state
did we last observe" to detect an edge across a restart — this is implicitly required by D-121 but
not named as a persisted column in the context document.
**How to avoid:** Persist the last-observed forge state per task (the `0017_forge_setting.sql`-era
migration, or a column on `tasks`/a new table) so a restart does not blind the edge detector. This
is a planning decision the context document's "Open Questions" territory should flag, not a
closed decision — D-121 only closes the behavior, not the storage shape.
**Warning signs:** A task that opens and merges its PR between two application restarts never
leaves "backlog"/"todo" on the board.

## Code Examples

### `gh pr view --json` — real field names (GitHub)
```bash
# Source: run against github.com/cli/cli this session (VERIFIED, not training recollection)
$ gh pr view --json 2>&1   # (no value) lists every available field name
# includes: state, statusCheckRollup, mergeStateStatus, reviewDecision, mergedAt, closedAt,
#           headRefName, baseRefName, url, isDraft, number, title, body

$ gh pr view 1 -R cli/cli --json state,statusCheckRollup,mergeStateStatus,reviewDecision,mergedAt,closedAt
{
  "closedAt": "2019-10-04T16:01:04Z",
  "mergeStateStatus": "DIRTY",
  "mergedAt": "2019-10-04T16:01:04Z",
  "reviewDecision": "",
  "state": "MERGED",
  "statusCheckRollup": []
}

$ gh pr list -R cli/cli --state open --json number,statusCheckRollup
# statusCheckRollup on an open PR is an array of per-check objects, each shaped:
{
  "__typename": "CheckRun",
  "completedAt": "2026-10-01T16:59:39Z",
  "conclusion": "SUCCESS",
  "detailsUrl": "https://github.com/cli/cli/actions/runs/.../job/...",
  "name": "label-external / label_issues",
  "startedAt": "2026-10-01T16:59:37Z",
  "status": "COMPLETED",
  "workflowName": "PR Triaging"
}
```
`state` values: `"OPEN"`, `"CLOSED"`, `"MERGED"` `[VERIFIED: live gh pr view run this session]`.
A CI rollup result for the whole PR requires folding `statusCheckRollup`'s array — there is no
single top-level "overall CI conclusion" field; the normalizer must reduce the array itself
(e.g. any `conclusion == "FAILURE"` → failed; all `"SUCCESS"`/`"SKIPPED"` → passed; any
`status != "COMPLETED"` → pending).

### `glab mr view -F json` — real field names (GitLab)
```bash
# Source: run against gitlab.com/gitlab-org/gitlab this session (VERIFIED, not training
# recollection) — glab 1.120.0
$ glab mr view 259243 -R gitlab-org/gitlab -F json
{
  "state": "opened",
  "detailed_merge_status": "unchecked",
  "merge_when_pipeline_succeeds": false,
  "head_pipeline": {
    "status": "running",
    "sha": "d90805b2f65b0bea3033b7ff68f80d03285ecbeb",
    "web_url": "https://gitlab.com/.../pipelines/2905533401",
    "detailed_status": {
      "icon": "status_running",
      "text": "Running",
      "label": "running",
      "group": "running"
    }
  }
  // ... plus: id, iid, target_branch, source_branch, title, description, author, web_url,
  // merged_at, closed_at, has_conflicts, sha, references.full
}
```
`state` values observed: `"opened"`, `"closed"`, `"merged"` `[VERIFIED: live glab mr view runs
this session, against both an old closed MR and a current open one]`. `head_pipeline` is `null`
when no pipeline has run against the MR's head SHA (observed on several merged/closed historical
MRs) — the normalizer must treat `null` as "no CI configured/run," not as a parse error.
`head_pipeline.status` values per GitLab's own pipeline status vocabulary include `"running"`,
`"success"`, `"failed"`, `"canceled"`, `"skipped"`, `"pending"` — only `"running"` was directly
observed this session; the rest are `[CITED: GitLab pipeline status enum, documented behavior]`
rather than independently re-verified here.

### Existing `set_task_status` call shape (reuse, do not reimplement)
```rust
// Source: packages/core/src/domain/task.rs:414-466, read this session (VERIFIED)
pub fn set_task_status(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    new_status: &str,
) -> anyhow::Result<()>
// No-ops (returns Ok, writes no event) when new_status == current status — D-121's
// edge-triggered transitions can call this directly on every poll without guarding against
// redundant writes themselves; the no-op guard already lives here.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Webhook-driven forge updates | Polling via `gh`/`glab` CLI on a scheduled tick | This phase (CONV-06 explicitly deferred) | Simpler, no public endpoint needed for a local-first desktop app; the forge-state model this phase names is the seam CONV-06 will later swap the transport under |

**Deprecated/outdated:** Nothing in this domain is deprecated — `gh`/`glab` JSON output and
`tokio-cron-scheduler` are all current, actively maintained tools as of this research.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GitLab pipeline status values beyond `"running"` (`"success"`, `"failed"`, `"canceled"`, `"skipped"`, `"pending"`) match the live `head_pipeline.status` field exactly as named | Code Examples, Pitfall 1 | If GitLab's actual runtime value differs from the documented set (e.g. a renamed status), the CI-result normalizer silently falls into an "unknown" bucket for that one status — low blast radius, would show as a missing pill rather than a wrong one |
| A2 | The exact task-key extraction regex from a `flywheel/<key>-<slug>` branch name in the `commit-msg` hook (Pattern 2's illustrative `sed`) | Code Examples, Pattern 2 | A wrong regex either fails to stamp trailers (silent, LINK-03 degrades) or stamps the wrong key (worse — a `git log` reader is now misled); must be tested against `branch::task_branch_name`'s actual output format before shipping |
| A3 | A durable "last observed forge state" must be persisted somewhere to make D-121's edge-triggering survive an application restart (Pitfall 3) | Common Pitfalls | If this is not planned for, a restart during an in-flight PR lifecycle could silently skip the In Review transition; this is a planning gap in the CONTEXT.md decisions, not a closed decision to follow, and should be raised explicitly to the planner |

**If this table is empty:** N/A — see rows above. Everything else load-bearing in this document
(package versions, JSON field names, existing function signatures, migration patterns, CLI
installation state) was independently confirmed by running a real command or reading a real file
this session.

## Open Questions

1. **Where does "last observed forge state" live for D-121's edge detection to survive a restart?**
   - What we know: D-121 requires edge-triggering ("writes a transition only when it observes
     forge state *change*"); `events` is append-only and queryable, so the LAST forge-related
     event for a task could itself serve as the baseline instead of a dedicated column.
   - What's unclear: whether CONTEXT.md intends a new `tasks` column, a new small table, or a
     derived read of the `events` stream's most recent forge-kind row.
   - Recommendation: planner should treat this as a schema decision for the `0017_forge_setting.sql`-era
     migration — deriving the baseline from the `events` log (querying the last `forge.*` event
     type per task) follows this crate's existing "derive at read time" (D-75/D-128) discipline
     more closely than a dedicated mutable column would, and avoids a second source of truth.

2. **Exact trailer-block format: `git interpret-trailers` or direct append?**
   - What we know: Claude's Discretion explicitly leaves this open; both approaches were
     functional in the illustrative hook script above.
   - What's unclear: whether `git interpret-trailers --in-place` handles the "append if absent,
     never duplicate" requirement more robustly than a `grep -q` guard plus `printf >>`.
   - Recommendation: `git interpret-trailers` is purpose-built for this and handles edge cases
     (existing trailing whitespace, an existing trailers block without a blank-line separator)
     that a hand-rolled `grep`+`printf` guard does not; prefer it unless the hook's POSIX-`sh`-only
     constraint (matching the existing pre-push hook) makes shelling out to `git interpret-trailers`
     from within the hook awkward — it should not, since the hook already shells out to
     `$FLYWHEEL_REAL_GIT` for other subcommands.

3. **Does `gh`/`glab` installed-but-unauthenticated vs. not-installed-at-all need two different Rust-side error variants, or just two different rendered strings over one variant?**
   - What we know: Claude's Discretion names this as a UX-wording question, not a behavior one.
   - What's unclear: whether the distinction (`command not found` vs. `gh auth status` exit
     non-zero) is cheap enough to detect that it's worth a typed variant versus stringifying the
     shell error.
   - Recommendation: detect both (a `which gh`-equivalent check, then `gh auth status`) and type
     them as two variants — the D-120 "forge section absent" behavior for "no forge configured"
     must not be conflated with "forge configured but gh is broken," which needs a *visible* error,
     not silent absence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `gh` CLI | D-117 GitHub adapter | ✓ (confirmed this session) | 2.102.0, authenticated to github.com | — |
| `glab` CLI | D-117 GitLab adapter | ✓ (confirmed this session) | 1.120.0, authenticated to gitlab.com | — |
| `git` | Every git read in this phase | ✓ (already a hard requirement of every prior phase) | — | — |
| `code` (VS Code CLI) | D-130 default editor-open template | ✓ (confirmed this session) | 1.140.0 | User can override the command template to any installed editor |
| A configured forge remote (`origin` pointing at github.com/gitlab.com or self-hosted) | D-119 auto-detection | Per-project, not a machine-level dependency | — | D-120: forge section renders absent entirely — this IS the designed fallback, not a gap |

**Missing dependencies with no fallback:** None identified — every dependency this phase needs is
already present and working on this development machine, and the one dependency that is
inherently per-project (a forge remote) already has a designed, tested-in-decisions fallback
(D-120's "absent entirely").

**Missing dependencies with fallback:** None beyond the editor-template override already covered
above.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Rust framework | `cargo test` (workspace-standard; existing integration tests live in `packages/core/tests/*.rs`, e.g. `drift.rs`, `hierarchy_workflow.rs`) |
| Frontend framework | Vitest (confirmed via `packages/desktop/package.json`'s `"test": "vitest run"` and `packages/desktop/vitest.config.ts`, existing tests e.g. `packages/desktop/src/board/__tests__/reorder.test.tsx`) |
| Config file | `packages/desktop/vitest.config.ts` (frontend); no separate Rust test config — `cargo test` reads `Cargo.toml` directly |
| Quick run command | `cargo test -p core --test <new_test_file> -- --exact <test_name>` (Rust); `cd packages/desktop && npx vitest run src/<path>/<file>.test.tsx` (frontend) |
| Full suite command | `cargo test --workspace` (Rust); `cd packages/desktop && npm test` (frontend) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LINK-02 | ahead/behind + commit list render correctly for a real worktree | unit (Rust) | `cargo test -p core --test git_facts` | ❌ Wave 0 |
| LINK-03 | `commit-msg` hook appends trailers on a `flywheel/`-branch commit, leaves others untouched | integration (Rust, real git repo in tempdir) | `cargo test -p core --test commit_msg_hook` | ❌ Wave 0 |
| LINK-04 | a pasted hash/branch resolves to its task via `CommandPalette.tsx` | unit (frontend) | `npx vitest run src/board/__tests__/command-palette-resolve.test.tsx` | ❌ Wave 0 |
| LINK-05/LINK-06 | GitHub and GitLab JSON both normalize to the same internal enum | unit (Rust, frozen fixture of live-probed JSON) | `cargo test -p core --test forge_normalize` | ❌ Wave 0 |
| LINK-07 | opening/merging a PR/MR triggers exactly the two named status transitions, never a third | unit (Rust, using `set_task_status` directly with synthetic forge-state transitions) | `cargo test -p core --test status_transitions` | ❌ Wave 0 |
| LINK-08 | with no forge remote, the forge section is absent; `gh`/`glab` are never invoked | unit (frontend) + unit (Rust, "no forge configured" path never shells out) | `cargo test -p core --test forge_degrade` | ❌ Wave 0 |
| LINK-09 | uncommitted changes render using the existing porcelain-as-rows pattern | unit (frontend, reusing `WorktreeRemovalDialog.tsx`'s existing porcelain test fixtures if any) | `npx vitest run src/item-detail/__tests__/*.test.tsx` | ❌ Wave 0 (new test file) |
| LINK-10 | a hand-typed commit on a tracked branch is detected and marked, never silently overwritten | integration (Rust, real git repo: commit via `git commit` directly, then run the tick) | `cargo test -p core --test outside_commit_detection` | ❌ Wave 0 |
| LINK-11 | "Open in editor"/"Open in terminal" invoke the configured template with the worktree path substituted | unit (frontend, mocking the Tauri `invoke` call) | `npx vitest run src/item-detail/__tests__/worktree-summary-open-actions.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the single new test file(s) the task touches, via the quick-run command above.
- **Per wave merge:** `cargo test --workspace` + `npm test` (frontend), matching existing phase conventions (e.g. Phase 2/3's own per-wave gates).
- **Phase gate:** Full suite green before `/gsd:verify-work`, per standing project convention.

### Wave 0 Gaps
- [ ] `packages/core/tests/git_facts.rs` — covers LINK-02 (ahead/behind, commit list)
- [ ] `packages/core/tests/commit_msg_hook.rs` — covers LINK-03
- [ ] `packages/core/tests/forge_normalize.rs` — covers LINK-05/LINK-06, built against frozen fixtures of the real `gh`/`glab` JSON captured this session (see Code Examples)
- [ ] `packages/core/tests/status_transitions.rs` — covers LINK-07, D-121/D-122's forward-only edge semantics
- [ ] `packages/core/tests/forge_degrade.rs` — covers LINK-08's no-forge-configured path
- [ ] `packages/core/tests/outside_commit_detection.rs` — covers LINK-10, D-115/D-129's agent-run-coverage-based (not trailer-based) detection
- [ ] `packages/desktop/src/board/__tests__/command-palette-resolve.test.tsx` — covers LINK-04
- [ ] `packages/desktop/src/item-detail/__tests__/worktree-summary-open-actions.test.tsx` — covers LINK-11
- [ ] No new test framework install needed — both `cargo test` and Vitest are already configured and used by this workspace

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | This phase authenticates nothing new — `gh`/`glab` own their own auth, inherited, never touched by Flywheel code |
| V3 Session Management | No | N/A |
| V4 Access Control | No | No new access-control surface; forge actions (open PR) are gated by the user's own forge-side permissions via the inherited CLI session |
| V5 Input Validation | Yes | The branch name parsed by the `commit-msg` hook and the task key extracted from it must be validated against `branch::FLYWHEEL_BRANCH_NAMESPACE`'s own format before being trusted as a lookup key; a hash/branch string pasted into `CommandPalette.tsx` must be validated as a plausible git ref shape before being passed to `git cat-file`/`git show -s` (D-128) to avoid argument-injection-shaped input reaching a shell-level git invocation |
| V6 Cryptography | No | N/A — no new secret material; D-117 explicitly keeps all forge credentials outside this process |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Argument injection via a pasted "hash" that is actually a git option (e.g. `--upload-pack=...`) reaching `git_at` | Tampering | `git_at` already requires `-C <repo_path>` as the first two args before any subcommand (PROC-02 ordering, confirmed in `git.rs`'s own header comment) — D-128's new resolution path must pass the pasted string strictly as a positional ref argument after `--`, never concatenated into a flag position, and should validate it matches a plausible hex/ref-name character set before shelling out at all |
| A malicious `pre-push`/`commit-msg` script displacing the developer's own hook chain | Tampering | `git_hooks.rs` already has this discipline for pre-push (refuse to install over a non-Flywheel `core.hooksPath` or a pre-existing default-dir `pre-push`); the new `commit-msg` install must apply the identical refusal logic, not a weaker check |
| A forge CLI emitting unexpected/malformed JSON (a future `gh`/`glab` version changing a field's type) silently miscategorizing PR/MR state | Tampering (of trust in a third-party tool) / Information Disclosure (wrong state shown) | Parse into a `serde_json::Value` first and match specific fields defensively (`.get("state").and_then(Value::as_str)`), never a brittle typed `serde::Deserialize` struct that panics or silently defaults on an unexpected shape — the existing crate's convention (`EventRow`, `DiffStat`) already favors explicit field access over blind struct deserialization for data crossing a process boundary |

## Sources

### Primary (HIGH confidence)
- `packages/core/src/git.rs` (full file header + function list) — read this session
- `packages/core/src/branch.rs` (full file) — read this session
- `packages/core/src/git_hooks.rs` (full file) — read this session
- `packages/core/src/drift.rs` (header + `DriftInputs`) — read this session
- `packages/core/src/domain/actor.rs` (full file through `system_actor`) — read this session
- `packages/core/src/domain/task.rs:410-466` (`set_task_status`) — read this session
- `packages/core/src/domain/settings.rs` (header + public API list) — read this session
- `packages/core/src/db/migrations/0002_board_schema.sql` (status CHECK) and `0005_credentials.sql` (full file, per-project override pattern) — read this session
- `packages/core/src/query/events.rs` (header + `EventRow`) — read this session
- `packages/core/Cargo.toml`, `packages/desktop/src-tauri/Cargo.toml` (full files) — read this session
- `packages/desktop/src/item-detail/WorktreeSummary.tsx` (header comment) — read this session
- `packages/desktop/src/board/CommandPalette.tsx` (header comment) — read this session
- Live `gh pr view --json`, `gh pr list --json`, `glab mr view -F json` runs against `cli/cli` and `gitlab-org/gitlab`/`gitlab-org/gitlab-foss` — run this session, real JSON captured

### Secondary (MEDIUM confidence)
- GitLab pipeline status enum values beyond `"running"` (`"success"`/`"failed"`/`"canceled"`/`"skipped"`/`"pending"`) — not independently re-verified against a live pipeline in each state this session, drawn from GitLab's documented status vocabulary

### Tertiary (LOW confidence)
- None — every claim in this document either traces to a file read this session, a command run
  this session, or is explicitly logged in the Assumptions Log above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; every version number confirmed by running the
  actual tool on this machine this session
- Architecture: HIGH — every integration point (git.rs, git_hooks.rs, branch.rs, task.rs,
  settings.rs, events.rs, useBoardQuery.ts's emit/invalidate path) was read directly, not recalled
- Forge JSON contracts: MEDIUM — GitHub's shape and GitLab's `opened`/`head_pipeline` shape were
  directly probed live this session against real public repositories (not this project's own
  forge, since this project has no open PR/MR yet); the full GitLab pipeline-status vocabulary
  beyond "running" is CITED, not independently re-observed in every state
- Pitfalls: HIGH for Pitfalls 1 and 2 (directly derived from the live-probed JSON and the existing
  `core.hooksPath` sharing behavior documented in `git_hooks.rs`'s own header); MEDIUM for Pitfall 3
  (a reasoned gap in the CONTEXT.md decisions, not an observed failure)

**Research date:** 2026-10-02
**Valid until:** 30 days for the codebase integration points (stable, this project's own code);
7 days for the `gh`/`glab` JSON field observations if either CLI receives a major version bump in
the interim — re-probe before relying on an exact field name if planning is delayed past that
window.
