import type { Prisma } from "@prisma/client";
import { indefineStateCode } from "./org";

// A single built-in customer that in-house orders (room service / à la carte
// / management) are booked against when there's no named guest. The order is
// tracked by room/table number on screen; this just keeps invoicing & GST
// working (every invoice needs a customer + place of supply).

export const HOUSE_CUSTOMER_NAME = "House Guest / Walk-in";

/**
 * Find the house customer, creating it on first use. Pass a transaction
 * client so it shares the order-creation transaction.
 */
export async function getOrCreateHouseCustomerId(
  tx: Prisma.TransactionClient,
): Promise<string> {
  const existing = await tx.customer.findFirst({
    where: { name: HOUSE_CUSTOMER_NAME },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await tx.customer.create({
    data: {
      name: HOUSE_CUSTOMER_NAME,
      billingAddress: "In-house (room service / dine-in / management)",
      stateCode: indefineStateCode(),
      notes:
        "Auto-created bucket for in-house orders with no named guest. Orders are tracked by room/table number.",
    },
    select: { id: true },
  });
  return created.id;
}
