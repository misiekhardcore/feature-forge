import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    ignores: ["bin/forge.js", "scripts/forge-setup.js", "tsup.config.ts"],
  },
];
