import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESKTOP, SRC, text } from "./stylesheets";

/**
 * How the desktop takes HighKnow's design system (ADR 0004 and ADR 0021, both amended 2026-10-27): the published
 * `@highknow/design` package at one exact registry version, with no copied shadcn primitives and no CLI config.
 */

/** One exact version, a pre-release tag allowed: never a range, a git URL or a path. */
const EXACT = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

describe("ADR 0021: the design package", () => {
  it("is pinned to one exact version from the registry", () => {
    const pkg = JSON.parse(text(`${DESKTOP}package.json`)) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@highknow/design"]).toMatch(EXACT);
  });

  it("is not a range, and a pre-release pin is exact", () => {
    expect("1.2.3-rc.1").toMatch(EXACT);
    expect("^1.2.3").not.toMatch(EXACT);
    expect("~1.2.3").not.toMatch(EXACT);
  });

  it("leaves no vendored token export behind", () => {
    expect(existsSync(`${DESKTOP}../../docs/design/highknow-tokens.json`)).toBe(false);
  });
});

describe("ADR 0004: the primitives come from the package", () => {
  it("leaves no shadcn CLI config and no copied primitive in the desktop package", () => {
    expect(existsSync(`${DESKTOP}components.json`)).toBe(false);
    const ui = `${SRC}components/ui`;
    expect(existsSync(ui) ? readdirSync(ui) : []).toEqual([]);
  });
});
