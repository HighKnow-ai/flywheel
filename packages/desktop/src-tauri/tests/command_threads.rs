//! Issues #220 and #235: no IPC command runs git, another process or a blocking wait on the thread
//! IPC dispatches it on.
//!
//! A sync `#[tauri::command]` runs on the main thread, and an async one's body runs on the thread
//! that polls it, so git or a sleep there holds up every other IPC call for as long as it lasts.
//! Two halves:
//! - the behaviour half drives a command and a second one on ONE thread, standing in for the
//!   dispatch thread: `needs_you_list` while a stand-in `git` parks its git call, and `epic_shape`
//!   while it waits out the sidecar's spawn floor. The second command must complete meanwhile;
//! - the lint half ([`lint::commands_on_the_ipc_thread`]) lists every command that reaches git, a
//!   process or a blocking wait ([`lint::blocks_directly`]) other than inside a
//!   `spawn_blocking(..)` argument.

mod fixture;
mod source_lint;
use source_lint as lint;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use flywheel_desktop_lib::state::AppState;
use fixture::{board, SlowGit, PARK_DEADLINE};
use tauri::Manager;

/// How long the parked git call waits for the gate before going on by itself: long enough that a
/// command waiting behind it is plainly waiting.
const PARK_FOR: Duration = Duration::from_secs(10);

#[test]
fn another_command_completes_while_needs_you_list_waits_on_a_slow_git() {
    let board = board(1);
    let story_id = board.story_ids[0].clone();
    // In review: the Needs-you list asks git whether the Story still merges cleanly, starting with
    // the worktree's head (`git rev-parse HEAD`).
    board.set_state(&story_id, "in_review");

    let app = tauri::test::mock_app();
    let conn = rusqlite::Connection::open(&board.db_path).unwrap();
    flywheel_core::db::apply_pragmas(&conn).unwrap();
    app.manage(AppState {
        db: Mutex::new(conn),
        sidecar: None,
        pending_orphans: Mutex::new(Vec::new()),
        focused_story: Mutex::new(None),
        watched_run: Mutex::new(None),
    });

    let slow = SlowGit::install("rev-parse", PARK_FOR);
    let needs_you_done = AtomicBool::new(false);
    // One thread drives both commands, as the dispatch thread would.
    let dispatch = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let (items, (other, needs_you_was_parked)) = dispatch.block_on(async {
        let state = app.state::<AppState>();
        let needs_you = async {
            let items = flywheel_desktop_lib::commands::needs_you::needs_you_list(state.clone(), board.project_id.clone()).await;
            needs_you_done.store(true, Ordering::SeqCst);
            items
        };
        let other = async {
            let start = Instant::now();
            while !slow.parked() {
                assert!(!needs_you_done.load(Ordering::SeqCst), "needs_you_list never reached git");
                assert!(start.elapsed() < PARK_DEADLINE, "needs_you_list never reached git");
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            let stories = flywheel_desktop_lib::commands::story::story_list(state.clone(), board.epic_id.clone());
            let still_parked = !needs_you_done.load(Ordering::SeqCst);
            slow.open_gate();
            (stories, still_parked)
        };
        tokio::join!(needs_you, other)
    });

    assert!(needs_you_was_parked, "the other command waited for needs_you_list's git to finish");
    assert_eq!(other.expect("the other command answered").len(), 1);
    let items = items.expect("needs_you_list answered once git let go");
    assert!(
        items.iter().any(|item| item.kind == "review" && item.id == story_id),
        "the Story In review is on the list: {:?}",
        items.iter().map(|i| (&i.kind, &i.id)).collect::<Vec<_>>()
    );
}

/// The spawn floor the shaping test runs with: long enough that a command waiting behind it is
/// plainly waiting.
const FLOOR: Duration = Duration::from_secs(4);

/// Issue #235: while a shaping launch waits out the sidecar's spawn floor, another command answers.
#[test]
fn another_command_completes_while_a_shaping_launch_waits_out_the_spawn_floor() {
    let board = board(0);
    // Any executable stands in for `claude`: the launch only checks that it exists.
    std::env::set_var("FLYWHEEL_CLAUDE_BIN", "/usr/bin/true");

    let app = tauri::test::mock_app();
    let conn = rusqlite::Connection::open(&board.db_path).unwrap();
    flywheel_core::db::apply_pragmas(&conn).unwrap();
    app.manage(AppState {
        db: Mutex::new(conn),
        sidecar: Some(flywheel_desktop_lib::sidecar::SidecarHandle::without_process(
            flywheel_core::git_retry::SpawnFloor::with_floor(FLOOR),
        )),
        pending_orphans: Mutex::new(Vec::new()),
        focused_story: Mutex::new(None),
        watched_run: Mutex::new(None),
    });

    let launched = AtomicBool::new(false);
    let dispatch = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let (second, (other, launch_was_waiting)) = dispatch.block_on(async {
        // The first launch takes the repository's turn; with no sidecar behind the handle its
        // request then fails, which closes its session and leaves the Epic free to shape again.
        let first = flywheel_desktop_lib::commands::shaping::epic_shape(app.handle().clone(), board.epic_id.clone()).await;
        assert!(first.unwrap_err().contains("not running"), "the first launch reached the sidecar");

        let started = Instant::now();
        let second = async {
            let out = flywheel_desktop_lib::commands::shaping::epic_shape(app.handle().clone(), board.epic_id.clone()).await;
            launched.store(true, Ordering::SeqCst);
            (out, started.elapsed())
        };
        let other = async {
            tokio::time::sleep(Duration::from_millis(200)).await;
            let state = app.state::<AppState>();
            let stories = flywheel_desktop_lib::commands::story::story_list(state, board.epic_id.clone());
            (stories, !launched.load(Ordering::SeqCst))
        };
        tokio::join!(second, other)
    });

    assert!(launch_was_waiting, "the other command waited for the shaping launch's spawn floor");
    assert!(other.is_ok(), "the other command answered: {other:?}");
    let (second, waited) = second;
    assert!(second.unwrap_err().contains("not running"), "the second launch went on to the sidecar");
    assert!(waited >= FLOOR - Duration::from_millis(500), "the second launch waited out the floor: {waited:?}");
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
    lint::commands_on_the_ipc_thread(files, &spawning)
        .iter()
        .map(|c| format!("{c}  [{}]", lint::chain(&spawning, &c.callee)))
        .collect()
}

#[test]
fn no_command_runs_git_a_process_or_a_blocking_wait_on_the_thread_ipc_dispatches_it_on() {
    let listed = report(&tree());
    assert!(
        listed.is_empty(),
        "{} commands run git, a process or a blocking wait (a sleep, a channel or thread wait) on the thread IPC dispatches them on. Make the command \
         async and run that work inside `tauri::async_runtime::spawn_blocking(..)`:\n{}",
        listed.len(),
        listed.join("\n")
    );
}

/// The lint is not vacuous: a sync command and an async one that spawn where they are dispatched
/// are caught, and the same work handed to `spawn_blocking` or done before any spawn is not.
#[test]
fn the_lint_catches_a_command_that_spawns_or_waits_on_its_dispatch_thread() {
    let planted = r#"
        fn spawns(repo: &Path) -> Output { Command::new("git").arg("-C").arg(repo).output().unwrap() }
        fn reads_git(path: &Path) -> String { spawns(path); String::new() }
        fn offloads(path: PathBuf) { tauri::async_runtime::spawn_blocking(move || reads_git(&path)); }

        #[tauri::command]
        pub fn sync_reads_git(path: String) -> String { reads_git(Path::new(&path)) }

        #[tauri::command]
        pub async fn async_reads_git_inline(path: String) -> String { reads_git(Path::new(&path)) }

        #[tauri::command]
        pub fn sync_spawns_itself(path: String) {
            std::process::Command::new("open").arg(path).spawn();
        }

        #[tauri::command(async)]
        pub async fn async_offloads(path: String) -> Result<String, String> {
            tauri::async_runtime::spawn_blocking(move || reads_git(Path::new(&path))).await.map_err(|e| e.to_string())
        }

        #[tauri::command]
        pub fn sync_calls_a_helper_that_offloads(path: String) { offloads(PathBuf::from(path)) }

        #[tauri::command]
        pub fn sync_reads_the_board(state: State<AppState>) -> usize { 0 }

        fn waits_its_turn(floor: Duration) { std::thread::sleep(floor) }
        fn waits_for_an_ack(rx: Receiver<()>) { let _ = rx.recv_timeout(Duration::from_secs(5)); }
        fn awaits_an_event(rx: &mut UnboundedReceiver<()>) { async { rx.recv().await }; }
        fn joins_words(words: &[&str]) -> String { words.join(", ") }

        #[tauri::command]
        pub fn sync_sleeps_through_a_floor() { waits_its_turn(Duration::from_millis(400)) }

        #[tauri::command]
        pub async fn async_waits_for_an_ack(rx: Receiver<()>) { waits_for_an_ack(rx) }

        #[tauri::command]
        pub fn sync_joins_a_thread(handle: JoinHandle<()>) { handle.join(); }

        #[tauri::command]
        pub async fn async_offloads_the_floor() -> Result<(), String> {
            tauri::async_runtime::spawn_blocking(|| waits_its_turn(Duration::from_millis(400))).await.map_err(|e| e.to_string())
        }

        #[tauri::command]
        pub async fn async_awaits_and_joins_words(rx: UnboundedReceiver<()>) -> String {
            awaits_an_event(&mut rx);
            joins_words(&["a", "b"])
        }
    "#;
    let files = vec![("planted.rs".to_string(), lint::strip(planted))];
    let spawning = lint::blocking_names(&files);
    let mut commands: Vec<String> =
        lint::commands_on_the_ipc_thread(&files, &spawning).into_iter().map(|c| c.command).collect();
    commands.dedup();
    assert_eq!(
        commands,
        [
            "sync_reads_git",
            "async_reads_git_inline",
            "sync_spawns_itself",
            "sync_sleeps_through_a_floor",
            "async_waits_for_an_ack",
            "sync_joins_a_thread"
        ],
        "{:#?}",
        report(&files)
    );
}

/// Every name left out of the blocking fixpoint is a real collision in today's tree: without the
/// entry, the name would count as blocking. An entry that no longer collides is dead and goes.
#[test]
fn every_name_left_out_of_the_blocking_fixpoint_is_a_real_collision() {
    let files = tree();
    for (name, why) in lint::NOT_BLOCKING {
        let others: Vec<&str> =
            lint::NOT_A_SPAWN.iter().chain(lint::NOT_BLOCKING).map(|(n, _)| *n).filter(|n| n != name).collect();
        assert!(
            lint::blocking_names_skipping(&files, &others).contains_key(*name),
            "`{name}` ({why}) no longer collides with a blocking function: remove it from NOT_BLOCKING"
        );
    }
}
