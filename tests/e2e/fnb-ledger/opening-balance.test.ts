import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  recordBanquetIssue,
  recordBanquetReceipt,
  recordBanquetReturn,
} from "@/server/actions/banquet";
import { getStockLedger, type LedgerRow } from "@/server/reports/stock-ledger";
import {
  asStore,
  daysFromNow,
  ensureSeeded,
  expectDecimal,
  importCatalogue,
  istInput,
  mustOk,
  placeCateringOrder,
} from "../harness";
import { fnbStock } from "../fnb/items";

/**
 * The F&B stock report has to agree with the shelf on go-live day.
 *
 * Opening stock is the whole risk here: BanquetItem has no openingQty column,
 * so a quantity written straight to currentStock has no document behind it —
 * and the ledger builds every balance by replaying documents. The importer
 * now posts the same "Opening balance" receipt the new-item form does, which
 * is the only reason the closing balances below come out right. 141 of the
 * client's 154 in-house lines carry a real count, so the failure this guards
 * against is most of the catalogue reading short from day one.
 *
 * The window opens the day AFTER the import on purpose: that is the first
 * report the client runs, and it puts the import's own receipt before the
 * window, where an opening balance belongs.
 */

const from = daysFromNow(1);
const to = daysFromNow(2);
/** An hour into the window — the movements below are inside it, the import
 *  is outside it, whatever minute the suite happens to run at. */
const movedAt = istInput(new Date(from.getTime() + 60 * 60 * 1000));

/**
 * Catalogue lines looked up rather than named: the import is what creates
 * them, and this file cares about "a line with opening stock" and "a line
 * without", not about which code the client gave it.
 */
let untouched: string; // has opening stock, nothing ever moves it
let moved: string; // has opening stock, and a receipt/issue/return on top
let neverCounted: string; // opening stock of zero

async function ledgerRow(itemId: string): Promise<LedgerRow | undefined> {
  const { sku } = await db.banquetItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { sku: true },
  });
  const { rows } = await getStockLedger("banquet", from, to);
  return rows.find((r) => r.sku === sku);
}

async function mustLedgerRow(itemId: string): Promise<LedgerRow> {
  const row = await ledgerRow(itemId);
  if (!row) throw new Error(`Stock ledger has no row for ${itemId} — it holds stock, so it must be there.`);
  return row;
}

/**
 * Everything a second import must leave exactly as it found it. Flattened to
 * sorted strings because neither list has a total order of its own — "soup
 * bowl" is three catalogue lines — and a row-order difference is not a
 * change to the stock.
 */
async function snapshot() {
  const items = await db.banquetItem.findMany({
    select: { sku: true, name: true, currentStock: true },
  });
  const { rows } = await getStockLedger("banquet", from, to);
  return {
    stock: items.map((i) => `${i.sku ?? i.name}=${i.currentStock.toString()}`).sort(),
    ledger: rows
      .map((r) => `${r.sku} ${r.opening} +${r.inQty} -${r.outQty} = ${r.closing}`)
      .sort(),
    receipts: await db.banquetReceipt.count(),
    receiptLines: await db.banquetReceiptLine.count(),
  };
}

beforeAll(async () => {
  await ensureSeeded();
  const withStock = await db.banquetItem.findMany({
    where: { active: true, currentStock: { gt: 0 } },
    orderBy: { sku: "asc" },
    take: 2,
    select: { id: true },
  });
  const without = await db.banquetItem.findFirst({
    where: { active: true, currentStock: 0 },
    orderBy: { sku: "asc" },
    select: { id: true },
  });
  if (withStock.length < 2 || !without) {
    throw new Error("Catalogue import left no F&B opening stock — did the import run?");
  }
  [untouched, moved] = withStock.map((i) => i.id);
  neverCounted = without.id;
});

describe("the F&B stock ledger against the shelf", () => {
  it("carries an imported item's opening stock into the opening balance", async () => {
    const stock = await fnbStock(untouched);
    expect(Number(stock)).toBeGreaterThan(0);

    const row = await mustLedgerRow(untouched);
    // Nothing has moved since the import, so all three are the same figure.
    expectDecimal(row.opening, stock, "ledger opening vs the item's opening stock");
    expectDecimal(row.closing, stock, "ledger closing vs live stock");
  });

  it("still closes where the item stands after a receipt, an issue and a return", async () => {
    const order = await placeCateringOrder();
    asStore();

    mustOk(
      await recordBanquetReceipt({
        receivedAt: movedAt,
        sourceNote: "Top-up before the event",
        lines: [{ itemId: moved, quantity: "500" }],
      }),
      "receipt",
    );
    mustOk(
      await recordBanquetIssue({
        issuedAt: movedAt,
        purpose: "Event service",
        orderId: order.id,
        lines: [{ itemId: moved, quantity: "300" }],
      }),
      "issue",
    );
    mustOk(
      await recordBanquetReturn({
        returnedAt: movedAt,
        orderId: order.id,
        lines: [{ itemId: moved, quantity: "100" }],
      }),
      "return",
    );

    const stock = await fnbStock(moved);
    const row = await mustLedgerRow(moved);
    expectDecimal(row.inQty, "600", "ledger in (receipt + return)");
    expectDecimal(row.outQty, "300", "ledger out (issue)");
    expectDecimal(row.closing, stock, "ledger closing vs live stock");
    // opening + in − out is the whole ledger: if opening were missing, the
    // closing above could only match by the movements cancelling out.
    expectDecimal(row.opening, (Number(stock) - 300).toString(), "ledger opening");
  });

  it("leaves a line that was never counted at zero, with no receipt behind it", async () => {
    expectDecimal(await fnbStock(neverCounted), "0", "stock on an uncounted line");
    // A zero opening is not a movement: no line, and nothing on the report.
    expect(await db.banquetReceiptLine.count({ where: { itemId: neverCounted } })).toBe(0);
    expect(await ledgerRow(neverCounted)).toBeUndefined();
  });
});

describe("re-running the catalogue import", () => {
  it("changes neither the stock nor the ledger", async () => {
    const before = await snapshot();
    importCatalogue();
    expect(await snapshot()).toEqual(before);
    // One opening document for the store, not one per run — the receipt is
    // posted only for rows the import actually created.
    expect(
      await db.banquetReceipt.count({
        where: { sourceNote: "Opening balance (catalogue import)" },
      }),
    ).toBe(1);
  });
});
