import { describe, expect, it } from "vitest";
import { decimalString } from "@/lib/validators";
import { positiveQty } from "@/lib/dept-purchase-validators";

/**
 * The number checks used to run /^-?\d*\.?\d+$/, which backtracks
 * quadratically: a 1,000,000-digit string ending in a letter blocked the
 * server's event loop for ~20 minutes. Pinned here so it cannot come back.
 */
describe("number inputs are linear-time", () => {
  it("rejects a huge digit run ending in a letter, fast", () => {
    const attack = "1".repeat(200_000) + "x";
    const started = performance.now();
    expect(decimalString.safeParse(attack).success).toBe(false);
    expect(positiveQty.safeParse(attack).success).toBe(false);
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("still takes the numbers people type", () => {
    for (const ok of ["0", "12", "12.5", ".5", "-3", "-0.25", ""]) {
      expect(decimalString.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["1.", "1..2", "1e5", "--1", "abc", " 1 2"]) {
      expect(decimalString.safeParse(bad).success, bad).toBe(false);
    }
    expect(positiveQty.safeParse("2.5").success).toBe(true);
    expect(positiveQty.safeParse("-2").success).toBe(false);
  });
});
