import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    // Layering contract (ADR 0020): core is the engine + platform layer and
    // must never import the cli package or the pi-TUI SDK - not in src, and
    // not in scripts (flow validation tooling). Test files are exempt: a
    // handful of core tests still construct cli production classes (flow
    // routine tools and session tools, which stay in cli per D3) as
    // fixtures. The rule enforces the production graph.
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@feature-forge/cli"],
              message: "core must not import the cli package (ADR 0020 layering).",
            },
            {
              group: ["@earendil-works/pi-tui"],
              message: "core must not import pi-tui (ADR 0020 / D4: pi agent SDKs only).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    rules: {
      "no-restricted-imports": "off",
    },
  },
];
