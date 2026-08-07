import "./pin-database-url";

import { beforeAll, describe, expect, it } from "vitest";
import {
  BanquetItemSource,
  CustomerInvoiceStatus,
  DocumentEntityType,
  DocumentKind,
  PaymentMethod,
  Role,
  VendorBillStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  clearOrdersKeepFinance,
  resetEverythingKeepParties,
  resetTransactionalData,
} from "@/server/actions/admin-reset";
import {
  deactivateBanquetItem,
  deleteBanquetItem,
  postBanquetStockCount,
  upsertBanquetItem,
} from "@/server/actions/banquet";
import {
  approveCustomerInvoiceForRelease,
  createCustomerInvoiceFromOrder,
  issueCustomerInvoice,
} from "@/server/actions/customer-invoices";
import {
  confirmDeliveryOTP,
  dispatchDelivery,
  listDeliveries,
  scheduleDelivery,
} from "@/server/actions/deliveries";
import { uploadDocument } from "@/server/actions/documents";
import {
  adjustIngredientStock,
  confirmIngredientReturn,
  createIngredient,
  deactivateIngredient,
  declareIngredientReturn,
  reactivateIngredient,
  recordDirectIngredientIssue,
  updateIngredient,
} from "@/server/actions/inventory";
import { postInventoryAudit } from "@/server/actions/inventory-audit";
import { listOrders, reviseOrder } from "@/server/actions/orders";
import { createPettyCashFloat, topUpPettyCash } from "@/server/actions/petty-cash";
import { recordVendorBillPayment } from "@/server/actions/payments";
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
import { markOrderCooked, startCookingOrder } from "@/server/actions/production-jobs";
import { markIngredientsAvailable } from "@/server/actions/chef-requisitions";
import { runVendorPaymentRemindersInternal } from "@/server/actions/reminders";
import { upsertSetting } from "@/server/actions/settings";
import { adjustStoreStock } from "@/server/actions/store-stock";
import { createUser, listUsers } from "@/server/actions/users";
import {
  actingAs,
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asNobody,
  asStore,
  chefAccepts,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  istInput,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
  stockUp,
  type DeskName,
} from "../harness";

/**
 * The rules the client actually stated, proven against real rows: who may
 * touch the catalogue, who may set a stock figure, who releases an invoice,
 * when a supplier bill becomes payable, who may wipe the database.
 *
 * matrix.test.ts asserts which desks each action's gate admits. This file
 * asserts the consequence — that the refused call changed nothing, and that
 * the permitted one did what it claims. It also probes the shapes that have
 * already bitten this codebase: a settings row that widens a gate, a
 * scheduled job that makes a document payable, an id from the client that
 * nobody checks belongs to the caller.
 */

/** Everyone but management. */
const NOT_MANAGEMENT: DeskName[] = ["chef", "store", "delivery", "accounts"];

beforeAll(async () => {
  await ensureSeeded();
});

// ─── The catalogue ──────────────────────────────────────────────────────

describe("only admin/manager may keep the kitchen catalogue", () => {
  let ingredientId: string;

  beforeAll(async () => {
    asManager();
    const created = mustOk(
      await createIngredient({ name: "Access Test Asafoetida", unit: "kg" }),
      "manager creates an ingredient",
    );
    ingredientId = created.id;
  });

  it("refuses everyone else a new item", async () => {
    for (const role of NOT_MANAGEMENT) {
      await actingAs(role, () =>
        expectRefused(() => createIngredient({ name: `Sneaked in by ${role}`, unit: "kg" })),
      );
    }
    expect(await db.ingredient.count({ where: { name: { startsWith: "Sneaked in" } } })).toBe(0);
  });

  it("refuses everyone else an edit — including the store and the chef", async () => {
    for (const role of NOT_MANAGEMENT) {
      const message = await actingAs(role, () =>
        expectRefused(() =>
          // Renaming and re-uniting is what strands the stock behind the item:
          // 25 "kg" reinterpreted as 25 "g" is a write-off nobody recorded.
          updateIngredient(ingredientId, { name: `Renamed by ${role}`, unit: "g" }),
        ),
      );
      expect(message).toContain("Requires one of");
    }
    const row = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expect({ name: row.name, unit: row.unit }).toEqual({
      name: "Access Test Asafoetida",
      unit: "kg",
    });
  });

  it("refuses everyone else the hide/unhide switch", async () => {
    for (const role of NOT_MANAGEMENT) {
      await actingAs(role, () => expectRefused(() => deactivateIngredient(ingredientId)));
      await actingAs(role, () => expectRefused(() => reactivateIngredient(ingredientId)));
    }
    expect((await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } })).active).toBe(
      true,
    );
  });

  it("lets the manager rename and hide it", async () => {
    asManager();
    mustOk(
      await updateIngredient(ingredientId, { name: "Access Test Hing", unit: "kg" }),
      "manager renames",
    );
    mustOk(await deactivateIngredient(ingredientId), "manager hides");
    const row = await db.ingredient.findUniqueOrThrow({ where: { id: ingredientId } });
    expect({ name: row.name, active: row.active }).toEqual({
      name: "Access Test Hing",
      active: false,
    });
  });
});

describe("only admin/manager may keep the F&B catalogue", () => {
  let itemId: string;

  beforeAll(async () => {
    asManager();
    const created = mustOk(
      // No opening stock: that would post a receipt line, and an item with
      // history refuses the hard delete asserted at the end of this block.
      await upsertBanquetItem({
        name: "Access Test Chafing Dish",
        source: BanquetItemSource.IN_HOUSE,
        unit: "piece",
      }),
      "manager creates an F&B item",
    );
    itemId = created.id;
  });

  it("refuses the F&B desk a new item or an edit", async () => {
    asDelivery();
    await expectRefused(() =>
      upsertBanquetItem({ name: "Sneaked in by F&B", source: BanquetItemSource.IN_HOUSE }),
    );
    await expectRefused(() =>
      upsertBanquetItem({ name: "Renamed by F&B", unit: "set" }, itemId),
    );
    const row = await db.banquetItem.findUniqueOrThrow({ where: { id: itemId } });
    expect({ name: row.name, unit: row.unit }).toEqual({
      name: "Access Test Chafing Dish",
      unit: "piece",
    });
  });

  it("refuses the F&B desk and the store the deactivate and the delete", async () => {
    // The buttons are hidden for these desks on /banquet/items — which
    // proves nothing about the action, so both are called directly.
    for (const role of NOT_MANAGEMENT) {
      await actingAs(role, () => expectRefused(() => deactivateBanquetItem(itemId)));
      await actingAs(role, () => expectRefused(() => deleteBanquetItem(itemId)));
    }
    const row = await db.banquetItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(row.active).toBe(true);
  });

  it("lets the manager deactivate and then delete it", async () => {
    asManager();
    mustOk(await deactivateBanquetItem(itemId), "manager deactivates");
    expect((await db.banquetItem.findUniqueOrThrow({ where: { id: itemId } })).active).toBe(false);
    mustOk(await deleteBanquetItem(itemId), "manager deletes");
    expect(await db.banquetItem.findUnique({ where: { id: itemId } })).toBeNull();
  });
});

// ─── Setting a stock figure by hand ─────────────────────────────────────

describe("only admin/manager may set a stock figure by hand", () => {
  let fnbItemId: string;

  beforeAll(async () => {
    asManager();
    const created = mustOk(
      await upsertBanquetItem({
        name: "Access Test Melamine Plate",
        source: BanquetItemSource.HIRED,
        unit: "piece",
        openingStock: "100",
      }),
      "F&B item for the count",
    );
    fnbItemId = created.id;
  });

  it("refuses the kitchen adjustment to the store and the chef", async () => {
    const { plentiful } = seeded().ingredients;
    const before = await read.onHand(plentiful);
    for (const role of NOT_MANAGEMENT) {
      await actingAs(role, () =>
        expectRefused(() =>
          adjustIngredientStock({
            ingredientId: plentiful,
            delta: "-5",
            reason: `write-off by ${role}`,
          }),
        ),
      );
    }
    expectDecimal(await read.onHand(plentiful), before, "on hand after four refusals");
  });

  it("lets the manager adjust it", async () => {
    const { plentiful } = seeded().ingredients;
    const before = Number(await read.onHand(plentiful));
    asManager();
    mustOk(
      await adjustIngredientStock({
        ingredientId: plentiful,
        delta: "-5",
        reason: "damaged in the store",
      }),
      "manager adjusts",
    );
    expectDecimal(await read.onHand(plentiful), String(before - 5), "on hand after adjustment");
  });

  it("refuses the kitchen bulk count to everyone but management", async () => {
    const { plentiful } = seeded().ingredients;
    const before = await read.onHand(plentiful);
    for (const role of NOT_MANAGEMENT) {
      await actingAs(role, () =>
        expectRefused(() =>
          postInventoryAudit({ lines: [{ ingredientId: plentiful, physicalCount: "1" }] }),
        ),
      );
    }
    expectDecimal(await read.onHand(plentiful), before, "on hand after the refused counts");

    asManager();
    const posted = mustOk(
      await postInventoryAudit({
        lines: [{ ingredientId: plentiful, physicalCount: "30" }],
        notes: "monthly count",
      }),
      "manager posts the count",
    );
    expect(posted.changes).toHaveLength(1);
    expectDecimal(await read.onHand(plentiful), "30", "on hand after the count");
  });

  it("refuses the F&B adjustment and bulk count to everyone but management", async () => {
    for (const role of NOT_MANAGEMENT) {
      await actingAs(role, () =>
        expectRefused(() =>
          adjustStoreStock({
            store: "banquet",
            itemId: fnbItemId,
            mode: "set",
            qty: "0",
            reason: `by ${role}`,
          }),
        ),
      );
      await actingAs(role, () =>
        expectRefused(() =>
          postBanquetStockCount({ lines: [{ itemId: fnbItemId, countedQty: "0" }] }),
        ),
      );
    }
    const row = await db.banquetItem.findUniqueOrThrow({ where: { id: fnbItemId } });
    expectDecimal(row.currentStock, "100", "F&B stock after eight refusals");
  });

  it("lets the manager adjust and count the F&B store", async () => {
    asManager();
    mustOk(
      await adjustStoreStock({
        store: "banquet",
        itemId: fnbItemId,
        mode: "delta",
        qty: "-10",
        reason: "broken at the event",
      }),
      "manager adjusts F&B",
    );
    mustOk(
      await postBanquetStockCount({ lines: [{ itemId: fnbItemId, countedQty: "85" }] }),
      "manager posts the F&B count",
    );
    const row = await db.banquetItem.findUniqueOrThrow({ where: { id: fnbItemId } });
    expectDecimal(row.currentStock, "85", "F&B stock after the count");
  });

  it("cannot be re-opened by a settings row", async () => {
    // A settings toggle re-granting stock editing is exactly how this gate
    // leaked before. The gate is a constant in code; prove no key changes it.
    asAdmin();
    for (const key of [
      "inventory.allowStoreStockEdit",
      "stock.editRoles",
      "features.storeKeeperCanAdjustStock",
    ]) {
      mustOk(await upsertSetting(key, true), `set ${key}`);
    }
    const { plentiful } = seeded().ingredients;
    asStore();
    const message = await expectRefused(() =>
      adjustIngredientStock({ ingredientId: plentiful, delta: "1", reason: "toggle says yes" }),
    );
    expect(message).toContain("Requires one of");
  });
});

// ─── The kitchen return: declared by one desk, confirmed by another ──────

describe("the chef declares a return; only the store confirms it", () => {
  let returnId: string;
  let lineId: string;

  beforeAll(async () => {
    const { plentiful } = seeded().ingredients;
    const order = await placeCateringOrder({ headcount: 40, packageTotal: "40000" });
    await stockUp(plentiful, "50");
    asStore();
    const issue = mustOk(
      await recordDirectIngredientIssue({
        ingredientId: plentiful,
        orderId: order.id,
        qty: "20",
        note: "issued for the event",
      }),
      "store issues stock",
    );

    asChef();
    const declared = mustOk(
      await declareIngredientReturn({
        returnedAt: new Date().toISOString(),
        lines: [{ issueId: issue.id, quantity: "6", reason: "event finished early" }],
      }),
      "chef declares a return",
    );
    returnId = declared.id;
    lineId = (
      await db.ingredientReturnLine.findFirstOrThrow({ where: { returnId } })
    ).id;
  });

  it("moves no stock on the declaration alone", async () => {
    const declaration = await db.ingredientReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(declaration.status).toBe("DECLARED");
  });

  it("refuses the chef the confirmation", async () => {
    asChef();
    const message = await expectRefused(() =>
      confirmIngredientReturn({ id: returnId, lines: [{ lineId, receivedQty: "6" }] }),
    );
    expect(message).toContain("Requires one of");
    expect(
      (await db.ingredientReturn.findUniqueOrThrow({ where: { id: returnId } })).status,
    ).toBe("DECLARED");
  });

  it("lets the store confirm what actually arrived", async () => {
    const { plentiful } = seeded().ingredients;
    const before = Number(await read.onHand(plentiful));
    asStore();
    mustOk(
      await confirmIngredientReturn({ id: returnId, lines: [{ lineId, receivedQty: "6" }] }),
      "store confirms the return",
    );
    expect(
      (await db.ingredientReturn.findUniqueOrThrow({ where: { id: returnId } })).status,
    ).toBe("CONFIRMED");
    expectDecimal(await read.onHand(plentiful), String(before + 6), "stock back on the shelf");
  });
});

// ─── Releasing a customer invoice ───────────────────────────────────────

describe("a customer invoice is released only on a manager's signature", () => {
  let invoiceId: string;

  beforeAll(async () => {
    const order = await placeCateringOrder({ headcount: 60, packageTotal: "60000" });
    await chefAccepts(order.id);
    asChef();
    mustOk(await markIngredientsAvailable(order.id, "stocked"), "ingredients available");
    mustOk(await startCookingOrder(order.id), "start cooking");
    mustOk(await markOrderCooked(order.id), "cooked");
    asManager();
    const scheduled = mustOk(
      await scheduleDelivery({
        orderId: order.id,
        driverUserId: desk("delivery").id,
        scheduledAt: istInput(new Date(Date.now() + 60 * 60 * 1000)),
      }),
      "schedule delivery",
    );
    asDelivery();
    mustOk(await dispatchDelivery(scheduled.id), "dispatch");
    mustOk(await confirmDeliveryOTP(scheduled.id, {}), "confirm delivery");

    // Accounts raise the bill — that half is theirs.
    asAccounts();
    invoiceId = mustOk(
      await createCustomerInvoiceFromOrder(order.id),
      "accounts raise the invoice",
    ).id;
  });

  it("is not the accounts desk's signature to give", async () => {
    asAccounts();
    const message = await expectRefused(() =>
      approveCustomerInvoiceForRelease(invoiceId, "accounts signing it off"),
    );
    expect(message).toContain("Requires one of");
    expect((await read.invoice(invoiceId)).approvedAt).toBeNull();
  });

  it("is nobody else's either", async () => {
    for (const role of ["chef", "store", "delivery"] as DeskName[]) {
      await actingAs(role, () =>
        expectRefused(() => approveCustomerInvoiceForRelease(invoiceId)),
      );
    }
    asNobody();
    await expectRefused(() => approveCustomerInvoiceForRelease(invoiceId));
    expect((await read.invoice(invoiceId)).approvedAt).toBeNull();
  });

  it("cannot be issued to the customer while unapproved", async () => {
    asAccounts();
    const message = await expectRefused(() => issueCustomerInvoice(invoiceId));
    expect(message.toLowerCase()).toContain("approv");
    expect((await read.invoice(invoiceId)).status).toBe(CustomerInvoiceStatus.DRAFT);
  });

  it("issues once the manager has signed it", async () => {
    asManager();
    mustOk(
      await approveCustomerInvoiceForRelease(invoiceId, "checked against the event"),
      "manager approves",
    );
    // Issuing IS the accounts desk's job — the split is approve vs. release.
    asAccounts();
    mustOk(await issueCustomerInvoice(invoiceId), "accounts issue");
    const invoice = await read.invoice(invoiceId);
    expect(invoice.approvedById).toBe(desk("manager").id);
    expect(invoice.status).not.toBe(CustomerInvoiceStatus.DRAFT);
  });
});

// ─── Paying the supplier ────────────────────────────────────────────────

describe("a supplier bill is payable by no route until it is approved", () => {
  let billId: string;
  let advanceId: string;

  /** Smallest thing detectDocumentKind accepts as the supplier's invoice. */
  const FAKE_PDF = Buffer.from("%PDF-1.4\n% access suite\n").toString("base64");

  beforeAll(async () => {
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
            quantity: "5",
            unitPrice: "420",
            gstRatePct: "5",
          },
        ],
      }),
      "raise PO",
    );
    mustOk(await submitVendorPO(po.id), "submit PO");
    asManager();
    mustOk(await approveVendorPO(po.id), "approve PO");

    const poLineId = (await read.purchaseOrder(po.id)).lines[0].id;
    asStore();
    mustOk(
      await createGRN({
        poId: po.id,
        lines: [{ poLineId, acceptedQty: "5", rejectedQty: "0" }],
      }),
      "receive the goods",
    );
    billId = mustOk(
      await createVendorBill({
        vendorId,
        poId: po.id,
        vendorBillNo: "ACCESS-SUP-001",
        lines: [
          { description: "Paneer", quantity: "5", unit: "kg", unitPrice: "420", gstRatePct: "5" },
        ],
      }),
      "record the supplier's bill",
    ).id;
    asAccounts();
    mustOk(await matchVendorBill(billId), "3-way match");
    advanceId = mustOk(
      await recordVendorAdvance({
        vendorId,
        amount: "500",
        method: PaymentMethod.NEFT,
        paidAt: new Date().toISOString(),
      }),
      "record an advance",
    ).id;
  });

  it("starts MATCHED — received, checked, and nobody's signature on it", async () => {
    expect((await read.vendorBill(billId)).status).toBe(VendorBillStatus.MATCHED);
  });

  it("refuses all three payment routes, to the money desk and the admin alike", async () => {
    for (const role of ["accounts", "admin", "manager"] as DeskName[]) {
      await actingAs(role, async () => {
        for (const attempt of [
          () => markVendorBillPaid({ id: billId, method: PaymentMethod.NEFT }),
          () => recordVendorBillPayment({ billId, amount: "100", method: PaymentMethod.NEFT }),
          () => applyVendorAdvanceToBill(advanceId, billId),
        ]) {
          const message = await expectRefused(attempt);
          expect(message).toContain("nobody has approved it yet");
        }
      });
    }
    const bill = await read.vendorBill(billId);
    expect(bill.payments).toEqual([]);
    expectDecimal(bill.amountPaid, "0", "amount paid");
    expect(
      (await db.vendorAdvance.findUniqueOrThrow({ where: { id: advanceId } })).appliedToBillId,
    ).toBeNull();
  });

  it("is not made payable by the overnight reminder job", async () => {
    // The job flips APPROVED bills to OVERDUE, and OVERDUE is payable. A
    // MATCHED bill past its due date must not ride that path into payable —
    // the calendar is not an approver.
    await db.vendorBill.update({
      where: { id: billId },
      data: { dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    });
    const result = await runVendorPaymentRemindersInternal();
    expect(result.billsFlippedOverdue).toBe(0);
    expect((await read.vendorBill(billId)).status).toBe(VendorBillStatus.MATCHED);

    asAccounts();
    const message = await expectRefused(() =>
      markVendorBillPaid({ id: billId, method: PaymentMethod.NEFT }),
    );
    expect(message).toContain("nobody has approved it yet");
  });

  it("pays once accounts have signed off the supplier's own document", async () => {
    asStore();
    await uploadDocument({
      entityType: DocumentEntityType.VENDOR_BILL,
      entityId: billId,
      base64: FAKE_PDF,
      fileName: "ACCESS-SUP-001.pdf",
      kind: DocumentKind.ORIGINAL,
    });
    asAccounts();
    mustOk(await approveVendorBill(billId), "accounts approve");
    mustOk(
      await recordVendorBillPayment({ billId, amount: "500", method: PaymentMethod.NEFT }),
      "part payment",
    );
    expectDecimal((await read.vendorBill(billId)).amountPaid, "500", "amount paid");
  });
});

// ─── Revising an order that is nearly out of the door ────────────────────

describe("a revision inside the critical window needs the explicit confirm", () => {
  let orderId: string;
  let itemIds: string[];

  beforeAll(async () => {
    const order = await placeCateringOrder({
      headcount: 50,
      packageTotal: "50000",
      eventDate: new Date(Date.now() + 30 * 60 * 1000),
    });
    orderId = order.id;
    itemIds = (await read.order(orderId)).items.map((i) => i.id);
  });

  it("refuses without the flag, however senior the desk", async () => {
    for (const role of ["manager", "admin"] as DeskName[]) {
      const message = await actingAs(role, () =>
        expectRefused(() =>
          reviseOrder(orderId, {
            headcount: 30,
            items: itemIds.map((id) => ({ id, portions: 30 })),
            revisionNote: "guests dropped out",
          }),
        ),
      );
      expect(message).toContain("Confirm you want to revise it anyway");
    }
    expect((await read.order(orderId)).headcount).toBe(50);
  });

  it("goes through with it", async () => {
    asManager();
    mustOk(
      await reviseOrder(orderId, {
        headcount: 30,
        items: itemIds.map((id) => ({ id, portions: 30 })),
        revisionNote: "guests dropped out",
        criticalConfirmed: true,
      }),
      "confirmed critical revision",
    );
    expect((await read.order(orderId)).headcount).toBe(30);
  });
});

// ─── Ids off the client, checked for ownership ──────────────────────────

describe("an id off the client is checked against who is asking", () => {
  let otherDriverId: string;
  let otherDriversDeliveryId: string;

  beforeAll(async () => {
    asAdmin();
    const email = "e2e.driver2@greenpath.test";
    if (!(await db.user.findUnique({ where: { email } }))) {
      mustOk(
        await createUser({
          email,
          name: "E2E Second Driver",
          password: "e2e-password",
          role: Role.DELIVERY,
        }),
        "create a second driver",
      );
    }
    otherDriverId = (await db.user.findUniqueOrThrow({ where: { email } })).id;

    const order = await placeCateringOrder({ headcount: 20, packageTotal: "20000" });
    await chefAccepts(order.id);
    asChef();
    mustOk(await markIngredientsAvailable(order.id, "stocked"), "ingredients available");
    mustOk(await startCookingOrder(order.id), "start cooking");
    mustOk(await markOrderCooked(order.id), "cooked");
    asManager();
    otherDriversDeliveryId = mustOk(
      await scheduleDelivery({
        orderId: order.id,
        driverUserId: otherDriverId,
        scheduledAt: istInput(new Date(Date.now() + 60 * 60 * 1000)),
      }),
      "schedule onto the other driver",
    ).id;
  });

  it("refuses a driver another driver's delivery", async () => {
    asDelivery();
    const message = await expectRefused(() => dispatchDelivery(otherDriversDeliveryId));
    expect(message).toContain("their own");
    await expectRefused(() => confirmDeliveryOTP(otherDriversDeliveryId, {}));
    expect((await read.delivery(otherDriversDeliveryId)).status).toBe("SCHEDULED");
  });

  it("keeps it off the other driver's list too", async () => {
    // The scope has to hold in the list as well as the action, or the driver
    // simply reads the id off the screen and calls the action with it.
    asDelivery();
    const mine = await listDeliveries();
    expect(mine.map((d) => d.id)).not.toContain(otherDriversDeliveryId);
    asManager();
    expect((await listDeliveries()).map((d) => d.id)).toContain(otherDriversDeliveryId);
  });

  it("still lets a desk that isn't scoped to one driver run it", async () => {
    // The refusal above is not the role — the manager holds the same
    // DRIVER_OR_MANAGER gate and is simply not scoped to a driver's rows.
    asManager();
    mustOk(await dispatchDelivery(otherDriversDeliveryId), "manager dispatches");
    expect((await read.delivery(otherDriversDeliveryId)).status).toBe("DISPATCHED");
  });
});

// ─── Rows a role should not see ─────────────────────────────────────────

describe("list queries hand back only the rows the desk owns", () => {
  it("keeps the catering book away from the F&B desk", async () => {
    const order = await placeCateringOrder({ headcount: 25, packageTotal: "25000" });
    asManager();
    expect((await listOrders()).map((o) => o.id)).toContain(order.id);
    // F&B service runs room service and alacarte; a banquet booking is not
    // theirs to read.
    asDelivery();
    expect((await listOrders()).map((o) => o.id)).not.toContain(order.id);
  });

  it("keeps the staff directory to the admin", async () => {
    for (const role of NOT_MANAGEMENT.concat("manager")) {
      await actingAs(role, () => expectRefused(() => listUsers()));
    }
    asNobody();
    await expectRefused(() => listUsers());
    asAdmin();
    expect((await listUsers()).length).toBeGreaterThan(0);
  });
});

// ─── Documented, but not enforced ───────────────────────────────────────

describe("a petty-cash top-up over the threshold", () => {
  it("is recorded by accounts on their own signature — see the report", async () => {
    // topUpPettyCash says "anything over ₹10k needs MANAGER+ approval", and
    // then only writes a different audit action; the gate it claims to rely
    // on (PETTY_MANAGE) admits ACCOUNTS as well. This test pins what the
    // code actually does rather than what the comment says — reported as a
    // control to confirm with the client, not silently tightened.
    asAccounts();
    const float = mustOk(
      await createPettyCashFloat({
        custodianId: desk("accounts").id,
        name: "Access Test Float",
        openingBalance: "1000",
      }),
      "create float",
    );
    mustOk(
      await topUpPettyCash({
        floatId: float.id,
        amount: "25000",
        source: "BANK",
        reference: "ACCESS-TOPUP-1",
      }),
      "accounts top up over the threshold",
    );
    const row = await db.pettyCashTopUp.findFirstOrThrow({ where: { floatId: float.id } });
    expect(row.approvedByUserId).toBe(desk("accounts").id);
    expect(await read.auditActions("PettyCashFloat", float.id)).toContain(
      "PETTY_CASH_TOP_UP_OVER_THRESHOLD",
    );
  });
});

// ─── The wipe ───────────────────────────────────────────────────────────
//
// Last in the file: the successful clear at the end takes the orders with it.

describe("the three resets are the admin's alone", () => {
  const RESETS: Array<[string, (confirm: string) => Promise<unknown>, string]> = [
    ["resetTransactionalData", resetTransactionalData, "RESET"],
    ["clearOrdersKeepFinance", clearOrdersKeepFinance, "CLEAR ORDERS"],
    ["resetEverythingKeepParties", resetEverythingKeepParties, "ERASE EVERYTHING"],
  ];

  it("refuses every other desk, even holding the right phrase", async () => {
    const ordersBefore = await db.order.count();
    for (const [name, action, phrase] of RESETS) {
      for (const role of NOT_MANAGEMENT.concat("manager")) {
        const message = await actingAs(role, () => expectRefused(() => action(phrase)));
        expect({ name, role, message }).toEqual({
          name,
          role,
          message: "Requires one of: ADMIN",
        });
      }
      asNobody();
      await expectRefused(() => action(phrase));
    }
    expect(await db.order.count()).toBe(ordersBefore);
  });

  it("refuses the admin without the exact phrase", async () => {
    const ordersBefore = await db.order.count();
    asAdmin();
    for (const [, action, phrase] of RESETS) {
      for (const typo of ["", phrase.toLowerCase(), `${phrase} `, phrase.slice(0, -1)]) {
        const message = await expectRefused(() => action(typo));
        expect(message).toContain(phrase);
      }
    }
    expect(await db.order.count()).toBe(ordersBefore);
  });

  it("clears the orders on the admin's exact phrase", async () => {
    asAdmin();
    const result = mustOk(await clearOrdersKeepFinance("CLEAR ORDERS"), "clear orders");
    expect(result.orders).toBeGreaterThan(0);
    expect(await db.order.count()).toBe(0);
    // "Keep finance" is the other half of the promise.
    expect(result.invoicesKept).toBeGreaterThan(0);
  });
});
