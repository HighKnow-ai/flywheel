//! `diff_stat_and_names`/`DiffStat` (D-70/D-71, plan 04-07): the committed-half read through the
//! one git wrapper, tested against real git repositories via `common::seeded_git_project`. Task 2
//! extends this file with the packet/render_prompt behaviours (D-70's both-halves contract), and
//! Task 3 extends it again with the command-layer gating tests (no worktree on disk).

mod common;

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
