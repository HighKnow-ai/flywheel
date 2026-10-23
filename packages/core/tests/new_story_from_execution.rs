//! Issue #166 (docs/mvp-spec.md §2, §5): a New Story a running Story proposes carries its criteria, and
//! the developer's Make Ready (`story::make_ready`) moves it from Shaping to Ready. Its Epic's shaping is
//! already closed, so no Stage closing makes it Ready, and the Epic's shaping is never reopened for it.
//!
//! Make Ready is human-only, needs the Story in Shaping, its Epic's shaping closed (Ready or In
//! progress) and at least one criterion. The roster's offer (`roster_rows`' `can_make_ready`) and the
//! Story view's (`make_ready_offer`) read the same rule `make_ready` refuses by.

mod common;

use core::domain::acceptance_criterion::{create_criterion, criteria_for_story};
use core::domain::epic::{self, get_epic, set_epic_state, EpicState};
use core::domain::milestone;
use core::domain::proposal::accept_proposal;
use core::domain::proposal_apply::Applied;
use core::domain::session::agent_actor_id;
use core::domain::story::{self, get_story, make_ready, make_ready_offer, MakeReadyOffer, StoryState};
use core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall};
use core::query::roster::roster_rows;
use rusqlite::Connection;
use serde_json::json;

struct Fixture {
    conn: Connection,
    human: String,
    milestone_id: String,
    epic_id: String,
    running: story::Story,
    session_id: String,
}

/// A Milestone holding Epic "Execution", its shaping closed (Ready), with a Running Story and a live
/// Story session on it.
fn fixture() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Board and review", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Execution").unwrap();
    let running = story::create_story(&mut conn, &human, &e.id, "Parser").unwrap();
    create_criterion(&mut conn, &human, &running.id, "Parses a line").unwrap();
    set_epic_state(&mut conn, &human, &e.id, EpicState::Ready).unwrap();
    story::set_story_state(&mut conn, &human, &running.id, StoryState::Ready).unwrap();
    story::set_story_state(&mut conn, &human, &running.id, StoryState::Running).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let session_id = core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'acceptEdits', '/tmp/x.jsonl', '2026-10-23T00:00:00Z')",
        rusqlite::params![session_id, running.id, project.id, agent],
    )
    .unwrap();
    Fixture { conn, human, milestone_id: m.id, epic_id: e.id, running, session_id }
}

/// The running Story files a New Story with `criteria`, and the developer accepts it: the new Story's id.
fn accepted_new_story(f: &mut Fixture, criteria: serde_json::Value) -> String {
    let args = json!({
        "kind": "new_story", "title": "Empty-line recovery", "why": "the parser stops on an empty line",
        "evidence": "src/parser.rs:42", "criteria": criteria,
    });
    let call = StoryProposalCall::parse("propose", &args).unwrap();
    let outcome = apply_story_proposal_call(&mut f.conn, &f.session_id, &call).unwrap();
    let id = outcome.result["proposal_id"].as_str().unwrap().to_string();
    let Applied::StoryCreated { story_id } = accept_proposal(&mut f.conn, &f.human, &id).unwrap() else { panic!("a New Story") };
    story_id
}

fn state(f: &Fixture, story_id: &str) -> String {
    get_story(&f.conn, story_id).unwrap().unwrap().state
}

fn roster_offers(f: &Fixture, story_id: &str) -> bool {
    roster_rows(&f.conn, &f.milestone_id).unwrap().into_iter().find(|r| r.story_id == story_id).unwrap().can_make_ready
}

#[test]
fn a_running_story_files_a_new_story_with_criteria_and_the_developer_makes_it_ready() {
    let mut f = fixture();
    let story_id = accepted_new_story(
        &mut f,
        json!([{ "statement": "An empty line yields no token", "check": "cargo test lexer" }, { "statement": "It reads well" }]),
    );
    assert_eq!(state(&f, &story_id), "shaping", "accepting creates it in Shaping");
    assert_eq!(criteria_for_story(&f.conn, &story_id).unwrap().len(), 2);
    assert_eq!(make_ready_offer(&f.conn, &story_id).unwrap(), MakeReadyOffer { offered: true, refusal: None });
    assert!(roster_offers(&f, &story_id), "its row offers Make Ready");

    make_ready(&mut f.conn, &f.human, &story_id).unwrap();
    assert_eq!(state(&f, &story_id), "ready");
    assert_eq!(get_epic(&f.conn, &f.epic_id).unwrap().unwrap().state, "ready", "the Epic's shaping is never reopened");
    let label: String = f
        .conn
        .query_row(
            "SELECT json_extract(payload, '$.label') FROM events WHERE event_type = 'story.state_changed' AND stream_id = ?1",
            [&story_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(label, "Moved Story from shaping to ready");
    assert!(!roster_offers(&f, &story_id), "a Ready Story offers Start, not Make Ready");
    assert_eq!(make_ready_offer(&f.conn, &story_id).unwrap().offered, false);

    // It is now an ordinary Ready Story: the developer starts it.
    story::set_story_state(&mut f.conn, &f.human, &story_id, StoryState::Running).unwrap();
    assert_eq!(state(&f, &story_id), "running");
}

#[test]
fn make_ready_is_refused_for_an_agent_and_writes_nothing() {
    let mut f = fixture();
    let story_id = accepted_new_story(&mut f, json!([{ "statement": "It holds" }]));
    let agent = agent_actor_id(&f.conn).unwrap();
    let err = make_ready(&mut f.conn, &agent, &story_id).unwrap_err();
    assert!(format!("{err:#}").contains("human"), "{err:#}");
    assert_eq!(state(&f, &story_id), "shaping");
}

#[test]
fn make_ready_needs_a_criterion() {
    let mut f = fixture();
    let bare = story::create_story(&mut f.conn, &f.human, &f.epic_id, "No criterion yet").unwrap();
    let offer = make_ready_offer(&f.conn, &bare.id).unwrap();
    assert!(offer.offered, "a Shaping Story of a shaped Epic is offered Make Ready");
    let refusal = offer.refusal.expect("held back by its missing criterion");
    assert!(refusal.contains("no Acceptance criterion"), "{refusal}");
    assert!(!roster_offers(&f, &bare.id));
    let err = make_ready(&mut f.conn, &f.human, &bare.id).unwrap_err();
    assert_eq!(format!("{err:#}"), refusal, "the refusal is the offer's words");
    assert_eq!(state(&f, &bare.id), "shaping");

    create_criterion(&mut f.conn, &f.human, &bare.id, "It holds").unwrap();
    assert!(roster_offers(&f, &bare.id));
    make_ready(&mut f.conn, &f.human, &bare.id).unwrap();
    assert_eq!(state(&f, &bare.id), "ready");
}

#[test]
fn make_ready_needs_the_epics_shaping_closed() {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Still shaped").unwrap();
    let s = story::create_story(&mut conn, &human, &e.id, "Lexer").unwrap();
    create_criterion(&mut conn, &human, &s.id, "Lexes").unwrap();
    let offer = make_ready_offer(&conn, &s.id).unwrap();
    assert!(!offer.offered, "closing the criteria Stage makes it Ready: Make Ready is not offered");
    let err = make_ready(&mut conn, &human, &s.id).unwrap_err();
    assert!(format!("{err:#}").contains("still being shaped"), "{err:#}");
    assert_eq!(get_story(&conn, &s.id).unwrap().unwrap().state, "shaping");
}

#[test]
fn make_ready_moves_only_a_story_in_shaping() {
    let mut f = fixture();
    let running = f.running.id.clone();
    let err = make_ready(&mut f.conn, &f.human, &running).unwrap_err();
    assert!(format!("{err:#}").contains("only a Story in Shaping"), "{err:#}");
    assert_eq!(state(&f, &running), "running");
    assert!(!make_ready_offer(&f.conn, &running).unwrap().offered);
}
