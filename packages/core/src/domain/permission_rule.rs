//! Permission rules (docs/mvp-spec.md §4.1): "Always allow `<pattern>` in this project", keyed by
//! (project, tool, pattern) in Claude Code's syntax (`Bash(npm test:*)` is tool `Bash`, pattern
//! `npm test:*`). There is no session scope and no global scope: the table has no column that could
//! express either, and no function here takes a session, so a rule earned in one project is never
//! read back for another.
//!
//! A Gated action is never covered by a rule. [`upsert_rule`] refuses a pattern that could match
//! one ([`GatedRuleRefused`]), and [`matching_rule`] never answers a call that is one, nor applies a
//! stored rule the classifier now says could cover one. Pattern syntax, matching and the classifier
//! call live in [`crate::permission_pattern`].

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::permission_pattern::{call_is_gated, covers_gated_action, format_rule, matches, parse_pattern};

pub use crate::permission_pattern::WHOLE_TOOL;

/// Returned by [`upsert_rule`] when the pattern could match a Gated action. Downcastable via
/// `anyhow::Error::downcast_ref::<GatedRuleRefused>()`.
#[derive(Debug, Clone, PartialEq)]
pub struct GatedRuleRefused {
    pub rule: String,
}

impl std::fmt::Display for GatedRuleRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{} could match a Gated action, which is asked every time and never covered by a rule",
            self.rule
        )
    }
}

impl std::error::Error for GatedRuleRefused {}

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

const EXISTING_RULE_SQL: &str = "SELECT id, project_id, tool, pattern, created_at \
    FROM permission_rules WHERE project_id = ?1 AND tool = ?2 AND pattern = ?3";

const RULES_FOR_TOOL_SQL: &str = "SELECT id, project_id, tool, pattern, created_at \
    FROM permission_rules WHERE project_id = ?1 AND tool = ?2 ORDER BY created_at ASC, id ASC";

const RULES_FOR_PROJECT_SQL: &str = "SELECT id, project_id, tool, pattern, created_at \
    FROM permission_rules WHERE project_id = ?1 ORDER BY created_at ASC, id ASC";

fn default_branch(conn: &Connection, project_id: &str) -> anyhow::Result<Option<String>> {
    conn.query_row("SELECT default_branch FROM projects WHERE id = ?1", params![project_id], |row| row.get(0))
        .optional()
        .context("failed to read the project's default branch")
}

/// The first rule of `project_id` allowing a call of `tool` with `input`, if one exists. The
/// project and the tool must match, and the input must match the rule's pattern. A call that is a
/// Gated action matches no rule, and neither does a stored rule that could cover one.
pub fn matching_rule(
    conn: &Connection,
    project_id: &str,
    tool: &str,
    input: &serde_json::Value,
) -> anyhow::Result<Option<PermissionRule>> {
    let branch = default_branch(conn, project_id)?;
    if call_is_gated(tool, input, branch.as_deref()) {
        return Ok(None);
    }
    let mut stmt = conn.prepare(RULES_FOR_TOOL_SQL)?;
    let rules = stmt
        .query_map(params![project_id, tool], row_to_rule)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to look up matching permission rules")?;
    Ok(rules.into_iter().find(|rule| {
        !covers_gated_action(&rule.tool, &rule.pattern, branch.as_deref())
            && matches(&rule.tool, &rule.pattern, input)
    }))
}

/// Refuse a rule Flywheel would not store: an unreadable pattern, or one that could match a Gated
/// action ([`GatedRuleRefused`]). [`upsert_rule`] calls this first; a caller can call it before
/// any other write so a refused rule changes nothing.
pub fn check_rule(conn: &Connection, project_id: &str, tool: &str, pattern: &str) -> anyhow::Result<()> {
    parse_pattern(tool, pattern)?;
    let branch = default_branch(conn, project_id)?;
    if covers_gated_action(tool, pattern.trim(), branch.as_deref()) {
        return Err(GatedRuleRefused { rule: format_rule(tool, pattern.trim()) }.into());
    }
    Ok(())
}

/// Grant "always allow `pattern` for `tool` in this project". Refuses a pattern [`check_rule`]
/// refuses. Granting a rule that already exists returns it unchanged and appends no second event.
pub fn upsert_rule(
    conn: &mut Connection,
    project_id: &str,
    tool: &str,
    pattern: &str,
    actor_id: &str,
) -> anyhow::Result<PermissionRule> {
    let pattern = pattern.trim();
    check_rule(conn, project_id, tool, pattern)?;
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    if let Some(existing) = tx
        .query_row(EXISTING_RULE_SQL, params![project_id, tool, pattern], row_to_rule)
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

    let label = format!("Allowed {} for this project from now on", format_rule(tool, pattern));
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
        "label": format!("Revoked {}", format_rule(&tool, &pattern)),
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
