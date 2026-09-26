//! G-05-8(b)'s finding, stated before any production code in this plan changes: **the WRITE side
//! of the D-88 stage-marker contract is wrong. The READ side is correct and must not be touched.**
//!
//! `authoring_session.rs::start_authoring_run` inserts the `agent_runs` row with
//! `authoring_stage = 'challenge'` and never calls `runtime_protocol::write_authoring_stage`. The
//! only production caller of that function in the entire workspace is `transition_stage`, the
//! shared body behind `advance_stage` and `return_to_stage`. So `<runtimeDir>/stage/<runId>.json`
//! does not exist from session start until the FIRST stage transition — for the entire duration of
//! the challenge stage, the database row and the on-disk marker disagree about whether a marker
//! exists at all.
//!
//! `stage-gate-hook.ts` reads that exact file fresh per matched call and, when the read throws,
//! calls its own `failClosed` with the reason "no authoring stage marker could be read for this
//! run". That is the string a real, live authoring run — `01M3DNC0G9CYAWSD8DYEGTRP8C` — hit on
//! every `propose_epic` and `propose_assumption` call while it was legitimately still in the
//! challenge stage. `failClosed` failing closed is not a bug: it is the designed posture
//! (T-05-03-06's accepted denial-of-service — loud and recoverable, never a silent bypass), and
//! `read_authoring_stage`'s deliberate collapse of every failure mode to `None` is what keeps a
//! caller from ever treating one of them as safe. That side of the contract must not change.
//!
//! The gap report for `01M3DNC0G9CYAWSD8DYEGTRP8C` named `packages/sidecar/src/mcp-permission-server.ts`
//! as the artifact responsible for the refusal. That is wrong: the refusal is emitted by
//! `stage-gate-hook.ts`, a `PreToolUse` hook, not by the MCP tool handler. A gap report is a
//! hypothesis, and this one mis-named its own artifact.
//!
//! The live corroboration runs in both directions. The hook reported a marker READ failure, not an
//! unset `FLYWHEEL_RUNTIME_DIR` or `FLYWHEEL_RUN_ID` — it got past its own environment guards, so
//! the failure was specifically "the file at `<runtimeDir>/stage/<runId>.json` could not be read",
//! matching a marker that was never written rather than a misconfigured environment. And the live
//! transcript's turn 6 records the agent observing "Gate's open now" immediately after the driver
//! advanced the stage — the single moment `transition_stage` first wrote the marker for that run.
//! Both directions confirm the write path and the read path resolve the SAME directory:
//! `runtime_dir()` on the Rust side and the `FLYWHEEL_RUNTIME_DIR` that the harness derives from
//! that same function on the Node side.
//!
//! Why nine rounds of green tests did not catch it: `authoring_stage.rs::a_fresh_run_starts_at_challenge`
//! asserts `current_stage(...)` — the DATABASE ROW. `authoring-stage-gate.test.mjs` asserts the
//! hook's decision against a marker file its own `scratchRuntimeDirWithStage` helper HAND-WRITES.
//! One side tested the row, the other side tested the file, each one fabricating the other side's
//! state, and nothing anywhere asserted that the product makes them agree. This is the same shape
//! `scripts/uat/README.md` Item 8 already records: an offline arm only proves a property if it
//! exercises the same code path, with the same inputs, the live arm will hit.
//!
//! What the wrong message cost: during the challenge stage a propose call SHOULD be denied — that
//! is D-88 working. But it must be denied by `denyForChallengeStage`, whose reason tells the agent
//! to keep challenging and that only the developer can advance. Instead it was denied by
//! `failClosed`, whose reason reads as an infrastructure defect. The transcript shows the model
//! drawing exactly that conclusion — "it needs a session started in the authoring stage",
//! "re-running the same calls won't help" — and dumping a six-task epic with acceptance criteria
//! into prose. The gate's correctness was accidental; its message was the damage: the Core Value
//! ("every unit of agent work anchored to a structured board item... never a chat blob") failed in
//! production as exactly a chat blob.
//!
//! This file owns the write-side contract no test in this repository has ever owned. It changes NO
//! production code — that is Task 2's job — and is expected to fail RED at this point, in
//! particular `marker_is_readable_immediately_after_start_authoring_run`, the load-bearing
//! assertion.

mod common;

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use core::domain::authoring_session::start_authoring_run;
use core::runtime_protocol::read_authoring_stage;
use rusqlite::params;

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `FLYWHEEL_RUNTIME_DIR`
/// is process-global mutable state, and `cargo test` runs `#[test]` functions concurrently by
/// default. Copied verbatim from `authoring_stage.rs`'s own identically-named lock.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce(&Path) -> T) -> T {
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

/// CARGO_MANIFEST_DIR is packages/core — walk up two levels to the workspace root, exactly as
/// `authoring_stage.rs`'s and `session_close_lifecycle.rs`'s own `workspace_root()` helpers do.
fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

/// The real, shipped compiled hook — asserted present with a message naming the build command, a
/// HARD FAILURE rather than a silent skip. Mirrors `session_close_lifecycle.rs::sidecar_dist_entry`'s
/// own build-hint discipline: a silently-skipping test here would repeat the exact blind-spot
/// shape this plan exists to close.
fn stage_gate_hook_script() -> PathBuf {
    let path = workspace_root().join("packages/sidecar/dist/stage-gate-hook.js");
    assert!(
        path.is_file(),
        "expected the built stage-gate hook at {path:?} — run `npm --prefix packages/sidecar run build` first"
    );
    path
}

/// Spawn the SHIPPED compiled hook as a real process, feeding it a JSON `PreToolUse` payload on
/// stdin whose `tool_name` is `mcp__flywheel-permissions__propose_epic` (a proposal call, matching
/// `stage-gate-hook.ts`'s own `AUTHORING_STAGE_GATE_MATCHER`), with `FLYWHEEL_RUN_ID` and
/// `FLYWHEEL_RUNTIME_DIR` set from the caller's own environment — never from the payload
/// (T-05-03-02). Returns the exit status code and the parsed stdout decision.
fn run_shipped_stage_gate_hook(run_id: &str, runtime_dir: &Path) -> (Option<i32>, serde_json::Value) {
    let script = stage_gate_hook_script();
    let payload = serde_json::json!({
        "tool_name": "mcp__flywheel-permissions__propose_epic",
        "tool_input": {},
    });

    let mut child = Command::new("node")
        .arg(&script)
        .env("FLYWHEEL_RUN_ID", run_id)
        .env("FLYWHEEL_RUNTIME_DIR", runtime_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap_or_else(|e| panic!("failed to spawn shipped stage-gate-hook.js at {script:?}: {e}"));

    {
        let stdin = child
            .stdin
            .as_mut()
            .expect("child stdin should be piped");
        stdin
            .write_all(payload.to_string().as_bytes())
            .expect("failed to write hook payload to stdin");
    }

    let output = child
        .wait_with_output()
        .expect("failed to wait for shipped stage-gate-hook.js");
    let decision: serde_json::Value =
        serde_json::from_slice(&output.stdout).unwrap_or(serde_json::Value::Null);
    (output.status.code(), decision)
}

// --- The RED assertion: the marker must be readable immediately after start, before any transition. ---

#[test]
fn marker_is_readable_immediately_after_start_authoring_run() {
    with_scratch_runtime_dir(|dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect("start_authoring_run should succeed");

        assert_eq!(
            read_authoring_stage(&run.id),
            Some("challenge".to_string()),
            "a run just created by start_authoring_run must have a readable stage marker naming \
             `challenge`, before any stage transition — this is the write-side gap G-05-8(b) found"
        );

        let marker_path = dir.join("stage").join(format!("{}.json", run.id));
        assert!(
            marker_path.is_file(),
            "expected a stage marker file on disk at {marker_path:?} immediately after \
             start_authoring_run"
        );
    });
}

// --- The end-to-end slice: the SHIPPED hook, against a marker a real start_authoring_run wrote. ---

#[test]
fn a_challenge_stage_run_is_denied_by_the_shipped_hook_with_the_challenge_reason() {
    with_scratch_runtime_dir(|dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect("start_authoring_run should succeed");

        let (status, decision) = run_shipped_stage_gate_hook(&run.id, dir);

        assert_ne!(status, Some(0), "the shipped hook must deny a challenge-stage proposal call");
        assert_eq!(
            decision["hookSpecificOutput"]["permissionDecision"],
            "deny",
            "unexpected decision: {decision:?}"
        );
        let reason = decision["hookSpecificOutput"]["permissionDecisionReason"]
            .as_str()
            .unwrap_or("");
        assert!(
            reason.contains("challenge stage"),
            "a legitimately-challenging run must be denied by denyForChallengeStage, whose reason \
             names the stage — got {reason:?}"
        );
        assert!(
            !reason.contains("could be read for this run"),
            "a legitimately-challenging run must NEVER see failClosed's infrastructure-defect \
             reason — this is the exact wrong message that turned a six-task epic into prose in \
             run 01M3DNC0G9CYAWSD8DYEGTRP8C; got {reason:?}"
        );
    });
}

// --- The rollback contract: a marker-write failure at start must leave no row behind. ---

#[test]
fn a_marker_write_failure_at_start_leaves_no_agent_run_row() {
    with_scratch_runtime_dir(|dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();

        // Block the runtime dir from ever being (re-)created as a directory: replace it with a
        // plain file, so `runtime_dir()`'s own `create_dir_all` — and therefore the marker write —
        // fails. Mirrors `authoring_stage.rs::a_marker_write_failure_leaves_the_row_at_its_prior_value`.
        std::fs::remove_dir_all(dir).expect("failed to remove scratch runtime dir");
        std::fs::write(dir, b"not a directory").expect("failed to create the blocking file");

        let err = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect_err("a marker-write failure at start must surface as an Err, not a silent success");
        assert!(
            err.to_string().contains("runtime marker"),
            "unexpected error: {err}"
        );

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_runs", params![], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(
            count, 0,
            "a started run whose marker could not be written must leave no agent_runs row — the \
             transaction must roll back, never commit a row without its marker"
        );
    });
}
