//! Rounds (docs/mvp-spec.md §3, GLOSSARY.md "Round", issue #123): a batch of numbered questions an
//! agent asks during a Stage, each with a recommended answer the developer accepts as it is or
//! replaces with their own.
//!
//! - [`post_round`] writes a Round into the shaping session's open Stage. The session is the only
//!   identity: the Stage, the subject and the project are read from it, never from an argument. It
//!   is refused while a Round is still open in the Stage.
//! - [`answer_round_question`] answers one question, human-only, in its own transaction, so each
//!   answer is in the database before the next is given. The answer that completes the Round also
//!   closes it and hands back the held `round_post` call to answer ([`RoundRelease`]), with every
//!   answer, when the session that posted it is still live.
//! - [`accept_all_recommended`] answers every open question of a Round with its recommendation.
//!   Questions only: it never decides a Proposal.
//!
//! An answer may change while its Round is open; once the last question is answered the Round is
//! settled. A Round outlives its session: answering goes on without one, and nothing is lost.

use anyhow::{bail, Context};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::session::{agent_actor_id, session_kind, ShapingSubject};
use crate::domain::session_kind::SessionKind;
use crate::domain::stage::{open_stage, StageKind};
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// The most questions one Round may ask. A frontier wider than this is two Rounds.
pub const MAX_QUESTIONS_PER_ROUND: usize = 12;

/// The longest a question's title may be: it is the line an answered question folds to.
pub const MAX_QUESTION_TITLE_LEN: usize = 120;

/// The longest the note, a question, its grounding, its recommendation, its reason or an answer may be.
pub const MAX_ROUND_TEXT_LEN: usize = 4000;

/// One question as an agent posts it.
#[derive(Debug, Clone, PartialEq)]
pub struct NewQuestion {
    pub title: String,
    pub question: String,
    /// What the agent read that raised the question.
    pub grounding: String,
    pub recommended_answer: String,
    /// The one-line reason for the recommendation.
    pub because: String,
}

/// A Round as an agent posts it: its one-paragraph note and its numbered questions, in order.
#[derive(Debug, Clone, PartialEq)]
pub struct NewRound {
    pub note: String,
    pub questions: Vec<NewQuestion>,
}

fn text_field(name: &str, value: &str, max: usize) -> anyhow::Result<()> {
    anyhow::ensure!(!value.trim().is_empty(), "`{name}` is empty");
    anyhow::ensure!(value.chars().count() <= max, "`{name}` is at most {max} characters");
    Ok(())
}

impl NewRound {
    /// Refuse a Round that is empty, too wide, or has a blank or overlong field, naming the field.
    pub fn validate(&self) -> anyhow::Result<()> {
        text_field("note", &self.note, MAX_ROUND_TEXT_LEN)?;
        anyhow::ensure!(!self.questions.is_empty(), "a Round asks at least one question");
        anyhow::ensure!(
            self.questions.len() <= MAX_QUESTIONS_PER_ROUND,
            "a Round asks at most {MAX_QUESTIONS_PER_ROUND} questions; ask the rest in the next Round"
        );
        for (i, q) in self.questions.iter().enumerate() {
            let at = |field: &str| format!("questions[{i}].{field}");
            text_field(&at("title"), &q.title, MAX_QUESTION_TITLE_LEN)?;
            text_field(&at("question"), &q.question, MAX_ROUND_TEXT_LEN)?;
            text_field(&at("grounding"), &q.grounding, MAX_ROUND_TEXT_LEN)?;
            text_field(&at("recommended_answer"), &q.recommended_answer, MAX_ROUND_TEXT_LEN)?;
            text_field(&at("because"), &q.because, MAX_ROUND_TEXT_LEN)?;
        }
        Ok(())
    }
}

/// How the developer answers a question.
#[derive(Debug, Clone, PartialEq)]
pub enum RoundAnswer {
    /// The recommended answer, as it is.
    Recommended,
    /// The developer's own words.
    Own(String),
}

/// One `round_questions` row.
#[derive(Debug, Clone, PartialEq)]
pub struct RoundQuestion {
    pub id: String,
    pub number: i64,
    pub title: String,
    pub question: String,
    pub grounding: String,
    pub recommended_answer: String,
    pub because: String,
    pub answer: Option<String>,
    /// `recommended` or `own`, once answered.
    pub answered_with: Option<String>,
    pub answered_by: Option<String>,
    pub answered_at: Option<String>,
}

/// One `rounds` row with its questions, in order.
#[derive(Debug, Clone, PartialEq)]
pub struct Round {
    pub id: String,
    pub stage_id: String,
    pub stage_kind: StageKind,
    pub session_id: Option<String>,
    pub number: i64,
    pub note: String,
    /// `open` or `answered`.
    pub state: String,
    /// The `round_post` call held until the Round is answered; `None` once it is.
    pub held_request_id: Option<String>,
    pub posted_at: String,
    pub answered_at: Option<String>,
    pub questions: Vec<RoundQuestion>,
}

/// The held `round_post` call to answer, once the last question of its Round is answered and the
/// session that posted it is still live.
#[derive(Debug, Clone, PartialEq)]
pub struct RoundRelease {
    pub session_id: String,
    pub request_id: String,
    /// What the call answers the agent with ([`round_result`]).
    pub result: Value,
}

/// What an answer left behind.
#[derive(Debug, Clone, PartialEq)]
pub struct AnswerOutcome {
    pub round_id: String,
    pub project_id: String,
    /// `Some` when this answer completed the Round and its call is still held by a live session.
    pub release: Option<RoundRelease>,
}

fn question_from_row(row: &rusqlite::Row) -> rusqlite::Result<RoundQuestion> {
    Ok(RoundQuestion {
        id: row.get(0)?,
        number: row.get(1)?,
        title: row.get(2)?,
        question: row.get(3)?,
        grounding: row.get(4)?,
        recommended_answer: row.get(5)?,
        because: row.get(6)?,
        answer: row.get(7)?,
        answered_with: row.get(8)?,
        answered_by: row.get(9)?,
        answered_at: row.get(10)?,
    })
}

fn questions_of(conn: &Connection, round_id: &str) -> anyhow::Result<Vec<RoundQuestion>> {
    let mut stmt = conn.prepare(
        "SELECT id, number, title, question, grounding, recommended_answer, because, answer, answered_with,
                answered_by, answered_at
         FROM round_questions WHERE round_id = ?1 ORDER BY number",
    )?;
    let rows = stmt.query_map(params![round_id], question_from_row)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Round's questions")
}

const ROUND_SELECT: &str = "SELECT r.id, r.stage_id, s.kind, r.session_id, r.number, r.note, r.state, r.held_request_id,
        r.posted_at, r.answered_at
     FROM rounds r JOIN stages s ON s.id = r.stage_id";

fn round_from_row(conn: &Connection, row: &rusqlite::Row) -> anyhow::Result<Round> {
    let id: String = row.get(0)?;
    let kind: String = row.get(2)?;
    Ok(Round {
        questions: questions_of(conn, &id)?,
        id,
        stage_id: row.get(1)?,
        stage_kind: StageKind::parse(&kind)?,
        session_id: row.get(3)?,
        number: row.get(4)?,
        note: row.get(5)?,
        state: row.get(6)?,
        held_request_id: row.get(7)?,
        posted_at: row.get(8)?,
        answered_at: row.get(9)?,
    })
}

/// One Round with its questions, or `None`.
pub fn get_round(conn: &Connection, round_id: &str) -> anyhow::Result<Option<Round>> {
    let mut stmt = conn.prepare(&format!("{ROUND_SELECT} WHERE r.id = ?1"))?;
    let mut rows = stmt.query(params![round_id])?;
    match rows.next()? {
        Some(row) => Ok(Some(round_from_row(conn, row)?)),
        None => Ok(None),
    }
}

/// Every Round of an Epic, Stage by Stage and oldest first, each with its questions.
pub fn rounds_for_epic(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<Round>> {
    let mut stmt = conn.prepare(&format!("{ROUND_SELECT} WHERE s.epic_id = ?1 ORDER BY s.rank, r.number"))?;
    let mut rows = stmt.query(params![epic_id])?;
    let mut rounds = Vec::new();
    while let Some(row) = rows.next()? {
        rounds.push(round_from_row(conn, row)?);
    }
    Ok(rounds)
}

/// What a completed Round answers its `round_post` call with: every answer, in order, and what to do
/// next.
pub fn round_result(round: &Round) -> Value {
    let answers: Vec<Value> = round
        .questions
        .iter()
        .map(|q| {
            json!({
                "number": q.number,
                "title": q.title,
                "question": q.question,
                "answer": q.answer,
                "answered_with": q.answered_with,
            })
        })
        .collect();
    json!({
        "round": round.number,
        "stage": round.stage_kind.as_str(),
        "answers": answers,
        "next": "Every question in this Round is answered and saved on the board. Recompute the frontier \
                 from these answers and post the next Round with round_post, or say that the Stage's \
                 frontier is empty and leave closing the Stage to the developer.",
    })
}

/// Post a Round into the open Stage of the shaping session `session_id`, as the agent, holding
/// `held_request_id` (the `round_post` call) until it is answered. One transaction. Refused for a
/// Story session, an ended session, a subject with no open Stage, a Round still open in the Stage,
/// and a malformed Round.
pub fn post_round(
    conn: &mut Connection,
    session_id: &str,
    held_request_id: Option<&str>,
    round: &NewRound,
) -> anyhow::Result<Round> {
    round.validate()?;
    let agent = agent_actor_id(conn)?;
    let at = now();
    let tx = conn.transaction()?;

    match session_kind(&tx, session_id)? {
        None => bail!("session {session_id:?} not found"),
        Some(SessionKind::Story) => {
            bail!("round_post belongs to a shaping session; session {session_id:?} is a Story session")
        }
        Some(SessionKind::Shaping) => {}
    }
    let (status, epic_id, milestone_id): (String, Option<String>, Option<String>) = tx.query_row(
        "SELECT status, epic_id, milestone_id FROM sessions WHERE id = ?1",
        params![session_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer post a Round"
    );
    let subject = match (epic_id.clone(), milestone_id) {
        (Some(id), _) => ShapingSubject::Epic(id),
        (None, Some(id)) => ShapingSubject::Milestone(id),
        (None, None) => bail!("this shaping session has no Epic or Milestone to post a Round on"),
    };
    let stage = open_stage(&tx, &subject)?.context("the record being shaped has no open Stage")?;

    let open: Option<i64> = tx
        .query_row("SELECT number FROM rounds WHERE stage_id = ?1 AND state = 'open'", params![stage.id], |r| r.get(0))
        .optional()?;
    if let Some(n) = open {
        bail!(
            "Round {n} is still open in the {} Stage: every question in it must be answered before the next Round is posted",
            stage.kind.label()
        );
    }
    let number: i64 =
        tx.query_row("SELECT COALESCE(MAX(number), 0) + 1 FROM rounds WHERE stage_id = ?1", params![stage.id], |r| r.get(0))?;

    let round_id = new_id();
    tx.execute(
        "INSERT INTO rounds (id, stage_id, session_id, number, note, state, held_request_id, posted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7)",
        params![round_id, stage.id, session_id, number, round.note.trim(), held_request_id, at],
    )
    .context("failed to insert the Round")?;
    for (i, q) in round.questions.iter().enumerate() {
        tx.execute(
            "INSERT INTO round_questions (id, round_id, number, title, question, grounding, recommended_answer, because)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                new_id(),
                round_id,
                (i + 1) as i64,
                q.title.trim(),
                q.question.trim(),
                q.grounding.trim(),
                q.recommended_answer.trim(),
                q.because.trim()
            ],
        )
        .context("failed to insert a Round question")?;
    }
    let count = round.questions.len();
    record_event(
        &tx,
        &stage.project_id,
        "round",
        &round_id,
        EventScope { story_id: None, epic_id: epic_id.as_deref() },
        &agent,
        "round.posted",
        &json!({
            "field": "round",
            "before": null,
            "after": number,
            "stage": stage.kind.as_str(),
            "questions": count,
            "label": format!("Posted Round {number}: {count} question{}", if count == 1 { "" } else { "s" }),
        }),
        &at,
    )?;
    let posted = get_round(&tx, &round_id)?.context("the Round just posted")?;
    tx.commit().context("failed to commit post_round")?;
    Ok(posted)
}

/// Where a question sits: its Round, the Round's state, the Stage's project and Epic.
struct QuestionPlace {
    round_id: String,
    round_number: i64,
    round_state: String,
    number: i64,
    recommended_answer: String,
    answer: Option<String>,
    project_id: String,
    epic_id: Option<String>,
}

fn question_place(tx: &Transaction, question_id: &str) -> anyhow::Result<QuestionPlace> {
    tx.query_row(
        "SELECT q.round_id, r.number, r.state, q.number, q.recommended_answer, q.answer, s.project_id, s.epic_id
         FROM round_questions q JOIN rounds r ON r.id = q.round_id JOIN stages s ON s.id = r.stage_id
         WHERE q.id = ?1",
        params![question_id],
        |r| {
            Ok(QuestionPlace {
                round_id: r.get(0)?,
                round_number: r.get(1)?,
                round_state: r.get(2)?,
                number: r.get(3)?,
                recommended_answer: r.get(4)?,
                answer: r.get(5)?,
                project_id: r.get(6)?,
                epic_id: r.get(7)?,
            })
        },
    )
    .optional()?
    .with_context(|| format!("question {question_id:?} not found"))
}

/// Write one answer inside the caller's transaction and append `round_question.answered`.
fn write_answer(
    tx: &Transaction,
    actor_id: &str,
    question_id: &str,
    place: &QuestionPlace,
    answer: &RoundAnswer,
    at: &str,
) -> anyhow::Result<()> {
    let (text, with) = match answer {
        RoundAnswer::Recommended => (place.recommended_answer.clone(), "recommended"),
        RoundAnswer::Own(own) => {
            let own = own.trim();
            anyhow::ensure!(!own.is_empty(), "an answer of your own needs some text");
            anyhow::ensure!(own.chars().count() <= MAX_ROUND_TEXT_LEN, "an answer is at most {MAX_ROUND_TEXT_LEN} characters");
            (own.to_string(), "own")
        }
    };
    tx.execute(
        "UPDATE round_questions SET answer = ?1, answered_with = ?2, answered_by = ?3, answered_at = ?4 WHERE id = ?5",
        params![text, with, actor_id, at, question_id],
    )
    .context("failed to store the answer")?;
    record_event(
        tx,
        &place.project_id,
        "round_question",
        question_id,
        EventScope { story_id: None, epic_id: place.epic_id.as_deref() },
        actor_id,
        "round_question.answered",
        &json!({
            "field": "answer",
            "before": place.answer,
            "after": text,
            "answered_with": with,
            "label": format!("Answered question {} of Round {}", place.number, place.round_number),
        }),
        at,
    )?;
    Ok(())
}

/// Close the Round once no question in it is unanswered, inside the caller's transaction: mark it
/// answered, clear its held call and append `round.answered`. Returns the call to answer when one was
/// held by a session that is still live.
fn complete_if_answered(tx: &Transaction, round_id: &str, actor_id: &str, at: &str) -> anyhow::Result<Option<RoundRelease>> {
    let open: i64 =
        tx.query_row("SELECT COUNT(*) FROM round_questions WHERE round_id = ?1 AND answer IS NULL", params![round_id], |r| r.get(0))?;
    if open > 0 {
        return Ok(None);
    }
    let round = get_round(tx, round_id)?.context("the Round being answered")?;
    tx.execute(
        "UPDATE rounds SET state = 'answered', answered_at = ?1, held_request_id = NULL WHERE id = ?2 AND state = 'open'",
        params![at, round_id],
    )
    .context("failed to close the answered Round")?;
    let (project_id, epic_id): (String, Option<String>) =
        tx.query_row("SELECT project_id, epic_id FROM stages WHERE id = ?1", params![round.stage_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    record_event(
        tx,
        &project_id,
        "round",
        round_id,
        EventScope { story_id: None, epic_id: epic_id.as_deref() },
        actor_id,
        "round.answered",
        &json!({
            "field": "state",
            "before": "open",
            "after": "answered",
            "label": format!("Answered every question of Round {}", round.number),
        }),
        at,
    )?;

    let (Some(session_id), Some(request_id)) = (round.session_id.clone(), round.held_request_id.clone()) else {
        return Ok(None);
    };
    let live: bool = tx
        .query_row("SELECT status IN ('running', 'blocked') FROM sessions WHERE id = ?1", params![session_id], |r| r.get(0))
        .optional()?
        .unwrap_or(false);
    if !live {
        return Ok(None);
    }
    let answered = get_round(tx, round_id)?.context("the Round just answered")?;
    Ok(Some(RoundRelease { session_id, request_id, result: round_result(&answered) }))
}

/// Answer one question of an open Round, as the developer. One transaction: refuse any actor but a
/// human, store the answer (the recommendation as it is, or the developer's own words), append its
/// event, and close the Round when this was its last open question.
pub fn answer_round_question(
    conn: &mut Connection,
    actor_id: &str,
    question_id: &str,
    answer: &RoundAnswer,
) -> anyhow::Result<AnswerOutcome> {
    let at = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let place = question_place(&tx, question_id)?;
    if place.round_state != "open" {
        bail!("Round {} is answered; its answers are settled", place.round_number);
    }
    write_answer(&tx, actor_id, question_id, &place, answer, &at)?;
    let release = complete_if_answered(&tx, &place.round_id, actor_id, &at)?;
    tx.commit().context("failed to commit answer_round_question")?;
    Ok(AnswerOutcome { round_id: place.round_id, project_id: place.project_id, release })
}

/// Answer every still-open question of an open Round with its recommended answer, as the developer,
/// in one transaction, and close the Round. Questions only: no Proposal is decided here.
pub fn accept_all_recommended(conn: &mut Connection, actor_id: &str, round_id: &str) -> anyhow::Result<AnswerOutcome> {
    let at = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let (number, state): (i64, String) = tx
        .query_row("SELECT number, state FROM rounds WHERE id = ?1", params![round_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .with_context(|| format!("Round {round_id:?} not found"))?;
    if state != "open" {
        bail!("Round {number} is answered; its answers are settled");
    }
    let open: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM round_questions WHERE round_id = ?1 AND answer IS NULL ORDER BY number")?;
        let ids = stmt.query_map(params![round_id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        ids
    };
    anyhow::ensure!(!open.is_empty(), "no question in Round {number} is left open");
    let mut project_id = String::new();
    for question_id in &open {
        let place = question_place(&tx, question_id)?;
        write_answer(&tx, actor_id, question_id, &place, &RoundAnswer::Recommended, &at)?;
        project_id = place.project_id;
    }
    let release = complete_if_answered(&tx, round_id, actor_id, &at)?;
    tx.commit().context("failed to commit accept_all_recommended")?;
    Ok(AnswerOutcome { round_id: round_id.to_string(), project_id, release })
}
