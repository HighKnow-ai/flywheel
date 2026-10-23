//! Issue #163 (docs/mvp-spec.md §4.4, §5): a judged-on change is a Proposal that changes what a Story
//! is judged on, an Amend criterion or an Amend Epic spec filed by a Story session. Accepted:
//!
//! - Amend criterion rewrites the statement and clears the criterion's acceptance, since a changed
//!   statement is a new thing to judge. With a new Check command the Check is replaced and reads not
//!   run; without one, the last run is marked stale (`checks.stale_since`, migration 0013). Runs are
//!   never deleted.
//! - Amend Epic spec reaches every Story packet of the Epic from the next session.
//!
//! Decided in #163: a judged-on change accepted while the Story is In review is allowed.

mod common;

use core::context_packet::build_context_packet;
use core::domain::acceptance_criterion::{accept_criterion, create_criterion, get_criterion};
use core::domain::check::{check_for_criterion, current_result, record_check_run, set_check, CheckResult, CheckRunRecord};
use core::domain::epic;
use core::domain::milestone;
use core::domain::proposal::{accept_proposal, accept_proposal_amended, get_proposal, reject_proposal};
use core::domain::proposal_apply::{is_judged_on, Applied};
use core::domain::session::agent_actor_id;
use core::domain::story::{self, StoryState};
use core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall};
use rusqlite::{params, Connection};
use serde_json::{json, Value};

struct Fixture {
    conn: Connection,
    human: String,
    epic_id: String,
    story: story::Story,
    sibling: story::Story,
    criterion_id: String,
    check_id: String,
    session_id: String,
}

/// A Running Story with one criterion, accepted, whose Check passed at `abc123`, and a live Story
/// session on it; a sibling Story in the same Epic.
fn fixture() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Board and review", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Execution").unwrap();
    let s = story::create_story(&mut conn, &human, &e.id, "Parser").unwrap();
    let sibling = story::create_story(&mut conn, &human, &e.id, "Printer").unwrap();
    let c = create_criterion(&mut conn, &human, &s.id, "Parses a line").unwrap();
    let check = set_check(&mut conn, &human, &c.id, "cargo test parser", None).unwrap();
    for state in [StoryState::Ready, StoryState::Running] {
        story::set_story_state(&mut conn, &human, &s.id, state).unwrap();
    }
    let ran = chrono::Utc::now().to_rfc3339();
    let run = CheckRunRecord {
        commit_sha: "abc123",
        result: CheckResult::Passed,
        exit_code: Some(0),
        output_tail: Some("ok"),
        started_at: &ran,
        ended_at: &ran,
    };
    record_check_run(&mut conn, &check.id, &run).unwrap();
    accept_criterion(&mut conn, &human, &c.id).unwrap();

    let agent = agent_actor_id(&conn).unwrap();
    let session_id = core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'acceptEdits', '/tmp/x.jsonl', '2026-10-23T00:00:00Z')",
        params![session_id, s.id, project.id, agent],
    )
    .unwrap();
    Fixture { conn, human, epic_id: e.id, story: s, sibling, criterion_id: c.id, check_id: check.id, session_id }
}

/// File one Proposal from the Story session, as the core runs `propose`.
fn propose(f: &mut Fixture, mut args: Value) -> String {
    args["why"] = json!("the criterion misses the empty line");
    args["evidence"] = json!("src/parser.rs:42 panics on an empty line");
    let call = StoryProposalCall::parse("propose", &args).unwrap();
    let outcome = apply_story_proposal_call(&mut f.conn, &f.session_id, &call).unwrap();
    outcome.result["proposal_id"].as_str().unwrap().to_string()
}

fn amend(f: &mut Fixture, statement: &str, command: Option<&str>) -> String {
    let criterion_id = f.criterion_id.clone();
    let mut args = json!({ "kind": "amend_criterion", "criterion_id": criterion_id, "statement": statement });
    if let Some(command) = command {
        args["check_command"] = json!(command);
    }
    propose(f, args)
}

fn runs(f: &Fixture) -> i64 {
    f.conn.query_row("SELECT COUNT(*) FROM check_runs WHERE check_id = ?1", [&f.check_id], |r| r.get(0)).unwrap()
}

#[test]
fn accepting_amend_criterion_rewrites_it_clears_its_acceptance_and_marks_the_last_run_stale() {
    let mut f = fixture();
    let before = current_result(&f.conn, &f.check_id).unwrap();
    assert_eq!(before.result, CheckResult::Passed);
    assert!(!before.is_stale(Some("abc123")), "it passed at the branch head");

    let id = amend(&mut f, "Parses an empty line as no token", None);
    let applied = accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    assert_eq!(applied, Applied::CriterionAmended { criterion_id: f.criterion_id.clone(), story_id: f.story.id.clone() });

    let criterion = get_criterion(&f.conn, &f.criterion_id).unwrap().unwrap();
    assert_eq!(criterion.statement, "Parses an empty line as no token");
    assert_eq!(criterion.accepted_by, None, "a changed statement is a new thing to judge");

    let after = current_result(&f.conn, &f.check_id).unwrap();
    assert_eq!(after.result, CheckResult::Passed, "the run is kept, as it said");
    assert!(after.is_stale(Some("abc123")), "the last run is stale though the branch has not moved");
    assert!(after.is_stale(None), "stale even where the branch head cannot be read");
    assert_eq!(runs(&f), 1, "runs are never deleted");
    assert_eq!(check_for_criterion(&f.conn, &f.criterion_id).unwrap().unwrap().command, "cargo test parser", "the Check is kept");

    let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
    assert!(packet.contains("1. Parses an empty line as no token"), "the next session reads the new statement");
    assert!(packet.contains("passed at abc123 (stale: the criterion changed since)"), "{packet}");
}

/// The roster's "criteria x/y" reads the same staleness (ADR 0012's SQL, issue #163).
#[test]
fn the_roster_stops_counting_the_amended_criterion() {
    let mut f = fixture();
    let milestone_id: String =
        f.conn.query_row("SELECT milestone_id FROM epics WHERE id = ?1", [&f.epic_id], |r| r.get(0)).unwrap();
    let met = |f: &Fixture| {
        let rows = core::query::roster::roster_rows(&f.conn, &milestone_id).unwrap();
        rows.into_iter().find(|r| r.story_id == f.story.id).unwrap().criteria_met
    };
    let human = f.human.clone();
    core::domain::acceptance_criterion::unaccept_criterion(&mut f.conn, &human, &f.criterion_id).unwrap();
    assert_eq!(met(&f), 1, "its Check passed");
    let id = amend(&mut f, "Parses an empty line", None);
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    assert_eq!(met(&f), 0, "its passed run is stale and its acceptance is cleared");
}

#[test]
fn a_run_after_the_change_is_current_again() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", None);
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    let later = (chrono::Utc::now() + chrono::Duration::seconds(1)).to_rfc3339();
    let run = CheckRunRecord {
        commit_sha: "abc123",
        result: CheckResult::Failed,
        exit_code: Some(1),
        output_tail: None,
        started_at: &later,
        ended_at: &later,
    };
    record_check_run(&mut f.conn, &f.check_id, &run).unwrap();
    let current = current_result(&f.conn, &f.check_id).unwrap();
    assert_eq!(current.result, CheckResult::Failed);
    assert!(!current.is_stale(Some("abc123")), "a run that started after the change is not stale");
    assert_eq!(runs(&f), 2);
}

#[test]
fn with_a_new_command_the_check_is_replaced_and_reads_not_run() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", Some("cargo test parser::empty_line"));
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    let check = check_for_criterion(&f.conn, &f.criterion_id).unwrap().unwrap();
    assert_eq!(check.id, f.check_id, "the Check is edited, not recreated");
    assert_eq!(check.command, "cargo test parser::empty_line");
    let current = current_result(&f.conn, &f.check_id).unwrap();
    assert_eq!(current.result, CheckResult::NotRun);
    assert!(!current.is_stale(Some("abc123")), "not run is never stale");
    assert_eq!(runs(&f), 1, "runs are never deleted");
    assert_eq!(get_criterion(&f.conn, &f.criterion_id).unwrap().unwrap().accepted_by, None);
}

#[test]
fn the_same_command_again_is_no_new_command_and_marks_the_run_stale() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", Some("cargo test parser"));
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    let current = current_result(&f.conn, &f.check_id).unwrap();
    assert_eq!(current.result, CheckResult::Passed);
    assert!(current.is_stale(Some("abc123")));
}

#[test]
fn a_criterion_with_no_check_gets_the_new_command_as_its_check() {
    let mut f = fixture();
    let human = f.human.clone();
    let bare = create_criterion(&mut f.conn, &human, &f.story.id, "Prints a line").unwrap();
    let bare_id = bare.id.clone();
    let id = propose(
        &mut f,
        json!({ "kind": "amend_criterion", "criterion_id": bare_id, "statement": "Prints an empty line", "check_command": "cargo test printer" }),
    );
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    let check = check_for_criterion(&f.conn, &bare.id).unwrap().expect("the command became its Check");
    assert_eq!(check.command, "cargo test printer");
    assert_eq!(current_result(&f.conn, &check.id).unwrap().result, CheckResult::NotRun);
}

#[test]
fn edit_applies_the_developers_statement_and_command() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", None);
    let criterion_id = f.criterion_id.clone();
    let edited = json!({ "criterion_id": criterion_id, "statement": "Parses an empty line as no token", "check_command": "cargo test empty" });
    accept_proposal_amended(&mut f.conn, &f.human, &id, &edited).unwrap();
    assert_eq!(get_criterion(&f.conn, &f.criterion_id).unwrap().unwrap().statement, "Parses an empty line as no token");
    assert_eq!(check_for_criterion(&f.conn, &f.criterion_id).unwrap().unwrap().command, "cargo test empty");
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().payload, edited, "the row keeps what was applied");

    let other = amend(&mut f, "Something else", None);
    let sibling_criterion = create_criterion(&mut f.conn, &f.human.clone(), &f.sibling.id, "Prints").unwrap();
    let moved = json!({ "criterion_id": sibling_criterion.id, "statement": "Something else" });
    let err = accept_proposal_amended(&mut f.conn, &f.human, &other, &moved).unwrap_err();
    assert!(format!("{err:#}").contains("keeps the criterion"), "{err:#}");
}

#[test]
fn reject_leaves_the_criterion_and_its_run_alone() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", Some("cargo test other"));
    reject_proposal(&mut f.conn, &f.human, &id, Some("the empty line is out of scope")).unwrap();
    let criterion = get_criterion(&f.conn, &f.criterion_id).unwrap().unwrap();
    assert_eq!(criterion.statement, "Parses a line");
    assert!(criterion.accepted_by.is_some(), "its acceptance stands");
    let current = current_result(&f.conn, &f.check_id).unwrap();
    assert_eq!(current.result, CheckResult::Passed);
    assert!(!current.is_stale(Some("abc123")));
}

/// Decided in #163: allowed while the Story is In review. It clears that criterion's acceptance and
/// marks its run stale, so Merge holds until it is judged again.
#[test]
fn accepted_while_the_story_is_in_review_it_holds_merge_until_judged_again() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", None);
    f.conn.execute("UPDATE stories SET state = 'in_review' WHERE id = ?1", [&f.story.id]).unwrap();
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();
    assert_eq!(get_criterion(&f.conn, &f.criterion_id).unwrap().unwrap().accepted_by, None);
    assert!(current_result(&f.conn, &f.check_id).unwrap().is_stale(Some("abc123")));
}

/// A Story that closed after the Proposal was filed keeps its criteria: accepting is refused and
/// nothing changes, the decision included.
#[test]
fn a_closed_storys_criterion_is_not_amended() {
    let mut f = fixture();
    let id = amend(&mut f, "Parses an empty line", None);
    f.conn.execute("UPDATE stories SET state = 'merged' WHERE id = ?1", [&f.story.id]).unwrap();
    let err = accept_proposal(&mut f.conn, &f.human, &id).unwrap_err();
    assert!(format!("{err:#}").contains("merged"), "{err:#}");
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().state, "pending", "the decision rolled back");
    assert_eq!(get_criterion(&f.conn, &f.criterion_id).unwrap().unwrap().statement, "Parses a line");
}

#[test]
fn an_accepted_epic_spec_change_reaches_every_story_packet_from_the_next_session() {
    let mut f = fixture();
    let id = propose(&mut f, json!({ "kind": "amend_epic_spec", "field": "scope", "text": "Parse and print, empty lines included" }));
    for story_id in [&f.story.id, &f.sibling.id] {
        assert!(!build_context_packet(&f.conn, story_id, "").unwrap().contains("empty lines included"), "nothing changes before");
    }
    assert_eq!(
        accept_proposal(&mut f.conn, &f.human, &id).unwrap(),
        Applied::SpecChange { epic_id: f.epic_id.clone(), field: core::domain::proposal_apply::SpecField::Scope }
    );
    for story_id in [&f.story.id, &f.sibling.id] {
        let packet = build_context_packet(&f.conn, story_id, "").unwrap();
        assert!(packet.contains("Parse and print, empty lines included"), "the packet of {story_id} carries it");
    }
}

/// What counts as judged-on: an amend to a criterion, or an amend to an Epic from a Story session.
#[test]
fn judged_on_is_an_amend_criterion_or_a_story_sessions_amend_epic_spec() {
    let mut f = fixture();
    let criterion = amend(&mut f, "Parses an empty line", None);
    let spec = propose(&mut f, json!({ "kind": "amend_epic_spec", "field": "scope", "text": "More" }));
    let story = propose(&mut f, json!({ "kind": "new_story", "title": "Recovery" }));
    let judged = |f: &Fixture, id: &str| is_judged_on(&f.conn, &get_proposal(&f.conn, id).unwrap().unwrap()).unwrap();
    assert!(judged(&f, &criterion));
    assert!(judged(&f, &spec));
    assert!(!judged(&f, &story));

    // An amend to an Epic filed in shaping (no Story session) is the Round's to decide.
    let human = f.human.clone();
    let shaping = core::domain::proposal::file_proposal(
        &mut f.conn,
        &human,
        &core::domain::proposal::NewProposal {
            project_id: &f.story.project_id,
            session_id: None,
            epic_id: Some(&f.epic_id),
            verb: core::domain::proposal::ProposalVerb::Amend,
            target: core::domain::proposal::ProposalTarget::Epic,
            target_id: Some(&f.epic_id),
            payload: json!({ "field": "scope", "text": "By hand" }),
            rationale: None,
        },
    )
    .unwrap();
    assert!(!judged(&f, &shaping.id));
}

/// Migration 0013 adds `checks.stale_since`, NULL until a judged-on change marks the run stale.
#[test]
fn a_fresh_database_migrates_through_0013() {
    let sources = core::db::migration_sources();
    assert!(sources.len() >= 13, "0001 through 0013, none missing");
    assert!(sources[12].contains("stale_since"), "0013 is the thirteenth migration");
    let f = fixture();
    let version: i64 = f.conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert_eq!(version, sources.len() as i64, "every migration ran");
    let stale: Option<String> = f.conn.query_row("SELECT stale_since FROM checks WHERE id = ?1", [&f.check_id], |r| r.get(0)).unwrap();
    assert_eq!(stale, None);
}
