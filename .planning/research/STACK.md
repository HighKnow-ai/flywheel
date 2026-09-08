# Stack Research

**Domain:** Local-first desktop Agentic Development Environment (multi-agent, multi-repo git worktree supervisor with an embedded project board)
**Researched:** 2026-09-08
**Confidence:** MEDIUM overall (HIGH on process-supervision/git architecture, MEDIUM on desktop shell and UI libraries, MEDIUM-LOW on the sync-engine landscape because that market is moving fast and two of four vendors changed hands or wound down commercial offerings in the last 30 days)

All facts below were verified via targeted web search on 2026-09-08 against official docs, GitHub, and vendor blogs (not training-data recall). Confidence tiers were assigned by the project's `classify-confidence` seam: an uncorroborated `websearch` finding is LOW by policy; every claim below was cross-checked against 2+ independent sources before being promoted to MEDIUM, which is the ceiling this seam allows for web-sourced (non-ground-truth-verified) claims. Treat MEDIUM as "verified current, not vendor-audited."

---

## The Two Load-Bearing Decisions

### 1. Desktop shell: Tauri v2 (Rust core) + a bundled Node.js sidecar — not Electron, not native

**Recommendation: Tauri v2.11.x, Rust core process, React frontend in the OS-native WebView, with a bundled Node.js sidecar process that hosts the Claude Agent SDK / `claude` CLI driving logic.**

This is not a compromise "hybrid" — it is Tauri's own first-class, documented pattern (`sidecar-nodejs` guide) for exactly this problem: wrap an existing Node-ecosystem tool you don't want to reimplement in Rust, while keeping the UI shell, permission model, and OS integration in Rust.

**Why, argued against every constraint in the question:**

- **Process supervision of Node-based agent CLIs.** The thing you are actually supervising — `claude` (headless `-p`/`--output-format stream-json`, or the Agent SDK) — is a separate OS process regardless of shell choice; you are not embedding it in-process either way. What differs is *who drives it*. The Claude Agent SDK is TypeScript/Python-first: session lifecycle, hook wiring, MCP server registration, and structured `stream-json` message parsing are a well-typed, well-documented experience in Node and a from-scratch reimplementation in Rust. Tauri's answer is to not fight this: bundle a self-contained Node binary (via `pkg`/`nexe`, registered as `externalBin` in `tauri.conf.json`) as a sidecar. Rust owns *supervising the sidecar* (spawn, health-check, restart-on-crash, kill-on-app-exit — solving your "surviving app restarts / killing orphans" requirement at the OS-process-tree level, which Rust does natively and well via `tokio::process` + platform process-group APIs). The sidecar owns *driving individual agent sessions* (one Node child process per active worktree, using the Agent SDK). This cleanly separates "the supervisor never drifts into a worker's directory" (a Rust-owned invariant, enforced by never passing a `cwd` override to the sidecar's own working directory) from "how do I parse Claude's event stream" (a Node-owned concern, solved by the SDK's own types).
- **PTY handling.** Headless print mode (`-p --output-format stream-json`) does not need a PTY at all — it's a plain stdio JSON stream, which covers the primary v1 workload. If/when a future feature needs real TTY semantics (an "attach and watch" terminal view, or a backend CLI that insists on a TTY), put `node-pty` (npm, latest stable 1.1.0, with 1.2.0-beta.15 in flight as of Aug 2026) inside the *same* Node sidecar that consumes the byte stream, rather than terminating a PTY in Rust (via `portable-pty`, the WezTerm-project crate) and relaying raw PTY bytes across an IPC boundary to a Node-side parser. Keep PTY termination and PTY consumption in the same process family. Caveat: `node-pty` requires native (N-API) compilation per platform/arch/Node-ABI and has open 2026 issues around Electron/V8-ABI drift — this risk *disappears* in the sidecar approach because the sidecar is a plain Node runtime with a fixed, self-controlled Node version, not an Electron-patched V8 needing rebuilds on every Electron bump.
- **Binary size / distribution.** Tauri's celebrated size advantage (~3-4MB "hello world" vs Electron's ~85MB) comes from not bundling Chromium — the UI renders in the OS's native WebView (WebView2 on Windows, WebKit on macOS/Linux). Bundling a self-contained Node runtime for the sidecar adds back real weight (roughly 50-80MB per platform), so the final installer will not be a 4MB app — but it will still ship *no Chromium*, which is the actual bulk driver in Electron, and it stays independently auditable (one OS-native WebView + one Node runtime, vs. one full patched Chromium fork). Net: still meaningfully smaller and lower-idle-memory than Electron, just not "hello world" small.
- **Auto-update / code signing / notarization for OSS distribution.** Roughly a wash. Tauri v2 ships a built-in updater with ed25519 signature verification for NSIS/MSI/AppImage/App-bundle artifacts, macOS notarization via App Store Connect API or Apple ID (note: a free Apple Developer account cannot notarize — budget for the $99/yr paid account), and Windows signing via Azure Key Vault. Electron's tooling (electron-builder / electron-updater, notarytool) is equally mature. This criterion does not favor either shell strongly enough to be decisive.
- **Security model, which directly serves the "supervisor must never drift into a worker's worktree" failure mode named in PROJECT.md.** Tauri v2's permission system is default-deny — every filesystem/shell/process capability is explicitly granted per-window in a capabilities manifest. This gives you a structural way to enforce "the UI/renderer can only ever reach the Rust command surface, never touch the filesystem directly" — useful when the UI later needs to render arbitrary agent-produced diffs without those diffs being able to reach outside their worktree. Electron's default is permissive; the same boundary is achievable but must be hand-built and hand-audited (contextIsolation, disabled remote module, careful preload scripts) rather than declared.
- **Reuse of the UI for a future web surface.** A wash between the two shells (both wrap a web frontend), but a real constraint either way: isolate every Tauri-specific call (`@tauri-apps/api` invoke/listen) behind one thin adapter module from day one, so the same React tree can later be pointed at a REST/WebSocket client against the relay with a single-file swap. This is an architectural discipline you must apply regardless of shell choice — call it out as a phase-1 requirement, not a stack decision.

**Runner-up: Electron.** Loses primarily on bundle size/idle memory (a real cost when a developer is running Flywheel *alongside* several `claude` sidecar processes *alongside* their editor, all day, on a laptop) and on the permissive-by-default security model, which cuts directly against your named failure mode. Electron's one genuine advantage — Node already in-process, no sidecar/IPC boundary needed — is real but not decisive: the IPC boundary Tauri's sidecar requires is a JSON-over-stdio or local-socket protocol you'd be building internally anyway (it becomes the same seam the future relay will speak over), so it is not wasted work.

**Rejected outright: native (Swift, or Rust+egui/iced).** Swift is macOS/iOS-only, which is disqualifying given the developer runs projects across machines and the product should not be platform-locked at v1 for no stated reason. Rust+egui is small and fast but its component ecosystem (virtualized lists, diff viewers, DAG views, drag-and-drop board interactions) is a small fraction of the web ecosystem's maturity, and — decisively — it forecloses "the UI layer should be reusable for a future web application," which is a stated requirement, not a nice-to-have. Rejected without further debate.

**Confidence: MEDIUM.** The size/memory/security comparisons are well-corroborated across multiple 2026 sources; the specific "sidecar is the standard mitigation for Node-first agent tooling" claim is verified directly against Tauri's own official docs (`v2.tauri.app/learn/sidecar-nodejs`), which is about as close to HIGH as a websearch-sourced claim gets under this project's confidence policy.

---

### 2. Local persistence + future sync: SQLite (via `rusqlite`) as the store of record, with a sync-ready schema designed in from day one — defer picking the wire sync engine

**Recommendation: `rusqlite` (0.40.x) embedded directly in the Rust core, WAL mode, as the single local database. Do not adopt ElectricSQL, PowerSync, or Zero as a *dependency* in v1. Instead, design the v1 schema so any of them (PowerSync is the likely eventual pick) can be bolted on later without a rewrite.**

This directly answers the PROJECT.md constraint: *"must be able to gain a cloud sync/relay layer LATER without a schema rewrite."* The way to satisfy that constraint is not to pick a sync vendor now — it's to make the **local schema shape** sync-engine-agnostic, because every credible option in this space (PowerSync, Zero, and even a hand-rolled relay) converges on the same three schema primitives:

1. **Append-only event log as the source of truth**, with materialized "current state" tables built by folding it (classic event-sourcing). This is not optional scaffolding — PROJECT.md already requires "a durable append-only event log" for the agent-authored-backlog and context-reconstitution features, independent of sync. Every mutation (board edit, agent proposing a task, session summary written) is an `events` row; current-state tables (`epics`, `tasks`, `issues`, `agent_runs`) are derived. This is exactly the shape a future relay needs to replicate (it can tail the event log), and exactly the shape PowerSync/Zero expect (both are fundamentally "replicate a change stream, replay it elsewhere" systems).
2. **Globally-unique, client-generated primary keys** (ULID or UUIDv7, not `AUTOINCREMENT`). Autoincrement IDs collide the moment two clients (a second machine, or the future relay) write concurrently; ULIDs don't, and cost nothing to adopt now.
3. **An `actor_id` on every event/row.** This is also independently required by PROJECT.md's "multi-actor identity in the schema" — model every actor (the user, each named agent session, a future teammate, a future automation trigger) as a row in an `actors` table from day one, even though only one human actor exists in v1.

If you build those three things now — which you must build anyway for the event log and multi-actor requirements — then adding a wire sync layer later is additive, not architectural. That's the concrete mechanism behind "no schema rewrite."

**Why not adopt a sync engine now:**

- **ElectricSQL** pivoted its core approach once already (CRDT-based → shape-subscription sync), and as of **11 August 2026, Electric was acquired by Databricks**; its commercial sync service, **Electric Cloud, is winding down** (customers told to self-host or migrate). The OSS pieces it had already released (PGlite, Postgres Sync, TanStack DB) remain open, but the company's sync-engine roadmap is now folded into Databricks/Neon's agent-sandbox strategy — a materially different target market than a small OSS desktop tool's future relay. Building the relay's core dependency on a project that just lost its standalone commercial identity is a real risk, one month old as of this research.
- **PowerSync** is the most mature and best-aligned option (client SDKs Apache-2.0; explicitly positioned as "you already have a SQLite app, add Postgres sync later" — literally your requirement) but its Node.js server SDK is still **Beta** (`@powersync/node` 1.0.0-beta as of this research), and its self-hosted service is licensed **FSL-1.1-ALv2** (source-available, converts to Apache-2.0 two years after each release) — acceptable to run as part of your *own* commercial cloud/relay layer (which doesn't need to be OSS), but not something to vendor inside the OSS desktop app today while it's still moving.
- **Zero (Rocicorp)** just reached **1.0 in June 2026** — fully Apache-2.0, client and server, which is the cleanest license of the three — but "just reached 1.0" means limited production track record, Postgres-only backend, and its query paradigm (ZQL, schema authored in TypeScript) is a stronger lock-in on your relay's implementation language than PowerSync's "sync rules over your existing Postgres schema" model.
- **Triplit** was **acquired by Supabase in October 2025**; its roadmap is now subordinate to Supabase's product plans — same category of risk as Electric, and a worse fit besides (Supabase's gravity pulls toward the Supabase stack, not a standalone relay you own).
- **Automerge / Yjs (raw CRDTs)** are the wrong data shape for this problem and should not be the primary store. They're purpose-built for concurrent *document* edits (rich text, structured-but-freeform JSON with fine-grained merge semantics) — CRDT issue-tracker research in 2026 confirms the actual practice: CRDTs get applied *surgically* to specific rich-text fields (an issue description, a comment body) inside an otherwise relational schema, not to the whole board. If/when task descriptions need real-time collaborative editing, add Yjs or Automerge to that one field later; don't model `epics`/`tasks`/`issues` as CRDT documents now — it adds serialization and merge-conflict-UI complexity for zero v1 benefit (single user, single machine).
- **PGlite (embeddable WASM Postgres)** is explicitly **alpha** ("not recommended for mission-critical production workloads without thorough vetting," per its own docs) and is **single-connection/single-user by design** — a real mismatch for a multi-process architecture (Rust core + Node sidecar + UI thread) that may want concurrent local access. It's a genuinely interesting tool for a *future* fully-local web demo of the relay (Postgres semantics in a browser tab), but not the v1 desktop store of record.

**What to build now, concretely:**
- `rusqlite` (0.40.x) in the Rust core, one `.db` file per... consider one *shared* local database for the whole fleet (all projects, all epics) rather than one DB per repo — the board's whole value proposition is a single fleet-wide view, and SQLite comfortably handles this scale (hundreds of epics/tasks, thousands of events) on one machine.
- WAL mode + `busy_timeout` for safe concurrent access from the Rust core and any local read-only tooling (e.g., a future CLI or debug inspector).
- Migrations via a lightweight Rust migration crate (e.g. `rusqlite_migration`) — do not hand-roll schema versioning.
- Do not use `better-sqlite3` (Node/N-API) as the *primary* store — it's the right tool if the sidecar ever needs its own local read path, but the Rust core, which owns supervision and the event log, should own the canonical database directly via `rusqlite` to avoid two processes racing on file locks unnecessarily. If the sidecar needs data, it should ask the Rust core over the sidecar IPC channel, not open the SQLite file itself.
- Do not use `libSQL`/Turso for v1 — it's a superset of SQLite with remote-replica features you don't need yet, and it adds a second SQLite dialect/toolchain to reason about for no v1 benefit. Revisit only if you later want Turso's edge-replica hosting for the relay specifically.

**Confidence: MEDIUM-LOW on which specific vendor wins the *future* sync decision** (the market moved twice in the last 12 months — Electric's pivot, then acquisition; Triplit's acquisition; Zero's 1.0 — and could move again before you build the relay). **MEDIUM-HIGH on the "don't decide now, design the schema to defer the decision" strategy itself**, which is corroborated by how convergent PowerSync/Zero/a-hand-rolled-relay all are on event-log + stable-ID + actor-attribution as prerequisites.

---

## Recommended Stack

### Core Technologies

| Technology | Version (verified 2026-09-08) | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Tauri | 2.11.x (stable line since Oct 2024; 2.10.1 Mar 2026, 2.11.5 Jul 2026) | Desktop shell: Rust core + OS-native WebView | Smallest footprint, default-deny permission model matches the "supervisor never drifts into a worktree" invariant; official sidecar pattern solves Node-agent-tooling friction without abandoning Rust for the supervisor. See decision #1 above. |
| React | 18.x / 19.x (use whichever is current `create-tauri-app` React template ships) | UI framework | Deepest ecosystem for exactly the widgets this app needs (virtualization, diff view, DAG view); largest hiring/AI-assistant familiarity pool; cleanest reuse path to a future standalone web app. |
| Node.js (bundled sidecar runtime) | LTS current (22.x/24.x — match whatever `@anthropic-ai/claude-agent-sdk` officially supports) | Hosts the Claude Agent SDK / `claude` CLI driving logic as a Tauri sidecar | TS/Python-first Agent SDK is dramatically easier to drive from Node than to reimplement stream-json/hook/MCP parsing in Rust; this is Tauri's documented mitigation pattern. |
| `rusqlite` | 0.40.x | Embedded SQLite, Rust-native, in the core process | No IPC overhead for the hottest read/write path (board mutations, event log); native Rust bindings avoid N-API/ABI friction entirely. See decision #2 above. |
| `@anthropic-ai/claude-agent-sdk` | 0.3.x line (0.3.233 seen Aug 2026; weekly releases — pin and update deliberately) | Programmatic Claude Code control: sessions, hooks, MCP, structured results | Typed tool-call loop, hook system, first-class MCP client support, and (critically) prefers local Claude Code credentials over `ANTHROPIC_API_KEY` when both exist — satisfies "use the developer's existing local credentials." |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-pty` | 1.1.0 stable (1.2.0-beta.15 in flight) | PTY semantics for agent processes that need a real TTY | Only when headless `stream-json` mode is insufficient — e.g. a future "attach and watch" live-terminal feature. Run it inside the Node sidecar, not the Rust core. |
| `portable-pty` (Rust) | latest (WezTerm project) | Cross-platform PTY for anything the Rust core itself needs to terminal-drive directly | Rare in this architecture — prefer keeping PTY-consuming logic in the sidecar. Reach for this only if a Rust-native tool (not an agent CLI) needs PTY semantics. |
| `git2` (git2-rs / libgit2 bindings) | current | Fast reads: diff, status, log, blob/tree walks for the diff-review UI | Hot-path, read-heavy git operations where shelling out has real per-call overhead. **Not** for worktree lifecycle operations — see decision below. |
| System `git` CLI, shelled via `tokio::process::Command` | whatever the developer has installed (document a minimum, e.g. git >= 2.44) | Worktree create/remove/list/prune, branch topology (task → epic-integration-branch → main), merges | libgit2/git2-rs worktree support measurably lags the git CLI (e.g. no relative-worktree support matching git >=2.48 as of a still-open 2026 libgit2 issue) — for worktree operations, the CLI's behavior *is* the spec you want to match exactly. Do not use NodeGit (stale/unmaintained) or isomorphic-git (no real worktree support, pure-JS, wrong runtime) for this. |
| `tokio-cron-scheduler` | 0.15.x | In-core scheduling primitive for the generic trigger abstraction | Not wired to a UI feature in v1 (scheduled automations are out of scope), but the crate should be vendored and the "cron tick" trigger type stubbed now, so schedule-as-trigger-source is a drop-in later, per the architecture constraint. Runs in-process in the Rust core (not the sidecar) because trigger evaluation belongs next to the event log, and must not depend on sidecar lifecycle. |
| `rusqlite_migration` | current | Versioned SQLite schema migrations | From the first migration — do not hand-roll schema versioning for a database that will accumulate agent-generated data you can't afford to lose. |
| `@tanstack/react-virtual` | 3.14.x | Virtualized fleet/board list rendering | Board views and fleet-status views with potentially hundreds of cards; headless model gives full control over custom board-card layout (vs. `react-virtuoso`'s more opinionated components). |
| `react-diff-view` | 3.3.x | Git-style unified/split diff rendering for the diff-review UI | Purpose-built for unidiff parsing, has a decoration API useful for "turn this diff line into a new issue" interactions. |
| `@monaco-editor/react` (DiffEditor) | current | Full-editor-affordance diff/file viewing | When the review UI needs to also let the user open/edit a file, not just review a patch — complementary to `react-diff-view`, not a replacement. |
| `@xyflow/react` (React Flow) | 12.11.x | DAG/graph views: epic→task dependency graphs, worktree topology | MIT-licensed (fully, since 2019), mature, actively released; the Pro platform's layout tooling (dagre-based auto-layout) was open-sourced too. |
| `@tanstack/react-query` | current v5 | Data-fetching/caching layer between UI and the Tauri command surface | The seam that makes the UI reusable for a future web app: swap the query functions' transport (Tauri `invoke` → REST/WS) without touching component code. |
| Zustand or Jotai | current | Local UI state (not server/DB state) | Lightweight, no boilerplate; pick one and keep server state entirely in TanStack Query — don't let UI state and DB state blur, since that blur is exactly what makes an eventual web port painful. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `pkg` or `nexe` | Compile the Node sidecar into a self-contained binary per target triple | Required by Tauri's sidecar bundling convention (`src-tauri/binaries/<name>-<target-triple>`). |
| Tauri CLI (`@tauri-apps/cli`) | Dev server, bundling, signing orchestration | Matches Tauri core version — pin together. |
| GitHub Actions (macOS/Windows/Linux runners) | CI build + code signing + notarization | Standard for Tauri OSS releases; budget for a paid Apple Developer account ($99/yr) since notarization is unavailable on the free tier. |

## Installation

```bash
# Desktop shell scaffold
npm create tauri-app@latest -- --template react-ts

# Rust core dependencies (Cargo.toml)
cargo add rusqlite --features bundled,serde,chrono
cargo add rusqlite_migration
cargo add tokio-cron-scheduler
cargo add git2
cargo add tokio --features full

# Node sidecar
mkdir sidecar && cd sidecar
npm init -y
npm install @anthropic-ai/claude-agent-sdk node-pty
npm install -D pkg typescript

# Frontend (React)
npm install @tanstack/react-query @tanstack/react-virtual react-diff-view @xyflow/react @monaco-editor/react zustand
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Tauri v2 + Node sidecar | Electron (Node in-process) | If the product ever needs deep, unavoidable reliance on Node-only native modules across the *entire* app (not just the agent-driving layer), or the team has zero Rust appetite and ships faster accepting the size/security tradeoff. Not the case here. |
| `rusqlite` local + defer sync engine | PowerSync adopted from day one | If the relay/cloud milestone is committed to starting within weeks, not "later" — adopting PowerSync's client SDK now (even before turning sync on) would pre-shape the schema correctly and save a migration step, at the cost of coupling v1 to a still-Beta Node SDK. |
| Shell out to `git` CLI for worktree ops | `git2-rs` for everything, including worktrees | If/when libgit2's worktree support catches up to the git CLI (watch the upstream issue tracker) and you want a single dependency instead of two code paths. Not yet, as of this research. |
| React + Tauri WebView | Svelte + Tauri WebView | If bundle size of the *frontend* specifically (not the Node sidecar) becomes a measured problem, or the team has a strong existing Svelte investment — SvelteFlow and Svelte's smaller runtime are real, but React's board/diff/virtualization component depth and hiring pool are wider, which matters more for an OSS project seeking contributors. |
| `@xyflow/react` for DAG views | `dagre`/`d3-dag` raw, with hand-rolled rendering | If graph views need highly custom, non-node-editor visuals (e.g. a pure static dependency chart with no interactivity) — React Flow's interactive node-editor affordances (drag, connect, zoom) are overkill for a read-only chart. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| ElectricSQL as a v1 or near-term dependency | Acquired by Databricks (Aug 2026); its commercial sync product (Electric Cloud) is winding down; standalone roadmap uncertain | PowerSync (front-runner) or Zero (if full Apache-2.0 licensing end-to-end is a hard requirement) — evaluate concretely when the relay milestone starts, not now |
| Triplit | Acquired by Supabase (Oct 2025); roadmap now subordinate to Supabase's product direction | Same as above |
| Raw Automerge/Yjs as the primary board schema | Wrong data shape — CRDT document merge semantics for what is fundamentally relational/structured data (epics, tasks, issues); adds serialization and conflict-UI complexity for zero v1 benefit | Relational SQLite schema with an append-only event log; reach for Yjs/Automerge later, surgically, only on specific rich-text fields (e.g. a collaboratively-edited issue description) |
| PGlite as the primary local datastore | Explicitly alpha; single-connection/single-user by design — mismatched for a multi-process (Rust core + Node sidecar) architecture | `rusqlite` in the Rust core |
| NodeGit | Effectively stale/unmaintained; painful native-module rebuild story | System `git` CLI (worktree/topology ops) + `git2-rs` (hot-path reads) |
| isomorphic-git for worktree operations | No meaningful worktree support; pure-JS runtime mismatch for a Rust core anyway | Same as above |
| libgit2/`git2-rs` for worktree create/remove/prune | Measurably lags the git CLI on worktree edge cases (e.g. relative worktrees, git >=2.48) | Shell out to system `git` for worktree lifecycle specifically |
| `better-sqlite3` as the canonical database | It's a Node/N-API library; using it as the store of record would put your source of truth in the sidecar process instead of the Rust core that owns supervision and the event log, inviting file-lock races between two processes | `rusqlite` in the Rust core; sidecar reads through Rust-owned IPC if it needs data |
| A Rust-native GUI toolkit (egui/iced) for the whole app | Immature widget ecosystem for board/diff/DAG UI; forecloses the stated "reusable for a future web app" requirement | Tauri + React (web frontend in a native WebView) |

## Stack Patterns by Variant

**If the future relay ends up needing to serve a fully-web (no desktop) demo or mobile client before the desktop app's local schema has "settled":**
- Prototype that surface against PGlite (WASM Postgres) in the browser rather than standing up a real Postgres server — it's explicitly good at exactly this ("local-first, single-user, embeddable") even though it's the wrong choice for the desktop app's canonical store.
- Because Electric's OSS PGlite package remains open-source post-acquisition, this option survives the vendor risk noted above even if you'd avoid depending on Electric's sync product.

**If a future agent backend (Codex CLI, Gemini CLI) needs a different process-driving model than Claude Code's stream-json:**
- Keep backend-specific driving logic inside the Node sidecar behind the adapter seam PROJECT.md already requires; the Rust core's supervision contract (spawn/health-check/kill/restart) should stay backend-agnostic and never need to know which CLI it's supervising.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| Tauri 2.11.x | `@tauri-apps/cli` same minor line | Pin Rust core and CLI together; mismatches cause silent build-config drift. |
| `rusqlite` 0.40.x (bundled feature) | SQLite 3.4x (whatever `bundled` vendors) | Use the `bundled` Cargo feature so the SQLite version is deterministic across dev machines and CI, not whatever system SQLite happens to be installed. |
| `@anthropic-ai/claude-agent-sdk` 0.3.x | Node.js LTS current at time of sidecar build | SDK ships weekly; pin an exact version in the sidecar's `package.json` and update deliberately — do not float `^0.3.x` given the release cadence. |
| `node-pty` 1.1.0 | Node ABI of the bundled sidecar runtime, not the app shell's Node version | Because the sidecar is a plain Node process (not Electron), there is no Electron-ABI rebuild problem — but the sidecar's packaged Node version must still match what `node-pty` was compiled against. |

## Sources

- `v2.tauri.app/learn/sidecar-nodejs`, `v2.tauri.app/develop/sidecar` — official Tauri Node.js sidecar pattern (verified 2026-09-08)
- `v2.tauri.app/distribute/sign/macos`, Tauri release notes (`tauri.app/release/core`) — Tauri v2.10.1 (Mar 2026) / v2.11.5 (Jul 2026), code signing/notarization/Azure Key Vault — confidence MEDIUM
- DoltHub, buildmvpfast.com, tech-insider.org 2026 Tauri-vs-Electron comparisons — bundle size (~3-4MB vs ~85MB) and idle-memory figures, cross-corroborated across 3+ independent sources — confidence MEDIUM
- `electric.ax/blog/2026/08/11/electric-joining-databricks`, Databricks blog, TechTarget, The New Stack — Electric/Databricks acquisition and Electric Cloud wind-down, Aug 2026 — confidence MEDIUM
- `powersync.com/legal/fsl`, `powersync.com/open-source`, `docs.powersync.com/client-sdk-references/node` — PowerSync licensing (Apache-2.0 clients / FSL server) and Node SDK Beta status — confidence MEDIUM
- InfoQ, `zero.rocicorp.dev/docs/open-source` — Zero 1.0 release (June 2026), Apache-2.0 licensing — confidence MEDIUM
- `pglite.dev/docs/about`, GitHub `electric-sql/pglite` — PGlite alpha status, single-connection design — confidence MEDIUM
- GitHub `libgit2/libgit2` issue tracker (relative-worktree support gap) — confidence MEDIUM
- `github.com/microsoft/node-pty`, various 2026 Electron-rebuild issue threads — node-pty maintenance status and native-module ABI friction — confidence MEDIUM
- npm registry pages (`@anthropic-ai/claude-agent-sdk`, `node-pty`, `@xyflow/react`, `react-diff-view`, `@tanstack/react-virtual`) — version numbers as observed 2026-09-08 — confidence MEDIUM (self-reported registry data, not independently audited)
- Anthropic docs (`code.claude.com/docs/en/agent-sdk`, `code.claude.com/docs/en/permission-modes`) via web search summaries — headless mode, session resumption, permission modes, credential precedence — confidence MEDIUM

---
*Stack research for: Flywheel — local-first Agentic Development Environment (desktop)*
*Researched: 2026-09-08*
