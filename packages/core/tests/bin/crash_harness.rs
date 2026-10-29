//! A separate binary spawned by `tests/crash_safety.rs` (DATA-07) to model a real force-quit —
//! this process is killed on purpose, not shut down cooperatively.
//!
//! `--commit-then-hang <db_path> <backups_dir> <n>`: opens the database through the same
//! `open_and_migrate` entry point the desktop app uses, creates a project and `n` Milestones through
//! `domain::milestone::create_milestone` (each call commits its own transaction), prints a `READY`
//! line to stdout and then parks the thread forever. The test only sends SIGKILL after reading
//! `READY`, so every Milestone created up to that point was already durably committed before the kill.
//!
//! `--abort-mid-transaction <db_path> <backups_dir>`: opens one transaction, inserts a Milestone row
//! and its `milestone.created` event by hand (mirroring `create_milestone`'s shape), prints `READY`, and
//! calls `std::process::abort()` before `commit()` — `abort()`, not a clean `exit()`, because the
//! failure being modelled is a crash mid-write, not a graceful shutdown that happens to skip a
//! commit.

use std::io::Write;
use std::path::PathBuf;

use flywheel_core::domain::{actor, milestone, project};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let mode = args
        .get(1)
        .expect("usage: crash_harness <--commit-then-hang|--abort-mid-transaction> <db_path> <backups_dir> [n]");
    let db_path = PathBuf::from(args.get(2).expect("missing db_path argument"));
    let backups_dir = PathBuf::from(args.get(3).expect("missing backups_dir argument"));

    match mode.as_str() {
        "--commit-then-hang" => {
            let n: usize = args
                .get(4)
                .expect("missing n argument for --commit-then-hang")
                .parse()
                .expect("n must be a non-negative integer");

            let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
                .expect("open_and_migrate should succeed");
            let actor_id =
                actor::local_human_actor_id(&conn).expect("local human actor should be seeded");
            let proj = project::create_project(
                &mut conn,
                &actor_id,
                "Crash Harness",
                "/tmp/crash-harness",
                "CRSH",
                "main",
            )
            .expect("create_project should succeed");

            for i in 0..n {
                milestone::create_milestone(
                    &mut conn,
                    &proj.id,
                    &actor_id,
                    &format!("Milestone {i}"),
                    None,
                )
                .expect("create_milestone should succeed");
            }

            println!("READY");
            std::io::stdout().flush().expect("failed to flush stdout");

            loop {
                std::thread::park();
            }
        }
        "--abort-mid-transaction" => {
            let mut conn = flywheel_core::db::open_and_migrate(&db_path, &backups_dir)
                .expect("open_and_migrate should succeed");
            let actor_id =
                actor::local_human_actor_id(&conn).expect("local human actor should be seeded");
            let proj = project::create_project(
                &mut conn,
                &actor_id,
                "Crash Harness",
                "/tmp/crash-harness",
                "CRSH",
                "main",
            )
            .expect("create_project should succeed");

            let tx = conn.transaction().expect("failed to open the transaction");
            let milestone_id = flywheel_core::ids::new_id();
            let event_id = flywheel_core::ids::new_id();
            let now = chrono::Utc::now().to_rfc3339();

            tx.execute(
                "INSERT INTO milestones (
                    id, project_id, title, state, rank, created_by, created_at, updated_at
                ) VALUES (?1, ?2, ?3, 'shaping', ?4, ?5, ?6, ?6)",
                rusqlite::params![
                    milestone_id,
                    proj.id,
                    "mid-transaction Milestone",
                    "a0",
                    actor_id,
                    now
                ],
            )
            .expect("failed to insert the mid-transaction Milestone row");

            tx.execute(
                "INSERT INTO events (
                    id, project_id, origin, sequence, stream_type, stream_id,
                    story_id, epic_id, actor_id, event_type, payload, occurred_at
                ) VALUES (?1, ?2, 'local', 999999, 'milestone', ?3, NULL, NULL, ?4, 'milestone.created', '{}', ?5)",
                rusqlite::params![event_id, proj.id, milestone_id, actor_id, now],
            )
            .expect("failed to insert the mid-transaction event row");

            println!("READY");
            std::io::stdout().flush().expect("failed to flush stdout");

            // The point of this mode: abort before commit(), never call it.
            std::process::abort();
        }
        other => panic!("unknown crash_harness mode {other:?}"),
    }
}
