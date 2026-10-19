//! The Story agent's Task board tool (docs/mvp-spec.md §4.3, issue #52): the one way a Story
//! session writes its own checklist. The sidecar's MCP server hosts the tool, relays each call to
//! the Rust core over IPC, and never opens the database; this module is what the core runs.
//!
//! Three calls: `task_list` reads the checklist, `task_add` appends one or more open Tasks (the
//! plan an agent writes at the start of its first session), and `task_update` moves one Task to
//! open, doing, done, or dropped with a one-line reason, and/or replaces its note (issue #96: what
//! the agent has learned on the Task, so a stopped session does not lose it). Every call commits
//! before it answers, so a session killed a moment later keeps what it wrote.
//!
//! Identity comes from the session the call arrived on, never from an argument: a call reaches only
//! that session's own Story, and only while the session is live. Nothing here reads a diff or a
//! transcript: a Task changes state only through an explicit call, the agent's or the developer's.

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::domain::session::agent_actor_id;
use crate::domain::task::{add_task, set_task_note, set_task_state, tasks_for_story, Task, TaskState, MAX_TASK_NOTE_LEN};

/// The tool names the sidecar's MCP server registers, in the order it lists them. Mirrored by
/// `TASK_TOOL_NAMES` in `packages/sidecar/src/mcp-permission-server.ts`.
pub const TASK_TOOL_NAMES: [&str; 3] = ["task_list", "task_add", "task_update"];

/// The longest Task title the tool accepts, matching the command surface's own title limit.
pub const MAX_TASK_TITLE_LEN: usize = 500;

/// The most Tasks one `task_add` call may append.
pub const MAX_TASKS_PER_ADD: usize = 50;

/// One parsed call of the board tool.
#[derive(Debug, Clone, PartialEq)]
pub enum TaskToolCall {
    List,
    Add { titles: Vec<String> },
    /// Move the Task to `state` and/or replace its note; at least one of the two is given. A
    /// `Some("")` note clears it.
    Update { task_id: String, state: Option<TaskState>, reason: Option<String>, note: Option<String> },
}

impl TaskToolCall {
    /// Parse a call from the tool name and its JSON arguments, refusing anything malformed before
    /// any write happens.
    pub fn parse(tool: &str, args: &Value) -> anyhow::Result<Self> {
        match tool {
            "task_list" => Ok(TaskToolCall::List),
            "task_add" => {
                let titles = args
                    .get("titles")
                    .and_then(Value::as_array)
                    .context("task_add needs `titles`, a list of Task titles")?;
                anyhow::ensure!(!titles.is_empty(), "task_add needs at least one title");
                anyhow::ensure!(titles.len() <= MAX_TASKS_PER_ADD, "task_add takes at most {MAX_TASKS_PER_ADD} titles");
                let titles = titles
                    .iter()
                    .map(|t| {
                        let title = t.as_str().context("every Task title is a string")?.trim();
                        anyhow::ensure!(!title.is_empty(), "a Task needs a title");
                        anyhow::ensure!(
                            title.chars().count() <= MAX_TASK_TITLE_LEN,
                            "a Task title is at most {MAX_TASK_TITLE_LEN} characters"
                        );
                        Ok(title.to_string())
                    })
                    .collect::<anyhow::Result<Vec<_>>>()?;
                Ok(TaskToolCall::Add { titles })
            }
            "task_update" => {
                let task_id = args.get("task_id").and_then(Value::as_str).context("task_update needs `task_id`")?;
                let state = match args.get("state") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(TaskState::parse(v.as_str().context("`state` is a string")?)?),
                };
                let note = match args.get("note") {
                    None | Some(Value::Null) => None,
                    Some(v) => Some(v.as_str().context("`note` is a string")?.trim().to_string()),
                };
                anyhow::ensure!(state.is_some() || note.is_some(), "task_update needs `state`, `note`, or both");
                if let Some(note) = &note {
                    anyhow::ensure!(
                        note.chars().count() <= MAX_TASK_NOTE_LEN,
                        "a Task note is at most {MAX_TASK_NOTE_LEN} characters"
                    );
                }
                let reason = args.get("reason").and_then(Value::as_str).map(str::trim).filter(|r| !r.is_empty());
                match state {
                    Some(TaskState::Dropped) => anyhow::ensure!(reason.is_some(), "a dropped Task needs a one-line reason"),
                    _ => anyhow::ensure!(reason.is_none(), "only a dropped Task carries a reason"),
                }
                if let Some(reason) = reason {
                    anyhow::ensure!(
                        reason.chars().count() <= MAX_TASK_TITLE_LEN,
                        "a drop reason is one line, at most {MAX_TASK_TITLE_LEN} characters"
                    );
                }
                Ok(TaskToolCall::Update { task_id: task_id.to_string(), state, reason: reason.map(str::to_string), note })
            }
            other => anyhow::bail!("{other:?} is not a Task tool"),
        }
    }
}

/// What a call left behind: the Story's checklist after the call, in order, and where it lives.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskToolOutcome {
    pub project_id: String,
    pub story_id: String,
    pub tasks: Vec<Task>,
}

/// Run one call for session `session_id`, writing as the agent actor. Refused when the session is
/// unknown or has ended, and when a `task_update` names a Task of another Story.
pub fn apply_task_tool_call(conn: &mut Connection, session_id: &str, call: &TaskToolCall) -> anyhow::Result<TaskToolOutcome> {
    let (story_id, project_id, status): (String, String, String) = conn
        .query_row(
            "SELECT story_id, project_id, status FROM sessions WHERE id = ?1",
            params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .with_context(|| format!("session {session_id:?} not found"))?;
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); its Tasks can no longer be written from it"
    );
    let agent = agent_actor_id(conn)?;

    match call {
        TaskToolCall::List => {}
        TaskToolCall::Add { titles } => {
            for title in titles {
                add_task(conn, &agent, &story_id, title)?;
            }
        }
        TaskToolCall::Update { task_id, state, reason, note } => {
            let owner: Option<String> = conn
                .query_row("SELECT story_id FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0))
                .ok();
            anyhow::ensure!(owner.as_deref() == Some(story_id.as_str()), "{task_id:?} is not a Task of this Story");
            // The note first: a refused state change (another Task already doing) still keeps
            // what the agent wrote down.
            if let Some(note) = note {
                set_task_note(conn, &agent, task_id, note)?;
            }
            if let Some(state) = state {
                set_task_state(conn, &agent, task_id, *state, reason.as_deref())?;
            }
        }
    }

    let tasks = tasks_for_story(conn, &story_id)?;
    Ok(TaskToolOutcome { project_id, story_id, tasks })
}

/// The checklist as the tool answers it to the agent: one object per Task, in order.
pub fn tasks_as_tool_result(tasks: &[Task]) -> Value {
    let rows: Vec<Value> = tasks
        .iter()
        .map(|t| {
            let mut row = serde_json::json!({ "task_id": t.id, "title": t.title, "state": t.state });
            if let Some(reason) = &t.dropped_reason {
                row["reason"] = Value::String(reason.clone());
            }
            if let Some(note) = &t.note {
                row["note"] = Value::String(note.clone());
            }
            row
        })
        .collect();
    serde_json::json!({ "tasks": rows })
}
