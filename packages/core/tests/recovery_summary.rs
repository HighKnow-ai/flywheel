//! WORK-06/PROC-05 (03-11, D-46): the rollup over every story in a project with an outstanding
//! recovery item — a missing worktree, or an abandoned run nobody has acknowledged. Proves the
//! union de-duplicates a story carrying both conditions, never crosses a project boundary, and
//! `recovery_count_for_project` always agrees with the length of `recovery_story_ids_for_project`.

mod common;

use common::with_scratch_worktree_root;

use core::domain::session::{acknowledge_run, mark_abandoned, start_session};
use core::domain::project;
use core::domain::worktree::{ensure_worktree, reconcile_worktrees};
use core::query::recovery::{recovery_count_for_project, recovery_story_ids_for_project};

#[test]
fn an_empty_project_returns_an_empty_set_and_a_zero_count() {
    with_scratch_worktree_root(|_| {
        let (conn, _actor_id, project, _repo_dir) = common::seeded_git_project();

        let ids = recovery_story_ids_for_project(&conn, &project.id)
            .expect("recovery_story_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids.is_empty(), "a project with no recovery items must return an empty set");
        assert_eq!(count, 0, "a project with no recovery items must count zero");
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn a_missing_worktree_story_is_in_the_set() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Missing worktree story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let ids = recovery_story_ids_for_project(&conn, &project.id)
            .expect("recovery_story_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(ids, vec![story.id.clone()]);
        assert_eq!(count, 1);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn an_unacknowledged_abandoned_run_story_is_in_the_set() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Abandoned run story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");
        mark_abandoned(&mut conn, &run.id, &actor_id, Some("killed-by-user-at-launch"))
            .expect("mark_abandoned should succeed");

        let ids = recovery_story_ids_for_project(&conn, &project.id)
            .expect("recovery_story_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(ids, vec![story.id.clone()]);
        assert_eq!(count, 1);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn an_acknowledged_abandoned_run_with_a_healthy_worktree_is_excluded() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Acknowledged story");
        // A healthy, present worktree — never marked missing.
        ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");
        mark_abandoned(&mut conn, &run.id, &actor_id, Some("killed-by-user-at-launch"))
            .expect("mark_abandoned should succeed");
        assert!(
            acknowledge_run(&conn, &run.id).expect("acknowledge_run should succeed"),
            "an abandoned run must be acknowledgeable"
        );

        let ids = recovery_story_ids_for_project(&conn, &project.id)
            .expect("recovery_story_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids.is_empty(), "an acknowledged abandoned run with a healthy worktree must yield an empty set");
        assert_eq!(count, 0);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn a_story_with_both_conditions_appears_exactly_once_and_counts_once() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Both conditions story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");
        mark_abandoned(&mut conn, &run.id, &actor_id, Some("killed-by-user-at-launch"))
            .expect("mark_abandoned should succeed");

        let ids = recovery_story_ids_for_project(&conn, &project.id)
            .expect("recovery_story_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(
            ids,
            vec![story.id.clone()],
            "a story with BOTH a missing worktree and an unacknowledged abandoned run must appear exactly once"
        );
        assert_eq!(count, 1, "UNION ALL would double-count this story — UNION must not");
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn a_story_in_another_project_is_never_in_the_set() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project_a, _repo_dir) = common::seeded_git_project();
        let project_b =
            project::create_project(&mut conn, &actor_id, "Other Project", "/other-repo", "OTH", "main")
                .expect("create_project should succeed for the second project");

        let story_a = common::new_story(&mut conn, &project_a.id, &actor_id, "Project A story");
        let worktree_a = ensure_worktree(&mut conn, &story_a.id, &actor_id)
            .expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree_a.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let ids_b = recovery_story_ids_for_project(&conn, &project_b.id)
            .expect("recovery_story_ids_for_project should succeed");
        let count_b = recovery_count_for_project(&conn, &project_b.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids_b.is_empty(), "project A's recovery item must never appear under project B");
        assert_eq!(count_b, 0);
        assert_eq!(count_b as usize, ids_b.len(), "count and set length must always agree");

        // Sanity: project A itself DOES see it.
        let ids_a = recovery_story_ids_for_project(&conn, &project_a.id)
            .expect("recovery_story_ids_for_project should succeed");
        assert_eq!(ids_a, vec![story_a.id.clone()]);
    });
}

#[test]
fn count_and_ids_agree_across_a_mixed_multi_story_fixture() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();

        // Story 1: missing worktree only.
        let story1 = common::new_story(&mut conn, &project.id, &actor_id, "Story 1");
        let worktree1 =
            ensure_worktree(&mut conn, &story1.id, &actor_id).expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree1.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        // Story 2: unacknowledged abandoned run only.
        let story2 = common::new_story(&mut conn, &project.id, &actor_id, "Story 2");
        let run2 = start_session(&mut conn, &story2.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");
        mark_abandoned(&mut conn, &run2.id, &actor_id, None).expect("mark_abandoned should succeed");

        // Story 3: healthy — no recovery item at all.
        common::new_story(&mut conn, &project.id, &actor_id, "Story 3");

        let mut ids = recovery_story_ids_for_project(&conn, &project.id)
            .expect("recovery_story_ids_for_project should succeed");
        ids.sort();
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        let mut expected = vec![story1.id.clone(), story2.id.clone()];
        expected.sort();
        assert_eq!(ids, expected);
        assert_eq!(count, 2);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}
