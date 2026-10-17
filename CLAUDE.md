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

## Technology Stack

Decided. Full rationale, alternatives considered, and sources live in `docs/research/STACK.md` — read it only when a stack decision is in question.

| Layer | Choice | Version | Rule |
|---|---|---|---|
| Desktop shell | Tauri v2 (Rust core) + bundled Node.js sidecar | Tauri 2.11.x | Rust owns sidecar supervision (spawn / health-check / restart / kill-on-exit). Sidecar owns driving agent sessions. Default-deny capabilities manifest per window. |
| UI | React | 18/19 per `create-tauri-app` template | Every `@tauri-apps/api` invoke/listen goes through one thin adapter module so the same tree can later target a REST/WS relay. |
| Sidecar runtime | Node.js LTS, bundled as `flywheel-node` | 22.x — pinned by `NODE_VERSION` in `packages/sidecar/scripts/stage-runtime.mjs` | `pkg` and `nexe` are **not installed** and not used. The three `externalBin` entries in `tauri.conf.json` (`flywheel-sidecar`, `flywheel-node`, `flywheel-shim`) are staged by `packages/sidecar/scripts/stage-runtime.mjs`. The Node version is constrained by Tauri and the sidecar's own code, not by an Agent SDK (see the Agent backend row: the SDK is not a dependency). |
| Agent backend | Claude Code, behind an adapter interface. `@anthropic-ai/claude-agent-sdk` was the planned vehicle and is **not a dependency** | n/a | Uses the developer's local Claude Code credentials; Claude Code only in v1. The real mechanism: `packages/sidecar/src/claude-code-adapter.ts` spawns the developer's own `claude` binary, and the sidecar's only runtime dependency is `@modelcontextprotocol/sdk` 1.30.0. Do not add the SDK: its registry licence field is `SEE LICENSE IN README.md` and those terms were not read. |
| Store of record | SQLite via `rusqlite` (`bundled` feature) | 0.40.x | One shared fleet-wide DB. WAL + `busy_timeout`. Migrations via `rusqlite_migration`. Sidecar never opens the DB — it asks the Rust core over IPC. |
| Git — worktree lifecycle | System `git` CLI driven through `packages/core/src/git.rs` and `proc::output_with_timeout` (`std::process`, a deadline-watched child) — `tokio::process` is not the mechanism | git ≥ 2.44 | create / remove / list / prune, branch topology, merges. Never `git2` for these. |
| Git — hot-path reads | `git2` (libgit2) — **not installed, in no Cargo.toml** | n/a | Review and diff reads currently go through `packages/core/src/git.rs`, which shells out to the system `git` CLI (called from `review.rs`). Path autocomplete must use `git ls-files`, not a libgit2 blob walk, until the owner decides to add the dependency. |
| Scheduling | `tokio-cron-scheduler` in the Rust core | 0.15.x | Vendored now, cron-tick trigger type stubbed; no UI in v1. |
| PTY | `node-pty` — **not installed**; `packages/sidecar/package.json` has one runtime dependency, `@modelcontextprotocol/sdk` | n/a | Adopt only if headless `stream-json` mode proves insufficient, and then inside the sidecar. Never terminate a PTY in Rust and relay bytes to Node. |
| UI libraries | `@tanstack/react-query` v5 · `@tanstack/react-virtual` 3.14 · `react-diff-view` 3.3 · Zustand (all installed in `packages/desktop/package.json`) | | Server/DB state lives only in React Query; UI state only in Zustand. Never blur the two. |
| UI — code editor | `@monaco-editor/react` — **not installed** | n/a | No phase may plan on reusing Monaco without an install line that actually runs; the v0.1.0 install line was never run. |
| UI — graph canvas | `@xyflow/react` — **not installed** | n/a | Same rule: nothing in the tree imports it, and no phase may plan on reusing it without an install line that actually runs. |

**Do not use:** ElectricSQL, Triplit, PGlite as primary store, raw Automerge/Yjs as the board schema, NodeGit, isomorphic-git, `git2` for worktree ops, `better-sqlite3` as the canonical DB, libSQL/Turso, egui/iced. The sync engine (PowerSync vs Zero) is deferred to the relay milestone.

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
