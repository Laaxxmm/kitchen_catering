import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { VendorBillStatus, VendorPOStatus } from "@prisma/client";
import { db } from "@/server/db";
import {
  approveVendorPO,
  createGRN,
  createVendorBill,
  createVendorPO,
  matchVendorBill,
  submitVendorPO,
} from "@/server/actions/procurement";
import {
  asManager,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  mustOk,
  read,
  seeded,
} from "../harness";

/**
 * What the vendor actually put on the counter, not what the PO said.
 *
 * The store keeper is the one standing at the delivery, so they record it —
 * including the two cases the PO cannot predict: more arrived than was
 * ordered (100 g ordered, 500 g sent), and something arrived that was never
 * ordered at all. Both used to be refused outright, which left real stock on
 * the shelf and nothing in the system.
 *
 * The rule underneath every test here: whatever the delivery did to the
 * order, the PO must still be something the supplier's bill can be matched
 * against. So an over-receipt raises the PO line, an extra item joins the PO
 * as a line, and the 3-way match is asserted at the end of both.
 */

/** Raise, submit and approve a PO for `quantity` kg of paneer at ₹100 + 0%. */
async function approvedPO(quantity: string): Promise<{ id: string; lineId: string }> {
  const { ingredients, vendorId } = seeded();
  asStore();
  const po = mustOk(
    await createVendorPO({
      vendorId,
      placeOfSupplyStateCode: "29",
      lines: [
        {
          ingredientId: ingredients.scarce,
          sku: "GP-001",
          description: "Paneer",
          unit: "kg",
          quantity,
          unitPrice: "100",
          gstRatePct: "0",
        },
      ],
    }),
    "create PO",
  );
  mustOk(await submitVendorPO(po.id), "submit PO");
  asManager();
  mustOk(await approveVendorPO(po.id), "approve PO");
  const full = await read.purchaseOrder(po.id);
  return { id: po.id, lineId: full.lines[0].id };
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("more arrived than was ordered", () => {
  it("refuses the extra without a reason — committed spend is changing", async () => {
    const po = await approvedPO("2");
    asStore();
    const why = await expectRefused(() =>
      createGRN({
        poId: po.id,
        notes: null,
        lines: [{ poLineId: po.lineId, acceptedQty: "5", rejectedQty: "0", reason: null }],
      }),
    );
    expect(why).toContain("more than was ordered");
    // Nothing written: no GRN, no stock, PO untouched.
    expect(await db.gRN.count({ where: { poId: po.id } })).toBe(0);
    expectDecimal((await read.purchaseOrder(po.id)).lines[0].quantity, "2", "PO line unchanged");
  });

  it("takes the extra and raises the PO to what actually came", async () => {
    const po = await approvedPO("2");
    const before = await read.onHand(seeded().ingredients.scarce);

    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [
          {
            poLineId: po.lineId,
            acceptedQty: "5",
            rejectedQty: "0",
            reason: null,
            overReceiptReason: "Vendor sent the whole pack",
          },
        ],
      }),
      "receive five against an order for two",
    );

    const after = await read.purchaseOrder(po.id);
    expectDecimal(after.lines[0].quantity, "5", "PO line raised to what arrived");
    expectDecimal(after.lines[0].receivedQty, "5", "all five received");
    expect(after.status).toBe(VendorPOStatus.RECEIVED);
    // Header totals follow the lines, or the bill would match against a
    // figure the PO no longer holds.
    expectDecimal(after.grandTotal, "500", "PO total re-summed at 5 × ₹100");
    // The stock is real.
    expectDecimal(
      await read.onHand(seeded().ingredients.scarce),
      (Number(before) + 5).toString(),
      "five reached the shelf",
    );
  });

  it("records who agreed to it and why", async () => {
    const amendments = await db.auditLog.findMany({ where: { action: "PO_AMENDED_AT_RECEIPT" } });
    expect(amendments.length).toBeGreaterThan(0);
    expect(amendments[0].userId).not.toBeNull();
  });

  it("still matches the supplier's bill for the delivered quantity", async () => {
    const po = await approvedPO("2");
    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [
          {
            poLineId: po.lineId,
            acceptedQty: "5",
            rejectedQty: "0",
            reason: null,
            overReceiptReason: "Vendor sent the whole pack",
          },
        ],
      }),
      "over-receive",
    );
    const bill = mustOk(
      await createVendorBill({
        vendorId: seeded().vendorId,
        poId: po.id,
        vendorBillNo: "SUP-OVER-1",
        lines: [
          { description: "Paneer", quantity: "5", unit: "kg", unitPrice: "100", gstRatePct: "0" },
        ],
      }),
      "bill for what was delivered",
    );
    mustOk(await matchVendorBill(bill.id), "3-way match");
    expect((await read.vendorBill(bill.id)).status).toBe(VendorBillStatus.MATCHED);
  });
});

describe("the vendor is never bringing the rest", () => {
  /**
   * "Not received" rejects the outstanding quantity. On receivedQty alone
   * the PO sat at PARTIALLY_RECEIVED for ever — and a part-received PO with
   * no bill yet offered no way to raise one, so the order was stuck behind
   * goods nobody was ever going to deliver. A rejected balance means
   * nothing more is expected, so the line is settled.
   */
  it("settles the PO once every line is received or rejected", async () => {
    const po = await approvedPO("2");
    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [
          {
            poLineId: po.lineId,
            acceptedQty: "0",
            rejectedQty: "2",
            reason: "Not delivered by the vendor",
          },
        ],
      }),
      "post a GRN for goods that never came",
    );
    const after = await read.purchaseOrder(po.id);
    expect(after.status).toBe(VendorPOStatus.RECEIVED);
    expectDecimal(after.lines[0].receivedQty, "0", "nothing was received");
  });

  it("settles a partly delivered line when the balance is rejected", async () => {
    const po = await approvedPO("10");
    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [{ poLineId: po.lineId, acceptedQty: "6", rejectedQty: "0", reason: null }],
      }),
      "six arrive",
    );
    expect((await read.purchaseOrder(po.id)).status).toBe(VendorPOStatus.PARTIALLY_RECEIVED);

    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [{ poLineId: po.lineId, acceptedQty: "0", rejectedQty: "4", reason: "short-shipped" }],
      }),
      "the other four are never coming",
    );
    const after = await read.purchaseOrder(po.id);
    expect(after.status).toBe(VendorPOStatus.RECEIVED);
    expectDecimal(after.lines[0].receivedQty, "6", "only the six that arrived are stock");
  });

  it("still lets a re-delivery be received against a rejected line", async () => {
    const po = await approvedPO("2");
    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [{ poLineId: po.lineId, acceptedQty: "0", rejectedQty: "2", reason: "damaged" }],
      }),
      "reject the lot",
    );
    // Rejecting is not a deduction — the vendor replacing them still books in.
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [{ poLineId: po.lineId, acceptedQty: "2", rejectedQty: "0", reason: null }],
      }),
      "vendor re-sends",
    );
    expectDecimal(
      (await read.purchaseOrder(po.id)).lines[0].receivedQty,
      "2",
      "the replacement is stock",
    );
  });
});

describe("something arrived that was never ordered", () => {
  it("adds it to the PO and receives it in the same GRN", async () => {
    const po = await approvedPO("2");
    const { ingredients } = seeded();
    const before = await read.onHand(ingredients.plentiful);

    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        notes: null,
        lines: [{ poLineId: po.lineId, acceptedQty: "2", rejectedQty: "0", reason: null }],
        extraLines: [
          {
            ingredientId: ingredients.plentiful,
            banquetItemId: null,
            quantity: "3",
            unitPrice: "50",
            reason: "Sent in place of a short item",
          },
        ],
      }),
      "receive the ordered line plus one that wasn't",
    );

    const after = await read.purchaseOrder(po.id);
    expect(after.lines).toHaveLength(2);
    const added = after.lines.find((l) => l.ingredientId === ingredients.plentiful)!;
    expectDecimal(added.quantity, "3", "added at what arrived");
    expectDecimal(added.receivedQty, "3", "and received");
    // Description and unit come off the catalogue row, never off the form.
    expect(added.description.length).toBeGreaterThan(0);
    expectDecimal(after.grandTotal, "350", "2 × ₹100 + 3 × ₹50");
    expectDecimal(
      await read.onHand(ingredients.plentiful),
      (Number(before) + 3).toString(),
      "the extra reached the shelf",
    );
  });

  it("refuses an item that isn't in either catalogue", async () => {
    const po = await approvedPO("2");
    asStore();
    const why = await expectRefused(() =>
      createGRN({
        poId: po.id,
        notes: null,
        lines: [],
        extraLines: [
          {
            ingredientId: "does-not-exist",
            banquetItemId: null,
            quantity: "1",
            unitPrice: "10",
            reason: "typo",
          },
        ],
      }),
    );
    expect(why).toContain("not in the catalogue");
    expect(await db.gRN.count({ where: { poId: po.id } })).toBe(0);
  });

  it("refuses an added line with no reason", async () => {
    const po = await approvedPO("2");
    asStore();
    await expectRefused(() =>
      createGRN({
        poId: po.id,
        notes: null,
        lines: [],
        extraLines: [
          {
            ingredientId: seeded().ingredients.plentiful,
            banquetItemId: null,
            quantity: "1",
            unitPrice: "10",
            reason: "",
          },
        ],
      }),
    );
    expect(await db.gRN.count({ where: { poId: po.id } })).toBe(0);
  });
});
