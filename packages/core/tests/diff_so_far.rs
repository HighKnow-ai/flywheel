//! `diff_stat_and_names`/`DiffStat` (D-70/D-71, plan 04-07): the committed-half read through the
//! one git wrapper, tested against real git repositories via `common::seeded_git_project`. Task 2
//! extends this file with the packet/render_prompt behaviours (D-70's both-halves contract), and
//! Task 3 extends it again with the command-layer gating tests (no worktree on disk). Plan 04-11
//! Task 3 adds one more case (below): `diff_stat_and_names` reads with rename detection disabled,
//! so a legitimately moved file appears under both its old and its new path.

mod common;

use core::context_packet::{
    assemble_context_packet, assemble_context_packet_with_extras, render_prompt, DiffSoFar,
    PacketExtras,
};
use core::domain::task::create_task;
use core::git::{diff_stat_and_names, git_at};

fn run(repo_path: &std::path::Path, args: &[&str]) {
    git_at(repo_path, args).unwrap_or_else(|e| panic!("git {args:?} failed: {e}"));
}

// `FLYWHEEL_WORKTREE_ROOT` is process-wide state (mirrors `context_packet.rs`'s own
// `WORKTREE_ROOT_ENV_LOCK` — each `tests/*.rs` file is its own binary, so this lock only needs to
// scope the two Task 3 tests below against each other, never against another file).
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

#[test]
fn a_branch_two_commits_ahead_of_its_base_reports_the_stat_and_exactly_two_changed_paths() {
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let repo_path = repo_dir.path();

    run(repo_path, &["checkout", "-b", "feature"]);
    std::fs::write(repo_path.join("alpha.txt"), b"alpha\n").expect("failed to write alpha.txt");
    run(repo_path, &["add", "alpha.txt"]);
    run(repo_path, &["commit", "-m", "add alpha"]);
    std::fs::write(repo_path.join("bravo.txt"), b"bravo\n").expect("failed to write bravo.txt");
    run(repo_path, &["add", "bravo.txt"]);
    run(repo_path, &["commit", "-m", "add bravo"]);

    let diff = diff_stat_and_names(repo_path, "main").expect("diff_stat_and_names should succeed");

    assert_eq!(
        diff.changed_paths,
        vec!["alpha.txt".to_string(), "bravo.txt".to_string()],
        "changed_paths must list exactly the two changed files, in git's own order"
    );
    assert!(!diff.stat.trim().is_empty(), "stat text must be non-empty for a two-commit-ahead branch");
    assert!(diff.stat.contains("alpha.txt"), "stat text must be git's own unmodified --stat output");
    assert!(diff.stat.contains("bravo.txt"));
}

#[test]
fn a_branch_level_with_its_base_reports_an_empty_stat_and_an_empty_path_list() {
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let repo_path = repo_dir.path();

    run(repo_path, &["checkout", "-b", "feature"]);

    let diff =
        diff_stat_and_names(repo_path, "main").expect("diff_stat_and_names should succeed on a clean branch");

    assert!(diff.stat.is_empty(), "stat text must be empty for a branch with nothing ahead of its base");
    assert!(
        diff.changed_paths.is_empty(),
        "changed_paths must be empty for a branch with nothing ahead of its base"
    );
}

#[test]
fn an_unresolvable_base_ref_returns_an_err() {
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let repo_path = repo_dir.path();

    let result = diff_stat_and_names(repo_path, "this-ref-does-not-exist");

    assert!(result.is_err(), "an unresolvable base ref must return Err, never an empty success");
}

#[test]
fn the_function_performs_no_parsing_beyond_splitting_name_only_output_on_newlines() {
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let repo_path = repo_dir.path();

    run(repo_path, &["checkout", "-b", "feature"]);
    std::fs::write(repo_path.join("charlie.txt"), b"charlie\n").expect("failed to write charlie.txt");
    run(repo_path, &["add", "charlie.txt"]);
    run(repo_path, &["commit", "-m", "add charlie"]);

    let diff = diff_stat_and_names(repo_path, "main").expect("diff_stat_and_names should succeed");

    // No trailing empty element from the trailing newline `git diff --name-only` always emits.
    assert_eq!(diff.changed_paths.len(), 1);
    assert_eq!(diff.changed_paths[0], "charlie.txt");
}

#[test]
fn both_reads_pass_the_repo_path_through_the_existing_wrapper() {
    // Structural: `packages/core/tests/supervisor_cwd.rs` asserts the single-construction-site
    // property at the workspace level; this test proves `diff_stat_and_names` itself succeeds
    // against a real repository using only the wrapper's own `-C`-first path resolution (no
    // reliance on the process's own working directory).
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let repo_path = repo_dir.path();

    run(repo_path, &["checkout", "-b", "feature"]);
    std::fs::write(repo_path.join("delta.txt"), b"delta\n").expect("failed to write delta.txt");
    run(repo_path, &["add", "delta.txt"]);
    run(repo_path, &["commit", "-m", "add delta"]);

    let diff = diff_stat_and_names(repo_path, "main").expect("diff_stat_and_names should succeed");
    assert_eq!(diff.changed_paths, vec!["delta.txt".to_string()]);
}

#[test]
fn a_renamed_file_appears_under_both_its_old_and_its_new_path() {
    // Plan 04-11 Task 3: rename detection is disabled so the claimed-files drift detector never
    // cries wolf on a legitimate move — an honest claim of either the old or the new path must
    // match against this function's own output.
    let (_conn, _actor_id, _project, repo_dir) = common::seeded_git_project();
    let repo_path = repo_dir.path();

    // The file must exist at the base ref itself for a rename against that ref to be observable
    // at all — a two-tree diff only compares the trees at its two endpoints, never the
    // intervening commit history, so a file created and renamed entirely inside the range would
    // never show up under either name regardless of rename detection.
    std::fs::write(repo_path.join("echo.txt"), b"echo content that is long enough to not look like a copy\n")
        .expect("failed to write echo.txt");
    run(repo_path, &["add", "echo.txt"]);
    run(repo_path, &["commit", "-m", "add echo on main"]);

    run(repo_path, &["checkout", "-b", "feature"]);
    run(repo_path, &["mv", "echo.txt", "foxtrot.txt"]);
    run(repo_path, &["commit", "-m", "rename echo to foxtrot"]);

    let diff = diff_stat_and_names(repo_path, "main").expect("diff_stat_and_names should succeed");

    assert!(
        diff.changed_paths.contains(&"echo.txt".to_string()),
        "the old path must still appear with rename detection disabled, got: {:?}",
        diff.changed_paths
    );
    assert!(
        diff.changed_paths.contains(&"foxtrot.txt".to_string()),
        "the new path must appear too, got: {:?}",
        diff.changed_paths
    );
}

// --- Task 2: the packet carries both halves, and the assembler stays pure -----------------

#[test]
fn a_packet_assembled_with_no_extras_has_no_diff_and_renders_no_diff_heading() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "No extras", None)
        .expect("create_task should succeed");

    let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
    assert!(packet.diff.is_none(), "diff must be None when assembled with no extras");

    let prompt = render_prompt(&packet, "");
    assert!(!prompt.contains("Diff So Far"), "no diff heading should be emitted when diff is None");
}

#[test]
fn a_diff_with_an_empty_committed_half_and_a_dirty_working_tree_renders_only_the_working_tree_subsection()
{
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Dirty only", None)
        .expect("create_task should succeed");

    let diff = DiffSoFar {
        base_ref: "main".to_string(),
        committed_stat: String::new(),
        committed_paths: Vec::new(),
        working_tree_porcelain: " M src/lib.rs\n".to_string(),
    };
    let packet =
        assemble_context_packet_with_extras(
            &conn,
            &task.id,
            PacketExtras { diff: Some(diff), drift: Vec::new() },
        )
            .expect("assembly should succeed");

    let prompt = render_prompt(&packet, "");
    assert!(prompt.contains("## Diff So Far"));
    assert!(prompt.contains("### Working tree (uncommitted)"));
    assert!(prompt.contains("src/lib.rs"));
    assert!(
        !prompt.contains("### Committed since"),
        "the committed subsection must be omitted when both committed fields are empty"
    );
}

#[test]
fn a_diff_with_a_clean_working_tree_renders_only_the_committed_subsection() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Clean tree", None)
        .expect("create_task should succeed");

    let diff = DiffSoFar {
        base_ref: "main".to_string(),
        committed_stat: " src/lib.rs | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)\n"
            .to_string(),
        committed_paths: vec!["src/lib.rs".to_string()],
        working_tree_porcelain: String::new(),
    };
    let packet =
        assemble_context_packet_with_extras(
            &conn,
            &task.id,
            PacketExtras { diff: Some(diff), drift: Vec::new() },
        )
            .expect("assembly should succeed");

    let prompt = render_prompt(&packet, "");
    assert!(prompt.contains("### Committed since main"));
    assert!(prompt.contains("src/lib.rs"));
    assert!(
        !prompt.contains("### Working tree (uncommitted)"),
        "the working-tree subsection must be omitted when the working tree is clean"
    );
}

#[test]
fn the_rendered_diff_section_never_contains_a_hunk_marker_line() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "No hunks", None)
        .expect("create_task should succeed");

    let diff = DiffSoFar {
        base_ref: "main".to_string(),
        committed_stat: " src/lib.rs | 4 ++--\n".to_string(),
        committed_paths: vec!["src/lib.rs".to_string()],
        working_tree_porcelain: " M src/lib.rs\n".to_string(),
    };
    let packet =
        assemble_context_packet_with_extras(
            &conn,
            &task.id,
            PacketExtras { diff: Some(diff), drift: Vec::new() },
        )
            .expect("assembly should succeed");

    let prompt = render_prompt(&packet, "");
    // Built from character literals so this assertion cannot accidentally match its own source.
    let hunk_marker: String = ['@', '@'].iter().collect();
    for line in prompt.lines() {
        assert!(
            !line.starts_with(&hunk_marker),
            "rendered diff section must never contain a hunk header line, got: {line}"
        );
    }
}

#[test]
fn the_rendered_diff_section_ends_with_the_read_what_you_need_invitation() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Invitation", None)
        .expect("create_task should succeed");

    let diff = DiffSoFar {
        base_ref: "main".to_string(),
        committed_stat: " src/lib.rs | 4 ++--\n".to_string(),
        committed_paths: vec!["src/lib.rs".to_string()],
        working_tree_porcelain: String::new(),
    };
    let packet =
        assemble_context_packet_with_extras(
            &conn,
            &task.id,
            PacketExtras { diff: Some(diff), drift: Vec::new() },
        )
            .expect("assembly should succeed");

    let prompt = render_prompt(&packet, "");
    assert!(
        prompt.contains(
            "You are in this worktree — read any of these files directly for the full detail."
        ),
        "the diff section must end with the read-what-you-need invitation, got:\n{prompt}"
    );
}

#[test]
fn assemble_context_packet_twice_against_an_unchanged_database_stays_diff_none_on_both() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Determinism", None)
        .expect("create_task should succeed");

    let packet_a = assemble_context_packet(&conn, &task.id).expect("first assembly should succeed");
    let packet_b = assemble_context_packet(&conn, &task.id).expect("second assembly should succeed");

    assert!(packet_a.diff.is_none());
    assert!(packet_b.diff.is_none());
    assert_eq!(packet_a, packet_b, "two calls against an unchanged database must be structurally equal");
}

#[test]
fn assemble_context_packet_with_extras_twice_with_the_same_extras_returns_equal_packets() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Determinism with extras", None)
        .expect("create_task should succeed");

    let diff = DiffSoFar {
        base_ref: "main".to_string(),
        committed_stat: " src/lib.rs | 4 ++--\n".to_string(),
        committed_paths: vec!["src/lib.rs".to_string()],
        working_tree_porcelain: String::new(),
    };
    let extras_a = PacketExtras { diff: Some(diff.clone()), drift: Vec::new() };
    let extras_b = PacketExtras { diff: Some(diff), drift: Vec::new() };

    let packet_a = assemble_context_packet_with_extras(&conn, &task.id, extras_a)
        .expect("first assembly should succeed");
    let packet_b = assemble_context_packet_with_extras(&conn, &task.id, extras_b)
        .expect("second assembly should succeed");

    assert_eq!(
        packet_a, packet_b,
        "two calls with the same database and the same extras must be structurally equal"
    );
}

// --- Task 3: the command-layer gate, exercised at the core level --------------------------

#[test]
fn a_task_whose_worktree_directory_has_been_removed_from_disk_yields_no_diff_when_gated() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Vanished worktree", None)
            .expect("create_task should succeed");
        let worktree = core::domain::worktree::ensure_worktree(&mut conn, &task.id, &actor_id)
            .expect("ensure_worktree should succeed");

        // The directory is gone, but the `worktrees` row still claims it — D-45's exact scenario.
        std::fs::remove_dir_all(&worktree.path).expect("failed to remove the worktree directory");

        // Replicates the command layer's own gate (`diff_extras_for` in
        // packages/desktop/src-tauri/src/commands/agent_run.rs): a `worktrees` row exists, but
        // the path it names is not a directory on disk right now — the extras must stay absent,
        // never an attempt to diff a path that is not there.
        let has_worktree_row = core::domain::worktree::worktree_for_task(&conn, &task.id)
            .expect("worktree_for_task should succeed")
            .is_some();
        assert!(has_worktree_row, "the worktrees row itself must still exist");
        assert!(
            !std::path::Path::new(&worktree.path).is_dir(),
            "the worktree directory must be gone from disk"
        );

        let packet = assemble_context_packet_with_extras(&conn, &task.id, PacketExtras::default())
            .expect("assembly should succeed even for a vanished worktree");
        assert!(packet.diff.is_none());

        let prompt = render_prompt(&packet, "");
        assert!(
            !prompt.contains("Diff So Far"),
            "no diff heading for a worktree that has vanished from disk"
        );
    });
}

#[test]
fn a_task_with_a_real_worktree_and_a_dirty_file_produces_a_diff_naming_that_file() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Dirty worktree", None)
            .expect("create_task should succeed");
        let worktree = core::domain::worktree::ensure_worktree(&mut conn, &task.id, &actor_id)
            .expect("ensure_worktree should succeed");

        let worktree_path = std::path::Path::new(&worktree.path);
        let dirty_file = worktree_path.join("scratch.txt");
        std::fs::write(&dirty_file, b"dirty\n").expect("failed to write the dirty file");

        let diff_stat = diff_stat_and_names(worktree_path, &worktree.base_branch)
            .expect("diff_stat_and_names should succeed");
        let working_tree_porcelain = core::git::git_status_porcelain(worktree_path)
            .expect("git_status_porcelain should succeed");

        let extras = PacketExtras {
            diff: Some(DiffSoFar {
                base_ref: worktree.base_branch.clone(),
                committed_stat: diff_stat.stat,
                committed_paths: diff_stat.changed_paths,
                working_tree_porcelain,
            }),
            drift: Vec::new(),
        };
        let packet = assemble_context_packet_with_extras(&conn, &task.id, extras)
            .expect("assembly should succeed");

        let prompt = render_prompt(&packet, "");
        assert!(prompt.contains("### Working tree (uncommitted)"));
        assert!(
            prompt.contains("scratch.txt"),
            "the working-tree section must name the dirty file, got:\n{prompt}"
        );
    });
}
