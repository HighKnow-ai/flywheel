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
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// The ceiling for a `git` invocation (code review WR-02): generous for a `git fetch` on a large
/// repository over a slow link, while still bounding a hang to a fixed wall-clock limit instead
/// of none.
pub const GIT_TIMEOUT_SECS: u64 = 120;

/// The ceiling for a `gh`/`glab` invocation — the figure code review WR-02 itself proposed.
pub const FORGE_CLI_TIMEOUT_SECS: u64 = 30;

/// How often [`output_with_timeout`] polls `Child::try_wait` while watching its deadline.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// The least time [`output_with_timeout`] spends collecting a child's output AFTER the child has
/// exited, even when its own deadline has nearly or fully run out. An exited child's pipes hold
/// only what is already buffered, so a healthy drain takes microseconds; this floor is for a slow
/// machine, not for a descendant that kept a pipe open (that case is cut off by it).
const DRAIN_FLOOR: Duration = Duration::from_millis(500);

/// One output stream being drained on its own thread. The bytes land in a shared buffer as they
/// arrive, so a drain that has to be abandoned can still hand back what was read so far.
struct Drain {
    buf: Arc<Mutex<Vec<u8>>>,
    done: Receiver<()>,
}

fn drain<R: Read + Send + 'static>(mut pipe: R) -> Drain {
    let buf = Arc::new(Mutex::new(Vec::new()));
    let (tx, done) = mpsc::channel();
    let sink = Arc::clone(&buf);
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        // A read error and EOF both end the stream; neither is a reason to fail the call.
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if let Ok(mut b) = sink.lock() {
                b.extend_from_slice(&chunk[..n]);
            }
        }
        let _ = tx.send(());
    });
    Drain { buf, done }
}

impl Drain {
    /// Wait for EOF until `deadline`, then return whatever has been read. If a descendant still
    /// holds the pipe open the reader thread is left behind to finish on its own.
    fn collect(self, deadline: Instant) -> Vec<u8> {
        let _ = self.done.recv_timeout(deadline.saturating_duration_since(Instant::now()));
        self.buf.lock().map(|mut b| std::mem::take(&mut *b)).unwrap_or_default()
    }
}

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
/// would have produced, except that if a descendant keeps a pipe open past the child's exit the
/// output read so far is returned once the deadline (or [`DRAIN_FLOOR`]) passes. On timeout, the returned error's kind is `ErrorKind::TimedOut` and its
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

    let stdout_drain = drain(child.stdout.take().expect("stdout was piped above"));
    let stderr_drain = drain(child.stderr.take().expect("stderr was piped above"));

    // Writing (and closing) stdin off the calling thread for the same reason stdout/stderr are
    // drained off it: a child that never reads its input must not be able to block this
    // function's deadline watch.
    // The thread is never joined: it has nothing to return, and a descendant that holds the
    // read end of stdin open without reading would make a join wait indefinitely.
    if let Some(bytes) = stdin {
        let mut stdin_pipe = child.stdin.take().expect("stdin was piped above");
        let owned = bytes.to_vec();
        std::thread::spawn(move || {
            let _ = stdin_pipe.write_all(&owned);
            // Dropping `stdin_pipe` here closes the child's stdin (EOF).
        });
    }

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
            // The direct child has exited, but a pipe only reaches EOF once EVERY holder of its
            // write end has closed it, and a descendant can outlive the child holding one open
            // (`git fetch` over ssh with `ControlPersist`, a credential helper, a daemonised `gc
            // --auto`). Waiting for EOF unconditionally would then hang past the ceiling this
            // function exists to enforce, so the drain gets what is left of the deadline (never
            // less than DRAIN_FLOOR) and returns what it has. The child's status is real either
            // way; only a straggler's late output is dropped.
            let drain_by = Instant::now() + timeout.saturating_sub(start.elapsed()).max(DRAIN_FLOOR);
            let stdout = stdout_drain.collect(drain_by);
            let stderr = stderr_drain.collect(drain_by);
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
            drop(stdout_drain);
            drop(stderr_drain);
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("{label} exceeded {}s and was killed", timeout.as_secs()),
            ))
        }
    }
}
