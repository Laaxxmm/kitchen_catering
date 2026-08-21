import "./db-url";

import { beforeAll, describe, expect, it } from "vitest";
import { OrderStatus } from "@prisma/client";
import { listUpcomingEventOrders } from "@/server/actions/deliveries";
import { getOrder } from "@/server/actions/orders";
import { asDelivery, ensureSeeded, placeCateringOrder } from "../harness";

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
