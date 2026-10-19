//! Task 1's own behavior cases (02-07-PLAN.md): `read_window`/`count_lines` over
//! `session_log.rs`'s durable JSONL — the mechanical form of PROC-07 ("flat memory by
//! construction, not by ceiling," D-33). The load-bearing case is `ten_thousand_line_log...`
//! below: a window of 50 requested against a 10,000-line file must return exactly 50 entries and
//! report the true total, proving the read never materialises the whole file.
//!
//! Follows `agent_tracer.rs`'s own precedent of writing through `session_log_path` against the
//! real OS app-data directory (no test-seam exists for this path yet) — each test uses a fresh
//! ULID-shaped run id so tests never collide, and removes its own file when it finishes.

use core::ids::new_id;
use core::session_log::{count_lines, read_window, session_log_path, sessions_dir, LOG_WINDOW_MAX_LIMIT};
use std::fs::{self, OpenOptions};
use std::io::Write;

/// A fresh run id this test owns exclusively, plus the resolved path to its (not-yet-existing)
/// log file — the parent `sessions/` directory is created on first write.
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
    file.write_all(content.as_bytes())
        .expect("failed to write scratch log content");
}

fn cleanup(path: &std::path::Path) {
    let _ = fs::remove_file(path);
}

#[test]
fn ten_thousand_line_log_returns_exactly_the_requested_window_and_the_true_total() {
    let (run_id, path) = fresh_run();
    let mut content = String::new();
    for i in 0..10_000 {
        content.push_str(&format!("{{\"type\":\"assistant_text\",\"text\":\"line {i}\"}}\n"));
    }
    write_raw(&path, &content);

    let window = read_window(&run_id, 0, 50).expect("read_window should succeed");
    assert_eq!(window.entries.len(), 50, "a window of 50 must return exactly 50 entries");
    assert_eq!(window.total, 10_000, "the window must report the true total line count");
    assert_eq!(window.offset, 0);
    assert_eq!(window.limit, 50);

    let total_lines = count_lines(&run_id).expect("count_lines should succeed");
    assert_eq!(total_lines, 10_000);

    cleanup(&path);
}

#[test]
fn a_requested_limit_of_1000_is_clamped_to_the_max_and_the_window_reports_the_clamp() {
    let (run_id, path) = fresh_run();
    let mut content = String::new();
    for i in 0..250 {
        content.push_str(&format!("{{\"type\":\"assistant_text\",\"text\":\"line {i}\"}}\n"));
    }
    write_raw(&path, &content);

    let window = read_window(&run_id, 0, 1000).expect("read_window should succeed");
    assert!(
        window.entries.len() <= LOG_WINDOW_MAX_LIMIT,
        "requesting 1000 must never return more than LOG_WINDOW_MAX_LIMIT entries"
    );
    assert_eq!(window.entries.len(), LOG_WINDOW_MAX_LIMIT);
    assert_eq!(window.limit, LOG_WINDOW_MAX_LIMIT, "the window must report the effective (clamped) limit");
    assert_eq!(window.total, 250);

    cleanup(&path);
}

#[test]
fn a_malformed_line_becomes_an_unknown_entry_carrying_its_verbatim_text_and_line_number() {
    let (run_id, path) = fresh_run();
    let content = "{\"type\":\"assistant_text\",\"text\":\"ok\"}\nnot valid json at all\n{\"type\":\"assistant_text\",\"text\":\"after\"}\n";
    write_raw(&path, content);

    let window = read_window(&run_id, 0, 10).expect("read_window should succeed");
    assert_eq!(window.entries.len(), 3);
    assert_eq!(window.total, 3);

    let unknown = &window.entries[1];
    assert_eq!(unknown["type"], "unknown");
    assert_eq!(unknown["raw"], "not valid json at all");
    assert_eq!(unknown["line"], 1);

    cleanup(&path);
}

#[test]
fn a_trailing_fragment_with_no_newline_is_excluded_but_complete_lines_before_it_are_returned() {
    let (run_id, path) = fresh_run();
    // Two complete lines, then a partial fragment with NO trailing newline — simulates an
    // in-flight write caught mid-line.
    let content = "{\"type\":\"assistant_text\",\"text\":\"one\"}\n{\"type\":\"assistant_text\",\"text\":\"two\"}\n{\"type\":\"assistant_text\",\"text\":\"thr";
    write_raw(&path, content);

    let total = count_lines(&run_id).expect("count_lines should succeed");
    assert_eq!(total, 2, "the trailing fragment must not count toward the total");

    let window = read_window(&run_id, 0, 10).expect("read_window should succeed");
    assert_eq!(window.entries.len(), 2, "the two complete lines before the fragment must still be returned");
    assert_eq!(window.total, 2);

    cleanup(&path);
}

#[test]
fn reading_a_run_with_no_log_file_returns_an_empty_window_with_total_zero_and_no_error() {
    let (run_id, _path) = fresh_run();
    // Deliberately never write anything for this run id.

    let window = read_window(&run_id, 0, 50).expect("read_window on a missing file must not error");
    assert!(window.entries.is_empty());
    assert_eq!(window.total, 0);

    let total = count_lines(&run_id).expect("count_lines on a missing file must not error");
    assert_eq!(total, 0);
}

#[test]
fn an_offset_beyond_the_end_of_the_file_returns_an_empty_window_with_the_true_total() {
    let (run_id, path) = fresh_run();
    let mut content = String::new();
    for i in 0..10 {
        content.push_str(&format!("{{\"type\":\"assistant_text\",\"text\":\"line {i}\"}}\n"));
    }
    write_raw(&path, &content);

    let window = read_window(&run_id, 1000, 50).expect("read_window should succeed");
    assert!(window.entries.is_empty());
    assert_eq!(window.total, 10, "an out-of-range offset must still report the true total, not an error");

    cleanup(&path);
}

/// The guard `session_log_path` itself carries (plan 03-15, T-03-15-01): an implausible
/// `session_id` must never become a path, before `sessions_dir()` is ever resolved. Each
/// candidate below is a shape the old unvalidated `join(format!(...))` would have accepted.
#[test]
fn session_log_path_rejects_every_implausible_shape_and_accepts_a_real_ulid() {
    assert!(session_log_path("../../../etc/passwd").is_err(), "traversal-shaped id must be rejected");
    assert!(session_log_path("").is_err(), "an empty id must be rejected");
    assert!(session_log_path(&"a".repeat(25)).is_err(), "a 25-character id must be rejected");
    let separator_id = format!("{}/", "a".repeat(25));
    assert!(session_log_path(&separator_id).is_err(), "a 26-character id containing a path separator must be rejected");

    let real_id = new_id();
    let path = session_log_path(&real_id).expect("a real ULID must resolve to a path");
    let expected_dir = sessions_dir().expect("sessions_dir should resolve");
    assert!(path.starts_with(&expected_dir), "the resolved path must live under sessions_dir()");
}

/// `count_lines` and `read_window` must not degrade a rejected id to the "missing file returns
/// zero" path (plan 03-15) — a rejected id is a caller error, not an empty log.
#[test]
fn count_lines_and_read_window_return_err_for_every_rejected_id() {
    let rejected_ids = ["../../../etc/passwd", "", &"a".repeat(25)];
    for id in rejected_ids {
        assert!(count_lines(id).is_err(), "count_lines must error for rejected id {id:?}");
        assert!(read_window(id, 0, 10).is_err(), "read_window must error for rejected id {id:?}");
    }
}

#[test]
fn reading_a_window_while_the_writer_is_appending_returns_a_consistent_prefix() {
    let (run_id, path) = fresh_run();
    // A complete line followed immediately by a partial one, as if the writer's next
    // `writeln!` had not yet completed — `read_window` must return only the complete prefix,
    // never a parse attempt against the half-written tail.
    let content = "{\"type\":\"assistant_text\",\"text\":\"complete\"}\n{\"type\":\"assistant_text\",\"tex";
    write_raw(&path, content);

    let window = read_window(&run_id, 0, 10).expect("read_window should succeed");
    assert_eq!(window.entries.len(), 1);
    assert_eq!(window.entries[0]["text"], "complete");
    assert_eq!(window.total, 1);

    cleanup(&path);
}
