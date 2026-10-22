//! Stages (docs/mvp-spec.md §3, GLOSSARY.md "Stage", issue #123): the steps of shaping a record.
//! An Epic is shaped in three Stages, one after another (challenge the spec, slice it into Stories,
//! write the Acceptance criteria); a Milestone in one (its exit test). At most one Stage of a
//! subject is open at a time, and the developer closes it.
//!
//! The core opens a subject's first Stage when shaping starts on it ([`ensure_open_stage_in_tx`],
//! called inside `session::start_shaping_session`'s transaction). No agent writes a Stage.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::session::ShapingSubject;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// A Stage's kind: which step of shaping it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StageKind {
    /// An Epic's first Stage: probe the problem, the scope, what is out of scope and the exit test.
    ChallengeSpec,
    /// An Epic's second Stage: slice it into Stories.
    Slice,
    /// An Epic's third Stage: write each Story's Acceptance criteria and Checks.
    Criteria,
    /// A Milestone's one Stage: challenge its exit test.
    ExitTest,
}

impl StageKind {
    /// An Epic's Stages, in order.
    pub const EPIC: [StageKind; 3] = [StageKind::ChallengeSpec, StageKind::Slice, StageKind::Criteria];

    /// The `stages.kind` value.
    pub fn as_str(self) -> &'static str {
        match self {
            StageKind::ChallengeSpec => "challenge_spec",
            StageKind::Slice => "slice",
            StageKind::Criteria => "criteria",
            StageKind::ExitTest => "exit_test",
        }
    }

    /// The kind a `stages.kind` value names.
    pub fn parse(value: &str) -> anyhow::Result<StageKind> {
        [StageKind::ChallengeSpec, StageKind::Slice, StageKind::Criteria, StageKind::ExitTest]
            .into_iter()
            .find(|kind| kind.as_str() == value)
            .with_context(|| format!("{value:?} is not a Stage kind"))
    }

    /// The Stage's name as the developer reads it.
    pub fn label(self) -> &'static str {
        match self {
            StageKind::ChallengeSpec => "Challenge the spec",
            StageKind::Slice => "Slice into Stories",
            StageKind::Criteria => "Write the Acceptance criteria",
            StageKind::ExitTest => "Exit test",
        }
    }
}

/// One `stages` row.
#[derive(Debug, Clone, PartialEq)]
pub struct Stage {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub milestone_id: Option<String>,
    pub kind: StageKind,
    /// `open` or `closed`.
    pub state: String,
    pub rank: i64,
    pub opened_at: String,
    pub closed_at: Option<String>,
}

const STAGE_COLUMNS: &str = "id, project_id, epic_id, milestone_id, kind, state, rank, opened_at, closed_at";

fn stage_from_row(row: &rusqlite::Row) -> rusqlite::Result<Stage> {
    let kind: String = row.get(4)?;
    Ok(Stage {
        id: row.get(0)?,
        project_id: row.get(1)?,
        epic_id: row.get(2)?,
        milestone_id: row.get(3)?,
        kind: StageKind::parse(&kind)
            .map_err(|e| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, e.into()))?,
        state: row.get(5)?,
        rank: row.get(6)?,
        opened_at: row.get(7)?,
        closed_at: row.get(8)?,
    })
}

/// The subject's open Stage, or `None`.
pub fn open_stage(conn: &Connection, subject: &ShapingSubject) -> anyhow::Result<Option<Stage>> {
    let (sql, id) = match subject {
        ShapingSubject::Epic(id) => (format!("SELECT {STAGE_COLUMNS} FROM stages WHERE epic_id = ?1 AND state = 'open'"), id),
        ShapingSubject::Milestone(id) => {
            (format!("SELECT {STAGE_COLUMNS} FROM stages WHERE milestone_id = ?1 AND state = 'open'"), id)
        }
    };
    conn.query_row(&sql, params![id], stage_from_row).optional().context("failed to read the open Stage")
}

/// Every Stage of an Epic, in order.
pub fn stages_for_epic(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<Stage>> {
    let mut stmt = conn.prepare(&format!("SELECT {STAGE_COLUMNS} FROM stages WHERE epic_id = ?1 ORDER BY rank, id"))?;
    let rows = stmt.query_map(params![epic_id], stage_from_row)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Epic's Stages")
}

/// The open Stage of `subject` inside the caller's transaction, opening its first Stage when it has
/// none yet (an Epic's Challenge the spec, a Milestone's Exit test) and appending `stage.opened`.
/// Refused when every Stage of the subject is closed: nothing is left to shape.
pub(crate) fn ensure_open_stage_in_tx(
    tx: &Transaction,
    project_id: &str,
    subject: &ShapingSubject,
    actor_id: &str,
) -> anyhow::Result<String> {
    if let Some(stage) = open_stage(tx, subject)? {
        return Ok(stage.id);
    }
    let (epic_id, milestone_id, kind) = match subject {
        ShapingSubject::Epic(id) => (Some(id.as_str()), None, StageKind::ChallengeSpec),
        ShapingSubject::Milestone(id) => (None, Some(id.as_str()), StageKind::ExitTest),
    };
    let existing: i64 = tx.query_row(
        "SELECT COUNT(*) FROM stages WHERE epic_id IS ?1 AND milestone_id IS ?2",
        params![epic_id, milestone_id],
        |r| r.get(0),
    )?;
    anyhow::ensure!(existing == 0, "every Stage of this record is closed; there is nothing left to shape");

    let id = new_id();
    let at = now();
    tx.execute(
        "INSERT INTO stages (id, project_id, epic_id, milestone_id, kind, state, rank, opened_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'open', 1, ?6)",
        params![id, project_id, epic_id, milestone_id, kind.as_str(), at],
    )
    .context("failed to open the first Stage")?;
    record_event(
        tx,
        project_id,
        "stage",
        &id,
        EventScope { story_id: None, epic_id },
        actor_id,
        "stage.opened",
        &serde_json::json!({
            "field": "state",
            "before": null,
            "after": "open",
            "kind": kind.as_str(),
            "label": format!("Opened the {} Stage", kind.label()),
        }),
        &at,
    )?;
    Ok(id)
}
