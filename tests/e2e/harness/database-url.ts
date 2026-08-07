/**
 * Import this FIRST in every e2e file, before anything that reaches
 * `@/server/db`.
 *
 * Vitest builds the worker environment as `{...process.env, ...config.env}`,
 * so a hard-coded `DATABASE_URL` in `vitest.e2e.config.ts` silently beat a
 * `DATABASE_URL=… npx vitest` on the command line. Four parallel agents each
 * believed they were on their own container and were all writing to one —
 * two of them wiped a database another was mid-run against before noticing.
 *
 * The config now defaults instead of pinning, so the shell wins. What remains
 * worth keeping is the guard below: if the Prisma client already exists, the
 * URL it captured is already baked in and changing the variable now would be
 * a lie. Fail loudly rather than write to the wrong database.
 */
export function assertDatabaseUrlPinned(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is unset. Run the e2e suite with one, e.g.\n" +
        '  DATABASE_URL="postgresql://postgres:e2e@127.0.0.1:5540/kc_e2e" npm run test:e2e',
    );
  }
  // `db` is a module-level singleton; if it has been constructed, its
  // connection string is fixed and any reassignment here is cosmetic.
  const globalForPrisma = globalThis as { prisma?: unknown };
  if (globalForPrisma.prisma) {
    throw new Error(
      "Prisma was constructed before the database URL was pinned — this file " +
        "must be the first import in the test file. Refusing to continue: the " +
        "client is already bound to whatever URL was set at that moment.",
    );
  }
  return url;
}

assertDatabaseUrlPinned();
