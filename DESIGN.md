# DESIGN.md — Phase 1, Plan 01-01

**Status:** No visual world authored in this plan, by design.

This plan (`01-01`: scaffold the monorepo, Tauri shell and both test harnesses) deliberately ships
zero visual surface. `App.tsx` renders a single `<div id="app-root" />` wrapped in
`QueryClientProvider` — no color, no typeface, no radius, no component chrome. `App.css` carries
only a box-sizing reset and a height-100% rule so the window fills correctly; nothing beyond the
Vite template's own reset was introduced.

The Flight Progress Strips world chosen in `01-UI-SPEC.md` § "Selected Direction" — the dark
aluminium rack chrome, the light tinted strip stock, the annotation interaction grammar — is
authored starting in plan `01-02`. Every board surface (the rack, the strips, the item detail
panel, the command palette) lands from `01-03` onward per `SKELETON.md`.

## What exists today

- A native macOS window titled "Flywheel" (`tauri.conf.json` `productName`/window `title`), minimum
  width 900px, opened via `npm --prefix packages/desktop run tauri dev`.
- A blank white content area — this is the correct, expected state. Verified visually: see
  `.impeccable/review/01-01-boot-window.png`, captured from a real `tauri dev` launch. No error
  overlay, no console errors, the React root mounts.
- No logo, no demo content, no styled buttons — the Tauri/Vite/React starter template's own demo UI
  (logos, greet form) was fully removed as out of scope for this plan.

## Review against the direction contract

Per `01-UI-SPEC.md`'s "Build Process Requirement", step 3 calls for reviewing the built surface
against the phase's direction contract. Flight Progress Strips (chosen 2026-09-09) governs plans
`01-02` onward; this plan's own acceptance criteria for that step explicitly require the review to
state "this plan authors no visual surface and that the world lands in 01-02" rather than judge an
empty screen against a rack-and-strip visual language that has nothing to render yet. That
statement is made here: **plan 01-01 intentionally ships no visual world; Flight Progress Strips
begins in 01-02.**

## Craft-floor discipline followed

`reference/craft-floor.md` was read before `App.tsx`/`index.html` were edited. Its "Refuse" list
(no gradient text, no system-display-face styling, no decorative motion, etc.) is trivially
satisfied here because no visual decisions were made at all — the file contains a reset and
nothing else. `scripts/detect.mjs --json` was run against `App.tsx` and `index.html` in degraded
mode (HTML-parser modules unavailable in this environment, regex fallback) and returned no
findings.

## What the next plan inherits

- `packages/desktop/src/adapters/tauri.ts` — the single Tauri invoke/listen seam, ready for
  `01-03`'s quick-add mutation and `board:changed` subscription.
- `packages/desktop/src/adapters/queryClient.ts` — the configured `QueryClient`
  (`refetchOnWindowFocus: false`, `staleTime: 0`), ready to have real board queries registered
  against it.
- A working `cargo test` / `npx vitest run` harness, so `01-02`'s visual-world plan and `01-03`'s
  tracer slice can both carry runnable verification from their first task.
