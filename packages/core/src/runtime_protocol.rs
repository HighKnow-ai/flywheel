//! D-47/D-48/D-50's on-disk runtime protocol: a heartbeat file every live session's watchdog
//! polls, a per-run descriptor recording the pid AND process start time Flywheel spawned
//! (PROC-03's pid-reuse safety — no function in this module accepts or returns a bare pid
//! without one), and a kill record explaining why a watchdog terminated a session's process
//! group (D-50). Every function here returns a value on failure — never `unwrap()`, `expect(`,
//! or `panic!` (CR-03) — because a runtime-file I/O fault for ONE session must never take down
//! the shared sidecar reader task or the rest of the supervisor.
//!
//! This module NEVER opens, reads, or writes the SQLite database — no `rusqlite`/`Connection`
//! reference anywhere in this file, enforced by this plan's own source-scanning `<verify>` gate.
//! It is a pure file-I/O protocol: the Rust core writes/reads it directly, and the Node sidecar's
//! watchdog (`packages/sidecar/src/watchdog.ts`) writes/reads the SAME on-disk JSON shapes
//! independently — never a second SQLite writer (T-03-02-06, `.claude/CLAUDE.md`'s single-writer
//! rule).

use std::fs::{self, File};
use std::io::Write as _;
use std::path::{Path, PathBuf};

use anyhow::Context;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessesToUpdate, System};

/// How often the Rust core's own heartbeat-writer thread (`packages/desktop/src-tauri/src/
/// sidecar.rs`'s `spawn_sidecar`) touches the heartbeat file. Tunable in one place; see
/// [`HEARTBEAT_STALE_MS`] for the tradeoff this value is one factor of.
pub const HEARTBEAT_INTERVAL_MS: u64 = 2_000;

/// How often each session's watchdog (`packages/sidecar/src/watchdog.ts`) re-reads the heartbeat
/// file. Deliberately independent of [`HEARTBEAT_INTERVAL_MS`] — the watchdog is a separate
/// process reading a file the Rust core writes, never a subscriber to it.
pub const HEARTBEAT_POLL_MS: u64 = 2_000;

/// The staleness threshold past which a watchdog concludes the supervisor is gone and
/// force-kills its own session's process group with no grace window (D-48) — deliberately MORE
/// than seven [`HEARTBEAT_INTERVAL_MS`] touch intervals. 03-CONTEXT.md names the tradeoff
/// directly: "a short threshold kills a merely-slow supervisor; a long one is unattended spend."
/// Fifteen seconds of worst-case unattended spend for ONE session is cheaper than killing a live
/// agent because the supervisor paused for a GC pause or a synchronous pre-migration backup
/// (`db::open_and_migrate` already does exactly that kind of pause on the main thread).
pub const HEARTBEAT_STALE_MS: u64 = 15_000;

const HEARTBEAT_FILE_NAME: &str = "heartbeat";
const RUNS_DIR_NAME: &str = "runs";
const KILLS_DIR_NAME: &str = "kills";

/// The outcome of one write attempt against this protocol's on-disk files — mirrors
/// `packages/desktop/src-tauri/src/sidecar.rs`'s `PersistOutcome` shape exactly: a plain returned
/// value, never a panic and never a silently swallowed `let _ =`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeIo {
    /// The write succeeded.
    Written,
    /// The write failed; carries the error text. Nothing on disk was left half-written — every
    /// write in this module goes through [`atomic_write`]'s temp-file-then-rename idiom, so a
    /// failure here means the temp file or the rename itself failed, never a torn target file.
    WriteFailed(String),
}

/// The outcome of reading one run's kill record (D-50).
#[derive(Debug, Clone, PartialEq)]
pub enum KillRecordRead {
    /// A kill record exists for this run and parsed successfully.
    Found(KillRecord),
    /// No kill record file exists for this run — the normal case for a run no watchdog has ever
    /// killed.
    Absent,
    /// A file exists at this run's kill-record path but did not parse as a [`KillRecord`] — read
    /// as a DISTINCT, honest "unknown" outcome rather than silently folded into [`Self::Absent`],
    /// so a caller (plan 03-10's recovery copy) can downgrade to a weaker claim instead of
    /// inventing a reason. Carries the parse error text.
    Malformed(String),
}

/// D-50's on-disk explanation for why a watchdog terminated a session's process group — written
/// BEFORE the kill signal is sent, so the explanation survives even when the kill itself is the
/// last thing the watchdog does. `run_id`/`pid`/`start_time` name exactly which process was
/// killed; `start_time` is what makes a later liveness check pid-reuse-safe (T-03-02-05) — no
/// function in this module accepts or returns a bare `pid` without it.
///
/// Field names are plain `snake_case` and MUST stay byte-identical to
/// `packages/sidecar/src/watchdog.ts`'s own kill-record JSON shape: the watchdog is a SEPARATE
/// Node process that writes this exact shape itself rather than calling into this Rust struct —
/// the two sides agree by convention, stated in both files' doc comments, not by a shared
/// serializer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct KillRecord {
    pub run_id: String,
    pub pid: i32,
    pub start_time: u64,
    pub reason: String,
    pub killed_at: String,
}

/// The pid AND process start time Flywheel spawned for one run (PROC-03) — the record a later
/// liveness check (plan 03-06) compares a live process's own start time against, so an OS-recycled
/// pid can never be mistaken for the process Flywheel actually started. Same cross-language field
/// contract as [`KillRecord`]: `packages/sidecar/src/claude-code-adapter.ts` writes this exact
/// shape itself, from the Node side, immediately after spawning the watchdog wrapper.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunDescriptor {
    pub run_id: String,
    pub pid: i32,
    pub start_time: u64,
    pub started_at: String,
}

/// Resolve `<app-data>/runtime/`, creating it (and any missing parents) if absent — beside
/// `session_log.rs::sessions_dir`'s own `<app-data>/sessions/` sibling. Overridable via
/// `FLYWHEEL_RUNTIME_DIR`, mirroring `git::worktree_root_from_env`'s own test-only-override
/// pattern for `FLYWHEEL_WORKTREE_ROOT` — but this override is ALSO the production seam:
/// `sidecar.rs`'s `resolved_env_for_run` reads this exact resolved value and passes it into every
/// spawned session's environment, so the watchdog reads the SAME directory this function
/// resolves. One function, one source of truth for where the protocol lives.
pub fn runtime_dir() -> anyhow::Result<PathBuf> {
    let dir = if let Some(over) = std::env::var_os("FLYWHEEL_RUNTIME_DIR") {
        PathBuf::from(over)
    } else {
        let db_path = crate::db::default_db_path()?;
        let app_data = db_path
            .parent()
            .context("default_db_path returned a path with no parent directory")?;
        app_data.join("runtime")
    };
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create runtime directory {dir:?}"))?;
    Ok(dir)
}

fn heartbeat_path(dir: &Path) -> PathBuf {
    dir.join(HEARTBEAT_FILE_NAME)
}

fn runs_dir(dir: &Path) -> PathBuf {
    dir.join(RUNS_DIR_NAME)
}

fn kills_dir(dir: &Path) -> PathBuf {
    dir.join(KILLS_DIR_NAME)
}

/// `<runtime>/contention/` — the PATH shim binary's own D-53 lock-contention log directory
/// (`packages/shim/src/main.rs`'s `write_contention_record`), named here so
/// [`clear_run_runtime_files`] can clean up a resolved orphan's contention log using the SAME
/// `runtime_dir()`-relative path that binary already writes to, without duplicating its constant.
fn contention_dir(dir: &Path) -> PathBuf {
    dir.join("contention")
}

/// Write `contents` to `path` atomically: write to a sibling temp file in the SAME directory,
/// then rename over `path` — so a reader ([`read_heartbeat_age`], [`read_kill_record`], or the
/// watchdog's own file read) never observes a half-written file. The temp file's name is unique
/// per call (this process's own pid plus a monotonic in-process counter), so concurrent writers
/// targeting the same directory never collide on the same temp path.
fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir)?;
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let file_name = path
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("runtime-protocol");
    let tmp_path = dir.join(format!(".{file_name}.tmp.{}.{n}", std::process::id()));
    {
        let mut f = File::create(&tmp_path)?;
        f.write_all(contents)?;
        f.flush()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Touch the heartbeat file (D-47): write the current RFC3339 UTC timestamp, atomically. Called
/// on a fixed interval by `sidecar.rs`'s own heartbeat thread while Flywheel is alive. Every
/// failure mode — a runtime directory that cannot be resolved or created, a temp file that
/// cannot be written or renamed — returns [`RuntimeIo::WriteFailed`] rather than panicking,
/// because this runs on a detached background thread with no caller able to catch an unwind.
pub fn touch_heartbeat() -> RuntimeIo {
    let dir = match runtime_dir() {
        Ok(dir) => dir,
        Err(err) => return RuntimeIo::WriteFailed(format!("{err:#}")),
    };
    let now = Utc::now().to_rfc3339();
    match atomic_write(&heartbeat_path(&dir), now.as_bytes()) {
        Ok(()) => RuntimeIo::Written,
        Err(err) => RuntimeIo::WriteFailed(format!("{err}")),
    }
}

/// The duration since the heartbeat file's own recorded timestamp, or `None` when the file is
/// absent, empty, or its contents do not parse as RFC3339 — an unparseable or missing heartbeat
/// reads as "no heartbeat has ever been recorded," NEVER as "fresh." A watchdog treats `None` as
/// having no evidence of a live supervisor, subject only to its own startup grace window.
pub fn read_heartbeat_age() -> Option<std::time::Duration> {
    let dir = runtime_dir().ok()?;
    let contents = fs::read_to_string(heartbeat_path(&dir)).ok()?;
    let trimmed = contents.trim();
    if trimmed.is_empty() {
        return None;
    }
    let recorded = chrono::DateTime::parse_from_rfc3339(trimmed).ok()?;
    let elapsed = Utc::now().signed_duration_since(recorded.with_timezone(&Utc));
    elapsed.to_std().ok()
}

/// Write `<runtime>/kills/<run_id>.json` (D-50) — called by a watchdog (or, in tests, directly)
/// BEFORE the kill signal is ever sent, so the explanation survives even when the kill itself is
/// the last thing the watchdog does. `killed_at` is stamped as the current RFC3339 UTC time.
pub fn write_kill_record(run_id: &str, pid: i32, start_time: u64, reason: &str) -> RuntimeIo {
    let dir = match runtime_dir() {
        Ok(dir) => dir,
        Err(err) => return RuntimeIo::WriteFailed(format!("{err:#}")),
    };
    let record = KillRecord {
        run_id: run_id.to_string(),
        pid,
        start_time,
        reason: reason.to_string(),
        killed_at: Utc::now().to_rfc3339(),
    };
    let body = match serde_json::to_vec_pretty(&record) {
        Ok(body) => body,
        Err(err) => {
            return RuntimeIo::WriteFailed(format!("failed to serialize kill record: {err}"))
        }
    };
    let path = kills_dir(&dir).join(format!("{run_id}.json"));
    match atomic_write(&path, &body) {
        Ok(()) => RuntimeIo::Written,
        Err(err) => RuntimeIo::WriteFailed(format!("{err}")),
    }
}

/// Read `run_id`'s kill record, if any (D-50). See [`KillRecordRead`] for the three-way outcome:
/// a missing file is [`KillRecordRead::Absent`], a present-but-unparseable file is
/// [`KillRecordRead::Malformed`] — the two are never conflated.
pub fn read_kill_record(run_id: &str) -> KillRecordRead {
    let dir = match runtime_dir() {
        Ok(dir) => dir,
        Err(_) => return KillRecordRead::Absent,
    };
    let path = kills_dir(&dir).join(format!("{run_id}.json"));
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(_) => return KillRecordRead::Absent,
    };
    match serde_json::from_str::<KillRecord>(&contents) {
        Ok(record) => KillRecordRead::Found(record),
        Err(err) => KillRecordRead::Malformed(format!("{err}")),
    }
}

/// Write `<runtime>/runs/<run_id>.json` (PROC-03) recording the pid Flywheel spawned AND its
/// process start time — the pair a later liveness check (plan 03-06) compares against so a
/// recycled pid can never be mistaken for the process Flywheel actually started.
pub fn write_run_descriptor(run_id: &str, pid: i32, start_time: u64) -> RuntimeIo {
    let dir = match runtime_dir() {
        Ok(dir) => dir,
        Err(err) => return RuntimeIo::WriteFailed(format!("{err:#}")),
    };
    let descriptor = RunDescriptor {
        run_id: run_id.to_string(),
        pid,
        start_time,
        started_at: Utc::now().to_rfc3339(),
    };
    let body = match serde_json::to_vec_pretty(&descriptor) {
        Ok(body) => body,
        Err(err) => {
            return RuntimeIo::WriteFailed(format!("failed to serialize run descriptor: {err}"))
        }
    };
    let path = runs_dir(&dir).join(format!("{run_id}.json"));
    match atomic_write(&path, &body) {
        Ok(()) => RuntimeIo::Written,
        Err(err) => RuntimeIo::WriteFailed(format!("{err}")),
    }
}

/// Every run descriptor currently on disk (PROC-03). A malformed or unreadable entry is skipped
/// rather than failing the whole listing — one corrupt file must never hide every other live run
/// from a reconciliation pass (plan 03-06 consumes this).
pub fn list_run_descriptors() -> Vec<RunDescriptor> {
    let dir = match runtime_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };
    let entries = match fs::read_dir(runs_dir(&dir)) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut descriptors = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(contents) = fs::read_to_string(&path) {
            if let Ok(descriptor) = serde_json::from_str::<RunDescriptor>(&contents) {
                descriptors.push(descriptor);
            }
        }
    }
    descriptors
}

/// Whether the process identified by `pid` is still the SAME process Flywheel recorded (plan
/// 03-06, PROC-05, T-03-06-01) — the pid exists AND its own reported start time still matches
/// `start_time`. A pid the OS has since recycled to an unrelated process reports a DIFFERENT
/// start time and is therefore classified dead, never mistaken for a live orphan.
///
/// `start_time` is epoch MILLISECONDS — the unit both `packages/sidecar/src/watchdog.ts`'s
/// `processStartTimeMs` and `claude-code-adapter.ts`'s `readOsProcessStartTimeMs` write into
/// every real `RunDescriptor`/`KillRecord` on disk. `sysinfo::Process::start_time()` reports
/// whole SECONDS since the epoch instead — a literal same-unit comparison would classify every
/// genuinely live process as dead, since a seconds value can equal a milliseconds value only by
/// astronomical coincidence. This function is the one place that reconciles the two units
/// (multiplying sysinfo's seconds by 1000), so every caller compares like-for-like without
/// needing to know either side's native unit.
///
/// Refreshes ONLY the single requested pid — never [`ProcessesToUpdate::All`] — so this never
/// scans the whole process table before the window paints (T-03-06-06, this plan's own DoS
/// mitigation). Any uncertainty (the pid does not exist, or is not a real positive OS process id)
/// resolves to `false`: the fail-closed direction here is "assume it is dead," because presenting
/// a modal offering to kill a process that does not exist is worse than missing a genuinely live
/// one.
pub fn process_is_alive(pid: i32, start_time: u64) -> bool {
    if pid <= 0 {
        return false;
    }
    let sys_pid = Pid::from_u32(pid as u32);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[sys_pid]), true);
    match system.process(sys_pid) {
        Some(process) => process.start_time().saturating_mul(1000) == start_time,
        None => false,
    }
}

/// Remove `run_id`'s descriptor, kill record and lock-contention log (plan 03-06) — called by the
/// launch reconciler at the exact moment a run reaches a terminal status, and nowhere else. This
/// resolves 03-CONTEXT.md's own "who cleans stale files up" discretion item: the reconciler is
/// the only writer of a terminal status for an orphaned run, so it is the only cleaner of that
/// run's files, which is what keeps a resolved orphan from being re-detected on every subsequent
/// launch.
///
/// A missing file is not a failure — idempotent by construction, since a run may already have
/// had some or all of its files removed by an earlier call (or may simply never have had a
/// contention log at all, the common case).
pub fn clear_run_runtime_files(run_id: &str) -> RuntimeIo {
    let dir = match runtime_dir() {
        Ok(dir) => dir,
        Err(err) => return RuntimeIo::WriteFailed(format!("{err:#}")),
    };
    let paths = [
        runs_dir(&dir).join(format!("{run_id}.json")),
        kills_dir(&dir).join(format!("{run_id}.json")),
        contention_dir(&dir).join(format!("{run_id}.jsonl")),
    ];
    for path in paths {
        if let Err(err) = fs::remove_file(&path) {
            if err.kind() != std::io::ErrorKind::NotFound {
                return RuntimeIo::WriteFailed(format!("failed to remove {path:?}: {err}"));
            }
        }
    }
    RuntimeIo::Written
}
