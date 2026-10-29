//! `output_with_timeout` must report what the child actually did. A child that exits at the
//! timeout is reported with its real status and output, never as a fabricated timeout; a child
//! that never exits is still killed and reported as one. Real child processes, short explicit
//! timeouts (the production ceilings are 30s and 120s).
//!
//! Honest limit: the window the fix closes is the gap between one exit check and the next clock
//! read, a few instructions wide. No test can force the old ordering to lose that race on demand,
//! so these pin the three outcomes and run the near-timeout case repeatedly to make a regression
//! likely to surface; they are not a deterministic reproducer.

use flywheel_core::proc::output_with_timeout;
use std::process::Command;
use std::time::Duration;

fn sh(script: &str) -> Command {
    let mut cmd = Command::new("sh");
    cmd.arg("-c").arg(script);
    cmd
}

#[test]
fn a_child_exiting_zero_just_before_its_timeout_reports_success_and_its_stdout() {
    // A short sleep against a generous timeout: the exit-before-timeout path without a margin
    // that fork+exec and scheduler jitter on a loaded runner can eat (WR-10). Repeated anyway.
    for _ in 0..10 {
        let out = output_with_timeout(
            &mut sh("sleep 0.05; printf done"),
            None,
            Duration::from_millis(1000),
            "near-timeout success",
        )
        .expect("a child that exits before the ceiling is not a timeout");
        assert_eq!(out.status.code(), Some(0));
        assert_eq!(out.stdout, b"done");
    }
}

#[test]
fn a_child_exiting_non_zero_just_before_its_timeout_reports_that_status() {
    for _ in 0..10 {
        let out = output_with_timeout(
            &mut sh("sleep 0.05; exit 7"),
            None,
            Duration::from_millis(1000),
            "near-timeout failure",
        )
        .expect("a non-zero exit is an outcome, not a timeout");
        assert_eq!(out.status.code(), Some(7));
    }
}

#[test]
fn a_child_that_never_exits_is_still_killed_and_reported_as_a_timeout() {
    let dir = std::env::temp_dir().join(format!("flywheel-proc-timeout-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let pid_file = dir.join("pid");
    // `exec` so the recorded pid is the direct child that `output_with_timeout` kills.
    let script = format!("echo $$ > '{}'; exec sleep 30", pid_file.display());

    let err = output_with_timeout(
        &mut sh(&script),
        None,
        Duration::from_millis(500),
        "hung child",
    )
    .expect_err("a child that outlives the ceiling must time out");
    assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);

    let pid = std::fs::read_to_string(&pid_file)
        .expect("the child recorded its pid")
        .trim()
        .to_string();
    let alive = Command::new("kill")
        .args(["-0", &pid])
        .output()
        .unwrap()
        .status
        .success();
    assert!(!alive, "the timed-out child (pid {pid}) must not survive");
    let _ = std::fs::remove_dir_all(&dir);
}

/// WR-02: the child exits, but a descendant it started keeps the stdout pipe open. The drain must
/// not wait for that descendant: the call returns by the ceiling with the child's real status and
/// the output read so far.
#[test]
fn a_descendant_holding_the_pipe_open_does_not_hold_the_call_past_its_ceiling() {
    let started = std::time::Instant::now();
    let out = output_with_timeout(
        // The background `sleep` inherits stdout and outlives the shell that exits straight away.
        &mut sh("sleep 5 & printf hi"),
        None,
        Duration::from_millis(500),
        "leaked pipe",
    )
    .expect("the child itself exited in time, so this is not a timeout");
    assert_eq!(out.status.code(), Some(0));
    assert_eq!(out.stdout, b"hi");
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "the call waited for the descendant: {:?}",
        started.elapsed()
    );
}
