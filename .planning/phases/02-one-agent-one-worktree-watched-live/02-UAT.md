---
status: testing
phase: 02-one-agent-one-worktree-watched-live
source: [02-VERIFICATION.md]
started: 2026-09-11T05:52:53.211Z
updated: 2026-09-11T10:08:03Z
---

## Current Test

number: 2
name: Permission pause and resume through a real claude process (AGNT-06)
expected: |
  The real claude process blocks on the MCP tool call and resumes correctly once answered.
awaiting: user response

## Tests

### 1. Flat memory over a long real streaming session (PROC-07)
expected: RSS stays flat while the persisted log keeps growing on disk.
how: Start a long-running real session on a real task, leave it streaming for several minutes, and watch RSS in Activity Monitor while the transcript grows on disk.
why_human: Real-process memory behavior over minutes cannot be observed by static analysis; explicitly manual-only per 02-VALIDATION.md. The CR-03 silent-drop defect that previously blocked this truth is now closed and tested — only the flat-RSS observation remains.
result: pass
reported: "Flat memory seems ok on a short session"
evidence: |
  Run 01M27YR97ZZ01RHVREKNWH96ST, ~2.5 min, natural completion.
  Application-side RSS (APP + RENDER + SIDECAR — the three processes PROC-07 is actually about):
    t=20s   402.4 MB      log 0 KB / 0 lines
    t=51s   444.8 MB      log 66 KB / 39 lines     <- peak, startup/JIT warm-up
    t=143s  382.8 MB      log 199 KB / 123 lines
    t=163s  381.1 MB      log 211 KB / 126 lines
  Memory DECLINED 64 MB from its early peak while the log grew monotonically to 211 KB.
  Nothing tracked the transcript. The windowed-read design held.
qualification: |
  PASSED ON A SHORT SESSION, and the user said as much. 126 lines / 211 KB over ~2.5 minutes is
  well short of the megabyte-scale transcript the instrument's own guidance says is needed to make
  the ratio meaningful. The truth is SUPPORTED, not stress-tested. A multi-hour session remains the
  stronger evidence; re-run opportunistically rather than treating this as settled forever.
instrument_limitation: |
  The watcher's TOTAL_MB column sums in AGENT_MB — the spawned `claude` child (539-620 MB here) —
  which is a separate process whose memory is its own business, not the application's. Its verdict
  logic used that total, so it would have been skewed by the agent process starting and exiting
  rather than by anything PROC-07 asserts. Corrected after this run: the verdict now measures
  application RSS only and reports the agent separately. The reading above was taken from the
  per-process columns, which were always correct.
also_verified: |
  This run incidentally supplied the live confirmation for G-02-4, which no automated test could
  give: the session reached natural completion and the board recorded
  status=completed, ended_at set, cost_usd=1.183256, tokens_in=1011934, tokens_out=7615 — where
  before, a run that ended on its own stayed `running` forever with all four columns empty. The
  owning task THRE-38 remained `in_progress`, so D-29 held. tokens_in of ~1.01M also vindicates the
  planner's measured decision to sum the three input-side usage fields; `input_tokens` alone would
  have recorded a near-zero number for this run.
prior_attempts: |
  Attempt 1 (2026-09-11) — blocked by G-02-1: "failed to write request to the sidecar's stdin".
  Attempt 2 (2026-09-11) — blocked by G-02-2: session closed instantly, one event at seq 0.
  Attempt 3 (2026-09-11) — reached a live session, but the agent had an empty worktree (OBS-01,
  an operator environment issue since repaired) and the feed was unreadable (G-02-3). Interrupted.
  Attempt 4 (2026-09-11) — the app aborted at startup: G-02-5, a regression introduced by
  G-02-1's own fix. Resolved before the attempt was retried.
note: The memory behaviour has still never been observed. Three attempts were stopped by defects, not by the truth being false — it is UNTESTED, not disproved. This is the first attempt against fully closed gaps.

### 2. Permission pause and resume through a real claude process (AGNT-06)
expected: The real claude process blocks on the MCP tool call and resumes correctly once answered.
how: Press Start Work on a task whose work needs a permission decision; confirm the board surfaces the request, the agent is genuinely blocked, and answering resumes the same turn rather than restarting it.
why_human: Crosses the renderer and a real spawned claude process. Note the recorded caveat — Claude Code's own bash safety heuristic was empirically found to bypass a configured --permission-prompt-tool for commands it judges read-only, even in --permission-mode default, which bears directly on whether this holds for all tool calls.
result: [pending]

### 3. Credential parity between local session and explicit API key (AGNT-03 / AGNT-04)
expected: No behavioral difference between the two credential paths; the key is present only in the child's environment.
how: Run the same task once under local Claude Code credentials and once with an explicit API key configured in Settings; confirm identical product behavior and that the key never appears in `ps` or the persisted session JSONL.
why_human: Requires two real credential configurations on one machine. Whether ANTHROPIC_API_KEY reliably overrides a present subscription session could not be measured in this environment (no spend-authorized key) and is recorded as a Phase 3 input.
result: [pending]

### 4. Bare-terminal stop walkthrough in the packaged app (WINDOWS.md row 3)
expected: Worktree intact and dirty exactly as the agent left it; no orphaned process under it.
how: Start a real session, press Stop, then from a bare terminal confirm the worktree directory and its uncommitted changes are intact and no claude (or descendant) process is still running.
why_human: Open unrun-verify item, .planning/WINDOWS.md row 3 — deferred to end-of-phase UAT per workflow.human_verify_mode=end-of-phase. The underlying process-group-kill mechanism is proven by real multi-process tests; the packaged-app path has not been observed by a human.
result: [pending]

### 5. Settings surface walkthrough (WINDOWS.md row 7)
expected: All three entry points open the same Settings surface; the saved key is never re-rendered; a granted rule appears with its project and can be revoked.
how: Open Settings from the app menu, from ⌘, and from the command palette; save an API key and confirm it cannot be read back; grant an allow-always rule from a real permission request and confirm it appears in the table and can be revoked.
why_human: Open unrun-verify item, .planning/WINDOWS.md row 7 — deferred to end-of-phase UAT.
result: [pending]

## Summary

total: 5
passed: 1
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps

- gap_id: G-02-1
  truth: "A user can start work on a task and watch a real claude session stream live"
  status: resolved
  resolved_by: 02-15-PLAN.md
  resolved_at: 2026-09-11
  reason: "User reported: worktree and branch were created (flywheel/thre-23-cache-the-rank-allocator-6 → flywheel/epic/thre-11-project-registration at /Users/cymarechal/Flywheel/THRE/THRE-23), then Start Work failed with 'failed to write request to the sidecar's stdin'"
  severity: blocker
  test: 1
  root_cause: "The dev-time sidecar stub resolves the real entrypoint relative to its OWN location (SCRIPT_DIR/../../../sidecar/dist/index.js), which is only correct while it sits at packages/desktop/src-tauri/binaries/. tauri-plugin-shell executes the copy Tauri places beside the app executable at target/debug/flywheel-sidecar, where ../../../ escapes the repository root and resolves to <repo-parent>/sidecar/dist/index.js. Node exits 1 with MODULE_NOT_FOUND, the sidecar process is dead before any request is sent, and the first spawn write hits a closed stdin. Reproduced directly: `./target/debug/flywheel-sidecar </dev/null` fails with Cannot find module '/Users/cymarechal/orca/workspaces/HighKnow-harness/sidecar/dist/index.js'."
  secondary_cause: "spawn_sidecar() treats tauri-plugin-shell's .spawn() returning Ok as proof the sidecar is alive. The stub process starts and then exits 1 immediately, so startup does not abort as the module docstring intends ('failing to resolve or spawn the sidecar aborts startup rather than proceeding with a half-working app') — the failure is deferred to the first Start Work, far from its cause."
  artifacts:
    - path: "packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin"
      issue: "Entrypoint path is resolved relative to the stub's own directory, which differs between its source location and the Tauri-copied location beside the executable"
    - path: "packages/desktop/src-tauri/src/sidecar.rs:536"
      issue: "spawn_sidecar does not verify the sidecar is still alive after spawn, so an immediately-exiting sidecar surfaces only at first use"
  missing:
    - "Resolve packages/sidecar/dist/index.js in a way that holds from both the stub's source location and target/<profile>/ (walk up for the packages/sidecar/dist marker, or have build.rs emit an absolute path)"
    - "Add a liveness/readiness check after spawn_sidecar so a sidecar that exits immediately aborts startup at its cause, per sidecar.rs's own stated contract"
    - "Cover the Tauri-copied invocation path in tests — existing sidecar tests exercise packages/sidecar/dist directly and never run the stub as the app runs it"
  debug_session: ""
  interim_patch: |
    UNCOMMITTED working-tree patch applied during UAT so testing could continue — it closes the
    first `missing` item ONLY. packages/desktop/src-tauri/binaries/flywheel-sidecar-aarch64-apple-darwin
    now walks up from its own directory for the packages/sidecar/dist/index.js marker instead of a
    fixed ../../../ hop, which resolves correctly from both its source location and the
    Tauri-copied target/<profile>/ location. The same file was copied over target/debug/flywheel-sidecar
    so a plain app restart picks it up without a cargo rebuild. Verified: the stub now boots the
    sidecar and exits 0 on stdin close, where it previously exited 1 with MODULE_NOT_FOUND.
    STILL OPEN for gap closure — the spawn liveness check (missing item 2) and test coverage of
    the Tauri-copied invocation path (missing item 3). This patch is deliberately NOT committed:
    the commit belongs to the gap-closure plan's ledger, not to verify-work.

- gap_id: G-02-2
  truth: "Start Work spawns a real claude process that streams stream-json events into the session surface"
  status: resolved
  resolved_by: 02-17-PLAN.md
  resolved_at: 2026-09-11
  reason: "User reported: session surface showed Failed, 0:00, no token counts, and the persisted log contained exactly one line — session_closed with reason failed at seq 0, meaning no stdout line was ever read from the child"
  severity: blocker
  test: 1
  root_cause: "buildClaudeArgv omits --verbose. Claude Code rejects `-p` combined with `--output-format stream-json` at argument validation — 'When using --print, --output-format=stream-json requires --verbose' — exits 1 having emitted nothing on stdout, and writes the reason to stderr. Reproduced against claude 2.1.236 in the real worktree: the adapter's exact argv exits 1 without the flag and streams stream-json correctly with it."
  secondary_cause: "The adapter never reads the child's stderr. `spawn()` is called with default stdio, so stderr is an undrained pipe and the CLI's own explanation of why it refused to start is discarded. `session_closed` carries only the word 'failed', so every spawn failure — bad argv, missing binary, auth failure — presents identically and undiagnosably in the UI. This is what turned a one-word CLI error into a blind debugging session, and it will do so again for the next failure."
  tertiary_cause: "The unit test asserted buildClaudeArgv's output as an exact array literal, so it locked in the broken argv rather than catching it. Nothing in the suite ever ran the real claude binary — test/fake-claude.mjs accepts any arguments — so an argv the real CLI always rejects passed 29 green tests."
  artifacts:
    - path: "packages/sidecar/src/claude-code-adapter.ts"
      issue: "buildClaudeArgv builds an argv the real CLI rejects; startSession spawns without reading stderr"
    - path: "packages/sidecar/test/adapter.test.mjs"
      issue: "Asserted the broken argv as ground truth; the fake CLI validates no arguments, so argv correctness was never tested against reality"
  missing:
    - "Add --verbose to buildClaudeArgv wherever stream-json is used under --print (PATCHED, see interim_patch)"
    - "Capture the child's stderr and surface it — route it to system_notice events and carry a detail field on session_closed, so a failed spawn says why"
    - "Add a test that runs the REAL claude binary with the built argv (skipped when the binary is absent), so an argv the CLI rejects cannot pass the suite again"
  debug_session: ""
  interim_patch: |
    UNCOMMITTED working-tree patch applied during UAT so testing could continue — it closes the
    first `missing` item ONLY. packages/sidecar/src/claude-code-adapter.ts now emits --verbose
    alongside --output-format stream-json, and the sidecar was rebuilt (npm --prefix
    packages/sidecar run build). packages/sidecar/test/adapter.test.mjs was updated to match and
    gained a constraint-shaped regression guard asserting the stream-json/--verbose pairing across
    every permission mode and both call shapes, so the pairing survives argv reordering. Full
    sidecar suite re-run: 29 passed, 0 failed.
    STILL OPEN for gap closure — stderr capture (missing item 2) and a real-binary argv test
    (missing item 3). Not committed: the commit belongs to the gap-closure plan's ledger.
  observation: |
    Under --verbose the CLI also emits SessionStart hook_started/hook_response system events.
    normaliseStreamEvent maps unknown system subtypes to type "unknown" carrying the raw line, so
    nothing is dropped and no invariant breaks, but the session feed will show a run of "unknown"
    rows before the first assistant text. Cosmetic, not a data-loss defect — noted so it is not
    re-reported as a new bug during the re-run.

- gap_id: G-02-3
  truth: "A user can read the live session feed while an agent streams events into it"
  status: resolved
  resolved_by: 02-16-PLAN.md
  resolved_at: 2026-09-11
  reason: "User reported: 'The design is terrible' with a screenshot of the session surface rendering every feed row on top of the ones below it — dozens of superimposed text layers, entirely unreadable"
  severity: major
  test: 1
  root_cause: "SessionSurface's virtualizer positions each row absolutely at translateY(virtualRow.start) where start comes from feedRowEstimateSize, which returns a CONSTANT per row kind (FEED_ROW_HEIGHT, or FEED_TOOL_ROW_EXPANDED_HEIGHT for an expanded tool call) and is deliberately never corrected by measureElement. But the row wrapper sets no height and no overflow clamp, and FeedRow's body rows render with overflowWrap anywhere and no maxHeight. Any row whose real content exceeds the estimate therefore paints over every row positioned after it. With multi-kilobyte raw JSON payloads the overflow is many multiples of the row height, which is the superimposed mess in the screenshot."
  analysis: |
    02-UI-SPEC.md's "Performance Contract Additions" — a fixed row height per kind, never derived
    from content length, never measured — is a sound virtualization contract. It was implemented
    as a POSITION contract without being enforced as a RENDER contract. The estimate decides where
    a row starts; nothing makes the row actually occupy that height. The two only agree for short
    content, which is all the tests and the fake CLI ever produced.
    The clamping pattern already exists in this very file: FeedRow.tsx:88 uses
    overflow hidden + textOverflow ellipsis + whiteSpace nowrap for one span. It was simply not
    applied to the body rows at FeedRow.tsx:129 and :150.
  amplified_by: |
    HONEST NOTE: the --verbose flag added for G-02-2 made this dramatically worse but did not
    cause it. --verbose makes the CLI emit SessionStart hook events, which normaliseStreamEvent
    maps to type "unknown" carrying the full raw line; 32 of this session's 51 events were
    "unknown". The overflow bug is independent of that flag and would surface on any long
    assistant message or tool result.
  artifacts:
    - path: "packages/desktop/src/session/SessionSurface.tsx:670-687"
      issue: "Absolutely-positioned virtual row wrapper sets width but no height and no overflow clamp, so a row is free to paint outside the slot the virtualizer reserved for it"
    - path: "packages/desktop/src/session/FeedRow.tsx:129,150"
      issue: "Body rows render unbounded content with no maxHeight or overflow, unlike the clamped span at line 88"
  missing:
    - "Clamp each virtual row to the height the virtualizer reserved for it — height + overflow hidden on the absolute wrapper — so the render contract matches the position contract"
    - "Apply the existing line-88 truncation pattern to the body rows so a long payload shows one ellipsised line, with the full text reachable through the already-built expand affordance or View raw"
    - "Add a test that feeds a multi-kilobyte event through the feed and asserts row N+1's top is not overlapped by row N — the current tests never produce content longer than one line, which is why this passed"
  debug_session: ""

- gap_id: G-02-4
  truth: "The board is the store of record — a finished agent run is recorded on the board as finished, with its cost and token usage"
  status: resolved
  resolved_by: 02-18-PLAN.md
  resolved_at: 2026-09-11
  reason: "Two agent_runs rows (01M27H2H55SJ7BMMC1Z0M1WQRV, 01M27HA6NQ6D2GH0QWRX7XKYVJ) still read status=running long after their sessions ended. The second one's own persisted log contains a terminal session_closed event with reason failed. Only the run the user explicitly Stopped reached a terminal status."
  severity: blocker
  test: 1
  root_cause: "close_agent_run — the one function that writes a terminal status, ended_at, cost_usd, tokens_in and tokens_out — is never called from production code. `grep -rn close_agent_run packages/ --include=*.rs` outside packages/core/tests returns only its own definition and doc comments. The string session_closed does not appear anywhere in packages/core/src or packages/desktop/src-tauri/src at all: the sidecar emits the terminal event, the Rust reader loop persists it to JSONL and forwards it to the renderer, and no consumer ever maps it onto the agent_runs row. Only interrupt_agent_run (agent_run.rs:323, the explicit Stop path) writes a terminal status, which is exactly why the Stopped run is the only one that has one."
  impact: |
    This is the Core Value failing, not a cosmetic gap. PROJECT.md: "Every unit of agent work is
    anchored to a structured board item with real acceptance criteria." A run that ends on its own
    — completed OR failed — stays `running` on the board forever, with no ended_at, no cost and no
    token counts. The board's record of the fleet silently diverges from reality the moment an
    agent finishes without being manually Stopped, which is the normal case.
    CORRECTION (2026-09-11, raised by the planner and confirmed independently by the plan-checker):
    an earlier revision of this note claimed a task is never moved out of in_progress because
    agent_run.rs's docstring makes that transition close_agent_run's responsibility. That reading is
    BACKWARDS. The docstring names it as close_agent_run's explicit NON-behavior — "Nothing in this
    module ever moves a task OUT of `in_progress`" — and D-29 locks it ("Starting a session moves the
    task to In Progress; nothing ever moves it out"). Plan 02-18 prohibits implementing the mistaken
    reading, in its objective, a prohibition, an acceptance criterion, and threat T-02G-18-06.
    The gap's real impact is unchanged: status, ended_at, cost_usd, tokens_in and tokens_out are
    never written for a run that ends on its own.
    It additionally explains OBS-03: the header's "— in / — out" counters are not a display bug.
    The columns they read are never written.
  why_tests_missed_it: |
    packages/core/tests exercises close_agent_run directly and thoroughly, so the function is
    correct and proven. Nothing tested that anything CALLS it. A unit test of a function that
    production never invokes passes perfectly while the product is broken — the precise failure
    mode UAT exists to catch.
  artifacts:
    - path: "packages/core/src/domain/agent_run.rs:201"
      issue: "close_agent_run is fully implemented, documented and unit-tested, but has no production caller"
    - path: "packages/desktop/src-tauri/src/sidecar.rs"
      issue: "The reader loop persists and forwards session_closed but never maps it onto the agent_runs row"
  missing:
    - "Handle session_closed in the sidecar reader loop and call close_agent_run with the mapped status (completed / failed), carrying the result event's cost and token usage onto the row"
    - "Populate tokens_in/tokens_out — decide whether they accumulate from per-message usage during the run or are written once from the terminal result, and make the header reflect that choice"
    - "Add a test that drives a session to natural completion through the real reader loop and asserts the agent_runs row reaches a terminal status — asserting on close_agent_run alone cannot catch a missing call site"
  debug_session: ""
  stale_rows: |
    The two runs above are stuck rows in the live database and will not self-heal. They need
    clearing as part of the pre-UAT reset, or the board will show phantom running agents.

- gap_id: G-02-5
  truth: "The application starts"
  status: resolved
  reason: "User reported: panic at sidecar.rs:639 — 'there is no reactor running, must be called from the context of a Tokio 1.x runtime', followed by 'panic in a function that cannot unwind / thread caused non-unwinding panic. aborting.' The window never appeared."
  severity: blocker
  test: 1
  introduced_by: 02-15-PLAN.md
  regression: true
  root_cause: "The readiness handshake added for G-02-1 passed its timeout future as a CALL ARGUMENT: `block_on(tokio::time::timeout(dur, fut))`. `tokio::time::timeout` builds its `Sleep` eagerly at construction, and `Sleep` registers with the runtime's timer driver through thread-local state the moment it is created. Rust evaluates call arguments BEFORE the call, so the Sleep was built outside any runtime and panicked. The panic fired inside main.rs's `.setup()` closure, which runs on the main thread during `did_finish_launching` in a frame that CANNOT UNWIND, so the process aborted instead of surfacing the startup error `spawn_sidecar` is written to return."
  why_tests_missed_it: |
    `cargo test --workspace` passed 220/220 with the application unable to start at all. No test
    constructs a real Tauri AppHandle inside the platform launch callback, so `spawn_sidecar`'s only
    real call context is untested. This is the SAME shape as G-02-4 — a function proven correct in
    isolation, wrong at its only real call site — reappearing inside the fix for G-02-1. Worth
    noting plainly: the gap-closure round introduced a startup-abort while closing a
    failed-to-start bug, and every suite stayed green through it.
  resolution: |
    Fixed by constructing the timeout INSIDE the async block:
    `block_on(async { tokio::time::timeout(d, fut).await })`. Guarded by a new falsifiable source
    gate, `packages/core/tests/runtime_context_call_sites.rs`, which walks every .rs file under the
    desktop crate's src/ and fails on any `block_on(` whose first argument begins a `tokio::time::`
    construction. Proven falsifiable by reverting the fix (gate FAILED naming the line) and
    restoring it (gate passed). Full suites after the fix: rust 222/222, sidecar 38/38,
    desktop 312/312.
  artifacts:
    - path: "packages/desktop/src-tauri/src/sidecar.rs"
      issue: "Timer future constructed as a block_on argument, outside the runtime context"
  missing: []
  debug_session: ""

## Deferred Follow-Ups

- test: 1
  idea: "The design is really terrible - but we can fix that in a later session."
  deferred_at: 2026-09-11
  detail: |
    Deferred by the user to a later session. NOT a gap and NOT to be planned as one — recorded so
    the specifics survive, since "the design is terrible" without them is unactionable later.
    Observed in the session surface after G-02-3's clamp landed (the clamp itself worked — rows are
    one line and no longer overlap):
      1. `system: thinking_tokens` dominates the feed. The event fires per thinking chunk, so it
         appears many times between every pair of meaningful rows. Task 4 of 02-17 mapped non-init
         system subtypes to system_notice, which fixed the raw-JSON wall but made the FREQUENCY
         visible. A notice this repetitive probably wants collapsing into a single run-length row,
         or filtering out of the default view entirely.
      2. `assistant` and `user` events still render as raw JSON one-liners
         (`{"type":"assistant","message":{"model":"claude-opus-5",...`). normaliseStreamEvent maps
         assistant/user to assistant_text / tool_call / tool_result only when the expected content
         block is present; a streaming message whose `content` is empty or not-yet-filled falls
         through to `unknown` and renders verbatim. Tool calls (`Bash · pwd && npx vitest ...`) and
         final assistant prose DO render correctly, so this is specifically the streaming-shape
         events, not a wholesale failure.
    Together these are why the feed still reads as noise despite the clamp working: the signal is
    there, buried in per-chunk notices and unparsed streaming envelopes.

## Observations

Not defects in the phase-02 code, recorded so they are not mistaken for gaps.

- id: OBS-01
  title: "The agent's worktree is empty because this repository's main branch is empty"
  detail: |
    The THRE-28 run produced no useful work: seven Bash calls, all orientation, $0.39 spent, and
    the agent openly said it was trying to work out what "wire up the focus trap" meant. Its
    worktree /Users/cymarechal/Flywheel/THRE/THRE-28 contains exactly .git and README.md.
    This is NOT a Flywheel defect. base_ref_for_task resolved correctly: the task has an epic, so
    the base is the epic integration branch, lazily cut from the project's trunk tip — and
    projects.default_branch is "main", which in this repository points at c6bdc79 "first commit",
    a single-file tree containing only README.md. origin/main is at the same commit. All 336
    tracked files live on the unmerged branch cymarechal-devoteam/gsd-new-project-ade (b2b9c46).
    Flywheel built the topology it was asked to build; the trunk it was pointed at is a stub.
    CONSEQUENCE FOR UAT: every remaining human test that needs an agent to do real work is
    measuring nothing until the project points at a trunk that actually contains the codebase.
    Either merge the working branch to main, or set the project's default_branch to the branch
    holding the code.

- id: OBS-02
  title: "The agent left its own worktree and explored the main checkout"
  detail: |
    The last tool call of the THRE-28 run was
    `ls -R .flywheel; grep -ril "focus trap" ...`.
    Having found an empty tree, the agent walked out of its assigned worktree and into the
    project's main checkout. Flywheel spawns the child with cwd set to the worktree path (PROC-02)
    but nothing confines it there afterwards, so a cd is unopposed.
    No phase-02 truth claims filesystem confinement, so this is not a gap against this phase — but
    it cuts against the product's core promise that a unit of agent work is isolated to its
    worktree, and it is the exact failure mode PROJECT.md names in the inverse direction (the
    supervisor drifting into a worker's worktree). Worth raising as a board issue in its own right
    rather than being folded into phase 02.

- id: OBS-03
  title: "Token counters stayed at em-dash while the session was running"
  detail: |
    Promoted to gap G-02-4 — this is a symptom, not a cosmetic quirk. tokens_in/tokens_out are
    only ever written by close_agent_run, and nothing in production ever calls it.

- id: OBS-04
  title: "Two identical projects registered, and the rail shows THRE as Unreachable"
  detail: |
    The projects table holds two rows, 01M222FWC4FNCQKDZCXD8BEQ68 and 01M22XBK2AMH58GBVV4VDXT8H3,
    both named threadfin with the same repo_path and default_branch. The project rail in the
    screenshot shows THRE with an "Unreachable" warning. Worth a look, but not blocking the
    current tests.
