// FIRST import, always — re-points DATABASE_URL at this suite's own database
// before @/server/db builds its PrismaClient. See db-url.ts.
import "./db-url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BanquetRequisitionLineStatus,
  BanquetRequisitionStatus,
  VendorPOStatus,
} from "@prisma/client";
import { db } from "@/server/db";
import {
  createBanquetRequisition,
  issueBanquetRequisitionLine,
  sendBanquetRequisitionLineToProcurement,
} from "@/server/actions/banquet";
import {
  approveVendorPO,
  createGRN,
  createVendorPO,
  submitVendorPO,
} from "@/server/actions/procurement";
import {
  asAccounts,
  asChef,
  asDelivery,
  asManager,
  asStore,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  mustOk,
  placeCateringOrder,
  read,
  seeded,
} from "../harness";
import { FNB_CODES, fnbItem, fnbStock, reqLine, type FnbItem } from "./items";

/**
 * The F&B spine, and the link that has broken twice: a banquet requisition
 * line the store can't fill is FLAGGED (no PO), the PO is built afterwards on
 * the PO screen, and the GRN has to RE-OPEN the flagged line so the store can
 * finally issue it.
 *
 * Deliberately buys only SOME of the flagged lines on the first PO — the
 * second supplier's lines have to survive the first GRN untouched and still be
 * pre-fillable on a second PO.
 */

let orderId: string;
let reqId: string;
let plentiful: FnbItem;
let shallow: FnbItem;
let melamine: FnbItem;
let bonechina: FnbItem;
let poId: string;
let secondPoId: string;

beforeAll(async () => {
  await ensureSeeded();
  [plentiful, shallow, melamine, bonechina] = await Promise.all([
    fnbItem(FNB_CODES.plentiful),
    fnbItem(FNB_CODES.shallow),
    fnbItem(FNB_CODES.hiredMelamine),
    fnbItem(FNB_CODES.hiredBonechina),
  ]);
  orderId = (await placeCateringOrder()).id;
});

describe("F&B raises a banquet requisition against the event", () => {
  it("opens SUBMITTED with every line pending", async () => {
    asDelivery();
    const created = mustOk(
      await createBanquetRequisition({
        orderId,
        notes: "Cutlery + disposables for the event",
        lines: [
          { itemId: plentiful.id, requestedQty: "500" },
          { itemId: shallow.id, requestedQty: "40" },
          { itemId: melamine.id, requestedQty: "100" },
          { itemId: bonechina.id, requestedQty: "60" },
        ],
      }),
      "create banquet requisition",
    );
    reqId = created.id;
    expect(created.requisitionNo).toMatch(/^BRQ-\d{2}-\d{2}-\d{4}$/);

    const req = await db.banquetRequisition.findUniqueOrThrow({
      where: { id: reqId },
      include: { lines: true },
    });
    expect(req.status).toBe(BanquetRequisitionStatus.SUBMITTED);
    expect(req.lines).toHaveLength(4);
    expect(req.lines.every((l) => l.status === BanquetRequisitionLineStatus.PENDING)).toBe(true);
  });

  it("is not the kitchen's or the payables desk's to raise", async () => {
    for (const become of [asChef, asAccounts]) {
      become();
      const why = await expectRefused(() =>
        createBanquetRequisition({ lines: [{ itemId: plentiful.id, requestedQty: "1" }] }),
      );
      expect(why).toMatch(/Requires one of/);
    }
  });
});

describe("the store issues what it has", () => {
  it("issues a line in full and moves the stock off the shelf", async () => {
    const before = await fnbStock(plentiful.id);
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
        issueQty: "500",
      }),
      "issue plentiful line",
    );

    const line = await reqLine(reqId, plentiful.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.ISSUED);
    expectDecimal(line.issuedQty, "500", "issued");
    expectDecimal(await fnbStock(plentiful.id), String(Number(before) - 500), "on hand");
  });

  it("books the movement against the event, so the client's ledger sees it", async () => {
    const issue = await db.banquetIssue.findFirstOrThrow({
      where: { orderId, lines: { some: { itemId: plentiful.id } } },
      include: { lines: true },
    });
    expect(issue.purpose).toContain("Requisition");
    expectDecimal(issue.lines[0].quantity, "500", "issue line qty");
  });

  it("refuses to issue past what was asked for", async () => {
    asStore();
    const why = await expectRefused(async () =>
      issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
        issueQty: "1",
      }),
    );
    expect(why).toMatch(/already fully issued/i);
  });

  it("refuses to issue more than is on the shelf, and says how much there is", async () => {
    asStore();
    const why = await expectRefused(async () =>
      issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, shallow.id)).id,
        issueQty: "40",
      }),
    );
    expect(why).toMatch(/Only 15 pcs in stock/);
    expectDecimal(await fnbStock(shallow.id), "15", "on hand untouched by the refusal");
  });

  it("issues the 15 it does have, leaving the line part-issued", async () => {
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, shallow.id)).id,
        issueQty: "15",
      }),
      "part-issue shallow line",
    );
    const line = await reqLine(reqId, shallow.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.PARTIALLY_ISSUED);
    expectDecimal(line.issuedQty, "15", "issued so far");
    expectDecimal(await fnbStock(shallow.id), "0", "shelf emptied");

    const req = await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe(BanquetRequisitionStatus.PARTIALLY_ISSUED);
  });
});

describe("the store flags the shortfalls — and creates NO purchase order", () => {
  it("flags the part-issued line and both hired lines", async () => {
    asStore();
    for (const item of [shallow, melamine, bonechina]) {
      mustOk(
        await sendBanquetRequisitionLineToProcurement({
          requisitionLineId: (await reqLine(reqId, item.id)).id,
          reason: "Not in the F&B store — buy in for the event",
        }),
        `flag ${item.sku}`,
      );
    }
    for (const item of [shallow, melamine, bonechina]) {
      const line = await reqLine(reqId, item.id);
      expect(line.status).toBe(BanquetRequisitionLineStatus.AWAITING_PROCUREMENT);
      // Flagging is a flag: the PO is raised afterwards on the PO screen.
      expect(line.vendorPOLineId).toBeNull();
    }
    expect(await db.vendorPO.count()).toBe(0);
  });

  it("leaves the requisition OPEN — goods are still owed on it", async () => {
    // The GRN only re-opens lines on a SUBMITTED / PARTIALLY_ISSUED
    // requisition (procurement.ts), and issuing is refused on any other
    // status. A requisition whose last open line is awaiting a purchase is
    // not finished — closing it here strands the line for good.
    const req = await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe(BanquetRequisitionStatus.PARTIALLY_ISSUED);
    expect(req.closedAt).toBeNull();
  });

  it("won't flag the same line twice, or one with nothing outstanding", async () => {
    asStore();
    const already = await expectRefused(async () =>
      sendBanquetRequisitionLineToProcurement({
        requisitionLineId: (await reqLine(reqId, melamine.id)).id,
      }),
    );
    expect(already).toMatch(/only pending or part-issued/i);

    const done = await expectRefused(async () =>
      sendBanquetRequisitionLineToProcurement({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
      }),
    );
    expect(done).toMatch(/only pending or part-issued/i);
  });
});

describe("one PO for SOME of the flagged lines", () => {
  it("buys the crockery and the Melamine bowls, leaving the Bonechina for another supplier", async () => {
    const { vendorId } = seeded();
    const [shallowLine, melamineLine] = await Promise.all([
      reqLine(reqId, shallow.id),
      reqLine(reqId, melamine.id),
    ]);
    asStore();
    const po = mustOk(
      await createVendorPO({
        vendorId,
        orderId,
        placeOfSupplyStateCode: "29",
        lines: [
          {
            banquetItemId: shallow.id,
            banquetReqLineId: shallowLine.id,
            sku: shallow.sku,
            description: shallow.name,
            unit: shallow.unit,
            // The shortfall, not the whole ask: 40 requested, 15 issued.
            quantity: "25",
            unitPrice: "10",
            gstRatePct: "5",
          },
          {
            banquetItemId: melamine.id,
            banquetReqLineId: melamineLine.id,
            sku: melamine.sku,
            description: melamine.name,
            unit: melamine.unit,
            quantity: "100",
            unitPrice: "2.50",
            gstRatePct: "5",
          },
        ],
      }),
      "create F&B PO",
    );
    poId = po.id;

    // The back-link is what lets the GRN find the waiting requisition line.
    expect((await reqLine(reqId, shallow.id)).vendorPOLineId).not.toBeNull();
    expect((await reqLine(reqId, melamine.id)).vendorPOLineId).not.toBeNull();
    // Flagged, but on nobody's PO yet — this is the line the second PO buys.
    expect((await reqLine(reqId, bonechina.id)).vendorPOLineId).toBeNull();
  });

  it("keeps the bought lines flagged until the goods actually land", async () => {
    for (const item of [shallow, melamine]) {
      expect((await reqLine(reqId, item.id)).status).toBe(
        BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
      );
    }
  });

  it("is approved by the manager and cannot be self-approved by the store", async () => {
    asStore();
    mustOk(await submitVendorPO(poId), "submit PO");
    expect((await read.purchaseOrder(poId)).status).toBe(VendorPOStatus.PENDING_APPROVAL);

    await expectRefused(() => approveVendorPO(poId));

    asManager();
    mustOk(await approveVendorPO(poId), "approve PO");
    const po = await read.purchaseOrder(poId);
    expect(po.status).toBe(VendorPOStatus.APPROVED);
    // 25 × ₹10 + 100 × ₹2.50 = ₹500, +5% GST.
    expectDecimal(po.grandTotal, "525", "PO grand total");
  });
});

describe("goods in — and the flagged lines RE-OPEN", () => {
  it("posts the F&B stock the GRN accepted", async () => {
    const po = await read.purchaseOrder(poId);
    asStore();
    const grn = mustOk(
      await createGRN({
        poId,
        lines: po.lines.map((l) => ({
          poLineId: l.id,
          acceptedQty: l.quantity.toString(),
          rejectedQty: "0",
        })),
      }),
      "create GRN",
    );
    expect(grn.warnings ?? []).toEqual([]);

    expectDecimal(await fnbStock(shallow.id), "25", "crockery on hand");
    expectDecimal(await fnbStock(melamine.id), "100", "hired Melamine on hand");
    // A real receipt document, not a naked stock bump.
    expect(
      await db.banquetReceiptLine.count({ where: { itemId: melamine.id } }),
    ).toBe(1);
  });

  it("re-opens exactly the lines it bought, and nothing else", async () => {
    for (const item of [shallow, melamine]) {
      const line = await reqLine(reqId, item.id);
      expect(line.status).toBe(BanquetRequisitionLineStatus.PENDING);
    }
    // Bought from another supplier — this GRN must not touch it.
    expect((await reqLine(reqId, bonechina.id)).status).toBe(
      BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
    );
  });

  it("does not lose the 15 already issued against the re-opened line", async () => {
    expectDecimal((await reqLine(reqId, shallow.id)).issuedQty, "15", "issued so far");
  });

  it("leaves the requisition open for the store to finish", async () => {
    const req = await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe(BanquetRequisitionStatus.PARTIALLY_ISSUED);
  });

  it("lets the store issue the re-opened balance — only the balance", async () => {
    asStore();
    const why = await expectRefused(async () =>
      issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, shallow.id)).id,
        issueQty: "26",
      }),
    );
    expect(why).toMatch(/Only 25 pcs still requested/);

    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, shallow.id)).id,
        issueQty: "25",
      }),
      "issue the re-opened balance",
    );
    const line = await reqLine(reqId, shallow.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.ISSUED);
    expectDecimal(line.issuedQty, "40", "issued in full");
    expectDecimal(await fnbStock(shallow.id), "0", "back off the shelf");

    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, melamine.id)).id,
        issueQty: "100",
      }),
      "issue the Melamine bowls",
    );
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.ISSUED,
    );
  });
});

describe("a second PO for the rest", () => {
  it("still offers the Bonechina line — flagged, and on no PO", async () => {
    // Exactly what /procurement/purchase-orders/new?banquetReqId= pre-fills:
    // AWAITING_PROCUREMENT and not yet back-linked to a PO line.
    const stillToBuy = await db.banquetRequisitionLine.findMany({
      where: {
        requisitionId: reqId,
        status: BanquetRequisitionLineStatus.AWAITING_PROCUREMENT,
        vendorPOLineId: null,
      },
    });
    expect(stillToBuy.map((l) => l.itemId)).toEqual([bonechina.id]);
  });

  it("buys it, receives it, and re-opens it", async () => {
    const { vendorId } = seeded();
    const line = await reqLine(reqId, bonechina.id);
    asStore();
    const po = mustOk(
      await createVendorPO({
        vendorId,
        placeOfSupplyStateCode: "29",
        lines: [
          {
            banquetItemId: bonechina.id,
            banquetReqLineId: line.id,
            sku: bonechina.sku,
            description: bonechina.name,
            unit: bonechina.unit,
            quantity: "60",
            unitPrice: "3.50",
            gstRatePct: "5",
          },
        ],
      }),
      "create second F&B PO",
    );
    secondPoId = po.id;
    expect((await reqLine(reqId, bonechina.id)).vendorPOLineId).not.toBeNull();

    mustOk(await submitVendorPO(secondPoId), "submit second PO");
    asManager();
    mustOk(await approveVendorPO(secondPoId), "approve second PO");

    const fresh = await read.purchaseOrder(secondPoId);
    asStore();
    mustOk(
      await createGRN({
        poId: secondPoId,
        lines: [{ poLineId: fresh.lines[0].id, acceptedQty: "60", rejectedQty: "0" }],
      }),
      "create second GRN",
    );

    expect((await reqLine(reqId, bonechina.id)).status).toBe(
      BanquetRequisitionLineStatus.PENDING,
    );
    expectDecimal(await fnbStock(bonechina.id), "60", "Bonechina on hand");
  });

  it("closes the requisition once the last line is issued", async () => {
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, bonechina.id)).id,
        issueQty: "60",
      }),
      "issue the Bonechina bowls",
    );
    const req = await db.banquetRequisition.findUniqueOrThrow({
      where: { id: reqId },
      include: { lines: true },
    });
    expect(req.lines.every((l) => l.status === BanquetRequisitionLineStatus.ISSUED)).toBe(true);
    expect(req.status).toBe(BanquetRequisitionStatus.FULLY_ISSUED);
    expect(req.closedAt).not.toBeNull();
  });

  it("refuses to issue against a closed requisition", async () => {
    asStore();
    const why = await expectRefused(async () =>
      issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, bonechina.id)).id,
        issueQty: "1",
      }),
    );
    expect(why).toMatch(/already fully issued|fully_issued/i);
  });
});
