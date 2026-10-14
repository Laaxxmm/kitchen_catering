// FIRST import, always — pins DATABASE_URL to the e2e container.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { upsertHousekeepingItem } from "@/server/actions/housekeeping";
import {
  createDeptPurchaseOrder,
  decideDeptPurchaseOrder,
  markDeptPurchaseOrdered,
  receiveDeptPurchaseOrder,
  submitDeptPurchaseOrder,
} from "@/server/actions/dept-purchase";
import { asAdmin, asHousekeeping, asManager, ensureSeeded, istInput, mustOk } from "../harness";

/**
 * Regressions for the 14 Oct security review of the stock request / PO
 * flow: a manager approving their own request, the same supplier bill
 * booked twice, an item's unit changed between approval and receipt, and
 * receipt dates far from today.
 */

const tag = Date.now();

async function hkItem(name: string) {
  return mustOk(
    await upsertHousekeepingItem({ name: `${name} ${tag}`, unit: "piece", active: true }),
    `hk item ${name}`,
  ).id;
}

/** An HK request raised by the HK head, approved by the manager, ordered. */
async function orderedRequest(itemId: string, quantity = "10") {
  asHousekeeping();
  const po = mustOk(
    await createDeptPurchaseOrder({ department: "HOUSEKEEPING", reason: "Security regression", lines: [{ itemId, quantity }] }),
    "create",
  );
  mustOk(await submitDeptPurchaseOrder(po.id), "submit");
  asManager();
  mustOk(await decideDeptPurchaseOrder(po.id, { decision: "APPROVE" }), "approve");
  asHousekeeping();
  mustOk(await markDeptPurchaseOrdered(po.id, { supplierName: "Supplier Co" }), "ordered");
  const line = await db.deptPurchaseOrderLine.findFirstOrThrow({ where: { poId: po.id } });
  return { poId: po.id, lineId: line.id };
}

beforeAll(async () => {
  await ensureSeeded();
});

describe("stock request hardening", () => {
  it("a manager cannot approve a request they raised; an admin can", async () => {
    const itemId = await hkItem("Self approve");
    asManager();
    const po = mustOk(
      await createDeptPurchaseOrder({ department: "HOUSEKEEPING", reason: "Own request", lines: [{ itemId, quantity: "2" }] }),
      "manager raises",
    );
    mustOk(await submitDeptPurchaseOrder(po.id), "submit");
    const self = await decideDeptPurchaseOrder(po.id, { decision: "APPROVE" });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.error).toMatch(/another manager or an admin/);
    asAdmin();
    mustOk(await decideDeptPurchaseOrder(po.id, { decision: "APPROVE" }), "admin approves");
  });

  it("the same supplier bill cannot be booked twice against one order", async () => {
    const itemId = await hkItem("Bill twice");
    const { poId, lineId } = await orderedRequest(itemId);
    asHousekeeping();
    const at = istInput(new Date());
    mustOk(
      await receiveDeptPurchaseOrder(poId, { receivedAt: at, supplierBillNo: "B-77", lines: [{ lineId, quantity: "4" }] }),
      "first receipt",
    );
    const again = await receiveDeptPurchaseOrder(poId, {
      receivedAt: at,
      supplierBillNo: "B-77",
      lines: [{ lineId, quantity: "4" }],
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already booked/);
    expect((await db.housekeepingItem.findUniqueOrThrow({ where: { id: itemId } })).currentStock.toString()).toBe("4");
  });

  it("a unit changed after approval stops the receipt", async () => {
    const itemId = await hkItem("Unit swap");
    const { poId, lineId } = await orderedRequest(itemId);
    // The unit-change guard now counts the request line, so the change is
    // refused through the action; force it to prove the receipt check holds.
    asHousekeeping();
    const viaAction = await upsertHousekeepingItem({ id: itemId, name: `Unit swap ${tag}`, unit: "carton", active: true });
    expect(viaAction.ok).toBe(false);
    await db.housekeepingItem.update({ where: { id: itemId }, data: { unit: "carton" } });
    const res = await receiveDeptPurchaseOrder(poId, { receivedAt: istInput(new Date()), lines: [{ lineId, quantity: "10" }] });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/now counted in carton/);
  });

  it("receipt dates stay within the last 60 days", async () => {
    const itemId = await hkItem("Old date");
    const { poId, lineId } = await orderedRequest(itemId);
    asHousekeeping();
    const old = await receiveDeptPurchaseOrder(poId, { receivedAt: "2020-01-01T10:00", lines: [{ lineId, quantity: "1" }] });
    expect(old.ok).toBe(false);
    const impossible = await markDeptPurchaseOrdered(poId, { supplierName: "X", expectedAt: "2026-02-31" });
    expect(impossible.ok).toBe(false);
  });
});
