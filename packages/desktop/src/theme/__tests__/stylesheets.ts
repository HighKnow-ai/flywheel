import { readFileSync } from "node:fs";
import { expect } from "vitest";

/**
 * The stylesheets the theme tests read, as text. Flywheel's colours live in two files since it took the
 * published design system (ADR 0021, amendment of 2026-10-27): the shared roles in the installed
 * `@highknow/design` `theme.css`, at the exact version package.json pins, and Flywheel's own roles in
 * `styles/globals.css`. A test that asserts a role reads both, through {@link declared}.
 */

export const SRC = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(
  /\/theme\/__tests__\/[^/]+$/,
  "/",
);
export const DESKTOP = SRC.replace(/\/src\/$/, "/");
export const DESIGN = DESKTOP + "node_modules/@highknow/design/";

export const text = (path: string): string => new TextDecoder().decode(readFileSync(path));

export const GLOBALS = text(SRC + "styles/globals.css");
export const THEME = text(DESIGN + "css/theme.css");
export const BASE = text(DESIGN + "css/base.css");
export const FONTS = text(DESIGN + "css/fonts.css");

/** The custom properties one top-level block declares (`:root` or `.dark`), as name -> value. */
export function block(css: string, selector: string, file: string): Record<string, string> {
  const start = css.search(new RegExp(`^${selector.replace(".", "\\.")} \\{`, "m"));
  expect(start, `${file} has a top-level ${selector} block`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].replace(/\s+/g, " ").trim()]),
  );
}

/** One scheme's blocks: the package's, Flywheel's, and both together (Flywheel's after, as the cascade has it). */
export function declared(selector: ":root" | ".dark") {
  const base = block(THEME, selector, "@highknow/design/css/theme.css");
  const own = block(GLOBALS, selector, "styles/globals.css");
  return { base, own, all: { ...base, ...own } };
}
