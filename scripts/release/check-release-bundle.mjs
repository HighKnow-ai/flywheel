#!/usr/bin/env node
// A release build talks to production only (issue #786): it carries no non-production hostname
// and no Environment picker. Both are compiled out (`#[cfg(debug_assertions)]` in the Rust core,
// `import.meta.env.DEV` in the renderer); this is the check that they were, read from the bytes
// that ship rather than from the source that should have produced them.
//
//   node scripts/release/check-release-bundle.mjs <path>...
//
// Each path is a file or a directory, walked whole (symbolic links are not followed). Every file is
// read as bytes, so a Mach-O binary, a JavaScript chunk and a resource are searched alike, for:
//
//   highknow.dev      the zone every non-production Environment lives on;
//   dev_environment   the picker's command names and its settings key, which only the picker has.
//
// TWO PLACES, BECAUSE TAURI COMPRESSES THE RENDERER. A release binary embeds the frontend's files
// brotli-compressed, so a scan of `Flywheel.app` sees the Rust side and the bundled resources but
// not the JavaScript. `npm run build` therefore scans `packages/desktop/dist` (the frontend
// `tauri build` embeds, and every CI run builds), and release.yml scans the built `.app`.
//
// Exit 0: no file holds either string. Exit 1: some file does (each is named), or the paths hold
// no file at all, which would otherwise pass by checking nothing. Exit 2: usage.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** What a release bundle must not contain, and why, as the failure names it. */
export const FORBIDDEN = [
  { needle: "highknow.dev", why: "a non-production Environment's hostname" },
  { needle: "dev_environment", why: "the development builds' Environment picker" },
];

/** Every regular file under `root` (itself, if it is one), in a stable order. */
export function filesUnder(root) {
  const stat = fs.lstatSync(root);
  if (stat.isFile()) return [root];
  if (!stat.isDirectory()) return [];
  return fs
    .readdirSync(root)
    .sort()
    .flatMap((entry) => filesUnder(path.join(root, entry)));
}

/** `[{ file, needle, why }]` for every forbidden string found under `roots`. */
export function scan(roots) {
  const files = roots.flatMap((root) => filesUnder(root));
  const hits = [];
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    for (const { needle, why } of FORBIDDEN) {
      if (bytes.includes(needle)) hits.push({ file, needle, why });
    }
  }
  return { files: files.length, hits };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("usage: check-release-bundle.mjs <path>...");
    process.exit(2);
  }
  let result;
  try {
    result = scan(roots);
  } catch (err) {
    console.error(`check-release-bundle: ${err.message}`);
    process.exit(1);
  }
  if (result.files === 0) {
    console.error(`check-release-bundle: no file under ${roots.join(", ")}; nothing was checked`);
    process.exit(1);
  }
  for (const { file, needle, why } of result.hits) {
    console.error(`check-release-bundle: ${file} contains "${needle}" (${why})`);
  }
  if (result.hits.length > 0) {
    console.error(
      "check-release-bundle: a release build must be locked to production, with no Environment picker (issue #786)",
    );
    process.exit(1);
  }
  console.log(`check-release-bundle: ${result.files} files, no non-production Environment and no picker`);
}
