import { Decimal } from "decimal.js";
import { toDecimal } from "./money";

export interface MovingAverageInput {
  onHandQty: Decimal | number | string;
  avgUnitCost: Decimal | number | string;
  receiptQty: Decimal | number | string;
  receiptUnitCost: Decimal | number | string;
}

export interface MovingAverageResult {
  qty: Decimal;
  avgUnitCost: Decimal;
}

/**
 * Moving-average inventory cost recalculation on a stock receipt.
 *
 *   newQty  = onHand + receiptQty
 *   newAvg  = (onHand * avg + receiptQty * receiptUnitCost) / newQty
 *
 * When onHand is zero, newAvg = receiptUnitCost.
 */
export function newMovingAverage(input: MovingAverageInput): MovingAverageResult {
  const onHand = toDecimal(input.onHandQty);
  const avg = toDecimal(input.avgUnitCost);
  const rQty = toDecimal(input.receiptQty);
  const rCost = toDecimal(input.receiptUnitCost);

  if (rQty.lte(0)) {
    throw new Error("Receipt quantity must be positive");
  }

  const newQty = onHand.plus(rQty);
  if (newQty.lte(0)) {
    throw new Error("New quantity must be positive after receipt");
  }

  const newValue = onHand.times(avg).plus(rQty.times(rCost));
  const newAvg = newValue.div(newQty);

  return { qty: newQty, avgUnitCost: newAvg };
}

/** Value of an issue: qty × snapshotted unitCost. */
export function issueCost(qty: Decimal | number | string, unitCostAtIssue: Decimal | number | string): Decimal {
  return toDecimal(qty).times(toDecimal(unitCostAtIssue));
}
