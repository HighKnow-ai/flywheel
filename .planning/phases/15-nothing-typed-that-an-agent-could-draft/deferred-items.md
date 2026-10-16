# Deferred items (plan 15-02)

Pre-existing sidecar test failures, unrelated to `submit_plan` / `undeclared`; not fixed here.

- `packages/sidecar/test/adapter.test.mjs` fails at module load: line ~699 `readFileSync`s
  `.planning/phases/05-socratic-epic-authoring/05-LIVE-RUN-01M3C48C-FAILED.log`, and that phase
  directory no longer exists in the tree.
- `packages/sidecar/test/scope-hook-live.test.mjs` "delegating the undeclared edit to a sub-agent"
  failed once in the full `npm test` run (17.8s) and passed on an isolated re-run; it drives a real
  `claude` and looks environment/timing dependent.
