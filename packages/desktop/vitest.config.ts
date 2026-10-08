import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vitest.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // The real-browser arm (`vitest.browser.config.ts`) owns these. They import `vitest/browser`,
    // which throws outside browser mode, and they measure layout, `color-mix()` resolution and
    // native button activation — none of which jsdom has.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.browser.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // Vitest stubs `.css` imports to an empty module by default (perf optimisation — most tests
    // never need real stylesheet text). `theme/__tests__/contrast.test.ts`'s drift-check assertion
    // is the one test in this workspace that genuinely needs the real, shipped custom-property
    // text (a `?raw` import of `styles/tokens.css`) rather than a stub, so these files alone opt
    // back into real CSS processing. `styles/motion.css` joined in 08.1-13 for the same reason:
    // `theme/__tests__/motion.test.ts` pins its durations, and a stubbed (empty) `?raw` import
    // would make every "declared with this value" assertion vacuous. `App.css` joined in 08.1-14's
    // finish pass: `board/__tests__/selection-rule.test.tsx` pins that the row's focus ring is a
    // :focus-visible rule there, and an empty `?raw` would make that assertion vacuous too.
    // `item-detail/item-detail.css` joined in 08.1-15 for the same reason:
    // `item-detail/__tests__/finish.test.tsx` pins the criteria list's :focus-visible ring.
    // `review/review.css` joined in 08.1-16: `review/__tests__/finish.test.tsx` pins the sheet and action rules.
    // `session/session.css` joined in 08.1-17: `session/__tests__/finish.test.tsx` pins the group's action,
    // card, field and launch-sheet rules, and an empty `?raw` would make every one of them vacuous.
    // `styles/admin-surfaces.css` joined in 08.1-18 for the same reason: `legend/__tests__/legend.test.tsx` and
    // `settings/__tests__/finish.test.tsx` pin the legend's overlay tier and the group's action, choice and row rules.
    css: {
      include: [/styles\/tokens\.css/, /styles\/motion\.css/, /src\/App\.css/, /item-detail\/item-detail\.css/, /review\/review\.css/, /session\/session\.css/, /styles\/admin-surfaces\.css/],
    },
  },
});
