import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Package-local vitest config: lets `npm run test` inside packages/shared
// run only this package's tests. Config discovery walks up from the cwd,
// so this file wins when invoked from the package dir, while the root
// vitest.config.ts remains the source for full-workspace runs.
export default defineConfig({
  test: {
    // Anchor the root at this config file so discovery works from any cwd.
    root: fileURLToPath(new URL(".", import.meta.url)),
    setupFiles: ["src/test-setup.ts"],
    globals: true,
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "**/e2e/**", "**/dist/**"],
  },
});
