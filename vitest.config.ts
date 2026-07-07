import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          root: "./packages/shared",
          globals: true,
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "cli",
          root: "./packages/cli",
          globals: true,
          include: ["src/**/*.test.ts"],
          exclude: ["node_modules", "**/e2e/**", "**/dist/**"],
          coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/index.ts", "src/**/index.ts", "src/test-utils.ts"],
            reporter: ["text", "text-summary"],
            thresholds: {
              lines: 90,
              functions: 90,
              branches: 90,
              statements: 90,
            },
          },
        },
      },
      {
        test: {
          name: "cli-e2e",
          root: "./packages/cli",
          globals: true,
          include: ["e2e/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 15_000,
        },
      },
    ],
  },
});
