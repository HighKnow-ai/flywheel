//! Shared by `scheduler_lock.rs` and `command_threads.rs`: a board backed by real worktrees, and a
//! stand-in `git` first on `PATH` that passes every call to the real git, except that the
//! subcommand under test parks until the test opens a gate.

// Each test target uses part of this.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::{epic, milestone, project, story};
use rusqlite::{params, Connection};

/// How long a call may take to reach the parked subcommand.
pub const PARK_DEADLINE: Duration = Duration::from_secs(30);

/// `PATH` is process-wide: the tests that install a [`SlowGit`] take turns.
static PATH_LOCK: Mutex<()> = Mutex::new(());

pub fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("spawn git");
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

fn real_git() -> PathBuf {
    let out = Command::new("sh")
        .args(["-c", "command -v git"])
        .output()
        .expect("find git");
    PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
}

/// A stand-in `git`, first on `PATH` while it lives: every call is the real git's, except that a
/// call whose subcommand is `park_on` writes `parked` and waits for the gate (at most
/// `park_for`) before running. Holds the `PATH` turn for its whole life.
pub struct SlowGit {
    dir: tempfile::TempDir,
    old_path: String,
    _turn: MutexGuard<'static, ()>,
}

impl SlowGit {
    pub fn install(park_on: &str, park_for: Duration) -> Self {
        let turn = PATH_LOCK.lock().unwrap_or_else(|p| p.into_inner());
        let dir = tempfile::tempdir().unwrap();
        let polls = park_for.as_millis() / 50;
        let script = format!(
            "#!/bin/sh\n\
             # git -C <dir> <subcommand> ...\n\
             if [ \"$3\" = \"{park_on}\" ]; then\n\
               : > '{parked}'\n\
               n=0\n\
               while [ ! -e '{gate}' ] && [ $n -lt {polls} ]; do sleep 0.05; n=$((n+1)); done\n\
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
        SlowGit {
            dir,
            old_path,
            _turn: turn,
        }
    }

    /// Whether a call has reached the parked subcommand.
    pub fn parked(&self) -> bool {
        self.dir.path().join("parked").exists()
    }

    /// Wait until a call reaches the parked subcommand, failing if `finished` says the caller
    /// returned first or [`PARK_DEADLINE`] passes.
    pub fn wait_until_parked(&self, finished: impl Fn() -> bool) {
        let start = Instant::now();
        while !self.parked() {
            assert!(
                !finished(),
                "the call finished without ever reaching the parked git call"
            );
            assert!(
                start.elapsed() < PARK_DEADLINE,
                "the call never reached the parked git call"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    pub fn open_gate(&self) {
        std::fs::write(self.dir.path().join("gate"), "").unwrap();
    }
}

impl Drop for SlowGit {
    fn drop(&mut self) {
        self.open_gate();
        std::env::set_var("PATH", &self.old_path);
    }
}

/// A board with one project (a real repository with a local bare `origin`) and Stories, each with a
/// real worktree on its own branch, one commit made by hand, and a `worktrees` row.
pub struct Board {
    pub root: tempfile::TempDir,
    pub db: Arc<Mutex<Connection>>,
    pub db_path: PathBuf,
    pub project_id: String,
    pub epic_id: String,
    pub actor_id: String,
    pub story_ids: Vec<String>,
}

impl Board {
    /// Put `story_id` in `state` directly: the fixtures need a Story In review or Ready without
    /// walking it there.
    pub fn set_state(&self, story_id: &str, state: &str) {
        self.db
            .lock()
            .unwrap()
            .execute(
                "UPDATE stories SET state = ?1 WHERE id = ?2",
                params![state, story_id],
            )
            .unwrap();
    }
}

pub fn board(stories: usize) -> Board {
    let root = tempfile::tempdir().unwrap();
    let origin = root.path().join("origin.git");
    let repo = root.path().join("repo");
    git(
        root.path(),
        &[
            "init",
            "--bare",
            "--initial-branch",
            "main",
            origin.to_str().unwrap(),
        ],
    );
    std::fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "--initial-branch", "main"]);
    git(
        &repo,
        &["config", "user.email", "scheduler-lock@flywheel.invalid"],
    );
    git(&repo, &["config", "user.name", "Scheduler Lock Test"]);
    std::fs::write(repo.join("README.md"), "scheduler lock\n").unwrap();
    git(&repo, &["add", "README.md"]);
    git(&repo, &["commit", "-m", "initial commit"]);
    git(
        &repo,
        &["remote", "add", "origin", origin.to_str().unwrap()],
    );
    git(&repo, &["push", "-u", "origin", "main"]);

    let db_path = root.path().join("flywheel.db");
    let mut conn =
        flywheel_core::db::open_and_migrate(&db_path, &root.path().join("backups")).unwrap();
    let actor_id = local_human_actor_id(&conn).unwrap();
    let project = project::create_project(
        &mut conn,
        &actor_id,
        "Lock",
        &repo.to_string_lossy(),
        "LCK",
        "main",
    )
    .unwrap();
    let m = milestone::create_milestone(&mut conn, &project.id, &actor_id, "M", None).unwrap();
    let e = epic::create_epic(&mut conn, &actor_id, &m.id, "E").unwrap();

    let mut story_ids = Vec::new();
    for n in 0..stories {
        let s = story::create_story(&mut conn, &actor_id, &e.id, &format!("Story {n}")).unwrap();
        let branch = format!("flywheel/lck-{n}");
        let path = root.path().join(format!("wt-{n}"));
        git(
            &repo,
            &[
                "worktree",
                "add",
                path.to_str().unwrap(),
                "-b",
                &branch,
                "main",
            ],
        );
        std::fs::write(path.join(format!("hand-{n}.txt")), "by hand\n").unwrap();
        git(&path, &["add", "."]);
        git(&path, &["commit", "-m", "by hand"]);
        conn.execute(
            "INSERT INTO worktrees (id, story_id, project_id, path, branch, base_branch, status, created_by, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'main', 'active', ?6, '2026-01-01T00:00:00.000Z')",
            params![flywheel_core::ids::new_id(), s.id, project.id, path.to_string_lossy(), branch, actor_id],
        )
        .unwrap();
        story_ids.push(s.id);
    }
    Board {
        root,
        db: Arc::new(Mutex::new(conn)),
        db_path,
        project_id: project.id,
        epic_id: e.id,
        actor_id,
        story_ids,
    }
}
