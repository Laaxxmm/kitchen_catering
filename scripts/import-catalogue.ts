/**
 * CLI wrapper around the catalogue importer.
 *
 *   npm run catalogue:import
 *
 * All the logic — validation, collision checks, the single transaction —
 * lives in src/server/catalogue-import.ts, because the admin settings button
 * runs the same import and production has no shell. Relative import, not the
 * "@/" alias: tsx resolves this without a tsconfig-paths hook.
 */

import { PrismaClient } from "@prisma/client";
import { importCatalogue } from "../src/server/catalogue-import";

const db = new PrismaClient();

importCatalogue(db)
  .then((result) => {
    console.log(
      `Kitchen: ${result.kitchenCreated} created, ${result.kitchenUpdated} updated. ` +
        `F&B: ${result.fnbCreated} created, ${result.fnbUpdated} updated, ` +
        `${result.fnbOpeningLines} opening balance(s) received in.`,
    );
    console.log(
      `Next codes: GP-${result.kitchenNext}, GP-IN-${result.inhouseNext}, GP-HR-${result.hiredNext}.`,
    );
  })
  .catch((err) => {
    console.error(
      "\nImport failed — nothing was written:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  })
  .finally(() => db.$disconnect());
