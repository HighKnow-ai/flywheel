//! The committed project identity marker (D-15, D-16, BOARD-10).
//!
//! **Path and format** were an explicit owner decision at plan 01-11 Task 1 (a
//! `checkpoint:decision`, resolved 2026-09-09; recorded in `01-RESEARCH.md`'s Open Question 2
//! and Assumption A1): `.flywheel/project.json` at the repository root, JSON via `serde_json`
//! (already in this crate's dependency graph for event payloads — no new dependency added), and
//! COMMITTED, never `.gitignore`d — a teammate cloning the repository must see the same project
//! identity (D-20). The accepted, deliberate cost of JSON over TOML: the marker cannot carry an
//! explanatory comment for a teammate who finds it in a diff and has never heard of Flywheel;
//! the owner was shown that trade-off and chose JSON anyway, since D-15 forbids adding a field to
//! carry that explanation instead.
//!
//! **Content** is fixed by D-15: exactly the project id and the project key prefix, never board
//! content, never event data, never a database file (T-01-30). [`write_marker`] is the only
//! function in this crate that writes into a path outside the app-data directory.
//!
//! Every function here takes an explicit absolute repository path (`ARCHITECTURE.md`
//! Anti-Pattern 3) — nothing reads the process working directory, and marker *content* is never
//! used to construct a path to visit: a marker is data read *at* a path the database already
//! holds, never a source of a path to visit (T-01-03).

use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// The marker's location inside a registered repository, relative to its root — the owner
/// decision this module's doc comment records.
const MARKER_DIR: &str = ".flywheel";
const MARKER_FILE: &str = "project.json";

/// The committed marker's full content (D-15) — the project id and the project key prefix, and
/// nothing else. `#[serde(deny_unknown_fields)]` is deliberately NOT set here: a marker written
/// by a future version carrying an extra field must still be readable by this one, per
/// [`read_marker`]'s "never a partially-populated marker" contract. "Exactly two fields" is a
/// WRITER-side discipline instead, asserted by a test on [`write_marker`]'s serialized output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectMarker {
    pub project_id: String,
    pub project_key: String,
}

fn marker_path(repo_path: &Path) -> PathBuf {
    repo_path.join(MARKER_DIR).join(MARKER_FILE)
}

/// Read the marker at `repo_path`. `Ok(None)` means no marker exists there — a fresh repository,
/// or one Flywheel has never registered, is a normal and expected state, never an error. A
/// malformed or truncated marker returns `Err` naming the file, never a partially-populated
/// [`ProjectMarker`].
pub fn read_marker(repo_path: &Path) -> anyhow::Result<Option<ProjectMarker>> {
    let path = marker_path(repo_path);
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("failed to read marker at {path:?}")),
    };
    let marker: ProjectMarker = serde_json::from_str(&contents)
        .with_context(|| format!("marker at {path:?} is malformed or truncated"))?;
    Ok(Some(marker))
}

/// Write `marker` at `repo_path`, creating the `.flywheel/` directory if it does not already
/// exist. Writes exactly the two fields [`ProjectMarker`] declares — no board content, no event
/// data, no database file (D-15, T-01-30). Callers write this ONLY after their own database
/// transaction has committed, so a failed write never leaves a marker behind that the database
/// disagrees with (`domain::project::register_project`'s own contract).
pub fn write_marker(repo_path: &Path, marker: &ProjectMarker) -> anyhow::Result<()> {
    let dir = repo_path.join(MARKER_DIR);
    fs::create_dir_all(&dir).with_context(|| format!("failed to create {dir:?}"))?;
    let path = marker_path(repo_path);
    let serialized =
        serde_json::to_string_pretty(marker).context("failed to serialize the project marker")?;
    fs::write(&path, serialized).with_context(|| format!("failed to write marker at {path:?}"))?;
    Ok(())
}

/// Verify the marker at `repo_path` names `expected_project_id`. `Ok(false)` — never an error —
/// covers both "no marker there" and "a marker naming a different project," which are exactly
/// the two normal inputs [`crate::domain::project::reconcile_projects`] and
/// [`crate::domain::project::relocate_project`] must distinguish from "matches" without treating
/// either as exceptional.
pub fn verify_marker(repo_path: &Path, expected_project_id: &str) -> anyhow::Result<bool> {
    Ok(read_marker(repo_path)?.is_some_and(|marker| marker.project_id == expected_project_id))
}
