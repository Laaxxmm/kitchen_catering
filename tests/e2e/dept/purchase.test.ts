// FIRST import, always — pins DATABASE_URL to the e2e container.
import "../harness/database-url";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { upsertHousekeepingItem } from "@/server/actions/housekeeping";
import { upsertMaintenanceItem } from "@/server/actions/maintenance";
import {
  cancelDeptPurchaseOrder,
  closeDeptPurchaseOrderShort,
  createDeptPurchaseOrder,
  decideDeptPurchaseOrder,
  getDeptPurchaseOrder,
  listDeptItemsForPurchase,
  listDeptPurchaseOrders,
  listDeptPurchaseOrdersAwaitingApproval,
  markDeptPurchaseOrdered,
  receiveDeptPurchaseOrder,
  submitDeptPurchaseOrder,
  updateDeptPurchaseOrder,
} from "@/server/actions/dept-purchase";
import {
  actingAs,
  asAdmin,
  asHousekeeping,
  asMaintenance,
  asManager,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  flushDeferred,
  istInput,
  mustOk,
  type DeskName,
} from "../harness";

/**
 * Housekeeping / maintenance stock requests, end to end: the department head
 * raises and submits, an admin / manager approves (or rejects), the head
 * places the order and receives the goods into the department's own store.
 * Plus the department isolation that keeps one head out of the other's POs.
 *
 * Every row this file creates carries a unique suffix; assertions are scoped
 * to those rows.
 */

const tag = Date.now();
const now = () => istInput(new Date());

let hkSoap: string;
let hkTowel: string;
let mtBulb: string;
let mtPipe: string;

async function hkItem(name: string) {
  return mustOk(
    await upsertHousekeepingItem({ name: `${name} ${tag}`, unit: "piece", active: true }),
    `hk item ${name}`,
  ).id;
}

async function mtItem(name: string) {
  return mustOk(
    await upsertMaintenanceItem({ name: `${name} ${tag}`, unit: "piece", category: "GENERAL", active: true }),
    `mt item ${name}`,
  ).id;
}

const hkStock = async (id: string) =>
  (await db.housekeepingItem.findUniqueOrThrow({ where: { id } })).currentStock;
const mtStock = async (id: string) =>
  (await db.maintenanceItem.findUniqueOrThrow({ where: { id } })).currentStock;
const statusOf = async (id: string) =>
  (await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id } })).status;
const linesOf = (poId: string) =>
  db.deptPurchaseOrderLine.findMany({ where: { poId }, orderBy: { sortOrder: "asc" } });

function hkDraft(lines: Array<{ itemId: string; quantity: string; rate?: string }>) {
  return createDeptPurchaseOrder({ department: "HOUSEKEEPING", reason: "Weekend full house", lines });
}

function mtDraft(lines: Array<{ itemId: string; quantity: string; rate?: string }>) {
  return createDeptPurchaseOrder({ department: "MAINTENANCE", reason: "Corridor lights", lines });
}

/** A housekeeping PO driven to APPROVED (as asked) — for the isolation cases. */
async function approvedHkPo(itemId: string, quantity: string) {
  asHousekeeping();
  const { id } = mustOk(await hkDraft([{ itemId, quantity }]), "hk draft");
  mustOk(await submitDeptPurchaseOrder(id), "hk submit");
  await actingAs("manager", async () => mustOk(await decideDeptPurchaseOrder(id, { decision: "APPROVE" }), "approve"));
  return id;
}

beforeAll(async () => {
  await ensureSeeded();
  asHousekeeping();
  hkSoap = await hkItem("PO Soap");
  hkTowel = await hkItem("PO Towel");
  asMaintenance();
  mtBulb = await mtItem("PO Bulb");
  mtPipe = await mtItem("PO Pipe");
});

describe("housekeeping: request → approval → order → receipt", () => {
  let poId: string;

  it("the housekeeping head raises a draft, with the item names snapshotted", async () => {
    asHousekeeping();
    const res = mustOk(
      await hkDraft([
        { itemId: hkSoap, quantity: "10", rate: "25" },
        { itemId: hkTowel, quantity: "4" },
      ]),
      "create",
    );
    poId = res.id;
    expect(res.number).toMatch(/^HK-PO-/);
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("DRAFT");
    expect(po.department).toBe("HOUSEKEEPING");
    expect(po.createdById).toBe(desk("housekeeping").id);
    expectDecimal(po.estimatedTotal, "250", "estimated total");
    const lines = await linesOf(poId);
    expect(lines.map((l) => [l.hkItemId, l.mtItemId, l.itemName])).toEqual([
      [hkSoap, null, `PO Soap ${tag}`],
      [hkTowel, null, `PO Towel ${tag}`],
    ]);
  });

  it("refuses a duplicate item, a quantity that rounds to 0, and over 100 lines", async () => {
    asHousekeeping();
    expect(
      await expectRefused(() =>
        hkDraft([
          { itemId: hkSoap, quantity: "1" },
          { itemId: hkSoap, quantity: "2" },
        ]),
      ),
    ).toMatch(/already on the order/);
    expect(await expectRefused(() => hkDraft([{ itemId: hkSoap, quantity: "0.0004" }]))).toMatch(/more than 0/);
    const many = Array.from({ length: 101 }, (_, i) => ({ itemId: `x${i}`, quantity: "1" }));
    expect(await expectRefused(() => hkDraft(many))).toMatch(/100 lines/);
  });

  it("a draft can be edited; its lines are replaced", async () => {
    asHousekeeping();
    mustOk(
      await updateDeptPurchaseOrder(poId, {
        reason: "Weekend full house + wedding",
        lines: [
          { itemId: hkSoap, quantity: "8", rate: "25" },
          { itemId: hkTowel, quantity: "4", rate: "300" },
        ],
      }),
      "update",
    );
    const lines = await linesOf(poId);
    expect(lines).toHaveLength(2);
    expectDecimal(lines[0].quantity, "8", "soap asked");
    expectDecimal((await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id: poId } })).estimatedTotal, "1400");
  });

  it("submitting notifies every admin and manager", async () => {
    asHousekeeping();
    mustOk(await submitDeptPurchaseOrder(poId), "submit");
    expect(await statusOf(poId)).toBe("PENDING_APPROVAL");
    await flushDeferred();
    const told = await db.notification.findMany({ where: { dedupeKey: `dept-po-submitted:${poId}` } });
    const ids = told.map((n) => n.userId);
    expect(ids).toContain(desk("admin").id);
    expect(ids).toContain(desk("manager").id);
    expect(ids).not.toContain(desk("housekeeping").id);
    expect(told[0].link).toBe(`/housekeeping/purchase/${poId}`);
  });

  it("a submitted request can no longer be edited", async () => {
    asHousekeeping();
    const why = await expectRefused(() =>
      updateDeptPurchaseOrder(poId, { reason: "late edit", lines: [{ itemId: hkSoap, quantity: "99" }] }),
    );
    expect(why).toMatch(/Only a draft/);
  });

  it("the housekeeping head cannot approve, even their own request", async () => {
    asHousekeeping();
    const why = await expectRefused(() => decideDeptPurchaseOrder(poId, { decision: "APPROVE" }));
    expect(why).toMatch(/^Requires one of/);
    expect(await statusOf(poId)).toBe("PENDING_APPROVAL");
  });

  it("the manager approves with a cut quantity, and may not approve more than asked", async () => {
    asManager();
    const [soapLine] = await linesOf(poId);
    expect(
      await expectRefused(() =>
        decideDeptPurchaseOrder(poId, { decision: "APPROVE", lines: [{ lineId: soapLine.id, approvedQty: "9" }] }),
      ),
    ).toMatch(/at most/);
    mustOk(
      await decideDeptPurchaseOrder(poId, {
        decision: "APPROVE",
        note: "Six is plenty",
        lines: [{ lineId: soapLine.id, approvedQty: "6" }],
      }),
      "approve",
    );
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("APPROVED");
    expect(po.decidedById).toBe(desk("manager").id);
    expectDecimal(po.estimatedTotal, "1350", "total on approved qty");
    const [soap, towel] = await linesOf(poId);
    expectDecimal(soap.approvedQty, "6", "soap approved");
    expectDecimal(towel.approvedQty, "4", "towel approved as asked");
    await flushDeferred();
    const told = await db.notification.findMany({ where: { dedupeKey: `dept-po-decided:${poId}` } });
    expect(told.map((n) => [n.userId, n.title])).toEqual([[desk("housekeeping").id, "Stock request approved"]]);
  });

  it("the head marks it ordered with the supplier", async () => {
    asHousekeeping();
    expect(await expectRefused(() => markDeptPurchaseOrdered(poId, {}))).toMatch(/supplier/);
    mustOk(await markDeptPurchaseOrdered(poId, { supplierName: "Clean Co", supplierPhone: "98450 00000" }), "ordered");
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("ORDERED");
    expect(po.supplierName).toBe("Clean Co");
    expect(po.orderedAt).not.toBeNull();
  });

  it("refuses over-receipt and a zero receipt, moving no stock", async () => {
    asHousekeeping();
    const [soap] = await linesOf(poId);
    const before = await hkStock(hkSoap);
    expect(
      await expectRefused(() =>
        receiveDeptPurchaseOrder(poId, { receivedAt: now(), lines: [{ lineId: soap.id, quantity: "7" }] }),
      ),
    ).toMatch(/only 6 piece left/);
    expect(
      await expectRefused(() =>
        receiveDeptPurchaseOrder(poId, { receivedAt: now(), lines: [{ lineId: soap.id, quantity: "0" }] }),
      ),
    ).toMatch(/more than 0/);
    expectDecimal(await hkStock(hkSoap), before.toString(), "soap stock unchanged");
    expect(await db.housekeepingReceipt.count({ where: { purchaseOrderId: poId } })).toBe(0);
  });

  it("first delivery: stock rises by exactly what arrived; the receipt links to the PO and line", async () => {
    asHousekeeping();
    const [soap] = await linesOf(poId);
    const before = await hkStock(hkSoap);
    const res = mustOk(
      await receiveDeptPurchaseOrder(poId, {
        receivedAt: now(),
        supplierBillNo: "CC-101",
        lines: [{ lineId: soap.id, quantity: "4" }],
      }),
      "receive part 1",
    );
    expect(res.status).toBe("PARTIALLY_RECEIVED");
    expect(await statusOf(poId)).toBe("PARTIALLY_RECEIVED");
    expectDecimal(await hkStock(hkSoap), before.plus(4).toString(), "soap stock");
    const receipt = await db.housekeepingReceipt.findUniqueOrThrow({
      where: { id: res.receiptId },
      include: { lines: true },
    });
    expect(receipt.purchaseOrderId).toBe(poId);
    expect(receipt.supplierBillNo).toBe("CC-101");
    expect(receipt.sourceNote).toMatch(/^HK-PO-/);
    expect(receipt.recordedById).toBe(desk("housekeeping").id);
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0].poLineId).toBe(soap.id);
    expect(receipt.lines[0].itemId).toBe(hkSoap);
    expectDecimal(receipt.lines[0].costPerUnit, "25", "cost defaults to the line rate");
    expectDecimal((await linesOf(poId))[0].receivedQty, "4", "line received");
  });

  it("cannot be cancelled once goods have arrived", async () => {
    asHousekeeping();
    expect(await expectRefused(() => cancelDeptPurchaseOrder(poId, "changed our mind"))).toMatch(/close it short/);
    expect(await statusOf(poId)).toBe("PARTIALLY_RECEIVED");
  });

  it("second delivery completes it: RECEIVED, and nothing more can arrive", async () => {
    asHousekeeping();
    const [soap, towel] = await linesOf(poId);
    const soapBefore = await hkStock(hkSoap);
    const towelBefore = await hkStock(hkTowel);
    const res = mustOk(
      await receiveDeptPurchaseOrder(poId, {
        receivedAt: now(),
        lines: [
          { lineId: soap.id, quantity: "2", costPerUnit: "24.5" },
          { lineId: towel.id, quantity: "4" },
        ],
      }),
      "receive part 2",
    );
    expect(res.status).toBe("RECEIVED");
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id: poId } });
    expect(po.status).toBe("RECEIVED");
    expect(po.closedAt).not.toBeNull();
    expectDecimal(await hkStock(hkSoap), soapBefore.plus(2).toString(), "soap");
    expectDecimal(await hkStock(hkTowel), towelBefore.plus(4).toString(), "towel");
    expect(await db.housekeepingReceipt.count({ where: { purchaseOrderId: poId } })).toBe(2);
    expect(
      await expectRefused(() =>
        receiveDeptPurchaseOrder(poId, { receivedAt: now(), lines: [{ lineId: soap.id, quantity: "1" }] }),
      ),
    ).toMatch(/approved or ordered/);
  });

  it("the detail read carries the lines and both receipts", async () => {
    asHousekeeping();
    const res = await getDeptPurchaseOrder(poId);
    if (!res.ok) throw new Error(res.error);
    expect(res.po.lines).toHaveLength(2);
    expect(res.po.receipts).toHaveLength(2);
    expect(res.po.decidedBy?.name).toBeTruthy();
  });
});

describe("rejection", () => {
  it("needs a note, and tells the person who asked", async () => {
    asHousekeeping();
    const { id } = mustOk(await hkDraft([{ itemId: hkTowel, quantity: "50" }]), "draft");
    mustOk(await submitDeptPurchaseOrder(id), "submit");
    asManager();
    expect(await expectRefused(() => decideDeptPurchaseOrder(id, { decision: "REJECT" }))).toMatch(/reason/);
    expect(await expectRefused(() => decideDeptPurchaseOrder(id, { decision: "REJECT", note: " " }))).toMatch(/reason/);
    expect(await statusOf(id)).toBe("PENDING_APPROVAL");
    mustOk(await decideDeptPurchaseOrder(id, { decision: "REJECT", note: "Fifty is too many" }), "reject");
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id } });
    expect(po.status).toBe("REJECTED");
    expect(po.decisionNote).toBe("Fifty is too many");
    await flushDeferred();
    const told = await db.notification.findMany({ where: { dedupeKey: `dept-po-decided:${id}` } });
    expect(told).toHaveLength(1);
    expect(told[0].userId).toBe(desk("housekeeping").id);
    expect(told[0].title).toBe("Stock request rejected");
    expect(told[0].body).toMatch(/Fifty is too many/);
    // Terminal.
    expect(await expectRefused(() => decideDeptPurchaseOrder(id, { decision: "APPROVE" }))).toMatch(/isn't waiting/);
  });

  it("approving every line at 0 is refused — that is a rejection", async () => {
    asHousekeeping();
    const { id } = mustOk(await hkDraft([{ itemId: hkTowel, quantity: "2" }]), "draft");
    mustOk(await submitDeptPurchaseOrder(id), "submit");
    const [line] = await linesOf(id);
    asAdmin();
    expect(
      await expectRefused(() =>
        decideDeptPurchaseOrder(id, { decision: "APPROVE", lines: [{ lineId: line.id, approvedQty: "0" }] }),
      ),
    ).toMatch(/at least one line/);
  });

  it("a draft can be cancelled with a reason", async () => {
    asHousekeeping();
    const { id } = mustOk(await hkDraft([{ itemId: hkTowel, quantity: "2" }]), "draft");
    expect(await expectRefused(() => cancelDeptPurchaseOrder(id, ""))).toMatch(/reason/);
    mustOk(await cancelDeptPurchaseOrder(id, "Raised by mistake"), "cancel");
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id } });
    expect(po.status).toBe("CANCELLED");
    expect(po.notes).toMatch(/Raised by mistake/);
  });
});

describe("department isolation", () => {
  let hkDraftId: string;
  let hkApprovedId: string;
  let mtDraftId: string;
  let mtApprovedId: string;

  beforeAll(async () => {
    asHousekeeping();
    hkDraftId = mustOk(await hkDraft([{ itemId: hkSoap, quantity: "1" }]), "hk draft").id;
    hkApprovedId = await approvedHkPo(hkSoap, "3");
    asMaintenance();
    mtDraftId = mustOk(await mtDraft([{ itemId: mtBulb, quantity: "1" }]), "mt draft").id;
    const { id } = mustOk(await mtDraft([{ itemId: mtBulb, quantity: "3" }]), "mt draft 2");
    mustOk(await submitDeptPurchaseOrder(id), "mt submit");
    await actingAs("manager", async () => mustOk(await decideDeptPurchaseOrder(id, { decision: "APPROVE" }), "approve"));
    mtApprovedId = id;
  });

  it("the maintenance head cannot read, edit, submit, order, receive or cancel a housekeeping PO", async () => {
    asMaintenance();
    const [line] = await linesOf(hkApprovedId);
    const stockBefore = await hkStock(hkSoap);
    const refusals = [
      await expectRefused(() => getDeptPurchaseOrder(hkDraftId)),
      await expectRefused(() => updateDeptPurchaseOrder(hkDraftId, { reason: "mine now", lines: [{ itemId: mtBulb, quantity: "1" }] })),
      await expectRefused(() => submitDeptPurchaseOrder(hkDraftId)),
      await expectRefused(() => markDeptPurchaseOrdered(hkApprovedId, { supplierName: "X" })),
      await expectRefused(() => receiveDeptPurchaseOrder(hkApprovedId, { receivedAt: now(), lines: [{ lineId: line.id, quantity: "1" }] })),
      await expectRefused(() => cancelDeptPurchaseOrder(hkDraftId, "not mine")),
      await expectRefused(() => cancelDeptPurchaseOrder(hkApprovedId, "not mine")),
      await expectRefused(() => closeDeptPurchaseOrderShort(hkApprovedId, "not mine")),
    ];
    // Same answer as a missing id — no hint that the order exists.
    for (const why of refusals) expect(why).toBe("Purchase order not found");
    await expectRefused(() => listDeptPurchaseOrders({ department: "HOUSEKEEPING" }));
    await expectRefused(() => listDeptItemsForPurchase("HOUSEKEEPING"));
    await expectRefused(() => listDeptPurchaseOrdersAwaitingApproval());
    expect(
      await expectRefused(() =>
        createDeptPurchaseOrder({ department: "HOUSEKEEPING", reason: "sneaky", lines: [{ itemId: hkSoap, quantity: "1" }] }),
      ),
    ).toMatch(/own department/);
    expect(await statusOf(hkDraftId)).toBe("DRAFT");
    expect(await statusOf(hkApprovedId)).toBe("APPROVED");
    expectDecimal(await hkStock(hkSoap), stockBefore.toString(), "hk stock untouched");
  });

  it("the maintenance head cannot put a housekeeping item on a maintenance order", async () => {
    asMaintenance();
    expect(await expectRefused(() => mtDraft([{ itemId: hkSoap, quantity: "1" }]))).toMatch(/isn't in the maintenance store/);
    expect(
      await expectRefused(() => updateDeptPurchaseOrder(mtDraftId, { reason: "swap", lines: [{ itemId: hkTowel, quantity: "1" }] })),
    ).toMatch(/isn't in the maintenance store/);
    const lines = await linesOf(mtDraftId);
    expect(lines.map((l) => l.mtItemId)).toEqual([mtBulb]);
  });

  it("the housekeeping head cannot touch a maintenance PO either", async () => {
    asHousekeeping();
    const [line] = await linesOf(mtApprovedId);
    const stockBefore = await mtStock(mtBulb);
    const refusals = [
      await expectRefused(() => getDeptPurchaseOrder(mtDraftId)),
      await expectRefused(() => submitDeptPurchaseOrder(mtDraftId)),
      await expectRefused(() => receiveDeptPurchaseOrder(mtApprovedId, { receivedAt: now(), lines: [{ lineId: line.id, quantity: "1" }] })),
      await expectRefused(() => cancelDeptPurchaseOrder(mtDraftId, "not mine")),
      await expectRefused(() => updateDeptPurchaseOrder(mtDraftId, { reason: "x", lines: [{ itemId: hkSoap, quantity: "1" }] })),
    ];
    for (const why of refusals) expect(why).toBe("Purchase order not found");
    await expectRefused(() => listDeptPurchaseOrders({ department: "MAINTENANCE" }));
    expect(await expectRefused(() => hkDraft([{ itemId: mtBulb, quantity: "1" }]))).toMatch(/isn't in the housekeeping store/);
    expect(await statusOf(mtDraftId)).toBe("DRAFT");
    expectDecimal(await mtStock(mtBulb), stockBefore.toString(), "mt stock untouched");
  });

  it("each head's list holds only their own department", async () => {
    asHousekeeping();
    const hk = await listDeptPurchaseOrders({ department: "HOUSEKEEPING" });
    expect(hk.map((p) => p.id)).toContain(hkDraftId);
    expect(hk.map((p) => p.id)).not.toContain(mtDraftId);
    asMaintenance();
    const mt = await listDeptPurchaseOrders({ department: "MAINTENANCE", status: ["DRAFT"] });
    expect(mt.map((p) => p.id)).toEqual(expect.arrayContaining([mtDraftId]));
    expect(mt.every((p) => p.status === "DRAFT")).toBe(true);
  });

  it("the store keeper, chef and accounts are refused everywhere", async () => {
    const [hkLine] = await linesOf(hkApprovedId);
    for (const who of ["store", "chef", "accounts", "delivery"] as DeskName[]) {
      await actingAs(who, async () => {
        const calls: Array<() => Promise<unknown>> = [
          () => createDeptPurchaseOrder({ department: "HOUSEKEEPING", reason: "x", lines: [{ itemId: hkSoap, quantity: "1" }] }),
          () => updateDeptPurchaseOrder(hkDraftId, { reason: "x", lines: [{ itemId: hkSoap, quantity: "1" }] }),
          () => submitDeptPurchaseOrder(hkDraftId),
          () => decideDeptPurchaseOrder(hkDraftId, { decision: "APPROVE" }),
          () => markDeptPurchaseOrdered(hkApprovedId, { supplierName: "X" }),
          () => receiveDeptPurchaseOrder(hkApprovedId, { receivedAt: now(), lines: [{ lineId: hkLine.id, quantity: "1" }] }),
          () => closeDeptPurchaseOrderShort(hkApprovedId, "x"),
          () => cancelDeptPurchaseOrder(hkDraftId, "x"),
          () => getDeptPurchaseOrder(hkDraftId),
          () => listDeptPurchaseOrders({ department: "HOUSEKEEPING" }),
          () => listDeptPurchaseOrdersAwaitingApproval(),
          () => listDeptItemsForPurchase("MAINTENANCE"),
        ];
        for (const call of calls) expect(await expectRefused(call)).toMatch(/^Requires one of/);
      });
    }
    expect(await statusOf(hkDraftId)).toBe("DRAFT");
    expect(await statusOf(hkApprovedId)).toBe("APPROVED");
  });

  it("admin and manager reach both departments", async () => {
    for (const who of ["admin", "manager"] as DeskName[]) {
      await actingAs(who, async () => {
        expect((await getDeptPurchaseOrder(hkDraftId)).ok).toBe(true);
        expect((await getDeptPurchaseOrder(mtDraftId)).ok).toBe(true);
        await listDeptPurchaseOrders({ department: "HOUSEKEEPING" });
        await listDeptPurchaseOrders({ department: "MAINTENANCE" });
      });
    }
  });
});

describe("maintenance: the same flow, into the maintenance store", () => {
  it("raise → submit → admin approves → order → receive in full", async () => {
    asMaintenance();
    const { id, number } = mustOk(
      await mtDraft([
        { itemId: mtBulb, quantity: "12", rate: "80" },
        { itemId: mtPipe, quantity: "2.5", rate: "120" },
      ]),
      "create",
    );
    expect(number).toMatch(/^MT-PO-/);
    mustOk(await submitDeptPurchaseOrder(id), "submit");
    await flushDeferred();
    expect(await db.notification.count({ where: { dedupeKey: `dept-po-submitted:${id}`, userId: desk("manager").id } })).toBe(1);

    asManager();
    const awaiting = await listDeptPurchaseOrdersAwaitingApproval();
    expect(awaiting.map((p) => p.id)).toContain(id);

    asMaintenance();
    expect(await expectRefused(() => decideDeptPurchaseOrder(id, { decision: "APPROVE" }))).toMatch(/^Requires one of/);

    asAdmin();
    mustOk(await decideDeptPurchaseOrder(id, { decision: "APPROVE" }), "approve");

    asMaintenance();
    mustOk(await markDeptPurchaseOrdered(id, { supplierName: "Volt Traders", expectedAt: "2026-10-20" }), "ordered");
    const [bulb, pipe] = await linesOf(id);
    const bulbBefore = await mtStock(mtBulb);
    const pipeBefore = await mtStock(mtPipe);
    const res = mustOk(
      await receiveDeptPurchaseOrder(id, {
        receivedAt: now(),
        supplierBillNo: "VT-9",
        lines: [
          { lineId: bulb.id, quantity: "12" },
          { lineId: pipe.id, quantity: "2.5" },
        ],
      }),
      "receive",
    );
    expect(res.status).toBe("RECEIVED");
    expectDecimal(await mtStock(mtBulb), bulbBefore.plus(12).toString(), "bulbs");
    expectDecimal(await mtStock(mtPipe), pipeBefore.plus(2.5).toString(), "pipe");
    const receipt = await db.maintenanceReceipt.findUniqueOrThrow({ where: { id: res.receiptId }, include: { lines: true } });
    expect(receipt.purchaseOrderId).toBe(id);
    expect(receipt.sourceContact).toBe("Volt Traders");
    expect(receipt.lines.map((l) => l.poLineId).sort()).toEqual([bulb.id, pipe.id].sort());
    expect(await db.housekeepingReceipt.count({ where: { purchaseOrderId: id } })).toBe(0);
  });

  it("a part-received PO can be closed short", async () => {
    asMaintenance();
    const { id } = mustOk(await mtDraft([{ itemId: mtPipe, quantity: "10" }]), "create");
    mustOk(await submitDeptPurchaseOrder(id), "submit");
    await actingAs("manager", async () => mustOk(await decideDeptPurchaseOrder(id, { decision: "APPROVE" }), "approve"));
    expect(await expectRefused(() => closeDeptPurchaseOrderShort(id, "nothing came"))).toMatch(/part-received/);
    const [line] = await linesOf(id);
    // Straight from APPROVED — the head need not mark it ordered first.
    mustOk(await receiveDeptPurchaseOrder(id, { receivedAt: now(), lines: [{ lineId: line.id, quantity: "6" }] }), "receive");
    expect(await statusOf(id)).toBe("PARTIALLY_RECEIVED");
    expect(await expectRefused(() => closeDeptPurchaseOrderShort(id, ""))).toMatch(/reason/);
    mustOk(await closeDeptPurchaseOrderShort(id, "Supplier out of stock"), "close short");
    const po = await db.deptPurchaseOrder.findUniqueOrThrow({ where: { id } });
    expect(po.status).toBe("RECEIVED");
    expect(po.notes).toMatch(/Closed short: Supplier out of stock/);
  });

  it("every mutation leaves an audit row", async () => {
    const rows = await db.auditLog.findMany({
      where: { entity: "DeptPurchaseOrder", action: { startsWith: "DEPT_PO_" } },
      select: { action: true, payloadHash: true },
    });
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      "DEPT_PO_CREATED",
      "DEPT_PO_UPDATED",
      "DEPT_PO_SUBMITTED",
      "DEPT_PO_APPROVED",
      "DEPT_PO_REJECTED",
      "DEPT_PO_ORDERED",
      "DEPT_PO_RECEIVED",
      "DEPT_PO_CLOSED_SHORT",
      "DEPT_PO_CANCELLED",
    ]) {
      expect(actions).toContain(a);
    }
    expect(rows.every((r) => r.payloadHash)).toBe(true);
  });
});
