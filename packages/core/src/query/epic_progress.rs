//! `board_epic_progress` — the epic roster's numbers (phase 08.1 plan 05, D-05/D-06).
//!
//! Three grouped reads over EVERY task in the project, folded in Rust: status counts, agent-run
//! counts and criteria counts, each `GROUP BY` the task's epic. There is deliberately no row
//! window and no ordering anywhere in this module: the board's unscoped list is a 200-row page
//! over 920 real rows (RESEARCH Correction 3), so any figure derived from it would be plausible
//! and wrong. The only bound is [`EPIC_ROSTER_CEILING`] on how many epics a roster may carry, and
//! exceeding it is an error that names truncation, never a silently short list (the roster's own
//! `truncated` contract).
//!
//! `criteria` is an `Option` on purpose: an epic whose tasks carry no criteria is a different fact
//! from one with criteria that are all unchecked, and D-06 requires the renderer to print a true
//! statement for the first rather than a zero percent that lies.
//!
//! Every statement is a literal bound through `params![]` (T-01-01/T-01-23).

use std::collections::BTreeMap;

use anyhow::{bail, Context};
use rusqlite::{params, Connection};

use crate::domain::epic::EPIC_ROSTER_CEILING;
use crate::query::status_sort_key;

/// One epic's roll-up. `epic_id: None` is the "No epic" bucket (D-13: a task may have no epic).
#[derive(Debug, Clone, PartialEq)]
pub struct EpicProgress {
    pub epic_id: Option<String>,
    /// `(status, count)` for every status the epic's tasks actually hold, in the board's fixed
    /// band order. Counts sum to `total`.
    pub by_status: Vec<(String, u32)>,
    pub total: u32,
    pub done: u32,
    pub agents_running: u32,
    pub agents_blocked: u32,
    /// `(checked, total)` over the epic's tasks' current criteria, or `None` when there are none.
    pub criteria: Option<(u32, u32)>,
}

type Buckets = BTreeMap<Option<String>, EpicProgress>;

fn bucket(map: &mut Buckets, epic_id: Option<String>) -> &mut EpicProgress {
    map.entry(epic_id.clone()).or_insert_with(|| EpicProgress {
        epic_id,
        by_status: Vec::new(),
        total: 0,
        done: 0,
        agents_running: 0,
        agents_blocked: 0,
        criteria: None,
    })
}

/// Every epic that has tasks, plus the no-epic bucket, each with its real status distribution,
/// agent-run counts and criteria position. `limit` is clamped to [`EPIC_ROSTER_CEILING`]; more
/// epics than that is an error naming truncation.
pub fn board_epic_progress(
    conn: &Connection,
    project_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<EpicProgress>> {
    let limit = limit.min(EPIC_ROSTER_CEILING as usize);
    let mut map = Buckets::new();

    let mut stmt = conn
        .prepare("SELECT epic_id, status, COUNT(*) FROM tasks WHERE project_id = ?1 GROUP BY epic_id, status")
        .context("failed to prepare the epic status counts")?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?, row.get::<_, u32>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the epic status counts")?;
    for (epic_id, status, n) in rows {
        let p = bucket(&mut map, epic_id);
        p.total += n;
        if status == "done" {
            p.done += n;
        }
        p.by_status.push((status, n));
    }
    for p in map.values_mut() {
        p.by_status.sort_by_key(|(status, _)| status_sort_key(status));
    }

    let epics_with_tasks = map.keys().filter(|k| k.is_some()).count();
    if epics_with_tasks > limit {
        bail!("epic progress truncated: {epics_with_tasks} epics with tasks exceed the cap of {limit}");
    }

    let mut stmt = conn
        .prepare(
            "SELECT t.epic_id, a.status, COUNT(*) FROM agent_runs a \
             JOIN tasks t ON t.id = a.task_id \
             WHERE a.project_id = ?1 AND a.status IN ('running', 'blocked') \
             GROUP BY t.epic_id, a.status",
        )
        .context("failed to prepare the epic agent counts")?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?, row.get::<_, u32>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the epic agent counts")?;
    for (epic_id, status, n) in rows {
        let p = bucket(&mut map, epic_id);
        if status == "running" {
            p.agents_running = n;
        } else {
            p.agents_blocked = n;
        }
    }

    // Current revisions only (`superseded_at IS NULL`), the same rule the board's x/y badge uses,
    // so a revised criterion never inflates an epic's denominator.
    let mut stmt = conn
        .prepare(
            "SELECT t.epic_id, COALESCE(SUM(c.checked), 0), COUNT(*) FROM acceptance_criteria c \
             JOIN tasks t ON c.parent_type = 'task' AND c.parent_id = t.id \
             WHERE t.project_id = ?1 AND c.superseded_at IS NULL \
             GROUP BY t.epic_id",
        )
        .context("failed to prepare the epic criteria counts")?;
    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok((row.get::<_, Option<String>>(0)?, row.get::<_, u32>(1)?, row.get::<_, u32>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the epic criteria counts")?;
    for (epic_id, checked, total) in rows {
        bucket(&mut map, epic_id).criteria = Some((checked, total));
    }

    Ok(map.into_values().collect())
}
