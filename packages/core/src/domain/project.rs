//! Project registration (D-10, D-14).
//!
//! A project's `key_prefix` is user-typed with a derived default supplied by the caller (the
//! desktop UI derives the default from the repository directory name — 01-UI-SPEC.md Open
//! Decisions #11) and is validated here as short, uppercase, typeable and greppable.

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::path::Path;

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::marker::{self, ProjectMarker};

const KEY_PREFIX_MIN_LEN: usize = 2;
const KEY_PREFIX_MAX_LEN: usize = 10;

/// A registered project (one row in `projects`).
#[derive(Debug, Clone, PartialEq)]
pub struct Project {
    pub id: String,
    pub key_prefix: String,
    pub name: String,
    pub repo_path: String,
    pub default_branch: String,
    pub status: String,
}

fn row_to_project(row: &rusqlite::Row) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        key_prefix: row.get(1)?,
        name: row.get(2)?,
        repo_path: row.get(3)?,
        default_branch: row.get(4)?,
        status: row.get(5)?,
    })
}

/// Validate a user-supplied or derived project key prefix (D-10, 01-UI-SPEC.md Open Decisions
/// #11): 2-10 uppercase ASCII letters/digits, starting with a letter — short, uppercase,
/// typeable and greppable, and stable enough for Phase 2's branch names and Phase 7's commit
/// trailers.
pub fn validate_key_prefix(prefix: &str) -> anyhow::Result<()> {
    let len_ok = (KEY_PREFIX_MIN_LEN..=KEY_PREFIX_MAX_LEN).contains(&prefix.len());
    let chars_ok = !prefix.is_empty()
        && prefix
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit());
    let starts_with_letter = prefix.chars().next().is_some_and(|c| c.is_ascii_uppercase());

    if !len_ok || !chars_ok || !starts_with_letter {
        return Err(anyhow!(
            "key prefix {prefix:?} must be {KEY_PREFIX_MIN_LEN}-{KEY_PREFIX_MAX_LEN} uppercase letters/digits, starting with a letter"
        ));
    }
    Ok(())
}

/// Register a project: validates the key prefix, then inserts the `projects` row inside one
/// transaction. `default_branch` is supplied by the caller — resolving it from the repository
/// itself is Phase 2's git integration, out of scope for this tracer.
pub fn create_project(
    conn: &mut Connection,
    actor_id: &str,
    name: &str,
    repo_path: &str,
    key_prefix: &str,
    default_branch: &str,
) -> anyhow::Result<Project> {
    validate_key_prefix(key_prefix)?;

    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO projects (
            id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 0, 'active', ?6, ?7)",
        params![id, key_prefix, name, repo_path, default_branch, actor_id, now],
    )
    .context("failed to insert project")?;
    tx.commit().context("failed to commit create_project transaction")?;

    Ok(Project {
        id,
        key_prefix: key_prefix.to_string(),
        name: name.to_string(),
        repo_path: repo_path.to_string(),
        default_branch: default_branch.to_string(),
        status: "active".to_string(),
    })
}

/// List every registered, non-hidden project, oldest-registered first (stable order for the
/// project rail's ⌘1-⌘9 switching and the "current project" default). A project hidden by
/// [`hide_project`] (D-200) is absent here and from every other listing read; by-id lookups still
/// resolve it.
pub fn list_projects(conn: &Connection) -> anyhow::Result<Vec<Project>> {
    let mut stmt = conn.prepare(
        "SELECT id, key_prefix, name, repo_path, default_branch, status
         FROM projects
         WHERE hidden = 0
         ORDER BY created_at ASC",
    )?;
    let rows = stmt
        .query_map([], row_to_project)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read projects")?;
    Ok(rows)
}

/// Update a project's key prefix — **enforced immutable** once the project has allocated its
/// first item key (`key_counter > 0`), per D-10 and 01-UI-SPEC.md Open Decisions #11: once
/// branches and commit trailers in real git history carry a key, the identifier scheme cannot
/// change retroactively. No Tauri command exposes a rename affordance in Phase 1 (no UI-SPEC
/// surface calls for one yet), but the invariant is enforced here — the one function any future
/// rename path would have to go through — not merely documented.
pub fn update_key_prefix(
    conn: &mut Connection,
    project_id: &str,
    new_prefix: &str,
) -> anyhow::Result<()> {
    validate_key_prefix(new_prefix)?;

    let tx = conn.transaction()?;
    let key_counter: i64 = tx
        .query_row(
            "SELECT key_counter FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    if key_counter > 0 {
        return Err(anyhow!(
            "project {project_id:?} has already allocated {key_counter} item key(s) — the key prefix is immutable once the first item exists (D-10)"
        ));
    }

    tx.execute(
        "UPDATE projects SET key_prefix = ?1 WHERE id = ?2",
        params![new_prefix, project_id],
    )
    .context("failed to update key prefix")?;
    tx.commit()
        .context("failed to commit update_key_prefix transaction")?;
    Ok(())
}

/// Read one project back by id — the shared finisher [`register_project`] and
/// [`relocate_project`] both call after their own transaction commits, so the `Project` they
/// return always reflects the committed row rather than a value assembled by hand from arguments
/// that may not match what a concurrent writer just committed underneath them.
fn get_project(conn: &Connection, id: &str) -> anyhow::Result<Project> {
    conn.query_row(
        "SELECT id, key_prefix, name, repo_path, default_branch, status
         FROM projects WHERE id = ?1",
        params![id],
        row_to_project,
    )
    .with_context(|| format!("project {id:?} not found after its own transaction committed"))
}

/// Insert one fresh `projects` row. The one INSERT statement shared by both of
/// [`register_project`]'s insert branches (a brand-new repository, and the clone-onto-
/// another-machine case reusing a marker's id) — never called by [`create_project`], which
/// remains the tracer-era, marker-free fixture every existing test in this workspace already
/// depends on.
fn insert_project_row(
    tx: &Transaction,
    id: &str,
    key_prefix: &str,
    name: &str,
    repo_path: &str,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<()> {
    tx.execute(
        "INSERT INTO projects (
            id, key_prefix, name, repo_path, default_branch, key_counter, status, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, 'main', 0, 'active', ?5, ?6)",
        params![id, key_prefix, name, repo_path, actor_id, now],
    )
    .context("failed to insert project")?;
    Ok(())
}

/// The ONLY place `projects.repo_path` is ever written after a project's initial insert —
/// [`register_project`] (reusing an existing marker id) and [`relocate_project`] (explicit user
/// relocation) both call this one statement, so a grep gate can assert there is exactly one `SET
/// repo_path` site in this file. [`reconcile_projects`] never calls it (D-16: reconciliation
/// verifies, it never re-binds). Also clears `unreachable` back to `active` — reaching this
/// function at all means a marker was just read and verified to match, so the project is
/// reachable again by construction.
fn set_repo_path(tx: &Transaction, project_id: &str, repo_path: &str) -> anyhow::Result<()> {
    tx.execute(
        "UPDATE projects SET repo_path = ?1, status = 'active' WHERE id = ?2",
        params![repo_path, project_id],
    )
    .context("failed to update project repo_path")?;
    Ok(())
}

/// Install the Layer 3 pre-push gate (phase 12, plan 12-02) at `repo_path` for `project_id`,
/// rendering every non-`Installed` outcome on stderr instead of ever propagating it as a failure
/// — no `?`, no early return: a repository Flywheel cannot gate is still a repository Flywheel
/// can manage, and the degradation is recorded in `docs/destructive-gate-trust-boundary.md`'s
/// refusal residual rows, never silently absorbed. This is the ONE place that renders this
/// outcome for both mutation paths that can change a project's `repo_path` —
/// [`register_project`] and [`relocate_project`] both call it, so they cannot drift from each
/// other — and `packages/core/tests/destructive_gate_layer_coverage.rs`'s
/// `every_repo_path_mutation_routes_through_the_layer3_install` fails the moment a third mutation
/// path appears without routing through it too (phase 12, plan 12-06 gap closure).
fn install_layer3_pre_push_gate(repo_path: &Path, project_id: &str) {
    match crate::git_hooks::install_pre_push_hook(repo_path, project_id) {
        Ok(crate::git_hooks::PrePushInstall::Installed { .. }) => {}
        Ok(crate::git_hooks::PrePushInstall::RefusedPreexistingHooksPath { existing }) => {
            eprintln!(
                "flywheel core: pre-push gate not installed for {}: core.hooksPath is already set to {existing:?}",
                repo_path.display()
            );
        }
        Ok(crate::git_hooks::PrePushInstall::RefusedPreexistingPrePush { path }) => {
            eprintln!(
                "flywheel core: pre-push gate not installed for {}: a pre-existing pre-push hook already exists at {path:?}",
                repo_path.display()
            );
        }
        Err(e) => {
            eprintln!(
                "flywheel core: pre-push gate not installed for {}: {e}",
                repo_path.display()
            );
        }
    }
}

/// Install the commit-msg trailer hook (phase 7, plan 07-02) at `repo_path` for `project_id`,
/// matching the Layer 3 pre-push gate's own installer above exactly: a `match` over every
/// outcome, each arm an `eprintln!` naming the repository and the reason, no `?` and no early
/// return — a repository whose commits Flywheel cannot stamp is still a repository Flywheel can
/// manage, and the degradation is reported rather than absorbed. Called from the same two places
/// that installer is already called, immediately after it, so no `repo_path` mutation path can
/// acquire one hook without the other and
/// `packages/core/tests/destructive_gate_layer_coverage.rs`'s structural gate keeps its meaning.
fn install_commit_msg_trailer_hook(repo_path: &Path, project_id: &str) {
    match crate::git_hooks::install_commit_msg_hook(repo_path, project_id) {
        Ok(crate::git_hooks::CommitMsgInstall::Installed { .. }) => {}
        Ok(crate::git_hooks::CommitMsgInstall::RefusedPreexistingHooksPath { existing }) => {
            eprintln!(
                "flywheel core: commit-msg trailer hook not installed for {}: core.hooksPath is already set to {existing:?}",
                repo_path.display()
            );
        }
        Ok(crate::git_hooks::CommitMsgInstall::RefusedPreexistingCommitMsg { path }) => {
            eprintln!(
                "flywheel core: commit-msg trailer hook not installed for {}: a pre-existing commit-msg hook already exists at {path:?}",
                repo_path.display()
            );
        }
        Err(e) => {
            eprintln!(
                "flywheel core: commit-msg trailer hook not installed for {}: {e}",
                repo_path.display()
            );
        }
    }
}

/// Register a repository as a project (BOARD-10, D-15, D-16). Reads any existing marker at
/// `repo_path` FIRST, as a plain filesystem read at an explicit path (`ARCHITECTURE.md`
/// Anti-Pattern 3) — never inside the database transaction. Then, inside exactly one
/// transaction, either:
/// - mints a fresh project id when no marker exists there (a genuinely new repository);
/// - reuses the existing row and updates its cached `repo_path` when the marker names a project
///   this database already knows (re-registering the same or a moved-in-place repository); or
/// - inserts a row reusing the marker's id when the marker names a project this database has
///   never seen — the cloned-onto-another-machine case D-15 exists for.
///
/// The marker file write happens ONLY after the transaction commits (T-01-30): a failed database
/// write never leaves a marker behind in the user's repository. Paths are canonicalized before
/// storage and before every comparison, so a trailing slash, a symlinked parent, or a case
/// difference on a case-insensitive filesystem all resolve to the same project.
pub fn register_project(
    conn: &mut Connection,
    actor_id: &str,
    repo_path: &Path,
    name: &str,
    key_prefix: &str,
) -> anyhow::Result<Project> {
    validate_key_prefix(key_prefix)?;

    let canonical = repo_path
        .canonicalize()
        .with_context(|| format!("repository path {repo_path:?} could not be resolved"))?;
    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| anyhow!("repository path is not valid UTF-8"))?;

    // A plain filesystem read at the explicit path the caller supplied — never inside the
    // transaction below, and never a source of a second path to visit (T-01-03).
    let existing_marker = marker::read_marker(&canonical)?;

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, marker_key) = match &existing_marker {
        Some(existing) => {
            let known_row: Option<String> = tx
                .query_row(
                    "SELECT id FROM projects WHERE id = ?1",
                    params![existing.project_id],
                    |row| row.get(0),
                )
                .optional()
                .context("failed to look up the marker's project id")?;

            match known_row {
                Some(id) => {
                    // Already known — reuse the row. Idempotent for a repeated registration of
                    // the same path; also the recovery path for re-registering a repository that
                    // moved without going through explicit relocation.
                    set_repo_path(&tx, &id, canonical_str)?;
                    // D-200: registering the path of a hidden project brings it back rather than
                    // leaving it hidden or minting a duplicate.
                    set_hidden(&tx, &id, false, actor_id, &now)?;
                    (id, existing.project_key.clone())
                }
                None => {
                    // The clone-onto-another-machine case (D-15): the marker names a project id
                    // this database has never seen. Insert reusing that id and key — never a
                    // fresh one — which is what lets "the same project on two machines" hold.
                    insert_project_row(
                        &tx,
                        &existing.project_id,
                        &existing.project_key,
                        name,
                        canonical_str,
                        actor_id,
                        &now,
                    )?;
                    (existing.project_id.clone(), existing.project_key.clone())
                }
            }
        }
        None => {
            // No marker at all: a genuinely new registration, using the caller-supplied prefix.
            let id = new_id();
            insert_project_row(&tx, &id, key_prefix, name, canonical_str, actor_id, &now)?;
            (id, key_prefix.to_string())
        }
    };

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "status",
        "before": null,
        "after": "active",
        "label": format!("Registered {name}"),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "project",
        &project_id,
        None,
        None,
        actor_id,
        "project.registered",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit register_project transaction")?;

    // Written ONLY after the transaction above committed (T-01-30) — a failed database write
    // above returns before this line is ever reached, so it never leaves a marker behind that
    // the database disagrees with.
    marker::write_marker(
        &canonical,
        &ProjectMarker {
            project_id: project_id.clone(),
            project_key: marker_key,
        },
    )?;

    // Layer 3 (phase 12, plan 12-02): install the git-native pre-push gate via the shared helper
    // (phase 12, plan 12-06) — see [`install_layer3_pre_push_gate`] for why both mutation paths
    // that can change `repo_path` route through it.
    install_layer3_pre_push_gate(&canonical, &project_id);
    // Commit-msg trailer hook (phase 7, plan 07-02): installed immediately after Layer 3, from
    // the same call site, so no repo_path mutation path can acquire one hook without the other.
    install_commit_msg_trailer_hook(&canonical, &project_id);

    get_project(conn, &project_id)
}

/// Verify every known project's marker still matches its cached path (D-16, BOARD-10) — run at
/// launch, after `open_and_migrate` and before the window is shown. Reads one marker per known
/// project at its already-known `repo_path`; it never scans a directory tree looking for where a
/// repository went (no call here enumerates the filesystem — `01-11-PLAN.md`'s own grep gate),
/// so its cost is linear in registered projects and independent of any repository's size.
///
/// A mismatch or an absent marker sets `projects.status = 'unreachable'`; a marker that matches
/// again clears it back to `'active'`. NEVER rewrites `repo_path` — that discipline is what
/// `relocate_project`'s existence enforces; a moved repository is surfaced, never silently
/// re-bound. Idempotent: a project whose status is already correct is skipped entirely, so
/// running this twice with no filesystem change writes no row and appends no second event.
pub fn reconcile_projects(conn: &mut Connection, actor_id: &str) -> anyhow::Result<()> {
    let projects = list_projects(conn)?;
    let now = Utc::now().to_rfc3339();

    for project in projects {
        // Any read failure (a malformed marker, a permissions error, a genuinely missing
        // repository) reads as "not reachable" here — one bad project must never abort
        // reconciliation for every other registered project.
        let reachable =
            marker::verify_marker(Path::new(&project.repo_path), &project.id).unwrap_or(false);
        let new_status = if reachable { "active" } else { "unreachable" };
        if new_status == project.status {
            // No change: no row write, no event — this is what makes a second run over an
            // unchanged filesystem a true no-op.
            continue;
        }

        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE projects SET status = ?1 WHERE id = ?2",
            params![new_status, project.id],
        )
        .context("failed to update project status during reconciliation")?;

        let sequence = next_sequence(&tx, &project.id, "local")?;
        let label = if reachable {
            format!("{} is reachable again", project.name)
        } else {
            format!("{} is unreachable — its marker no longer matches", project.name)
        };
        let payload = serde_json::json!({
            "field": "status",
            "before": project.status,
            "after": new_status,
            "label": label,
        });
        append_event(
            &tx,
            &project.id,
            "local",
            sequence,
            "project",
            &project.id,
            None,
            None,
            actor_id,
            "project.reconciled",
            &payload,
            &now,
        )?;
        tx.commit()
            .context("failed to commit reconcile_projects transaction")?;
    }

    Ok(())
}

/// The one statement that writes `projects.hidden` (D-200): flips the flag and appends its event in
/// the caller's transaction. Returns whether anything changed — a project already in the requested
/// state is skipped, so hiding twice appends no second event. Errors on an unknown project id.
fn set_hidden(
    tx: &Transaction,
    project_id: &str,
    hidden: bool,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<bool> {
    let (name, current): (String, i64) = tx
        .query_row(
            "SELECT name, hidden FROM projects WHERE id = ?1",
            params![project_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;
    if (current != 0) == hidden {
        return Ok(false);
    }
    tx.execute(
        "UPDATE projects SET hidden = ?1 WHERE id = ?2",
        params![hidden as i64, project_id],
    )
    .context("failed to update project hidden flag")?;
    let sequence = next_sequence(tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "hidden",
        "before": !hidden,
        "after": hidden,
        "label": if hidden { format!("Removed {name} from Flywheel") } else { format!("Restored {name}") },
    });
    append_event(
        tx,
        project_id,
        "local",
        sequence,
        "project",
        project_id,
        None,
        None,
        actor_id,
        if hidden { "project.hidden" } else { "project.restored" },
        &payload,
        now,
    )?;
    Ok(true)
}

/// Hide a project from every listing (D-200) — a reversible removal, never a delete: its board,
/// worktrees, runs and events all stay in SQLite. Idempotent; errors on an unknown project id.
pub fn hide_project(conn: &mut Connection, actor_id: &str, project_id: &str) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    set_hidden(&tx, project_id, true, actor_id, &Utc::now().to_rfc3339())?;
    tx.commit().context("failed to commit hide_project transaction")
}

/// Undo [`hide_project`]: the project reappears with the same id, prefix, name and repo path.
/// Idempotent; errors on an unknown project id.
pub fn restore_project(conn: &mut Connection, actor_id: &str, project_id: &str) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    set_hidden(&tx, project_id, false, actor_id, &Utc::now().to_rfc3339())?;
    tx.commit().context("failed to commit restore_project transaction")
}

/// Explicitly relocate a project to `new_repo_path` — the ONLY recovery action offered for an
/// unreachable project (D-16, 01-UI-SPEC.md "Project unreachable"). Verifies the marker AT the
/// new path names `project_id` and rejects a mismatch rather than adopting it (T-01-29): this
/// function never re-binds a project to a repository whose marker claims a different identity,
/// hand-edited or otherwise.
///
/// After its transaction commits, this also re-installs the Layer 3 pre-push gate at the new
/// path (phase 12, plan 12-06 gap closure): git hooks are never part of a repository's tracked
/// history, while `.flywheel/project.json` IS committed and travels with a fresh `git clone`, so
/// the exact scenario this function exists to recover from — a repository moved or re-cloned to a
/// new local path — is precisely the scenario in which the new location's `.git/config` has never
/// had `core.hooksPath` set. Without this call, a relocated project would silently fall back to
/// the pre-phase-12, Layer-2-only posture with no refusal, no log line, and no documented
/// residual. See [`install_layer3_pre_push_gate`] for the shared install/refusal/error handling.
pub fn relocate_project(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    new_repo_path: &Path,
) -> anyhow::Result<Project> {
    let canonical = new_repo_path
        .canonicalize()
        .with_context(|| format!("repository path {new_repo_path:?} could not be resolved"))?;
    let canonical_str = canonical
        .to_str()
        .ok_or_else(|| anyhow!("repository path is not valid UTF-8"))?;

    let matches = marker::verify_marker(&canonical, project_id)?;
    if !matches {
        return Err(anyhow!(
            "the marker at {canonical:?} does not name project {project_id:?} — refusing to relocate"
        ));
    }

    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let before_path: String = tx
        .query_row(
            "SELECT repo_path FROM projects WHERE id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .with_context(|| format!("project {project_id:?} not found"))?;

    set_repo_path(&tx, project_id, canonical_str)?;

    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "repo_path",
        "before": before_path,
        "after": canonical_str,
        "label": format!("Relocated to {canonical_str}"),
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "project",
        project_id,
        None,
        None,
        actor_id,
        "project.relocated",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit relocate_project transaction")?;

    // Layer 3 (phase 12, plan 12-06 gap closure): re-install the pre-push gate at the new path —
    // see this function's own doc comment and [`install_layer3_pre_push_gate`] for why. Never
    // propagated as a relocation failure: the relocation above already committed successfully.
    install_layer3_pre_push_gate(&canonical, project_id);
    // Commit-msg trailer hook (phase 7, plan 07-02): re-installed at the new path from the same
    // call site as Layer 3, for the identical reason.
    install_commit_msg_trailer_hook(&canonical, project_id);

    get_project(conn, project_id)
}
