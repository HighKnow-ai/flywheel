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
//! Identity comes from the session the call arrived on, never from an argument: a call reaches only
//! that session's own subject, and only while the session is live.

use anyhow::Context;
use rusqlite::Connection;
use serde_json::Value;

use rusqlite::OptionalExtension;

use crate::domain::proposal::{file_proposal, NewProposal, ProposalTarget, ProposalVerb};
use crate::domain::proposal_apply::{RoadmapChange, SpecChange};
use crate::domain::roadmap_round::{propose_roadmap_change, roadmap_holds, wait_roadmap_round, RoadmapWait};
use crate::domain::session::agent_actor_id;
use crate::domain::round::{post_round, round_result, wait_round, AdrDraft, NewQuestion, NewRound, RoundWait};

/// The tool names the sidecar's MCP server registers for a shaping session, in the order it lists
/// them. Mirrored by `SHAPING_TOOL_NAMES` in `packages/sidecar/src/mcp-permission-server.ts`.
pub const SHAPING_TOOL_NAMES: [&str; 5] =
    ["round_post", "round_wait", "propose_spec_change", "propose_roadmap_change", "roadmap_holds"];

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

/// File a spec change on the Epic shaping session `session_id` shapes, as the agent. Refused for an
/// unknown, ended or Story session and for a session shaping anything but an Epic.
fn propose_spec_change(conn: &mut Connection, session_id: &str, change: &SpecChange, why: &str) -> anyhow::Result<ShapingToolOutcome> {
    let row: Option<(String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT kind, status, project_id, epic_id FROM sessions WHERE id = ?1",
            rusqlite::params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    let Some((kind, status, project_id, epic_id)) = row else { anyhow::bail!("session {session_id:?} not found") };
    anyhow::ensure!(kind == "shaping", "propose_spec_change belongs to a shaping session; session {session_id:?} is a Story session");
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer propose a change"
    );
    let epic_id = epic_id.context("this shaping session shapes no Epic; propose_spec_change rewrites an Epic's spec")?;
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
    }
}
