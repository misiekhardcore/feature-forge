import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    ignores: ["packages/"],
  },
];
