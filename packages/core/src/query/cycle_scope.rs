//! Scope drift (RECD-10, D-07): how many epics a Cycle gained and lost after it started, derived
//! from the append-only `events` log. Nothing is stored.
use rusqlite::Connection;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CycleScopeDrift {
    pub epics_added: u32,
    pub epics_removed: u32,
}

pub fn cycle_scope_drift(_conn: &Connection, _cycle_id: &str) -> anyhow::Result<Option<CycleScopeDrift>> {
    Ok(None)
}

pub fn cycle_scope_sentence(_drift: &CycleScopeDrift) -> String {
    String::new()
}
