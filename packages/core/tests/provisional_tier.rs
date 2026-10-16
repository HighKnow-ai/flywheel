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
    acceptance_tier, confirm_provisional_values_for_task, create_proposal, refuse_explicit_tier,
    reject_proposal, AcceptanceTier, ProposalOutcome, ProposalPayload,
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

// =================================================================================================
// Task 3: Start Work confirms every provisional value on that task, through the canonical writers.
// =================================================================================================

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

fn task_row(conn: &Connection, id: &str) -> (String, Option<String>, i64, String) {
    conn.query_row(
        "SELECT title, description, priority, updated_at FROM tasks WHERE id = ?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .unwrap()
}

fn status_of(conn: &Connection, proposal_id: &str) -> String {
    conn.query_row("SELECT status FROM authoring_proposals WHERE id = ?1", params![proposal_id], |r| r.get(0)).unwrap()
}

/// The three provisional values the plan names, as an agent would stage them: each later payload
/// restates the title the earlier ones set, so the sequence is coherent.
fn stage_three(conn: &mut Connection, run: &str, task_id: &str) -> (String, String, String) {
    let t = stage_amend(conn, run, task_id, "A sharper title", None, None);
    let d = stage_amend(conn, run, task_id, "A sharper title", Some("Explains why it exists."), None);
    let p = stage_amend(conn, run, task_id, "A sharper title", None, Some(1));
    (t, d, p)
}

#[test]
fn confirming_lands_title_description_and_priority_through_the_canonical_writers() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old title", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    let (t, d, p) = stage_three(&mut conn, &run, &task.id);

    let confirmed = confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap();
    assert_eq!(confirmed, 3);

    let (title, description, priority, _) = task_row(&conn, &task.id);
    assert_eq!(title, "A sharper title");
    assert_eq!(description.as_deref(), Some("Explains why it exists."));
    assert_eq!(priority, 1);
    for id in [&t, &d, &p] {
        assert_eq!(status_of(&conn, id), "accepted");
    }
    assert!(provisional_values_for(&conn, "task", &task.id).unwrap().is_empty());
}

#[test]
fn the_priority_is_attributed_to_the_human_who_started_the_work() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    stage_amend(&mut conn, &run, &task.id, "Old", None, Some(1));

    confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap();

    let actor: String = conn
        .query_row(
            "SELECT actor_id FROM events WHERE event_type = 'task.priority_changed' AND task_id = ?1",
            params![task.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(actor, human, "the agent proposed the value, the human wrote it");
}

#[test]
fn a_rejected_provisional_title_is_not_applied_and_stays_rejected() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old title", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    let title = stage_amend(&mut conn, &run, &task.id, "Rejected title", None, None);
    let body = stage_amend(&mut conn, &run, &task.id, "Old title", Some("A body"), None);
    reject_proposal(&mut conn, &title, &human, None).unwrap();

    let confirmed = confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap();

    assert_eq!(confirmed, 1);
    let (t, d, _, _) = task_row(&conn, &task.id);
    assert_eq!(t, "Old title");
    assert_eq!(d.as_deref(), Some("A body"));
    assert_eq!(status_of(&conn, &title), "rejected");
    assert_eq!(status_of(&conn, &body), "accepted");
}

#[test]
fn a_task_with_no_provisional_values_writes_nothing_and_appends_no_event() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Untouched", None).unwrap();
    let before = task_row(&conn, &task.id);
    let events = count(&conn, "SELECT COUNT(*) FROM events");

    assert_eq!(confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap(), 0);

    assert_eq!(task_row(&conn, &task.id), before, "updated_at and every field unchanged");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events"), events);
}

#[test]
fn a_pending_criterion_is_never_confirmed_and_the_explicit_tier_is_refused_by_name() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Task", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    let crit = create_proposal(
        &mut conn, &run, ProposalVerb::Create, criterion(1), Some(&task.id), None, ProposalProvenance::NONE,
    )
    .unwrap();
    stage_amend(&mut conn, &run, &task.id, "New", None, None);

    assert_eq!(confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap(), 1);
    assert_eq!(status_of(&conn, &crit.id), "pending", "Start Work never decides a criterion");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM acceptance_criteria"), 0);

    // The guard itself: an explicit-tier proposal reaching the confirm is a loud error naming the tier.
    let err = refuse_explicit_tier("criterion").expect_err("explicit tier must be refused");
    assert!(err.to_string().contains("explicit"), "{err}");
    assert!(refuse_explicit_tier("task").is_ok());
    assert!(refuse_explicit_tier("epic").is_ok());
    // And an unknown / reserved target is treated as explicit, never confirmed.
    assert!(refuse_explicit_tier("file_set").is_err());
}

#[test]
fn confirming_twice_confirms_once() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    stage_amend(&mut conn, &run, &task.id, "New", None, None);

    assert_eq!(confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap(), 1);
    let after_first = task_row(&conn, &task.id);
    let events = count(&conn, "SELECT COUNT(*) FROM events");
    assert_eq!(confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap(), 0);
    assert_eq!(task_row(&conn, &task.id), after_first);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events"), events);
}

#[test]
fn an_agent_actor_cannot_confirm() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Old", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    let id = stage_amend(&mut conn, &run, &task.id, "New", None, None);
    let agent = agent_actor_id(&conn).unwrap();

    assert!(confirm_provisional_values_for_task(&mut conn, &agent, &task.id).is_err());
    assert_eq!(status_of(&conn, &id), "pending");
    assert_eq!(task_row(&conn, &task.id).0, "Old");
}

#[test]
fn a_later_amendment_restating_a_stale_title_is_shown_not_applied_silently() {
    // The ghost walks the same order confirm applies: a second proposal that restates the original
    // title reverts the first, and the read says so, so what is shown is what Start Work leaves.
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Original", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, "Run");
    stage_amend(&mut conn, &run, &task.id, "Renamed", None, None);
    stage_amend(&mut conn, &run, &task.id, "Original", Some("Body"), None);

    let titles: Vec<String> = provisional_values_for(&conn, "task", &task.id)
        .unwrap()
        .into_iter()
        .filter(|v| v.field == "title")
        .map(|v| v.proposed)
        .collect();
    assert_eq!(titles, vec!["Renamed", "Original"]);
    confirm_provisional_values_for_task(&mut conn, &human, &task.id).unwrap();
    assert_eq!(task_row(&conn, &task.id).0, "Original");
}

// --- structural: one task id, no second writer, no timer, reachable from no UI control ----------

fn source(rel: &str) -> String {
    std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(rel)).unwrap()
}

/// The body of `fn <name>` from its signature to the next top-level `\n}\n`.
fn body_of(src: &str, name: &str) -> String {
    let start = src.find(&format!("pub fn {name}")).or_else(|| src.find(&format!("fn {name}"))).unwrap();
    let rest = &src[start..];
    rest[..rest.find("\n}\n").unwrap()].to_string()
}

#[test]
fn the_confirm_takes_one_task_id_and_issues_no_write_of_its_own() {
    let src = source("src/domain/authoring_proposal.rs");
    let sig_at = src.find("pub fn confirm_provisional_values_for_task").unwrap();
    let signature = &src[sig_at..src[sig_at..].find("{").unwrap() + sig_at];
    assert!(signature.contains("task_id: &str"), "{signature}");
    assert!(!signature.contains("&[") && !signature.contains("Vec<"), "no collection: {signature}");

    for name in ["confirm_provisional_values_for_task", "confirm_provisional_values_in_tx"] {
        let body = body_of(&src, name);
        for forbidden in ["INSERT INTO tasks", "UPDATE tasks", "INSERT INTO epics", "UPDATE epics"] {
            assert!(!body.contains(forbidden), "{name} must not write {forbidden}");
        }
    }
    // The only way it decides anything is through the one accept path, and it asserts the tier first.
    let in_tx = body_of(&src, "confirm_provisional_values_in_tx");
    assert!(in_tx.contains("accept_proposal_in_tx"));
    assert!(in_tx.contains("refuse_explicit_tier"));
    for timer in ["expires_at", "undo_until", "setTimeout", "setInterval"] {
        assert!(!in_tx.contains(timer), "{timer}");
    }
}

#[test]
fn start_agent_run_confirms_in_its_own_transaction_for_a_human_only() {
    let src = source("src/domain/agent_run.rs");
    let body = body_of(&src, "start_agent_run");
    assert!(body.contains("confirm_provisional_values_in_tx(&tx, human_actor_id, task_id"), "{body}");
    let at = body.find("confirm_provisional_values_in_tx").unwrap();
    assert!(body[..at].contains("if !automatic"), "the system actor's automatic start must not confirm");
    assert!(
        body.find("INSERT INTO agent_runs").unwrap() > at,
        "the confirm lands before the run row that freezes criteria exists"
    );
}

#[test]
fn no_ui_control_invokes_the_confirm() {
    fn walk(dir: &std::path::Path, hits: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|n| n == "node_modules") {
                    continue;
                }
                walk(&path, hits);
            } else if let Ok(text) = std::fs::read_to_string(&path) {
                if text.contains("confirm_provisional") {
                    hits.push(path.display().to_string());
                }
            }
        }
    }
    let ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../desktop/src");
    let mut hits = Vec::new();
    walk(&ui, &mut hits);
    assert!(hits.is_empty(), "{hits:?}");
}
