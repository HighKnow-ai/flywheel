//! Table-driven coverage of `branch::story_branch_name` (LINK-01) and
//! `domain::worktree::base_ref_for_story` (a Story's worktree always branches from the project's
//! default branch).

mod common;

use common::new_story;
use core::branch::story_branch_name;
use core::domain::worktree::base_ref_for_story;

#[test]
fn story_branch_name_covers_every_behavior_case() {
    let cases: &[(&str, &str, &str)] = &[
        ("THRE-142", "FTS5 search and filters", "flywheel/thre-142-fts5-search-and-filters"),
        ("THRE-9", "", "flywheel/thre-9"),
        ("THRE-9", "!!! ??? ***", "flywheel/thre-9"),
        ("THRE-9", "Café — naïve façade", "flywheel/thre-9-caf-nave-faade"),
    ];
    for (key, title, expected) in cases {
        assert_eq!(
            story_branch_name(key, title),
            *expected,
            "story_branch_name({key:?}, {title:?})"
        );
    }
}

#[test]
fn story_branch_name_truncates_a_long_title_to_at_most_200_bytes_ending_alphanumeric() {
    let long_title: String = std::iter::repeat("word ").take(80).collect(); // 400 chars
    let name = story_branch_name("THRE-9", &long_title);
    assert!(name.len() <= 200, "expected at most 200 bytes, got {}", name.len());
    let last_char = name.chars().last().expect("name should not be empty");
    assert!(
        last_char.is_ascii_alphanumeric(),
        "expected the name to end in an alphanumeric character, got {name:?}"
    );
    assert!(!name.ends_with('-'), "name must never end in a hyphen, got {name:?}");
}

#[test]
fn story_branch_name_carries_the_numeric_suffix_verbatim() {
    let name = story_branch_name("THRE-007", "x");
    assert!(
        name.contains("thre-007"),
        "expected the literal 'thre-007' in {name:?} — the numeric suffix must not be renormalised"
    );
}

#[test]
fn two_stories_with_identical_titles_in_one_project_get_different_branch_names() {
    let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
    let story_a = new_story(&mut conn, &project.id, &actor_id, "Same Title");
    let story_b = new_story(&mut conn, &project.id, &actor_id, "Same Title");

    let branch_a = story_branch_name(&story_a.key, &story_a.title);
    let branch_b = story_branch_name(&story_b.key, &story_b.title);
    assert_ne!(branch_a, branch_b, "distinct Story keys must produce distinct branch names");
}

#[test]
fn base_ref_for_story_returns_the_project_default_branch() {
    let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
    let story = new_story(&mut conn, &project.id, &actor_id, "A story");

    let base_ref = base_ref_for_story(&conn, &story.id).expect("base_ref_for_story should succeed");
    assert_eq!(base_ref, project.default_branch);
}

#[test]
fn ensure_worktree_refuses_when_the_derived_branch_already_exists() {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let worktree_root_dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: single-threaded test, cleared at the end.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root_dir.path()) };

    let story = new_story(&mut conn, &project.id, &actor_id, "Collision story");
    let branch = story_branch_name(&story.key, &story.title);

    // Pre-create the branch by hand, out from under `ensure_worktree` — a real collision, not a
    // simulated one.
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(repo_dir.path())
        .args(["branch", &branch])
        .status()
        .expect("failed to pre-create the colliding branch");
    assert!(status.success());

    let result = core::domain::worktree::ensure_worktree(&mut conn, &story.id, &actor_id);
    assert!(result.is_err(), "ensure_worktree should refuse when the branch already exists");
    // `anyhow::Error::to_string()` only prints the top-level context — the `{:?}` Debug impl
    // prints the full "Caused by:" chain, so a wrapped ("failed to create worktree for Story ...")
    // outer message doesn't hide the inner "branch already exists" cause this assertion cares
    // about.
    let full_message = format!("{:?}", result.unwrap_err());
    assert!(
        full_message.contains(&branch),
        "expected the error chain to name the existing ref {branch:?}, got: {full_message}"
    );

    // SAFETY: see the set_var call above.
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
}
