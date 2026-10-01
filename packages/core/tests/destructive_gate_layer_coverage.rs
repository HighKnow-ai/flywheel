//! Phase 12, plan 12-02, Task 3: the layer-coverage totality invariant.
//!
//! `core::git_hooks::interception_layers_for` is a `match` with no wildcard arm over
//! `DestructiveCategory` — adding a category without naming a layer for it fails to compile, so
//! this file's job is to prove the TABLE's claims are honest, not that the match is exhaustive
//! (the compiler already guarantees that). Four properties: every category has at least one named
//! layer (totality); every layer name the table uses is a real heading in
//! `docs/destructive-gate-trust-boundary.md` (no claim with no spec behind it); the table is not
//! degenerate (at least one multi-layer category, at least one single-layer category); and the
//! generated `pre-push` script's own text names exactly the category strings the table maps to the
//! pre-push layer, and none of the ones it maps to the shim layer alone (what keeps the table
//! honest about the script rather than aspirational).

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
