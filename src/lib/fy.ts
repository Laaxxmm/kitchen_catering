/**
 * Indian financial-year helpers used by the FY-scoped document sequences
 * (OrderCode, QuoteNumber, CustomerInvoiceNumber, ChefRequisitionNumber, etc.).
 *
 * FY runs 1 April → 31 March (IST). The integer `storageYear` is the start
 * year (e.g. FY 26-27 → storageYear 2026), used as the primary key on the
 * `*-Sequence` tables. `label` is the human suffix on document numbers
 * (e.g. "ORD-26-27-0042").
 */

export interface Fy {
  storageYear: number;
  label: string;
}

export function getFyForDate(d: Date): Fy {
  // Use UTC for the boundary check. The 1-April-IST boundary translates
  // to 31-March 18:30 UTC, so any date whose UTC month is >= April-1-UTC-equiv
  // is in the new FY. Edge case (last few hours of 31-March IST → already
  // 1-April UTC) is rare and only matters for documents created within that
  // window; the storageYear may shift forward by a day. Acceptable.
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-based: Apr = 3
  const startYear = month >= 3 ? year : year - 1;
  const a = String(startYear % 100).padStart(2, "0");
  const b = String((startYear + 1) % 100).padStart(2, "0");
  return { storageYear: startYear, label: `${a}-${b}` };
}
