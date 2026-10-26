# UAT harness

The live and offline UAT scripts. Each one drives the real sidecar and the real core against scratch
data, so a guarantee is measured by code rather than claimed (`docs/mvp-spec.md` §9).

- **Offline, zero tokens, run in CI on every PR** (`.github/workflows/ci.yml`, job "Offline UAT"):
  `harness-supervision-gate.mjs` (both modes), `uat-12-fleet-live-reads.mjs`,
  `uat-16-epic-shaping.mjs`, `uat-17-roadmap-round.mjs`, `uat-18-execution-proposals.mjs` and
  `uat-19-board-and-review.mjs`. None needs a `claude` binary or any credential. (Item 13, the fan-out run, was deleted with the fan-out
  dispatcher at the schema cut, issue #44.)
- **Manual, pre-release only:** items 1, 3, 5, 6, 7 and 11. Items 3, 5, 6, 7 and 11's live arm
  spend real tokens.

Run everything scriptable:

```bash
bash scripts/uat/run-all.sh          # add --no-build to skip the prerequisite build
```

## What each script proves

| UAT item | Script | Verdict |
|---|---|---|
| GATE — the harness supervises its own sessions (D-105) | `harness-supervision-gate.mjs --mode=supervised` | **PASS** — zero tokens, CI |
| GATE — the heartbeat opt-out is still reaped on time (D-105) | `harness-supervision-gate.mjs --mode=unsupervised` | **PASS** — zero tokens, CI |
| 1 — Supervisor `kill -9` leaves no surviving agent process (SC2, PROC-03/04) | `uat-01-supervisor-kill.sh` | **PASS** |
| 3 — The Gated-action deny-list asks every time, and nothing else asks (§4.1, ADR 0001) | `uat-03-destructive-gate.mjs` | **Manual** — rewritten to the deny-list, not yet run live |
| 5 — Ten concurrent commits keep every commit (SC4, WORK-04/05) | `uat-05-concurrent-commits.mjs` | **PASS** |
| 6 — Session-lifecycle clean-room measurement (SC5/AGNT-07 gap closure, plan 03-20) | `uat-06-permission-block-lifecycle.mjs` | See `03-SESSION-LIFECYCLE-FINDINGS.md` |
| 7 — Launcher-wrapped destructive command, measured live (AGNT-07, D-62 item 2) | `uat-07-launcher-shape-gate.mjs` | **PASS** — properties A, B and C all held |
| 11 — `CLAUDE_ENV_FILE` ordering, PATH shadow restoration, ask-branch (AGNT-07) | `uat-11-env-file-ordering.mjs` (`--selftest` is zero tokens) | **Manual** — the live run spends tokens |
| 12 — Fleet live reads: log tail, dismiss, blocked queue, reclaim (D-REV-48/49/50/55) | `uat-12-fleet-live-reads.mjs` | **PASS** — zero tokens, CI |
| 16 — A one-line idea becomes an Epic with Ready Stories, each with criteria and Checks; a killed shaping session resumes at the open Round (Epic #59's exit test, #130) | `uat-16-epic-shaping.mjs` | **PASS** — zero tokens, CI |
| 17 — Shape a Milestone's exit test; confirming an Epic Done runs a roadmap Round that proposes a change or says the Roadmap holds (Epic #60's exit test, #134) | `uat-17-roadmap-round.mjs` | **PASS** — zero tokens, CI |
| 18 — A running Story files Proposals with `propose`, capped at 3, withdrawable, answered at once (Epic #62, #160) | `uat-18-execution-proposals.mjs` | **PASS** — zero tokens, CI |
| 19 — Milestone 4's exit test: a Story from Ready to Merged through Needs you, triage, a request for changes, the Decisions section and Merge (Epics #61, #62, #63, #169) | `uat-19-board-and-review.mjs` | **PASS** — zero tokens, CI |

### Item 16 — shaping an Epic from one line to Ready Stories (Epic #59's exit test)

Drives the real sidecar and its real board MCP server with the same scripted fake agent as item 17
(`FLYWHEEL_FAKE_BOARD_CALLS`): each step runs only in the session whose packet names its Stage, and
`{{result:<tool>:<field>}}` reads a field of an earlier call's answer, as an agent reads the
`proposal_id` a `propose_story` returns. The board's half runs through the `uat_shaping_ops` bridge
(`packages/core/tests/bin`), which calls the core functions behind Shape, Continue shaping, the dock's
answers, Accept on a ghost, Close Stage and the sidecar's `session_closed`.

- **A. Challenge the spec.** Shape starts a session on a one-line Epic. The agent posts Round 1: two
  questions and an ADR question. The developer writes their own answer to one and presses Accept all
  recommended, which answers the other and leaves the ADR open, so the Round stays held.
- **B. Kill and resume.** The sidecar kills the session mid-Round. The answers stay on the board, and
  no session is held on the Round. Continue shaping starts a fresh session whose packet carries the open
  Round with both answers and says to call `round_wait`, which takes the Round over. The ADR's Yes
  answers it with all three answers. The agent proposes the problem and the exit test; the developer
  accepts both and closes the Stage.
- **C. Slice into Stories.** The next session proposes two Stories, the second running after the first
  by its `proposal_id`; the developer accepts both and closes the Stage.
- **D. Write the Acceptance criteria.** The next session proposes one criterion with a Check per Story;
  the developer accepts them and closes the Stage. The Epic and both Stories are Ready, each criterion
  has its Check (600s), and the first Story's Context packet carries the accepted ADR to write verbatim;
  the second Story's names it and the Story that writes it.

Not exercised: the desktop's `AppState` mutex, the `board:changed` emit and the IPC serialisation. The
desktop's half of the same walk, clicked through the real `<App />`, is
`packages/desktop/src/shaping/__tests__/browser/epic-shaping-flow.browser.test.tsx`.

### Item 17 — the roadmap Round on Epic Done (Epic #60's exit test)

Drives the real sidecar and its real board MCP server, with `packages/sidecar/test/fake-claude.mjs` at
the backend leaf in its scripted board-call mode (`FLYWHEEL_FAKE_BOARD_CALLS`): a scripted agent that
reads the packet it was spawned with and makes board calls according to it. The board's half
runs through the `uat_roadmap_ops` bridge (`packages/core/tests/bin`), which calls the same core
functions `epic_confirm_done`, the shaping tool router and `proposal_accept` wrap; the script relays
each held board call between the two, as `sidecar.rs` does.

- **A.** Shape on the Milestone (#132) starts its shaping session on the Milestone's shaping packet. The
  agent posts a Round; the developer accepts every recommendation, which answers the held call; the
  agent proposes a sharper exit test; the developer accepts it and closes Exit test, so the Milestone
  is Ready with the new text, which the next roadmap packet reads.
- **B.** Confirming Epic FLY-1 Done opens one roadmap Round and starts its session on a packet that
  names the trigger and keeps the Round short and on the Epic's Milestone. The agent proposes a new
  Epic and calls `round_wait`; the developer accepts it; the held call is answered with the decision,
  and the Round closes with the Epic on the board.
- **C.** Confirming Epic FLY-3 Done opens Round 2; the same agent, on a packet with another trigger,
  says the Roadmap still holds, and the Round closes with "Roadmap still holds".

### Item 18 — a running Story files Proposals (Epic #62, issue #160)

Drives the real sidecar and its real board MCP server, listed to a Story session, with the scripted
fake agent (`FLYWHEEL_FAKE_BOARD_CALLS`). The board's half runs through the `uat_review_ops` bridge,
which calls the core functions behind Start, the Story Proposal tool router and `proposal_accept`.
The agent files three Proposals (New Story, Amend Epic spec, New Epic), each answered at once; a
fourth is refused naming `proposal_withdraw`; it withdraws one and files the fourth again. No call is
ever held, and accepting the New Story creates it in Shaping.

Not exercised: the desktop's `AppState` mutex, the `board:changed` emit, and the IPC serialisation.

### Item 19 — Milestone 4's exit test: Ready to Merged (Epics #61, #62, #63, issue #169)

Drives the real sidecar and its real board MCP server, listed to a Story session, with the scripted
fake agent (`FLYWHEEL_FAKE_BOARD_CALLS`), whose `{ commit: { path, content } }` steps commit files
between board calls through the session's PATH shim. The board's half runs through the
`uat_review_ops` bridge, which calls the core functions behind Start, the Story's Task, Proposal and
hand-off tools, Needs you, the triage drawer, Accept and Reject, Request changes, the review card,
accepting a criterion, an ADR decision and Merge.

- **Work and hand off.** A Ready Story with two criteria (one proven by `test -f src/parser.rs`, one
  judged at review) is started. Its agent writes two Tasks, commits the parser, files a New Story and
  an Amend criterion, commits `docs/adr/0001-…`, and hands off with the ADR's bar lines.
- **Needs you.** While the hand-off waits, Needs you lists the judged-on change and the Proposals row;
  after it, the Review too.
- **Triage.** The New Story is rejected in the drawer with a reason; the Amend criterion is accepted
  where Needs you draws it. Needs you keeps only the Review.
- **Request changes.** A second session starts in the same worktree on a packet carrying the comments,
  the decided Proposals and the amended criterion. It adds a Task for the review point, commits the
  fix, re-runs the Checks (`checks_run`, recorded nowhere) and hands off again.
- **Review and Merge.** The card pre-ticks the passed Check and shows the new ADR with its hand-off
  bar lines, unflagged. Both criteria accepted and the ADR kept, Merge puts a two-parent commit on
  `main`, removes the worktree and its branch, links the ADR to the Story, and Needs you lists
  Confirm exit test for the Epic, whose only Story is Merged.

Not exercised: the desktop's `AppState` mutex, the `board:changed` emit, and the IPC serialisation.
The desktop's half of the same walk, clicked through the real `<App />`, is
`packages/desktop/src/review/__tests__/browser/review-merge-flow.browser.test.tsx`.

### Supervision — why every live item outlives the watchdog, and why that is not each item's job

A spawned session whose heartbeat file goes untouched for `HEARTBEAT_STALE_MS` (15000ms) has its
whole process group SIGKILLed by `watchdog.ts` as an unsupervised orphan. That is the watchdog
working (D-47/D-48, PROC-04), and it is a trap for any item that wants to *observe* a session for
longer than that.

`Harness.sessionEnv` therefore runs the production-cadence heartbeat writer **itself, by default**.
An item that genuinely needs the unsupervised condition asks for it — `sessionEnv(runId, branch,
{ heartbeat: "off" })` — and only two do: `uat-01-supervisor-kill.sh` and `uat-06
--heartbeat=off`, both of whose whole subject is the watchdog firing.

This used to be each caller's responsibility, stated in `startSidecar`'s doc comment. It did not
hold. Five of the seven `sessionEnv` callers copy-pasted the same six-line writer and two did not,
so `uat-03` and `uat-05` each asserted a property their own session was killed before it could
exhibit — uat-03 reporting *"the session must not close while a destructive permission request is
unanswered"* for a `watchdog-heartbeat-stale` SIGKILL that landed 7.084s into its own 8000ms window
(measured: `closeOrigin: "watchdog-heartbeat-stale"`, `since_start_ms: 16014` in
`permission-block-lifecycle-off-2026-10-01T04-02-59-058Z-permission-block-timeline.json`). A
requirement that every caller must remember is not a requirement.

Two mechanisms keep it true, and `harness-supervision-gate.mjs` asserts both for zero tokens
against the `lib/long-lived-backend.mjs` stub (`run-all.sh` runs it *before* any item that spends
credentials, because a harness that has stopped supervising makes every verdict below it
meaningless):

- **The default is the safe one.** Opting into the hazard is explicit and visible.
- **`assertNoEvent` refuses to race.** Before sleeping, it checks that the window actually fits the
  session's remaining watchdog budget, and reports an `INSTRUMENT DEFECT` naming itself if it does
  not. This matters in *both* directions: without it, a mis-specified item fails and blames the
  product on a slow turn, and **passes** on a fast one — a green row that could not have gone red
  for the right reason, the same vacuity class as UAT 6a. The check is arithmetic, so it fires on
  every run rather than the unlucky ones.

Never shorten an assertion window to fit the budget. A window chosen to fit the budget rather than
the property is exactly the vacuity this gate exists to prevent; fix the environment instead.

Every session resolved through `sessionEnv` also leaves a `*-session-timeline.json` artifact —
event stream, run descriptor, kill record, lifecycle JSONL, `closeOrigin`, `closedAfterStartMs` and
`claude --version` — on pass **and** on fail. `uat-03` wrote no artifact at all before this, which
is why its one token-spending failure had to be diagnosed from a sibling item's file.

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

### Item 3 — the Gated-action deny-list

Drives a real `claude` session in `bypassPermissions` mode in a scratch worktree on its own Story
branch, with the Story's branch and worktree in its spawn environment (`FLYWHEEL_STORY_BRANCH`,
`FLYWHEEL_WORKTREE_PATH`), against a local bare remote. The agent runs a fixed list of commands, one
Bash call each, and the script denies every permission request as it arrives:

- **Allowed, never asked:** read-only git (`status`, `log`, `ls-files`, `rev-parse`, `diff`, also
  behind `-C`/`-c`), `git rebase main` on the Story's own branch, and `rm -rf` inside the worktree.
  Claude Code's own startup git checks go through the same shim, so the script asserts the session
  raises no request at all beyond the Gated ones.
- **Gated, asked once each:** `git push`, a `-C`/`-c`-prefixed `git push --delete`, `git branch -D`
  of another branch, `git reset --hard`, `git clean -fd`, rebasing another branch, `rm -rf` outside
  the worktree, and each of `npm publish`, `cargo publish`, `gh pr merge`, `gh release create` whose
  tool the shim shadows on this machine. Each must carry its category, and the repositories and
  filesystem must show none of them ran.

The PreToolUse hook that refused these outright before they could ask was deleted with ADR 0001, so
every Gated command now reaches the shim's question.

### Item 5 — concurrent commits

Ten concurrent committers, run from a process tree rooted in a real `claude` session so they inherit
the session's real spawn environment. Asserts every commit is reachable *and carries its payload*,
that the fan-out reported no internal failures, and that the shim reported no retry-budget
exhaustion.

Shim resolution is proven by the agent's **own shell** writing `command -v git` to a file the harness
reads back — a model claiming it used the shim would not count.

Two classifier observations surfaced here, both fixed by the Gated-action deny-list (ADR 0001):
`git worktree add …` and `git -C <path> add <file>` used to ask as `uncategorized`; the classifier now
skips git's global options and allows every command that is not a Gated action.

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

**The credential seam (plan 05-33, gap `G-05-6`):** config isolation and credential availability
are separate switches, not one. A live item composes its `CLAUDE_CONFIG_DIR` from an
explicit allow-list containing only the credential entry (`CREDENTIAL_LINK_ALLOWLIST`,
`lib/sidecar-harness.mjs`), linked into the isolated directory by reference — a symbolic link —
never copied. The developer's personal memory file, settings, skills, agents, commands, hooks and
plugins are asserted absent from that composed directory (`BEHAVIOURAL_CONFIG_DENYLIST`), and the
assertion throws the instant one is found. Before spawning anything, `assertBackendAuthenticated`
reads the backend's own authentication state and refuses — naming the cause — rather than producing
a short notice turn and burning a proposal deadline waiting on a conversation that was never going
to happen. `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` are removed from the spawn environment by
construction (`scrubApiKeyEnv`), unconditionally, because this project's execution-model constraint
is that agents run on the developer's own existing local agent credentials — never an API key.

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

## Safety and cost

- **Nothing touches your real data.** Every script points `FLYWHEEL_APP_DATA_DIR` at a scratch
  directory. That seam exists for this — see `flywheel_core::db::app_data_dir`. The `uat_*` bridge binaries
  *refuse to run* if the variable is unset, rather than defaulting to the real fleet database.
- **Items 3, 5, 6, 7 and 11 (live) cost real tokens.** They drive real model turns (item 6 twice, once per
  `--heartbeat` mode).
- Scripts clean up their scratch directories, worktrees and child processes on every exit path.
- **D-63 — verification of the destructive gate never executes the destructive command against a
  real remote or a real worktree.** Classification is the deliverable. Item 7 is the one script in
  this directory where execution is genuinely required, so it names a throwaway remote instead: the
  harness's own local bare repository, created fresh in a scratch directory by
  `harness.createRepoWithRemote`, and nothing else. This is a decision, not a preference — a real,
  unauthorized `git push` to this project's own GitHub remote
  (`git@github.com:cymarechal/highknow-harness.git`) happened during the investigation that produced
  the launcher-shape finding item 7 measures, under a brief that fenced live `claude` sessions but
  did not fence real destructive git commands. See the "Incident recorded during this investigation"
  section of `planning-archive:.planning/phases/03-nothing-lost-nothing-left-running/03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`.

## Pieces

| File | Role |
|---|---|
| `lib/sidecar-harness.mjs` | Scratch repos, spawn-environment resolution, a client for the sidecar's stdio JSON protocol, `CLAUDE_CONFIG_DIR` isolation, durable timeline artifacts, and the shared incidental-permission-request drain loop |
| `lib/supervisor.mjs` | Stand-in supervisor for item 1: owns the sidecar, touches the heartbeat |
| `lib/long-lived-backend.mjs` | Backend stub for item 1 and the supervision gate, so the leaf outlives the stale window |
| `packages/core/tests/bin/uat_session_env.rs` | Builds the spawn environment from the **production** functions; also `--touch-heartbeat` |
| `packages/core/tests/bin/uat_fleet_ops.rs` | Bridge binary for item 12 — calls the core functions behind the fleet commands against scratch data |
| `packages/core/tests/bin/uat_shaping_ops.rs` | Bridge binary for item 16 — calls the core functions behind Shape, Continue shaping, the dock's answers, Accept and Close Stage |
| `packages/core/tests/bin/uat_roadmap_ops.rs` | Bridge binary for item 17 — calls the core functions behind Shape on a Milestone, Confirm Done and the roadmap Round |
| `packages/core/tests/bin/uat_review_ops.rs` | Bridge binary for items 18 and 19 — calls the core functions behind Start, the Story's Task, Proposal and hand-off tools, Needs you, triage, Accept and Reject, Request changes, the review card, criterion acceptance, ADR decisions and Merge |
| `scripts/uat/fixtures/` | Frozen, real, zero-cost captures replayed offline by the sidecar tests and `lib/sidecar-harness.mjs` (e.g. the unauthenticated CLI first-turn stream) — read at module load, never retyped |
| `scripts/uat/fixtures/live-opus5-unmodelled-shapes.json` | The frozen real capture (200-character prefixes) of the reasoning-only assistant message and the `rate_limit_event` line live run `01M3C48C3PV1NSGHERBZ587YB1` emitted and the adapter did not model, with mechanical anti-drift/anti-invention gates |
| `scripts/uat/fixtures/live-opus5-ask-user-question.json` | Unlike its sibling fixture above, this one is FULL FIDELITY — read from Claude Code's own session log inside a preserved scratch root of live run `01M3DNC0G9CYAWSD8DYEGTRP8C`, not from a 200-character stderr prefix. References the committed capture artifact `planning-archive:.planning/phases/05-socratic-epic-authoring/05-ASK-USER-QUESTION-CAPTURE.json` in the phase directory, never an absolute scratch path |

The Rust binaries exist so the harness cannot drift: they call `shim::shim_env_for_run`,
`runtime_protocol::runtime_dir`, `runtime_protocol::touch_heartbeat` and the domain layer directly,
rather than reimplementing what `sidecar.rs` assembles.

---

# UAT arms outside this directory

One UAT arm lives beside the code it measures, not here. It does not run in CI.

| Arm | Harness | How to run |
|---|---|---|
| Real-browser arm (WebKit, the engine behind the macOS WKWebView shell) | `packages/desktop/src/**/*.browser.test.tsx` via `vitest.browser.config.ts` — today `fleet/__tests__/browser/fleet-jump.browser.test.tsx` and `fleet-group.browser.test.tsx` | `npm --prefix packages/desktop run test:browser` (once: `npx --prefix packages/desktop playwright install webkit`) |

jsdom has no layout engine and does not synthesise real key events, so the browser arm asks the
questions jsdom would pass vacuously. The Phase 08 review-surface browser tests this section used to
describe were deleted with the review surface (#72).
