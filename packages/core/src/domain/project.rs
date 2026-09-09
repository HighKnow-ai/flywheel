//! Project registration (D-10, D-14).
//!
//! A project's `key_prefix` is user-typed with a derived default supplied by the caller (the
//! desktop UI derives the default from the repository directory name — 01-UI-SPEC.md Open
//! Decisions #11) and is validated here as short, uppercase, typeable and greppable.

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection};

use crate::ids::new_id;

const KEY_PREFIX_MIN_LEN: usize = 2;
const KEY_PREFIX_MAX_LEN: usize = 10;

/// A registered project (one row in `projects`).
#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub id: String,
    pub key_prefix: String,
    pub name: String,
    pub repo_path: String,
    pub default_branch: String,
    pub status: String,
}

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        key_prefix: row.get(1)?,
        name: row.get(2)?,
        repo_path: row.get(3)?,
        default_branch: row.get(4)?,
        status: row.get(5)?,
    })
}

/// Validate a user-supplied or derived project key prefix (D-10, 01-UI-SPEC.md Open Decisions
/// #11): 2-10 uppercase ASCII letters/digits, starting with a letter — short, uppercase,
/// typeable and greppable, and stable enough for Phase 2's branch names and Phase 7's commit
/// trailers.
pub fn validate_key_prefix(prefix: &str) -> anyhow::Result<()> {
    let len_ok = (KEY_PREFIX_MIN_LEN..=KEY_PREFIX_MAX_LEN).contains(&prefix.len());
    let chars_ok = !prefix.is_empty()
        && prefix
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    let starts_with_letter = prefix.chars().next().is_some_and(|c| c.is_ascii_uppercase());

    if !len_ok || !chars_ok || !starts_with_letter {
        return Err(anyhow!(
            "key prefix {prefix:?} must be {KEY_PREFIX_MIN_LEN}-{KEY_PREFIX_MAX_LEN} uppercase letters/digits, starting with a letter"
        ));
    }
    Ok(())
}

/// Register a project: validates the key prefix, then inserts the `projects` row inside one
/// transaction. `default_branch` is supplied by the caller — resolving it from the repository
/// itself is Phase 2's git integration, out of scope for this tracer.
pub fn create_project(
    conn: &mut Connection,
    actor_id: &str,
    name: &str,
    repo_path: &str,
    key_prefix: &str,
    default_branch: &str,
) -> anyhow::Result<Project> {
    validate_key_prefix(key_prefix)?;

    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO projects (
            id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'active', ?6, ?7)",
        params![id, key_prefix, name, repo_path, default_branch, actor_id, now],
    )
    .context("failed to insert project")?;
    tx.commit().context("failed to commit create_project transaction")?;

    Ok(Project {
        id,
        key_prefix: key_prefix.to_string(),
        name: name.to_string(),
        repo_path: repo_path.to_string(),
        default_branch: default_branch.to_string(),
        status: "active".to_string(),
    })
}

/// List every registered project, oldest-registered first (stable order for the project rail's
/// ⌘1-⌘9 switching and the "current project" default).
pub fn list_projects(conn: &Connection) -> anyhow::Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, key_prefix, name, repo_path, default_branch, status
         FROM projects
         ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([], row_to_project)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read projects")?;
    Ok(rows)
}

/// Update a project's key prefix — **enforced immutable** once the project has allocated its
/// first item key (`key_counter > 0`), per D-10 and 01-UI-SPEC.md Open Decisions #11: once
/// branches and commit trailers in real git history carry a key, the identifier scheme cannot
/// change retroactively. No Tauri command exposes a rename affordance in Phase 1 (no UI-SPEC
/// surface calls for one yet), but the invariant is enforced here — the one function any future
/// rename path would have to go through — not merely documented.
pub fn update_key_prefix(
    conn: &mut Connection,
    project_id: &str,
    new_prefix: &str,
) -> anyhow::Result<()> {
    validate_key_prefix(new_prefix)?;

    let tx = conn.transaction()?;
    let key_counter: i64 = tx
        .query_row(
            "SELECT key_counter FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    if key_counter > 0 {
        return Err(anyhow!(
            "project {project_id:?} has already allocated {key_counter} item key(s) — the key prefix is immutable once the first item exists (D-10)"
        ));
    }

    tx.execute(
        "UPDATE projects SET key_prefix = ?1 WHERE id = ?2",
        params![new_prefix, project_id],
    )
    .context("failed to update key prefix")?;
    tx.commit()
        .context("failed to commit update_key_prefix transaction")?;
    Ok(())
}
