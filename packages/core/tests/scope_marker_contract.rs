//! The two-sided scope-marker contract (phase 09 plan 09-01, D-150/D-151, RESEARCH Pitfall 13).
//!
//! `scope-hook.ts` reads `<runtime>/scope/<runId>.json`; Rust writes it. For nine gap-closure rounds
//! on the authoring stage marker (`authoring_stage_marker_contract.rs`) the Node test hand-wrote the
//! file and the Rust test asserted a database row, each fabricating the other side's state while the
//! product never wrote the marker the hook needed. So here NEITHER half fabricates the other:
//!
//! - the marker is written by the real arming function (`arm_scope_marker`, the body behind the
//!   desktop crate's `arm_run_scope` that `start_agent_run_recording_first` calls), from a real
//!   declared file-set in a real database, against a real git repository;
//! - the verdict comes from the SHIPPED compiled hook (`packages/sidecar/dist/scope-hook.js`) shelling
//!   to the SHIPPED compiled shim (`target/{debug,release}/flywheel-shim`).
//!
//! `start_agent_run_recording_first` itself lives in the desktop crate and cannot be called from
//! `packages/core`; two things close that gap. A source-structural gate below asserts the function
//! calls `arm_run_scope` between the worktree-path read and its return, and the desktop crate's own
//! `agent_run.rs` test module drives the real function and then runs this same shipped hook against
//! the marker it wrote.

mod common;

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use core::domain::file_set::{arm_scope_marker, declare_file_set};
use core::domain::task::create_task;
use core::file_set::parse_entry;
use core::ids::new_id;
use core::runtime_protocol::{
    read_scope_marker, write_scope_marker, ScopeMode, ScopeMarker, SCOPE_MARKER_VERSION,
};
use rusqlite::Connection;

/// `FLYWHEEL_RUNTIME_DIR` is process-global mutable state and `cargo test` runs `#[test]` functions
/// concurrently; serialises every caller in this binary (copied in shape from
/// `authoring_stage_marker_contract.rs`).
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce(&Path) -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serialises every caller in this binary, and the var is cleared before
    // returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f(dir.path());
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

/// The real, shipped compiled hook — a HARD FAILURE naming the build command when absent, never a
/// silent skip (a silently-skipping contract test is the blind spot this file exists to close).
fn hook_script() -> PathBuf {
    let path = workspace_root().join("packages/sidecar/dist/scope-hook.js");
    assert!(
        path.is_file(),
        "expected the built scope hook at {path:?} — run `npm --prefix packages/sidecar run build` first"
    );
    path
}

fn shim_binary() -> PathBuf {
    core::shim::resolve_shim_binary()
        .expect("the compiled flywheel-shim is required — run `cargo build --workspace` first")
}

struct HookRun {
    code: Option<i32>,
    stdout: String,
}

impl HookRun {
    fn decision(&self) -> Option<String> {
        let v: serde_json::Value = serde_json::from_str(&self.stdout).ok()?;
        v["hookSpecificOutput"]["permissionDecision"].as_str().map(str::to_string)
    }
    fn reason(&self) -> String {
        let v: serde_json::Value = serde_json::from_str(&self.stdout).unwrap_or_default();
        v["hookSpecificOutput"]["permissionDecisionReason"].as_str().unwrap_or_default().to_string()
    }
    fn is_allowed(&self) -> bool {
        self.code == Some(0) && self.stdout.trim() == "{}"
    }
    fn is_denied(&self) -> bool {
        self.code == Some(2) && self.decision().as_deref() == Some("deny")
    }
}

/// Spawn the shipped hook as a real process. Identity comes from the environment arguments, never
/// from the payload.
fn run_hook(run_id: Option<&str>, runtime_dir: Option<&Path>, shim: Option<&Path>, stdin: &str) -> HookRun {
    let mut cmd = Command::new("node");
    cmd.arg(hook_script())
        .env_remove("FLYWHEEL_RUN_ID")
        .env_remove("FLYWHEEL_RUNTIME_DIR")
        .env_remove("FLYWHEEL_SHIM_BIN")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(id) = run_id {
        cmd.env("FLYWHEEL_RUN_ID", id);
    }
    if let Some(dir) = runtime_dir {
        cmd.env("FLYWHEEL_RUNTIME_DIR", dir);
    }
    if let Some(shim) = shim {
        cmd.env("FLYWHEEL_SHIM_BIN", shim);
    }
    let mut child = cmd.spawn().expect("failed to spawn node for the shipped scope hook");
    child.stdin.as_mut().unwrap().write_all(stdin.as_bytes()).unwrap();
    drop(child.stdin.take());
    let out = child.wait_with_output().expect("failed to wait for the hook");
    HookRun { code: out.status.code(), stdout: String::from_utf8_lossy(&out.stdout).into_owned() }
}

fn write_payload(target: &Path) -> String {
    serde_json::json!({
        "hook_event_name": "PreToolUse",
        "tool_name": "Write",
        "tool_input": { "file_path": target, "content": "x" },
        "cwd": "/somewhere/else",
        "permission_mode": "bypassPermissions",
    })
    .to_string()
}

/// A migrated database, a real git repository registered as a project, and one task. Returns the
/// connection, actor, task id, and the repository's `TempDir` (the "worktree" for these tests).
fn seeded_task() -> (Connection, String, String, tempfile::TempDir) {
    let (mut conn, actor, project, repo_dir) = common::seeded_git_project();
    let task = create_task(&mut conn, &project.id, &actor, "Scoped task", None).unwrap();
    (conn, actor, task.id, repo_dir)
}

fn declare(conn: &mut Connection, actor: &str, task_id: &str, raw: &[&str]) {
    let entries: Vec<_> = raw.iter().map(|r| parse_entry(r).unwrap()).collect();
    declare_file_set(conn, task_id, &entries, actor).unwrap();
}

// --- the contract ---------------------------------------------------------------------------

#[test]
fn an_armed_run_is_refused_outside_its_set_and_allowed_inside_it() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["packages/core/src/domain/", "packages/core/src/lib.rs"]);
        let run_id = new_id();
        let mode = arm_scope_marker(&conn, &run_id, &task_id, repo.path()).expect("arming should succeed");
        assert_eq!(mode, ScopeMode::Armed);
        let shim = shim_binary();
        let root = repo.path();

        let inside_file = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&root.join("packages/core/src/lib.rs")));
        assert!(inside_file.is_allowed(), "exact file entry must be allowed: {:?} {}", inside_file.code, inside_file.stdout);

        let inside_dir = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&root.join("packages/core/src/domain/task.rs")));
        assert!(inside_dir.is_allowed(), "a path under the dir entry must be allowed: {}", inside_dir.stdout);

        let outside = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&root.join("README.md")));
        assert!(outside.is_denied(), "a path outside the set must be refused: {:?} {}", outside.code, outside.stdout);
        let reason = outside.reason();
        assert!(reason.starts_with("FLYWHEEL-SCOPE:"), "{reason}");
        assert!(reason.contains("README.md"), "the refusal names the refused path: {reason}");
        assert!(reason.contains("packages/core/src/domain/"), "the refusal names the run's own entries: {reason}");
    });
}

#[test]
fn the_dir_boundary_holds_a_sibling_prefix_and_the_dir_itself_are_refused() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["packages/core/src/domain/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let shim = shim_binary();
        let root = repo.path();

        for refused in ["packages/core/src/domain_x.rs", "packages/core/src/domain"] {
            let run = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&root.join(refused)));
            assert!(run.is_denied(), "{refused} must be refused: {:?} {}", run.code, run.stdout);
        }
    });
}

#[test]
fn a_task_with_no_declared_entries_is_unarmed_and_every_write_in_its_worktree_is_allowed() {
    with_scratch_runtime_dir(|runtime| {
        let (conn, _actor, task_id, repo) = seeded_task();
        let run_id = new_id();
        let mode = arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        assert_eq!(mode, ScopeMode::Unarmed, "no declaration means the hook is disarmed (D-150)");

        let marker = read_scope_marker(&run_id).expect("an unarmed marker is still written — a fact, not an absence");
        assert_eq!(marker.mode, ScopeMode::Unarmed);
        assert!(marker.entries.is_empty());

        let shim = shim_binary();
        for target in ["anything/at/all.rs", "README.md"] {
            let run = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&repo.path().join(target)));
            assert!(run.is_allowed(), "{target}: {:?} {}", run.code, run.stdout);
        }
    });
}

#[test]
fn clearing_a_declared_set_makes_the_next_run_unarmed() {
    with_scratch_runtime_dir(|_runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let first = new_id();
        assert_eq!(arm_scope_marker(&conn, &first, &task_id, repo.path()).unwrap(), ScopeMode::Armed);

        declare(&mut conn, &actor, &task_id, &[]);
        let second = new_id();
        assert_eq!(arm_scope_marker(&conn, &second, &task_id, repo.path()).unwrap(), ScopeMode::Unarmed);
    });
}

#[test]
fn a_marker_rewritten_between_two_calls_takes_effect_on_the_second_with_no_restart() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let shim = shim_binary();
        let target = repo.path().join("b/new.rs");

        let before = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&target));
        assert!(before.is_denied(), "b/ is outside the first set: {}", before.stdout);

        // The live-widen path (D-152) is a re-arm over the same run id: the marker is rewritten.
        declare(&mut conn, &actor, &task_id, &["a/", "b/"]);
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();

        let after = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&target));
        assert!(after.is_allowed(), "the rewritten marker must be read fresh: {:?} {}", after.code, after.stdout);
    });
}

#[test]
fn a_symlink_inside_the_worktree_that_points_outside_it_reads_as_outside() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["escape/"]);
        let run_id = new_id();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), repo.path().join("escape")).unwrap();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();

        let run = run_hook(
            Some(&run_id),
            Some(runtime),
            Some(&shim_binary()),
            &write_payload(&repo.path().join("escape/stolen.txt")),
        );
        assert!(run.is_denied(), "the declared dir resolves outside the worktree: {:?} {}", run.code, run.stdout);
        assert!(run.reason().contains("worktree"), "{}", run.reason());
    });
}

#[test]
fn a_parent_segment_cannot_climb_out_of_the_declared_dir() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let sneaky = format!("{}/a/../README.md", repo.path().display());

        let run = run_hook(Some(&run_id), Some(runtime), Some(&shim_binary()), &write_payload(Path::new(&sneaky)));
        assert!(run.is_denied(), "a/../README.md is README.md: {:?} {}", run.code, run.stdout);
    });
}

#[test]
fn a_target_in_a_directory_that_does_not_exist_yet_is_judged_lexically() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["new/dir/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let shim = shim_binary();

        let inside = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(&repo.path().join("new/dir/deeper/f.rs")));
        assert!(inside.is_allowed(), "{:?} {}", inside.code, inside.stdout);
        let climbing = format!("{}/new/dir/../../README.md", repo.path().display());
        let outside = run_hook(Some(&run_id), Some(runtime), Some(&shim), &write_payload(Path::new(&climbing)));
        assert!(outside.is_denied(), "{:?} {}", outside.code, outside.stdout);
    });
}

#[test]
fn case_insensitive_repositories_compare_folded() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["src/Foo.ts"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let mut marker = read_scope_marker(&run_id).unwrap();
        // Prove the marker carries the flag and that the hook honours it: flip it on, rewrite.
        marker.case_insensitive = true;
        assert_eq!(write_scope_marker(&run_id, &marker), core::runtime_protocol::RuntimeIo::Written);

        let run = run_hook(Some(&run_id), Some(runtime), Some(&shim_binary()), &write_payload(&repo.path().join("src/foo.ts")));
        assert!(run.is_allowed(), "{:?} {}", run.code, run.stdout);

        marker.case_insensitive = false;
        write_scope_marker(&run_id, &marker);
        let run = run_hook(Some(&run_id), Some(runtime), Some(&shim_binary()), &write_payload(&repo.path().join("src/foo.ts")));
        assert!(run.is_denied(), "{:?} {}", run.code, run.stdout);
    });
}

// --- the marker file ------------------------------------------------------------------------

#[test]
fn the_marker_carries_the_canonical_worktree_root_the_version_and_the_entries() {
    with_scratch_runtime_dir(|_runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/", "b.rs"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();

        let marker = read_scope_marker(&run_id).unwrap();
        assert_eq!(marker.version, SCOPE_MARKER_VERSION);
        assert_eq!(marker.mode, ScopeMode::Armed);
        assert_eq!(
            Path::new(&marker.worktree_root),
            std::fs::canonicalize(repo.path()).unwrap(),
            "the worktree root is stored canonicalised"
        );
        let stored: Vec<_> = marker.entries.iter().map(|e| (e.form.as_str(), e.path.as_str())).collect();
        assert_eq!(stored, vec![("dir", "a/"), ("file", "b.rs")]);
    });
}

#[test]
fn write_scope_marker_refuses_a_run_id_that_is_not_a_ulid_before_building_any_path() {
    with_scratch_runtime_dir(|runtime| {
        let marker = ScopeMarker {
            version: SCOPE_MARKER_VERSION,
            mode: ScopeMode::Unarmed,
            worktree_root: "/x".into(),
            case_insensitive: false,
            entries: vec![],
            written_at: "now".into(),
        };
        for bad in ["../escape", "not-a-ulid", "", "a/b"] {
            assert!(
                matches!(write_scope_marker(bad, &marker), core::runtime_protocol::RuntimeIo::WriteFailed(_)),
                "{bad:?} must be refused"
            );
        }
        assert!(!runtime.join("scope").exists(), "no directory may be created for a refused id");
    });
}

#[test]
fn read_scope_marker_collapses_every_failure_to_none() {
    with_scratch_runtime_dir(|runtime| {
        let run_id = new_id();
        assert!(read_scope_marker(&run_id).is_none(), "absent");
        assert!(read_scope_marker("not-a-ulid").is_none(), "not a ulid");

        let dir = runtime.join("scope");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{run_id}.json"));

        std::fs::write(&path, "this is not json").unwrap();
        assert!(read_scope_marker(&run_id).is_none(), "non-JSON");

        std::fs::write(
            &path,
            r#"{"version":2,"mode":"unarmed","worktree_root":"/x","case_insensitive":false,"entries":[],"written_at":"t"}"#,
        )
        .unwrap();
        assert!(read_scope_marker(&run_id).is_none(), "unrecognised version");

        std::fs::write(
            &path,
            r#"{"version":1,"mode":"mostly","worktree_root":"/x","case_insensitive":false,"entries":[],"written_at":"t"}"#,
        )
        .unwrap();
        assert!(read_scope_marker(&run_id).is_none(), "unrecognised mode");

        std::fs::write(
            &path,
            r#"{"version":1,"mode":"unarmed","worktree_root":"/x","case_insensitive":false,"entries":[],"written_at":"t"}"#,
        )
        .unwrap();
        assert!(read_scope_marker(&run_id).is_some(), "the control: a well-formed marker reads");
    });
}

#[test]
fn clear_run_runtime_files_removes_the_scope_marker() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let path = runtime.join("scope").join(format!("{run_id}.json"));
        assert!(path.is_file());

        core::runtime_protocol::clear_run_runtime_files(&run_id);
        assert!(!path.exists());
    });
}

#[test]
fn an_arming_failure_is_an_error_not_a_silent_unarmed_run() {
    with_scratch_runtime_dir(|_runtime| {
        let (conn, _actor, task_id, _repo) = seeded_task();
        let run_id = new_id();
        let missing = Path::new("/definitely/not/a/worktree");
        let err = arm_scope_marker(&conn, &run_id, &task_id, missing).expect_err("cannot canonicalise a missing worktree");
        assert!(err.contains("canonicalise"), "{err}");
        assert!(read_scope_marker(&run_id).is_none(), "no marker may be left behind");

        let bad_run_id = "not-a-ulid";
        let (conn, _a, task_id, repo) = seeded_task();
        assert!(arm_scope_marker(&conn, bad_run_id, &task_id, repo.path()).is_err());
    });
}

// --- the hook fails closed ------------------------------------------------------------------

#[test]
fn the_hook_denies_when_any_precondition_is_missing_or_wrong() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let shim = shim_binary();
        let good_payload = write_payload(&repo.path().join("a/x.rs"));

        // The control: with everything in place the same call is allowed.
        assert!(run_hook(Some(&run_id), Some(runtime), Some(&shim), &good_payload).is_allowed());

        let cases: Vec<(&str, HookRun)> = vec![
            ("no run identity", run_hook(None, Some(runtime), Some(&shim), &good_payload)),
            ("no runtime dir", run_hook(Some(&run_id), None, Some(&shim), &good_payload)),
            ("no shim binary variable", run_hook(Some(&run_id), Some(runtime), None, &good_payload)),
            (
                "shim binary missing on disk",
                run_hook(Some(&run_id), Some(runtime), Some(Path::new("/no/such/flywheel-shim")), &good_payload),
            ),
            ("marker absent for this run", run_hook(Some(&new_id()), Some(runtime), Some(&shim), &good_payload)),
            ("stdin is not JSON", run_hook(Some(&run_id), Some(runtime), Some(&shim), "{not json")),
            ("stdin is empty", run_hook(Some(&run_id), Some(runtime), Some(&shim), "")),
            (
                "no target path in the tool input",
                run_hook(Some(&run_id), Some(runtime), Some(&shim), r#"{"tool_name":"Write","tool_input":{"content":"x"}}"#),
            ),
            (
                "target path is not a string",
                run_hook(Some(&run_id), Some(runtime), Some(&shim), r#"{"tool_name":"Write","tool_input":{"file_path":42}}"#),
            ),
            (
                "target path is empty",
                run_hook(Some(&run_id), Some(runtime), Some(&shim), r#"{"tool_name":"Write","tool_input":{"file_path":""}}"#),
            ),
            (
                "tool_input missing entirely",
                run_hook(Some(&run_id), Some(runtime), Some(&shim), r#"{"tool_name":"Write"}"#),
            ),
            (
                "relative target path",
                run_hook(Some(&run_id), Some(runtime), Some(&shim), r#"{"tool_name":"Write","tool_input":{"file_path":"a/x.rs"}}"#),
            ),
            (
                "a run id that would climb out of the scope directory",
                run_hook(Some("../stage/x"), Some(runtime), Some(&shim), &good_payload),
            ),
        ];
        for (name, run) in cases {
            assert!(run.is_denied(), "{name}: expected a deny with exit 2, got code {:?} stdout {:?}", run.code, run.stdout);
            assert!(run.reason().starts_with("FLYWHEEL-SCOPE:"), "{name}: {}", run.reason());
        }
    });
}

#[test]
fn a_marker_that_is_garbled_after_arming_denies() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let path = runtime.join("scope").join(format!("{run_id}.json"));
        let shim = shim_binary();
        let payload = write_payload(&repo.path().join("a/x.rs"));

        for garbage in ["", "null", "{}", "[1,2", "{\"version\":1}"] {
            std::fs::write(&path, garbage).unwrap();
            let run = run_hook(Some(&run_id), Some(runtime), Some(&shim), &payload);
            assert!(run.is_denied(), "marker {garbage:?}: {:?} {}", run.code, run.stdout);
        }
    });
}

#[test]
fn a_payload_that_names_another_run_cannot_redirect_the_hook() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["a/"]);
        let strict = new_id();
        arm_scope_marker(&conn, &strict, &task_id, repo.path()).unwrap();
        // A second, unarmed run in the same runtime dir — the hook must never be steerable to it.
        let (conn2, _a2, task2, repo2) = seeded_task();
        let permissive = new_id();
        arm_scope_marker(&conn2, &permissive, &task2, repo2.path()).unwrap();

        let spoof = serde_json::json!({
            "tool_name": "Write",
            "run_id": permissive, "runId": permissive, "FLYWHEEL_RUN_ID": permissive,
            "tool_input": { "file_path": repo.path().join("README.md"), "run_id": permissive },
        })
        .to_string();
        let run = run_hook(Some(&strict), Some(runtime), Some(&shim_binary()), &spoof);
        assert!(run.is_denied(), "identity comes from the environment only: {:?} {}", run.code, run.stdout);
    });
}

#[test]
fn a_notebook_tool_is_checked_against_its_notebook_path() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["nb/"]);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();
        let shim = shim_binary();
        let payload = |path: &Path| {
            serde_json::json!({ "tool_name": "NotebookEdit", "tool_input": { "notebook_path": path, "new_source": "x" } }).to_string()
        };

        assert!(run_hook(Some(&run_id), Some(runtime), Some(&shim), &payload(&repo.path().join("nb/a.ipynb"))).is_allowed());
        assert!(run_hook(Some(&run_id), Some(runtime), Some(&shim), &payload(&repo.path().join("other.ipynb"))).is_denied());
        // A notebook call carrying only a file_path has no notebook path: deny.
        let wrong_key = serde_json::json!({ "tool_name": "NotebookEdit", "tool_input": { "file_path": repo.path().join("nb/a.ipynb") } }).to_string();
        assert!(run_hook(Some(&run_id), Some(runtime), Some(&shim), &wrong_key).is_denied());
    });
}

#[test]
fn a_long_declared_set_is_truncated_in_the_refusal_with_a_count_of_the_rest() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        let raw: Vec<String> = (0..25).map(|i| format!("dir{i:02}/")).collect();
        let refs: Vec<&str> = raw.iter().map(String::as_str).collect();
        declare(&mut conn, &actor, &task_id, &refs);
        let run_id = new_id();
        arm_scope_marker(&conn, &run_id, &task_id, repo.path()).unwrap();

        let run = run_hook(Some(&run_id), Some(runtime), Some(&shim_binary()), &write_payload(&repo.path().join("README.md")));
        assert!(run.is_denied());
        let reason = run.reason();
        assert!(reason.contains("dir19/") && !reason.contains("dir20/"), "first 20 only: {reason}");
        assert!(reason.contains("and 5 more"), "{reason}");
    });
}

#[test]
fn the_refusal_discloses_nothing_from_another_run() {
    with_scratch_runtime_dir(|runtime| {
        let (mut conn, actor, task_id, repo) = seeded_task();
        declare(&mut conn, &actor, &task_id, &["mine/"]);
        let mine = new_id();
        arm_scope_marker(&conn, &mine, &task_id, repo.path()).unwrap();

        let (mut conn2, actor2, task2, repo2) = seeded_task();
        declare(&mut conn2, &actor2, &task2, &["their-secret-dir/"]);
        arm_scope_marker(&conn2, &new_id(), &task2, repo2.path()).unwrap();

        let run = run_hook(Some(&mine), Some(runtime), Some(&shim_binary()), &write_payload(&repo.path().join("README.md")));
        let reason = run.reason();
        assert!(reason.contains("mine/"));
        assert!(!reason.contains("their-secret-dir"), "{reason}");
        assert!(!reason.contains("Scoped task"), "no task title: {reason}");
        assert!(!reason.contains(repo2.path().to_str().unwrap()), "no other worktree path: {reason}");
    });
}

// --- the source gates -----------------------------------------------------------------------

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn function_region<'a>(lines: &'a [&'a str], signature_substr: &str) -> &'a [&'a str] {
    let start = lines
        .iter()
        .position(|l| l.contains(signature_substr))
        .unwrap_or_else(|| panic!("expected to find `{signature_substr}`"));
    let end = lines[start..]
        .iter()
        .position(|l| l.trim_end() == "}")
        .map(|o| start + o + 1)
        .unwrap_or(lines.len());
    &lines[start..end]
}

/// The run-start path must arm the scope: `arm_run_scope` is called inside
/// `start_agent_run_recording_first`, after the worktree path is read and before the outcome is
/// returned, and its error is propagated (`?`) so a marker-write failure aborts the start.
#[test]
fn start_agent_run_recording_first_arms_the_scope_after_the_worktree_read_and_aborts_on_failure() {
    let path = workspace_root().join("packages/desktop/src-tauri/src/commands/agent_run.rs");
    let source = std::fs::read_to_string(&path).expect("agent_run.rs should be readable");
    let lines: Vec<&str> = source.lines().collect();
    let region = function_region(&lines, "pub(crate) fn start_agent_run_recording_first(");
    let code: Vec<(usize, &&str)> = region.iter().enumerate().filter(|(_, l)| !is_whole_line_comment(l)).collect();

    let worktree_read = code
        .iter()
        .find(|(_, l)| l.contains("SELECT path FROM worktrees WHERE id"))
        .map(|(i, _)| *i)
        .expect("the worktree path read must stay in start_agent_run_recording_first");
    let arm = code
        .iter()
        .find(|(_, l)| l.contains("arm_run_scope("))
        .map(|(i, l)| (*i, **l))
        .expect("start_agent_run_recording_first must call arm_run_scope");
    let ok_return = code
        .iter()
        .find(|(_, l)| l.contains("Ok(StartRunOutcome"))
        .map(|(i, _)| *i)
        .expect("start_agent_run_recording_first must return Ok(StartRunOutcome");

    assert!(worktree_read < arm.0, "arm_run_scope must come after the worktree path read");
    assert!(arm.0 < ok_return, "arm_run_scope must come before the outcome is returned");
    // The arming error must reach the caller: either `?` on the call itself, or an `Err` arm that
    // returns it (the run row is closed `failed` first, so a failed arm does not leak a `running`
    // run).
    //
    // Plan 11-09 (D-REV-46) closes the run through `fail_launch` in a `.map_err(..)?;` continuation
    // on the lines after the call, so the `?;` may sit a few lines below the `arm_run_scope(` line.
    let propagated = arm.1.trim_end().ends_with("?;")
        || code.iter().filter(|(i, _)| *i > arm.0 && *i <= arm.0 + 3).any(|(_, l)| l.trim_end().ends_with("?;"))
        || code.iter().filter(|(i, _)| *i > arm.0 && *i < arm.0 + 14).any(|(_, l)| l.contains("return Err("));
    assert!(propagated, "the arming error must be propagated: {}", arm.1);
}

/// Every execution run goes through `start_agent_run_recording_first`; `agent_run_start` must not
/// grow a second launch path that skips arming. (The dispatcher in plan 09-07 extracts the launch
/// body and keeps this single arming site.)
#[test]
fn arm_run_scope_is_called_from_exactly_one_site() {
    let path = workspace_root().join("packages/desktop/src-tauri/src/commands/agent_run.rs");
    let source = std::fs::read_to_string(&path).unwrap();
    let calls = source
        .lines()
        .filter(|l| !is_whole_line_comment(l))
        .filter(|l| l.contains("arm_run_scope(") && !l.contains("fn arm_run_scope("))
        .count();
    assert_eq!(calls, 1, "exactly one non-comment call site of arm_run_scope");
}

/// Phase 09 review CR-01: the sidecar installs the scope gate and cannot know whether the run it was
/// asked to start is armed. The launch must TELL it, from the very mode `arm_run_scope` wrote, so the
/// sidecar can refuse an armed run whose gate it cannot install instead of starting it unenforced.
#[test]
fn the_spawn_request_carries_the_armed_fact_from_the_marker_the_run_start_wrote() {
    let path = workspace_root().join("packages/desktop/src-tauri/src/commands/agent_run.rs");
    let source = std::fs::read_to_string(&path).unwrap();
    let lines: Vec<&str> = source.lines().collect();

    let start = function_region(&lines, "pub(crate) fn start_agent_run_recording_first(");
    assert!(
        start.iter().filter(|l| !is_whole_line_comment(l)).any(|l| l.contains("scope_armed")),
        "start_agent_run_recording_first must hand the armed fact to its outcome"
    );

    // Plan 11-09 moved the spawn request out of `launch_run_for_task` into `spawn_prepared_run`,
    // which `launch_run_for_task` hands the run-start outcome to. Both halves are pinned.
    let spawn = function_region(&lines, "pub(crate) fn spawn_prepared_run(");
    let request: Vec<&&str> = spawn.iter().filter(|l| !is_whole_line_comment(l)).collect();
    assert!(
        request.iter().any(|l| l.contains("\"scopeArmed\"") && l.contains("outcome.scope_armed")),
        "the spawn request must carry scopeArmed taken from the run-start outcome, never recomputed"
    );
    let launch = function_region(&lines, "pub(crate) fn launch_run_for_task(");
    assert!(
        launch.iter().filter(|l| !is_whole_line_comment(l)).any(|l| l.contains("spawn_prepared_run(")),
        "launch_run_for_task must send its spawn through spawn_prepared_run, the one place scopeArmed is set"
    );
    assert!(
        launch.iter().filter(|l| !is_whole_line_comment(l)).any(|l| l.contains("&outcome")),
        "launch_run_for_task must hand spawn_prepared_run the run-start outcome"
    );
}
