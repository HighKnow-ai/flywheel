import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vitest.dev/config/
export default defineConfig({
  plugins: [react()],
  // The `@/` import alias shadcn/ui's generated components use (ADR 0004); `vite.config.ts` declares the same.
  resolve: { alias: { "@": decodeURIComponent(new URL("./src", import.meta.url).pathname) } },
  test: {
    environment: "jsdom",
    // The real-browser arm (`vitest.browser.config.ts`) owns these. They import `vitest/browser`,
    // which throws outside browser mode, and they measure layout, `color-mix()` resolution and
    // native button activation — none of which jsdom has.
    exclude: ["**/node_modules/**", "**/dist/**", "src/**/*.browser.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
    // Above the 5 s a Testing Library wait may take (src/test/setup.ts), so a slow wait fails as that wait,
    // naming what it waited for, rather than as an anonymous test timeout.
    testTimeout: 15000,
  },
});
