//! The Issue mirror (issue #2118): a project may copy its accepted Epics and Stories to the forge as
//! issues. An Epic is an issue, its Stories are its sub-issues, one `flywheel:<state>` label follows
//! the state, and a Merged or Done record closes as completed and a Dropped one as not planned.
//! Proposals, Tasks, Rounds and sessions are never copied, and neither is a record still in Shaping.
//!
//! The board never waits on the forge. A planner compares the board with what the forge holds
//! (`mirror_synced`) and queues the writes owed in `mirror_outbox`; the tick makes them one at a
//! time, at least [`MirrorPacing::min_gap`] apart, and a write that fails keeps its row and stops the
//! project's queue until the next tick, so the order of writes holds. A row names a record: the text
//! sent is read from the board when the write is made, so a record edited while queued is sent once.
//!
//! [`mirror_tick`] follows ADR 0024: the board mutex is held only to find the database file, and the
//! forge is called on a connection of the tick's own.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::actor::assert_human_actor;
use crate::domain::{now, record_event, EventScope};
use crate::forge::{ForgeCli, ForgeError};
use crate::issue_forge::{github_slug, CloseReason, GhIssueForge, IssueForge, MirrorTarget};

/// The forge allows about 80 content-creating requests a minute; Flywheel makes one a second.
pub const MIN_WRITE_GAP: Duration = Duration::from_secs(1);

/// The most writes one tick makes, so a tick ends in bounded time.
pub const MAX_WRITES_PER_TICK: usize = 30;

#[derive(Debug, Clone, Copy)]
pub struct MirrorPacing {
    pub min_gap: Duration,
    pub max_writes: usize,
}

impl Default for MirrorPacing {
    fn default() -> Self {
        Self {
            min_gap: MIN_WRITE_GAP,
            max_writes: MAX_WRITES_PER_TICK,
        }
    }
}

/// A project's mirror setting.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MirrorSettings {
    pub enabled: bool,
    /// The forge repository (`owner/name`), when it is not the one `origin` names.
    pub repo: Option<String>,
}

pub fn read_settings(conn: &Connection, project_id: &str) -> anyhow::Result<MirrorSettings> {
    conn.query_row(
        "SELECT mirror_enabled, mirror_repo FROM projects WHERE id = ?1",
        params![project_id],
        |r| {
            Ok(MirrorSettings {
                enabled: r.get::<_, i64>(0)? == 1,
                repo: r.get(1)?,
            })
        },
    )
    .optional()?
    .with_context(|| format!("project {project_id:?} not found"))
}

/// Write a project's mirror setting, as the developer. A repository is `owner/name`. Appends a
/// `project.mirror_set` event, and writes nothing when the setting is unchanged.
pub fn set_settings(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    settings: &MirrorSettings,
) -> anyhow::Result<MirrorSettings> {
    assert_human_actor(conn, actor_id)?;
    let repo = settings
        .repo
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string);
    if let Some(repo) = &repo {
        let mut parts = repo.split('/');
        let valid = matches!(
            (parts.next(), parts.next(), parts.next()),
            (Some(o), Some(n), None) if !o.is_empty() && !n.is_empty() && !repo.contains(char::is_whitespace)
        );
        anyhow::ensure!(valid, "The mirror repository is written owner/name.");
    }
    let after = MirrorSettings {
        enabled: settings.enabled,
        repo,
    };
    if read_settings(conn, project_id)? == after {
        return Ok(after);
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE projects SET mirror_enabled = ?1, mirror_repo = ?2 WHERE id = ?3",
        params![after.enabled as i64, after.repo, project_id],
    )?;
    record_event(
        &tx,
        project_id,
        "project",
        project_id,
        EventScope::default(),
        actor_id,
        "project.mirror_set",
        &serde_json::json!({
            "enabled": after.enabled,
            "repo": after.repo,
            "label": if after.enabled { "Issue mirror turned on" } else { "Issue mirror turned off" },
        }),
        &now(),
    )?;
    tx.commit()?;
    Ok(after)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Epic,
    Story,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Epic => "epic",
            Kind::Story => "story",
        }
    }

    fn table(self) -> &'static str {
        match self {
            Kind::Epic => "epics",
            Kind::Story => "stories",
        }
    }

    fn parse(value: &str) -> anyhow::Result<Self> {
        match value {
            "epic" => Ok(Kind::Epic),
            "story" => Ok(Kind::Story),
            other => anyhow::bail!("{other:?} is not a mirrored record kind"),
        }
    }
}

/// What the forge should hold for one record.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Desired {
    title: String,
    body: String,
    label: String,
    close: Option<CloseReason>,
    parent_epic_id: Option<String>,
}

impl Desired {
    fn content(&self) -> String {
        format!("{}\n\u{0}\n{}", self.title, self.body)
    }
}

fn section(out: &mut String, heading: &str, text: Option<String>) {
    if let Some(text) = text.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
        out.push_str(&format!("## {heading}\n\n{text}\n\n"));
    }
}

/// The record as the forge should show it, or `None` for a record that is not mirrored (missing, or
/// still in Shaping).
fn desired(conn: &Connection, kind: Kind, id: &str) -> anyhow::Result<Option<Desired>> {
    match kind {
        Kind::Epic => {
            let row = conn
                .query_row(
                    "SELECT key, title, problem, scope, out_of_scope, exit_test, state FROM epics WHERE id = ?1",
                    params![id],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            [r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?],
                            r.get::<_, String>(6)?,
                        ))
                    },
                )
                .optional()?;
            let Some((key, title, [problem, scope, out_of_scope, exit_test], state)) = row else {
                return Ok(None);
            };
            if state == "shaping" {
                return Ok(None);
            }
            let mut body = format!("Board key: {key}\n\n");
            section(&mut body, "Problem", problem);
            section(&mut body, "Scope", scope);
            section(&mut body, "Out of scope", out_of_scope);
            section(&mut body, "Exit test", exit_test);
            let close = match state.as_str() {
                "done" => Some(CloseReason::Completed),
                "dropped" => Some(CloseReason::NotPlanned),
                _ => None,
            };
            Ok(Some(Desired {
                title,
                body: body.trim_end().to_string(),
                label: format!("flywheel:{state}"),
                close,
                parent_epic_id: None,
            }))
        }
        Kind::Story => {
            let row = conn
                .query_row(
                    "SELECT key, title, description, state, epic_id FROM stories WHERE id = ?1",
                    params![id],
                    |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, Option<String>>(2)?,
                            r.get::<_, String>(3)?,
                            r.get::<_, String>(4)?,
                        ))
                    },
                )
                .optional()?;
            let Some((key, title, description, state, epic_id)) = row else {
                return Ok(None);
            };
            if state == "shaping" {
                return Ok(None);
            }
            let mut body = format!("Board key: {key}\n\n");
            section(&mut body, "Description", description);
            let criteria = crate::domain::acceptance_criterion::criteria_for_story(conn, id)?;
            if !criteria.is_empty() {
                body.push_str("## Acceptance criteria\n\n");
                for c in criteria {
                    body.push_str(&format!("- [ ] {}\n", c.statement.trim()));
                }
            }
            let close = match state.as_str() {
                "merged" => Some(CloseReason::Completed),
                "dropped" => Some(CloseReason::NotPlanned),
                _ => None,
            };
            Ok(Some(Desired {
                title,
                body: body.trim_end().to_string(),
                label: format!("flywheel:{state}"),
                close,
                parent_epic_id: Some(epic_id),
            }))
        }
    }
}

struct Synced {
    content: String,
    label: String,
    closed_reason: Option<CloseReason>,
    parent_linked: bool,
}

fn synced(conn: &Connection, record_id: &str) -> anyhow::Result<Option<Synced>> {
    Ok(conn
        .query_row(
            "SELECT content, label, closed_reason, parent_linked FROM mirror_synced WHERE record_id = ?1",
            params![record_id],
            |r| {
                Ok(Synced {
                    content: r.get(0)?,
                    label: r.get(1)?,
                    closed_reason: r
                        .get::<_, Option<String>>(2)?
                        .as_deref()
                        .and_then(CloseReason::parse),
                    parent_linked: r.get::<_, i64>(3)? == 1,
                })
            },
        )
        .optional()?)
}

fn issue_number(conn: &Connection, kind: Kind, id: &str) -> anyhow::Result<Option<u64>> {
    let sql = format!("SELECT issue_number FROM {} WHERE id = ?1", kind.table());
    Ok(conn
        .query_row(&sql, params![id], |r| r.get::<_, Option<i64>>(0))
        .optional()?
        .flatten()
        .map(|n| n as u64))
}

fn enqueue(
    conn: &Connection,
    project_id: &str,
    kind: Kind,
    record_id: &str,
    op: &str,
) -> anyhow::Result<usize> {
    Ok(conn.execute(
        "INSERT OR IGNORE INTO mirror_outbox (project_id, record_kind, record_id, op, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_id, kind.as_str(), record_id, op, now()],
    )?)
}

/// Queue the writes a project owes: Epics first, then Stories, so a parent's issue is made before
/// its children's. Returns how many rows were queued.
pub fn plan(conn: &Connection, project_id: &str) -> anyhow::Result<usize> {
    let mut queued = 0;
    for kind in [Kind::Epic, Kind::Story] {
        let sql = match kind {
            Kind::Epic => "SELECT id FROM epics WHERE project_id = ?1 AND state != 'shaping' ORDER BY rank, id",
            Kind::Story => "SELECT s.id FROM stories s JOIN epics e ON e.id = s.epic_id WHERE s.project_id = ?1 AND s.state != 'shaping' ORDER BY e.rank, e.id, s.rank, s.id",
        };
        let ids = conn
            .prepare(sql)?
            .query_map(params![project_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for id in ids {
            let Some(want) = desired(conn, kind, &id)? else {
                continue;
            };
            let have = synced(conn, &id)?;
            let numbered = issue_number(conn, kind, &id)?.is_some();
            let Some(have) = have.filter(|_| numbered) else {
                queued += enqueue(conn, project_id, kind, &id, "create")?;
                if kind == Kind::Story {
                    queued += enqueue(conn, project_id, kind, &id, "link_parent")?;
                }
                if want.close.is_some() {
                    queued += enqueue(conn, project_id, kind, &id, "close")?;
                }
                continue;
            };
            if have.content != want.content() || have.label != want.label {
                queued += enqueue(conn, project_id, kind, &id, "edit")?;
            }
            if want.close.is_some() && want.close != have.closed_reason {
                queued += enqueue(conn, project_id, kind, &id, "close")?;
            }
            if kind == Kind::Story && !have.parent_linked {
                queued += enqueue(conn, project_id, kind, &id, "link_parent")?;
            }
        }
    }
    Ok(queued)
}

/// Spaces the writes: each one starts at least `min_gap` after the previous one ended.
struct Pacer {
    min_gap: Duration,
    last_end: Option<Instant>,
    made: usize,
}

impl Pacer {
    fn paced<T>(&mut self, call: impl FnOnce() -> T) -> T {
        if let Some(last) = self.last_end {
            let wait = self.min_gap.saturating_sub(last.elapsed());
            if !wait.is_zero() {
                std::thread::sleep(wait);
            }
        }
        let out = call();
        self.last_end = Some(Instant::now());
        self.made += 1;
        out
    }
}

struct Row {
    id: i64,
    kind: Kind,
    record_id: String,
    op: String,
}

/// The target of a project's writes, or `None` when the project has none (mirror off, or no GitHub
/// repository to name).
fn mirror_target(conn: &Connection, project_id: &str) -> anyhow::Result<Option<MirrorTarget>> {
    let (enabled, repo, repo_path): (i64, Option<String>, String) = conn.query_row(
        "SELECT mirror_enabled, mirror_repo, repo_path FROM projects WHERE id = ?1",
        params![project_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if enabled != 1 {
        return Ok(None);
    }
    let workdir = std::path::PathBuf::from(&repo_path);
    let repo = match repo {
        Some(repo) => Some(repo),
        None => crate::git::remote_url(&workdir, "origin")
            .ok()
            .flatten()
            .and_then(|url| github_slug(&url)),
    };
    Ok(repo.map(|repo| MirrorTarget { repo, workdir }))
}

fn ensure_label(
    conn: &Connection,
    forge: &dyn IssueForge,
    pacer: &mut Pacer,
    project_id: &str,
    target: &MirrorTarget,
    label: &str,
) -> anyhow::Result<()> {
    let known: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM mirror_labels WHERE project_id = ?1 AND label = ?2)",
        params![project_id, label],
        |r| r.get(0),
    )?;
    if known {
        return Ok(());
    }
    pacer.paced(|| forge.ensure_label(target, label))?;
    conn.execute(
        "INSERT OR IGNORE INTO mirror_labels (project_id, label) VALUES (?1, ?2)",
        params![project_id, label],
    )?;
    Ok(())
}

/// Make one owed write. `Ok(true)` when the board changed (an issue number was stored).
fn apply(
    conn: &Connection,
    forge: &dyn IssueForge,
    pacer: &mut Pacer,
    project_id: &str,
    target: &MirrorTarget,
    row: &Row,
) -> anyhow::Result<bool> {
    let Some(want) = desired(conn, row.kind, &row.record_id)? else {
        return Ok(false);
    };
    let number = issue_number(conn, row.kind, &row.record_id)?;
    match (row.op.as_str(), number) {
        ("create", None) => {
            ensure_label(conn, forge, pacer, project_id, target, &want.label)?;
            let number =
                pacer.paced(|| forge.create_issue(target, &want.title, &want.body, &want.label))?;
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                &format!(
                    "UPDATE {} SET issue_number = ?1 WHERE id = ?2",
                    row.kind.table()
                ),
                params![number as i64, row.record_id],
            )?;
            tx.execute(
                "INSERT OR REPLACE INTO mirror_synced (record_id, record_kind, project_id, content, label) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![row.record_id, row.kind.as_str(), project_id, want.content(), want.label],
            )?;
            tx.commit()?;
            Ok(true)
        }
        ("create", Some(_)) => Ok(false),
        (_, None) => anyhow::bail!("the record has no issue yet"),
        ("edit", Some(number)) => {
            let have = synced(conn, &row.record_id)?.context("the record has no synced state")?;
            if have.content == want.content() && have.label == want.label {
                return Ok(false);
            }
            ensure_label(conn, forge, pacer, project_id, target, &want.label)?;
            pacer.paced(|| {
                forge.edit_issue(
                    target,
                    number,
                    &want.title,
                    &want.body,
                    &want.label,
                    &have.label,
                )
            })?;
            conn.execute(
                "UPDATE mirror_synced SET content = ?1, label = ?2 WHERE record_id = ?3",
                params![want.content(), want.label, row.record_id],
            )?;
            Ok(false)
        }
        ("close", Some(number)) => {
            let Some(reason) = want.close else {
                return Ok(false);
            };
            let have = synced(conn, &row.record_id)?.context("the record has no synced state")?;
            if have.closed_reason == Some(reason) {
                return Ok(false);
            }
            pacer.paced(|| forge.close_issue(target, number, reason))?;
            conn.execute(
                "UPDATE mirror_synced SET closed_reason = ?1 WHERE record_id = ?2",
                params![reason.as_str(), row.record_id],
            )?;
            Ok(false)
        }
        ("link_parent", Some(child)) => {
            let have = synced(conn, &row.record_id)?.context("the record has no synced state")?;
            let Some(epic_id) = want.parent_epic_id else {
                return Ok(false);
            };
            if have.parent_linked {
                return Ok(false);
            }
            let parent =
                issue_number(conn, Kind::Epic, &epic_id)?.context("the Epic has no issue yet")?;
            pacer.paced(|| forge.add_sub_issue(target, parent, child))?;
            conn.execute(
                "UPDATE mirror_synced SET parent_linked = 1 WHERE record_id = ?1",
                params![row.record_id],
            )?;
            Ok(false)
        }
        (other, _) => anyhow::bail!("{other:?} is not a mirror write"),
    }
}

fn queued(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<Row>> {
    let rows = conn
        .prepare(
            "SELECT id, record_kind, record_id, op FROM mirror_outbox WHERE project_id = ?1 ORDER BY id",
        )?
        .query_map(params![project_id], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get(2)?, r.get(3)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, kind, record_id, op)| {
            Ok(Row {
                id,
                kind: Kind::parse(&kind)?,
                record_id,
                op,
            })
        })
        .collect()
}

/// Plan every mirrored project, then make its owed writes in order until the queue is empty, a write
/// fails, or the tick's budget is spent. Returns the projects whose board changed.
pub fn run_mirror(
    conn: &Connection,
    forge: &dyn IssueForge,
    pacing: MirrorPacing,
) -> HashSet<Option<String>> {
    let mut changed = HashSet::new();
    let mut pacer = Pacer {
        min_gap: pacing.min_gap,
        last_end: None,
        made: 0,
    };
    let projects: Vec<String> = conn
        .prepare("SELECT id FROM projects WHERE mirror_enabled = 1 ORDER BY id")
        .and_then(|mut s| s.query_map([], |r| r.get(0))?.collect())
        .unwrap_or_default();
    for project_id in projects {
        if let Err(e) = mirror_project(conn, forge, &mut pacer, pacing, &project_id, &mut changed) {
            eprintln!("issue mirror: project {project_id}: {e:#}");
        }
    }
    changed
}

fn mirror_project(
    conn: &Connection,
    forge: &dyn IssueForge,
    pacer: &mut Pacer,
    pacing: MirrorPacing,
    project_id: &str,
    changed: &mut HashSet<Option<String>>,
) -> anyhow::Result<()> {
    let Some(target) = mirror_target(conn, project_id)? else {
        return Ok(());
    };
    plan(conn, project_id)?;
    for row in queued(conn, project_id)? {
        if pacer.made >= pacing.max_writes {
            break;
        }
        match apply(conn, forge, pacer, project_id, &target, &row) {
            Ok(numbered) => {
                conn.execute("DELETE FROM mirror_outbox WHERE id = ?1", params![row.id])?;
                if numbered {
                    changed.insert(Some(project_id.to_string()));
                }
            }
            Err(e) => {
                let reason = match e.downcast_ref::<ForgeError>() {
                    Some(forge_error) => forge_error.to_string(),
                    None => format!("{e:#}"),
                };
                conn.execute(
                    "UPDATE mirror_outbox SET attempts = attempts + 1, last_error = ?1 WHERE id = ?2",
                    params![reason, row.id],
                )?;
                eprintln!(
                    "issue mirror: a write for {} failed: {reason}",
                    row.record_id
                );
                break;
            }
        }
    }
    Ok(())
}

/// The cold tick's pass. The board mutex is held only to read the database file's path.
pub fn mirror_tick(db: &Mutex<Connection>, cli: &ForgeCli) -> HashSet<Option<String>> {
    let path = {
        let Ok(conn) = db.lock() else {
            eprintln!("issue mirror: the board database lock was poisoned, skipping this tick");
            return HashSet::new();
        };
        let any: bool = conn
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM projects WHERE mirror_enabled = 1)",
                [],
                |r| r.get(0),
            )
            .unwrap_or(false);
        if !any {
            return HashSet::new();
        }
        conn.path().map(str::to_string)
    };
    let Some(path) = path.filter(|p| !p.is_empty()) else {
        eprintln!("issue mirror: the board database has no file to open a second connection on");
        return HashSet::new();
    };
    let conn = match Connection::open(&path)
        .map_err(anyhow::Error::from)
        .and_then(|c| crate::db::apply_pragmas(&c).map(|()| c))
    {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("issue mirror: failed to open a connection beside the board: {e:#}");
            return HashSet::new();
        }
    };
    run_mirror(&conn, &GhIssueForge::new(cli), MirrorPacing::default())
}
