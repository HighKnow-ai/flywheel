## Deferred Items

- `npm --prefix packages/desktop run build` (`tsc`) fails on three pre-existing test-file type errors unrelated to plan 08.1-01: `src/item-detail/__tests__/forge-section.test.tsx(352,64)`, `src/settings/__tests__/settings-surface.test.tsx(179,38)` and `(180,38)` — `TS2345: Argument of type 'RegExp' is not assignable to parameter of type 'string | number'`. Plans that list `npm run build` as a gate cannot pass it until these are fixed; `npx tsc --noEmit` filtered to touched files is clean.
  status: resolved (08.1, pre-wave-2 fix)
  **Found during:** 08.1-01 Task 2
  **Resolution:** root cause was not the three call sites. `@vitest/browser/jest-dom.d.ts` augments
  vitest's `Assertion` with `toHaveTextContent(text: string | number)` — no `RegExp` — and the three
  `*.browser.test.tsx` files pulled that augmentation into the SAME `tsc` program as the jsdom
  tests, where `@testing-library/jest-dom` declares the same matcher as `string | RegExp`. The
  `string | number` signature won for every file. Fixed by giving the real-browser arm its own
  program (`tsconfig.browser-tests.json`), excluding `src/**/*.browser.test.tsx` from
  `tsconfig.json`, and running both in `npm run build`. No test assertion was rewritten and the
  browser files are still typechecked. `npm run build` and all 784 jsdom tests pass.

- The Impeccable mechanical detector cannot evaluate this phase's markup here: `detect.mjs --json` prints `DEGRADED - HTML parser modules unavailable (htmlparser2, css-select, css-tree, domutils)` and falls back to regex matching, so its empty result for the 08.1 comps is an undercount, not a clean bill. In particular the selection-rule finding (a 2px left rule against `craft-floor.md` line 35) is neither confirmed nor refuted. Not fixed by the executor: the parsers are packages and a package install is not auto-fixable. Needs the owner (or a plan 07/09 task) to install them, then re-run the detector on `comps/*.html` and `comps/comp.css`.
  status: open
  **Found during:** 08.1-04 Task 2
  **Blocks:** plan 09's selection-rule decision gate should not treat the detector as having spoken until this is closed.
