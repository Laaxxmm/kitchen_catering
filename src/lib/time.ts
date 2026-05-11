import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { addMonths, endOfMonth, startOfMonth } from "date-fns";

export const APP_TZ = process.env.APP_TZ ?? "Asia/Kolkata";

/** Format a UTC Date in IST. */
export function formatIST(date: Date, pattern = "yyyy-MM-dd HH:mm"): string {
  return formatInTimeZone(date, APP_TZ, pattern);
}

/** Convert a naive IST clock time into a UTC Date. */
export function istToUtc(isoLocal: string): Date {
  return fromZonedTime(isoLocal, APP_TZ);
}

/** First-of-month in IST, expressed as a UTC Date (stored in DB as periodMonth). */
export function istMonthStart(date: Date): Date {
  const zoned = toZonedTime(date, APP_TZ);
  const mStart = startOfMonth(zoned);
  return fromZonedTime(mStart, APP_TZ);
}

export function istMonthEnd(date: Date): Date {
  const zoned = toZonedTime(date, APP_TZ);
  const mEnd = endOfMonth(zoned);
  return fromZonedTime(mEnd, APP_TZ);
}

export function istMonthBoundaries(date: Date): { start: Date; end: Date } {
  return { start: istMonthStart(date), end: istMonthEnd(date) };
}

/** Enumerate the first-of-month boundaries (UTC) that intersect [from, to]. */
export function istMonthsInRange(from: Date, to: Date): Date[] {
  const months: Date[] = [];
  let cursor = istMonthStart(from);
  const stop = istMonthStart(to);
  while (cursor.getTime() <= stop.getTime()) {
    months.push(cursor);
    cursor = istMonthStart(addMonths(cursor, 1));
  }
  return months;
}

/**
 * Indian financial year helpers. FY runs from 1 April → 31 March (IST).
 * `istFyStart(date)` returns the 1-April midnight IST for the FY that `date`
 * belongs to, expressed as a UTC Date. `istFyEnd` returns the next year's
 * 1-April midnight IST (exclusive upper bound).
 */
export function istFyStart(date: Date): Date {
  const zoned = toZonedTime(date, APP_TZ);
  const month = zoned.getMonth(); // 0 = Jan, 3 = April
  const fyStartYear = month >= 3 ? zoned.getFullYear() : zoned.getFullYear() - 1;
  return fromZonedTime(new Date(fyStartYear, 3, 1), APP_TZ);
}

export function istFyEnd(date: Date): Date {
  const start = istFyStart(date);
  const zonedStart = toZonedTime(start, APP_TZ);
  return fromZonedTime(new Date(zonedStart.getFullYear() + 1, 3, 1), APP_TZ);
}

/** "FY 26-27" style label for the FY that contains the given date. */
export function istFyLabel(date: Date): string {
  const start = istFyStart(date);
  const y = toZonedTime(start, APP_TZ).getFullYear();
  return `FY ${String(y).slice(-2)}-${String(y + 1).slice(-2)}`;
}

/** Compute overlap in minutes between two half-open intervals [a1,a2) and [b1,b2). */
export function overlapMinutes(a1: Date, a2: Date, b1: Date, b2: Date): number {
  const start = Math.max(a1.getTime(), b1.getTime());
  const end = Math.min(a2.getTime(), b2.getTime());
  if (end <= start) return 0;
  return Math.floor((end - start) / 60000);
}

/** Minutes between two timestamps; used for kitchen-prep / delivery durations. */
export function minutesBetween(a: Date, b: Date): number {
  return Math.max(0, Math.floor((b.getTime() - a.getTime()) / 60000));
}
