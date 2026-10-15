//! Phase 14 plan 14-03 (VIS-06, criterion 5): the demonstration board is fit to judge on.
//!
//! These cases seed a board with the real `demo_board` binary and assert what no fixture board
//! could satisfy: the folded progress equals an independent full count on the seeded data, and the
//! lead epic is a plan file that exists on disk. The binary is RUN, not called as a library, so the
//! seeding code path under test is exactly the one `scripts/demo-board.sh` uses, and each seed gets
//! its own `FLYWHEEL_APP_DATA_DIR` through the child's environment instead of a process-global one.
//!
//! The phase is pinned to 14 (second argument) so a later `STATE.md` does not move the board under
//! these assertions. Boards are seeded once per role and shared: a seed takes several seconds.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

use core::domain::cycle::{active_cycle, cycle_roster};
use core::domain::epic::list_epics;
use core::query::cycle_progress::cycle_progress;
use rusqlite::{params, Connection};

/// What an epic title may never BE once its plan key and any trailing number are removed: the
/// shapes a fixture board is built from ("Epic 3", "Test epic"). Whole-name equality, because a real
/// plan title may legitimately start with one of these words ("epic status derived from...").
const PLACEHOLDER_TITLES: [&str; 11] =
    ["epic", "test", "test epic", "untitled", "placeholder", "dummy", "foo", "sample", "sample epic", "fixture", "junk"];

const PINNED_PHASE: &str = "14";

struct Board {
    db: PathBuf,
    line: String,
}

impl Board {
    fn conn(&self) -> Connection {
        let conn = Connection::open(&self.db).expect("open the seeded database");
        core::db::apply_pragmas(&conn).expect("apply pragmas");
        conn
    }

    /// `key=value` pairs of the final `SEEDED` line.
    fn printed(&self) -> HashMap<String, String> {
        self.line
            .split_whitespace()
            .skip(1)
            .filter_map(|pair| pair.split_once('='))
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    fn project_id(&self) -> String {
        self.conn().query_row("SELECT id FROM projects", [], |r| r.get(0)).expect("one project")
    }
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(2).expect("workspace root").to_path_buf()
}

fn run_seeder(root: &Path, app_data: &Path, worktrees: &Path, phase: Option<&str>) -> std::process::Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_demo_board"));
    cmd.arg(root);
    if let Some(phase) = phase {
        cmd.arg(phase);
    }
    cmd.env("FLYWHEEL_APP_DATA_DIR", app_data).env("FLYWHEEL_WORKTREE_ROOT", worktrees);
    cmd.output().expect("spawn demo_board")
}

fn scratch() -> PathBuf {
    let dir = tempfile::tempdir().expect("scratch dir");
    let path = dir.path().to_path_buf();
    std::mem::forget(dir);
    path
}

fn seed() -> Board {
    let (data, worktrees) = (scratch(), scratch());
    let out = run_seeder(&repo_root(), &data, &worktrees, Some(PINNED_PHASE));
    assert!(out.status.success(), "demo_board failed: {}", String::from_utf8_lossy(&out.stderr));
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let line = stdout.lines().rev().find(|l| l.starts_with("SEEDED ")).expect("a SEEDED line").to_string();
    Board { db: data.join("flywheel.db"), line }
}

fn shared() -> &'static Board {
    static BOARD: OnceLock<Board> = OnceLock::new();
    BOARD.get_or_init(seed)
}

fn rows(conn: &Connection, sql: &str) -> Vec<String> {
    let mut stmt = conn.prepare(sql).expect("prepare");
    let n = stmt.column_count();
    stmt.query_map([], |row| {
        Ok((0..n).map(|i| row.get::<_, Option<String>>(i).ok().flatten().unwrap_or_default()).collect::<Vec<_>>().join("|"))
    })
    .expect("query")
    .map(|r| r.expect("row"))
    .collect()
}

/// Everything a person sees, with no id in it: ids come from the domain writers' own ULIDs.
fn fingerprint(conn: &Connection) -> Vec<String> {
    let order = "ORDER BY CAST(substr(key, instr(key, '-') + 1) AS INTEGER)";
    let mut all = Vec::new();
    for sql in [
        format!("SELECT key, state, rank, goal FROM cycles {order}"),
        format!(
            "SELECT e.key, e.title, e.status, e.rank, IFNULL(c.key, '-') FROM epics e \
             LEFT JOIN cycles c ON c.id = e.cycle_id {}",
            order.replace("key", "e.key")
        ),
        format!(
            "SELECT t.key, t.title, t.status, t.rank, e.key FROM tasks t JOIN epics e ON e.id = t.epic_id {}",
            order.replace("key", "t.key")
        ),
        format!("SELECT key, title, kind, rank FROM issues {order}"),
        "SELECT t.key, ar.status FROM agent_runs ar JOIN tasks t ON t.id = ar.task_id ORDER BY t.key, ar.status".to_string(),
    ] {
        all.extend(rows(conn, &sql));
    }
    all
}

#[test]
fn the_board_carries_every_state_class_at_its_floor() {
    let board = shared();
    let printed = board.printed();
    let conn = board.conn();
    let project = board.project_id();

    // The seeder's own printed counts, each at least one...
    for class in [
        "running", "blocked", "failed", "completed", "abandoned", "awaiting_review",
        "proposals_pending", "commits_ahead", "dirty", "merged",
    ] {
        let n: usize = printed.get(class).unwrap_or_else(|| panic!("no {class} in {}", board.line)).parse().unwrap();
        assert!(n >= 1, "state class {class} is absent from the seeded board: {}", board.line);
    }

    // ...and the run states re-counted here, independently of the binary's own measurement.
    for status in ["running", "blocked", "failed", "completed", "abandoned"] {
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1 AND status = ?2", params![project, status], |r| r.get(0))
            .unwrap();
        assert!(n >= 1, "no {status} run in the database");
    }
    let pending: i64 = conn
        .query_row("SELECT COUNT(*) FROM authoring_proposals WHERE project_id = ?1 AND status = 'pending'", params![project], |r| r.get(0))
        .unwrap();
    assert!(pending >= 1, "no pending proposal");

    // Realistic density, not a handful of rows.
    let epics: i64 = conn.query_row("SELECT COUNT(*) FROM epics", [], |r| r.get(0)).unwrap();
    let tasks: i64 = conn.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
    assert!(epics >= 25 && tasks >= 80, "board too thin: {epics} epics, {tasks} tasks");
}

#[test]
fn awaiting_review_is_derived_by_the_fleet_read_and_stored_nowhere() {
    let conn = shared().conn();
    let fleet = core::query::fleet::fleet_rows(&conn, 200).unwrap();
    let awaiting: Vec<_> = fleet.rows.iter().filter(|r| r.fleet_state == "awaiting_review").collect();
    assert!(!awaiting.is_empty(), "the fleet read derives no awaiting-review row");
    for row in awaiting {
        assert_eq!(row.run_status, "completed", "awaiting review is a completed run");
        assert_ne!(row.task_status.as_deref(), Some("done"), "a done task is not awaiting review");
    }
    let stored: i64 = conn
        .query_row("SELECT COUNT(*) FROM agent_runs WHERE status NOT IN ('running','blocked','completed','failed','interrupted','abandoned')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, 0, "awaiting review must not be stored as a run status");
}

#[test]
fn change_flags_and_the_merged_marker_are_real_git_truth() {
    let board = shared();
    let conn = board.conn();
    let project = board.project_id();
    let inputs = core::query::change_flags::change_flag_inputs(&conn, &project, 1000).unwrap();
    let flags = core::query::change_flags::finish_change_flags(inputs).unwrap();
    assert!(flags.iter().any(|f| f.ahead.unwrap_or(0) > 0), "no worktree is ahead of its base");
    assert!(flags.iter().any(|f| f.dirty), "no worktree has a dirty tree");

    let (task_id, repo, branch): (String, String, String) = conn
        .query_row(
            "SELECT t.id, p.repo_path, e.integration_branch FROM events ev \
             JOIN tasks t ON t.id = ev.task_id JOIN epics e ON e.id = t.epic_id JOIN projects p ON p.id = t.project_id \
             WHERE ev.event_type = 'task.integrated' LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("a merged task");
    assert!(core::merge::is_integrated(&conn, Path::new(&repo), &task_id, &branch).unwrap(), "the merge is not reachable from the integration branch");
}

#[test]
fn exactly_one_active_cycle_and_a_roadmap_ahead() {
    let board = shared();
    let conn = board.conn();
    let project = board.project_id();
    let active: i64 = conn.query_row("SELECT COUNT(*) FROM cycles WHERE state = 'active'", [], |r| r.get(0)).unwrap();
    let planned: i64 = conn.query_row("SELECT COUNT(*) FROM cycles WHERE state = 'planned'", [], |r| r.get(0)).unwrap();
    assert_eq!(active, 1, "exactly one active Cycle");
    assert!(planned >= 2, "the roadmap ahead has {planned} Cycles");

    let roster = cycle_roster(&conn, &project).unwrap();
    assert!(!roster.ahead().is_empty(), "the roster shows no Cycle ahead of the current one");
    assert!(!roster.truncated);
    let current = active_cycle(&conn, &project).unwrap().expect("an active Cycle");
    assert_eq!(roster.cycles[0].cycle.id, current.id, "the active Cycle leads the roster by rank");
}

#[test]
fn the_lead_epic_is_in_the_active_cycle_and_is_a_real_plan_file() {
    let board = shared();
    let conn = board.conn();
    let project = board.project_id();
    let current = active_cycle(&conn, &project).unwrap().expect("an active Cycle");
    let roster = list_epics(&conn, &project).unwrap();
    let lead = roster.epics.first().expect("an epic");

    let cycle_of_lead: Option<String> = conn.query_row("SELECT cycle_id FROM epics WHERE id = ?1", params![lead.id], |r| r.get(0)).unwrap();
    assert_eq!(cycle_of_lead.as_deref(), Some(current.id.as_str()), "the board's first epic is not in the active Cycle: {}", lead.title);
    assert_eq!(board.printed().get("lead_epic"), Some(&lead.key), "the binary and the board disagree about the lead");

    let key = lead.title.split(':').next().expect("a plan key");
    let root = repo_root();
    let mut dirs = vec![root.join(".planning/phases")];
    dirs.extend(
        std::fs::read_dir(root.join(".planning/milestones"))
            .into_iter()
            .flatten()
            .filter_map(|e| e.ok().map(|e| e.path().to_path_buf()))
            .filter(|p| p.to_string_lossy().ends_with("-phases")),
    );
    let on_disk = dirs.iter().flat_map(|d| std::fs::read_dir(d).into_iter().flatten().flatten()).any(|phase| {
        phase.path().join(format!("{key}-PLAN.md")).exists()
    });
    assert!(on_disk, "the lead epic {:?} names no plan file on disk", lead.title);
}

#[test]
fn the_folded_progress_equals_an_independent_full_count_on_the_seeded_board() {
    let board = shared();
    let conn = board.conn();
    let project = board.project_id();
    let current = active_cycle(&conn, &project).unwrap().expect("an active Cycle");
    let folded = cycle_progress(&conn, &current.id).unwrap();

    let (total, done): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(status = 'done'), 0) FROM tasks \
             WHERE epic_id IN (SELECT id FROM epics WHERE cycle_id = ?1)",
            params![current.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(i64::from(folded.tasks_total), total);
    assert_eq!(i64::from(folded.tasks_done), done);
    assert!(done > 0 && done < total, "a flat bar: {done} of {total} - the epic mid-flight is missing");
    assert!(folded.agents_running >= 1 && folded.agents_blocked >= 1, "the region has no live agents to show");
    assert!(folded.epics >= 8, "only {} epics in the active Cycle", folded.epics);
}

#[test]
fn no_epic_is_a_fixture_shaped_title() {
    let conn = shared().conn();
    let titles = rows(&conn, "SELECT title FROM epics");
    assert!(titles.len() >= 25);
    for title in titles {
        let (key, name) = title.split_once(": ").unwrap_or_else(|| panic!("epic {title:?} is not a plan-shaped title"));
        assert!(!key.is_empty() && key.chars().next().unwrap().is_ascii_digit(), "epic {title:?} has no plan key");
        let bare = name.to_lowercase();
        let bare = bare.trim_end_matches(|c: char| c.is_ascii_digit() || c == ' ' || c == '#');
        assert!(!PLACEHOLDER_TITLES.contains(&bare) && !bare.starts_with("lorem"), "epic {title:?} looks like a fixture");
    }
}

#[test]
fn two_seeds_of_the_same_planning_content_agree() {
    let (first, second) = (shared(), &seed());
    let (a, b) = (fingerprint(&first.conn()), fingerprint(&second.conn()));
    assert!(a.len() > 1000, "the fingerprint is suspiciously small: {} rows", a.len());
    assert_eq!(a, b, "two seeds of the same content produced different boards");
    assert_eq!(first.line, second.line, "the printed counts differ between runs");
}

/// The case D-25 names: the app runs `reconcile_agent_runs` at every launch, and a `running` or
/// `blocked` row with no process behind it is rewritten to `abandoned`. This runs the real
/// reconciler over a freshly seeded board and holds the live rows live.
#[test]
fn launch_reconciliation_leaves_the_live_rows_live() {
    let board = seed();
    // The reconciler reads run descriptors and kill records from the app-data dir; point this
    // process at the board's own so it never looks at the developer's real one.
    std::env::set_var("FLYWHEEL_APP_DATA_DIR", board.db.parent().unwrap());
    let mut conn = board.conn();
    let live = |c: &Connection| rows(c, "SELECT status FROM agent_runs WHERE status IN ('running','blocked') ORDER BY status, id");
    let before = live(&conn);
    assert!(before.contains(&"running".to_string()) && before.contains(&"blocked".to_string()));

    let human = core::domain::actor::local_human_actor_id(&conn).unwrap();
    let orphans = core::domain::agent_run::reconcile_agent_runs(&mut conn, &human).unwrap();

    assert!(orphans.is_empty(), "a processless row became a live orphan and would block the board behind a modal");
    assert_eq!(live(&conn), before, "launch reconciliation rewrote the live rows");
}

#[test]
fn an_empty_level_or_a_missing_seam_fails_loudly_and_writes_nothing() {
    // No app-data directory: the destructive accident.
    let out = Command::new(env!("CARGO_BIN_EXE_demo_board"))
        .arg(repo_root())
        .env_remove("FLYWHEEL_APP_DATA_DIR")
        .env("FLYWHEEL_WORKTREE_ROOT", scratch())
        .output()
        .unwrap();
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("real fleet database"), "the refusal must name what it protects");

    // A roadmap with no phase entries, then phases with no plan files.
    let empty_roadmap = scratch();
    std::fs::create_dir_all(empty_roadmap.join(".planning")).unwrap();
    std::fs::write(empty_roadmap.join(".planning/ROADMAP.md"), "# Roadmap\n\nnothing here\n").unwrap();
    let no_plans = scratch();
    std::fs::create_dir_all(no_plans.join(".planning/phases")).unwrap();
    std::fs::write(no_plans.join(".planning/ROADMAP.md"), "### Phase 1: One\n\n**Goal**: a goal\n").unwrap();

    for (root, level) in [(empty_roadmap, "roadmap"), (no_plans, "phases")] {
        let data = scratch();
        let out = run_seeder(&root, &data, &scratch(), Some("1"));
        assert!(!out.status.success(), "{level}: the seeder succeeded on an empty level");
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert!(stderr.contains(level), "{level}: the failure does not name the level: {stderr}");
        assert!(!data.join("flywheel.db").exists(), "{level}: a database was written before the level was checked");
    }
}
