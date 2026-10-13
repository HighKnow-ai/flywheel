//! Phase 09 plan 09-07: one dispatch over an epic's plan. `decide` is asserted on the action vector
//! it returns; the acting half (`run_pass`) is driven against REAL git repositories, with a fake
//! spawner standing in for the one thing core cannot do (start an agent process).
//!
//! The claim with teeth: wave readiness is MERGED, not finished. Wave two must branch off a base that
//! contains wave one's merged work, and a git read asserts it.

mod common;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use core::dispatch::{
    attention_for, decide, launch_conflict, observation_targets, ready_tasks, stuck_cause, wave_is_drained, Action,
    AttentionCause, AttentionPhase, Observations, ReadinessRefusal,
};
use core::dispatch_exec::run_pass;
use core::domain::actor::system_actor;
use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::dispatch_plan::{
    advance_wave, approve_and_start, control_plan, create_plan_for_epic, edit_draft_plan, read_plan, retry_task,
    set_task_dispatch_state, skip_task, AdvanceOutcome, DraftEdit, PlanControl, StuckRefusal, EVENT_TASK_RETRIED,
    EVENT_TASK_SKIPPED,
};
use core::domain::epic::create_epic;
use core::domain::file_set::{declare_file_set, widen_file_set};
use core::domain::settings::set_dispatch_max_parallel;
use core::domain::task::create_task;
use core::domain::worktree::worktree_for_task;
use core::file_set::{parse_entry, FileSetEntry};
use core::git_facts::observe;
use core::limit_gate::{apply_rate_limit_signal, LimitSignal, LimitTier};
use rusqlite::{params, Connection};

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn git(path: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// What the fake agent does when it is spawned: write one file, optionally commit it.
#[derive(Clone)]
struct Work {
    file: &'static str,
    content: &'static str,
    commit: bool,
}

struct Fx {
    db: Mutex<Connection>,
    human: String,
    project_id: String,
    epic_id: String,
    repo: tempfile::TempDir,
    work: Mutex<HashMap<String, Work>>,
    /// Task ids the fake spawner leaves RUNNING instead of finishing.
    hold: Mutex<Vec<String>>,
    _worktrees: tempfile::TempDir,
    _runtime: tempfile::TempDir,
    _guard: std::sync::MutexGuard<'static, ()>,
}

impl Drop for Fx {
    fn drop(&mut self) {
        // SAFETY: the guard in this struct serialises every test in this binary.
        unsafe {
            std::env::remove_var("FLYWHEEL_WORKTREE_ROOT");
            std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
        }
    }
}

fn fx() -> Fx {
    let guard = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let worktrees = tempfile::tempdir().unwrap();
    let runtime = tempfile::tempdir().unwrap();
    // SAFETY: serialised by `ENV_LOCK`; cleared in `Drop`.
    unsafe {
        std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktrees.path());
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path());
    }
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let epic = create_epic(&mut conn, &project.id, &human, "Fan out", None).unwrap();
    Fx {
        db: Mutex::new(conn),
        human,
        project_id: project.id,
        epic_id: epic.id,
        repo,
        work: Mutex::new(HashMap::new()),
        hold: Mutex::new(Vec::new()),
        _worktrees: worktrees,
        _runtime: runtime,
        _guard: guard,
    }
}

impl Fx {
    fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap()
    }

    /// A backlog task in the epic with its declared set and the work its fake agent will do.
    fn task(&self, title: &str, declared: &[&str], work: Work) -> String {
        let mut conn = self.conn();
        let task = create_task(&mut conn, &self.project_id, &self.human, title, Some(&self.epic_id)).unwrap();
        if !declared.is_empty() {
            let entries: Vec<_> = declared.iter().map(|d| parse_entry(d).unwrap()).collect();
            declare_file_set(&mut conn, &task.id, &entries, &self.human).unwrap();
        }
        self.work.lock().unwrap().insert(task.id.clone(), work);
        task.id
    }

    /// A draft over every backlog task, moved to the given waves, approved and started.
    fn plan(&self, waves: &[(&str, u32)]) -> String {
        let mut conn = self.conn();
        let plan_id = create_plan_for_epic(&mut conn, &self.epic_id, &self.human).unwrap();
        let edits: Vec<DraftEdit> = waves
            .iter()
            .map(|(t, w)| DraftEdit { task_id: t.to_string(), wave: Some(*w), entries: None })
            .collect();
        edit_draft_plan(&mut conn, &plan_id, &edits, &self.human).unwrap();
        approve_and_start(&mut conn, &plan_id, &self.human).unwrap();
        plan_id
    }

    /// Start a run exactly as a launch does (worktree, run row); leave it running.
    fn launch(&self, task_id: &str) -> String {
        let mut conn = self.conn();
        start_agent_run(&mut conn, task_id, "acceptEdits", &self.human).unwrap().id
    }

    /// Start a run the way the dispatcher does: the SYSTEM actor initiates it, so it is automatic.
    fn launch_auto(&self, task_id: &str) -> String {
        let system = system_actor(&self.conn()).unwrap().id;
        start_agent_run(&mut self.conn(), task_id, "acceptEdits", &system).unwrap().id
    }

    /// The fake agent's finished work: write, optionally commit, close the run completed.
    fn finish(&self, task_id: &str, run_id: &str) {
        let work = self.work.lock().unwrap().get(task_id).cloned();
        if let Some(w) = work {
            let path = PathBuf::from(worktree_for_task(&self.conn(), task_id).unwrap().unwrap().path);
            if let Some(dir) = Path::new(w.file).parent() {
                std::fs::create_dir_all(path.join(dir)).unwrap();
            }
            std::fs::write(path.join(w.file), w.content).unwrap();
            if w.commit {
                git(&path, &["add", w.file]);
                git(&path, &["-c", "user.email=a@b.c", "-c", "user.name=Agent", "commit", "-m", "agent work"]);
            }
        }
        close_agent_run(&mut self.conn(), run_id, AgentRunStatus::Completed, None, None, None).unwrap();
    }

    fn spawn(&self, _plan: &str, task_id: &str) -> Result<(), String> {
        let run_id = self.launch_auto(task_id);
        if !self.hold.lock().unwrap().contains(&task_id.to_string()) {
            self.finish(task_id, &run_id);
        }
        Ok(())
    }

    fn pass(&self) -> core::dispatch_exec::PassReport {
        let system = system_actor(&self.conn()).unwrap().id;
        run_pass(&self.db, now(), &system, |p, t| self.spawn(p, t)).unwrap()
    }

    fn actions(&self) -> Vec<Action> {
        let conn = self.conn();
        let obs = observe(&observation_targets(&conn).unwrap());
        decide(&conn, now(), &obs).unwrap()
    }

    fn state(&self, plan_id: &str, task_id: &str) -> String {
        self.conn()
            .query_row(
                "SELECT state FROM dispatch_plan_tasks WHERE plan_id = ?1 AND task_id = ?2",
                params![plan_id, task_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    fn cursor(&self, plan_id: &str) -> u32 {
        read_plan(&self.conn(), plan_id).unwrap().unwrap().wave_cursor
    }

    fn plan_status(&self, plan_id: &str) -> String {
        read_plan(&self.conn(), plan_id).unwrap().unwrap().status
    }

    fn worktree(&self, task_id: &str) -> PathBuf {
        PathBuf::from(worktree_for_task(&self.conn(), task_id).unwrap().unwrap().path)
    }

    fn integration_branch(&self) -> String {
        self.conn()
            .query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&self.epic_id], |r| r.get(0))
            .unwrap()
    }

    /// Passes until `done` holds, at most `max`.
    fn drive(&self, max: usize, done: impl Fn(&Fx) -> bool) {
        for _ in 0..max {
            if done(self) {
                return;
            }
            self.pass();
        }
        assert!(done(self), "the plan did not reach the expected state in {max} passes");
    }

    fn reopened(&self) -> Connection {
        let path = self.conn().path().map(PathBuf::from).expect("file-backed database");
        Connection::open(path).unwrap()
    }
}

fn w(file: &'static str) -> Work {
    Work { file, content: "from the agent\n", commit: true }
}

fn spawns(actions: &[Action]) -> Vec<&str> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Spawn { task_id, .. } => Some(task_id.as_str()),
            _ => None,
        })
        .collect()
}

fn merges(actions: &[Action]) -> Vec<&str> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::Merge { task_id, .. } => Some(task_id.as_str()),
            _ => None,
        })
        .collect()
}

fn has_advance(actions: &[Action]) -> bool {
    actions.iter().any(|a| matches!(a, Action::AdvanceWave { .. }))
}

fn attention_of(actions: &[Action], task: &str) -> Option<AttentionCause> {
    actions.iter().find_map(|a| match a {
        Action::MarkNeedsAttention { task_id, cause, .. } if task_id == task => Some(cause.clone()),
        _ => None,
    })
}

fn pause_gate(fx: &Fx) {
    let signal = LimitSignal { tier: LimitTier::Rejected, window: Some("five_hour".into()), resets_at: Some(now() + 3600) };
    apply_rate_limit_signal(&mut fx.conn(), &signal, now()).unwrap();
}

fn warn_gate(fx: &Fx) {
    let signal = LimitSignal { tier: LimitTier::Warning, window: Some("seven_day".into()), resets_at: Some(now() + 3600) };
    apply_rate_limit_signal(&mut fx.conn(), &signal, now()).unwrap();
}

// ===== Task 1: decide ===========================================================================

#[test]
fn one_collision_in_a_wave_of_three_degrades_only_the_pair() {
    let fx = fx();
    let a = fx.task("A", &["src/lib/"], w("src/lib/a.rs"));
    let b = fx.task("B", &["src/lib/b.rs"], w("src/lib/b.rs"));
    let c = fx.task("C", &["docs/"], w("docs/c.md"));
    let plan = fx.plan(&[(&a, 1), (&b, 1), (&c, 1)]);

    let actions = fx.actions();
    assert_eq!(spawns(&actions), vec![a.as_str(), c.as_str()], "the predecessor and the unrelated task start together");
    assert!(!spawns(&actions).contains(&b.as_str()));

    let why = core::dispatch::why(&fx.conn(), &plan, &a, &b).unwrap();
    assert!(matches!(why, core::dispatch::SequencingReason::Sequenced { ref colliding_paths, .. }
        if colliding_paths.iter().any(|(x, y)| x == "src/lib/" && y == "src/lib/b.rs")));
}

#[test]
fn the_successor_waits_for_merged_not_for_finished() {
    let fx = fx();
    let a = fx.task("A", &["src/x/"], w("src/x/a.rs"));
    let b = fx.task("B", &["src/x/b.rs"], w("src/x/b.rs"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);

    // Spawn A; its run finishes with a clean commit but nothing has merged it yet.
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "running");
    let actions = fx.actions();
    assert_eq!(merges(&actions), vec![a.as_str()], "finished work is merged next");
    assert!(spawns(&actions).is_empty(), "a merely FINISHED predecessor must not release the successor");
    assert_eq!(
        ready_tasks(&fx.conn(), &plan, &Observations::default()).unwrap(),
        Vec::<String>::new()
    );

    fx.pass(); // the merge
    assert_eq!(fx.state(&plan, &a), "merged");
    assert_eq!(spawns(&fx.actions()), vec![b.as_str()], "merged releases it");
}

#[test]
fn the_cap_bounds_spawns_by_database_occupancy() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let _b = fx.task("B", &["b/"], w("b/1"));
    let _c = fx.task("C", &["c/"], w("c/1"));
    fx.plan(&[(&a, 1), (&_b, 1), (&_c, 1)]);
    set_dispatch_max_parallel(&mut fx.conn(), &fx.human, 1).unwrap();
    assert_eq!(spawns(&fx.actions()).len(), 1, "cap 1, nothing occupied: exactly one");

    // One slot occupied by an unrelated manual launch.
    let other = create_task(&mut fx.conn(), &fx.project_id, &fx.human, "manual", None).unwrap();
    fx.launch(&other.id);
    assert_eq!(spawns(&fx.actions()).len(), 0, "cap 1, one occupied: none");
}

#[test]
fn manual_launches_above_the_cap_make_the_dispatcher_spawn_nothing_and_not_fail() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    fx.plan(&[(&a, 1)]);
    set_dispatch_max_parallel(&mut fx.conn(), &fx.human, 2).unwrap();
    for i in 0..3 {
        let t = create_task(&mut fx.conn(), &fx.project_id, &fx.human, &format!("manual {i}"), None).unwrap();
        fx.launch(&t.id);
    }
    let conn = fx.conn();
    let result = decide(&conn, now(), &Observations::default());
    assert!(result.is_ok(), "above the cap is a state to wait out, not an error");
    assert!(spawns(&result.unwrap()).is_empty());
}

#[test]
fn a_paused_gate_spawns_nothing_but_still_merges() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/1"));
    fx.plan(&[(&a, 1), (&b, 1)]);
    fx.hold.lock().unwrap().push(b.clone());
    fx.pass(); // A runs and finishes, B is left running
    pause_gate(&fx);
    // Release B's slot but leave A unmerged: a third, fresh task is not available, so check A only.
    let actions = fx.actions();
    assert!(spawns(&actions).is_empty(), "paused gate: no spawn");
    assert_eq!(merges(&actions), vec![a.as_str()], "a merge is local git and still proceeds");
}

#[test]
fn the_warning_tier_lets_the_wave_run_but_never_advances_it() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/1"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    warn_gate(&fx);
    set_task_dispatch_state(&fx.conn(), &plan, &a, "merged").unwrap();
    let actions = fx.actions();
    assert_eq!(spawns(&actions), vec![b.as_str()], "spawns inside the current wave still go out");
    assert!(!has_advance(&actions));

    set_task_dispatch_state(&fx.conn(), &plan, &b, "merged").unwrap();
    assert!(!has_advance(&fx.actions()), "a fully merged wave still does not advance on the warning tier");
}

#[test]
fn a_dirty_worktree_stops_the_task_with_a_named_cause_and_is_not_committed_for_it() {
    let fx = fx();
    let a = fx.task("A", &["a/"], Work { file: "a/1", content: "x\n", commit: false });
    let plan = fx.plan(&[(&a, 1)]);
    fx.pass(); // spawned; the agent left the file uncommitted
    let before = git(&fx.worktree(&a), &["status", "--porcelain"]);
    assert!(!before.is_empty());

    let actions = fx.actions();
    assert!(merges(&actions).is_empty());
    let cause = attention_of(&actions, &a).expect("a needs-attention action");
    assert!(matches!(cause, AttentionCause::Uncommitted { .. }));
    assert!(cause.sentence().contains("uncommitted"));

    fx.pass();
    assert_eq!(fx.state(&plan, &a), "needs_attention");
    assert_eq!(git(&fx.worktree(&a), &["status", "--porcelain"]), before, "the dispatcher committed nothing");
    let branch = worktree_for_task(&fx.conn(), &a).unwrap().unwrap().branch;
    let ahead = git(fx.repo.path(), &["rev-list", "--count", &format!("{}..{}", fx.integration_branch(), branch)]);
    assert_eq!(ahead, "0", "the task branch carries no commit the agent did not make");
    let (_, kind, _) = attention_for(&fx.conn(), &plan, &a).unwrap().unwrap();
    assert_eq!(kind, "uncommitted");
    assert!(!has_advance(&fx.actions()), "a task needing attention blocks its wave");
}

#[test]
fn a_run_with_no_commits_stops_the_task_naming_their_absence() {
    let fx = fx();
    let t = fx.task("Idle", &["z/"], Work { file: "z/1", content: "", commit: false });
    fx.work.lock().unwrap().remove(&t); // writes nothing at all
    let plan = fx.plan(&[(&t, 1)]);
    fx.pass();
    let cause = attention_of(&fx.actions(), &t).expect("needs attention");
    assert!(matches!(cause, AttentionCause::NoCommits { .. }));
    assert!(cause.sentence().contains("no commits"));
    assert!(merges(&fx.actions()).is_empty());
    fx.pass();
    assert_eq!(fx.state(&plan, &t), "needs_attention");
}

#[test]
fn a_worktree_cut_before_the_integration_tip_moved_is_flagged_not_rebased() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    fx.hold.lock().unwrap().push(a.clone());
    let plan = fx.plan(&[(&a, 1)]);
    // The task's worktree exists, cut from the integration tip at that moment, and its run ended.
    let run = fx.launch_auto(&a);
    close_agent_run(&mut fx.conn(), &run, AgentRunStatus::Failed, None, None, None).unwrap();
    // Then the integration branch moves on (a sibling merged).
    let integ = fx.integration_branch();
    let tree = git(fx.repo.path(), &["rev-parse", &format!("{integ}^{{tree}}")]);
    let moved = git(fx.repo.path(), &["-c", "user.email=a@b.c", "-c", "user.name=T", "commit-tree", &tree, "-p", &integ, "-m", "sibling"]);
    git(fx.repo.path(), &["update-ref", &format!("refs/heads/{integ}"), &moved]);

    let actions = fx.actions();
    assert!(spawns(&actions).is_empty(), "no spawn on a stale base");
    assert!(matches!(attention_of(&actions, &a), Some(AttentionCause::StaleBase { .. })));
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "needs_attention");
    // Bring the tip into the task branch: it is startable again.
    git(&fx.worktree(&a), &["-c", "user.email=a@b.c", "-c", "user.name=T", "merge", "--no-edit", &integ]);
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "fixed by the user, it starts on its own");
}

#[test]
fn a_drained_wave_advances_once_and_a_failed_task_holds_it() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/1"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    set_task_dispatch_state(&fx.conn(), &plan, &a, "merged").unwrap();
    set_task_dispatch_state(&fx.conn(), &plan, &b, "failed").unwrap();
    assert!(!has_advance(&fx.actions()));
    assert!(!wave_is_drained(&fx.conn(), &plan, 1).unwrap());
    set_task_dispatch_state(&fx.conn(), &plan, &b, "skipped").unwrap();
    let actions = fx.actions();
    assert_eq!(actions.iter().filter(|a| matches!(a, Action::AdvanceWave { .. })).count(), 1);
}

#[test]
fn the_same_state_and_time_give_the_same_actions_and_a_reopened_database_agrees() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["a/b"], w("a/b"));
    let c = fx.task("C", &["c/"], w("c/1"));
    fx.plan(&[(&a, 1), (&b, 1), (&c, 1)]);
    let obs = observe(&observation_targets(&fx.conn()).unwrap());
    let first = decide(&fx.conn(), 1_800_000_000, &obs).unwrap();
    let second = decide(&fx.conn(), 1_800_000_000, &obs).unwrap();
    assert_eq!(first, second);
    assert!(!first.is_empty());
    let reopened = fx.reopened();
    assert_eq!(decide(&reopened, 1_800_000_000, &obs).unwrap(), first, "no decision depends on memory");
}

#[test]
fn a_ready_task_overlapping_a_running_task_of_another_plan_is_not_spawned() {
    let fx = fx();
    // Plan one, on the fixture epic: X declares src/shared/ and is running.
    let x = fx.task("X", &["src/shared/"], w("src/shared/x"));
    fx.hold.lock().unwrap().push(x.clone());
    fx.plan(&[(&x, 1)]);
    fx.pass();
    // Plan two, on another epic of the same project: Y declares a file inside X's directory.
    let epic2 = create_epic(&mut fx.conn(), &fx.project_id, &fx.human, "Second", None).unwrap();
    let y = create_task(&mut fx.conn(), &fx.project_id, &fx.human, "Y", Some(&epic2.id)).unwrap();
    declare_file_set(&mut fx.conn(), &y.id, &[parse_entry("src/shared/y.rs").unwrap()], &fx.human).unwrap();
    let plan2 = create_plan_for_epic(&mut fx.conn(), &epic2.id, &fx.human).unwrap();
    approve_and_start(&mut fx.conn(), &plan2, &fx.human).unwrap();

    let conn = fx.conn();
    let obs = observe(&observation_targets(&conn).unwrap());
    assert!(spawns(&decide(&conn, now(), &obs).unwrap()).is_empty());
    let tasks = core::dispatch::ready_tasks(&conn, &plan2, &obs).unwrap();
    assert!(tasks.is_empty(), "overlap with an in-flight armed set holds it: {tasks:?}");
    let _ = ReadinessRefusal::HasLiveRun; // the refusal vocabulary is public
}

// ===== Task 3: the automatic merge, the conflict that stops, the controls =======================

#[test]
fn two_waves_run_to_completion_and_wave_two_is_cut_from_a_base_containing_wave_one() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let b = fx.task("B", &["b/"], w("b/two.txt"));
    let plan = fx.plan(&[(&a, 1), (&b, 2)]);

    fx.drive(10, |f| f.state(&plan, &a) == "merged");
    assert_eq!(fx.cursor(&plan), 1, "merged is not yet advanced");
    // Wave two does not start until the cursor moves.
    assert!(spawns(&fx.actions()).is_empty());

    fx.drive(10, |f| f.plan_status(&plan) == "completed");
    assert_eq!(fx.state(&plan, &b), "merged");

    // Wave one's commit is IN wave two's worktree, by a git read.
    let a_branch = worktree_for_task(&fx.conn(), &a).unwrap().unwrap().branch;
    let a_tip = git(fx.repo.path(), &["rev-parse", &a_branch]);
    let wt_b = fx.worktree(&b);
    assert!(wt_b.join("../").exists());
    let contained = Command::new("git").arg("-C").arg(&wt_b).args(["merge-base", "--is-ancestor", &a_tip, "HEAD"]).status().unwrap();
    assert!(contained.success(), "wave two's branch contains wave one's merged commit");
    assert_eq!(std::fs::read_to_string(wt_b.join("a/one.txt")).unwrap(), "from the agent\n");

    // Both merges are on the integration branch.
    let integ = fx.integration_branch();
    for tip in [&a_tip, &git(fx.repo.path(), &["rev-parse", &worktree_for_task(&fx.conn(), &b).unwrap().unwrap().branch])] {
        let on = Command::new("git").arg("-C").arg(fx.repo.path()).args(["merge-base", "--is-ancestor", tip, &integ]).status().unwrap();
        assert!(on.success());
    }
}

#[test]
fn an_automatic_merge_is_recorded_under_the_system_actor_with_an_automatic_flag() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let plan = fx.plan(&[(&a, 1)]);
    fx.drive(10, |f| f.state(&plan, &a) == "merged");

    let conn = fx.conn();
    let system = system_actor(&conn).unwrap().id;
    let rows: Vec<(String, String)> = {
        let mut stmt = conn
            .prepare("SELECT actor_id, payload FROM events WHERE event_type = 'task.integrated' AND task_id = ?1")
            .unwrap();
        stmt.query_map([&a], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
    };
    assert_eq!(rows.len(), 1, "the existing task-integrated event type is still what is emitted");
    let (actor, payload) = &rows[0];
    assert_eq!(actor, &system);
    assert_ne!(actor, &fx.human, "a merge nobody reviewed is not a human act");
    let payload: serde_json::Value = serde_json::from_str(payload).unwrap();
    assert_eq!(payload["automatic"], true);
    assert_eq!(payload["dispatch_plan_id"], plan.as_str());
    assert!(payload["merge_commit"].as_str().is_some(), "Phase 8's integrated marker still reads it");

    // The dispatcher wrote no board workflow status: the launch moved the task, the merge did not.
    let status: String = conn.query_row("SELECT status FROM tasks WHERE id = ?1", [&a], |r| r.get(0)).unwrap();
    assert_eq!(status, "in_progress");
}

#[test]
fn a_conflict_stops_that_task_writes_the_aborted_event_and_holds_the_cursor() {
    let fx = fx();
    // Disjoint declarations, so no ordering edge: both run, and both edit the same file differently.
    // (An undeclared pair would now be sequenced, D-150, and could not collide.) Each declaration is
    // wrong about what the agent really touches, which is exactly the case the merge path catches.
    let a = fx.task("A", &["a/"], Work { file: "shared.txt", content: "from a\n", commit: true });
    let b = fx.task("B", &["b/"], Work { file: "shared.txt", content: "from b\n", commit: true });
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);

    fx.drive(10, |f| f.state(&plan, &a) == "merged" || f.state(&plan, &b) == "merged");
    fx.drive(10, |f| f.state(&plan, &a) == "conflict" || f.state(&plan, &b) == "conflict");
    let loser = if fx.state(&plan, &a) == "conflict" { &a } else { &b };
    assert_eq!(fx.cursor(&plan), 1, "the wave does not advance past a conflict");
    let aborted: i64 = fx.conn().query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = 'task.merge_aborted' AND task_id = ?1", [loser], |r| r.get(0)).unwrap();
    assert_eq!(aborted, 1);
    fx.pass();
    fx.pass();
    let aborted_after: i64 = fx.conn().query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = 'task.merge_aborted' AND task_id = ?1", [loser], |r| r.get(0)).unwrap();
    assert_eq!(aborted_after, 1, "the conflict is one record, not one per tick");
    assert!(!has_advance(&fx.actions()));
}

#[test]
fn a_dirty_integration_worktree_is_refused_with_a_named_cause_visible_in_the_plan() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let b = fx.task("B", &["b/"], w("b/two.txt"));
    let plan = fx.plan(&[(&a, 1), (&b, 2)]);
    fx.drive(20, |f| f.state(&plan, &b) == "running");

    // The epic's integration worktree now exists (wave one merged through it). Dirty it.
    let key_prefix = "FLY";
    let epic_key: String = fx.conn().query_row("SELECT key FROM epics WHERE id = ?1", [&fx.epic_id], |r| r.get(0)).unwrap();
    let epic_wt = fx._worktrees.path().join(key_prefix).join(&epic_key);
    assert!(epic_wt.exists(), "wave one merged through the epic worktree");
    std::fs::write(epic_wt.join("stray.txt"), "left behind\n").unwrap();

    fx.pass();
    assert_eq!(fx.state(&plan, &b), "needs_attention");
    let (_, kind, sentence) = attention_for(&fx.conn(), &plan, &b).unwrap().unwrap();
    assert_eq!(kind, "merge_blocked");
    assert!(sentence.contains("uncommitted"), "{sentence}");
    assert!(sentence.contains("integration worktree"), "{sentence}");
    let marks = |f: &Fx| -> i64 {
        f.conn().query_row("SELECT COUNT(*) FROM events WHERE event_type = 'dispatch.task_needs_attention' AND task_id = ?1", [&b], |r| r.get(0)).unwrap()
    };
    let once = marks(&fx);
    fx.pass();
    assert_eq!(marks(&fx), once, "a persisting cause is one record");

    // Cleaned, it merges on its own.
    std::fs::remove_file(epic_wt.join("stray.txt")).unwrap();
    fx.drive(10, |f| f.state(&plan, &b) == "merged");
}

/// D-REV-39 WR-04: a merge that errors on every attempt (here a `pre-merge-commit` hook that
/// refuses) is one record, and the task is not walked through `merging` and back every tick.
#[test]
fn a_persistently_failing_merge_appends_one_event_and_does_not_flap() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let plan = fx.plan(&[(&a, 1)]);
    let hook = fx.repo.path().join(".git/hooks/pre-merge-commit");
    std::fs::write(&hook, "#!/bin/sh\necho refused >&2\nexit 1\n").unwrap();
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    fx.drive(10, |f| f.state(&plan, &a) == "needs_attention");
    let marks = |f: &Fx| -> i64 {
        f.conn().query_row(
            "SELECT COUNT(*) FROM events WHERE event_type = 'dispatch.task_needs_attention' AND task_id = ?1",
            [&a],
            |r| r.get(0),
        ).unwrap()
    };
    let (_, kind, _) = attention_for(&fx.conn(), &plan, &a).unwrap().unwrap();
    assert_eq!(kind, "merge_blocked", "the fixture fails the merge itself, not a precheck");
    let once = marks(&fx);
    assert_eq!(once, 1);

    for _ in 0..3 {
        let report = fx.pass();
        assert!(merges(&report.actions).contains(&a.as_str()), "the merge is still being retried each tick");
        assert_eq!(fx.state(&plan, &a), "needs_attention");
    }
    let causes = |f: &Fx| -> Vec<String> {
        let conn = f.conn();
        let mut stmt = conn
            .prepare("SELECT payload FROM events WHERE event_type = 'dispatch.task_needs_attention' AND task_id = ?1 ORDER BY sequence")
            .unwrap();
        stmt.query_map([&a], |r| r.get(0)).unwrap().map(Result::unwrap).collect()
    };
    assert_eq!(marks(&fx), once, "three more failed ticks append nothing: {:#?}", causes(&fx));

    // Fixed, it lands on its own.
    std::fs::remove_file(&hook).unwrap();
    fx.drive(10, |f| f.state(&plan, &a) == "merged");
}

// ===== D-REV-39: who started a run ===========================================================

/// WR-05. A task the user ran by hand sits in `planned` because only the dispatcher writes that
/// state. It must not be started a second time, and its finished work must not be orphaned.
#[test]
fn a_task_the_user_ran_by_hand_is_not_relaunched_and_its_finished_work_is_adopted() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let plan = fx.plan(&[(&a, 1)]);

    let run = fx.launch(&a); // the user's own launch, not the dispatcher's
    assert!(spawns(&fx.actions()).is_empty(), "never beside its own live run");
    fx.finish(&a, &run);

    let actions = fx.actions();
    assert!(spawns(&actions).is_empty(), "the run is over, and it was the user's: no second run on a done task");
    assert_eq!(merges(&actions), vec![a.as_str()], "the finished manual run is merged like any other");
    fx.drive(10, |f| f.state(&plan, &a) == "merged");
    assert_eq!(runs_for(&fx, &a), 1);
}

/// The companion: a run the dispatcher started is still retried under the existing rules. The real
/// path: the gate pauses, the run fails, the task reads `held_by_limit`, the user resumes, and the
/// dispatcher starts it again. (This is also the only test of the `MarkRunEnded` hold; the helper
/// that used to duplicate it had no caller and is gone.)
#[test]
fn a_dispatcher_started_task_held_by_the_limit_is_still_retried() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let plan = fx.plan(&[(&a, 1)]);
    fx.hold.lock().unwrap().push(a.clone());
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "running");
    pause_gate(&fx);
    let run: String = fx.conn().query_row("SELECT id FROM agent_runs WHERE task_id = ?1", [&a], |r| r.get(0)).unwrap();
    close_agent_run(&mut fx.conn(), &run, AgentRunStatus::Failed, None, None, None).unwrap();
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "held_by_limit", "failed under a paused gate reads held, not failed");
    assert!(spawns(&fx.actions()).is_empty(), "nothing starts while the gate is paused");

    let human = fx.human.clone();
    core::limit_gate::resume_now(&mut fx.conn(), &human).unwrap();
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "the dispatcher's own run is retried; only a user's is left alone");
}

/// A manual run from before the plan existed is history, not a claim on the task.
#[test]
fn a_manual_run_older_than_the_plan_does_not_stop_the_plan_starting_the_task() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    let plan = fx.plan(&[(&a, 1)]);
    let run = fx.launch(&a);
    fx.finish(&a, &run);
    fx.conn()
        .execute("UPDATE agent_runs SET started_at = '2000-01-01T00:00:00+00:00' WHERE id = ?1", [&run])
        .unwrap();
    let _ = plan;

    assert_eq!(spawns(&fx.actions()), vec![a.as_str()]);
}

/// IN-02. An unattended start is the system actor's, flagged automatic; a user's own is theirs.
#[test]
fn an_unattended_start_is_attributed_to_the_system_actor_and_a_manual_one_to_the_human() {
    for automatic in [true, false] {
        let fx = fx();
        let a = fx.task("A", &["a/"], w("a/one.txt"));
        let system = system_actor(&fx.conn()).unwrap().id;
        let human_events = |f: &Fx| -> i64 {
            f.conn().query_row("SELECT COUNT(*) FROM events WHERE actor_id = ?1", [&f.human], |r| r.get(0)).unwrap()
        };
        let before = human_events(&fx);

        let run = if automatic { fx.launch_auto(&a) } else { fx.launch(&a) };

        let expected = if automatic { &system } else { &fx.human };
        let conn = fx.conn();
        let (trigger_by, config): (String, Option<String>) = conn
            .query_row(
                "SELECT t.created_by, t.config FROM agent_runs r JOIN triggers t ON t.id = r.trigger_id WHERE r.id = ?1",
                [&run],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(&trigger_by, expected, "automatic={automatic}: who fired the run");
        assert_eq!(config.as_deref().is_some_and(|c| c.contains("\"automatic\":true")), automatic);
        let worktree_by: String =
            conn.query_row("SELECT created_by FROM worktrees WHERE task_id = ?1", [&a], |r| r.get(0)).unwrap();
        assert_eq!(&worktree_by, expected, "automatic={automatic}: the worktree the start cut");
        let started: String = conn
            .query_row("SELECT payload FROM events WHERE event_type = 'agent_run.started' AND stream_id = ?1", [&run], |r| r.get(0))
            .unwrap();
        let started: serde_json::Value = serde_json::from_str(&started).unwrap();
        assert_eq!(started["automatic"] == true, automatic, "{started}");
        let after: i64 =
            conn.query_row("SELECT COUNT(*) FROM events WHERE actor_id = ?1", [&fx.human], |r| r.get(0)).unwrap();
        if automatic {
            assert_eq!(after, before, "an unattended start writes nothing under the human actor");
        } else {
            assert!(after > before);
        }
    }
}

#[test]
fn an_epic_with_no_integration_branch_gets_one_from_the_lazy_cut_not_the_merge() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/one.txt"));
    fx.plan(&[(&a, 1)]);
    let none: Option<String> = fx.conn().query_row("SELECT integration_branch FROM epics WHERE id = ?1", [&fx.epic_id], |r| r.get(0)).unwrap();
    assert!(none.is_none());
    fx.pass(); // the spawn's worktree creation cuts it
    let cut: i64 = fx.conn().query_row("SELECT COUNT(*) FROM events WHERE event_type = 'epic.integration_branch_created'", [], |r| r.get(0)).unwrap();
    assert_eq!(cut, 1);
    assert!(!fx.integration_branch().is_empty());
}

#[test]
fn pause_and_stop_touch_no_running_session_and_pause_survives_a_restart() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/1"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    fx.hold.lock().unwrap().push(a.clone());
    fx.pass(); // A left running, B finished
    let runs = |f: &Fx| -> Vec<(String, String)> {
        let conn = f.conn();
        let mut stmt = conn.prepare("SELECT id, status FROM agent_runs ORDER BY id").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect()
    };
    let before = runs(&fx);

    control_plan(&mut fx.conn(), &plan, PlanControl::Pause, &fx.human).unwrap();
    assert_eq!(runs(&fx), before, "pause changes no running session");
    assert!(spawns(&fx.actions()).is_empty());
    assert!(!has_advance(&fx.actions()));
    let reopened = fx.reopened();
    assert_eq!(read_plan(&reopened, &plan).unwrap().unwrap().status, "paused", "paused survives a restart");

    control_plan(&mut fx.conn(), &plan, PlanControl::Resume, &fx.human).unwrap();
    assert_eq!(fx.plan_status(&plan), "running");

    control_plan(&mut fx.conn(), &plan, PlanControl::Stop, &fx.human).unwrap();
    assert_eq!(fx.plan_status(&plan), "aborted");
    assert_eq!(runs(&fx), before, "stop changes no running session");
    assert!(fx.actions().is_empty(), "a stopped plan is no longer the dispatcher's");
}

#[test]
fn advance_now_moves_the_cursor_under_the_warning_tier_and_the_next_wave_then_spawns() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/1"));
    let plan = fx.plan(&[(&a, 1), (&b, 2)]);
    warn_gate(&fx);
    set_task_dispatch_state(&fx.conn(), &plan, &a, "merged").unwrap();
    assert!(!has_advance(&fx.actions()), "no automatic advance on the warning tier");
    assert!(advance_wave(&mut fx.conn(), &plan, &fx.human).is_ok());
    assert_eq!(fx.cursor(&plan), 2);
    assert_eq!(spawns(&fx.actions()), vec![b.as_str()], "the next wave's spawns are issued");
}

#[test]
fn advance_refuses_a_wave_that_is_not_merged() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let plan = fx.plan(&[(&a, 1)]);
    set_task_dispatch_state(&fx.conn(), &plan, &a, "finished").unwrap();
    assert!(advance_wave(&mut fx.conn(), &plan, &fx.human).is_err(), "finished is not merged");
    set_task_dispatch_state(&fx.conn(), &plan, &a, "merged").unwrap();
    assert_eq!(advance_wave(&mut fx.conn(), &plan, &fx.human).unwrap(), AdvanceOutcome::Completed);
}

#[test]
fn a_plan_over_an_epic_builds_a_draft_from_declared_sets_with_no_planner() {
    let fx = fx();
    let a = fx.task("A", &["src/a/"], w("src/a/1"));
    let b = fx.task("B", &["src/a/b.rs", "docs/"], w("src/a/b.rs"));
    let plan_id = create_plan_for_epic(&mut fx.conn(), &fx.epic_id, &fx.human).unwrap();
    let plan = read_plan(&fx.conn(), &plan_id).unwrap().unwrap();
    assert_eq!(plan.status, "draft");
    assert_eq!(plan.tasks.len(), 2);
    assert!(plan.tasks.iter().all(|t| t.wave == 1));
    let planning_run: Option<String> =
        fx.conn().query_row("SELECT planning_run_id FROM dispatch_plans WHERE id = ?1", [&plan_id], |r| r.get(0)).unwrap();
    assert!(planning_run.is_none(), "no planning agent was involved");
    let sets = core::dispatch::planned_tasks(&fx.conn(), &plan_id).unwrap();
    let declared: usize = sets.iter().map(|t| t.entries.len()).sum();
    assert_eq!(declared, 3, "the tasks' currently declared sets are what the draft holds");

    // The edit surface: a wave move and an entry edit on the draft.
    edit_draft_plan(
        &mut fx.conn(),
        &plan_id,
        &[DraftEdit { task_id: b.clone(), wave: Some(5), entries: Some(vec!["src/b/".into()]) }],
        &fx.human,
    )
    .unwrap();
    let edited = read_plan(&fx.conn(), &plan_id).unwrap().unwrap();
    assert_eq!(edited.tasks.iter().find(|t| t.task_id == b).unwrap().wave, 5);
    assert_eq!(core::domain::file_set::list_entries_for_task(&fx.conn(), &b).unwrap().len(), 1);
    let _ = a;
}

#[test]
fn a_failed_run_is_recorded_and_blocks_its_wave() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let plan = fx.plan(&[(&a, 1)]);
    fx.hold.lock().unwrap().push(a.clone());
    fx.pass();
    let run: String = fx.conn().query_row("SELECT id FROM agent_runs WHERE task_id = ?1", [&a], |r| r.get(0)).unwrap();
    close_agent_run(&mut fx.conn(), &run, AgentRunStatus::Failed, None, None, None).unwrap();
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "failed");
    assert!(!has_advance(&fx.actions()));
    assert!(spawns(&fx.actions()).is_empty(), "a failed task is the user's to retry or skip");
}

// ===== D-REV-41: a stuck task has a way out, and only a human can take it =======================

fn events_of(fx: &Fx, task: &str, event_type: &str) -> i64 {
    fx.conn()
        .query_row("SELECT COUNT(*) FROM events WHERE task_id = ?1 AND event_type = ?2", params![task, event_type], |r| r.get(0))
        .unwrap()
}

fn refusal(e: anyhow::Error) -> StuckRefusal {
    e.downcast_ref::<StuckRefusal>().cloned().unwrap_or_else(|| panic!("not a named refusal: {e:#}"))
}

fn latest_run(fx: &Fx, task: &str) -> String {
    fx.conn()
        .query_row("SELECT id FROM agent_runs WHERE task_id = ?1 ORDER BY started_at DESC, id DESC LIMIT 1", [task], |r| r.get(0))
        .unwrap()
}

/// One task whose held run ended `status`, taken through a pass so the dispatcher has recorded it.
fn ended_badly(fx: &Fx, plan: &str, task: &str, status: AgentRunStatus) {
    fx.hold.lock().unwrap().push(task.to_string());
    fx.pass();
    let run = latest_run(fx, task);
    close_agent_run(&mut fx.conn(), &run, status, None, None, None).unwrap();
    fx.pass();
    fx.hold.lock().unwrap().retain(|t| t != task);
    let _ = plan;
}

/// Two tasks that both write `shared.txt`; one merges, the other lands in `conflict`. Returns
/// `(plan, loser)`.
fn conflicted_pair(fx: &Fx) -> (String, String) {
    let a = fx.task("A", &["a/"], Work { file: "shared.txt", content: "from a\n", commit: true });
    let b = fx.task("B", &["b/"], Work { file: "shared.txt", content: "from b\n", commit: true });
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    fx.drive(10, |f| f.state(&plan, &a) == "conflict" || f.state(&plan, &b) == "conflict");
    let loser = if fx.state(&plan, &a) == "conflict" { a } else { b };
    (plan, loser)
}

#[test]
fn a_failed_task_is_retried_by_a_human_and_the_wave_then_drains() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let plan = fx.plan(&[(&a, 1)]);
    ended_badly(&fx, &plan, &a, AgentRunStatus::Failed);
    assert_eq!(fx.state(&plan, &a), "failed");
    let cause = stuck_cause(&fx.conn(), &plan, &a, "failed").unwrap().expect("a failed task says why it is stuck");
    assert!(cause.contains("failed"), "{cause}");
    assert!(spawns(&fx.actions()).is_empty(), "a failed task is not restarted on its own");

    let human = fx.human.clone();
    assert_eq!(retry_task(&mut fx.conn(), &a, &human).unwrap(), plan);
    assert_eq!(fx.state(&plan, &a), "planned");
    assert_eq!(events_of(&fx, &a, EVENT_TASK_RETRIED), 1);
    fx.drive(10, |f| f.plan_status(&plan) == "completed");
    assert_eq!(fx.state(&plan, &a), "merged");
}

#[test]
fn a_stopped_task_is_skipped_and_this_and_every_later_wave_advance() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/2"));
    let plan = fx.plan(&[(&a, 1), (&b, 2)]);
    ended_badly(&fx, &plan, &a, AgentRunStatus::Interrupted);
    assert_eq!(fx.state(&plan, &a), "stopped");
    let cause = stuck_cause(&fx.conn(), &plan, &a, "stopped").unwrap().expect("a stopped task says why it is stuck");
    assert!(cause.contains("stopped"), "{cause}");
    assert!(!has_advance(&fx.actions()), "a stopped task holds its wave");

    let human = fx.human.clone();
    assert_eq!(skip_task(&mut fx.conn(), &a, &human).unwrap(), plan);
    assert_eq!(fx.state(&plan, &a), "skipped");
    assert_eq!(events_of(&fx, &a, EVENT_TASK_SKIPPED), 1);
    fx.drive(20, |f| f.plan_status(&plan) == "completed");
    assert_eq!(fx.state(&plan, &b), "merged", "wave two ran once wave one was drained by the skip");
    assert_eq!(fx.state(&plan, &a), "skipped");
}

#[test]
fn a_conflicted_task_is_retried_after_the_user_resolves_it_and_the_wave_drains() {
    let fx = fx();
    let (plan, loser) = conflicted_pair(&fx);
    let cause = stuck_cause(&fx.conn(), &plan, &loser, "conflict").unwrap().expect("a conflict says why");
    assert!(cause.contains("shared.txt") && cause.contains("conflict"), "{cause}");

    // The user's resolution: bring the integration branch into the task branch, taking its side.
    let wt = fx.worktree(&loser);
    git(&wt, &["-c", "user.email=u@b.c", "-c", "user.name=User", "merge", "-X", "theirs", "--no-edit", &fx.integration_branch()]);

    let human = fx.human.clone();
    assert_eq!(retry_task(&mut fx.conn(), &loser, &human).unwrap(), plan);
    assert_eq!(events_of(&fx, &loser, EVENT_TASK_RETRIED), 1);
    fx.drive(10, |f| f.plan_status(&plan) == "completed");
    assert_eq!(fx.state(&plan, &loser), "merged");
}

#[test]
fn a_retried_conflict_that_still_stands_lands_back_in_conflict_with_a_fresh_record() {
    let fx = fx();
    let (plan, loser) = conflicted_pair(&fx);
    let aborted = |fx: &Fx| events_of(fx, &loser, "task.merge_aborted");
    assert_eq!(aborted(&fx), 1);

    let human = fx.human.clone();
    retry_task(&mut fx.conn(), &loser, &human).unwrap();
    fx.pass();
    fx.pass();
    assert_eq!(fx.state(&plan, &loser), "conflict", "nothing was resolved, so it conflicts again");
    assert_eq!(aborted(&fx), 2, "one new record for the one retry, not one per tick");
    assert_eq!(fx.cursor(&plan), 1);
}

#[test]
fn retry_and_skip_refuse_by_name_outside_the_three_states_and_write_nothing() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let loose = fx.task("Loose", &["l/"], w("l/1"));
    let plan = fx.plan(&[(&a, 1)]);
    let human = fx.human.clone();
    let written = |fx: &Fx, t: &str| events_of(fx, t, EVENT_TASK_RETRIED) + events_of(fx, t, EVENT_TASK_SKIPPED);

    // Not in any live plan.
    assert_eq!(refusal(retry_task(&mut fx.conn(), &loose, &human).unwrap_err()), StuckRefusal::NotInLivePlan);
    assert_eq!(refusal(skip_task(&mut fx.conn(), &loose, &human).unwrap_err()), StuckRefusal::NotInLivePlan);

    // Running: held, not finished.
    fx.hold.lock().unwrap().push(a.clone());
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "running");
    assert_eq!(refusal(retry_task(&mut fx.conn(), &a, &human).unwrap_err()), StuckRefusal::NotStuck { state: "running".into() });
    assert_eq!(refusal(skip_task(&mut fx.conn(), &a, &human).unwrap_err()), StuckRefusal::NotStuck { state: "running".into() });
    assert_eq!(fx.state(&plan, &a), "running");
    assert_eq!(written(&fx, &a), 0);

    // Failed, but the user has a run of their own going on it right now.
    let run = latest_run(&fx, &a);
    close_agent_run(&mut fx.conn(), &run, AgentRunStatus::Failed, None, None, None).unwrap();
    fx.pass();
    assert_eq!(fx.state(&plan, &a), "failed");
    fx.launch(&a);
    assert_eq!(refusal(retry_task(&mut fx.conn(), &a, &human).unwrap_err()), StuckRefusal::HasLiveRun);
    assert_eq!(refusal(skip_task(&mut fx.conn(), &a, &human).unwrap_err()), StuckRefusal::HasLiveRun);
    assert_eq!(fx.state(&plan, &a), "failed");
    assert_eq!(written(&fx, &a), 0);

    // The refusal sentences are composed here, never git or CLI text.
    for r in [StuckRefusal::NotInLivePlan, StuckRefusal::NotStuck { state: "running".into() }, StuckRefusal::HasLiveRun] {
        assert!(!r.to_string().is_empty());
    }
    assert!(StuckRefusal::NotStuck { state: "running".into() }.to_string().contains("running"));
}

#[test]
fn a_task_the_user_ran_by_hand_that_failed_is_started_again_only_by_a_retry() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let plan = fx.plan(&[(&a, 1)]);
    let run = fx.launch(&a); // the user's own run, not the dispatcher's
    close_agent_run(&mut fx.conn(), &run, AgentRunStatus::Failed, None, None, None).unwrap();
    fx.pass(); // adopted: its ending is recorded
    assert_eq!(fx.state(&plan, &a), "failed");

    let human = fx.human.clone();
    retry_task(&mut fx.conn(), &a, &human).unwrap();
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "the retry must not be re-adopted as the hand-run it follows");
    fx.drive(10, |f| f.plan_status(&plan) == "completed");
}

#[test]
fn retry_and_skip_are_not_reachable_from_an_agent() {
    fn walk(dir: &Path, hits: &mut Vec<String>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, hits);
            } else if let Ok(text) = std::fs::read_to_string(&path) {
                if text.contains("retry_task") || text.contains("skip_task") {
                    hits.push(path.display().to_string());
                }
            }
        }
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../sidecar/src");
    let mut hits = Vec::new();
    walk(&root, &mut hits);
    assert!(hits.is_empty(), "the sidecar names a human-only verb: {hits:?}");
    let command_source = read("packages/desktop/src-tauri/src/commands/dispatch.rs");
    let production = command_source.split("#[cfg(test)]").next().unwrap();
    for name in ["pub fn retry_task", "pub fn skip_task"] {
        let at = production.find(name).unwrap_or_else(|| panic!("{name} is missing from commands/dispatch.rs"));
        let signature = &production[at..at + production[at..].find(") ->").unwrap()];
        assert!(signature.contains("task_id: String"), "{name} takes a task id");
        assert!(!signature.contains("plan_id"), "{name} takes a task id and nothing else: {signature}");
        let body = &production[at..at + production[at..].find("#[tauri::command]").unwrap_or(production.len() - at)];
        assert!(body.contains("local_human_actor_id"), "{name} resolves the actor server-side");
    }
}

// ===== source gates ===========================================================================

fn read(rel: &str) -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read_to_string(root.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"))
}

fn code_lines(src: &str) -> Vec<&str> {
    src.lines().filter(|l| !l.trim_start().starts_with("//")).collect()
}

#[test]
fn the_decision_half_is_database_only() {
    let src = read("packages/core/src/dispatch.rs");
    for line in code_lines(&src) {
        for banned in ["Command::new", "std::process", "thread::sleep", "UPDATE tasks SET status"] {
            assert!(!line.contains(banned), "dispatch.rs must stay pure; found {banned:?} in: {line}");
        }
    }
}

#[test]
fn no_dispatcher_file_invents_a_spawn_timing_policy_or_commits_for_the_agent() {
    for rel in ["packages/core/src/dispatch.rs", "packages/core/src/dispatch_exec.rs", "packages/desktop/src-tauri/src/commands/dispatch.rs"] {
        let src = read(rel);
        for line in code_lines(&src) {
            for banned in ["thread::sleep", "tokio::time::sleep", "SpawnFloor", "\"commit\"", "\"add\""] {
                assert!(!line.contains(banned), "{rel} must not contain {banned:?}: {line}");
            }
        }
    }
}

#[test]
fn the_automatic_merge_never_goes_through_the_human_merge_command() {
    let desktop = read("packages/desktop/src-tauri/src/commands/dispatch.rs");
    let core_exec = read("packages/core/src/dispatch_exec.rs");
    assert!(!code_lines(&desktop).iter().any(|l| l.contains("review_merge_task")));
    assert!(!code_lines(&core_exec).iter().any(|l| l.contains("local_human_actor")));
    assert!(code_lines(&desktop).iter().any(|l| l.contains("system_actor")));
}

#[test]
fn no_dispatch_handler_accepts_an_actor_a_branch_a_ref_a_sha_or_a_path() {
    let src = read("packages/desktop/src-tauri/src/commands/dispatch.rs");
    let mut handlers = 0;
    let mut rest = src.as_str();
    while let Some(at) = rest.find("#[tauri::command]") {
        rest = &rest[at..];
        let open = rest.find('(').unwrap();
        let close = rest.find(") ->").unwrap();
        let params = &rest[open..close];
        for banned in ["actor", "branch", "ref_name", "sha", "repo_path", "path:"] {
            assert!(!params.contains(banned), "a handler takes {banned:?}: {params}");
        }
        handlers += 1;
        rest = &rest[close..];
    }
    assert!(handlers >= 11, "expected the whole command roster, found {handlers}");
}

/// D-REV-39 WR-07. The case probe runs `git config`, so no desktop command may reach it while it holds
/// `AppState.db`. The core functions that probe themselves (`preview_edges`, `approve_plan`,
/// `approve_and_start`, `widen_file_set`, `arm_scope_marker`) are for callers with no lock; a command
/// calls their `*_with` twin and gets the flag from a helper that read the path under a short lock,
/// dropped it, and probed. This pins both halves in the command sources (their test modules excluded).
#[test]
fn no_desktop_command_runs_the_case_probe_under_the_database_lock() {
    let sources = [
        "packages/desktop/src-tauri/src/commands/dispatch.rs",
        "packages/desktop/src-tauri/src/commands/file_set.rs",
        "packages/desktop/src-tauri/src/commands/agent_run.rs",
    ];
    let mut probe_sites = 0;
    for rel in sources {
        let full = read(rel);
        let production = full.split("#[cfg(test)]").next().unwrap();
        for line in code_lines(production) {
            // Bare names, so an imported call is caught as well as a qualified one; the `_with` twins
            // do not contain these substrings.
            for self_probing in ["preview_edges(", "approve_plan(", "approve_and_start(", "widen_file_set(", "arm_scope_marker("] {
                assert!(!line.contains(self_probing), "{rel} calls {self_probing} under a lock: {line}");
            }
            if line.contains("repo_is_case_insensitive(") {
                probe_sites += 1;
            }
        }
    }
    // plan_fold_case, task_file_set_widen, observed_fold_case. A fourth means a new probe site: check it
    // runs with no lock held, then raise this number.
    assert_eq!(probe_sites, 3, "a command probes the case flag in an unexpected number of places");
}

// ===== 09 review CR-02: a task with no declared set runs alone (D-150) ==========================

#[test]
fn undeclared_tasks_in_one_wave_are_never_spawned_together() {
    let fx = fx();
    let a = fx.task("A", &[], w("a.txt"));
    let b = fx.task("B", &[], w("b.txt"));
    let c = fx.task("C", &[], w("c.txt"));
    let plan = fx.plan(&[(&a, 1), (&b, 1), (&c, 1)]);

    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "no declaration, no disjointness claim: one at a time");
    // `ready_tasks` answers per task ("could this start now?"), so it is asked once A is live.
    fx.launch(&a);
    assert_eq!(
        ready_tasks(&fx.conn(), &plan, &Observations::default()).unwrap(),
        Vec::<String>::new(),
        "the second reader of readiness agrees: nothing starts beside a live undeclared run"
    );
    let _ = (&b, &c);
}

#[test]
fn undeclared_tasks_all_complete_one_after_another_and_never_overlap() {
    let fx = fx();
    let a = fx.task("A", &[], w("a.txt"));
    let b = fx.task("B", &[], w("b.txt"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    for _ in 0..12 {
        assert!(spawns(&fx.actions()).len() <= 1, "never two spawns in one decision");
        fx.pass();
    }
    assert_eq!(fx.state(&plan, &a), "merged");
    assert_eq!(fx.state(&plan, &b), "merged");
}

#[test]
fn an_undeclared_task_shares_no_decision_with_a_declared_sibling() {
    let fx = fx();
    let u = fx.task("U", &[], w("u.txt"));
    let d = fx.task("D", &["d/"], w("d/1"));
    fx.plan(&[(&u, 1), (&d, 1)]);
    // Board order puts U first: it takes the project alone, so D is held off in the same decision.
    assert_eq!(spawns(&fx.actions()), vec![u.as_str()]);
    drop(fx); // the fixture serialises the binary on one lock

    // Reverse the order: D is first and takes the project, so U cannot start beside it.
    let fx = self::fx();
    let d = fx.task("D", &["d/"], w("d/1"));
    let u = fx.task("U", &[], w("u.txt"));
    fx.plan(&[(&d, 1), (&u, 1)]);
    assert_eq!(spawns(&fx.actions()), vec![d.as_str()]);
}

#[test]
fn a_live_undeclared_run_holds_every_other_task_in_the_project_off() {
    let fx = fx();
    let manual = create_task(&mut fx.conn(), &fx.project_id, &fx.human, "typed into QuickAdd", None).unwrap();
    fx.launch(&manual.id); // live, unarmed, no declared set
    let d = fx.task("D", &["d/"], w("d/1"));
    fx.plan(&[(&d, 1)]);
    assert!(spawns(&fx.actions()).is_empty(), "an unarmed live run is a hazard to every sibling");
}

#[test]
fn a_live_declared_run_holds_an_undeclared_task_off_even_from_another_plan() {
    let fx = fx();
    let d = fx.task("D", &["d/"], w("d/1"));
    fx.plan(&[(&d, 1)]);
    fx.launch(&d);

    // A second epic, a second plan, same project: still one project, still no shared decision.
    let other = create_epic(&mut fx.conn(), &fx.project_id, &fx.human, "Other", None).unwrap();
    let u = create_task(&mut fx.conn(), &fx.project_id, &fx.human, "U", Some(&other.id)).unwrap();
    {
        let mut conn = fx.conn();
        let plan2 = create_plan_for_epic(&mut conn, &other.id, &fx.human).unwrap();
        approve_and_start(&mut conn, &plan2, &fx.human).unwrap();
    }
    assert!(!spawns(&fx.actions()).contains(&u.id.as_str()), "no declared set: it cannot run beside a live run");
}

#[test]
fn undeclared_tasks_of_two_plans_in_one_project_are_not_spawned_together() {
    let fx = fx();
    let a = fx.task("A", &[], w("a.txt"));
    fx.plan(&[(&a, 1)]);
    let other = create_epic(&mut fx.conn(), &fx.project_id, &fx.human, "Other", None).unwrap();
    let b = create_task(&mut fx.conn(), &fx.project_id, &fx.human, "B", Some(&other.id)).unwrap();
    {
        let mut conn = fx.conn();
        let plan2 = create_plan_for_epic(&mut conn, &other.id, &fx.human).unwrap();
        approve_and_start(&mut conn, &plan2, &fx.human).unwrap();
    }
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "the second plan's undeclared task waits for the first");
    let _ = b;
}

// ===== 09-12 Task 1: the ONE launch-conflict rule, called directly ===============================

type Taken = Vec<(String, String, Vec<FileSetEntry>)>;

fn conflict(fx: &Fx, task: &str, fold: bool, taken: &Taken) -> Option<ReadinessRefusal> {
    launch_conflict(&fx.conn(), task, &fx.project_id, fold, taken).unwrap()
}

fn set(paths: &[&str]) -> Vec<FileSetEntry> {
    paths.iter().map(|p| parse_entry(p).unwrap()).collect()
}

#[test]
fn launch_conflict_refuses_a_task_with_a_running_run_of_its_own() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "nothing live yet");
    fx.launch(&a);
    assert_eq!(conflict(&fx, &a, false, &vec![]), Some(ReadinessRefusal::HasLiveRun));
}

#[test]
fn launch_conflict_refuses_a_task_with_a_blocked_run_of_its_own() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    fx.launch(&a);
    fx.conn().execute("UPDATE agent_runs SET status = 'blocked' WHERE task_id = ?1", [&a]).unwrap();
    assert_eq!(conflict(&fx, &a, false, &vec![]), Some(ReadinessRefusal::HasLiveRun), "a blocked run still holds a slot");
}

#[test]
fn launch_conflict_names_the_other_task_and_the_colliding_path() {
    let fx = fx();
    let a = fx.task("A", &["src/"], w("src/a.rs"));
    let b = fx.task("B", &["src/x.rs"], w("src/x.rs"));
    fx.launch(&b);
    assert_eq!(
        conflict(&fx, &a, false, &vec![]),
        Some(ReadinessRefusal::OverlapsInFlight { task_id: b, path: "src/".into() })
    );
}

#[test]
fn launch_conflict_runs_a_task_with_no_declared_set_alone() {
    let fx = fx();
    let a = fx.task("A", &[], w("a.txt"));
    let b = fx.task("B", &["b/"], w("b/1"));
    fx.launch(&b);
    assert_eq!(conflict(&fx, &a, false, &vec![]), Some(ReadinessRefusal::RunsAlone { task_id: b }));
}

#[test]
fn launch_conflict_runs_alone_when_the_other_in_flight_task_has_no_declared_set() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &[], w("b.txt"));
    fx.launch(&b);
    assert_eq!(conflict(&fx, &a, false, &vec![]), Some(ReadinessRefusal::RunsAlone { task_id: b }));
}

#[test]
fn launch_conflict_lets_disjoint_declared_sets_run_together() {
    let fx = fx();
    let a = fx.task("A", &["a/"], w("a/1"));
    let b = fx.task("B", &["b/"], w("b/1"));
    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "nothing else in flight");
    fx.launch(&b);
    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "disjoint beside a live sibling");
}

#[test]
fn launch_conflict_is_per_repository_and_ignores_another_projects_colliding_run() {
    let fx = fx();
    let a = fx.task("A", &["src/"], w("src/a.rs"));

    let other_repo = tempfile::tempdir().unwrap();
    for args in [&["init", "--initial-branch=main"][..], &["config", "user.email", "o@x.y"], &["config", "user.name", "O"]] {
        git(other_repo.path(), args);
    }
    std::fs::write(other_repo.path().join("README.md"), "other\n").unwrap();
    git(other_repo.path(), &["add", "README.md"]);
    git(other_repo.path(), &["commit", "-m", "initial"]);
    let other = core::domain::project::create_project(
        &mut fx.conn(), &fx.human, "Other", &other_repo.path().to_string_lossy(), "OTH", "main",
    )
    .unwrap();
    let theirs = create_task(&mut fx.conn(), &other.id, &fx.human, "theirs", None).unwrap();
    declare_file_set(&mut fx.conn(), &theirs.id, &set(&["src/"]), &fx.human).unwrap();
    fx.launch(&theirs.id);

    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "the invariant is per-repository");
    let foreign: Taken = vec![(other.id.clone(), theirs.id.clone(), set(&["src/"]))];
    assert_eq!(conflict(&fx, &a, false, &foreign), None, "a chosen-in-this-decision task of another project is ignored too");
}

#[test]
fn launch_conflict_reads_the_rows_so_a_set_widened_mid_flight_is_seen() {
    let fx = fx();
    let a = fx.task("A", &["y/"], w("y/a"));
    let b = fx.task("B", &["x/"], w("x/b"));
    fx.launch(&b);
    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "disjoint when B started");
    let outcome = widen_file_set(&mut fx.conn(), &b, "y/", &fx.human).unwrap();
    assert!(matches!(outcome, core::domain::file_set::WidenOutcome::Accepted { .. }), "{outcome:?}");
    assert_eq!(
        conflict(&fx, &a, false, &vec![]),
        Some(ReadinessRefusal::OverlapsInFlight { task_id: b, path: "y/".into() }),
        "the widen that landed after B started still refuses A"
    );
}

#[test]
fn launch_conflict_compares_against_tasks_already_chosen_in_this_decision() {
    let fx = fx();
    let a = fx.task("A", &["src/"], w("src/a.rs"));
    let chosen = "task-chosen-earlier".to_string();
    let overlapping: Taken = vec![(fx.project_id.clone(), chosen.clone(), set(&["src/x.rs"]))];
    assert_eq!(
        conflict(&fx, &a, false, &overlapping),
        Some(ReadinessRefusal::OverlapsInFlight { task_id: chosen.clone(), path: "src/".into() })
    );
    let undeclared: Taken = vec![(fx.project_id.clone(), chosen.clone(), vec![])];
    assert_eq!(conflict(&fx, &a, false, &undeclared), Some(ReadinessRefusal::RunsAlone { task_id: chosen }));
    let disjoint: Taken = vec![(fx.project_id.clone(), "other".into(), set(&["docs/"]))];
    assert_eq!(conflict(&fx, &a, false, &disjoint), None);
}

#[test]
fn launch_conflict_honours_the_case_folding_flag_it_is_given() {
    let fx = fx();
    let a = fx.task("A", &["Src/Lib.rs"], w("Src/Lib.rs"));
    let b = fx.task("B", &["src/lib.rs"], w("src/lib.rs"));
    fx.launch(&b);
    assert_eq!(
        conflict(&fx, &a, true, &vec![]),
        Some(ReadinessRefusal::OverlapsInFlight { task_id: b, path: "Src/Lib.rs".into() }),
        "folded: the same file"
    );
    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "not folded: two files");
}

/// D-REV-39 IN-03. ASCII-only folding read `Écran.rs` and `écran.rs` as two files, which on a
/// case-insensitive filesystem are one: the pair that should collide read as disjoint, the unsafe
/// direction. The folded answer must be the strict one, through the predicate both callers share.
#[test]
fn launch_conflict_folds_non_ascii_case_so_the_strict_side_wins() {
    let fx = fx();
    let a = fx.task("A", &["src/Écran.rs"], w("src/Écran.rs"));
    let b = fx.task("B", &["src/écran.rs"], w("src/écran.rs"));
    fx.launch(&b);
    assert_eq!(
        conflict(&fx, &a, true, &vec![]),
        Some(ReadinessRefusal::OverlapsInFlight { task_id: b, path: "src/Écran.rs".into() }),
        "folded: the same file, even though the differing letter is not ASCII"
    );
    assert_eq!(conflict(&fx, &a, false, &vec![]), None, "not folded: two files");
    // The directory form goes through the same fold.
    assert!(core::file_set::overlaps(&set(&["Ünï/"])[0], &set(&["ünï/x.rs"])[0], true));
}

// ===== 09-12 Task 2: the decide-to-launch window =================================================
//
// `run_pass` decides under the lock, RELEASES it, then calls the spawn closure once per decided
// action with no lock held. A manual launch or a live widen can land in exactly that gap. The
// closure below is the shape of the real launch body: first let the world move (`intrude`), then
// ask the one rule, and refuse with an error. No sleep: the window is a lock release, not a duration.

fn runs_for(fx: &Fx, task: &str) -> i64 {
    fx.conn().query_row("SELECT COUNT(*) FROM agent_runs WHERE task_id = ?1", [task], |r| r.get(0)).unwrap()
}

/// One pass whose spawn closure runs `intrude` first, then consults the launch rule. Returns the
/// report and every refusal the rule produced, as the enum rather than as message text.
fn windowed_pass(
    fx: &Fx,
    intrude: impl Fn(&Fx, &str),
) -> (core::dispatch_exec::PassReport, Vec<ReadinessRefusal>) {
    let system = system_actor(&fx.conn()).unwrap().id;
    let refusals = Mutex::new(Vec::new());
    let report = run_pass(&fx.db, now(), &system, |plan, task| {
        intrude(fx, task);
        if let Some(refusal) = launch_conflict(&fx.conn(), task, &fx.project_id, false, &[]).unwrap() {
            let error = format!("{refusal:?}");
            refusals.lock().unwrap().push(refusal);
            return Err(error);
        }
        fx.spawn(plan, task)
    })
    .unwrap();
    (report, refusals.into_inner().unwrap())
}

/// Two colliding tasks in one wave: the dispatcher spawns A and sequences B behind it.
fn colliding_pair(fx: &Fx) -> (String, String, String) {
    let a = fx.task("A", &["src/"], w("src/a.rs"));
    let b = fx.task("B", &["src/x.rs"], w("src/x.rs"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "the fixture decides to spawn A alone");
    (plan, a, b)
}

#[test]
fn a_competing_run_landing_in_the_window_refuses_the_spawn_and_the_task_recovers() {
    let fx = fx();
    let (plan, a, b) = colliding_pair(&fx);
    let b_run = Mutex::new(None);

    let (report, refusals) = windowed_pass(&fx, |fx, _| {
        *b_run.lock().unwrap() = Some(fx.launch(&b)); // a manual launch of B, after the decision
    });

    assert_eq!(refusals, vec![ReadinessRefusal::OverlapsInFlight { task_id: b.clone(), path: "src/".into() }]);
    assert_eq!(report.spawned, 0);
    assert_eq!(runs_for(&fx, &a), 0, "refused before any run row exists: no cap slot leaks");
    let (phase, kind, _) = attention_for(&fx.conn(), &plan, &a).unwrap().unwrap();
    assert_eq!(phase, AttentionPhase::PreSpawn, "a launch failure is pre-spawn, so it retries");
    assert_eq!(kind, "launch_failed");
    assert_eq!(fx.state(&plan, &a), "needs_attention");
    assert!(
        !ready_tasks(&fx.conn(), &plan, &Observations::default()).unwrap().contains(&a),
        "while B holds the files A is not ready"
    );

    // B's run ends. The dispatcher's own readiness path now offers A again: it did not strand.
    fx.finish(&b, b_run.lock().unwrap().as_ref().unwrap());
    assert!(ready_tasks(&fx.conn(), &plan, &Observations::default()).unwrap().contains(&a));
    fx.drive(12, |fx| fx.state(&plan, &a) == "merged");
    assert_eq!(runs_for(&fx, &a), 1, "spawned normally once the competitor is gone");
}

#[test]
fn an_undeclared_competitor_in_the_window_is_the_runs_alone_refusal_not_an_overlap() {
    let fx = fx();
    let a = fx.task("A", &["src/"], w("src/a.rs"));
    let u = fx.task("U", &[], w("u.txt"));
    let plan = fx.plan(&[(&a, 1), (&u, 1)]);
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()]);

    let (_, refusals) = windowed_pass(&fx, |fx, _| {
        fx.launch(&u);
    });

    assert_eq!(refusals, vec![ReadinessRefusal::RunsAlone { task_id: u.clone() }]);
    assert_eq!(runs_for(&fx, &a), 0);
    let (phase, ..) = attention_for(&fx.conn(), &plan, &a).unwrap().unwrap();
    assert_eq!(phase, AttentionPhase::PreSpawn);
}

#[test]
fn a_live_widen_landing_in_the_window_refuses_the_spawn_and_leaves_exactly_one_run_on_the_files() {
    // D-REV-37: the widen half of the window. B is live on `x/`; A is disjoint (`y/`), so the
    // dispatcher decides to spawn A. Between that decision and the launch, B widens into `y/`.
    let fx = fx();
    let a = fx.task("A", &["y/"], w("y/a"));
    let b = fx.task("B", &["x/"], w("x/b"));
    let plan = fx.plan(&[(&a, 1), (&b, 1)]);
    fx.launch(&b);
    assert_eq!(spawns(&fx.actions()), vec![a.as_str()], "disjoint beside live B: the fixture decides to spawn A");

    let (report, refusals) = windowed_pass(&fx, |fx, _| {
        let outcome = widen_file_set(&mut fx.conn(), &b, "y/", &fx.human).unwrap();
        assert!(matches!(outcome, core::domain::file_set::WidenOutcome::Accepted { .. }), "{outcome:?}");
    });

    assert_eq!(refusals, vec![ReadinessRefusal::OverlapsInFlight { task_id: b.clone(), path: "y/".into() }]);
    assert_eq!(report.spawned, 0);
    assert_eq!(runs_for(&fx, &a), 0, "refused before any run row exists");
    let live: i64 = fx
        .conn()
        .query_row("SELECT COUNT(*) FROM agent_runs WHERE status IN ('running', 'blocked')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(live, 1, "exactly one live run on the overlapping files: B's");
    let (phase, kind, _) = attention_for(&fx.conn(), &plan, &a).unwrap().unwrap();
    assert_eq!((phase, kind.as_str()), (AttentionPhase::PreSpawn, "launch_failed"));
    assert!(
        !ready_tasks(&fx.conn(), &plan, &Observations::default()).unwrap().contains(&a),
        "A is not ready while B holds the files"
    );
    let edge: String = fx
        .conn()
        .query_row("SELECT cause FROM dispatch_edges WHERE before_task_id = ?1 AND after_task_id = ?2", [&b, &a], |r| r.get(0))
        .unwrap();
    assert_eq!(edge, "widen", "A waits for B's merge, not merely its run");
}

#[test]
fn with_no_competitor_in_the_window_the_same_fixture_spawns() {
    let fx = fx();
    let (plan, a, _b) = colliding_pair(&fx);

    let (report, refusals) = windowed_pass(&fx, |_, _| {});

    assert!(refusals.is_empty(), "{refusals:?}");
    assert_eq!(report.spawned, 1);
    assert_eq!(runs_for(&fx, &a), 1);
    assert_eq!(fx.state(&plan, &a), "running");
}
