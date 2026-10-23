//! The Story agent's Proposal tools (docs/mvp-spec.md §5, issue #160): how a running Story tells the
//! board what it learned. The sidecar's MCP server hosts both, relays each call to the Rust core over
//! IPC as a `board_tool_request`, and never opens the database; this module is what the core runs, the
//! Story sibling of `shaping_tool.rs`.
//!
//! `propose` files one Proposal of a `kind`, with the agent's one-line `why` and an `evidence` line,
//! and is answered AT ONCE: a Proposal never pauses the agent. The six kinds reuse the payloads the
//! shaping tools already file, so accepting one runs the same writer (`proposal_apply`):
//!
//! | Kind | Proposal | Payload |
//! |---|---|---|
//! | `new_story` | create story, on the session's Epic | [`NewStory`], at the end of the order |
//! | `amend_criterion` | amend criterion (target: it) | [`AmendCriterion`] |
//! | `amend_epic_spec` | amend epic (target: the session's Epic) | [`SpecChange`] |
//! | `reorder_story` | reorder story (target: it) | its new `rank` |
//! | `retire_story` | retire story (target: it) | none |
//! | `new_epic` | create epic, after the Current Milestone | [`RoadmapChange::AddEpic`] |
//!
//! A session holds at most [`OPEN_PROPOSALS_PER_SESSION`] open Proposals; the 4th is refused, naming
//! `proposal_withdraw`, which takes one of the session's own pending Proposals back and frees its slot.
//! There is no merge verb: to merge two, withdraw both and file the combined one.
//!
//! Identity comes from the session the call arrived on, never from an argument: a call lands only on
//! the session's own Epic and the Stories in it, only while the session is live, and never from a
//! shaping session, which has its own Proposal tools. A Story is retired only before it starts (Shaping
//! or Ready); a started Story is the developer's to drop.

use anyhow::Context;
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::domain::acceptance_criterion::get_criterion;
use crate::domain::proposal::{
    file_proposal_with_evidence, open_proposals_in_session, withdraw_proposal, NewProposal, ProposalTarget, ProposalVerb,
    OPEN_PROPOSALS_PER_SESSION,
};
use crate::domain::proposal_apply::{
    AmendCriterion, NewStory, RoadmapChange, SpecChange, MAX_ROADMAP_TEXT_LEN, MAX_ROADMAP_TITLE_LEN, MAX_STORY_DESCRIPTION_LEN,
    MAX_STORY_TITLE_LEN,
};
use crate::domain::roadmap_round::milestone_after_current;
use crate::domain::session::{agent_actor_id, story_session};
use crate::domain::shaping_tool::{epic_order, one_line, place_of, rank_for, why_field, OrderItem, Place};
use crate::domain::story::{get_story, stories_in_epic, Story, StoryState};

/// The tool names the sidecar's MCP server registers for a Story session, after the Task and hand-off
/// tools. Mirrored by `STORY_PROPOSAL_TOOL_NAMES` in `packages/sidecar/src/mcp-permission-server.ts`.
pub const STORY_PROPOSAL_TOOL_NAMES: [&str; 2] = ["propose", "proposal_withdraw"];

/// The `kind`s `propose` takes, in the order the tool lists them.
pub const PROPOSAL_KINDS: [&str; 6] = ["new_story", "amend_criterion", "amend_epic_spec", "reorder_story", "retire_story", "new_epic"];

/// The longest an evidence line may be.
pub const MAX_EVIDENCE_LEN: usize = 1_000;

/// One Proposal as `propose` gives it, its Story references not resolved yet.
#[derive(Debug, Clone, PartialEq)]
pub enum StoryProposal {
    /// A follow-up Story in the session's Epic, at the end of its order.
    NewStory { title: String, description: Option<String> },
    AmendCriterion(AmendCriterion),
    /// New text for one field of the session's Epic.
    AmendEpicSpec(SpecChange),
    /// Move a Story of the Epic (its key) in the execution order.
    ReorderStory { story: String, place: Place },
    /// Retire a Story of the Epic (its key) that has not started.
    RetireStory { story: String },
    /// A new Epic, after the Current Milestone.
    NewEpic { title: String, problem: Option<String> },
}

impl StoryProposal {
    /// The `kind` the tool names it by.
    pub fn kind(&self) -> &'static str {
        match self {
            StoryProposal::NewStory { .. } => "new_story",
            StoryProposal::AmendCriterion(_) => "amend_criterion",
            StoryProposal::AmendEpicSpec(_) => "amend_epic_spec",
            StoryProposal::ReorderStory { .. } => "reorder_story",
            StoryProposal::RetireStory { .. } => "retire_story",
            StoryProposal::NewEpic { .. } => "new_epic",
        }
    }
}

/// One parsed call of a Story's Proposal tool.
#[derive(Debug, Clone, PartialEq)]
pub enum StoryProposalCall {
    Propose { proposal: StoryProposal, why: String, evidence: String },
    Withdraw { proposal_id: String },
}

/// A trimmed, non-blank string argument of at most `max` characters, or `None`.
fn optional_text(args: &Value, name: &str, tool: &str, max: usize) -> anyhow::Result<Option<String>> {
    let Some(raw) = args.get(name).filter(|v| !v.is_null()) else { return Ok(None) };
    let text = raw.as_str().with_context(|| format!("{tool}: `{name}` is not a string"))?.trim();
    anyhow::ensure!(text.chars().count() <= max, "{tool}: `{name}` is at most {max} characters");
    Ok((!text.is_empty()).then(|| text.to_string()))
}

fn required_text(args: &Value, name: &str, tool: &str, max: usize) -> anyhow::Result<String> {
    optional_text(args, name, tool, max)?.with_context(|| format!("{tool}: `{name}` is missing or empty"))
}

impl StoryProposalCall {
    /// Parse a call from the tool name and its JSON arguments, refusing anything malformed before any
    /// write happens.
    pub fn parse(tool: &str, args: &Value) -> anyhow::Result<Self> {
        match tool {
            "propose" => {
                let kind = args
                    .get("kind")
                    .and_then(Value::as_str)
                    .with_context(|| format!("propose: `kind` is missing: one of {}", PROPOSAL_KINDS.join(", ")))?;
                let proposal = match kind {
                    "new_story" => StoryProposal::NewStory {
                        title: required_text(args, "title", tool, MAX_STORY_TITLE_LEN)?,
                        description: optional_text(args, "description", tool, MAX_STORY_DESCRIPTION_LEN)?,
                    },
                    "amend_criterion" => StoryProposal::AmendCriterion(
                        AmendCriterion::from_payload(args).map_err(|e| e.context("propose amend_criterion"))?,
                    ),
                    "amend_epic_spec" => {
                        StoryProposal::AmendEpicSpec(SpecChange::from_payload(args).map_err(|e| e.context("propose amend_epic_spec"))?)
                    }
                    "reorder_story" => StoryProposal::ReorderStory {
                        story: required_text(args, "story", tool, MAX_STORY_TITLE_LEN)?,
                        place: place_of(args, tool)?,
                    },
                    "retire_story" => StoryProposal::RetireStory { story: required_text(args, "story", tool, MAX_STORY_TITLE_LEN)? },
                    "new_epic" => StoryProposal::NewEpic {
                        title: required_text(args, "title", tool, MAX_ROADMAP_TITLE_LEN)?,
                        problem: optional_text(args, "problem", tool, MAX_ROADMAP_TEXT_LEN)?,
                    },
                    other => anyhow::bail!("propose: `kind` is {other:?}; use one of {}", PROPOSAL_KINDS.join(", ")),
                };
                Ok(StoryProposalCall::Propose {
                    proposal,
                    why: why_field(args, tool)?,
                    evidence: one_line(args, "evidence", tool, MAX_EVIDENCE_LEN)?,
                })
            }
            "proposal_withdraw" => {
                Ok(StoryProposalCall::Withdraw { proposal_id: required_text(args, "proposal_id", tool, 100)? })
            }
            other => anyhow::bail!("{other:?} is not a Story Proposal tool"),
        }
    }
}

/// What a call left behind: the answer for the agent, and the project whose board changed.
#[derive(Debug, Clone, PartialEq)]
pub struct StoryProposalOutcome {
    pub project_id: String,
    pub result: Value,
}

/// The live Story session `session_id`: `(its Story, its project)`. Refused for an unknown, ended or
/// shaping session.
fn live_story(conn: &Connection, session_id: &str) -> anyhow::Result<(Story, String)> {
    let (story_id, project_id, status) = story_session(conn, session_id)?;
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer file or withdraw a Proposal"
    );
    let story = get_story(conn, &story_id)?.with_context(|| format!("Story {story_id:?} not found"))?;
    Ok((story, project_id))
}

/// A Story of Epic `epic_id`, by its key (or id).
fn story_of_epic(conn: &Connection, epic_id: &str, reference: &str, tool: &str) -> anyhow::Result<Story> {
    stories_in_epic(conn, epic_id)?
        .into_iter()
        .find(|s| s.key.eq_ignore_ascii_case(reference) || s.id == reference)
        .with_context(|| format!("{tool}: {reference:?} is not a Story of this Epic; name one by its key, such as FLY-12"))
}

/// The Proposal a kind files, its references resolved against the session's own Epic.
fn to_new_proposal<'a>(
    conn: &Connection,
    epic_id: &'a str,
    proposal: &StoryProposal,
) -> anyhow::Result<(ProposalVerb, ProposalTarget, Option<String>, Option<&'a str>, Value)> {
    let tool = "propose";
    Ok(match proposal {
        StoryProposal::NewStory { title, description } => {
            let story = NewStory { title: title.clone(), description: description.clone(), rank: None, runs_after: None };
            (ProposalVerb::Create, ProposalTarget::Story, None, Some(epic_id), story.to_payload())
        }
        StoryProposal::AmendCriterion(change) => {
            let criterion = get_criterion(conn, &change.criterion_id)?;
            let story = criterion.as_ref().map(|c| get_story(conn, &c.story_id)).transpose()?.flatten();
            let story = story.filter(|s| s.epic_id == epic_id).with_context(|| {
                format!("{tool}: {:?} is not a criterion of this Epic; amend a criterion of a Story in it", change.criterion_id)
            })?;
            anyhow::ensure!(
                !StoryState::parse(&story.state)?.is_closed(),
                "{tool}: {} is {}; a closed Story's criteria stay as they are",
                story.key,
                story.state
            );
            (ProposalVerb::Amend, ProposalTarget::Criterion, Some(change.criterion_id.clone()), Some(epic_id), change.to_payload())
        }
        StoryProposal::AmendEpicSpec(change) => {
            (ProposalVerb::Amend, ProposalTarget::Epic, Some(epic_id.to_string()), Some(epic_id), change.to_payload())
        }
        StoryProposal::ReorderStory { story, place } => {
            let s = story_of_epic(conn, epic_id, story, tool)?;
            anyhow::ensure!(!StoryState::parse(&s.state)?.is_closed(), "{tool}: {} is {}; a closed Story keeps its place", s.key, s.state);
            let order: Vec<OrderItem> = epic_order(conn, epic_id)?.into_iter().filter(|i| i.id != s.id).collect();
            let rank = rank_for(conn, epic_id, &order, place, tool)?;
            (ProposalVerb::Reorder, ProposalTarget::Story, Some(s.id), Some(epic_id), json!({ "rank": rank }))
        }
        StoryProposal::RetireStory { story } => {
            let s = story_of_epic(conn, epic_id, story, tool)?;
            anyhow::ensure!(
                s.state == "shaping" || s.state == "ready",
                "{tool}: {} is {}; only a Story not started yet (Shaping or Ready) is retired. A started Story is the \
                 developer's to drop: say so in your hand-off",
                s.key,
                s.state
            );
            (ProposalVerb::Retire, ProposalTarget::Story, Some(s.id), Some(epic_id), json!({}))
        }
        StoryProposal::NewEpic { title, problem } => {
            let project: String = conn.query_row("SELECT project_id FROM epics WHERE id = ?1", [epic_id], |r| r.get(0))?;
            let milestone_id = milestone_after_current(conn, &project)?.with_context(|| {
                format!("{tool}: there is no open Milestone after the Current one to take a New Epic; say so in your hand-off instead")
            })?;
            let change = RoadmapChange::AddEpic { milestone_id, title: title.clone(), problem: problem.clone() };
            let (verb, target, _, payload) = change.to_proposal();
            // A New Epic lands on the Roadmap, never on the session's Epic.
            (verb, target, None, None, payload)
        }
    })
}

/// What the agent is told its Proposal now does, by kind.
fn where_it_waits(proposal: &StoryProposal) -> &'static str {
    match proposal {
        StoryProposal::AmendCriterion(_) | StoryProposal::AmendEpicSpec(_) => {
            "It changes what Stories are judged on, so it reaches the developer at once, with a before and after."
        }
        StoryProposal::NewEpic { .. } => "It waits for the developer on the Roadmap, after the Current Milestone.",
        _ => "It waits for the developer with this Epic's other Proposals.",
    }
}

/// Run one call for session `session_id`, writing as the agent actor. Refused when the session is
/// unknown, ended or a shaping session, and when the call reaches past the session's own Epic.
pub fn apply_story_proposal_call(conn: &mut Connection, session_id: &str, call: &StoryProposalCall) -> anyhow::Result<StoryProposalOutcome> {
    let (story, project_id) = live_story(conn, session_id)?;
    let agent = agent_actor_id(conn)?;
    match call {
        StoryProposalCall::Propose { proposal, why, evidence } => {
            let (verb, target, target_id, epic_id, payload) =
                to_new_proposal(conn, &story.epic_id, proposal)?;
            let filed = file_proposal_with_evidence(
                conn,
                &agent,
                &NewProposal {
                    project_id: &project_id,
                    session_id: Some(session_id),
                    epic_id,
                    verb,
                    target,
                    target_id: target_id.as_deref(),
                    payload,
                    rationale: Some(why),
                },
                Some(evidence),
            )?;
            let open = open_proposals_in_session(conn, session_id)?;
            Ok(StoryProposalOutcome {
                result: json!({
                    "proposal_id": filed.id,
                    "kind": proposal.kind(),
                    "state": "pending",
                    "open": open,
                    "cap": OPEN_PROPOSALS_PER_SESSION,
                    "next": format!(
                        "Filed. {} Nothing changes until they accept it. You hold {open} of {OPEN_PROPOSALS_PER_SESSION} open \
                         Proposals; withdraw one with proposal_withdraw to free a slot. Keep working on your Story: do not \
                         wait for the decision.",
                        where_it_waits(proposal)
                    ),
                }),
                project_id,
            })
        }
        StoryProposalCall::Withdraw { proposal_id } => {
            let withdrawn = withdraw_proposal(conn, &agent, session_id, proposal_id)?;
            let open = open_proposals_in_session(conn, session_id)?;
            Ok(StoryProposalOutcome {
                result: json!({
                    "proposal_id": withdrawn.id,
                    "state": "withdrawn",
                    "open": open,
                    "cap": OPEN_PROPOSALS_PER_SESSION,
                    "next": format!("Withdrawn. You hold {open} of {OPEN_PROPOSALS_PER_SESSION} open Proposals."),
                }),
                project_id,
            })
        }
    }
}
