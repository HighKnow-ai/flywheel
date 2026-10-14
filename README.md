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

## Installing a release

Download the `.dmg` from the [releases page](https://github.com/HighKnow-ai/flywheel/releases). Releases are Apple Silicon (arm64) macOS only. To build from source instead, see the next section.

### Opening a downloaded release (it is not signed)

Flywheel is not signed with an Apple Developer ID and is not notarized, so macOS blocks the app the first time you open it. The first two releases, `v0.1.0` and `v0.1.1`, are marked **Pre-release** on GitHub for that reason.

If you downloaded the `.dmg` in a browser, macOS says that **"Flywheel.app is damaged and can't be opened"** and offers only **Move to Trash** and **Cancel**. The app is not damaged. There is no Open button, so right-click and Open does not help.

To open it:

1. Drag `Flywheel.app` from the `.dmg` into `/Applications`.
2. In Terminal, remove the quarantine mark that your browser put on the download:

   ```bash
   xattr -cr /Applications/Flywheel.app
   ```

3. Open Flywheel as usual.

Only do this for a build you downloaded from this repository's releases page. The command removes a macOS safety check for that one app.

This was observed on one Mac (macOS 26). Other macOS versions may word the dialog differently.

## Prerequisites

| Tool | Minimum version |
|---|---|
| Rust toolchain (`rustc`/`cargo`) | 1.96.x or newer |
| Node.js | 22.x (LTS) |
| npm | 10.x |
| git | ≥ 2.44 |
| Xcode Command Line Tools (macOS) | present, for compiling bundled SQLite + native deps |
| `rustc` host triple | `aarch64-apple-darwin` (Flywheel ships arm64 macOS only; check with `rustc -vV`) |

`build:dist` (below) downloads a pinned Node runtime on first run and verifies it against the
published SHA-256 checksums, so the first build needs network access.

## Building from source

```bash
npm --prefix packages/sidecar ci
npm --prefix packages/desktop ci
npm --prefix packages/sidecar run build:dist
cargo build --workspace
npm --prefix packages/desktop run tauri build -- --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

The order matters. `build:dist` must run before any `cargo` command: `tauri_build::build()` fails
the whole workspace build when a `bundle.externalBin` file is missing, so a fresh clone cannot even
`cargo test` until `build:dist` has staged the `binaries/flywheel-*` files. The result is an
unsigned `Flywheel.app` and `.dmg` under `target/release/bundle/`. CI runs these same commands on
every push.

The `--config` override on the last command is required. `tauri.conf.json` asks for updater
artifacts, and tauri fails the build (after the `.app` and `.dmg` already exist) unless it has the
maintainers' updater signing key. A contributor does not have that key and does not need it: the
override turns the updater artifacts off. Only the release workflow signs them.

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

# Sidecar (needs `npm --prefix packages/sidecar run build:dist` first)
npm --prefix packages/sidecar test
```

Optional browser-mode suites (they download a Playwright WebKit build):

```bash
npm --prefix packages/desktop run test:browser
npm --prefix packages/desktop run test:browser:dark
npm --prefix packages/desktop run test:browser:motion
```

## Architecture

See [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Licence

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
