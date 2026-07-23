import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: root });

const config = [
  { ignores: [".next/**", "node_modules/**", "coverage/**"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["plugins/**/*.js", "tests/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["next-env.d.ts"],
    rules: { "@typescript-eslint/triple-slash-reference": "off" },
  },
];

export default config;
