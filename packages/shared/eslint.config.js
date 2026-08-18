import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    // Root-level config files are outside the tsconfig project (src only),
    // so the project service cannot type-check them - same as cli's tsup.config.ts.
    ignores: ["vitest.config.ts"],
  },
];
