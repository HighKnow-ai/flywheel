//! Phase 15 plan 01, task 2 (DRFT-08, D-14..D-16): the open-drafts cap. At most
//! `OPEN_DRAFTS_PER_PROJECT` explicit-tier drafts (criteria, and later file-sets) may be pending in
//! a project at once. The count lives in `create_proposal_in_tx`, inside the transaction of the
//! INSERT it guards, so the cap is real rather than advisory — and every assertion below reads the
//! database.
//!
//! The per-run cap (10 for an execution run) is in force here too, so a project is filled across
//! several runs. Self-contained fixtures, copied rather than shared (this repo's precedent).

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    apply_proposal_created, create_proposal, reject_proposal, ProposalOutcome, ProposalPayload,
    ProposalProvenance, ProposalVerb, OPEN_DRAFTS_PER_PROJECT,
};
use core::domain::task::create_task;
use core::ids::new_id;
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

fn criterion(n: usize) -> ProposalPayload {
    ProposalPayload::Criterion {
        statement: format!("Returns {n} rows for page {n}"),
        verification_hint: None,
        pinned_revision: None,
    }
}

fn stage(conn: &mut Connection, run_id: &str, n: usize) -> String {
    create_proposal(conn, run_id, ProposalVerb::Create, criterion(n), None, None, ProposalProvenance::NONE)
        .unwrap_or_else(|e| panic!("draft {n} should stage: {e:#}"))
        .id
}

fn criterion_event(run_id: &str, n: usize) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "create",
        "targetType": "criterion",
        "payload": { "kind": "criterion", "statement": format!("Returns {n} rows for page {n}"), "verification_hint": null },
    })
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

fn pending_explicit(conn: &Connection) -> i64 {
    count(
        conn,
        "SELECT COUNT(*) FROM authoring_proposals WHERE status = 'pending' AND target_type IN ('criterion', 'file_set')",
    )
}

/// A project holding `OPEN_DRAFTS_PER_PROJECT - 1` pending criterion drafts, staged across runs
/// (10 per execution run), plus one fresh run to draft against. Returns `(conn, human, project, fresh_run, staged_ids)`.
fn project_one_below_the_cap() -> (Connection, String, String, String, Vec<String>) {
    let (mut conn, human, project) = common::seeded_project();
    let mut ids = Vec::new();
    let mut run = seeded_run(&mut conn, &project.id, &human, "Run 0");
    for n in 0..OPEN_DRAFTS_PER_PROJECT - 1 {
        if n > 0 && n % 10 == 0 {
            run = seeded_run(&mut conn, &project.id, &human, &format!("Run {}", n / 10));
        }
        ids.push(stage(&mut conn, &run, n));
    }
    let fresh = seeded_run(&mut conn, &project.id, &human, "The run that hits the cap");
    (conn, human, project.id, fresh, ids)
}

#[test]
fn the_thirtieth_pending_draft_stages_and_the_thirty_first_is_refused() {
    let (mut conn, _human, _project, fresh, _ids) = project_one_below_the_cap();
    assert_eq!(pending_explicit(&conn), 29);

    let thirtieth = apply_proposal_created(&mut conn, &criterion_event(&fresh, 29)).unwrap();
    assert!(matches!(thirtieth, ProposalOutcome::Created(_)), "the 30th stages, got {thirtieth:?}");

    let thirty_first = apply_proposal_created(&mut conn, &criterion_event(&fresh, 30)).unwrap();
    assert_eq!(thirty_first, ProposalOutcome::LimitExhausted { limit: 30, count: 30 });
    assert_eq!(pending_explicit(&conn), 30, "the refused draft inserted nothing");
}

#[test]
fn the_direct_staging_door_refuses_loudly_and_names_the_project_not_the_run() {
    let (mut conn, _human, _project, fresh, _ids) = project_one_below_the_cap();
    stage(&mut conn, &fresh, 29);

    let err = create_proposal(&mut conn, &fresh, ProposalVerb::Create, criterion(30), None, None, ProposalProvenance::NONE)
        .expect_err("the 31st draft must be refused");

    let text = err.to_string();
    assert!(text.contains("30"), "{text}");
    assert!(text.contains("project"), "the refusal names the project cap, not a run cap: {text}");
}

#[test]
fn the_refusal_commits_exactly_one_event_and_pauses_nothing() {
    let (mut conn, _human, _project, fresh, _ids) = project_one_below_the_cap();
    stage(&mut conn, &fresh, 29);
    let events_before = count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'proposal.limit_exhausted'");
    let rows_before = count(&conn, "SELECT COUNT(*) FROM authoring_proposals");
    let status_before: String =
        conn.query_row("SELECT status FROM agent_runs WHERE id = ?1", params![fresh], |r| r.get(0)).unwrap();

    let outcome = apply_proposal_created(&mut conn, &criterion_event(&fresh, 30)).unwrap();
    assert!(matches!(outcome, ProposalOutcome::LimitExhausted { .. }));

    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'proposal.limit_exhausted'"),
        events_before + 1,
        "one refusal event, and it survived the commit"
    );
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM authoring_proposals"), rows_before);
    let status_after: String =
        conn.query_row("SELECT status FROM agent_runs WHERE id = ?1", params![fresh], |r| r.get(0)).unwrap();
    assert_eq!(status_after, status_before, "the run is not paused and no run status is written");
}

#[test]
fn rejecting_one_pending_draft_frees_exactly_one_slot() {
    let (mut conn, human, _project, fresh, ids) = project_one_below_the_cap();
    stage(&mut conn, &fresh, 29);
    assert!(matches!(
        apply_proposal_created(&mut conn, &criterion_event(&fresh, 30)).unwrap(),
        ProposalOutcome::LimitExhausted { .. }
    ));

    reject_proposal(&mut conn, &ids[0], &human, Some("not this one")).unwrap();

    let freed = apply_proposal_created(&mut conn, &criterion_event(&fresh, 31)).unwrap();
    assert!(matches!(freed, ProposalOutcome::Created(_)), "a rejected row is not pending, got {freed:?}");
    assert!(matches!(
        apply_proposal_created(&mut conn, &criterion_event(&fresh, 32)).unwrap(),
        ProposalOutcome::LimitExhausted { .. }
    ), "exactly one slot was freed");
}

#[test]
fn a_lint_refusal_consumes_neither_cap() {
    let (mut conn, _human, _project, fresh, _ids) = project_one_below_the_cap();
    let run_rows = |c: &Connection| {
        c.query_row("SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1", params![fresh], |r| r.get::<_, i64>(0))
            .unwrap()
    };
    let (run_before, project_before) = (run_rows(&conn), pending_explicit(&conn));

    let refused = apply_proposal_created(
        &mut conn,
        &serde_json::json!({
            "type": "proposal_created", "runId": fresh, "verb": "create", "targetType": "criterion",
            "payload": { "kind": "criterion", "statement": "The importer handles malformed rows", "verification_hint": null },
        }),
    )
    .unwrap();

    assert!(matches!(refused, ProposalOutcome::LintRefused { .. }), "got {refused:?}");
    assert_eq!((run_rows(&conn), pending_explicit(&conn)), (run_before, project_before));
    // The slot a lint refusal did not take is still there.
    let thirtieth = apply_proposal_created(&mut conn, &criterion_event(&fresh, 29)).unwrap();
    assert!(matches!(thirtieth, ProposalOutcome::Created(_)), "got {thirtieth:?}");
}

#[test]
fn a_provisional_tier_draft_is_neither_counted_nor_refused_at_the_cap() {
    let (mut conn, _human, _project, fresh, _ids) = project_one_below_the_cap();
    stage(&mut conn, &fresh, 29);
    assert_eq!(pending_explicit(&conn), 30);

    let task = create_proposal(
        &mut conn,
        &fresh,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "A provisional-tier draft".to_string(), description: None, priority: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("a Task draft is provisional-tier and costs no attention");

    assert_eq!(task.status, "pending");
    assert_eq!(pending_explicit(&conn), 30, "the provisional draft was not counted");
}

fn rust_sources(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_sources(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn the_cap_is_a_compile_time_30_declared_once_and_read_from_one_list() {
    const _: () = assert!(OPEN_DRAFTS_PER_PROJECT == 30);

    let mut files = Vec::new();
    rust_sources(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
    let (mut declarations, mut tier_lists) = (0, 0);
    for file in &files {
        for line in std::fs::read_to_string(file).unwrap().lines() {
            if line.trim_start().starts_with("//") {
                continue;
            }
            declarations += line.matches("OPEN_DRAFTS_PER_PROJECT: usize").count();
            tier_lists += line.matches("IN ('criterion', 'file_set')").count();
        }
    }
    assert_eq!(declarations, 1, "the cap is declared exactly once");
    assert_eq!(tier_lists, 1, "the explicit-tier corpus is one declared list, so file-sets join it without a second comparison");
}
