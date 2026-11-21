//! A Quick Story (docs/mvp-spec.md §4.7, ADR 0044): one text
//! field makes a Story with default criteria, ready to start, for a one-off fix or a question.
//!
//! The Story is written by [`write_story_by_hand`], so it is the same record as any other and it
//! shows on the board. Its home is the Epic "Quick Stories" of the project: the first open Epic of
//! that title, found or made on first use inside the Current Milestone (or a Milestone "Quick
//! Stories" when the project has none open). Starting it is the caller's job: the command calls
//! `story_start` next, so this module never launches a session.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::epic::create_epic;
use crate::domain::milestone::{create_milestone, current_milestone};
use crate::domain::story::{write_story_by_hand, HandWrittenCriterion, Story};

/// The title of the Epic every Quick Story of a project lives in.
pub const QUICK_EPIC_TITLE: &str = "Quick Stories";

/// The one criterion a Quick Story carries. It has no Check: the developer judges it at review.
pub const DEFAULT_CRITERION: &str =
    "The request in the Story description is done, or the question is answered in the hand-off.";

/// The longest title, in characters. A longer first line is cut and ends with an ellipsis.
const MAX_TITLE_CHARS: usize = 80;

/// The longest request, in characters.
pub const MAX_REQUEST_LEN: usize = 4000;

/// The Story title for `request`: its first line, cut at [`MAX_TITLE_CHARS`] characters.
pub fn title_for(request: &str) -> String {
    let first = request.trim().lines().next().unwrap_or("").trim();
    if first.chars().count() <= MAX_TITLE_CHARS {
        return first.to_string();
    }
    let cut: String = first.chars().take(MAX_TITLE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// The id of the project's open Quick Stories Epic, made when there is none.
fn quick_epic_id(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
) -> anyhow::Result<String> {
    let found: Option<String> = conn
        .query_row(
            "SELECT id FROM epics WHERE project_id = ?1 AND title = ?2 AND state NOT IN ('done', 'dropped')
             ORDER BY rank, id LIMIT 1",
            params![project_id, QUICK_EPIC_TITLE],
            |r| r.get(0),
        )
        .optional()?;
    if let Some(id) = found {
        return Ok(id);
    }
    let milestone = match current_milestone(conn, project_id)? {
        Some(m) => m,
        None => create_milestone(conn, project_id, actor_id, QUICK_EPIC_TITLE, None)?,
    };
    Ok(create_epic(conn, actor_id, &milestone.id, QUICK_EPIC_TITLE)?.id)
}

/// Write the Quick Story of `request` in `project_id`, Ready, with [`DEFAULT_CRITERION`]. Developer-only
/// (the writers refuse an agent). A blank request, or one over [`MAX_REQUEST_LEN`], writes nothing.
pub fn write_quick_story(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    request: &str,
) -> anyhow::Result<Story> {
    let request = request.trim();
    anyhow::ensure!(
        !request.is_empty(),
        "A Quick Story needs words: say what to do or ask."
    );
    let chars = request.chars().count();
    anyhow::ensure!(
        chars <= MAX_REQUEST_LEN,
        "A Quick Story is at most {MAX_REQUEST_LEN} characters, and this one has {chars}."
    );
    let epic_id = quick_epic_id(conn, actor_id, project_id)
        .context("failed to find the Quick Stories Epic")?;
    write_story_by_hand(
        conn,
        actor_id,
        &epic_id,
        &title_for(request),
        Some(request),
        &[HandWrittenCriterion {
            statement: DEFAULT_CRITERION,
            check_command: None,
        }],
    )
}
