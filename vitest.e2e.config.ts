import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * End-to-end suite: real server actions, real guards, real Prisma, real
 * Postgres. Separate from vitest.config.ts (the 229 pure unit tests) because
 * these need a database and must never run in parallel — every test file
 * shares one schema, so a second worker would be reading another test's
 * half-written orders.
 *
 * DATABASE_URL is pinned here on purpose. The repo's .env points at whatever
 * the developer was last poking at; an e2e run that silently reset THAT
 * database would be a very bad afternoon.
 */
export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    globals: false,
    setupFiles: ["tests/e2e/harness/setup.ts"],
    // One process, one file at a time. Everything below says the same thing
    // in the four places Vitest looks.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
    sequence: { concurrent: false },
    // A reset + 600-row catalogue import runs before each file.
    testTimeout: 120_000,
    hookTimeout: 300_000,
    env: {
      // Vitest writes test.env OVER the shell env inside the worker, so a
      // hard-coded value here silently beats `DATABASE_URL=… npx vitest` and
      // every parallel run lands on one database. Default only.
      DATABASE_URL:
        process.env.DATABASE_URL ?? "postgresql://postgres:e2e@127.0.0.1:5540/kc_e2e",
      // Deterministic GST maths: supplier state fixed, so intra-state
      // (CGST+SGST) vs inter-state (IGST) is a choice the test makes.
      INDEFINE_STATE_CODE: "29",
      NEXTAUTH_URL: "http://localhost:3100",
      // No SMTP here, so sendEmail runs in console mode — which deliberately
      // does NOT stamp emailedAt unless this is set. Setting it makes "did
      // the customer copy actually go out?" assertable.
      EMAIL_LOG_BODY: "1",
      // Supplier-invoice attachments land here, not in the repo's ./uploads.
      UPLOAD_ROOT: path.resolve(__dirname, "./tests/e2e/.uploads"),
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // tsconfig says jsx:"preserve" because Next compiles the JSX itself. Vitest
  // has no such downstream step, so the PDF templates (.tsx, rendered on the
  // invoice paths) would reach the module runner as invalid JS. Override the
  // tsconfig the transformer reads rather than the repo's own.
  oxc: { jsx: { runtime: "automatic" } },
});
