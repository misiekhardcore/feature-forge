import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    // Layering contract (ADR 0020): core is the engine + platform layer and
    // must never import the cli package or the pi-TUI SDK - not in src, and
    // not in scripts (flow validation tooling). Test files are exempt: core's
    // unit tests legitimately use cli's test-utils (documented ADR 0019
    // interim; the 31 test-file imports self-heal when test-utils moves). The
    // rule enforces the production graph.
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
