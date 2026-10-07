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
  status: partially resolved (08.1-04 checkpoint, owner authorised the install)
  **Found during:** 08.1-04 Task 2
  **Resolution (parsers):** the impeccable plugin at
  `~/.claude/plugins/marketplaces/impeccable` declares `htmlparser2`, `css-select`, `css-tree` and
  `domutils` as real dependencies but its `node_modules` had never been installed. Installed with
  `npm install --omit=optional` (197 packages; optional `puppeteer` skipped). The detector now runs
  in full parse mode.
  **Real result, replacing the degraded undercount:** 135 findings over the three comps and
  `comp.css`, ALL severity `warning`, zero errors — 115 `cramped-padding`, 14 `tiny-text`, 5
  `undersized-ui-text`, 1 `flat-type-hierarchy` (sizes 11/12/13/14/15/20px, ratio 1.8:1). Full
  output committed at `comps/detector-report.json`. The `cramped-padding` mass is concentrated on
  `.row`, `.nav-item`, `.lens` and `.field`, i.e. the deliberately dense row grammar D-13 fixes at
  32px/28px — the detector has no knowledge of that density contract, so these need judgement, not
  blind compliance. The 9px `FIXTURE` tag is comp-only scaffolding and does not ship.
  **STILL OPEN — and the install did not close it:** the selection-rule question is NOT mechanically
  detectable. `skill-ban-side-stripe-borders` is a prose rule in `craft-floor.md` ("a *colored*
  `border-left` or `border-right` above 1px on cards, list items, callouts, or alerts"), not a
  `detect.mjs` antipattern — the detector emits no finding for it and never can. The contract's
  treatment is `border-left: 2px solid var(--text-primary-rack)`: 2px and on a list item, but ink
  rather than an accent colour, which is exactly the ambiguity the ban's word "colored" leaves open.
  **Blocks:** plan 09 still owns this decision and must make it by judgement against the four
  alternatives rendered in `mission-control.html`. It must NOT record the detector as having
  cleared the 2px rule — the detector is silent on it by construction, not by approval.
