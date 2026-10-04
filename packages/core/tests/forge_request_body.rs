//! LINK-05 coverage of `forge::request_body::assemble_request_draft` (07-09-PLAN.md Task 1's
//! `<behavior>` list, one assertion per bullet): the target-branch derivation, the title, the
//! criteria checklist (real checked state, superseded rows excluded), the chronological session
//! summaries, the absence discipline for empty sections, determinism across two calls, and the
//! no-worktree error.

mod common;

use core::domain::acceptance_criterion::{create_criterion, revise_criterion, toggle_criterion};
use core::domain::agent_run::start_agent_run;
use core::domain::epic::create_epic;
use core::domain::session_summary::{create_summary, SummaryFields};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use core::forge::request_body::assemble_request_draft;

/// Serialises every call to [`with_scratch_worktree_root`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT`
/// is process-wide state and `cargo test` runs `#[test]` fns concurrently by default. Mirrors
/// `tests/context_packet.rs`'s/`tests/criteria_pin.rs`'s identical helper; each `tests/*.rs` file
/// compiles to its own binary, so this cannot race with any other test file.
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

#[test]
fn target_branch_for_a_task_under_an_epic_is_the_epic_integration_branch_unprefixed() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the thing", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Wire the draft", Some(&epic.id))
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert!(
            draft.target_branch.starts_with("flywheel/epic/"),
            "expected the epic integration branch, got {:?}",
            draft.target_branch
        );
        assert!(!draft.target_branch.contains("origin/"), "a base ref must never carry origin/");
    });
}

#[test]
fn target_branch_for_an_epic_less_task_is_the_projects_default_branch() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No epic here", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert_eq!(draft.target_branch, project.default_branch);
    });
}

#[test]
fn title_is_the_tasks_own_title_unmodified() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Exact Title Text", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert_eq!(draft.title, "Exact Title Text");
    });
}

#[test]
fn body_names_the_task_key() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Keyed task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert!(draft.body.contains(&task.key), "body must name the task key {:?}", task.key);
    });
}

#[test]
fn body_contains_one_checklist_line_per_current_criterion_in_rank_order_with_real_checked_state() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Two criteria", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let c1 = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "First", None)
            .expect("create_criterion 1 should succeed");
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Second",
            Some("run the suite"),
        )
        .expect("create_criterion 2 should succeed");
        toggle_criterion(&mut conn, &actor_id, &c1.id).expect("toggle_criterion should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        let first_idx = draft.body.find("First").expect("First criterion should appear");
        let second_idx = draft.body.find("Second").expect("Second criterion should appear");
        assert!(first_idx < second_idx, "criteria must render in rank order");
        assert!(
            draft.body.contains("- [x] First"),
            "a checked criterion must render checked, got: {}",
            draft.body
        );
        assert!(
            draft.body.contains("- [ ] Second"),
            "an unchecked criterion must render unchecked, got: {}",
            draft.body
        );
        assert!(
            draft.body.contains("(Verify: run the suite)"),
            "a present verification_hint must render beside its statement"
        );
    });
}

#[test]
fn a_superseded_criterion_revision_never_appears_in_the_body() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Revised criterion", None)
            .expect("create_task should succeed");
        let criterion =
            create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Original wording", None)
                .expect("create_criterion should succeed");

        // Lock the criterion (an `agent_runs` row must exist for the task) so the revise mints a
        // successor row rather than editing in place — `ensure_worktree` runs as part of
        // `start_agent_run`, so this also seeds the worktree row the draft needs.
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        revise_criterion(&mut conn, &actor_id, &criterion.id, "Sharper wording", None)
            .expect("revise_criterion should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert!(
            !draft.body.contains("Original wording"),
            "a superseded revision's wording must never appear, got: {}",
            draft.body
        );
        assert!(draft.body.contains("Sharper wording"), "the current revision's wording must appear");
    });
}

#[test]
fn a_task_with_no_summaries_omits_the_summaries_section_entirely() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No summaries", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert!(
            !draft.body.contains("Session Summaries"),
            "an empty summaries list must omit the heading entirely, got: {}",
            draft.body
        );
    });
}

#[test]
fn a_task_with_no_criteria_omits_the_criteria_section_entirely() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No criteria", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        assert!(
            !draft.body.contains("Acceptance Criteria"),
            "an empty criteria list must omit the heading entirely, got: {}",
            draft.body
        );
    });
}

#[test]
fn session_summaries_render_in_chronological_order() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Two sessions", None)
            .expect("create_task should succeed");
        let run1 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run 1 should succeed");
        create_summary(
            &mut conn,
            &run1.id,
            SummaryFields {
                changed_files: vec![],
                changed_prose: Some("Did the first thing".to_string()),
                remains: None,
                next_session_must_know: None,
                decisions: vec![],
                acknowledged_decisions: vec![],
                diff_ref: None,
                auto_generated: false,
            },
            &actor_id,
        )
        .expect("create_summary 1 should succeed");

        // A second run on the same task, for the second summary.
        let run2 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run 2 should succeed");
        create_summary(
            &mut conn,
            &run2.id,
            SummaryFields {
                changed_files: vec![],
                changed_prose: Some("Did the second thing".to_string()),
                remains: None,
                next_session_must_know: None,
                decisions: vec![],
                acknowledged_decisions: vec![],
                diff_ref: None,
                auto_generated: false,
            },
            &actor_id,
        )
        .expect("create_summary 2 should succeed");

        let draft = assemble_request_draft(&conn, &task.id).expect("assemble_request_draft should succeed");
        let first_idx = draft.body.find("Did the first thing").expect("first summary should appear");
        let second_idx = draft.body.find("Did the second thing").expect("second summary should appear");
        assert!(first_idx < second_idx, "summaries must render in chronological order");
    });
}

#[test]
fn two_consecutive_calls_over_unchanged_state_return_byte_identical_drafts() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Determinism check", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "One", None)
            .expect("create_criterion should succeed");

        let a = assemble_request_draft(&conn, &task.id).expect("first assembly should succeed");
        let b = assemble_request_draft(&conn, &task.id).expect("second assembly should succeed");
        assert_eq!(a, b, "two calls against an unchanged database must be byte-identical");
    });
}

#[test]
fn a_task_with_no_worktree_row_errors_naming_the_task_rather_than_an_empty_head_branch() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No worktree yet", None)
            .expect("create_task should succeed");

        let err = assemble_request_draft(&conn, &task.id)
            .expect_err("a task with no worktree row must error, never assemble an empty head branch");
        assert!(
            err.to_string().contains(&task.id),
            "the error must name the task, got: {err}"
        );
    });
}
