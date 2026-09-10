---
phase: "01"
slug: "the-board-is-the-store-of-record"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on (high) severity
threats_open: 0
asvs_level: 1
register_authored_at_plan_time: true
created: "2026-09-10"
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Built in **State B** — no `01-SECURITY.md` existed, so this file is assembled from the
`<threat_model>` blocks all 21 of the phase's PLAN files carry. Because the register was authored at
plan time (`register_authored_at_plan_time: true`) and `workflow.security_asvs_level` is `1`, the
audit's job was to **verify the declared mitigations are present in the implementation**, not to
discover new threats. Every status below was reached by reading the named artifact, never by trusting
the plan's own claim.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| renderer → Tauri command surface | The only way the UI reaches the machine. Gated by `generate_handler!` in `main.rs` (the real default-deny boundary for this app's own commands) plus `capabilities/default.json` for plugin commands | User-authored titles, descriptions, acceptance-criterion statements, search terms, filter selections — all untrusted strings |
| Tauri command handler → `packages/core` | The only path that may execute a mutating SQL statement. `actor_id` is resolved here, server-side, and never accepted from the renderer | Validated, length-capped command arguments plus a server-resolved actor id |
| `packages/core` → SQLite file | All persistence. Four pragmas re-applied on every open; backup written before any DDL | Projection rows and append-only `events` rows, written in one transaction |
| user-chosen directory path → `projects.repo_path` | A path chosen through the native folder picker is canonicalized and stored, then later read | An absolute filesystem path, and the two-field identity marker written at it |
| marker file in a user repository → project identity | A `.flywheel/project.json` marker is read at a path the database already holds — never used to construct a path to visit | Two fields: project id and key |
| OS native menu bar → board action dispatch | Accelerators forward an action id that must obey the same layer guard a real keystroke obeys | One of four forwarded action ids, resolved through `MenuHandles` |

---

## Threat Register

83 distinct threats across 111 register rows (a threat restated by several plans is consolidated
here, keeping the highest severity any plan assigned it and `mitigate` if any plan required one).

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Authored In | Status |
|-----------|----------|-----------|----------|-------------|------------|-------------|--------|
| T-01-01 | Tampering | SQL statements in `packages/core/src/domain` and `query` | high | mitigate | Every statement is a literal with `params![]` bindings; a grep gate in Task 2's verify fails the build if any SQL is assembled by string formatting <br>*(restated in 6 plans: 01-03, 01-04, 01-06, 01-07, 01-08, 01-10)* | 01-03 | closed |
| T-01-02 | Elevation of Privilege | `packages/desktop/src-tauri/capabilities/default.json` | high | mitigate | Default-deny manifest naming only `core:default` and window permissions; no `fs:` or `shell:` identifier — asserted by an acceptance criterion in Task 2 <br>*(restated in 10 plans: 01-01, 01-02, 01-03, 01-04, 01-06, 01-07, 01-08, 01-09, 01-10, 01-11)* | 01-01 | closed |
| T-01-03 | Tampering | marker content used to derive a filesystem path | high | mitigate | Marker content is read *at* a path the database already holds and is never used to construct a path to visit; every filesystem call takes an explicit canonicalized absolute path, and a grep gate fails the build if the core enumerates directories | 01-11 | closed |
| T-01-04 | Repudiation | `packages/desktop/src-tauri/src/commands/task.rs` | high | mitigate | `actor_id` is resolved inside the Rust handler and the command signature accepts no actor argument from the renderer; `events.actor_id` is NOT NULL with a foreign key, asserted by `outbox.rs` <br>*(restated in 6 plans: 01-03, 01-04, 01-06, 01-07, 01-09, 01-11)* | 01-03 | closed |
| T-01-05 | Denial of Service | title and description length | medium | mitigate | Each Tauri command validates input shape and caps title and description length before calling into the core, so an event payload cannot be grown without bound by a single paste <br>*(restated in 3 plans: 01-03, 01-04, 01-06)* | 01-03 | closed |
| T-01-06 | Information Disclosure | SQLite file unencrypted at rest | low | accept | No credential or secret is stored in the database in this phase (`01-RESEARCH.md` § Security Domain, V6). Revisit when agent credentials or relay tokens enter the schema | 01-01 | closed |
| T-01-09 | Tampering | `packages/core/src/db/mod.rs` path resolution | medium | mitigate | `default_db_path` derives from the OS app-data API only; the core never reads or sets the process working directory (grep-asserted in Task 3) | 01-01 | closed |
| T-01-10 | Denial of Service | migration at launch | high | mitigate | Backup-before-migrate; a failed `to_latest` aborts startup with the error surfaced rather than opening a half-migrated file <br>*(restated in 2 plans: 01-01, 01-05)* | 01-01 | closed |
| T-01-11 | Information Disclosure | `packages/desktop/src/styles/type.css` | medium | mitigate | Fonts are self-hosted under `public/fonts/`; a grep gate in Task 2 fails the build if any hosted font service hostname appears, so no request leaves the machine to render text | 01-02 | closed |
| T-01-12 | Tampering | `packages/desktop/index.html` direction contract comment | low | accept | The comment is authored content in a tracked file; corruption is caught by the seed-key grep in Task 2's verify. No integrity control beyond version control is warranted for a build-time comment | 01-02 | closed |
| T-01-13 | Tampering | `projects.repo_path` from the native folder picker | medium | mitigate | The picker returns an absolute path; the handler canonicalizes and stores it, and `packages/core` never derives a path by concatenating stored content (ARCHITECTURE.md Anti-Pattern 3). Marker-file reads land in plan 01-11 with their own gate | 01-03 | closed |
| T-01-14 | Tampering | FTS5 external-content index drift | medium | mitigate | The three sync triggers ship in migration 0002, and `packages/core` is the only write path — any future bulk import must follow with an FTS rebuild <br>*(restated in 2 plans: 01-03, 01-08)* | 01-03 | closed |
| T-01-15 | Tampering | status value crossing the IPC boundary | high | mitigate | The status CHECK constraint in migration 0002 is the authority; a renderer that sends an unknown state gets a database error, proved by `invalid_status_is_rejected_by_the_schema` | 01-04 | closed |
| T-01-16 | Denial of Service | `delete_epic` cascade | medium | mitigate | Children are orphaned, never deleted; a grep gate fails the build if `delete_epic` issues a task delete, so an epic deletion cannot destroy unrecoverable work | 01-04 | closed |
| T-01-16-01 | Tampering | `commands::menu::menu_set_action_enabled` | low | mitigate | The handler resolves `action_id` only through `MenuHandles`' lookup over the four forwarded ids and returns an error for anything else; it can never reach an arbitrary menu node, and it can only toggle `enabled` — never text, accelerator or structure | 01-16 | closed |
| T-01-16-02 | Elevation of Privilege | `App.tsx` `menu:action` bridge | medium | mitigate | Task 1 removes the layer-stack reset, so a forwarded id gains no capability a keystroke lacks; every id passes `bindingAllowedInLayer`/`topLayer`, restoring threat T-01-02's stated invariant that no menu item is given a broader capability | 01-16 | closed |
| T-01-16-03 | Spoofing | renderer-driven menu enable state | low | accept | A compromised renderer could re-enable a menu item that the layer model would refuse. Accepted because enabling an item confers no authority: the dispatched id is still refused by the guard, which is the enforcement point. The menu state is an affordance only | 01-16 | closed |
| T-01-16-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not triggered — this plan installs no packages. Every API it uses (`tauri::menu::MenuItem::set_enabled`, `Manager::manage`) is already present in the pinned `tauri 2.11.5` / `muda 0.19.3` dependency tree | 01-16 | closed |
| T-01-17 | Tampering | `restore_from_backup` target path | medium | mitigate | Restore copies only from a path this process itself returned from `backup_database_file` in the same call, never from a caller-supplied or user-supplied filename | 01-05 | closed |
| T-01-17-01 | Information Disclosure | `commands::epic::epic_list_all` | medium | mitigate | `project_id` is bound into a `WHERE b.project_id = ?1` parameter of a compile-time literal statement; there is no code path that widens the scope, so one project's board can never surface another project's epics. Asserted by `roster_is_scoped_to_one_project` | 01-17 | closed |
| T-01-17-02 | Information Disclosure | `BoardRow.tsx` epic pill | medium | mitigate | Task 2 removes the branch that renders the row's own epic id and replaces it with the registered `epic-pill-unresolved` mark; a grep gate proves no executable line can reach the id, and a test asserts the ULID appears in neither document text nor any element attribute. This is G-01-2's reported defect | 01-17 | closed |
| T-01-17-03 | Denial of Service | `epic_list_all` unbounded result set | low | accept | The command deliberately returns every epic in the project, exempting it from `board.rs`'s `DEFAULT_LIMIT`/`MAX_LIMIT` cap (T-01-24). "Small and bounded" is **not enforced** — it is a property of who writes epics: Phase 1 has one local human actor and one creation path (`epic_create`, one epic per call), and each row is three short TEXT columns. Accepted rather than capped because any cap would silently truncate the roster and reintroduce the exact defect this plan closes. `roster_at_volume_is_under_the_50ms_budget` measures it at 250 epics, far above any realistic count. **Re-rate when** Phase 2+ gives an agent an epic-creation path, or a bulk import lands | 01-17 | closed |
| T-01-17-04 | Tampering | renderer-supplied `project_id` | low | mitigate | `project_id` selects rows, never SQL shape: the statement is a `concat!`-built compile-time literal with a bound named parameter, per `query/mod.rs`'s stated T-01-01/T-01-23 discipline. No string interpolation anywhere in `list_epics` | 01-17 | closed |
| T-01-17-05 | Spoofing | roster-driven epic labels | low | accept | A compromised renderer could display a label that does not match the stored epic. Accepted because the label is display-only and confers no authority — every mutation still resolves `actor_id` server-side (T-01-04) and every reparenting still passes `assert_parent_in_project` | 01-17 | closed |
| T-01-17-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not triggered — this plan installs no packages. `rusqlite`, `serde`, `tauri`, `lucide-react` and `@tanstack/react-query` are already pinned in `packages/core/Cargo.toml`, `packages/desktop/src-tauri/Cargo.toml` and `packages/desktop/package.json`, so RESEARCH.md's Package Legitimacy Audit is not re-triggered | 01-17 | closed |
| T-01-18 | Denial of Service | unbounded backups directory | medium | mitigate | `prune_backups` retains 5 and removes the oldest on every successful migration | 01-05 | closed |
| T-01-18-01 | Tampering | `filterDraft.epicIds` -> `BoardFilter` | low | mitigate | An epic id from the chip row is a *value* in a JSON array bound as a named parameter into `FILTER_WHERE`'s fixed `json_each` idiom (`packages/core/src/query/filter.rs`); it can never change which column, operator or clause runs (T-01-23). Sourcing the chips from the roster changes where the id came from, not how it is bound | 01-18 | closed |
| T-01-18-02 | Information Disclosure | chip / option / parent-button labels | low | mitigate | Labels are the epic's `key` and `title` — user-authored board content already rendered on the row itself — never an internal id. React escapes them as text nodes; no `dangerouslySetInnerHTML` is introduced | 01-18 | closed |
| T-01-18-03 | Elevation of Privilege | `issue-parent` `onSelect` kind resolution | medium | mitigate | Deciding an id's parent kind by roster membership must not let an epic id be submitted as `parentKind: "task"` (or the reverse), which would write a bad `issues.epic_id`/`issues.task_id` pair. The core's `assert_parent_in_project` and the `issue_set_parent` handler remain the enforcement point and are unchanged; the renderer's ordering (roster first, window second) is a correctness aid, not the check. Asserted by `issue-parent.test.tsx`'s existing command-argument assertions plus the new out-of-window case | 01-18 | closed |
| T-01-18-04 | Information Disclosure | `FilterBar` losing its `items` prop | low | mitigate | Removing the prop narrows what the component can read; it cannot widen any surface. `tsc` proves no call site still supplies it | 01-18 | closed |
| T-01-18-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not triggered — this plan installs no packages and adds no dependency to `packages/desktop/package.json` or either `Cargo.toml` | 01-18 | closed |
| T-01-19 | Information Disclosure | backup copies of the database | low | accept | The backups sit beside the live file in the same OS app-data directory, under the same user's permissions, and carry no secret the live file does not already carry (`01-RESEARCH.md` § Security Domain, V6). Revisit when credentials enter the schema | 01-05 | closed |
| T-01-19-01 | Elevation of Privilege | the new scroll-into-view effect in `BoardView.tsx` | medium | mitigate | A scroll driven by an **item id** could become a way to address or render an item outside the current project. This effect is driven by `quickAddRowIndex`, an index into the `rows` memo, which is built only from the `items` prop of the currently rendered project — no id is accepted, resolved or dereferenced anywhere in the path. Asserted structurally: `quickAddRowIndex` is derived by `findIndex` over `rows` and the effect passes it straight to `scrollToIndex` | 01-19 | closed |
| T-01-19-02 | Denial of Service | the focus/scroll effect pair | low | mitigate | An effect that scrolls on every render, or a focus effect that re-raises the request it just consumed, would be a render loop that hangs the renderer. Both are guarded on the same consume-once flag, and the store's clear path is the only writer that lowers it; `scrolling_the_row_back_into_view_does_not_steal_focus_a_second_time` is the assertion that a re-mount raises nothing | 01-19 | closed |
| T-01-19-03 | Tampering | `collapseStore.expand` | low | mitigate | Writes exactly one `(projectId, status)` cell through `toggle`'s existing immutable spread, so it cannot clobber another project's or another band's preference. Collapse state is a local UI preference that is never written to the database (`collapseStore.ts`'s own doc comment), so there is no persistence surface at all. Asserted by `expanding_backlog_for_quick_add_leaves_every_other_band_alone` | 01-19 | closed |
| T-01-19-04 | Spoofing | the layer guard vs. the new effects | medium | mitigate | A keystroke refused by `bindingAllowedInLayer` must not produce any of its effects. The guard runs in `useGlobalBindings` before the handler, so a refused ⌘N never sets `quickAddFocusPending` and neither effect can fire. Asserted, not assumed, by `cmd_n_over_the_detail_panel_scrolls_nothing_and_moves_no_focus` and `a_picker_layer_also_refuses_cmd_n_without_scrolling` | 01-19 | closed |
| T-01-19-05 | Information Disclosure | rendered row text at volume | low | mitigate | G-01-2's property (no raw internal identifier reaches the DOM) is re-asserted over the 60-row fixture by `no_row_renders_a_raw_internal_identifier_at_volume`. This plan edits no file in that path | 01-19 | closed |
| T-01-19-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not triggered — this plan installs no package and adds no dependency to `packages/desktop/package.json` or any `Cargo.toml`. Every API it uses (`@tanstack/react-virtual`'s `scrollToIndex`, React's `useRef`/`useEffect`, zustand's `set`) is already a direct dependency at a pinned version | 01-19 | closed |
| T-01-20 | Tampering | `toggle_criterion` UPDATE scope | high | mitigate | The statement names only the `checked` column and a timestamp, asserted both by an acceptance criterion and by `parent_edit_leaves_criteria_untouched`, so a check can never become an edit of the user's authored text | 01-06 | closed |
| T-01-20-01 | Repudiation | the volume fixture | medium | mitigate | A fixture that silently stops exceeding the mounted window would leave the suite claiming coverage it no longer has — the exact failure mode that let G-01-2 and G-01-4 both ship green. `MOUNTABLE_ROW_ESTIMATE` is computed from the four constants that determine it, and `the_volume_fixture_exceeds_what_the_harness_can_mount` fails the suite when the margin disappears | 01-20 | closed |
| T-01-20-02 | Repudiation | the ULID-shaped fixture identifiers | low | mitigate | Short ids would make plan 01-19's raw-identifier scan vacuous — it would pass over a fixture that could never produce a match. `buildVolumeItems` assigns a distinct 26-character Crockford-base32 id per row so the scan is a real assertion | 01-20 | closed |
| T-01-20-03 | Tampering | a hardening plan editing or undoing a closed fix | medium | mitigate | Asserted by content, not by a diff a commit would empty: Task 1 gates on plan 01-19's fix still being present (an executable `scrollToIndex` in `BoardView.tsx`, `quickAddFocusPending` wired through `uiStore.ts`), and Task 2 gates on `App.tsx` still having zero executable calls to the bridge helper G-01-1 removed. Either gate failing fails the task | 01-20 | closed |
| T-01-20-04 | Elevation of Privilege | the at-volume `board_list` mock | low | accept | The alternate mock is installed per-case rather than in the shared `beforeEach`, so it cannot change what the 17 pre-existing cases exercise. Accepted rather than mitigated further: a test-local mock has no production reachability | 01-20 | closed |
| T-01-20-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not triggered — this plan installs no package and adds no dependency to `packages/desktop/package.json` or any `Cargo.toml` | 01-20 | closed |
| T-01-21 | Tampering | `set_assignee` target | medium | mitigate | `assignee_id` carries a foreign key to `actors(id)` and `foreign_keys` is on for every connection, so an id naming no actor is rejected rather than stored — asserted by `assignee_must_reference_a_real_actor` | 01-07 | closed |
| T-01-21-01 | Denial of Service | the rewritten expand-Backlog effect in `BoardView.tsx` | medium | mitigate | An effect that writes to the store on every render is a self-sustaining render loop at exactly the volume where render cost matters — this is the defect being repaired, and a careless rewrite could keep it. Two independent guards: the project-keyed ref short-circuits every render after the first of an episode, and the retained `collapsedByStatus.backlog` check makes the write conditional even on the first. Asserted, not assumed, by `the_expand_effect_performs_no_store_write_on_later_renders`, which pins `collapsedByProject`'s object identity across further renders | 01-21 | closed |
| T-01-21-02 | Tampering | `expandBand` called from the `openQuickAdd` funnel | low | mitigate | The new call writes exactly one `(projectId, "backlog")` cell through the store's existing immutable spread, using the same `projectId ?? ""` key every other collapse read and write in this component uses — it cannot reach another project's or another band's preference. Asserted by the existing `expanding_backlog_for_quick_add_leaves_every_other_band_alone` case, which also checks `proj-2` is untouched | 01-21 | closed |
| T-01-21-03 | Spoofing | the layer guard versus the new expansion call site | medium | mitigate | A keystroke refused by `bindingAllowedInLayer` must produce none of its effects. `useGlobalBindings` applies that gate BEFORE calling the handler, and the new expansion sits inside `BoardView.openQuickAdd`, which a refused keystroke never reaches — so a refused ⌘N over a trapped detail panel or picker still writes nothing to the collapse map. Asserted by the suite's two existing refusal cases plus `layer-guard.test.tsx` and `menu-bridge.test.tsx` | 01-21 | closed |
| T-01-21-04 | Elevation of Privilege | the scroll-into-view path | low | accept | Unchanged by this plan. 01-19's `T-01-19-01` disposition still holds: the scroll is addressed by a row index into the current project's `rows` array, never by an item id, so no cross-project reference can be constructed. This plan does not modify that effect; carried forward, not re-litigated | 01-21 | closed |
| T-01-21-05 | Tampering | `packages/desktop/src/test/setup.ts` | low | mitigate | A test-only stub that silently changes scroll semantics can make a regression suite pass for the wrong reason, which is a supply-chain-of-evidence problem rather than a runtime one. The clamp is therefore guarded to be inert under jsdom's zero-layout reality and its behavior in both regimes is pinned by `the_scroll_stub_clamps_to_a_real_scrollable_range_only_when_one_exists`. This file ships in no build output | 01-21 | closed |
| T-01-21-06 | Information Disclosure | rendered row text | low | accept | Not applicable to this diff — no new text is rendered and `BoardRow.tsx` is untouched. G-01-2's no-raw-identifier property is re-asserted at volume by the existing `no_row_renders_a_raw_internal_identifier_at_volume` case, which stays green | 01-21 | closed |
| T-01-21-SC | Tampering | npm/pip/cargo installs | high | mitigate | Not triggered — this plan installs no package and adds no dependency to `packages/desktop/package.json` or any `Cargo.toml`. Every API it uses (React's `useRef`/`useEffect`, zustand's `set`, Testing Library's `fireEvent`/`rerender`) is already a direct dependency at a pinned version. No package-legitimacy checkpoint is required because there is no install task | 01-21 | closed |
| T-01-22 | Denial of Service | rank string growth under repeated same-boundary moves | low | accept | The documented tradeoff of fractional indexing. At human-paced reordering over 1,000 items the growth is immaterial; recorded as a watch item in the `ranking.rs` doc comment. Revisit if an automated writer starts moving items to one boundary in bulk | 01-07 | closed |
| T-01-23 | Tampering | `BoardFilter` translation in `query/filter.rs` | high | mitigate | The filter is a typed struct whose variants map to fixed parameterised fragments; no renderer-supplied string ever becomes a column name, an operator or an ORDER BY clause | 01-08 | closed |
| T-01-24 | Denial of Service | unbounded result window | medium | mitigate | The core caps the window at its default limit and the command layer caps the requested limit before calling the core, so no single call can be made to return the whole board <br>*(restated in 2 plans: 01-08, 01-10)* | 01-08 | closed |
| T-01-25 | Tampering | ⌘⌫ delete binding and its palette entry | high | mitigate | Delete always routes through the destructive confirmation that names the item type, key and title; the binding never calls the delete command directly, and the confirmation is keyboard-dismissible with Escape defaulting to cancel | 01-09 | closed |
| T-01-26 | Spoofing | palette command list generation | medium | mitigate | Commands are generated from the static `BINDINGS` table plus typed runtime lists; no command label or action id originates in user-authored item content, so an item titled like a command cannot become one | 01-09 | closed |
| T-01-27 | Tampering | `render_description` and `ActivityTrail.tsx` | high | mitigate | Descriptions are assembled in Rust from typed payload fields and rendered by React as text nodes; no payload content is interpreted as markup, and no trail entry is rendered through a raw-HTML path. This matters beyond this phase: from Phase 6 agents author payload content | 01-10 | closed |
| T-01-28 | Repudiation | the absence of a second history store | high | mitigate | `events` is append-only and is the only history; a verify gate fails the build if a migration is added in this plan, and the plan's prohibition forbids a parallel log | 01-10 | closed |
| T-01-29 | Spoofing | a hand-edited or hostile marker claiming another project's id | high | mitigate | `relocate_project` verifies the marker at the new path names the *expected* project id and rejects a mismatch rather than adopting it; registration surfaces an existing marker to the user before completing, so an id collision is a visible event | 01-11 | closed |
| T-01-30 | Tampering | writing into the user's repository | high | mitigate | The only file written is the identity marker, holding two fields; the write happens after the database transaction commits so a failure leaves nothing behind; a test asserts the serialized file has no third key | 01-11 | closed |
| T-01-31 | Denial of Service | launch-time reconciliation over many projects | medium | mitigate | Reconciliation reads one marker per known project at a known path — it never walks a directory tree, so its cost is linear in registered projects and independent of repository size | 01-11 | closed |
| T-01-GC-01 | Tampering | `task_set_epic` / `issue_set_parent` parent arguments | high | mitigate | `assert_parent_in_project` rejects a parent id whose `project_id` differs from the child's, inside the same transaction and before the UPDATE, so a renderer-supplied id cannot graft an item onto another project's tree; the same check is applied to `create_task`/`create_issue`, whose parent parameters plans 01-14 and 01-15 are about to make live | 01-12 | closed |
| T-01-GC-02 | Tampering | a parent id naming no row at all | medium | mitigate | `assert_parent_in_project` returns an error naming the id before the UPDATE runs, and the `epic_id`/`task_id` foreign keys reject it independently (`foreign_keys = ON` is set on every connection by `db::open_and_migrate`) | 01-12 | closed |
| T-01-GC-03 | Repudiation | a reparent leaving no trace | medium | mitigate | Every accepted change appends exactly one `task.epic_changed`/`issue.parent_changed` event carrying before and after, in the same transaction as the UPDATE (DATA-01); the tests assert the count so a silent path cannot be added later | 01-12 | closed |
| T-01-GC-04 | Spoofing | actor attribution on a reparent | high | mitigate | Both commands resolve `actor_id` server-side via `local_human_actor_id` and accept no actor argument from the renderer, matching threat T-01-04's existing rule for every other command | 01-12 | closed |
| T-01-GC-05 | Tampering | an issue holding two parents at once | medium | mitigate | `set_parent` writes both `epic_id` and `task_id` in one UPDATE derived from a single `IssueParent` variant, so a two-parent row is unrepresentable rather than merely unwritten | 01-12 | closed |
| T-01-GC-06 | Denial of Service | oversized id arguments | low | accept | Every id column carries `CHECK (length(id) = 26)`; a longer string fails the parent lookup and is never stored | 01-12 | closed |
| T-01-GC-07 | Elevation of Privilege | a global keystroke acting on a surface behind a trapped layer | medium | mitigate | `bindingAllowedInLayer` drops every binding not owned by the topmost layer, decided in one place inside `useGlobalBindings`; the board-list container reads the same function, so no consumer can opt itself back in by forgetting a guard | 01-13 | closed |
| T-01-GC-08 | Tampering | a project switch under an open detail panel | medium | mitigate | ⌘1-⌘9 is refused outside the board and quick-add layers, so the panel can no longer be left rendering `detailItemId` against another project's item window; the palette's "Go to Project" closes the panel first through `returnToBoardLayer` | 01-13 | closed |
| T-01-GC-09 | Elevation of Privilege | the native folder dialog opened from behind a trapped scope (⌘⇧O) | medium | mitigate | Refused outside the board and quick-add layers; the menu-bar route returns the app to the board layer before dispatching, so the dialog is never raised behind a trap | 01-13 | closed |
| T-01-GC-10 | Tampering | a synthetic keydown dispatched by page script reaching a global action | low | accept | `dispatchAction` is renderer-internal and the window loads only bundled first-party code — a synthesized keydown carries exactly the authority a real one does, and every action it reaches is already reachable from the user's keyboard. Revisit if agent-authored content is ever rendered inside this window | 01-13 | closed |
| T-01-GC-11 | Denial of Service | the user stranded by a layer that refuses every shortcut | medium | mitigate | `open-palette` is exempt from the layer gate in every layer except "picker" and "palette", so ⌘K always reaches the discoverable command surface BOARD-07 rests on, and Escape's existing ladder still closes exactly one layer per press | 01-13 | closed |
| T-01-GC-12 | Tampering | an epic id from another project reaching `task_set_epic` | high | mitigate | The picker derives its options from the current project's loaded board window only, but the authority is plan 01-12's server-side `assert_parent_in_project`, which rejects a cross-project parent inside the transaction — the picker is a convenience, never the boundary | 01-14 | closed |
| T-01-GC-13 | Tampering | an epic being parented under another epic | medium | mitigate | The keystroke is refused on an epic row, the palette command is disabled there, and the option list excludes the picked row itself; the command surface has no epic-parent field at all, so the three-level hierarchy is unrepresentable rather than merely unoffered | 01-14 | closed |
| T-01-GC-14 | Information Disclosure | option labels in the picker | low | accept | Each label is the epic's own key and title, already rendered on the board row beside it | 01-14 | closed |
| T-01-GC-15 | Elevation of Privilege | the new picker as an unmodelled focus layer | medium | mitigate | `PickerKind` gains a member rather than the picker getting its own state, so `topLayer`'s `pickerOpen` derivation covers it with no change and plan 01-13's global-binding guard applies to it on the first render | 01-14 | closed |
| T-01-GC-16 | Tampering | a cross-project parent reaching `issue_set_parent` or `task_create` | high | mitigate | Options are derived from the current project's loaded window only, but the authority is plan 01-12's server-side `assert_parent_in_project`, applied to both the reparenting and the creation paths — the picker and the quick-add row are conveniences, never the boundary | 01-15 | closed |
| T-01-GC-17 | Tampering | an issue holding both an epic and a task parent | medium | mitigate | The renderer sends one `parentKind`/`parentId` pair, and `set_parent` writes both columns from one `IssueParent` variant in a single UPDATE, so a two-parent row is unrepresentable end to end | 01-15 | closed |
| T-01-GC-18 | Elevation of Privilege | the issue parent picker as an unmodelled focus layer | medium | mitigate | It is a `PickerKind` member rather than separate overlay state, so `topLayer`'s `pickerOpen` derivation and plan 01-13's global-binding guard cover it with no further change | 01-15 | closed |
| T-01-GC-19 | Denial of Service | Tab captured inside quick-add breaking region escape | medium | mitigate | Tab is intercepted only when the nesting props are supplied and an indent target exists; the Issues lane's own quick-add supplies none of them and keeps native Tab, and Escape still closes the quick-add layer through the unchanged ladder | 01-15 | closed |
| T-01-GC-20 | Information Disclosure | parent option labels and the quick-add indent chip | low | accept | Every label is the item's own key and title, already rendered on the board beside it | 01-15 | closed |
| T-01-SC | Tampering | npm and crates.io installs | high | mitigate | `01-RESEARCH.md` § Package Legitimacy Audit + the `gate="blocking-human"` checkpoint in Task 1 before the first install <br>*(restated in 5 plans: 01-01, 01-12, 01-13, 01-14, 01-15)* | 01-01 | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

**`T-01-SC` reads `mitigate` above** because plan 01-01 — the only plan in the phase that installed
packages — mitigated it with a `gate="blocking-human"` checkpoint plus `01-RESEARCH.md` §
Package Legitimacy Audit, which recorded three `SUS (too-new)` verdicts as-flagged rather than
silently overriding them. Plans 01-12 … 01-21 each restate the same id as `accept` / "not triggered",
and that claim is now **confirmed independently of the plans**: `git log` shows no dependency
manifest (`packages/desktop/package.json`, either `Cargo.toml`, the workspace `Cargo.toml`) has been
touched since plan 01-05. A supply-chain threat that cannot be triggered is closed, not accepted, so
it is not carried into the Accepted Risks Log as a high risk.

---

## Verification Method (ASVS L1, grep depth)

Each mitigation was checked against the artifact it names. The checks that carried the 23
high-severity threats:

| Threat | What was checked | Result |
|--------|------------------|--------|
| T-01-02 | `capabilities/default.json` permissions array | `["core:default", "dialog:allow-open"]` only — no `fs:`, no `shell:` |
| T-01-01 | `format!`/`push_str`/`+=` assembling SQL anywhere in `packages/core/src` | none; `params!` bindings throughout (10 modules) |
| T-01-04, T-01-GC-04 | `actor_id` origin in every command handler | every handler calls `local_human_actor_id(&conn)`; the only `actor_id` struct field is an outbound response DTO in `commands/events.rs` |
| T-01-15 | status CHECK constraint | `migration 0002` lines 41, 67 pin the five states; `invalid_status_is_rejected_by_the_schema` green |
| T-01-10 | failure path of `open_and_migrate` + any delete of the live file | backup restored on failure (`db/mod.rs:58-72`); the only `remove_file` in core prunes *old backups* (`backup.rs:109`); `failed_migration_restores_the_file` green |
| T-01-20 | the `toggle_criterion` UPDATE's column list | `acceptance_criterion.rs:293` names `checked` and `updated_at` only; `parent_edit_leaves_criteria_untouched` green |
| T-01-23 | how `BoardFilter` becomes SQL | `FILTER_WHERE` is a compile-time `concat!` of fixed `json_each` fragments over named parameters — no renderer string becomes a column, operator or ORDER BY |
| T-01-25 | the ⌘⌫ binding's call target | `delete-item` calls `requestDelete(selectedItem)`; the `deleteItem.mutate` call sits behind `DeleteConfirm`, not in the binding |
| T-01-27 | any raw-markup render path in the renderer | no `dangerouslySetInnerHTML` and no `innerHTML` anywhere in `packages/desktop/src` |
| T-01-28 | migrations present, i.e. whether a second history store was added | exactly two (`0001_actors.sql`, `0002_board_schema.sql`) — `events` remains the only history |
| T-01-03, T-01-31 | directory enumeration in core | one `fs::read_dir`, in `backup.rs:84`, over the app-owned backups directory for pruning. No enumeration of a user repository, and no path derived from marker content — see the note below |
| T-01-29 | `relocate_project` on a marker naming a different project | calls `marker::verify_marker(&canonical, project_id)` and returns "refusing to relocate" on mismatch |
| T-01-30 | marker field count | `project_reconciliation.rs:138` asserts `object.len() == 2` |
| T-01-GC-01, T-01-GC-12, T-01-GC-16 | where a cross-project parent is rejected | `assert_parent_in_project` (`domain/mod.rs:43`) called inside the transaction before the UPDATE on all four paths: `task.rs:53` (create), `task.rs:673` (set_epic), `issue.rs:64/67` (create), `issue.rs:461/462` (set_parent). Table name comes from a `ParentTable` enum match over compile-time literals, never a string |
| T-01-16-SC … T-01-21-SC | whether those plans added a dependency | `git log` on all four manifests — untouched since plan 01-05 |

The 35 medium and 12 low `mitigate` threats were verified the same way, by locating the named
mechanism: `default_db_path` with no `current_dir` read in core · self-hosted `public/fonts/` with no
font-CDN hostname · `canonicalize` on the picked path · command-layer title/description caps · three
FTS sync triggers in migration 0002 · epic delete orphaning rather than cascading · `DEFAULT_BACKUP_RETENTION`
· `assignee_must_reference_a_real_actor` · `DEFAULT_LIMIT`/`MAX_LIMIT` · the static `BINDINGS` table ·
`IssueParent` · `bindingAllowedInLayer` · `PickerKind` · `App.tsx`'s only `returnToBoardLayer`
occurrence still being a comment · `project_id = ?1` scoping · `epic-pill-unresolved` ·
`quickAddRowIndex` · `quickAddFocusPending` · `MOUNTABLE_ROW_ESTIMATE` · `scrollToIndex` ·
`MenuHandles` · `concat!` · `json_each` · `no_row_renders_a_raw_internal_identifier_at_volume` ·
`buildVolumeItems`. All present. `tsc --noEmit` is clean, which is what T-01-18-04 rests on.

**One honest deviation to record.** T-01-03's mitigation text promises "a grep gate fails the build
if the core enumerates directories". The core does contain exactly one `fs::read_dir`, at
`packages/core/src/db/backup.rs:84`, enumerating the app's own backups directory to prune it. The
threat itself — *marker content used to derive a filesystem path* — is closed: that enumeration is
over an app-data path the process owns, derived from no marker and no user content. But the invariant
as literally written has one exception, and a future audit should read it as "core never enumerates a
**user-supplied** directory" rather than as an absolute.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01-01 | T-01-06 (low) | No credential or secret is stored in the database in this phase (`01-RESEARCH.md` § Security Domain, V6). Revisit when agent credentials or relay tokens enter the schema | Cyril — plan 01-01 threat model | 2026-09-10 |
| AR-01-02 | T-01-12 (low) | The comment is authored content in a tracked file; corruption is caught by the seed-key grep in Task 2's verify. No integrity control beyond version control is warranted for a build-time comment | Cyril — plan 01-02 threat model | 2026-09-10 |
| AR-01-03 | T-01-16-03 (low) | A compromised renderer could re-enable a menu item that the layer model would refuse. Accepted because enabling an item confers no authority: the dispatched id is still refused by the guard, which is the enforcement point. The menu state is an affordance only | Cyril — plan 01-16 threat model | 2026-09-10 |
| AR-01-04 | T-01-17-03 (low) | The command deliberately returns every epic in the project, exempting it from `board.rs`'s `DEFAULT_LIMIT`/`MAX_LIMIT` cap (T-01-24). "Small and bounded" is **not enforced** — it is a property of who writes epics: Phase 1 has one local human actor and one creation path (`epic_create`, one epic per call), and each row is three short TEXT columns. Accepted rather than capped because any cap would silently truncate the roster and reintroduce the exact defect this plan closes. `roster_at_volume_is_under_the_50ms_budget` measures it at 250 epics, far above any realistic count. **Re-rate when** Phase 2+ gives an agent an epic-creation path, or a bulk import lands | Cyril — plan 01-17 threat model | 2026-09-10 |
| AR-01-05 | T-01-17-05 (low) | A compromised renderer could display a label that does not match the stored epic. Accepted because the label is display-only and confers no authority — every mutation still resolves `actor_id` server-side (T-01-04) and every reparenting still passes `assert_parent_in_project` | Cyril — plan 01-17 threat model | 2026-09-10 |
| AR-01-06 | T-01-19 (low) | The backups sit beside the live file in the same OS app-data directory, under the same user's permissions, and carry no secret the live file does not already carry (`01-RESEARCH.md` § Security Domain, V6). Revisit when credentials enter the schema | Cyril — plan 01-05 threat model | 2026-09-10 |
| AR-01-07 | T-01-20-04 (low) | The alternate mock is installed per-case rather than in the shared `beforeEach`, so it cannot change what the 17 pre-existing cases exercise. Accepted rather than mitigated further: a test-local mock has no production reachability | Cyril — plan 01-20 threat model | 2026-09-10 |
| AR-01-08 | T-01-21-04 (low) | Unchanged by this plan. 01-19's `T-01-19-01` disposition still holds: the scroll is addressed by a row index into the current project's `rows` array, never by an item id, so no cross-project reference can be constructed. This plan does not modify that effect; carried forward, not re-litigated | Cyril — plan 01-21 threat model | 2026-09-10 |
| AR-01-09 | T-01-21-06 (low) | Not applicable to this diff — no new text is rendered and `BoardRow.tsx` is untouched. G-01-2's no-raw-identifier property is re-asserted at volume by the existing `no_row_renders_a_raw_internal_identifier_at_volume` case, which stays green | Cyril — plan 01-21 threat model | 2026-09-10 |
| AR-01-10 | T-01-22 (low) | The documented tradeoff of fractional indexing. At human-paced reordering over 1,000 items the growth is immaterial; recorded as a watch item in the `ranking.rs` doc comment. Revisit if an automated writer starts moving items to one boundary in bulk | Cyril — plan 01-07 threat model | 2026-09-10 |
| AR-01-11 | T-01-GC-06 (low) | Every id column carries `CHECK (length(id) = 26)`; a longer string fails the parent lookup and is never stored | Cyril — plan 01-12 threat model | 2026-09-10 |
| AR-01-12 | T-01-GC-10 (low) | `dispatchAction` is renderer-internal and the window loads only bundled first-party code — a synthesized keydown carries exactly the authority a real one does, and every action it reaches is already reachable from the user's keyboard. Revisit if agent-authored content is ever rendered inside this window | Cyril — plan 01-13 threat model | 2026-09-10 |
| AR-01-13 | T-01-GC-14 (low) | Each label is the epic's own key and title, already rendered on the board row beside it | Cyril — plan 01-14 threat model | 2026-09-10 |
| AR-01-14 | T-01-GC-20 (low) | Every label is the item's own key and title, already rendered on the board beside it | Cyril — plan 01-15 threat model | 2026-09-10 |

*Accepted risks do not resurface in future audit runs.*

All 14 are `low` severity, well below the `high` block threshold. Two carry explicit re-rate
triggers worth repeating here, because both fire in the next few phases rather than hypothetically:

- **AR-01-04 (`T-01-17-03`)** — `epic_roster` deliberately returns every epic in a project, exempt
  from the `DEFAULT_LIMIT`/`MAX_LIMIT` cap. "Small and bounded" is **not enforced**; it holds only
  because Phase 1 has one local human actor and one creation path. **Re-rate when Phase 2+ gives an
  agent an epic-creation path, or when a bulk import lands** — this is the phase's sharpest latent
  DoS surface, and it is unguarded by design, not by oversight.
- **AR-01-12 (`T-01-GC-10`)** — `dispatchAction` is renderer-internal and safe only while the window
  loads exclusively bundled first-party code. **Revisit if agent-authored content is ever rendered
  inside this window**, which the roadmap has agents doing from Phase 6.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-09-10 | 83 | 83 | 0 | `/gsd-secure-phase 01` (orchestrator, ASVS L1 grep depth, no auditor subagent — short-circuit rule: `threats_open: 0` + `register_authored_at_plan_time: true` + `asvs_level == 1`) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer) — 69 mitigate, 14 accept, 0 transfer
- [x] Accepted risks documented in Accepted Risks Log — 14 entries, all `low`
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter
- [x] Every mitigation verified against the artifact it names, not against the plan's claim

**Approval:** verified 2026-09-10

**Scope limit, stated plainly.** This is an ASVS **L1** audit: grep depth. It confirms each declared
mitigation is present at the place the plan said it would be. It does **not** include L2
boundary-placement analysis or L3 end-to-end trace verification, and it did not hunt for threats the
21 plans failed to imagine. Raise `workflow.security_asvs_level` to 2 and re-run to get the deeper
pass, which will spawn `gsd-security-auditor` even on a clean register.
