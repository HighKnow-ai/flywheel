//! DRFT-05 (D-14, T-13-13): the dropped `estimate` field must not come back.
//!
//! Migration 0023 drops the column from `tasks` and `epics`; this gate fails `cargo test -p core`
//! if the field reappears as an identifier in `packages/core/src`, `packages/desktop/src` (which
//! holds the desktop `__tests__` trees) or `packages/desktop/src-tauri/src`. Migrations are never
//! scanned: 0023's header legitimately names the column it drops, and 0002/0015 are history.
//!
//! Self-contained in the house style of `pm_vocabulary_gate.rs`: its own copies of
//! `workspace_root`/`is_whole_line_comment`/`sources_under`, no off switch. The planted-violation
//! test drives the SAME matcher, so the gate cannot go quiet without a test failing. This file is
//! outside every scanned root, so its own literals are never a finding.

use std::path::{Path, PathBuf};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

/// Whole-line comments only: Rust/TypeScript line comments and block-comment lines. The field may
/// still be named in prose that explains its removal.
fn is_whole_line_comment(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*')
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
                .is_some_and(|e| e == "rs" || e == "ts" || e == "tsx" || e == "css")
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

/// The field, as a whole word of an identifier: `estimate`, `set_estimate`, `estimateJson`,
/// `ESTIMATE_MARKS`, `.field-estimate`. Plural counts. `Estimated` and `estimator` are different
/// words and are not the field.
const FIELD_WORDS: [&str; 2] = ["estimate", "estimates"];

/// Split an identifier-ish token into lowercase words on `_` and on lower-to-upper camel breaks.
fn words_of(token: &str) -> Vec<String> {
    let mut words = Vec::new();
    for part in token.split('_').filter(|p| !p.is_empty()) {
        let mut current = String::new();
        let mut prev_lower_or_digit = false;
        for c in part.chars() {
            if c.is_uppercase() && prev_lower_or_digit && !current.is_empty() {
                words.push(std::mem::take(&mut current).to_lowercase());
            }
            prev_lower_or_digit = c.is_lowercase() || c.is_ascii_digit();
            current.push(c);
        }
        if !current.is_empty() {
            words.push(current.to_lowercase());
        }
    }
    words
}

/// One literal that legitimately carries the word for a DIFFERENT concept. Never a general
/// allowlist: each names one token (and optionally one path) and why.
#[allow(dead_code)] // `reason` is documentation: it is read by people, not by the matcher.
struct Exclusion {
    token: &'static str,
    path_part: Option<&'static str>,
    reason: &'static str,
}

/// An exclusion suppresses a hit only when the offending token IS `token` (case-insensitive) and
/// the file path contains `path_part` if one is set. A token whose words are `estimate` then
/// `size` is also exempt: that is the virtualizer's own option name (`estimateSize`), not ours.
const EXCLUSIONS: [Exclusion; 4] = [
    Exclusion {
        token: "MOUNTABLE_ROW_ESTIMATE",
        path_part: None,
        reason: "a test-fixture bound on how many virtualised rows can mount in a viewport, not a board field.",
    },
    Exclusion {
        token: "estimateTotalHeight",
        path_part: Some("board/__tests__/volume.ts"),
        reason: "the same fixture's scroll-height arithmetic, not a board field.",
    },
    Exclusion {
        token: "estimate",
        path_part: Some("desktop/src/fleet/"),
        reason: "the fleet surface's copy, and its tests, saying a spend figure is Flywheel's own price-table estimate, not billing data.",
    },
    Exclusion {
        token: "0023_drop_estimate",
        path_part: Some("core/src/db/mod.rs"),
        reason: "the one line that registers the migration which drops the field.",
    },
];

fn is_virtualizer_size_option(words: &[String]) -> bool {
    words.windows(2).any(|w| w[0] == "estimate" && w[1] == "size")
}

/// The matcher both the real gate and the planted-violation test drive. Pushes one offender per
/// offending line, formatted `{path}:{line}: {trimmed line}`.
fn scan_body_for_estimate(path: &Path, body: &str, offenders: &mut Vec<String>) {
    let path_str = path.to_string_lossy();
    for (n, line) in body.lines().enumerate() {
        if is_whole_line_comment(line) {
            continue;
        }
        let offending = line
            .split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .filter(|t| !t.is_empty())
            .any(|token| {
                let words = words_of(token);
                words.iter().any(|w| FIELD_WORDS.contains(&w.as_str()))
                    && !is_virtualizer_size_option(&words)
                    && !EXCLUSIONS.iter().any(|e| {
                        e.token.eq_ignore_ascii_case(token) && e.path_part.is_none_or(|s| path_str.contains(s))
                    })
            });
        if offending {
            offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
        }
    }
}

const SCAN_ROOTS: [&str; 3] = ["packages/core/src", "packages/desktop/src", "packages/desktop/src-tauri/src"];

#[test]
fn no_estimate_identifier_reaches_core_or_desktop_source() {
    let root = workspace_root();
    let mut offenders = Vec::new();
    for scan_root in SCAN_ROOTS {
        let files = sources_under(&root.join(scan_root));
        assert!(!files.is_empty(), "{scan_root} yielded no source files: the gate would be scanning nothing");
        for (path, body) in files {
            // Migrations are history; 0023's own header names the column it drops.
            if path.to_string_lossy().contains("src/db/migrations/") {
                continue;
            }
            scan_body_for_estimate(&path, &body, &mut offenders);
        }
    }
    assert!(
        offenders.is_empty(),
        "the dropped `estimate` field reappeared (DRFT-05, D-14); remove it or name the new consumer:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn the_estimate_gate_fires_on_a_planted_violation() {
    let scan = |path: &str, body: &str| {
        let mut offenders = Vec::new();
        scan_body_for_estimate(Path::new(path), body, &mut offenders);
        offenders
    };

    // Exactly one offender for one planted line, in each shape the field took.
    assert_eq!(scan("x.rs", "fn set_estimate(conn: &mut Connection) {}\n").len(), 1);
    assert_eq!(scan("x.ts", "const item = { estimate: 2 };\n").len(), 1);
    assert_eq!(scan("x.tsx", "<EstimatePicker />\n").len(), 1);
    assert_eq!(scan("x.css", ".field-estimate { display: none; }\n").len(), 1);

    // Clean bodies stay clean: a comment explaining the removal, the virtualizer option, and
    // the different words `Estimated` / `estimator`.
    assert!(scan("x.rs", "// estimate was dropped in 0023\n").is_empty());
    assert!(scan("x.ts", " * the estimate column is gone\n").is_empty());
    assert!(scan("x.tsx", "useVirtualizer({ estimateSize: () => 28 });\n").is_empty());
    assert!(scan("x.ts", "export function feedRowEstimateSize() {}\n").is_empty());
    assert!(scan("x.tsx", "<span title=\"Estimated cost\" />\n").is_empty());

    // An exclusion shields only its own token and path: the same token elsewhere still fires.
    assert!(scan("desktop/src/fleet/FleetSurface.tsx", "(Flywheel's own estimate from a table)\n").is_empty());
    assert!(scan("core/src/db/mod.rs", "include_str!(\"migrations/0023_drop_estimate.sql\"),\n").is_empty());
    assert_eq!(scan("core/src/other.rs", "include_str!(\"migrations/0023_drop_estimate.sql\"),\n").len(), 1);
    assert_eq!(scan("desktop/src/board/BoardRow.tsx", "(Flywheel's own estimate from a table)\n").len(), 1);
    assert!(scan("x.ts", "expect(rows).toBeLessThan(MOUNTABLE_ROW_ESTIMATE);\n").is_empty());
}
