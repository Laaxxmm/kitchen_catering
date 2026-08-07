import { Decimal } from "decimal.js";
import type { BanquetItemSource, Role, StockStore } from "@prisma/client";
import { toDecimal } from "./money";

/** What each store is called on screen. Type-only enum import so the client
 *  pickers can use this without pulling Prisma into the browser bundle. */
export const STORE_LABELS: Record<StockStore, string> = {
  KITCHEN: "Kitchen store",
  FNB: "F&B store",
  HOUSEKEEPING: "Housekeeping store",
};

/** In-house stock vs cutlery/crockery hired in from outside, as the client says it. */
export const BANQUET_SOURCE_LABELS: Record<BanquetItemSource, string> = {
  IN_HOUSE: "In-house",
  HIRED: "Hired from outside",
};

/**
 * How an F&B item reads once it is off the catalogue screen.
 *
 * The name does not identify the item: "soup bowl" exists in-house, as hired
 * Melamine and as hired Bonechina, at three different rates. So the code
 * leads (the only unique thing on the row) and the grade and rate follow —
 * picking by name alone bills the customer for the wrong one.
 */
export function banquetItemLabel(i: {
  sku: string | null;
  name: string;
  unit: string;
  category: string | null;
  rate: string | null;
  currentStock?: string;
}): string {
  const bits = [i.sku ?? "—", i.name];
  if (i.category) bits.push(i.category);
  if (i.rate) bits.push(`₹${i.rate}`);
  if (i.currentStock !== undefined) bits.push(`have ${i.currentStock} ${i.unit}`);
  return bits.join(" · ");
}

/**
 * Who may set a stock figure by hand — single-item adjustments and bulk
 * physical counts, on the kitchen store and the F&B (banquet) store alike.
 * Admin and manager only.
 *
 * Everything else that moves stock (receipt, issue, return, transfer,
 * requisition fulfilment) is a *consequence* of a real event with a document
 * behind it, and keeps its own wider role set. This list is only for the
 * paths where a number is typed in with no such event.
 *
 * String literals, not `Role.ADMIN`, so the type-only Prisma import above
 * still holds and this file stays safe to pull into a client bundle.
 */
export const STOCK_EDIT_ROLES: Role[] = ["ADMIN", "MANAGER"];

export function canEditStockDirectly(role: Role | undefined): boolean {
  return role !== undefined && STOCK_EDIT_ROLES.includes(role);
}

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
 * Refusal message for a DECLARATION line, or null when it's allowed.
 *
 * A declaration moves nothing, so it cannot invent stock — the ceiling that
 * protects the ledger is `checkReturnQty`, re-run against confirmed
 * movements only at the moment stock actually goes back. This is the other
 * check: it stops the chef queueing up promises that add to more than is
 * out, so the mismatch surfaces at the kitchen desk where it can be
 * corrected, not at the counter with the stock already in hand.
 *
 * Hence `alreadyDeclared` (other DECLARED, not-yet-confirmed lines against
 * the same issue) counts here and nowhere else. A declaration that gets
 * rejected is no longer DECLARED, so it stops counting the moment it is
 * turned down — whatever it was holding is free again.
 */
export function checkDeclareQty(input: {
  want: Decimal | string;
  issuedQty: Decimal | string;
  alreadyReturned: Decimal | string;
  alreadyDeclared: Decimal | string;
  name: string;
  unit: string;
}): string | null {
  const want = toDecimal(input.want);
  if (want.lte(0)) return "Return quantity must be greater than 0";
  const pending = toDecimal(input.alreadyDeclared);
  const left = remainingReturnable(
    input.issuedQty,
    toDecimal(input.alreadyReturned).plus(pending),
  );
  if (want.gt(left)) {
    const pendingNote = pending.gt(0)
      ? ` (${pending.toString()} ${input.unit} is already declared and waiting on the store)`
      : "";
    return left.isZero()
      ? `${input.name} on this issue has nothing left to send back${pendingNote}.`
      : `Only ${left.toString()} ${input.unit} of ${input.name} can still be declared against this issue${pendingNote}.`;
  }
  return null;
}

/** One movement of one item against one order — issued or returned. */
export interface OrderItemQty {
  orderId: string;
  itemId: string;
  qty: Decimal | string;
}

/**
 * Per order, how many distinct items still have stock out with the client:
 * issued − returned, netted per (order, item), counting the items that come
 * out positive. Items rather than quantities, because "12 pieces + 3 kg" is
 * not a number anyone can act on.
 *
 * Pure, so the netting behind the F&B store's return worklist is testable
 * without a database: a key or sign slip here either hides an order that
 * still owes stock, or parks one that owes nothing on the list forever.
 */
export function itemsStillOutByOrder(
  issued: readonly OrderItemQty[],
  returned: readonly OrderItemQty[],
): Map<string, number> {
  // Separator that cannot occur inside a cuid, so the composite key can
  // never collide and splitting it back apart is exact.
  const key = (l: OrderItemQty) => `${l.orderId}\u0000${l.itemId}`;
  const net = new Map<string, Decimal>();
  for (const l of issued) {
    net.set(key(l), (net.get(key(l)) ?? new Decimal(0)).plus(toDecimal(l.qty)));
  }
  for (const l of returned) {
    net.set(key(l), (net.get(key(l)) ?? new Decimal(0)).minus(toDecimal(l.qty)));
  }
  const counts = new Map<string, number>();
  for (const [k, qty] of net) {
    const orderId = k.slice(0, k.indexOf("\u0000"));
    counts.set(orderId, (counts.get(orderId) ?? 0) + (qty.gt(0) ? 1 : 0));
  }
  return counts;
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
