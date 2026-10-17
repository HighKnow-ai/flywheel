# Architecture

Flywheel is a desktop application that supervises many AI coding agents across git worktrees, with
a project board as the store of record for work; knowledge about the code (ADRs, glossary) lives in
the managed project's repo and the board only links to it (ADR 0002). Product context and the stack
choices live in `CLAUDE.md`; the full stack rationale is `docs/research/STACK.md`. This
document records what is true in the tree today and stays short on purpose.

## 1. Process topology

Three processes cooperate. The Tauri Rust core (`packages/desktop/src-tauri`) is the supervisor and
owns the window, the database and every spawn. A bundled Node.js sidecar (`packages/sidecar`)
drives individual Claude Code sessions through the Agent SDK. A React renderer
(`packages/desktop`) runs in the OS WebView and can reach only the Rust core.

## 2. Workspace members

The Cargo workspace has three members: `packages/core` (domain crate: schema, persistence, git,
dispatch), `packages/desktop/src-tauri` (the Tauri application) and `packages/shim` (the
`flywheel-shim` binary).
`packages/sidecar` is deliberately **not** a Cargo workspace member: it is an npm package whose
compiled output is staged into the application bundle (§7).

## 3. One owner for the database

`packages/core` owns the SQLite connection exclusively (D-03). No other process opens the database
file. The sidecar asks the Rust core over the sidecar IPC channel when it needs data. Schema changes
are versioned migrations in `packages/core/src/db/migrations`, applied with `rusqlite_migration`,
and `packages/core/src/db/backup.rs` copies the database file before any migration runs (D-18).
Migration safety is backup-first, not down-migrations.

## 4. Append-only event log

Every board mutation writes an event in the same transaction as the row it changes, so the board's
history is reconstructible from the log. After a commit the core emits `board:changed`, and the
renderer refetches. The log is read through a cursor (`events_since_cursor`), which is the same
cursor a future relay would read (§8).

## 5. The single IPC seam

`packages/desktop/src/adapters/tauri.ts` is the only renderer module permitted to import
`@tauri-apps/*`. Components call `invokeCommand` and `subscribeBoardChanged`, so the same React tree
can later point at a different transport by editing that one file. The window capability in
`packages/desktop/src-tauri/capabilities/default.json` is default-deny: no `fs:`, no bare `shell:`,
and one `shell:allow-execute` grant scoped to the sidecar binary. App commands are exposed only
through `generate_handler!` in `main.rs`.

## 6. Process supervision and the PATH shim

`packages/desktop/src-tauri/src/sidecar.rs` spawns, health-checks and kills the sidecar, and the
core reconciles orphaned runs at launch. Each agent session gets a per-run shadow directory holding
`flywheel-shim` (`packages/core/src/shim.rs` installs it) so the session's own `git` calls retry
lock collisions. The shim is one interception layer among several. What each layer is trusted to
prove is in `docs/destructive-gate-trust-boundary.md`.

## 7. Packaging layout

`tauri build` produces `Flywheel.app` with three `externalBin` entries in `Contents/MacOS/`:
`flywheel-sidecar` (a launcher), `flywheel-node` (a checksum-verified Node runtime) and
`flywheel-shim`. The compiled sidecar `dist/` and its production-only `node_modules` are staged as
bundle resources under `sidecar/`. `npm --prefix packages/sidecar run build:dist` stages all of it.
The generated executables are untracked.

## 8. Open-Core Module Boundary

The open-source desktop application is complete without any hosted service. The commercial side
(relay server, auth, billing, hosted infrastructure) attaches at one seam. These are claims a build
can check, not intentions.

- No relay client exists in this repository. The inert `packages/relay-client` placeholder crate
  was deleted by the MVP plan (`docs/mvp-spec.md` §9); its history stays in git.
- The commercial side lives in no file of this repository. When it exists, it attaches here: a
  relay client reads the event-log cursor from `packages/core` (§4) and posts batches to a configured
  relay URL, off by default.
- No feature of the open-source application is gated behind an account or a network service.
