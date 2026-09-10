//! PROC-02 as a gate, not a convention (plan 02-01 Task 3): a source-scanning test in the style of
//! `migration_safety.rs` — it reads real source files from disk rather than asserting against a
//! duplicated copy of their contents, so a future violation turns this suite red instead of
//! passing review on a comment.
//!
//! Walks every `.rs` file under `packages/core/src` and `packages/desktop/src-tauri/src`, strips
//! whole-line comments before matching (a doc comment describing the rule cannot satisfy or
//! violate it), and asserts:
//! 1. Zero occurrences of the process-wide current-directory getter (`env::current_dir`) or
//!    setter (`env::set_current_dir`).
//! 2. Zero `Command` constructions that set a current directory to a value that does not look
//!    like an absolute-path parameter.
//! 3. Every `Command::new("git")` in the workspace lives inside `packages/core/src/git.rs`.
//! 4. Inside `git.rs`, the `-C` argument is applied before any subcommand argument, for every
//!    `Command::new("git")` call site in that file.

use std::path::{Path, PathBuf};

/// One matched violation, carrying enough to build an actionable failure message (file + line).
struct Violation {
    file: PathBuf,
    line_no: usize,
    line: String,
    rule: &'static str,
}

impl std::fmt::Display for Violation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}:{}: {} — {}",
            self.file.display(),
            self.line_no,
            self.rule,
            self.line.trim()
        )
    }
}

/// Strip a whole-line `//` comment (leading whitespace then `//`) — a doc comment describing the
/// rule must not itself trip the gate. Does NOT attempt to strip trailing/inline comments; every
/// rule this file checks for is written as its own statement on its own line in this codebase, so
/// a whole-line strip is sufficient and keeps the scan simple and auditable.
fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn rust_files_under(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|ext| ext == "rs") {
                out.push(path);
            }
        }
    }
    out
}

fn workspace_root() -> PathBuf {
    // CARGO_MANIFEST_DIR is packages/core — walk up two levels to the workspace root.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

/// A `.current_dir(...)` call whose argument text does not look like an absolute-path parameter
/// (a heuristic: it mentions "path" — every legitimate absolute-path variable in this codebase is
/// named with "path" in it, e.g. `worktree_path`, `repo_path`). Zero such calls exist in this
/// codebase today (PROC-02) — every git invocation instead passes `-C <path>` explicitly.
fn current_dir_arg_looks_non_absolute(line: &str) -> bool {
    if let Some(start) = line.find(".current_dir(") {
        let after = &line[start + ".current_dir(".len()..];
        let arg = after.split(')').next().unwrap_or("");
        return !arg.to_lowercase().contains("path");
    }
    false
}

fn scan_file(path: &Path, violations: &mut Vec<Violation>) {
    let Ok(contents) = std::fs::read_to_string(path) else { return };
    for (idx, raw_line) in contents.lines().enumerate() {
        let line_no = idx + 1;
        if is_whole_line_comment(raw_line) {
            continue;
        }

        if raw_line.contains("env::current_dir") && !raw_line.contains("set_current_dir") {
            violations.push(Violation {
                file: path.to_path_buf(),
                line_no,
                line: raw_line.to_string(),
                rule: "process-wide current-directory getter (env::current_dir)",
            });
        }
        if raw_line.contains("set_current_dir") {
            violations.push(Violation {
                file: path.to_path_buf(),
                line_no,
                line: raw_line.to_string(),
                rule: "process-wide current-directory setter (env::set_current_dir)",
            });
        }
        if current_dir_arg_looks_non_absolute(raw_line) {
            violations.push(Violation {
                file: path.to_path_buf(),
                line_no,
                line: raw_line.to_string(),
                rule: "Command::current_dir() argument does not look like an absolute-path parameter",
            });
        }
    }
}

#[test]
fn no_ambient_current_directory_reads_or_writes_in_core_or_supervisor() {
    let root = workspace_root();
    let mut violations = Vec::new();
    for dir in [root.join("packages/core/src"), root.join("packages/desktop/src-tauri/src")] {
        for file in rust_files_under(&dir) {
            scan_file(&file, &mut violations);
        }
    }

    assert!(
        violations.is_empty(),
        "PROC-02 violations found:\n{}",
        violations.iter().map(|v| v.to_string()).collect::<Vec<_>>().join("\n")
    );
}

#[test]
fn a_seeded_violation_is_caught_and_named_by_file_and_line() {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let fixture_path = dir.path().join("fixture_violation.rs");
    std::fs::write(
        &fixture_path,
        "// a harmless comment\nfn f() {\n    std::env::set_current_dir(\"/tmp\").unwrap();\n}\n",
    )
    .expect("failed to write fixture file");

    let mut violations = Vec::new();
    scan_file(&fixture_path, &mut violations);

    assert_eq!(violations.len(), 1, "expected exactly one seeded violation to be caught");
    let violation = &violations[0];
    assert_eq!(violation.file, fixture_path);
    assert_eq!(violation.line_no, 3, "the violation must name the exact 1-based line it occurred on");
    let message = violation.to_string();
    assert!(message.contains(&fixture_path.display().to_string()) && message.contains(":3:"));
}

#[test]
fn stripping_a_commented_out_occurrence_does_not_trip_the_gate() {
    // Proves the whole-line-comment strip actually works — a fixture string containing a
    // commented-out violation must not be flagged.
    let fixture = "    // std::env::set_current_dir(\"/tmp\").unwrap();\n";
    let mut violations = Vec::new();
    for (idx, raw_line) in fixture.lines().enumerate() {
        let line_no = idx + 1;
        if is_whole_line_comment(raw_line) {
            continue;
        }
        if raw_line.contains("set_current_dir") {
            violations.push(Violation {
                file: PathBuf::from("<fixture>"),
                line_no,
                line: raw_line.to_string(),
                rule: "process-wide current-directory setter (env::set_current_dir)",
            });
        }
    }
    assert!(
        violations.is_empty(),
        "a commented-out occurrence must not trip the gate, got: {:?}",
        violations.iter().map(|v| v.to_string()).collect::<Vec<_>>()
    );
}

#[test]
fn every_git_command_construction_lives_in_git_rs() {
    let root = workspace_root();
    let mut offenders = Vec::new();
    for dir in [root.join("packages/core/src"), root.join("packages/desktop/src-tauri/src")] {
        for file in rust_files_under(&dir) {
            if file.ends_with("core/src/git.rs") {
                continue;
            }
            let Ok(contents) = std::fs::read_to_string(&file) else { continue };
            for (idx, raw_line) in contents.lines().enumerate() {
                if is_whole_line_comment(raw_line) {
                    continue;
                }
                if raw_line.contains("Command::new(\"git\")") {
                    offenders.push(format!("{}:{}: {}", file.display(), idx + 1, raw_line.trim()));
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "found Command::new(\"git\") outside packages/core/src/git.rs:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn git_rs_applies_dash_c_before_any_subcommand_argument() {
    let root = workspace_root();
    let git_rs = root.join("packages/core/src/git.rs");
    let contents = std::fs::read_to_string(&git_rs).expect("git.rs should exist");

    // For every `Command::new("git")` call site (a builder chain spanning a few lines), the very
    // next `.arg(...)`/`.args([...])` calls must be `.arg("-C")` then the path — never a
    // subcommand token first. Scan each call site's immediate builder chain (up to 6 lines,
    // generous enough for this file's own formatting) for the first `.arg(`/`.args(` calls.
    let lines: Vec<&str> = contents.lines().collect();
    let mut call_sites_checked = 0;
    for (idx, line) in lines.iter().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        if !line.contains("Command::new(\"git\")") {
            continue;
        }
        call_sites_checked += 1;
        let window: String = lines[idx..(idx + 6).min(lines.len())].join("\n");
        let dash_c_pos = window.find(".arg(\"-C\")");
        // The first subcommand-shaped call after the -C/path pair — look for `.args([` (our
        // wrapper always passes the trailing subcommand args as a slice) after the -C pair.
        let subcommand_args_pos = window.find(".args(");
        match (dash_c_pos, subcommand_args_pos) {
            (Some(c), Some(s)) => assert!(
                c < s,
                "expected -C to be applied before subcommand args at line {}, window:\n{window}",
                idx + 1
            ),
            (Some(_), None) => {
                // A call site with no .args([...]) at all (e.g. rev_parse_verify uses a plain
                // .args([...]) too, so this branch is defensive only) — nothing to compare.
            }
            _ => panic!("expected .arg(\"-C\") immediately after Command::new(\"git\") at line {}, window:\n{window}", idx + 1),
        }
    }
    assert!(call_sites_checked > 0, "expected at least one Command::new(\"git\") call site in git.rs");
}
