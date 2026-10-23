//! The shaping session's board tools (docs/mvp-spec.md §3, issue #123): the one way a shaping
//! session writes to the board besides Proposals. The sidecar's MCP server hosts each tool, relays
//! every call to the Rust core over IPC as a held `board_tool_request`, and never opens the
//! database; this module is what the core runs, the shaping sibling of `task_tool.rs`.
//!
//! `round_post` posts a Round of numbered questions into the open Stage of the record being shaped.
//! Its call is HELD: the core answers it only once the developer has answered the last question in
//! the Round (`round::answer_round_question` hands back a [`crate::domain::round::RoundRelease`]),
//! so the session waits on the developer for as long as it takes. A refused call is answered at once
//! with the reason, so the agent can correct it.
//!
//! `round_wait` (issue #124) is a later session's way back onto a Round its killed predecessor left
//! open: it takes the open Round over and is HELD the same way, answered once the last question is
//! answered, or at once when the Round is already complete.
//!
//! `propose_spec_change` (issue #125) files a Proposal to rewrite one field of the Epic being shaped
//! and is answered AT ONCE: a Proposal never holds the agent. The developer decides it on the Epic
//! card, where it shows as a ghost field (`proposal::accept_proposal` applies it).
//!
//! `propose_roadmap_change` and `roadmap_holds` (issue #133) are a roadmap session's: the first files
//! one Roadmap change on the project's open roadmap Round and is answered at once; the second closes
//! the Round with "Roadmap still holds". In a roadmap session `round_wait` is held until every
//! Proposal of the Round is decided (`roadmap_round::wait_roadmap_round`), and `round_post` is refused:
//! a roadmap Round asks no numbered questions.
//!
//! `propose_story` and `propose_story_order` (issue #127) slice the Epic: a New Story at its place
//! in the execution order, with what it runs after and why, and a move or a retirement of a Story
//! already on it. Both are answered AT ONCE too. A New Story's rank is worked out when it is filed,
//! so its ghost column stands where the Story would land; it is created only once accepted
//! (`proposal_apply`).
//!
//! `propose_exit_test` (issue #132) is the Milestone's sibling of `propose_spec_change`: in a shaping
//! session on a Milestone it files an Amend Milestone Proposal carrying only the new exit test (the
//! Roadmap change's own kind, so `proposal_apply` applies it the same way), answered AT ONCE, and shown
//! as a ghost over the exit test.
//!
//! Identity comes from the session the call arrived on, never from an argument: a call reaches only
//! that session's own subject, and only while the session is live.

use anyhow::Context;
use rusqlite::Connection;
use serde_json::Value;

use rusqlite::OptionalExtension;

use crate::domain::proposal::{file_proposal, proposals_on_epic, NewProposal, ProposalTarget, ProposalVerb};
use crate::domain::proposal_apply::{
    NewStory, RoadmapChange, RunsAfter, SpecChange, MAX_ROADMAP_TEXT_LEN, MAX_RUNS_AFTER_REASON_LEN, MAX_STORY_DESCRIPTION_LEN,
    MAX_STORY_TITLE_LEN,
};
use crate::domain::roadmap_round::{propose_roadmap_change, roadmap_holds, wait_roadmap_round, RoadmapWait};
use crate::domain::story::{stories_in_epic, StoryState};
use crate::ranking::{rank_after, rank_before, rank_between};
use crate::domain::session::agent_actor_id;
use crate::domain::round::{post_round, round_result, wait_round, AdrDraft, NewQuestion, NewRound, RoundWait};

/// The tool names the sidecar's MCP server registers for a shaping session, in the order it lists
/// them. Mirrored by `SHAPING_TOOL_NAMES` in `packages/sidecar/src/mcp-permission-server.ts`.
pub const SHAPING_TOOL_NAMES: [&str; 8] =
    [
        "round_post",
        "round_wait",
        "propose_spec_change",
        "propose_roadmap_change",
        "roadmap_holds",
        "propose_story",
        "propose_story_order",
        "propose_exit_test",
    ];

/// One parsed call of a shaping tool.
#[derive(Debug, Clone, PartialEq)]
pub enum ShapingToolCall {
    RoundPost(NewRound),
    /// Issue #124: wait on the open Round. Takes no argument.
    RoundWait,
    /// A spec change and the agent's one-line reason for it.
    ProposeSpecChange { change: SpecChange, why: String },
    /// Issue #133: one Roadmap change and the agent's one-line reason for it.
    ProposeRoadmapChange { change: RoadmapChange, why: String },
    /// Issue #133: the Roadmap still holds, and why.
    RoadmapHolds { why: String },
    /// Issue #132: the Milestone's whole new exit test, trimmed, and the agent's one-line reason for it.
    ProposeExitTest { text: String, why: String },
    /// Issue #127: a New Story for the Epic being sliced.
    ProposeStory(StoryDraft),
    /// Issue #127: move a Story of the Epic in its execution order, or retire it, and why.
    ProposeStoryOrder { story: String, change: OrderChange, why: String },
}

/// Where a Story lands in its Epic's execution order (issue #127). A reference is a Story's key
/// ("FLY-12") or a pending New Story Proposal's id.
#[derive(Debug, Clone, PartialEq)]
pub enum Place {
    /// At the end of the order.
    End,
    After(String),
    Before(String),
}

/// A New Story as `propose_story` gives it, its references not resolved yet.
#[derive(Debug, Clone, PartialEq)]
pub struct StoryDraft {
    pub title: String,
    pub description: String,
    pub place: Place,
    /// What it runs after (a reference) and the one-line constraint behind it.
    pub runs_after: Option<(String, String)>,
}

/// What `propose_story_order` proposes for a Story.
#[derive(Debug, Clone, PartialEq)]
pub enum OrderChange {
    Move(Place),
    Retire,
}

/// An optional, trimmed, non-blank string argument.
fn optional_text(value: &Value, name: &str) -> Option<String> {
    value.get(name).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

/// `after` or `before`, at most one; neither is the end of the order.
fn place_of(args: &Value, tool: &str) -> anyhow::Result<Place> {
    Ok(match (optional_text(args, "after"), optional_text(args, "before")) {
        (Some(_), Some(_)) => anyhow::bail!("{tool}: give `after` or `before`, not both"),
        (Some(r), None) => Place::After(r),
        (None, Some(r)) => Place::Before(r),
        (None, None) => Place::End,
    })
}

/// A required one-line argument of at most `max` characters.
fn one_line(args: &Value, name: &str, tool: &str, max: usize) -> anyhow::Result<String> {
    let text = optional_text(args, name).with_context(|| format!("{tool}: `{name}` is missing or empty"))?;
    anyhow::ensure!(!text.contains('\n'), "{tool}: `{name}` is one line");
    anyhow::ensure!(text.chars().count() <= max, "{tool}: `{name}` is at most {max} characters");
    Ok(text)
}

/// A tool's one-line `why`, trimmed: present, not blank, at most a Round text long.
fn why_field(args: &Value, tool: &str) -> anyhow::Result<String> {
    let why = string_field(args, "why", &format!("{tool}: "))?;
    anyhow::ensure!(!why.trim().is_empty(), "{tool}: `why` is empty");
    anyhow::ensure!(
        why.chars().count() <= crate::domain::round::MAX_ROUND_TEXT_LEN,
        "{tool}: `why` is at most {} characters",
        crate::domain::round::MAX_ROUND_TEXT_LEN
    );
    Ok(why.trim().to_string())
}

fn string_field(value: &Value, name: &str, at: &str) -> anyhow::Result<String> {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_string)
        .with_context(|| format!("{at}`{name}` is missing or not a string"))
}

impl ShapingToolCall {
    /// Parse a call from the tool name and its JSON arguments, refusing anything malformed before
    /// any write happens.
    pub fn parse(tool: &str, args: &Value) -> anyhow::Result<Self> {
        match tool {
            "round_post" => {
                let note = string_field(args, "note", "round_post: ")?;
                let questions = args
                    .get("questions")
                    .and_then(Value::as_array)
                    .context("round_post needs `questions`, a list of numbered questions")?
                    .iter()
                    .enumerate()
                    .map(|(i, q)| {
                        let at = format!("round_post: questions[{i}].");
                        // Issue #129: an `adr` question offers an ADR draft with its bar lines.
                        let adr = match q.get("kind").and_then(Value::as_str).unwrap_or("question") {
                            "question" => None,
                            "adr" => {
                                let draft = q.get("adr").filter(|a| a.is_object()).with_context(|| {
                                    format!("{at}`adr` is missing: an ADR question carries the draft and its bar lines")
                                })?;
                                Some(AdrDraft::from_payload_at(draft, &format!("{at}adr."))?)
                            }
                            other => anyhow::bail!("{at}`kind` is {other:?}; use \"question\" or \"adr\""),
                        };
                        Ok(NewQuestion {
                            title: string_field(q, "title", &at)?,
                            question: string_field(q, "question", &at)?,
                            grounding: string_field(q, "grounding", &at)?,
                            recommended_answer: string_field(q, "recommended_answer", &at)?,
                            because: string_field(q, "because", &at)?,
                            adr,
                        })
                    })
                    .collect::<anyhow::Result<Vec<_>>>()?;
                let round = NewRound { note, questions };
                round.validate()?;
                Ok(ShapingToolCall::RoundPost(round))
            }
            "round_wait" => Ok(ShapingToolCall::RoundWait),
            "propose_spec_change" => {
                let change = SpecChange::from_payload(args).context("propose_spec_change")?;
                let why = string_field(args, "why", "propose_spec_change: ")?;
                anyhow::ensure!(!why.trim().is_empty(), "propose_spec_change: `why` is empty");
                anyhow::ensure!(
                    why.chars().count() <= crate::domain::round::MAX_ROUND_TEXT_LEN,
                    "propose_spec_change: `why` is at most {} characters",
                    crate::domain::round::MAX_ROUND_TEXT_LEN
                );
                Ok(ShapingToolCall::ProposeSpecChange { change, why: why.trim().to_string() })
            }
            "propose_roadmap_change" => {
                let change = RoadmapChange::from_args(args).context("propose_roadmap_change")?;
                Ok(ShapingToolCall::ProposeRoadmapChange { change, why: why_field(args, tool)? })
            }
            "roadmap_holds" => Ok(ShapingToolCall::RoadmapHolds { why: why_field(args, tool)? }),
            "propose_exit_test" => {
                let text = string_field(args, "text", "propose_exit_test: ")?.trim().to_string();
                anyhow::ensure!(!text.is_empty(), "propose_exit_test: the proposed exit test is empty");
                anyhow::ensure!(
                    text.chars().count() <= MAX_ROADMAP_TEXT_LEN,
                    "propose_exit_test: the proposed exit test is at most {MAX_ROADMAP_TEXT_LEN} characters"
                );
                Ok(ShapingToolCall::ProposeExitTest { text, why: why_field(args, tool)? })
            }
            "propose_story" => {
                let tool = "propose_story";
                let title = one_line(args, "title", tool, MAX_STORY_TITLE_LEN)?;
                let description = optional_text(args, "description")
                    .with_context(|| format!("{tool}: `description` is missing or empty: say what the slice ships and how it is tested"))?;
                anyhow::ensure!(
                    description.chars().count() <= MAX_STORY_DESCRIPTION_LEN,
                    "{tool}: `description` is at most {MAX_STORY_DESCRIPTION_LEN} characters"
                );
                let runs_after = match (optional_text(args, "runs_after"), optional_text(args, "runs_after_reason")) {
                    (Some(after), Some(_)) => Some((after, one_line(args, "runs_after_reason", tool, MAX_RUNS_AFTER_REASON_LEN)?)),
                    (Some(_), None) => anyhow::bail!(
                        "{tool}: `runs_after_reason` is missing: say in one line why it runs after the other (\"shares `FeedRow.tsx`\")"
                    ),
                    (None, Some(_)) => anyhow::bail!("{tool}: `runs_after_reason` needs `runs_after`, the Story it runs after"),
                    (None, None) => None,
                };
                Ok(ShapingToolCall::ProposeStory(StoryDraft { title, description, place: place_of(args, tool)?, runs_after }))
            }
            "propose_story_order" => {
                let tool = "propose_story_order";
                let story = optional_text(args, "story").with_context(|| format!("{tool}: `story` is missing: the Story's key"))?;
                let change = match args.get("action").and_then(Value::as_str) {
                    Some("move") => OrderChange::Move(place_of(args, tool)?),
                    Some("retire") => {
                        anyhow::ensure!(
                            optional_text(args, "after").is_none() && optional_text(args, "before").is_none(),
                            "{tool}: a retirement takes no `after` or `before`"
                        );
                        OrderChange::Retire
                    }
                    other => anyhow::bail!("{tool}: `action` is {other:?}; use \"move\" or \"retire\""),
                };
                let why = one_line(args, "why", tool, crate::domain::round::MAX_ROUND_TEXT_LEN)?;
                Ok(ShapingToolCall::ProposeStoryOrder { story, change, why })
            }
            other => anyhow::bail!("{other:?} is not a shaping tool"),
        }
    }
}

/// What a call left behind.
#[derive(Debug, Clone, PartialEq)]
pub enum ShapingToolOutcome {
    /// The Round is on the board and its call is held until the developer answers it all.
    Held { round_id: String, project_id: String },
    /// The call is answered at once with `result`: a filed Proposal (`propose_spec_change`, issue #125), or
    /// a `round_wait` on a Round already answered, with every answer (issue #124).
    Answered { result: Value, project_id: String },
}

/// `(project_id, epic_id)` of the Epic live shaping session `session_id` shapes, for `tool`, which
/// `does` something to an Epic. Refused for an unknown, ended or Story session and for a session
/// shaping anything but an Epic.
fn shaping_epic(conn: &Connection, session_id: &str, tool: &str, does: &str) -> anyhow::Result<(String, String)> {
    let row: Option<(String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT kind, status, project_id, epic_id FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((kind, status, project_id, epic_id)) = row else { anyhow::bail!("session {session_id:?} not found") };
    anyhow::ensure!(kind == "shaping", "{tool} belongs to a shaping session; session {session_id:?} is a Story session");
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer propose a change"
    );
    let epic_id = epic_id.with_context(|| format!("this shaping session shapes no Epic; {tool} {does}"))?;
    Ok((project_id, epic_id))
}

/// One place in an Epic's execution order (issue #127): a Story, or a pending New Story Proposal at
/// the rank it proposed.
#[derive(Debug, Clone)]
struct OrderItem {
    rank: String,
    /// A Story's id or a Proposal's id.
    id: String,
}

/// The Epic's execution order: every Story (closed ones too, so a new rank never collides with
/// theirs) and every pending New Story Proposal with a rank, by rank then id.
fn epic_order(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<OrderItem>> {
    let mut items: Vec<OrderItem> = stories_in_epic(conn, epic_id)?
        .into_iter()
        .map(|s| OrderItem { rank: s.rank, id: s.id })
        .collect();
    for p in proposals_on_epic(conn, epic_id)? {
        if p.state != "pending" || p.verb != "create" || p.target_type != "story" {
            continue;
        }
        if let Some(rank) = NewStory::from_payload(&p.payload).ok().and_then(|s| s.rank) {
            items.push(OrderItem { rank, id: p.id });
        }
    }
    items.sort_by(|a, b| (&a.rank, &a.id).cmp(&(&b.rank, &b.id)));
    Ok(items)
}

/// What a reference names in the Epic: a Story (by key, or by id) or a New Story Proposal (by id).
/// An accepted New Story Proposal names the Story it created.
enum Named {
    Story { id: String, key: String, state: String },
    Proposal { id: String },
}

fn resolve(conn: &Connection, epic_id: &str, reference: &str, tool: &str) -> anyhow::Result<Named> {
    if let Some(s) = stories_in_epic(conn, epic_id)?.into_iter().find(|s| s.key.eq_ignore_ascii_case(reference) || s.id == reference) {
        return Ok(Named::Story { id: s.id, key: s.key, state: s.state });
    }
    let p = proposals_on_epic(conn, epic_id)?
        .into_iter()
        .find(|p| p.id == reference && p.verb == "create" && p.target_type == "story")
        .with_context(|| {
            format!("{tool}: {reference:?} is neither a Story of this Epic (its key, such as FLY-12) nor a New Story Proposal on it (its proposal_id)")
        })?;
    match (p.state.as_str(), p.target_id) {
        ("pending", _) => Ok(Named::Proposal { id: p.id }),
        ("accepted", Some(story_id)) => {
            let s = crate::domain::story::get_story(conn, &story_id)?.context("the accepted Proposal's Story is gone")?;
            Ok(Named::Story { id: s.id, key: s.key, state: s.state })
        }
        (state, _) => anyhow::bail!("{tool}: the New Story Proposal {reference:?} was {state}; it has no place in the order"),
    }
}

/// The rank `place` gives in `order`, which leaves out whatever is being placed.
fn rank_for(conn: &Connection, epic_id: &str, order: &[OrderItem], place: &Place, tool: &str) -> anyhow::Result<String> {
    let anchor = |reference: &str| -> anyhow::Result<usize> {
        let id = match resolve(conn, epic_id, reference, tool)? {
            Named::Story { id, .. } | Named::Proposal { id } => id,
        };
        order.iter().position(|i| i.id == id).with_context(|| {
            format!("{tool}: {reference:?} has no place in the order to put a Story next to")
        })
    };
    let (prev, next) = match place {
        Place::End => (order.last(), None),
        Place::After(r) => {
            let at = anchor(r)?;
            (Some(&order[at]), order[at + 1..].iter().find(|i| i.rank > order[at].rank))
        }
        Place::Before(r) => {
            let at = anchor(r)?;
            (order[..at].iter().rev().find(|i| i.rank < order[at].rank), Some(&order[at]))
        }
    };
    match (prev, next) {
        (Some(p), Some(n)) => rank_between(&p.rank, &n.rank),
        (Some(p), None) => rank_after(Some(&p.rank)),
        (None, Some(n)) => rank_before(Some(&n.rank)),
        (None, None) => rank_after(None),
    }
}

/// File a New Story on the Epic shaping session `session_id` slices, as the agent (issue #127): its
/// rank is worked out now from where it lands, so its ghost column stands where the Story would.
fn propose_story(conn: &mut Connection, session_id: &str, draft: &StoryDraft) -> anyhow::Result<ShapingToolOutcome> {
    let tool = "propose_story";
    let (project_id, epic_id) = shaping_epic(conn, session_id, tool, "slices an Epic into Stories")?;
    let order = epic_order(conn, &epic_id)?;
    let rank = rank_for(conn, &epic_id, &order, &draft.place, tool)?;
    let runs_after = match &draft.runs_after {
        None => None,
        Some((reference, reason)) => Some((
            match resolve(conn, &epic_id, reference, tool)? {
                Named::Story { key, state, .. } if state == "dropped" => {
                    anyhow::bail!("{tool}: {key} is dropped; a Story cannot run after it")
                }
                Named::Story { id, .. } => RunsAfter::Story(id),
                Named::Proposal { id } => RunsAfter::Proposal(id),
            },
            reason.clone(),
        )),
    };
    let story = NewStory {
        title: draft.title.clone(),
        description: Some(draft.description.clone()),
        rank: Some(rank),
        runs_after,
    };
    let agent = agent_actor_id(conn)?;
    let filed = file_proposal(
        conn,
        &agent,
        &NewProposal {
            project_id: &project_id,
            session_id: Some(session_id),
            epic_id: Some(&epic_id),
            verb: ProposalVerb::Create,
            target: ProposalTarget::Story,
            target_id: None,
            payload: story.to_payload(),
            rationale: None,
        },
    )?;
    Ok(ShapingToolOutcome::Answered {
        result: serde_json::json!({
            "proposal_id": filed.id,
            "state": "pending",
            "next": "The Story is on the board as a ghost column where it would land, for the developer to accept, \
                     amend or reject; nothing is created until they do. Until it is accepted, name it by this \
                     proposal_id in `after`, `before` or `runs_after`. Keep slicing: do not wait for the decision.",
        }),
        project_id,
    })
}

/// File a reorder or a retirement of a Story of the Epic shaping session `session_id` slices, as the
/// agent (issue #127). Only a Story still in Shaping is retired by a Proposal; a closed Story keeps
/// its place.
fn propose_story_order(
    conn: &mut Connection,
    session_id: &str,
    story: &str,
    change: &OrderChange,
    why: &str,
) -> anyhow::Result<ShapingToolOutcome> {
    let tool = "propose_story_order";
    let (project_id, epic_id) = shaping_epic(conn, session_id, tool, "orders an Epic's Stories")?;
    let (story_id, key, state) = match resolve(conn, &epic_id, story, tool)? {
        Named::Story { id, key, state } => (id, key, state),
        Named::Proposal { .. } => {
            anyhow::bail!("{tool}: {story:?} is a New Story Proposal, not a Story yet; propose the Story again where it belongs")
        }
    };
    let (verb, payload) = match change {
        OrderChange::Move(place) => {
            anyhow::ensure!(!StoryState::parse(&state)?.is_closed(), "{tool}: {key} is {state}; a closed Story keeps its place");
            let order: Vec<OrderItem> = epic_order(conn, &epic_id)?.into_iter().filter(|i| i.id != story_id).collect();
            (ProposalVerb::Reorder, serde_json::json!({ "rank": rank_for(conn, &epic_id, &order, place, tool)? }))
        }
        OrderChange::Retire => {
            anyhow::ensure!(state == "shaping", "{tool}: {key} is {state}; only a Story still in Shaping can be retired");
            (ProposalVerb::Retire, serde_json::json!({}))
        }
    };
    let agent = agent_actor_id(conn)?;
    let filed = file_proposal(
        conn,
        &agent,
        &NewProposal {
            project_id: &project_id,
            session_id: Some(session_id),
            epic_id: Some(&epic_id),
            verb,
            target: ProposalTarget::Story,
            target_id: Some(&story_id),
            payload,
            rationale: Some(why),
        },
    )?;
    Ok(ShapingToolOutcome::Answered {
        result: serde_json::json!({
            "proposal_id": filed.id,
            "state": "pending",
            "next": format!(
                "Your {} of {key} is on its column as a Proposal, for the developer to accept or reject; nothing \
                 changes until they do. Keep slicing: do not wait for the decision.",
                if verb == ProposalVerb::Reorder { "move" } else { "retirement" }
            ),
        }),
        project_id,
    })
}

/// File a spec change on the Epic shaping session `session_id` shapes, as the agent. Refused for an
/// unknown, ended or Story session and for a session shaping anything but an Epic.
fn propose_spec_change(conn: &mut Connection, session_id: &str, change: &SpecChange, why: &str) -> anyhow::Result<ShapingToolOutcome> {
    let (project_id, epic_id) = shaping_epic(conn, session_id, "propose_spec_change", "rewrites an Epic's spec")?;
    let agent = agent_actor_id(conn)?;
    let filed = file_proposal(
        conn,
        &agent,
        &NewProposal {
            project_id: &project_id,
            session_id: Some(session_id),
            epic_id: Some(&epic_id),
            verb: ProposalVerb::Amend,
            target: ProposalTarget::Epic,
            target_id: Some(&epic_id),
            payload: change.to_payload(),
            rationale: Some(why),
        },
    )?;
    Ok(ShapingToolOutcome::Answered {
        result: serde_json::json!({
            "proposal_id": filed.id,
            "state": "pending",
            "next": format!(
                "Your change to the {} is on the Epic card as a Proposal, for the developer to accept, amend or \
                 reject; nothing changes until they do. Keep shaping: do not wait for the decision.",
                change.field.label()
            ),
        }),
        project_id,
    })
}

/// File a new exit test on the Milestone shaping session `session_id` shapes, as the agent (issue #132):
/// an Amend Milestone Proposal with only `exit_test` set. Refused for an unknown, ended or Story session
/// and for a session shaping anything but a Milestone.
fn propose_exit_test(conn: &mut Connection, session_id: &str, text: &str, why: &str) -> anyhow::Result<ShapingToolOutcome> {
    let row: Option<(String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT kind, status, project_id, milestone_id FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((kind, status, project_id, milestone_id)) = row else { anyhow::bail!("session {session_id:?} not found") };
    anyhow::ensure!(kind == "shaping", "propose_exit_test belongs to a shaping session; session {session_id:?} is a Story session");
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer propose a change"
    );
    let milestone_id = milestone_id.context(
        "this shaping session shapes an Epic, not a Milestone; propose_exit_test rewrites a Milestone's exit test. \
         Propose an Epic's exit test with propose_spec_change",
    )?;
    let change = RoadmapChange::AmendMilestone { milestone_id, title: None, exit_test: Some(text.to_string()) };
    let (verb, target, target_id, payload) = change.to_proposal();
    let agent = agent_actor_id(conn)?;
    let filed = file_proposal(
        conn,
        &agent,
        &NewProposal {
            project_id: &project_id,
            session_id: Some(session_id),
            epic_id: None,
            verb,
            target,
            target_id,
            payload,
            rationale: Some(why),
        },
    )?;
    Ok(ShapingToolOutcome::Answered {
        result: serde_json::json!({
            "proposal_id": filed.id,
            "state": "pending",
            "next": "Your exit test is over the Milestone's exit test as a Proposal, for the developer to accept, amend \
                     or reject; nothing changes until they do. Keep shaping: do not wait for the decision.",
        }),
        project_id,
    })
}

/// Run one call for session `session_id`, whose held call is `request_id`, writing as the agent
/// actor. Refused when the session is unknown, ended or a Story session (see `round::post_round`).
pub fn apply_shaping_tool_call(
    conn: &mut Connection,
    session_id: &str,
    request_id: &str,
    call: &ShapingToolCall,
) -> anyhow::Result<ShapingToolOutcome> {
    if is_roadmap_session(conn, session_id)? {
        return apply_roadmap_call(conn, session_id, request_id, call);
    }
    match call {
        ShapingToolCall::RoundPost(round) => {
            let posted = post_round(conn, session_id, Some(request_id), round)?;
            let project_id: String = conn.query_row(
                "SELECT project_id FROM stages WHERE id = ?1",
                rusqlite::params![posted.stage_id],
                |r| r.get(0),
            )?;
            Ok(ShapingToolOutcome::Held { round_id: posted.id, project_id })
        }
        ShapingToolCall::RoundWait => {
            let (round, held) = match wait_round(conn, session_id, request_id)? {
                RoundWait::Held(round) => (round, true),
                RoundWait::Answered(round) => (round, false),
            };
            let project_id: String = conn.query_row(
                "SELECT project_id FROM stages WHERE id = ?1",
                rusqlite::params![round.stage_id],
                |r| r.get(0),
            )?;
            Ok(if held {
                ShapingToolOutcome::Held { round_id: round.id, project_id }
            } else {
                ShapingToolOutcome::Answered { result: round_result(&round), project_id }
            })
        }
        ShapingToolCall::ProposeSpecChange { change, why } => propose_spec_change(conn, session_id, change, why),
        ShapingToolCall::ProposeExitTest { text, why } => propose_exit_test(conn, session_id, text, why),
        ShapingToolCall::ProposeStory(draft) => propose_story(conn, session_id, draft),
        ShapingToolCall::ProposeStoryOrder { story, change, why } => propose_story_order(conn, session_id, story, change, why),
        ShapingToolCall::ProposeRoadmapChange { .. } | ShapingToolCall::RoadmapHolds { .. } => anyhow::bail!(
            "propose_roadmap_change and roadmap_holds belong to a roadmap Round; this session shapes an Epic or a Milestone"
        ),
    }
}

/// Whether `session_id` is a shaping session on the Roadmap (no Epic, no Milestone). An unknown or
/// Story session is not, and is refused by the call itself.
fn is_roadmap_session(conn: &Connection, session_id: &str) -> anyhow::Result<bool> {
    Ok(conn
        .query_row(
            "SELECT kind = 'shaping' AND epic_id IS NULL AND milestone_id IS NULL FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(false))
}

/// One call in a roadmap session (issue #133).
fn apply_roadmap_call(conn: &mut Connection, session_id: &str, request_id: &str, call: &ShapingToolCall) -> anyhow::Result<ShapingToolOutcome> {
    match call {
        ShapingToolCall::ProposeRoadmapChange { change, why } => {
            let filed = propose_roadmap_change(conn, session_id, change, why)?;
            Ok(ShapingToolOutcome::Answered {
                result: serde_json::json!({
                    "proposal_id": filed.id,
                    "state": "pending",
                    "next": "Your change is on the Roadmap strip as a ghost row, for the developer to accept, amend or \
                             reject; nothing changes until they do. Propose any other change the same way, then call \
                             round_wait for the developer's decisions.",
                }),
                project_id: filed.project_id,
            })
        }
        ShapingToolCall::RoadmapHolds { why } => {
            let closed = roadmap_holds(conn, session_id, why)?;
            Ok(ShapingToolOutcome::Answered {
                result: serde_json::json!({
                    "round": closed.number,
                    "outcome": "holds",
                    "next": "The roadmap Round is closed: \"Roadmap still holds\" is on the timeline. End your session now.",
                }),
                project_id: closed.project_id,
            })
        }
        ShapingToolCall::RoundWait => match wait_roadmap_round(conn, session_id, request_id)? {
            RoadmapWait::Held(round) => Ok(ShapingToolOutcome::Held { round_id: round.id, project_id: round.project_id }),
            RoadmapWait::Answered(result) => {
                let project_id: String = conn.query_row(
                    "SELECT project_id FROM sessions WHERE id = ?1",
                    rusqlite::params![session_id],
                    |r| r.get(0),
                )?;
                Ok(ShapingToolOutcome::Answered { result, project_id })
            }
        },
        ShapingToolCall::RoundPost(_) => anyhow::bail!(
            "a roadmap Round asks no numbered questions: propose each change with propose_roadmap_change and then \
             call round_wait, or say the Roadmap still holds with roadmap_holds"
        ),
        ShapingToolCall::ProposeSpecChange { .. } => anyhow::bail!(
            "propose_spec_change rewrites an Epic being shaped; in a roadmap Round, propose Roadmap changes with propose_roadmap_change"
        ),
        ShapingToolCall::ProposeExitTest { .. } => anyhow::bail!(
            "propose_exit_test rewrites the exit test of a Milestone being shaped; in a roadmap Round, propose an amended \
             Milestone with propose_roadmap_change"
        ),
        ShapingToolCall::ProposeStory(_) | ShapingToolCall::ProposeStoryOrder { .. } => anyhow::bail!(
            "propose_story and propose_story_order slice an Epic being shaped; in a roadmap Round, propose Roadmap changes with propose_roadmap_change"
        ),
    }
}
