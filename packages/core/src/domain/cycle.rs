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
//! - `cycle.reordered`      — stream `cycle`, one rank rewritten. Not a scope event.
//! - `cycle.epic_disposed`  — stream `cycle` (the Cycle being closed), `epic_id` set; payload
//!   `choice` is `move_to` / `unassign` / `leave_here`, one event per unfinished epic (RECD-10).
//! - `cycle.closed`         — stream `cycle`, to `closed`. A move or an unassign inside a close
//!   also appends the ordinary `cycle.epic_assigned` / `cycle.epic_removed` fact event.

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_before, rank_between, ReorderDirection};

/// [`cycle_roster`]'s ceiling: far above any realistic roster of Cycles, never a page size and never
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

/// One roster line: the Cycle and how many epics it holds, counted in SQL, never as the length of
/// anything loaded.
#[derive(Debug, Clone, PartialEq)]
pub struct CycleLine {
    pub cycle: Cycle,
    pub epic_count: u32,
}

/// [`cycle_roster`]'s return shape, mirroring `EpicRoster`: the bounded page, the TRUE count, and
/// whether the two differ.
#[derive(Debug, Clone, PartialEq)]
pub struct CycleRoster {
    pub cycles: Vec<CycleLine>,
    pub total: i64,
    pub truncated: bool,
}

impl CycleRoster {
    /// The roadmap ahead of the current Cycle: `planned` Cycles ranked after the `active` one, or
    /// every `planned` Cycle when none is active. The roster is already in rank order.
    pub fn ahead(&self) -> Vec<&CycleLine> {
        let after = self.cycles.iter().position(|l| l.cycle.state == "active").map_or(0, |i| i + 1);
        self.cycles[after..].iter().filter(|l| l.cycle.state == "planned").collect()
    }
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
    assign_epic_in_tx(&tx, epic_id, cycle_id, actor_id, &now)?;
    tx.commit().context("failed to commit assign_epic_to_cycle transaction")?;
    Ok(())
}

fn assign_epic_in_tx(tx: &Transaction, epic_id: &str, cycle_id: &str, actor_id: &str, now: &str) -> anyhow::Result<()> {
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
    append_cycle_event(tx, &epic_project, cycle_id, Some(epic_id), actor_id, "cycle.epic_assigned", &payload, now)
}

/// Take an epic out of its Cycle (a no-op error if it is in none). One `cycle.epic_removed` event
/// on the Cycle it left.
pub fn remove_epic_from_cycle(conn: &mut Connection, epic_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    remove_epic_in_tx(&tx, epic_id, actor_id, &now)?;
    tx.commit().context("failed to commit remove_epic_from_cycle transaction")?;
    Ok(())
}

fn remove_epic_in_tx(tx: &Transaction, epic_id: &str, actor_id: &str, now: &str) -> anyhow::Result<()> {
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
    append_cycle_event(tx, &project_id, &old_cycle, Some(epic_id), actor_id, "cycle.epic_removed", &payload, now)
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

/// The project's open Cycles (`planned` and `active`; a `closed` Cycle is not part of the roadmap)
/// in rank order, up to [`CYCLE_ROSTER_CEILING`], with each Cycle's epic count.
///
/// Order is `rank` ascending, then `id`. The tie-break is not decoration: `ranking.rs`'s fractional
/// index makes an equal rank unlikely, not impossible, and a roster whose order changes between
/// reads is a surface the owner cannot trust. The epic count is a correlated subquery, so the whole
/// roster is one statement over `idx_epics_cycle`, never one per Cycle.
///
/// The ceiling and `COUNT(*)` follow `list_epics`: `truncated` is the true total exceeding the rows
/// returned, so a caller that ignores it is the bug, and the renderer must print it.
pub fn cycle_roster(conn: &Connection, project_id: &str) -> anyhow::Result<CycleRoster> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.project_id, c.key, c.goal, c.exit_criteria, c.state, c.rank, \
                (SELECT COUNT(*) FROM epics e WHERE e.cycle_id = c.id) \
         FROM cycles c WHERE c.project_id = ?1 AND c.state != 'closed' \
         ORDER BY c.rank ASC, c.id ASC LIMIT ?2",
    )?;
    let cycles = stmt
        .query_map(params![project_id, CYCLE_ROSTER_CEILING], |row| {
            Ok(CycleLine { cycle: map_cycle(row)?, epic_count: row.get(7)? })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the project's cycle roster")?;
    let total: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM cycles WHERE project_id = ?1 AND state != 'closed'",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to count the project's open cycles")?;
    let truncated = total > cycles.len() as i64;
    Ok(CycleRoster { cycles, total, truncated })
}

/// Move a Cycle one place up or down among the project's Cycles. One rank rewritten between its
/// neighbours' (`ranking.rs`'s fractional index), never a renumbering pass, in one transaction with
/// the rank read, following `reorder_epic`. A Cycle already at the end of its direction is a no-op.
pub fn reorder_cycle(
    conn: &mut Connection,
    actor_id: &str,
    cycle_id: &str,
    direction: ReorderDirection,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let (project_id, rank): (String, String) = tx
        .query_row("SELECT project_id, rank FROM cycles WHERE id = ?1", params![cycle_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?
        .ok_or_else(|| anyhow!("cycle {cycle_id:?} does not exist"))?;

    // Two neighbours in the direction of travel: the one to hop over and the one beyond it.
    let (cmp, dir) = match direction {
        ReorderDirection::Up => ("<", "DESC"),
        ReorderDirection::Down => (">", "ASC"),
    };
    let sql = format!(
        "SELECT rank FROM cycles WHERE project_id = ?1 AND (rank, id) {cmp} (?2, ?3) \
         ORDER BY rank {dir}, id {dir} LIMIT 2"
    );
    let neighbours: Vec<String> = tx
        .prepare(&sql)?
        .query_map(params![project_id, rank, cycle_id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the neighbouring cycles")?;
    let new_rank = match (direction, neighbours.as_slice()) {
        (_, []) => None,
        (ReorderDirection::Up, [prev]) => Some(rank_before(Some(prev))?),
        (ReorderDirection::Up, [prev, prev_prev, ..]) => Some(rank_between(prev_prev, prev)?),
        (ReorderDirection::Down, [next]) => Some(rank_after(Some(next))?),
        (ReorderDirection::Down, [next, next_next, ..]) => Some(rank_between(next, next_next)?),
    };
    let Some(new_rank) = new_rank else {
        tx.commit().context("failed to commit no-op reorder_cycle transaction")?;
        return Ok(());
    };

    tx.execute("UPDATE cycles SET rank = ?2, updated_at = ?3 WHERE id = ?1", params![cycle_id, new_rank, now])
        .context("failed to reorder cycle")?;
    let payload = serde_json::json!({
        "field": "rank", "before": rank, "after": new_rank, "label": "Reordered the cycle",
    });
    append_cycle_event(&tx, &project_id, cycle_id, None, actor_id, "cycle.reordered", &payload, &now)?;
    tx.commit().context("failed to commit reorder_cycle transaction")?;
    Ok(())
}

/// What closing a Cycle does with one unfinished epic (RECD-10, D-11). Exactly three answers, so a
/// fourth is a compile error rather than a string nobody validated. The obvious name for the first
/// is a word `FORBIDDEN_PM_WORDS` bans (A-06 fires on compounds too), hence `MoveTo`.
/// Variant docs are kept out of the body below because a test counts the variants.
///
/// - `MoveTo` puts the epic in the named later Cycle, which must still accept work.
/// - `Unassign` returns it to no Cycle.
/// - `LeaveHere` keeps it in the Cycle being closed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EpicDisposition {
    MoveTo(String),
    Unassign,
    LeaveHere,
}

/// One epic's answer. The close takes a slice of these: one entry per epic, each with its own
/// choice. There is no shape that applies one choice to many epics (DRFT-07).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EpicChoice {
    pub epic_id: String,
    pub disposition: EpicDisposition,
}

/// An epic in a Cycle that is not finished, as the close asks about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnfinishedEpic {
    pub id: String,
    pub key: String,
    pub title: String,
}

/// The Cycle's unfinished epics, in rank order. This is the one definition of "unfinished": an epic
/// in the Cycle whose status is not `done` and which is not archived (an archived epic is no longer
/// live work, so the close does not ask about it).
pub fn unfinished_epics(conn: &Connection, cycle_id: &str) -> anyhow::Result<Vec<UnfinishedEpic>> {
    conn.prepare(
        "SELECT id, key, title FROM epics
         WHERE cycle_id = ?1 AND status != 'done' AND archived_at IS NULL
         ORDER BY rank ASC, id ASC",
    )?
    .query_map(params![cycle_id], |row| {
        Ok(UnfinishedEpic { id: row.get(0)?, key: row.get(1)?, title: row.get(2)? })
    })?
    .collect::<Result<Vec<_>, _>>()
    .context("failed to read the cycle's unfinished epics")
}

/// Close a Cycle: a human-only authority act that decides every unfinished epic individually. The
/// refusals live HERE, not in the dialog, so an IPC caller cannot skip them: a non-human actor, an
/// already-closed Cycle, an unfinished epic with no choice (named in the error), a choice for an
/// epic that is not one of the unfinished ones, two choices for one epic, and a `MoveTo` target that
/// is closed or is the Cycle being closed. Each choice is applied through the single-epic writers
/// and appends its own `cycle.epic_disposed` event, then the Cycle goes to `closed`; one transaction.
pub fn close_cycle(
    conn: &mut Connection,
    cycle_id: &str,
    choices: &[EpicChoice],
    actor_id: &str,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;

    let (project_id, state): (String, String) = tx
        .query_row("SELECT project_id, state FROM cycles WHERE id = ?1", params![cycle_id], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .optional()?
        .ok_or_else(|| anyhow!("cycle {cycle_id:?} does not exist"))?;
    if state == "closed" {
        anyhow::bail!("cycle {cycle_id:?} is already closed");
    }

    let unfinished = unfinished_epics(&tx, cycle_id)?;
    let mut seen: Vec<&str> = Vec::new();
    for choice in choices {
        if !unfinished.iter().any(|e| e.id == choice.epic_id) {
            anyhow::bail!("epic {:?} is not an unfinished epic of cycle {cycle_id:?}; nothing to decide for it", choice.epic_id);
        }
        if seen.contains(&choice.epic_id.as_str()) {
            anyhow::bail!("epic {:?} was given more than one disposition", choice.epic_id);
        }
        seen.push(&choice.epic_id);
        if let EpicDisposition::MoveTo(target) = &choice.disposition {
            let target_state: Option<String> = tx
                .query_row("SELECT state FROM cycles WHERE id = ?1", params![target], |row| row.get(0))
                .optional()?;
            match target_state.as_deref() {
                None => anyhow::bail!("target cycle {target:?} does not exist"),
                Some("closed") => anyhow::bail!("target cycle {target:?} is closed and cannot receive work"),
                _ if target == cycle_id => anyhow::bail!("an epic cannot be moved into the cycle being closed"),
                _ => {}
            }
        }
    }

    for epic in &unfinished {
        let Some(choice) = choices.iter().find(|c| c.epic_id == epic.id) else {
            anyhow::bail!(
                "cannot close cycle {cycle_id:?}: epic {} ({}) has no disposition; every unfinished epic is \
                 decided individually, rather than accepting the set wholesale (DRFT-07)",
                epic.key, epic.id
            );
        };
        let (name, target) = match &choice.disposition {
            EpicDisposition::MoveTo(target) => {
                assign_epic_in_tx(&tx, &epic.id, target, actor_id, &now)?;
                ("move_to", Some(target.as_str()))
            }
            EpicDisposition::Unassign => {
                remove_epic_in_tx(&tx, &epic.id, actor_id, &now)?;
                ("unassign", None)
            }
            EpicDisposition::LeaveHere => ("leave_here", None),
        };
        let payload = serde_json::json!({
            "choice": name, "target_cycle_id": target, "label": format!("Decided {} when closing the cycle: {name}", epic.key),
        });
        append_cycle_event(&tx, &project_id, cycle_id, Some(&epic.id), actor_id, "cycle.epic_disposed", &payload, &now)?;
    }

    tx.execute("UPDATE cycles SET state = 'closed', updated_at = ?2 WHERE id = ?1", params![cycle_id, now])
        .context("failed to close cycle")?;
    let payload = serde_json::json!({
        "field": "state", "before": state, "after": "closed", "label": "Closed the cycle",
    });
    append_cycle_event(&tx, &project_id, cycle_id, None, actor_id, "cycle.closed", &payload, &now)?;
    tx.commit().context("failed to commit close_cycle transaction")?;
    Ok(())
}
