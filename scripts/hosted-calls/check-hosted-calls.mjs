#!/usr/bin/env node
// Every call from Flywheel to a HighKnow host is declared in docs/hosted-calls.md (ADR 0041).
//
//   node scripts/hosted-calls/check-hosted-calls.mjs [root]
//
// WHAT IT REFUSES, under `root` (default: the flywheel/ directory this script lives in):
//
//   - a HighKnow host (any host in the two HighKnow zones, `.ai` and `.dev`) in a Rust, TypeScript, JavaScript,
//     shell, HTML or configuration file, when no row of the allowlist's table matches it;
//   - a malformed row: a missing column, a Default or Status outside the allowed words, or a
//     `called` row with no `https://` privacy policy URL.
//
// WHY EVERY FILE AND NOT ONLY "CALLS". A grep cannot tell a call from a string. Scanning all of
// the code means a new call cannot hide behind a constant, a comment or a test, and a host that is
// only named has to be declared with Status `declared, not called`. Markdown is not scanned.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIPPED_DIRS = new Set(["node_modules", "target", "dist", ".git", "coverage", "gen"]);
const SCANNED = /\.(rs|ts|tsx|js|jsx|mjs|cjs|json|toml|ya?ml|sh|html|plist)$/i;
const LOCKFILE = /(^|\/)(package-lock\.json|Cargo\.lock|pnpm-lock\.yaml)$/;
// A host ends in the zone. A reverse-DNS name (`ai.highknow.flywheel`) does not match.
const HOST = /[a-z0-9.-]*highknow\.(?:ai|dev)(?![a-z0-9-])/gi;

export const ALLOWLIST = "docs/hosted-calls.md";
const COLUMNS = ["host", "path", "purpose", "data", "default", "policy", "status"];

/** The rows of the allowlist's "Declared hosts" table, and the faults found in them. */
export function parseAllowlist(text) {
  const entries = [];
  const faults = [];
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^##\s+Declared hosts\s*$/.test(l));
  if (start === -1) return { entries, faults: [`${ALLOWLIST} has no "## Declared hosts" section`] };
  for (const line of lines.slice(start + 1)) {
    if (/^##\s/.test(line)) break;
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\||\|\s*$/g, "")
      .split("|")
      .map((c) => c.trim());
    if (cells[0] === "Host" || /^-+$/.test(cells[0])) continue;
    if (cells.length !== COLUMNS.length) {
      faults.push(`row has ${cells.length} columns, expected ${COLUMNS.length}: ${line}`);
      continue;
    }
    const e = Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i]]));
    const where = `row ${JSON.stringify(e.host)}`;
    const empty = COLUMNS.filter((c) => e[c] === "");
    if (empty.length > 0) faults.push(`${where} has an empty column: ${empty.join(", ")}`);
    if (!/^[a-z0-9*.-]+$/i.test(e.host)) faults.push(`${where} is not a host name`);
    if (e.status === "called") {
      if (!["on", "opt-in"].includes(e.default)) faults.push(`${where} is called, so its Default is "on" or "opt-in"`);
      if (!/^https:\/\/\S+$/.test(e.policy)) faults.push(`${where} is called, so its privacy policy is an https:// URL`);
      if (!e.path.startsWith("/")) faults.push(`${where} is called, so its path prefix starts with "/"`);
    } else if (e.status === "declared, not called") {
      if (e.default !== "n/a") faults.push(`${where} is not called, so its Default is "n/a"`);
    } else {
      faults.push(`${where} has Status ${JSON.stringify(e.status)}; expected "called" or "declared, not called"`);
    }
    entries.push(e);
  }
  return { entries, faults };
}

function hostMatches(pattern, host) {
  const body = pattern
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, "i").test(host);
}

function* walk(dir, rel = "") {
  for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel === "" ? d.name : `${rel}/${d.name}`;
    if (d.isDirectory()) {
      if (!SKIPPED_DIRS.has(d.name)) yield* walk(dir, r);
    } else if (d.isFile() && SCANNED.test(d.name) && !LOCKFILE.test(r)) {
      yield r;
    }
  }
}

/** Every refusal for the tree at `root`: allowlist faults, then each undeclared host. */
export function check(root) {
  const file = path.join(root, ALLOWLIST);
  if (!fs.existsSync(file)) return [`${ALLOWLIST} is missing`];
  const { entries, faults } = parseAllowlist(fs.readFileSync(file, "utf8"));
  const problems = [...faults];
  for (const rel of walk(root)) {
    const lines = fs.readFileSync(path.join(root, rel), "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(HOST)) {
        const host = m[0].toLowerCase().replace(/^\.+/, "");
        if (!entries.some((e) => hostMatches(e.host, host))) {
          problems.push(`${rel}:${i + 1} names ${host}, which ${ALLOWLIST} does not declare`);
        }
      }
    });
  }
  return problems;
}

function main() {
  const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".."));
  const problems = check(root);
  for (const p of problems) console.error(`check-hosted-calls: ${p}`);
  if (problems.length > 0) {
    console.error(`check-hosted-calls: ${problems.length} problem(s). Declare the host in ${ALLOWLIST} (ADR 0041).`);
    return 1;
  }
  console.log("check-hosted-calls: every HighKnow host in the code is declared");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
