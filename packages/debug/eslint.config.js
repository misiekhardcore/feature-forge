import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@feature-forge/cli"],
              message: "debug must not import the cli package (ADR 0020 layering).",
            },
          ],
        },
      ],
    },
  },
];
