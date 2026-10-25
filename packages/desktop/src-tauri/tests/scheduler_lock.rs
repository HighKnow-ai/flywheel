//! Issue #215: the git-truth ticks never hold the board lock while git runs, and no other code path
//! holds it across a git or process call.
//!
//! Two halves. The behaviour half runs the real tick bodies (`flywheel_core::git_tick`, which the
//! desktop scheduler calls on its cadence) against real worktrees with a stand-in `git` first on
//! `PATH`: a script that passes every call through to the real git, except that the subcommand
//! under test parks until the test opens a gate. While the tick is parked inside git, a board read
//! through the same mutex must complete. The lint half ([`lint`]) reads the source and lists every
//! call made with the board lock held that can reach a git or process spawn.

#[path = "scheduler_lock/lint.rs"]
mod lint;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::{epic, milestone, project, story};
use flywheel_core::git_tick;
use rusqlite::{params, Connection};

/// How long a board read may take while a tick is parked in git. Generous: an uncontended read is
/// a millisecond; a read stuck behind the tick waits until the gate opens, which never happens
/// before this has run out.
const READ_DEADLINE: Duration = Duration::from_secs(3);

/// How long the tick may take to reach the parked subcommand.
const PARK_DEADLINE: Duration = Duration::from_secs(30);

/// `PATH` is process-wide: the two behaviour tests take turns.
static PATH_LOCK: Mutex<()> = Mutex::new(());

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("spawn git");
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
}

fn real_git() -> PathBuf {
    let out = Command::new("sh").args(["-c", "command -v git"]).output().expect("find git");
    PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
}

/// A stand-in `git`, first on `PATH`: every call is the real git's, except that a call whose
/// subcommand is `park_on` writes `parked` and waits for `gate` to exist before running.
struct SlowGit {
    dir: tempfile::TempDir,
    old_path: String,
}

impl SlowGit {
    fn install(park_on: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let script = format!(
            "#!/bin/sh\n\
             # git -C <dir> <subcommand> ...\n\
             if [ \"$3\" = \"{park_on}\" ]; then\n\
               : > '{parked}'\n\
               n=0\n\
               while [ ! -e '{gate}' ] && [ $n -lt 600 ]; do sleep 0.05; n=$((n+1)); done\n\
             fi\n\
             exec '{real}' \"$@\"\n",
            parked = dir.path().join("parked").display(),
            gate = dir.path().join("gate").display(),
            real = real_git().display(),
        );
        let bin = dir.path().join("git");
        std::fs::write(&bin, script).unwrap();
        Command::new("chmod").arg("+x").arg(&bin).status().unwrap();
        let old_path = std::env::var("PATH").unwrap_or_default();
        std::env::set_var("PATH", format!("{}:{old_path}", dir.path().display()));
        SlowGit { dir, old_path }
    }

    fn wait_until_parked(&self, done: &mpsc::Receiver<()>) {
        let start = Instant::now();
        while !self.dir.path().join("parked").exists() {
            assert!(done.try_recv().is_err(), "the tick finished without ever reaching the parked git call");
            assert!(start.elapsed() < PARK_DEADLINE, "the tick never reached the parked git call");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn open_gate(&self) {
        std::fs::write(self.dir.path().join("gate"), "").unwrap();
    }
}

impl Drop for SlowGit {
    fn drop(&mut self) {
        self.open_gate();
        std::env::set_var("PATH", &self.old_path);
    }
}

/// A board with one project (a real repository with a local bare `origin`) and `stories` Stories,
/// each with a real worktree on its own branch, one commit made by hand, and a `worktrees` row.
struct Board {
    _root: tempfile::TempDir,
    db: Arc<Mutex<Connection>>,
    story_ids: Vec<String>,
}

fn board(stories: usize) -> Board {
    let root = tempfile::tempdir().unwrap();
    let origin = root.path().join("origin.git");
    let repo = root.path().join("repo");
    git(root.path(), &["init", "--bare", "--initial-branch", "main", origin.to_str().unwrap()]);
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "--initial-branch", "main"]);
    git(&repo, &["config", "user.email", "scheduler-lock@flywheel.invalid"]);
    git(&repo, &["config", "user.name", "Scheduler Lock Test"]);
    std::fs::write(repo.join("README.md"), "scheduler lock\n").unwrap();
    git(&repo, &["add", "README.md"]);
    git(&repo, &["commit", "-m", "initial commit"]);
    git(&repo, &["remote", "add", "origin", origin.to_str().unwrap()]);
    git(&repo, &["push", "-u", "origin", "main"]);

    let mut conn =
        flywheel_core::db::open_and_migrate(&root.path().join("flywheel.db"), &root.path().join("backups")).unwrap();
    let actor = local_human_actor_id(&conn).unwrap();
    let project =
        project::create_project(&mut conn, &actor, "Lock", &repo.to_string_lossy(), "LCK", "main").unwrap();
    let m = milestone::create_milestone(&mut conn, &project.id, &actor, "M", None).unwrap();
    let e = epic::create_epic(&mut conn, &actor, &m.id, "E").unwrap();

    let mut story_ids = Vec::new();
    for n in 0..stories {
        let s = story::create_story(&mut conn, &actor, &e.id, &format!("Story {n}")).unwrap();
        let branch = format!("flywheel/lck-{n}");
        let path = root.path().join(format!("wt-{n}"));
        git(&repo, &["worktree", "add", path.to_str().unwrap(), "-b", &branch, "main"]);
        std::fs::write(path.join(format!("hand-{n}.txt")), "by hand\n").unwrap();
        git(&path, &["add", "."]);
        git(&path, &["commit", "-m", "by hand"]);
        conn.execute(
            "INSERT INTO worktrees (id, story_id, project_id, path, branch, base_branch, status, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'main', 'active', ?6, '2026-01-01T00:00:00.000Z')",
            params![flywheel_core::ids::new_id(), s.id, project.id, path.to_string_lossy(), branch, actor],
        )
        .unwrap();
        story_ids.push(s.id);
    }
    Board { _root: root, db: Arc::new(Mutex::new(conn)), story_ids }
}

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
    let _turn = PATH_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let slow = SlowGit::install(park_on);
    let (done_tx, done_rx) = mpsc::channel();
    let handle = std::thread::spawn(move || {
        let out = tick();
        let _ = done_tx.send(());
        out
    });
    slow.wait_until_parked(&done_rx);
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

/// The source tree the lint reads: the desktop crate and the core crate, stripped.
fn tree() -> Vec<(String, String)> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let mut files = lint::sources(&manifest.join("src"), "packages/desktop/src-tauri/src");
    files.extend(lint::sources(&manifest.join("../../core/src"), "packages/core/src"));
    files.into_iter().map(|(p, t)| (p, lint::strip(&t))).collect()
}

fn report(files: &[(String, String)]) -> Vec<String> {
    let spawning = lint::spawning_names(files);
    lint::holders(files, &spawning).iter().map(|h| format!("{h}  [{}]", lint::chain(&spawning, &h.callee))).collect()
}

#[test]
fn no_code_path_holds_the_board_lock_across_a_git_or_process_call() {
    let listed = report(&tree());
    assert!(
        listed.is_empty(),
        "{} calls reach git or a process with the board lock held. Read what the call needs under the \
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
