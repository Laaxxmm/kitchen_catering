import "./database";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DocumentEntityType,
  DocumentKind,
  PaymentMethod,
  VendorBillStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  applyVendorAdvanceToBill,
  approveVendorBill,
  approveVendorPO,
  createGRN,
  createVendorBill,
  createVendorPO,
  listOpenVendorAdvances,
  matchVendorBill,
  recordVendorAdvance,
  submitVendorPO,
} from "@/server/actions/procurement";
import { createVendor } from "@/server/actions/vendors";
import { uploadDocument } from "@/server/actions/documents";
import { toDecimal } from "@/lib/money";
import {
  asAccounts,
  asChef,
  asDelivery,
  asManager,
  asNobody,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  mustOk,
  read,
  seeded,
} from "../harness";

/**
 * Vendor advances — money paid to a supplier before their bill exists, then
 * applied to one of their bills.
 *
 * An advance is cash that has already left the building, so the only thing
 * that matters is that it lands exactly once, on the right supplier, and
 * never for more than that bill is short. All four of those are asserted as
 * refusals, and the payables ledger is reconciled afterwards: the sum of the
 * posted payment rows must equal what the bill says was paid.
 */

/** 10 kg @ ₹400 + 5% GST — under the ₹5,000 admin-approval tier. */
const BILL_ONE_TOTAL = "4200";
/** 5 kg @ ₹400 + 5%. */
const BILL_TWO_TOTAL = "2100";

const FAKE_PDF = Buffer.from("%PDF-1.4\n% e2e supplier invoice\n").toString("base64");

let otherVendorId: string;
let approvedBillId: string;
let matchedBillId: string;
let advSmall: string;
let advExact: string;
let advBig: string;
let advOtherVendor: string;

/** PO → manager sign-off → goods in → bill → 3-way match. Stops short of
 *  approval so the caller decides whether this bill is payable. */
async function billUpToMatched(quantity: string, vendorBillNo: string): Promise<string> {
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
          unitPrice: "400",
          gstRatePct: "5",
        },
      ],
    }),
    "create PO",
  );
  mustOk(await submitVendorPO(po.id), "submit PO");
  asManager();
  mustOk(await approveVendorPO(po.id), "approve PO");

  asStore();
  const full = await read.purchaseOrder(po.id);
  mustOk(
    await createGRN({
      poId: po.id,
      lines: [{ poLineId: full.lines[0].id, acceptedQty: quantity, rejectedQty: "0" }],
    }),
    "create GRN",
  );
  const bill = mustOk(
    await createVendorBill({
      vendorId,
      poId: po.id,
      vendorBillNo,
      lines: [
        { description: "Paneer", quantity, unit: "kg", unitPrice: "400", gstRatePct: "5" },
      ],
    }),
    "create vendor bill",
  );

  asAccounts();
  const match = mustOk(await matchVendorBill(bill.id), "3-way match");
  expect(match.matched).toBe(true);
  return bill.id;
}

async function approveBill(billId: string): Promise<void> {
  asStore();
  await uploadDocument({
    entityType: DocumentEntityType.VENDOR_BILL,
    entityId: billId,
    base64: FAKE_PDF,
    fileName: `${billId}.pdf`,
    kind: DocumentKind.ORIGINAL,
  });
  asAccounts();
  mustOk(await approveVendorBill(billId), "approve bill");
}

async function record(vendorId: string, amount: string, reference: string): Promise<string> {
  asAccounts();
  const created = mustOk(
    await recordVendorAdvance({
      vendorId,
      amount,
      method: PaymentMethod.NEFT,
      reference,
      paidAt: new Date().toISOString(),
    }),
    `record advance ${reference}`,
  );
  return created.id;
}

beforeAll(async () => {
  await ensureSeeded();
  const { vendorId } = seeded();

  asManager();
  otherVendorId = mustOk(
    await createVendor({
      name: "E2E Other Provisions",
      stateCode: "29",
      contactName: "Other Contact",
      phone: "9000000003",
      email: "other@e2e.test",
    }),
    "create second vendor",
  ).id;

  approvedBillId = await billUpToMatched("10", "SUP-ADV-001");
  await approveBill(approvedBillId);
  matchedBillId = await billUpToMatched("5", "SUP-ADV-002");

  advSmall = await record(vendorId, "1500", "NEFT-ADV-SMALL");
  advExact = await record(vendorId, "2700", "NEFT-ADV-EXACT");
  advBig = await record(vendorId, "9000", "NEFT-ADV-BIG");
  advOtherVendor = await record(otherVendorId, "1000", "NEFT-ADV-OTHER");
});

describe("recording an advance", () => {
  it("refuses a blank amount rather than crashing on new Decimal('')", async () => {
    const { vendorId } = seeded();
    asAccounts();
    const message = await expectRefused(() =>
      recordVendorAdvance({
        vendorId,
        amount: "",
        method: PaymentMethod.NEFT,
        paidAt: new Date().toISOString(),
      }),
    );
    expect(message).toContain("greater than zero");
    expect(message).not.toContain("DecimalError");
  });

  it("refuses zero and negative advances", async () => {
    const { vendorId } = seeded();
    asAccounts();
    for (const amount of ["0", "-500"]) {
      const message = await expectRefused(() =>
        recordVendorAdvance({
          vendorId,
          amount,
          method: PaymentMethod.NEFT,
          paidAt: new Date().toISOString(),
        }),
      );
      expect(message).toContain("greater than zero");
    }
  });

  it("refuses an unparseable payment date", async () => {
    const { vendorId } = seeded();
    asAccounts();
    const message = await expectRefused(() =>
      recordVendorAdvance({
        vendorId,
        amount: "1000",
        method: PaymentMethod.NEFT,
        paidAt: "yesterday-ish",
      }),
    );
    expect(message).toContain("valid payment date");
  });

  it("refuses a supplier that does not exist", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      recordVendorAdvance({
        vendorId: "no-such-vendor",
        amount: "1000",
        method: PaymentMethod.NEFT,
        paidAt: new Date().toISOString(),
      }),
    );
    expect(message).toContain("Vendor not found");
  });

  it("is not the store's or the kitchen's cash to pay out", async () => {
    const { vendorId } = seeded();
    for (const become of [asStore, asChef, asDelivery]) {
      become();
      await expectRefused(() =>
        recordVendorAdvance({
          vendorId,
          amount: "1000",
          method: PaymentMethod.NEFT,
          paidAt: new Date().toISOString(),
        }),
      );
    }
    asNobody();
    await expectRefused(() => listOpenVendorAdvances(vendorId));
  });

  it("lists the supplier's open advances, and nobody else's", async () => {
    const { vendorId } = seeded();
    asAccounts();
    const ours = await listOpenVendorAdvances(vendorId);
    expect(ours.map((a) => a.id).sort()).toEqual([advSmall, advExact, advBig].sort());
    const theirs = await listOpenVendorAdvances(otherVendorId);
    expect(theirs.map((a) => a.id)).toEqual([advOtherVendor]);
  });
});

describe("an advance only lands on a bill that may be paid", () => {
  it("refuses a bill nobody has approved", async () => {
    asAccounts();
    const message = await expectRefused(() => applyVendorAdvanceToBill(advSmall, matchedBillId));
    expect(message).toContain("nobody has approved it yet");
    const row = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advSmall } });
    expect(row.appliedToBillId).toBeNull();
    expectDecimal((await read.vendorBill(matchedBillId)).amountPaid, "0", "unapproved bill paid");
  });

  it("refuses to cross suppliers", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      applyVendorAdvanceToBill(advOtherVendor, approvedBillId),
    );
    expect(message).toContain("different supplier");
    const row = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advOtherVendor } });
    expect(row.appliedToBillId).toBeNull();
    expectDecimal((await read.vendorBill(approvedBillId)).amountPaid, "0", "bill untouched");
  });

  it("refuses an advance larger than what the bill is short", async () => {
    asAccounts();
    const message = await expectRefused(() => applyVendorAdvanceToBill(advBig, approvedBillId));
    expect(message).toContain("larger than this bill's balance");
    expect(message).toContain("4200.00");
    const row = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advBig } });
    expect(row.appliedToBillId).toBeNull();
  });

  it("is not the store's or the kitchen's to apply", async () => {
    for (const become of [asStore, asChef, asDelivery]) {
      become();
      await expectRefused(() => applyVendorAdvanceToBill(advSmall, approvedBillId));
    }
    expectDecimal((await read.vendorBill(approvedBillId)).amountPaid, "0", "bill still unpaid");
  });

  it("refuses an advance that does not exist", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      applyVendorAdvanceToBill("no-such-advance", approvedBillId),
    );
    expect(message).toContain("Advance not found");
  });
});

describe("applying it", () => {
  it("posts ₹1,500 against the bill and consumes the advance", async () => {
    asAccounts();
    mustOk(await applyVendorAdvanceToBill(advSmall, approvedBillId), "apply small advance");

    const bill = await read.vendorBill(approvedBillId);
    expectDecimal(bill.amountPaid, "1500", "amount paid after the advance");
    // ₹1,500 of ₹4,200 — still approved, still owed.
    expect(bill.status).toBe(VendorBillStatus.APPROVED);
    expect(bill.payments).toHaveLength(1);
    expectDecimal(bill.payments[0].amount, "1500", "posted payment");
    expect(bill.payments[0].notes).toBe("Advance applied");
    expect(bill.payments[0].reference).toBe("NEFT-ADV-SMALL");

    const advance = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advSmall } });
    expect(advance.appliedToBillId).toBe(approvedBillId);
    expect(advance.appliedAt).not.toBeNull();
  });

  it("refuses to apply the same advance a second time", async () => {
    asAccounts();
    const message = await expectRefused(() => applyVendorAdvanceToBill(advSmall, approvedBillId));
    expect(message).toContain("already applied");
    const bill = await read.vendorBill(approvedBillId);
    expectDecimal(bill.amountPaid, "1500", "amount paid after a refused re-apply");
    expect(bill.payments).toHaveLength(1);
  });

  it("refuses to apply it to a DIFFERENT bill of the same supplier either", async () => {
    await approveBill(matchedBillId);
    asAccounts();
    const message = await expectRefused(() => applyVendorAdvanceToBill(advSmall, matchedBillId));
    expect(message).toContain("already applied");
    expectDecimal((await read.vendorBill(matchedBillId)).amountPaid, "0", "second bill unpaid");
  });

  it("drops it out of the supplier's open list", async () => {
    const { vendorId } = seeded();
    asAccounts();
    const open = await listOpenVendorAdvances(vendorId);
    expect(open.map((a) => a.id)).not.toContain(advSmall);
    expect(open.map((a) => a.id).sort()).toEqual([advExact, advBig].sort());
  });

  it("clears the balance with the exact ₹2,700 and marks the bill paid", async () => {
    asAccounts();
    mustOk(await applyVendorAdvanceToBill(advExact, approvedBillId), "apply exact advance");
    const bill = await read.vendorBill(approvedBillId);
    expect(bill.status).toBe(VendorBillStatus.PAID);
    expect(bill.paidAt).not.toBeNull();
    expectDecimal(bill.amountPaid, BILL_ONE_TOTAL, "amount paid in full");
  });

  it("refuses anything more once the bill is paid", async () => {
    asAccounts();
    const message = await expectRefused(() => applyVendorAdvanceToBill(advBig, approvedBillId));
    expect(message).toContain("already paid");
    const row = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advBig } });
    expect(row.appliedToBillId).toBeNull();
  });

  it("reconciles — the posted payments add up to what the bill says was paid", async () => {
    const bill = await read.vendorBill(approvedBillId);
    const posted = bill.payments.reduce(
      (s, p) => s.plus(toDecimal(p.amount)),
      toDecimal(0),
    );
    expectDecimal(posted, bill.amountPaid.toString(), "posted payments vs amountPaid");
    expectDecimal(posted, BILL_ONE_TOTAL, "posted payments vs grand total");
    expectDecimal(bill.grandTotal, BILL_ONE_TOTAL, "bill grand total");
  });

  it("left the second bill alone throughout", async () => {
    const bill = await read.vendorBill(matchedBillId);
    expectDecimal(bill.grandTotal, BILL_TWO_TOTAL, "second bill total");
    expectDecimal(bill.amountPaid, "0", "second bill amount paid");
    expect(bill.payments).toEqual([]);
  });

  it("recorded both advances and both applications in the audit trail", async () => {
    expect(await read.auditActions("VendorAdvance", advSmall)).toEqual([
      "VENDOR_ADVANCE_RECORDED",
      "VENDOR_ADVANCE_APPLIED",
    ]);
    expect(await read.auditActions("VendorAdvance", advBig)).toEqual([
      "VENDOR_ADVANCE_RECORDED",
    ]);
  });
});
