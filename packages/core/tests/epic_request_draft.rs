//! REVW-05 (Phase 8 plan 08-05): the epic-scoped request draft and the preconditions that stand in
//! front of the forge. Real git repositories, no forge CLI.

mod common;

use std::path::Path;

use core::domain::acceptance_criterion::{
    check_criterion_with_anchor, create_criterion, revise_criterion, toggle_criterion, AnchorInput,
};
use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::forge::request_body::assemble_epic_request_draft;
use core::ids::new_id;
use core::merge::{plan_merge, record_merge_event, run_merge};
use rusqlite::{params, Connection};

/// Serializes every test that sets `FLYWHEEL_WORKTREE_ROOT` (process-global), as the other
/// binaries do for the same reason.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK`; always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f(dir.path());
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

pub struct Board {
    pub conn: Connection,
    pub actor: String,
    pub project_id: String,
    pub repo: tempfile::TempDir,
    pub b: common::ReviewBranches,
    pub epic_id: String,
    pub epic_key: String,
}

/// A real repo with the review fixture and one epic (with a description) whose integration branch
/// is `flywheel/epic-int`, set directly as `review_merge.rs` does.
pub fn board() -> Board {
    let (mut conn, actor, project, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let epic = create_epic(&mut conn, &project.id, &actor, "Ship the review flow", Some("Everything needed to review and merge."))
        .expect("epic");
    conn.execute(
        "UPDATE epics SET integration_branch = ?1 WHERE id = ?2",
        params![b.integration, epic.id],
    )
    .expect("set integration_branch");
    Board { conn, actor, project_id: project.id, repo, b, epic_id: epic.id, epic_key: epic.key }
}

impl Board {
    /// A task under the epic whose worktree row names `branch` (no real task worktree).
    pub fn task(&mut self, title: &str, branch: &str) -> String {
        let t = create_task(&mut self.conn, &self.project_id, &self.actor, title, Some(&self.epic_id))
            .expect("task");
        self.conn
            .execute(
                "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
                 VALUES (?1, ?2, ?3, '/nonexistent/worktree', ?4, 'main', 'active', ?5, '2026-01-01T00:00:00.000Z')",
                params![new_id(), t.id, self.project_id, branch, self.actor],
            )
            .expect("insert worktree row");
        t.id
    }

    /// Merge `task_id` into the integration branch for real and record the event.
    pub fn merge(&mut self, task_id: &str) {
        let plan = plan_merge(&self.conn, task_id).expect("plan_merge");
        let outcome = run_merge(&plan).expect("run_merge");
        record_merge_event(&mut self.conn, &plan, &outcome, &self.actor).expect("record");
    }

    fn draft(&self) -> core::forge::request_body::RequestDraft {
        assemble_epic_request_draft(&self.conn, &self.epic_id).expect("assemble_epic_request_draft")
    }
}

// ----- the draft -----

#[test]
fn head_branch_is_the_integration_branch_with_no_remote_prefix() {
    let bd = board();
    let d = bd.draft();
    assert_eq!(d.head_branch, bd.b.integration);
    assert!(!d.head_branch.starts_with("origin/"));
}

#[test]
fn target_branch_is_the_default_branch_with_no_remote_prefix() {
    let bd = board();
    let d = bd.draft();
    assert_eq!(d.target_branch, "main");
    assert!(!d.target_branch.starts_with("origin/"));
}

#[test]
fn title_is_the_epics_title() {
    assert_eq!(board().draft().title, "Ship the review flow");
}

#[test]
fn body_names_the_epic_key_and_title_and_carries_the_description() {
    let bd = board();
    let d = bd.draft();
    assert!(d.body.starts_with(&format!("{}: Ship the review flow\n", bd.epic_key)), "{}", d.body);
    assert!(d.body.contains("Everything needed to review and merge."), "{}", d.body);
}

#[test]
fn body_omits_the_description_when_the_epic_has_none() {
    let (mut conn, actor, project, repo) = common::seeded_git_project();
    let b = common::review_branches(repo.path());
    let epic = create_epic(&mut conn, &project.id, &actor, "Bare epic", None).expect("epic");
    conn.execute("UPDATE epics SET integration_branch = ?1 WHERE id = ?2", params![b.integration, epic.id])
        .unwrap();
    let d = assemble_epic_request_draft(&conn, &epic.id).expect("draft");
    assert_eq!(d.body, format!("{}: Bare epic\n", epic.key));
}

#[test]
fn body_lists_current_criteria_with_real_checked_state_and_nothing_superseded() {
    let mut bd = board();
    let c1 = create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "epic", &bd.epic_id, "First", None).unwrap();
    create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "epic", &bd.epic_id, "Second", Some("run the suite"))
        .unwrap();
    let c3 = create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "epic", &bd.epic_id, "Old wording", None).unwrap();
    toggle_criterion(&mut bd.conn, &bd.actor, &c1.id).unwrap();
    revise_criterion(&mut bd.conn, &bd.actor, &c3.id, "New wording", None).unwrap();

    let body = bd.draft().body;
    assert!(body.contains("- [x] First\n"), "{body}");
    assert!(body.contains("- [ ] Second (Verify: run the suite)\n"), "{body}");
    assert!(body.contains("New wording"), "{body}");
    assert!(!body.contains("Old wording"), "a superseded revision must never appear: {body}");
    assert!(body.find("First").unwrap() < body.find("Second").unwrap(), "rank order");
}

#[test]
fn an_anchored_criterion_carries_its_path_and_range_and_an_unanchored_one_does_not() {
    let mut bd = board();
    let anchored =
        create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "epic", &bd.epic_id, "Anchored", None).unwrap();
    let plain = create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "epic", &bd.epic_id, "Plain", None).unwrap();
    let anchor = AnchorInput { path: "src/lib.rs".into(), side: "new".into(), line_start: 10, line_end: 14 };
    check_criterion_with_anchor(&mut bd.conn, &bd.actor, &anchored.id, Some(anchor), "abc123").unwrap();
    toggle_criterion(&mut bd.conn, &bd.actor, &plain.id).unwrap();

    let body = bd.draft().body;
    assert!(body.contains("- [x] Anchored — evidence: src/lib.rs:10-14\n"), "{body}");
    assert!(body.contains("- [x] Plain\n"), "an unanchored criterion has no evidence clause: {body}");
}

#[test]
fn roll_up_lists_each_task_with_status_criteria_count_and_integrated_in_both_states() {
    with_scratch_worktree_root(|_| {
        let mut bd = board();
        let merged = bd.task("Clean work", bd.b.task_clean);
        let open = bd.task("Rich work", bd.b.task_rich);
        let c = create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "task", &merged, "Done well", None).unwrap();
        create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "task", &merged, "Also this", None).unwrap();
        toggle_criterion(&mut bd.conn, &bd.actor, &c.id).unwrap();
        bd.merge(&merged);

        let body = bd.draft().body;
        let key = |id: &str| -> String {
            bd.conn.query_row("SELECT key FROM tasks WHERE id = ?1", [id], |r| r.get(0)).unwrap()
        };
        assert!(
            body.contains(&format!("- {}: Clean work — backlog — 1/2 criteria checked — integrated\n", key(&merged))),
            "{body}"
        );
        assert!(
            body.contains(&format!("- {}: Rich work — backlog — 0/0 criteria checked — not integrated\n", key(&open))),
            "{body}"
        );
    });
}

#[test]
fn an_epic_with_no_tasks_has_an_empty_roll_up_rather_than_an_error() {
    let body = board().draft().body;
    assert!(!body.contains("## Tasks"), "{body}");
}

#[test]
fn an_epic_with_no_integration_branch_is_a_named_error_and_none_is_cut() {
    let mut bd = board();
    bd.conn.execute("UPDATE epics SET integration_branch = NULL WHERE id = ?1", [&bd.epic_id]).unwrap();
    let err = assemble_epic_request_draft(&bd.conn, &bd.epic_id).expect_err("must refuse").to_string();
    assert!(err.contains(&bd.epic_key), "the error must identify the epic: {err}");
    let still: Option<String> = bd
        .conn
        .query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&bd.epic_id], |r| r.get(0))
        .unwrap();
    assert_eq!(still, None, "asking for a draft must not cut a branch");
}

#[test]
fn draft_is_deterministic_across_two_calls() {
    with_scratch_worktree_root(|_| {
        let mut bd = board();
        let t = bd.task("Clean work", bd.b.task_clean);
        create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "task", &t, "A criterion", None).unwrap();
        create_criterion(&mut bd.conn, &bd.project_id, &bd.actor, "epic", &bd.epic_id, "Epic criterion", None).unwrap();
        assert_eq!(bd.draft(), bd.draft());
        assert_eq!(bd.draft().body.as_bytes(), bd.draft().body.as_bytes());
    });
}

#[test]
fn draft_reads_no_clock_so_the_same_database_at_two_times_is_the_same_draft() {
    let bd = board();
    let first = bd.draft();
    std::thread::sleep(std::time::Duration::from_millis(1100));
    assert_eq!(first, bd.draft());
}
