//! F11 — `generate_handler!` owns the command surface, and a test owns `generate_handler!`.
//!
//! Every `#[tauri::command]` under `src/commands` is an IPC entry point the webview can reach once
//! it is registered, and unreachable until it is. The roster in `main.rs` is the single
//! enforcement point; this gate fails the build if a command is declared but never registered
//! (silently orphaned), or registered under a name that is no command (a stale entry that will not
//! compile, or worse, shadows a rename).
//!
//! `capabilities/default.json` also carries a roster string. It is documentation only: Tauri v2's
//! ACL gates plugin commands, not this app's own `#[tauri::command]` handlers. This gate does not
//! compare against it and never edits it; narrowing a capabilities manifest is its own decision.
//!
//! Two-sided, in the house style of `packages/core/tests/pm_vocabulary_gate.rs`: the real tree must
//! be clean, and a planted in-memory violation must be caught, so an extractor that collects
//! nothing cannot pass vacuously.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

/// `(module, function)`, the shape of a `commands::<module>::<function>` roster entry.
type Command = (String, String);

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Every `#[tauri::command]` function in one module body.
///
/// A command attribute (`#[tauri::command]` or `#[tauri::command(async)]`) names the next `fn`
/// after it, skipping blank lines, doc comments and any other attribute in between. Commented-out
/// code starts with `//`, so it is never read as an attribute or a function.
fn collect_commands(module: &str, body: &str) -> BTreeSet<Command> {
    let mut found = BTreeSet::new();
    let mut armed = false;
    for line in body.lines().map(str::trim) {
        if line.starts_with("#[tauri::command") {
            armed = true;
            continue;
        }
        if !armed || line.is_empty() || line.starts_with("//") || line.starts_with("#[") {
            continue;
        }
        let rest = line.strip_prefix("pub ").unwrap_or(line);
        let rest = rest.strip_prefix("async ").unwrap_or(rest);
        if let Some(sig) = rest.strip_prefix("fn ") {
            let name: String =
                sig.chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
            found.insert((module.to_string(), name));
        }
        armed = false;
    }
    found
}

/// The entries between `generate_handler![` and its closing `]`, comments stripped. An entry that
/// is not `commands::<module>::<function>` comes back as `("?", entry)` so it is reported rather
/// than silently skipped.
fn parse_roster(main_src: &str) -> BTreeSet<Command> {
    let start = main_src.find("generate_handler![").expect("main.rs has no generate_handler![") + "generate_handler![".len();
    let mut text = String::new();
    'lines: for line in main_src[start..].lines() {
        let code = line.split("//").next().unwrap_or("");
        match code.find(']') {
            Some(end) => {
                text.push_str(&code[..end]);
                break 'lines;
            }
            None => {
                text.push_str(code);
                text.push('\n');
            }
        }
    }
    text.split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .map(|entry| {
            let parts: Vec<&str> = entry.split("::").collect();
            match parts.as_slice() {
                ["commands", module, name] => (module.to_string(), name.to_string()),
                _ => ("?".to_string(), entry.to_string()),
            }
        })
        .collect()
}

/// `(declared but not registered, registered but not declared)`.
fn diff(declared: &BTreeSet<Command>, roster: &BTreeSet<Command>) -> (Vec<Command>, Vec<Command>) {
    (
        declared.difference(roster).cloned().collect(),
        roster.difference(declared).cloned().collect(),
    )
}

fn commands_in(dir: &Path) -> BTreeSet<Command> {
    let mut all = BTreeSet::new();
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "rs"))
        .collect();
    files.sort();
    for path in files {
        let module = path.file_stem().expect("file stem").to_string_lossy().to_string();
        if module == "mod" {
            continue; // the module list itself declares no commands
        }
        let body = fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        all.extend(collect_commands(&module, &body));
    }
    all
}

#[test]
fn every_tauri_command_is_registered_in_generate_handler() {
    let declared = commands_in(&manifest_dir().join("src/commands"));
    let main_src = fs::read_to_string(manifest_dir().join("src/main.rs")).expect("read main.rs");
    let roster = parse_roster(&main_src);

    assert!(
        declared.len() > 100,
        "collected only {} commands from src/commands; the extractor is broken, not the roster",
        declared.len()
    );
    assert!(roster.len() > 100, "parsed only {} roster entries; the extractor is broken", roster.len());

    let (missing, orphaned) = diff(&declared, &roster);
    assert!(
        missing.is_empty() && orphaned.is_empty(),
        "main.rs's `generate_handler!` list is the enforcement point for the command surface; \
         `capabilities/default.json`'s roster string is documentation and is not checked here.\n\
         declared with #[tauri::command] but missing from the roster: {missing:?}\n\
         in the roster but naming no #[tauri::command] function: {orphaned:?}"
    );
}

#[test]
fn the_roster_gate_fires_on_a_planted_violation() {
    let body = "\
/// A documented command.
#[tauri::command]
pub fn registered_one(state: u8) {}

#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub async fn registered_two() {}

#[tauri::command]
pub fn forgotten_command() {}

// #[tauri::command]
// pub fn commented_out() {}
";
    let roster_src = "tauri::generate_handler![\n    commands::planted::registered_one,\n    commands::planted::registered_two,\n    // commands::planted::commented_roster_entry,\n]";

    let declared = collect_commands("planted", body);
    assert_eq!(declared.len(), 3, "the extractor must see all three live commands: {declared:?}");

    let (missing, orphaned) = diff(&declared, &parse_roster(roster_src));
    assert_eq!(missing, vec![("planted".to_string(), "forgotten_command".to_string())]);
    assert!(orphaned.is_empty(), "{orphaned:?}");

    // The other direction: a roster entry that names no command is reported exactly once.
    let stale = "generate_handler![ commands::planted::registered_one, commands::planted::ghost ]";
    let (_, orphaned) = diff(&collect_commands("planted", "#[tauri::command]\npub fn registered_one() {}\n"), &parse_roster(stale));
    assert_eq!(orphaned, vec![("planted".to_string(), "ghost".to_string())]);
}
