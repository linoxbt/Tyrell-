// @ts-check
import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/**
 * NFR-07 / I-7: no code path may unpin evidence or delete an anchored memory. These are lint errors, so
 * CI blocks them; packages/storage/test/nfr07.test.ts checks the same thing from the test suite.
 */
const NFR07 = [
  { selector: "Identifier[name=/^unpin/i]", message: "NFR-07: evidence is never unpinned." },
  { selector: "Literal[value=/\\bunpin\\b|pinning\\/unpin/i]", message: "NFR-07: evidence is never unpinned." },
  { selector: "TemplateElement[value.raw=/\\bunpin\\b|pinning\\/unpin/i]", message: "NFR-07: evidence is never unpinned." },
  { selector: "Property[key.name='method'][value.value=/^delete$/i]", message: "NFR-07: no HTTP DELETE to a pinning service." },
  { selector: "Literal[value=/DELETE\\s+FROM\\s+(anchors|blobs)\\b/i]", message: "NFR-07: anchored memories are never deleted." },
  { selector: "TemplateElement[value.raw=/DELETE\\s+FROM\\s+(anchors|blobs)\\b/i]", message: "NFR-07: anchored memories are never deleted." },
];

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/.next*/**", "**/dist/**", "**/coverage/**", "contracts/**", "**/*.d.ts", "apps/web/public/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,mjs,js}"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly", setTimeout: "readonly", clearTimeout: "readonly", setInterval: "readonly", clearInterval: "readonly", fetch: "readonly", AbortSignal: "readonly", window: "readonly", document: "readonly" } },
    rules: {
      "no-restricted-syntax": ["error", ...NFR07],
      // the sanitizers strip control characters on purpose
      "no-control-regex": "off",
      "no-irregular-whitespace": ["error", { skipStrings: false, skipComments: false, skipRegExps: false, skipTemplates: false }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", ignoreRestSiblings: true, caughtErrors: "none" }],
    },
  },
  {
    files: ["**/test/**/*.{ts,tsx}"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // the rule's own definition and its test name the forbidden calls
    files: ["eslint.config.mjs", "packages/storage/test/nfr07.test.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin, "react-hooks": reactHooks },
    rules: { ...nextPlugin.configs.recommended.rules, ...reactHooks.configs.recommended.rules },
    settings: { next: { rootDir: "apps/web" } },
  },
);
