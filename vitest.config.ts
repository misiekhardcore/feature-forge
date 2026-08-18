import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// vitest resolves inline project `root` paths against the working directory
// (vitest-dev/vitest#6855), but npm runs lifecycle scripts with the package
// as cwd. Anchor the roots at this config file so discovery works from any cwd.
const packageRoot = (name: string) => fileURLToPath(new URL(`./packages/${name}`, import.meta.url));

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
      // Test-support files are excluded from the global threshold: they are
      // harness code (not shipped surface) and their low ratios would drag
      // the gate below 90% without adding signal.
      exclude: [
        // A custom exclude list OVERRIDES Vitest's defaults, so test files
        // must be listed explicitly or they get swept into coverage.
        "**/*.test.ts",
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/test-setup.ts",
        "**/test-utils.ts",
        "**/e2e/**",

        // The debug package has no vitest project — its scenario helpers are
        // test-support only and would drag the gate down with no signal.
        "**/packages/debug/**",
      ],
    },
    projects: [
      {
        test: {
          name: "core",
          root: packageRoot("core"),
          setupFiles: ["src/test-setup.ts"],
          globals: true,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "tui",
          root: packageRoot("tui"),
          globals: true,
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", "**/e2e/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "cli",
          root: packageRoot("cli"),
          globals: true,
          include: ["src/**/*.test.ts"],
          setupFiles: ["src/test-setup.ts"],
          exclude: ["node_modules", "**/e2e/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "cli-e2e",
          root: packageRoot("cli"),
          globals: true,
          include: ["e2e/**/*.test.ts"],
          setupFiles: ["src/test-setup.ts"],
          testTimeout: 30_000,
          hookTimeout: 15_000,
        },
      },
    ],
  },
});
