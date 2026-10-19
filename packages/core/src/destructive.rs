//! The Gated-action deny-list (`docs/mvp-spec.md` §4.1, ADR 0001): the ONE implementation of
//! which commands ask the developer every time. `packages/shim/src/main.rs` calls [`classify_in`]
//! for every invocation of a program it shadows on `PATH` (`git`, `rm`, `npm`, `cargo`, `gh`).
//!
//! **This is a deny-list.** A Story agent may do anything inside its own worktree without asking;
//! only the Gated actions below return [`Verdict::Destructive`], and everything else — an unknown
//! git subcommand, a read-only call, Claude Code's own startup checks — is [`Verdict::Safe`]. The
//! gate catches a cooperative agent's accidents, not a hostile agent; review and merge are the
//! real safety boundary. The list:
//!
//! - every `git push`;
//! - deleting a branch or worktree other than the Story's own;
//! - `reset --hard` and `clean -f`;
//! - rebase or `filter-branch` off the Story's own branch;
//! - recursive `rm` outside the worktree;
//! - publishing: `npm publish`, `cargo publish`, `gh pr merge`, `gh release`.
//!
//! git's global options (`-C <dir>`, `-c k=v`, `--git-dir`, …) are skipped before the subcommand
//! is matched, so `git -C x -c a=b push` is still a push.
//!
//! The "Story's own" branch and worktree come from [`GateContext`], which the shim builds from the
//! session environment Flywheel sets at spawn ([`STORY_BRANCH_ENV`], [`WORKTREE_ENV`]). When a fact
//! the decision needs is missing, the action is gated: asking once too often is the cheap mistake.

use std::path::{Component, Path, PathBuf};

/// The environment variable naming the Story's own branch, set on every Story session.
pub const STORY_BRANCH_ENV: &str = "FLYWHEEL_STORY_BRANCH";
/// The environment variable naming the Story's own worktree path, set on every Story session.
pub const WORKTREE_ENV: &str = "FLYWHEEL_WORKTREE_PATH";
/// The environment variable naming the project's default branch.
pub const DEFAULT_BRANCH_ENV: &str = "FLYWHEEL_DEFAULT_BRANCH";

/// Which Gated action an invocation is. [`as_str`](DestructiveCategory::as_str) mints the
/// kebab-case names `permission_requests.destructive_category` stores and the request card keys
/// its consequence sentence off.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestructiveCategory {
    /// A `git push` that is none of the more specific push shapes below. Named `git-push`, not
    /// `push`, so the name is distinct from every other word in the pre-push hook's text.
    Push,
    ForcePush,
    DefaultBranchPush,
    BranchDeletion,
    WorktreeDeletion,
    HardReset,
    ForceClean,
    HistoryRewrite,
    RecursiveDelete,
    Publish,
}

impl DestructiveCategory {
    /// The kebab-case name this category is persisted and rendered under.
    pub fn as_str(self) -> &'static str {
        match self {
            DestructiveCategory::Push => "git-push",
            DestructiveCategory::ForcePush => "force-push",
            DestructiveCategory::DefaultBranchPush => "default-branch-push",
            DestructiveCategory::BranchDeletion => "branch-deletion",
            DestructiveCategory::WorktreeDeletion => "worktree-deletion",
            DestructiveCategory::HardReset => "hard-reset",
            DestructiveCategory::ForceClean => "force-clean",
            DestructiveCategory::HistoryRewrite => "history-rewrite",
            DestructiveCategory::RecursiveDelete => "recursive-delete",
            DestructiveCategory::Publish => "publish",
        }
    }

    /// Every category, in the order [`as_str`](DestructiveCategory::as_str) lists them — the
    /// vocabulary `create_pending_request` validates an inbound category against.
    pub fn all() -> [DestructiveCategory; 10] {
        [
            DestructiveCategory::Push,
            DestructiveCategory::ForcePush,
            DestructiveCategory::DefaultBranchPush,
            DestructiveCategory::BranchDeletion,
            DestructiveCategory::WorktreeDeletion,
            DestructiveCategory::HardReset,
            DestructiveCategory::ForceClean,
            DestructiveCategory::HistoryRewrite,
            DestructiveCategory::RecursiveDelete,
            DestructiveCategory::Publish,
        ]
    }

    /// Parse a persisted kebab-case name back into its category.
    pub fn from_str_name(name: &str) -> Option<DestructiveCategory> {
        DestructiveCategory::all().into_iter().find(|c| c.as_str() == name)
    }
}

/// The result of classifying one invocation: it runs without asking ([`Verdict::Safe`]), or it is
/// a Gated action and asks the developer before anything runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Safe,
    Destructive(DestructiveCategory),
}

/// Looks up the branch checked out in a directory (the effective directory after `-C`). The shim
/// supplies one that asks the real git; a test supplies a constant.
pub type HeadBranchLookup = Box<dyn Fn(&Path) -> Option<String>>;

/// What the classifier knows about the session issuing the command. Every field is optional; a
/// decision that needs a missing field gates.
#[derive(Default)]
pub struct GateContext {
    /// The project's default branch, used only to name a push to it more precisely.
    pub default_branch: Option<String>,
    /// The Story's own branch: deleting it, or rewriting it, is allowed.
    pub story_branch: Option<String>,
    /// The Story's own worktree: recursive `rm` strictly inside it is allowed, and removing it
    /// with `git worktree remove` is allowed.
    pub worktree: Option<PathBuf>,
    /// The directory the command runs in, against which relative paths resolve.
    pub cwd: Option<PathBuf>,
    /// The branch checked out in a directory, asked only for `rebase` and `filter-branch`.
    pub head_branch: Option<HeadBranchLookup>,
}

/// Classify one invocation with no Story context beyond the default branch: every decision that
/// depends on the Story's own branch or worktree gates.
pub fn classify(program: &str, args: &[String], default_branch: Option<&str>) -> Verdict {
    let ctx = GateContext { default_branch: default_branch.map(str::to_string), ..GateContext::default() };
    classify_in(program, args, &ctx)
}

/// Classify one invocation of `program` (a file stem: `git`, `rm`, `npm`, `cargo`, `gh`) with
/// argument vector `args`, in the session described by `ctx`.
pub fn classify_in(program: &str, args: &[String], ctx: &GateContext) -> Verdict {
    match program {
        "git" => classify_git(args, ctx),
        "rm" => classify_rm(args, ctx),
        "npm" => classify_npm(args),
        "cargo" => classify_cargo(args),
        "gh" => classify_gh(args),
        _ => Verdict::Safe,
    }
}

/// Expand a single-dash cluster of short flags (`-rf` → `-r`, `-f`). Long flags, single flags and
/// anything carrying a non-letter pass through unchanged.
fn expand_short_clusters(args: &[String]) -> Vec<String> {
    let mut expanded = Vec::with_capacity(args.len());
    for arg in args {
        let is_cluster = arg.len() > 2
            && arg.starts_with('-')
            && !arg.starts_with("--")
            && arg[1..].chars().all(|c| c.is_ascii_alphabetic());
        if is_cluster {
            expanded.extend(arg[1..].chars().map(|c| format!("-{c}")));
        } else {
            expanded.push(arg.clone());
        }
    }
    expanded
}

fn gated(category: DestructiveCategory) -> Verdict {
    Verdict::Destructive(category)
}

/// `refs/heads/x` and `x` name the same branch.
fn branch_name(name: &str) -> &str {
    name.strip_prefix("refs/heads/").unwrap_or(name)
}

fn is_story_branch(name: &str, ctx: &GateContext) -> bool {
    ctx.story_branch.as_deref().is_some_and(|story| branch_name(name) == story)
}

// --- git ---

/// git's global options that take their value as the next token.
const GIT_GLOBAL_VALUE_OPTIONS: &[&str] =
    &["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix"];

/// Skip git's global options. Returns the index of the subcommand (if any) and the effective
/// directory after every `-C`.
fn skip_git_global_options(args: &[String], cwd: Option<&Path>) -> (Option<usize>, Option<PathBuf>) {
    let mut dir = cwd.map(Path::to_path_buf);
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if !arg.starts_with('-') {
            return (Some(i), dir);
        }
        if GIT_GLOBAL_VALUE_OPTIONS.contains(&arg) {
            if arg == "-C" {
                if let Some(value) = args.get(i + 1) {
                    dir = Some(match dir {
                        Some(base) => base.join(value),
                        None => PathBuf::from(value),
                    });
                }
            }
            i += 2;
        } else {
            i += 1;
        }
    }
    (None, dir)
}

fn classify_git(args: &[String], ctx: &GateContext) -> Verdict {
    let (Some(sub_idx), dir) = skip_git_global_options(args, ctx.cwd.as_deref()) else {
        return Verdict::Safe;
    };
    let rest = expand_short_clusters(&args[sub_idx + 1..]);
    match args[sub_idx].as_str() {
        "push" => classify_push(&rest, ctx),
        "branch" => classify_branch(&rest, ctx),
        "worktree" => classify_worktree(&rest, ctx, dir.as_deref()),
        "reset" => classify_reset(&rest),
        "clean" => classify_clean(&rest),
        "rebase" => classify_rebase(&rest, ctx, dir.as_deref()),
        "filter-branch" => classify_filter_branch(&rest, ctx, dir.as_deref()),
        _ => Verdict::Safe,
    }
}

/// A push refspec's destination names `branch`: `main`, `refs/heads/main`, or the destination
/// half of `src:dst`.
fn refspec_targets_branch(refspec: &str, branch: &str) -> bool {
    let dst = refspec.rsplit(':').next().unwrap_or(refspec);
    branch_name(dst.trim_start_matches('+')) == branch
}

/// Every push is gated. The category only picks the most accurate consequence sentence: a
/// deletion wins over a default-branch push, which wins over a force push, which wins over a plain
/// push.
fn classify_push(rest: &[String], ctx: &GateContext) -> Verdict {
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
            match flag.split('=').next().unwrap_or(flag) {
                "force" | "force-with-lease" | "force-if-includes" => force = true,
                "delete" => delete = true,
                _ => {}
            }
        } else if arg.starts_with('-') && arg.len() > 1 {
            match arg.as_str() {
                "-f" => force = true,
                "-d" => delete = true,
                _ => {}
            }
        } else {
            positional.push(arg.as_str());
        }
    }

    // The empty-source refspec (`:feature`) is git's third spelling of a remote branch deletion.
    if delete || positional.iter().any(|p| p.starts_with(':')) {
        return gated(DestructiveCategory::BranchDeletion);
    }
    let targets_default = ctx
        .default_branch
        .as_deref()
        .is_some_and(|branch| positional.iter().skip(1).any(|p| refspec_targets_branch(p, branch)));
    if targets_default {
        return gated(DestructiveCategory::DefaultBranchPush);
    }
    // A leading `+` on a refspec is git's per-refspec force.
    if force || positional.iter().skip(1).any(|p| p.starts_with('+')) {
        return gated(DestructiveCategory::ForcePush);
    }
    gated(DestructiveCategory::Push)
}

/// `git branch -d/-D/--delete <names>` is gated unless every named branch is the Story's own.
fn classify_branch(rest: &[String], ctx: &GateContext) -> Verdict {
    let deletes = rest.iter().any(|arg| arg == "-d" || arg == "-D" || arg == "--delete");
    if !deletes {
        return Verdict::Safe;
    }
    let names: Vec<&str> = rest.iter().map(String::as_str).filter(|arg| !arg.starts_with('-')).collect();
    if !names.is_empty() && names.iter().all(|name| is_story_branch(name, ctx)) {
        Verdict::Safe
    } else {
        gated(DestructiveCategory::BranchDeletion)
    }
}

/// `git worktree remove <path>` is gated unless the path is the Story's own worktree.
fn classify_worktree(rest: &[String], ctx: &GateContext, dir: Option<&Path>) -> Verdict {
    if rest.first().map(String::as_str) != Some("remove") {
        return Verdict::Safe;
    }
    let target = rest[1..].iter().find(|arg| !arg.starts_with('-'));
    let own = match (target, ctx.worktree.as_deref()) {
        (Some(target), Some(worktree)) => {
            resolve_path(dir, target).is_some_and(|path| path == resolve_existing(worktree))
        }
        _ => false,
    };
    if own {
        Verdict::Safe
    } else {
        gated(DestructiveCategory::WorktreeDeletion)
    }
}

fn classify_reset(rest: &[String]) -> Verdict {
    if rest.iter().any(|arg| arg == "--hard") {
        gated(DestructiveCategory::HardReset)
    } else {
        Verdict::Safe
    }
}

/// `git clean` deletes nothing without `-f` (git's own `clean.requireForce`).
fn classify_clean(rest: &[String]) -> Verdict {
    if rest.iter().any(|arg| arg == "-f" || arg == "--force") {
        gated(DestructiveCategory::ForceClean)
    } else {
        Verdict::Safe
    }
}

/// Is the branch a rewrite targets the Story's own? `named` is the branch the command names
/// explicitly; with none, the rewrite targets the branch checked out in `dir`.
fn rewrites_story_branch(named: Option<&str>, ctx: &GateContext, dir: Option<&Path>) -> bool {
    match named {
        Some(name) => is_story_branch(name, ctx),
        None => {
            let head = match (ctx.head_branch.as_ref(), dir) {
                (Some(lookup), Some(dir)) => lookup(dir),
                _ => None,
            };
            head.is_some_and(|head| is_story_branch(&head, ctx))
        }
    }
}

/// `git rebase` options that take their value as the next token.
const REBASE_VALUE_OPTIONS: &[&str] = &["--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"];

/// Rebasing the Story's own branch onto anything is allowed; rebasing any other branch is gated.
/// `git rebase [<upstream> [<branch>]]` rewrites `<branch>` when named, else the checked-out one.
fn classify_rebase(rest: &[String], ctx: &GateContext, dir: Option<&Path>) -> Verdict {
    const FOLLOW_UPS: &[&str] = &["--continue", "--abort", "--skip", "--quit", "--edit-todo", "--show-current-patch"];
    if rest.iter().any(|arg| FOLLOW_UPS.contains(&arg.as_str())) {
        return Verdict::Safe;
    }
    let mut root = false;
    let mut positional: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < rest.len() {
        let arg = rest[i].as_str();
        if REBASE_VALUE_OPTIONS.contains(&arg) {
            i += 2;
            continue;
        }
        if arg == "--root" {
            root = true;
        } else if !arg.starts_with('-') {
            positional.push(arg);
        }
        i += 1;
    }
    // With `--root` there is no `<upstream>`, so the first positional is already `<branch>`.
    let named = if root { positional.first() } else { positional.get(1) };
    if rewrites_story_branch(named.copied(), ctx, dir) {
        Verdict::Safe
    } else {
        gated(DestructiveCategory::HistoryRewrite)
    }
}

/// `git filter-branch` options that take their value as the next token.
const FILTER_BRANCH_VALUE_OPTIONS: &[&str] = &[
    "--setup",
    "--subdirectory-filter",
    "--env-filter",
    "--tree-filter",
    "--index-filter",
    "--parent-filter",
    "--msg-filter",
    "--commit-filter",
    "--tag-name-filter",
    "--original",
    "-d",
    "--state-branch",
];

/// `filter-branch` is allowed only when the one ref it rewrites is the Story's own branch.
fn classify_filter_branch(rest: &[String], ctx: &GateContext, dir: Option<&Path>) -> Verdict {
    let mut revs: Vec<&str> = Vec::new();
    let mut i = 0;
    while i < rest.len() {
        let arg = rest[i].as_str();
        if arg == "--" {
            revs.extend(rest[i + 1..].iter().map(String::as_str));
            break;
        }
        if FILTER_BRANCH_VALUE_OPTIONS.contains(&arg) {
            i += 2;
            continue;
        }
        if !arg.starts_with('-') {
            revs.push(arg);
        }
        i += 1;
    }
    let own = match revs.as_slice() {
        [] => rewrites_story_branch(None, ctx, dir),
        [only] => !only.starts_with('-') && rewrites_story_branch(Some(only), ctx, dir),
        _ => false,
    };
    if own {
        Verdict::Safe
    } else {
        gated(DestructiveCategory::HistoryRewrite)
    }
}

// --- rm ---

/// Recursive `rm` is gated unless every target resolves strictly inside the Story's worktree. The
/// worktree root itself is outside: deleting it is deleting the worktree.
fn classify_rm(args: &[String], ctx: &GateContext) -> Verdict {
    let mut recursive = false;
    let mut targets: Vec<&str> = Vec::new();
    let expanded = expand_short_clusters(args);
    let mut iter = expanded.iter();
    while let Some(arg) = iter.next() {
        if arg == "--" {
            targets.extend(iter.map(String::as_str));
            break;
        }
        if arg.starts_with('-') && arg.len() > 1 {
            if arg == "-r" || arg == "-R" || arg == "--recursive" {
                recursive = true;
            }
        } else {
            targets.push(arg.as_str());
        }
    }
    if !recursive {
        return Verdict::Safe;
    }
    let Some(worktree) = ctx.worktree.as_deref() else {
        return gated(DestructiveCategory::RecursiveDelete);
    };
    let worktree = resolve_existing(worktree);
    let inside = targets.iter().all(|target| {
        resolve_path(ctx.cwd.as_deref(), target).is_some_and(|path| path != worktree && path.starts_with(&worktree))
    });
    if inside {
        Verdict::Safe
    } else {
        gated(DestructiveCategory::RecursiveDelete)
    }
}

/// Resolve `target` against `base` into an absolute path with `.`/`..` removed and symlinks in its
/// existing part resolved. `None` when a relative target has no base to resolve against.
fn resolve_path(base: Option<&Path>, target: &str) -> Option<PathBuf> {
    let target = Path::new(target);
    let joined = if target.is_absolute() {
        target.to_path_buf()
    } else {
        base?.join(target)
    };
    if !joined.is_absolute() {
        return None;
    }
    Some(resolve_existing(&normalize_lexically(&joined)))
}

/// Remove `.` and `..` components without touching the filesystem.
fn normalize_lexically(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Canonicalize the longest existing ancestor of an absolute path and re-append the rest, so a
/// symlinked prefix (`/tmp` → `/private/tmp`) compares equal to its resolved form.
fn resolve_existing(path: &Path) -> PathBuf {
    let path = normalize_lexically(path);
    let mut existing = path.as_path();
    let mut tail: Vec<&std::ffi::OsStr> = Vec::new();
    loop {
        if let Ok(canonical) = existing.canonicalize() {
            let mut out = canonical;
            out.extend(tail.iter().rev());
            return out;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(parent), Some(name)) => {
                tail.push(name);
                existing = parent;
            }
            _ => return path,
        }
    }
}

// --- publishing ---

/// The first token that is not an option, skipping the value of each option in `value_options`.
/// `--opt=value` and `+toolchain` tokens carry no separate value.
fn first_command<'a>(args: &'a [String], value_options: &[&str]) -> Option<(usize, &'a str)> {
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if value_options.contains(&arg) {
            i += 2;
        } else if arg.starts_with('-') || arg.starts_with('+') {
            i += 1;
        } else {
            return Some((i, arg));
        }
    }
    None
}

fn classify_npm(args: &[String]) -> Verdict {
    const VALUE_OPTIONS: &[&str] = &["-w", "--workspace", "--prefix", "--registry", "--userconfig", "--otp", "--tag", "--access"];
    match first_command(args, VALUE_OPTIONS) {
        Some((_, "publish")) => gated(DestructiveCategory::Publish),
        _ => Verdict::Safe,
    }
}

fn classify_cargo(args: &[String]) -> Verdict {
    const VALUE_OPTIONS: &[&str] = &["-Z", "--config", "-C", "--color"];
    match first_command(args, VALUE_OPTIONS) {
        Some((_, "publish")) => gated(DestructiveCategory::Publish),
        _ => Verdict::Safe,
    }
}

/// `gh pr merge` and every `gh release` subcommand.
fn classify_gh(args: &[String]) -> Verdict {
    const VALUE_OPTIONS: &[&str] = &["-R", "--repo", "--hostname"];
    let Some((idx, command)) = first_command(args, VALUE_OPTIONS) else {
        return Verdict::Safe;
    };
    match command {
        "release" => gated(DestructiveCategory::Publish),
        "pr" => match first_command(&args[idx + 1..], VALUE_OPTIONS) {
            Some((_, "merge")) => gated(DestructiveCategory::Publish),
            _ => Verdict::Safe,
        },
        _ => Verdict::Safe,
    }
}
