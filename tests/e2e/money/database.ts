/**
 * Kept as a stable import path for the suites that already reference it.
 * The real guard now lives in the harness — one copy, not four, and no
 * hard-coded port: `vitest.e2e.config.ts` defers to the shell's
 * DATABASE_URL, so a normal run and a per-container run both land where
 * the operator asked.
 */
export { assertDatabaseUrlPinned } from "../harness/database-url";
import "../harness/database-url";
