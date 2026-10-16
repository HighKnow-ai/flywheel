//! A separate binary `scripts/uat/uat-08-socratic-authoring.mjs` shells out to for the ONE thing a
//! plain Node harness genuinely cannot do itself: apply a real board mutation through this crate's
//! own domain functions against a real, scratch, `FLYWHEEL_APP_DATA_DIR`-scoped database.
//!
//! Plan 06-09: this bridge now covers the execution-run proposal channel as well as authoring.
//! `propose-item` drives the IDENTICAL `apply_proposal_created` function
//! `commands::authoring::handle_inbound_proposal_created` calls in production — the property that
//! makes a green run of this binary evidence about the product rather than evidence about the
//! harness. The six sibling subcommands (`merge-proposal`, `defer-proposal`, `reject-bulk`,
//! `defer-bulk`, `list-deferred`, `limit-notices`) each call the same real domain/query function
//! their name says, never hand-rolled SQL.
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
//! `answer-board-read` (plan 05-18, G-05-1) is the read-path twin: the Node harness observes a
//! real `board_read_request` event on the live sidecar's own stdout stream and pipes it, verbatim,
//! as JSON on stdin to this subcommand — which calls `core::query::authoring::resolve_board_read`
//! with it, the SAME function `commands::authoring::handle_inbound_board_read_request` (the real
//! desktop app's own inbound handler) calls in production. Unlike every other subcommand here, a
//! resolver error is NOT a bridge failure — it still prints `{"error": "<message>"}` and exits 0,
//! because an errored read still has to be relayed back so the held sidecar call is released;
//! only a usage failure (unreadable/unparseable stdin, or a missing `runId`) exits non-zero.
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
//!   uat_authoring_ops answer-board-read                 (reads one JSON board_read_request event from stdin)
//!   uat_authoring_ops list-pending <run_id>
//!   uat_authoring_ops accept-proposal <proposal_id>
//!   uat_authoring_ops accept-subtree <proposal_id>
//!   uat_authoring_ops reject-proposal <proposal_id> [reason]
//!   uat_authoring_ops amend-criterion <proposal_id> <statement>
//!   uat_authoring_ops close-run <run_id> <prose>
//!   uat_authoring_ops epic-packet <project_id> <epic_id>
//!   uat_authoring_ops board-counts <project_id>
//!   uat_authoring_ops measure-run <run_id>              (READ-ONLY — see below)
//!   uat_authoring_ops recent-authoring-runs [limit]     (READ-ONLY — see below)
//!   uat_authoring_ops measure-board-counts <project_id> (READ-ONLY — see below)
//!   uat_authoring_ops propose-item <run_id> <target_type> <title> <rationale> [body] [kind]
//!   uat_authoring_ops merge-proposal <proposal_id> <target_kind> <target_id>
//!   uat_authoring_ops defer-proposal <proposal_id>
//!   uat_authoring_ops reject-bulk <id...>
//!   uat_authoring_ops defer-bulk <id...>
//!   uat_authoring_ops list-deferred <project_id>
//!   uat_authoring_ops limit-notices <project_id>
//!
//! `measure-run`, `recent-authoring-runs` and `measure-board-counts` are deliberately the ONLY
//! exceptions to the `FLYWHEEL_APP_DATA_DIR`-scoped-scratch-database discipline above (plan 05-13,
//! gap G-05-2's third item; plan 05-17, gap HUMAN-02): together they are the Product Kill
//! Criterion's comparison instrument, and the shaping they measure actually happened in the
//! developer's own REAL fleet database, not a scratch one this harness sets up. All three share
//! ONE early match arm in `main`, BEFORE `open_conn()` is ever called, which opens the resolved
//! database path READ-ONLY (no migration step at all, so it never touches the schema of that real
//! database) and resolves no actor. Invariant: every subcommand in that arm is read-only, never
//! migrates, and never requires the scratch-directory override. Every other subcommand below is
//! unaffected — it still goes through `open_conn()`'s own refusal guard and its own migrating
//! open.

use std::io::Read;

use core::domain::actor;
use core::domain::agent_run::{close_agent_run, AgentRunStatus};
use core::domain::authoring_proposal::{
    accept_proposal, accept_subtree, amend_proposal, defer_proposal, defer_proposals_bulk,
    merge_proposal, pending_proposals_for_run, reject_proposal, reject_proposals_bulk,
    MergeTarget, ProposalPayload,
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

/// The three board-count queries `board-counts` needs, extracted (05-17-PLAN.md Task 1) so the
/// migrating branch and the read-only `measure-board-counts` branch below call the SAME statements
/// and can never drift apart.
fn board_counts_json(conn: &Connection, project_id: &str) -> serde_json::Value {
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
    // `acceptance_criteria` carries no `project_id` column of its own (D-06) — scoped here via
    // its task/epic parent instead, matching how every other project-scoped criteria read in this
    // crate resolves the same join.
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
    serde_json::json!({ "epics": epics, "tasks": tasks, "criteria": criteria })
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let subcommand = args.get(1).map(String::as_str).unwrap_or("");

    // The read-only set's own early branch (T-05-13-02, extended by 05-17-PLAN.md Task 1) —
    // matched ONCE here, dispatched BEFORE `open_conn()` is ever called, so none of these three
    // subcommands ever goes through the FLYWHEEL_APP_DATA_DIR refusal guard, and none ever runs a
    // migration. Invariant: every subcommand in this arm is read-only, never migrates, and never
    // requires the scratch-directory override — each opens the resolved database path READ-ONLY
    // and resolves no actor, because they must be able to look at the developer's REAL fleet
    // database, where the shaping they measure actually happened.
    match subcommand {
        "measure-run" | "recent-authoring-runs" | "measure-board-counts" => {
            let db_path = core::db::default_db_path().unwrap_or_else(|err| {
                fail(&format!("could not resolve the database path: {err:#}"))
            });
            let conn =
                Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .unwrap_or_else(|err| {
                        fail(&format!("could not open the database read-only: {err:#}"))
                    });

            match subcommand {
                "measure-run" => {
                    let run_id = args.get(2).cloned().unwrap_or_default();
                    if run_id.is_empty() {
                        fail("usage: uat_authoring_ops measure-run <run_id>");
                    }
                    let measurement = core::query::authoring::measure_authoring_run(&conn, &run_id, 200)
                        .unwrap_or_else(|err| fail(&format!("could not measure the authoring run: {err:#}")));
                    print_json(
                        serde_json::to_value(&measurement).unwrap_or_else(|err| {
                            fail(&format!("could not serialise the measurement: {err:#}"))
                        }),
                    );
                }
                "recent-authoring-runs" => {
                    let limit: i64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(0);
                    let runs = core::query::authoring::list_recent_authoring_runs(&conn, limit)
                        .unwrap_or_else(|err| {
                            fail(&format!("could not list recent authoring runs: {err:#}"))
                        });
                    print_json(serde_json::to_value(&runs).unwrap_or_else(|err| {
                        fail(&format!("could not serialise the run list: {err:#}"))
                    }));
                }
                "measure-board-counts" => {
                    let project_id = args.get(2).cloned().unwrap_or_default();
                    if project_id.is_empty() {
                        fail("usage: uat_authoring_ops measure-board-counts <project_id>");
                    }
                    print_json(board_counts_json(&conn, &project_id));
                }
                _ => unreachable!("matched by the outer arm above"),
            }
            return;
        }
        _ => {}
    }

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
            let (stage, instruction) = advance_stage(&mut conn, &run_id, &human_actor_id)
                .unwrap_or_else(|err| fail(&format!("could not advance the stage: {err:#}")));
            print_json(serde_json::json!({
                "stage": stage.as_str(),
                "instructionText": instruction.map(|i| i.text),
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
                core::domain::authoring_proposal::ProposalOutcome::LimitExhausted { limit, count } => {
                    print_json(serde_json::json!({ "outcome": "limit_exhausted", "limit": limit, "count": count }));
                }
                core::domain::authoring_proposal::ProposalOutcome::LintRefused { reason } => {
                    print_json(serde_json::json!({ "outcome": "lint_refused", "reason": reason }));
                }
            }
        }
        "propose-item" => {
            let run_id = args.get(2).cloned().unwrap_or_default();
            let target_type = args.get(3).cloned().unwrap_or_default();
            let title = args.get(4).cloned().unwrap_or_default();
            let rationale = args.get(5).cloned().unwrap_or_default();
            let body = args.get(6).cloned();
            let issue_kind = args.get(7).cloned();
            if run_id.is_empty() || title.is_empty() || rationale.is_empty() {
                fail(
                    "usage: uat_authoring_ops propose-item <run_id> <target_type> <title> \
                     <rationale> [body] [kind]",
                );
            }
            // Mirrors `mcp-permission-server.ts::buildProposeItemPayload`'s own wire shape exactly
            // (D-98): the JSON event this subcommand builds is byte-for-byte the same shape a real
            // `propose_item` tool call produces on the wire, so `apply_proposal_created` (the SAME
            // function `commands::authoring::handle_inbound_proposal_created` calls in production)
            // cannot tell the two apart.
            let payload = match target_type.as_str() {
                "issue" => {
                    let Some(issue_kind) = issue_kind.clone() else {
                        fail("propose-item requires [kind] when target_type is issue");
                    };
                    let mut obj = serde_json::json!({
                        "kind": "issue",
                        "title": title,
                        "issue_kind": issue_kind,
                    });
                    if let Some(body) = &body {
                        obj["body"] = serde_json::Value::String(body.clone());
                    }
                    obj
                }
                "task" => {
                    let mut obj = serde_json::json!({ "kind": "task", "title": title });
                    if let Some(body) = &body {
                        obj["description"] = serde_json::Value::String(body.clone());
                    }
                    obj
                }
                "epic" => {
                    let mut obj = serde_json::json!({ "kind": "epic", "title": title });
                    if let Some(body) = &body {
                        obj["description"] = serde_json::Value::String(body.clone());
                    }
                    obj
                }
                other => fail(&format!(
                    "propose-item requires target_type to be one of task, issue, epic — got {other:?}"
                )),
            };
            let event = serde_json::json!({
                "type": "proposal_created",
                "runId": run_id,
                "verb": "create",
                "targetType": target_type,
                "rationale": rationale,
                "payload": payload,
            });
            let outcome = core::domain::authoring_proposal::apply_proposal_created(&mut conn, &event)
                .unwrap_or_else(|err| fail(&format!("apply_proposal_created failed: {err:#}")));
            match outcome {
                core::domain::authoring_proposal::ProposalOutcome::Created(proposal) => {
                    print_json(serde_json::json!({
                        "outcome": "created",
                        "proposalId": proposal.id,
                        "duplicateOf": proposal.duplicate_of,
                        "duplicateScore": proposal.duplicate_score,
                    }));
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
                core::domain::authoring_proposal::ProposalOutcome::LimitExhausted { limit, count } => {
                    print_json(serde_json::json!({
                        "outcome": "limit_exhausted",
                        "limit": limit,
                        "count": count,
                    }));
                }
                core::domain::authoring_proposal::ProposalOutcome::LintRefused { reason } => {
                    print_json(serde_json::json!({ "outcome": "lint_refused", "reason": reason }));
                }
            }
        }
        "merge-proposal" => {
            let proposal_id = args.get(2).cloned().unwrap_or_default();
            let target_kind = args.get(3).cloned().unwrap_or_default();
            let target_id = args.get(4).cloned().unwrap_or_default();
            if proposal_id.is_empty() || target_id.is_empty() {
                fail("usage: uat_authoring_ops merge-proposal <proposal_id> <target_kind> <target_id>");
            }
            let target = match target_kind.as_str() {
                "task" => MergeTarget::Task(target_id),
                "epic" => MergeTarget::Epic(target_id),
                other => fail(&format!(
                    "merge-proposal requires target_kind to be task or epic — got {other:?}"
                )),
            };
            let outcome = merge_proposal(&mut conn, &human_actor_id, &proposal_id, &target)
                .unwrap_or_else(|err| fail(&format!("could not merge the proposal: {err:#}")));
            print_json(serde_json::json!({
                "issueId": outcome.issue_id,
                "status": outcome.proposal.status,
            }));
        }
        "defer-proposal" => {
            let proposal_id = args.get(2).cloned().unwrap_or_default();
            if proposal_id.is_empty() {
                fail("usage: uat_authoring_ops defer-proposal <proposal_id>");
            }
            let proposal = defer_proposal(&mut conn, &human_actor_id, &proposal_id)
                .unwrap_or_else(|err| fail(&format!("could not defer the proposal: {err:#}")));
            print_json(serde_json::json!({ "status": proposal.status }));
        }
        "reject-bulk" => {
            let ids: Vec<String> = args[2..].to_vec();
            if ids.is_empty() {
                fail("usage: uat_authoring_ops reject-bulk <id...>");
            }
            let outcome = reject_proposals_bulk(&mut conn, &human_actor_id, &ids, None)
                .unwrap_or_else(|err| fail(&format!("could not bulk-reject: {err:#}")));
            print_json(serde_json::json!({
                "decided": outcome.decided,
                "skipped": outcome.skipped,
            }));
        }
        "defer-bulk" => {
            let ids: Vec<String> = args[2..].to_vec();
            if ids.is_empty() {
                fail("usage: uat_authoring_ops defer-bulk <id...>");
            }
            let outcome = defer_proposals_bulk(&mut conn, &human_actor_id, &ids)
                .unwrap_or_else(|err| fail(&format!("could not bulk-defer: {err:#}")));
            print_json(serde_json::json!({
                "decided": outcome.decided,
                "skipped": outcome.skipped,
            }));
        }
        "list-deferred" => {
            let project_id = args.get(2).cloned().unwrap_or_default();
            if project_id.is_empty() {
                fail("usage: uat_authoring_ops list-deferred <project_id>");
            }
            let window = core::query::authoring::list_deferred_proposals(&conn, &project_id, 200, None)
                .unwrap_or_else(|err| fail(&format!("could not list deferred proposals: {err:#}")));
            let rows: Vec<serde_json::Value> = window
                .proposals
                .into_iter()
                .map(|p| {
                    serde_json::json!({
                        "id": p.id,
                        "verb": p.verb,
                        "targetType": p.target_type,
                        "parentProposalId": p.parent_proposal_id,
                        "payload": p.payload,
                        "rationale": p.rationale,
                    })
                })
                .collect();
            print_json(serde_json::json!({
                "proposals": rows,
                "counts": {
                    "pending": window.counts.pending,
                    "accepted": window.counts.accepted,
                    "rejected": window.counts.rejected,
                    "merged": window.counts.merged,
                    "deferred": window.counts.deferred,
                },
            }));
        }
        "limit-notices" => {
            let project_id = args.get(2).cloned().unwrap_or_default();
            if project_id.is_empty() {
                fail("usage: uat_authoring_ops limit-notices <project_id>");
            }
            let notices = core::query::authoring::proposal_limit_notices(&conn, &project_id, 200)
                .unwrap_or_else(|err| fail(&format!("could not derive limit notices: {err:#}")));
            print_json(serde_json::to_value(&notices).unwrap_or_else(|err| {
                fail(&format!("could not serialise the limit notices: {err:#}"))
            }));
        }
        "answer-board-read" => {
            let mut raw = String::new();
            std::io::stdin()
                .read_to_string(&mut raw)
                .unwrap_or_else(|err| fail(&format!("could not read the event from stdin: {err}")));
            let event: serde_json::Value = serde_json::from_str(&raw)
                .unwrap_or_else(|err| fail(&format!("could not parse the event JSON: {err}")));
            let run_id = event.get("runId").and_then(|v| v.as_str()).unwrap_or("");
            if run_id.is_empty() {
                fail("usage: uat_authoring_ops answer-board-read (stdin event must carry a non-empty \"runId\")");
            }
            // A resolver error is still relayed, never treated as a bridge failure — the held
            // sidecar call must be released either way (05-18-PLAN.md Task 1 acceptance criteria).
            match core::query::authoring::resolve_board_read(&conn, run_id, &event) {
                Ok(value) => print_json(serde_json::json!({ "result": value })),
                Err(err) => print_json(serde_json::json!({ "error": err.to_string() })),
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
            let prompt = render_epic_prompt(&packet, None);
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
            print_json(board_counts_json(&conn, &project_id));
        }
        other => {
            fail(&format!(
                "unknown subcommand {other:?} — see this binary's own header comment for the full list"
            ));
        }
    }
}
