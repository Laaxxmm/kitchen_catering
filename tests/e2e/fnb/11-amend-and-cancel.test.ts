// FIRST import, always — see db-url.ts.
import "./db-url";
import { beforeAll, describe, expect, it } from "vitest";
import { BanquetRequisitionLineStatus, BanquetRequisitionStatus } from "@prisma/client";
import { db } from "@/server/db";
import {
  amendBanquetRequisitionLineQty,
  cancelBanquetRequisitionLine,
  createBanquetRequisition,
  issueBanquetRequisitionLine,
  sendBanquetRequisitionLineToProcurement,
} from "@/server/actions/banquet";
import {
  asDelivery,
  asStore,
  desk,
  ensureSeeded,
  expectDecimal,
  expectRefused,
  flushDeferred,
  mustOk,
  placeCateringOrder,
} from "../harness";
import { FNB_CODES, fnbItem, fnbStock, reqLine, type FnbItem } from "./items";

/**
 * The event grew after the store had already issued against the old number.
 * Raising a line's quantity has to re-open exactly the difference on the SAME
 * line — no second document — and it must never fall below what physically
 * left the store. Plus the store's line-level cancel, which has to let the
 * rest of the requisition carry on.
 */

let orderId: string;
let plentiful: FnbItem;
let shallow: FnbItem;
let melamine: FnbItem;

/** A requisition with the given (item, qty) lines, raised by F&B. */
async function raise(lines: Array<[FnbItem, string]>): Promise<string> {
  asDelivery();
  const created = mustOk(
    await createBanquetRequisition({
      orderId,
      lines: lines.map(([item, requestedQty]) => ({ itemId: item.id, requestedQty })),
    }),
    "create banquet requisition",
  );
  return created.id;
}

beforeAll(async () => {
  await ensureSeeded();
  [plentiful, shallow, melamine] = await Promise.all([
    fnbItem(FNB_CODES.plentiful),
    fnbItem(FNB_CODES.shallow),
    fnbItem(FNB_CODES.hiredMelamine),
  ]);
  orderId = (await placeCateringOrder()).id;
});

describe("F&B raises the quantity after the store has already issued", () => {
  let reqId: string;
  let openingStock: string;

  beforeAll(async () => {
    openingStock = await fnbStock(plentiful.id);
    // The second line stays PENDING so the requisition is still open — a
    // closed requisition can't be amended at all (kitchen parity).
    reqId = await raise([
      [plentiful, "100"],
      [melamine, "10"],
    ]);
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
        issueQty: "100",
      }),
      "issue in full",
    );
  });

  it("starts from a line the store considers finished", async () => {
    expect((await reqLine(reqId, plentiful.id)).status).toBe(
      BanquetRequisitionLineStatus.ISSUED,
    );
  });

  it("drops the finished line back to part-issued, on the same line", async () => {
    asDelivery();
    mustOk(
      await amendBanquetRequisitionLineQty(
        (await reqLine(reqId, plentiful.id)).id,
        "150",
        "Pax went 100 → 150",
      ),
      "raise the quantity",
    );
    const line = await reqLine(reqId, plentiful.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.PARTIALLY_ISSUED);
    expectDecimal(line.requestedQty, "150", "requested");
    expectDecimal(line.issuedQty, "100", "already issued");
    // No second requisition, no second line.
    expect(await db.banquetRequisitionLine.count({ where: { requisitionId: reqId } })).toBe(2);
  });

  it("tells the store the extra to hand over, not the new total", async () => {
    await flushDeferred();
    const notice = await db.notification.findFirst({
      where: { userId: desk("store").id, title: { contains: plentiful.name } },
      orderBy: { createdAt: "desc" },
    });
    expect(notice?.title).toContain("Issue 50");
  });

  it("lets the store issue the difference and no more", async () => {
    asStore();
    const why = await expectRefused(async () =>
      issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
        issueQty: "51",
      }),
    );
    expect(why).toMatch(/Only 50 pcs still requested/);

    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
        issueQty: "50",
      }),
      "issue the difference",
    );
    const line = await reqLine(reqId, plentiful.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.ISSUED);
    expectDecimal(line.issuedQty, "150", "issued in total");
    // 150 left the store across the two issues — not 250.
    expectDecimal(
      await fnbStock(plentiful.id),
      String(Number(openingStock) - 150),
      "on hand",
    );
  });

  it("will not go below what physically left the store", async () => {
    asDelivery();
    const why = await expectRefused(async () =>
      amendBanquetRequisitionLineQty(
        (await reqLine(reqId, plentiful.id)).id,
        "120",
        "Client cut back",
      ),
    );
    expect(why).toMatch(/150 pcs already issued/);
    expect(why).toMatch(/banquet return/i);
    expectDecimal((await reqLine(reqId, plentiful.id)).requestedQty, "150", "unchanged");
  });

  it("refuses a no-op, a zero and a missing reason", async () => {
    asDelivery();
    const lineId = (await reqLine(reqId, plentiful.id)).id;
    expect(
      await expectRefused(() => amendBanquetRequisitionLineQty(lineId, "150", "same again")),
    ).toMatch(/Already requesting 150/);
    expect(
      await expectRefused(async () =>
        amendBanquetRequisitionLineQty(
          (await reqLine(reqId, melamine.id)).id,
          "0",
          "drop it",
        ),
      ),
    ).toMatch(/greater than 0/);
    expect(
      await expectRefused(() => amendBanquetRequisitionLineQty(lineId, "200", "  ")),
    ).toMatch(/reason is required/i);
  });

  it("lets an untouched line be cut, and it stays pending", async () => {
    asDelivery();
    mustOk(
      await amendBanquetRequisitionLineQty(
        (await reqLine(reqId, melamine.id)).id,
        "4",
        "Fewer head tables",
      ),
      "cut the pending line",
    );
    const line = await reqLine(reqId, melamine.id);
    expectDecimal(line.requestedQty, "4", "requested");
    expect(line.status).toBe(BanquetRequisitionLineStatus.PENDING);
  });
});

describe("amending a line that is already awaiting a purchase", () => {
  let reqId: string;

  beforeAll(async () => {
    reqId = await raise([
      [melamine, "20"],
      [plentiful, "5"],
    ]);
    asStore();
    mustOk(
      await sendBanquetRequisitionLineToProcurement({
        requisitionLineId: (await reqLine(reqId, melamine.id)).id,
        reason: "None in the store",
      }),
      "flag the shortfall",
    );
  });

  it("moves the number but keeps the flag — the GRN handshake depends on it", async () => {
    asDelivery();
    mustOk(
      await amendBanquetRequisitionLineQty(
        (await reqLine(reqId, melamine.id)).id,
        "35",
        "Extra head table",
      ),
      "raise a flagged line",
    );
    const line = await reqLine(reqId, melamine.id);
    expectDecimal(line.requestedQty, "35", "requested");
    // Clearing the flag here would drop the line out of the GRN's re-open
    // query, and the goods would land with nothing waiting on them.
    expect(line.status).toBe(BanquetRequisitionLineStatus.AWAITING_PROCUREMENT);
  });

  it("warns the store the purchase may no longer cover the need", async () => {
    await flushDeferred();
    const notice = await db.notification.findFirst({
      where: { userId: desk("store").id, title: { contains: melamine.name } },
      orderBy: { createdAt: "desc" },
    });
    expect(notice?.title).toContain("Issue 15");
  });
});

describe("the store cancels a line it cannot provide", () => {
  let reqId: string;

  beforeAll(async () => {
    reqId = await raise([
      [plentiful, "20"],
      [shallow, "20"],
      [melamine, "7"],
    ]);
  });

  it("insists on a reason", async () => {
    asStore();
    const why = await expectRefused(async () =>
      cancelBanquetRequisitionLine((await reqLine(reqId, melamine.id)).id, "   "),
    );
    expect(why).toMatch(/reason is required/i);
    expect((await reqLine(reqId, melamine.id)).status).toBe(
      BanquetRequisitionLineStatus.PENDING,
    );
  });

  it("cancels the line and records why, on the line itself", async () => {
    asStore();
    mustOk(
      await cancelBanquetRequisitionLine(
        (await reqLine(reqId, melamine.id)).id,
        "Hire vendor can't supply before the event",
      ),
      "cancel the line",
    );
    const line = await reqLine(reqId, melamine.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.CANCELLED);
    expect(line.notes).toContain("Hire vendor can't supply");
  });

  it("tells the F&B requester so they can plan around it", async () => {
    await flushDeferred();
    const notice = await db.notification.findFirst({
      where: { userId: desk("delivery").id, title: { contains: melamine.name } },
      orderBy: { createdAt: "desc" },
    });
    expect(notice?.title).toContain("cancelled");
  });

  it("won't cancel the same line twice", async () => {
    asStore();
    const why = await expectRefused(async () =>
      cancelBanquetRequisitionLine((await reqLine(reqId, melamine.id)).id, "again"),
    );
    expect(why).toMatch(/already cancelled/i);
  });

  it("lets the rest of the requisition carry on", async () => {
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, plentiful.id)).id,
        issueQty: "20",
      }),
      "issue the next line",
    );
    expect((await reqLine(reqId, plentiful.id)).status).toBe(
      BanquetRequisitionLineStatus.ISSUED,
    );
    expect(
      (await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } })).status,
    ).toBe(BanquetRequisitionStatus.PARTIALLY_ISSUED);
  });

  it("keeps the issued quantity on a part-issued line it cancels", async () => {
    asStore();
    mustOk(
      await issueBanquetRequisitionLine({
        requisitionLineId: (await reqLine(reqId, shallow.id)).id,
        issueQty: "15",
      }),
      "part-issue",
    );
    mustOk(
      await cancelBanquetRequisitionLine(
        (await reqLine(reqId, shallow.id)).id,
        "Event dropped the soup course",
      ),
      "cancel the part-issued line",
    );
    const line = await reqLine(reqId, shallow.id);
    expect(line.status).toBe(BanquetRequisitionLineStatus.CANCELLED);
    // The 15 that left the store is a real movement — it stays on the line.
    expectDecimal(line.issuedQty, "15", "issued before the cancel");
  });

  it("closes the requisition once every line is issued or cancelled", async () => {
    const req = await db.banquetRequisition.findUniqueOrThrow({ where: { id: reqId } });
    expect(req.status).toBe(BanquetRequisitionStatus.FULLY_ISSUED);
    expect(req.closedAt).not.toBeNull();
  });

  it("refuses to cancel a line that was fully issued", async () => {
    asStore();
    const why = await expectRefused(async () =>
      cancelBanquetRequisitionLine(
        (await reqLine(reqId, plentiful.id)).id,
        "changed my mind",
      ),
    );
    expect(why).toMatch(/already fully issued/i);
  });
});
