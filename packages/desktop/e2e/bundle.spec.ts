/**
 * The e2e WebSocket transport must not ship. Two real Vite builds of the renderer: one as released,
 * which must hold no trace of the transport, and one with the harness flag, which must hold it, so
 * the first result cannot be vacuous. `npm run build` runs the same scan on every build.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
// @ts-expect-error the release check is plain JavaScript
import { scan } from "../../../scripts/release/check-release-bundle.mjs";

const MARKER = "flywheel-e2e-ws-transport";

async function bundle(flag: string | undefined): Promise<{ files: number; marked: string[] }> {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-e2e-bundle-"));
  const before = process.env.VITE_FLYWHEEL_E2E;
  if (flag === undefined) delete process.env.VITE_FLYWHEEL_E2E;
  else process.env.VITE_FLYWHEEL_E2E = flag;
  try {
    await build({
      configFile: path.resolve(import.meta.dirname, "..", "vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });
    const { files, hits } = scan([outDir]) as { files: number; hits: { needle: string; file: string }[] };
    return { files, marked: hits.filter((h) => h.needle === MARKER).map((h) => path.basename(h.file)) };
  } finally {
    if (before === undefined) delete process.env.VITE_FLYWHEEL_E2E;
    else process.env.VITE_FLYWHEEL_E2E = before;
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

test("a release bundle has no WebSocket transport, and a harness bundle has", async () => {
  test.setTimeout(240_000);
  const released = await bundle(undefined);
  expect(released.files).toBeGreaterThan(0);
  expect(released.marked).toEqual([]);

  const harness = await bundle("1");
  expect(harness.marked.length).toBeGreaterThan(0);
});
