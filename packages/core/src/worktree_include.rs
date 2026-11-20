//! The untracked files a new Story worktree gets from the project (issue #1844, ADR 0043).
//!
//! `git worktree add` checks out tracked files only. A project's Checks and dev servers often need
//! more: a `.env`, a `node_modules` folder, a local config. The project lists them, one path in
//! each line, in `.flywheel/worktree-include` in the project's folder. When the core makes a
//! worktree it puts each listed path in the same place of the worktree's project folder:
//!
//! - `path` is COPIED. Use it for a file the Story may change without touching the project's own
//!   copy: `.env`, a local config.
//! - `link: path` is LINKED: the worktree holds a symbolic link to the project's own path. Use it
//!   for a large folder that nobody changes by hand: `node_modules`, a build cache. A copy of
//!   `node_modules` costs time and disk for each Story; a link costs neither. The risk of a link is
//!   that a Story which installs a package changes the project's folder, so a project that wants
//!   its own install in each worktree lists no `link:` line and runs the install in its Check.
//!
//! A `#` starts a comment. A path must be relative and inside the project: an absolute path, a
//! `..` part and a `.git` part are refused, because the list comes from a file in the repository.
//! The list never fails a worktree: a path that does not exist, is refused or cannot be copied is
//! reported in [`Report`] and the rest still goes. A path that already exists in the worktree (a
//! tracked file) is never overwritten.
//!
//! Each listed path is also added to the repository's `info/exclude`. A link to a folder is not
//! matched by the usual `node_modules/` rule in `.gitignore` (the trailing slash matches folders
//! only, a link is not one), and without the exclusion the worktree would read as dirty.

use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use anyhow::Context;

/// The file that holds the list, relative to the project's folder.
pub const INCLUDE_FILE: &str = ".flywheel/worktree-include";

/// How a listed path reaches the worktree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IncludeMode {
    Copy,
    Link,
}

/// One line of the list: a path relative to the project's folder, and how it travels.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncludeEntry {
    pub path: PathBuf,
    pub mode: IncludeMode,
}

/// What [`include_into_worktree`] did, one text for each path, for the `worktree.created` event.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Report {
    pub copied: Vec<String>,
    pub linked: Vec<String>,
    /// Paths that were not put in the worktree, each with its reason.
    pub skipped: Vec<String>,
}

impl Report {
    pub fn is_empty(&self) -> bool {
        self.copied.is_empty() && self.linked.is_empty() && self.skipped.is_empty()
    }
}

/// Parse the list. A refused line is returned in the second part, with its reason.
pub fn parse_include(text: &str) -> (Vec<IncludeEntry>, Vec<String>) {
    let mut entries = Vec::new();
    let mut refused = Vec::new();
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let (mode, path_text) = match line.strip_prefix("link:") {
            Some(rest) => (IncludeMode::Link, rest.trim()),
            None => (IncludeMode::Copy, line),
        };
        let path = PathBuf::from(path_text.trim_end_matches('/'));
        match check_path(&path) {
            Ok(()) => entries.push(IncludeEntry { path, mode }),
            Err(reason) => refused.push(format!("{path_text}: {reason}")),
        }
    }
    (entries, refused)
}

fn check_path(path: &Path) -> Result<(), &'static str> {
    if path.as_os_str().is_empty() {
        return Err("empty path");
    }
    for (index, part) in path.components().enumerate() {
        match part {
            Component::Normal(name) => {
                if index == 0 && name == ".git" {
                    return Err("a .git path is never copied");
                }
            }
            _ => return Err("the path must be relative and stay inside the project"),
        }
    }
    Ok(())
}

/// Read the project's list. A project with no list file has an empty list.
pub fn read_include(project_dir: &Path) -> anyhow::Result<(Vec<IncludeEntry>, Vec<String>)> {
    match fs::read_to_string(project_dir.join(INCLUDE_FILE)) {
        Ok(text) => Ok(parse_include(&text)),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok((Vec::new(), Vec::new())),
        Err(e) => {
            Err(e).with_context(|| format!("could not read {INCLUDE_FILE} in {project_dir:?}"))
        }
    }
}

/// Copy a file, or a folder with everything in it. A link inside a folder is copied as a link.
fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    let meta = fs::symlink_metadata(from)?;
    if meta.file_type().is_symlink() {
        std::os::unix::fs::symlink(fs::read_link(from)?, to)
    } else if meta.is_dir() {
        fs::create_dir_all(to)?;
        for child in fs::read_dir(from)? {
            let child = child?;
            copy_tree(&child.path(), &to.join(child.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ())
    }
}

/// Put every path of the project's list in the worktree's project folder. `project_dir` is the
/// project's folder in the repository; `worktree_project_dir` is the same folder in the new
/// worktree. Never fails on one path: see the module doc. Fails only when the list cannot be read.
pub fn include_into_worktree(
    project_dir: &Path,
    worktree_project_dir: &Path,
) -> anyhow::Result<Report> {
    let (entries, refused) = read_include(project_dir)?;
    let mut report = Report {
        skipped: refused,
        ..Report::default()
    };
    for entry in &entries {
        let name = entry.path.display().to_string();
        let from = project_dir.join(&entry.path);
        let to = worktree_project_dir.join(&entry.path);
        if fs::symlink_metadata(&from).is_err() {
            report.skipped.push(format!("{name}: not in the project"));
            continue;
        }
        if fs::symlink_metadata(&to).is_ok() {
            report
                .skipped
                .push(format!("{name}: already in the worktree"));
            continue;
        }
        let made = to
            .parent()
            .map_or(Ok(()), fs::create_dir_all)
            .and_then(|()| match entry.mode {
                IncludeMode::Copy => copy_tree(&from, &to),
                IncludeMode::Link => match fs::canonicalize(&from) {
                    Ok(target) => std::os::unix::fs::symlink(target, &to),
                    Err(e) => Err(e),
                },
            });
        match (made, entry.mode) {
            (Ok(()), IncludeMode::Copy) => report.copied.push(name),
            (Ok(()), IncludeMode::Link) => report.linked.push(name),
            (Err(e), _) => report.skipped.push(format!("{name}: {e}")),
        }
    }
    let placed: Vec<&IncludeEntry> = entries
        .iter()
        .filter(|e| {
            let name = e.path.display().to_string();
            report.copied.contains(&name) || report.linked.contains(&name)
        })
        .collect();
    if let Err(e) = exclude(worktree_project_dir, &placed) {
        report.skipped.push(format!("info/exclude: {e:#}"));
    }
    Ok(report)
}

/// Add each placed path to the repository's `info/exclude`, so a worktree that holds it reads as
/// clean. Lines already there are not added again.
fn exclude(worktree_project_dir: &Path, placed: &[&IncludeEntry]) -> anyhow::Result<()> {
    if placed.is_empty() {
        return Ok(());
    }
    let prefix = crate::git::project_subdir(worktree_project_dir)?;
    let out = crate::git::git_at(
        worktree_project_dir,
        &["rev-parse", "--git-path", "info/exclude"],
    )?;
    let file = worktree_project_dir.join(String::from_utf8_lossy(&out.stdout).trim());
    let current = fs::read_to_string(&file).unwrap_or_default();
    let mut text = current.clone();
    for entry in placed {
        let rooted = if prefix.is_empty() {
            format!("/{}", entry.path.display())
        } else {
            format!("/{prefix}/{}", entry.path.display())
        };
        if !current.lines().any(|l| l == rooted) {
            if !text.is_empty() && !text.ends_with('\n') {
                text.push('\n');
            }
            text.push_str(&rooted);
            text.push('\n');
        }
    }
    if text != current {
        if let Some(parent) = file.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&file, text)?;
    }
    Ok(())
}

/// Texts in a Check's output that mean the project's dependencies, or an untracked file, are not in
/// the worktree. Lower case. A Check that fails for another reason does not match them.
const MISSING_MARKERS: &[&str] = &[
    "cannot find module",
    "err_module_not_found",
    "modulenotfounderror",
    "no module named",
    "node_modules: no such file",
    "command not found",
    "could not find a package.json",
    "enoent: no such file or directory, open '",
    "error: cannot find package",
    ".env: no such file",
    "no such file or directory: '.env",
];

/// The line a failed Check shows when its output reads as missing dependencies or a missing
/// untracked file; `None` otherwise. A text match on the output tail, not a proof: it costs no
/// extra run, and it names no cause the output does not show (ADR 0043).
pub fn dependencies_missing_line(output_tail: &str) -> Option<String> {
    let lower = output_tail.to_lowercase();
    MISSING_MARKERS.iter().any(|m| lower.contains(m)).then(|| {
        format!(
            "Dependencies missing in this worktree? List the untracked files it needs in {INCLUDE_FILE}."
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, rel: &str, body: &str) {
        let path = dir.join(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn the_list_has_copy_and_link_lines_and_refuses_paths_outside_the_project() {
        let (entries, refused) = parse_include(
            "# local files\n.env\nlink: node_modules/  # big\n\n../secret\n/etc/passwd\n.git/config\nlink:\n",
        );
        assert_eq!(
            entries,
            vec![
                IncludeEntry {
                    path: ".env".into(),
                    mode: IncludeMode::Copy
                },
                IncludeEntry {
                    path: "node_modules".into(),
                    mode: IncludeMode::Link
                },
            ]
        );
        assert_eq!(refused.len(), 4, "{refused:?}");
    }

    #[test]
    fn a_project_without_a_list_includes_nothing() {
        let project = tempfile::tempdir().unwrap();
        let worktree = tempfile::tempdir().unwrap();
        let report = include_into_worktree(project.path(), worktree.path()).unwrap();
        assert!(report.is_empty());
    }

    #[test]
    fn a_file_and_a_folder_are_copied_and_a_folder_can_be_linked() {
        let project = tempfile::tempdir().unwrap();
        let worktree = tempfile::tempdir().unwrap();
        write(
            project.path(),
            INCLUDE_FILE,
            ".env\nconfig/local\nlink: node_modules\nmissing.txt\n../x\n",
        );
        write(project.path(), ".env", "TOKEN=abc\n");
        write(project.path(), "config/local/a.json", "{}");
        write(
            project.path(),
            "node_modules/dep/index.js",
            "module.exports = 1;\n",
        );

        // No git here: the exclusion fails and is reported, and the placing still happened.
        let report = include_into_worktree(project.path(), worktree.path()).unwrap();

        assert_eq!(report.copied, vec![".env", "config/local"]);
        assert_eq!(report.linked, vec!["node_modules"]);
        assert_eq!(
            fs::read_to_string(worktree.path().join(".env")).unwrap(),
            "TOKEN=abc\n"
        );
        assert_eq!(
            fs::read_to_string(worktree.path().join("config/local/a.json")).unwrap(),
            "{}"
        );
        let link = worktree.path().join("node_modules");
        assert!(fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(link.join("dep/index.js").exists());
        // A copy is a copy: a change in the worktree leaves the project's file alone.
        fs::write(worktree.path().join(".env"), "TOKEN=changed\n").unwrap();
        assert_eq!(
            fs::read_to_string(project.path().join(".env")).unwrap(),
            "TOKEN=abc\n"
        );
        assert!(report
            .skipped
            .iter()
            .any(|s| s.starts_with("missing.txt: not in the project")));
        assert!(report.skipped.iter().any(|s| s.starts_with("../x")));
    }

    #[test]
    fn a_path_that_is_already_in_the_worktree_is_not_overwritten() {
        let project = tempfile::tempdir().unwrap();
        let worktree = tempfile::tempdir().unwrap();
        write(project.path(), INCLUDE_FILE, ".env\n");
        write(project.path(), ".env", "from the project\n");
        write(worktree.path(), ".env", "tracked\n");
        let report = include_into_worktree(project.path(), worktree.path()).unwrap();
        assert!(report.copied.is_empty());
        assert_eq!(
            fs::read_to_string(worktree.path().join(".env")).unwrap(),
            "tracked\n"
        );
        assert!(report.skipped[0].contains("already in the worktree"));
    }

    #[test]
    fn output_that_reads_as_missing_dependencies_gets_the_line() {
        for tail in [
            "Error: Cannot find module 'left-pad'\nRequire stack:",
            "sh: vitest: command not found",
            "ModuleNotFoundError: No module named 'requests'",
        ] {
            assert!(dependencies_missing_line(tail).is_some(), "{tail}");
        }
        assert!(dependencies_missing_line("assertion failed: left == right").is_none());
        assert!(dependencies_missing_line("").is_none());
    }
}
