import { defineConfig } from "vitest/config";

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
        "**/node_modules/**",
        "**/dist/**",
        "**/coverage/**",
        "**/*.test.ts",
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
          name: "shared",
          root: "./packages/shared",
          setupFiles: ["src/test-setup.ts"],
          globals: true,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "tui",
          root: "./packages/tui",
          globals: true,
          setupFiles: ["src/test-setup.ts"],
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", "**/e2e/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "cli",
          root: "./packages/cli",
          globals: true,
          include: ["src/**/*.test.ts"],
          setupFiles: ["src/test-setup.ts"],
          exclude: ["node_modules", "**/e2e/**", "**/dist/**"],
        },
      },
      {
        test: {
          name: "cli-e2e",
          root: "./packages/cli",
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
