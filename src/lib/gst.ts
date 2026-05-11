import { Decimal } from "decimal.js";
import { round2, toDecimal, zero } from "./money";

export type LineInput = {
  quantity: Decimal | number | string;
  unitPrice: Decimal | number | string;
  discountPct: Decimal | number | string;
  gstRatePct: Decimal | number | string;
};

export type LineAmounts = {
  subtotal: Decimal; // taxable value (post-discount, ex-tax)
  tax: Decimal; // gst amount
  total: Decimal; // subtotal + tax
};

/**
 * Compute a single line's taxable value, GST amount, and total.
 * Rounded to 2 decimals at the line boundary via half-up.
 */
export function computeLine(input: LineInput): LineAmounts {
  const qty = toDecimal(input.quantity);
  const rate = toDecimal(input.unitPrice);
  const disc = toDecimal(input.discountPct);
  const gst = toDecimal(input.gstRatePct);

  const gross = qty.times(rate);
  const discountFactor = new Decimal(1).minus(disc.div(100));
  const subtotalRaw = gross.times(discountFactor);
  const subtotal = round2(subtotalRaw);
  const tax = round2(subtotal.times(gst.div(100)));
  const total = subtotal.plus(tax);

  return { subtotal, tax, total };
}

export type GstBreakdownRow = {
  ratePct: string; // stringified number for stable keys (e.g. "18")
  taxable: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
};

export type SummaryInput = {
  lines: Array<LineInput & { gstRatePct: Decimal | number | string }>;
  supplierStateCode: string;
  placeOfSupplyStateCode: string;
};

export type SummaryResult = {
  subtotal: Decimal;
  cgst: Decimal;
  sgst: Decimal;
  igst: Decimal;
  taxTotal: Decimal;
  grandTotal: Decimal;
  gstBreakdown: GstBreakdownRow[];
};

/**
 * Summarise a set of lines into totals + GST breakdown grouped by rate.
 * Intra-state (supplier state == place of supply) → CGST + SGST (tax/2 each).
 * Inter-state → IGST (= full tax).
 */
export function summarise(input: SummaryInput): SummaryResult {
  const intraState = input.supplierStateCode === input.placeOfSupplyStateCode;
  const byRate = new Map<string, GstBreakdownRow>();

  let subtotal = zero();

  for (const line of input.lines) {
    const { subtotal: lineSubtotal, tax: lineTax } = computeLine(line);
    subtotal = subtotal.plus(lineSubtotal);

    const rateKey = toDecimal(line.gstRatePct).toString();
    const existing = byRate.get(rateKey) ?? {
      ratePct: rateKey,
      taxable: zero(),
      cgst: zero(),
      sgst: zero(),
      igst: zero(),
    };

    const halfTax = round2(lineTax.div(2));
    existing.taxable = existing.taxable.plus(lineSubtotal);
    if (intraState) {
      existing.cgst = existing.cgst.plus(halfTax);
      // Keep cgst+sgst == lineTax exactly by letting sgst absorb rounding slack.
      existing.sgst = existing.sgst.plus(lineTax.minus(halfTax));
    } else {
      existing.igst = existing.igst.plus(lineTax);
    }

    byRate.set(rateKey, existing);
  }

  const cgst = [...byRate.values()].reduce<Decimal>((a, r) => a.plus(r.cgst), zero());
  const sgst = [...byRate.values()].reduce<Decimal>((a, r) => a.plus(r.sgst), zero());
  const igst = [...byRate.values()].reduce<Decimal>((a, r) => a.plus(r.igst), zero());
  const taxTotal = cgst.plus(sgst).plus(igst);
  const grandTotal = subtotal.plus(taxTotal);

  // Sort breakdown rows by rate ascending for stable display.
  const gstBreakdown = [...byRate.values()].sort((a, b) =>
    new Decimal(a.ratePct).cmp(new Decimal(b.ratePct)),
  );

  return { subtotal, cgst, sgst, igst, taxTotal, grandTotal, gstBreakdown };
}

/** Convenience: detect intra-state. */
export function isIntraState(supplierStateCode: string, placeOfSupplyStateCode: string): boolean {
  return supplierStateCode === placeOfSupplyStateCode;
}
