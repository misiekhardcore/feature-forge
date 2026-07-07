import eslint from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

/**
 * Create a base ESLint flat config for a feature-forge package.
 *
 * @param {string} tsconfigRootDir — package root directory for TypeScript project resolution
 * @param {object} [options]
 * @param {string[]} [options.extraIgnores] — additional ignore patterns for this package
 * @param {string[]} [options.sourceFiles] — glob for source files (default: src/**\/*.ts, e2e/**\/*.ts, scripts/**\/*.ts)
 * @param {string[]} [options.testFiles] — glob for test files (default: src/**\/*.test.ts)
 */
export function createBaseConfig(tsconfigRootDir, options = {}) {
  const {
    extraIgnores = [],
    sourceFiles = ["src/**/*.ts", "e2e/**/*.ts", "scripts/**/*.ts"],
    testFiles = ["src/**/*.test.ts"],
  } = options;

  const configs = [
    eslint.configs.recommended,
    prettier,
    ...tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
          allowDefaultProject: true,
        },
      },
    },
    {
      ignores: [
        "node_modules/",
        "dist/",
        "eslint.config.js",
        ".pi/extensions/index.ts",
        ".turbo/",
        "coverage/",
        "**/coverage/**",
        ...extraIgnores,
      ],
    },
  ];

  if (testFiles.length > 0) {
    configs.push({
      files: testFiles,
      rules: {
        "@typescript-eslint/unbound-method": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-call": "off",
      },
    });
  }

  if (sourceFiles.length > 0) {
    configs.push({
      plugins: {
        "simple-import-sort": simpleImportSort,
        "unused-imports": unusedImports,
      },
      files: sourceFiles,
      rules: {
        "simple-import-sort/imports": "error",
        "simple-import-sort/exports": "error",
        "unused-imports/no-unused-imports": "error",
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unused-expressions": "error",
        "@typescript-eslint/no-unused-vars": [
          "error",
          { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
        ],
      },
    });
  }

  return tseslint.config(...configs);
}
