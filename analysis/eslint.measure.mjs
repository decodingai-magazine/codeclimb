// Measurement rules, not a ruleset: each report is one type escape or one function's complexity. Syntax only, so a
// build whose types do not resolve is still measured.
import tseslint from "typescript-eslint";

export default [
  {
    basePath: "/work",
    files: ["**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      "@typescript-eslint/no-explicit-any": ["warn", { fixToUnknown: false, ignoreRestArgs: false }],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true, "ts-check": false },
      ],
      "no-restricted-syntax": [
        "warn",
        {
          selector: "TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']",
          message: "as unknown as",
        },
      ],
      complexity: ["warn", { max: 0 }],
    },
  },
];
