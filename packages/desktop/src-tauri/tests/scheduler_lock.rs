//! Issue #215: the git-truth ticks never hold the board lock while git runs, and no other code path
//! holds it across a git or process call.
//!
//! Two halves. The behaviour half runs the real tick bodies (`flywheel_core::git_tick`, which the
//! desktop scheduler calls on its cadence) against real worktrees with a stand-in `git` first on
//! `PATH`: a script that passes every call through to the real git, except that the subcommand
//! under test parks until the test opens a gate. While the tick is parked inside git, a board read
//! through the same mutex must complete. The lint half ([`lint`]) reads the source and lists every
//! call made with the board lock held that can reach a git or process spawn.

mod source_lint;
use source_lint as lint;

mod fixture;

use std::collections::HashMap;
use std::path::Path;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use fixture::{board, SlowGit};
use flywheel_core::git_tick;
use rusqlite::Connection;

/// How long a board read may take while a tick is parked in git. Generous: an uncontended read is
/// a millisecond; a read stuck behind the tick waits until the gate opens, which never happens
/// before this has run out.
const READ_DEADLINE: Duration = Duration::from_secs(3);

/// A board read the way an IPC command makes one: lock the shared connection, query, release.
/// `Ok` with the elapsed time when it completes within [`READ_DEADLINE`].
fn board_read(db: &Arc<Mutex<Connection>>) -> Result<Duration, String> {
    let db = Arc::clone(db);
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let start = Instant::now();
        let conn = db.lock().unwrap();
        let _: i64 = conn.query_row("SELECT count(*) FROM stories", [], |r| r.get(0)).unwrap();
        drop(conn);
        let _ = tx.send(start.elapsed());
    });
    rx.recv_timeout(READ_DEADLINE).map_err(|_| format!("a board read waited over {READ_DEADLINE:?} behind the tick"))
}

/// Run `tick` on its own thread while git's `park_on` subcommand is parked, make a board read, then
/// let git go. Returns the read's outcome and what the tick returned.
fn read_while_parked<T: Send + 'static>(
    db: &Arc<Mutex<Connection>>,
    park_on: &str,
    tick: impl FnOnce() -> T + Send + 'static,
) -> (Result<Duration, String>, T) {
    let slow = SlowGit::install(park_on, Duration::from_secs(30));
    let (done_tx, done_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let out = tick();
        let _ = done_tx.send(());
        out
    });
    slow.wait_until_parked(|| done_rx.try_recv().is_ok());
    let read = board_read(db);
    slow.open_gate();
    let out = handle.join().expect("the tick panicked");
    drop(slow);
    (read, out)
}

#[test]
fn a_board_read_completes_while_the_hot_tick_runs_git_across_several_slow_worktrees() {
    let board = board(3);
    let db = Arc::clone(&board.db);
    let ids = board.story_ids.clone();
    let digests: Arc<git_tick::Digests> = Arc::new(Mutex::new(HashMap::new()));
    let tick_digests = Arc::clone(&digests);

    let (read, changed) =
        read_while_parked(&board.db, "log", move || git_tick::git_facts_tick(&db, &ids, &tick_digests, "hot"));

    let waited = read.expect("the read must not wait for the tick's git");
    assert!(waited < READ_DEADLINE);
    // The tick still did its whole job once git let go: every Story was read and digested, and the
    // commits made by hand were noticed and written.
    assert_eq!(digests.lock().unwrap().len(), 3, "every Story's facts were read");
    assert_eq!(changed.len(), 1, "one project changed: {changed:?}");
    let noticed: i64 = board
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT count(*) FROM events WHERE event_type = ?1",
            [flywheel_core::git_facts::EVENT_OUTSIDE_COMMIT],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(noticed, 3, "each worktree's commit made by hand was recorded");
}

#[test]
fn a_board_read_completes_while_the_cold_tick_and_the_fetch_run_git() {
    let board = board(2);
    assert_eq!(git_tick::cold_story_ids(&board.db).len(), 2, "the cold tier tracks every worktree");

    let db = Arc::clone(&board.db);
    let digests: Arc<git_tick::Digests> = Arc::new(Mutex::new(HashMap::new()));
    let (read, _) = read_while_parked(&board.db, "status", move || {
        let ids = git_tick::cold_story_ids(&db);
        git_tick::git_facts_tick(&db, &ids, &digests, "cold")
    });
    read.expect("the read must not wait for the cold tick's git");

    let db = Arc::clone(&board.db);
    let (read, _) = read_while_parked(&board.db, "fetch", move || git_tick::fetch_tick(&db));
    read.expect("the read must not wait for the fetch");
}

/// How long a call blocked on a Story's work lock is watched to show that it waits.
const STILL_WAITING: Duration = Duration::from_millis(500);

/// How long a call may take once the lock is free.
const RELEASED: Duration = Duration::from_secs(20);

/// Run `work` on its own thread; its result arrives on the returned channel.
fn on_a_thread<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> mpsc::Receiver<T> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(work());
    });
    rx
}

/// Issue #220: Merge and Reclaim take the Story's work lock, the one a Start, a Resume, a Request
/// changes, a Drop and a worktree Remove or Recreate hold, so neither runs while another of them is
/// in flight on that Story.
#[test]
fn merge_and_reclaim_wait_for_the_story_work_lock() {
    let board = board(1);
    let story_id = board.story_ids[0].clone();
    let lock = flywheel_desktop_lib::commands::story_work(&story_id);
    let held = lock.lock().unwrap();

    let (path, actor, id) = (board.db_path.clone(), board.actor_id.clone(), story_id.clone());
    let merge = on_a_thread(move || {
        flywheel_desktop_lib::commands::review::merge_with_story_work(&path, &actor, &id, Default::default()).map(|_| ())
    });
    let (path, actor, id) = (board.db_path.clone(), board.actor_id.clone(), story_id.clone());
    let reclaim = on_a_thread(move || {
        flywheel_desktop_lib::commands::fleet::reclaim_with_story_work(&path, &[id], &actor).map(|outcomes| outcomes.len())
    });
    assert!(merge.recv_timeout(STILL_WAITING).is_err(), "Merge ran while the Story's work lock was held");
    assert!(reclaim.recv_timeout(STILL_WAITING).is_err(), "Reclaim ran while the Story's work lock was held");

    drop(held);
    let merged = merge.recv_timeout(RELEASED).expect("Merge ran once the lock was free");
    assert!(merged.is_err(), "the Story is not In review, so Merge refuses");
    let reclaimed = reclaim.recv_timeout(RELEASED).expect("Reclaim ran once the lock was free");
    assert_eq!(reclaimed.expect("the reclaim batch ran"), 1, "one outcome for the one Story");
}

/// A Start and a Merge on one Story never interleave: a Merge sent while the Start is between its
/// Ready check and its launch waits for the Start to finish.
#[test]
fn a_start_racing_a_merge_on_one_story_is_serialised() {
    let board = board(1);
    let story_id = board.story_ids[0].clone();
    board.set_state(&story_id, "ready");

    let (inside_tx, inside_rx) = mpsc::channel();
    let (go_tx, go_rx) = mpsc::channel::<()>();
    let (db, id) = (Arc::clone(&board.db), story_id.clone());
    let start = on_a_thread(move || {
        flywheel_desktop_lib::commands::session::start_ready_story(
            &db,
            &id,
            "",
            move || {
                // Past the Ready check, holding the Story's work lock: park until the test says go.
                inside_tx.send(()).unwrap();
                go_rx.recv().unwrap();
                Err("stopped by the test".to_string())
            },
            |_, _| Ok(()),
            |_, _| Ok(()),
        )
        .map(|_| ())
    });
    inside_rx.recv_timeout(RELEASED).expect("the Start reached its launch");

    let (path, actor, id) = (board.db_path.clone(), board.actor_id.clone(), story_id.clone());
    let merge = on_a_thread(move || {
        flywheel_desktop_lib::commands::review::merge_with_story_work(&path, &actor, &id, Default::default()).map(|_| ())
    });
    assert!(merge.recv_timeout(STILL_WAITING).is_err(), "Merge ran in the middle of a Start on the same Story");

    go_tx.send(()).unwrap();
    let started = start.recv_timeout(RELEASED).expect("the Start finished");
    assert_eq!(started.unwrap_err(), "stopped by the test");
    let merged = merge.recv_timeout(RELEASED).expect("Merge ran once the Start was done");
    assert!(merged.is_err(), "the Story is not In review, so Merge refuses");
}

/// The source tree the lint reads: the desktop crate and the core crate, stripped.
fn tree() -> Vec<(String, String)> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = lint::sources(&manifest.join("src"), "packages/desktop/src-tauri/src");
    files.extend(lint::sources(&manifest.join("../../core/src"), "packages/core/src"));
    files.into_iter().map(|(p, t)| (p, lint::strip(&t))).collect()
}

fn report(files: &[(String, String)]) -> Vec<String> {
    let spawning = lint::blocking_names(files);
    lint::holders(files, &spawning).iter().map(|h| format!("{h}  [{}]", lint::chain(&spawning, &h.callee))).collect()
}

#[test]
fn no_code_path_holds_the_board_lock_across_a_git_or_process_call() {
    let listed = report(&tree());
    assert!(
        listed.is_empty(),
        "{} calls reach git, a process or a blocking wait with the board lock held. Read what the call needs under the \
         lock, release it, and run the rest with no connection or on a connection of its own:\n{}",
        listed.len(),
        listed.join("\n")
    );
}

/// Every name the lint leaves out of its fixpoint is a real collision in today's tree: without the
/// entry, the name would count as spawning. An entry that no longer collides is dead and goes.
#[test]
fn every_name_left_out_of_the_fixpoint_is_a_real_collision() {
    let files = tree();
    for (name, why) in lint::NOT_A_SPAWN {
        let others: Vec<&str> = lint::NOT_A_SPAWN.iter().map(|(n, _)| *n).filter(|n| n != name).collect();
        assert!(
            lint::spawning_names_skipping(&files, &others).contains_key(*name),
            "`{name}` ({why}) no longer collides with a spawning function: remove it from NOT_A_SPAWN"
        );
    }
}

/// The lint is not vacuous: each shape of lock holder, planted in an in-memory file, is caught, and
/// the same calls made after the guard is released are not.
#[test]
fn the_lint_catches_every_shape_of_lock_holder_and_passes_the_released_ones() {
    let planted = r#"
        fn spawns(repo: &Path) -> Output { Command::new("git").arg("-C").arg(repo).output().unwrap() }
        fn reads_git(conn: &Connection) -> String { spawns(Path::new(".")); String::new() }
        fn guard_of(db: &Mutex<Connection>) -> Option<MutexGuard<'_, Connection>> { db.lock().ok() }

        fn bound_guard(state: &AppState) {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            reads_git(&conn);
        }
        fn let_else_guard(state: &AppState) {
            let Ok(conn) = state.db.lock() else { return };
            reads_git(&conn);
        }
        fn temporary_guard(db: &Mutex<Connection>) {
            let lock = || db.lock().map_err(|_| anyhow!("gone"));
            let plan = reads_git(&*lock()?);
        }
        fn guard_parameter(conn: MutexGuard<'_, Connection>) {
            reads_git(&conn);
        }
        fn helper_guard(db: &Mutex<Connection>) {
            let Some(conn) = guard_of(db) else { return };
            reads_git(&conn);
        }
        fn direct_spawn(state: &AppState) {
            let conn = state.db.lock().unwrap();
            Command::new("open").spawn();
        }
        fn if_let_guard(state: &AppState) {
            if let Ok(conn) = state.db.lock() {
                reads_git(&conn);
            }
        }
        fn guard_after_a_block(state: &AppState, quick: bool) {
            if quick {
                return;
            }
            let conn = state.db.lock().unwrap();
            reads_git(&conn);
        }
        fn match_guard(state: &AppState) -> String {
            match state.db.lock() {
                Ok(conn) => reads_git(&conn),
                Err(_) => String::new(),
            }
        }

        fn released_by_drop(state: &AppState) {
            let conn = state.db.lock().unwrap();
            let path = conn.path();
            drop(conn);
            reads_git(path);
        }
        fn released_by_block(state: &AppState) {
            let plan = {
                let conn = state.db.lock().unwrap();
                conn.path()
            };
            reads_git(plan);
        }
    "#;
    let files = vec![("planted.rs".to_string(), lint::strip(planted))];
    let listed = report(&files);
    let mut holders: Vec<&str> = listed.iter().map(|l| l.split_whitespace().nth(1).unwrap()).collect();
    holders.dedup();
    assert_eq!(
        holders,
        [
            "bound_guard",
            "let_else_guard",
            "temporary_guard",
            "guard_parameter",
            "helper_guard",
            "direct_spawn",
            "if_let_guard",
            "guard_after_a_block",
            "match_guard"
        ],
        "{listed:#?}"
    );
}
