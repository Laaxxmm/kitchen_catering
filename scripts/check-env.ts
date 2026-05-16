/**
 * Standalone env-var checker. Invoked by `docker-entrypoint.sh` BEFORE
 * Prisma migrate / Next start, so misconfigured deploys fail loud and
 * fast with a clear "this variable is missing or wrong" message instead
 * of a cryptic stack trace 30 seconds later.
 *
 * Reads the same Zod schema the app uses at runtime (`src/lib/env.ts`)
 * — single source of truth.
 *
 * Exit codes:
 *   0   env is valid
 *   1   env is invalid (error is printed; container should not start)
 */

import "../src/lib/env";

// Importing env.ts triggers the safeParse + throw. If we got here, env
// validated cleanly.
 
console.log("[env-check] OK — all required environment variables are set.");
