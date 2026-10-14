//! DRFT-04 (phase 13 plan 07, Task 2): the deriver is the one writer of `tasks.status`.
//!
//! The pure half (`derive_candidate`, `band_rank`) is tested directly; the writing half
//! (`derive_status`) runs against a migrated database, a real git repository and real
//! `git worktree`s, because the worktree signal (D-09) goes through `git_facts_for_task`.
//!
//! The deriver is **level-based for worktree and merge, edge-based for in_review** — the owner's
//! Task 1 decision (2026-10-15, "stay-lowered"): after a human `request_changes` lowers a card to
//! `in_progress`, a tick with the forge still `Open` must NOT raise it again. The test
//! `a_declined_card_stays_lowered_while_the_forge_is_unchanged` pins exactly that.

mod common;

use std::path::Path;
use std::process::Command;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::actor::system_actor;
use core::domain::task::{create_task, request_changes, set_task_status, ChangesRequestOutcome};
use core::forge::transitions::{apply_forge_observation, EVENT_FORGE_STATUS_WRITE_SKIPPED};
use core::forge::{CiResult, ForgeRequest, ForgeState};
use core::ids::new_id;
use core::query::events::activity_trail;
use core::status_derivation::{
    band_rank, derive_candidate, derive_status, is_review_edge, Derivation, BAND_ORDER,
};
use rusqlite::{params, Connection};

// ---------------------------------------------------------------------------------------------
// The pure half.
// ---------------------------------------------------------------------------------------------

#[test]
fn the_band_order_is_the_five_statuses_in_forward_order() {
    assert_eq!(BAND_ORDER, ["backlog", "todo", "in_progress", "in_review", "done"]);
    assert_eq!(band_rank("backlog"), Some(0));
    assert_eq!(band_rank("done"), Some(4));
}

#[test]
fn an_unknown_status_has_no_rank_rather_than_rank_zero() {
    assert_eq!(band_rank("archived"), None);
}

#[test]
fn no_worktree_and_no_forge_request_leaves_the_candidate_at_the_current_band() {
    assert_eq!(derive_candidate(false, ForgeState::None, false, "todo"), "todo");
}

#[test]
fn a_worktree_is_the_in_progress_signal() {
    assert_eq!(derive_candidate(true, ForgeState::None, false, "todo"), "in_progress");
}

#[test]
fn a_forge_state_change_into_open_is_the_in_review_edge() {
    assert!(is_review_edge(ForgeState::None, ForgeState::Open));
    assert!(is_review_edge(ForgeState::None, ForgeState::ChangesRequested));
    assert!(!is_review_edge(ForgeState::Open, ForgeState::Open));
    assert!(!is_review_edge(ForgeState::Open, ForgeState::Merged));
    assert_eq!(derive_candidate(true, ForgeState::Open, true, "in_progress"), "in_review");
}

#[test]
fn an_open_request_that_has_not_changed_is_not_a_reason_to_promote() {
    // The level (forge still Open) is not read for in_review: only the edge is.
    assert_eq!(derive_candidate(true, ForgeState::Open, false, "in_progress"), "in_progress");
}

#[test]
fn a_merge_is_the_done_signal_at_any_level() {
    assert_eq!(derive_candidate(true, ForgeState::Merged, false, "in_review"), "done");
    assert_eq!(derive_candidate(false, ForgeState::Merged, false, "done"), "done");
}

#[test]
fn a_closed_unmerged_request_produces_no_candidate_above_in_progress() {
    assert_eq!(derive_candidate(true, ForgeState::ClosedUnmerged, false, "in_review"), "in_progress");
}

#[test]
fn two_derivations_over_identical_inputs_are_identical() {
    for _ in 0..3 {
        assert_eq!(
            derive_candidate(true, ForgeState::Open, true, "todo"),
            derive_candidate(true, ForgeState::Open, true, "todo")
        );
    }
}

// ---------------------------------------------------------------------------------------------
// The writing half, against a real database and real worktrees.
// ---------------------------------------------------------------------------------------------

struct Fx {
    conn: Connection,
    human: String,
    system: String,
    project_id: String,
    repo: tempfile::TempDir,
    root: tempfile::TempDir,
}

fn git(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .status()
        .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
    assert!(status.success(), "git {args:?} failed");
}

fn fx() -> Fx {
    let (conn, human, project, repo) = common::seeded_git_project();
    let system = system_actor(&conn).expect("system actor").id;
    Fx { conn, human, system, project_id: project.id, repo, root: tempfile::tempdir().unwrap() }
}

impl Fx {
    fn task(&mut self, title: &str) -> String {
        create_task(&mut self.conn, &self.project_id, &self.human, title, None).expect("create_task").id
    }

    /// A real `git worktree` plus the matching `worktrees` row — the D-09 signal.
    fn give_worktree(&mut self, task_id: &str) {
        let branch = format!("flywheel/t-{}", new_id());
        let path = self.root.path().join(new_id());
        git(self.repo.path(), &["worktree", "add", path.to_str().unwrap(), "-b", &branch, "main"]);
        self.conn
            .execute(
                "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'main', 'active', ?6, '2026-01-01T00:00:00.000Z')",
                params![new_id(), task_id, self.project_id, path.to_string_lossy(), branch, self.human],
            )
            .expect("worktree row");
    }

    fn status(&self, task_id: &str) -> String {
        self.conn.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |r| r.get(0)).unwrap()
    }

    fn set(&mut self, task_id: &str, status: &str) {
        set_task_status(&mut self.conn, &self.human, task_id, status).expect("set status");
    }

    fn observe(&mut self, task_id: &str, state: ForgeState) {
        let request = ForgeRequest {
            state,
            ci: CiResult::None,
            number: 1,
            title: "Request #1".into(),
            url: "https://example.invalid/pr/1".into(),
            ci_url: None,
            is_draft: false,
            target_branch: "main".into(),
        };
        let observed = (state != ForgeState::None).then_some(&request);
        apply_forge_observation(&mut self.conn, task_id, observed, &self.system, None).expect("observe");
    }

    fn derive(&mut self, task_id: &str) -> Derivation {
        derive_status(&mut self.conn, &self.system, task_id, None).expect("derive")
    }

    fn status_events(&self, task_id: &str) -> usize {
        activity_trail(&self.conn, "task", task_id, 500, 0)
            .unwrap()
            .into_iter()
            .filter(|e| e.event_type == "task.status_changed")
            .count()
    }
}

#[test]
fn no_worktree_and_no_forge_request_writes_nothing_and_appends_no_event() {
    let mut f = fx();
    let t = f.task("Idle");
    assert_eq!(f.derive(&t), Derivation::Unchanged);
    assert_eq!(f.status(&t), "todo");
    assert_eq!(f.status_events(&t), 0);
}

#[test]
fn a_worktree_moves_todo_to_in_progress_with_one_event_and_a_second_derivation_is_silent() {
    let mut f = fx();
    let t = f.task("Started");
    f.give_worktree(&t);
    assert_eq!(f.derive(&t), Derivation::Wrote("in_progress".into()));
    assert_eq!(f.status(&t), "in_progress");
    assert_eq!(f.status_events(&t), 1);
    assert_eq!(f.derive(&t), Derivation::Unchanged);
    assert_eq!(f.status_events(&t), 1);
}

#[test]
fn an_opened_request_promotes_an_in_progress_card_to_in_review() {
    let mut f = fx();
    let t = f.task("Opened");
    f.give_worktree(&t);
    f.derive(&t);
    f.observe(&t, ForgeState::Open);
    assert_eq!(f.status(&t), "in_review");
}

#[test]
fn a_merge_moves_in_review_to_done_and_reading_it_again_writes_nothing() {
    let mut f = fx();
    let t = f.task("Merged");
    f.observe(&t, ForgeState::Open);
    f.observe(&t, ForgeState::Merged);
    assert_eq!(f.status(&t), "done");
    let events = f.status_events(&t);
    assert_eq!(f.derive(&t), Derivation::Unchanged, "terminal through the floor, not a special case");
    f.observe(&t, ForgeState::Merged);
    assert_eq!(f.status_events(&t), events);
}

#[test]
fn a_closed_unmerged_request_leaves_the_card_in_review() {
    let mut f = fx();
    let t = f.task("Closed");
    f.give_worktree(&t);
    f.observe(&t, ForgeState::Open);
    assert_eq!(f.status(&t), "in_review");
    f.observe(&t, ForgeState::ClosedUnmerged);
    assert_eq!(f.status(&t), "in_review", "the floor holds a declined request at in_review");
    assert_eq!(f.derive(&t), Derivation::Unchanged);
}

#[test]
fn a_forge_request_going_absent_after_a_merge_never_moves_a_done_card_backwards() {
    let mut f = fx();
    let t = f.task("Gone");
    f.give_worktree(&t);
    f.observe(&t, ForgeState::Merged);
    assert_eq!(f.status(&t), "done");
    f.observe(&t, ForgeState::None);
    assert_eq!(f.status(&t), "done");
    assert_eq!(f.derive(&t), Derivation::Unchanged);
}

#[test]
fn an_unaccepted_backlog_card_with_no_worktree_is_never_promoted_by_the_deriver() {
    let mut f = fx();
    let t = f.task("Proposed");
    f.set(&t, "backlog");
    assert_eq!(f.derive(&t), Derivation::Unchanged);
    assert_eq!(f.status(&t), "backlog", "backlog to todo rides acceptance, not derivation");
}

#[test]
fn a_declined_card_stays_lowered_while_the_forge_is_unchanged() {
    let mut f = fx();
    let t = f.task("Declined");
    create_criterion(&mut f.conn, &f.project_id, &f.human, "task", &t, "It works", None).expect("criterion");
    f.give_worktree(&t);
    f.derive(&t);
    f.observe(&t, ForgeState::Open);
    assert_eq!(f.status(&t), "in_review");

    let outcome = request_changes(&mut f.conn, &f.human, &t).expect("request_changes");
    assert_eq!(outcome, ChangesRequestOutcome::Requested { count: 1 });
    assert_eq!(f.status(&t), "in_progress", "request_changes is the one human act allowed to lower the floor");

    // The next ticks: the forge still reports the same Open request.
    f.observe(&t, ForgeState::Open);
    assert_eq!(f.derive(&t), Derivation::Unchanged);
    f.observe(&t, ForgeState::Open);
    assert_eq!(f.status(&t), "in_progress", "no tick re-raises a band the human declined");

    // Only the forge state itself changing moves it again.
    f.observe(&t, ForgeState::Merged);
    assert_eq!(f.status(&t), "done");
}

#[test]
fn a_stale_expected_status_refuses_the_write_and_says_so() {
    let mut f = fx();
    let t = f.task("Raced");
    f.give_worktree(&t);
    let outcome = derive_status(&mut f.conn, &f.system, &t, Some("backlog")).expect("derive");
    assert_eq!(
        outcome,
        Derivation::Refused { intended: "in_progress".into(), actual: "todo".into() }
    );
    assert_eq!(f.status(&t), "todo");
    assert_eq!(f.status_events(&t), 0);
}

#[test]
fn a_refused_forge_edge_leaves_the_skipped_trace_in_the_activity_trail() {
    let mut f = fx();
    let t = f.task("Raced edge");
    let request = ForgeRequest {
        state: ForgeState::Open,
        ci: CiResult::None,
        number: 2,
        title: "Request #2".into(),
        url: "https://example.invalid/pr/2".into(),
        ci_url: None,
        is_draft: false,
        target_branch: "main".into(),
    };
    let outcome = apply_forge_observation(&mut f.conn, &t, Some(&request), &f.system, Some("backlog"))
        .expect("apply");
    assert_eq!(outcome.status_changed_to, None);
    assert_eq!(f.status(&t), "todo");
    let skipped = activity_trail(&f.conn, "task", &t, 50, 0)
        .unwrap()
        .into_iter()
        .filter(|e| e.event_type == EVENT_FORGE_STATUS_WRITE_SKIPPED)
        .count();
    assert_eq!(skipped, 1);
}
