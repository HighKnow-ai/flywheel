//! The shaping packet (docs/mvp-spec.md §3, issue #122): everything a shaping session on an Epic
//! starts from, read off the board and the project's checkout. It is the shaping sibling of the
//! Context packet (`context_packet.rs`) and shares its helpers: a shaping session is rebuilt from
//! the record it shapes, so ending one loses nothing.
//!
//! Five sections in a fixed order, stable parts first so prompt caching works: the standing shaping
//! instructions; the Milestone line and the Epic spec in full, with the Proposals rejected on it;
//! the ADR index and the glossary path; the sibling Epics; the closing instruction.
//!
//! Deterministic by construction: the same board state and the same checkout give a byte-identical
//! packet. Every list is read in a fixed order (rank then id, file name, creation time then id) and
//! nothing reads the clock.
//!
//! A shaping session has no worktree (ADR 0002: repo knowledge reaches the repo only through a
//! Story's worktree), so the ADRs and the glossary are read from the project's own checkout.
//!
//! The standing instructions adapt the `grilling` skill of mattpocock/skills
//! (https://github.com/mattpocock/skills, MIT, Copyright (c) 2026 Matt Pocock). Its licence ships
//! as `LICENSES/mattpocock-skills.txt`, named in `NOTICE` (docs/mvp-spec.md §11).

use std::fmt::Write as _;
use std::path::PathBuf;

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::context_packet::{live_adrs, non_blank, rejected_proposals, section};
use crate::domain::adr_link::{adr_links_for_project, AdrLinkTarget};
use crate::domain::epic::get_epic;
use crate::domain::milestone::get_milestone;

/// The standing shaping instructions: the grilling prompt of mattpocock/skills, adapted to Rounds
/// on a Flywheel board, read-only sessions and the Epic's three Stages.
const STANDING_INSTRUCTIONS: &str = "\
You are shaping one Epic on a Flywheel board with the developer. This packet is everything you start \
from: it is rebuilt from the board for every session, so nothing from an earlier session's \
conversation reaches you except what is written here.

Shaping is read-only. You may read the repository (Read, Glob, Grep) and you change nothing in it. \
Anything that would change the board, an ADR or the glossary is a Proposal, which does nothing until \
the developer accepts it. Shaping never produces Tasks.

Grill the developer about this Epic until you reach a shared understanding. Map it as a design tree: \
every decision branches into the decisions that hang off it.

Work the tree in Rounds. The frontier is every decision whose prerequisites are already settled: the \
questions you can ask now without guessing at answers you have not heard yet. Ask the whole frontier \
in one Round, then wait for the developer's answers before the next Round. A Round is a one-paragraph \
note on what it settles, then the numbered questions. Each question carries a short title, a grounding \
line (what you read that raised it), your recommended answer and a one-line reason for it. Word each \
question so \"yes\" accepts your recommended answer.

Post each Round with the `round_post` tool. The developer answers it on the board, question by \
question, accepting your recommendation or writing their own, and every answer is saved as it is \
given. The call waits until the developer has answered every question, however long that takes, then \
answers with every answer in order. Never ask a Round's questions in your reply: a question asked \
there reaches nobody.

Each Round the developer answers reshapes the tree: settled decisions push the frontier outward and \
unblock the questions that hung on them. Recompute the frontier and ask the next Round. A question \
whose answer depends on another question still open in this Round belongs to a later Round.

Finding facts is your job, never the developer's. When a question needs a fact from the code, the \
ADRs in `docs/adr/` or the glossary, read it yourself; never ask the developer for anything you could \
look up. The decisions are the developer's: put each to them and wait.

Once answers settle how the Epic's Problem, Scope, Out of scope or Exit test should read, propose the \
new text with `propose_spec_change`: the field, its whole new text and one line on why. It is answered \
at once and shows on the Epic card as a Proposal the developer accepts, amends or rejects; nothing \
changes until they decide, so keep shaping without waiting for it.

An Epic is shaped in three Stages, one after another: challenge the spec, slice it into Stories, \
write the Acceptance criteria. The developer closes each Stage; nothing advances on its own. This \
session works the first Stage, Challenge the spec: probe the problem, the scope, what is out of scope \
and the exit test until each is clear, small enough to ship as one Epic and observable. Do not slice \
the Epic into Stories or write criteria yet.

The Stage is done when its frontier is empty: every branch of the tree visited, nothing left silently \
assumed. Say so, and leave closing the Stage to the developer.
";

const CLOSING_INSTRUCTION: &str = "\
Read the Epic above, then whatever in the repository, the ADRs and the glossary it touches. Then post \
the first Round of the Challenge the spec Stage with `round_post`.
";

/// The words for an Epic state (GLOSSARY.md "Epic state").
fn epic_state_words(state: &str) -> &str {
    match state {
        "shaping" => "Shaping",
        "ready" => "Ready",
        "in_progress" => "In progress",
        "done" => "Done",
        other => other,
    }
}

/// Build the packet a shaping session on `epic_id` starts from.
pub fn build_epic_shaping_packet(conn: &Connection, epic_id: &str) -> anyhow::Result<String> {
    let epic = get_epic(conn, epic_id)?.with_context(|| format!("Epic {epic_id:?} not found"))?;
    let milestone =
        get_milestone(conn, &epic.milestone_id)?.with_context(|| format!("Milestone {:?} not found", epic.milestone_id))?;
    let repo_path: String =
        conn.query_row("SELECT repo_path FROM projects WHERE id = ?1", params![epic.project_id], |r| r.get(0))?;
    let checkout = PathBuf::from(repo_path);

    let mut out = String::new();
    writeln!(out, "# Shaping packet: Epic {} {}", epic.key, epic.title)?;

    // 1. Standing instructions
    section(&mut out, "Standing instructions");
    out.push_str(STANDING_INSTRUCTIONS);

    // 2. Milestone (one line) and the Epic spec in full
    section(&mut out, "Milestone and Epic");
    match non_blank(&milestone.exit_test) {
        Some(exit) => writeln!(out, "Milestone: {}. Exit test: {}", milestone.title, exit)?,
        None => writeln!(out, "Milestone: {}. Exit test: none written", milestone.title)?,
    }
    writeln!(out, "\n### Epic {} {}", epic.key, epic.title)?;
    for (label, value) in [
        ("Problem", &epic.spec.problem),
        ("Scope", &epic.spec.scope),
        ("Out of scope", &epic.spec.out_of_scope),
        ("Exit test", &epic.spec.exit_test),
    ] {
        writeln!(out, "\n{label}:\n{}", non_blank(value).unwrap_or("(not written)"))?;
    }
    let rejected = rejected_proposals(conn, &epic.id)?;
    if !rejected.is_empty() {
        out.push_str("\nRejected Proposals on this Epic (do not propose these again without new evidence):\n");
        for line in rejected {
            writeln!(out, "- {line}")?;
        }
    }

    // 3. ADRs and the glossary, from the project's checkout
    section(&mut out, "ADRs");
    let adrs = live_adrs(&checkout.join("docs").join("adr"));
    let links = adr_links_for_project(conn, &epic.project_id)?;
    if adrs.is_empty() {
        out.push_str("No live ADRs in `docs/adr/`.\n");
    } else {
        out.push_str("Every live ADR in the project, superseded ones left out:\n");
        for adr in &adrs {
            let mut linked: Vec<&str> = links
                .iter()
                .filter(|l| l.path == adr.path)
                .filter_map(|l| match &l.target {
                    AdrLinkTarget::Epic(id) if *id == epic.id => Some("this Epic"),
                    AdrLinkTarget::Milestone(id) if *id == milestone.id => Some("this Milestone"),
                    _ => None,
                })
                .collect();
            linked.sort_unstable();
            linked.dedup();
            if linked.is_empty() {
                writeln!(out, "- {}: {}", adr.path, adr.title)?;
            } else {
                writeln!(out, "- {}: {} (linked to {})", adr.path, adr.title, linked.join(", "))?;
            }
        }
    }
    if checkout.join("GLOSSARY.md").is_file() {
        out.push_str("\nGlossary: `GLOSSARY.md`\n");
    } else {
        out.push_str("\nGlossary: no `GLOSSARY.md` yet.\n");
    }

    // 4. Sibling Epics: the Milestone's other Epics in Roadmap order, In progress derived as the
    // board derives it (query/progress.rs).
    section(&mut out, "Sibling Epics");
    let siblings = sibling_epics(conn, &epic.milestone_id, &epic.id)?;
    if siblings.is_empty() {
        out.push_str("None: this is the Milestone's only Epic.\n");
    }
    for (key, title, state) in siblings {
        writeln!(out, "- {key} {title} ({})", epic_state_words(&state))?;
    }

    // 5. Closing instruction
    section(&mut out, "Closing instruction");
    out.push_str(CLOSING_INSTRUCTION);
    Ok(out)
}

/// `(key, title, state)` of every other Epic in `milestone_id`, by rank then id.
fn sibling_epics(conn: &Connection, milestone_id: &str, epic_id: &str) -> anyhow::Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT e.key, e.title,
            CASE WHEN e.state = 'ready' AND EXISTS (SELECT 1 FROM stories s WHERE s.epic_id = e.id
                    AND s.state IN ('running', 'in_review', 'merged'))
                 THEN 'in_progress' ELSE e.state END
         FROM epics e WHERE e.milestone_id = ?1 AND e.id != ?2 ORDER BY e.rank, e.id",
    )?;
    let rows = stmt
        .query_map(params![milestone_id, epic_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the sibling Epics")?;
    Ok(rows)
}
