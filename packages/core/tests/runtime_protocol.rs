//! D-47/D-48/D-50 round-trip proof for the on-disk runtime protocol (plan 03-02 Task 1): every
//! public function in `core::runtime_protocol` returns a value on every failure mode (CR-03), and
//! the heartbeat/kill-record/run-descriptor files round-trip exactly as `packages/sidecar/src/
//! watchdog.ts` (Task 2) needs them to.

use std::fs;
use std::time::Duration;

use core::runtime_protocol::{
    list_run_descriptors, read_heartbeat_age, read_kill_record, runtime_dir, touch_heartbeat,
    write_kill_record, write_run_descriptor, KillRecordRead, RuntimeIo,
};

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `FLYWHEEL_RUNTIME_DIR`
/// is process-global mutable state, and `cargo test` runs this binary's `#[test]` functions
/// concurrently on a thread pool by default. Mirrors `stop_lifecycle.rs`'s own
/// `WORKTREE_ROOT_ENV_LOCK`/`with_scratch_worktree_root` pair for `FLYWHEEL_WORKTREE_ROOT` — same
/// idiom, this binary's own static, since a Rust `static` cannot be shared across separate test
/// binaries.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce(&std::path::Path) -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f(dir.path());
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

#[test]
fn runtime_dir_resolves_to_the_override_and_creates_it() {
    with_scratch_runtime_dir(|expected| {
        let resolved = runtime_dir().expect("runtime_dir should succeed");
        assert_eq!(resolved, expected);
        assert!(
            resolved.is_dir(),
            "runtime_dir must create the directory if it does not already exist"
        );
    });
}

#[test]
fn touch_heartbeat_writes_a_parseable_rfc3339_timestamp() {
    with_scratch_runtime_dir(|dir| {
        let outcome = touch_heartbeat();
        assert_eq!(outcome, RuntimeIo::Written);
        let contents =
            fs::read_to_string(dir.join("heartbeat")).expect("heartbeat file should exist");
        chrono::DateTime::parse_from_rfc3339(contents.trim())
            .expect("heartbeat contents should parse as RFC3339");
    });
}

#[test]
fn touch_heartbeat_returns_write_failed_never_panics_when_the_directory_is_blocked() {
    with_scratch_runtime_dir(|dir| {
        // Replace the runtime directory's own path with a plain FILE so `create_dir_all` cannot
        // succeed — forces the WriteFailed branch without depending on filesystem permission
        // behaviour, which varies across the user running CI vs. a dev machine.
        fs::remove_dir_all(dir).expect("failed to remove scratch dir");
        fs::write(dir, b"not a directory").expect("failed to create the blocking file");
        let outcome = touch_heartbeat();
        assert!(
            matches!(outcome, RuntimeIo::WriteFailed(_)),
            "expected WriteFailed, got {outcome:?}"
        );
    });
}

#[test]
fn read_heartbeat_age_is_some_and_small_shortly_after_a_touch() {
    with_scratch_runtime_dir(|_dir| {
        assert_eq!(touch_heartbeat(), RuntimeIo::Written);
        let age = read_heartbeat_age().expect("age should be Some right after a touch");
        assert!(
            age < Duration::from_secs(5),
            "a freshly touched heartbeat should read as very recent, got {age:?}"
        );
    });
}

#[test]
fn read_heartbeat_age_is_none_when_the_file_is_absent() {
    with_scratch_runtime_dir(|_dir| {
        assert_eq!(read_heartbeat_age(), None);
    });
}

#[test]
fn read_heartbeat_age_is_none_when_the_file_is_unparseable() {
    with_scratch_runtime_dir(|dir| {
        fs::write(dir.join("heartbeat"), b"not-a-timestamp").expect("failed to write heartbeat");
        assert_eq!(read_heartbeat_age(), None);
    });
}

#[test]
fn read_heartbeat_age_is_none_when_the_file_is_empty() {
    with_scratch_runtime_dir(|dir| {
        fs::write(dir.join("heartbeat"), b"").expect("failed to write empty heartbeat");
        assert_eq!(read_heartbeat_age(), None);
    });
}

#[test]
fn kill_record_round_trips_with_the_fields_a_watchdog_writes() {
    with_scratch_runtime_dir(|_dir| {
        let outcome = write_kill_record("run-abc123", 4242, 1_700_000_000, "heartbeat-stale");
        assert_eq!(outcome, RuntimeIo::Written);
        match read_kill_record("run-abc123") {
            KillRecordRead::Found(record) => {
                assert_eq!(record.run_id, "run-abc123");
                assert_eq!(record.pid, 4242);
                assert_eq!(record.start_time, 1_700_000_000);
                assert_eq!(record.reason, "heartbeat-stale");
                assert!(!record.killed_at.is_empty());
            }
            other => panic!("expected Found, got {other:?}"),
        }
    });
}

#[test]
fn read_kill_record_is_absent_when_no_file_exists() {
    with_scratch_runtime_dir(|_dir| {
        assert_eq!(read_kill_record("run-does-not-exist"), KillRecordRead::Absent);
    });
}

#[test]
fn read_kill_record_is_malformed_when_the_file_does_not_parse() {
    with_scratch_runtime_dir(|dir| {
        let kills_dir = dir.join("kills");
        fs::create_dir_all(&kills_dir).expect("failed to create kills dir");
        fs::write(kills_dir.join("run-bad.json"), b"{ not json")
            .expect("failed to write bad kill record");
        assert!(matches!(
            read_kill_record("run-bad"),
            KillRecordRead::Malformed(_)
        ));
    });
}

#[test]
fn run_descriptor_round_trips_and_lists_every_descriptor_on_disk() {
    with_scratch_runtime_dir(|_dir| {
        assert_eq!(write_run_descriptor("run-one", 100, 111), RuntimeIo::Written);
        assert_eq!(write_run_descriptor("run-two", 200, 222), RuntimeIo::Written);
        let mut descriptors = list_run_descriptors();
        descriptors.sort_by(|a, b| a.run_id.cmp(&b.run_id));
        assert_eq!(descriptors.len(), 2);
        assert_eq!(descriptors[0].run_id, "run-one");
        assert_eq!(descriptors[0].pid, 100);
        assert_eq!(descriptors[0].start_time, 111);
        assert_eq!(descriptors[1].run_id, "run-two");
        assert_eq!(descriptors[1].pid, 200);
        assert_eq!(descriptors[1].start_time, 222);
    });
}

#[test]
fn no_panicking_calls_survive_in_the_runtime_protocol_module() {
    let source = fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/runtime_protocol.rs"
    ))
    .expect("failed to read runtime_protocol.rs source");
    for line in source.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            continue;
        }
        assert!(!line.contains("unwrap()"), "found unwrap() in: {line}");
        assert!(!line.contains("expect("), "found expect( in: {line}");
        assert!(!line.contains("panic!"), "found panic! in: {line}");
        assert!(
            !line.contains("rusqlite") && !line.contains("Connection"),
            "found a database reference in: {line}"
        );
    }
}
