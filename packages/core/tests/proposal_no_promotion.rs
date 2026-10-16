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
    ProposalProvenance, ProposalTargetType, ProposalUndecidable, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::epic::create_epic;
use core::domain::project::Project;
use core::domain::task::{create_task, delete_task};
use core::ids::new_id;
use core::schema_classification::canonical_tables;
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

/// Each Canonical table paired with the ONE module that owns writes to it (path suffix). A write
/// to a table from any other file is an offender unless it is an exact-statement entry in
/// [`ALLOWED_CANONICAL_UPDATE_SITES`]. Per table, not per file: owning `issues` does not grant
/// `tasks`, which is the hole that let two raw `UPDATE issues` statements sit past this gate.
/// `every_canonical_table_has_exactly_one_owner` fails the build when `TABLE_CLASSES` gains a
/// Canonical table without a row here.
const CANONICAL_TABLE_OWNERS: [(&str, &str); 6] = [
    ("tasks", "src/domain/task.rs"),
    ("epics", "src/domain/epic.rs"),
    ("issues", "src/domain/issue.rs"),
    ("acceptance_criteria", "src/domain/acceptance_criterion.rs"),
    ("criterion_anchors", "src/domain/acceptance_criterion.rs"),
    ("cycles", "src/domain/cycle.rs"),
];

fn owner_of(table: &str) -> Option<&'static str> {
    CANONICAL_TABLE_OWNERS.iter().find(|(t, _)| *t == table).map(|(_, owner)| *owner)
}

/// The lowercase insert-shaped statements that write a row of `table`. The gate matches against
/// whitespace-collapsed, lowercased text, so these are spelled once, in that form.
fn table_insert_patterns(table: &str) -> [String; 3] {
    [
        format!("insert into {table}"),
        format!("insert or replace into {table}"),
        format!("replace into {table}"),
    ]
}

/// Every insert-shaped pattern for every table `core::schema_classification` classifies
/// `Canonical`. DERIVED, not listed (FNC-02): a new canonical table is covered the moment it is
/// classified, and `table_classification.rs` fails the build until it is. This gate does not
/// police `DELETE FROM <table>` — deletion is not a PROMOTION (turning a proposal into new board
/// substance), which is the narrow thing D-100 exists to prove is impossible without triage; each
/// canonical table's own `_in_tx` writer is still the only legitimate place a delete of that
/// table happens, verified separately for `authoring_proposal.rs` by Gate 2 below.
fn canonical_write_patterns() -> Vec<String> {
    canonical_tables().flat_map(table_insert_patterns).collect()
}

/// `update <table> set` for every Canonical table — derived from the same classification, so the
/// UPDATE side is covered by default exactly as the INSERT side is.
fn canonical_update_patterns() -> Vec<String> {
    canonical_tables().map(|table| format!("update {table} set")).collect()
}

/// Whatever is wrong with a derivation: empty tables, or a missing pattern for a table. An empty
/// result is the only healthy one.
fn derivation_gaps(tables: &[&str], inserts: &[String], updates: &[String]) -> Vec<String> {
    let mut gaps = Vec::new();
    if tables.is_empty() || inserts.is_empty() {
        gaps.push("the INSERT side derived nothing, which would turn Gate 1 off".to_string());
    }
    if tables.is_empty() || updates.is_empty() {
        gaps.push("the UPDATE side derived nothing, which would turn Gate 1 off".to_string());
    }
    for table in tables {
        if !inserts.contains(&format!("insert into {table}")) {
            gaps.push(format!("canonical table {table:?} has no INSERT pattern in Gate 1"));
        }
        if !updates.contains(&format!("update {table} set")) {
            gaps.push(format!("canonical table {table:?} has no UPDATE pattern in Gate 1"));
        }
    }
    gaps
}

#[test]
fn the_derived_write_patterns_cover_every_canonical_table() {
    let tables: Vec<&str> = canonical_tables().collect();
    let gaps = derivation_gaps(&tables, &canonical_write_patterns(), &canonical_update_patterns());
    assert!(gaps.is_empty(), "FNC-02: deriving the write patterns from the classification failed:\n  {}", gaps.join("\n  "));
}

#[test]
fn an_empty_derivation_fails_loudly_on_both_sides() {
    let gaps = derivation_gaps(&[], &[], &[]);
    assert!(gaps.iter().any(|g| g.contains("INSERT side") && g.contains("turn Gate 1 off")), "{gaps:?}");
    assert!(gaps.iter().any(|g| g.contains("UPDATE side") && g.contains("turn Gate 1 off")), "{gaps:?}");
    let one_sided = derivation_gaps(&["tasks"], &canonical_write_patterns(), &[]);
    assert!(one_sided.iter().any(|g| g.contains("UPDATE")), "{one_sided:?}");
}

#[test]
fn every_canonical_table_has_exactly_one_owner() {
    let classified: Vec<&str> = canonical_tables().collect();
    for table in &classified {
        let owners = CANONICAL_TABLE_OWNERS.iter().filter(|(t, _)| t == table).count();
        assert_eq!(owners, 1, "canonical table {table:?} must name exactly one owner in CANONICAL_TABLE_OWNERS (found {owners})");
    }
    for (table, owner) in CANONICAL_TABLE_OWNERS {
        assert!(classified.contains(&table), "CANONICAL_TABLE_OWNERS names {table:?} ({owner}), which is not classified Canonical");
    }
}

/// Statements that write past their table's owner on purpose: (path suffix, FULL statement,
/// reason). A hit is exempt only when the statement at that spot is exactly the entry's — a second
/// `UPDATE tasks SET …` in the same file is still an offender — and
/// `every_allowlisted_update_site_still_exists` fails if an entry goes stale. The reasons are also
/// recorded in `.planning/phases/13-nothing-new-escapes-the-fence/13-AUTHORITY-ALLOWLIST.md`, in
/// the same order.
const ALLOWED_CANONICAL_UPDATE_SITES: &[(&str, &str, &str)] = &[
    (
        "src/domain/acceptance_criterion.rs",
        "update tasks set updated_at = ?1 where id = ?2",
        "an `updated_at` touch of the criterion's own parent inside the criterion-check transaction — not a \
     promotion (it creates no board substance) and not a status write (the status column is \
     untouched, and `no_agent_status_write.rs` independently proves that). Refactoring it into \
     `task.rs`/`epic.rs` would add a cross-module call for a timestamp and is deliberately not done.",
    ),
    (
        "src/domain/acceptance_criterion.rs",
        "update epics set updated_at = ?1 where id = ?2",
        "an `updated_at` touch of the criterion's own parent inside the criterion-check transaction — not a \
     promotion (it creates no board substance) and not a status write (the status column is \
     untouched, and `no_agent_status_write.rs` independently proves that). Refactoring it into \
     `task.rs`/`epic.rs` would add a cross-module call for a timestamp and is deliberately not done.",
    ),
    (
        "src/domain/task.rs",
        "update issues set task_id = null, updated_at = ?1 where task_id = ?2",
        "detaching a deleted task's child issues inside the task-delete transaction. Not a promotion (it creates no \
     board substance) and not an issue-content write (title, body, rank and parentage are `issue.rs`'s); \
     routing it through `issue.rs` would add a cross-module call inside the delete transaction for a NULL-out.",
    ),
    (
        "src/domain/epic.rs",
        "update tasks set epic_id = null, updated_at = ?1 where epic_id = ?2",
        "detaching a deleted epic's child tasks inside the epic-delete transaction. Not a promotion (it creates no \
     board substance) and not a status write (the status column is untouched); `tasks.epic_id` is a NO ACTION FK, \
     so the NULL-out must run in the same transaction as the `DELETE FROM epics`. This is the statement the \
     pre-13-13 \"epic.rs owns UPDATE tasks\" file-level rule used to exempt silently.",
    ),
    (
        "src/domain/epic.rs",
        "update issues set epic_id = null, updated_at = ?1 where epic_id = ?2",
        "same as the issue row above, for an epic parent.",
    ),
];

/// Collapse a run of code lines to the form the gate matches on: joined with a space, every run of
/// whitespace one space, lowercased — so `INSERT  INTO\n  tasks` and `insert into tasks` are the
/// same text. Same shape as `priority_is_opt_in.rs` and `no_agent_status_write.rs`.
fn normalise_sql(code_lines: &[&str]) -> String {
    code_lines.join(" ").split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Byte offsets in `normal` where `pattern` starts and ends on an identifier boundary, so
/// `insert into tasks` does not match `insert into tasks_fts`. A bare `replace into` that is the
/// tail of `insert or replace into` is not a second hit.
fn statement_hits(normal: &str, pattern: &str) -> Vec<usize> {
    let is_ident = |c: char| c.is_ascii_alphanumeric() || c == '_';
    normal
        .match_indices(pattern)
        .filter(|(at, _)| {
            let before = normal[..*at].chars().next_back();
            let after = normal[at + pattern.len()..].chars().next();
            !before.is_some_and(is_ident)
                && !after.is_some_and(is_ident)
                && !(pattern.starts_with("replace into") && normal[..*at].ends_with("insert or "))
        })
        .map(|(at, _)| at)
        .collect()
}

/// True when `rest` (normalised text from a hit onward) begins with exactly `statement` and the
/// statement ends there — at the closing quote, a `;`, or the end of the body — not mid-statement.
fn starts_with_exact_statement(rest: &str, statement: &str) -> bool {
    rest.strip_prefix(statement).is_some_and(|tail| tail.chars().next().is_none_or(|c| c == '"' || c == ';'))
}

/// The matcher both the real gate and the planted-violation test drive: every line of `body` (at
/// `path`) that writes a canonical table outside its owner, one offender per line. Matches against
/// whitespace-normalised, lowercased text, so case and line breaks do not hide a statement; a
/// statement split across lines is reported at the line it starts on. Skips whole-line comments
/// and migrations.
fn canonical_write_offenders(path: &str, body: &str) -> Vec<String> {
    if path.contains("/migrations/") {
        // Schema DDL is not an agent-reachable write path — also naturally excluded by
        // `sources_under`'s own rs/ts/tsx extension filter, this is a defensive second line in
        // case a future `.rs`-based migration helper ever lands under that directory.
        return Vec::new();
    }
    let mut normal = String::new();
    let mut line_starts: Vec<(usize, usize)> = Vec::new(); // (byte offset in `normal`, 1-based line)
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        let piece = normalise_sql(&[line]);
        if piece.is_empty() {
            continue;
        }
        if !normal.is_empty() {
            normal.push(' ');
        }
        line_starts.push((normal.len(), n + 1));
        normal.push_str(&piece);
    }
    let line_of = |at: usize| line_starts.iter().rev().find(|(offset, _)| *offset <= at).map_or(0, |(_, n)| *n);

    let mut by_line: std::collections::BTreeMap<usize, String> = std::collections::BTreeMap::new();
    for table in canonical_tables() {
        if owner_of(table).is_some_and(|owner| path.ends_with(owner)) {
            continue;
        }
        for pattern in table_insert_patterns(table) {
            for at in statement_hits(&normal, &pattern) {
                by_line.entry(line_of(at)).or_insert_with(|| pattern.clone());
            }
        }
        let update = format!("update {table} set");
        for at in statement_hits(&normal, &update) {
            let allowed = ALLOWED_CANONICAL_UPDATE_SITES.iter().any(|(suffix, statement, _)| {
                path.ends_with(suffix) && starts_with_exact_statement(&normal[at..], &normalise_sql(&[statement]))
            });
            if !allowed {
                by_line.entry(line_of(at)).or_insert_with(|| update.clone());
            }
        }
    }
    by_line.into_iter().map(|(n, pattern)| format!("{path}:{n}: {pattern}")).collect()
}

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
            offenders.extend(canonical_write_offenders(&path.to_string_lossy(), &body));
        }
    }
    // Sorted so the failure text is identical across filesystem walk orders.
    offenders.sort();

    assert!(
        offenders.is_empty(),
        "an agent-reachable module writes a canonical table directly — PROP-03/D-100 requires \
         every canonical-table write go through its owning domain module's `_in_tx` writer, never \
         a local INSERT/UPDATE. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_canonical_update_gate_fires_on_a_planted_parent_touch() {
    let offenders = |path: &str, body: &str| canonical_write_offenders(path, body).len();
    let touch = "tx.execute(\"UPDATE tasks SET updated_at = ?1 WHERE id = ?2\", params![now, id])?;\n";
    assert_eq!(offenders("packages/core/src/domain/planted.rs", touch), 1, "a raw parent-touch outside the owner must be exactly one offender");
    assert_eq!(offenders("packages/core/src/domain/task.rs", touch), 0, "the owning module is not an offender");
    assert_eq!(offenders("packages/core/src/domain/issue.rs", touch), 1, "owning `issues` does not grant `tasks`");

    // The issue-detach statements are offenders anywhere but their exact allow-list entry.
    let detach = "tx.execute(\"UPDATE issues SET epic_id = NULL, updated_at = ?1 WHERE epic_id = ?2\", params![now, id])?;\n";
    assert_eq!(offenders("packages/core/src/domain/planted.rs", detach), 1);
    assert_eq!(offenders("packages/core/src/domain/issue.rs", detach), 0, "the per-table owner");
    assert_eq!(offenders("packages/core/src/domain/epic.rs", detach), 0, "the allow-listed detach");

    // Case and whitespace do not hide a write.
    let planted = "packages/core/src/domain/planted.rs";
    for body in [
        "tx.execute(\"insert into tasks (id) values (?1)\", [id])?;\n",
        "tx.execute(\"INSERT   INTO   tasks (id) VALUES (?1)\", [id])?;\n",
        "tx.execute(\"INSERT\n  INTO tasks (id) VALUES (?1)\", [id])?;\n",
        "tx.execute(\"INSERT OR REPLACE INTO tasks (id) VALUES (?1)\", [id])?;\n",
        "tx.execute(\"REPLACE INTO tasks (id) VALUES (?1)\", [id])?;\n",
        "tx.execute(\"UPDATE tasks\n  SET status = 'done'\", [])?;\n",
        "tx.execute(\"update tasks set status = 'done'\", [])?;\n",
    ] {
        assert_eq!(offenders(planted, body), 1, "must be exactly one offender: {body:?}");
    }

    // Adjacency: a canonical name that prefixes another identifier is not that table.
    for body in [
        "tx.execute(\"INSERT INTO tasks_fts (rowid) VALUES (?1)\", [id])?;\n",
        "tx.execute(\"INSERT INTO epics_fts (rowid) VALUES (?1)\", [id])?;\n",
        "tx.execute(\"UPDATE epics_fts SET title = ?1\", [t])?;\n",
    ] {
        assert_eq!(offenders(planted, body), 0, "an FTS mirror is not a canonical table: {body:?}");
    }

    // One line holding both an INSERT and an UPDATE is one offender for that line.
    let both = "let _ = (\"INSERT INTO tasks (id) VALUES (1)\", \"UPDATE tasks SET x = 1\");\n";
    assert_eq!(offenders(planted, both), 1, "one offender per line");
    // Comments stay silent.
    assert_eq!(offenders(planted, "// INSERT INTO tasks (id) VALUES (1)\n"), 0);
}

#[test]
fn every_allowlisted_update_site_still_exists() {
    let root = workspace_root();
    for (suffix, statement, reason) in ALLOWED_CANONICAL_UPDATE_SITES {
        assert!(!reason.is_empty(), "allow-list entry ({suffix}, {statement}) records no reason");
        let path = root.join("packages/core").join(suffix);
        let body = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("allow-list entry ({suffix}, {statement}) names a file that does not exist: {e}"));
        let code: Vec<&str> = body.lines().filter(|l| !is_whole_line_comment(l)).collect();
        let normal = normalise_sql(&code);
        let wanted = normalise_sql(&[statement]);
        let occurrences = normal.matches(wanted.as_str()).count();
        assert_eq!(
            occurrences, 1,
            "allow-list entry ({suffix}, {statement}) must match exactly one statement, found {occurrences}: \
             zero means it is stale and would silently widen the gate for the next one; two means a copy \
             of the statement now rides the same exemption"
        );
    }
}

#[test]
fn a_second_statement_in_an_allowlisted_file_is_still_an_offender() {
    let path = "packages/core/src/domain/acceptance_criterion.rs";
    let allowed = "tx.execute(\"UPDATE tasks SET updated_at = ?1 WHERE id = ?2\", params![now, id])?;\n";
    let second = "tx.execute(\"UPDATE tasks SET status = 'done' WHERE id = ?1\", params![id])?;\n";
    assert!(canonical_write_offenders(path, allowed).is_empty(), "the allow-listed statement alone is not an offender");
    let offenders = canonical_write_offenders(path, &format!("{allowed}{second}"));
    assert_eq!(offenders.len(), 1, "only the second statement is an offender: {offenders:?}");
    assert!(offenders[0].contains(":2:"), "the offender is the status statement on line 2: {offenders:?}");
    // A longer statement that merely begins with the allow-listed one is not exempt either.
    let longer = "tx.execute(\"UPDATE tasks SET updated_at = ?1 WHERE id = ?2 AND status = 'done'\", params![now, id])?;\n";
    assert_eq!(canonical_write_offenders(path, longer).len(), 1, "a prefix of the allow-listed statement is not the statement");
}

// --- Gate 2: at most three functions in the staging module reach a canonical writer (PROP-03) ---

/// The canonical-writer `_in_tx` call targets D-100's containment bound applies to (the first nine
/// match `06-02-PLAN.md`'s own enumeration exactly — `delete_criterion_in_tx` is deliberately not
/// in this list for the same reason Gate 1 above does not police deletes: containment here bounds
/// PROMOTION, not deletion). The two priority writers were added by plan 13-06 (D-16, D-17): a
/// priority suggestion is applied by `materialise_proposal` when a human accepts it, and a call
/// from any other function in this module would be an agent-reachable write of the developer's own
/// ordering.
const CANONICAL_WRITER_CALLS: [&str; 11] = [
    "create_task_in_tx(",
    "create_epic_in_tx(",
    "create_criterion_in_tx(",
    "revise_criterion_in_tx(",
    "update_task_in_tx(",
    "update_epic_in_tx(",
    "delete_task_in_tx(",
    "delete_epic_in_tx(",
    "create_issue_in_tx(",
    "set_priority_in_tx(",
    "set_epic_priority_in_tx(",
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
            ProposalPayload::Task { title: "Retry budget ignores the configured value".to_string(), description: None, priority: None },
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
            ProposalPayload::Epic { title: "New epic drafted from a run's finding".to_string(), description: None, priority: None },
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
            ProposalPayload::Task { title: "Parent task, accepted first".to_string(), description: None, priority: None },
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
            ProposalPayload::Criterion { statement: "Retries 3 times before it fails".to_string(), verification_hint: None },
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
            ProposalPayload::Task { title: "Original title".to_string(), description: None, priority: None },
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
            ProposalPayload::Task { title: "Corrected title".to_string(), description: None, priority: None },
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
            ProposalPayload::Epic { title: "Original epic title".to_string(), description: None, priority: None },
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
            ProposalPayload::Epic { title: "Corrected epic title".to_string(), description: None, priority: None },
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
            ProposalPayload::Task { title: "Parent task for amend-criterion case".to_string(), description: None, priority: None },
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
            ProposalPayload::Criterion { statement: "Returns the original statement".to_string(), verification_hint: None },
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
            ProposalPayload::Criterion { statement: "Returns the corrected statement".to_string(), verification_hint: None },
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
            ProposalPayload::Task { title: String::new(), description: None, priority: None },
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
            ProposalPayload::Epic { title: String::new(), description: None, priority: None },
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
            ProposalPayload::Task { title: "Not yet accepted parent".to_string(), description: None, priority: None },
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
                statement: "Shows a draft made before the parent is decided".to_string(),
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
            ProposalPayload::Task { title: "Renamed before the target vanished".to_string(), description: None, priority: None },
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
            ProposalPayload::Task { title: "Parent, not yet accepted".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (task) should succeed");

        let child_a = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Shows child A, accepted".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (criterion A) should succeed");
        let sibling_b = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Shows sibling B, undecided".to_string(), verification_hint: None },
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
            ProposalPayload::Task { title: "First sibling, will be accepted".to_string(), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .expect("create_proposal (first) should succeed");
        let second = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Second sibling, stays pending".to_string(), description: None, priority: None },
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
            ProposalPayload::Task { title: "Rejected, then an accept is attempted anyway".to_string(), description: None, priority: None },
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

// --- Record types that do not exist yet: prd, adr, cycle-assignment (FNC-02, T-13-23) ---
//
// Phases 14-18 add these as proposable targets. Until Phase 16 creates their record tables, the
// proof that none of them reaches a canonical row is that the target type is refused at the staging
// boundary, three independent ways: `ProposalTargetType::from_db_str` has no such variant,
// `ProposalPayload` (the only thing `create_proposal` accepts) cannot express it,
// `apply_proposal_created` ignores an event naming it, and the `target_type` CHECK in migration
// 0015 refuses the row even if every Rust-side parse were bypassed.
//
// Phase 16 flips each case below from "refused at the boundary" to "staged, and requires triage"
// by widening that CHECK and the enum. The assertion every case makes — zero canonical rows before
// triage — is unchanged by that flip; only the route to it changes.

fn prove_target_type_cannot_promote(label: &str, target_type: &str) {
    // 1. The enum the staging path parses a stored or inbound target type with.
    let parse_error = ProposalTargetType::from_db_str(target_type)
        .expect_err(&format!("{label}: the staging vocabulary must not know {target_type:?} yet"));
    assert!(
        parse_error.to_string().contains("unknown proposal target_type"),
        "{label}: expected the unknown-target_type refusal, got {parse_error}"
    );

    // 2. `create_proposal`'s route: it takes a typed `ProposalPayload`, so a payload naming this
    //    kind cannot even be built; the schema CHECK is the second line behind that.
    let payload = serde_json::json!({ "kind": target_type, "title": "Smuggled in as a record type" });
    assert!(
        serde_json::from_value::<ProposalPayload>(payload).is_err(),
        "{label}: ProposalPayload must not parse a {target_type:?} payload"
    );
    with_scratch_runtime_dir(|| {
        let (conn, human_actor_id, project, run_id) = ready_run();
        let before = counts(&conn);
        let refused = conn.execute(
            "INSERT INTO authoring_proposals (
                id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
                parent_proposal_id, position, payload, status, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'create', ?4, NULL, NULL, 'a0', '{}', 'pending', ?5, ?6)",
            params![new_id(), run_id, project.id, target_type, human_actor_id, "2026-01-01T00:00:00Z"],
        );
        let message = refused.expect_err(&format!("{label}: the target_type CHECK must refuse the row")).to_string();
        assert!(message.contains("CHECK"), "{label}: expected a CHECK refusal, got {message}");
        assert_eq!(counts(&conn), before, "{label}: a refused staging row must leave every canonical count unchanged");
    });

    // 3. `apply_proposal_created`'s route: an inbound event naming it is ignored, nothing staged.
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        let before = counts(&conn);
        let event = serde_json::json!({
            "type": "proposal_created",
            "runId": run_id,
            "verb": "create",
            "targetType": target_type,
            "payload": { "kind": target_type, "title": "Smuggled in as a record type" },
            "rationale": "Adversarial: a record type that does not exist yet",
        });
        let outcome = apply_proposal_created(&mut conn, &event).expect("apply_proposal_created should not error");
        assert_eq!(outcome, ProposalOutcome::Ignored, "{label}: the event must be ignored");
        let staged: i64 = conn
            .query_row("SELECT COUNT(*) FROM authoring_proposals", [], |row| row.get(0))
            .expect("failed to count staged proposals");
        assert_eq!(staged, 0, "{label}: nothing may be staged");
        assert_eq!(counts(&conn), before, "{label}: no canonical row may appear");
    });
}

fn case_prd_target_type_cannot_promote() {
    prove_target_type_cannot_promote("a prd target type is refused at the staging boundary and writes no canonical row", "prd");
}

fn case_adr_target_type_cannot_promote() {
    prove_target_type_cannot_promote("an adr target type is refused at the staging boundary and writes no canonical row", "adr");
}

fn case_cycle_assignment_target_type_cannot_promote() {
    prove_target_type_cannot_promote(
        "a cycle_assignment target type is refused at the staging boundary and writes no canonical row",
        "cycle_assignment",
    );
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
    CorpusCase { label: "prd target type cannot promote", run: case_prd_target_type_cannot_promote },
    CorpusCase { label: "adr target type cannot promote", run: case_adr_target_type_cannot_promote },
    CorpusCase { label: "cycle_assignment target type cannot promote", run: case_cycle_assignment_target_type_cannot_promote },
];

#[test]
fn corpus_declares_at_least_14_labelled_adversarial_cases() {
    assert!(
        CORPUS.len() >= 20,
        "expected at least 20 labelled corpus cases proving zero canonical rows before triage, found {}",
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

// --- Gate 6: no SQL statement in the Rust trees interpolates a table name (T-13-22) ---
//
// Scans the same three trees as Gate 1: `packages/core/src`, `packages/desktop/src-tauri/src` and
// `packages/sidecar/src` (Rust files only).
//
// A table name built into SQL with `format!` is one caller-supplied string away from injection.
// A const column list interpolated into a select list is legitimate and does not match this shape:
// only a brace placed right after FROM, INTO, UPDATE or JOIN does.

const TABLE_POSITION_KEYWORDS: [&str; 4] = ["FROM", "INTO", "UPDATE", "JOIN"];

/// `(1-based line, trimmed line)` for every non-comment line, in a file that builds strings with
/// `format!`/`write!`/`writeln!`, where an uppercase table-position keyword is followed by
/// whitespace and then a single `{` (a `{{` is an escaped brace, not an interpolation).
fn interpolated_table_name_lines(body: &str) -> Vec<(usize, String)> {
    if !["format!(", "write!(", "writeln!("].iter().any(|m| body.contains(m)) {
        return Vec::new();
    }
    let mut hits = Vec::new();
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        let bytes = line.as_bytes();
        let hit = TABLE_POSITION_KEYWORDS.iter().any(|keyword| {
            line.match_indices(keyword).any(|(at, _)| {
                let preceded_by_word = at > 0 && (bytes[at - 1].is_ascii_alphanumeric() || bytes[at - 1] == b'_');
                let rest = &line[at + keyword.len()..];
                let after_space = rest.trim_start();
                !preceded_by_word
                    && after_space.len() < rest.len()
                    && after_space.starts_with('{')
                    && !after_space.starts_with("{{")
            })
        });
        if hit {
            hits.push((n + 1, line.trim().to_string()));
        }
    }
    hits
}

#[test]
fn no_sql_statement_interpolates_a_table_name() {
    let root = workspace_root();
    let scan_dirs = [
        root.join("packages/core/src"),
        root.join("packages/desktop/src-tauri/src"),
        root.join("packages/sidecar/src"),
    ];
    let mut offenders = Vec::new();
    let mut scanned = 0;
    for dir in scan_dirs {
        for (path, body) in sources_under(&dir) {
            // `.rs` only: a TypeScript template literal is not a Rust `format!`.
            if path.extension().is_some_and(|e| e == "rs") {
                scanned += 1;
                for (n, line) in interpolated_table_name_lines(&body) {
                    offenders.push(format!("{}:{n}: {line}", path.display()));
                }
            }
        }
    }
    assert!(scanned > 50, "Gate 6 scanned only {scanned} Rust files across the three trees — a broken path would turn it off");
    offenders.sort();
    assert!(
        offenders.is_empty(),
        "a SQL statement interpolates a table name. Write one fully static statement per table \
         (an explicit `match` between them) instead. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_table_name_interpolation_gate_fires_on_a_planted_violation() {
    let planted = "fn q(table: &str) -> String {\n    format!(\"SELECT id FROM {table} WHERE id = ?1\")\n}\n";
    assert_eq!(interpolated_table_name_lines(planted).len(), 1, "the matcher must catch FROM {{table}}");
    // The exact shape `git_identity.rs` had before it was split into two static statements.
    let git_identity = "let t = conn.query_row(\n    &format!(\"SELECT title FROM {title_table} WHERE id = ?1\"),\n    [&id], |r| r.get(0))?;\n";
    assert_eq!(interpolated_table_name_lines(git_identity).len(), 1, "the matcher must catch FROM {{title_table}}");
    for statement in ["INSERT INTO {table} (id)", "UPDATE {table} SET x = 1", "JOIN  {table} ON a = b"] {
        let body = format!("fn q(table: &str) -> String {{ format!(\"{statement}\") }}\n");
        assert_eq!(interpolated_table_name_lines(&body).len(), 1, "the matcher must catch {statement:?}");
    }
    // Shapes this crate uses legitimately must stay silent.
    let silent = [
        "fn q() -> String { format!(\"SELECT {COLUMNS} FROM tasks WHERE id = ?1\") }",
        "fn q() -> String { format!(\"SELECT id FROM tasks WHERE {clause}\") }",
        "fn q() -> String { format!(\"SELECT json FROM events -- {{braces}}\") }",
        "// format!(\"FROM {table}\") in a comment",
    ];
    for body in silent {
        assert!(interpolated_table_name_lines(body).is_empty(), "the matcher must stay silent on {body:?}");
    }
}
