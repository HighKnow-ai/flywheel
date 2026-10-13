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
  status: resolved (08.1-18: every one of the six, and every sibling found, is redrawn; see the PROGRESS lines)
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
  **PROGRESS 2026-10-08 (08.1-17):** `launch-sheet/LaunchSheet.tsx` (Start Work) is redrawn (a 2px ink lead edge, transparent ground), and so are the five sibling brand fills in group four that the register did not list: `session/SessionSurface.tsx` (Discard, Review changes, Advance, Send) and `session/PermissionRequestCard.tsx` (Allow); plus the launch sheet's CHOSEN permission-mode segment, which painted ink on `--accent-nontext` (the same defect). Pinned by `session/__tests__/finish.test.tsx` and measured in WebKit by `session-group.browser.test.tsx`. Still open: `ProposalRow` and `ProposalAmendEditor` (18). **Also for plan 18:** `settings/SettingsSurface.tsx:177` has the same shape (the chosen segment is ink on `--accent-nontext`); `.launch-mode[aria-checked="true"]` in `session/session.css` is the device (an ink edge, a 2px foot rule, weight 600; no fill, and no surface shift, which is invisible on a sheet's own surface).
  **PROGRESS 2026-10-08 (08.1-18):** the last two are redrawn: `authoring/ProposalRow.tsx` (Accept, now a control edge on the row surface like `board/ChallengeRow.tsx`'s) and `authoring/ProposalAmendEditor.tsx` (Save, the one 2px ink lead in the editor), and so is `settings/SettingsSurface.tsx`'s chosen segment (an ink edge and a 2px foot rule, the `.launch-mode` device turned to suit a value; no weight change, so a chosen segment does not push its neighbour). The triage surface's Pending/Deferred toggle, which painted `--surface-secondary` on the pressed one (invisible on the page ground), takes the same device. **Nothing under `src/` consumes `--text-on-accent` or `--destructive-strip` any more** (grepped, non-test, non-token), so plan 20 can retire `--text-on-accent` as 08.1-14 said it would.

- Destructive confirmation buttons paint `--text-primary-rack` on a `--destructive-strip` FILL: 2.95:1 in light (`#1f2328` on `#cf222e`) and 2.86:1 in dark (`#ededed` on `#f85149`), both under the 4.5 text floor. Found finishing `WorktreeRemovalDialog`'s Remove (08.1-15), which now draws it as the destructive text role on its own surface, a `--destructive-text-rack` edge, no fill (that pair is 5.03 / 5.72 on `--surface-secondary`, asserted in `contrast.test.ts`). Four siblings still carry the fill, each with a stale comment claiming "6.3:1" (the retired palette's figure): `board/DeleteConfirm.tsx:111` (19), `recovery/OrphanRecoveryModal.tsx:82` (19), `session/PermissionRequestCard.tsx:337` (17, the Deny button). The destructive fill was not named in the owner's primary-button decision (that decision is about the BRAND fill), so this is a separate AA defect with the same shape.
  status: resolved (08.1-17: `session/PermissionRequestCard.tsx`'s Deny; 08.1-19: `board/DeleteConfirm.tsx`'s Delete and `recovery/OrphanRecoveryModal.tsx`'s Kill All, both now the destructive text role on a 2px edge with an icon, no fill, measured in WebKit)
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

- The running-session pulse had been deleted. Plan 08.1-13, rewriting the displacement utility, removed `@keyframes agent-pulse` and `.agent-pulse` from `styles/motion.css`, so `SessionSurface`, `RunsSection` and `OrphanRecoveryModal` applied a class that animated nothing. The jsdom suite could not see it: vitest stubs stylesheets, and the component tests assert only the class name.
  status: resolved (08.1-17, commit 531a3ab)
  **Found during:** 08.1-17 (the binding note said the pulse must stay scoped; the CSS was not there to scope)
  **Resolution:** restored as it was (opacity 1 to 0.45, 1.6s, the single easing curve, infinite), still the one scoped fade. `theme/__tests__/motion.test.ts` now reads the real file and asserts the keyframes exist, touch opacity only, and that no other keyframes block does. `session-group.browser.test.tsx` asserts in WebKit that the glyph's computed animation is `agent-pulse`, infinite, with a live animation on the engine, and that under the reduced-motion arm the class is absent and the glyph sits at opacity 1.

- Brand text on a data channel that the brand rule does not list. `--accent-text-rack` colours the running status (`RUN_STATUS_COLOR.running`), the current authoring stage (`AuthoringStageIndicator`) and the developer's own words in the feed (`developer_turn`). 08.1-UI-SPEC.md § The brand rule lists exactly four places the brand may appear and none is a run status, a stage or a speaker class; the first two come from `02-UI-SPEC.md`'s Run Status table, which the UI-SPEC says is authoritative and unamended.
  status: needs-owner-decision
  **Found during:** 08.1-17
  **Not fixed here, deliberately:** the three are published roles with tests behind them (the legend marks, `feed-row.test.tsx`), and recolouring a status is a contract change, not a finish edit. The running glyph also carries its own word and the pulse, so meaning does not rest on hue.
  **To fix:** an amendment either adding "run status and the live stage" and "the developer's own turn" to the brand list, or moving them to ink with weight. Cheap once decided.

- `type-micro` (10px) is still the role of a system notice in the feed (`FeedRow`, the "retrying request" line), and the detector reports `tiny-text` on every capture that carries one. `02-UI-SPEC.md` § Typography Additions names the role, it is unamended, and `session-surface.test.tsx` pins the class. The locked 08.1 scale is 11/12/13/14/15/20.
  status: open
  **PROGRESS 2026-10-08 (08.1-19):** `OrphanRecoveryModal`'s footnote ("Every process above is spending tokens right now...") was the one `type-micro` in group six and is `type-label` (11px, on the locked scale) now: a warning about spend should not be the smallest text in a blocking dialog. That is one usage moved onto the scale, not a ruling on the role; the open owner call and `AssigneePicker` are unchanged.
  **Found during:** 08.1-17 (rendered-HTML detector run)
  **To fix:** an owner call whether the 10px micro role survives; if not, `type-micro` becomes `type-label` here and in `AssigneePicker` and `OrphanRecoveryModal`, and the one test line changes.


- The legend's `meaning` strings are in a developer's voice. A published legend that the product treats as the contract for every mark still prints decision ids ("D-13", "D-46", "D-124"), and `recovery-needed` says it is "not a copy-paste slip, mirroring run-blocked/blocked-indicator's own shared-glyph precedent". 08.1-18 made the legend true (stale tints, the Dot clash, the accent claim, the selection rule, two missing roster marks) and swapped the em dashes the detector flagged for colons, but did not rewrite copy for a reader who has never seen the decision log: that is a copywriting pass, and the Copywriting Contract is authoritative.
  status: resolved (08.1 finish-review closure, group five). Thirteen `meaning` strings were rewritten and `legend.test.tsx` now fails on any decision id, spec path, "precedent" or "copy-paste" in a mark's label or meaning.
  **Found during:** 08.1-18 (reading every `meaning` against what the product draws)
  **To fix:** one pass over `legend/marks.ts` that removes decision ids and design-history commentary from `meaning`, keeping what the mark MEANS to someone using the product. `legend.test.tsx` pins ids, glyphs and labels, not the prose, except `run-interrupted` ("normal", "stopped"), `proposal-pending`, `project-current`, `focus-ring` and the status meanings.

- The global `input:focus-visible` ring is still the brand (`--focus-ring`) for ordinary inputs outside the groups finished so far: `QuickAdd`, `FilterBar`, the criteria composer in `item-detail/AcceptanceCriteriaList.tsx`, the title field. 08.1-18 closed it for its own group (`.admin-field` takes the ink rule: settings, the reject-reason field and the amend editor, whose first field is focused the moment it opens) and for the palette, the session fields and the launch sheet before it. Keyboard focus on a button stays the brand ring (the brand rule's use 3), so this is only about inputs that hold focus for a long time or take it on open.
  status: open
  **Found during:** 08.1-15, still open after 08.1-18
  **PROGRESS 2026-10-08 (08.1-19):** closed for group six too: `FirstRun`'s confirm-the-key field is `control-edge state-field` with a 2px ink `:focus-visible` ring (`styles/states-and-confirms.css`), asserted in `board/__tests__/states-finish.test.tsx` and measured in WebKit. Still open, unchanged: `QuickAdd`, `FilterBar`, the criteria composer and the title field, and the global rule in `App.css` (plan 20 or the owner).
  **Not fixed here, deliberately:** `App.css` is group one's file and plan 20 owns it. **To fix:** either `input:focus-visible { outline-color: var(--selection-rule) }` globally and delete the three local overrides, or leave it as a documented split (brand for transient focus, ink for standing focus). Needs the owner's preference.

- `board/DoneWarning.tsx` was finished by 08.1-18 (the orchestrator named it in this group's overlay components) although `08.1-19-PLAN.md` lists it. Its shadow was a literal `0 8px 24px rgba(0,0,0,0.35)` and its edge the divider; it now draws `--shadow-popover` and `--border-popover`, asserted in `settings/__tests__/finish.test.tsx` and measured in WebKit by `admin-group.browser.test.tsx`. Plan 19 should treat it as already on its tier and finish only what is left (spacing, type).
  status: resolved (08.1-18, and confirmed unchanged by 08.1-19: it stays inline on the popover tier)
  **Found during:** 08.1-18

- `--destructive-strip` is still consumed as a TEXT or EDGE colour in four places, so plan 20 must not delete the alias on the strength of 08.1-18's "nothing consumes it" (that was true of FILLS only): `App.tsx:172` (the registration-error notice), `board/CommandPalette.tsx:626`, and `board/BoardRow.tsx:387,388,415,416` (a colour and a 1px edge). It is `var(--destructive-text-rack)`, so every use is AA; this is naming debt, not a defect. 08.1-19 moved `FirstRun`, `ProjectUnreachable` and `RegisterProjectFlow`'s comment off it.
  status: open
  **Found during:** 08.1-19
  **To fix:** in plan 20 (or later), point those four files at `--destructive-text-rack` and then delete the alias, in one commit with its tokens test. `--text-on-accent` has no consumer and can be retired as planned.

- The real board's second project is `unreachable` and is a DUPLICATE registration: read off a copy of the fleet database, it has the same name (`threadfin`), the same key prefix (`THRE`) and the very same `repo_path` as the active project. The unreachable state's contract copy says Flywheel "expected threadfin at {path}, but the repository marker there no longer matches", and "Locate Project…" would open a folder picker to be pointed at the folder the active project already owns. The copy is fixed by the Copywriting Contract and a finish pass is not licence to rewrite it, so it is unchanged; it is accurate about what Flywheel found, but it does not help the user see that this entry is a stale twin.
  status: open
  **PROGRESS (08.1 finish-review closure, group six):** the "Unreachable" eyebrow above the heading is deleted, and the real app is now proven (a rendered `App` test) to keep the project rail beside this surface, so the healthy project is one click away. "Remove Project" was DECLINED, not built: there is no removal command in the product (`project_register`, `project_list`, `project_reconcile`, `project_relocate` only), so a button would be a stub. It is a decision, below.
  **To fix:** an owner call and a contract change: either a second action or line for "this path already belongs to another project" (and, ideally, a way to remove the stale entry, which no surface offers today), or leave it. Also worth a board issue: how a second registration of the same path was ever accepted.

- `FirstRun`'s confirm-the-key step does not focus its field when the folder picker returns, so the user must click into it or tab to the button. The field is the step's only input. It is a behaviour change, not a finish edit, and WebKit does not Tab to buttons by default (see `review/__tests__/browser/keyboard.browser.test.tsx`), so the first thing the user does after picking a folder is reach for the mouse.
  status: open
  **Found during:** 08.1-19
  **To fix:** `autoFocus` (or a ref and effect) on the prefix input when `pending` first becomes non-null, with a `FirstRun` test that the field holds focus; the ink ring is already in place for exactly that case.

- **DECISION NEEDED: removing a project.** The unreachable surface offers only "Locate Project…", which has no answer for a repository deleted for good, and the stale twin above has no way out at all. The group-six finish reviewer asked for a secondary "Remove Project". It was not built because it is not a finish edit: it needs a core domain function, a Tauri command, an adapter wrapper, a confirmation, an event kind and a rail change, and first a choice. Option A, soft-hide: a `removed` status (`list_projects` filters it), nothing deleted, the marker file stays in the repository so re-registering the same folder re-adopts the project (D-15); cheap and reversible, but the project's epics, tasks, events and worktrees stay in the database. Option B, delete: cascade epics, tasks, criteria, events, runs and proposals; irreversible, needs the destructive confirmation the delete dialog models, and must say what happens to worktrees on disk and whether the key prefix is released. Leaning: A, because the event log is append-only by design and the marker makes re-adoption free.
  status: open
  **Found during:** 08.1-19 finish review
  **To fix:** the owner picks A or B; then one plan: migration if any, `project_remove`, adapter, a `Remove Project` button on the plain control edge beside "Locate Project…" (never a second lead), a confirmation that names the project and its path, and a test that the rail drops it and a healthy project becomes current.

- The review diff's tokenizer still runs although its colour is gone. 08.1's group-three closure deleted every `.token.*` rule (change is carried by the row tint and the gutter), so `highlight.ts`, the `refractor` grammars and the "Syntax highlighting skipped" notice now compute spans that nothing styles. It is harmless but it is dead weight: the `ReviewSurface` chunk is 160 kB.
  status: open
  **Found during:** 08.1 finish-review closure, group three
  **To fix:** delete `highlight.ts`, drop the `tokens` prop and `markEdits` from `FileDiff.tsx`, remove the `refractor` dependency and the notice, and retire `highlight.test.ts` and the notice tests in `review-surface.test.tsx`, in one commit. Not done in the closure pass because the finding asked for the colour to go, not the machinery.

- The placeholder role (`--text-placeholder`) reaches only `.session-field` (the composer and the launch sheet's two fields). `App.css` is not a group stylesheet, so the filter bar, quick add, the issues-lane input and the settings fields still show the engine's own placeholder grey (2.3:1 light, about 8.5:1 dark), i.e. the same unowned colour the finding was about.
  status: open
  **Found during:** 08.1 finish-review closure, group four
  **To fix:** one `input::placeholder, textarea::placeholder { color: var(--text-placeholder) }` in `App.css` (plan 20 or the owner), and delete the group-scoped copy.

- The feed's developer's-turn row is `--accent-text-rack` (brand), another instance of the open "brand text on run status, stage and speaker" call. The new developer's-turn capture shows it beside the agent's ink text.
  status: open (folds into the existing owner question)
  **Found during:** 08.1 finish-review closure, group four

- `01-UI-SPEC.md`'s Copywriting Contract still gives the Done warning as "{checked}/{total} criteria unchecked. Mark Done anyway?". The product now prints "{key} · {n} of {total} criteria unchecked. Mark Done anyway?" at the group-six reviewer's instruction (the old line printed the checked count before the word "unchecked"). That document is deliberately unamended.
  status: open
  **Found during:** 08.1 finish-review closure, group six
  **To fix:** an amendment line in `08.1-AMENDMENTS.md` (the finish reviewer proposed it, not the owner), or leave the contract text as history.

- **The open findings of `08.1-REVIEW.md`, registered here because the review file alone is not a
  tracker.** The phase's code review ran at standard depth over 87 changed source files and returned
  0 critical, 6 warnings, 2 info. It confirmed sound the four things most able to hide a real defect:
  the lock-safe split in `change_flags` (db work under the mutex, explicit drop, git in
  `spawn_blocking`), all six `:has_worktree` bind sites bound, the `epic_progress` aggregate's bound
  real, and the decline path re-deriving its state inside its own transaction from a task id alone.
  Two findings were fixed during the close — WR-01 (commit `e6ef598`) and IN-02's keyboard half
  (A-09, commit `a739945`). These remain open:
  - **WR-02** — `useChangeFlags` is mounted by both `BoardView` and `ProjectRail` and coalesces per
    instance, so a burst invalidates twice; the second cancels the in-flight JS fetch while the Rust
    sweep keeps running. The rail's "Worktrees" count is also just that list's length.
  - **WR-03** — `GroupItems.truncated` is computed and nothing reads it. A group over 500 rows would
    show 500 under a header carrying the full count: the silent short list this phase was opened to
    remove, reintroduced one layer up. Highest-value of the five.
  - **WR-04** — `rosterEpicItem` drops the criteria counts, so an epic moved to Done from the detail
    panel never raises `DoneWarning`.
  - **WR-05** — the selection-follows effect and the whole command palette read the unfiltered
    200-row window while the rack renders group-fetched rows. Selection can jump off a visible row,
    and palette commands for a group-only task look enabled and silently do nothing.
  - **WR-06** — the epic "agents running" count inner-joins `tasks`, so epic shaping runs (null
    `task_id`, non-null `epic_id`) are never counted.
  - **IN-01** — `seed_criteria` is a `[[bin]]` compiled into the product crate that mutates the real
    database, hard-codes `THRE-xx` keys, and whose `delete_probes` runs across all projects. It
    belongs outside the shipping crate.
  - **IN-02 (remainder)** — `aria-selected` on `role="listitem"` is not valid ARIA. A-09 closed the
    keyboard half; this half is untouched.
  status: open
  **Found during:** 08.1 code-review gate (advisory, non-blocking by contract)
  **Not fixed here, deliberately:** the owner's standing preference is to ship and drain bugs with
  Flywheel itself rather than widen a closing phase. Each is a real defect with a named cause and
  file, which is what makes it drainable.

- `gsd_run query phase.complete 08.1` and `query verification.status` both refuse a phase whose
  number contains a dot. `08.1-VERIFICATION.md` exists with `status: passed` and the same frontmatter
  keys as `08-VERIFICATION.md`, which the same verb detects (it returns `stale` for phase 08, i.e. it
  found and read it). For 08.1 the verb returns `missing`. Probed: renaming the file to
  `8.1-VERIFICATION.md` or `08-VERIFICATION.md` does not help, and neither does an absolute path or
  the dotted `verification.status` form — so it is not the filename or the argument shape, it is the
  dotted phase number.
  status: open
  **Found during:** the 08.1 phase close
  **Impact:** bookkeeping only. No product behaviour and no gate depends on it. The ROADMAP checkbox
  and progress row were set by hand instead, and STATE updated directly.
  **Not fixed here, deliberately:** the defect is in the shared global tool at
  `~/.claude/gsd-core/bin/gsd-tools.cjs` (@opengsd/gsd-core 1.13.0), not this repository. Patching a
  shared binary would change behaviour for every project on this machine.
  **Related:** the same family as the `state.update-progress` miscalculation recorded above. This
  project is likely the first to use an inserted dotted phase number, so both are probably unexercised
  paths rather than regressions.
  **To fix:** report upstream to @opengsd/gsd-core, or pin a corrected local copy.
