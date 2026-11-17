// The benchmark's own lint ruleset: typescript-eslint, type-checked, with no-floating-promises. Run from outside the
// build with --no-inline-config, so a build's own config and disable comments change nothing.
import tseslint from "typescript-eslint";

export default [
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    basePath: "/work",
    files: ["**/*.{ts,tsx,mts,cts}"],
  })),
  {
    basePath: "/work",
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parserOptions: { project: ["/work/.analysis.tsconfig.json"], tsconfigRootDir: "/work" },
    },
    // node:test's test() and describe() return promises the runner awaits: typescript-eslint's documented exception.
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "it", "describe", "suite", "before", "after", "beforeEach", "afterEach"] },
          ],
        },
      ],
    },
  },
];
