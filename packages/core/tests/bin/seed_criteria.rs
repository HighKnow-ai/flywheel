//! RED-stage skeleton: signatures only, behaviour deliberately absent.

use rusqlite::Connection;

pub const PROBE_STATEMENTS: [&str; 2] = ["test", "hello"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    DeleteProbes,
    SeedWorktreeTasks,
    Both,
}

pub fn resolve_invocation(_args: &[String], _app_data_dir_set: bool) -> Result<Mode, String> {
    Ok(Mode::Both)
}

pub fn delete_probes(_conn: &mut Connection, _actor_id: &str) -> anyhow::Result<usize> {
    Ok(0)
}

pub fn seed_worktree_tasks(_conn: &mut Connection, _actor_id: &str) -> anyhow::Result<usize> {
    Ok(0)
}

fn main() {
    let _ = PROBE_STATEMENTS;
}
