import { describe, expect, it } from "vitest";
import { deliveryVerdict, elapsed } from "@/lib/order-timeline";

/** "The time" is the start of the delivery window — when guests are served from. */
const start = new Date("2026-09-12T12:00:00+05:30");
const at = (hhmm: string) => new Date(`2026-09-12T${hhmm}:00+05:30`);

describe("delivery verdict", () => {
  it("is on time at the window start, and early before it", () => {
    expect(deliveryVerdict(at("12:00"), start)).toEqual({ kind: "on-time", earlyMinutes: 0 });
    expect(deliveryVerdict(at("11:35"), start)).toEqual({ kind: "on-time", earlyMinutes: 25 });
  });
  it("is late after the start, by the minute — not 'within the window'", () => {
    expect(deliveryVerdict(at("12:40"), start)).toEqual({ kind: "late", lateMinutes: 40 });
  });
  it("is pending until delivered", () => {
    expect(deliveryVerdict(null, start)).toEqual({ kind: "pending" });
  });
});

describe("elapsed", () => {
  it("reads as hours and minutes", () => {
    expect(elapsed(at("09:00"), at("10:05"))).toBe("1h 05m");
    expect(elapsed(at("09:00"), at("09:45"))).toBe("45m");
    expect(elapsed(null, at("09:45"))).toBe("—");
  });
});
