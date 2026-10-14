# Phase 2: One Agent, One Worktree, Watched Live - Research

**Researched:** 2026-09-10
**Domain:** Process supervision of a headless Claude Code session inside a task-owned git worktree; a generic trigger abstraction; a windowed live-event feed with flat memory; the local-vs-API-key credential boundary.
**Confidence:** HIGH on the credential-policy finding and current CLI flag surface (verified today against `code.claude.com`, the live official docs domain); HIGH on schema/domain-module conventions (read directly from `packages/core` this session); MEDIUM on the Node-sidecar/Rust-supervisor split (no sidecar exists yet — this phase creates it, so there is no in-repo precedent to verify against, only the locked `.claude/CLAUDE.md` stack decision and today's docs); LOW/ASSUMED on UI layout specifics deferred to the planner and to `01-UI-SPEC.md`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Worktree and branch layout**
- **D-23:** Worktrees live in one visible, Flywheel-owned root outside every repository: `~/Flywheel/<PROJECT-KEY>/<TASK-KEY>/`. Reversibility: costly.
- **D-24:** A task branch is `flywheel/<task-key-lowercased>-<title-slug>` (e.g. `flywheel/thre-142-fts5-search-and-filters`). Slug fixed at creation, never rewritten on title change. Reversibility: one-way.
- **D-25:** The epic integration branch is `flywheel/epic/<epic-key-lowercased>-<title-slug>`, cut lazily from the trunk tip at the first Start Work under that epic, written to `epics.integration_branch` (already added by migration `0002_board_schema.sql`).
- **D-26:** A task with no epic branches straight off the trunk and targets it directly — `flywheel/thre-142-<slug>` → `project.default_branch`, no integration branch in between. Two fixed shapes, a pure function of `task.epic_id`.

**Start Work**
- **D-27:** Start Work opens a launch sheet before spawning anything — pre-filled briefing, optional free-text instruction, permission mode for this run; Enter starts it.
- **D-28:** Build `assembleContextPacket(taskId)` now, as a pure deterministic query (epic title/description, task title/description, every acceptance criterion with its verification hint, branch/worktree facts), rendered into the initial prompt. Never an LLM call. Reversibility: costly (Phase 4's CTX-04 tests are written against this function's contract).
- **D-29:** Starting a session moves the task to In Progress; nothing ever moves it out (an actor-attributed mutation, agent as actor).
- **D-30:** Every Start Work produces a fresh session on the reused worktree — dirty tree and all. Claude Code's native `--resume` is deliberately NOT used in v1; `resumeSession` stays in the adapter interface as a capability-gated, unimplemented method.

**Watching a session**
- **D-31:** The live session gets its own full surface, pushed into from a task and popped back out of; the board stays the board.
- **D-32:** The feed is structured (assistant text as prose, a tool call collapsed to one line that expands, a permission request as a blocking inline card, cost/token status strip), with the raw JSONL available on demand ("view raw").
- **D-33:** Full scrollback, delivered by a windowed read against the persisted log — same shape as the board's virtualized windowed queries. PROC-07 satisfied by construction, not by ceiling.
- **D-34:** The persisted session log lives beside the database, not in it and not in the worktree: `<app-data>/sessions/<agent-run-id>.jsonl`, with the run/session row holding a path reference.
- **D-35:** Stop means interrupt, then force. Send an interrupt, let the agent finish its current tool call and shut down cleanly; kill the process group if it hasn't exited within a short window. Worktree left exactly as the agent left it (dirty, inspectable). Run closes `interrupted`. Nothing committed on the user's behalf.

**Permission gate and credentials**
- **D-36:** Sessions default to accept-edits: agent writes freely inside its own worktree, stops for everything else (shell, network, anything outside the tree). Launch sheet overrides per run.
- **D-37:** A blocked agent is visible on the board, not only on the session surface — distinct blocked task-row state, project-rail count. OS notifications deliberately NOT built here (Phase 10, FLEET-04).
- **D-38:** Allow-always is scoped per project, per tool — allow once / deny / allow this tool for this project from now on, stored as a revocable project-scoped rule.
- **D-39:** The credential path is a global default with a per-project override; this phase introduces the application's first Settings surface. The API key is held in the macOS Keychain, never in SQLite, never in a config file. Nothing else in the product behaves differently between the two paths (success criterion 5). Reversibility: costly.

### Claude's Discretion

- **The Node sidecar's shape.** No sidecar exists yet — this phase creates it. Open: one long-lived process hosting all sessions vs. one process per session; and whether it drives `@anthropic-ai/claude-agent-sdk` or shells out to the user's own already-authenticated `claude` CLI in headless `-p --output-format stream-json` mode. Explicitly flagged as bearing on D-39/AGNT-03 via `PITFALLS.md` pitfall 5. **Resolved by this research — see "The sidecar-shape decision" below.**
- How the worktree, agent-run and session records render on a task (success criterion 5).
- Whether the DATA-04 trigger record surfaces in the UI at all in v1, or exists purely as a schema row and an event.
- Whether the user can type into a running session to steer it mid-task — default to out unless nearly free.
- What a failed or errored run looks like on the board and on the session surface.
- Slug drift and collisions on task rename after work started, and duplicate directory-name handling.
- Whether the `flywheel/` branch namespace and `~/Flywheel/` worktree root are configurable — default to fixed.
- The exact shape of the trigger→run→session record split — field lists are a planning concern.

### Deferred Ideas (OUT OF SCOPE)

- OS notifications when an agent blocks or completes (Phase 10, FLEET-04).
- Cross-project "needs you" queue (Phase 10, FLEET-02).
- Per-session cost/token display beyond a live status strip (Phase 10, AGNT-08) — the adapter's `cost_update` event exists from this phase, data available early.
- Native session resume (`--resume`) — kept as an unimplemented, capability-gated adapter method.
- Typing into a running session to steer it mid-task.
- A per-task or per-epic default permission profile (Phase 9, fan-out).
- Correcting `RLAY-01` in `REQUIREMENTS.md` — unrelated requirements-pass action, not this phase.

Also explicitly NOT in this phase (from the Phase Boundary): crash recovery, orphaned-process reaping, index-lock backoff, staggered spawn timing, the refuse-to-destroy-a-dirty-worktree guard, destructive-action confirmation (all Phase 3); structured session summaries and context reconstitution beyond the D-28 stub (Phase 4); Socratic authoring (Phase 5); the agent→board write path and proposal triage (Phase 6); branch/commit/PR status on the board (Phase 7); diff review and merge (Phase 8); planner fan-out (Phase 9); fleet view, OS notifications, disk reclamation, cost display (Phase 10).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-04 | Agent work started through a generic trigger record (`user_action` implemented, `schedule`/`webhook` accepted-but-unimplemented) | "Trigger table" in Architecture Patterns; CHECK-constrained `source` column pattern verified against `0002_board_schema.sql`'s own CHECK-constraint style |
| DATA-06 | Worktrees, agent runs, sessions, session summaries, artifacts are first-class records | Domain Schema section; migration `0003` field lists; existing `events`/transactional-outbox pattern read from `packages/core/src/domain/event.rs` |
| WORK-01 | Starting work creates a dedicated git worktree for that task | Worktree layout (D-23/D-24), `git worktree add` command sketch |
| WORK-02 | Fixed branch topology: task branch → epic integration branch → trunk | D-25/D-26 "two fixed shapes" resolution; epic-integration lazy-cut logic |
| WORK-08 | A task's worktree persists across many sessions, removed only on explicit action | D-30's "reuse, don't recreate" logic; `Worktree` row existence check before `git worktree add` |
| LINK-01 | Every task bound to exactly one branch whose name derives from the task identifier | D-24 branch-naming scheme, verified recognisable-from-terminal test |
| PROC-01 | Each agent session runs as a separate OS process in its own worktree directory | Process Topology; sidecar spawns `claude` CLI with explicit `cwd` |
| PROC-02 | Supervisor never reads its own cwd; every git/fs call takes an explicit absolute path | Anti-Pattern 3 (already governs this codebase); `gitAt(absPath, args)` wrapper pattern |
| PROC-06 | User can interrupt/stop a session at any time; worktree left consistent and inspectable | D-35 SIGINT-then-SIGTERM mapping, verified against `code.claude.com/docs/en/headless` |
| PROC-07 | Agent output streamed live without unbounded memory growth | D-33/D-34 windowed-read-against-persisted-JSONL design, modeled on `query::events::activity_trail`'s existing `LIMIT`/`OFFSET` pattern |
| AGNT-01 | All agent interaction goes through a single adapter interface; no supervisor code branches on backend | `AgentAdapter`/`AgentEvent` contract (ARCHITECTURE.md §5, verified compatible with today's CLI flag surface) |
| AGNT-02 | Claude Code adapter drives headless sessions, normalises event stream | `claude -p --output-format stream-json` event mapping table |
| AGNT-03 | Agents run using the developer's existing local credentials, none leaving the machine | **The sidecar-shape decision** — resolves in favor of shelling out to the raw `claude` CLI, never the Agent SDK library, for this path |
| AGNT-04 | Explicit API-key credential path, first-class | Keychain storage via `keyring` crate; `ANTHROPIC_API_KEY`/`--bare` mechanics |
| AGNT-06 | Permission requests surface to the user and block the agent until answered | `--permission-prompt-tool` MCP mechanism, verified against `code.claude.com/docs/en/cli-reference` |
</phase_requirements>

## Summary

Phase 2's hardest technical question — what the not-yet-existing Node sidecar actually drives — has a definitive, evidence-based answer that the CONTEXT.md discretion note only speculated about: **Anthropic's own current documentation states outright that products built on `@anthropic-ai/claude-agent-sdk` may not use the developer's `claude.ai`/subscription login; they must use an API key.** ("Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods... instead." — `code.claude.com/docs/en/agent-sdk/overview`, fetched today.) This single sentence resolves AGNT-03 (local credentials) and the sidecar-shape discretion item in one motion: **the Node sidecar must drive sessions by spawning the raw `claude` CLI binary as a subprocess** (`claude -p --output-format stream-json`), never by calling the `@anthropic-ai/claude-agent-sdk` library's `query()` function — because the CLI, run non-interactively without `--bare`, reads the user's existing OAuth session straight out of the system keychain (confirmed by the same docs: "bare mode doesn't use your subscription login... In bare mode, Claude Code never reads OAuth credentials or the system keychain"), while the SDK is now explicitly barred from that credential path for third-party products. This also means PITFALLS.md pitfall 5's "existential, outside Flywheel's control" risk is not merely a future possibility to hedge against — Anthropic already exercised it (Feb 2026 policy clarification, independently corroborated by four 2026 tech-press sources), and D-39's decision to make the API-key path first-class from day one, in exactly one auditable place, is the correct response already locked in.

The rest of the adapter surface maps cleanly onto today's CLI: `--output-format stream-json` for the normalized event stream, `--permission-mode acceptEdits` for D-36's default, `--permission-prompt-tool <mcp-tool>` for AGNT-06's blocking permission gate (the sidecar hosts a small MCP server that holds each request open until the Rust core relays the user's board answer back through it), and SIGINT-then-SIGTERM-of-the-process-group for D-35's "interrupt, then force" (SIGINT ends the current turn cleanly and produces a result; SIGTERM is the hard stop). None of this requires `--resume` (D-30 declines it) or `--input-format stream-json` (mid-session steering is deferred). The domain-schema and windowed-log patterns this phase needs already have working precedent in `packages/core` — `domain::event::append_event`/`next_sequence` is the exact transactional-outbox shape migration `0003`'s new tables must follow, and `query::events::activity_trail`'s `LIMIT`/`OFFSET` read is the direct model for D-33's windowed session-log read.

**Primary recommendation:** Build migration `0003` (worktrees, agent_runs, sessions, triggers, permission_requests) following `0002`'s CHECK-constraint-as-authority style exactly; add `tokio` (not yet a dependency anywhere in this workspace) and `tauri-plugin-shell` to the desktop crate for sidecar spawn/lifecycle, and `keyring` (with the `apple-native-keyring-store` feature explicitly enabled — it is off by default) to `core` for D-39's Keychain storage; scaffold a new `packages/sidecar` Node package whose only two jobs are (a) spawn `claude` CLI headlessly and forward its JSONL stream, and (b) host the permission-prompt MCP server — never import `@anthropic-ai/claude-agent-sdk`'s session-driving API for the local-credential path.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Worktree creation/reuse, branch naming | API/Backend (Rust core) | — | Git plumbing is explicit-path, cwd-independent Supervisor work (PROC-02); already the pattern for every other mutation in `packages/core` |
| Trigger record + `startAgentRun` command | API/Backend (Rust core) | — | DATA-04's schema-and-handler seam; must be indifferent to producer, which only Supervisor-side code can guarantee |
| Claude Code process spawn + JSONL parsing | Node sidecar | — | `.claude/CLAUDE.md`'s locked stack decision; TS-first JSONL/event parsing is materially easier than a from-scratch Rust reimplementation |
| Permission-prompt MCP server | Node sidecar | Rust core (relays board answer) | The MCP protocol implementation lives naturally in Node (official `@modelcontextprotocol/sdk`); the *decision* (board answer, allow-always rule) is Rust-core state the sidecar must ask for over its own IPC channel — never decided sidecar-side |
| Credential resolution (local vs. API key) | Rust core (Settings) + Keychain | Node sidecar (receives resolved env) | D-39: exactly one explicit, auditable place; the sidecar only ever receives an already-resolved environment, never reads Settings itself |
| Session event feed rendering | Browser/Client (React) | — | D-31/D-32's structured feed is pure presentation over normalized `AgentEvent` rows the Rust core already persisted |
| Session log persistence (JSONL) | Rust core (writes the file) | — | D-34: durable, independent of UI render path (PITFALLS.md pitfall 10) — the sidecar forwards; the Rust core is the one writer of record |
| Windowed session-log read | API/Backend (Rust core) | Browser/Client (virtualization) | Mirrors `query::events::activity_trail`'s existing `LIMIT`/`OFFSET` split: Rust core owns the bounded read, React owns the scroll-triggered window |
| Board-visible "blocked" state | Browser/Client (render) | API/Backend (the mutation) | D-37: the task-row state itself is a normal actor-attributed mutation (agent as actor), rendered by the same marks/legend system as every other status |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `claude` CLI (the standalone binary, not a library) | current, invoked via `-p` | Drives the actual agent session, using the user's own local OAuth session or `ANTHROPIC_API_KEY` | `[CITED: code.claude.com/docs/en/agent-sdk/overview]` — the only path Anthropic's current docs permit for the local-subscription-credential requirement (AGNT-03); the Agent SDK library is explicitly excluded from that path |
| `tokio` | 1.53.1 `[VERIFIED: cargo add --dry-run against crates.io, 2026-09-10]` | Async runtime in `packages/desktop/src-tauri` for process supervision (spawn, health-check, process-group kill) | Not currently a dependency anywhere in this workspace — must be added this phase. `full` feature bundle (`process`, `signal`, `rt-multi-thread`, `macros`) covers spawn + signal handling |
| `tauri-plugin-shell` | 2.3.6 `[VERIFIED: cargo add --dry-run against crates.io, 2026-09-10]` | Tauri's sidecar-spawn/lifecycle plugin (`app.shell().sidecar(...)`) | `[CITED: v2.tauri.app/develop/sidecar]` — the documented, first-class mechanism for the `externalBin` sidecar pattern `.claude/CLAUDE.md` already commits to |
| `keyring` | 4.2.0, with `--features apple-native-keyring-store` `[VERIFIED: cargo add --dry-run against crates.io, 2026-09-10]` | macOS Keychain storage for the API key (D-39) | `apple-native-keyring-store` is **not** a default feature (confirmed by the dry-run's feature list: default is `v1`, `windows-native-keyring-store`, `zbus-secret-service-keyring-store` only) — must be explicitly enabled or the crate silently has no macOS backend |
| `@modelcontextprotocol/sdk` (Node, sidecar) | current | Implements the permission-prompt MCP server `claude -p --permission-prompt-tool` connects to | Official Anthropic-adjacent TypeScript MCP SDK; matches the "TS-first" rationale `.claude/CLAUDE.md` already gives for the sidecar's existence |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `rusqlite_migration` | 2.6 `[VERIFIED: cargo add --dry-run, matches existing pin]` | Migration `0003` (worktrees/agent_runs/sessions/triggers/permission_requests) | Already the project's migration mechanism — no new tool, just the next numbered file |
| `tokio-cron-scheduler` | 0.15.1 `[VERIFIED: cargo add --dry-run against crates.io, 2026-09-10]` | Vendor-now, wire-later per `.claude/CLAUDE.md` — the `schedule` trigger stub | Add the dependency and stub the "cron tick" trigger type now so DATA-04's `schedule` source is a drop-in later; do **not** wire it to any running scheduler in this phase (out of scope) |
| `git2` | current (already researched, not newly needed this phase) | NOT used for worktree lifecycle | Reserved for future hot-path reads (diff review, Phase 8) — this phase's worktree create/reuse goes through the system `git` CLI, matching `.claude/CLAUDE.md`'s explicit "shell out for worktree ops" rule |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell out to raw `claude` CLI for the local-credential path | `@anthropic-ai/claude-agent-sdk`'s `query()` | Rejected outright — current Anthropic docs explicitly forbid third-party products from using subscription/`claude.ai` login through the SDK; using it for AGNT-03 would build the product on a documented ToS violation |
| `keyring` crate for Keychain access | `security-framework` crate directly | `security-framework` is the lower-level macOS-only binding `keyring` already wraps; `keyring` was chosen for the identical cross-platform API surface a future Windows/Linux build would want, at zero extra cost today |
| System `git` CLI for worktree add/remove | `git2-rs` | Already settled in `.claude/CLAUDE.md`/`STACK.md` — libgit2 measurably lags the CLI on worktree edge cases; not re-litigated here |

**Installation:**
```bash
# packages/desktop/src-tauri/Cargo.toml
cargo add tokio --features process,signal,rt-multi-thread,macros
cargo add tauri-plugin-shell

# packages/core/Cargo.toml
cargo add keyring --features apple-native-keyring-store
cargo add tokio-cron-scheduler   # vendored, unwired — DATA-04 stub only

# new packages/sidecar (Node)
mkdir -p packages/sidecar && cd packages/sidecar
npm init -y
npm install @modelcontextprotocol/sdk
npm install -D pkg typescript
# NOTE: do NOT `npm install @anthropic-ai/claude-agent-sdk` for the session-driving path —
# see "The sidecar-shape decision" below. It may still be useful later, narrowly, for the
# API-key path only, but Phase 2 does not need it: spawning the `claude` binary directly
# works identically for both credential paths and keeps exactly one code path (AGNT-01's
# "no supervisor code branches" spirit, applied to credential handling too).
```

**Version verification:** All Rust crate versions above were confirmed via `cargo add --dry-run` against the live crates.io index on 2026-09-10 from within this repository's own `Cargo.toml` context (not training-data recall). `claude` CLI flag names were confirmed today against the live `code.claude.com` docs.

## Package Legitimacy Audit

| Package | Registry | Age (latest publish) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `node-pty` | npm | Dec 2025 | 5.05M/wk | github.com/microsoft/node-pty | OK | Approved — **not needed this phase** (headless `-p` needs no PTY); keep for a future "attach and watch" feature only |
| `keyring` | crates.io | 2016 (crate), 4.2.0 latest | 787K/wk | github.com/open-source-cooperative/keyring-rs | OK | Approved |
| `security-framework` | crates.io | 2015 (crate) | 6.26M/wk | github.com/kornelski/rust-security-framework | OK | Not directly used — `keyring`'s own dependency |
| `tokio-cron-scheduler` | crates.io | 2021 (crate) | 130K/wk | github.com/mvniekerk/tokio-cron-scheduler | OK | Approved |
| `git2` | crates.io | 2014 (crate) | 1.2M/wk | github.com/rust-lang/git2-rs | OK | Not used this phase (reserved for Phase 8) |
| `tokio` | crates.io | 2016 (crate) | 17.0M/wk | github.com/tokio-rs/tokio | OK | Approved |
| `tauri-plugin-shell` | crates.io | 2.3.6 latest | — (official Tauri plugin, part of the tauri-apps org) | github.com/tauri-apps/tauri-plugin-shell | OK | Approved |
| `@anthropic-ai/claude-agent-sdk` | npm | Sept 2026 (weekly release cadence) | 12.79M/wk | github.com/anthropics/claude-agent-sdk-typescript | SUS (`too-new`, per the legitimacy seam's age heuristic) | **Flagged by the automated check, but manually cleared**: official `anthropics` GitHub org, 12.79M weekly downloads. The `too-new` flag is a false positive of the SDK's own weekly-release cadence (STACK.md already documented this), not a legitimacy concern. **Not installed this phase regardless** — see the sidecar-shape decision; if a later phase adds the API-key-only path via this library, re-run this check at that time |
| `@tanstack/react-virtual` | npm | Sept 2026 | 20.9M/wk | github.com/TanStack/virtual | SUS (`too-new`) | Same false-positive pattern; already an existing dependency in `packages/desktop/package.json` (3.14.11), not newly introduced — no action needed |
| `@modelcontextprotocol/sdk` | npm | not independently checked this session | — | modelcontextprotocol org | `[ASSUMED]` | **Planner must run the Package Legitimacy Gate on this package before it is installed** — it was not run against the seam in this research session; treat as unverified until then |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** `@anthropic-ai/claude-agent-sdk`, `@tanstack/react-virtual` — both manually cleared above on downloads/repo-authenticity grounds; neither requires a `checkpoint:human-verify` gate given the evidence. `@modelcontextprotocol/sdk` was **not** run through the legitimacy seam this session — the planner must gate its install behind `checkpoint:human-verify` until it is.

## Architecture Patterns

### The sidecar-shape decision

This is the load-bearing finding of this research pass, so it is stated once, precisely, before anything else:

> "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
> `[CITED: code.claude.com/docs/en/agent-sdk/overview, fetched 2026-09-10]`

And, on the raw CLI's own non-interactive mode:

> "Set `ANTHROPIC_API_KEY` before running it, because bare mode doesn't use your subscription login... In bare mode, Claude Code never reads OAuth credentials or the system keychain."
> `[CITED: code.claude.com/docs/en/headless, fetched 2026-09-10]`

Read together: **without `--bare`, `claude -p` reads the user's subscription OAuth session from the system keychain** — this is the AGNT-03 mechanism. The Agent SDK library is a *different* distribution channel that Anthropic's docs explicitly exclude from that credential path for third-party products. Independently, four 2026 tech-press sources (GIGAZINE, The Register, WinBuzzer, aihackers.net) corroborate that this is an enforced Feb 2026 policy clarification, not a hypothetical — `PITFALLS.md` pitfall 5 already cited the same event (`alternativeto.net/news/2026/2/...`), so this finding sharpens rather than contradicts the existing research corpus.

**Consequence for the adapter implementation:**
- **Local-credential path (AGNT-03):** sidecar spawns `claude -p ...` (no `--bare`), inheriting the user's OS-level environment so the CLI resolves its own already-stored OAuth session exactly as it would in a terminal.
- **API-key path (AGNT-04):** sidecar spawns the identical `claude -p ...` invocation, with `ANTHROPIC_API_KEY` set in the child process's environment from a value the Rust core reads out of the Keychain immediately before spawn (never persisted to the sidecar's own state). Whether `--bare` should also be passed to *force* API-key-only and prevent an accidental silent fallback to subscription credentials when both are present is an open mechanical question this research could not settle from documentation alone — the docs describe `--bare`'s effect but do not state precedence when `ANTHROPIC_API_KEY` is set *without* `--bare` while a keychain OAuth session also exists. `[ASSUMED]` — **the planner should treat this as a fast, cheap empirical check** (spawn `claude -p` with both present, observe which credential the `system/init` event or billing reflects) rather than a blocked decision; low cost to verify, high cost to get wrong for D-39's "a client repository bills to an API key" guarantee.
- **Either path never imports `@anthropic-ai/claude-agent-sdk`'s session-driving `query()` API.** The library may still be worth adding *narrowly*, later, purely for its typed MCP-server-hosting helpers if `@modelcontextprotocol/sdk` alone proves awkward — but that is a Phase-2-optional implementation choice, not a credential-path requirement.

This resolves the CONTEXT.md "Claude's Discretion" item completely: the sidecar is a thin process driver plus an MCP permission server, never an Agent-SDK-hosted session.

### Process Topology (adopted from ARCHITECTURE.md §1, unchanged by this research)

```
┌─────────────────────────────────────────────────────────────────┐
│  RENDERER (React)                                                 │
│  Session surface (D-31) · board task row (D-37 blocked state)     │
│  No filesystem/git access — talks to Rust core via tauri.ts only  │
└───────────────────────────────┬───────────────────────────────---┘
                                 │ invoke / subscribeBoardChanged (existing seam)
┌───────────────────────────────▼───────────────────────────────────┐
│  RUST CORE (Tauri, packages/desktop/src-tauri)                     │
│  • AppState.db: Mutex<Connection> (existing) — worktrees,          │
│    agent_runs, sessions, triggers, permission_requests (new)       │
│  • Worktree manager: git -C <abs path> ... (explicit path, PROC-02)│
│  • Credential resolver: Settings + Keychain (`keyring` crate)      │
│  • Sidecar supervisor: spawn via tauri-plugin-shell, own cwd never │
│    read, never reassigned (PROC-02 — matches this crate's existing │
│    discipline, e.g. domain::event never takes an implicit path)    │
│  • Session log writer: <app-data>/sessions/<agent-run-id>.jsonl    │
│    (D-34) — the ONE writer of record; UI reads a bounded window    │
└───────────────┬─────────────────────────────────────────────────--┘
                 │ stdio (JSON lines, sidecar → core) + a small
                 │ request/response channel (core → sidecar: spawn,
                 │ interrupt, permission-answer relay)
┌────────────────▼───────────────────────────────────────────────────┐
│  NODE SIDECAR (packages/sidecar — NEW, created this phase)          │
│  • Spawns `claude -p --output-format stream-json ...` as its own    │
│    child process, cwd = worktree path (explicit, from the core)     │
│  • Parses JSONL line-by-line, forwards each parsed event upstream   │
│  • Hosts the permission-prompt MCP server (`@modelcontextprotocol   │
│    /sdk`), registered via `--permission-prompt-tool`; each incoming │
│    tool call blocks until the core relays a board answer back       │
└────────────────┬─────────────────────────────────────────────────--┘
                  │ spawn(cwd=worktreePath, env={...resolved credential})
┌─────────────────▼──────────────────────────┐
│  `claude` CLI PROCESS (own OS process,       │
│  own process group — PROC-01)                │
│  reads/writes only inside worktreePath        │
└───────────────────────────────────────────--┘
```

### Domain Schema — migration `0003`

Modeled directly on `0002_board_schema.sql`'s own conventions (CHECK constraints as authority, `TEXT PRIMARY KEY` ULIDs, `created_by`/`created_at` on every row) — verified by reading that file this session `[VERIFIED: packages/core/src/db/migrations/0002_board_schema.sql:19-27]` (the `projects` table's exact shape: `id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 26)`, `created_by TEXT NOT NULL REFERENCES actors(id)`, `created_at TEXT NOT NULL`). New tables should follow the identical column-naming and constraint idiom:

- **`triggers`**: `id`, `project_id`, `source TEXT NOT NULL CHECK (source IN ('user_action','schedule','webhook','agent_proposal'))`, `config TEXT` (JSON), `target_task_id`, `enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1))`, `created_by`, `created_at`, `last_fired_at`. Only `user_action` is ever inserted by this phase's code — the CHECK constraint accepting the other three values *is* DATA-04's "accepted but unimplemented" contract, enforced by the schema rather than app code, matching this codebase's established pattern (`0002_board_schema.sql`'s comment block: "epics and tasks share ONE five-state status CHECK... no app-layer guard can be bypassed").
- **`worktrees`**: `id`, `task_id TEXT NOT NULL REFERENCES tasks(id)` (1:1 — enforce with a `UNIQUE` constraint on `task_id`), `path TEXT NOT NULL`, `branch TEXT NOT NULL`, `base_branch TEXT NOT NULL`, `status TEXT NOT NULL CHECK (status IN ('active','stale','merged','abandoned'))`, `created_by`, `created_at`.
- **`agent_runs`**: `id`, `worktree_id`, `task_id`, `trigger_id TEXT NOT NULL REFERENCES triggers(id)`, `adapter TEXT NOT NULL DEFAULT 'claude_code'`, `actor_id`, `status TEXT NOT NULL CHECK (status IN ('running','completed','failed','interrupted'))`, `external_session_id`, `permission_mode TEXT NOT NULL`, `cost_usd`, `tokens_in`, `tokens_out`, `log_path TEXT NOT NULL` (D-34's pointer, matching `Artifact.storage_ref`'s "pointer, not blob" shape already specified in ARCHITECTURE.md §2), `started_at`, `ended_at`.
- **`sessions`**: if kept distinct from `agent_runs` (ARCHITECTURE.md §2 lists both `AgentRun` and a separate concept the phase context calls "session" in success criterion 5) — **this field split is explicitly left to the planner** per CONTEXT.md's Claude's Discretion list ("the exact shape of the trigger→run→session record split... are a planning concern"). This research's contribution is only: whatever the split, `agent_run_id`/`worktree_id`/`task_id` FKs and the transactional-outbox pattern below apply identically to whichever table is the write target.
- **`permission_requests`**: `id`, `agent_run_id`, `tool_name`, `input_payload TEXT` (JSON), `status TEXT NOT NULL CHECK (status IN ('pending','allowed','denied','allowed_always'))`, `resolved_by`, `resolved_at`.
- **`permission_rules`** (D-38's project-scoped allow-always store — not named in ARCHITECTURE.md §2's original entity list, but required by the locked decision): `id`, `project_id`, `tool_name`, `decision TEXT NOT NULL CHECK (decision IN ('allow','deny'))`, `created_by`, `created_at`. Queried by the sidecar's permission-prompt handler (via the Rust core) before ever surfacing a request as board-blocking.

Every insert into these tables follows the exact transactional-outbox shape already implemented in `domain::event`: one `conn.transaction()`, the mutable row insert, `next_sequence` + `append_event` inside the same transaction, one commit `[VERIFIED: packages/core/src/domain/event.rs — append_event and next_sequence both take &Transaction, never &Connection, per that module's own doc comment: "every domain mutation opens exactly one outer transaction and calls these functions inside it, never from a nested one"]`.

### Worktree creation/reuse (WORK-01, WORK-08, D-30)

```
on Start Work(taskId):
  existing = SELECT * FROM worktrees WHERE task_id = ?
  if existing exists:
    worktreePath = existing.path        # D-30: reuse, dirty tree and all
  else:
    branch = deriveBranchName(task)      # D-24
    baseRef = task.epic_id
      ? ensureEpicIntegrationBranch(task.epic_id)   # D-25, lazy cut from trunk tip
      : project.default_branch                       # D-26
    worktreePath = "~/Flywheel/{project.key}/{task.key}/"   # D-23
    git("-C", project.repo_path, "worktree", "add", worktreePath, "-b", branch, baseRef)
    INSERT INTO worktrees (...)   # inside the same event-log transaction
  spawn a fresh AgentRun against worktreePath   # D-30 — never --resume
```

`git worktree add <path> -b <branch> <base-ref>` is the standard two-argument form that both creates the branch and the worktree in one call; running it against an existing `worktreePath` a second time is exactly what D-30 avoids by checking the `worktrees` table first, not by relying on git to fail gracefully on a re-add.

### Agent Adapter Interface (AGNT-01, AGNT-02) — verified against today's CLI surface

ARCHITECTURE.md §5's `AgentAdapter`/`AgentEvent` contract is unchanged in shape; this research confirms every flag it implies still exists and adds the ones D-35/D-36/AGNT-06 need that weren't already enumerated:

| Need | Flag/mechanism | Source |
|------|----------------|--------|
| Headless run | `claude -p "<prompt>"` | `[CITED: code.claude.com/docs/en/headless]` |
| Normalized event stream | `--output-format stream-json` (add `--verbose --include-partial-messages` only if token-level deltas are wanted — not required for D-32's row-per-event feed) | `[CITED: code.claude.com/docs/en/headless]` |
| D-36 default permission mode | `--permission-mode acceptEdits` | `[CITED: code.claude.com/docs/en/permission-modes]` — exact string confirmed, matches D-36's "accept-edits" name verbatim |
| Launch-sheet override to other modes | `--permission-mode {default,plan,auto,dontAsk,bypassPermissions}` | `[CITED: code.claude.com/docs/en/cli-reference]` |
| AGNT-06 blocking permission gate | `--permission-prompt-tool <mcp-tool-name>` + `--mcp-config <sidecar's own server>` — Claude Code waits for that MCP server to connect before the first turn, then routes every prompt through it | `[CITED: code.claude.com/docs/en/cli-reference]` |
| Session id for logging/linking | `system/init` event, first line of the stream, carries `session_id` | `[CITED: code.claude.com/docs/en/headless]` (also matches ARCHITECTURE.md §5's `init` event shape) |
| Cost/token reporting | Final `result` message carries `total_cost_usd` and per-model usage | `[CITED: code.claude.com/docs/en/headless]` |
| D-35 "interrupt" | `SIGINT` to the `claude` process — "ends the turn," produces a result | `[CITED: code.claude.com/docs/en/headless — "To end the turn instead, send SIGINT"]` |
| D-35 "force" | `SIGTERM` (or `SIGKILL`) to the process **group** after a short grace window — exits 143, unfinished turn recorded as no result, but Bash sub-process tree is still cleanly torn down first | `[CITED: code.claude.com/docs/en/headless — "On SIGTERM, Claude Code terminates the process tree of any Bash command that is still running... then runs SessionEnd hooks and exits"]` |
| Native resume (kept unimplemented per D-30) | `--continue` / `--resume <session-id-or-transcript-path>` | `[CITED: code.claude.com/docs/en/headless]` — confirms `resumeSession`'s capability-gated stub has a real, well-documented target to implement against later |

`AgentEvent` mapping from the CLI's actual stream (extends ARCHITECTURE.md §5's union with the one concrete Claude-Code-specific detail it left abstract):

```typescript
// sidecar: parses one JSON object per stdout line from `claude -p --output-format stream-json`
type ClaudeStreamEvent =
  | { type: "system"; subtype: "init"; session_id: string; model: string; tools: string[] }
  | { type: "system"; subtype: "api_retry"; attempt: number; error: string }   // surface as a transient status, not a failure
  | { type: "assistant" | "user"; message: {...}; parent_tool_use_id: string | null }
  | { type: "result"; subtype: "success" | "error_max_turns" | ...; total_cost_usd: number; session_id: string };
// permission requests do NOT appear in this stream — they arrive as MCP tool calls against
// the sidecar's own permission-prompt server, a SEPARATE channel from stdout (see below).
```

### Permission-prompt MCP server (AGNT-06)

The blocking mechanism is not "watch the event stream for a permission_request event and pause" — it is structurally different and simpler: Claude Code calls out to an MCP tool the sidecar hosts, and that tool call's promise simply does not resolve until a decision exists.

```
sidecar starts an MCP server (stdio transport, @modelcontextprotocol/sdk) exposing one tool,
  e.g. "approve_action", BEFORE spawning claude -p, then passes:
    --mcp-config '{"mcpServers":{"flywheel-permissions":{"command":"node","args":["./mcp-server.js"]}}}'
    --permission-prompt-tool mcp__flywheel-permissions__approve_action

when Claude Code wants to run a gated tool:
  1. it calls approve_action(tool_name, input) on the sidecar's MCP server
  2. the sidecar's tool handler:
     a. asks the Rust core (over the sidecar's own IPC) whether a `permission_rules` row
        already allows this (tool_name, project_id) pair (D-38 allow-always) — if so,
        resolve immediately, no board round-trip
     b. otherwise: INSERT a `permission_requests` row (status='pending'), emit board:changed
        so the task row flips to its blocked state (D-37) and the project rail count updates,
        and hold the promise open
  3. the user answers from the board (allow / deny / allow-always) — a Tauri command updates
     the `permission_requests` row and, for allow-always, inserts a `permission_rules` row
  4. the Rust core relays the answer back to the sidecar over IPC, which resolves the MCP
     tool call, and Claude Code's blocked tool call proceeds or is denied
```

This is `[ASSUMED]` in its exact wiring (the CLI reference documents the flags and the "waits for the tool's MCP server to connect" behavior, but not the internal promise-holding pattern — that is this research's synthesis of the documented primitives, not a quoted mechanism). The planner should treat "does an MCP tool call genuinely block indefinitely with no timeout" as worth a quick empirical spike before committing — `MCP_TIMEOUT` (default 30s) governs server **connection**, not necessarily an individual tool call's response time, but this distinction is not spelled out in the fetched docs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parsing Claude's event stream | A custom line-buffering/JSON-framing parser in Rust | Node's built-in readline over the sidecar's own child-process stdout, one `JSON.parse` per line | `.claude/CLAUDE.md`'s own stated rationale for the sidecar's existence — this is exactly the "well-typed, well-documented experience in Node" it names |
| Permission-prompt protocol | A bespoke stdin/stdout signaling protocol for "pause and wait for an answer" | The CLI's own `--permission-prompt-tool`/MCP mechanism | It is the actual, documented extension point Claude Code ships for exactly this; anything else fights the tool instead of using its seam |
| Process-group kill | A hand-rolled PID-tree walk-and-kill | `tokio::process` + `std::os::unix::process::CommandExt::process_group` (spawn into a new process group), then signal the group, not the single PID | Standard library primitive, purpose-built for this; PITFALLS.md pitfall 4 names bare-PID kill as the exact failure mode to avoid |
| Keychain access | Shelling out to `security add-generic-password`/`security find-generic-password` | The `keyring` crate | Native Rust bindings avoid parsing `security` CLI output and its inconsistent error-exit conventions; also keeps a single code path if a future Windows/Linux build needs Credential Manager/Secret Service |
| Windowed log reads | A new pagination mechanism for the session JSONL | The exact `LIMIT`/`OFFSET` shape `query::events::activity_trail` already implements | D-33 explicitly calls this out as "the same shape as the board's virtualized windowed queries" — this codebase already has the proven pattern, at 1,000+ item scale (`perf_seed_1000.rs`) |

**Key insight:** Every "don't hand-roll" item above already has a first-class extension point either in Claude Code itself (stream-json, permission-prompt-tool) or in this codebase's own established patterns (transactional outbox, windowed reads, explicit-path git wrapper). Phase 2's actual net-new engineering is thin: a sidecar process, a migration, and the wiring between them — not a new architecture.

## Common Pitfalls

### Pitfall 1: Treating the credential-policy risk as future/hypothetical rather than already-enforced
**What goes wrong:** Building the local-credential path assuming "it's probably fine, Anthropic hasn't said anything specific" — the STACK.md research this project already has on file states the SDK "prefers local Claude Code credentials over `ANTHROPIC_API_KEY` when both exist," which is stale relative to Anthropic's own Feb 2026 clarification and today's live docs.
**Why it happens:** STACK.md's claim was accurate for an earlier SDK behavior/policy state; policy moved since.
**How to avoid:** Never drive sessions via the Agent SDK's `query()` for the local-credential path — spawn the raw CLI (see "The sidecar-shape decision" above). Treat this as a standing item to re-check at each milestone, exactly as `PITFALLS.md` pitfall 5 already recommends.
**Warning signs:** Any code path that `npm install @anthropic-ai/claude-agent-sdk`s and calls its session-driving API without an API key present.

### Pitfall 2: Assuming `git worktree add` is idempotent
**What goes wrong:** Re-running `git worktree add` against an already-existing task directory on a second Start Work fails or, worse, corrupts the existing checkout.
**Why it happens:** D-30's "reuse the existing worktree" design requires an explicit existence check (`worktrees` table lookup) before ever shelling out to git — the git command itself will error on a duplicate path/branch, it will not silently no-op.
**How to avoid:** Always check `SELECT * FROM worktrees WHERE task_id = ?` first (see the pseudocode above); only call `git worktree add` when no row exists.
**Warning signs:** A second Start Work on the same task throwing a git error instead of resuming.

### Pitfall 3: Killing the `claude` process instead of its process group
**What goes wrong:** D-35's "force" step kills only the direct child PID; a Bash tool call the agent had running (a dev server, a long build) survives as an orphan, continuing to hold file locks or burn CPU inside the worktree — exactly PITFALLS.md pitfall 4's zombie-process failure mode, now specifically inside this phase's own stop mechanism.
**Why it happens:** `Command::kill()` on a naively spawned child only ever signals that one PID.
**How to avoid:** Spawn with a new process group (`process_group(0)` in Rust's `CommandExt`) and signal the group, not the PID, on both the SIGINT and SIGTERM steps.
**Warning signs:** A stopped session's worktree directory still shows an active dev-server port or a running process in `ps` after Flywheel reports the run as `interrupted`.

### Pitfall 4: Letting the sidecar decide permission outcomes itself
**What goes wrong:** For latency or simplicity, the sidecar's MCP tool handler resolves a permission request locally (e.g., a hardcoded allow-list) without ever consulting the Rust core / board.
**Why it happens:** It is the path of least resistance once the MCP server exists and is already intercepting the call.
**How to avoid:** The sidecar must treat every `permission_rules` lookup and every board answer as coming from the Rust core over IPC — it holds no decision authority of its own, matching AGNT-01's "no supervisor code branches" discipline extended to "no sidecar code decides."
**Warning signs:** A permission decision that the board never shows as an event/mutation.

### Pitfall 5: Streaming UI render becoming the source of truth
**What goes wrong:** The session feed's structured rows in React are treated as authoritative, and the persisted JSONL is written lazily or only for the raw-view escape hatch, risking loss under UI backpressure (PITFALLS.md pitfall 10).
**Why it happens:** It is easier to write the log file "whenever we're rendering anyway" than to make the Rust core the sole, independent writer.
**How to avoid:** D-34 already specifies this correctly — write the JSONL from the Rust core, independently of what the UI renders; the UI only ever reads back a bounded window. Verify no code path writes the session log from the renderer process.
**Warning signs:** A live session showing events on screen that are absent from `<app-data>/sessions/<agent-run-id>.jsonl` when inspected directly.

## Code Examples

### Spawn the sidecar (Rust core, tauri-plugin-shell)
```rust
// Source: v2.tauri.app/develop/sidecar (CITED, 2026-09-10)
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

let sidecar_command = app.shell().sidecar("flywheel-sidecar")?;
let (mut rx, mut child) = sidecar_command
    .env("WORKTREE_PATH", &worktree_path)          // explicit, never implicit cwd (PROC-02)
    .env("ANTHROPIC_API_KEY", credential.api_key_or_unset())  // D-39 resolved credential
    .spawn()?;

tauri::async_runtime::spawn(async move {
    while let Some(event) = rx.recv().await {
        if let CommandEvent::Stdout(line_bytes) = event {
            let event: SidecarEvent = serde_json::from_slice(&line_bytes)?;
            // append to <app-data>/sessions/<agent-run-id>.jsonl (D-34), then
            // emit board:changed so the session surface's windowed read refetches
        }
    }
});
```

### Headless spawn inside the sidecar (Node)
```typescript
// Source: code.claude.com/docs/en/headless, code.claude.com/docs/en/cli-reference (CITED, 2026-09-10)
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn("claude", [
  "-p", contextPacketPrompt,
  "--output-format", "stream-json",
  "--permission-mode", "acceptEdits",              // D-36 default; launch sheet may override
  "--permission-prompt-tool", "mcp__flywheel-permissions__approve_action",
  "--mcp-config", JSON.stringify({ mcpServers: { "flywheel-permissions": mcpServerConfig } }),
], {
  cwd: worktreePath,             // explicit — this IS the process's cwd, never read back (PROC-01/02)
  env: { ...process.env, ...resolvedCredentialEnv },
  detached: true,                // own process group, for D-35's group-kill
});

createInterface({ input: child.stdout }).on("line", (line) => {
  const event = JSON.parse(line);
  process.send?.(event);         // forward upstream to the Rust core over the sidecar IPC channel
});

// D-35 "interrupt, then force":
// child.kill("SIGINT");  then, after a grace window if still alive:
// process.kill(-child.pid, "SIGTERM");   // negative pid = signal the whole process group
```

### Worktree creation (Rust core, explicit-path git wrapper)
```rust
// Follows this crate's existing "no implicit cwd" discipline — PROC-02
fn git_at(repo_path: &Path, args: &[&str]) -> anyhow::Result<std::process::Output> {
    std::process::Command::new("git")
        .arg("-C").arg(repo_path)
        .args(args)
        .output()
        .context("git command failed")
}

git_at(&project.repo_path, &["worktree", "add", &worktree_path, "-b", &branch, &base_ref])?;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| "The Agent SDK prefers local Claude Code credentials over `ANTHROPIC_API_KEY` when both exist" (this project's own STACK.md, dated 2026-09-08) | Agent SDK products must use API-key auth; subscription/`claude.ai` login is explicitly excluded for third-party products | Anthropic's Feb 2026 ToS clarification, reconfirmed by today's live docs | Any Phase 2 plan built on the older STACK.md framing would wire the wrong credential path for AGNT-03 |
| `claude -p` defaulting to loading full project context | `--bare` flag (recommended for scripted/SDK calls, "will become the default for `-p` in a future release") skips hooks/skills/CLAUDE.md/MCP auto-discovery for determinism — but also disables subscription-credential reads | Current as of today's docs fetch | Flywheel's local-credential path must NOT pass `--bare` (it would silently force API-key-only and break AGNT-03); the API-key path may reasonably want it for determinism — an open question flagged above, not resolved by documentation alone |

**Deprecated/outdated:** Nothing else this phase touches is deprecated — the schema/domain-module patterns, the windowed-query pattern, and the git-CLI-for-worktrees decision are all current, in-repo, working precedent as of Phase 1's 277 green tests.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Whether `ANTHROPIC_API_KEY` alone (without `--bare`) reliably overrides a present subscription OAuth session, or whether `--bare` is required to force API-key-only | Sidecar-shape decision | D-39's per-project override could silently bill the wrong credential, undermining the "client repo bills to API key" guarantee — cheap to falsify empirically before relying on it |
| A2 | The exact internal wiring of the permission-prompt MCP server as a promise held open until the board answers (no request-level timeout beyond the 30s server-*connection* timeout) | Permission-prompt MCP server | If an individual tool call silently times out server-side, a legitimately slow-to-answer permission request could be auto-denied without any board-visible signal, contradicting D-37's "visible until answered" intent |
| A3 | `process_group(0)`-style spawn + group-signal is portable/correct on macOS specifically (v1's only distribution target per REQUIREMENTS.md Out-of-Scope) | Don't Hand-Roll / Pitfall 3 | Low risk — this is standard POSIX process-group behavior, well-established on macOS, but not independently verified against a real spawned `claude` process this session |
| A4 | `@modelcontextprotocol/sdk` package legitimacy | Package Legitimacy Audit | Not run through the legitimacy seam this session; low likelihood of a problem (it is the canonical MCP SDK) but the planner must still gate its install per this project's own protocol |

**If this table is empty:** N/A — see above; none of these are load-bearing enough to block planning, but A1 and A2 are cheap enough to falsify that the planner should schedule a short spike task for each rather than carry them as open risk into execution.

## Open Questions

1. **Does `--bare` need to accompany the API-key path?**
   - What we know: `--bare` forces API-key-only and disables keychain reads; without it, both credential sources are theoretically available to the CLI.
   - What's unclear: precedence when `ANTHROPIC_API_KEY` is set but `--bare` is absent and a keychain OAuth session also exists.
   - Recommendation: a five-minute empirical spike (spawn `claude -p` both ways on a machine with both credentials present, inspect the `result` event's cost/billing signal) before committing the adapter's credential-injection logic.

2. **Does the `sessions` table (ARCHITECTURE.md §2) stay distinct from `agent_runs`, or collapse into one table for Phase 2?**
   - What we know: CONTEXT.md's Claude's Discretion list explicitly defers this to planning; success criterion 5 requires "the worktree, the agent run and the session as distinct linked records" — which could be read as three tables or as one `agent_runs` table plus the pre-existing `Worktree`/`Trigger` (two distinct *new* record types, not three).
   - What's unclear: whether "session" needs its own row beyond what `agent_runs` already carries, given D-30 makes every session synonymous with a fresh `AgentRun` (no native resume, no session that outlives a run).
   - Recommendation: the planner should read success criterion 5 literally against D-30 — if every session IS an AgentRun 1:1 (which D-30 strongly implies, since resume is unimplemented), a separate `sessions` table may be redundant for Phase 2 and worth collapsing, deferring the split to whenever `resumeSession` is actually implemented and an AgentRun can span multiple sessions.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` CLI | Worktree create/reuse (WORK-01) | ✓ | 2.50.1 (Apple Git-155) `[VERIFIED: git --version, 2026-09-10]` | — |
| `claude` CLI | Agent sessions (AGNT-02) | Not verified this session — **the planner/executor must confirm `claude` is installed and `claude login` has been run on the target machine before Phase 2 execution**, since the local-credential path depends on it | — | If absent, only the API-key path is usable until installed; the adapter's capability-probe pattern (ARCHITECTURE.md §5) already accommodates a backend reporting reduced capability |
| Node.js (for the new sidecar) | Sidecar process | Not verified this session — no `packages/sidecar` exists yet | — | None viable — the sidecar is `.claude/CLAUDE.md`'s locked architecture; if Node is absent on a dev machine, this blocks the phase entirely (not a runtime fallback question, a dev-environment prerequisite) |
| macOS Keychain access | AGNT-04 credential storage | ✓ (macOS is the only v1 target per REQUIREMENTS.md Out-of-Scope) | — | — |

**Missing dependencies with no fallback:** Node.js availability on the dev/build machine for `packages/sidecar` — verify before starting Wave 0.

**Missing dependencies with fallback:** `claude` CLI absence degrades to API-key-only capability, not a hard block.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Rust: `cargo test` (existing `packages/core/tests/*.rs` integration-test pattern, e.g. `crash_safety.rs`'s real-spawned-process harness). TypeScript: `vitest` (existing `packages/desktop` config) |
| Config file | `packages/core/Cargo.toml` (dev-dependencies: `tempfile`); `packages/desktop/vitest.config.ts` |
| Quick run command | `cargo test -p core` / `npm run test --prefix packages/desktop` |
| Full suite command | Same — this project has no separate "full" tier yet at this scale |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WORK-01/WORK-08 | Start Work creates a worktree; a second Start Work on the same task reuses it, not recreates | integration | `cargo test -p core --test worktree_lifecycle` | ❌ Wave 0 |
| LINK-01 | Branch name derives from task key, recognisable from a bare terminal | unit | `cargo test -p core --test branch_naming` | ❌ Wave 0 |
| PROC-01/PROC-02 | Supervisor never reads its own cwd; every git call takes an explicit path | static/lint | grep-based CI check (matching ARCHITECTURE.md §1's described "structural check that greps for bare cwd-less git/fs calls") | ❌ Wave 0 — no such lint rule exists yet in this repo |
| PROC-06 | Stop sends SIGINT then SIGTERM-of-group; worktree left dirty and inspectable | integration, real spawned process | `cargo test -p core --test crash_safety` -style harness extended for this phase, or a new `stop_lifecycle.rs` | Partial — `crash_safety.rs` exists as the precedent, not the specific test |
| PROC-07 | Streaming a long session does not grow process memory unbounded | manual / long-running (hard to automate cheaply) | flagged as manual-only for Phase 2, with a note that the *design* (windowed read) makes this true by construction rather than needing a memory-profiling test | N/A |
| AGNT-06 | A permission request blocks the agent and is answerable from the board | integration, real spawned `claude` process (requires a real or mocked CLI on CI) | `cargo test -p core --test permission_gate` (or a sidecar-level Node test if the MCP server logic lives there) | ❌ Wave 0 |
| DATA-04 | `triggers.source` CHECK accepts `schedule`/`webhook` inserts without app code implementing them | unit (schema-level) | `cargo test -p core --test migration_safety`-style CHECK-constraint assertion | ❌ Wave 0 — extend existing `migration_safety.rs` pattern |

### Sampling Rate
- **Per task commit:** `cargo test -p core` (fast subset) / `npm run test --prefix packages/desktop`
- **Per wave merge:** full `cargo test` workspace + `npm run test`
- **Phase gate:** full suite green before `/gsd-verify-work`, plus the PROC-06 real-process-kill test run manually at least once (per PITFALLS.md's "Looks Done But Isn't" checklist item: "verify force-quit and crash scenarios also leave no orphaned agent processes")

### Wave 0 Gaps
- [ ] `packages/core/tests/worktree_lifecycle.rs` — covers WORK-01, WORK-08, D-30's reuse check
- [ ] `packages/core/tests/branch_naming.rs` — covers LINK-01, D-24/D-25/D-26's two-fixed-shapes logic
- [ ] `packages/core/tests/permission_gate.rs` (or sidecar-side equivalent) — covers AGNT-06
- [ ] A CI lint/grep rule for "no bare-relative-path git/fs calls in the Supervisor" — covers PROC-02 structurally, not just by convention (ARCHITECTURE.md §1 describes this as "defense in depth," not yet implemented anywhere in this repo)
- [ ] Extension to `migration_safety.rs` (or a new file) asserting the `triggers.source` CHECK constraint's full accepted set — covers DATA-04's "schema is the authority" requirement

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Credential resolution is the Rust core's sole responsibility (D-39); the sidecar never independently authenticates — it only receives an already-resolved environment |
| V3 Session Management | yes (agent sessions, not human auth sessions) | `external_session_id` tracked per `agent_runs` row; no session state trusted from the sidecar without a corresponding DB row |
| V4 Access Control | yes | `permission_rules` scoped per-project (D-38) — a rule granted on one project's tools must never apply to another; MCP tool calls are scoped to the spawning `agent_run_id`'s worktree only |
| V5 Input Validation | yes | Every MCP tool call's `input_payload` persisted and validated before any downstream action, matching ARCHITECTURE.md §6's "every MCP tool input is schema-validated before any DB write" rule (stated for the board-write path, applies identically here) |
| V6 Cryptography | yes | Never hand-roll Keychain access — `keyring` crate (wraps `security-framework`), never a shelled-out `security` command with credential material passed as a CLI argument (which would appear in process listings) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key passed as a CLI argument (visible in `ps`) | Information Disclosure | Pass `ANTHROPIC_API_KEY` via the spawned process's **environment**, never as a `claude` CLI flag argument — env vars are not visible in a `ps` listing the way argv is |
| A malicious/compromised worktree's project-level MCP config intercepting the permission-prompt tool name | Spoofing / Tampering | The sidecar supplies `--mcp-config` explicitly per spawn (not relying on the worktree's own `.mcp.json` autodiscovery) — `--bare`-equivalent discipline for the permission server specifically, regardless of whether `--bare` itself is used for the main session |
| Credential leaking into the persisted session JSONL (D-34) | Information Disclosure | The `system/init` event and `result` event do not carry the API key itself (confirmed by the documented event shapes above) — but the sidecar's own spawn-time logging must never log the resolved `env` object verbatim |
| A stale `permission_rules` allow-always rule surviving a project being repurposed (e.g., cloned for a different client) | Elevation of Privilege | D-38 already requires rules be inspectable and revocable — the planner should ensure the Settings surface (D-39's first Settings UI) exposes this list, not just the credential toggle |

## Sources

### Primary (HIGH confidence)
- `code.claude.com/docs/en/agent-sdk/overview` — fetched 2026-09-10, the Agent SDK / subscription-login exclusion statement
- `code.claude.com/docs/en/headless` — fetched 2026-09-10, `-p`/`--bare`/SIGTERM/SIGINT/`--output-format`/`--input-format`/session-resume behavior
- `code.claude.com/docs/en/cli-reference` — fetched 2026-09-10, `--permission-prompt-tool`, `--permission-prompts`, `--permission-mode`, `--dangerously-skip-permissions`
- `code.claude.com/docs/en/permission-modes` — fetched 2026-09-10, mode names including `acceptEdits`
- `v2.tauri.app/develop/sidecar` — fetched 2026-09-10, `externalBin`/capability/spawn pattern
- `cargo add --dry-run` against the live crates.io index, run from within this repository, 2026-09-10 — `tokio` 1.53.1, `tauri-plugin-shell` 2.3.6, `keyring` 4.2.0 (+ feature list), `tokio-cron-scheduler` 0.15.1, `rusqlite_migration` 2.6
- `gsd_run query package-legitimacy check` (npm + crates ecosystems), run 2026-09-10
- `packages/core/src/db/migrations/0002_board_schema.sql`, `packages/core/src/domain/event.rs`, `packages/core/src/domain/task.rs`, `packages/core/src/ids.rs`, `packages/core/src/query/events.rs`, `packages/desktop/src-tauri/src/{main,state}.rs`, `packages/desktop/src-tauri/capabilities/default.json`, `packages/desktop/src/adapters/tauri.ts`, `packages/desktop/src/state/keyboard.ts`, `packages/desktop/src/item-detail/ItemDetailPanel.tsx`, `packages/desktop/src/legend/marks.ts` — all read directly this session
- `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md`, `.planning/research/PITFALLS.md`, `.planning/research/FEATURES.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/02-.../02-CONTEXT.md` — all read directly this session

### Secondary (MEDIUM confidence)
- GIGAZINE, The Register, WinBuzzer, aihackers.net (Feb 2026 coverage of the Anthropic OAuth policy clarification) — cross-corroborating the primary docs finding above, consistent with `PITFALLS.md`'s own already-cited `alternativeto.net` source

### Tertiary (LOW confidence)
- None retained — every WebSearch-only claim in this document was either promoted by a direct official-docs fetch or dropped.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version number verified against live registries this session; the sidecar-shape decision verified against live official docs, not carried over from the (now partially stale) STACK.md
- Architecture: HIGH on the schema/domain-module conventions (read directly from working code); MEDIUM on the sidecar/permission-MCP wiring (no in-repo precedent yet, synthesized from documented CLI primitives)
- Pitfalls: HIGH on the credential-policy pitfall (directly verified, materially sharpens the existing PITFALLS.md entry); MEDIUM on the others (extensions of already-researched PITFALLS.md entries into this phase's specifics)

**Research date:** 2026-09-10
**Valid until:** 14 days for the credential-policy/CLI-flag findings (this is a fast-moving, actively-enforced policy area per the project's own PITFALLS.md — re-verify at the next milestone boundary regardless of calendar staleness); 30 days for the schema/pattern findings (stable, in-repo, low external-change risk)

---
*Phase: 2-One Agent, One Worktree, Watched Live*
*Research completed: 2026-09-10*
