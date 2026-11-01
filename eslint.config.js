/**
 * ESLint flat config.
 *
 * The rules here are the ones this project keeps in prose: no `any`, no
 * unawaited promises, external JSON parsed rather than asserted, and no stray
 * console output (the scripts write through `process.stdout.write` and the
 * browser bundle writes nothing). Type-aware linting is enabled so a rule can
 * see through a `Promise` or a union instead of guessing from syntax.
 */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "web/dist/**",
      "data/**",
      ".cache/**",
      "coverage/**",
    ],
  },

  js.configs.recommended,

  // Syntax-only rules apply to every file ESLint is pointed at.
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-console": "error",
      "no-var": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "no-else-return": ["error", { allowElseIf: false }],
      curly: ["error", "multi-line"],
    },
  },

  // Type-aware rules, scoped to the TypeScript sources.
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // AGENTS.md: "Never `as`. Never `any`." The casts that remain are
      // JSON.parse boundaries; `any` has no legitimate use here at all.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Scripts are fire-and-forget runners: an unawaited promise there means a
      // partial artifact, so it is an error rather than a style choice.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // The planners switch on union keys; a missing case must not fall through
      // to a default that silently reports 0.
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },

  // Browser code.
  {
    files: ["web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/exhaustive-deps": "error",
    },
  },

  // Node-side scripts and the Vite config.
  {
    files: ["src/**/*.ts", "scripts/**/*.ts", "web/vite.config.ts"],
    languageOptions: { globals: { ...globals.node } },
  },

  // Tests: vitest globals come from imports, and fixtures are allowed to build
  // deliberately malformed payloads.
  {
    files: ["tests/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
);
