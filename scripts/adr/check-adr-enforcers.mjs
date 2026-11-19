#!/usr/bin/env node
/**
 * Every ADR in `docs/adr/` says what keeps it true, and the thing it names exists (#1630).
 *
 * THE DEFECT. An ADR is a contract. Without a named enforcer, a change can break the contract and nothing
 * fails: the ADR then describes code that no longer exists, and a reader trusts it. Flywheel's owner
 * standard is that an ADR is enforced in code or in CI wherever a machine can do it.
 *
 * THE RULE. The last section of an ADR is `## Enforced by`. It holds either
 *   - one bullet per enforcer: the first backticked token is a path, relative to this folder, of a file
 *     that exists (a test, a check script, a workflow). Each later backticked token in the bullet is a
 *     symbol (a test name, a function, a column) that must appear in that file's text; or
 *   - one bullet `Not machine-enforceable: <reason>.` when no machine can keep the decision.
 * A bullet starts with `-` or `*`; an indented line after it belongs to it. A symbol matches as a whole word and
 * outside a comment line. A bullet whose path is a test file must name at least one symbol, so a deleted or renamed
 * test fails. A path is resolved with realpath, so a symlink out of this folder fails. The escape hatch is
 * case-insensitive, may be bold, and needs a reason of six words. A file in docs/adr/ that is not
 * NNNN-lower-case-words.md fails, and so does a repeated number.
 * A missing section, an empty one, a path that does not exist and a symbol that is not in its file all fail.
 * The check does not run the enforcer. The enforcer's own job (`cargo nextest`, `vitest`, a `node --test`
 * step) does, so this check only keeps the name from rotting.
 *
 * Usage: node scripts/adr/check-adr-enforcers.mjs     exit 0 = clean, 1 = a finding
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SECTION = "## Enforced by";
export const NOT_ENFORCEABLE = "Not machine-enforceable:";
/** The least words of a reason: a bare "no" or "n/a" does not say why no machine can keep the decision. */
export const MIN_REASON_WORDS = 6;
/** A file name an ADR may have. The number is four digits and the rest is lower case words. */
export const ADR_FILE = /^(\d{4})-[a-z0-9-]+\.md$/;
/** A path that holds tests: a symbol (a test name) is required of it, so a deleted test fails the check. */
const TEST_PATH = /(^|\/)tests?\/[^/]+\.(rs|mjs|js|ts|tsx)$|\.test\.[a-z]+$/;
const WORD = /[A-Za-z0-9_]/;

/**
 * The bullets of the `## Enforced by` section: `null` when the ADR has no such section, else
 * `{ bullets, stray }`. A bullet starts with `-` or `*` (leading spaces allowed). An indented line that
 * follows it is part of the same bullet. `stray` counts the non-empty lines that belong to no bullet.
 */
export function enforcerBullets(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === SECTION);
  if (start < 0) return null;
  const bullets = [];
  let stray = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    if (line.trim() === "") continue;
    const marker = /^\s*[-*]\s+(.*)$/.exec(line);
    if (marker) bullets.push(marker[1].trim());
    else if (/^\s/.test(line) && bullets.length > 0) bullets[bullets.length - 1] += " " + line.trim();
    else stray += 1;
  }
  return { bullets, stray };
}

/** A source file without its whole-line comments: lines that start with a double slash, a block-comment opener or a star, and SQL lines that start with two dashes. */
export function withoutCommentLines(file, body) {
  const ext = path.extname(file);
  const marks = ext === ".sql" ? [/^\s*--/] : [/^\s*\/\//, /^\s*\/\*/, /^\s*\*(\s|\/|$)/];
  if (![".rs", ".ts", ".tsx", ".mjs", ".js", ".sql"].includes(ext)) return body;
  return body
    .split("\n")
    .filter((l) => !marks.some((m) => m.test(l)))
    .join("\n");
}

/** True when `symbol` is in `body` as a whole word: no identifier character touches either end of it. */
export function hasSymbol(body, symbol) {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = WORD.test(symbol[0]) ? "(?<![A-Za-z0-9_])" : "";
  const after = WORD.test(symbol[symbol.length - 1]) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(before + esc + after).test(body);
}

/** Reads one bullet as the escape hatch: `{ reason }` when it is one, `{ error }` when it is a near miss, else `null`. */
function escapeHatch(bullet) {
  const plain = bullet.replace(/\*\*|__/g, "").trim();
  const exact = /^not machine-enforceable:\s*(.*)$/i.exec(plain);
  if (exact) return { reason: exact[1].trim() };
  if (/^not[\s-]*machine[\s-]*enforc/i.test(plain)) {
    return { error: `misspelled escape hatch, write exactly "${NOT_ENFORCEABLE} <reason>": ${bullet}` };
  }
  return null;
}

/**
 * The problems in one ADR's text. `root` is the folder paths resolve against (`flywheel/`).
 * @returns {string[]} one message per problem, empty when the ADR passes.
 */
export function checkAdrText(name, text, root) {
  const found = enforcerBullets(text);
  if (found === null) return [`${name}: no "${SECTION}" section`];
  const { bullets, stray } = found;
  if (bullets.length === 0) {
    return [
      stray > 0
        ? `${name}: "${SECTION}" has ${stray} line(s) and no bullet: start each bullet at the left margin with "- " or "* "`
        : `${name}: "${SECTION}" has no bullet`,
    ];
  }
  const hatches = bullets.map(escapeHatch);
  const errors = hatches.filter((h) => h && h.error).map((h) => `${name}: ${h.error}`);
  if (errors.length > 0) return errors;
  if (hatches.some(Boolean)) {
    if (bullets.length > 1) return [`${name}: "${NOT_ENFORCEABLE}" must be the only bullet`];
    const words = hatches[0].reason.split(/\s+/).filter(Boolean).length;
    return words < MIN_REASON_WORDS
      ? [`${name}: "${NOT_ENFORCEABLE}" needs a reason of at least ${MIN_REASON_WORDS} words, it has ${words}`]
      : [];
  }
  const realRoot = fs.realpathSync(root);
  const problems = [];
  for (const bullet of bullets) {
    const tokens = [...bullet.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    if (tokens.length === 0) {
      problems.push(`${name}: bullet names no backticked path: ${bullet}`);
      continue;
    }
    const [rel, ...symbols] = tokens;
    const joined = path.resolve(root, rel);
    if (path.isAbsolute(rel) || !fs.existsSync(joined) || !fs.statSync(joined).isFile()) {
      problems.push(`${name}: enforcer does not exist: ${rel}`);
      continue;
    }
    const file = fs.realpathSync(joined);
    if (!file.startsWith(realRoot + path.sep)) {
      problems.push(`${name}: path leaves the folder: ${rel}`);
      continue;
    }
    if (symbols.length === 0 && TEST_PATH.test(rel)) {
      problems.push(`${name}: ${rel} is a test file: name the test in backticks after the path`);
    }
    const body = withoutCommentLines(file, fs.readFileSync(file, "utf8"));
    for (const symbol of symbols) {
      if (!hasSymbol(body, symbol)) problems.push(`${name}: ${rel} does not contain \`${symbol}\` outside a comment`);
    }
  }
  return problems;
}

/** The problems in every ADR file of `adrDir`, and the numbers that are missing (information only). */
export function checkAdrDir(adrDir, root) {
  const all = fs.readdirSync(adrDir).filter((f) => f.endsWith(".md") && !/^(readme|index)\.md$/i.test(f)).sort();
  const problems = [];
  const files = [];
  const seen = new Map();
  for (const f of all) {
    const m = ADR_FILE.exec(f);
    if (!m) {
      problems.push(`${f}: an ADR file is named NNNN-lower-case-words.md`);
      continue;
    }
    if (seen.has(m[1])) problems.push(`${f}: number ${m[1]} is also used by ${seen.get(m[1])}`);
    else seen.set(m[1], f);
    files.push(f);
  }
  for (const f of files) problems.push(...checkAdrText(f, fs.readFileSync(path.join(adrDir, f), "utf8"), root));
  const numbers = [...seen.keys()].map(Number);
  const gaps = [];
  for (let n = 1; n < Math.max(0, ...numbers); n++) if (!seen.has(String(n).padStart(4, "0"))) gaps.push(n);
  return { count: files.length, problems, gaps };
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const { count, problems, gaps } = checkAdrDir(path.join(root, "docs", "adr"), root);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} problem(s) in ${count} ADRs. See scripts/adr/check-adr-enforcers.mjs.`);
    process.exit(1);
  }
  if (gaps.length > 0) console.log(`info: ADR numbers not used: ${gaps.join(", ")}`);
  console.log(`adr enforcers: ${count} ADRs, each names an enforcer that exists.`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
