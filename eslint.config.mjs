import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  // Existing Next.js + TypeScript configs
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // Add Prettier integration (using eslint-config-prettier + plugin:prettier/recommended)
  ...compat.extends("plugin:prettier/recommended"),

  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  {
    rules: {
      // Example overrides: add your team’s decisions here
      "no-console": "warn",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];

export default eslintConfig;
