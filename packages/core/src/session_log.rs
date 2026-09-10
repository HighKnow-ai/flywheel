//! The durable JSONL session-log writer (D-34): one append-only file per agent run, beside the
//! database, written by the Rust core's sidecar reader loop and never by the renderer.
//!
//! `agent_runs.log_path` (migration `0003_agent_runtime.sql`) is a pointer to a file this module
//! resolves and writes — matching `Artifact.storage_ref`'s own "pointer, not blob" contract.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use anyhow::Context;

/// Resolve `<app-data>/sessions/` beside `db::default_db_path()`'s own directory — reuses the
/// same `dirs` resolution `db::default_db_path` performs rather than re-deriving an app-data path
/// independently.
pub fn sessions_dir() -> anyhow::Result<PathBuf> {
    let db_path = crate::db::default_db_path()?;
    let app_data = db_path
        .parent()
        .context("default_db_path returned a path with no parent directory")?;
    Ok(app_data.join("sessions"))
}

/// The path a given agent run's durable log lives at: `<app-data>/sessions/<agent_run_id>.jsonl`.
pub fn session_log_path(agent_run_id: &str) -> anyhow::Result<PathBuf> {
    Ok(sessions_dir()?.join(format!("{agent_run_id}.jsonl")))
}

/// The single writer of record for one agent run's session log. Opens the file append-only,
/// creating parent directories as needed. Every line this writer appends is driven from the Rust
/// core's sidecar reader loop — never from the renderer (RESEARCH.md Pitfall 5, PITFALLS.md
/// pitfall 10: the persisted log is ground truth, independent of what the UI renders).
pub struct SessionLogWriter {
    file: File,
}

impl SessionLogWriter {
    /// Open (creating if absent) the log file for `agent_run_id`, creating its parent
    /// `sessions/` directory if it does not exist yet.
    pub fn open(agent_run_id: &str) -> anyhow::Result<Self> {
        let path = session_log_path(agent_run_id)?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("failed to create session log directory {parent:?}"))?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .with_context(|| format!("failed to open session log file {path:?}"))?;
        Ok(Self { file })
    }

    /// Append `line` (a single verbatim line of the underlying stream — e.g. one JSON object as
    /// text) plus a trailing newline, and flush immediately, so a killed process never loses a
    /// line the writer already accepted.
    pub fn append_event_line(&mut self, line: &str) -> anyhow::Result<()> {
        writeln!(self.file, "{line}").context("failed to write session log line")?;
        self.file.flush().context("failed to flush session log writer")?;
        Ok(())
    }
}

/// Free-function equivalent of [`SessionLogWriter::open`] + a single
/// [`SessionLogWriter::append_event_line`] call, for callers (tests, one-shot writers) that don't
/// need to hold a writer open across multiple lines.
pub fn append_event_line(agent_run_id: &str, line: &str) -> anyhow::Result<()> {
    let mut writer = SessionLogWriter::open(agent_run_id)?;
    writer.append_event_line(line)
}
