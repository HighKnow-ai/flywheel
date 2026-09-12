---
phase: 02-one-agent-one-worktree-watched-live
verified: 2026-09-12T11:40:00Z
status: passed
score: 6/6 truths supported by evidence (5 roadmap success criteria + 1 project-constraint truth); 0 failed; 0 present-behavior-unverified; 0 open human-verification items (down from 1 at the last pass, 2 two passes ago, and 5 in the pre-UAT report)
covered_files:
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/WINDOWS.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-01-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-02-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-03-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-04-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-05-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-06-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-07-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-08-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-09-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-10-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-11-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-11-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-12-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-12-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-13-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-13-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-14-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-14-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-15-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-15-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-16-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-16-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-17-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-17-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-18-PLAN.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-18-SUMMARY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-SECURITY.md
  - .planning/phases/02-one-agent-one-worktree-watched-live/02-UAT.md
  - packages/core/src/domain/agent_run.rs
  - packages/core/tests/agent_run_stop_ordering.rs
  - packages/core/tests/app_exit_ordering.rs
  - packages/core/tests/runtime_context_call_sites.rs
  - packages/core/tests/session_close_lifecycle.rs
  - packages/core/tests/session_closed_call_site.rs
  - packages/core/tests/task_delete_with_run_history.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/sidecar.rs
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/sidecar/src/adapter.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/src/index.ts
  - packages/sidecar/test/real-claude-argv.test.mjs
  - packages/sidecar/test/shutdown.test.mjs
  - packages/sidecar/test/stub-invocation.test.mjs
covered_digest: "v1:sha256:7a47cc09cbc5a571ca653a73eaff94051ed6ef05694cd8cdea9919628747079d"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: "6/6 truths supported by evidence (5 roadmap success criteria + 1 project-constraint truth); 0 failed; 1 narrower human-verification item remained open"
  gaps_closed:
    - "The single remaining human-verification item — whether a Stop preserves an agent's specifically UNCOMMITTED work, not just an intact branch and no orphan process — is now closed by a third, successful attempt. Independently re-verified this pass directly against the live worktree and database, not trusted from any narrative: `git -C .../THRE-58 status --short` returns ` M README.md`; `git -C .../THRE-58 diff -- README.md` shows an uncommitted `+stop-test` line; `agent_runs` records THRE-58's run as `interrupted` with `ended_at = 2026-09-12T00:34:36.064558+00:00`, matching the expected kill time exactly; `pgrep -fl 'flywheel-permissions'` finds no match (no orphaned process). The process-group kill demonstrably does not reach the working tree. T-02-12 (high, 02-SECURITY.md) and WINDOWS.md row 3 are both closed with this evidence; row 7 (the allow-always permission-rule round trip, closed in the prior pass) is also now flipped to `status: fixed` in the ledger, matching its own already-updated narrative."
  gaps_remaining: []
  regressions: []
observed_since_last_verification:
  - "THIS PASS (2026-09-12): independently re-ran every command the instruction supplied, not trusted from WINDOWS.md's, 02-SECURITY.md's, or 02-UAT.md's own narrative. `git -C /Users/cymarechal/Flywheel/THRE/THRE-58 status --short` -> ` M README.md`. `git -C .../THRE-58 diff -- README.md` -> uncommitted `+stop-test` line appended after the existing test-command block. `sqlite3 flywheel.db` on `agent_runs` joined to `tasks` -> THRE-58's run `interrupted`, `started_at 2026-09-12T00:33:31.202604+00:00`, `ended_at 2026-09-12T00:34:36.064558+00:00` — matching the expected 00:34:36Z exactly. `pgrep -fl 'flywheel-permissions'` -> no match, exit code 1."
  - "THIS PASS: full `agent_runs` table inspected (not just the last 3 rows) — 5 runs total, 2 `completed` (THRE-38: cost_usd 1.183256/tokens_in 1011934/tokens_out 7615; THRE-33: cost_usd 0.8583115/tokens_in 531449/tokens_out 5811) and 3 `interrupted` (THRE-53, THRE-43, THRE-58, each with populated cost/token columns), 0 stuck at `running`. G-02-4's fix (close_agent_run gaining a production caller) is holding across five independent real runs spanning two days, not just the single run that first demonstrated it at UAT."
  - "THIS PASS: all five live worktrees' dirty state re-checked directly (`git status --short` in each) — THRE-33, THRE-38, THRE-43, THRE-53 report 0 dirty entries (consistent with prior passes: THRE-43's edit was committed, `1a59dbe`); THRE-58 alone reports ` M README.md`, the uncommitted edit the third attempt was designed to produce."
  - "THIS PASS: `.planning/WINDOWS.md` re-read directly — both row 3 and row 7 now carry `status: fixed` with matching `resolved_at` timestamps (`2026-09-12T00:35:37.853Z` and `2026-09-12T00:29:05.383Z` respectively), and the ledger header now reads `open_count: 5, fixed_count: 2, total_count: 7` — internally consistent with the two rows' own status fields. Confirmed via `git show` that the single commit (`b467830`) which flipped row 3 to `fixed` also updated `02-SECURITY.md`'s T-02-12 entry to `RESOLVED` in the same commit, so the ledger and the threat register did not drift apart."
  - "THIS PASS: `.planning/phases/.../02-SECURITY.md` re-read directly — T-02-12 now reads `RESOLVED 2026-09-12T00:34Z — now verified by observed behaviour`, with the same THRE-58 evidence as WINDOWS.md row 3. `threats_open: 0` unchanged. The main threat-register summary line (`84 threats · 82 closed · 2 open`) still refers to T-02-37 (medium, Phase-3-deferred) and one other pre-existing open item — T-02-12 was never counted in that 2-open figure (its disposition was `closed` in the register from audit time; the separate 'code-reading only' table tracked *evidence quality*, not disposition), so no inconsistency there."
  - "THIS PASS: a discrepancy found and worth recording — `.planning/phases/.../02-UAT.md` test 4's own body (the `not_corroborated:` field) was NOT updated to reflect the third attempt; only its frontmatter `updated:` timestamp changed (confirmed via `git show b467830 -- .../02-UAT.md`, a 2-line diff touching only that timestamp). The claim that '02-UAT.md test 4 carries a FULLY RESOLVED block' does not hold literally — that language lives in WINDOWS.md row 3 and 02-SECURITY.md's T-02-12 entry, not in 02-UAT.md itself. This is a documentation-hygiene gap in 02-UAT.md, not a substantive one: the underlying claim was independently verified directly against the live worktree and database by this pass, not taken from any of the three files' narrative. Recorded as an advisory, not a gap, because presence-of-evidence was confirmed at the primary source (git + sqlite) rather than through the stale document."
  - "No source file was touched between the prior pass and this one (`git log` shows only phase-02 doc/ledger commits since; `git status --short` on the main repo shows only unrelated untracked directories — `.flywheel/`, `.gsd/`, `.planning/milestone.lock`, a new `10.1-*` phase directory — none touching this phase's covered files). The full-suite results carried forward from two passes ago (cargo 222/222, sidecar 39/39, desktop 314/314, clean TS build) were not re-run this pass; they would produce no new evidence."
  - ".planning/REQUIREMENTS.md's per-requirement status table (lines ~217-271) still shows the inverse of the actual, code-verified state for this phase (DATA-04/WORK-01/WORK-02/WORK-08/LINK-01/AGNT-03/AGNT-04/AGNT-06 marked 'Gaps Found' while DATA-06/PROC-01/PROC-06/PROC-07/AGNT-01/AGNT-02 are marked 'Complete') — flagged across three passes now and still unreconciled. Directly re-confirmed this pass by reading the table. Doc-hygiene only; not evidence of a code regression; does not block `passed`."
gaps: []
deferred: []
human_verification: []
---

# Phase 2: One Agent, One Worktree, Watched Live — Verification Report (Re-Verification, post-UAT, post-security-audit, post-third-human-observation)

**Phase Goal:** Cyril presses Start Work on a board task and watches a Claude Code session do that
task inside a git worktree that belongs to the task rather than to the session.

**Verified:** 2026-09-12T11:40:00Z
**Status:** passed
**Re-verification:** Yes — this updates a report written 2026-09-12T10:15:00Z (itself updating
reports written 2026-09-11T19:05:00Z and 2026-09-11T13:55:00Z), in light of a third, successful
human attempt at the one item the last two reports held open.

**Mode note:** unchanged from prior reports — ROADMAP.md marks this phase `mode: mvp`, but its
`**Goal:**` line is not in `As a … I want to … so that …` user-story format, so this report
continues the standard goal-backward methodology against the roadmap's five numbered Success
Criteria.

## What changed since the last report (this update)

The 2026-09-12T10:15:00Z report held `human_needed` on exactly one item: whether a Stop preserves an
agent's specifically **uncommitted** work, not just an intact branch and no orphan process. Two prior
attempts (02-UAT.md test 4, and a same-day re-run) both ended with the agent's edit already committed
before the kill landed, so the narrower claim stayed genuinely unexercised.

**A third attempt closed it, and this pass re-verifies the closure independently rather than trusting
WINDOWS.md's, 02-SECURITY.md's, or the instruction's own narrative:**

- `git -C /Users/cymarechal/Flywheel/THRE/THRE-58 status --short` → ` M README.md` (uncommitted).
- `git -C /Users/cymarechal/Flywheel/THRE/THRE-58 diff -- README.md` → an uncommitted `+stop-test`
  line appended after the existing test-command block — never committed.
- `sqlite3 flywheel.db` on `agent_runs` joined to `tasks` → THRE-58's run status `interrupted`,
  `started_at 2026-09-12T00:33:31.202604+00:00`, `ended_at 2026-09-12T00:34:36.064558+00:00` —
  matching the expected kill time (00:34:36Z) exactly, with populated `cost_usd`/`tokens_in`/
  `tokens_out` (not the "stuck running forever" defect G-02-4 fixed).
- `pgrep -fl 'flywheel-permissions'` → no match. No orphaned process.

This directly exercises the previously-unexercised claim: an uncommitted edit was on disk, Stop was
pressed, and the edit is still there, unmodified, with no process surviving. `.planning/WINDOWS.md`
row 3 and `.planning/phases/.../02-SECURITY.md`'s T-02-12 entry were both updated in the same commit
(`b467830`) to reflect this, and row 3's `status` field was flipped from `open` to `fixed` — closing
the doc-hygiene gap the prior report also flagged (row 7 was likewise flipped to `fixed`, closing
that hygiene gap too). One new, minor hygiene gap surfaced this pass: `02-UAT.md` test 4's own body
was not updated to match — only its frontmatter timestamp changed. This does not weaken the
substantive finding, since the finding was independently re-derived from git and the database
directly, not from any of the three narrative documents. See `observed_since_last_verification`
above and the Advisory section below.

With this item closed, the human-verification section is now empty. Per this agent's own routing
rule, an empty human-verification section together with zero failed truths and zero blockers means
the correct status is `passed`.

## Goal Achievement

### Independently Re-Run Evidence (this pass — worktree and database state, not trusted from any narrative)

| Check | Command | Result |
|---|---|---|
| THRE-58 worktree dirty state | `git -C .../THRE-58 status --short` | ` M README.md` |
| THRE-58 uncommitted diff | `git -C .../THRE-58 diff -- README.md` | Uncommitted `+stop-test` line present, not committed |
| THRE-58 run record | `select r.status, r.started_at, r.ended_at, t.key from agent_runs r join tasks t ... order by started_at desc limit 3` | `interrupted`, `2026-09-12T00:33:31...` → `2026-09-12T00:34:36.064558+00:00`, `THRE-58` |
| No orphaned process | `pgrep -fl 'flywheel-permissions'` | No match (exit 1) |
| Full `agent_runs` table | `select status, count(*) from agent_runs group by status` | 2 `completed`, 3 `interrupted`, 0 `running` |
| All five live worktrees' dirty state | `git status --short` in each of THRE-33/38/43/53/58 | 0 dirty in the first four; ` M README.md` in THRE-58 only |
| WINDOWS.md rows 3 and 7 | direct read | Both `status: fixed`, matching `resolved_at` timestamps, ledger header (`open_count: 5, fixed_count: 2`) internally consistent |
| 02-SECURITY.md T-02-12 | direct read | `RESOLVED 2026-09-12T00:34Z — now verified by observed behaviour`, same THRE-58 evidence |
| 02-UAT.md test 4 body vs. commit diff | `git show b467830 -- .../02-UAT.md` | Only the frontmatter `updated:` timestamp changed; the test's own `not_corroborated:` narrative is stale (advisory, not a gap — see below) |
| Source changes since prior pass | `git log --oneline -8`, `git status --short` | Only phase-02 doc/ledger commits; no source file touched |
| REQUIREMENTS.md status-table inversion | direct read of lines ~217-271 | Still inverted (DATA-04/WORK-01/WORK-02/WORK-08/LINK-01/AGNT-03/AGNT-04/AGNT-06 = "Gaps Found"; DATA-06/PROC-01/PROC-06/PROC-07/AGNT-01/AGNT-02 = "Complete") — unreconciled across three passes |
| `## Threat Flags` sections | `grep -n "^## Threat Flags" *-SUMMARY.md \| wc -l` | 0 — absence remains unrecorded, not "none found" |

### Independently Re-Run Evidence (prior passes, carried forward — not repeated this pass, no source changed)

| Check | Command | Result |
|---|---|---|
| Rust workspace suite | `cargo test --workspace` | **222 passed, 0 failed** across every crate/test binary |
| Sidecar (Node) suite | `npm --prefix packages/sidecar test` | **39 passed, 0 failed** |
| Desktop (TS/React) suite | `npm --prefix packages/desktop test` | **314 passed, 0 failed** across 29 test files |
| Desktop TypeScript build | `npm --prefix packages/desktop run build` | `tsc && vite build` exits 0, no `error TS` diagnostics |
| Permission-rule event trail | `select event_type, count(*) from events where event_type like '%rule%' group by event_type` | `permission_rule.granted` 1, `permission_rule.revoked` 1 |
| Permission requests | `select tool_name, status from permission_requests` | 5 rows including one `allowed_always` decision |

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Worktree appears on a branch derived from the task identifier, chained to the epic integration branch, visible from a bare terminal | ✓ VERIFIED | Unaffected by any gap-closure round. `cargo test --workspace` includes `branch_naming`/`worktree_lifecycle` — both pass against real scratch git repos. |
| 2 | User watches the agent's output stream live for a long session with flat memory | ✓ VERIFIED (qualified — short session only) | G-02-3's silent-panic/overlap defect is closed and gated. UAT test 1 ran a real streaming session to natural completion (~2.5 min, 126 lines, 211 KB) and measured application RSS (APP+RENDER+SIDECAR) DECLINE by 64 MB from its early peak while the log grew monotonically. UAT's own qualification, preserved here: "PASSED ON A SHORT SESSION... The truth is SUPPORTED, not stress-tested. A multi-hour session remains the stronger evidence." |
| 3 | Agent pauses on a permission request, user answers from the board, agent resumes | ✓ VERIFIED | UAT test 2 exercised the full pause/answer/resume path through a real spawned `claude` process. The allow-always rule variant (grant, list, revoke) is independently confirmed in production: `permission_rule.granted`/`.revoked` both 1, `permission_requests` at 5 including an `allowed_always` decision. |
| 4 | User stops a session, worktree stays intact/inspectable, and a second session reuses it — the worktree outlives the session | ✓ VERIFIED | The stop-stranding defect (CR-04) and app-exit orphan defect (CR-02) are closed and gated. UAT test 4 corroborated "worktree intact, no orphan process." **This pass closes the previously-open narrower claim**: THRE-58's worktree carries an uncommitted ` M README.md` (a real `+stop-test` diff, never committed) after a real Stop drove the run to `interrupted` at 00:34:36; no orphaned process. The process-group kill demonstrably does not reach the working tree, committed or not. |
| 5 | Worktree, agent run and session are distinct linked records on the task; local-credential and API-key paths behave identically | ✓ VERIFIED (qualified) | The "distinct linked records" half and its previously-unguarded edge case (CR-01, task deletion with agent-run history) remain solidly proven. UAT test 3 measured the non-leak half independently (0 credential-shaped matches across 191 persisted JSONL lines; 0 of 11 argv elements credential-shaped); the PARITY claim rests on the tester's own observation, not independent reproduction. Whether `ANTHROPIC_API_KEY` reliably *overrides* a present subscription session remains unmeasured here (no spend-authorized key) and is explicitly recorded as a Phase 3 input, not a Phase 2 gap. |

**Score:** 5/5 roadmap success criteria supported by evidence; 0 failed. Two of the five (#2, #5)
carry explicit, load-bearing qualifications preserved above rather than smoothed into a clean pass.
#3 and #4 each had a narrower sub-claim genuinely unexercised as of two passes ago — both are now
closed by direct evidence.

### Additional Project-Constraint Truth (not one of the 5 numbered Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | CLAUDE.md hard architectural constraint: "killing orphans... at the OS-process-tree level" — no `claude` process should survive Flywheel quitting | ✓ VERIFIED | Unchanged mechanism (`shutdown_all_sessions()` before `kill()`, `shutdown.test.mjs` 4/4 against real spawned grandchildren), corroborated live twice now: UAT test 4's `pgrep` found no match, and this pass's independent `pgrep -fl 'flywheel-permissions'` re-check after THRE-58's Stop also found no match. |

**Combined score (6 truths):** 6/6 supported by evidence; 0 failed; 0 `PRESENT_BEHAVIOR_UNVERIFIED`;
0 open human-verification items. **Status: passed.**

### Required Artifacts

All artifacts from the original 10 plans and the two gap-closure/security-remediation rounds
(`02-01`..`02-18`) were VERIFIED in the prior pass and were not re-audited file-by-file this pass —
no source file changed between the last pass and this one. See the prior pass's Required Artifacts
table (archived in this file's git history) for the full per-artifact evidence; the relevant items
for this pass's closed item are:

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/tests/agent_run_stop_ordering.rs` | Stop path never issues git commands against the worktree | ✓ VERIFIED (now also observed) | Structurally proven by the test; this pass's THRE-58 evidence is the first real-world observation confirming the structural guarantee holds against a genuinely dirty tree. |
| `packages/desktop/src-tauri/src/sidecar.rs` (stop/kill path) | Process-group kill only, no filesystem/git mutation | ✓ VERIFIED (now also observed) | Read directly in the prior pass; this pass's live evidence (uncommitted diff intact after Stop) is the behavioral confirmation. |

### Key Link Verification

Unchanged from the prior pass — no source file changed. All links previously confirmed WIRED remain
so (`sidecar.rs` reader loop → `handle_inbound_session_closed` → `apply_session_closed`; readiness
handshake; stderr → `SessionClosedEvent.detail`; `RunEvent::Exit` → shutdown-then-kill; permission
grant/revoke round trip). The permission-rule round trip and the stop-preserves-uncommitted-work
claim are now BOTH independently observed in production, closing the last two links that had only
structural (code-level) evidence.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DATA-04 | Generic trigger record, `user_action` implemented | ✓ SATISFIED | Unchanged. |
| DATA-06 | Worktrees/runs/sessions as first-class records | ✓ SATISFIED | Unchanged; `apply_session_closed` correctly writes terminal state, now confirmed across 5 real runs. |
| WORK-01/02/08, LINK-01 | Worktree creation, branch topology, persistence, naming | ✓ SATISFIED | Unchanged. |
| PROC-01 | Each session a separate OS process in its own worktree | ✓ SATISFIED | Unchanged; startup-liveness boundary proven (G-02-1). |
| PROC-02 | Supervisor never reads its own cwd | ✓ SATISFIED | Unchanged. |
| PROC-06 | Interrupt/stop leaves the worktree consistent | ✓ SATISFIED | **Closed this pass.** Mechanism proven; branch-integrity half independently corroborated in the prior pass; the uncommitted-work half is now independently corroborated this pass (THRE-58). No open sub-claim remains. |
| PROC-07 | Live streaming without unbounded memory growth | ✓ SATISFIED (qualified — short session) | G-02-3 closed; UAT test 1 measured a real short session (~2.5 min, 211 KB); long-session stress observation not yet performed. Preserved as a qualification, not treated as a gap. |
| AGNT-01, AGNT-02 | Single adapter interface; normalises stream-json | ✓ SATISFIED | The argv the adapter builds is proven against the REAL CLI, not just an internal fake. |
| AGNT-03, AGNT-04 | Local credentials / explicit API key | ✓ SATISFIED (qualified) | Non-leak independently measured; parity observed but not independently reproduced; precedence-override unmeasurable here, explicit Phase 3 input. |
| AGNT-06 | Permission requests block until answered | ✓ SATISFIED | Pause/answer/resume core proven end-to-end at UAT; the allow-always rule grant/revoke half is independently confirmed live. |

No orphaned requirements — all 15 IDs mapped to this phase are declared in at least one plan's
frontmatter (`02-01` through `02-18`).

**Advisory (documentation hygiene, carried forward unresolved, third pass):**
`.planning/REQUIREMENTS.md`'s per-requirement status table still shows the inverse of the actual,
code-verified state for this phase. Not evidence of a code regression — should be reconciled by the
orchestrator.

**Advisory (ledger hygiene — now resolved):** `.planning/WINDOWS.md` rows 3 and 7 both now carry
`status: fixed` with matching `resolved_at` timestamps, consistent with their own narrative text and
with this report's independent verification. This closes the ledger-hygiene gap the prior two passes
flagged.

**Advisory (new this pass — 02-UAT.md staleness):** `02-UAT.md` test 4's own `not_corroborated:` body
text was not updated to reflect the third, successful attempt — only its frontmatter `updated:`
timestamp changed (confirmed via `git show b467830`, a 2-line diff). WINDOWS.md row 3 and
02-SECURITY.md's T-02-12 entry were both updated correctly in the same commit and independently
match this pass's own direct git/sqlite evidence, so this does not weaken the substantive finding —
but a reader consulting only `02-UAT.md` would see a stale "unevidenced" narrative for test 4.
Orchestrator should append a closing note to `02-UAT.md` test 4 for consistency.

**Advisory (security audit hygiene, carried forward):** No `## Threat Flags` section exists in any
of the 18 `*-SUMMARY.md` files for this phase. Treat the absence of threat flags across this phase's
plans as **unrecorded**, not as **none found**.

**Advisory (evidentiary provenance, worth stating explicitly per this pass's instruction):** T-02-12
(high severity) and the five permission-rule mitigations (T-02-04, T-02-24 high, T-02-27, T-02-45,
T-02-47) were verified by code reading only for most of this phase's life and became independently
observed in production only in the final two passes of verification. This is the same pattern that
let G-02-4 (a function with no production caller) ship undetected through 220/220 green tests — code
correctness in isolation is not proof of a wired, executed path. The phase's eventual `passed` status
rests partly on late-arriving behavioral evidence, not on the automated suite alone; this should
inform how much a clean test suite is trusted going forward.

### Anti-Patterns Found

No debt markers (`TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`) found in any file this or the prior
rounds touched. No new stub patterns found. No source file was touched between the prior pass and
this one, so this scan was not re-run — it would produce no new evidence. The `ℹ️ Info`-level items
from earlier passes (stale `deferred-items.md`/WINDOWS.md row 4 wording, the pre-existing
`FLYWHEEL_WORKTREE_ROOT` test race at WINDOWS.md row 2, and the Phase-3-deferred
`WorktreeSummary.tsx` disk-existence gap at row 6) are unrelated to this round's changes and carried
forward unchanged — all remain `open` in WINDOWS.md, all non-blocking.

### Behavioral Spot-Checks

Not re-run this pass for the full suite — no source file changed. This pass's checks were the
targeted database/worktree inspection above (git status/diff on THRE-58, `agent_runs` query,
`pgrep`), which is the correct instrument for the one item being re-assessed.

### Probe Execution

No `scripts/*/tests/probe-*.sh` conventions or phase-declared probes found for this phase. Skipped.

### Human Verification Required

None. The one item carried from the prior two passes — whether Stop preserves an agent's
specifically uncommitted work — is now closed by direct, independently-reproduced evidence (see
above). No new human-verification items were identified this pass.

### Gaps Summary

**No gaps remain.** All five defects found by human UAT (G-02-1 through G-02-5) are independently
re-confirmed closed against the code on disk and the previously-passing, independently-re-run test
suites. The security audit closed with `threats_open: 0`. The one item that kept this phase at
`human_needed` across two prior passes — whether a Stop preserves an agent's uncommitted work — is
now closed by a third human attempt, independently re-verified this pass directly against the live
worktree (`git status`/`diff` on THRE-58) and the database (`agent_runs`), not trusted from any
narrative document.

**Status is `passed`:** every roadmap Success Criterion has supporting evidence, the additional
project-constraint truth (no orphaned processes) is verified, zero truths failed, zero
present-behavior-unverified truths remain, and the human-verification section is empty. Per the
routing rule this agent follows, that combination is exactly what `passed` requires.

**Qualifications preserved, not smoothed over, per this pass's explicit instruction:**
- PROC-07 (truth #2) passed on a SHORT session only (~2.5 min, 211 KB). Supported, not
  stress-tested — a multi-hour session remains the stronger evidence and should be re-run
  opportunistically.
- `.planning/REQUIREMENTS.md`'s per-requirement status table inversion, flagged across three passes
  now, remains unreconciled. Doc-hygiene only.
- No `*-SUMMARY.md` in this phase carries a `## Threat Flags` section — absence of flags means
  **unrecorded**, not **none found**.
- T-02-12 and the five permission-rule mitigations were verified by code reading only for most of
  this phase's life and only became independently observed at the very end — the same
  code-correct-but-never-executed pattern that let G-02-4 ship. Worth remembering when trusting a
  green suite on future phases.
- New this pass: `02-UAT.md` test 4's own narrative text was never updated to match its resolution
  (only its frontmatter timestamp changed) — a minor doc-hygiene gap, orchestrator should close it,
  but it does not affect this phase's `passed` status since the underlying claim was independently
  re-derived from primary sources (git + sqlite) rather than from that document.

---

_Verified: 2026-09-12T11:40:00Z_
_Verifier: Claude (gsd-verifier)_
