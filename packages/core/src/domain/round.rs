//! Rounds (docs/mvp-spec.md §3, GLOSSARY.md "Round", issue #123): a batch of numbered questions an
//! agent asks during a Stage, each with a recommended answer the developer accepts as it is or
//! replaces with their own.
//!
//! - [`post_round`] writes a Round into the shaping session's open Stage. The session is the only
//!   identity: the Stage, the subject and the project are read from it, never from an argument. It
//!   is refused while a Round is still open in the Stage, and the refusal names `round_wait`.
//! - [`wait_round`] (issue #124) is a later session's way back onto the open Round: it takes the
//!   Round over (its session and its held call become the caller's) and is held until the Round is
//!   answered, or answered at once with the Stage's latest Round when that one is already complete.
//! - [`answer_round_question`] answers one question, human-only, in its own transaction, so each
//!   answer is in the database before the next is given. The answer that completes the Round also
//!   closes it and hands back the held `round_post` call to answer ([`RoundRelease`]), with every
//!   answer, when the session that posted it is still live.
//! - [`accept_all_recommended`] answers every open question of a Round with its recommendation.
//!   Questions only: it never decides a Proposal, so it leaves an ADR question open.
//!
//! An ADR question (issue #129, docs/mvp-spec.md §3 "ADRs in shaping") offers an ADR draft with its
//! bar lines ([`AdrDraft`]) and is answered Yes or No. "Yes" files an ADR Proposal on the Epic and
//! accepts it, as the developer, in the answer's own transaction (through `proposal`'s filing and
//! deciding, never around them); "No" drops the draft. Either answer is settled once given.
//!
//! An answer may change while its Round is open; once the last question is answered the Round is
//! settled. A Round outlives its session: answering goes on without one, and nothing is lost.

use anyhow::{bail, Context};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::proposal::{accept_proposal_in_tx, file_proposal_in_tx, NewProposal, ProposalTarget, ProposalVerb};
pub use crate::domain::proposal_apply::AdrDraft;
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
    /// `Some` for an ADR question (issue #129): the draft offered and its bar lines. Its
    /// recommended answer is Yes or No.
    pub adr: Option<AdrDraft>,
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
            if let Some(adr) = &q.adr {
                AdrDraft::from_payload_at(&adr.to_payload(), &format!("questions[{i}].adr."))?;
                anyhow::ensure!(
                    yes_or_no(&q.recommended_answer).is_some(),
                    "{}: an ADR question is answered Yes or No; recommend one of them",
                    at("recommended_answer")
                );
            }
        }
        Ok(())
    }
}

/// An ADR question's answer read as Yes (`true`) or No (`false`): the word alone, any case, with
/// trailing punctuation. Anything else is `None`.
pub fn yes_or_no(answer: &str) -> Option<bool> {
    match answer.trim().trim_end_matches(['.', '!']).to_ascii_lowercase().as_str() {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    }
}

fn yes_no_word(yes: bool) -> &'static str {
    if yes {
        "Yes"
    } else {
        "No"
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
    /// `Some` for an ADR question: the draft and its bar lines (issue #129).
    pub adr: Option<AdrDraft>,
    /// The accepted ADR Proposal its "Yes" filed.
    pub adr_proposal_id: Option<String>,
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
    /// The `round_post` or `round_wait` call held until the Round is answered; `None` once it is.
    /// It stays set when the session holding it dies, until a `round_wait` takes the Round over.
    pub held_request_id: Option<String>,
    pub posted_at: String,
    pub answered_at: Option<String>,
    /// Derived, never stored (issue #124): the Round is open and a LIVE session is held on it, so it is
    /// Waiting on you (`crate::query::round_waiting_on_you`).
    pub waiting_on_you: bool,
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
        adr: adr_from_row(row, 11)?,
        adr_proposal_id: row.get(18)?,
    })
}

/// The ADR draft of a `round_questions` row whose `kind` is at `at`, followed by `adr_path`,
/// `adr_text` and the four bar lines.
fn adr_from_row(row: &rusqlite::Row, at: usize) -> rusqlite::Result<Option<AdrDraft>> {
    let kind: String = row.get(at)?;
    if kind != "adr" {
        return Ok(None);
    }
    Ok(Some(AdrDraft {
        path: row.get(at + 1)?,
        text: row.get(at + 2)?,
        hard_to_reverse: row.get(at + 3)?,
        surprising: row.get(at + 4)?,
        losing_alternative: row.get(at + 5)?,
        relates_to: row.get(at + 6)?,
    }))
}

/// A question's kind and ADR columns, in the order [`adr_from_row`] reads them.
const ADR_COLUMNS: &str =
    "kind, adr_path, adr_text, bar_hard_to_reverse, bar_surprising, bar_losing_alternative, bar_relates_to";

fn questions_of(conn: &Connection, round_id: &str) -> anyhow::Result<Vec<RoundQuestion>> {
    let mut stmt = conn.prepare(
        &format!(
            "SELECT id, number, title, question, grounding, recommended_answer, because, answer, answered_with,
                    answered_by, answered_at, {ADR_COLUMNS}, adr_proposal_id
             FROM round_questions WHERE round_id = ?1 ORDER BY number"
        ),
    )?;
    let rows = stmt.query_map(params![round_id], question_from_row)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Round's questions")
}

const ROUND_SELECT: &str = concat!(
    "SELECT r.id, r.stage_id, s.kind, r.session_id, r.number, r.note, r.state, r.held_request_id, \
        r.posted_at, r.answered_at, ",
    crate::query::round_waiting_on_you!(),
    " FROM rounds r JOIN stages s ON s.id = r.stage_id"
);

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
        waiting_on_you: row.get(10)?,
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

/// Every Round of a Milestone (issue #132), oldest first, each with its questions: its one Stage,
/// Exit test, holds them all.
pub fn rounds_for_milestone(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<Round>> {
    let mut stmt = conn.prepare(&format!("{ROUND_SELECT} WHERE s.milestone_id = ?1 ORDER BY s.rank, r.number"))?;
    let mut rows = stmt.query(params![milestone_id])?;
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
            let mut answer = json!({
                "number": q.number,
                "title": q.title,
                "question": q.question,
                "answer": q.answer,
                "answered_with": q.answered_with,
            });
            if let Some(adr) = &q.adr {
                answer["kind"] = json!("adr");
                answer["adr"] = match &q.adr_proposal_id {
                    Some(id) => json!({
                        "path": adr.path,
                        "proposal_id": id,
                        "outcome": "Accepted and attached to the Epic: the Epic's first Story writes it verbatim. Do not offer it again.",
                    }),
                    None => json!({
                        "path": adr.path,
                        "outcome": "Dropped: no ADR is written. Do not offer it again without new evidence.",
                    }),
                };
            }
            answer
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

    let (stage, epic_id) = live_shaping_stage(&tx, session_id, "round_post", "post a Round")?;
    anyhow::ensure!(
        epic_id.is_some() || round.questions.iter().all(|q| q.adr.is_none()),
        "an ADR is offered while shaping an Epic, and attached to it; this session shapes a Milestone"
    );
    let open: Option<i64> = tx
        .query_row("SELECT number FROM rounds WHERE stage_id = ?1 AND state = 'open'", params![stage.id], |r| r.get(0))
        .optional()?;
    if let Some(n) = open {
        bail!(
            "Round {n} is still open in the {} Stage: every question in it must be answered before the next Round is \
             posted. Call round_wait to wait for the developer's answers to Round {n}, then post the next Round.",
            stage.kind.label()
        );
    }
    let number: i64 =
        tx.query_row("SELECT COALESCE(MAX(number), 0) + 1 FROM rounds WHERE stage_id = ?1", params![stage.id], |r| r.get(0))?;

    let round_id = new_id();
    tx.execute(
        "INSERT INTO rounds (id, project_id, stage_id, session_id, number, note, state, held_request_id, posted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8)",
        params![round_id, stage.project_id, stage.id, session_id, number, round.note.trim(), held_request_id, at],
    )
    .context("failed to insert the Round")?;
    for (i, q) in round.questions.iter().enumerate() {
        // An ADR question's draft is stored as `AdrDraft` reads it back: trimmed, "none" as NULL, and
        // its recommendation as the bare Yes or No.
        let adr = q.adr.as_ref().map(|a| AdrDraft::from_payload(&a.to_payload())).transpose()?;
        let recommended = match (&adr, yes_or_no(&q.recommended_answer)) {
            (Some(_), Some(yes)) => yes_no_word(yes).to_string(),
            _ => q.recommended_answer.trim().to_string(),
        };
        tx.execute(
            &format!(
                "INSERT INTO round_questions (id, round_id, number, title, question, grounding, recommended_answer, because,
                     {ADR_COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"
            ),
            params![
                new_id(),
                round_id,
                (i + 1) as i64,
                q.title.trim(),
                q.question.trim(),
                q.grounding.trim(),
                recommended,
                q.because.trim(),
                if adr.is_some() { "adr" } else { "question" },
                adr.as_ref().map(|a| &a.path),
                adr.as_ref().map(|a| &a.text),
                adr.as_ref().map(|a| &a.hard_to_reverse),
                adr.as_ref().map(|a| &a.surprising),
                adr.as_ref().map(|a| &a.losing_alternative),
                adr.as_ref().and_then(|a| a.relates_to.as_ref()),
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

/// The open Stage of the record the live shaping session `session_id` shapes, with its Epic, inside
/// the caller's transaction. Refused for an unknown session, a Story session, an ended session and a
/// record with no open Stage; `tool` and `act` word the refusal.
fn live_shaping_stage(
    tx: &Transaction,
    session_id: &str,
    tool: &str,
    act: &str,
) -> anyhow::Result<(crate::domain::stage::Stage, Option<String>)> {
    match session_kind(tx, session_id)? {
        None => bail!("session {session_id:?} not found"),
        Some(SessionKind::Story) => {
            bail!("{tool} belongs to a shaping session; session {session_id:?} is a Story session")
        }
        Some(SessionKind::Shaping) => {}
    }
    let (status, epic_id, milestone_id): (String, Option<String>, Option<String>) = tx.query_row(
        "SELECT status, epic_id, milestone_id FROM sessions WHERE id = ?1",
        params![session_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    anyhow::ensure!(status == "running" || status == "blocked", "this session has ended ({status}); it can no longer {act}");
    let subject = match (epic_id.clone(), milestone_id) {
        (Some(id), _) => ShapingSubject::Epic(id),
        (None, Some(id)) => ShapingSubject::Milestone(id),
        (None, None) => bail!("this shaping session has no Epic or Milestone to {act} on"),
    };
    let stage = open_stage(tx, &subject)?.context("the record being shaped has no open Stage")?;
    Ok((stage, epic_id))
}

/// What a `round_wait` call left behind.
#[derive(Debug, Clone, PartialEq)]
pub enum RoundWait {
    /// The open Round is now held by this call, until its last question is answered.
    Held(Round),
    /// No Round is open and the Stage's latest Round is answered: the call is answered at once with it.
    Answered(Round),
}

/// Wait on the open Round of the live shaping session `session_id`'s open Stage, as the agent
/// (issue #124). One transaction. A Round outlives the session that posted it, so a later session
/// takes the open Round over: its `session_id` and `held_request_id` become this session's and this
/// call's, the Round's answers so far untouched, and `round.resumed` is appended. The call is then held
/// until the last question is answered (`answer_round_question` releases it as it would a
/// `round_post`). When no Round is open but the Stage's latest Round is answered (the developer
/// finished it while no session was live), nothing is written and the call is answered at once.
/// Refused like `post_round` for a Story session, an ended session or a record with no open Stage,
/// when the Stage has no Round yet, and while another live session is held on the Round.
pub fn wait_round(conn: &mut Connection, session_id: &str, held_request_id: &str) -> anyhow::Result<RoundWait> {
    let agent = agent_actor_id(conn)?;
    let at = now();
    let tx = conn.transaction()?;
    let (stage, epic_id) = live_shaping_stage(&tx, session_id, "round_wait", "wait on a Round")?;

    let open: Option<String> = tx
        .query_row("SELECT id FROM rounds WHERE stage_id = ?1 AND state = 'open'", params![stage.id], |r| r.get(0))
        .optional()?;
    let Some(round_id) = open else {
        let latest: Option<String> = tx
            .query_row(
                "SELECT id FROM rounds WHERE stage_id = ?1 ORDER BY number DESC LIMIT 1",
                params![stage.id],
                |r| r.get(0),
            )
            .optional()?;
        let latest = latest.with_context(|| {
            format!(
                "no Round has been posted in the {} Stage yet, so there is nothing to wait on: post the first one with round_post",
                stage.kind.label()
            )
        })?;
        let answered = get_round(&tx, &latest)?.context("the Stage's latest Round")?;
        return Ok(RoundWait::Answered(answered));
    };

    let round = get_round(&tx, &round_id)?.context("the open Round")?;
    if round.waiting_on_you && round.session_id.as_deref() != Some(session_id) {
        bail!("Round {} is held by another live shaping session; only one session shapes a record at a time", round.number);
    }
    tx.execute(
        "UPDATE rounds SET session_id = ?1, held_request_id = ?2 WHERE id = ?3 AND state = 'open'",
        params![session_id, held_request_id, round_id],
    )
    .context("failed to take the open Round over")?;
    let answered = round.questions.iter().filter(|q| q.answer.is_some()).count();
    record_event(
        &tx,
        &stage.project_id,
        "round",
        &round_id,
        EventScope { story_id: None, epic_id: epic_id.as_deref() },
        &agent,
        "round.resumed",
        &json!({
            "field": "session",
            "before": round.session_id,
            "after": session_id,
            "label": format!("Resumed waiting on Round {}: {answered} of {} answered", round.number, round.questions.len()),
        }),
        &at,
    )?;
    let taken = get_round(&tx, &round_id)?.context("the Round just taken over")?;
    tx.commit().context("failed to commit wait_round")?;
    Ok(RoundWait::Held(taken))
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
    /// The session that posted the Round: an ADR Proposal is filed under it.
    session_id: Option<String>,
    adr: Option<AdrDraft>,
}

fn question_place(tx: &Transaction, question_id: &str) -> anyhow::Result<QuestionPlace> {
    tx.query_row(
        &format!(
            "SELECT q.round_id, r.number, r.state, q.number, q.recommended_answer, q.answer, s.project_id, s.epic_id,
                    r.session_id, q.{}
             FROM round_questions q JOIN rounds r ON r.id = q.round_id JOIN stages s ON s.id = r.stage_id
             WHERE q.id = ?1",
            ADR_COLUMNS.replace(", ", ", q.")
        ),
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
                session_id: r.get(8)?,
                adr: adr_from_row(r, 9)?,
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
    let (mut text, mut with) = match answer {
        RoundAnswer::Recommended => (place.recommended_answer.clone(), "recommended"),
        RoundAnswer::Own(own) => {
            let own = own.trim();
            anyhow::ensure!(!own.is_empty(), "an answer of your own needs some text");
            anyhow::ensure!(own.chars().count() <= MAX_ROUND_TEXT_LEN, "an answer is at most {MAX_ROUND_TEXT_LEN} characters");
            (own.to_string(), "own")
        }
    };
    let mut adr_proposal_id: Option<String> = None;
    if let Some(draft) = &place.adr {
        if let Some(given) = &place.answer {
            bail!(
                "question {} of Round {} offered an ADR and was answered {given}; that answer is settled",
                place.number,
                place.round_number
            );
        }
        let yes = yes_or_no(&text).context("an ADR question is answered Yes or No")?;
        text = yes_no_word(yes).to_string();
        with = if yes_or_no(&place.recommended_answer) == Some(yes) { "recommended" } else { "own" };
        if yes {
            adr_proposal_id = Some(accept_adr_in_tx(tx, actor_id, place, draft, at)?);
        }
    }
    tx.execute(
        "UPDATE round_questions SET answer = ?1, answered_with = ?2, answered_by = ?3, answered_at = ?4, adr_proposal_id = ?5
         WHERE id = ?6",
        params![text, with, actor_id, at, adr_proposal_id, question_id],
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

/// "Yes" to an ADR question: file the draft as an ADR Proposal on the Epic, then accept it, both as
/// the developer and inside the answer's transaction, through `proposal`'s own filing and deciding.
/// Returns the Proposal's id.
fn accept_adr_in_tx(tx: &Transaction, actor_id: &str, place: &QuestionPlace, draft: &AdrDraft, at: &str) -> anyhow::Result<String> {
    let epic_id = place.epic_id.as_deref().context("an ADR is attached to the Epic being shaped; this Round shapes no Epic")?;
    let rationale = format!("Offered as question {} of Round {} and accepted there", place.number, place.round_number);
    let id = file_proposal_in_tx(
        tx,
        actor_id,
        &NewProposal {
            project_id: &place.project_id,
            session_id: place.session_id.as_deref(),
            epic_id: Some(epic_id),
            verb: ProposalVerb::Create,
            target: ProposalTarget::Adr,
            target_id: None,
            payload: draft.to_payload(),
            rationale: Some(&rationale),
        },
        at,
    )?;
    accept_proposal_in_tx(tx, actor_id, &id, at)?;
    Ok(id)
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
/// in one transaction, and close the Round once nothing in it is left open. Questions only: no
/// Proposal is decided here, so an ADR question, whose Yes accepts a Proposal, stays open for its own
/// Yes or No. Refused when only ADR questions are left open.
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
        let mut stmt = tx.prepare(
            "SELECT id FROM round_questions WHERE round_id = ?1 AND answer IS NULL AND kind = 'question' ORDER BY number",
        )?;
        let ids = stmt.query_map(params![round_id], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        ids
    };
    if open.is_empty() {
        let open_adrs: i64 = tx.query_row(
            "SELECT COUNT(*) FROM round_questions WHERE round_id = ?1 AND answer IS NULL AND kind = 'adr'",
            params![round_id],
            |r| r.get(0),
        )?;
        anyhow::ensure!(open_adrs == 0, "only ADR questions are left open in Round {number}: answer each one Yes or No");
        bail!("no question in Round {number} is left open");
    }
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
