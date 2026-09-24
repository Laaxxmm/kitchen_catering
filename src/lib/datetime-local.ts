import { formatIST } from "@/lib/time";

/**
 * Values for `<input type="datetime-local">`.
 *
 * Every date-time the team keys in is read by the server as IST
 * (`istToUtc`), so the box's default must be the IST clock too. The old
 * `new Date().toISOString().slice(0, 16)` was the UTC clock: every record
 * saved with the default time landed 5h30 early, and anything entered
 * between 00:00 and 05:29 IST fell on the previous day.
 */
export function nowLocalInput(): string {
  return formatIST(new Date(), "yyyy-MM-dd'T'HH:mm");
}

/** The same, for a given instant. */
export function localInputAt(date: Date): string {
  return formatIST(date, "yyyy-MM-dd'T'HH:mm");
}
