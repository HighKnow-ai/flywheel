//! Phase 12, plan 12-01 Task 2 (T-12-01): pins `packages/shim/src/main.rs`'s double-quoted
//! string-literal set to a committed baseline. A forbidden-token list only ever catches the token
//! someone thought of — this is the enumerate-and-hope pattern rounds five through nine of
//! the retired trust-boundary doc fought and is exactly what this phase's own scope
//! fence exists to stop. A whole-set pin catches ANY new recognition token the classifier gains,
//! including a launcher or wrapper token nobody has thought of yet, and turns a legitimate
//! addition (e.g. a future `--gate-push` entry point) into a deliberate, reviewed baseline diff in
//! the same commit rather than a silent widening.
//!
//! Self-contained per this repo's own precedent (`proposal_no_promotion.rs`,
//! `app_exit_ordering.rs`, `session_closed_call_site.rs`): carries its own copies of
//! `workspace_root`/`is_whole_line_comment` rather than sharing another test file's module.

use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

/// Strip a trailing `//` comment from a code line, respecting double-quoted string literals so a
/// `//` appearing INSIDE a string (e.g. a URL) is never mistaken for a comment start. A `\`
/// escapes the following character so an escaped quote (`\"`) does not end the literal early.
fn strip_trailing_comment(line: &str) -> String {
    let mut result = String::with_capacity(line.len());
    let mut chars = line.chars().peekable();
    let mut in_string = false;
    while let Some(c) = chars.next() {
        if in_string {
            result.push(c);
            if c == '\\' {
                if let Some(next) = chars.next() {
                    result.push(next);
                }
                continue;
            }
            if c == '"' {
                in_string = false;
            }
            continue;
        }
        if c == '"' {
            in_string = true;
            result.push(c);
            continue;
        }
        if c == '/' && chars.peek() == Some(&'/') {
            break;
        }
        result.push(c);
    }
    result
}

/// Extract every double-quoted string literal's inner text (quotes stripped, escapes preserved
/// verbatim) from one already-comment-stripped line. A `'x'`/`'\x'` single-quoted char literal is
/// recognised and skipped as an opaque unit first, so a double quote living INSIDE a char literal
/// (e.g. `'"'`, this file's own `main.rs` has two) is never mistaken for the start of a string.
fn string_literals_on_line(line: &str) -> Vec<String> {
    let chars: Vec<char> = line.chars().collect();
    let mut literals = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '\'' {
            // Escaped char literal: 'x' preceded by a backslash — '\'', '\\', '\n', ...
            if i + 3 < chars.len() && chars[i + 1] == '\\' && chars[i + 3] == '\'' {
                i += 4;
                continue;
            }
            // Plain single-character literal: 'x'
            if i + 2 < chars.len() && chars[i + 2] == '\'' {
                i += 3;
                continue;
            }
            i += 1;
            continue;
        }
        if c == '"' {
            let mut literal = String::new();
            i += 1;
            while i < chars.len() {
                let ch = chars[i];
                if ch == '\\' {
                    literal.push(ch);
                    i += 1;
                    if i < chars.len() {
                        literal.push(chars[i]);
                        i += 1;
                    }
                    continue;
                }
                if ch == '"' {
                    i += 1;
                    break;
                }
                literal.push(ch);
                i += 1;
            }
            literals.push(literal);
            continue;
        }
        i += 1;
    }
    literals
}

/// The sorted, de-duplicated set of every double-quoted string literal in `contents`, excluding
/// whole-line `//` comments (a doc comment describing a literal must not itself count as one) and
/// the trailing `//` comment portion of any code line.
fn string_literals_in(contents: &str) -> Vec<String> {
    let mut literals = Vec::new();
    for raw_line in contents.lines() {
        if is_whole_line_comment(raw_line) {
            continue;
        }
        let stripped = strip_trailing_comment(raw_line);
        literals.extend(string_literals_on_line(&stripped));
    }
    literals.sort();
    literals.dedup();
    literals
}

/// Parse the committed baseline fixture: one literal per non-header line, `#`-prefixed lines
/// skipped (the header explaining what this file pins and why).
fn baseline_literals(contents: &str) -> Vec<String> {
    let mut literals: Vec<String> = contents
        .lines()
        .filter(|line| !line.starts_with('#'))
        .map(|line| line.to_string())
        .collect();
    literals.sort();
    literals.dedup();
    literals
}

#[test]
fn shim_main_string_literals_match_baseline() {
    let root = workspace_root();
    let main_rs_path = root.join("packages/shim/src/main.rs");
    let main_rs = std::fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", main_rs_path.display()));
    let actual = string_literals_in(&main_rs);

    let baseline_path = root.join("packages/core/tests/fixtures/shim-main-string-literals.baseline.txt");
    let baseline_contents = std::fs::read_to_string(&baseline_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", baseline_path.display()));
    let baseline = baseline_literals(&baseline_contents);

    let unexpected: Vec<&String> = actual.iter().filter(|l| !baseline.contains(l)).collect();
    let disappeared: Vec<&String> = baseline.iter().filter(|l| !actual.contains(l)).collect();

    assert!(
        unexpected.is_empty() && disappeared.is_empty(),
        "packages/shim/src/main.rs's string-literal set no longer matches the committed baseline \
         ({}).\n\
         A new literal here — including any new launcher or wrapper recognition token — is the \
         specific regression this gate exists to catch (rounds five through nine of \
         the retired trust-boundary doc). If this is a deliberate, reviewed addition \
         (e.g. a new --gate-push entry point), regenerate the baseline and justify the diff in \
         the commit message.\n\
         UNEXPECTED (present in main.rs, absent from baseline): {:?}\n\
         DISAPPEARED (present in baseline, absent from main.rs): {:?}",
        baseline_path.display(),
        unexpected,
        disappeared
    );
}

/// Without this, a broken extractor (e.g. one that always returns an empty set) would compare two
/// empty sets and pass vacuously, defeating the whole gate silently.
#[test]
fn literal_extraction_is_not_vacuous() {
    let root = workspace_root();
    let main_rs_path = root.join("packages/shim/src/main.rs");
    let main_rs = std::fs::read_to_string(&main_rs_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", main_rs_path.display()));
    let actual = string_literals_in(&main_rs);
    assert!(
        !actual.is_empty(),
        "expected packages/shim/src/main.rs to contain at least one double-quoted string literal \
         — an empty extraction would make shim_main_string_literals_match_baseline pass vacuously \
         against an equally-empty baseline"
    );

    let baseline_path = root.join("packages/core/tests/fixtures/shim-main-string-literals.baseline.txt");
    let baseline_contents = std::fs::read_to_string(&baseline_path)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", baseline_path.display()));
    let baseline = baseline_literals(&baseline_contents);
    assert!(
        !baseline.is_empty(),
        "expected {} to contain at least one non-header literal line",
        baseline_path.display()
    );
}
