import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ARMS, armCommands } from "./run-browser-arms.mjs";

const DESKTOP = resolve(import.meta.dirname, "..");
/** @type {Record<string, string>} */
const scripts = JSON.parse(readFileSync(resolve(DESKTOP, "package.json"), "utf8")).scripts;
const ci = readFileSync(resolve(DESKTOP, "../../.github/workflows/ci.yml"), "utf8");

describe("the browser arms run side by side", () => {
  it("runs every npm script that runs a browser arm, and only those", () => {
    const vitestBrowserScripts = Object.keys(scripts)
      .filter((name) => /^test:(browser|layout-defects)/.test(name) && /vitest run/.test(scripts[name]))
      .sort();
    expect(ARMS.map((arm) => arm.script).sort()).toEqual(vitestBrowserScripts);
  });

  it("gives each arm a Vitest cache folder of its own", () => {
    const caches = armCommands("/desktop").map((c) => c.env.FLYWHEEL_VITE_CACHE_DIR);
    expect(new Set(caches).size).toBe(ARMS.length);
    for (const cache of caches) expect(cache).toMatch(/^\/desktop\/node_modules\/\.vite-arms\/[a-z-]+$/);
  });

  it("is what CI runs, and CI no longer runs an arm by hand", () => {
    expect(ci.split("npm --prefix packages/desktop run test:browser:arms").length - 1).toBe(1);
    for (const arm of ARMS) expect(ci).not.toContain(`npm --prefix packages/desktop run ${arm.script}\n`);
  });

  it("starts the longest arm first", () => {
    expect(ARMS[0].script).toBe("test:layout-defects");
  });
});
