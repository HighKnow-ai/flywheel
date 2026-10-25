//! Issue #220: no IPC command runs git or another process on the thread IPC dispatches it on.
//!
//! A sync `#[tauri::command]` runs on the main thread, and an async one's body runs on the thread
//! that polls it, so git there holds up every other IPC call for as long as it runs. Two halves:
//! - the behaviour half drives `needs_you_list` and a second command on ONE thread, standing in
//!   for the dispatch thread, while a stand-in `git` parks the first one's git call. The second
//!   command must complete while the first is still parked: its git runs on the blocking pool;
//! - the lint half ([`lint::commands_on_the_ipc_thread`]) lists every command that reaches git or
//!   a process other than inside a `spawn_blocking(..)` argument.

mod fixture;
mod source_lint;
use source_lint as lint;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use desktop_lib::state::AppState;
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
            let items = desktop_lib::commands::needs_you::needs_you_list(state.clone(), board.project_id.clone()).await;
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
            let stories = desktop_lib::commands::story::story_list(state.clone(), board.epic_id.clone());
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

/// The source tree the lint reads: the desktop crate and the core crate, stripped.
fn tree() -> Vec<(String, String)> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = lint::sources(&manifest.join("src"), "packages/desktop/src-tauri/src");
    files.extend(lint::sources(&manifest.join("../../core/src"), "packages/core/src"));
    files.into_iter().map(|(p, t)| (p, lint::strip(&t))).collect()
}

fn report(files: &[(String, String)]) -> Vec<String> {
    let spawning = lint::spawning_names(files);
    lint::commands_on_the_ipc_thread(files, &spawning)
        .iter()
        .map(|c| format!("{c}  [{}]", lint::chain(&spawning, &c.callee)))
        .collect()
}

#[test]
fn no_command_runs_git_or_a_process_on_the_thread_ipc_dispatches_it_on() {
    let listed = report(&tree());
    assert!(
        listed.is_empty(),
        "{} commands run git or a process on the thread IPC dispatches them on. Make the command \
         async and run that work inside `tauri::async_runtime::spawn_blocking(..)`:\n{}",
        listed.len(),
        listed.join("\n")
    );
}

/// The lint is not vacuous: a sync command and an async one that spawn where they are dispatched
/// are caught, and the same work handed to `spawn_blocking` or done before any spawn is not.
#[test]
fn the_lint_catches_a_command_that_spawns_on_its_dispatch_thread() {
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
    "#;
    let files = vec![("planted.rs".to_string(), lint::strip(planted))];
    let spawning = lint::spawning_names(&files);
    let mut commands: Vec<String> =
        lint::commands_on_the_ipc_thread(&files, &spawning).into_iter().map(|c| c.command).collect();
    commands.dedup();
    assert_eq!(commands, ["sync_reads_git", "async_reads_git_inline", "sync_spawns_itself"], "{:#?}", report(&files));
}
