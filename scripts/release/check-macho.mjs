#!/usr/bin/env node
// Would dyld load every Mach-O a release ships? A misaligned LINKEDIT string table is the hazard
// this was written for: rustc's bundled `rust-objcopy`, at some versions, writes the string table
// straight after the indirect symbol table (4 bytes an entry) with no padding, so an odd entry
// count lands it 4 bytes off. dyld on macOS 27 refuses such a dylib; it let such an executable
// through on macOS 27.2, which is no promise about the next one. A build that passed last time
// proves nothing about this one, because the count moves with the code.
//
//   node scripts/release/check-macho.mjs <path>...
//
// A path that is a file must be a Mach-O. A path that is a directory is walked whole (symbolic
// links are not followed) and each Mach-O found in it is checked, whatever it is called. A `.app`
// must hold all of REQUIRED_IN_APP as well, so a bundle that lost one does not pass by having
// fewer things to check.
//
// TWO CHECKS, BECAUSE THE RUNNER'S TOOL CANNOT SEE THE HAZARD.
//
//   1. `xcrun dyld_info -platform`, whose output is ALLOW-LISTED rather than searched for known
//      errors: a clean report is only per-arch headers, `-platform:`, the column header and
//      platform rows, and any other line is something dyld objected to. Searching for
//      "mis-aligned" would pass the next error dyld invents. The exit status is checked as well,
//      because nothing promises the text and the status stay in step.
//   2. This file's own read of the load commands. Apple's published dyld sources (mach_o/Image.cpp
//      at dyld-1245.1 and dyld-1376.6) give the string table an alignment of 1, so the dyld_info
//      of macos-15's default Xcode has nothing to say about it; only the macOS 27 tool does, and
//      release.yml does not run there. A check that depended on the tool would pass, on the
//      runner, the one thing it exists to stop.
//
// Exit 0: every Mach-O passed both. Exit 1: one did not (each is named, with what was wrong), or the
// paths hold no Mach-O at all, which would otherwise pass by checking nothing. Exit 2: usage.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { filesUnder } from "./check-release-bundle.mjs";

/** What every Flywheel.app carries in Contents/MacOS as a Mach-O (`flywheel-sidecar` is a script). */
export const REQUIRED_IN_APP = ["flywheel-desktop", "flywheel-node", "flywheel-shim"];

const MH_MAGIC_64 = 0xfeedfacf;
const LC_SYMTAB = 0x2;
const LC_DYSYMTAB = 0xb;

/** The Mach-O magics, as the file's first four bytes read big-endian. */
const THIN_MAGICS = new Set([0xfeedface, MH_MAGIC_64, 0xcefaedfe, 0xcffaedfe]);
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
/** A Java class file shares FAT_MAGIC; the word after it is then a version, 45 or above. */
const MAX_FAT_SLICES = 30;

/** Is this file a Mach-O, from its first 8 bytes? Reads no more, because a bundle holds thousands of files. */
export function isMachO(file) {
  const head = Buffer.alloc(8);
  const fd = fs.openSync(file, "r");
  let read;
  try {
    read = fs.readSync(fd, head, 0, 8, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (read < 8) return false;
  const magic = head.readUInt32BE(0);
  if (THIN_MAGICS.has(magic)) return true;
  return (magic === FAT_MAGIC || magic === FAT_MAGIC_64) && head.readUInt32BE(4) <= MAX_FAT_SLICES;
}

/**
 * What `xcrun dyld_info -platform` objected to, from its combined output and exit status, or null
 * if it objected to nothing. The lines allowed are what dyld's other-tools/dyld_info.cpp prints.
 */
export function dyldObjection(output, status) {
  const lines = output.split("\n");
  for (const line of lines) {
    if (line === "") continue;
    if (/^\S.* \[[^\]]+\]:$/.test(line)) continue;
    if (/^\s+-platform:$/.test(line)) continue;
    if (/^\s+platform\s+minOS\s+sdk\s*$/.test(line)) continue;
    if (/^\s+[A-Za-z]+\s+[0-9.]+\s+[0-9.]+\s*$/.test(line)) continue;
    return `dyld_info reports: ${line.trim()}`;
  }
  if (status !== 0) return `dyld_info exited ${status}`;
  if (!lines.some((line) => /^\s+-platform:$/.test(line))) return "dyld_info printed no platform report";
  return null;
}

/** The file offset of each slice: one for a thin Mach-O, one per architecture for a fat one. */
function sliceOffsets(bytes) {
  const magic = bytes.readUInt32BE(0);
  if (magic !== FAT_MAGIC && magic !== FAT_MAGIC_64) return [0];
  const count = bytes.readUInt32BE(4);
  const offsets = [];
  for (let i = 0; i < count; i++) {
    offsets.push(
      magic === FAT_MAGIC
        ? bytes.readUInt32BE(8 + i * 20 + 8)
        : Number(bytes.readBigUInt64BE(8 + i * 32 + 8)),
    );
  }
  return offsets;
}

/**
 * What is misaligned in this Mach-O's LINKEDIT tables, or null. Offsets in a load command count
 * from the slice's start, so each is judged as it stands. 8 is what macOS 27's dyld wants of the
 * string table and of the symbol table, 4 of the indirect symbol table, whose entries are 4 bytes.
 * Anything this cannot read is an objection, not a pass: Flywheel ships only little-endian 64-bit.
 */
export function linkeditObjection(bytes) {
  try {
    for (const slice of sliceOffsets(bytes)) {
      if (bytes.readUInt32LE(slice) !== MH_MAGIC_64) {
        return `the slice at ${slice} is not a little-endian 64-bit Mach-O`;
      }
      const count = bytes.readUInt32LE(slice + 16);
      let cmd = slice + 32;
      for (let i = 0; i < count; i++) {
        const kind = bytes.readUInt32LE(cmd);
        if (kind === LC_SYMTAB) {
          const symoff = bytes.readUInt32LE(cmd + 8);
          const nsyms = bytes.readUInt32LE(cmd + 12);
          const stroff = bytes.readUInt32LE(cmd + 16);
          const strsize = bytes.readUInt32LE(cmd + 20);
          if (nsyms > 0 && symoff % 8 !== 0) return `the symbol table is misaligned, at offset ${symoff}`;
          if (strsize > 0 && stroff % 8 !== 0) return `the string table is misaligned, at offset ${stroff}`;
        } else if (kind === LC_DYSYMTAB) {
          const indirectoff = bytes.readUInt32LE(cmd + 56);
          const nindirect = bytes.readUInt32LE(cmd + 60);
          if (nindirect > 0 && indirectoff % 4 !== 0) {
            return `the indirect symbol table is misaligned, at offset ${indirectoff}`;
          }
        }
        cmd += bytes.readUInt32LE(cmd + 4);
      }
    }
  } catch (err) {
    if (err instanceof RangeError) return "its load commands run past the end of the file";
    throw err;
  }
  return null;
}

/** What is wrong with one Mach-O, or null. */
function objectionTo(file) {
  const fromFile = linkeditObjection(fs.readFileSync(file));
  if (fromFile) return fromFile;
  const r = spawnSync("xcrun", ["dyld_info", "-platform", file], { encoding: "utf8" });
  if (r.error) return `xcrun did not run: ${r.error.message}`;
  return dyldObjection(`${r.stdout}${r.stderr}`, r.status);
}

/** `{ checked, refusals: [{ file, why }] }` over `roots`. See the header for what a root may be. */
export function checkPaths(roots) {
  const refusals = [];
  const machOs = new Set();
  for (const root of roots) {
    if (fs.lstatSync(root).isDirectory()) {
      for (const file of filesUnder(root)) if (isMachO(file)) machOs.add(file);
      if (root.replace(/\/+$/, "").endsWith(".app")) {
        for (const name of REQUIRED_IN_APP) {
          const file = path.join(root, "Contents", "MacOS", name);
          if (!machOs.has(file)) refusals.push({ file, why: "a bundle must carry this as a Mach-O" });
        }
      }
    } else if (fs.lstatSync(root).isFile() && isMachO(root)) {
      machOs.add(root);
    } else {
      refusals.push({ file: root, why: "not a Mach-O" });
    }
  }
  for (const file of machOs) {
    const why = objectionTo(file);
    if (why) refusals.push({ file, why });
  }
  return { checked: machOs.size, refusals };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const roots = process.argv.slice(2);
  if (roots.length === 0) {
    console.error("usage: check-macho.mjs <path>...");
    process.exit(2);
  }
  let result;
  try {
    result = checkPaths(roots);
  } catch (err) {
    console.error(`check-macho: ${err.message}`);
    process.exit(1);
  }
  for (const { file, why } of result.refusals) console.error(`check-macho: ${file}: ${why}`);
  if (result.refusals.length > 0) {
    console.error("check-macho: dyld could refuse this build, so it must not ship");
    process.exit(1);
  }
  if (result.checked === 0) {
    console.error(`check-macho: no Mach-O under ${roots.join(", ")}; nothing was checked`);
    process.exit(1);
  }
  console.log(`check-macho: ${result.checked} Mach-O files, nothing misaligned and nothing dyld_info objects to`);
}
