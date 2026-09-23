//! `diff_stat_and_names`/`DiffStat` (D-70/D-71, plan 04-07): the committed-half read through the
//! one git wrapper, tested against real git repositories via `common::seeded_git_project`. Task 2
//! extends this file with the packet/render_prompt behaviours (D-70's both-halves contract), and
//! Task 3 extends it again with the command-layer gating tests (no worktree on disk).

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
        assemble_context_packet_with_extras(&conn, &task.id, PacketExtras { diff: Some(diff) })
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
        assemble_context_packet_with_extras(&conn, &task.id, PacketExtras { diff: Some(diff) })
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
        assemble_context_packet_with_extras(&conn, &task.id, PacketExtras { diff: Some(diff) })
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
        assemble_context_packet_with_extras(&conn, &task.id, PacketExtras { diff: Some(diff) })
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
    let extras_a = PacketExtras { diff: Some(diff.clone()) };
    let extras_b = PacketExtras { diff: Some(diff) };

    let packet_a = assemble_context_packet_with_extras(&conn, &task.id, extras_a)
        .expect("first assembly should succeed");
    let packet_b = assemble_context_packet_with_extras(&conn, &task.id, extras_b)
        .expect("second assembly should succeed");

    assert_eq!(
        packet_a, packet_b,
        "two calls with the same database and the same extras must be structurally equal"
    );
}
