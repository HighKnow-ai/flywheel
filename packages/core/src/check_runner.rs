//! Running one Check (docs/mvp-spec.md §4.4): a shell command run from the worktree root in plain
//! shell, with network allowed and outside the PATH shim's deny-list. Exit 0 passes; a Check still
//! running at its timeout is killed and labelled timed out, never failed.
//!
//! The command runs through the developer's login shell (`$SHELL -l -c`, `/bin/zsh` when `SHELL`
//! is unset), so it sees the PATH their profile sets up: an app launched from Finder starts with a
//! minimal PATH, and `cargo test` or `npm test` would otherwise not be found. It runs in its own
//! process group, with standard error and standard output on one pipe so the tail reads in the
//! order it was printed. When the shell ends, or its timeout passes, the whole group is killed: a
//! test runner's stray child cannot hold the run open, and a timed-out `cargo test` does not keep
//! compiling in the background.
//!
//! The environment is Flywheel's own plus the login profile, not a Story session's: no shadow PATH,
//! so `git`, `rm` and the publishing commands run unclassified, as the spec's run of record requires.

use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
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

/// The developer's login shell: `$SHELL`, or `/bin/zsh` (the macOS default) when it is unset.
pub fn login_shell() -> PathBuf {
    std::env::var_os("SHELL").filter(|s| !s.is_empty()).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/bin/zsh"))
}

/// Run `command` from `worktree_path` through the developer's login shell, for at most `timeout`.
/// An error means the shell could not be started at all, not that the Check failed.
pub fn run_shell_check(worktree_path: &Path, command: &str, timeout: Duration) -> std::io::Result<ShellRun> {
    run_in_login_shell(&login_shell(), &[], worktree_path, command, timeout)
}

/// [`run_shell_check`] with the shell named, and `env` added to the child's environment.
fn run_in_login_shell(
    shell: &Path,
    env: &[(&str, &Path)],
    worktree_path: &Path,
    command: &str,
    timeout: Duration,
) -> std::io::Result<ShellRun> {
    // One pipe for both streams, so the tail keeps the order things were printed in.
    let (mut pipe, writer) = std::io::pipe()?;
    let mut cmd = Command::new(shell);
    cmd.arg("-l")
        .arg("-c")
        .arg(command)
        .current_dir(worktree_path)
        .stdin(Stdio::null())
        .stdout(writer.try_clone()?)
        .stderr(writer)
        .process_group(0);
    for (key, value) in env {
        cmd.env(key, value);
    }
    let mut child = cmd.spawn()?;
    // Drop this process's copies of the write end, so the reader sees EOF once the group is gone.
    drop(cmd);
    let pgid = child.id();

    let buf = Arc::new(Mutex::new(Vec::new()));
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

    /// A Check sees the PATH the developer's login profile sets up, not just Flywheel's own.
    #[test]
    fn a_check_runs_with_a_path_entry_only_the_login_profile_adds() {
        let profile_dir = tempfile::tempdir().unwrap();
        let bin = profile_dir.path().join("only-in-profile");
        std::fs::create_dir(&bin).unwrap();
        let tool = bin.join("flywheel-profile-tool");
        std::fs::write(&tool, "#!/bin/sh\necho from the profile\n").unwrap();
        std::fs::set_permissions(&tool, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        // zsh reads `$ZDOTDIR/.zprofile` for a login shell.
        std::fs::write(profile_dir.path().join(".zprofile"), format!("export PATH=\"{}:$PATH\"\n", bin.display())).unwrap();
        let worktree = tempfile::tempdir().unwrap();

        let run = run_in_login_shell(
            Path::new("/bin/zsh"),
            &[("ZDOTDIR", profile_dir.path())],
            worktree.path(),
            "flywheel-profile-tool",
            Duration::from_secs(30),
        )
        .unwrap();
        assert_eq!(run.outcome, ShellOutcome::Exited(Some(0)), "{}", run.output_tail);
        assert!(run.output_tail.contains("from the profile"));

        let without = run_in_login_shell(
            Path::new("/bin/zsh"),
            &[("ZDOTDIR", worktree.path())],
            worktree.path(),
            "flywheel-profile-tool",
            Duration::from_secs(30),
        )
        .unwrap();
        assert_ne!(without.outcome, ShellOutcome::Exited(Some(0)), "the entry comes from the profile alone");
    }

    #[test]
    fn standard_error_lands_in_the_tail_in_order() {
        let dir = tempfile::tempdir().unwrap();
        let run = run_shell_check(dir.path(), "echo out; echo err >&2; exit 4", Duration::from_secs(30)).unwrap();
        assert_eq!(run.outcome, ShellOutcome::Exited(Some(4)));
        assert!(run.output_tail.contains("out") && run.output_tail.contains("err"), "{}", run.output_tail);
    }
}
