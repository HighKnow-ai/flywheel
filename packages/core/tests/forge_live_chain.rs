//! Closes verification criterion 3's behavior-unverified item (LINK-05/06/07/08 in combination,
//! phase 07 plan 07-12): the whole open-request-to-status-write chain, driven for real.
//!
//! The ONLY substituted component is the forge server itself — a `gh` shell stub standing in for
//! GitHub's API, written at runtime into a scratch directory and prepended to `PATH`. Every other
//! layer is the real production path: a real child process is spawned through
//! [`core::forge::create_request_at`] / [`core::forge::request_for_branch_at`] exactly as the
//! scheduler tick and the Tauri command drive after plan 07-11, the real JSON normaliser inside
//! `forge::github` reads the real stdout that child produced, the real edge detector
//! ([`core::forge::transitions::apply_forge_observation`]) reads its baseline from the real
//! append-only `events` log, and the real transaction-scoped status writer moves the task.
//!
//! This harness never contacts a real forge, never creates a real pull or merge request, and
//! never reads, writes or requires a forge credential — it is proven to pass with every
//! GitHub/GitLab authentication variable unset (see this file's own `<verify>` gate in
//! 07-12-PLAN.md), so it runs identically whether or not the developer has ever authenticated
//! either CLI.
//!
//! Both the GitHub and GitLab arms drive [`assert_open_to_merged_chain`] — ONE shared assertion
//! sequence, called once per forge — deliberately, not by accident of code reuse: the two
//! adapters are independent by design (`forge/github.rs`'s and `forge/gitlab.rs`'s own header
//! comments both say so), and a harness that proved one arm and silently trusted the other would
//! reproduce exactly the cross-adapter assumption those headers forbid.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::actor::system_actor;
use core::domain::settings::set_project_forge;
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use core::forge::request_body::{assemble_request_draft, RequestDraft};
use core::forge::transitions::{apply_forge_observation, EVENT_FORGE_STATE_CHANGED};
use core::domain::epic::create_epic;
use core::forge::request_body::assemble_epic_request_draft;
use core::forge::{
    create_request_at, forge_and_repo_path, open_epic_request_at, request_for_branch_at, CiResult,
    EpicRequestOutcome, Forge, ForgeError, ForgeState,
};
use core::query::events::activity_trail;
use rusqlite::Connection;

/// Serializes every call to [`with_fake_forge_clis`] in THIS binary — `PATH` is process-global
/// mutable state and `cargo test` runs `#[test]` fns concurrently by default. Mirrors
/// `forge_degrade.rs`'s own `ENV_LOCK`; each `tests/*.rs` file compiles to its own binary, so this
/// static cannot race with that one.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serializes every call to [`with_scratch_worktree_root`] in this binary, mirroring
/// `forge_request_body.rs`'s own lock for the identical reason: `FLYWHEEL_WORKTREE_ROOT` is
/// process-wide state.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above — only one test at a time ever has
    // this var set within this binary, and it is always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Local helper mirroring `status_transitions.rs`'s own `count_events_of_type` — the trail read
/// is the real append-only log, never a synthetic count.
fn count_events_of_type(conn: &Connection, task_id: &str, event_type: &str) -> usize {
    activity_trail(conn, "task", task_id, 200, 0)
        .expect("trail read should succeed")
        .into_iter()
        .filter(|e| e.event_type == event_type)
        .count()
}

fn task_status(conn: &Connection, task_id: &str) -> String {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |row| row.get(0))
        .expect("status read should succeed")
}

/// A handle onto the fake forge's scratch state directory. The `gh`/`glab` shell stubs this
/// struct writes are the ONLY substituted component in the whole chain this file proves — every
/// other layer (argv construction, body transport, JSON normalisation, the edge detector, the
/// status writer) is the real production path.
///
/// State files, each a single line so the shell stubs can read them with one `cat`:
/// `state` (the forge-side request state the fake reports), `ci` (which CI rollup shape to
/// emit), `entries` (how many requests the list call reports). `body.txt` and `argv.txt` are
/// written BY the stubs, not by this struct — [`FakeForge::body`] and [`FakeForge::argv_lines`]
/// read them back.
struct FakeForge {
    dir: tempfile::TempDir,
}

impl FakeForge {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("failed to create fake-forge scratch dir");
        for (name, script) in
            [("gh", gh_stub_script(dir.path())), ("glab", glab_stub_script(dir.path()))]
        {
            let path = dir.path().join(name);
            std::fs::write(&path, script).unwrap_or_else(|e| panic!("failed to write {name} stub: {e}"));
            let mut perms =
                std::fs::metadata(&path).unwrap_or_else(|e| panic!("{name} stub metadata: {e}")).permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&path, perms)
                .unwrap_or_else(|e| panic!("failed to chmod {name} stub: {e}"));
        }
        Self { dir }
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    /// Write the forge-side request state the fake reports on its next `list`/`view` call. The
    /// literal `"NONE"` means "no request at all" — the sentinel both stubs check first.
    fn set_state(&self, value: &str) {
        std::fs::write(self.dir.path().join("state"), value).expect("failed to write state");
    }

    /// `"none"` (the default when unset) emits an empty CI rollup; any other value emits a single
    /// completed/passed check.
    fn set_ci(&self, value: &str) {
        std::fs::write(self.dir.path().join("ci"), value).expect("failed to write ci");
    }

    /// `1` (the default when unset) emits one request; `2` emits two, with different timestamps
    /// and numbers, so the newest-wins selection is exercised through the live subprocess path.
    fn set_entries(&self, n: usize) {
        std::fs::write(self.dir.path().join("entries"), n.to_string()).expect("failed to write entries");
    }

    /// Turn on a stub behaviour by creating its flag file: `create_fail` makes `pr create` fail
    /// with a stderr that must never reach a caller; `unauth` makes the CLI report that it is not
    /// authenticated.
    fn set_flag(&self, name: &str) {
        std::fs::write(self.dir.path().join(name), "1").expect("failed to write flag");
    }

    /// The body the fake's create call actually received — written by the stub reading its own
    /// standard input to end, never asserted by this struct itself.
    fn body(&self) -> String {
        std::fs::read_to_string(self.dir.path().join("body.txt")).unwrap_or_default()
    }

    /// Every argument every invocation of the fake received, one per line, across every call made
    /// during the current [`with_fake_forge_clis`] closure — never reset mid-closure, so a test
    /// asserting "never invoked with X" sees every call the whole closure made.
    fn argv_lines(&self) -> Vec<String> {
        std::fs::read_to_string(self.dir.path().join("argv.txt"))
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    /// Whether any accumulated argument, read as one line, exactly equals `token` — used to
    /// assert a whole subcommand word (e.g. `"view"`) was or was not ever passed, without a
    /// substring match that could accidentally match inside an unrelated value. GitHub's own
    /// chain never calls this (it has one subprocess, not two); the GitLab arm uses it to prove
    /// the two-subprocess read (`mr list` then `mr view`) and the no-`iid`-means-no-view case.
    fn argv_has_token(&self, token: &str) -> bool {
        self.argv_lines().iter().any(|line| line == token)
    }

    /// Whether the fake was invoked at ALL during the current closure — the harness's own
    /// safety guard (T-07-12-01): if the path substitution failed to take effect, this is
    /// `false` and the harness must fail rather than silently trust a result that could only
    /// have come from a real CLI.
    fn invoked(&self) -> bool {
        self.dir.path().join("invoked.marker").exists()
    }
}

/// The ONE way a standalone test reads a request through the live path: the lookup and the
/// "was the fake reached" guard travel together, so a new test cannot assert on a result without
/// having proved it came from the stub. If the `PATH` substitution failed, this test exercised a
/// real `gh`/`glab` on the developer's machine instead of the harness's fake, and a harness that
/// can pass without reaching its own fake proves nothing (T-07-12-01 / T-15-09).
/// `assert_open_to_merged_chain` carries the same guard inline because it asserts after
/// `create_request_at`, not after a lookup.
fn observe_branch(
    fake: &FakeForge,
    forge: Forge,
    repo_path: &Path,
    branch: &str,
) -> Result<Option<core::forge::ForgeRequest>, ForgeError> {
    let observed = request_for_branch_at(forge, repo_path, branch);
    assert!(
        fake.invoked(),
        "the fake must have been invoked before any result is trusted — the PATH substitution \
         failed, so this test reached a real gh/glab on this machine instead of the harness's \
         stub, and a harness that can pass without reaching its own fake proves nothing"
    );
    observed
}

/// Generate the `gh` stub's shell source with `dir`'s absolute path baked into its text exactly
/// as `forge_degrade.rs`'s own sabotage stub bakes its marker path — `.replace`, not `format!`,
/// because the JSON this stub emits is otherwise a brace-escaping minefield under `format!`.
fn gh_stub_script(dir: &Path) -> String {
    let template = r##"#!/bin/sh
for a in "$@"; do printf '%s\n' "$a" >> "__DIR__/argv.txt"; done
touch "__DIR__/invoked.marker"

cmd1="$1"
cmd2="$2"

if [ "$cmd1" = "auth" ] && [ "$cmd2" = "status" ]; then
  [ -f "__DIR__/unauth" ] && exit 1
  exit 0
fi

if [ "$cmd1" = "pr" ] && [ "$cmd2" = "create" ]; then
  if [ -f "__DIR__/create_fail" ]; then
    echo "boom: /secret/path/leaked-token" >&2
    exit 1
  fi
  cat > "__DIR__/body.txt"
  echo "OPEN" > "__DIR__/state"
  exit 0
fi

if [ "$cmd1" = "pr" ] && [ "$cmd2" = "list" ]; then
  if [ -f "__DIR__/unauth" ]; then
    echo "authentication required: run gh auth login" >&2
    exit 1
  fi
  state=$(cat "__DIR__/state" 2>/dev/null || echo "NONE")
  ci=$(cat "__DIR__/ci" 2>/dev/null || echo "none")
  entries=$(cat "__DIR__/entries" 2>/dev/null || echo "1")

  if [ "$state" = "NONE" ]; then
    echo "[]"
    exit 0
  fi

  if [ "$ci" = "none" ]; then
    rollup="[]"
  else
    rollup='[{"status":"COMPLETED","conclusion":"SUCCESS","detailsUrl":"https://example.invalid/ci/1"}]'
  fi

  if [ "$entries" = "2" ]; then
    printf '[{"number":4242,"state":"%s","url":"https://example.invalid/pr/4242","title":"Fake PR","isDraft":false,"reviewDecision":"","baseRefName":"main","createdAt":"2026-01-01T00:00:00Z","statusCheckRollup":%s},{"number":4243,"state":"%s","url":"https://example.invalid/pr/4243","title":"Fake PR newer","isDraft":false,"reviewDecision":"","baseRefName":"main","createdAt":"2026-01-02T00:00:00Z","statusCheckRollup":%s}]\n' "$state" "$rollup" "$state" "$rollup"
  else
    printf '[{"number":4242,"state":"%s","url":"https://example.invalid/pr/4242","title":"Fake PR","isDraft":false,"reviewDecision":"","baseRefName":"main","createdAt":"2026-01-01T00:00:00Z","statusCheckRollup":%s}]\n' "$state" "$rollup"
  fi
  exit 0
fi

echo "unexpected gh invocation: $*" >&2
exit 1
"##;
    template.replace("__DIR__", &dir.display().to_string())
}

/// Generate the `glab` stub's shell source — same `.replace` discipline as [`gh_stub_script`].
/// GitLab needs two subprocesses where GitHub needs one (`gitlab.rs`'s own header comment):
/// `mr list` carries `state`/`iid`, `mr view <iid>` carries `head_pipeline`. The `mr create`
/// branch reads the `--description-file` argument's VALUE by scanning the argument vector for
/// it, never by assuming a fixed position, because `create_request_args` may be reordered by a
/// future change (07-12-PLAN.md Task 2's own instruction).
fn glab_stub_script(dir: &Path) -> String {
    let template = r##"#!/bin/sh
for a in "$@"; do printf '%s\n' "$a" >> "__DIR__/argv.txt"; done
touch "__DIR__/invoked.marker"

cmd1="$1"
cmd2="$2"

if [ "$cmd1" = "auth" ] && [ "$cmd2" = "status" ]; then
  exit 0
fi

if [ "$cmd1" = "mr" ] && [ "$cmd2" = "create" ]; then
  desc_path=""
  prev=""
  for a in "$@"; do
    if [ "$prev" = "--description-file" ]; then
      desc_path="$a"
    fi
    prev="$a"
  done
  if [ -n "$desc_path" ]; then
    cp "$desc_path" "__DIR__/body.txt"
  fi
  echo "opened" > "__DIR__/state"
  exit 0
fi

if [ "$cmd1" = "mr" ] && [ "$cmd2" = "list" ]; then
  state=$(cat "__DIR__/state" 2>/dev/null || echo "NONE")
  entries=$(cat "__DIR__/entries" 2>/dev/null || echo "1")

  if [ "$state" = "NONE" ]; then
    echo "[]"
    exit 0
  fi

  if [ "$entries" = "2" ]; then
    printf '[{"iid":77,"created_at":"2026-01-01T00:00:00Z","title":"Fake MR","web_url":"https://example.invalid/mr/77","state":"%s"},{"iid":78,"created_at":"2026-01-02T00:00:00Z","title":"Fake MR newer","web_url":"https://example.invalid/mr/78","state":"%s"}]\n' "$state" "$state"
  else
    printf '[{"iid":77,"created_at":"2026-01-01T00:00:00Z","title":"Fake MR","web_url":"https://example.invalid/mr/77","state":"%s"}]\n' "$state"
  fi
  exit 0
fi

if [ "$cmd1" = "mr" ] && [ "$cmd2" = "view" ]; then
  state=$(cat "__DIR__/state" 2>/dev/null || echo "NONE")
  ci=$(cat "__DIR__/ci" 2>/dev/null || echo "none")
  iid="$3"

  if [ "$ci" = "none" ]; then
    pipeline="null"
  else
    pipeline='{"status":"success","web_url":"https://example.invalid/pipeline/1"}'
  fi

  printf '{"iid":%s,"title":"Fake MR","web_url":"https://example.invalid/mr/%s","state":"%s","target_branch":"main","head_pipeline":%s}\n' "$iid" "$iid" "$state" "$pipeline"
  exit 0
fi

echo "unexpected glab invocation: $*" >&2
exit 1
"##;
    template.replace("__DIR__", &dir.display().to_string())
}

/// Write the fake forge's `gh` and `glab` stubs into a fresh scratch directory and prepend it to
/// `PATH` for the duration of `f`, serialised against every other caller in this binary via
/// [`ENV_LOCK`], restoring the original `PATH` before returning — the same shape
/// `forge_degrade.rs`'s own `with_sabotaged_forge_clis` uses, extended here from a marker-only
/// stub to a functional one.
fn with_fake_forge_clis<T>(f: impl FnOnce(&FakeForge) -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let fake = FakeForge::new();

    let original_path = std::env::var_os("PATH");
    let augmented = match &original_path {
        Some(p) => format!("{}:{}", fake.path().display(), p.to_string_lossy()),
        None => fake.path().display().to_string(),
    };
    // SAFETY: the mutex above serialises every caller in this binary, so no other thread reads
    // or mutates PATH while it's set, and this helper always restores it before returning.
    unsafe {
        std::env::set_var("PATH", &augmented);
    }

    let result = f(&fake);

    unsafe {
        match &original_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }
    result
}

/// Seed one project pinned to `forge_name` (`"github"` or `"gitlab"`), one task with a worktree
/// and one acceptance criterion (left unchecked, so the merged poll's done-with-unmet-criteria
/// path is exercised too), resolve the forge/repo-path pair and assemble the request draft
/// exactly as the production callers do. Returns everything a chain test needs; the repo dir
/// and worktree-root scratch dir are kept alive by the caller for the test's duration.
fn seed_task_for(forge_name: &str, expected: Forge) -> (
    Connection,
    String,
    String,
    Forge,
    std::path::PathBuf,
    RequestDraft,
    tempfile::TempDir,
) {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    set_project_forge(&mut conn, &actor_id, &project.id, Some(forge_name))
        .expect("set_project_forge should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Wire the live chain", None)
        .expect("create_task should succeed");
    ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
    create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Proves the chain", None)
        .expect("create_criterion should succeed");

    let (forge, repo_path) =
        forge_and_repo_path(&conn, &project.id).expect("forge_and_repo_path should succeed");
    assert_eq!(forge, expected, "the stored override must resolve to the forge it names");

    let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");

    (conn, actor_id, task.id, forge, repo_path, draft, repo_dir)
}

fn seed_github_task() -> (
    Connection,
    String,
    String,
    Forge,
    std::path::PathBuf,
    RequestDraft,
    tempfile::TempDir,
) {
    seed_task_for("github", Forge::GitHub)
}

fn seed_gitlab_task() -> (
    Connection,
    String,
    String,
    Forge,
    std::path::PathBuf,
    RequestDraft,
    tempfile::TempDir,
) {
    seed_task_for("gitlab", Forge::GitLab)
}

/// The ONE shared assertion sequence both the GitHub and GitLab arms call — see this file's own
/// header comment for why that sharing is deliberate. Opens `draft` through the real
/// [`create_request_at`] path, proves the body transport, then walks the same
/// open → in_review → merged → done → unchanged three-poll sequence
/// [`status_transitions.rs`]'s hermetic suite already proves against synthetic values — this
/// time through a real child process end to end. `merged_state_value` is the literal state
/// string that forge's own fake must report once "merged" ( `"MERGED"` for GitHub, `"merged"`
/// for GitLab) — the two adapters' vocabularies differ by design (see `github.rs`'s and
/// `gitlab.rs`'s own mapping tables), so this is the one parameter that must vary per call.
fn assert_open_to_merged_chain(
    conn: &mut Connection,
    task_id: &str,
    system_actor_id: &str,
    forge: Forge,
    repo_path: &Path,
    draft: &RequestDraft,
    fake: &FakeForge,
    merged_state_value: &str,
) {
    // Open the request through the real production path.
    let opened = create_request_at(forge, repo_path, draft)
        .expect("create_request_at should succeed against the fake CLI");

    assert!(
        fake.invoked(),
        "the fake must have been invoked before any result is trusted — a failed path \
         substitution must fail loudly, never silently reach a real forge CLI"
    );
    assert_eq!(fake.body(), draft.body, "the child must receive draft.body byte-for-byte");
    assert!(
        !fake.argv_lines().iter().any(|line| line.contains(&draft.body)),
        "the body must never appear anywhere in the recorded argument vector"
    );
    assert_eq!(opened.state, ForgeState::Open);

    // First poll: moves the task to in_review.
    let observed1 = request_for_branch_at(forge, repo_path, &draft.head_branch)
        .expect("request_for_branch_at should succeed")
        .expect("a request must be found immediately after opening one");
    let outcome1 = apply_forge_observation(conn, task_id, Some(&observed1), system_actor_id, None)
        .expect("apply_forge_observation should succeed");
    assert_eq!(outcome1.status_changed_to, Some("in_review".to_string()));
    assert_eq!(count_events_of_type(conn, task_id, EVENT_FORGE_STATE_CHANGED), 1);
    assert_eq!(task_status(conn, task_id), "in_review");

    // The forge side merges; the fake's state file is flipped directly — no synthetic value
    // handed to the detector, but a real poll of the (now-merged) fake afterward.
    fake.set_state(merged_state_value);
    let observed2 = request_for_branch_at(forge, repo_path, &draft.head_branch)
        .expect("request_for_branch_at should succeed")
        .expect("a request must still be found after merging");
    let outcome2 = apply_forge_observation(conn, task_id, Some(&observed2), system_actor_id, None)
        .expect("apply_forge_observation should succeed");
    assert_eq!(outcome2.status_changed_to, Some("done".to_string()));
    assert_eq!(count_events_of_type(conn, task_id, EVENT_FORGE_STATE_CHANGED), 2);
    assert_eq!(task_status(conn, task_id), "done");
    // The seeded criterion was left unchecked — the merge must have surfaced that as an event,
    // never silently closed it (D-123: the detector never touches a criterion row).
    assert_eq!(count_events_of_type(conn, task_id, "task.done_with_unmet_criteria"), 1);

    // Third poll: the fake is unchanged — nothing is written at all.
    let before = count_events_of_type(conn, task_id, EVENT_FORGE_STATE_CHANGED);
    let observed3 = request_for_branch_at(forge, repo_path, &draft.head_branch)
        .expect("request_for_branch_at should succeed")
        .expect("a request must still be found on the third, unchanged poll");
    let outcome3 = apply_forge_observation(conn, task_id, Some(&observed3), system_actor_id, None)
        .expect("apply_forge_observation should succeed");
    assert_eq!(outcome3.status_changed_to, None);
    assert_eq!(outcome3.events_appended, 0);
    assert_eq!(count_events_of_type(conn, task_id, EVENT_FORGE_STATE_CHANGED), before);
    assert_eq!(task_status(conn, task_id), "done");
}

#[test]
fn github_open_to_in_review_to_done_chain_runs_through_a_real_child_process() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, task_id, forge, repo_path, draft, _repo_dir) = seed_github_task();
        let system = system_actor(&conn).expect("system actor should exist");

        with_fake_forge_clis(|fake| {
            assert_open_to_merged_chain(
                &mut conn, &task_id, &system.id, forge, &repo_path, &draft, fake, "MERGED",
            );
        });
    });
}

#[test]
fn github_branch_with_no_request_yields_no_request_and_no_transition() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, task_id, forge, repo_path, draft, _repo_dir) = seed_github_task();
        let system = system_actor(&conn).expect("system actor should exist");

        with_fake_forge_clis(|fake| {
            fake.set_state("NONE");
            let observed = observe_branch(fake, forge, &repo_path, &draft.head_branch)
                .expect("request_for_branch_at should succeed");
            assert!(observed.is_none(), "a branch the fake reports no request for must yield None");

            let outcome = apply_forge_observation(&mut conn, &task_id, observed.as_ref(), &system.id, None)
                .expect("apply_forge_observation should succeed");
            assert_eq!(outcome.status_changed_to, None);
            assert_eq!(outcome.events_appended, 0);
            // Started by its worktree's creation (DRFT-04), not by this observation.
            assert_eq!(task_status(&conn, &task_id), "in_progress");
        });
    });
}

#[test]
fn github_request_with_no_ci_run_normalises_to_no_ci_result() {
    with_scratch_worktree_root(|| {
        let (_conn, _actor_id, _task_id, forge, repo_path, draft, _repo_dir) = seed_github_task();

        with_fake_forge_clis(|fake| {
            fake.set_state("OPEN");
            fake.set_ci("none");
            let observed = observe_branch(fake, forge, &repo_path, &draft.head_branch)
                .expect("request_for_branch_at should succeed")
                .expect("a request must be found");
            assert_eq!(observed.ci, CiResult::None);
        });
    });
}

#[test]
fn github_two_requests_select_the_newest_by_created_timestamp_through_the_live_path() {
    with_scratch_worktree_root(|| {
        let (_conn, _actor_id, _task_id, forge, repo_path, draft, _repo_dir) = seed_github_task();

        with_fake_forge_clis(|fake| {
            fake.set_state("OPEN");
            fake.set_entries(2);
            let observed = observe_branch(fake, forge, &repo_path, &draft.head_branch)
                .expect("request_for_branch_at should succeed")
                .expect("a request must be found");
            assert_eq!(
                observed.number, 4243,
                "the entry with the lexicographically-newest createdAt must be selected"
            );
        });
    });
}

// ---------------------------------------------------------------------------------------------
// The GitLab arm — same assertion sequence via assert_open_to_merged_chain, plus the
// GitLab-specific two-subprocess (`mr list` then `mr view`) assertions neither forge shares.
// ---------------------------------------------------------------------------------------------

#[test]
fn gitlab_open_to_in_review_to_done_chain_runs_through_a_real_child_process() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, task_id, forge, repo_path, draft, _repo_dir) = seed_gitlab_task();
        let system = system_actor(&conn).expect("system actor should exist");

        with_fake_forge_clis(|fake| {
            assert_open_to_merged_chain(
                &mut conn, &task_id, &system.id, forge, &repo_path, &draft, fake, "merged",
            );
            // GitLab-specific: the two-subprocess read is exercised — both `mr list` and
            // `mr view` must have been invoked for a branch that has a request.
            assert!(fake.argv_has_token("list"), "mr list must have been invoked");
            assert!(fake.argv_has_token("view"), "mr view must have been invoked for the found iid");
        });
    });
}

#[test]
fn gitlab_description_reaches_the_cli_as_a_file_not_as_an_argv_value() {
    with_scratch_worktree_root(|| {
        let (_conn, _actor_id, _task_id, forge, repo_path, draft, _repo_dir) = seed_gitlab_task();

        with_fake_forge_clis(|fake| {
            let opened = create_request_at(forge, &repo_path, &draft)
                .expect("create_request_at should succeed against the fake glab");
            assert_eq!(opened.state, ForgeState::Open);
            assert_eq!(
                fake.body(),
                draft.body,
                "the description file's contents must be byte-identical to draft.body"
            );
            assert!(
                !fake.argv_lines().iter().any(|line| line.contains(&draft.body)),
                "the body must never appear anywhere in the recorded argument vector — only its \
                 file's path does"
            );
            assert!(
                fake.argv_has_token("--description-file"),
                "the create call must pass --description-file"
            );
        });
    });
}

#[test]
fn gitlab_branch_with_no_request_yields_no_request_and_never_calls_view() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, task_id, forge, repo_path, draft, _repo_dir) = seed_gitlab_task();
        let system = system_actor(&conn).expect("system actor should exist");

        with_fake_forge_clis(|fake| {
            fake.set_state("NONE");
            let observed = observe_branch(fake, forge, &repo_path, &draft.head_branch)
                .expect("request_for_branch_at should succeed");
            assert!(observed.is_none(), "a branch the fake reports no request for must yield None");
            assert!(fake.argv_has_token("list"), "mr list must still have been invoked");
            assert!(
                !fake.argv_has_token("view"),
                "mr view must never be invoked when there is no iid to view"
            );

            let outcome = apply_forge_observation(&mut conn, &task_id, observed.as_ref(), &system.id, None)
                .expect("apply_forge_observation should succeed");
            assert_eq!(outcome.status_changed_to, None);
            assert_eq!(outcome.events_appended, 0);
            // Started by its worktree's creation (DRFT-04), not by this observation.
            assert_eq!(task_status(&conn, &task_id), "in_progress");
        });
    });
}

#[test]
fn gitlab_request_with_no_head_pipeline_normalises_to_no_ci_result() {
    with_scratch_worktree_root(|| {
        let (_conn, _actor_id, _task_id, forge, repo_path, draft, _repo_dir) = seed_gitlab_task();

        with_fake_forge_clis(|fake| {
            fake.set_state("opened");
            fake.set_ci("none");
            let observed = observe_branch(fake, forge, &repo_path, &draft.head_branch)
                .expect("request_for_branch_at should succeed")
                .expect("a request must be found");
            assert_eq!(observed.ci, CiResult::None);
        });
    });
}

#[test]
fn gitlab_two_requests_select_the_newest_by_created_timestamp_through_the_live_path() {
    with_scratch_worktree_root(|| {
        let (_conn, _actor_id, _task_id, forge, repo_path, draft, _repo_dir) = seed_gitlab_task();

        with_fake_forge_clis(|fake| {
            fake.set_state("opened");
            fake.set_entries(2);
            let observed = observe_branch(fake, forge, &repo_path, &draft.head_branch)
                .expect("request_for_branch_at should succeed")
                .expect("a request must be found");
            assert_eq!(
                observed.number, 78,
                "the entry with the lexicographically-newest created_at must be selected"
            );
        });
    });
}

// ----- REVW-05: an epic's push-then-create chain (plan 08-05) -----
//
// The forge server is the only substituted component. The remote is a REAL local bare repository,
// so the push is a real push and "the branch is on the remote" is read from the remote itself.

const INTEGRATION: &str = "flywheel/epic-int";

fn git_in(path: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// Whether the bare remote has `branch` (and at which sha).
fn remote_tip(remote: &Path, branch: &str) -> Option<String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(remote)
        .args(["rev-parse", "--verify", "--quiet", &format!("refs/heads/{branch}")])
        .output()
        .expect("spawn git");
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

struct EpicChain {
    conn: Connection,
    epic_id: String,
    task_id: String,
    forge: Forge,
    repo_path: std::path::PathBuf,
    remote: tempfile::TempDir,
    draft: RequestDraft,
    _repo_dir: tempfile::TempDir,
}

/// A GitHub-pinned project whose integration branch is one commit ahead of `main`, with a real bare
/// remote named `origin`, an epic with one task, and the epic's draft already assembled.
fn seed_epic_chain() -> EpicChain {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let b = common::review_branches(repo_dir.path());
    assert_eq!(b.integration, INTEGRATION);
    set_project_forge(&mut conn, &actor_id, &project.id, Some("github")).expect("set_project_forge");

    git_in(repo_dir.path(), &["checkout", INTEGRATION]);
    std::fs::write(repo_dir.path().join("epic_work.txt"), "work\n").unwrap();
    git_in(repo_dir.path(), &["add", "epic_work.txt"]);
    git_in(repo_dir.path(), &["commit", "-m", "epic work"]);
    git_in(repo_dir.path(), &["checkout", "main"]);

    let remote = tempfile::tempdir().expect("remote dir");
    git_in(remote.path(), &["init", "--bare", "--initial-branch=main"]);
    git_in(repo_dir.path(), &["remote", "add", "origin", &remote.path().to_string_lossy()]);

    let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the chain", Some("An epic."))
        .expect("create_epic");
    conn.execute("UPDATE epics SET integration_branch = ?1 WHERE id = ?2", rusqlite::params![INTEGRATION, epic.id])
        .expect("set integration_branch");
    let task = create_task(&mut conn, &project.id, &actor_id, "A task", Some(&epic.id)).expect("task");

    let (forge, repo_path) = forge_and_repo_path(&conn, &project.id).expect("resolve forge");
    assert_eq!(forge, Forge::GitHub);
    let draft = assemble_epic_request_draft(&conn, &epic.id).expect("draft");
    EpicChain { conn, epic_id: epic.id, task_id: task.id, forge, repo_path, remote, draft, _repo_dir: repo_dir }
}

#[test]
fn epic_request_pushes_then_creates_with_the_integration_branch_as_head_and_default_as_base() {
    let c = seed_epic_chain();
    with_fake_forge_clis(|fake| {
        let out = open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("open");
        assert!(matches!(out, EpicRequestOutcome::Opened(_)), "{out:?}");
        assert!(fake.invoked());

        let local_tip = git_in(&c.repo_path, &["rev-parse", INTEGRATION]);
        assert_eq!(remote_tip(c.remote.path(), INTEGRATION), Some(local_tip), "the branch must be on the remote");

        let argv = fake.argv_lines();
        let pos = |flag: &str| argv.iter().position(|l| l == flag).unwrap_or_else(|| panic!("{flag} missing: {argv:?}"));
        assert_eq!(argv[pos("--head") + 1], INTEGRATION);
        assert_eq!(argv[pos("--base") + 1], "main");
        assert_eq!(fake.body(), c.draft.body, "the published text is the previewed text");
    });
}

#[test]
fn epic_request_push_runs_from_the_project_checkout_never_a_worktree() {
    let c = seed_epic_chain();
    let marker = c.remote.path().join("pre_push_cwd.txt");
    let hook = c.repo_path.join(".git/hooks/pre-push");
    std::fs::write(&hook, format!("#!/bin/sh\npwd -P > \"{}\"\n", marker.display())).unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    with_fake_forge_clis(|_fake| {
        open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("open");
    });
    let ran_in = std::fs::read_to_string(&marker).expect("the pre-push hook must have run");
    assert_eq!(
        std::fs::canonicalize(ran_in.trim()).unwrap(),
        std::fs::canonicalize(&c.repo_path).unwrap(),
        "the push must run from the project's main checkout"
    );
}

#[test]
fn epic_request_rejected_push_is_push_rejected_creates_nothing_and_never_forces() {
    let c = seed_epic_chain();
    // Another clone lands a different commit on the same branch name first, so ours is non-ff.
    let other = tempfile::tempdir().expect("other clone");
    git_in(other.path(), &["init", "--initial-branch=main"]);
    git_in(other.path(), &["config", "user.email", "x@y.z"]);
    git_in(other.path(), &["config", "user.name", "X"]);
    std::fs::write(other.path().join("theirs.txt"), "theirs\n").unwrap();
    git_in(other.path(), &["add", "theirs.txt"]);
    git_in(other.path(), &["commit", "-m", "theirs"]);
    git_in(other.path(), &["push", &c.remote.path().to_string_lossy(), &format!("HEAD:refs/heads/{INTEGRATION}")]);
    let theirs = remote_tip(c.remote.path(), INTEGRATION).expect("remote branch");

    with_fake_forge_clis(|fake| {
        let out = open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("open");
        let EpicRequestOutcome::PushRejected { detail } = out else { panic!("expected PushRejected, got {out:?}") };
        assert!(detail.contains("rejected"), "{detail}");
        assert!(!fake.argv_has_token("create"), "no request may be created after a rejected push");
        assert_eq!(remote_tip(c.remote.path(), INTEGRATION), Some(theirs), "the remote history is untouched");
    });
}

#[test]
fn epic_request_pushed_but_not_opened_is_a_partial_outcome_not_a_success() {
    let c = seed_epic_chain();
    with_fake_forge_clis(|fake| {
        fake.set_flag("create_fail");
        let out = open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("open");
        let EpicRequestOutcome::PushedButNotOpened { branch, detail } = out else {
            panic!("expected PushedButNotOpened, got {out:?}")
        };
        assert_eq!(branch, INTEGRATION);
        assert!(!detail.contains("leaked-token") && !detail.contains("/secret"), "raw CLI stderr leaked: {detail}");

        assert!(remote_tip(c.remote.path(), INTEGRATION).is_some(), "the branch landed on the remote");
        assert!(fake.argv_has_token("create"), "the create call was attempted");
        let after = observe_branch(fake, c.forge, &c.repo_path, INTEGRATION).expect("lookup");
        assert!(after.is_none(), "no request exists");
    });
}

#[test]
fn epic_request_asked_twice_surfaces_the_existing_request_instead_of_creating_a_second() {
    let c = seed_epic_chain();
    with_fake_forge_clis(|fake| {
        let first = open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("first");
        assert!(matches!(first, EpicRequestOutcome::Opened(_)), "{first:?}");
        let second = open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("second");
        assert!(matches!(second, EpicRequestOutcome::AlreadyOpen(_)), "{second:?}");
        let creates = fake.argv_lines().iter().filter(|l| *l == "create").count();
        assert_eq!(creates, 1, "exactly one create call across both asks");
    });
}

#[test]
fn epic_request_already_open_pushes_nothing() {
    let c = seed_epic_chain();
    with_fake_forge_clis(|fake| {
        fake.set_state("OPEN");
        let out = open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("open");
        assert!(matches!(out, EpicRequestOutcome::AlreadyOpen(_)), "{out:?}");
        assert!(remote_tip(c.remote.path(), INTEGRATION).is_none(), "lookup precedes the push");
    });
}

#[test]
fn epic_request_with_an_absent_cli_returns_cli_not_installed_before_pushing() {
    let c = seed_epic_chain();
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let original = std::env::var_os("PATH");
    // A PATH holding `git` and nothing else: no `gh` anywhere, yet concurrently running tests in
    // this binary (which spawn git outside `ENV_LOCK`) still resolve it.
    let git_only = tempfile::tempdir().expect("git-only path dir");
    let git_bin = std::env::split_paths(original.as_deref().unwrap_or_default())
        .map(|d| d.join("git"))
        .find(|p| p.is_file())
        .expect("git must be on PATH");
    std::os::unix::fs::symlink(&git_bin, git_only.path().join("git")).expect("symlink git");
    // SAFETY: serialised by `ENV_LOCK`; restored below.
    unsafe { std::env::set_var("PATH", git_only.path()) };
    let result = open_epic_request_at(c.forge, &c.repo_path, &c.draft);
    unsafe {
        match &original {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }
    assert_eq!(result, Err(ForgeError::CliNotInstalled { cli: "gh" }));
    assert!(remote_tip(c.remote.path(), INTEGRATION).is_none(), "nothing may be pushed first");
}

#[test]
fn epic_request_with_an_unauthenticated_cli_returns_cli_not_authenticated_before_pushing() {
    let c = seed_epic_chain();
    with_fake_forge_clis(|fake| {
        fake.set_flag("unauth");
        let result = open_epic_request_at(c.forge, &c.repo_path, &c.draft);
        assert_eq!(result, Err(ForgeError::CliNotAuthenticated { cli: "gh" }));
        assert!(remote_tip(c.remote.path(), INTEGRATION).is_none(), "nothing may be pushed first");
    });
}

#[test]
fn epic_request_for_a_project_with_no_forge_is_refused_before_any_push() {
    let c = seed_epic_chain();
    with_fake_forge_clis(|_fake| {
        let result = open_epic_request_at(Forge::Local, &c.repo_path, &c.draft);
        assert!(matches!(result, Err(ForgeError::CliFailed { cli: "flywheel", .. })), "{result:?}");
        assert!(remote_tip(c.remote.path(), INTEGRATION).is_none());
    });
}

#[test]
fn epic_request_writes_no_status_column_for_the_epic_or_its_tasks() {
    let c = seed_epic_chain();
    let statuses = |conn: &Connection| -> (String, String) {
        (
            conn.query_row("SELECT status FROM epics WHERE id = ?1", [&c.epic_id], |r| r.get(0)).unwrap(),
            task_status(conn, &c.task_id),
        )
    };
    let before = statuses(&c.conn);
    with_fake_forge_clis(|_fake| {
        open_epic_request_at(c.forge, &c.repo_path, &c.draft).expect("open");
    });
    assert_eq!(statuses(&c.conn), before);
}
