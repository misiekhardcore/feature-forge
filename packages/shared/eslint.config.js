import { createBaseConfig } from "../../eslint.base.config.js";

export default createBaseConfig(import.meta.dirname, {
  sourceFiles: ["src/**/*.ts"],
  testFiles: ["src/**/*.test.ts"],
});
