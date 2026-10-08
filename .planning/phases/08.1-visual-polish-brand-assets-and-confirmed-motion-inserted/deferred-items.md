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

- `gsd_run query state.update-progress` reports a wrong percentage and a wrong completed-phase
  count, so every progress figure in STATE.md and in `/gsd-progress` understates this project.
  Observed 2026-10-07 during 08.1-04: the verb returns
  `{"updated":true,"percent":0,"completed":189,"total":205,"bar":"[░░░░░░░░░░] 0%"}` — 189/205 is
  92%, not 0% — and writes `completed_phases: 0` while `gsd_run query roadmap.analyze` reports 9 of
  13 phases complete. STATE.md's body text disagrees with both, reading "6 of 13 phases complete".
  Three sources, three different answers.
  status: open
  **Found during:** 08.1-04 (noted by the executor, diagnosed by the orchestrator)
  **Not fixed here, deliberately:** the defect is in the shared global tool at
  `~/.claude/gsd-core/bin/gsd-tools.cjs` (@opengsd/gsd-core 1.13.0), not in this repository.
  Patching a shared binary mid-phase would change behaviour for every other project on this machine
  and is out of scope for a visual-polish phase. Hand-editing the STATE frontmatter is futile
  because the verb overwrites it on the next call.
  **Impact:** cosmetic reporting only — no product behaviour and no gate depends on it. Phase
  completion is decided by ROADMAP success criteria and the verifier, not by this bar.
  **To fix:** report upstream to @opengsd/gsd-core, or pin a corrected local copy.

- The browser arm regenerates tracked Phase 8 evidence on every run. `src/review/__tests__/browser/legibility.browser.test.tsx` and its neighbour write fixed-path PNGs into `.planning/phases/08-review-and-merge-inside-flywheel/uat-screenshots/` (`uat-01-review-diff-1440x900.png`, `uat-02-epic-rail-1440x900.png`). Any `test:browser` or `test:browser:dark` run therefore modifies two tracked files, and the dark run overwrites the light images.
  status: open
  **Found during:** 08.1-07 (running both browser arms)
  **Not fixed here, deliberately:** the screenshots are Phase 8 UAT evidence of the OLD palette, and changing where tests write is a test-infrastructure decision beyond a token plan. 08.1-07 restored them with `git checkout` after every run and never staged them.
  **To fix:** write the screenshots to the gitignored `.vitest/` output directory, or key the filename by scheme, in a later test-infrastructure pass.

- Epic header rows are not selectable in the epic lens, so the epic detail panel and `continue-shaping` cannot be reached from the keyboard map there (they remain reachable in the status lens and the palette).
  status: resolved
  **Resolved by:** 08.1-11 — `EpicHeaderRow` is a selection target keyed by the epic's id (click, `j`/`k`, Enter/`o` for detail, `r` for continue-shaping), proved in `epic-roster.test.tsx`.
  **Found during:** 08.1-10
  **Not fixed here, deliberately:** the epic header is plan 11's `EpicHeaderRow`; making a placeholder header selectable would be built twice.
  **To fix:** plan 11 gives `EpicHeaderRow` a selection target keyed by the epic's id.

- Under an active filter the epic lens lists every roster epic with the aggregate's unfiltered count; only the rows inside are filtered. Amendment A-04's "13 epics narrow to 5" under the has-worktree chip is not realised as header narrowing.
  status: open
  **Found during:** 08.1-10
  **Not fixed here, deliberately:** the aggregate is board-wide by plan 05's design, and hiding headers from loaded rows would be a second filter implementation (D-03).
  **To fix:** a filter-aware aggregate in the core, or a core-side "epics matching this filter" read.
  **ESCALATED by the orchestrator 2026-10-08 — this contradicts a decision the owner actually took.**
  A-04 was a `blocking-human` gate. The owner was shown all three readings with their verified
  real-board consequences and chose `any-child` precisely so the roster would narrow from 13 epics to
  5 with grouping intact; he explicitly rejected `always` because it "would leave 8 of the 13 as
  empty shells". As shipped, the epic lens under the chip renders every epic header with its
  unfiltered count, which is behaviourally `always` — the option he declined. The core SQL clause
  itself is correct (verified against the live database: 5 distinct epics own the 5 active
  worktrees); the gap is that the epic lens does not consult it for headers.
  **No plan owns this.** Plan 11 is frontend-only (EpicHeaderRow, summaryLine, BoardView, BoardRow)
  and already carries a low-confidence 100k estimate; a filter-aware core aggregate is a Rust query
  plus a command plus a hook, which would change that plan's character from render to data. Closing
  this properly wants its own small plan. Raised to the owner at the wave 6/7 boundary; left open
  pending his call so that neither the gap nor the decision it contradicts is silently absorbed.

- An epic reached from the epic lens knows no status or priority: the roster (`epic_list_all`) carries only id, key and title. The status, priority, estimate and assignee pickers and reordering refuse such an epic (`BoardView.isRosterEpic`), and the detail panel hides its Status control when no status is known. The epic's status is used only when the epic happens to be in the 200-row board window.
  status: open
  **Found during:** 08.1-11
  **Not fixed here, deliberately:** carrying status and priority on the roster is a Rust DTO change in a plan that is otherwise render-only, and the detail panel is not this plan's surface.
  **To fix:** add status (and priority) to `EpicSummary` / `epic_list_all`, then build the selection target from them and drop `isRosterEpic`.

- The summary line's "agents blocked, and for how long" clause is implemented and tested in `summaryLine`, but the board feeds it no duration: no fetched aggregate carries a blocked-since (`board_blocked_summary` returns ids and a count only). Today it prints "N agents blocked" with no duration, which is true but less than D-09 asks.
  status: open
  **Found during:** 08.1-11
  **Not fixed here, deliberately:** a clause that needs data nobody fetched is a new query (plan 11, Task 3).
  **To fix:** add a longest-blocked age to `board_blocked_summary`, pass it as `blockedForMs` in `BoardView.summaryText`.

- The summary line shows in the epic lens only. It reads the epic aggregate, which the status lens deliberately never fetches (plan 10), so the status lens opens without it.
  status: open
  **Found during:** 08.1-11
  **To fix:** if the owner wants it on both lenses, fetch the aggregate in both (one query) or derive `reviewable` from the list counts there.

- Primary buttons across the product paint `--text-primary-rack` on an `--accent-nontext` fill: 3.05:1 in light and 4.42:1 in dark, both under the 4.5 text floor. Found while finishing `ChallengeRow`'s Accept button, which 08.1-14 fixed by adding the `--text-on-accent` role (`#ffffff`, 5.17:1 in both modes, asserted in `contrast.test.ts`). The same defect remains in six other files, each owned by a later finish plan: `launch-sheet/LaunchSheet.tsx:862` (17), `authoring/ProposalRow.tsx:370` and `authoring/ProposalAmendEditor.tsx:237` (18), `item-detail/ItemDetailPanel.tsx:244,263,282` and `item-detail/RunsSection.tsx:319` (15), `review/MergeConfirmSheet.tsx:377` (16).
  status: open
  **Found during:** 08.1-14
  **Not fixed here, deliberately:** those files belong to plans 15-18's surface groups.
  **SUPERSEDED 2026-10-08 by an owner decision — do NOT follow the instruction struck through below.**
  ~~To fix: in each, `color: "var(--text-on-accent)"` on the filled button.~~ That instruction kept the
  brand fill and only compensated for its contrast, which contradicts what the independent finish
  reviewer ruled for `ChallengeRow` (brand fill on an action violates the brand rule: "the brand
  carries progress... It is never the brand") and what 08.1-14's closure actually shipped. Following
  it would have left one neutral Accept button beside six brand-filled siblings.
  **The owner was asked and decided: Flywheel has NO brand-filled primary buttons.**
  **To fix (binding):** in each of the six files, REMOVE the `--accent-nontext` background and draw
  the button with a `--border-control` edge on its own surface, exactly as 08.1-14 redrew
  `ChallengeRow`'s Accept and Reject and as the approved comp draws `Answer`. This removes the AA
  defect's cause rather than compensating for it, so no `--text-on-accent` is needed on these.
  `--text-on-accent` itself stays declared for now; if nothing references it once plans 15-18 are
  done, plan 20 should retire it the way plan 13 retired `--duration-displace`.
  **PROGRESS 2026-10-08 (08.1-15):** four of the six are redrawn: `item-detail/ItemDetailPanel.tsx` (Start Work, Review, Continue Shaping) and `item-detail/RunsSection.tsx` (Watch Live) now use `control-edge` with a transparent ground, pinned by `item-detail/__tests__/finish.test.tsx` and measured in WebKit. Still open: `launch-sheet/LaunchSheet.tsx` (17), `authoring/ProposalRow.tsx` and `authoring/ProposalAmendEditor.tsx` (18), `review/MergeConfirmSheet.tsx` (16).
  **PROGRESS 2026-10-08 (08.1-16):** `review/MergeConfirmSheet.tsx` is redrawn (control edge, transparent ground), and so are the three sibling brand fills in the same group that the register did not list: `review/ReviewSurface.tsx` (header Merge) and `review/EpicRequestSheet.tsx` (the bar's and the sheet's Open request). Pinned by `review/__tests__/finish.test.tsx` and measured in WebKit by `review-group.browser.test.tsx`. Still open: `LaunchSheet` (17), `ProposalRow` and `ProposalAmendEditor` (18).

- Destructive confirmation buttons paint `--text-primary-rack` on a `--destructive-strip` FILL: 2.95:1 in light (`#1f2328` on `#cf222e`) and 2.86:1 in dark (`#ededed` on `#f85149`), both under the 4.5 text floor. Found finishing `WorktreeRemovalDialog`'s Remove (08.1-15), which now draws it as the destructive text role on its own surface, a `--destructive-text-rack` edge, no fill (that pair is 5.03 / 5.72 on `--surface-secondary`, asserted in `contrast.test.ts`). Four siblings still carry the fill, each with a stale comment claiming "6.3:1" (the retired palette's figure): `board/DeleteConfirm.tsx:111` (19), `recovery/OrphanRecoveryModal.tsx:82` (19), `session/PermissionRequestCard.tsx:337` (17, the Deny button). The destructive fill was not named in the owner's primary-button decision (that decision is about the BRAND fill), so this is a separate AA defect with the same shape.
  status: open
  **Found during:** 08.1-15
  **Not fixed here, deliberately:** those files belong to plans 17 and 19's surface groups.
  **To fix:** the same redraw as 08.1-15: `background: "transparent"`, `color` and `borderColor` of `var(--destructive-text-rack)`, the `control-edge` class for the edge and radius, and delete the "6.3:1" comment. `item-detail/__tests__/finish.test.tsx` shows the assertion shape.

- App.css washes EVERY hovered button with `--divider` (`button:hover:not(:disabled) { background: var(--divider) }`, line 186), which overrides any button that carries its own ground or selected surface: a resting pointer erased the selected shift on the review surface's changed-file rows until `.review-file` and the pressed scope toggle re-asserted it. Any other selected-state button (and any "drawn" action that should stay transparent under hover) has the same exposure.
  status: open
  **Found during:** 08.1-16
  **Not fixed here, deliberately:** it is a global rule in a file this plan does not own; the hover wash on a drawn action is the product's existing convention, and the three affected controls in the review group are handled locally.
  **To fix:** scope the global rule to buttons without a `.control-edge` or a selected state (or move to the inset-wash pattern the board rows use), in the pass that owns `App.css`.

- A changed-file row in the review surface's 30 percent file list wraps a long path mid-extension (`CriteriaRail` / `.tsx`). The row prints the full path with `overflow-wrap: anywhere`; a filename-first row with the directory muted would read better, but that is a change to what the row prints and its tests find rows by full path.
  status: open
  **Found during:** 08.1-16 (capture review)
  **To fix:** print basename in the primary role and the directory in the muted role, keeping the full path as the accessible name.
