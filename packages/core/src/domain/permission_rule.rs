//! `permission_rules` (D-38): `matching_rule`/`upsert_rule`/`revoke_rule`/`rules_for_project` —
//! the project-scoped, per-tool allow-always rule store. Follows `domain::acceptance_criterion`'s
//! "child row" shape and the transactional-outbox pattern every domain mutation in this crate
//! uses (`domain::event`).
//!
//! `permission_rules` carries `UNIQUE (project_id, tool_name)` (migration
//! `0004_permission_gate.sql`) with no global-scope column and no session-scope column — that
//! UNIQUE pair IS D-38's per-project, per-tool scope expressed as a constraint. `matching_rule`
//! requires both columns to match, so a rule earned on one project can never be read back for
//! another (T-02-24).

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;

/// A `permission_rules` row.
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRule {
    pub id: String,
    pub project_id: String,
    pub tool_name: String,
    pub decision: String,
    pub created_at: String,
}

fn row_to_rule(row: &Row) -> rusqlite::Result<PermissionRule> {
    Ok(PermissionRule {
        id: row.get(0)?,
        project_id: row.get(1)?,
        tool_name: row.get(2)?,
        decision: row.get(3)?,
        created_at: row.get(4)?,
    })
}

const MATCHING_RULE_SQL: &str = "SELECT id, project_id, tool_name, decision, created_at \
    FROM permission_rules WHERE project_id = ?1 AND tool_name = ?2";

const RULES_FOR_PROJECT_SQL: &str = "SELECT id, project_id, tool_name, decision, created_at \
    FROM permission_rules WHERE project_id = ?1 ORDER BY created_at ASC";

/// The rule for `(project_id, tool_name)`, if one exists (D-38). Both the project id AND the
/// tool name must match — a rule on project A never matches project B, and a rule for tool X
/// never matches tool Y, because the query's WHERE clause binds both columns, not one.
pub fn matching_rule(
    conn: &Connection,
    project_id: &str,
    tool_name: &str,
) -> anyhow::Result<Option<PermissionRule>> {
    conn.query_row(MATCHING_RULE_SQL, params![project_id, tool_name], row_to_rule)
        .optional()
        .context("failed to look up a matching permission rule")
}

/// Create or update the rule for `(project_id, tool_name)` (D-38's "allow this tool for this
/// project from now on"). Checks for an existing row before writing — a second call for the same
/// pair updates the existing row's `decision` rather than inserting a duplicate, matching this
/// crate's general "check before insert" idiom (`domain::worktree::ensure_worktree`'s own
/// existence check before creating). One transaction: the check, the write, and a
/// `permission_rule.granted` event appended inside the same transaction — then commit once.
pub fn upsert_rule(
    conn: &mut Connection,
    project_id: &str,
    tool_name: &str,
    decision: &str,
    actor_id: &str,
) -> anyhow::Result<PermissionRule> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing_id: Option<String> = tx
        .query_row(
            "SELECT id FROM permission_rules WHERE project_id = ?1 AND tool_name = ?2",
            params![project_id, tool_name],
            |row| row.get(0),
        )
        .optional()
        .context("failed to look up an existing permission rule before upsert")?;

    let id = if let Some(existing_id) = existing_id {
        tx.execute(
            "UPDATE permission_rules SET decision = ?1 WHERE id = ?2",
            params![decision, existing_id],
        )
        .context("failed to update the existing permission rule")?;
        existing_id
    } else {
        let id = new_id();
        tx.execute(
            "INSERT INTO permission_rules (id, project_id, tool_name, decision, created_by, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, project_id, tool_name, decision, actor_id, now],
        )
        .context("failed to insert permission rule")?;
        id
    };

    let label = if decision == "allow" {
        format!("Allowed {tool_name} for this project from now on")
    } else {
        format!("Denied {tool_name} for this project from now on")
    };
    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "permission_rule",
        "before": null,
        "after": decision,
        "tool_name": tool_name,
        "label": label,
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "permission_rule",
        &id,
        None,
        None,
        actor_id,
        "permission_rule.granted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit upsert_rule transaction")?;

    Ok(PermissionRule {
        id,
        project_id: project_id.to_string(),
        tool_name: tool_name.to_string(),
        decision: decision.to_string(),
        created_at: now,
    })
}

/// Delete a rule and append a `permission_rule.revoked` event (D-38: rules must be inspectable
/// and revocable). Idempotent: revoking an id that no longer exists returns `Ok` and appends no
/// event, matching `domain::acceptance_criterion::delete_criterion`'s own no-op-on-missing-row
/// shape.
pub fn revoke_rule(conn: &mut Connection, rule_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String)> = tx
        .query_row(
            "SELECT project_id, tool_name FROM permission_rules WHERE id = ?1",
            params![rule_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .context("failed to read permission rule before revoke")?;

    let Some((project_id, tool_name)) = existing else {
        tx.commit().context("failed to commit no-op revoke_rule transaction")?;
        return Ok(());
    };

    tx.execute("DELETE FROM permission_rules WHERE id = ?1", params![rule_id])
        .context("failed to delete permission rule")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "permission_rule",
        "before": tool_name,
        "after": null,
        "label": format!("Revoked {tool_name}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "permission_rule",
        rule_id,
        None,
        None,
        actor_id,
        "permission_rule.revoked",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit revoke_rule transaction")?;
    Ok(())
}

/// Every rule for `project_id` (D-38, plan 02-10's Settings surface) — ordered by creation time
/// so the list reads oldest-granted-first.
pub fn rules_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<PermissionRule>> {
    let mut stmt = conn.prepare(RULES_FOR_PROJECT_SQL)?;
    let rows = stmt
        .query_map(params![project_id], row_to_rule)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list permission rules for project")
}
