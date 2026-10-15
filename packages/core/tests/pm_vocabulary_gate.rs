//! FNC-04 (D-20, D-21, D-23, D-24, A-02): the forbidden-PM-vocabulary source gate.
//!
//! The Cycle layer must not drift into Jira by accretion. Any use of one of the ten words below as
//! an identifier COMPONENT (`sprint`, `sprint_id`, `overdueCount`, `velocity_per_week`,
//! `story_points_total`) in `packages/core/src`, `packages/desktop/src` (which holds the desktop
//! `__tests__` trees) or `packages/core/tests` fails `cargo test -p core`, with exactly two named
//! idiom exclusions. Migrations (`.sql`) are scanned too (D-21, see `SCANNED_EXTENSIONS`); a SQL `--`
//! comment is not a whole-line comment to this gate, so it counts. Planning documents are never scanned.
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

/// The file extensions the gate scans.
///
/// `.sql` joined in phase 14 (D-21), reversing the phase 13 deferral. The deferral's own
/// counter-argument named the hole: the spine pin covers the `CREATE TABLE` text of
/// `epics`/`tasks`/`issues`/`cycles` only and table classification covers table NAMES, so a new
/// table's `sprint_length_days` column passed all three gates (PROJECT.md A-06). Now a corpus word
/// used as a column name in any migration fails the build. It fires on nothing today: no corpus word
/// appears in any migration. Reversal is one token plus the array length (the walker-reach test
/// follows this const).
const SCANNED_EXTENSIONS: [&str; 4] = ["rs", "ts", "tsx", "sql"];

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path
                .extension()
                .is_some_and(|e| SCANNED_EXTENSIONS.iter().any(|x| e == *x))
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

/// True when `word` occurs in `line_lower` starting at an identifier-component boundary. The
/// character AFTER the word is unconstrained, so `story_points_total` holds `story_point`.
///
/// A boundary before byte `i` is: the line start; a preceding character that is not alphabetic
/// (`_`, a digit, punctuation, whitespace); or an ASCII uppercase character at `i` in `original`
/// (the camelCase transition, `overdueCount` / `teamCapacity`). `line_lower` is the ASCII-lowercased
/// `original`, so byte offsets agree between the two.
fn has_word_prefix_at_boundary(line_lower: &str, original: &str, word: &str) -> bool {
    line_lower.match_indices(word).any(|(i, _)| {
        let before = line_lower[..i].chars().next_back();
        !before.is_some_and(char::is_alphabetic) || original.as_bytes()[i].is_ascii_uppercase()
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
            has_word_prefix_at_boundary(&lower, line, word)
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
        "FNC-04: PM vocabulary found in source. Forbidden identifier-component prefixes: {FORBIDDEN_PM_WORDS:?}. \
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
    for ext in SCANNED_EXTENSIONS {
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
fn the_gate_fires_on_a_corpus_word_used_as_a_compound_identifier_component() {
    assert_eq!(offenders_for("src/x.rs", "let sprint_id = 3;"), 1, "snake_case suffix");
    assert_eq!(offenders_for("src/x.ts", "const overdueCount = 3;"), 1, "camelCase suffix");
    assert_eq!(offenders_for("src/x.rs", "let velocity_per_week = 3;"), 1, "snake_case chain");
    // Criterion 3's wording ("a build containing `story_point` ... fails") covers the plural; A-02
    // bought whole-word matching to survive `Vec::with_capacity`, it did not license compounds.
    assert_eq!(offenders_for("src/x.rs", "let story_points_total = 3;"), 1, "plural compound");
    assert_eq!(offenders_for("src/x.ts", "const teamCapacity = 3;"), 1, "corpus word after a camelCase transition");
}

#[test]
fn the_gate_catches_a_corpus_word_used_as_a_column_in_a_migration_and_leaves_a_clean_one_alone() {
    let path = "packages/core/src/db/migrations/0099_planted.sql";
    assert_eq!(
        offenders_for(path, "CREATE TABLE t (\n    id TEXT,\n    sprint_length_days INTEGER\n);"),
        1,
        "a corpus word as a column name in a migration must fail"
    );
    assert_eq!(
        offenders_for(path, "CREATE TABLE t (\n    id TEXT,\n    goal TEXT NOT NULL,\n    created_at TEXT NOT NULL\n);"),
        0,
        "a migration naming no corpus word must stay open"
    );
}

#[test]
fn the_gate_is_silent_on_each_named_idiom_exclusion() {
    assert_eq!(offenders_for("src/x.rs", "let v = Vec::with_capacity(8);"), 0, "with_capacity idiom");
    assert_eq!(
        offenders_for("packages/core/src/proc.rs", "let timeout_at = deadline;"),
        0,
        "timeout deadline in proc.rs"
    );
    assert_eq!(
        offenders_for("packages/core/src/other.rs", "let timeout_at = deadline;"),
        1,
        "the same line elsewhere is an offender"
    );
    assert_eq!(
        offenders_for("src/x.rs", "let v = Vec::with_capacity(sprint_capacity);"),
        1,
        "the per-line exclusion does not shield a PM use sharing the line with the excluded literal"
    );
    assert_eq!(offenders_for("src/x.rs", "// sprint"), 0, "whole-line comment");
    assert_eq!(offenders_for("src/x.rs", "// the sprint is over"), 0, "whole-line comment");
}

// --- Criterion 1 of phase 14: the Cycle table carries no scheduling column ---
//
// This file is the one file excluded from its own scan, which is what lets a forbidden-name corpus
// be spelled here. The ten-word corpus above already holds two of the concepts criterion 1 names
// (capacity, velocity), and since SQL is scanned those already fail every migration. These
// fragments cover the two it does NOT hold: a calendar point and a span of work time.
// Matched against whole `_`-separated components of a column name, so `updated_at` is not read as
// containing `date`.

const CALENDAR_POINT_COMPONENTS: [&str; 10] =
    ["start", "starts", "end", "ends", "begin", "finish", "date", "day", "week", "month"];
const WORK_SPAN_COMPONENTS: [&str; 8] = ["duration", "length", "span", "days", "hours", "weeks", "interval", "period"];

/// The audit pair every table here carries. RECD-08's "undated" bars scheduling columns, not audit
/// metadata (owner confirmed 2026-10-15).
const AUDIT_COLUMNS: [&str; 2] = ["created_at", "updated_at"];

fn migrated_scratch_db() -> (rusqlite::Connection, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let conn = core::db::open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("open_and_migrate should succeed");
    (conn, dir)
}

fn cycle_columns(conn: &rusqlite::Connection) -> Vec<String> {
    conn.prepare("SELECT name FROM pragma_table_info('cycles')")
        .expect("pragma_table_info should prepare")
        .query_map([], |row| row.get(0))
        .expect("pragma_table_info should run")
        .collect::<Result<_, _>>()
        .expect("pragma_table_info rows should read")
}

fn scheduling_columns(columns: &[String]) -> Vec<String> {
    columns
        .iter()
        .filter(|name| !AUDIT_COLUMNS.contains(&name.as_str()))
        .filter(|name| {
            name.split('_').any(|part| {
                CALENDAR_POINT_COMPONENTS.contains(&part) || WORK_SPAN_COMPONENTS.contains(&part)
            })
        })
        .cloned()
        .collect()
}

#[test]
fn the_cycle_table_carries_no_scheduling_column() {
    let (conn, _dir) = migrated_scratch_db();
    let columns = cycle_columns(&conn);
    assert!(!columns.is_empty(), "the cycles table has no columns, so this check read nothing");
    assert_eq!(scheduling_columns(&columns), Vec::<String>::new(), "RECD-08: a Cycle is undated");
    for audit in AUDIT_COLUMNS {
        assert!(columns.iter().any(|c| c == audit), "the audit column `{audit}` must stay on cycles");
    }
}

#[test]
fn the_scheduling_column_check_fires_on_a_planted_column() {
    let (conn, _dir) = migrated_scratch_db();
    conn.execute_batch("ALTER TABLE cycles ADD COLUMN start_date TEXT; ALTER TABLE cycles ADD COLUMN duration_days INTEGER;")
        .expect("planting columns on a scratch database should succeed");
    let mut caught = scheduling_columns(&cycle_columns(&conn));
    caught.sort();
    assert_eq!(caught, vec!["duration_days".to_string(), "start_date".to_string()]);
}
