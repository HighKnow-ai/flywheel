import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import tauriConf from "../../../src-tauri/tauri.conf.json";
import { present } from "../../test/present";

/**
 * SC1 / SC2 / D-22 by assertion, not by eye. Like contrast.test.ts this reads the artifacts the
 * bundle really ships (`bundle.icon` in tauri.conf.json), so a regenerated-but-wrong set, or a
 * regression to the `create-tauri-app` scaffold, fails here.
 */
const SRC_TAURI = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(
  /\/src\/theme\/__tests__\/[^/]+$/,
  "/src-tauri/",
);
const read = (rel: string): Uint8Array => readFileSync(SRC_TAURI + rel);

/** `git hash-object` for a blob, without shelling out: sha1("blob <len>\0" + bytes). */
function gitBlobHash(bytes: Uint8Array): string {
  const head = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const whole = new Uint8Array(head.length + bytes.length);
  whole.set(head);
  whole.set(bytes, head.length);
  return createHash("sha1").update(whole).digest("hex");
}

/** First 8 hex of the blob each file was in the create-tauri-app scaffold (commit 286a403). */
const SCAFFOLD_BLOB: Record<string, string> = {
  "icons/32x32.png": "9c0ad672",
  "icons/128x128.png": "24045aa1",
  "icons/128x128@2x.png": "4a537e15",
  "icons/icon.icns": "12a5bcee",
  "icons/icon.ico": "06c23c82",
};

const EXPECTED_SIZE: Record<string, number> = {
  "icons/32x32.png": 32,
  "icons/128x128.png": 128,
  "icons/128x128@2x.png": 256,
};

/** A big-endian u32 at `at`; a read past the end throws (DataView's RangeError) rather than reading 0. */
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at);

/** The byte at `at`; a read past the end throws, so a truncated file fails here rather than reading NaN on. */
const byte = (b: Uint8Array, at: number): number => {
  const value = b[at];
  if (value === undefined) throw new Error(`no byte at ${at} (length ${b.length})`);
  return value;
};

/** A PNG chunk's four-letter type, at `at + 4`. */
const chunkType = (b: Uint8Array, at: number): string => String.fromCharCode(...b.subarray(at + 4, at + 8));

/** PNG filter types 0 to 4 (None, Sub, Up, Average, Paeth) undone for one byte. */
function unfilter(filter: number, x: number, a: number, up: number, c: number): number {
  switch (filter) {
    case 0:
      return x;
    case 1:
      return x + a;
    case 2:
      return x + up;
    case 3:
      return x + ((a + up) >> 1);
    case 4: {
      const pp = a + up - c;
      const [pa, pb, pc] = [Math.abs(pp - a), Math.abs(pp - up), Math.abs(pp - c)];
      return x + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c);
    }
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

const icons = tauriConf.bundle.icon;

describe("bundle.icon artifacts", () => {
  it("lists exactly the five artifacts the scaffold-guard knows about", () => {
    expect([...icons].sort()).toEqual(Object.keys(SCAFFOLD_BLOB).sort());
  });

  it.each(icons)("%s exists and is not the scaffold blob", (rel) => {
    const bytes = read(rel);
    expect(bytes.length).toBeGreaterThan(0);
    expect(gitBlobHash(bytes).slice(0, 8)).not.toBe(SCAFFOLD_BLOB[rel]);
  });

  it.each(icons.filter((r) => r.endsWith(".png")))("%s is an RGBA PNG of the dimensions its filename claims", (rel) => {
    const b = read(rel);
    expect(Array.from(b.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]); // "PNG"
    const size = present(EXPECTED_SIZE[rel], `an expected size for ${rel}`);
    expect(u32(b, 16)).toBe(size);
    expect(u32(b, 20)).toBe(size);
    expect(b[24]).toBe(8); // bit depth
    expect(b[25]).toBe(6); // colour type 6 = RGBA
  });

  it("icon.icns carries the icns magic", () => {
    expect(new TextDecoder().decode(read("icons/icon.icns").slice(0, 4))).toBe("icns");
  });

  it("icon.ico carries the ICO header", () => {
    expect(Array.from(read("icons/icon.ico").slice(0, 4))).toEqual([0, 0, 1, 0]);
  });

  it("32x32.png has a transparent corner pixel: the mark is inset, not bled to the edge (D-22)", () => {
    const b = read("icons/32x32.png");
    // Gather IDAT chunks, inflate, and read the first scanline's first pixel. The row above and the
    // pixel to the left are both zero, so every PNG filter type (0-4) reduces to the raw byte.
    const idat: Uint8Array[] = [];
    for (let at = 8; at < b.length;) {
      const len = u32(b, at);
      if (chunkType(b, at) === "IDAT") idat.push(b.slice(at + 8, at + 8 + len));
      at += 12 + len;
    }
    const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    idat.reduce((off, c) => (joined.set(c, off), off + c.length), 0);
    const raw = inflateSync(joined);
    // raw[0] is the filter byte; raw[1..4] is the first pixel's R, G, B, A.
    expect(raw[4]).toBe(0);
  });

  // The 824-of-1024 margin is a recorded assumption (RESEARCH A1: "the commonly cited macOS icon
  // grid"). What a machine CAN check is that the shipped raster really has that geometry; whether
  // it sits well beside other Dock icons is the human half (DEFERRED-REVIEW, 08.1-20).
  it("icon.png's opaque artwork spans 824 of 1024 of the canvas (the recorded margin)", () => {
    const b = read("icons/icon.png");
    const width = u32(b, 16);
    const height = u32(b, 20);
    expect([b[24], b[25]]).toEqual([8, 6]); // 8-bit RGBA, so four bytes per pixel below
    const idat: Uint8Array[] = [];
    for (let at = 8; at < b.length;) {
      const len = u32(b, at);
      if (chunkType(b, at) === "IDAT") {
        idat.push(b.slice(at + 8, at + 8 + len));
      }
      at += 12 + len;
    }
    const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
    idat.reduce((off, c) => (joined.set(c, off), off + c.length), 0);
    const raw = inflateSync(joined);
    const stride = width * 4;
    const prev = new Uint8Array(stride);
    const row = new Uint8Array(stride);
    let [minX, maxX, minY, maxY] = [width, -1, height, -1];
    for (let y = 0; y < height; y++) {
      const at = y * (stride + 1);
      const filter = byte(raw, at);
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? byte(row, i - 4) : 0;
        const c = i >= 4 ? byte(prev, i - 4) : 0;
        row[i] = unfilter(filter, byte(raw, at + 1 + i), a, byte(prev, i), c) & 255;
      }
      for (let px = 0; px < width; px++) {
        if (byte(row, px * 4 + 3) > 128) {
          minX = Math.min(minX, px);
          maxX = Math.max(maxX, px);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
      prev.set(row);
    }
    const expected = (824 / 1024) * width;
    // A rounded square: the bounding box is the artwork. Two pixels of slack for anti-aliasing.
    expect(maxX - minX + 1).toBeGreaterThanOrEqual(expected - 2);
    expect(maxX - minX + 1).toBeLessThanOrEqual(expected + 2);
    expect(maxY - minY + 1).toBeGreaterThanOrEqual(expected - 2);
    expect(maxY - minY + 1).toBeLessThanOrEqual(expected + 2);
    // Centred: equal margin either side.
    expect(Math.abs(minX - (width - 1 - maxX))).toBeLessThanOrEqual(2);
    expect(Math.abs(minY - (height - 1 - maxY))).toBeLessThanOrEqual(2);
  });
});
