const tsPlugin = require("@typescript-eslint/eslint-plugin");
const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    ignores: ["lib/**"],
  },
  ...tsPlugin.configs["flat/recommended-type-checked"].map((config) => ({
    ...config,
    files: ["src/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      ...(config.languageOptions || {}),
      parser: tsParser,
      parserOptions: {
        ...(config.languageOptions?.parserOptions || {}),
        project: ["./tsconfig.json"],
        tsconfigRootDir: __dirname,
      },
    },
  })),
];
