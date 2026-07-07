import eslint from "@eslint/js";
import prettier from "eslint-plugin-prettier/recommended";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  prettier,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
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
    ],
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
    },
  },
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
    },
    files: ["src/**/*.ts", "e2e/**/*.ts", "scripts/**/*.ts"],
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
  },
);
