//! FNC-03 (phase 13 plan 09, ROADMAP criterion 2; T-13-41..T-13-44): authority is reachable only
//! from a human.
//!
//! An "authority transition" is a sign-off the developer owns: checking an acceptance criterion,
//! sending reviewed work back, and deciding a staged proposal (accept, merge, reject, defer). Each
//! is enforced in two places at once: the writer reads `actors.type` inside its own write
//! transaction and refuses anything but `'human'` (the behaviour half below), and no agent-reachable
//! module may call the writer at all (the source half below).
//!
//! Both directions are asserted in this one file, on purpose. PROJECT.md's "Two-sided acceptance
//! for any gate change" records why: round ten of the Phase 12 gate work passed every offline test
//! it had and still bricked the product by being right in one direction only. A refusal test that
//! lets an agent through fails; a not-blocked test that locks the human out fails too, and the
//! second is a hard assert here, never a tolerated outcome.
//!
//! Self-contained per this repo's precedent (`pm_vocabulary_gate.rs`): carries its own copies of
//! `workspace_root`/`is_whole_line_comment`/`sources_under`. No env var, `cfg` switch or `#[ignore]`
//! turns anything here off.

mod common;

use std::path::{Path, PathBuf};

use core::domain::acceptance_criterion::{
    check_criterion_with_anchor, create_criterion, toggle_criterion, AnchorInput,
};
use core::domain::actor::{assert_human_actor, assert_human_actor_in_tx, local_human_actor_id, system_actor};
use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    accept_proposal, accept_subtree, create_proposal, defer_proposal, defer_proposals_bulk, merge_proposal,
    reject_proposal, reject_proposals_bulk, MergeTarget, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::task::{create_task, request_changes, set_task_status, ChangesRequestOutcome};
use rusqlite::Connection;

// ============================================================================================
// Behaviour half — every authority writer, both directions
// ============================================================================================

/// Serializes the scratch runtime dir `advance_stage` writes its stage marker into — mirrors the
/// identically-named lock in `proposal_triage_verbs.rs` (a separate static per test binary).
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, and the var is cleared
    // before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

/// Who is asking. `Human` is the seeded local human; the rest are every other way an actor id can
/// be wrong, each of which must be refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Who {
    Human,
    Agent,
    System,
    /// An id present in no `actors` row.
    Unknown,
    /// The empty string — what an absent id degrades to.
    Empty,
}

fn actor_id_for(conn: &Connection, who: Who) -> String {
    match who {
        Who::Human => local_human_actor_id(conn).expect("seeded human actor"),
        Who::Agent => agent_actor_id(conn).expect("seeded agent actor"),
        Who::System => system_actor(conn).expect("seeded system actor").id,
        Who::Unknown => "01ZZZZZZZZZZZZZZZZZZZZZZZZ".to_string(),
        Who::Empty => String::new(),
    }
}

/// What one attempt did: the outcome (error chain rendered) and the board state either side of it.
struct Trial {
    result: Result<(), String>,
    before: String,
    after: String,
}

/// A byte-comparable picture of every table an authority writer can touch: ids, statuses, check
/// flags, timestamps and decision columns, plus event and row counts. Static SQL per table — no
/// table name is ever interpolated.
fn board_state(conn: &Connection) -> String {
    const QUERIES: [&str; 7] = [
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || status || updated_at AS r FROM tasks ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || status || updated_at AS r FROM epics ORDER BY id)",
        "SELECT COUNT(*) FROM issues",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || checked || updated_at || IFNULL(superseded_at, '') AS r FROM acceptance_criteria ORDER BY id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT criterion_id || path || sha AS r FROM criterion_anchors ORDER BY criterion_id)",
        "SELECT COUNT(*) || ':' || IFNULL(group_concat(r, ','), '') FROM (SELECT id || status || IFNULL(decided_by, '') || IFNULL(materialised_id, '') AS r FROM authoring_proposals ORDER BY id)",
        "SELECT COUNT(*) FROM events",
    ];
    QUERIES
        .iter()
        .map(|sql| conn.query_row(sql, [], |row| row.get::<_, String>(0).or_else(|_| row.get::<_, i64>(0).map(|n| n.to_string()))).expect("board_state query"))
        .collect::<Vec<_>>()
        .join(" | ")
}

fn trial(conn: &mut Connection, who: Who, act: impl FnOnce(&mut Connection, &str) -> anyhow::Result<()>) -> Trial {
    let actor = actor_id_for(conn, who);
    let before = board_state(conn);
    let result = act(conn, &actor).map_err(|e| format!("{e:#}"));
    let after = board_state(conn);
    Trial { result, before, after }
}

/// A project with one task carrying one unchecked criterion.
fn criterion_fixture() -> (Connection, String) {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Wire up the focus trap", None).expect("create_task");
    let criterion = create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Focus returns on close.", None)
        .expect("create_criterion");
    (conn, criterion.id)
}

fn run_toggle_criterion(who: Who) -> Trial {
    let (mut conn, criterion_id) = criterion_fixture();
    trial(&mut conn, who, |c, actor| toggle_criterion(c, actor, &criterion_id).map(|_| ()))
}

fn run_check_criterion_with_anchor(who: Who) -> Trial {
    let (mut conn, criterion_id) = criterion_fixture();
    let anchor = AnchorInput { path: "src/dialog.rs".into(), side: "new".into(), line_start: 1, line_end: 2 };
    trial(&mut conn, who, |c, actor| {
        check_criterion_with_anchor(c, actor, &criterion_id, Some(anchor), "abc123").map(|_| ())
    })
}

fn run_request_changes(who: Who) -> Trial {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Wire up the focus trap", None).expect("create_task");
    create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Focus returns on close.", None)
        .expect("create_criterion");
    set_task_status(&mut conn, &human, &task.id, "in_progress").expect("set status");
    trial(&mut conn, who, |c, actor| match request_changes(c, actor, &task.id)? {
        ChangesRequestOutcome::Requested { .. } => Ok(()),
        other => anyhow::bail!("request_changes did not record a decline: {other:?}"),
    })
}

/// One pending task proposal staged by an agent run, plus the project it lives in.
fn staged_task_proposal(title: &str) -> (Connection, String, String) {
    let (mut conn, human, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human).expect("start_authoring_run");
    advance_stage(&mut conn, &run.id, &human).expect("advance_stage");
    let proposal = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: title.to_string(), description: None, priority: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .expect("create_proposal");
    (conn, proposal.id, project.id)
}

fn run_accept_proposal(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, _) = staged_task_proposal("Accept me");
        trial(&mut conn, who, |c, actor| accept_proposal(c, &proposal_id, actor).map(|_| ()))
    })
}

fn run_accept_subtree(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, _) = staged_task_proposal("Accept my subtree");
        trial(&mut conn, who, |c, actor| accept_subtree(c, &proposal_id, actor).map(|_| ()))
    })
}

fn run_reject_proposal(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, _) = staged_task_proposal("Reject me");
        trial(&mut conn, who, |c, actor| reject_proposal(c, &proposal_id, actor, Some("not now")).map(|_| ()))
    })
}

fn run_defer_proposal(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, _) = staged_task_proposal("Defer me");
        trial(&mut conn, who, |c, actor| defer_proposal(c, actor, &proposal_id).map(|_| ()))
    })
}

fn run_merge_proposal(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, project_id) = staged_task_proposal("Merge me");
        let human = local_human_actor_id(&conn).expect("human");
        let target = create_task(&mut conn, &project_id, &human, "The merge target", None).expect("create_task");
        trial(&mut conn, who, |c, actor| {
            merge_proposal(c, actor, &proposal_id, &MergeTarget::Task(target.id.clone())).map(|_| ())
        })
    })
}

fn run_reject_proposals_bulk(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, _) = staged_task_proposal("Bulk reject me");
        trial(&mut conn, who, |c, actor| {
            reject_proposals_bulk(c, actor, &[proposal_id.clone()], None).map(|_| ())
        })
    })
}

fn run_defer_proposals_bulk(who: Who) -> Trial {
    with_scratch_runtime_dir(|| {
        let (mut conn, proposal_id, _) = staged_task_proposal("Bulk defer me");
        trial(&mut conn, who, |c, actor| defer_proposals_bulk(c, actor, &[proposal_id.clone()]).map(|_| ()))
    })
}

/// The authority writers, by function name — the single list both halves of this file are held to.
/// Adding a writer here without a case below (or the reverse) fails
/// `every_authority_writer_has_a_refusal_and_a_not_blocked_case`.
///
/// Accepting an ADR is the one transition ROADMAP criterion 2 names that does not exist yet; it
/// belongs to Phase 16 and must call `assert_human_actor_in_tx` first (see that function's docs).
const AUTHORITY_WRITERS: [&str; 10] = [
    "toggle_criterion",
    "check_criterion_with_anchor",
    "request_changes",
    "accept_proposal",
    "accept_subtree",
    "merge_proposal",
    "reject_proposal",
    "defer_proposal",
    "reject_proposals_bulk",
    "defer_proposals_bulk",
];

/// Declares the case table AND, per writer, the labelled refusal / not-blocked pair — so the two
/// cannot drift apart, and a writer cannot be in the table without both of its tests.
macro_rules! authority_cases {
    ($($writer:ident => $run:ident),* $(,)?) => {
        const TRANSITIONS: &[(&str, fn(Who) -> Trial)] = &[$((stringify!($writer), $run as fn(Who) -> Trial)),*];

        $(
            mod $writer {
                use super::*;

                #[test]
                fn an_agent_is_refused_and_nothing_is_written() {
                    let t = $run(Who::Agent);
                    assert!(t.result.is_err(), "{}: an agent actor must be refused, but the call succeeded", stringify!($writer));
                    assert_eq!(t.before, t.after, "{}: a refused agent call must leave the board byte-for-byte unchanged", stringify!($writer));
                }

                #[test]
                fn a_human_is_not_blocked_and_the_full_effect_lands() {
                    let t = $run(Who::Human);
                    assert!(t.result.is_ok(), "{}: the human must NOT be blocked, got {:?}", stringify!($writer), t.result);
                    assert_ne!(t.before, t.after, "{}: the human's call returned Ok but wrote nothing", stringify!($writer));
                }
            }
        )*
    };
}

authority_cases! {
    toggle_criterion => run_toggle_criterion,
    check_criterion_with_anchor => run_check_criterion_with_anchor,
    request_changes => run_request_changes,
    accept_proposal => run_accept_proposal,
    accept_subtree => run_accept_subtree,
    merge_proposal => run_merge_proposal,
    reject_proposal => run_reject_proposal,
    defer_proposal => run_defer_proposal,
    reject_proposals_bulk => run_reject_proposals_bulk,
    defer_proposals_bulk => run_defer_proposals_bulk,
}

#[test]
fn every_authority_writer_has_a_refusal_and_a_not_blocked_case() {
    let mut in_table: Vec<&str> = TRANSITIONS.iter().map(|(name, _)| *name).collect();
    let mut declared: Vec<&str> = AUTHORITY_WRITERS.to_vec();
    in_table.sort_unstable();
    declared.sort_unstable();
    assert_eq!(in_table, declared, "the case table and AUTHORITY_WRITERS must name the same writers");
    assert_eq!(TRANSITIONS.len(), 10, "a transition was quietly dropped from coverage");
}

/// Every wrong kind of actor, against every writer: refused, board unchanged, message says why.
fn assert_refused_everywhere(who: Who, message_contains: &str) {
    for (name, run) in TRANSITIONS {
        let t = run(who);
        let err = match &t.result {
            Err(e) => e,
            Ok(()) => panic!("{name}: a {who:?} actor must be refused, but the call succeeded"),
        };
        assert!(
            err.contains(message_contains),
            "{name}: a {who:?} actor was refused, but not with the expected reason {message_contains:?}: {err}"
        );
        assert_eq!(t.before, t.after, "{name}: a refused {who:?} call must leave the board unchanged");
    }
}

#[test]
fn the_system_actor_is_refused_not_treated_as_human() {
    assert_refused_everywhere(Who::System, "system");
}

#[test]
fn an_unknown_actor_id_is_refused_as_not_found() {
    assert_refused_everywhere(Who::Unknown, "not found");
}

#[test]
fn an_empty_actor_id_is_refused_as_not_found_never_defaulted_to_the_local_human() {
    assert_refused_everywhere(Who::Empty, "not found");
}

// --- the helper itself, both directions ---

#[test]
fn the_helper_accepts_only_a_human_and_names_what_it_refused() {
    let (mut conn, human, _project) = common::seeded_project();
    let agent = agent_actor_id(&conn).unwrap();
    let system = system_actor(&conn).unwrap().id;

    assert_human_actor(&conn, &human).expect("a human actor must pass");

    let tx = conn.transaction().unwrap();
    assert_human_actor_in_tx(&tx, &human).expect("a human actor must pass inside a transaction");

    let agent_err = format!("{:#}", assert_human_actor_in_tx(&tx, &agent).unwrap_err());
    assert!(agent_err.contains(&agent) && agent_err.contains("agent"), "must name the id and its type: {agent_err}");

    let system_err = format!("{:#}", assert_human_actor_in_tx(&tx, &system).unwrap_err());
    assert!(system_err.contains(&system) && system_err.contains("system"), "must name the id and its type: {system_err}");

    for missing in ["", "no-such-actor"] {
        let err = format!("{:#}", assert_human_actor_in_tx(&tx, missing).unwrap_err());
        assert!(err.contains("not found"), "{missing:?} must be refused as not found: {err}");
    }
}

// ============================================================================================
// Source half — no agent-reachable module calls an authority writer
// ============================================================================================

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
                if path.file_name().is_some_and(|n| n == "node_modules" || n == "dist") {
                    continue;
                }
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs" || e == "ts" || e == "tsx") {
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

const SCAN_ROOTS: [&str; 3] = ["packages/core/src", "packages/desktop/src-tauri/src", "packages/sidecar/src"];

/// A file permitted to call an authority writer, and why. `test_only` means every call must sit
/// below the file's first `#[cfg(test)]` line.
struct AllowedCaller {
    suffix: &'static str,
    reason: &'static str,
    test_only: bool,
}

/// The declaring domain modules and the Tauri command modules that put the act under the human's
/// own control (each resolves the actor server-side with `local_human_actor_id`). Nothing under
/// `packages/sidecar/src` — the process that drives an agent session — is, or may ever be, listed.
const ALLOWED_CALLERS: [AllowedCaller; 7] = [
    AllowedCaller { suffix: "packages/core/src/domain/acceptance_criterion.rs", reason: "declares toggle_criterion / check_criterion_with_anchor", test_only: false },
    AllowedCaller { suffix: "packages/core/src/domain/task.rs", reason: "declares request_changes", test_only: false },
    AllowedCaller { suffix: "packages/core/src/domain/authoring_proposal.rs", reason: "declares the proposal triage writers and their bulk forms", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/criterion.rs", reason: "the human's criterion checkbox", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/review.rs", reason: "the human's review surface: check-with-evidence and decline", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/authoring.rs", reason: "the human's proposal triage verbs", test_only: false },
    AllowedCaller { suffix: "packages/desktop/src-tauri/src/commands/agent_run.rs", reason: "calls only from a #[cfg(test)] fixture that builds a declined task", test_only: true },
];

fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Does `line` call `writer`? A call is `<name>(` with no identifier character before the name, so
/// `accept_proposal_in_tx(` and `foo_accept_proposal(` are not calls to `accept_proposal`.
fn calls(line: &str, writer: &str) -> bool {
    let needle = format!("{writer}(");
    line.match_indices(&needle).any(|(i, _)| !line[..i].chars().next_back().is_some_and(is_ident_char))
}

/// The matcher both the real gate and its planted twin drive. `path` is the full path string.
fn authority_offenders(path: &str, body: &str) -> Vec<String> {
    let allowed = ALLOWED_CALLERS.iter().find(|a| path.ends_with(a.suffix));
    let first_test_line = body.lines().position(|l| l.trim() == "#[cfg(test)]");
    let mut offenders = Vec::new();
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        for writer in AUTHORITY_WRITERS {
            if !calls(line, writer) {
                continue;
            }
            let permitted = match allowed {
                None => false,
                Some(a) if a.test_only => first_test_line.is_some_and(|t| n > t),
                Some(_) => true,
            };
            if !permitted {
                offenders.push(format!("{path}:{}: {}", n + 1, line.trim()));
            }
        }
    }
    offenders
}

/// FNC-03's second place. The database refusal above is the guarantee; this gate is why an agent
/// never gets as far as asking.
///
/// Concurrency (the ordering edge, covered as a backstop rather than a test): the precondition is
/// a per-call, in-transaction read of `actors.type` for the actor THAT CALL names, so when a human
/// and an agent attempt the same transition at once each gets its own verdict from its own actor
/// and arrival order never decides who is refused. Proving that with two real connections needs a
/// scheduled interleaving; `lock_contention.rs` is the existing home if the owner wants it measured.
#[test]
fn no_agent_reachable_module_calls_an_authority_writer() {
    let root = workspace_root();
    let mut offenders = Vec::new();
    for dir in SCAN_ROOTS {
        for (path, body) in sources_under(&root.join(dir)) {
            offenders.extend(authority_offenders(&path.to_string_lossy(), &body));
        }
    }
    assert!(
        offenders.is_empty(),
        "an authority writer is called from a module that is not on the allow-list — FNC-03 keeps \
         sign-off reachable only from the human's own control. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_sidecar_tree_is_scanned_and_nothing_in_it_is_allow_listed() {
    let sidecar = workspace_root().join("packages/sidecar/src");
    assert!(
        !sources_under(&sidecar).is_empty(),
        "packages/sidecar/src (the process that drives an agent session) yielded no source files, \
         which would turn the gate off for the agent's own tree"
    );
    assert!(
        ALLOWED_CALLERS.iter().all(|a| !a.suffix.contains("packages/sidecar/")),
        "no file under packages/sidecar/src may call an authority writer"
    );
    assert!(ALLOWED_CALLERS.iter().all(|a| !a.reason.is_empty()), "every allow-list entry records why it is allowed");
}

#[test]
fn the_authority_gate_fires_on_a_planted_call() {
    let planted = "const outcome = accept_proposal(conn, id, actor);\n";
    assert_eq!(
        authority_offenders("packages/sidecar/src/planted.ts", planted).len(),
        1,
        "a call from outside the allow-list must be exactly one offender"
    );
    // The same body in an allowed file, in a comment, or as a longer identifier is not a call.
    assert!(authority_offenders("packages/desktop/src-tauri/src/commands/authoring.rs", planted).is_empty());
    assert!(authority_offenders("packages/sidecar/src/planted.ts", "// accept_proposal(conn);\n").is_empty());
    assert!(authority_offenders("packages/sidecar/src/planted.ts", "accept_proposal_in_tx(tx);\n").is_empty());
    // A test-only entry is permitted below its `#[cfg(test)]` line and an offender above it.
    let agent_run = "packages/desktop/src-tauri/src/commands/agent_run.rs";
    assert_eq!(authority_offenders(agent_run, "toggle_criterion(c);\n#[cfg(test)]\nmod t {}\n").len(), 1);
    assert!(authority_offenders(agent_run, "#[cfg(test)]\nmod t { fn f() { toggle_criterion(c); } }\n").is_empty());
}
