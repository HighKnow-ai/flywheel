//! Project progress at a glance (docs/mvp-spec.md §7 "Milestone header", issue #106).
//!
//! Pins the counts the header and each Epic row draw, for a seeded Milestone holding a Story in
//! every state (Shaping, Ready, Running, In review, Merged, Dropped) plus the two attention states
//! that split Running (Waiting on you, Stopped). Attention partitions Running, so the counts add up
//! to every Story; Dropped is counted on its own and left out of "Stories merged / Stories".

mod common;

use common::with_scratch_worktree_root;
use flywheel_core::domain::epic::{create_epic, set_epic_state, EpicState};
use flywheel_core::domain::milestone::{create_milestone, set_milestone_state, MilestoneState};
use flywheel_core::domain::permission_request::create_pending_request;
use flywheel_core::domain::session::{interrupt_session, start_session};
use flywheel_core::domain::story::{create_story, set_story_state, StoryState};
use flywheel_core::domain::story_drop::drop_story;
use flywheel_core::query::progress::{epic_progress, milestone_progress, StoryStateCounts};
use rusqlite::{params, Connection};

/// Put a Story straight into a state the board would reach through a hand-off and a merge. The
/// counts read `stories.state`; how it got there is not what this test is about.
fn force_state(conn: &Connection, story_id: &str, state: &str) {
    conn.execute("UPDATE stories SET state = ?1 WHERE id = ?2", params![state, story_id]).unwrap();
}

fn running(conn: &mut Connection, actor: &str, story_id: &str) {
    set_story_state(conn, actor, story_id, StoryState::Ready).unwrap();
    set_story_state(conn, actor, story_id, StoryState::Running).unwrap();
}

#[test]
fn the_header_and_each_epic_count_stories_in_every_state() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();

        // A Done Milestone before the Current one, and one after it: the header reads the Current
        // Milestone and names the next one.
        let done = create_milestone(&mut conn, &project.id, &actor, "Supervised execution", None).unwrap();
        set_milestone_state(&mut conn, &actor, &done.id, MilestoneState::Done).unwrap();
        let m3 = create_milestone(&mut conn, &project.id, &actor, "Shaping", Some("A one-line idea becomes an Epic")).unwrap();
        set_milestone_state(&mut conn, &actor, &m3.id, MilestoneState::Ready).unwrap();
        create_milestone(&mut conn, &project.id, &actor, "Board and review", None).unwrap();

        // Epic A: one Story in each state, and the two attention states.
        let a = create_epic(&mut conn, &actor, &m3.id, "Design system").unwrap();
        let story = |conn: &mut Connection, title: &str| create_story(conn, &actor, &a.id, title).unwrap().id;
        let _shaping = story(&mut conn, "Shaping");
        let ready = story(&mut conn, "Ready");
        set_story_state(&mut conn, &actor, &ready, StoryState::Ready).unwrap();
        let plain = story(&mut conn, "Running");
        running(&mut conn, &actor, &plain);
        start_session(&mut conn, &plain, "acceptEdits", &actor).unwrap();
        let waiting = story(&mut conn, "Waiting on you");
        running(&mut conn, &actor, &waiting);
        let session = start_session(&mut conn, &waiting, "acceptEdits", &actor).unwrap();
        create_pending_request(&mut conn, &session.id, "Bash", Some(r#"{"command":"git push"}"#), &actor, Some("git-push"))
            .unwrap();
        // A second pending request on the same Story must not count it twice.
        create_pending_request(&mut conn, &session.id, "Bash", Some(r#"{"command":"ls /"}"#), &actor, None).unwrap();
        let stopped = story(&mut conn, "Stopped");
        running(&mut conn, &actor, &stopped);
        let dead = start_session(&mut conn, &stopped, "acceptEdits", &actor).unwrap();
        interrupt_session(&mut conn, &dead.id, &actor).unwrap();
        let review = story(&mut conn, "In review");
        force_state(&conn, &review, "in_review");
        let merged = story(&mut conn, "Merged");
        force_state(&conn, &merged, "merged");
        let dropped = story(&mut conn, "Dropped");
        drop_story(&mut conn, &actor, &dropped).unwrap();

        // Epic B: done (one Merged Story, one Dropped). Epic C: empty, still Shaping.
        let b = create_epic(&mut conn, &actor, &m3.id, "Epic shaping").unwrap();
        let b1 = create_story(&mut conn, &actor, &b.id, "Merged in B").unwrap().id;
        force_state(&conn, &b1, "merged");
        let b2 = create_story(&mut conn, &actor, &b.id, "Dropped in B").unwrap().id;
        drop_story(&mut conn, &actor, &b2).unwrap();
        set_epic_state(&mut conn, &actor, &b.id, EpicState::Ready).unwrap();
        set_epic_state(&mut conn, &actor, &b.id, EpicState::Done).unwrap();
        let c = create_epic(&mut conn, &actor, &m3.id, "Roadmap shaping").unwrap();

        // Noise in another Milestone must not leak into the counts.
        let other = create_milestone(&mut conn, &project.id, &actor, "Later", None).unwrap();
        let other_epic = create_epic(&mut conn, &actor, &other.id, "Elsewhere").unwrap();
        create_story(&mut conn, &actor, &other_epic.id, "Not in M3").unwrap();

        let header = milestone_progress(&conn, &project.id, None).unwrap().expect("a Current Milestone");
        assert_eq!(header.milestone_id, m3.id);
        assert_eq!(header.title, "Shaping");
        assert_eq!(header.exit_test.as_deref(), Some("A one-line idea becomes an Epic"));
        assert_eq!(header.state, "in_progress", "Ready with a Story past Ready reads In progress");
        assert_eq!(header.next_milestone_title.as_deref(), Some("Board and review"));
        assert_eq!(
            header.counts,
            StoryStateCounts {
                shaping: 1,
                ready: 1,
                running: 1,
                waiting_on_you: 1,
                stopped: 1,
                in_review: 1,
                merged: 2,
                dropped: 2,
                stories_total: 8,
            },
            "attention splits Running; Dropped is counted apart and left out of the total"
        );
        assert_eq!((header.epics_done, header.epics_total), (1, 3));

        let epics = epic_progress(&conn, &m3.id).unwrap();
        let ids: Vec<&str> = epics.iter().map(|e| e.epic_id.as_str()).collect();
        assert_eq!(ids, vec![a.id.as_str(), b.id.as_str(), c.id.as_str()], "Epics in Roadmap order, empty ones included");
        assert_eq!(epics[0].state, "shaping");
        assert_eq!(
            epics[0].counts,
            StoryStateCounts {
                shaping: 1,
                ready: 1,
                running: 1,
                waiting_on_you: 1,
                stopped: 1,
                in_review: 1,
                merged: 1,
                dropped: 1,
                stories_total: 7,
            }
        );
        assert_eq!(epics[1].state, "done");
        assert_eq!(
            epics[1].counts,
            StoryStateCounts { merged: 1, dropped: 1, stories_total: 1, ..Default::default() },
            "a Done Epic with a Dropped Story reads 1 of 1 merged"
        );
        assert_eq!(epics[2].counts, StoryStateCounts::default(), "an empty Epic counts zero, never NULL");
    });
}

#[test]
fn a_project_without_a_current_milestone_has_no_header() {
    let (mut conn, actor, project) = common::seeded_project();
    assert_eq!(milestone_progress(&conn, &project.id, None).unwrap(), None, "an empty Roadmap");

    let only = create_milestone(&mut conn, &project.id, &actor, "Done already", None).unwrap();
    set_milestone_state(&mut conn, &actor, &only.id, MilestoneState::Done).unwrap();
    assert_eq!(milestone_progress(&conn, &project.id, None).unwrap(), None, "every Milestone Done");
}

#[test]
fn an_empty_current_milestone_counts_zero() {
    let (mut conn, actor, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &actor, "Fresh", None).unwrap();
    let header = milestone_progress(&conn, &project.id, None).unwrap().expect("a Current Milestone");
    assert_eq!(header.milestone_id, m.id);
    assert_eq!(header.state, "shaping");
    assert_eq!(header.next_milestone_title, None);
    assert_eq!(header.counts, StoryStateCounts::default());
    assert_eq!((header.epics_done, header.epics_total), (0, 0));
    assert!(epic_progress(&conn, &m.id).unwrap().is_empty());
}

/// The Roadmap strip (#131) switches the header to any Milestone, not only the Current one.
#[test]
fn a_selected_milestone_reads_its_own_progress() {
    let (mut conn, actor, project) = common::seeded_project();
    let done = create_milestone(&mut conn, &project.id, &actor, "Shipped", Some("it shipped")).unwrap();
    let current = create_milestone(&mut conn, &project.id, &actor, "Now", None).unwrap();
    let later = create_milestone(&mut conn, &project.id, &actor, "Later", None).unwrap();
    let epic = create_epic(&mut conn, &actor, &later.id, "Later work").unwrap();
    create_story(&mut conn, &actor, &epic.id, "A later Story").unwrap();
    set_milestone_state(&mut conn, &actor, &done.id, MilestoneState::Done).unwrap();

    let header = milestone_progress(&conn, &project.id, None).unwrap().unwrap();
    assert_eq!(header.milestone_id, current.id, "no selection reads the Current Milestone");

    let header = milestone_progress(&conn, &project.id, Some(&later.id)).unwrap().unwrap();
    assert_eq!((header.milestone_id.as_str(), header.title.as_str()), (later.id.as_str(), "Later"));
    assert_eq!(header.counts.shaping, 1, "its own Stories are counted");
    assert_eq!((header.epics_done, header.epics_total), (0, 1));
    assert_eq!(header.next_milestone_title, None, "nothing open after the last one");

    let header = milestone_progress(&conn, &project.id, Some(&done.id)).unwrap().expect("a Done Milestone reads too");
    assert_eq!(header.state, "done");
    assert_eq!(header.next_milestone_title.as_deref(), Some("Now"));

    let other = flywheel_core::domain::project::create_project(&mut conn, &actor, "Other", "/other", "OTH", "main").unwrap();
    assert_eq!(
        milestone_progress(&conn, &other.id, Some(&later.id)).unwrap(),
        None,
        "another project's Milestone is not read"
    );
    assert_eq!(milestone_progress(&conn, &project.id, Some("no-such-milestone")).unwrap(), None);
}

/// Spec §7 roster, issue #162: an Epic row carries "n Proposals" while Story sessions have pending
/// Proposals on it, counted in the same read. A judged-on change (issue #163), a decided or withdrawn
/// Proposal and a shaping session's are not counted.
#[test]
fn an_epic_row_counts_its_pending_proposals_from_execution() {
    let (mut conn, actor, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &actor, "Now", None).unwrap();
    let a = create_epic(&mut conn, &actor, &m.id, "With Proposals").unwrap();
    create_epic(&mut conn, &actor, &m.id, "Without").unwrap();
    let s = create_story(&mut conn, &actor, &a.id, "Files").unwrap();
    let session = flywheel_core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'acceptEdits', '/log', '2026-10-01T00:00:00Z')",
        params![session, s.id, project.id, actor],
    )
    .unwrap();
    for (verb, target, state) in [
        ("create", "story", "pending"),
        ("reorder", "story", "pending"),
        ("amend", "criterion", "pending"),
        ("amend", "epic", "pending"),
        ("retire", "story", "accepted"),
    ] {
        let decided_by = (state == "accepted").then_some(actor.as_str());
        conn.execute(
            "INSERT INTO proposals (id, project_id, session_id, epic_id, verb, target_type, payload, state, decided_by, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', ?7, ?8, ?9, '2026-10-01T00:00:00Z')",
            params![flywheel_core::ids::new_id(), project.id, session, a.id, verb, target, state, decided_by, actor],
        )
        .unwrap();
    }
    let rows = epic_progress(&conn, &m.id).unwrap();
    let counts: Vec<(&str, i64)> = rows.iter().map(|e| (e.title.as_str(), e.proposals)).collect();
    assert_eq!(counts, vec![("With Proposals", 2), ("Without", 0)]);
}

#[test]
fn the_header_query_walks_indexes_only() {
    let (conn, _actor, project) = common::seeded_project();
    for (sql, selected) in [
        (flywheel_core::query::progress::MILESTONE_PROGRESS_SQL, Some("a-milestone")),
        (flywheel_core::query::progress::MILESTONE_PROGRESS_SQL, None),
    ] {
        let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
        let plan: Vec<String> = stmt
            .query_map(params![project.id, selected], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_index_only(&plan);
    }
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", flywheel_core::query::progress::EPIC_PROGRESS_SQL)).unwrap();
    let plan: Vec<String> =
        stmt.query_map(params![project.id], |row| row.get::<_, String>(3)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_index_only(&plan);
}

fn assert_index_only(plan: &[String]) {
    for step in plan {
        // `cur` (one row) and `m` (the Milestone's own Stories) are the statement's materialized
        // CTEs; every base table must be reached through an index.
        let cte = step.starts_with("SCAN cur") || step.starts_with("SCAN m ") || step == "SCAN m";
        let full_scan = step.starts_with("SCAN ") && !step.contains("USING") && !cte;
        assert!(!full_scan, "a full table scan in the progress query: {step}\nplan: {plan:#?}");
    }
}
