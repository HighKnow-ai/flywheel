//! The roadmap packet (docs/mvp-spec.md §3 "The Round's packet", issue #133): everything a roadmap
//! Round's session starts from, read off the board and the project's checkout.
//!
//! Stable parts first, so prompt caching works: the standing instructions, ending on the one line its
//! trigger asks for (issue #134: an Epic confirmed Done keeps it short and on its Milestone); every Milestone in Roadmap
//! order with its state and exit test, and the Epics under each with their state and exit test; the
//! ADR index; the triggering event; the Roadmap Proposals the developer rejected, with their reasons.
//! Then the closing instruction, which says what this session does next: propose or say the Roadmap
//! holds, or wait on the Proposals an earlier session filed in the open Round.
//!
//! It reads no Story detail and no diff: a Story's title, criteria, Tasks and code never reach it.
//!
//! Deterministic by construction: the same board state and the same checkout give a byte-identical
//! packet. Every list is read in a fixed order (rank then id, file name, creation time then id) and
//! nothing reads the clock.

use std::fmt::Write as _;
use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::context_packet::{live_adrs, non_blank, section};
use crate::domain::milestone::{milestone_state, roadmap};
use crate::domain::proposal::proposals_in_round;
use crate::domain::roadmap_round::{
    describe_proposal, noted_triggers, open_roadmap_round, rejected_roadmap_proposals, RoadmapTrigger,
};

/// The standing instructions for a roadmap Round.
const STANDING_INSTRUCTIONS: &str = "\
You are revisiting the Roadmap of one project on a Flywheel board with the developer. The Roadmap is the \
ordered list of Milestones; each Milestone is an outcome with an exit test and no date, and holds Epics. \
The Current Milestone is the first one that is neither Done nor Dropped. This packet is everything you \
start from: it is rebuilt from the board for every session.

This is a roadmap Round, the only time an agent speaks up about the Roadmap unprompted. Something \
triggered it; the trigger is below. Your job is to judge whether the Roadmap still holds in the light of \
it. What to ask depends on the trigger; this Round's scope follows these instructions.

You are read-only. You may read the repository (Read, Glob, Grep) and you change nothing in it. You \
change the Roadmap only through Proposals, which do nothing until the developer accepts them.

Answer in exactly one of two ways:

- If the Roadmap still holds, call `roadmap_holds` with one line on why. That closes the Round with a \
\"Roadmap still holds\" line on the timeline. Then end your session.
- Otherwise propose each change with `propose_roadmap_change`, one call per change, each with one line \
on why: `create_milestone` (title, exit_test), `amend_milestone` (milestone_id, a new title and/or \
exit_test), `reorder_milestone` (milestone_id, before_milestone_id, or null for the end), \
`retire_milestone` (milestone_id), `add_epic` (title, problem, and milestone_id, which defaults to the \
Milestone after the Current one) or `drop_epic` (epic_id). Use the ids shown in this packet. Each change \
shows on the Roadmap strip as a ghost row the developer accepts, amends or rejects. When you have proposed \
everything, call `round_wait`: it waits until the developer has decided every Proposal, then answers with \
each decision. Then end your session.

Propose only what the trigger and the board give you reason for; a Roadmap that holds is a good answer. \
A Done Milestone is frozen: put later changes in a new Milestone. A Milestone holding an open Epic cannot \
be retired, and an Epic holding an open Story cannot be dropped. Do not propose again a change the \
developer rejected, listed below, without new evidence.
";

/// The Round's scope, from its trigger and any noted since (issue #134, docs/mvp-spec.md §3 "its three
/// triggers"): a Milestone confirmed Done makes it a Roadmap Round; Epics confirmed Done alone keep it
/// short, on their Milestones; Revisit roadmap weighs the whole Roadmap.
fn scope_line(conn: &Connection, trigger: &RoadmapTrigger, noted: &[RoadmapTrigger]) -> anyhow::Result<String> {
    let all: Vec<&RoadmapTrigger> = std::iter::once(trigger).chain(noted).collect();
    if all.iter().any(|t| matches!(t, RoadmapTrigger::MilestoneDone(_))) {
        return Ok("This is a Roadmap Round: a Milestone is Done. Weigh the whole Roadmap: is the next Milestone \
                   still right? Should Milestones be reordered, amended, retired or added, and is each exit test \
                   still reachable and observable?\n"
            .to_string());
    }
    if matches!(trigger, RoadmapTrigger::Revisit) {
        return Ok("The developer asked for this Round. Weigh the whole Roadmap: is the next Milestone still right? \
                   Should Milestones be reordered, amended, retired or added, is each exit test still reachable and \
                   observable, is an Epic missing or one to drop?\n"
            .to_string());
    }
    let mut milestones: Vec<String> = Vec::new();
    for t in &all {
        if let RoadmapTrigger::EpicDone(id) = t {
            let title: String = conn
                .query_row("SELECT m.title FROM epics e JOIN milestones m ON m.id = e.milestone_id WHERE e.id = ?1", params![id], |r| r.get(0))
                .with_context(|| format!("Epic {id:?} not found"))?;
            let title = format!("\"{title}\"");
            if !milestones.contains(&title) {
                milestones.push(title);
            }
        }
    }
    let on = match milestones.as_slice() {
        [one] => format!("on one Milestone: {one}, which holds the Epic confirmed Done"),
        many => format!("on the Milestones {}, which hold the Epics confirmed Done", many.join(" and ")),
    };
    Ok(format!(
        "This Round is short, and {on}. Ask only: is its exit test still reachable, is an Epic missing, or one to \
         drop? Leave the rest of the Roadmap alone unless that Epic's outcome plainly changes it.\n"
    ))
}

/// The words for a Milestone or Epic state (GLOSSARY.md).
fn state_words(state: &str) -> &str {
    match state {
        "shaping" => "Shaping",
        "ready" => "Ready",
        "in_progress" => "In progress",
        "done" => "Done",
        "dropped" => "Dropped",
        other => other,
    }
}

/// `(id, key, title, state, exit_test)` of an Epic.
type EpicRow = (String, String, String, String, Option<String>);

/// Every Epic in `milestone_id`, by rank then id, In progress derived as the board derives it
/// (query/progress.rs).
fn epics_of(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<EpicRow>> {
    let mut stmt = conn.prepare(
        "SELECT e.id, e.key, e.title,
            CASE WHEN e.state = 'ready' AND EXISTS (SELECT 1 FROM stories s WHERE s.epic_id = e.id
                    AND s.state IN ('running', 'in_review', 'merged'))
                 THEN 'in_progress' ELSE e.state END,
            e.exit_test
         FROM epics e WHERE e.milestone_id = ?1 ORDER BY e.rank, e.id",
    )?;
    let rows = stmt
        .query_map(params![milestone_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Milestone's Epics")?;
    Ok(rows)
}

/// Build the packet a roadmap session on `project_id` starts from. Refused when the project has no
/// open roadmap Round: the packet answers its trigger.
pub fn build_roadmap_packet(conn: &Connection, project_id: &str) -> anyhow::Result<String> {
    let (name, repo_path): (String, String) = conn
        .query_row("SELECT name, repo_path FROM projects WHERE id = ?1", params![project_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .with_context(|| format!("project {project_id:?} not found"))?;
    let round = open_roadmap_round(conn, project_id)?.context("this project has no open roadmap Round")?;
    let checkout = PathBuf::from(repo_path);

    let mut out = String::new();
    writeln!(out, "# Roadmap packet: {name}")?;

    // 1. Standing instructions, then the line this Round's trigger asks for (issue #134)
    section(&mut out, "Standing instructions");
    out.push_str(STANDING_INSTRUCTIONS);
    let noted = noted_triggers(conn, &round.id)?;
    out.push('\n');
    out.push_str(&scope_line(conn, &round.trigger, &noted)?);
    out.push('\n');

    // 2. Every Milestone in order, with the Epics under each
    section(&mut out, "Roadmap");
    let milestones = roadmap(conn, project_id)?;
    if milestones.is_empty() {
        out.push_str("No Milestone yet: the Roadmap is empty.\n");
    }
    let current = milestones.iter().find(|m| m.state != "done" && m.state != "dropped").map(|m| m.id.clone());
    for (i, m) in milestones.iter().enumerate() {
        let state = milestone_state(conn, &m.id)?;
        let marker = if current.as_deref() == Some(m.id.as_str()) { ", Current Milestone" } else { "" };
        writeln!(out, "\n{}. Milestone \"{}\" ({}{marker}) [milestone_id: {}]", i + 1, m.title, state_words(state.as_str()), m.id)?;
        writeln!(out, "   Exit test: {}", non_blank(&m.exit_test).unwrap_or("not written"))?;
        let epics = epics_of(conn, &m.id)?;
        if epics.is_empty() {
            out.push_str("   Epics: none\n");
        } else {
            out.push_str("   Epics:\n");
            for (id, key, title, state, exit) in epics {
                writeln!(
                    out,
                    "   - {key} {title} ({}) [epic_id: {id}]. Exit test: {}",
                    state_words(&state),
                    non_blank(&exit).unwrap_or("not written")
                )?;
            }
        }
    }

    // 3. The ADR index, from the project's checkout
    section(&mut out, "ADRs");
    let adrs = live_adrs(&checkout.join("docs").join("adr"));
    if adrs.is_empty() {
        out.push_str("No live ADRs in `docs/adr/`.\n");
    } else {
        out.push_str("Every live ADR in the project, superseded ones left out:\n");
        for adr in &adrs {
            writeln!(out, "- {}: {}", adr.path, adr.title)?;
        }
    }

    // 4. The triggering event
    section(&mut out, "Trigger");
    writeln!(out, "Roadmap Round {}. {}", round.number, round.note)?;
    if !noted.is_empty() {
        out.push_str("\nSince it opened:\n");
        for trigger in &noted {
            writeln!(out, "- {}", trigger.describe(conn)?)?;
        }
        out.push_str("Weigh these too: each came while this Round was open, so no Round of its own opened.\n");
    }

    // 5. Rejected Roadmap Proposals, with their reasons
    section(&mut out, "Rejected Roadmap Proposals");
    let rejected = rejected_roadmap_proposals(conn, project_id)?;
    if rejected.is_empty() {
        out.push_str("None.\n");
    } else {
        out.push_str("The developer rejected these; do not propose them again without new evidence:\n");
        for line in rejected {
            writeln!(out, "- {line}")?;
        }
    }

    // 6. Closing instruction: what this session does next
    section(&mut out, "Closing instruction");
    let filed = proposals_in_round(conn, &round.id)?;
    if filed.is_empty() {
        out.push_str(
            "Read the Roadmap above, and whatever in the repository and the ADRs the trigger touches. Then either \
             call `roadmap_holds`, or propose each change with `propose_roadmap_change` and call `round_wait`.\n",
        );
    } else {
        writeln!(out, "An earlier session filed these Proposals in Round {} and has ended:", round.number)?;
        for p in &filed {
            let state = match (p.state.as_str(), &p.rejection_reason) {
                ("pending", _) => "undecided".to_string(),
                ("rejected", Some(reason)) => format!("rejected: {reason}"),
                (state, _) => state.to_string(),
            };
            writeln!(out, "- {} ({state})", describe_proposal(conn, p))?;
        }
        out.push_str(
            "\nPropose anything still missing with `propose_roadmap_change`, then call `round_wait`: it waits until \
             the developer has decided every Proposal of this Round (at once if they already have), then answers \
             with each decision. Do not propose these again.\n",
        );
    }
    Ok(out)
}
