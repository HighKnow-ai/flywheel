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
    // text (a `?raw` import of `styles/tokens.css`) rather than a stub, so this file alone opts
    // back into real CSS processing.
    css: {
      include: [/styles\/tokens\.css/],
    },
  },
});
