import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // `packages/` here is a vendored copy of the shared workspace packages, kept so
  // this app can be built from its own repository. It is authored and linted in
  // the monorepo; linting the copy would only report the same findings twice.
  { ignores: ["dist", "node_modules", "packages"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true, allowExportNames: ["useAuth", "usePathname", "navigate"] }],
    },
  },
);
