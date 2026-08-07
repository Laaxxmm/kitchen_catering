// FIRST import, always — see db-url.ts.
import "./db-url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  cancelBanquetRequisition,
  cancelBanquetRequisitionLine,
  createBanquetRequisition,
  issueBanquetRequisitionLine,
  sendBanquetRequisitionLineToProcurement,
} from "@/server/actions/banquet";
import {
  approveVendorPO,
  cancelVendorPO,
  createGRN,
  createVendorPO,
  submitVendorPO,
} from "@/server/actions/procurement";
import {
  asDelivery,
  asManager,
  asStore,
  ensureSeeded,
  expectDecimal,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
} from "../harness";
import { FNB_CODES, fnbItem, fnbStock, reqLine, type FnbItem } from "./items";

/**
 * The re-open handshake under pressure. The happy path is in scenario 10;
 * these are the shapes that broke it before — goods arriving in dribs, a
 * whole delivery rejected, a purchase unit the catalogue doesn't track, a PO
 * that dies before delivery, and a PO nobody raised off the requisition.
 */

let orderId: string;
let melamine: FnbItem;
let bonechina: FnbItem;

beforeAll(async () => {
  await ensureSeeded();
  [melamine, bonechina] = await Promise.all([
    fnbItem(FNB_CODES.hiredMelamine),
    fnbItem(FNB_CODES.hiredBonechina),
  ]);
  orderId = (await placeCateringOrder()).id;
});

/** A one-line requisition for `item`, flagged short by the store. */
async function flaggedRequisition(item: FnbItem, qty: string): Promise<string> {
  asDelivery();
  const created = mustOk(
    await createBanquetRequisition({
      orderId,
      lines: [{ itemId: item.id, requestedQty: qty }],
    }),
    "create banquet requisition",
  );
  asStore();
  mustOk(
    await sendBanquetRequisitionLineToProcurement({
      requisitionLineId: (await reqLine(created.id, item.id)).id,
      reason: "Nothing in the F&B store",
    }),
    "flag the shortfall",
  );
  return created.id;
}

/** The PO the store raises off that flagged line, approved and ready to receive. */
async function approvedPO(
  reqId: string,
  item: FnbItem,
  opts: { quantity: string; unit?: string; link?: boolean },
): Promise<string> {
  const { vendorId } = seeded();
  const line = await reqLine(reqId, item.id);
  asStore();
  const po = mustOk(
    await createVendorPO({
      vendorId,
      placeOfSupplyStateCode: "29",
      lines: [
        {
          banquetItemId: item.id,
          banquetReqLineId: opts.link === false ? null : line.id,
          sku: item.sku,
          description: item.name,
          unit: opts.unit ?? item.unit,
          quantity: opts.quantity,
          unitPrice: "2.50",
          gstRatePct: "5",
        },
      ],
    }),
    "create F&B PO",
  );
  mustOk(await submitVendorPO(po.id), "submit PO");
  asManager();
  mustOk(await approveVendorPO(po.id), "approve PO");
  return po.id;
}

describe("the goods arrive in two deliveries", () => {
  let reqId: string;
  let poId: string;

  beforeAll(async () => {
    reqId = await flaggedRequisition(melamine, "50");
    poId = await approvedPO(reqId, melamine, { quantity: "50" });
  });

  it("re-opens the line on the FIRST part-delivery", async () => {
    const po = await read.purchaseOrder(poId);
    asStore();
    mustOk(
      await createGRN({
        poId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "20", rejectedQty: "0" }],
      }),
      "first GRN",
    );
    expect((await read.purchaseOrder(poId)).status).toBe(VendorPOStatus.PARTIALLY_RECEIVED);
    expectDecimal(await fnbStock(melamine.id), "20", "what actually arrived");
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.PENDING,
    );
  });

  it("lets the store hand over what landed, and keeps the line open for the rest", async () => {
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, melamine.id)).id,
        issueQty: "20",
      }),
      "issue the first delivery",
    );
    const line = await reqLine(reqId, melamine.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.PARTIALLY_ISSUED);
    expectDecimal(line.issuedQty, "20", "issued so far");
  });

  it("posts the balance on the second delivery and closes the PO", async () => {
    const po = await read.purchaseOrder(poId);
    asStore();
    mustOk(
      await createGRN({
        poId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "30", rejectedQty: "0" }],
      }),
      "second GRN",
    );
    expect((await read.purchaseOrder(poId)).status).toBe(VendorPOStatus.RECEIVED);
    expectDecimal(await fnbStock(melamine.id), "30", "balance on the shelf");

    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, melamine.id)).id,
        issueQty: "30",
      }),
      "issue the balance",
    );
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.ISSUED,
    );
    expectDecimal(await fnbStock(melamine.id), "0", "all handed over");
  });
});

describe("the whole delivery is rejected", () => {
  it("posts no stock and leaves the line waiting on the supplier", async () => {
    const reqId = await flaggedRequisition(bonechina, "12");
    const poId = await approvedPO(reqId, bonechina, { quantity: "12" });
    const po = await read.purchaseOrder(poId);
    asStore();
    mustOk(
      await createGRN({
        poId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "0", rejectedQty: "12", reason: "Chipped" }],
      }),
      "rejecting GRN",
    );
    expectDecimal(await fnbStock(bonechina.id), "0", "nothing on the shelf");
    expect((await reqLine(reqId, bonechina.id)).status).toBe(
      BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
    );
  });
});

describe("the goods are bought in a unit the catalogue doesn't track", () => {
  it("warns, posts nothing, and deliberately does NOT re-open the line", async () => {
    const reqId = await flaggedRequisition(melamine, "24");
    // Bought by the box; the catalogue counts pieces. Nobody but a human
    // knows the pack size, so the goods must not silently post 1:1.
    const poId = await approvedPO(reqId, melamine, { quantity: "24", unit: "box" });
    const po = await read.purchaseOrder(poId);
    asStore();
    const grn = mustOk(
      await createGRN({
        poId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "24", rejectedQty: "0" }],
      }),
      "mismatched-unit GRN",
    );
    const requisitionNo = (
      await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } })
    ).requisitionNo;
    expect(grn.warnings?.join(" ")).toContain("stock NOT auto-updated");
    expect(grn.warnings?.join(" ")).toContain(requisitionNo);

    expectDecimal(await fnbStock(melamine.id), "0", "nothing posted");
    // Stock never landed, so the store still can't issue — the line has to
    // stay flagged until someone corrects it by hand.
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
    );
  });
});

describe("the purchase order is cancelled before it delivers", () => {
  it("un-strands the waiting line so a fresh PO can be raised", async () => {
    const reqId = await flaggedRequisition(bonechina, "18");
    const poId = await approvedPO(reqId, bonechina, { quantity: "18" });
    expect((await reqLine(reqId, bonechina.id)).vendorPOLineId).not.toBeNull();

    asManager();
    mustOk(await cancelVendorPO(poId, "Hire vendor pulled out"), "cancel the PO");

    const line = await reqLine(reqId, bonechina.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.PENDING);
    expect(line.vendorPOLineId).toBeNull();
    expect(
      (await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } })).status,
    ).toBe(BanquetRequisitionStatus.SUBMITTED);

    // And it can go round again: flag it, buy it, receive it.
    asStore();
    mustOk(
      await sendBanquetRequisitionLineToProcurement({
        requisitionLineId: line.id,
        reason: "Second supplier",
      }),
      "re-flag the line",
    );
    const secondPo = await approvedPO(reqId, bonechina, { quantity: "18" });
    const po = await read.purchaseOrder(secondPo);
    asStore();
    mustOk(
      await createGRN({
        poId: secondPo,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "18", rejectedQty: "0" }],
      }),
      "receive the replacement",
    );
    expect((await reqLine(reqId, bonechina.id)).status).toBe(
      BanquetRequisitionLineStatus.PENDING,
    );
    expectDecimal(await fnbStock(bonechina.id), "18", "on the shelf");
  });
});

describe("the way out of a line that is never going to arrive", () => {
  // A requisition waiting on a purchase stays OPEN (that is the point of the
  // status), so both escape hatches have to work from there — otherwise the
  // fix for the stranded line just moves the strand up to the requisition.
  it("lets the store cancel the stuck line and close the requisition", async () => {
    const reqId = await flaggedRequisition(bonechina, "6");
    await approvedPO(reqId, bonechina, { quantity: "6" });
    asStore();
    mustOk(
      await cancelBanquetRequisitionLine(
        (await reqLine(reqId, bonechina.id)).id,
        "Supplier can't deliver before the event",
      ),
      "cancel the stuck line",
    );
    const req = await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe(BanquetRequisitionStatus.FULLY_ISSUED);
    expect(req.closedAt).not.toBeNull();
  });

  it("lets F&B cancel the whole requisition and takes the draft PO with it", async () => {
    const reqId = await flaggedRequisition(melamine, "7");
    const { vendorId } = seeded();
    const line = await reqLine(reqId, melamine.id);
    asStore();
    const po = mustOk(
      await createVendorPO({
        vendorId,
        placeOfSupplyStateCode: "29",
        lines: [
          {
            banquetItemId: melamine.id,
            banquetReqLineId: line.id,
            sku: melamine.sku,
            description: melamine.name,
            unit: melamine.unit,
            quantity: "7",
            unitPrice: "2.50",
            gstRatePct: "5",
          },
        ],
      }),
      "raise the shortfall PO",
    );

    asDelivery();
    mustOk(
      await cancelBanquetRequisition(reqId, "Client dropped the soup course"),
      "cancel the requisition",
    );
    expect(
      (await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } })).status,
    ).toBe(BanquetRequisitionStatus.CANCELLED);
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.CANCELLED,
    );
    // Nothing was ordered yet, so the draft goes with it rather than being
    // left for someone to notice.
    expect((await read.purchaseOrder(po.id)).status).toBe(VendorPOStatus.CANCELLED);
  });
});

describe("a PO nobody raised off the requisition", () => {
  it("still re-opens the waiting line, matched by item", async () => {
    const reqId = await flaggedRequisition(melamine, "9");
    // Hand-typed PO: no banquetReqLineId back-link at all. Matching only on
    // the back-link froze these lines with the stock already on the shelf.
    const poId = await approvedPO(reqId, melamine, { quantity: "9", link: false });
    expect((await reqLine(reqId, melamine.id)).vendorPOLineId).toBeNull();

    const po = await read.purchaseOrder(poId);
    asStore();
    mustOk(
      await createGRN({
        poId,
        lines: [{ poLineId: po.lines[0].id, acceptedQty: "9", rejectedQty: "0" }],
      }),
      "receive the hand-typed PO",
    );
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.PENDING,
    );
    expectDecimal(await fnbStock(melamine.id), "9", "on the shelf");
  });
});
