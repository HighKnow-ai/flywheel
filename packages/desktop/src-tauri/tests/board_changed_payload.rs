//! FNC-07 / F8 — `board:changed` is emitted through ONE helper, and every call says which project
//! it concerns.
//!
//! The renderer routes each event by its `projectId`, so an emitter that skips the helper (and its
//! typed `{ projectId, entity, id }` payload) silently re-creates the always-invalidate behaviour
//! this phase removed. `commands::emit_board_changed` is the only place in the crate that may name
//! the event string, and a caller that does not state its scope is rejected at the call site.
//!
//! Two-sided, in the house style of `handler_roster.rs`: the real tree must be clean, and a planted
//! in-memory violation must be caught, so a walker that visits nothing cannot pass vacuously.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

const EVENT_LITERAL: &str = "\"board:changed\"";
const HELPER_FILE: &str = "src/commands/mod.rs";
const HELPER_CALL: &str = "emit_board_changed(";

/// Every file that calls the helper, sorted, one per line. Listed by name rather than floored by a
/// call-site count, so emits cannot vanish silently (a file that stops calling the helper fails
/// the build) while two PRs that each delete a different command touch different lines and merge
/// without conflict. Add or remove a line in the same diff as a file that gains or loses its emits.
const EMITTING_FILES: &[&str] = &[
    "src/commands/agent_run.rs",
    "src/commands/criterion.rs",
    "src/commands/dispatch.rs",
    "src/commands/epic.rs",
    "src/commands/file_set.rs",
    "src/commands/fleet.rs",
    "src/commands/forge.rs",
    "src/commands/issue.rs",
    "src/commands/task.rs",
    "src/scheduler.rs",
    "src/sidecar.rs",
];

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Every `.rs` file under `dir`, as `(path relative to the crate root, body)`.
fn sources_under(dir: &Path) -> Vec<(String, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display())) {
            let path = entry.expect("dir entry").path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|x| x == "rs") {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths.sort();
    paths
        .into_iter()
        .map(|p| {
            let body = fs::read_to_string(&p).unwrap_or_else(|e| panic!("cannot read {}: {e}", p.display()));
            let rel = p.strip_prefix(manifest_dir()).expect("under the crate").to_string_lossy().replace('\\', "/");
            (rel, body)
        })
        .collect()
}

fn is_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// Files that name the event string in code, other than the helper's own file. Whole-line comments
/// (`//`, `///`, `//!`) are skipped: prose may mention the event.
fn raw_emit_offenders(files: &[(String, String)]) -> Vec<String> {
    files
        .iter()
        .filter(|(path, _)| path != HELPER_FILE)
        .flat_map(|(path, body)| {
            body.lines()
                .enumerate()
                .filter(|(_, line)| !is_comment(line) && line.contains(EVENT_LITERAL))
                .map(move |(n, line)| format!("{path}:{}: {}", n + 1, line.trim()))
        })
        .collect()
}

/// The text between the `(` that ends `HELPER_CALL` at `start` and its matching `)`.
fn call_arguments(body: &str, start: usize) -> Option<&str> {
    let open = start + HELPER_CALL.len();
    let mut depth = 1usize;
    for (i, c) in body[open..].char_indices() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&body[open..open + i]);
                }
            }
            _ => {}
        }
    }
    None
}

/// Top-level comma split: a comma inside nested brackets belongs to an argument.
fn split_arguments(args: &str) -> Vec<&str> {
    let (mut parts, mut depth, mut from) = (Vec::new(), 0i32, 0usize);
    for (i, c) in args.char_indices() {
        match c {
            '(' | '[' | '{' => depth += 1,
            ')' | ']' | '}' => depth -= 1,
            ',' if depth == 0 => {
                parts.push(&args[from..i]);
                from = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&args[from..]);
    parts.into_iter().map(str::trim).filter(|p| !p.is_empty()).collect()
}

/// `(files with at least one call site, call sites seen, offenders)`. A call site is an invocation of the helper — not its definition,
/// not a `use`, not a comment — whose second argument must be a scope the reader can see:
/// a literal `None` (a stated broadcast), a `Some(..)`, or a resolved `project_id.as_deref()`.
fn scope_check(files: &[(String, String)]) -> (BTreeSet<String>, usize, Vec<String>) {
    let (mut emitting, mut sites, mut offenders) = (BTreeSet::new(), 0usize, Vec::new());
    for (path, body) in files {
        let mut line_start = 0usize;
        for (n, line) in body.lines().enumerate() {
            let at = line_start;
            line_start += line.len() + 1;
            if is_comment(line) || line.contains("fn emit_board_changed") || line.trim_start().starts_with("use ") {
                continue;
            }
            let Some(col) = line.find(HELPER_CALL) else { continue };
            sites += 1;
            emitting.insert(path.clone());
            let where_ = format!("{path}:{}", n + 1);
            let Some(args) = call_arguments(body, at + col) else {
                offenders.push(format!("{where_}: unterminated call"));
                continue;
            };
            let parts = split_arguments(args);
            if parts.len() != 4 {
                offenders.push(format!("{where_}: expected 4 arguments (app, project, entity, id), found {}", parts.len()));
                continue;
            }
            let scope = parts[1];
            if !(scope == "None" || scope.starts_with("Some(") || scope.ends_with(".as_deref()")) {
                offenders.push(format!("{where_}: ambiguous project scope `{scope}`"));
            }
        }
    }
    (emitting, sites, offenders)
}

/// `Err` naming every difference between the files that call the helper and `listed`.
fn check_emitting_files(emitting: &BTreeSet<String>, listed: &[&str]) -> Result<(), String> {
    let listed: BTreeSet<String> = listed.iter().map(|s| s.to_string()).collect();
    let unlisted: Vec<&String> = emitting.difference(&listed).collect();
    let missing: Vec<&String> = listed.difference(emitting).collect();
    if unlisted.is_empty() && missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "the files that call `emit_board_changed` and EMITTING_FILES in tests/board_changed_payload.rs \
         disagree; if the change is intended, edit EMITTING_FILES in the same diff.\n\
         calls the helper but not listed: {unlisted:?}\n\
         listed but no longer calls the helper: {missing:?}"
    ))
}

#[test]
fn only_the_emit_helper_names_the_board_changed_event() {
    let files = sources_under(&manifest_dir().join("src"));
    assert!(files.len() > 20, "walked only {} files under src; the walker is broken", files.len());
    let helper = files.iter().find(|(p, _)| p == HELPER_FILE).expect("the helper's file is part of the walk");
    assert!(helper.1.contains(EVENT_LITERAL), "{HELPER_FILE} no longer names the event: the helper moved");

    let offenders = raw_emit_offenders(&files);
    assert!(
        offenders.is_empty(),
        "FNC-07: `commands::emit_board_changed` is the only place that may name the board:changed event, so the \
         renderer can route it by project. Route these through the helper:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn every_emit_helper_call_passes_an_explicit_project_scope() {
    let files = sources_under(&manifest_dir().join("src"));
    let (emitting, sites, offenders) = scope_check(&files);
    assert!(sites >= EMITTING_FILES.len(), "found only {sites} helper call sites; the matcher is broken");
    assert!(
        EMITTING_FILES.windows(2).all(|w| w[0] < w[1]),
        "EMITTING_FILES must stay sorted with no duplicates, one path per line"
    );
    if let Err(e) = check_emitting_files(&emitting, EMITTING_FILES) {
        panic!("{e}");
    }
    assert!(
        offenders.is_empty(),
        "FNC-07: every emit states its project scope — `None` to broadcast, `Some(..)` or a resolved \
         `project_id.as_deref()` otherwise:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn the_emit_gate_fires_on_a_planted_raw_emit() {
    let planted = "\
// a comment that mentions \"board:changed\" is prose, not an emit
pub fn sneaky(app: &tauri::AppHandle) {
    app.emit(\"board:changed\", serde_json::json!({ \"entity\": \"task\" })).ok();
}
";
    let files = vec![("src/commands/planted.rs".to_string(), planted.to_string())];
    let offenders = raw_emit_offenders(&files);
    assert_eq!(offenders.len(), 1, "exactly the code line is an offender: {offenders:?}");

    // The same body inside the helper's own file is the one permitted home.
    let home = vec![(HELPER_FILE.to_string(), planted.to_string())];
    assert!(raw_emit_offenders(&home).is_empty());

    // The scope matcher: a vague scope and a wrong arity are caught, a stated one is not.
    let calls = "\
emit_board_changed(&app, project_id.as_deref(), \"task\", Some(&id));
emit_board_changed(&app, None, \"worktree\", None);
emit_board_changed(&app, Some(pid.as_str()), \"epic\", Some(&id));
emit_board_changed(&app, scope, \"task\", Some(&id));
emit_board_changed(&app, None, \"task\");
";
    let (emitting, sites, offenders) = scope_check(&[("src/planted.rs".to_string(), calls.to_string())]);
    assert_eq!(sites, 5);
    assert_eq!(emitting.into_iter().collect::<Vec<_>>(), vec!["src/planted.rs".to_string()]);
    assert_eq!(offenders.len(), 2, "the vague scope and the three-argument call: {offenders:?}");
}

#[test]
fn the_emitting_files_list_fails_on_an_unlisted_or_a_silent_file() {
    let emitting: BTreeSet<String> = ["src/a.rs", "src/new.rs"].iter().map(|s| s.to_string()).collect();
    let err = check_emitting_files(&emitting, &["src/a.rs", "src/b.rs"]).expect_err("both directions must fail");
    assert!(err.contains("calls the helper but not listed: [\"src/new.rs\"]"), "{err}");
    assert!(err.contains("listed but no longer calls the helper: [\"src/b.rs\"]"), "{err}");
    assert!(check_emitting_files(&emitting, &["src/a.rs", "src/new.rs"]).is_ok());
}
