//! A separate binary the `scripts/uat/` harness shells out to for one thing: the environment a
//! real session is spawned with — built by the SAME production functions
//! `packages/desktop/src-tauri/src/sidecar.rs` uses, never by a copy of them.
//!
//! This exists so the harness cannot drift. `resolved_env_for_run`/`merge_shim_env_for_run` live
//! in the desktop (Tauri) crate and cannot be linked from a plain script, but everything they
//! assemble that a harness needs comes from this crate: `shim::shim_env_for_run` (the per-run
//! PATH shim directory plus `FLYWHEEL_REAL_GIT`/`FLYWHEEL_REAL_RM`),
//! `runtime_protocol::runtime_dir` (the heartbeat/kill-record directory the watchdog polls), and
//! the two `HEARTBEAT_*` constants both sides of the runtime protocol agree on. Calling them here
//! means a change to any of them changes what the harness spawns, automatically.
//!
//! Deliberately NOT included: the resolved credential block. `resolved_env_for_run` reads it from
//! the project's own database row, and a harness has no project row — but it also does not need
//! one. With no `ANTHROPIC_API_KEY` in the environment the backend prefers the developer's local
//! Claude Code credentials, which is exactly the execution model the phase-03 UAT items describe
//! ("agents run on the developer's machine using their existing local agent credentials").
//!
//! Usage:
//!   `uat_session_env <run_id> [default_branch [story_branch worktree_path]]` — writes the spawn
//!   environment as JSON to stdout. The last two set the Story's own branch and worktree the
//!   Gated-action deny-list decides against, as `commands/session.rs::spawn_prepared_run` does.
//!   `uat_session_env --touch-heartbeat`         — touches the heartbeat file once and exits.
//!
//! The second mode exists for the supervisor-kill script (UAT item 1). What that item actually
//! tests is what a session's watchdog does when the heartbeat STOPS being written, so the harness
//! needs to write one on the production cadence beforehand — and it must be the production
//! writer, `runtime_protocol::touch_heartbeat`, or the test would be proving that the harness's
//! own idea of the heartbeat format agrees with the watchdog's, which is not the guarantee under
//! test.
//!
//! Every failure is a plain non-zero exit with a message on stderr; this binary never panics its
//! way out, because a harness reading its stdout deserves a diagnosis rather than a backtrace.

use std::collections::BTreeMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.get(1).map(String::as_str) == Some("--touch-heartbeat") {
        match core::runtime_protocol::touch_heartbeat() {
            core::runtime_protocol::RuntimeIo::Written => return,
            core::runtime_protocol::RuntimeIo::WriteFailed(err) => {
                eprintln!("failed to touch the heartbeat: {err}");
                std::process::exit(1);
            }
        }
    }

    let Some(run_id) = args.get(1) else {
        eprintln!("usage: uat_session_env <run_id> [default_branch [story_branch worktree_path]] | --touch-heartbeat");
        std::process::exit(2);
    };
    let default_branch = args.get(2).cloned().unwrap_or_else(|| "main".to_string());

    // BTreeMap, not HashMap: stable key order makes the emitted JSON diffable when a harness run
    // is captured into a log.
    let mut env: BTreeMap<String, String> = BTreeMap::new();

    match core::shim::shim_env_for_run(run_id) {
        Ok(shim_env) => env.extend(shim_env),
        Err(err) => {
            eprintln!("failed to install the PATH shim for run {run_id}: {err:#}");
            std::process::exit(1);
        }
    }

    match core::runtime_protocol::runtime_dir() {
        Ok(dir) => {
            env.insert(
                "FLYWHEEL_RUNTIME_DIR".to_string(),
                dir.to_string_lossy().into_owned(),
            );
        }
        Err(err) => {
            eprintln!("failed to resolve the runtime directory: {err:#}");
            std::process::exit(1);
        }
    }

    env.insert(core::destructive::DEFAULT_BRANCH_ENV.to_string(), default_branch);
    if let (Some(story_branch), Some(worktree_path)) = (args.get(3), args.get(4)) {
        env.insert(core::destructive::STORY_BRANCH_ENV.to_string(), story_branch.clone());
        env.insert(core::destructive::WORKTREE_ENV.to_string(), worktree_path.clone());
    }
    env.insert(
        "FLYWHEEL_HEARTBEAT_STALE_MS".to_string(),
        core::runtime_protocol::HEARTBEAT_STALE_MS.to_string(),
    );
    env.insert(
        "FLYWHEEL_HEARTBEAT_POLL_MS".to_string(),
        core::runtime_protocol::HEARTBEAT_POLL_MS.to_string(),
    );

    match serde_json::to_string_pretty(&env) {
        Ok(json) => println!("{json}"),
        Err(err) => {
            eprintln!("failed to serialise the spawn environment: {err:#}");
            std::process::exit(1);
        }
    }
}
