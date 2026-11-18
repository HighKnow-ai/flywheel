#!/usr/bin/env node
/**
 * Every `mktemp` that Flywheel runs names a template under "${TMPDIR:-/tmp}" (#1766).
 *
 * THE DEFECT. On macOS a bare `mktemp`, `mktemp -d` or `mktemp -t x` ignores $TMPDIR and writes under
 * the user's /var/folders/.../T. A sandboxed session may write only under its own $TMPDIR, so the call
 * is refused. On Linux and in CI the bare form works, so only a developer's laptop shows it.
 *
 * THE FIX: a template the caller builds on $TMPDIR, `mktemp -d "${TMPDIR:-/tmp}/name.XXXXXX"`.
 *
 * WHAT IS FLAGGED. A `mktemp` that is run (at the start of a line or after `$(`, a backtick, a pipe,
 * `&&`, `||`, `;` or `:`) and has no `XXXX` template on its line, or uses `-t`. A comment line, or a
 * mention in a message, is not run and is left alone. It reads the tracked `*.sh`, `*.yml` and
 * `package.json` files of this folder. `# mktemp-ok: <reason>` on a line allows it, and the reason is printed.
 *
 * Usage: node scripts/check-mktemp-template.mjs     exit 0 = clean, 1 = a bare mktemp
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUN = /(^|[$(`|&;:]|\bthen\b|\bdo\b|\brun:)\s*\(?\s*mktemp\b([^\n]*)/;

/** The findings in one file's text: `{ line, text }` for each run `mktemp` with no template or with `-t`. */
export function scanText(text) {
  const found = [];
  const allowed = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith("#")) return;
    const ok = /# mktemp-ok: (.*)$/.exec(raw);
    const m = RUN.exec(raw);
    if (!m) return;
    const args = m[2];
    const bad = !/XXXX/.test(args) || /(^|\s)-[a-zA-Z]*t\b/.test(args);
    if (!bad) return;
    if (ok) allowed.push({ line: i + 1, reason: ok[1] });
    else found.push({ line: i + 1, text: line });
  });
  return { found, allowed };
}

function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..");
  const files = execFileSync("git", ["ls-files", "--", "*.sh", "*.yml", "package.json", "**/package.json"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  let failed = 0;
  for (const file of new Set(files)) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const { found, allowed } = scanText(fs.readFileSync(path.join(root, file), "utf8"));
    for (const a of allowed) console.log(`allowed: ${file}:${a.line}: ${a.reason}`);
    for (const f of found) {
      failed += 1;
      console.error(`${file}:${f.line}: mktemp without a "\${TMPDIR:-/tmp}/name.XXXXXX" template: ${f.text}`);
    }
  }
  if (failed) {
    console.error(`\n${failed} bare mktemp call(s). On macOS they ignore TMPDIR and fail in a sandbox.`);
    process.exit(1);
  }
  console.log("check-mktemp-template: clean");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
