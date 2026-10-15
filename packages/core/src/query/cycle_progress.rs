//! `cycle_progress` — the Cycle region's numbers (phase 14 plan 14-01, RECD-09, D-08).
//!
//! The `board_epic_progress` shape one level up: grouped reads over EVERY task of EVERY epic in the
//! Cycle, folded in Rust. There is deliberately no row window and no ordering anywhere in this
//! module: the board's unscoped list is a 200-row page over 920 real rows, so any figure derived
//! from it would be plausible and wrong. `tests/cycle_region.rs` asserts that property over this
//! file's own text.
//!
//! No percentage is returned and none is stored anywhere: the region draws whatever it draws from
//! the integer pair `tasks_done` / `tasks_total`, at render time.
//!
//! A Cycle with no epics, or whose epics hold no tasks, answers zeroes, never an error and never an
//! absent value: at this level a Cycle with no tasks genuinely has zero tasks, and the renderer says
//! so in words (`EpicProgress::criteria` is an `Option` because one level down absent and zero differ;
//! here they do not). `tests/cycle_progress.rs` pins the totals against an independent full count
//! over a board larger than a page.
//!
//! Every statement is a literal bound through `params![]` (T-01-01/T-01-23).

use anyhow::Context;
use rusqlite::{params, Connection};

/// One Cycle's roll-up across all of its epics.
#[derive(Debug, Clone, PartialEq)]
pub struct CycleProgress {
    pub cycle_id: String,
    /// Epics assigned to the Cycle, whether or not they hold tasks yet.
    pub epics: u32,
    pub tasks_total: u32,
    pub tasks_done: u32,
    pub agents_running: u32,
    pub agents_blocked: u32,
}

pub fn cycle_progress(conn: &Connection, cycle_id: &str) -> anyhow::Result<CycleProgress> {
    let mut progress = CycleProgress {
        cycle_id: cycle_id.to_string(),
        epics: 0,
        tasks_total: 0,
        tasks_done: 0,
        agents_running: 0,
        agents_blocked: 0,
    };

    progress.epics = conn
        .query_row("SELECT COUNT(*) FROM epics WHERE cycle_id = ?1", params![cycle_id], |row| row.get(0))
        .context("failed to count the cycle's epics")?;

    let mut stmt = conn
        .prepare(
            "SELECT t.status, COUNT(*) FROM tasks t \
             JOIN epics e ON e.id = t.epic_id \
             WHERE e.cycle_id = ?1 GROUP BY t.status",
        )
        .context("failed to prepare the cycle task counts")?;
    let rows = stmt
        .query_map(params![cycle_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the cycle task counts")?;
    for (status, n) in rows {
        progress.tasks_total += n;
        if status == "done" {
            progress.tasks_done += n;
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT a.status, COUNT(*) FROM agent_runs a \
             JOIN tasks t ON t.id = a.task_id \
             JOIN epics e ON e.id = t.epic_id \
             WHERE e.cycle_id = ?1 AND a.status IN ('running', 'blocked') GROUP BY a.status",
        )
        .context("failed to prepare the cycle agent counts")?;
    let rows = stmt
        .query_map(params![cycle_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the cycle agent counts")?;
    for (status, n) in rows {
        if status == "running" {
            progress.agents_running = n;
        } else {
            progress.agents_blocked = n;
        }
    }

    Ok(progress)
}
