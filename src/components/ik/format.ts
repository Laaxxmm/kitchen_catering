// Rupee formatting with native lakh/crore grouping.
// Mirrors the `inr()` helper in the Claude Design handoff system.jsx.

// Accept anything `Number()` can handle: plain numbers, strings (e.g. "1234.56"),
// and Prisma Decimals (which define toString()). This lets callers pass
// `Decimal` values straight through without per-call coercion.
type Numeric = number | string | { toString(): string };

export function inr(
  n: Numeric | null | undefined,
  { compact = true, short = false }: { compact?: boolean; short?: boolean } = {},
): string {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const abs = Math.abs(v);

  if (compact) {
    if (abs >= 1e7) return (short ? "" : "₹") + (v / 1e7).toFixed(abs >= 1e8 ? 1 : 2) + " Cr";
    if (abs >= 1e5) return (short ? "" : "₹") + (v / 1e5).toFixed(abs >= 1e6 ? 1 : 2) + " L";
    if (abs >= 1e3) return (short ? "" : "₹") + (v / 1e3).toFixed(1) + "k";
    return (short ? "" : "₹") + Math.round(v);
  }

  // Indian grouping: last 3 digits, then pairs
  const s = Math.round(v).toString();
  const neg = s.startsWith("-") ? "-" : "";
  const d = s.replace("-", "");
  let out: string;
  if (d.length <= 3) {
    out = d;
  } else {
    const last3 = d.slice(-3);
    const rest = d.slice(0, -3);
    out = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
  }
  return "₹" + neg + out;
}

export function fmtDate(v: Date | string | null | undefined, fmt: "short" | "medium" = "medium"): string {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return "—";
  if (fmt === "short") {
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  }
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
  return Number(v).toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
