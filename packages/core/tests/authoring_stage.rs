//! D-88/D-90 (plan 05-03): the stage machine as `authoring_session.rs` leaves it after this plan
//! finishes `advance_stage` (the guarded `UPDATE` and the runtime-marker write, T-05-03-05) and
//! adds `return_to_stage`. One test per `<behavior>` bullet in `05-03-PLAN.md` Task 2, plus a
//! source-scanning gate proving D-90's "no agent-reachable caller" claim is a property of the
//! CODE, not a promise in a comment: the sidecar is the only process that talks to the model, so
//! if no file under `packages/sidecar/src` names `advance_stage`, `return_to_stage` or
//! `authoring_stage_advance`, no tool handler anywhere in this workspace can reach either the
//! domain function or the Tauri command that wraps it. A future edit that adds an agent-reachable
//! call site to any of these three names would silently reopen D-88's whole reason for existing
//! — this test turns that into a build failure instead of a code-review miss.

mod common;

use std::path::{Path, PathBuf};

use core::domain::authoring_proposal::{
    create_proposal, pending_proposals_for_run, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{
    advance_stage, current_stage, return_to_stage, start_authoring_run, AuthoringStage,
};
use rusqlite::params;

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `FLYWHEEL_RUNTIME_DIR`
/// is process-global mutable state, and `cargo test` runs `#[test]` functions concurrently by
/// default. Mirrors `runtime_protocol.rs`'s/`authoring_tracer.rs`'s own identically-named lock:
/// `advance_stage`/`return_to_stage` both write the D-88 runtime marker as part of their own
/// transaction, so every test here needs an isolated scratch runtime dir.
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

// --- Behavior ---

#[test]
fn a_fresh_run_starts_at_challenge() {
    with_scratch_runtime_dir(|_dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect("start_authoring_run should succeed");
        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Challenge)
        );
    });
}

#[test]
fn advance_walks_challenge_to_decompose_to_criteria() {
    with_scratch_runtime_dir(|_dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run =
            start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();

        let (stage, distillation) = advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();
        assert_eq!(stage, AuthoringStage::Decompose);
        assert!(distillation.is_some(), "advancing out of challenge must return a distillation instruction");
        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Decompose)
        );

        let (stage, criteria_instruction) = advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();
        assert_eq!(stage, AuthoringStage::Criteria);
        assert!(
            criteria_instruction.is_some(),
            "advancing out of decompose into criteria must return the criteria instruction (plan 05-45, G-05-9)"
        );
        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Criteria)
        );
    });
}

#[test]
fn advancing_past_criteria_errors_never_a_silent_no_op() {
    with_scratch_runtime_dir(|_dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run =
            start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();
        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();

        let err = advance_stage(&mut conn, &run.id, &human_actor_id)
            .expect_err("advancing past criteria must be a typed error, never a silent no-op");
        assert!(err.to_string().contains("already at the last authoring stage"));
        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Criteria),
            "a rejected advance must leave the stage unchanged"
        );
    });
}

#[test]
fn return_to_challenge_from_criteria_leaves_existing_proposal_rows_byte_identical() {
    with_scratch_runtime_dir(|_dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run =
            start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap(); // challenge -> decompose

        let proposal = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Write docs".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();

        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap(); // decompose -> criteria

        let before = pending_proposals_for_run(&conn, &run.id, 10).unwrap();
        assert_eq!(before.len(), 1);
        let before_status = before[0].status.clone();
        let before_payload = serde_json::to_value(&before[0].payload).unwrap();

        let resolved = return_to_stage(&mut conn, &run.id, "challenge", &human_actor_id)
            .expect("return_to_stage should succeed from any stage");
        assert_eq!(resolved, AuthoringStage::Challenge);
        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Challenge)
        );

        let after = pending_proposals_for_run(&conn, &run.id, 10).unwrap();
        assert_eq!(after.len(), 1, "the return must not delete the staged proposal");
        assert_eq!(after[0].id, proposal.id);
        assert_eq!(
            after[0].status, before_status,
            "status must be byte-identical before and after a return"
        );
        assert_eq!(
            serde_json::to_value(&after[0].payload).unwrap(),
            before_payload,
            "payload must be byte-identical before and after a return"
        );
    });
}

#[test]
fn a_marker_write_failure_leaves_the_row_at_its_prior_value() {
    with_scratch_runtime_dir(|dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run =
            start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();

        // Block the runtime dir from ever being (re-)created as a directory: replace it with a
        // plain file, so `runtime_dir()`'s own `create_dir_all` — and therefore the marker write
        // — fails. Mirrors `runtime_protocol.rs`'s own
        // `touch_heartbeat_returns_write_failed_never_panics_when_the_directory_is_blocked`.
        std::fs::remove_dir_all(dir).expect("failed to remove scratch runtime dir");
        std::fs::write(dir, b"not a directory").expect("failed to create the blocking file");

        let err = advance_stage(&mut conn, &run.id, &human_actor_id)
            .expect_err("a marker-write failure must surface as an Err, not a silent success");
        assert!(err.to_string().contains("runtime marker"), "unexpected error: {err}");

        assert_eq!(
            current_stage(&conn, &run.id).unwrap(),
            Some(AuthoringStage::Challenge),
            "an unwritable runtime directory must leave agent_runs.authoring_stage at its prior value"
        );
    });
}

#[test]
fn each_transition_appends_exactly_one_event_naming_both_stages() {
    with_scratch_runtime_dir(|_dir| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run =
            start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();

        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();

        let payload: String = conn
            .query_row(
                "SELECT payload FROM events WHERE stream_id = ?1 AND event_type = 'authoring_run.stage_changed'",
                params![run.id],
                |row| row.get(0),
            )
            .expect("exactly one stage_changed event should exist");
        let parsed: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let label = parsed["label"].as_str().unwrap();
        assert!(
            label.contains("challenge") && label.contains("decompose"),
            "label {label:?} must name both stages"
        );

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'authoring_run.stage_changed'",
                params![run.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "the advance must append exactly one stage_changed event");

        return_to_stage(&mut conn, &run.id, "challenge", &human_actor_id).unwrap();

        let payload: String = conn
            .query_row(
                "SELECT payload FROM events WHERE stream_id = ?1 AND event_type = 'authoring_run.stage_returned'",
                params![run.id],
                |row| row.get(0),
            )
            .expect("exactly one stage_returned event should exist");
        let parsed: serde_json::Value = serde_json::from_str(&payload).unwrap();
        let label = parsed["label"].as_str().unwrap();
        assert!(
            label.contains("decompose") && label.contains("challenge"),
            "label {label:?} must name both stages"
        );

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'authoring_run.stage_returned'",
                params![run.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "the return must append exactly one stage_returned event");
    });
}

// --- Structural gate (D-90): no file under packages/sidecar/src names the human-only path. ---
//
// The sidecar is the ONLY process that talks to the model (AGNT-01/AGNT-02) — no tool handler, no
// MCP server, no adapter code lives anywhere else. If no source file under packages/sidecar/src
// can even NAME `advance_stage`, `return_to_stage` or `authoring_stage_advance`, then no code path
// reachable from a tool call can invoke either the domain function or the Tauri command wrapping
// it — D-90's gate is a property the compiler-adjacent grep below enforces, not a promise a doc
// comment makes. `authoring_stage_return` (the Tauri command) is deliberately NOT included in this
// list, matching 05-03-PLAN.md's own enumerated three names exactly.

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

const FORBIDDEN_NAMES: [&str; 3] = ["advance_stage", "return_to_stage", "authoring_stage_advance"];

fn rust_files_under(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs" || ext == "ts") {
                out.push(path);
            }
        }
    }
    out
}

#[test]
fn no_sidecar_source_names_the_human_only_advance_path() {
    let root = workspace_root();
    let sidecar_src = root.join("packages/sidecar/src");
    let mut offenders = Vec::new();
    for path in rust_files_under(&sidecar_src) {
        let Ok(contents) = std::fs::read_to_string(&path) else { continue };
        for (idx, raw_line) in contents.lines().enumerate() {
            if is_whole_line_comment(raw_line) {
                continue;
            }
            for name in FORBIDDEN_NAMES {
                if raw_line.contains(name) {
                    offenders.push(format!("{}:{}: {}", path.display(), idx + 1, raw_line.trim()));
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a file under packages/sidecar/src names the human-only advance path (D-90) — the agent \
         must never be able to reach it:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn the_gate_detects_the_shape_it_exists_to_catch() {
    let shipped = "  advance_stage(conn, runId, actorId);";
    let fine = "  authoring_stage_return(conn, runId, stage, actorId);";
    assert!(FORBIDDEN_NAMES.iter().any(|n| shipped.contains(n)));
    assert!(!FORBIDDEN_NAMES.iter().any(|n| fine.contains(n)));
}
