# Phase 13 deferred items

Out-of-scope discoveries, logged and not fixed (executor scope boundary).

## 13-03

- **`npx tsc --noEmit` in `packages/desktop` exits non-zero on a pre-existing error.**
  `src/theme/__tests__/brand-rule.test.ts(2,10)` and `(2,22)` report `TS2305: Module 'node:fs' has no
  exported member 'existsSync' / 'globSync'`. The file was last touched by `ac8715e` and is not
  modified by plan 13-03; the errors come from the installed Node type definitions, not from the
  estimate removal. Every other file type-checks clean. `vitest` runs that test file and passes.
