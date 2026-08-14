import { beforeAll, describe, expect, it } from "vitest";
import {
  DocumentEntityType,
  DocumentKind,
  PaymentMethod,
  VendorBillStatus,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  applyVendorAdvanceToBill,
  approveVendorBill,
  approveVendorPO,
  createGRN,
  createVendorBill,
  createVendorPO,
  markVendorBillPaid,
  matchVendorBill,
  recordVendorAdvance,
  submitVendorPO,
} from "@/server/actions/procurement";
import { recordVendorBillPayment } from "@/server/actions/payments";
import { uploadDocument } from "@/server/actions/documents";
import {
  asAccounts,
  asAdmin,
  asChef,
  asManager,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  mustOk,
  read,
  seeded,
} from "./harness";

/**
 * Scenario 3 — paying the supplier. Goods in, bill recorded, 3-way matched,
 * signed off by accounts, paid. The refusals matter more than the happy
 * path: no bill before the goods, no approval without the supplier's own
 * document, and no money out before that approval — by ANY of the three
 * routes a payment can be recorded.
 */

/** 20 kg at ₹420 + 5% GST. */
const BILL_TOTAL = "8820";

let receivedPoId: string;
let receivedPoLineId: string;
let emptyPoId: string;
let billId: string;

/** Smallest thing detectDocumentKind will accept as the supplier's invoice. */
const FAKE_PDF = Buffer.from("%PDF-1.4\n% e2e supplier invoice\n").toString("base64");

/** Raise and submit a PO for `quantity` kg of paneer at ₹420 + 5%. */
async function raisePO(quantity: string): Promise<{ id: string; lineId: string }> {
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
          unitPrice: "420",
          gstRatePct: "5",
        },
      ],
    }),
    "create PO",
  );
  mustOk(await submitVendorPO(po.id), "submit PO");
  const full = await read.purchaseOrder(po.id);
  return { id: po.id, lineId: full.lines[0].id };
}

beforeAll(async () => {
  await ensureSeeded();
  const received = await raisePO("20"); // ₹8,820 — over the admin threshold
  receivedPoId = received.id;
  receivedPoLineId = received.lineId;
  const empty = await raisePO("5"); // ₹2,205 — under it
  emptyPoId = empty.id;
});

describe("purchase orders are signed off by value", () => {
  it("is not the store's or accounts' signature to give", async () => {
    // Accounts run the payables desk and may approve the BILL; approving the
    // commitment to buy stays with management.
    for (const become of [asStore, asAccounts]) {
      become();
      await expectRefused(() => approveVendorPO(emptyPoId));
    }
  });

  it("a ₹2,205 order is complete on the manager's signature", async () => {
    asManager();
    mustOk(await approveVendorPO(emptyPoId), "approve small PO");
    expect((await read.purchaseOrder(emptyPoId)).status).toBe(VendorPOStatus.APPROVED);
  });

  it("an ₹8,820 order still waits for the admin after the manager signs", async () => {
    asManager();
    mustOk(await approveVendorPO(receivedPoId), "manager step");
    const po = await read.purchaseOrder(receivedPoId);
    expect(po.status).toBe(VendorPOStatus.PENDING_APPROVAL);
    expect(po.managerApprovedAt).not.toBeNull();
    expect(po.adminApprovedAt).toBeNull();

    // A second manager cannot stand in for the admin.
    const message = await expectRefused(() => approveVendorPO(receivedPoId));
    expect(message).toContain("needs Admin approval");
  });

  it("goods cannot be received against a half-approved order", async () => {
    asStore();
    const message = await expectRefused(() =>
      createGRN({
        poId: receivedPoId,
        lines: [{ poLineId: receivedPoLineId, acceptedQty: "20", rejectedQty: "0" }],
      }),
    );
    expect(message).toContain("Cannot receive against a pending approval purchase order");
  });

  it("the admin's signature completes it", async () => {
    asAdmin();
    mustOk(await approveVendorPO(receivedPoId), "admin step");
    const po = await read.purchaseOrder(receivedPoId);
    expect(po.status).toBe(VendorPOStatus.APPROVED);
    expectDecimal(po.grandTotal, BILL_TOTAL, "PO grand total");
  });
});

describe("no bill before the goods", () => {
  it("refuses a bill against a PO nothing has been received on", async () => {
    const { vendorId } = seeded();
    asStore();
    const message = await expectRefused(() =>
      createVendorBill({
        vendorId,
        poId: emptyPoId,
        vendorBillNo: "SUP-PREMATURE",
        lines: [
          { description: "Paneer", quantity: "5", unit: "kg", unitPrice: "420", gstRatePct: "5" },
        ],
      }),
    );
    expect(message).toContain("accept the GRN first");
    expect(await db.vendorBill.count({ where: { poId: emptyPoId } })).toBe(0);
  });
});

describe("goods in, then the bill", () => {
  it("books the delivery in against the PO", async () => {
    const { ingredients } = seeded();
    asStore();
    mustOk(
      await createGRN({
        poId: receivedPoId,
        lines: [{ poLineId: receivedPoLineId, acceptedQty: "20", rejectedQty: "0" }],
      }),
      "create GRN",
    );
    expect((await read.purchaseOrder(receivedPoId)).status).toBe(VendorPOStatus.RECEIVED);
    expectDecimal(await read.onHand(ingredients.scarce), "20", "stock received");
  });

  it("records the supplier's bill as a DRAFT", async () => {
    const { vendorId } = seeded();
    asStore();
    const bill = mustOk(
      await createVendorBill({
        vendorId,
        poId: receivedPoId,
        vendorBillNo: "SUP-2026-118",
        lines: [
          { description: "Paneer", quantity: "20", unit: "kg", unitPrice: "420", gstRatePct: "5" },
        ],
      }),
      "create vendor bill",
    );
    billId = bill.id;
    const row = await read.vendorBill(billId);
    expect(row.status).toBe(VendorBillStatus.DRAFT);
    expectDecimal(row.grandTotal, BILL_TOTAL, "bill grand total");
  });

  it("matches the bill against the PO and what was actually received", async () => {
    asAccounts();
    const result = mustOk(await matchVendorBill(billId), "3-way match");
    expect(result.matched).toBe(true);
    expect(result.discrepancies).toEqual([]);
    expect((await read.vendorBill(billId)).status).toBe(VendorBillStatus.MATCHED);
  });
});

describe("no money leaves before accounts approve", () => {
  it("refuses the one-click mark-paid", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      markVendorBillPaid({ id: billId, method: PaymentMethod.NEFT }),
    );
    expect(message).toContain("nobody has approved it yet");
  });

  it("refuses a recorded payment", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      recordVendorBillPayment({ billId, amount: "1000", method: PaymentMethod.NEFT }),
    );
    expect(message).toContain("nobody has approved it yet");
  });

  it("is not the store keeper's money to pay out", async () => {
    // The store records the bill and can 3-way match it; paying is finance.
    asStore();
    await expectRefused(() => markVendorBillPaid({ id: billId, method: PaymentMethod.NEFT }));
    await expectRefused(() =>
      recordVendorBillPayment({ billId, amount: "100", method: PaymentMethod.NEFT }),
    );
  });

  it("refuses an advance being applied to it", async () => {
    const { vendorId } = seeded();
    asAccounts();
    const advance = mustOk(
      await recordVendorAdvance({
        vendorId,
        amount: "2000",
        method: PaymentMethod.NEFT,
        paidAt: new Date().toISOString(),
      }),
      "record advance",
    );
    const message = await expectRefused(() => applyVendorAdvanceToBill(advance.id, billId));
    expect(message).toContain("nobody has approved it yet");
    // The advance is still unapplied and still the supplier's money.
    const row = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advance.id } });
    expect(row.appliedToBillId).toBeNull();
  });

  it("left the bill matched, unpaid and with nothing posted against it", async () => {
    const bill = await read.vendorBill(billId);
    expect(bill.status).toBe(VendorBillStatus.MATCHED);
    expect(bill.payments).toEqual([]);
    expectDecimal(bill.amountPaid, "0", "amount paid");
  });
});

describe("approval is the accounts desk's signature", () => {
  it("is not the store's or the kitchen's to approve", async () => {
    // The store records the bill (they hold the paper) but does not sign it off.
    for (const become of [asStore, asChef]) {
      become();
      await expectRefused(() => approveVendorBill(billId));
    }
  });

  /**
   * The supplier's own invoice used to be required here. Vendors hand it
   * over days late or not at all, so in production the whole accounts queue
   * sat unapprovable — and therefore unpayable — waiting on paper nobody
   * had. The upload is still prompted for on the bill page; it is not a gate.
   */
  it("approves with nothing attached", async () => {
    asAccounts();
    expect(await db.document.count({ where: { entityId: billId } })).toBe(0);

    mustOk(await approveVendorBill(billId), "approve bill");
    const bill = await read.vendorBill(billId);
    expect(bill.status).toBe(VendorBillStatus.APPROVED);
    expect(bill.approvedByUserId).not.toBeNull();
  });

  it("still takes the supplier's invoice afterwards, for the file", async () => {
    asStore();
    await uploadDocument({
      entityType: DocumentEntityType.VENDOR_BILL,
      entityId: billId,
      base64: FAKE_PDF,
      fileName: "SUP-2026-118.pdf",
      kind: DocumentKind.ORIGINAL,
    });
    expect(await db.document.count({ where: { entityId: billId } })).toBe(1);
  });

  it("locks the 3-way match once approved", async () => {
    asAccounts();
    const message = await expectRefused(() => matchVendorBill(billId));
    expect(message).toContain("matching is locked");
  });
});

describe("paid", () => {
  it("takes a part payment and leaves the bill approved", async () => {
    asAccounts();
    mustOk(
      await recordVendorBillPayment({
        billId,
        amount: "3000",
        method: PaymentMethod.NEFT,
        reference: "NEFT-0001",
      }),
      "part payment",
    );
    const bill = await read.vendorBill(billId);
    expect(bill.status).toBe(VendorBillStatus.APPROVED);
    expectDecimal(bill.amountPaid, "3000", "amount paid after part payment");
  });

  it("refuses to pay more than is outstanding", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      recordVendorBillPayment({ billId, amount: "9000", method: PaymentMethod.NEFT }),
    );
    expect(message).toContain("more than the outstanding balance");
    expectDecimal((await read.vendorBill(billId)).amountPaid, "3000", "amount paid unchanged");
  });

  it("clears the balance and marks the bill paid", async () => {
    asAccounts();
    mustOk(
      await markVendorBillPaid({
        id: billId,
        method: PaymentMethod.NEFT,
        reference: "NEFT-0002",
      }),
      "mark paid",
    );
    const bill = await read.vendorBill(billId);
    expect(bill.status).toBe(VendorBillStatus.PAID);
    expectDecimal(bill.amountPaid, BILL_TOTAL, "amount paid in full");
    const posted = bill.payments.reduce((s, p) => s + Number(p.amount.toString()), 0);
    expect(posted).toBe(Number(BILL_TOTAL));
  });

  it("refuses to pay a paid bill again, by any route", async () => {
    asAdmin();
    for (const attempt of [
      () => markVendorBillPaid({ id: billId, method: PaymentMethod.NEFT }),
      () => recordVendorBillPayment({ billId, amount: "1", method: PaymentMethod.NEFT }),
    ]) {
      const message = await expectRefused(attempt);
      expect(message).toContain("already paid");
    }
  });
});
