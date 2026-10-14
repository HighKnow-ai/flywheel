---
phase: 04-clear-is-free
plan: 07
subsystem: context-reconstitution
tags: [rusqlite, tauri, git, diff-so-far, context-packet, worktree]

requires:
  - phase: 04-clear-is-free
    provides: "04-01's assemble_context_packet/render_prompt purity contract and section-ordering
      discipline; 04-06's ContextPacket.decisions and render_prompt's '## Decisions On Record' /
      '## Closing Requirement' sections, which this plan's Diff So Far section is inserted
      between"
provides:
  - "git::DiffStat/diff_stat_and_names — the committed range's stat text and changed-path list,
    read through the crate's one git wrapper"
  - "context_packet::DiffSoFar/PacketExtras/assemble_context_packet_with_extras — the packet's
    diff field and the one place a non-None diff reaches it; assemble_context_packet itself stays
    pure and always sets diff: None"
  - "render_prompt's '## Diff So Far' section: two independently-gated labelled subsections
    (committed since <base_ref>, working tree uncommitted), never a hunk body, always ending in
    the read-what-you-need invitation"
  - "commands::agent_run::diff_extras_for — the command-layer gate (worktrees row exists AND the
    path is a real directory on disk) that composes the diff one layer above the pure assembler;
    wired into both build_preview_dto and agent_run_start's re-assembly"
affects: [04-08, 04-09, 04-10, 04-14]

actuals:
  tokens: 8826
  tasks: 3
  commits: 3
  plan_head_before: 18c07980f8e73d5d4e39c104829e6dbace14a63d

tech-stack:
  added: []
  patterns:
    - "Two-call-through-one-wrapper: diff_stat_and_names issues 'git diff --stat' and
      'git diff --name-only' against the same symmetric-difference range, both through git_at,
      copying git_status_porcelain's exact one-line-body convention"
    - "Purity-preserving composition seam: assemble_context_packet_with_extras is the ONE place a
      caller-supplied extras struct (built one layer up, from a git read) attaches to an otherwise
      pure packet — assemble_context_packet itself never changes"
    - "Omit-the-heading-rather-than-emit-empty, extended a fifth time (after epic/criteria/prior
      sessions/decisions) to the Diff So Far section, with each of its two subsections gated
      independently rather than as one all-or-nothing block"

key-files:
  created: []
  modified:
    - packages/core/src/git.rs
    - packages/core/src/context_packet.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/core/tests/diff_so_far.rs

key-decisions:
  - "Consolidated git.rs's two pre-existing Command::new(\"git\") construction sites (git_at,
    rev_parse_verify) into one private spawn_git helper — a pre-existing drift from the file's own
    'the ONE place' header claim, not caused by this plan's diff read, but directly blocking this
    task's own single-construction-site verify gate (count was 2, gate required 1)"
  - "diff_extras_for's directory-presence check is not redundant with the worktrees-row existence
    check — D-45's missing status exists precisely because a row can outlive its directory, so both
    checks are required before ever calling git, matching the plan's own explicit instruction"
  - "A git error from either diff_stat_and_names or git_status_porcelain inside diff_extras_for
    degrades to PacketExtras::default() (no diff section) rather than failing the whole preview —
    a worktree in a strange state must still let the launch sheet open"
  - "build_preview_dto and agent_run_start's re-assembly both call assemble_context_packet once to
    obtain worktree facts for diff_extras_for, then assemble_context_packet_with_extras again to
    produce the final packet — a small redundant board read, accepted because it keeps the
    assembler's own single responsibility (git call happens one layer up, never inside it) and
    matches the plan's own worked key_links exactly"

requirements-completed: [CTX-03]

coverage:
  - id: D1
    description: "The briefing carries both halves of the diff as two independently-gated,
      labelled sections — the committed range from base_ref to HEAD, and the working tree's own
      uncommitted state — never merged into one blob"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "tests/diff_so_far.rs#a_diff_with_an_empty_committed_half_and_a_dirty_working_tree_renders_only_the_working_tree_subsection"
        status: pass
      - kind: unit
        ref: "tests/diff_so_far.rs#a_diff_with_a_clean_working_tree_renders_only_the_committed_subsection"
        status: pass
    human_judgment: false
  - id: D2
    description: "The packet carries the changed-file list and the stat block but never a hunk
      body, plus one line inviting the agent to read what it needs from the worktree it is
      standing in"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "tests/diff_so_far.rs#the_rendered_diff_section_never_contains_a_hunk_marker_line"
        status: pass
      - kind: unit
        ref: "tests/diff_so_far.rs#the_rendered_diff_section_ends_with_the_read_what_you_need_invitation"
        status: pass
    human_judgment: false
  - id: D3
    description: "No byte of the assembled packet comes from the session JSONL transcript, and no
      git call or process spawn enters the pure-query assembler file — structural, not aspirational"
    requirement: CTX-03
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/context_packet.rs | grep -cE 'Command::new|reqwest|ureq|tokio::process|crate::git' == 0"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/context_packet.rs | grep -cE 'session_log|\\.jsonl' == 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "A task whose worktree does not exist on disk yet (or whose directory has
      vanished) assembles a packet with no diff section at all, never an empty or an erroring one"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "tests/diff_so_far.rs#a_packet_assembled_with_no_extras_has_no_diff_and_renders_no_diff_heading"
        status: pass
      - kind: unit
        ref: "tests/diff_so_far.rs#a_task_whose_worktree_directory_has_been_removed_from_disk_yields_no_diff_when_gated"
        status: pass
    human_judgment: false
  - id: D5
    description: "Exactly one place in the workspace constructs a git process, and the new diff
      read goes through it"
    verification:
      - kind: other
        ref: "cargo test -p core --test supervisor_cwd (5/5 pass, including every_git_command_construction_lives_in_git_rs and git_rs_applies_dash_c_before_any_subcommand_argument)"
        status: pass
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/core/src/git.rs | grep -c 'Command::new(\"git\")' == 1"
        status: pass
    human_judgment: false
  - id: D6
    description: "assemble_context_packet is still a pure query: two calls against an unchanged
      database are equal, and the git read happens one layer up in the command that composes the
      briefing"
    requirement: CTX-03
    verification:
      - kind: unit
        ref: "tests/diff_so_far.rs#assemble_context_packet_twice_against_an_unchanged_database_stays_diff_none_on_both"
        status: pass
      - kind: unit
        ref: "tests/diff_so_far.rs#assemble_context_packet_with_extras_twice_with_the_same_extras_returns_equal_packets"
        status: pass
    human_judgment: false
  - id: D7
    description: "The launch sheet's preview and the real run's prompt are built through the same
      composition path, and a task with a real worktree and a dirty file produces a diff whose
      working-tree half names that file"
    verification:
      - kind: other
        ref: "grep -v '^[[:space:]]*//' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -c 'assemble_context_packet_with_extras' == 3 (>= 2 required: build_preview_dto, agent_run_start)"
        status: pass
      - kind: unit
        ref: "tests/diff_so_far.rs#a_task_with_a_real_worktree_and_a_dirty_file_produces_a_diff_naming_that_file"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-09-23
status: complete
---

# Phase 4 Plan 7: Diff So Far — Committed Range Plus Working Tree, Carried Through the One Git Wrapper

**The context packet now carries both halves of what changed as two independently-gated, hunk-free sections (stat block, path list, and a read-what-you-need invitation) — composed one layer above the pure assembler, through a command-layer gate that skips the git read entirely for a task with no worktree on disk.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-09-23T01:21:47Z (immediately following plan 04-06)
- **Completed:** 2026-09-23T01:39:36Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- `git::DiffStat`/`diff_stat_and_names(repo_path, base_ref)`: two calls through the existing
  `git_at` wrapper (`git diff --stat`/`git diff --name-only` against the symmetric-difference
  range `<base_ref>...HEAD`), copying `git_status_porcelain`'s exact one-line-body convention. No
  parsing beyond splitting the name-only output on newlines. Consolidated `git.rs`'s two
  pre-existing `Command::new("git")` sites (`git_at`, `rev_parse_verify`) into one private
  `spawn_git` helper so the file's own "the ONE place" header claim is now structurally true — a
  pre-existing drift this task's own verify gate caught.
- `context_packet::DiffSoFar`/`PacketExtras`/`assemble_context_packet_with_extras`: the packet
  gains `diff: Option<DiffSoFar>`, always `None` from `assemble_context_packet` itself (its purity
  contract — no git call, no write — is unchanged). The wrapper is the ONLY place a non-`None`
  diff ever reaches a packet, with its doc comment stating the determinism distinction explicitly
  (unchanged database *and* extras, not just unchanged database).
- `render_prompt`'s `## Diff So Far` section (after `## Decisions On Record`, before
  `## Additional Instructions`): two independently-gated subsections — `### Committed since
  <base_ref>` (stat text plus a `- ` path list) and `### Working tree (uncommitted)` (raw
  porcelain text) — never a hunk body, always ending with "You are in this worktree — read any of
  these files directly for the full detail."
- `commands::agent_run::diff_extras_for`: the command-layer gate, one layer above the pure
  assembler — no diff at all unless a `worktrees` row exists for the task AND
  `packet.worktree.path` is a real directory on disk right now (D-45's `missing` status means a
  row can outlive its directory). A git error from either read degrades to no diff rather than
  failing the whole preview. Wired into both `build_preview_dto` and `agent_run_start`'s
  re-assembly, so the launch sheet's preview and the actual run's prompt can never carry a
  different diff section (T-02-21). `ContextPacketDto` gains `diff: Option<DiffSoFarDto>`.
- `tests/diff_so_far.rs`: 14 tests across all three tasks — the committed-range read against real
  git repositories (5), the packet/render_prompt behaviours including determinism (7), and the
  command-layer gate exercised at the core level (2: a vanished worktree directory, and a real
  worktree with a dirty file).

## Task Commits

Each task was committed atomically:

1. **Task 1: diff_stat_and_names — one more call through the one git wrapper** - `7d2b8a6` (feat)
2. **Task 2: The packet carries both halves, and the assembler stays pure** - `163498c` (feat)
3. **Task 3: The command layer composes it — and only when there is a worktree to diff** - `554208b` (feat)

_No plan metadata commit required beyond these three — STATE.md/ROADMAP.md updates follow in this
same session._

## Files Created/Modified

- `packages/core/src/git.rs` - `DiffStat`, `diff_stat_and_names`, and the `spawn_git` consolidation
  of `git_at`/`rev_parse_verify`'s two construction sites into one
- `packages/core/src/context_packet.rs` - `DiffSoFar`, `PacketExtras`,
  `assemble_context_packet_with_extras`, `ContextPacket.diff`, `render_prompt`'s Diff So Far section
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - `diff_extras_for`, `DiffSoFarDto`,
  `ContextPacketDto.diff`, rewired `build_preview_dto`/`agent_run_start`
- `packages/core/tests/diff_so_far.rs` - 14 tests across the committed-range read, the
  packet/prompt extension, and the command-layer gate

## Decisions Made

- `git.rs`'s two pre-existing `Command::new("git")` construction sites were consolidated into one
  private `spawn_git` helper — not caused by this plan's diff read, but the file's own module
  header already claimed "the ONE place ... constructs a `Command::new(\"git\")`" and this task's
  own `<verify>` gate required the count to be exactly 1; it was 2 before this fix (Rule 1 — the
  claimed invariant was false).
- `diff_extras_for`'s directory-presence check is deliberately independent of, and in addition to,
  the `worktrees`-row existence check — a recorded row can outlive its directory (D-45), and
  diffing a path that is not there would turn a preview into an error rather than an omitted
  section.
- A git error from either `diff_stat_and_names` or `git_status_porcelain` inside `diff_extras_for`
  degrades to `PacketExtras::default()` rather than propagating — the launch sheet must still open
  for a worktree in a strange state.
- `build_preview_dto` and `agent_run_start`'s re-assembly both call `assemble_context_packet` once
  (to obtain the worktree facts `diff_extras_for` needs) and `assemble_context_packet_with_extras`
  again to produce the final packet — a small redundant board read accepted in exchange for
  keeping the git call strictly one layer above the pure assembler, matching the plan's own
  key_links exactly (`agent_run.rs` reads git and passes the result into
  `assemble_context_packet_with_extras`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Consolidated git.rs's two Command::new("git") construction sites into one**
- **Found during:** Task 1 (running the plan's own single-construction-site `<verify>` gate)
- **Issue:** `git.rs`'s module header states it is "the ONE place in this workspace that
  constructs a `Command::new(\"git\")`," but `rev_parse_verify` (added in an earlier phase)
  already built its own `Command::new("git")` independently of `git_at`. The grep count was 2
  before this plan touched the file at all — a pre-existing drift from the file's own documented
  invariant, not something this plan's diff-read addition introduced, but it directly failed this
  task's own `<verify>` gate (which requires the count to be exactly 1).
- **Fix:** Factored a private `spawn_git(repo_path, args) -> anyhow::Result<Output>` helper that
  both `git_at` (wraps it with the "non-zero exit is an `Err`" policy) and `rev_parse_verify`
  (wraps it with the "non-zero exit means `false`" policy) call — one `Command::new("git")`
  construction site in the file, behavior of both callers unchanged.
- **Files modified:** `packages/core/src/git.rs`
- **Verification:** `cargo test -p core --test supervisor_cwd` (5/5), `cargo test -p core --test worktree_lifecycle` (2/2, exercises `rev_parse_verify` transitively via `worktree_add`), the literal grep count now reads 1.
- **Committed in:** `7d2b8a6` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, in-scope — required to pass this task's own `<verify>` gate on a file this plan already modifies)
**Impact on plan:** No scope creep; the fix consolidates two pre-existing call sites in the exact file this task adds to, with no behavior change to either caller.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-70/D-71 are now fully implemented: the briefing carries the committed range and the working
  tree as two labelled, independently-gated sections, with a stat block, a path list and a
  read-what-you-need invitation — no hunk bodies, no error on a missing worktree.
- The packet assembler's purity contract (no git call, no process spawn, no transcript read) is
  preserved and re-verified by both this plan's own grep gates and 04-01's original ones.
- `assemble_context_packet_with_extras` is now the seam later plans compose through — 04-10's
  drift field is explicitly designed to extend `PacketExtras` without changing this function's
  signature (per its own doc comment).
- `ContextPacketDto.diff` is on the wire (camelCase) for plan 04-08's rendering work in
  `LaunchSheet.tsx` to consume.
- CTX-03 is declared by this plan alone in this phase's `requirements` frontmatter scan — no
  shared-id gate blocking.
- No blockers for 04-08.

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*

## Self-Check: PASSED

- FOUND: packages/core/src/git.rs
- FOUND: packages/core/src/context_packet.rs
- FOUND: packages/desktop/src-tauri/src/commands/agent_run.rs
- FOUND: packages/core/tests/diff_so_far.rs
- FOUND commit 7d2b8a6 in git log
- FOUND commit 163498c in git log
- FOUND commit 554208b in git log
- `cargo test -p core --test diff_so_far`: 14 passed, 0 failed
- `cargo test -p core --test supervisor_cwd`: 5 passed, 0 failed
- `cargo test -p core --test context_packet`: 10 passed, 0 failed
- `cargo build --workspace`: clean
- `cargo test --workspace`: every suite reports 0 failed (verified via full log, exit code 0)
