import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    ignores: [
      "bin/forge.js",
      "scripts/forge-setup.js",
      "scripts/test-worktree-registry-live.mjs",
      "tsup.config.ts",
    ],
  },
];
