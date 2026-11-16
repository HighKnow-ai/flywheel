import fs from "node:fs";

/**
 * Why `file` cannot be run as a built binary, or `undefined` when it can: a missing, empty or
 * non-executable file. An EMPTY file is the stand-in the `rust` job `touch`es at
 * `packages/desktop/src-tauri/binaries/flywheel-*-<triple>` so `tauri_build` finds its
 * `externalBin` files, and `tauri_build` copies it over `target/<profile>/flywheel-shim` too. On a
 * runner that keeps its workspace, `existsSync` is true for it and spawning it fails with ENOEXEC
 * or EACCES, which hid the real cause in gate runs on #1665 and #1666.
 */
export function unusableReason(file, { needsExecBit = true } = {}) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return "missing";
  }
  if (!stat.isFile()) return "not a file";
  if (stat.size === 0) return "empty (a build stand-in, not a built binary)";
  if (needsExecBit && process.platform !== "win32" && (stat.mode & 0o111) === 0) {
    return "not executable";
  }
  return undefined;
}
