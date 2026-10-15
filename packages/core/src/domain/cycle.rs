//! The Cycle (RECD-08, phase 14): a scope-boxed, undated grouping layer above the epic. It has a
//! goal, an ordering (`rank`) and exit criteria, and no column of any scheduling kind (the exact
//! column set is pinned in `tests/spine_pin.rs`). Progress is not stored here: it is folded at read
//! time by `query::cycle_progress` from the real task counts of the Cycle's epics (D-08).
//!
//! Every writer opens exactly one `conn.transaction()` and commits the projection row and its event
//! together (DATA-01). Starting a Cycle is a human-only FNC-03 authority act: [`start_cycle`] reads
//! `actors.type` inside its own transaction before anything else (D-05).
//!
//! Event types this module appends. Plan 14-06 derives scope drift from the same names:
//! - `cycle.created`        — stream `cycle`, payload carries the goal.
//! - `cycle.started`        — stream `cycle`, `planned` to `active`.
//! - `cycle.epic_assigned`  — stream `cycle` (the NEW Cycle), `epic_id` set; payload `before`/`after`
//!   hold the epic's previous and new Cycle ids, so a move between Cycles is one event.
//! - `cycle.epic_removed`   — stream `cycle` (the OLD Cycle), `epic_id` set.

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// [`list_cycles`]'s ceiling: far above any realistic roster of Cycles, never a page size and never
/// configuration (D-69). Paired with [`CycleRoster::truncated`], a fact a caller must render and
/// never swallow, so the read is bounded without going silent.
pub const CYCLE_ROSTER_CEILING: i64 = 500;

/// A cycle row, as read back after a mutation commits.
#[derive(Debug, Clone, PartialEq)]
pub struct Cycle {
    pub id: String,
    pub project_id: String,
    pub key: String,
    pub goal: String,
    pub exit_criteria: Option<String>,
    pub state: String,
    pub rank: String,
}

/// [`list_cycles`]'s return shape, mirroring `EpicRoster`: the bounded page, the TRUE count, and
/// whether the two differ.
#[derive(Debug, Clone, PartialEq)]
pub struct CycleRoster {
    pub cycles: Vec<Cycle>,
    pub total: i64,
    pub truncated: bool,
}

fn map_cycle(row: &rusqlite::Row) -> rusqlite::Result<Cycle> {
    Ok(Cycle {
        id: row.get(0)?,
        project_id: row.get(1)?,
        key: row.get(2)?,
        goal: row.get(3)?,
        exit_criteria: row.get(4)?,
        state: row.get(5)?,
        rank: row.get(6)?,
    })
}

/// Create a `planned` Cycle at the tail of the project's ordering, with one `cycle.created` event.
/// The key comes from the same project counter epics and tasks use, so keys stay unique across
/// entity types (D-10 of phase 1).
pub fn create_cycle(
    conn: &mut Connection,
    project_id: &str,
    goal: &str,
    actor_id: &str,
) -> anyhow::Result<Cycle> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let id = new_id();

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT MAX(rank) FROM cycles WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to read the Cycle tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    let key: String = tx
        .query_row(
            "UPDATE projects SET key_counter = key_counter + 1
             WHERE id = ?1
             RETURNING key_prefix || '-' || key_counter",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to allocate the next project key")?;

    tx.execute(
        "INSERT INTO cycles (id, project_id, key, goal, exit_criteria, state, rank, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, 'planned', ?5, ?6, ?7, ?7)",
        params![id, project_id, key, goal, rank, actor_id, now],
    )
    .context("failed to insert cycle")?;

    let payload = serde_json::json!({
        "field": "state",
        "before": null,
        "after": "planned",
        "goal": goal,
        "label": format!("Created cycle \"{goal}\""),
    });
    append_cycle_event(&tx, project_id, &id, None, actor_id, "cycle.created", &payload, &now)?;
    tx.commit().context("failed to commit create_cycle transaction")?;

    Ok(Cycle {
        id,
        project_id: project_id.to_string(),
        key,
        goal: goal.to_string(),
        exit_criteria: None,
        state: "planned".to_string(),
        rank,
    })
}

#[allow(clippy::too_many_arguments)]
fn append_cycle_event(
    tx: &Transaction,
    project_id: &str,
    cycle_id: &str,
    epic_id: Option<&str>,
    actor_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
    now: &str,
) -> anyhow::Result<()> {
    let sequence = next_sequence(tx, project_id, "local")?;
    append_event(tx, project_id, "local", sequence, "cycle", cycle_id, None, epic_id, actor_id, event_type, payload, now)?;
    Ok(())
}

/// Start a `planned` Cycle: a human-only FNC-03 authority act (D-05). The actor check runs FIRST,
/// inside this function's own transaction. "At most one active Cycle per project" is not checked
/// here: the partial unique index `idx_cycles_one_active_per_project` refuses the second one, so
/// the rule holds for any writer, and a refused start rolls back with no event.
pub fn start_cycle(conn: &mut Connection, cycle_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;

    let (project_id, state): (String, String) = tx
        .query_row("SELECT project_id, state FROM cycles WHERE id = ?1", params![cycle_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?
        .ok_or_else(|| anyhow!("cycle {cycle_id:?} does not exist"))?;
    if state != "planned" {
        anyhow::bail!("only a planned cycle can be started; this one is {state}");
    }

    tx.execute(
        "UPDATE cycles SET state = 'active', updated_at = ?2 WHERE id = ?1",
        params![cycle_id, now],
    )
    .context("failed to start cycle")?;

    let payload = serde_json::json!({
        "field": "state", "before": "planned", "after": "active", "label": "Started the cycle",
    });
    append_cycle_event(&tx, &project_id, cycle_id, None, actor_id, "cycle.started", &payload, &now)?;
    tx.commit().context("failed to commit start_cycle transaction")?;
    Ok(())
}

/// Put an epic in a Cycle, replacing any previous assignment: the column holds one value, so an
/// epic is in at most one Cycle by construction (D-10). One `cycle.epic_assigned` event.
pub fn assign_epic_to_cycle(
    conn: &mut Connection,
    epic_id: &str,
    cycle_id: &str,
    actor_id: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let (epic_project, before): (String, Option<String>) = tx
        .query_row("SELECT project_id, cycle_id FROM epics WHERE id = ?1", params![epic_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?
        .ok_or_else(|| anyhow!("epic {epic_id:?} does not exist"))?;
    let cycle_project: String = tx
        .query_row("SELECT project_id FROM cycles WHERE id = ?1", params![cycle_id], |row| row.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("cycle {cycle_id:?} does not exist"))?;
    if epic_project != cycle_project {
        anyhow::bail!("epic {epic_id:?} and cycle {cycle_id:?} belong to different projects");
    }

    tx.execute("UPDATE epics SET cycle_id = ?2, updated_at = ?3 WHERE id = ?1", params![epic_id, cycle_id, now])
        .context("failed to assign epic to cycle")?;
    let payload = serde_json::json!({
        "field": "cycle_id", "before": before, "after": cycle_id, "label": "Added an epic to the cycle",
    });
    append_cycle_event(&tx, &epic_project, cycle_id, Some(epic_id), actor_id, "cycle.epic_assigned", &payload, &now)?;
    tx.commit().context("failed to commit assign_epic_to_cycle transaction")?;
    Ok(())
}

/// Take an epic out of its Cycle (a no-op error if it is in none). One `cycle.epic_removed` event
/// on the Cycle it left.
pub fn remove_epic_from_cycle(conn: &mut Connection, epic_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let (project_id, before): (String, Option<String>) = tx
        .query_row("SELECT project_id, cycle_id FROM epics WHERE id = ?1", params![epic_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?
        .ok_or_else(|| anyhow!("epic {epic_id:?} does not exist"))?;
    let Some(old_cycle) = before else {
        anyhow::bail!("epic {epic_id:?} is not in a cycle");
    };

    tx.execute("UPDATE epics SET cycle_id = NULL, updated_at = ?2 WHERE id = ?1", params![epic_id, now])
        .context("failed to remove epic from cycle")?;
    let payload = serde_json::json!({
        "field": "cycle_id", "before": old_cycle, "after": null, "label": "Removed an epic from the cycle",
    });
    append_cycle_event(&tx, &project_id, &old_cycle, Some(epic_id), actor_id, "cycle.epic_removed", &payload, &now)?;
    tx.commit().context("failed to commit remove_epic_from_cycle transaction")?;
    Ok(())
}

/// The project's `active` Cycle, if any. At most one exists (the partial unique index).
pub fn active_cycle(conn: &Connection, project_id: &str) -> anyhow::Result<Option<Cycle>> {
    conn.query_row(
        "SELECT id, project_id, key, goal, exit_criteria, state, rank FROM cycles WHERE project_id = ?1 AND state = 'active'",
        params![project_id],
        map_cycle,
    )
    .optional()
    .context("failed to read the active cycle")
}

/// The project's Cycles in their persisted order, up to [`CYCLE_ROSTER_CEILING`].
pub fn list_cycles(conn: &Connection, project_id: &str) -> anyhow::Result<CycleRoster> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, key, goal, exit_criteria, state, rank FROM cycles \
         WHERE project_id = ?1 ORDER BY rank ASC LIMIT ?2",
    )?;
    let cycles = stmt
        .query_map(params![project_id, CYCLE_ROSTER_CEILING], map_cycle)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to list the project's cycles")?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM cycles WHERE project_id = ?1", params![project_id], |row| row.get(0))
        .context("failed to count the project's cycles")?;
    let truncated = total > cycles.len() as i64;
    Ok(CycleRoster { cycles, total, truncated })
}
