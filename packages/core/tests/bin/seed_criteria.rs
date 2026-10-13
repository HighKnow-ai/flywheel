//! Clear probe text off the board's `acceptance_criteria` and seed real criteria on the tasks that
//! have an active worktree (Phase 08.1, D-23).
//!
//! The review surface's criteria rail cannot be designed against emptiness, and every criterion
//! row on the real board was probe text typed into a composer a focus bug had stolen focus into.
//!
//! Writes through the real domain functions — `acceptance_criterion::create_criterion` and
//! `acceptance_criterion::delete_criterion` — never by hand-rolled SQL against that table, so a
//! row this tool touches carries the same event an application-produced one does.
//!
//! Usage: `seed_criteria <delete-probes|seed-worktree-tasks|both> [--i-mean-the-real-database]`.
//! Unlike `uat_seed_ui`, this tool is MEANT to be pointed at the real fleet database, so when
//! `FLYWHEEL_APP_DATA_DIR` is absent it proceeds against the default app-data location only with
//! the explicit flag, and exits non-zero otherwise. The deletion guard is an exact-match
//! allowlist ([`PROBE_STATEMENTS`]); any other row is skipped and named, so a mistyped argument
//! cannot destroy a real criterion.
//!
//! Final line, parsable: `SEEDED <mode> deleted=<n> created=<n>`.

use core::domain::acceptance_criterion::{create_criterion, delete_criterion};
use core::domain::actor::local_human_actor_id;
use rusqlite::Connection;

/// The only statements this tool will delete — the probe text recorded in 08.1-RESEARCH.md
/// Correction 7 (`test` x3, `hello` x1). Compared after trimming, exactly; a statement that merely
/// contains one of these words is real prose and is skipped.
pub const PROBE_STATEMENTS: [&str; 2] = ["test", "hello"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    DeleteProbes,
    SeedWorktreeTasks,
    Both,
}

impl Mode {
    fn name(self) -> &'static str {
        match self {
            Mode::DeleteProbes => "delete-probes",
            Mode::SeedWorktreeTasks => "seed-worktree-tasks",
            Mode::Both => "both",
        }
    }
}

const REAL_DB_FLAG: &str = "--i-mean-the-real-database";

/// Decide whether this invocation is allowed to write anything. `args` excludes argv[0].
/// Refuses with no mode, an unknown mode, or neither a data-directory override nor the explicit
/// real-database flag — the caller exits non-zero before opening any database.
pub fn resolve_invocation(args: &[String], app_data_dir_set: bool) -> Result<Mode, String> {
    let usage = "usage: seed_criteria <delete-probes|seed-worktree-tasks|both> [--i-mean-the-real-database]";
    let mode = match args.iter().find(|a| !a.starts_with("--")).map(String::as_str) {
        Some("delete-probes") => Mode::DeleteProbes,
        Some("seed-worktree-tasks") => Mode::SeedWorktreeTasks,
        Some("both") => Mode::Both,
        Some(other) => return Err(format!("unknown mode {other:?}\n{usage}")),
        None => return Err(usage.to_string()),
    };
    if !app_data_dir_set && !args.iter().any(|a| a == REAL_DB_FLAG) {
        return Err(format!(
            "FLYWHEEL_APP_DATA_DIR is not set — refusing to touch the real fleet database without {REAL_DB_FLAG}"
        ));
    }
    Ok(mode)
}

/// Delete every criterion whose trimmed statement is exactly probe text, through
/// `delete_criterion`. Every other row is skipped with a printed line naming its id.
/// Returns the number deleted.
pub fn delete_probes(conn: &mut Connection, actor_id: &str) -> anyhow::Result<usize> {
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT id, statement FROM acceptance_criteria")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;

    let mut deleted = 0;
    for (id, statement) in rows {
        if PROBE_STATEMENTS.contains(&statement.trim()) {
            delete_criterion(conn, actor_id, &id)?;
            deleted += 1;
        } else {
            println!("skipped {id}: statement is not probe text");
        }
    }
    Ok(deleted)
}

/// Concrete, diff-checkable criteria for the five tasks on the real board that carry an active
/// worktree. Final wording on the first pass: those tasks already have an `agent_runs` row, so
/// their criteria are locked against in-place edits the moment they exist.
const REAL_TASK_CRITERIA: [(&str, &[&str]); 5] = [
    ("THRE-33", &[
        "The epic picker's option list is built once and reused across renders; the diff shows a memoised or cached source, not a rebuild per keystroke.",
        "The cache is invalidated wherever an epic is created, renamed or deleted; the diff contains the invalidation at each of those call sites.",
        "A test asserts the picker returns the same list reference for unchanged input.",
    ]),
    ("THRE-38", &[
        "Each filter chip toggles its filter in the board query state; the diff shows the chip's handler bound to the filter setter.",
        "A chip's active state is exposed with aria-pressed, so assistive tech reads the same state the styling shows.",
        "Deactivating every chip restores the unfiltered board, asserted by a test.",
    ]),
    ("THRE-43", &[
        "After the first load, the event stream is served from a cache; the diff removes the repeated full fetch on each read.",
        "The cache is keyed by project and origin, so one project's events can never surface in another's.",
        "A newly appended event extends the cache in place instead of refetching from sequence zero.",
    ]),
    ("THRE-53", &[
        "The rank allocator keeps the tail rank per parent instead of querying it on every call.",
        "The cached tail is discarded when the surrounding transaction rolls back, so a failed write never leaves a stale rank behind.",
        "Two consecutive allocations under one parent yield strictly increasing ranks, asserted by a test.",
    ]),
    ("THRE-58", &[
        "Tab and Shift+Tab cycle within the dialog; the diff registers the trap handler on open and removes it on close.",
        "Closing the dialog returns focus to the element that held it before it opened.",
        "Initial focus lands on the first focusable control inside the dialog.",
    ]),
];

/// Criteria for a task with no hand-written entry: generic, but each is still checkable in a diff.
fn fallback_criteria(title: &str) -> Vec<String> {
    vec![
        format!("The diff changes the behaviour named by \"{title}\" and leaves unrelated files untouched."),
        "A test added or updated in the diff fails without the change and passes with it.".to_string(),
        "The diff introduces no new lint or type errors.".to_string(),
    ]
}

/// Give every task with an `active` worktree and no criteria its criteria, through
/// `create_criterion`. Idempotent: a task that already carries any criterion is left alone.
/// Returns the number created.
pub fn seed_worktree_tasks(conn: &mut Connection, actor_id: &str) -> anyhow::Result<usize> {
    let tasks: Vec<(String, Option<String>, String, String)> = conn
        .prepare(
            "SELECT t.id, t.key, t.title, t.project_id
             FROM tasks t JOIN worktrees w ON w.task_id = t.id
             WHERE w.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM acceptance_criteria c
                               WHERE c.parent_type = 'task' AND c.parent_id = t.id)
             ORDER BY t.key",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
        .collect::<Result<_, _>>()?;

    let mut created = 0;
    for (task_id, key, title, project_id) in tasks {
        let statements: Vec<String> = match REAL_TASK_CRITERIA.iter().find(|(k, _)| Some(*k) == key.as_deref()) {
            Some((_, list)) => list.iter().map(|s| s.to_string()).collect(),
            None => fallback_criteria(&title),
        };
        for statement in statements {
            // A refusal propagates: it is a finding to report, not something to work around.
            create_criterion(conn, &project_id, actor_id, "task", &task_id, &statement, None)?;
            created += 1;
        }
    }
    Ok(created)
}

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mode = resolve_invocation(&args, std::env::var_os("FLYWHEEL_APP_DATA_DIR").is_some())
        .unwrap_or_else(|message| fail(&message));

    let db_path = core::db::default_db_path().unwrap_or_else(|e| fail(&format!("could not resolve the database path: {e:#}")));
    let backups_dir = core::db::default_backups_dir().unwrap_or_else(|e| fail(&format!("could not resolve the backups directory: {e:#}")));
    let mut conn = core::db::open_and_migrate(&db_path, &backups_dir).unwrap_or_else(|e| fail(&format!("could not open the database: {e:#}")));
    let actor_id = local_human_actor_id(&conn).unwrap_or_else(|e| fail(&format!("could not resolve the local human actor: {e:#}")));

    let mut deleted = 0;
    let mut created = 0;
    if matches!(mode, Mode::DeleteProbes | Mode::Both) {
        deleted = delete_probes(&mut conn, &actor_id).unwrap_or_else(|e| fail(&format!("delete failed: {e:#}")));
    }
    if matches!(mode, Mode::SeedWorktreeTasks | Mode::Both) {
        created = seed_worktree_tasks(&mut conn, &actor_id).unwrap_or_else(|e| fail(&format!("seed failed: {e:#}")));
    }
    println!("SEEDED {} deleted={deleted} created={created}", mode.name());
}
