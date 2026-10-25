import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DARK, LIGHT, MOTION } from "../tokens";

/**
 * Flywheel takes HighKnow's tokens where they fit (issue #196, ADR 0021). The source of truth is HighKnow's
 * `packages/config/tokens.json`, vendored at `docs/design/highknow-tokens.json` with the commit it was copied
 * from. This file asserts each Flywheel variable that borrows a HighKnow token holds that token's exact value,
 * so a re-copy that moves a HighKnow value fails here until globals.css follows it (or the deviation is
 * recorded in direction.md and this table).
 *
 * Kept as Flywheel's own and deliberately absent below: safety yellow (`--attention`), graphite (`--strip`),
 * the lamps, the Diff Tints (ADR 0011), the grounds and `--subtle-foreground`.
 */

const SRC = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/\/theme\/__tests__\/[^/]+$/, "/");
const DESKTOP = SRC.replace(/\/src\/$/, "/");
const REPO = DESKTOP.replace(/\/packages\/desktop\/$/, "/");
const text = (path: string): string => new TextDecoder().decode(readFileSync(path));

const GLOBALS = text(SRC + "styles/globals.css");
const VENDORED = JSON.parse(text(REPO + "docs/design/highknow-tokens.json")) as {
  $vendored: { repo: string; path: string; commit: string };
  tokens: Record<string, string>;
};
const HK = VENDORED.tokens;

function block(selector: string): Record<string, string> {
  const start = GLOBALS.search(new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m"));
  expect(start, `globals.css has a top-level ${selector} block`).toBeGreaterThanOrEqual(0);
  const body = GLOBALS.slice(start, GLOBALS.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

const ROOT = block(":root");
const DARK_BLOCK = block(".dark");

/** HighKnow token -> the Flywheel variables that carry it, per scheme. */
const LIGHT_MAP: Record<string, string[]> = {
  "color-ink": [
    "--foreground",
    "--card-foreground",
    "--popover-foreground",
    "--secondary-foreground",
    "--accent-foreground",
    "--sidebar-foreground",
    "--sidebar-primary-foreground",
    "--sidebar-accent-foreground",
    "--chart-1",
  ],
  "color-ink-soft": ["--muted-foreground"],
  "color-rule": ["--sidebar-border"],
  "color-rule-strong": ["--border"],
  "color-rule-control": ["--input"],
  "color-brand": ["--primary", "--ring", "--sidebar-ring", "--chart-3"],
  "color-brand-ink": ["--running"],
  "color-brand-wash": ["--running-muted"],
  "color-brand-hair": ["--running-border"],
  "color-error": ["--destructive", "--destructive-text"],
};

const DARK_MAP: Record<string, string[]> = {
  "color-brand": ["--primary", "--chart-3"],
  "color-brand-lift": ["--running", "--ring", "--sidebar-ring"],
  "color-companion-dark-error": ["--destructive-text"],
  "color-error": ["--destructive"],
};

describe("the vendored HighKnow tokens", () => {
  it("name their source repository, file and commit", () => {
    expect(VENDORED.$vendored.repo).toMatch(/highknow-mvp/);
    expect(VENDORED.$vendored.path).toBe("packages/config/tokens.json");
    expect(VENDORED.$vendored.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("carry every token this file maps", () => {
    for (const token of [...Object.keys(LIGHT_MAP), ...Object.keys(DARK_MAP), "font-sans", "ease-out-quint"]) {
      expect(HK[token], token).toBeDefined();
    }
  });
});

describe.each([
  ["light", ROOT, LIGHT_MAP],
  ["dark", DARK_BLOCK, DARK_MAP],
] as const)("%s: globals.css holds HighKnow's values", (_mode, declared, map) => {
  for (const [token, vars] of Object.entries(map)) {
    it.each(vars)(`${token} -> %s`, (name) => {
      expect(declared[name], `${name} carries ${token}`).toBe(HK[token]);
    });
  }
});

describe("theme/tokens.ts mirrors the borrowed values", () => {
  it("the light ink, brand text and error", () => {
    expect(LIGHT.foreground).toBe(HK["color-ink"]);
    expect(LIGHT.running).toBe(HK["color-brand-ink"]);
    expect(LIGHT.destructive).toBe(HK["color-error"]);
    expect(LIGHT.runningBorder).toBe(HK["color-brand-hair"]);
  });

  it("the dark lift and error text", () => {
    expect(DARK.running).toBe(HK["color-brand-lift"]);
    expect(DARK.ring).toBe(HK["color-brand-lift"]);
    expect(DARK.destructiveText).toBe(HK["color-companion-dark-error"]);
  });
});

describe("motion", () => {
  it("declares HighKnow's ease-out-quint as the shared easing token, and --ease is it", () => {
    expect(ROOT["--ease-out-quint"]).toBe(HK["ease-out-quint"]);
    expect(MOTION.easeOutQuint).toBe(HK["ease-out-quint"]);
    expect(ROOT["--ease"]).toBe("var(--ease-out-quint)");
  });
});

describe("the face: Public Sans, self-hosted, with tabular numerals", () => {
  it("is the UI family, with HighKnow's exact stack, and the condensed role uses it too", () => {
    expect(ROOT["--font-ui"]).toBe(HK["font-sans"]);
    expect(ROOT["--font-ui-condensed"]).toBe("var(--font-ui)");
  });

  it("is imported from the self-hosted @fontsource-variable package, and Barlow is gone", () => {
    expect(GLOBALS).toMatch(/@import "@fontsource-variable\/public-sans\/wght\.css";/);
    expect(GLOBALS).toMatch(/@import "@fontsource-variable\/public-sans\/wght-italic\.css";/);
    expect(GLOBALS).not.toMatch(/barlow/i);
    const pkg = JSON.parse(text(DESKTOP + "package.json")) as { dependencies: Record<string, string> };
    expect(pkg.dependencies["@fontsource-variable/public-sans"]).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(pkg.dependencies).filter((d) => /barlow/.test(d))).toEqual([]);
  });

  it("ships a tabular-figures (tnum) feature in the latin file the app loads", () => {
    const file = readFileSync(DESKTOP + "node_modules/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2");
    expect(woff2Tables(file)).toContain("GSUB");
    expect(woff2Sfnt(file).includes("tnum"), "the GSUB feature list names tnum").toBe(true);
  });

  it("turns tabular numerals on for the shared utility, and counts and times use it", () => {
    expect(GLOBALS).toMatch(/\.tabular-nums \{\s*font-variant-numeric: tabular-nums lining-nums;/);
    for (const file of ["board/MilestoneHeader.tsx", "board/EpicProgress.tsx", "shell/AndonStrip.tsx", "session/FeedRow.tsx", "projects/ProjectRail.tsx"]) {
      expect(text(SRC + file), `${file} sets its counts or times in tabular figures`).toMatch(/tabular-nums/);
    }
  });
});

// --- A minimal WOFF2 reader: enough to list the tables and decompress the font data (W3C WOFF2 §4-5). ---

/** The spec's known-table index (§5.1): a table's flags byte names its tag by position here. */
const KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ",
  "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS",
  "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc",
  "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
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
