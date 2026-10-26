//! Proves `proc::output_with_timeout` bounds every subprocess hang (code review WR-02) and that
//! the `git` spawn helper still routes through it unchanged.

use std::process::Command;
use std::time::{Duration, Instant};

use flywheel_core::proc::{output_with_timeout, FORGE_CLI_TIMEOUT_SECS, GIT_TIMEOUT_SECS};

/// Short enough that every guard-behaviour test below runs in well under a second.
const SHORT_CEILING: Duration = Duration::from_millis(300);

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

/// Proves the guard did not change the success path for `git.rs`'s own spawn helper: a real
/// invocation through [`flywheel_core::git::git_at`] against a stub-free, freshly `git init`-ed repository
/// still succeeds exactly as it did before this plan.
#[test]
fn git_at_still_succeeds_normally_on_a_real_repository() {
    let repo = tempfile::tempdir().expect("failed to create scratch repo dir");
    let status = Command::new("git")
        .arg("-C")
        .arg(repo.path())
        .args(["init", "--quiet"])
        .status()
        .expect("failed to spawn git init for the test fixture");
    assert!(status.success(), "git init should succeed for the test fixture");

    let output = flywheel_core::git::git_at(repo.path(), &["rev-parse", "--is-inside-work-tree"])
        .expect("git_at should still succeed on a real repository after routing through the guard");
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), "true");
}
