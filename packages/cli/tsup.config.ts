import { cp } from "node:fs/promises";

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "node",
  noExternal: [/@feature-forge/],
  external: [
    "@earendil-works/pi-ai",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-tui",
    "typebox",
  ],
  async onSuccess() {
    await cp("../core/src/agents/specifications/templates", "dist/agents/declarative-specs", {
      recursive: true,
    });
    // Flow definitions + schema are core-owned since S4f; copy from core to
    // preserve the published dist/flows layout (implement, review, verify,
    // resolve-pr-feedback, flow-schema.json).
    await cp("../core/src/flows/definitions", "dist/flows", {
      recursive: true,
      filter: (src) => !src.endsWith(".test.ts"),
    });
    await cp("../core/src/flows/flow-schema.json", "dist/flows/flow-schema.json");
    await cp("../core/src/skills", "dist/skills", { recursive: true });
    await cp("scripts", "dist/scripts", { recursive: true });
    // Flow scripts moved to core in S8; keep the published dist/scripts layout
    // (validate-flow was previously shipped from cli/scripts).
    await cp("../core/scripts", "dist/scripts", { recursive: true });
    await cp(
      "../core/src/config/forge-config.defaults.json",
      "dist/scripts/forge-config.defaults.json",
    );
  },
});
