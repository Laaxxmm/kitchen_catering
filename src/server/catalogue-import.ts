import { readFileSync } from "node:fs";
import path from "node:path";
import { BanquetItemSource, Prisma, type PrismaClient, Role } from "@prisma/client";

/**
 * Seeds the client's three replacement catalogues from data/catalogue/:
 *
 *   kitchen.json      → Ingredient          (GP-nnn)
 *   fnb-inhouse.json  → BanquetItem IN_HOUSE (GP-IN-nnn)
 *   fnb-hired.json    → BanquetItem HIRED    (GP-HR-nnn)
 *
 * Two callers, one implementation: `npm run catalogue:import` (scripts/
 * import-catalogue.ts) and the admin settings button. The button is the one
 * that matters — production has no shell.
 *
 * The JSON is the source of truth — already extracted, normalised and
 * verified against the client's spreadsheets. Nothing here re-derives units,
 * codes or names.
 *
 * Idempotent: matches Ingredient on its code and BanquetItem on its real
 * key (name + source + category), so a second run updates the same rows and
 * changes nothing. Live figures — Ingredient.onHandQty, BanquetItem
 * .currentStock — are written on FIRST INSERT ONLY, and the F&B opening
 * receipt below is posted from that same first-insert list, so a re-run
 * neither overwrites a moved figure nor counts the opening stock in twice.
 *
 * All-or-nothing: every check and every write runs inside one transaction,
 * so a collision anywhere leaves the database exactly as it was. Half an
 * imported catalogue is worse than none — the missing half is invisible.
 */

const CATALOGUE_DIR = path.join(process.cwd(), "data", "catalogue");

interface KitchenRow {
  code: string;
  name: string;
  unit: string;
  openingQty: string | null;
}

interface FnbRow {
  code: string;
  name: string;
  unit: string;
  rate: string | null;
  category: string;
  openingQty?: string | null;
}

export interface CatalogueImportSummary {
  kitchenCreated: number;
  kitchenUpdated: number;
  fnbCreated: number;
  fnbUpdated: number;
  fnbOpeningLines: number;
  kitchenNext: number;
  inhouseNext: number;
  hiredNext: number;
}

function load<T>(file: string): T[] {
  const rows = JSON.parse(readFileSync(path.join(CATALOGUE_DIR, file), "utf8"));
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${file}: expected a non-empty array.`);
  }
  return rows as T[];
}

/**
 * Blank guard before the Decimal constructor: `new Decimal("")` throws a
 * DecimalError, and a null openingQty ("never counted") is the common case
 * in the kitchen sheet — 285 of the 405 rows. Both mean zero here.
 */
function dec(value: string | null | undefined, label: string): Prisma.Decimal {
  const raw = value == null ? "" : String(value).trim();
  if (raw === "") return new Prisma.Decimal(0);
  try {
    return new Prisma.Decimal(raw);
  } catch {
    throw new Error(`${label}: "${raw}" is not a number.`);
  }
}

/** GP-001 < GP-018 < GP-702. Plain string sort puts GP-1000 before GP-2. */
function byCode(a: { code: string }, b: { code: string }): number {
  return a.code.localeCompare(b.code, "en", { numeric: true });
}

function assertUnique<T>(rows: T[], key: (row: T) => string, label: string): void {
  const seen = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
  if (dupes.length > 0) {
    throw new Error(`${label} repeats: ${dupes.slice(0, 10).join(", ")}`);
  }
}

/**
 * Every quantity and rate is checked BEFORE anything is written, and every
 * bad one is reported together. Hitting them one per run — each run a full
 * rollback — is how a two-minute data fix turns into an afternoon.
 *
 * Deliberately no guessing: a cell reading "3 [3 Full Food Pan]" gets
 * rejected, not silently read as 3. Inventing an opening count for a live
 * store is the one error nobody downstream can see.
 */
function assertNumbers(
  rows: Array<{ code: string; openingQty?: string | null; rate?: string | null }>,
): void {
  const bad: string[] = [];
  for (const row of rows) {
    for (const field of ["openingQty", "rate"] as const) {
      try {
        dec(row[field], field);
      } catch {
        bad.push(`${row.code} ${field}="${String(row[field]).trim()}"`);
      }
    }
  }
  if (bad.length > 0) {
    throw new Error(
      `${bad.length} value(s) are not numbers — fix them in data/catalogue/ and re-run:\n  ${bad.join("\n  ")}`,
    );
  }
}

function requireFields(rows: Array<Record<string, unknown>>, file: string): void {
  for (const row of rows) {
    for (const field of ["code", "name", "unit"]) {
      const value = row[field];
      if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`${file}: row ${JSON.stringify(row)} has a blank ${field}.`);
      }
    }
  }
}

/** Highest n across GP-nnn codes; the STR-nnnn legacy codes are not ours. */
function highestGPNumber(codes: string[]): number {
  return codes.reduce((max, code) => {
    const m = code.match(/^GP-(\d+)$/);
    return m ? Math.max(max, Number(m[1])) : max;
  }, 0);
}

/**
 * @param client the app's Prisma singleton, or the CLI's own instance.
 * @param recordedById who the F&B opening receipt is booked against. The CLI
 *   has no session and passes nothing, so it falls back to the oldest active
 *   admin; a receipt has to name who put the stock on the shelf.
 */
export async function importCatalogue(
  client: PrismaClient,
  recordedById?: string,
): Promise<CatalogueImportSummary> {
  const kitchen = load<KitchenRow>("kitchen.json").sort(byCode);
  const inhouse = load<FnbRow>("fnb-inhouse.json").sort(byCode);
  const hired = load<FnbRow>("fnb-hired.json").sort(byCode);

  const fnb = [
    ...inhouse.map((r) => ({ ...r, source: BanquetItemSource.IN_HOUSE })),
    ...hired.map((r) => ({ ...r, source: BanquetItemSource.HIRED })),
  ];

  // ── Pre-flight on the files themselves ────────────────────────────────
  requireFields(kitchen as unknown as Array<Record<string, unknown>>, "kitchen.json");
  requireFields(fnb as unknown as Array<Record<string, unknown>>, "fnb-*.json");
  assertUnique([...kitchen, ...fnb], (r) => r.code, "item code");
  assertUnique(kitchen, (r) => r.name, "kitchen item name");
  // The real F&B key: "soup bowl" is legitimately three different items.
  assertUnique(fnb, (r) => `${r.name}|${r.source}|${r.category}`, "F&B name+source+category");
  assertNumbers([...kitchen, ...fnb]);

  return await client.$transaction(
    async (tx) => {
      // ── Pre-flight against what is already in the database ──────────────
      // A row that exists under a DIFFERENT code is a genuine clash, not an
      // update: silently rewriting its code would strand every printed
      // label and stock sheet that carries the old one.
      const existingKitchen = await tx.ingredient.findMany({
        select: { sku: true, name: true },
      });
      const kitchenSkuByName = new Map(existingKitchen.map((i) => [i.name, i.sku]));
      for (const row of kitchen) {
        const sku = kitchenSkuByName.get(row.name);
        if (sku !== undefined && sku !== row.code) {
          throw new Error(
            `Kitchen collision: "${row.name}" already exists as ${sku}, incoming code is ${row.code}.`,
          );
        }
      }

      const existingFnb = await tx.banquetItem.findMany({
        select: { sku: true, name: true, source: true, category: true },
      });
      const incomingCodes = new Set(fnb.map((r) => r.code));
      const fnbKey = (r: { name: string; source: BanquetItemSource; category: string | null }) =>
        `${r.name}|${r.source}|${r.category}`;
      const incomingByKey = new Map(fnb.map((r) => [fnbKey(r), r.code]));
      for (const row of existingFnb) {
        const wantedCode = incomingByKey.get(fnbKey(row));
        if (wantedCode !== undefined && row.sku !== null && row.sku !== wantedCode) {
          throw new Error(
            `F&B collision: "${row.name}" (${row.source}/${row.category}) already exists as ${row.sku}, incoming code is ${wantedCode}.`,
          );
        }
        // The mirror case: the code is taken by a row that is NOT the one
        // we are about to write it to.
        if (row.sku !== null && incomingCodes.has(row.sku) && wantedCode !== row.sku) {
          throw new Error(
            `F&B collision: code ${row.sku} is already on "${row.name}" (${row.source}/${row.category}), which is not in the incoming list.`,
          );
        }
      }

      // ── Kitchen ────────────────────────────────────────────────────────
      let kitchenCreated = 0;
      for (const row of kitchen) {
        const opening = dec(row.openingQty, `${row.code} openingQty`);
        const existing = await tx.ingredient.findUnique({
          where: { sku: row.code },
          select: { id: true },
        });
        if (existing) {
          await tx.ingredient.update({
            where: { sku: row.code },
            data: { name: row.name, unit: row.unit, openingQty: opening },
          });
        } else {
          await tx.ingredient.create({
            data: {
              sku: row.code,
              name: row.name,
              unit: row.unit,
              openingQty: opening,
              onHandQty: opening,
            },
          });
          kitchenCreated++;
        }
      }

      // ── F&B, both sources ──────────────────────────────────────────────
      let fnbCreated = 0;
      // Opening stock for the rows created below. BanquetItem holds no
      // openingQty column, so a figure written straight to currentStock has
      // no document behind it — and the stock ledger builds every balance by
      // replaying documents. Collected here and posted as one real receipt
      // after the loop, the same "Opening balance" receipt the new-item form
      // writes (upsertBanquetItemInner, src/server/actions/banquet.ts).
      const openingLines: Array<{ itemId: string; quantity: Prisma.Decimal }> = [];
      for (const row of fnb) {
        const where = {
          name_source_category: {
            name: row.name,
            source: row.source,
            category: row.category,
          },
        };
        const existing = await tx.banquetItem.findUnique({
          where,
          select: { id: true },
        });
        const rate = row.rate == null ? null : dec(row.rate, `${row.code} rate`);
        if (existing) {
          await tx.banquetItem.update({
            where,
            data: { sku: row.code, unit: row.unit, rate },
          });
        } else {
          const opening = dec(row.openingQty, `${row.code} openingQty`);
          const created = await tx.banquetItem.create({
            data: {
              sku: row.code,
              name: row.name,
              source: row.source,
              category: row.category,
              unit: row.unit,
              rate,
              currentStock: opening,
            },
          });
          // Zero is "never counted", not a movement: no line, no ledger row.
          if (opening.gt(0)) openingLines.push({ itemId: created.id, quantity: opening });
          fnbCreated++;
        }
      }

      // One receipt for the whole import — the physical count sheet the
      // catalogue arrived with.
      if (openingLines.length > 0) {
        const receiptBy =
          recordedById ??
          (
            await tx.user.findFirst({
              where: { role: Role.ADMIN, active: true },
              orderBy: { createdAt: "asc" },
              select: { id: true },
            })
          )?.id;
        if (!receiptBy) {
          throw new Error(
            "No active admin to record the F&B opening balance against — create one and re-run.",
          );
        }
        await tx.banquetReceipt.create({
          data: {
            receivedAt: new Date(),
            recordedById: receiptBy,
            sourceNote: "Opening balance (catalogue import)",
            sourceContact: "Opening balance",
            lines: { create: openingLines },
          },
        });
      }

      // ── Counters ───────────────────────────────────────────────────────
      // "next" is the code to hand out NEXT, so it is MAX + 1 (see
      // nextSequenceValue in src/lib/sequences.ts). GREATEST so a re-run
      // can never wind a counter backwards over codes issued since.
      const kitchenNext = highestGPNumber(kitchen.map((r) => r.code)) + 1;
      const inhouseNext = inhouse.length + 1;
      const hiredNext = hired.length + 1;
      await tx.$executeRaw`INSERT INTO "GPItemCodeSequence" ("year", "next") VALUES (0, ${kitchenNext})
        ON CONFLICT ("year") DO UPDATE SET "next" = GREATEST("GPItemCodeSequence"."next", ${kitchenNext})`;
      await tx.$executeRaw`INSERT INTO "GPInhouseItemCodeSequence" ("year", "next") VALUES (0, ${inhouseNext})
        ON CONFLICT ("year") DO UPDATE SET "next" = GREATEST("GPInhouseItemCodeSequence"."next", ${inhouseNext})`;
      await tx.$executeRaw`INSERT INTO "GPHiredItemCodeSequence" ("year", "next") VALUES (0, ${hiredNext})
        ON CONFLICT ("year") DO UPDATE SET "next" = GREATEST("GPHiredItemCodeSequence"."next", ${hiredNext})`;

      return {
        kitchenCreated,
        kitchenUpdated: kitchen.length - kitchenCreated,
        fnbCreated,
        fnbUpdated: fnb.length - fnbCreated,
        fnbOpeningLines: openingLines.length,
        kitchenNext,
        inhouseNext,
        hiredNext,
      };
    },
    // ~600 upserts one at a time; the 5s default is nowhere near enough
    // over a remote connection.
    { timeout: 300_000, maxWait: 15_000 },
  );
}
