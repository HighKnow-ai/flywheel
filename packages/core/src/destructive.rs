//! D-56's single compiled classifier: the ONE implementation of the destructive-command list in
//! this workspace. `packages/shim/src/main.rs` (Task 2, plan 03-07) calls this module directly
//! for every `git`/`rm` invocation it intercepts; `packages/sidecar/src/pretooluse-hook.ts`
//! (Task 3) reaches it by shelling out to the shim binary's own `--classify-command` mode rather
//! than re-implementing the list — so the two interception points can never disagree about what
//! counts as destructive.
//!
//! **The fail-closed rule is the load-bearing part of this module (T-03-07-01).** Every `match`
//! that decides a verdict for a subcommand with a destructive form ends in a default arm
//! returning [`Verdict::Destructive`]`(`[`DestructiveCategory::Uncategorized`]`)`, never
//! [`Verdict::Safe`]. `Safe` is returned ONLY from an explicit, named, recognised-harmless
//! invocation shape — this is the opposite of what a reader expects from a "matcher" (which
//! usually defaults to "no match, so it's fine"): here, no match means "gate it." Adding a new
//! git subcommand to this file without also classifying it therefore produces `Uncategorized` (a
//! gate the user sees), never a silent `Safe`.
//!
//! This module is only ever asked about `git` and `rm` invocations — those are the only two
//! program names the shim (D-51) shadows on `PATH`, and the only two names the hook's raw-command
//! text parser (Task 3) resolves a program stem for before calling in here. Every OTHER program
//! name is outside D-56's list by construction and returns `Safe` from [`classify`]'s own
//! top-level dispatch — this is a DIFFERENT thing from the fail-closed default described above:
//! it is not "we didn't recognise this git subcommand," it is "this command is not one this
//! module has any opinion about at all." Widening the set of programs this module inspects is a
//! deliberate, separate decision for a future phase (see 03-CONTEXT.md's own "Claude's
//! Discretion" note on whether the shim intercepts more than `git`).
//!
//! Never reads a list from configuration, an environment variable or a file (D-56): the only
//! external input `classify` accepts is the project's own `default_branch`, resolved server-side
//! from the `projects` row, never from the agent or from a file this classifier could itself
//! read.

/// D-56's fixed, wider-than-AGNT-07 destructive category list, plus the fail-closed
/// [`DestructiveCategory::Uncategorized`] verdict for a destructive-shaped invocation this
/// classifier cannot confidently resolve to one of the seven named categories.
///
/// [`as_str`](DestructiveCategory::as_str) returns the kebab-case names the UI-SPEC's
/// consequence-copy table and `permission_requests.destructive_category`'s accepted vocabulary
/// both key off — this is the ONE place those strings are minted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestructiveCategory {
    ForcePush,
    BranchDeletion,
    DefaultBranchPush,
    HardReset,
    ForceClean,
    HistoryRewrite,
    RecursiveDelete,
    Uncategorized,
}

impl DestructiveCategory {
    /// The kebab-case name this category is persisted and rendered under. The UI-SPEC's
    /// consequence-copy table (`03-UI-SPEC.md` § "Destructive-action gate card") keys off these
    /// exact strings, and `create_pending_request` validates an inbound
    /// `destructive_category` argument against this exact set.
    pub fn as_str(self) -> &'static str {
        match self {
            DestructiveCategory::ForcePush => "force-push",
            DestructiveCategory::BranchDeletion => "branch-deletion",
            DestructiveCategory::DefaultBranchPush => "default-branch-push",
            DestructiveCategory::HardReset => "hard-reset",
            DestructiveCategory::ForceClean => "force-clean",
            DestructiveCategory::HistoryRewrite => "history-rewrite",
            DestructiveCategory::RecursiveDelete => "recursive-delete",
            DestructiveCategory::Uncategorized => "uncategorized",
        }
    }

    /// Every accepted value, in the same order `as_str` enumerates them — the vocabulary
    /// `create_pending_request` validates an inbound `destructive_category` string against.
    pub fn all() -> [DestructiveCategory; 8] {
        [
            DestructiveCategory::ForcePush,
            DestructiveCategory::BranchDeletion,
            DestructiveCategory::DefaultBranchPush,
            DestructiveCategory::HardReset,
            DestructiveCategory::ForceClean,
            DestructiveCategory::HistoryRewrite,
            DestructiveCategory::RecursiveDelete,
            DestructiveCategory::Uncategorized,
        ]
    }

    /// Parse a persisted/wire kebab-case category name back into its variant — the inverse of
    /// [`as_str`](DestructiveCategory::as_str), used by `create_pending_request`'s own validation
    /// and by any caller (the shim, the hook) that receives a category name as text.
    pub fn from_str_name(name: &str) -> Option<DestructiveCategory> {
        DestructiveCategory::all().into_iter().find(|c| c.as_str() == name)
    }
}

/// The result of classifying one invocation: either it is ordinary and executes without a
/// permission round trip ([`Verdict::Safe`]), or it is destructive and must raise a permission
/// request naming its [`DestructiveCategory`] before anything runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Safe,
    Destructive(DestructiveCategory),
}

/// Expand any single-dash, multi-character token into its constituent short-flag letters before
/// matching (T-03-07-04): `-rf` becomes `-r`, `-f`; `-fdx` becomes `-f`, `-d`, `-x`. A joined-
/// string match over the raw command text is trivially defeated by argument order and by
/// clustering — this classifier parses the REAL argv vector positionally instead, so clustering
/// and ordering cannot hide a flag from it.
///
/// A token starting with exactly one dash (never `--`), longer than two characters, and made
/// entirely of ASCII alphabetic characters after the dash is treated as a cluster and exploded.
/// Anything else (a long `--flag`, an already-atomic `-f`, a bare positional argument, an
/// argument carrying digits or punctuation after its leading dash) passes through unchanged.
fn expand_short_clusters(args: &[String]) -> Vec<String> {
    let mut expanded = Vec::with_capacity(args.len());
    for arg in args {
        let is_cluster = arg.len() > 2
            && arg.starts_with('-')
            && !arg.starts_with("--")
            && arg[1..].chars().all(|c| c.is_ascii_alphabetic());
        if is_cluster {
            for c in arg[1..].chars() {
                expanded.push(format!("-{c}"));
            }
        } else {
            expanded.push(arg.clone());
        }
    }
    expanded
}

/// Classify one invocation of `program` with argument vector `args`. `default_branch` is the
/// project's own default branch (resolved server-side, never supplied by the agent) — the only
/// external input this function accepts beyond the argv itself.
///
/// Dispatches on `program`'s own name (the shim passes its own argv[0] file stem; the hook's
/// classify-command mode resolves a program stem out of raw command text the same way). Only
/// `git` and `rm` carry any destructive form in this workspace's threat model — every other
/// program name is `Safe` by construction (see this module's own top doc comment).
pub fn classify(program: &str, args: &[String], default_branch: Option<&str>) -> Verdict {
    match program {
        "git" => classify_git(args, default_branch),
        "rm" => classify_rm(args),
        _ => Verdict::Safe,
    }
}

/// Git subcommands with no destructive form recognised by this classifier — an explicit
/// allow-list, never a catch-all, per this module's own fail-closed rule. A subcommand NOT in
/// this list, and not one of `push`/`branch`/`reset`/`clean`/`rebase`/`filter-branch`'s own
/// dedicated handling below, falls to the final `Uncategorized` arm.
const SAFE_GIT_SUBCOMMANDS: &[&str] = &[
    "status", "log", "diff", "add", "commit", "show", "fetch", "pull", "merge", "checkout",
    "switch", "tag", "remote", "config", "stash", "mv", "restore", "cherry-pick", "revert",
    "blame", "describe", "grep", "init", "clone", "reflog", "shortlog", "ls-files", "apply",
    "am", "bisect", "submodule", "gc", "version", "--version", "help", "--help", "-h",
];

fn classify_git(args: &[String], default_branch: Option<&str>) -> Verdict {
    let expanded = expand_short_clusters(args);
    let Some(subcommand) = expanded.first() else {
        // A bare `git` with no subcommand at all — nothing to classify, and nothing this
        // classifier confidently understands as harmless either.
        return Verdict::Destructive(DestructiveCategory::Uncategorized);
    };
    let rest = &expanded[1..];

    match subcommand.as_str() {
        "push" => classify_push(rest, default_branch),
        "branch" => classify_branch(rest),
        "reset" => classify_reset(rest),
        "clean" => classify_clean(rest),
        "rebase" => classify_rebase(rest),
        "filter-branch" => Verdict::Destructive(DestructiveCategory::HistoryRewrite),
        other if SAFE_GIT_SUBCOMMANDS.contains(&other) => Verdict::Safe,
        _ => Verdict::Destructive(DestructiveCategory::Uncategorized),
    }
}

/// A push refspec's destination names `branch` — either the bare form (`main`), the
/// `refs/heads/`-qualified form, or the destination half of a `src:dst` refspec
/// (`HEAD:main`, `feature:main`).
fn refspec_targets_branch(refspec: &str, branch: &str) -> bool {
    let dst = refspec.rsplit(':').next().unwrap_or(refspec);
    let dst = dst.strip_prefix("refs/heads/").unwrap_or(dst);
    dst == branch
}

/// `classify_push` recognises three remote-branch-deletion spellings, alongside its existing
/// force and default-branch detection: the long flag (`--delete`), the short flag (`-d`), and the
/// empty-source colon refspec (`:feature`, `:refs/heads/feature`, or a bare `:`) — git's own third
/// way of saying "delete this ref on the remote." All three destroy the same thing
/// `classify_branch` already gates for a LOCAL branch (`-d`/`-D`/`--delete`), and a push-shaped
/// deletion destroys strictly MORE (the published ref, not just the local one), so leaving it
/// unrecognised here was this module's most severe violation of its own fail-closed rule
/// (T-03-14-01).
///
/// The delete check is the FIRST of this function's three early returns — ahead of
/// `targets_default` and ahead of `force`. Deleting the default branch IS a branch deletion, and
/// the consequence sentence the user reads is chosen by category, so the accurate sentence
/// (`BranchDeletion`) must win over the less-accurate one (`DefaultBranchPush`): `git push origin
/// :main` becomes `BranchDeletion`, not `DefaultBranchPush`. Both gate; this is the more honest of
/// the two.
fn classify_push(rest: &[String], default_branch: Option<&str>) -> Verdict {
    let mut force = false;
    let mut delete = false;
    let mut positional: Vec<&str> = Vec::new();
    let mut iter = rest.iter();
    while let Some(arg) = iter.next() {
        if arg == "--" {
            positional.extend(iter.map(String::as_str));
            break;
        }
        if let Some(flag) = arg.strip_prefix("--") {
            let flag_name = flag.split('=').next().unwrap_or(flag);
            if flag_name == "force" || flag_name == "force-with-lease" {
                force = true;
            }
            if flag_name == "delete" {
                delete = true;
            }
        } else if arg.starts_with('-') && arg.len() > 1 {
            // Already exploded into single-letter short flags by `expand_short_clusters`
            // (called once, in `classify_git`, over the whole argv before dispatch) — `-f` and
            // `-d` are the only push short flags this classifier cares about.
            if arg == "-f" {
                force = true;
            }
            if arg == "-d" {
                delete = true;
            }
        } else {
            positional.push(arg.as_str());
        }
    }

    // The empty-source colon refspec (`:feature`, `:refs/heads/feature`, or a bare `:`) is git's
    // third spelling of a remote branch deletion — a `src:dst` refspec with a real source
    // (`HEAD:main`, `feature:main`) never begins with a colon, so this cannot collide with the
    // shapes `refspec_targets_branch` already handles above. A bare colon positional also
    // matches, which is correct: a destructive-shaped nonsense argument fails closed here too.
    let colon_delete_refspec = positional.iter().any(|p| p.starts_with(':'));
    if delete || colon_delete_refspec {
        return Verdict::Destructive(DestructiveCategory::BranchDeletion);
    }

    let targets_default = default_branch
        .map(|branch| positional.iter().any(|p| refspec_targets_branch(p, branch)))
        .unwrap_or(false);

    if targets_default {
        return Verdict::Destructive(DestructiveCategory::DefaultBranchPush);
    }
    // A leading `+` on a refspec (`+feature`, `+feature:feature`) is git's own per-refspec force
    // syntax — a force push wearing different clothes, not a typo guard (T-03-14-02). This check
    // stays AFTER the delete and default-branch checks, exactly where Task 1 left the force
    // early-return: a plus-prefixed refspec naming the default branch with an explicit
    // destination (`+main:main`) already resolves via `targets_default` above, and the delete
    // family still wins over an irrelevant leading `+` on a deleted source (`--delete +feature`).
    let plus_refspec = positional.iter().any(|p| p.starts_with('+'));
    if force || plus_refspec {
        return Verdict::Destructive(DestructiveCategory::ForcePush);
    }
    Verdict::Safe
}

fn classify_branch(rest: &[String]) -> Verdict {
    let has_delete = rest.iter().any(|arg| {
        arg == "--delete" || arg == "-d" || arg == "-D"
    });
    if has_delete {
        Verdict::Destructive(DestructiveCategory::BranchDeletion)
    } else {
        Verdict::Safe
    }
}

fn classify_reset(rest: &[String]) -> Verdict {
    if rest.iter().any(|arg| arg == "--hard") {
        Verdict::Destructive(DestructiveCategory::HardReset)
    } else {
        Verdict::Safe
    }
}

fn classify_clean(rest: &[String]) -> Verdict {
    let mut force = false;
    let mut dirs = false;
    let mut ignored = false;
    for arg in rest {
        match arg.as_str() {
            "-f" | "--force" => force = true,
            "-d" => dirs = true,
            "-x" | "-X" => ignored = true,
            _ => {}
        }
    }
    if force && dirs && ignored {
        Verdict::Destructive(DestructiveCategory::ForceClean)
    } else if force || dirs || ignored {
        // Some but not all of D-56's named `-fdx` combination — this subcommand HAS a
        // destructive form and this invocation is not confidently the fully-safe no-op
        // (`git clean` with none of these flags just prints a dry-run report), so it fails
        // closed rather than being waved through as `Safe`.
        Verdict::Destructive(DestructiveCategory::Uncategorized)
    } else {
        Verdict::Safe
    }
}

fn classify_rebase(rest: &[String]) -> Verdict {
    // The first positional (non-flag) argument after `rebase` is conventionally <upstream>.
    // A remote-tracking-shaped upstream (`origin/main`, or an explicit `refs/remotes/...` ref)
    // is a rebase onto a published ref — a history rewrite of shared history (D-56). A rebase
    // with no such argument (interactive on the current branch, or a bare `--continue`/
    // `--abort`/`--skip` follow-up on an already-started rebase) is ordinary.
    let upstream = rest.iter().find(|arg| !arg.starts_with('-'));
    match upstream {
        Some(upstream) if upstream.contains('/') || upstream.starts_with("refs/remotes/") => {
            Verdict::Destructive(DestructiveCategory::HistoryRewrite)
        }
        _ => Verdict::Safe,
    }
}

fn classify_rm(args: &[String]) -> Verdict {
    let expanded = expand_short_clusters(args);
    let recursive = expanded
        .iter()
        .any(|arg| arg == "-r" || arg == "-R" || arg == "--recursive");
    if recursive {
        Verdict::Destructive(DestructiveCategory::RecursiveDelete)
    } else {
        Verdict::Safe
    }
}
