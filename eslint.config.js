import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    // .forge/ is runtime scaffold (skills, flows, agents, config) - not
    // lint-target source. Mirrors .prettierignore.
    ignores: ["packages/", ".forge/"],
  },
];
