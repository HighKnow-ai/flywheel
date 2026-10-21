//! `permission_requests` (AGNT-06, D-36, D-37): `create_pending_request`/`answer_request` —
//! the once-only answer transition that makes a gated tool call genuinely halt an agent until a
//! human decides.
//!
//! Follows `domain::acceptance_criterion`'s "child row with a status-toggle mutation" shape and
//! the transactional-outbox pattern every domain mutation in this crate uses (`domain::event`):
//! one `conn.transaction()`, the row write, `next_sequence` + `append_event` inside it, one
//! commit. `create_pending_request` additionally moves its run to `blocked`
//! (`domain::session::set_run_blocked`) and `answer_request` moves it back to `running`
//! (`domain::session::clear_run_blocked`) — both calls happen INSIDE the same transaction as
//! the request row's own write, so a blocked run and its pending request can never disagree.
//!
//! The once-only property is a property of `answer_request`'s guarded UPDATE (its WHERE clause
//! includes `status = 'pending'`), not of a read-then-write race: an affected-row count of zero
//! means the row was already answered (or never existed), and that path writes nothing and
//! appends no second event.

use anyhow::{bail, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::destructive::DestructiveCategory;
use crate::domain::session::{clear_run_blocked, set_run_blocked};
use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;

/// A `permission_requests` row, as read back after [`create_pending_request`] or
/// [`answer_request`] commits.
///
/// `session_id` names the `sessions` row that raised it; `story_id` is that session's Story.
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRequest {
    pub id: String,
    pub session_id: String,
    pub story_id: String,
    pub project_id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub status: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
    /// D-56's category name (`destructive::DestructiveCategory::as_str()`), or `None` for the
    /// routine permission-request variant. Populated only via [`create_pending_request`]'s own
    /// `destructive_category` parameter — never written anywhere else.
    pub destructive_category: Option<String>,
}

/// Returned by [`answer_request`] when the target row is no longer `pending` — the once-only
/// answer property surfaces as this error rather than as a silent success, so a caller (the
/// `session_answer_permission` Tauri command) can tell "I answered it" apart from "someone else
/// already did," downcastable via `anyhow::Error::downcast_ref::<AlreadyAnsweredError>()`
/// (mirroring `tests/hierarchy_workflow.rs`'s own downcast-to-a-concrete-error pattern for
/// asserting a specific failure mode, not merely "an error occurred").
#[derive(Debug, Clone, PartialEq)]
pub struct AlreadyAnsweredError {
    pub request_id: String,
}

impl std::fmt::Display for AlreadyAnsweredError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "permission request {:?} is no longer pending — it has already been answered",
            self.request_id
        )
    }
}

impl std::error::Error for AlreadyAnsweredError {}

/// Returned by [`answer_request`] when a caller attempts to grant `allowed_always` against a
/// request carrying a non-NULL `destructive_category` (D-57) — the persistable-grant decision is
/// structurally absent from this path, not merely discouraged: this named error is the only
/// outcome, there is no fallback that silently downgrades the decision to a one-time `allowed`
/// instead. Downcastable via `anyhow::Error::downcast_ref::<DestructiveAllowAlwaysRejected>()`,
/// mirroring [`AlreadyAnsweredError`]'s own pattern.
#[derive(Debug, Clone, PartialEq)]
pub struct DestructiveAllowAlwaysRejected {
    pub request_id: String,
    pub category: String,
}

impl std::fmt::Display for DestructiveAllowAlwaysRejected {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "permission request {:?} is a destructive request ({:?}) — allowed_always can never \
             be granted for a destructive category (D-57)",
            self.request_id, self.category
        )
    }
}

impl std::error::Error for DestructiveAllowAlwaysRejected {}

fn row_to_request(row: &Row) -> rusqlite::Result<PermissionRequest> {
    Ok(PermissionRequest {
        id: row.get(0)?,
        session_id: row.get(1)?,
        story_id: row.get(2)?,
        project_id: row.get(3)?,
        tool_name: row.get(4)?,
        input_payload: row.get(5)?,
        status: row.get(6)?,
        resolved_by: row.get(7)?,
        resolved_at: row.get(8)?,
        created_at: row.get(9)?,
        destructive_category: row.get(10)?,
    })
}

const REQUEST_SELECT_SQL: &str = "SELECT id, session_id, story_id, project_id, \
    tool_name, input_payload, status, resolved_by, resolved_at, created_at, destructive_category \
    FROM permission_requests WHERE id = ?1";

const PENDING_FOR_RUN_SQL: &str = "SELECT id, session_id, story_id, project_id, \
    tool_name, input_payload, status, resolved_by, resolved_at, created_at, destructive_category \
    FROM permission_requests WHERE session_id = ?1 AND status = 'pending' AND expired_at IS NULL \
    ORDER BY created_at DESC LIMIT 1";

/// Look up a single request by id, whatever its status — used by callers (the sidecar relay,
/// tests) that need to read a request back without knowing in advance whether it is still
/// pending.
pub fn find_request(conn: &Connection, request_id: &str) -> anyhow::Result<Option<PermissionRequest>> {
    conn.query_row(REQUEST_SELECT_SQL, params![request_id], row_to_request)
        .optional()
        .context("failed to look up a permission request")
}

/// The pending request for `session_id`, if one exists — a run can have at most one `pending`
/// request open at a time in this phase's flow (the sidecar holds one tool call open per gated
/// call before the next one is raised).
pub fn pending_for_run(conn: &Connection, session_id: &str) -> anyhow::Result<Option<PermissionRequest>> {
    conn.query_row(PENDING_FOR_RUN_SQL, params![session_id], row_to_request)
        .optional()
        .context("failed to look up the pending permission request for this run")
}

/// Raise a pending permission request for `session_id` (AGNT-06). One transaction: resolve
/// `story_id`/`project_id` from the session, insert the `permission_requests` row with
/// `status = 'pending'`, move the run to `blocked` (`set_run_blocked`, same transaction), and
/// append a `permission_request.raised` event carrying a human-renderable label — then commit
/// once. Creating a pending request never happens without also blocking its run, and never the
/// reverse, because both writes are one transaction.
///
/// `destructive_category` (D-56, plan 03-07) is `None` for the routine variant, or one of
/// `destructive::DestructiveCategory::as_str()`'s eight names for the destructive-action gate.
/// Validated against that exact set BEFORE the transaction opens — an out-of-set value is a
/// programmer error in the caller (the shim/hook's classifier and this domain layer must agree by
/// construction, since both reach the SAME `destructive::classify`), not something SQLite's own
/// schema can reject (an `ALTER TABLE`-added column cannot carry a new CHECK constraint), so this
/// function is the one place that vocabulary is enforced.
pub fn create_pending_request(
    conn: &mut Connection,
    session_id: &str,
    tool_name: &str,
    input_payload: Option<&str>,
    actor_id: &str,
    destructive_category: Option<&str>,
) -> anyhow::Result<PermissionRequest> {
    if let Some(category) = destructive_category {
        if DestructiveCategory::from_str_name(category).is_none() {
            bail!(
                "create_pending_request refused: {category:?} is not a recognised \
                 destructive_category (expected one of {:?})",
                DestructiveCategory::all().map(DestructiveCategory::as_str)
            );
        }
    }

    let now = Utc::now().to_rfc3339();
    let id = new_id();

    let tx = conn.transaction()?;

    let (story_id, project_id): (String, String) = tx
        .query_row(
            "SELECT story_id, project_id FROM sessions WHERE id = ?1",
            params![session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("session {session_id:?} not found"))?;
    let epic_id: Option<String> = tx
        .query_row("SELECT epic_id FROM stories WHERE id = ?1", params![story_id], |row| row.get(0))
        .optional()?;

    tx.execute(
        "INSERT INTO permission_requests (
            id, session_id, story_id, project_id, tool_name, input_payload, status,
            resolved_by, resolved_at, created_by, created_at, destructive_category
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, ?7, ?8, ?9)",
        params![
            id,
            session_id,
            story_id,
            project_id,
            tool_name,
            input_payload,
            actor_id,
            now,
            destructive_category
        ],
    )
    .context("failed to insert permission_requests row")?;

    set_run_blocked(&tx, session_id).context("failed to move the run to blocked")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "permission_request",
        "before": null,
        "after": id,
        "tool_name": tool_name,
        "label": if crate::domain::question::is_question(tool_name) {
            "The agent asked a question".to_string()
        } else {
            format!("{tool_name} asked to run")
        },
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "permission_request",
        &id,
        Some(&story_id),
        epic_id.as_deref(),
        actor_id,
        "permission_request.raised",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit create_pending_request transaction")?;

    Ok(PermissionRequest {
        id,
        session_id: session_id.to_string(),
        story_id,
        project_id,
        tool_name: tool_name.to_string(),
        input_payload: input_payload.map(|s| s.to_string()),
        status: "pending".to_string(),
        resolved_by: None,
        resolved_at: None,
        created_at: now,
        destructive_category: destructive_category.map(|c| c.to_string()),
    })
}

/// Answer a pending request exactly once (AGNT-06's central falsifiability requirement).
///
/// `decision` is one of the schema's own accepted values — `"allowed"`, `"denied"` or
/// `"allowed_always"` — fed straight into the guarded UPDATE so an out-of-set value is rejected
/// by SQLite's CHECK constraint, not by an app-side guard. The UPDATE's WHERE clause includes
/// `status = 'pending'`; an affected-row count of zero (the row does not exist, or is no longer
/// pending) returns [`AlreadyAnsweredError`], writes nothing else, and appends no second event —
/// that zero-affected-rows count IS the once-only property, not a read-then-write race a
/// concurrent second answer could still win.
///
/// On success: clears the run's blocked status back to `running` once no other request of the
/// session is still pending (`domain::session::clear_run_blocked`, same transaction) and appends a
/// `permission_request.answered` event whose label matches the decision — all in one transaction.
pub fn answer_request(
    conn: &mut Connection,
    request_id: &str,
    decision: &str,
    actor_id: &str,
) -> anyhow::Result<PermissionRequest> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    // Issue #100: a question is answered with answers (`domain::question::answer_question`), never
    // with allow or deny, and no rule may ever be granted from it.
    let tool: Option<String> = tx
        .query_row("SELECT tool_name FROM permission_requests WHERE id = ?1", params![request_id], |row| row.get(0))
        .optional()
        .context("failed to read the request's tool before answering it")?;
    if tool.as_deref().is_some_and(crate::domain::question::is_question) {
        bail!("request {request_id:?} is the agent's question: answer it, it is not allowed or denied");
    }

    // D-57 (plan 03-07): a destructive request can never be granted `allowed_always` — the
    // persistable-grant decision is structurally absent from this path, not merely discouraged.
    // Checked INSIDE this transaction, before the guarded UPDATE below, so this refusal and the
    // once-only answer property can never race each other.
    if decision == "allowed_always" {
        let category: Option<String> = tx
            .query_row(
                "SELECT destructive_category FROM permission_requests WHERE id = ?1",
                params![request_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .context("failed to check destructive_category before an allowed_always answer")?
            .flatten();
        if let Some(category) = category {
            return Err(DestructiveAllowAlwaysRejected {
                request_id: request_id.to_string(),
                category,
            }
            .into());
        }
    }

    let affected = tx
        .execute(
            "UPDATE permission_requests SET status = ?1, resolved_by = ?2, resolved_at = ?3 \
             WHERE id = ?4 AND status = 'pending' AND expired_at IS NULL",
            params![decision, actor_id, now, request_id],
        )
        .context("failed to answer permission request")?;

    if affected == 0 {
        tx.commit().context("failed to commit no-op answer_request transaction")?;
        return Err(AlreadyAnsweredError { request_id: request_id.to_string() }.into());
    }

    let (session_id, story_id, project_id, tool_name, created_at, answered_category): (
        String,
        String,
        String,
        String,
        String,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT session_id, story_id, project_id, tool_name, created_at, \
             destructive_category FROM permission_requests WHERE id = ?1",
            params![request_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
        )
        .context("failed to read the permission_requests row after answering it")?;
    let epic_id: Option<String> = tx
        .query_row("SELECT epic_id FROM stories WHERE id = ?1", params![story_id], |row| row.get(0))
        .optional()?;

    clear_run_blocked(&tx, &session_id).context("failed to clear the run's blocked status")?;

    let label = match decision {
        "allowed" => format!("Allowed {tool_name}"),
        "denied" => format!("Denied {tool_name}"),
        "allowed_always" => format!("Allowed {tool_name} for this project from now on"),
        other => format!("Answered {tool_name} ({other})"),
    };
    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": "pending",
        "after": decision,
        "tool_name": tool_name,
        "label": label,
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

    tx.commit().context("failed to commit answer_request transaction")?;

    Ok(PermissionRequest {
        id: request_id.to_string(),
        session_id,
        story_id,
        project_id,
        tool_name,
        input_payload: None,
        status: decision.to_string(),
        resolved_by: Some(actor_id.to_string()),
        resolved_at: Some(now),
        created_at,
        destructive_category: answered_category,
    })
}
