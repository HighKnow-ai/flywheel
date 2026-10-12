//! PROC-02's shared bounded-wait guard (verification Gap 1's second `missing:` item; code
//! review WR-02): the ONE place in this workspace that waits on an already-spawned `gh`, `glab`
//! or `git` child process. [`crate::git::spawn_git`], [`crate::forge::github`]'s `spawn_gh` and
//! [`crate::forge::gitlab`]'s `spawn_glab` each build their own `Command` — the thing
//! `packages/core/tests/supervisor_cwd.rs` asserts only `git.rs` may do for `"git"` — and hand it
//! here so the wait is bounded by a fixed wall-clock ceiling regardless of caller.
//!
//! This module deliberately constructs no `Command` of its own: [`output_with_timeout`] always
//! takes an already-built `&mut Command`, never a program name, which makes it structurally
//! impossible for a future caller to add a fourth, unguarded `Command::new(...)` here instead of
//! routing through the three existing spawn helpers.

use std::io::{Read, Write};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

/// The ceiling for a `git` invocation (code review WR-02): generous for a `git fetch` on a large
/// repository over a slow link, while still bounding a hang to a fixed wall-clock limit instead
/// of none.
pub const GIT_TIMEOUT_SECS: u64 = 120;

/// The ceiling for a `gh`/`glab` invocation — the figure code review WR-02 itself proposed.
pub const FORGE_CLI_TIMEOUT_SECS: u64 = 30;

/// How often [`output_with_timeout`] polls `Child::try_wait` while watching its deadline.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Spawn `cmd`, write `stdin` (if any) to it, drain its stdout/stderr, and wait for it to exit —
/// killing and reaping it instead if it has not exited within `timeout`.
///
/// `cmd` arrives already configured (program, args, working directory); this function never
/// constructs a `Command` of its own (see module doc). The only pid this function ever signals is
/// the one its own `cmd.spawn()` call below returns — never a pid looked up, parsed or received
/// from anywhere else.
///
/// Standard input is closed (never inherited from this process) when `stdin` is `None` —
/// load-bearing, not tidiness: a bare `spawn()` would otherwise let a CLI that
/// wants to prompt interactively block forever on a terminal it was never meant to see (one of
/// the hang modes code review CR-01 names). Standard output and standard error are drained on
/// dedicated threads concurrently with the deadline watch, so a child that writes more than the
/// OS pipe buffer holds cannot deadlock against this function waiting for it to exit.
///
/// On a normal exit, the returned `Output` is byte-identical to what an unbounded `cmd.output()`
/// would have produced. On timeout, the returned error's kind is `ErrorKind::TimedOut` and its
/// message interpolates only `label` and the ceiling — never the child's captured stdout/stderr,
/// so a token or credential a failing CLI echoed cannot be relocated into a log line by this
/// path.
pub fn output_with_timeout(
    cmd: &mut Command,
    stdin: Option<&[u8]>,
    timeout: Duration,
    label: &str,
) -> std::io::Result<Output> {
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() });

    let mut child = cmd.spawn()?;

    let mut stdout_pipe = child.stdout.take().expect("stdout was piped above");
    let stdout_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });

    let mut stderr_pipe = child.stderr.take().expect("stderr was piped above");
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    // Writing (and closing) stdin off the calling thread for the same reason stdout/stderr are
    // drained off it: a child that never reads its input must not be able to block this
    // function's deadline watch.
    let stdin_thread = stdin.map(|bytes| {
        let mut stdin_pipe = child.stdin.take().expect("stdin was piped above");
        let owned = bytes.to_vec();
        std::thread::spawn(move || {
            let _ = stdin_pipe.write_all(&owned);
            // Dropping `stdin_pipe` here closes the child's stdin (EOF).
        })
    });

    let start = Instant::now();
    let status = loop {
        // Read the clock BEFORE the exit check, never after it: the deadline is only acted on
        // when the child was still running at an exit check made at-or-after the deadline. The
        // reverse order left a window in which a child that exited between the check and the
        // clock read was killed and reported as `TimedOut`, discarding its real status.
        let expired = start.elapsed() >= timeout;
        match child.try_wait()? {
            Some(status) => break Some(status),
            None if expired => break None,
            None => std::thread::sleep(POLL_INTERVAL),
        }
    };

    match status {
        Some(status) => {
            // The direct child has already exited, so joining here waits only on however long
            // was left to drain its pipes — never past this function's own deadline watch.
            if let Some(handle) = stdin_thread {
                let _ = handle.join();
            }
            // A reader thread panicking is not a reason to fail this call — treat a join error as
            // an empty buffer for that stream, keeping this function's own failure modes limited
            // to "failed to spawn" and "timed out".
            let stdout = stdout_thread.join().unwrap_or_default();
            let stderr = stderr_thread.join().unwrap_or_default();
            Ok(Output { status, stdout, stderr })
        }
        None => {
            // Kill and reap the direct child only — never a pid this function did not itself
            // spawn (T-07-10-05). That direct child may itself have forked a grandchild (a shell
            // wrapper's final command, a credential helper, a transport subprocess) that inherits
            // the stdout/stderr/stdin pipe descriptors and keeps them open after the direct child
            // is gone; a pipe's read side only sees EOF once EVERY copy of its write side is
            // closed, so joining the reader/writer threads here could block on that surviving
            // descendant for however long IT runs — defeating the ceiling this function exists to
            // enforce. Deliberately abandon them instead: they keep draining in the background and
            // exit on their own once the pipes do close, but this function returns now, bounded by
            // `timeout`, without waiting on them.
            let _ = child.kill();
            let _ = child.wait();
            drop(stdin_thread);
            drop(stdout_thread);
            drop(stderr_thread);
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("{label} exceeded {}s and was killed", timeout.as_secs()),
            ))
        }
    }
}
