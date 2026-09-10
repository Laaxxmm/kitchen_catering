import "../harness/database-url";

import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getOrderTimelines } from "@/server/reports/order-timeline";
import {
  chefAccepts,
  daysFromNow,
  driveOrderToDelivered,
  ensureSeeded,
  flushDeferred,
  placeCateringOrder,
} from "../harness";

/**
 * The timeline lines up stamps the app already writes. So the proof is an
 * order driven through the real actions — taken, accepted, chef, cooking,
 * cooked, delivered — read back as one row with every stage filled in and a
 * verdict against the delivery time.
 */

beforeAll(async () => {
  await ensureSeeded();
});

describe("order timeline", () => {
  it("has a stamp for every stage the order went through", async () => {
    const event = daysFromNow(3);
    const order = await placeCateringOrder({ eventDate: event });
    await chefAccepts(order.id);
    // Delivered well before the window opens — on time.
    await driveOrderToDelivered(order.id, { scheduledAt: new Date(event.getTime() - 2 * 3600_000) });
    await flushDeferred();

    const from = new Date(event.getTime() - 24 * 3600_000);
    const to = new Date(event.getTime() + 24 * 3600_000);
    const row = (await getOrderTimelines(from, to)).find((r) => r.id === order.id);
    expect(row).toBeDefined();
    expect(row!.taken).toBeInstanceOf(Date);
    expect(row!.accepted).toBeInstanceOf(Date);
    expect(row!.kitchenTook).toBeInstanceOf(Date);
    expect(row!.cookingStarted).toBeInstanceOf(Date);
    expect(row!.cooked).toBeInstanceOf(Date);
    expect(row!.delivered).toBeInstanceOf(Date);
    // Stages happened in order.
    expect(row!.accepted!.getTime()).toBeGreaterThanOrEqual(row!.taken.getTime());
    expect(row!.kitchenTook!.getTime()).toBeGreaterThanOrEqual(row!.accepted!.getTime());
    expect(row!.cooked!.getTime()).toBeGreaterThanOrEqual(row!.cookingStarted!.getTime());
    expect(row!.delivered!.getTime()).toBeGreaterThanOrEqual(row!.cooked!.getTime());
    expect(row!.verdict.kind).toBe("on-time");
  });

  it("reads late when the delivery lands after the window opens", async () => {
    // An order can't be taken for the past, so take it for later today and
    // then move its window back an hour — the delivery that follows lands
    // after the window opened, which is what "late" means.
    const event = daysFromNow(1);
    const order = await placeCateringOrder({ eventDate: event });
    const hourAgo = new Date(Date.now() - 60 * 60_000);
    await db.order.update({ where: { id: order.id }, data: { deliveryWindowStart: hourAgo } });
    await chefAccepts(order.id);
    await driveOrderToDelivered(order.id, { scheduledAt: new Date() });
    await flushDeferred();

    const row = (await getOrderTimelines(new Date(event.getTime() - 3600_000), new Date(event.getTime() + 3600_000)))
      .find((r) => r.id === order.id);
    expect(row?.verdict.kind).toBe("late");
    if (row?.verdict.kind === "late") expect(row.verdict.lateMinutes).toBeGreaterThanOrEqual(59);
  });

  it("leaves the range empty when no event falls in it", async () => {
    const far = daysFromNow(400);
    expect(await getOrderTimelines(far, new Date(far.getTime() + 3600_000))).toEqual([]);
  });
});
