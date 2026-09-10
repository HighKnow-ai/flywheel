//! Trigger creation (DATA-04): the record of *what fired* an agent run. Only `user_action` is
//! ever inserted by this phase's code — `schedule`/`webhook`/`agent_proposal` are accepted by the
//! schema CHECK constraint (migration `0003_agent_runtime.sql`) and produced by no code until a
//! later milestone, exactly as `0002_board_schema.sql`'s five-state workflow CHECK is the
//! authority for `tasks`/`epics` status, not an application-layer allow-list.

use anyhow::Context;
use rusqlite::{params, Transaction};

use crate::ids::new_id;

/// The four trigger sources the schema accepts (DATA-04). `AgentProposal` is reserved for a later
/// phase's agent-initiated fan-out and, like `Schedule`/`Webhook`, is never constructed by this
/// phase's own code paths.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TriggerSource {
    UserAction,
    Schedule,
    Webhook,
    AgentProposal,
}

impl TriggerSource {
    /// The exact literal this variant maps to in the `triggers.source` CHECK constraint.
    pub fn as_str(self) -> &'static str {
        match self {
            TriggerSource::UserAction => "user_action",
            TriggerSource::Schedule => "schedule",
            TriggerSource::Webhook => "webhook",
            TriggerSource::AgentProposal => "agent_proposal",
        }
    }
}

/// Insert one `triggers` row with `source = 'user_action'` inside the CALLER's transaction,
/// returning its id. This is the only trigger-creation path this phase's application code calls —
/// `start_agent_run` (`domain::agent_run`) is its one caller, matching this module's own
/// transactional-outbox discipline (no `next_sequence`/`append_event` here: the caller's own
/// transaction appends the `agent_run.started` event that references this trigger, not a separate
/// `trigger.created` event, since a trigger has no board-facing lifecycle of its own this phase).
pub fn create_user_action_trigger(
    tx: &Transaction,
    project_id: &str,
    target_task_id: &str,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<String> {
    let id = new_id();
    tx.execute(
        "INSERT INTO triggers (
            id, project_id, target_task_id, source, config, enabled, last_fired_at,
            created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, NULL, 1, ?5, ?6, ?5)",
        params![
            id,
            project_id,
            target_task_id,
            TriggerSource::UserAction.as_str(),
            now,
            actor_id,
        ],
    )
    .context("failed to insert user_action trigger")?;
    Ok(id)
}

/// A documented stub for the `schedule` trigger source: the schema accepts it (DATA-04), but no
/// code constructs one until the automations milestone (`tokio-cron-scheduler`, vendored in this
/// crate's `Cargo.toml` per `.claude/CLAUDE.md`'s "vendor now, wire later" instruction, is not
/// started by any code path this phase adds). Calling this always returns an error — it exists so
/// a future caller has a named, discoverable extension point rather than having to invent one.
pub fn cron_tick_trigger_unimplemented() -> anyhow::Result<()> {
    anyhow::bail!(
        "schedule-sourced triggers are accepted by the schema but not yet implemented — \
         see STATE.md's automations-milestone blocker"
    )
}
