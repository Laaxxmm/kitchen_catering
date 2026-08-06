import { describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { criticalReasons } from "@/app/(dashboard)/orders/[id]/revise/_components/critical-reasons";

// The manager reads these sentences right before overriding a warning on a
// live order, so the numbers in them have to be honest. Fixed clock — the
// suite must not depend on when it runs.
const NOW = new Date("2026-08-06T12:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const MIN = 60_000;

function reasons(offsetMs: number, status: OrderStatus = OrderStatus.READY_FOR_PRODUCTION) {
  return criticalReasons({ eventDate: at(offsetMs), status, now: NOW });
}

describe("criticalReasons", () => {
  it("counts down in minutes under the hour", () => {
    expect(reasons(38 * MIN)).toEqual(["This event starts in 38 minutes."]);
  });

  it("never overstates the time left", () => {
    // 38m59s must read as 38, not 39 — a manager acting on the rounded-up
    // number would think they had a minute they do not have.
    expect(reasons(38 * MIN + 59_000)).toEqual(["This event starts in 38 minutes."]);
  });

  it("says 'under a minute' rather than 'in 0 minutes'", () => {
    expect(reasons(30_000)).toEqual(["This event starts in under a minute."]);
  });

  it("reports an overdue event as elapsed, never as time remaining", () => {
    expect(reasons(-12 * MIN)).toEqual(["This event was due to start 12 minutes ago."]);
  });

  it("floors a barely-overdue event away from zero", () => {
    // 30s late is "1 minute ago" — "0 minutes ago" would read as on time.
    expect(reasons(-30_000)).toEqual(["This event was due to start 1 minute ago."]);
  });

  it("singularises one minute", () => {
    expect(reasons(1 * MIN)).toEqual(["This event starts in 1 minute."]);
  });

  it("switches to hours past 90 minutes", () => {
    expect(reasons(-180 * MIN)).toEqual(["This event was due to start 3 hours ago."]);
  });

  it("gives no clock reason when the event is more than an hour out", () => {
    expect(reasons(5 * 60 * MIN)).toEqual([
      "This order is too far along for the kitchen to absorb a change quietly.",
    ]);
  });

  it("explains a started kitchen on its own, with no clock reason", () => {
    // The band is CRITICAL on status alone here — the event is a week away.
    expect(reasons(7 * 24 * 60 * MIN, OrderStatus.IN_PREP)).toEqual([
      "The kitchen is already cooking this order.",
    ]);
  });

  it("gives both reasons when both apply, clock first", () => {
    expect(reasons(10 * MIN, OrderStatus.IN_PREP)).toEqual([
      "This event starts in 10 minutes.",
      "The kitchen is already cooking this order.",
    ]);
  });

  it("has wording for every status that is critical on its own", () => {
    for (const status of [OrderStatus.IN_PREP, OrderStatus.READY, OrderStatus.OUT_FOR_DELIVERY]) {
      const [only] = reasons(7 * 24 * 60 * MIN, status);
      expect(only).not.toMatch(/too far along/);
    }
  });

  it("never returns an empty list", () => {
    for (const status of Object.values(OrderStatus)) {
      expect(reasons(7 * 24 * 60 * MIN, status).length).toBeGreaterThan(0);
    }
  });
});
