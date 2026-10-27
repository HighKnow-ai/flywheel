# Flywheel desktop renderer

The React renderer inside the Tauri shell. Its visual world is Andon (`docs/design/direction.md`); the stack
decision is ADR 0004 (Tailwind CSS v4 and shadcn/ui).

- `@highknow/design` (pinned exact in `package.json`): HighKnow's design system, the shared tokens, base styles, fonts and the shadcn/ui primitives, compiled (ADR 0004 and ADR 0021, amended 2026-10-27).
- `src/styles/globals.css`: the package's CSS, then Flywheel's own roles, light (`:root`) and dark (`.dark`), mapped to Tailwind with `@theme inline`.
- `src/components/`: Flywheel's own shared components (`Button` and `Badge` with the `attention` tone, `StateBadge`, `Icon`, `ReadError` in Flywheel's words).
- `src/theme/__tests__/contrast.test.ts`: the per-role contrast floors, asserted in both schemes.

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
