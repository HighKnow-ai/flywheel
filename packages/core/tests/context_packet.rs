//! `assemble_context_packet`/`render_prompt` (plan 02-04 Task 1, D-28): every case in the plan's
//! `<behavior>` list as a named assertion. The determinism case is the load-bearing one — it
//! proves reproducibility, not mere constancy, by asserting the packet changes after a criterion
//! reorder and stays byte-identical otherwise.

mod common;

use core::context_packet::{assemble_context_packet, render_prompt};
use core::domain::acceptance_criterion::{create_criterion, reorder_criterion};
use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;

// `cargo test` runs every `#[test]` fn in this file concurrently on separate OS threads by
// default, but `FLYWHEEL_WORKTREE_ROOT` is process-wide state — without serialising access, two
// tests' `set_var`/`remove_var` calls interleave and a thread can observe the wrong root mid-call
// (reproduced: `ensure_worktree` resolving against the real `~/Flywheel/` instead of the scratch
// dir this test just set). This mutex scopes the fix to this file alone — each `tests/*.rs`
// integration test file compiles to its own binary, so it cannot race with `worktree_lifecycle.rs`
// or any other file's own (much smaller, apparently-safe-by-luck) use of the same pattern.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above — only one test at a time ever has
    // this var set within this binary, and it is always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

#[test]
fn determinism_two_calls_are_byte_identical_and_a_reorder_changes_the_output() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the thing", Some("Epic body"))
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Wire the packet", Some(&epic.id))
            .expect("create_task should succeed");
        let c1 = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "First criterion",
            Some("run the test"),
        )
        .expect("create_criterion 1 should succeed");
        let c2 = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Second criterion",
            None,
        )
        .expect("create_criterion 2 should succeed");

        let packet_a = assemble_context_packet(&conn, &task.id).expect("first assembly should succeed");
        let packet_b = assemble_context_packet(&conn, &task.id).expect("second assembly should succeed");
        assert_eq!(packet_a, packet_b, "two calls against an unchanged database must be structurally equal");

        let prompt_a = render_prompt(&packet_a, "");
        let prompt_b = render_prompt(&packet_b, "");
        assert_eq!(prompt_a, prompt_b, "rendered prompts must be byte-identical across calls");
        assert_eq!(
            packet_a.criteria[0].statement, c1.statement,
            "criteria should read in rank order before any reorder"
        );
        assert_eq!(packet_a.criteria[1].statement, c2.statement);

        // Reorder: move c2 before c1 (append after nothing — to the very front is unsupported by
        // `reorder_criterion`, so move c1 to be after c2 instead, which still changes the order).
        reorder_criterion(&mut conn, &actor_id, &c1.id, Some(&c2.rank), None)
            .expect("reorder_criterion should succeed");

        let packet_c = assemble_context_packet(&conn, &task.id).expect("third assembly should succeed");
        let prompt_c = render_prompt(&packet_c, "");
        assert_ne!(
            prompt_a, prompt_c,
            "the rendered prompt must change after a criterion reorder — this is what proves \
             determinism rather than mere constancy"
        );
        assert_eq!(packet_c.criteria[0].statement, c2.statement, "c2 should now be first");
        assert_eq!(packet_c.criteria[1].statement, c1.statement, "c1 should now be second");
    });
}

#[test]
fn a_task_with_no_epic_yields_an_absent_epic_section() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No epic here", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.epic.is_none(), "epic section must be absent, not an empty-string title");

        let prompt = render_prompt(&packet, "");
        assert!(!prompt.contains("Epic Context"), "no epic heading should be emitted");
    });
}

#[test]
fn a_task_with_no_description_yields_an_absent_task_description() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Bare task", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(
            packet.task_description.is_none(),
            "task description must be absent, not an empty string, for a task with none"
        );
    });
}

#[test]
fn zero_criteria_yields_an_empty_list_and_render_prompt_omits_the_criteria_heading() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No criteria yet", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.criteria.is_empty());

        let prompt = render_prompt(&packet, "");
        assert!(
            !prompt.contains("Acceptance Criteria"),
            "an empty criteria section must render no heading at all, not an empty section"
        );
    });
}

#[test]
fn an_existing_worktree_reports_the_stored_row_not_a_fresh_derivation() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Has a worktree", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        // Corrupt the stored base_branch with a sentinel value no fresh derivation could ever
        // produce — if `assemble_context_packet` recomputed instead of reading the row, this
        // sentinel would never appear in the packet.
        conn.execute(
            "UPDATE worktrees SET base_branch = 'sentinel-not-a-real-branch' WHERE id = ?1",
            rusqlite::params![worktree.id],
        )
        .expect("failed to corrupt the worktree row for this test");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.worktree.branch, worktree.branch);
        assert_eq!(packet.worktree.path, worktree.path);
        assert_eq!(
            packet.worktree.base_ref, "sentinel-not-a-real-branch",
            "the packet must report the row's stored base_branch, not a freshly derived value"
        );
    });
}

#[test]
fn a_task_with_no_worktree_yet_predicts_exactly_what_ensure_worktree_would_create() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Predicted epic", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Not started yet", Some(&epic.id))
            .expect("create_task should succeed");

        let predicted = assemble_context_packet(&conn, &task.id)
            .expect("assembly should succeed")
            .worktree;

        // The preview must not have cut the epic's integration branch or written the column —
        // this is the mutation this module's header comment forbids.
        let integration_branch_before: Option<String> = conn
            .query_row(
                "SELECT integration_branch FROM epics WHERE id = ?1",
                rusqlite::params![epic.id],
                |row| row.get(0),
            )
            .expect("epic row should exist");
        assert!(
            integration_branch_before.is_none(),
            "assembling the packet must never cut the epic's integration branch"
        );
        assert!(
            !core::git::rev_parse_verify(repo_dir.path(), &predicted.base_ref)
                .expect("rev_parse_verify should succeed"),
            "the predicted branch name must not exist in the repository — nothing was actually cut"
        );

        let actual = ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        assert_eq!(predicted.branch, actual.branch, "predicted branch must match what was actually created");
        assert_eq!(predicted.path, actual.path, "predicted path must match what was actually created");
        assert_eq!(
            predicted.base_ref, actual.base_branch,
            "predicted base ref must match the base branch ensure_worktree actually resolved"
        );
    });
}

#[test]
fn render_prompt_appends_the_instruction_heading_only_when_non_empty() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Instruction task", None)
            .expect("create_task should succeed");
        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");

        let with_instruction = render_prompt(&packet, "Please be careful with the migration.");
        assert!(with_instruction.contains("Additional Instructions"));
        assert!(with_instruction.contains("Please be careful with the migration."));

        let with_empty = render_prompt(&packet, "");
        assert!(!with_empty.contains("Additional Instructions"));

        let with_whitespace = render_prompt(&packet, "   \n\t  ");
        assert!(
            !with_whitespace.contains("Additional Instructions"),
            "a whitespace-only instruction must be treated as empty"
        );
    });
}

#[test]
fn render_prompt_is_byte_identical_across_calls_for_the_same_packet_and_instruction() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Stable render", None)
            .expect("create_task should succeed");
        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");

        let first = render_prompt(&packet, "steer it this way");
        let second = render_prompt(&packet, "steer it this way");
        assert_eq!(first, second);
    });
}

#[test]
fn assembling_the_packet_never_mutates_triggers_worktrees_or_agent_runs_row_counts() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Row count epic", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Row count task", Some(&epic.id))
            .expect("create_task should succeed");

        let count = |table: &str| -> i64 {
            conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .expect("count query should succeed")
        };

        let (triggers_before, worktrees_before, agent_runs_before) =
            (count("triggers"), count("worktrees"), count("agent_runs"));

        assemble_context_packet(&conn, &task.id).expect("assembly should succeed");

        assert_eq!(count("triggers"), triggers_before);
        assert_eq!(count("worktrees"), worktrees_before);
        assert_eq!(count("agent_runs"), agent_runs_before);
    });
}
