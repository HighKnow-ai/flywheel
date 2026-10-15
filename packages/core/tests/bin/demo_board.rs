//! The demonstration board (phase 14, VIS-06, criterion 5): Flywheel's own `.planning/` seeded
//! into a SEPARATE database, with every runtime state the planning files cannot carry synthesised
//! on top, so a visual decision is judged on real work at real density and never on fixture rows.
//!
//! Usage: `demo_board <repo_root> [phase]` with `FLYWHEEL_APP_DATA_DIR` and
//! `FLYWHEEL_WORKTREE_ROOT` set. `phase` overrides the phase `STATE.md` calls current (the test
//! pins it so a later phase does not move the board under it).
//!
//! # The planner's reading of D-24 (the mapping)
//!
//! D-24's two clauses ("Cycles from the milestone's phases, epics from the roadmap's phase
//! entries") both point at phases. The reading that exercises every feature this phase builds:
//!
//! - **Cycle** = a roadmap phase (`### Phase N:` in `ROADMAP.md`). The current phase is the one
//!   `active` Cycle; later phases are `planned` Cycles (the roadmap ahead). Its goal is the
//!   phase's goal text. EARLIER phases get no Cycle: closing a Cycle is plan 14-06 and no `close`
//!   writer exists yet, and a hand-rolled `state = 'closed'` is forbidden. Their epics stay on the
//!   board, unassigned and done. `exit_criteria` stays NULL for the same reason: `create_cycle`
//!   takes no such parameter and no other writer sets it.
//! - **Epic** = a `*-PLAN.md` file (this milestone's `.planning/phases/*` and the archived
//!   `.planning/milestones/*-phases/*`), assigned to its phase's Cycle when that phase has one.
//! - **Task** = a `<task>` entry inside a plan, titled from its `<name>` element.
//! - **Issue** = a file in `.planning/todos/pending/`; `severity` maps onto the four `kind` values
//!   the schema permits.
//!
//! # What is synthetic, and what is deterministic
//!
//! Statuses inside the ACTIVE phase are assigned by plan ordinal ([`ACTIVE_PHASE_ROLES`]), not by
//! whether a SUMMARY exists, so the board keeps carrying every state class as the phase's own plans
//! finish (a time bomb otherwise). Statuses elsewhere follow the SUMMARY on disk.
//!
//! Every title, key (the project counter), rank (the domain writers' tail-rank rule over a fixed
//! insertion order), parent and status is a pure function of the source files. The ROW IDS are NOT:
//! every domain writer mints its own time-ordered ULID internally, there is no seam to supply one,
//! and adding such a seam to production id generation for a dev tool was declined. "The board does
//! not change between runs" therefore means: same items, same order, same states. The test pins
//! exactly that with an id-free fingerprint. This binary never mints an id itself, and a
//! time-ordered ULID would be the wrong thing to derive an id from here anyway: it encodes the
//! clock, which is the thing determinism forbids.
//!
//! # The processless live rows (D-25's named task-level concern)
//!
//! A `running` or `blocked` row has no process behind it. Two reads decide what that means:
//! - the session surface reads the session LOG by run id and subscribes to pushed events; it never
//!   looks a process up, so an empty log is an empty feed, not an error;
//! - `reconcile_agent_runs` runs at every app launch and rewrites any `running`/`blocked` row whose
//!   run descriptor (the on-disk record holding the pid and start time; the table has no pid
//!   column) names no live process into `abandoned`. We write NO descriptor, so the rows are
//!   classified as processless. Without protection the app would flip every live row to abandoned
//!   before the first paint, and the board would never show running or blocked at all. The other
//!   outcome (a live pid) puts the row in the blocking orphan-recovery modal.
//!
//! So the live rows are protected by one `BEFORE UPDATE` trigger in THIS database only (not a
//! migration, not shipped): the reconciler's own write to `abandoned` is ignored for exactly these
//! ids. The alternative was an environment switch inside `main.rs`, which would put demo logic in
//! the product. If the reconciler stops being the thing that decides this, the trigger is dead
//! weight and `tests/demo_board.rs` (which runs the real reconciler) fails.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use core::domain::agent_run::{self, AgentRunStatus};
use core::domain::authoring_proposal::{self, ProposalPayload, ProposalProvenance, ProposalVerb};
use core::domain::{actor, authoring_session, cycle, epic, issue, permission_request, project, task, worktree};
use rusqlite::{params, Connection};

// ---- The floors. A short board is a failure, not a smaller success. -------------------------

/// One active Cycle plus the roadmap ahead of it: the region and the roster both need a later Cycle.
const MIN_CYCLES: usize = 3;
/// Realistic density: this milestone's plans alone are 28; the archived history is far more.
const MIN_EPICS: usize = 25;
/// Same reason; the milestone's plans alone carry about 80 task entries.
const MIN_TASKS: usize = 80;
/// The pending todos: a board with an empty issues lane is not the board being judged.
const MIN_ISSUES: usize = 5;
/// Plans the active phase must hold so every [`ACTIVE_PHASE_ROLES`] slot has a plan to land on.
const MIN_ACTIVE_PHASE_PLANS: usize = 10;
/// Every state class the board must carry, each at least once. The names are the printed keys.
const STATE_CLASSES: [&str; 10] = [
    "running",
    "blocked",
    "failed",
    "completed",
    "abandoned",
    "awaiting_review",
    "proposals_pending",
    "commits_ahead",
    "dirty",
    "merged",
];

/// What each plan of the active phase plays, by ordinal.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Role {
    /// Finished work: every task done.
    Done,
    /// The lead: one task done, one running, one still to do. The epic mid-flight.
    Lead,
    Blocked,
    /// A completed run whose task is not done: the fleet read derives awaiting review from that.
    Awaiting,
    Failed,
    Abandoned,
    /// A task branch merged into its epic's integration branch.
    Merged,
    /// One worktree with commits ahead, one with a dirty tree.
    AheadDirty,
    /// An authoring session with staged, undecided proposals.
    Proposals,
}

const ACTIVE_PHASE_ROLES: [Role; MIN_ACTIVE_PHASE_PLANS] = [
    Role::Done,
    Role::Done,
    Role::Lead,
    Role::Blocked,
    Role::Awaiting,
    Role::Failed,
    Role::Abandoned,
    Role::Merged,
    Role::AheadDirty,
    Role::Proposals,
];

fn fail(message: &str) -> ! {
    eprintln!("{message}");
    std::process::exit(1);
}

fn must<T>(result: anyhow::Result<T>, what: &str) -> T {
    result.unwrap_or_else(|err| fail(&format!("{what}: {err:#}")))
}

// ---- Reading the planning tree --------------------------------------------------------------

struct RoadmapPhase {
    number: f64,
    name: String,
    goal: String,
}

struct PlanDoc {
    phase_number: f64,
    key: String,
    title: String,
    source: String,
    tasks: Vec<String>,
    has_summary: bool,
}

struct TodoDoc {
    title: String,
    body: Option<String>,
    kind: &'static str,
}

fn tidy(text: &str, max: usize) -> String {
    let flat: String = text.replace("**", "").replace('`', "");
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let cut: String = flat.chars().take(max).collect();
    match cut.rfind(' ') {
        Some(at) => format!("{}…", &cut[..at]),
        None => format!("{cut}…"),
    }
}

fn read(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_else(|err| fail(&format!("could not read {}: {err}", path.display())))
}

fn sorted_entries(dir: &Path) -> Vec<PathBuf> {
    let mut entries: Vec<PathBuf> = match std::fs::read_dir(dir) {
        Ok(read_dir) => read_dir.filter_map(|e| e.ok().map(|e| e.path())).collect(),
        Err(_) => Vec::new(),
    };
    entries.sort();
    entries
}

fn phase_number_of(dir_name: &str) -> Option<f64> {
    dir_name.split('-').next()?.parse::<f64>().ok()
}

/// `### Phase N: Name` blocks of the roadmap, each with its `**Goal**` paragraph.
fn read_roadmap(root: &Path) -> (Vec<RoadmapPhase>, HashMap<String, String>) {
    let text = read(&root.join(".planning/ROADMAP.md"));
    let mut phases = Vec::new();
    let mut plan_lines = HashMap::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some(rest) = line.strip_prefix("### Phase ") {
            if let Some((number, name)) = rest.split_once(':') {
                if let Ok(number) = number.trim().parse::<f64>() {
                    let mut goal = String::new();
                    let mut j = i + 1;
                    while j < lines.len() && !lines[j].starts_with("### ") && !lines[j].starts_with("## ") {
                        if let Some(first) = lines[j].strip_prefix("**Goal**:") {
                            goal.push_str(first);
                            j += 1;
                            while j < lines.len() && !lines[j].trim().is_empty() {
                                goal.push(' ');
                                goal.push_str(lines[j]);
                                j += 1;
                            }
                            break;
                        }
                        j += 1;
                    }
                    phases.push(RoadmapPhase { number, name: tidy(name, 120), goal: tidy(&goal, 600) });
                }
            }
        }
        // `- [x] 14-01-PLAN.md — the title (REQ-01, REQ-02)`
        if let Some(at) = line.find("-PLAN.md — ") {
            let before = &line[..at];
            if let Some(key) = before.split_whitespace().last() {
                let mut title = line[at + "-PLAN.md — ".len()..].trim().to_string();
                if let (Some(open), true) = (title.rfind(" ("), title.ends_with(')')) {
                    let inner = &title[open + 2..title.len() - 1];
                    if inner.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-' || c == ',' || c == ' ') {
                        title.truncate(open);
                    }
                }
                plan_lines.insert(key.to_string(), tidy(&title, 110));
            }
        }
        i += 1;
    }
    (phases, plan_lines)
}

/// The `<name>` of every `<task>` entry, ignoring fenced code. A task with no name is an error:
/// it would be a silent drop.
fn read_task_names(plan_text: &str, plan: &str) -> Vec<String> {
    let mut names = Vec::new();
    let (mut in_fence, mut awaiting_name) = (false, false);
    for line in plan_text.lines() {
        if line.trim_start().starts_with("```") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        let trimmed = line.trim_start();
        if trimmed.starts_with("<task") && trimmed[5..].starts_with([' ', '>', '\t']) {
            if awaiting_name {
                fail(&format!("{plan}: a <task> entry has no <name>"));
            }
            awaiting_name = true;
        }
        if awaiting_name {
            if let (Some(a), Some(b)) = (line.find("<name>"), line.find("</name>")) {
                let raw = &line[a + 6..b];
                let raw = match raw.split_once(':') {
                    Some((head, tail)) if head.trim_start().starts_with("Task ") => tail,
                    _ => raw,
                };
                names.push(tidy(raw, 140));
                awaiting_name = false;
            }
        }
    }
    if awaiting_name {
        fail(&format!("{plan}: a <task> entry has no <name>"));
    }
    names
}

fn first_objective_sentence(plan_text: &str) -> Option<String> {
    let mut collected = String::new();
    let mut inside = false;
    for line in plan_text.lines() {
        if line.contains("<objective>") {
            inside = true;
            continue;
        }
        if inside {
            if line.trim().is_empty() && !collected.is_empty() {
                break;
            }
            collected.push(' ');
            collected.push_str(line);
        }
    }
    let flat = tidy(&collected, 400);
    if flat.is_empty() {
        return None;
    }
    let sentence = match flat.find(". ") {
        Some(at) => flat[..at].to_string(),
        None => flat,
    };
    Some(tidy(&sentence, 110))
}

fn read_plans(root: &Path, roadmap_titles: &HashMap<String, String>) -> Vec<PlanDoc> {
    let mut phase_dirs: Vec<(f64, PathBuf)> = Vec::new();
    for parent in std::iter::once(root.join(".planning/phases"))
        .chain(sorted_entries(&root.join(".planning/milestones")).into_iter().filter(|p| {
            p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.ends_with("-phases"))
        }))
    {
        for dir in sorted_entries(&parent) {
            if let Some(number) = dir.file_name().and_then(|n| n.to_str()).and_then(phase_number_of) {
                if dir.is_dir() {
                    phase_dirs.push((number, dir));
                }
            }
        }
    }
    phase_dirs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));

    let mut plans = Vec::new();
    for (number, dir) in phase_dirs {
        for file in sorted_entries(&dir) {
            let Some(name) = file.file_name().and_then(|n| n.to_str()) else { continue };
            let Some(key) = name.strip_suffix("-PLAN.md") else { continue };
            let text = read(&file);
            let tasks = read_task_names(&text, name);
            let title = roadmap_titles
                .get(key)
                .cloned()
                .or_else(|| first_objective_sentence(&text))
                .unwrap_or_else(|| fail(&format!("{name}: no roadmap line and no objective to title the epic from")));
            plans.push(PlanDoc {
                phase_number: number,
                key: key.to_string(),
                title: format!("{key}: {title}"),
                source: file.strip_prefix(root).unwrap_or(&file).display().to_string(),
                tasks,
                has_summary: dir.join(format!("{key}-SUMMARY.md")).exists(),
            });
        }
    }
    plans
}

fn read_todos(root: &Path) -> Vec<TodoDoc> {
    let mut todos = Vec::new();
    for file in sorted_entries(&root.join(".planning/todos/pending")) {
        if file.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let text = read(&file);
        let (mut title, mut severity) = (None, "");
        for line in text.lines().take(12) {
            if let Some(value) = line.strip_prefix("title:") {
                title = Some(tidy(value.trim().trim_matches('"'), 140));
            }
            if let Some(value) = line.strip_prefix("severity:") {
                severity = value.trim();
            }
        }
        let Some(title) = title else {
            fail(&format!("{}: a pending todo with no title", file.display()))
        };
        let body = text
            .split("## Problem")
            .nth(1)
            .map(|rest| tidy(rest.lines().skip(1).take_while(|l| !l.starts_with("## ")).collect::<Vec<_>>().join(" ").as_str(), 500))
            .filter(|b| !b.is_empty());
        let kind = match severity {
            "blocker" | "major" => "bug",
            "minor" => "risk",
            _ => "idea",
        };
        todos.push(TodoDoc { title, body, kind });
    }
    todos
}

fn current_phase(root: &Path, override_arg: Option<&String>) -> f64 {
    if let Some(arg) = override_arg {
        return arg.parse().unwrap_or_else(|_| fail(&format!("phase {arg:?} is not a number")));
    }
    read(&root.join(".planning/STATE.md"))
        .lines()
        .find_map(|l| l.strip_prefix("current_phase:").and_then(|v| v.trim().trim_matches('"').parse::<f64>().ok()))
        .unwrap_or_else(|| fail("STATE.md names no current_phase, and none was given as the second argument"))
}

// ---- Git helpers (through the crate's one spawning site) -------------------------------------

fn git(dir: &Path, args: &[&str]) {
    must(core::git::git_at(dir, args).map(|_| ()), &format!("git {args:?} in {}", dir.display()));
}

fn commit_file(worktree: &Path, file: &str, content: &str, message: &str) {
    must(std::fs::write(worktree.join(file), content).map_err(Into::into), "write a worktree file");
    git(worktree, &["add", file]);
    git(worktree, &["commit", "-q", "-m", message]);
}

fn make_demo_repo(app_data: &Path) -> PathBuf {
    let repo = app_data.join("demo-project");
    must(std::fs::create_dir_all(&repo).map_err(Into::into), "create the demo repository directory");
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["config", "user.name", "Flywheel Demo"]);
    git(&repo, &["config", "user.email", "demo@flywheel.invalid"]);
    commit_file(&repo, "README.md", "# Flywheel demo project\n", "initial commit");
    repo
}

// ---- Seeding ---------------------------------------------------------------------------------

struct Seeded {
    epics: Vec<(epic::Epic, Vec<task::Task>)>,
    live_run_ids: Vec<String>,
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let Some(root) = args.first().map(PathBuf::from) else {
        fail("usage: demo_board <repo_root> [phase]")
    };
    // Refusing rather than defaulting: the default would be the developer's real fleet database.
    let app_data = std::env::var_os("FLYWHEEL_APP_DATA_DIR").map(PathBuf::from).unwrap_or_else(|| {
        fail(
            "FLYWHEEL_APP_DATA_DIR is not set - refusing to seed a demonstration board into the real \
             fleet database (~/Library/Application Support/Flywheel). Point it at a scratch directory.",
        )
    });
    if std::env::var_os("FLYWHEEL_WORKTREE_ROOT").is_none() {
        fail(
            "FLYWHEEL_WORKTREE_ROOT is not set - the default worktree root is ~/Flywheel/, the \
             developer's real worktrees. Point it at a scratch directory.",
        );
    }

    // ---- read every level; an empty level is a failure naming it
    let (phases, roadmap_titles) = read_roadmap(&root);
    if phases.is_empty() {
        fail("the roadmap level produced no phase entries - refusing to seed a board with no Cycle layer");
    }
    let plans = read_plans(&root, &roadmap_titles);
    if plans.is_empty() {
        fail("the phases level produced no plan files - refusing to seed a board with no epics");
    }
    let todos = read_todos(&root);
    if todos.is_empty() {
        fail("the pending-todos level produced no entries - refusing to seed a board with no issues");
    }
    let active = current_phase(&root, args.get(1));
    let Some(active_phase) = phases.iter().find(|p| p.number == active) else {
        fail(&format!("the roadmap has no phase {active}, so there is no active Cycle to seed"))
    };
    let active_plans: Vec<usize> =
        plans.iter().enumerate().filter(|(_, p)| p.phase_number == active).map(|(i, _)| i).collect();
    if active_plans.len() < MIN_ACTIVE_PHASE_PLANS {
        fail(&format!(
            "the active phase {active} holds {} plan files; the runtime layer needs {MIN_ACTIVE_PHASE_PLANS}",
            active_plans.len()
        ));
    }
    let parsed_tasks: usize = plans.iter().map(|p| p.tasks.len()).sum();

    // ---- the database
    let db_path = must(core::db::default_db_path(), "could not resolve the database path");
    let backups = must(core::db::default_backups_dir(), "could not resolve the backups directory");
    let mut conn = must(core::db::open_and_migrate(&db_path, &backups), "could not open the database");
    let human = must(actor::local_human_actor_id(&conn), "could not resolve the local human actor");
    if !must(project::list_projects(&conn), "could not list projects").is_empty() {
        fail("this database already holds a project - refusing to seed a demonstration board on top of it");
    }

    // `register_project`, not `create_project`: the marker-free one is flagged unreachable by the
    // launch reconciler (see `uat_seed_ui.rs`). The marker lands in the DEMO repository.
    let repo = make_demo_repo(&app_data);
    let proj = must(project::register_project(&mut conn, &human, &repo, "Flywheel", "FLY"), "register the project");

    // ---- Cycles: the active phase and the roadmap ahead of it
    let mut cycle_of_phase: HashMap<u64, cycle::Cycle> = HashMap::new();
    let mut ahead: Vec<&RoadmapPhase> = phases.iter().filter(|p| p.number >= active).collect();
    ahead.sort_by(|a, b| a.number.partial_cmp(&b.number).unwrap_or(std::cmp::Ordering::Equal));
    for phase in &ahead {
        let goal = if phase.goal.is_empty() { phase.name.clone() } else { phase.goal.clone() };
        let created = must(cycle::create_cycle(&mut conn, &proj.id, &goal, &human), "create a Cycle");
        cycle_of_phase.insert(phase.number.to_bits(), created);
    }
    let active_cycle = cycle_of_phase[&active_phase.number.to_bits()].clone();
    must(cycle::start_cycle(&mut conn, &active_cycle.id, &human), "start the active Cycle");

    // ---- epics and tasks, in one transaction, in source order
    let mut seeded = Seeded { epics: Vec::new(), live_run_ids: Vec::new() };
    let role_of = |index: usize| -> Option<Role> {
        active_plans.iter().position(|i| *i == index).and_then(|ordinal| ACTIVE_PHASE_ROLES.get(ordinal).copied())
    };
    {
        let now = chrono::Utc::now().to_rfc3339();
        let tx = must(conn.transaction().map_err(Into::into), "open the seeding transaction");
        for (index, plan) in plans.iter().enumerate() {
            let description = format!("Seeded from {}", plan.source);
            let made = must(epic::create_epic_in_tx(&tx, &proj.id, &human, &plan.title, Some(&description), &now), "create an epic");
            let mut tasks = Vec::new();
            for (position, name) in plan.tasks.iter().enumerate() {
                let created = must(task::create_task_in_tx(&tx, &proj.id, &human, name, Some(&made.id), &now), "create a task");
                let finished = match role_of(index) {
                    Some(Role::Done) => true,
                    Some(Role::Lead) => position == 0,
                    Some(_) => false,
                    None => plan.phase_number != active && plan.has_summary,
                };
                if finished {
                    must(task::set_task_status_in_tx(&tx, &human, &created.id, "done"), "finish a task");
                }
                tasks.push(created);
            }
            seeded.epics.push((made, tasks));
        }
        for todo in &todos {
            must(
                issue::create_issue_in_tx(&tx, &proj.id, &human, &todo.title, todo.body.as_deref(), todo.kind, issue::IssueParent::None, &now),
                "create an issue",
            );
        }
        must(tx.commit().map_err(Into::into), "commit the seeding transaction");
    }

    // ---- Cycle membership and epic status
    for (index, plan) in plans.iter().enumerate() {
        let epic_id = seeded.epics[index].0.id.clone();
        if let Some(target) = cycle_of_phase.get(&plan.phase_number.to_bits()) {
            must(cycle::assign_epic_to_cycle(&mut conn, &epic_id, &target.id, &human), "assign an epic to its Cycle");
        }
        let status = match role_of(index) {
            Some(Role::Done) => "done",
            Some(_) => "in_progress",
            None if plan.phase_number != active && plan.has_summary => "done",
            None => "todo",
        };
        must(epic::set_epic_status(&mut conn, &human, &epic_id, status), "set an epic status");
    }

    // ---- the runtime layer
    for &index in &active_plans {
        let Some(role) = role_of(index) else { continue };
        let plan = &plans[index];
        let (epic_row, tasks) = (seeded.epics[index].0.clone(), seeded.epics[index].1.clone());
        let need = if matches!(role, Role::Lead | Role::AheadDirty) { if role == Role::Lead { 3 } else { 2 } } else { 1 };
        if tasks.len() < need {
            fail(&format!("{} holds {} task entries; its {role:?} role needs {need}", plan.key, tasks.len()));
        }
        match role {
            Role::Done => {}
            Role::Lead => {
                let run = must(agent_run::start_agent_run(&mut conn, &tasks[1].id, "default", &human), "start the running run");
                seeded.live_run_ids.push(run.id);
            }
            Role::Blocked => {
                let run = must(agent_run::start_agent_run(&mut conn, &tasks[0].id, "default", &human), "start the blocked run");
                must(
                    permission_request::create_pending_request(&mut conn, &run.id, "Bash", Some(r#"{"command":"cargo test -p core"}"#), &human, None),
                    "block the run on a permission request",
                );
                seeded.live_run_ids.push(run.id);
            }
            Role::Awaiting => {
                let run = must(agent_run::start_agent_run(&mut conn, &tasks[0].id, "default", &human), "start the completed run");
                must(
                    agent_run::close_agent_run(&mut conn, &run.id, AgentRunStatus::Completed, Some(0.42), Some(48_200), Some(9_700)),
                    "complete the run",
                );
            }
            Role::Failed => {
                let run = must(agent_run::start_agent_run(&mut conn, &tasks[0].id, "default", &human), "start the failed run");
                must(agent_run::close_agent_run(&mut conn, &run.id, AgentRunStatus::Failed, Some(0.17), Some(21_000), Some(2_400)), "fail the run");
            }
            Role::Abandoned => {
                let run = must(agent_run::start_agent_run(&mut conn, &tasks[0].id, "default", &human), "start the abandoned run");
                must(
                    agent_run::mark_abandoned(&mut conn, &run.id, &human, Some("the app closed while the run was live")),
                    "abandon the run",
                );
            }
            Role::Merged => {
                let wt = must(worktree::ensure_worktree(&mut conn, &tasks[0].id, &human), "create the merged task's worktree");
                commit_file(Path::new(&wt.path), "merged-change.txt", "a change that landed\n", "demo: a change that landed");
                let plan_to_merge = must(core::merge::plan_merge(&conn, &tasks[0].id), "plan the merge");
                let outcome = must(core::merge::run_merge(&plan_to_merge), "run the merge");
                must(core::merge::record_merge_event(&mut conn, &plan_to_merge, &outcome, &human), "record the merge");
            }
            Role::AheadDirty => {
                let ahead_wt = must(worktree::ensure_worktree(&mut conn, &tasks[0].id, &human), "create the ahead worktree");
                commit_file(Path::new(&ahead_wt.path), "ahead-1.txt", "one\n", "demo: first commit ahead");
                commit_file(Path::new(&ahead_wt.path), "ahead-2.txt", "two\n", "demo: second commit ahead");
                let dirty_wt = must(worktree::ensure_worktree(&mut conn, &tasks[1].id, &human), "create the dirty worktree");
                must(std::fs::write(Path::new(&dirty_wt.path).join("scratch.txt"), "uncommitted\n").map_err(Into::into), "dirty a worktree");
            }
            Role::Proposals => {
                let session = must(
                    authoring_session::start_authoring_run(&mut conn, &proj.id, Some(&epic_row.id), "default", &human),
                    "start the authoring session",
                );
                for title in ["Cover the empty Cycle in the region", "Name the closed-Cycle state in words", "Pin the roster ceiling in a test"] {
                    must(
                        authoring_proposal::create_proposal(
                            &mut conn,
                            &session.id,
                            ProposalVerb::Create,
                            ProposalPayload::Task { title: title.to_string(), description: None, priority: None },
                            None,
                            None,
                            ProposalProvenance::NONE,
                        ),
                        "stage a proposal",
                    );
                }
                seeded.live_run_ids.push(session.id);
            }
        }
    }

    // ---- keep the live rows live across the app's launch reconciliation (see the header)
    if !seeded.live_run_ids.is_empty() {
        let ids = seeded.live_run_ids.iter().map(|id| format!("'{id}'")).collect::<Vec<_>>().join(",");
        must(
            conn.execute_batch(&format!(
                "CREATE TRIGGER demo_board_keep_live_runs BEFORE UPDATE OF status ON agent_runs \
                 WHEN NEW.status = 'abandoned' AND OLD.id IN ({ids}) BEGIN SELECT RAISE(IGNORE); END;"
            ))
            .map_err(Into::into),
            "protect the live rows from launch reconciliation",
        );
    }

    // ---- measure what was actually written, then hold it to the floors
    let facts = measure(&conn, &proj.id);
    let mut shortfalls = Vec::new();
    let expected_cycles = ahead.len();
    for (level, got, parsed) in [
        ("cycles", facts.count("cycles"), expected_cycles),
        ("epics", facts.count("epics"), plans.len()),
        ("tasks", facts.count("tasks"), parsed_tasks),
        ("issues", facts.count("issues"), todos.len()),
    ] {
        if got != parsed {
            shortfalls.push(format!("{level}: inserted {got} but parsed {parsed} (a collision or a silent drop)"));
        }
    }
    for (level, got, floor) in [
        ("cycles", facts.count("cycles"), MIN_CYCLES),
        ("epics", facts.count("epics"), MIN_EPICS),
        ("tasks", facts.count("tasks"), MIN_TASKS),
        ("issues", facts.count("issues"), MIN_ISSUES),
    ] {
        if got < floor {
            shortfalls.push(format!("{level}: {got} is below the floor of {floor}"));
        }
    }
    if facts.count("active_cycles") != 1 {
        shortfalls.push(format!("cycles: {} active, expected exactly 1", facts.count("active_cycles")));
    }
    if facts.count("planned_cycles") < 1 {
        shortfalls.push("cycles: no planned Cycle, so there is no roadmap ahead".to_string());
    }
    for class in STATE_CLASSES {
        if facts.count(class) == 0 {
            shortfalls.push(format!("state class {class}: absent"));
        }
    }
    let lead = lead_epic(&conn, &proj.id, &active_cycle.id);
    if lead.is_none() {
        shortfalls.push("lead row: the first epic on the board is not in the active Cycle".to_string());
    }
    if !shortfalls.is_empty() {
        for line in &shortfalls {
            eprintln!("demo board floor not met - {line}");
        }
        std::process::exit(1);
    }
    let (lead_key, lead_title) = lead.unwrap_or_default();

    println!("Demonstration board: {}", db_path.display());
    println!("  project:       {} ({})", proj.name, proj.id);
    println!("  active Cycle:  {} - {}", active_cycle.key, tidy(&active_cycle.goal, 90));
    println!("  lead epic:     {lead_key} {lead_title}");
    let counts: Vec<String> = ["cycles", "epics", "tasks", "issues"]
        .iter()
        .chain(STATE_CLASSES.iter())
        .map(|name| format!("{name}={}", facts.count(name)))
        .collect();
    println!("SEEDED {} active_cycle={} lead_epic={}", counts.join(" "), active_cycle.key, lead_key);
}

/// The first epic in board order, if it is in the active Cycle. "Lead" is the board's own order
/// (`list_epics`: status band, priority, rank, id), never insertion order.
fn lead_epic(conn: &Connection, project_id: &str, cycle_id: &str) -> Option<(String, String)> {
    let roster = must(epic::list_epics(conn, project_id), "list the epics");
    let first = roster.epics.first()?;
    let in_cycle: bool = must(
        conn.query_row("SELECT cycle_id = ?2 FROM epics WHERE id = ?1", params![first.id, cycle_id], |r| r.get::<_, Option<bool>>(0))
            .map_err(Into::into),
        "read the lead epic's Cycle",
    )
    .unwrap_or(false);
    in_cycle.then(|| (first.key.clone(), first.title.clone()))
}

struct Facts(HashMap<&'static str, usize>);

impl Facts {
    fn count(&self, name: &str) -> usize {
        self.0.get(name).copied().unwrap_or(0)
    }
}

fn scalar(conn: &Connection, sql: &str, project_id: &str) -> usize {
    must(conn.query_row(sql, params![project_id], |r| r.get::<_, i64>(0)).map_err(Into::into), sql) as usize
}

/// Every count the floors and the printed line need, read back from the written database through
/// the product's own reads where the product derives the state (fleet, change flags, merge marker).
fn measure(conn: &Connection, project_id: &str) -> Facts {
    let mut facts: HashMap<&'static str, usize> = HashMap::new();
    for (name, sql) in [
        ("cycles", "SELECT COUNT(*) FROM cycles WHERE project_id = ?1"),
        ("active_cycles", "SELECT COUNT(*) FROM cycles WHERE project_id = ?1 AND state = 'active'"),
        ("planned_cycles", "SELECT COUNT(*) FROM cycles WHERE project_id = ?1 AND state = 'planned'"),
        ("epics", "SELECT COUNT(*) FROM epics WHERE project_id = ?1"),
        ("tasks", "SELECT COUNT(*) FROM tasks WHERE project_id = ?1"),
        ("issues", "SELECT COUNT(*) FROM issues WHERE project_id = ?1"),
        ("running", "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1 AND status = 'running'"),
        ("blocked", "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1 AND status = 'blocked'"),
        ("failed", "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1 AND status = 'failed'"),
        ("completed", "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1 AND status = 'completed'"),
        ("abandoned", "SELECT COUNT(*) FROM agent_runs WHERE project_id = ?1 AND status = 'abandoned'"),
        ("proposals_pending", "SELECT COUNT(*) FROM authoring_proposals WHERE project_id = ?1 AND status = 'pending'"),
    ] {
        facts.insert(name, scalar(conn, sql, project_id));
    }

    // Awaiting review is stored in no column; the fleet read derives it, so ask the fleet read.
    let fleet = must(core::query::fleet::fleet_rows(conn, 200), "read the fleet");
    facts.insert("awaiting_review", fleet.rows.iter().filter(|r| r.fleet_state == "awaiting_review").count());

    // Change flags are derived from real git state, per active worktree.
    let inputs = must(core::query::change_flags::change_flag_inputs(conn, project_id, 1000), "read the change-flag inputs");
    let flags = must(core::query::change_flags::finish_change_flags(inputs), "read the change flags");
    facts.insert("commits_ahead", flags.iter().filter(|f| f.ahead.unwrap_or(0) > 0).count());
    facts.insert("dirty", flags.iter().filter(|f| f.dirty).count());

    // Merged: the recorded merge event plus a live ancestry check, the product's own marker.
    let mut stmt = must(
        conn.prepare(
            "SELECT DISTINCT t.id, p.repo_path, e.integration_branch FROM events ev \
             JOIN tasks t ON t.id = ev.task_id JOIN epics e ON e.id = t.epic_id JOIN projects p ON p.id = t.project_id \
             WHERE ev.project_id = ?1 AND ev.event_type = ?2 AND e.integration_branch IS NOT NULL",
        )
        .map_err(Into::into),
        "prepare the merged read",
    );
    let rows: Vec<(String, String, String)> = must(
        stmt.query_map(params![project_id, core::merge::EVENT_TASK_INTEGRATED], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .and_then(|it| it.collect::<Result<Vec<_>, _>>())
            .map_err(Into::into),
        "read the merged tasks",
    );
    let merged = rows
        .iter()
        .filter(|(task_id, repo, branch)| core::merge::is_integrated(conn, Path::new(repo), task_id, branch).unwrap_or(false))
        .count();
    facts.insert("merged", merged);
    Facts(facts)
}
