//! Waiting on you (docs/mvp-spec.md §2 "Attention", §4.1; GLOSSARY.md "Waiting on you"), issue #57.
//!
//! Waiting on you is derived from a live session holding a pending request (a Gated action or a
//! permission request), never read from a stored status. These tests pin the v0.1 root cause: the
//! Blocked queue, the fleet's Blocked band and the board's blocked Stories all filtered on
//! `sessions.status = 'blocked'`, and `answer_request` wrote `running` back after ANY answer. Claude
//! Code raises several requests at once (the walk's planner held six), so answering the first one
//! flipped the session to `running` while the rest still waited, and every surface dropped it.

mod common;

use common::with_scratch_worktree_root;

use core::domain::permission_request::{answer_request, create_pending_request};
use core::domain::session::{interrupt_session, mark_abandoned, start_session};
use core::domain::story::{set_story_state, StoryState};
use core::query::fleet::{blocked_queue, fleet_rows};
use core::query::sessions::stopped_session_for_story;
use core::query::permissions::{blocked_count_for_project, blocked_story_ids_for_project};
use rusqlite::{params, Connection};

struct Seeded {
    conn: Connection,
    actor_id: String,
    project_id: String,
    story_id: String,
    session_id: String,
}

fn seeded_running_session() -> Seeded {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Waiting story");
        set_story_state(&mut conn, &actor_id, &story.id, StoryState::Ready).expect("Ready");
        set_story_state(&mut conn, &actor_id, &story.id, StoryState::Running).expect("Running");
        let session = start_session(&mut conn, &story.id, "acceptEdits", &actor_id).expect("start_session");
        Seeded { conn, actor_id, project_id: project.id, story_id: story.id, session_id: session.id }
    })
}

fn raise(s: &mut Seeded, command: &str) -> String {
    let input = serde_json::json!({ "command": command }).to_string();
    create_pending_request(&mut s.conn, &s.session_id, "Bash", Some(&input), &s.actor_id, None)
        .expect("create_pending_request")
        .id
}

fn fleet_state(s: &Seeded) -> String {
    let list = fleet_rows(&s.conn, 50).expect("fleet_rows");
    list.rows.iter().find(|r| r.session_id == s.session_id).expect("the session is on the fleet").fleet_state.clone()
}

fn assert_waiting(s: &Seeded, waiting_requests: usize) {
    assert_eq!(fleet_state(s), "blocked", "the fleet row must read Waiting on you (its derived `blocked` state)");
    let queue = blocked_queue(&s.conn, 50).expect("blocked_queue");
    assert_eq!(queue.len(), waiting_requests, "the queue holds one entry per waiting request");
    assert_eq!(
        blocked_story_ids_for_project(&s.conn, &s.project_id).unwrap(),
        vec![s.story_id.clone()],
        "the board must show the Story as Waiting on you"
    );
    assert_eq!(blocked_count_for_project(&s.conn, &s.project_id).unwrap(), 1);
}

fn assert_not_waiting(s: &Seeded) {
    assert_ne!(fleet_state(s), "blocked");
    assert!(blocked_queue(&s.conn, 50).unwrap().is_empty());
    assert!(blocked_story_ids_for_project(&s.conn, &s.project_id).unwrap().is_empty());
    assert_eq!(blocked_count_for_project(&s.conn, &s.project_id).unwrap(), 0);
}

/// The v0.1 root cause, replayed from the walk's wave-1 run: several requests raised together, the
/// first answered, the rest still held. v0.1 showed nothing while they waited.
#[test]
fn answering_one_of_several_held_requests_keeps_the_story_waiting_on_you() {
    let mut s = seeded_running_session();
    let first = raise(&mut s, "git status");
    let _second = raise(&mut s, "git log -1");
    let _third = raise(&mut s, "git ls-files");
    assert_waiting(&s, 3);

    answer_request(&mut s.conn, &first, "allowed", &s.actor_id).expect("answer the first");

    assert_waiting(&s, 2);
    let status: String =
        s.conn.query_row("SELECT status FROM sessions WHERE id = ?1", params![s.session_id], |r| r.get(0)).unwrap();
    assert_eq!(status, "blocked", "the session stays blocked while any request is still pending");
}

#[test]
fn answering_the_last_held_request_clears_waiting_on_you() {
    let mut s = seeded_running_session();
    let first = raise(&mut s, "git status");
    let second = raise(&mut s, "git log -1");
    answer_request(&mut s.conn, &first, "allowed", &s.actor_id).unwrap();
    answer_request(&mut s.conn, &second, "denied", &s.actor_id).unwrap();
    assert_not_waiting(&s);
    assert_eq!(fleet_state(&s), "running");
}

/// Derived, not stored: the pending request on a live session decides, whatever `sessions.status`
/// holds.
#[test]
fn a_live_session_with_a_pending_request_is_waiting_whatever_its_stored_status_says() {
    let mut s = seeded_running_session();
    raise(&mut s, "git status");
    s.conn.execute("UPDATE sessions SET status = 'running' WHERE id = ?1", params![s.session_id]).unwrap();
    assert_waiting(&s, 1);
}

#[test]
fn a_session_stored_as_blocked_with_nothing_pending_is_not_waiting() {
    let s = seeded_running_session();
    s.conn.execute("UPDATE sessions SET status = 'blocked' WHERE id = ?1", params![s.session_id]).unwrap();
    assert_not_waiting(&s);
    assert_eq!(fleet_state(&s), "running", "a live session with nothing pending reads Running");
}

/// Only a LIVE session can be waiting on the developer: a request left pending on a session that has
/// ended is not shown as Waiting on you (expiring it is #89's job, not this read's).
#[test]
fn a_pending_request_on_an_ended_session_is_not_waiting() {
    let mut s = seeded_running_session();
    raise(&mut s, "git status");
    s.conn
        .execute("UPDATE sessions SET status = 'interrupted', ended_at = started_at WHERE id = ?1", params![s.session_id])
        .unwrap();
    assert!(blocked_queue(&s.conn, 50).unwrap().is_empty());
    assert!(blocked_story_ids_for_project(&s.conn, &s.project_id).unwrap().is_empty());
}

/// No timeout and no auto-deny: a request raised long ago is still pending and still shown.
#[test]
fn a_request_waits_indefinitely_with_no_timeout_and_no_auto_deny() {
    let mut s = seeded_running_session();
    let id = raise(&mut s, "git push");
    s.conn
        .execute("UPDATE permission_requests SET created_at = '2000-01-01T00:00:00+00:00' WHERE id = ?1", params![id])
        .unwrap();
    assert_waiting(&s, 1);
    let status: String =
        s.conn.query_row("SELECT status FROM permission_requests WHERE id = ?1", params![id], |r| r.get(0)).unwrap();
    assert_eq!(status, "pending", "nothing denies a request for its age");
}

// --- With #89's session endings: an expired request is not waiting, and a Stopped Story never is ---

fn assert_story_stopped_not_waiting(s: &Seeded) {
    assert!(blocked_queue(&s.conn, 50).unwrap().is_empty(), "the queue drops the expired requests");
    assert!(blocked_story_ids_for_project(&s.conn, &s.project_id).unwrap().is_empty());
    assert_eq!(blocked_count_for_project(&s.conn, &s.project_id).unwrap(), 0);
    let list = fleet_rows(&s.conn, 50).unwrap();
    assert!(list.rows.iter().all(|r| r.fleet_state != "blocked"), "no fleet row reads Waiting on you");
    assert!(list.rows.iter().all(|r| r.blocked_since.is_none()));
    assert!(stopped_session_for_story(&s.conn, &s.story_id).unwrap().is_some(), "the Story reads Stopped");
}

#[test]
fn stopping_a_session_waiting_on_you_drops_waiting_on_you_and_the_story_reads_stopped() {
    let mut s = seeded_running_session();
    raise(&mut s, "git push");
    raise(&mut s, "git status");
    assert_waiting(&s, 2);

    interrupt_session(&mut s.conn, &s.session_id, &s.actor_id).expect("stop");

    assert_story_stopped_not_waiting(&s);
}

#[test]
fn a_session_abandoned_while_waiting_on_you_drops_waiting_on_you() {
    let mut s = seeded_running_session();
    raise(&mut s, "git push");
    assert_waiting(&s, 1);

    mark_abandoned(&mut s.conn, &s.session_id, &s.actor_id, None).expect("abandon");

    assert_story_stopped_not_waiting(&s);
}

/// The derivation reads the expiry mark itself, not only the session's status: the moment a request
/// is expired it stops counting, even on a row whose status has not changed yet.
#[test]
fn an_expired_request_stops_counting_the_moment_it_is_expired() {
    let mut s = seeded_running_session();
    let expired = raise(&mut s, "git push");
    raise(&mut s, "git status");
    s.conn
        .execute("UPDATE permission_requests SET expired_at = created_at WHERE id = ?1", params![expired])
        .unwrap();
    assert_waiting(&s, 1);
    s.conn.execute("UPDATE permission_requests SET expired_at = created_at WHERE expired_at IS NULL", []).unwrap();
    assert_not_waiting(&s);
}

// --- Issue #124: a live shaping session held on a Round is Waiting on you ---
//
// A held Round never writes `sessions.status = 'blocked'`: Waiting on you is derived from an open
// Round whose held call belongs to a live session, in every read that shows it (the project's count,
// the fleet's waiting Rounds that light a lamp and fill the sidebar's count, the Epic's attention).

mod shaping {
    use super::common;
    use core::domain::round::{answer_round_question, post_round, NewQuestion, NewRound, RoundAnswer};
    use core::domain::session::{interrupt_session, start_shaping_session, ShapingSubject};
    use core::domain::{epic, milestone};
    use core::query::fleet::waiting_rounds;
    use core::query::permissions::{blocked_count_for_project, blocked_story_ids_for_project, waiting_epic_ids_for_project};
    use core::query::progress::epic_progress;
    use rusqlite::Connection;

    struct Shaping {
        conn: Connection,
        human: String,
        project_id: String,
        milestone_id: String,
        epic_id: String,
        session_id: String,
    }

    fn shaping() -> Shaping {
        let (mut conn, human, project) = common::seeded_project();
        let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
        let e = epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
        let session_id =
            start_shaping_session(&mut conn, &ShapingSubject::Epic(e.id.clone()), "dontAsk", &human).unwrap().id;
        Shaping { conn, human, project_id: project.id, milestone_id: m.id, epic_id: e.id, session_id }
    }

    fn round(n: usize) -> NewRound {
        NewRound {
            note: "Settles the audience.".into(),
            questions: (1..=n)
                .map(|i| NewQuestion {
                    title: format!("Q{i}"),
                    question: format!("Question {i}?"),
                    grounding: "GLOSSARY.md".into(),
                    recommended_answer: "Yes".into(),
                    because: "Because".into(),
                    adr: None,
                })
                .collect(),
        }
    }

    fn attention(s: &Shaping) -> Option<String> {
        epic_progress(&s.conn, &s.milestone_id).unwrap().into_iter().find(|e| e.epic_id == s.epic_id).unwrap().attention
    }

    fn assert_counts(s: &Shaping, waiting: bool) {
        let n = i64::from(waiting);
        assert_eq!(blocked_count_for_project(&s.conn, &s.project_id).unwrap(), n, "the project's Needs-you count");
        let epics = waiting_epic_ids_for_project(&s.conn, &s.project_id).unwrap();
        assert_eq!(epics, if waiting { vec![s.epic_id.clone()] } else { vec![] });
        assert!(blocked_story_ids_for_project(&s.conn, &s.project_id).unwrap().is_empty(), "an Epic is not a Story");
        let lamps = waiting_rounds(&s.conn, 50).unwrap();
        assert_eq!(lamps.len(), n as usize, "one waiting Round across the fleet: {lamps:?}");
    }

    #[test]
    fn a_live_session_held_on_a_round_is_waiting_on_you_until_the_round_is_answered() {
        let mut s = shaping();
        assert_counts(&s, false);
        assert_eq!(attention(&s), None, "a session reading the Epic waits on nobody");

        let posted = post_round(&mut s.conn, &s.session_id, Some("req-1"), &round(2)).unwrap();
        assert_counts(&s, true);
        assert_eq!(attention(&s).as_deref(), Some("waiting_on_you"));
        let stored: String =
            s.conn.query_row("SELECT status FROM sessions WHERE id = ?1", [&s.session_id], |r| r.get(0)).unwrap();
        assert_eq!(stored, "running", "derived, never written to the session");

        let lamp = &waiting_rounds(&s.conn, 50).unwrap()[0];
        assert_eq!(lamp.round_id, posted.id);
        assert_eq!(lamp.session_id, s.session_id);
        assert_eq!(lamp.epic_id.as_deref(), Some(s.epic_id.as_str()));
        assert_eq!(lamp.epic_title.as_deref(), Some("Epic shaping"));
        assert_eq!((lamp.subject.as_str(), lamp.stage_kind.as_deref()), ("epic", Some("challenge_spec")));
        assert_eq!(lamp.milestone_id, None);
        assert_eq!((lamp.round_number, lamp.answered, lamp.questions), (1, 0, 2));
        assert_eq!(lamp.waiting_since, posted.posted_at);

        answer_round_question(&mut s.conn, &s.human, &posted.questions[0].id, &RoundAnswer::Recommended).unwrap();
        assert_counts(&s, true);
        assert_eq!(waiting_rounds(&s.conn, 50).unwrap()[0].answered, 1);

        answer_round_question(&mut s.conn, &s.human, &posted.questions[1].id, &RoundAnswer::Recommended).unwrap();
        assert_counts(&s, false);
        assert_eq!(attention(&s), None);
    }

    #[test]
    fn a_held_round_stops_counting_once_its_session_ends_and_reads_shaping_round_waiting() {
        let mut s = shaping();
        post_round(&mut s.conn, &s.session_id, Some("req-1"), &round(1)).unwrap();
        assert_counts(&s, true);

        interrupt_session(&mut s.conn, &s.session_id, &s.human).unwrap();
        assert_counts(&s, false);
        assert_eq!(attention(&s).as_deref(), Some("round_waiting"), "an open Round with no live session");

        // A fresh session that has not called round_wait yet is reading, not waiting on anyone.
        start_shaping_session(&mut s.conn, &ShapingSubject::Epic(s.epic_id.clone()), "dontAsk", &s.human).unwrap();
        assert_counts(&s, false);
        assert_eq!(attention(&s), None, "a live session is on it");
    }
}
