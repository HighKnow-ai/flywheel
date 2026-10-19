//! The git-identifier round trip's read half (D-127/D-128, LINK-04, phase 7 plan 07-05): resolve
//! a pasted commit hash or a `flywheel/`-namespaced branch name to the board item that produced
//! it. Three rules this file lives under, mirroring `drift.rs`'s own discipline.
//!
//! First, this module maintains no sha-to-Story index, in the schema or in memory. There is no
//! `HashMap`, no `OnceCell`, no `Lazy`, keyed by a commit object name anywhere below — [`classify`]
//! and [`resolve_identifier`] derive every answer fresh, from git and from the board, on every
//! call. A second source of truth about git disagreeing with git itself is the exact bug class
//! this phase exists to kill (D-128/D-75).
//!
//! Second, ambiguity is answered by git, never guessed by this module. An abbreviated input that
//! matches more than one object in a single repository, or a full object name present in more
//! than one registered repository, is reported as an ambiguous outcome and resolves nothing —
//! never a silent pick of whichever came first.
//!
//! Third, [`classify`] is the security boundary this module exists behind (T-07-05-01): a string
//! that is not a plausible hash or branch name never reaches a git invocation, because it never
//! reaches a [`GitIdentifier`] at all.

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::branch::FLYWHEEL_BRANCH_NAMESPACE;
use crate::git::git_at;
use crate::git_hooks::{TRAILER_RUN_KEY, TRAILER_STORY_KEY};

/// What a pasted string classified as (T-07-05-01) — the only two shapes this module ever hands
/// to [`resolve_identifier`].
#[derive(Debug, Clone, PartialEq)]
pub enum GitIdentifier {
    Sha(String),
    Branch(String),
}

/// Classify `raw` as a plausible git identifier, or `None` for everything else — a pure function,
/// no I/O, no git invocation. This is the security boundary for T-07-05-01: nothing [`classify`]
/// rejects ever reaches [`resolve_identifier`]'s git-shelling path, because it never becomes a
/// [`GitIdentifier`] at all. The character-set check is written explicitly against
/// `is_ascii_hexdigit` with an explicit length range — no regex crate, and no accepting a string
/// merely because it *contains* hex characters somewhere inside it.
pub fn classify(raw: &str) -> Option<GitIdentifier> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let len = trimmed.chars().count();
    if (7..=64).contains(&len) && trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some(GitIdentifier::Sha(trimmed.to_string()));
    }

    if trimmed.starts_with(FLYWHEEL_BRANCH_NAMESPACE) {
        return Some(GitIdentifier::Branch(trimmed.to_string()));
    }

    None
}

/// The board item a [`GitIdentifier`] resolved to — never carries a title (the Tauri command
/// layer, which already has the board loaded, is where a display label is composed). `item_kind`
/// is `"story"`; `matched_sha`/`run_id` are populated only on the sha path, always
/// `None` for a branch resolution (a branch read never touches git at all).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IdentityResolution {
    pub project_id: String,
    pub item_kind: String,
    pub item_id: String,
    pub item_key: String,
    pub matched_sha: Option<String>,
    pub run_id: Option<String>,
}

/// Every way [`resolve_identifier`] can conclude — ambiguity is always a named, returned variant,
/// never a silently-picked first match.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub enum ResolveOutcome {
    Resolved(IdentityResolution),
    NotFound,
    AmbiguousPrefix { matches: usize },
    AmbiguousAcrossRepositories { repositories: usize },
}

/// Every `status = 'active'`, non-hidden project row's `(id, repo_path)`, ordered by `id` — a ULID, therefore
/// chronological, matching the project's own registration order. This is the deterministic
/// repository-iteration order the sha path relies on so two reads of the same input agree, and it
/// reads only repositories the user themselves registered (T-07-05-02).
fn active_projects_ordered(conn: &Connection) -> anyhow::Result<Vec<(String, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, repo_path FROM projects WHERE status = 'active' AND hidden = 0 ORDER BY id ASC")?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Resolve a `flywheel/`-namespaced branch name: one indexed read of `worktrees` by `branch`. No
/// git invocation on this path at all — `worktrees.branch` is a stored column.
fn resolve_branch(conn: &Connection, name: &str) -> anyhow::Result<ResolveOutcome> {
    let story_row: Option<(String, String, String)> = conn
        .query_row(
            "SELECT w.project_id, s.id, s.key FROM worktrees w \
             JOIN stories s ON s.id = w.story_id WHERE w.branch = ?1",
            params![name],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    Ok(match story_row {
        Some((project_id, item_id, item_key)) => ResolveOutcome::Resolved(IdentityResolution {
            project_id,
            item_kind: "story".to_string(),
            item_id,
            item_key,
            matched_sha: None,
            run_id: None,
        }),
        None => ResolveOutcome::NotFound,
    })
}

/// Resolve a hash, abbreviated or full: iterate every active project's repository in order,
/// disambiguating an abbreviated prefix within each repository before ever reading trailers, and
/// collecting every repository the sha actually resolves in (a non-zero `git show` exit means the
/// sha is not present there — never an error, just the next repository). Zero repositories
/// resolved is `NotFound`; more than one is [`ResolveOutcome::AmbiguousAcrossRepositories`];
/// exactly one looks the trailer's Story key up in that project's own `stories` table.
fn resolve_sha(conn: &Connection, sha: &str) -> anyhow::Result<ResolveOutcome> {
    // (project_id, full sha, Story trailer value if non-empty, run trailer value if non-empty)
    let mut matched: Vec<(String, String, Option<String>, Option<String>)> = Vec::new();

    for (project_id, repo_path) in active_projects_ordered(conn)? {
        let repo_path = Path::new(&repo_path);

        let full_sha = if sha.len() < 40 {
            let disambiguate_arg = format!("--disambiguate={sha}");
            let output = match git_at(repo_path, &["rev-parse", &disambiguate_arg]) {
                Ok(output) => output,
                Err(_) => continue,
            };
            let text = String::from_utf8_lossy(&output.stdout);
            let lines: Vec<&str> = text.lines().filter(|line| !line.is_empty()).collect();
            if lines.len() >= 2 {
                return Ok(ResolveOutcome::AmbiguousPrefix { matches: lines.len() });
            }
            if lines.is_empty() {
                continue;
            }
            lines[0].to_string()
        } else {
            sha.to_string()
        };

        // Both trailer values in one invocation, separated by a byte the trailer grammar never
        // produces (unit separator, 0x1F) — the key literals are imported from `git_hooks`, never
        // retyped here.
        let format_arg = format!(
            "--format=%(trailers:key={TRAILER_STORY_KEY},valueonly)%x1f%(trailers:key={TRAILER_RUN_KEY},valueonly)"
        );
        let output = match git_at(repo_path, &["show", "-s", &format_arg, sha, "--"]) {
            Ok(output) => output,
            Err(_) => continue,
        };
        let text = String::from_utf8_lossy(&output.stdout);
        let text = text.trim_end_matches('\n');
        let mut parts = text.splitn(2, '\u{1f}');
        let story_key = parts.next().unwrap_or("").trim().to_string();
        let run_val = parts.next().unwrap_or("").trim().to_string();

        matched.push((
            project_id,
            full_sha,
            if story_key.is_empty() { None } else { Some(story_key) },
            if run_val.is_empty() { None } else { Some(run_val) },
        ));
    }

    match matched.len() {
        0 => Ok(ResolveOutcome::NotFound),
        1 => {
            let (project_id, full_sha, story_key_opt, run_opt) = matched.into_iter().next().unwrap();
            let Some(story_key) = story_key_opt else {
                // The commit exists in this repository but carries no Story trailer at all —
                // never an error, just nothing found (D-129: trailer presence, not sha presence,
                // is what "belongs to a Story" means here).
                return Ok(ResolveOutcome::NotFound);
            };
            // The stamped value is always lowercase (the hook extracts it from an already-
            // lowercased branch segment, `branch::story_branch_name`'s own discipline) — compare
            // case-insensitively against the Story's real, display-cased key.
            let found: Option<(String, String)> = conn
                .query_row(
                    "SELECT id, key FROM stories WHERE project_id = ?1 AND LOWER(key) = ?2",
                    params![project_id, story_key],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            match found {
                Some((item_id, item_key)) => Ok(ResolveOutcome::Resolved(IdentityResolution {
                    project_id,
                    item_kind: "story".to_string(),
                    item_id,
                    item_key,
                    matched_sha: Some(full_sha),
                    run_id: run_opt,
                })),
                // A trailer naming a key that does not exist in this project (T-07-05-03: a
                // trailer is self-asserted data, never granted authority on its own).
                None => Ok(ResolveOutcome::NotFound),
            }
        }
        repositories => Ok(ResolveOutcome::AmbiguousAcrossRepositories { repositories }),
    }
}

/// Resolve a classified identifier against the board and, for a sha, against git — reading fresh
/// every time (D-128), never from a cache. Two consecutive calls on the same unchanged input and
/// unchanged board/git state return equal outcomes.
pub fn resolve_identifier(conn: &Connection, ident: &GitIdentifier) -> anyhow::Result<ResolveOutcome> {
    match ident {
        GitIdentifier::Branch(name) => resolve_branch(conn, name),
        GitIdentifier::Sha(sha) => resolve_sha(conn, sha),
    }
}
