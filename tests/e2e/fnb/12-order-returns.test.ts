// FIRST import, always — see db-url.ts.
import "./db-url";
import { beforeAll, describe, expect, it } from "vitest";
import { BanquetItemSource } from "@prisma/client";
import { db } from "@/server/db";
import {
  getOrderBanquetLedger,
  listOrdersWithBanquetStockOut,
  recordBanquetIssue,
  recordBanquetReceipt,
  recordBanquetReturn,
} from "@/server/actions/banquet";
import {
  asAccounts,
  asChef,
  asDelivery,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
  placeCateringOrder,
} from "../harness";
import { FNB_CODES, fnbItem, fnbStock, type FnbItem } from "./items";

/**
 * Order-wise cutlery returns. Issues linked to an order say what went OUT to
 * the client's event; returns say what came BACK, and the difference is what
 * is still with them. Both ways in are exercised — the delivery team's
 * event-prep screen and the F&B store's own /banquet/returns — because they
 * are the same movement recorded from two desks with two different gates.
 */

let orderId: string;
let otherOrderId: string;
let plentiful: FnbItem;
let melamine: FnbItem;
let bonechina: FnbItem;
const now = () => istInput(new Date());

beforeAll(async () => {
  await ensureSeeded();
  [plentiful, melamine, bonechina] = await Promise.all([
    fnbItem(FNB_CODES.plentiful),
    fnbItem(FNB_CODES.hiredMelamine),
    fnbItem(FNB_CODES.hiredBonechina),
  ]);
  orderId = (await placeCateringOrder()).id;
  otherOrderId = (await placeCateringOrder()).id;

  // The hired bowls arrive from the hire vendor — a real receipt, recorded by
  // the store keeper (stock IN is still theirs).
  asStore();
  mustOk(
    await recordBanquetReceipt({
      receivedAt: now(),
      sourceNote: "Hire vendor drop-off",
      lines: [
        { itemId: melamine.id, quantity: "100", costPerUnit: "2.50" },
        { itemId: bonechina.id, quantity: "50", costPerUnit: "3.50" },
      ],
    }),
    "record hire receipt",
  );
});

describe("F&B issues cutlery to the event", () => {
  it("moves the stock and links it to the order", async () => {
    const cupsBefore = await fnbStock(plentiful.id);
    asDelivery();
    mustOk(
      await recordBanquetIssue({
        issuedAt: now(),
        purpose: "Event prep — cutlery and cups",
        orderId,
        lines: [
          { itemId: plentiful.id, quantity: "200" },
          { itemId: melamine.id, quantity: "60" },
          { itemId: bonechina.id, quantity: "20" },
        ],
      }),
      "issue to the event",
    );
    expectDecimal(await fnbStock(plentiful.id), String(Number(cupsBefore) - 200), "cups");
    expectDecimal(await fnbStock(melamine.id), "40", "Melamine bowls");
    expectDecimal(await fnbStock(bonechina.id), "30", "Bonechina bowls");
  });

  it("refuses to issue more than the store holds", async () => {
    asDelivery();
    const why = await expectRefused(() =>
      recordBanquetIssue({
        issuedAt: now(),
        purpose: "Over-issue",
        orderId,
        lines: [{ itemId: bonechina.id, quantity: "31" }],
      }),
    );
    expect(why).toMatch(/Not enough/);
    expectDecimal(await fnbStock(bonechina.id), "30", "untouched by the refusal");
  });

  it("tells the two same-named bowls apart on the client's ledger", async () => {
    asDelivery();
    const ledger = await getOrderBanquetLedger(orderId);
    const bowls = ledger.filter((l) => l.name.toLowerCase() === "soup bowl");
    expect(bowls).toHaveLength(2);
    // The name alone would bill the client for the wrong grade — the code and
    // grade are what identify the row.
    expect(bowls.map((b) => b.sku).sort()).toEqual([melamine.sku, bonechina.sku].sort());
    expect(bowls.every((b) => b.source === BanquetItemSource.HIRED)).toBe(true);
    expect(bowls.map((b) => b.category).sort()).toEqual(["Bonechina", "Melamine"]);

    const mel = bowls.find((b) => b.sku === melamine.sku)!;
    expectDecimal(mel.issued, "60", "issued");
    expectDecimal(mel.returned, "0", "returned");
    expectDecimal(mel.outstanding, "60", "still out");
  });

  it("puts the order on the store's return worklist", async () => {
    asStore();
    const work = await listOrdersWithBanquetStockOut();
    const row = work.find((o) => o.orderId === orderId);
    expect(row?.itemsOut).toBe(3);
  });
});

describe("some of it comes back — from the event-prep screen", () => {
  it("won't take back more than went out, and says how much is still out", async () => {
    asDelivery();
    const why = await expectRefused(() =>
      recordBanquetReturn({
        returnedAt: now(),
        orderId,
        lines: [{ itemId: melamine.id, quantity: "61" }],
      }),
    );
    expect(why).toMatch(/Only 60 pcs of soup bowl is still out/);
    expectDecimal(await fnbStock(melamine.id), "40", "nothing went back on the shelf");
  });

  it("puts what did come back on the shelf as sellable stock", async () => {
    asDelivery();
    mustOk(
      await recordBanquetReturn({
        returnedAt: now(),
        orderId,
        notes: "Counted at the venue",
        lines: [
          { itemId: melamine.id, quantity: "40" },
          { itemId: plentiful.id, quantity: "50" },
        ],
      }),
      "record the first return",
    );
    expectDecimal(await fnbStock(melamine.id), "80", "Melamine back on the shelf");

    const ledger = await getOrderBanquetLedger(orderId);
    const mel = ledger.find((l) => l.itemId === melamine.id)!;
    expectDecimal(mel.returned, "40", "returned so far");
    expectDecimal(mel.outstanding, "20", "still out");
  });

  it("refuses a zero or negative quantity", async () => {
    asDelivery();
    for (const quantity of ["0", "-5"]) {
      const why = await expectRefused(() =>
        recordBanquetReturn({
          returnedAt: now(),
          orderId,
          lines: [{ itemId: melamine.id, quantity }],
        }),
      );
      expect(why).toMatch(/must be > 0/);
    }
  });
});

describe("the rest comes back — from the F&B store's own returns screen", () => {
  it("lets the store keeper book it against the order", async () => {
    asStore();
    mustOk(
      await recordBanquetReturn({
        returnedAt: now(),
        orderId,
        lines: [
          { itemId: melamine.id, quantity: "20" },
          { itemId: bonechina.id, quantity: "20" },
          { itemId: plentiful.id, quantity: "150" },
        ],
      }),
      "record the store's return",
    );
    expectDecimal(await fnbStock(melamine.id), "100", "hire quantity whole again");
    expectDecimal(await fnbStock(bonechina.id), "50", "hire quantity whole again");
  });

  it("nets the order to nothing outstanding", async () => {
    asStore();
    const ledger = await getOrderBanquetLedger(orderId);
    expect(ledger).toHaveLength(3);
    for (const line of ledger) {
      expectDecimal(line.outstanding, "0", `${line.sku} still out`);
    }
  });

  it("drops the order off the return worklist", async () => {
    asStore();
    const work = await listOrdersWithBanquetStockOut();
    expect(work.find((o) => o.orderId === orderId)).toBeUndefined();
  });

  it("refuses one more piece once the account is square", async () => {
    asStore();
    const why = await expectRefused(() =>
      recordBanquetReturn({
        returnedAt: now(),
        orderId,
        lines: [{ itemId: melamine.id, quantity: "1" }],
      }),
    );
    expect(why).toMatch(/Only 0 pcs of soup bowl is still out/);
  });
});

describe("the ceiling is per order, and per desk", () => {
  it("won't let another client's event take back this one's stock", async () => {
    asStore();
    const why = await expectRefused(() =>
      recordBanquetReturn({
        returnedAt: now(),
        orderId: otherOrderId,
        lines: [{ itemId: melamine.id, quantity: "10" }],
      }),
    );
    expect(why).toMatch(/still out with this client/);
    expect(await db.banquetReturn.count({ where: { orderId: otherOrderId } })).toBe(0);
  });

  it("is not the kitchen's or the payables desk's movement to record", async () => {
    for (const become of [asChef, asAccounts]) {
      become();
      const why = await expectRefused(() =>
        recordBanquetReturn({
          returnedAt: now(),
          orderId,
          lines: [{ itemId: melamine.id, quantity: "1" }],
        }),
      );
      expect(why).toMatch(/Requires one of/);
    }
  });
});
