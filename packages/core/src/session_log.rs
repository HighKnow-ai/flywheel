//! The durable JSONL session-log writer (D-34): one append-only file per agent run, beside the
//! database, written by the Rust core's sidecar reader loop and never by the renderer.
//!
//! `agent_runs.log_path` (migration `0003_agent_runtime.sql`) is a pointer to a file this module
//! resolves and writes — matching `Artifact.storage_ref`'s own "pointer, not blob" contract.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
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

/// PROC-07's hard ceiling on a single windowed read (plan 02-07, D-33) — matches the trail cap
/// `query/events.rs`'s `commands/events.rs` counterpart already uses (100 rows). Declared here,
/// not just in the desktop command layer, because [`read_window`] enforces this clamp itself
/// (mechanical form of PROC-07: no call path — UI, command, or future one — can ask this function
/// for more than this many entries, even if a caller's own clamp is missing or wrong).
pub const LOG_WINDOW_MAX_LIMIT: usize = 100;

/// A bounded page of one agent run's persisted JSONL log (D-33) — [`read_window`]'s return
/// shape. `entries` holds at most `min(requested limit, LOG_WINDOW_MAX_LIMIT)` parsed lines;
/// `limit` reports the EFFECTIVE limit after clamping (never the raw requested value), and
/// `total` is the log's true complete-line count at read time, so a caller can compute how many
/// older lines remain to page through.
#[derive(Debug, Clone, PartialEq)]
pub struct LogWindow {
    /// Each line's parsed JSON value, in file order. A line that failed to parse as JSON becomes
    /// `{"type": "unknown", "raw": <verbatim text>, "line": <0-based line number>}` — never
    /// skipped, matching T-02-33's "an unrenderable event silently disappearing" mitigation.
    pub entries: Vec<serde_json::Value>,
    pub offset: usize,
    pub limit: usize,
    pub total: usize,
}

/// Does the file end with a complete final line (a trailing `\n`)? A `false` result means the
/// last line [`std::io::BufRead::lines`] would yield is an in-flight write's partial fragment —
/// excluded from both [`count_lines`] and [`read_window`] so a reader never observes a
/// half-written JSON line as if it were complete. Reads a single trailing byte via `Seek`, never
/// the file's content.
fn file_ends_with_newline(file: &mut File) -> std::io::Result<bool> {
    let len = file.metadata()?.len();
    if len == 0 {
        // An empty file has no fragment to exclude.
        return Ok(true);
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last_byte = [0u8; 1];
    file.read_exact(&mut last_byte)?;
    file.seek(SeekFrom::Start(0))?;
    Ok(last_byte[0] == b'\n')
}

/// The number of COMPLETE lines currently in `agent_run_id`'s durable log (D-33) — so a renderer
/// can page backwards from the tail without first reading the whole file. A run whose log file
/// does not exist yet (no output produced) returns `0`, not an error — a normal state, not a
/// failure. Never materialises the file's content into one buffer: reads it as a byte stream,
/// counting newline-terminated lines one at a time.
pub fn count_lines(agent_run_id: &str) -> anyhow::Result<usize> {
    let path = session_log_path(agent_run_id)?;
    let mut file = match File::open(&path) {
        Ok(file) => file,
        Err(_) => return Ok(0),
    };
    let ends_with_newline = file_ends_with_newline(&mut file)
        .with_context(|| format!("failed to inspect trailing byte of {path:?}"))?;

    let reader = BufReader::new(&file);
    let mut count = 0usize;
    for line in reader.lines() {
        line.with_context(|| format!("failed to read a line from session log {path:?}"))?;
        count += 1;
    }
    if !ends_with_newline && count > 0 {
        // The last line `.lines()` yielded has no trailing newline — an in-flight write's
        // partial fragment, not a complete line (D-34: "a partially written final line is never
        // returned as parsed").
        count -= 1;
    }
    Ok(count)
}

/// Parse one raw log line into its normalised JSON value, or an `unknown` entry carrying the
/// verbatim text and its 0-based line number if it fails to parse (T-02-33: never dropped).
fn parse_log_line(line: &str, line_number: usize) -> serde_json::Value {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(value) => value,
        Err(_) => serde_json::json!({ "type": "unknown", "raw": line, "line": line_number }),
    }
}

/// A bounded window over `agent_run_id`'s durable JSONL log (PROC-07, D-33) — the mechanical form
/// of "flat memory by construction, not by ceiling." Opens the file with a buffered reader, skips
/// `offset` complete lines, and yields at most `min(limit, LOG_WINDOW_MAX_LIMIT)` of them: it
/// never reads the file into a single string and never collects the whole file into a vector, so
/// no caller — UI, command, or a future one — can pull a whole transcript into memory even by
/// asking for more than the cap.
///
/// A `limit` above [`LOG_WINDOW_MAX_LIMIT`] is clamped to it rather than rejected; the returned
/// [`LogWindow::limit`] reports the effective (clamped) value. An `offset` at or beyond the log's
/// true line count returns an empty window reporting the true `total`, not an error. A run whose
/// log file does not exist yet returns an empty window with `total: 0`, not an error. The
/// trailing fragment of an in-flight write (a final line with no `\n` yet) is excluded from both
/// the window and `total` — a reader only ever sees complete lines.
pub fn read_window(agent_run_id: &str, offset: usize, limit: usize) -> anyhow::Result<LogWindow> {
    let effective_limit = limit.min(LOG_WINDOW_MAX_LIMIT);
    let total = count_lines(agent_run_id)?;
    if total == 0 {
        return Ok(LogWindow { entries: Vec::new(), offset, limit: effective_limit, total: 0 });
    }

    let path = session_log_path(agent_run_id)?;
    let file =
        File::open(&path).with_context(|| format!("failed to open session log file {path:?}"))?;
    let reader = BufReader::new(file);

    let mut entries = Vec::new();
    for (line_number, line_result) in reader.lines().enumerate() {
        if line_number >= total {
            // Never step into the trailing in-flight fragment (excluded from `total` above).
            break;
        }
        if line_number < offset {
            continue;
        }
        if entries.len() >= effective_limit {
            break;
        }
        let line = line_result
            .with_context(|| format!("failed to read line {line_number} from {path:?}"))?;
        entries.push(parse_log_line(&line, line_number));
    }

    Ok(LogWindow { entries, offset, limit: effective_limit, total })
}
