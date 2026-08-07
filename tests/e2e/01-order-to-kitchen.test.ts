import { beforeAll, describe, expect, it } from "vitest";
import {
  ChefRequisitionLineStatus,
  ChefRequisitionStatus,
  DeliveryStatus,
  OrderStatus,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  createChefRequisition,
  createStandaloneChefRequisition,
  issueChefRequisitionLine,
  sendChefRequisitionLineToProcurement,
  submitChefRequisition,
} from "@/server/actions/chef-requisitions";
import {
  approveVendorPO,
  createGRN,
  createVendorPO,
  submitVendorPO,
} from "@/server/actions/procurement";
import { chefApproveOrder } from "@/server/actions/orders";
import { markOrderCooked, startCookingOrder } from "@/server/actions/production-jobs";
import {
  confirmDeliveryOTP,
  dispatchDelivery,
  scheduleDelivery,
} from "@/server/actions/deliveries";
import {
  asAccounts,
  asAdmin,
  asChef,
  asDelivery,
  asManager,
  asStore,
  chefAccepts,
  daysFromNow,
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
} from "./harness";

/**
 * Scenario 1 — the order-to-kitchen spine, with the link that has broken
 * twice: a requisition line flagged short, bought on a PO, and RE-OPENED for
 * issuing the moment the goods are booked in.
 */

let orderId: string;
let requisitionId: string;
let plentifulLineId: string;
let scarceLineId: string;
let poId: string;

beforeAll(async () => {
  await ensureSeeded();
});

describe("manager takes the order, chef accepts it", () => {
  it("lands in the chef's queue and no further", async () => {
    const order = await placeCateringOrder({ headcount: 100 });
    orderId = order.id;
    // A manager taking the order self-approves the commercial gate.
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.PENDING_CHEF_APPROVAL);
  });

  it("won't let the store or accounts accept it for the kitchen", async () => {
    for (const become of [asStore, asAccounts, asDelivery]) {
      become();
      await expectRefused(() =>
        chefApproveOrder(orderId, { decision: "APPROVED", note: "not mine to give" }),
      );
    }
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.PENDING_CHEF_APPROVAL);
  });

  it("moves to 'chef to raise requisition' when the chef accepts", async () => {
    await chefAccepts(orderId);
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.CHEF_REQUISITION_PENDING);
  });
});

describe("chef raises the ingredient requisition", () => {
  it("is the chef's document, not the store's", async () => {
    const { ingredients } = seeded();
    asStore();
    await expectRefused(() =>
      createChefRequisition({
        orderId,
        lines: [{ ingredientId: ingredients.plentiful, requestedQty: "10" }],
      }),
    );
  });

  it("snapshots each line's cost and moves the order to issuing on submit", async () => {
    const { ingredients } = seeded();
    // The store has 25 kg of the plentiful item from the catalogue's opening
    // count, and 3 kg of the scarce one bought in this morning — against a
    // requisition asking for 8. That 5 kg gap is the scenario.
    await stockUp(ingredients.scarce, "3", "420");

    asChef();
    const created = mustOk(
      await createChefRequisition({
        orderId,
        notes: "100 pax banquet",
        lines: [
          { ingredientId: ingredients.plentiful, requestedQty: "10" },
          { ingredientId: ingredients.scarce, requestedQty: "8" },
        ],
      }),
      "create requisition",
    );
    requisitionId = created.id;

    mustOk(await submitChefRequisition(requisitionId), "submit requisition");

    const req = await read.requisition(requisitionId);
    expect(req.status).toBe(ChefRequisitionStatus.SUBMITTED);
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.ISSUING);

    const plentiful = req.lines.find((l) => l.ingredientId === ingredients.plentiful)!;
    const scarce = req.lines.find((l) => l.ingredientId === ingredients.scarce)!;
    plentifulLineId = plentiful.id;
    scarceLineId = scarce.id;
    // The cost baseline is taken at requisition time, not at issue time.
    expectDecimal(scarce.unitCostSnapshot, "420", "scarce unit cost snapshot");
  });
});

describe("the store issues what it has and flags what it hasn't", () => {
  it("only the store may issue", async () => {
    asChef();
    await expectRefused(() =>
      issueChefRequisitionLine({ lineId: plentifulLineId, qtyToIssue: "10" }),
    );
  });

  it("issues the full line and takes the stock off the shelf", async () => {
    const { ingredients } = seeded();
    const before = await read.onHand(ingredients.plentiful);
    asStore();
    mustOk(
      await issueChefRequisitionLine({ lineId: plentifulLineId, qtyToIssue: "10" }),
      "issue plentiful line",
    );

    const line = await db.chefRequisitionLine.findUniqueOrThrow({
      where: { id: plentifulLineId },
    });
    expect(line.status).toBe(ChefRequisitionLineStatus.ISSUED);
    expectDecimal(
      await read.onHand(ingredients.plentiful),
      String(Number(before) - 10),
      "on hand after issue",
    );
  });

  it("refuses to issue more than is on the shelf", async () => {
    asStore();
    const message = await expectRefused(() =>
      issueChefRequisitionLine({ lineId: scarceLineId, qtyToIssue: "8" }),
    );
    expect(message).toContain("Insufficient stock");
  });

  it("part-issues the short line, then flags the remainder for purchase", async () => {
    const { ingredients } = seeded();
    asStore();
    mustOk(
      await issueChefRequisitionLine({ lineId: scarceLineId, qtyToIssue: "3" }),
      "part-issue scarce line",
    );
    expectDecimal(await read.onHand(ingredients.scarce), "0", "scarce on hand");

    let line = await db.chefRequisitionLine.findUniqueOrThrow({ where: { id: scarceLineId } });
    expect(line.status).toBe(ChefRequisitionLineStatus.PARTIALLY_ISSUED);

    mustOk(
      await sendChefRequisitionLineToProcurement({
        lineId: scarceLineId,
        reason: "5 kg short — buying in",
      }),
      "flag shortfall",
    );
    line = await db.chefRequisitionLine.findUniqueOrThrow({ where: { id: scarceLineId } });
    expect(line.status).toBe(ChefRequisitionLineStatus.AWAITING_PROCUREMENT);
  });

  it("lets the kitchen start with what arrived rather than freezing the order", async () => {
    // Every line has been ACTED on — one issued, one bought — so the order
    // moves on and the shortfall keeps its own life on the requisition.
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.READY_FOR_PRODUCTION);
    const req = await read.requisition(requisitionId);
    expect(req.status).toBe(ChefRequisitionStatus.PARTIALLY_ISSUED);
    const job = await read.productionJob(orderId);
    expect(job?.items.length).toBe(2);
  });

  it("told the chef who raised it that a shortfall is still outstanding", async () => {
    const notice = await db.notification.findFirst({
      where: { userId: desk("chef").id, dedupeKey: `chef-req-shortfall-advance:${requisitionId}` },
    });
    expect(notice?.title).toContain("shortfall");
  });
});

describe("the shortfall is bought in", () => {
  it("the store raises the PO; the manager approves it", async () => {
    const { ingredients, vendorId } = seeded();
    asStore();
    const po = mustOk(
      await createVendorPO({
        vendorId,
        orderId,
        placeOfSupplyStateCode: "29",
        lines: [
          {
            ingredientId: ingredients.scarce,
            chefReqLineId: scarceLineId,
            sku: "GP-001",
            description: "Paneer",
            unit: "kg",
            quantity: "5",
            unitPrice: "420",
            gstRatePct: "5",
          },
        ],
      }),
      "create PO",
    );
    poId = po.id;

    // The back-link is what lets the GRN find the waiting requisition line.
    const line = await db.chefRequisitionLine.findUniqueOrThrow({ where: { id: scarceLineId } });
    expect(line.vendorPOLineId).not.toBeNull();

    mustOk(await submitVendorPO(poId), "submit PO");
    expect((await read.purchaseOrder(poId)).status).toBe(VendorPOStatus.PENDING_APPROVAL);
  });

  it("the store cannot approve its own purchase order", async () => {
    asStore();
    await expectRefused(() => approveVendorPO(poId));
    expect((await read.purchaseOrder(poId)).status).toBe(VendorPOStatus.PENDING_APPROVAL);
  });

  it("a ₹2,205 PO is under the admin threshold, so the manager's signature completes it", async () => {
    asManager();
    mustOk(await approveVendorPO(poId), "approve PO");
    const po = await read.purchaseOrder(poId);
    expect(po.status).toBe(VendorPOStatus.APPROVED);
    expectDecimal(po.grandTotal, "2205", "PO grand total");
  });
});

describe("goods in — and the requisition line re-opens", () => {
  it("books the stock in at the purchase price", async () => {
    const { ingredients } = seeded();
    const po = await read.purchaseOrder(poId);
    asStore();
    mustOk(
      await createGRN({
        poId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "5", rejectedQty: "0" }],
      }),
      "create GRN",
    );
    expectDecimal(await read.onHand(ingredients.scarce), "5", "scarce on hand after GRN");
    expect((await read.purchaseOrder(poId)).status).toBe(VendorPOStatus.RECEIVED);
  });

  it("RE-OPENS the requisition line for issuing (the link that broke twice)", async () => {
    const line = await db.chefRequisitionLine.findUniqueOrThrow({ where: { id: scarceLineId } });
    expect(line.status).toBe(ChefRequisitionLineStatus.PENDING);
    // Already-issued progress is not lost when the line re-opens.
    expectDecimal(line.issuedQty, "3", "issued so far");

    const req = await read.requisition(requisitionId);
    expect(req.status).toBe(ChefRequisitionStatus.PARTIALLY_ISSUED);
  });

  it("tells the store and the chef the goods have landed", async () => {
    const [storeNotice, chefNotice] = await Promise.all([
      db.notification.findFirst({
        where: { userId: desk("store").id, title: { contains: "arrived" } },
      }),
      db.notification.findFirst({
        where: { userId: desk("chef").id, title: { contains: "has arrived" } },
      }),
    ]);
    expect(storeNotice).not.toBeNull();
    expect(chefNotice).not.toBeNull();
  });

  it("issues the top-up, closing the requisition without knocking the order back", async () => {
    const { ingredients } = seeded();
    asStore();
    mustOk(
      await issueChefRequisitionLine({ lineId: scarceLineId, qtyToIssue: "5" }),
      "issue top-up",
    );

    const req = await read.requisition(requisitionId);
    expect(req.status).toBe(ChefRequisitionStatus.FULLY_ISSUED);
    expect(req.lines.every((l) => l.status === ChefRequisitionLineStatus.ISSUED)).toBe(true);
    expectDecimal(await read.onHand(ingredients.scarce), "0", "scarce on hand after top-up");
    // No regress: the kitchen was already cooking to this order.
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.READY_FOR_PRODUCTION);
  });

  it("refuses a second issue once the requisition is closed", async () => {
    asStore();
    const message = await expectRefused(() =>
      issueChefRequisitionLine({ lineId: scarceLineId, qtyToIssue: "1" }),
    );
    // The parent's status is the gate — a closed requisition takes no more
    // stock, whatever the line still says.
    expect(message).toContain("fully issued");
  });
});

describe("a purchase order typed by hand, with no back-link", () => {
  // The ?reqId= prefill wires chefReqLineId through to the PO line. A PO the
  // store types itself carries no such link, and matching the GRN only on it
  // left those lines frozen at "awaiting procurement" with the goods already
  // on the shelf — the recurring "GRN accepted but can't issue" complaint.
  let standaloneReqId: string;
  let standaloneLineId: string;
  let manualPoId: string;

  it("goes short and gets flagged, exactly like an order requisition", async () => {
    const { ingredients } = seeded();
    asChef();
    const req = mustOk(
      await createStandaloneChefRequisition({
        notes: "kitchen prep stock",
        lines: [{ ingredientId: ingredients.scarce, requestedQty: "4" }],
      }),
      "standalone requisition",
    );
    standaloneReqId = req.id;
    const full = await read.requisition(standaloneReqId);
    standaloneLineId = full.lines[0].id;
    expect(full.status).toBe(ChefRequisitionStatus.SUBMITTED);

    asStore();
    mustOk(
      await sendChefRequisitionLineToProcurement({
        lineId: standaloneLineId,
        reason: "nothing on the shelf",
      }),
      "flag shortfall",
    );
  });

  it("is bought on a PO that never names the requisition line", async () => {
    const { ingredients, vendorId } = seeded();
    asStore();
    const po = mustOk(
      await createVendorPO({
        vendorId,
        placeOfSupplyStateCode: "29",
        lines: [
          {
            ingredientId: ingredients.scarce,
            // Deliberately no chefReqLineId — this is the hand-typed case.
            sku: "GP-001",
            description: "Paneer",
            unit: "kg",
            quantity: "4",
            unitPrice: "420",
            gstRatePct: "5",
          },
        ],
      }),
      "manual PO",
    );
    manualPoId = po.id;
    expect(
      (await db.chefRequisitionLine.findUniqueOrThrow({ where: { id: standaloneLineId } }))
        .vendorPOLineId,
    ).toBeNull();

    mustOk(await submitVendorPO(manualPoId), "submit manual PO");
    asManager();
    mustOk(await approveVendorPO(manualPoId), "approve manual PO");
  });

  it("still re-opens the line when the goods are booked in", async () => {
    const po = await read.purchaseOrder(manualPoId);
    asStore();
    mustOk(
      await createGRN({
        poId: manualPoId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "4", rejectedQty: "0" }],
      }),
      "GRN on manual PO",
    );

    const line = await db.chefRequisitionLine.findUniqueOrThrow({
      where: { id: standaloneLineId },
    });
    expect(line.status).toBe(ChefRequisitionLineStatus.PENDING);
    // Nothing was issued before, so the requisition drops back to SUBMITTED.
    expect((await read.requisition(standaloneReqId)).status).toBe(
      ChefRequisitionStatus.SUBMITTED,
    );
  });

  it("issues the goods that arrived", async () => {
    const { ingredients } = seeded();
    asStore();
    mustOk(
      await issueChefRequisitionLine({ lineId: standaloneLineId, qtyToIssue: "4" }),
      "issue standalone line",
    );
    expect((await read.requisition(standaloneReqId)).status).toBe(
      ChefRequisitionStatus.FULLY_ISSUED,
    );
    expectDecimal(await read.onHand(ingredients.scarce), "0", "scarce on hand");
  });
});

describe("cook, ready, deliver", () => {
  it("only the kitchen starts cooking", async () => {
    asStore();
    await expectRefused(() => startCookingOrder(orderId));
  });

  it("cooks and readies the order", async () => {
    asChef();
    mustOk(await startCookingOrder(orderId), "start cooking");
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.IN_PREP);

    mustOk(await markOrderCooked(orderId), "mark cooked");
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.READY);
  });

  it("dispatch is the manager's desk, not the driver's", async () => {
    asDelivery();
    await expectRefused(() =>
      scheduleDelivery({
        orderId,
        driverUserId: desk("delivery").id,
        scheduledAt: istInput(daysFromNow(7)),
      }),
    );
  });

  it("schedules, dispatches and confirms the delivery", async () => {
    asManager();
    const scheduled = mustOk(
      await scheduleDelivery({
        orderId,
        driverUserId: desk("delivery").id,
        vehicleNo: "KA-01-AA-0001",
        scheduledAt: istInput(daysFromNow(7)),
      }),
      "schedule delivery",
    );

    asDelivery();
    mustOk(await dispatchDelivery(scheduled.id), "dispatch");
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.OUT_FOR_DELIVERY);

    mustOk(await confirmDeliveryOTP(scheduled.id, {}), "confirm delivery");
    expect((await read.delivery(scheduled.id)).status).toBe(DeliveryStatus.DELIVERED);
    expect(await read.orderStatus(orderId)).toBe(OrderStatus.DELIVERED);
  });

  it("refuses a second delivery on the same order", async () => {
    asAdmin();
    const message = await expectRefused(() =>
      scheduleDelivery({
        orderId,
        driverUserId: desk("delivery").id,
        scheduledAt: istInput(daysFromNow(7)),
      }),
    );
    expect(message).toContain("delivered");
  });
});
