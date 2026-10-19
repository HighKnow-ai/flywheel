//! Permission rules (docs/mvp-spec.md §4.1): "Always allow `<pattern>` in this project", keyed by
//! (project, tool, pattern) in Claude Code's syntax (`Bash(npm test:*)` is tool `Bash`, pattern
//! `npm test:*`). There is no session scope and no global scope: the table has no column that could
//! express either, so a rule earned in one project is never read back for another. A Gated action
//! is never covered by a rule (`permission_request::answer_request` refuses to persist one).
//!
//! [`WHOLE_TOOL`] is the pattern a rule granted from the existing permission card carries: it allows
//! every input of the tool, which is what that card has always offered. Matching an input against a
//! narrower pattern is the permissions surface's work; until it lands, [`matching_rule`] reads only
//! whole-tool rules, so a narrower rule never allows more than it says.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;

/// The pattern that allows every input of a tool.
pub const WHOLE_TOOL: &str = "*";

/// A `permission_rules` row.
#[derive(Debug, Clone, PartialEq)]
pub struct PermissionRule {
    pub id: String,
    pub project_id: String,
    pub tool: String,
    pub pattern: String,
    pub created_at: String,
}

fn row_to_rule(row: &Row) -> rusqlite::Result<PermissionRule> {
    Ok(PermissionRule {
        id: row.get(0)?,
        project_id: row.get(1)?,
        tool: row.get(2)?,
        pattern: row.get(3)?,
        created_at: row.get(4)?,
    })
}

const MATCHING_RULE_SQL: &str = "SELECT id, project_id, tool, pattern, created_at \
    FROM permission_rules WHERE project_id = ?1 AND tool = ?2 AND pattern = ?3";

const RULES_FOR_PROJECT_SQL: &str = "SELECT id, project_id, tool, pattern, created_at \
    FROM permission_rules WHERE project_id = ?1 ORDER BY created_at ASC, id ASC";

/// The rule allowing every input of `tool` in `project_id`, if one exists. Both the project and the
/// tool must match.
pub fn matching_rule(conn: &Connection, project_id: &str, tool: &str) -> anyhow::Result<Option<PermissionRule>> {
    conn.query_row(MATCHING_RULE_SQL, params![project_id, tool, WHOLE_TOOL], row_to_rule)
        .optional()
        .context("failed to look up a matching permission rule")
}

/// Grant "always allow `pattern` for `tool` in this project". Granting a rule that already exists
/// returns it unchanged and appends no second event.
pub fn upsert_rule(
    conn: &mut Connection,
    project_id: &str,
    tool: &str,
    pattern: &str,
    actor_id: &str,
) -> anyhow::Result<PermissionRule> {
    let pattern = pattern.trim();
    anyhow::ensure!(!pattern.is_empty(), "a permission rule needs a pattern");
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    if let Some(existing) = tx
        .query_row(MATCHING_RULE_SQL, params![project_id, tool, pattern], row_to_rule)
        .optional()
        .context("failed to look up an existing permission rule")?
    {
        tx.commit()?;
        return Ok(existing);
    }

    let id = new_id();
    tx.execute(
        "INSERT INTO permission_rules (id, project_id, tool, pattern, created_by, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, project_id, tool, pattern, actor_id, now],
    )
    .context("failed to insert permission rule")?;

    let label = if pattern == WHOLE_TOOL {
        format!("Allowed {tool} for this project from now on")
    } else {
        format!("Allowed {tool}({pattern}) for this project from now on")
    };
    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "permission_rule",
        "before": null,
        "after": "allow",
        "tool": tool,
        "pattern": pattern,
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
        tool: tool.to_string(),
        pattern: pattern.to_string(),
        created_at: now,
    })
}

/// Delete a rule and append a `permission_rule.revoked` event. Revoking an id that no longer
/// exists is a no-op.
pub fn revoke_rule(conn: &mut Connection, rule_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, String, String)> = tx
        .query_row(
            "SELECT project_id, tool, pattern FROM permission_rules WHERE id = ?1",
            params![rule_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .context("failed to read permission rule before revoke")?;

    let Some((project_id, tool, pattern)) = existing else {
        tx.commit().context("failed to commit no-op revoke_rule transaction")?;
        return Ok(());
    };

    tx.execute("DELETE FROM permission_rules WHERE id = ?1", params![rule_id])
        .context("failed to delete permission rule")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "permission_rule",
        "before": tool,
        "after": null,
        "pattern": pattern,
        "label": format!("Revoked {tool}"),
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

/// Every rule of `project_id`, oldest first.
pub fn rules_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<PermissionRule>> {
    let mut stmt = conn.prepare(RULES_FOR_PROJECT_SQL)?;
    let rows = stmt.query_map(params![project_id], row_to_rule)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to list permission rules for project")
}
