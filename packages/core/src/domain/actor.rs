//! Actor resolution for the Tauri command layer.
//!
//! `actor_id` is always resolved here, inside `packages/core`, and stamped by the Rust command
//! handler — never accepted as a claim from the renderer (T-01-04). This is what makes
//! `events.actor_id`'s NOT NULL foreign key meaningful rather than merely trusted.

use rusqlite::Connection;

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
