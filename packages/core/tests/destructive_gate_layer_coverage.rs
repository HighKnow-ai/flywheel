//! Phase 12, plan 12-02, Task 3: the layer-coverage totality invariant.
//!
//! `core::git_hooks::interception_layers_for` is a `match` with no wildcard arm over
//! `DestructiveCategory` — adding a category without naming a layer for it fails to compile, so
//! this file's job is to prove the TABLE's claims are honest, not that the match is exhaustive
//! (the compiler already guarantees that). Five properties: every category has at least one named
//! layer (totality); every layer name the table uses is a real heading in
//! `docs/destructive-gate-trust-boundary.md` (no claim with no spec behind it); the table is not
//! degenerate (at least one multi-layer category, at least one single-layer category); the
//! generated `pre-push` script's own text names exactly the category strings the table maps to the
//! pre-push layer, and none of the ones it maps to the shim layer alone (what keeps the table
//! honest about the script rather than aspirational); and (phase 12, plan 12-06 gap closure) every
//! function in `packages/core/src/domain/project.rs` that changes a project's `repo_path` also
//! installs the Layer 3 pre-push gate there, so a THIRD mutation path added later cannot silently
//! skip it the way `relocate_project` originally did.

use core::destructive::DestructiveCategory;
use core::git_hooks::{interception_layers_for, pre_push_hook_script};
use std::path::{Path, PathBuf};

const LAYER_2_SHIM: &str = "Layer 2 — the shim's runtime interception";
const LAYER_3_PRE_PUSH: &str = "Layer 3 — git's own pre-push hook";

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn trust_boundary_doc() -> String {
    let path = workspace_root().join("docs/destructive-gate-trust-boundary.md");
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()))
}

#[test]
fn every_destructive_category_has_at_least_one_named_layer() {
    for category in DestructiveCategory::all() {
        let layers = interception_layers_for(category);
        assert!(!layers.is_empty(), "DestructiveCategory::{category:?} has no interception layer named for it");
    }
}

#[test]
fn every_named_layer_is_a_real_section_heading_in_the_trust_boundary_doc() {
    let doc = trust_boundary_doc();

    let mut distinct_layers: Vec<&'static str> = DestructiveCategory::all()
        .into_iter()
        .flat_map(interception_layers_for)
        .copied()
        .collect();
    distinct_layers.sort();
    distinct_layers.dedup();

    assert!(!distinct_layers.is_empty(), "expected at least one layer name across all categories");

    for layer in distinct_layers {
        let heading = format!("## {layer}");
        assert!(
            doc.contains(&heading),
            "layer name {layer:?} (as heading {heading:?}) was not found verbatim in docs/destructive-gate-trust-boundary.md"
        );
    }
}

#[test]
fn the_table_is_not_degenerate_at_least_one_multi_layer_and_one_single_layer_category() {
    let categories = DestructiveCategory::all();

    let multi_layer = categories.iter().any(|&c| interception_layers_for(c).len() > 1);
    let single_layer = categories.iter().any(|&c| interception_layers_for(c).len() == 1);

    assert!(
        multi_layer,
        "expected at least one DestructiveCategory covered by more than one layer — a fully single-layer \
         table would make the totality assertion vacuous"
    );
    assert!(
        single_layer,
        "expected at least one DestructiveCategory covered by exactly one layer — a fully multi-layer \
         table would make the totality assertion vacuous"
    );
}

#[test]
fn the_rendered_pre_push_script_names_exactly_the_categories_the_table_maps_to_it() {
    let script = pre_push_hook_script(
        Path::new("/usr/bin/git"),
        Path::new("/tmp/flywheel-shim/git"),
        Path::new("/tmp/flywheel-worktrees"),
    );

    for category in DestructiveCategory::all() {
        let layers = interception_layers_for(category);
        let category_str = category.as_str();
        let claims_pre_push = layers.contains(&LAYER_3_PRE_PUSH);
        let shim_only = layers == [LAYER_2_SHIM];

        if claims_pre_push {
            assert!(
                script.contains(category_str),
                "the layer table maps {category:?} ({category_str:?}) to {LAYER_3_PRE_PUSH}, but the \
                 rendered pre-push script's text does not name {category_str:?} anywhere"
            );
        }

        if shim_only {
            assert!(
                !script.contains(category_str),
                "the layer table maps {category:?} ({category_str:?}) to {LAYER_2_SHIM} alone, but the \
                 rendered pre-push script's text names {category_str:?} — the script claims a category \
                 the table says it cannot decide"
            );
        }
    }
}

/// Phase 12, plan 12-06 gap closure: a source-level invariant that fails the instant a THIRD
/// function in `project.rs` changes a project's `repo_path` without installing Layer 3 the way
/// `register_project` and `relocate_project` both do via the shared `install_layer3_pre_push_gate`
/// helper. Reads the source as text rather than parsing it — comment lines are stripped first so a
/// doc comment merely naming an identifier can never satisfy or invalidate the scan, then the
/// remaining text is split into per-function chunks on a start-of-line `fn `/`pub fn ` prefix
/// (every top-level function in this file starts at column 0).
#[test]
fn every_repo_path_mutation_routes_through_the_layer3_install() {
    let path = workspace_root().join("packages/core/src/domain/project.rs");
    let source = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));

    // Strip every line whose trimmed form begins with `//` — doc comments included — so a comment
    // naming either identifier can never satisfy or invalidate the scan below.
    let stripped: String =
        source.lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");

    // Split the remaining text into per-function chunks on a start-of-line `fn `/`pub fn ` prefix.
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in stripped.lines() {
        if (line.starts_with("fn ") || line.starts_with("pub fn ")) && !current.is_empty() {
            chunks.push(std::mem::take(&mut current));
        }
        current.push_str(line);
        current.push('\n');
    }
    if !current.is_empty() {
        chunks.push(current);
    }

    let mut mutation_chunks_checked = 0;
    for chunk in &chunks {
        if !chunk.contains("set_repo_path(") {
            continue;
        }
        // Skip the chunk that DEFINES `set_repo_path` itself — every other chunk containing the
        // call is a mutation path that must also install Layer 3.
        if chunk.starts_with("fn set_repo_path(") || chunk.starts_with("pub fn set_repo_path(") {
            continue;
        }
        mutation_chunks_checked += 1;
        assert!(
            chunk.contains("install_layer3_pre_push_gate("),
            "a function in packages/core/src/domain/project.rs calls set_repo_path( but does not also \
             call install_layer3_pre_push_gate( — a new way to change a project's repo_path must install \
             the Layer 3 gate at the new path (phase 12, plan 12-06). Offending chunk starts: {:?}",
            chunk.lines().next()
        );
    }

    // Non-vacuity: today register_project and relocate_project both call set_repo_path(, so this
    // must find at least two — if the split or the comment-strip ever stops matching, this count
    // drops to zero and the test fails loudly instead of silently passing on nothing.
    assert!(
        mutation_chunks_checked >= 2,
        "expected at least two functions in project.rs (excluding set_repo_path's own definition) to \
         call set_repo_path( so this invariant cannot pass vacuously — found {mutation_chunks_checked}"
    );
}
