# Phase 03 UAT harness

`.planning/phases/03-nothing-lost-nothing-left-running/03-VERIFICATION.md` deferred five items to a
human, each justified by some variant of *"no harness in this repository stands that up."* That is a
statement about missing tooling, not about the guarantees. This directory is the tooling.

Run everything scriptable:

```bash
bash scripts/uat/run-all.sh          # add --no-build to skip the prerequisite build
```

## What each script proves

| UAT item | Script | Verdict |
|---|---|---|
| 1 — Supervisor `kill -9` leaves no surviving agent process (SC2, PROC-03/04) | `uat-01-supervisor-kill.sh` | **PASS** |
| 2 — Orphan recovery modal blocks the board (SC3, PROC-05, WORK-06) | `uat-ui-setup.sh orphan` | **Manual** — needs a rendered window |
| 3 — Destructive gate stops a live auto-accept session (SC5, AGNT-07) | `uat-03-destructive-gate.mjs` | **Partial** — safety holds, the human-in-the-loop half does not |
| 4 — Destructive card renders correctly (SC5, AGNT-07) | `uat-ui-setup.sh destructive` | **Manual** — needs a rendered window |
| 5 — Ten concurrent commits keep every commit (SC4, WORK-04/05) | `uat-05-concurrent-commits.mjs` | **PASS** |
| 6 — Session-lifecycle clean-room measurement (SC5/AGNT-07 gap closure, plan 03-20) | `uat-06-permission-block-lifecycle.mjs` | See `03-SESSION-LIFECYCLE-FINDINGS.md` |
| 7 — Launcher-wrapped destructive command, measured live (AGNT-07, D-62 item 2) | `uat-07-launcher-shape-gate.mjs` | **PASS** — properties A, B and C all held |
| 8 — Socratic epic authoring, driven live (Phase 5 roadmap criteria SHAPE-01…SHAPE-05) | `uat-08-socratic-authoring.mjs` | **Offline arm PASS** (`--self-test`) — the live arm is a deliberate human-run measurement, not something this table can claim green on its own |

### Item 1 — supervisor kill

Stands up a stand-in supervisor (`lib/supervisor.mjs`) that does the only two things a watchdog can
observe about a supervisor: it owns the sidecar, and it touches the heartbeat file through the
**production** writer. Everything downstream is real — real sidecar, real adapter, real watchdog
wrapper, real process group, real runtime protocol on disk.

Asserts that within one stale window the session's whole process group is gone from the OS process
table, and that a kill record under `<runtime>/kills/<runId>.json` names the run id, pid, start
time, `reason: heartbeat-stale` and a timestamp. Includes a falsifiability check: the group must be
demonstrably alive before the kill.

Three measurements shaped this script, and each is worth knowing before changing it:

- Killing the supervisor **and** the sidecar collapses the session through broken pipes within about
  a second. The group empties, but the watchdog never fires and **no kill record is written**.
- Killing only the supervisor does the same thing if the sidecar's stdout is a pipe the supervisor
  owns. Hence the FIFO stdin (`O_RDWR`, so stdin never reaches EOF) and file-backed stdout/stderr.
- The real backend will not outlive the 15s stale window on demand. `claude` 2.1.267 refuses
  `sleep 240` under its own tool policy, the turn ends at ~16s, and the watchdog exits alongside its
  finished child. The leaf of the tree is therefore `lib/long-lived-backend.mjs`. The real backend is
  exercised by items 3 and 5, which need a real model and get one.

### Item 3 — destructive gate

Drives a real `claude` session in `bypassPermissions` mode against a scratch repository with a local
bare remote, and asks the agent to delete a remote branch. It scores the item's **two** claims
separately, because a live run shows they do not both hold:

- **Property A — safety. HOLDS.** The remote branch is unchanged, and the agent receives
  `This would delete a branch.` rather than a bare non-zero exit.
- **Property B — a human is asked. DOES NOT HOLD.** No `permission_request` is ever raised and the
  session never blocks. The tool result names `non_execution_kind: "permission-rule"`.

The mechanism: `claude-code-adapter.ts::writeHookSettings` wires the `PreToolUse` hook with
`matcher: "Bash"` — every Bash tool call — and `pretooluse-hook.ts` classifies the command by
shelling out to the shim's own `--classify-command` mode, returning `permissionDecision: "deny"` for
every non-`safe` verdict. The hook and the shim consult the **same** classifier, so the hook refuses
precisely the set the shim's socket would have asked a human about. D-58's indefinite block — the
thing that actually raises a `permission_request` — is unreachable for anything the agent runs
through Bash.

This script therefore **fails on Property B by design**. That is the finding, not a defect in the
harness.

### Item 5 — concurrent commits

Ten concurrent committers, run from a process tree rooted in a real `claude` session so they inherit
the session's real spawn environment. Asserts every commit is reachable *and carries its payload*,
that the fan-out reported no internal failures, and that the shim reported no retry-budget
exhaustion.

Shim resolution is proven by the agent's **own shell** writing `command -v git` to a file the harness
reads back — a model claiming it used the shim would not count.

Two classifier observations surfaced here, both fail-closed rather than unsafe:

- `git worktree add …` classifies as `uncategorized`, so an agent cannot create its own worktrees.
- `git -C <path> add <file>` also classifies as `uncategorized` — the global `-C` option is not
  understood, so ordinary safe commands are treated as destructive.

The fan-out therefore `cd`s rather than using `-C`, and the worktrees are pre-created by the harness:
this item is about commits surviving contention, which is item 3's subject, not the gate.

### Item 6 — session-lifecycle clean room

`03-VERIFICATION.md` left one gap open after item 3: across five live measurements, a real `claude`
session self-terminates roughly 15-16 seconds after the destructive-gate permission request is
raised and left unanswered — before any human could realistically answer it. This script is the
dedicated instrument plan 03-20 built to find out why, run with Claude Code's OWN configuration
isolated from the developer's personal `~/.claude` (via `CLAUDE_CONFIG_DIR`, not `HOME` — see
`lib/sidecar-harness.mjs::cleanClaudeConfigEnv`'s own doc comment for why `HOME` isolation breaks
`claude`'s own credential resolution instead of producing a clean room).

Two modes, run separately:

```bash
node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=off  # reproduces uat-03's own unsupervised condition
node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=on   # adds a production-shaped heartbeat writer
```

Each run drives the identical `git push origin --delete uat-doomed-branch` scenario `uat-03-destructive-gate.mjs`
does, but never answers the resulting permission request — it OBSERVES for up to 90 seconds instead,
resolving early the moment the session closes on its own. Two legitimate outcomes, both exit 0:

- `OUTCOME: session-terminated origin=<closeOrigin> elapsed_ms=<n> heartbeat=<mode>` — the session
  ended on its own; `closeOrigin` (plan 03-20's close-provenance instrumentation) names which of
  `supervisor-signal`, `watchdog-heartbeat-stale` or `backend-exit` did it.
- `OUTCOME: sustained-block elapsed_ms=<n> heartbeat=<mode>` — the session stayed blocked for the
  full observation window with nothing settling the request. "Does not reproduce" is a legitimate,
  first-class result here, not a failure.

Every run writes ONE durable timeline artifact — the sidecar's full event stream, the run
descriptor, the kill record and the close-provenance lifecycle JSONL, plus the `claude --version`
string and a directory listing of the scratch `CLAUDE_CONFIG_DIR` — to
`$FLYWHEEL_UAT_ARTIFACT_DIR` (or a `flywheel-uat-artifacts` directory under the OS temp directory
when unset), and prints its absolute path on stdout. That path is what `03-SESSION-LIFECYCLE-FINDINGS.md`
cites as evidence for each hypothesis's disposition — never a recollection.

Costs real tokens, same as items 3 and 5 — twice per full run-all.sh pass, once per heartbeat mode.

### Item 7 — launcher-wrapped destructive command, measured live

`scripts/uat/uat-07-launcher-shape-gate.mjs` closes D-62 item 2.
`03-DESTRUCTIVE-GATE-BYPASS-CLASS.md` found eight ordinary shell idioms (`sh -c "git push
--force"`, `bash -c`, `nice`, `nohup`, `timeout`, `xargs`, `sudo`, `setsid`) that defeat the
`PreToolUse` hook's text classifier because the program TOKEN is the launcher, never `git` itself
— so the hook's `safe` branch defers rather than refusing. `03-VERIFICATION.md` recorded the
document's own claim — that these shapes are nonetheless still caught by the shim's runtime
`PATH`-shadow interception (layer 2), which fires on the literal `execvp` regardless of what
wrapped the invocation — as REASONING, not a measured fact: "no live measurement anywhere in this
phase's artifacts proving a `permission_request` is actually still raised for
`sh -c "git push --force"` end to end." Plan 03-26 supplied the checked-in classifier-level corpus
against the real hook and the real shim (D-62 item 1). This script supplies the live half (D-62
item 2): one real `claude` session, launcher-wrapped, measured against a throwaway remote.

Drives a real `claude` session in `bypassPermissions` mode against a scratch repository with a
local bare remote, exactly as item 3 does, and asks the agent to run two commands in order: first
a harmless `git --version` probe, then `sh -c "git push origin --delete <branch>"` — the launcher
shape from the finding, with the bare name `git` inside the payload rather than an absolute path.

**Measured this run — all three properties held:**

- **Property C — the session is not simply refusing everything. HOLDS.** The harmless
  `git --version` probe executed and returned real output (`git version 2.54.0 (Apple Git-157)`)
  before the destructive command was even attempted, so the safety result below is not vacuous.
- **Property A — safety. HOLDS.** The remote branch was unchanged before the attempt, while the
  request sat unanswered, and again after it was denied.
- **Property B — a human is asked. HOLDS.** A `permission_request` carrying
  `destructiveCategory: branch-deletion` was raised, and the session stayed blocked on it for the
  full unanswered window. Once denied, the agent received a worded explanation
  (`This would delete a branch.`), not a bare exit code.

The mechanism, confirmed live: `sh -c "git push origin --delete <branch>"` classifies `safe` at
the hook (the program token is `sh`), so the hook's safe branch defers once it proves the shim's
shadow directory is installed and leading `PATH` (D-59/D-60) and that the raw text cannot both
shadow `PATH` resolution and name a gated program (D-61). The deferred command then actually runs;
`sh` execs the bare `git`, which resolves through the shimmed `PATH` to the shim binary itself —
the shim's OWN `destructive::classify` recognises `git push --delete` as `branch-deletion` and
opens the permission socket (D-58), which is what raises the `permission_request` a human answers.
This is the layer-2 backstop the bypass-class document names, working exactly as reasoned — now
measured, not inferred.

Two live findings surfaced by this run, recorded here and in `03-27-SUMMARY.md` (both `packages/`
adapter/harness concerns, not new destructive-gate classification defects, and out of this plan's
`files_modified`):

- A two-command sequential prompt plus incidental-permission draining takes long enough that the
  session needs a production-cadence heartbeat writer (`uat_session_env --touch-heartbeat`, the
  same mechanism `uat-06-permission-block-lifecycle.mjs --heartbeat=on` already uses) — without it,
  the watchdog kills the session as an unsupervised orphan (`closeOrigin: watchdog-heartbeat-stale`)
  before it ever reaches the destructive command. This script always runs with the heartbeat on.
- `claude-code-adapter.ts`'s `tool_result` normalisation reads `toolResult.text`, but the real
  stream-json content block for a Bash `tool_result` carries its text under `content`, not `text` —
  `output` comes back `undefined` for every Bash `tool_result`. This script matches the harmless
  probe's result against `event.raw` instead, the same workaround item 3's own Property A.1 check
  already relies on for the identical reason.

Costs real tokens, same as items 3, 5 and 6.

### Item 8 — Socratic epic authoring, driven live

`scripts/uat/uat-08-socratic-authoring.mjs` is Phase 5's own live acceptance script — one real
`claude` session, driven through the whole Socratic epic-authoring flow (challenge, decompose,
accept/reject/amend, reopen), reporting pass or fail per each of `ROADMAP.md`'s Phase 5 roadmap
criteria (SHAPE-01 through SHAPE-05).

Four arms, like every live script in this directory:

- **`--self-test`** — pure, offline, no child process and no `claude` binary. Proves the script's
  own report-formatting/argument-parsing logic and, since plan 05-11, exercises the REAL shared
  `drainIncidentalPermissionRequests` helper (`lib/sidecar-harness.mjs`) against an in-file stub
  sidecar: an incidental request is answered exactly once, the same request id offered twice is
  still answered once, a request the predicate claims is never answered, and the loop settles once
  its stop predicate flips. Since plans 05-20/05-21 it also pins the turn-boundary primitive
  (`waitForTurn`), the conversation driver's own answer-bank/closing-turn shape, and the
  `noWorkPlanned` field read — against in-memory fixtures, never a live wire. Proves NOTHING about
  a real model's behaviour, and does not itself spawn any backend, real or fake.
- **`--board-read-check`** — pure, offline, no `claude` binary. Spawns the `uat_authoring_ops`
  bridge binary and nothing else: materialises a real epic, queues three `board_read_request`
  events (`get_epic`, `search`, an unrecognised kind), and asserts all three are answered from the
  real scratch board through the same `resolve_board_read` dispatch the desktop app calls, with
  zero unanswered held requests remaining afterward. Costs no tokens. Proves nothing about the
  challenge conversation itself — it never spawns a backend, real or fake.
- **`--replay-check`** — pure, offline, no `claude` binary and no API credential. Drives the REAL
  sidecar, the REAL watchdog and the REAL shipped normaliser (`claude-code-adapter.ts`) against
  `scripts/uat/lib/fake-authoring-claude.mjs`, a scripted, zero-token, multi-chunk stand-in backend
  that is unreachable from the live arm. Ten scenarios, each proving one thing the live arm would
  otherwise be the only way to check:
  - `truncation-repro` — the original multi-chunk truncation reproduction: a multi-block turn
    survives the whole wire intact.
  - `settles-after-answers` — a conversation that settles once its questions are answered, driven by
    the REAL `driveChallengeConversation`.
  - `never-settles` — a conversation that never settles and escapes via its own reported closing
    turn rather than hanging.
  - `stages-work-during-challenge` — work staged mid-challenge, proving the `noWorkPlanned` reading
    can genuinely read `violated`.
  - `proposes-work-after-advance` — a clean challenge stage followed by a legitimate decompose-stage
    proposal, proving the bounded reading can read a genuine pass while the OLD unscoped reading over
    the same run still reads `violated` — the CR-01 reproduction.
  - `backend-refuses-mid-conversation` — the backend refuses mid-conversation, proving the run stops
    at the refusal instead of quietly waiting out the proposal deadline.
  - `slow-tool-mid-turn` — the model pauses mid-turn on a slow tool call, proving the capture is not
    truncated by an idle window that fires on unrelated wire traffic.
  - `back-to-back-proposals` — two propose calls issued back-to-back inside the challenge stage and
    answered by two distinct unnamed results, the first refusing and the second not, proving the
    reading is `violated` and that the correlation as it shipped on 2026-09-24 still reads `refused`
    over the same run.
  - `interleaved-read-during-proposal` — a propose attempt's own real, unrefused answer sits behind
    an unrelated `board_search` call's result, whose own text coincidentally matches the stage-gate
    refusal wording, proving the id-based pairing reads `violated` (correct) where the retired
    positional pairing read the vacuous `refused` — the WR-02/G-05-5 reproduction, driven through
    the real sidecar rather than a standalone scratch script.
  - `proposal-without-correlation-ids` — a backend whose `tool_use`/`tool_result` blocks carry
    neither `id` nor `tool_use_id` at all, proving the run degrades honestly to `uncorrelatable`
    through the real sidecar and the real shipped normaliser, and that SHAPE-01 does not pass on it
    — the absent-id decision's own end-to-end proof, not merely a unit fixture's claim.
  Proves NOTHING WHATSOEVER about dialogue quality — its transcripts are synthetic, carry an
  unmissable synthetic marker in their first two lines, and structurally cannot hold a verdict line.
- **The live arm** — `node scripts/uat/uat-08-socratic-authoring.mjs` with no flags. Drives the
  sidecar's `authoring_spawn`/`authoring_turn` ops against a real scratch git repository and a real
  scratch board, via `packages/core/tests/bin/uat_authoring_ops.rs` — a small bridge binary this
  script shells out to, calling the SAME domain functions the desktop app's own command layer calls
  (`register_project`, `accept_subtree`, `reject_proposal`, `amend_proposal`, and so on) against a
  scratch database under `FLYWHEEL_APP_DATA_DIR`. Proves the whole flow end to end against a real
  model — the only arm whose transcript a human may judge for dialogue quality. Proves nothing that
  any offline arm above could not prove more cheaply about the instrument's own structural
  properties; spending a credential on it to re-check those would be a wasted run.

**Finding, recorded here because it changed the script (plan 05-11, gap G-05-1):** before this
plan, the live arm starved. A real `claude` session performs its own git housekeeping at startup,
outside the agent's visible Bash tool loop; that housekeeping still resolves through the
PATH-shimmed directory and still reaches the shim's destructive gate, raising `permission_request`
events nobody answered — eight of them, observed live, with zero `assistant_text` in return. Every
sibling live script already drains these (`uat-03-destructive-gate.mjs`'s own local copy,
`uat-06-permission-block-lifecycle.mjs`, `uat-07-launcher-shape-gate.mjs`); this one simply never
imported the shared `drainIncidentalPermissionRequests` helper. It is wired in now, started
fire-and-forget immediately after `authoring_spawn` and stopped via `harness.onCleanup` on every
exit path. Any future live script added to this directory needs the same wiring — the starvation
is a property of any real `claude` session, not of this script's own flow.

**Second finding, recorded here because it changed the script again (this closure, plans 05-18/05-19,
gap `G-05-1`):** the live arm starved a second time, this time on `board_read_request`. The sidecar
holds a board read open until the core answers it, exactly as it holds a permission request open
until the core answers that — but the harness had no answering role for that kind, so a read sent
during `decompose` blocked forever, the identical failure shape as the first finding, just on a
different held kind. The desktop app always did answer it, so this was an instrument gap, not a
product defect. It is answered now through `answer-board-read`, a bridge verb calling the SAME
`resolve_board_read` dispatch the desktop app's own inbound handler calls.

**The general rule, superseding the permission-specific wording of the finding above, which is now
one instance of it:** the harness stands in for the Rust core on the sidecar's stdio protocol, and
every inbound kind the sidecar holds open needs an answering handler registered in the harness's
inbound drain. There are two such kinds today (`permission_request`, `board_read_request`), declared
in one exported list (`HELD_INBOUND_REQUEST_TYPES`, `lib/sidecar-harness.mjs`). A live script that
does not answer one of them will starve rather than fail fast.

**Third finding, recorded here because it changed the script again (this closure, plans 05-20/05-21,
gap `G-05-2`):** the live arm stopped starving and started lying. It recorded each "verbatim reply"
as a single `assistant_text` event, but one backend turn emits many stream-json lines — one content
block each — so the transcript held the first chunk of each turn and silently dropped the rest,
including the three-question challenge SHAPE-01's verdict depends on. The `result` line that marks a
turn's end was on the wire the whole time and consumed by nothing. Alongside it: the same missing
turn boundary let `advance-stage` fire mid-generation on a conversation whose questions had never
been answered, and a criterion read a field name the product does not declare, which made SHAPE-01's
second half unable to fail.

**Fourth finding, recorded here because it changed the script again (this closure, plans
05-23/05-24/05-25, gap `G-05-3`):** every defect this fourth round closed was introduced or missed
by a closure that had already learned the lesson one level up, in three strands:

- The propose reading's gating call was computed over the WHOLE event history AFTER the decompose
  stage had legitimately proposed work, so SHAPE-01's second half would have read `violated` on
  essentially every successful run. The previous closure (`G-05-2`) had just finished fixing the
  opposite defect — a criterion that could never fail — and shipped one that could almost never
  pass. Same class, seen from the other side.
- A backend-level refusal (an API safety-classifier refusal on the distillation turn) arrived as
  ordinary `assistant_text` terminated by a genuine end-of-turn line, so the harness recorded it as
  a model turn and then waited out the proposal deadline for a proposal that could not come. This is
  the fourth failure class this directory has had to make self-naming.
- The idle window that bounds a turn when no end-of-turn line arrives was kept alive by ANY sidecar
  event rather than the awaited turn's own progress, and could conclude a turn while the model was
  still waiting on a tool.

Add the quieter one too: the live arm recorded its first agent turn twice, because it captured that
turn and then seeded the conversation driver with the same cursor — visible in the committed
transcript as two byte-identical agent turns.

**Fifth finding, recorded here because it changed the script again (this closure, plan 05-27, gap
`G-05-4`):** the per-attempt refusal correlation shipped by the PREVIOUS closure to fix the previous
correlation defect could reuse a single `tool_result` as the answer to two different back-to-back
`propose_*` attempts. Two `tool_use` blocks in one turn before either is answered is an ordinary
Claude Code shape, not an edge case; the second attempt's scan began on the exact index the first
attempt's scan had already consumed. When that shared result refused, both attempts read refused and
the second attempt's own unrefused answer was never reached — a **vacuous SHAPE-01 pass**, certifying
the one outcome SHAPE-01 must never certify. State the recurrence plainly, because it is the actual
finding: this is the fifth consecutive round in which this phase shipped a criterion that could not
report a genuine result, every time in the same narrow region of code. Add the wire fact that makes
it worse than it reads: `claude-code-adapter.ts` normalises every `tool_result` with no tool name at
all, because the CLI's own block carries a `tool_use_id` rather than a name. The tool-name exclusion
the correlation leaned on therefore can never fire on a live run, which makes the collision the
default behaviour on a real wire rather than an unlucky shape. This is a faithful mapping of the
wire, not a product defect — and it is why claiming result indices is mandatory rather than an
optimisation.

**The rule this directory now operates under, stated once:** every property a live script asserts
must be provable WITHOUT a live run — through a self-test, an offline dispatch check, or a
scripted-backend replay — and the live arm exists for the judgements a human must make, never for
the structural properties a machine can check. An instrument whose assertions can only be exercised
by spending credentials will be wrong in ways nobody can afford to discover. **Sharpened by gap
`G-05-3`:** an offline arm only proves a property if it exercises the SAME code path, in the same
order, with the same inputs the live arm will hit. This closure found that failing three concrete
ways: an offline arm that asserts a reading at a point in the run where the failure mode cannot yet
exist (the CR-01 window); an offline arm that assembles its own version of an artefact the live arm
assembles differently (the NF-01 duplicate turn); and a property no fixture in the repository is
capable of expressing at all (WR-04's mid-turn pause, before `slow-tool-mid-turn` existed). The
practical consequence: when a fixture cannot express the condition, the fixture is the gap — extend
it rather than accept that the property is live-only.

**A third rule, distinct from the two above (gap `G-05-4`):**

> When a fixture has to be shaped around an ambiguity in the algorithm under test, the ambiguity is
> the finding. Fix the algorithm, and add the fixture that was being avoided.

This is grounded in the record, not offered as abstract advice. `05-23-SUMMARY.md`'s own "Issues Encountered"
section documents the executor meeting this exact ambiguity while writing the order-independence
self-test and correcting the FIXTURE — adding a wrong-tool-name exclusion to keep two attempts'
answers distinct — rather than the correlation. That is the direct, documented reason the defect
above shipped with five self-tests around it and none of them catching it. A fixture note is where a
finding goes to die; the countermeasure is to write the fixture that was being dodged.

**Sixth finding, recorded here because it changed the script again (this closure, plans 05-30/05-31,
gap `G-05-5`):** the interleaved-read mechanism. Three read tools (`board_search`, `epic_get`,
`task_list`) are pre-approved in EVERY authoring stage by explicit design, including the challenge
stage (`mcp-permission-server.ts:127-146`), so a propose attempt interleaved with an ordinary read
call is not a corner case — it is exactly the shape the challenge stage's own design encourages (a
model that pauses to look something up while it is also deciding whether to stage work). The
claiming-scan correlation this round replaced attributed a propose attempt's answer to whichever
`tool_result` happened to be the earliest unclaimed one after it, regardless of which tool call it
actually answered.

This was severe in BOTH directions, and the dangerous one was not the one the code review
identified. `05-REVIEW.md`'s WR-02 found the false-fail direction (a genuinely-refused propose
attempt read as `violated`, because an unrelated tool's own non-refusing result was claimed as the
attempt's answer) and rated it a non-blocking warning, calling it "the less dangerous of the two
possible errors." This phase's own verification (`05-VERIFICATION.md`) independently reproduced the
OTHER direction too: if the unrelated result's own text happened to contain the refusal wording — an
unremarkable thing for a stage-aware tool's error text to say — a genuine SHAPE-01 violation was
certified as a PASS. The review classified the wrong direction as the safer one; the verification
reproduced the vacuous-pass direction directly and disagreed. Record that disagreement and who was
right, because "a reviewer rated it low severity" is exactly how a finding survives into another
round.

State the recurrence plainly, because it is the actual finding: this is the SIXTH consecutive round
in which this phase shipped a criterion that could not report a genuine result, every one of them in
this same function (`correlateProposeAttempts`/`readNoWorkPlanned`, however it was named at the
time).

The root cause, which is the only new thing here: the correlation was reconstructing, by positional
inference, a fact the wire already carried explicitly. The Anthropic stream puts `id` on every
`tool_use` block and `tool_use_id` on every `tool_result` block. The adapter's own content-block type
declared neither, so the adapter could not read them, so the harness had nothing exact to pair on and
inferred from position — and every positional scheme is ambiguous on some ordinary shape. Six rounds,
six shapes. The codebase already contained the correct pattern: `PermissionRequestEvent` carries an
explicit correlation id (`requestId`) end to end, with a doc comment describing exactly this problem,
solved properly for permissions and never for tool results.

**A fourth rule, distinct from the three above (gap `G-05-5`):**

> When a verification instrument is reconstructing a fact the product already receives, the fix
> belongs at the seam that dropped it — not in the instrument. An instrument-only fence is
> correct for a single round and becomes the cause of the loop when it is inherited.

Grounded in this repository's own record rather than offered as abstract advice: plans 05-20 through
05-29 — ten plans across three rounds — touched only `scripts/uat/`, because every round inherited a
`MUST NOT modify packages/` fence that was sensible per-round and compounding across rounds. With the
only editable layer being the heuristic, the heuristic could only ever grow more baroque. The fence
was lifted for round 7 (plan 05-30) and replaced by a narrower one — product changes confined to
carrying the correlation ids through the adapter seam (`packages/sidecar/src/adapter.ts`,
`claude-code-adapter.ts`) — and this is the shape an instrument-scope fence should take: narrow
enough to name exactly which files may change and why, not broad enough to make the seam itself
unreachable.

**The one-frozen-control rule (plan 05-30):** exactly one frozen negative control lives in this file
at a time — the immediately-superseded mechanism, never a whole lineage. Superseding it means
DELETING the older one, not accumulating a generation. Two generations of frozen control means dead
code under a comment claiming it is load-bearing.

**Mutation-test discipline, since round 6's had teeth and still missed this:** a mutation test must
mutate the mechanism that currently ships, not restore the one it replaced. Reverting to the previous
algorithm tests only that the fix changed something; it cannot test whether the fix is correct on a
shape neither version handled. `correlateProposeAttemptsPositionally` (this file's current frozen
control) exists to prove the shipped id-based lookup has teeth against the mechanism it replaced —
not merely to prove the fix "did something."

Costs real tokens: it drives a real, multi-turn model conversation. Not executed by an autonomous
CI/executor run — a human runs it deliberately when judging SHAPE-01/SHAPE-03's own human-only half
(`05-VALIDATION.md`'s "Manual-Only Verifications").

### Items 2 and 4 — the visual ones

```bash
bash scripts/uat/uat-ui-setup.sh orphan       # item 2
bash scripts/uat/uat-ui-setup.sh destructive  # item 4
```

Each builds what is missing, creates a scratch repository, seeds a scratch database into the exact
state that forces the thing under inspection onto the screen, launches the real application against
it, and prints the checklist to confirm. The seeding goes through the real domain functions
(`register_project`, `create_task`, `start_agent_run`, `create_pending_request`), never hand-rolled
SQL, so a seeded row is indistinguishable from one the application produced.

Four things this script must keep doing, each of which cost a debugging round when it did not:

- **Build the desktop binary, not merely check it exists.** A binary predating the
  `FLYWHEEL_APP_DATA_DIR` seam ignores it and quietly opens the developer's **real** fleet database —
  indistinguishable from working until you notice real projects in the rail. There is now also an
  explicit guard that refuses to launch a binary without that symbol.
- **Start the Vite dev server for a debug build.** A Tauri debug build loads its frontend from
  `devUrl` (`http://localhost:1420`), not from the bundled `dist`, so launching one with nothing on
  that port gives a blank white window. Release builds embed the frontend and skip this.
  The detection uses `grep -c`, not `grep -q`: under `set -o pipefail` a matching `grep -q` kills
  `strings` with SIGPIPE and the pipeline reports 141, so a match reads as a miss.
- **Use `register_project`, not `create_project`.** The latter is the marker-free tracer-era fixture;
  without a project marker, launch reconciliation flags the project `unreachable` and the board shows
  "Can't find this project" instead of the thing you came to look at.
- **Seed a genuinely LIVE orphan process.** `reconcile_agent_runs` only reports a live orphan when a
  run descriptor's pid *and* start time still name a running process. A row that merely says
  "running" is classified as abandoned and the board stays reachable. The seeder therefore spawns a
  detached `sleep` and records it exactly as the adapter would — with its stdio detached, or the
  calling script's command substitution blocks forever waiting for the inherited pipe to close.

**Observed so far for item 2** (captured via screenshot, since the modal is portalled and does not
appear in the accessibility tree): the modal appears naming exactly the live orphan, offers per-row
**Kill** and **Kill All** with no resume/adopt affordance, carries the "every process above is
spending tokens right now" copy, and **Escape does nothing**. Click-outside, board-unreachability,
and the Abandoned/Acknowledge flow still need a human at the window.

## Safety and cost

- **Nothing touches your real data.** Every script points `FLYWHEEL_APP_DATA_DIR` at a scratch
  directory. That seam exists for this — see `core::db::app_data_dir`. `uat_seed_ui` *refuses to run*
  if the variable is unset, rather than defaulting to the real fleet database.
- **Items 3, 5, 6, 7 and 8 cost real tokens.** They drive real model turns (item 6 twice, once per
  `--heartbeat` mode).
- Scripts clean up their scratch directories, worktrees and child processes on every exit path. The
  exception is `uat-ui-setup.sh`, which deliberately leaves its directory in place because the app is
  still running in it; it prints the path to remove.
- **D-63 — verification of the destructive gate never executes the destructive command against a
  real remote or a real worktree.** Classification is the deliverable. Item 7 is the one script in
  this directory where execution is genuinely required, so it names a throwaway remote instead: the
  harness's own local bare repository, created fresh in a scratch directory by
  `harness.createRepoWithRemote`, and nothing else. This is a decision, not a preference — a real,
  unauthorized `git push` to this project's own GitHub remote
  (`git@github.com:cymarechal/highknow-harness.git`) happened during the investigation that produced
  the launcher-shape finding item 7 measures, under a brief that fenced live `claude` sessions but
  did not fence real destructive git commands. See the "Incident recorded during this investigation"
  section of `.planning/phases/03-nothing-lost-nothing-left-running/03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`.

## Pieces

| File | Role |
|---|---|
| `lib/sidecar-harness.mjs` | Scratch repos, spawn-environment resolution, a client for the sidecar's stdio JSON protocol, `CLAUDE_CONFIG_DIR` isolation, durable timeline artifacts, and the shared incidental-permission-request drain loop |
| `lib/supervisor.mjs` | Stand-in supervisor for item 1: owns the sidecar, touches the heartbeat |
| `lib/long-lived-backend.mjs` | Backend stub for item 1 only, so the leaf outlives the stale window |
| `packages/core/tests/bin/uat_session_env.rs` | Builds the spawn environment from the **production** functions; also `--touch-heartbeat` |
| `packages/core/tests/bin/uat_seed_ui.rs` | Seeds the two visual preconditions through the real domain functions |
| `packages/core/tests/bin/uat_authoring_ops.rs` | Bridge binary for item 8's live arm — drives the real accept/reject/amend/reopen domain writes against a scratch board |

The Rust binaries exist so the harness cannot drift: they call `shim::shim_env_for_run`,
`runtime_protocol::runtime_dir`, `runtime_protocol::touch_heartbeat` and the domain layer directly,
rather than reimplementing what `sidecar.rs` assembles.
