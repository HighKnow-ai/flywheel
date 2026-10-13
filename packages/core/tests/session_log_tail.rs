//! `session_log::read_tail` (Phase 10 plan 10-03, FLEET-01, D-167): the bounded read the fleet
//! calls once per live row on every refresh. The boundary cases are the point — a missing file, a
//! partial final line, a line larger than the window, and a window that is exactly full — plus the
//! two properties that make it safe to call that often: it returns a bounded number of lines and it
//! does not scale with the size of the log.
//!
//! Same idiom as `session_log_window.rs`: writes through `session_log_path` into the real app-data
//! directory under a fresh ULID per test, and removes its own file.

use core::ids::new_id;
use core::session_log::{read_tail, session_log_path, LOG_TAIL_MAX_BYTES, LOG_TAIL_MAX_LINES};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::time::Instant;

fn fresh_run() -> (String, std::path::PathBuf) {
    let run_id = new_id();
    let path = session_log_path(&run_id).expect("session_log_path should resolve");
    (run_id, path)
}

fn write_raw(path: &std::path::Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("failed to create sessions dir");
    }
    let mut file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(path)
        .expect("failed to open scratch log file");
    file.write_all(content.as_bytes()).expect("failed to write scratch log content");
}

fn numbered_lines(count: usize) -> String {
    let mut content = String::new();
    for i in 0..count {
        content.push_str(&format!("{{\"type\":\"assistant_text\",\"text\":\"line {i}\"}}\n"));
    }
    content
}

#[test]
fn ten_thousand_line_log_returns_a_bounded_tail_ending_at_the_last_line() {
    let (run_id, path) = fresh_run();
    write_raw(&path, &numbered_lines(10_000));

    let tail = read_tail(&run_id).expect("read_tail should succeed");

    assert_eq!(tail.lines.len(), LOG_TAIL_MAX_LINES);
    assert_eq!(tail.lines.last().unwrap(), r#"{"type":"assistant_text","text":"line 9999"}"#);
    assert_eq!(
        tail.lines.first().unwrap(),
        &format!("{{\"type\":\"assistant_text\",\"text\":\"line {}\"}}", 10_000 - LOG_TAIL_MAX_LINES),
        "lines come back in forward order"
    );
    assert!(!tail.truncated);
    let _ = fs::remove_file(&path);
}

#[test]
fn a_log_that_does_not_exist_is_empty_not_an_error() {
    let (run_id, _path) = fresh_run();
    let tail = read_tail(&run_id).expect("a missing log is a normal state");
    assert!(tail.lines.is_empty());
    assert!(!tail.truncated);
}

#[test]
fn an_empty_file_is_empty() {
    let (run_id, path) = fresh_run();
    write_raw(&path, "");
    let tail = read_tail(&run_id).unwrap();
    assert!(tail.lines.is_empty());
    assert!(!tail.truncated);
    let _ = fs::remove_file(&path);
}

#[test]
fn a_partial_final_line_is_dropped_and_the_complete_lines_before_it_are_kept() {
    let (run_id, path) = fresh_run();
    write_raw(&path, "{\"a\":1}\n{\"a\":2}\n{\"a\":3");
    let tail = read_tail(&run_id).unwrap();
    assert_eq!(tail.lines, vec![r#"{"a":1}"#.to_string(), r#"{"a":2}"#.to_string()]);
    let _ = fs::remove_file(&path);
}

#[test]
fn a_complete_final_line_is_returned() {
    let (run_id, path) = fresh_run();
    write_raw(&path, "{\"a\":1}\n{\"a\":2}\n");
    let tail = read_tail(&run_id).unwrap();
    assert_eq!(tail.lines.last().unwrap(), r#"{"a":2}"#);
    let _ = fs::remove_file(&path);
}

#[test]
fn a_file_that_is_only_a_partial_line_yields_nothing() {
    let (run_id, path) = fresh_run();
    write_raw(&path, "{\"a\":1");
    let tail = read_tail(&run_id).unwrap();
    assert!(tail.lines.is_empty());
    let _ = fs::remove_file(&path);
}

#[test]
fn a_single_line_larger_than_the_window_yields_no_line_and_says_it_was_truncated() {
    let (run_id, path) = fresh_run();
    let huge = "x".repeat(LOG_TAIL_MAX_BYTES + 1);
    write_raw(&path, &format!("{huge}\n"));
    let tail = read_tail(&run_id).unwrap();
    assert!(tail.lines.is_empty(), "half a JSON object is worse than none");
    assert!(tail.truncated);
    let _ = fs::remove_file(&path);
}

#[test]
fn an_oversize_last_line_does_not_resurrect_the_lines_before_it_as_if_current() {
    // The newest line is the one the fleet wants; showing an older one in its place would present a
    // stale activity as current. Zero lines is the honest answer.
    let (run_id, path) = fresh_run();
    let huge = "x".repeat(LOG_TAIL_MAX_BYTES + 1);
    write_raw(&path, &format!("{{\"a\":1}}\n{huge}\n"));
    let tail = read_tail(&run_id).unwrap();
    assert!(tail.lines.is_empty());
    assert!(tail.truncated);
    let _ = fs::remove_file(&path);
}

#[test]
fn a_line_that_exactly_fills_the_window_is_returned() {
    let (run_id, path) = fresh_run();
    let line = "y".repeat(LOG_TAIL_MAX_BYTES - 1);
    write_raw(&path, &format!("{line}\n"));
    let tail = read_tail(&run_id).unwrap();
    assert_eq!(tail.lines, vec![line]);
    assert!(!tail.truncated);
    let _ = fs::remove_file(&path);
}

#[test]
fn a_run_id_that_is_not_a_ulid_is_refused() {
    assert!(read_tail("../../etc/passwd").is_err());
    assert!(read_tail("").is_err());
}

#[test]
fn the_read_does_not_scale_with_the_size_of_the_log() {
    // ~9 MB of log. A whole-file scan reads all of it; a tail read touches at most the window.
    let (run_id, path) = fresh_run();
    write_raw(&path, &numbered_lines(200_000));

    let started = Instant::now();
    for _ in 0..20 {
        let tail = read_tail(&run_id).unwrap();
        assert_eq!(tail.lines.len(), LOG_TAIL_MAX_LINES);
    }
    let per_call = started.elapsed() / 20;

    let _ = fs::remove_file(&path);
    assert!(
        per_call.as_millis() < 25,
        "read_tail took {per_call:?} per call on a ~9 MB log; it must be bounded by the window"
    );
}
