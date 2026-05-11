import { Decimal } from "decimal.js";

export type Money = Decimal;

// Configure Decimal for financial precision
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format a Decimal/number/string as Indian rupees, e.g. ₹1,44,100.00 */
export function formatINR(value: Decimal | number | string | null | undefined): string {
  if (value == null) return "—";
  const d = toDecimal(value);
  return INR.format(d.toNumber());
}

/** Coerce any input into a Decimal. */
export function toDecimal(value: Decimal | number | string | { toString(): string }): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === "number" || typeof value === "string") return new Decimal(value);
  return new Decimal(value.toString());
}

export function zero(): Decimal {
  return new Decimal(0);
}

export function sum(values: Array<Decimal | number | string>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** Round to 2 decimals (paise). Bankers' rounding is avoided — use half-up for predictability. */
export function round2(value: Decimal | number | string): Decimal {
  return toDecimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Compact Indian rupee format: ₹15.43 Cr / ₹1.50 L / ₹45,200. */
export function formatINRCompact(
  value: Decimal | number | string | null | undefined,
): string {
  if (value == null) return "—";
  const n = toDecimal(value).toNumber();
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return `${sign}₹${(abs / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `${sign}₹${(abs / 100_000).toFixed(2)} L`;
  return formatINR(value);
}
