/**
 * Helpers, constants and notifications shared by more than one stage of the orders
 * lifecycle. Not a server-action module: nothing here is callable from the client.
 */

import { Decimal } from "decimal.js";
import { Role } from "@prisma/client";
import { db } from "@/server/db";
import { computeLine as computeGstLine } from "@/lib/gst";
import { isEventDeliveryChannel } from "@/lib/order-channels";
import { notifyRoles } from "@/server/notification-core";
import { formatIST } from "@/lib/time";

/**
 * Fire-and-forget: order cleared the manager gate, now needs chef review.
 * Fans out to the chef (review feasibility) AND gives the delivery team and
 * F&B service an early heads-up that an order is coming through.
 */
export async function notifyOrderToChef(orderId: string) {
  try {
    await notifyOrderToChefInner(orderId);
  } catch (err) {
    console.warn("[notify] order-to-chef fanout failed:", err);
  }
}

export async function notifyOrderToChefInner(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      code: true,
      channel: true,
      headcount: true,
      eventDate: true,
      customer: { select: { name: true } },
    },
  });
  if (!order) return;
  const evt = formatIST(order.eventDate, "EEE d MMM");
  const eventOrder = isEventDeliveryChannel(order.channel);
  // Chef: it's their move now.
  await notifyRoles([Role.KITCHEN_HEAD], {
    kind: "GENERIC",
    title: `Order ${order.code} approved — chef review`,
    body: `${order.customer.name} · ${order.channel} · ${order.headcount} pax · event ${evt}. Manager signed off — accept or suggest changes.`,
    link: `/orders/${orderId}`,
    dedupeKey: `order-to-chef:${orderId}`,
  });
  // F&B / delivery: package + event orders (banquet / buffet / ODC / packed)
  // need cutlery + arrangements planned ahead — tell them the moment the
  // manager approves, not only when the kitchen accepts.
  await notifyRoles([Role.DELIVERY, Role.FNB_SERVICE], {
    kind: "GENERIC",
    title: eventOrder
      ? `Event confirmed — ${order.code} on ${evt}`
      : `Order ${order.code} approved — heads-up`,
    body: eventOrder
      ? `${order.customer.name} · ${order.channel} · ${order.headcount} pax. Manager approved — start planning cutlery & arrangements; issue and mark event prep ready before the event.`
      : `${order.customer.name} · ${order.channel} · ${order.headcount} pax. Manager approved — an order is on the way.`,
    link: eventOrder ? `/deliveries/event-prep/${orderId}` : `/orders/${orderId}`,
    dedupeKey: `order-to-fnb:${orderId}`,
  });
}

export interface ComputedLine {
  subtotal: Decimal;
  tax: Decimal;
  total: Decimal;
}

export function computeLine(portions: string, unitPrice: string, discountPct?: string, gstRatePct?: string): ComputedLine {
  // Delegate to gst.computeLine so orders round line amounts the same way
  // invoices, POs and bills do (per-line round then sum). "portions" is this
  // domain's quantity.
  return computeGstLine({
    quantity: portions,
    unitPrice,
    discountPct: discountPct ?? "0",
    gstRatePct: gstRatePct ?? "0",
  });
}
