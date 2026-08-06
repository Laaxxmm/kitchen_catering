import { ChefRequisitionLineStatus } from "@prisma/client";
import { Decimal } from "decimal.js";

/**
 * The whole decision behind raising a requisition line's requested quantity
 * AFTER the store already has it: the order went 10 pax → 20, the chef asks
 * for 10 of something they already got 5 of, and the store issues only the
 * missing 5 against the same line.
 *
 * Pure and shared by the server action and the chef's inline control, so the
 * button can't offer what the server would refuse — and so the arithmetic is
 * testable without a database.
 */
export type AmendDecision =
  | { ok: true; qty: string; status: ChefRequisitionLineStatus }
  | { ok: false; error: string };

export function decideAmend({
  currentQty,
  newQty,
  issuedQty,
  lineStatus,
}: {
  currentQty: string;
  newQty: string;
  issuedQty: string;
  lineStatus: ChefRequisitionLineStatus;
}): AmendDecision {
  if (lineStatus === ChefRequisitionLineStatus.CANCELLED) {
    return { ok: false, error: "This item was cancelled — its quantity can't be changed." };
  }

  let next: Decimal;
  try {
    // Quantities are Decimal(14,3) in the database; round to that here so the
    // "did it actually change?" test below compares what would be stored.
    next = new Decimal(newQty).toDecimalPlaces(3);
  } catch {
    return { ok: false, error: "Enter a valid quantity." };
  }
  if (!next.isFinite() || next.lte(0)) {
    return { ok: false, error: "Quantity must be above 0." };
  }
  if (next.eq(new Decimal(currentQty))) {
    return { ok: false, error: "That's already the requested quantity." };
  }

  const issued = new Decimal(issuedQty);
  if (next.lt(issued)) {
    return {
      ok: false,
      error:
        `${issued.toString()} has already been issued — the request can't go below that. ` +
        `Physically return the stock to the store to reverse an issue.`,
    };
  }

  return { ok: true, qty: next.toString(), status: nextLineStatus(next, issued, lineStatus) };
}

function nextLineStatus(
  requested: Decimal,
  issued: Decimal,
  current: ChefRequisitionLineStatus,
): ChefRequisitionLineStatus {
  // A purchase order is out for this line's shortfall. Changing the number
  // changes how much is short, not the fact that the store is waiting on a
  // vendor — and it's GRN acceptance that owns the flip back to PENDING
  // ("stock has arrived — issue now"). Leave the flag alone; the store is
  // told in the notification that the PO no longer covers the whole need.
  if (current === ChefRequisitionLineStatus.AWAITING_PROCUREMENT) return current;

  if (issued.gte(requested)) return ChefRequisitionLineStatus.ISSUED;
  // The point of the whole feature: a fully-ISSUED line drops back to
  // PARTIALLY_ISSUED when the chef raises the number, which is what puts the
  // difference back in the store's queue.
  if (issued.gt(0)) return ChefRequisitionLineStatus.PARTIALLY_ISSUED;
  return ChefRequisitionLineStatus.PENDING;
}
