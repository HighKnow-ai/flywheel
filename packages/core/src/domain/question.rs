//! An agent's question (docs/mvp-spec.md §2 "Attention", §5 "Never a pause", issue #100).
//!
//! Claude Code sends every `AskUserQuestion` call through the permission-prompt tool, like any other
//! tool call. Flywheel holds it as a **question**: a `permission_requests` row whose `tool_name` is
//! [`ASK_USER_QUESTION_TOOL`]. Being that row is what makes it Waiting on you, count in Needs you and
//! the sidebar, wait with no timeout and expire with its session, with no second path for any of it.
//! What sets it apart from a permission request:
//!
//! - no rule ever answers it, and none is ever offered for it (`process_inbound_permission_request`
//!   skips the rule check, `card_suggested_rule` offers none);
//! - it is never answered with allow or deny ([`crate::domain::permission_request::answer_request`]
//!   refuses it); it is answered with [`answer_question`], which keeps the answers on the row and
//!   relays them to the agent as `allow` with the questions and answers (see the sidecar's
//!   `permissionPromptResponse`).

use anyhow::{anyhow, bail, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::BTreeMap;

use crate::domain::event::{append_event, next_sequence};
use crate::domain::session::clear_run_blocked;

/// The tool name Claude Code gives the permission-prompt tool for a question.
pub const ASK_USER_QUESTION_TOOL: &str = "AskUserQuestion";

/// Whether a held tool call is an agent's question rather than a permission request.
pub fn is_question(tool_name: &str) -> bool {
    tool_name == ASK_USER_QUESTION_TOOL
}

/// One question of an `AskUserQuestion` call, as far as answering it needs.
#[derive(Debug, Clone, PartialEq)]
pub struct QuestionSpec {
    pub question: String,
    pub multi_select: bool,
}

/// The questions an `AskUserQuestion` input asks, in order. A question with no text is skipped.
pub fn questions_in(input: &serde_json::Value) -> Vec<QuestionSpec> {
    input
        .get("questions")
        .and_then(|q| q.as_array())
        .map(|questions| {
            questions
                .iter()
                .filter_map(|q| {
                    let question = q.get("question")?.as_str()?.to_string();
                    let multi_select = q
                        .get("multiSelect")
                        .and_then(|m| m.as_bool())
                        .unwrap_or(false);
                    Some(QuestionSpec {
                        question,
                        multi_select,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The `answers` object Claude Code reads, built from what the developer picked: for each question
/// (keyed by its text) the chosen option labels and/or free text, in the order given.
///
/// Every question must be answered with at least one non-blank value, a single-choice question with
/// exactly one, and no pick may name a question the agent did not ask. The value is the one label
/// or text for a single-choice question, and the values joined with ", " for a multi-select one:
/// the shape the Claude Agent SDK docs give for answering `AskUserQuestion` ("Handle approvals and
/// user input", https://code.claude.com/docs/en/agent-sdk/user-input).
pub fn answers_for(
    input: &serde_json::Value,
    picks: &BTreeMap<String, Vec<String>>,
) -> anyhow::Result<serde_json::Map<String, serde_json::Value>> {
    let questions = questions_in(input);
    if questions.is_empty() {
        bail!("this question carries no questions to answer");
    }
    if let Some(unknown) = picks
        .keys()
        .find(|k| !questions.iter().any(|q| &q.question == *k))
    {
        bail!("the agent did not ask {unknown:?}");
    }
    let mut answers = serde_json::Map::new();
    for q in &questions {
        let values: Vec<&str> = picks
            .get(&q.question)
            .map(|v| {
                v.iter()
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        if values.is_empty() {
            bail!("answer {:?} before sending", q.question);
        }
        if !q.multi_select && values.len() > 1 {
            bail!("{:?} takes one answer", q.question);
        }
        answers.insert(
            q.question.clone(),
            serde_json::Value::String(values.join(", ")),
        );
    }
    Ok(answers)
}

/// A question answered by [`answer_question`]: what the caller relays to the held call.
#[derive(Debug, Clone, PartialEq)]
pub struct AnsweredQuestion {
    pub request_id: String,
    pub session_id: String,
    pub project_id: String,
    pub answers: serde_json::Map<String, serde_json::Value>,
}

/// Answer an open question exactly once. One transaction: check it is a pending, unexpired question,
/// build its answers ([`answers_for`]), store them with `status = 'allowed'` behind the same guarded
/// UPDATE `answer_request` uses, clear the session's Waiting on you once nothing else is pending, and
/// append a `permission_request.answered` event.
pub fn answer_question(
    conn: &mut Connection,
    request_id: &str,
    picks: &BTreeMap<String, Vec<String>>,
    actor_id: &str,
) -> anyhow::Result<AnsweredQuestion> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    /// `(session_id, story_id, project_id, tool_name, input_payload, status, expired_at)` of the request.
    type RequestRow = (
        String,
        String,
        String,
        String,
        Option<String>,
        String,
        Option<String>,
    );
    let row: Option<RequestRow> = tx
        .query_row(
            "SELECT session_id, story_id, project_id, tool_name, input_payload, status, expired_at \
             FROM permission_requests WHERE id = ?1",
            params![request_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .optional()
        .context("failed to read the question")?;
    let (session_id, story_id, project_id, tool_name, input_payload, status, expired_at) =
        row.ok_or_else(|| anyhow!("question {request_id:?} not found"))?;
    if !is_question(&tool_name) {
        bail!("request {request_id:?} is a permission request, not a question");
    }
    if status != "pending" || expired_at.is_some() {
        bail!("question {request_id:?} is no longer open: it was answered or its session ended");
    }

    let input: serde_json::Value = input_payload
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(serde_json::Value::Null);
    let answers = answers_for(&input, picks)?;
    let answers_json = serde_json::Value::Object(answers.clone()).to_string();

    let affected = tx
        .execute(
            "UPDATE permission_requests SET status = 'allowed', answers = ?1, resolved_by = ?2, resolved_at = ?3 \
             WHERE id = ?4 AND status = 'pending' AND expired_at IS NULL",
            params![answers_json, actor_id, now, request_id],
        )
        .context("failed to answer the question")?;
    if affected == 0 {
        bail!("question {request_id:?} is no longer open");
    }

    clear_run_blocked(&tx, &session_id).context("failed to clear the session's blocked status")?;

    let epic_id: Option<String> = tx
        .query_row(
            "SELECT epic_id FROM stories WHERE id = ?1",
            params![story_id],
            |r| r.get(0),
        )
        .optional()?;
    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "pending",
        "after": "answered",
        "tool_name": tool_name,
        "answers": answers,
        "label": "Answered the agent's question",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "permission_request",
        request_id,
        Some(&story_id),
        epic_id.as_deref(),
        actor_id,
        "permission_request.answered",
        &payload,
        &now,
    )?;
    tx.commit().context("failed to commit answer_question")?;

    Ok(AnsweredQuestion {
        request_id: request_id.to_string(),
        session_id,
        project_id,
        answers,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> serde_json::Value {
        serde_json::json!({ "questions": [
            { "question": "Which colour?", "header": "Colour", "multiSelect": false,
              "options": [{ "label": "Red", "description": "" }, { "label": "Blue", "description": "" }] },
            { "question": "Which platforms?", "header": "Platforms", "multiSelect": true,
              "options": [{ "label": "macOS", "description": "" }, { "label": "Linux", "description": "" }] },
            { "question": "What name?", "header": "Name", "multiSelect": false,
              "options": [{ "label": "v1", "description": "" }, { "label": "v2", "description": "" }] },
        ]})
    }

    fn picks(entries: &[(&str, &[&str])]) -> BTreeMap<String, Vec<String>> {
        entries
            .iter()
            .map(|(q, v)| (q.to_string(), v.iter().map(|s| s.to_string()).collect()))
            .collect()
    }

    #[test]
    fn answers_are_keyed_by_question_text_with_one_label_joined_labels_or_free_text() {
        let answers = answers_for(
            &input(),
            &picks(&[
                ("Which colour?", &["Blue"]),
                ("Which platforms?", &["macOS", "Linux"]),
                ("What name?", &["  Call it Flywheel One "]),
            ]),
        )
        .unwrap();
        assert_eq!(
            serde_json::Value::Object(answers),
            serde_json::json!({
                "Which colour?": "Blue",
                "Which platforms?": "macOS, Linux",
                "What name?": "Call it Flywheel One",
            })
        );
    }

    #[test]
    fn every_question_needs_an_answer_and_a_single_choice_takes_one() {
        let missing = answers_for(
            &input(),
            &picks(&[
                ("Which colour?", &["Blue"]),
                ("Which platforms?", &["macOS"]),
            ]),
        );
        assert!(missing.unwrap_err().to_string().contains("What name?"));
        let blank = answers_for(
            &input(),
            &picks(&[
                ("Which colour?", &["  "]),
                ("Which platforms?", &["macOS"]),
                ("What name?", &["v1"]),
            ]),
        );
        assert!(blank.is_err());
        let two = answers_for(
            &input(),
            &picks(&[
                ("Which colour?", &["Red", "Blue"]),
                ("Which platforms?", &["macOS"]),
                ("What name?", &["v1"]),
            ]),
        );
        assert!(two.unwrap_err().to_string().contains("takes one answer"));
        let unknown = answers_for(
            &input(),
            &picks(&[
                ("Which colour?", &["Red"]),
                ("Which platforms?", &["macOS"]),
                ("What name?", &["v1"]),
                ("Something else?", &["x"]),
            ]),
        );
        assert!(unknown.unwrap_err().to_string().contains("did not ask"));
    }
}
