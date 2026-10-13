// Rebuilds the three comps from comp-data.json, then screenshots each in light and dark through the
// project's own Playwright WebKit build (the closest engine to the macOS WKWebView that ships).
// Output: .impeccable/review/<comp>-<scheme>.png at 1440x900 viewport, full page. Prints one path per line.
//
//   node .planning/phases/08.1-.../comps/render-comps.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildAll } from "./build-comps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../..");
// Playwright is a dev dependency of packages/desktop, not of the repo root.
const { webkit } = createRequire(join(ROOT, "packages/desktop/package.json"))("playwright");

const OUT = join(ROOT, ".impeccable/review");
mkdirSync(OUT, { recursive: true });

const comps = buildAll().map((f) => f.replace(/\.html$/, ""));
const browser = await webkit.launch();
const paths = [];
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2 });
    for (const name of comps) {
      const page = await ctx.newPage();
      await page.goto(pathToFileURL(join(HERE, `${name}.html`)).href);
      await page.evaluate(() => document.fonts.ready);
      const facts = await page.evaluate(() => ({
        font: document.fonts.check('13px "Archivo Variable"'),
        bg: getComputedStyle(document.body).backgroundColor,
        epicRows: document.querySelectorAll("[data-epic-row]").length,
        logo: [...document.images].every((i) => i.complete && i.naturalWidth > 0),
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      if (!facts.font) throw new Error(`${name} ${scheme}: Archivo did not load`);
      if (!facts.logo) throw new Error(`${name} ${scheme}: the brand mark did not load`);
      console.error(`${name} ${scheme}: bg=${facts.bg} epicRows=${facts.epicRows} overflowX=${facts.overflowX}`);
      const file = join(OUT, `${name}-${scheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      paths.push(file);
      await page.close();
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
for (const p of paths) console.log(p);
