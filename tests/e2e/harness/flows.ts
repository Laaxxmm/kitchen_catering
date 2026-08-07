import { formatInTimeZone } from "date-fns-tz";
import { MealType, OrderChannel, PaymentMethod } from "@prisma/client";
import { createOrder, submitOrder, chefApproveOrder } from "@/server/actions/orders";
import { markIngredientsAvailable } from "@/server/actions/chef-requisitions";
import { markOrderCooked, startCookingOrder } from "@/server/actions/production-jobs";
import {
  confirmDeliveryOTP,
  dispatchDelivery,
  scheduleDelivery,
} from "@/server/actions/deliveries";
import { recordIngredientReceipt } from "@/server/actions/inventory";
import { asChef, asDelivery, asManager, asStore, desk } from "./session";
import { mustOk } from "./assert";
import { seeded } from "./seed";

/**
 * Multi-step openings the scenarios share, composed only of real server
 * actions — no direct writes. Each leaves the session on the desk that acted
 * last, so callers should set the desk they want before carrying on.
 */

/** "yyyy-MM-ddTHH:mm" in IST — the shape the datetime-local inputs send. */
export function istInput(date: Date): string {
  return formatInTimeZone(date, "Asia/Kolkata", "yyyy-MM-dd'T'HH:mm");
}

export function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export interface PlacedOrder {
  id: string;
  code: string;
  eventDate: Date;
}

/**
 * Manager takes a catering order and submits it. A manager/admin taking the
 * order self-approves the commercial gate, so it lands straight in the
 * chef's queue at PENDING_CHEF_APPROVAL.
 */
export async function placeCateringOrder(
  opts: {
    headcount?: number;
    eventDate?: Date;
    channel?: OrderChannel;
    packageTotal?: string;
    portions?: [string, string];
  } = {},
): Promise<PlacedOrder> {
  const fixtures = seeded();
  const eventDate = opts.eventDate ?? daysFromNow(7);
  const portions = opts.portions ?? ["100", "100"];
  asManager();

  const created = mustOk(
    await createOrder({
      customerId: fixtures.customerId,
      channel: opts.channel ?? OrderChannel.BANQUET,
      eventDate: istInput(eventDate),
      headcount: opts.headcount ?? 100,
      mealType: MealType.DINNER,
      deliveryAddress: "Banquet Hall, 12 Test Road, Bengaluru",
      deliveryWindowStart: istInput(eventDate),
      deliveryWindowEnd: istInput(new Date(eventDate.getTime() + 3 * 60 * 60 * 1000)),
      placeOfSupplyStateCode: "29",
      packageTotal: opts.packageTotal ?? "250000",
      items: fixtures.dishIds.map((dishId, idx) => ({
        dishId,
        portions: portions[idx] ?? "100",
        unitPrice: idx === 0 ? "260.00" : "180.00",
        gstRatePct: "5",
      })),
    }),
    "create order",
  );

  mustOk(await submitOrder(created.id), "submit order");
  return { id: created.id, code: created.code, eventDate };
}

/** Chef accepts the order — it moves to CHEF_REQUISITION_PENDING. */
export async function chefAccepts(orderId: string, note = "Feasible."): Promise<void> {
  asChef();
  mustOk(
    await chefApproveOrder(orderId, { decision: "APPROVED", note }),
    "chef approve",
  );
}

/**
 * Order → delivered, the short way: the chef confirms the kitchen already
 * holds what it needs (no requisition), cooks, and the driver hands it over.
 * `collectAtDoor` records payment-on-delivery, which the tax invoice then
 * credits. Scenario 1 covers the long way round.
 */
export async function driveOrderToDelivered(
  orderId: string,
  opts: { collectAtDoor?: string; scheduledAt?: Date } = {},
): Promise<{ deliveryId: string }> {
  asChef();
  mustOk(
    await markIngredientsAvailable(orderId, "kitchen already stocked"),
    "ingredients available",
  );
  mustOk(await startCookingOrder(orderId), "start cooking");
  mustOk(await markOrderCooked(orderId), "mark cooked");

  asManager();
  const scheduled = mustOk(
    await scheduleDelivery({
      orderId,
      driverUserId: desk("delivery").id,
      scheduledAt: istInput(opts.scheduledAt ?? daysFromNow(7)),
    }),
    "schedule delivery",
  );

  asDelivery();
  mustOk(await dispatchDelivery(scheduled.id), "dispatch delivery");
  mustOk(
    await confirmDeliveryOTP(
      scheduled.id,
      opts.collectAtDoor
        ? {
            paymentCollected: true,
            paymentAmount: opts.collectAtDoor,
            paymentMethod: PaymentMethod.UPI,
            paymentReference: "E2E-DOOR-001",
          }
        : {},
    ),
    "confirm delivery",
  );
  return { deliveryId: scheduled.id };
}

/** Put stock on the shelf the honest way — a recorded receipt, which also
 *  sets the moving-average cost the issue will snapshot. */
export async function stockUp(
  ingredientId: string,
  qty: string,
  unitCost = "200",
): Promise<void> {
  asStore();
  mustOk(
    await recordIngredientReceipt({ ingredientId, qty, unitCost, supplier: "E2E Provisions" }),
    "record receipt",
  );
}
