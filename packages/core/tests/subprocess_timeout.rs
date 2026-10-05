//! Proves `proc::output_with_timeout` bounds every subprocess hang (code review WR-02) and that
//! the `gh`/`glab`/`git` spawn helpers route through it. Structured on `tests/forge_degrade.rs`'s
//! PATH-sabotage pattern: a module-level serialising mutex, a `tempfile::tempdir()` scratch
//! directory holding executable shell stubs, and `PATH` restored before every helper returns.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use core::proc::{output_with_timeout, FORGE_CLI_TIMEOUT_SECS, GIT_TIMEOUT_SECS};

/// Serializes every call in this binary that mutates `PATH` — mirrors `forge_degrade.rs`'s own
/// `ENV_LOCK` (each `tests/*.rs` file compiles to its own binary, so this static cannot race with
/// that one).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Short enough that every guard-behaviour test below runs in well under a second.
const SHORT_CEILING: Duration = Duration::from_millis(300);

/// Write an executable shell stub at `dir`/`name` running `body`.
fn write_stub(dir: &Path, name: &str, body: &str) {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("failed to write stub script");
    let mut perms = std::fs::metadata(&path).expect("stub metadata").permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("failed to chmod stub");
}

/// Prepend `dir` to `PATH` for the duration of `f`, serialized against every other caller in this
/// binary via [`ENV_LOCK`], then restore the original `PATH` before returning.
fn with_stub_on_path<T>(dir: &Path, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());

    let original_path = std::env::var_os("PATH");
    let prepended = match &original_path {
        Some(p) => format!("{}:{}", dir.display(), p.to_string_lossy()),
        None => dir.display().to_string(),
    };
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates PATH while it's set, and this helper always restores it before returning.
    unsafe {
        std::env::set_var("PATH", &prepended);
    }

    let result = f();

    unsafe {
        match &original_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }
    result
}

#[test]
fn fast_child_returns_unchanged_output() {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg("echo hello; exit 0");
    let output = output_with_timeout(&mut cmd, None, SHORT_CEILING, "fast child")
        .expect("a child that exits quickly should not time out");
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "hello");
}

#[test]
fn hung_child_is_killed_within_its_ceiling_and_reports_timed_out() {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg("sleep 30");
    let start = Instant::now();
    let err = output_with_timeout(&mut cmd, None, SHORT_CEILING, "hung child")
        .expect_err("a child that never exits should be killed and reported as a timeout");
    let elapsed = start.elapsed();

    assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
    assert!(elapsed >= SHORT_CEILING, "returned before its own ceiling: {elapsed:?}");
    assert!(
        elapsed < SHORT_CEILING + Duration::from_millis(700),
        "returned long after its ceiling, not within a small margin: {elapsed:?}"
    );

    // The timeout error never carries the child's captured output (T-07-10-04).
    let message = err.to_string();
    assert!(!message.contains("stdout"), "timeout error leaked a stdout reference: {message}");
    assert!(!message.contains("stderr"), "timeout error leaked a stderr reference: {message}");
}

#[test]
fn child_output_larger_than_pipe_buffer_still_completes() {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg("head -c 5000000 /dev/zero");
    let output = output_with_timeout(&mut cmd, None, SHORT_CEILING, "large output")
        .expect("a child writing past the pipe buffer should not deadlock the guard");
    assert!(output.status.success());
    assert_eq!(output.stdout.len(), 5_000_000);
}

#[test]
fn child_with_no_stdin_payload_sees_closed_stdin_not_a_hang() {
    // If stdin were inherited rather than closed, `cat` would block forever waiting for this
    // test process's own stdin to reach EOF.
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg("cat > /dev/null; echo done");
    let output = output_with_timeout(&mut cmd, None, SHORT_CEILING, "reads stdin")
        .expect("stdin should be closed (EOF), never inherited from this process");
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "done");
}

#[test]
fn stdin_payload_is_written_and_closed_before_exit() {
    let mut cmd = Command::new("/bin/sh");
    cmd.arg("-c").arg("cat");
    let output = output_with_timeout(&mut cmd, Some(b"payload"), SHORT_CEILING, "writes stdin")
        .expect("a child reading a supplied stdin payload should see it, then EOF, then exit");
    assert!(output.status.success());
    assert_eq!(output.stdout, b"payload");
}

#[test]
fn ceiling_constants_match_wr_02() {
    assert_eq!(FORGE_CLI_TIMEOUT_SECS, 30);
    assert_eq!(GIT_TIMEOUT_SECS, 120);
}

/// Ignored solely because it burns the real 30-second `FORGE_CLI_TIMEOUT_SECS` ceiling, which
/// would slow every default workspace run; this plan's own `<verify>` block runs it explicitly
/// via `cargo test -p core --test subprocess_timeout -- --ignored`.
#[test]
#[ignore]
fn gh_request_for_branch_against_a_hung_gh_returns_bounded_error() {
    let stub_dir = tempfile::tempdir().expect("failed to create scratch stub dir");
    write_stub(stub_dir.path(), "gh", "sleep 40");

    with_stub_on_path(stub_dir.path(), || {
        let repo = tempfile::tempdir().expect("failed to create scratch repo dir");
        let start = Instant::now();
        let result = core::forge::github::request_for_branch(repo.path(), "whatever");
        let elapsed = start.elapsed();

        assert!(result.is_err(), "a hung gh should surface as an error, not a hang");
        assert!(
            elapsed >= Duration::from_secs(FORGE_CLI_TIMEOUT_SECS),
            "returned before the forge CLI ceiling: {elapsed:?}"
        );
        assert!(
            elapsed < Duration::from_secs(FORGE_CLI_TIMEOUT_SECS + 10),
            "returned long after the forge CLI ceiling: {elapsed:?}"
        );
    });
}
