//! Issue #133: the roadmap Round (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap").
//!
//! Revisit roadmap starts a project-level shaping session on a roadmap Round, a Round with no Stage.
//! Its packet holds exactly the §3 parts, stable first, deterministic and free of Story detail. The
//! session files Roadmap Proposals, each applied on acceptance (a new Milestone in Shaping, a new Epic
//! after the Current Milestone, drops refused while something open is held), or says the Roadmap
//! holds; the developer can dismiss the Round with no change. A held roadmap Round is Waiting on you.

mod common;

use core::domain::actor::local_human_actor_id;
use core::domain::milestone::{self, roadmap, set_milestone_state, MilestoneState};
use core::domain::proposal::{
    accept_proposal_amended, accept_proposal_released, get_proposal, proposals_in_round, reject_proposal_released,
};
use core::domain::roadmap_round::{
    dismiss_roadmap_round, get_roadmap_round, latest_roadmap_round, open_roadmap_round, open_roadmap_round_for,
    RoadmapTrigger, DISMISSED_REASON,
};
use core::domain::session::{
    interrupt_session, live_shaping_session, mark_abandoned, start_shaping_session, ShapingSubject,
};
use core::domain::session_kind::SessionKind;
use core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome};
use core::domain::{epic, story};
use core::roadmap_packet::build_roadmap_packet;
use rusqlite::Connection;
use serde_json::{json, Value};

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    /// Done, then the Current one with an Epic and a Story, then a later one.
    m_done: String,
    m_current: String,
    m_next: String,
    epic_id: String,
    _checkout: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let checkout = tempfile::tempdir().unwrap();
    let adr_dir = checkout.path().join("docs").join("adr");
    std::fs::create_dir_all(&adr_dir).unwrap();
    std::fs::write(adr_dir.join("0001-board-holds-work.md"), "# The board holds the work\n\nStatus: accepted\n").unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut conn = core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups")).unwrap();
    std::mem::forget(dir);
    let human = local_human_actor_id(&conn).unwrap();
    let project =
        core::domain::project::create_project(&mut conn, &human, "Threadfin", &checkout.path().to_string_lossy(), "FLY", "main")
            .unwrap();
    let m_done = milestone::create_milestone(&mut conn, &project.id, &human, "Clean cut", Some("v0.1 is gone")).unwrap();
    let m_current =
        milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", Some("An Epic is shaped end to end")).unwrap();
    let m_next = milestone::create_milestone(&mut conn, &project.id, &human, "Board", None).unwrap();
    set_milestone_state(&mut conn, &human, &m_done.id, MilestoneState::Done).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m_current.id, "Rounds").unwrap();
    let mut spec = e.spec.clone();
    spec.exit_test = Some("A Round is answered on the board".into());
    epic::update_epic(&mut conn, &human, &e.id, "Rounds", &spec).unwrap();
    let s = story::create_story(&mut conn, &human, &e.id, "SECRET-STORY-TITLE").unwrap();
    let _ = s;
    Fixture {
        conn,
        human,
        project_id: project.id,
        m_done: m_done.id,
        m_current: m_current.id,
        m_next: m_next.id,
        epic_id: e.id,
        _checkout: checkout,
    }
}

fn revisit(f: &mut Fixture) -> String {
    start_shaping_session(
        &mut f.conn,
        &ShapingSubject::Roadmap(f.project_id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &f.human,
    )
    .unwrap()
    .id
}

fn call(f: &mut Fixture, session: &str, request: &str, tool: &str, args: Value) -> anyhow::Result<ShapingToolOutcome> {
    let call = ShapingToolCall::parse(tool, &args)?;
    apply_shaping_tool_call(&mut f.conn, session, request, &call)
}

fn propose(f: &mut Fixture, session: &str, args: Value) -> String {
    match call(f, session, "req-p", "propose_roadmap_change", args).unwrap() {
        ShapingToolOutcome::Answered { result, .. } => result["proposal_id"].as_str().unwrap().to_string(),
        other => panic!("a Proposal is answered at once: {other:?}"),
    }
}

fn round_id(f: &Fixture) -> String {
    open_roadmap_round(&f.conn, &f.project_id).unwrap().expect("an open roadmap Round").id
}

fn event_labels(conn: &Connection, event_type: &str) -> Vec<String> {
    let mut stmt = conn.prepare("SELECT payload FROM events WHERE event_type = ?1 ORDER BY sequence").unwrap();
    stmt.query_map([event_type], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|p| serde_json::from_str::<Value>(&p.unwrap()).unwrap()["label"].as_str().unwrap_or_default().to_string())
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Starting the Round: a project-level shaping session on a Round with no Stage
// ---------------------------------------------------------------------------------------------

#[test]
fn revisit_roadmap_starts_a_project_level_session_on_a_new_round_with_no_stage() {
    let mut f = fixture();
    let session = revisit(&mut f);
    let (epic, milestone, kind): (Option<String>, Option<String>, String) = f
        .conn
        .query_row("SELECT epic_id, milestone_id, kind FROM sessions WHERE id = ?1", [&session], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .unwrap();
    assert_eq!((epic, milestone, kind.as_str()), (None, None, "shaping"));

    let round = open_roadmap_round(&f.conn, &f.project_id).unwrap().unwrap();
    assert_eq!((round.number, round.state.as_str()), (1, "open"));
    assert_eq!(round.trigger, RoadmapTrigger::Revisit);
    assert_eq!(round.session_id.as_deref(), Some(session.as_str()));
    let (stage, trigger): (Option<String>, String) = f
        .conn
        .query_row("SELECT stage_id, trigger_type FROM rounds WHERE id = ?1", [&round.id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    assert_eq!((stage, trigger.as_str()), (None, "revisit"));
    let stages: i64 = f.conn.query_row("SELECT COUNT(*) FROM stages", [], |r| r.get(0)).unwrap();
    assert_eq!(stages, 0, "the Roadmap has no Stage");
    assert_eq!(live_shaping_session(&f.conn, &ShapingSubject::Roadmap(f.project_id.clone())).unwrap(), Some(session));
}

#[test]
fn a_second_live_roadmap_session_is_refused_and_a_dead_ones_round_is_taken_over() {
    let mut f = fixture();
    let first = revisit(&mut f);
    let err = start_shaping_session(&mut f.conn, &ShapingSubject::Roadmap(f.project_id.clone()), "dontAsk", &f.human)
        .unwrap_err();
    assert!(err.to_string().contains("already has a live shaping session"), "{err}");

    propose(&mut f, &first, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked for twice" }));
    interrupt_session(&mut f.conn, &first, &f.human).unwrap();
    let round = round_id(&f);
    let second = revisit(&mut f);
    let taken = get_roadmap_round(&f.conn, &round).unwrap().unwrap();
    assert_eq!(taken.session_id.as_deref(), Some(second.as_str()), "the open Round is taken over, not a new one");
    assert_eq!(latest_roadmap_round(&f.conn, &f.project_id).unwrap().unwrap().number, 1);
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    assert!(packet.contains("New Milestone \"Mobile\" (undecided)"), "{packet}");
    assert!(packet.contains("`round_wait`"), "{packet}");
}

#[test]
fn every_session_lifecycle_path_ends_a_roadmap_session_and_keeps_its_round() {
    let mut f = fixture();
    // Stop
    let s = revisit(&mut f);
    interrupt_session(&mut f.conn, &s, &f.human).unwrap();
    assert_eq!(live_shaping_session(&f.conn, &ShapingSubject::Roadmap(f.project_id.clone())).unwrap(), None);
    let label = event_labels(&f.conn, "session.interrupted").pop().unwrap();
    assert_eq!(label, "Stopped shaping session");
    // Abandon (the launch reconciler's verb)
    let s = revisit(&mut f);
    assert!(mark_abandoned(&mut f.conn, &s, &f.human, None).unwrap());
    // Close, as the sidecar reports a clean exit
    let s = revisit(&mut f);
    core::domain::session::apply_session_closed(
        &mut f.conn,
        &json!({ "type": "session_closed", "runId": s, "reason": "completed" }),
    )
    .unwrap();
    let status: String = f.conn.query_row("SELECT status FROM sessions WHERE id = ?1", [&s], |r| r.get(0)).unwrap();
    assert_eq!(status, "completed");
    let summaries: i64 = f.conn.query_row("SELECT COUNT(*) FROM session_summaries", [], |r| r.get(0)).unwrap();
    assert_eq!(summaries, 0, "a roadmap session leaves no Session summary");
    assert_eq!(open_roadmap_round(&f.conn, &f.project_id).unwrap().unwrap().number, 1, "one Round all along");
}

#[test]
fn the_launch_reconciler_names_a_live_roadmap_session_as_the_roadmap() {
    let mut f = fixture();
    let s = revisit(&mut f);
    // No run descriptor: a dead process, so the reconciler abandons it.
    let orphans = core::domain::session::reconcile_sessions(&mut f.conn, &f.human).unwrap();
    assert!(orphans.is_empty());
    let status: String = f.conn.query_row("SELECT status FROM sessions WHERE id = ?1", [&s], |r| r.get(0)).unwrap();
    assert_eq!(status, "abandoned");
}

// ---------------------------------------------------------------------------------------------
// The packet
// ---------------------------------------------------------------------------------------------

#[test]
fn the_roadmap_packet_holds_exactly_the_section_3_parts_in_order() {
    let mut f = fixture();
    revisit(&mut f);
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    let headings: Vec<&str> = packet.lines().filter(|l| l.starts_with("## ")).collect();
    assert_eq!(
        headings,
        [
            "## Standing instructions",
            "## Roadmap",
            "## ADRs",
            "## Trigger",
            "## Rejected Roadmap Proposals",
            "## Closing instruction"
        ]
    );
    let at = |needle: &str| packet.find(needle).unwrap_or_else(|| panic!("{needle:?} missing:\n{packet}"));
    // Every Milestone in order, with its state and exit test; the Epics under each.
    assert!(at("1. Milestone \"Clean cut\" (Done)") < at("2. Milestone \"Shaping\" (Shaping, Current Milestone)"));
    assert!(at("2. Milestone \"Shaping\"") < at("3. Milestone \"Board\" (Shaping)"));
    at("Exit test: v0.1 is gone");
    at(&format!("- FLY-1 Rounds (Shaping) [epic_id: {}]. Exit test: A Round is answered on the board", f.epic_id));
    at(&format!("[milestone_id: {}]", f.m_next));
    // The ADR index and the trigger.
    at("- docs/adr/0001-board-holds-work.md: The board holds the work");
    at("Roadmap Round 1. The developer pressed Revisit roadmap.");
    // No Story detail, no diff.
    assert!(!packet.contains("SECRET-STORY-TITLE"), "{packet}");
    assert!(!packet.contains("diff --git"), "{packet}");
}

#[test]
fn the_roadmap_packet_is_deterministic() {
    let mut f = fixture();
    revisit(&mut f);
    let a = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    let b = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    assert_eq!(a, b);
}

#[test]
fn a_project_with_no_open_roadmap_round_has_no_roadmap_packet() {
    let f = fixture();
    assert!(build_roadmap_packet(&f.conn, &f.project_id).is_err());
}

// ---------------------------------------------------------------------------------------------
// Proposals: each kind applies its effect; a rejection reaches the next packet
// ---------------------------------------------------------------------------------------------

fn accept(f: &mut Fixture, id: &str) {
    accept_proposal_released(&mut f.conn, &f.human, id, None).unwrap();
}

#[test]
fn an_accepted_new_milestone_enters_shaping_at_the_end_of_the_roadmap() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let p = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "exit_test": "A phone answers a Round", "why": "Asked twice" }));
    assert_eq!(get_proposal(&f.conn, &p).unwrap().unwrap().round_id, Some(round_id(&f)));
    accept(&mut f, &p);
    let last = roadmap(&f.conn, &f.project_id).unwrap().pop().unwrap();
    assert_eq!((last.title.as_str(), last.state.as_str(), last.exit_test.as_deref()), ("Mobile", "shaping", Some("A phone answers a Round")));
}

#[test]
fn an_accepted_amendment_rewrites_the_milestone_and_amend_edits_it_first() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let next = f.m_next.clone();
    let p = propose(&mut f, &s, json!({ "change": "amend_milestone", "milestone_id": next, "exit_test": "The board reads at a glance", "why": "It had none" }));
    accept_proposal_amended(&mut f.conn, &f.human, &p, &json!({ "title": "Board", "exit_test": "Status reads in five seconds" })).unwrap();
    let m = milestone::get_milestone(&f.conn, &f.m_next).unwrap().unwrap();
    assert_eq!(m.exit_test.as_deref(), Some("Status reads in five seconds"));
}

#[test]
fn an_accepted_reorder_moves_the_milestone_and_the_current_one_follows() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let (next, current) = (f.m_next.clone(), f.m_current.clone());
    let p = propose(&mut f, &s, json!({ "change": "reorder_milestone", "milestone_id": next, "before_milestone_id": current, "why": "Board first" }));
    accept(&mut f, &p);
    let current_now = milestone::current_milestone(&f.conn, &f.project_id).unwrap().unwrap();
    assert_eq!(current_now.id, f.m_next);
}

#[test]
fn retiring_a_milestone_is_refused_while_it_holds_an_open_epic_and_applied_once_it_does_not() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let current = f.m_current.clone();
    let p = propose(&mut f, &s, json!({ "change": "retire_milestone", "milestone_id": current, "why": "Superseded" }));
    let err = accept_proposal_released(&mut f.conn, &f.human, &p, None).unwrap_err();
    assert!(format!("{err:#}").contains("cannot be dropped"), "{err:#}");
    assert_eq!(get_proposal(&f.conn, &p).unwrap().unwrap().state, "pending", "the refusal rolls the decision back");

    let next = f.m_next.clone();
    let p = propose(&mut f, &s, json!({ "change": "retire_milestone", "milestone_id": next, "why": "Nothing in it" }));
    accept(&mut f, &p);
    assert_eq!(milestone::get_milestone(&f.conn, &f.m_next).unwrap().unwrap().state, "dropped");
}

#[test]
fn a_new_epic_goes_after_the_current_milestone_unless_another_is_named() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let p = propose(&mut f, &s, json!({ "change": "add_epic", "title": "Ghost rows", "problem": "Proposals are invisible", "why": "Missing" }));
    let filed = get_proposal(&f.conn, &p).unwrap().unwrap();
    assert_eq!(filed.payload["milestone_id"], json!(f.m_next), "the Milestone after the Current one");
    accept(&mut f, &p);
    let epics = epic::epics_in_milestone(&f.conn, &f.m_next).unwrap();
    assert_eq!(epics.len(), 1);
    assert_eq!((epics[0].title.as_str(), epics[0].state.as_str()), ("Ghost rows", "shaping"));
    assert_eq!(epics[0].spec.problem.as_deref(), Some("Proposals are invisible"));

    let current = f.m_current.clone();
    let p = propose(&mut f, &s, json!({ "change": "add_epic", "title": "Dock", "milestone_id": current, "why": "Belongs here" }));
    accept(&mut f, &p);
    assert_eq!(epic::epics_in_milestone(&f.conn, &f.m_current).unwrap().len(), 2);
}

#[test]
fn dropping_an_epic_is_refused_while_it_holds_an_open_story_and_applied_once_it_does_not() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let epic_id = f.epic_id.clone();
    let p = propose(&mut f, &s, json!({ "change": "drop_epic", "epic_id": epic_id, "why": "Folded into another" }));
    let err = accept_proposal_released(&mut f.conn, &f.human, &p, None).unwrap_err();
    assert!(format!("{err:#}").contains("open Story"), "{err:#}");

    let story_id: String = f.conn.query_row("SELECT id FROM stories WHERE epic_id = ?1", [&f.epic_id], |r| r.get(0)).unwrap();
    story::set_story_state(&mut f.conn, &f.human, &story_id, story::StoryState::Dropped).unwrap();
    accept(&mut f, &p);
    assert_eq!(epic::epic_state(&f.conn, &f.epic_id).unwrap(), epic::EpicState::Dropped);
    // The Milestone's only Epic is dropped, so it holds no open Epic any more.
    set_milestone_state(&mut f.conn, &f.human, &f.m_current, MilestoneState::Dropped).unwrap();
}

#[test]
fn a_change_naming_a_done_milestone_or_another_project_is_refused_when_filed() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let done = f.m_done.clone();
    let err = call(&mut f, &s, "r", "propose_roadmap_change", json!({ "change": "amend_milestone", "milestone_id": done, "title": "x", "why": "y" }))
        .unwrap_err();
    assert!(format!("{err:#}").contains("frozen"), "{err:#}");
    let err = call(&mut f, &s, "r", "propose_roadmap_change", json!({ "change": "retire_milestone", "milestone_id": "01ZZZZZZZZZZZZZZZZZZZZZZZZ", "why": "y" }))
        .unwrap_err();
    assert!(format!("{err:#}").contains("not on this Roadmap"), "{err:#}");
    let err = call(&mut f, &s, "r", "propose_roadmap_change", json!({ "change": "rename_everything", "why": "y" })).unwrap_err();
    assert!(format!("{err:#}").contains("create_milestone"), "{err:#}");
}

#[test]
fn a_rejected_roadmap_proposal_is_listed_with_its_reason_in_the_next_roadmap_packet() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let p = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" }));
    reject_proposal_released(&mut f.conn, &f.human, &p, Some("Not before the one-week test")).unwrap();
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    let section = packet.split("## Rejected Roadmap Proposals").nth(1).unwrap().split("## ").next().unwrap();
    assert!(section.contains("- New Milestone \"Mobile\"; rejected: Not before the one-week test"), "{packet}");
}

// ---------------------------------------------------------------------------------------------
// Closing the Round: roadmap_holds, decisions, Dismiss
// ---------------------------------------------------------------------------------------------

#[test]
fn roadmap_holds_closes_the_round_with_a_roadmap_still_holds_event() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let before = roadmap(&f.conn, &f.project_id).unwrap();
    let id = round_id(&f);
    let out = call(&mut f, &s, "req-h", "roadmap_holds", json!({ "why": "The next Milestone is still right" })).unwrap();
    assert!(matches!(out, ShapingToolOutcome::Answered { .. }), "answered at once: {out:?}");
    let round = get_roadmap_round(&f.conn, &id).unwrap().unwrap();
    assert_eq!(round.state, "closed");
    assert!(round.closed_at.is_some());
    assert_eq!(event_labels(&f.conn, "round.closed"), ["Roadmap still holds"]);
    assert_eq!(roadmap(&f.conn, &f.project_id).unwrap(), before, "no change");
    assert!(open_roadmap_round(&f.conn, &f.project_id).unwrap().is_none());
}

#[test]
fn roadmap_holds_is_refused_once_the_round_holds_a_proposal() {
    let mut f = fixture();
    let s = revisit(&mut f);
    propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" }));
    let err = call(&mut f, &s, "req-h", "roadmap_holds", json!({ "why": "x" })).unwrap_err();
    assert!(format!("{err:#}").contains("round_wait"), "{err:#}");
}

#[test]
fn round_wait_is_held_and_waiting_on_you_until_the_last_decision_closes_the_round_and_releases_it() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let err = call(&mut f, &s, "req-w", "round_wait", json!({})).unwrap_err();
    assert!(format!("{err:#}").contains("propose_roadmap_change"), "nothing to wait on yet: {err:#}");

    let a = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" }));
    let b = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Teams", "why": "Asked once" }));
    let id = round_id(&f);
    let decided = accept_proposal_released(&mut f.conn, &f.human, &a, None).unwrap();
    assert_eq!(decided.release, None, "the session is still working: the Round stays open");
    assert_eq!(get_roadmap_round(&f.conn, &id).unwrap().unwrap().state, "open");

    let held = call(&mut f, &s, "req-w", "round_wait", json!({})).unwrap();
    assert!(matches!(held, ShapingToolOutcome::Held { .. }), "{held:?}");
    let round = get_roadmap_round(&f.conn, &id).unwrap().unwrap();
    assert!(round.waiting_on_you);
    assert_eq!(core::query::fleet::waiting_rounds(&f.conn, 10).unwrap().iter().filter(|r| r.round_id == id).count(), 1);
    assert_eq!(core::query::permissions::blocked_count_for_project(&f.conn, &f.project_id).unwrap(), 1);

    let decided = reject_proposal_released(&mut f.conn, &f.human, &b, Some("Later")).unwrap();
    let release = decided.release.expect("the last decision releases the held round_wait");
    assert_eq!((release.session_id.as_str(), release.request_id.as_str()), (s.as_str(), "req-w"));
    let decisions = release.result["decisions"].as_array().unwrap();
    assert_eq!(decisions.len(), 2);
    assert_eq!(decisions[1]["state"], "rejected");
    assert_eq!(decisions[1]["reason"], "Later");
    let round = get_roadmap_round(&f.conn, &id).unwrap().unwrap();
    assert_eq!(round.state, "closed");
    assert!(!round.waiting_on_you);
    assert_eq!(core::query::permissions::blocked_count_for_project(&f.conn, &f.project_id).unwrap(), 0);
}

#[test]
fn a_round_wait_after_every_decision_closes_the_round_at_once() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let a = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" }));
    accept(&mut f, &a);
    match call(&mut f, &s, "req-w", "round_wait", json!({})).unwrap() {
        ShapingToolOutcome::Answered { result, .. } => assert_eq!(result["decisions"][0]["state"], "accepted"),
        other => panic!("answered at once: {other:?}"),
    }
    assert!(open_roadmap_round(&f.conn, &f.project_id).unwrap().is_none());
}

#[test]
fn deciding_the_last_proposal_of_a_dead_sessions_round_closes_it() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let a = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" }));
    interrupt_session(&mut f.conn, &s, &f.human).unwrap();
    let decided = accept_proposal_released(&mut f.conn, &f.human, &a, None).unwrap();
    assert_eq!(decided.release, None, "nobody is held on it");
    assert!(open_roadmap_round(&f.conn, &f.project_id).unwrap().is_none());
}

#[test]
fn dismiss_closes_the_round_with_no_change_and_rejects_what_was_undecided() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let before = roadmap(&f.conn, &f.project_id).unwrap();
    let p = propose(&mut f, &s, json!({ "change": "create_milestone", "title": "Mobile", "why": "Asked twice" }));
    call(&mut f, &s, "req-w", "round_wait", json!({})).unwrap();
    let id = round_id(&f);

    let agent = core::domain::session::agent_actor_id(&f.conn).unwrap();
    assert!(dismiss_roadmap_round(&mut f.conn, &agent, &id).is_err(), "Dismiss is the developer's alone");

    let out = dismiss_roadmap_round(&mut f.conn, &f.human, &id).unwrap();
    let release = out.release.expect("the held call is told the Round is dismissed");
    assert_eq!(release.result["outcome"], "dismissed");
    let round = get_roadmap_round(&f.conn, &id).unwrap().unwrap();
    assert_eq!(round.state, "dismissed");
    assert_eq!(roadmap(&f.conn, &f.project_id).unwrap(), before, "no change");
    let p = get_proposal(&f.conn, &p).unwrap().unwrap();
    assert_eq!((p.state.as_str(), p.rejection_reason.as_deref()), ("rejected", Some(DISMISSED_REASON)));
    assert_eq!(event_labels(&f.conn, "round.dismissed"), ["Dismissed roadmap Round 1: no change"]);
    assert!(dismiss_roadmap_round(&mut f.conn, &f.human, &id).is_err(), "already dismissed");
    // Until the next trigger: once the session has ended, the next Revisit opens Round 2.
    interrupt_session(&mut f.conn, &s, &f.human).unwrap();
    revisit(&mut f);
    assert_eq!(open_roadmap_round(&f.conn, &f.project_id).unwrap().unwrap().number, 2);
    assert_eq!(proposals_in_round(&f.conn, &round_id(&f)).unwrap().len(), 0);
}

#[test]
fn a_round_opened_by_a_trigger_waits_for_its_session_and_names_the_trigger() {
    let mut f = fixture();
    let round =
        open_roadmap_round_for(&mut f.conn, &f.project_id, RoadmapTrigger::EpicDone(f.epic_id.clone()), &f.human).unwrap();
    assert_eq!(round.session_id, None);
    assert!(open_roadmap_round_for(&mut f.conn, &f.project_id, RoadmapTrigger::Revisit, &f.human).is_err());
    let s = revisit(&mut f);
    assert_eq!(get_roadmap_round(&f.conn, &round.id).unwrap().unwrap().session_id, Some(s));
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    assert!(packet.contains("The developer confirmed Epic FLY-1 \"Rounds\" Done, in Milestone \"Shaping\"."), "{packet}");
}

#[test]
fn round_post_and_spec_changes_are_refused_in_a_roadmap_session_and_roadmap_tools_elsewhere() {
    let mut f = fixture();
    let s = revisit(&mut f);
    let err = call(
        &mut f,
        &s,
        "r",
        "round_post",
        json!({ "note": "n", "questions": [{ "title": "t", "question": "q", "grounding": "g", "recommended_answer": "a", "because": "b" }] }),
    )
    .unwrap_err();
    assert!(format!("{err:#}").contains("asks no numbered questions"), "{err:#}");

    let epic_session = start_shaping_session(&mut f.conn, &ShapingSubject::Epic(f.epic_id.clone()), "dontAsk", &f.human).unwrap().id;
    let err = call(&mut f, &epic_session, "r", "roadmap_holds", json!({ "why": "x" })).unwrap_err();
    assert!(format!("{err:#}").contains("roadmap Round"), "{err:#}");
}
