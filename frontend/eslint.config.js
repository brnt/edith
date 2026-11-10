import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // TypeScript's own checker handles undefined identifiers (incl. browser
    // globals like fetch/document), so the lint rule is redundant here.
    rules: { "no-undef": "off" },
  },
);
