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
//! Writes through the real domain functions — `project::register_project`, `task::create_task`,
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

use std::os::unix::process::CommandExt as _;

use core::domain::{actor, agent_run, permission_request, project, task};

/// Whether `pid` leads its own process group — the property `kill_orphan`'s `kill(-pid, …)`
/// depends on. Read from `ps` rather than a libc call so the check reports exactly what the OS
/// would tell an operator inspecting the same process by hand.
fn process_is_group_leader(pid: i32) -> bool {
    let output = match std::process::Command::new("ps")
        .args(["-o", "pgid=", "-p", &pid.to_string()])
        .output()
    {
        Ok(output) => output,
        Err(_) => return false,
    };
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<i32>()
        .map(|pgid| pgid == pid)
        .unwrap_or(false)
}

/// OS-sourced process start time in epoch milliseconds, matching what `process_is_alive` compares
/// against (`sysinfo`'s `start_time()` seconds, scaled to ms). Read through the same crate the
/// reconciler uses rather than shelling out to `ps`, so the two cannot disagree by a rounding.
fn process_start_time_ms(pid: i32) -> u64 {
    use sysinfo::{Pid, ProcessesToUpdate, System};
    let sys_pid = Pid::from_u32(pid as u32);
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[sys_pid]), true);
    system
        .process(sys_pid)
        .map(|process| process.start_time().saturating_mul(1000))
        .unwrap_or(0)
}

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

    // `register_project`, NOT `create_project`. `create_project` is the marker-free tracer-era
    // fixture (see its own doc comment): it writes no project marker, so `reconcile_projects` at
    // launch immediately flags the project `unreachable` and the board renders "Can't find this
    // project" instead of whatever this seeding was supposed to put on screen. `register_project`
    // writes the marker, which is what makes the seeded project behave like one the user
    // registered themselves.
    let proj = match project::register_project(
        &mut conn,
        &actor_id,
        std::path::Path::new(&repo_path),
        "UAT Scratch Project",
        "UAT",
    ) {
        Ok(proj) => proj,
        Err(err) => fail(&format!("could not register the project: {err:#}")),
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

    if mode == "orphan" {
        // The recovery modal blocks the board only for a LIVE orphan: `reconcile_agent_runs`
        // requires a run descriptor on disk whose pid AND start time still name a running process
        // (`process_is_alive` — pid-reuse-safe by design). A row that merely says "running" with
        // nothing behind it is classified as abandoned instead, and the board stays reachable.
        // So spawn a real, detached, long-lived process and record it exactly as the adapter would.
        // stdio MUST be detached. A child inheriting this process's stdout keeps the pipe open,
        // and the calling script's `SEED_OUTPUT="$(...)"` command substitution then blocks forever
        // waiting for every writer to close — the seeder appears to hang with no output at all.
        // `process_group(0)` makes the stub its OWN process-group leader, exactly as
        // `claude-code-adapter.ts` does for a real session (`detached: true`). This is not
        // cosmetic: `kill_orphan` signals the GROUP via `libc::kill(-pid, SIGKILL)`, so a stub
        // sharing this process's group means the signal is aimed at a group id that does not
        // exist, the kill silently fails, and the modal reports "Couldn't kill this process" —
        // a harness artefact indistinguishable from a real product defect.
        let child = match std::process::Command::new("/bin/sleep")
            .arg("86400")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0)
            .spawn()
        {
            Ok(child) => child,
            Err(err) => fail(&format!("could not spawn the stand-in orphan process: {err}")),
        };
        let pid = child.id() as i32;

        // Assert the group-leader property rather than trusting it: if this ever regresses, the
        // failure surfaces here as a refusal to seed, not later as a mysterious failed Kill.
        if !process_is_group_leader(pid) {
            fail(&format!(
                "the stand-in orphan process {pid} is not its own process-group leader, so \
                 kill_orphan's group signal would miss it — refusing to seed a modal whose Kill \
                 button cannot work"
            ));
        }

        // Read the start time back from the OS through the same predicate the reconciler uses, so
        // the descriptor can never disagree with what `process_is_alive` will compute.
        let start_time = process_start_time_ms(pid);
        match core::runtime_protocol::write_run_descriptor(&run.id, pid, start_time) {
            core::runtime_protocol::RuntimeIo::Written => {}
            core::runtime_protocol::RuntimeIo::WriteFailed(err) => {
                fail(&format!("could not write the run descriptor: {err}"))
            }
        }
        if !core::runtime_protocol::process_is_alive(pid, start_time) {
            fail(
                "the stand-in orphan process did not read back as alive — the recovery modal \
                 would not appear, so seeding is refused rather than silently useless",
            );
        }
        println!("  orphan:  live stand-in process pid {pid} (sleep 86400)");
    }

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
