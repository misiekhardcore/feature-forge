import { createBaseConfig } from "./eslint.base.config.js";

export default createBaseConfig(import.meta.dirname, {
  sourceFiles: ["*.ts", "*.js", "*.mjs"],
  testFiles: [],
  extraIgnores: ["packages/"],
});
