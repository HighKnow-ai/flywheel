//! One test per Phase 5 roadmap success criterion (`ROADMAP.md` §"Phase 5: Socratic Epic
//! Authoring", verbatim), driving a realistic board through the whole journey against a real
//! temporary database — not a restatement of the unit tests scattered across
//! `authoring_tracer.rs`/`authoring_stage.rs`/`authoring_proposal.rs`/`authoring_lifecycle.rs`,
//! but the composition of them: this file fails when two independently-correct pieces stop
//! fitting together.
//!
//! Every ordinal marker in these fixtures is zero-padded (`epic-01`, not `epic-1`) — the same
//! discipline `five_cycle_reconstitution.rs` established in Phase 4: an unpadded marker is a
//! Rust-string prefix of a later one, which makes an absence assertion spuriously pass by
//! matching inside a later marker's own text.

mod common;

use core::domain::agent_run::{close_agent_run, AgentRunStatus};
use core::domain::authoring_proposal::{
    accept_proposal, accept_subtree, amend_proposal, create_proposal, pending_proposals_for_run,
    reject_proposal, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, current_stage, start_authoring_run, AuthoringStage};
use core::domain::session_summary::{create_summary, SummaryFields};
use core::epic_context_packet::{assemble_epic_context_packet, render_epic_prompt};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `advance_stage` writes
/// the D-88 authoring-stage runtime marker as part of its own transaction, mirroring
/// `authoring_stage.rs`'s/`authoring_proposal.rs`'s own identically-named lock; every test below
/// calls `advance_stage` at least once.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

fn count_epics(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM epics", [], |row| row.get(0)).unwrap()
}
fn count_tasks(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap()
}
fn count_criteria(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0)).unwrap()
}
fn proposal_status(conn: &Connection, proposal_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM authoring_proposals WHERE id = ?1",
        params![proposal_id],
        |row| row.get(0),
    )
    .unwrap()
}

// ============================================================================================
// Criterion 1 — "the agent challenges his assumptions and asks clarifying questions before any
// work is planned." (SHAPE-01)
// ============================================================================================

#[test]
fn criterion_1_the_agent_challenges_before_any_work_is_planned() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run should succeed");

        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Challenge),
            "a fresh session starts in the challenge stage"
        );

        // D-88's own named test: "no proposal row exists before the stage advanced." The
        // structural half of this guarantee — that no proposal tool is even reachable during
        // `challenge` — is enforced one layer up, at the sidecar's `PreToolUse` hook
        // (`packages/sidecar/test/authoring-stage-gate.test.mjs`, plan 05-03), which this crate
        // cannot drive directly (it has no sidecar process). What this Rust-level test proves is
        // the DB-side half the hook's own denial reads: the stage is genuinely `challenge`, and
        // consequently zero proposal rows exist for this run — attempting to write one before
        // advancing is exactly what the hook refuses before `create_proposal` is ever called.
        assert!(
            pending_proposals_for_run(&conn, &run.id, 200).unwrap().is_empty(),
            "no proposal row exists before the stage advanced"
        );

        let (stage, distillation) = advance_stage(&mut conn, &run.id, &actor_id)
            .expect("advance_stage should succeed");
        assert_eq!(stage, AuthoringStage::Decompose);
        let instruction = distillation
            .expect("advancing out of challenge must return a distillation instruction");
        assert!(
            instruction.text.contains("propose_assumption"),
            "the distillation instruction must name propose_assumption by its exact tool name"
        );

        // Now — and only now — a proposal succeeds.
        create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Assumption {
                assumption: "Should this ship behind a feature flag?".to_string(),
                answer: "No, ship it plainly.".to_string(),
            },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("a proposal succeeds once past the challenge stage");

        assert_eq!(
            pending_proposals_for_run(&conn, &run.id, 200).unwrap().len(),
            1,
            "authoring_proposals is non-empty after the stage advanced"
        );
    });
}

// ============================================================================================
// Criterion 2 — "The session's outcome lands directly on the board as a structured epic with
// child tasks and drafted acceptance criteria for each task — not as a markdown file or a chat
// log." (SHAPE-02)
// ============================================================================================

#[test]
fn criterion_2_lands_directly_on_the_board_never_as_a_file() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        assert_eq!(count_epics(&conn), 0);
        assert_eq!(count_tasks(&conn), 0);
        assert_eq!(count_criteria(&conn), 0);

        // A scratch directory this flow must never write to (D-80: the board is the store of
        // record for an authoring session's outcome — never a markdown file, never a chat log).
        // Snapshotted before and after the whole journey below.
        let scratch = tempfile::tempdir().expect("scratch dir");
        assert!(std::fs::read_dir(scratch.path()).unwrap().next().is_none());

        // Session 01 (zero-padded): a fresh-epic session proposes and accepts the epic itself.
        let run_01 = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run (01) should succeed");
        advance_stage(&mut conn, &run_01.id, &actor_id).expect("advance_stage should succeed");
        let epic_proposal = create_proposal(
            &mut conn,
            &run_01.id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "epic-01".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose the epic");
        let epic_outcome = accept_proposal(&mut conn, &epic_proposal.id, &actor_id)
            .expect("accept the epic proposal");
        assert_eq!(count_epics(&conn), 1);
        let epic_id = epic_outcome.materialised_id;

        // Session 02: the epic REOPENED (SHAPE-05's own door, plan 05-10 Task 1) — the only path
        // by which a task proposal's own `epic_id` resolves to the just-created epic, since
        // `agent_runs.epic_id` is fixed at the run's own start (D-84) and is never retroactively
        // updated by an accept inside the same run. This is the realistic two-session shape the
        // shipped write path actually supports, not a hypothetical: `authoring_proposal.rs`'s own
        // `materialise_proposal` resolves a task's `epic_id` from `proposal.epic_id` (the RUN's
        // scope, set once at start), never from an accepted sibling epic proposal.
        let run_02 = start_authoring_run(
            &mut conn,
            &project.id,
            Some(&epic_id),
            "default",
            &actor_id,
        )
        .expect("start_authoring_run (02, reopened) should succeed");
        advance_stage(&mut conn, &run_02.id, &actor_id).expect("advance_stage should succeed");

        for i in 1..=3 {
            let task_proposal = create_proposal(
                &mut conn,
                &run_02.id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("task-{i:02}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .expect("propose a task");
            for j in 1..=2 {
                create_proposal(
                    &mut conn,
                    &run_02.id,
                    ProposalVerb::Create,
                    ProposalPayload::Criterion {
                        statement: format!("task-{i:02}-criterion-{j:02}"),
                        verification_hint: None,
                    },
                    None,
                    Some(&task_proposal.id),
                    ProposalProvenance::NONE,
                )
                .expect("propose a criterion");
            }
            accept_subtree(&mut conn, &task_proposal.id, &actor_id)
                .expect("accept the task's own subtree");
        }

        assert_eq!(count_epics(&conn), 1);
        assert_eq!(count_tasks(&conn), 3, "three tasks, each carrying the epic's own id");
        assert_eq!(count_criteria(&conn), 6, "six criteria — two per task, never folded into prose");

        let task_epic_ids: Vec<Option<String>> = conn
            .prepare("SELECT epic_id FROM tasks")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(
            task_epic_ids.iter().all(|id| id.as_deref() == Some(epic_id.as_str())),
            "every materialised task carries the SAME epic id"
        );

        assert!(
            std::fs::read_dir(scratch.path()).unwrap().next().is_none(),
            "the authoring flow must never write a file — the board is the store of record"
        );
    });
}

// ============================================================================================
// Criterion 3 — "User accepts, rejects or amends each proposed item and each drafted criterion
// individually, rather than accepting the set wholesale." (SHAPE-03, SHAPE-04)
// ============================================================================================

#[test]
fn criterion_3_accepts_rejects_and_amends_each_item_individually() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run should succeed");
        advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

        let epic_proposal = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "epic-01".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose the epic");

        let mut task_proposals = Vec::new();
        let mut criterion_proposals = Vec::new();
        for i in 1..=3 {
            let task = create_proposal(
                &mut conn,
                &run.id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("task-{i:02}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .expect("propose a task");
            for j in 1..=2 {
                let criterion = create_proposal(
                    &mut conn,
                    &run.id,
                    ProposalVerb::Create,
                    ProposalPayload::Criterion {
                        statement: format!("task-{i:02}-criterion-{j:02}"),
                        verification_hint: None,
                    },
                    None,
                    Some(&task.id),
                    ProposalProvenance::NONE,
                )
                .expect("propose a criterion");
                criterion_proposals.push(criterion);
            }
            task_proposals.push(task);
        }
        // The tray: 1 epic + 3 tasks + 6 criteria = 10 staged rows. criterion_proposals is
        // indexed [task-01-c1, task-01-c2, task-02-c1, task-02-c2, task-03-c1, task-03-c2].

        // Accept one criterion alone (task-01's first) — D-96's implied-parent rule accepts
        // task-01 too, since its parent proposal was still pending.
        accept_proposal(&mut conn, &criterion_proposals[0].id, &actor_id)
            .expect("accept one criterion alone");
        assert_eq!(proposal_status(&conn, &criterion_proposals[0].id), "accepted");
        assert_eq!(proposal_status(&conn, &task_proposals[0].id), "accepted");
        assert_eq!(count_criteria(&conn), 1);

        // Reject another (task-02's first) with a reason — the row is terminal with the reason
        // recorded; rejecting does NOT imply-accept its parent, unlike accepting.
        let rejected = reject_proposal(
            &mut conn,
            &criterion_proposals[2].id,
            &actor_id,
            Some("Wrong shape"),
        )
        .expect("reject with a reason");
        assert_eq!(rejected.status, "rejected");
        assert_eq!(rejected.rejection_reason.as_deref(), Some("Wrong shape"));
        assert_eq!(proposal_status(&conn, &task_proposals[1].id), "pending");

        // Amend a third (task-03's first) and accept it — the materialised statement is the
        // developer's own text, never the agent's original.
        amend_proposal(
            &mut conn,
            &criterion_proposals[4].id,
            &actor_id,
            ProposalPayload::Criterion {
                statement: "The developer's own wording".to_string(),
                verification_hint: None,
            },
        )
        .expect("amend the staged row");
        accept_proposal(&mut conn, &criterion_proposals[4].id, &actor_id)
            .expect("accept the amended criterion");
        let materialised_statement: String = conn
            .query_row(
                "SELECT statement FROM acceptance_criteria WHERE id = \
                 (SELECT materialised_id FROM authoring_proposals WHERE id = ?1)",
                params![criterion_proposals[4].id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(materialised_statement, "The developer's own wording");
        assert_ne!(materialised_statement, "task-03-criterion-01", "never the agent's original text");

        // Accept one task subtree (task-02) — its already-rejected criterion is skipped, its
        // remaining pending criterion is accepted alongside the root.
        let subtree_outcome = accept_subtree(&mut conn, &task_proposals[1].id, &actor_id)
            .expect("accept one task subtree");
        assert_eq!(subtree_outcome.accepted_count, 2, "the root task plus its one still-pending criterion");
        assert_eq!(subtree_outcome.skipped_count, 1, "the already-rejected criterion is skipped, not re-decided");

        // Leave the rest pending: the epic itself, task-01's second criterion, task-03's second
        // criterion.
        assert_eq!(proposal_status(&conn, &epic_proposal.id), "pending");
        assert_eq!(proposal_status(&conn, &criterion_proposals[1].id), "pending");
        assert_eq!(proposal_status(&conn, &criterion_proposals[5].id), "pending");

        // Final state, row by row.
        assert_eq!(proposal_status(&conn, &task_proposals[0].id), "accepted");
        assert_eq!(proposal_status(&conn, &task_proposals[1].id), "accepted");
        assert_eq!(proposal_status(&conn, &task_proposals[2].id), "accepted");
        assert_eq!(proposal_status(&conn, &criterion_proposals[0].id), "accepted");
        assert_eq!(proposal_status(&conn, &criterion_proposals[2].id), "rejected");
        assert_eq!(proposal_status(&conn, &criterion_proposals[3].id), "accepted");
        assert_eq!(proposal_status(&conn, &criterion_proposals[4].id), "accepted");

        // The structural half — "no code path exists that would have accepted all ten at once" —
        // is proven ONCE, not re-derived here: `authoring_proposal.rs`'s own
        // `no_accept_all_identifier_exists_outside_this_gates_own_file` (plan 05-06) walks every
        // `.rs`/`.ts`/`.tsx` file under the three scanned source trees and fails the build if an
        // accept-all/accept-remaining identifier appears anywhere. `cargo test --workspace` (this
        // plan's own `<verify>`) re-runs it every time; duplicating the walk here would be a
        // second, independently-maintained copy of the same gate for no additional coverage.
    });
}

// ============================================================================================
// Criterion 4 — "User reopens an epic weeks later, continues shaping it, and the agent
// challenges the change against what the epic already contains." (SHAPE-05)
// ============================================================================================

#[test]
fn criterion_4_reopening_an_epic_primes_the_challenge_against_what_it_already_contains() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();

        // Build a real epic with one task and one criterion (mirrors criterion 2's own two-run
        // construction — the shape the shipped write path actually requires).
        let run_01 = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run (01) should succeed");
        advance_stage(&mut conn, &run_01.id, &actor_id).expect("advance_stage should succeed");
        let epic_proposal = create_proposal(
            &mut conn,
            &run_01.id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "epic-01".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose the epic");
        let epic_outcome = accept_proposal(&mut conn, &epic_proposal.id, &actor_id)
            .expect("accept the epic");
        let epic_id = epic_outcome.materialised_id;

        let run_02 = start_authoring_run(&mut conn, &project.id, Some(&epic_id), "default", &actor_id)
            .expect("start_authoring_run (02, reopened) should succeed");
        advance_stage(&mut conn, &run_02.id, &actor_id).expect("advance_stage should succeed");
        let task_proposal = create_proposal(
            &mut conn,
            &run_02.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "task-01".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose the task");
        create_proposal(
            &mut conn,
            &run_02.id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "criterion-01".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("propose the criterion");
        accept_subtree(&mut conn, &task_proposal.id, &actor_id).expect("accept the task's own subtree");

        // Two further rejected proposals against this epic — D-83's own re-proposal guard.
        let rejected_task = create_proposal(
            &mut conn,
            &run_02.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "rejected-task-01".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose the rejected task");
        reject_proposal(&mut conn, &rejected_task.id, &actor_id, Some("Out of scope"))
            .expect("reject the task proposal");
        let rejected_assumption = create_proposal(
            &mut conn,
            &run_02.id,
            ProposalVerb::Create,
            ProposalPayload::Assumption {
                assumption: "Should this cover mobile too?".to_string(),
                answer: "No.".to_string(),
            },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose the rejected assumption");
        reject_proposal(&mut conn, &rejected_assumption.id, &actor_id, None)
            .expect("reject the assumption proposal");

        // Close run 02 with a summary — an authoring run's own terminal path (D-64/plan 05-09).
        let summary_fields = SummaryFields {
            changed_files: Vec::new(),
            changed_prose: Some("Shaped the epic's first task.".to_string()),
            remains: None,
            next_session_must_know: None,
            decisions: Vec::new(),
            acknowledged_decisions: Vec::new(),
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(&mut conn, &run_02.id, summary_fields, &actor_id)
            .expect("create_summary should succeed");
        close_agent_run(&mut conn, &run_02.id, AgentRunStatus::Completed, None, None, None)
            .expect("close_agent_run should succeed");

        // Reopen: a THIRD run against the SAME epic, weeks later (SHAPE-05).
        let run_03 = start_authoring_run(&mut conn, &project.id, Some(&epic_id), "default", &actor_id)
            .expect("start_authoring_run (03, reopened again) should succeed");
        assert_eq!(
            run_03.authoring_stage.as_deref(),
            Some("challenge"),
            "a reopened run starts in challenge like any other (D-88)"
        );

        let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic_id))
            .expect("assembling the reopened epic's packet should succeed");
        let prompt = render_epic_prompt(&packet, None);

        assert_eq!(packet.task_roster.len(), 1);
        assert!(prompt.contains("task-01"));
        assert!(prompt.contains("criterion-01"));

        assert_eq!(packet.rejected.verbatim.len(), 2);
        assert!(prompt.contains("rejected-task-01"));
        assert!(prompt.contains("Should this cover mobile too?"));
        assert!(
            prompt.contains("Do not re-propose any of them"),
            "the priming prompt must literally tell the model not to re-propose what was rejected"
        );
    });
}

// ============================================================================================
// Plan 05-10 Task 3(b): four listing/ordering properties that only show up across the WHOLE
// journey, not inside any single unit test already shipped.
// ============================================================================================

#[test]
fn pending_proposals_come_back_in_the_same_order_across_two_reads() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run should succeed");
        advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

        for i in 1..=5 {
            create_proposal(
                &mut conn,
                &run.id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("task-{i:02}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .expect("propose a task");
        }

        let first_read: Vec<String> = pending_proposals_for_run(&conn, &run.id, 200)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        let second_read: Vec<String> = pending_proposals_for_run(&conn, &run.id, 200)
            .unwrap()
            .into_iter()
            .map(|p| p.id)
            .collect();
        assert_eq!(first_read, second_read, "two reads of the same pending window must agree on order");
        assert_eq!(first_read.len(), 5);
    });
}

#[test]
fn two_byte_identical_criterion_statements_stay_two_distinct_rows() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run should succeed");
        advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

        let task_a = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "task-a".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose task A");
        let task_b = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "task-b".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose task B");

        const SHARED_STATEMENT: &str = "Byte-identical criterion text on two different tasks";
        let criterion_a = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Criterion {
                statement: SHARED_STATEMENT.to_string(),
                verification_hint: None,
            },
            None,
            Some(&task_a.id),
            ProposalProvenance::NONE,
        )
        .expect("propose criterion A");
        let criterion_b = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Criterion {
                statement: SHARED_STATEMENT.to_string(),
                verification_hint: None,
            },
            None,
            Some(&task_b.id),
            ProposalProvenance::NONE,
        )
        .expect("propose criterion B");

        let outcome_a = accept_proposal(&mut conn, &criterion_a.id, &actor_id)
            .expect("accept criterion A (implies task A)");
        let outcome_b = accept_proposal(&mut conn, &criterion_b.id, &actor_id)
            .expect("accept criterion B (implies task B)");

        assert_ne!(
            outcome_a.materialised_id, outcome_b.materialised_id,
            "two byte-identical criterion statements must still be two distinct rows"
        );
        assert_eq!(count_criteria(&conn), 2);
        let statements: Vec<String> = conn
            .prepare("SELECT statement FROM acceptance_criteria ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert!(statements.iter().all(|s| s == SHARED_STATEMENT));
    });
}

#[test]
fn a_task_accepted_with_zero_criteria_produces_zero_criteria_rows() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run should succeed");
        advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

        let lonely_task = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "task-with-no-criteria".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose a task with no drafted criteria");

        let outcome = accept_subtree(&mut conn, &lonely_task.id, &actor_id)
            .expect("accept the childless task's own subtree");
        assert_eq!(outcome.accepted_count, 1, "the root task alone");
        assert_eq!(outcome.skipped_count, 0);
        assert_eq!(count_tasks(&conn), 1);
        assert_eq!(count_criteria(&conn), 0, "a task with zero drafted criteria writes zero criteria rows");
    });
}

#[test]
fn per_project_key_allocation_follows_acceptance_order_never_proposal_order() {
    with_scratch_runtime_dir(|| {
        let (mut conn, actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
            .expect("start_authoring_run should succeed");
        advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

        // Proposed in this order — "task-early" first, "task-late" second.
        let proposed_early = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "task-early".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose task-early");
        let proposed_late = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "task-late".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("propose task-late");

        // D-96/D-10: key allocation happens at MATERIALISATION time, inside create_task_in_tx's
        // own per-project counter UPDATE — accepted here in the REVERSE of proposal order.
        let late_outcome = accept_proposal(&mut conn, &proposed_late.id, &actor_id)
            .expect("accept task-late FIRST");
        let early_outcome = accept_proposal(&mut conn, &proposed_early.id, &actor_id)
            .expect("accept task-early SECOND");

        let key_of = |id: &str| -> String {
            conn.query_row("SELECT key FROM tasks WHERE id = ?1", params![id], |row| row.get(0))
                .unwrap()
        };
        let late_key = key_of(&late_outcome.materialised_id);
        let early_key = key_of(&early_outcome.materialised_id);
        assert_eq!(late_key, "FLY-1", "accepted first, so it claims the project's first key");
        assert_eq!(early_key, "FLY-2", "accepted second, even though it was PROPOSED first");

        // "Nothing renders a key for a pending proposal": the desktop-side half of this property
        // (`ProposalDto` — `commands/authoring.rs` — carries no `key` field at all, and
        // `proposal-tray.test.tsx`'s own D-96 test asserts a pending row never renders
        // project-key-shaped text) is plan 05-07's own coverage, re-run by `npm --prefix
        // packages/desktop run test` — not re-derived here, since `authoring_proposals` itself
        // has no `key` column to assert against on this side of the seam.
        let proposal_has_key_column: i64 = conn
            .prepare("PRAGMA table_info(authoring_proposals)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .filter(|name| name.as_deref() == Ok("key"))
            .count() as i64;
        assert_eq!(proposal_has_key_column, 0, "authoring_proposals must never grow its own key column");
    });
}
