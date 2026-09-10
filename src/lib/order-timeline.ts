/**
 * Was the delivery on time? Pure, so the report page, the Excel export and
 * the tests agree on the one rule.
 *
 * "The time" is the START of the delivery window: that is when guests are
 * being served from, so a drop at 12:40 against a 12:00–15:00 window is 40
 * minutes late, not "within the window". Anything at or before the start is
 * on time, however early.
 */
export type DeliveryVerdict =
  | { kind: "on-time"; earlyMinutes: number }
  | { kind: "late"; lateMinutes: number }
  | { kind: "pending" };

export function deliveryVerdict(
  deliveredAt: Date | null | undefined,
  windowStart: Date,
): DeliveryVerdict {
  if (!deliveredAt) return { kind: "pending" };
  const diffMin = Math.round((deliveredAt.getTime() - windowStart.getTime()) / 60_000);
  // Math.max keeps "exactly on time" at 0, not -0.
  return diffMin > 0
    ? { kind: "late", lateMinutes: diffMin }
    : { kind: "on-time", earlyMinutes: Math.max(0, -diffMin) };
}

/** "1h 05m" / "45m" / "—" for the gap between two stamps. */
export function elapsed(from: Date | null | undefined, to: Date | null | undefined): string {
  if (!from || !to) return "—";
  const m = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}
