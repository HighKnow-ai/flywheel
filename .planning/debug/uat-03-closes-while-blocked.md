---
status: awaiting_human_verify
trigger: "UAT 3: session closes while a destructive request is outstanding"
created: 2026-10-01T00:00:00.000Z
updated: 2026-10-01T16:10:00.000Z
---

## Current Focus

bug_class: |
  Bohrbug in the INSTRUMENT, presenting as a Heisenbug in the report. The watchdog's deadline is
  deterministic (spawn + 15s + <=2s poll); the only varying quantity is how long the model's turn
  takes before uat-03 opens its window. So the ROW flickers while the DEFECT does not — which is
  why this reads as intermittent and must not be treated as one.

known_pattern_candidate: |
  `.planning/debug/resolved/uat-06b-bash-gate-regression.md` — same subsystem, same suite pass.
  Consumed, NOT assumed: its own Evidence entry of 2026-10-01T14:05 records UAT 6a closing on
  `watchdog-heartbeat-stale` at ~7s in exactly this unsupervised condition, and names the class
  ("a green row that cannot fail is an instrument problem"). That entry is what made the close
  origin here checkable for free. Its root cause (the hook's wrong-process PATH proof) is NOT the
  cause here and was eliminated below.

reasoning_checkpoint:
  hypothesis: |
    uat-03 asserts a property its own environment cannot sustain. The script never touches the
    heartbeat file, so `watchdog.ts` SIGKILLs the whole session group as an unsupervised orphan at
    spawn+15s..17s (D-47/D-48, PROC-04 — the watchdog doing its job). uat-03's
    `assertNoEvent(session_closed, 8_000)` window does not open until the deliberate
    `permission_request` has arrived, which requires a real model turn. The assertion can therefore
    only hold when the request arrives before spawn+7s; a turn measured at 2-11s means the window
    straddles the watchdog's deadline, and the close lands inside it.
  confirming_evidence:
    - "Artifact `permission-block-lifecycle-off-2026-10-01T04-02-59-058Z-permission-block-timeline.json`
       (the SAME unsupervised condition, per uat-06:166-168): `closeOrigin: watchdog-heartbeat-stale`,
       `killRecord.reason: heartbeat-stale`, and a `lifecycle` `stale_kill` entry with
       `heartbeat_age_ms: null` / `since_start_ms: 16014`."
    - "Same artifact, arithmetic over its OWN recorded timestamps: spawn 04:02:42.995 ->
       request t+8.962s -> watchdog kill t+16.046s. The kill lands 7.084s after the request, i.e. at
       88.5% of uat-03's 8000ms window. Inside it, with 916ms to spare."
    - "`grep -c heartbeat scripts/uat/uat-03-destructive-gate.mjs` = 0, against 25 in uat-06, 11 in
       uat-07, 18 in uat-08, 8 in uat-10 — the four live-session items that PASS."
  falsification_test: |
    The session file's own kill criteria: a `closeOrigin` of `backend-exit` or `supervisor-signal`,
    or a close landing far outside the 15-17s-from-spawn band, kills this. Measured: the origin is
    `watchdog-heartbeat-stale` and the close is at spawn+16.046s, dead centre of the band. Neither
    criterion is met. Forward-looking falsifier: the new offline arm in
    `scripts/uat/harness-supervision-gate.mjs --mode=supervised` — if a session whose heartbeat IS
    sustained still closes on `watchdog-heartbeat-stale` past the stale window, this hypothesis is
    wrong. Run, three times, at zero cost: it does not.
  fix_rationale: |
    Root cause, not symptom: the heartbeat writer is restored at the ONE seam all seven live-session
    call sites already route through (`Harness.sessionEnv`), so the omission cannot recur, and the
    assertion is left exactly as written. Nothing weakens uat-03's claim — the environment is made
    able to sustain it. The second half of the fix makes an item that CANNOT sustain its window fail
    deterministically on the arithmetic rather than racing, so the row can no longer go green by luck.
  blind_spots: |
    1. No live uat-03 run validates the fix end to end (cost constraint; the `uat-doomed-branch`
       remote fixture is also still deleted from the uat-06b session). What is proven offline is the
       watchdog's behaviour against a stub backend under both heartbeat modes, which IS the
       mechanism — not a live gated turn.
    2. The budget check assumes the stale window is measured from session spawn when the heartbeat
       file has never been written. Confirmed by `since_start_ms` in the artifact, but only for the
       never-touched case.
    3. uat-05 is fixed by the same default without being re-run; its failure is recorded as sharing
       the condition, not proven to be the same close origin (it writes no artifact either — gap 1).
  candidate_causes:
    - "environment: the UAT item runs an unsupervised session that the watchdog correctly reaps
       (CONFIRMED — this is the cause)"
    - "code: the product's destructive gate fails to hold a session blocked on an unanswered request
       (ELIMINATED — the close carries a watchdog kill record, not a gate failure)"
    - "config: the per-run `CLAUDE_CONFIG_DIR` change from commits 9569ed5/fb6c9bd/7c1af3e moved
       this failure (ELIMINATED — the failure predates them and the mechanism is unrelated)"
    - "data: the prompt or branch fixture misclassifies (ELIMINATED — Property B.1 passed; the gate
       asked with the right category)"
  and_gate: |
    NO. One defect (no heartbeat writer) plus one continuous variable (model-turn latency) decides
    pass/fail — not two simultaneous defects. `root_cause` therefore holds a single cause. This is
    worth stating because the immediately prior session on this subsystem DID fire the AND-gate, and
    carrying that expectation over would have invented a second cause that is not there.

hypothesis: |
  CONFIRMED (see reasoning_checkpoint). Instrument defect, not product defect.

test: |
  Static reading of the on-disk UAT artifacts, the seven `sessionEnv` call sites and the harness's
  own documented stale-window hazard, plus arithmetic over timestamps the artifact itself records.
  ZERO credentials spent. No live UAT item was run in any arm.

expecting: |
  Settled. Remaining work is the fix and its offline verification.

next_action: |
  CHECKPOINT (human-verify) returned. The fix is implemented, committed (cfdd2df) and verified
  offline at zero credential cost — the fix-acceptance guardrail is accepted (see
  Resolution.verification; two mutants at the fix site, both killed, and the offline reproduction
  lands within 155ms of the live artifact's measured reap). Nothing further is actionable by this
  agent without spending credentials.

  The one thing that needs a human: re-run `bash scripts/uat/run-all.sh`. The two new GATE rows cost
  nothing and run first; uat-03, uat-05, 6a, 6b, 7 spend credentials and uat-06b additionally needs
  the `uat-doomed-branch` remote fixture re-created (deleted by the uat-06b defect itself).

## Symptoms

expected: |
  `node scripts/uat/uat-03-destructive-gate.mjs` drives `git push origin --delete uat-doomed-branch`
  in a live auto-accept session. The destructive gate raises a `permission_request` carrying
  `destructiveCategory: "branch-deletion"` (Property B.1), and the session then STAYS BLOCKED with
  that request unanswered — `assertNoEvent(session_closed, 8_000)` at
  `scripts/uat/uat-03-destructive-gate.mjs:271-275` (Property B.2) — until the script denies it and
  observes the resulting `session_closed` (Property B.3).

actual: |
  Property B.1 PASSED — the gate did ask, with the right category. Property B.2 FAILED: a
  `session_closed` event arrived inside the 8000ms window while the destructive permission request
  was still unanswered.

  This is NOT the uat-06b defect. In uat-06b the gate never asked and the command executed
  (`SAFETY VIOLATED`). Here the gate asked correctly and the session died while waiting. Different
  property, different layer.

errors: |
  From the 2026-10-01 run-all.sh pass, truncated by the harness itself to 70 characters
  (`scripts/uat/run-all.sh:45` takes `substr($0,1,70)`):

    AssertionError [ERR_ASSERTION]: the session must not close while a des

  The full assertion message is `scripts/uat/uat-03-destructive-gate.mjs:274`:
  "the session must not close while a destructive permission request is unanswered".

  The close's `closeOrigin` was NOT captured — see Instrument Gaps below. Establishing which of
  `supervisor-signal`, `watchdog-heartbeat-stale` or `backend-exit` closed the session is the first
  thing to settle, because each implies a different cause.

reproduction: |
  node scripts/uat/uat-03-destructive-gate.mjs

  COSTS REAL CREDENTIALS (scripts/uat/README.md: "Costs real tokens, same as items 5 and 6").
  Static analysis first; the timing arithmetic below can be checked without spending anything.

started: |
  Failed in the 2026-10-01 full `run-all.sh` pass, alongside UAT 5 and UAT 6b. Whether it ever
  passed, and under which `claude` version, is not yet established — `03-SESSION-LIFECYCLE-FINDINGS.md`
  is the place to check.

  Note on ordering: this failure PREDATES the destructive-gate fix landed in commits 9569ed5,
  fb6c9bd, 7c1af3e (the uat-06b root cause — the hook now proves the shim leads the EXECUTING
  shell's PATH, and the adapter composes a per-run `CLAUDE_CONFIG_DIR` on both spawn paths). That
  fix should not affect this symptom, because Property B.1 already passed here — but the per-run
  `CLAUDE_CONFIG_DIR` change touches the spawn path, so confirm it has not moved this failure rather
  than assuming it.

## Leading Hypothesis To Confirm Or Kill First (timing arithmetic, free to check)

The watchdog kills the session as an unsupervised orphan, inside uat-03's own 8-second window.

Evidence already assembled, all static:

- `scripts/uat/uat-03-destructive-gate.mjs` touches the heartbeat NOWHERE. Zero matches for
  `heartbeat` in the whole file.
- `uat-06-permission-block-lifecycle.mjs:164-166` states this as a deliberate, documented fact:
  `--heartbeat=off` exists to reproduce "the unsupervised condition `uat-03-destructive-gate.mjs`
  runs under — nothing touches the heartbeat file".
- `scripts/uat/lib/sidecar-harness.mjs:756-757` says outright that any session expected to outlive
  the stale window MUST run a heartbeat writer on the production cadence. uat-03 does not.
- `packages/core/src/runtime_protocol.rs:42` — `HEARTBEAT_STALE_MS = 15_000`; poll is 2s
  (`uat-01-supervisor-kill.sh:145`).
- The UAT 6a artifact from the same pass
  (`permission-block-lifecycle-off-2026-10-01T04-02-59-058Z-permission-block-timeline.json`) closed
  with `closeOrigin: watchdog-heartbeat-stale` at `elapsedMs: 7088`. 6a is the SAME unsupervised
  condition as uat-03.

The arithmetic: the heartbeat is last touched at spawn. The watchdog therefore fires ~15-17s after
spawn. uat-03 opens its 8000ms `assertNoEvent` window only once the permission request has arrived,
which is several seconds into the session (a real model turn has to run first). If the request
arrives at t≈8s, the watchdog fires 7-9s into an 8-second window — a race that lands on either side
depending on how fast the model turn was. That would make this failure INTERMITTENT rather than a
clean regression, and would explain the 6a `elapsedMs: 7088` figure as the same event measured from
the request rather than from spawn.

If this is confirmed, the defect is in the instrument, not the product: uat-03 asserts a property
its own environment cannot sustain. The obvious fix is to give uat-03 the production-cadence
heartbeat writer uat-06 already has (`uat_session_env --touch-heartbeat`,
`uat-06-permission-block-lifecycle.mjs:149-162`) — but DO NOT jump to it before the close origin is
actually read, and consider whether the general property is "every UAT item whose session must
outlive the stale window runs a heartbeat writer" rather than patching this one script.

Kill criteria for this hypothesis: the close origin is `backend-exit` or `supervisor-signal`, or the
observed close lands far outside the 15-17s-from-spawn band.

Also worth checking, independent of the above:
- Whether `uat-07-launcher-shape-gate.mjs` (which PASSED in the same pass and drives the same
  destructive command) runs a heartbeat writer. If it does and uat-03 does not, that asymmetry is
  close to decisive on its own.
- Whether UAT 5's unrelated-looking failure ("the fan-out script never ran — no ev...") shares the
  unsupervised-session condition. Do not widen scope to fix it here; just record whether the cause
  is shared.

## Instrument Gaps Found While Writing This (likely findings in their own right)

1. `uat-03-destructive-gate.mjs` writes NO durable artifact — zero matches for `artifact`,
   `writeTimeline` or `preserveRoot`. uat-06 writes a full timeline JSON (event stream, run
   descriptor, kill record, close-provenance JSONL, `claude --version`, config-dir listing) and
   prints its path; uat-03 writes nothing. So a token-spending live failure here leaves behind no
   evidence, which is exactly what forced this session to reason from arithmetic instead of from a
   recorded `closeOrigin`. The project's own standard (`scripts/uat/README.md`) is that findings cite
   an artifact path, "never a recollection".
2. `run-all.sh:45` truncates each failure note to 70 characters (`substr($0,1,70)`), which is why the
   recorded error above ends mid-word at "a des". The per-item stdout that run-all.sh prints in full
   was not retained in the captured run log either.

Both gaps mean the NEXT live failure of this item is as unknowable as this one unless they are
closed. Treat closing them as part of the fix, not as separate nice-to-haves.

## Eliminated

- hypothesis: "The product's destructive gate fails to hold the session blocked on an unanswered
    permission request — a real Property B.2 defect."
  evidence: |
    Refuted by the close provenance in the artifact for the SAME unsupervised condition
    (`permission-block-lifecycle-off-2026-10-01T04-02-59-058Z-permission-block-timeline.json`):
    `closeOrigin: "watchdog-heartbeat-stale"`, with a corroborating `killRecord`
    (`reason: "heartbeat-stale"`, `killed_at: 2026-10-01T04:02:59.041Z`, pid 98277) and a
    `lifecycle` entry `{"event":"stale_kill","heartbeat_age_ms":null,"since_start_ms":16014}`.
    The session did not fall out of the block; it was SIGKILLed from outside by the supervision
    layer while still correctly holding it. `requestAt` is set and `decision: "deny"` — the gate had
    asked and was waiting, exactly as designed.
  timestamp: 2026-10-01T15:20:00.000Z

- hypothesis: "The uat-06b fix (commits 9569ed5, fb6c9bd, 7c1af3e — per-run `CLAUDE_CONFIG_DIR` on
    both spawn paths) moved this failure."
  evidence: |
    Three refutations. (a) The artifact this diagnosis rests on is from 04:02 UTC on 2026-10-01,
    before those commits, and already shows the identical mechanism. (b) Property B.1 PASSED in the
    failing run — the gate asked with `destructiveCategory: branch-deletion` — so nothing on the
    gate's deferral path is implicated. (c) The mechanism is `watchdog.ts`'s heartbeat-staleness
    poll reading `<appDataDir>` runtime state; `CLAUDE_CONFIG_DIR` is not an input to it
    (`packages/sidecar/src/watchdog.ts:155` reads only `FLYWHEEL_HEARTBEAT_STALE_MS`).
  timestamp: 2026-10-01T15:25:00.000Z

- hypothesis: "The close is `backend-exit` — the model finished its turn and the process exited
    normally while the request happened to be outstanding."
  evidence: |
    Directly contradicted: a `killRecord` file exists under `<runtime>/kills/<runId>.json`, which
    `watchdog.ts` writes ONLY on a stale kill. A clean backend exit writes none. The recorded
    `closeOrigin` is `watchdog-heartbeat-stale`, not `backend-exit`. This was the session file's own
    first kill criterion and it is not met.
  timestamp: 2026-10-01T15:22:00.000Z

- hypothesis: "`uat-03` differs from the passing items in the destructive command, the prompt, or the
    classifier path, so the cause is specific to this item's scenario."
  evidence: |
    `uat-07-launcher-shape-gate.mjs` drives the SAME `git push origin --delete uat-doomed-branch`
    against the same shim, the same hook and the same classifier, and PASSED in the same pass. The
    only material difference between them is lines 112-130 of uat-07 — a heartbeat writer uat-03
    does not have. The scenario is not the discriminator; the supervision condition is.
  timestamp: 2026-10-01T15:30:00.000Z

## Evidence

- timestamp: 2026-10-01T15:15:00.000Z
  checked: |
    `/var/folders/3x/b6p583x9491_v7qmnf087j580000gn/T/flywheel-uat-artifacts/permission-block-lifecycle-off-2026-10-01T04-02-59-058Z-permission-block-timeline.json`
    — read for close provenance, per the session file's first kill criterion. This is the only
    artifact on disk carrying a real `closeOrigin` for the unsupervised condition; uat-03 itself
    wrote none (Instrument Gap 1).
  found: |
    closeOrigin: "watchdog-heartbeat-stale"   (not backend-exit, not supervisor-signal)
    killRecord:  {reason: "heartbeat-stale", pid: 98277, killed_at: "2026-10-01T04:02:59.041Z"}
    lifecycle:   watchdog_started {stale_ms: 15000, poll_ms: 2000, stale_ms_source: "env"}
                 backend_spawned  {backend_pid: 98345} at 04:02:43.023
                 stale_kill       {heartbeat_age_ms: null, since_start_ms: 16014}
    requestAt set, decision "deny", claudeVersion "2.1.274 (Claude Code)".
  implication: |
    The leading hypothesis's kill criteria are NOT met — the hypothesis survives on its own terms.
    Two further facts fall out. `heartbeat_age_ms: null` proves the heartbeat file was never written
    even ONCE, so the watchdog falls back to `since_start_ms`: the deadline is measured from SPAWN,
    which makes the fire time deterministic rather than drifting. And `stale_ms_source: "env"`
    confirms the 15000ms window was the one actually in force in that process, not a default assumed
    from source.

- timestamp: 2026-10-01T15:18:00.000Z
  checked: |
    Arithmetic over the timestamps that SAME artifact records (no recollection, no estimate):
    `runDescriptor.started_at`, `requestAt`, `killRecord.killed_at`, `elapsedMs`.
  found: |
    spawn (started_at)            t+0        2026-10-01T04:02:42.995Z
    deliberate request arrived    t+8.962s
    watchdog stale_kill           t+16.014s  (since_start_ms: 16014)
    SIGKILL delivered             t+16.046s
    close observed by the harness t+16.050s  (requestAt + elapsedMs, elapsedMs = 7088)
    => the kill lands 7.084s AFTER the request, i.e. at 88.5% of uat-03's 8000ms window.
  implication: |
    The hypothesis's predicted 15-17s-from-spawn band is hit precisely (16.046s), and the close
    lands INSIDE uat-03's window with 916ms to spare. The assertion can only hold if the request
    arrives before spawn+7s; `destructive-gate.test.mjs` measures a real turn at 2-11s, so the
    window straddles the deadline. CONFIRMED, and the row's apparent intermittency is explained
    without positing any non-determinism in the product.

- timestamp: 2026-10-01T15:32:00.000Z
  checked: |
    The asymmetry the session file named as "close to decisive on its own":
    `grep -c heartbeat` over every UAT script, then `scripts/uat/uat-07-launcher-shape-gate.mjs:112-130`
    read in full.
  found: |
    Heartbeat mentions per item — 0: uat-03, uat-05, uat-09, uat-ui-setup. Nonzero: uat-06 (25),
    uat-08 (18), uat-07 (11), uat-10 (8), uat-01 (7).
    uat-07:112-130 runs the writer, and its own comment records WHY, from a live measurement:
    "measured live this run: without it, `watchdog-heartbeat-stale` kills the session mid-turn
    (Rule 3 — blocking issue)".
  implication: |
    Decisive. uat-07 drives the identical destructive command through the identical gate and passes;
    the one material difference is the heartbeat writer. Stronger still, uat-07's comment records a
    LIVE measurement of this exact failure mode being hit and worked around in that script alone —
    the knowledge existed in-repo and was applied per-script instead of once.

- timestamp: 2026-10-01T15:36:00.000Z
  checked: |
    `scripts/uat/uat-03-destructive-gate.mjs:143-275` — where the 8000ms window opens relative to
    spawn, and `scripts/uat/lib/sidecar-harness.mjs:750-770` (`startSidecar`'s STALE-WINDOW HAZARD
    doc comment).
  found: |
    uat-03 calls `harness.sessionEnv(runId, defaultBranch)` at :143, spawns at :161, waits up to
    TURN_DEADLINE_MS (120_000) for the tool call at :183, races request-vs-settle at :195, and only
    then reaches `assertNoEvent(session_closed, 8_000)` at :271. Nothing between :143 and :271
    touches the heartbeat.
    The harness's own doc comment states the rule: any caller "measuring a spawned session that
    outlives ... `DEFAULT_HEARTBEAT_STALE_MS` = 15000ms ... MUST run a heartbeat writer on the
    production cadence ... This function itself never touches the heartbeat file — that is the
    caller's responsibility, by design".
  implication: |
    The defect is a documented-but-unenforced contract. The harness states the requirement in prose
    and then leaves every caller to remember it; two of the seven callers did not. Prose is not a
    gate. This is where the general property has to be fixed, not in uat-03.

- timestamp: 2026-10-01T15:40:00.000Z
  checked: |
    All seven `harness.sessionEnv(` call sites, and the heartbeat-writer block at each.
  found: |
    uat-03:143  sessionEnv -> NO writer
    uat-05:124  sessionEnv -> NO writer
    uat-06:138  sessionEnv -> writer at :149-162, behind `if (heartbeatMode === "on")`
    uat-07:110  sessionEnv -> writer at :118-129
    uat-08:7240 sessionEnv -> writer at :7246-7252
    uat-08:8548 sessionEnv -> writer at :8585-8591
    uat-10:678  sessionEnv -> writer at :682-688
    All five writers are the SAME six lines (touch once, `setInterval(..., HEARTBEAT_TICK_MS)`,
    `onCleanup(clearInterval)`), each sitting immediately after its `sessionEnv` call.
  implication: |
    This is duplication-causes-omission in its textbook form, and it names the fix: the block is
    copy-pasted five times at a call site that is ALREADY common to all seven items. `sessionEnv` is
    the single seam every live-session item routes through, and it already hard-requires the same
    `uat_session_env` binary the writer needs (:627). Moving the writer there and defaulting it ON
    is a net DELETION that fixes both omissions and makes a sixth omission impossible.

- timestamp: 2026-10-01T15:44:00.000Z
  checked: |
    Directive 3 — whether UAT 5's failure shares the unsupervised condition.
    `scripts/uat/uat-05-concurrent-commits.mjs:124-160`.
  found: |
    uat-05 calls `sessionEnv` at :124, `startSidecar` at :129, spawns a real `claude` session at
    :133, then waits for `session_closed` with `TURN_DEADLINE_MS = 300_000` (five minutes) at :146.
    Zero heartbeat mentions in the file. Its reported failure note is its own assertion at :157,
    "the fan-out script never ran — no evidence file was written", which is precisely what a session
    SIGKILLed ~16s in looks like from the outside: `session_closed` arrives (satisfying the :146
    wait), and the agent never got far enough to write `.uat-git-path`.
  implication: |
    UAT 5 shares the condition and is fixed by the same general change, with no edit to uat-05 at
    all. NOT widened into this session's scope and NOT claimed as proven: uat-05 also writes no
    artifact (Instrument Gap 1 again), so its close origin is unrecorded. Recorded here so the next
    pass can confirm it from the artifact the fix now makes uat-05 write.

- timestamp: 2026-10-01T15:48:00.000Z
  checked: |
    Vacuity audit of the proposed fix, against the uat-06b session's precedent that "a green row
    that can never go red is an instrument defect in its own right".
  found: |
    Restoring the heartbeat writer alone would make uat-03 green WITHOUT making the row able to go
    red for the right reason. Any future item (or either of the two deliberate opt-outs, uat-01 and
    uat-06 `--heartbeat=off`) can still assert a window that does not fit the watchdog's remaining
    budget, and will then pass or fail on model-turn latency. On a fast turn the row goes green while
    the assertion was never actually guaranteed.
  implication: |
    The general property needs BOTH halves, exactly as directive 4 states. Half 1: every live-session
    item sustains the heartbeat by default. Half 2: an item whose assertion window does not fit the
    remaining watchdog budget fails DETERMINISTICALLY on the arithmetic, before it sleeps — so the
    race is removed rather than usually won. Half 2 is what prevents the next round.

## Resolution

root_cause: |
  INSTRUMENT DEFECT, single cause (the AND-gate did not fire — see reasoning_checkpoint).

  `scripts/uat/uat-03-destructive-gate.mjs` never touches the heartbeat file, so `watchdog.ts`
  SIGKILLs its whole session process group as an unsupervised orphan at spawn+15s..17s — correctly,
  by design (D-47/D-48, PROC-04). uat-03's `assertNoEvent(session_closed, 8_000)` at :271 does not
  open until the deliberate `permission_request` has arrived, which requires a real model turn, so
  the window straddles the watchdog's deadline. Measured in the artifact for the identical
  unsupervised condition: request at spawn+8.962s, kill at spawn+16.046s — 7.084s into an 8000ms
  window, with 916ms to spare. The product behaved correctly throughout: the gate asked (Property
  B.1 passed) and was still holding the block when the session was killed from outside.

  The ROOT of the root cause, and what the fix actually addresses: the requirement was documented
  rather than enforced. `startSidecar`'s doc comment stated that any caller outliving the stale
  window MUST run a heartbeat writer, and then left it to each caller. Five of the seven
  `harness.sessionEnv` callers copy-pasted the same six-line writer; uat-03 and uat-05 did not.
  Duplication-causes-omission at a call site that was already common to all seven.

fix: |
  D-105, landed at the ONE seam all seven live-session items already route through, so the general
  property is closed rather than the uat-03 instance. uat-03 and uat-05 are fixed with ZERO edits to
  either file; the UAT items are a net -50 lines.

  Part 1 — THE DEFAULT IS NOW THE SAFE ONE (`scripts/uat/lib/sidecar-harness.mjs`).
    `Harness.sessionEnv(runId, defaultBranch, { heartbeat = "sustain" })` runs the
    production-cadence writer itself (touch once before spawn, then `HEARTBEAT_TICK_MS`, cleared via
    `onCleanup`). The hazardous condition must now be ASKED for — `{ heartbeat: "off" }` — and only
    the two items whose subject is the watchdog firing do so (`uat-01-supervisor-kill.sh`,
    `uat-06 --heartbeat=off`). The five hand-rolled writers are DELETED (uat-06, uat-07, uat-08 x2,
    uat-10), along with two now-redundant `uat_session_env` build guards and three dangling imports.
    `startSidecar`'s doc comment is corrected: it previously asserted the delegation that broke.

  Part 2 — `assertNoEvent` REFUSES TO RACE (same file).
    Before sleeping, it checks `windowMs` against `Harness.watchdogBudgetRemainingMs()` (finite only
    for a session that opted out) and fails immediately with a named `INSTRUMENT DEFECT` if the
    window cannot fit — telling the reader to fix the environment and explicitly NOT to shorten the
    window. This is the half that prevents the next round: without it a mis-specified item fails and
    blames the product on a slow turn and PASSES on a fast one, which is a green row that could not
    have gone red for the right reason — the UAT 6a vacuity class. The check is arithmetic, so it
    fires on every run rather than the unlucky ones. `SidecarClient` takes an optional third
    constructor arg for this; a bare client skips the check and behaves as before.

  Part 3 — INSTRUMENT GAP 1 CLOSED GENERALLY (same file).
    Every session resolved through `sessionEnv` registers a `*-session-timeline.json` artifact,
    written on teardown whether the item passes or fails: event stream, run descriptor, kill record,
    lifecycle JSONL, `closeOrigin`, `closedAfterStartMs`, `claude --version`. uat-03 wrote nothing
    before; so did uat-05, uat-07 and uat-10. One write site, four items covered.

  Part 4 — INSTRUMENT GAP 2 CLOSED (`scripts/uat/run-all.sh`).
    The `substr($0,1,70)` truncation is GONE (measured: the same note now carries 184 characters
    including the `closeOrigin`, versus the 70 that cut off at "a des"). Every item's full output is
    retained to `$FLYWHEEL_UAT_ARTIFACT_DIR/run-all-<stamp>-<slug>.log`, and a FAIL row prints that
    path. `INSTRUMENT` joins the note's match set so Part 2's refusal surfaces as itself.

  Part 5 — THE RECURRENCE GUARD (`scripts/uat/harness-supervision-gate.mjs`, NEW).
    Asserts the general property for zero tokens against the `lib/long-lived-backend.mjs` stub, and
    `run-all.sh` runs BOTH arms FIRST — before any item spends a credential, because a harness that
    has stopped supervising makes every verdict below it meaningless.

  Part 6 — `scripts/uat/README.md` + uat-06's header.
    A "Supervision" section stating the contract, the measurement and the never-shorten-the-window
    rule. uat-06's header claim that `--heartbeat=off` "reproduces the unsupervised condition
    uat-03-destructive-gate.mjs runs under" was TRUE and is now false; corrected in place rather
    than left to rot, since that sentence is what made this diagnosis free.

verification: |
  guardrail_verdict: accepted

  ZERO credentials spent. No live UAT item was run in any arm. No destructive git command touched
  any remote; the deleted `uat-doomed-branch` fixture was not recreated or touched.

  signal_1_regression_suite: PASS
    - `packages/sidecar`: `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude FLYWHEEL_RUNTIME_DIR=$(mktemp -d)
      FLYWHEEL_HEARTBEAT_STALE_MS=120000 node --test test/*.test.mjs`
      -> `tests 220 / pass 214 / fail 0 / skipped 6`, the same baseline the uat-06b session recorded.
      The 6 skipped are the credential-spending real-binary tests, skipped visibly by name.
    - Every zero-cost arm of every item I touched: `uat-08 --self-test` PASS, `uat-08 --replay-check`
      PASS (the arm whose heartbeat block was deleted — real sidecar + fake backend, and it now
      leaves a session timeline artifact too), `uat-10 --self-test` PASS, `uat-10 --offline` PASS
      (all five Phase 6 criteria reported as before).
    - `node --check` on every `scripts/uat/*.mjs` and `bash -n scripts/uat/run-all.sh`: clean. No
      dangling imports (checked symbol-by-symbol after each deletion).

  signal_2_build_typecheck: PASS — `cargo build -p core --bin uat_session_env` and
    `npm --prefix packages/sidecar run build` (tsc) both clean. No product code was changed.

  signal_3_mutation_at_fix_site: PASS — two mutants injected at the fix site, both KILLED:
    (a) `if (heartbeat === "sustain")` -> `if (false)` — the exact pre-fix behaviour, where
        `sessionEnv` never touches the heartbeat. The supervised arm FAILED with
        `closeOrigin: "watchdog-heartbeat-stale"`, `exitSignal: "SIGKILL"` — i.e. it reproduced
        uat-03's live symptom verbatim.
    (b) `{ heartbeat = "sustain" }` -> `{ heartbeat = "off" }` — the default flipped back to the
        implicit pre-fix one. The supervised arm FAILED, and load-bearing detail: it was killed by
        Part 2's budget check in 1ms rather than by a lost race after a 14s sleep. That is the direct
        measurement that Part 2 does what it claims — it converts a race into deterministic
        arithmetic. Under (b) the unsupervised arm still PASSED, because it opts out explicitly.
    The harness was restored from a byte copy after each mutant and the diff re-confirmed.

  signal_4_revert_shows_the_bug_returns: PASS — and in its STRONG form, unlike the uat-06b session's
    partial. Mutant (a) IS the revert of Part 1, and under it the offline gate reproduces the
    original failure at zero cost. The reproduction is quantitatively faithful to the live artifact:
      live run (real backend, credentials spent):  reaped at spawn+16046ms, watchdog-heartbeat-stale
      offline gate (stub backend, zero tokens):    reaped at spawn+16071ms / +16168ms / +16201ms
    Three independent offline runs land within 155ms of the measured live value, which also
    independently corroborates the timing arithmetic this diagnosis rests on.

  signal_5_fix_addresses_the_root_cause_not_a_symptom: PASS. No assertion was weakened, shortened or
    deleted — uat-03:271 is byte-identical and both broken items have an empty diff. The fix landed
    at the single seam all callers route through, not in the two files the failures named. The
    documented-but-unenforced contract is replaced by a mechanism plus a gate; the five duplicated
    writers that caused the omission are deleted.

  oracle_type: derived (contract) — the oracle is the supervision contract `startSidecar`'s own doc
    comment always stated, now asserted over the harness rather than trusted to each caller.
    Boundary neighbours asserted around the equivalence class rather than one value: the sustained
    window deliberately extends PAST the deadline (spawn+20000ms against a 15000ms window), the
    unsupervised reap is bounded on BOTH sides (`>= staleMs` and `<= staleMs + 10s`, so a watchdog
    firing far too early cannot read as the property holding), and the budget refusal asserts BOTH
    the message and that it took <1000ms (a refusal that merely threw would be indistinguishable
    from sleeping the whole window and then failing — the behaviour being replaced).

  not_proven:
    - No live `uat-03` run validates the fix end to end. The cost constraint forbids it and the
      `uat-doomed-branch` remote fixture is still deleted from the uat-06b session. What is proven is
      the watchdog's behaviour under both supervision conditions through the real sidecar, real
      adapter, real watchdog wrapper, real process group and real runtime protocol, with only the
      backend leaf stubbed — nothing about supervision depends on which binary sits at that leaf.
    - uat-05's failure is recorded as sharing the condition (it spawns a live session, waits
      `TURN_DEADLINE_MS = 300_000` for `session_closed`, and has zero heartbeat mentions) but its
      close origin is unrecorded, because it wrote no artifact either. The fix makes it write one;
      the next pass can confirm from that file rather than from this inference. NOT widened into
      this session's scope, per directive 3.
    - Whether the watchdog's deadline is measured from spawn in cases where the heartbeat file HAS
      been written at least once. Irrelevant to the two conditions this fix creates, but the budget
      arithmetic assumes the never-written case the artifact measured (`heartbeat_age_ms: null`).

  observed_not_fixed:
    - `scripts/uat/README.md`'s Item 3 section still says Property B "DOES NOT HOLD. No
      `permission_request` is ever raised and the session never blocks", and that "this script
      therefore fails on Property B by design". The 2026-10-01 run contradicts it: Property B.1
      PASSED with `destructiveCategory: branch-deletion`, so B became reachable (G-03-3's two-phase
      flow, which uat-03's own :232-240 comment describes). Left alone deliberately — re-verdicting
      Property B is a product measurement this session did not make, and it needs a live run. Flagged
      so the row is not read against a stale verdict.

files_changed:
  - scripts/uat/lib/sidecar-harness.mjs: "Parts 1-3 — sessionEnv sustains the heartbeat by default via #superviseSession; heartbeatStaleMs/claudeVersionString/watchdogBudgetRemainingMs/#writeSessionTimeline; assertNoEvent refuses a window that cannot fit the watchdog budget; SidecarClient takes an optional harness ref; startSidecar's STALE-WINDOW HAZARD comment corrected where it asserted the delegation that broke"
  - scripts/uat/harness-supervision-gate.mjs: "NEW — the zero-token recurrence guard; asserts S1 (the default is safe), S2 (the opt-out is still reaped on time) and S3 (an unfittable window is refused on arithmetic, not slept through) against the long-lived stub backend"
  - scripts/uat/run-all.sh: "Part 4 — the 70-character substr truncation removed, per-item full output retained to a named log, FAIL rows print the log path, INSTRUMENT added to the note match set; both gate arms run FIRST, before anything spends credentials"
  - scripts/uat/uat-06-permission-block-lifecycle.mjs: "the --heartbeat flag now expresses the supervision condition through sessionEnv; hand-rolled writer deleted; header's now-false claim about uat-03's condition corrected; two dead imports dropped"
  - scripts/uat/uat-07-launcher-shape-gate.mjs: "hand-rolled writer deleted, its live measurement preserved as the reason the writer is now shared; three dead imports dropped"
  - scripts/uat/uat-08-socratic-authoring.mjs: "both hand-rolled writers deleted; a redundant uat_session_env build guard dropped; one dead import dropped"
  - scripts/uat/uat-10-agent-backlog.mjs: "hand-rolled writer deleted; a redundant uat_session_env build guard dropped; one dead import dropped"
  - scripts/uat/README.md: "Part 6 — the Supervision section: the contract, the measurement, the never-shorten-the-window rule, the two gate rows"
  - scripts/uat/uat-03-destructive-gate.mjs: "UNCHANGED — fixed entirely by the harness default. Recorded here deliberately: the assertion that failed was correct and is byte-identical."
  - scripts/uat/uat-05-concurrent-commits.mjs: "UNCHANGED — same."
