//! The Issue mirror (issue #2118): accepted Epics and Stories reach the forge as issues through an
//! outbox. The forge is a fake that records every write and its time.

mod common;

use std::time::Duration;

use common::seeded_project;
use flywheel_core::domain::acceptance_criterion::create_criterion;
use flywheel_core::domain::epic::{self, EpicState};
use flywheel_core::domain::issue_mirror::{
    read_settings, run_mirror, set_settings, MirrorPacing, MirrorSettings,
};
use flywheel_core::domain::milestone::create_milestone;
use flywheel_core::domain::story::{self, StoryState};
use flywheel_core::issue_forge::fake::{FakeIssueForge, Write};
use flywheel_core::issue_forge::CloseReason;
use rusqlite::{params, Connection};

fn fast() -> MirrorPacing {
    MirrorPacing {
        min_gap: Duration::from_millis(30),
        max_writes: 100,
    }
}

struct Fixture {
    conn: Connection,
    epic_id: String,
    story_ids: [String; 2],
}

/// A mirrored project holding one Ready Epic with two Ready Stories, the first with two criteria.
fn fixture() -> Fixture {
    let (mut conn, actor, project) = seeded_project();
    set_settings(
        &mut conn,
        &actor,
        &project.id,
        &MirrorSettings {
            enabled: true,
            repo: Some("acme/app".into()),
        },
    )
    .unwrap();
    let m = create_milestone(&mut conn, &project.id, &actor, "M", None).unwrap();
    let e = epic::create_epic(&mut conn, &actor, &m.id, "Mirror it").unwrap();
    epic::set_epic_state(&mut conn, &actor, &e.id, EpicState::Ready).unwrap();
    let mut ids = Vec::new();
    for title in ["First", "Second"] {
        let s = story::create_story(&mut conn, &actor, &e.id, title).unwrap();
        story::set_story_state(&mut conn, &actor, &s.id, StoryState::Ready).unwrap();
        ids.push(s.id);
    }
    create_criterion(&mut conn, &actor, &ids[0], "It mirrors").unwrap();
    create_criterion(&mut conn, &actor, &ids[0], "It retries").unwrap();
    Fixture {
        conn,
        epic_id: e.id,
        story_ids: [ids[0].clone(), ids[1].clone()],
    }
}

fn number_of(conn: &Connection, table: &str, id: &str) -> Option<i64> {
    conn.query_row(
        &format!("SELECT issue_number FROM {table} WHERE id = ?1"),
        params![id],
        |r| r.get(0),
    )
    .unwrap()
}

fn queued(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM mirror_outbox", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn the_mirror_is_off_by_default_and_a_project_writes_nothing() {
    let (conn, _, project) = seeded_project();
    assert_eq!(
        read_settings(&conn, &project.id).unwrap(),
        MirrorSettings::default()
    );
    let forge = FakeIssueForge::new(100);
    run_mirror(&conn, &forge, fast());
    assert!(forge.log().is_empty());
}

#[test]
fn an_epic_with_two_stories_costs_one_label_and_five_writes() {
    let f = fixture();
    let forge = FakeIssueForge::new(100);
    let changed = run_mirror(&f.conn, &forge, fast());

    let log = forge.log();
    assert_eq!(log.len(), 6, "{log:#?}");
    assert_eq!(log[0], Write::Label("flywheel:ready".into()));
    assert!(
        matches!(&log[1], Write::Create { number: 100, title, label, .. } if title == "Mirror it" && label == "flywheel:ready")
    );
    assert!(matches!(&log[2], Write::Create { number: 101, title, .. } if title == "First"));
    assert_eq!(
        log[3],
        Write::SubIssue {
            parent: 100,
            child: 101
        }
    );
    assert!(matches!(&log[4], Write::Create { number: 102, .. }));
    assert_eq!(
        log[5],
        Write::SubIssue {
            parent: 100,
            child: 102
        }
    );

    let Write::Create { body, .. } = &log[2] else {
        unreachable!()
    };
    assert!(
        body.contains("- [ ] It mirrors\n- [ ] It retries"),
        "{body}"
    );

    assert_eq!(number_of(&f.conn, "epics", &f.epic_id), Some(100));
    assert_eq!(number_of(&f.conn, "stories", &f.story_ids[0]), Some(101));
    assert_eq!(number_of(&f.conn, "stories", &f.story_ids[1]), Some(102));
    assert_eq!(queued(&f.conn), 0);
    assert_eq!(changed.len(), 1);

    run_mirror(&f.conn, &forge, fast());
    assert_eq!(forge.log().len(), 6, "a second pass owes nothing");
}

#[test]
fn writes_are_serial_and_spaced() {
    let f = fixture();
    let forge = FakeIssueForge::new(100);
    run_mirror(&f.conn, &forge, fast());
    let times: Vec<_> = forge.writes.borrow().iter().map(|(t, _)| *t).collect();
    assert!(times.len() > 1);
    for pair in times.windows(2) {
        assert!(
            pair[1].duration_since(pair[0]) >= Duration::from_millis(30),
            "two writes less than the gap apart"
        );
    }
}

#[test]
fn a_failed_write_stays_queued_and_is_retried() {
    let f = fixture();
    let forge = FakeIssueForge::new(100);
    *forge.fail_next.borrow_mut() = 1;
    run_mirror(&f.conn, &forge, fast());
    assert!(forge.log().is_empty());
    assert_eq!(queued(&f.conn), 5);
    assert_eq!(number_of(&f.conn, "epics", &f.epic_id), None);
    let (attempts, error): (i64, String) = f
        .conn
        .query_row(
            "SELECT attempts, last_error FROM mirror_outbox ORDER BY id LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!((attempts, error.as_str()), (1, "the forge is down"));

    run_mirror(&f.conn, &forge, fast());
    assert_eq!(forge.log().len(), 6);
    assert_eq!(queued(&f.conn), 0);
}

#[test]
fn a_state_change_edits_the_label_and_merged_and_dropped_close_with_their_reason() {
    let f = fixture();
    let forge = FakeIssueForge::new(100);
    run_mirror(&f.conn, &forge, fast());
    let before = forge.log().len();

    f.conn
        .execute(
            "UPDATE stories SET state = 'merged' WHERE id = ?1",
            params![f.story_ids[0]],
        )
        .unwrap();
    f.conn
        .execute(
            "UPDATE stories SET state = 'dropped' WHERE id = ?1",
            params![f.story_ids[1]],
        )
        .unwrap();
    run_mirror(&f.conn, &forge, fast());

    let log = forge.log();
    let new: Vec<_> = log[before..].to_vec();
    assert!(new.contains(&Write::Label("flywheel:merged".into())));
    assert!(new.contains(&Write::Label("flywheel:dropped".into())));
    assert!(new.iter().any(|w| matches!(w, Write::Edit { number: 101, add, remove, .. } if add == "flywheel:merged" && remove == "flywheel:ready")));
    assert!(new.contains(&Write::Close {
        number: 101,
        reason: CloseReason::Completed
    }));
    assert!(new.contains(&Write::Close {
        number: 102,
        reason: CloseReason::NotPlanned
    }));

    run_mirror(&f.conn, &forge, fast());
    assert_eq!(
        forge.log().len(),
        log.len(),
        "a closed issue owes nothing more"
    );
}

#[test]
fn a_record_in_shaping_is_not_mirrored() {
    let f = fixture();
    f.conn
        .execute(
            "UPDATE stories SET state = 'shaping' WHERE id = ?1",
            params![f.story_ids[1]],
        )
        .unwrap();
    let forge = FakeIssueForge::new(100);
    run_mirror(&f.conn, &forge, fast());
    assert_eq!(number_of(&f.conn, "stories", &f.story_ids[1]), None);
    assert_eq!(
        forge
            .log()
            .iter()
            .filter(|w| matches!(w, Write::Create { .. }))
            .count(),
        2
    );
}
