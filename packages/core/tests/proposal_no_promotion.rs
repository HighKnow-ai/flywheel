//! D-100 (plan 06-02, PROP-02/PROP-03): the source gate plus the adversarial corpus proving
//! `must_haves.prohibitions` item 1 in `06-01-PLAN.md` — no agent-reachable code path can turn a
//! staged `authoring_proposals` row into a canonical `epics`/`tasks`/`issues`/`acceptance_criteria`
//! row without an explicit human triage action (`accept_proposal`/`accept_subtree`, exercised via
//! `materialise_proposal`/`accept_proposal_in_tx`).
//!
//! Self-contained per this repo's own precedent (`app_exit_ordering.rs`/`session_closed_call_site.rs`):
//! carries its own copies of `workspace_root`/`is_whole_line_comment`/`sources_under` rather than
//! sharing `authoring_proposal.rs`'s — which this file never modifies.

use std::path::{Path, PathBuf};

mod common;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::{agent_actor_id, mark_abandoned};
use core::domain::authoring_proposal::{
    accept_proposal, amend_proposal, apply_proposal_created, create_proposal,
    pending_proposals_for_run, reject_proposal, ProposalOutcome, ProposalPayload,
    ProposalProvenance, ProposalUndecidable, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::epic::create_epic;
use core::domain::project::Project;
use core::domain::task::{create_task, delete_task};
use core::ids::new_id;
use rusqlite::{params, Connection};

// --- Shared source-scanning helpers (copied verbatim from `authoring_proposal.rs`'s own tail —
// this repo's own precedent, `app_exit_ordering.rs`/`session_closed_call_site.rs`, is that every
// source-gate test file carries its own copy rather than sharing a module) ---

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

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path
                .extension()
                .is_some_and(|e| e == "rs" || e == "ts" || e == "tsx")
            {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths
        .into_iter()
        .map(|p| {
            let body = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}

// --- Gate 1: no agent-reachable module writes a canonical table directly (PROP-03) ---

/// The five case-sensitive literal substrings naming a direct write to a canonical table: an
/// INSERT into each of the four canonical tables, and an UPDATE of `acceptance_criteria` (the one
/// canonical table this staging system ever amends in place, via `revise_criterion_in_tx`). This
/// gate does not police `DELETE FROM <table>` — deletion is not a PROMOTION (turning a proposal
/// into new board substance), which is the narrow thing D-100 exists to prove is impossible
/// without triage; each canonical table's own `_in_tx` writer is still the only legitimate place a
/// delete of that table happens, verified separately for `authoring_proposal.rs` by Gate 2 below.
const CANONICAL_WRITE_PATTERNS: [&str; 5] = [
    "INSERT INTO epics",
    "INSERT INTO tasks",
    "INSERT INTO issues",
    "INSERT INTO acceptance_criteria",
    "UPDATE acceptance_criteria",
];

/// The four canonical-writer modules that legitimately own the patterns above — allow-listed by
/// exact path suffix. Nothing else in the three scanned trees may contain one of these patterns
/// outside a comment.
const CANONICAL_WRITER_SUFFIXES: [&str; 4] = [
    "src/domain/task.rs",
    "src/domain/epic.rs",
    "src/domain/issue.rs",
    "src/domain/acceptance_criterion.rs",
];

#[test]
fn no_agent_reachable_module_writes_a_canonical_table() {
    let root = workspace_root();
    let scan_dirs = [
        root.join("packages/core/src"),
        root.join("packages/desktop/src-tauri/src"),
        root.join("packages/sidecar/src"),
    ];

    let mut offenders = Vec::new();
    for dir in scan_dirs {
        for (path, body) in sources_under(&dir) {
            let path_str = path.to_string_lossy();
            if CANONICAL_WRITER_SUFFIXES.iter().any(|s| path_str.ends_with(s)) {
                continue; // the canonical writer itself legitimately owns this statement
            }
            // Schema DDL (`packages/core/src/db/migrations/*.sql`) is not an agent-reachable write
            // path — also naturally excluded by `sources_under`'s own rs/ts/tsx extension filter,
            // this check is a defensive second line in case a future `.rs`-based migration helper
            // ever lands under that directory.
            if path_str.contains("/migrations/") {
                continue;
            }
            for (n, line) in body.lines().enumerate() {
                if is_whole_line_comment(line) {
                    continue;
                }
                for forbidden in CANONICAL_WRITE_PATTERNS {
                    if line.contains(forbidden) {
                        offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
                    }
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "an agent-reachable module writes a canonical table directly — PROP-03/D-100 requires \
         every canonical-table write go through its owning domain module's `_in_tx` writer, never \
         a local INSERT/UPDATE. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

// --- Gate 2: at most three functions in the staging module reach a canonical writer (PROP-03) ---

/// The nine canonical-writer `_in_tx` call targets D-100's containment bound applies to (matches
/// `06-02-PLAN.md`'s own enumeration exactly — `delete_criterion_in_tx` is deliberately not in
/// this list for the same reason Gate 1 above does not police deletes: containment here bounds
/// PROMOTION, not deletion).
const CANONICAL_WRITER_CALLS: [&str; 9] = [
    "create_task_in_tx(",
    "create_epic_in_tx(",
    "create_criterion_in_tx(",
    "revise_criterion_in_tx(",
    "update_task_in_tx(",
    "update_epic_in_tx(",
    "delete_task_in_tx(",
    "delete_epic_in_tx(",
    "create_issue_in_tx(",
];

/// The only three functions permitted to reach a canonical writer from this module.
/// `merge_proposal_in_tx` (plan 06-03) is now a real call site — the containment check was
/// written, before that function existed, to never tolerate a call from any fourth function; it
/// still enforces exactly that now that all three names are real.
const ALLOWED_CANONICAL_WRITER_CONTAINERS: [&str; 3] =
    ["materialise_proposal", "accept_proposal_in_tx", "merge_proposal_in_tx"];

/// A top-level (column-0) `fn <name>(` declaration line's function name, or `None` if this line is
/// not one — used to track the "most recently declared top-level function" while walking the file
/// linearly. Indented lines (impl-block methods, closures) never match, which is what keeps this
/// from misattributing a canonical-writer call found inside some unrelated `impl` block's method.
fn top_level_fn_name(line: &str) -> Option<&str> {
    if line.starts_with(' ') || line.starts_with('\t') {
        return None;
    }
    let rest = line
        .strip_prefix("pub(crate) fn ")
        .or_else(|| line.strip_prefix("pub fn "))
        .or_else(|| line.strip_prefix("fn "))?;
    let name_end = rest.find('(')?;
    Some(rest[..name_end].trim())
}

#[test]
fn only_three_call_sites_reach_a_canonical_writer_from_the_staging_module() {
    let root = workspace_root();
    let path = root.join("packages/core/src/domain/authoring_proposal.rs");
    let body = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read {path:?}: {e}"));

    let mut current_fn: Option<&str> = None;
    let mut offenders = Vec::new();

    for (n, line) in body.lines().enumerate() {
        if let Some(name) = top_level_fn_name(line) {
            current_fn = Some(name);
        }
        if is_whole_line_comment(line) {
            continue;
        }
        for call in CANONICAL_WRITER_CALLS {
            if line.contains(call) {
                let contained = current_fn.is_some_and(|f| ALLOWED_CANONICAL_WRITER_CONTAINERS.contains(&f));
                if !contained {
                    offenders.push(format!(
                        "{}:{}: {} (enclosing fn: {:?})",
                        path.display(),
                        n + 1,
                        line.trim(),
                        current_fn
                    ));
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "a canonical writer is reached from outside materialise_proposal/accept_proposal_in_tx/\
         merge_proposal_in_tx — PROP-03/D-100 bounds promotion to exactly these three call sites. \
         Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

// --- Gate 3: the walker actually reaches the frontend tree (the gate on the gate) ---

/// The no-promotion gate above names `packages/desktop/src` as (implicitly, via Gate 1's own scan
/// list not including it directly, but this gate exists to prove the shared `sources_under` walker
/// this file depends on is not an `.rs`-only no-op) — a `.rs`-only walker would silently turn any
/// future TypeScript-side promotion-path check into permanent dead coverage, exactly the coverage
/// hole Phase 5 verification found once already for the accept-all gate. This test fails if the
/// walker ever stops reaching the frontend tree.
#[test]
fn the_no_promotion_gate_actually_reaches_the_frontend_tree() {
    let frontend = workspace_root().join("packages/desktop/src");
    let collected = sources_under(&frontend);

    assert!(
        !collected.is_empty(),
        "this gate's walker scans {} but collected no sources there — the frontend half of the \
         no-promotion gate is a no-op",
        frontend.display()
    );
    assert!(
        collected.iter().any(|(p, _)| p.extension().is_some_and(|e| e == "tsx")),
        "collected {} sources under {} but not one .tsx file — the walker is not reaching the \
         frontend components a TypeScript-side promotion path would live in",
        collected.len(),
        frontend.display()
    );
    assert!(
        collected.iter().any(|(p, _)| p.extension().is_some_and(|e| e == "ts")),
        "collected {} sources under {} but not one .ts file",
        collected.len(),
        frontend.display()
    );
}

// --- Gate 4: `domain::issue` carries no status identifier at the source level (D-97) ---

/// `issue.rs`'s own module header already claims "this module contains no `status` identifier and
/// no reference to `WORKFLOW_STATES`" — `hierarchy_workflow.rs`'s `issue_has_no_workflow_status`
/// only proves that against a live database row (a missing column), which would not catch a
/// `status`-adjacent field added to the Rust struct without a schema change. This is the
/// source-level gate the header comment claims exists.
#[test]
fn domain_issue_contains_no_status_identifier_at_source_level() {
    let root = workspace_root();
    let path = root.join("packages/core/src/domain/issue.rs");
    let body = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read {path:?}: {e}"));

    let mut offenders = Vec::new();
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        if line.contains("status") || line.contains("WORKFLOW_STATES") {
            offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
        }
    }

    assert!(
        offenders.is_empty(),
        "domain::issue.rs's own header comment claims no `status` identifier and no \
         `WORKFLOW_STATES` reference exist in this module (RESEARCH.md Pitfall 4, D-97) — that \
         claim was previously unchecked at the source level. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

// --- Gate 5: the Phase-5 accept-all gate is untouched (D-104 narrows it, never replaces it) ---

#[test]
fn the_accept_all_gate_still_passes_unmodified() {
    let root = workspace_root();
    let path = root.join("packages/core/tests/authoring_proposal.rs");
    let body = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read {path:?}: {e}"));

    assert!(
        body.contains("fn no_accept_all_identifier_exists_outside_this_gates_own_file"),
        "authoring_proposal.rs no longer declares its own accept-all gate function — D-104 \
         narrows the no-accept-all discipline, it does not delete the Phase-5 gate that enforces it"
    );
    assert!(
        body.contains("fn sources_under"),
        "authoring_proposal.rs no longer declares its own sources_under walker — per this repo's \
         own precedent, each source-gate test file must carry its own copy"
    );
}

// ===========================================================================================
// The adversarial corpus (D-100's second half): drives every propose/amend/delete path — both
// entry routes (`create_proposal`, an authoring session's own caller; `apply_proposal_created`,
// the sidecar's execution-run event path) — through the REAL domain functions, and proves zero
// canonical rows appear before an explicit human triage action decides them, for all of it.
// ===========================================================================================

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — mirrors
/// `authoring_proposal.rs`'s identically-named lock (a separate static per test binary).
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

/// Serializes every call to [`with_scratch_app_data_dir`] in THIS binary — mirrors
/// `proposal_channel.rs`'s identically-named lock (a separate static per test binary).
static APP_DATA_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_app_data_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = APP_DATA_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch app-data dir");
    // SAFETY: serialised by APP_DATA_DIR_ENV_LOCK above.
    unsafe { std::env::set_var("FLYWHEEL_APP_DATA_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_APP_DATA_DIR") };
    result
}

/// Seed a project and an authoring run already advanced past `challenge` into `decompose` — the
/// entry point for the `create_proposal` route (mirrors `authoring_proposal.rs`'s identically
/// named fixture).
fn ready_run() -> (Connection, String, Project, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &human_actor_id).expect("advance_stage should succeed");
    (conn, human_actor_id, project, run.id)
}

/// Seed a project, one task, and a RUNNING task-execution `agent_runs` row scoped to that task
/// with NO epic — the entry point for the `apply_proposal_created` route, the ordinary shape a
/// `propose_item` call's staging event arrives against (mirrors `proposal_channel.rs`'s
/// identically named fixture — inserted directly via SQL rather than `start_agent_run`, which
/// requires a real worktree/git repo this file has no need for).
fn seeded_execution_run() -> (Connection, String, String, String, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human_actor_id, "Investigate the flaky test", None)
        .expect("create_task should succeed");
    let agent_actor = agent_actor_id(&conn).expect("seeded agent actor should exist");

    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![new_id(), project.id, task.id, human_actor_id, now],
            |row| row.get(0),
        )
        .expect("failed to insert fixture trigger");

    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', NULL, \
            NULL, NULL, ?6, ?7, NULL, NULL)",
        params![
            run_id,
            task.id,
            project.id,
            trigger_id,
            agent_actor,
            format!("/tmp/log-{run_id}.jsonl"),
            now,
        ],
    )
    .expect("failed to insert fixture agent_run");

    (conn, human_actor_id, project.id, task.id, run_id)
}

fn task_create_event(run_id: &str, title: &str, rationale: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "create",
        "targetType": "task",
        "payload": { "kind": "task", "title": title, "description": null },
        "rationale": rationale,
    })
}

fn issue_create_event(run_id: &str, title: &str, rationale: &str, issue_kind: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "create",
        "targetType": "issue",
        "payload": { "kind": "issue", "title": title, "body": null, "issue_kind": issue_kind },
        "rationale": rationale,
    })
}

fn count_tasks(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap()
}
fn count_epics(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM epics", [], |row| row.get(0)).unwrap()
}
fn count_issues(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0)).unwrap()
}
fn count_criteria(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0)).unwrap()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Counts {
    tasks: i64,
    epics: i64,
    issues: i64,
    criteria: i64,
}

fn counts(conn: &Connection) -> Counts {
    Counts {
        tasks: count_tasks(conn),
        epics: count_epics(conn),
        issues: count_issues(conn),
        criteria: count_criteria(conn),
    }
}

// --- The 13 base cases: every verb x target-type combination named in 06-02-PLAN.md's own
// enumeration, plus the two named edge cases (criterion parented to a still-pending task
// proposal, and a target row deleted underneath its own proposal) ---

fn case_create_task_via_create_proposal() {
    let label: &str = "create task via create_proposal stays pending with no canonical row until accept";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Retry budget ignores the configured value".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(proposal.materialised_id, None, "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging must create no canonical row");

        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");
        assert!(outcome.proposal.materialised_id.is_some(), "{label}");
        assert_eq!(counts(&conn), Counts { tasks: before.tasks + 1, ..before }, "{label}: accept must mint exactly one task");
    });
}

fn case_create_epic_via_create_proposal() {
    let label: &str = "create epic via create_proposal stays pending with no canonical row until accept";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "New epic drafted from a run's finding".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging must create no canonical row");

        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");
        assert!(outcome.proposal.materialised_id.is_some(), "{label}");
        assert_eq!(counts(&conn), Counts { epics: before.epics + 1, ..before }, "{label}: accept must mint exactly one epic");
    });
}

fn case_create_issue_via_execution_run_task_scoped_null_epic() {
    let label: &str = "create issue via an execution run's propose_item event (task-scoped, null epic) stages pending with no canonical row; accept mints exactly one top-level issue (plan 06-03)";
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        let before = counts(&conn);

        let event = issue_create_event(
            &run_id,
            "Docs drift from the real CLI flags",
            "Noticed while executing an unrelated task",
            "idea",
        );
        let outcome = apply_proposal_created(&mut conn, &event).expect("apply_proposal_created should succeed");
        let ProposalOutcome::Created(proposal) = outcome else {
            panic!("{label}: expected ProposalOutcome::Created, got {outcome:?}");
        };
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(proposal.target_type, "issue", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging must create no canonical row");

        // Plan 06-03: accepting a create/issue proposal now mints exactly one top-level `issues`
        // row (IssueParent::None) through `create_issue_in_tx` — the materialisation gap this
        // corpus originally surfaced (06-02-SUMMARY.md) is closed.
        let accept_outcome =
            accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed for a create/issue proposal");
        assert!(accept_outcome.proposal.materialised_id.is_some(), "{label}");
        assert_eq!(
            counts(&conn),
            Counts { issues: before.issues + 1, ..before },
            "{label}: accept must mint exactly one top-level issue, no other canonical row"
        );

        let still_pending = pending_proposals_for_run(&conn, &run_id, 0).expect("pending read should succeed");
        assert!(
            still_pending.iter().all(|p| p.id != proposal.id),
            "{label}: the accepted proposal must no longer appear in the pending set"
        );
    });
}

fn case_create_criterion_parented_to_an_already_accepted_task() {
    let label: &str =
        "create criterion parented to an already-accepted task proposal stays pending with no canonical row until accept";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();

        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Parent task, accepted first".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (task) should succeed");
        accept_proposal(&mut conn, &task_proposal.id, &human_actor_id).expect("accept_proposal (task) should succeed");

        let before = counts(&conn);
        let criterion_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Retry budget is configurable".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (criterion) should succeed");
        assert_eq!(criterion_proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging must create no canonical row");

        let outcome =
            accept_proposal(&mut conn, &criterion_proposal.id, &human_actor_id).expect("accept_proposal (criterion) should succeed");
        assert!(outcome.proposal.materialised_id.is_some(), "{label}");
        assert_eq!(
            counts(&conn),
            Counts { criteria: before.criteria + 1, ..before },
            "{label}: accept must mint exactly one criterion, no other canonical row"
        );
    });
}

fn case_create_assumption_never_materialises_a_canonical_row() {
    let label: &str =
        "create assumption via create_proposal stays pending, and accepting it never writes any canonical table (D-89)";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Assumption {
                assumption: "The retry budget is read from config".to_string(),
                answer: "Confirmed by reading the code".to_string(),
            },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (assumption) should succeed");
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging must create no canonical row");

        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal (assumption) should succeed");
        assert_eq!(
            outcome.materialised_id, proposal.id,
            "{label}: an accepted assumption's materialised_id self-references the proposal — no canonical row exists to point at"
        );
        assert_eq!(counts(&conn), before, "{label}: accepting an assumption must never write any canonical table");
    });
}

fn case_amend_task_leaves_every_canonical_count_unchanged() {
    let label: &str = "amend a pending task proposal via amend_proposal leaves every canonical count unchanged and the row pending";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Original title".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        assert_eq!(counts(&conn), before, "{label}");

        let amend_outcome = amend_proposal(
            &mut conn,
            &proposal.id,
            &human_actor_id,
            ProposalPayload::Task { title: "Corrected title".to_string(), description: None },
        )
        .expect("amend_proposal should succeed");
        assert_eq!(amend_outcome.proposal.status, "pending", "{label}: amending must never accept");
        assert_eq!(counts(&conn), before, "{label}: amend must never write a canonical row");
    });
}

fn case_amend_epic_leaves_every_canonical_count_unchanged() {
    let label: &str = "amend a pending epic proposal via amend_proposal leaves every canonical count unchanged and the row pending";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "Original epic title".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");
        assert_eq!(counts(&conn), before, "{label}");

        let amend_outcome = amend_proposal(
            &mut conn,
            &proposal.id,
            &human_actor_id,
            ProposalPayload::Epic { title: "Corrected epic title".to_string(), description: None },
        )
        .expect("amend_proposal should succeed");
        assert_eq!(amend_outcome.proposal.status, "pending", "{label}: amending must never accept");
        assert_eq!(counts(&conn), before, "{label}: amend must never write a canonical row");
    });
}

fn case_amend_criterion_leaves_every_canonical_count_unchanged() {
    let label: &str = "amend a pending criterion proposal via amend_proposal leaves every canonical count unchanged and the row pending";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();

        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Parent task for amend-criterion case".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (task) should succeed");
        accept_proposal(&mut conn, &task_proposal.id, &human_actor_id).expect("accept_proposal (task) should succeed");

        let before = counts(&conn);
        let criterion_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Original statement".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (criterion) should succeed");
        assert_eq!(counts(&conn), before, "{label}");

        let amend_outcome = amend_proposal(
            &mut conn,
            &criterion_proposal.id,
            &human_actor_id,
            ProposalPayload::Criterion { statement: "Corrected statement".to_string(), verification_hint: None },
        )
        .expect("amend_proposal should succeed");
        assert_eq!(amend_outcome.proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: amend must never write a canonical row");
    });
}

fn case_delete_task_stays_pending_until_accept() {
    let label: &str = "delete a pre-existing task via a delete proposal stays pending with the task still present until accept";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let existing_task = create_task(&mut conn, &project.id, &human_actor_id, "Existing task to delete", None)
            .expect("create_task should succeed");

        let before = counts(&conn);
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Delete,
            ProposalPayload::Task { title: String::new(), description: None },
            Some(&existing_task.id),
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (delete task) should succeed");
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging a delete proposal must not delete the row yet");

        accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");
        assert_eq!(
            counts(&conn),
            Counts { tasks: before.tasks - 1, ..before },
            "{label}: accept must delete exactly the named task"
        );
    });
}

fn case_delete_epic_stays_pending_until_accept() {
    let label: &str = "delete a pre-existing epic via a delete proposal stays pending with the epic still present until accept";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let existing_epic = create_epic(&mut conn, &project.id, &human_actor_id, "Existing epic to delete", None)
            .expect("create_epic should succeed");

        let before = counts(&conn);
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Delete,
            ProposalPayload::Epic { title: String::new(), description: None },
            Some(&existing_epic.id),
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (delete epic) should succeed");
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging a delete proposal must not delete the row yet");

        accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");
        assert_eq!(
            counts(&conn),
            Counts { epics: before.epics - 1, ..before },
            "{label}: accept must delete exactly the named epic"
        );
    });
}

fn case_delete_criterion_stays_pending_until_accept() {
    let label: &str = "delete a pre-existing criterion via a delete proposal stays pending with the criterion still present until accept";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let parent_task = create_task(&mut conn, &project.id, &human_actor_id, "Parent task for delete-criterion case", None)
            .expect("create_task should succeed");
        let existing_criterion = create_criterion(
            &mut conn,
            &project.id,
            &human_actor_id,
            "task",
            &parent_task.id,
            "Existing criterion to delete",
            None,
        )
        .expect("create_criterion should succeed");

        let before = counts(&conn);
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Delete,
            ProposalPayload::Criterion { statement: String::new(), verification_hint: None },
            Some(&existing_criterion.id),
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (delete criterion) should succeed");
        assert_eq!(proposal.status, "pending", "{label}");
        assert_eq!(counts(&conn), before, "{label}: staging a delete proposal must not delete the row yet");

        accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");
        assert_eq!(
            counts(&conn),
            Counts { criteria: before.criteria - 1, ..before },
            "{label}: accept must delete exactly the named criterion"
        );
    });
}

fn case_criterion_parented_to_a_still_pending_task_proposal() {
    let label: &str = "a criterion proposal parented to a still-pending (not yet accepted) task proposal stays pending with no canonical row, and rejecting it leaves the parent pending too";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Not yet accepted parent".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (task) should succeed");
        let criterion_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion {
                statement: "Drafted before the parent is decided".to_string(),
                verification_hint: None,
            },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (criterion) should succeed");

        assert_eq!(counts(&conn), before, "{label}: staging both proposals must create no canonical row");
        assert_eq!(task_proposal.status, "pending", "{label}");
        assert_eq!(criterion_proposal.status, "pending", "{label}");

        reject_proposal(&mut conn, &criterion_proposal.id, &human_actor_id, None).expect("reject_proposal should succeed");
        assert_eq!(counts(&conn), before, "{label}: rejecting the criterion must create no canonical row");

        let refreshed = pending_proposals_for_run(&conn, &run_id, 0).expect("pending read should succeed");
        assert!(
            refreshed.iter().any(|p| p.id == task_proposal.id),
            "{label}: the parent task proposal must remain pending, untouched by its child's rejection"
        );
    });
}

fn case_amend_target_deleted_underneath_it_is_undecidable() {
    let label: &str = "an amend proposal whose target task is deleted underneath it returns a typed ProposalUndecidable error, never a silent promotion, and leaves every canonical count untouched";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let task = create_task(&mut conn, &project.id, &human_actor_id, "Will vanish before triage", None)
            .expect("create_task should succeed");

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Amend,
            ProposalPayload::Task { title: "Renamed before the target vanished".to_string(), description: None },
            Some(&task.id),
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (amend) should succeed");

        delete_task(&mut conn, &human_actor_id, &task.id).expect("delete_task should succeed");
        let before = counts(&conn);

        let err = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap_err();
        let undecidable = err
            .downcast_ref::<ProposalUndecidable>()
            .expect("expected a typed ProposalUndecidable error");
        assert_eq!(undecidable.target_id, task.id, "{label}");
        assert_eq!(undecidable.target_type, "task", "{label}");
        assert_eq!(counts(&conn), before, "{label}: a refused accept must leave every canonical count untouched");

        let refreshed = pending_proposals_for_run(&conn, &run_id, 0).expect("pending read should succeed");
        assert!(
            refreshed.iter().any(|p| p.id == proposal.id),
            "{label}: the proposal must remain pending after the failed accept, not corrupted into some other state"
        );
    });
}

// --- The three ordering cases the plain per-case loop cannot express ---

fn case_ordering_child_accepted_before_parent_materialises_parent_exactly_once() {
    let label: &str = "ordering (a): accepting a child criterion proposal before its parent task proposal materialises the parent exactly once (D-96's implied-parent accept), and a third, undecided sibling criterion proposal still has no canonical row";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Parent, not yet accepted".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (task) should succeed");

        let child_a = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Child A, will be accepted".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (criterion A) should succeed");
        let sibling_b = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Sibling B, stays undecided".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (criterion B) should succeed");

        assert_eq!(counts(&conn), before, "{label}: staging three proposals must create no canonical row");

        accept_proposal(&mut conn, &child_a.id, &human_actor_id).expect("accept_proposal (child A) should succeed");

        assert_eq!(
            counts(&conn),
            Counts { tasks: before.tasks + 1, criteria: before.criteria + 1, ..before },
            "{label}: exactly one implied-parent task and one criterion must exist, no more"
        );

        let still_pending = pending_proposals_for_run(&conn, &run_id, 0).expect("pending read should succeed");
        assert!(
            still_pending.iter().any(|p| p.id == sibling_b.id && p.materialised_id.is_none()),
            "{label}: the undecided sibling must remain pending with no materialised_id"
        );
    });
}

fn case_ordering_two_siblings_sharing_created_at_only_the_accepted_one_materialises() {
    let label: &str = "ordering (b): two sibling proposals staged with the same created_at timestamp — accepting one produces exactly one canonical row, belonging to the accepted id, while the other stays pending";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let before = counts(&conn);

        let first = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "First sibling, will be accepted".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (first) should succeed");
        let second = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Second sibling, stays pending".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (second) should succeed");

        // Force an exact tie on created_at — the property under test is what happens when two
        // proposals are indistinguishable by staging order, not whether the wall clock happens to
        // tick between two sequential calls in a fast test run.
        let tied_at = "2026-01-01T00:00:00.000Z";
        conn.execute(
            "UPDATE authoring_proposals SET created_at = ?1 WHERE id IN (?2, ?3)",
            params![tied_at, first.id, second.id],
        )
        .expect("failed to force a tied created_at for the fixture");

        assert_eq!(counts(&conn), before, "{label}: staging two proposals must create no canonical row");

        accept_proposal(&mut conn, &first.id, &human_actor_id).expect("accept_proposal (first) should succeed");

        assert_eq!(
            counts(&conn),
            Counts { tasks: before.tasks + 1, ..before },
            "{label}: exactly one canonical row must exist"
        );

        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE project_id = ?1", params![project.id], |row| row.get(0))
            .expect("failed to read back the materialised task");
        assert_eq!(
            title, "First sibling, will be accepted",
            "{label}: the materialised row must belong to the accepted proposal, not its tied-timestamp sibling"
        );

        let still_pending = pending_proposals_for_run(&conn, &run_id, 0).expect("pending read should succeed");
        assert!(
            still_pending.iter().any(|p| p.id == second.id),
            "{label}: the un-accepted sibling must remain pending"
        );
    });
}

fn case_ordering_reject_then_accept_is_refused_not_a_second_promotion() {
    let label: &str = "ordering (c): a proposal rejected and then accepted in the same test — the second call is refused, and no canonical row appears";
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let before = counts(&conn);

        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Rejected, then an accept is attempted anyway".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal should succeed");

        reject_proposal(&mut conn, &proposal.id, &human_actor_id, Some("not worth doing"))
            .expect("reject_proposal should succeed");
        assert_eq!(counts(&conn), before, "{label}: rejecting must create no canonical row");

        let result = accept_proposal(&mut conn, &proposal.id, &human_actor_id);
        assert!(result.is_err(), "{label}: accepting an already-rejected proposal must be refused, not silently promoted");
        assert_eq!(counts(&conn), before, "{label}: the refused accept must leave every canonical count untouched");

        let status: String = conn
            .query_row("SELECT status FROM authoring_proposals WHERE id = ?1", params![proposal.id], |row| row.get(0))
            .expect("failed to read back the proposal's status");
        assert_eq!(status, "rejected", "{label}: the proposal's status must remain rejected, never corrupted");
    });
}

// --- The abandoned-run case (D-80's own discretion item, recorded as a test) ---

fn case_abandoned_run_pending_proposal_survives_and_new_event_is_refused() {
    let label: &str = "a pending proposal survives its run being marked abandoned untouched, and a NEW proposal_created event for the same abandoned run returns TerminalRun and stages nothing (D-80)";
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        let before = counts(&conn);

        let first_event = task_create_event(
            &run_id,
            "Found while executing, run will be abandoned",
            "Noticed a stale retry loop",
        );
        let ProposalOutcome::Created(first_proposal) =
            apply_proposal_created(&mut conn, &first_event).expect("apply_proposal_created should succeed")
        else {
            panic!("{label}: expected ProposalOutcome::Created");
        };
        assert_eq!(counts(&conn), before, "{label}: staging must create no canonical row");

        let wrote = mark_abandoned(&mut conn, &run_id, &human_actor_id, None).expect("mark_abandoned should succeed");
        assert!(wrote, "{label}: mark_abandoned should have performed a real transition from running");

        // The pending row survives untouched — same status, same payload, same rationale, still
        // returned by the pending read.
        let survived = pending_proposals_for_run(&conn, &run_id, 0).expect("pending read should succeed");
        let survivor = survived
            .iter()
            .find(|p| p.id == first_proposal.id)
            .unwrap_or_else(|| panic!("{label}: the pending proposal must still be returned by the pending read after abandonment"));
        assert_eq!(survivor.status, "pending", "{label}");
        assert_eq!(survivor.payload, first_proposal.payload, "{label}: the payload must be byte-identical after abandonment");
        assert_eq!(survivor.rationale, first_proposal.rationale, "{label}: the rationale must be byte-identical after abandonment");
        assert_eq!(counts(&conn), before, "{label}: mark_abandoned must never write a canonical row");

        // A NEW proposal_created event for the SAME now-abandoned run must be refused before any
        // database write, staging nothing.
        let second_event = task_create_event(&run_id, "A second finding after the run died", "This must never be staged");
        let outcome = apply_proposal_created(&mut conn, &second_event).expect("apply_proposal_created should not error, only refuse");
        assert_eq!(outcome, ProposalOutcome::TerminalRun, "{label}: a new event against an abandoned run must return TerminalRun");

        let count_for_run: i64 = conn
            .query_row("SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1", params![run_id], |row| row.get(0))
            .expect("failed to count proposals for this run");
        assert_eq!(count_for_run, 1, "{label}: the refused second event must stage no new row");
        assert_eq!(counts(&conn), before, "{label}: the refused second event must never write a canonical row");
    });
}

// --- The corpus table itself ---

struct CorpusCase {
    label: &'static str,
    run: fn(),
}

const CORPUS: &[CorpusCase] = &[
    CorpusCase { label: "create task via create_proposal", run: case_create_task_via_create_proposal },
    CorpusCase { label: "create epic via create_proposal", run: case_create_epic_via_create_proposal },
    CorpusCase {
        label: "create issue via an execution run's propose_item event, task-scoped, null epic",
        run: case_create_issue_via_execution_run_task_scoped_null_epic,
    },
    CorpusCase {
        label: "create criterion parented to an already-accepted task proposal",
        run: case_create_criterion_parented_to_an_already_accepted_task,
    },
    CorpusCase {
        label: "create assumption never materialises a canonical row",
        run: case_create_assumption_never_materialises_a_canonical_row,
    },
    CorpusCase { label: "amend a pending task proposal", run: case_amend_task_leaves_every_canonical_count_unchanged },
    CorpusCase { label: "amend a pending epic proposal", run: case_amend_epic_leaves_every_canonical_count_unchanged },
    CorpusCase {
        label: "amend a pending criterion proposal",
        run: case_amend_criterion_leaves_every_canonical_count_unchanged,
    },
    CorpusCase { label: "delete a pre-existing task via a delete proposal", run: case_delete_task_stays_pending_until_accept },
    CorpusCase { label: "delete a pre-existing epic via a delete proposal", run: case_delete_epic_stays_pending_until_accept },
    CorpusCase {
        label: "delete a pre-existing criterion via a delete proposal",
        run: case_delete_criterion_stays_pending_until_accept,
    },
    CorpusCase {
        label: "criterion proposal parented to a still-pending task proposal",
        run: case_criterion_parented_to_a_still_pending_task_proposal,
    },
    CorpusCase {
        label: "amend proposal whose target row is deleted underneath it is undecidable",
        run: case_amend_target_deleted_underneath_it_is_undecidable,
    },
    CorpusCase {
        label: "ordering (a): child criterion accepted before its parent task, third sibling untouched",
        run: case_ordering_child_accepted_before_parent_materialises_parent_exactly_once,
    },
    CorpusCase {
        label: "ordering (b): two siblings sharing the same created_at, only the accepted one materialises",
        run: case_ordering_two_siblings_sharing_created_at_only_the_accepted_one_materialises,
    },
    CorpusCase {
        label: "ordering (c): reject then accept the same proposal is refused, not a second promotion",
        run: case_ordering_reject_then_accept_is_refused_not_a_second_promotion,
    },
    CorpusCase {
        label: "abandoned-run: a pending proposal survives abandonment and a new event is refused",
        run: case_abandoned_run_pending_proposal_survives_and_new_event_is_refused,
    },
];

#[test]
fn corpus_declares_at_least_14_labelled_adversarial_cases() {
    assert!(
        CORPUS.len() >= 14,
        "expected at least 14 labelled corpus cases proving zero canonical rows before triage, found {}",
        CORPUS.len()
    );
}

#[test]
fn every_corpus_case_proves_zero_canonical_rows_before_triage() {
    let mut failures = Vec::new();
    for case in CORPUS {
        if let Err(payload) = std::panic::catch_unwind(case.run) {
            let msg = payload
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| payload.downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "<non-string panic payload>".to_string());
            failures.push(format!("{:?}: {msg}", case.label));
        }
    }
    assert!(failures.is_empty(), "one or more adversarial corpus cases failed:\n  {}", failures.join("\n  "));
}
