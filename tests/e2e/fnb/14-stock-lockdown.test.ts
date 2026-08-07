// FIRST import, always — see db-url.ts.
import "./db-url";
import { beforeAll, describe, expect, it } from "vitest";
import { StockStore } from "@prisma/client";
import { db } from "@/server/db";
import {
  postBanquetStockCount,
  recordBanquetIssue,
  recordBanquetReceipt,
  recordBanquetReturn,
} from "@/server/actions/banquet";
import { adjustStoreStock } from "@/server/actions/store-stock";
import { recordStockTransfer } from "@/server/actions/stock-transfer";
import {
  asAdmin,
  asDelivery,
  asManager,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
} from "../harness";
import { FNB_CODES, fnbItem, fnbStock, type FnbItem } from "./items";

/**
 * The F&B stock lockdown. Typing a figure in by hand — the single-item
 * adjustment and the bulk physical count — is admin/manager only. Everything
 * that moves stock off a real document (receipt, issue, return, transfer)
 * keeps its wider role set: the store keeper and the F&B team still run the
 * counter, they just no longer overwrite the number.
 */

let orderId: string;
let cups: FnbItem;
const now = () => istInput(new Date());

beforeAll(async () => {
  await ensureSeeded();
  cups = await fnbItem(FNB_CODES.plentiful);
  orderId = (await placeCateringOrder()).id;
});

describe("hand-setting an F&B figure is management only", () => {
  it("refuses the store keeper and the F&B team on adjustStoreStock", async () => {
    const before = await fnbStock(cups.id);
    for (const become of [asStore, asDelivery]) {
      become();
      const why = await expectRefused(() =>
        adjustStoreStock({
          store: "banquet",
          itemId: cups.id,
          mode: "set",
          qty: "1",
          reason: "Recount",
        }),
      );
      expect(why).toMatch(/Requires one of: ADMIN, MANAGER/);
    }
    expectDecimal(await fnbStock(cups.id), before, "on hand untouched");
  });

  it("refuses the store keeper and the F&B team on the bulk count", async () => {
    const before = await fnbStock(cups.id);
    for (const become of [asStore, asDelivery]) {
      become();
      const why = await expectRefused(() =>
        postBanquetStockCount({ lines: [{ itemId: cups.id, countedQty: "1" }] }),
      );
      expect(why).toMatch(/Requires one of: ADMIN, MANAGER/);
    }
    expectDecimal(await fnbStock(cups.id), before, "on hand untouched");
    expect(
      await db.auditLog.count({ where: { action: "BANQUET_STOCK_COUNT_POSTED" } }),
    ).toBe(0);
  });

  it("lets the manager correct one item, and records the reason", async () => {
    const before = Number(await fnbStock(cups.id));
    asManager();
    mustOk(
      await adjustStoreStock({
        store: "banquet",
        itemId: cups.id,
        mode: "delta",
        qty: "-50",
        reason: "Damaged in the store",
        note: "Water leak",
      }),
      "manager adjusts F&B stock",
    );
    expectDecimal(await fnbStock(cups.id), String(before - 50), "on hand");
    expect(await read.auditActions("BanquetItem", cups.id)).toContain("STORE_STOCK_ADJUSTED");
  });

  it("lets the admin post a physical count, and only for the lines that moved", async () => {
    const unchanged = await fnbItem(FNB_CODES.hiredMelamine);
    asAdmin();
    const posted = mustOk(
      await postBanquetStockCount({
        lines: [
          { itemId: cups.id, countedQty: "4321" },
          // Counted and found to match — no movement, so no audit noise.
          { itemId: unchanged.id, countedQty: unchanged.currentStock },
        ],
        notes: "Month-end count",
      }),
      "admin posts the count",
    );
    expect(posted.changes.map((c) => c.after)).toEqual(["4321"]);
    expectDecimal(await fnbStock(cups.id), "4321", "counted on hand");
  });

  it("still refuses to take an F&B figure negative", async () => {
    asManager();
    const why = await expectRefused(() =>
      adjustStoreStock({
        store: "banquet",
        itemId: cups.id,
        mode: "delta",
        qty: "-99999",
        reason: "Typo",
      }),
    );
    expect(why).toMatch(/cannot be negative/i);
    expectDecimal(await fnbStock(cups.id), "4321", "on hand untouched");
  });
});

describe("the movements that survive the lockdown", () => {
  it("still lets the store keeper book goods in", async () => {
    asStore();
    mustOk(
      await recordBanquetReceipt({
        receivedAt: now(),
        sourceNote: "Vendor delivery",
        lines: [{ itemId: cups.id, quantity: "100", costPerUnit: "1.48" }],
      }),
      "store keeper records a receipt",
    );
    expectDecimal(await fnbStock(cups.id), "4421", "on hand after receipt");
  });

  it("still lets the F&B team book goods in", async () => {
    asDelivery();
    mustOk(
      await recordBanquetReceipt({
        receivedAt: now(),
        sourceNote: "Second vendor drop",
        lines: [{ itemId: cups.id, quantity: "79" }],
      }),
      "F&B records a receipt",
    );
    expectDecimal(await fnbStock(cups.id), "4500", "on hand after receipt");
  });

  it("still lets both desks issue to an event", async () => {
    asDelivery();
    mustOk(
      await recordBanquetIssue({
        issuedAt: now(),
        purpose: "F&B issues for the event",
        orderId,
        lines: [{ itemId: cups.id, quantity: "300" }],
      }),
      "F&B issue",
    );
    asStore();
    mustOk(
      await recordBanquetIssue({
        issuedAt: now(),
        purpose: "Store counter top-up",
        orderId,
        lines: [{ itemId: cups.id, quantity: "200" }],
      }),
      "store issue",
    );
    expectDecimal(await fnbStock(cups.id), "4000", "on hand after both issues");
  });

  it("still lets both desks take returns back in", async () => {
    asDelivery();
    mustOk(
      await recordBanquetReturn({
        returnedAt: now(),
        orderId,
        lines: [{ itemId: cups.id, quantity: "120" }],
      }),
      "F&B return",
    );
    asStore();
    mustOk(
      await recordBanquetReturn({
        returnedAt: now(),
        orderId,
        lines: [{ itemId: cups.id, quantity: "80" }],
      }),
      "store return",
    );
    expectDecimal(await fnbStock(cups.id), "4200", "on hand after both returns");
  });

  it("still lets the store keeper transfer stock out of the F&B store", async () => {
    const { ingredients } = seeded();
    const kitchenBefore = Number(await read.onHand(ingredients.plentiful));
    asStore();
    mustOk(
      await recordStockTransfer({
        transferredAt: now(),
        fromStore: StockStore.FNB,
        fromItemId: cups.id,
        toStore: StockStore.KITCHEN,
        toItemId: ingredients.plentiful,
        quantity: "10",
        // pcs → kg is not a conversion; the mover has to say they meant it.
        unitsAcknowledged: true,
        notes: "Moved to the kitchen store",
      }),
      "store keeper transfers",
    );
    expectDecimal(await fnbStock(cups.id), "4190", "F&B side down");
    expectDecimal(
      await read.onHand(ingredients.plentiful),
      String(kitchenBefore + 10),
      "kitchen side up",
    );
  });

  it("does not let the F&B team move stock between stores", async () => {
    const { ingredients } = seeded();
    asDelivery();
    const why = await expectRefused(() =>
      recordStockTransfer({
        transferredAt: now(),
        fromStore: StockStore.FNB,
        fromItemId: cups.id,
        toStore: StockStore.KITCHEN,
        toItemId: ingredients.plentiful,
        quantity: "5",
        unitsAcknowledged: true,
      }),
    );
    expect(why).toMatch(/Requires one of: ADMIN, MANAGER, STORE_KEEPER/);
    expectDecimal(await fnbStock(cups.id), "4190", "F&B side untouched");
  });
});
