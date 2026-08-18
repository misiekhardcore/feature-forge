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
    await cp("src/flows", "dist/flows", {
      recursive: true,
      filter: (src) => !src.endsWith(".test.ts"),
    });
    await cp("src/skills", "dist/skills", { recursive: true });
    await cp("scripts", "dist/scripts", { recursive: true });
    await cp(
      "../core/src/config/forge-config.defaults.json",
      "dist/scripts/forge-config.defaults.json",
    );
  },
});
