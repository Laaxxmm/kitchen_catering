import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { OrderChannel, OrderStatus } from "@prisma/client";
import { db } from "@/server/db";
import { listEventPrepQueue, listUpcomingEventOrders } from "@/server/actions/deliveries";
import { getOrder } from "@/server/actions/orders";
import { asDelivery, daysFromNow, ensureSeeded, placeCateringOrder } from "../harness";

/**
 * F&B arrange the room, the cutlery and the service round what is being
 * served, and that planning starts the moment the order exists — not when
 * the chef gets to it.
 *
 * The order was showing on their dashboard from creation, but the card was
 * a dead <li> and carried no dishes, so the team could see an event they
 * could not read. Nothing about the order was ever hidden from them: the
 * detail page renders the menu for every role that can read the order.
 */

let orderId: string;

beforeAll(async () => {
  await ensureSeeded();
  const order = await placeCateringOrder();
  orderId = order.id;
});

describe("an order F&B can see, before the chef has touched it", () => {
  it("is still waiting on the chef", async () => {
    await asDelivery();
    const order = await getOrder(orderId);
    expect(order?.status).toBe(OrderStatus.PENDING_CHEF_APPROVAL);
  });

  it("carries the menu on the upcoming card, not just a code", async () => {
    await asDelivery();
    const upcoming = await listUpcomingEventOrders();
    const row = upcoming.find((o) => o.id === orderId);
    expect(row).toBeDefined();
    expect(row!.items.length).toBeGreaterThan(0);
    expect(row!.items[0].label.length).toBeGreaterThan(0);
    expect(row!.headcount).toBeGreaterThan(0);
  });

  it("opens in full, dishes and portions included", async () => {
    await asDelivery();
    const order = await getOrder(orderId);
    expect(order).not.toBeNull();
    expect(order!.items.length).toBeGreaterThan(0);
    expect(order!.items[0].dish.name.length).toBeGreaterThan(0);
  });
});

/**
 * The two ways an order stayed invisible to F&B.
 *
 * A sales-taken catering order stops at PENDING_ADMIN_APPROVAL (a manager
 * taking it skips that gate), and that status was missing from the list —
 * so it appeared only once someone signed it, which is after the cutlery
 * planning should have started.
 *
 * And the window was 7 days. Arrangements for a big event are made weeks
 * out; an order booked further ahead than a week was simply not on the
 * screen, which is how a manager's two orders showed up as one.
 *
 * Both tests drive the status/date directly: what changed is the query's
 * filter, and that is what they pin.
 */
describe("orders that used to be invisible", () => {
  it("shows one still waiting on the admin", async () => {
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(2),
    });
    await db.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PENDING_ADMIN_APPROVAL },
    });

    await asDelivery();
    const found = (await listUpcomingEventOrders()).find((o) => o.id === order.id);
    expect(found).toBeDefined();
    // It reads as unapproved on the card rather than being hidden.
    expect(found!.status).toBe(OrderStatus.PENDING_ADMIN_APPROVAL);
    expect(found!.items.length).toBeGreaterThan(0);
  });

  it("shows an event three weeks out", async () => {
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(21),
    });
    await asDelivery();
    expect((await listUpcomingEventOrders()).some((o) => o.id === order.id)).toBe(true);
  });

  it("still leaves a draft off — not submitted is not an order", async () => {
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(3),
    });
    await db.order.update({ where: { id: order.id }, data: { status: OrderStatus.DRAFT } });

    await asDelivery();
    expect((await listUpcomingEventOrders()).some((o) => o.id === order.id)).toBe(false);
  });
});

/**
 * The prep queue starts when the booking does, not when the chef gets to it.
 *
 * Cutlery, crockery and serving staff follow the pax count and the channel,
 * so that work can begin the moment the order exists. It used to start at
 * CHEF_REQUISITION_PENDING, which left a 250-cover event two days out absent
 * from the one screen the team plans from.
 */
describe("event prep before the chef has approved", () => {
  it("queues an order that is still awaiting chef approval", async () => {
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(2),
    });
    await asDelivery();
    const row = (await listEventPrepQueue()).find((o) => o.id === order.id);
    expect(row).toBeDefined();
    // Carries the status so the card can say it isn't signed off yet.
    expect(row!.status).toBe(OrderStatus.PENDING_CHEF_APPROVAL);
    expect(row!.headcount).toBeGreaterThan(0);
  });

  it("queues one the admin has not signed either", async () => {
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(4),
    });
    await db.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PENDING_ADMIN_APPROVAL },
    });
    await asDelivery();
    expect((await listEventPrepQueue()).some((o) => o.id === order.id)).toBe(true);
  });

  it("keeps a draft out of the prep queue", async () => {
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(5),
    });
    await db.order.update({ where: { id: order.id }, data: { status: OrderStatus.DRAFT } });
    await asDelivery();
    expect((await listEventPrepQueue()).some((o) => o.id === order.id)).toBe(false);
  });

  it("keeps in-house channels out — nothing to run out to", async () => {
    // Room service is served on the premises. Taking one properly needs a
    // room number, so the channel is flipped after the fact — the filter
    // under test reads the channel, not how the order was taken.
    const order = await placeCateringOrder({
      channel: OrderChannel.ODC,
      eventDate: daysFromNow(2),
    });
    await db.order.update({
      where: { id: order.id },
      data: { channel: OrderChannel.ROOM_SERVICE },
    });
    await asDelivery();
    expect((await listEventPrepQueue()).some((o) => o.id === order.id)).toBe(false);
  });
});
