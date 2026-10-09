//! D-148's file-set vocabulary and the ONE predicate that answers "does this entry cover this
//! path". The run-time scope hook (through the shim's `--scope-check`) and every plan-time check
//! reach this module and no other, so a plan-time verdict and a run-time verdict can never
//! disagree — the failure class this phase exists to prevent.
//!
//! An entry is exactly one of two forms (D-148), told apart by an explicit trailing separator:
//! `file` — an exact repo-relative path — or `dir` — a directory prefix ending in `/`. General
//! globs are refused: overlap stays decidable, and one broad pattern can never quietly swallow the
//! repository and make a task's scope meaningless.
//!
//! Pure: no I/O, no connection (the `merge.rs` / `branch.rs` convention — plain values in, plain
//! values out). [`parse_entry`] REJECTS, never repairs: a repaired entry is a scope the planner or
//! the developer never wrote down.

use std::fmt;

/// The ONE Rust declaration of the stored `form` vocabulary. Migration `0019_fan_out.sql`'s
/// `task_file_set_entries.form` CHECK mirrors it (single-list discipline, `WORKFLOW_STATES`).
pub const FILE_SET_FORMS: [&str; 2] = ["file", "dir"];

/// One parsed file-set entry. The `Dir` string ALWAYS ends with `/`; neither string is ever empty.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum FileSetEntry {
    File(String),
    Dir(String),
}

/// Why [`parse_entry`] refused a raw string. Every variant is a named cause the UI and the
/// planning pass can show verbatim through [`fmt::Display`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryRefusal {
    Empty,
    SurroundingWhitespace,
    Absolute,
    /// A `.` or `..` path segment.
    DotSegment,
    /// A doubled separator (`a//b`, or `a//` for a directory).
    DoubledSeparator,
    Backslash,
    ControlCharacter,
    /// One of `* ? [ ] { }` — carries the offending character.
    Glob(char),
    /// An entry that names the repository root (`/`, `.`, `./`).
    RepositoryRoot,
    /// A path equal to, or under, the git directory.
    GitDirectory,
}

impl fmt::Display for EntryRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EntryRefusal::Empty => write!(f, "a file-set entry cannot be empty"),
            EntryRefusal::SurroundingWhitespace => {
                write!(f, "a file-set entry cannot start or end with whitespace")
            }
            EntryRefusal::Absolute => {
                write!(f, "a file-set entry must be repo-relative, not an absolute path")
            }
            EntryRefusal::DotSegment => {
                write!(f, "a file-set entry cannot contain a `.` or `..` path segment")
            }
            EntryRefusal::DoubledSeparator => {
                write!(f, "a file-set entry cannot contain a doubled `/` separator")
            }
            EntryRefusal::Backslash => write!(f, "a file-set entry cannot contain a backslash"),
            EntryRefusal::ControlCharacter => {
                write!(f, "a file-set entry cannot contain a control character")
            }
            EntryRefusal::Glob(c) => write!(
                f,
                "a file-set entry is an exact path or a `dir/` prefix; the glob character `{c}` is not allowed"
            ),
            EntryRefusal::RepositoryRoot => {
                write!(f, "a file-set entry cannot name the whole repository")
            }
            EntryRefusal::GitDirectory => {
                write!(f, "a file-set entry cannot name the git directory")
            }
        }
    }
}

impl std::error::Error for EntryRefusal {}

/// Parse one raw entry string. A trailing `/` makes it a `dir`; anything else is a `file`.
///
/// Refuses (never repairs): empty or whitespace-only; surrounding whitespace; absolute; any `.` or
/// `..` segment; a doubled separator; a backslash, NUL or any control character; any of
/// `* ? [ ] { }`; an entry naming the repository root; a path equal to or under `.git`.
pub fn parse_entry(raw: &str) -> Result<FileSetEntry, EntryRefusal> {
    if raw.trim().is_empty() {
        return Err(EntryRefusal::Empty);
    }
    if raw.trim() != raw {
        return Err(EntryRefusal::SurroundingWhitespace);
    }
    // Checked before the absolute / dot-segment refusals: these are the more useful named cause.
    if raw == "/" || raw == "." || raw == "./" {
        return Err(EntryRefusal::RepositoryRoot);
    }
    for c in raw.chars() {
        if c == '\\' {
            return Err(EntryRefusal::Backslash);
        }
        if c.is_control() {
            return Err(EntryRefusal::ControlCharacter);
        }
        if matches!(c, '*' | '?' | '[' | ']' | '{' | '}') {
            return Err(EntryRefusal::Glob(c));
        }
    }
    if raw.starts_with('/') {
        return Err(EntryRefusal::Absolute);
    }

    let is_dir = raw.ends_with('/');
    let body = if is_dir { &raw[..raw.len() - 1] } else { raw };
    for segment in body.split('/') {
        match segment {
            "" => return Err(EntryRefusal::DoubledSeparator),
            "." | ".." => return Err(EntryRefusal::DotSegment),
            _ => {}
        }
    }
    let first = body.split('/').next().unwrap_or("");
    if first.eq_ignore_ascii_case(".git") {
        return Err(EntryRefusal::GitDirectory);
    }

    Ok(if is_dir {
        FileSetEntry::Dir(raw.to_string())
    } else {
        FileSetEntry::File(raw.to_string())
    })
}

/// Whether `entry` covers `rel_path` (a repo-relative path, forward slashes).
///
/// A `File` covers a path iff equal. A `Dir` covers a path iff the path starts with the directory
/// string INCLUDING its trailing separator AND has at least one further component — so
/// `packages/core/src/domain/` covers neither `packages/core/src/domain_x.rs` nor the directory's
/// own path with the separator stripped. `fold_case` compares ASCII-lowercased (a case-insensitive
/// filesystem makes `src/Foo.ts` and `src/foo.ts` one file).
pub fn covers(entry: &FileSetEntry, rel_path: &str, fold_case: bool) -> bool {
    let (entry_str, is_dir) = match entry {
        FileSetEntry::File(p) => (p.as_str(), false),
        FileSetEntry::Dir(p) => (p.as_str(), true),
    };
    if fold_case {
        let e = entry_str.to_ascii_lowercase();
        let p = rel_path.to_ascii_lowercase();
        covers_exact(&e, is_dir, &p)
    } else {
        covers_exact(entry_str, is_dir, rel_path)
    }
}

fn covers_exact(entry: &str, is_dir: bool, path: &str) -> bool {
    if is_dir {
        path.len() > entry.len() && path.starts_with(entry)
    } else {
        path == entry
    }
}

/// The stored `form` string for an entry — always one of [`FILE_SET_FORMS`].
pub fn entry_form(entry: &FileSetEntry) -> &'static str {
    match entry {
        FileSetEntry::File(_) => FILE_SET_FORMS[0],
        FileSetEntry::Dir(_) => FILE_SET_FORMS[1],
    }
}

/// The stored path string for an entry (a `Dir`'s keeps its trailing `/`).
pub fn entry_path(entry: &FileSetEntry) -> &str {
    match entry {
        FileSetEntry::File(p) | FileSetEntry::Dir(p) => p,
    }
}
