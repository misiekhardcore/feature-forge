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
