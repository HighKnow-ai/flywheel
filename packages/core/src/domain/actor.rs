//! Actor resolution for the Tauri command layer.
//!
//! `actor_id` is always resolved here, inside `packages/core`, and stamped by the Rust command
//! handler — never accepted as a claim from the renderer (T-01-04). This is what makes
//! `events.actor_id`'s NOT NULL foreign key meaningful rather than merely trusted.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

/// One row of the `actors` table (DATA-03).
#[derive(Debug, Clone, PartialEq)]
pub struct Actor {
    pub id: String,
    pub actor_type: String,
    pub display_name: String,
}

/// Resolve the id of the seeded local human actor (migration `0001_actors.sql`'s "Local User"
/// row). Every mutation invoked from the desktop UI in Phase 1 is attributed to this actor —
/// there is exactly one human actor until team collaboration (TEAM-01) lands.
pub fn local_human_actor_id(conn: &Connection) -> anyhow::Result<String> {
    let id: String = conn.query_row(
        "SELECT id FROM actors WHERE type = 'human' ORDER BY created_at ASC LIMIT 1",
        [],
        |row| row.get(0),
    )?;
    Ok(id)
}

/// Resolve the seeded local human actor as a full row. Every Tauri command handler that stamps
/// `actor_id` on a mutation resolves it through here (or [`system_actor`]) — never accepted as a
/// claim from the renderer (T-01-04).
pub fn local_human_actor(conn: &Connection) -> anyhow::Result<Actor> {
    let actor = conn.query_row(
        "SELECT id, type, display_name FROM actors WHERE type = 'human' ORDER BY created_at ASC LIMIT 1",
        [],
        |row| {
            Ok(Actor {
                id: row.get(0)?,
                actor_type: row.get(1)?,
                display_name: row.get(2)?,
            })
        },
    )?;
    Ok(actor)
}

/// Resolve the seeded system actor (migration `0001_actors.sql`'s "Flywheel" row) — used for any
/// mutation performed by Flywheel itself rather than a human at the keyboard (e.g. future
/// background reconciliation), never by a renderer-triggered command in Phase 1.
pub fn system_actor(conn: &Connection) -> anyhow::Result<Actor> {
    let actor = conn.query_row(
        "SELECT id, type, display_name FROM actors WHERE type = 'system' ORDER BY created_at ASC LIMIT 1",
        [],
        |row| {
            Ok(Actor {
                id: row.get(0)?,
                actor_type: row.get(1)?,
                display_name: row.get(2)?,
            })
        },
    )?;
    Ok(actor)
}

/// List every actor (human, agent and system), oldest-created first — the roster the assignee
/// picker renders (BOARD-06). Read-only; Phase 1 seeds actors from migration `0001_actors.sql`
/// only and exposes no create-actor command from the renderer.
pub fn list_actors(conn: &Connection) -> anyhow::Result<Vec<Actor>> {
    let mut stmt = conn.prepare(
        "SELECT id, type, display_name FROM actors ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Actor {
                id: row.get(0)?,
                actor_type: row.get(1)?,
                display_name: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list actors")
}

/// FNC-03's database-level refusal: succeed only if `actor_id` names an `actors` row whose `type`
/// is exactly `'human'`.
///
/// The type is read from the `actors` table inside the SAME transaction as the write that follows,
/// so it cannot be bypassed by a caller holding a stale or invented notion of who it is. This
/// generalises the precedent `start_session` already uses to refuse the system actor. Every
/// authority transition (checking a criterion, sending reviewed work back, accepting,
/// rejecting or deferring a proposal) calls it as the first statement after its transaction opens.
/// Branch merge is not among them: it records its event through `merge::record_merge_event`,
/// which does not call this helper, and the reason is recorded in `13-AUTHORITY-ALLOWLIST.md`
/// under "Deliberately outside FNC-03".
///
/// The comparison is exact: `'human'` is the only accepting value, so the `system` actor is
/// refused as surely as an agent. An id present in no row (which includes the empty string) is
/// refused with a distinct "not found" message, never defaulted to [`local_human_actor_id`].
///
/// Not called from reads, from proposal staging (`create_proposal` / `apply_proposal_created` are
/// the agent's legitimate route), or from the status deriver (it runs as the system actor and is
/// not an authority act).
///
/// One authority transition does not exist yet: accepting an ADR. Its home is Phase 16, and it
/// must call this helper as its first statement.
pub fn assert_human_actor_in_tx(tx: &Transaction, actor_id: &str) -> anyhow::Result<()> {
    check_human(tx.query_row("SELECT type FROM actors WHERE id = ?1", params![actor_id], |row| row.get(0)).optional()?, actor_id)
}

/// [`assert_human_actor_in_tx`] for a caller that is not inside a transaction.
pub fn assert_human_actor(conn: &Connection, actor_id: &str) -> anyhow::Result<()> {
    check_human(conn.query_row("SELECT type FROM actors WHERE id = ?1", params![actor_id], |row| row.get(0)).optional()?, actor_id)
}

fn check_human(actor_type: Option<String>, actor_id: &str) -> anyhow::Result<()> {
    match actor_type.as_deref() {
        Some("human") => Ok(()),
        Some(other) => anyhow::bail!("authority refused: actor {actor_id:?} is a {other:?} actor, and only a human may do this"),
        None => anyhow::bail!("authority refused: actor {actor_id:?} not found"),
    }
}
