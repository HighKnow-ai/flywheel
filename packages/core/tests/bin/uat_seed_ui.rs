//! Seed a scratch database into the exact precondition state one of the two VISUAL phase-03 UAT
//! items needs, so the only remaining human act is looking at the window.
//!
//! UAT items 2 and 4 are the two that a script genuinely cannot decide: item 2 asks whether the
//! orphan-recovery modal actually BLOCKS the board (that Escape and click-outside do nothing, that
//! paint is blocked), and item 4 asks whether the destructive card RENDERS correctly (glyph,
//! consequence sentence, button emphasis). Both are judgements about pixels. What a script can do
//! is remove every other obstacle: stand the real application up, against a scratch database that
//! is already in the state that forces the thing under inspection onto the screen.
//!
//! Writes through the real domain functions — `project::create_project`, `task::create_task`,
//! `agent_run::start_agent_run`, `permission_request::create_pending_request` — never by hand-
//! rolled SQL, so a seeded row is indistinguishable from one the application itself produced and
//! cannot drift from the schema.
//!
//! Usage: `uat_seed_ui <mode> <repo_path>` where mode is `orphan` or `destructive`.
//! `FLYWHEEL_APP_DATA_DIR` decides which database is written; this binary refuses to run without
//! it, because seeding the developer's real fleet database with fake rows would be a genuinely
//! destructive accident.
//!
//! Prints a short human-readable summary of what it seeded, then a final line
//! `SEEDED <mode> <run_id>` for a script to parse.

use std::path::PathBuf;

use core::domain::{actor, agent_run, permission_request, project, task};

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args.get(1).map(String::as_str).unwrap_or("");
    let repo_path = args.get(2).cloned().unwrap_or_default();

    if !matches!(mode, "orphan" | "destructive") {
        fail("usage: uat_seed_ui <orphan|destructive> <repo_path>");
    }
    if repo_path.is_empty() {
        fail("usage: uat_seed_ui <orphan|destructive> <repo_path>");
    }
    // Refusing rather than defaulting: the default would be the developer's real fleet database.
    if std::env::var_os("FLYWHEEL_APP_DATA_DIR").is_none() {
        fail(
            "FLYWHEEL_APP_DATA_DIR is not set — refusing to seed fake rows into the real fleet \
             database. Point it at a scratch directory.",
        );
    }

    let db_path: PathBuf = match core::db::default_db_path() {
        Ok(path) => path,
        Err(err) => fail(&format!("could not resolve the database path: {err:#}")),
    };
    let backups_dir = match core::db::default_backups_dir() {
        Ok(path) => path,
        Err(err) => fail(&format!("could not resolve the backups directory: {err:#}")),
    };

    let mut conn = match core::db::open_and_migrate(&db_path, &backups_dir) {
        Ok(conn) => conn,
        Err(err) => fail(&format!("could not open the database: {err:#}")),
    };

    let actor_id = match actor::local_human_actor_id(&conn) {
        Ok(id) => id,
        Err(err) => fail(&format!("could not resolve the local human actor: {err:#}")),
    };

    let proj = match project::create_project(
        &mut conn,
        &actor_id,
        "UAT Scratch Project",
        &repo_path,
        "UAT",
        "main",
    ) {
        Ok(proj) => proj,
        Err(err) => fail(&format!("could not create the project: {err:#}")),
    };

    let title = match mode {
        "orphan" => "Orphaned run — recovery modal should block the board",
        _ => "Destructive request — the gate card should render",
    };
    let task = match task::create_task(&mut conn, &proj.id, &actor_id, title, None) {
        Ok(task) => task,
        Err(err) => fail(&format!("could not create the task: {err:#}")),
    };

    // `start_agent_run` leaves the run in a running state with a worktree attached. For the orphan
    // mode that IS the precondition: a run the database believes is running, with no live process
    // behind it, is exactly what launch reconciliation must surface rather than silently resume.
    let run = match agent_run::start_agent_run(&mut conn, &task.id, "bypassPermissions", &actor_id)
    {
        Ok(run) => run,
        Err(err) => fail(&format!("could not start the agent run: {err:#}")),
    };

    if mode == "destructive" {
        // A push-shaped branch deletion specifically: 03-UI-SPEC's consequence sentence for this
        // family must name the deleted BRANCH rather than the remote, which is the exact detail
        // UAT item 4 asks a human to confirm on screen (and which 03-16 fixed).
        let input = r#"{"command":"git push origin --delete feature/doomed"}"#;
        if let Err(err) = permission_request::create_pending_request(
            &mut conn,
            &run.id,
            "Bash",
            Some(input),
            &actor_id,
            Some("branch-deletion"),
        ) {
            fail(&format!("could not create the pending permission request: {err:#}"));
        }
    }

    println!("Seeded database: {}", db_path.display());
    println!("  project: {} ({})", proj.name, proj.id);
    println!("  task:    {} ({})", title, task.id);
    println!("  run:     {} (running)", run.id);
    match mode {
        "orphan" => println!(
            "  state:   a run the database believes is running with no live process behind it — \
             launch reconciliation must surface it rather than resume it"
        ),
        _ => println!(
            "  state:   a pending branch-deletion permission request on that run — the \
             destructive-variant card must render for it"
        ),
    }
    println!("SEEDED {mode} {}", run.id);
}
