//! Issue #134: confirming an Epic or a Milestone Done runs a roadmap Round (docs/mvp-spec.md §3
//! "Shaping a Milestone and the Roadmap", Epic #60 "Decided in slicing").
//!
//! The developer's click is the consent: confirming an Epic Done opens one short Round on its
//! Milestone, confirming a Milestone Done opens one Roadmap Round, and each packet names its trigger
//! and says what the Round is for. With a Round already open no second one opens: the trigger is noted
//! on it, and its next packet carries it. Nothing in a Story's life (a transition, a hand-off, a
//! session starting or ending) ever starts a roadmap Round.

mod common;

use std::path::{Path, PathBuf};

use common::with_scratch_worktree_root;
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::confirm_done::{confirm_epic_done, confirm_milestone_done, DoneTrigger};
use flywheel_core::domain::epic::{self, set_epic_state, EpicState};
use flywheel_core::domain::handoff::hand_off;
use flywheel_core::domain::milestone::{self, set_milestone_state, MilestoneState};
use flywheel_core::domain::roadmap_round::{noted_triggers, open_roadmap_round, RoadmapTrigger};
use flywheel_core::domain::session::{agent_actor_id, close_session, start_session, start_shaping_session, SessionStatus, ShapingSubject};
use flywheel_core::domain::story::{self, set_story_state, StoryState};
use flywheel_core::domain::story_drop::drop_story;
use flywheel_core::domain::task::{add_task, set_task_state, TaskState};
use flywheel_core::domain::worktree::ensure_worktree;
use flywheel_core::roadmap_packet::build_roadmap_packet;
use rusqlite::Connection;

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    milestone_id: String,
    /// Two Epics in the Milestone, each Ready with one Story.
    epics: [String; 2],
    stories: [String; 2],
    _checkout: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let checkout = tempfile::tempdir().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let mut conn = flywheel_core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups")).unwrap();
    std::mem::forget(dir);
    let human = local_human_actor_id(&conn).unwrap();
    let project =
        flywheel_core::domain::project::create_project(&mut conn, &human, "Threadfin", &checkout.path().to_string_lossy(), "FLY", "main")
            .unwrap();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", Some("An Epic is shaped end to end")).unwrap();
    milestone::create_milestone(&mut conn, &project.id, &human, "Board", Some("A Story merges in Flywheel")).unwrap();
    set_milestone_state(&mut conn, &human, &m.id, MilestoneState::Ready).unwrap();
    let mut epics = Vec::new();
    let mut stories = Vec::new();
    for title in ["Rounds", "Roadmap"] {
        let e = epic::create_epic(&mut conn, &human, &m.id, title).unwrap();
        let s = story::create_story(&mut conn, &human, &e.id, &format!("{title} story")).unwrap();
        set_story_state(&mut conn, &human, &s.id, StoryState::Ready).unwrap();
        set_epic_state(&mut conn, &human, &e.id, EpicState::Ready).unwrap();
        epics.push(e.id);
        stories.push(s.id);
    }
    Fixture {
        conn,
        human,
        project_id: project.id,
        milestone_id: m.id,
        epics: epics.try_into().unwrap(),
        stories: stories.try_into().unwrap(),
        _checkout: checkout,
    }
}

/// Ready → Running → In review → Merged, through the Story writer.
fn merge(conn: &mut Connection, human: &str, story_id: &str) {
    for to in [StoryState::Running, StoryState::InReview, StoryState::Merged] {
        set_story_state(conn, human, story_id, to).unwrap();
    }
}

fn roadmap_rounds(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM rounds WHERE stage_id IS NULL", [], |r| r.get(0)).unwrap()
}

fn epic_state(conn: &Connection, id: &str) -> String {
    conn.query_row("SELECT state FROM epics WHERE id = ?1", [id], |r| r.get(0)).unwrap()
}

// ---------------------------------------------------------------------------------------------
// Confirming Done opens one Round, and its packet names the trigger and the Round's scope
// ---------------------------------------------------------------------------------------------

#[test]
fn confirming_an_epic_done_opens_one_short_round_on_its_milestone_that_names_the_trigger() {
    let mut f = fixture();
    merge(&mut f.conn, &f.human, &f.stories[0]);

    let outcome = confirm_epic_done(&mut f.conn, &f.human, &f.epics[0]).unwrap();

    let DoneTrigger::Opened(round) = outcome else { panic!("a Round opens: {outcome:?}") };
    assert_eq!(epic_state(&f.conn, &f.epics[0]), "done");
    assert_eq!(round.trigger, RoadmapTrigger::EpicDone(f.epics[0].clone()));
    assert_eq!(round.session_id, None, "the session starts after, as Revisit roadmap's does");
    assert_eq!(roadmap_rounds(&f.conn), 1);
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    assert!(packet.contains("The developer confirmed Epic FLY-1 \"Rounds\" Done, in Milestone \"Shaping\"."), "{packet}");
    let standing = packet.split("## Standing instructions").nth(1).unwrap().split("\n## ").next().unwrap();
    assert!(standing.contains("This Round is short, and on one Milestone: \"Shaping\""), "{standing}");
    assert!(standing.contains("is its exit test still reachable"), "{standing}");
    assert!(standing.contains("is an Epic missing, or one to drop"), "{standing}");
    assert!(!standing.contains("is the next Milestone still right"), "an Epic's Round is not a Roadmap Round: {standing}");
}

#[test]
fn confirming_a_milestone_done_opens_one_roadmap_round_that_names_the_trigger() {
    let mut f = fixture();
    for i in 0..2 {
        merge(&mut f.conn, &f.human, &f.stories[i]);
        set_epic_state(&mut f.conn, &f.human, &f.epics[i], EpicState::Done).unwrap();
    }

    let outcome = confirm_milestone_done(&mut f.conn, &f.human, &f.milestone_id).unwrap();

    let DoneTrigger::Opened(round) = outcome else { panic!("a Round opens: {outcome:?}") };
    assert_eq!(round.trigger, RoadmapTrigger::MilestoneDone(f.milestone_id.clone()));
    let state: String =
        f.conn.query_row("SELECT state FROM milestones WHERE id = ?1", [&f.milestone_id], |r| r.get(0)).unwrap();
    assert_eq!(state, "done");
    assert_eq!(roadmap_rounds(&f.conn), 1);
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    assert!(packet.contains("The developer confirmed Milestone \"Shaping\" Done."), "{packet}");
    let standing = packet.split("## Standing instructions").nth(1).unwrap().split("\n## ").next().unwrap();
    assert!(standing.contains("This is a Roadmap Round: a Milestone is Done"), "{standing}");
    assert!(standing.contains("is the next Milestone still right"), "{standing}");
}

#[test]
fn the_exit_test_is_confirmed_only_once_everything_under_it_is_closed_and_a_refusal_opens_nothing() {
    let mut f = fixture();
    let err = confirm_epic_done(&mut f.conn, &f.human, &f.epics[0]).unwrap_err();
    assert!(format!("{err:#}").contains("every Story is Merged or Dropped"), "{err:#}");
    assert_eq!(epic_state(&f.conn, &f.epics[0]), "ready");

    merge(&mut f.conn, &f.human, &f.stories[0]);
    confirm_epic_done(&mut f.conn, &f.human, &f.epics[0]).unwrap();
    let err = confirm_milestone_done(&mut f.conn, &f.human, &f.milestone_id).unwrap_err();
    assert!(format!("{err:#}").contains("every Epic is Done"), "{err:#}");
    let state: String =
        f.conn.query_row("SELECT state FROM milestones WHERE id = ?1", [&f.milestone_id], |r| r.get(0)).unwrap();
    assert_eq!(state, "ready");
    assert_eq!(roadmap_rounds(&f.conn), 1, "the refusal opened nothing");

    let agent = agent_actor_id(&f.conn).unwrap();
    merge(&mut f.conn, &f.human, &f.stories[1]);
    assert!(confirm_epic_done(&mut f.conn, &agent, &f.epics[1]).is_err(), "only the developer confirms");
    assert_eq!(epic_state(&f.conn, &f.epics[1]), "ready");
}

#[test]
fn declining_the_exit_test_reopens_shaping_and_opens_no_round() {
    let mut f = fixture();
    merge(&mut f.conn, &f.human, &f.stories[0]);
    set_epic_state(&mut f.conn, &f.human, &f.epics[0], EpicState::Shaping).unwrap();
    assert_eq!(epic_state(&f.conn, &f.epics[0]), "shaping");
    assert_eq!(roadmap_rounds(&f.conn), 0);
}

// ---------------------------------------------------------------------------------------------
// With a Round already open: the trigger is noted on it, never a second Round
// ---------------------------------------------------------------------------------------------

#[test]
fn a_done_trigger_while_a_round_is_open_is_noted_on_it_and_its_next_packet_carries_it() {
    let mut f = fixture();
    merge(&mut f.conn, &f.human, &f.stories[0]);
    merge(&mut f.conn, &f.human, &f.stories[1]);
    let DoneTrigger::Opened(first) = confirm_epic_done(&mut f.conn, &f.human, &f.epics[0]).unwrap() else {
        panic!("the first confirmation opens the Round")
    };

    let outcome = confirm_epic_done(&mut f.conn, &f.human, &f.epics[1]).unwrap();

    let DoneTrigger::Noted(round) = outcome else { panic!("noted on the open Round: {outcome:?}") };
    assert_eq!(round.id, first.id);
    assert_eq!(roadmap_rounds(&f.conn), 1, "no second Round");
    assert_eq!(epic_state(&f.conn, &f.epics[1]), "done", "the Epic is Done all the same");
    assert_eq!(noted_triggers(&f.conn, &round.id).unwrap(), [RoadmapTrigger::EpicDone(f.epics[1].clone())]);
    let labels: Vec<String> = {
        let mut stmt = f.conn.prepare("SELECT payload FROM events WHERE event_type = 'round.trigger_noted'").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|p| serde_json::from_str::<serde_json::Value>(&p.unwrap()).unwrap()["label"].as_str().unwrap().to_string())
            .collect()
    };
    assert_eq!(labels, ["Noted Epic FLY-3 done on roadmap Round 1"]);

    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    let trigger = packet.split("## Trigger").nth(1).unwrap().split("\n## ").next().unwrap();
    assert!(trigger.contains("The developer confirmed Epic FLY-1 \"Rounds\" Done"), "{trigger}");
    assert!(trigger.contains("Since it opened:"), "{trigger}");
    assert!(trigger.contains("- The developer confirmed Epic FLY-3 \"Roadmap\" Done, in Milestone \"Shaping\"."), "{trigger}");

    // The Milestone confirmed Done while the same Round is open is noted too, and widens the Round.
    let DoneTrigger::Noted(_) = confirm_milestone_done(&mut f.conn, &f.human, &f.milestone_id).unwrap() else {
        panic!("noted")
    };
    assert_eq!(roadmap_rounds(&f.conn), 1);
    let packet = build_roadmap_packet(&f.conn, &f.project_id).unwrap();
    let standing = packet.split("## Standing instructions").nth(1).unwrap().split("\n## ").next().unwrap();
    assert!(standing.contains("is the next Milestone still right"), "a Milestone Done widens it: {standing}");
}

// ---------------------------------------------------------------------------------------------
// Nothing else triggers a roadmap Round
// ---------------------------------------------------------------------------------------------

#[test]
fn no_story_transition_hand_off_or_session_event_starts_a_roadmap_round() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let m = milestone::create_milestone(&mut conn, &project.id, &human, "Supervised", None).unwrap();
        set_milestone_state(&mut conn, &human, &m.id, MilestoneState::Ready).unwrap();
        let e = epic::create_epic(&mut conn, &human, &m.id, "Execution").unwrap();
        let shaping = start_shaping_session(&mut conn, &ShapingSubject::Epic(e.id.clone()), "dontAsk", &human).unwrap();
        close_session(&mut conn, &shaping.id, SessionStatus::Completed, None, None, None).unwrap();
        let worked = story::create_story(&mut conn, &human, &e.id, "Worked").unwrap();
        let dropped = story::create_story(&mut conn, &human, &e.id, "Dropped").unwrap();
        set_epic_state(&mut conn, &human, &e.id, EpicState::Ready).unwrap();

        // Every Story transition, a real hand-off, and sessions starting and ending.
        set_story_state(&mut conn, &human, &worked.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &human, &worked.id, StoryState::Running).unwrap();
        ensure_worktree(&mut conn, &worked.id, &human).unwrap();
        let first = start_session(&mut conn, &worked.id, "acceptEdits", &human).unwrap();
        close_session(&mut conn, &first.id, SessionStatus::Interrupted, None, None, None).unwrap();
        let session = start_session(&mut conn, &worked.id, "acceptEdits", &human).unwrap();
        let agent = agent_actor_id(&conn).unwrap();
        let task = add_task(&mut conn, &agent, &worked.id, "Do the work").unwrap();
        set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();
        hand_off(&mut conn, &session.id, "Nothing left.", "").unwrap();
        close_session(&mut conn, &session.id, SessionStatus::Completed, None, None, None).unwrap();
        set_story_state(&mut conn, &human, &worked.id, StoryState::Running).unwrap();
        set_story_state(&mut conn, &agent, &worked.id, StoryState::InReview).unwrap();
        set_story_state(&mut conn, &human, &worked.id, StoryState::Merged).unwrap();
        drop_story(&mut conn, &human, &dropped.id).unwrap();

        // Every Story of the Epic is now closed: still no Round until the developer confirms it.
        assert_eq!(roadmap_rounds(&conn), 0, "nothing in a Story's life starts a roadmap Round");
        assert!(open_roadmap_round(&conn, &project.id).unwrap().is_none());
        confirm_epic_done(&mut conn, &human, &e.id).unwrap();
        assert_eq!(roadmap_rounds(&conn), 1);
    });
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// The structural half of the pin: outside the roadmap Round's own module, a roadmap Round is opened
/// only by confirming Done (`confirm_done.rs`) and by a roadmap session starting (`session.rs`, which
/// Revisit roadmap and the confirmation's own session call). A new caller anywhere else, a Story
/// transition, the hand-off or a session event, fails here and names itself.
#[test]
fn only_confirming_done_and_a_roadmap_session_open_a_roadmap_round() {
    let root = workspace_root();
    let mut files = Vec::new();
    rust_files(&root.join("packages/core/src"), &mut files);
    rust_files(&root.join("packages/desktop/src-tauri/src"), &mut files);
    let openers = ["ensure_open_roadmap_round_in_tx", "open_roadmap_round_for", "note_trigger_in_tx"];
    let allowed = ["packages/core/src/domain/roadmap_round.rs", "packages/core/src/domain/confirm_done.rs", "packages/core/src/domain/session.rs"];
    let mut offenders = Vec::new();
    for file in files {
        let rel = file.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/");
        if allowed.contains(&rel.as_str()) {
            continue;
        }
        let text = std::fs::read_to_string(&file).unwrap();
        for (n, line) in text.lines().enumerate() {
            if line.trim_start().starts_with("//") {
                continue;
            }
            if openers.iter().any(|o| line.contains(o)) {
                offenders.push(format!("{rel}:{}: {}", n + 1, line.trim()));
            }
        }
    }
    assert!(offenders.is_empty(), "only confirming Done or a roadmap session opens a roadmap Round:\n{}", offenders.join("\n"));

    // And a roadmap session started from session.rs is only ever on the Revisit trigger, which takes an
    // open Round over rather than opening one for a Story.
    let session = std::fs::read_to_string(root.join("packages/core/src/domain/session.rs")).unwrap();
    let uses: Vec<&str> = session.lines().filter(|l| !l.trim_start().starts_with("//") && l.contains("ensure_open_roadmap_round_in_tx")).collect();
    assert_eq!(uses.len(), 1, "one call, in start_shaping_session's Roadmap arm: {uses:?}");
}
