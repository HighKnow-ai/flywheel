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

/// The `generate_handler!` roster (D-14), as `module::function`, sorted, one per line. Listed by
/// name rather than pinned by count so the IPC surface cannot grow or shrink silently (a stray
/// `*_set_status` writer, or a lost command, fails the build) while two PRs that each delete a
/// different command touch different lines and merge without conflict. Add or remove a line in the
/// same diff as any intended change to the roster.
const ROSTER: &[&str] = &[
    "actor::actor_list",
    "criterion::check_remove",
    "criterion::check_set",
    "criterion::criterion_accept",
    "criterion::criterion_amend",
    "criterion::criterion_create",
    "criterion::criterion_delete",
    "criterion::criterion_list",
    "criterion::criterion_unaccept",
    "epic::epic_create",
    "epic::epic_list",
    "epic::epic_set_state",
    "epic::epic_update",
    "events::board_visit",
    "events::events_activity_trail",
    "events::events_since_cursor",
    "fleet::fleet_blocked_queue",
    "fleet::fleet_list",
    "fleet::fleet_waiting_rounds",
    "fleet::fleet_watch_run",
    "fleet::worktree_inventory",
    "fleet::worktree_measure",
    "fleet::worktree_reclaim",
    "git_identity::git_identifier_resolve",
    "git_truth::git_facts",
    "git_truth::git_truth_focus_story",
    "menu::menu_set_action_enabled",
    "project::project_hide",
    "project::project_list",
    "project::project_reconcile",
    "project::project_register",
    "project::project_relocate",
    "project::project_restore",
    "proposal::proposal_accept",
    "proposal::proposal_amend",
    "proposal::proposal_list_for_story",
    "proposal::proposal_list_pending",
    "proposal::proposal_reject",
    "review::story_merge",
    "review::story_review",
    "roadmap::milestone_create",
    "roadmap::milestone_list",
    "roadmap::milestone_move",
    "roadmap::milestone_progress",
    "roadmap::milestone_set_state",
    "roadmap::milestone_update",
    "roadmap_round::epic_confirm_done",
    "roadmap_round::milestone_confirm_done",
    "roadmap_round::roadmap_revisit",
    "roadmap_round::roadmap_round_dismiss",
    "roadmap_round::roadmap_round_read",
    "session::board_blocked_summary",
    "session::board_recovery_summary",
    "session::orphan_kill",
    "session::permission_rule_revoke",
    "session::permission_rules_list",
    "session::session_acknowledge",
    "session::session_acknowledge_many",
    "session::session_answer_permission",
    "session::session_answer_question",
    "session::session_discard",
    "session::session_get",
    "session::session_log_window",
    "session::session_pending_permissions",
    "session::session_raw_window",
    "session::session_start",
    "session::session_stop",
    "session::sessions_for_story",
    "session::sessions_pending_orphans",
    "session::story_latest_session",
    "session::story_resume",
    "session::story_session_summaries",
    "session::story_start",
    "session::story_stopped",
    "session::worktree_forget_record",
    "session::worktree_recreate",
    "session::worktree_remove",
    "session::worktree_remove_check",
    "session::worktree_summary",
    "settings::backend_capability_probe",
    "settings::launch_environment",
    "settings::settings_clear_api_key",
    "settings::settings_get",
    "settings::settings_set_credential_mode",
    "settings::settings_set_notifications_enabled",
    "settings::settings_store_api_key",
    "shaping::epic_shape",
    "shaping::epic_shaping_rounds",
    "shaping::epic_shaping_session",
    "shaping::milestone_shape",
    "shaping::milestone_shaping_continue",
    "shaping::milestone_shaping_rounds",
    "shaping::milestone_shaping_session",
    "shaping::round_accept",
    "shaping::round_accept_all",
    "shaping::round_answer",
    "shaping::shaping_continue",
    "shaping::stage_close",
    "story::story_context_packet_size",
    "story::story_create",
    "story::story_drop",
    "story::story_get",
    "story::story_list",
    "story::story_list_for_project",
    "story::story_set_state",
    "story::story_update",
    "story::story_write_by_hand",
    "task::task_add",
    "task::task_list",
    "task::task_move",
    "task::task_rename",
    "task::task_set_note",
    "task::task_set_state",
    "worktree_open::open_command_template",
    "worktree_open::set_open_command_template",
    "worktree_open::worktree_open",
];

/// `Err` naming every difference between `roster` and `listed`, in both directions: a command the
/// roster registers that `listed` lacks, and a `listed` name the roster no longer registers.
fn check_roster_list(roster: &BTreeSet<Command>, listed: &[&str]) -> Result<(), String> {
    let roster: BTreeSet<String> = roster.iter().map(|(m, f)| format!("{m}::{f}")).collect();
    let listed: BTreeSet<String> = listed.iter().map(|s| s.to_string()).collect();
    let unlisted: Vec<&String> = roster.difference(&listed).collect();
    let missing: Vec<&String> = listed.difference(&roster).collect();
    if unlisted.is_empty() && missing.is_empty() {
        return Ok(());
    }
    Err(format!(
        "the `generate_handler!` roster and ROSTER in tests/handler_roster.rs disagree; if the change \
         is intended, edit ROSTER in the same diff.\n\
         registered but not listed in ROSTER: {unlisted:?}\n\
         listed in ROSTER but not registered: {missing:?}"
    ))
}

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

    assert!(ROSTER.len() > 50, "ROSTER lists {} commands; a list that small means it was truncated", ROSTER.len());
    assert!(ROSTER.windows(2).all(|w| w[0] < w[1]), "ROSTER must stay sorted with no duplicates, one name per line");
    if let Err(e) = check_roster_list(&roster, ROSTER) {
        panic!("{e}");
    }

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

fn roster_of(names: &[&str]) -> BTreeSet<Command> {
    let entries: Vec<String> = names.iter().map(|n| format!("commands::{n}")).collect();
    parse_roster(&format!("generate_handler![{}]", entries.join(", ")))
}

#[test]
fn the_roster_list_fails_on_an_unlisted_command() {
    let err = check_roster_list(&roster_of(&["planted::a", "planted::b", "planted::extra"]), &["planted::a", "planted::b"])
        .expect_err("an unlisted command must fail");
    assert!(err.contains("registered but not listed in ROSTER: [\"planted::extra\"]"), "{err}");
}

#[test]
fn the_roster_list_fails_on_a_missing_command() {
    let err = check_roster_list(&roster_of(&["planted::a"]), &["planted::a", "planted::gone"])
        .expect_err("a listed command that is no longer registered must fail");
    assert!(err.contains("listed in ROSTER but not registered: [\"planted::gone\"]"), "{err}");
}

#[test]
fn the_roster_list_passes_on_an_exact_match() {
    assert!(check_roster_list(&roster_of(&["planted::a", "planted::b"]), &["planted::a", "planted::b"]).is_ok());
}
