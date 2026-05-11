// ESLint 9 flat config for Next.js 15.
// `eslint-config-next` is still published as a classic extends-config, so we
// use FlatCompat to bridge it into the new flat-config format.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "dist/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "prisma/migrations/**",
      "public/**",
      "next-env.d.ts",
      "android/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
