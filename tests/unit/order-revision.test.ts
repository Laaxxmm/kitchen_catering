import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { computeRevisionBand, isStaleAfterRevision } from "@/lib/order-revision";

const NOW = new Date("2026-08-06T10:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** Event `ms` from NOW (negative = already started/past). */
function at(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

/**
 * The band decides whether reviseOrder demands a manager confirmation and how
 * loudly the boards shout, so both of its inputs are tested from BOTH sides of
 * every boundary — a band that silently rounds the wrong way is a revision the
 * kitchen never hears about.
 */
describe("computeRevisionBand", () => {
  it("is CRITICAL inside the last hour and URGENT just outside it", () => {
    expect(computeRevisionBand({ eventDate: at(59 * MIN), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("CRITICAL");
    // 61 minutes out is no longer critical, but still inside the day.
    expect(computeRevisionBand({ eventDate: at(61 * MIN), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("URGENT");
  });

  it("is URGENT inside the last day and NORMAL just outside it", () => {
    expect(computeRevisionBand({ eventDate: at(23 * HOUR), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("URGENT");
    expect(computeRevisionBand({ eventDate: at(25 * HOUR), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("NORMAL");
  });

  it("treats an event already in the past as CRITICAL, not NORMAL", () => {
    // A negative interval is the most urgent case there is; letting it fall
    // through to NORMAL would silently wave through the worst revisions.
    expect(computeRevisionBand({ eventDate: at(-2 * HOUR), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("CRITICAL");
    expect(computeRevisionBand({ eventDate: at(-30 * 24 * HOUR), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("CRITICAL");
  });

  it("escalates on status alone when the event is far off", () => {
    // A week out, but the food is in the pans — the clock says nothing.
    const eventDate = at(7 * 24 * HOUR);
    for (const status of [OrderStatus.IN_PREP, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY]) {
      expect(computeRevisionBand({ eventDate, status, now: NOW })).toBe("CRITICAL");
    }
  });

  it("escalates to URGENT once the store has a plan to redo", () => {
    const eventDate = at(7 * 24 * HOUR);
    for (const status of [
      OrderStatus.CHEF_REQUISITION_PENDING,
      OrderStatus.ISSUING,
      OrderStatus.READY_FOR_PRODUCTION,
    ]) {
      expect(computeRevisionBand({ eventDate, status, now: NOW })).toBe("URGENT");
    }
  });

  it("is NORMAL for a far-off order nobody has started", () => {
    expect(
      computeRevisionBand({
        eventDate: at(7 * 24 * HOUR),
        status: OrderStatus.PENDING_CHEF_APPROVAL,
        now: NOW,
      }),
    ).toBe("NORMAL");
  });

  it("takes the worse of the two signals, never the milder", () => {
    // Far-off date (NORMAL) + cooking (CRITICAL) → CRITICAL, and an imminent
    // event (CRITICAL) + an untouched status → still CRITICAL.
    expect(computeRevisionBand({ eventDate: at(7 * 24 * HOUR), status: OrderStatus.IN_PREP, now: NOW }))
      .toBe("CRITICAL");
    expect(computeRevisionBand({ eventDate: at(10 * MIN), status: OrderStatus.DRAFT, now: NOW }))
      .toBe("CRITICAL");
  });
});

describe("isStaleAfterRevision", () => {
  const createdAt = new Date("2026-08-01T00:00:00.000Z");

  it("is never stale when the order was never revised", () => {
    expect(isStaleAfterRevision({ lastRevisedAt: null, ackAt: null, createdAt })).toBe(false);
  });

  it("falls back to createdAt when nobody has acknowledged the document", () => {
    // Revision landed after the document was raised → re-read it.
    expect(
      isStaleAfterRevision({
        lastRevisedAt: new Date("2026-08-02T00:00:00.000Z"),
        ackAt: null,
        createdAt,
      }),
    ).toBe(true);
    // Document raised AFTER the revision already accounts for it.
    expect(
      isStaleAfterRevision({
        lastRevisedAt: new Date("2026-07-30T00:00:00.000Z"),
        ackAt: null,
        createdAt,
      }),
    ).toBe(false);
  });

  it("uses the acknowledgement once there is one", () => {
    const ackAt = new Date("2026-08-03T00:00:00.000Z");
    expect(
      isStaleAfterRevision({ lastRevisedAt: new Date("2026-08-04T00:00:00.000Z"), ackAt, createdAt }),
    ).toBe(true);
    expect(
      isStaleAfterRevision({ lastRevisedAt: new Date("2026-08-02T00:00:00.000Z"), ackAt, createdAt }),
    ).toBe(false);
  });

  it("is not stale when the revision and the acknowledgement are the same instant", () => {
    // Strictly later, so re-acknowledging can't leave the row flagged.
    const t = new Date("2026-08-03T00:00:00.000Z");
    expect(isStaleAfterRevision({ lastRevisedAt: t, ackAt: new Date(t), createdAt })).toBe(false);
  });
});
