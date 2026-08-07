import "./database";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DocumentEntityType,
  DocumentKind,
  ManpowerRequestStatus,
  PaymentMethod,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  approveManpowerRequest,
  completeManpowerRequest,
  createManpowerRequest,
  payManpowerRequest,
  settleManpowerCost,
} from "@/server/actions/manpower";
import {
  applyVendorAdvanceToBill,
  approveVendorBill,
  approveVendorPO,
  createGRN,
  createVendorBill,
  createVendorPO,
  matchVendorBill,
  recordVendorAdvance,
  submitVendorPO,
} from "@/server/actions/procurement";
import { uploadDocument } from "@/server/actions/documents";
import {
  asAccounts,
  asChef,
  asManager,
  asStore,
  ensureSeeded,
  freshSlate,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
} from "../harness";

/**
 * The in-app clean slate ("RESET" on /admin/settings) says it "wipes every
 * transactional row". Two tables of money it did not wipe:
 *
 *   ManpowerRequest — a paid labour debt survived the reset with its order
 *   detached (orderId is an optional FK, so deleting the orders silently set
 *   it to null), so the next monthly report showed ghost spend against no
 *   order at all.
 *
 *   VendorAdvance — worse. `appliedToBillId` is also an optional FK, so
 *   deleting the vendor bills UN-APPLIED every advance that had been spent.
 *   The rupees survived the wipe looking unspent and could be applied to a
 *   bill all over again.
 *
 * Both are built here through the real actions, then the real ADMIN-gated
 * reset runs and is asked what it left behind.
 */

const FAKE_PDF = Buffer.from("%PDF-1.4\n% e2e supplier invoice\n").toString("base64");

let advanceId: string;
let manpowerId: string;

beforeAll(async () => {
  await ensureSeeded();
  const { ingredients, vendorId } = seeded();

  // ── A paid manpower debt against a real order ──────────────────────────
  const order = await placeCateringOrder();
  asChef();
  manpowerId = mustOk(
    await createManpowerRequest({
      orderId: order.id,
      workDescription: "Serving crew",
      people: 4,
      days: 1,
      ratePerPersonPerDay: "500",
    }),
    "raise manpower",
  ).id;
  asManager();
  mustOk(await approveManpowerRequest({ id: manpowerId }), "approve manpower");
  asChef();
  mustOk(await completeManpowerRequest(manpowerId), "complete manpower");
  asAccounts();
  mustOk(await settleManpowerCost({ id: manpowerId, actualCost: "2000" }), "settle manpower");
  mustOk(await payManpowerRequest({ id: manpowerId, method: PaymentMethod.NEFT }), "pay manpower");

  // ── An advance, spent on an approved bill ──────────────────────────────
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
          quantity: "10",
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
      lines: [{ poLineId: full.lines[0].id, acceptedQty: "10", rejectedQty: "0" }],
    }),
    "create GRN",
  );
  const bill = mustOk(
    await createVendorBill({
      vendorId,
      poId: po.id,
      vendorBillNo: "SUP-RESET-001",
      lines: [{ description: "Paneer", quantity: "10", unit: "kg", unitPrice: "400", gstRatePct: "5" }],
    }),
    "create bill",
  );
  asAccounts();
  mustOk(await matchVendorBill(bill.id), "match bill");
  asStore();
  await uploadDocument({
    entityType: DocumentEntityType.VENDOR_BILL,
    entityId: bill.id,
    base64: FAKE_PDF,
    fileName: "SUP-RESET-001.pdf",
    kind: DocumentKind.ORIGINAL,
  });
  asAccounts();
  mustOk(await approveVendorBill(bill.id), "approve bill");
  advanceId = mustOk(
    await recordVendorAdvance({
      vendorId,
      amount: "3000",
      method: PaymentMethod.NEFT,
      reference: "NEFT-RESET-1",
      paidAt: new Date().toISOString(),
    }),
    "record advance",
  ).id;
  mustOk(await applyVendorAdvanceToBill(advanceId, bill.id), "apply advance");
});

describe("before the reset", () => {
  it("has a paid labour debt and a spent advance on the books", async () => {
    const manpower = await db.manpowerRequest.findUniqueOrThrow({ where: { id: manpowerId } });
    expect(manpower.status).toBe(ManpowerRequestStatus.PAID);
    expect(manpower.orderId).not.toBeNull();
    const advance = await db.vendorAdvance.findUniqueOrThrow({ where: { id: advanceId } });
    expect(advance.appliedToBillId).not.toBeNull();
  });
});

describe("after the clean slate", () => {
  beforeAll(async () => {
    // The real ADMIN-gated action with its confirmation phrase — this is
    // what the harness's freshSlate() and /admin/settings both call.
    await freshSlate();
  });

  it("cleared the orders it says it clears", async () => {
    expect(await db.order.count()).toBe(0);
    expect(await db.vendorBill.count()).toBe(0);
    expect(await db.vendorPO.count()).toBe(0);
  });

  it("left no manpower request behind", async () => {
    expect(await db.manpowerRequest.count()).toBe(0);
  });

  it("left no vendor advance behind to be spent a second time", async () => {
    expect(await db.vendorAdvance.count()).toBe(0);
  });
});
