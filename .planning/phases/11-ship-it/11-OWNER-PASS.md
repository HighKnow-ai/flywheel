---
phase: 11-ship-it
plan: 21
type: owner-pass
written: 2026-10-14
register: .planning/DEFERRED-REVIEW.md
rows: 67
status: answered-2026-10-14-register-redeemed
---

# Phase 11 Plan 21: The owner pass

One row per register item, then the owner's agenda, then the board payload for the survivors.
Nothing here is described as verified unless a named test, command or screenshot closes it. A row that
reads `owner-question` is **unanswered** until the owner's own words are written beside it.

## 0. Read this first

**The register holds 67 items, not 55.** The plan was written when the register held 55. Plans 11-06, 11-08
and 11-19 added D-REV-56 to D-REV-64 afterwards (D-REV-61 and 62 were renumbered once; see the register's
integrity note), this plan found D-REV-65 and D-REV-66 on the installed build, and the filing found D-REV-67.
The plan's gate `grep -c ... = 55` therefore cannot pass on a correct table; this document asserts 67 and the
register is checked against the same number. Recorded as a deviation in the SUMMARY.

**The register's premise "no WebDriver for WKWebView" is partly wrong, and this pass acted on that.**
`/Applications/Flywheel.app` exposes its web content to macOS accessibility: every button, heading and text
node of the installed app is readable, and every button is clickable, from `System Events`
(`scripts/release/ax-drive.js`). That is not WebDriver, but it is a scripted read and click of the packaged
app. It closed items the register had filed as "needs a person" (section 2). What it cannot do is judge
anything (looks, readability) or reach the OS (Notification Center, Keychain, a real login).

**Counts (assert):** closed-automated 17, closed-by-decision 9, accepted-by-design 2, owner-question 22, filed-to-board 17. 17 + 9 + 2 + 22 + 17 = **67**.
Before the owner answered (2026-10-14) the 64 original rows read 17 / 6 / 2 / 24 / 15. His answers moved D-REV-28 and D-REV-42 (D-203, D-201) and D-REV-62 (D-205) to closed-by-decision, and
the filing added D-REV-65, 66 and 67 as filed-to-board.

## 1. The table

| id | truth (one line) | disposition | evidence or reason |
|---|---|---|---|
| D-REV-01 | A destructive action in an auto-accept session blocks until a human answers (AGNT-07) | closed-by-decision | D-197: the requirement was the wrong side. AGNT-07 now reads "refused before it reaches the remote, and the user is told" (REQUIREMENTS.md line 77). The behaviour itself is measured by `scripts/uat/uat-03-destructive-gate.mjs`. |
| D-REV-02 | A keyboard route exists out of a conflicting merge result | closed-automated | `merge-sheet.test.tsx` "moves focus onto a conflict exit when the result renders"; WebKit: `keyboard.browser.test.tsx` "lands focus on a conflict exit when the result renders". Not observed anywhere: a literal Tab press (WKWebView does not Tab to buttons; plan 11-12 deviation 2). |
| D-REV-03 | A moved draft is refused as `draftChanged` before any push or forge call | closed-automated | `packages/core/tests/forge_epic_request_ordering.rs`: `a_moved_draft_is_refused_as_draft_changed_before_any_forge_call_or_push` (no stub log, nothing on the remote) with the positive control `a_matching_draft_pushes_first_then_calls_the_forge_and_the_stub_leaves_a_trace`. |
| D-REV-04 | The owner checks acceptance criteria against a diff while reviewing (Core Value as a habit) | filed-to-board | Only the data vacuum closed (plan 08.1-03). Measured on a copy of the live board (11-19-SUMMARY): 15 criteria on 5 tasks; 902 tasks and all 13 epics carry none. No test can change that; real criteria on real work can. Board item THRE-1119. |
| D-REV-05 | Diff tints and the word-level edit mark read correctly and feel like one palette | owner-question | Physical reason: human aesthetic judgement. Three questions only; the light/dark half of the old question is void (one palette ships). UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1138. |
| D-REV-06 | A gutter-selected diff row keeps code roles above 4.5:1 | closed-automated | `legibility.browser.test.tsx` (review): gutter-clicks a delete and an insert row and runs the AA loop, minimum painted contrast 14.71:1 (plan 11-13). The 4.02 case is unreachable: no `diff` grammar is registered. |
| D-REV-07 | The criteria rail stays usable while reading a long diff | owner-question | Asserted: `ergonomics.browser.test.tsx` (two tests, scrollTop unchanged) and the 900px rail measure (plan 11-13). Physical reason for the rest: ergonomic judgement. Asked with its threshold. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1139. |
| D-REV-08 | The epic task-criteria roll-up scans as one list beside a long diff | owner-question | Structure asserted: `ergonomics.browser.test.tsx` "UAT 2 — the epic roll-up beneath the epic's own criteria" (rows equal the data, the epic's own criteria sit above it). Physical reason: aesthetic judgement of how it reads. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1140. |
| D-REV-09 | Selected-with-focus versus selected-without-focus rules differ; the `Dot` glyph reads at 12px | owner-question | Ratios and painted colours closed by `contrast.test.ts`, `selection-rule.test.tsx` and `legibility.browser.test.tsx`. Physical reason for the rest: perceptual judgement of one 12px glyph. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1141. |
| D-REV-10 | An expanded epic with a challenge reads challenge-first and the 48px row is legible | owner-question | Layout closed in WebKit (`board-group.browser.test.tsx`, long title at 716px, error beside the buttons); the accept path is `packages/core/tests/authoring_acceptance.rs` (`accept_proposal` against real SQLite). Physical reason for the rest: aesthetic judgement. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1142. |
| D-REV-11 | Finish reviewer, group one (board and rail) raises nothing unfixed or unrecorded | filed-to-board | Ran twice; second run `fix`, 8 findings: 1 fixed, 1 rejected, 6 recorded (11-FINISH-REVIEW.md rows one-1 to one-8). Residue filed: THRE-1082 to THRE-1086. |
| D-REV-12 | The board in the real app shell matches the approved comp | filed-to-board | Captured mounted in `<App />` and reviewed: it does not match (rows app-shell-1 to 7). Re-observed on the installed build in this plan: the board has no masthead (`11-21-board-light.png`, `11-21-board-dark.png`). Decisions THRE-1114, THRE-1115; task THRE-1087. |
| D-REV-13 | A task row's tail prints nothing for 0/0 or no priority | closed-by-decision | D-198.1; `packages/desktop/src/board/__tests__/row-tail.test.tsx` (zero and non-zero cases). |
| D-REV-14 | Finish reviewer, group two (detail panel, palette, pickers) | filed-to-board | `fix`, 8 findings: 2 rejected, 6 recorded (rows two-1 to two-8). Residue: THRE-1088 to THRE-1092 and decision THRE-1117 (title scale). |
| D-REV-15 | Finish reviewer, group three (review surface, rail, diff, merge sheet) | filed-to-board | `fix`, 6 findings: 1 fixed, 5 recorded; three-3 fixed later in plan 11-22. Residue: THRE-1093, THRE-1094, THRE-1095 and decisions THRE-1112, THRE-1113. |
| D-REV-16 | Finish reviewer, group four (session surface, permission card, launch sheet) | filed-to-board | `fix`, 8 findings: 2 rejected, 6 recorded; four-1 fixed in plan 11-22; four-2 (the developer's turn in the brand) closed by D-203. Residue: THRE-1096 to THRE-1099 (BI-15, the developer's turn, was closed by D-203 instead of filed). Raw log never captured (THRE-1099). |
| D-REV-17 | Finish reviewer, group five (settings, triage, tray, legend, done warning) | filed-to-board | `fix` twice, 13 findings: 2 fixed, 2 rejected, 9 recorded. Residue: THRE-1100 to THRE-1106 and decision THRE-1116. |
| D-REV-18 | Finish reviewer, group six (first-run, unreachable, registration, confirmations) | filed-to-board | `fix`, 5 findings: 2 fixed, 3 recorded (rows six-3, six-4 filed; six-5 closed by D-199). Residue: THRE-1107, THRE-1108. |
| D-REV-19 | Finish reviewer, the changed foot of the review surface and the launch sheet feedback | filed-to-board | `fix`, 3 findings: 1 fixed, 2 recorded; three alternate foot states still uncaptured. Residue: THRE-1109, THRE-1110, THRE-1111. |
| D-REV-20 | The installed app shows the HighKnow mark in Dock, Finder and About | closed-automated | `bash scripts/release/verify-bundle-assets.sh` exit 0 (installed icns sha256 equals source); `11-20-dock.png` and `11-20-about.png`; this plan's `11-21-about-after-update.png` shows the mark again on the updated 0.1.1. Finder's icon was not captured and is not claimed. |
| D-REV-21 | The icon's inset margin reads correctly beside other icons in the Dock | owner-question | Physical reason: aesthetic judgement. Answerable at a glance from `11-20-dock.png`. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1143. |
| D-REV-22 | Dark mode reaches the installed app's web view | closed-automated | `node scripts/release/verify-appearance.mjs` exit 0: `#0a0a0a` painted in system Dark, `#ffffff` in Light, expected values read from `tokens.css`. Re-seen in this plan: the installed app switched to Dark live (`11-21-board-dark.png`). |
| D-REV-23 | Expanding a status group reads as growth; SC3's text says "animates its height" and nothing does | owner-question | Shape asserted and a stepped wipe fixed (plan 11-13). Physical reason: aesthetic judgement. The wording half is closed by D-202 (owner, 2026-10-14): the criterion reads "reveals its rows with a wipe". (The ROADMAP text had already been amended on 2026-10-09; the register's claim that it was not is stale.) The remaining question, whether the wipe reads as growth, is unanswered. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1144. |
| D-REV-24 | The built board with real data reads bold and modern, not "a very old app" (SC0) | owner-question | Physical reason: aesthetic judgement, the one the phase exists for. Made answerable by this plan: the installed app on a copy of the real board, Light and Dark, window-only captures `11-21-board-light.png` and `11-21-board-dark.png`. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1145. |
| D-REV-25 | The home surface's lead row is not a junk epic; the review queue has a home | filed-to-board | Detection is a test: `JUNK_EPIC_SQL` in `packages/core/tests/project_hide.rs` returns THRE-4 (`test`, 1 task) on the live-board copy; 181 in-review tasks have no epic. The remedy is a data decision on the owner's board. Board item THRE-1120. |
| D-REV-26 | Finish reviewer re-run over all groups and the shell | filed-to-board | Ran as nine runs: 58 findings, 8 fixed, 8 rejected, 45 recorded, none returned `ship` (11-FINISH-REVIEW.md). Fixed items are test-proven, not reviewer-approved. Residue is THRE-1082 to THRE-1111. |
| D-REV-27 | The epic lens narrows its headers under the has-worktree chip (13 to 5) | closed-automated | `lens-narrowing.browser.test.tsx` asserts the narrowed set and the restore on chip-off (plan 11-13); SQL proved in `packages/core/tests/search_filter.rs`. Limits kept: header counts stay board-wide (THRE-1121) and 13 to 5 was not re-observed live. |
| D-REV-28 | The brand carries only its permitted uses | closed-by-decision | D-203 (owner, 2026-10-14): the brand rule is amended to ALLOW the developer's own turn in the feed, because colour is the feed's only channel telling the two speakers apart. It is not moved to ink. `08.1-UI-SPEC.md` § The brand rule gained item 8 and `theme/__tests__/brand-rule.test.ts` was widened with it; the test passes (4 of 4). D-199's other uses are closed by the same test. |
| D-REV-29 | A project whose repository is gone can be removed; a duplicate can be cleared | closed-by-decision | D-200: soft-hide. `packages/core/tests/project_hide.rs` (10/10) and the rail action. The restore surface is unbuilt and filed as D-REV-64. |
| D-REV-30 | Row Anatomy and the Copywriting Contract describe the product | closed-by-decision | D-198.2, .3 and .4 (plan 11-18): zero `type-micro` references remain under `packages/desktop/src`; the Done-warning string is transcribed. |
| D-REV-31 | The 2px neutral selection rule does not read as the banned side stripe | closed-by-decision | The owner decided in A-06 (2026-10-08) and the exception is dated. Independent reviewers told about the floor read it as a match: 11-FINISH-REVIEW.md "Selection rule (A-06): match" and "inside the side-stripe allowance". |
| D-REV-32 | A real hard rate limit presents on the wire as documented and pauses dispatch | accepted-by-design | The live half would mean provoking a hard limit, "the abuse this requirement exists to avoid". A real rejection from Claude Code's own transcripts is frozen as `packages/sidecar/test/fixtures/rate-limit-rejected.json` and classified by `rate-limit-wire.test.mjs`. The `rate_limit_event` shape stays `documented`, not observed. |
| D-REV-33 | The scope-denied row and the refusal badge read well | owner-question | Layout closed in WebKit (`session-group.browser.test.tsx`, a 300-character path). Physical reason: aesthetic judgement of "noticeable at a glance". UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1146. |
| D-REV-34 | One approved plan drives real `claude` sessions end to end in the installed app | owner-question | Wiring closed: `scripts/uat/uat-13-fan-out-live.mjs` (real sidecar, real dispatcher tick, real git; only the model faked; mutation-checked). Physical reason for the rest: a real login and a real model's obedience to the commit instruction. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1147. |
| D-REV-35 | A real planning run completes headlessly, calls `submit_plan` and leaves the worktree clean | owner-question | Pre-approval closed against claude 2.1.287 by `real-claude-argv.test.mjs`. Physical reason for the rest: a real login and a real model following the prompt. Not run here: a planning run writes an epic integration branch into the owner's repository. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1148. |
| D-REV-36 | The wave plan sheet, dispatch cell and gate line read well and work end to end | owner-question | Containment closed (`dispatch-layout.browser.test.tsx`). Click path now driven through the INSTALLED app (section 2.5): draft plan, edit a path, move a task to wave 2, Stop with confirmation. Physical reason for the rest: aesthetic judgement, and Approve or Resume would start real runs in the owner's repository. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1149. |
| D-REV-37 | Nothing between readiness and launch lets two agents share files | closed-automated | `dispatch_auto_merge.rs` `a_live_widen_landing_in_the_window_refuses_the_spawn_and_leaves_exactly_one_run_on_the_files` (plan 11-09) with the Phase 09 interleave tests. |
| D-REV-38 | `why` answers correctly for an undeclared pair; the sheet says "runs alone" | closed-automated | `dispatch_plan.rs` `why_two_same_wave_tasks_that_declared_nothing_run_alone_not_disjoint`. |
| D-REV-39 | Seven lower-severity Phase 09 findings stand unfixed | closed-automated | `dispatch_auto_merge.rs`: `a_persistently_failing_merge_appends_one_event_and_does_not_flap`, `a_task_the_user_ran_by_hand_is_not_relaunched_and_its_finished_work_is_adopted`, `no_desktop_command_runs_the_case_probe_under_the_database_lock`, `an_unattended_start_is_attributed_to_the_system_actor_and_a_manual_one_to_the_human`, `launch_conflict_folds_non_ascii_case_so_the_strict_side_wins`. The five residuals are D-REV-58. |
| D-REV-40 | The harness's TDD gate reads a config flag the planner does not | filed-to-board | A defect in `gsd-core`, not in Flywheel: the remedy lands upstream. Board item THRE-1122. |
| D-REV-41 | A failed, stopped or conflicting task can be retried or skipped from the app | closed-automated | Core `retry_task` and `skip_task` driven in `dispatch_auto_merge.rs` against a real failed run and a real conflict; renderer `packages/desktop/src/dispatch/__tests__/stuck-task.test.tsx`; `grep -rn retry_task packages/sidecar/src` returns 0 (human-only). |
| D-REV-42 | A write outside a task's declared file-set is stopped at the tool level (PLAN-04) | closed-by-decision | D-201 (owner, 2026-10-14): PLAN-04 is narrowed to the file-writing tools, and Bash writes are detected after the fact. REQUIREMENTS.md PLAN-04 now says so, with a dated note. The detection holds the merge: `scope_breach` in `packages/core/tests/dispatch_auto_merge.rs` (plan 11-11). Bash prevention is not claimed. |
| D-REV-43 | A user who launches over another live task sees the overlap warning | closed-automated | `packages/desktop/src/shell/__tests__/launch-overlap-toast.test.tsx` (four tests) and `merge-sheet.test.tsx` (warning handed to the app-level toast). |
| D-REV-44 | The launch body and the dispatcher return the same verdict on every repository | closed-automated | `scope_widen.rs` `the_launch_and_the_dispatcher_agree_on_a_case_only_pair_for_either_case_flag`. |
| D-REV-45 | A widen into a task parked at pre-spawn attention records an ordering edge | closed-automated | `scope_widen.rs` `a_widen_reaching_a_task_parked_at_pre_spawn_attention_records_a_widen_edge`. |
| D-REV-46 | A launch failing after its run row exists leaves no running row | closed-automated | `commands/agent_run.rs` `a_shim_install_failure_closes_the_run_failed`, `a_failed_gated_spawn_closes_the_run_failed` (and two siblings); renderer `merge-sheet.test.tsx` (refusal reason shown). |
| D-REV-47 | The fleet surface reads at a glance at real row density | owner-question | Containment closed in WebKit (`fleet-group.browser.test.tsx`, 900 and 1200px, both schemes). Physical reason: aesthetic judgement of "easy to scan". UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1150. |
| D-REV-48 | A live agent's activity cell moves within about a second of its tool call | owner-question | Live-read half closed (`uat-12-fleet-live-reads.mjs` section D-REV-48). Physical reason for the rest: it needs a live sidecar writing a real log, which needs a real login; plus aesthetic judgement of the clipped line. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1151. |
| D-REV-49 | Spend column, estimate footer and Dismiss read clearly and a dismissed row leaves | owner-question | Round trip OBSERVED on the installed app in this plan: clicking Dismiss on THRE-38 removed the row (3 rows to 2) and set `acknowledged_at`; the other two rows were untouched (section 2.4). Physical reason for the rest: aesthetic judgement of the columns at row density. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1152. |
| D-REV-50 | With real blocked agents in two projects, one `a` press answers exactly the marked agent | owner-question | Queue half closed (`uat-12` section D-REV-50). Physical reason for the rest: real blocked agents need a live sidecar and a real login; plus the look of the owner marking. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1153. |
| D-REV-51 | Enter or a click on a fleet row opens its live output; the subject key lands on the item | owner-question | Shell half closed in jsdom and WebKit (`fleet-jump.browser.test.tsx`). Installed-app check in this plan FOUND A DEFECT, filed as D-REV-65: the subject key leaves the fleet for the board but opens nothing. Physical reason for the rest: aesthetic judgement of the key as a button. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1154. |
| D-REV-52 | A real banner appears in Notification Center when an agent blocks, finishes or fails | owner-question | Physical reason: the OS notification centre is outside the process and has no automation surface; needs a real agent event on the installed bundle. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1155. |
| D-REV-53 | The first notification triggers or skips the system permission prompt; a declining user is not misled | owner-question | Physical reason: the prompt is drawn and answered by the operating system and its state lives in System Settings. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1156. |
| D-REV-54 | The Worktrees entry lists every task worktree with size and age; Re-measure fills sizes | owner-question | View closed in WebKit (`fleet-group.browser.test.tsx`). Opened in the installed app on the board copy: 5 worktrees, eligibility shown, one `Reclaimable`. Re-measure returned "could not be measured completely" because the scratch HOME places the worktree root elsewhere; sizes were NOT observed. Needs the owner's real HOME, which means migrating the owner's real database (an irreversible step that is the owner's to take). UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1157. |
| D-REV-55 | Reclaiming selected worktrees deletes exactly those directories and the window stays responsive | owner-question | Removal half closed (`uat-12` section D-REV-55: 321 reads during a 2.2 s reclaim, slowest 11 ms). Physical reason for the rest: removing multi-second worktrees through the installed app deletes the owner's real directories and needs the owner's consent and data; plus aesthetic judgement. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1158. |
| D-REV-56 | ci.yml and open-core.yml go green on a GitHub runner | closed-automated | Observed on macos-14: `ci.yml` run 38346860234 and `open-core.yml` run 38346860235 (plan 11-04). Stability is not claimed: `authoring_lifecycle.rs` fails about 1 run in 8 on a runtime-marker race (deferred-items). |
| D-REV-57 | One v* tag produces four assets and an installed client can update | closed-automated | Four assets observed on release run 38396587749 (plan 11-05); installed-client half now observed: the installed 0.1.0 downloaded, verified and installed 0.1.1 (section 2.2: `11-21-about-after-update.png`). Since 2026-10-14 the updater URL answers 404 while both releases are Pre-release: D-REV-67. |
| D-REV-58 | Five residuals of D-REV-39 and D-REV-44 stand open | filed-to-board | Each names its closing test in the register entry. Board items THRE-1123 to THRE-1127. |
| D-REV-59 | The dispatcher adopts a hand-run task and auto-merges it unreviewed | closed-by-decision | Settled by the owner 2026-10-13: offered adopt-but-hold-for-review and declined. Revisit only if an unreviewed adopt surprises him in use. |
| D-REV-60 | DIST-01 criterion 1 is not met: unsigned, not notarized | accepted-by-design | The owner declined the $99/yr Apple Developer purchase (2026-10-13). **DIST-01 criterion 1 stays recorded as UNMET.** The register's workaround text ("right-click-Open") was wrong for this macOS; D-REV-62 documents the working `xattr -cr` instead. Both releases are marked Pre-release on GitHub (the owner's choice, 2026-10-14) to say that distribution is unsolved. |
| D-REV-61 | An older installed build shows the update banner, accepts, relaunches into the new version, and refuses with a count while agents run | closed-automated | Observed on the installed 0.1.0 in this plan (section 2.2 and 2.3): banner naming 0.1.1 with the release's commit subject; accept staged "Flywheel 0.1.1 is installed. Relaunch to use it."; relaunch's About panel reads `Version 0.1.1 (0.1.1)`; with 2 live runs the banner reads "2 agents running. The update waits until they finish." and Install is disabled. Dismissal lasts the session only: filed as D-REV-66, and the owner chose to keep it (D-206). Since 2026-10-14 the updater URL answers 404 while both releases are Pre-release: D-REV-67. |
| D-REV-62 | What a first-time user sees opening the unsigned release downloaded in a browser | closed-by-decision | D-205 (owner, 2026-10-14): the `xattr -cr /Applications/Flywheel.app` workaround is documented in README.md § Installing a release and appended to the release pages of `v0.1.0` and `v0.1.1`; `.github/release-install-note.md` is added by the release workflow to every later release. The dialog was reproduced on a quarantined copy (§ 2.1, `11-21-gatekeeper-dialog.png`): "damaged", with only Move to Trash and Cancel, so the register's old right-click-Open line was wrong and is corrected here. This is a workaround and not a signed build: DIST-01 criterion 1 stays UNMET. |
| D-REV-63 | "Remove from Flywheel..." reads as a reversible hide and the row sits acceptably | owner-question | Content asserted in `project-rail.test.tsx`. Physical reason: aesthetic and comprehension judgement of one sentence. UNANSWERED 2026-10-14; not recorded as passed. Board issue THRE-1159. |
| D-REV-64 | A hidden project can be listed and restored from inside the app | filed-to-board | Unbuilt: `project_restore` exists and is tested in core; nothing in the renderer calls `projectRestore`. Closing test named in the register entry. Board item THRE-1128. |
| D-REV-65 | On the installed v0.1.0, pressing the subject key on a fleet row lands on the board with that item's detail open | filed-to-board | Defect observed on the installed build (§ 2.4): the key left the fleet for the board and opened nothing, on two tries. jsdom and WebKit assert it opens. Board item THRE-1129 (priority 2), closing test named in its criteria. |
| D-REV-66 | Dismissing the update banner is remembered for that version | filed-to-board | D-206 (owner, 2026-10-14): KEEP the per-session dismissal. Filed low priority as THRE-1135 (priority 4), gated on the owner reversing D-206 and closed unchanged otherwise. |
| D-REV-67 | An installed client can reach the updater endpoint | filed-to-board | Found in this plan: `https://github.com/HighKnow-ai/flywheel/releases/latest/download/latest.json` answers 404 (`curl -sIL`, 2026-10-14) because GitHub's `latest` skips Pre-releases and both releases were marked Pre-release on 2026-10-14. While it holds, no installed client sees an update. NOT changed here: the Pre-release marking is the owner's choice. Board item THRE-1136 (priority 1). DIST-02 is unticked for this reason. |

Row count: 67. Disposition counts: closed-automated 17, closed-by-decision 9, accepted-by-design 2,
owner-question 22, filed-to-board 17; total 67.

## 2. What was automated in this plan, before anything was asked

Everything below ran against the installed `/Applications/Flywheel.app` (`0.1.0`, byte-identical to the
release) or a copy of it, never a build directory, and never the owner's own database: each run used a
scratch `HOME`, and the board runs used a `sqlite3 .backup` copy of the live database. `/Applications` was
not modified (`CFBundleShortVersionString` still `0.1.0`), nothing was installed over it, and no process
survived. Screenshots are the application window's own pixels only (`screencapture -l<window>`): an earlier
region capture caught other windows on the screen; the executor saw it, deleted it at once, and none was committed.

### 2.1 D-REV-62: the Gatekeeper experience, reproduced

A copy of the installed bundle in a scratch directory, `com.apple.quarantine` set the way a browser sets it
(`0083;<time>;Safari;<uuid>`), opened with `open`. Evidence: `11-21-gatekeeper-dialog.png` (window only).

- `spctl --assess` on the copy: "code has no resources but signature indicates they must be present".
- The dialog (French system locale): "Flywheel.app est endommagé et ne peut pas être ouvert. Vous devriez
  placer cet élément dans la Corbeille. Safari a téléchargé ce fichier aujourd'hui à 12:14." Buttons:
  **Placer dans la corbeille** and **Annuler**. There is **no Open button**, so the "right-click Open"
  workaround D-REV-60 names does not exist on this macOS for this bundle.
- Workaround A, `xattr -cr <app>` then `open`: the app started.
- Workaround B, `codesign --force --deep -s -` (ad-hoc re-sign) with quarantine still set: `codesign --verify
  --deep --strict` passes, `spctl` still rejects, and the dialog becomes "Apple n'a pas pu confirmer que
  Flywheel.app ne contenait pas de logiciel malveillant ..." with Terminé and Placer dans la corbeille
  (`11-21-gatekeeper-dialog-adhoc-resigned.png`). The user would then go to System Settings > Privacy &
  Security > Open Anyway, which needs an administrator password. **Not attempted**: physical (a password).
- **What this does not show:** a real browser download's quarantine record is richer than the attribute
  written here, and the dialog is drawn in the system language. The wording is evidence for the form, not a
  transcript of every Mac.

### 2.2 D-REV-61 and D-REV-57: the update, end to end

On a `ditto` copy of the installed bundle at a scratch path (so the updater replaced the copy, not
`/Applications`), scratch HOME, v0.1.1 published and `releases/latest`:

1. Launch: the banner "Flywheel 0.1.1 is available / you have 0.1.0" with the release's commit subject, and
   the buttons Install on relaunch and Not now (read from the accessibility tree).
2. Click Install on relaunch. Within the poll window the banner read "Flywheel 0.1.1 is installed. Relaunch
   to use it." and the copy's `Info.plist` read `0.1.1`; the executable hash changed
   (`1d343f52...` to `3e1c5fea...`). The updater's own signature check ran inside that call.
3. Quit, relaunch the same path: no banner; the About panel reads **`Version 0.1.1 (0.1.1)`**
   (`11-21-about-after-update.png`). Nothing was downloaded, mounted or dragged by a person.
4. The copy is ad-hoc signed, as the release is. Nothing here changes D-REV-60.

**So criterion 2 is observed, with automation, on a copy of the installed 0.1.0.** It is not the owner's own
observation and not an in-place update of `/Applications`.

### 2.3 D-REV-61: dismissal and the live-run count

- Not now hid the banner. After quitting and relaunching with the same HOME **the banner returned**. The
  dismissal is UI state (`uiStore.dismissedUpdateVersion`) and does not survive a relaunch. The plan said
  "remembered for that version only"; the code remembers it for the session. Filed as D-REV-66.
- Live-run count: two `running` rows were inserted into the board copy AFTER the app started (startup
  reconcile marks a `running` row with no process as Abandoned, which the first attempt showed). The banner
  then read "2 agents running. The update waits until they finish." and the Install button was `enabled=false`
  (`11-21-update-live-runs.png`). **Limit:** the agents were database rows, not processes; the Rust refusal
  itself (a click that is refused) was not exercised because the button is disabled.

### 2.4 D-REV-49, D-REV-51 and D-REV-54 on the installed app

- D-REV-49: Dismiss on a failed run's row removed it and set `acknowledged_at`; a completed run's row and
  the real "Awaiting review" row stayed. A real Tauri round trip, driven by accessibility.
- D-REV-51: Open on a fleet row's subject key left the fleet and showed the board, **and did not open the
  item**, on two tries 12 seconds apart. jsdom and WebKit assert that it does. Filed as D-REV-65.
  Enter-on-a-row and Back were not driven (focus sits on the rail button, so a keystroke goes there).
- D-REV-54: see the row; the walk was refused under the scratch root, which is why sizes were not observed.

### 2.5 D-REV-36: the click path through the packaged app

On the board copy with a seeded draft plan (4 tasks, 2 waves) and a seeded paused plan, with the app
launched from `/Applications`:

- The epic's cell read "Draft plan, not started / Review plan" and "Wave 1 of 3, Paused: no new work starts
  / Resume / Stop / Open plan". `11-21-wave-plan-sheet-light.png` and `-dark.png` show the open sheet.
- Typing a second path into a task's field and pressing Save files wrote the entry (`task_file_set_entries`
  gained `src/edited/by-ui.rs`) through the real command. A first attempt was REFUSED by the core with
  "plan id must be a 26-character ULID", rendered in the sheet in the core's own words: that was my seed's
  mistake and shows the refusal path working.
- The wave picker moved a task from wave 1 to 2 in `dispatch_plan_tasks`.
- Stop showed "Stop starting new work? Running sessions keep going; nothing is interrupted." with Stop the
  fan-out and Keep the plan; Stop the fan-out set the plan `aborted`.
- **Not exercised:** Plan fan-out (a real planning run), Approve and start and Resume (each starts runs that
  create worktrees and branches in the owner's repository). Those need a real login and the owner's say-so.
- One observation for the board, not a defect claim: the update banner paints above the open dialog's scrim.

### 2.6 D-REV-24 and the looks: the owner can now judge from pictures

`11-21-board-light.png` and `11-21-board-dark.png` are the real board (907 tasks, 13 epics) in the installed
app's epic lens. They show what 11-17's reviewer said: no masthead and no `Mission Control` heading.

### 2.7 What was deliberately NOT done

A real model run (costs the owner's account and writes into the owner's repository), anything that migrates
or writes the owner's real database, an in-place update of `/Applications/Flywheel.app`, the System Settings
"Open Anyway" step (a password), and the accessibility-permission prompt macOS raised for the Orca host
during this work: that is the owner's to answer, and it was left alone.

## 3. The owner's agenda: one pass, grouped

Answer each in a few words. An unanswered row stays `owner-question` and is recorded as not answered.

**Outcome (2026-10-14): see section 6.** D1 to D3, D5 and D6 were answered and applied; D4's five calls were filed to the board as decisions; D7 was approved and run.

**Decisions (each changes text or behaviour; a recommendation is attached)**

| # | Decision | Recommendation | Rows |
|---|---|---|---|
| D1 | PLAN-04 says "prevented at the tool level". Shipped: file tools prevented, Bash detected and the breach now holds the merge. Narrow the text, or schedule Bash prevention? | Narrow the text to "file-writing tools", keep the held merge. | D-REV-42 |
| D2 | ROADMAP SC3 says a status group "animates its height"; the shipped technique animates none. Narrow the text, or change the behaviour? | Narrow the text to "reveals its rows with a wipe". | D-REV-23 |
| D3 | The developer's own turn in the feed is painted in the brand colour; D-199 did not decide it. Amend the brand rule to allow it, or move it to ink? | Amend the rule: it is the feed's only channel telling the two speakers apart. | D-REV-28 (four-2) |
| D4 | Five design calls from the finish reviewer: review pane order (three-1), the 380px file column (three-2), a masthead in the shell (app-shell-1), the lens toggle's own row (app-shell-2), and the triage button wall (five-2). | Answer each yes or no, in order. An unanswered one is filed as a decision on the board and does not block the phase. | D-REV-12, 15, 17 |
| D5 | Add the `xattr` workaround to the README and the release notes, and change the register's "right-click Open" line? | Yes. It is three lines and it is the first screen a stranger sees. | D-REV-62, D-REV-60 |
| D6 | The update banner returns on every launch until updated. Keep, or remember the dismissal per version? | Keep; file low. | D-REV-66 |
| D7 | Where do the board items go (section 4)? | Option (b): file them through the board's own write path after a backup. | all filed rows |

**Looks (one glance each; the captures are in this directory)**

Open `11-21-board-light.png`, `11-21-board-dark.png`, `11-21-wave-plan-sheet-light.png`,
`11-21-wave-plan-sheet-dark.png` and `11-20-dock.png`. Then say yes, no or unsure to: SC0, "bold and modern,
not a very old app" (D-REV-24); the icon's margin beside its neighbours (D-REV-21); and each of the thresholds
the plans proposed, recorded in the register entries: D-REV-05, 07, 08, 09, 10, 23, 33, 36, 47, 49, 51, 54,
55 and 63. A judgement asked without a threshold gets a shrug, so each register entry carries its own.

**By using it (no sitting needed)**

D-REV-34, 35 and 36's live half, D-REV-48 and 50 need a real login and a real agent: use Flywheel for real
work and answer from that. D-REV-52 and 53 need one real agent block on the installed app and a look at
Notification Center. D-REV-54 and 55 need the app on your real data.

## 4. How the survivors get onto the board (Decision D7)

D-196 says the survivors become real board items, "using the installed application". Two facts shape that:

- The installed `0.1.0` creates items only by hand through its quick-add and authoring surfaces; filing the
  ~50 below by hand is an afternoon of typing.
- The owner's real database is at schema version 18. The installed app migrates it to 21 on its first launch
  against it, and a build from this branch would take it to 22. Writing to it from a script is an
  irreversible step for him to approve, behind a backup, the way plan 08.1-03 did for `seed_criteria`.

Options: (a) by hand through the app, (b) one script through the core's own write verbs after
`sqlite3 .backup`, (c) leave them in this file until Phase 12. Recommended: (b), after D1 to D6 are answered
so decisions are filed with their outcome. Nothing has been written to the owner's database by this plan.

**Outcome (2026-10-14): option (b) was approved by the owner and run.**

- **Backup first.** `sqlite3 "<real db>" ".backup '/Users/cymarechal/flywheel-db-backup-2026-10-14.db'"` ran before any write.
  The copy is **2,650,112 bytes** (2.7 MB), outside any session temp directory. It passes `pragma integrity_check` (`ok`), reads
  `user_version` 18, and holds the same counts as the live file at that moment (907 tasks, 13 epics, 2 projects). sha256
  `b5a68f2840823c503fbc6c8f642c5aa7edb9cce0a8ac7133e2b74db251ef44ba`. Restoring is copying that file over `flywheel.db` with the app closed.
- **The tool.** `packages/core/tests/bin/file_board_items.rs`, run as `file_board_items 11-21-board-payload.json --i-mean-the-real-database`.
  It writes through `create_epic`, `create_task`, `update_task`, `set_priority`, `create_issue` and `create_criterion`: no SQL writes.
  It is idempotent by title (a second run on a scratch copy created nothing).
- **Schema 18 to 21, not 22.** The owner accepted the migration to 21. This branch has a 22nd migration (`0022_project_hidden`); the tool opens the
  database with the first 21 migrations only (`core::db::open_and_migrate_with`, a small extraction from `open_and_migrate`), so the installed
  `0.1.1` still understands the file. Read back after the run: `user_version` 21, integrity `ok`.
- **A dry run first.** The same tool ran on a scratch copy of the backup: 3 epics, 48 tasks, 28 issues, 94 criteria. The real run printed the same totals.
- **Result on the real board:** tasks 907 to 955, epics 13 to 16, issues 161 to 189, acceptance criteria 15 to 109. Log: `11-21-board-filing.log`.

## 5. Board payload (D-196), ready to file

Two epics. Every item carries acceptance criteria that name what would show it done. `BI-D*` are decisions
(issues), the rest are tasks.

**Epic E-A: Finish-review follow-ups (Phase 8.1 surfaces).** Source: 11-FINISH-REVIEW.md row ids.

| key | title | source | acceptance criteria |
|---|---|---|---|
| THRE-1082 (BI-01) | Rail shows live counts (Agents, Worktrees, In review, Challenges) | one-1 | The rail prints all four counts from reads; a test asserts each against a fixture. |
| THRE-1083 (BI-02) | Move the change cue to the task row's tail | one-2 | The key aligns on rows with and without a cue; a WebKit test asserts the cue's right edge. |
| THRE-1084 (BI-03) | Task key muted and regular weight | one-3 | The key paints the muted role at weight 400 and the title carries the row; a computed-style test asserts it. |
| THRE-1085 (BI-04) | Raise the change cue's size and place the epic header's cue at the right edge | one-4 | The cue is at least 12px and filled; the epic header's cue sits within 24px of the right edge, measured in WebKit. |
| THRE-1086 (BI-05) | Rail wordmark and selected-project fill | one-6 | After the owner's call, the rail either prints "Flywheel" or the decision is recorded; the selection treatment is asserted. |
| THRE-1087 (BI-06) | Summary line placement and the rail/title join | app-shell-3, app-shell-4 | After D4, the summary sits where DESIGN.md says and the rail and title block share a line; both asserted in WebKit. |
| THRE-1088 (BI-07) | Item detail value column marks | two-2 | Status and priority print their registry mark beside the word; a jsdom test asserts both. |
| THRE-1089 (BI-08) | Path value ellipsis gap in the detail panel | two-3 | The ellipsis sits against its text at 330px in WebKit; the failed `text-align` remedy is not reused. |
| THRE-1090 (BI-09) | Human verbs in the activity trail | two-4 | "criterion created x8" reads as a verb phrase; the mapping has a test per event type shown. |
| THRE-1091 (BI-10) | Normalise palette and link copy | two-6 | One case convention and the typographic ellipsis across the tested strings; each string's test updated. |
| THRE-1092 (BI-11) | Title scale of the detail panel | two-1 (decision BI-D6) | After the owner's call, the title is 20px or the Heading step is recorded as final. |
| THRE-1093 (BI-12) | Review diff hunk headers | three-5 | Each hunk renders an `@@` header decoration; asserted in WebKit with contrast re-measured. |
| THRE-1094 (BI-13) | Review diff code-area tint | three-4 | The tint is raised only if every syntax role still clears 4.5:1; `legibility.browser.test.tsx` passes. |
| THRE-1095 (BI-14) | Sent-back note ink | review-foot-2 | The note takes the primary ink, distinct from the hint; a computed-style test asserts it. |
| BI-15 (not filed) | Developer turns in the brand | four-2 (decision D3) | After D3, `FeedRow.tsx` and `brand-rule.test.ts` agree; the test passes. |
| THRE-1096 (BI-16) | Drawn disclosure and back glyphs in the session surface | four-4 | `▸ ▾ ←` text characters become drawn icons in one size and ink. |
| THRE-1097 (BI-17) | Authoring header grouping | four-6 | The stage strip and the commands separate; asserted by a layout test. |
| THRE-1098 (BI-18) | Completed run outcome row | four-7 | A completed run prints an outcome notice as the failed run does. |
| THRE-1099 (BI-19) | Capture the raw log and the cost strip | four-9 | A capture exists for each and the finish reviewer has judged both. |
| THRE-1100 (BI-20) | Triage lead button order | five-3 | One convention for where the lead sits is chosen and applied across the clusters. |
| THRE-1101 (BI-21) | Settings alignment | five-4 | Controls share one alignment system, measured in WebKit. |
| THRE-1102 (BI-22) | Distinct icons for task and criterion proposals | five-6 | The two kinds draw different icons; a jsdom test asserts it. |
| THRE-1103 (BI-23) | Themed checkboxes and number spinner | five-7 | The settings controls use the app's tokens in both schemes; contrast asserted. |
| THRE-1104 (BI-24) | Permission-rules table measure | five-rules-1 | The table shares the settings column's right edge, measured in WebKit. |
| THRE-1105 (BI-25) | Permission-rules header weight | five-rules-5 | Header and value differ in size or colour; asserted. |
| THRE-1106 (BI-26) | Proposal row kind label inline | five-1 (decision) | After D4, the proposal row and the challenge row set the kind the same way. |
| THRE-1107 (BI-27) | Orphan row repeats its heading | six-3 | The per-row phrase is shortened without losing the pairing with the glyph; copy test updated. |
| THRE-1108 (BI-28) | One key face across the product | six-4 | Keys use one face, or the Mono contract is restated as final. |
| THRE-1109 (BI-29) | Merge label copy | review-foot-1 | The owner decides whether "into epic" returns; copy and test follow. |
| THRE-1110 (BI-30) | Capture the foot's alternate states | review-foot-4 | The nothing-unchecked note, the no-criteria note and the could-not-send alert are captured and reviewed. |
| THRE-1111 (BI-32) | Capture the epic request sheet | D-REV-15 | A capture exists and has been judged by the finish reviewer. |
| THRE-1112 (BI-D1) | Review pane order | three-1 | A recorded owner call: criteria first, or files first. |
| THRE-1113 (BI-D2) | The 380px file column | three-2 | A recorded owner call and the diff width it implies. |
| THRE-1114 (BI-D3) | A masthead in the shell | app-shell-1 | A recorded owner call; if yes, a plan with its data contract. |
| THRE-1115 (BI-D4) | The lens toggle's own row | app-shell-2 | A recorded owner call; DESIGN.md or the code changes to match. |
| THRE-1116 (BI-D5) | The triage button wall | five-2 | A recorded owner call; the lower-ranked answers move to the text action or stay. |
| THRE-1117 (BI-D6) | Detail panel title scale | two-1 | A recorded owner call (see BI-11). |

**Epic E-B: Phase 11 register survivors.**

| key | title | source | acceptance criteria |
|---|---|---|---|
| THRE-1119 (BI-31) | Real acceptance criteria on the tasks that will be dispatched | D-REV-04 | Every task given a worktree carries at least three diff-checkable criteria; the count is read from the board, not asserted. |
| THRE-1120 (BI-33) | The junk lead epic and the homeless review queue | D-REV-25 | THRE-4 and THRE-5 are deleted or retitled; the 181 in-review tasks have an epic or the status lens is recorded as their home; `JUNK_EPIC_SQL` returns 0 rows. |
| THRE-1121 (BI-34) | Epic header counts follow the filter | D-REV-27 | A header narrowed by the has-worktree chip counts only matching tasks; asserted over the real chip. |
| THRE-1122 (BI-35) | The TDD gate reads `phase.tdd-applicable` | D-REV-40 | In `gsd-core`, a plan with task-level `tdd="true"` trips the RED-before-GREEN gate when `workflow.tdd_mode` is false; upstream test. |
| THRE-1123 (BI-36) | A merge whose event write fails is not reported as nothing to merge | D-REV-58 (1) | A test fails the event write after a real merge and the next pass records the integrated event. |
| THRE-1124 (BI-37) | Plan approval re-checks its tasks are startable | D-REV-58 (2) | A core test moves a task to done between draft and approve and approve refuses it by name. |
| THRE-1125 (BI-38) | NFC and NFD spellings overlap | D-REV-58 (3) | `overlaps` treats a composed and a decomposed spelling of one name as the same file. |
| THRE-1126 (BI-39) | Separate the strict and lax readings of an unset `core.ignorecase` | D-REV-58 (4) | One test per consumer; the unset-flag default is stated for each. |
| THRE-1127 (BI-40) | Project registration runs `git config` after the database lock is released | D-REV-58 (5) | `no_desktop_command_runs_the_case_probe_under_the_database_lock`-style gate covers `project_register` and `project_relocate`. |
| BI-41 (not filed) | Document the first-run workaround and fix the release text | D-REV-62, D-REV-60 | The README and the release notes carry `xattr -cr /Applications/Flywheel.app` and what the dialog says; the register's "right-click Open" line is corrected. |
| THRE-1128 (BI-42) | Hidden projects can be listed and restored in the app | D-REV-64 | A Settings or rail list shows hidden projects and calls `projectRestore`; a jsdom test restores the duplicate `unreachable` registration. |
| THRE-1129 (BI-43) | Fleet subject-key jump opens the item in the installed build | D-REV-65 | On the installed app, pressing the key on a fleet row lands on the board with that item's detail open, observed through `scripts/release/ax-drive.js`. |
| THRE-1130 (BI-44) | A refused Approve is visible without scrolling | D-REV-36 | The message sits where the dialog's foot is; the held `it.fails` in `dispatch-layout.browser.test.tsx` is flipped to a pass. |
| THRE-1131 (BI-45) | Back from a session returns to the fleet with the row selected | D-REV-51 (a) | The held `it.fails` in `jump.test.tsx` becomes a pass. |
| THRE-1132 (BI-46) | A finished run with an empty log does not read "Starting session..." | D-REV-51 (b) | The held `it.fails` becomes a pass; the session says what happened. |
| THRE-1133 (BI-47) | The permission shim classifies read-only git commands | D-REV-35 | `git rev-parse` and `git -c k=v <sub>` raise no permission request; a shim test per form. |
| THRE-1134 (BI-48) | The reclaim command keeps `AppState` released across git calls | D-REV-55 | A desktop-crate test (tauri `test` feature) asserts the mutex is free during a reclaim; run detached, the cold build is about 13 minutes. |
| THRE-1135 (BI-49) | The update banner's dismissal survives a relaunch, per version | D-REV-66 | Decision D6 first; if yes, `dismissedUpdateVersion` persists and a relaunch test asserts it. |

**Filed 2026-10-14** (section 4). Three epics: E-A is THRE-1081, E-B is THRE-1118, E-C is THRE-1137. The first column shows the board key and, in
brackets, the payload reference used above. The payload actually filed is `11-21-board-payload.json`; it differs from the tables above, all after the
owner's answers:

- **BI-15 (developer turns in the brand) was not filed.** D3 decided it (D-203); there is nothing left to do.
- **BI-41 (document the first-run workaround) was not filed.** D5 decided it and it is done (D-205).
- **BI-49 (the banner's dismissal) was filed low priority (4) and gated** on the owner reversing D6 (D-206).
- **BI-50 was added**, the updater endpoint finding (D-REV-67), priority 1.
- BI-D1 to BI-D5 are the five design calls of D4 as decisions (D-204). BI-D6 (title scale) is a sixth, from the finish reviewer, not part of D4.
- The 22 unanswered owner questions are filed as question issues under E-C (THRE-1138 to THRE-1159), each saying it is unanswered and not passed.

Totals: 3 epics, 48 tasks (each with criteria), 28 issues (6 decisions, 22 questions); 94 criteria.


## 6. Owner answers (2026-10-14)

**Provenance.** The owner answered in a session with the orchestrator, who relayed his answers to this plan. What follows is that relay
and the reasons he gave, not a transcript of his own typing. Where a reason is quoted it is the relay's wording of his reason.

| # | Answer | Applied as |
|---|---|---|
| D1 | Accepted as recommended: narrow PLAN-04 to file-writing tools; a Bash write is detected after the fact and an observed breach holds the merge (plan 11-11). | **D-201.** `REQUIREMENTS.md` PLAN-04 (text, dated note, status row; ticked). |
| D2 | Accepted as recommended: SC3's "animates its height" becomes "reveals its rows with a wipe". | **D-202.** `ROADMAP.md` Phase 8.1 criterion 3: the text already read so (amended 2026-10-09); a dated ruling was added. The register's claim that SC3 was never amended is stale. |
| D3 | Accepted as recommended: ALLOW the developer's own turn in the feed. Reason: colour is the feed's only channel telling the two speakers apart. Do not move it to ink. | **D-203.** `08.1-UI-SPEC.md` § The brand rule item 8; `brand-rule.test.ts` widened (passes 4 of 4). |
| D4 | File all five to the board as decisions; they do not block the phase. Reason: layout judgements better made against a running app than a screenshot. Do not implement any. | **D-204.** THRE-1112 (review pane order), THRE-1113 (380px file column), THRE-1114 (masthead), THRE-1115 (lens toggle row), THRE-1116 (triage button wall). A sixth, THRE-1117 (detail title scale), came from the reviewer. |
| D5 | Document the `xattr -cr` workaround in the README and the release notes, consistent with both releases now being Pre-release. | **D-205.** README § Installing a release; `.github/release-install-note.md`; a workflow step; the release pages of `v0.1.0` and `v0.1.1` (prior bodies kept). |
| D6 | Keep the per-session banner dismissal; file low priority. | **D-206.** THRE-1135, priority 4, gated. |
| D7 | Script the filing through the board's own write verbs, after a `sqlite3 .backup`; explicit approval to write to the real database and accept the irreversible migration from schema 18 to 21. | **D-207.** Section 4. |

**Not answered. These stay `owner-question`. None is recorded as passed.** Each is a question issue on the board under THRE-1137.

| id | physical reason | board issue |
|---|---|---|
| `D-REV-05` | human aesthetic judgement | THRE-1138 |
| `D-REV-07` | ergonomic judgement | THRE-1139 |
| `D-REV-08` | aesthetic judgement of how it reads | THRE-1140 |
| `D-REV-09` | perceptual judgement of one 12px glyph | THRE-1141 |
| `D-REV-10` | aesthetic judgement | THRE-1142 |
| `D-REV-21` | aesthetic judgement of the icon margin in the Dock | THRE-1143 |
| `D-REV-23` | aesthetic judgement | THRE-1144 |
| `D-REV-24` | aesthetic judgement (SC0); the captures were shown, no verdict was given | THRE-1145 |
| `D-REV-33` | aesthetic judgement of "noticeable at a glance" | THRE-1146 |
| `D-REV-34` | a real login and a real model's obedience to the commit instruction | THRE-1147 |
| `D-REV-35` | a real login and a real model following the prompt | THRE-1148 |
| `D-REV-36` | aesthetic judgement, and Approve or Resume would start real runs in the owner's repository | THRE-1149 |
| `D-REV-47` | aesthetic judgement of "easy to scan" | THRE-1150 |
| `D-REV-48` | it needs a live sidecar writing a real log, which needs a real login; plus aesthetic judgement of the clipped line | THRE-1151 |
| `D-REV-49` | aesthetic judgement of the columns at row density | THRE-1152 |
| `D-REV-50` | real blocked agents need a live sidecar and a real login; plus the look of the owner marking | THRE-1153 |
| `D-REV-51` | aesthetic judgement of the key as a button | THRE-1154 |
| `D-REV-52` | the OS notification centre is outside the process and has no automation surface; needs a real agent event on the installed bundle | THRE-1155 |
| `D-REV-53` | the prompt is drawn and answered by the operating system and its state lives in System Settings | THRE-1156 |
| `D-REV-54` | the real worktree sizes need the owner's real HOME and data (the scratch HOME places the worktree root elsewhere) | THRE-1157 |
| `D-REV-55` | removing multi-second worktrees through the installed app deletes the owner's real directories and needs the owner's consent and data; plus aesthetic judgement | THRE-1158 |
| `D-REV-63` | aesthetic and comprehension judgement of one sentence | THRE-1159 |

As the owner's relay grouped them: SC0 (D-REV-24); the icon's Dock margin (D-REV-21); the per-plan threshold rows (D-REV-05, 07, 08, 09, 10, 23,
33, 36, 47, 49, 51, 54, 55, 63); the live-login and real-agent items (D-REV-34, 35, 36's live half, 48, 50); the OS-notification items (D-REV-52, 53);
and the real-data items (D-REV-54, 55). D-REV-54 and 55 are in both the threshold and the real-data groups.

**Whether DIST-02's criterion 2 is met, in one sentence:** the update was observed end to end by automation on a copy of the installed `0.1.0`
(section 2.2), not by the owner and not in place, and since both releases were marked Pre-release the updater URL answers 404 (D-REV-67), so it is
recorded as not met for a real user. **DIST-01 criterion 1 stays UNMET.**
