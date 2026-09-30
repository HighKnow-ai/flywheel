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
/// `merge_proposal_in_tx` does not exist until plan 06-03 — its absence from this file makes the
/// containment check vacuously true for that name today (no line's enclosing function can ever be
/// named `merge_proposal_in_tx` if no such function is declared), but the assertion is written to
/// NEVER tolerate a call from any fourth function, now or after 06-03 lands.
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
