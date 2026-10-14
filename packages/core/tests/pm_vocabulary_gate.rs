//! FNC-04 (D-20, D-21, D-23, D-24, A-02): the forbidden-PM-vocabulary source gate.
//!
//! The Cycle layer must not drift into Jira by accretion. Any whole-word use of the ten words below
//! in `packages/core/src`, `packages/desktop/src` (which holds the desktop `__tests__` trees) or
//! `packages/core/tests` fails `cargo test -p core`. Planning documents are never scanned.
//!
//! Self-contained per this repo's own precedent (`proposal_no_promotion.rs`): carries its own
//! copies of `workspace_root`/`is_whole_line_comment`/`sources_under`. No env var, `cfg` switch,
//! `#[ignore]` or baseline fixture exists here — a gate with an off switch is a gate that is off.
//! This file does not scan itself: its corpus and planted fixtures necessarily spell the words.

use std::path::{Path, PathBuf};

// --- Shared source-scanning helpers (copied from `proposal_no_promotion.rs`) ---

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

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path
                .extension()
                .is_some_and(|e| e == "rs" || e == "ts" || e == "tsx")
            {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths
        .into_iter()
        .map(|p| {
            let body = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}

// --- The corpus and its two idiom exclusions ---

/// The ten words of the PM long tail. Lowercase; matched case-insensitively, as whole words.
const FORBIDDEN_PM_WORDS: [&str; 10] = [
    "velocity",
    "burndown",
    "burnup",
    "capacity",
    "story_point",
    "sprint",
    "deadline",
    "due_date",
    "overdue",
    "rollover",
];

/// One literal language idiom that legitimately contains a corpus word. Never a general allowlist
/// of PM vocabulary: each entry names one literal, optionally one path, and why.
struct IdiomExclusion {
    literal: &'static str,
    path_suffix: Option<&'static str>,
    reason: &'static str,
}

/// Exactly two (D-20). An exclusion suppresses a hit only when the hit word is part of `literal`,
/// the matched line contains `literal`, and the file path ends with `path_suffix` if one is set.
const IDIOM_EXCLUSIONS: [IdiomExclusion; 2] = [
    IdiomExclusion {
        literal: "with_capacity",
        path_suffix: None,
        reason: "`Vec::with_capacity`/`String::with_capacity` is idiomatic Rust pre-allocation, not \
                 team capacity. A committed baseline was rejected instead: every future \
                 pre-allocation would fail the build until the baseline was regenerated.",
    },
    IdiomExclusion {
        literal: "deadline",
        path_suffix: Some("src/proc.rs"),
        reason: "a timeout `Instant` for subprocess supervision, not a date on a work item.",
    },
];

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// True when `line_lower` holds `word` with a non-word character (or a line edge) on both sides.
fn has_whole_word(line_lower: &str, word: &str) -> bool {
    line_lower.match_indices(word).any(|(i, _)| {
        let before = line_lower[..i].chars().next_back();
        let after = line_lower[i + word.len()..].chars().next();
        !before.is_some_and(is_word_char) && !after.is_some_and(is_word_char)
    })
}

/// The matcher both the real gate and the planted-violation tests drive. Pushes one offender per
/// offending line, formatted `{path}:{line}: {trimmed line}`.
fn scan_body_for_pm_words(path: &Path, body: &str, offenders: &mut Vec<String>) {
    let path_str = path.to_string_lossy();
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        // ASCII lowercasing keeps byte offsets stable for the boundary checks.
        let lower = line.to_ascii_lowercase();
        let offending = FORBIDDEN_PM_WORDS.iter().any(|word| {
            has_whole_word(&lower, word)
                && !IDIOM_EXCLUSIONS.iter().any(|e| {
                    e.literal.contains(word)
                        && lower.contains(e.literal)
                        && e.path_suffix.is_none_or(|s| path_str.ends_with(s))
                })
        });
        if offending {
            offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
        }
    }
}

/// Distinct scan roots. `packages/desktop/src` already holds the desktop `__tests__` trees.
const SCAN_ROOTS: [&str; 3] = ["packages/core/src", "packages/desktop/src", "packages/core/tests"];

// --- The real gate ---

#[test]
fn no_pm_vocabulary_in_core_or_desktop_source() {
    let root = workspace_root();
    let mut offenders = Vec::new();
    for rel in SCAN_ROOTS {
        for (path, body) in sources_under(&root.join(rel)) {
            let path_str = path.to_string_lossy();
            if path_str.contains("/.planning/") || path_str.ends_with("tests/pm_vocabulary_gate.rs") {
                continue;
            }
            scan_body_for_pm_words(&path, &body, &mut offenders);
        }
    }
    offenders.sort();

    assert!(
        offenders.is_empty(),
        "FNC-04: PM vocabulary found in source. Forbidden whole words: {FORBIDDEN_PM_WORDS:?}. \
         Only these idiom exclusions exist: {}. Offending lines:\n  {}",
        IDIOM_EXCLUSIONS
            .iter()
            .map(|e| format!("`{}` (path: {:?}) — {}", e.literal, e.path_suffix, e.reason))
            .collect::<Vec<_>>()
            .join("; "),
        offenders.join("\n  ")
    );
}

// --- The gate on the gate ---

#[test]
fn the_pm_vocabulary_gate_walker_reaches_every_scanned_tree() {
    let root = workspace_root();
    let mut all = Vec::new();
    for rel in SCAN_ROOTS {
        let collected = sources_under(&root.join(rel));
        assert!(!collected.is_empty(), "the walker collected no sources under {rel} — the gate is dead coverage there");
        all.extend(collected.into_iter().map(|(p, _)| p));
    }
    for ext in ["rs", "ts", "tsx"] {
        assert!(
            all.iter().any(|p| p.extension().is_some_and(|e| e == ext)),
            "the walker reached no .{ext} file across the scanned trees"
        );
    }
    assert!(
        all.iter().any(|p| p.to_string_lossy().contains("/__tests__/")),
        "the walker did not reach a desktop __tests__ tree"
    );
}

// --- Two-sided proof: the gate fires, and each exclusion stays narrow ---

fn offenders_for(path: &str, body: &str) -> usize {
    let mut offenders = Vec::new();
    scan_body_for_pm_words(Path::new(path), body, &mut offenders);
    offenders.len()
}

#[test]
fn the_gate_fires_on_a_planted_violation() {
    assert_eq!(offenders_for("src/x.rs", "let sprint = 3;"), 1, "plain whole-word hit");
    assert_eq!(offenders_for("src/x.ts", "const Sprint = 3;"), 1, "case-insensitive hit");
    assert_eq!(
        offenders_for("src/x.rs", "let capacity = 40; // team capacity per cycle"),
        1,
        "a PM-shaped use of an excluded word still fails"
    );
    assert_eq!(
        offenders_for("src/domain/task.rs", "pub deadline: Option<String>,"),
        1,
        "the deadline exclusion is path-scoped, not global"
    );
    assert_eq!(
        offenders_for("src/domain/task.rs", "let a = Vec::with_capacity(8);\nlet due_date = 1;"),
        1,
        "with_capacity on one line does not shield a hit on the next"
    );
}

#[test]
fn the_gate_is_silent_on_each_named_idiom_exclusion() {
    assert_eq!(offenders_for("src/x.rs", "Vec::with_capacity(8)"), 0, "with_capacity idiom");
    assert_eq!(offenders_for("src/x.rs", "let n = story_points_total;"), 0, "identifier containing a corpus word");
    assert_eq!(
        offenders_for("packages/core/src/proc.rs", "let deadline = Instant::now() + timeout;"),
        0,
        "timeout deadline in proc.rs"
    );
    assert_eq!(offenders_for("src/x.rs", "// the sprint is over"), 0, "whole-line comment");
}
