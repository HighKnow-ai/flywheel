---
phase: 05-socratic-epic-authoring
plan: 01
subsystem: research-spike
tags: [claude-code-cli, stream-json, mcp, pretooluse-hook, competitive-research, socratic-authoring]

requires:
  - phase: 04-clear-is-free
    provides: session_log.rs, the watchdog/heartbeat runtime protocol, and the mcp-permission-server.ts two-role pattern this plan's real-binary spikes drive against
provides:
  - A measured (not assumed) transport decision for the authoring conversation — option-a (--input-format stream-json, one long-lived process) — that plan 05-02 implements without re-deriving
  - A measured stage-gate enforcement point (the existing PreToolUse hook, extended with a second matcher) that plan 05-03 builds D-88's tool-absence-by-stage machine on directly
  - A dated Nimbalyst competitive re-scout confirming Socratic epic authoring is still an unclaimed differentiator
  - A written product-spike kill criterion (what is measured, the comparison arm, and the named consequence) to be judged after plan 05-02's tracer
affects: [05-02-*, 05-03-*, phase-05-verification]

actuals:
  tokens: 15486
  tasks: 3
  commits: 3
  plan_head_before: bc7155de565f46f60186446a0109893c3885ca2d

tech-stack:
  added: []
  patterns:
    - "Standalone throwaway Node ESM spike harnesses (no build step) that import compiled sidecar dist artifacts by absolute file:// URL for cross-checking argv/hook shape, mirroring the destructive-gate.test.mjs real-binary pattern"
    - "Sanitizing CLAUDE*/ANTHROPIC* env vars before every nested claude spawn — required whenever a harness itself runs inside an active Claude Code agent session, or the child silently attaches to the parent session"

key-files:
  created:
    - scripts/spike/authoring-transport-spike.mjs
    - scripts/spike/authoring-stage-gate-spike.mjs
    - .planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md
    - .planning/phases/05-socratic-epic-authoring/05-COMPETITIVE-RESCOUT.md
  modified: []

key-decisions:
  - "transport_decision: option-a — measured live against claude 2.1.267: all four turns answered in one long-lived --input-format stream-json process, zero byte-identical duplicate persisted lines, and the process survived a 20s idle window (past HEARTBEAT_STALE_MS=15000ms) with a production-cadence heartbeat writer running"
  - "stage_gate_matcher: intercepts / denial_outcome: recoverable — the existing PreToolUse hook mechanism, extended with a second mcp__<server>__propose_.* matcher entry, is a real enforcement point for a second MCP server's tool names; plan 05-03 builds on it directly rather than falling back to tool-handler-level gating"
  - "The hook's own stdin payload carries the FULLY QUALIFIED MCP tool name (mcp__<server>__<tool>), not the bare tool id — measured live, and load-bearing for any future PreToolUse matcher/marker code in this codebase"
  - "Nimbalyst re-scout verdict: Socratic epic authoring is still an unclaimed differentiator — zero epic/acceptance-criteria/Socratic surface shipped across three release cycles (0.75.5-0.78.0) in the re-scout window, though a generic user-configurable parent/child tracker-relationship field was found and is a genuine (if partial) narrowing worth tracking"

requirements-completed: [SHAPE-01, SHAPE-02]

coverage:
  - id: D1
    description: "Conversation transport for the authoring session measured against the real claude binary and recorded as a mechanical decision (option-a)"
    requirement: SHAPE-01
    verification:
      - kind: e2e
        ref: "scripts/spike/authoring-transport-spike.mjs --self-test"
        status: pass
      - kind: e2e
        ref: "scripts/spike/authoring-transport-spike.mjs --transport=a (real claude 2.1.267, 4/4 turns answered, 0 duplicates)"
        status: pass
      - kind: e2e
        ref: "scripts/spike/authoring-transport-spike.mjs --transport=b (real claude 2.1.267, 4/4 turns answered, 0 duplicates)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Stage-gate hook interception (A2) and denial recoverability (A3) measured against the real claude binary, including a negative control"
    requirement: SHAPE-01
    verification:
      - kind: e2e
        ref: "scripts/spike/authoring-stage-gate-spike.mjs --self-test"
        status: pass
      - kind: e2e
        ref: "scripts/spike/authoring-stage-gate-spike.mjs (real claude 2.1.267: hook fired and denied before the handler ran; session recovered; negative-control read tool executed normally)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Nimbalyst competitive re-scout and the product spike's written kill criterion"
    verification:
      - kind: other
        ref: ".planning/phases/05-socratic-epic-authoring/05-COMPETITIVE-RESCOUT.md (structural grep gates: non-empty, >=3 Nimbalyst mentions)"
        status: pass
      - kind: other
        ref: "05-SPIKE-FINDINGS.md ## Product Kill Criterion (3 required key lines present)"
        status: pass
    human_judgment: true
    rationale: "The structural presence of the document and its required fields is mechanically verified, but the quality of the competitive assessment itself (source selection, interpretation of the parent/child relationship-field finding, the verdict) is a judgment call a human should sanity-check before it is relied on for phase sequencing decisions."

duration: 55min
completed: 2026-09-23
status: complete
---

# Phase 5 Plan 01: Spike Findings Summary

**Measured (not assumed) that the authoring conversation can run as one long-lived `--input-format stream-json` process and that the existing `PreToolUse` hook genuinely intercepts a second MCP server's tool calls — closing both technical unknowns this phase's plan depended on, plus a dated Nimbalyst re-scout and a written product kill criterion.**

## Performance

- **Duration:** ~55 min (includes ~10 real `claude` binary invocations across debugging and final measurement runs)
- **Completed:** 2026-09-23
- **Tasks:** 3
- **Files created:** 4

## Accomplishments

- **A1 (transport) measured, not assumed.** `authoring-transport-spike.mjs` drove the fixed four-turn conversation through Option A (one long-lived `--input-format stream-json` process) and Option B (sequential one-shot `-p` turns) against the real installed `claude 2.1.267` binary. Both transports answered all four turns; Option A survived a 20-second idle window — comfortably past `runtime_protocol.rs`'s `HEARTBEAT_STALE_MS=15000ms` — with a production-cadence heartbeat writer (`uat_session_env --touch-heartbeat`) running, and showed zero byte-identical duplicate persisted lines (the observable shape of `anthropics/claude-code#5034`). `transport_decision: option-a` is now a recorded, mechanical fact in `05-SPIKE-FINDINGS.md`.
- **A2/A3 (stage gate) measured, not assumed.** `authoring-stage-gate-spike.mjs` stood up a throwaway second MCP server (`flywheel-authoring-spike`) with a no-op write-shaped tool and a negative-control read-shaped tool, extended the existing `PreToolUse` settings with a second `mcp__<server>__propose_.*` matcher, and ran one real session against `claude 2.1.267`. The hook fired and denied the write-shaped tool call BEFORE its handler ever ran (`stage_gate_matcher: intercepts`), the model recovered and kept going rather than the stream ending (`denial_outcome: recoverable`), and the negative-control tool executed normally with the hook never firing for it — the full three-part proof (positive interception, recoverable denial, negative control) plan 05-03 needs before building D-88's stage gate on this mechanism.
- **Nimbalyst re-scout closed.** `05-COMPETITIVE-RESCOUT.md` re-scouts `research/COMPETITION.md`'s 2026-09-08 assessment against live sources fetched 2026-09-23 (README, changelog releases 0.75.5–0.78.0, and three task-management docs pages). Verdict: Socratic epic authoring is still an unclaimed differentiator — zero epic/acceptance-criteria/Socratic surface shipped in the window — though the re-scout surfaced a genuine, previously-unnamed finding: Nimbalyst's agent edits/adds/moves/executes tracker items directly with no accept-gate documented anywhere, the structural opposite of this phase's D-80/D-96 human-gated staging model.
- **Product kill criterion written.** Appended to `05-SPIKE-FINDINGS.md`: what is measured (time-to-shaped-epic plus criteria-amendment count), the comparison arm (a timed terminal-plus-quick-add run), and the named consequence if the in-app flow loses (the `05-CONTEXT.md` dedicated-authoring-surface escape hatch — a layout change, not an abandonment). Explicitly judged after plan 05-02's tracer, not before.

## Task Commits

Each task was committed atomically:

1. **Task 1: Measure the conversation transport against the real binary** — `0547daf` (feat)
2. **Task 2: Measure the stage-gate mechanism** — `c5396e8` (feat)
3. **Task 3: The Nimbalyst re-scout, and the product spike's kill criterion** — `922093b` (docs)

_No plan-metadata-only commit follows — this plan's `commit_docs` setting is `true` and the final metadata commit (SUMMARY + STATE + ROADMAP) is created as the last step of this workflow._

## Files Created/Modified

- `scripts/spike/authoring-transport-spike.mjs` — measures A1; self-test never spawns a child; real-binary mode drives both transports and upserts `05-SPIKE-FINDINGS.md`
- `scripts/spike/authoring-stage-gate-spike.mjs` — measures A2/A3; self-test never spawns a child; real-binary mode stands up a throwaway MCP server + deny-always hook and upserts `05-SPIKE-FINDINGS.md`
- `.planning/phases/05-socratic-epic-authoring/05-SPIKE-FINDINGS.md` — the measured transport decision, stage-gate measurement, and product kill criterion
- `.planning/phases/05-socratic-epic-authoring/05-COMPETITIVE-RESCOUT.md` — the dated Nimbalyst re-scout, closing the standing `STATE.md` action

## Decisions Made

- **Option A over Option B for the authoring transport**, per the plan's own mechanical decision rule (all four turns answered AND zero duplicates) — measured, not assumed, closing `05-RESEARCH.md`'s Assumption A1 and Open Question 1.
- **Build the stage gate on the existing `PreToolUse` hook**, extended with a second matcher entry — measured to genuinely intercept a second MCP server's tool calls, closing Assumptions A2 and A3. Plan 05-03 does not need the tool-handler-level fallback `05-RESEARCH.md` flagged as a contingency.
- **Sanitize `CLAUDE*`/`ANTHROPIC*` env vars before every real-binary spawn in a harness that might itself run inside an active Claude Code session** — a genuine methodological finding from this task's own probing (a first unsanitized probe run silently attached a child `claude` process to the PARENT session via inherited `CLAUDE_CODE_SESSION_ID`, corrupting the session-identity measurement). Recorded in both spike scripts' own header comments so a future re-run does not have to rediscover it.
- **Duplicate-entry detection keys on the full raw persisted line, not `(type, message.id)` alone** — a live measurement produced 7 false positives before this fix, because a single assistant turn legitimately emits multiple stream-json lines (a `thinking` block, then a `text`/`tool_use` block) sharing one `message.id`. Regression-guarded in `--self-test`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Duplicate-entry detection false-positived on legitimate same-id/different-content stream-json lines**
- **Found during:** Task 1's own first real-binary measurement run (7 "duplicates" reported against a genuinely clean conversation)
- **Issue:** `countDuplicateEntries` keyed on `(type, message.id)` alone, which conflates a single assistant turn's legitimate multi-block streaming (a `thinking` line and a separate `text`/`tool_use` line sharing one `message.id`) with the actual `anthropics/claude-code#5034` bug (an already-persisted entry written again verbatim).
- **Fix:** Re-keyed on the full raw persisted line — byte-identical lines are duplicates; same-id-different-content lines are not.
- **Files modified:** `scripts/spike/authoring-transport-spike.mjs`
- **Verification:** Re-ran the real-binary measurement post-fix — 0 duplicates for both transports; added a regression self-test asserting the specific thinking+text same-id shape is NOT flagged.
- **Committed in:** `0547daf` (part of Task 1's own commit — found and fixed before the task's first commit)

**2. [Rule 1 - Bug] Stage-gate hook marker comparison used the bare tool id instead of the fully-qualified MCP tool name**
- **Found during:** Task 2's own first real-binary measurement run — the model's own transcript quoted the exact deny reason, proving the hook fired, while the measurement reported `hookFiredForPropose: false`
- **Issue:** The hook's own stdin payload carries `tool_name: "mcp__flywheel-authoring-spike__propose_task_spike"` (fully qualified), not the bare `propose_task_spike` id the marker-comparison code was checking against — a real, load-bearing fact about the hook's own wire shape, not a harness-only quirk.
- **Fix:** Compare the marker file against the fully-qualified tool name; documented the finding inline for any future `PreToolUse` matcher/marker code in this codebase.
- **Files modified:** `scripts/spike/authoring-stage-gate-spike.mjs`
- **Verification:** Re-ran the real-binary measurement post-fix — `stage_gate_matcher: intercepts`, matching the transcript's own evidence.
- **Committed in:** `c5396e8` (part of Task 2's own commit — found and fixed before the task's first commit)

**3. [Rule 1 - Bug] The spike findings document's measurement table and transport decision line were clobbered across independent transport runs**
- **Found during:** Immediately after running both `--transport=a` and `--transport=b` — the table showed only the most recently-run transport's row, and `transport_decision` was being recomputed from whichever transport happened to run last (a pure Option B success run would have silently overwritten a correct `option-a` decision with `option-a` again by coincidence, or with `option-b` had Option B failed).
- **Issue:** `writeFindings`'s table-upsert replaced the whole section rather than merging per-transport rows, and the decision line was computed from whichever measurement was passed in rather than specifically Option A's own.
- **Fix:** `mergeMeasurementTable` now reads existing `option-a`/`option-b` rows out of the current file and updates only the matching transport's row; `transport_decision` is now written ONLY when `measurement.transport === "option-a"`.
- **Files modified:** `scripts/spike/authoring-transport-spike.mjs`
- **Verification:** Re-ran both transports in sequence — both rows present, `transport_decision: option-a` correct and stable.
- **Committed in:** `0547daf`

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs found live during this plan's own measurement work, in code this plan itself wrote). **Impact:** All three are harness-correctness fixes discovered by the very "measure, don't assume" discipline this plan exists to enforce — none touch shipped product code (`packages/`), and all three fixes are regression-guarded in `--self-test` or re-verified against the real binary.

## Issues Encountered

None beyond the three deviations above, which were resolved within their own tasks.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Plan 05-02 can implement Option A's `startAuthoringSession` without re-opening the transport question — the message envelope, mandatory argv, and idle-tolerance are all measured facts in `05-SPIKE-FINDINGS.md`.
- Plan 05-03 can build D-88's stage gate directly on the existing `PreToolUse` hook mechanism, extended with a second matcher — no tool-handler-level fallback is needed.
- The product kill criterion is written and ready to be judged once plan 05-02's tracer produces one real shaping run.
- `SHAPE-01`/`SHAPE-02` remain `Gaps Found` in `REQUIREMENTS.md` pending sibling plans in this phase (the shared-ID gate correctly held both back — `requirements.ready-ids` reported both blocked, since other plans in this phase also declare them and have not yet produced their own `SUMMARY.md`).

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-23*

## Self-Check: PASSED

- All 4 created files found on disk.
- All 3 task commit hashes (`0547daf`, `c5396e8`, `922093b`) found in git history.
- Both spike scripts' `--self-test` exit 0 (no child process spawned).
- `05-SPIKE-FINDINGS.md` carries all 5 named measurement key lines plus the `## Product Kill Criterion` heading with its 3 required key lines.
- `05-COMPETITIVE-RESCOUT.md` exists, non-empty, mentions Nimbalyst well over the required 3 times.
- No file under `packages/` was modified by this plan.
