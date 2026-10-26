//! The MVP record domain against docs/mvp-spec.md §2 and §4: the Roadmap and the Current
//! Milestone, the Story transition table, Epic and Milestone closing rules, the Task checklist, the
//! Check result lifecycle, the Proposal soft cap and ADR links. Each writer appends its event in the
//! same transaction as its row.

mod common;

use flywheel_core::domain::acceptance_criterion::create_criterion;
use flywheel_core::domain::adr_link::{adr_links_for_project, link_adr, AdrLinkTarget};
use flywheel_core::domain::session::agent_actor_id;
use flywheel_core::domain::check::{current_result, record_check_run, set_check, CheckResult, CheckRunRecord};
use flywheel_core::domain::epic::{create_epic, epic_state, set_epic_state, update_epic, EpicSpec, EpicState};
use flywheel_core::domain::milestone::{
    create_milestone, current_milestone, milestone_state, roadmap, set_milestone_state, MilestoneState,
};
use flywheel_core::domain::proposal::{file_proposal, NewProposal, ProposalTarget, ProposalVerb, OPEN_PROPOSALS_PER_SESSION};
use flywheel_core::domain::story::{create_story, is_allowed_transition, set_story_state, stories_in_epic, StoryState};
use flywheel_core::domain::task::{add_task, set_task_state, tasks_for_story, TaskState};
use rusqlite::Connection;

fn events(conn: &Connection, event_type: &str) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM events WHERE event_type = ?1", [event_type], |r| r.get(0)).unwrap()
}

#[test]
fn a_new_project_starts_with_an_empty_roadmap_and_milestones_keep_their_order() {
    let (mut conn, human, project) = common::seeded_project();
    assert!(roadmap(&conn, &project.id).unwrap().is_empty());
    assert!(current_milestone(&conn, &project.id).unwrap().is_none());

    let m1 = create_milestone(&mut conn, &project.id, &human, "Walking skeleton", Some("one Story merges")).unwrap();
    let m2 = create_milestone(&mut conn, &project.id, &human, "Board", None).unwrap();
    let titles: Vec<String> = roadmap(&conn, &project.id).unwrap().into_iter().map(|m| m.title).collect();
    assert_eq!(titles, ["Walking skeleton", "Board"]);
    assert_eq!(events(&conn, "milestone.created"), 2);

    assert_eq!(current_milestone(&conn, &project.id).unwrap().unwrap().id, m1.id);
    set_milestone_state(&mut conn, &human, &m1.id, MilestoneState::Done).unwrap();
    assert_eq!(current_milestone(&conn, &project.id).unwrap().unwrap().id, m2.id, "the first not done or dropped");
}

#[test]
fn a_done_milestone_is_frozen_and_one_with_an_open_epic_cannot_be_dropped() {
    let (mut conn, human, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &human, "M", None).unwrap();
    create_epic(&mut conn, &human, &m.id, "Open Epic").unwrap();
    assert!(set_milestone_state(&mut conn, &human, &m.id, MilestoneState::Dropped).is_err());
    assert!(set_milestone_state(&mut conn, &human, &m.id, MilestoneState::InProgress).is_err(), "derived, never set");

    let done = create_milestone(&mut conn, &project.id, &human, "Done", None).unwrap();
    set_milestone_state(&mut conn, &human, &done.id, MilestoneState::Done).unwrap();
    assert!(set_milestone_state(&mut conn, &human, &done.id, MilestoneState::Shaping).is_err(), "frozen");
    assert!(create_epic(&mut conn, &human, &done.id, "Late").is_err(), "a Done Milestone takes no new Epic");
}

#[test]
fn milestone_and_epic_progress_is_derived_from_their_stories() {
    let (mut conn, human, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &human, "M", None).unwrap();
    let e = create_epic(&mut conn, &human, &m.id, "E").unwrap();
    let s = create_story(&mut conn, &human, &e.id, "S").unwrap();
    set_milestone_state(&mut conn, &human, &m.id, MilestoneState::Ready).unwrap();
    set_epic_state(&mut conn, &human, &e.id, EpicState::Ready).unwrap();
    assert_eq!(epic_state(&conn, &e.id).unwrap(), EpicState::Ready);
    assert_eq!(milestone_state(&conn, &m.id).unwrap(), MilestoneState::Ready);

    set_story_state(&mut conn, &human, &s.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &s.id, StoryState::Running).unwrap();
    assert_eq!(epic_state(&conn, &e.id).unwrap(), EpicState::InProgress);
    assert_eq!(milestone_state(&conn, &m.id).unwrap(), MilestoneState::InProgress);
}

#[test]
fn an_epic_is_done_only_when_the_developer_confirms_after_every_story_closed() {
    let (mut conn, human, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &human, "M", None).unwrap();
    let e = create_epic(&mut conn, &human, &m.id, "E").unwrap();
    assert!(set_epic_state(&mut conn, &human, &e.id, EpicState::Done).is_err(), "no Story yet");
    let a = create_story(&mut conn, &human, &e.id, "A").unwrap();
    let b = create_story(&mut conn, &human, &e.id, "B").unwrap();
    set_story_state(&mut conn, &human, &a.id, StoryState::Dropped).unwrap();
    assert!(set_epic_state(&mut conn, &human, &e.id, EpicState::Done).is_err(), "B is still open");
    set_story_state(&mut conn, &human, &b.id, StoryState::Dropped).unwrap();
    assert_eq!(epic_state(&conn, &e.id).unwrap(), EpicState::Shaping, "all Stories closing never closes an Epic");
    set_epic_state(&mut conn, &human, &e.id, EpicState::Done).unwrap();
    assert_eq!(epic_state(&conn, &e.id).unwrap(), EpicState::Done);
    assert!(create_story(&mut conn, &human, &e.id, "Late").is_err(), "a Done Epic takes no new Story");
}

#[test]
fn the_epic_spec_round_trips() {
    let (mut conn, human, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &human, "M", None).unwrap();
    let e = create_epic(&mut conn, &human, &m.id, "E").unwrap();
    let spec = EpicSpec {
        problem: Some("p".into()),
        scope: Some("s".into()),
        out_of_scope: Some("o".into()),
        exit_test: Some("x".into()),
    };
    update_epic(&mut conn, &human, &e.id, "E2", &spec).unwrap();
    let read = flywheel_core::domain::epic::get_epic(&conn, &e.id).unwrap().unwrap();
    assert_eq!((read.title.as_str(), read.spec), ("E2", spec));
}

#[test]
fn stories_take_project_keys_and_keep_execution_order_inside_their_epic() {
    let (mut conn, human, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &human, "M", None).unwrap();
    let e = create_epic(&mut conn, &human, &m.id, "E").unwrap();
    let a = create_story(&mut conn, &human, &e.id, "A").unwrap();
    let b = create_story(&mut conn, &human, &e.id, "B").unwrap();
    assert_eq!((e.key.as_str(), a.key.as_str(), b.key.as_str()), ("FLY-1", "FLY-2", "FLY-3"));
    let order: Vec<String> = stories_in_epic(&conn, &e.id).unwrap().into_iter().map(|s| s.title).collect();
    assert_eq!(order, ["A", "B"]);
    assert!(create_story(&mut conn, &human, "01ZZZZZZZZZZZZZZZZZZZZZZZZ", "Orphan").is_err(), "never outside an Epic");
}

#[test]
fn the_story_transition_table_is_the_spec_table() {
    use StoryState::*;
    let allowed = [
        (Shaping, Ready),
        (Ready, Running),
        (Running, InReview),
        (InReview, Running),
        (InReview, Merged),
        (Shaping, Dropped),
        (Ready, Dropped),
        (Running, Dropped),
        (InReview, Dropped),
    ];
    for from in StoryState::ALL {
        for to in StoryState::ALL {
            assert_eq!(is_allowed_transition(from, to), allowed.contains(&(from, to)), "{from:?} -> {to:?}");
        }
    }
}

#[test]
fn an_illegal_story_move_is_refused_and_writes_nothing() {
    let (mut conn, human, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &human, "S");
    let before = events(&conn, "story.state_changed");
    assert!(set_story_state(&mut conn, &human, &s.id, StoryState::Merged).is_err());
    assert_eq!(events(&conn, "story.state_changed"), before);
    set_story_state(&mut conn, &human, &s.id, StoryState::Dropped).unwrap();
    assert!(set_story_state(&mut conn, &human, &s.id, StoryState::Ready).is_err(), "Dropped is an end state");
}

#[test]
fn the_task_checklist_keeps_order_one_doing_and_a_reason_for_every_drop() {
    let (mut conn, human, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &human, "S");
    let agent = agent_actor_id(&conn).unwrap();
    let t1 = add_task(&mut conn, &agent, &s.id, "Write the failing test").unwrap();
    let t2 = add_task(&mut conn, &agent, &s.id, "Make it pass").unwrap();
    let titles: Vec<String> = tasks_for_story(&conn, &s.id).unwrap().into_iter().map(|t| t.title).collect();
    assert_eq!(titles, ["Write the failing test", "Make it pass"]);

    set_task_state(&mut conn, &agent, &t1.id, TaskState::Doing, None).unwrap();
    assert!(set_task_state(&mut conn, &agent, &t2.id, TaskState::Doing, None).is_err(), "at most one doing");
    set_task_state(&mut conn, &agent, &t1.id, TaskState::Done, None).unwrap();
    set_task_state(&mut conn, &agent, &t2.id, TaskState::Doing, None).unwrap();

    assert!(set_task_state(&mut conn, &human, &t2.id, TaskState::Dropped, None).is_err(), "a drop needs a reason");
    assert!(set_task_state(&mut conn, &human, &t1.id, TaskState::Open, Some("why")).is_err(), "only a drop takes one");
    set_task_state(&mut conn, &human, &t2.id, TaskState::Dropped, Some("superseded")).unwrap();
    let t2 = tasks_for_story(&conn, &s.id).unwrap().into_iter().find(|t| t.id == t2.id).unwrap();
    assert_eq!((t2.state.as_str(), t2.dropped_reason.as_deref()), ("dropped", Some("superseded")));
    assert_eq!(events(&conn, "task.added"), 2);
}

#[test]
fn a_check_result_is_not_run_until_recorded_and_resets_when_the_check_is_edited() {
    let (mut conn, human, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &human, "S");
    let c = create_criterion(&mut conn, &human, &s.id, "Tests pass.").unwrap();
    let check = set_check(&mut conn, &human, &c.id, "npm test", None).unwrap();
    assert_eq!(check.timeout_secs, 600, "ten minutes by default");
    assert_eq!(current_result(&conn, &check.id).unwrap().result, CheckResult::NotRun);

    let later = (chrono::Utc::now() + chrono::Duration::seconds(1)).to_rfc3339();
    let run = |result| CheckRunRecord {
        commit_sha: "abc",
        result,
        exit_code: None,
        output_tail: None,
        started_at: &later,
        ended_at: &later,
    };
    record_check_run(&mut conn, &check.id, &run(CheckResult::TimedOut)).unwrap();
    let current = current_result(&conn, &check.id).unwrap();
    assert_eq!((current.result, current.commit_sha.as_deref()), (CheckResult::TimedOut, Some("abc")));
    assert!(record_check_run(&mut conn, &check.id, &run(CheckResult::NotRun)).is_err(), "not run is not a run");

    std::thread::sleep(std::time::Duration::from_millis(1100));
    set_check(&mut conn, &human, &c.id, "npm test -- --run", None).unwrap();
    assert_eq!(current_result(&conn, &check.id).unwrap().result, CheckResult::NotRun, "editing resets to not run");
}

#[test]
fn a_session_holds_at_most_three_open_proposals() {
    let (mut conn, human, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &human, "S");
    let agent = agent_actor_id(&conn).unwrap();
    let session = flywheel_core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'default', '/tmp/x.jsonl', 'now')",
        rusqlite::params![session, s.id, project.id, agent],
    )
    .unwrap();
    let proposal = |n: usize| NewProposal {
        project_id: &project.id,
        session_id: Some(&session),
        epic_id: Some(&s.epic_id),
        verb: ProposalVerb::Create,
        target: ProposalTarget::Story,
        target_id: None,
        payload: serde_json::json!({ "title": format!("Follow-up {n}") }),
        rationale: Some("found while working"),
    };
    for n in 0..OPEN_PROPOSALS_PER_SESSION as usize {
        file_proposal(&mut conn, &agent, &proposal(n)).unwrap();
    }
    let err = file_proposal(&mut conn, &agent, &proposal(9)).unwrap_err();
    assert!(format!("{err:#}").contains("proposal_withdraw"), "{err:#}");
    assert_eq!(events(&conn, "proposal.filed"), 3);
}

#[test]
fn an_adr_link_hangs_from_exactly_one_record_of_its_project() {
    let (mut conn, human, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &human, "S");
    link_adr(&mut conn, &human, &project.id, "docs/adr/0004-x.md", &AdrLinkTarget::Story(s.id.clone())).unwrap();
    link_adr(&mut conn, &human, &project.id, "docs/adr/0005-y.md", &AdrLinkTarget::Epic(s.epic_id.clone())).unwrap();
    assert!(link_adr(&mut conn, &human, &project.id, "/abs/path.md", &AdrLinkTarget::Story(s.id.clone())).is_err());
    let links = adr_links_for_project(&conn, &project.id).unwrap();
    assert_eq!(links.len(), 2);
    assert_eq!(links[0].target, AdrLinkTarget::Story(s.id.clone()));
    let both = conn.execute(
        "INSERT INTO adr_links (id, project_id, path, milestone_id, epic_id, story_id, created_by, created_at)
         VALUES (?1, ?2, 'x.md', NULL, ?3, ?4, ?5, 'now')",
        rusqlite::params![flywheel_core::ids::new_id(), project.id, s.epic_id, s.id, human],
    );
    assert!(both.is_err(), "a link from two records is unrepresentable");
}
