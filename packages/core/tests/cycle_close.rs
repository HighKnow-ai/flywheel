//! Phase 14 plan 14-06 (RECD-10, D-11): closing a Cycle decides every unfinished epic individually.
//! The load-bearing refusals live in the WRITER (`close_cycle`), so an IPC caller that skips the
//! dialog still cannot close a Cycle with an epic silently moved. Both directions of the authority
//! gate are asserted here, the way `authority_human_only.rs` does: a refusal for a non-human, and a
//! hard assertion that the human is not blocked.
//!
//! The DRFT-07 line, as `authoring_proposal.rs` words it: an item is decided individually, rather
//! than accepting the set wholesale. The command-layer assertions at the bottom read the command
//! module's source, since that is the surface an IPC caller sees.
//!
//! Self-contained per this repo's precedent: the only shared helper is `common::seeded_project`.

mod common;

use std::path::PathBuf;

use core::domain::actor::system_actor;
use core::domain::agent_run::agent_actor_id;
use core::domain::cycle::{
    active_cycle, assign_epic_to_cycle, close_cycle, create_cycle, cycle_roster, start_cycle, unfinished_epics,
    EpicChoice, EpicDisposition, CYCLE_ROSTER_CEILING,
};
use core::domain::epic::{create_epic, set_epic_status};
use rusqlite::Connection;

use common::seeded_project;

struct Fx {
    conn: Connection,
    actor_id: String,
    project_id: String,
}

impl Fx {
    fn new() -> Self {
        let (conn, actor_id, project) = seeded_project();
        Fx { conn, actor_id, project_id: project.id }
    }
    fn cycle(&mut self) -> String {
        create_cycle(&mut self.conn, &self.project_id, "Goal", &self.actor_id).unwrap().id
    }
    /// An epic in `cycle`, optionally finished.
    fn epic_in(&mut self, cycle: &str, title: &str, done: bool) -> String {
        let id = create_epic(&mut self.conn, &self.project_id, &self.actor_id, title, None).unwrap().id;
        assign_epic_to_cycle(&mut self.conn, &id, cycle, &self.actor_id).unwrap();
        if done {
            set_epic_status(&mut self.conn, &self.actor_id, &id, "done").unwrap();
        }
        id
    }
    fn close(&mut self, cycle: &str, choices: &[EpicChoice]) -> anyhow::Result<()> {
        let actor = self.actor_id.clone();
        close_cycle(&mut self.conn, cycle, choices, &actor)
    }
    fn state(&self, cycle: &str) -> String {
        self.conn.query_row("SELECT state FROM cycles WHERE id = ?1", [cycle], |r| r.get(0)).unwrap()
    }
    fn epic_cycle(&self, epic: &str) -> Option<String> {
        self.conn.query_row("SELECT cycle_id FROM epics WHERE id = ?1", [epic], |r| r.get(0)).unwrap()
    }
    fn events(&self) -> i64 {
        self.conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap()
    }
}

fn choice(epic: &str, d: EpicDisposition) -> EpicChoice {
    EpicChoice { epic_id: epic.to_string(), disposition: d }
}

#[test]
fn closing_as_the_system_actor_is_refused_and_changes_nothing() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    let system = system_actor(&fx.conn).unwrap().id;
    let events = fx.events();
    let err = close_cycle(&mut fx.conn, &c, &[], &system).expect_err("a system actor must be refused");
    assert!(format!("{err:#}").contains("only a human"), "error should name the human-only rule: {err:#}");
    assert_eq!(fx.state(&c), "planned");
    assert_eq!(fx.events(), events);
}

#[test]
fn closing_as_an_agent_actor_is_refused() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    let agent = agent_actor_id(&fx.conn).unwrap();
    close_cycle(&mut fx.conn, &c, &[], &agent).expect_err("an agent actor must be refused");
    assert_eq!(fx.state(&c), "planned");
}

#[test]
fn the_human_is_not_blocked_and_the_cycle_ends_closed() {
    // The other direction of the gate: a refusal that also locks the human out is a failure.
    let mut fx = Fx::new();
    let c = fx.cycle();
    fx.close(&c, &[]).expect("the human must be able to close a Cycle");
    assert_eq!(fx.state(&c), "closed");
}

#[test]
fn the_writer_refuses_a_missing_disposition_and_names_the_epic() {
    // The IPC path calls this function with whatever it is given: the refusal is not the dialog's.
    let mut fx = Fx::new();
    let c = fx.cycle();
    let a = fx.epic_in(&c, "Alpha", false);
    let b = fx.epic_in(&c, "Beta", false);
    let key_b: String = fx.conn.query_row("SELECT key FROM epics WHERE id = ?1", [&b], |r| r.get(0)).unwrap();
    let events = fx.events();
    let err = fx.close(&c, &[choice(&a, EpicDisposition::LeaveHere)]).expect_err("Beta has no disposition");
    let msg = format!("{err:#}");
    assert!(msg.contains(&key_b) && msg.contains("individually"), "should name the epic and the rule: {msg}");
    assert_eq!(fx.state(&c), "planned");
    assert_eq!(fx.epic_cycle(&a).as_deref(), Some(c.as_str()), "nothing was moved");
    assert_eq!(fx.events(), events, "a refused close appends nothing");
}

#[test]
fn each_disposition_lands_where_it_said() {
    let mut fx = Fx::new();
    let (c, later) = (fx.cycle(), fx.cycle());
    let (a, b, d) = (fx.epic_in(&c, "A", false), fx.epic_in(&c, "B", false), fx.epic_in(&c, "D", false));
    fx.close(
        &c,
        &[
            choice(&a, EpicDisposition::MoveTo(later.clone())),
            choice(&b, EpicDisposition::Unassign),
            choice(&d, EpicDisposition::LeaveHere),
        ],
    )
    .unwrap();
    assert_eq!(fx.epic_cycle(&a), Some(later));
    assert_eq!(fx.epic_cycle(&b), None);
    assert_eq!(fx.epic_cycle(&d), Some(c.clone()));
    assert_eq!(fx.state(&c), "closed");
}

#[test]
fn every_disposition_appends_its_own_event_naming_the_epic_and_the_choice() {
    let mut fx = Fx::new();
    let (c, later) = (fx.cycle(), fx.cycle());
    let (a, b, d) = (fx.epic_in(&c, "A", false), fx.epic_in(&c, "B", false), fx.epic_in(&c, "D", false));
    fx.close(
        &c,
        &[
            choice(&a, EpicDisposition::MoveTo(later)),
            choice(&b, EpicDisposition::Unassign),
            choice(&d, EpicDisposition::LeaveHere),
        ],
    )
    .unwrap();
    let mut stmt = fx
        .conn
        .prepare("SELECT epic_id, json_extract(payload, '$.choice') FROM events WHERE event_type = 'cycle.epic_disposed' ORDER BY epic_id")
        .unwrap();
    let got: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
    let mut want = vec![(a, "move_to"), (b, "unassign"), (d, "leave_here")];
    want.sort();
    let want: Vec<(String, String)> = want.into_iter().map(|(e, k)| (e, k.to_string())).collect();
    assert_eq!(got, want, "three separate decisions, not one bulk event");
    let closed: i64 = fx.conn.query_row("SELECT COUNT(*) FROM events WHERE event_type = 'cycle.closed'", [], |r| r.get(0)).unwrap();
    assert_eq!(closed, 1);
}

#[test]
fn a_closed_target_cycle_is_refused() {
    let mut fx = Fx::new();
    let (c, dead) = (fx.cycle(), fx.cycle());
    fx.close(&dead, &[]).unwrap();
    let a = fx.epic_in(&c, "A", false);
    fx.close(&c, &[choice(&a, EpicDisposition::MoveTo(dead))]).expect_err("a closed Cycle cannot receive work");
    assert_eq!(fx.state(&c), "planned");
    assert_eq!(fx.epic_cycle(&a).as_deref(), Some(c.as_str()));
}

#[test]
fn the_cycle_being_closed_is_not_a_target() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    let a = fx.epic_in(&c, "A", false);
    fx.close(&c, &[choice(&a, EpicDisposition::MoveTo(c.clone()))]).expect_err("moving into itself is refused");
    assert_eq!(fx.state(&c), "planned");
}

#[test]
fn a_cycle_whose_epics_are_all_finished_asks_nothing() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    fx.epic_in(&c, "Done one", true);
    assert!(unfinished_epics(&fx.conn, &c).unwrap().is_empty());
    fx.close(&c, &[]).expect("nothing to decide");
    assert_eq!(fx.state(&c), "closed");
}

#[test]
fn closing_an_already_closed_cycle_is_refused() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    fx.close(&c, &[]).unwrap();
    let events = fx.events();
    fx.close(&c, &[]).expect_err("a second close is refused, not repeated");
    assert_eq!(fx.events(), events);
}

#[test]
fn a_choice_for_an_epic_that_is_not_unfinished_in_this_cycle_is_refused() {
    let mut fx = Fx::new();
    let (c, other) = (fx.cycle(), fx.cycle());
    let finished = fx.epic_in(&c, "Finished", true);
    let elsewhere = fx.epic_in(&other, "Elsewhere", false);
    fx.close(&c, &[choice(&finished, EpicDisposition::Unassign)]).expect_err("a finished epic is not asked about");
    fx.close(&c, &[choice(&elsewhere, EpicDisposition::Unassign)]).expect_err("an epic of another Cycle is not ours");
    assert_eq!(fx.epic_cycle(&elsewhere).as_deref(), Some(other.as_str()));
}

#[test]
fn two_choices_for_one_epic_are_refused() {
    let mut fx = Fx::new();
    let c = fx.cycle();
    let a = fx.epic_in(&c, "A", false);
    fx.close(&c, &[choice(&a, EpicDisposition::Unassign), choice(&a, EpicDisposition::LeaveHere)])
        .expect_err("one epic, one answer");
    assert_eq!(fx.state(&c), "planned");
}

#[test]
fn a_closed_cycle_leaves_the_roster_and_frees_the_active_slot() {
    // `cycle_roster` reads planned and active Cycles only, so a closed one cannot consume the ceiling.
    let mut fx = Fx::new();
    let (c, keep) = (fx.cycle(), fx.cycle());
    start_cycle(&mut fx.conn, &c, &fx.actor_id.clone()).unwrap();
    fx.close(&c, &[]).unwrap();
    let roster = cycle_roster(&fx.conn, &fx.project_id).unwrap();
    let ids: Vec<&str> = roster.cycles.iter().map(|l| l.cycle.id.as_str()).collect();
    assert_eq!(ids, vec![keep.as_str()]);
    assert_eq!(roster.total, 1);
    assert!(!roster.truncated && roster.total < CYCLE_ROSTER_CEILING);
    assert!(active_cycle(&fx.conn, &fx.project_id).unwrap().is_none());
    start_cycle(&mut fx.conn, &keep, &fx.actor_id.clone()).expect("the next Cycle can now start");
}

// ---- the command layer: what an IPC caller can and cannot say ----

fn command_source() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../desktop/src-tauri/src/commands/cycle.rs");
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

fn code_lines(src: &str) -> String {
    src.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
}

#[test]
fn the_ipc_command_resolves_the_actor_itself_and_accepts_none_from_the_webview() {
    let src = code_lines(&command_source());
    let sig_start = src.find("pub fn cycle_close(").expect("a cycle_close command exists");
    let sig = &src[sig_start..sig_start + src[sig_start..].find(") ->").expect("signature end")];
    assert!(!sig.contains("actor"), "the webview must not name the actor: {sig}");
    assert!(src[sig_start..].contains("local_human_actor_id"), "the command resolves the actor from the store");
    assert!(src[sig_start..].contains("close_cycle"), "and routes through the writer that refuses");
}

#[test]
fn the_ipc_dto_has_no_shape_that_applies_one_choice_to_many_epics() {
    let src = code_lines(&command_source());
    let lower = src.to_lowercase();
    for banned in ["epic_ids", "apply_to_all", "applytoall", "select_all", "selectall", "\"all\""] {
        assert!(!lower.contains(banned), "DRFT-07: no control accepts a set wholesale ({banned})");
    }
    assert!(src.contains("Vec<EpicChoiceDto>"), "one entry per epic, each carrying its own choice");
}
