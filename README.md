# Flywheel (by HighKnow)

Flywheel is an Agentic Development Environment: a desktop application that lets one developer
supervise many AI coding agents at once, across many projects, by multiplexing git worktrees. Work
lives as epics, tasks and issues on a project board that agents read from *and* write to — the
board is the store of record, not a `.planning/` folder.

See `.planning/PROJECT.md` for the full product context.

## Repository layout

```
packages/
├── core/            (OSS)  — Rust domain crate: SQLite schema, migrations, the event-log
│                             outbox write path, ULIDs, fractional ranking.
├── desktop/         (OSS)  — Tauri v2 shell + React renderer.
├── relay-client/    (OSS, inert) — the open-core seam for a future hosted relay client.
```

## Prerequisites

| Tool | Minimum version |
|---|---|
| Rust toolchain (`rustc`/`cargo`) | 1.96.x or newer |
| Node.js | 22.x (LTS) |
| npm | 10.x |
| git | ≥ 2.44 |
| Xcode Command Line Tools (macOS) | present, for compiling bundled SQLite + native deps |

## Running the app

```bash
npm --prefix packages/desktop install
npm --prefix packages/desktop run tauri dev
```

## Running the tests

```bash
# Rust core
cargo test --workspace

# Frontend
npm --prefix packages/desktop run test
```
