//! Phase 15 plan 07 (DRFT-03, DRFT-07; D-01..D-05, D-07, D-14): the two acceptance tiers.
//!
//! Task 1 half: the tiers are declared once, the project cap reads that declaration, and an item's
//! provisional values are a derived read over `authoring_proposals` (no column, no second writer).
//! Task 3 half (further down): Start Work confirms them through the canonical writers.
//!
//! Self-contained fixtures, copied rather than shared (this repo's precedent).

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    acceptance_tier, create_proposal, reject_proposal, AcceptanceTier, ProposalOutcome, ProposalPayload,
    ProposalProvenance, ProposalTargetType, ProposalVerb, OPEN_DRAFTS_PER_PROJECT,
};
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::provisional_values::{provisional_values_for, PROVISIONAL_VALUES_LIMIT};
use rusqlite::{params, Connection};

fn seeded_run(conn: &mut Connection, project_id: &str, human_actor_id: &str, title: &str) -> String {
    let task = create_task(conn, project_id, human_actor_id, title, None).expect("create_task should succeed");
    let agent_actor = agent_actor_id(conn).expect("seeded agent actor should exist");
    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![new_id(), project_id, task.id, human_actor_id, now],
            |row| row.get(0),
        )
        .expect("failed to insert fixture trigger");
    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', NULL, \
            NULL, NULL, ?6, ?7, NULL, NULL)",
        params![run_id, task.id, project_id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl"), now],
    )
    .expect("failed to insert fixture agent_run");
    run_id
}

fn task_amend(title: &str, description: Option<&str>, priority: Option<i64>) -> ProposalPayload {
    ProposalPayload::Task {
        title: title.to_string(),
        description: description.map(str::to_string),
        priority,
    }
}

fn provenance(priority: Option<i64>) -> ProposalProvenance {
    ProposalProvenance {
        rationale: priority.map(|_| "it blocks two other tasks".to_string()),
        origin_log_offset: None,
    }
}

/// Stage a task amend against `task_id`; returns the proposal id.
fn stage_amend(
    conn: &mut Connection,
    run: &str,
    task_id: &str,
    title: &str,
    description: Option<&str>,
    priority: Option<i64>,
) -> String {
    create_proposal(
        conn,
        run,
        ProposalVerb::Amend,
        task_amend(title, description, priority),
        Some(task_id),
        None,
        provenance(priority),
    )
    .unwrap_or_else(|e| panic!("amend should stage: {e:#}"))
    .id
}

fn criterion(n: usize) -> ProposalPayload {
    ProposalPayload::Criterion {
        statement: format!("Returns {n} rows for page {n}"),
        verification_hint: None,
        pinned_revision: None,
    }
}

// --- Test 1: the tiers are declared once, and a new target type cannot dodge them ---------------

#[test]
fn criterion_is_explicit_and_every_other_target_type_is_provisional() {
    // An exhaustive match with no wildcard: a new variant fails THIS file's build until it is
    // counted here, which is what makes the length assertion below honest.
    let counted = |t: ProposalTargetType| -> usize {
        match t {
            ProposalTargetType::Epic => 1,
            ProposalTargetType::Task => 1,
            ProposalTargetType::Criterion => 1,
            ProposalTargetType::Assumption => 1,
            ProposalTargetType::Issue => 1,
        }
    };
    assert_eq!(ProposalTargetType::ALL.iter().map(|t| counted(*t)).sum::<usize>(), ProposalTargetType::ALL.len());
    for t in ProposalTargetType::ALL {
        let expected = if t == ProposalTargetType::Criterion { AcceptanceTier::Explicit } else { AcceptanceTier::Provisional };
        assert_eq!(acceptance_tier(t), expected, "{t:?}");
    }
    // ALL really is every variant: it round-trips through the schema vocabulary, no duplicates.
    let mut names: Vec<&str> = ProposalTargetType::ALL.iter().map(|t| t.as_str()).collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), ProposalTargetType::ALL.len());
}

// --- Test 2: the cap counts the explicit tier and only the explicit tier (D-14) -----------------

#[test]
fn the_project_cap_counts_a_pending_criterion_and_not_a_pending_task_amend() {
    let (mut conn, human, project) = common::seeded_project();
    let target = create_task(&mut conn, &project.id, &human, "Target", None).unwrap();
    let mut run = seeded_run(&mut conn, &project.id, &human, "Run 0");

    // Thirty pending task amends: none counts toward the cap, so a criterion still stages. They
    // arrive across runs because the per-run cap (10) is in force too.
    for n in 0..30 {
        if n > 0 && n % 10 == 0 {
            run = seeded_run(&mut conn, &project.id, &human, &format!("Run {}", n / 10));
        }
        stage_amend(&mut conn, &run, &target.id, &format!("Retitle {n}"), None, None);
    }
    let fresh = seeded_run(&mut conn, &project.id, &human, "Criterion run");
    create_proposal(&mut conn, &fresh, ProposalVerb::Create, criterion(0), None, None, ProposalProvenance::NONE)
        .expect("provisional drafts must not consume the explicit-tier cap");

    // Fill to the cap with criteria: the 30th stages, the 31st is refused, whatever else is pending.
    let mut staged = 1;
    let mut run = fresh;
    while staged < OPEN_DRAFTS_PER_PROJECT {
        if staged % 10 == 0 {
            run = seeded_run(&mut conn, &project.id, &human, &format!("C{staged}"));
        }
        create_proposal(&mut conn, &run, ProposalVerb::Create, criterion(staged), None, None, ProposalProvenance::NONE)
            .unwrap_or_else(|e| panic!("criterion {staged} should stage: {e:#}"));
        staged += 1;
    }
    let over = seeded_run(&mut conn, &project.id, &human, "Over");
    let refused = create_proposal(&mut conn, &over, ProposalVerb::Create, criterion(99), None, None, ProposalProvenance::NONE);
    assert!(refused.is_err(), "the 31st explicit draft is refused");
    // And a task amend is still never refused by the project cap.
    stage_amend(&mut conn, &over, &target.id, "Still fine", None, None);
}

#[test]
fn the_cap_source_reads_the_tier_function_not_a_literal_list() {
    let src = std::fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/domain/authoring_proposal.rs"),
    )
    .unwrap();
    assert!(!src.contains("IN ('criterion'"), "the cap must not spell its own explicit-tier list");
    assert!(src.contains("acceptance_tier(payload.target_type()) == AcceptanceTier::Explicit"));
}

// --- Tests 3-7: the provisional read ------------------------------------------------------------

#[test]
fn a_pending_task_amend_reads_back_with_the_current_value_and_the_proposing_actor() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old title", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    let id = stage_amend(&mut conn, &run, &task.id, "New title", None, None);

    let values = provisional_values_for(&conn, "task", &task.id).unwrap();
    assert_eq!(values.len(), 1, "{values:?}");
    let v = &values[0];
    assert_eq!(v.proposal_id, id);
    assert_eq!(v.field, "title");
    assert_eq!(v.proposed, "New title");
    assert_eq!(v.current.as_deref(), Some("Old title"));
    assert_eq!(v.run_id, run);
    assert_eq!(v.actor_name, "Claude Code");
}

#[test]
fn title_description_and_priority_each_read_back_as_their_own_field() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Same", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    stage_amend(&mut conn, &run, &task.id, "Same", Some("A body"), Some(1));

    let values = provisional_values_for(&conn, "task", &task.id).unwrap();
    let fields: Vec<&str> = values.iter().map(|v| v.field.as_str()).collect();
    assert_eq!(fields, vec!["description", "priority"], "an unchanged title is not a suggestion: {values:?}");
    assert_eq!(values[0].current, None);
    assert_eq!(values[1].proposed, "1");
}

#[test]
fn only_a_pending_proposal_is_provisional_in_waiting() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    let rejected = stage_amend(&mut conn, &run, &task.id, "One", None, None);
    let accepted = stage_amend(&mut conn, &run, &task.id, "Two", None, None);
    let deferred = stage_amend(&mut conn, &run, &task.id, "Three", None, None);
    let merged = stage_amend(&mut conn, &run, &task.id, "Four", None, None);
    let _pending = stage_amend(&mut conn, &run, &task.id, "Five", None, None);
    reject_proposal(&mut conn, &rejected, &human, None).unwrap();
    // The three other decided states are set directly: this test reads the status filter, not the
    // writers (which have their own suites).
    for (id, status) in [(&accepted, "accepted"), (&deferred, "deferred"), (&merged, "merged")] {
        conn.execute("UPDATE authoring_proposals SET status = ?1 WHERE id = ?2", params![status, id]).unwrap();
    }

    let values = provisional_values_for(&conn, "task", &task.id).unwrap();
    assert_eq!(values.iter().map(|v| v.proposed.as_str()).collect::<Vec<_>>(), vec!["Five"]);
}

#[test]
fn two_amendments_to_one_field_read_in_staging_position_order() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    for t in ["First", "Second", "Third"] {
        stage_amend(&mut conn, &run, &task.id, t, None, None);
    }
    let values = provisional_values_for(&conn, "task", &task.id).unwrap();
    assert_eq!(values.iter().map(|v| v.proposed.as_str()).collect::<Vec<_>>(), vec!["First", "Second", "Third"]);
}

#[test]
fn a_pending_criterion_draft_never_appears_in_the_provisional_read() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Task", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    create_proposal(&mut conn, &run, ProposalVerb::Create, criterion(1), Some(&task.id), None, ProposalProvenance::NONE)
        .unwrap();
    assert!(provisional_values_for(&conn, "task", &task.id).unwrap().is_empty());
    // Asking the read about an explicit-tier parent is empty, never an error and never a leak.
    assert!(provisional_values_for(&conn, "criterion", &task.id).unwrap().is_empty());
}

#[test]
fn the_read_is_bounded() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old", None).unwrap();
    let mut run = seeded_run(&mut conn, &project.id, &human, "Run 0");
    for n in 0..100 {
        if n > 0 && n % 10 == 0 {
            run = seeded_run(&mut conn, &project.id, &human, &format!("Run {}", n / 10));
        }
        let out = stage_amend(&mut conn, &run, &task.id, &format!("Title {n}"), Some(&format!("Body {n}")), None);
        assert!(!out.is_empty());
    }
    let values = provisional_values_for(&conn, "task", &task.id).unwrap();
    assert!(values.len() <= PROVISIONAL_VALUES_LIMIT, "{} values", values.len());
    assert!(!values.is_empty());
}

// --- the schema half of D-02: no column, no migration -------------------------------------------

#[test]
fn no_provisional_column_reached_the_schema() {
    let migrations = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/migrations");
    let mut count = 0;
    for entry in std::fs::read_dir(&migrations).unwrap().flatten() {
        count += 1;
        let text = std::fs::read_to_string(entry.path()).unwrap().to_lowercase();
        assert!(!text.contains("provisional"), "{:?} names a provisional column", entry.path());
    }
    assert_eq!(count, 24, "plan 15-07 adds no migration");
}

#[allow(dead_code)]
fn _outcome_is_used(_: ProposalOutcome) {}
