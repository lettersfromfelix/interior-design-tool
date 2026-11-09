import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Layer rules (see README "Architecture"):
 * - nothing in src/ imports data, catalogue or layout files — they are loaded at runtime through the file API;
 * - src/core is pure TypeScript (no Three.js, React, DOM state, or upper layers);
 * - src/engine does not import React or the UI.
 */
const noDataImports = [
  { regex: "\\.json$", message: "Data files are loaded at runtime through the file API (src/data). Never import JSON in src/." },
  { regex: "(^|/)(catalogue|layouts)(/|$)", message: "Catalogue and layout files are loaded at runtime. Never import them." },
];

export default defineConfig(
  { ignores: ["dist/**", "node_modules/**", "schemas/**", "reference/**", "tools/floorplan/**", "data/**", "catalogue/**", "layouts/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": ["error", { patterns: noDataImports }],
    },
  },
  {
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...noDataImports,
            { regex: "^(three|react|react-dom|zustand)(/|$)", message: "src/core is pure TypeScript: no Three.js, React or store." },
            { regex: "^\\.\\./(engine|ui|state|data)(/|$)", message: "src/core must not depend on upper layers." },
          ],
        },
      ],
    },
  },
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...noDataImports,
            { regex: "^react(-dom)?(/|$)", message: "The engine is framework-agnostic; React lives in src/ui." },
            { regex: "(^|/)ui(/|$)", message: "The engine must not import the UI." },
          ],
        },
      ],
    },
  },
);
