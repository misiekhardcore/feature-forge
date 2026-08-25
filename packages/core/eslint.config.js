import { baseConfig } from "@feature-forge/eslint-config";

export default [
  ...baseConfig,
  {
    // Layering contract (ADR 0020): core is the engine + platform layer and
    // must never import the cli package or the pi-TUI SDK - not in src, and
    // not in scripts (flow validation tooling). The rule covers test files
    // too: the flow routine tools and session tools, which stay cli-owned,
    // are exercised through local stubs in core tests, so no exemption is
    // needed.
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
];
