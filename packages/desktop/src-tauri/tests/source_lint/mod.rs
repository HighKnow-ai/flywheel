//! The source lints shared by `scheduler_lock.rs` (issue #215) and `command_threads.rs` (#220).
//!
//! [`holders`]: every place the shared board connection (`AppState.db`) is locked, read straight
//! from the source, and every call made while that guard is alive. A call that can reach a git or
//! process spawn is a lock holder: every IPC read waits behind it.
//!
//! [`commands_on_the_ipc_thread`]: every `#[tauri::command]` that reaches a spawn or a blocking wait
//! ([`blocking_names`], issue #235) other than inside a `spawn_blocking(..)` (or `thread::spawn(..)`)
//! argument. A sync command runs on the main thread, and an async one's body on a runtime worker:
//! either way git or a sleep there stalls IPC dispatch.
//!
//! Text-level and deliberately simple, in the house style of `handler_roster.rs`:
//! - comments, string and char literals, and `#[cfg(test)]` items are blanked first;
//! - a function *reaches a spawn* when its body builds a `Command` (`Command::new(`), runs one
//!   (`.spawn()`, `.output()`), or hands one to `output_with_timeout(`, or when it calls, by name,
//!   a function that reaches a spawn (a fixpoint over `packages/core/src` and the desktop crate).
//!   Work inside a `spawn_blocking(..)` or `thread::spawn(..)` argument runs on another thread, so
//!   it does not count: it neither blocks the caller nor runs under its guard;
//! - a *lock span* opens at `let <guard> = <..>db.lock()..;` (or a call of a closure bound to one,
//!   of a function returning the connection's `MutexGuard`, or a `MutexGuard` parameter) and
//!   closes at `drop(<guard>)` or the end of the enclosing block; a lock taken as a temporary
//!   inside a larger statement spans that statement, and one taken in an `if let`, `match` or
//!   `let .. else` head spans the block it opens.
//!
//! A connection opened beside the shared one (`commands::side_connection`) is not the board lock,
//! so work on it is not a span. Names are matched without paths, so a name shared by a spawning
//! and a non-spawning function is over-approximated; [`NOT_A_SPAWN`] would list such collisions,
//! each with its reason, and a test keeps every entry a real one.

// Each test target uses its own half.
#![allow(dead_code)]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

/// `(name, reason)`: names that some spawning function in the tree also carries, but whose every
/// call made under the lock resolves to a function that spawns nothing. Each must be a name
/// collision, never an exemption for a real spawn. Empty today: no name collides.
pub const NOT_A_SPAWN: &[(&str, &str)] = &[];

/// One file's text with comments, string/char literals and `#[cfg(test)]` items blanked to spaces,
/// so offsets still line up with the original for line numbers.
pub fn strip(src: &str) -> String {
    let b: Vec<char> = src.chars().collect();
    let mut out: Vec<char> = b.clone();
    let mut i = 0;
    let blank = |out: &mut Vec<char>, from: usize, to: usize| {
        for c in out.iter_mut().take(to).skip(from) {
            if *c != '\n' {
                *c = ' ';
            }
        }
    };
    while i < b.len() {
        let c = b[i];
        let next = b.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            let start = i;
            while i < b.len() && b[i] != '\n' {
                i += 1;
            }
            blank(&mut out, start, i);
        } else if c == '/' && next == Some('*') {
            let start = i;
            i += 2;
            while i + 1 < b.len() && !(b[i] == '*' && b[i + 1] == '/') {
                i += 1;
            }
            i += 2;
            blank(&mut out, start, i.min(b.len()));
        } else if c == 'r' && (next == Some('"') || next == Some('#')) && !is_ident(b.get(i.wrapping_sub(1)).copied()) {
            // A raw string: r"..." or r#"..."#.
            let mut j = i + 1;
            let mut hashes = 0;
            while j < b.len() && b[j] == '#' {
                hashes += 1;
                j += 1;
            }
            if b.get(j) != Some(&'"') {
                i += 1;
                continue;
            }
            j += 1;
            loop {
                if j >= b.len() {
                    break;
                }
                if b[j] == '"' && (0..hashes).all(|k| b.get(j + 1 + k) == Some(&'#')) {
                    j += 1 + hashes;
                    break;
                }
                j += 1;
            }
            blank(&mut out, i + 1, j - 1);
            i = j;
        } else if c == '"' {
            let start = i;
            i += 1;
            while i < b.len() && b[i] != '"' {
                if b[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }
            i += 1;
            blank(&mut out, start + 1, (i - 1).min(b.len()));
        } else if c == '\'' {
            // A char literal ('x', '\n', '\''), or a lifetime (left alone).
            if next == Some('\\') {
                let mut j = i + 2;
                while j < b.len() && b[j] != '\'' {
                    j += 1;
                }
                blank(&mut out, i + 1, j);
                i = j + 1;
            } else if b.get(i + 2) == Some(&'\'') {
                blank(&mut out, i + 1, i + 2);
                i += 3;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    let mut text: String = out.into_iter().collect();
    // Blank every `#[cfg(test)]` item: the attribute through the end of the item it decorates.
    while let Some(at) = text.find("#[cfg(test)]") {
        let end = item_end(&text, at + "#[cfg(test)]".len());
        let blanked: String = text[at..end].chars().map(|c| if c == '\n' { '\n' } else { ' ' }).collect();
        text.replace_range(at..end, &blanked);
    }
    text
}

fn is_ident(c: Option<char>) -> bool {
    c.is_some_and(|c| c.is_alphanumeric() || c == '_')
}

/// The byte offset just past the item starting at `from`: its balanced `{..}` body, or its `;`.
fn item_end(text: &str, from: usize) -> usize {
    let bytes = text.as_bytes();
    let mut i = from;
    while i < bytes.len() {
        match bytes[i] {
            b';' => return i + 1,
            b'{' => return matching_close(text, i) + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// The offset of the `}` closing the `{` at `open`.
fn matching_close(text: &str, open: usize) -> usize {
    let bytes = text.as_bytes();
    let mut depth = 0i32;
    for (i, &c) in bytes.iter().enumerate().skip(open) {
        if c == b'{' {
            depth += 1;
        } else if c == b'}' {
            depth -= 1;
            if depth == 0 {
                return i;
            }
        }
    }
    bytes.len().saturating_sub(1)
}

/// One function with a body, from a stripped file.
pub struct Function {
    pub name: String,
    /// Offsets of the signature start, and of the body's `{` and `}`.
    pub sig_start: usize,
    pub body_open: usize,
    pub body_close: usize,
}

/// Every `fn name(..) { .. }` in `text` (nested ones included; trait declarations skipped).
pub fn functions(text: &str) -> Vec<Function> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut search = 0;
    while let Some(rel) = text[search..].find("fn ") {
        let at = search + rel;
        search = at + 3;
        if is_ident(text[..at].chars().last()) {
            continue;
        }
        let name: String = text[at + 3..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if name.is_empty() {
            continue;
        }
        // The body opens at the first `{` outside the parameter list and generics; a `;` first
        // means a declaration without a body.
        let mut i = at + 3 + name.len();
        let mut paren = 0i32;
        let mut open = None;
        while i < bytes.len() {
            match bytes[i] {
                b'(' | b'<' | b'[' => paren += 1,
                b')' | b'>' | b']' => paren -= 1,
                b';' if paren <= 0 => break,
                b'{' if paren <= 0 => {
                    open = Some(i);
                    break;
                }
                _ => {}
            }
            // `->` is not a closing angle bracket.
            if bytes[i] == b'>' && i > 0 && bytes[i - 1] == b'-' {
                paren += 1;
            }
            i += 1;
        }
        let Some(open) = open else { continue };
        found.push(Function { name, sig_start: at, body_open: open, body_close: matching_close(text, open) });
    }
    found
}

/// Every name called in `text[from..to]`: an identifier directly followed by `(` (or by a
/// turbofish), excluding keywords and macro invocations.
pub fn calls(text: &str, from: usize, to: usize) -> Vec<(usize, String)> {
    const KEYWORDS: &[&str] = &[
        "if", "while", "for", "match", "return", "fn", "loop", "in", "as", "move", "Some", "Ok", "Err", "None",
        "let", "else", "break", "continue", "where", "impl", "mut", "ref", "self", "Self", "super", "crate",
    ];
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut i = from;
    while i < to {
        if (bytes[i].is_ascii_alphabetic() || bytes[i] == b'_') && !is_ident(text[..i].chars().last()) {
            let start = i;
            while i < to && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let name = &text[start..i];
            let mut j = i;
            if text[j..].starts_with("::<") {
                // Skip a turbofish.
                let mut depth = 0;
                while j < to {
                    if bytes[j] == b'<' {
                        depth += 1;
                    } else if bytes[j] == b'>' {
                        depth -= 1;
                        if depth == 0 {
                            j += 1;
                            break;
                        }
                    }
                    j += 1;
                }
            }
            if j < bytes.len() && bytes[j] == b'(' && !KEYWORDS.contains(&name) {
                out.push((start, name.to_string()));
            }
        } else {
            i += 1;
        }
    }
    out
}

/// Whether `text[from..to]` itself spawns a process: builds a `Command`, runs one, or hands one to
/// the bounded-wait guard.
pub fn spawns_directly(text: &str, from: usize, to: usize) -> bool {
    let body: String = text[from..to].split_whitespace().collect::<Vec<_>>().join("");
    ["Command::new(", ".spawn()", ".output()", "output_with_timeout("].iter().any(|s| body.contains(s))
}

/// Every source file under `dir`, recursively, as `(display path, text)`.
pub fn sources(dir: &Path, label: &str) -> Vec<(String, String)> {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for entry in fs::read_dir(&d).unwrap_or_else(|e| panic!("read {d:?}: {e}")) {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "rs") {
                files.push(path);
            }
        }
    }
    files.sort();
    files
        .into_iter()
        .map(|p| {
            let rel = p.strip_prefix(dir).unwrap().display().to_string();
            (format!("{label}/{rel}"), fs::read_to_string(&p).unwrap())
        })
        .collect()
}

/// Every function that reaches a spawn, by fixpoint over `files` (already stripped), each mapped to
/// the callee through which it does (`None`: it spawns in its own body) — the chain a report prints.
pub fn spawning_names(files: &[(String, String)]) -> BTreeMap<String, Option<String>> {
    spawning_names_skipping(files, &NOT_A_SPAWN.iter().map(|(n, _)| *n).collect::<Vec<_>>())
}

/// [`spawning_names`] with `skip` in place of [`NOT_A_SPAWN`].
pub fn spawning_names_skipping(files: &[(String, String)], skip: &[&str]) -> BTreeMap<String, Option<String>> {
    reaching_names(files, skip, spawns_directly)
}

/// Whether `text[from..to]` itself blocks its thread on something other than a process (issue
/// #235): a `thread::sleep`, or a wait on a channel, a child or a thread (`.recv()` that is not
/// awaited, `.recv_timeout(`, `.wait()`, `.join()` with no argument).
pub fn blocks_directly(text: &str, from: usize, to: usize) -> bool {
    let body: String = text[from..to].split_whitespace().collect::<Vec<_>>().join("");
    ["thread::sleep(", ".recv_timeout(", ".wait()", ".join()"].iter().any(|s| body.contains(s))
        || body.match_indices(".recv()").any(|(at, _)| !body[at + ".recv()".len()..].starts_with(".await"))
}

/// Every function that blocks the thread it runs on: it reaches a process spawn or a blocking wait
/// ([`blocks_directly`]), by the same fixpoint as [`spawning_names`].
pub fn blocking_names(files: &[(String, String)]) -> BTreeMap<String, Option<String>> {
    let skip: Vec<&str> = NOT_A_SPAWN.iter().chain(NOT_BLOCKING).map(|(n, _)| *n).collect();
    blocking_names_skipping(files, &skip)
}

/// [`blocking_names`] with `skip` in place of [`NOT_A_SPAWN`] and [`NOT_BLOCKING`].
pub fn blocking_names_skipping(files: &[(String, String)], skip: &[&str]) -> BTreeMap<String, Option<String>> {
    reaching_names(files, skip, |text, from, to| spawns_directly(text, from, to) || blocks_directly(text, from, to))
}

/// `(name, reason)`: names a blocking function in the tree also carries ([`blocks_directly`]), but
/// whose every call from a command resolves to one that does not block. As with [`NOT_A_SPAWN`],
/// each must be a real collision, and a test keeps it so.
pub const NOT_BLOCKING: &[(&str, &str)] = &[(
    "collect",
    "`proc.rs`'s `Drain::collect` waits on a pipe reader inside the bounded process wait; every \
     `.collect()` a command makes is an iterator's",
)];

/// The fixpoint behind [`spawning_names`] and [`blocking_names`]: every function whose own body
/// satisfies `seed`, or that calls one that does, outside work handed to another thread.
fn reaching_names(
    files: &[(String, String)],
    skip: &[&str],
    seed: fn(&str, usize, usize) -> bool,
) -> BTreeMap<String, Option<String>> {
    let skip: BTreeSet<&str> = skip.iter().copied().collect();
    let fns: Vec<(Function, Vec<String>, bool)> = files
        .iter()
        .flat_map(|(_, text)| {
            functions(text).into_iter().map(move |f| {
                // Work handed to `spawn_blocking(..)` or `thread::spawn(..)` runs on another
                // thread: it neither blocks this function's caller nor runs under its guard (a
                // `MutexGuard` cannot move there), so it does not make this function spawning.
                let away = offloaded(text, f.body_open, f.body_close);
                let inside = |at: usize| away.iter().any(|(s, e)| at > *s && at < *e);
                let called = calls(text, f.body_open, f.body_close)
                    .into_iter()
                    .filter(|(at, _)| !inside(*at))
                    .map(|(_, n)| n)
                    .collect();
                let mut body = text[f.body_open..f.body_close].to_string();
                for (s, e) in &away {
                    let blank = " ".repeat(e - s);
                    body.replace_range(s - f.body_open..e - f.body_open, &blank);
                }
                let direct = seed(&body, 0, body.len());
                (f, called, direct)
            })
        })
        .collect();
    let mut reaching: BTreeMap<String, Option<String>> = fns
        .iter()
        .filter(|(f, _, d)| *d && !skip.contains(f.name.as_str()))
        .map(|(f, _, _)| (f.name.clone(), None))
        .collect();
    loop {
        let before = reaching.len();
        for (f, called, _) in &fns {
            if skip.contains(f.name.as_str()) || reaching.contains_key(&f.name) {
                continue;
            }
            if let Some(via) = called.iter().find(|c| reaching.contains_key(*c)) {
                reaching.insert(f.name.clone(), Some(via.clone()));
            }
        }
        if reaching.len() == before {
            return reaching;
        }
    }
}

/// `name`'s chain down to the function that spawns, e.g. `a -> b -> spawn_git`.
pub fn chain(spawning: &BTreeMap<String, Option<String>>, name: &str) -> String {
    let mut out = vec![name.to_string()];
    let mut at = name.to_string();
    while let Some(Some(next)) = spawning.get(&at) {
        if out.contains(next) {
            break;
        }
        out.push(next.clone());
        at = next.clone();
    }
    out.join(" -> ")
}

/// One call to a spawning function made while the board connection's guard is alive.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Holder {
    pub file: String,
    pub function: String,
    pub line: usize,
    pub callee: String,
}

impl std::fmt::Display for Holder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{} {} calls {} with the board lock held", self.file, self.line, self.function, self.callee)
    }
}

/// Where `s` (whitespace removed) locks the board connection, as the lock call's `(start, end)`:
/// `db.lock()`, or a call of one of `lock_fns` (closures bound to `db.lock()`, and functions that
/// return the connection's guard).
fn lock_call(s: &str, lock_fns: &BTreeSet<String>) -> Option<(usize, usize)> {
    if let Some(at) = s.find("db.lock()") {
        return Some((at, at + "db.lock()".len()));
    }
    for n in lock_fns {
        let call = format!("{n}(");
        for (at, _) in s.match_indices(&call) {
            if is_ident(s[..at].chars().last()) || s[..at].ends_with('.') {
                continue;
            }
            let open = at + n.len();
            let mut depth = 0;
            for (k, c) in s[open..].char_indices() {
                match c {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some((at, open + k + 1));
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    None
}

fn locks_db(s: &str, lock_fns: &BTreeSet<String>) -> bool {
    lock_call(s, lock_fns).is_some()
}

/// The names of the functions in `text` that hand back the connection's guard
/// (`-> ..MutexGuard<..Connection>`): a call of one opens a lock span like `db.lock()` does.
pub fn guard_returning(text: &str) -> BTreeSet<String> {
    functions(text)
        .into_iter()
        .filter(|f| {
            let sig = &text[f.sig_start..f.body_open];
            sig.split_once("->").is_some_and(|(_, ret)| ret.contains("MutexGuard") && ret.contains("Connection"))
        })
        .map(|f| f.name)
        .collect()
}

/// Every lock span in one function, as `(from, to)` offsets into `text`.
fn lock_spans(text: &str, f: &Function, guard_fns: &BTreeSet<String>) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut spans = Vec::new();
    let mut lock_fns: BTreeSet<String> = guard_fns.clone();

    // A `MutexGuard` parameter holds the lock from entry.
    let sig = &text[f.sig_start..f.body_open];
    let sig = sig.split_once("->").map_or(sig, |(params, _)| params);
    for param in sig.split([',', '(']) {
        if param.contains("MutexGuard") {
            let name = param.split(':').next().unwrap_or("").split_whitespace().last().unwrap_or("").to_string();
            spans.push((f.body_open, end_of_guard(text, f.body_open + 1, f.body_close, &name)));
        }
    }

    // Walk the body statement by statement: a statement ends at `;` at its own brace depth, and a
    // block opened inside it is walked into.
    let mut i = f.body_open + 1;
    let mut stmt_start = i;
    let mut paren = 0i32;
    // Per open block: where the suspended statement started, its paren depth, and where the block
    // opened.
    let mut stmt_depth: Vec<(usize, i32, usize)> = Vec::new();
    while i < f.body_close {
        match bytes[i] {
            b'(' | b'[' => paren += 1,
            b')' | b']' => paren -= 1,
            b'{' => {
                // A block opened by `if let .. = db.lock()`, `match db.lock()` or a `let .. else`
                // runs with the guard alive: the whole block is a span.
                let prefix: String = without_blocks(&text[stmt_start..i]).split_whitespace().collect();
                if locks_db(&prefix, &lock_fns) && !prefix.starts_with("||") && !prefix.starts_with("move||") {
                    spans.push((i, matching_close(text, i)));
                }
                // Entering a block: the statement so far is suspended.
                stmt_depth.push((stmt_start, paren, i));
                paren = 0;
                stmt_start = i + 1;
            }
            b'}' => {
                let (s, p, open) = stmt_depth.pop().unwrap_or((i + 1, 0, i));
                stmt_start = s;
                paren = p;
                // A block statement (`if`, `match`, a loop, a bare block) ends at its `}` unless an
                // `else` follows: the next statement starts after it.
                let head = without_blocks(&text[s..open]);
                let head = head.trim_start();
                let block_statement = paren == 0
                    && (head.is_empty()
                        || ["if ", "match ", "for ", "while ", "loop", "unsafe"].iter().any(|k| head.starts_with(k)));
                if block_statement && !text[i + 1..].trim_start().starts_with("else") {
                    stmt_start = i + 1;
                }
            }
            b';' if paren == 0 => {
                // Nested blocks are walked as statements of their own; only what the statement does
                // outside them counts here.
                let outer = without_blocks(&text[stmt_start..i]);
                let stmt = outer.as_str();
                let flat: String = stmt.split_whitespace().collect::<Vec<_>>().join(" ");
                let squeezed: String = stmt.split_whitespace().collect();
                if let Some(rest) = flat.strip_prefix("let ") {
                    let (pat, rhs) = rest.split_once('=').unwrap_or((rest, ""));
                    let rhs_squeezed: String = rhs.split_whitespace().collect();
                    let guard_name = pat
                        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
                        .rfind(|w| !w.is_empty() && *w != "mut" && *w != "Ok" && *w != "Some")
                        .unwrap_or("")
                        .to_string();
                    if (rhs_squeezed.starts_with("||") || rhs_squeezed.starts_with("move||"))
                        && locks_db(&rhs_squeezed, &lock_fns)
                    {
                        lock_fns.insert(guard_name);
                    } else if locks_db(&rhs_squeezed, &lock_fns) && guard_rhs(&rhs_squeezed, &lock_fns) {
                        spans.push((i, end_of_guard(text, i + 1, f.body_close, &guard_name)));
                    } else if locks_db(&squeezed, &lock_fns) {
                        spans.push((stmt_start, i));
                    }
                } else if locks_db(&squeezed, &lock_fns) {
                    spans.push((stmt_start, i));
                }
                stmt_start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    spans
}

/// `stmt` with every balanced `{..}` block cut out.
fn without_blocks(stmt: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in stmt.chars() {
        match c {
            '{' => depth += 1,
            '}' => depth -= 1,
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// Whether a `let` right-hand side (whitespace removed) binds the guard itself — the lock call at
/// the top level, followed only by error handling — rather than a value computed under a temporary
/// guard (`f(&*lock()?)`).
fn guard_rhs(rhs: &str, lock_fns: &BTreeSet<String>) -> bool {
    let Some((at, end)) = lock_call(rhs, lock_fns) else { return false };
    let before = &rhs[..at];
    let opens = before.matches('(').count();
    let closes = before.matches(')').count();
    if opens != closes || before.contains('&') || before.contains('*') {
        return false;
    }
    let after = &rhs[end..];
    after.is_empty()
        || after.starts_with('?')
        || after.starts_with(".map_err(")
        || after.starts_with(".unwrap(")
        || after.starts_with(".expect(")
        || after.starts_with("else")
}

/// Where a guard named `name`, alive from `from`, is released: its `drop(name)`, or the end of the
/// block it was declared in.
fn end_of_guard(text: &str, from: usize, body_close: usize, name: &str) -> usize {
    let bytes = text.as_bytes();
    let mut depth = 0i32;
    let mut i = from;
    let drop_call = format!("drop({name})");
    while i < body_close {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                if depth == 0 {
                    return i;
                }
                depth -= 1;
            }
            b'd' if !name.is_empty() && text[i..].starts_with(&drop_call) && !is_ident(text[..i].chars().last()) => {
                return i;
            }
            _ => {}
        }
        i += 1;
    }
    body_close
}

/// Every call to a spawning function made under a lock span, across `files` (already stripped).
pub fn holders(files: &[(String, String)], spawning: &BTreeMap<String, Option<String>>) -> Vec<Holder> {
    let guard_fns: BTreeSet<String> = files.iter().flat_map(|(_, text)| guard_returning(text)).collect();
    let mut out = BTreeSet::new();
    for (file, text) in files {
        for f in functions(text) {
            for (from, to) in lock_spans(text, &f, &guard_fns) {
                for (at, callee) in calls(text, from, to) {
                    if spawning.contains_key(&callee) || spawns_directly(text, at, (at + callee.len() + 2).min(to)) {
                        let line = text[..at].matches('\n').count() + 1;
                        out.insert(Holder { file: file.clone(), function: f.name.clone(), line, callee });
                    }
                }
                if spawns_directly(text, from, to) {
                    let line = text[..from].matches('\n').count() + 1;
                    out.insert(Holder { file: file.clone(), function: f.name.clone(), line, callee: "a process spawn".into() });
                }
            }
        }
    }
    // A function that only appears nested inside another is reported once per enclosing function;
    // collapse duplicates by (file, line, callee).
    let mut seen: BTreeMap<(String, usize, String), Holder> = BTreeMap::new();
    for h in out {
        seen.entry((h.file.clone(), h.line, h.callee.clone())).or_insert(h);
    }
    seen.into_values().collect()
}

/// One `#[tauri::command]` that reaches a spawn on the thread IPC dispatches it on.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct IpcThreadSpawn {
    pub file: String,
    pub line: usize,
    pub command: String,
    pub is_async: bool,
    pub callee: String,
}

impl std::fmt::Display for IpcThreadSpawn {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let kind = if self.is_async { "async command" } else { "sync command (main thread)" };
        write!(f, "{}:{} {} {} calls {} on its dispatch thread", self.file, self.line, kind, self.command, self.callee)
    }
}

/// The `(open, close)` paren offsets of every `spawn_blocking(..)` and `thread::spawn(..)` call in
/// `text[from..to]`: work inside them runs off the dispatching thread.
fn offloaded(text: &str, from: usize, to: usize) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    for needle in ["spawn_blocking(", "thread::spawn("] {
        for (rel, _) in text[from..to].match_indices(needle) {
            let open = from + rel + needle.len() - 1;
            let mut depth = 0;
            for (k, c) in text[open..to].char_indices() {
                match c {
                    '(' => depth += 1,
                    ')' => {
                        depth -= 1;
                        if depth == 0 {
                            spans.push((open, open + k));
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
    spans
}

/// Every `#[tauri::command]` in `files` (already stripped) that calls a function in `blocking`
/// ([`blocking_names`]), or spawns or blocks itself, outside a `spawn_blocking(..)` /
/// `thread::spawn(..)` argument.
pub fn commands_on_the_ipc_thread(
    files: &[(String, String)],
    spawning: &BTreeMap<String, Option<String>>,
) -> Vec<IpcThreadSpawn> {
    let mut out = BTreeSet::new();
    for (file, text) in files {
        let fns = functions(text);
        for (attr, _) in text.match_indices("#[tauri::command") {
            let Some(f) = fns.iter().filter(|f| f.sig_start > attr).min_by_key(|f| f.sig_start) else { continue };
            let is_async = text[attr..f.sig_start].trim_end().ends_with("async");
            let away = offloaded(text, f.body_open, f.body_close);
            let inside = |at: usize| away.iter().any(|(s, e)| at > *s && at < *e);
            for (at, callee) in calls(text, f.body_open, f.body_close) {
                if inside(at) {
                    continue;
                }
                let after = text[at + callee.len()..].split_whitespace().collect::<String>();
                let method = text[..at].trim_end().ends_with('.');
                let direct = callee == "new" && text[..at].ends_with("Command::")
                    || (callee == "spawn" || callee == "output") && method
                    || callee == "sleep" && text[..at].ends_with("thread::")
                    || callee == "recv_timeout" && method
                    || (callee == "wait" || callee == "join") && method && after.starts_with("()")
                    || callee == "recv" && method && after.starts_with("()") && !after.starts_with("().await");
                if spawning.contains_key(&callee) || direct {
                    let line = text[..at].matches('\n').count() + 1;
                    out.insert(IpcThreadSpawn { file: file.clone(), line, command: f.name.clone(), is_async, callee });
                }
            }
        }
    }
    out.into_iter().collect()
}
