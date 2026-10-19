//! Branch/worktree naming derivation (D-24, LINK-01): the one place a Story's
//! `flywheel/`-namespaced git branch name is computed from its human-readable key and title.
//!
//! `flywheel/` is a one-way decision (02-CONTEXT.md): the moment a commit exists on a derived
//! branch, the name cannot be retroactively changed without breaking Phase 7's LINK-10 detection
//! and the identifier resolver, both of which key off this exact namespace.

/// The namespace every branch this crate derives is created under (D-24). Never renamed once a
/// commit exists on a derived branch.
pub const FLYWHEEL_BRANCH_NAMESPACE: &str = "flywheel/";

/// The hard byte cap on a derived branch name (LINK-01 boundary) — measured in bytes, not code
/// points or grapheme clusters, and never applied to the `flywheel/` prefix or the Story key,
/// only to the slug portion.
pub const BRANCH_NAME_MAX_BYTES: usize = 200;

/// Slugify `title` for use in a branch name (LINK-01 encoding): lowercase, drop every character
/// outside `[a-z0-9]`, collapse runs of dropped ASCII separator characters (whitespace and ASCII
/// punctuation/symbols) to a single hyphen, and trim leading and trailing hyphens. Defined over
/// Unicode code points — a non-ASCII character (e.g. an accented letter, an em dash) is dropped
/// silently, WITHOUT introducing a hyphen: only an ASCII separator marks a word boundary, so
/// "naïve" slugifies to "nave" (the dropped `ï` does not split the word), while "Café — naïve"
/// slugifies to "caf-nave" (the ASCII space around the em dash IS a word boundary). Never
/// transliterated. The result is either empty or matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
///
/// This is the ONE slug implementation in this crate — `story_branch_name` calls this, never a second copy.
pub fn slugify(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut pending_hyphen = false;
    for ch in title.chars() {
        let lowered = ch.to_ascii_lowercase();
        if lowered.is_ascii_lowercase() || lowered.is_ascii_digit() {
            if pending_hyphen && !out.is_empty() {
                out.push('-');
            }
            pending_hyphen = false;
            out.push(lowered);
        } else if lowered.is_ascii() {
            // An ASCII separator (whitespace, punctuation, symbol) marks a word boundary.
            pending_hyphen = true;
        }
        // A non-ASCII character (an accented letter, an em dash, emoji, ...) is dropped silently
        // — it never marks a word boundary on its own, leaving `pending_hyphen` exactly as it was.
    }
    out
}

/// Truncate `slug` so that `prefix_len + slug.len() <= BRANCH_NAME_MAX_BYTES` (all measured in
/// bytes), cutting only at a hyphen boundary so the result never ends mid-word and never ends in
/// a hyphen (LINK-01 boundary). `prefix_len` is the byte length of everything that will be
/// prepended to this slug (the namespace, the lowercased key, and the separating hyphen).
fn truncate_slug_to_fit(slug: &str, prefix_len: usize) -> String {
    if slug.is_empty() {
        return String::new();
    }
    let budget = BRANCH_NAME_MAX_BYTES.saturating_sub(prefix_len);
    if slug.len() <= budget {
        return slug.to_string();
    }
    if budget == 0 {
        return String::new();
    }
    // Cut at the byte budget, then trim back to the last hyphen boundary (or drop entirely if no
    // hyphen exists within budget) so the result never splits mid-word and never ends in '-'.
    let mut cut = budget;
    while !slug.is_char_boundary(cut) {
        cut -= 1;
    }
    let candidate = &slug[..cut];
    match candidate.rfind('-') {
        Some(idx) => candidate[..idx].to_string(),
        None => {
            // No hyphen within budget at all — trim trailing non-alphanumeric bytes is moot here
            // since slug is already [a-z0-9-]+; just take the whole candidate as-is, it already
            // fits the byte budget and (since slug never starts with '-') cannot start with one.
            candidate.trim_end_matches('-').to_string()
        }
    }
}

/// Derive a Story's branch name (D-24): `flywheel/{story_key_lowercased}` when the title slugifies
/// to empty, otherwise `flywheel/{story_key_lowercased}-{slug}`, capped at
/// [`BRANCH_NAME_MAX_BYTES`] bytes total and never ending in a hyphen. `story_key`'s numeric
/// suffix is carried verbatim as the exact text stored in `stories.key` — this function never
/// parses it to an integer.
pub fn story_branch_name(story_key: &str, title: &str) -> String {
    let key_lower = story_key.to_lowercase();
    let base = format!("{FLYWHEEL_BRANCH_NAMESPACE}{key_lower}");
    let slug = slugify(title);
    if slug.is_empty() {
        return base;
    }
    // prefix_len is `base` plus the separating hyphen.
    let truncated = truncate_slug_to_fit(&slug, base.len() + 1);
    if truncated.is_empty() {
        base
    } else {
        format!("{base}-{truncated}")
    }
}

