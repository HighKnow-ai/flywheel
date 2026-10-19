//! WORK-06 coverage (D-45, D-49): launch-time worktree reconciliation — detect, surface, never
//! repair, idempotent — plus `mark_abandoned`'s own already-terminal guard.

mod common;

use common::with_scratch_worktree_root;

use std::path::Path;

use core::domain::session::{mark_abandoned, start_session, SessionStatus};
use core::domain::worktree::{ensure_worktree, reconcile_worktrees};

fn worktree_status(conn: &rusqlite::Connection, worktree_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM worktrees WHERE id = ?1",
        rusqlite::params![worktree_id],
        |row| row.get(0),
    )
    .expect("worktree row should exist")
}

fn worktree_identity(conn: &rusqlite::Connection, worktree_id: &str) -> (String, String, String) {
    conn.query_row(
        "SELECT path, branch, base_branch FROM worktrees WHERE id = ?1",
        rusqlite::params![worktree_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("worktree row should exist")
}

fn event_count(conn: &rusqlite::Connection, project_id: &str, event_type: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE project_id = ?1 AND event_type = ?2",
        rusqlite::params![project_id, event_type],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

#[test]
fn a_worktree_row_whose_path_exists_stays_active_with_no_write_and_no_event() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Present story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        let events_before = event_count(&conn, &project.id, "worktree.missing");

        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        assert_eq!(worktree_status(&conn, &worktree.id), "active");
        assert_eq!(
            event_count(&conn, &project.id, "worktree.missing"),
            events_before,
            "a present worktree must append no worktree.missing event"
        );
    });
}

#[test]
fn a_deleted_worktree_becomes_missing_and_appends_one_event_with_identity_unchanged() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Deleted story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
        let identity_before = worktree_identity(&conn, &worktree.id);

        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");

        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        assert_eq!(worktree_status(&conn, &worktree.id), "missing");
        assert_eq!(
            worktree_identity(&conn, &worktree.id),
            identity_before,
            "path/branch/base_branch must be byte-identical after the transition"
        );
        assert_eq!(
            event_count(&conn, &project.id, "worktree.missing"),
            1,
            "exactly one worktree.missing event must be appended"
        );
    });
}

#[test]
fn a_second_call_immediately_after_the_first_writes_nothing_and_appends_no_second_event() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Twice story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");

        reconcile_worktrees(&mut conn, &actor_id).expect("first reconcile should succeed");
        assert_eq!(worktree_status(&conn, &worktree.id), "missing");
        let events_after_first = event_count(&conn, &project.id, "worktree.missing");

        reconcile_worktrees(&mut conn, &actor_id).expect("second reconcile should succeed");
        assert_eq!(worktree_status(&conn, &worktree.id), "missing");
        assert_eq!(
            event_count(&conn, &project.id, "worktree.missing"),
            events_after_first,
            "a second reconcile over an unchanged filesystem must append no second event"
        );
    });
}

#[test]
fn an_unreadable_worktree_becomes_missing_without_aborting_the_rest_of_the_pass() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();

        let unreadable_story = common::new_story(&mut conn, &project.id, &actor_id, "Unreadable story");
        let unreadable_worktree = ensure_worktree(&mut conn, &unreadable_story.id, &actor_id)
            .expect("ensure_worktree should succeed");

        let present_story = common::new_story(&mut conn, &project.id, &actor_id, "Present sibling story");
        let present_worktree = ensure_worktree(&mut conn, &present_story.id, &actor_id)
            .expect("ensure_worktree should succeed");

        // Relocate the "unreadable" worktree's recorded path into its OWN isolated parent
        // directory — never shared with the sibling worktree's parent (both worktrees would
        // otherwise sit under the same `worktree_root/key_prefix/` directory, so locking THAT
        // down would make the sibling unreadable too). `reconcile_worktrees` only stats `path`
        // and performs no git operation, so rewriting the row's path directly is safe here.
        let worktree_root =
            std::env::var("FLYWHEEL_WORKTREE_ROOT").expect("the test harness should have set this");
        let isolated_parent = Path::new(&worktree_root).join("isolated-unreadable");
        let isolated_path = isolated_parent.join("leaf");
        std::fs::create_dir_all(&isolated_path).expect("failed to create the isolated leaf dir");
        conn.execute(
            "UPDATE worktrees SET path = ?1 WHERE id = ?2",
            rusqlite::params![isolated_path.to_string_lossy().into_owned(), unreadable_worktree.id],
        )
        .expect("failed to relocate the fixture worktree's recorded path");

        // Now make that isolated parent unreadable (not deleted) — a permissions error, not an
        // absence. `try_exists` on the child path itself will fail to resolve rather than
        // cleanly report "does not exist".
        let original_mode =
            std::fs::metadata(&isolated_parent).expect("failed to stat isolated parent dir").permissions();
        std::fs::set_permissions(&isolated_parent, std::os::unix::fs::PermissionsExt::from_mode(0o000))
            .expect("failed to lock down the isolated parent directory");

        let result = reconcile_worktrees(&mut conn, &actor_id);

        // Restore permissions immediately so the scratch dir can be cleaned up regardless of the
        // assertion outcome below.
        std::fs::set_permissions(&isolated_parent, original_mode)
            .expect("failed to restore isolated parent directory permissions");

        result.expect("reconcile_worktrees must not abort the whole pass on one unreadable row");
        assert_eq!(
            worktree_status(&conn, &unreadable_worktree.id),
            "missing",
            "an unreadable path must read as missing, not abort reconciliation"
        );
        assert_eq!(
            worktree_status(&conn, &present_worktree.id),
            "active",
            "the sibling row must still be reconciled in the same pass"
        );
    });
}

#[test]
fn a_missing_worktree_whose_directory_reappears_is_not_silently_returned_to_active() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Reappeared story");
        let worktree =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("first reconcile should succeed");
        assert_eq!(worktree_status(&conn, &worktree.id), "missing");

        // The directory reappears on disk (e.g. the user restored it out-of-band) — reconciling
        // again must NOT move it back to active. That is the user's explicit Recreate decision.
        std::fs::create_dir_all(&worktree.path).expect("failed to recreate the directory on disk");

        reconcile_worktrees(&mut conn, &actor_id).expect("second reconcile should succeed");
        assert_eq!(
            worktree_status(&conn, &worktree.id),
            "missing",
            "reconciliation must never repair a missing row back to active on its own"
        );
    });
}

#[test]
fn mark_abandoned_transitions_a_running_run_and_appends_one_event() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Abandon story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        let wrote = mark_abandoned(&mut conn, &run.id, &actor_id, Some("watchdog killed it"))
            .expect("mark_abandoned should succeed");
        assert!(wrote, "mark_abandoned must report it wrote a transition");

        let status: String = conn
            .query_row(
                "SELECT status FROM sessions WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("sessions row should exist");
        assert_eq!(status, SessionStatus::Abandoned.as_str());

        assert_eq!(event_count(&conn, &project.id, "session.abandoned"), 1);
    });
}

#[test]
fn mark_abandoned_is_a_no_op_on_an_already_terminal_run() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Already terminal story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        core::domain::session::close_session(
            &mut conn,
            &run.id,
            SessionStatus::Completed,
            None,
            None,
            None,
        )
        .expect("close_session should succeed");

        let wrote = mark_abandoned(&mut conn, &run.id, &actor_id, None)
            .expect("mark_abandoned should succeed as a no-op");
        assert!(!wrote, "mark_abandoned must report it wrote nothing for an already-terminal run");

        let status: String = conn
            .query_row(
                "SELECT status FROM sessions WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("sessions row should exist");
        assert_eq!(status, "completed", "an already-terminal run must never be overwritten");
        assert_eq!(event_count(&conn, &project.id, "session.abandoned"), 0);
    });
}

#[test]
fn mark_abandoned_twice_in_a_row_is_idempotent() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Idempotent abandon story");
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_session should succeed");

        assert!(mark_abandoned(&mut conn, &run.id, &actor_id, None).expect("first call should succeed"));
        assert!(
            !mark_abandoned(&mut conn, &run.id, &actor_id, None).expect("second call should succeed"),
            "a second mark_abandoned call must be a no-op"
        );
        assert_eq!(event_count(&conn, &project.id, "session.abandoned"), 1);
    });
}

/// WORK-06 Task 3 coverage (D-45's two decision verbs): `recreate_worktree_for_story` and
/// `forget_worktree_record` — each refuses on anything but a `missing` row, and neither can be
/// used as a second, unguarded path onto the thing D-41/D-43 already guard.
mod recreate_and_forget {
    use std::path::Path;
    use std::process::Command;

    use core::domain::worktree::{
        ensure_worktree, forget_worktree_record, reconcile_worktrees, recreate_worktree_for_story,
    };
    use core::query::sessions::worktree_summary_for_story;

    use super::{event_count, with_scratch_worktree_root};

    fn git_output(repo_path: &Path, args: &[&str]) -> String {
        let output = Command::new("git")
            .arg("-C")
            .arg(repo_path)
            .args(args)
            .output()
            .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
        assert!(
            output.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8_lossy(&output.stdout).trim().to_string()
    }

    fn worktree_row_status(conn: &rusqlite::Connection, worktree_id: &str) -> String {
        conn.query_row(
            "SELECT status FROM worktrees WHERE id = ?1",
            rusqlite::params![worktree_id],
            |row| row.get(0),
        )
        .expect("worktree row should exist")
    }

    #[test]
    fn worktree_summary_for_story_carries_the_status_alongside_branch_and_path() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, _repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Summary story");
            let worktree =
                ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

            let summary = worktree_summary_for_story(&conn, &story.id)
                .expect("worktree_summary_for_story should succeed")
                .expect("a summary should exist for a Story with a worktree");
            assert_eq!(summary.branch, worktree.branch);
            assert_eq!(summary.path, worktree.path);
            assert_eq!(summary.status, "active");
        });
    }

    #[test]
    fn recreate_reuses_the_recorded_branch_and_base_when_only_the_directory_was_deleted() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Recreate dir-only story");
            let worktree =
                ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
            let recorded_branch = worktree.branch.clone();
            let recorded_base = worktree.base_branch.clone();
            let recorded_path = worktree.path.clone();

            std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
            reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");
            assert_eq!(worktree_row_status(&conn, &worktree.id), "missing");

            let recreated = recreate_worktree_for_story(&mut conn, &story.id, &actor_id)
                .expect("recreate_worktree_for_story should succeed when only the directory was deleted");

            assert_eq!(recreated.branch, recorded_branch, "recreate must reuse the SAME branch");
            assert_eq!(recreated.base_branch, recorded_base, "recreate must reuse the SAME base_branch");
            assert_eq!(recreated.path, recorded_path, "recreate must reuse the SAME recorded path");
            assert_eq!(recreated.status, "active");
            assert!(Path::new(&recorded_path).exists(), "the worktree directory must exist again on disk");
            assert_eq!(worktree_row_status(&conn, &worktree.id), "active");
            assert_eq!(event_count(&conn, &project.id, "worktree.recreated"), 1);

            let branches = git_output(repo_dir.path(), &["branch", "--list"]);
            assert_eq!(
                branches.matches(&recorded_branch).count(),
                1,
                "recreate must not have minted a second branch for this Story: {branches}"
            );
        });
    }

    #[test]
    fn recreate_reuses_the_recorded_branch_and_base_when_both_the_directory_and_branch_were_deleted() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Recreate both-deleted story");
            let worktree =
                ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");
            let recorded_branch = worktree.branch.clone();
            let recorded_base = worktree.base_branch.clone();
            let recorded_path = worktree.path.clone();

            std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
            reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");
            // git's own worktree administration still considers the branch "checked out" in the
            // now-deleted directory until pruned — mirrors what `recreate_worktree_for_story`
            // itself now does before touching git.
            git_output(repo_dir.path(), &["worktree", "prune"]);
            git_output(repo_dir.path(), &["branch", "-D", &recorded_branch]);

            let recreated = recreate_worktree_for_story(&mut conn, &story.id, &actor_id).expect(
                "recreate_worktree_for_story should succeed when both the directory and branch were deleted",
            );

            assert_eq!(recreated.branch, recorded_branch, "recreate must reuse the SAME branch name");
            assert_eq!(recreated.base_branch, recorded_base, "recreate must reuse the SAME base_branch");
            assert_eq!(recreated.status, "active");
            assert!(Path::new(&recorded_path).exists(), "the worktree directory must exist again on disk");
            assert_eq!(worktree_row_status(&conn, &worktree.id), "active");
        });
    }

    #[test]
    fn recreate_fails_and_leaves_the_row_missing_when_the_recorded_base_ref_no_longer_exists() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Recreate no-base story");
            let worktree =
                ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

            std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
            reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");
            // Delete the Story's own branch (so recreate takes the "-b" path, which needs the base
            // ref to resolve) and rename the recorded base ref away so it no longer resolves.
            // Pruning first clears git's own stale worktree administration, exactly as
            // `recreate_worktree_for_story` itself now does before touching git.
            git_output(repo_dir.path(), &["worktree", "prune"]);
            git_output(repo_dir.path(), &["branch", "-D", &worktree.branch]);
            git_output(repo_dir.path(), &["branch", "-m", &worktree.base_branch, "renamed-base"]);

            let result = recreate_worktree_for_story(&mut conn, &story.id, &actor_id);
            assert!(result.is_err(), "recreate must fail when the recorded base ref no longer resolves");
            assert_eq!(
                worktree_row_status(&conn, &worktree.id),
                "missing",
                "a failed recreate must leave the row at missing — a failed recreate is not a decision made"
            );
        });
    }

    #[test]
    fn recreate_refuses_when_the_row_is_not_missing() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, _repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Recreate healthy story");
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

            let result = recreate_worktree_for_story(&mut conn, &story.id, &actor_id);
            assert!(result.is_err(), "recreate must refuse a row that is not missing");
        });
    }

    #[test]
    fn forget_deletes_the_row_and_appends_one_event_touching_nothing_on_disk() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, _repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Forget story");
            let worktree =
                ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

            std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
            reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

            forget_worktree_record(&mut conn, &story.id, &actor_id)
                .expect("forget_worktree_record should succeed on a missing row");

            let row_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM worktrees WHERE id = ?1",
                    rusqlite::params![worktree.id],
                    |row| row.get(0),
                )
                .expect("count query should succeed");
            assert_eq!(row_count, 0, "the worktrees row must be gone");
            assert_eq!(event_count(&conn, &project.id, "worktree.record_forgotten"), 1);
            assert!(
                !Path::new(&worktree.path).exists(),
                "the directory was already gone before forget — forget must not have created it"
            );
        });
    }

    #[test]
    fn forget_refuses_when_the_row_is_not_missing() {
        with_scratch_worktree_root(|_| {
            let (mut conn, actor_id, project, _repo_dir) = crate::common::seeded_git_project();
            let story = crate::common::new_story(&mut conn, &project.id, &actor_id, "Forget healthy story");
            let worktree =
                ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should succeed");

            let result = forget_worktree_record(&mut conn, &story.id, &actor_id);
            assert!(result.is_err(), "forget must refuse a row that is not missing");

            let row_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM worktrees WHERE id = ?1",
                    rusqlite::params![worktree.id],
                    |row| row.get(0),
                )
                .expect("count query should succeed");
            assert_eq!(row_count, 1, "a refused forget must leave the row in place");
        });
    }
}
