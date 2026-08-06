import { Decimal } from "decimal.js";
import type { StockStore } from "@prisma/client";
import { toDecimal } from "./money";

/** What each store is called on screen. Type-only enum import so the client
 *  pickers can use this without pulling Prisma into the browser bundle. */
export const STORE_LABELS: Record<StockStore, string> = {
  KITCHEN: "Kitchen store",
  FNB: "F&B store",
  HOUSEKEEPING: "Housekeeping store",
};

/**
 * Ceilings for the two movements that can take stock the wrong way.
 *
 * Kept pure and separate from the actions so the arithmetic is testable
 * without a database — these are the guards that stand between a mistyped
 * quantity and a corrupted stock ledger.
 */

/**
 * How much of one issue may still come back: what went out, less what has
 * already been returned against it. Never negative.
 */
export function remainingReturnable(
  issuedQty: Decimal | string,
  alreadyReturned: Decimal | string,
): Decimal {
  const left = toDecimal(issuedQty).minus(toDecimal(alreadyReturned));
  return left.lt(0) ? new Decimal(0) : left;
}

/**
 * Refusal message for a return line, or null when it's allowed. The message
 * states the remaining returnable quantity, because "not allowed" without
 * the number sends the store keeper guessing.
 */
export function checkReturnQty(input: {
  want: Decimal | string;
  issuedQty: Decimal | string;
  alreadyReturned: Decimal | string;
  name: string;
  unit: string;
}): string | null {
  const want = toDecimal(input.want);
  if (want.lte(0)) return "Return quantity must be greater than 0";
  const left = remainingReturnable(input.issuedQty, input.alreadyReturned);
  if (want.gt(left)) {
    return left.isZero()
      ? `${input.name} on this issue has already been returned in full — nothing left to take back.`
      : `Only ${left.toString()} ${input.unit} of ${input.name} is still returnable against this issue (${toDecimal(input.issuedQty).toString()} issued, ${toDecimal(input.alreadyReturned).toString()} already returned).`;
  }
  return null;
}

/**
 * Refusal message for the source side of a transfer, or null when it's
 * allowed. A transfer that takes a store below zero is never a transfer —
 * it's two wrong numbers.
 */
export function checkTransferQty(input: {
  want: Decimal | string;
  onHand: Decimal | string;
  name: string;
  unit: string;
}): string | null {
  const want = toDecimal(input.want);
  if (want.lte(0)) return "Transfer quantity must be greater than 0";
  const onHand = toDecimal(input.onHand);
  if (want.gt(onHand)) {
    return `Only ${onHand.toString()} ${input.unit} of ${input.name} in the source store — can't transfer ${want.toString()}.`;
  }
  return null;
}
