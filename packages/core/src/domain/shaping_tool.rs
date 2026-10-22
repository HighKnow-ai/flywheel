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
//! `propose_spec_change` (issue #125) files a Proposal to rewrite one field of the Epic being shaped
//! and is answered AT ONCE: a Proposal never holds the agent. The developer decides it on the Epic
//! card, where it shows as a ghost field (`proposal::accept_proposal` applies it).
//!
//! Identity comes from the session the call arrived on, never from an argument: a call reaches only
//! that session's own subject, and only while the session is live.

use anyhow::Context;
use rusqlite::Connection;
use serde_json::Value;

use rusqlite::OptionalExtension;

use crate::domain::proposal::{file_proposal, NewProposal, ProposalTarget, ProposalVerb};
use crate::domain::proposal_apply::SpecChange;
use crate::domain::session::agent_actor_id;
use crate::domain::round::{post_round, NewQuestion, NewRound};

/// The tool names the sidecar's MCP server registers for a shaping session, in the order it lists
/// them. Mirrored by `SHAPING_TOOL_NAMES` in `packages/sidecar/src/mcp-permission-server.ts`.
pub const SHAPING_TOOL_NAMES: [&str; 2] = ["round_post", "propose_spec_change"];

/// One parsed call of a shaping tool.
#[derive(Debug, Clone, PartialEq)]
pub enum ShapingToolCall {
    RoundPost(NewRound),
    /// A spec change and the agent's one-line reason for it.
    ProposeSpecChange { change: SpecChange, why: String },
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
                        Ok(NewQuestion {
                            title: string_field(q, "title", &at)?,
                            question: string_field(q, "question", &at)?,
                            grounding: string_field(q, "grounding", &at)?,
                            recommended_answer: string_field(q, "recommended_answer", &at)?,
                            because: string_field(q, "because", &at)?,
                        })
                    })
                    .collect::<anyhow::Result<Vec<_>>>()?;
                let round = NewRound { note, questions };
                round.validate()?;
                Ok(ShapingToolCall::RoundPost(round))
            }
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
            other => anyhow::bail!("{other:?} is not a shaping tool"),
        }
    }
}

/// What a call left behind.
#[derive(Debug, Clone, PartialEq)]
pub enum ShapingToolOutcome {
    /// The Round is on the board and its call is held until the developer answers it all.
    Held { round_id: String, project_id: String },
    /// The call is answered at once with `result`.
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
        ShapingToolCall::ProposeSpecChange { change, why } => propose_spec_change(conn, session_id, change, why),
    }
}
