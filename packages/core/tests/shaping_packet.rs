//! The shaping packet (docs/mvp-spec.md §3, issue #122): what a shaping session on an Epic starts
//! from, read off the board and the project's checkout. These tests pin its order, its determinism
//! and what it carries: the standing shaping instructions, the Milestone line, the Epic spec, the
//! ADR index (superseded ADRs left out), the glossary path and the sibling Epics.

mod common;

use std::path::Path;

use core::domain::epic::{create_epic, set_epic_state, update_epic, EpicSpec, EpicState};
use core::domain::milestone::create_milestone;
use core::domain::project::create_project;
use core::shaping_packet::build_epic_shaping_packet;
use rusqlite::Connection;

const SECTION_HEADINGS: [&str; 6] = [
    "## Standing instructions",
    "## Milestone and Epic",
    "## ADRs",
    "## Sibling Epics",
    "## Rounds",
    "## Closing instruction",
];

fn write(dir: &Path, rel: &str, body: &str) {
    let path = dir.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
}

struct Fixture {
    conn: Connection,
    actor_id: String,
    epic_id: String,
    repo: tempfile::TempDir,
}

/// A project whose checkout holds two ADRs (one superseding the other) and a glossary; a Milestone
/// with an exit test holding the Epic under shaping (with a spec) and two sibling Epics.
fn fixture() -> Fixture {
    let repo = tempfile::tempdir().unwrap();
    write(repo.path(), "docs/adr/0001-store-in-json.md", "# Store the board in JSON\n\nStatus: superseded by ADR-0002\n");
    write(repo.path(), "docs/adr/0002-store-in-sqlite.md", "# Store the board in SQLite\n\nSupersedes ADR-0001\n");
    write(repo.path(), "GLOSSARY.md", "# Glossary\n");

    let dir = common::scratch_dir();
    let mut conn =
        core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups")).unwrap();
    std::mem::forget(dir);
    let actor_id = core::domain::actor::local_human_actor_id(&conn).unwrap();
    let project =
        create_project(&mut conn, &actor_id, "Threadfin", &repo.path().to_string_lossy(), "FLY", "main").unwrap();
    let m = create_milestone(&mut conn, &project.id, &actor_id, "Shaping", Some("An idea becomes Ready Stories")).unwrap();
    let before = create_epic(&mut conn, &actor_id, &m.id, "Board model").unwrap();
    set_epic_state(&mut conn, &actor_id, &before.id, EpicState::Ready).unwrap();
    let epic = create_epic(&mut conn, &actor_id, &m.id, "Epic shaping").unwrap();
    create_epic(&mut conn, &actor_id, &m.id, "Roadmap shaping").unwrap();
    update_epic(
        &mut conn,
        &actor_id,
        &epic.id,
        "Epic shaping",
        &EpicSpec {
            problem: Some("Shaping in the app was worse than in a terminal.".into()),
            scope: Some("The board as the shaping surface.".into()),
            out_of_scope: Some("Milestone shaping.".into()),
            exit_test: Some("A one-line idea becomes an Epic with Ready Stories.".into()),
        },
    )
    .unwrap();
    Fixture { conn, actor_id, epic_id: epic.id, repo }
}

#[test]
fn the_packet_is_byte_identical_for_the_same_board_state() {
    let f = fixture();
    let first = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let second = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert_eq!(first, second);
}

#[test]
fn the_sections_come_in_a_fixed_order_stable_parts_first() {
    let f = fixture();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let positions: Vec<usize> =
        SECTION_HEADINGS.iter().map(|h| packet.find(h).unwrap_or_else(|| panic!("missing {h}:\n{packet}"))).collect();
    assert!(positions.windows(2).all(|w| w[0] < w[1]), "out of order:\n{packet}");
    assert!(packet.starts_with("# Shaping packet: Epic FLY-2 Epic shaping\n"), "{packet}");
}

#[test]
fn the_packet_carries_the_shaping_instructions() {
    let f = fixture();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    for line in [
        "design tree",
        "frontier",
        "recommended answer",
        "Word each question so \"yes\" accepts your recommended answer.",
        "Finding facts is your job, never the developer's.",
        "Challenge the spec",
        "read-only",
        "Proposal",
    ] {
        assert!(packet.contains(line), "the standing instructions miss {line:?}:\n{packet}");
    }
}

/// Issue #123: a Round is posted on the board with `round_post`, never asked in the agent's reply,
/// and the agent knows the call waits for every answer.
#[test]
fn the_packet_tells_the_agent_to_post_each_round_with_round_post() {
    let f = fixture();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    for line in [
        "Post each Round with the `round_post` tool",
        "The call waits until the developer has answered every question",
        "Never ask a Round's questions in your reply",
    ] {
        assert!(packet.contains(line), "the standing instructions miss {line:?}:\n{packet}");
    }
    assert!(!packet.contains("Post a Round as your reply"), "the reply format is gone:\n{packet}");
    assert!(packet.contains("post the first Round of the Challenge the spec Stage with `round_post`"), "{packet}");
}

#[test]
fn the_packet_carries_the_milestone_line_and_the_epic_spec_in_full() {
    let f = fixture();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(packet.contains("Milestone: Shaping. Exit test: An idea becomes Ready Stories\n"), "{packet}");
    for field in [
        "Problem:\nShaping in the app was worse than in a terminal.",
        "Scope:\nThe board as the shaping surface.",
        "Out of scope:\nMilestone shaping.",
        "Exit test:\nA one-line idea becomes an Epic with Ready Stories.",
    ] {
        assert!(packet.contains(field), "missing {field:?}:\n{packet}");
    }
}

#[test]
fn an_unwritten_spec_field_says_so() {
    let f = fixture();
    // A one-line idea: an Epic with a title and nothing else yet.
    let packet = build_epic_shaping_packet(&f.conn, &epic_titled(&f.conn, "Roadmap shaping")).unwrap();
    for label in ["Problem", "Scope", "Out of scope", "Exit test"] {
        assert!(packet.contains(&format!("{label}:\n(not written)")), "{label}:\n{packet}");
    }
}

fn epic_titled(conn: &Connection, title: &str) -> String {
    conn.query_row("SELECT id FROM epics WHERE title = ?1", [title], |r| r.get(0)).unwrap()
}

#[test]
fn the_adr_index_lists_live_adrs_only_and_the_glossary_by_path() {
    let f = fixture();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(packet.contains("- docs/adr/0002-store-in-sqlite.md: Store the board in SQLite\n"), "{packet}");
    assert!(!packet.contains("0001-store-in-json"), "a superseded ADR is left out:\n{packet}");
    assert!(packet.contains("Glossary: `GLOSSARY.md`\n"), "{packet}");
}

#[test]
fn a_checkout_with_no_adrs_and_no_glossary_says_so() {
    let f = fixture();
    std::fs::remove_dir_all(f.repo.path().join("docs")).unwrap();
    std::fs::remove_file(f.repo.path().join("GLOSSARY.md")).unwrap();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(packet.contains("No live ADRs in `docs/adr/`.\n"), "{packet}");
    assert!(packet.contains("Glossary: no `GLOSSARY.md` yet.\n"), "{packet}");
}

#[test]
fn the_sibling_epics_are_the_milestones_other_epics_in_roadmap_order_with_their_state() {
    let f = fixture();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let siblings = &packet[packet.find("## Sibling Epics").unwrap()..packet.find("## Closing instruction").unwrap()];
    assert!(siblings.contains("- FLY-1 Board model (Ready)\n- FLY-3 Roadmap shaping (Shaping)\n"), "{siblings}");
    assert!(!siblings.contains("Epic shaping"), "the Epic under shaping is not its own sibling:\n{siblings}");
}

#[test]
fn the_packet_changes_when_the_spec_does() {
    let mut f = fixture();
    let before = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    update_epic(&mut f.conn, &f.actor_id, &f.epic_id, "Epic shaping", &EpicSpec { problem: Some("Changed.".into()), ..Default::default() })
        .unwrap();
    let after = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert_ne!(before, after);
    assert!(after.contains("Problem:\nChanged."));
}

#[test]
fn an_unknown_epic_is_an_error() {
    let f = fixture();
    assert!(build_epic_shaping_packet(&f.conn, "01ZZZZZZZZZZZZZZZZZZZZZZZZ").is_err());
}
