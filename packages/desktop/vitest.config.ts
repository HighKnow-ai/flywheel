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
  },
});
