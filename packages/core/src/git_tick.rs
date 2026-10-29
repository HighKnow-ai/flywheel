//! The body of the git-truth ticks (D-113/D-114/D-116), over the shared board connection's mutex:
//! the desktop scheduler (`packages/desktop/src-tauri/src/scheduler.rs`) owns only the cadence and
//! the board-invalidation emit.
//!
//! Every tick runs in three phases, and git runs only in the middle one (issue #215): read what it
//! needs under the lock, release it, run git with no connection in scope, then take the lock again
//! only to write what git showed. An IPC read waits for at most one phase's database work, never
//! for a tick's git: on a fleet of slow worktrees a git pass takes seconds, and every screen of the
//! app reads through this mutex.
//!
//! Nothing here caches a git fact: every tick re-derives them from git (D-75/D-128). The digest map
//! the caller passes is a change-detector for the notification only.

use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::domain::actor::system_actor;
use crate::git_facts::{
    plan_git_facts, read_git_facts, record_outside_commits_in, tracked_worktrees, GitFacts,
};

/// The last-seen digest per Story id, shared by the hot and cold ticks. Never read as an answer to
/// any question other than "did this change since the last tick" (D-75/D-128).
pub type Digests = Mutex<HashMap<String, u64>>;

/// Lock `db`, or `None` (logged) when a panic poisoned it: the tick skips that phase rather than
/// stop the scheduler.
fn lock<'a>(
    db: &'a Mutex<Connection>,
    tier: &str,
) -> Option<std::sync::MutexGuard<'a, Connection>> {
    match db.lock() {
        Ok(conn) => Some(conn),
        Err(_) => {
            eprintln!(
                "git-truth {tier} tick: the board database lock was poisoned, skipping this tick"
            );
            None
        }
    }
}

/// A digest of `facts`' serialized form: cheap, order-stable, and never stored or read as anything
/// but a change-detector.
fn digest_of(facts: &GitFacts) -> Option<u64> {
    let serialized = serde_json::to_string(facts).ok()?;
    let mut hasher = DefaultHasher::new();
    serialized.hash(&mut hasher);
    Some(hasher.finish())
}

/// Record `facts`' digest for `story_id` and say whether it changed since the last tick.
fn record_digest(digests: &Digests, story_id: &str, facts: &GitFacts) -> bool {
    let Some(new_digest) = digest_of(facts) else {
        return false;
    };
    let mut map = match digests.lock() {
        Ok(map) => map,
        Err(poisoned) => poisoned.into_inner(),
    };
    map.insert(story_id.to_string(), new_digest) != Some(new_digest)
}

fn project_of_story(conn: &Connection, story_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT project_id FROM stories WHERE id = ?1",
        params![story_id],
        |r| r.get(0),
    )
    .ok()
}

/// D-114's hot tier: every worktree with a live session, unioned with `focused` (the Story the
/// renderer says it shows). Database only.
pub fn hot_story_ids(db: &Mutex<Connection>, focused: Option<String>) -> Vec<String> {
    let mut ids: HashSet<String> = match lock(db, "hot").map(|conn| tracked_worktrees(&conn, true))
    {
        Some(Ok(rows)) => rows.into_iter().map(|w| w.story_id).collect(),
        Some(Err(err)) => {
            eprintln!("git-truth hot tick: failed to read tracked worktrees: {err:#}");
            HashSet::new()
        }
        None => HashSet::new(),
    };
    ids.extend(focused);
    ids.into_iter().collect()
}

/// D-114's cold tier: every tracked worktree, regardless of hot-tier membership. Database only.
pub fn cold_story_ids(db: &Mutex<Connection>) -> Vec<String> {
    match lock(db, "cold").map(|conn| tracked_worktrees(&conn, false)) {
        Some(Ok(rows)) => rows.into_iter().map(|w| w.story_id).collect(),
        Some(Err(err)) => {
            eprintln!("git-truth cold tick: failed to read tracked worktrees: {err:#}");
            Vec::new()
        }
        None => Vec::new(),
    }
}

/// One git-facts pass over `story_ids`: read each Story's git facts, digest them, notice commits
/// made by hand on its branch (LINK-10/D-115), and return every project whose facts changed (`None`
/// for a Story whose project could not be resolved). A failure on one Story is logged and never
/// abandons the rest.
///
/// The lock is held twice, for database work only: once to plan every Story's read, once to write
/// what the reads found. Git runs between the two with the lock released.
pub fn git_facts_tick(
    db: &Mutex<Connection>,
    story_ids: &[String],
    digests: &Digests,
    tier: &str,
) -> HashSet<Option<String>> {
    // Phase one, under the lock: the system actor (resolved in Rust, never passed in from the
    // renderer, T-01-04) and every Story's plan.
    let (actor_id, plans) = {
        let Some(conn) = lock(db, tier) else {
            return HashSet::new();
        };
        let actor_id = match system_actor(&conn) {
            Ok(actor) => Some(actor.id),
            Err(err) => {
                eprintln!("git-truth {tier} tick: failed to resolve the system actor: {err:#}");
                None
            }
        };
        let plans: Vec<_> = story_ids
            .iter()
            .filter_map(|story_id| match plan_git_facts(&conn, story_id) {
                Ok(plan) => plan,
                Err(err) => {
                    eprintln!("git-truth {tier} tick: failed to read the worktree of Story {story_id}: {err:#}");
                    None
                }
            })
            .collect();
        (actor_id, plans)
    };

    // Phase two, with no connection in scope: git.
    let read: Vec<(String, GitFacts)> = plans
        .iter()
        .filter_map(|plan| match read_git_facts(plan) {
            Ok(facts) => Some((plan.story_id.clone(), facts)),
            Err(err) => {
                eprintln!(
                    "git-truth {tier} tick: failed to read git facts for Story {}: {err:#}",
                    plan.story_id
                );
                None
            }
        })
        .collect();
    if read.is_empty() {
        return HashSet::new();
    }

    // Phase three, under the lock: write what git showed.
    let mut changed_projects: HashSet<Option<String>> = HashSet::new();
    let Some(mut conn) = lock(db, tier) else {
        return changed_projects;
    };
    for (story_id, facts) in &read {
        let mut changed = record_digest(digests, story_id, facts);
        if let Some(actor_id) = &actor_id {
            match record_outside_commits_in(&mut conn, story_id, facts, actor_id) {
                Ok(count) => changed |= count > 0,
                Err(err) => {
                    eprintln!("git-truth {tier} tick: failed to notice outside commits for Story {story_id}: {err:#}")
                }
            }
        }
        if changed {
            changed_projects.insert(project_of_story(&conn, story_id));
        }
    }
    changed_projects
}

/// One active project's fetch target: just enough for [`fetch_origin_for_targets`] to call
/// [`crate::git::fetch_origin`] with no connection in scope.
#[derive(Debug, Clone, PartialEq)]
pub struct FetchTarget {
    pub project_id: String,
    pub repo_path: String,
}

/// Phase one of the fetch tick: every active project's id and repo path, read under the lock.
pub fn fetch_targets(db: &Mutex<Connection>) -> Vec<FetchTarget> {
    let Some(conn) = lock(db, "fetch") else {
        return Vec::new();
    };
    let mut stmt = match conn
        .prepare("SELECT id, repo_path FROM projects WHERE status = 'active' AND hidden = 0")
    {
        Ok(stmt) => stmt,
        Err(err) => {
            eprintln!("git-truth fetch tick: failed to prepare project query: {err:#}");
            return Vec::new();
        }
    };
    let rows = stmt.query_map([], |row| {
        Ok(FetchTarget {
            project_id: row.get(0)?,
            repo_path: row.get(1)?,
        })
    });
    match rows {
        Ok(rows) => rows.filter_map(Result::ok).collect(),
        Err(err) => {
            eprintln!("git-truth fetch tick: failed to read active projects: {err:#}");
            Vec::new()
        }
    }
}

/// Phase two of the fetch tick: `git fetch origin` for every target. Takes no connection: a hung
/// `git fetch` can never block any other command (07-11, CR-01). A fetch writes nothing to the
/// database, so no write phase follows; the next hot or cold tick reads the moved `origin/<target>`.
pub fn fetch_origin_for_targets(targets: &[FetchTarget]) {
    for target in targets {
        if let Err(err) = crate::git::fetch_origin(Path::new(&target.repo_path)) {
            eprintln!(
                "git-truth fetch tick: failed to fetch origin for project {}: {err:#}",
                target.project_id
            );
        }
    }
}

/// D-116's fetch job: [`fetch_targets`] under the lock, then [`fetch_origin_for_targets`] without it.
pub fn fetch_tick(db: &Mutex<Connection>) {
    let targets = fetch_targets(db);
    fetch_origin_for_targets(&targets);
}
