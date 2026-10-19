//! Running one Check (docs/mvp-spec.md §4.4): a shell command run from the worktree root in plain
//! shell, with network allowed and outside the PATH shim's deny-list. Exit 0 passes; a Check still
//! running at its timeout is killed and labelled timed out, never failed.
//!
//! The command runs as `/bin/sh -c` in its own process group, with standard error folded into
//! standard output so the tail reads in the order it was printed. When the shell ends, or its
//! timeout passes, the whole group is killed: a test runner's stray child cannot hold the run open,
//! and a timed-out `cargo test` does not keep compiling in the background.
//!
//! The environment is Flywheel's own, not a Story session's: no shadow PATH, so `git`, `rm` and the
//! publishing commands run unclassified, as the spec's run of record requires.

use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How much of a Check's output is kept: the last 8 KiB.
pub const OUTPUT_TAIL_BYTES: usize = 8 * 1024;

/// How often the deadline is checked while a Check runs.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// How a Check run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellOutcome {
    /// The shell exited with this code (a signal death has none).
    Exited(Option<i32>),
    /// The timeout passed and the run was killed.
    TimedOut,
}

/// What one Check run left: how it ended and the tail of what it printed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellRun {
    pub outcome: ShellOutcome,
    pub output_tail: String,
}

/// Keep only the last [`OUTPUT_TAIL_BYTES`] of `buf` as it grows.
fn keep_tail(buf: &mut Vec<u8>) {
    if buf.len() > 2 * OUTPUT_TAIL_BYTES {
        let cut = buf.len() - OUTPUT_TAIL_BYTES;
        buf.drain(..cut);
    }
}

/// The text of the last [`OUTPUT_TAIL_BYTES`], cut on a character boundary.
fn tail_text(buf: &[u8]) -> String {
    let start = buf.len().saturating_sub(OUTPUT_TAIL_BYTES);
    let text = String::from_utf8_lossy(&buf[start..]);
    text.trim_start_matches('\u{FFFD}').to_string()
}

/// Kill every process in the group `pgid` leads. Only ever called with the pid this module spawned
/// as a group leader.
fn kill_group(pgid: u32) {
    // SAFETY: a plain syscall on a pid this module spawned in its own group; a group already gone
    // returns ESRCH, which is ignored.
    unsafe {
        libc::kill(-(pgid as i32), libc::SIGKILL);
    }
}

/// Run `command` from `worktree_path` in plain shell, for at most `timeout`. An error means the
/// shell could not be started at all, not that the Check failed.
pub fn run_shell_check(worktree_path: &Path, command: &str, timeout: Duration) -> std::io::Result<ShellRun> {
    let script = format!("exec 2>&1\n{command}");
    let mut child = Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .current_dir(worktree_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()?;
    let pgid = child.id();

    let buf = Arc::new(Mutex::new(Vec::new()));
    let mut pipe = child.stdout.take().expect("stdout was piped above");
    let sink = Arc::clone(&buf);
    let reader = std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if let Ok(mut b) = sink.lock() {
                b.extend_from_slice(&chunk[..n]);
                keep_tail(&mut b);
            }
        }
    });

    let start = Instant::now();
    let outcome = loop {
        let expired = start.elapsed() >= timeout;
        match child.try_wait()? {
            Some(status) => break ShellOutcome::Exited(status.code()),
            None if expired => break ShellOutcome::TimedOut,
            None => std::thread::sleep(POLL_INTERVAL),
        }
    };
    // The shell is done or out of time: whatever it left behind in its group goes too, which also
    // closes every copy of the pipe so the reader reaches EOF.
    kill_group(pgid);
    let _ = child.wait();
    let _ = reader.join();

    let output_tail = buf.lock().map(|b| tail_text(&b)).unwrap_or_default();
    Ok(ShellRun { outcome, output_tail })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tail_keeps_the_last_bytes_only() {
        let dir = tempfile::tempdir().unwrap();
        let run = run_shell_check(dir.path(), "seq 1 20000", Duration::from_secs(30)).unwrap();
        assert_eq!(run.outcome, ShellOutcome::Exited(Some(0)));
        assert!(run.output_tail.len() <= OUTPUT_TAIL_BYTES);
        assert!(run.output_tail.trim_end().ends_with("20000"));
        assert!(!run.output_tail.contains("\n1\n"));
    }
}
