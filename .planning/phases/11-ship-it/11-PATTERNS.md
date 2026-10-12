# Phase 11: Ship It - Pattern Map

**Mapped:** 2026-10-12
**Files analyzed:** 19
**Analogs found:** 12 / 19 (7 are greenfield: no `.github/`, no `LICENSE`, no `ARCHITECTURE.md`, no release tooling exists)

All analog paths verified git-tracked (`git ls-files`). Note `.gsd/` and `.flywheel/` are untracked runtime dirs; none are used here.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `.github/workflows/release.yml` | config (CI) | batch | none in repo; README "Running the tests" + Prerequisites for the commands | no analog |
| `.github/workflows/open-core.yml` (relay-client deleted job) | config (CI) | batch | none; `packages/relay-client/README.md` + root `Cargo.toml` members | no analog |
| `packages/desktop/src-tauri/tauri.conf.json` (mod) | config | n/a | itself | exact |
| `packages/desktop/src-tauri/Cargo.toml` (mod: `tauri-plugin-updater`) | config | n/a | lines 30-33 `tauri-plugin-notification =2.4.0` | exact |
| `packages/desktop/src-tauri/src/main.rs` (mod: `.plugin(updater)`) | config | n/a | lines 39-42 | exact |
| `packages/desktop/src-tauri/capabilities/default.json` (mod) | config | n/a | itself | exact |
| `packages/sidecar/package.json` (mod: binary build step) + build script | utility | transform | itself (`build: tsc`) | partial |
| `.gitignore` (mod) + `git rm` of tracked sidecar binary | config | n/a | itself | exact |
| `LICENSE`, optional `NOTICE` | config | n/a | none | no analog |
| `ARCHITECTURE.md` (§8 Open-Core Module Boundary) | doc | n/a | `packages/relay-client/README.md`, `docs/destructive-gate-trust-boundary.md` | role-match |
| `README.md` (mod: sidecar build, release) | doc | n/a | itself | exact |
| `packages/desktop/src/adapters/tauri.ts` (mod: updater wrappers) | adapter | request-response | itself (only module allowed to import `@tauri-apps/*`) | exact |
| `packages/desktop/src/update/UpdateBanner.tsx` + `useUpdate.ts` | component + hook | event-driven / polling | `fleet/useFleet.ts` + `App.tsx` shell mounting | role-match |
| `packages/desktop/src/update/__tests__/update-banner.test.tsx` | test | n/a | `projects/__tests__/project-rail.test.tsx` | role-match |
| `packages/core/src/db/migrations/0022_project_hidden.sql` + `mod.rs` entry | migration | CRUD | `0021_fleet_review_backlog.sql`, `db/mod.rs:22-24` | exact |
| `packages/core/src/domain/project.rs` (mod: `hide_project`/`restore_project`, filter in `list_projects`) | model | CRUD | `list_projects` lines 99-110, `reconcile_projects` | exact |
| `packages/desktop/src-tauri/src/commands/project.rs` (mod: `project_hide`) + `main.rs` `generate_handler!` | controller | request-response | same file `ProjectDto`, `project_list` | exact |
| `packages/core/tests/project_hide.rs` | test | CRUD | `packages/core/tests/project_reconciliation.rs` | exact |
| `packages/desktop/src/review/review.css` (`.review-anchor-widget` border) + enforcing test | style + test | n/a | `theme/__tests__/contrast.test.ts` (`?raw` css read), `review/__tests__/browser/legibility.browser.test.tsx` | role-match |
| Register-drain tests / harnesses | test | mixed | `scripts/uat/uat-*.mjs`, `packages/sidecar/test/fake-claude.mjs`, `packages/core/tests/*.rs`, `*.browser.test.tsx` | exact (per item) |
| `.planning/phases/01-.../01-UI-SPEC.md`, `08.1-.../08.1-UI-SPEC.md`, `REQUIREMENTS.md` (AGNT-07) | doc | n/a | themselves | exact |

## Pattern Assignments

### `packages/desktop/src-tauri/Cargo.toml` + `main.rs` (updater plugin)

**Analog:** `Cargo.toml` lines 30-33 and `main.rs` lines 38-42.

```toml
# D-181 ...: pinned to 2.4.0 so the phase stays on `tauri = "=2.11.5"`; the window is granted nothing
tauri-plugin-notification = "=2.4.0"
```
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    // D-175: granted to the Rust core only. No notification permission is added to the window.
    .plugin(tauri_plugin_notification::init())
```
Copy: exact-pin `tauri-plugin-updater = "=X"` (choose a version compatible with `tauri =2.11.5`, verify via `cargo tree`), comment citing D-186. Updater is a desktop-only plugin; Tauri docs register it inside `.setup()` with `app.handle().plugin(tauri_plugin_updater::Builder::new().build())` or on the builder, either works. Note `main.rs` `.setup()` closure cannot unwind under `panic = "abort"` (see `sidecar.rs:231`); no `unwrap` in it.

### `tauri.conf.json` (updater, bundle, version)

Current shape (lines 28-40): `bundle.targets: "all"`, `externalBin: ["binaries/flywheel-sidecar"]`, no `plugins`. Add alongside `bundle`:
```json
"plugins": { "updater": { "pubkey": "<ed25519 pub>", "endpoints": ["https://github.com/<org>/<repo>/releases/latest/download/latest.json"] } }
```
and `bundle.createUpdaterArtifacts: true`, `bundle.targets: ["dmg","app"]` (D-189, D-183), later `bundle.macOS.signingIdentity` (final plan only, D-185). Version (D-184): `version` appears in three hand-written places, `tauri.conf.json:4`, `src-tauri/Cargo.toml:3`, `packages/desktop/package.json:4`. The release workflow should derive all from the tag (e.g. `jq`/`sed` step, or `tauri build --config '{"version":"..."}'`) rather than add a fourth copy.

### `capabilities/default.json`

Default-deny; current permissions: `core:default`, `dialog:allow-open`, scoped `shell:allow-execute` for `binaries/flywheel-sidecar`. Copy the style of the long `description` field, extend it to say why `updater:default` is (or is not) granted. Recommended: drive the update check from Rust (as notifications are, D-175) and expose app commands through `generate_handler!`, so the window gets no updater permission. Roster of commands in the description must be updated for any new command (`project_hide`, update commands).

### `packages/desktop/src/adapters/tauri.ts` (updater wrappers)

**Analog:** the file itself; header states it is the ONLY module permitted to import `@tauri-apps/*` (lines 1-12).
```ts
export async function invokeCommand<TResult>(command: string, args?: Record<string, unknown>): Promise<TResult> {
  return invoke<TResult>(command, args);
}
export async function fleetList(): Promise<FleetListDto> {
  return invokeCommand<FleetListDto>("fleet_list");   // line 1371
}
```
Copy: thin typed wrappers (`updateCheck`, `updateInstall`, DTO interfaces with doc comments). Any `@tauri-apps/plugin-updater` import goes only here.

### `src/update/useUpdate.ts` (hook) and `UpdateBanner.tsx`

**Analog:** `packages/desktop/src/fleet/useFleet.ts`: query-key functions, TanStack Query, `subscribeBoardChanged` invalidation.
```ts
export function fleetQueryKey() { return ["fleet"] as const; }   // line 17
```
D-188 live-run count: reuse `fleetList()` rows (banded by the core; filter on status `running`/`blocked`, cf. `core/src/query/fleet.rs:344` `ar.status IN ('running','blocked')`). Do not add a query. Prefer enforcing the refusal in Rust too (the banner is display; the Rust `update_install` command should re-check live runs). Periodic check: `useQuery({ refetchInterval })`, interval is Claude's discretion.
Mounting: `App.tsx` `AppShell` reads surface state from `useUiStore` (lines 125-150) and returns `<div id="app-root" className="rack-ground">` (line 298). Mount the banner as a sibling inside that container, not as a new Surface. Dismissed state: local UI state belongs in `state/uiStore.ts` (Zustand; server state stays in TanStack Query per its header comment).

### `0022_project_hidden.sql` + `db/mod.rs`

**Analog:** `packages/core/src/db/migrations/0021_fleet_review_backlog.sql` (header comment explaining why, then SQL) and registration `db/mod.rs:22-24`:
```rust
include_str!("migrations/0001_actors.sql"),
```
Copy: append `include_str!("migrations/0022_...")` to that list; add `hidden INTEGER NOT NULL DEFAULT 0` (or `hidden_at TEXT`) to `projects`. Backup-first migrations (`db/backup.rs`, D-18), no down-migrations.

### `core/src/domain/project.rs` (soft-hide)

**Analog:** `list_projects` (lines 99-110):
```rust
pub fn list_projects(conn: &Connection) -> anyhow::Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, key_prefix, name, repo_path, default_branch, status
         FROM projects ORDER BY created_at ASC")?;
    let rows = stmt.query_map([], row_to_project)?.collect::<Result<Vec<_>, _>>().context("failed to read projects")?;
```
Add `WHERE hidden = 0`. D-200 requires the filter on EVERY project-listing read: grep `FROM projects` across `packages/core/src` (fleet, worktree inventory, reconcile at line 409) and `packages/desktop/src-tauri/src`. Hide/restore must append an event like `reconcile_projects` does (lines 404-440, which writes a status change plus event with the actor id); copy its transaction + event shape. Registering a path that matches a hidden project's marker should restore rather than duplicate (see `register_project` reuse-by-marker behaviour tested in `project_reconciliation.rs`).

### `commands/project.rs` (`project_hide`)

**Analog:** same file lines 1-30: `use tauri::State; use crate::state::AppState;`, `#[derive(Serialize)] #[serde(rename_all = "camelCase")] ProjectDto`, `From<flywheel_core::domain::project::Project>`. Copy `project_list`'s body for the lock-and-call pattern (read it before writing; I did not excerpt it), add the command name to `generate_handler!` (`main.rs:129`) and to the capability description roster. Confirmation is UI-side: copy `projects/ProjectUnreachable.tsx` / `ProjectRail.tsx` for placement.

### `packages/core/tests/project_hide.rs`

**Analog:** `packages/core/tests/project_reconciliation.rs`: header doc listing "Behavior under test", and fixture:
```rust
use core::db::{apply_pragmas, open_and_migrate};
use core::domain::actor::local_human_actor_id;
use core::domain::project::{list_projects, reconcile_projects, register_project, relocate_project};
fn open_db() -> (Connection, String, std::path::PathBuf) { /* tempdir, std::mem::forget */ }
```
Cases: hidden project absent from `list_projects`; rows (tasks, runs, events) still present; restore round-trips; hiding twice appends no second event.

### Sidecar binary build (D-192)

**Analog:** `packages/sidecar/package.json` (`"build": "tsc"`, `"test": "npm run build && ... node --test test/*.test.mjs"`), plus `externalBin` naming `binaries/flywheel-sidecar-<triple>`. Add a script (e.g. `build:binary`) that runs `tsc` then `pkg`/`nexe` to write `../desktop/src-tauri/binaries/flywheel-sidecar-$(rustc -vV | sed -n 's/host: //p')`; wire it into `tauri.conf.json` `build.beforeBuildCommand`/`beforeDevCommand` or document it in README. Also `git rm --cached packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin` and add `packages/desktop/src-tauri/binaries/flywheel-sidecar-*` to `.gitignore` (style: comment line then pattern, like the `# Vitest browser-mode ...` entry). Caution: `tauri-build` fails if the `externalBin` file is missing, so `cargo test --workspace` on a fresh clone needs the binary built first. CI and README must order: sidecar build, then cargo. Note `packages/sidecar` is not a Cargo workspace member; relay-client deletion job must not touch it.

### `.github/workflows/*` (greenfield)

No analog. Take commands from README: `cargo test --workspace`, `npm --prefix packages/desktop install`, `npm --prefix packages/desktop run test`, `npm --prefix packages/desktop run tauri build`; sidecar: `npm --prefix packages/sidecar ci && npm --prefix packages/sidecar test`. Prereqs: Rust >=1.96, Node 22, git >=2.44, macOS runner `macos-14` (arm64). Release job: `on: push: tags: ['v*']`, `tauri-apps/tauri-action` with `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`, and (final plan only) `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`; it uploads the `.dmg`, `.app.tar.gz`, `.sig` and `latest.json` (D-186/D-189). Open-core job: simplest shape is a stripped checkout: `rm -rf packages/relay-client` then `sed -i '/packages\/relay-client/d' Cargo.toml` (root `members` list, lines 3-8 of `Cargo.toml`), then the same test commands. First verify nothing depends on it: `grep -rn relay-client packages/*/Cargo.toml` (relay-client's own `Cargo.toml` has zero dependencies and is `[lib] name = "relay_client"`). Extend with a grep that fails if any non-planning source mentions `relay_client`. Precedent for "fails the build rather than convention": Phase 6 canonical-writer gate and Phase 12 install-at-every-mutation invariant (see 10-CONTEXT).

### `ARCHITECTURE.md`

`packages/relay-client/Cargo.toml` and its README both cite "ARCHITECTURE.md §8" which does not exist. Either write it with a §8 "Open-Core Module Boundary" or correct the two citations (`relay-client/Cargo.toml` description line and `README.md`). Style analog for a trust-boundary doc: `docs/destructive-gate-trust-boundary.md`.

### Contrast/brand rule enforcement (D-199)

**Analog:** `theme/__tests__/contrast.test.ts`: reads real CSS via `import tokensCssSource from "../../styles/tokens.css?raw"` so assertions bind to shipped bytes. Copy that `?raw` import for `review/review.css` and assert `.review-anchor-widget` has no brand-colour `border-left`. Computed-style variants live in `*.browser.test.tsx` (`review/__tests__/browser/legibility.browser.test.tsx`).

### Register-drain automation (D-194)

Use per item, as the register names them:
- Live-path: `scripts/uat/uat-10-agent-backlog.mjs`, `uat-03-destructive-gate.mjs`; shared helpers in `scripts/uat/lib/`; `run-all.sh`; fake CLI `packages/sidecar/test/fake-claude.mjs`.
- Rust harnesses: `packages/core/tests/` (`dispatch_auto_merge.rs`, `dispatch_plan.rs`, `scope_widen.rs`; confirm exact location with `git ls-files | grep dispatch_plan` before citing).
- Browser mode: `*.browser.test.tsx` run via `npm --prefix packages/desktop run test:browser` (also `:dark`, `:motion` variants in `package.json`).
- Subagent: `impeccable-finish-reviewer` for D-REV-11, 12, 14-19, 26.
Update `.planning/DEFERRED-REVIEW.md` per item in its own redemption protocol.

## Shared Patterns

### Exact version pinning
**Source:** `Cargo.toml:14,33` (`=2.11.5`, `=2.4.0`), `sidecar/package.json` (`"@modelcontextprotocol/sdk": "1.30.0"`), `desktop/package.json` (exact npm versions). **Apply to:** updater crate, `@tauri-apps/plugin-updater` (match `@tauri-apps/api` 2.11.1 style), `pkg`/`nexe`.

### Single IPC seam
**Source:** `adapters/tauri.ts` header. **Apply to:** all new renderer code; no direct `invoke`/`listen`/plugin imports elsewhere.

### Default-deny capability + audited command roster
**Source:** `capabilities/default.json` description. **Apply to:** every new `#[tauri::command]`.

### Server state in TanStack Query, UI state in Zustand
**Source:** `state/uiStore.ts` header comment, `fleet/useFleet.ts`. **Apply to:** update banner, hidden-project list invalidation (`board:changed` push).

### Migration plus event-log write
**Source:** `0021_*.sql`, `reconcile_projects`. **Apply to:** soft-hide.

## No Analog Found

| File | Role | Reason |
|---|---|---|
| `.github/workflows/release.yml`, `open-core.yml` | CI | No `.github/` exists |
| `LICENSE` / `NOTICE` | legal | Absent; Apache-2.0 canonical text |
| Updater `latest.json` publishing | release | Generated by `tauri-action`; nothing in repo |
| Signing/notarization config | release | No identity (0 valid), gated final plan (D-185) |
| Sidecar single-binary packaging | build | `tsc` only today |

## Metadata

**Analog search scope:** repo root, `packages/{core,desktop,sidecar,relay-client}`, `scripts/uat`, `docs/`
**Files scanned:** ~25 read or grepped
**Pattern extraction date:** 2026-10-12
