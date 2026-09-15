//! D-51's PATH shim binary. This binary is deliberately NOT built or invoked by cargo under the
//! name `git` — `flywheel_core::shim::install_for_run` creates the on-disk entry named `git` (or
//! `git.exe`) at spawn time by hard-linking/copying this compiled binary. Dispatch reads `argv[0]`
//! (never the cargo package/binary name) so a later plan (03-07) can install a SECOND shadowed
//! name through the exact same binary without a second build target.
//!
//! **Fail-closed, by construction, in three distinct ways (T-03-04-02, T-03-04-03):**
//! 1. An unrecognised `argv[0]` stem refuses to run anything at all (the `match`'s explicit
//!    unknown-name arm, never a fallback `if`).
//! 2. The real binary is resolved EXACTLY ONCE, from `FLYWHEEL_REAL_GIT` — asserted absolute and
//!    existing — and NEVER through a `PATH` lookup or a `which` invocation. A shim placed first on
//!    `PATH` under the name `git` therefore cannot ever resolve to itself: it has no code path that
//!    reads `PATH` at all.
//! 3. Any resolution failure (the env var absent, empty, relative, or naming a non-existent file)
//!    exits non-zero with a message naming the variable, WITHOUT executing anything — never a
//!    silent passthrough.
//!
//! This binary writes at most one file (`<runtime>/contention/<run_id>.jsonl`, on lock-retry
//! exhaustion) and nothing else — no `rusqlite`/`Connection` reference anywhere in this file, the
//! same single-writer discipline `packages/sidecar/src/watchdog.ts` and
//! `packages/core/src/runtime_protocol.rs` already hold to.

use std::env;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Output};

/// What one real-git invocation attempt produced, captured so the retry executor can inspect
/// `stderr` for the lock-contention matcher while the ORIGINAL bytes are still forwarded verbatim
/// to this process's own stdout/stderr once the retry loop concludes.
struct CapturedOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    exit_code: Option<i32>,
}

impl From<Output> for CapturedOutput {
    fn from(output: Output) -> Self {
        Self {
            stdout: output.stdout,
            stderr: output.stderr,
            exit_code: output.status.code(),
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<OsString> = env::args_os().collect();
    let invoked_stem = args
        .first()
        .and_then(|argv0| Path::new(argv0).file_stem())
        .map(|stem| stem.to_string_lossy().into_owned());

    match invoked_stem.as_deref() {
        Some("git") => run_git(&args[1..]),
        other => {
            eprintln!(
                "flywheel-shim: refusing to run — invoked as {:?}, which this build does not dispatch to any known target",
                other.unwrap_or("<unreadable argv[0]>")
            );
            ExitCode::FAILURE
        }
    }
}

/// Resolve `FLYWHEEL_REAL_GIT` — the ONE place this binary ever learns which executable to run.
/// Never falls back to a `PATH` lookup or a `which` invocation (T-03-04-02): a missing, empty,
/// relative, or dangling value is a hard failure, not a degraded default.
fn resolve_real_git_from_env() -> Result<PathBuf, String> {
    let value = env::var_os("FLYWHEEL_REAL_GIT")
        .ok_or_else(|| "FLYWHEEL_REAL_GIT is not set".to_string())?;
    if value.is_empty() {
        return Err("FLYWHEEL_REAL_GIT is set but empty".to_string());
    }
    let path = PathBuf::from(&value);
    if !path.is_absolute() {
        return Err(format!(
            "FLYWHEEL_REAL_GIT does not name an absolute path: {path:?}"
        ));
    }
    if !path.is_file() {
        return Err(format!(
            "FLYWHEEL_REAL_GIT does not name an existing executable: {path:?}"
        ));
    }
    Ok(path)
}

fn run_git(forwarded_args: &[OsString]) -> ExitCode {
    let real_git = match resolve_real_git_from_env() {
        Ok(path) => path,
        Err(message) => {
            eprintln!("flywheel-shim: {message}");
            return ExitCode::FAILURE;
        }
    };

    let command_text = format!(
        "git {}",
        forwarded_args
            .iter()
            .map(|a| a.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
    );

    let mut last_output: Option<CapturedOutput> = None;
    let retry_result = flywheel_core::git_retry::with_lock_retry(&command_text, |_attempt| {
        let output = Command::new(&real_git)
            .args(forwarded_args)
            .output()
            .map_err(|e| anyhow::anyhow!("failed to spawn real git at {real_git:?}: {e}"))?;
        let stderr_text = String::from_utf8_lossy(&output.stderr).into_owned();
        let succeeded = output.status.success();
        last_output = Some(CapturedOutput::from(output));
        if succeeded {
            Ok(())
        } else {
            Err(anyhow::anyhow!(stderr_text))
        }
    });

    match retry_result {
        Ok(_outcome) => forward_and_exit(last_output),
        Err(err) => {
            if let Some(exhausted) = err.downcast_ref::<flywheel_core::git_retry::LockExhausted>() {
                let repository = env::current_dir()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_else(|_| "<unresolved cwd>".to_string());
                write_contention_record(&repository, &command_text, exhausted.attempts);
            }
            forward_and_exit(last_output)
        }
    }
}

/// Write the captured stdout/stderr of the LAST attempt through to this process's own streams —
/// so the agent sees exactly what a direct real-git invocation would have printed — then exit
/// with that same attempt's exit code. If no attempt ever ran (a spawn failure before any output
/// was captured), exit non-zero.
fn forward_and_exit(last_output: Option<CapturedOutput>) -> ExitCode {
    let Some(captured) = last_output else {
        return ExitCode::FAILURE;
    };
    let _ = std::io::stdout().write_all(&captured.stdout);
    let _ = std::io::stderr().write_all(&captured.stderr);
    match captured.exit_code {
        Some(code) => exit_code_from_i32(code),
        None => ExitCode::FAILURE,
    }
}

fn exit_code_from_i32(code: i32) -> ExitCode {
    let clamped = code.clamp(0, 255) as u8;
    ExitCode::from(clamped)
}

/// D-53: append one JSON line to `<runtime>/contention/<run_id>.jsonl` naming the repository, the
/// command and the attempt count, run id read from `FLYWHEEL_RUN_ID`. This is the ONLY file this
/// binary ever writes. A failure to resolve the runtime directory or to append the line is
/// swallowed here — the shim's job is to still exit with the real failure's own exit code
/// regardless of whether this bookkeeping write succeeds (mirrors `runtime_protocol.rs`'s own "one
/// session's I/O fault must never take anything else down" discipline, applied to a plain child
/// process rather than a background thread).
fn write_contention_record(repository: &str, command: &str, attempts: u32) {
    let Some(run_id) = env::var_os("FLYWHEEL_RUN_ID") else {
        return;
    };
    let run_id = run_id.to_string_lossy().into_owned();

    let Ok(runtime_dir) = flywheel_core::runtime_protocol::runtime_dir() else {
        return;
    };
    let dir = runtime_dir.join("contention");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }

    let record = serde_json::json!({
        "kind": "lock_exhausted",
        "repository": repository,
        "command": command,
        "attempts": attempts,
        "at": chrono::Utc::now().to_rfc3339(),
    });
    let Ok(mut line) = serde_json::to_string(&record) else {
        return;
    };
    line.push('\n');

    let path = dir.join(format!("{run_id}.jsonl"));
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = file.write_all(line.as_bytes());
    }
}
