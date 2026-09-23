//! A separate binary `scripts/uat/uat-08-socratic-authoring.mjs` shells out to for the ONE thing a
//! plain Node harness genuinely cannot do itself: apply a real board mutation through this crate's
//! own domain functions against a real, scratch, `FLYWHEEL_APP_DATA_DIR`-scoped database.
//!
//! Mirrors `uat_seed_ui.rs`'s own discipline exactly: writes through the real domain functions
//! (`authoring_session::start_authoring_run`/`advance_stage`, `authoring_proposal::*`,
//! `epic_context_packet::*`), never hand-rolled SQL, so a row this binary produces is
//! indistinguishable from one the application itself would have produced. Refuses to run without
//! `FLYWHEEL_APP_DATA_DIR` set, for the identical reason `uat_seed_ui.rs` refuses — seeding fake
//! rows into the developer's real fleet database would be a genuinely destructive accident.
//!
//! `apply-proposal-created` is the bridge half: the Node harness observes a real `proposal_created`
//! event on the live sidecar's own stdout stream (the exact wire shape
//! `packages/sidecar/src/claude-code-adapter.ts::normalizeProposalNotice` emits) and pipes that
//! event, verbatim, as JSON on stdin to this subcommand — which calls
//! `authoring_proposal::apply_proposal_created` with it, the SAME function
//! `commands::authoring::handle_inbound_proposal_created` (the real desktop app's own inbound
//! half) calls in production. This is not a simulation of the write path; it IS the write path,
//! driven from outside the desktop app because this harness has no Tauri process to run inside.
//!
//! Every subcommand prints ONE line of JSON to stdout on success and exits 0; every failure is a
//! plain non-zero exit with a message on stderr — no panic, no backtrace, matching this crate's
//! other harness binaries.
//!
//! Usage:
//!   uat_authoring_ops register-project <repo_path>
//!   uat_authoring_ops start-run <project_id> [epic_id]
//!   uat_authoring_ops advance-stage <run_id>
//!   uat_authoring_ops apply-proposal-created            (reads one JSON event from stdin)
//!   uat_authoring_ops list-pending <run_id>
//!   uat_authoring_ops accept-proposal <proposal_id>
//!   uat_authoring_ops accept-subtree <proposal_id>
//!   uat_authoring_ops reject-proposal <proposal_id> [reason]
//!   uat_authoring_ops amend-criterion <proposal_id> <statement>
//!   uat_authoring_ops close-run <run_id> <prose>
//!   uat_authoring_ops epic-packet <project_id> <epic_id>
//!   uat_authoring_ops board-counts <project_id>

use std::io::Read;

use core::domain::actor;
use core::domain::agent_run::{close_agent_run, AgentRunStatus};
use core::domain::authoring_proposal::{
    accept_proposal, accept_subtree, amend_proposal, pending_proposals_for_run, reject_proposal,
    ProposalPayload,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::project;
use core::domain::session_summary::{create_summary, SummaryFields};
use core::epic_context_packet::{assemble_epic_context_packet, render_epic_prompt};
use rusqlite::Connection;

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn open_conn() -> Connection {
    if std::env::var_os("FLYWHEEL_APP_DATA_DIR").is_none() {
        fail(
            "FLYWHEEL_APP_DATA_DIR is not set — refusing to mutate the real fleet database. \
             Point it at a scratch directory.",
        );
    }
    let db_path = core::db::default_db_path().unwrap_or_else(|err| {
        fail(&format!("could not resolve the database path: {err:#}"));
    });
    let backups_dir = core::db::default_backups_dir().unwrap_or_else(|err| {
        fail(&format!("could not resolve the backups directory: {err:#}"));
    });
    core::db::open_and_migrate(&db_path, &backups_dir)
        .unwrap_or_else(|err| fail(&format!("could not open the database: {err:#}")))
}

fn print_json(value: serde_json::Value) {
    println!("{value}");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let subcommand = args.get(1).map(String::as_str).unwrap_or("");

    let mut conn = open_conn();
    let human_actor_id = actor::local_human_actor_id(&conn)
        .unwrap_or_else(|err| fail(&format!("could not resolve the local human actor: {err:#}")));

    match subcommand {
        "register-project" => {
            let repo_path = args.get(2).cloned().unwrap_or_default();
            if repo_path.is_empty() {
                fail("usage: uat_authoring_ops register-project <repo_path>");
            }
            let proj = project::register_project(
                &mut conn,
                &human_actor_id,
                std::path::Path::new(&repo_path),
                "UAT Socratic Authoring Scratch Project",
                "UAT",
            )
            .unwrap_or_else(|err| fail(&format!("could not register the project: {err:#}")));
            print_json(serde_json::json!({ "projectId": proj.id }));
        }
        "start-run" => {
            let project_id = args.get(2).cloned().unwrap_or_default();
            let epic_id = args.get(3).cloned();
            if project_id.is_empty() {
                fail("usage: uat_authoring_ops start-run <project_id> [epic_id]");
            }
            let run = start_authoring_run(
                &mut conn,
                &project_id,
                epic_id.as_deref(),
                "default",
                &human_actor_id,
            )
            .unwrap_or_else(|err| fail(&format!("could not start the authoring run: {err:#}")));
            print_json(serde_json::json!({
                "runId": run.id,
                "epicId": run.epic_id,
                "authoringStage": run.authoring_stage,
            }));
        }
        "advance-stage" => {
            let run_id = args.get(2).cloned().unwrap_or_default();
            if run_id.is_empty() {
                fail("usage: uat_authoring_ops advance-stage <run_id>");
            }
            let (stage, distillation) = advance_stage(&mut conn, &run_id, &human_actor_id)
                .unwrap_or_else(|err| fail(&format!("could not advance the stage: {err:#}")));
            print_json(serde_json::json!({
                "stage": stage.as_str(),
                "distillationText": distillation.map(|d| d.text),
            }));
        }
        "apply-proposal-created" => {
            let mut raw = String::new();
            std::io::stdin()
                .read_to_string(&mut raw)
                .unwrap_or_else(|err| fail(&format!("could not read the event from stdin: {err}")));
            let event: serde_json::Value = serde_json::from_str(&raw)
                .unwrap_or_else(|err| fail(&format!("could not parse the event JSON: {err}")));
            let outcome = core::domain::authoring_proposal::apply_proposal_created(&mut conn, &event)
                .unwrap_or_else(|err| fail(&format!("apply_proposal_created failed: {err:#}")));
            match outcome {
                core::domain::authoring_proposal::ProposalOutcome::Created(proposal) => {
                    print_json(serde_json::json!({ "outcome": "created", "proposalId": proposal.id }));
                }
                core::domain::authoring_proposal::ProposalOutcome::Ignored => {
                    print_json(serde_json::json!({ "outcome": "ignored" }));
                }
                core::domain::authoring_proposal::ProposalOutcome::UnknownRun => {
                    print_json(serde_json::json!({ "outcome": "unknown_run" }));
                }
                core::domain::authoring_proposal::ProposalOutcome::TerminalRun => {
                    print_json(serde_json::json!({ "outcome": "terminal_run" }));
                }
            }
        }
        "list-pending" => {
            let run_id = args.get(2).cloned().unwrap_or_default();
            if run_id.is_empty() {
                fail("usage: uat_authoring_ops list-pending <run_id>");
            }
            let proposals = pending_proposals_for_run(&conn, &run_id, 200)
                .unwrap_or_else(|err| fail(&format!("could not list pending proposals: {err:#}")));
            let rows: Vec<serde_json::Value> = proposals
                .into_iter()
                .map(|p| {
                    serde_json::json!({
                        "id": p.id,
                        "verb": p.verb,
                        "targetType": p.target_type,
                        "parentProposalId": p.parent_proposal_id,
                        "payload": p.payload,
                    })
                })
                .collect();
            print_json(serde_json::json!({ "proposals": rows }));
        }
        "accept-proposal" => {
            let proposal_id = args.get(2).cloned().unwrap_or_default();
            if proposal_id.is_empty() {
                fail("usage: uat_authoring_ops accept-proposal <proposal_id>");
            }
            let outcome = accept_proposal(&mut conn, &proposal_id, &human_actor_id)
                .unwrap_or_else(|err| fail(&format!("could not accept the proposal: {err:#}")));
            print_json(serde_json::json!({ "materialisedId": outcome.materialised_id }));
        }
        "accept-subtree" => {
            let proposal_id = args.get(2).cloned().unwrap_or_default();
            if proposal_id.is_empty() {
                fail("usage: uat_authoring_ops accept-subtree <proposal_id>");
            }
            let outcome = accept_subtree(&mut conn, &proposal_id, &human_actor_id)
                .unwrap_or_else(|err| fail(&format!("could not accept the subtree: {err:#}")));
            print_json(serde_json::json!({
                "rootMaterialisedId": outcome.root_materialised_id,
                "acceptedCount": outcome.accepted_count,
                "skippedCount": outcome.skipped_count,
            }));
        }
        "reject-proposal" => {
            let proposal_id = args.get(2).cloned().unwrap_or_default();
            let reason = args.get(3).cloned();
            if proposal_id.is_empty() {
                fail("usage: uat_authoring_ops reject-proposal <proposal_id> [reason]");
            }
            let proposal = reject_proposal(&mut conn, &proposal_id, &human_actor_id, reason.as_deref())
                .unwrap_or_else(|err| fail(&format!("could not reject the proposal: {err:#}")));
            print_json(serde_json::json!({ "status": proposal.status }));
        }
        "amend-criterion" => {
            let proposal_id = args.get(2).cloned().unwrap_or_default();
            let statement = args.get(3).cloned().unwrap_or_default();
            if proposal_id.is_empty() || statement.is_empty() {
                fail("usage: uat_authoring_ops amend-criterion <proposal_id> <statement>");
            }
            let payload = ProposalPayload::Criterion { statement, verification_hint: None };
            let outcome = amend_proposal(&mut conn, &proposal_id, &human_actor_id, payload)
                .unwrap_or_else(|err| fail(&format!("could not amend the proposal: {err:#}")));
            print_json(serde_json::json!({ "originalLabel": outcome.original_label }));
        }
        "close-run" => {
            let run_id = args.get(2).cloned().unwrap_or_default();
            let prose = args.get(3).cloned().unwrap_or_default();
            if run_id.is_empty() {
                fail("usage: uat_authoring_ops close-run <run_id> <prose>");
            }
            let fields = SummaryFields {
                changed_files: Vec::new(),
                changed_prose: Some(prose),
                remains: None,
                next_session_must_know: None,
                decisions: Vec::new(),
                acknowledged_decisions: Vec::new(),
                diff_ref: None,
                auto_generated: false,
            };
            create_summary(&mut conn, &run_id, fields, &human_actor_id)
                .unwrap_or_else(|err| fail(&format!("could not create the summary: {err:#}")));
            close_agent_run(&mut conn, &run_id, AgentRunStatus::Completed, None, None, None)
                .unwrap_or_else(|err| fail(&format!("could not close the run: {err:#}")));
            print_json(serde_json::json!({ "closed": true }));
        }
        "epic-packet" => {
            let project_id = args.get(2).cloned().unwrap_or_default();
            let epic_id = args.get(3).cloned().unwrap_or_default();
            if project_id.is_empty() || epic_id.is_empty() {
                fail("usage: uat_authoring_ops epic-packet <project_id> <epic_id>");
            }
            let packet = assemble_epic_context_packet(&conn, &project_id, Some(&epic_id))
                .unwrap_or_else(|err| fail(&format!("could not assemble the packet: {err:#}")));
            let prompt = render_epic_prompt(&packet);
            print_json(serde_json::json!({
                "taskRosterCount": packet.task_roster.len(),
                "rejectedVerbatimCount": packet.rejected.verbatim.len(),
                "renderedPrompt": prompt,
            }));
        }
        "board-counts" => {
            let project_id = args.get(2).cloned().unwrap_or_default();
            if project_id.is_empty() {
                fail("usage: uat_authoring_ops board-counts <project_id>");
            }
            let epics: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM epics WHERE project_id = ?1",
                    rusqlite::params![project_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            let tasks: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM tasks WHERE project_id = ?1",
                    rusqlite::params![project_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            // `acceptance_criteria` carries no `project_id` column of its own (D-06) — scoped
            // here via its task/epic parent instead, matching how every other project-scoped
            // criteria read in this crate resolves the same join.
            let criteria: i64 = conn
                .query_row(
                    "SELECT \
                        (SELECT COUNT(*) FROM acceptance_criteria WHERE parent_type = 'task' \
                            AND parent_id IN (SELECT id FROM tasks WHERE project_id = ?1)) + \
                        (SELECT COUNT(*) FROM acceptance_criteria WHERE parent_type = 'epic' \
                            AND parent_id IN (SELECT id FROM epics WHERE project_id = ?1))",
                    rusqlite::params![project_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            print_json(serde_json::json!({ "epics": epics, "tasks": tasks, "criteria": criteria }));
        }
        other => {
            fail(&format!(
                "unknown subcommand {other:?} — see this binary's own header comment for the full list"
            ));
        }
    }
}
