# Flywheel desktop renderer

The React renderer inside the Tauri shell. Its visual world is Andon (`docs/design/direction.md`); the stack
decision is ADR 0004 (Tailwind CSS v4 and shadcn/ui).

- `@highknow/design` (pinned exact in `package.json`): HighKnow's design system, the shared tokens, base styles, fonts and the shadcn/ui primitives, compiled (ADR 0004 and ADR 0021, amended 2026-10-27).
- `src/styles/globals.css`: the package's CSS, then Flywheel's own roles, light (`:root`) and dark (`.dark`), mapped to Tailwind with `@theme inline`.
- `src/components/`: Flywheel's own shared components (`Button` and `Badge` with the `attention` tone, `StateBadge`, `Icon`, `ReadError` in Flywheel's words).
- `src/theme/__tests__/contrast.test.ts`: the per-role contrast floors, asserted in both schemes.

## End-to-end

`npm run e2e` drives the real renderer in WebKit and Chromium against the real core and the real sidecar. Every other UI test here fakes IPC.

Parts:

- `src-tauri/src/bin/flywheel-headless.rs`: the headless core. It runs the app's own handlers (`command_roster!` in `src-tauri/src/roster.rs`), `AppState`, `sidecar::spawn_sidecar` and Tauri's own events on Tauri's mock runtime. It serves them over a WebSocket on `127.0.0.1`, on a free port, and refuses a connection without its random token. Each run uses a scratch root: a git repository with a bare `origin`, a database and a worktree directory. It is built only with the `headless` feature, and a release-profile build refuses to compile.
- `src/adapters/ws-transport.ts`: the second transport behind `adapters/tauri.ts`. The Vite flag `VITE_FLYWHEEL_E2E=1` selects it. A release build drops it, and `scripts/release/check-release-bundle.mjs` and `e2e/bundle.spec.ts` check that.
- `e2e/`: the Playwright tests. `core.ts` starts a core, `fixtures.ts` gives each flow a page and a trace check, `flows/` holds the flows, `agents/` holds the scripted agents (`packages/sidecar/test/fake-claude.mjs` plays the backend) and `harness.spec.ts`, `bundle.spec.ts`, `flow-doc.test.ts`, `core-start.test.ts` and `scratch.test.ts` test the harness itself.
- `e2e/core-start.ts`: what the harness records while a core starts. The core prints one line on stderr at the end of each phase of its start (`flywheel-headless: [start] @<epoch ms> +<ms> ms <phase>`). The harness adds its own events (spawn, first byte, ready line, WebSocket) and a snapshot of the core and its children every 5 s. A core that is not ready in 60 s (times `FLYWHEEL_TEST_TIME_SCALE`) fails with this timeline, the phase it stopped in and a `sample` of its stacks. The report of every start is attached to the test as `core-start.txt`.
- `e2e/scratch.ts`: the end of a flow's scratch root. The core leads a process group of its own. `stop()` and `crash()` end every process of it (the group, and each process whose command line holds the scratch folder's name) and wait. Then the folder is removed with retries. A folder that cannot be removed stays, and the test's annotation names the process that holds it.
- Each run uses its own Vite port (`FLYWHEEL_E2E_PORT`, picked by `e2e/run.mjs`), so a run on a developer's Mac and the gate runner's run do not meet on a fixed one.
- `docs/flows/`: one doc for each flow. Its sequence diagram is the spec. The core traces each command that changes the board and each board tool call of the agent. The test fails when the trace differs from the diagram, and `--update` rewrites the diagram.

What the harness cannot cover: the Tauri window and webview (WKWebView, native menus, the folder dialog and notifications), the packaged sidecar runtime (`flywheel-node`), a real `claude` backend, and the cold start (`login_path`, launch reconciliation and the git-truth scheduler do not run).

## Third-party design assets

Each ships inside the app bundle. Versions are pinned exactly in `package.json`.

| Asset | Package | Licence |
|---|---|---|
| Icons: Lucide | `lucide-react` | ISC (`node_modules/lucide-react/LICENSE`) |
| Design system: tokens, base styles, components | `@highknow/design` | MIT (`node_modules/@highknow/design/LICENSE`) |
| Type: Public Sans (through `@highknow/design`) | `@fontsource-variable/public-sans` | SIL Open Font License 1.1 |
| Type: JetBrains Mono (through `@highknow/design`) | `@fontsource/jetbrains-mono` | SIL Open Font License 1.1 |
| Components: shadcn/ui (compiled into `@highknow/design`) | n/a | MIT |
| Primitives: Radix UI | `radix-ui` | MIT |
| Command palette: cmdk | `cmdk` | MIT |
| Styling: Tailwind CSS, tw-animate-css | `tailwindcss`, `tw-animate-css` | MIT |
