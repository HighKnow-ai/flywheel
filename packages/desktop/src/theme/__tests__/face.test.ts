import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { MOTION } from "../tokens";
import { DESKTOP, FONTS, GLOBALS, SRC, declared, text } from "./stylesheets";

/**
 * The face and the curve Flywheel shares with HighKnow (ADR 0021). Until 2026-10-27 this file held a vendored
 * copy of HighKnow's token export equal to globals.css; the published `@highknow/design` package replaced that
 * loop (ADR 0021, amendment of 2026-10-27), so what is left to assert is what Flywheel relies on the package
 * for: Public Sans as the one UI family, self-hosted, with tabular figures, and HighKnow's ease-out-quint.
 */

const ROOT = declared(":root").all;

describe("motion", () => {
  it("is HighKnow's ease-out-quint, the shared easing token, and --ease is it", () => {
    expect(ROOT["--ease-out-quint"]).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(MOTION.easeOutQuint).toBe(ROOT["--ease-out-quint"]);
    expect(ROOT["--ease"]).toBe("var(--ease-out-quint)");
  });
});

describe("the face: Public Sans, self-hosted, with tabular numerals", () => {
  it("is the UI family, and the condensed role uses it too", () => {
    expect(ROOT["--font-ui"]).toMatch(/^"Public Sans Variable", /);
    expect(ROOT["--font-ui-condensed"]).toBe("var(--font-ui)");
  });

  it("is self-hosted through the design system's fonts, and Barlow is gone", () => {
    expect(GLOBALS).toMatch(/@import "@highknow\/design\/fonts\.css";/);
    expect(FONTS).toMatch(/@import "@fontsource-variable\/public-sans\/wght\.css";/);
    expect(FONTS).toMatch(/@import "@fontsource-variable\/public-sans\/wght-italic\.css";/);
    expect(GLOBALS).not.toMatch(/barlow/i);
    const pkg = JSON.parse(text(DESKTOP + "package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@highknow/design"], "an exact pin, never a range").toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(pkg.dependencies).filter((d) => /barlow/.test(d))).toEqual([]);
  });

  it("ships a tabular-figures (tnum) feature in the latin file the app loads", () => {
    const file = readFileSync(
      DESKTOP + "node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2",
    );
    expect(woff2Tables(file)).toContain("GSUB");
    expect(woff2Sfnt(file).includes("tnum"), "the GSUB feature list names tnum").toBe(true);
  });

  it("turns tabular numerals on for the shared utility, and counts and times use it", () => {
    expect(GLOBALS).toMatch(/\.tabular-nums \{\s*font-variant-numeric: tabular-nums lining-nums;/);
    for (const file of [
      "board/MilestoneHeader.tsx",
      "board/EpicProgress.tsx",
      "shell/AndonStrip.tsx",
      "session/FeedRow.tsx",
      "projects/ProjectRail.tsx",
    ]) {
      expect(text(SRC + file), `${file} sets its counts or times in tabular figures`).toMatch(/tabular-nums/);
    }
  });
});

// --- A minimal WOFF2 reader: enough to list the tables and decompress the font data (W3C WOFF2 §4-5). ---

/** The spec's known-table index (§5.1): a table's flags byte names its tag by position here. */
const KNOWN_TAGS = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
];

const latin1 = (bytes: Uint8Array): string => String.fromCharCode(...bytes);

function woff2Directory(buf: Uint8Array): { tags: string[]; dataStart: number; compressedSize: number } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  expect(latin1(buf.subarray(0, 4))).toBe("wOF2");
  const numTables = view.getUint16(12);
  const compressedSize = view.getUint32(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i += 1) {
      const byte = buf[at++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("bad UIntBase128");
  };
  const tags: string[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = buf[at++];
    const index = flags & 0x3f;
    const tag = index === 63 ? latin1(buf.subarray(at, (at += 4))) : KNOWN_TAGS[index];
    const transform = flags >> 6;
    base128();
    const transformed = tag === "glyf" || tag === "loca" ? transform !== 3 : transform !== 0;
    if (transformed) base128();
    tags.push(tag);
  }
  return { tags, dataStart: at, compressedSize };
}

const woff2Tables = (buf: Uint8Array): string[] => woff2Directory(buf).tags;

/** The decompressed font data, as latin1 text so a 4-byte tag can be searched for. */
function woff2Sfnt(buf: Uint8Array): string {
  const { dataStart, compressedSize } = woff2Directory(buf);
  return new TextDecoder("latin1").decode(brotliDecompressSync(buf.subarray(dataStart, dataStart + compressedSize)));
}
