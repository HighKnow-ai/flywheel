<!-- GSD:project-start source:PROJECT.md -->

## Project

**Flywheel (by HighKnow)**

Flywheel is an Agentic Development Environment: a desktop application that lets one developer
supervise many AI coding agents at once, across many projects, by multiplexing git worktrees.
Work is not organised as chat sessions or as files in a `.planning/` folder — it lives as epics,
tasks and issues on a project board that the agents read from *and write to*. The agent challenges
you Socratically while you shape an epic, decomposes it into tasks, fans those tasks out into
isolated worktrees, executes them, and proposes new issues back onto the board as it learns.

It is for developers running "loop engineering" — continuously draining a backlog with agents
rather than hand-driving one terminal at a time. Cyril is the first user; the desktop application
is open source, and the collaboration/cloud layer is the commercial product.

**Core Value:** **Every unit of agent work is anchored to a structured board item with real acceptance criteria —
never a chat blob.** If everything else fails, this must hold.

The corollary is the whole product thesis: *the board is the context-reconstitution mechanism that
makes `/clear` free.* A worktree is a cheap, durable resource owned by a task and outliving many
agent sessions; an agent context is expensive, short-lived and disposable. Chat-native tools cannot
discard a context without losing the thread, so their contexts rot. A board-native ADE can discard
contexts constantly and lose nothing, because every new session reconstitutes from the issue, its
acceptance criteria, prior session summaries and the diff so far. That asymmetry is the wedge.

### Constraints

- **Architecture**: No v1 decision may foreclose scheduled automations, team collaboration, the mobile/web relay, or additional agent backends — Explicitly stated as a hard requirement: "I don't want the code structure or architecture to limit me in any way later." These are cheap to accommodate now and near-impossible to retrofit.
- **Execution model**: Local-first. Agents run on the developer's machine using their existing local agent credentials — Credentials must never leave the desk; this is also what makes the OSS desktop app independently useful.
- **Agent backend**: Claude Code only in v1, behind an adapter interface — Ship one backend well; prove the seam without paying for a second auth/streaming/tooling integration.
- **Surface**: Desktop only in v1 — Smallest v1 that proves the loop. Mobile and web are a separate milestone.
- **Licensing**: Desktop ADE open source; cloud/relay/teams commercial — The open/paid boundary must fall on a clean module seam in the codebase, not be retrofitted later.
- **Naming**: Product is "Flywheel" by HighKnow — "Harness" collides directly with Harness.io, a large company in the identical category (developer tooling / SDLC automation).
- **Tech stack**: Undecided; desktop shell (Tauri vs Electron vs native) deferred to research — Load-bearing choice; must be argued against process supervision needs, node-based agent CLIs, and future web parity rather than assumed.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

Decided. Full rationale, alternatives considered, and sources live in `.planning/research/STACK.md` — read it only when a stack decision is in question.

| Layer | Choice | Version | Rule |
|---|---|---|---|
| Desktop shell | Tauri v2 (Rust core) + bundled Node.js sidecar | Tauri 2.11.x | Rust owns sidecar supervision (spawn / health-check / restart / kill-on-exit). Sidecar owns driving agent sessions. Default-deny capabilities manifest per window. |
| UI | React | 18/19 per `create-tauri-app` template | Every `@tauri-apps/api` invoke/listen goes through one thin adapter module so the same tree can later target a REST/WS relay. |
| Sidecar runtime | Node.js LTS | 22.x/24.x — match what the Agent SDK supports | Packaged with `pkg`/`nexe` as `externalBin` in `tauri.conf.json`. |
| Agent backend | `@anthropic-ai/claude-agent-sdk` | 0.3.x — pin exact, update deliberately | Uses the developer's local Claude Code credentials. Behind an adapter interface; Claude Code only in v1. |
| Store of record | SQLite via `rusqlite` (`bundled` feature) | 0.40.x | One shared fleet-wide DB. WAL + `busy_timeout`. Migrations via `rusqlite_migration`. Sidecar never opens the DB — it asks the Rust core over IPC. |
| Git — worktree lifecycle | System `git` CLI via `tokio::process::Command` | git ≥ 2.44 | create / remove / list / prune, branch topology, merges. Never `git2` for these. |
| Git — hot-path reads | `git2` (libgit2) | current | diff / status / log / blob walks for the review UI only. |
| Scheduling | `tokio-cron-scheduler` in the Rust core | 0.15.x | Vendored now, cron-tick trigger type stubbed; no UI in v1. |
| PTY | `node-pty` inside the sidecar | 1.1.0 | Only if headless `stream-json` mode is insufficient. Never terminate a PTY in Rust and relay bytes to Node. |
| UI libraries | `@tanstack/react-query` v5 · `@tanstack/react-virtual` 3.14 · `react-diff-view` 3.3 · `@monaco-editor/react` · `@xyflow/react` 12.11 · Zustand or Jotai | | Server/DB state lives only in React Query; UI state only in Zustand/Jotai. Never blur the two. |

**Do not use:** ElectricSQL, Triplit, PGlite as primary store, raw Automerge/Yjs as the board schema, NodeGit, isomorphic-git, `git2` for worktree ops, `better-sqlite3` as the canonical DB, libSQL/Turso, egui/iced. The sync engine (PowerSync vs Zero) is deferred to the relay milestone.

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
